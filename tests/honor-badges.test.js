'use strict';

/**
 * 荣誉徽章测试
 * 数据王（得分/篮板/助攻/三分/抢断/盖帽）必须是「赛季荣誉」的一等公民：
 * 有自己的图标、自己的卡片样式，而且出现在赛季总结的小卡片里。
 * 运行：node tests/honor-badges.test.js
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

const constStart = html.indexOf('var DATA_KING_LABELS');
const constEnd = html.indexOf('function getHonorEmoji(');
const constants = html.slice(constStart, constEnd);

const code = [
  constants,
  extractFunction(html, 'getHonorEmoji'),
  extractFunction(html, 'resolveHonorEmoji'),
  extractFunction(html, 'isDataKingHonor'),
  extractFunction(html, 'getHonorBadgeClass'),
  extractFunction(html, 'buildSeasonHonorCards'),
].join('\n');

const build = new Function('STATE', code + '\nreturn { emoji: getHonorEmoji, resolve: resolveHonorEmoji, isKing: isDataKingHonor, cls: getHonorBadgeClass, cards: buildSeasonHonorCards };');

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('荣誉徽章测试');

check('六项数据王各有专属图标，不再退化成通用 🏅', () => {
  const f = build({ season: { awards: [] }, career: { seasonCount: 2 } });
  const expect = { 得分王: '🎯', 篮板王: '💪', 助攻王: '🅰️', 三分王: '🏹', 抢断王: '🧤', 盖帽王: '🚫' };
  Object.keys(expect).forEach((label) => {
    assert.equal(f.emoji(label), expect[label], label + ' 应显示 ' + expect[label]);
    assert.ok(f.isKing(label), label + ' 应被识别为数据王');
  });
});

check('传统荣誉的图标不受影响', () => {
  const f = build({ season: { awards: [] }, career: { seasonCount: 2 } });
  assert.equal(f.emoji('总冠军'), '🏆');
  assert.equal(f.emoji('总决赛MVP'), '👑');
  assert.equal(f.emoji('DPOY'), '🔒');
  assert.equal(f.emoji('最佳防守阵容'), '🔒');
  assert.equal(f.emoji('全明星'), '⭐');
  assert.equal(f.emoji('最佳阵容'), '🌟');
  assert.equal(f.emoji('最佳第六人'), '🔥');
  assert.equal(f.emoji('进步最快球员'), '📈');
  assert.equal(f.emoji('最佳新秀阵容'), '🌱');
});

check('样式：数据王橙色卡片，冠军/MVP 金色，其余普通', () => {
  const f = build({ season: { awards: [] }, career: { seasonCount: 2 } });
  assert.equal(f.cls('得分王'), 'ch-badge title');
  assert.equal(f.cls('盖帽王'), 'ch-badge title');
  assert.equal(f.cls('总冠军'), 'ch-badge gold');
  assert.equal(f.cls('MVP'), 'ch-badge gold');
  assert.equal(f.cls('全明星'), 'ch-badge');
});

check('旧存档里存成通用图标的荣誉，会按 label 重新认出来', () => {
  const f = build({ season: { awards: [] }, career: { seasonCount: 2 } });
  assert.equal(f.resolve('三分王', '🏅'), '🏹', '应优先用能认出奖项的图标');
  assert.equal(f.resolve('某项没见过的奖', '🥇'), '🥇', '认不出来时沿用存档里的图标');
});

check('赛季总结的小卡片包含数据王', () => {
  const state = {
    career: { seasonCount: 3 },
    season: { awards: [
      { act: 'mvp', label: 'MVP', isUser: true },
      { act: 'scoring', label: '得分王', isUser: true },
      { act: 'three', label: '三分王', isUser: true },
      { act: 'block', label: '盖帽王', isUser: false, winner: '别人' },
    ] },
  };
  const out = build(state).cards();
  assert.ok(out.indexOf('本赛季荣誉') >= 0, '应有荣誉区块：' + out);
  assert.ok(out.indexOf('得分王') >= 0, '应包含得分王：' + out);
  assert.ok(out.indexOf('三分王') >= 0, '应包含三分王');
  assert.ok(out.indexOf('盖帽王') < 0, '别人拿的盖帽王不该出现在自己的荣誉里');
  assert.ok(out.indexOf('🏹') >= 0, '三分王应是专属图标');
  assert.ok(out.indexOf('is-title') >= 0, '数据王应使用专属卡片样式');
  assert.ok(out.indexOf('is-gold') >= 0, 'MVP 应使用金色卡片样式');
});

check('同一奖项只出一张卡（不会被列两遍）', () => {
  const state = {
    career: { seasonCount: 2 },
    season: { awards: [
      { act: 'scoring', label: '得分王', isUser: true },
      { act: 'scoring', label: '得分王', isUser: true },
    ] },
  };
  const out = build(state).cards();
  assert.equal(out.split('得分王').length - 1, 1, '应去重：' + out);
});

check('新秀赛季之后不再展示最佳新秀，没有荣誉时不渲染区块', () => {
  const later = build({
    career: { seasonCount: 4 },
    season: { awards: [{ act: 'roty', label: '最佳新秀', isUser: true }] },
  });
  assert.equal(later.cards(), '', '非新秀赛季不应再挂最佳新秀');

  const first = build({
    career: { seasonCount: 0 },
    season: { awards: [{ act: 'roty', label: '最佳新秀', isUser: true }] },
  });
  assert.ok(first.cards().indexOf('最佳新秀') >= 0, '新秀赛季应保留最佳新秀');

  const none = build({ career: { seasonCount: 3 }, season: { awards: [] } });
  assert.equal(none.cards(), '', '没有荣誉就不渲染区块');
});

check('字符串类奖项（旧存档形态）也能进卡片', () => {
  const state = { career: { seasonCount: 2 }, season: { awards: ['全明星', '抢断王'] } };
  const out = build(state).cards();
  assert.ok(out.indexOf('全明星') >= 0 && out.indexOf('抢断王') >= 0, '字符串奖项应被收录：' + out);
  assert.ok(out.indexOf('🧤') >= 0, '抢断王应有专属图标');
});

check('赛季总结页确实插入了这块卡片', () => {
  assert.ok(html.indexOf('${buildSeasonHonorCards()}') >= 0, 'showSeasonResults 应渲染本赛季荣誉');
  // 荣誉墙已并入「生涯数据 → 荣誉墙」页签（renderCareerHonorsTab），
  // 旧独立页面 showCareerHonors 已删。这里改看活着的那个。
  const honorsStart = html.indexOf('function renderCareerHonorsTab()');
  assert.ok(honorsStart > 0, '找不到 renderCareerHonorsTab');
  assert.ok(html.slice(honorsStart, honorsStart + 2000).indexOf('getHonorBadgeClass') >= 0, '荣誉墙应使用统一样式入口');
});

console.log('\n全部通过：' + passed + ' 项');
