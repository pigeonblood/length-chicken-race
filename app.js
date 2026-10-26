/* =========================================================
   ○○長さチキンレース！  app.js
   - 依存ライブラリなし。GitHub Pages にそのまま置けば動きます。
   - 回答者とポイントはブラウザの localStorage に保存されます。
   - 画像はブラウザ内だけで扱い、どこにもアップロードされません。
   ========================================================= */
(() => {
  'use strict';

  /* ---------------- 定数 ---------------- */
  const STORE_KEY = 'nagasa-chicken-race:v1';
  const PALETTE = ['#E63B2E', '#2667D9', '#1FA15A', '#F08A12', '#8E44C9', '#13A3B5',
                   '#E14D8F', '#8A5A2E', '#B39B00', '#3B4CB0', '#5FA81E', '#5C6670'];
  const MAX_PLAYERS = 12;
  const DEFAULT_START = 0.2;
  const DEFAULT_ANSWER = 0.8;
  const LINE_GAP = 0.02;     // スタートと正解ラインの最小間隔
  const EPS = 0.001;         // 「伸ばす」ときの最小の伸び
  const P_MARGIN = 0.05;     // ひし形を画像の端に寄せすぎない

  /* ---------------- 保存 ---------------- */
  function loadStore() {
    const fallback = { players: [], sound: true };
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!raw || !Array.isArray(raw.players)) return fallback;
      const players = raw.players
        .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string')
        .map(p => ({
          id: p.id,
          name: p.name.slice(0, 12),
          color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : PALETTE[0],
          points: Number.isFinite(p.points) ? Math.max(0, Math.floor(p.points)) : 0,
        }))
        .slice(0, MAX_PLAYERS);
      return { players, sound: raw.sound !== false };
    } catch (e) {
      return fallback;
    }
  }
  const store = loadStore();
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* private mode 等 */ }
  }

  /* ---------------- ユーティリティ ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const playerById = id => store.players.find(p => p.id === id);

  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v)) {
            if (sk.startsWith('--')) n.style.setProperty(sk, sv); else n.style[sk] = sv;
          }
        } else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      n.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return n;
  }

  /* 向き（dir）と座標の変換
     t: 開いていく方向に沿った位置（0=開始側の端, 1=終わりの端）
     p: それと直交する位置 */
  const isHoriz = dir => dir === 'right' || dir === 'left';
  function toXY(dir, t, p) {
    switch (dir) {
      case 'right': return { x: t, y: p };
      case 'left':  return { x: 1 - t, y: p };
      case 'down':  return { x: p, y: t };
      default:      return { x: p, y: 1 - t }; // up
    }
  }
  function fromXY(dir, x, y) {
    switch (dir) {
      case 'right': return { t: x, p: y };
      case 'left':  return { t: 1 - x, p: y };
      case 'down':  return { t: y, p: x };
      default:      return { t: 1 - y, p: x };
    }
  }
  function placeLine(node, dir, t) {
    const { x, y } = toXY(dir, t, 0);
    node.classList.toggle('is-v', isHoriz(dir));
    node.classList.toggle('is-h', !isHoriz(dir));
    if (isHoriz(dir)) { node.style.left = (x * 100) + '%'; node.style.top = ''; }
    else { node.style.top = (y * 100) + '%'; node.style.left = ''; }
  }
  function placeRegion(node, dir, t0, t1) {
    const a = t0 * 100, b = t1 * 100, s = node.style;
    switch (dir) {
      case 'right': Object.assign(s, { left: a + '%', top: '0', width: (b - a) + '%', height: '100%' }); break;
      case 'left':  Object.assign(s, { left: (100 - b) + '%', top: '0', width: (b - a) + '%', height: '100%' }); break;
      case 'down':  Object.assign(s, { left: '0', top: a + '%', width: '100%', height: (b - a) + '%' }); break;
      default:      Object.assign(s, { left: '0', top: (100 - b) + '%', width: '100%', height: (b - a) + '%' }); break;
    }
    node.dataset.dir = dir;
  }
  function pointerFrac(e, el) {
    const r = el.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  }
  function fitStage(fitEl, stageEl, natW, natH) {
    const W = fitEl.clientWidth, H = fitEl.clientHeight;
    if (!natW || !natH || !W || !H) return;
    const a = natW / natH;
    let w = W, hh = W / a;
    if (hh > H) { hh = H; w = H * a; }
    stageEl.style.width = Math.floor(w) + 'px';
    stageEl.style.height = Math.floor(hh) + 'px';
  }

  /* ---------------- 効果音（Web Audio） ---------------- */
  const Sound = {
    ctx: null,
    ensure() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          this.ctx = new AC();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      } catch (e) { return null; }
    },
    tone(freq, dur, { type = 'sine', vol = 0.12, at = 0, to = null } = {}) {
      if (!store.sound) return;
      const ctx = this.ensure(); if (!ctx) return;
      const t0 = ctx.currentTime + at;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0); o.stop(t0 + dur + 0.03);
    },
    tap()    { this.tone(880, 0.06, { type: 'triangle', vol: 0.07 }); },
    decide() { this.tone(660, 0.08, { type: 'triangle' }); this.tone(990, 0.14, { type: 'triangle', at: 0.07 }); },
    extend() { this.tone(520, 0.1, { type: 'square', vol: 0.05, to: 900 }); },
    drop()   { this.tone(500, 0.18, { type: 'triangle', vol: 0.1, to: 260 }); },
    tick()   { this.tone(1400, 0.025, { type: 'square', vol: 0.03 }); },
    phase()  { [523, 659, 784].forEach((f, i) => this.tone(f, 0.14, { type: 'square', vol: 0.05, at: i * 0.09 })); },
    line()   { this.tone(200, 0.35, { type: 'sawtooth', vol: 0.05, to: 600 }); },
    safe()   { this.tone(740, 0.12, { type: 'triangle', vol: 0.08 }); },
    dobon()  { this.tone(330, 0.6, { type: 'sawtooth', vol: 0.08, to: 60 }); this.tone(90, 0.3, { type: 'sine', vol: 0.18, at: 0.02 }); },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, { type: 'triangle', vol: 0.12, at: i * 0.1 }));
      this.tone(1047, 0.7, { type: 'triangle', vol: 0.1, at: 0.42 });
      this.tone(1319, 0.7, { type: 'triangle', vol: 0.07, at: 0.42 });
    },
    allout() { [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.28, { type: 'triangle', vol: 0.1, at: i * 0.18 })); },
  };

  const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  function renderSoundToggles() {
    $$('.sound-toggle').forEach(b => {
      b.innerHTML = store.sound ? ICON_SOUND_ON : ICON_SOUND_OFF;
      b.setAttribute('aria-pressed', String(store.sound));
      b.title = store.sound ? '効果音：オン' : '効果音：オフ';
    });
  }

  /* ---------------- モーダル ---------------- */
  let modalOnCancel = null;
  function openModal({ title, body = '', buttons = [] }) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = body;
    const box = $('#modal-actions');
    box.innerHTML = '';
    modalOnCancel = null;
    buttons.forEach(b => {
      if (b.cancel) modalOnCancel = b.onClick || (() => {});
      box.append(h('button', {
        class: 'btn ' + (b.cls || ''), type: 'button',
        onclick: () => { closeModal(); if (b.onClick) b.onClick(); },
      }, b.label));
    });
    $('#modal').hidden = false;
    const first = box.querySelector('.btn-primary') || box.querySelector('.btn');
    if (first) first.focus({ preventScroll: true });
  }
  function closeModal() { $('#modal').hidden = true; }
  $('#modal').addEventListener('click', e => {
    if (e.target.id === 'modal' && modalOnCancel) { const f = modalOnCancel; closeModal(); f(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#modal').hidden && modalOnCancel) { const f = modalOnCancel; closeModal(); f(); }
  });

  /* ---------------- 画面遷移 ---------------- */
  let screen = 'home';
  const renderers = {};
  function show(name) {
    screen = name;
    $$('.screen').forEach(s => s.classList.toggle('is-active', s.id === 'screen-' + name));
    if (renderers[name]) renderers[name]();
  }

  /* =========================================================
     ホーム
     ========================================================= */
  renderers.home = function renderHome() {
    const box = $('#home-score');
    box.innerHTML = '';
    if (!store.players.length) {
      box.append(h('p', { class: 'home-note' }, 'まずは「回答者を登録する」から参加者を追加しよう'));
      return;
    }
    const top = Math.max(...store.players.map(p => p.points));
    const ul = h('ul', { class: 'score-list' });
    store.players.forEach(p => {
      ul.append(h('li', { class: top > 0 && p.points === top ? 'is-top' : '', style: { '--c': p.color } },
        h('span', { class: 'sw' }),
        h('span', { class: 'nm' }, p.name),
        h('span', { class: 'pt' }, String(p.points), h('small', null, 'pt'))));
    });
    box.append(h('div', { class: 'score-head' }, 'スコア'), ul);
  };

  /* =========================================================
     回答者登録
     ========================================================= */
  function nextColor(except) {
    const used = new Set(store.players.map(p => p.color));
    return PALETTE.find(c => !used.has(c) && c !== except) || PALETTE[store.players.length % PALETTE.length];
  }
  function cycleColor(p) {
    const used = new Set(store.players.filter(q => q !== p).map(q => q.color));
    let i = PALETTE.indexOf(p.color);
    for (let k = 1; k <= PALETTE.length; k++) {
      const c = PALETTE[(i + k) % PALETTE.length];
      if (!used.has(c)) { p.color = c; break; }
    }
    save(); renderers.players();
  }
  function movePlayer(i, d) {
    const j = i + d;
    if (j < 0 || j >= store.players.length) return;
    const arr = store.players;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    save(); renderers.players();
  }
  function removePlayer(i) {
    store.players.splice(i, 1);
    save(); renderers.players();
  }

  renderers.players = function renderPlayers() {
    const list = $('#player-list');
    list.innerHTML = '';
    const n = store.players.length;
    store.players.forEach((p, i) => {
      list.append(h('li', { class: 'player-row', style: { '--c': p.color } },
        h('button', { class: 'swatch', type: 'button', 'aria-label': `${p.name}の色を変える`, title: '色を変える', onclick: () => cycleColor(p) }),
        h('input', {
          class: 'player-name-input', value: p.name, maxlength: '12', 'aria-label': '名前',
          onchange: e => {
            const v = e.target.value.trim();
            if (v) { p.name = v.slice(0, 12); save(); } else e.target.value = p.name;
          },
          onkeydown: e => { if (e.key === 'Enter') e.target.blur(); },
        }),
        h('span', { class: 'player-pt' }, `${p.points}pt`),
        h('div', { class: 'row-btns' },
          h('button', { class: 'mini', type: 'button', 'aria-label': '上へ', disabled: i === 0, onclick: () => movePlayer(i, -1) }, '▲'),
          h('button', { class: 'mini', type: 'button', 'aria-label': '下へ', disabled: i === n - 1, onclick: () => movePlayer(i, 1) }, '▼'),
          h('button', { class: 'mini danger', type: 'button', 'aria-label': `${p.name}を削除`, onclick: () => removePlayer(i) }, '✕'))));
    });
    $('#players-empty').hidden = n > 0;
    $('#player-count').textContent = `${n} / ${MAX_PLAYERS}人`;
    $('#player-add').disabled = n >= MAX_PLAYERS;
    $('#player-name').disabled = n >= MAX_PLAYERS;
    $('#player-name').placeholder = n >= MAX_PLAYERS ? '登録できるのは12人までです' : '名前を入力（12文字まで）';
  };

  $('#player-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#player-name');
    const name = input.value.trim().slice(0, 12);
    if (!name || store.players.length >= MAX_PLAYERS) { input.focus(); return; }
    store.players.push({ id: uid(), name, color: nextColor(), points: 0 });
    input.value = '';
    save(); renderers.players();
    Sound.tap();
    input.focus();
  });

  /* =========================================================
     問題設定
     ========================================================= */
  const setup = {
    topic: '', imgUrl: null, natW: 0, natH: 0,
    dir: 'right', startT: DEFAULT_START, answerT: DEFAULT_ANSWER,
  };

  renderers.setup = function renderSetup() {
    const has = !!setup.imgUrl;
    $('#setup-empty').hidden = has;
    $('#setup-stage').hidden = !has;
    $('#publish-btn').disabled = !has;
    $('#import-label').textContent = has ? '画像を変更する' : '画像をインポート';
    $('#topic-input').value = setup.topic;
    $$('.dpad-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dir === setup.dir)));
    if (has) {
      const img = $('#setup-img');
      if (img.getAttribute('src') !== setup.imgUrl) img.src = setup.imgUrl;
      fitStage($('#setup-fit'), $('#setup-stage'), setup.natW, setup.natH);
      renderSetupOverlay();
    }
  };
  function renderSetupOverlay() {
    placeRegion($('#setup-preview'), setup.dir, setup.startT, 1);
    placeLine($('#line-start'), setup.dir, setup.startT);
    placeLine($('#line-answer'), setup.dir, setup.answerT);
  }

  function loadImageFile(file) {
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) {
      openModal({ title: '画像ファイルを選んでね', body: '選ばれたファイルは画像ではないようです。', buttons: [{ label: 'OK', cls: 'btn-primary', cancel: true }] });
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (setup.imgUrl && (!game || game.imgUrl !== setup.imgUrl)) URL.revokeObjectURL(setup.imgUrl);
      setup.imgUrl = url;
      setup.natW = img.naturalWidth;
      setup.natH = img.naturalHeight;
      setup.startT = DEFAULT_START;
      setup.answerT = DEFAULT_ANSWER;
      renderers.setup();
      requestAnimationFrame(() => renderers.setup());
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      openModal({ title: '画像を読み込めませんでした', body: 'この形式の画像はブラウザで表示できないようです。JPEG / PNG などで試してください。', buttons: [{ label: 'OK', cls: 'btn-primary', cancel: true }] });
    };
    img.src = url;
  }

  $('#file-input').addEventListener('change', e => {
    loadImageFile(e.target.files && e.target.files[0]);
    e.target.value = '';
  });

  // ドラッグ＆ドロップ（PC）
  (() => {
    const wrap = $('#setup-wrap');
    let depth = 0;
    wrap.addEventListener('dragenter', e => { e.preventDefault(); depth++; wrap.classList.add('is-dragover'); });
    wrap.addEventListener('dragover', e => { e.preventDefault(); });
    wrap.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) wrap.classList.remove('is-dragover'); });
    wrap.addEventListener('drop', e => {
      e.preventDefault(); depth = 0; wrap.classList.remove('is-dragover');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadImageFile(f);
    });
    // ステージ外にドロップしてブラウザが画像を開いてしまうのを防ぐ
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => e.preventDefault());
  })();

  $('#topic-input').addEventListener('input', e => { setup.topic = e.target.value; });

  $$('.dpad-btn').forEach(b => b.addEventListener('click', () => {
    setup.dir = b.dataset.dir;
    setup.startT = DEFAULT_START;
    setup.answerT = DEFAULT_ANSWER;
    Sound.tap();
    renderers.setup();
  }));

  // ラインのドラッグ（ライン以外をタップしたら近いほうのラインが移動）
  (() => {
    const stage = $('#setup-stage');
    let drag = null;
    function moveTo(e) {
      const { x, y } = pointerFrac(e, stage);
      const { t } = fromXY(setup.dir, x, y);
      if (drag.which === 'start') setup.startT = clamp(t, 0, setup.answerT - LINE_GAP);
      else setup.answerT = clamp(t, setup.startT + LINE_GAP, 1);
      renderSetupOverlay();
    }
    stage.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      let which;
      const handle = e.target.closest('[data-line]');
      if (handle) which = handle.dataset.line;
      else {
        const { x, y } = pointerFrac(e, stage);
        const { t } = fromXY(setup.dir, x, y);
        which = Math.abs(t - setup.startT) <= Math.abs(t - setup.answerT) ? 'start' : 'answer';
      }
      drag = { which, id: e.pointerId };
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      $('#line-' + which).classList.add('is-dragging');
      moveTo(e);
    });
    stage.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.id) moveTo(e); });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      $('#line-' + drag.which).classList.remove('is-dragging');
      drag = null;
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  })();

  /* =========================================================
     ゲーム本体
     ========================================================= */
  let game = null;

  function publish() {
    if (!setup.imgUrl) return;
    if (!store.players.length) {
      openModal({
        title: '回答者がいません',
        body: '出題する前に、回答者を登録してください。（いま設定した画像はそのまま残ります）',
        buttons: [
          { label: '回答者を登録する', cls: 'btn-primary', onClick: () => show('players') },
          { label: 'キャンセル', cancel: true },
        ],
      });
      return;
    }
    game = {
      topic: setup.topic.trim(),
      imgUrl: setup.imgUrl, natW: setup.natW, natH: setup.natH,
      dir: setup.dir, startT: setup.startT, answerT: setup.answerT,
      order: store.players.map(p => p.id),
      guesses: {},          // id -> { t, p, ext }
      phase: 'guess',       // guess → race → ready → reveal → judge → result
      ptr: 0,               // 手番の人（order のインデックス）
      round: 0,             // チキンレースの周回
      dropped: new Set(),
      mode: null,           // race 中: 'choose' | 'extend'
      draft: null,          // 置こうとしている位置 { t, p }
      maskT: setup.startT,
      results: null, stamped: new Set(), winners: [], applied: false,
      timers: [], raf: 0, skip: false,
    };
    show('play');
    Sound.phase();
    banner('予想ターン', 'どこまであるか、ひとりずつ予想しよう');
  }

  function currentId() {
    if (!game) return null;
    if (game.phase === 'guess' || game.phase === 'race') return game.order[game.ptr] || null;
    return null;
  }
  function canPlace() {
    if (!game) return false;
    return game.phase === 'guess' || (game.phase === 'race' && game.mode === 'extend');
  }

  /* ---------- 描画 ---------- */
  renderers.play = function renderPlay() {
    if (!game) { show('home'); return; }
    $('#play-title').textContent = (game.topic || '○○') + '長さチキンレース！';
    const img = $('#play-img');
    if (img.getAttribute('src') !== game.imgUrl) img.src = game.imgUrl;
    fitStage($('#play-fit'), $('#play-stage'), game.natW, game.natH);
    renderPhase();
    renderMask();
    renderAnswerLine();
    renderMarkers();
    renderBoard();
    renderActions();
  };

  function renderPhase() {
    const b = $('#phase-badge');
    const label = {
      guess: '予想ターン',
      race: `チキンレース ${game.round}周目`,
      ready: 'チキンレース終了',
      reveal: '回答発表',
      judge: '回答発表',
      result: '結果',
    }[game.phase];
    b.textContent = label;
    b.dataset.phase = game.phase;
  }

  function renderMask() {
    const m = $('#play-mask');
    if (game.maskT >= 1 - 1e-6) { m.hidden = true; return; }
    m.hidden = false;
    placeRegion(m, game.dir, game.maskT, 1);
  }

  function renderAnswerLine() {
    const line = $('#answer-line');
    const visible = game.phase === 'judge' || game.phase === 'result';
    if (!visible) { line.hidden = true; return; }
    if (line.hidden) {
      placeLine(line, game.dir, game.answerT);
      line.hidden = false;
    }
  }

  // ひし形は id ごとに要素を使い回す（アニメーションが途切れないように）
  const mkEls = new Map();
  function markerEls(key, color) {
    let e = mkEls.get(key);
    if (!e) {
      const line = h('div', { class: 'mk-line' });
      const mk = h('div', { class: 'mk' },
        h('div', { class: 'mk-dia' }),
        h('div', { class: 'mk-name' }),
        h('div', { class: 'mk-stamp' }),
        h('div', { class: 'mk-res' }));
      $('#mk-lines').append(line);
      $('#mk-dias').append(mk);
      e = { line, mk };
      mkEls.set(key, e);
    }
    e.line.style.setProperty('--c', color);
    e.mk.style.setProperty('--c', color);
    return e;
  }
  function clearMarkers() {
    mkEls.forEach(e => { e.line.remove(); e.mk.remove(); });
    mkEls.clear();
  }
  function setMarker(e, pos, dir, { name = '', classes = [], res = '' } = {}) {
    if (!pos) { e.line.hidden = true; e.mk.hidden = true; return; }
    const { x, y } = toXY(dir, pos.t, pos.p);
    e.line.hidden = false; e.mk.hidden = false;
    placeLine(e.line, dir, pos.t);
    e.mk.style.left = (x * 100) + '%';
    e.mk.style.top = (y * 100) + '%';
    e.mk.className = 'mk ' + classes.join(' ');
    e.line.className = 'mk-line ' + (isHoriz(dir) ? 'is-v' : 'is-h') + (classes.includes('is-ghost') ? ' is-ghost' : '');
    e.mk.querySelector('.mk-name').textContent = name;
    e.mk.querySelector('.mk-res').textContent = res;
  }

  function renderMarkers() {
    const cur = currentId();
    const seen = new Set();
    game.order.forEach(id => {
      const p = playerById(id); if (!p) return;
      const e = markerEls(id, p.color);
      seen.add(id);
      const g = game.guesses[id];
      let pos = g || null;
      const classes = [];
      let res = '';
      if (id === cur) {
        if (game.phase === 'guess' && game.draft) { pos = game.draft; classes.push('is-current'); }
        if (game.phase === 'race') {
          classes.push('is-current');
          if (game.mode === 'extend' && game.draft) pos = game.draft;
        }
      }
      if (game.results && game.stamped.has(id)) {
        const r = game.results[id];
        classes.push('is-' + r);
        res = r === 'win' ? 'WIN! +1pt' : '';
      }
      setMarker(e, pos, game.dir, { name: p.name, classes, res });
    });
    // 伸ばす前の位置（ゴースト）
    const ghostKey = '__ghost';
    const showGhost = game.phase === 'race' && game.mode === 'extend' && cur && game.guesses[cur];
    if (showGhost) {
      const e = markerEls(ghostKey, playerById(cur).color);
      setMarker(e, game.guesses[cur], game.dir, { classes: ['is-ghost'] });
      seen.add(ghostKey);
    }
    mkEls.forEach((e, key) => { if (!seen.has(key)) { e.line.hidden = true; e.mk.hidden = true; } });
  }

  function statusText(id) {
    const g = game.guesses[id];
    const cur = currentId();
    const extTxt = g && g.ext ? `（伸ばし×${g.ext}）` : '';
    switch (game.phase) {
      case 'guess':
        if (id === cur) return '予想中…';
        return g ? '予想済み' : '待機中';
      case 'race':
        if (game.dropped.has(id)) return '降りた' + extTxt;
        if (id === cur) return (game.mode === 'extend' ? '伸ばし中…' : '伸ばす？降りる？') + extTxt;
        return '勝負中' + extTxt;
      case 'ready':
        return '降りた' + extTxt;
      case 'reveal':
        return 'ドキドキ…';
      case 'judge':
      case 'result': {
        if (!game.stamped.has(id)) return '判定中…';
        const r = game.results[id];
        return r === 'win' ? '勝利！ +1pt' : r === 'safe' ? 'セーフ' : 'ドボン';
      }
    }
    return '';
  }

  function renderBoard() {
    const ul = $('#board');
    ul.innerHTML = '';
    const cur = currentId();
    const focusId = cur || (game.phase === 'result' && game.winners[0]) || null;
    let curLi = null;
    game.order.forEach(id => {
      const p = playerById(id); if (!p) return;
      const cls = [];
      if (id === cur) cls.push('is-current');
      if (game.phase === 'race' && game.dropped.has(id)) cls.push('is-dropped');
      if (game.results && game.stamped.has(id)) cls.push('res-' + game.results[id]);
      const li = h('li', { class: cls.join(' '), style: { '--c': p.color } },
        h('span', { class: 'sw' }),
        h('span', { class: 'b-main' },
          h('span', { class: 'b-name' }, p.name),
          h('span', { class: 'b-status' }, statusText(id))),
        h('span', { class: 'b-pt' }, String(p.points), h('small', null, 'pt')),
        game.applied && game.winners.includes(id) ? h('span', { class: 'plus' }, '+1') : null);
      if (id === focusId) curLi = li;
      ul.append(li);
    });
    if (curLi) {
      requestAnimationFrame(() => {
        const wrap = curLi.closest('.board-wrap');
        if (!wrap) return;
        const r = curLi.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
        if (wrap.scrollWidth > wrap.clientWidth + 2) {
          wrap.scrollBy({ left: (r.left + r.width / 2) - (wr.left + wr.width / 2), behavior: 'smooth' });
        } else if (wrap.scrollHeight > wrap.clientHeight + 2) {
          wrap.scrollBy({ top: (r.top + r.height / 2) - (wr.top + wr.height / 2), behavior: 'smooth' });
        }
      });
    }
  }

  function actionBtn(label, cls, disabled, onClick) {
    return h('button', { class: 'btn ' + cls, type: 'button', disabled, onclick: onClick }, label);
  }

  function renderActions() {
    const pr = $('#prompt'), ac = $('#actions');
    ac.innerHTML = '';
    ac.classList.remove('row');
    const cur = currentId();
    const p = cur && playerById(cur);
    const who = p ? `<b class="who" style="--c:${p.color}">${esc(p.name)}</b> さん` : '';

    switch (game.phase) {
      case 'guess': {
        pr.innerHTML = `${who}の番！<br><span class="sub">${game.draft
          ? 'ドラッグで微調整して「決定」'
          : game.topic ? `${esc(game.topic)}がどこまであるか予想して、画像をタップ` : 'どこまで続いているか予想して、画像をタップ'}</span>`;
        ac.append(actionBtn('決定', 'btn-primary btn-lg', !game.draft, confirmGuess));
        break;
      }
      case 'race': {
        const g = game.guesses[cur];
        if (game.mode === 'extend') {
          const ok = game.draft && game.draft.t > g.t + EPS;
          pr.innerHTML = `${who}、どこまで伸ばす？<br>${ok
            ? '<span class="sub">よければ「決定」</span>'
            : '<span class="warn">前の予想より長い位置へドラッグしてね</span>'}`;
          ac.classList.add('row');
          ac.append(
            actionBtn('やめる', 'btn-lg', false, cancelExtend),
            actionBtn('決定', 'btn-primary btn-lg', !ok, confirmExtend));
        } else {
          const canExt = g.t < 1 - EPS;
          const active = game.order.length - game.dropped.size;
          pr.innerHTML = `${who}、伸ばす？降りる？<br><span class="sub">${canExt
            ? `残り${active}人が勝負中`
            : 'もう画像の端です。これ以上は伸ばせません'}</span>`;
          ac.classList.add('row');
          ac.append(
            actionBtn('伸ばす', 'btn-primary btn-lg', !canExt, startExtend),
            actionBtn('降りる', 'btn-blue btn-lg', false, dropOut));
        }
        break;
      }
      case 'ready':
        pr.innerHTML = '全員が降りました！<br><span class="sub">運命の回答発表へ…</span>';
        ac.append(actionBtn('回答発表', 'btn-primary btn-lg is-pulse', false, startReveal));
        break;
      case 'reveal':
        pr.innerHTML = 'オープン…！<br><span class="sub">隠されていた部分が見えてきた</span>';
        ac.append(actionBtn('スキップ', 'btn-lg', false, () => { if (game) game.skip = true; }));
        break;
      case 'judge':
        pr.innerHTML = '判定中…！<br><span class="sub">赤いラインが本当の長さ</span>';
        break;
      case 'result': {
        const names = game.winners.map(id => {
          const q = playerById(id);
          return q ? `<b class="who" style="--c:${q.color}">${esc(q.name)}</b>` : '';
        }).join('、');
        pr.innerHTML = game.winners.length
          ? `勝者：${names} さん<br><span class="sub">いちばんギリギリを攻めて +1pt！</span>`
          : '全員ドボン…！<br><span class="sub">今回は勝者なし</span>';
        ac.append(actionBtn('ホームに戻る', 'btn-primary btn-lg', false, finishGame));
        break;
      }
    }
  }

  /* ---------- 予想・チキンレースの操作 ---------- */
  (() => {
    const stage = $('#play-stage');
    let dragId = null;
    function move(e) {
      const cur = currentId(); if (!cur) return;
      const { x, y } = pointerFrac(e, stage);
      let { t, p } = fromXY(game.dir, x, y);
      const minT = game.phase === 'guess' ? game.startT : game.guesses[cur].t;
      t = clamp(t, minT, 1);
      p = clamp(p, P_MARGIN, 1 - P_MARGIN);
      game.draft = { t, p };
      renderMarkers();
      renderActions();
    }
    stage.addEventListener('pointerdown', e => {
      if (!canPlace()) return;
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      dragId = e.pointerId;
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      move(e);
      Sound.tap();
    });
    stage.addEventListener('pointermove', e => { if (dragId === e.pointerId && canPlace()) move(e); });
    const end = e => { if (dragId === e.pointerId) dragId = null; };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  })();

  function confirmGuess() {
    if (!game || game.phase !== 'guess' || !game.draft) return;
    const id = currentId();
    game.guesses[id] = { t: game.draft.t, p: game.draft.p, ext: 0 };
    game.draft = null;
    Sound.decide();
    game.ptr++;
    if (game.ptr >= game.order.length) {
      game.phase = 'race';
      game.mode = 'choose';
      game.round = 1;
      game.ptr = 0;
      renderers.play();
      setTimeout(() => Sound.phase(), 120);
      banner('チキンレース開始！', '伸ばす？それとも降りる？', 'is-red', 1900);
    } else {
      renderers.play();
    }
  }

  function startExtend() {
    if (!game || game.phase !== 'race') return;
    const g = game.guesses[currentId()];
    game.mode = 'extend';
    game.draft = { t: g.t, p: g.p };
    Sound.extend();
    renderers.play();
  }
  function cancelExtend() {
    if (!game) return;
    game.mode = 'choose';
    game.draft = null;
    renderers.play();
  }
  function confirmExtend() {
    if (!game || game.mode !== 'extend') return;
    const id = currentId(), g = game.guesses[id];
    if (!game.draft || game.draft.t <= g.t + EPS) return;
    g.t = game.draft.t; g.p = game.draft.p; g.ext++;
    Sound.decide();
    advanceRace();
  }
  function dropOut() {
    if (!game || game.phase !== 'race') return;
    game.dropped.add(currentId());
    Sound.drop();
    advanceRace();
  }
  function advanceRace() {
    game.mode = 'choose';
    game.draft = null;
    const n = game.order.length;
    if (game.dropped.size >= n) {
      game.phase = 'ready';
      renderers.play();
      banner('全員が降りた！', 'いよいよ回答発表', '', 1600);
      return;
    }
    for (let k = 1; k <= n; k++) {
      const idx = game.ptr + k;
      const i = idx % n;
      if (!game.dropped.has(game.order[i])) {
        if (idx >= n) {
          game.round++;
          banner(`${game.round}周目`, `残り${n - game.dropped.size}人`, '', 1000);
        }
        game.ptr = i;
        break;
      }
    }
    renderers.play();
  }

  /* ---------- 回答発表 ---------- */
  const easeInOut = k => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

  function startReveal() {
    if (!game || game.phase !== 'ready') return;
    const g = game;
    g.phase = 'reveal';
    g.skip = false;
    Sound.ensure();
    renderers.play();
    const from = g.maskT;
    const D = 1800 + (1 - from) * 6000;
    const t0 = performance.now();
    let lastTick = from;
    const step = now => {
      if (game !== g || g.phase !== 'reveal') return;
      let k = clamp((now - t0) / D, 0, 1);
      if (g.skip) k = 1;
      g.maskT = from + (1 - from) * easeInOut(k);
      renderMask();
      if (g.maskT - lastTick >= 0.02) { Sound.tick(); lastTick = g.maskT; }
      if (k < 1) g.raf = requestAnimationFrame(step);
      else { g.maskT = 1; renderMask(); judge(); }
    };
    g.raf = requestAnimationFrame(step);
  }

  function later(ms, fn) {
    const g = game;
    const id = setTimeout(() => { if (game === g) fn(); }, ms);
    g.timers.push(id);
  }

  function computeResults(g) {
    const results = {};
    let best = -Infinity;
    g.order.forEach(id => {
      const t = g.guesses[id].t;
      const safe = t <= g.answerT + 1e-9;
      results[id] = safe ? 'safe' : 'dobon';
      if (safe) best = Math.max(best, t);
    });
    const winners = g.order.filter(id => results[id] === 'safe' && Math.abs(g.guesses[id].t - best) < 1e-6);
    winners.forEach(id => { results[id] = 'win'; });
    return { results, winners };
  }

  function applyPoints(g) {
    if (g.applied || !g.results) return;
    g.winners.forEach(id => { const p = playerById(id); if (p) p.points += 1; });
    g.applied = true;
    save();
  }

  function judge() {
    const g = game;
    g.phase = 'judge';
    const { results, winners } = computeResults(g);
    g.results = results;
    g.winners = winners;
    renderers.play();
    Sound.line();

    const dist = id => g.guesses[id].t - g.answerT;
    const dobons = g.order.filter(id => results[id] === 'dobon').sort((a, b) => dist(b) - dist(a));
    const safes = g.order.filter(id => results[id] === 'safe').sort((a, b) => dist(a) - dist(b));
    let t = 900;
    dobons.forEach(id => {
      later(t, () => { g.stamped.add(id); renderMarkers(); renderBoard(); Sound.dobon(); });
      t += 520;
    });
    safes.forEach(id => {
      later(t, () => { g.stamped.add(id); renderMarkers(); renderBoard(); Sound.safe(); });
      t += 360;
    });
    if (winners.length) {
      t += 350;
      later(t, () => { winners.forEach(id => g.stamped.add(id)); renderMarkers(); renderBoard(); Sound.win(); });
      t += 1100;
    } else {
      t += 300;
    }
    later(t, () => {
      applyPoints(g);
      g.phase = 'result';
      renderers.play();
      if (winners.length) {
        const names = winners.map(id => (playerById(id) || {}).name).filter(Boolean).join('・');
        banner(`${names} の勝ち！`, '+1pt 獲得！', 'is-red', 2600);
      } else {
        Sound.allout();
        banner('全員ドボン！', '今回は勝者なし…', 'is-blue', 2600);
      }
    });
  }

  /* ---------- 終了・中断 ---------- */
  function stopGameTimers() {
    if (!game) return;
    cancelAnimationFrame(game.raf);
    game.timers.forEach(clearTimeout);
    game.timers = [];
  }
  function teardownGame({ keepImage }) {
    if (!game) return;
    stopGameTimers();
    if (game.phase === 'judge') applyPoints(game);   // 判定の途中で抜けても結果は反映
    const usedUrl = game.imgUrl;
    game = null;
    clearMarkers();
    $('#answer-line').hidden = true;
    hideBanner();
    if (!keepImage && setup.imgUrl === usedUrl) {
      URL.revokeObjectURL(usedUrl);
      setup.imgUrl = null; setup.natW = 0; setup.natH = 0;
      setup.startT = DEFAULT_START; setup.answerT = DEFAULT_ANSWER;
      $('#setup-img').removeAttribute('src');
      $('#play-img').removeAttribute('src');
    }
  }
  function finishGame() {
    teardownGame({ keepImage: false });
    show('home');
  }
  function quitGame() {
    if (!game) { show('home'); return; }
    if (game.phase === 'result') { finishGame(); return; }
    openModal({
      title: 'ゲームを中断しますか？',
      body: 'ここまでの予想は消えます。',
      buttons: [
        { label: '続ける', cls: 'btn-primary', cancel: true },
        { label: '問題設定に戻る', onClick: () => { teardownGame({ keepImage: true }); show('setup'); } },
        { label: 'ホームに戻る', onClick: () => { teardownGame({ keepImage: true }); show('home'); } },
      ],
    });
  }

  /* ---------- バナー ---------- */
  let bannerTimer = 0;
  function banner(main, sub = '', cls = '', ms = 1500) {
    const b = $('#play-banner');
    b.className = 'play-banner ' + cls;
    b.innerHTML = `<span class="bn-main">${esc(main)}</span>${sub ? `<span class="bn-sub">${esc(sub)}</span>` : ''}`;
    void b.offsetWidth;
    b.classList.add('is-show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('is-show'), ms);
  }
  function hideBanner() {
    clearTimeout(bannerTimer);
    $('#play-banner').classList.remove('is-show');
  }

  /* =========================================================
     共通イベント
     ========================================================= */
  const actions = {
    'start': () => show('setup'),
    'go-home': () => show('home'),
    'go-players': () => show('players'),
    'publish': publish,
    'quit': quitGame,
    'toggle-sound': () => { store.sound = !store.sound; save(); renderSoundToggles(); if (store.sound) Sound.tap(); },
    'reset-points': () => {
      if (!store.players.length) return;
      openModal({
        title: 'ポイントをリセット',
        body: '全員のポイントを 0 に戻します。よろしいですか？',
        buttons: [
          { label: 'リセットする', cls: 'btn-primary', onClick: () => { store.players.forEach(p => { p.points = 0; }); save(); renderers.players(); } },
          { label: 'キャンセル', cancel: true },
        ],
      });
    },
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    const fn = actions[b.dataset.action];
    if (fn) { e.preventDefault(); fn(b, e); }
  });

  // ステージのサイズを画面に合わせる
  const ro = new ResizeObserver(() => {
    if (screen === 'setup' && setup.imgUrl) fitStage($('#setup-fit'), $('#setup-stage'), setup.natW, setup.natH);
    if (screen === 'play' && game) fitStage($('#play-fit'), $('#play-stage'), game.natW, game.natH);
  });
  ro.observe($('#setup-fit'));
  ro.observe($('#play-fit'));

  // ゲーム中のリロード・タブを閉じる操作に確認を出す
  window.addEventListener('beforeunload', e => {
    if (game && game.phase !== 'result') { e.preventDefault(); e.returnValue = ''; }
  });

  /* 初期表示 */
  renderSoundToggles();
  show('home');
})();
