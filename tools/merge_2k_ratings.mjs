/**
 * 把 2K 的属性合进唯一的评分文件（不产生第二份运行时数据）
 *
 * 默认 full：13 项全部直接采用 2K 数值（语义同源，实测全面更准）。
 *
 * 为什么直接用 2K：这个项目的 13 项属性（threePT / MID / FIN / DNK / HAN / PAS /
 * PDEF / IDEF / BLK / REB / ATH / STR / CLU）本来就源自 2K——基础名单
 * assets/js/hupu/script-01-*.js 就是虎扑 BuildPlayer 的 NBA2K_DATA，字段名与
 * archetype（如 "Mid-Post Playmaking Cleaner"）都是 2K 的定义。
 * 而且这份 CSV 是 2K26 的 2025-26 赛季快照（弗拉格在独行侠、杜兰特在火箭、
 * 东契奇在湖人），正好就是这个游戏模拟的那个赛季，人员和数值都对得上。
 * 自己按真实数据推导反而把刻度抬高了一档（全联盟得分偏差 +5.7），
 * 因为引擎本来就是照着 2K 的数值刻度写的。
 *
 * 2K 没有分项的人（主要是 2026 新秀）按同位置组的平均差平移到同一把尺子，
 * 保留原来的相对排序，只换刻度。390 人整份采用，135 人对齐。
 *
 * shape 是旧实验（--mode=shape）：只借 HAN / CLU 的排序，刻度保持我们自己推导的。
 * 留着是为了做对照实验，证明 full 更优。实测（--n=60，真实 2025-26 场均做判据）：
 *   shape HAN+CLU  pts −0.073  reb −0.024  ast −0.021  tov −0.008
 *   full           pts −2.615  reb −0.167  ast −0.829  tov −0.239  blk −0.224（当前采用）
 *
 * 输入：assets/data/local/nba2k25_current.csv（本地，不进仓库）
 *   下载：curl -sSL -o assets/data/local/nba2k25_current.csv \
 *     https://raw.githubusercontent.com/ReinerJasin/NBA2k25_Web_Scraping/main/output/current_nba_players.csv
 * 输出：直接改写 assets/js/current-player-ratings-2026.js（唯一评分来源）
 *
 * 运行：node tools/merge_2k_ratings.mjs              # 默认 full：13 项直接用 2K
 *       node tools/merge_2k_ratings.mjs --mode=shape  # 只借 HAN / CLU 的排序（旧实验）
 * 实验：--only=HAN,CLU  shape 模式下只借指定属性（逗号分隔），用来单独验证收益
 *       --out=路径     写到别处（默认直接改写评分表）
 *       --dry-run      只出报告，不写文件
 *       --force        评分表已合并过时强制重跑
 *
 * 合并前会打一份对比报告（秩相关 + 均值差 + 抽查），确认确实变好了再写回。
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
// 默认 full：13 项直接用 2K（定义同源，实测全面更准）。shape 只留作实验。
const FULL = argOf('mode') !== 'shape';
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

/** 2K 分项 → 我们 13 项属性的原始分值（未对齐刻度） */
const FULL_MAP = {
  threePT: [['three_point_shot', 1]],
  MID: [['mid_range_shot', 1]],
  FIN: [['close_shot', 0.5], ['layup', 0.3], ['post_hook', 0.1], ['post_control', 0.1]],
  DNK: [['standing_dunk', 0.35], ['driving_dunk', 0.45], ['vertical', 0.2]],
  HAN: [['ball_handle', 0.6], ['speed_with_ball', 0.2], ['hands', 0.2]],
  PAS: [['pass_accuracy', 0.5], ['pass_vision', 0.3], ['pass_iq', 0.2]],
  PDEF: [['perimeter_defense', 0.6], ['steal', 0.25], ['pass_perception', 0.15]],
  IDEF: [['interior_defense', 0.6], ['help_defense_iq', 0.25], ['strength', 0.15]],
  BLK: [['block', 0.85], ['vertical', 0.15]],
  REB: [['offensive_rebound', 0.4], ['defensive_rebound', 0.6]],
  ATH: [['speed', 0.4], ['agility', 0.35], ['vertical', 0.25]],
  STR: [['strength', 1]],
  // CLU 里 free_throw 占 0.35：引擎用 CLU 算罚球命中率（权重 0.50），
  // 只用 shot_iq/consistency 会让 Giannis 这种罚球差的球员 CLU 虚高到 99。
  CLU: [['shot_iq', 0.25], ['offensive_consistency', 0.22], ['intangibles', 0.18], ['free_throw', 0.35]],
};

function blendOf(row, list) {
  let sum = 0, weight = 0;
  for (const [key, w] of list) {
    const v = num(row, key);
    if (v == null) continue;
    sum += v * w; weight += w;
  }
  return weight ? sum / weight : null;
}

/** shape 模式用的三项 */
function shapeFrom2K(row) {
  return {
    FIN: blendOf(row, FULL_MAP.FIN),
    HAN: blendOf(row, FULL_MAP.HAN),
    CLU: blendOf(row, FULL_MAP.CLU),
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
  console.log('评分表已经合并过 2K（' + meta.shapeSource.mergedAt + '，模式 ' + (meta.shapeSource.mode || 'shape') + '）。');
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

/* ---------- 写回唯一评分文件 ---------- */
meta.shapeSource = {
  mode: FULL ? 'full' : 'shape',
  attributes: FULL ? ATTRS : SHAPED,
  source: 'NBA 2K26 现役球员分项（2kratings.com，经 ReinerJasin/NBA2k25_Web_Scraping 抓取，MIT 脚本）',
  matchedPlayers: matched,
  unmatchedPlayers: unmatchedNames.length,
  mergedAt: new Date().toISOString().slice(0, 10),
};

if (FULL) {
  /* ---------- full 模式：13 项全部直接用 2K 数值 ---------- */
  const beforeAvg = {};
  ATTRS.forEach((a) => { beforeAvg[a] = []; });
  // 分位置记录「2K 刻度 − 我们的刻度」的平均差，待会儿给未覆盖的人对齐
  const offsetByPos = {};
  POS_GROUPS.forEach((p) => { offsetByPos[p] = Object.fromEntries(ATTRS.map((a) => [a, []])); });

  const appliedKeys = new Set();
  csv.forEach((row) => {
    const key = Object.keys(ratings).find((k) => norm(k.split('|')[1]) === norm(row.name));
    if (!key) { unmatchedNames.push(row.name); return; }
    const entry = ratings[key];
    const mapped = {};
    ATTRS.forEach((a) => { const v = blendOf(row, FULL_MAP[a]); if (v != null) mapped[a] = clamp(v); });
    // 分项不全（新秀或数据缺失）就跳过，稍后按位置对齐刻度
    if (Object.keys(mapped).length < ATTRS.length) return;
    const pos = rosterPos.get(norm(row.name)) || posGroup(row.position_1);
    ATTRS.forEach((a) => {
      beforeAvg[a].push(Number(entry[a]));
      offsetByPos[pos][a].push(mapped[a] - Number(entry[a]));
      entry[a] = mapped[a];
    });
    entry.ratingSource = 'nba-2k26';
    const ovr = Number(row.overall);
    if (Number.isFinite(ovr) && ovr > 0) entry.ovr = clamp(ovr, 60, 99);
    appliedKeys.add(key);
  });
  const applied = appliedKeys.size;

  // 2K 没有分项的人（主要是 2026 新秀，共一百多人）也要在同一把尺子上，
  // 否则两拨人互相不可比。用同位置组里「2K 值 − 我们的值」的平均差平移过去：
  // 保留原来的相对排序，只换刻度。
  const offset = {};
  POS_GROUPS.forEach((pos) => {
    offset[pos] = {};
    ATTRS.forEach((a) => {
      const list = offsetByPos[pos][a];
      offset[pos][a] = list.length >= 5 ? mean(list) : null;
    });
  });
  const globalOffset = {};
  ATTRS.forEach((a) => {
    const all = POS_GROUPS.flatMap((pos) => offsetByPos[pos][a]);
    globalOffset[a] = all.length ? mean(all) : 0;
  });
  let aligned = 0;
  Object.keys(ratings).forEach((key) => {
    if (appliedKeys.has(key)) return;
    const entry = ratings[key];
    const pos = rosterPos.get(norm(key.split('|')[1])) || 'SF';
    ATTRS.forEach((a) => {
      const d = offset[pos][a] != null ? offset[pos][a] : globalOffset[a];
      entry[a] = clamp(Number(entry[a]) + d);
    });
    entry.ratingSource = 'nba-2k26-aligned';
    aligned += 1;
  });

  meta.shapeSource.method = '13 项直接采用 2K26 数值（不做刻度对齐），总评也用 2K 的 overall；2K 无分项的球员按同位置组的平均差平移到同一把尺子上';
  meta.shapeSource.applied = applied;
  meta.shapeSource.aligned = aligned;
  meta.shapeSource.mapping = Object.fromEntries(ATTRS.map((a) => [a, FULL_MAP[a].map(([k, w]) => k + ' ' + w).join(' + ')]));

  console.log('full 模式：' + applied + ' 人整份采用 2K26，' + aligned + ' 人按位置对齐刻度');
  console.log('  项目'.padEnd(12) + '原均值'.padStart(9) + '2K 均值'.padStart(10) + '差'.padStart(8));
  ATTRS.forEach((a) => {
    const b = mean(beforeAvg[a]);
    const after = mean(Object.keys(ratings).filter((k) => ratings[k].ratingSource === 'nba-2k26').map((k) => ratings[k][a]));
    console.log('  ' + a.padEnd(12) + b.toFixed(1).padStart(9) + after.toFixed(1).padStart(10) + (after - b).toFixed(1).padStart(8));
  });
  console.log('  对齐后的位置组均值（含 2K 无分项者）：');
  POS_GROUPS.forEach((pos) => {
    const ks = Object.keys(ratings).filter((k) => (rosterPos.get(norm(k.split('|')[1])) || 'SF') === pos);
    if (ks.length < 3) return;
    console.log('    ' + pos + '（' + ks.length + ' 人）REB ' + mean(ks.map((k) => ratings[k].REB)).toFixed(1) + '  HAN ' + mean(ks.map((k) => ratings[k].HAN)).toFixed(1) + '  PAS ' + mean(ks.map((k) => ratings[k].PAS)).toFixed(1));
  });
} else {

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

meta.shapeSource.method = '排序取自 2K，均值与标准差按位置分别对齐到 2025-26 赛季数据推导出的刻度；用真实场均做误差判据逐项验证后，只采用正收益的项';
meta.shapeSource.mapping = Object.fromEntries(SHAPED.map((a) => [a, FULL_MAP[a].map(([k, w]) => k + ' ' + w).join(' + ')]));
meta.shapeSource.rejected = 'FIN：实测得分误差 +0.266，不采用';

}   // end shape mode

const output = '/* Auto-generated by tools/update_current_player_ratings_2026.mjs. */\n' +
  (FULL ? '/* 13 项属性直接采用 NBA 2K26：tools/merge_2k_ratings.mjs --mode=full */\n'
        : (SHAPED.length ? '/* ' + SHAPED.join(' / ') + ' 的形状来自 NBA 2K26：tools/merge_2k_ratings.mjs */\n' : '')) +
  'const NBA_CURRENT_RATINGS_2026_META = ' + JSON.stringify(meta, null, 2) + ';\n' +
  'const NBA_CURRENT_RATINGS_2026 = ' + JSON.stringify(ratings) + ';\n' +
  'const NBA_CURRENT_RATINGS_2026_SAMPLES = ' + JSON.stringify(samples) + ';\n' +
  applier + '\n';

if (DRY_RUN) {
  console.log('\n--dry-run：没有写文件。');
} else {
  fs.writeFileSync(OUT, output, 'utf8');
}

if (!FULL) {
  console.log('合并完成：shape 模式，' + SHAPED.join('+') + '，' + matched + ' 人匹配（2K 共 ' + csv.length + ' 行，未匹配 ' + unmatchedNames.length + '），评分表 ' + Object.keys(ratings).length + ' 条');
  report.filter((r) => !r.pos).forEach((r) => console.log('  ' + r.attr + '：' + r.players + ' 人（按位置 ' + r.byPos + ' / 退回全局 ' + r.fallback + '），均值 ' + r.before + ' → ' + r.after + '，与原排序一致度 ' + r.shapeShift.toFixed(2)));
  POS_GROUPS.forEach((pos) => {
    const lines = report.filter((r) => r.pos === pos).map((r) => r.attr + ' ' + r.before + '→' + r.after);
    if (lines.length) console.log('  ' + pos + '（' + report.find((r) => r.pos === pos).players + ' 人）：' + lines.join('  '));
  });
} else {
  console.log('合并完成：full 模式，评分表 ' + Object.keys(ratings).length + ' 条');
}
if (!DRY_RUN) console.log('输出：' + path.relative(ROOT, OUT) + '（' + fs.statSync(OUT).size + ' 字节）');

/* 抽查 */
const pick = (name) => Object.keys(ratings).find((k) => norm(k.split('|')[1]) === norm(name));
['Stephen Curry', 'Kyrie Irving', 'Draymond Green', 'Rudy Gobert', 'Nikola Jokic'].forEach((n) => {
  const k = pick(n);
  if (!k) return;
  const r = ratings[k];
  console.log('  ' + k.padEnd(22) + 'ovr ' + r.ovr + '  FIN ' + r.FIN + '  HAN ' + r.HAN + '  CLU ' + r.CLU);
});
