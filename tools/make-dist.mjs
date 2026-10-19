// 生成 dist/：Cloudflare / Netlify 要发布的静态文件（不含源码、测试、截图）
// 用法：node tools/make-dist.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ITEMS = ['index.html', 'css', 'js', 'data'];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

let bytes = 0;
let files = 0;
for (const item of ITEMS) {
  const src = path.join(ROOT, item);
  if (!fs.existsSync(src)) {
    console.error('缺少 ' + item);
    process.exit(1);
  }
  const dst = path.join(DIST, item);
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (s) => !path.basename(s).startsWith('.'),
  });
}
for (const dir of [DIST]) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { files++; bytes += fs.statSync(p).size; }
    }
  };
  walk(dir);
}
console.log(`dist/ 已生成：${files} 个文件，${(bytes / 1024 / 1024).toFixed(2)} MB`);
