'use strict';

/**
 * 母队效力年限（留守奖励）测试
 * 从 nba-perfect-player.html 抽出年限推导与生涯效果函数，
 * 验证：换队后年限归零、训练点档位、交易/续约比率随年限变化。
 * 运行：node tests/team-loyalty.test.js
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

function extractObjectVar(source, name) {
  const start = source.indexOf('var ' + name);
  if (start < 0) throw new Error('找不到常量: ' + name);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error('常量大括号不配对: ' + name);
}

const source = [
  'var LOYALTY_BONUS = ' + extractObjectVar(html, 'LOYALTY_BONUS') + ';',
  extractFunction(html, 'getTeamTenureSeasons'),
  extractFunction(html, 'getLoyaltyTrainingBonus'),
  extractFunction(html, 'getCareerProfile'),
  extractFunction(html, 'clampCareerEffect'),
  extractFunction(html, 'getCareerProfileEffects'),
  'return { tenure: getTeamTenureSeasons, loyaltyPoints: getLoyaltyTrainingBonus, effects: getCareerProfileEffects };',
].join('\n');

const api = new Function('STATE', source);

function build(seasons, careerTeam, profile) {
  const STATE = {
    career: { seasons: seasons, profile: profile || {}, currentAge: 30 },
    careerTeam: careerTeam,
    season: {},
  };
  return api(STATE);
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('留守奖励测试');

check('年限只统计「队尾连续同一支球队」的赛季', () => {
  const seasons = [
    { team: 'BOS' }, { team: 'LAL' }, { team: 'LAL' }, { team: 'LAL' },
  ];
  assert.equal(build(seasons, 'LAL').tenure(), 3, '连续 3 季效力湖人');
  assert.equal(build(seasons, 'BOS').tenure(), 0, '最近一季不在 BOS 所以归零');
  assert.equal(build([], 'LAL').tenure(), 0, '没有完成赛季时归零');
});

check('训练点档位：3 / 6 / 10 季 → +1 / +2 / +3', () => {
  const mk = (n) => {
    const seasons = [];
    for (let i = 0; i < n; i++) seasons.push({ team: 'LAL' });
    return build(seasons, 'LAL').loyaltyPoints();
  };
  assert.equal(mk(0), 0);
  assert.equal(mk(2), 0);
  assert.equal(mk(3), 1);
  assert.equal(mk(5), 1);
  assert.equal(mk(6), 2);
  assert.equal(mk(9), 2);
  assert.equal(mk(10), 3);
  assert.equal(mk(15), 3);
});

check('换队后年限重新计算，奖励随之消失', () => {
  const stayed = [{ team: 'LAL' }, { team: 'LAL' }, { team: 'LAL' }, { team: 'LAL' }, { team: 'LAL' }, { team: 'LAL' }];
  assert.equal(build(stayed, 'LAL').loyaltyPoints(), 2);
  const moved = stayed.concat([{ team: 'NYK' }]);
  assert.equal(build(moved, 'NYK').loyaltyPoints(), 0, '刚换队没有年限');
});

check('年限降低被交易概率、提高续约率', () => {
  const rookie = build([], 'LAL').effects();
  assert.equal(rookie.tradeChanceDelta, 0);
  assert.equal(rookie.renewalChanceBonus, 0);
  assert.equal(rookie.loyaltyTenure, 0);

  const seasons = [];
  for (let i = 0; i < 8; i++) seasons.push({ team: 'LAL' });
  const veteran = build(seasons, 'LAL').effects();
  assert.equal(veteran.loyaltyTenure, 8);
  assert.equal(veteran.tradeChanceDelta, -4, '8 季 → 交易概率 -4（上限）');
  assert.equal(Math.round(veteran.renewalChanceBonus * 100), 8, '8 季 → 续约率 +8%（上限）');
});

check('年限奖励叠加在既有档案数值之上', () => {
  const seasons = [];
  for (let i = 0; i < 4; i++) seasons.push({ team: 'LAL' });
  const withTrust = build(seasons, 'LAL', { controversy: 8, coachTrust: 10 });
  const effects = withTrust.effects();
  assert.ok(effects.tradeChanceDelta <= 0, '高争议但老将留守也不会更容易被交易');
  assert.ok(effects.renewalChanceBonus > 0.02);
});

console.log('\n全部通过：' + passed + ' 项');
