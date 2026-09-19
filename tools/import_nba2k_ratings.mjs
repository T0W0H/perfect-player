/**
 * NBA 2K 属性对照工具（本地使用）
 *
 * 数据来源：Kris 的 2K25 抓取数据集（MIT 许可的抓取脚本，数据本身来自 2kratings.com）
 *   assets/data/local/nba2k25_current.csv（本地文件，不进仓库）
 *   抓取项目：https://github.com/ReinerJasin/NBA2k25_Web_Scraping
 *
 * 三种用法：
 *   node tools/import_nba2k_ratings.mjs            # 只出对比报告，不改任何东西（默认）
 *   node tools/import_nba2k_ratings.mjs --mode=2k     # 生成纯 2K 覆盖
 *   node tools/import_nba2k_ratings.mjs --mode=blend  # 生成 50/50 混合覆盖
 *
 * 生成的 assets/data/local/nba2k-ratings.local.js 只在本地（?ratings=2k）生效。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSV = path.join(ROOT, 'assets/data/local/nba2k25_current.csv');
const OUT = path.join(ROOT, 'assets/data/local/nba2k-ratings.local.js');
const ATTRS = ['threePT', 'MID', 'FIN', 'DNK', 'HAN', 'PAS', 'PDEF', 'IDEF', 'BLK', 'REB', 'ATH', 'STR', 'CLU'];
const ROSTER_FILE = 'assets/js/hupu/script-01-2678-5hu3djrc-upload-1783494754597-12.js';
const RATINGS_FILE = 'assets/js/current-player-ratings-2026.js';

const mode = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=report').split('=')[1];
const clamp = (v, lo = 25, hi = 99) => Math.max(lo, Math.min(hi, Math.round(v)));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');

/* ---------- CSV ---------- */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.length > 3).map((r) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
    return obj;
  });
}

/* ---------- 我们的名单（vm 里跑一遍，拿到校准后的属性） ---------- */
function loadOurLeague() {
  const context = { window: {} };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, ROSTER_FILE), 'utf8') + '\n' +
    fs.readFileSync(path.join(ROOT, RATINGS_FILE), 'utf8') + '\n' +
    ';globalThis.__DATA = NBA2K_DATA;',
    context
  );
  const out = [];
  Object.keys(context.__DATA).forEach((team) => {
    const roster = context.__DATA[team];
    if (!Array.isArray(roster)) return;
    roster.forEach((p) => out.push({ team, ...p }));
  });
  return out;
}

/* ---------- 2K → 我们的 13 项属性 ---------- */
const num = (row, key) => {
  const v = Number(row[key]);
  return Number.isFinite(v) && v > 0 ? v : null;
};

function mapTwoK(row) {
  const n = (k) => num(row, k);
  const blend = (list) => {
    let sum = 0, weight = 0;
    for (const [key, w] of list) {
      const v = n(key);
      if (v == null) continue;
      sum += v * w; weight += w;
    }
    return weight ? sum / weight : null;
  };
  const mapped = {
    threePT: blend([['three_point_shot', 1]]),
    MID: blend([['mid_range_shot', 1]]),
    FIN: blend([['close_shot', 0.5], ['layup', 0.3], ['post_hook', 0.1], ['post_control', 0.1]]),
    DNK: blend([['standing_dunk', 0.35], ['driving_dunk', 0.45], ['vertical', 0.2]]),
    HAN: blend([['ball_handle', 0.6], ['speed_with_ball', 0.2], ['hands', 0.2]]),
    PAS: blend([['pass_accuracy', 0.5], ['pass_vision', 0.3], ['pass_iq', 0.2]]),
    PDEF: blend([['perimeter_defense', 0.6], ['steal', 0.25], ['pass_perception', 0.15]]),
    IDEF: blend([['interior_defense', 0.6], ['help_defense_iq', 0.25], ['strength', 0.15]]),
    BLK: blend([['block', 0.85], ['vertical', 0.15]]),
    REB: blend([['offensive_rebound', 0.4], ['defensive_rebound', 0.6]]),
    ATH: blend([['speed', 0.4], ['agility', 0.35], ['vertical', 0.25]]),
    STR: blend([['strength', 1]]),
    CLU: blend([['shot_iq', 0.35], ['offensive_consistency', 0.35], ['intangibles', 0.3]]),
  };
  const out = {};
  ATTRS.forEach((k) => { if (mapped[k] != null) out[k] = clamp(mapped[k]); });
  return out;
}

/* ---------- 主流程 ---------- */
const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
const ours = loadOurLeague();
const byName = new Map();
ours.forEach((p) => { byName.set(norm(p.name), p); });

const pairs = [];
const unmatched = [];
rows.forEach((row) => {
  const p = byName.get(norm(row.name));
  if (!p) { unmatched.push(row.name); return; }
  const mapped = mapTwoK(row);
  if (Object.keys(mapped).length < 10) { unmatched.push(row.name + '（2K 无分项数据）'); return; }
  pairs.push({ row, player: p, mapped });
});

console.log('2K 行数 ' + rows.length + ' | 对上 ' + pairs.length + ' 人 | 未对上 ' + unmatched.length + ' 人');
if (unmatched.length) console.log('未对上示例：' + unmatched.slice(0, 12).join('、'));

/* 逐项均值与差距 */
console.log('\n属性   2K 均值   现有均值   平均差（2K-现有）');
const diffs = {};
ATTRS.forEach((k) => { diffs[k] = []; });
pairs.forEach(({ player, mapped }) => {
  ATTRS.forEach((k) => {
    if (mapped[k] == null) return;
    const mine = Number(player[k]);
    if (!Number.isFinite(mine)) return;
    diffs[k].push(mapped[k] - mine);
  });
});
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
ATTRS.forEach((k) => {
  const d = diffs[k];
  const t2k = mean(d.map((x, i) => 0)); // 占位，下面单独算
  const twoKAvg = mean(pairs.map(({ mapped }) => mapped[k]).filter((v) => v != null));
  const myAvg = mean(pairs.map(({ player }) => Number(player[k])).filter((v) => Number.isFinite(v)));
  console.log(k.padEnd(8) + twoKAvg.toFixed(1).padStart(8) + myAvg.toFixed(1).padStart(10) + mean(d).toFixed(1).padStart(14));
});

/* 差异最大的球员 */
console.log('\n差异最大的 15 人（按 13 项平均绝对差）');
const ranked = pairs.map((p) => {
  const list = ATTRS.filter((k) => p.mapped[k] != null && Number.isFinite(Number(p.player[k])));
  const gap = mean(list.map((k) => Math.abs(p.mapped[k] - Number(p.player[k]))));
  return { name: p.player.cname || p.player.name, team: p.player.team, gap, sample: list.slice(0, 3).map((k) => k + ' ' + p.player[k] + '→' + p.mapped[k]) };
}).sort((a, b) => b.gap - a.gap).slice(0, 15);
ranked.forEach((r) => console.log('  ' + r.name.padEnd(14) + ' 平均差 ' + r.gap.toFixed(1) + '  ' + r.sample.join('  ')));

/* 用户点名的例子 */
console.log('\n抽查');
['Rudy Gobert', 'Draymond Green', 'Stephen Curry', 'Nikola Jokic', 'Dennis Rodman', 'Ben Wallace'].forEach((name) => {
  const hit = pairs.find((p) => norm(p.player.name) === norm(name));
  if (!hit) return;
  const pick = ['REB', 'BLK', 'IDEF', 'PDEF', 'PAS', 'threePT'];
  console.log('  ' + (hit.player.cname || name).padEnd(12) + pick.map((k) => k + ' ' + (hit.player[k] ?? '-') + '→' + (hit.mapped[k] ?? '-')).join('  '));
});

/* 排序一致性：两套数据在「谁更强」上是否一致（Spearman 秩相关） */
function spearman(pairsList) {
  const n = pairsList.length;
  if (n < 5) return 0;
  const rank = (values) => {
    const sorted = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const out = new Array(values.length);
    sorted.forEach(([, i], r) => { out[i] = r + 1; });
    return out;
  };
  const a = rank(pairsList.map((p) => p.mapped));
  const b = rank(pairsList.map((p) => p.mine));
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (a[i] - b[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

console.log('\n排序一致性（相同位置组内比）：秩相关 1.0 = 完全同序');
const POS_GROUP = { PG: ['PG', 'SG'], SG: ['PG', 'SG'], SF: ['SF', 'PF'], PF: ['SF', 'PF'], C: ['C', 'PF'] };
ATTRS.forEach((k) => {
  const groups = {};
  pairs.forEach(({ player, mapped }) => {
    if (mapped[k] == null) return;
    const mine = Number(player[k]);
    if (!Number.isFinite(mine)) return;
    const pos = String(player.pos || 'SF').split('/')[0].trim();
    const g = (POS_GROUP[pos] || ['SF'])[0];
    (groups[g] = groups[g] || []).push({ mapped: mapped[k], mine });
  });
  const rels = Object.keys(groups).map((g) => spearman(groups[g])).filter((v) => v);
  const avg = rels.length ? rels.reduce((x, y) => x + y, 0) / rels.length : 0;
  const bar = '#'.repeat(Math.max(0, Math.round(avg * 20)));
  console.log('  ' + k.padEnd(8) + avg.toFixed(2) + '  ' + bar);
});

/* 生成覆盖文件 */
if (mode === '2k' || mode === 'blend') {
  const overlay = {};
  const mix = mode === 'blend' ? 0.5 : 1;
  pairs.forEach(({ row, player, mapped }) => {
    const entry = {};
    ATTRS.forEach((k) => {
      if (mapped[k] == null) return;
      const mine = Number(player[k]);
      const value = Number.isFinite(mine) ? clamp(mine * (1 - mix) + mapped[k] * mix) : mapped[k];
      if (value !== mine) entry[k] = value;
    });
    const ovr = Number(row.overall);
    if (Number.isFinite(ovr) && ovr > 0) entry.ovr = clamp(ovr * mix + (Number(player.ovr) || ovr) * (1 - mix), 60, 99);
    entry._k2 = { stamina: num(row, 'stamina'), durability: num(row, 'overall_durability'), hustle: num(row, 'hustle') };
    if (Object.keys(entry).length > 1) overlay[player.team + '|' + player.name] = entry;
  });
  const body = '/* 由 tools/import_nba2k_ratings.mjs 生成，本地使用（?ratings=2k）。数据来自 NBA 2K25。 */\n' +
    'window.NBA2K_RATINGS_2025 = ' + JSON.stringify(overlay) + ';\n' +
    '(function () {\n' +
    '  if (typeof NBA2K_DATA === "undefined") return;\n' +
    '  var table = window.NBA2K_RATINGS_2025 || {};\n' +
    '  var applied = 0;\n' +
    '  Object.keys(NBA2K_DATA).forEach(function (team) {\n' +
    '    (NBA2K_DATA[team] || []).forEach(function (p) {\n' +
    '      var e = table[team + "|" + p.name];\n' +
    '      if (!e) return;\n' +
    '      applied++;\n' +
    '      Object.keys(e).forEach(function (k) { if (k.charAt(0) !== "_") p[k] = e[k]; });\n' +
    '      p.ratingSource = "nba-2k25";\n' +
    '    });\n' +
    '  });\n' +
    '  if (typeof refreshPositionAverages === "function") refreshPositionAverages();\n' +
    '})();\n';
  fs.writeFileSync(OUT, body, 'utf8');
  console.log('\n已生成 ' + path.relative(ROOT, OUT) + '（模式 ' + mode + '，覆盖 ' + Object.keys(overlay).length + ' 人，' + fs.statSync(OUT).size + ' 字节）');
} else {
  console.log('\n（只做对比，未生成覆盖文件。要生成加 --mode=2k 或 --mode=blend）');
}
