'use strict';

/**
 * 休赛期训练点数规则测试
 * 直接从 nba-perfect-player.html 抽出 calcTrainingPointItems 的源码，
 * 用伪造的 STATE 跑各种赛季场景，验证计分与边界。
 * 运行：node tests/training-points.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'nba-perfect-player.html'), 'utf8');

/** 按大括号配对抽出一个函数的完整源码（函数内没有含花括号的字符串） */
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

const source = extractFunction(html, 'calcTrainingPointItems');
const scaleMatch = html.match(/var TRAINING_POINT_SCALE\s*=\s*([0-9.]+)\s*;/);
if (!scaleMatch) throw new Error('找不到 TRAINING_POINT_SCALE');
const scale = Number(scaleMatch[1]);
const buildItems = new Function('STATE', 'TRAINING_POINT_SCALE', 'getConferenceSeed', source + '\nreturn calcTrainingPointItems();');

// 总点数（当季 + 往年结余）需要连带抽出结转相关的函数
const totalSource = [
  source,
  extractFunction(html, 'calcTrainingPoints'),
  extractFunction(html, 'getBankedTrainingPoints'),
  extractFunction(html, 'getTotalTrainingPoints'),
].join('\n');
const buildTotal = new Function('STATE', 'TRAINING_POINT_SCALE', totalSource + '\nreturn getTotalTrainingPoints();');

function totalPointsFor(state) {
  return buildTotal(state, scale);
}

function itemsFor(season, careerTeam, seedFn) {
  return buildItems({ season, careerTeam }, scale, seedFn);
}
function totalOf(items) {
  return items.reduce((sum, item) => sum + item.points, 0);
}
function idsOf(items) {
  return items.map((item) => item.id);
}
function findItem(items, id) {
  return items.find((item) => item.id === id) || null;
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('训练点数规则测试');

check('没有任何成绩时保底 1 点', () => {
  const items = itemsFor({ awards: [], playerStats: { games: 0 } }, 'LAL');
  assert.equal(totalOf(items), 1);
  assert.deepEqual(idsOf(items), ['baseline']);
});

check('全明星级夺冠赛季按明细累加为 35 点', () => {
  const games = [];
  for (let i = 0; i < 75; i++) games.push({ stats: { pts: 30, reb: 10, ast: 5, stl: 1, blk: 1, mins: 34 } });
  const season = {
    wins: 60,
    games,
    awards: ['全明星', 'MVP', '最佳阵容', 'DPOY', '🏆 总冠军', '👑 总决赛MVP'],
    playerStats: {
      games: 75, mins: 2550,
      pts: 2250, reb: 750, ast: 375, stl: 75, blk: 75,
      fgm: 750, fga: 1500, threeM: 225, threeA: 600,
    },
    playoffStats: { games: 20, pts: 600 },
    playoffBracket: { results: [{ isMySeries: true, round: 3, teamA: 'LAL', aWon: true, seriesGames: [] }] },
  };
  const items = itemsFor(season, 'LAL');
  assert.equal(totalOf(items), 35, '明细: ' + JSON.stringify(items));
  assert.equal(findItem(items, 'scoring').points, 3);
  assert.equal(findItem(items, 'doubleDouble').points, 3);
  assert.equal(findItem(items, 'playoff').points, 6);
  assert.equal(findItem(items, 'teamWins').points, 2, '60 胜属于 58+ 档');
  assert.equal(findItem(items, 'playoffScoring').points, 3, '季后赛场均 30 分属于最高档');
  assert.equal(findItem(items, 'mvp').points, 1);
  assert.equal(findItem(items, 'fmvp').points, 1);
  assert.equal(findItem(items, 'avgDoubleDouble').points, 1);
  assert.equal(findItem(items, 'avgTripleDouble'), null);
  assert.equal(findItem(items, 'three'), null, '三分 37.5% 不该给分');
});

check('同一项数据只取最高档，不重复叠加', () => {
  const season = {
    awards: [],
    playerStats: { games: 10, mins: 0, pts: 400, reb: 0, ast: 0, stl: 0, blk: 0 },
    games: [],
  };
  const items = itemsFor(season, 'LAL');
  const scoring = items.filter((item) => item.id === 'scoring');
  assert.equal(scoring.length, 1);
  assert.equal(scoring[0].points, 4, '场均 40 分应只拿最高档 4 点');
});

check('回归：年度最佳新秀标签能拿到点数（旧版精确匹配会漏）', () => {
  const items = itemsFor({ awards: ['年度最佳新秀'], playerStats: { games: 1 } }, 'LAL');
  assert.ok(findItem(items, 'roty'), '应识别 roty');
  assert.equal(findItem(items, 'roty').points, 1);
  assert.equal(totalOf(items), 1);
});

check('回归：总决赛 MVP 不计成常规赛 MVP', () => {
  const items = itemsFor({ awards: ['👑 总决赛MVP'], playerStats: { games: 1 } }, 'LAL');
  assert.ok(findItem(items, 'fmvp'), '应识别 fmvp');
  assert.equal(findItem(items, 'mvp'), null, '不应误判为 MVP');
  assert.equal(totalOf(items), 1);
});

check('最佳防守阵容不会误判成最佳阵容', () => {
  const items = itemsFor({ awards: ['最佳防守阵容'], playerStats: { games: 1 } }, 'LAL');
  assert.ok(findItem(items, 'allDefense'));
  assert.equal(findItem(items, 'allNBA'), null);
});

check('两双阈值与季后赛场次都计入统计', () => {
  const games = [];
  for (let i = 0; i < 9; i++) games.push({ stats: { pts: 12, reb: 11, ast: 0, stl: 0, blk: 0 } });
  const season = {
    awards: [],
    playerStats: { games: 9 },
    games,
    // 季后赛再加 1 次两双，正好跨过 10 次门槛
    playoffBracket: { results: [{ isMySeries: true, round: 0, teamA: 'LAL', aWon: true, seriesGames: [{ myStats: { pts: 12, reb: 11 } }] }] },
  };
  const items = itemsFor(season, 'LAL');
  assert.equal(findItem(items, 'doubleDouble').points, 1, '常规赛 9 次 + 季后赛 1 次 = 10 次');
  assert.equal(findItem(items, 'playoff').points, 2);
  assert.equal(totalOf(items), 3);
});

check('四双与 5x5 是独立奖励', () => {
  const games = [
    { stats: { pts: 12, reb: 11, ast: 10, stl: 0, blk: 10 } },
    { stats: { pts: 6, reb: 6, ast: 6, stl: 6, blk: 6 } },
  ];
  const items = itemsFor({ awards: [], playerStats: { games: 2 }, games }, 'LAL');
  assert.equal(findItem(items, 'quadDouble').points, 3);
  assert.equal(findItem(items, 'fiveByFive').points, 3);
  assert.equal(findItem(items, 'tripleDouble'), null, '四双不应再算三双');
});

check('被停赛的场次（stats 为 null）不会报错也不会计数', () => {
  const games = [{ stats: null }, { stats: { pts: 12, reb: 11 } }];
  const items = itemsFor({ awards: [], playerStats: { games: 1 }, games }, 'LAL');
  assert.equal(findItem(items, 'doubleDouble'), null, '1 次两双不到 10 次门槛');
  assert.equal(totalOf(items), 1, '只有保底');
});

check('未花完的点数会结转到下一季', () => {
  const withBank = totalPointsFor({ career: { bankedTrainingPoints: 40 }, season: { awards: [], playerStats: { games: 0 } } });
  assert.equal(withBank, 41, '往年结余 40 + 当季保底 1');
});

check('旧存档没有结余字段时不会报错（默认 0）', () => {
  const legacy = totalPointsFor({ career: {}, season: { awards: [], playerStats: { games: 0 } } });
  assert.equal(legacy, 1);
});

check('负数或脏数据的结余会被归零', () => {
  const dirty = totalPointsFor({ career: { bankedTrainingPoints: -5 }, season: { awards: [], playerStats: { games: 0 } } });
  assert.equal(dirty, 1);
});

check('球队战绩 / 分区第一 / 联盟第一分别计分', () => {
  const standings = {
    LAL: { wins: 66, losses: 16 },
    BOS: { wins: 58, losses: 24 },
    NYK: { wins: 40, losses: 42 },
  };
  const items = itemsFor({ awards: [], playerStats: { games: 1 }, wins: 66, standings }, 'LAL', () => 1);
  assert.equal(findItem(items, 'teamWins').points, 3, '65+ 胜');
  assert.equal(findItem(items, 'leagueTop').points, 3, '联盟最佳战绩');
  assert.equal(findItem(items, 'confTop').points, 2, '分区第一');
  assert.equal(totalOf(items), 8);

  // 同战绩但不是第一种子时不发分区第一
  const notFirst = itemsFor({ awards: [], playerStats: { games: 1 }, wins: 40, standings }, 'LAL', () => 5);
  assert.equal(findItem(notFirst, 'confTop'), null);
});

check('季后赛球队与个人表现分层计分', () => {
  const season = {
    awards: [],
    playerStats: { games: 1 },
    playoffStats: { games: 10, pts: 310 },
    playoffBracket: { results: [
      { isMySeries: true, round: 0, teamA: 'LAL', aWon: true, winnerWins: 4, loserWins: 0, seriesGames: [{ myStats: { pts: 42, reb: 5, ast: 4 } }] },
      { isMySeries: true, round: 1, teamA: 'LAL', aWon: true, winnerWins: 4, loserWins: 3, seriesGames: [{ myStats: { pts: 51, reb: 5, ast: 4 } }] },
      { isMySeries: true, round: 3, teamA: 'LAL', aWon: true, winnerWins: 4, loserWins: 1, seriesGames: [
        { myStats: { pts: 30, reb: 5, ast: 4 } },
        { myStats: { pts: 32, reb: 5, ast: 4 } },
        { myStats: { pts: 28, reb: 5, ast: 4 } },
        { myStats: { pts: 30, reb: 5, ast: 4 } },
        { myStats: { pts: 31, reb: 5, ast: 4 } },
      ] },
    ] },
  };
  const items = itemsFor(season, 'LAL');
  assert.equal(findItem(items, 'playoff').points, 6, '夺冠');
  assert.equal(findItem(items, 'playoffSweep').points, 1, '首轮 4-0 横扫');
  assert.equal(findItem(items, 'playoffGame7').points, 1, '半决赛抢七胜出');
  assert.equal(findItem(items, 'playoffBigGame').points, 2, '有单场 50+');
  assert.equal(findItem(items, 'playoffScoring').points, 3, '季后赛场均 31.0');
  assert.equal(findItem(items, 'finalsScoring').points, 2, '总决赛场均 30.2');
  assert.equal(totalOf(items), 15);
});

check('缺 myStats 的季后赛（自动模拟）不会报错', () => {
  const season = {
    awards: [],
    playerStats: { games: 1 },
    playoffStats: { games: 4, pts: 80 },
    playoffBracket: { results: [
      { isMySeries: true, round: 0, teamA: 'LAL', aWon: false, winnerWins: 4, loserWins: 1, seriesGames: [{ myScore: 99, oppScore: 100 }] },
    ] },
  };
  const items = itemsFor(season, 'LAL');
  assert.equal(findItem(items, 'playoff').points, 2, '首轮出局');
  assert.equal(findItem(items, 'playoffBigGame'), null);
  assert.equal(findItem(items, 'finalsScoring'), null);
  assert.equal(findItem(items, 'playoffSweep'), null, '输球不算横扫');
  assert.equal(findItem(items, 'playoffScoring').points, 1, '季后赛场均 20 分是最低档');
  assert.equal(totalOf(items), 3);
});

console.log('\n全部通过：' + passed + ' 项');
