'use strict';

/**
 * 换队后的球队关系重置测试
 * 从 nba-perfect-player.html 抽出 resetTeamRelationsOnTeamChange 的源码，
 * 用伪造的 STATE 验证：教练信任 / 更衣室信任归零，其余生涯级数值不受影响。
 * 运行：node tests/team-relations.test.js
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

const factorMatch = html.match(/var TEAM_RELATION_RESET_FACTOR\s*=\s*([0-9.]+)\s*;/);
if (!factorMatch) throw new Error('找不到 TEAM_RELATION_RESET_FACTOR');
const factor = Number(factorMatch[1]);

const source = [
  extractFunction(html, 'getCareerProfile'),
  extractFunction(html, 'resetTeamRelationsOnTeamChange'),
  'return { reset: resetTeamRelationsOnTeamChange, profile: getCareerProfile };',
].join('\n');

const noop = function () {};
const build = new Function(
  'STATE', 'TEAM_RELATION_RESET_FACTOR', 'clearLineupCache', 'syncUserStarterStatus', 'refreshPlayerStateStripLive',
  source
);

function runOn(profile) {
  const STATE = { career: { profile, season: {}, careerTeam: 'LAL' }, season: {} };
  const api = build(STATE, factor, noop, noop, noop);
  const notes = api.reset();
  return { notes, profile: api.profile() };
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('换队球队关系重置测试（当前系数 ' + factor + '）');

check('教练信任与更衣室信任按系数重置，其余数值不受影响', () => {
  const { notes, profile } = runOn({ coachTrust: 20, lockerRoomTrust: 12, loyalty: 5, leadership: 4, fanSupport: 3 });
  assert.equal(profile.coachTrust, Math.floor(20 * factor));
  assert.equal(profile.lockerRoomTrust, Math.floor(12 * factor));
  assert.equal(profile.loyalty, 5);
  assert.equal(profile.leadership, 4);
  assert.equal(profile.fanSupport, 3);
  assert.equal(notes.length, 2, '应给出两条变化提示');
});

check('关系本来就是 0 时不产生提示（幂等）', () => {
  const { notes } = runOn({ coachTrust: 0, lockerRoomTrust: 0, loyalty: 5 });
  assert.deepEqual(notes, []);
});

check('缺失字段不会报错', () => {
  const { notes, profile } = runOn({});
  assert.deepEqual(notes, []);
  assert.equal(profile.coachTrust, 0);
  assert.equal(profile.lockerRoomTrust, 0);
});

console.log('\n全部通过：' + passed + ' 项');
