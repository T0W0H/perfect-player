'use strict';

/**
 * 奖项页渲染测试
 * 数据王（得分/篮板/助攻/三分/抢断/盖帽）以前在 calcSeasonAwards 里算得出来，
 * 但奖项页把六行都排在最后，而每行有 idx*1.0s 的入场延迟——
 * 15 个奖项时最后一行要等 14 秒才浮现，等于「看不到数据王」。
 * 这里把 showAwardsScreen 真跑一遍（桩掉 DOM），守住两件事：
 *   1. 六项数据王都真的渲染出来
 *   2. 入场延迟必须有上限，不能让末尾奖项长时间隐身
 * 运行：node tests/awards-screen.test.js
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

/* ---------- 用假奖项跑一遍渲染 ---------- */
const AWARDS = [
  { act: 'mvp', label: 'MVP', winner: '某巨星', winnerEN: 'Star One', userRank: '第 5 名', isUser: false },
  { act: 'dpoy', label: 'DPOY', winner: '某中锋', winnerEN: 'Big Man', userRank: '第 3 名', isUser: false },
  { act: 'mip', label: '进步最快球员', winner: '某新人', winnerEN: 'Rookie Guy', userRank: '进入评选', isUser: false },
  { act: 'allStar', label: '全明星', winner: '某前锋', winnerEN: 'Forward X', userRank: '第 12 名', isUser: false },
  { act: 'sixthman', label: '最佳第六人', winner: '某替补', winnerEN: 'Bench Guy', userRank: '第 2 名', isUser: false },
  { act: 'allNBA', label: '最佳阵容', winner: '甲、乙、丙、丁、戊', winnerEN: 'A,B,C,D,E', userRank: '候补（第 7 名）', isUser: false, isList: true },
  { act: 'allDefense', label: '最佳防守阵容', winner: '甲、乙、丙、丁、戊', winnerEN: 'A,B,C,D,E', userRank: '未入选', isUser: false, isList: true },
  { act: 'scoring', label: '得分王', winner: '某得分手', winnerEN: 'Scorer Guy', userRank: '第 4 名', isUser: false, summary: '场均 31.2 分 · 你场均 27.4' },
  { act: 'rebound', label: '篮板王', winner: '某中锋', winnerEN: 'Board Man', userRank: '第 9 名', isUser: false, summary: '场均 13.1 篮板 · 你场均 8.2' },
  { act: 'assist', label: '助攻王', winner: '某后卫', winnerEN: 'Pass Guy', userRank: '第 6 名', isUser: false, summary: '场均 11.4 助攻 · 你场均 9.9' },
  { act: 'three', label: '三分王', winner: '某射手', winnerEN: 'Shoot Guy', userRank: '第 8 名', isUser: false, summary: '场均 3.6 三分 · 你场均 3.1' },
  { act: 'steal', label: '抢断王', winner: '某快手', winnerEN: 'Steal Guy', userRank: '第 2 名', isUser: false, summary: '场均 2.2 抢断 · 你场均 2.0' },
  { act: 'block', label: '盖帽王', winner: '某盖帽手', winnerEN: 'Block Guy', userRank: '第 5 名', isUser: false, summary: '场均 2.9 盖帽 · 你场均 2.1' },
];

function render(awards) {
  let captured = '';
  const code = [
    "var STATE = { season: { awards: __AWARDS, standings: null }, careerTeam: 'LAL', career: { seasonCount: 3 }, position: 'SG' };",
    'var window = {};',
    'function trackEvent() {}',
    'function trackExposureOnce() {}',
    'function maybeShowFirstSixtyWinCelebration() { return false; }',
    'function getHupuDisplayName() { return "我的球员"; }',
    'function getHupuAvatarUrl() { return ""; }',
    'function getPlayerHeadshotStyle() { return ""; }',
    'function showScreen() {}',
    'function getConferenceSeed() { return 3; }',
    'function html(id, content) { var el = { id: id, set innerHTML(v) { __OUT = v; } }; if (content !== undefined) el.innerHTML = content; return el; }',
    'var document = { getElementById: function() { return { innerHTML: "" }; }, querySelectorAll: function() { return []; } };',
    'var setTimeout = function(fn) { fn(); };',
    extractFunction(html, 'showAwardsScreen'),
    'showAwardsScreen();',
    'return __OUT;',
  ].join('\n');

  captured = new Function('__AWARDS', 'var __OUT = "";' + code)(awards);
  return captured;
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('奖项页渲染测试');

const out = render(AWARDS);

check('六项数据王都渲染出来了', () => {
  ['得分王', '篮板王', '助攻王', '三分王', '抢断王', '盖帽王'].forEach((label) => {
    assert.ok(out.indexOf(label) >= 0, '奖项页缺少「' + label + '」');
  });
});

check('数据王带上了场均说明，不是空壳', () => {
  assert.ok(out.indexOf('场均 31.2 分') >= 0, '得分王应有场均说明');
  assert.ok(out.indexOf('场均 2.9 盖帽') >= 0, '盖帽王应有场均说明');
});

check('传统奖项也还在（没被挤掉）', () => {
  ['最有价值球员', '最佳防守球员', '进步最快球员', '最佳阵容', '最佳防守阵容', '最佳第六人', '全明星'].forEach((label) => {
    assert.ok(out.indexOf(label) >= 0, '奖项页缺少「' + label + '」');
  });
});

check('数据王排在传统奖项之后，顺序没乱', () => {
  const firstKing = out.indexOf('得分王');
  const lastTraditional = out.lastIndexOf('最佳防守阵容');
  assert.ok(firstKing > lastTraditional, '数据王应排在传统奖项之后');
});

check('入场延迟有上限：末尾奖项不能长时间隐身', () => {
  const delays = [...out.matchAll(/animation-delay:([0-9.]+)s/g)].map((m) => Number(m[1]));
  assert.ok(delays.length >= 13, '应渲染出十几行奖项，实际 ' + delays.length);
  const max = Math.max(...delays);
  assert.ok(max <= 3, '最大入场延迟 ' + max + 's 太长，末尾奖项（数据王）会长时间看不见');
});

check('延迟随行数单调递增，但总时长受控', () => {
  const delays = [...out.matchAll(/animation-delay:([0-9.]+)s/g)].map((m) => Number(m[1]));
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] >= delays[i - 1], '延迟应随行号递增');
  const total = Math.max(...delays) + 0.5; // 加动画本身时长
  assert.ok(total <= 3.5, '整页奖项应在 3.5 秒内全部出场，实际 ' + total.toFixed(1) + 's');
});

console.log('\n全部通过：' + passed + ' 项');
