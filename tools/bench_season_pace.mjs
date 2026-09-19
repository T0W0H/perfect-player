/**
 * 赛季节奏基准：一次常规赛（82 场）到底花多少 CPU
 *
 * 用法：node tools/bench_season_pace.mjs
 *
 * 不是为了跑测试，是为了回答「为什么感觉慢」：
 * 定时器只是下限，真正决定体感的是每场之后要模拟多少场联盟比赛 + 重绘多少 DOM。
 * 这里只量引擎部分的 CPU（DOM 量不到，但两者相加才是体感）。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'nba-perfect-player.html'), 'utf8');

function seededMath(seed) {
  const math = Object.create(Math);
  let state = seed >>> 0;
  math.random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  return math;
}

/* 装引擎：和 tests/current-ratings-simulation.js 同一套切片方式 */
const macroStart = html.indexOf('function simGaussian');
const macroEnd = html.indexOf('function simulateGameNew', macroStart);
if (macroStart < 0 || macroEnd < 0) throw new Error('找不到比赛引擎');

const powerMap = {};
const macroContext = {
  Math: seededMath(82526), console,
  STATE: { careerTeam: null, career: null, finalOVR: 0, _simPowerBaseline: null },
  NBA2K_TEAMS: [],
  calcTeamPowerWithPlayer: (t) => powerMap[t],
  getNextSeasonMods: () => ({}),
  getCareerProfileEffects: () => ({ gameOffenseBonus: 0, gameDefenseBonus: 0, gameVarianceBonus: 0 }),
  generateBoxScore: () => null,
};
vm.createContext(macroContext);

/* 先把名单灌进 vm 之外，方便造出真实的 30 队 power 缓存 */
const rosterCtx = { window: {} };
vm.createContext(rosterCtx);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'assets/js/hupu/script-01-2678-5hu3djrc-upload-1783494754597-12.js'), 'utf8') +
  '\n;globalThis.__D = NBA2K_DATA; globalThis.__T = NBA2K_TEAMS;',
  rosterCtx,
);
const teams = rosterCtx.__T;
macroContext.NBA2K_TEAMS = teams;

/* 用名单总评造一个粗略 power，只要量 CPU，不需要精确 */
teams.forEach((t) => {
  const roster = rosterCtx.__D[t] || [];
  const avg = roster.length ? roster.reduce((s, p) => s + (Number(p.ovr) || 70), 0) / roster.length : 70;
  powerMap[t] = { offense: avg, defense: avg, athletic: avg, clutch: avg, depth: avg };
});

vm.runInContext(html.slice(macroStart, macroEnd), macroContext, { filename: 'matchup-engine.js' });

/* 量：一场联盟比赛（不含球员数据） */
const N = 2000;
let t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) {
  macroContext.simulate82StyleMatchup(teams[i % 30], teams[(i + 7) % 30], { teamAHome: true, includeBoxScore: false, leagueGame: true });
}
let ms = Number(process.hrtime.bigint() - t0) / 1e6;
const perLeagueGame = ms / N;

console.log('一场联盟比赛（simulate82StyleMatchup，不含 boxScore）: ' + perLeagueGame.toFixed(3) + ' ms');
console.log('');
// 一个比赛日约 15 场（30 队），每场之后要补当天没算的联盟比赛
const LEAGUE_GAMES_PER_DAY = 15;
const REGULAR_GAMES = 82;
console.log('推算一场常规赛的引擎开销: ' + (perLeagueGame * LEAGUE_GAMES_PER_DAY).toFixed(1) + ' ms（' + LEAGUE_GAMES_PER_DAY + ' 场联盟比赛）');
console.log('推算整个常规赛的引擎开销: ' + (perLeagueGame * LEAGUE_GAMES_PER_DAY * REGULAR_GAMES / 1000).toFixed(1) + ' s');
console.log('定时器开销: ' + (0.055 * REGULAR_GAMES).toFixed(1) + ' s（SIM_PACE.regularGame=55ms）');
console.log('');
console.log('结论：如果引擎开销明显大于定时器，那调 setTimeout 是没用的，得缓存/减算。');
