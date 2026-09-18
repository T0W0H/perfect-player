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

const factor = { base: 0, perSeason: 0, max: 0 };

const retentionMatch = html.match(/var TEAM_RELATION_RETENTION\s*=\s*\{([^}]*)\}/);
if (!retentionMatch) throw new Error('找不到 TEAM_RELATION_RETENTION');
const retention = {};
retentionMatch[1].split(',').forEach((line) => {
  const m = line.match(/(\w+)\s*:\s*([0-9.]+)/);
  if (m) retention[m[1]] = Number(m[2]);
});
if (!retention.base || !retention.perSeason || !retention.max) {
  throw new Error('TEAM_RELATION_RETENTION 字段不完整: ' + JSON.stringify(retention));
}

function expectedFactor(seasons) {
  return Math.min(retention.max, retention.base + seasons * retention.perSeason);
}

const source = [
  extractFunction(html, 'getTeamRelationRetentionFactor'),
  extractFunction(html, 'getCareerProfile'),
  extractFunction(html, 'resetTeamRelationsOnTeamChange'),
  'return { reset: resetTeamRelationsOnTeamChange, profile: getCareerProfile, factor: getTeamRelationRetentionFactor };',
].join('\n');

const noop = function () {};
const build = new Function(
  'STATE', 'TEAM_RELATION_RETENTION', 'clearLineupCache', 'syncUserStarterStatus', 'refreshPlayerStateStripLive',
  source
);

function runOn(profile, seasons) {
  const STATE = { career: { profile, seasonCount: seasons || 0 }, season: {}, careerTeam: 'LAL' };
  const api = build(STATE, retention, noop, noop, noop);
  const notes = api.reset();
  return { notes, profile: api.profile(), rate: api.factor() };
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('换队球队关系保留测试（base ' + retention.base + ' / 每季 +' + retention.perSeason + ' / 上限 ' + retention.max + '）');

check('保留比例随生涯长度递增，并有上限', () => {
  assert.equal(Number(expectedFactor(0).toFixed(4)), retention.base);
  assert.ok(expectedFactor(5) > expectedFactor(1), '越老保留越多');
  assert.equal(expectedFactor(30), retention.max, '封顶在 ' + retention.max);
});

check('换队不清零：按比例保留，其余数值不受影响', () => {
  const { profile } = runOn({ coachTrust: 20, lockerRoomTrust: 12, loyalty: 5, leadership: 4, fanSupport: 3 }, 5);
  assert.equal(profile.coachTrust, Math.round(20 * expectedFactor(5)));
  assert.equal(profile.lockerRoomTrust, Math.round(12 * expectedFactor(5)));
  assert.ok(profile.coachTrust > 0, '不会直接清 0');
  assert.equal(profile.loyalty, 5);
  assert.equal(profile.leadership, 4);
  assert.equal(profile.fanSupport, 3);
});

check('生涯越长保留越多，新秀保留最少', () => {
  const rookie = runOn({ coachTrust: 20 }, 0).profile.coachTrust;
  const mid = runOn({ coachTrust: 20 }, 5).profile.coachTrust;
  const vet = runOn({ coachTrust: 20 }, 12).profile.coachTrust;
  assert.ok(rookie < mid && mid < vet, '应为递增：' + rookie + ' < ' + mid + ' < ' + vet);
  assert.equal(vet, Math.round(20 * retention.max));
});

check('关系很低时不会因为取整而凭空增加', () => {
  const { profile } = runOn({ coachTrust: 1, lockerRoomTrust: 0 }, 0);
  assert.ok(profile.coachTrust <= 1);
  assert.equal(profile.lockerRoomTrust, 0);
});

check('缺失字段不会报错', () => {
  const { notes, profile } = runOn({}, 3);
  assert.deepEqual(notes, []);
  assert.equal(profile.coachTrust, 0);
});

console.log('\n全部通过：' + passed + ' 项');
