'use strict';

/**
 * 不封顶 + 生涯轨迹测试
 * 抽出 nba-perfect-player.html 里的模拟与展示函数，验证：
 *   1) 99 不再是属性 / 命中率 / 数据的硬天花板（软膝外推）；
 *   2) 生涯数据页能把「属性大幅进步 → 数据上涨」展示出来。
 * 运行：node tests/career-trend.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'nba-perfect-player.html'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到函数: ' + name);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('函数大括号不配对: ' + name);
}

function extractVarLine(source, name) {
  const start = source.indexOf('var ' + name + ' =');
  if (start < 0) throw new Error('找不到变量: ' + name);
  const end = source.indexOf('\n', start);
  return source.slice(start, end);
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

// ── 模拟层：不封顶 ──
const simSource = [
  extractVarLine(html, 'ATTR_SOFT_CAP') + ';',
  extractFunction(html, 'simSkill01'),
  extractFunction(html, 'interpolateShotCurve'),
  extractFunction(html, 'calcShotPct'),
  extractFunction(html, 'getPointCost'),
  extractFunction(html, 'clampAttrVal'),
  'return { simSkill01:simSkill01, interpolateShotCurve:interpolateShotCurve, calcShotPct:calcShotPct, getPointCost:getPointCost, clampAttrVal:clampAttrVal, ATTR_SOFT_CAP:ATTR_SOFT_CAP };',
].join('\n');

const SIM_CONFIG = {
  SHOOTING: {
    threePT: { max: 0.45, min: 0.28 },
    MID: { max: 0.52, min: 0.32 },
    FIN: { max: 0.70, min: 0.45 },
    FT: { max: 0.90, min: 0.55 },
  },
};
const sim = new Function('SIM_CONFIG', simSource)(SIM_CONFIG);

console.log('不封顶测试');

check('99 以下保持原曲线，99 不再饱和', () => {
  assert.equal(sim.simSkill01(25), 0);
  assert.equal(sim.simSkill01(99), 1);
  assert.ok(Math.abs(sim.simSkill01(62) - 0.5) < 1e-9);
  assert.ok(sim.simSkill01(120) > 1, '120 属性应超过 1：' + sim.simSkill01(120));
  assert.ok(sim.simSkill01(120) > sim.simSkill01(99));
});

check('属性上限放宽到软顶，不再卡在 99', () => {
  assert.equal(sim.ATTR_SOFT_CAP, 120, '软顶只是兜底，不是设计天花板');
  assert.equal(sim.clampAttrVal(105), 105);
  assert.equal(sim.clampAttrVal(999), sim.ATTR_SOFT_CAP);
  assert.equal(sim.clampAttrVal(20), 25);
});

check('训练点成本在 99 以上继续走高', () => {
  assert.ok(sim.getPointCost(100) > sim.getPointCost(98));
  assert.ok(sim.getPointCost(110) > sim.getPointCost(100));
  assert.ok(sim.getPointCost(118) > sim.getPointCost(110));
});

check('命中率曲线超出末端锚点后继续外推', () => {
  const anchors = [[25, .22], [50, .28], [70, .34], [85, .385], [99, .435]];
  const at99 = sim.interpolateShotCurve(99, anchors);
  const at110 = sim.interpolateShotCurve(110, anchors);
  assert.ok(Math.abs(at99 - .435) < 1e-9);
  assert.ok(at110 > at99, '110 应高于 99：' + at110);
  assert.ok(at110 < .46, '外推应当收敛：' + at110);
});

check('命中率的物理刹车会在 99 以上小幅放宽，而不是一刀切', () => {
  const pct99 = sim.calcShotPct('threePT', 99, 0, 0, 0);
  const pct120 = sim.calcShotPct('threePT', 120, 0, 0, 0);
  assert.ok(pct99 <= 0.45 + 1e-9, '99 仍受原有上限约束：' + pct99);
  assert.ok(pct120 > pct99, '120 应放宽上限：' + pct120);
  assert.ok(pct120 < 0.50, '放宽幅度应克制：' + pct120);
});

check('外推不会让低属性变强', () => {
  assert.equal(sim.simSkill01(10), 0);
  assert.equal(sim.interpolateShotCurve(10, [[25, .22], [50, .28]]), .22);
  assert.equal(sim.simSkill01(-40), 0);
});

// ── 展示层：生涯轨迹 ──
const trendSource = [
  extractFunction(html, 'getSeasonAverages'),
  extractFunction(html, 'getSeasonShortLabel'),
  extractFunction(html, 'getCareerLeapSeasons'),
  extractFunction(html, 'renderCareerTrendSection'),
  'return { getSeasonAverages:getSeasonAverages, getSeasonShortLabel:getSeasonShortLabel, getCareerLeapSeasons:getCareerLeapSeasons, renderCareerTrendSection:renderCareerTrendSection };',
].join('\n');

const ATTR_KEYS = ['threePT', 'MID', 'FIN', 'DNK', 'HAN', 'PAS', 'PDEF', 'IDEF', 'BLK', 'REB', 'ATH', 'STR', 'CLU'];
const ATTR_CN = { threePT:'三分', MID:'中投', FIN:'终结', DNK:'扣篮', HAN:'护球', PAS:'传球', PDEF:'外防', IDEF:'内防', BLK:'盖帽', REB:'篮板', ATH:'运动', STR:'力量', CLU:'关键' };
const cn = (k) => ATTR_CN[k] || k;
const getSeasonLabel = (n) => (2025 + n) + '-' + ((2026 + n) % 100) + '赛季';
const careerTrend = new Function('STATE', 'ATTR_KEYS', 'attrCN', 'getSeasonLabel', trendSource);

function makeState() {
  const base = {};
  ATTR_KEYS.forEach((k) => { base[k] = 50; });
  return {
    career: {
      seasons: [
        { seasonNum: 1, playerStats: { games: 82, pts: 1230, reb: 410, ast: 246 }, attrs: Object.assign({}, base, { threePT: 70, REB: 60 }) },
        { seasonNum: 2, playerStats: { games: 82, pts: 1640, reb: 492, ast: 328 }, attrs: Object.assign({}, base, { threePT: 78, REB: 62 }) },
        { seasonNum: 3, playerStats: { games: 80, pts: 1600, reb: 480, ast: 320 }, attrs: Object.assign({}, base, { threePT: 79, REB: 63 }) },
      ],
    },
    attrs: Object.assign({}, base, { threePT: 79, REB: 63, PAS: 72 }),
  };
}

function runTrend(state) {
  return careerTrend(state, ATTR_KEYS, cn, getSeasonLabel);
}

console.log('\n生涯轨迹测试');

check('场均按场次计算，脏数据不报错', () => {
  const api = runTrend(makeState());
  assert.equal(api.getSeasonAverages({ playerStats: { games: 82, pts: 1640 } }).pts, 20);
  assert.equal(api.getSeasonAverages({ playerStats: { pts: 100 } }).games, 0);
  assert.equal(api.getSeasonAverages(null).pts, 0);
});

check('开窍赛季只看属性涨幅 ≥3 的赛季，并按时间倒序', () => {
  const leaps = runTrend(makeState()).getCareerLeapSeasons();
  assert.equal(leaps.length, 1, 'S1→S2 三分 +8 应入选，S2→S3 只 +1 不应入选');
  assert.equal(leaps[0].season.seasonNum, 2);
  assert.deepEqual(leaps[0].gains[0], { key:'threePT', delta:8 });
  assert.equal(leaps[0].dPts, 5, '20 - 15 = 5');
});

check('缺少属性快照时（旧存档）不报错：仍然画走势，只是没有开窍赛季', () => {
  const state = makeState();
  state.career.seasons.forEach((s) => { delete s.attrs; });
  const api = runTrend(state);
  assert.deepEqual(api.getCareerLeapSeasons(), []);
  const out = api.renderCareerTrendSection();
  assert.ok(out.indexOf('生涯轨迹') >= 0, '旧存档也能看走势');
  assert.ok(out.indexOf('开窍赛季') < 0, '没有属性快照时不应编造开窍赛季');
});

check('赛季不足 2 季时不渲染轨迹', () => {
  const state = makeState();
  state.career.seasons = state.career.seasons.slice(0, 1);
  assert.equal(runTrend(state).renderCareerTrendSection(), '');
});

check('轨迹里同时包含走势条、招牌方向与开窍赛季', () => {
  const out = runTrend(makeState()).renderCareerTrendSection();
  assert.ok(out.indexOf('生涯轨迹') >= 0);
  assert.equal((out.match(/class="trend-track/g) || []).length, 3, '应有得分/篮板/助攻三行');
  assert.equal((out.match(/class="trend-bar/g) || []).length, 9, '每季一根柱子');
  assert.ok(out.indexOf('生涯招牌') >= 0);
  assert.ok(out.indexOf('三分 79') >= 0, '招牌应取最高的几项属性');
  assert.ok(out.indexOf('开窍赛季') >= 0);
  assert.ok(out.indexOf('三分+8') >= 0);
  assert.ok(out.indexOf('▲5') >= 0, '应标出得分上涨 5 分');
  assert.ok(out.indexOf('<script') < 0, '不应注入脚本');
});

check('走势最高的一季会被高亮成峰值', () => {
  const out = runTrend(makeState()).renderCareerTrendSection();
  assert.equal((out.match(/trend-bar is-peak/g) || []).length, 3, '三行各有一个峰值');
});

console.log('\n全部通过：' + passed + ' 项');
