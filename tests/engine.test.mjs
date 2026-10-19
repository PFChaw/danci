/* engine.js 的算法测试：node tests/engine.test.mjs */
import { Engine, ROUNDS, REVIEW_DAYS } from '../js/engine.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let fails = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { fails++; console.log('  FAIL ' + msg); }
}
function eq(a, b, msg) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) { fails++; console.log(`  FAIL ${msg}\n    got ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`); }
  else console.log('  ok  ' + msg);
}

const DAY = 86400;
let clock = Math.floor(Date.UTC(2026, 9, 19, 10, 0, 0) / 1000);
const realNow = Date.now;
Date.now = () => clock * 1000;

const WORDS = [
  { id: 1, word: 'abandon', phonetic: '/əˈbændən/', translation: 'v. 抛弃，放弃', example: 'He abandoned the plan.', example_cn: '他放弃了这个计划。' },
  { id: 2, word: 'abolish', phonetic: '/əˈbɒlɪʃ/', translation: 'v. 废除，废止', example: '', example_cn: '' },
  { id: 3, word: 'category', phonetic: '/ˈkætəɡəri/', translation: 'n. 种类，类别', example: '', example_cn: '' },
  { id: 4, word: 'asset', phonetic: '/ˈæset/', translation: 'n. 资产；优点', example: '', example_cn: '' },
  { id: 5, word: 'corporate', phonetic: '/ˈkɔːpərət/', translation: 'a. 公司的，法人的', example: '', example_cn: '' },
];

function makeEngine(groupSize = 3) {
  store.clear();
  const e = Engine.load();
  e.words = WORDS.slice();
  e.index = new Map(WORDS.map((w) => [w.word, w]));
  e.book = '六级核心';
  e.s.book = '六级核心';
  e.s.groupSize = groupSize;
  return e;
}

console.log('[1] 三轮推进 + 整组同步');
{
  const e = makeEngine(3);
  const first = e.pickNext('learn');
  ok(first && first.mode === 'learn' && first.card.options.length === 3, '第 1 轮发三选一');
  eq(first.card.word, 'abandon', '按词书顺序先给第 1 个');
  const r1 = e.answerStage(first.word, 0, 'v. 抛弃，放弃');
  ok(r1.ok && r1.stage === 1, '选对 → stage 1');
  const second = e.pickNext('learn');
  eq(second.card.word, 'abolish', '同轮换下一个词，不会重复给已点亮的');
}

console.log('[2] 整组：同轮内每个词只发一次，点亮完才进下一轮');
{
  const e = makeEngine(3);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const n = e.pickNext('learn');
    seen.push(n.card.word);
    e.answerStage(n.word, 0, e.index.get(n.word).translation);
  }
  eq(new Set(seen).size, 3, '第 1 轮三个词各出现一次');
  const n = e.pickNext('learn');
  eq(n.card.stage, 1, '三个都点亮后进入第 2 轮');
  eq(e.groupProgress().round, 2, '组进度显示第 2 轮');
}

console.log('[3] 答错不点亮、进生词本');
{
  const e = makeEngine(3);
  const n = e.pickNext('learn');
  const r = e.answerStage(n.word, 0, 'n. 错误选项');
  ok(!r.ok, '选错返回 ok=false');
  eq(r.stage, 0, 'stage 仍是 0');
  eq(r.state, 'learning', '状态回到 learning');
  eq(r.dueAt, null, '不进复习队列');
  eq(r.inNotebook, true, '自动进生词本');
  eq(e.counts().notebook, 1, '生词本计数 1');
}

console.log('[4] 第三轮只发中文');
{
  const e = makeEngine(1);
  const n = e.pickNext('learn');
  e.answerStage(n.word, 0, e.index.get(n.word).translation);
  e.answerStage(n.word, 1, 'know');
  const n2 = e.pickNext('learn');
  eq(n2.card.stage, 2, '第 3 轮');
  eq(n2.card.word, '', '不把英文发到前端');
  eq(n2.card.translation, e.index.get(n.word).translation, '只发中文');
  const miss = e.answerStage(n2.word, 2, 'wrongspell');
  ok(!miss.ok && miss.stage === 2, '拼错不点亮');
  const hit = e.answerStage(n2.word, 2, 'ABANDON');
  ok(hit.ok && hit.stage === 3, '拼对（大小写无关）→ stage 3');
  eq(hit.state, 'review', '进入复习队列');
  eq(hit.dueAt, clock + 1 * DAY, '首次复习 1 天后');
}

console.log('[5] 复习曲线 1/2/4/7/15 → 掌握');
{
  const e = makeEngine(1);
  const w = 'abandon';
  const n = e.pickNext('learn');
  e.answerStage(w, 0, e.index.get(w).translation);
  e.answerStage(w, 1, 'know');
  e.answerStage(w, 2, w);
  const expects = [1, 2, 4, 7, 15];
  for (let i = 0; i < REVIEW_DAYS.length; i++) {
    clock = e.peek(w).dueAt + 1;
    const next = e.pickNext('learn');
    eq(next.mode, 'review', `第 ${i + 1} 次复习被抽到`);
    const r = e.answerReview(w, 'know');
    eq(r.step, i + 1, `step 进到 ${i + 1}`);
    if (i + 1 < REVIEW_DAYS.length) eq(r.dueAt, clock + expects[i + 1] * DAY, `下次间隔 ${expects[i + 1]} 天`);
  }
  const done = e.answerReview; // noop
  eq(e.peek(w).state, 'mastered', '五次都过 → 掌握');
  eq(e.peek(w).dueAt, null, '掌握后不在队列里');
  ok(e.pickNext('learn') === null || e.pickNext('learn').mode !== 'review', '不再抽到它');
}

console.log('[6] 模糊原地 4 小时、不认识退一档');
{
  const e = makeEngine(1);
  const n = e.pickNext('learn');
  const w = n.card.word;
  e.answerStage(w, 0, e.index.get(w).translation);
  e.answerStage(w, 1, 'know');
  e.answerStage(w, 2, w);
  clock = e.peek(w).dueAt + 1;
  let r = e.answerReview(w, 'know');
  eq(r.step, 1, '答对进一档');
  clock = e.peek(w).dueAt + 1;
  r = e.answerReview(w, 'fuzzy');
  eq(r.step, 1, '模糊档位不变');
  eq(r.dueAt, clock + 4 * 3600, '模糊 4 小时后再来');
  clock = e.peek(w).dueAt + 1;
  r = e.answerReview(w, 'unknown');
  eq(r.step, 0, '不认识退到 0');
  eq(r.dueAt, clock + 4 * 3600, '退档后 4 小时');
  eq(r.inNotebook, true, '不认识进生词本');
}

console.log('[7] 生词本：答对 3 次毕业');
{
  const e = makeEngine(1);
  const n = e.pickNext('learn');
  const w = n.card.word;
  e.answerStage(w, 0, 'x'); // 错误 → 进本
  eq(e.peek(w).notebookRight, 0, '刚进来 0/3');
  let r = e.answerStage(w, 0, e.index.get(w).translation);
  eq(r.notebookRight, 1, '答对 1 次 → 1/3');
  eq(r.inNotebook, true, '还在本里');
  r = e.answerStage(w, 1, 'know');
  eq(r.notebookRight, 2, '2/3');
  r = e.answerStage(w, 2, w);
  eq(r.notebookGraduated, true, '3/3 毕业');
  eq(e.counts().notebook, 0, '生词本空了');
}

console.log('[8] 组大小可改，且立刻裁组');
{
  const e = makeEngine(3);
  e.pickNext('learn');
  eq(e.groupProgress().size, 3, '初始 3 个');
  e.setGroupSize(2);
  eq(e.groupProgress().size, 2, '改成 2 后当场裁掉一个');
  eq(e.groupSize(), 2, '设置记住');
}

console.log('[9] 三选一选项稳定且含正确答案');
{
  const e = makeEngine(5);
  const a = e.optionsFor('abandon').map((o) => o.text);
  const b = e.optionsFor('abandon').map((o) => o.text);
  eq(a, b, '同一词两次选项一致（刷新不跳）');
  ok(a.includes('v. 抛弃，放弃'), '正确项在里面');
  eq(new Set(a).size, 3, '三个不重复');
}

console.log('[10] 计数：done 去重、复习按天');
{
  const e = makeEngine(2);
  const n0 = e.pickNext('learn');
  const w0 = n0.card.word;
  e.answerStage(w0, 0, e.index.get(w0).translation);
  e.answerStage(w0, 1, 'know');
  e.answerStage(w0, 2, w0);
  const c = e.counts();
  eq(c.newDone, 1, '今日新学 1');
  eq(c.newQuota, 2, '配额 2');
  clock = e.peek(w0).dueAt + 1;
  e.answerReview(w0, 'know');
  eq(e.counts().reviewDone, 1, '今日复习 1');
}

console.log('[11] 导出 / 导入');
{
  const e = makeEngine(2);
  const n1 = e.pickNext('learn');
  e.answerStage(n1.card.word, 0, 'x');
  const dump = e.exportJSON();
  store.clear();
  const e2 = Engine.load();
  e2.words = WORDS.slice();
  e2.index = new Map(WORDS.map((w) => [w.word, w]));
  const n = e2.importJSON(dump);
  ok(n >= 1, '导入 ' + n + ' 条记录');
  const w1 = n1.card.word;
  eq(e2.peek(w1).inNotebook, 1, '进度带回来了');
}

Date.now = realNow;
console.log(fails ? `\n${fails} 项失败` : '\nALL PASS');
process.exit(fails ? 1 : 0);




