# AGENTS.md — 给 AI 编码助手/Agent 的仓库说明

本文件帮助 AI 编码助手（如 DeepSeek Harness、Cursor、Claude Code 等）快速理解本仓库。

## 项目记忆（先读这个）

**`MEMORY.md`（仓库根目录）是本项目唯一的项目记忆。** 开工前先读它，收工前把值得留下的复盘追加进去。

**严禁任何 Agent 自建私有的、隐藏的或工具专属的记忆文件**（如 `.workbuddy/memory/`、`.cursor/memory/`、各类工具私有目录下的 memory）。记忆属于项目，不属于工具 —— 写进工具私有目录等于把项目知识锁死在某一个工具里，换一个 Agent 接手就看不到了。若发现历史遗留的工具专属记忆文件，迁移进 `MEMORY.md` 后删除。详见 `MEMORY.md` 顶部「使用规则」。

**日常怎么干活看 `docs/WORKFLOW.md`**（面向仓库主人 + Agent 的完整流程：谁做什么、哪一步自动、哪一步需要人工确认）。

## 这是什么

「底部信息栏」——DeepSeek Harness（DSH）的一个插件（plugin）。把输入框下面那行原生统计信息换成单行信息栏：服务商与模型、实时余额、高峰/低谷定价及倒计时、按会话/今日/本月/累计的真实花费。装一次，每次启动自动生效。自动识别订阅制（Codex / OpenCode Go）还是余额制，两种模式互斥不重叠。

## 仓库结构

- `plugin/` — 插件本体
  - `plugin/cordis.patch.yml` — 插件组合补丁
  - `plugin/package.json` — 依赖与脚本
  - `plugin/src/` — 源码
  - `plugin/scripts/` — 构建脚本
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
  【人工闸门】auto-merge-own.yml 把发布 PR 排除在自动合并之外
      → 由人（或提示 Agent）确认后手动合并 ← 全链唯一的人工环节
                                    │
        ┌───────────────────────────┘
        ▼
  【第 2 段】release-please 打标签 v1.2.3 → publish-npm.yml（标签触发）
      校验「标签版本 == plugin/package.json 版本」→ npm publish
```

**两段之间靠一个隐式契约衔接，改任何一环都会断链，而且可能静默失败：**

| 契约 | 由谁决定 | 改错的后果 |
|---|---|---|
| 标签必须带 `v` 前缀 | `release-please-config.json` 的 `include-v-in-tag: true` | 标签变成 `1.2.3`，`publish-npm` 的 `v*.*.*` **永远匹配不上** → GitHub 有发布页但 npm 永远没有新版，**且无任何报错** |
| 标签不含组件名前缀 | `include-component-in-tag: false` | 标签变成 `dsh-bottom-info-bar-v1.2.3`，同样静默失配 |
| 包路径 `plugin` | `release-please-config.json` 与 `.release-please-manifest.json` 的键 | 版本号写不回 `package.json` |
| `package-name` | 必须等于 `plugin/package.json` 的 `name` | Release Please 拒绝发布 |
| `changelog-path` | 指向仓库根 `CHANGELOG.md` | 更新日志写错文件 |

**以上契约全部由 `tests/test-release-chain.mjs` 自动校验**（14 条断言）。改动发布相关的任何文件后跑一次全量测试即可确认链条完好。

**严禁手工修改** `plugin/package.json` 的 `version`、`.release-please-manifest.json`、`CHANGELOG.md` 顶部版本号。手工 bump 会让 Release Please 找不到「上次发布」的基准，从而把全部历史当成未发布内容、算出错误的大版本 —— 2026-09-11 的 v2.0.0 误发事故就是这么来的（详见 `MEMORY.md`）。

## 自动化守卫（CI 会拦住，不存在「绕过」）

`tests/test-source-guards.mjs` 把几条血的教训从「文档约定」升级为「CI 硬约束」。违反即 CI 红、合不进去：

1. **禁止裸读宿主服务属性**（`ctx.某个服务名`）。cordis 4 的 Context 是 Proxy，读取未在 `inject` 里声明的服务属性会抛 `cannot get property "X" without inject` —— **即使该服务确实存在也一样抛**。本仓库因此踩坑三次（v1.10.1 `ctx.settings`、2026-09-04 同类、Issue #67 `ctx.sessionController` 导致 500）。合法写法只有三种：① 加进本文件 `inject: [...]`；② 改用 `ctx.get('name')`；③ 老宿主兜底时写成同一行的 `try { ... } catch { ... }`。
2. **项目记忆只允许 `MEMORY.md` 一个**。一旦出现 `.workbuddy/`、`.cursor/memory/` 之类工具专属目录即失败——记忆属于项目，不属于工具。
3. **普通 PR 不得手工修改版本元数据**（`plugin/package.json` 的 `version`、`.release-please-manifest.json`、`CHANGELOG.md`）；只有 `release-please--*` 的发布 PR 有权修改。确需抢修时，在提交信息里写 `[release-metadata-override]` 并在 PR 描述里说明原因（因为 main 开了 `enforce_admins`，没有逃生舱会被永久卡死）。

## 关键约定

- 修改 `plugin/` 后需重启 `dsh web`（插件在宿主启动时组合，刷新页面不够）
- 订阅配额只读：本插件只读 `~/.codex/auth.json` 与 OpenCode Go 配额接口来显示，不负责绑定/刷新/路由；绑定 ChatGPT 账号请装配套插件 dsh-chatgpt-subscription（独立仓库）
- 花费记录持久化到 `~/.dsh/dsh-bottom-info-bar/usage-records.json`，重启不丢
- 对外文档（README/CHANGELOG）只写用户视角功能，严禁开发过程流水账与内部代号
- 提交遵循 Conventional Commits（feat/fix/docs/test/chore）
- 分发铁律：零密钥、零个人路径、作者署名 songoao25、只用语义化版本号
- 反色/對比度鐵律（2026-09-04 血的教訓，嚴禁復發）：所有帶背景色的按鈕/分段控件（如 `.bib-set-lang-opt` 語言切換）選中態必須保證文字與背景對比度 ≥ 4.5:1，嚴禁白字被吞（白底白字、透明底白字、同色系低對比）；`--bib-set-brand` 固定 `#4d6bfe` 不跟隨主題變淺，選中態 `background: var(--bib-set-brand); color: #fff; font-weight:600` 且 `hover` 仍保持品牌色；明/暗主題分別截圖驗證，測試中鎖定（見 `tests/test-field-config-client.js` 的對比度斷言）

## 常用命令

- 安装：`./install.sh`；卸载：`./uninstall.sh`
- 用 dsh plugin 命令安装：`dsh plugin --profile web add /path/to/dsh-bottom-info-bar/plugin`
- 跑测试：见 `tests/run-all.mjs`
- CI 检查项：`.github/workflows/ci.yml`

- 版本发布铁律（2026-09-04 用户明确要求，2026-09-11 更新机制）：每一次小 bug 修复、小更新都必须走一个版本发布，严禁“修了不发”；已实现的版本更新提醒功能依赖此纪律，否则浪费。**具体执行方式见上方「发布机制」——版本号 / CHANGELOG / tag 全部由 Release Please 自动完成，Agent 只需保证提交信息规范（fix/feat），并在发布 PR 出现时提醒用户确认合并。**

- **发布后收尾铁律**（2026-09-13 用户明确要求）：每次更新发布完成后必须做两件事 —— ① 把复盘追加进 `MEMORY.md`；② 写一份**可直接发社区 / 微信群的更新通知**（用户视角大白话，说清「修了什么 bug、更新了什么功能」，不写内部实现）。通知稿追加到 `docs/ANNOUNCEMENTS.md`（最新在最上面）。

- **通知只给正文**（2026-09-13 用户明确要求）：把通知发给用户时，直接给那段可以粘贴的纯文本，**不要**加「以下可直接复制发群」「需要我调整语气吗」之类的包装说明、推荐或追问，也不要用 Markdown 加粗 / 标题 / 代码块（微信群不渲染 Markdown，用户要的是选中即贴的纯文本）。复盘与发版说明另起段落，不要混进通知正文。
