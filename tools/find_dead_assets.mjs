/**
 * 死资源扫描：找出仓库里没有任何地方引用的文件
 *
 * 用法：node tools/find_dead_assets.mjs
 *
 * 做法：把 html / js / css / json / md 全读进来，用文件名（含相对路径的尾段）
 * 做引用匹配。只报告，不删除——删除是不可逆的，由人确认后再动手。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEARCH_EXT = ['.html', '.js', '.mjs', '.css', '.json', '.md', '.py'];
const ASSET_EXT = ['.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.woff2', '.csv'];

// 这些目录不参与扫描
const SKIP_DIRS = new Set(['.git', 'node_modules', '.github']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const all = walk(ROOT);
const textFiles = all.filter((f) => SEARCH_EXT.includes(path.extname(f).toLowerCase()));
const assets = all.filter((f) => ASSET_EXT.includes(path.extname(f).toLowerCase()));

// 把所有文本拼起来（去掉空白，避免折行导致的漏匹配）
let corpus = '';
textFiles.forEach((f) => {
  try { corpus += fs.readFileSync(f, 'utf8').replace(/\s+/g, ''); } catch (e) {}
});
// 历史 JSON 同时存在于文件名引用（headshots 用文件名索引）
const corpusNoWs = corpus;
const relCorpus = textFiles
  .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))
  .join('\n');

const dead = [];
assets.forEach((f) => {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const base = path.basename(f);
  const noExt = rel.replace(/\.[^.]+$/, '');
  // 命中任一形式就算被引用：完整相对路径、文件名、去掉扩展名的相对路径
  const referenced = corpusNoWs.includes(rel)
    || corpusNoWs.includes(base)
    || corpusNoWs.includes(noExt)
    || relCorpus.split('\n').some((line) => line !== rel && line.endsWith('/' + base) === false && line.includes(base));
  if (!referenced) dead.push({ rel, size: fs.statSync(f).size });
});

// 同一个 basename 只要有一处被引用，就不能算死
const nameRef = new Map();
dead.forEach((d) => {
  const base = path.basename(d.rel);
  nameRef.set(base, (nameRef.get(base) || 0) + 1);
});

dead.sort((a, b) => b.size - a.size);

const total = dead.reduce((s, d) => s + d.size, 0);
console.log('扫描 ' + assets.length + ' 个资源文件，疑似无引用 ' + dead.length + ' 个，共 ' + (total / 1024 / 1024).toFixed(2) + ' MB\n');
const byExt = {};
dead.forEach((d) => {
  const ext = path.extname(d.rel).toLowerCase();
  byExt[ext] = byExt[ext] || { n: 0, size: 0 };
  byExt[ext].n++;
  byExt[ext].size += d.size;
});
Object.keys(byExt).sort((a, b) => byExt[b].size - byExt[a].size).forEach((ext) => {
  console.log('  ' + ext.padEnd(8) + String(byExt[ext].n).padStart(5) + ' 个   ' + (byExt[ext].size / 1024 / 1024).toFixed(2) + ' MB');
});
console.log('\n按体积排前 25：');
dead.slice(0, 25).forEach((d) => {
  console.log('  ' + (d.size / 1024).toFixed(0).padStart(6) + ' KB  ' + d.rel);
});
