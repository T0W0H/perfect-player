/**
 * 用真实赛季数据检验属性表：模拟出的场均 vs 现实场均，谁的误差更小
 *
 * 用法：node tools/validate_ratings_against_reality.mjs [--ratings=路径] [--compare=路径] [--n=25]
 *   默认评分文件 assets/js/current-player-ratings-2026.js
 *   对比基线：git show HEAD:assets/js/current-player-ratings-2026.js > /tmp/ratings-head.js
 *             node tools/validate_ratings_against_reality.mjs --compare=/tmp/ratings-head.js
 *
 * 注意：这个替身球员永远被当成首发主力，所以绝对值有系统性偏差（得分普遍偏高）。
 * 只有**两版之间的差值**有意义——偏差是同一套引擎产生的，会互相抵消。
 *
 * 做法：把评分表的 13 项属性装进一个"替身球员"，交给游戏自己的 generatePlayerStatsNew
 * 模拟 N 场，取场均，和 Basketball Reference 的真实场均逐项比对（MAE）。
 * 这能区分"排序好看"和"模拟结果像真的"——2K 合并只借排序，必须用结果说话。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'nba-perfect-player.html');
const ROSTER = path.join(ROOT, 'assets/js/hupu/script-01-2678-5hu3djrc-upload-1783494754597-12.js');
const PER_GAME = path.join(ROOT, 'assets/data/nba-2025-26-per-game.json');

const args = process.argv.slice(2);
const argOf = (name) => (args.find((a) => a.startsWith('--' + name + '=')) || '').slice(name.length + 3);
const ratingsPath = argOf('ratings') ? path.resolve(argOf('ratings')) : path.join(ROOT, 'assets/js/current-player-ratings-2026.js');
const comparePath = argOf('compare') ? path.resolve(argOf('compare')) : null;
const games = Number(argOf('n')) || 25;

const ATTRS = ['threePT', 'MID', 'FIN', 'DNK', 'HAN', 'PAS', 'PDEF', 'IDEF', 'BLK', 'REB', 'ATH', 'STR', 'CLU'];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');

/* ---------- 装配引擎（照抄 tests/current-ratings-simulation.js 的方式） ---------- */
const html = fs.readFileSync(HTML, 'utf8');
const statStart = html.indexOf('function simSkill01');
const statEnd = html.indexOf('// ==================== 联盟其他比赛模拟', statStart);
if (statStart < 0 || statEnd < 0) throw new Error('找不到球员数据引擎');

function seededMath(seed) {
  const math = Object.create(Math);
  let state = seed >>> 0;
  math.random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  math.reseed = (s) => { state = s >>> 0; };
  return math;
}

const statContext = {
  Math: seededMath(202526),
  console,
  window: {},
  SIM_CONFIG: {
    SHOOTING: {
      threePT: { min: .22, max: .45 }, MID: { min: .25, max: .52 }, FIN: { min: .35, max: .70 }, FT: { min: .52, max: .90 },
    },
    SHOT_DIST: {
      PG: { threePT: .35, MID: .25, FIN: .25 }, SG: { threePT: .38, MID: .22, FIN: .22 }, SF: { threePT: .30, MID: .20, FIN: .30 },
      PF: { threePT: .20, MID: .18, FIN: .38 }, C: { threePT: .08, MID: .18, FIN: .48 },
    },
  },
  STATE: { position: 'PG', finalOVR: 75, careerTeam: null, career: null, season: null },
  calcOVR(attrs) { return Math.round(ATTRS.reduce((sum, key) => sum + Number(attrs[key] || 50), 0) / ATTRS.length); },
  getSimulationPowerBaseline() { return { offense: 70, defense: 70, athletic: 70, depth: 70 }; },
  simGaussian(mean, deviation) {
    const u = Math.max(0.000001, statContext.Math.random());
    const v = Math.max(0.000001, statContext.Math.random());
    return mean + Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * deviation;
  },
};
vm.createContext(statContext);
vm.runInContext(html.slice(statStart, statEnd), statContext, { filename: 'player-stat-engine.js' });

/* ---------- 读评分表 ---------- */
function loadRatings(p) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(p, 'utf8') + '\n;globalThis.__R = NBA_CURRENT_RATINGS_2026;', ctx);
  return ctx.__R;
}

/* ---------- 读真实数据 ---------- */
const perGame = JSON.parse(fs.readFileSync(PER_GAME, 'utf8')).rows;
const real = new Map();
perGame.forEach((r) => {
  const key = norm(r.name_display);
  if (!key) return;
  const prev = real.get(key);
  // 交易球员取合并行（2TM/3TM），没有则取出场最多的一行
  if (!prev || /TM$/.test(r.team_name_abbr || '') || (r.games || 0) > (prev.games || 0)) real.set(key, r);
});

/* ---------- 模拟 ---------- */
// 每位球员用固定的随机数种子：两版评分表跑同一位球员时，随机流完全一致，
// 差异只可能来自属性本身。否则上一位球员的属性变化会改变随机数消耗量，
// 污染后面所有人的结果。
function simulate(attrs, position, n, seed) {
  statContext.Math.reseed(seed);
  statContext.STATE.position = position;
  statContext.STATE.finalOVR = statContext.calcOVR(attrs);
  const total = { pts: 0, reb: 0, ast: 0, tov: 0, fgm: 0, fga: 0, threeM: 0, threeA: 0, ftm: 0, fta: 0, stl: 0, blk: 0 };
  for (let i = 0; i < n; i++) {
    const line = statContext.generatePlayerStatsNew(attrs, { scoreA: 116, scoreB: 114, pace: 99.4, boxScore: null, teamB: { power: { defense: 70 } } }, false);
    for (const k of Object.keys(total)) total[k] += line[k] || 0;
  }
  const avg = Object.fromEntries(Object.entries(total).map(([k, v]) => [k, v / n]));
  avg.fgPct = total.fgm / Math.max(1, total.fga);
  avg.ftPct = total.ftm / Math.max(1, total.fta);
  avg.threePct = total.threeM / Math.max(1, total.threeA);
  return avg;
}

/* ---------- 主流程 ---------- */
const ratings = loadRatings(ratingsPath);
const roster = { window: {} };
vm.createContext(roster);
vm.runInContext(fs.readFileSync(ROSTER, 'utf8') + '\n;globalThis.__D = NBA2K_DATA;', roster);
const rosterPlayers = Object.values(roster.__D).flat();
const rosterByKey = new Map(rosterPlayers.map((p) => [norm(p.name), p]));

// 只取有足够出场、位置明确的球员，避免小样本噪声
const MIN_MPG = 18;
const MIN_GAMES = 20;
const targets = [];
rosterPlayers.forEach((p) => {
  const r = real.get(norm(p.name));
  if (!r) return;
  if ((r.mp_per_g || 0) < MIN_MPG || (r.games || 0) < MIN_GAMES) return;
  const pos = (r.pos || '').split('-')[0] || p.pos;
  if (!['PG', 'SG', 'SF', 'PF', 'C'].includes(pos)) return;
  if (!ratings[p.team + '|' + p.name] && !Object.keys(ratings).some((k) => norm(k.split('|')[1]) === norm(p.name))) return;
  targets.push({ player: p, real: r, pos });
});

// 评分表里的属性是权威（运行时会被 applier 覆盖），按队名+英文名取
function attrsOf(p) {
  const key = Object.keys(ratings).find((k) => norm(k.split('|')[1]) === norm(p.name));
  if (!key) return null;
  const src = ratings[key];
  const out = {};
  ATTRS.forEach((a) => { out[a] = Number(src[a]); });
  return out;
}

function buildRows(table) {
  const out = [];
  targets.forEach((t, i) => {
    const key = Object.keys(table).find((k) => norm(k.split('|')[1]) === norm(t.player.name));
    if (!key) return;
    const attrs = {};
    ATTRS.forEach((a) => { attrs[a] = Number(table[key][a]); });
    // 种子只跟球员绑定，跟评分表无关
    out.push({ name: t.player.name, pos: t.pos, sim: simulate(attrs, t.pos, games, 202526 + i * 7919), real: t.real });
  });
  return out;
}

const rows = buildRows(ratings);

/* ---------- 误差统计 ---------- */
const STATS = [
  ['pts', 'pts_per_g'], ['reb', 'trb_per_g'], ['ast', 'ast_per_g'], ['tov', 'tov_per_g'],
  ['stl', 'stl_per_g'], ['blk', 'blk_per_g'], ['fgPct', 'fg_pct'], ['ftPct', 'ft_pct'], ['threePct', 'fg3_pct'],
];

function measure(list) {
  const out = {};
  STATS.forEach(([s, r]) => {
    const pairs = list.map((x) => [x.sim[s], Number(x.real[r])]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!pairs.length) return;
    const mae = pairs.reduce((a, p) => a + Math.abs(p[0] - p[1]), 0) / pairs.length;
    const bias = pairs.reduce((a, p) => a + (p[0] - p[1]), 0) / pairs.length;
    out[s] = { mae, bias, n: pairs.length };
  });
  return out;
}

function show(label, list, m) {
  console.log('\n' + label + '（' + list.length + ' 人，每人模拟 ' + games + ' 场）');
  console.log('  ' + '项目'.padEnd(10) + 'MAE'.padStart(9) + '偏差'.padStart(10));
  STATS.forEach(([s]) => {
    if (!m[s]) return;
    console.log('  ' + s.padEnd(10) + m[s].mae.toFixed(3).padStart(9) + m[s].bias.toFixed(3).padStart(10));
  });
}

const current = measure(rows);
show('当前：' + path.relative(ROOT, ratingsPath), rows, current);

if (comparePath) {
  const baseRows = buildRows(loadRatings(comparePath));
  const base = measure(baseRows);
  show('基线：' + path.relative(ROOT, comparePath), baseRows, base);
  console.log('\n差值（当前 − 基线，负数=当前更准）');
  console.log('  ' + '项目'.padEnd(10) + 'MAE 差'.padStart(10) + '偏差差'.padStart(11));
  STATS.forEach(([s]) => {
    if (!current[s] || !base[s]) return;
    const dm = current[s].mae - base[s].mae;
    const db = current[s].bias - base[s].bias;
    const mark = Math.abs(dm) < 0.01 ? '  ' : dm < 0 ? ' ✓' : ' ✗';
    console.log('  ' + s.padEnd(10) + ((dm >= 0 ? '+' : '') + dm.toFixed(3)).padStart(10) + ((db >= 0 ? '+' : '') + db.toFixed(3)).padStart(11) + mark);
  });
}
