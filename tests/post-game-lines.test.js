'use strict';

/**
 * 赛后文案测试（常规赛与季后赛共用 buildPostGameLines）
 * 原则：只说真的发生过的事——绝杀/反绝杀看引擎实际产生的 keyEvents，
 * 对手表现来自真实 boxScore，没发生的情况一个字都不写。
 * 运行：node tests/post-game-lines.test.js
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

const code = [
  'var STATE = { careerTeam: "LAL", position: "SG" };',
  'function getTeamName(t) { return ({ BOS: "凯尔特人", MIA: "热火", NYK: "尼克斯" })[t] || t; }',
  extractFunction(html, 'readGameShape'),
  extractFunction(html, 'getOpponentTopPerformer'),
  extractFunction(html, 'getOpponentShooting'),
  extractFunction(html, 'buildPostGameLines'),
  'return buildPostGameLines;',
].join('\n');

const buildPostGameLines = new Function(code)();

/** 造一场比赛：scoreA 是我方，scoreB 是对手 */
function game(opts) {
  const o = Object.assign({ my: 110, opp: 108, ot: 0, events: [], oppBox: null, userOnA: true }, opts);
  return {
    scoreA: o.my, scoreB: o.opp,
    ot: o.ot,
    keyEvents: o.events,
    boxScore: o.oppBox ? { BOS: o.oppBox } : null,
  };
}

function stats(o) {
  return Object.assign({
    pts: 20, reb: 5, ast: 4, stl: 1, blk: 0, fgm: 8, fga: 16, tov: 2, mins: 34,
  }, o);
}

const CLUTCH_HOLD = '⚡ 关键回合守住胜局';
const CLUTCH_MISS = '💔 最后回合惜败';
const UPSET = '💥 爆冷！';

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('赛后文案测试');

check('绝杀：小分差 + 关键回合守住 + 赢球', () => {
  const lines = buildPostGameLines(stats({}), {
    won: true, oppTeam: 'BOS', gameResult: game({ my: 112, opp: 110, events: [CLUTCH_HOLD] }),
  });
  assert.ok(lines[0].indexOf('守住胜局') >= 0, '第一条应是绝杀/守住胜局：' + lines[0]);
});

check('反绝杀：小分差 + 最后回合没进 + 输球', () => {
  const lines = buildPostGameLines(stats({}), {
    won: false, oppTeam: 'BOS', gameResult: game({ my: 108, opp: 110, events: [CLUTCH_MISS] }),
  });
  assert.ok(lines[0].indexOf('反绝杀') >= 0, '第一条应写明被反绝杀：' + lines[0]);
});

check('加时绝杀：有加时 + 小分差 + 守住', () => {
  const lines = buildPostGameLines(stats({}), {
    won: true, oppTeam: 'BOS', gameResult: game({ my: 120, opp: 118, ot: 1, events: [CLUTCH_HOLD] }),
  });
  assert.ok(lines[0].indexOf('加时') >= 0, '应提到加时：' + lines[0]);
});

check('双加时单独成句（不跟绝杀混）', () => {
  const lines = buildPostGameLines(stats({}), {
    won: false, oppTeam: 'BOS', gameResult: game({ my: 130, opp: 134, ot: 2, events: [] }),
  });
  assert.ok(lines[0].indexOf('2 个加时') >= 0, '应说明打了两个加时：' + lines[0]);
});

check('大胜 / 惨败', () => {
  const win = buildPostGameLines(stats({}), { won: true, oppTeam: 'BOS', gameResult: game({ my: 130, opp: 100 }) });
  assert.ok(win[0].indexOf('大胜') >= 0, win[0]);
  const lose = buildPostGameLines(stats({}), { won: false, oppTeam: 'BOS', gameResult: game({ my: 95, opp: 125 }) });
  assert.ok(lose[0].indexOf('惨败') >= 0, lose[0]);
});

check('对手爆发：写具体是谁、拿了多少分', () => {
  const lines = buildPostGameLines(stats({}), {
    won: false, oppTeam: 'BOS',
    gameResult: game({ my: 110, opp: 120, oppBox: [
      { name: 'Jayson Tatum', cname: '塔图姆', pts: 41, reb: 9, ast: 5 },
      { name: 'Derrick White', cname: '怀特', pts: 12, reb: 3, ast: 6 },
    ] }),
  });
  assert.ok(lines.some((l) => l.indexOf('塔图姆') >= 0 && l.indexOf('41') >= 0), '应写出对手得分王与其分数：' + lines.join(' / '));
});

check('对手爆发但我方赢球：语气不同（他很强，但赢的是我们）', () => {
  const lines = buildPostGameLines(stats({}), {
    won: true, oppTeam: 'BOS',
    gameResult: game({ my: 118, opp: 112, oppBox: [{ name: 'Jayson Tatum', cname: '塔图姆', pts: 38, reb: 8, ast: 6 }] }),
  });
  const line = lines.find((l) => l.indexOf('塔图姆') >= 0);
  assert.ok(line, '应提到对手核心：' + lines.join(' / '));
  assert.ok(line.indexOf('没拦住') >= 0, '赢球时语气应是"他很强但没拦住你们"：' + line);
});

check('对手整体命中率低：只在我方赢球时才提', () => {
  const cold = [{ name: 'A', cname: '甲', pts: 8, fgm: 3, fga: 14 }, { name: 'B', cname: '乙', pts: 9, fgm: 4, fga: 14 }];
  const win = buildPostGameLines(stats({}), {
    won: true, oppTeam: 'BOS', gameResult: game({ my: 105, opp: 92, oppBox: cold }),
  });
  assert.ok(win.some((l) => l.indexOf('命中率') >= 0), '赢球且对手铁，应提防守：' + win.join(' / '));
  const lose = buildPostGameLines(stats({}), {
    won: false, oppTeam: 'BOS', gameResult: game({ my: 88, opp: 99, oppBox: cold }),
  });
  assert.ok(!lose.some((l) => l.indexOf('命中率') >= 0), '输球时不该夸自己防守：' + lose.join(' / '));
});

check('三双 / 两双 / 40 分分别成句', () => {
  const td = buildPostGameLines(stats({ pts: 22, reb: 12, ast: 11 }), { won: true, oppTeam: 'BOS', gameResult: game({}) });
  assert.ok(td.some((l) => l.indexOf('三双') >= 0), td.join(' / '));
  const dd = buildPostGameLines(stats({ pts: 22, reb: 12, ast: 4 }), { won: true, oppTeam: 'BOS', gameResult: game({}) });
  assert.ok(dd.some((l) => l.indexOf('两双') >= 0), dd.join(' / '));
  const big = buildPostGameLines(stats({ pts: 44, fgm: 17, fga: 28 }), { won: true, oppTeam: 'BOS', gameResult: game({}) });
  assert.ok(big.some((l) => l.indexOf('44') >= 0), big.join(' / '));
});

check('手感冰凉：出手多且命中率低才说（不是随便扣帽子）', () => {
  const cold = buildPostGameLines(stats({ pts: 8, fgm: 3, fga: 16 }), { won: false, oppTeam: 'BOS', gameResult: game({ my: 100, opp: 110 }) });
  assert.ok(cold.some((l) => l.indexOf('手感冰凉') >= 0), cold.join(' / '));
  const normal = buildPostGameLines(stats({ pts: 8, fgm: 3, fga: 6 }), { won: false, oppTeam: 'BOS', gameResult: game({ my: 100, opp: 110 }) });
  assert.ok(!normal.some((l) => l.indexOf('手感冰凉') >= 0), '出手少不该说手感冰凉：' + normal.join(' / '));
});

check('季后赛：赛点 / 悬崖边 / 抢七都有对应说法', () => {
  const base = { won: true, oppTeam: 'BOS', gameResult: game({}), isPlayoff: true, round: '分区决赛' };
  const mp = buildPostGameLines(stats({}), Object.assign({}, base, { seriesWins: 3, seriesLosses: 1 }));
  assert.ok(mp.some((l) => l.indexOf('赛点') >= 0), mp.join(' / '));
  const edge = buildPostGameLines(stats({}), Object.assign({}, base, { won: false, seriesWins: 1, seriesLosses: 3 }));
  assert.ok(edge.some((l) => l.indexOf('悬崖') >= 0), edge.join(' / '));
  const seven = buildPostGameLines(stats({}), Object.assign({}, base, { seriesWins: 4, seriesLosses: 3, clinch: true }));
  assert.ok(seven.some((l) => l.indexOf('抢七') >= 0), seven.join(' / '));
  // 4-1 结束的系列赛不该被写成抢七
  const easy = buildPostGameLines(stats({}), Object.assign({}, base, { seriesWins: 4, seriesLosses: 1, clinch: true }));
  assert.ok(easy.some((l) => l.indexOf('系列赛拿下') >= 0), easy.join(' / '));
  assert.ok(!easy.some((l) => l.indexOf('抢七') >= 0), '4-1 不该说抢七：' + easy.join(' / '));
  // 领先时被连追两场：抢回一场
  const survive = buildPostGameLines(stats({}), Object.assign({}, base, { won: true, seriesWins: 2, seriesLosses: 3 }));
  assert.ok(survive.some((l) => l.indexOf('拖住') >= 0), survive.join(' / '));
});

check('常规赛不出现系列赛相关的句子', () => {
  const lines = buildPostGameLines(stats({}), {
    won: true, oppTeam: 'BOS', gameResult: game({}), isPlayoff: false, seriesWins: 3, seriesLosses: 1,
  });
  assert.ok(!lines.some((l) => l.indexOf('赛点') >= 0 || l.indexOf('悬崖') >= 0 || l.indexOf('抢七') >= 0), lines.join(' / '));
});

check('没有 boxScore / 没有事件时不报错，也不编造', () => {
  assert.deepEqual(buildPostGameLines(null, {}), [], '没数据就该是空');
  const plain = buildPostGameLines(stats({ pts: 12, reb: 3, ast: 2, fgm: 5, fga: 11 }), {
    won: true, oppTeam: 'BOS', gameResult: game({ my: 102, opp: 96 }),
  });
  assert.ok(Array.isArray(plain), '应返回数组');
  assert.ok(!plain.some((l) => l.indexOf('对手') >= 0 || l.indexOf('塔图姆') >= 0), '没给 boxScore 就不该提具体对手：' + plain.join(' / '));
});

check('每场最多 3 句（不会刷屏）', () => {
  const lines = buildPostGameLines(stats({ pts: 45, reb: 12, ast: 11, stl: 4, blk: 3, fgm: 18, fga: 28 }), {
    won: true, oppTeam: 'BOS', isPlayoff: true, seriesWins: 3, seriesLosses: 3,
    gameResult: game({ my: 128, opp: 126, ot: 1, events: [CLUTCH_HOLD], oppBox: [{ name: 'X', cname: '某某', pts: 40, reb: 5, ast: 5 }] }),
  });
  assert.ok(lines.length <= 3, '最多 3 句，实际 ' + lines.length + '：' + lines.join(' / '));
});

const spotCode = [
  'var STATE = { careerTeam: "LAL", position: "SG", season: {} };',
  'function getTeamName(t) { return ({ BOS: "凯尔特人" })[t] || t; }',
  extractFunction(html, 'readGameShape'),
  extractFunction(html, 'getOpponentTopPerformer'),
  extractFunction(html, 'getOpponentShooting'),
  extractFunction(html, 'buildPostGameLines'),
  html.slice(html.indexOf('var REGULAR_SPOTLIGHT'), html.indexOf('function getRegularGameSpotlight')),
  extractFunction(html, 'getRegularGameSpotlight'),
  'return { spot: getRegularGameSpotlight, reset: function() { STATE.season = {}; } };',
].join('\n');
const spotApi = new Function(spotCode)();
const getRegularGameSpotlight = spotApi.spot;
const resetSpotlight = spotApi.reset;

check('常规赛高光弹窗：结构与剧情弹窗接口一致', () => {
  const spot = getRegularGameSpotlight(stats({}), Object.assign(game({ my: 112, opp: 110, events: [CLUTCH_HOLD] }), { oppTeam: 'BOS' }), 10);
  assert.ok(spot, '绝杀应该触发弹窗');
  ['emoji', 'title', 'body', 'detail', 'btnText'].forEach((k) => {
    assert.ok(typeof spot[k] === 'string' && spot[k].length > 0, '弹窗字段 ' + k + ' 不能为空（showEventModal 要用）');
  });
  assert.ok(spot.title.indexOf('最后一回合') >= 0, '无加时的绝杀标题应是“最后一回合”：' + spot.title);
  assert.ok(spot.body.length > 10, '正文不能太短');
  assert.ok(spot.detail.indexOf('凯尔特人') >= 0, '详情应写对手：' + spot.detail);
});

check('加时绝杀：标题会改成“加时绝杀”', () => {
  resetSpotlight();
  const spot = getRegularGameSpotlight(stats({}), Object.assign(game({ my: 120, opp: 118, ot: 1, events: [CLUTCH_HOLD] }), { oppTeam: 'BOS' }), 12);
  assert.ok(spot && spot.title.indexOf('加时绝杀') >= 0, '应写明加时绝杀：' + (spot && spot.title));
});

check('普通比赛不弹窗（不能场场弹）', () => {
  const plain = getRegularGameSpotlight(stats({ pts: 18, reb: 4, ast: 3 }), Object.assign(game({ my: 104, opp: 98 }), { oppTeam: 'BOS' }), 5);
  assert.equal(plain, null, '平凡的一场不该打扰玩家');
});

check('三双 / 40+ / 双加时 / 爆冷 都能触发', () => {
  const ctx = (g) => Object.assign(g, { oppTeam: 'BOS' });
  // 每例前重置：它们共用同一份冷却状态（说明冷却确实生效）
  resetSpotlight();
  assert.ok(getRegularGameSpotlight(stats({ pts: 20, reb: 12, ast: 11 }), ctx(game({ my: 110, opp: 100 })), 10), '三双应触发');
  resetSpotlight();
  assert.ok(getRegularGameSpotlight(stats({ pts: 44, fgm: 17, fga: 28 }), ctx(game({ my: 118, opp: 110 })), 20), '40+ 应触发');
  resetSpotlight();
  assert.ok(getRegularGameSpotlight(stats({ pts: 22 }), ctx(game({ my: 130, opp: 128, ot: 2 })), 30), '双加时应触发');
  resetSpotlight();
  assert.ok(getRegularGameSpotlight(stats({ pts: 25 }), ctx(game({ my: 108, opp: 104, events: [UPSET] })), 40), '爆冷应触发');
  resetSpotlight();
});

check('冷却：两次弹窗之间至少隔 4 场', () => {
  resetSpotlight();
  const ctx = Object.assign(game({ my: 112, opp: 110, events: [CLUTCH_HOLD] }), { oppTeam: 'BOS' });
  assert.ok(getRegularGameSpotlight(stats({}), ctx, 10), '第 10 场应该弹');
  assert.equal(getRegularGameSpotlight(stats({}), ctx, 11), null, '紧接着的第 11 场应被冷却拦住');
  assert.equal(getRegularGameSpotlight(stats({}), ctx, 13), null, '还差一场也不弹');
  assert.ok(getRegularGameSpotlight(stats({}), ctx, 14), '隔满 4 场后可以再弹');
});

check('每季上限：超过 12 次就不再弹', () => {
  resetSpotlight();
  const ctx = Object.assign(game({ my: 112, opp: 110, events: [CLUTCH_HOLD] }), { oppTeam: 'BOS' });
  let fired = 0;
  for (let g = 1; g <= 82; g += 5) {
    if (getRegularGameSpotlight(stats({}), ctx, g)) fired++;
  }
  assert.equal(fired, 12, '一季最多 12 次，实际 ' + fired);
});

check('常规赛文案更短：最多 2 句（季后赛仍是 3）', () => {
  const heavy = stats({ pts: 45, reb: 12, ast: 11, stl: 4, blk: 3, fgm: 18, fga: 28 });
  const ctx = {
    won: true, oppTeam: 'BOS',
    gameResult: game({ my: 128, opp: 126, ot: 1, events: [CLUTCH_HOLD], oppBox: [{ name: 'X', cname: '某某', pts: 40, reb: 5, ast: 5 }] }),
  };
  const reg = buildPostGameLines(heavy, Object.assign({ isPlayoff: false }, ctx));
  assert.ok(reg.length <= 2, '常规赛最多 2 句，实际 ' + reg.length + '：' + reg.join(' / '));
  const po = buildPostGameLines(heavy, Object.assign({ isPlayoff: true, seriesWins: 3, seriesLosses: 3 }, ctx));
  assert.ok(po.length <= 3 && po.length >= reg.length, '季后赛可以到 3 句，实际 ' + po.length);
});

console.log('\n全部通过：' + passed + ' 项');
