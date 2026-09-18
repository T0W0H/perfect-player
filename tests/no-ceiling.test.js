'use strict';

/**
 * 不封顶回归测试（数据层）
 * 用 tests/current-ratings-simulation.js 同款引擎沙箱跑真实的 generatePlayerStatsNew，
 * 验证用户的要求：属性练过 99 之后，各项数据仍然继续上涨，没有隐藏天花板。
 * 运行：node tests/no-ceiling.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'nba-perfect-player.html'), 'utf8');
const ATTRS = ['threePT','MID','FIN','DNK','HAN','PAS','PDEF','IDEF','BLK','REB','ATH','STR','CLU'];
const GAMES = 1500;

function seededMath(seed) {
  const math = Object.create(Math);
  let state = seed >>> 0;
  math.random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  return math;
}

const statStart = html.indexOf('function simSkill01');
const statEnd = html.indexOf('// ==================== 联盟其他比赛模拟', statStart);
assert.ok(statStart >= 0 && statEnd > statStart, '找不到球员数据引擎');

const ctx = {
  Math: seededMath(20260918),
  console,
  window: {},
  SIM_CONFIG: {
    SHOOTING: {
      threePT: { min:.22, max:.45 }, MID:{ min:.25, max:.52 }, FIN:{ min:.35, max:.70 }, FT:{ min:.52, max:.90 },
    },
    SHOT_DIST: {
      PG:{ threePT:.35, MID:.25, FIN:.25 }, SG:{ threePT:.38, MID:.22, FIN:.22 }, SF:{ threePT:.30, MID:.20, FIN:.30 },
      PF:{ threePT:.20, MID:.18, FIN:.38 }, C:{ threePT:.08, MID:.18, FIN:.48 },
    },
  },
  STATE: { position:'PG', finalOVR:75, careerTeam:null, career:null, season:null },
  calcOVR(attrs) { return Math.round(ATTRS.reduce((sum, key) => sum + Number(attrs[key] || 50), 0) / ATTRS.length); },
  getSimulationPowerBaseline() { return { offense:70, defense:70, athletic:70, depth:70 }; },
  simGaussian(mean, deviation) {
    const u = Math.max(0.000001, ctx.Math.random());
    const v = Math.max(0.000001, ctx.Math.random());
    return mean + Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * deviation;
  },
};
vm.createContext(ctx);
vm.runInContext(html.slice(statStart, statEnd), ctx, { filename:'player-stat-engine.js' });

function flatAttrs(value, position) {
  const out = {};
  ATTRS.forEach((key) => { out[key] = value; });
  if (position === 'C') out.threePT = Math.min(value, 75);
  return out;
}

function average(value, position) {
  const attrsForValue = flatAttrs(value, position);
  ctx.STATE.position = position;
  ctx.STATE.finalOVR = ctx.calcOVR(attrsForValue);
  const total = { pts:0, reb:0, ast:0, stl:0, blk:0, fga:0, fta:0 };
  for (let i = 0; i < GAMES; i++) {
    const line = ctx.generatePlayerStatsNew(attrsForValue, {
      scoreA:116, scoreB:114, pace:99.4, boxScore:null, teamB:{ power:{ defense:70 } },
    }, false);
    Object.keys(total).forEach((key) => { total[key] += line[key] || 0; });
  }
  return Object.fromEntries(Object.entries(total).map(([key, sum]) => [key, sum / GAMES]));
}

const COUNTING_STATS = ['pts', 'reb', 'ast', 'stl', 'blk', 'fga', 'fta'];
let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('不封顶回归测试（每档 ' + GAMES + ' 场）');

[['PG', [99, 105, 120]], ['C', [99, 105, 120]]].forEach(([position, tiers]) => {
  const samples = tiers.map((value) => ({ value, line: average(value, position) }));
  check(position + '：99 → 120 每一项数据都继续上涨', () => {
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1], cur = samples[i];
      COUNTING_STATS.forEach((key) => {
        assert.ok(
          cur.line[key] > prev.line[key],
          position + ' 的 ' + key + ' 没有随属性上涨：' + prev.value + '→' + cur.line[key].toFixed(2) +
            ' / ' + cur.value + '→' + cur.line[key].toFixed(2)
        );
      });
    }
  });
  const line = (s) => s.value + '：' + s.line.pts.toFixed(1) + '分 ' + s.line.reb.toFixed(1) + '板 ' + s.line.ast.toFixed(1) + '助 ' +
    s.line.stl.toFixed(2) + '断 ' + s.line.blk.toFixed(2) + '帽';
  console.log('    ' + samples.map(line).join(' | '));
});

check('位置差异仍然存在（同属性下中锋篮板更多、后卫助攻更多）', () => {
  const pg = average(99, 'PG');
  const center = average(99, 'C');
  assert.ok(center.reb > pg.reb * 1.3, '中锋篮板应明显多于后卫：' + center.reb.toFixed(1) + ' vs ' + pg.reb.toFixed(1));
  assert.ok(pg.ast > center.ast, '后卫助攻应多于中锋：' + pg.ast.toFixed(1) + ' vs ' + center.ast.toFixed(1));
});

check('暴涨是平滑的，没有断层（120 相对 99 的涨幅应在合理区间）', () => {
  const a = average(99, 'PG'), b = average(120, 'PG');
  const ratio = b.pts / a.pts;
  assert.ok(ratio > 1.05, '练到 120 必须看得出来：' + ratio.toFixed(3));
  assert.ok(ratio < 1.5, '增幅不应夸张到失控：' + ratio.toFixed(3));
});

console.log('\n全部通过：' + passed + ' 项');
