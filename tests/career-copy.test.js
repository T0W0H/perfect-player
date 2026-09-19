'use strict';

/**
 * 生涯总结文案测试
 * buildCareerAchievement / buildJerseyAchievement 是最常被塞进模板里的那句「荣誉句」，
 * 旧版是固定枚举（"生涯里，你写下过 N 座总冠军、N 次MVP……"），读起来像成绩单。
 * 这里验证：说法随生涯形状变化、同一份生涯稳定不变、缺字段不会渲染出 NaN。
 * 运行：node tests/career-copy.test.js
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

const code = [
  extractFunction(html, 'buildCareerAchievement'),
  extractFunction(html, 'buildJerseyAchievement'),
].join('\n');
const build = new Function('getTeamName', code + '\nreturn { career: buildCareerAchievement, jersey: buildJerseyAchievement };');
const fns = build((t) => ({ MIN: '森林狼', LAL: '湖人' }[t] || t));

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('生涯总结文案测试');

const dynasty = { championships: 5, mvp: 3, fmvp: 3, dpoy: 1, allNBA: 8, allStar: 12, points: 32000, games: 1200 };
const noRing = { championships: 0, mvp: 2, fmvp: 0, dpoy: 0, allNBA: 6, allStar: 9, points: 24000, games: 900 };
const defender = { championships: 0, mvp: 0, fmvp: 0, dpoy: 3, allNBA: 2, allStar: 4, points: 9000, games: 800 };
const rolePlayer = { championships: 0, mvp: 0, fmvp: 0, dpoy: 0, allNBA: 0, allStar: 1, points: 4200, games: 420 };
const nobody = { championships: 0, mvp: 0, fmvp: 0, dpoy: 0, allNBA: 0, allStar: 0, points: 1200, games: 180 };

check('旧版那句固定枚举已经消失', () => {
  const text = fns.career(dynasty);
  assert.ok(text.indexOf('生涯里，你写下过') < 0, '不应再出现成绩单式的开头：' + text);
});

check('不同形状的生涯说不同的话', () => {
  const texts = [dynasty, noRing, defender, rolePlayer, nobody].map((r) => fns.career(r));
  assert.equal(new Set(texts).size, texts.length, '五份生涯应给出五种说法：' + texts.join(' / '));
});

check('同一份生涯每次渲染都稳定（不会刷新一次换一句）', () => {
  for (const r of [dynasty, noRing, rolePlayer]) {
    assert.equal(fns.career(r), fns.career(Object.assign({}, r)), '同一份生涯应稳定：' + fns.career(r));
  }
});

check('有冠军的生涯会提到冠军，没冠军但有 MVP 的会提到 MVP', () => {
  assert.ok(fns.career(dynasty).indexOf('总冠军') >= 0, '应提到总冠军：' + fns.career(dynasty));
  assert.ok(fns.career(noRing).indexOf('MVP') >= 0, '应提到 MVP：' + fns.career(noRing));
  assert.ok(fns.career(defender).indexOf('DPOY') >= 0, '防守型生涯应提到 DPOY：' + fns.career(defender));
});

check('荣誉句不会变成冗长的清单（最多再补两项）', () => {
  ['、', '，还有 '].forEach(() => {});
  const text = fns.career(dynasty);
  assert.ok(text.length <= 60, '长度应克制：' + text.length + ' 字 → ' + text);
  const kinds = ['总冠军', 'MVP', 'DPOY', '最佳阵容', '全明星'].filter((k) => text.indexOf(k) >= 0);
  assert.ok(kinds.length <= 3, '不该把五种荣誉全列一遍：' + kinds.join('/'));
});

check('字段缺失或为脏数据时不会渲染出 NaN / undefined', () => {
  const inputs = [
    {}, null, undefined,
    { championships: '2' }, { mvp: NaN },
    { championships: undefined, mvp: null, allStar: '5', points: '9000', games: '400' },
  ];
  inputs.forEach((r) => {
    const text = fns.career(r);
    assert.ok(text && typeof text === 'string', '应始终有文案');
    assert.ok(text.indexOf('NaN') < 0 && text.indexOf('undefined') < 0 && text.indexOf('null') < 0, '脏数据不该漏出来：' + text);
  });
});

check('退役球衣文案同样按荣誉分层', () => {
  const ring = fns.jersey({ team: 'MIN', years: 9, championships: 2, mvp: 1, fmvp: 1, allStar: 6 });
  const noRing = fns.jersey({ team: 'LAL', years: 12, championships: 0, mvp: 0, fmvp: 0, allStar: 4 });
  const plain = fns.jersey({ team: 'MIN', years: 6, championships: 0, mvp: 0, fmvp: 0, allStar: 0 });
  assert.ok(ring.indexOf('冠军') >= 0, '有冠军应提到冠军：' + ring);
  assert.ok(noRing.indexOf('全明星') >= 0, '无冠但进过全明星应提到：' + noRing);
  assert.ok(plain.indexOf('6') >= 0, '什么都没有时应提年限：' + plain);
  assert.ok(plain.indexOf('undefined') < 0 && plain.indexOf('NaN') < 0, '脏数据不该漏出来：' + plain);
  // 球队名不强制出现在每一句（模板里已经有 {team}），但至少有一种说法会带上它
  const withTeam = [1, 2, 3, 4, 5, 6, 7, 8].map((years) => fns.jersey({ team: 'MIN', years, championships: 2, fmvp: 1, allStar: 5 }));
  assert.ok(withTeam.some((t) => t.indexOf('森林狼') >= 0), '应至少有一种说法带上球队名：' + withTeam.join(' / '));
});

check('退役球衣文案同样稳定且长度可控', () => {
  const info = { team: 'MIN', years: 9, championships: 2, mvp: 1, fmvp: 1, allStar: 6 };
  assert.equal(fns.jersey(info), fns.jersey(Object.assign({}, info)));
  assert.ok(fns.jersey(info).length <= 55, '长度应克制：' + fns.jersey(info));
});

console.log('\n全部通过：' + passed + ' 项');
