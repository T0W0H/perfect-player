'use strict';

/**
 * 数据王成就测试
 * 用最小 DOM 桩把 assets/js/perfect-player-enhancements.js 跑起来，
 * 验证：六项数据王各自能解锁、「同季多项」只按单赛季统计（不跨赛季相加）、
 * 旧存档里只有 label 的荣誉也能识别，以及不满足时不会误解锁。
 * 运行：node tests/season-king-achievements.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/perfect-player-enhancements.js'), 'utf8');

/** 极简 localStorage 桩 */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    style: { setProperty() {}, removeProperty() {} },
    children: [],
    className: '',
    textContent: '',
    _html: '',
    onclick: null,
    classList: { add() {}, remove() {}, contains() { return false; } },
    appendChild(child) { this.children.push(child); return child; },
    removeChild() {}, remove() {},
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); },
  });
  return el;
}

/** 起一个带 DOM 桩的沙箱，加载成就模块 */
function createModule() {
  const storage = makeStorage();
  const sandbox = {
    localStorage: storage,
    document: {
      readyState: 'complete',
      body: makeElement('body'),
      head: makeElement('head'),
      createElement: makeElement,
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {}, removeEventListener() {},
    },
    navigator: {},
    setTimeout() { return 0; },
    clearTimeout() {},
    requestAnimationFrame() { return 0; },
    getHupuDisplayName: () => '我的球员',
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'perfect-player-enhancements.js' });
  const PP_FX = sandbox.PP_FX;
  PP_FX._suppressAchievementPopups = true;   // 测试不关心弹窗动画
  return { PP_FX, storage, sandbox };
}

/** 把 STATE 注入沙箱后跑一次成就同步，返回解锁的成就 id */
function syncInto(mod, state) {
  mod.sandbox.STATE = state;
  mod.PP_FX.syncAchievements();
  return unlockedIds(mod.storage);
}

function unlockedIds(storage) {
  const raw = storage.getItem('pp_achievements_v1');
  return raw ? Object.keys(JSON.parse(raw)) : [];
}

/** 造一个带奖项的 STATE；kingsOf 返回若干赛季的 data-king act 列表 */
function buildState(seasons, currentKings) {
  const acts = ['scoring', 'rebound', 'assist', 'three', 'steal', 'block'];
  const labels = { scoring: '得分王', rebound: '篮板王', assist: '助攻王', three: '三分王', steal: '抢断王', block: '盖帽王' };
  // 当前赛季的奖项没有 seasonNum（与主引擎一致，同步时按当前赛季号归组）
  const toAward = (act) => ({
    act,
    label: labels[act],
    winner: '我的球员',
    isUser: true,
    userRank: '🥇 第一名',
  });
  return {
    gameId: Date.now().toString(36) + '-test',
    attrs: {},
    finalOVR: 90,
    careerTeam: 'AAA',
    career: {
      seasonCount: seasons.length,
      seasons: seasons.map((kings, i) => ({
        seasonNum: i + 1,
        // 归档后的荣誉只剩 label（没有 act），这是旧存档的形态
        awards: kings.map((k) => ({ seasonNum: i + 1, label: labels[k], emoji: '🏅' })),
        playerStats: { games: 82, pts: 1800, reb: 400 },
      })),
      honors: [],
    },
    season: { awards: currentKings.map(toAward), playerStats: { games: 0 } },
  };
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('数据王成就测试');

check('六项数据王都有对应的成就定义，且与奖项 act 一一对应', () => {
  const { PP_FX } = createModule();
  const map = {
    scoring: 'king_scoring', rebound: 'king_rebound', assist: 'king_assist',
    three: 'king_three', steal: 'king_steal', block: 'king_block',
  };
  Object.keys(map).forEach((act) => {
    assert.equal(PP_FX.classifyAchievementAward({ act }, ''), 'king' + act[0].toUpperCase() + act.slice(1),
      act + ' 应被识别成数据王');
    assert.ok(PP_FX.ACHIEVEMENTS.some((a) => a.id === map[act]), map[act] + ' 成就应存在');
  });
  assert.ok(PP_FX.ACHIEVEMENTS.some((a) => a.id === 'king_triple'), '三王同季成就应存在');
  assert.ok(PP_FX.ACHIEVEMENTS.some((a) => a.id === 'king_all'), '六王加身成就应存在');
});

check('单赛季拿一项数据王即解锁对应成就', () => {
  const mod = createModule();
  const ids = syncInto(mod, buildState([], ['rebound']));
  assert.ok(ids.includes('king_rebound'), '篮板王应解锁');
  assert.ok(!ids.includes('king_scoring'), '没拿得分王不该解锁');
  assert.ok(!ids.includes('king_triple'), '只拿一项不该有三王同季');
});

check('同一赛季三项数据王 → 三王同季（六王加身仍锁着）', () => {
  const mod = createModule();
  const ids = syncInto(mod, buildState([], ['scoring', 'assist', 'three']));
  ['king_scoring', 'king_assist', 'king_three', 'king_triple'].forEach((id) => {
    assert.ok(ids.includes(id), id + ' 应解锁');
  });
  assert.ok(!ids.includes('king_all'), '三项不该给六王加身');
});

check('同一赛季六项全包 → 六王加身', () => {
  const mod = createModule();
  const ids = syncInto(mod, buildState([], ['scoring', 'rebound', 'assist', 'three', 'steal', 'block']));
  assert.ok(ids.includes('king_all'), '六王加身应解锁');
});

check('跨赛季各拿两项不叠加：组合成就只看单赛季', () => {
  const mod = createModule();
  // 两季各 2 项，加起来 4 项，但没有任何一个赛季达到 3 项
  const ids = syncInto(mod, buildState([['scoring', 'rebound'], ['assist', 'three']], []));
  ['king_scoring', 'king_rebound', 'king_assist', 'king_three'].forEach((id) => {
    assert.ok(ids.includes(id), id + ' 应解锁');
  });
  assert.ok(!ids.includes('king_triple'), '两季各两项不能凑成三王同季');
});

check('旧存档只有 label 的荣誉也能识别出数据王', () => {
  const mod = createModule();
  assert.ok(syncInto(mod, buildState([['steal']], [])).includes('king_steal'), '归档荣誉（只有 label）也应解锁抢断王');
});

check('一个赛季拿满三项才给组合成就，顺序无关', () => {
  const mod = createModule();
  assert.ok(syncInto(mod, buildState([], ['block', 'steal', 'scoring'])).includes('king_triple'), '三项（乱序）应解锁三王同季');
});

check('同一奖项重复出现不会把赛季数凑多', () => {
  const mod = createModule();
  const state = buildState([], []);
  state.season.awards = [
    { act: 'scoring', label: '得分王', winner: '我的球员', isUser: true, userRank: '🥇 第一名' },
    { act: 'scoring', label: '得分王', winner: '我的球员', isUser: true, userRank: '🥇 第一名' },
  ];
  const ids = syncInto(mod, state);
  assert.ok(ids.includes('king_scoring'), '得分王应解锁');
  assert.ok(!ids.includes('king_triple'), '重复条目不算三项');
});

check('NPC 拿数据王时用户不会误解锁', () => {
  const mod = createModule();
  const state = buildState([], []);
  state.season.awards = [{ act: 'block', label: '盖帽王', winner: '别的人', winnerEN: 'Other Guy', isUser: false }];
  const ids = syncInto(mod, state);
  assert.ok(!ids.includes('king_block'), '不是自己拿的不该解锁');
});

console.log('\n全部通过：' + passed + ' 项');
