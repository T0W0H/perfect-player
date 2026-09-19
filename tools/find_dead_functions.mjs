/**
 * 死函数扫描：找出 HTML 里定义了但从未被调用的函数
 *
 * 用法：node tools/find_dead_functions.mjs [--limit=40]
 *
 * 只报告不删除——回调式的用法（字符串里的 onclick、window.xxx = function）
 * 容易误判，所以结果需要人工确认。扫描结果里已排除：
 *   - 出现在 HTML 属性 / 字符串里（onclick="foo()"）
 *   - 挂到 window / globalThis 上的（外部或调试入口）
 *   - 被 enhancement 包装的（wrap('foo', ...)）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'nba-perfect-player.html');
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').slice(8)) || 40;

const html = fs.readFileSync(HTML, 'utf8');

// 外部脚本也会调 HTML 里的函数，必须一起纳入语料，否则会误报。
// 只纳入页面真的会加载的那几个（见 nba-perfect-player.html 的 <script src>）。
const EXTRA = [
  'assets/js/hupu/script-00-2678-58zyeprc-upload-1783508428855-12.js',
  'assets/js/hupu/script-01-2678-5hu3djrc-upload-1783494754597-12.js',
  'assets/js/current-player-ratings-2026.js',
  'assets/js/hupu/script-02-2678-gd4jvxrc-upload-1783494754597-15.js',
  'assets/js/hupu/script-03-2678-456sfprc-upload-1783494754597-18.js',
  'assets/js/hupu/script-05-2678-qlg35lrc-upload-1783494754597-24.js',
  'assets/js/hupu/script-06-26630-uq56cnrc-upload-1782786826635-12.js',
  'assets/js/hupu/script-08-26728-c65ifqrc-upload-1785209154529-12.js',
  'assets/js/perfect-player-awards.js',
  'assets/js/perfect-player-event-library.js',
  'assets/js/perfect-player-hupu-extensions.js',
  'assets/js/perfect-player-enhancements.js',
  'assets/js/historical-rookie-pool.js',
];
let corpus = html;
EXTRA.forEach((rel) => {
  const p = path.join(ROOT, rel);
  if (fs.existsSync(p)) corpus += '\n' + fs.readFileSync(p, 'utf8');
});

// 所有声明的函数名
const decls = new Map();
const fnRe = /^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
let m;
while ((m = fnRe.exec(html))) {
  const name = m[1];
  if (!decls.has(name)) decls.set(name, { name, line: html.slice(0, m.index).split('\n').length, count: 0 });
}

// 统计每个名字在整个语料里的出现次数（含声明本身，所以 >= 2 才算被用到）
decls.forEach((info, name) => {
  const re = new RegExp('(?<![\\w$])' + name.replace(/\$/g, '\\$') + '(?![\\w$])', 'g');
  info.count = (corpus.match(re) || []).length;
  // 挂到 window / 显式导出 / 被 wrap 包装 的，都不算死
  info.exported = new RegExp('window\\.' + name + '\\s*=').test(corpus)
    || new RegExp("wrap\\(" + "'" + name + "'").test(corpus)
    || new RegExp('globalThis\\.' + name + '\\s*=').test(corpus);
});

const dead = [...decls.values()]
  .filter((d) => d.count <= 1 && !d.exported)
  .sort((a, b) => a.line - b.line);

console.log('声明函数 ' + decls.size + ' 个，疑似从未被调用 ' + dead.length + ' 个\n');
dead.slice(0, limit).forEach((d) => {
  console.log('  L' + String(d.line).padStart(6) + '  ' + d.name);
});
if (dead.length > limit) console.log('  … 还有 ' + (dead.length - limit) + ' 个，用 --limit 调整');
