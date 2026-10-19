// 首次登录引导流程的端到端检查：首页 → 选词书 → 每日词数 → 欢迎 → 进入学习
// 用法：node tests/onb.cdp.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SITE_PORT = 8831;
const CDP_PORT = 9341;
const SHOTS = path.resolve(import.meta.dirname, '..', 'shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, msg) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + msg);
  if (!ok) failures++;
};

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 20000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
  async wait(expr, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (await this.eval(expr)) return true; } catch {}
      await sleep(100);
    }
    return false;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(r.data, 'base64'));
  }
}

async function findWs() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(150);
  }
  throw new Error('no cdp target');
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'onb-'));
const server = spawn('python', ['-m', 'http.server', String(SITE_PORT), '--bind', '127.0.0.1'], {
  cwd: path.resolve(import.meta.dirname, '..'), stdio: 'ignore',
});
const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`,
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

let ok = false;
try {
  await sleep(1200);
  const ws = new WebSocket(await findWs());
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 520, height: 900, deviceScaleFactor: 1, mobile: false });

  // 清空本地进度，模拟「首次登录」
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${SITE_PORT}/` });
  await sleep(600);
  await cdp.eval("localStorage.clear();");
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${SITE_PORT}/#home` });
  await sleep(1200);

  check(await cdp.wait("!document.getElementById('view-home').classList.contains('hidden')"), '默认落在首页');
  check(await cdp.eval("!document.getElementById('home-sub').classList.contains('hidden')"), '首次进入显示副标题');
  await cdp.shot('onb-1-home.png');

  await cdp.eval("document.getElementById('btn-start').click()");
  await sleep(400);
  check(await cdp.wait("!document.getElementById('view-onb-book').classList.contains('hidden')"), '开始吧 → 选词书页');
  check(await cdp.eval("document.querySelectorAll('#onb-books .pick').length") >= 9, '词书列表渲染');
  await cdp.eval("document.querySelectorAll('#onb-books .pick')[2].click()");
  await cdp.shot('onb-2-book.png');

  await cdp.eval("document.getElementById('onb-book-next').click()");
  await sleep(300);
  check(await cdp.wait("!document.getElementById('view-onb-size').classList.contains('hidden')"), '下一步 → 每日词数页');
  await cdp.eval("document.querySelectorAll('#onb-sizes .pick')[0].click()");
  await cdp.shot('onb-3-size.png');

  await cdp.eval("document.getElementById('onb-size-next').click()");
  await sleep(700);
  check(await cdp.wait("!document.getElementById('view-onb-welcome').classList.contains('hidden')"), '下一步 → 欢迎页');
  check((await cdp.eval("document.querySelector('#view-onb-welcome h1').textContent.trim()")) === '欢迎', '欢迎页居中文字为「欢迎」');
  await cdp.shot('onb-4-welcome.png');

  const bookName = await cdp.eval("document.getElementById('onb-sizes') ? 'x' : 'x'");
  await cdp.eval("document.getElementById('onb-enter').click()");
  await sleep(900);
  check(await cdp.wait("!document.getElementById('view-learn').classList.contains('hidden')"), '进入 → 学习页');
  check(await cdp.wait("window.__danci && document.getElementById('w-word').textContent.length > 1"), '学习页抽到单词');
  const quota = await cdp.eval("window.__danci.engine().groupSize()");
  check(quota === 10, '每日词数已生效 = ' + quota);
  const bookSlug = await cdp.eval("window.__danci.engine().slug");
  check(bookSlug === 'cet4', '所选词书已生效 = ' + bookSlug);
  await cdp.shot('onb-5-learn.png');

  // 二次进入不该再看到引导
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${SITE_PORT}/#home` });
  await sleep(1000);
  check(await cdp.eval("document.getElementById('home-sub').classList.contains('hidden')"), '再次进入隐藏副标题');
  await cdp.eval("document.getElementById('btn-start').click()");
  await sleep(500);
  check(await cdp.eval("!document.getElementById('view-learn').classList.contains('hidden')"), '再次点开始吧 → 直接学习页');

  ok = failures === 0;
} catch (e) {
  console.error('ERROR', e);
} finally {
  try { browser.kill(); } catch {}
  try { server.kill(); } catch {}
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  console.log(ok ? 'ALL PASS' : 'FAILED');
  process.exit(ok ? 0 : 1);
}





