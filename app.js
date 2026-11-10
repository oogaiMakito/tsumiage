'use strict';
// Mindwalk v4：「なぜ」に毎日10秒で戻り、今日の一歩を1つだけ決めるアプリ。
// 記録はこれまでと同じ保存先（tsumiage.v1）と同期先（tsumiage-data）を使う。
// 新しい項目も、古い版と同期しても消えない場所（why・mood・journal・facts）に入れている。
(() => {
  const KEY = 'tsumiage.v1';

  // ── 3つの「なぜ」（2026-11-10 に本人が了承した言葉が初期値。地図の画面で書き直せる） ──
  const WHYS = [
    { k: 'indep', q: 'なぜ、50代で独立を目指すのか', feel: '自分で決める',
      a: '前の会社では、組織の都合で自分が消耗し続けた。50代は「何かを起こしていく人間」になりたい。退職金のない会社に入るので、会社に頼らず自分の価値で立っていたい。' },
    { k: 'team', q: 'なぜ、チームで働く環境を探し、作るのか', feel: '人とつながる',
      a: '「1人で全部抱える」のが自分のいちばんの弱点。前の会社で、チームの稼働率が136%で回らなくなるのを見た。信頼し、尊敬しあえるチームでなければ、大きなことは起こせない。' },
    { k: 'path', q: 'なぜ、経営とPMの道を歩むのか', feel: 'できるようになる',
      a: 'チームを守るには、気合いではなく仕組みと数字が要る。前の会社の組織の課題を自分なりに解いてみて、それを本当に動かせる立場に立ちたいと思った。' },
  ];
  // 通過点からの道（キャリアビジョン/通過点からの道_TODO.md）のフェーズ
  const PHASES = [
    { n: 0, name: '入社まで', from: '2026-10-25', to: '2026-11-30', goal: '引き継ぎをきれいに終える。入社後に守る線を決める' },
    { n: 1, name: '信頼をつくる', from: '2026-12-01', to: '2027-12-31', goal: '大企業の案件を1本、最後まで動かす。「この人と組みたい」人を3人見つける' },
    { n: 2, name: '小さく試す', from: '2028-01-01', to: '2029-12-31', goal: 'AI・DX案件で小さなチームを率いる。サービスの仮説を手作業で試す' },
    { n: 3, name: '仲間と形にする', from: '2030-01-01', to: '2032-12-31', goal: '仲間と役割を分け、最初の有償のお客様をつくる' },
  ];
  const FIFTY = '2032-12-23';
  const STEP_IDEAS = ['外を10分歩く', 'PMの用語を1つ読む', 'PMBOKを1ページ読む', '過去の案件で「自分が決めたこと」を1つ書く', '今日は早めに寝る'];
  // 3段階の調子。これまでの気分（1〜5）と同じ欄に入れる
  const FEELS = [{ v: 2, label: 'しんどい' }, { v: 3, label: 'ふつう' }, { v: 4, label: 'いける' }];
  const feelOf = m => (!m ? 0 : m <= 2 ? 2 : m >= 4 ? 4 : 3);
  const INTERVALS = [1, 3, 7, 14, 30, 60];

  const blank = () => ({
    version: 4,
    mainLabel: 'PMへの道', goals: { note: 1, music: 1 }, facts: [], links: { note: '', youtube: '', x: '' },
    tasks: [], wins: [], ideas: [],
    study: {}, studyDays: {}, myTerms: [], interests: [], read: {},
    vision: '', why: {},
    journal: [], worries: [], mood: {}, pmDays: {}, learn: { goal: 35, from: '' },
    profile: { name: '', avatar: '' },
    deleted: {}, settingsAt: 0,
  });
  function migrate(st) {
    if ((st.version || 1) < 4) {
      st.version = 4;
      st.why = st.why || {};
      if (!st.vision) st.vision = '50代で、仲間と何かを起こしていく人間になる';
    }
    return st;
  }

  let S = load();
  let searchQ = '';
  let card = null; // PM学習の「ふりかえり」で今出している用語

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate({ ...blank(), ...JSON.parse(raw) });
    } catch (e) { /* 保存が使えない環境でも表示はできる */ }
    return migrate(blank());
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
  const touchSettings = () => { S.settingsAt = Date.now(); };

  // ── 同期（これまでと同じ仕組み） ──
  // GitHub の非公開リポジトリに、合言葉から作った鍵で暗号化（AES-GCM）して1ファイルで保存する。
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
    if (e.status === 401) return 'アクセストークンの期限が切れたか、正しくありません。設定の「同期」から、新しいトークンを入れ直してください（合言葉はそのままで大丈夫です）。';
    if (e.status === 403) return 'トークンに書き込みの権限がありません。「Contents」を「Read and write」にしてください。';
    if (e.status === 404) return 'リポジトリが見つかりません。ユーザー名・リポジトリ名と、トークンの対象リポジトリを確かめてください。';
    return `同期できませんでした（${e.status || e.message}）。`;
  }
  const stamp = x => x.u || x.ts || 0;
  function mergeState(a, b) {
    const out = { ...blank(), ...b, ...a };
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
    for (const k of ['tasks', 'ideas', 'myTerms', 'journal', 'worries']) out[k] = list(k);
    out.wins = list('wins').sort((x, y) => (x.ts || 0) - (y.ts || 0));
    out.mood = { ...(b.mood || {}) };
    for (const [d, r] of Object.entries(a.mood || {})) { const o = out.mood[d]; if (!o || (r.u || 0) > (o.u || 0)) out.mood[d] = r; }
    for (const k of ['pmDays', 'studyDays']) {
      out[k] = { ...(b[k] || {}) };
      for (const [d, n] of Object.entries(a[k] || {})) out[k][d] = Math.max(n, out[k][d] || 0);
    }
    out.study = { ...(b.study || {}) };
    for (const [id, r] of Object.entries(a.study || {})) { const o = out.study[id]; if (!o || (r.count || 0) > (o.count || 0)) out.study[id] = r; }
    out.read = { ...(b.read || {}), ...(a.read || {}) };
    const src = (a.settingsAt || 0) > (b.settingsAt || 0) ? a : b; // 同じならリモートを優先
    for (const k of SETTING_KEYS) if (src[k] !== undefined) out[k] = src[k];
    out.settingsAt = Math.max(a.settingsAt || 0, b.settingsAt || 0);
    out.version = Math.max(a.version || 1, b.version || 1);
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
  const tokenDaysLeft = () => (sync.exp ? Math.ceil((parseYmd(sync.exp) - parseYmd(ymd())) / 864e5) : null);
  function tokenNote() {
    const n = tokenDaysLeft();
    if (n === null) return '';
    if (n < 0) return `アクセストークンの期限（${sync.exp}）を過ぎています。新しいトークンを入れ直してください。`;
    if (n <= 14) return `アクセストークンの期限まで、あと${n}日です（${sync.exp}）。`;
    return '';
  }
  function syncStatusText() {
    if (!syncReady()) return '同期は設定されていません。';
    if (sync.busy) return '同期しています…';
    if (sync.error) return `同期できていません：${sync.error}`;
    if (!sync.lastAt) return 'まだ同期していません。';
    const d = new Date(sync.lastAt);
    return `最後の同期：${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}${sync.exp ? `　トークンの期限：${sync.exp}` : ''}`;
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
  const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
  const WD = '日月火水木金土';
  const jpDate = (d = new Date()) => `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
  const jpShort = s => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const weekStart = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return ymd(x); };
  function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  const pickDaily = (arr, salt = '') => (arr.length ? arr[hash(ymd() + salt) % arr.length] : null);
  const claudeUrl = prompt => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // ── データの読み書き ──
  const whyText = k => (S.why && S.why[k]) || WHYS.find(w => w.k === k).a;
  const letter = () => (S.why && S.why.letter) || '';
  const day = (k = ymd()) => (S.mood || {})[k] || {};
  function setDay(patch, k = ymd()) {
    S.mood = { ...S.mood, [k]: { ...day(k), ...patch, u: Date.now() } };
    save();
  }
  const walked = k => { const r = day(k); return Boolean(r.done || r.rest); };
  const walkedCount = () => Object.keys(S.mood || {}).filter(walked).length;
  const reviews = () => (S.journal || []).filter(j => j.kind === 'week').sort((a, b) => (a.week < b.week ? 1 : -1));
  const reviewOf = wk => reviews().find(r => r.week === wk);
  const phaseNow = () => { const t = ymd(); return PHASES.find(p => t >= p.from && t <= p.to) || PHASES[PHASES.length - 1]; };
  const profile = () => S.profile || { name: '', avatar: '' };
  const meHtml = () => {
    const pr = profile();
    return pr.avatar ? `<img class="me" src="${esc(pr.avatar)}" alt="">`
      : `<span class="me" aria-hidden="true">${esc((pr.name || 'M').slice(0, 1))}</span>`;
  };

  // ── PM学習（用語・PMBOKの地図・ふりかえり） ──
  const allTerms = () => PM_GLOSSARY.concat((S.myTerms || []).filter(t => t.d === 'pm').map(t => ({ ...t, mine: true })));
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
  const dueTerms = () => { const t = ymd(); return allTerms().filter(x => S.study[x.id] && S.study[x.id].due <= t); };
  const newTerms = () => allTerms().filter(x => !S.study[x.id]);
  function nextCard() {
    const due = dueTerms(), fresh = newTerms();
    const pool = due.length ? due : fresh.length ? fresh : allTerms();
    return pool[Math.floor(Math.random() * pool.length)].id;
  }
  function review(id, ok) {
    const r = S.study[id];
    const lv = ok ? (r ? Math.min(r.lv + 1, INTERVALS.length - 1) : 0) : 0;
    const today = ymd();
    S.study[id] = { lv, due: addDays(today, ok ? INTERVALS[lv] : 1), count: (r ? r.count : 0) + 1, last: today };
    S.pmDays = { ...S.pmDays, [today]: (S.pmDays[today] || 0) + 1 };
    save();
    toast(ok ? `${INTERVALS[lv]}日後にもう一度出します。` : '明日もう一度出します。');
  }
  const termPrompt = word => `Web制作のディレクターから、大企業のシステム・生成AI案件のプロジェクトマネージャーになる準備をしています。「${word}」について、次の順で平易な日本語で解説してください。\n1. 一言でいうと\n2. 詳しい解説（関連する用語も）\n3. 現場でつまずきやすいポイント\n4. Web制作の経験に置き換えた例\n5. 理解を確かめる問いを1つ（答えは書かずに。私が答えたら採点してください）`;
  const PMBOK_MAP = [
    ['6つの原則', [['全体を見る', 'pmbok-holistic'], ['価値に焦点', 'pmbok-value'], ['品質を組み込む', 'pmbok-quality'], ['責任あるリーダー', 'pmbok-leader'], ['持続可能性', 'pmbok-sustain'], ['力を発揮できる文化', 'pmbok-culture']]],
    ['7つのパフォーマンス領域', [['ガバナンス', 'pmbok-governance'], ['スコープ', 'pm-scope'], ['スケジュール', 'pm-cp'], ['ファイナンス', 'pmbok-finance'], ['ステークホルダー', 'pm-stake'], ['資源', 'pm-raci'], ['リスク', 'pm-risk']]],
    ['5つのフォーカスエリア', [['立ち上げ', 'pmbok-charter'], ['計画', 'pm-wbs'], ['実行', 'pm-meeting'], ['監視とコントロール', 'pmbok-evm'], ['終結', 'pm-cutover']]],
  ];

  // ── 部品 ──
  const ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>',
    loop: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
    gear: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  };
  const icon = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  const head = (title, lead = '', en = '') => `<header class="page-head">
    ${en ? `<p class="hand-cap">${en}</p>` : ''}<h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</header>`;

  function weekDots() {
    const start = weekStart(), today = ymd();
    return `<div class="dots" aria-label="今週の歩み">${Array.from({ length: 7 }, (_, i) => {
      const k = addDays(start, i), r = day(k);
      const st = r.done ? 'done' : r.rest ? 'rest' : '';
      const label = r.done ? '一歩できた' : r.rest ? '休んだ' : k > today ? 'これから' : '記録なし';
      return `<div class="dot-col${k === today ? ' is-today' : ''}${k > today ? ' is-future' : ''}">
        <i class="dot ${st}" title="${label}"></i><span>${WD[parseYmd(k).getDay()]}</span><span class="sr">${jpShort(k)}：${label}</span></div>`;
    }).join('')}</div>`;
  }

  // ── 画面：きょう ──
  function viewToday() {
    const r = day();
    const feel = feelOf(r.m);
    const low = feel === 2;
    const w = pickDaily(WHYS, 'why');
    const fact = pickDaily(S.facts || [], 'fact');
    const word = pickDaily(allTerms(), 'word');
    const lastRev = reviewOf(addDays(weekStart(), -7)); const planned = lastRev && lastRev.next;
    const stepState = r.done ? 'done' : r.rest ? 'rest' : r.step ? 'set' : 'none';
    return `
      ${syncReady() && sync.error ? `<p class="alert is-error" role="status"><span class="sync-status is-error">${esc(syncStatusText())}</span> <a class="link" href="#/settings">設定へ</a></p>` : ''}
      ${syncReady() && !sync.error && tokenNote() ? `<p class="alert" role="status">${esc(tokenNote())} <a class="link" href="#/settings">設定へ</a></p>` : ''}
      <header class="hello">
        <a href="#/settings" aria-label="設定">${meHtml()}</a>
        <p class="hello-text"><small>${jpDate()}</small><b><span class="hand">Hello,</span> ${esc(profile().name || 'Makito')}</b></p>
      </header>

      <section class="card why-card" data-tone="blue">
        <p class="hand-cap">today's why</p>
        <h2 class="why-q">${esc(w.q)}</h2>
        <p class="why-a">${escBr(whyText(w.k))}</p>
        <p class="meta"><span class="pill">${esc(w.feel)}</span><a class="link" href="#/why">3つのなぜと地図を見る</a></p>
      </section>

      <section class="card">
        <h2 class="card-title">今日の調子は？</h2>
        <div class="feel-row" role="group" aria-label="今日の調子">${FEELS.map(f =>
          `<button class="feel${feel === f.v ? ' is-on' : ''}" data-act="feel" data-v="${f.v}" aria-pressed="${feel === f.v}">${f.label}</button>`).join('')}</div>
        ${low ? `<div class="low">
          <p class="hand-ja">しんどい日は、休むのも一歩のうち。</p>
          ${fact ? `<p class="evidence"><small>あなたがやってきたこと</small>${esc(fact)}</p>` : ''}
          ${letter() ? `<details class="letter"><summary>50歳の自分からの手紙を読む</summary><p>${escBr(letter())}</p></details>` : ''}
        </div>` : ''}
      </section>

      <section class="card step-card" data-tone="${stepState === 'done' ? 'green' : stepState === 'rest' ? 'sand' : 'salmon'}">
        <h2 class="card-title">今日の一歩</h2>
        ${stepState === 'done' ? `<p class="step-done">「${esc(r.step)}」ができました。</p><p class="meta">これで${walkedCount()}日目の一歩です。<button class="btn-quiet" data-act="step-undo">取り消す</button></p>`
        : stepState === 'rest' ? `<p class="step-done">今日は休む日にしました。</p><p class="meta">休んだ日も、歩いた日に数えます。<button class="btn-quiet" data-act="step-undo">取り消す</button></p>`
        : stepState === 'set' ? `<p class="step-now">${esc(r.step)}</p>
            <div class="row"><button class="btn" data-act="step-done">できた</button><button class="btn-line" data-act="step-rest">今日は休む</button><button class="btn-quiet" data-act="step-clear">決め直す</button></div>`
        : `<form class="form form-inline" data-form="step">
            <input name="step" required placeholder="${low ? '例：外を10分歩く' : '例：PMBOKを1ページ読む'}" aria-label="今日の一歩">
            <button class="btn">決める</button></form>
          <div class="chips">${(low ? STEP_IDEAS.filter((_, i) => i === 0 || i === 4) : STEP_IDEAS).map(s => `<button class="chip" data-act="step-pick" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>
          ${planned ? `<p class="meta">ふりかえりで決めた一歩：<button class="btn-quiet" data-act="step-pick" data-v="${esc(planned)}">${esc(planned)}</button></p>` : ''}
          <p class="meta"><button class="btn-quiet" data-act="step-rest">今日は休む日にする</button></p>`}
        ${weekDots()}
      </section>

      ${word ? `<section class="card wod">
        <p class="hand-cap">word of the day</p>
        <p class="wod-name">${esc(word.t)}</p><p class="wod-one">${esc(word.one)}</p>
        <p class="meta"><button class="btn-quiet" data-act="show-term" data-id="${esc(word.id)}">解説を読む</button>　<a class="link" href="#/pm">PM学習へ</a></p>
      </section>` : ''}`;
  }

  // ── 画面：なぜ（3つのなぜと地図） ──
  function viewWhy() {
    const p = phaseNow();
    const left = daysBetween(ymd(), FIFTY);
    return `
      ${head('なぜ、この道を行くのか', '迷ったら、ここに戻る。言葉は自分のものに書き直してよい。', 'my north star')}
      <section class="card vision" data-tone="blue">
        <p class="vision-text scribble">${esc(S.vision)}</p>
        <p class="meta">50歳（2032年12月）まで、あと${left > 0 ? `${Math.floor(left / 365)}年${Math.floor((left % 365) / 30)}か月` : '0日'}</p>
      </section>
      ${WHYS.map((w, i) => `<section class="card why-item">
        <p class="why-num">${i + 1}</p>
        <div class="why-body">
          <h2 class="why-q">${esc(w.q)}</h2>
          <p class="why-a">${escBr(whyText(w.k))}</p>
          <p class="meta"><span class="pill">${esc(w.feel)}</span></p>
          <details class="edit"><summary>自分の言葉で書き直す</summary>
            <form class="form" data-form="why" data-k="${w.k}">
              <textarea name="a" rows="4">${esc(whyText(w.k))}</textarea>
              <div class="row"><button class="btn">保存する</button>${S.why && S.why[w.k] ? `<button type="button" class="btn-quiet" data-act="why-reset" data-k="${w.k}">はじめの言葉に戻す</button>` : ''}</div>
            </form></details>
        </div></section>`).join('')}

      <section class="card">
        <h2 class="card-title">通過点からの道</h2>
        <ol class="road">${PHASES.map(x => `<li class="${x.n === p.n ? 'is-now' : x.n < p.n ? 'is-past' : ''}">
          <b>${x.n === p.n ? 'いまここ：' : ''}${esc(x.name)}</b><span class="meta">${x.from.slice(0, 7).replace('-', '年')}月〜${x.to.slice(0, 7).replace('-', '年')}月</span>
          <p>${esc(x.goal)}</p></li>`).join('')}
          <li class="goal"><b>50歳：仲間とサービスを1つ動かしている</b><p>プロジェクトを動かし、何かを起こしていく人間</p></li>
        </ol>
      </section>

      <section class="card" data-tone="sand">
        <h2 class="card-title">50歳の自分からの手紙</h2>
        <p class="meta">一度だけ書いておく。しんどい日の「きょう」に出てきます。</p>
        <form class="form" data-form="letter">
          <textarea name="letter" rows="6" placeholder="例：43歳のきみへ。あの冬、力が出なかったことを覚えています。それでも……">${esc(letter())}</textarea>
          <div><button class="btn">${letter() ? '書き直す' : '残す'}</button></div>
        </form>
      </section>

      <section class="card" data-tone="green">
        <h2 class="card-title">これまでにやってきたこと</h2>
        <p class="meta">「自分はできる」を思い出すための事実。1行に1つ。</p>
        <form class="form" data-form="facts">
          <textarea name="facts" rows="8" aria-label="これまでにやってきたこと">${esc((S.facts || []).join('\n'))}</textarea>
          <div><button class="btn">保存する</button></div>
        </form>
      </section>`;
  }

  // ── 画面：PM学習 ──
  function resultsHtml(q) {
    if (!q.trim()) return '<p class="meta">言葉を入れると、解説が出ます。辞書にない言葉は、Claudeに聞けます。</p>';
    const hits = search(q).slice(0, 6);
    return `${hits.map(t => termCard(t)).join('')}
      <p class="meta">${hits.length ? '' : '辞書にありませんでした。'}<a class="link" href="${claudeUrl(termPrompt(q.trim()))}" target="_blank" rel="noopener">「${esc(q.trim())}」をClaudeに聞く</a></p>`;
  }
  function termCard(t, open = false) {
    return `<article class="term">
      <p class="term-subj">${esc(t.s)}${t.mine ? '（自分で登録）' : ''}</p>
      <h3 class="term-name">${esc(t.t)}</h3>
      ${t.one ? `<p class="term-one">${esc(t.one)}</p>` : ''}
      <details${open ? ' open' : ''}><summary>解説を読む</summary>
        <p>${escBr(t.body)}</p>
        ${t.tip ? `<h4>現場のツボ</h4><p>${esc(t.tip)}</p>` : ''}
        ${t.work ? `<h4>Web制作の経験でいうと</h4><p>${esc(t.work)}</p>` : ''}
        <p class="meta"><a class="link" href="${claudeUrl(termPrompt(t.t))}" target="_blank" rel="noopener">Claudeにもっと聞く</a></p>
      </details></article>`;
  }
  function viewPm() {
    const terms = allTerms();
    const seen = terms.filter(t => S.study[t.id]).length;
    if (!card || !termById(card.id)) card = { id: nextCard(), open: false };
    const t = termById(card.id);
    return `
      ${head('PM学習', 'PMBOK第8版を軸に、エンジニアやお客様と同じ言葉で話せるようにする。1日1語で十分。', 'one word a day')}
      <section class="card" data-tone="salmon">
        <h2 class="card-title">ふりかえり</h2>
        <p class="meta">ふりかえった語 ${seen} / ${terms.length}　今日 ${S.pmDays[ymd()] || 0}回　復習待ち ${dueTerms().length}語</p>
        <div class="meter" aria-hidden="true"><i style="width:${Math.round(seen / terms.length * 100)}%"></i></div>
        <div class="flash">
          <p class="term-subj">${esc(t.s)}</p>
          <p class="flash-name">${esc(t.t)}</p>
          ${card.open ? `<p class="term-one">${esc(t.one)}</p><p>${escBr(t.body)}</p>${t.work ? `<h4>Web制作の経験でいうと</h4><p>${esc(t.work)}</p>` : ''}
            <div class="row"><button class="btn" data-act="rev" data-ok="1">わかった</button><button class="btn-line" data-act="rev" data-ok="0">あやしい</button></div>`
          : '<p class="meta">どんな意味か、頭の中で説明してみてから開く。</p><div class="row"><button class="btn" data-act="flip">答えを見る</button><button class="btn-quiet" data-act="skip">ほかの語にする</button></div>'}
        </div>
      </section>
      <form class="search" data-form="search" role="search">
        <span class="search-icon">${icon('search')}</span>
        <input id="q" type="search" name="q" value="${esc(searchQ)}" placeholder="例：テーラリング、WBS、RAG" aria-label="調べる言葉" autocomplete="off">
        <button class="btn">調べる</button>
      </form>
      <div id="results" class="card">${resultsHtml(searchQ)}</div>
      <section class="card" data-tone="blue">
        <h2 class="card-title">PMBOK第8版の地図</h2>
        <p class="meta">2025年11月発行。押すと解説が開きます。</p>
        ${PMBOK_MAP.map(([h, items]) => `<p class="map-head">${esc(h)}</p><div class="chips">${items.map(([label, id]) =>
          `<button class="chip${S.study[id] ? ' is-seen' : ''}" data-act="show-term" data-id="${id}">${esc(label)}</button>`).join('')}</div>`).join('')}
        <p class="meta"><button class="btn-quiet" data-act="show-term" data-id="pmbok-guide">PMBOKガイドとは（版ごとの違い）</button></p>
      </section>
      <section class="card">
        <h2 class="card-title">用語一覧</h2>
        ${PM_SUBJECTS.map(s => [s, terms.filter(x => x.s === s)]).filter(([, ts]) => ts.length).map(([s, ts]) =>
          `<details><summary>${esc(s)}（${ts.length}）</summary><div class="chips">${ts.map(x =>
            `<button class="chip${S.study[x.id] ? ' is-seen' : ''}" data-act="show-term" data-id="${esc(x.id)}">${esc(x.t)}</button>`).join('')}</div></details>`).join('')}
      </section>`;
  }

  // ── 画面：ふりかえり（週に1回） ──
  function viewWeek() {
    const wk = weekStart();
    const cur = reviewOf(wk) || {};
    const steps = Array.from({ length: 7 }, (_, i) => addDays(wk, i)).map(k => [k, day(k)]).filter(([, r]) => r.step || r.rest);
    const past = reviews().filter(r => r.week !== wk);
    return `
      ${head('今週のふりかえり', '週に1回、3分。答えは1行でよい。ここに残る「自分で決めたこと」が、将来の実績と仲間につながる。', 'weekly review')}
      <section class="card">
        <h2 class="card-title">今週の歩み</h2>
        ${weekDots()}
        ${steps.length ? `<ul class="log">${steps.map(([k, r]) => `<li><span class="meta">${jpShort(k)}</span>${r.rest && !r.done ? '休んだ' : `${esc(r.step)}${r.done ? '' : '（まだ）'}`}</li>`).join('')}</ul>`
          : '<p class="meta">今週の一歩は、まだありません。</p>'}
      </section>
      <section class="card" data-tone="salmon">
        <form class="form" data-form="review">
          <label>今週、自分で決めたこと<span class="hint">小さな判断でよい（社名・顧客名は書かない）</span><input name="decided" value="${esc(cur.decided || '')}" placeholder="例：引き継ぎの順番を、相手の案件の締切から決めた"></label>
          <label>誰と、何をしたか<span class="hint">「この人と組みたい」と思った人がいれば</span><input name="people" value="${esc(cur.people || '')}" placeholder="例：後任の人と、案件の判断の理由を共有した"></label>
          <label>来週の一歩<span class="hint">「きょう」の一歩の候補に出ます</span><input name="next" value="${esc(cur.next || '')}" placeholder="例：PMBOKの「ステークホルダー」を読む"></label>
          <div><button class="btn">${cur.id ? '書き直す' : '残す'}</button></div>
        </form>
      </section>
      ${past.length ? `<section class="card"><h2 class="card-title">これまでのふりかえり</h2>
        ${past.slice(0, 12).map(r => `<article class="past"><p class="meta">${jpShort(r.week)}〜 の週</p>
          ${r.decided ? `<p><b>決めた：</b>${esc(r.decided)}</p>` : ''}${r.people ? `<p><b>人：</b>${esc(r.people)}</p>` : ''}${r.next ? `<p><b>次：</b>${esc(r.next)}</p>` : ''}</article>`).join('')}
      </section>` : ''}
      ${oldRecordsHtml()}`;
  }
  // 前の版の記録（積み上げ・寝る前の3行）は消さずに、たたんで見られるようにする
  function oldRecordsHtml() {
    const wins = (S.wins || []).slice().reverse();
    const js = (S.journal || []).filter(j => !j.kind).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!wins.length && !js.length) return '';
    return `<section class="card"><details><summary>前の版の記録（積み上げ ${wins.length}件・3行 ${js.length}日）</summary>
      ${js.slice(0, 30).map(j => `<p class="old"><span class="meta">${jpShort(j.date)}</span>${[j.did, j.good].filter(Boolean).map(esc).join(' ／ ')}</p>`).join('')}
      ${wins.slice(0, 60).map(w => `<p class="old"><span class="meta">${jpShort(w.date)}</span>${esc(w.text)}</p>`).join('')}
    </details></section>`;
  }

  // ── 画面：設定 ──
  function viewSettings() {
    return `
      ${head('設定')}
      <section class="card">
        <h2 class="card-title">わたし</h2>
        <div class="profile-row">${meHtml()}
          <div class="row"><label class="btn-line">画像を選ぶ<input type="file" accept="image/*" data-act="avatar" hidden></label>
          ${profile().avatar ? '<button type="button" class="btn-quiet" data-act="avatar-del">画像を外す</button>' : ''}</div></div>
        <form class="form" data-form="profile">
          <label>呼び名<input name="name" value="${esc(profile().name)}" placeholder="例：Makito"></label>
          <label>目指す姿（「なぜ」の画面の一番上）<textarea name="vision" rows="2">${esc(S.vision)}</textarea></label>
          <div><button class="btn">保存する</button></div>
        </form>
      </section>
      <section class="card" id="sync" data-tone="blue">
        <h2 class="card-title">PCとスマホの同期</h2>
        <p class="meta">GitHub の非公開リポジトリに、合言葉で暗号化して保存します。</p>
        <form class="form" data-form="sync" autocomplete="off">
          <label>GitHub のユーザー名<input name="owner" value="${esc(sync.owner || '')}" autocapitalize="off" spellcheck="false"></label>
          <label>保存用のリポジトリ名（非公開）<input name="repo" value="${esc(sync.repo || 'tsumiage-data')}" autocapitalize="off" spellcheck="false"></label>
          <label>アクセストークン<input name="token" type="password" value="${esc(sync.token || '')}" autocapitalize="off" spellcheck="false" placeholder="github_pat_…"></label>
          <label>合言葉<input name="pass" type="password" value="${esc(sync.pass || '')}" autocapitalize="off"></label>
          <label>トークンの期限（任意）<input name="exp" type="date" value="${esc(sync.exp || '')}"></label>
          <div class="row"><button class="btn">保存して同期する</button>
            ${syncReady() ? '<button type="button" class="btn-line" data-act="sync-now">いま同期する</button><button type="button" class="btn-quiet" data-act="sync-off">この端末の同期をやめる</button>' : ''}</div>
          <p class="meta sync-status" role="status">${esc(syncStatusText())}</p>
        </form>
      </section>
      <section class="card">
        <h2 class="card-title">バックアップと表示</h2>
        <div class="row">
          <button class="btn" data-act="export">書き出す</button>
          <label class="btn-line">読み込む<input type="file" accept="application/json,.json" data-act="import" hidden></label>
        </div>
        <div class="row">
          <button class="btn-line" data-act="theme" data-v="">端末に合わせる</button>
          <button class="btn-line" data-act="theme" data-v="light">ライト</button>
          <button class="btn-line" data-act="theme" data-v="dark">ダーク</button>
        </div>
      </section>`;
  }

  // ── 用語の解説（ダイアログ） ──
  function showTerm(id) {
    const t = termById(id); if (!t) return;
    const dlg = $('#dlg');
    dlg.innerHTML = `${termCard(t, true)}<div class="row close-row"><button class="btn" data-act="rev-dlg" data-id="${esc(id)}" data-ok="1">わかった</button><button class="btn-line" data-act="dlg-close">閉じる</button></div>`;
    dlg.showModal();
  }

  // ── 描画 ──
  const VIEWS = { today: viewToday, why: viewWhy, pm: viewPm, week: viewWeek, settings: viewSettings };
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
  }
  let pendingRender = false;
  const typing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'file'; };
  function softRender() { if (typing()) { pendingRender = true; return; } render(); }
  document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !typing()) { pendingRender = false; render(); } }, 300));

  // ── 操作 ──
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    switch (el.dataset.act) {
      case 'feel': {
        const v = +el.dataset.v;
        setDay({ m: v }); render();
        if (v === 2) toast('今日は、休むのも一歩のうちです。');
        break;
      }
      case 'step-pick': setDay({ step: el.dataset.v, done: false, rest: false }); render(); break;
      case 'step-done': setDay({ done: true, rest: false }); render(); toast(`できました。${walkedCount()}日目の一歩です。`); break;
      case 'step-rest': setDay({ rest: true, done: false }); render(); toast('休む日にしました。よく休んでください。'); break;
      case 'step-undo': setDay({ done: false, rest: false }); render(); break;
      case 'step-clear': setDay({ step: '', done: false, rest: false }); render(); break;
      case 'show-term': showTerm(el.dataset.id); break;
      case 'dlg-close': $('#dlg').close(); break;
      case 'rev-dlg': review(el.dataset.id, true); $('#dlg').close(); render(); break;
      case 'flip': card.open = true; render(); break;
      case 'skip': card = { id: nextCard(), open: false }; render(); break;
      case 'rev': review(card.id, el.dataset.ok === '1'); card = { id: nextCard(), open: false }; render(); break;
      case 'why-reset': {
        const w = { ...S.why }; delete w[el.dataset.k]; S.why = w; touchSettings(); save(); render(); break;
      }
      case 'sync-now': syncNow({ manual: true }); break;
      case 'sync-off':
        if (!confirm('この端末の同期をやめます。記録はこの端末に残ります。')) return;
        sync = {}; saveSync(); render(); break;
      case 'export': {
        const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `Mindwalk-${ymd()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast('書き出しました。'); break;
      }
      case 'theme': {
        const v = el.dataset.v;
        try { if (v) localStorage.setItem('tsumiage.theme', v); else localStorage.removeItem('tsumiage.theme'); } catch (err) { /* 無視 */ }
        applyTheme(); break;
      }
      case 'avatar-del':
        S.profile = { ...profile(), avatar: '' }; touchSettings(); save(); render(); break;
    }
  });

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
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.act === 'avatar' && el.files[0]) {
      shrinkImage(el.files[0]).then(url => { S.profile = { ...profile(), avatar: url }; touchSettings(); save(); render(); })
        .catch(() => toast('この画像は読み込めませんでした。'));
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
        S = migrate({ ...blank(), ...data, settingsAt: Date.now() }); save(); render(); toast('読み込みました。');
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
      case 'step': setDay({ step: d.step.trim(), done: false, rest: false }); render(); break;
      case 'why':
        S.why = { ...S.why, [f.dataset.k]: d.a.trim() }; touchSettings(); save(); render(); toast('自分の言葉にしました。'); break;
      case 'letter':
        S.why = { ...S.why, letter: d.letter.trim() }; touchSettings(); save(); render(); toast('残しました。しんどい日に届きます。'); break;
      case 'facts':
        S.facts = d.facts.split('\n').map(s => s.trim()).filter(Boolean); touchSettings(); save(); render(); toast('保存しました。'); break;
      case 'review': {
        const wk = weekStart(), v = { decided: d.decided.trim(), people: d.people.trim(), next: d.next.trim() };
        if (!v.decided && !v.people && !v.next) { toast('1行だけでも大丈夫です。'); return; }
        const cur = reviewOf(wk);
        if (cur) Object.assign(cur, v, { u: Date.now() });
        else S.journal = [...(S.journal || []), { id: uid(), kind: 'week', week: wk, date: ymd(), ...v, u: Date.now() }];
        save(); render(); toast('残しました。今週もおつかれさまでした。'); break;
      }
      case 'search': searchQ = d.q; $('#results').innerHTML = resultsHtml(searchQ); break;
      case 'profile':
        S.profile = { ...profile(), name: d.name.trim() }; S.vision = d.vision.trim(); touchSettings(); save(); render(); toast('保存しました。'); break;
      case 'sync': {
        const next = { owner: d.owner.trim(), repo: d.repo.trim(), token: d.token.replace(/\s+/g, ''), pass: d.pass, exp: d.exp || '' };
        if (!next.owner || !next.repo || !next.token || !next.pass) { toast('4つの欄をすべて入れてください。'); return; }
        if (next.owner !== sync.owner || next.repo !== sync.repo || next.pass !== sync.pass) { sync = { ...next }; keyCache = null; }
        else sync = { ...sync, ...next };
        saveSync(); render(); syncNow({ manual: true }); break;
      }
    }
  });

  let searchTimer;
  document.addEventListener('input', e => {
    if (e.target.id !== 'q') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchQ = e.target.value; $('#results').innerHTML = resultsHtml(searchQ); }, 200);
  });

  function applyTheme() {
    let v = '';
    try { v = localStorage.getItem('tsumiage.theme') || ''; } catch (e) { /* 無視 */ }
    if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
  }

  window.addEventListener('hashchange', () => render(true));
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
