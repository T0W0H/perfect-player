'use strict';

/**
 * 事件选项预告测试
 * 验证「这个选项会改变什么」不再是一句空洞的话：
 *   1) 确定性的选项 → 给出量化预告；
 *   2) 带分支/随机的选项 → 至少说清会动哪几项、往哪个方向动；
 *   3) 推进剧情线的选项 → 说明会改变之后能遇到的事件；
 *   4) 对文件里所有真实选项都能跑通，不抛错。
 * 运行：node tests/event-choice-preview.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'nba-perfect-player.html'), 'utf8');

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

const source = [
  extractVarObject(html, 'EVENT_CHOICE_PREDICTION_LABELS'),
  extractVarObject(html, 'EVENT_CHOICE_BAD_WHEN_RAISED'),
  'var ATTR_CN = { threePT:\'三分\', MID:\'中投\', FIN:\'终结\', PAS:\'传球\', HAN:\'护球\', REB:\'篮板\' };',
  'function attrCN(k) { return ATTR_CN[k] || k; }',
  extractFunction(html, 'formatEventChoiceEffect'),
  extractFunction(html, 'formatEventChoiceEffectDirection'),
  extractFunction(html, 'collectEventChoiceEffectStats'),
  extractFunction(html, 'extractEventChoiceEffectPreview'),
  extractFunction(html, 'hasEventChoiceOutcomeForecast'),
  extractFunction(html, 'getEventChoicePrediction'),
  'return { extractEventChoiceEffectPreview:extractEventChoiceEffectPreview, getEventChoicePrediction:getEventChoicePrediction, hasEventChoiceOutcomeForecast:hasEventChoiceOutcomeForecast };',
].join('\n');

const api = new Function(source)();

function choiceFrom(body, extra) {
  return Object.assign({ label: '测试选项' }, extra || {}, { apply: new Function(body) });
}

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('事件选项预告测试');

check('确定性选项给出量化预告', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom("addProfileDelta('fame', 2); addProfileDelta('coachTrust', 1);"));
  assert.equal(preview, '人气明显提升、教练信任提升');
});

check('带随机的选项也能说清会动哪几项、往哪个方向动', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom(
    "if (Math.random() < 0.5) { addProfileDelta('fame', 2); } else { addProfileDelta('fame', -1); addProfileDelta('coachTrust', 1); }"
  ));
  assert.ok(preview.indexOf('结果带随机或前置条件') >= 0, preview);
  assert.ok(preview.indexOf('人气可能变化') >= 0, '同一项有增有减时应说“可能变化”：' + preview);
  assert.ok(preview.indexOf('教练信任可能提升') >= 0, preview);
});

check('只增不减的随机项应说明方向', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom(
    "if (Math.random() < 0.4) addProfileDelta('fanSupport', 1);"
  ));
  assert.ok(preview.indexOf('球迷支持可能提升') >= 0, preview);
});

check('负面数值用“可能增加 / 可能下降”表达，不会说反', () => {
  const up = api.extractEventChoiceEffectPreview(choiceFrom("if (Math.random() < 0.5) addSeasonMod('injuryRiskBonus', 2);"));
  assert.ok(up.indexOf('伤病风险可能增加') >= 0, up);
  const down = api.extractEventChoiceEffectPreview(choiceFrom("if (Math.random() < 0.5) addSeasonMod('staminaLoad', -2);"));
  assert.ok(down.indexOf('体能负荷可能下降') >= 0, down);
});

check('状态波动有专门的说法，不会写成“波动提升”', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom("addSeasonMod('formVariance', -1, -10, 10);"));
  assert.equal(preview, '状态更稳定');
});

check('推进剧情线的选项要说明它会改变后续能遇到的事件', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom("setBranchNode('china_team', 'honorable_exit');"));
  assert.ok(preview.indexOf('推进剧情线') >= 0, preview);
  assert.ok(preview.indexOf('之后能遇到的事件') >= 0, preview);
});

check('数值 + 剧情线可以同时预告', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom(
    "var b = setBranchNode('china_team', 'managed_core'); b.reputation = 1; if (Math.random() < 0.5) addProfileDelta('legacyBonus', 1);"
  ));
  assert.ok(preview.indexOf('推进剧情线') >= 0, preview);
  assert.ok(preview.indexOf('传奇声望可能提升') >= 0, preview);
});

check('属性变化也会预告', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom("addAttrDelta('threePT', 1);"));
  assert.ok(preview.indexOf('三分') >= 0, preview);
});

check('没有 apply 的选项不报错', () => {
  assert.equal(api.extractEventChoiceEffectPreview({ label: 'x' }), '');
  assert.equal(api.extractEventChoiceEffectPreview(null), '');
});

check('合并到提示里：已有预测词就不重复追加', () => {
  const withForecast = api.getEventChoicePrediction({ hint: '球队默契提升', apply: new Function("addProfileDelta('fame', 1);") }, {}, 0);
  assert.equal(withForecast, '球队默契提升');
  const neutral = api.getEventChoicePrediction({ hint: '把第一句话留给最重要的人', apply: new Function("addProfileDelta('loyalty', 1);") }, {}, 0);
  assert.ok(neutral.indexOf('忠诚提升') >= 0, neutral);
});

check('完全没有信息时也会指向生涯档案，而不是含糊其辞', () => {
  const text = api.getEventChoicePrediction({ label: '沉默' }, { title: '赛季事件：某个夜晚' }, 0);
  assert.ok(text.indexOf('生涯档案') >= 0, text);
  assert.ok(text.indexOf('将改变后续剧情与人物评价') < 0, '旧的含糊兜底不该再出现');
});

check('文件里的所有真实选项都能跑通，且绝大多数不再落到空预告', () => {
  const results = [];
  const marker = 'apply: function';
  let index = html.indexOf(marker);
  while (index >= 0) {
    const braceStart = html.indexOf('{', index);
    let fnText;
    try {
      fnText = html.slice(index + 'apply: '.length, matchEnd(html, braceStart));
    } catch (e) {
      index = html.indexOf(marker, index + 1);
      continue;
    }
    let fn = null;
    try { fn = new Function('return ' + fnText + ';')(); } catch (e) { fn = null; }
    if (fn) results.push(api.extractEventChoiceEffectPreview({ label: 'x', apply: fn }));
    index = html.indexOf(marker, index + marker.length);
  }
  assert.ok(results.length > 300, '应该扫描到足够多的真实选项：' + results.length);
  results.forEach((preview) => assert.equal(typeof preview, 'string'));
  const informative = results.filter((preview) => preview.length > 0).length;
  assert.ok(informative / results.length > 0.9, '至少 90% 的选项应能说清改变了什么：' + informative + '/' + results.length);
  console.log('    （扫描 ' + results.length + ' 个选项，' + informative + ' 个能给出具体影响，占比 ' + Math.round(informative / results.length * 100) + '%）');
});

console.log('\n全部通过：' + passed + ' 项');
