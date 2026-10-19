/* engine.js — 三轮学习 + 艾宾浩斯复习（纯前端版）
 *
 * 与 Python 版 store.py 的语义一一对应：
 *   第 1 轮  英 → 中，三选一          stage 0 → 1
 *   第 2 轮  英 → 纯回想，自评三档      stage 1 → 2
 *   第 3 轮  中 → 拼写英文            stage 2 → 3（三个点，进入复习队列）
 *   整组推进：组内所有词都点亮第 k 个点，才出现第 k+1 轮。
 *   复习：1 / 2 / 4 / 7 / 15 天，五次都过 → 掌握。
 *   答「认识」进下一档；「模糊」原地 4 小时；「不认识」退一档 + 4 小时。
 *   生词本：答错自动收录，累计答对 3 次自动移出（学习/复习/生词本里都算）。
 *
 * 进度全部存在 localStorage 的 danci.v1.state 里（可导出成 JSON 备份）。
 */

export const ROUNDS = 3;
export const REVIEW_DAYS = [1, 2, 4, 7, 15];
export const FUZZY_SECONDS = 4 * 3600;
export const NOTEBOOK_GRADUATE = 3;
export const BOOK_ORDER = ['六级核心', '六级', '四级', '考研', '托福', '雅思', 'GRE', '高考', '中考'];
export const STORE_KEY = 'danci.v1.state';

/* localStorage 在 file:// 或微信/WPS/iOS 的 WebView 里可能直接抛 SecurityError。
 * 这里先探测一次；不可用就退化成内存存储（本次会话照常用，关掉页面就丢）。 */
const memStore = new Map();
let _persist = null;
export function canPersist() {
  if (_persist !== null) return _persist;
  try {
    localStorage.setItem('danci.probe', '1');
    localStorage.removeItem('danci.probe');
    _persist = true;
  } catch (e) {
    _persist = false;
  }
  return _persist;
}
const store = {
  get(k) {
    if (canPersist()) {
      try { return localStorage.getItem(k); } catch (e) { /* 退化成内存 */ }
    }
    return memStore.has(k) ? memStore.get(k) : null;
  },
  set(k, v) {
    if (canPersist()) {
      try { localStorage.setItem(k, v); return; } catch (e) { /* 退化成内存 */ }
    }
    memStore.set(k, v);
  },
};

const nowSec = () => Math.floor(Date.now() / 1000);
const pad2 = (n) => String(n).padStart(2, '0');

export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function dayStartSec(ts = nowSec()) {
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function freshRecord(word) {
  return {
    w: word, ph: '', tr: '',
    stage: 0, reviewStep: 0, state: 'new', dueAt: null,
    firstSeen: null, lastSeen: null, seen: 0, right: 0, wrong: 0,
    starred: 0, inNotebook: 0, notebookRight: 0,
    spellOk: 0, spellWrong: 0, groupId: null, order: null,
  };
}

export class Engine {
  constructor(state) {
    this.s = state;
    this.manifest = null;      // {books:[{slug,name,count}]}
    this.words = [];           // 当前词书的词条数组
    this.index = new Map();    // word -> item
    this.slug = '';
    this.book = '';
  }

  /* ---------- 生命周期 ---------- */

  static empty() {
    return { v: 2, book: '', groupSize: 20, nextGroupId: 1, words: {}, groups: [], logs: [] };
  }

  static load() {
    try {
      const raw = store.get(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.v >= 2 && s.words) return new Engine(s);
      }
    } catch (e) { /* 坏数据就当新开始 */ }
    return new Engine(Engine.empty());
  }

  save() {
    try {
      store.set(STORE_KEY, JSON.stringify(this.s));
    } catch (e) {
      console.warn('保存失败（可能是浏览器存储满了）', e);
    }
  }

  reset() {
    this.s = Engine.empty();
    this.save();
  }

  exportJSON() {
    return JSON.stringify({ app: 'danci-web', v: this.s.v, exportedAt: new Date().toISOString(), state: this.s });
  }

  /** 用导出的 JSON 覆盖本机进度；返回导入的词条数 */
  importJSON(text) {
    const data = JSON.parse(text);
    const s = data && data.state ? data.state : data;
    if (!s || typeof s !== 'object' || !s.words || typeof s.words !== 'object') {
      throw new Error('文件格式不对');
    }
    s.v = s.v || 2;
    s.groupSize = Math.max(1, Math.min(200, Number(s.groupSize) || 20));
    s.groups = Array.isArray(s.groups) ? s.groups : [];
    s.logs = Array.isArray(s.logs) ? s.logs : [];
    s.nextGroupId = Number(s.nextGroupId) || (s.groups.length + 1);
    this.s = s;
    this.save();
    return Object.keys(s.words).length;
  }

  /* ---------- 词书 ---------- */

  setManifest(manifest) {
    this.manifest = manifest;
  }

  bookList() {
    const list = (this.manifest && this.manifest.books) || [];
    return list.slice().sort((a, b) => {
      const ia = BOOK_ORDER.indexOf(a.name), ib = BOOK_ORDER.indexOf(b.name);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.count - a.count;
    });
  }

  async loadBook(slug) {
    // 单文件版把词库内联成 window.__BOOKS，避免 file:// 下 fetch 被拦
    let list;
    if (typeof window !== 'undefined' && window.__BOOKS && window.__BOOKS[slug]) {
      list = window.__BOOKS[slug];
    } else {
      const res = await fetch(`data/books/${slug}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error('词书加载失败: ' + slug);
      list = await res.json();
    }
    this.words = list;
    this.index = new Map(list.map((it) => [it.word, it]));
    const meta = this.bookList().find((b) => b.slug === slug);
    this.slug = slug;
    this.book = meta ? meta.name : slug;
    this.s.book = this.book;
    return meta;
  }

  setBook(slug) { return this.loadBook(slug); }

  activeBook() { return this.book; }

  bookOfPrefix() { return '|' + this.book + '|'; }

  /* ---------- 记录 ---------- */

  peek(word) { return this.s.words[word] || null; }

  ensure(word) {
    let r = this.s.words[word];
    if (!r) { r = freshRecord(word); this.s.words[word] = r; }
    const info = this.index.get(word);
    if (info) {
      r.ph = info.phonetic || r.ph || '';
      r.tr = info.translation || r.tr || '';
      if (r.order == null) r.order = info.id;
    }
    return r;
  }

  members(gid) {
    return Object.values(this.s.words).filter((r) => r.groupId === gid);
  }

  /* ---------- 组 ---------- */

  groupSize() { return Math.max(1, Math.min(200, Number(this.s.groupSize) || 20)); }

  setGroupSize(n) {
    const size = Math.max(1, Math.min(200, Math.round(Number(n) || 20)));
    this.s.groupSize = size;
    const g = this.currentGroup();
    if (g) this.resizeGroup(g.id, size);
    this.save();
    return size;
  }

  startedToday() {
    const day = todayStr();
    let n = 0;
    for (const g of this.s.groups) if (g.day === day) n += this.members(g.id).length;
    return n;
  }

  currentGroup() {
    const gs = this.s.groups.filter((g) => g.finishedAt == null && this.members(g.id).some((r) => r.stage < ROUNDS && !r.starred));
    return gs.length ? gs[gs.length - 1] : null;
  }

  newGroup() {
    const size = this.groupSize();
    const room = size - this.startedToday();
    if (room <= 0) return null;
    const picked = [];
    for (const it of this.words) {
      if (picked.length >= room) break;
      const r = this.peek(it.word);
      if (r && (r.groupId != null || r.starred || r.state !== 'new' || r.stage >= 1)) continue;
      picked.push(it);
    }
    if (!picked.length) return null;
    const g = { id: this.s.nextGroupId++, day: todayStr(), size: picked.length, startedAt: nowSec(), finishedAt: null };
    this.s.groups.push(g);
    for (const it of picked) {
      const r = this.ensure(it.word);
      r.groupId = g.id;
      r.state = 'learning';
      r.stage = 0;
      r.dueAt = null;
      r.order = it.id;
    }
    this.save();
    return g;
  }

  resizeGroup(gid, n) {
    const g = this.s.groups.find((x) => x.id === gid);
    if (!g) return;
    let members = this.members(gid).sort((a, b) => b.stage - a.stage || (a.order || 0) - (b.order || 0));
    if (members.length > n) {
      for (const r of members.slice(n)) {
        r.groupId = null; r.stage = 0; r.state = 'new'; r.dueAt = null;
        r.spellOk = 0; r.spellWrong = 0;
      }
      members = members.slice(0, n);
    } else if (members.length < n) {
      const need = n - members.length;
      const taken = new Set(Object.values(this.s.words).filter((r) => r.groupId != null).map((r) => r.w));
      const added = [];
      for (const it of this.words) {
        if (added.length >= need) break;
        if (taken.has(it.word)) continue;
        const r = this.peek(it.word);
        if (r && (r.starred || r.state !== 'new' || r.stage >= 1)) continue;
        added.push(it);
      }
      for (const it of added) {
        const r = this.ensure(it.word);
        r.groupId = gid; r.state = 'learning'; r.stage = 0; r.dueAt = null; r.order = it.id;
      }
      members = members.concat(added.map((it) => this.ensure(it.word)));
    }
    g.size = members.length;
    this.save();
  }

  groupProgress() {
    const g = this.currentGroup();
    if (!g) return null;
    const counts = new Array(ROUNDS + 1).fill(0);
    let total = 0;
    for (const r of this.members(g.id)) {
      if (r.starred) continue;
      total++;
      counts[Math.min(r.stage, ROUNDS)]++;
    }
    const remaining = counts.slice(0, ROUNDS);
    let round = ROUNDS;
    for (let i = 0; i < remaining.length; i++) if (remaining[i] > 0) { round = i + 1; break; }
    return {
      id: g.id, size: total, done: counts[ROUNDS], stageCounts: counts,
      round, rounds: ROUNDS, inRoundLeft: remaining[round - 1] || 0,
    };
  }

  /* ---------- 计数 ---------- */

  counts() {
    const now = nowSec();
    const start = dayStartSec(now);
    let due = 0, mastered = 0, learning = 0, notebook = 0;
    const doneToday = new Set(), reviewToday = new Set();
    for (const r of Object.values(this.s.words)) {
      if (r.state === 'review' && !r.starred && r.dueAt != null && r.dueAt <= now) due++;
      if (r.state === 'mastered' || r.starred) mastered++;
      if (r.state === 'learning' && !r.starred) learning++;
      if (r.inNotebook) notebook++;
    }
    for (const l of this.s.logs) {
      if (l.ts < start) continue;
      if (l.a === 'done') doneToday.add(l.w);
      else if (l.a && l.a.indexOf('review-') === 0) reviewToday.add(l.w);
    }
    return {
      day: todayStr(), book: this.book || '未选词书',
      total: this.words.length,
      newDone: doneToday.size, newQuota: this.groupSize(),
      reviewDone: reviewToday.size,
      due, mastered, learning, notebook,
      notebookGraduate: NOTEBOOK_GRADUATE,
      rounds: ROUNDS, reviewSteps: REVIEW_DAYS.length,
      group: this.groupProgress(),
    };
  }

  stats() {
    const byState = {}, byStage = {};
    for (const r of Object.values(this.s.words)) {
      byState[r.state] = (byState[r.state] || 0) + 1;
      if (r.state !== 'new') byStage[r.stage] = (byStage[r.stage] || 0) + 1;
    }
    const since = nowSec() - 7 * 86400;
    const perDay = new Map();
    const last24 = {};
    const dayStart = dayStartSec();
    for (const l of this.s.logs) {
      if (l.ts >= dayStart) last24[l.a] = (last24[l.a] || 0) + 1;
      if (l.ts < since || l.a === 'done') continue;
      const d = todayStr(new Date(l.ts * 1000));
      perDay.set(d, (perDay.get(d) || 0) + 1);
    }
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = todayStr(d);
      last7.push({ day: key, c: perDay.get(key) || 0 });
    }
    return { byState, byStage, last24h: last24, last7d: last7, counts: this.counts() };
  }

  /* ---------- 抽卡 ---------- */

  optionsFor(word, n = 3) {
    const info = this.index.get(word) || { translation: (this.peek(word) || {}).tr || '' };
    const correct = (info.translation || '').trim();
    if (!correct) return [{ text: '（暂无释义）' }];
    const cands = [];
    for (const it of this.words) {
      const t = (it.translation || '').trim();
      if (!t || t === correct) continue;
      cands.push({ t, d: Math.abs(t.length - correct.length) });
    }
    cands.sort((a, b) => a.d - b.d || (a.t < b.t ? -1 : 1));
    const pool = cands.slice(0, 400).map((x) => x.t);
    const rnd = mulberry32(hashStr(word));
    // 洗牌
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const seen = new Set([correct]);
    const picked = [];
    for (const t of pool) {
      if (picked.length >= n - 1) break;
      if (seen.has(t)) continue;
      seen.add(t);
      picked.push(t);
    }
    const out = [correct, ...picked];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out.map((t) => ({ text: t }));
  }

  card(word, mode = 'learn') {
    const r = this.peek(word) || freshRecord(word);
    const info = this.index.get(word) || { word, phonetic: r.ph || '', translation: r.tr || '', example: '', example_cn: '' };
    const stage = r.stage || 0;
    const base = {
      key: info.word || word,
      word: (mode === 'learn' && stage >= ROUNDS - 1) ? '' : (info.word || word),
      mode, stage,
      reviewStep: r.reviewStep || 0,
      rounds: ROUNDS, reviewSteps: REVIEW_DAYS.length,
      inNotebook: !!r.inNotebook, notebookRight: r.notebookRight || 0,
      notebookGraduate: NOTEBOOK_GRADUATE, starred: !!r.starred,
      seen: r.seen || 0, right: r.right || 0, wrong: r.wrong || 0,
    };
    if (mode === 'learn' && stage === 0) {
      return Object.assign(base, { phonetic: info.phonetic || '', options: this.optionsFor(word) });
    }
    if (mode === 'learn' && stage >= ROUNDS - 1) {
      // 第三轮只看中文：不把英文发到前端
      return Object.assign(base, { translation: info.translation || '' });
    }
    return Object.assign(base, { phonetic: info.phonetic || '' });
  }

  pickNext(mode = 'learn') {
    const now = nowSec();
    if (mode === 'notebook') {
      const recs = Object.values(this.s.words)
        .filter((r) => r.inNotebook && !r.starred)
        .sort((a, b) => ((a.dueAt == null) - (b.dueAt == null)) || ((a.dueAt || 0) - (b.dueAt || 0)) || ((a.order || 0) - (b.order || 0)));
      return recs.length ? { mode: 'notebook', word: recs[0].w, card: this.card(recs[0].w, 'notebook') } : null;
    }
    const due = Object.values(this.s.words)
      .filter((r) => r.state === 'review' && !r.starred && r.dueAt != null && r.dueAt <= now)
      .sort((a, b) => (a.dueAt - b.dueAt) || ((a.order || 0) - (b.order || 0)));
    if (due.length) return { mode: 'review', word: due[0].w, card: this.card(due[0].w, 'review') };

    let g = this.currentGroup();
    if (!g) {
      g = this.newGroup();
      if (!g) return null;
    }
    let minStage = Infinity;
    for (const r of this.members(g.id)) if (!r.starred) minStage = Math.min(minStage, r.stage);
    if (minStage >= ROUNDS) {
      g.finishedAt = now;
      this.save();
      return null;
    }
    const cand = this.members(g.id)
      .filter((r) => r.stage === minStage && !r.starred)
      .sort((a, b) => ((a.lastSeen || 0) - (b.lastSeen || 0)) || ((a.order || 0) - (b.order || 0)));
    if (!cand.length) return null;
    return { mode: 'learn', word: cand[0].w, card: this.card(cand[0].w, 'learn') };
  }

  /* ---------- 作答 ---------- */

  answerStage(word, stage, value) {
    const now = nowSec();
    const r = this.peek(word);
    if (!r) throw new Error('word not found');
    stage = Number(stage);
    if (stage !== 0 && stage !== 1 && stage !== 2) throw new Error('bad stage');
    if (r.stage !== stage) throw new Error('stage mismatch');

    const info = this.index.get(word) || { word, translation: r.tr || '' };
    value = (value == null ? '' : String(value)).trim();
    let ok, kind;
    if (stage === 0) {
      ok = value === (info.translation || '').trim();
      kind = ok ? 's0-ok' : 's0-miss';
    } else if (stage === 1) {
      if (['know', 'fuzzy', 'unknown'].indexOf(value) < 0) throw new Error('bad answer');
      ok = value === 'know';
      kind = ok ? 's1-ok' : (value === 'fuzzy' ? 's1-fuzzy' : 's1-miss');
    } else {
      ok = !!value && value.toLowerCase() === (info.word || word).toLowerCase();
      kind = ok ? 's2-ok' : 's2-miss';
    }

    const newStage = ok ? Math.min(ROUNDS, stage + 1) : stage;
    let state = r.state;
    let due = r.dueAt;
    let step = r.reviewStep || 0;
    if (newStage >= ROUNDS) {
      state = 'review';
      if (r.stage < ROUNDS) {
        step = 0;
        due = now + Math.round(REVIEW_DAYS[0] * 86400);
      }
    } else {
      state = 'learning';
      due = null;
    }

    let notebook = r.inNotebook ? 1 : 0;
    let nbRight = r.notebookRight || 0;
    let entered = false, graduated = false;
    if (!ok) {
      if (!notebook) { notebook = 1; nbRight = 0; entered = true; }
    } else if (notebook) {
      nbRight += 1;
      if (nbRight >= NOTEBOOK_GRADUATE) { notebook = 0; nbRight = 0; graduated = true; }
    }

    r.stage = newStage; r.reviewStep = step; r.state = state; r.dueAt = due;
    r.lastSeen = now;
    if (r.firstSeen == null) r.firstSeen = now;
    r.seen = (r.seen || 0) + 1;
    r.right = (r.right || 0) + (ok ? 1 : 0);
    r.wrong = (r.wrong || 0) + (ok ? 0 : 1);
    if (stage === 2) {
      r.spellOk = (r.spellOk || 0) + (ok ? 1 : 0);
      r.spellWrong = (r.spellWrong || 0) + (ok ? 0 : 1);
    }
    r.inNotebook = notebook; r.notebookRight = nbRight;

    this.s.logs.push({ w: word, a: kind, ts: now });
    if (newStage === ROUNDS && stage < ROUNDS) {
      this.s.logs.push({ w: word, a: 'done', ts: now });
    }
    if (this.s.logs.length > 20000) this.s.logs = this.s.logs.slice(-20000);
    this.save();

    return {
      ok, correctAnswer: stage === 2 ? (info.word || word) : (info.translation || ''),
      stage: newStage, state, dueAt: due,
      inNotebook: !!notebook, notebookRight: nbRight,
      notebookEntered: entered, notebookGraduated: graduated,
      rounds: ROUNDS, reviewSteps: REVIEW_DAYS.length,
    };
  }

  answerReview(word, ans) {
    const now = nowSec();
    const r = this.peek(word);
    if (!r) throw new Error('word not found');
    if (['know', 'fuzzy', 'unknown'].indexOf(ans) < 0) throw new Error('bad answer');
    let step = r.reviewStep || 0;
    let ok = false;
    if (ans === 'know') { step += 1; ok = true; }
    else if (ans === 'unknown') { step = Math.max(0, step - 1); }

    let state, due;
    if (step >= REVIEW_DAYS.length) {
      state = 'mastered'; due = null;
    } else {
      state = 'review';
      due = now + Math.round((ok ? REVIEW_DAYS[step] * 86400 : FUZZY_SECONDS));
    }

    let notebook = r.inNotebook ? 1 : 0;
    let nbRight = r.notebookRight || 0;
    let entered = false, graduated = false;
    if (!ok) {
      if (!notebook) { notebook = 1; nbRight = 0; entered = true; }
    } else if (notebook) {
      nbRight += 1;
      if (nbRight >= NOTEBOOK_GRADUATE) { notebook = 0; nbRight = 0; graduated = true; }
    }

    r.reviewStep = step; r.state = state; r.dueAt = due;
    r.lastSeen = now;
    r.seen = (r.seen || 0) + 1;
    r.right = (r.right || 0) + (ok ? 1 : 0);
    r.wrong = (r.wrong || 0) + (ok ? 0 : 1);
    r.inNotebook = notebook; r.notebookRight = nbRight;

    this.s.logs.push({ w: word, a: 'review-' + (ans === 'know' ? 'ok' : (ans === 'fuzzy' ? 'fuzzy' : 'miss')), ts: now });
    if (this.s.logs.length > 20000) this.s.logs = this.s.logs.slice(-20000);
    this.save();

    return {
      ok, stage: ROUNDS, state, dueAt: due, step, steps: REVIEW_DAYS.length,
      inNotebook: !!notebook, notebookRight: nbRight,
      notebookEntered: entered, notebookGraduated: graduated,
    };
  }

  setFlag(word, field, value) {
    if (field !== 'starred' && field !== 'inNotebook') throw new Error('bad field');
    const r = this.ensure(word);
    if (field === 'starred' && value) {
      r.starred = 1; r.state = 'mastered'; r.dueAt = null;
    } else if (field === 'inNotebook' && !value) {
      r.inNotebook = 0; r.notebookRight = 0;
    } else {
      r[field] = value ? 1 : 0;
    }
    this.save();
  }

  notebookList(limit = 500) {
    return Object.values(this.s.words)
      .filter((r) => r.inNotebook)
      .sort((a, b) => ((a.dueAt == null) - (b.dueAt == null)) || ((a.dueAt || 0) - (b.dueAt || 0)) || ((a.order || 0) - (b.order || 0)))
      .slice(0, limit)
      .map((r) => ({ word: r.w, phonetic: r.ph || '', translation: r.tr || '', stage: r.stage, state: r.state, dueAt: r.dueAt, notebookRight: r.notebookRight || 0, seen: r.seen || 0 }));
  }

  removeFromNotebook(words) {
    const set = new Set((words || []).filter((w) => typeof w === 'string'));
    let n = 0;
    for (const w of set) {
      const r = this.peek(w);
      if (r && r.inNotebook) { r.inNotebook = 0; r.notebookRight = 0; n++; }
    }
    this.save();
    return n;
  }

  clearNotebook() {
    let n = 0;
    for (const r of Object.values(this.s.words)) {
      if (r.inNotebook) { r.inNotebook = 0; r.notebookRight = 0; n++; }
    }
    this.save();
    return n;
  }
}

export default Engine;





