'use strict';

/**
 * 本地名单覆盖后的重新校准测试
 * 场景：assets/data/local/nba2k-data.local.js 会在页面最后把整队人换掉
 * （本地调试用，不在仓库里），如果照着它自己的属性值走，2025-26 校准数据
 * 就会被冲掉——线上和本地看到的球员数值会不一样。
 * 这里用一份伪造的本地池模拟“整队换人”，验证重新调用校准函数后属性回到校准值。
 * 运行：node tests/local-pool-rerating.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const roster = fs.readFileSync(path.join(root, 'assets/js/hupu/script-01-2678-5hu3djrc-upload-1783494754597-12.js'), 'utf8');
const ratings = fs.readFileSync(path.join(root, 'assets/js/current-player-ratings-2026.js'), 'utf8');

function boot() {
  const context = { window: {} };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(roster + '\n' + ratings + '\n;globalThis.__DATA = NBA2K_DATA;', context);
  return context;
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('本地名单覆盖后的重新校准测试');

const ctx = boot();
const DATA = ctx.__DATA;
const team = 'MIN';
const before = DATA[team].find((p) => p.name === 'Rudy Gobert');
const calibrated = { ovr: before.ovr, REB: before.REB, BLK: before.BLK, IDEF: before.IDEF, threePT: before.threePT };

check('校准函数被挂到 window 上，可以被重新调用', () => {
  assert.equal(typeof ctx.window.applyCurrentPlayerRatings2026, 'function', '应导出 applyCurrentPlayerRatings2026');
});

check('初始加载后，戈贝尔是 2K26 的数据（防守支柱）', () => {
  // 唯一评分来源是 2K26：戈贝尔篮板 84（2K 的 off 83 / def 84 加权），内防 94、盖帽 77。
  // 不再断言旧刻度的 A+（≥95），那是按模拟器拟合的老尺子，已经被 2K 刻度取代。
  assert.equal(calibrated.REB, 84, '戈贝尔篮板应是 2K26 的值：' + calibrated.REB);
  assert.ok(calibrated.IDEF >= 90, '戈贝尔内防应是顶级：' + calibrated.IDEF);
  assert.equal(before.ratingSource, 'nba-2k26', '应标出来源');
});

check('伪造本地名单整队覆盖后，属性确实被冲掉（复现线上/本地不一致）', () => {
  DATA[team] = DATA[team].map((p) => Object.assign({}, p, {
    ovr: 70, REB: 55, BLK: 55, IDEF: 55, threePT: 55,
    ratingSeason: undefined, ratingBasis: undefined,
  }));
  const hit = DATA[team].find((p) => p.name === 'Rudy Gobert');
  assert.equal(hit.REB, 55, '覆盖后应变成本地池的自带数值');
});

check('重新调用校准后，属性回到 2025-26 校准值', () => {
  ctx.window.applyCurrentPlayerRatings2026();
  const after = DATA[team].find((p) => p.name === 'Rudy Gobert');
  assert.deepEqual(
    { ovr: after.ovr, REB: after.REB, BLK: after.BLK, IDEF: after.IDEF, threePT: after.threePT },
    calibrated,
    '重新校准后应与线上完全一致'
  );
  assert.equal(after.ratingSeason, '2025-26', '应重新打上赛季标记');
  assert.ok(after.ratingBasis, '应重新带上评级依据');
});

check('全部 30 支球队都会被重新校准，而不是只有被覆盖的那一支', () => {
  const reapplied = [];
  Object.keys(DATA).forEach((t) => {
    (DATA[t] || []).forEach((p) => { if (p.ratingSeason === '2025-26') reapplied.push(t); });
  });
  assert.equal(Object.keys(DATA).length, 30, '30 支球队都应存在');
  assert.ok(reapplied.length > 400, '重新校准应覆盖全联盟：' + reapplied.length);
});

check('重复调用是幂等的（多次 onload 也不会把数值越改越偏）', () => {
  const sample = () => JSON.stringify(DATA[team].map((p) => [p.name, p.ovr, p.REB]));
  const first = sample();
  ctx.window.applyCurrentPlayerRatings2026();
  ctx.window.applyCurrentPlayerRatings2026();
  assert.equal(sample(), first, '多次调用结果必须一致');
});

console.log('\n全部通过：' + passed + ' 项');
