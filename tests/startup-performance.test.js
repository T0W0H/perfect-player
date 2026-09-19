'use strict';

/**
 * 首屏性能回归测试
 * 背景：按钮是 JS 画的（DOMContentLoaded → renderModeSelect），12 个外部脚本
 * 曾经全是同步的，国内打开时白屏 1~2 分钟。这里守住三件事：
 *   1. 所有外部脚本必须 defer（顺序保留，解析不阻塞，先画出 loading 壳）
 *   2. 内联代码在解析期不许裸用外部全局变量（defer 下它们还不存在），
 *      只能声明函数或做 typeof 守卫，初始化统一走 DOMContentLoaded
 *   3. 头像不许请求国外 CDN（国内超时几十秒，CSS 背景还没有超时控制）
 * 运行：node tests/startup-performance.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'nba-perfect-player.html'), 'utf8');

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + label);
}

console.log('首屏性能回归测试');

check('所有外部脚本都有 defer（顺序保留，解析不阻塞）', () => {
  const tags = [...html.matchAll(/<script([^>]*)src="([^"]+)"([^>]*)>/g)];
  assert.ok(tags.length >= 12, '外部脚本应有 12 个，实际 ' + tags.length);
  const sync = tags.filter((m) => !/defer/.test(m[1] + m[3]));
  assert.equal(sync.length, 0, '还有同步脚本：' + sync.map((m) => m[2]).join(', '));
});

check('loading 壳存在，且在第一个外部脚本之前', () => {
  const shell = html.indexOf('id="bootShell"');
  const firstExt = html.search(/<script[^>]*\bsrc=/);
  assert.ok(shell > 0, '找不到 #bootShell');
  assert.ok(firstExt > 0 && shell < firstExt, 'loading 壳必须在外部脚本之前才能先画出来');
  assert.ok(html.includes("getElementById('bootShell')"), '启动时应藏起 loading 壳');
});

check('启动监听器先做懒初始化，再渲染菜单', () => {
  const start = html.indexOf("document.addEventListener('DOMContentLoaded'");
  assert.ok(start > 0, '找不到启动监听器');
  const seg = html.slice(start, start + 600);
  assert.ok(seg.includes('initAttrTables()'), '应先初始化属性表');
  assert.ok(seg.includes('fixPlayerCN()'), '中文名修正应挪到这里（解析期数据还不存在）');
  const order = [seg.indexOf('initAttrTables()'), seg.indexOf('renderModeSelect()')];
  assert.ok(order[0] >= 0 && order[0] < order[1], '属性表初始化必须在渲染菜单之前');
});

check('内联顶层没有裸用的外部全局变量（defer 下会 ReferenceError）', () => {
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const ext = ['NBA2K_DATA', 'NBA2K_TEAMS', 'NBA2K_SCHEDULE', 'NBA2K_ARCHETYPES', 'SIM_CONFIG', 'NBA_PLAYER_IMAGES', 'VaFuSDK'];
  const bad = [];
  blocks.forEach((b, i) => {
    let depth = 0;
    let line = '';
    const flush = () => {
      const s = line.trim();
      line = '';
      if (!s || depth !== 0) return;
      if (/^(function |if |for |while |switch |catch|try|return |else|do |class |import |export )/.test(s)) return;
      if (s[0] === '/' || s[0] === '*' || s[0] === '}' || s[0] === '{') return;
      for (const g of ext) {
        if (new RegExp('(?<![\\w$])' + g + '(?![\\w$])').test(s) && s.indexOf('typeof ' + g) < 0) {
          bad.push('块#' + (i + 1) + ' [' + g + '] ' + s.slice(0, 80));
          break;
        }
      }
    };
    for (const ch of b) {
      if (ch === '\n') flush();
      else {
        line += ch;
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);
      }
    }
  });
  assert.equal(bad.length, 0, '解析期裸用外部变量：\n' + bad.join('\n'));
});

check('属性表是懒初始化的（const 裸用 SIM_CONFIG 会在 defer 下炸）', () => {
  assert.ok(!html.includes('const ATTR_KEYS = SIM_CONFIG'), '还有解析期裸用的 const ATTR_KEYS');
  assert.ok(html.includes('function initAttrTables()'), '找不到 initAttrTables');
});

check('中文名修正不是立即执行函数（解析期数据不存在会永远跳过）', () => {
  assert.ok(!html.includes('(function fixPlayerCN()'), 'fixPlayerCN 又变回 IIFE 了');
  assert.ok(html.includes('function fixPlayerCN()'), '找不到 fixPlayerCN 定义');
});

check('头像不用国外 CDN 做兜底', () => {
  const start = html.indexOf('function getPlayerHeadshotStyle(');
  assert.ok(start > 0, '找不到 getPlayerHeadshotStyle');
  const end = html.indexOf('</script>', start);
  const lines = html.slice(start, end).split('\n');
  const leaking = lines.filter((l) => l.includes('background-image') && (l.includes('cdn.nba.com') || l.includes('espncdn') || l.includes('_hsOfficialRemotePath')));
  assert.equal(leaking.length, 0, '头像兜底还在请求国外 CDN：\n' + leaking.join('\n'));
  assert.ok(html.slice(start, end).includes('_hsInitialsAvatar'), '兜底应是首字母头像');
});

console.log('\n全部通过：' + passed + ' 项');
