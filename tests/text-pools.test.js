'use strict';

/**
 * 文案池测试
 * 这些模板是退役、名人堂、GOAT、退役球衣四个高光时刻的台词，一次性看到，写错就露馅。
 * 这里守住三件事：占位符必须都能被替换（不能出现字面的 {longestTeam}）、
 * 池子不能被改小、池子里不能有重复台词。
 * 运行：node tests/text-pools.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'nba-perfect-player.html'), 'utf8');

/** 取出 `var NAME = [ ... ];` 里的字符串条目 */
function readPool(name) {
  const key = 'var ' + name + ' = [';
  const start = html.indexOf(key);
  if (start < 0) throw new Error('找不到文案池: ' + name);
  const end = html.indexOf('\n];', start);
  const seg = html.slice(start + key.length, end);
  return seg.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"') && line.endsWith('",') === false ? line.startsWith('"') : true)
    .filter((line) => line.startsWith('"'))
    .map((line) => line.replace(/^"/, '').replace(/",?$/, ''));
}

/** 取某个 builder 里可用占位符（vars 的键） */
function readVars(fnName) {
  const start = html.indexOf('function ' + fnName + '(');
  const seg = html.slice(start, start + 2200);
  const vs = seg.indexOf('var vars = {');
  const ve = seg.indexOf('\n  };', vs);
  return new Set([...seg.slice(vs, ve).matchAll(/^\s{4}([A-Za-z]+):/gm)].map((m) => m[1]));
}

const poolDefs = [
  // GOAT_COPY 由 buildRetirementCopy 渲染（r.goat 时选它），旧渲染器 buildGoatHistoryCopy 已删。
  { name: 'GOAT_COPY', vars: 'buildRetirementCopy', min: 18 },
  { name: 'HOF_COPY', vars: 'buildHofCopy', min: 127 },
  { name: 'HOF_FAIL_COPY', vars: 'buildHofCopy', min: 84 },
  { name: 'RETIREMENT_COPY', vars: 'buildRetirementCopy', min: 340 },
];

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('文案池测试');

poolDefs.forEach((def) => {
  const entries = readPool(def.name);

  check(def.name + '：池子没被改小（' + entries.length + ' 条）', () => {
    assert.ok(entries.length >= def.min, def.name + ' 应至少 ' + def.min + ' 条，实际 ' + entries.length);
  });

  check(def.name + '：占位符全都有对应变量，不会漏出字面大括号', () => {
    const vars = readVars(def.vars);
    const unknown = new Set();
    entries.forEach((text) => {
      for (const m of text.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
        if (!vars.has(m[1])) unknown.add(m[1]);
      }
    });
    assert.equal([...unknown].join(','), '', def.name + ' 里出现没有替换来源的占位符：' + [...unknown].join(','));
  });

  check(def.name + '：没有重复台词', () => {
    const seen = new Set();
    entries.forEach((text) => {
      assert.ok(!seen.has(text), def.name + ' 出现重复：' + text.slice(0, 24));
      seen.add(text);
    });
  });
});

check('退役球衣：每支球队都有专属说法，且会拼上全联盟共用的 12 条', () => {
  const start = html.indexOf('var JERSEY_TEAM_COPY = {');
  const end = html.indexOf('\n};', start);
  const seg = html.slice(start, end);
  const teams = [...seg.matchAll(/"([A-Z]{3})": \[\n([\s\S]*?)\n  \],/g)];
  assert.equal(teams.length, 30, '应有 30 支球队：' + teams.length);
  teams.forEach(([, code, body]) => {
    const entries = body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('"'));
    assert.ok(entries.length >= 7, code + ' 的专属说法应至少 7 条：' + entries.length);
    entries.forEach((text) => {
      for (const m of text.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
        assert.ok(['team', 'city', 'years', 'achievement'].indexOf(m[1]) >= 0, code + ' 出现未知占位符：{' + m[1] + '}');
      }
    });
  });

  const extras = readPool('JERSEY_TEAM_EXTRA_COPY');
  assert.ok(extras.length >= 12, '共用池应至少 12 条：' + extras.length);
  const vars = readVars('buildJerseyCeremonyCopy');
  extras.forEach((text) => {
    for (const m of text.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
      assert.ok(vars.has(m[1]), '共用池出现未知占位符：{' + m[1] + '}');
    }
  });
  assert.ok(html.indexOf('.concat(JERSEY_TEAM_EXTRA_COPY)') >= 0, '共用池应真的被拼进候选里');
});

check('每个占位符字符串都读得出来（没有引号写坏的行）', () => {
  poolDefs.forEach((def) => {
    readPool(def.name).forEach((text) => {
      assert.ok(text.length > 8, def.name + ' 有过短的条目，可能是引号写坏了：' + JSON.stringify(text));
      assert.ok(text.indexOf('\\"') < 0, def.name + ' 里出现转义引号，格式不对：' + text.slice(0, 24));
    });
  });
});

console.log('\n全部通过：' + passed + ' 项');
