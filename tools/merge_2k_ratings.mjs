/**
 * 把 2K 的形状数据合进唯一的评分文件（不产生第二份运行时数据）
 *
 * 背景：13 项属性里，三分/中投/篮板/盖帽/传球/外防/内防/运动/力量/扣篮都能从真实赛季
 * 数据推出来（tools/update_current_player_ratings_2026.mjs），但**护球 / 关键**没有直接
 * 对应的统计口径，只能靠近似公式猜。2K 恰好有对应分项，所以我们只借这两项的**排序**。
 *
 * 尺子不动：2K 的绝对值比我们低（护球平均低 8 分），直接照抄会让整个联盟的助攻/失误
 * 集体走样，也会让玩家从球员身上锁到的属性凭空变差。这里做一次单调线性映射，
 * 把 2K 的分值对齐到我们原来的均值与标准差——**排序听 2K 的，刻度保持原样**。
 *
 * 而且刻度是**按位置分别对齐**的：2K 对中锋的 ball_handle 天然给得低（中锋均值 46，
 * 后卫 79），全局对齐会把整个中锋群体的护球砍掉 11 分（约基奇 −14、恩比德 −21）。
 * 分位置对齐后，每个位置组的均值/标准差都不变，只有组内的排序换成了 2K 的。
 *
 * 为什么没有 FIN：2K 的 close_shot 对中锋给得特别高（Gobert 94、Zubac 93），
 * 而我们自己的公式已经用了真实篮下命中率 + 罚球率 + 篮下出手量，比 2K 更贴引擎。
 * 实测（--only=FIN）得分 MAE +0.266，是负收益，所以不借。
 *
 * 实测（tools/validate_ratings_against_reality.mjs --n=60，真实 2025-26 场均做判据）：
 *   --only=FIN     pts +0.266 ✗
 *   --only=HAN     ast −0.030 ✓
 *   --only=CLU     pts −0.140 ✓
 *   --only=HAN,CLU pts −0.073 ✓  reb −0.024 ✓  ast −0.021 ✓  tov −0.008 ✓（当前采用）
 *
 * 输入：assets/data/local/nba2k25_current.csv（本地，不进仓库）
 *   下载：curl -sSL -o assets/data/local/nba2k25_current.csv \
 *     https://raw.githubusercontent.com/ReinerJasin/NBA2k25_Web_Scraping/main/output/current_nba_players.csv
 * 输出：直接改写 assets/js/current-player-ratings-2026.js（唯一评分来源）
 *
 * 运行：node tools/merge_2k_ratings.mjs
 * 实验：--only=HAN,CLU  只借指定属性（逗号分隔），用来单独验证每一项的收益
 *       --out=路径     写到别处（默认直接改写评分表）
 *       --dry-run      只出报告，不写文件
 *       --force        评分表已合并过时强制重跑
 *
 * 合并前会打一份对比报告（秩相关 + 均值差 + 抽查），确认形状确实变好了再写回。
 * 想知道模拟结果是否更像真的，用 tools/validate_ratings_against_reality.mjs。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSV = path.join(ROOT, 'assets/data/local/nba2k25_current.csv');
const RATINGS = path.join(ROOT, 'assets/js/current-player-ratings-2026.js');
const ROSTER = path.join(ROOT, 'assets/js/hupu/script-01-2678-5hu3djrc-upload-1783494754597-12.js');
const argv = process.argv.slice(2);
const argOf = (name) => (argv.find((a) => a.startsWith('--' + name + '=')) || '').slice(name.length + 3);
const OUT = argOf('out') ? path.resolve(argOf('out')) : RATINGS;
const DRY_RUN = argv.includes('--dry-run');
const SHAPED = (argOf('only') ? argOf('only').split(',') : ['HAN', 'CLU'])
  .map((s) => s.trim().toUpperCase())
  .filter((s) => ['FIN', 'HAN', 'CLU'].includes(s));
if (!SHAPED.length) throw new Error('--only 必须是 FIN / HAN / CLU 的组合');
const ATTRS = ['threePT', 'MID', 'FIN', 'DNK', 'HAN', 'PAS', 'PDEF', 'IDEF', 'BLK', 'REB', 'ATH', 'STR', 'CLU'];
const POS_GROUPS = ['PG', 'SG', 'SF', 'PF', 'C'];
const MIN_GROUP = 6;   // 位置组太小就退回全局刻度，避免过拟合

const clamp = (v, lo = 25, hi = 99) => Math.max(lo, Math.min(hi, Math.round(v)));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => {
  if (a.length < 2) return 1;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)) || 1;
};

if (!fs.existsSync(CSV)) {
  console.error('缺少 ' + path.relative(ROOT, CSV) + '，先按文件头的 curl 命令下载。');
  process.exit(1);
}

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

const num = (row, key) => {
  const v = Number(row[key]);
  return Number.isFinite(v) && v > 0 ? v : null;
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
const posGroup = (pos) => {
  const first = String(pos || '').split(/[/,]/)[0].trim().toUpperCase();
  return POS_GROUPS.includes(first) ? first : 'SF';
};

/** 名单里的位置（我们自己的位置，权威） */
function loadRosterPositions() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(ROSTER, 'utf8') + '\n;globalThis.__D = NBA2K_DATA;', context);
  const map = new Map();
  Object.values(context.__D).flat().forEach((p) => {
    const key = norm(p.name);
    if (key && !map.has(key)) map.set(key, posGroup(p.pos));
  });
  return map;
}

/** 2K 分项 → 我们这三项属性的原始分值（未对齐刻度） */
function shapeFrom2K(row) {
  const blend = (list) => {
    let sum = 0, weight = 0;
    for (const [key, w] of list) {
      const v = num(row, key);
      if (v == null) continue;
      sum += v * w; weight += w;
    }
    return weight ? sum / weight : null;
  };
  return {
    FIN: blend([['close_shot', 0.5], ['layup', 0.3], ['post_hook', 0.1], ['post_control', 0.1]]),
    // CLU 里 free_throw 占 0.35：引擎用 CLU 算罚球命中率（权重 0.50），
    // 只用 shot_iq/consistency 会让 Giannis 这种罚球差的球员 CLU 虚高到 99。
    HAN: blend([['ball_handle', 0.6], ['speed_with_ball', 0.2], ['hands', 0.2]]),
    CLU: blend([['shot_iq', 0.25], ['offensive_consistency', 0.22], ['intangibles', 0.18], ['free_throw', 0.35]]),
  };
}

/* ---------- 读现有评分文件 ---------- */
const source = fs.readFileSync(RATINGS, 'utf8');
const context = { window: {} };
context.window = context;
vm.createContext(context);
vm.runInContext(
  source + '\n;globalThis.__R = NBA_CURRENT_RATINGS_2026; globalThis.__M = NBA_CURRENT_RATINGS_2026_META; globalThis.__S = NBA_CURRENT_RATINGS_2026_SAMPLES;',
  context
);
const ratings = context.__R;
const meta = context.__M;
const samples = context.__S;

// 重复跑没有意义（均值/标准差不变，排序不变）；但重新生成评分表
// （update_current_player_ratings_2026.mjs）之后必须再跑一次。
if (meta.shapeSource && OUT === RATINGS && !argv.includes('--force')) {
  console.log('评分表已经合并过 2K 形状（' + meta.shapeSource.mergedAt + '）。');
  console.log('重新生成评分表后要再跑；确认要重复合并就加 --force。');
  process.exit(0);
}

/* 保留原文件里的应用函数，避免两处维护同一段逻辑 */
const applierStart = source.indexOf('(function applyCurrentPlayerRatings2026()');
const applierEnd = source.indexOf('})();', applierStart);
if (applierStart < 0 || applierEnd < 0) throw new Error('找不到评分文件里的应用函数');
const applier = source.slice(applierStart, applierEnd + 5);

/* ---------- 取 2K 的排序，按位置分组对齐刻度 ---------- */
const csv = parseCsv(fs.readFileSync(CSV, 'utf8'));
const rosterPos = loadRosterPositions();
const shaped = {};   // attr → [{ key, raw, mine, pos }]
SHAPED.forEach((a) => { shaped[a] = []; });
let matched = 0;
const unmatchedNames = [];
csv.forEach((row) => {
  const raw = shapeFrom2K(row);
  const key = Object.keys(ratings).find((k) => norm(k.split('|')[1]) === norm(row.name));
  if (!key) { unmatchedNames.push(row.name); return; }
  const mine = ratings[key];
  const pos = rosterPos.get(norm(row.name)) || posGroup(row.position_1);
  let hit = false;
  SHAPED.forEach((a) => {
    if (raw[a] == null || !Number.isFinite(Number(mine[a]))) return;
    shaped[a].push({ key, raw: raw[a], mine: Number(mine[a]), pos });
    hit = true;
  });
  if (hit) matched += 1;
});

/** 秩相关：两套排序有多一致（1.0 = 完全同序） */
function spearman(list, pick) {
  const n = list.length;
  if (n < 5) return 0;
  const rank = (values) => {
    const out = new Array(n);
    values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).forEach(([, i], r) => { out[i] = r + 1; });
    return out;
  };
  const a = rank(list.map((x) => pick(x, 'raw')));
  const b = rank(list.map((x) => pick(x, 'mine')));
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (a[i] - b[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

/** 把一组 2K 原始分单调映射到同一组原有的均值/标准差 */
function applyGroup(list, attr, target) {
  if (list.length < 3) return;
  const rawMean = mean(list.map((x) => x.raw));
  const rawSd = sd(list.map((x) => x.raw));
  const myMean = mean(list.map((x) => x.mine));
  const mySd = sd(list.map((x) => x.mine));
  list.forEach((x) => {
    // 单调线性映射：排序完全按 2K，均值/标准差回到原来的刻度
    target[x.key][attr] = clamp(myMean + ((x.raw - rawMean) / rawSd) * mySd);
  });
}

const report = [];
SHAPED.forEach((a) => {
  const list = shaped[a];
  if (list.length < 5) return;
  const target = {};
  Object.keys(ratings).forEach((k) => { target[k] = { ...ratings[k] }; });
  const groups = {};
  list.forEach((x) => { (groups[x.pos] = groups[x.pos] || []).push(x); });
  let byPos = 0;
  const small = [];
  Object.keys(groups).forEach((pos) => {
    const g = groups[pos];
    if (g.length >= MIN_GROUP) { applyGroup(g, a, target); byPos += g.length; }
    else small.push(...g);
  });
  // 位置组太小的球员，退回全局刻度（避免小样本过拟合）
  if (small.length >= 3) {
    const picked = {};
    applyGroup(small, a, picked);
    small.forEach((x) => { target[x.key][a] = picked[x.key][a]; });
  } else {
    small.forEach((x) => { target[x.key][a] = x.mine; });
  }
  // 报告用：原来的排序 vs 2K 的排序，在位置组内平均
  const rels = Object.keys(groups).filter((pos) => groups[pos].length >= MIN_GROUP).map((pos) => spearman(groups[pos], (x, f) => x[f]));
  const shapeShift = rels.length ? rels.reduce((x, y) => x + y, 0) / rels.length : 0;

  Object.keys(ratings).forEach((k) => { ratings[k][a] = target[k][a]; });
  const before = mean(list.map((x) => x.mine));
  const after = mean(list.map((x) => ratings[x.key][a]));
  report.push({ attr: a, players: list.length, byPos, fallback: small.length, before: before.toFixed(1), after: after.toFixed(1), shapeShift });
  POS_GROUPS.forEach((pos) => {
    const g = groups[pos];
    if (!g || g.length < MIN_GROUP) return;
    report.push({
      attr: a, pos, players: g.length,
      before: mean(g.map((x) => x.mine)).toFixed(1),
      after: mean(g.map((x) => ratings[x.key][a])).toFixed(1),
    });
  });
});

/* ---------- 写回唯一评分文件 ---------- */
meta.shapeSource = {
  attributes: SHAPED,
  source: 'NBA 2K25 分项（2kratings.com，经 ReinerJasin/NBA2k25_Web_Scraping 抓取，MIT 脚本）',
  method: '排序取自 2K，均值与标准差按位置分别对齐到 2025-26 赛季数据推导出的刻度；用真实场均做误差判据逐项验证后，只采用正收益的项',
  mapping: {
    HAN: 'ball_handle .6 + speed_with_ball .2 + hands .2',
    CLU: 'shot_iq .25 + offensive_consistency .22 + intangibles .18 + free_throw .35',
  },
  rejected: 'FIN（close_shot .5 + layup .3 + post_hook .1 + post_control .1）：实测得分误差 +0.266，不采用',
  matchedPlayers: matched,
  unmatchedPlayers: unmatchedNames.length,
  mergedAt: new Date().toISOString().slice(0, 10),
};

const output = '/* Auto-generated by tools/update_current_player_ratings_2026.mjs. */\n' +
  (SHAPED.length ? '/* ' + SHAPED.join(' / ') + ' 的形状来自 NBA 2K25：tools/merge_2k_ratings.mjs */\n' : '') +
  'const NBA_CURRENT_RATINGS_2026_META = ' + JSON.stringify(meta, null, 2) + ';\n' +
  'const NBA_CURRENT_RATINGS_2026 = ' + JSON.stringify(ratings) + ';\n' +
  'const NBA_CURRENT_RATINGS_2026_SAMPLES = ' + JSON.stringify(samples) + ';\n' +
  applier + '\n';

if (DRY_RUN) {
  console.log('\n--dry-run：没有写文件。');
} else {
  fs.writeFileSync(OUT, output, 'utf8');
}

console.log('合并完成：' + SHAPED.join('+') + '，' + matched + ' 人匹配（2K 共 ' + csv.length + ' 行，未匹配 ' + unmatchedNames.length + '），评分表 ' + Object.keys(ratings).length + ' 条');
report.filter((r) => !r.pos).forEach((r) => console.log('  ' + r.attr + '：' + r.players + ' 人（按位置 ' + r.byPos + ' / 退回全局 ' + r.fallback + '），均值 ' + r.before + ' → ' + r.after + '，与原排序一致度 ' + r.shapeShift.toFixed(2)));
POS_GROUPS.forEach((pos) => {
  const lines = report.filter((r) => r.pos === pos).map((r) => r.attr + ' ' + r.before + '→' + r.after);
  if (lines.length) console.log('  ' + pos + '（' + report.find((r) => r.pos === pos).players + ' 人）：' + lines.join('  '));
});
if (!DRY_RUN) console.log('输出：' + path.relative(ROOT, OUT) + '（' + fs.statSync(OUT).size + ' 字节）');

/* 抽查 */
const pick = (name) => Object.keys(ratings).find((k) => norm(k.split('|')[1]) === norm(name));
['Stephen Curry', 'Kyrie Irving', 'Draymond Green', 'Rudy Gobert', 'Nikola Jokic'].forEach((n) => {
  const k = pick(n);
  if (!k) return;
  const r = ratings[k];
  console.log('  ' + k.padEnd(22) + 'FIN ' + r.FIN + '  HAN ' + r.HAN + '  CLU ' + r.CLU);
});
