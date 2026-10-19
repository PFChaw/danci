// 把整站打包成一个可双击打开的 HTML（词库内联，file:// 也能用）
// 用法：node tools/build-single.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('css/style.css');
const engine = read('js/engine.js');
const app = read('js/app.js');
const manifest = read('data/books/index.json');

// 词库全部内联
// 可选：node tools/build-single.mjs --only cet6-core[,cet6]
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 && process.argv[onlyArg + 1]
  ? new Set(process.argv[onlyArg + 1].split(',').map((s) => s.trim()).filter(Boolean))
  : null;

const manifestObj = JSON.parse(manifest);
const picked = only ? manifestObj.books.filter((b) => only.has(b.slug)) : manifestObj.books;
if (!picked.length) {
  console.error('--only 里没有匹配的词书：' + [...only].join(','));
  process.exit(1);
}
const books = {};
for (const b of picked) {
  books[b.slug] = JSON.parse(read(`data/books/${b.slug}.json`));
}
const manifestOut = JSON.stringify({ books: picked });

// engine.js / app.js 都是 ES module：去掉 export / import，按顺序拼成一个模块脚本
function stripModule(src) {
  return src
    .replace(/^\s*export\s+default\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\};\s*$/gm, '')
    .replace(/^\s*export\s+(const|let|var|function|class|async function)\s/gm, '$1 ')
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '');
}
const combined = [stripModule(engine), stripModule(app)].join('\n\n');

const dataScript =
  '<script>\n' +
  'window.__MANIFEST = ' + manifestOut + ';\n' +
  'window.__BOOKS = ' + JSON.stringify(books) + ';\n' +
  '</script>';

let out = html
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/i, '<style>\n' + css + '\n</style>')
  .replace(/<script[^>]*src="js\/engine\.js"[^>]*><\/script>\s*/i, '')
  .replace(/<script[^>]*src="js\/app\.js"[^>]*><\/script>/i,
    dataScript + '\n<script>\n(function () {\n' + combined + '\n})();\n</script>');

if (out === html || !out.includes('__BOOKS')) {
  console.error('打包失败：没有找到要替换的 <link>/<script> 标签');
  process.exit(1);
}

const destName = only ? '背单词-' + [...only].join('-') + '.html' : '背单词.html';
const dest = path.join(ROOT, destName);
fs.writeFileSync(dest, out, 'utf8');
console.log('wrote ' + dest + '  ' + (Buffer.byteLength(out) / 1024 / 1024).toFixed(2) + ' MB');


