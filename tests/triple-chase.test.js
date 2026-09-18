'use strict';

/**
 * 三双追逐（TRIPLE_CHASE）测试
 * 从 nba-perfect-player.html 抽出 TRIPLE_CHASE 那一组函数，验证：
 *   1) 资格门槛（总评 / 位置主项 / 上场时间）；
 *   2) 三双夜：整场长成三双，且 fgm/fga 自洽；
 *   3) 末段追逐：8+8 只差一口气时补齐；
 *   4) 只加不减，永远不降低任何数据。
 * 运行：node tests/triple-chase.test.js
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
  return source.slice(start, matchEnd(source, open));
}

function extractVarObject(source, name) {
  const start = source.indexOf('var ' + name + ' = {');
  if (start < 0) throw new Error('找不到对象: ' + name);
  const open = source.indexOf('{', start);
  return source.slice(start, open) + source.slice(open, matchEnd(source, open)) + ';';
}

/** 返回与 source[open] 配对的闭合括号下标（+1） */
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

const chaseSource = [
  extractVarObject(html, 'TRIPLE_CHASE'),
  extractFunction(html, 'getTripleChaseCfg'),
  extractFunction(html, 'isTripleChaseEligible'),
  extractFunction(html, 'isTripleChaseShape'),
  extractFunction(html, 'liftStatToDoubleDigit'),
  extractFunction(html, 'completeTripleDoubleLine'),
  extractFunction(html, 'applyTripleDoubleChase'),
  'return { TRIPLE_CHASE:TRIPLE_CHASE, getTripleChaseCfg:getTripleChaseCfg, isTripleChaseEligible:isTripleChaseEligible, isTripleChaseShape:isTripleChaseShape, completeTripleDoubleLine:completeTripleDoubleLine, applyTripleDoubleChase:applyTripleDoubleChase };',
].join('\n');

const ATTRS = ['threePT','MID','FIN','DNK','HAN','PAS','PDEF','IDEF','BLK','REB','ATH','STR','CLU'];

// calcOVR 用平均值代替（测试只关心门槛，不关心真实权重）
const calcOVR = (attrs) => Math.round(ATTRS.reduce((sum, key) => sum + (Number(attrs[key]) || 50), 0) / ATTRS.length);
const api = new Function('STATE', 'calcOVR', chaseSource)({ finalOVR: 99 }, calcOVR);

function attrsWith(overrides, base) {
  const out = {};
  ATTRS.forEach((key) => { out[key] = base == null ? 95 : base; });
  return Object.assign(out, overrides || {});
}

function makeLine(overrides) {
  return Object.assign({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, threeM: 0, threeA: 0, mins: 34 }, overrides || {});
}

function rngFixed(value) {
  return () => value;
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('三双追逐测试');

check('位置主项门槛：达标 2 项才算有资格', () => {
  const PG = attrsWith({ PAS: 95, HAN: 99, CLU: 70 });   // 2 项达标
  const weak = attrsWith({ PAS: 95, HAN: 70, CLU: 70 }); // 只有 1 项
  assert.equal(api.isTripleChaseEligible(PG, 'PG', 34, 95), true);
  assert.equal(api.isTripleChaseEligible(weak, 'PG', 34, 95), false);
});

check('总评与上场时间门槛', () => {
  const PG = attrsWith({ PAS: 95, HAN: 95, CLU: 95 });
  assert.equal(api.isTripleChaseEligible(PG, 'PG', 34, 95), true);
  assert.equal(api.isTripleChaseEligible(PG, 'PG', 34, 80), false, '总评不到 90 不应触发');
  assert.equal(api.isTripleChaseEligible(PG, 'PG', 12, 95), false, '上场时间太少不应触发');
  assert.equal(api.isTripleChaseEligible(PG, 'PG', 20, 95), true, '正好 20 分钟算达标');
});

check('三双夜：整场长成三双，且 fgm/fga 自洽', () => {
  api.TRIPLE_CHASE.nightChance.PG = 1;
  api.TRIPLE_CHASE.chaseChance.PG = 0;
  const line = makeLine({ pts: 6, reb: 4, ast: 5, fgm: 3, fga: 8, threeM: 0, threeA: 3 });
  const before = line.pts + line.reb + line.ast;
  const hit = api.applyTripleDoubleChase(line, attrsWith({ PAS: 95, HAN: 95 }), 'PG', rngFixed(0));
  assert.equal(hit, 'night');
  assert.ok(line.pts >= 10 && line.reb >= 10 && line.ast >= 10, '三项都应上双：' + JSON.stringify(line));
  assert.ok(line.fgm <= line.fga, 'fgm 不应超过 fga');
  assert.ok(line.threeA <= line.fga, 'threeA 不应超过 fga');
  assert.ok(line.pts + line.reb + line.ast > before, '只加不减');
  api.TRIPLE_CHASE.nightChance.PG = 0.075;
});

check('末段追逐：8+8 只差一口气时补齐到三双', () => {
  api.TRIPLE_CHASE.nightChance.PG = 0;
  api.TRIPLE_CHASE.chaseChance.PG = 1;
  const line = makeLine({ pts: 24, reb: 9, ast: 8, fgm: 10, fga: 18 });
  const hit = api.applyTripleDoubleChase(line, attrsWith({ PAS: 95, HAN: 95 }), 'PG', rngFixed(0));
  assert.equal(hit, 'chase');
  assert.ok(line.pts >= 10 && line.reb >= 10 && line.ast >= 10, JSON.stringify(line));
  assert.ok(line.reb <= api.TRIPLE_CHASE.giftCap && line.ast <= api.TRIPLE_CHASE.giftCap, '赠送值不应离谱');
  api.TRIPLE_CHASE.chaseChance.PG = 0.30;
});

check('已经是三双就不再追，得分/篮板不够也不追', () => {
  api.TRIPLE_CHASE.nightChance.PG = 0;
  api.TRIPLE_CHASE.chaseChance.PG = 1;
  const done = makeLine({ pts: 24, reb: 11, ast: 12 });
  assert.equal(api.isTripleChaseShape(done), false, '已经三双了');
  assert.equal(api.applyTripleDoubleChase(done, attrsWith({ PAS: 95, HAN: 95 }), 'PG', rngFixed(0)), null);

  const noPts = makeLine({ pts: 4, reb: 9, ast: 9 });
  assert.equal(api.isTripleChaseShape(noPts), false, '得分不到 10 不算在追三双');
  assert.equal(api.applyTripleDoubleChase(noPts, attrsWith({ PAS: 95, HAN: 95 }), 'PG', rngFixed(0)), null);

  const shortReb = makeLine({ pts: 20, reb: 6, ast: 9 });
  assert.equal(api.applyTripleDoubleChase(shortReb, attrsWith({ PAS: 95, HAN: 95 }), 'PG', rngFixed(0)), null);
  api.TRIPLE_CHASE.chaseChance.PG = 0.30;
});

check('资格不足时整层都不触发', () => {
  api.TRIPLE_CHASE.nightChance.PG = 1;
  const line = makeLine({ pts: 6, reb: 4, ast: 5 });
  assert.equal(api.applyTripleDoubleChase(line, attrsWith({ PAS: 95, HAN: 70, CLU: 70 }), 'PG', rngFixed(0)), null);
  assert.equal(line.pts, 6, '未触发时不应改动数据');
  api.TRIPLE_CHASE.nightChance.PG = 0.075;
});

check('随机值落在概率之上时不触发（不会每场都三双）', () => {
  const line = makeLine({ pts: 12, reb: 3, ast: 4 });
  const hit = api.applyTripleDoubleChase(line, attrsWith({ PAS: 95, HAN: 95 }), 'PG', rngFixed(0.999));
  assert.equal(hit, null);
  assert.deepEqual({ pts: line.pts, reb: line.reb, ast: line.ast }, { pts: 12, reb: 3, ast: 4 });
});

check('不封顶：赠送值不会把已有数据往下拉', () => {
  const line = makeLine({ pts: 41, reb: 13, ast: 15 });
  const snapshot = JSON.stringify(line);
  api.completeTripleDoubleLine(line);
  assert.equal(JSON.stringify(line), snapshot, '已上双的三项都不该被改动');
});

check('概率表与位置分组完整，缺失位置有兜底', () => {
  ATTRS.forEach(() => {});
  ['PG', 'SG', 'SF', 'PF', 'C'].forEach((pos) => {
    const cfg = api.getTripleChaseCfg(pos);
    assert.equal(cfg.keyAttrs.length, 3, pos + ' 应有 3 个位置主项');
    assert.ok(cfg.nightChance > 0 && cfg.nightChance < 0.2, pos + ' 三双夜概率应在合理区间：' + cfg.nightChance);
    assert.ok(cfg.chaseChance > 0 && cfg.chaseChance <= 0.5, pos + ' 追逐概率应在合理区间：' + cfg.chaseChance);
  });
  const fallback = api.getTripleChaseCfg('XX');
  assert.deepEqual(fallback.keyAttrs, api.TRIPLE_CHASE.keyAttrs.SF, '未知位置回退到 SF');
});

console.log('\n全部通过：' + passed + ' 项');
