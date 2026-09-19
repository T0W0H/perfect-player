/**
 * 生成「历史新秀名单」——未来赛季的新秀改用真实历史球员，不再用匿名名单。
 *
 * 数据来源（都在仓库里，公开站点可加载）：
 *   assets/data/historical/draft_classes.json   1947-2026 共 80 届选秀（真实姓名/位置/顺位/评分种子）
 *   assets/data/historical/player_seasons_*.json 63 个赛季的真实技术统计（勾手/篮板/助攻/抢断/盖帽/命中率）
 *   assets/data/historical/headshots/            已有的历史头像（有就用真脸）
 *
 * 输出 assets/js/historical-rookie-pool.js，由页面按需（idle）加载。
 * 运行：node tools/build_historical_rookie_pool.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HIST = path.join(ROOT, 'assets/data/historical');
const HEADSHOTS = path.join(HIST, 'headshots');
const OUT = path.join(ROOT, 'assets/js/historical-rookie-pool.js');

const POS_KEYS = ['PG', 'SG', 'SF', 'PF', 'C'];
const DELTA_KEYS = ['REB', 'PAS', 'BLK', 'PDEF', 'threePT', 'FIN']; // 有真实数据可依据的六项

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------- 1. 真实赛季数据 → 生涯加权平均 ---------- */
function loadSeasonStats() {
  const files = fs.readdirSync(HIST).filter((f) => /^player_seasons_\d+\.json$/.test(f));
  const byName = new Map();
  for (const file of files) {
    const json = JSON.parse(fs.readFileSync(path.join(HIST, file), 'utf8'));
    for (const row of json.rows || []) {
      const key = norm(row.displayName || row.name);
      if (!key) continue;
      const gp = Number(row.gp) || 0;
      if (gp <= 0) continue;
      const rec = byName.get(key) || { gp: 0, sum: { ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0 }, tpW: 0, tpV: 0, fgW: 0, fgV: 0, seasons: 0 };
      rec.gp += gp;
      for (const k of ['ppg', 'rpg', 'apg', 'spg', 'bpg']) rec.sum[k] += (Number(row[k]) || 0) * gp;
      if (row.tpPct != null) { rec.tpW += gp; rec.tpV += (Number(row.tpPct) || 0) * gp; }
      if (row.fgPct != null) { rec.fgW += gp; rec.fgV += (Number(row.fgPct) || 0) * gp; }
      rec.seasons += 1;
      byName.set(key, rec);
    }
  }
  const out = new Map();
  for (const [key, rec] of byName) {
    out.set(key, {
      gp: rec.gp,
      ppg: rec.sum.ppg / rec.gp,
      rpg: rec.sum.rpg / rec.gp,
      apg: rec.sum.apg / rec.gp,
      spg: rec.sum.spg / rec.gp,
      bpg: rec.sum.bpg / rec.gp,
      tpPct: rec.tpW ? rec.tpV / rec.tpW : null,
      fgPct: rec.fgW ? rec.fgV / rec.fgW : null,
      seasons: rec.seasons,
    });
  }
  return out;
}

/* ---------- 2. 选秀名单（去重，保留评分最高的那次） ---------- */
function loadDraftRows() {
  const json = JSON.parse(fs.readFileSync(path.join(HIST, 'draft_classes.json'), 'utf8'));
  const byName = new Map();
  for (const year of Object.keys(json.classes)) {
    for (const row of json.classes[year]) {
      const key = norm(row.nameEn || row.name);
      if (!key) continue;
      const prev = byName.get(key);
      if (!prev || (Number(row.ratingSeed) || 0) > (Number(prev.ratingSeed) || 0)) byName.set(key, row);
    }
  }
  return [...byName.values()];
}

/* ---------- 3. 评分种子 → 新秀总评 ----------
 * 种子来自真实生涯评价（50~87）。老规则「明星新秀 = 85」是上限参照，
 * 所以顶级历史球员以 82~86 进来，普通球员落在 66~77。 */
function seedToOvr(seed) {
  return clamp(Math.round(66 + ((Number(seed) || 60) - 60) * 0.75), 64, 86);
}

/* ---------- 4. 位置基线（用名单自身的真实数据算，不写死） ---------- */
function positionalBaselines(rows, stats) {
  const acc = {};
  POS_KEYS.forEach((p) => { acc[p] = { n: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, tp: 0, tpN: 0, fg: 0, fgN: 0 }; });
  for (const row of rows) {
    const st = stats.get(norm(row.nameEn || row.name));
    if (!st) continue;
    const pos = POS_KEYS[(Number(row.pos) || 3) - 1];
    const a = acc[pos];
    a.n += 1;
    a.rpg += st.rpg; a.apg += st.apg; a.spg += st.spg; a.bpg += st.bpg;
    if (st.tpPct != null) { a.tp += st.tpPct; a.tpN += 1; }
    if (st.fgPct != null) { a.fg += st.fgPct; a.fgN += 1; }
  }
  const out = {};
  POS_KEYS.forEach((p) => {
    const a = acc[p];
    const n = Math.max(1, a.n);
    out[p] = {
      rpg: a.rpg / n, apg: a.apg / n, spg: a.spg / n, bpg: a.bpg / n,
      tp: a.tpN ? a.tp / a.tpN : 35, fg: a.fgN ? a.fg / a.fgN : 45,
    };
  });
  return out;
}

/* ---------- 5. 真实数据 → 属性偏移 ---------- */
function profileDeltas(st, pos, base) {
  if (!st) return null;
  const d = {
    REB: clamp(Math.round((st.rpg - base.rpg) * 1.7), -14, 14),
    PAS: clamp(Math.round((st.apg - base.apg) * 1.7), -14, 14),
    BLK: clamp(Math.round((st.bpg - base.bpg) * 5.0), -14, 14),
    PDEF: clamp(Math.round((st.spg - base.spg) * 7.0), -12, 14),
    threePT: st.tpPct == null ? 0 : clamp(Math.round((st.tpPct - base.tp) * 1.0), -14, 14),
    FIN: st.fgPct == null ? 0 : clamp(Math.round((st.fgPct - base.fg) * 0.9), -12, 12),
  };
  return DELTA_KEYS.map((k) => d[k]);
}

/* ---------- 主流程 ---------- */
const stats = loadSeasonStats();
const draftRows = loadDraftRows();
const baselines = positionalBaselines(draftRows, stats);
const headshotFiles = new Set(fs.readdirSync(HEADSHOTS));

const rows = [];
let withStats = 0;
let withPhoto = 0;
let featured = 0;

for (const row of draftRows) {
  const key = norm(row.nameEn || row.name);
  const st = stats.get(key);
  const posIndex = clamp(Number(row.pos) || 3, 1, 5);
  const pos = POS_KEYS[posIndex - 1];
  const seed = Number(row.ratingSeed) || 60;
  const ovr = seedToOvr(seed);
  const historyKey = row.historyKey || key;
  let photo = null;
  for (const cand of [`local-${historyKey}.png`, `${historyKey}.png`, `local-${key}.png`]) {
    if (headshotFiles.has(cand)) { photo = cand; break; }
  }
  // 可辨识的球员：有真脸，或者评分种子很高（历史级）
  if (photo || seed >= 76) featured += 1;
  if (st) withStats += 1;
  if (photo) withPhoto += 1;
  rows.push([
    row.nameCn || row.displayName || row.nameEn || '',
    row.nameEn || row.name || '',
    posIndex,
    // 老选秀数据里有少量顺位是从 draft 代码推出来的垃圾值（如 657），归一成 0 = 未知
    (Number(row.pick) > 0 && Number(row.pick) <= 200 ? Number(row.pick) : 0),
    Number(row.draftYear) || 0,
    ovr,
    photo,
    profileDeltas(st, pos, baselines[pos]),
    photo || seed >= 76 ? 1 : 0,   // 是否「有头有脸」：抽取时优先
  ]);
}

// 有头有脸的排前面，方便运行时按权重抽取
rows.sort((a, b) => (b[8] - a[8]) || (b[5] - a[5]));

const payload = {
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  source: 'assets/data/historical/draft_classes.json + player_seasons_*.json',
  note: '真实历史球员池：未来赛季的新秀名单（nameCn, nameEn, pos 1-5, pick, draftYear, ovr, photo, deltas[REB,PAS,BLK,PDEF,threePT,FIN], featured）',
  posKeys: POS_KEYS,
  deltaKeys: DELTA_KEYS,
  rowCount: rows.length,
  statsRows: withStats,
  photoRows: withPhoto,
  featuredRows: featured,
  rows,
};

const output = '/* Auto-generated by tools/build_historical_rookie_pool.mjs. 请勿手改。 */\n' +
  'window.PERFECT_PLAYER_HISTORICAL_ROOKIES = ' + JSON.stringify(payload) + ';\n';

fs.writeFileSync(OUT, output, 'utf8');
console.log(JSON.stringify({
  output: path.relative(ROOT, OUT),
  rows: rows.length,
  statsRows: withStats,
  photoRows: withPhoto,
  featuredRows: featured,
  bytes: fs.statSync(OUT).size,
}, null, 2));
