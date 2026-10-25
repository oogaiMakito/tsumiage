'use strict';
(() => {
  const KEY = 'tsumiage.v1';
  // 主役は「PMへの道」。「転職活動」は過去の記録の表示用に残す
  const CATS = {
    pm: 'PMへの道', mind: 'こころ', note: 'note', music: '音楽', study: '診断士', other: 'そのほか', job: '転職活動',
  };
  const MAIN = 'pm';
  const STAGES = { note: ['ネタ', '下書き', '公開'], music: ['ネタ', '制作中', '完成・公開'] };
  const INTERVALS = [1, 3, 7, 14, 30, 60];
  const TINY = ['10分だけ外を歩く', '寝る前に3行だけ書く', 'PMの用語を1つだけ読む', '好きな曲を1曲聴く', '今日は早めに寝る'];
  const MOODS = ['', 'とてもつらい', 'つらい', 'ふつう', 'よい', 'とてもよい'];
  const MILESTONES = [10, 30, 50, 100, 200, 300, 500, 1000];

  const blank = () => ({
    version: 3,
    mainLabel: 'PMへの道',
    goals: { note: 1, music: 1 },
    facts: [],
    links: { note: '', youtube: '', x: '' },
    tasks: [], wins: [], ideas: [],
    study: {}, studyDays: {}, myTerms: [],
    interests: [], read: {},
    vision: '', why: { pm: '', job: '', note: '', music: '', study: '' },
    journal: [], worries: [], mood: {}, pmDays: {}, learn: { goal: 35, from: '' },
    profile: { name: '', avatar: '' },
    deleted: {}, settingsAt: 0,
  });
  // 転職活動のころ（v1）・入社準備のころ（v2）のデータを、「PMへの道」が主役の形にそろえる
  function migrate(st) {
    if ((st.version || 1) < 3) {
      if (!st.mainLabel || st.mainLabel === '転職活動' || st.mainLabel === '入社準備・PM') { st.mainLabel = 'PMへの道'; st.settingsAt = Date.now(); }
      st.version = 3;
    }
    return st;
  }

  let S = load();
  let quiz = null;
  const searchQ = { shindan: '', pm: '' };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate({ ...blank(), ...JSON.parse(raw) });
    } catch (e) { /* 保存が使えない環境でも表示はできる */ }
    return blank();
  }
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('保存できませんでした。ブラウザでサイトデータの保存が許可されているか確認してください。'); }
  }
  let syncTimer;
  function save() {
    saveLocal();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(), 4000);
  }
  const markDeleted = id => { S.deleted = { ...S.deleted, [id]: Date.now() }; };

  // ── 同期 ──
  // GitHub の非公開リポジトリに、合言葉から作った鍵で暗号化（AES-GCM）して1ファイルで保存する。
  // 両方の端末で変更があったときは、記録を id ごとに突き合わせて合体させる。
  const SYNC_KEY = 'tsumiage.sync';
  const SYNC_PATH = 'tsumiage-data.json';
  const SETTING_KEYS = ['mainLabel', 'goals', 'facts', 'links', 'interests', 'vision', 'why', 'learn', 'profile'];
  let sync = (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } })();
  const syncReady = () => Boolean(sync.owner && sync.repo && sync.token && sync.pass);
  const saveSync = () => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (e) { /* 無視 */ } };
  const te = new TextEncoder(), td = new TextDecoder();
  const toB64 = bytes => { let str = ''; for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(str); };
  const fromB64 = b64 => Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0));
  class SyncError extends Error { constructor(kind, status) { super(kind); this.kind = kind; this.status = status; } }

  let keyCache = null;
  async function deriveKey(saltB64) {
    const id = `${sync.pass}|${saltB64}`;
    if (keyCache && keyCache.id === id) return keyCache.key;
    const base = await crypto.subtle.importKey('raw', te.encode(sync.pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: fromB64(saltB64), iterations: 250000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    keyCache = { id, key };
    return key;
  }
  async function encryptState(obj) {
    if (!sync.salt) { sync.salt = toB64(crypto.getRandomValues(new Uint8Array(16))); saveSync(); }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(sync.salt), te.encode(JSON.stringify(obj)));
    return { v: 1, salt: sync.salt, iv: toB64(iv), data: toB64(new Uint8Array(ct)) };
  }
  async function decryptState(file) {
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, await deriveKey(file.salt), fromB64(file.data));
      if (sync.salt !== file.salt) { sync.salt = file.salt; saveSync(); }
      return migrate({ ...blank(), ...JSON.parse(td.decode(pt)) });
    } catch (e) { throw new SyncError('pass'); }
  }

  const ghUrl = () => `https://api.github.com/repos/${encodeURIComponent(sync.owner)}/${encodeURIComponent(sync.repo)}/contents/${SYNC_PATH}`;
  const ghHeaders = () => ({ Authorization: `Bearer ${sync.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  async function ghFetch(url, opts) {
    try { return await fetch(url, opts); } catch (e) { throw new SyncError('offline'); }
  }
  async function ghGet() {
    const r = await ghFetch(ghUrl(), { headers: ghHeaders(), cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new SyncError('http', r.status);
    const j = await r.json();
    return { sha: j.sha, file: JSON.parse(td.decode(fromB64(j.content))) };
  }
  async function ghPut(file, sha) {
    const body = { message: `同期 ${new Date().toISOString()}`, content: toB64(te.encode(JSON.stringify(file))) };
    if (sha) body.sha = sha;
    const r = await ghFetch(ghUrl(), { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new SyncError('http', r.status);
  }
  function syncMessage(e) {
    if (e.kind === 'pass') return '合言葉が違います。ほかの端末と同じ合言葉を入れてください。';
    if (e.kind === 'offline') return 'ネットにつながっていません。つながったときに同期します。';
    if (e.status === 401) return 'トークンが正しくないか、期限が切れています。';
    if (e.status === 403) return 'トークンに書き込みの権限がありません。「Contents」を「Read and write」にしてください。';
    if (e.status === 404) return 'リポジトリが見つかりません。ユーザー名・リポジトリ名と、トークンの対象リポジトリを確かめてください。';
    return `同期できませんでした（${e.status || e.message}）。`;
  }

  const stamp = x => x.u || x.ts || 0;
  function mergeState(a, b) {
    const out = { ...blank(), ...a };
    const deleted = { ...(b.deleted || {}) };
    for (const [k, v] of Object.entries(a.deleted || {})) deleted[k] = Math.max(v, deleted[k] || 0);
    out.deleted = deleted;
    const list = key => {
      const m = new Map();
      for (const x of [...(a[key] || []), ...(b[key] || [])]) {
        if (deleted[x.id]) continue;
        const cur = m.get(x.id);
        if (!cur || stamp(x) > stamp(cur)) m.set(x.id, x);
      }
      return [...m.values()];
    };
    out.tasks = list('tasks');
    out.ideas = list('ideas');
    out.myTerms = list('myTerms');
    out.journal = list('journal');
    out.worries = list('worries');
    out.mood = { ...(b.mood || {}) };
    for (const [d, r] of Object.entries(a.mood || {})) { const o = out.mood[d]; if (!o || (r.u || 0) > (o.u || 0)) out.mood[d] = r; }
    out.pmDays = { ...(b.pmDays || {}) };
    for (const [d, n] of Object.entries(a.pmDays || {})) out.pmDays[d] = Math.max(n, out.pmDays[d] || 0);
    out.study = { ...(b.study || {}) };
    for (const [id, r] of Object.entries(a.study || {})) {
      const o = out.study[id];
      if (!o || (r.count || 0) > (o.count || 0)) out.study[id] = r;
    }
    out.studyDays = { ...(b.studyDays || {}) };
    for (const [d, n] of Object.entries(a.studyDays || {})) out.studyDays[d] = Math.max(n, out.studyDays[d] || 0);
    const studyWin = new Set();
    out.wins = list('wins').sort((x, y) => (x.ts || 0) - (y.ts || 0)).filter(w => {
      if (!w.key) return true;
      if (studyWin.has(w.key)) return false; // 同じ日の「ふりかえり」、同じ記事の「読んだ」は1件にまとめる
      studyWin.add(w.key);
      return true;
    }).map(w => (w.key && w.key.startsWith('study-') && out.studyDays[w.key.slice(6)] ? { ...w, text: `診断士の用語と問題を${out.studyDays[w.key.slice(6)]}回ふりかえった` }
      : w.key && w.key.startsWith('pm-') && out.pmDays[w.key.slice(3)] ? { ...w, text: `PM・AIの用語を${out.pmDays[w.key.slice(3)]}回ふりかえった` } : w));
    out.read = { ...(b.read || {}), ...(a.read || {}) };
    const src = (a.settingsAt || 0) > (b.settingsAt || 0) ? a : b; // 同じならリモートを優先
    for (const k of SETTING_KEYS) if (src[k] !== undefined) out[k] = src[k];
    out.settingsAt = Math.max(a.settingsAt || 0, b.settingsAt || 0);
    return out;
  }
  const canon = v => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));

  let syncing = null, syncAgain = false;
  function syncNow({ manual = false } = {}) {
    if (!syncReady()) { if (manual) toast('同期の設定がまだです。'); return Promise.resolve(); }
    if (syncing) { syncAgain = true; return syncing; }
    syncing = (async () => {
      sync.busy = true; updateSyncStatus();
      try {
        for (let attempt = 0; ; attempt++) {
          const remote = await ghGet();
          let merged = S;
          if (remote) {
            const theirs = await decryptState(remote.file);
            merged = mergeState(S, theirs);
            if (canon(merged) !== canon(S)) { S = merged; saveLocal(); softRender(); }
            if (canon(merged) === canon(theirs)) break;
          }
          try { await ghPut(await encryptState(merged), remote && remote.sha); break; }
          catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 2) continue; throw e; }
        }
        sync.lastAt = Date.now(); sync.error = '';
        if (manual) toast('同期しました。');
      } catch (e) {
        sync.error = syncMessage(e);
        if (manual) toast(sync.error);
      } finally {
        sync.busy = false; saveSync(); syncing = null; updateSyncStatus();
        if (syncAgain) { syncAgain = false; syncNow(); }
      }
    })();
    return syncing;
  }
  function syncStatusText() {
    if (!syncReady()) return '同期は設定されていません。';
    if (sync.busy) return '同期しています…';
    if (sync.error) return `同期できていません：${sync.error}`;
    if (!sync.lastAt) return 'まだ同期していません。';
    const d = new Date(sync.lastAt);
    return `最後の同期：${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function updateSyncStatus() {
    document.querySelectorAll('.sync-status').forEach(el => {
      el.textContent = syncStatusText();
      el.classList.toggle('is-error', Boolean(syncReady() && sync.error && !sync.busy));
    });
  }

  // ── 小道具 ──
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escBr = s => esc(s).replace(/\n/g, '<br>');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = n => String(n).padStart(2, '0');
  const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const WD = '日月火水木金土';
  const jpDate = (d = new Date()) => `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
  const weekStart = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return ymd(x); };
  const monthStart = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  const pickDaily = (arr, salt = '') => (arr.length ? arr[hash(ymd() + salt) % arr.length] : null);
  const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const catLabel = c => (c === MAIN ? (S.mainLabel || CATS[MAIN]) : CATS[c] || '');
  const catOptions = sel => Object.keys(CATS).filter(k => k !== 'job' || k === sel).map(k => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(catLabel(k))}</option>`).join('');

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // X の投稿画面を文章入りで開く（APIは使わない）。日本語は1文字2、英数字は1として280まで。
  const xUrl = text => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  const xLen = text => [...text].reduce((n, c) => n + (c.codePointAt(0) <= 0x10ff ? 1 : 2), 0);
  function fitX(parts, tail) {
    const lines = parts.filter(Boolean);
    const join = () => [...lines, '', tail].join('\n');
    while (xLen(join()) > 280 && lines.length > 2) lines.pop();
    let text = join();
    while (xLen(text) > 280) { lines[lines.length - 1] = lines[lines.length - 1].slice(0, -2) + '…'; text = join(); }
    return text;
  }
  const isPm = t => t && t.d === 'pm';
  const termPost = t => (isPm(t)
    ? fitX([`【今日の1語｜PM・生成AI】`, `■ ${t.t}`, t.one, t.work ? `Web制作でいうと：${t.work}` : ''], '#プロジェクトマネジメント #生成AI #1日1語')
    : fitX([`【今日の1語｜中小企業診断士】`, `■ ${t.t}`, t.one, t.work ? `仕事でいうと：${t.work}` : ''], '#中小企業診断士 #1日1語'));
  const quizPost = q => fitX([`【今日の1問｜中小企業診断士】`, q.q,
    q.choices.length === 2 ? '○か×か？' : q.choices.map((c, i) => `${'ABCD'[i]}. ${c}`).join('\n'), '答えはリプ欄で。'], '#中小企業診断士 #1日1問');
  const why = cat => (S.why && S.why[cat]) || '';
  const whyHtml = cat => (why(cat) ? `<p class="why">目的地へ：${esc(why(cat))}</p>` : '');
  const claudeUrl = prompt => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
  const termPrompt = (word, d = 'shindan') => (d === 'pm'
    ? `Web制作のディレクターから、大企業のシステム・生成AI案件のプロジェクトマネージャーになる準備をしています。「${word}」について、次の順で平易な日本語で解説してください。\n1. 一言でいうと\n2. 詳しい解説（関連する用語も）\n3. 現場でつまずきやすいポイント\n4. Web制作の経験に置き換えた例\n5. 理解を確かめる問いを1つ（答えは書かずに。私が答えたら採点してください）`
    : `中小企業診断士の勉強をしています。「${word}」について、次の順で平易な日本語で解説してください。\n1. 一言でいうと\n2. 詳しい解説（提唱者や関連する用語も）\n3. 試験で問われやすいポイント\n4. Webディレクターの仕事に置き換えた例`);

  // ── 積み上げ ──
  const winsSince = from => S.wins.filter(w => w.date >= from);
  function addWin(cat, text, extra = {}) {
    const w = { id: uid(), date: ymd(), ts: Date.now(), cat, text, ...extra };
    S.wins.push(w);
    save();
    const total = S.wins.length;
    toast(MILESTONES.includes(total) ? `積み上げが${total}件になりました。` : `記録しました。今週${winsSince(weekStart()).length}件目です。`);
  }
  const pubCount = cat => S.wins.filter(w => w.cat === cat && w.pub && w.date >= (cat === 'music' ? monthStart() : weekStart())).length;

  function encourage() {
    const d = new Date();
    const lines = [];
    const total = S.wins.length;
    const week = winsSince(weekStart());
    if (d.getDate() === 1) lines.push('新しい月です。先月のことはいったん置いて、ここから数え直せます。');
    else if (d.getDay() === 1) {
      const last = S.wins.filter(w => w.date >= addDays(weekStart(), -7) && w.date < weekStart()).length;
      lines.push(last ? `新しい週です。先週は${last}件、積み上げました。` : '新しい週です。ここから数え直せます。');
    }
    if (!total) lines.push('まだ記録はありません。今日できたことを1行書くところから始めましょう。どんなに小さくても1件です。');
    else if (!week.length) lines.push(`今週はまだ記録がありません。これまでに${total}件を積み上げてきました。今日は5分版を1つだけで十分です。`);
    else {
      const latest = week[week.length - 1];
      lines.push(`今週は${week.length}件、前に進みました。直近は「${latest.text}」。`);
    }
    const yj = (S.journal || []).find(j => j.date === addDays(ymd(), -1));
    if (yj && yj.next) lines.push(`昨日の自分が決めた、今日の最初の1歩：「${yj.next}」。`);
    const fact = pickDaily(S.facts, 'fact');
    return { lines, fact };
  }

  // ── 用語 ──
  // d：'shindan'（診断士）か 'pm'（PM学習）。自分で登録した用語も d で分ける
  const domOf = t => (t && t.d === 'pm' ? 'pm' : 'shindan');
  const allTerms = (d = 'shindan') => (d === 'pm' ? PM_GLOSSARY : GLOSSARY)
    .concat(S.myTerms.filter(t => domOf(t) === d).map(t => ({ ...t, mine: true })));
  const termById = id => allTerms('shindan').concat(allTerms('pm')).find(t => t.id === id);
  const norm = s => String(s).normalize('NFKC').toLowerCase()
    .replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・･\-‐ー―（）()「」『』、。,.]/g, '');
  function search(q, d = 'shindan') {
    const n = norm(q);
    if (!n) return [];
    return allTerms(d).map(t => {
      let sc = 0;
      for (const k of [t.t, ...(t.y || [])].map(norm)) {
        if (!k) continue;
        if (k === n) sc = Math.max(sc, 100);
        else if (k.startsWith(n)) sc = Math.max(sc, 60);
        else if (k.includes(n)) sc = Math.max(sc, 40);
        else if (k.length >= 2 && n.includes(k)) sc = Math.max(sc, 20 + k.length);
      }
      if (!sc && n.length >= 2 && norm(t.one + t.body).includes(n)) sc = 10;
      return { t, sc };
    }).filter(x => x.sc).sort((a, b) => b.sc - a.sc).map(x => x.t);
  }
  const dueTerms = (d = 'shindan') => { const today = ymd(); return allTerms(d).filter(t => S.study[t.id] && S.study[t.id].due <= today); };
  function review(id, ok, silent = false) {
    const r = S.study[id];
    const lv = ok ? (r ? Math.min(r.lv + 1, INTERVALS.length - 1) : 0) : 0;
    const today = ymd();
    S.study[id] = { lv, due: addDays(today, ok ? INTERVALS[lv] : 1), count: (r ? r.count : 0) + 1, last: today };
    const pm = isPm(termById(id));
    const days = pm ? (S.pmDays = S.pmDays || {}) : S.studyDays;
    const n = (days[today] || 0) + 1;
    days[today] = n;
    const key = `${pm ? 'pm' : 'study'}-${today}`;
    const text = pm ? `PM・AIの用語を${n}回ふりかえった` : `診断士の用語と問題を${n}回ふりかえった`;
    const w = S.wins.find(x => x.key === key);
    if (w) w.text = text;
    else { S.wins.push({ id: uid(), date: today, ts: Date.now(), cat: pm ? MAIN : 'study', text, key }); }
    save();
    if (!silent) toast(ok ? `今日${n}回目。${INTERVALS[lv]}日後にもう一度出します。` : `今日${n}回目。明日もう一度出します。`);
  }

  // ── ちょっと1問 ──
  // 用語当て（4択）、○×、計算（4択）の3種類。答えると用語の復習予定にも反映する。
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const num = v => v.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  function choicesWith(answer, wrongs) {
    const set = [answer];
    for (const w of wrongs) if (set.length < 4 && !set.includes(w)) set.push(w);
    const list = shuffle(set);
    return { choices: list, answer: list.indexOf(answer) };
  }
  function termQuestion(d = 'shindan') {
    const pool = allTerms(d).filter(t => t.one);
    const due = dueTerms(d).filter(t => t.one);
    const t = due.length ? pick(due) : pick(pool);
    const same = shuffle(pool.filter(x => x.id !== t.id && x.s === t.s));
    const other = shuffle(pool.filter(x => x.id !== t.id && x.s !== t.s));
    return { lead: 'これ、どの用語でしょう？', q: t.one, ...choicesWith(t.t, [...same, ...other].map(x => x.t)), exp: t.body, ref: t.id };
  }
  function tfQuestion() {
    const due = new Set(dueTerms().map(t => t.id));
    const pool = QUIZ_TF.filter(x => due.has(x.ref));
    const x = pick(pool.length ? pool : QUIZ_TF);
    return { lead: '○か×か。', q: x.q, choices: ['○', '×'], answer: x.a ? 0 : 1, exp: x.exp, ref: x.ref };
  }
  const CALC_Q = [
    () => {
      const bep = pick([1000, 1500, 2000, 2500, 3000, 4000]), r = pick([20, 25, 40, 50]), fc = bep * r / 100;
      return { lead: '暗算でいけます。', q: `固定費${num(fc)}万円、限界利益率${r}%の会社。損益分岐点売上高は？`,
        ...choicesWith(`${num(bep)}万円`, [`${num(fc * r / 100)}万円`, `${num(Math.round(fc / (1 - r / 100)))}万円`, `${num(bep * 1.5)}万円`, `${num(bep / 2)}万円`]),
        exp: `損益分岐点売上高＝固定費÷限界利益率＝${num(fc)}÷${r / 100}＝${num(bep)}万円。`, ref: 'bep' };
    },
    () => {
      const s = pick([2000, 2500, 4000, 5000]), m = pick([10, 20, 25, 40]), bep = s * (100 - m) / 100;
      return { lead: '暗算でいけます。', q: `売上高${num(s)}万円、損益分岐点売上高${num(bep)}万円。安全余裕率は？`,
        ...choicesWith(`${m}%`, [`${100 - m}%`, `${m + 10}%`, `${Math.max(5, m - 5)}%`]),
        exp: `安全余裕率＝（売上高−損益分岐点売上高）÷売上高＝${num(s - bep)}÷${num(s)}＝${m}%。`, ref: 'safety' };
    },
    () => {
      const cl = pick([400, 500, 800, 1000]), r = pick([120, 150, 200, 250]), ca = cl * r / 100;
      return { lead: '暗算でいけます。', q: `流動資産${num(ca)}万円、流動負債${num(cl)}万円。流動比率は？`,
        ...choicesWith(`${r}%`, [`${num(Math.round(cl / ca * 1000) / 10)}%`, `${r - 50}%`, `${r + 50}%`]),
        exp: `流動比率＝流動資産÷流動負債×100＝${num(ca)}÷${num(cl)}×100＝${r}%。`, ref: 'liquidity' };
    },
    () => {
      const cost = pick([200, 300, 500, 600]), life = pick([4, 5, 10]), dep = cost / life;
      return { lead: '暗算でいけます。', q: `取得原価${cost}万円、耐用年数${life}年、残存価額0円。定額法の毎年の減価償却費は？`,
        ...choicesWith(`${num(dep)}万円`, [`${num(dep * 2)}万円`, `${num(cost * 0.9 / life)}万円`, `${num(cost / (life - 1))}万円`]),
        exp: `定額法＝（取得原価−残存価額）÷耐用年数＝${cost}÷${life}＝${num(dep)}万円。`, ref: 'depreciation' };
    },
    () => {
      const eq = pick([800, 1000, 2000, 4000]), roe = pick([5, 8, 10, 15]), ni = eq * roe / 100, ta = eq * 2.5;
      return { lead: '暗算でいけます。', q: `当期純利益${num(ni)}万円、自己資本${num(eq)}万円、総資本${num(ta)}万円。ROEは？`,
        ...choicesWith(`${roe}%`, [`${num(roe / 2.5)}%`, `${roe * 2}%`, `${roe + 5}%`, `${roe * 3}%`]),
        exp: `ROE＝当期純利益÷自己資本×100＝${num(ni)}÷${num(eq)}×100＝${roe}%。総資本で割るとROAになる（${num(roe / 2.5)}%）。`, ref: 'roe' };
    },
  ];
  function nextQuestion(d = 'shindan') {
    if (d === 'pm') return { ...termQuestion('pm'), picked: null, d };
    const r = Math.random();
    const q = r < 0.45 ? termQuestion() : r < 0.8 ? tfQuestion() : pick(CALC_Q)();
    return { ...q, picked: null, d };
  }
  const qqs = { shindan: null, pm: null };
  function qqHtml(d = 'shindan') {
    if (!qqs[d]) qqs[d] = nextQuestion(d);
    const qq = qqs[d];
    const done = qq.picked !== null;
    const ok = done && qq.picked === qq.answer;
    const t = qq.ref && termById(qq.ref);
    return `<div class="qq${done ? (ok ? ' is-ok' : ' is-ng') : ''}">
      <p class="qq-lead">${esc(qq.lead)}</p>
      <p class="qq-q">${esc(qq.q)}</p>
      <div class="qq-choices${qq.choices.length === 2 ? ' is-tf' : qq.choices.every(c => c.length <= 14) ? ' is-grid' : ''}">
        ${qq.choices.map((c, i) => `<button class="qq-choice${done && i === qq.answer ? ' is-answer' : ''}${done && i === qq.picked && !ok ? ' is-picked' : ''}"
          data-act="qq-answer" data-i="${i}"${done ? ' disabled' : ''}>${esc(c)}</button>`).join('')}
      </div>
      ${done ? `<div class="qq-result" role="status">
        <p class="qq-verdict">${ok ? '正解です。' : `惜しい。正解は「${esc(qq.choices[qq.answer])}」です。`}</p>
        <p class="qq-exp">${esc(qq.exp)}</p>
        <div class="term-acts"><button class="btn" data-act="qq-next">もう1問</button>
          ${d === 'pm' ? '' : `<a class="btn-line" href="${xUrl(quizPost(qq))}" target="_blank" rel="noopener" data-act="x-quiz">この問題をXで出題</a>`}
          ${t ? `<button class="btn-line" data-act="show-term" data-id="${esc(t.id)}">「${esc(t.t)}」の解説を見る</button>` : ''}</div>
      </div>` : ''}
    </div>`;
  }
  function refreshQQ() { document.querySelectorAll('.qq-slot').forEach(el => { el.innerHTML = qqHtml(el.dataset.d || 'shindan'); }); }

  // ── 読みもの（Qiita のPMBOK記事・PM実践記事・Backlog ブログ・iDID インタビュー） ──
  // どれもブラウザから直接読める（CORS許可あり）。中継サービスは使わない。
  // 要約は記事の冒頭と、本文から関心キーワードを含む文を抜き出したもの。AIは使わない。
  const FEED_TTL = 12 * 3600 * 1000;
  const DEFAULT_INTERESTS = ['PMBOK', 'パフォーマンス領域', 'テーラリング', 'ガバナンス', 'プロジェクトマネジメント', 'PM', '要件定義', '見積もり', 'リスク', '品質', '進行管理', 'ディレクション', '合意', 'チーム', 'マネジメント', '生成AI', 'RAG', 'AI駆動', 'DX', '組織', 'クライアント', '言葉'];
  // 読む前の問い：読み物ごとに「何を持ち帰るか」を決めてから開く。日替わりで1つ出す
  const QIITA_QUERY = 'stocks:>5 tag:プロジェクトマネジメント OR stocks:>5 tag:PM OR stocks:>5 tag:要件定義 OR stocks:>5 tag:ディレクション';
  const QIITA_PMBOK = 'tag:PMBOK OR PMBOK stocks:>3';
  const mdText = md => String(md || '').replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '').replace(/[*_`>|]/g, '').replace(/\n\s*\n+/g, '\n').trim();
  // Qiita の検索API（CORS許可あり。認証なしで1時間60回まで。12時間に1回しか読まないので足りる）
  async function qiitaLoad(query) {
    const res = await fetch(`https://qiita.com/api/v2/items?per_page=30&query=${encodeURIComponent(query)}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()).map(p => {
      const text = mdText(p.body).slice(0, 8000);
      return { id: p.url, link: p.url, title: p.title, date: Date.parse(p.created_at) || 0, desc: text.slice(0, 110) + (text.length > 110 ? '…' : ''), text, likes: p.likes_count || 0 };
    });
  }
  const SOURCES = {
    pmbok: {
      name: 'Qiita：PMBOK', sub: 'PMBOKを学ぶ記事', key: 'tsumiage.feed.qiita-pmbok', link: /^https:\/\/qiita\.com\//,
      about: 'Qiita（エンジニアの技術記事サイト）のPMBOKに関する記事',
      lens: ['この記事の話は、PMBOK第8版のどの原則・パフォーマンス領域に当たるか', '自分の過去の案件で、同じ場面はどこだったか。そのとき何が足りなかったか', '入社後の最初の案件で、この考え方をどう使うか'],
      load: () => qiitaLoad(QIITA_PMBOK),
    },
    qiita: {
      name: 'Qiita：PM実践', sub: '現役PMの実践記事', key: 'tsumiage.feed.qiita-pm', link: /^https:\/\/qiita\.com\//,
      about: 'Qiita（エンジニアの技術記事サイト）のプロジェクトマネジメント・要件定義の記事',
      lens: ['この人は、どの判断で迷い、何を基準に決めたか', '大企業の案件で同じことが起きたら、自分は最初に誰と何を合意するか', 'Web制作の経験に置き換えると、どの場面の話か'],
      load: () => qiitaLoad(QIITA_QUERY),
    },
    backlog: {
      name: 'Backlog ブログ', sub: 'プロジェクト管理とチーム', key: 'tsumiage.feed.backlog', link: /^https:\/\/backlog\.com\/ja\/blog\//,
      about: 'Backlog ブログ（プロジェクト管理ツールを作るヌーラボのブログ）',
      lens: ['この仕組みは、誰のどんな困りごとを解くためのものか', '仕事が1人に偏ったとき、この方法ならどう防げるか', '自分のチームに取り入れるなら、どこからか'],
      async load() {
        const xml = await getXml('https://backlog.com/ja/blog/feed/');
        // 概要の末尾につく「続きを読む» The post … appeared first on …」を取り除く
        const clean = t => t.replace(/\s*(続きを読む»?|続きを読む\s*»)?\s*The post[\s\S]*appeared first on[\s\S]*$/, '').trim();
        return rssItems(xml, it => ({ desc: clean(plainText(it('description'))), text: plainText(it('content:encoded')).slice(0, 8000) }));
      },
    },
    idid: {
      name: 'iDID Interview', sub: 'つくり手の判断と転機', key: 'tsumiage.feed.idid', link: /^https:\/\/idid\.team\/articles\/interview\//,
      about: 'iDID（クリエイターのための情報メディア）のインタビュー',
      lens: ['この人が迷った場面はどこか。自分ならどちらを選ぶか', '仕事の取り方・チームのつくり方で、まねできることは何か', '自分の経歴（売る→つくる→束ねる）と重なる転機はあるか'],
      async load() {
        const res = await fetch('https://idid.team/wp-json/wp/v2/posts?categories=4&per_page=30&_fields=link,title,date_gmt,excerpt,content', { cache: 'no-cache' });
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()).map(p => ({
          id: p.link, link: p.link, title: plainText(p.title.rendered), date: Date.parse(`${p.date_gmt}Z`) || 0,
          desc: plainText(p.excerpt.rendered).replace(/\s*\[[…\.]+\]\s*$/, ''), text: plainText(p.content.rendered).slice(0, 8000),
        }));
      },
    },
  };
  const SRC_IDS = Object.keys(SOURCES);
  const feeds = {}, feedState = {};
  for (const s of SRC_IDS) {
    try { feeds[s] = JSON.parse(localStorage.getItem(SOURCES[s].key)); } catch (e) { feeds[s] = null; }
    feedState[s] = 'idle';
  }

  function plainText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('br, p, h2, h3, li').forEach(el => el.after('\n'));
    return (doc.body.textContent || '').replace(/\n\s*\n+/g, '\n').trim();
  }
  async function getXml(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    return new DOMParser().parseFromString(await res.text(), 'application/xml');
  }
  function rssItems(xml, extra) {
    return [...xml.getElementsByTagName('item')].map(it => {
      const get = tag => (it.getElementsByTagName(tag)[0] || {}).textContent || '';
      return { id: get('guid') || get('link'), title: get('title').trim(), link: get('link').trim(), date: Date.parse(get('pubDate')) || 0, ...extra(get) };
    });
  }
  async function fetchSource(s, force) {
    const src = SOURCES[s];
    if (feedState[s] === 'loading') return;
    if (!force && feeds[s] && Date.now() - feeds[s].at < FEED_TTL) return;
    feedState[s] = 'loading';
    if (!feeds[s]) refreshFeedSlots();
    try {
      const items = (await src.load()).map(i => ({ desc: '', text: '', ...i })).filter(i => i.title && src.link.test(i.link));
      if (!items.length) throw new Error('empty');
      feeds[s] = { at: Date.now(), items };
      try { localStorage.setItem(src.key, JSON.stringify(feeds[s])); } catch (e) { /* 容量不足でも表示は続ける */ }
      feedState[s] = 'idle';
    } catch (e) { feedState[s] = 'error'; }
    refreshFeedSlots();
  }
  const fetchFeed = (force = false) => SRC_IDS.forEach(s => fetchSource(s, force));

  // 記事と用語を結びつけるとき、日常語に近い別名は使わない
  const COMMON_WORDS = new Set(['コスト', 'ドメイン', 'インプット', 'アウトプット', 'リーダーシップ', 'クラウド', 'ログイン', 'データベース', '要件', '定例', 'エージェント', 'プロダクト', 'プライス', 'プレイス', 'プロモーション', '4C', '資産', '負債', '純資産', '整理', '整頓', '清掃', '清潔', 'しつけ', '自己実現', 'リピート', '導入期', '成長期', '成熟期', '衰退期', '共通目的', 'コミュニケーション', '人工物', '移行', '解凍', 'シナジー', '顧客', '競合', '自社', '差別化戦略', '回収期間', '割引率', '現在価値', '発注費', '保管費', '在庫管理']);
  const interests = () => (S.interests && S.interests.length ? S.interests : DEFAULT_INTERESTS);
  function scoreItem(it) {
    let sc = 0;
    const hits = [];
    for (const k of interests()) {
      const inTitle = it.title.includes(k), inDesc = it.desc.includes(k), n = Math.min(3, it.text.split(k).length - 1);
      if (inTitle || inDesc || n) { hits.push(k); sc += (inTitle ? 3 : 0) + (inDesc ? 2 : 0) + n; }
    }
    const body = `${it.title}\n${it.text}`;
    const terms = PM_GLOSSARY.concat(GLOSSARY).filter(t => [t.t, ...(t.y || [])].some(k => k.length >= 3 && !COMMON_WORDS.has(k) && body.includes(k))).slice(0, 3);
    sc += terms.length * 1.5;
    if (it.likes) sc += Math.min(4, Math.log10(it.likes + 1) * 2); // たくさん読まれている記事を少しだけ優先
    sc += Math.max(0, 4 - (Date.now() - it.date) / 864e5 / 14); // 新しい記事を少しだけ優先
    return { sc, hits, terms };
  }
  function keyLines(it, hits) {
    const sents = it.text.split(/\n|(?<=。)/).map(s => s.trim()).filter(s => s.length >= 25 && s.length <= 110 && !it.desc.includes(s));
    const withHit = sents.filter(s => hits.some(k => s.includes(k)));
    return (withHit.length ? withHit : sents).slice(0, 2);
  }
  function recommended(s) {
    if (!feeds[s]) return [];
    const read = S.read || {};
    return feeds[s].items.filter(i => !read[i.id]).map(i => ({ ...i, src: s, ...scoreItem(i) })).sort((a, b) => b.sc - a.sc);
  }
  const lensOf = s => pickDaily(SOURCES[s].lens, `lens-${s}`);
  const articlePrompt = it => {
    const src = SOURCES[it.src];
    return `${src.about}の記事「${it.title}」について教えてください。\nURL：${it.link}\n\n${it.desc ? `概要：${it.desc}\n\n` : ''}${it.text ? `本文の冒頭：\n${it.text.slice(0, 900)}\n\n` : '本文はURLから読んでください。\n\n'}読む前に立てた問い：${lensOf(it.src)}\n\n次の4つを、平易な日本語でお願いします。\n1. 3行の要約\n2. 上の問いへの、記事から読み取れる答え\n3. これから大企業のシステム・生成AI案件のプロジェクトマネージャーになるWebディレクター（中小企業診断士も勉強中）が、仕事に活かせる示唆を3つ\n4. 理解を確かめる問いを2つ（答えは書かずに。私が答えたら採点してください）`;
  };
  // その日に読んだ記事（積み上げの記録）をまとめて、共通点を考える
  const readToday = () => S.wins.filter(w => w.date === ymd() && w.key && w.key.startsWith('read:'));
  const linkPrompt = list => `今日、次の${list.length}本を読みました。\n\n${list.map((w, i) => `${i + 1}. ${w.text}`).join('\n')}\n\n次の3つを、平易な日本語でお願いします。\n1. ${list.length}本に共通する考え方を1つ\n2. 食い違っている点があれば1つ\n3. 明日の仕事や学習で試せる行動を1つ。いつ・どこで・何をするかまで`;
  function articleCard(it, { compact = false } = {}) {
    const d = new Date(it.date);
    const reason = [
      it.hits.length ? `「${it.hits.slice(0, 3).join('」「')}」に関係` : '',
      it.terms.length ? `用語「${it.terms.map(t => t.t).join('」「')}」とつながる` : '',
    ].filter(Boolean).join('。');
    const lines = compact ? [] : keyLines(it, it.hits);
    return `<article class="article">
      <p class="article-date">${d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}年` : ''}${d.getMonth() + 1}月${d.getDate()}日</p>
      <h3 class="article-title"><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
      ${it.desc ? `<p class="article-desc">${esc(it.desc)}</p>` : ''}
      ${lines.length ? `<ul class="article-lines">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      ${reason ? `<p class="article-why">おすすめの理由：${esc(reason)}</p>` : ''}
      <p class="article-lens"><small>読む前の問い</small>${esc(lensOf(it.src))}</p>
      ${!compact && it.terms.length ? `<div class="row">${it.terms.map(t => `<button class="chip" data-act="show-term" data-id="${esc(t.id)}">${esc(t.t)}</button>`).join('')}</div>` : ''}
      <form class="form form-inline art-take" data-form="art-read" data-id="${esc(it.id)}">
        <input name="take" maxlength="120" placeholder="学びを1行で（なくても記録できます）" aria-label="「${esc(it.title)}」から学んだこと">
        <button class="btn">読んだ</button>
      </form>
      <div class="term-acts">
        <button class="btn-line" data-act="art-idea" data-id="${esc(it.id)}">noteのネタにする</button>
        <a class="link" href="${claudeUrl(articlePrompt(it))}" target="_blank" rel="noopener">Claudeで要約と確認問題</a>
        ${compact ? '' : `<button class="btn-icon" data-act="art-skip" data-id="${esc(it.id)}">今回は見送る</button>`}
      </div></article>`;
  }
  function feedSlotHtml(mode, s = 'pmbok') {
    const feed = feeds[s], name = SOURCES[s].name;
    if (!feed) {
      return feedState[s] === 'error'
        ? `<p class="empty">${esc(name)} の記事を読み込めませんでした。電波のよい場所で、もう一度読み込んでください。</p><div class="term-acts"><button class="btn-line" data-act="feed-retry">もう一度読み込む</button></div>`
        : `<p class="empty">${esc(name)} の記事を読み込んでいます。</p>`;
    }
    const recs = recommended(s);
    if (!recs.length) return `<p class="empty">${esc(name)} の記事はすべて読みました。新しい記事が出たら、ここに表示します。</p>`;
    if (mode === 'today') return articleCard(recs[0], { compact: true });
    const at = new Date(feed.at);
    return `${recs.slice(0, 6).map(it => `<div class="card hs-l">${articleCard(it)}</div>`).join('')}
      <div class="card hs-s feed-foot-card"><p class="meta">${feedState[s] === 'error' ? '最新の記事を読み込めなかったため、前回の内容を表示しています。' : ''}
        記事一覧の更新：${at.getMonth() + 1}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}</p>
        <button class="btn-line" data-act="feed-retry">いま更新する</button></div>`;
  }
  // きょうの画面：3つの読み物から1本ずつ。2本以上読んだら、つなげて考えるリンクを出す
  // 横にスライドする帯。PCでは左右の矢印でも動かせる
  const bandHtml = (title, inner, sub = '') => `<section class="band">
      <div class="band-head"><h2 class="band-title">${title}</h2><span class="hand-note" aria-hidden="true">swipe →</span>${sub ? `<p class="band-sub">${sub}</p>` : ''}
        <div class="band-nav"><button class="round-mini" data-act="hs" data-dir="-1" aria-label="前へ">‹</button><button class="round-mini" data-act="hs" data-dir="1" aria-label="次へ">›</button></div></div>
      <div class="hscroll">${inner}</div>
    </section>`;
  function todayReadHtml() {
    const done = readToday();
    const sub = done.length >= 2 ? `<a class="link" href="${claudeUrl(linkPrompt(done))}" target="_blank" rel="noopener">今日読んだ${done.length}本をつなげて考える（Claude）</a>`
      : `問いを1つ持って読み、学びを1行残す。今日読んだ記事：${done.length}本`;
    return bandHtml('今日の読みもの', SRC_IDS.map(s => `<section class="card hs-l read-card">
        <p class="read-src">${esc(SOURCES[s].name)}<span>${esc(SOURCES[s].sub)}</span></p>
        <div class="feed-slot" data-mode="today" data-src="${s}">${feedSlotHtml('today', s)}</div></section>`).join(''), sub);
  }
  function refreshFeedSlots() { document.querySelectorAll('.feed-slot').forEach(el => { el.innerHTML = feedSlotHtml(el.dataset.mode, el.dataset.src); }); }
  const feedItem = id => {
    for (const s of SRC_IDS) {
      const it = feeds[s] && feeds[s].items.find(i => i.id === id);
      if (it) return { ...it, src: s };
    }
    return null;
  };

  // ── 部品 ──
  const ICONS = {
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    book: '<path d="M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z"/>',
    news: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    chart: '<path d="M4 17l5-5 4 3 7-8"/><path d="M15 7h5v5"/>',
    stack: '<path d="M5 19h14M7 15h10M6 11h11M8 7h8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 13a8 8 0 0 0 14 4.5l2-2.5"/><path d="M4 4v5h5M20 20v-5h-5"/>',
    box: '<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 8v8l8 4 8-4V8M12 12v8"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
    quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14M12 17.5v.01"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M8 16h2M12 16h2M16 12v4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  };
  const icon = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
  // title・tag は呼び出し側でエスケープ済みの文字列を渡す
  const cardHead = (ic, title, tag = '', extra = '') =>
    `<div class="card-head"><span class="badge">${icon(ic)}</span><div class="card-titles"><h2 class="card-title">${title}</h2>${tag ? `<p class="card-tag">${tag}</p>` : ''}</div>${extra}</div>`;
  // 英語（イタリックのセリフ）と繁体字（明朝）のあしらい。読み上げには不要なので aria-hidden にする
  const deco = (en, zh) => `<span class="zh" aria-hidden="true">${zh}</span><p class="en" aria-hidden="true">${en}</p>`;
  const pageHead = (title, lead = '', en = '', zh = '') => `<header class="page-head">
    ${zh ? `<span class="zh-mark" aria-hidden="true">${zh}</span>` : ''}
    ${en ? `<p class="en-display" aria-hidden="true">${en}</p>` : ''}
    <h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</header>`;

  const countOn = k => S.wins.filter(w => w.date === k).length;
  function weekStrip() {
    const start = parseYmd(weekStart());
    const today = ymd();
    return `<div class="week">${Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const k = ymd(d), n = countOn(k);
      return `<div class="day-pill${k === today ? ' is-today' : ''}${k > today ? ' is-future' : ''}" aria-label="${d.getMonth() + 1}月${d.getDate()}日、${n}件">
        <b>${d.getDate()}</b><span>${WD[d.getDay()]}</span><i class="${n ? 'on' : ''}"></i></div>`;
    }).join('')}</div>`;
  }
  function barsHtml(days = 7) {
    const keys = Array.from({ length: days }, (_, i) => addDays(ymd(), i - days + 1));
    const counts = keys.map(countOn);
    const max = Math.max(3, ...counts);
    return `<div class="bars" role="img" aria-label="直近${days}日の記録：${counts.join('、')}件">${keys.map((k, i) => {
      const n = counts[i], last = i === keys.length - 1;
      return `<div class="bar-col"><div class="bar${last ? ' is-today' : ''}${n ? '' : ' is-zero'}" style="height:${Math.max(18, Math.round(n / max * 100))}%">
        <span>${n || ''}</span></div><p>${last ? '今日' : WD[parseYmd(k).getDay()]}</p></div>`;
    }).join('')}</div>`;
  }
  function gaugeHtml() {
    const keys = Array.from({ length: 14 }, (_, i) => addDays(ymd(), i - 13));
    return `<div class="gauge" aria-hidden="true">${keys.map(k => `<i class="${countOn(k) ? 'on' : ''}"></i>`).join('')}</div>`;
  }

  function taskItem(t) {
    return `<li class="task" data-cat="${t.cat}">
      <button class="check" data-act="task-done" data-id="${t.id}" aria-label="できた：${esc(t.what)}"></button>
      <div class="task-body">
        <p class="task-what">${esc(t.what)}</p>
        ${t.when || t.mini ? `<div class="task-meta">
          ${t.when ? `<span class="task-when">${esc(t.when)}</span>` : ''}
          ${t.mini ? `<button class="mini" data-act="task-mini" data-id="${t.id}" aria-label="5分版だけできた：${esc(t.mini)}">5分版：${esc(t.mini)}</button>` : ''}
        </div>` : ''}
      </div>
      <button class="btn-icon task-del" data-act="task-del" data-id="${t.id}" aria-label="「${esc(t.what)}」を消す">×</button>
    </li>`;
  }

  function taskForm(cat) {
    return `<details class="add"><summary>${icon('plus')}次の1歩を決める</summary>
      <form class="form" data-form="task">
        <label>何を<input name="what" required placeholder="例：WBSの考え方を読んで、過去の案件を1つ分解してみる"></label>
        <label>いつ・どこで<input name="when" placeholder="例：夜9時、リビングの机で"></label>
        <label>5分版（しんどい日はこれだけ）<input name="mini" placeholder="例：用語を1つだけ読む"></label>
        <label>分類<select name="cat">${catOptions(cat)}</select></label>
        <div><button class="btn">決める</button></div>
      </form></details>`;
  }

  function goalRow(cat) {
    const goal = Math.max(1, Number(S.goals[cat]) || 1);
    const n = pubCount(cat);
    const per = cat === 'music' ? '今月' : '今週';
    const unit = cat === 'music' ? '曲' : '本';
    const pct = Math.min(100, Math.round(n / goal * 100));
    return `<div class="goal" data-cat="${cat}">
      <div class="goal-line">
        <span class="goal-name">${CATS[cat]}</span>
        <span class="goal-num${n >= goal ? ' is-done' : ''}">${per} <b>${n}</b> / ${goal}${unit}${n >= goal ? '　目安に届きました' : ''}</span>
        <details class="add goal-add"><summary>${icon('plus')}${cat === 'music' ? '曲' : '記事'}を公開した</summary>
          <form class="form form-inline" data-form="pub" data-cat="${cat}">
            <input name="title" required placeholder="タイトル" aria-label="タイトル"><button class="btn">記録する</button>
          </form></details>
      </div>
      <div class="meter" aria-hidden="true"><i style="width:${pct}%"></i></div>
      ${whyHtml(cat)}
    </div>`;
  }

  function termCard(t, { open = false, quizMode = false } = {}) {
    const acts = `<div class="term-acts">
        <button class="btn" data-act="rev-ok" data-id="${esc(t.id)}"${quizMode ? ' data-quiz' : ''}>わかった</button>
        <button class="btn-line" data-act="rev-ng" data-id="${esc(t.id)}"${quizMode ? ' data-quiz' : ''}>あやしい</button>
        <a class="link" href="${claudeUrl(termPrompt(t.t, domOf(t)))}" target="_blank" rel="noopener">Claudeにもっと聞く</a>
        <a class="link" href="${xUrl(termPost(t))}" target="_blank" rel="noopener" data-act="x-term" data-id="${esc(t.id)}">Xにポスト</a>
        ${t.mine ? `<button class="btn-icon" data-act="term-del" data-id="${esc(t.id)}">この用語を消す</button>` : ''}
      </div>`;
    return `<article class="term${open ? ' is-open' : ''}">
      <p class="term-subj">${esc(t.s)}${t.mine ? '（自分で登録）' : ''}</p>
      <h3 class="term-name">${esc(t.t)}</h3>
      ${t.one ? `<p class="term-one">${esc(t.one)}</p>` : ''}
      <details class="term-more"${open ? ' open' : ''}><summary>解説を読む</summary>
        <p>${escBr(t.body)}</p>
        ${t.tip ? `<h4>${isPm(t) ? '現場のツボ' : '試験のツボ'}</h4><p>${esc(t.tip)}</p>` : ''}
        ${t.work ? `<h4>${isPm(t) ? 'Web制作の経験でいうと' : '仕事でいうと'}</h4><p>${esc(t.work)}</p>` : ''}
      </details>${acts}</article>`;
  }

  // ── 学習時間 ──
  // 主役（PM）の記録のうち、分数つきのものを学習時間として合計する
  const learnFrom = () => (S.learn && S.learn.from) || '';
  const learnGoal = () => Math.max(1, Number(S.learn && S.learn.goal) || 35);
  const learnMin = (from = learnFrom()) => S.wins.filter(w => w.cat === MAIN && w.min && (!from || w.date >= from)).reduce((a, w) => a + w.min, 0);
  const hm = m => (m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`);
  function learnHtml() {
    const m = learnMin(), goal = learnGoal() * 60, wk = learnMin(weekStart());
    const pct = Math.min(100, Math.round(m / goal * 100));
    return `<div class="goal" data-cat="${MAIN}">
      <div class="goal-line"><span class="goal-name">学習時間</span>
        <span class="goal-num${m >= goal ? ' is-done' : ''}"><b>${hm(m)}</b> / ${learnGoal()}時間　今週 ${hm(wk)}</span></div>
      <div class="meter" aria-hidden="true"><i style="width:${pct}%"></i></div>
      <details class="add"><summary>${icon('clock')}学んだ時間を記録する</summary>
        <form class="form form-row learn-row" data-form="learn">
          <input name="what" required placeholder="例：RAGの仕組みを読んだ" aria-label="学んだこと">
          <input name="min" type="number" inputmode="numeric" min="5" step="5" value="30" aria-label="分" required>
          <button class="btn">記録</button>
        </form></details>
    </div>`;
  }

  // ── こころ ──
  const todayJournal = () => (S.journal || []).find(j => j.date === ymd());
  const moodOf = k => (S.mood || {})[k] || {};
  function moodPicker() {
    const m = moodOf(ymd()).m || 0;
    return `<div class="mood-row" role="group" aria-label="今日の気分">${[1, 2, 3, 4, 5].map(v =>
      `<button class="mood${m === v ? ' is-on' : ''}" data-act="mood" data-v="${v}" aria-pressed="${m === v}"><b>${v}</b><span>${MOODS[v]}</span></button>`).join('')}</div>`;
  }
  function moodChart(days = 14) {
    const keys = Array.from({ length: days }, (_, i) => addDays(ymd(), i - days + 1));
    return `<div class="mood-chart" role="img" aria-label="直近${days}日の気分と睡眠">
      ${keys.map((k, i) => { const r = moodOf(k), last = i === keys.length - 1;
        return `<div class="mc-col"><div class="mc-bar m${r.m || 0}" style="height:${r.m ? r.m * 20 : 6}%"></div>
          <p class="mc-sleep">${r.s ? r.s : '·'}</p><p class="mc-day">${last ? '今日' : parseYmd(k).getDate()}</p></div>`; }).join('')}
    </div><p class="meta">棒が気分（1〜5）、下の数字が睡眠時間です。</p>`;
  }
  // 低い気分や短い睡眠が続いたら、ひとりで抱えないよう声をかける（診断ではない）
  function careNote() {
    const keys = Array.from({ length: 14 }, (_, i) => addDays(ymd(), -i));
    const rs = keys.map(moodOf);
    const low = rs.filter(r => r.m && r.m <= 2).length;
    const sl = rs.filter(r => r.s).map(r => r.s);
    const notes = [];
    if (low >= 10) notes.push('この2週間、つらい日が多く続いています。ひとりで抱えずに、家族や信頼できる人に話してみてください。眠れない・気分の落ち込みが続くときは、早めに医療機関や相談窓口に相談してください。');
    if (sl.length >= 7 && sl.reduce((a, b) => a + b, 0) / sl.length < 5.5) notes.push('睡眠が短い日が続いています。学習より睡眠を先に確保して大丈夫です。');
    return notes.map(n => `<p class="alert care">${esc(n)}</p>`).join('');
  }
  function journalForm() {
    const j = todayJournal() || {};
    return `<form class="form" data-form="journal">
      <label>今日できたこと（小さくてよい）<input name="did" value="${esc(j.did || '')}" placeholder="例：引き継ぎ資料を1ページ書いた"></label>
      <label>今日よかったこと<input name="good" value="${esc(j.good || '')}" placeholder="例：夕飯がおいしかった"></label>
      <label>明日の最初の1歩<input name="next" value="${esc(j.next || '')}" placeholder="例：朝、用語を1つ読む"></label>
      <div><button class="btn">${j.id ? '書き直す' : '3行を残す'}</button></div>
    </form>`;
  }
  function worryItem(w) {
    return `<li class="worry">
      <p class="worry-text">${esc(w.text)}</p>
      <div class="worry-acts">
        <details class="add"><summary>自分でできることがある</summary>
          <form class="form form-inline" data-form="worry-can" data-id="${w.id}">
            <input name="action" required placeholder="小さな1歩を1つ" aria-label="自分でできること"><button class="btn">1歩にする</button>
          </form></details>
        <button class="btn-line" data-act="worry-let" data-id="${w.id}">手放す</button>
        <button class="btn-icon" data-act="worry-del" data-id="${w.id}" aria-label="「${esc(w.text)}」を消す">×</button>
      </div></li>`;
  }

  // ── わたし（アイコンと呼び名） ──
  // アイコンは端末の中で小さく縮めてから保存する（公開されるファイルには入らない）
  const profile = () => S.profile || { name: '', avatar: '' };
  const meHtml = (cls = 'me') => {
    const pr = profile();
    return pr.avatar ? `<img class="${cls}" src="${esc(pr.avatar)}" alt="">`
      : `<span class="${cls}" aria-hidden="true">${esc((pr.name || 'M').slice(0, 1))}</span>`;
  };
  function shrinkImage(file, size = 192) {
    return new Promise((ok, ng) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = size;
        const k = Math.max(size / img.width, size / img.height), w = img.width * k, h = img.height * k;
        c.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        URL.revokeObjectURL(img.src);
        ok(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = ng;
      img.src = URL.createObjectURL(file);
    });
  }

  // ── 画面：きょう ──
  function viewToday() {
    const total = S.wins.length;
    const week = winsSince(weekStart());
    const { lines, fact } = encourage();
    const jobTasks = S.tasks.filter(t => !t.done && t.cat === MAIN);
    const subTasks = S.tasks.filter(t => !t.done && t.cat !== MAIN);
    const studied = S.studyDays[ymd()] || 0;
    const word = pickDaily(allTerms().filter(t => t.one), 'word');
    const pmWord = pickDaily(allTerms('pm').filter(t => t.one), 'pmword');
    const tj = todayJournal();
    const wk = c => week.filter(w => (Array.isArray(c) ? c.includes(w.cat) : w.cat === c)).length;
    const last7 = Array.from({ length: 7 }, (_, i) => countOn(addDays(ymd(), -i))).reduce((a, b) => a + b, 0);
    return `
      ${syncReady() && sync.error ? `<p class="alert sync-status is-error" role="status">${esc(syncStatusText())}</p>` : ''}
      <header class="page-head today-head">
        <div class="hello">
          <a href="#/settings" aria-label="わたしの設定">${meHtml()}</a>
          <p class="hello-text"><small>${jpDate()}</small><b><span class="hand">Hello,</span> ${esc(profile().name || 'there')}</b></p>
          <a class="round-btn" href="#/kokoro" aria-label="こころ">${icon('heart')}</a>
        </div>
        <p class="hand-cap">my north star</p>
        ${S.vision ? `<h1 class="vision-text scribble">${esc(S.vision)}</h1>`
          : '<h1 class="vision-text scribble">目指す姿を決めましょう</h1><p class="lead"><a class="link" href="#/settings">設定</a>で目指す姿を書くと、ここに表示されます。</p>'}
      </header>
      ${bandHtml('きょうの様子', `
        <section class="card stat hs-s" data-tone="peach">
          <div class="stat-top"><span class="badge">${icon('stack')}</span><b class="stat-num">${total}</b></div>
          <p class="stat-label">積み上げ</p><p class="stat-sub">直近14日で記録した日</p>
          ${gaugeHtml()}
        </section>
        <section class="card stat hs-s">
          <div class="stat-top"><span class="badge">${icon('chart')}</span><b class="stat-num">${week.length}</b></div>
          <p class="stat-label">今週</p>
          <dl class="stat-list"><dt>PM</dt><dd>${wk(MAIN)}</dd><dt>発信</dt><dd>${wk(['note', 'music'])}</dd><dt>診断士</dt><dd>${wk('study')}</dd></dl>
        </section>
        <section class="card hs-m" data-tone="mint">
          ${cardHead('heart', 'こころ', '気分を1つ選ぶ。寝る前に3行')}
          ${moodPicker()}
          <p class="hand-ja">ちゃんと休むのも、一歩のうち。</p>
          <p class="meta kokoro-foot">${tj ? '今日の3行は書きました。' : '今日の3行はまだです。'}<a class="link" href="#/kokoro">${tj ? '3行を見る' : '3行を書く'}・不安メモへ</a></p>
        </section>
        <section class="card hs-m">
          ${cardHead('chart', 'この7日間', `${last7}件の記録`)}
          ${barsHtml(7)}
        </section>`)}
      <div class="today-grid">
        <div class="col">
          <section class="card" data-tone="coral">
            ${cardHead('target', esc(catLabel(MAIN)), '主役')}
            <p class="hand-cap in-card">one step at a time</p>
            ${whyHtml(MAIN)}
            ${learnHtml()}
            ${pmWord ? `<div class="wod">
              <div class="wod-text"><p class="term-subj">今日のPMの1語</p>
                <p class="wod-name">${esc(pmWord.t)}</p><p class="wod-one">${esc(pmWord.one)}</p></div>
              <div class="wod-acts"><button class="btn-line" data-act="show-term" data-id="${esc(pmWord.id)}">解説</button></div></div>` : ''}
            ${jobTasks.length ? `<ul class="tasks">${jobTasks.map(taskItem).join('')}</ul>`
              : '<p class="empty">次の1歩がまだありません。「いつ・どこで・何を」まで決めておくと、動き出しやすくなります。</p>'}
            ${taskForm(MAIN)}
          </section>
          <section class="card">
            ${cardHead('spark', 'コーチ', '記録した事実をもとに声をかけます')}
            <p class="hand-cap in-card">you're doing fine</p>
            ${weekStrip()}
            <div class="bubbles" aria-label="きょうのことば">
              ${lines.map(l => `<div class="bubble-row"><span class="avatar">${icon('spark')}</span><p class="bubble">${esc(l)}</p></div>`).join('')}
              ${fact ? `<div class="bubble-row"><span class="avatar">${icon('spark')}</span><p class="bubble"><small>思い出してほしい事実</small>${esc(fact)}</p></div>` : ''}
            </div>
          </section>
        </div>
        <div class="col">
          <section class="card" data-tone="yellow">
            ${cardHead('book', '診断士', '1日1語・1問')}
            ${whyHtml('study')}
            ${word ? `<div class="wod">
              <div class="wod-text"><p class="term-subj">今日の1語</p>
                <p class="wod-name">${esc(word.t)}</p><p class="wod-one">${esc(word.one)}</p></div>
              <div class="wod-acts">
                <a class="btn" href="${xUrl(termPost(word))}" target="_blank" rel="noopener" data-act="x-term" data-id="${esc(word.id)}">Xにポスト</a>
                <button class="btn-line" data-act="show-term" data-id="${esc(word.id)}">解説</button>
              </div></div>` : ''}
            <div class="qq-slot" data-d="shindan">${qqHtml()}</div>
            <p class="meta qq-foot">${studied ? `今日は${studied}回ふりかえりました。` : ''}<a class="link" href="#/study">用語さがしと計算ふりかえりへ</a></p>
          </section>
          <section class="card">
            ${cardHead('pen', '発信', '脇役')}
            ${goalRow('note')}${goalRow('music')}
            ${subTasks.length ? `<ul class="tasks">${subTasks.map(taskItem).join('')}</ul>` : ''}
          </section>
        </div>
      </div>
      ${todayReadHtml()}
      <div class="down-wrap">
        <p class="hand-ja">しんどい日は、5分版だけで十分。</p>
        <button class="btn-line" data-act="down">今日はしんどい</button>
      </div>`;
  }

  // ── 画面：発信 ──
  function viewShare() {
    const L = S.links;
    const linkItems = [['note', 'note'], ['youtube', 'YouTube'], ['x', 'X']].filter(([k]) => L[k]);
    const ideaList = cat => {
      const items = S.ideas.filter(i => i.cat === cat);
      const active = items.filter(i => i.stage < STAGES[cat].length - 1);
      const doneN = items.length - active.length;
      return `<h3>${CATS[cat]}</h3>
        ${active.length ? active.map(i => {
          const next = STAGES[cat][i.stage + 1];
          return `<div class="idea" data-cat="${cat}">
            <div class="idea-body"><p class="idea-title">${esc(i.title)}</p><p class="stage">いま：<b>${STAGES[cat][i.stage]}</b></p></div>
            <div class="idea-acts">
              <button class="btn-line" data-act="idea-next" data-id="${i.id}">「${next}」へ</button>
              <button class="btn-icon" data-act="idea-del" data-id="${i.id}" aria-label="「${esc(i.title)}」を消す">×</button>
            </div></div>`;
        }).join('') : '<p class="empty">ネタはまだありません。</p>'}
        ${doneN ? `<p class="meta">公開済み ${doneN}件</p>` : ''}`;
    };
    return `
      ${pageHead('発信', `ネタを書きとめて、公開まで進めます。note は週${S.goals.note}本、音楽は月${S.goals.music}曲が目安です。読みものは左右にスライドして選び、読んだら「読んだ」で積み上げに残します。`)}
      ${SRC_IDS.map(s => `<section class="band">
        <div class="band-head"><h2 class="band-title">${esc(SOURCES[s].name)}</h2><span class="hand-note" aria-hidden="true">swipe →</span><p class="band-sub">${esc(SOURCES[s].sub)}</p>
          <div class="band-nav"><button class="round-mini" data-act="hs" data-dir="-1" aria-label="前へ">‹</button><button class="round-mini" data-act="hs" data-dir="1" aria-label="次へ">›</button></div></div>
        <div class="hscroll feed-slot" data-mode="list" data-src="${s}">${feedSlotHtml('list', s)}</div>
      </section>`).join('')}
      <div class="grid-2">
        <div class="col">
          <section class="card" data-tone="mint">${cardHead('bulb', 'ネタ帳', 'ネタ → 下書き → 公開')}
            <form class="form form-row" data-form="idea">
              <select name="cat" aria-label="分類"><option value="note">note</option><option value="music">音楽</option></select>
              <input name="title" required placeholder="例：〇〇の制作ノート" aria-label="ネタ">
              <button class="btn">追加</button>
            </form>
            <div class="ideas">${ideaList('note')}${ideaList('music')}</div>
          </section>
        </div>
        <div class="col">
          <section class="card">${cardHead('pen', '今週・今月の目安')}${goalRow('note')}${goalRow('music')}</section>
          <section class="card">${cardHead('link', '発信先')}
            ${linkItems.length ? `<p class="links">${linkItems.map(([k, n]) => `<a class="btn-line" href="${esc(L[k])}" target="_blank" rel="noopener">${n}を開く</a>`).join('')}</p>`
              : '<p class="empty">設定でURLを登録すると、ここから開けます。</p>'}
          </section>
        </div>
      </div>`;
  }

  // ── 画面：診断士 ──
  function resultsHtml(q, d = 'shindan') {
    if (!q.trim()) return '';
    const r = search(q, d);
    const subjects = d === 'pm' ? PM_SUBJECTS : SUBJECTS;
    const ask = `<a class="btn" href="${claudeUrl(termPrompt(q.trim(), d))}" target="_blank" rel="noopener">Claudeに解説してもらう</a>`;
    if (!r.length) {
      return `<div class="notfound">
        <p>「${esc(q)}」はまだ辞書にありません。Claudeに聞いて、よければ自分の辞書に登録しておきましょう。</p>
        <div class="row">${ask}</div>
        <details class="add"><summary>${icon('plus')}自分の辞書に登録する</summary>
          <form class="form" data-form="myterm" data-d="${d}">
            <label>用語<input name="t" required value="${esc(q.trim())}"></label>
            <label>${d === 'pm' ? '分野' : '科目'}<select name="s">${subjects.map(s => `<option>${s}</option>`).join('')}</select></label>
            <label>一言でいうと<input name="one" placeholder="例：〇〇とは、〜のこと"></label>
            <label>解説（Claudeの回答を貼り付けても構いません）<textarea name="body" required></textarea></label>
            <div><button class="btn">登録する</button></div>
          </form></details></div>`;
    }
    const [top, ...rest] = r;
    return `${termCard(top, { open: true })}
      ${rest.length ? `<div class="others">ほかの候補<div class="row">${rest.slice(0, 6).map(t =>
        `<button class="chip" data-act="show-term" data-id="${esc(t.id)}">${esc(t.t)}</button>`).join('')}</div></div>` : ''}
      <p class="others">探している言葉と違うときは <a class="link" href="${claudeUrl(termPrompt(q.trim(), d))}" target="_blank" rel="noopener">Claudeに「${esc(q.trim())}」を聞く</a></p>`;
  }

  function quizHtml(d = 'shindan') {
    if (!quiz || quiz.d !== d) return `<button class="btn" data-act="quiz-start" data-d="${d}">10語ふりかえる</button>`;
    if (quiz.i >= quiz.q.length) {
      return `<div class="quiz-card"><p>${quiz.q.length}語ふりかえりました。忘れかけた語から先に出るので、明日も同じボタンを押すだけで大丈夫です。</p>
        <div class="term-acts"><button class="btn" data-act="quiz-start" data-d="${d}">もう10語</button><button class="btn-line" data-act="quiz-end">終える</button></div></div>`;
    }
    const t = termById(quiz.q[quiz.i]);
    const pos = `<p class="quiz-pos">${quiz.i + 1} / ${quiz.q.length}</p>`;
    if (quiz.shown) return `<div class="quiz-card">${pos}${termCard(t, { open: true, quizMode: true })}</div>`;
    return `<div class="quiz-card">${pos}
      <p class="term-subj">${esc(t.s)}</p><h3 class="term-name">${esc(t.t)}</h3>
      <p class="meta">どんな意味か、頭の中で説明してから開きます。</p>
      <div class="term-acts"><button class="btn" data-act="quiz-show">解説を見る</button></div></div>`;
  }

  function fmt(v) {
    if (typeof v === 'string') return esc(v);
    if (!Number.isFinite(v)) return '—';
    const digits = Math.abs(v) >= 100 ? 1 : 2;
    return v.toLocaleString('ja-JP', { maximumFractionDigits: digits });
  }
  function calcOut(f, vals) {
    let out;
    try { out = f.calc(vals); } catch (e) { return '<dt>数字を確かめてください</dt><dd></dd>'; }
    return out.map(o => `<dt class="${o.main ? 'main' : ''}">${esc(o.l)}</dt><dd class="${o.main ? 'main' : ''}">${fmt(o.v)} ${esc(o.u)}</dd>`).join('');
  }
  function formulaHtml(f) {
    const defs = Object.fromEntries(f.inputs.map(i => [i.k, i.def]));
    return `<details class="formula" data-f="${f.id}"><summary><span>${esc(f.name)}</span><span class="f-subj">${esc(f.s)}</span></summary>
      <div class="f-body"><p>${esc(f.what)}</p><pre class="f-expr">${esc(f.expr)}</pre>
        <div class="f-inputs">${f.inputs.map(i => `<label>${esc(i.label)}<span class="unit-wrap">
          <input type="number" inputmode="decimal" step="any" name="${i.k}" value="${i.def}">
          <span class="unit">${esc(i.unit)}</span></span></label>`).join('')}</div>
        <dl class="f-out">${calcOut(f, defs)}</dl>
        ${f.tip ? `<p class="f-tip">${esc(f.tip)}</p>` : ''}</div></details>`;
  }

  function studyView(d = 'shindan') {
    const pm = d === 'pm';
    const terms = allTerms(d);
    const seen = terms.filter(t => S.study[t.id]).length;
    const days = pm ? (S.pmDays || {}) : S.studyDays;
    const bySubj = (pm ? PM_SUBJECTS : SUBJECTS).map(s => [s, terms.filter(t => t.s === s)]).filter(([, ts]) => ts.length);
    return `
      ${pm ? pageHead('PM学習', 'PMBOK（第8版）を軸に、プロジェクトマネジメント・生成AIの導入・システムとクラウドの言葉を学びます。入社までに、エンジニアやお客様と同じ言葉で話せるようにします。', 'PM Room', '進')
        : pageHead('診断士', '本で読んだ言葉を入れると、解説が出ます。1日1語でも積み上がります。', 'Study Room', '學')}
      <form class="search" data-form="search" data-d="${d}" role="search">
        <span class="search-icon">${icon('search')}</span>
        <input id="q" type="search" name="q" data-d="${d}" value="${esc(searchQ[d])}" placeholder="${pm ? '例：PMBOK、テーラリング、WBS、RAG' : '例：コア・コンピタンス、損益分岐点'}" aria-label="調べる言葉" autocomplete="off">
        <button class="btn">調べる</button>
      </form>
      <div id="results" class="card">${resultsHtml(searchQ[d], d)}</div>
      <div class="grid-2">
        <div class="col">
          ${pm ? pmbokMapHtml() : ''}
          ${pm ? `<section class="card" data-tone="coral">${deco('Study Time', '時')}${cardHead('clock', '入社までの学習', '学んだ時間を記録すると、ここと「きょう」に積み上がります')}${learnHtml()}</section>` : ''}
          <section class="card" data-tone="yellow">${deco('Quick Quiz', '問')}${cardHead('quiz', 'ちょっと1問', pm ? '用語当て。間違えた用語は明日もう一度' : '用語当て・○×・暗算。間違えた問題は明日もう一度')}
            <div class="qq-slot" data-d="${d}">${qqHtml(d)}</div>
          </section>
          <section class="card" data-tone="mint">${deco('Review', '復')}${cardHead('book', '用語ふりかえり', `ふりかえった語 ${seen} / ${terms.length}　今日 ${days[ymd()] || 0}回　復習待ち ${dueTerms(d).length}語`)}
            <div class="meter" aria-hidden="true"><i style="width:${Math.round(seen / terms.length * 100)}%"></i></div>
            <div id="quiz">${quizHtml(d)}</div>
          </section>
          ${pm ? '' : glossaryCard(bySubj)}
        </div>
        <div class="col">
          ${pm ? glossaryCard(bySubj, true) : `<section class="card" data-tone="peach">${deco('Numbers', '算')}${cardHead('calc', '計算ふりかえり', '数字を変えると、その場で答えが変わります。本の例題の答え合わせにも')}
            ${FORMULAS.map(formulaHtml).join('')}
          </section>`}
        </div>
      </div>`;
  }
  // PMBOK第8版の全体像。チップを押すと、その考え方に近い用語の解説を開く
  const PMBOK_MAP = [
    ['6つの原則', [['全体を見る', 'pmbok-holistic'], ['価値に焦点', 'pmbok-value'], ['品質を組み込む', 'pmbok-quality'], ['責任あるリーダー', 'pmbok-leader'], ['持続可能性', 'pmbok-sustain'], ['力を発揮できる文化', 'pmbok-culture']]],
    ['7つのパフォーマンス領域', [['ガバナンス', 'pmbok-governance'], ['スコープ', 'pm-scope'], ['スケジュール', 'pm-cp'], ['ファイナンス', 'pmbok-finance'], ['ステークホルダー', 'pm-stake'], ['資源', 'pm-raci'], ['リスク', 'pm-risk']]],
    ['5つのフォーカスエリア', [['立ち上げ', 'pmbok-charter'], ['計画', 'pm-wbs'], ['実行', 'pm-meeting'], ['監視とコントロール', 'pmbok-evm'], ['終結', 'pm-cutover']]],
  ];
  const pmbokMapHtml = () => `<section class="card" data-tone="sky">${deco('PMBOK Map', '地')}${cardHead('flag', 'PMBOK第8版の地図', '2025年11月発行。6つの原則・7つのパフォーマンス領域・5つのフォーカスエリア・約40のプロセス')}
      ${PMBOK_MAP.map(([h, items]) => `<p class="map-head">${esc(h)}</p><div class="row">${items.map(([label, id]) =>
        `<button class="chip${S.study[id] ? ' is-seen' : ''}" data-act="show-term" data-id="${id}">${esc(label)}</button>`).join('')}</div>`).join('')}
      <p class="meta map-foot"><button class="btn-quiet" data-act="show-term" data-id="pmbok-guide">PMBOKガイドとは（版ごとの違い）</button></p>
    </section>`;
  const glossaryCard = (bySubj, open = false) => `<section class="card glossary-list" data-tone="lavender">${deco('Glossary', '詞')}${cardHead('list', '用語一覧')}
      ${bySubj.map(([s, ts]) => `<details${open ? ' open' : ''}><summary>${esc(s)}（${ts.length}）</summary><div class="row">
        ${ts.map(t => `<button class="chip${S.study[t.id] ? ' is-seen' : ''}" data-act="show-term" data-id="${esc(t.id)}">${esc(t.t)}</button>`).join('')}
      </div></details>`).join('')}
    </section>`;

  // ── 画面：こころ ──
  function viewKokoro() {
    const ws = S.worries || [];
    const open = ws.filter(w => !w.kind).slice().reverse();
    const sorted = ws.filter(w => w.kind && w.date >= addDays(ymd(), -13)).slice().reverse();
    const recent = (S.journal || []).filter(j => j.date !== ymd()).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7);
    const sl = moodOf(ymd()).s;
    return `
      ${pageHead('こころ', '不安は消そうとしなくて大丈夫です。書き出して、分けて、小さな1歩に変えます。', 'Heart', '心')}
      ${careNote()}
      <section class="card mindful-card">
        <img class="mindful-img" src="mindful.jpg" alt="ごちゃごちゃに絡まった線の頭（MIND FULL）と、ひとつの円に整った頭（MINDFUL）の手描きの絵">
        <div class="mindful-text">
          <p class="hand-cap big">mind full → mindful</p>
          <p class="hand-ja big">頭の中がいっぱいのときは、<br>書き出して、分けて、整える。</p>
          <p class="meta">不安メモに1行書く → 「自分でできること」と「手放すこと」に分ける → 小さな1歩にする。</p>
        </div>
      </section>
      <div class="grid-2">
        <div class="col">
          <section class="card" data-tone="mint">${deco('Mood &amp; Sleep', '眠')}${cardHead('moon', '気分と睡眠', '1日1回、気分を選び、ゆうべの睡眠時間を入れる')}
            ${moodPicker()}
            <form class="form form-inline sleep-row" data-form="sleep">
              <label class="meta" for="sleep-h">ゆうべの睡眠</label>
              <input id="sleep-h" name="h" type="number" inputmode="decimal" min="0" max="16" step="0.5" value="${sl || ''}" placeholder="時間">
              <button class="btn">記録</button>
            </form>
            ${moodChart(14)}
          </section>
          <section class="card" data-tone="olive">${deco('Three Lines', '記')}${cardHead('pen', '毎日の3行', '寝る前の3分。意識を「今日起きた事実」に戻します')}
            ${journalForm()}
            ${recent.length ? `<details class="journal-past"><summary>これまでの3行（${recent.length}日分）</summary>
              ${recent.map(j => `<div class="journal"><h3>${jpDate(parseYmd(j.date))}</h3><ul>
                ${j.did ? `<li><span>できた</span>${esc(j.did)}</li>` : ''}${j.good ? `<li><span>よかった</span>${esc(j.good)}</li>` : ''}${j.next ? `<li><span>次の1歩</span>${esc(j.next)}</li>` : ''}
              </ul></div>`).join('')}</details>` : ''}
          </section>
        </div>
        <div class="col">
          <section class="card" data-tone="lavender">${deco('Worry Notes', '分')}${cardHead('bulb', '不安メモ', '浮かんだら1行。あとで「自分でできること」と「手放すこと」に分けます')}
            <form class="form form-inline" data-form="worry">
              <input name="text" required placeholder="例：システムの話についていけるか" aria-label="不安"><button class="btn">書く</button>
            </form>
            ${open.length ? `<p class="meta worry-head">まだ分けていない不安 ${open.length}件</p><ul class="worries">${open.map(worryItem).join('')}</ul>`
              : '<p class="empty">分けていない不安はありません。</p>'}
            ${sorted.length ? `<details class="worry-done"><summary>この2週間で分けた不安（${sorted.length}件）</summary><ul>
              ${sorted.map(w => `<li><span class="tag ${w.kind}">${w.kind === 'can' ? '1歩にした' : '手放した'}</span>${esc(w.text)}${w.action ? `<small>→ ${esc(w.action)}</small>` : ''}</li>`).join('')}
            </ul></details>` : ''}
          </section>
          <section class="card" data-tone="sand">${deco('Support', '支')}${cardHead('user', '支えになること')}
            <ul class="care-list">
              <li>睡眠を、学習より先に確保する</li>
              <li>1日10分歩く</li>
              <li>日曜に15分、今週の積み上げを見て、不安を分ける</li>
              <li>家族に、今の不安と入社後の線（時間・家庭の時間）を話しておく</li>
            </ul>
            <div class="row"><button class="btn-line" data-act="kokoro-week">今週の振り返りをClaudeと</button><button class="btn-line" data-act="down">今日はしんどい</button></div>
          </section>
        </div>
      </div>`;
  }

  // ── 画面：積み上げ ──
  function viewLog() {
    const week = winsSince(weekStart());
    const counts = Object.keys(CATS).map(c => [c, week.filter(w => w.cat === c).length]).filter(([, n]) => n);
    const byDay = {};
    S.wins.slice().reverse().forEach(w => { (byDay[w.date] = byDay[w.date] || []).push(w); });
    return `
      ${pageHead('積み上げ', 'できたことを1行で残します。小さなことほど書いておく価値があります。', 'Records', '積')}
      <div class="grid-2">
        <div class="col">
          <section class="card" data-tone="peach">${deco('Record', '記')}${cardHead('plus', 'できたことを記録する')}
            <form class="form" data-form="win">
              <input name="text" required placeholder="例：引き継ぎの一覧を作った" aria-label="できたこと">
              <div class="row"><select name="cat" aria-label="分類" style="width:auto">${catOptions(MAIN)}</select><button class="btn">記録する</button></div>
            </form>
          </section>
          <section class="card" data-tone="pink">${deco('This Week', '週')}${cardHead('chart', `今週 ${week.length}件`, '直近14日の記録')}
            ${barsHtml(14)}
            ${counts.length ? `<p class="week-sum">${counts.map(([c, n]) => `<span data-cat="${c}">${esc(catLabel(c))} ${n}</span>`).join('')}</p>` : '<p class="empty">今週の記録はまだありません。</p>'}
          </section>
        </div>
        <div class="col">
          <section class="card">${deco('All Records', '積')}${cardHead('stack', `これまで ${S.wins.length}件`)}
            ${Object.keys(byDay).length ? Object.entries(byDay).map(([d, ws]) => `<div class="day"><h3>${jpDate(parseYmd(d))}</h3>
              ${ws.map(w => `<div class="win" data-cat="${w.cat}"><p><span class="win-cat">${esc(catLabel(w.cat))}</span>${esc(w.text)}</p>
                <button class="btn-icon" data-act="win-del" data-id="${w.id}" aria-label="「${esc(w.text)}」を消す">×</button></div>`).join('')}</div>`).join('')
              : '<p class="empty">最初の1件を記録しましょう。</p>'}
          </section>
        </div>
      </div>`;
  }

  // ── 画面：設定 ──
  function viewSettings() {
    return `
      ${pageHead('設定', 'わたし、同期、目指す姿、表示などを変えられます。', 'Settings', '設')}
      <div class="grid-2">
        <div class="col">
          <section class="card" id="me">${cardHead('user', 'わたし', '「きょう」のあいさつに使います。画像はこの端末と同期先にだけ保存されます')}
            <div class="profile-row">${meHtml()}
              <div class="row">
                <label class="btn-line">画像を選ぶ<input type="file" accept="image/*" data-act="avatar" hidden></label>
                ${profile().avatar ? '<button type="button" class="btn-quiet" data-act="avatar-del">画像を外す</button>' : ''}
              </div></div>
          </section>
          <section class="card" id="sync" data-tone="sky">${deco('Sync', '同')}${cardHead('sync', 'PCとスマホの同期', 'GitHub の非公開リポジトリに、合言葉で暗号化して保存します')}
            <form class="form" data-form="sync" autocomplete="off">
              <label>GitHub のユーザー名<input name="owner" value="${esc(sync.owner || '')}" autocapitalize="off" spellcheck="false" placeholder="例：oogaiMakito"></label>
              <label>保存用のリポジトリ名（非公開）<input name="repo" value="${esc(sync.repo || 'tsumiage-data')}" autocapitalize="off" spellcheck="false"></label>
              <div class="pair">
                <label>アクセストークン<input name="token" type="password" value="${esc(sync.token || '')}" autocapitalize="off" spellcheck="false" placeholder="github_pat_…"></label>
                <label>合言葉<input name="pass" type="password" value="${esc(sync.pass || '')}" autocapitalize="off"></label>
              </div>
              <div class="row"><button class="btn">保存して同期する</button>
                ${syncReady() ? '<button type="button" class="btn-line" data-act="sync-now">いま同期する</button><button type="button" class="btn-quiet" data-act="sync-off">この端末の同期をやめる</button>' : ''}</div>
              <p class="meta sync-status" role="status">${esc(syncStatusText())}</p>
            </form>
          </section>
          <form class="col" data-form="settings">
          <section class="card" data-tone="olive">${deco('Destination', '志')}${cardHead('target', '目指す姿と呼び名', '「きょう」の一番上と、各項目の下に表示されます')}
            <div class="form">
              <label>呼び名（あいさつに表示）<input name="pName" value="${esc(profile().name)}" placeholder="例：Makito"></label>
              <label>目指す姿（北極星）<textarea name="vision" rows="3">${esc(S.vision)}</textarea></label>
              <label>${esc(catLabel(MAIN))}は、目的地にどうつながるか<input name="whyPm" value="${esc(why(MAIN))}"></label>
              <label>note は<input name="whyNote" value="${esc(why('note'))}"></label>
              <label>音楽は<input name="whyMusic" value="${esc(why('music'))}"></label>
              <label>診断士は<input name="whyStudy" value="${esc(why('study'))}"></label>
            </div>
          </section>
          <section class="card" data-tone="coral">${deco('My Facts', '實')}${cardHead('user', 'わたしの事実', '経歴や実績を1行に1つ。コーチの言葉やしんどい日に使います')}
            <div class="form"><textarea name="facts" rows="8" aria-label="わたしの事実" placeholder="例：〇〇の案件で、△△を□□まで改善した">${esc(S.facts.join('\n'))}</textarea></div>
          </section>
          <section class="card" data-tone="yellow">${deco('Roles', '役')}${cardHead('flag', '主役と目安')}
            <div class="form">
              <label>主役の名前<input name="mainLabel" value="${esc(S.mainLabel)}"></label>
              <div class="pair">
                <label>note（週に何本）<input type="number" min="1" name="gNote" value="${S.goals.note}"></label>
                <label>音楽（月に何曲）<input type="number" min="1" name="gMusic" value="${S.goals.music}"></label>
              </div>
              <div class="pair">
                <label>学習の目標（時間）<input type="number" min="1" name="lGoal" value="${learnGoal()}"></label>
                <label>学習を数え始める日<input type="date" name="lFrom" value="${esc(learnFrom())}"></label>
              </div>
            </div>
          </section>
          <section class="card" data-tone="sand">${deco('Interests', '趣')}${cardHead('news', '読みもの', 'おすすめ順に使うキーワード（読点で区切る）')}
            <div class="form"><input name="interests" aria-label="気になるキーワード" value="${esc(interests().join('、'))}"></div>
          </section>
          <section class="card" data-tone="mint">${deco('Channels', '連')}${cardHead('link', '発信先')}
            <div class="form">
              <label>note のURL<input type="url" name="lNote" value="${esc(S.links.note)}"></label>
              <label>YouTube のURL<input type="url" name="lYoutube" value="${esc(S.links.youtube)}"></label>
              <label>X のURL<input type="url" name="lX" value="${esc(S.links.x)}"></label>
            </div>
          </section>
          <div class="save-row"><button class="btn">設定を保存する</button></div>
          </form>
        </div>
        <div class="col">
          <section class="card">${deco('Backup', '存')}${cardHead('box', 'バックアップ', 'ファイルに書き出して、別の端末で読み込めます')}
            <div class="row">
              <button class="btn" data-act="export">書き出す</button>
              <label class="btn-line">読み込む<input type="file" accept="application/json,.json" data-act="import" hidden></label>
            </div>
          </section>
          <section class="card">${deco('Display', '光')}${cardHead('sun', '表示')}
            <div class="row">
              <button class="btn-line" data-act="theme" data-v="">端末に合わせる</button>
              <button class="btn-line" data-act="theme" data-v="light">ライト</button>
              <button class="btn-line" data-act="theme" data-v="dark">ダーク</button>
            </div>
          </section>
          <section class="card">${deco('Reset', '消')}${cardHead('trash', 'すべて消す', 'この端末のデータを消します。先に書き出しておくと安心です')}
            <button class="btn-line danger" data-act="reset">この端末のデータを消す</button>
          </section>
                </div>
      </div>`;
  }

  // ── しんどい日 ──
  function openDown() {
    const dlg = $('#down');
    const facts = shuffle(S.facts).slice(0, 3);
    const recent = S.wins.slice(-3).reverse();
    dlg.innerHTML = `
      <p class="en" aria-hidden="true">It&rsquo;s okay. One step at a time.</p>
      <h2 id="down-title">今日は、立て直す日にします。</h2>
      ${S.vision ? `<p class="meta" style="margin-top:6px">目的地：${esc(S.vision)}</p>` : ''}
      <p class="intro">うまくいかなかったことは、あなたの価値の採点ではありません。今日やることは1つだけ。小さくて構いません。</p>
      <h3>これまでの事実</h3>
      ${facts.length ? `<ul class="facts">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`
        : '<p class="meta">設定の「わたしの事実」に経歴や実績を書いておくと、ここに表示されます。</p>'}
      ${recent.length ? `<h3>最近の積み上げ</h3><ul>${recent.map(w => `<li>・${esc(w.text)}</li>`).join('')}</ul>` : ''}
      <h3>今日の1つを選ぶ</h3>
      <div class="tiny">${TINY.map(t => `<button class="btn-line" data-act="tiny" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <h3>話を聞いてほしいとき</h3>
      <label class="meta" for="down-text">いまの気持ち（書かなくても大丈夫です）</label>
      <textarea id="down-text" rows="3"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn-line" data-act="down-claude">Claudeに話を聞いてもらう</button></div>
      <div class="close-row"><button class="btn" data-act="down-close">閉じる</button></div>`;
    dlg.showModal();
  }

  // ── 描画 ──
  const VIEWS = { today: viewToday, share: viewShare, pm: () => studyView('pm'), study: () => studyView('shindan'), kokoro: viewKokoro, log: viewLog, settings: viewSettings };
  const route = () => { const r = location.hash.replace(/^#\/?/, ''); return VIEWS[r] ? r : 'today'; };
  function render(routeChanged = false) {
    const y = window.scrollY;
    const v = route();
    $('#main').innerHTML = VIEWS[v]();
    $('#main').dataset.view = v;
    document.querySelectorAll('[data-view]').forEach(a => {
      if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (routeChanged) { window.scrollTo(0, 0); $('#main').focus({ preventScroll: true }); }
    else window.scrollTo(0, y);
    if (v === 'today' || v === 'share') fetchFeed();
  }

  // 入力中に同期で画面が書き換わらないよう、入力が終わるまで待つ
  let pendingRender = false;
  const typing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'file'; };
  function softRender() { if (typing()) { pendingRender = true; return; } render(); }
  document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !typing()) { pendingRender = false; render(); } }, 300));

  // ── 操作 ──
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case 'task-done': {
        const t = S.tasks.find(x => x.id === id); if (!t) return;
        t.done = true; t.doneAt = ymd(); t.u = Date.now(); addWin(t.cat, t.what); render(); break;
      }
      case 'task-mini': {
        const t = S.tasks.find(x => x.id === id); if (!t) return;
        addWin(t.cat, `5分版：${t.mini}（${t.what}）`); render(); break;
      }
      case 'task-del': markDeleted(id); S.tasks = S.tasks.filter(x => x.id !== id); save(); render(); break;
      case 'win-del':
        if (!confirm('この記録を消しますか？')) return;
        markDeleted(id); S.wins = S.wins.filter(x => x.id !== id); save(); render(); break;
      case 'idea-next': {
        const i = S.ideas.find(x => x.id === id); if (!i) return;
        i.stage += 1; i.u = Date.now();
        const last = i.stage === STAGES[i.cat].length - 1;
        if (last) addWin(i.cat, `「${i.title}」を公開した`, { pub: true });
        else addWin(i.cat, `「${i.title}」を${STAGES[i.cat][i.stage]}まで進めた`);
        render(); break;
      }
      case 'idea-del': markDeleted(id); S.ideas = S.ideas.filter(x => x.id !== id); save(); render(); break;
      case 'rev-ok': case 'rev-ng':
        review(id, el.dataset.act === 'rev-ok');
        if ('quiz' in el.dataset && quiz) { quiz.i += 1; quiz.shown = false; }
        render(); break;
      case 'quiz-start': {
        const d = el.dataset.d || 'shindan';
        const due = shuffle(dueTerms(d));
        const fresh = shuffle(allTerms(d).filter(t => !S.study[t.id]));
        const rest = shuffle(allTerms(d).filter(t => S.study[t.id] && !due.includes(t)));
        quiz = { d, q: [...due, ...fresh, ...rest].slice(0, 10).map(t => t.id), i: 0, shown: false };
        $('#quiz').innerHTML = quizHtml(d); break;
      }
      case 'quiz-show': quiz.shown = true; $('#quiz').innerHTML = quizHtml(quiz.d); break;
      case 'quiz-end': { const d = quiz ? quiz.d : 'shindan'; quiz = null; $('#quiz').innerHTML = quizHtml(d); break; }
      case 'show-term': {
        const t = termById(id); if (!t) return;
        const d = domOf(t), r = d === 'pm' ? 'pm' : 'study';
        searchQ[d] = t.t;
        if (route() !== r) { location.hash = `#/${r}`; return; }
        $('#q').value = searchQ[d]; $('#results').innerHTML = resultsHtml(searchQ[d], d);
        $('#q').scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      }
      case 'term-del': {
        if (!confirm('自分で登録した用語を消しますか？')) return;
        const d = domOf(termById(id));
        markDeleted(id); S.myTerms = S.myTerms.filter(x => x.id !== id); delete S.study[id]; save(); searchQ[d] = ''; render(); break;
      }
      case 'qq-answer': {
        const d = (el.closest('.qq-slot') || {}).dataset?.d || 'shindan';
        const qq = qqs[d];
        if (!qq || qq.picked !== null) return;
        qq.picked = Number(el.dataset.i);
        if (qq.ref) review(qq.ref, qq.picked === qq.answer, true);
        refreshQQ(); break;
      }
      case 'qq-next': { const d = (el.closest('.qq-slot') || {}).dataset?.d || 'shindan'; qqs[d] = nextQuestion(d); refreshQQ(); break; }
      case 'x-term': { // リンクはそのまま開き、積み上げにも残す
        const t = termById(id); if (t) addWin(isPm(t) ? MAIN : 'study', `Xで「${t.t}」を紹介した`); break;
      }
      case 'x-quiz': if (qqs.shindan) addWin('study', `Xで診断士の問題を出題した`); break;
      case 'mood': {
        const v = Number(el.dataset.v), k = ymd(), first = !moodOf(k).m;
        S.mood = { ...S.mood, [k]: { ...moodOf(k), m: v, u: Date.now() } };
        save();
        if (first) toast(v <= 2 ? '記録しました。つらい日は、5分版だけで十分です。' : '記録しました。');
        render(); break;
      }
      case 'worry-let': {
        const w = (S.worries || []).find(x => x.id === id); if (!w) return;
        w.kind = 'let'; w.u = Date.now(); save(); toast('手放しました。考える時間を決めなくて大丈夫です。'); render(); break;
      }
      case 'worry-del': markDeleted(id); S.worries = (S.worries || []).filter(x => x.id !== id); save(); render(); break;
      case 'kokoro-week': {
        const from = weekStart();
        const js = (S.journal || []).filter(j => j.date >= from).map(j => `・${j.date}：できた「${j.did || '-'}」／よかった「${j.good || '-'}」`).join('\n');
        const wsx = (S.worries || []).filter(w => w.date >= from).map(w => `・${w.text}${w.kind === 'can' ? `（1歩：${w.action}）` : w.kind === 'let' ? '（手放した）' : '（まだ分けていない）'}`).join('\n');
        const p = `今週の振り返りを手伝ってください。責めたり、根拠のない励ましをしたりせずに聞いてください。\n\n今週の3行：\n${js || '（なし）'}\n\n今週の不安メモ：\n${wsx || '（なし）'}\n\n次の3つをお願いします。\n1. 今週できていたこと（事実から）\n2. まだ分けていない不安を、「自分でできること」と「手放すこと」に分ける手伝い\n3. 来週の小さな1歩を1つ。いつ・どこで・何をするかまで`;
        window.open(claudeUrl(p), '_blank', 'noopener'); break;
      }
      case 'art-idea': {
        const it = feedItem(id); if (!it) return;
        S.ideas.push({ id: uid(), cat: 'note', title: `「${it.title}」を読んで考えたこと`, stage: 0, created: ymd(), src: it.link, u: Date.now() });
        save(); toast('ネタ帳に追加しました。'); break;
      }
      case 'art-skip': S.read = { ...S.read, [id]: 'skip' }; save(); refreshFeedSlots(); break;
      case 'feed-retry': fetchFeed(true); break;
      case 'sync-now': syncNow({ manual: true }); break;
      case 'sync-off':
        if (!confirm('この端末の同期設定を消します（記録は消えません）。よろしいですか？')) return;
        sync = {}; saveSync(); render(); toast('この端末の同期をやめました。'); break;
      case 'down': openDown(); break;
      case 'hs': {
        const sc = el.closest('.band').querySelector('.hscroll');
        const step = Math.max(240, sc.clientWidth * 0.8);
        sc.scrollBy({ left: Number(el.dataset.dir) * step, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        break;
      }
      case 'down-close': $('#down').close(); break;
      case 'tiny':
        addWin('other', `しんどい日に「${el.dataset.v}」をした`);
        $('#down').close(); render(); break;
      case 'down-claude': {
        const feel = ($('#down-text').value || '').trim();
        const facts = S.facts.slice(0, 5).map(f => `・${f}`).join('\n');
        const p = `今日は気持ちが落ちています。${feel ? `\nいまの気持ち：${feel}` : ''}\n責めたり、根拠のない励ましをしたりせずに、話を聞いてください。そのうえで、次の事実をふまえて、明日の小さな1歩を一緒に決めてください。${facts ? `\n\nわたしの事実：\n${facts}` : ''}`;
        window.open(claudeUrl(p), '_blank', 'noopener'); break;
      }
      case 'export': {
        const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `Mindwalk-${ymd()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast('書き出しました。もう一方の端末で「読み込む」を押してください。'); break;
      }
      case 'theme': {
        const v = el.dataset.v;
        try { if (v) localStorage.setItem('tsumiage.theme', v); else localStorage.removeItem('tsumiage.theme'); } catch (err) { /* 無視 */ }
        applyTheme(); break;
      }
      case 'avatar-del':
        S.profile = { ...profile(), avatar: '' }; S.settingsAt = Date.now(); save(); render(); break;
      case 'reset':
        if (!confirm(syncReady() ? 'この端末のデータを消します。同期を設定しているので、次の同期でほかの端末のデータから戻ります。よろしいですか？' : 'この端末のデータをすべて消します。よろしいですか？')) return;
        S = blank(); save(); render(); toast('消しました。'); break;
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.act === 'avatar' && el.files[0]) {
      shrinkImage(el.files[0]).then(url => {
        S.profile = { ...profile(), avatar: url }; S.settingsAt = Date.now(); save(); render(); toast('アイコンを変えました。');
      }).catch(() => toast('この画像は読み込めませんでした。'));
      el.value = '';
      return;
    }
    if (el.dataset.act !== 'import' || !el.files[0]) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.wins)) throw new Error('形式が違います');
        if (!confirm('読み込んだ内容で、この端末のデータを置き換えます。よろしいですか？')) return;
        S = { ...blank(), ...data, settingsAt: Date.now() }; save(); render(); toast('読み込みました。');
      } catch (err) { toast('読み込めませんでした。「書き出す」で作ったファイルを選んでください。'); }
      el.value = '';
    };
    reader.readAsText(el.files[0]);
  });

  document.addEventListener('submit', e => {
    const f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    switch (f.dataset.form) {
      case 'task':
        S.tasks.push({ id: uid(), cat: d.cat, what: d.what.trim(), when: d.when.trim(), mini: d.mini.trim(), done: false, created: ymd(), u: Date.now() });
        save(); render(); toast('次の1歩を決めました。'); break;
      case 'pub':
        addWin(f.dataset.cat, `「${d.title.trim()}」を公開した`, { pub: true }); render(); break;
      case 'art-read': { // 学びの1行は積み上げの記録に残し、その日の「つなげて考える」にも使う
        const it = feedItem(f.dataset.id); if (!it) return;
        const take = (d.take || '').trim();
        S.read = { ...S.read, [it.id]: ymd() };
        addWin('other', `${SOURCES[it.src].name}「${it.title}」を読んだ${take ? `。学び：${take}` : ''}`, { key: `read:${it.id}` });
        render(); break;
      }
      case 'idea':
        S.ideas.push({ id: uid(), cat: d.cat, title: d.title.trim(), stage: 0, created: ymd(), u: Date.now() });
        save(); render(); toast('ネタ帳に追加しました。'); break;
      case 'win':
        addWin(d.cat, d.text.trim()); render(); break;
      case 'search': {
        const dm = f.dataset.d || 'shindan';
        searchQ[dm] = d.q; $('#results').innerHTML = resultsHtml(searchQ[dm], dm); break;
      }
      case 'myterm': {
        const dm = f.dataset.d || 'shindan';
        S.myTerms.push({ u: Date.now(), id: `my-${uid()}`, d: dm, t: d.t.trim(), s: d.s, one: d.one.trim(), body: d.body.trim(), y: [] });
        save(); searchQ[dm] = d.t.trim(); render(); toast('自分の辞書に登録しました。'); break;
      }
      case 'learn': {
        const min = Math.max(1, Math.round(+d.min || 0));
        addWin(MAIN, `${d.what.trim()}（${hm(min)}）`, { min }); render(); break;
      }
      case 'journal': {
        const did = d.did.trim(), good = d.good.trim(), next = d.next.trim();
        if (!did && !good && !next) { toast('1行だけでも大丈夫です。'); return; }
        const j = todayJournal();
        if (j) Object.assign(j, { did, good, next, u: Date.now() });
        else {
          S.journal = [...(S.journal || []), { id: uid(), date: ymd(), did, good, next, u: Date.now() }];
          S.wins.push({ id: uid(), date: ymd(), ts: Date.now(), cat: 'mind', text: '寝る前の3行を書いた', key: `journal-${ymd()}` });
        }
        save(); toast(next ? `明日の最初の1歩は「${next}」。おやすみなさい。` : '残しました。'); render(); break;
      }
      case 'worry':
        S.worries = [...(S.worries || []), { id: uid(), date: ymd(), text: d.text.trim(), kind: '', u: Date.now() }];
        save(); toast('書き出しました。分けるのは、あとででも大丈夫です。'); render(); break;
      case 'worry-can': {
        const w = (S.worries || []).find(x => x.id === f.dataset.id); if (!w) return;
        const action = d.action.trim();
        Object.assign(w, { kind: 'can', action, u: Date.now() });
        S.tasks.push({ id: uid(), cat: 'mind', what: action, when: '', mini: '', done: false, created: ymd(), u: Date.now() });
        save(); toast('次の1歩にしました。「きょう」に出ます。'); render(); break;
      }
      case 'sleep': {
        const h = Math.round((+d.h || 0) * 2) / 2, k = ymd();
        if (!h) { toast('時間を入れてください。'); return; }
        S.mood = { ...S.mood, [k]: { ...moodOf(k), s: h, u: Date.now() } };
        save(); toast(h < 6 ? '記録しました。今夜は早めに休めるといいですね。' : '記録しました。'); render(); break;
      }
      case 'sync': {
        const next = { owner: d.owner.trim(), repo: d.repo.trim(), token: d.token.trim(), pass: d.pass };
        if (!next.owner || !next.repo || !next.token || !next.pass) { toast('4つの欄をすべて入れてください。'); return; }
        if (next.owner !== sync.owner || next.repo !== sync.repo || next.pass !== sync.pass) { sync = { ...next }; keyCache = null; }
        else sync = { ...sync, ...next };
        saveSync(); render(); syncNow({ manual: true }); break;
      }
      case 'settings':
        S.facts = d.facts.split('\n').map(s => s.trim()).filter(Boolean);
        S.mainLabel = d.mainLabel.trim() || CATS[MAIN];
        S.goals = { note: Math.max(1, +d.gNote || 1), music: Math.max(1, +d.gMusic || 1) };
        S.links = { note: d.lNote.trim(), youtube: d.lYoutube.trim(), x: d.lX.trim() };
        S.settingsAt = Date.now();
        S.vision = d.vision.trim();
        S.profile = { ...profile(), name: (d.pName || '').trim() };
        S.why = { ...S.why, pm: d.whyPm.trim(), note: d.whyNote.trim(), music: d.whyMusic.trim(), study: d.whyStudy.trim() };
        S.learn = { goal: Math.max(1, +d.lGoal || 35), from: d.lFrom || '' };
        S.interests = d.interests.split(/[、,，\s]+/).map(x => x.trim()).filter(Boolean);
        save(); toast('設定を保存しました。'); break;
    }
  });

  let searchTimer;
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'q') {
      const dm = el.dataset.d || 'shindan';
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { searchQ[dm] = el.value; $('#results').innerHTML = resultsHtml(searchQ[dm], dm); }, 200);
      return;
    }
    const box = el.closest('.formula');
    if (box) {
      const f = FORMULAS.find(x => x.id === box.dataset.f);
      const vals = Object.fromEntries([...box.querySelectorAll('input')].map(i => [i.name, parseFloat(i.value)]));
      $('.f-out', box).innerHTML = calcOut(f, vals);
    }
  });

  function applyTheme() {
    let v = '';
    try { v = localStorage.getItem('tsumiage.theme') || ''; } catch (e) { /* 無視 */ }
    if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
  }

  window.addEventListener('hashchange', () => render(true));
  // 日付が変わってから開き直したときに、表示を今日に合わせる
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (route() === 'today') softRender();
    syncNow();
  });
  window.addEventListener('online', () => syncNow());

  applyTheme();
  render(true);
  syncNow();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
