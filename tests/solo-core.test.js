'use strict';

/**
 * 单核（一个人扛起球队）判定与文案测试
 * 背景：生涯评价里以前只有「留队 / 换队」这一个维度，留队的人会被写成
 * 「一个人扛起球队」——但留队只是没走，单核是队里真的只有你一个球星。
 * 现在把单核单独判：你是全队唯一的总评 88+（与 TEAMMATE_USAGE_RULES.starOvr 同口径）。
 * 运行：node tests/solo-core.test.js
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

const starOvr = Number(/starOvr:\s*(\d+)/.exec(html)[1]);

/** 跑单核判定：roster 是队友名单（不含自己），myOvr 是自己的总评 */
function judge(myOvr, roster, seasons) {
  const code = [
    'var TEAMMATE_USAGE_RULES = { starOvr: ' + starOvr + ' };',
    'var NBA2K_DATA = { LAL: __ROSTER };',
    'var STATE = { careerTeam: "LAL", finalOVR: __MYOVR, career: { seasons: __SEASONS } };',
    extractFunction(html, 'countTeammateStars'),
    extractFunction(html, 'isSoloCoreSeason'),
    extractFunction(html, 'getSoloCoreSeasons'),
    extractFunction(html, 'hasSoloCoreChampionship'),
    'return { isSolo: isSoloCoreSeason(), stars: countTeammateStars(), solo: getSoloCoreSeasons().length, champ: hasSoloCoreChampionship() };',
  ].join('\n');
  return new Function('__ROSTER', '__MYOVR', '__SEASONS', code)(roster, myOvr, seasons || []);
}

/** 跑生涯叙事标签 */
function narrativeTags(myOvr, roster, seasons, facts) {
  const code = [
    'var TEAMMATE_USAGE_RULES = { starOvr: ' + starOvr + ' };',
    'var NBA2K_DATA = { LAL: __ROSTER };',
    'var STATE = { careerTeam: "LAL", finalOVR: __MYOVR, career: { seasons: __SEASONS } };',
    'function analyzeTeamEras() { return []; }',   // 只测单核标签，时代分析不在本测试范围
    extractFunction(html, 'countTeammateStars'),
    extractFunction(html, 'isSoloCoreSeason'),
    extractFunction(html, 'getSoloCoreSeasons'),
    extractFunction(html, 'hasSoloCoreChampionship'),
    extractFunction(html, 'analyzeCareerNarrative'),
    'return analyzeCareerNarrative(__FACTS);',
  ].join('\n');
  return new Function('__ROSTER', '__MYOVR', '__SEASONS', '__FACTS', code)(roster, myOvr, seasons || [], facts || {});
}

const solo = [{ soloCore: true, playoffResult: '总决赛' }, { soloCore: true, playoffResult: '首轮' }, { soloCore: true, playoffResult: '分区决赛' }];
const soloRing = [{ soloCore: true, playoffResult: '总决赛·总冠军' }, { soloCore: true, playoffResult: '首轮' }, { soloCore: true, playoffResult: '首轮' }];
const noStars = [{ name: '队友甲', ovr: 76 }, { name: '队友乙', ovr: 81 }];
const oneStar = [{ name: '队友甲', ovr: 90 }, { name: '队友乙', ovr: 81 }];

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('单核判定测试');

check('自己是唯一球星 → 单核', () => {
  const r = judge(92, noStars);
  assert.equal(r.isSolo, true, '92 分且队内无 88+ 应是单核');
  assert.equal(r.stars, 0);
});

check('队里还有另一个球星 → 不是单核', () => {
  const r = judge(92, oneStar);
  assert.equal(r.isSolo, false, '队里有 90 分队友就不算单核');
  assert.equal(r.stars, 1);
});

check('自己没到球星线 → 不是单核（弱队的普通首发不算）', () => {
  assert.equal(judge(84, noStars).isSolo, false, '84 分不该算单核');
  assert.equal(judge(87, noStars).isSolo, false, '87 分是线外');
  assert.equal(judge(88, noStars).isSolo, true, '88 分是线内');
});

check('拿不到名单时不下结论（不给玩家白发荣誉）', () => {
  assert.equal(judge(95, []).isSolo, false, '空名单应返回 false');
});

check('自己不在名单里时也不会把自己数成队友球星', () => {
  const r = judge(95, [{ name: '我', ovr: 95, _isUser: true }, { name: '队友', ovr: 70 }]);
  assert.equal(r.stars, 0, '_isUser 的本人不能算队友球星');
  assert.equal(r.isSolo, true);
});

check('生涯统计：单核赛季数 / 单核夺冠', () => {
  assert.equal(judge(92, noStars, solo).solo, 3);
  assert.equal(judge(92, noStars, solo).champ, false);
  assert.equal(judge(92, noStars, soloRing).champ, true, '单核赛季里夺冠才算单核夺冠');
});

check('旧存档没有 soloCore 字段时不报错，也不算单核', () => {
  const legacy = [{ seasonNum: 1, team: 'LAL' }, { seasonNum: 2, team: 'LAL' }];
  const r = judge(92, noStars, legacy);
  assert.equal(r.solo, 0);
  assert.equal(r.champ, false);
});

check('单核标签只在够格时出现', () => {
  const none = narrativeTags(92, noStars, [{ soloCore: false }, { soloCore: false }], {});
  assert.ok(none.tags.indexOf('solo_core') < 0, '没有单核赛季不该有 solo_core');
  const two = narrativeTags(92, noStars, [{ soloCore: true }, { soloCore: true }], {});
  assert.ok(two.tags.indexOf('solo_core') < 0, '只有两季单核还不到门槛（需要 3 季）');
  const three = narrativeTags(92, noStars, solo, {});
  assert.ok(three.tags.indexOf('solo_core') >= 0, '三季单核应有 solo_core');
  assert.equal(three.soloCoreYears, 3, '应把单核赛季数带出来');
});

check('单核夺冠是独立标签', () => {
  const r = narrativeTags(92, noStars, soloRing, {});
  assert.ok(r.tags.indexOf('solo_champion') >= 0, '单核夺冠应有 solo_champion');
  assert.equal(r.shape, 'solo_core', '单核的叙述形状应盖过留队/换队');
});

check('留队不等于单核：留守但没有单核赛季 → 只有 one_city，没有 solo_core', () => {
  const facts = { 球队数: '1', 赛季数: '10', 总冠军: '1', MVP: '1', FMVP: '1', DPOY: '0', 最佳阵容: '5', 场均得分: '26', 场均助攻: '5', 场均抢断: '1', 场均盖帽: '0.4', 退役年龄: '36', 历史档位: '优秀职业球员' };
  const r = narrativeTags(90, oneStar, [{ soloCore: false }, { soloCore: false }, { soloCore: false }], facts);
  assert.ok(r.tags.indexOf('one_city') >= 0, '一队效力应有 one_city');
  assert.ok(r.tags.indexOf('solo_core') < 0, '有球星队友的留队球员不该被写成单核');
  assert.equal(r.shape, 'one_city', '形状仍应是 one_city，而不是 solo_core');
});

/* ---------- 文案体检 ---------- */
const evalStart = html.indexOf('var CAREER_EVAL_PARAGRAPHS = {');
const evalEnd = html.indexOf('\n};', evalStart);
const evalPool = new Function('return ' + html.slice(evalStart + 'var CAREER_EVAL_PARAGRAPHS = '.length, evalEnd + 2).replace(/;$/, '') + ';')();

check('新增的 solocore / solocore_champion 两套评价都在，且不是空池', () => {
  assert.ok(Array.isArray(evalPool.solocore) && evalPool.solocore.length >= 8, 'solocore 池子太小：' + (evalPool.solocore || []).length);
  assert.ok(Array.isArray(evalPool.solocore_champion) && evalPool.solocore_champion.length >= 5, 'solocore_champion 池子太小');
});

check('新文案的占位符全都能被替换（不留字面大括号）', () => {
  const factsCode = [
    'var SIM_CONFIG = { POSITIONS: {} };',
    'var STATE = { position: "SF", career: { seasons: [], honors: [], totalStats: {}, flags: {}, profile: {}, legacy: {} } };',
    'function getTeamName(t) { return t || "球队"; }',
    'function getBondedTeammateName() { return "队友"; }',
    'function isRookieHonorForLaterSeason() { return false; }',
    html.slice(html.indexOf('var CAREER_EVAL_IDENTITY_LABELS'), html.indexOf('function fillCareerEvaluationText(')),
    'return buildCareerEvaluationFacts();',
  ].join('\n');
  const facts = new Function(factsCode)();
  ['solocore', 'solocore_champion'].forEach((cat) => {
    evalPool[cat].forEach((text, i) => {
      const missing = [...text.matchAll(/\{([^{}]+)\}/g)]
        .map((m) => m[1])
        .filter((k) => !Object.prototype.hasOwnProperty.call(facts, k));
      assert.equal(missing.length, 0, cat + ' 第 ' + (i + 1) + ' 条有填不上的占位符：' + missing.join('、'));
    });
  });
});

check('单核文案不带冠军线误伤：无冠时不会写出「0次总冠军」', () => {
  evalPool.solocore.forEach((text) => {
    assert.ok(text.indexOf('{冠军线}') < 0, 'solocore 池（可能是无冠生涯）不能引用冠军线');
  });
  assert.ok(evalPool.solocore_champion.some((t) => t.indexOf('{冠军线}') >= 0), 'solocore_champion 应该会提到冠军');
});

check('新评价类别已接入打分（够格时才会被选中）', () => {
  const scoreCode = [
    'var STATE = { career: __CAREER };',
    'var TEAMMATE_USAGE_RULES = { starOvr: ' + starOvr + ' };',
    'function getBranchNode() { return "start"; }',
    'function isRookieHonorForLaterSeason() { return false; }',
    html.slice(html.indexOf('var CAREER_EVAL_IDENTITY_LABELS'), html.indexOf('function buildCareerEvaluationFacts(')),
    extractFunction(html, 'getSoloCoreSeasons'),
    extractFunction(html, 'hasSoloCoreChampionship'),
    extractFunction(html, 'buildCareerEvaluationScores'),
    'return buildCareerEvaluationScores();',
  ].join('\n');
  const run = (career) => new Function('__CAREER', scoreCode)(career);
  const base = { honors: [], totalStats: { games: 800 }, seasons: [], flags: {}, profile: {}, legacy: {} };
  assert.equal(run(Object.assign({}, base)).solocore, undefined, '没有单核赛季不该有单核分');
  const three = run(Object.assign({}, base, { seasons: [{ soloCore: true }, { soloCore: true }, { soloCore: true }] }));
  assert.ok(three.solocore >= 5, '三季单核应拿到足够高的分数，实际 ' + three.solocore);
  const champ = run(Object.assign({}, base, { seasons: soloRing }));
  assert.ok(champ.solocore_champion >= 5, '单核夺冠应拿到足够高的分数，实际 ' + champ.solocore_champion);
});

console.log('\n全部通过：' + passed + ' 项');
console.log('（starOvr = ' + starOvr + '，与 TEAMMATE_USAGE_RULES 同口径）');
