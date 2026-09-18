#!/usr/bin/env node
/**
 * 从 BuildMyNBAPlayer（icr3am.com/nba-game/）的线上构建里导入球员名单。
 *
 * 背景与边界：
 *   - 该项目的仓库没有许可证（license: null），README 注明「仅供学习交流，请勿商用」。
 *     因此本工具生成的产物只写到 assets/data/local/（已加入 .gitignore），
 *     仅供本机体验，不会进入公开仓库。
 *   - 我们只提取「球员数据」，不导入对方的任何代码。
 *
 * 用法：
 *   node tools/import_external_pool.mjs                      # 默认读 /tmp/icr3am-app3.html
 *   node tools/import_external_pool.mjs path/to/bundle.html  # 指定抓下来的线上文件
 *   node tools/import_external_pool.mjs --source=repo ../BuildMyNBAPlayer/nba2k-data.js
 *
 * 抓取线上文件（需浏览器 UA，站点有防抓取）：
 *   curl -sS -A "Mozilla/5.0" -e "https://icr3am.com/nba-game/" \
 *     -o /tmp/icr3am-app3.html "https://icr3am.com/nba-game/__ai_app.html"
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'data', 'local');

const ATTRS = ['threePT', 'MID', 'FIN', 'DNK', 'HAN', 'PAS', 'PDEF', 'IDEF', 'BLK', 'REB', 'ATH', 'STR', 'CLU'];

function parseArgs(argv) {
  const args = { source: 'bundle', input: '' };
  argv.forEach((arg) => {
    if (arg.startsWith('--source=')) args.source = arg.slice('--source='.length);
    else if (!arg.startsWith('--')) args.input = arg;
  });
  return args;
}

/** 从代码里按大括号配对抽出一个对象字面量（能正确跳过字符串里的括号） */
function extractObjectLiteral(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) throw new Error('找不到标记: ' + marker);
  const open = text.indexOf('{', start);
  if (open < 0) throw new Error('标记后没有对象字面量: ' + marker);
  let depth = 0;
  let inString = false;
  let quote = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = true; quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error('大括号不配对: ' + marker);
}

/** 线上 bundle 用 FALLBACK={...} 内联名单；仓库快照用 const NBA2K_DATA = {...} */
function loadRawPlayerData(source, inputPath) {
  if (!inputPath) {
    throw new Error('请提供输入文件路径（线上 bundle 或仓库里的 nba2k-data.js）');
  }
  const text = fs.readFileSync(inputPath, 'utf8');
  const candidates = source === 'repo'
    ? ['const NBA2K_DATA = ', 'NBA2K_DATA = ', 'NBA2K_DATA=']
    : ['FALLBACK=', 'FALLBACK = ', 'const NBA2K_DATA = ', 'NBA2K_DATA='];
  let lastError = null;
  for (const marker of candidates) {
    if (text.indexOf(marker) < 0) continue;
    try {
      const literal = extractObjectLiteral(text, marker);
      const data = new Function('return (' + literal + ');')();
      if (data && typeof data === 'object' && Object.keys(data).length >= 10) return data;
      lastError = new Error('抽出的数据不是球队表: ' + marker);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('没找到球员名单数据');
}

function summarize(data) {
  const teams = Object.keys(data);
  let players = 0;
  let missingAttrs = 0;
  let noOvr = 0;
  teams.forEach((team) => {
    (data[team] || []).forEach((p) => {
      players++;
      if (!Number.isFinite(Number(p.ovr))) noOvr++;
      ATTRS.forEach((attr) => { if (!Number.isFinite(Number(p[attr]))) missingAttrs++; });
    });
  });
  return { teams: teams.length, players, missingAttrs, noOvr };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.input ? path.resolve(process.cwd(), args.input) : '/tmp/icr3am-app3.html';
  if (!fs.existsSync(inputPath)) {
    console.error('找不到输入文件：' + inputPath);
    console.error('抓取线上构建示例：');
    console.error('  curl -sS -A "Mozilla/5.0" -e "https://icr3am.com/nba-game/" -o /tmp/icr3am-app3.html "https://icr3am.com/nba-game/__ai_app.html"');
    process.exitCode = 1;
    return;
  }

  console.log('[导入] 读取 ' + inputPath + '（来源：' + args.source + '）');
  const data = loadRawPlayerData(args.source, inputPath);
  const stat = summarize(data);
  console.log('[导入] 球队 ' + stat.teams + ' 支 · 球员 ' + stat.players + ' 人');
  if (stat.missingAttrs) console.log('[导入] 警告：有 ' + stat.missingAttrs + ' 个属性字段缺失');
  if (stat.noOvr) console.log('[导入] 警告：有 ' + stat.noOvr + ' 名球员缺少 ovr');

  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'nba2k-data.local.json');
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));

  // 覆盖脚本：NBA2K_DATA 在游戏里是 const 全局词法绑定，不能整体重新赋值，
  // 所以这里原地替换每支球队的数组内容，保证 NBA2K_TEAMS 等引用继续有效。
  const js = [
    '/* 由 tools/import_external_pool.mjs 生成，仅本地使用（已在 .gitignore 中）。',
    '   数据来源：BuildMyNBAPlayer / icr3am.com/nba-game/，仅供个人学习体验。 */',
    '(function () {',
    '  if (typeof NBA2K_DATA === "undefined") return;',
    '  var LOCAL_POOL = ' + JSON.stringify(data) + ';',
    '  var applied = 0;',
    '  Object.keys(LOCAL_POOL).forEach(function (team) {',
    '    if (!Array.isArray(NBA2K_DATA[team])) return;',
    '    var list = LOCAL_POOL[team];',
    '    NBA2K_DATA[team].length = 0;',
    '    list.forEach(function (p) { NBA2K_DATA[team].push(p); });',
    '    applied++;',
    '  });',
    '  if (typeof console !== "undefined") console.log("[本地名单] 已覆盖 " + applied + " 支球队");',
    '})();',
    '',
  ].join('\n');
  const jsPath = path.join(outDir, 'nba2k-data.local.js');
  fs.writeFileSync(jsPath, js);

  console.log('[导入] 已写入：');
  console.log('  ' + path.relative(root, jsonPath));
  console.log('  ' + path.relative(root, jsPath));
  console.log('[导入] 这两个文件已在 .gitignore 中，不会被提交。');
}

main();
