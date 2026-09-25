# AGENTS.md — 给 AI 编码助手/Agent 的仓库说明

本文件帮助 AI 编码助手（如 DeepSeek Harness、Cursor、Claude Code 等）快速理解本仓库。

## 项目记忆（先读这个）

**`MEMORY.md`（仓库根目录）是本项目唯一的项目记忆。** 开工前先读它，收工前把值得留下的复盘追加进去。

**严禁任何 Agent 自建私有的、隐藏的或工具专属的记忆文件**（如 `.workbuddy/memory/`、`.cursor/memory/`、各类工具私有目录下的 memory）。记忆属于项目，不属于工具 —— 写进工具私有目录等于把项目知识锁死在某一个工具里，换一个 Agent 接手就看不到了。若发现历史遗留的工具专属记忆文件，迁移进 `MEMORY.md` 后删除。详见 `MEMORY.md` 顶部「使用规则」。

**日常怎么干活看 `docs/WORKFLOW.md`**（面向仓库主人 + Agent 的完整流程：谁做什么、哪一步自动、哪一步需要人工确认）。

## 开发标准（2026-09-25 用户拍板，所有功能开发必须满足）

四条硬标准，细则与判定方式见 **`docs/DEV-STANDARDS.md`**，现状欠账见 **`docs/CODE-AUDIT.md`**：

1. **两端适配** —— 同一份代码在 DSH 网页端与桌面客户端都要跑；浏览器 API 先探测再使用，路径与环境变量走统一入口，禁止把平台分支散落在业务逻辑里。
2. **简洁优雅** —— 同一件事只允许一份实现；能表格化的不写 if-else 链；常量不写第二遍。
3. **长期可维护** —— 函数不超过 200 行；不留死代码（含孤儿语言 key、有类无名/有名无类）；错误处理形态统一；注释只描述现在。
4. **体系统一化** —— 加功能 = 往既有体系里加一格，不是在渲染层再插一段。判定方法：**加一个新东西要改几处？改 1 处合格，改 5 处以上说明还没设计完。**

**例外只有一种**：历史欠账。允许存在，但不允许变多 —— 所有欠账在 `docs/CODE-AUDIT.md` 逐条登记，触碰某模块时顺手把它的欠账消掉。**已吃过两次同型事故**（渲染层自己长出规则：`if (full)` 那 11 处、字段着色），修一个字段时再加一个 `if` 就是同一个坑第三次出现。

## 这是什么

「底部信息栏」——DeepSeek Harness（DSH）的一个插件（plugin）。把输入框下面那行原生统计信息换成单行信息栏：服务商与模型、实时余额、高峰/低谷定价及倒计时、按会话/今日/本月/累计的真实花费。装一次，每次启动自动生效。自动识别订阅制（Codex / OpenCode Go）还是余额制，两种模式互斥不重叠。

## 仓库结构

**仓库根就是插件包**（官方布局：DSH 插件页的「GitHub 仓库地址」直接指向仓库根即可安装，与姊妹插件 `dsh-chatgpt-subscription` 一致）。

- `package.json` — 插件清单（`dsh.bundle`）与依赖/脚本；版本号归 Release Please 管
- `cordis.patch.yml` — 插件组合补丁（挂载行；行 `name` 必须是包名）
- `src/` — 源码；`lib/` — 构建产物（**已入库**，见下）
- `locale/` — 包级语言字典（`en.json` 是发现入口）
- `plugin/` — **旧安装路径兼容层**：4 个软链（package.json / lib / locale / cordis.patch.yml）指向仓库根同名项，让 1.15.0 及更早用本地代码安装（`link: <仓库>/plugin`）的用户不必重装。**别删**（`tests/test-release-version.mjs` 会拦），也别往里加文件
- `install.sh` / `uninstall.sh` — 一键安装/卸载（默认装到 web profile，可用 --profile 覆盖）
- `tests/` — 静态/烟雾测试与多个单测（dual-mode、display-name、density-toggle、spend-accounting、static-client）
- `docs/` — 设计、审计、QA、运维与调研文档（INSTALL、TECH-DESIGN、PRD、RELEASE、PRICING-SOURCES 等）
- `.github/` — CI、CodeQL、Dependabot、Issue/PR 模板

## 发布机制（2026-09-11 定型，Agent 必读）

本仓库的版本号 **全部由 Release Please 自动管理**，Agent 与人都不要插手。

发版是**一条两段式流水线**（不是两套并行机制 —— 两段做的事完全不重叠）：

```
写 fix:/feat: 提交 → PR → CI → 自动合并进 main
                                    │
        ┌───────────────────────────┘
        ▼
  【第 1 段】release-please.yml（合并到 main 时触发）
      算版本号 → 写 CHANGELOG → 开「发布 PR」
                                    │
        ┌───────────────────────────┘
        ▼
  【技术闸门】auto-merge-own.yml 把发布 PR 排除在「自动合并」之外
      → 由 Agent 跑完测试与真机验证后，用自己的 token 合并（2026-09-24 起默认自动发布，
        不再等用户回「发」；闸门保留是为了不让发布 PR 被静默自动合并 —— v2.0.0 事故的成因）
                                    │
        ┌───────────────────────────┘
        ▼
  【第 2 段】release-please 打标签 v1.2.3 → publish-npm.yml（标签触发）
      校验「标签版本 == package.json 版本」→ npm publish
```

**两段之间靠一个隐式契约衔接，改任何一环都会断链，而且可能静默失败：**

| 契约 | 由谁决定 | 改错的后果 |
|---|---|---|
| 标签必须带 `v` 前缀 | `release-please-config.json` 的 `include-v-in-tag: true` | 标签变成 `1.2.3`，`publish-npm` 的 `v*.*.*` **永远匹配不上** → GitHub 有发布页但 npm 永远没有新版，**且无任何报错** |
| 标签不含组件名前缀 | `include-component-in-tag: false` | 标签变成 `dsh-bottom-info-bar-v1.2.3`，同样静默失配 |
| 包路径 `.`（仓库根） | `release-please-config.json` 与 `.release-please-manifest.json` 的键 | 版本号写不回 `package.json` |
| `package-name` | 必须等于 `package.json` 的 `name` | Release Please 拒绝发布 |
| `changelog-path` | 指向仓库根 `CHANGELOG.md` | 更新日志写错文件 |

**以上契约全部由 `tests/test-release-chain.mjs` 自动校验**（14 条断言）。改动发布相关的任何文件后跑一次全量测试即可确认链条完好。

**严禁手工修改** `package.json` 的 `version`、`.release-please-manifest.json`、`CHANGELOG.md` 顶部版本号。手工 bump 会让 Release Please 找不到「上次发布」的基准，从而把全部历史当成未发布内容、算出错误的大版本 —— 2026-09-11 的 v2.0.0 误发事故就是这么来的（详见 `MEMORY.md`）。

## 自动化守卫（CI 会拦住，不存在「绕过」）

`tests/test-source-guards.mjs` 把几条血的教训从「文档约定」升级为「CI 硬约束」。违反即 CI 红、合不进去：

1. **禁止裸读宿主服务属性**（`ctx.某个服务名`）。cordis 4 的 Context 是 Proxy，读取未在 `inject` 里声明的服务属性会抛 `cannot get property "X" without inject` —— **即使该服务确实存在也一样抛**。本仓库因此踩坑三次（v1.10.1 `ctx.settings`、2026-09-04 同类、Issue #67 `ctx.sessionController` 导致 500）。合法写法只有三种：① 加进本文件 `inject: [...]`；② 改用 `ctx.get('name')`；③ 老宿主兜底时写成同一行的 `try { ... } catch { ... }`。
2. **项目记忆只允许 `MEMORY.md` 一个**。一旦出现 `.workbuddy/`、`.cursor/memory/` 之类工具专属目录即失败——记忆属于项目，不属于工具。
3. **普通 PR 不得手工修改版本元数据**（`package.json` 的 `version`、`.release-please-manifest.json`、`CHANGELOG.md`）；只有 `release-please--*` 的发布 PR 有权修改。确需抢修时，在提交信息里写 `[release-metadata-override]` 并在 PR 描述里说明原因（因为 main 开了 `enforce_admins`，没有逃生舱会被永久卡死）。

## 关键约定

- **`lib/` 是入库的构建产物**：这样用户把 GitHub 地址粘进 DSH 插件页就能装，不需要先构建。改 `src/` 后必须 `npm run build` 并提交 `lib/`——CI 的「Verify generated bundle is committed」会拦住忘记重建的 PR。`package.json` 只保留 `prepublishOnly`（发 npm 时重建），**不要加 `prepare` / `prepack`**：pnpm 对 git 依赖会执行它们，会让 git 安装弹出「待批准的构建脚本」。
- 修改 `src/` 后需重启 `dsh web`（插件在宿主启动时组合，刷新页面不够）；本地 `link:` 副本还要先重建 `lib/`
- 订阅配额只读：本插件只读 `~/.codex/auth.json` 与 OpenCode Go 配额接口来显示，不负责绑定/刷新/路由；绑定 ChatGPT 账号请装配套插件 dsh-chatgpt-subscription（独立仓库）
- 花费记录持久化到 `~/.dsh/dsh-bottom-info-bar/usage-records.json`，重启不丢
- 对外文档（README/CHANGELOG）只写用户视角功能，严禁开发过程流水账与内部代号
- 提交遵循 Conventional Commits（feat/fix/docs/test/chore）
- 分发铁律：零密钥、零个人路径、作者署名 songoao25、只用语义化版本号
- 反色/對比度鐵律（2026-09-04 血的教訓，嚴禁復發）：所有帶背景色的按鈕/分段控件（如 `.bib-set-lang-opt` 語言切換）選中態必須保證文字與背景對比度 ≥ 4.5:1，嚴禁白字被吞（白底白字、透明底白字、同色系低對比）；`--bib-set-brand` 固定 `#4d6bfe` 不跟隨主題變淺，選中態 `background: var(--bib-set-brand); color: #fff; font-weight:600` 且 `hover` 仍保持品牌色；明/暗主題分別截圖驗證，測試中鎖定（見 `tests/test-field-config-client.js` 的對比度斷言）

## 常用命令

- 安装：`./install.sh`；卸载：`./uninstall.sh`
- 用 dsh plugin 命令安装：`dsh plugin --profile web add /path/to/dsh-bottom-info-bar`（路径指向仓库根）
- 跑测试：见 `tests/run-all.mjs`
- CI 检查项：`.github/workflows/ci.yml`

- 版本发布铁律（2026-09-04 用户明确要求，2026-09-11 更新机制）：每一次小 bug 修复、小更新都必须走一个版本发布，严禁“修了不发”；已实现的版本更新提醒功能依赖此纪律，否则浪费。**具体执行方式见上方「发布机制」——版本号 / CHANGELOG / tag 全部由 Release Please 自动完成，Agent 只需保证提交信息规范（fix/feat），并在发布 PR 出现时直接合并、核验 npm 上架（2026-09-24 用户要求：修好即发布，默认自动）。**

- **发布后收尾铁律**（2026-09-13 用户明确要求，2026-09-22 补充第 ③ 条，**2026-09-25 修正第 ③ 条的前提**）：每次更新发布完成后必须做三件事 —— ① 把复盘追加进 `MEMORY.md`；② 写一份**可直接发社区 / 微信群的更新通知**（用户视角大白话，说清「修了什么 bug、更新了什么功能」，不写内部实现）。通知稿追加到 `docs/ANNOUNCEMENTS.md`（最新在最上面）；③ **同步本机实际装载的插件并把这次同步写进复盘**。

  ⚠️ ③ 的前提**会变，禁止凭记忆假设**。历史上出现过两种形态：**`web` profile + `link:` 软链到本仓库**（此时 `git checkout main && git merge --ff-only origin/main` + `node scripts/build.mjs` 重建 `lib/` 即可生效）；**`desktop` profile + pnpm 从 GitHub 拉取的独立快照**（2026-09-24 起本机是这种，此时仓库里做什么都**不影响**本机，必须走桌面端插件更新入口重装）。每次发布后必须重新探测：`ls ~/.dsh/profiles/`（有哪些 profile）、`ls -ld ~/.dsh/profiles/*/node_modules/<包名>`（软链还是实体目录）、`node -p "require('<装载路径>/package.json').version"`（实际版本）。**只更新仓库而不同步本机 = 本机跑旧代码**，用户会看到「刚发布完，自己这里却没变」——2026-09-22 与 2026-09-25 用户两次报的都是这个。探测与同步结果一律写进本次发布复盘。

  **同步 `desktop` 快照的正确命令（2026-09-25 实测可用）**：`cd ~/.dsh/profiles/desktop && env -u NODE_OPTIONS pnpm update dsh-bottom-info-bar`。WorkBuddy 会通过 `NODE_OPTIONS=--require=…/node-language-shim.cjs` 注入 brokered-fs shim，pnpm 往 `~/Library/pnpm/store/v11/projects/` 建项目软链时会被 `EEXIST` 拒掉 —— **去掉 NODE_OPTIONS 即可**，不需要 `dangerouslyDisableSandbox`。改动前先 `cp -R node_modules/<包名> /tmp/<包名>-backup`，改完核对装载版本、lock 钉的提交、以及装载副本里是否真的含本次改动。

  ⚠️ **发布 ≠ 本机生效，还差一次重启**：插件在宿主启动时组合，`lib/` 换了新内容但 DSH 进程仍在跑启动时载入的旧 host。此时 client bundle（从磁盘读）是新版、host（内存里）是旧版，会出现「设置页看着是新的、但新加的 RPC 全部 404」这种新旧混跑。判断运行中 host 是哪个版本的快速办法：看 `~/.dsh/dsh-bottom-info-bar/settings.json` 的字段集合——它由**运行中**的 `FIELD_REGISTRY` 生成，缺哪个新字段就说明 host 还是缺该字段的那一版。每次发布后都要提醒用户/自己重启 DSH。

- **通知只给正文**（2026-09-13 用户明确要求）：把通知发给用户时，直接给那段可以粘贴的纯文本，**不要**加「以下可直接复制发群」「需要我调整语气吗」之类的包装说明、推荐或追问，也不要用 Markdown 加粗 / 标题 / 代码块（微信群不渲染 Markdown，用户要的是选中即贴的纯文本）。复盘与发版说明另起段落，不要混进通知正文。
