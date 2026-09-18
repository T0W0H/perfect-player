'use strict';

/**
 * 上场时间模型 + 软属性溢出测试
 *   1) 上场时间不设 42 分钟这类内部门槛，唯一硬边界是一场比赛只有 48 分钟，
 *      并跟着「比赛激烈程度 / 比赛重要性 / 身体情况」浮动；
 *   2) 手动加点封顶 99；99 以上只由后端按趋势 / 状态 / 环境自动生长。
 * 运行：node tests/minutes-overflow.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'nba-perfect-player.html'), 'utf8');

function matchEnd(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('括号不配对');
}

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到函数: ' + name);
  const open = source.indexOf('{', start);
  return source.slice(start, matchEnd(source, open));
}

function extractVarObject(source, name) {
  const start = source.indexOf('var ' + name + ' = {');
  if (start < 0) throw new Error('找不到对象: ' + name);
  const open = source.indexOf('{', start);
  return source.slice(start, open) + source.slice(open, matchEnd(source, open)) + ';';
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

// ── 上场时间 ──
const minutesSource = [
  extractVarObject(html, 'MINUTES_MODEL'),
  extractFunction(html, 'getStandingsRank'),
  extractFunction(html, 'isRegularSeasonCrunch'),
  extractFunction(html, 'getMinutesSituationalDelta'),
  extractFunction(html, 'getPlayerRotationMinutes'),
  'return { MINUTES_MODEL:MINUTES_MODEL, getStandingsRank:getStandingsRank, isRegularSeasonCrunch:isRegularSeasonCrunch, getMinutesSituationalDelta:getMinutesSituationalDelta, getPlayerRotationMinutes:getPlayerRotationMinutes };',
].join('\n');

const ATTRS = ['threePT','MID','FIN','DNK','HAN','PAS','PDEF','IDEF','BLK','REB','ATH','STR','CLU'];
const calcOVR = (attrs) => Math.round(ATTRS.reduce((sum, key) => sum + (Number(attrs[key]) || 50), 0) / ATTRS.length);

function makeMinutesApi(state, options) {
  const opts = options || {};
  const gaussian = opts.gaussian || ((mean) => mean);
  const lineup = opts.lineup === undefined ? starLineup : opts.lineup;
  return new Function(
    'STATE', 'calcOVR', 'calcTeamLineup', 'getSeasonUsageBias', 'simGaussian', 'getNextSeasonMods',
    minutesSource
  )(
    state,
    calcOVR,
    () => lineup,
    () => 1,
    gaussian,
    () => ({ staminaLoad: opts.staminaLoad || 0 })
  );
}

function starState(overrides) {
  return Object.assign({
    position: 'PG',
    careerTeam: 'LAL',
    career: { currentAge: 27, flags: {} },
    season: { games: [], playerStats: { games: 40, mins: 40 * 36 }, standings: {} },
  }, overrides || {});
}

const starLineup = {
  isUserStarter: true,
  allPlayers: [{ _isUser: true, ovr: 95 }, { ovr: 80 }, { ovr: 78 }, { ovr: 76 }, { ovr: 74 }],
};
const starAttrs = {};
ATTRS.forEach((key) => { starAttrs[key] = 95; });

console.log('上场时间测试');

check('常规比赛：主力按角色时间出场，不再有 42 分钟的内部天花板', () => {
  const api = makeMinutesApi(starState());
  const mins = api.getPlayerRotationMinutes(starAttrs, 'PG', false, { margin: 10 });
  assert.equal(mins, api.MINUTES_MODEL.rankTargets[0]);
  assert.ok(mins > 36, '头号主力的基础时间应该高于旧的 36：' + mins);
});

check('48 分钟是唯一硬边界：所有加成叠满也不会越界', () => {
  const state = starState();
  const api = makeMinutesApi(state, { gaussian: (mean, dev) => mean + dev * 6 });
  const mins = api.getPlayerRotationMinutes(starAttrs, 'PG', true, { round: 3, seriesWins: 3, seriesLosses: 3, margin: 1 });
  assert.equal(mins, api.MINUTES_MODEL.max, '应该正好顶到 48');
  assert.ok(mins <= 48, '绝不能超过一场比赛的 48 分钟');
});

check('季后赛轮次越深，出场时间越多', () => {
  const api = makeMinutesApi(starState());
  const regular = api.getPlayerRotationMinutes(starAttrs, 'PG', false, { margin: 10 });
  const firstRound = api.getPlayerRotationMinutes(starAttrs, 'PG', true, { round: 0, margin: 10 });
  const finals = api.getPlayerRotationMinutes(starAttrs, 'PG', true, { round: 3, margin: 10 });
  assert.ok(firstRound > regular, '季后赛首轮应高于常规赛');
  assert.ok(finals > firstRound, '总决赛应高于首轮：' + finals + ' vs ' + firstRound);
});

check('生死局与抢七再加码', () => {
  const api = makeMinutesApi(starState());
  const normal = api.getPlayerRotationMinutes(starAttrs, 'PG', true, { round: 2, seriesWins: 1, seriesLosses: 1, margin: 10 });
  const elimination = api.getPlayerRotationMinutes(starAttrs, 'PG', true, { round: 2, seriesWins: 1, seriesLosses: 3, margin: 10 });
  const gameSeven = api.getPlayerRotationMinutes(starAttrs, 'PG', true, { round: 2, seriesWins: 3, seriesLosses: 3, margin: 10 });
  assert.ok(elimination > normal, '濒临淘汰要多打');
  assert.ok(gameSeven > normal, '抢七要多打');
});

check('比赛激烈程度：胶着多打，打花提前下班', () => {
  const api = makeMinutesApi(starState());
  const clutch = api.getPlayerRotationMinutes(starAttrs, 'PG', false, { margin: 2 });
  const normal = api.getPlayerRotationMinutes(starAttrs, 'PG', false, { margin: 12 });
  const blowout = api.getPlayerRotationMinutes(starAttrs, 'PG', false, { margin: 26 });
  assert.ok(clutch > normal && normal > blowout, [clutch, normal, blowout].join(' / '));
});

check('身体情况：带伤打球时间下降，体能透支也会限速', () => {
  const healthy = makeMinutesApi(starState());
  const base = healthy.getPlayerRotationMinutes(starAttrs, 'PG', false, { margin: 10 });

  const injuredState = starState();
  injuredState.season.events = { injuryGamesLeft: 3 };
  const injured = makeMinutesApi(injuredState).getPlayerRotationMinutes(starAttrs, 'PG', false, { margin: 10 });
  assert.ok(injured < base, '带伤打球应该减少时间：' + injured + ' vs ' + base);

  const heavy = makeMinutesApi(starState(), { staminaLoad: -3 }).getPlayerRotationMinutes(starAttrs, 'PG', false, { margin: 10 });
  assert.ok(heavy < base, '体能负荷过高应该减少时间：' + heavy + ' vs ' + base);
});

check('常规赛收官卡位战也加时间，没进卡位圈就不加', () => {
  const standings = {};
  for (let i = 1; i <= 20; i++) standings['T' + i] = { wins: 60 - i, losses: i };
  standings.LAL = { wins: 60, losses: 1 };
  const state = starState();
  state.season.standings = standings;
  state.season.games = new Array(70).fill({});
  const api = makeMinutesApi(state);
  assert.equal(api.getStandingsRank('LAL'), 1);
  assert.equal(api.isRegularSeasonCrunch(), true);
  const crunch = api.getPlayerRotationMinutes(starAttrs, 'PG', false, { margin: 10 });
  state.season.games = new Array(30).fill({});
  const early = api.getPlayerRotationMinutes(starAttrs, 'PG', false, { margin: 10 });
  assert.ok(crunch > early, '收官卡位战应该多打：' + crunch + ' vs ' + early);
});

check('替补与球队缺席时不报错', () => {
  const api = makeMinutesApi(starState({ careerTeam: null }));
  const mins = api.getPlayerRotationMinutes(starAttrs, 'PG', false, { margin: 10 });
  assert.ok(mins >= 6 && mins <= 48, String(mins));
});

// ── 软属性溢出 ──
const overflowSource = [
  extractVarObject(html, 'SOFT_ATTR_OVERFLOW'),
  extractFunction(html, 'getSoftOverflowFocusWeights'),
  extractFunction(html, 'getLastCompletedSeasonRecord'),
  extractFunction(html, 'getSoftOverflowHonorSignal'),
  extractFunction(html, 'getSoftOverflowTeamSignal'),
  extractFunction(html, 'applySoftAttributeOverflow'),
  'return { SOFT_ATTR_OVERFLOW:SOFT_ATTR_OVERFLOW, getSoftOverflowHonorSignal:getSoftOverflowHonorSignal, getSoftOverflowTeamSignal:getSoftOverflowTeamSignal, applySoftAttributeOverflow:applySoftAttributeOverflow };',
].join('\n');

const ATTR_CN = { threePT:'三分', MID:'中投', FIN:'终结', DNK:'扣篮', HAN:'护球', PAS:'传球', PDEF:'外防', IDEF:'内防', BLK:'盖帽', REB:'篮板', ATH:'运动', STR:'力量', CLU:'关键' };

function makeOverflowApi(state, randomValue) {
  const math = Object.create(Math);
  math.random = () => randomValue;
  return new Function('Math', 'STATE', 'ATTR_KEYS', 'addAttrDelta', 'attrCN', overflowSource)(
    math,
    state,
    ATTRS,
    (key, delta) => { state.attrs[key] = Math.max(25, Math.min(120, (Number(state.attrs[key]) || 50) + delta)); },
    (key) => ATTR_CN[key] || key
  );
}

function overflowState(overrides) {
  const attrs = {};
  ATTRS.forEach((key) => { attrs[key] = 99; });
  return Object.assign({
    attrs: attrs,
    career: {
      currentAge: 27,
      trainingHistory: [{ seasonNum: 5, gains: { threePT: 4, REB: 2 } }, { seasonNum: 6, gains: { threePT: 3 } }],
      seasons: [{ seasonNum: 6, wins: 58, playoffResult: '分区决赛·总冠军', awards: [{ label: '👑 MVP' }] }],
    },
  }, overrides || {});
}

console.log('\n软属性溢出测试');

check('没有练满 99 的属性不会溢出', () => {
  const state = overflowState();
  state.attrs.threePT = 90;
  const api = makeOverflowApi(state, 0);
  const added = api.applySoftAttributeOverflow();
  assert.ok(added.indexOf('threePT') < 0, '只有练满的手动项才可能溢出');
  assert.equal(state.attrs.threePT, 90);
});

check('一季最多只涨 SOFT_ATTR_OVERFLOW.maxPerSeason 点', () => {
  const state = overflowState();
  const api = makeOverflowApi(state, 0);
  const added = api.applySoftAttributeOverflow();
  assert.equal(added.length, api.SOFT_ATTR_OVERFLOW.maxPerSeason);
  assert.equal(state.attrs.threePT, 100);
});

check('概率没中就不涨（不会变成每季必涨的刷分目标）', () => {
  const state = overflowState();
  const api = makeOverflowApi(state, 0.99);
  assert.deepEqual(api.applySoftAttributeOverflow(), []);
  assert.equal(state.attrs.threePT, 99);
});

check('趋势优先：最近一直练的方向优先溢出', () => {
  const state = overflowState();
  const api = makeOverflowApi(state, 0);
  const added = api.applySoftAttributeOverflow();
  assert.equal(added[0], 'threePT', '最近两季加点最多的方向应排第一：' + added.join(','));
});

check('状态与环境信号：荣誉与球队走得远都会抬高概率', () => {
  const rich = overflowState();
  const poor = overflowState({ career: { currentAge: 27, trainingHistory: [], seasons: [{ seasonNum: 6, wins: 30, playoffResult: '未晋级', awards: [] }] } });
  const richApi = makeOverflowApi(rich, 0.5);
  const poorApi = makeOverflowApi(poor, 0.5);
  const richAdded = richApi.applySoftAttributeOverflow().length;
  const poorAdded = poorApi.applySoftAttributeOverflow().length;
  assert.ok(richAdded > poorAdded, '荣誉 + 深轮次应该更容易溢出：' + richAdded + ' vs ' + poorAdded);
  assert.equal(poorApi.getSoftOverflowHonorSignal(), 0);
  assert.equal(poorApi.getSoftOverflowTeamSignal(), 0);
});

check('年龄门：太年轻或太老都不会溢出', () => {
  const young = overflowState();
  young.career.currentAge = 18;
  const old = overflowState();
  old.career.currentAge = 40;
  assert.deepEqual(makeOverflowApi(young, 0).applySoftAttributeOverflow(), []);
  assert.deepEqual(makeOverflowApi(old, 0).applySoftAttributeOverflow(), []);
});

check('旧存档（没有加点记录 / 赛季记录）不报错，也不会因此变强', () => {
  const state = overflowState({ career: { currentAge: 27 } });
  const api = makeOverflowApi(state, 0);
  const changes = [];
  const added = api.applySoftAttributeOverflow(changes);
  assert.ok(Array.isArray(added));
  assert.ok(added.length <= api.SOFT_ATTR_OVERFLOW.maxPerSeason, '仍然受每季上限约束');
  assert.equal(api.getSoftOverflowHonorSignal(), 0);
  assert.equal(api.getSoftOverflowTeamSignal(), 0);
});

check('溢出会写进年度变化文案，但只写成突破，不写成进度', () => {
  const state = overflowState();
  const api = makeOverflowApi(state, 0);
  const changes = [];
  api.applySoftAttributeOverflow(changes);
  assert.ok(changes.length, '应该有文案');
  changes.forEach((line) => {
    assert.ok(line.indexOf('突破 99') >= 0, line);
    assert.ok(line.indexOf('/120') < 0 && line.indexOf('还差') < 0, '不应该出现任何进度感：' + line);
  });
});

console.log('\n全部通过：' + passed + ' 项');
