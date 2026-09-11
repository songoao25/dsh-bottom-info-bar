# AGENTS.md — 给 AI 编码助手/Agent 的仓库说明

本文件帮助 AI 编码助手（如 DeepSeek Harness、Cursor、Claude Code 等）快速理解本仓库。

## 项目记忆（先读这个）

**`MEMORY.md`（仓库根目录）是本项目唯一的项目记忆。** 开工前先读它，收工前把值得留下的复盘追加进去。

**严禁任何 Agent 自建私有的、隐藏的或工具专属的记忆文件**（如 `.workbuddy/memory/`、`.cursor/memory/`、各类工具私有目录下的 memory）。记忆属于项目，不属于工具 —— 写进工具私有目录等于把项目知识锁死在某一个工具里，换一个 Agent 接手就看不到了。若发现历史遗留的工具专属记忆文件，迁移进 `MEMORY.md` 后删除。详见 `MEMORY.md` 顶部「使用规则」。

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

本仓库的版本号 **全部由 Release Please 自动管理**，Agent 与人都不要插手：

1. PR 合并进 main 后，`.github/workflows/release-please.yml` 会自动算出下一个版本号、写好 `CHANGELOG.md`，并开一个「发布 PR」。
2. 发布 PR 带 `autorelease: pending` 标签、分支名为 `release-please--*`，被 `auto-merge-own.yml` **排除**，不会自动合并 —— **这是唯一的发布闸门**。
3. 合并该发布 PR 后：自动打 tag → `publish-npm.yml` 自动发布到 npm。

**严禁手工修改** `plugin/package.json` 的 `version`、`.release-please-manifest.json`、`CHANGELOG.md` 顶部版本号。手工 bump 会让 Release Please 找不到「上次发布」的基准，从而把全部历史当成未发布内容、算出错误的大版本 —— 2026-09-11 的 v2.0.0 误发事故就是这么来的（详见 `MEMORY.md`）。

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
