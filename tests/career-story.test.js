'use strict';

/**
 * 生涯注脚（剧情选择进入退役评价）测试
 * 从 nba-perfect-player.html 抽出 buildCareerStoryFootnotes 与两张映射表，
 * 验证：未开始的线不出现、已知节点出人话、未知节点用兜底、flags 追加。
 * 运行：node tests/career-story.test.js
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

function extractArrayVar(source, name) {
  const start = source.indexOf('var ' + name + ' = [');
  if (start < 0) throw new Error('找不到数组: ' + name);
  const open = source.indexOf('[', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1) + ';';
    }
  }
  throw new Error('数组括号不配对: ' + name);
}

const source = [
  extractArrayVar(html, 'CAREER_STORY_NOTES'),
  extractArrayVar(html, 'CAREER_FLAG_NOTES'),
  extractFunction(html, 'careerStoryBranchNode'),
  extractFunction(html, 'buildCareerStoryFootnotes'),
  'return buildCareerStoryFootnotes();',
].join('\n');

const build = new Function('STATE', source);

function notesFor(branchNodes, flags) {
  const STATE = { career: { branches: {}, flags: flags || {} } };
  Object.keys(branchNodes || {}).forEach((branch) => {
    STATE.career.branches[branch] = { node: branchNodes[branch] };
  });
  return build(STATE);
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('生涯注脚测试');

check('什么都没发生时返回空数组', () => {
  assert.deepEqual(notesFor({}, {}), []);
});

check('未开始的线（start）不会出现在注脚里', () => {
  assert.deepEqual(notesFor({ relationship: 'start', charity: 'start' }, {}), []);
});

check('已知节点会翻译成人话，并带上线的名字', () => {
  const notes = notesFor({ relationship: 'stable', charity: 'charity_foundation' }, {});
  assert.equal(notes.length, 2);
  assert.ok(notes[0].indexOf('感情线：') === 0, notes[0]);
  assert.ok(notes[0].indexOf('长期稳定') >= 0, notes[0]);
  assert.ok(notes[1].indexOf('公益线：') === 0, notes[1]);
  assert.ok(notes[1].indexOf('基金会') >= 0, notes[1]);
});

check('未知节点用该线的兜底文案，不会漏掉这条线', () => {
  const notes = notesFor({ media: 'some_new_node' }, {});
  assert.equal(notes.length, 1);
  assert.ok(notes[0].indexOf('媒体关系：') === 0, notes[0]);
  assert.ok(notes[0].indexOf('兜底') < 0, '不应出现占位词：' + notes[0]);
});

check('flags 会追加为独立注脚', () => {
  const notes = notesFor({}, { familyPriority: true, singleFocus: true, unrelatedFlag: true });
  assert.equal(notes.length, 2, notes.join(' | '));
  assert.ok(notes.some((n) => n.indexOf('家人') >= 0));
  assert.ok(notes.some((n) => n.indexOf('单身') >= 0));
});

check('多条线一起出现时保持稳定顺序', () => {
  const notes = notesFor({
    relationship: 'breakup',
    family_children: 'birth_present',
    post_career: 'head_coach',
    retirement_countdown: 'legacy_quiet',
  }, {});
  assert.equal(notes.length, 4);
  assert.ok(notes[0].indexOf('感情线') === 0);
  assert.ok(notes[1].indexOf('下一代') === 0);
  assert.ok(notes[2].indexOf('退役后去向') === 0);
  assert.ok(notes[3].indexOf('退役方式') === 0);
});

// ── 抱团抉择回响 ──
const echoSource = [
  extractFunction(html, 'careerStoryBranchNode'),
  extractFunction(html, 'applySuperstarRecruitEcho'),
  'return applySuperstarRecruitEcho();',
].join('\n');
const runEcho = new Function('STATE', 'addSeasonMod', 'addProfileDelta', echoSource);

function echoFor(node, seasonCount) {
  const profileCalls = [];
  const modCalls = [];
  const STATE = { career: { branches: { superstar_recruit: { node } }, flags: {}, seasonCount: seasonCount == null ? 3 : seasonCount } };
  const text = runEcho(
    STATE,
    (key, delta) => { modCalls.push(key + ':' + delta); },
    (key, delta) => { profileCalls.push(key + ':' + delta); }
  );
  return { text, profileCalls, modCalls, STATE };
}

check('抱团抉择回响：拒绝抱团加忠诚与球迷支持，并记入休赛期纪事', () => {
  const { text, profileCalls, STATE } = echoFor('kept_distance');
  assert.ok(text && text.indexOf('自己人') >= 0, '应有回响文案');
  assert.deepEqual(profileCalls.sort(), ['fanSupport:1', 'loyalty:1']);
  assert.equal(STATE.career.offseasonHistory.length, 1);
  assert.equal(STATE.career.offseasonHistory[0].event, '抱团抉择 · 回响');
  assert.equal(STATE.career.offseasonHistory[0].eventId, 'superstar_recruit_echo');
});

check('抱团抉择回响：考虑抱团加媒体压力', () => {
  const { modCalls } = echoFor('consider_team_up');
  assert.deepEqual(modCalls, ['mediaPressure:1']);
});

check('抱团抉择回响：同赛季只结算一次，未触发时不结算', () => {
  const first = echoFor('public_leverage', 5);
  assert.equal(first.STATE.career.offseasonHistory.length, 1);
  // 同一个赛季再次调用（state 复用）不应重复
  const again = runEcho(first.STATE, () => {}, () => {});
  assert.equal(again, null);
  assert.equal(first.STATE.career.offseasonHistory.length, 1);
  // 没触发过这条线时不产生记录
  const none = echoFor('start');
  assert.equal(none.text, null);
  assert.equal(none.STATE.career.offseasonHistory, undefined);
});

console.log('\n全部通过：' + passed + ' 项');
