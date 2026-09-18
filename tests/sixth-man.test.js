'use strict';

/**
 * 第六人（最佳第六人评选）路径测试
 * 之前 flags.startBench 是死代码：只被读取和删除，没有任何入口能设置它，
 * 于是玩家一旦打上首发就永远失去最佳第六人的评选资格。
 * 现在：阵容预览页可以切换「本赛季定位」，calcTeamLineup 也真的会把你放去替补。
 * 运行：node tests/sixth-man.test.js
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

const lineupSource = [
  extractFunction(html, 'getPlayerPositions'),
  extractFunction(html, 'canPlayPosition'),
  extractFunction(html, 'calcTeamLineup'),
  'return { calcTeamLineup:calcTeamLineup };',
].join('\n');

function makeTeam(ovrs) {
  const POS = ['PG', 'SG', 'SF', 'PF', 'C'];
  return POS.map((pos, i) => ({ name: 'NPC' + i, cname: '队友' + i, pos, ovr: ovrs[i] }));
}

function makeApi(opts) {
  const options = opts || {};
  const data = { TST: makeTeam(options.teamOvrs || [80, 79, 78, 77, 76]) };
  const STATE = {
    careerTeam: 'TST',
    position: options.position || 'PG',
    finalOVR: options.userOvr == null ? 95 : options.userOvr,
    attrs: { threePT: 90, PAS: 90 },
    career: { currentAge: 26, flags: options.bench ? { startBench: true } : {} },
    season: { isPlayoffs: false },
  };
  const api = new Function('STATE', 'NBA2K_DATA', 'getCareerProfileEffects', 'getHupuDisplayName', lineupSource)(
    STATE, data, () => ({ lineupBonus: 0 }), () => '我的球员'
  );
  return { api, STATE };
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('第六人路径测试');

check('默认就是首发，行为和以前一致', () => {
  const { api } = makeApi({});
  const lineup = api.calcTeamLineup('TST');
  assert.equal(lineup.isUserStarter, true, '95 总评打 80 的队应该首发');
  assert.ok(Object.values(lineup.starters).some((p) => p && p._isUser));
});

check('选了第六人之后，你不再进首发，而是带替补', () => {
  const { api } = makeApi({ bench: true });
  const lineup = api.calcTeamLineup('TST');
  assert.equal(lineup.isUserStarter, false);
  assert.ok(!Object.values(lineup.starters).some((p) => p && p._isUser), '首发里不该有你');
  assert.equal(lineup.bench[0]._isUser, true, '应该正好是第六人（替补第一个）');
});

check('切换定位后即使缓存还在，结果也会跟着变（缓存键带定位）', () => {
  const { api, STATE } = makeApi({});
  assert.equal(api.calcTeamLineup('TST').isUserStarter, true);
  STATE.career.flags.startBench = true; // 不手动清缓存
  assert.equal(api.calcTeamLineup('TST').isUserStarter, false, '缓存不该把旧的首发结果顶回来');
});

check('首发位置有人补上：不会因为你去替补而空一个位置', () => {
  const { api } = makeApi({ bench: true });
  const lineup = api.calcTeamLineup('TST');
  ['PG', 'SG', 'SF', 'PF', 'C'].forEach((pos) => {
    assert.ok(lineup.starters[pos], pos + ' 位置不该空着');
  });
  assert.equal(Object.keys(lineup.starters).length, 5);
});

check('最低总评时也不受影响（本来就打不上首发）', () => {
  const { api } = makeApi({ userOvr: 68 });
  const lineup = api.calcTeamLineup('TST');
  assert.equal(lineup.isUserStarter, false);
  assert.equal(lineup.bench[0]._isUser, true);
});

console.log('\n第六人的获奖条件');

check('评选要求：非首发 + 场均 18 分（连庄两次后升到 22）', () => {
  const start = html.indexOf('var sixthThreshold');
  assert.ok(start > 0, '找不到第六人阈值');
  const line = html.slice(start, html.indexOf('\n', start));
  assert.ok(line.indexOf('>= 2') >= 0 && line.indexOf('22') >= 0 && line.indexOf('18') >= 0, line);
  assert.ok(html.indexOf('var sixthWin = userIsBench && avg.pts >= sixthThreshold;') > 0);
});

check('评选前会重新同步首发状态，不会用过期的状态判奖', () => {
  const idx = html.indexOf('var userIsBench = !STATE.season.isUserStarter;');
  assert.ok(idx > 0);
  const before = html.slice(idx - 200, idx);
  assert.ok(before.indexOf('syncUserStarterStatus()') >= 0, '评奖前应先同步');
});

check('阵容预览页提供了本赛季定位切换', () => {
  assert.ok(html.indexOf('function setSeasonRole(') > 0);
  assert.ok(html.indexOf('🎯 本赛季定位') > 0);
  assert.ok(html.indexOf("setSeasonRole(\\'bench\\')") >= 0, '应有第六人按钮');
  assert.ok(html.indexOf("setSeasonRole(\\'starter\\')") >= 0, '应有首发按钮');
});

check('每季重置回首发，需要重新选择（一次点击，不会被动锁死）', () => {
  const idx = html.indexOf('function resetForNewSeason()');
  const body = html.slice(idx, matchEnd(html, html.indexOf('{', idx)));
  assert.ok(body.indexOf('delete STATE.career.flags.startBench') >= 0, '新赛季应回到默认首发');
});

console.log('\n第六人的比赛表现');

const simSource = [
  extractVarObject(html, 'MINUTES_MODEL'),
  extractVarObject(html, 'SIXTH_MAN_MINUTES'),
  extractFunction(html, 'getStandingsRank'),
  extractFunction(html, 'isRegularSeasonCrunch'),
  extractFunction(html, 'getMinutesSituationalDelta'),
  extractFunction(html, 'getPlayerRotationMinutes'),
  extractFunction(html, 'getBenchMatchupEase'),
  extractFunction(html, 'computeGamePlusMinus'),
  extractFunction(html, 'getSixthManGameNote'),
  'return { MINUTES_MODEL:MINUTES_MODEL, SIXTH_MAN_MINUTES:SIXTH_MAN_MINUTES, getMinutesSituationalDelta:getMinutesSituationalDelta, getPlayerRotationMinutes:getPlayerRotationMinutes, getBenchMatchupEase:getBenchMatchupEase, computeGamePlusMinus:computeGamePlusMinus, getSixthManGameNote:getSixthManGameNote };',
].join('\n');

function matchEndOf(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('括号不配对');
}

function extractVarObject(source, name) {
  const start = source.indexOf('var ' + name + ' = {');
  if (start < 0) throw new Error('找不到对象: ' + name);
  const open = source.indexOf('{', start);
  return source.slice(start, open) + source.slice(open, matchEndOf(source, open)) + ';';
}

function makeSimApi(opts) {
  const options = opts || {};
  const STATE = {
    position: 'SG', finalOVR: 92, careerTeam: 'TST',
    career: { currentAge: 26, flags: options.bench ? { startBench: true } : {} },
    season: { games: [], playerStats: { games: 40, mins: 40 * 26 }, standings: {}, events: {} },
  };
  const lineup = {
    isUserStarter: !options.bench,
    allPlayers: [{ _isUser: true, ovr: 92 }, { ovr: 80 }, { ovr: 78 }, { ovr: 76 }, { ovr: 74 }],
  };
  const attrs = {};
  ['threePT','MID','FIN','DNK','HAN','PAS','PDEF','IDEF','BLK','REB','ATH','STR','CLU'].forEach((k) => { attrs[k] = 92; });
  const api = new Function('STATE', 'calcOVR', 'calcTeamLineup', 'getSeasonUsageBias', 'simGaussian', 'getNextSeasonMods', simSource)(
    STATE,
    () => 92,
    () => lineup,
    () => 1,
    (mean, dev) => (options.seedRandom ? mean + dev * (Math.random() * 2 - 1) * 1.6 : mean),
    () => ({ staminaLoad: 0 })
  );
  return { api, STATE };
}

check('第六人的出场时间浮动明显更大', () => {
  const starter = makeSimApi({ seedRandom: true }).api;
  const sixth = makeSimApi({ bench: true, seedRandom: true }).api;
  assert.ok(sixth.SIXTH_MAN_MINUTES.sigma > starter.MINUTES_MODEL.sigma * 2, '第六人的单场浮动应该明显更大');

  const sample = (api) => {
    const values = [];
    for (let i = 0; i < 400; i++) values.push(api.getPlayerRotationMinutes({}, 'SG', false, { margin: 12 }));
    return values;
  };
  const benchMins = sample(sixth);
  const starterMins = sample(starter);
  const range = (list) => Math.max.apply(null, list) - Math.min.apply(null, list);
  assert.ok(range(benchMins) >= 6, '第六人的时间跨度应该比首发大：' + range(benchMins));
  assert.ok(range(benchMins) > range(starterMins), '应该大于首发：' + range(benchMins) + ' vs ' + range(starterMins));
  assert.ok(Math.max.apply(null, benchMins) <= 48, '仍然不能超过 48 分钟');
});

check('关键战（总决赛 / 生死局）可以打到 40 分钟以上', () => {
  const api = makeSimApi({ bench: true, seedRandom: true }).api;
  let maxMins = 0;
  for (let i = 0; i < 600; i++) {
    const m = api.getPlayerRotationMinutes({}, 'SG', true, { round: 3, seriesWins: 3, seriesLosses: 3, margin: 2 });
    maxMins = Math.max(maxMins, m);
  }
  assert.ok(maxMins >= 40, '第六人应该有机会打到 40 分钟以上：' + maxMins);
  assert.ok(maxMins <= 48, '但不会超过 48：' + maxMins);
});

check('打花时第六人反而有垃圾时间（与首发相反）', () => {
  const api = makeSimApi({ bench: true }).api;
  const blowout = api.getMinutesSituationalDelta(false, { margin: 26 }, true);
  const clutch = api.getMinutesSituationalDelta(false, { margin: 2 }, true);
  assert.ok(blowout > 0, '打花对第六人应该是加分：' + blowout);
  assert.ok(clutch > blowout, '胶着时教练更愿意留他收尾：' + clutch + ' vs ' + blowout);
});

check('对位红利用得是「打得越少、对手越弱」', () => {
  const api = makeSimApi({ bench: true }).api;
  assert.equal(api.getBenchMatchupEase(24, false), 0, '首发没有对位红利');
  assert.equal(api.getBenchMatchupEase(api.SIXTH_MAN_MINUTES.easeMinutes, true), 1, '≤18 分钟时对位优势拉满');
  assert.equal(api.getBenchMatchupEase(api.SIXTH_MAN_MINUTES.easeFullMinutes, true), 0, '打到 34 分钟就回到正常难度');
  const mid = api.getBenchMatchupEase(26, true);
  assert.ok(mid > 0 && mid < 1, '中间值应该在 0~1 之间：' + mid);
  assert.ok(api.getBenchMatchupEase(20, true) > api.getBenchMatchupEase(30, true), '时间越短优势越大');
});

check('正负值：赢球 + 高产出就高，替补还有额外红利', () => {
  const api = makeSimApi({ bench: true }).api;
  const goodLine = { pts: 28, reb: 5, ast: 4, stl: 1, blk: 0, tov: 2, mins: 24 };
  const win = { scoreA: 116, scoreB: 104 };
  const loss = { scoreA: 104, scoreB: 116 };
  const good = api.computeGamePlusMinus(goodLine, win, 0.6);
  const bad = api.computeGamePlusMinus({ pts: 4, reb: 1, ast: 1, stl: 0, blk: 0, tov: 3, mins: 22 }, loss, 0.7);
  assert.ok(good > 5, '好的夜晚正负值应该明显为正：' + good);
  assert.ok(bad < 0, '差的夜晚应该是负的：' + bad);
  assert.ok(good > api.computeGamePlusMinus(goodLine, win, 0), '打替补应该比正常对位更好看');
});

check('第六人赛后文案：只在标志性比赛出现', () => {
  const api = makeSimApi({ bench: true }).api;
  assert.equal(api.getSixthManGameNote({ pts: 25, mins: 26, plusMinus: 8 }), '', '普通比赛不该有文案');
  assert.ok(api.getSixthManGameNote({ pts: 32, mins: 27, plusMinus: 12, _sixthMan: true }).indexOf('从替补席上砍下 32 分') >= 0);
  assert.ok(api.getSixthManGameNote({ pts: 14, mins: 20, plusMinus: 23, _sixthMan: true }).indexOf('正负值 +23') > 0);
  assert.ok(api.getSixthManGameNote({ pts: 18, mins: 41, plusMinus: 6, _sixthMan: true }).indexOf('打了 41 分钟') > 0);
  assert.ok(api.getSixthManGameNote({ pts: 22, mins: 25, plusMinus: 17, _sixthMan: true }).indexOf('替补登场 22 分') >= 0);
  assert.equal(api.getSixthManGameNote({ pts: 40, mins: 30, plusMinus: 20 }), '', '不是第六人就不出这套文案');
});

check('本季高光同时收录三双与第六人代表作', () => {
  const src = [
    extractVarObject(html, 'TRIPLE_CHASE_NOTES'),
    extractFunction(html, 'getTripleChaseNote'),
    extractFunction(html, 'getSixthManGameNote'),
    extractFunction(html, 'getSeasonHighlightMoments'),
    'return { getSeasonHighlightMoments:getSeasonHighlightMoments };',
  ].join('\n');
  const STATE = { season: { games: [
    { game: { gameNum: 1, opponent: 'BOS' }, result: { won: true }, stats: { pts: 20, mins: 30, plusMinus: 4 } },
    { game: { gameNum: 2, opponent: 'MIA' }, result: { won: true }, stats: { pts: 33, mins: 27, plusMinus: 11, _sixthMan: true } },
    { game: { gameNum: 3, opponent: 'NYK' }, result: { won: false }, stats: { pts: 21, reb: 11, ast: 10, mins: 34, plusMinus: -3, _tripleChase: 'chase', _tripleChaseLifted: '助攻' } },
  ] } };
  const run = new Function('STATE', src)(STATE);
  const moments = run.getSeasonHighlightMoments(5);
  assert.equal(moments.length, 2, '普通比赛不算高光');
  assert.equal(moments[0].gameNum, 3, '最近一场排最前');
  assert.ok(moments[0].note.indexOf('三双') >= 0);
  assert.ok(moments[1].note.indexOf('替补席') >= 0, moments[1].note);
});

check('第六人赛季小结算：只在以替补身份出战时出现', () => {
  const src = [
    extractFunction(html, 'fmtPlusMinus'),
    extractFunction(html, 'buildSixthManSeasonSummary'),
    'return { buildSixthManSeasonSummary:buildSixthManSeasonSummary };',
  ].join('\n');
  const run = (season) => new Function('STATE', src)({ season: season }).buildSixthManSeasonSummary();

  assert.equal(run({ games: [{ stats: { pts: 20, mins: 30 } }], awards: [] }), '', '没有替补出场的比赛就不结算');

  const out = run({
    games: [
      { stats: { pts: 20, reb: 5, ast: 4, mins: 30, plusMinus: 6 } },
      { stats: { pts: 33, reb: 6, ast: 5, mins: 34, plusMinus: 12, _sixthMan: true } },
      { stats: { pts: 18, reb: 4, ast: 7, mins: 22, plusMinus: 9, _sixthMan: true } },
    ],
    awards: [{ act: 'sixthman', isUser: true }],
  });
  assert.ok(out.indexOf('第六人赛季') >= 0, out);
  assert.ok(out.indexOf('2 / 3 场') >= 0, '只统计替补出战的那两场：' + out);
  assert.ok(out.indexOf('28 分钟') >= 0, '场均时间 (34+22)/2 = 28：' + out);
  assert.ok(out.indexOf('25.5 分') >= 0, '场均得分 (33+18)/2 = 25.5：' + out);
  assert.ok(out.indexOf('+10.5') >= 0, '场均正负值 (12+9)/2 = 10.5：' + out);
  assert.ok(out.indexOf('33 分（34 分钟）') >= 0, '最高光的一场：' + out);
  assert.ok(out.indexOf('本赛季最佳第六人') >= 0, out);
});

console.log('\n全部通过：' + passed + ' 项');
