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

console.log('\n全部通过：' + passed + ' 项');
