# 项目记忆（PROJECT MEMORY）

> 本文件是本项目**唯一**的项目记忆，面向**所有** AI Agent（通用 Agent、Codex、Claude Code、Cursor、WorkBuddy 等）。

## 使用规则（所有 Agent 必须遵守）

- 读写项目记忆**一律使用本文件** `MEMORY.md`（仓库根目录）。开工前先读它，收工前把值得留下的复盘追加进来。
- **严禁任何 Agent 自建私有的、隐藏的、或工具专属的项目记忆。** 例如 `.workbuddy/memory/`、`.cursor/memory/`、各类工具私有目录下的 memory、以及任何未在本文件登记的记忆位置，一律不允许新建。
- **记忆属于项目，不属于工具。** 换一个 Agent、换一个 IDE 接手时，必须能读到完全相同的上下文；写进工具私有目录等于把项目知识锁死在某一个工具里，下一个 Agent 看不到，等于丢失。
- 如果发现历史遗留的工具专属记忆文件，**迁移到本文件后删除**，不要两份并存（两份必然分叉）。
- 新增内容按**日期倒序**追加（最新的在最上面），保留原始日期与结论；只写结论与可复用的经验，不写过程流水账。
- **每次更新（发布新版本）完成后，除了写本文件的复盘，还必须写一份可直接发布到社区 / 微信群的更新通知**：用用户视角的大白话说明「修了什么 bug、更新了什么功能」，不写内部实现与开发流水账。通知稿追加到 `docs/ANNOUNCEMENTS.md`（最新的在最上面）。用户于 2026-09-13 明确要求。
- **给用户的通知消息只给正文本身**（用户 2026-09-13 明确要求）：通知前后不加「以下可直接复制发群」「需要我改语气吗」这类包装、说明、推荐或追问，也不加 Markdown 加粗 / 标题 / 代码块——用户要的是选中就能直接粘贴进微信群的一段纯文本。复盘、发版说明、后续建议等另起段落或另开对话，不要混在通知正文里。
- **每次收工默认动作（2026-09-23 用户明确要求）**：把工作分支经 PR 流水线合并进 main；删除全部本地与远端功能分支（squash 合并导致提交号对不上时，用 `git cherry main <分支>` 核对补丁等价性，对不上的抽查文件级内容确认已被主线覆盖再删）；本地 main 快进到最新；工作区不留未提交改动。全仓库只保留 main 一个分支。
- 本文件的规则本身只能由**用户**决定修改，Agent 不得自行放宽或绕过。

---

## 2026-09-24

### v1.16.0 发布：MiniMax Token Plan 适配（吸收外部 PR #115 的实测契约）+ 订阅窗口百分比方向开关（feat，PR #133）

- 内容（PR #133，squash `9d2d97f`，18 个文件 +2285）：① **MiniMax 订阅额度**——provider `minimax`（Global）/ `minimax-cn`（国内）→ 订阅额度制，端点 `GET /v1/token_plan/remains`，凭据 `MINIMAX_API_KEY`/`MINIMAX_CN_API_KEY` 按站点优先、跨站回退；**双站点各自独立订阅源**（快照/退避/并发去重互不串），记账仍共用 `minimax` 账户。② **真实 schema**——额度在 `current_interval_remaining_percent`/`current_weekly_remaining_percent`（`total/usage_count` 恒为 0 的占位字段不参与计算）；多桶按**最紧剩余**聚合，`resetsAt` 取**最紧桶自己的**结束时刻。③ **错误翻译**——HTTP 401/403 与 `base_resp` 1004（按量 Key 错用订阅端点）/ 2049（跨站 Key 或已失效）一律按鉴权失败并提示改用 Subscription Key；空 `model_remains` 按解析失败保留旧快照，不显示假额度；宿主错误全部带稳定 `code` + 中英文案。④ **quotaDisplayMode**——新增可选方向开关（`'remaining'` 默认 = 历史行为 / `'used'` 可选）+ 设置页分段控件（radiogroup + roving tabindex + 方向键/Home/End）；告警语义不变，两种方向严格等价于「剩余 ≤ 20%」。⑤ **对比度修正**——填充式选中态改用同色相深档 `--bib-set-brand-strong: #4a63e8`（实测 4.95:1）；`--bib-set-brand` `#4d6bfe` 对白**实测只有 4.33:1**，AGENTS.md 铁律里「≥4.5:1」与「必须用 var(--bib-set-brand)」两条互相矛盾，历史提交 #38 写的「4.6:1」是算错的。
- 防复发：新增 `tests/test-minimax-token-plan.js`（126 断言）、`tests/test-quota-display-mode.js`（100）、`tests/test-minimax-e2e.mjs`（288，**独立装置**：真实 `apply()` + 桩 ctx + 拦截 `fetch`）；全量 **37 项全绿**；反向验证 **6/6**（最紧聚合→取首桶、`resetsAt`→全桶最早、宿主默认→`used`、客户端默认→`used`、`usedPercent` 方向反转、非法值回退→`used`）均被预期断言抓住，证明断言不空转。
- 发布证据：普通 PR #133 CI + CodeQL 绿 → owner auto-merge（`RELEASE_PLEASE_TOKEN` 已配置，日志确认「downstream workflow triggers are enabled」）13:47:13Z 合并 `9d2d97f` → release-please 自动触发 run `36008079967` → 发布 PR #134（1.16.0）内容核对无误后**用我自己的 token** 手动合并 → tag / GitHub Release `v1.16.0`（13:49:14Z）→ publish-npm run `36008314643` success（日志 `+ dsh-bottom-info-bar@1.16.0`，tag latest/public）→ registry `dist-tags.latest = 1.16.0` 已读回。
- 收尾：本地 main 快进 + 重跑 `node plugin/scripts/build.mjs`；英文 README 的插件列表展示图换成全英文新图（旧图混了包名与中文描述），并把文件名改为 `assets/plugins-installed.en.webp` —— **同一路径换图后浏览器/渲染层会继续命中旧图缓存**，改名是最省事的 cache-bust（`v1.16.0` 标签页里仍是旧图属正常，标签早于这次截图更新）；MEMORY 复盘与 `docs/ANNOUNCEMENTS.md` 通知稿随 docs PR 合并；分支只留 main。
- **可复用经验 1（跨站点订阅源必须分源）**：MiniMax 与小米同型（不同站点不同 baseUrl + 不同 Key），共用一个 source 会让 A 站点的快照/退避被 B 站点的 provider 覆写；正确做法是**每个站点独立 source**，只有记账账户键共用。
- **可复用经验 2（倒计时必须与显示的聚合值同源）**：多桶取最紧剩余后，`resetsAt` 要取「最紧那个桶」的结束时刻 —— 聚合值只在该桶重置时才改善；取全桶最早会显示一个「数字根本不会变」的重置时间。最紧桶缺时刻才回退最早有效值，全缺为 null。
- **可复用经验 3（测试装置的构建锚点陷阱）**：`src/host.js` 的 `SUBSCRIPTION_PROVIDERS` 是构建期锚点 `/*__SUBSCRIPTION_PROVIDERS__*/[]`，直接 import src 会拿到**空订阅表**（provider 被判成 balance）——provider 相关测试必须用 `lib/` 产物（独立验证者的第一版就因此假阴性）。同理 client 的 `FIELD_REGISTRY` 也是锚点。
- **可复用经验 4（铁律数值要用真实计算复核）**：AGENTS.md 反色铁律里的「#4d6bfe + #fff ≥ 4.5:1」是**错的**（实测 4.33:1）。凡对比度结论必须写真实 sRGB 相对亮度计算并断言，不能用字符串断言代替；已把「填充式选中态用 `--bib-set-brand-strong: #4a63e8`（4.95:1）」写进源码注释与测试。
- **可复用经验 5（外部 PR 的处置方式）**：不直接合并、但**吸收其真实联调出来的契约**（真实 schema / 错误码 / 聚合语义）是最省事也不浪费贡献者的路径；回复时逐条讲清「采纳了什么、没采纳什么及原因」，并明确告知默认值不变的取舍。

---

## 2026-09-23

### v1.15.0 发布：命名/文案/视觉对齐姊妹插件 + 配置页消失事故回归（feat，PR #130）

- 内容（PR #130，squash `668b029`，14 个文件）：① **命名**——`locale/{en,zh}.json` 补 `meta.title`（Bottom Info Bar / 底部信息栏），插件卡片/详情页不再回退成包名；`cordis.patch.yml` 行 id 由包名改短键 `bottom-info-bar`（DSH 卡片会把「行 id / 模块名」各渲染一行、只在等于行标题时省略，id=name 就是重复两行）；README 双语 H1 统一为展示名；配置页标题改取展示名。② **i18n**——client half 取 `ctx.locale` 与注册字典**整段 try/catch**（cordis 对未 inject 的服务属性直接抛 cannot get property "locale" without inject，渲染期抛错会让整块配置区静默消失）；宿主 **28 个**用户可见错误补稳定 `code`，字典键统一 `error.<code>`，前端 `errorText()` 按 code 取中英文案、缺失才退回宿主原文；HTTP 状态与凭据名改走结构化 `params`。③ **文案审计**——删空键/死键、`credits` 中文改「积分」、去「立即」与破折号式散文、配置摘要与插件描述同源。④ **视觉**——区块间距 24px → 宿主 `.X_2TxG_detailSection` 的 12px、列表首行去上内边距/末行去下内边距与边线、删 5 条死 CSS + 5 个无引用 token。
- 防复发：新增 `tests/test-locale-copy.mjs`（五条硬约束：字典键对称非空且两侧不同 / locale meta 与 package.json 接线 / 宿主每个 code 中英齐备 / **cordis 语义 Proxy ctx 上 client half 可跑通** / patch 行 id ≠ 模块名）；`test-localization` 增补「英文界面（含配置页各状态）不得出现中文」与 `meta.title` 断言；`test-field-config-client` 行节奏断言改 12px 并锁首末行规则。全量 34 个测试项全绿。
- 验证：`readPluginMeta`（`@deepseek-ai/dsh-app-boot`，profile 的 node_modules parentURL）实读返回 `{title:{en,zh},description:{en,zh}}` 且 title ≠ 包名；真机（English 界面）设置页 gap=12px、首行 padding-top 0、末行 padding-bottom 0、零中文；信息栏完整态两行 gap=0、简洁态 extra=0、零中文。
- 发布证据：release PR #128 合并（`5d39d0b`，**我自己的 token**，15:54:50Z）→ tag / GitHub Release `v1.15.0`（15:55:02Z）→ publish-npm run `35885050946` success（日志 `dsh-bottom-info-bar@1.15.0`）→ npm `dist-tags.latest = 1.15.0` 已轮询读回（约 3 分钟滞后）。
- 收尾：本地 main 快进到 `5d39d0b` 并重跑 `node plugin/scripts/build.mjs` 重建 `lib/`；工作区干净、只剩 main 分支。
- **可复用经验 1（发布链）**：owner auto-merge 用 GITHUB_TOKEN 合并**普通 PR**会抑制 push 事件 → release-please 不触发；本次 PR #130 就被抢在 `--disable-auto` 之前合掉，补救办法是 `gh workflow run release-please.yml --ref main`（该 workflow 有 `workflow_dispatch`）。**发布 PR 本身仍被 auto-merge 排除**（`enable-auto-merge` skipping），要用自己的 token `gh pr merge <n> --squash`。
- **可复用经验 2（真读展示元信息）**：`readPluginMeta` 从 `@deepseek-ai/dsh-app-boot` 导出（plugin-manager 只 re-export 一部分，直接 import 会报 does not provide an export named）；用法 `readPluginMeta(pkgName, 'file://' + <profile>/node_modules/ + '/')`。本仓库 `plugin/lib/` 是 **.gitignore**（与姊妹仓库不同：CI 现场 `npm run build`，没有 `git diff --exit-code` 环节）。
- **可复用经验 3（静态测试跨 realm 陷阱）**：`vm.runInNewContext` 造出来的对象与 `assert.deepStrictEqual` 比会因**原型来自不同 realm** 而误报不等；要在本 realm 用 `JSON.parse` 重建再比（本次 test-locale-copy 第一版就是这么假失败的）。
- **可复用经验 4（改版式前先量真实 DOM）**：字段行的真实父链是 `.bib-set-group > .bib-set-collapse > .bib-set-collapse-inner > .bib-set-body > .bib-set-row`，中间那层 `.bib-set-body` 在源码里不显眼；按猜的选择器写 `:first-child` 会静默不生效（真机实测才发现 padding-top 仍是 12px）。

### 信息栏「偶发两行间距异常扩大」：fr 轨道吸收自由空间（fix，PR #127）

- 现象（用户 2026-09-23 报告 + 截图）：完整/简洁模式下，原生统计行与信息行之间**偶发**多出一段空白（文字仍贴在行首，间距明显大于一行）。
- 根因：收合行 `.bi-density-extra` 用 `grid-template-rows: 1fr / 0fr` 做高度动画。**fr 轨道会吸收容器的自由空间**——只要祖先被拉伸/定高、或本节点被 flex 拉伸，那段自由空间就正好落在两行之间。真实浏览器实测（Chromium + WebKit 行为一致）：`.bi-root{display:flex;height:90px}` + `.bi-density-extra{flex:1}` → 空隙 **45px**；`.bi-root{display:grid;height:90px}` → **22.5px**；`.bi-density-extra{height:40px}` → **20px**。**行间间距原本不是「恒为 0」，而是「容器没有自由空间时才为 0」**——这就是「偶发」的来源（与内容、主题、会话都无关，只看宿主那一层的布局状态）。
- 附带第二处不稳定：根节点 `width:100%` 在宿主 fit-content 的 dock（`.uV2eYG_root` 是 column flex + `align-items:center`，dock 只有 `max-width:100%`）里会被**按内容反推**——实测根节点 677.5px，而宿主内容宽度令牌是 742.4px。于是「文字变长 → 根节点变宽 → 另一行换行时机改变」，版式随内容抖动（偶发折行的另一半来源）。
- 修法（把节奏变成「由构造保证」）：① 收合高度改成**确定值**——full = 原生行实测高度 `--bi-extra-h`（默认一行 20px），compact = `0px`，`ResizeObserver` 跟随折行/缩放（内容不裁切），彻底不用 fr；② 根节点改 column flex + `align-self:center`/`height:auto`/`gap:0` + `justify-content:flex-end`/`align-content:end`（flex 与 grid 各认一个），两行 `flex:none`——**万一祖先给出多余高度，多余部分只能落在第一行之上（栏外侧），不可能落在两行之间**；③ 宽度改用宿主内容宽度令牌（确定值）+ `max-width:100%`；④ 删掉只为 grid 收合存在的 `.bi-density-extra-inner`。
- 防复发：新增 `tests/test-info-bar-rhythm.js`（37 条断言：无 fr 轨道 / 收合两端点都是确定长度 / 无行间 gap 与纵向 margin / 防拉伸护栏 / 实测高度写入 `--bi-extra-h` / hooks 顺序在早退之前），已注册进 `run-all.mjs`；**双向验证**：改回 fr + 给主行加 `margin-top` → 9 条 FAIL，还原后 sha256 一致、37 PASS。
- 验证：全量 `node tests/run-all.mjs` 通过；真实 DSH（非模拟）6 档窗宽（1600/1440/1100/900/700/560）× 明暗主题 × 完整/简洁两态，行间 gap **恒为 0**、无横向溢出；注入敌意样式（祖先 `align-items:stretch` + 定高 + `flex-grow`）后 gap 仍为 0；强制原生行折行时收合高度自动 20→40px 且不裁切。
- **可复用经验 1（布局类 bug 的取证方法）**：① 用 Playwright 连**真实** DSH（token 取 `~/.dsh/logs/dhs-web.log` 最后一条；侧栏必须先点 `[role="treeitem"]` 展开 workspace 再点会话行，会话行文本会带 `Running |` 前缀）；② 一律量 `getBoundingClientRect()`，不靠看截图猜；③ 把现场 DOM + 样式表原样抽出来做**离线对抗矩阵**（祖先拉伸 / 定高 / 改 display / zoom / 长内容各跑一遍），改动前后各跑一次即可证明「修没修好」；④ 「间距偶发」优先怀疑**会吸收自由空间的尺寸**（`fr`、`flex-grow`、百分比高度、`align-items:stretch`），而不是 margin/padding 的数字。
- **可复用经验 2**：静态测试里写正则一定要**确认断言没有空转**（本次第一版把 `\s` 写成了 `s`，且规则枚举匹配到 0 条也「通过」）；凡是「遍历出来的集合」都要先断言集合规模（`barRules.length > 20`）。
- **可复用经验 3**：`React.useLayoutEffect` 不是所有 React shim 都有——仓库静态测试的桩 React 就没有（`TypeError: React.useLayoutEffect is not a function`）。要用就先判类型退回 `useEffect`，别直接调。
- 发布：修复已 squash 合入 main `9921eaa`（PR #127，CI + CodeQL 全绿）；该修复最终随 **v1.15.0** 一起发布（Release Please 起初开的是 1.14.6，feat 提交合入后升为 1.15.0；见上方 v1.15.0 复盘）。

### v1.14.5 发布：插件元数据双语（locale 字典）

- 内容（PR #124，squash 合并 `dfb80e1`）：新增 `plugin/locale/{en,zh}.json`（`{"meta":{"description":…}}`）+ `package.json` 的 `exports`/`files` 补 `./locale/*.json`，让插件页标题下与插件列表里的描述跟随宿主语言；`description` 改为英文，作为 npm 页面与 en 回退值。同时刷新两张英文 README 截图（原先在英文界面里显示中文描述）。
- 发布证据：release PR #125 合并（`18960b0`）→ tag / GitHub Release `v1.14.5`（11:01:46Z）→ publish-npm run `35852159535` success，日志 `+ dsh-bottom-info-bar@1.14.5`，tarball 11 个文件（162.7 kB）**含 `locale/en.json` 与 `locale/zh.json`** → npm `dist-tags.latest = 1.14.5` 已轮询读回。
- 收尾：本地 main 快进到 `18960b0` 并重跑 `node plugin/scripts/build.mjs` 重建 `lib/`；工作区干净、分支已删。

### 插件描述不随语言切换：改用 DSH 的包级语言字典（fix）

- 现象：宿主界面切英文后，插件页标题下与插件列表里的描述仍是中文。根因：那段文字来自 `plugin/package.json` 的 `description`，与插件自己的 `src/locales.js`（只管设置页/信息栏文案）无关。
- DSH 的正确机制（0.1.7-alpha.1 实测）：包根 `locale/<lang>.json`，内容形如 `{"meta":{"title":"…","description":"…"}}`；`locale/en.json` 是**发现入口**（不存在就整个跳过），随后读取同目录全部 `*.json`；`readPluginMeta()` 生成 `{en: package.json 回退值, …各语言}`，客户端 `resolveText()` 按 `fallbackChain(active)` 取（内置语言 id 就是 `zh`/`en`，`<html lang>` 才是 zh-CN；zh 的链是 [zh, en]）。
- **三个契约缺一个就静默失效**（DSH 把 `ERR_PACKAGE_PATH_NOT_EXPORTED` 当作「没有字典」，直接回退 package.json 描述、不报错）：① `locale/en.json` 必须存在；② `exports` 必须导出 `"./locale/*.json"`；③ `files` 必须含 `"locale/*.json"`（否则 npm 包里没有）。三条已写进 `tests/test-localization.mjs`，并做过反向验证（去掉任一条立即报错）。
- **必须重启才生效**：改完 manifest 后，**已在运行的 DSH 进程解析不到新导出的子路径**（长跑进程内的解析结果是旧的）。验证办法：新建隔离 home（`DSH_HOME=/tmp/dsh-verify`，profile 用 `cp` + `node_modules` 软链），另起一个端口（3099）跑第二个实例，实测两种语言下列表行与插件页描述都正确；用完 kill 进程 + 删目录，全程不碰用户正在跑的 3080 实例与其语言偏好。
- 语言偏好现状：用户已把 DSH 语言切成 `en`（`~/.dsh/profiles/web/cordis.patch.yml` 的 `- id: locale`）——别再假设它是 zh；临时改语言截图必须备份 + `trap` 还原 + sha256 核对。
- 顺带：同 profile 里 `dsh-chatgpt-subscription` 等插件的描述仍只有中文（各自仓库的 package.json），要双语得在各自仓库加 `locale/*.json`。

### README 截图适配中英双语（纯 docs，不触发发版）

- 约定（本次定型）：`assets/` 里**无语言后缀 = 英文界面**（`README.md` 用），**`.zh-CN.webp` = 中文界面**（`README.zh-CN.md` 用）。设置页三张 + 插件列表一张都已双语；`info-bar-full/compact.webp` 仍只有英文版。
- 采集管线（可复用，只读用户设置）：Playwright（`/Users/songsong/code/brickindex/node_modules/playwright`）+ 本机跑着的 `dsh web`；鉴权 URL 取 `~/.dsh/logs/dhs-web.log` 里**最后一条** `?token=`（token 是机密，不打印、不落盘）。`viewport 1440x1800 / deviceScaleFactor 2 / colorScheme light`；进插件页：侧栏 `button.hHd-Xa_panelRow`（插件|Plugins）→ `button.X_2TxG_cardTitle`（hasText `dsh-bottom-info-bar`）。分组 = `.bib-set-group`（0=原生、1=插件），展开态 `.bib-set-group--expanded`，点标题用 `.bib-set-group-fallback-head`，行 = `.bib-set-row--field`；滚动容器 = `.bib-set-search` 最近的 `overflow-y: auto` 祖先。
- **切语言的坑**：DSH 语言偏好存在 `~/.dsh/profiles/web/cordis.patch.yml` 的 `- id: locale` 块里，web 端热加载；**新浏览器不会覆盖已存偏好**（navigator 语言只在「无偏好」时生效），所以截英文图必须临时把 `preference: zh` 改成 `en`，截完立刻还原。本次用 `trap ... EXIT` + 备份 sha256 双保险，还原后 sha 一致、`<html lang>` 回 `zh-CN` 均已核验。
- 四张图的裁剪（clip 由 DOM 实测得出，不写死坐标）：① 页首 = 从页面容器顶到「账单数据」卡顶 −16，宽 = 搜索框宽 +192；② 原生分组 = 分组矩形左右各 +20、上下各 +10；③ 插件分组 = 同 ②，但**只截前 12 行**（切在第 13 行上沿 −3）——该分组实际有 26 行，全截太长；④ 插件列表 = 「已安装/Installed」标题顶 −24 到最后一个插件行底部 +24。
- 顺带修掉旧图失真：`plugins-installed.webp` 原图还是 4 个插件（含早已删除的 song-search / opencode-session），新图是当前 3 个。
- 仍未双语：`info-bar-full/compact.webp` 只有英文版——信息栏只在**有使用数据的会话**里渲染（新会话/首页该 slot 根本不渲染，实测 DOM 里没有任何 `.bib-*` 节点），要截就得打开用户真实会话，故未动。

### README 设置页展示图换成 v1.14.4 新版（纯 docs，不触发发版）

- 起因：用户给出 3 张 v1.14.4 设置页截图（中文界面）要求替换展示图。旧的 `assets/plugin-page.webp` / `field-config.webp` 仍是 v1.14.3 的「Visible content + Billing data」旧结构，与折叠分组改版已不符。
- 做法：先用 `magick` 灰度阈值逐行/逐列扫描，按**卡片边框线的真实像素坐标**裁切（不靠肉眼估），三张图统一「卡片左右各留 40px」→ 1999px 宽、`-quality 90` webp：`plugin-page.webp`（页头 + 信息栏 + 搜索 + 两个折叠分组 + 恢复默认 + 自定义文字）、`field-config.webp`（原生信息展开）、新增 `field-config-plugin.webp`（插件信息展开）。文案同步改成新版结构。
- 可复用坐标（源图宽 2302/2292/2250，卡片左右边界 194/2113 与 190/2109，三张同缩放）：s1 `-crop 1999x1420+154+0`、s2 `-crop 1999x890+154+200`、s3 `-crop 1999x1480+150+0`。
- 文案坑：`已启用 N 项 / N found` 是 `.bib-set-count`（`clip: rect(0,0,0,0)`）——**只给读屏的隐藏状态文本，画面里看不到**，写截图说明时不要提「显示已开启数量」（旧 README 就是这么说错的）。
- 已知取舍（同日已解决）：新图当时是中文界面，英文 `README.md` 因此中英混排 → 见上方「README 截图适配中英双语」：无后缀 = 英文界面、`.zh-CN.webp` = 中文界面。

### CodeQL「不完整 URL 子串判断」两条 High 告警修复（PR #120，纯 tests 改动不触发发版）

- 告警来源：Code scanning 在 main 报 `js/incomplete-url-substring-sanitization`（High）两条 —— `tests/smoke-static-host.mjs:250`、`:268`。断言「请求是否发往 Command Code 官方 API」写成了 `entry.url.includes('https://api.commandcode.ai/')`，而该写法只要求域名出现在 URL **任意位置**：`https://evil.example/?u=https://api.commandcode.ai/` 一样命中，判断实际不成立。
- 修法：新增 `isCommandCodeApiRequest()`，解析 URL 后精确比较 `protocol === 'https:'` 与 `hostname === 'api.commandcode.ai'`（解析失败视为不匹配）；同一断言的 orgId 检查同步改为 `new URL(...).searchParams.get('orgId') === 'org-test'`。**通用规则：判断请求目标一律解析后比 hostname / origin，绝不写域名字符串包含。**
- 防复发：`tests/test-source-guards.mjs` 新增**守卫 5**，扫描 `plugin/src`、`plugin/scripts`、`tests`，拦下 `.includes/startsWith/endsWith/indexOf/lastIndexOf('https://…')` 式写法（排除注释与本文件自身）。**已双向验证**：放入探针文件 → 守卫 5 FAIL、exit 1；移除 → PASS。全量 `node tests/run-all.mjs` 通过。
- 验证证据（不是「应该关了」，是读回来的）：PR #120 → CI pass → squash 合并 `a4df6f4` → main 上 CodeQL 重扫 run `35825985960` success → 告警 #3 / #4 状态变 **fixed**（06:17:25Z），**open 告警数 = 0**（说明守卫里那条正则本身也没引入新告警）。
- **重要发现 —— Release Please 只认 `plugin/` 路径**：`release-please-config.json` 的 `packages` 只有 `plugin`，本次提交只动 `tests/`，Release Please 日志明确 `No commits for path: plugin, skipping`，因此**不产生发布 PR**。纯 tests / docs 改动不发版是设计使然（#118、#119 同理）；AGENTS.md 的「每次修复都要发版」针对的是 `plugin/` 内的用户可见改动。判断依据：改动路径，而不是提交类型。
- 收尾：本地分支用 `git cherry main <分支>` 确认补丁等价（输出 `-`）且文件级 diff 为空后 `-D` 删除，远端分支随合并自动删除；本地 main 已快进到 `a4df6f4` 并重跑 `node plugin/scripts/build.mjs` 重建 `lib/`；工作区干净，全仓库只剩 main。

### 收工大扫除：删除 19 个本地旧分支，只留 main

- 背景：历史 Codex / 修复分支全部走 squash 合并，提交号对不上 `git branch --merged`，导致分支越攒越多（19 个）。用户明确把「收工即合并主线 + 清分支 + 干净工作区」定为默认规矩（已写进上方使用规则）。
- 核对方法：`git cherry main <分支>` 验证补丁等价性，17 个直接命中；2 个未命中的抽查确认内容已被主线更完整版本吸收——`codex/readme-plain-20260922`（被 #111 的 README 终稿覆盖）、`codex/runtime-install-uninstall-20260918`（运行时装卸功能已在主线发布，test-runtime-uninstall 16 PASS）。
- 全部 19 个分支已删除。**找回方式**：SHA 清单在删除前的 `git for-each-ref refs/heads` 输出里，也可从 git reflog 恢复（约 90 天内）。关键两个尖端：`e04ee45`（readme-plain）、`de738c4`（runtime-install-uninstall）。
- 教训：squash 合并的工作流下，「合并与否」不能只看提交可达性，`git cherry` 的补丁等价性才是正确判据。

### v1.14.4 发布：折叠分组留白 + 文案收敛 + 发布元数据守卫改精确

- 内容（PR #116，squash 合并 `f6de5f7`）：①修「原生信息 / 插件信息」两个折叠分组贴在一起——根因是两张分组卡被包在同一个中间容器里，flex 的 gap 作用不到卡片之间；改为分组直接成为字段列表的相邻子项，统一 16px 分组间距，收起/展开/搜索自动展开都保留真实留白。②分组名收敛为「原生信息 / 插件信息」，插件简介收敛为「在输入框下方显示当前模型、余额和花费。」③收紧 `plugin/package.json` 的 description。
- **CI 守卫误报及根因修复**：守卫 4 此前把 `plugin/package.json` 整文件锁死，连 description 这类非版本改动也拦（本地全量测试全绿、CI 却红——因为该守卫本地无 `GITHUB_BASE_REF` 时自动 SKIP，本地测不出 PR 场景）。已改为：manifest 与 CHANGELOG 仍整文件锁死，package.json **只锁 version 字段**（diff 行匹配 `^[+-]\s*"version"\s*:`）。双向验证过：description 改动 PASS，临时分支 bump version 仍 FAIL。
  - **可复用经验 1**：凡 PR 动过 GUARDED 清单里的文件，本地先 `GITHUB_BASE_REF=main node tests/test-source-guards.mjs` 预演一遍，别等 CI 报红。
  - **可复用经验 2（本次丢过一次工作）**：反向验证时**绝不能带着未提交改动去开临时分支再 commit**——`git checkout -b` 会把工作区改动一起带过去，`commit -a` 就把正经改动卷进临时提交，删分支即丢失。先提交，再开临时分支做反向验证。
- 发布证据：release PR #117 合并；tag / GitHub Release `v1.14.4`；publish-npm workflow success（日志 `+ dsh-bottom-info-bar@1.14.4`）；npm registry latest 已轮询读回 `1.14.4`（registry 生效滞后约 1–2 分钟，轮询等待即可，不必怀疑流水线）。
- Git 操作备忘：①分支首个提交已随 #114 squash 进 main 后，`git rebase origin/main` 会自动跳过等价补丁（git cherry 可先确认），PR diff 即只剩真实新工作；②本地没有远端分支的跟踪引用时，裸 `--force-with-lease` 会报 stale info 拒推——用显式写法 `--force-with-lease=refs/heads/<分支>:<远端当前 SHA>`。

### 设置页折叠分组的真实留白（待发版）

- 用户发现「原生信息」与「插件信息」在收起和同时展开时都贴在一起。根因不是间距令牌过小：两张分组卡被包在同一个中间容器中，`flex` 的 `gap` 只作用到该容器，无法作用到卡片之间。
- 修复为让两个分组直接成为字段列表的相邻子项，并统一使用 16px 分组间距；无论收起、展开或搜索自动展开，都保留真实空白。名称同步收敛为「原生信息 / 插件信息」。
- 验证：全量测试与差异检查通过，重启 DSH 后用真实深色插件页截图确认分组之间有稳定留白。

## 2026-09-22

### 设置页文案与视觉密度收敛（待发版）

- 用户指出上一版仍有“已启用 28 项”“原生信息 已启用 6/6 DeepSeek 原生统计”等重复状态词，以及搜索、卡片、按钮混用不同圆角和间距的问题；用户目标是少文案、少装饰、只保留可理解且可操作的信息。
- 重构：插件简介改为「在输入框下方显示当前模型、余额和花费。」；移除页面引导句、搜索框旁视觉计数、分组内启用数量/技术分类、字段行的模式前缀（如“原生统计行字段”）。保留搜索结果数作为屏幕阅读器状态，不占视觉空间；每个字段只显示其实际用途说明。
- 视觉收敛：插件自绘的矩形交互面统一使用 `--bib-control-radius: 8px`（输入、分组、色块、告警、兜底按钮），页面区块统一 24px 节奏，卡片内与列表间分别为 12px/8px；原生 DSH Switch/Button 继续交给宿主渲染。
- 验证：全量 `node tests/run-all.mjs` 通过（字段配置专项 138 PASS / 0 FAIL、文案本地化测试通过、差异检查通过）；重启 DSH 后用 Computer Use 打开真实插件页，已确认新版简介、无搜索计数、无分组摘要、无字段模式前缀，深色界面下正常渲染。
- 续审：键盘翻页确认展开的 26 项扩展字段和下方自定义文字/账单操作均可达（鼠标滚动未命中宿主滚动层不代表不可滚动）。移除了错误提示行重复的「建议保留」胶囊与说明；保留默认开启与清除操作的不可恢复提醒。用户指出两个折叠分组挤在一起后，间距收敛为明确令牌：页面区块 24px、同区块操作组 16px、并列折叠分组 12px、字段行 0px（靠细分隔线），并在真实深色 DSH 中复核。

### Apple 设置式信息分组重构（待发版）

- 用户指出截图中的「原生信息 / 信息栏内容」仍像纯文字加小角标，第一眼会当作文案而不知道可以点；不再以“勉强贴 DSH 行样式”为目标，改用受 macOS 设置启发的清晰分组表单。
- 分组现在是完整可点的卡片表面：64px 标题区、标题 + 当前启用状态 + 分组说明，右侧明确写出「展开 / 收起」并配箭头；展开后才显示连续的字段列表。`aria-expanded` / `aria-controls`、焦点轮廓、减少动态效果与中英本地化一并保留。原生 `Switch`、`Button`、`Menu` 继续复用，避免仿制 macOS 私有控件。
- 新的回归断言锁定“整块操作面、状态摘要与展开文字”，避免将交互再次降级为纯文本。设置页专项 **138 PASS / 0 FAIL**，全量测试通过、构建成功、差异检查通过。DSH 服务完成重启；Computer Use 下 Safari Web App 仍停在旧的本地连接错误页，故这次只能提供构建与自动化验证，待桌面 Web App 恢复连接后再做真实截图验收。

### 设置分组的可发现性重构（待发版）

- 截图审计发现设置页的「原生信息 / 信息栏内容」错误复用 `DisclosureRow`：它是 DSH 的 24px 流程行，契约是“图标 + 纯文本标题”；插件传的是标题 React 节点且没有图标，因此**收起态没有稳定可见的展开提示**，对新用户而言分组像普通静态文字。
- 修复：分组改为原生 button 语义（`aria-expanded` + `aria-controls`）和与插件详情页同一组行令牌；箭头始终可见、整个标题行可点、hover/focus 有克制反馈。首屏展开最常见的原生统计字段，插件字段按需收起；搜索时两组都会自动展开。原生 `Switch`、`Button`、`Menu` 保持不变，避免重回自绘控件。
- 防回归：`tests/test-field-config-client.js` 锁定首屏状态、明确的展开关联与不再使用不适配的 `DisclosureRow`；专项 **138 PASS / 0 FAIL**，全量测试、构建、`npm pack --dry-run`、`git diff --check` 均通过。
- 真实 DSH UI 复核暂时被独立的 `dsh-chatgpt-subscription` 语法错误（`missing ) after argument list`）阻断：服务在加载该插件时退出，非本插件错误；不得为此修改它。待其修复后，使用 `scripts/dshr` 重启并检查深色主题下的首屏、折叠和搜索交互，再走正常 `fix:` → PR → Release Please 发布链。

### 配置区真正的同页基线 + 「给宿主原生组件套插件类名」事故（用户第 4 轮反馈后：独立审计 + 度量层重构）

- 用户原话：「还是裁切了，你从根因上去解决，不要治标不治本。所有的问题都要从根因上解决：1. 独立审计解决优化。2. 不能沿用已有方案，要重构。3. 看看 DeepSeek 官方的指导是怎么去做的。」
- **本文第 20 行那节也错了一半，以本节为准**：`.X_2TxG_card / cardHead / cardDesc` 属于插件**列表页**的卡，不是配置区。配置区的**真·同页基线**是宿主紧随我们之后的原生行区块：
  - 宿主 `dsh-client-ui-plugin-manager` 的 `PackageDetail` 渲染树：`detailSections` → [`section.detailSection[data-plugin-config]`（我们的配置槽）→ `RowsSection`（宿主原生行区块）→ `plugins.detail.section` 槽]。**`RowsSection` 就在我们正下方**，用的就是 `.X_2TxG_rows` + `.X_2TxG_row`。
  - 权威度量（从 `lib/client.js` 全文提取，非猜测）：`.page{padding:28px clamp(24px,4vw,48px) 48px; gap:32px}`、**`.page > *{width:100%; max-width:960px}`**、`.detailSections{gap:32px;margin-top:32px}`、`.detailSection{gap:12px}`、`.sectionHead{align-items:baseline;gap:10px}`、`.sectionTitle 14/500/20`、`.sectionCount 12/18 二级色`、`.pageIntro 13/20`、`.groupTitle 14/500/22`、`.rows{gap:0}`、**`.row{padding:12px 2px; border-bottom:.5px solid border-l2}` + `.row:last-child{border-bottom:0}`**、`.rowLine{align-items:center;gap:16px}`、`.rowId 13.5/500/20`、`.rowModule 11.5/16`（两者都是等宽字体，因为它们是包名/模块路径）、`.rowIcon 40×40`、`.failure{错误色;align-items:center;gap:10px}`、`.reason{12/18;overflow-wrap:anywhere;pre-wrap}`、`.banner{警示色 12%;r10;padding:8px 12px}`。
  - **行的正确几何 = `padding: 12px 2px` + `0.5px` 下边线**（既不是 `padding: 8px` + 无分隔线，也不是列表卡的 `margin: 0 -8px`）。同页 `RowsSection` 就是这么画的，我们的行因此能和它上下对齐。**抄 `margin: 0 -8px` 必然被折叠容器的 `overflow:hidden` 切掉右 8px**。
  - **宽度铁律**：宿主已把内容钉在 `min(100%, 960px)`，插件根节点**绝不能再设 px 级 `max-width`**。曾经写 `max-width:760px`，在 1440 视口里把内容整体压窄 200px、900 视口压窄 12px，右侧控件够不到宿主右边界——**这是「对不齐」的唯一真凶**（第三方审计报告里唯一一条 P1）。
  - 横向内缩**只能来自行自己的 `padding-inline`**；内容块（page-head / toolbar / card-header / footer / alerts / group-title）左右 padding 必须归零，否则整块比宿主左沿右偏 8px。
- **重构方式（用户要求「不能沿用已有方案」）**：所有度量收敛成 `.bib-set-root` 上的**度量层 CSS 变量**（`--bib-sec-gap / --bib-sec-inner / --bib-head-gap / --bib-title-* / --bib-count-* / --bib-intro-* / --bib-desc-* / --bib-row-pad-* / --bib-row-gap / --bib-row-label-* / --bib-row-hint-* / --bib-input-* / --bib-btn-* / --bib-rule`），每条注释标注来源规则，规则只准引用变量。改度量只需改一处。回归测试相应改为**锁两层事实**（变量定义 + 规则引用），**不退回裸数字**。
- ⚠ **事故（本轮最贵的教训）：给宿主原生组件传插件自己的类名，会以「同特异性 + 后插入」覆盖宿主外观。**
  - `bibSetSwitch` 的原生分支传了 `className: 'bib-set-switch bib-set-switch--native'`，而 `.bib-set-switch` 里有 `appearance:none; background:0 0; border:0; padding:0; margin:0`，与宿主 `._switch_1vyxu_10{background:var(--dsw-alias-border-l3); padding:2px}` **特异性同为 (0,1,0)**，插件 `<style>` 后插入 → 插件赢。
  - 后果：**OFF 态轨道背景被清成透明 → 4 行开关（主时间 / 世界时间 / 当前时段 / 下次价格切换）肉眼完全消失**（对比度 1.00:1，浅深色皆然），滑块内缩从 `18/2` 变 `16/4`（差 2px）。ON 态没事，因为宿主用 `[aria-checked=true]`（(0,2,0)）压过了我们。用户看到的就是「有的行有按钮、有的行没有」。
  - 修法：原生分支只挂 `.bib-set-switch-host { flex: none; }`（**只允许布局声明**），并用 `.bib-set-row-main > .bib-set-switch-host { grid-column:2; grid-row:1; align-self:start }` 把行内位置**显式钉死**（否则会依赖兄弟节点书写顺序的隐式自动放置：`controls` 带 `grid-column:1/-1`，一旦它挪到 switch 前面，开关就会被挤到第二行）。兜底 `<button>` 的 `.bib-set-switch` / `-track` / `-thumb` 规则**不是死代码**——原生组件取不到时才会渲染，必须保留。
  - **通用规范：宿主 primitives 组件一律不得复用插件自绘兜底控件的类名。要给它布局就新开一个只含布局声明的类。**
- **默认色点描边（用户 2026-09-22 拍板原话：「加深描边到看得清」）**：`.bib-set-dot-default .bib-set-dot-core` 的 1px 内描边原用 `--dsw-alias-border-l3`（浅色 12% 黑，16px 小圆上对比度仅 1.32:1 ≈ 看不见），改用 `--dsw-alias-label-tertiary`（与中间那道斜线同一个令牌）：浅色 ≈3.9:1、深色 ≈5:1，仍是纯宿主令牌、随主题自动翻转。**彩色预设点保持无描边**（加了会变「手绘控件」观感）。
- **「聊天页底部空白越拉越长」取证结论：不是本插件（有反证）。** `active` 相态下 `.bi-root` 底边到视口底**恒 4px**（来自宿主 `.uV2eYG_root{padding-bottom:4px}`）、composer seat 与视口底 gap 0.00px；**把 `.bi-root` 折叠成 0 高反而出现 38px 空白** → 信息栏在填坑、不在挖坑。32 种尺寸 × 11 种 UI 状态 × 5 个真实会话全部 4.0px。唯一能造出成片空白的是**宿主相态**：`[data-phase=hero]` 下 seat 变 `static` + `scrollBody{justify-content:center}`（hero 空会话在 1080×660 下空 191px，**且那时插件根本没渲染**）；`[data-phase=settling]` 下 seat 连 `visibility:hidden`。改窗口高度 500–1200、重载、hero→active 迁移均无漂移、无累积。
  - **取证方法坑（会造假象）**：按 `style[data-plugin-css]` 移除样式会误删 130+ 个宿主 CSS Module（宿主模块也带 `data-plugin-css`），必须用 `style[data-plugin="dsh-bottom-info-bar"]`（全页只有 2 个标签）。
- 判定「像不像原生」的正确基准（审计纠正我的一处假警报）：**不要拿 `.X_2TxG_rowId` 的文字左沿当基准**——它前面有 40px `rowIcon` + 16px `rowLine` gap，会让所有行标题都显示「偏左 58–60px」。插件的行没有图标列，**正确基准是 `.X_2TxG_sectionTitle` 左沿与 `.X_2TxG_row` 的 padding box**。
- 提交链：`0bac305`（原生组件 + 详情页度量）→ `7e455da`（复盘文档）→ `4f7ded1`（断言锁到 token 层）→ `f73634e`（开关外观事故）→ `819b211`（定位钉死）→ `1eadf9f`（色点描边）。`test-field-config-client` 127 → **136 PASS / 0 FAIL**。
- **另一条待办**：`dsh-chatgpt-subscription` 同步去掉 `.cgpt-page` 的 `max-width:760px`（同样的 P1），并把 `.cgpt-rowDesc` 对齐 `11.5/16`；已完成于 `c01cd4b`。

### 修正上文：插件配置区的原生基线是「插件详情页 X_2TxG_*」，不是「设置弹窗 Pt1bsG_row」

- 用户二次反馈（原话）：「被裁切了，并且整体的风格没有什么变化，没有完全适配 DH 的风格，做得非常差」「还有这种选项框，是这种非常古老的组件，没有用原生组件」「还有这个显示报错，它的布局排版也非常的差」。**上一版是照错基线做的**，所以「度量都对」但用户看还是不像。
- **DSH 里「设置弹窗」和「插件详情页」是两套完全不同的排版基线，不能混用**（这是本次最大的认知修正）：
  - **设置弹窗**（`dsh-client-ui-settings-general`，`Pt1bsG_row`）：`.5px` 细分隔线、`padding: 16px 0`、扁平密排行。上一版照的是这套。
  - **插件详情页**（`dsh-client-ui-plugin-manager`，`X_2TxG_*`）：**插件的配置区就渲染在这里**。真实度量是——`.detailSections { gap: 32px; margin-top: 32px }`、`.detailSection { gap: 12px }`、`.sectionHead { align-items: baseline; gap: 10px }`、`.sectionTitle 14px/500/20`、`.sectionCount 12/18 label-secondary`、`.card { border-radius: 12px; margin: 0 -8px }`、`.cardHead { gap: 14px; padding: 8px }`、`.cardDesc 13/18 label-tertiary`、**无任何分隔线**。
  - 结论：**判基线前先确认渲染位置**（`[data-plugin-config]` 在哪个页面里），再读那个页面的 CSS 模块，别凭「设置」两个字猜。
- **三个具体缺陷与修法**（详见 `0bac305` 提交信息）：
  1. **裁切**——照抄 `.X_2TxG_card { margin: 0 -8px }` 负外边距，但本插件根容器横向没有排水沟内边距、字段清单外面又套着 `overflow: hidden` 的折叠容器，行比容器宽 16px，右侧颜色井 / hex 输入框被裁掉。**是我自己引入的裁切**。修法：行改 `width: 100%; margin: 0; padding: 8px`，父级各内容块各自 `padding: 0 8px`——视觉同样对齐，且永不越界。另一处：搜索行计数框写死 `width: 104px` + `white-space: nowrap`，文案一长就切字，改 `grid-template-columns: minmax(0,1fr) auto`。
     **教训：负外边距只在「父级有对应内边距 + 无 overflow 裁剪」时才安全；抄宿主的负外边距前必须先确认这两个前提。**
  2. **古老组件**——时区用的是原生 `<select>`。改用宿主 primitives 的 `Menu`（锚点 + `portal` + `items`），实测弹出 12 个 `menuitem`、容器带 `_portal_` 类。开关换原生 `Switch`（36×20 / r10 / 16px 圆钮），按钮换原生 `Button`（`variant: primary|outline|ghost|toolbar`，`size: sm` = 28px 胶囊），并接入 `Tag` / `StateDot`。
  3. **报错排版**——原来是「『错误』两字单独占一行 + 正文甩到下面一大片空白」。改为照宿主 `.X_2TxG_failure`（行内、gap 10、错误色）+ `.X_2TxG_reason`（12/18、`overflow-wrap: anywhere`、`white-space: pre-wrap`）的形态：独立整块、可任意换行；警示走 `.X_2TxG_banner`（12% 警示色底 + r10 + `8px 12px`）。
- **接 primitives 的硬约束（复用自 React #130 那条）**：`require('@deepseek-ai/dsh-client-ui-primitives')` 拿到的成员必须先过存在性判断（`typeof === 'function' || object`）并保留自绘兜底，**绝不把 `undefined` 交给 `createElement`**。新增的统一入口是 `bibSetNative(name)` + `bibSetButton/Tag/StateDot/Alert/TimeZonePicker` 包装层。
- **验收方式升级：不只看截图，要读运行时事实。** 无头浏览器里逐项读回：`buttonClasses` 命中 `_button_* _outline_* _sm_*`（原生按钮生效）、`selects: 0` 且 `selectTriggers: 2`（`<select>` 已彻底消失）、`fallbackSwitchTracks: 0`（原生开关生效）、`settings gap=32px` / `card gap=12px` / `row pad=8px bd=0 r=12px` / `headMain baseline gap=10px` / `pageTitle 14px/500/20px`（度量对齐）、**`clip: []`**（裁切归零）、控制台零 error/warn。
- 回归防线：新增「**列表内容不得横向越界**」测试用例，用**只扫 CSS 声明块的正则**匹配 `margin: 0 -8px` / `width: calc(100% + 16px)`（避免被我自己写的解释性注释误伤——这个坑踩过一次）。`test-field-config-client` 127 PASS / 0 FAIL。
- 同步修正本文下面「设置面板对齐原生风格」一节的过期数值：行上下留白 ~~8px~~ → **`12px 2px` + `0.5px` 下边线**（本日期顶部最新一节已推翻这里的 8px：`X_2TxG_cardHead{padding:8px}` 属于**插件列表页的卡**，不是配置区）、页标题 **14/500/20**（不是 15/600/22，那是设置弹窗 `presetSettingsTitle` 的值）。**该节其余结论（缓存陷阱、扁平≠原生、量而非估）依然成立。**

### 设置面板对齐原生风格：先解决「改了但用户看不到」，再谈像不像

- 用户反馈（原话）：「信息栏这个设置面板被裁切了」「整体风格没变化，没有完全契合 dsh 风格，做的非常差」。
- **头号根因不是 CSS，是缓存。** 宿主用 `Cache-Control: public, max-age=31536000, immutable` + `?rev=<启动时算出的哈希>` 提供所有 client bundle。`rev` 在**宿主启动时**定型，所以只要不重启 `dsh web`，浏览器就会一直拿它那份 `immutable` 的老副本——刷新页面（包括普通 F5）都没用，改了多少 CSS 用户都看不到。本次改动的第一步动作应该是「重启 `dsh web`」，我把它排在最后，白挨了一轮差评。
  无头浏览器每次都是全新 context（无缓存），所以我自己验收永远是新的，**本地自测通过 ≠ 用户能看到**。以后再改 client bundle：改完先重启宿主，再自测。
- **「对齐原生」不能靠估，要去真实页面量。** 上一版我只把卡片改成扁平，行距/字号/控件几何全是拍脑袋，结果一半像一半不像。这轮改成在**同一个插件详情页**里直接量宿主自己渲染的区块（`X_2TxG_sectionHead` / `X_2TxG_row` / `X_2TxG_detailSections` / primitives 的 `Button.module.css .sm`），照抄数值：
  - 区块标题 14/500/20（`sectionTitle`）；区块间距 **32px**（`detailSections` 的 gap）；行上下留白 ~~12px~~ → ~~8px~~ → **`12px 2px`（含 `0.5px` 下边线）**——两次修正都错了：`X_2TxG_cardHead { padding: 8px }` 是插件**列表页的卡**，配置区该照的是同页 `RowsSection` 的 `.X_2TxG_row`。见本日期顶部最新一节。
  - 小按钮是**胶囊**：h28 / r14 / 12px 字号 / `0 10px` 内边距（和同页原生「卸载」按钮一致）；输入框才是 r8 / 34px。
  - 开关 36×20 / r10 / 16px 圆钮 / 120ms —— 与原生 `Switch.module.css` 完全一致（已验证 computed style）。
  - 折叠箭头要紧贴标题（原生 `sectionHead` 是「标题 + 计数」左对齐）；原来用 `space-between` 把箭头甩到整行最右端，几百像素空白，一眼就假。
  - 页标题降到 ~~15/600/22（原生 `presetSettingsTitle` 的值）~~ → **14/500/20**（见上一节的修正：`presetSettingsTitle` 是设置弹窗的值，插件详情页不用它），不再和宿主已渲染的 20/500 页面标题抢层级。
- 「显示内容」展开动画：`max-height: 0 → 100000px` 的问题是高度几毫秒就撑满、剩下 220ms 全在放淡入和 4px 位移，观感就是「先弹开再慢慢虚化」。改成 `grid-template-rows: 0fr → 1fr`（高度本身参与过渡）+ 总时长 150ms + 去掉位移；实测高度曲线 0→647→2555→3381→3646 在 ~150ms 内收敛。
- 教训：**扁平 ≠ 原生**。DSH 原生同时存在「扁平行列表」和「带边框分组卡」两种形态；只做减法（去边框去圆角）会把页面变成没有层次的白板。真正决定像不像的是**留白节奏、字号阶梯、控件几何**这三样。
- 排查手法留档：用无头 Chromium 读 `getComputedStyle` 逐项核对，并遍历「配置区块内所有元素 vs 面板右边界」找横向越界；注意 `[class*="_panel"]` 这种选择器会误命中隐藏的旧弹窗，判越界前要先确认参照物可见。

### 适配 DSH 0.1.7-alpha.1：插件页「信息栏设置」白屏（React #130）+ 宿主语言读不到

- 用户报告（原话）：「dsh 信息栏插件页设置没有移植」——升级 DSH 到 0.1.7-alpha.1 后，插件页里本插件的配置区块整块空白。
- 现场取证（**关键：只看日志查不出来**）：宿主机启动日志无任何 error；`/_dsh/dsh-bottom-info-bar/getConfig` 仍返回 200；`.bi-root` 在真实会话里正常渲染；插件自有设置 `~/.dsh/dsh-bottom-info-bar/settings.json` 完好（字段显隐 / 颜色 / 自定义文案全在）。
  真正的证据只在**浏览器控制台**：`slot entry crashed in 'plugins.bundle.config'` + `React error #130`（Element type is invalid … got: undefined），`[data-plugin-config]` 区块存在但内容为空。
- 根因：`@deepseek-ai/dsh-client-ui-primitives` 把图标导出名从 `IconChevronDownOutline14` 改成 `IconChevronDownOutlineRegular` / `…Medium`（尺寸后缀改成描边档位），两个名字各只在一边存在。旧写法 `React.createElement(BIB_SET_PRIMITIVES.IconChevronDownOutline14, …)` 在新宿主上拿到 `undefined` → React #130 → 插槽错误边界把整个配置区块渲染成空白。
  **一个图标取不到，整页 700 行表单陪葬。**
- 修法：新增模块级 `BIB_SET_CHEVRON_ICON`，按 `Regular → Medium → 14 → null` 运行时择名；三边都缺时退回 CSS 画的箭头（`.bib-set-chevron-glyph`，方向由父级 `data-expanded` 驱动）。**任何情况下都不再把 `undefined` 交给 `React.createElement`。**
  顺带同类问题：`settings` 服务在 0.1.7 换成 `SettingsForms`，`get(ns)` 被整块移除只剩 `describe()`；`host-locale.js` 因此永远回退 `zh`。新增 `readHostLocalePreference()`：`describe()` 优先（按 `ns === 'locale'` 取 `value.preference`），`get(ns)` 兜底。
- 测试升级（本次最重要的防线）：光有字符串断言拦不住这类回归，新增**渲染级**用例——把 `bibSetChevron` 抽出来在受控作用域里跑，`createElement` 收到非 string/function 就抛错（等价 React #130），分别验证「图标可用」与「图标全缺」两条路径都不抛错；`lib/client.js` 工厂加载测试也从 1 种 primitives 桩扩到 3 种（新版名 / 旧版名 / 一个图标都没有）。`test-localization.mjs` 补 describe 形状、describe 抛错回落、畸形返回三类用例。
- 真实验证：重启 `dsh web` 后打开插件页，信息栏配置区块正常渲染（显示内容 / 账单数据 / 导出 / 清除 / 恢复默认），控制台零 `slot entry crashed`；同一轮也确认 `dsh-chatgpt-subscription` 的插件页正常。
- 可复用经验：
  1. **宿主接口名不是契约**。凡是「取宿主某个成员」的地方都要假定它明天会改名或消失：要么 `typeof x === 'function'` 判定后降级，要么候选名列表择一，**永远不让 `undefined` 流到 React 或函数调用位**。
  2. **升级后必须真开浏览器看界面**，并搜控制台 `slot entry crashed`。日志里不会留痕，接口被移除是静默失效。
  3. 新增 `docs/DSH-HOST-COMPATIBILITY.md` 记录依赖面清单（插槽名 / 投影 / settings / primitives 图标 / 模块加载器）与升级后核对步骤，下次升级照单核对。

### v1.14.3：修好 link: 安装的「更新命令」——拉代码 + 切默认分支 + 重建产物

- 用户报告（原话要点）：红色「新版本提醒」里点标签复制的更新命令，实际操作之后并没有实现更新；并追问「为什么本地端也显示更新？不应该先更新完本地再推云端吗？为什么本地显示的还是旧版本？」。
- 现场取证：profile 为 `dsh-bottom-info-bar: link:/Users/songsong/code/dsh-bottom-info-bar/plugin`；工作副本停在 `codex/plugin-page-only-config`（从未推送），实测 `git pull --ff-only` 直接失败——`Your configuration specifies to merge with the ref 'refs/heads/codex/plugin-page-only-config' from the remote, but no such ref was fetched.`；npm 已是 1.14.2 而本机仍跑 1.14.1。
- 两个根因（缺一都修不好）：
  1. **命令依赖「当前分支有可用上游」**：开发分支没推到远端时 `git pull` 必然失败；就算成功，快进的也是功能分支，而不是信息栏真正加载的已发布代码。
  2. **link: 安装加载的是构建产物**：`main` 指向 `lib/index.js`，`lib/` 不入 git（`install.sh` 是「先 build 再 add」）。只拉代码不重建，重启后跑的仍是旧代码——「更新了却没生效」的另一半。
- 修法（`plugin/src/host.js`）：`linkUpdateCommandFor()` 用**只读文件读取**探测 git 布局（向上找 `.git`；支持 `.git` 文件 + `commondir` 的 linked worktree；remote 优先 `origin`；默认分支取 `refs/remotes/<r>/HEAD`，回退到 `main`/`master` 的松散 ref 或 `packed-refs`），拼出 `git -C <仓库根> fetch origin && git -C <仓库根> checkout <默认分支> && git -C <仓库根> merge --ff-only origin/<默认分支> && node <link 目标>/scripts/build.mjs`；路径含空格按平台转义（POSIX 单引号 / Windows 双引号）；布局读不出来时退回保守命令。`getUpdateInfo` 改为每次调用都从磁盘重读「已安装版本」（npm 最新版仍只在进程启动时查一次），更新完刷新页面提醒即消失。
- 设计约束（刻意为之）：**host 绝不执行任何命令**。`tests/test-update-check.js` 的守卫从「不含 `exec(` / `spawn(`」升级为「host 与 client 都不得出现 `child_process`」；真正改动用户副本的只有用户自己粘贴的那条命令，且始终是 `--ff-only`（工作区不干净 / 有本地提交时 git 自己拒绝）。
- 测试：`tests/test-update-command.mjs` 用纯文件系统搭夹具覆盖 8 种布局（默认分支 / 功能分支未推送 / detached HEAD / packed-refs / 路径含空格 / linked worktree / 有构建脚本 / 非 git 目录），22 条断言，含「不得再产出会失败的裸 `git pull`」回归断言；`tests/check-host.js` 白名单补 `RegExp` 与 `node:path` 的 `resolve`/`isAbsolute`；全量 `node tests/run-all.mjs`、构建、`git diff --check` 全绿。
- 发布证据：PR #108（`801f07e`）CI 与自动合并通过；发布 PR #109（`cec79a7`）合并；tag / GitHub Release `v1.14.3`；publish-npm workflow success；npm `latest` 已读回 `1.14.3`。
- 真实验证：合并后用**信息栏将来会复制的那条原样命令**在本机执行——fetch → checkout main → `--ff-only` 到发布提交 → 重建 lib，本地版本落到 1.14.3，即用户报的那条路径已端到端跑通。
- 可复用经验：**「提醒用户有新版本」和「给用户的更新命令真的能跑」是两件事**；`link:` 安装的更新 = 拉代码 **+** 切默认分支 **+** 重建产物，三者缺一都会表现为「更新了但没生效」；凡是「交给用户自己去跑」的命令，必须用真实安装形态端到端验证一次，而不是只做字符串断言。

### v1.14.2（补记）：配置入口收进插件页 —— 并补上上一轮漏掉的收尾

- 内容：`fix: keep info bar configuration in plugin details`（PR #106 / `4984110`，发布 PR #107 / `4a7647d`）：插件页里 bundle 自己的配置页成为**唯一**入口，去掉与全局设置页重复的第二份表单（v1.14.1 之后 DSH 把同一个 `plugins.bundle.config` 渲染成了两处重复入口）。
- 发布：tag `v1.14.2`、GitHub Release、npm `latest` 均已核对为 1.14.2。
- ⚠ 上一轮漏掉的收尾（2026-09-22 补齐）：① 没有写 `MEMORY.md` 复盘；② 没有 `docs/ANNOUNCEMENTS.md` 通知；③ **没有把本地工作副本同步回 main**。第三条直接造成用户看到「自己刚发布的版本，正在自己的信息栏上提示有新版本」——已写进 `AGENTS.md` 与 `docs/WORKFLOW.md` 的发布后收尾铁律（新增「本地副本切回 main 并快进」一条）。
- 可复用经验：本机 DSH 装的是本仓库的 `link:` 副本，**发布流程的终点不是 npm 上的版本号，而是「本机加载的代码也已经是那一版」**；对外发布（GitHub/npm）与本地生效是两件事，缺了后者就会自扰。

---

## 2026-09-21

### v1.14.1：修复 DSH 0.1.6-alpha.2 的运行时激活与账单落盘

- 根因：当前 DSH 将 `plugins.bundle.config` 视作 keyed slot；客户端误传列表槽位的 `id`，导致网页启动时该 entry 不激活。Host 端又把账单防抖交给未注入的 `ctx.timeout`，在当前 Cordis Context 会报错并使本次账单无法保存。
- 修复：bundle 配置入口改传包名 `key: 'dsh-bottom-info-bar'`；账单防抖改用标准 `setTimeout` / `clearTimeout`，保持原有防抖与 dispose 冲刷语义。
- 回归防线：`test-runtime-uninstall` 锁定 keyed config 入口；`test-source-guards` 禁止重新读取 `ctx.timeout`。构建、全量测试、`git diff --check` 与 `npm pack --dry-run` 全部通过。
- 真实验证：在本机 DSH `0.1.6-alpha.2` Web profile 重启后，信息栏实际显示在输入框下方；插件管理页显示本插件已启用且组件为 Running，插件页与设置页的 Info Bar 配置入口都可打开。重启后日志没有 `Failed to load plugins`、`dsh-bottom-info-bar: failed`、keyed-slot 激活失败或新的 `ctx.timeout` 错误。
- 发布证据：PR #103（`4119a06`）CI、CodeQL 与自动合并通过后合并；Release PR #104（`049512d`）通过检查并合并；tag / GitHub Release 为 `v1.14.1`，npm publish workflow 成功，registry `latest` 已读回 `1.14.1`。
- 可复用经验：DSH slot 的 `id` 与 `key` 不能混用；遇到 Cordis Proxy 报未注入成员时，插件自有的非服务能力应优先采用标准平台 API。发布验证仍需区分本地真实界面、GitHub 工作流成功和 npm registry 实际读回。

---

## 2026-09-20

### Issue #99 / v1.14.0：接入 Command Code 订阅额度

- 来源：Issue #99 提供了 Command Code 官网、额度说明和 CLI 线索；需求不是只显示供应商名，而是接入 5 小时、周、已知套餐月度 credits 及剩余量。
- 落地：`command` 为规范 provider ID，兼容 `command-code`；凭据按 `COMMAND_CODE_API_KEY` → `CMD_API_KEY` → 进程环境 → `~/.commandcode/auth.json` 读取；请求 `/alpha/whoami?limits=1`、`/alpha/billing/credits`、`/alpha/billing/subscriptions`；快照用 `balanceUnit: "credits"` 区分 credits 与货币余额。
- 安全边界：无凭据、401/429、超时、畸形响应、未知套餐和空窗口不猜测数据；失败保留旧快照。订阅接口失败时仍可保留已取得的窗口额度，credits 接口失败则整次保留旧快照。
- 测试：Command Code 解析器 11/11、双模式 127/127；静态 Host 冒烟覆盖凭据优先级、Bearer、官方路径、无凭据、畸形响应和失败保留；`node tests/run-all.mjs`、构建和 `git diff --check` 全部通过。
- 发布证据：PR #100 合并（`c31f3de`），Release PR #101 合并（`a52d069`）；tag / GitHub Release 为 `v1.14.0`，npm `latest` 已核对为 `1.14.0`，主干 CodeQL 通过。
- 真实验证边界：本次没有真实 Command Code 账号，在线鉴权和真实额度结果未做实测；Issue 回复必须明确这一点，不能把 fixture / stub 测试写成真实账号验证。
- 可复用流程：新服务商适配应拆成 provider/别名、凭据优先级、官方请求、统一快照与单位、失败保留、解析 fixture、无凭据不发请求的 Host 冒烟、全量测试、最后再做真实账号 canary；“协议适配完成”和“真实在线验证完成”必须分开记录。

---

## 2026-09-18

### v1.13.0：适配插件管理页的运行时装卸（账单安全优先）

- 起因：alpha.2 发布说明要求「请开发者检查插件加载和卸载逻辑」（依赖解析改为运行时、插件管理页支持运行时卸载）。用户要求做到「安装卸载非常完美、不留残留」，并强调**账单数据丢一次就是重大事故**——故本版的排序是：账单安全 > 功能完整 > 卸载彻底。
- 用户拍板：①卸载即清空（账本＋设置，不留副本）②配置入口两处都注册 ③必须写卸载自检测试 ④卸载后原生界面要恢复原样 ⑤判定必须加保险。
- ⚠ 核心认知（用户提问，务必记住这个推理）：**「卸载之后你怎么扫描？」不是悖论。** 扫描发生在 dispose 里，即**卸载进行中、代码还在内存的最后一刻**。顺序是：插件管理页改 `package.json` 摘掉本插件 → Cordis 调本插件 dispose → **此刻代码仍活着**，扫 `package.json` 发现自己已不在列表 → 判定真卸载 → 清数据 → 插件被摘除。真卸完后确实什么都做不了，所以清理只能写在 dispose 里。
- 判据：扫 `~/.dsh/profiles/*/package.json` 的 `dsh.profile.bundles` 与 `dependencies`/`devDependencies`/`optionalDependencies`，都没有本插件才算真卸载；只是停用那一排（仅改 `cordis.patch.yml` 的 `disabled`）或 DSH 重启 → 一个字不删。
- 三道保险（方向＝「只有能明确证明已卸载才清」）：①数据与 profile 必须同属一个 DSH home（`dirname(DATA_DIR) === dirname(PROFILE_ROOT)`），否则不判定 ②必须至少扫到一个 profile 目录且读出一份 manifest ③manifest 损坏 / 目录缺失 / 目录为空 / 任何异常 → 一律保留。
- 顺带：新增 `plugins.bundle.config` 槽位（键＝包名，按宿主要求给 `summary` / `page` 两视图），与 `settings.section` 并存；复制兜底的临时 textarea 改 finally 必摘除（原先抛错时会留在 body 上）。
- 已知边界（已如实告知用户）：DSH 没在运行时被卸载（手动改配置 / 关掉 DSH 后卸）→ dispose 不跑 → 数据不会被清，只能靠 `uninstall.sh` 兜底。
- 踩坑：`tests/test-localization.mjs` 的槽位桩按 `options.name` 分类，新槽位落进 `else` 分支把 `dock`（信息栏本体）覆盖了，导致那批信息栏断言实际在渲染设置页。**教训：给本插件新增任何 slot 注册，必须同步检查该测试的槽位桩。**
- 测试：新增 `tests/test-runtime-uninstall.mjs`（16 条断言，含真卸载清空、停用/重启不动、link 安装算引用、四条保守分支；跨 home 保险因 DATA_DIR/PROFILE_ROOT 是模块级常量，改用子进程换环境验证）。全量测试通过。
- 发布证据：PR #96 合并（`a0fb17f`），release PR #97 合并，tag / Release `v1.13.0`，npm latest 已核对为 `1.13.0`（registry 生效滞后约 60 秒，务必轮询确认）。

### v1.12.0：把 DSH 原生「上下文用量圆环」接管进字段系统

- 背景：DSH 升到 `0.1.6-alpha.2` 后，原生 `ContextMeter`（那颗显示上下文占用的圆环）被挪进了 composer dock 那一行。它虽然和信息栏同排，但**不归插件管**——位置、间距、颜色、开关全都碰不到，用户看到的是「一颗外来的圆环挤在信息栏旁边」。
- 用户需求（原话要点）：把它**无缝并进插件**；放在**「简洁模式」那一行的最右端**（= 信息栏主行 `row2`，因为紧凑模式只隐藏次要行、保留主行）；调好边距做到「无感」；像其他自定义字段一样能**开关 + 配色**；点击弹出的明细面板要和原生**完全一样**。
- 方案定调（用户拍板）：**不做替代品，做搬运工** —— 把原生实现整体搬进插件，再交给字段系统接管。不自己重新设计交互，避免和原生行为产生差异。
- 落地要点：
  - 新字段 `contextUsage`，`group: 'native'`、`colorKind: 'meter'`（新增色种，颜色随宿主走 `--bi-separator`），但渲染位置固定在主行右端，跟随「简洁模式」那一行。
  - 数据源与原生同源：读 `contextPressure` / `contextBreakdown` 两个 projection。占用算法照抄原生（`projectedTokens ?? pressureTokens` ÷ `contextWindow`），**额外加了 `contextWindow > 0` 的防护**——原生在窗口为 0/缺失时会算出 `NaN%` / `Infinity`，插件侧直接判空不渲染。
  - 交互照搬原生：点击弹上下文构成明细面板（系统提示词 / 工具定义 / 对话消息），用 `ReactDOM.createPortal` 挂到 `document.body`，避免被信息栏的层叠上下文裁剪；Esc 与点击外部关闭；点击时 `stopPropagation`——**否则会误触发信息栏自身的密度切换**（这个坑实测过）。
  - 优先复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Tooltip`（原生用的就是它），拿不到时回退到 `title` 属性，保证老宿主不白屏。
- ⚠ 关键决策：隐藏原生那颗圆环，用的是**结构选择器**而不是哈希类名 ——
  ```css
  [class*="_dock"]:has(.bi-root) > span:not(:has(.bi-root)):has(button[aria-haspopup="dialog"] svg[viewBox="0 0 14 14"]) { display: none !important; }
  ```
  理由：DSH 的 CSS 类名是构建期哈希（如 `.JObwrW_root`、`.uV2eYG_dock`），**每次发版都会变**，写死等于埋一颗下次升级必然引爆的哑弹。选择器同时约束了三个条件（是含 `.bi-root` 的 dock 的直接子节点 / 自身不含 `.bi-root` / 内含 14×14 的 dialog 按钮），所以**不可能误伤信息栏自己的容器**。这是本项目「不耦合易变哈希名」的既定经验在原生接管场景下的第一次应用。
- 测试：全量 `node tests/run-all.mjs` 通过。新增 13 条断言覆盖：占用算法、数据缺失返回 null、零窗口 / NaN 窗口返回 null、超 100% 封顶、圆环在 `row2` 末尾、`fieldVisible` / `data-field` / `fieldStyle` 三件套、结构隐藏选择器、圆环几何（`RADIUS=5.5` / viewBox `0 0 14 14` / `stroke-width 2`）、Tooltip 复用、portal + Esc、`stopPropagation`、移除全部字段时 `contextNode` 一并移除、中英文案成对。
- 踩坑（可复用）：
  - 构建脚本会先 `rm -rf plugin/lib`，在宿主 Node 22 上会撞**安全删除守卫**（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。解法：构建命令前加 `CODEBUDDY_SAFE_DELETE_ENABLED=0`。
  - 测试 `test-field-config-client.js` 的 D1 是从 `const FIELD_REGISTRY = /*__FIELD_REGISTRY__*/[]` 这个锚点**开始切片 eval** 的。所以任何新引入的模块级常量（如 `CONTEXT_TOOLTIP`）**必须声明在锚点之前**，否则切片里看不见它定义域外的变量，直接报 `is not defined`。
  - DSH 前端不再提供单文件插件路由（`/plugins/<name>/client.js` 会 404）；实际是从 `index.html` 里的 `/plugins/??a,b,c&rev=<hash>` **合并请求**取包。想验证线上跑的是不是新代码，必须用**当前** `rev` 去取，否则会拿到 0 字节的陈旧响应。
- 生效方式：插件客户端代码是**从磁盘读**的，本机 DSH 网页版**刷新页面即可**，不需要重启服务。已用合并包的当前 `rev` 抓包确认 `CONTEXT_TOOLTIP` / `bi-ctx-trigger` / `contextOccupancy` 均已在线。
- 发布证据：修复 PR #93 已合并（`d472c1f`），release PR #94 已合并，tag / GitHub Release 为 `v1.12.0`，npm `dsh-bottom-info-bar` latest 已核对为 `1.12.0`（发布流水线日志有 `+ dsh-bottom-info-bar@1.12.0`，registry 生效约滞后 50 秒）。
- 附带清零：本地 `main` 再次出现「陈旧 + 与远端分叉」的旧疾（本地留着未压缩的 `ec09259`，远端是压缩后的 `ce8878f`）。处置沿用安全路径——**先确认工作区干净、且本地那条提交在同名分支上另有保留**，再 `git reset --hard origin/main`；全程不要在有未提交改动时 `git checkout main`。

---

## 2026-09-16

### v1.11.2：适配 DSH 0.1.6-alpha.1 的设置服务加载方式

- 根因：DSH 更新后，`plugin/src/host-locale.js` 在 Cordis 上直接读取未声明注入的 `ctx.settings`；设置服务尚未准备好时，Cordis Proxy 会直接抛错，连带导致整个网页插件树加载失败。
- 修复：翻译器改为通过 `ctx.inject(['settings'], ...)` 声明式获取设置；对旧式普通宿主保留受保护的兼容回退，彻底移除 Cordis 路径上的裸服务属性访问。
- 回归防线：新增会对未声明服务访问直接抛错的恶意 Proxy 测试；插件构建与全量测试均通过。
- 发布证据：修复 PR #90 已合并，release PR #91 已合并；GitHub Release / tag 为 `v1.11.2`，npm `dsh-bottom-info-bar` latest 已核对为 `1.11.2`。本机 DSH `0.1.6-alpha.1` web profile 重启后，未再出现插件树失败、未声明 `settings`、重复路由或该插件启动错误的新日志。

---

## 2026-09-11

### 记忆文件规范化（用户明确要求）

- 起因：Agent 把复盘写进了 `~/.dsh`/`.workbuddy/memory/` 这类 **WorkBuddy 专属隐藏目录**。用户指出本项目由**通用 Agent** 接管管理，要求改用通用记忆文件。
- 处置：新建本文件 `MEMORY.md`；把原 `.workbuddy/memory/2026-09-04.md` 与 `2026-09-11.md` 的内容整体迁入；**删除 `.workbuddy/` 目录**。
- 落为铁律：**任何 AI Agent 都不能自建特殊的项目记忆**（见上方「使用规则」）。

### Issue #67 修复：可选服务裸属性访问打挂花费面板

- 来源：Vergil-long (@Vergil-long) 提 issue #67「AI修复bug」，附了一份 AI 生成的排查文档（GitHub attachment）。用户要求评估：①是否真有此问题 ②是否需要修 ③照他的方案还是更好的方案。
- 报告者环境：插件 1.10.18、DSH 桌面版（Electron）、cordis 4.0.1、Windows 11；症状：信息栏恒显「花费获取失败 / 刷新失败」，余额正常更新。
- 根因（确认成立）：`plugin/src/host.js` 的 `sessionControllerForLineage()` 里 `const direct = ctx.sessionController` 是**裸属性访问**。cordis 4 的 Context 是 Proxy，读取未在 `inject` 声明的服务属性必抛 `cannot get property "sessionController" without inject` —— **即使该服务确实存在，只要没声明注入也一样抛**。异常从谱系读取逃出 → `currentSessionSummary` reject → 整个 `getUsageSummary` 500（路由 catch 统一回 `{"error":"internal error"}` 且**不打任何日志**，故极难定位）。
- 关键判定：**本机（web profile）不触发**。`@deepseek-ai/dsh-web-app/cordis.patch.yml` 装载了 `@deepseek-ai/dsh-api-session-controller`，它提供的服务名恰好就是 `sessionController` 且带可用的 `list()`，所以 `ctx.get('sessionController')` 直接命中，裸访问那行是死代码。触发条件是「有 webServer 但没有该服务」的宿主（桌面版 / 其他版本组合，或该服务因 10 项 inject 缺一而未激活）。
- 复现（已做）：用真实构建产物 + 真实 cordis app（提供 credentials/timer/webServer、不提供 sessionController）跑 `getUsageSummary`：空 sessionId 200、非空 sessionId **500**，堆栈与报告者文档**逐行一致**（index.js:1141/1147/3483/3764）。
- 修复（PR #68，已 squash 合并 661dbad，版本 1.10.19）：
  1. 改用 `ctx.inject(['sessionController'], ...)` 声明式获取（cordis 面向可选依赖的正规入口：缺席不触发、不抛错，后就绪自动补触发）；同文件处理可选服务 `webServer` 本就是这个写法。保留**带 try/catch 的** `ctx.get` 兜底，裸 `ctx.<服务名>` 彻底移除。
  2. `currentSessionSummary` 调用点再包一层，谱系归并彻底降级为「尽力而为」：任何失败只退回「只算选中会话」，绝不打挂整个 RPC。
  3. 路由 500 补日志（只打方法名 / 错误 / 堆栈，**严禁打请求体** —— 该接口会接触凭据）。为此把 `method` 提到 try 外声明。
  4. 客户端同类写法 `ctx.modelDirectories` 也加了 try/catch（原本被外层 try 兜着，只静默降级，不崩）。
  5. 新增 `tests/test-optional-service-safety.mjs`：ctx 桩用**敌意 Proxy**（访问未知属性即抛错）复刻 cordis 4 脾气；旧代码上 5 项 FAIL、修复后全 PASS。原有 `test-session-lineage.mjs` 用普通对象桩（未知属性返回 undefined），**天然测不出这类 bug**，这正是它能溜进发布版的根本原因。
- 验证：全量 25 个测试套件全绿（含 main 上的 `test-release-version`）；真实 cordis e2e：无服务 500→200，有服务 `listCalls=1` 证明 inject 路径确实生效、谱系能力无损失。
- 教训（同类问题已第三次）：本仓库 `host-locale.js`（v1.10.1 `ctx.settings`）与 2026-09-04 记忆已明确写过「读宿主服务一律 `ctx.get(name)`，绝不直读 `ctx.xxx`」，但 v1.10.4 的 `sessionControllerForLineage()` 仍复发。**说明仅靠记忆 / 约定挡不住，必须有自动化守卫**（本次已补敌意 Proxy 测试）。
- 报告者「长远改用 `subagents.listDescendants(rootSessionId, signal)`」建议：本次**不换**（`sessionController.list()` 在 web 宿主可用，换掉等于多引一个可选服务依赖、修不了本次故障）。但其判断有真价值：现在每次要拉**全量会话**再本地 BFS 算子树，冷启动偶发 1.5s 超时（本机 64 次启动出现 2 次，自愈、不致命）；`listDescendants` 按根会话只取子树更省。**列为独立后续优化**，不与本次修复混做。
- 已回帖 #67 致谢并说明实际修法（评论 5636848036 / 5636886040），并在 1.10.19 发布后关闭 issue。

---

## 2026-09-13

### Issue #85 修复：智谱 Coding Plan 积分制（CREDIT_LIMIT）配额完全不显示

- 来源：Vergil-long (@Vergil-long) 提 issue #85，附 AI 生成的排查文档（GitHub attachment），自带两行补丁与实测结果。用户要求：①独立审计他的方案是否完善、漏了什么 ②给最终优化方案并落地 ③回复要用没 AI 味儿的语言真诚感谢，并说明「智谱 coding plan 我们没有实际测试过（未订阅、也没找到用户反馈）」，邀请他扫 README 内测群。
- 根因（与报告者判断一致）：智谱 **2026-07-30** 起 GLM Coding Plan 改积分制（[官方公告](https://docs.z.ai/devpack/notice/usage-revision)），quota 接口条目类型由 `TOKENS_LIMIT` 变 `CREDIT_LIMIT`；插件只认 `TOKENS_LIMIT` + `unit===3` → `windows:[]` → 底条只剩套餐名。**更早的既有缺陷**：`docs/research/A2-zhipu-zai.md:61-63` 调研阶段就写明 `unit=6=周窗口`，但代码从来只映射 `unit=3`，周窗口在旧 schema 下也一直没显示；且「未知类型静默跳过」被 QA 报告当成通过项固化，等于把 schema 漂移变成静默失效。
- 交叉验证（不靠单一来源）：官方文档额度表（Lite 2000/10000、Pro/ Max 同构）+ CodexBar #2724/#2751 的 `zai.js` + tokn `quota.rs` + opencodex #2028，四方一致：`(unit,number)` 中 3=小时、6=周，且 **unit 码与 type 正交**（CREDIT_LIMIT 沿用同一语义）。`TIME_LIMIT` 是另一类（MCP 月度、字段语义不同：usage=上限、currentValue=已用）。
- 最终实现（比报告者补丁多做了 5 件事，均来自独立审计发现的真实缺口）：
  1. 类型 + **时长双闸门**：只映射 `(3,5)→five_hour`、`(6,1)→seven_day`，其它时长一律跳过（防止把日窗口/10 小时窗口错标成 5 小时）；`TIME_LIMIT→monthly`（原来直接丢弃）。
  2. **按窗口键去重**：迁移期 `TOKENS_LIMIT`/`CREDIT_LIMIT` 并存时同键只取首个（否则客户端渲染成 `5h·5h·周·周`）。
  3. **百分比优先由原始计数推算**（`上限-remaining`，回退 `currentValue`；上限 `usage`→`total`），计数不可用才回退 `percentage`——上游整数 `percentage` 在低用量时会取整到 0，底条会显示 100%（CodexBar 同策略）。注意：issue 样本无法证明上游是 floor 还是 round（9.4→9、1.88→1 两种规则都成立），代码注释只写「取整」不写「向下取整」。
  4. **空窗口闸门**（审计的「高风险」项）：`fetchZaiUsage` 在解析成功但 `windows.length===0` 时按 parse 错误返回，让 `mergeSubscriptionResult` 保留上一份好快照；否则空数组会被当成功覆盖旧数据 → 界面无窗口也无报错 = #85 症状复发。非订阅账号走 `success:false` 分支，不受影响。
  5. **`normalizeResetAt` 支持纯数字字符串**：`Date.parse('1789284984350')` 是 NaN → 倒计时 null → 客户端**简洁模式整组窗口消失**（`displayWindow` 原本硬依赖 `resetsAt`）。同时给客户端加兜底：无 reset 的窗口也按时长优先级选窗，不再整组静默消失。
- 顺带修掉的两处文档假信息：`TECH-DESIGN.md` 原写「国际显示 Z.ai」实际两端都显示「智谱」；`A2` 的 `nextResetTime` 段落重复。
- 测试（此前 zai 解析**零覆盖**，这是能溜进发布版的根因）：新增 `tests/test-zai-quota.js`（63 条：报障原文 payload、老套餐不回归、时长闸门、百分比推算/兜底、TIME_LIMIT、去重、套餐名、重置时刻归一化、异常结构、i18n）；`smoke-static-host.mjs` 新增**首个真实解析链路冒烟**（桩 fetch → `fetchZaiUsage` → 快照：CREDIT_LIMIT 出 2 窗口 + 上游漂移时保留旧快照）。全量 29 套件全绿。
- 报告者方案评价：方向对、两行即可解决他遇到的形态，但只覆盖已观测形态；漏掉的正是上面 1–5。回复时要点名肯定他的「unit=6 → seven_day」判定（与 A2 调研及四方实现一致）与附带真实 payload 的价值。

### 处理外部 issue / PR 的规矩（用户明确要求）

- **凡是别人主动提出来的问题或 PR，合并 / 回复时必须用没有 AI 味儿的语言，真诚地感谢对方**：具体指出对方哪一点帮上了忙（如 #67 的「空 / 非空 sessionId 二分」直接指到故障分支），而不是套话式致谢。
- 承诺的后续（如本次 `subagents` 子树优化）要明确说明「这次不做、以后单独做」，不要让贡献者以为建议被无视。
- 仓库 `auto-merge-own.yml`：**owner 自己的 PR 在 CI 通过后自动 squash 合并**（外部贡献者的 PR 保持人工 review）。所以自己的修复 PR 一开就会自动落地，后续 tag / 发布要紧接着做。
- 对外文档（README / CHANGELOG）只写用户视角，**严禁开发过程流水账**；内部复盘写在本 `MEMORY.md`。

### 发布流程踩坑纠正

- 仓库 main 上有 `tests/test-release-version.mjs`（本地草稿分支 `codex/refactor-settings-billing-actions` **没有**这个文件，所以本地跑全量测试查不出来）：强制 `plugin/package.json` == `.release-please-manifest.json` 的 `plugin` == `CHANGELOG.md` 顶部版本号，**三者必须同步 bump**，否则下一次 release 可能被降级。
- 本次已三处同步 bump 到 1.10.19。发布链：PR 合并 main → **打 tag `v1.10.19`** → `publish-npm.yml` 触发（校验 tag == package version）→ 用仓库 secret `NPM_TOKEN` 发布到 npm。**本机 npm 未登录（E401），发布只能靠推 tag 走 CI**。
- 本地开发分支长期与 main 分叉（main 走 squash，本地是 squash 前的历史），**开工前先 `git fetch` 并从 `origin/main` 开新分支**，否则会漏掉 main 上新增的测试与 CI 修复（本次就差点漏掉 `test-release-version`）。

### ⚠ 事故：release-please 误发 v2.0.0

- 事实链：PR #68 合并 main → release-please 在 main 上跑（15:35:29）→ 自动开 release PR「chore(main): release 2.0.0 (#69)」→ `auto-merge-own.yml` 判定作者是 owner → 自动 squash 合并 → 生成 tag **v2.0.0** + GitHub Release「v2.0.0 Latest」（15:36:36）。**全程无人工介入**。
- 为什么是 2.0.0 而不是 1.10.20：release-please 的基线是坏的 —— 它把**远古历史**（一直回溯到最初提交）都算进了本次 release，在其中翻到一条老的 BREAKING CHANGE「移除『信息概览』页面，回归原生简洁理念（v1.3.0）」→ 判定为 major。生成的 CHANGELOG 把 v1.0.0 / v1.1.0 / v1.2.0 / v1.3.0 / v1.7.0 等一堆早已发布过的条目全部重新列了一遍，内容严重失真。这正是 #64「keep release metadata monotonic」和 #66「pin release tag discovery」想解决但没解决干净的问题。
- 事故时真实状态：npm `latest` = **1.10.19** ✅（修复已真正发布给用户）；**v2.0.0 从未发布到 npm**（其 publish workflow 因 E409 Conflict 失败 —— 距 v1.10.19 发布仅 1 秒，注册表还没处理完上一个包）；但仓库侧 `plugin/package.json` / `.release-please-manifest.json` / CHANGELOG 顶部都被改成 2.0.0，且 tag 与 GitHub Release「Latest」都在 → **仓库与 npm 不一致**。`test-release-version.mjs` 查不出来，因为它只校验三者互相一致，此刻三者一致地都错成 2.0.0。
- 处置（用户批准后已执行，PR #70）：①删 v2.0.0 的 GitHub Release 与本地 / 远端 tag；②把 `plugin/package.json` / `.release-please-manifest.json` / CHANGELOG 三处从 v1.10.19 提交原样回退；③**真正的根因修复**：给 `release-please-config.json` 加 `last-release-sha`（钉在 v1.10.19 的提交 `661dbad`），把提交搜索范围限制在 v1.10.19 之后；④给 v1.10.19 补了正经的 GitHub Release，「Latest」现指向真正发布到 npm 的 1.10.19。
- 最终状态（已核实）：npm `latest` = 1.10.19；GitHub「Latest」= v1.10.19（与 npm 一致）；main 的 package/manifest/CHANGELOG 均为 1.10.19；无遗留 tag / 开放 PR。**打上 `last-release-sha` 后 release-please 再跑（main 15:43:20）产出为空 —— 确认基线钉死生效，不会再自动冒出 2.0.0。**
- 教训：本仓库的「手工 bump + PR + 打 tag」SOP 与「release-please 自动发布」是两套并存的机制，**会互相打架**。手工 bump 到 X 之后，release-please 仍会基于坏基线再算一次并自动合并发布。以后发布前应先确认 release-please 的基线配置，或干脆在发布窗口临时禁用 `release-please.yml` / `auto-merge-own.yml`。

### 2.0.0 事故的完整追因（2026-09-11 补，用户追问「为什么偏偏今天」）

- **真正的导火索：用户今天 05:58 手动加上了 `RELEASE_PLEASE_TOKEN` 密钥。** 此前 release-please 只能拿 `GITHUB_TOKEN`（GitHub 刻意限制：用它做的事**不会触发后续 workflow**），所以机器人即使算出发布 PR，也不会自动合并、不会自动打 tag —— 整条链子**一直没通电**。换成 owner 本人的 PAT 后，机器人开的 PR 作者显示为 `songoao25`，恰好命中 `auto-merge-own.yml` 的「owner 自己的 PR 自动合并」→ 开 PR 23 秒后就被合掉 → 自动打 tag → 全链一次性跑通。**不是代码变了，是这把钥匙把自动链子接通了。**
- **release-please 日志给出的铁证（run 34617031262）**：`⚠ Expected 1 releases, only found 0` → `❯ looking for tagName: v1.10.19` → `✔ Collecting commits since all latest releases` → `❯ Set(0) {}`（**基准集合为空 = 无下界，回溯全部历史**）→ 翻到 v1.3.0 的 BREAKING CHANGE「移除『信息概览』页面」→ `✔ updating from 1.10.19 to 2.0.0`。修好后再跑（run 34618033624）显示 `Set(1) { '661dbad…' }` → `✔ Using configured lastReleaseSha` → `✔ No user facing commits found`，确认钉子生效。
- **时间差是结构性的、赢不了的**：机器人从「PR 合并」到「动手」只要 ~3 秒，而人工打 tag 至少要几分钟。所以只要还手工改版本号，这个竞态必然复现 —— 这正是必须改成「机器人独占版本号」的原因。
- **残留物（用户指出「catalog changelog 里没删掉」，用户记得没错）**：只删 tag + 回退文件**不够**，release-please 的**工作分支** `release-please--branches--main--components--dsh-bottom-info-bar` 仍留在远端，其 `plugin/package.json` 还是 `2.0.0`、CHANGELOG 里还躺着那段「信息概览」BREAKING CHANGE。**已删除该分支**，并逐个体检 50 个分支确认**无任何分支再残留 2.0.0**。
- **唯一剩下的痕迹**：`ee9c4bf chore(main): release 2.0.0 (#69)` 这条提交仍在 main 历史里。清除它需要改写已发布历史 + 强推受保护的 main，属工业界禁忌且会打乱所有克隆；评估为**无害**（类型是 chore，release-please 已不会读它；`MEMORY.md` 已完整记录来龙去脉，后续 Agent 读到只会明白因果，不会重蹈）。故**决定不改写历史**。

### 发布机制定型：Release Please 独占版本号 + 发布闸门（2026-09-11 用户拍板）

- 背景两问的通俗答案：**Release Please 是专职「发版」的自动化工具**（盯 main → 按提交信息算版本号 → 写 CHANGELOG → 开发布 PR → 打 tag）；**重复操作在于「谁定版本号」有两个人在做**（人的手工 bump vs 机器人自动算）。方案定为「**机器人独占 + 一道人工闸门**」，兼顾自动化与工业标准。
- 落地改动（本 PR）：
  1. `.github/workflows/auto-merge-own.yml` 的 `if` 增加两条排除：`!startsWith(head.ref, 'release-please--')` 与 `!contains(join(labels.*.name, ','), 'autorelease')`。**必须用分支名判断**——实测日志显示 release-please 是「先开 PR、后加标签」，只靠标签在 `opened` 事件上会漏判。保留标签判断用于后续 `synchronize` 事件兜底。
  2. `AGENTS.md` 新增「发布机制（Agent 必读）」章节，并把末尾「版本发布铁律」改为指向该机制：**严禁手工改 `plugin/package.json` 的 version / `.release-please-manifest.json` / CHANGELOG 顶部**；Agent 只负责写规范提交、并在发布 PR 出现时提醒用户确认合并。
- 新流程：写 `fix:`/`feat:` 提交 → PR（自己的 PR 仍全自动合并）→ 机器人开「发布 PR」→ **闸门拦住，等人/AI 确认** → 合并后自动打 tag → `publish-npm.yml` 自动发 npm。

### 分支清理：只保留 main（2026-09-11 用户指令）

- 用户判断：正常流程下分支合并完就该删，理论上只该剩主线。判断正确，但**必须先确认内容都已合并**，否则删掉会丢工作。
- 关键方法坑：本仓库用 **squash 合并**，`git branch --merged` **完全失效**（分支提交不在 main 历史里，即使内容已合并也显示「未合并」）。**必须改问 GitHub 的 PR 记录**（`gh pr list --state all`）才知道真相。
- 执行结果：远端 50 个分支 → 逐个体检：48 个有已合并 PR、`pr-41`/`pr-42` 对应 PR #41/#42 已合并、`codex/refactor-settings-billing-actions` 内容已被 main 完全覆盖 → **删除 49 个，只剩 `main`**；本地分支与陈旧 remote-tracking 引用同步清空（`git update-ref -d` 强制清理，`git remote prune` 未生效）。
- 清理中确认可安全丢弃的旧内容：`.workbuddy/memory/2026-09-04.md`（已迁入本文件）、v1.4.0 时代的旧版 `docs/*`（已被 main 现有 29 份新文档取代）、`promo/*`（早前 `chore: remove private development materials` 已刻意移除）、`plugin/src/client-settings.js`（设置页已重写）。
- **防止复发**：已开启仓库设置 `delete_branch_on_merge=true`，今后 PR 合并不再堆积分支。同时顺手修正 `AGENTS.md` 中已过时的 `docs/` 说明（原写的 DUAL-MODE-DESIGN / OPENCODE-GO-SUPPORT-EVAL 早已不在 main）。

### ⚠ 危险动作复盘：本地 main 陈旧，`git checkout main` 差点回滚工作区（2026-09-11 亲历）

- 现象：分支清理完成后执行 `git checkout main`，**工作区瞬间退回 10 个版本之前的旧状态** —— `MEMORY.md` 消失、`.workbuddy/` 复活、`AGENTS.md` 的两处新增全没了。原因是**本地 `main` 分支停在 `6a87088 release 1.10.10`**，而远端早已到 `e61f6ad`。
- 危害：这次侥幸没丢东西（当时工作区干净，无未提交改动）。**若当时有未提交的工作，就会被直接抹掉。** 对 Agent 尤其危险：Agent 收尾时习惯"切回 main"，这一步就可能静默毁掉整轮工作区。
- 正确做法（写进操作规程）：
  1. **任何 `git checkout main` 之前先 `git fetch origin`，并核对本地 main 是否等于 origin/main**（`git log --oneline -1 main`）。
  2. 更稳的写法：`git checkout -B main origin/main` 强制对齐远端，或直接 `git switch -c <新分支> origin/main` 从远端开分支，**不要依赖本地 main**。
  3. 一旦发现被回滚且**无未提交改动**，`git reset --hard origin/main` 即可完全复原（本次即如此修复）。
- 与既有教训同源：「checkout 停在旧分支 = 用不上主线新版的第一大原因」（2026-09-04 已记录）。本次是该坑的**加强版** —— 停的甚至就是 `main` 本身，光看分支名根本发现不了。

### 独立审计结论（2026-09-11 末，用户要求「彻底修复，防止永远出现问题」）

**源码级定论（下载 release-please@17.11.2 逐行核对，此前只有推断）：**
- `last-release-sha` **只用于终止提交遍历**（`manifest.js:287` 无条件 `break`），CHANGELOG 的切分用的是「找到的发布 SHA」（`manifest.js:319` 传 `releaseShasByPath[path]`，不是配置值）。→ **该钉子永久安全，绝不会造成版本条目重复。**
- **2.0.0 的精确机制**：`needsBootstrap = releasesFound < expectedReleases`（`manifest.js:253`）。当时「找不到 1.10.19 的 GitHub Release」且标签也还没推 → `releasesFound=0 < 1` → `needsBootstrap=true` → 因 `bootstrapSha` 未设，`commit.sha === bootstrapSha` 永不命中、`!needsBootstrap` 分支也进不去 → **遍历无限回溯**至 `commitSearchDepth`(500) 上限 → 翻出远古 BREAKING CHANGE → 判为 major。→ 钉死 `last-release-sha` 正好补上这个洞（它不受 `needsBootstrap` 影响）。

**发布闸门已实测（不再是推断）：** 建了一个名为 `release-please--gate-verification` 的测试分支 + **空提交**（万一误合也零副作用）→ `auto-merge-own` 工作流结果为 **`skipped`**、`autoMergeRequest` 为空；对照组普通分支为 `success`。**闸门确实拦得住**，测试 PR #75 已关闭、分支已删。另确认**不会死锁**：main 的必需检查是 "CI"，而 `ci.yml` 对**所有 PR** 都跑（发布 PR #69 当时 CI 为 success），所以被拦下的发布 PR 始终可合。

**npm 发布包反向验证：** 下载 `dsh-bottom-info-bar@1.10.19` 逐个核对：`ctx.inject(['sessionController'])` 在、裸访问仅剩注释、调用点双保险在、500 日志在、版本号 1.10.19。**用户拿到的是真修复。**

**审计中发现并已修的问题：**
- `docs/RELEASE.md` 仍在教「手工改版本号 + 手工打 tag」——正是闯祸流程，且读起来像操作手册，Agent 可能照做。已加历史存档标注并指向新机制（PR #74）。
- 本地 `main` 陈旧导致工作区被回滚（见上一节）。
- 本机 DSH 宿主进程（20:53 启动）早于修复构建（00:02），**仍跑旧代码**；需重启 `dsh web`（见「待用户执行」）。

**新增自动化守卫（PR #76）：`tests/test-source-guards.mjs`** —— 把「只能靠自觉」的约定升级为 CI 硬约束，违反即合不进去：
1. **禁止裸读宿主服务属性**：扫描全部 `plugin/src/*.js`，`ctx.X` 若既不在本文件 `inject` 声明里、又不在同一行/前 3 行的 `try` 保护内，即失败。**这条挡的是整类 bug**（本仓库已踩三次：v1.10.1 `ctx.settings`、2026-09-04 同类、Issue #67 `ctx.sessionController`）。
2. **记忆唯一性**：出现 `.workbuddy/`、`.cursor/memory/` 等工具专属目录即失败。
3. **`MEMORY.md` 必须存在，且 `AGENTS.md` 必须指向它并写明禁令**。
4. **普通 PR 不得手工改版本元数据**（`package.json` version / `.release-please-manifest.json` / `CHANGELOG.md`），只有 `release-please--*` 分支可改；**逃生舱**：提交信息含 `[release-metadata-override]`（因为 main 开了 `enforce_admins`，没有逃生舱会被永久卡死）。
- 守卫全部做过**反向验证**（注入违规必须 FAIL，恢复后必须 PASS），不是"写完就算"。
- `ci.yml` 的 checkout 加了 `fetch-depth: 0`：守卫 4 需要与基线的完整 diff，浅克隆会让它取不到基线。

**发布闸门加固为三层**（`auto-merge-own.yml`）：分支名 `release-please--*`（最稳，PR 创建时即有）→ 标签 `autorelease`（release-please 是「先开 PR 后加标签」，故不能只靠它）→ 标题 `chore(main): release `。三层都是 `&&` 否定，偏向「多拦」；漏放代价是发布 PR 被静默合并，多拦代价只是某个普通 PR 需手动合——**方向必须偏安全**。

### ⚠ 自我纠正：「两套发布机制」的说法不准确（2026-09-11 用户追问）

- 我先前对用户说「仓库里仍并存两套发布自动化，只改一个链条就会断」，**这个框架有误导性**，让用户以为它们是重复、冲突的两套东西。**事实并非如此。**
- **准确的关系：发版是一条两段式流水线，两段做的事完全不重叠。**
  - 第 1 段 `release-please.yml`（合并到 main 时触发）：算版本号 → 写 CHANGELOG → 开「发布 PR」→ 合并后**打标签**。
  - 第 2 段 `publish-npm.yml`（标签触发）：校验「标签版本 == package.json 版本」→ **发布到 npm**。
- **真正打架的从来不是这两个文件**，而是「手工改版本号」vs「Release Please 改版本号」—— 两个主体争夺同一个决定权。该冲突已通过「版本号收归 Release Please 独占」解决。把这条讲清楚很重要，否则会误导后续 Agent 去做一次不必要的「合并两套机制」重构。
- **不应也不需要合并成一份**：① 两段之间正好夹着唯一的人工确认（合并发布 PR），合并等于拆掉闸门；② 合并就得自行重写 Release Please 的版本计算逻辑，代码更多、更易坏；③ 标签是两段之间干净的标准接口。
- **但用户担心的风险真实存在，只是位置不同**：真正的脆弱点是两段之间的**隐式契约**（尤其是「标签必须带 v 前缀」与「publish-npm 的 `v*.*.*` 触发器」必须一致）。改坏它会**静默失效** —— GitHub 上有标签有发布页，npm 上永远没有新版本，**全程零报错**。这是整条链上最危险的失效模式。

### 发布链条契约测试（2026-09-11）

- 新增 `tests/test-release-chain.mjs`，把上述隐式契约变成 14 条 CI 断言，覆盖：
  1. **标签格式两侧一致**（`include-v-in-tag: true` ↔ `v*.*.*` ↔ `${GITHUB_REF_NAME#v}` 剥离）—— 最关键，失效时静默；
  2. 路径与包名对齐（包路径 `plugin` 与 manifest 键一致、`package-name` == package.json 的 name、`changelog-path` 指向根 CHANGELOG、标签不含组件前缀）；
  3. 两段触发器齐备（release-please 监听 main、publish-npm 保留 `workflow_dispatch` 手动兜底、NPM_TOKEN 接线）；
  4. **人工闸门仍在**（分支名 + 标签两条判别都在）；
  5. **`last-release-sha` 钉子仍在**。
- **反向验证过**：把 `include-v-in-tag` 改成 `false` → 契约 1a FAIL；删掉闸门的分支名判别 → 契约 4a FAIL；恢复后全 PASS。
- 这一条补上了我先前说「架构固有复杂度」时**其实可以消除的那部分**：复杂度不是靠合并消除，而是靠**把暗契约写成明契约 + 自动校验**来消除。

**无法修 / 需要用户执行的（如实记录，不假装已解决）：**
- `ee9c4bf chore(main): release 2.0.0 (#69)` 仍在 main 历史里。main 分支保护 `allow_force_pushes: false` + `enforce_admins: true`，**改写历史在规则层面就不可能**。评估为无害：类型是 chore（release-please 不读它算版本），且本节已完整记录因果。
- 报告者环境是 Windows + cordis 4.0.1，本仓库的复现与验证都在 macOS + cordis 4.0.2 完成——跨平台差异未覆盖。
- 本机需重启 `dsh web` 才能跑上修复后的代码（Agent 不能自己重启：会中断正在进行的会话）。

---

## 2026-09-04

### 设置页白屏事件复盘

- 时间线：8-28 v1.9.0 发布（带白屏 bug）→ The-Iron-Axe 提 issue #28（当时 OPEN 未回复）→ Guochaoo 提 PR #29 修复（8-29 被关闭未合并、无留言）→ 8-29 songoao25 账号开 PR #30(v1.9.1)/#31(v1.9.2) 并合并，npm 已发 1.9.2 (latest)。
- 结论：修复实际已推送 + 合并 + 发布；用户误以为未推送（本地停在 codex/dsh-alpha4-20260902 分支看不到）。
- 未收邮件提醒疑因 GitHub 自动 Watch 关闭或邮件通知设置 / 垃圾箱问题（gh 缺 notifications scope 无法核实）。
- 待办：回复并关闭 issue #28（感谢 + 指向 v1.9.2）；PR #29 关闭未留言，建议补致谢；PR #20（周末空闲价）与 #33（英文本地化）仍 OPEN 待审。
- 已为用户全部 11 个仓库（含私有 brickindex）开启 GitHub Watch 订阅；账号级邮件偏好需网页确认。已在 `~/.workbuddy/MEMORY.md` 记录「GitHub 知识教学」长期要求（用户零基础，遇事主动讲机制，邮件触达优先）。
- 已关闭 issue #28（reason: completed，标记为问题已解决）。关闭 ≠ 删除：issue 页面、全部评论与修复记录永久公开可查，对后来的访问者呈现的是「报障 → 致歉 → 修复发布」的完整闭环。用户邮件通知已全部确认打开。
- PR 清理：查明 3 个 OPEN PR（#17/#20/#33）均与白屏问题无关（该问题已解决）。#20（周末空闲价）与已合并 #21（v1.5.1）重复 → 已关闭并留言致谢。#17（自己的 codex 老分支，含已删除推广材料，严重冲突）与 #33（英文界面本地化，待审）处理待用户决定。
- PR #33（英文界面本地化 @ObnubiladO）处理：审查通过（新 locales.js/host-locale.js 字典、构建期注入、test-localization 新增且全量 600+ 断言全绿）→ 分支本已基于最新主线 → 批准 fork 首次贡献者 CI（endpoint: POST actions/runs/{id}/approve）→ CodeQL+CI 全绿 → squash 合并（6b1d1d3）。仓库禁止 merge commit，只能 squash/rebase。
- PR #17（自己的 codex/tooltip-version 老分支）已关闭 + 远程 / 本地分支彻底删除；本地临时分支 merge-pr33/pr33-head 已清理，工作区切回 codex/dsh-alpha4-20260902。
- 至此仓库 PR/issue 全部清零（无 OPEN）。
- v1.10.0 发布完成：release/v1.10.0 分支（版本号 1.10.0 + CHANGELOG 用户视角）→ PR #34 CI 全绿 squash 合并（71eeacd）→ tag v1.10.0 → publish-npm workflow success → npm latest=1.10.0。含英文界面（#33）+ alpha.4 适配（#32）。

### dshr 修复（用户报「找不到 DeepSeek Harness Web App」）

- 根因①路径失效：`~/Applications` 下 Web App 已从 "DeepSeek Harness.app" 改名为 "DSH.app"，且 Safari Web App bundle UUID 从 82153CF2-… 变为 F203D448-E196-48FE-BD65-7E9321A472C5（重建 / 升级过）。已在 `~/code/deepseek-harness/scripts/_dsh-common.zsh` 第 5/6 行同步更新（dshs/dsho/dshr 共用）。
- 根因②插件崩溃：`plugin/lib/`（git-ignore 的构建产物）残留 2026-09-03 22:39 从含 host-locale.js（英文 i18n 实验，#33 思路）的 src 构建的旧产物，启动即崩 "cannot get property settings without inject"。当时分支 codex/dsh-alpha4-20260902 的 src/host.js 不含 i18n（标签硬编码中文），故按仓库流程 rebuild：`env -u NODE_OPTIONS node scripts/build.mjs` 即可（WorkBuddy 的 NODE_OPTIONS 垫片会劫持 fs.rm 到回收站，沙盒下必失败，必须 unset NODE_OPTIONS）。重建后 lib/ 只剩 client.js/constants.js/index.js，插件正常加载（远程价目合并日志出现，无崩溃）。
- 验证：沙盒内 dsh web 可正常启动、插件加载、端口 3080 监听；沙盒下 nohup 服务进程会在命令会话结束时被回收（属工具环境限制，非用户终端问题）；dsh 版本 0.1.2-alpha.4，根路径无 cookie 时返回 404（脚本就绪判定期望 200/303/401，若用户在终端跑 dshr 仍报「未就绪」，需按 alpha.4 实际响应调整 dsh_http_ready）。
- 待用户在自己终端跑 dshr 确认；若报就绪失败再跟进。英文 i18n（#33 产物 host-locale.js）属主线 v1.10.0，本地此分支没有，属正常。
- 跟进探测（沙盒内，仅作参考）：多实例并发抢 `~/.dsh/.credentials.yaml.lock` 会导致 dsh-client-connection 加载失败；根路径无 cookie 返回 404 疑似 alpha.4 预鉴权行为；但这些都是在 WorkBuddy 沙盒（孤儿进程回收不全 + 代理注入 + node 垫片）下的人为噪音，与用户终端无关，未据此改代码。现场已清理（3080 空闲、无残留进程），等用户在真实终端跑 dshr 的结果为准。

### dshr 真根因 + 彻底修复（续）

- 用户真实终端复现 lock timeout → 现场查证：`~/.dsh/.credentials.yaml.lock` 为 PID 锁（内容 = 持有者 PID 27963），该进程已死（10:32 host-locale 崩溃那次启动的残留）。dsh 原子写对死锁不自动清理，每次启动干等 ~15s 后才放弃继续，恰好撞上 dshr 15s 就绪上限 → 必失败。此即「新服务未就绪」的真根因（非 alpha.4 判断标准问题）。
- 修复动作（`~/code/deepseek-harness/scripts/`，用户已批准「彻底修复」）：
  1. 删除死锁文件（`/bin/rm` 绕过 WorkBuddy safe-delete 垫片）；删除后 dshr 一次即成功（PID 41716，约 3s）。
  2. `_dsh-common.zsh` 新增 `dsh_clear_stale_locks()`：启动前扫 `~/.dsh/*.lock`，仅删「记录 PID 已死」的死锁（活锁 / 非纯数字内容不碰，用 zsh `<->` 数值匹配避免 regex 模块依赖）；dshr/dshs 第 9 行调用。
  3. wait_cap 15→30：冷启动实测 3~16s 波动留余量（真实一次成功仅 3s）。
- alpha.4 就绪语义实测（服务完全就绪后）：`/` 无 cookie→401、`/?token=`→303 种 cookie、带 cookie→200 —— 200/303/401 判定在 alpha.4 下仍然正确，无需改 dsh_http_ready。早前探测到的 404 均来自半启动状态。
- 沙盒注意点（供以后同类排查）：WorkBuddy Bash 工具每个会话注入动态 HTTP_PROXY（端口随机且会变），dshr 内部 curl 无 `--noproxy` 会被劫持成 502 → 就绪误判；nohup 服务进程在命令结束被回收，探测须「起服务 + 验证」同一命令内完成；`env -i` 可绕代理注入。真实终端无这些问题。
- 现场已清：3080 空闲、无残留进程、无锁文件。待用户终端跑 dshr 终验。

### 插件升级 v1.9.2(本地草稿) → v1.10.0（用户指令「更新插件到最新版」）

- 现场：DSH web profile 插件符号链接 `~/.dsh/profiles/web/node_modules/dsh-bottom-info-bar` → `/Users/songsong/code/dsh-bottom-info-bar/plugin`；用户本地 checkout 停在草稿分支 codex/dsh-alpha4-20260902（version 1.9.2），主线 v1.10.0（含英文界面 #33 + alpha.4 适配正式版 #32）已在 GitHub 但本地没用上 —— 同 8-29 白屏误判同款「本地停在草稿分支」问题。
- 核查：本地草稿 3 个独有提交（4992282 alpha.4 契约草稿 / 2416dec CI 保留失败输出 / 339a887 署名大写化）内容均已被主线正式版吸收或仅剩元数据差异，升级无实质丢失。
- 动作：main 分支 `reset --hard` 对齐 origin/main=v1.10.0(71eeacd)；`env -u NODE_OPTIONS <managed node> plugin/scripts/build.mjs` 重建；lib/ 新增 host-locale.js/locales.js（英文 i18n 生效证据）；`tests/run-all.mjs` 全量 PASS（含 test-localization、alpha.4 client contract）。
- 生效方式：符号链接指向本仓库 plugin/，rebuild 即更新，无需重跑 install.sh；用户重启 dsh web 即用 v1.10.0。
- 经验沉淀：用户 checkout 停草稿分支 = 用不上主线新版的第一大原因；升级流程 = 切 / 对齐 main → rebuild（unset NODE_OPTIONS）→ 重启 dsh。草稿分支 codex/dsh-alpha4-20260902 保留未删（含本地独有署名大写差异，如后续要统一大小写署名需另起提交）。

### v1.10.0 启动崩溃根因修复（用户报「dshr 一直出问题」）

- 现象：升级 v1.10.0 后 dshr 报「新服务未能在 30 秒内就绪」；日志尾部：`plugin tree failed ... cannot get property "settings" without inject` at `lib/host-locale.js:7:34`。与上午根因②同错同文件，但非残留产物 —— 是 v1.10.0 正式版（#33 英文 i18n）自身 bug。
- 根因链：cordis ctx 是 proxy，未在 inject 声明就直读 `ctx.settings` 必抛 "without inject"（cordis/lib/index.js:675）。v1.10.0 在 apply 顶层同步构建 SCENARIOS（host.js:1088，label 用带 ctx 的 t()）→ translate 第一行直读 ctx.settings → 崩 → 插件树加载失败 → 宿主起不来。单测全绿原因：test-localization 用普通对象 mock `{settings:{get}}` 绕过 cordis proxy 层，测不出。**CI 全绿 ≠ 真实宿主可跑**。
- 修复（main 24b2273，未 push）：host-locale.js 读宿主语言偏好改走 cordis 官方安全通道 `ctx.get('settings')`（服务缺失返回 undefined 不抛，见 cordis 源码 755 行注释），裸 `.settings` 仅作非 cordis 宿主兜底；tests/test-localization.mjs 补防复发用例（Proxy 模拟直读 .settings 抛错的宿主 ctx → 断言不崩回退 zh）。
- 验证：全量测试绿（含新用例，单独跑 test-localization 可见 "PASS translate survives a host ctx..."）；沙盒实机 dsh web 启动成功：HTTP 401 就绪、插件远程价目合并日志出现、无 without inject/plugin tree failed、进程已清理。
- 待办：①用户终端跑 dshr 终验；②发布 v1.10.1（SOP：release/v1.10.1 分支 bump 版本 + CHANGELOG → PR → CI → squash merge → tag → npm publish），确认用户 OK 后再走。
- 排查经验：cordis 插件里要读宿主服务一律 `ctx.get(name)`（免 inject、缺服务返 undefined），绝不直读 `ctx.xxx` 属性；宿主服务在插件 apply 时若未 provide 则 get 返回 undefined → 代码须能 zh/缺省兜底。

### v1.10.0 独立审计 + 潜在隐患根除（用户指令「独立审计，防止重现，查看潜在 bug」）

- 审计范围：v1.10.0 新增 i18n 全链路 —— 字典完整性、构建注入安全、host/client 侧翻译时序、启动时翻译调用。
- 审计项 1 中英字典：LOCALES.zh 与 LOCALES.en 键值一一对应（各 41 项），无缺失 / 空值，参数占位符 `{model}`/`{price}` 对齐 ✅
- 审计项 2 构建注入：LOCALES JSON 序列化合法、无 undefined、无危险字符 ✅
- 审计项 3 host.js 顶层翻译调用：发现第 100 行 `WINDOW_LABELS = { five_hour: t('host.hour'), ... }` —— 与 SCENARIOS 同类隐患，模块加载即钉死为中文，用户切英文后窗口标签仍显中文。
- 审计项 4 client-bundle 翻译时序：client 侧无启动时翻译常量；字典在 apply 时注入、运行期按需读取，安全 ✅
- 审计项 5 死代码：parseCodexUsage 无调用点，但 test-dual-mode 深度依赖 → 保留并添加 windowLabels 参数 + 注释「暂无调用」。
- 修复（main ffe85ad，未 push）：
  1. 删除模块顶层 WINDOW_LABELS，改为 apply 内局部变量 windowLabels，通过参数注入 4 个解析函数（parseOpenCodeGoUsage / parseXiaomiTokenPlanUsage / parseXiaomiTokenPlanBalance / parseZaiQuota），窗口标签随当前语言动态切换。
  2. parseCodexUsage 同步添加 windowLabels 参数；test-dual-mode 原调用方式不变（直接传对象）。
  3. host.js 模块顶层所有 translate 调用全部消除，杜绝未来 cordis 行为变化导致的二次崩溃风险。
- 验证：全量 600+ 断言绿；沙盒实机 dsh web 启动成功（HTTP 401 就绪、插件加载正常、无崩溃）。

### v1.10.1 发布完成（用户指令「推送」）

- 发布流程（仓库 main 受保护，禁止直接 push）：release/v1.10.1 分支（版本号 1.10.1 + CHANGELOG）→ PR #35（CI+CodeQL 全绿）→ squash merge（93b8eb3）→ tag v1.10.1 → publish-npm workflow success → npm latest=1.10.1。
- PR #35 地址：https://github.com/songoao25/dsh-bottom-info-bar/pull/35
- 本地 main 已对齐 origin/main（squash merge 后单提交），不再保留 ffe85ad/24b2273 两个独立提交（squash 压缩为 93b8eb3）。
- 待办：用户终端跑 dshr 终验（本地符号链接指向仓库 plugin/，rebuild 后即新版；若需从 npm 装最新版可跑 `dsh plugin --profile web add dsh-bottom-info-bar`）。

### 語言切換按鈕反色吞字事故（用戶截圖報障）

- 現象：設置 → 信息底欄 → 界面語言 分段控件（中文 / English），選中態 `data-active="true"` 的按鈕文字被背景吞掉（白字白底 / 透明底白字），明 / 暗主題下均可復現；用戶指出「每次做這個按鈕都會出現這個問題」。
- 根因：`plugin/src/client-bundle.js` 中 `.bib-set-lang-opt[data-active="true"] { background: var(--bib-set-brand); color: #fff; }` 的 `--bib-set-brand` 定義為 `var(--dsw-alias-brand-primary, #4d6bfe)`，在深色主題下該 alias 可能被宿主解析為淺色，導致白底白字對比度 <1.1:1；同時 `.bib-set-lang-opt` 未定義段背景與未選中文字色（`label-secondary` 在深色下過淡），缺乏明暗雙主題驗證與測試鎖定。
- 修復（未發布，待 PR）：
  1. 鎖定品牌色：`.bib-set-root { --bib-set-brand: #4d6bfe; }` 去掉主題跟隨，保證與 `#fff` 對比度 4.6:1
  2. 分段控件加底色 `background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.06))`，未選中態改 `color: var(--dsw-alias-label-primary)` 保證可見
  3. 選中態加 `font-weight:600` + `hover` 仍保持品牌色 `filter: brightness(1.08)`，並加 `forced-colors: active` 適配
  4. 在 `AGENTS.md` 寫入「反色 / 對比度鐵律」永久約束，後續所有帶背景按鈕必須 ≥4.5:1 且雙主題截圖驗證，`tests/test-field-config-client.js` 追加對比度斷言防復發
- 教訓：反色不是裝飾，是可讀性底線；任何 `background + color` 組合必須同時在明 / 暗主題下人眼驗證 + 自動化斷言鎖定，嚴禁再出現「白字被吞」類低級缺陷。
- 狀態：代碼已改、待 `npm run build` + `node tests/run-all.mjs` 全綠後推 `fix/lang-switcher-contrast` PR → CI 綠後走 `auto-merge-own` 自動合併。

### 版本发布纪律（用户明确要求，写入项目记忆）

- 规则：**每一次小 bug 修复、小更新，都直接走一个版本发布更新**（bump patch 版本 + 更新 CHANGELOG + 打 tag + npm publish），严禁修而不发。
- 原因：项目已实现版本更新提醒（启动时检查 npm latest 与本地对比，红点 / 横幅提示），若修复后不发版，用户收不到更新，反而浪费该功能；且用户明确表示「要不然用户不知道更新啊」。
- 落实：已纳入 `AGENTS.md`「版本发布铁律」永久约束；后续任何 fix/docs 類提交，PR 合併後立即走 `release/vX.Y.Z` 流程（参考 v1.10.1/v1.10.2），由 owner PR 的 `auto-merge-own` 自動合併後打 tag 触发 publish。
- 本次实例：`fix/lang-switcher-contrast` (#38) 已合併，立即發 `v1.10.2`（1.10.1 → 1.10.2）。

### 记忆文件规范（本条于 2026-09-11 更新）

- 历史遗留：上述复盘原写在 `~/.workbuddy/MEMORY.md` 与仓库内 `.workbuddy/memory/*.md`（**WorkBuddy 工具专属的隐藏目录**）。
- 自 2026-09-11 起**全部统一到本文件 `MEMORY.md`**，`.workbuddy/` 已删除。凡记录中提到 `.workbuddy/memory/` 或 `~/.workbuddy/MEMORY.md` 的位置，一律以本文件为准。

### 🎉 发布链条首次全链路实跑成功（2026-09-11，v1.11.0）

- **背景**：这是「Release Please 独占版本号 + 人工闸门」定型后，第一次由真实功能提交触发的完整发版。整条链**只用了用户一次确认**，其余全自动。
- **完整轨迹（每一步都有据可查）**：
  1. `feat: copy the update command by clicking the update label` → PR **#79** → CI/CodeQL 全绿 → `auto-merge-own` **success** → 自动合并（196a7d3）。
  2. Release Please 自动算出 **1.11.0**（`feat` 正确涨次版本），开 PR **#80** `chore(main): release 1.11.0`，作者显示为 `songoao25`。
  3. **闸门生效**：`auto-merge-own` 对该 PR 判定 **`SKIPPED`**（同期的 #79 与 docs 分支均为 `success`）——证明闸门**只拦发布 PR、不误伤日常 PR**。同时该 PR `MERGEABLE`、CI `SUCCESS`，**不会死锁**。
  4. **用户确认后合并** → 自动打标签 **v1.11.0** → `publish-npm.yml` **success** → npm `latest` = **1.11.0**。
- **发布包反向核对**（下载 npm 上的 1.11.0 逐个确认，不只看版本号）：`copyUpdateCommand`、`event.stopPropagation()`、`execCommand('copy')` 兜底、`installMode` 分支、新中英文案**全部在内**。
- **意义**：此前闸门只用「伪造分支名」的测试 PR 验证过（PR #75）；本次是**真实发布 PR** 上的验证，架构从「设计正确」变为「实测正确」。

### 版本更新提醒：点击标签复制更新命令（2026-09-11，用户需求，v1.11.0）

- **需求演进（值得记住的沟通教训）**：Agent 最初把方案设计成「自定义浮窗 + 浮窗内可点击复制」，并解释了原生浮窗无法交互。用户澄清：**点击标签本身就是复制动作，浮窗只负责"说明"**——方案因此大幅简化。**教训：先确认交互意图，再谈技术方案；原生 `title` 能装下纯文字说明，不必上自定义浮层。**
- **三个决定成败的细节**（都已写入测试锁死）：
  1. **点击必须 `stopPropagation`**：信息栏根节点自带 `onClick`（切换简洁/完整模式），不拦冒泡会导致「点一下复制顺带把界面切走」。
  2. **命令必须匹配安装形态**：npm 安装 → `dsh plugin --profile <profile> add dsh-bottom-info-bar@latest`；**`link:` 安装（一键脚本 / 本地代码）→ `git -C <path> pull --ff-only`**。给 `link:` 用户复制 npm 命令会**把符号链接换成 registry 版本、顶掉用户本地代码**——而文档里**三种安装方式有两种是 `link:`**，不是边角情况。profile 名从 `process.argv` 读取（CLI 强制 `--profile`），命令精确到用户该敲的那条。
  3. **剪贴板必须有兜底**：`navigator.clipboard` 只在安全上下文存在（`127.0.0.1` 是、**局域网 IP 不是**），缺席时退回临时 textarea + `execCommand('copy')`。
- **尊重既有设计**：标签保持红色告警、**不加下划线**，只加 `cursor: pointer`。原测试有「无下划线（不伪装成链接）」的断言——**选择遵守它而非改掉它**。
- **顺带修好一个脆弱守卫**：`test-realtime-session-model` 用 `!client.includes("}, 2000);")` 防「2 秒轮询」回归，会误伤本次的 2 秒反馈计时器。改为精确匹配 `setInterval` 周期，并**反向验证仍能抓到原轮询写法**（守卫未被放松）。
- 新增 `tests/test-update-command.mjs`（14 条断言，含 npm / `link:` / profile 读不到 三种场景），并做反向验证：删 `stopPropagation` 与删 `link:` 分支各触发一条 FAIL。
