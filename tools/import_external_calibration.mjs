#!/usr/bin/env node
/**
 * 从 BuildMyNBAPlayer（icr3am.com/nba-game/）提取平衡参数到本地。
 *
 * 与 import_external_pool.mjs 同样的边界：对方仓库没有许可证，产物只写到
 * assets/data/local/（已在 .gitignore 中），仅供本机对照与调参，不进入公开仓库。
 *
 * 用法：
 *   node tools/import_external_calibration.mjs ../BuildMyNBAPlayer/game-config.js
 *   node tools/import_external_calibration.mjs /tmp/icr3am-app3.html
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'data', 'local');

/** 我们关心的参数（键名与对方配置一致） */
const KEYS = [
  'REB_BASE', 'AST_BASE', 'NPC_REB_BASE', 'NPC_AST_BASE',
  'POS_CAP', 'POS_STAT_CAP', 'STL_COEFF', 'BLK_COEFF', 'MAIN_BOOST', 'PTS_SCALE',
  'DYNAMIC_CAP', 'TRIPLE_SUPPRESS', 'TRIPLE_CHASE', 'titlePosFactor',
];

/** 按大括号配对抽取对象字面量（能跳过字符串里的括号） */
function extractObjectLiteral(text, key) {
  const markers = [
    key + ': {', key + ':{', key + ' = {',
    '"' + key + '":{', '"' + key + '": {',
    "'" + key + "':{",
  ];
  for (const marker of markers) {
    const start = text.indexOf(marker);
    if (start < 0) continue;
    const open = text.indexOf('{', start);
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
  }
  return null;
}

function extractScalar(text, key) {
  const patterns = [
    new RegExp(key + '\\s*[:=]\\s*(-?[0-9.]+)'),
    new RegExp('"' + key + '"\\s*:\\s*(-?[0-9.]+)'),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('用法：node tools/import_external_calibration.mjs <game-config.js 或线上 bundle.html>');
    process.exitCode = 1;
    return;
  }
  const inputPath = path.resolve(process.cwd(), input);
  if (!fs.existsSync(inputPath)) {
    console.error('找不到文件：' + inputPath);
    process.exitCode = 1;
    return;
  }
  const text = fs.readFileSync(inputPath, 'utf8');
  console.log('[校准] 读取 ' + inputPath);

  const found = {};
  const missing = [];
  KEYS.forEach((key) => {
    const literal = extractObjectLiteral(text, key);
    if (literal) {
      try {
        found[key] = new Function('return (' + literal + ');')();
        return;
      } catch (err) {
        console.log('[校准] ' + key + ' 解析失败：' + err.message);
      }
    }
    const scalar = extractScalar(text, key);
    if (scalar != null) found[key] = scalar;
    else missing.push(key);
  });

  if (!Object.keys(found).length) {
    console.error('[校准] 没有提取到任何参数，确认输入文件是否正确');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'calibration.local.json');
  const payload = {
    source: 'BuildMyNBAPlayer (icr3am.com/nba-game/)',
    importedAt: new Date().toISOString(),
    note: '仅本机对照用；对方仓库未提供许可证，请勿随公开仓库分发。',
    values: found,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  console.log('[校准] 提取到 ' + Object.keys(found).length + ' 项：' + Object.keys(found).join('、'));
  if (missing.length) console.log('[校准] 未找到：' + missing.join('、'));
  console.log('[校准] 已写入 ' + path.relative(root, outPath) + '（已在 .gitignore 中）');

  // 打印一张对照表，方便直接抄进 ours 的 POSITION_SPEC
  if (found.PTS_SCALE) {
    console.log('\n[对照] 对方位置得分缩放（越小=该位置出手越少）：');
    Object.keys(found.PTS_SCALE).forEach((pos) => {
      console.log('  ' + pos + ': ' + found.PTS_SCALE[pos]);
    });
  }
  if (found.STL_COEFF) {
    console.log('[对照] 对方抢断系数（PG 最高、C 最低）：');
    Object.keys(found.STL_COEFF).forEach((pos) => {
      console.log('  ' + pos + ': ' + found.STL_COEFF[pos]);
    });
  }
}

main();
