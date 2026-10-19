/* app.js — 静态版界面逻辑（无后端，进度全在浏览器里） */
import { Engine, ROUNDS, REVIEW_DAYS, canPersist } from './engine.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['home', 'onb-book', 'onb-size', 'onb-welcome', 'learn', 'notebook', 'stats', 'settings'];

const state = {
  engine: Engine.load(),
  view: 'learn',
  startView: null,
  mode: 'learn',
  card: null,
  answered: false,
  busy: false,
  theme: 'dark',
  selected: new Set(),
};

/* ---------------- 工具 ---------------- */

function toast(msg, ms = 1800) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function confirmDialog(text, okLabel = '确定') {
  return new Promise((resolve) => {
    $('modal-text').textContent = text;
    $('modal-ok').textContent = okLabel;
    $('modal').classList.remove('hidden');
    const done = (val) => {
      $('modal').classList.add('hidden');
      $('modal-ok').onclick = null;
      $('modal-cancel').onclick = null;
      $('modal').onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    $('modal-ok').onclick = () => done(true);
    $('modal-cancel').onclick = () => done(false);
    $('modal').onclick = (e) => { if (e.target === $('modal')) done(false); };
    document.addEventListener('keydown', onKey);
  });
}

function speak(text) {
  if (!text || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------------- 主题 ---------------- */

function applyTheme(name) {
  state.theme = name === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  try { localStorage.setItem('dcb-theme', state.theme); } catch (e) {}
  document.querySelectorAll('#theme-seg .segbtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === state.theme);
  });
}

/* ---------------- 顶部计数 ---------------- */

function paintCounts() {
  const c = state.engine.counts();
  $('s-new').textContent = `${c.newDone}/${c.newQuota}`;
  $('s-rev').textContent = c.reviewDone;
  $('s-due').textContent = c.due;
  $('book-name').textContent = c.book;
  $('book-total').textContent = c.total;
  $('nb-count').textContent = c.notebook;
  const pct = c.newQuota ? Math.min(100, (c.newDone / c.newQuota) * 100) : 0;
  $('prog').style.width = pct + '%';
  return c;
}

/* ---------------- 学习视图 ---------------- */

function hidePanels() {
  ['panel-choice', 'panel-self', 'panel-spell', 'panel-review', 'fb'].forEach((id) => $(id).classList.add('hidden'));
}

function renderCard() {
  const card = state.card;
  if (!card) return;
  state.answered = false;
  hidePanels();
  $('tip').classList.add('hidden');

  const isSpell = state.mode === 'learn' && card.stage >= ROUNDS - 1;
  $('w-word').classList.toggle('masked', isSpell);
  $('w-word').textContent = isSpell ? '· · ·' : (card.word || '—');
  $('w-phon').textContent = isSpell ? '' : (card.phonetic || '');

  const dots = [];
  const lit = state.mode === 'learn' ? card.stage : ROUNDS;
  for (let i = 0; i < ROUNDS; i++) dots.push(`<i class="${i < lit ? 'on' : ''}"></i>`);
  $('w-dots').innerHTML = dots.join('');

  let label = '', hint = '';
  if (state.mode === 'learn') {
    label = `第 ${card.stage + 1} 轮 / ${ROUNDS}`;
    hint = ['选一个正确的意思', '先回想，再给自己评级', '看中文，拼出英文'][card.stage] || '';
    $('round-label').textContent = label;
    $('round-hint').textContent = hint;
    if (card.stage === 0) {
      $('panel-choice').classList.remove('hidden');
      $('choices').innerHTML = (card.options || []).map((o, i) =>
        `<button class="choice" data-i="${i}"><span class="ctext">${escapeHtml(shortTrans(o.text))}</span><small>${i + 1}</small></button>`).join('');
      $('choices').classList.add('stagger');
    } else if (card.stage === 1) {
      $('panel-self').classList.remove('hidden');
    } else {
      $('panel-spell').classList.remove('hidden');
      $('spell-trans').textContent = card.translation || '';
      $('spell-input').value = '';
      setTimeout(() => $('spell-input').focus(), 30);
    }
  } else if (state.mode === 'review') {
    $('round-label').textContent = `复习 · 第 ${(card.reviewStep || 0) + 1}/${REVIEW_DAYS.length} 次`;
    $('round-hint').textContent = '还认识吗';
    $('panel-review').classList.remove('hidden');
  } else {
    $('round-label').textContent = `生词本 · ${card.notebookRight || 0}/${card.notebookGraduate || 3} 次`;
    $('round-hint').textContent = '答对 3 次就移出';
    $('panel-review').classList.remove('hidden');
  }
  paintCounts();
  animateCard();
}

function shortTrans(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  const parts = t.split('；').filter(Boolean);
  let out = parts.slice(0, 2).join('；');
  if (out.length > 26) out = out.slice(0, 26) + '…';
  return out || t.slice(0, 26);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showFeedback(res) {
  state.answered = true;
  hidePanels();
  const card = state.card;
  const fb = $('fb');
  fb.classList.remove('hidden');
  flash(res.ok ? 'flash-ok' : 'flash-bad');

  const info = state.engine.index.get(card.word) || {};
  const tr = info.translation || (state.engine.peek(card.word) || {}).tr || '';
  $('w-trans').textContent = tr;
  const ex = info.example || '';
  $('w-ex').textContent = ex;
  $('w-ex').classList.toggle('empty', !ex);
  $('w-excn').textContent = info.example_cn || '';
  $('w-excn').classList.toggle('empty', !info.example_cn);

  let text = '';
  if (res.ok) text = '✓ 点亮一个点';
  else if (state.mode === 'learn' && card.stage === ROUNDS - 1) text = `✗ 正确拼写：${res.correctAnswer}`;
  else if (state.mode === 'learn' && card.stage === 0) text = `✗ 正确答案：${res.correctAnswer}`;
  else text = '✗ 这个词回到本轮队尾，再来一次';
  if (res.notebookEntered) text += '　·　已加入生词本';
  if (res.notebookGraduated) text += '　·　已从生词本毕业 🎉';
  if (state.mode === 'review') {
    if (res.state === 'mastered') text = '✓ 五次都过，这个单词掌握了 🎉';
    else if (res.ok) text = `✓ 进到第 ${res.step + 1} 档，下次 ${REVIEW_DAYS[Math.min(res.step, REVIEW_DAYS.length - 1)]} 天后`;
    else text = '✗ 4 小时后再来';
  }
  $('fb-text').textContent = text;

  const r = state.engine.peek(card.word) || {};
  $('w-meta').textContent = `第 ${r.stage || 0}/${ROUNDS} 轮 · 对 ${r.right || 0} 次 / 错 ${r.wrong || 0} 次`;
  $('btn-star').textContent = r.starred ? '已标熟' : '标熟';
  $('btn-note').textContent = r.inNotebook ? '移出生词本' : '加入生词本';
  paintCounts();
}

function loadNext(mode) {
  if (state.busy) return;
  state.mode = mode || state.mode;
  const next = state.engine.pickNext(state.mode === 'notebook' ? 'notebook' : 'learn');
  if (!next) {
    showDone();
    return;
  }
  state.mode = next.mode;
  state.card = next.card;
  switchView('learn', true);
  renderCard();
}

function showDone() {
  const c = paintCounts();
  hidePanels();
  $('view-learn').classList.add('hidden');
  $('done').classList.remove('hidden');
  $('done-title').textContent = c.due > 0 ? '这一组学完了 · 还有复习要做' : '今天的任务做完了 🎉';
  const parts = [];
  if (c.newDone) parts.push(`今日新学 ${c.newDone}/${c.newQuota}`);
  if (c.reviewDone) parts.push(`今日复习 ${c.reviewDone}`);
  if (c.due) parts.push(`待复习 ${c.due}`);
  if (c.mastered) parts.push(`已掌握 ${c.mastered}`);
  $('done-detail').textContent = parts.length ? parts.join('　·　') : '去学一组新词吧。';
}

function flash(kind) {
  const el = $('view-learn');
  if (!el) return;
  el.classList.remove('flash-ok', 'flash-bad');
  void el.offsetWidth;
  el.classList.add(kind);
  setTimeout(() => el.classList.remove(kind), 480);
}

function animateCard() {
  const wl = document.querySelector('#view-learn .wordline');
  [wl, $('choices'), $('panel-self'), $('panel-spell')].forEach((el) => {
    if (!el) return;
    el.classList.remove('card-in');
    void el.offsetWidth;
    el.classList.add('card-in');
  });
}

function submitChoice(text) {
  if (state.answered) return;
  const res = state.engine.answerStage(state.card.key || state.card.word, state.card.stage, text);
  showFeedback(res);
}

function submitSelf(ans) {
  if (state.answered) return;
  if (state.mode === 'learn') {
    showFeedback(state.engine.answerStage(state.card.key || state.card.word, state.card.stage, ans));
  } else {
    showFeedback(state.engine.answerReview(state.card.key || state.card.word, ans));
  }
}

function submitSpell(text) {
  if (state.answered) return;
  showFeedback(state.engine.answerStage(state.card.key || state.card.word, state.card.stage, text));
}

/* ---------------- 生词本 ---------------- */

function renderNotebook() {
  const list = state.engine.notebookList();
  $('nb-sub').textContent = list.length + ' 词';
  $('nb-empty').classList.toggle('hidden', list.length > 0);
  $('btn-nb-clear').disabled = list.length === 0;
  $('btn-nb-study').disabled = list.length === 0;
  $('nb-count').textContent = list.length;

  // 已选中的词如果不在列表里就剔除
  const words = new Set(list.map((r) => r.word));
  state.selected = new Set([...state.selected].filter((w) => words.has(w)));

  $('nb-list').innerHTML = list.map((r) => `
    <li class="nbrow" data-word="${escapeHtml(r.word)}">
      <input type="checkbox" class="nbck nb-pick" data-word="${escapeHtml(r.word)}" ${state.selected.has(r.word) ? 'checked' : ''}>
      <div class="nbmain">
        <b>${escapeHtml(r.word)}</b>
        <span class="dim">${escapeHtml(r.phonetic || '')}</span>
        <span class="nbtrans">${escapeHtml(r.translation || '')}</span>
      </div>
      <span class="chip">${r.notebookRight || 0}/3</span>
    </li>`).join('');

  $('nb-all').checked = list.length > 0 && state.selected.size === list.length;
  $('btn-nb-del').disabled = state.selected.size === 0;
  $('btn-nb-del').textContent = state.selected.size ? `删除选中(${state.selected.size})` : '删除选中';
}

/* ---------------- 统计 ---------------- */

function renderStats() {
  const st = state.engine.stats();
  const c = st.counts;
  const cells = [
    ['词库总词数', c.total],
    ['已开始学', Object.values(st.byState).reduce((a, b) => a + b, 0) - (st.byState.new || 0)],
    ['已掌握', c.mastered],
    ['待复习', c.due],
    ['生词本', c.notebook],
    ['今日新学', c.newDone],
  ];
  $('st-grid').innerHTML = cells.map(([k, v]) => `<div class="cell"><b>${v}</b><span>${k}</span></div>`).join('');

  const max = Math.max(1, ...st.last7d.map((d) => d.c));
  $('st-bars').innerHTML = st.last7d.map((d) => `
    <div class="barcol" title="${d.day}">
      <i style="height:${Math.round((d.c / max) * 100)}%"></i>
      <span>${d.day.slice(5)}</span>
    </div>`).join('');

  const g = st.byStage || {};
  const rows = [
    ['点 1 个', g['1'] || 0], ['点 2 个', g['2'] || 0], ['点满 3 个', g['3'] || 0],
  ];
  $('st-states').innerHTML = rows.map(([k, v]) => `<div class="cell"><b>${v}</b><span>${k}</span></div>`).join('');
}

/* ---------------- 设置 ---------------- */

function renderSettings() {
  const books = state.engine.bookList();
  const cur = state.engine.book;
  $('book-list').innerHTML = books.map((b) => `
    <button class="bookbtn ${b.name === cur ? 'active' : ''}" data-slug="${b.slug}">
      <span>${escapeHtml(b.name)}</span><span class="num">${b.count} 词</span>
    </button>`).join('');
  $('npd-input').value = state.engine.groupSize();
  $('npd-hint').textContent = '';
  document.querySelectorAll('#theme-seg .segbtn').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === state.theme);
  });
}

/* ---------------- 视图切换 ---------------- */

function switchView(view, keepHash) {
  state.view = VIEWS.includes(view) ? view : 'home';
  VIEWS.forEach((v) => {
    const el = $('view-' + v);
    if (el) el.classList.toggle('hidden', v !== state.view);
  });
  document.body.dataset.view = state.view;
  if (state.view !== 'learn') $('done').classList.add('hidden');
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === state.view));

  const shown = $('view-' + state.view);
  if (shown && !state.firstPaint) {
    shown.classList.remove('view-in');
    void shown.offsetWidth;
    shown.classList.add('view-in');
  }
  state.firstPaint = true;

  if (!keepHash) {
    const h = '#' + state.view;
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  if (state.view === 'home') paintHome();
  if (state.view === 'learn') paintHome();
  if (state.view === 'notebook') renderNotebook();
  if (state.view === 'stats') renderStats();
  if (state.view === 'settings') { renderSettings(); paintAccentUi(); }
  if (state.view === 'learn' && !state.card) loadNext('learn');
  paintCounts();
}

/* ---------------- 首页 / 引导 ---------------- */

const ONB_SIZES = [10, 20, 30, 50];
const onb = { book: null, size: null };

function learnedTotal() {
  return Object.keys((state.engine.s && state.engine.s.words) || {}).length;
}

function isFirstRun() {
  return !state.engine.s.onboarded && learnedTotal() === 0;
}

function paintHome() {
  const c = state.engine.counts();
  const books = state.engine.bookList() || [];
  const cur = books.find((b) => b.slug === state.engine.slug || b.name === state.engine.activeBook());
  const learned = learnedTotal() - c.learning;
  $('opt-words').textContent = `已学 ${Math.max(0, learned)} / ${c.total} 词 · 掌握 ${c.mastered}`;
  $('opt-notebook').textContent = `${c.notebook} 个词`;
  $('opt-settings').textContent = '词书 · ' + (cur ? cur.name : c.book);
  $('home-sub').classList.toggle('hidden', !isFirstRun());
}

function renderOnbBooks() {
  const box = $('onb-books');
  const books = state.engine.bookList() || [];
  if (!onb.book) onb.book = state.engine.slug || (books[0] && books[0].slug) || null;
  box.innerHTML = books
    .map(
      (b) =>
        `<button class="pick${b.slug === onb.book ? ' sel' : ''}" data-slug="${b.slug}">` +
        `<b>${b.name}</b><span>${b.count} 词</span></button>`
    )
    .join('');
}

function renderOnbSizes() {
  const box = $('onb-sizes');
  if (!onb.size) onb.size = state.engine.groupSize();
  box.innerHTML = ONB_SIZES.concat(ONB_SIZES.includes(onb.size) ? [] : [onb.size])
    .map(
      (n) =>
        `<button class="pick${n === onb.size ? ' sel' : ''}" data-size="${n}">` +
        `<b>${n} 个</b><span>${n <= 10 ? '轻松' : n <= 20 ? '常规' : n <= 30 ? '进阶' : '冲刺'}</span></button>`
    )
    .join('');
}

async function finishOnboarding() {
  if (onb.book && onb.book !== state.engine.slug) {
    try { await state.engine.setBook(onb.book); } catch (e) { toast('词书加载失败，已用默认词书'); }
  }
  if (onb.size) { state.engine.setGroupSize(onb.size); }
  state.engine.s.onboarded = 1;
  state.engine.save();
  state.card = null;
  paintCounts();
}

function bindHome() {
  $('btn-start').addEventListener('click', () => {
    if (isFirstRun()) { onb.book = state.engine.activeBook(); renderOnbBooks(); switchView('onb-book'); }
    else { switchView('learn'); }
  });

  document.querySelectorAll('.arrow-btn').forEach((b) => {
    b.addEventListener('click', () => switchView(b.dataset.go));
  });

  $('onb-books').addEventListener('click', (e) => {
    const el = e.target.closest('[data-slug]');
    if (!el) return;
    onb.book = el.dataset.slug;
    renderOnbBooks();
  });

  $('onb-book-next').addEventListener('click', () => { renderOnbSizes(); switchView('onb-size'); });

  $('onb-sizes').addEventListener('click', (e) => {
    const el = e.target.closest('[data-size]');
    if (!el) return;
    onb.size = Number(el.dataset.size);
    renderOnbSizes();
  });

  $('onb-size-next').addEventListener('click', async () => {
    if (!onb.size) onb.size = state.engine.groupSize();
    await finishOnboarding();
    switchView('onb-welcome');
  });

  $('onb-enter').addEventListener('click', () => { state.card = null; switchView('learn'); });
}
/* ---------------- 主题色 ---------------- */

const ACCENTS = [
  { h: 152, s: '72%', name: '绿' },
  { h: 168, s: '66%', name: '青绿' },
  { h: 196, s: '72%', name: '青' },
  { h: 220, s: '76%', name: '蓝' },
  { h: 262, s: '70%', name: '紫' },
  { h: 322, s: '70%', name: '粉' },
  { h: 10, s: '72%', name: '红' },
  { h: 34, s: '78%', name: '橙' },
  { h: 210, s: '10%', name: '银灰' },
];
const ACCENT_KEY = 'dcb-accent';
let accent = { h: 152, s: '72%', bg: 'tint' };

function applyAccent(next, save) {
  accent = Object.assign({}, accent, next);
  const root = document.documentElement;
  root.style.setProperty('--accent-h', accent.h);
  root.style.setProperty('--accent-s', accent.s);
  if (accent.bg === 'plain') root.dataset.bg = 'plain';
  else delete root.dataset.bg;
  if (save) {
    try { localStorage.setItem(ACCENT_KEY, JSON.stringify(accent)); } catch (e) {}
  }
  paintAccentUi();
}

function paintAccentUi() {
  const box = $('swatches');
  if (!box) return;
  box.innerHTML = ACCENTS.map(
    (a) => `<button class="sw${a.h === accent.h && a.s === accent.s ? ' sel' : ''}" data-h="${a.h}" data-s="${a.s}" title="${a.name}" style="--h:${a.h}"></button>`
  ).join('');
  const hue = $('hue');
  if (hue) { hue.value = String(accent.h); }
  const val = $('hue-val');
  if (val) val.textContent = accent.h + '°';
  document.querySelectorAll('#bg-seg .segbtn').forEach((b) => {
    b.classList.toggle('active', (b.dataset.bg || 'tint') === accent.bg);
  });
}

function bindAccent() {
  try {
    const saved = JSON.parse(localStorage.getItem(ACCENT_KEY) || 'null');
    if (saved && typeof saved.h === 'number') {
      accent.h = saved.h;
      accent.s = saved.s || '72%';
      accent.bg = saved.bg === 'plain' ? 'plain' : 'tint';
    }
  } catch (e) {}
  applyAccent({}, false);

  const box = $('swatches');
  if (box) {
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.sw');
      if (!b) return;
      applyAccent({ h: Number(b.dataset.h), s: b.dataset.s }, true);
    });
  }
  const hue = $('hue');
  if (hue) {
    hue.addEventListener('input', () => {
      applyAccent({ h: Number(hue.value), s: '72%' }, true);
    });
  }
  const seg = $('bg-seg');
  if (seg) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('.segbtn');
      if (!b) return;
      applyAccent({ bg: b.dataset.bg === 'plain' ? 'plain' : 'tint' }, true);
    });
  }
  const reset = $('btn-accent-reset');
  if (reset) {
    reset.addEventListener('click', () => {
      accent = { h: 152, s: '72%', bg: 'tint' };
      applyAccent({}, true);
      toast('已恢复默认主题色');
    });
  }
}
/* ---------------- 事件 ---------------- */

function bind() {
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => switchView(t.dataset.view));
  });

  $('choices').addEventListener('click', (e) => {
    const btn = e.target.closest('.choice');
    if (!btn) return;
    const i = Number(btn.dataset.i);
    const opt = (state.card.options || [])[i];
    if (!opt) return;
    document.querySelectorAll('#choices .choice').forEach((b) => b.classList.remove('picked'));
    btn.classList.add('picked');
    submitChoice(opt.text);
  });

  ['panel-self', 'panel-review'].forEach((id) => {
    $(id).addEventListener('click', (e) => {
      const btn = e.target.closest('.ans');
      if (!btn || !btn.dataset.a) return;
      submitSelf(btn.dataset.a);
    });
  });

  $('btn-spell').addEventListener('click', () => submitSpell($('spell-input').value));
  $('btn-spell-skip').addEventListener('click', () => submitSpell(''));
  $('spell-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitSpell($('spell-input').value); }
  });

  $('btn-next').addEventListener('click', () => loadNext());
  $('btn-say').addEventListener('click', () => {
    const w = state.card && state.card.word;
    if (w) speak(w);
  });

  $('btn-star').addEventListener('click', () => {
    const w = state.card.word;
    const r = state.engine.peek(w) || {};
    if (r.starred) { toast('已经标熟了'); return; }
    state.engine.setFlag(w, 'starred', true);
    toast('已标熟，不再安排');
    loadNext();
  });

  $('btn-note').addEventListener('click', () => {
    const w = state.card.word;
    const r = state.engine.peek(w) || {};
    if (r.inNotebook) { state.engine.setFlag(w, 'inNotebook', false); toast('已移出生词本'); }
    else { state.engine.setFlag(w, 'inNotebook', true); toast('已加入生词本'); }
    showFeedback({ ok: true, correctAnswer: '' });
  });

  $('btn-done-more').addEventListener('click', () => switchView('notebook'));

  // 生词本
  $('btn-nb-study').addEventListener('click', () => {
    if (!state.engine.notebookList().length) { toast('生词本是空的'); return; }
    state.mode = 'notebook';
    const next = state.engine.pickNext('notebook');
    if (!next) { toast('生词本是空的'); return; }
    state.mode = next.mode;
    state.card = next.card;
    switchView('learn', true);
    renderCard();
  });

  $('nb-list').addEventListener('click', (e) => {
    if (e.target.classList.contains('nb-pick')) {
      const w = e.target.dataset.word;
      if (e.target.checked) state.selected.add(w); else state.selected.delete(w);
      renderNotebook();
    }
  });

  $('nb-all').addEventListener('change', () => {
    const list = state.engine.notebookList();
    state.selected = $('nb-all').checked ? new Set(list.map((r) => r.word)) : new Set();
    renderNotebook();
  });

  $('btn-nb-del').addEventListener('click', async () => {
    const n = state.selected.size;
    if (!n) return;
    const ok = await confirmDialog(`把选中的 ${n} 个词移出生词本？学习进度不受影响。`, '确定删除');
    if (!ok) return;
    state.engine.removeFromNotebook([...state.selected]);
    state.selected.clear();
    renderNotebook();
    paintCounts();
    toast(`已移出 ${n} 个词`);
  });

  $('btn-nb-clear').addEventListener('click', async () => {
    const n = state.engine.notebookList().length;
    if (!n) return;
    const ok = await confirmDialog(`清空生词本？全部 ${n} 个词会被移出，学习进度不受影响。`, '确定清空');
    if (!ok) return;
    state.engine.clearNotebook();
    state.selected.clear();
    renderNotebook();
    paintCounts();
    toast('生词本已清空');
  });

  // 设置
  $('book-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.bookbtn');
    if (!btn) return;
    const slug = btn.dataset.slug;
    if (!slug || slug === state.engine.slug) return;
    state.busy = true;
    try {
      await state.engine.loadBook(slug);
      state.engine.save();
      state.card = null;
      renderSettings();
      paintCounts();
      toast('已切换到「' + state.engine.book + '」');
      switchView('learn', true);
      loadNext('learn');
    } catch (err) {
      toast('切换失败：' + err.message);
    } finally {
      state.busy = false;
    }
  });

  $('btn-npd').addEventListener('click', () => {
    const n = Number($('npd-input').value);
    if (!Number.isFinite(n) || n < 1 || n > 200) { toast('请输入 1–200'); return; }
    const size = state.engine.setGroupSize(n);
    $('npd-hint').textContent = `已保存，每组 ${size} 个`;
    paintCounts();
    toast(`每组新词改成 ${size} 个（进行中的这组会立即调整）`);
  });

  document.querySelectorAll('#theme-seg .segbtn').forEach((b) => {
    b.addEventListener('click', () => applyTheme(b.dataset.theme));
  });

  $('btn-export').addEventListener('click', () => {
    const d = new Date();
    const name = `danci-progress-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    download(name, state.engine.exportJSON());
    toast('已导出 ' + name);
  });

  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      const n = state.engine.importJSON(text);
      toast(`导入成功：${n} 条记录`);
      await reloadAfterImport();
    } catch (err) {
      toast('导入失败：' + err.message);
    } finally {
      e.target.value = '';
    }
  });

  $('btn-reset').addEventListener('click', async () => {
    const ok = await confirmDialog('清空本机的全部学习进度？词库不受影响，但进度无法恢复。', '确定清空');
    if (!ok) return;
    state.engine.reset();
    state.card = null;
    state.selected.clear();
    await reloadAfterImport();
    toast('已清空');
  });

  // 键盘
  document.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (state.view !== 'learn') return;
    const fbVisible = !$('fb').classList.contains('hidden');
    if (fbVisible && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); loadNext(); return; }
    if ($('panel-self').classList.contains('hidden') && $('panel-review').classList.contains('hidden')) return;
    const map = { '1': 'know', '2': 'fuzzy', '3': 'unknown' };
    if (map[e.key]) { e.preventDefault(); submitSelf(map[e.key]); }
  });
}

async function reloadAfterImport() {
  const book = state.engine.s.book || state.engine.book;
  const list = state.engine.bookList();
  const hit = list.find((b) => b.name === book) || list[0];
  state.engine.words = [];
  state.engine.index = new Map();
  state.card = null;
  if (hit) await state.engine.loadBook(hit.slug);
  paintCounts();
  switchView('learn', true);
  loadNext('learn');
}

/* ---------------- 启动 ---------------- */

async function boot() {
  try {
    const t = localStorage.getItem('dcb-theme');
    if (t === 'light' || t === 'dark') state.theme = t;
  } catch (e) {}
  applyTheme(state.theme);
  try {
    const q = new URLSearchParams(location.search);
    const qt = q.get('theme');
    if (qt === 'light' || qt === 'dark') applyTheme(qt);
  } catch (e) {}
  bind();
  bindHome();
  bindAccent();
  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (VIEWS.includes(v) && v !== state.view) switchView(v, true);
  });

  try {
    let manifest;
    if (typeof window !== 'undefined' && window.__MANIFEST) {
      manifest = window.__MANIFEST;
    } else {
      const res = await fetch('data/books/index.json', { cache: 'no-cache' });
      manifest = await res.json();
    }
    state.engine.setManifest(manifest);
    const list = state.engine.bookList();
    const hit = list.find((b) => b.name === state.engine.s.book) || list[0];
    if (!hit) throw new Error('没有可用词书');
    await state.engine.loadBook(hit.slug);
  } catch (err) {
    $('w-word').textContent = '词库加载失败';
    $('w-phon').textContent = String(err && err.message || err);
    return;
  }

  const hashView = location.hash.slice(1);
  const startView = VIEWS.includes(hashView) ? hashView : 'home';
  if (startView === 'learn') loadNext('learn');
  switchView(startView, true);
}

// 打开方式不支持持久化时给出明确提示（微信/WPS/iOS 文件预览常见）
if (!canPersist()) { try { $('no-store').classList.remove('hidden'); } catch (e) {} }

// 启动阶段的异常直接显示出来，避免只看到空白页
window.addEventListener('error', (e) => {
  const el = document.getElementById('boot-error');
  if (!el) return;
  el.textContent = '出错了：' + (e.message || e.error) + '（如果是手机打开本地文件，试试把它放到 https 网址上）';
  el.classList.remove('hidden');
});

// 调试/自动化用的句柄（不影响正常使用）
window.__danci = {
  state,
  engine: () => state.engine,
  loadNext,
  submitSelf,
  submitChoice,
  submitSpell,
  switchView,
};

boot();





















