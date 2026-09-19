# Perfect Player

一个纯网页的篮球生涯模拟游戏：创建自己的球员，从现役球员与名人堂/近代全明星惊喜卡身上获取能力，完成一个虎扑风格的 NBA 单赛季。

在线体验：<https://t0w0h.github.io/perfect-player/>

> 上游原版（zyz9408）：<https://zyz9408.github.io/perfect-player/>。本仓库是它的分支，线上跑的是本仓库自己的版本。

## 发布（GitHub Pages，免费）

- **唯一真源是 `nba-perfect-player.html`**；`index.html` 只是一张跳转页，不要往里面塞代码。
- 开启方式（只需做一次）：仓库 `Settings` → `Pages` → Source 选 `Deploy from a branch` → Branch 选 `main` + `/ (root)` → Save。
- 地址：<https://t0w0h.github.io/perfect-player/>。之后 `main` 每次 push 会自动重新发布，不需要额外操作。
- 公开站点**不会**加载 `assets/data/local/`：该目录在 `.gitignore` 里，且页面只在非 `github.io` 域名下才会尝试加载（避免分发第三方名单）。
- 想让仓库转私有还能发布，可以换 Cloudflare Pages / Netlify（免费额度支持私有仓库）。

## 首屏性能（国内慢，重灾区）

按钮是 JS 画的（`DOMContentLoaded` → `renderModeSelect`），以前 12 个外部脚本全同步，
白屏 1~2 分钟。现在的策略（`tests/startup-performance.test.js` 锁住）：

- 12 个外部脚本全部 `defer`：顺序保留，解析不阻塞；`defer` 的脚本保证在
  `DOMContentLoaded` 前按序执行完，所以启动监听器里的顺序不用变。
- 纯静态 loading 壳（#bootShell）：零 JS 依赖，随 HTML 流式先画出来，启动后藏起。
- 内联代码解析期不许裸用外部全局变量：属性表（`SIM_CONFIG`）改成 `initAttrTables()`
  懒初始化，中文名修正（`fixPlayerCN`）挪到启动监听器里——defer 下解析期这些变量还不存在。
- 头像只用本地图：现役 525 人、历史池、新秀人人有本地文件；`cdn.nba.com` 兜底已删
  （国内超时几十秒，CSS 背景还没有超时控制，空挂不如显示首字母头像）。

定版前不做的两件事（开发阶段维护税太高，定版再动手）：

- 内联大块（1136KB 核心逻辑 + 371KB）外置：省约 400KB 传输，但每次改逻辑都要同步改版本号。
- 静态资源走 jsDelivr：国内快且可长期缓存，但要版本锁定 + 冷缓存预热，跟频繁发版犯冲。

## 本地运行

这是静态网页项目，不需要 Unity 或构建工具。使用任意静态服务器打开项目根目录即可，例如：

```bash
python -m http.server 8035
```

然后访问 <http://localhost:8035/>。

## 历史头像（仓库瘦身策略）

`assets/data/historical/headshots/` 里**只保留游戏运行时真正引用的那批**（443 张，已缩到 192px，共约 7 MB）。

- 历史上它曾包含 5886 张（包括 1947 年以来每一届选秀的每位球员），工作区 395 MB、`.git` 262 MB，克隆极慢
- 现在该目录已写进 `.gitignore`：用 `python tools/fetch_historical_headshots.py` 重新下载的原图**不会再被提交**
- 新增的运行时引用图片需要显式提交：`git add -f assets/data/historical/headshots/<文件名>`
- `assets/data/historical/*.json`（`players.json` 等）来自外部数据源，仓库里没有生成脚本，**必须保留**

## 生涯评价：留队 ≠ 单核

这两件事以前是混着的：评价里只有「留队 / 换队」一个维度（看球队数），
所以一直留守的人会被写成「一个人扛起球队」——但留队只是没走，单核是队里真的只有你。

现在单核单独判，且与现有的 `TEAMMATE_USAGE_RULES.starOvr`（88）同口径：

- **单核赛季**：你是全队唯一的总评 88+（自己 ≥ 88 且队内没有第二个 88+）。
- 队友实力会随交易/成长变，事后无法从存档反推，所以 `saveCurrentSeasonToCareer()`
  在当年就把 `soloCore` / `teammateStars` 写进赛季记录；旧存档没这个字段只当没有，不报错。
- 名单拿不到时不下结论（返回 false）——宁可不算，也不凭空给玩家发荣誉。
- 生涯层：单核 ≥ 3 季 → `solo_core` 标签；单核赛季里拿到总冠军 → `solo_champion`。

接入两套评价：

- 生涯评价文案（`CAREER_EVAL_PARAGRAPHS`）新增 `solocore` / `solocore_champion` 两个类别，
  由 `buildCareerEvaluationScores()` 按单核赛季数打分（2/3/5 季 → 3/6/8 分，单核夺冠额外 9 分）。
- 生涯传记（`CAREER_BIOGRAPHY_RULED_COPY`）的 title / lead / core 三个段落各加了
  带 `solo_core`、`solo_champion` 标签的写法；`shape` 也会被单核盖过，
  保证「留队的单核」和「留队的普通球星」写法不同。

`tests/solo-core.test.js` 守住判定边界（88 分线、_isUser 不算队友球星、空名单不下结论、
旧存档兼容）、留队≠单核、以及新文案的占位符体检（无冠时不许引用 `{冠军线}`）。

## 荣誉墙：数据王单独成组

「生涯数据 → 荣誉墙」底部的生涯总计以前是一行 `N×奖项` 按获得先后混排，
赛季一多就看不出拿过几次得分王。现在按固定顺序分成两行：

- `荣誉：`总冠军 / FMVP / MVP / DPOY / 最佳阵容 / 最佳防守阵容 / 全明星 / 最佳第六人 …（`HONOR_TALLY_ORDER`）
- `数据王：`得分王 / 篮板王 / 助攻王 / 三分王 / 抢断王 / 盖帽王（`DATA_KING_LABELS`）

旧存档里不在两张表里的自定义标签会兜底接在荣誉行后面，不会丢。
数据王本来就写在 `c.honors` 里（`saveCurrentSeasonToCareer` 只看 `isUser`），
`tests/career-honors.test.js` 守住这条链。

## 清扫工具（只报告，不直接删）

```bash
node tools/find_dead_assets.mjs      # 没有任何地方引用的资源文件
node tools/find_dead_functions.mjs   # 定义了但没人调用的函数
node tools/remove_dead_functions.mjs # 删死函数（默认 dry-run，--write 才真删）
```

`remove_dead_functions.mjs` 有三道闸，任何一道不过就不写文件：

1. **工作区脏就拒跑**（`--allow-dirty` 可强制）。批量重写 + 未提交改动 = 出错时无法干净
   回滚，只能在一堆手工修改和错误删除之间二选一，最后只能重做。先做一次检查点提交，
   出问题就是一条 `git checkout` 的事。
2. 写入前先存一份 `nba-perfect-player.html.bak`，并打出还原命令（该后缀已在 `.gitignore`）。
3. 写入前跑内联脚本语法检查，再对一下分节标题数量——**分节标题是多个测试的切片锚点**，
   少一个就会让一批测试找不到引擎切片。

它也不会把分节标题当函数注释吃掉。统计引用时**会先去掉注释**：否则「说明某函数已废弃」
的注释反而会把死函数救活（`renderGameCastNew`、`showRetirementModal` 就是这样漏过第一轮的）。

已经清掉的：

- 7 个从未被加载的脚本 / 样式（`sim.js` 673KB、`text-pools.js` 504KB、`core.js`、
  `perfect-player.js`、`text-pools-extra.js`、`text-pools-long.js`、`perfect-player.css`）
- `assets/js/hupu/script-04-*.js`（精灵图头像，6 个导出全是零引用，每次却要下载 27KB）
- 47 个死函数（含 `showCareerHonors` 那份没人跳转的重复荣誉页、
  `getOssClient` 里硬编码的第三方凭据），修掉注释误判后又补删 4 个
  （`renderGameCastNew`、`showRetirementModal`、`af`、`isHiddenRetiredPlayer`）
- `assets/data/names.json`（117KB 随机姓名库，新秀已改用真实历史球员）

删死函数会把只被**测试**引用的函数也当成死的（比如 `getTripleChaseMoments`），
所以遇到测试报「找不到函数」时，先确认那个功能是不是已经被新接口取代、
再把测试改指向活着的那个，而不是把旧函数加回来。

## 赛季节奏与赛后文案

**节奏**集中在 `SIM_PACE` 一处，不要去改各处 `setTimeout` 的字面量：

| 项 | 值 | 依据 |
| --- | --- | --- |
| `regularStart` | 60ms | 隔壁 BuildMyNBAPlayer 线上版同值 |
| `regularGame` | 0ms | 隔壁 `simStepDelay(){return 0}`——82 场一口气刷完（`setTimeout(0)` 仍会让出主线程，UI 照常一场场更新） |
| `playoffGame` | 800ms | 隔壁 600ms；我们单场简报现在有 2~3 句文案要读，稍慢一点 |

实测（`node tools/bench_season_pace.mjs`）：一场联盟比赛只占 0.023ms，整个常规赛引擎开销不到 1s。
所以**体感慢只可能是定时器造成的，不是算不过来**——调节奏就调 `SIM_PACE` 就够了。

**赛后文案**由 `buildPostGameLines(stats, ctx)` 统一生成，常规赛与季后赛共用。
只有一条原则：**只说真的发生过的事**。

- 绝杀 / 反绝杀 / 加时 / 加时绝杀：看引擎实际产生的 `keyEvents`
  （`关键回合守住胜局` / `最后回合惜败` / `爆冷`），不是按分差猜的
- 对手表现：从真实 `boxScore` 取对手得分最高的人，以及全队命中率
- 自己：三双 / 两双 / 40+ / 手感冰凉（要求出手数够多，不随便扣帽子）
- 季后赛额外：赛点 / 悬崖边 / 抢七 / 被淘汰

优先级 比赛结尾 > 自己 > 系列赛 > 对手，**常规赛最多 2 句，季后赛 3 句**。
文案在比赛生成时就算好存进 `gameEntry.narrative`（重绘不会换句），然后：

- **常规赛高光场次**：真的发生大场面时（绝杀 / 加时 / 爆冷 / 三双 / 40+）
  用 `showEventModal` 弹一次——与剧情事件**同一个弹窗接口**，
  触发器是 `getRegularGameSpotlight()`。冷却 4 场、每季上限 12 次，
  防止 82 场把玩家烦死；三双文案（`getTripleChaseNote`）也并进这个弹窗
- 其余常规赛场次：进点阵图每个点的 `title`（悬停即看）+ 本季高光区块
- 季后赛：显示在单场简报里

`tests/post-game-lines.test.js`（21 项）守住每种情况的判定边界，
包括“没给 boxScore 就不许提具体对手”、“最多 3 句”、
弹窗的冷却与每季上限、以及常规赛文案确实比季后赛短。

## 开发约定

- 改完功能先验证：逐个跑 `tests/*.test.js`，再跑一遍内联脚本语法检查
  （`node -e` 抽取 `<script>` 块 + `new Function`，见 `tests/` 里的做法）。
- **每次功能迭代顺手做一次小扫除**：删掉被注释掉的旧实现、消除重复定义、清掉确无用处的函数。
- **要加新功能 / 拆新模块时再拆文件**，顺序是「纯工具与文本池 → 模拟引擎 → 展示层」，不要大爆炸式重构。
- 提交信息用中文。

## 内容

- 统一篮球风格的 Perfect Player UI
- 已移除“征服联盟”模式
- 6 张球员大头照：亚洲 2 张、白人 2 张、黑人 2 张
- 固定 2025-26 单赛季：属性来源按“随机年份 → 随机球队 → 随机球员”生成
- 属性抽取池：30 支球队各保留 12 名现役球员，另有 5 张名人堂/近代全明星历史惊喜卡
- 比赛、赛季模拟、奖项名单仍只使用现役球员；历史球员只在选属性阶段出现
- 每轮固定抽取 5 人，同轮不重复；历史卡有 20% 轮次概率出现，且每轮最多 1 张
- 历史惊喜卡优先名人堂球员，名人堂不足时使用 1984 年后全明星；特里·卡明思、诺姆·尼克松不进入历史惊喜池
- 所有历史惊喜卡均直接读取 `assets/data/perfect-player-historical-peak-table.json` 中固定的 150 张巅峰卡；日常生成不再扫描 1–19 号名单
- 普通重选用完后可使用最多 3 次模拟广告重选，暂不接入真实广告 SDK
- 现役球员头像沿用虎扑 BuildPlayer 的 `NBA_PLAYER_IMAGES` → NBA player ID → `260x190` 头像接口，并已全部本地缓存
- 2026 年 60 个选秀顺位均补齐 NBA 官方资料页大头照；官方 CDN 尚未更新的少数新秀使用 NBA 官方选秀媒体肖像，不使用灰色占位剪影
- NBA CDN 尚未更新头像的 3 名现役球员使用 ESPN 官方球员资料大头照作为备用源，并一并本地缓存
- 历史惊喜球员头像由 NBA CDN 批量抓取并本地化，灰色占位图自动替换为项目历史缓存或公开真实肖像；历史缓存中的特里·卡明思、诺姆·尼克松头像也已补齐
- 头像与游戏数据均从网页本地资源加载
- `tools/generate_ai_avatars.py` 可使用 DashScope API 重新生成头像；API Key 只从环境变量读取，不写入仓库

## 头像生成 API

```powershell
$env:DASHSCOPE_API_KEY = '你的 API Key'
python tools/generate_ai_avatars.py
```

脚本默认使用 DashScope 的 `wan2.2-t2i-plus`，也支持通过 `DASHSCOPE_BASE_URL`、`DASHSCOPE_WORKSPACE_ID` 和 `DASHSCOPE_REGION` 配置兼容环境。

## 精选名单与头像来源

```powershell
python tools/build_perfect_player_pool.py
python tools/fetch_hupu_current_headshots.py
python tools/fetch_historical_headshots.py
```

虎扑参考页：<https://activity-static.hupu.com/colorbox-activities/activity-project-ai-1783761934042/__ai_app.html>。
现役头像模板：`https://cdn.nba.com/headshots/nba/latest/260x190/{nbaId}.png`。
历史头像来源模板：`https://cdn.nba.com/headshots/nba/latest/1040x760/{nbaId}.png`。下载后的静态图片随网页发布，运行时不依赖外部头像接口。
2026 选秀头像清单：`assets/data/official-headshot-manifest.json`；抓取脚本：`tools/fetch-official-headshots.js`。

## Current historical-player rules

- Historical surprise cards are drawn with a 20% chance, with at most one historical card per round.
- The 150 peak cards are frozen in `assets/data/perfect-player-historical-peak-table.json` (30 teams × PG/SG/SF/PF/C).
- Normal pool builds read that table directly and do not scan `rosters01.csv` through `rosters19.csv` to recalculate peak cards.

## 历史球员新秀名单（未来赛季不再用匿名名单）

2026/2027 两届选秀用完后，未来赛季的新秀会从真实历史球员里抽取（1947-2026 共 80 届选秀）。
名单由仓库里的数据生成为 `assets/js/historical-rookie-pool.js`（232 KB，gzip 83 KB，页面空闲时才加载）：

```bash
node tools/build_historical_rookie_pool.mjs
```

- 姓名/位置/选秀年份来自 `assets/data/historical/draft_classes.json`；总评由真实生涯评分种子换算。
- 属性画像来自 `assets/data/historical/player_seasons_*.json`（63 个赛季的真实技术统计）：
  篮板怪真的是篮板怪，组织后卫真的会传球（只对篮板/传球/盖帽/抢断/三分/终结六项做偏移，其余属性不做臆测）。
- 头像只引用 `assets/data/historical/headshots/` 里已存在的文件，不会产生碎图。
- 抽不到有真实数据的球员时退回按总评生成，不会报错；名单文件加载失败时会退回旧的长尾名单。

## 球员属性：数据从哪来、谁说了算

同一份名单在启动时会被多次写入，顺序固定，每步只负责一件事：

1. `assets/js/hupu/script-01-*.js`：基础名单（30 队 / 525 人，虎扑 BuildPlayer 的 `NBA2K_DATA`）。
2. `assets/js/current-player-ratings-2026.js`：**唯一权威属性来源**。13 项属性直接采用 2K26
   数值（见下节），逐人覆盖并标上 `ratingSeason` / `ratingBasis` / `ratingSource`。
   重新生成：`node tools/update_current_player_ratings_2026.mjs`，然后接着跑
   `node tools/merge_2k_ratings.mjs`（把 2K 数值合进来，否则会被真实数据推导冲掉）。
3. `assets/data/local/nba2k-data.local.js`（可选）：默认**不加载**，只有显式带上 `?localpool=1` 才生效。
   该文件与仓库自带名单的人员完全相同（实测 30 队 / 525 人 / 零差异），只会提供另一套属性，
   所以没必要让它参与启动顺序；真需要覆盖名单时再开参数。
4. 赛季推进中的写入：`applyDraftClass2026()` 注入 2026 届新人、`processDraft()` / `evolveLeague()`
   注入未来新秀（含历史球员池）、`applyAnnualAttributeDrift()` 做年龄漂移。
5. 玩家自己的 `STATE.attrs` 与联盟名单分离：手动加点封顶 99，软上界 120 只由后端事件/趋势使用。

两张派生表不再写死，而是跟着当前名单实时计算：

- `refreshPositionAverages()`：位置平均属性（跨位置衰减、相似球员匹配都用它）。
- `getPosPenalty()`：跨位置衰减只扣掉六成的位置差距（系数 `POS_TRANSFER_DISCOUNT`）。

剧情 / 训练里写的属性键必须落到 13 项真实属性或 `ATTR_KEY_ALIAS`（STA 耐力 → 体能负荷、
STL 抢断 → 运动），由 `tests/attribute-keys.test.js` 把关。

## NBA 2K 属性：13 项直接用 2K26

这 13 项属性的定义本来就源于 2K（基础名单就是 `NBA2K_DATA`，连 archetype 都是 2K 的），
而且这份 CSV 是 2K26 的 2025-26 快照（弗拉格在独行侠、杜兰特在火箭、东契奇在湖人），
正好就是这个游戏模拟的赛季。所以维护自己的一套推导公式没有意义——直接用 2K，低一点也没关系：

```bash
# 输入：assets/data/local/nba2k25_current.csv（本地，不进仓库）
curl -sSL -o assets/data/local/nba2k25_current.csv \
  https://raw.githubusercontent.com/ReinerJasin/NBA2k25_Web_Scraping/main/output/current_nba_players.csv

node tools/merge_2k_ratings.mjs              # 默认 full：13 项直接用 2K（幂等）
node tools/merge_2k_ratings.mjs --dry-run    # 只出报告，不写文件
node tools/merge_2k_ratings.mjs --mode=shape # 旧实验：只借 HAN / CLU 的排序
```

数据来自 2K 抓取数据集（2kratings.com，经 [ReinerJasin/NBA2k25_Web_Scraping](https://github.com/ReinerJasin/NBA2k25_Web_Scraping) 的 MIT 脚本导出）。
390 人整份采用 2K（含总评 `overall`），2K 没有分项的 135 人（主要是 2026 新秀）
按同位置组的平均差平移到同一把尺子，保留相对排序。

**用模拟结果说话**（`tools/validate_ratings_against_reality.mjs`：替身球员进引擎模拟，
和 Basketball Reference 真实场均比 MAE；替身永远被当主力，只有两版差值有意义）：

| 方案 | 得分 | 篮板 | 助攻 | 失误 | 盖帽 |
| --- | --- | --- | --- | --- | --- |
| shape（只借 HAN+CLU 排序） | −0.073 | −0.024 | −0.021 | −0.008 | — |
| **full（13 项直接用 2K）** | **−2.615** | **−0.167** | **−0.829** | **−0.239** | **−0.224** |

自己推导的属性把全联盟抬高了一档（得分偏差 +5.7 → +1.8），因为引擎本来就是照着
2K 的数值刻度写的。CLU 换算里 `free_throw` 占 0.35：引擎用 CLU 算罚球命中率
（权重 0.50），不加罚球会让字母哥这种罚球差的球员 CLU 虚高到 99。

**重新生成属性的顺序**：`update_current_player_ratings_2026.mjs` 会整个重写评分文件，
跑完必须再跑一次 `merge_2k_ratings.mjs`，否则 2K 数值会被冲掉。

## 本地导入外部名单（可选，不会上传）

`tools/import_external_pool.mjs` 可以把 [BuildMyNBAPlayer](https://github.com/dandyzw/BuildMyNBAPlayer)（在线版 <https://icr3am.com/nba-game/>）的球员名单转换成本项目能直接读取的覆盖脚本。产物写入 `assets/data/local/`，该目录已在 `.gitignore` 中：**只在本机生效，公开站点不会请求、也不会提交到仓库**。

```bash
# 1) 抓取线上构建（站点有防抓取，需要浏览器 UA）
curl -sS -A "Mozilla/5.0" -e "https://icr3am.com/nba-game/" \
  -o /tmp/icr3am-app3.html "https://icr3am.com/nba-game/__ai_app.html"

# 2) 生成覆盖文件（也可指定本地 clone 的 nba2k-data.js：--source=repo <路径>）
node tools/import_external_pool.mjs /tmp/icr3am-app3.html
```

页面会在**非 GitHub Pages** 环境自动尝试加载 `assets/data/local/nba2k-data.local.js` 并原地替换联盟名单；文件不存在时静默跳过。

数据来源说明：对方仓库未提供许可证（README 注明仅供学习交流、勿商用），因此本项目只做本地转换与体验，不在公开仓库中分发其数据。

### 位置差异化原则

参考对方的位置校准时，本项目**只做差异化、不做封顶**：

- ✅ 采用：位置得分系数（`POSITION_SPEC.scout`）、抢断位置系数的**软化形式**（能力越强越接近无差别）
- ❌ 不采用：对方的位置属性上限 `POS_CAP`、数据天花板 `POS_STAT_CAP`、单场动态上限 `DYNAMIC_CAP`
- 你要的效果是“同一属性下不同位置手感不同”，而不是“某些位置永远摸不到某个上限”；如果想完全回到旧手感，把 `POSITION_SPEC` 两张表全改成 1 即可。
