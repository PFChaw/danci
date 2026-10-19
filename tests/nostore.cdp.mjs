// 模拟「localStorage 被禁」的环境（微信 / WPS / 文件预览），确认页面仍可用并提示
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const file = process.argv[2];
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'nostore-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--user-data-dir=' + udd, '--remote-debugging-port=9445', '--window-size=520,900', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 80; i++) {
  try { list = await (await fetch('http://127.0.0.1:9445/json/list')).json(); if (list.length) break; } catch {}
  await sleep(150);
}
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

await send('Page.enable');
await send('Runtime.enable');
// 在任何页面脚本之前把 localStorage 变成会抛错的 getter
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: "Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('SecurityError: blocked'); } });",
});
await send('Page.navigate', { url: pathToFileURL(path.resolve(file)).href + '#learn' });

let ok = false;
for (let i = 0; i < 120; i++) {
  if (await evalJs('document.querySelectorAll("#choices .choice").length === 3')) { ok = true; break; }
  await sleep(100);
}
const banner = await evalJs('!document.getElementById("no-store").classList.contains("hidden")');
const err = await evalJs('!document.getElementById("boot-error").classList.contains("hidden")');
const word = await evalJs('document.getElementById("w-word").textContent');
console.log('卡片可用: ' + ok);
console.log('无存储提示: ' + banner);
console.log('错误提示: ' + err);
console.log('当前词: ' + word);
const pass = ok && banner && !err;
if (process.env.SHOT) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(process.env.SHOT, Buffer.from(shot.data, 'base64'));
  console.log('shot -> ' + process.env.SHOT);
}
console.log(pass ? 'ALL PASS' : 'FAILED');
ws.close(); edge.kill(); await sleep(300); fs.rmSync(udd, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
