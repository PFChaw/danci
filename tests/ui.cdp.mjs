// 纯 Node 的 CDP 驱动：真实浏览器里跑完整流程（三轮 + 复习 + 生词本）
// 用法：node tests/ui.cdp.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SITE_PORT = 8803;
const CDP_PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(ok, msg) {
  if (ok) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
}

async function waitHttp(url, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('timeout waiting ' + url);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('cdp timeout ' + method)); }
      }, 20000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async waitExpr(expr, timeout = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await this.eval(expr)) return true; } catch {}
      await sleep(100);
    }
    return false;
  }
  async shot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, file), Buffer.from(data, 'base64'));
    console.log('  shot ' + file);
  }
}

// 可选参数：给一个 HTML 路径 → 测单文件版（file://），否则测目录版（本地 http）
const FILE_ARG = process.argv[2];
const targetUrl = FILE_ARG
  ? pathToFileURL(path.resolve(FILE_ARG)).href + '#learn'
  : `http://127.0.0.1:${SITE_PORT}/#learn`;

const server = FILE_ARG ? null : spawn('python', ['-m', 'http.server', String(SITE_PORT), '--bind', '127.0.0.1'], {
  cwd: ROOT, stdio: 'ignore', windowsHide: true,
});
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'dan-web-'));
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--user-data-dir=' + udd, '--remote-debugging-port=' + CDP_PORT,
  '--window-size=520,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let ws;
try {
  const list = await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  await cdp.send('Page.navigate', { url: targetUrl });
  check(await cdp.waitExpr('document.readyState === "complete" && !!window.__danci'), '页面加载 + engine 初始化');
  check(await cdp.waitExpr('document.querySelectorAll("#choices .choice").length === 3'), '第 1 轮出现 3 个中文选项');

  // 已知答案表（从站点自己的 JSON 取，作为 UI 侧对照）
  const raw = FILE_ARG
    ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data/books/cet6-core.json'), 'utf8'))
    : await (await fetch(`http://127.0.0.1:${SITE_PORT}/data/books/cet6-core.json`)).json();
  const list0 = Array.isArray(raw) ? raw : raw.words || raw.list || [];
  const answerOf = new Map(list0.map((w) => [w.word, w.translation]));
  check(list0.length > 1000, `词库 JSON 可用（${list0.length} 词）`);

  // 组大小设 3，重开一局
  await cdp.eval('(async () => { const e = __danci.engine(); e.setGroupSize(3); e.s.clearGroup?.(); await __danci.loadNext(); })()');
  check(await cdp.waitExpr('!!__danci.state.card'), '取到第一张卡');

  const seen = { 0: false, 1: false, 2: false, review: false };
  let wrongDone = false;
  let guard = 0;
  let lastKey = '';

  while (guard++ < 40) {
    const card = JSON.parse(await cdp.eval('JSON.stringify(__danci.state.card)'));
    if (!card) { console.log('  card=null, stop'); break; }
    const key = `${card.mode}:${card.stage}:${card.key || card.word}:${card.reviewStep ?? 0}`;
    if (key === lastKey) { console.log('  repeat, stop'); break; } // 卡住了，避免死循环
    lastKey = key;

    if (card.mode === 'learn' && card.stage === 0) {
      if (!seen[0]) { seen[0] = true; await cdp.shot('shots/web-r1.png'); }
      const opts = card.options || [];
      const right = answerOf.get(card.key || card.word);
      const rightIdx = opts.findIndex((o) => (o.text || o) === right);
      // 第一次故意答错，验证自动进生词本
      let idx = rightIdx;
      if (!wrongDone) {
        idx = opts.findIndex((_, i) => i !== rightIdx);
        wrongDone = true;
      }
      check(rightIdx >= 0, `第 1 轮选项里能找到正确答案（${card.key || card.word}）`);
      await cdp.eval(`document.querySelector('#choices .choice[data-i="${idx}"]').click()`);
      check(await cdp.waitExpr('!document.getElementById("fb").classList.contains("hidden")'), '第 1 轮作答后出现反馈');
      if (idx !== rightIdx) {
        const nb = await cdp.eval('__danci.engine().counts().notebook');
        check(nb >= 1, '答错自动进生词本（notebook ≥ 1）');
      }
    } else if (card.mode === 'learn' && card.stage === 1) {
      if (!seen[1]) { seen[1] = true; await cdp.shot('shots/web-r2.png'); }
      await cdp.eval('document.querySelector("#panel-self .ans[data-a=\'know\']").click()');
      check(await cdp.waitExpr('!document.getElementById("fb").classList.contains("hidden")'), '第 2 轮自评后有反馈');
    } else if (card.mode === 'learn' && card.stage === 2) {
      if (!seen[2]) { seen[2] = true; await cdp.shot('shots/web-r3.png'); }
      const masked = await cdp.eval('document.getElementById("w-word").classList.contains("masked")');
      check(masked, '第 3 轮能看到中文、看不到英文（词被遮）');
      await cdp.eval(`(() => { const i = document.getElementById('spell-input'); i.value = ${JSON.stringify(card.key || card.word)}; document.getElementById('btn-spell').click(); })()`);
      check(await cdp.waitExpr('!document.getElementById("fb").classList.contains("hidden")'), '第 3 轮拼写后有反馈');
    } else if (card.mode === 'review') {
      if (!seen.review) { seen.review = true; await cdp.shot('shots/web-review.png'); }
      await cdp.eval('document.querySelector("#panel-review .ans[data-a=\'know\']").click()');
      check(await cdp.waitExpr('!document.getElementById("fb").classList.contains("hidden")'), '复习卡作答后有反馈');
    } else {
      break;
    }

    await cdp.eval('document.getElementById("btn-next").click()');
    await sleep(120);
  }

  check(seen[0] && seen[1] && seen[2], '三轮都真实走通');
  const counts = await cdp.eval('JSON.stringify(__danci.engine().counts())');
  const c = JSON.parse(counts);
  check(c.newDone === 3, `一组 3 个词全部学完（newDone=${c.newDone}）`);
  const reviewCount = await cdp.eval('Object.values(__danci.engine().s.words).filter(r => r.state === "review").length');
  check(reviewCount === 3, `三个词都进入复习队列（${reviewCount}）`);
  const dueInH = await cdp.eval('Math.round((Object.values(__danci.engine().s.words)[0].dueAt - Date.now() / 1000) / 3600)');
  check(dueInH >= 20 && dueInH <= 28, `第一次复习安排在约 1 天后（${dueInH}h）`);
  check(c.notebook === 0, '生词本里答对 3 次后自动移出（notebook=0）');

  // 刷新后进度还在（localStorage 持久化）
  await cdp.send('Page.reload');
  check(await cdp.waitExpr('!!window.__danci && __danci.engine().counts().newDone === 3', 12000), '刷新后进度保留（localStorage 持久化）');

  // 生词本页 + 设置页可用
  await cdp.eval('__danci.switchView("notebook")');
  check(await cdp.waitExpr('!document.getElementById("nb-empty").classList.contains("hidden")'), '生词本页显示空态（词已毕业移出）');
  await cdp.shot('shots/web-notebook.png');
  await cdp.eval('__danci.switchView("settings")');
  check(await cdp.waitExpr('document.querySelectorAll("#book-list .bookbtn").length >= 1'), '设置页列出词书');
  await cdp.shot('shots/web-settings.png');
} catch (e) {
  failures++;
  console.error('EXCEPTION: ' + (e && e.stack || e));
} finally {
  try { ws && ws.close(); } catch {}
  try { edge.kill(); } catch {}
  try { server && server.kill(); } catch {}
  await sleep(300);
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);









