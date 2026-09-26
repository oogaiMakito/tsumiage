'use strict';
(() => {
  const KEY = 'tsumiage.v1';
  const CATS = {
    job: '転職活動', note: 'note', music: '音楽', study: '診断士', other: 'そのほか',
  };
  const STAGES = { note: ['ネタ', '下書き', '公開'], music: ['ネタ', '制作中', '完成・公開'] };
  const INTERVALS = [1, 3, 7, 14, 30, 60];
  const TINY = ['10分だけ外を歩く', '診断士を1問だけ解く', '好きな曲を1曲聴く', '今日は早めに寝る'];
  const MILESTONES = [10, 30, 50, 100, 200, 300, 500, 1000];

  const blank = () => ({
    version: 1,
    mainLabel: '転職活動',
    goals: { note: 1, music: 1 },
    facts: [],
    links: { note: '', youtube: '', x: '' },
    tasks: [], wins: [], ideas: [],
    study: {}, studyDays: {}, myTerms: [],
    interests: [], read: {},
    vision: '', why: { job: '', note: '', music: '', study: '' },
    deleted: {}, settingsAt: 0,
  });

  let S = load();
  let quiz = null;
  let searchQ = '';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { ...blank(), ...JSON.parse(raw) };
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
  const SETTING_KEYS = ['mainLabel', 'goals', 'facts', 'links', 'interests', 'vision', 'why'];
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
      return { ...blank(), ...JSON.parse(td.decode(pt)) };
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
      if (studyWin.has(w.key)) return false; // 同じ日の「ふりかえり」は1件にまとめる
      studyWin.add(w.key);
      return true;
    }).map(w => (w.key && out.studyDays[w.key.slice(6)] ? { ...w, text: `診断士の用語と問題を${out.studyDays[w.key.slice(6)]}回ふりかえった` } : w));
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
  const catOptions = sel => Object.entries(CATS).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${v}</option>`).join('');

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
  const termPost = t => fitX([`【今日の1語｜中小企業診断士】`, `■ ${t.t}`, t.one, t.work ? `仕事でいうと：${t.work}` : ''], '#中小企業診断士 #1日1語');
  const quizPost = q => fitX([`【今日の1問｜中小企業診断士】`, q.q,
    q.choices.length === 2 ? '○か×か？' : q.choices.map((c, i) => `${'ABCD'[i]}. ${c}`).join('\n'), '答えはリプ欄で。'], '#中小企業診断士 #1日1問');
  const why = cat => (S.why && S.why[cat]) || '';
  const whyHtml = cat => (why(cat) ? `<p class="why">目的地へ：${esc(why(cat))}</p>` : '');
  const claudeUrl = prompt => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
  const termPrompt = word => `中小企業診断士の勉強をしています。「${word}」について、次の順で平易な日本語で解説してください。\n1. 一言でいうと\n2. 詳しい解説（提唱者や関連する用語も）\n3. 試験で問われやすいポイント\n4. Webディレクターの仕事に置き換えた例`;

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
    const fact = pickDaily(S.facts, 'fact');
    return { lines, fact };
  }

  // ── 用語 ──
  const allTerms = () => GLOSSARY.concat(S.myTerms.map(t => ({ ...t, mine: true })));
  const termById = id => allTerms().find(t => t.id === id);
  const norm = s => String(s).normalize('NFKC').toLowerCase()
    .replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・･\-‐ー―（）()「」『』、。,.]/g, '');
  function search(q) {
    const n = norm(q);
    if (!n) return [];
    return allTerms().map(t => {
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
  const dueTerms = () => { const today = ymd(); return allTerms().filter(t => S.study[t.id] && S.study[t.id].due <= today); };
  function review(id, ok, silent = false) {
    const r = S.study[id];
    const lv = ok ? (r ? Math.min(r.lv + 1, INTERVALS.length - 1) : 0) : 0;
    const today = ymd();
    S.study[id] = { lv, due: addDays(today, ok ? INTERVALS[lv] : 1), count: (r ? r.count : 0) + 1, last: today };
    const n = (S.studyDays[today] || 0) + 1;
    S.studyDays[today] = n;
    const key = `study-${today}`;
    const text = `診断士の用語と問題を${n}回ふりかえった`;
    const w = S.wins.find(x => x.key === key);
    if (w) w.text = text;
    else { S.wins.push({ id: uid(), date: today, ts: Date.now(), cat: 'study', text, key }); }
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
  function termQuestion() {
    const pool = allTerms().filter(t => t.one);
    const due = dueTerms().filter(t => t.one);
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
  function nextQuestion() {
    const r = Math.random();
    const q = r < 0.45 ? termQuestion() : r < 0.8 ? tfQuestion() : pick(CALC_Q)();
    return { ...q, picked: null };
  }
  let qq = null;
  function qqHtml() {
    if (!qq) qq = nextQuestion();
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
          <a class="btn-line" href="${xUrl(quizPost(qq))}" target="_blank" rel="noopener" data-act="x-quiz">この問題をXで出題</a>
          ${t ? `<button class="btn-line" data-act="show-term" data-id="${esc(t.id)}">「${esc(t.t)}」の解説を見る</button>` : ''}</div>
      </div>` : ''}
    </div>`;
  }
  function refreshQQ() { document.querySelectorAll('.qq-slot').forEach(el => { el.innerHTML = qqHtml(); }); }

  // ── designing のおすすめ ──
  // designing.jp の RSS はブラウザから直接読める（CORS許可あり）。
  // 要約は編集部の概要文と、本文から関心キーワードを含む文を抜き出したもの。AIは使わない。
  const FEED_URL = 'https://designing.jp/feed.xml';
  const FEED_KEY = 'tsumiage.feed';
  const FEED_TTL = 12 * 3600 * 1000;
  const DEFAULT_INTERESTS = ['クリエイティブディレクション', 'ディレクター', 'ブランディング', '経営', '組織', '事業', '中小企業', '地域', 'キャリア', 'チーム', 'マネジメント', '音楽', 'AI', '言葉'];
  let feed = (() => { try { return JSON.parse(localStorage.getItem(FEED_KEY)); } catch (e) { return null; } })();
  let feedState = 'idle';

  function plainText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('br, p, h2, h3, li').forEach(el => el.after('\n'));
    return (doc.body.textContent || '').replace(/\n\s*\n+/g, '\n').trim();
  }
  async function fetchFeed(force = false) {
    if (feedState === 'loading') return;
    if (!force && feed && Date.now() - feed.at < FEED_TTL) return;
    feedState = 'loading';
    if (!feed) refreshFeedSlots();
    try {
      const res = await fetch(FEED_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
      const items = [...xml.getElementsByTagName('item')].map(it => {
        const get = tag => (it.getElementsByTagName(tag)[0] || {}).textContent || '';
        return {
          id: get('guid') || get('link'), title: get('title').trim(), link: get('link').trim(),
          date: Date.parse(get('pubDate')) || 0, desc: plainText(get('description')),
          text: plainText(get('content:encoded')).slice(0, 8000),
        };
      }).filter(i => i.title && /^https:\/\/designing\.jp\//.test(i.link));
      if (!items.length) throw new Error('empty');
      feed = { at: Date.now(), items };
      try { localStorage.setItem(FEED_KEY, JSON.stringify(feed)); } catch (e) { /* 容量不足でも表示は続ける */ }
      feedState = 'idle';
    } catch (e) { feedState = 'error'; }
    refreshFeedSlots();
  }

  // 記事と用語を結びつけるとき、日常語に近い別名は使わない
  const COMMON_WORDS = new Set(['プロダクト', 'プライス', 'プレイス', 'プロモーション', '4C', '資産', '負債', '純資産', '整理', '整頓', '清掃', '清潔', 'しつけ', '自己実現', 'リピート', '導入期', '成長期', '成熟期', '衰退期', '共通目的', 'コミュニケーション', '人工物', '移行', '解凍', 'シナジー', '顧客', '競合', '自社', '差別化戦略', '回収期間', '割引率', '現在価値', '発注費', '保管費', '在庫管理']);
  const interests = () => (S.interests && S.interests.length ? S.interests : DEFAULT_INTERESTS);
  function scoreItem(it) {
    let sc = 0;
    const hits = [];
    for (const k of interests()) {
      const inTitle = it.title.includes(k), inDesc = it.desc.includes(k), n = Math.min(3, it.text.split(k).length - 1);
      if (inTitle || inDesc || n) { hits.push(k); sc += (inTitle ? 3 : 0) + (inDesc ? 2 : 0) + n; }
    }
    const terms = GLOSSARY.filter(t => [t.t, ...(t.y || [])].some(k => k.length >= 3 && !COMMON_WORDS.has(k) && it.text.includes(k))).slice(0, 3);
    sc += terms.length * 1.5;
    sc += Math.max(0, 4 - (Date.now() - it.date) / 864e5 / 14); // 新しい記事を少しだけ優先
    return { sc, hits, terms };
  }
  function keyLines(it, hits) {
    const sents = it.text.split(/\n|(?<=。)/).map(s => s.trim()).filter(s => s.length >= 25 && s.length <= 110 && !it.desc.includes(s));
    const withHit = sents.filter(s => hits.some(k => s.includes(k)));
    return (withHit.length ? withHit : sents).slice(0, 2);
  }
  function recommended() {
    if (!feed) return [];
    const read = S.read || {};
    return feed.items.filter(i => !read[i.id]).map(i => ({ ...i, ...scoreItem(i) })).sort((a, b) => b.sc - a.sc);
  }
  const articlePrompt = it => `designing（デザインビジネスマガジン）の記事「${it.title}」について教えてください。\nURL：${it.link}\n\n概要：${it.desc}\n\n本文の冒頭：\n${it.text.slice(0, 900)}\n\n次の3つを、平易な日本語でお願いします。\n1. 3行の要約\n2. 転職活動中のWebディレクター（中小企業診断士を勉強中）が、仕事に活かせる示唆を3つ\n3. noteに書くとしたら、どんな切り口があるか1つ`;
  function articleCard(it, { compact = false } = {}) {
    const d = new Date(it.date);
    const reason = [
      it.hits.length ? `「${it.hits.slice(0, 3).join('」「')}」に関係` : '',
      it.terms.length ? `診断士の「${it.terms.map(t => t.t).join('」「')}」とつながる` : '',
    ].filter(Boolean).join('。');
    const lines = compact ? [] : keyLines(it, it.hits);
    return `<article class="article">
      <p class="article-date">${d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}年` : ''}${d.getMonth() + 1}月${d.getDate()}日</p>
      <h3 class="article-title"><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
      <p class="article-desc">${esc(it.desc)}</p>
      ${lines.length ? `<ul class="article-lines">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      ${reason ? `<p class="article-why">おすすめの理由：${esc(reason)}</p>` : ''}
      ${!compact && it.terms.length ? `<div class="row">${it.terms.map(t => `<button class="chip" data-act="show-term" data-id="${esc(t.id)}">${esc(t.t)}</button>`).join('')}</div>` : ''}
      <div class="term-acts">
        <button class="btn" data-act="art-read" data-id="${esc(it.id)}">読んだ</button>
        <button class="btn-line" data-act="art-idea" data-id="${esc(it.id)}">noteのネタにする</button>
        <a class="link" href="${claudeUrl(articlePrompt(it))}" target="_blank" rel="noopener">Claudeで詳しく要約</a>
        ${compact ? '' : `<button class="btn-icon" data-act="art-skip" data-id="${esc(it.id)}">今回は見送る</button>`}
      </div></article>`;
  }
  function feedSlotHtml(mode) {
    if (!feed) {
      return feedState === 'error'
        ? '<p class="empty">designing の記事を読み込めませんでした。電波のよい場所で、もう一度読み込んでください。</p><div class="term-acts"><button class="btn-line" data-act="feed-retry">もう一度読み込む</button></div>'
        : '<p class="empty">designing の記事を読み込んでいます。</p>';
    }
    const recs = recommended();
    if (!recs.length) return '<p class="empty">おすすめの記事はすべて読みました。新しい記事が出たら、ここに表示します。</p>';
    if (mode === 'today') return articleCard(recs[0], { compact: true });
    const at = new Date(feed.at);
    return `${recs.slice(0, 5).map(it => articleCard(it)).join('')}
      <p class="meta feed-foot">${feedState === 'error' ? '最新の記事を読み込めなかったため、前回の内容を表示しています。' : ''}
        記事一覧の更新：${at.getMonth() + 1}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}
        <button class="btn-quiet" data-act="feed-retry">いま更新する</button></p>`;
  }
  function refreshFeedSlots() { document.querySelectorAll('.feed-slot').forEach(el => { el.innerHTML = feedSlotHtml(el.dataset.mode); }); }
  const feedItem = id => feed && feed.items.find(i => i.id === id);

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
  };
  const icon = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
  // title・tag は呼び出し側でエスケープ済みの文字列を渡す
  const cardHead = (ic, title, tag = '', extra = '') =>
    `<div class="card-head"><span class="badge">${icon(ic)}</span><div class="card-titles"><h2 class="card-title">${title}</h2>${tag ? `<p class="card-tag">${tag}</p>` : ''}</div>${extra}</div>`;
  const pageHead = (title, lead = '') => `<header class="page-head"><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</header>`;

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
        <label>何を<input name="what" required placeholder="例：面接で話す案件を1本決めて、判断と結果を書き出す"></label>
        <label>いつ・どこで<input name="when" placeholder="例：夜9時、リビングの机で"></label>
        <label>5分版（しんどい日はこれだけ）<input name="mini" placeholder="例：案件名だけ決める"></label>
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
        <a class="link" href="${claudeUrl(termPrompt(t.t))}" target="_blank" rel="noopener">Claudeにもっと聞く</a>
        <a class="link" href="${xUrl(termPost(t))}" target="_blank" rel="noopener" data-act="x-term" data-id="${esc(t.id)}">Xにポスト</a>
        ${t.mine ? `<button class="btn-icon" data-act="term-del" data-id="${esc(t.id)}">この用語を消す</button>` : ''}
      </div>`;
    return `<article class="term${open ? ' is-open' : ''}">
      <p class="term-subj">${esc(t.s)}${t.mine ? '（自分で登録）' : ''}</p>
      <h3 class="term-name">${esc(t.t)}</h3>
      ${t.one ? `<p class="term-one">${esc(t.one)}</p>` : ''}
      <details class="term-more"${open ? ' open' : ''}><summary>解説を読む</summary>
        <p>${escBr(t.body)}</p>
        ${t.tip ? `<h4>試験のツボ</h4><p>${esc(t.tip)}</p>` : ''}
        ${t.work ? `<h4>仕事でいうと</h4><p>${esc(t.work)}</p>` : ''}
      </details>${acts}</article>`;
  }

  // ── 画面：きょう ──
  function viewToday() {
    const total = S.wins.length;
    const week = winsSince(weekStart());
    const { lines, fact } = encourage();
    const jobTasks = S.tasks.filter(t => !t.done && t.cat === 'job');
    const subTasks = S.tasks.filter(t => !t.done && t.cat !== 'job');
    const studied = S.studyDays[ymd()] || 0;
    const word = pickDaily(allTerms().filter(t => t.one), 'word');
    const wk = c => week.filter(w => (Array.isArray(c) ? c.includes(w.cat) : w.cat === c)).length;
    const last7 = Array.from({ length: 7 }, (_, i) => countOn(addDays(ymd(), -i))).reduce((a, b) => a + b, 0);
    return `
      ${syncReady() && sync.error ? `<p class="alert sync-status is-error" role="status">${esc(syncStatusText())}</p>` : ''}
      <div class="today-grid">
        <div class="col">
          <header class="page-head">
            <p class="eyebrow">${jpDate()}　目的地</p>
            ${S.vision ? `<h1 class="vision-text">${esc(S.vision)}</h1>`
              : '<h1>目的地を決めましょう</h1><p class="lead"><a class="link" href="#/settings">設定</a>で、3〜5年後にどうなっていたいかを書くと、ここに表示されます。</p>'}
          </header>
          <section class="card">
            ${cardHead('spark', 'コーチ', '記録した事実をもとに声をかけます')}
            ${weekStrip()}
          </section>
          <div class="bubbles" aria-label="きょうのことば">
            ${lines.map(l => `<div class="bubble-row"><span class="avatar">${icon('spark')}</span><p class="bubble">${esc(l)}</p></div>`).join('')}
            ${fact ? `<div class="bubble-row"><span class="avatar">${icon('spark')}</span><p class="bubble"><small>思い出してほしい事実</small>${esc(fact)}</p></div>` : ''}
          </div>
          <div class="stats">
            <section class="card stat">
              <div class="stat-top"><span class="badge">${icon('stack')}</span><b class="stat-num">${total}</b></div>
              <p class="stat-label">積み上げ</p><p class="stat-sub">直近14日で記録した日</p>
              ${gaugeHtml()}
            </section>
            <section class="card stat">
              <div class="stat-top"><span class="badge">${icon('chart')}</span><b class="stat-num">${week.length}</b></div>
              <p class="stat-label">今週</p>
              <dl class="stat-list"><dt>転職</dt><dd>${wk('job')}</dd><dt>発信</dt><dd>${wk(['note', 'music'])}</dd><dt>診断士</dt><dd>${wk('study')}</dd></dl>
            </section>
          </div>
          <section class="card">
            ${cardHead('chart', 'この7日間', `${last7}件の記録。小さな1件も、ちゃんと数えています。`)}
            ${barsHtml(7)}
          </section>
        </div>
        <div class="col">
          <section class="card">
            ${cardHead('target', esc(S.mainLabel), '主役')}
            ${whyHtml('job')}
            ${jobTasks.length ? `<ul class="tasks">${jobTasks.map(taskItem).join('')}</ul>`
              : '<p class="empty">次の1歩がまだありません。「いつ・どこで・何を」まで決めておくと、動き出しやすくなります。</p>'}
            ${taskForm('job')}
          </section>
          <section class="card">
            ${cardHead('pen', '発信', '脇役')}
            ${goalRow('note')}${goalRow('music')}
            ${subTasks.length ? `<ul class="tasks">${subTasks.map(taskItem).join('')}</ul>` : ''}
          </section>
          <section class="card">
            ${cardHead('book', '診断士', '1日1語・1問')}
            ${whyHtml('study')}
            ${word ? `<div class="wod">
              <div class="wod-text"><p class="term-subj">今日の1語</p>
                <p class="wod-name">${esc(word.t)}</p><p class="wod-one">${esc(word.one)}</p></div>
              <div class="wod-acts">
                <a class="btn" href="${xUrl(termPost(word))}" target="_blank" rel="noopener" data-act="x-term" data-id="${esc(word.id)}">Xにポスト</a>
                <button class="btn-line" data-act="show-term" data-id="${esc(word.id)}">解説</button>
              </div></div>` : ''}
            <div class="qq-slot">${qqHtml()}</div>
            <p class="meta qq-foot">${studied ? `今日は${studied}回ふりかえりました。` : ''}<a class="link" href="#/study">用語さがしと計算ふりかえりへ</a></p>
          </section>
          <section class="card">
            ${cardHead('news', 'designing', '今日の1本')}
            <div class="feed-slot" data-mode="today">${feedSlotHtml('today')}</div>
          </section>
        </div>
      </div>
      <div class="down-wrap"><button class="btn-line" data-act="down">今日はしんどい</button></div>`;
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
      ${pageHead('発信', `ネタを書きとめて、公開まで進めます。note は週${S.goals.note}本、音楽は月${S.goals.music}曲が目安です。`)}
      <div class="grid-2">
        <div class="col">
          <section class="card">${cardHead('pen', '今週・今月の目安')}${goalRow('note')}${goalRow('music')}</section>
          <section class="card">${cardHead('bulb', 'ネタ帳', 'ネタ → 下書き → 公開')}
            <form class="form form-row" data-form="idea">
              <select name="cat" aria-label="分類"><option value="note">note</option><option value="music">音楽</option></select>
              <input name="title" required placeholder="例：〇〇の制作ノート" aria-label="ネタ">
              <button class="btn">追加</button>
            </form>
            <div class="ideas">${ideaList('note')}${ideaList('music')}</div>
          </section>
          <section class="card">${cardHead('link', '発信先')}
            ${linkItems.length ? `<p class="links">${linkItems.map(([k, n]) => `<a class="btn-line" href="${esc(L[k])}" target="_blank" rel="noopener">${n}を開く</a>`).join('')}</p>`
              : '<p class="empty">設定でURLを登録すると、ここから開けます。</p>'}
          </section>
        </div>
        <div class="col">
          <section class="card">${cardHead('news', 'designing のおすすめ', '関心のあるキーワードと、診断士の用語に近い記事から順に並べています')}
            <div class="feed-slot" data-mode="list">${feedSlotHtml('list')}</div>
          </section>
        </div>
      </div>`;
  }

  // ── 画面：診断士 ──
  function resultsHtml(q) {
    if (!q.trim()) return '';
    const r = search(q);
    const ask = `<a class="btn" href="${claudeUrl(termPrompt(q.trim()))}" target="_blank" rel="noopener">Claudeに解説してもらう</a>`;
    if (!r.length) {
      return `<div class="notfound">
        <p>「${esc(q)}」はまだ辞書にありません。Claudeに聞いて、よければ自分の辞書に登録しておきましょう。</p>
        <div class="row">${ask}</div>
        <details class="add"><summary>${icon('plus')}自分の辞書に登録する</summary>
          <form class="form" data-form="myterm">
            <label>用語<input name="t" required value="${esc(q.trim())}"></label>
            <label>科目<select name="s">${SUBJECTS.map(s => `<option>${s}</option>`).join('')}</select></label>
            <label>一言でいうと<input name="one" placeholder="例：〇〇とは、〜のこと"></label>
            <label>解説（Claudeの回答を貼り付けても構いません）<textarea name="body" required></textarea></label>
            <div><button class="btn">登録する</button></div>
          </form></details></div>`;
    }
    const [top, ...rest] = r;
    return `${termCard(top, { open: true })}
      ${rest.length ? `<div class="others">ほかの候補<div class="row">${rest.slice(0, 6).map(t =>
        `<button class="chip" data-act="show-term" data-id="${esc(t.id)}">${esc(t.t)}</button>`).join('')}</div></div>` : ''}
      <p class="others">探している言葉と違うときは <a class="link" href="${claudeUrl(termPrompt(q.trim()))}" target="_blank" rel="noopener">Claudeに「${esc(q.trim())}」を聞く</a></p>`;
  }

  function quizHtml() {
    if (!quiz) return '<button class="btn" data-act="quiz-start">10語ふりかえる</button>';
    if (quiz.i >= quiz.q.length) {
      return `<div class="quiz-card"><p>${quiz.q.length}語ふりかえりました。忘れかけた語から先に出るので、明日も同じボタンを押すだけで大丈夫です。</p>
        <div class="term-acts"><button class="btn" data-act="quiz-start">もう10語</button><button class="btn-line" data-act="quiz-end">終える</button></div></div>`;
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

  function viewStudy() {
    const terms = allTerms();
    const seen = terms.filter(t => S.study[t.id]).length;
    const bySubj = SUBJECTS.map(s => [s, terms.filter(t => t.s === s)]).filter(([, ts]) => ts.length);
    return `
      ${pageHead('診断士', '本で読んだ言葉を入れると、解説が出ます。1日1語でも積み上がります。')}
      <form class="search" data-form="search" role="search">
        <span class="search-icon">${icon('search')}</span>
        <input id="q" type="search" name="q" value="${esc(searchQ)}" placeholder="例：コア・コンピタンス、損益分岐点" aria-label="調べる言葉" autocomplete="off">
        <button class="btn">調べる</button>
      </form>
      <div id="results" class="card">${resultsHtml(searchQ)}</div>
      <div class="grid-2">
        <div class="col">
          <section class="card">${cardHead('quiz', 'ちょっと1問', '用語当て・○×・暗算。間違えた問題は明日もう一度')}
            <div class="qq-slot">${qqHtml()}</div>
          </section>
          <section class="card">${cardHead('book', '用語ふりかえり', `ふりかえった語 ${seen} / ${terms.length}　今日 ${S.studyDays[ymd()] || 0}回　復習待ち ${dueTerms().length}語`)}
            <div class="meter" aria-hidden="true"><i style="width:${Math.round(seen / terms.length * 100)}%"></i></div>
            <div id="quiz">${quizHtml()}</div>
          </section>
          <section class="card glossary-list">${cardHead('list', '用語一覧')}
            ${bySubj.map(([s, ts]) => `<details><summary>${esc(s)}（${ts.length}）</summary><div class="row">
              ${ts.map(t => `<button class="chip${S.study[t.id] ? ' is-seen' : ''}" data-act="show-term" data-id="${esc(t.id)}">${esc(t.t)}</button>`).join('')}
            </div></details>`).join('')}
          </section>
        </div>
        <div class="col">
          <section class="card">${cardHead('calc', '計算ふりかえり', '数字を変えると、その場で答えが変わります。本の例題の答え合わせにも')}
            ${FORMULAS.map(formulaHtml).join('')}
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
      ${pageHead('積み上げ', 'できたことを1行で残します。小さなことほど書いておく価値があります。')}
      <div class="grid-2">
        <div class="col">
          <section class="card">${cardHead('plus', 'できたことを記録する')}
            <form class="form" data-form="win">
              <input name="text" required placeholder="例：職務経歴書の実績を1つ書き直した" aria-label="できたこと">
              <div class="row"><select name="cat" aria-label="分類" style="width:auto">${catOptions('job')}</select><button class="btn">記録する</button></div>
            </form>
          </section>
          <section class="card">${cardHead('chart', `今週 ${week.length}件`, '直近14日の記録')}
            ${barsHtml(14)}
            ${counts.length ? `<p class="week-sum">${counts.map(([c, n]) => `<span data-cat="${c}">${CATS[c]} ${n}</span>`).join('')}</p>` : '<p class="empty">今週の記録はまだありません。</p>'}
          </section>
        </div>
        <div class="col">
          <section class="card">${cardHead('stack', `これまで ${S.wins.length}件`)}
            ${Object.keys(byDay).length ? Object.entries(byDay).map(([d, ws]) => `<div class="day"><h3>${jpDate(parseYmd(d))}</h3>
              ${ws.map(w => `<div class="win" data-cat="${w.cat}"><p><span class="win-cat">${CATS[w.cat] || ''}</span>${esc(w.text)}</p>
                <button class="btn-icon" data-act="win-del" data-id="${w.id}" aria-label="「${esc(w.text)}」を消す">×</button></div>`).join('')}</div>`).join('')
              : '<p class="empty">最初の1件を記録しましょう。</p>'}
          </section>
        </div>
      </div>`;
  }

  // ── 画面：設定 ──
  function viewSettings() {
    return `
      ${pageHead('設定', '同期、目的地、表示などを変えられます。')}
      <div class="grid-2">
        <div class="col">
          <section class="card" id="sync">${cardHead('sync', 'PCとスマホの同期', 'GitHub の非公開リポジトリに、合言葉で暗号化して保存します')}
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
          <section class="card">${cardHead('target', '目的地', '「きょう」の一番上と、各項目の下に表示されます')}
            <div class="form">
              <label>3〜5年後にどうなっていたいか<textarea name="vision" rows="3">${esc(S.vision)}</textarea></label>
              <label>転職活動は、目的地にどうつながるか<input name="whyJob" value="${esc(why('job'))}"></label>
              <label>note は<input name="whyNote" value="${esc(why('note'))}"></label>
              <label>音楽は<input name="whyMusic" value="${esc(why('music'))}"></label>
              <label>診断士は<input name="whyStudy" value="${esc(why('study'))}"></label>
            </div>
          </section>
          <section class="card">${cardHead('user', 'わたしの事実', '経歴や実績を1行に1つ。コーチの言葉やしんどい日に使います')}
            <div class="form"><textarea name="facts" rows="8" aria-label="わたしの事実" placeholder="例：〇〇の案件で、△△を□□まで改善した">${esc(S.facts.join('\n'))}</textarea></div>
          </section>
          <section class="card">${cardHead('flag', '主役と目安')}
            <div class="form">
              <label>主役の名前<input name="mainLabel" value="${esc(S.mainLabel)}"></label>
              <div class="pair">
                <label>note（週に何本）<input type="number" min="1" name="gNote" value="${S.goals.note}"></label>
                <label>音楽（月に何曲）<input type="number" min="1" name="gMusic" value="${S.goals.music}"></label>
              </div>
            </div>
          </section>
          <section class="card">${cardHead('news', 'designing', 'おすすめ順に使うキーワード（読点で区切る）')}
            <div class="form"><input name="interests" aria-label="気になるキーワード" value="${esc(interests().join('、'))}"></div>
          </section>
          <section class="card">${cardHead('link', '発信先')}
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
          <section class="card">${cardHead('box', 'バックアップ', 'ファイルに書き出して、別の端末で読み込めます')}
            <div class="row">
              <button class="btn" data-act="export">書き出す</button>
              <label class="btn-line">読み込む<input type="file" accept="application/json,.json" data-act="import" hidden></label>
            </div>
          </section>
          <section class="card">${cardHead('sun', '表示')}
            <div class="row">
              <button class="btn-line" data-act="theme" data-v="">端末に合わせる</button>
              <button class="btn-line" data-act="theme" data-v="light">ライト</button>
              <button class="btn-line" data-act="theme" data-v="dark">ダーク</button>
            </div>
          </section>
          <section class="card">${cardHead('trash', 'すべて消す', 'この端末のデータを消します。先に書き出しておくと安心です')}
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
  const VIEWS = { today: viewToday, share: viewShare, study: viewStudy, log: viewLog, settings: viewSettings };
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
        const due = shuffle(dueTerms());
        const fresh = shuffle(allTerms().filter(t => !S.study[t.id]));
        const rest = shuffle(allTerms().filter(t => S.study[t.id] && !due.includes(t)));
        quiz = { q: [...due, ...fresh, ...rest].slice(0, 10).map(t => t.id), i: 0, shown: false };
        $('#quiz').innerHTML = quizHtml(); break;
      }
      case 'quiz-show': quiz.shown = true; $('#quiz').innerHTML = quizHtml(); break;
      case 'quiz-end': quiz = null; $('#quiz').innerHTML = quizHtml(); break;
      case 'show-term': {
        const t = termById(id); if (!t) return;
        searchQ = t.t;
        if (route() !== 'study') { location.hash = '#/study'; return; }
        $('#q').value = searchQ; $('#results').innerHTML = resultsHtml(searchQ);
        $('#q').scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      }
      case 'term-del':
        if (!confirm('自分で登録した用語を消しますか？')) return;
        markDeleted(id); S.myTerms = S.myTerms.filter(x => x.id !== id); delete S.study[id]; save(); searchQ = ''; render(); break;
      case 'qq-answer': {
        if (!qq || qq.picked !== null) return;
        qq.picked = Number(el.dataset.i);
        if (qq.ref) review(qq.ref, qq.picked === qq.answer, true);
        refreshQQ(); break;
      }
      case 'qq-next': qq = nextQuestion(); refreshQQ(); break;
      case 'x-term': { // リンクはそのまま開き、積み上げにも残す
        const t = termById(id); if (t) addWin('study', `Xで「${t.t}」を紹介した`); break;
      }
      case 'x-quiz': if (qq) addWin('study', `Xで診断士の問題を出題した`); break;
      case 'art-read': {
        const it = feedItem(id); if (!it) return;
        S.read = { ...S.read, [id]: ymd() };
        addWin('other', `designing「${it.title}」を読んだ`);
        render(); break;
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
        a.download = `積み上げ帳-${ymd()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast('書き出しました。もう一方の端末で「読み込む」を押してください。'); break;
      }
      case 'theme': {
        const v = el.dataset.v;
        try { if (v) localStorage.setItem('tsumiage.theme', v); else localStorage.removeItem('tsumiage.theme'); } catch (err) { /* 無視 */ }
        applyTheme(); break;
      }
      case 'reset':
        if (!confirm(syncReady() ? 'この端末のデータを消します。同期を設定しているので、次の同期でほかの端末のデータから戻ります。よろしいですか？' : 'この端末のデータをすべて消します。よろしいですか？')) return;
        S = blank(); save(); render(); toast('消しました。'); break;
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
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
      case 'idea':
        S.ideas.push({ id: uid(), cat: d.cat, title: d.title.trim(), stage: 0, created: ymd(), u: Date.now() });
        save(); render(); toast('ネタ帳に追加しました。'); break;
      case 'win':
        addWin(d.cat, d.text.trim()); render(); break;
      case 'search':
        searchQ = d.q; $('#results').innerHTML = resultsHtml(searchQ); break;
      case 'myterm':
        S.myTerms.push({ u: Date.now(), id: `my-${uid()}`, t: d.t.trim(), s: d.s, one: d.one.trim(), body: d.body.trim(), y: [] });
        save(); searchQ = d.t.trim(); render(); toast('自分の辞書に登録しました。'); break;
      case 'sync': {
        const next = { owner: d.owner.trim(), repo: d.repo.trim(), token: d.token.trim(), pass: d.pass };
        if (!next.owner || !next.repo || !next.token || !next.pass) { toast('4つの欄をすべて入れてください。'); return; }
        if (next.owner !== sync.owner || next.repo !== sync.repo || next.pass !== sync.pass) { sync = { ...next }; keyCache = null; }
        else sync = { ...sync, ...next };
        saveSync(); render(); syncNow({ manual: true }); break;
      }
      case 'settings':
        S.facts = d.facts.split('\n').map(s => s.trim()).filter(Boolean);
        S.mainLabel = d.mainLabel.trim() || '転職活動';
        S.goals = { note: Math.max(1, +d.gNote || 1), music: Math.max(1, +d.gMusic || 1) };
        S.links = { note: d.lNote.trim(), youtube: d.lYoutube.trim(), x: d.lX.trim() };
        S.settingsAt = Date.now();
        S.vision = d.vision.trim();
        S.why = { job: d.whyJob.trim(), note: d.whyNote.trim(), music: d.whyMusic.trim(), study: d.whyStudy.trim() };
        S.interests = d.interests.split(/[、,，\s]+/).map(x => x.trim()).filter(Boolean);
        save(); toast('設定を保存しました。'); break;
    }
  });

  let searchTimer;
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'q') {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { searchQ = el.value; $('#results').innerHTML = resultsHtml(searchQ); }, 200);
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
