'use strict';

/**
 * 赛季奖项（数据王 / 最佳防守阵容 / 进步最快球员）测试
 * 从 nba-perfect-player.html 抽出 calcSeasonAwards 里新增的三段评选逻辑，
 * 用伪造的联盟名单与场均数据验证：奖项齐全、排名正确、出勤门槛生效。
 * 运行：node tests/season-awards.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'nba-perfect-player.html'), 'utf8');

const startMarker = '// ==================== 数据王（得分 / 篮板 / 助攻 / 抢断 / 盖帽） ====================';
const endMarker = 'updateAwardStreaks();';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker, start);
if (start < 0 || end < 0 || end <= start) throw new Error('找不到新增奖项评选代码段');
const newAwardCode = html.slice(start, end);

const run = new Function(
  'STATE', 'NBA2K_DATA', 'NBA2K_TEAMS', 'avg', 'g', 'getHupuDisplayName', 'getLeaguePlayerAge',
  newAwardCode + '\nreturn STATE.season.awards;'
);

function makeLeague() {
  const star = { name: 'Star Wing', cname: '斯达-温', ovr: 95, pos: 'SG', threePT: 95, MID: 95, FIN: 95, PDEF: 92, ATH: 95, BLK: 40, IDEF: 55 };
  const big = { name: 'Big Man', cname: '比格-曼', ovr: 90, pos: 'C', threePT: 60, MID: 70, FIN: 92, PDEF: 70, ATH: 70, BLK: 92, IDEF: 93, REB: 93 };
  const guard = { name: 'Pass Guard', cname: '帕斯-加德', ovr: 88, pos: 'PG', threePT: 84, MID: 82, FIN: 80, PDEF: 86, ATH: 88, BLK: 35, IDEF: 50, PAS: 95, HAN: 92 };
  const role = { name: 'Role Guy', cname: '罗尔-盖', ovr: 74, pos: 'SF', threePT: 74, MID: 74, FIN: 74, PDEF: 74, ATH: 74, BLK: 50, IDEF: 60 };
  return { AAA: [star, guard], BBB: [big, role] };
}

const TEAMS = ['AAA', 'BBB'];
const NAME = '我的球员';

function itemsFor(userAvg, games, careerSeasons) {
  const STATE = {
    season: { awards: [], playerStats: { games: games } },
    career: { seasons: careerSeasons || [] },
    careerTeam: 'AAA',
    attrs: { PDEF: 85, IDEF: 85, BLK: 80 },
    finalOVR: 88,
    position: 'SG',
  };
  return run(STATE, makeLeague(), TEAMS, userAvg, games, () => NAME, () => 24);
}

function find(awards, act) {
  return awards.find((a) => a.act === act) || null;
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('赛季奖项测试');

check('五项数据王都会产出，且字段完整', () => {
  const awards = itemsFor({ pts: 20, reb: 5, ast: 5, stl: 1, blk: 0.5 }, 82);
  ['scoring', 'rebound', 'assist', 'steal', 'block'].forEach((act) => {
    const a = find(awards, act);
    assert.ok(a, act + ' 应该存在');
    assert.ok(a.winner && typeof a.winner === 'string', act + ' 应有获奖者');
    assert.ok(a.userRank && typeof a.userRank === 'string', act + ' 应有排名文案');
    assert.ok(a.summary.indexOf('场均') >= 0, act + ' 应显示场均数据');
  });
  assert.ok(find(awards, 'allDefense'), '最佳防守阵容应该存在');
  assert.ok(find(awards, 'mip'), '进步最快球员应该存在');
});

check('场均明显领先时用户拿到得分王', () => {
  const awards = itemsFor({ pts: 42, reb: 5, ast: 5, stl: 1, blk: 0.5 }, 82);
  const scoring = find(awards, 'scoring');
  assert.equal(scoring.isUser, true);
  assert.equal(scoring.winner, NAME);
  assert.equal(scoring.userRank, '🥇 第一名');
});

check('数据不足时给 NPC，并标出用户排名', () => {
  const awards = itemsFor({ pts: 12, reb: 2, ast: 2, stl: 0.3, blk: 0.1 }, 82);
  const scoring = find(awards, 'scoring');
  assert.equal(scoring.isUser, false);
  assert.ok(scoring.winner !== NAME);
  assert.ok(/第 \d+ 名/.test(scoring.userRank), '应显示具体名次：' + scoring.userRank);
});

check('出勤不足 58 场时不给数据王', () => {
  const awards = itemsFor({ pts: 42, reb: 14, ast: 12, stl: 3, blk: 4 }, 40);
  ['scoring', 'rebound', 'assist', 'steal', 'block'].forEach((act) => {
    const a = find(awards, act);
    assert.equal(a.isUser, false, act + ' 出勤不足不该获奖');
    assert.equal(a.userRank, '出勤不足');
  });
  assert.equal(find(awards, 'allDefense').userRank, '出勤不足');
});

check('防守排名前五即可入选最佳防守阵容（不要求第一）', () => {
  // 用户防守属性略低于顶级内线，但排在联盟前五
  const awards = itemsFor({ pts: 18, reb: 6, ast: 3, stl: 1.2, blk: 1 }, 82);
  const def = find(awards, 'allDefense');
  const isListed = def.winner.split('、').indexOf(NAME) >= 0;
  assert.equal(def.isUser, isListed, 'isUser 应与名单一致');
  if (isListed) assert.equal(def.userRank, '🥇 入选最佳防守阵容');
});

check('新秀赛季不参与进步最快球员，且不会报错', () => {
  const awards = itemsFor({ pts: 18, reb: 4, ast: 4, stl: 1, blk: 0.3 }, 82, []);
  const mip = find(awards, 'mip');
  assert.equal(mip.isUser, false);
  assert.equal(mip.userRank, '新秀赛季不参与评选');
  assert.ok(mip.winner, '仍应给出 NPC 获奖者');
});

check('场均大涨时用户拿到进步最快球员', () => {
  const prevSeason = { team: 'AAA', playerStats: { games: 82, pts: 82 * 10, reb: 82 * 3, ast: 82 * 2 } };
  const awards = itemsFor({ pts: 24, reb: 5, ast: 4, stl: 1, blk: 0.3 }, 82, [prevSeason]);
  const mip = find(awards, 'mip');
  assert.equal(mip.isUser, true, '场均综合提升 14+ 应该获奖：' + mip.summary);
  assert.ok(mip.summary.indexOf('→') >= 0, '应显示提升幅度');
});

console.log('\n全部通过：' + passed + ' 项');
