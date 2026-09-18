'use strict';

/**
 * 事件选项预告测试
 * 选项上面的后果提示要「短小精悍」：能写数字就不写形容词，必须模糊时用箭头。
 * 同时验证：带分支/随机的选项也能说清会动哪几项、往哪个方向动。
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
  'var EVENT_CHOICE_PREVIEW_MAX = 22;',
  extractVarObject(html, 'EVENT_CHOICE_PREDICTION_LABELS'),
  extractVarObject(html, 'EVENT_CHOICE_BAD_WHEN_RAISED'),
  'var ATTR_CN = { threePT:\'三分\', MID:\'中投\', FIN:\'终结\', PAS:\'传球\', HAN:\'护球\', REB:\'篮板\' };',
  'function attrCN(k) { return ATTR_CN[k] || k; }',
  extractFunction(html, 'eventChoiceEffectLabel'),
  extractFunction(html, 'formatEventChoiceEffect'),
  extractFunction(html, 'formatEventChoiceEffectDirection'),
  extractFunction(html, 'collectEventChoiceEffectStats'),
  extractFunction(html, 'extractEventChoiceEffectPreview'),
  extractFunction(html, 'hasEventChoiceOutcomeForecast'),
  extractFunction(html, 'getEventChoicePrediction'),
  'return { extractEventChoiceEffectPreview:extractEventChoiceEffectPreview, getEventChoicePrediction:getEventChoicePrediction };',
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

check('确定性选项直接给数字，不写形容词', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom("addProfileDelta('fame', 2); addProfileDelta('coachTrust', 1);"));
  assert.equal(preview, '人气 +2、教练信任 +1');
});

check('带随机的选项用箭头表达方向', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom(
    "if (Math.random() < 0.5) { addProfileDelta('fame', 2); } else { addProfileDelta('fame', -1); addProfileDelta('coachTrust', 1); }"
  ));
  assert.ok(preview.indexOf('可能：') === 0, preview);
  assert.ok(preview.indexOf('人气▲▼') >= 0, '有增有减用 ▲▼：' + preview);
  assert.ok(preview.indexOf('教练信任▲') >= 0, preview);
});

check('只增不减的随机项也只给方向', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom("if (Math.random() < 0.4) addProfileDelta('fanSupport', 1);"));
  assert.equal(preview, '可能：球迷支持▲');
});

check('负面项的方向不会说反（箭头即数值方向）', () => {
  const up = api.extractEventChoiceEffectPreview(choiceFrom("if (Math.random() < 0.5) addSeasonMod('injuryRiskBonus', 2);"));
  assert.equal(up, '可能：伤病风险▲');
  const down = api.extractEventChoiceEffectPreview(choiceFrom("if (Math.random() < 0.5) addSeasonMod('staminaLoad', -2);"));
  assert.equal(down, '可能：体能负荷▼');
});

check('状态波动用数字表达，不会写成“波动提升”', () => {
  assert.equal(api.extractEventChoiceEffectPreview(choiceFrom("addSeasonMod('formVariance', -1, -10, 10);")), '状态波动 -1');
});

check('推进剧情线只要三个字', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom("setBranchNode('china_team', 'honorable_exit');"));
  assert.equal(preview, '推进剧情');
});

check('数值 + 剧情线同时出现', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom(
    "var b = setBranchNode('china_team', 'managed_core'); b.reputation = 1; if (Math.random() < 0.5) addProfileDelta('legacyBonus', 1);"
  ));
  assert.ok(preview.indexOf('推进剧情') >= 0, preview);
  assert.ok(preview.indexOf('传奇声望▲') >= 0, preview);
});

check('属性变化也会预告', () => {
  assert.equal(api.extractEventChoiceEffectPreview(choiceFrom("addAttrDelta('threePT', 1);")), '三分 +1');
});

check('只有合同变化的选项也能说清', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom('p.twoWay = true; p.contractYears = 2;'));
  assert.equal(preview, '合同身份、合同年限');
});

check('最多只列三项，且不超过长度预算', () => {
  const preview = api.extractEventChoiceEffectPreview(choiceFrom(
    "addProfileDelta('fame', 1); addProfileDelta('coachTrust', 1); addProfileDelta('fanSupport', 1); addProfileDelta('loyalty', 1);"
  ));
  assert.ok(preview.split('、').length <= 3, preview);
  const withBranch = api.extractEventChoiceEffectPreview(choiceFrom(
    "addProfileDelta('chinaPopularity', 3); addProfileDelta('legacyBonus', 2); addProfileDelta('injuryRiskBonus', 1); setBranchNode('china_team', 'x');"
  ));
  assert.ok(withBranch.length <= 22, '带剧情线的提示也不能超长：' + withBranch + '（' + withBranch.length + ' 字）');
  assert.ok(withBranch.indexOf('推进剧情') >= 0, '超长时应该少列一项而不是丢掉剧情线：' + withBranch);
});

check('没有 apply 的选项不报错', () => {
  assert.equal(api.extractEventChoiceEffectPreview({ label: 'x' }), '');
  assert.equal(api.extractEventChoiceEffectPreview(null), '');
});

check('合并到提示里：已有预测词就不重复追加', () => {
  const withForecast = api.getEventChoicePrediction({ hint: '球队默契提升', apply: new Function("addProfileDelta('fame', 1);") }, {}, 0);
  assert.equal(withForecast, '球队默契提升');
  const neutral = api.getEventChoicePrediction({ hint: '把第一句话留给最重要的人', apply: new Function("addProfileDelta('loyalty', 1);") }, {}, 0);
  assert.ok(neutral.indexOf('忠诚 +1') >= 0, neutral);
});

check('完全没有信息时也指向生涯档案，而不是含糊其辞', () => {
  const text = api.getEventChoicePrediction({ label: '沉默' }, { title: '赛季事件：某个夜晚' }, 0);
  assert.ok(text.indexOf('生涯档案') >= 0, text);
  assert.ok(text.indexOf('将改变后续剧情与人物评价') < 0, '旧的含糊兜底不该再出现');
});

check('文件里的所有真实选项都能跑通，且全部能说清改变了什么', () => {
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
  const informative = results.filter((preview) => preview.length > 0).length;
  assert.equal(informative, results.length, '还有 ' + (results.length - informative) + ' 个选项没有预告');

  // 提示是按钮下面的小字，必须短
  const overlong = results.filter((preview) => preview.length > 22);
  assert.equal(overlong.length, 0, '这些预告太长了：' + overlong.slice(0, 3).join(' / '));
  const longest = results.reduce((max, preview) => Math.max(max, preview.length), 0);
  const average = Math.round(results.reduce((sum, preview) => sum + preview.length, 0) / results.length * 10) / 10;
  console.log('    （扫描 ' + results.length + ' 个选项，覆盖率 100%，最长 ' + longest + ' 字，平均 ' + average + ' 字）');
});

console.log('\n全部通过：' + passed + ' 项');
