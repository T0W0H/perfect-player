'use strict';

/**
 * 生涯荣誉记录测试
 * 界面上的「生涯总计」是一行 N×奖项 的汇总，前提是数据王真的进了 c.honors。
 * 这里把 saveCurrentSeasonToCareer 真跑一遍，守住：
 *   1. 六项数据王只要 isUser 就会写进生涯荣誉（不能被过滤掉）
 *   2. 汇总计数正确，且同一年拿两项不会互相覆盖
 *   3. 类容错：字符串类奖项、NPC 奖项、旧存档字段缺失都不报错
 * 运行：node tests/career-honors.test.js
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

/** 取出「生涯总计」的计数逻辑（只到 tallyParts 之前） */
function extractHonorTally() {
  const anchor = html.indexOf('function renderCareerHonorsTab()');
  const start = html.indexOf('  var counts = {};', anchor);
  const end = html.indexOf('function tallyParts(', start);
  if (start < 0 || end < 0) throw new Error('找不到生涯总计计数段');
  return html.slice(start, end);
}

/** 取出「生涯总计」的成组逻辑（荣誉 / 数据王两行） */
function extractHonorGroups() {
  const anchor = html.indexOf('function renderCareerHonorsTab()');
  const start = html.indexOf('  var counts = {};', anchor);
  const end = html.indexOf('if (majorParts.length > 0 || kingParts.length > 0)', start);
  if (start < 0 || end < 0) throw new Error('找不到生涯总分成组段');
  return html.slice(start, end);
}

const DATA_KING_LABELS = ['得分王', '篮板王', '助攻王', '三分王', '抢断王', '盖帽王'];

function runSave(season, career) {
  const code = [
    'var STATE = { career: __CAREER, season: __SEASON, careerTeam: "LAL", attrs: {}, finalOVR: 90 };',
    'var ATTR_KEYS = ["threePT","MID","FIN","DNK","HAN","PAS","PDEF","IDEF","BLK","REB","ATH","STR","CLU"];',
    'function updateSeasonBadge() {}',
    'function getPlusMinusTotals() { return { avg: 0, total: 0, games: 0 }; }',
    'var HONOR_EMOJI_RULES = ' + JSON.stringify([
      ['得分王', '🎯'], ['篮板王', '💪'], ['助攻王', '🅰️'], ['三分王', '🏹'],
      ['抢断王', '🧤'], ['盖帽王', '🚫'], ['总冠军', '🏆'], ['总决赛MVP', '👑'],
      ['MVP', '🏆'], ['DPOY', '🔒'], ['最佳阵容', '🌟'], ['全明星', '⭐'], ['最佳新秀', '🌱'],
    ]) + ';',
    extractFunction(html, 'getHonorEmoji'),
    extractFunction(html, 'isRookieHonorForLaterSeason'),
    extractFunction(html, 'saveCurrentSeasonToCareer'),
    'saveCurrentSeasonToCareer();',
    'return STATE.career;',
  ].join('\n');
  return new Function('__SEASON', '__CAREER', code)(season, career);
}

function career() {
  return {
    seasonCount: 0, seasons: [], honors: [], currentAge: 25,
    totalStats: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, threeM: 0, threeA: 0, mins: 0, games: 0 },
    playoffStats: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, threeM: 0, threeA: 0, mins: 0, games: 0 },
    flags: {}, profile: {}, legacy: {},
  };
}

function season(awards) {
  return {
    playerStats: { games: 82, pts: 2000, reb: 500, ast: 400, stl: 100, blk: 50, tov: 200, fgm: 700, fga: 1400, ftm: 300, fta: 360, threeM: 200, threeA: 500, mins: 2800 },
    awards: awards,
    wins: 55, losses: 27,
    playoffBracket: null,
  };
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('生涯荣誉记录测试');

check('六项数据王只要 isUser 就写进生涯荣誉', () => {
  const c = runSave(season(DATA_KING_LABELS.map((label, i) => ({
    act: ['scoring', 'rebound', 'assist', 'three', 'steal', 'block'][i],
    label: label, winner: '我', isUser: true, userRank: '🥇 第一名',
  }))), career());
  DATA_KING_LABELS.forEach((label) => {
    assert.ok(c.honors.some((h) => h.label === label), '生涯荣誉缺少「' + label + '」');
  });
  assert.equal(c.honors.length, 6, '六项数据王都该入账，实际 ' + c.honors.length);
});

check('NPC 拿到的数据王不会记到玩家头上', () => {
  const c = runSave(season(DATA_KING_LABELS.map((label) => ({
    act: 'scoring', label: label, winner: '别人', isUser: false, userRank: '第 4 名',
  }))), career());
  assert.equal(c.honors.length, 0, 'NPC 奖项不该进玩家生涯荣誉');
});

check('多次拿到同一项会各记一次（汇总成 N×）', () => {
  let c = career();
  for (let i = 0; i < 3; i++) {
    c = runSave(season([{ act: 'scoring', label: '得分王', winner: '我', isUser: true, userRank: '🥇 第一名' }]), c);
  }
  assert.equal(c.honors.filter((h) => h.label === '得分王').length, 3, '三季得分王应记三条');
  assert.equal(c.seasonCount, 3, '三个赛季');
});

check('同一年拿多项不会互相覆盖', () => {
  const c = runSave(season([
    { act: 'scoring', label: '得分王', winner: '我', isUser: true, userRank: '🥇 第一名' },
    { act: 'assist', label: '助攻王', winner: '我', isUser: true, userRank: '🥇 第一名' },
    { act: 'mvp', label: 'MVP', winner: '我', isUser: true, userRank: '🥇 第一名' },
  ]), career());
  ['得分王', '助攻王', 'MVP'].forEach((l) => {
    assert.ok(c.honors.some((h) => h.label === l), '缺「' + l + '」');
  });
  assert.equal(c.honors.length, 3);
});

check('汇总计数：按类型统计生涯总计', () => {
  const c = runSave(season([
    { act: 'scoring', label: '得分王', winner: '我', isUser: true, userRank: '🥇 第一名' },
    { act: 'rebound', label: '篮板王', winner: '我', isUser: true, userRank: '🥇 第一名' },
  ]), career());
  const tally = extractHonorTally();
  const helper = extractFunction(html, 'isRookieHonorForLaterSeason');
  const constants = html.slice(html.indexOf('var DATA_KING_LABELS'), html.indexOf('var HONOR_EMOJI_RULES'));
  const out = new Function('c', constants + '\n' + helper + '\n' + tally + 'return counts;')(c);
  assert.equal(out['得分王'], 1);
  assert.equal(out['篮板王'], 1);
});

check('生涯总计把数据王单独成组，并按固定顺序排列', () => {
  const c = runSave(season([
    { act: 'block', label: '盖帽王', winner: '我', isUser: true, userRank: '🥇 第一名' },
    { act: 'scoring', label: '得分王', winner: '我', isUser: true, userRank: '🥇 第一名' },
    { act: 'mvp', label: 'MVP', winner: '我', isUser: true, userRank: '🥇 第一名' },
  ]), career());
  const groups = extractHonorGroups();
  const helper = extractFunction(html, 'isRookieHonorForLaterSeason');
  const constants = html.slice(html.indexOf('var DATA_KING_LABELS'), html.indexOf('var HONOR_EMOJI_RULES'));
  const out = new Function('c', constants + '\n' + helper + '\n' + groups + 'return { major: majorParts, king: kingParts };')(c);
  // 数据王与普通荣誉分开：MVP 在荣誉组，得分王/盖帽王在数据王组
  assert.deepEqual(out.major, ['1×MVP'], '荣誉组应有 MVP');
  // 顺序按 DATA_KING_LABELS（得分王在盖帽王之前），而不是按获得先后
  assert.deepEqual(out.king, ['1×得分王', '1×盖帽王'], '数据王组应按固定顺序排列');
});

check('旧存档（缺字段 / 脏数据）不报错', () => {
  const legacy = { seasonCount: 0, seasons: [], honors: [], totalStats: {}, playoffStats: {} };
  const c = runSave(season([{ act: 'scoring', label: '得分王' }]), legacy);   // 没有 isUser
  assert.equal(c.honors.length, 0, '没有 isUser 标记的不算玩家荣誉');
  assert.equal(c.seasonCount, 1);
});

console.log('\n全部通过：' + passed + ' 项');
