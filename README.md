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

1. `assets/js/hupu/script-01-*.js`：基础名单（30 队 / 525 人）。
2. `assets/js/current-player-ratings-2026.js`：**唯一权威属性来源**。用 2025-26 真实赛季数据
   （per-game / advanced / shooting）换算成 13 项属性逐人覆盖，并标上 `ratingSeason` / `ratingBasis`。
   重新生成：`node tools/update_current_player_ratings_2026.mjs`，然后接着跑
   `node tools/merge_2k_ratings.mjs`（借 2K 的护球/关键排序，见下节）。
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

## NBA 2K 属性：只借了护球和关键的排序

13 项属性里，护球（HAN）和关键（CLU）没有直接对应的统计口径，只能靠近似公式猜。
2K 有对应分项，所以把这两项的**排序**借了过来，合进上面那份唯一评分文件：

```bash
# 输入：assets/data/local/nba2k25_current.csv（本地，不进仓库）
curl -sSL -o assets/data/local/nba2k25_current.csv \
  https://raw.githubusercontent.com/ReinerJasin/NBA2k25_Web_Scraping/main/output/current_nba_players.csv

node tools/merge_2k_ratings.mjs              # 合并（幂等，重复跑会被挡）
node tools/merge_2k_ratings.mjs --dry-run    # 只出报告，不写文件
node tools/merge_2k_ratings.mjs --only=HAN   # 单独验证某一项的收益
```

数据来自 2K25 抓取数据集（2kratings.com，经 [ReinerJasin/NBA2k25_Web_Scraping](https://github.com/ReinerJasin/NBA2k25_Web_Scraping) 的 MIT 脚本导出）。

**尺子不动，只换排序**。2K 的绝对值比我们低（护球 −8.2、传球 −6.8、篮板 −9.5），
直接照抄会让全联盟的助攻/失误集体走样。所以做一次单调线性映射，把 2K 的分值对齐到
我们原来的均值与标准差——排序听 2K 的，刻度保持原样。而且刻度是**按位置分别对齐**的：
2K 对中锋的 ball_handle 天然给得低（中锋均值 46，后卫 79），全局对齐会把整个中锋群体
的护球砍掉 11 分（约基奇 −14、恩比德 −21）。分位置对齐后，每个位置组的均值/标准差都不变。

**哪一项该借，用模拟结果说话**，而不是看排序好不好看：

```bash
node tools/validate_ratings_against_reality.mjs --compare=/tmp/ratings-head.js --n=60
```

这个工具把属性装进一个替身球员，交给游戏自己的 `generatePlayerStatsNew` 模拟，
再和 Basketball Reference 的真实场均逐项比 MAE。因为替身球员永远被当成主力，
**绝对值有系统性偏差，只有两版之间的差值有意义**（同一套引擎，偏差会互相抵消）。

逐项验证结果（`--n=60`，负数 = 比原版更准）：

| 借用的项 | 得分 | 篮板 | 助攻 | 失误 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `--only=FIN` | +0.266 ✗ | — | — | — | 不采用 |
| `--only=HAN` | +0.041 | — | −0.030 ✓ | — | 采用 |
| `--only=CLU` | −0.140 ✓ | −0.017 ✓ | — | −0.016 ✓ | 采用 |
| `--only=HAN,CLU` | −0.073 ✓ | −0.024 ✓ | −0.021 ✓ | −0.008 ✓ | **当前采用** |

终结（FIN）被否掉了：2K 的 close_shot 对中锋给得特别高（戈贝尔 94、祖巴茨 93），
而我们自己的公式已经用了真实篮下命中率 + 罚球率 + 篮下出手量，比 2K 更贴引擎。

CLU 的换算里 `free_throw` 占 0.35 权重，这不是随便配的：引擎用 CLU 算罚球命中率
（权重 0.50），只看 shot_iq/consistency 会让字母哥这种罚球差的球员 CLU 虚高到 99。
加上 free_throw 后，CLU 与 2K 罚球的相关性从 0.26 提到 0.51，同时仍保住与 shot_iq 的 0.84。

**重新生成属性的顺序**：`update_current_player_ratings_2026.mjs` 会整个重写评分文件，
跑完必须再跑一次 `merge_2k_ratings.mjs`，否则 HAN / CLU 的 2K 形状会被冲掉。

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
