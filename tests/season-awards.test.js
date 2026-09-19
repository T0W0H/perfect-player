'use strict';

/**
 * 赛季奖项（数据王 / 最佳防守阵容 / 进步最快球员）测试
 * 从 nba-perfect-player.html 抽出 calcSeasonAwards 里新增的三段评选逻辑，
 * 用伪造的联盟名单与场均数据验证：奖项齐全、排名正确、出勤门槛、替补限制、
 * 连庄衰减与组织中锋例外。
 * 运行：node tests/season-awards.test.js
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

const startMarker = '// ==================== 数据王（得分 / 篮板 / 助攻 / 三分 / 抢断 / 盖帽） ====================';
const endMarker = 'updateAwardStreaks();';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker, start);
if (start < 0 || end < 0 || end <= start) throw new Error('找不到新增奖项评选代码段');

// 与被测代码段同级的两个依赖：联赛排名与连庄查询
const helpers = [
  extractFunction(html, 'getLeagueRank'),
  extractFunction(html, 'getPlayerAwardStreak'),
].join('\n');
const awardCode = helpers + '\n' + html.slice(start, end);

const run = new Function(
  'STATE', 'NBA2K_DATA', 'NBA2K_TEAMS', 'avg', 'g', 'getHupuDisplayName', 'getLeaguePlayerAge', 'calcTeamLineup',
  awardCode + '\nreturn STATE.season.awards;'
);

const NAME = '我的球员';

/** 用 OVR 前五做首发；带 _bench 标记的球员一律算替补（第一替补 = 第六人） */
function stubLineup(league) {
  return function (team) {
    const roster = league[team] || [];
    const starters = roster.filter((p) => !p._bench).slice().sort((a, b) => (b.ovr || 0) - (a.ovr || 0));
    const benchOnly = roster.filter((p) => p._bench);
    return {
      starters: { PG: starters[0], SG: starters[1], SF: starters[2], PF: starters[3], C: starters[4] },
      bench: starters.slice(5).concat(benchOnly),
    };
  };
}

function runAwards(league, teams, userAvg, games, careerSeasons) {
  const STATE = {
    season: { awards: [], playerStats: { games: games } },
    career: { seasons: careerSeasons || [] },
    careerTeam: teams[0],
    attrs: { PDEF: 85, IDEF: 85, BLK: 80 },
    finalOVR: 88,
    position: 'SG',
  };
  return run(STATE, league, teams, userAvg, games, () => NAME, () => 24, stubLineup(league));
}

function find(awards, act) {
  return awards.find((a) => a.act === act) || null;
}

const baseLeague = {
  AAA: [
    { name: 'Star Wing', cname: '斯达-温', ovr: 95, pos: 'SG', threePT: 95, MID: 95, FIN: 95, PDEF: 92, ATH: 95, BLK: 40, IDEF: 55, REB: 60, STR: 70, PAS: 80, HAN: 90 },
    { name: 'Pass Guard', cname: '帕斯-加德', ovr: 88, pos: 'PG', threePT: 84, MID: 82, FIN: 80, PDEF: 86, ATH: 88, BLK: 35, IDEF: 50, REB: 50, STR: 60, PAS: 95, HAN: 92 },
  ],
  BBB: [
    { name: 'Big Man', cname: '比格-曼', ovr: 90, pos: 'C', threePT: 60, MID: 70, FIN: 92, PDEF: 70, ATH: 70, BLK: 92, IDEF: 93, REB: 93, STR: 95, PAS: 70, HAN: 60 },
    { name: 'Role Guy', cname: '罗尔-盖', ovr: 74, pos: 'SF', threePT: 74, MID: 74, FIN: 74, PDEF: 74, ATH: 74, BLK: 50, IDEF: 60, REB: 65, STR: 70, PAS: 70, HAN: 70 },
  ],
};

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('赛季奖项测试');

check('六项数据王都会产出，且字段完整', () => {
  const awards = runAwards(baseLeague, ['AAA', 'BBB'], { pts: 18, reb: 5, ast: 5, stl: 1, blk: 0.5, threeM: 2.2 }, 82);
  ['scoring', 'rebound', 'assist', 'three', 'steal', 'block'].forEach((act) => {
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
  const awards = runAwards(baseLeague, ['AAA', 'BBB'], { pts: 42, reb: 5, ast: 5, stl: 1, blk: 0.5 }, 82);
  const scoring = find(awards, 'scoring');
  assert.equal(scoring.isUser, true);
  assert.equal(scoring.winner, NAME);
  assert.equal(scoring.userRank, '🥇 第一名');
});

check('数据不足时给 NPC，并标出用户排名', () => {
  const awards = runAwards(baseLeague, ['AAA', 'BBB'], { pts: 8, reb: 2, ast: 2, stl: 0.3, blk: 0.1 }, 82);
  const scoring = find(awards, 'scoring');
  assert.equal(scoring.isUser, false);
  assert.ok(scoring.winner !== NAME);
  assert.ok(/第 ?\d+ 名/.test(scoring.userRank), '应显示具体名次：' + scoring.userRank);
});

check('出勤不足 58 场时不给数据王，并显示场次', () => {
  const awards = runAwards(baseLeague, ['AAA', 'BBB'], { pts: 42, reb: 14, ast: 12, stl: 3, blk: 4, threeM: 3.5 }, 40);
  ['scoring', 'rebound', 'assist', 'three', 'steal', 'block'].forEach((act) => {
    const a = find(awards, act);
    assert.equal(a.isUser, false, act + ' 出勤不足不该获奖');
    assert.ok(a.userRank.indexOf('出勤不足') >= 0);
    assert.ok(a.userRank.indexOf('40') >= 0, '文案应带场次：' + a.userRank);
  });
});

check('替补无法拿数据王：同队次强得分手被压到首发之下', () => {
  const wing = (name, cname, ovr) => ({
    name, cname, ovr, pos: 'SG',
    threePT: ovr, MID: ovr, FIN: ovr, DNK: ovr - 5,
    REB: 60, STR: 70, PAS: 75, HAN: 80, PDEF: 80, ATH: 85, BLK: 40, IDEF: 55,
  });
  const league = {
    AAA: [wing('Wing A', '首-发A', 90)],
    // 同一队：95 首发 + 93 替补，替补即使更强于 A 也不该上榜
    BBB: [wing('Wing B', '首-发B', 95), Object.assign(wing('Wing C', '替-补C', 93), { _bench: true })],
  };
  // 用户场均 24，夹在「首发 A ≈ 27」与「替补 C ≈ 21」之间
  const awards = runAwards(league, ['AAA', 'BBB'], { pts: 24, reb: 3, ast: 3, stl: 0.5, blk: 0.2 }, 82);
  const scoring = find(awards, 'scoring');
  assert.equal(scoring.winner, '首-发B', '该由最好的首发拿奖，实际：' + scoring.winner);
  assert.equal(scoring.userRank, '🥉 第三名', '替补应被压到用户之下，实际：' + scoring.userRank);
});

check('连庄衰减：同一 NPC 连拿多年后评分下降', () => {
  const build = (streak) => {
    const roster = [
      { name: 'Two Time', cname: '两-连', ovr: 92, pos: 'SG', threePT: 92, MID: 92, FIN: 92, DNK: 85, REB: 60, STR: 70, PAS: 75, HAN: 85, PDEF: 80, ATH: 88, BLK: 40, IDEF: 55 },
      { name: 'Second Man', cname: '第-二', ovr: 89, pos: 'SG', threePT: 88, MID: 88, FIN: 88, DNK: 82, REB: 60, STR: 70, PAS: 75, HAN: 82, PDEF: 80, ATH: 85, BLK: 40, IDEF: 55 },
    ];
    if (streak) roster[0]._awardStreak = { scoring: streak };
    return { AAA: roster };
  };
  const fresh = find(runAwards(build(0), ['AAA'], { pts: 5, reb: 2, ast: 2, stl: 0, blk: 0 }, 82), 'scoring').winner;
  const worn = find(runAwards(build(6), ['AAA'], { pts: 5, reb: 2, ast: 2, stl: 0, blk: 0 }, 82), 'scoring').winner;
  assert.equal(fresh, '两-连', '没有连庄时顶级得分手获奖');
  assert.equal(worn, '第-二', '连庄 6 年后应被第二名顶上，实际：' + worn);
});

check('组织中锋例外：PAS 92+ 的中锋按组织核心估算助攻', () => {
  const league = {
    AAA: [{ name: 'Jokic Like', cname: '约-基奇式', ovr: 92, pos: 'C', threePT: 75, MID: 85, FIN: 90, DNK: 80, REB: 90, STR: 90, PAS: 95, HAN: 92, PDEF: 70, ATH: 65, BLK: 80, IDEF: 85 }],
    BBB: [{ name: 'Normal Big', cname: '普-通中锋', ovr: 92, pos: 'C', threePT: 75, MID: 85, FIN: 90, DNK: 80, REB: 90, STR: 90, PAS: 70, HAN: 75, PDEF: 70, ATH: 65, BLK: 80, IDEF: 85 }],
  };
  const awards = runAwards(league, ['AAA', 'BBB'], { pts: 5, reb: 3, ast: 3, stl: 0.3, blk: 0.3 }, 82);
  assert.equal(find(awards, 'assist').winner, '约-基奇式', '组织中锋应拿下助攻王');
});

check('三分王：比的是三分命中数，不是得分', () => {
  const shooter = (name, cname, threePT) => ({
    name, cname, ovr: 88, pos: 'SG',
    threePT, MID: 85, FIN: 84, DNK: 80, REB: 55, STR: 65, PAS: 78, HAN: 85, PDEF: 78, ATH: 86, BLK: 35, IDEF: 55,
  });
  const league = { AAA: [shooter('Sharp Guy', '神-射手', 96)], BBB: [shooter('Cold Guy', '铁-手', 70)] };
  const userAvg = (threeM) => ({ pts: 20, reb: 4, ast: 4, stl: 1, blk: 0.3, threeM });
  const won = find(runAwards(league, ['AAA', 'BBB'], userAvg(4.6), 82), 'three');
  assert.equal(won.isUser, true, '三分产量领先应拿下三分王：' + won.summary);
  assert.equal(won.userRank, '🥇 第一名');
  const lost = find(runAwards(league, ['AAA', 'BBB'], userAvg(0.8), 82), 'three');
  assert.equal(lost.isUser, false, '三分产量不足不该拿奖');
  assert.equal(lost.winner, '神-射手');
});

check('防守排名前五即可入选最佳防守阵容（不要求第一）', () => {
  const awards = runAwards(baseLeague, ['AAA', 'BBB'], { pts: 18, reb: 6, ast: 3, stl: 1.2, blk: 1 }, 82);
  const def = find(awards, 'allDefense');
  const isListed = def.winner.split('、').indexOf(NAME) >= 0;
  assert.equal(def.isUser, isListed, 'isUser 应与名单一致');
  if (isListed) assert.equal(def.userRank, '🥇 入选最佳防守阵容');
});

check('新秀赛季不参与进步最快球员，且不会报错', () => {
  const awards = runAwards(baseLeague, ['AAA', 'BBB'], { pts: 18, reb: 4, ast: 4, stl: 1, blk: 0.3 }, 82, []);
  const mip = find(awards, 'mip');
  assert.equal(mip.isUser, false);
  assert.equal(mip.userRank, '新秀赛季不参与评选');
  assert.ok(mip.winner, '仍应给出 NPC 获奖者');
});

check('场均大涨时用户拿到进步最快球员', () => {
  const prevSeason = { team: 'AAA', playerStats: { games: 82, pts: 82 * 10, reb: 82 * 3, ast: 82 * 2 } };
  const awards = runAwards(baseLeague, ['AAA', 'BBB'], { pts: 24, reb: 5, ast: 4, stl: 1, blk: 0.3 }, 82, [prevSeason]);
  const mip = find(awards, 'mip');
  assert.equal(mip.isUser, true, '场均综合提升 14+ 应该获奖：' + mip.summary);
});

console.log('\n全部通过：' + passed + ' 项');
