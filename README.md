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
