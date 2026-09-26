'use strict';
(() => {
  const KEY = 'tsumiage.v1';
  const CATS = {
    job: '転職活動', note: 'note', music: '音楽', study: '診断士', other: 'そのほか',
  };
  const STAGES = { note: ['ネタ', '下書き', '公開'], music: ['ネタ', '制作中', '完成・公開'] };
  const INTERVALS = [1, 3, 7, 14, 30, 60];
  const TINY = ['10分だけ外を歩く', '診断士の用語を1つだけ見る', '好きな曲を1曲聴く', '今日は早めに寝る'];
  const MILESTONES = [10, 30, 50, 100, 200, 300, 500, 1000];

  const blank = () => ({
    version: 1,
    mainLabel: '転職活動',
    goals: { note: 1, music: 1 },
    facts: [],
    links: { note: '', youtube: '', x: '' },
    tasks: [], wins: [], ideas: [],
    study: {}, studyDays: {}, myTerms: [],
  });

  let S = load();
  let quiz = null;
  let searchQ = '';
  let lastWinId = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { ...blank(), ...JSON.parse(raw) };
    } catch (e) { /* 保存が使えない環境でも表示はできる */ }
    return blank();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('保存できませんでした。ブラウザでサイトデータの保存が許可されているか確認してください。'); }
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

  const claudeUrl = prompt => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
  const termPrompt = word => `中小企業診断士の勉強をしています。「${word}」について、次の順で平易な日本語で解説してください。\n1. 一言でいうと\n2. 詳しい解説（提唱者や関連する用語も）\n3. 試験で問われやすいポイント\n4. Webディレクターの仕事に置き換えた例`;

  // ── 積み上げ ──
  const winsSince = from => S.wins.filter(w => w.date >= from);
  function addWin(cat, text, extra = {}) {
    const w = { id: uid(), date: ymd(), ts: Date.now(), cat, text, ...extra };
    S.wins.push(w);
    lastWinId = w.id;
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
  function dailyTerm() {
    const due = dueTerms();
    if (due.length) return pickDaily(due, 'due');
    const unseen = allTerms().filter(t => !S.study[t.id]);
    return pickDaily(unseen.length ? unseen : allTerms(), 'term');
  }
  function review(id, ok) {
    const r = S.study[id];
    const lv = ok ? (r ? Math.min(r.lv + 1, INTERVALS.length - 1) : 0) : 0;
    const today = ymd();
    S.study[id] = { lv, due: addDays(today, ok ? INTERVALS[lv] : 1), count: (r ? r.count : 0) + 1, last: today };
    const n = (S.studyDays[today] || 0) + 1;
    S.studyDays[today] = n;
    const key = `study-${today}`;
    const text = `診断士の用語を${n}語ふりかえった`;
    const w = S.wins.find(x => x.key === key);
    if (w) w.text = text;
    else { S.wins.push({ id: uid(), date: today, ts: Date.now(), cat: 'study', text, key }); }
    save();
    toast(ok ? `今日${n}語目。${INTERVALS[lv]}日後にもう一度出します。` : `今日${n}語目。明日もう一度出します。`);
  }

  // ── 部品 ──
  function stackHtml(max = 40) {
    const ws = S.wins.slice(-max);
    if (!ws.length) return '<div class="stack is-empty" aria-hidden="true"><span></span></div>';
    return `<div class="stack" aria-hidden="true">${ws.map(w =>
      `<span data-cat="${w.cat}" class="${w.id === lastWinId ? 'is-new' : ''}" style="width:${52 + hash(w.id) % 48}%"></span>`).join('')}</div>`;
  }

  function taskItem(t) {
    return `<li class="task" data-cat="${t.cat}"><div>
      <p class="task-what">${esc(t.what)}</p>
      ${t.when ? `<p class="task-when">${esc(t.when)}</p>` : ''}
      ${t.mini ? `<p class="task-mini">5分版：${esc(t.mini)}</p>` : ''}
      <div class="task-acts">
        <button class="btn" data-act="task-done" data-id="${t.id}">できた</button>
        ${t.mini ? `<button class="btn-line" data-act="task-mini" data-id="${t.id}">5分版だけできた</button>` : ''}
        <button class="btn-icon" data-act="task-del" data-id="${t.id}" aria-label="「${esc(t.what)}」を消す">消す</button>
      </div></div></li>`;
  }

  function taskForm(cat) {
    return `<details class="add"><summary>次の1歩を決める</summary>
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
    const dots = Array.from({ length: Math.max(goal, n) }, (_, i) => `<span class="dot${i < n ? ' on' : ''}"></span>`).join('');
    return `<div class="goal" data-cat="${cat}">
      <div class="goal-head"><span class="goal-name">${CATS[cat]}</span>
        <span class="goal-num">${per} ${n} / ${goal}${unit}</span><span class="dots" aria-hidden="true">${dots}</span></div>
      ${n >= goal ? `<p class="goal-done">${per}の目安に届きました。</p>` : ''}
      <details class="add"><summary>${cat === 'music' ? '曲を公開した' : '記事を公開した'}</summary>
        <form class="form form-inline" data-form="pub" data-cat="${cat}">
          <input name="title" required placeholder="タイトル" aria-label="タイトル"><button class="btn">記録する</button>
        </form></details></div>`;
  }

  function termCard(t, { open = false, quizMode = false } = {}) {
    const acts = `<div class="term-acts">
        <button class="btn" data-act="rev-ok" data-id="${esc(t.id)}"${quizMode ? ' data-quiz' : ''}>わかった</button>
        <button class="btn-line" data-act="rev-ng" data-id="${esc(t.id)}"${quizMode ? ' data-quiz' : ''}>あやしい</button>
        <a class="link" href="${claudeUrl(termPrompt(t.t))}" target="_blank" rel="noopener">Claudeにもっと聞く</a>
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
    const { lines, fact } = encourage();
    const jobTasks = S.tasks.filter(t => !t.done && t.cat === 'job');
    const subTasks = S.tasks.filter(t => !t.done && t.cat !== 'job');
    const studied = S.studyDays[ymd()] || 0;
    const term = dailyTerm();
    return `
      <header class="hero">
        <div><p class="hero-date">${jpDate()}</p><p class="hero-count"><b>${total}</b>件の積み上げ</p></div>
        ${stackHtml()}
      </header>
      <section class="word" aria-label="きょうのことば">
        ${lines.map(l => `<p>${esc(l)}</p>`).join('')}
        ${fact ? `<p class="fact">${esc(fact)}</p>` : ''}
      </section>
      <section class="block">
        <h2 class="role"><span class="role-tag is-main">主役</span>${esc(S.mainLabel)}</h2>
        ${jobTasks.length ? `<ul class="tasks">${jobTasks.map(taskItem).join('')}</ul>`
          : '<p class="empty">次の1歩がまだありません。「いつ・どこで・何を」まで決めておくと、動き出しやすくなります。</p>'}
        ${taskForm('job')}
      </section>
      <section class="block">
        <h2 class="role"><span class="role-tag">脇役</span>発信</h2>
        ${goalRow('note')}${goalRow('music')}
        ${subTasks.length ? `<ul class="tasks">${subTasks.map(taskItem).join('')}</ul>` : ''}
      </section>
      <section class="block daily">
        <h2 class="role"><span class="role-tag">1日1語</span>診断士</h2>
        ${studied ? `<p class="meta">今日は${studied}語ふりかえりました。続けるなら <a class="link" href="#/study">診断士の画面へ</a></p>` : ''}
        ${term && !studied ? termCard(term) : ''}
      </section>
      <div class="down-wrap"><button class="btn-quiet" data-act="down">今日はしんどい</button></div>`;
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
          return `<div class="idea" data-cat="${cat}"><div>
            <p class="idea-title">${esc(i.title)}</p>
            <p class="stage">いま：<b>${STAGES[cat][i.stage]}</b></p>
            <div class="task-acts">
              <button class="btn-line" data-act="idea-next" data-id="${i.id}">「${next}」に進める</button>
              <button class="btn-icon" data-act="idea-del" data-id="${i.id}" aria-label="「${esc(i.title)}」を消す">消す</button>
            </div></div></div>`;
        }).join('') : '<p class="empty">ネタはまだありません。</p>'}
        ${doneN ? `<p class="meta">公開済み ${doneN}件</p>` : ''}`;
    };
    return `
      <header class="page-head"><h1>発信</h1>
        <p class="lead">ネタを書きとめて、公開まで進めます。note は週${S.goals.note}本、音楽は月${S.goals.music}曲が目安です。</p></header>
      <section>${goalRow('note')}${goalRow('music')}</section>
      <section class="block"><h2>ネタ帳</h2>
        <form class="form form-row" data-form="idea">
          <select name="cat" aria-label="分類"><option value="note">note</option><option value="music">音楽</option></select>
          <input name="title" required placeholder="例：〇〇の制作ノート" aria-label="ネタ">
          <button class="btn">追加</button>
        </form>
        <div class="ideas">${ideaList('note')}${ideaList('music')}</div>
      </section>
      <section class="block"><h2>発信先</h2>
        ${linkItems.length ? `<p class="links">${linkItems.map(([k, n]) => `<a class="link" href="${esc(L[k])}" target="_blank" rel="noopener">${n}を開く</a>`).join('')}</p>`
          : '<p class="empty">設定でURLを登録すると、ここから開けます。</p>'}
      </section>`;
  }

  // ── 画面：診断士 ──
  function resultsHtml(q) {
    if (!q.trim()) return '';
    const r = search(q);
    const ask = `<a class="btn is-accent" href="${claudeUrl(termPrompt(q.trim()))}" target="_blank" rel="noopener">Claudeに解説してもらう</a>`;
    if (!r.length) {
      return `<div class="notfound">
        <p>「${esc(q)}」はまだ辞書にありません。Claudeに聞いて、よければ自分の辞書に登録しておきましょう。</p>
        <div class="row">${ask}</div>
        <details class="add"><summary>自分の辞書に登録する</summary>
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
      <header class="page-head"><h1>診断士</h1>
        <p class="lead">本で読んだ言葉を入れると、解説が出ます。1日1語でも積み上がります。</p></header>
      <form class="search" data-form="search" role="search">
        <input id="q" type="search" name="q" value="${esc(searchQ)}" placeholder="例：コア・コンピタンス、損益分岐点" aria-label="調べる言葉" autocomplete="off">
        <button class="btn">調べる</button>
      </form>
      <div id="results">${resultsHtml(searchQ)}</div>
      <section class="block"><h2>用語ふりかえり</h2>
        <p class="meta" style="margin-bottom:12px">ふりかえった語 ${seen} / ${terms.length}　今日 ${S.studyDays[ymd()] || 0}語　復習待ち ${dueTerms().length}語</p>
        <div id="quiz">${quizHtml()}</div>
      </section>
      <section class="block"><h2>計算ふりかえり</h2>
        <p class="meta">数字を変えると、その場で答えが変わります。本の例題の数字を入れて、答え合わせにも使えます。</p>
        ${FORMULAS.map(formulaHtml).join('')}
      </section>
      <section class="block glossary-list"><h2>用語一覧</h2>
        ${bySubj.map(([s, ts]) => `<details><summary>${esc(s)}（${ts.length}）</summary><div class="row">
          ${ts.map(t => `<button class="chip${S.study[t.id] ? ' is-seen' : ''}" data-act="show-term" data-id="${esc(t.id)}">${esc(t.t)}</button>`).join('')}
        </div></details>`).join('')}
      </section>`;
  }

  // ── 画面：積み上げ ──
  function viewLog() {
    const week = winsSince(weekStart());
    const counts = Object.keys(CATS).map(c => [c, week.filter(w => w.cat === c).length]).filter(([, n]) => n);
    const byDay = {};
    S.wins.slice().reverse().forEach(w => { (byDay[w.date] = byDay[w.date] || []).push(w); });
    return `
      <header class="page-head"><h1>積み上げ</h1>
        <p class="lead">できたことを1行で残します。小さなことほど書いておく価値があります。</p></header>
      <form class="form" data-form="win">
        <label>できたこと<input name="text" required placeholder="例：職務経歴書の実績を1つ書き直した"></label>
        <div class="row"><select name="cat" aria-label="分類" style="width:auto">${catOptions('job')}</select><button class="btn">記録する</button></div>
      </form>
      <section class="block"><h2>今週 ${week.length}件</h2>
        ${counts.length ? `<p class="week-sum">${counts.map(([c, n]) => `<span data-cat="${c}">${CATS[c]} ${n}</span>`).join('')}</p>` : '<p class="empty">今週の記録はまだありません。</p>'}
      </section>
      <section class="block"><h2>これまで ${S.wins.length}件</h2>
        ${Object.keys(byDay).length ? Object.entries(byDay).map(([d, ws]) => `<div class="day"><h3>${jpDate(parseYmd(d))}</h3>
          ${ws.map(w => `<div class="win" data-cat="${w.cat}"><p><span class="win-cat">${CATS[w.cat] || ''}</span>${esc(w.text)}</p>
            <button class="btn-icon" data-act="win-del" data-id="${w.id}" aria-label="「${esc(w.text)}」を消す">×</button></div>`).join('')}</div>`).join('')
          : '<p class="empty">最初の1件を上から記録しましょう。</p>'}
      </section>`;
  }

  // ── 画面：設定 ──
  function viewSettings() {
    return `
      <header class="page-head"><h1>設定</h1></header>
      <form class="settings-group" data-form="settings">
        <label class="form" style="margin:0">わたしの事実（1行に1つ）
          <textarea name="facts" rows="8" placeholder="例：〇〇の案件で、△△を□□まで改善した">${esc(S.facts.join('\n'))}</textarea>
          <span class="hint">これまでの経歴や実績を書いておくと、「きょう」の画面や、しんどい日に1つずつ表示されます。</span>
        </label>
        <div class="form" style="margin:0">
          <label>主役の名前<input name="mainLabel" value="${esc(S.mainLabel)}"></label>
          <div class="goal-inputs">
            <label>note（週に何本）<input type="number" min="1" name="gNote" value="${S.goals.note}"></label>
            <label>音楽（月に何曲）<input type="number" min="1" name="gMusic" value="${S.goals.music}"></label>
          </div>
        </div>
        <div class="form" style="margin:0">
          <label>note のURL<input type="url" name="lNote" value="${esc(S.links.note)}"></label>
          <label>YouTube のURL<input type="url" name="lYoutube" value="${esc(S.links.youtube)}"></label>
          <label>X のURL<input type="url" name="lX" value="${esc(S.links.x)}"></label>
        </div>
        <div><button class="btn">設定を保存する</button></div>
      </form>
      <section class="block"><h2>データの引っ越し・バックアップ</h2>
        <p class="meta">データはこの端末のブラウザの中だけに保存されます。スマホとPCで同じ内容を使うときは、片方で書き出したファイルを、もう片方で読み込みます（Mac と iPhone なら AirDrop が手軽です）。</p>
        <div class="row" style="margin-top:12px">
          <button class="btn" data-act="export">書き出す</button>
          <label class="btn-line" style="display:inline-flex;align-items:center;cursor:pointer">読み込む<input type="file" accept="application/json,.json" data-act="import" hidden></label>
        </div>
      </section>
      <section class="block"><h2>表示</h2>
        <div class="row">
          <button class="btn-line" data-act="theme" data-v="">端末に合わせる</button>
          <button class="btn-line" data-act="theme" data-v="light">ライト</button>
          <button class="btn-line" data-act="theme" data-v="dark">ダーク</button>
        </div>
      </section>
      <section class="block"><h2>すべて消す</h2>
        <p class="meta">この端末のデータをすべて消します。先に「書き出す」でバックアップを取ってください。</p>
        <div style="margin-top:12px"><button class="btn-line danger" data-act="reset">この端末のデータを消す</button></div>
      </section>`;
  }

  // ── しんどい日 ──
  function openDown() {
    const dlg = $('#down');
    const facts = shuffle(S.facts).slice(0, 3);
    const recent = S.wins.slice(-3).reverse();
    dlg.innerHTML = `
      <h2 id="down-title">今日は、立て直す日にします。</h2>
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
    document.querySelectorAll('[data-view]').forEach(a => {
      if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (routeChanged) { window.scrollTo(0, 0); $('#main').focus({ preventScroll: true }); }
    else window.scrollTo(0, y);
    lastWinId = null;
  }

  // ── 操作 ──
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case 'task-done': {
        const t = S.tasks.find(x => x.id === id); if (!t) return;
        t.done = true; t.doneAt = ymd(); addWin(t.cat, t.what); render(); break;
      }
      case 'task-mini': {
        const t = S.tasks.find(x => x.id === id); if (!t) return;
        addWin(t.cat, `5分版：${t.mini}（${t.what}）`); render(); break;
      }
      case 'task-del': S.tasks = S.tasks.filter(x => x.id !== id); save(); render(); break;
      case 'win-del':
        if (!confirm('この記録を消しますか？')) return;
        S.wins = S.wins.filter(x => x.id !== id); save(); render(); break;
      case 'idea-next': {
        const i = S.ideas.find(x => x.id === id); if (!i) return;
        i.stage += 1;
        const last = i.stage === STAGES[i.cat].length - 1;
        if (last) addWin(i.cat, `「${i.title}」を公開した`, { pub: true });
        else addWin(i.cat, `「${i.title}」を${STAGES[i.cat][i.stage]}まで進めた`);
        render(); break;
      }
      case 'idea-del': S.ideas = S.ideas.filter(x => x.id !== id); save(); render(); break;
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
        S.myTerms = S.myTerms.filter(x => x.id !== id); delete S.study[id]; save(); searchQ = ''; render(); break;
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
        if (!confirm('この端末のデータをすべて消します。よろしいですか？')) return;
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
        S = { ...blank(), ...data }; save(); render(); toast('読み込みました。');
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
        S.tasks.push({ id: uid(), cat: d.cat, what: d.what.trim(), when: d.when.trim(), mini: d.mini.trim(), done: false, created: ymd() });
        save(); render(); toast('次の1歩を決めました。'); break;
      case 'pub':
        addWin(f.dataset.cat, `「${d.title.trim()}」を公開した`, { pub: true }); render(); break;
      case 'idea':
        S.ideas.push({ id: uid(), cat: d.cat, title: d.title.trim(), stage: 0, created: ymd() });
        save(); render(); toast('ネタ帳に追加しました。'); break;
      case 'win':
        addWin(d.cat, d.text.trim()); render(); break;
      case 'search':
        searchQ = d.q; $('#results').innerHTML = resultsHtml(searchQ); break;
      case 'myterm':
        S.myTerms.push({ id: `my-${uid()}`, t: d.t.trim(), s: d.s, one: d.one.trim(), body: d.body.trim(), y: [] });
        save(); searchQ = d.t.trim(); render(); toast('自分の辞書に登録しました。'); break;
      case 'settings':
        S.facts = d.facts.split('\n').map(s => s.trim()).filter(Boolean);
        S.mainLabel = d.mainLabel.trim() || '転職活動';
        S.goals = { note: Math.max(1, +d.gNote || 1), music: Math.max(1, +d.gMusic || 1) };
        S.links = { note: d.lNote.trim(), youtube: d.lYoutube.trim(), x: d.lX.trim() };
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden && route() === 'today') render(); });

  applyTheme();
  render(true);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
