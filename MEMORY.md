# 项目记忆（PROJECT MEMORY）

> 本文件是本项目**唯一**的项目记忆，面向**所有** AI Agent（通用 Agent、Codex、Claude Code、Cursor、WorkBuddy 等）。

## 使用规则（所有 Agent 必须遵守）

- 读写项目记忆**一律使用本文件** `MEMORY.md`（仓库根目录）。开工前先读它，收工前把值得留下的复盘追加进来。
- **严禁任何 Agent 自建私有的、隐藏的、或工具专属的项目记忆。** 例如 `.workbuddy/memory/`、`.cursor/memory/`、各类工具私有目录下的 memory、以及任何未在本文件登记的记忆位置，一律不允许新建。
- **记忆属于项目，不属于工具。** 换一个 Agent、换一个 IDE 接手时，必须能读到完全相同的上下文；写进工具私有目录等于把项目知识锁死在某一个工具里，下一个 Agent 看不到，等于丢失。
- 如果发现历史遗留的工具专属记忆文件，**迁移到本文件后删除**，不要两份并存（两份必然分叉）。
- 新增内容按**日期倒序**追加（最新的在最上面），保留原始日期与结论；只写结论与可复用的经验，不写过程流水账。
- 本文件的规则本身只能由**用户**决定修改，Agent 不得自行放宽或绕过。

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
