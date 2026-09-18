'use strict';

/**
 * 生涯档案面板测试
 * 事件里的「人气 / 教练信任 / 争议…」到底改变了什么，必须在游戏里看得到。
 * 运行：node tests/career-profile.test.js
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

function extractVarArray(source, name) {
  const start = source.indexOf('var ' + name + ' = [');
  if (start < 0) throw new Error('找不到数组: ' + name);
  const open = source.indexOf('[', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '[') depth++;
    else if (source[i] === ']') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1) + ';';
    }
  }
  throw new Error('数组括号不配对: ' + name);
}

const source = [
  extractVarArray(html, 'CAREER_PROFILE_GUIDE'),
  extractVarArray(html, 'CAREER_SEASON_MOD_GUIDE'),
  extractFunction(html, 'fmtProfileValue'),
  extractFunction(html, 'renderCareerProfileBody'),
  extractFunction(html, 'renderCareerProfilePanel'),
  extractFunction(html, 'renderSeasonProfileDetails'),
  'return { CAREER_PROFILE_GUIDE:CAREER_PROFILE_GUIDE, CAREER_SEASON_MOD_GUIDE:CAREER_SEASON_MOD_GUIDE, fmtProfileValue:fmtProfileValue, renderCareerProfileBody:renderCareerProfileBody, renderCareerProfilePanel:renderCareerProfilePanel, renderSeasonProfileDetails:renderSeasonProfileDetails };',
].join('\n');

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

function makeApi(options) {
  const opts = options || {};
  const STATE = opts.state || { career: { profile: opts.profile || {} } };
  const profile = Object.assign({ fame:0, businessValue:0, mediaTrust:0, controversy:0, chinaPopularity:0, loyalty:0, leadership:0, coachTrust:0, lockerRoomTrust:0, fanSupport:0, legacyBonus:0 }, opts.profile || {});
  const effects = opts.effects === undefined ? {
    teamStanding: 12.4, publicStanding: 8.2,
    minutesFactor: 1.07, gameOffenseBonus: 0.8, gameDefenseBonus: 0.5,
    tradeChanceDelta: -3, renewalChanceBonus: 0.05,
  } : opts.effects;
  return new Function('STATE', 'getCareerProfile', 'getCareerProfileEffects', 'getNextSeasonMods', 'buildCareerStoryFootnotes', source)(
    STATE,
    () => profile,
    () => effects,
    () => (opts.mods || {}),
    () => (opts.notes || [])
  );
}

function render(options) {
  return makeApi(options).renderCareerProfilePanel();
}

console.log('生涯档案面板测试');

check('没有任何积累时给出说明而不是空白', () => {
  const out = render();
  assert.ok(out.indexOf('生涯档案') >= 0);
  assert.ok(out.indexOf('还没有积累任何档案数值') >= 0, out);
});

check('只列出非零项，并带上「它到底改变了什么」', () => {
  const out = render({ profile: { coachTrust: 6, fame: 3, controversy: 0 } });
  assert.ok(out.indexOf('教练信任') >= 0);
  assert.ok(out.indexOf('人气') >= 0);
  assert.ok(out.indexOf('争议') < 0, '数值为 0 的项不该出现');
  assert.ok(out.indexOf('被交易') >= 0, '应说明教练信任影响什么');
  assert.ok(out.indexOf('≥7 触发全国关注类事件') >= 0, '应说明人气影响什么');
  assert.ok(out.indexOf('+6') >= 0);
});

check('换算后的实际效果会直接写出来', () => {
  const out = render({ profile: { coachTrust: 6 } });
  assert.ok(out.indexOf('球队地位') >= 0);
  assert.ok(out.indexOf('上场时间 ×1.07') >= 0, out);
  assert.ok(out.indexOf('被交易 -3') >= 0, out);
  assert.ok(out.indexOf('续约 +5%') >= 0, out);
});

check('本赛季修正单独成块，并说明对球队攻防的影响', () => {
  const out = render({ profile: { fame: 1 }, mods: { moraleBonus: 1, teamChemistry: 2, staminaLoad: -1 } });
  assert.ok(out.indexOf('本赛季修正') >= 0);
  assert.ok(out.indexOf('士气') >= 0 && out.indexOf('球队默契') >= 0 && out.indexOf('体能负荷') >= 0);
  assert.ok(out.indexOf('球队防守 +0.32/点') >= 0);
  assert.ok(out.indexOf('减少你的上场时间') >= 0, '体能负荷应说明会挤压上场时间');
});

check('走出的剧情线会用人话列出来', () => {
  const out = render({ profile: { fame: 1 }, notes: ['感情线：长期稳定，彼此都把对方放进了日程表', '公益线：基金会已经能自己运转'] });
  assert.ok(out.indexOf('已走出的路线') >= 0);
  assert.ok(out.indexOf('感情线：长期稳定') >= 0);
  assert.ok(out.indexOf('公益线：基金会') >= 0);
});

check('缺失的依赖（老存档 / 早期状态）不会报错', () => {
  const out = render({ effects: null, notes: [] });
  assert.ok(out.indexOf('生涯档案') >= 0);
  assert.ok(out.indexOf('球队地位') < 0, '没有 effects 时不硬编造派生数据');
});

check('数值格式带正负号', () => {
  const api = new Function('STATE', 'getCareerProfile', 'getCareerProfileEffects', 'getNextSeasonMods', 'buildCareerStoryFootnotes', source)(
    { career: { profile: {} } }, () => ({}), () => null, () => ({}), () => []
  );
  assert.equal(api.fmtProfileValue(3), '+3');
  assert.equal(api.fmtProfileValue(-2.25), '-2.2');
  assert.equal(api.fmtProfileValue(0), '0');
  assert.equal(api.fmtProfileValue(undefined), '0');
});

check('说明文案覆盖了事件里会出现的每一个数值', () => {
  const api = new Function('STATE', 'getCareerProfile', 'getCareerProfileEffects', 'getNextSeasonMods', 'buildCareerStoryFootnotes', source)(
    { career: { profile: {} } }, () => ({}), () => null, () => ({}), () => []
  );
  const covered = api.CAREER_PROFILE_GUIDE.map((item) => item.key).concat(api.CAREER_SEASON_MOD_GUIDE.map((item) => item.key));
  ['fame','businessValue','mediaTrust','controversy','chinaPopularity','loyalty','leadership','coachTrust','lockerRoomTrust','fanSupport','legacyBonus'].forEach((key) => {
    assert.ok(covered.indexOf(key) >= 0, '缺少档案说明: ' + key);
  });
  ['moraleBonus','teamChemistry','staminaLoad','mediaPressure','injuryRiskBonus','formVariance'].forEach((key) => {
    assert.ok(covered.indexOf(key) >= 0, '缺少赛季修正说明: ' + key);
  });
});

check('赛季页用的是折叠版，展开后是同一份内容', () => {
  const out = makeApi({ profile: { coachTrust: 6 } }).renderSeasonProfileDetails();
  assert.ok(out.indexOf('<details') === 0, out.slice(0, 40));
  assert.ok(out.indexOf('生涯档案') >= 0);
  assert.ok(out.indexOf('教练信任') >= 0, '展开后应包含具体条目');
  assert.ok(out.indexOf('sr-section-title') < 0, '赛季页标题由 summary 承担，不重复渲染');
});

check('没有生涯状态时不渲染赛季页档案', () => {
  const api = makeApi({ state: {} });
  assert.equal(api.renderSeasonProfileDetails(), '');
  assert.equal(api.renderCareerProfilePanel(), '');
});

console.log('\n全部通过：' + passed + ' 项');
