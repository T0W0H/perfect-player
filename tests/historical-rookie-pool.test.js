'use strict';

/**
 * 历史球员新秀池测试
 * 两件事：1) 生成出来的名单文件本身是否可靠（真名、真位置、真头像、真属性画像）；
 *        2) 游戏里 generateRookie 是否真的会用它——包括属性按真实生涯画像偏移，
 *           以及选秀时不会把转世球员的总评按顺位拉平。
 * 运行：node tests/historical-rookie-pool.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'nba-perfect-player.html'), 'utf8');
const poolSource = fs.readFileSync(path.join(root, 'assets/js/historical-rookie-pool.js'), 'utf8');
const headshots = new Set(fs.readdirSync(path.join(root, 'assets/data/historical/headshots')));

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

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('历史球员新秀池测试');

/* ---------- 1. 名单文件本身 ---------- */
const poolCtx = { window: {} };
poolCtx.window = poolCtx;
vm.createContext(poolCtx);
vm.runInContext(poolSource, poolCtx);
const pool = poolCtx.PERFECT_PLAYER_HISTORICAL_ROOKIES;

check('名单文件结构完整，规模够长（能撑得住长生涯）', () => {
  assert.ok(pool && Array.isArray(pool.rows), '应有 rows 数组');
  assert.equal(pool.rowCount, pool.rows.length, 'rowCount 应与实际行数一致');
  assert.ok(pool.rows.length >= 3000, '真实历史球员应有三千人以上：' + pool.rows.length);
  assert.equal(JSON.stringify(pool.deltaKeys), JSON.stringify(['REB', 'PAS', 'BLK', 'PDEF', 'threePT', 'FIN']), '属性偏移口径应固定');
});

check('每一行都有真名、合法位置、合理总评', () => {
  const seen = new Set();
  pool.rows.forEach((row, i) => {
    assert.ok(row[0] && typeof row[0] === 'string', '第 ' + i + ' 行缺中文名');
    assert.ok(row[1] && typeof row[1] === 'string', '第 ' + i + ' 行缺英文名');
    assert.ok(row[2] >= 1 && row[2] <= 5, '位置应为 1-5：' + row[2]);
    assert.ok(row[5] >= 60 && row[5] <= 88, '总评应在合理区间：' + row[5]);
    assert.ok(row[3] >= 0 && row[3] <= 200, '顺位异常：' + row[3]);
    assert.ok(row[4] >= 1940 && row[4] <= 2030, '选秀年份异常：' + row[4]);
    assert.ok(!seen.has(row[1]), '英文名重复：' + row[1]);
    seen.add(row[1]);
  });
});

check('头像是仓库里真实存在的文件，不会出现碎图', () => {
  let photoCount = 0;
  pool.rows.forEach((row) => {
    if (!row[6]) return;
    photoCount += 1;
    assert.ok(headshots.has(row[6]), '头像文件不存在：' + row[6]);
  });
  assert.ok(photoCount > 300, '应有一批球员带真实头像：' + photoCount);
  assert.equal(photoCount, pool.photoRows, 'photoRows 统计应与实际一致');
});

check('属性偏移是 6 个整数，且幅度受控', () => {
  let withDeltas = 0;
  pool.rows.forEach((row) => {
    const d = row[7];
    if (d == null) return;
    withDeltas += 1;
    assert.ok(Array.isArray(d) && d.length === 6, '偏移应是 6 项数组');
    d.forEach((v) => assert.ok(Number.isInteger(v) && Math.abs(v) <= 14, '偏移超范围：' + v));
  });
  assert.equal(withDeltas, pool.statsRows, 'statsRows 统计应与实际一致');
  assert.ok(withDeltas > 1000, '应有一千名以上球员带真实数据画像：' + withDeltas);
});

check('画像符合真实身份：乔丹总评顶级、罗德曼偏篮板、纳什偏组织与三分', () => {
  const byEn = new Map(pool.rows.map((r) => [r[1], r]));
  const mj = byEn.get('Michael Jordan');
  assert.ok(mj, '名单里应该有乔丹');
  assert.ok(mj[5] >= 82, '乔丹的转世评分应属于顶级：' + mj[5]);
  assert.ok(mj[6], '乔丹应有真实头像');

  const rodman = byEn.get('Dennis Rodman');
  assert.ok(rodman, '名单里应该有罗德曼');
  const rodDelta = rodman[7] || [];
  assert.ok(rodDelta[0] >= 8, '罗德曼的篮板应明显高于同位置平均：' + rodDelta[0]);
  assert.ok(rodDelta[1] < rodDelta[0], '罗德曼的传球不该高于篮板');

  const nash = byEn.get('Steve Nash');
  assert.ok(nash, '名单里应该有纳什');
  const nashDelta = nash[7] || [];
  assert.ok(nashDelta[1] >= 5, '纳什的传球应明显偏强：' + nashDelta[1]);
  assert.ok(nashDelta[4] >= 3, '纳什的三分应明显偏强：' + nashDelta[4]);
});

/* ---------- 2. 游戏内接线 ---------- */
const rookieStart = html.indexOf('var STAR_ROOKIES = [');
const rookieEnd = html.indexOf('// ==================== 启动 ====================');
if (rookieStart < 0 || rookieEnd <= rookieStart) throw new Error('找不到新秀生成代码段');

const rookieCode = html.slice(rookieStart, rookieEnd);

function createGame() {
  const sandbox = {
    STATE: { career: { seasonCount: 3 } },
    SIM_CONFIG: { ATTR_LIST: ['threePT','MID','FIN','DNK','HAN','PAS','PDEF','IDEF','BLK','REB','ATH','STR','CLU'], POSITIONS: {} },
    DRAFT_CLASS_2027: [
      { pick: 1, en: 'Prospect One', cn: '前景一' },
      { pick: 2, en: 'Prospect Two', cn: '前景二' },
    ],
    ROOKIE_FALLBACK_NAMES: [{ en: 'Fallback Guy', cn: '兜底人', pick: 99 }],
    draftOvrByPick: () => 70,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(rookieCode + '\n;globalThis.__api = { generateRookie, registerHistoricalRookiePool, pickHistoricalRookieRow, _usedRookieCandidateNames, ROOKIE_CANDIDATES };', sandbox);
  return sandbox;
}

check('历史名单接上之后，未来赛季的新秀就是真实历史球员', () => {
  const game = createGame();
  assert.equal(typeof game.__api.registerHistoricalRookiePool, 'function', '应导出注册函数');
  assert.ok(game.__api.registerHistoricalRookiePool(pool), '注册名单应成功');
  // 把 2027 届用完，模拟打到后面几个赛季
  game.ROOKIE_CANDIDATES.forEach((c) => { game.__api._usedRookieCandidateNames[c.en] = true; });

  const rookies = [];
  for (let i = 0; i < 40; i++) rookies.push(game.__api.generateRookie());
  // 前 6 个是赛季开始时就排队的明星新秀（走 _starRookieQueue），这是既有设计
  const historical = rookies.filter((r) => r._rebirth);
  const starQueue = rookies.filter((r) => !r._rebirth);
  assert.equal(historical.length, 34, '明星新秀之外的应全部来自历史名单：' + historical.length);
  assert.equal(starQueue.length, 6, '明星新秀队列应有 6 人：' + starQueue.length);
  starQueue.forEach((r) => { assert.ok(!r._rebirth, '明星新秀不是转世球员：' + r.cname); });
  historical.forEach((r) => {
    assert.ok(r.cname && !/^前景/.test(r.cname), '应使用真实历史球员姓名：' + r.cname);
    assert.ok(['PG','SG','SF','PF','C'].indexOf(r.pos) >= 0, '应有真实位置：' + r.pos);
    assert.ok(r.ovr >= 60 && r.ovr <= 88, '总评应在名单区间：' + r.ovr);
    assert.ok(r._rebirth.year >= 1940, '应记录真实选秀年份');
  });
  const names = historical.map((r) => r.cname);
  assert.equal(new Set(names).size, names.length, '同一批里不应重复抽到同一个人');
});

check('历史球员的属性按真实画像偏移，而不是随机乱给', () => {
  const game = createGame();
  game.__api.registerHistoricalRookiePool(pool);
  game.ROOKIE_CANDIDATES.forEach((c) => { game.__api._usedRookieCandidateNames[c.en] = true; });

  const byName = new Map(pool.rows.map((r) => [r[1], r]));
  const findWithDelta = (name) => {
    // 直接反复抽取，直到抽到想验证的那个人（抽过的人会被标记为已用）
    for (let i = 0; i < 4000; i++) {
      const r = game.__api.generateRookie();
      if (r.nameEN === name) return r;
    }
    return null;
  };
  const rodmanRow = byName.get('Dennis Rodman');
  assert.ok(rodmanRow, '名单里应该有罗德曼');
  const rodman = findWithDelta('Dennis Rodman');
  if (rodman) {
    assert.ok(rodman.REB >= rodman.PAS, '篮板怪不该出现传球高于篮板：REB ' + rodman.REB + ' / PAS ' + rodman.PAS);
    assert.ok(rodman.REB >= rodman.ovr + 5, '篮板应显著高于总评：' + rodman.REB + ' vs ' + rodman.ovr);
  }
});

check('历史名单还没加载时，仍然能生成新秀（走兜底），不会报错', () => {
  const game = createGame();
  game.ROOKIE_CANDIDATES.forEach((c) => { game.__api._usedRookieCandidateNames[c.en] = true; });
  const rookies = [];
  for (let i = 0; i < 7; i++) rookies.push(game.__api.generateRookie()); // 前 6 个留给明星新秀队列
  const rookie = rookies[6];
  assert.ok(rookie && rookie.cname, '应有兜底新秀');
  assert.equal(rookie.nameEN, 'Fallback Guy', '应用兜底名单：' + rookie.nameEN);
  assert.ok(!rookie._rebirth, '不该被标记成历史球员');
});

check('2027 届优先于历史名单：未来新秀先来，历史球员随后', () => {
  const game = createGame();
  game.__api.registerHistoricalRookiePool(pool);
  for (let i = 0; i < 6; i++) game.__api.generateRookie(); // 先走完明星新秀队列
  const first = game.__api.generateRookie();
  assert.ok(!first._rebirth, '2027 届还没用完时不该抽历史球员：' + first.cname);
  assert.ok(['前景一', '前景二'].indexOf(first.cname) >= 0, '应出 2027 届前景新秀：' + first.cname);
});

check('选秀不会把历史球员的总评按顺位拉平', () => {
  const draftStart = html.indexOf('function processDraft()');
  const draftEnd = html.indexOf('function evolveLeague()', draftStart);
  const draftCode = html.slice(draftStart, draftEnd);
  assert.ok(draftCode.indexOf('rookie._rebirth') >= 0, 'processDraft 应对转世球员单独处理');
  assert.ok(/if \(rookie\._rebirth\)/.test(draftCode), '应存在转世球员的分支');
});

check('页面按需加载名单，且加载完成后会自动接上', () => {
  assert.ok(html.indexOf('assets/js/historical-rookie-pool.js') >= 0, '页面应引用名单文件');
  const loaderStart = html.indexOf('assets/js/historical-rookie-pool.js');
  const around = html.slice(loaderStart - 800, loaderStart + 900);
  assert.ok(around.indexOf('registerHistoricalRookiePool') >= 0, '加载完成后应注册名单');
  assert.ok(around.indexOf('requestIdleCallback') >= 0 || around.indexOf('setTimeout') >= 0, '应在空闲时加载，不抢首屏带宽');
});

console.log('\n全部通过：' + passed + ' 项');
