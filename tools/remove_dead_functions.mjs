/**
 * 删除 HTML 里确定无引用的死函数
 *
 * 用法：
 *   node tools/remove_dead_functions.mjs            # dry-run，只报告
 *   node tools/remove_dead_functions.mjs --write    # 真的删
 *
 * 判定与 tools/find_dead_functions.mjs 完全一致（把已加载的外部 JS 一起当语料，
 * 排除 window.X = / wrap('X') / globalThis.X = 这类导出）。删除时按大括号配对
 * 取整段，并顺手吃掉紧贴在上面的 // 注释行。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'nba-perfect-player.html');
const WRITE = process.argv.includes('--write');

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

let html = fs.readFileSync(HTML, 'utf8');
const originalHtml = html;
let corpus = html;
EXTRA.forEach((rel) => {
  const p = path.join(ROOT, rel);
  if (fs.existsSync(p)) corpus += '\n' + fs.readFileSync(p, 'utf8');
});

function findDecls(source) {
  const out = [];
  const re = /^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(source))) out.push({ name: m[1], start: m.index });
  return out;
}

/**
 * 从 function 关键字开始做大括号配对，返回整段结束位置（含）。
 * 必须遍历时跳过字符串、模板串、注释与**正则字面量**——
 * 正则里的 } 和 { 不计入配对（首版漏了正则，把三个脚本块删坏了）。
 */
function spanEnd(source, start) {
  const open = source.indexOf('{', start);
  let depth = 0;
  let inStr = null;
  let inLine = false;
  let inBlock = false;
  // 上一个有意义字符，用来判断 / 是除号还是正则开头
  let prevSig = '';
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; prevSig = ch; continue; }
    // 正则字面量：/ 出现在表达式位置才可能是正则，跳过整段（含字符类）
    if (ch === '/' && (prevSig === '' || '=(,:[!&|?{};+*-'.includes(prevSig))) {
      let j = i + 1;
      let inClass = false;
      for (; j < source.length; j++) {
        const c = source[j];
        if (c === '\\') { j++; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        else if (c === '\n') break;   // 不是正则（跨行了），当除号处理
      }
      if (j < source.length && source[j] === '/') { i = j; prevSig = '/'; continue; }
    }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
    if (!/\s/.test(ch)) prevSig = ch;
  }
  return -1;
}

/**
 * 往上吃掉紧贴的 // 注释行与空行边界。
 * 但绝不碰分节标题（// ====== 段落名 ======）：那是文件结构的一部分，
 * 而且 tests/ 里有一堆用它们做切片锚点的测试（首版吃掉 5 个标题，
 * 直接把 no-ceiling 等测试弄挂了）。
 */
function spanStart(source, declStart) {
  let lineStart = source.lastIndexOf('\n', declStart - 1) + 1;
  const lines = [];
  while (lineStart > 0) {
    const prevEnd = lineStart - 1;
    const prevStart = source.lastIndexOf('\n', prevEnd - 1) + 1;
    const line = source.slice(prevStart, prevEnd).trim();
    if (!line.startsWith('//')) break;
    if (/^\/\/\s*=+/.test(line)) break;   // 分节标题：留着
    lines.push(prevStart);
    lineStart = prevStart;
  }
  return lines.length ? lines[lines.length - 1] : lineStart;
}

const decls = findDecls(html);
// 先定下「哪些名字是死的」（语料不变，名字集合只需算一次）
const deadNames = new Set();
for (const d of decls) {
  const re = new RegExp('(?<![\\w$])' + d.name.replace(/\$/g, '\\$') + '(?![\\w$])', 'g');
  if ((corpus.match(re) || []).length > 1) continue;
  const exported = new RegExp('window\\.' + d.name + '\\s*=').test(corpus)
    || new RegExp("wrap\\(" + "'" + d.name + "'").test(corpus)
    || new RegExp('globalThis\\.' + d.name + '\\s*=').test(corpus);
  if (exported) continue;
  deadNames.add(d.name);
}

// 逐个删，每次都重新定位。
// 不能先把所有偏移算好再删：函数可以嵌套，删掉内层后外层的旧偏移就失效了。
const removed = [];
let removedLines = 0;
for (;;) {
  const cur = findDecls(html).filter((d) => deadNames.has(d.name));
  if (!cur.length) break;
  const target = cur[cur.length - 1];        // 从后往前删
  const end = spanEnd(html, target.start);
  if (end < 0) { console.warn('大括号不配对，跳过：' + target.name); deadNames.delete(target.name); continue; }
  const start = spanStart(html, target.start);
  const before = html.slice(0, start).split('\n').length;
  const after = html.slice(0, end + 1).split('\n').length;
  removedLines += after - before + 1;
  removed.push(target.name);
  deadNames.delete(target.name);
  if (WRITE) html = html.slice(0, start) + html.slice(end + 1);
}
if (WRITE) html = html.replace(/\n{3,}/g, '\n\n');

console.log((WRITE ? '已删除 ' : '将删除 ') + removed.length + ' 个死函数，约 ' + removedLines + ' 行');
removed.slice().sort().forEach((n) => console.log('  ' + n));
if (WRITE) {
  // 安全网：先把新内容跑一遍内联脚本语法检查，不过就不写。
  // （首版跳过正则字面量，把三个脚本块删坏了，就是这一步本来该拦住的）
  const probe = new Function('html', [
    'const re = /<script(?![^>]*\\bsrc=)(?![^>]*application\\/json)[^>]*>([\\s\\S]*?)<\\/script>/gi;',
    'let m, n = 0, bad = [];',
    'while ((m = re.exec(html))) { n++; const code = m[1]; if (!code.trim()) continue;',
    '  try { new Function(code); } catch (e) { bad.push(e.message); } }',
    'return { n, bad };',
  ].join('\n'));
  const check = probe(html);
  if (check.bad.length) {
    console.error('\n中止：删除后内联脚本有 ' + check.bad.length + ' 处语法错误，文件未写入。');
    check.bad.slice(0, 5).forEach((b) => console.error('  ' + b));
    console.error('（检查 ' + check.n + ' 个脚本块）');
    process.exit(1);
  }
  // 分节标题是测试的切片锚点，少一个就可能让一堆测试找不到引擎切片
  const sectionRe = /^\/\/ =+ .+ =+$/gm;
  const beforeSections = (originalHtml.match(sectionRe) || []).length;
  const afterSections = (html.match(sectionRe) || []).length;
  if (afterSections < beforeSections) {
    console.error('\n中止：分节标题从 ' + beforeSections + ' 个变成 ' + afterSections + ' 个，文件未写入。');
    process.exit(1);
  }
  fs.writeFileSync(HTML, html, 'utf8');
  console.log('\n已写回 ' + path.relative(ROOT, HTML) + '（' + fs.statSync(HTML).size + ' 字节，' + check.n + ' 个脚本块语法通过）');
} else {
  console.log('\n（dry-run：加 --write 才会真的删）');
}
