'use strict';

/**
 * 属性键一致性测试
 * 剧情与训练里写的每一个属性键，都必须真的落到后端，不能是"写着耐力+1、其实什么都没发生"。
 * 这里做三件事：
 *   1) 扫描全文件，找出所有 addAttrDelta / applyTrainingOutcome / addSeasonMod 用到的键；
 *   2) 断言它们要么是 13 项真实属性，要么在别名表里，要么是已知的赛季修正；
 *   3) 真跑一遍 addAttrDelta，验证 STA / STL 确实改变了后端状态。
 * 运行：node tests/attribute-keys.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'nba-perfect-player.html'), 'utf8');

const ATTR_KEYS = ['threePT', 'MID', 'FIN', 'DNK', 'HAN', 'PAS', 'PDEF', 'IDEF', 'BLK', 'REB', 'ATH', 'STR', 'CLU'];
const SEASON_MOD_KEYS = ['injuryRiskBonus', 'formVariance', 'teamChemistry', 'moraleBonus', 'mediaPressure', 'staminaLoad'];

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

/** 取出 var NAME = { ... }; 的对象字面量（用于别名表） */
function extractVarObject(source, name) {
  const start = source.indexOf('var ' + name + ' = {');
  if (start < 0) throw new Error('找不到对象: ' + name);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1) + ';';
    }
  }
  throw new Error('对象大括号不配对: ' + name);
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('属性键一致性测试');

/* ---------- 1. 静态扫描：所有被写入的属性/修正键 ---------- */
function collectKeys(regex) {
  const out = new Map();
  for (const m of html.matchAll(regex)) {
    const key = m[1];
    if (!out.has(key)) out.set(key, 0);
    out.set(key, out.get(key) + 1);
  }
  return out;
}

const attrDeltaKeys = collectKeys(/addAttrDelta\(\s*'([A-Za-z0-9_]+)'/g);
const trainingKeys = new Map();
for (const m of html.matchAll(/applyTrainingOutcome\(\s*'([A-Za-z0-9_]+)'\s*,\s*'([A-Za-z0-9_]+)'/g)) {
  [m[1], m[2]].forEach((k) => trainingKeys.set(k, (trainingKeys.get(k) || 0) + 1));
}
const seasonModKeys = collectKeys(/addSeasonMod\(\s*'([A-Za-z0-9_]+)'/g);

check('addAttrDelta 用到的键都能落地（真实属性或别名）', () => {
  const aliasSource = extractVarObject(html, 'ATTR_KEY_ALIAS');
  const aliasKeys = [...aliasSource.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
  const unknown = [...attrDeltaKeys.keys()].filter((k) => ATTR_KEYS.indexOf(k) < 0 && aliasKeys.indexOf(k) < 0);
  assert.equal(unknown.join(','), '', '这些键写了但不会生效：' + unknown.join(','));
  assert.ok(attrDeltaKeys.has('STA'), '剧情里的耐力键应当存在（它现在有正式映射）');
});

check('训练专项的每个键也都能落地', () => {
  const aliasSource = extractVarObject(html, 'ATTR_KEY_ALIAS');
  const aliasKeys = [...aliasSource.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
  const unknown = [...trainingKeys.keys()].filter((k) => ATTR_KEYS.indexOf(k) < 0 && aliasKeys.indexOf(k) < 0);
  assert.equal(unknown.join(','), '', '训练专项里这些键不会生效：' + unknown.join(','));
});

check('赛季修正键都在引擎认识的 6 项里', () => {
  const unknown = [...seasonModKeys.keys()].filter((k) => SEASON_MOD_KEYS.indexOf(k) < 0);
  assert.equal(unknown.join(','), '', '不认识的赛季修正键：' + unknown.join(','));
});

check('别名表自身的结构正确：要么落赛季修正，要么落真实属性', () => {
  const aliasSource = extractVarObject(html, 'ATTR_KEY_ALIAS');
  assert.ok(aliasSource.indexOf('seasonMod') >= 0 && aliasSource.indexOf('staminaLoad') >= 0, 'STA 应落到体能负荷');
  assert.ok(/"?'?label'?":/.test(aliasSource) || aliasSource.indexOf('label:') >= 0, '每个别名都要有给玩家看的说法');
  assert.ok(aliasSource.indexOf("attr: 'ATH'") >= 0, 'STL 应落到运动');
});

/* ---------- 2. 行为验证：真的改了后端状态 ---------- */
const aliasSource = extractVarObject(html, 'ATTR_KEY_ALIAS');
const attrCode = [
  'var ATTR_TRAINING_CAP = 99;',
  'var ATTR_SOFT_CAP = 120;',
  'function clampAttrVal(v) { return Math.max(25, Math.min(ATTR_SOFT_CAP, Math.round(v))); }',
  aliasSource,
  extractFunction(html, 'addAttrDelta'),
].join('\n');

function makeApi() {
  const STATE = { attrs: {}, career: { nextSeasonMods: {} } };
  const modCalls = [];
  const fn = new Function('STATE', 'ATTR_KEYS', 'addSeasonMod', attrCode + '\nreturn { addAttrDelta, STATE };');
  const api = fn(STATE, ATTR_KEYS, (key, delta, lo, hi) => {
    modCalls.push([key, delta]);
    const mods = STATE.career.nextSeasonMods;
    mods[key] = Math.max(lo, Math.min(hi, (mods[key] || 0) + delta));
    return mods[key];
  });
  return { ...api, modCalls };
}

check('耐力（STA）真的会落到体能负荷上，而且是"耐力越好负荷越低"', () => {
  const api = makeApi();
  api.addAttrDelta('STA', 1);
  assert.equal(api.modCalls.length, 1, '应调用一次赛季修正');
  assert.equal(api.modCalls[0][0], 'staminaLoad', '应落到体能负荷');
  assert.equal(api.STATE.career.nextSeasonMods.staminaLoad, -1, '耐力+1 应让体能负荷 -1');
  api.addAttrDelta('STA', 2);
  assert.equal(api.STATE.career.nextSeasonMods.staminaLoad, -3, '耐力累加应继续降低负荷');
});

check('抢断（STL）落到运动上，不会再被静默丢掉', () => {
  const api = makeApi();
  api.addAttrDelta('STL', 2);
  assert.equal(api.STATE.attrs.ATH, 52, '抢断特训的次要收益应加在运动上（50 → 52）');
});

check('真实属性照旧，未知键依旧安静忽略', () => {
  const api = makeApi();
  api.addAttrDelta('PAS', 3);
  assert.equal(api.STATE.attrs.PAS, 53);
  api.addAttrDelta('XYZ', 5);
  assert.equal(api.STATE.attrs.XYZ, undefined, '未知键不应污染 attrs');
  assert.equal(api.modCalls.length, 0, '未知键不该动赛季修正');
});

check('剧情加成可以突破 99，但仍受软上界 120 约束（手动加点另有一套 99 的封顶）', () => {
  const api = makeApi();
  api.STATE.attrs.PAS = 99;
  api.addAttrDelta('PAS', 5);
  assert.equal(api.STATE.attrs.PAS, 104, '剧情属于后端加成，可以过 99');
  api.STATE.attrs.PAS = 119;
  api.addAttrDelta('PAS', 5);
  assert.equal(api.STATE.attrs.PAS, 120, '软上界 120 兜底，不会失控：' + api.STATE.attrs.PAS);
});

/* ---------- 3. 选项提示与后端说法一致 ---------- */
check('选项提示里 STA / STL 显示成人话，而不是原始键名', () => {
  const labelSource = [
    'var EVENT_CHOICE_PREDICTION_LABELS = { staminaLoad:"体能负荷" };',
    'function attrCN(k) { return ({ threePT:"三分", PAS:"传球", ATH:"运动" })[k] || k; }',
    aliasSource,
    extractFunction(html, 'eventChoiceEffectLabel'),
  ].join('\n');
  const label = new Function(labelSource + '\nreturn eventChoiceEffectLabel;')();
  assert.equal(label('STA', true), '耐力');
  assert.equal(label('STL', true), '抢断');
  assert.equal(label('PAS', true), '传球');
  assert.equal(label('staminaLoad', false), '体能负荷', '赛季修正仍用原有说法');
});

/* ---------- 4. 跨位置衰减与位置平均值 ---------- */
const penaltyCode = [
  'var POS_TRANSFER_DISCOUNT = ' + (/var POS_TRANSFER_DISCOUNT = ([0-9.]+)/.exec(html) || [0, 0.6])[1] + ';',
  extractFunction(html, 'getPosPenalty'),
].join('\n');

check('跨位置衰减：同位置不衰减，跨位置只扣掉六成差距', () => {
  const POS_AVG = { PG: { REB: 52 }, C: { REB: 77 } };
  const fn = new Function('SIM_CONFIG', penaltyCode + '\nreturn getPosPenalty;')({ POS_AVG });
  assert.equal(fn('PG', 'PG', 'REB'), 1, '同位置应无衰减');
  const cross = fn('PG', 'C', 'REB');
  const oldPenalty = 52 / 77;
  assert.ok(cross > oldPenalty, '应比旧版更宽松：' + cross + ' vs ' + oldPenalty.toFixed(3));
  assert.ok(Math.abs(cross - (1 - (1 - oldPenalty) * 0.6)) < 1e-9, '应只扣掉六成差距：' + cross);
  assert.ok(cross < 1, '跨位置仍要有代价');
  assert.equal(fn('PG', 'C', '不存在'), 1, '没有平均值的属性不衰减');
});

check('位置平均属性按当前名单实时重算，不再依赖写死的表', () => {
  const code = [
    'var SIM_CONFIG = arguments[0];',
    'var NBA2K_DATA = arguments[1];',
    extractFunction(html, 'refreshPositionAverages'),
    'return refreshPositionAverages();',
  ].join('\n');
  const POS_AVG = { PG: {}, SG: {}, SF: {}, PF: {}, C: {} };
  const league = {
    AAA: [
      { pos: 'C', REB: 90, BLK: 80 },
      { pos: 'C', REB: 70, BLK: 60 },
      { pos: 'PG / SG', REB: 50, BLK: 40 },
      { pos: 'SG', REB: 55, BLK: 45 },
      { pos: 'SF', REB: 60, BLK: 50 },
      { pos: 'PF', REB: 65, BLK: 55 },
    ],
    _draftClass2026Applied: true,
  };
  const ok = new Function(code)({ POS_AVG, ATTR_LIST: ['REB', 'BLK'] }, league);
  assert.equal(ok, true, '应成功重算');
  assert.equal(POS_AVG.C.REB, 80, '中锋篮板平均应为 (90+70)/2：' + POS_AVG.C.REB);
  assert.equal(POS_AVG.C.BLK, 70);
  assert.equal(POS_AVG.PG.REB, 50, '位置计算应按主位置归组（PG / SG → PG）');
  assert.equal(POS_AVG.SF.REB, 60, '其他位置也要重算：' + POS_AVG.SF.REB);
  assert.equal(POS_AVG.ZZ, undefined, '未知位置不该被创建');
});

check('名单里没出现的位置保持原值，不会被清成 0', () => {
  const code = [
    'var SIM_CONFIG = arguments[0];',
    'var NBA2K_DATA = arguments[1];',
    extractFunction(html, 'refreshPositionAverages'),
    'return refreshPositionAverages();',
  ].join('\n');
  const POS_AVG = { PG: { REB: 50 }, SG: { REB: 51 }, SF: { REB: 52 }, PF: { REB: 53 }, C: { REB: 54 }, ZZ: { REB: 99 } };
  // ZZ 不是联盟位置，PF/C 这次没出现在名单里
  const league = { AAA: [{ pos: 'PG', REB: 60 }, { pos: 'SG', REB: 62 }, { pos: 'SF', REB: 64 }] };
  const ok = new Function(code)({ POS_AVG, ATTR_LIST: ['REB'] }, league);
  assert.equal(ok, false, '只有 3 个位置有球员时不算完整刷新');
  assert.equal(POS_AVG.PG.REB, 60);
  assert.equal(POS_AVG.SF.REB, 64);
  assert.equal(POS_AVG.C.REB, 54, '没出现在名单里的位置保持原值');
  assert.equal(POS_AVG.ZZ.REB, 99, '非联盟位置不受影响');
});

console.log('\n全部通过：' + passed + ' 项');
