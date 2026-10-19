// 自定义主题色：色板可点、滑块可拖、背景可切、刷新后仍生效
// 用法：node tests/accent.cdp.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 8835;
const CDP = 9351;
const SHOTS = path.join(ROOT, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failures++; };

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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
  async wait(expr, ms = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await this.eval(expr)) return true; } catch {} await sleep(100); }
    return false;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
  }
}

async function wsUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(150);
  }
  throw new Error('no target');
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`, 'about:blank'], { stdio: 'ignore' });

let ok = false;
try {
  await sleep(1200);
  const ws = new WebSocket(await wsUrl());
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 520, height: 900, deviceScaleFactor: 1, mobile: false });

  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/#settings` });
  await sleep(900);
  await cdp.eval("localStorage.clear(); location.reload();");
  await sleep(1200);
  await cdp.eval("document.getElementById('view-settings').scrollTo(0, 99999); window.scrollTo(0, 99999);");
  await cdp.eval("document.getElementById('swatches').scrollIntoView({block:'start'})");
  await sleep(400);
  check(await cdp.eval("document.querySelectorAll('#swatches .sw').length") >= 8, '色板渲染');
  check(await cdp.eval("getComputedStyle(document.documentElement).getPropertyValue('--accent-h').trim()") === '152', '默认色相 152');
  await cdp.shot('accent-1-default.png');

  // 选第 4 个色板（蓝）
  await cdp.eval("document.querySelectorAll('#swatches .sw')[3].click()");
  await sleep(400);
  const h1 = await cdp.eval("getComputedStyle(document.documentElement).getPropertyValue('--accent-h').trim()");
  check(h1 === '220', '点色板后 --accent-h = ' + h1);
  const saved = await cdp.eval("JSON.parse(localStorage.getItem('dcb-accent')).h");
  check(saved === 220, '已写入 localStorage');
  await cdp.shot('accent-2-blue.png');

  // 拖动滑块
  await cdp.eval("const s=document.getElementById('hue'); s.value=280; s.dispatchEvent(new Event('input',{bubbles:true}));");
  await sleep(300);
  check((await cdp.eval("getComputedStyle(document.documentElement).getPropertyValue('--accent-h').trim()")) === '280', '滑块改到 280');

  // 背景切纯色
  await cdp.eval("document.querySelector('#bg-seg .segbtn[data-bg=\"plain\"]').click()");
  await sleep(300);
  check((await cdp.eval("document.documentElement.dataset.bg")) === 'plain', '背景切到纯色');
  await cdp.shot('accent-3-plain.png');

  // 刷新后保留
  await cdp.eval("location.reload();");
  await sleep(1300);
  check((await cdp.eval("getComputedStyle(document.documentElement).getPropertyValue('--accent-h').trim()")) === '280', '刷新后色相保留');
  check((await cdp.eval("document.documentElement.dataset.bg")) === 'plain', '刷新后背景设置保留');

  // 学习页跟着变
  await cdp.eval("location.hash = '#learn';");
  await sleep(1400);
  const cardOk = await cdp.wait("document.getElementById('w-word').textContent.length > 1");
  if (!cardOk) {
    console.log('DBG', await cdp.eval("JSON.stringify({w: document.getElementById('w-word').textContent, view: document.body.dataset.view, hash: location.hash, err: window.__lastErr || null, words: window.__danci ? Object.keys(window.__danci.engine().s.words).length : -1, ready: !!window.__danci})"));
  }
  check(cardOk, '学习页出卡');
  await cdp.shot('accent-4-learn.png');

  // 浅色下也看一眼
  await cdp.eval("document.querySelector('#theme-seg .segbtn[data-theme=\"light\"]').click()");
  await sleep(500);
  await cdp.eval("location.hash = '#learn';");
  await sleep(1200);
  await cdp.shot('accent-5-light.png');
  await cdp.eval("document.querySelector('#theme-seg .segbtn[data-theme=\"dark\"]').click()");
  await sleep(300);

  // 恢复默认
  await cdp.eval("location.hash = '#settings';");
  await sleep(900);
  await cdp.eval("document.getElementById('btn-accent-reset').click()");
  await sleep(300);
  check((await cdp.eval("getComputedStyle(document.documentElement).getPropertyValue('--accent-h').trim()")) === '152', '恢复默认色相');
  check((await cdp.eval("document.documentElement.dataset.bg")) !== 'plain', '恢复默认背景');

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



