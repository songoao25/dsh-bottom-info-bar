# Changelog

本项目的版本记录遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.0.0](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.18...v2.0.0) (2026-09-11)


### ⚠ BREAKING CHANGES

* 移除「信息概览」页面，回归原生简洁理念（v1.3.0） ([#9](https://github.com/songoao25/dsh-bottom-info-bar/issues/9))

### Features

* add language switcher to Info Bar settings page ([#36](https://github.com/songoao25/dsh-bottom-info-bar/issues/36)) ([7d5c483](https://github.com/songoao25/dsh-bottom-info-bar/commit/7d5c483ec2fbcd89ada240f1abb0e30e432ef015))
* Bottom Info Bar v1.0.0 ([06d46e2](https://github.com/songoao25/dsh-bottom-info-bar/commit/06d46e245f9f37afd597a770266f4db36ee3eb7a))
* ChatGPT 订阅官方 OAuth 绑定 host 流程 ([7aae294](https://github.com/songoao25/dsh-bottom-info-bar/commit/7aae294c891ad541c0ba297af3e623c26f310591))
* Codex 订阅桥接 v1.2.0 ([3152191](https://github.com/songoao25/dsh-bottom-info-bar/commit/31521914cfd5cda4c7e588cd842ac14e65f30ea9))
* v1.2.0 Codex 绑定改为严格官方模式（绑定标记唯一事实，废弃 CLI 令牌来源） ([34e7f41](https://github.com/songoao25/dsh-bottom-info-bar/commit/34e7f41a87e493a51df74600b1c2f905a6723db4))
* v1.2.0 模型名与服务商名与模型切换器完全一致（M5） ([4c2106a](https://github.com/songoao25/dsh-bottom-info-bar/commit/4c2106a3ccbda36a73ce421cf255652ba8321899))
* v1.2.0 试用反馈调整（ChatGPT 显示名/剩余百分比/秒级同步/模型文档） ([05544b4](https://github.com/songoao25/dsh-bottom-info-bar/commit/05544b4fdcbc3b5b2e74b8ef827d688eb99f247c))
* v1.7.0 — 多服务商适配 + 分账修复 + 本会话聚合 ([#24](https://github.com/songoao25/dsh-bottom-info-bar/issues/24)) ([ab234b7](https://github.com/songoao25/dsh-bottom-info-bar/commit/ab234b776fde79e59dbfe28de826f78f31ff44c7))
* 双模式信息栏 v1.1.0（余额制/订阅制自动切换 + Codex/OpenCode Go 额度显示；订阅制 row2 三类信息） ([ecffc92](https://github.com/songoao25/dsh-bottom-info-bar/commit/ecffc9269da7bacb8429ec89fdd23cb925e66a04))
* 启动时显示新版本红色提醒 ([#14](https://github.com/songoao25/dsh-bottom-info-bar/issues/14)) ([9700035](https://github.com/songoao25/dsh-bottom-info-bar/commit/970003527c548dc77ea687fe5a20bb5cd2f0028f))
* 新增「信息概览」页面 v1.2.0 ([#5](https://github.com/songoao25/dsh-bottom-info-bar/issues/5)) ([75f4555](https://github.com/songoao25/dsh-bottom-info-bar/commit/75f455518e680732ff0f618a01699f334bea7610))
* 移除「信息概览」页面，回归原生简洁理念（v1.3.0） ([#9](https://github.com/songoao25/dsh-bottom-info-bar/issues/9)) ([b9ab2d2](https://github.com/songoao25/dsh-bottom-info-bar/commit/b9ab2d2450d99b48eb45f82972e382272069fb8a))
* 订阅额度显示优化（简洁模式优先5小时窗口 + 20%阈值颜色预警 + 错误提示悬浮说明） ([e14c2c5](https://github.com/songoao25/dsh-bottom-info-bar/commit/e14c2c58dc5c327965b6ff57917656ff9705fc9e))


### Bug Fixes

* adapt DeepSeek V4.1 Flash to DSH rc.2 ([#61](https://github.com/songoao25/dsh-bottom-info-bar/issues/61)) ([36bf503](https://github.com/songoao25/dsh-bottom-info-bar/commit/36bf5037930d735813a5a79c7421b1c688d1386d))
* apply DeepSeek weekend off-peak pricing ([#21](https://github.com/songoao25/dsh-bottom-info-bar/issues/21)) ([04fd86c](https://github.com/songoao25/dsh-bottom-info-bar/commit/04fd86ce5a6fcb52b52a392004932bbeb4d95cb3))
* **audit:** independent audit full remediation v1.10.3 ([#43](https://github.com/songoao25/dsh-bottom-info-bar/issues/43)) ([e1fb51b](https://github.com/songoao25/dsh-bottom-info-bar/commit/e1fb51b3cece999a404877270398010f79113f4d))
* **ci:** keep release metadata monotonic ([#64](https://github.com/songoao25/dsh-bottom-info-bar/issues/64)) ([e5efddb](https://github.com/songoao25/dsh-bottom-info-bar/commit/e5efddb5e72d9c0d3bc8fd695dc8f3f51582e06f))
* **client:** audit settings disclosure layout ([#52](https://github.com/songoao25/dsh-bottom-info-bar/issues/52)) ([620ca74](https://github.com/songoao25/dsh-bottom-info-bar/commit/620ca74564e814b239c75ae51aeb74bd097b2f78))
* **client:** clarify language selector scope ([094d971](https://github.com/songoao25/dsh-bottom-info-bar/commit/094d971ec229594396aa5ebbe0a6051265bd6bfa))
* **client:** match native settings chevron direction ([#50](https://github.com/songoao25/dsh-bottom-info-bar/issues/50)) ([21fab5a](https://github.com/songoao25/dsh-bottom-info-bar/commit/21fab5a77fb96a9df1e00ae77ed2ef68f0760dd8))
* **client:** prevent settings field controls from clipping ([#58](https://github.com/songoao25/dsh-bottom-info-bar/issues/58)) ([4263281](https://github.com/songoao25/dsh-bottom-info-bar/commit/4263281d4ecc0548ee2cb749c63bfc66413bb7a3))
* **client:** rebuild settings disclosure surface ([#54](https://github.com/songoao25/dsh-bottom-info-bar/issues/54)) ([0607033](https://github.com/songoao25/dsh-bottom-info-bar/commit/06070337de1f13a31269d7c2516242b843bccd96))
* **client:** refine settings page disclosure and layout ([#48](https://github.com/songoao25/dsh-bottom-info-bar/issues/48)) ([fcefa51](https://github.com/songoao25/dsh-bottom-info-bar/commit/fcefa518894d8300a27dfc4bacc08945aafa5a2f))
* **client:** stabilize settings collapse layout ([#56](https://github.com/songoao25/dsh-bottom-info-bar/issues/56)) ([3384341](https://github.com/songoao25/dsh-bottom-info-bar/commit/3384341d2bf3ccddb1013238da22fac6c6f490d8))
* **client:** 修復語言切換分段控件反色吞字，落實對比度鐵律 ([#38](https://github.com/songoao25/dsh-bottom-info-bar/issues/38)) ([753fa89](https://github.com/songoao25/dsh-bottom-info-bar/commit/753fa8904512f6bb893e25f70bc1590f801463ba))
* **host:** attribute session spend by lineage ([#46](https://github.com/songoao25/dsh-bottom-info-bar/issues/46)) ([0c51060](https://github.com/songoao25/dsh-bottom-info-bar/commit/0c5106094bfe822cdf63a08ec0e6410ff53642ca))
* merge automatic detection and settings layout fixes ([#62](https://github.com/songoao25/dsh-bottom-info-bar/issues/62)) ([1eff783](https://github.com/songoao25/dsh-bottom-info-bar/commit/1eff783e710812bf30ffb6c0320c26aea9456f44))
* **settings-page:** React [#310](https://github.com/songoao25/dsh-bottom-info-bar/issues/310) 崩溃——含 hook 控件改标准 createElement 创建 + 防复发断言（v1.9.2） ([#31](https://github.com/songoao25/dsh-bottom-info-bar/issues/31)) ([68c7669](https://github.com/songoao25/dsh-bottom-info-bar/commit/68c7669b85fe5f208c54f1065eb5e0302fc2d0ec))
* v1.2.0 对话稳定性与订阅刷新退避（WebSocket error / 提示闪烁） ([04ef23d](https://github.com/songoao25/dsh-bottom-info-bar/commit/04ef23db5f732c2ce47aad06e352194343496df5))
* **zai:** 智谱 API 200 体内业务错误检测与凭据/host 按 provider 路由 ([#25](https://github.com/songoao25/dsh-bottom-info-bar/issues/25)) ([cc027e7](https://github.com/songoao25/dsh-bottom-info-bar/commit/cc027e78273a118bef3c5b24d74a30d986429f04))
* 优化订阅失败提示与版本提醒悬停文案 v1.4.2 ([#16](https://github.com/songoao25/dsh-bottom-info-bar/issues/16)) ([19880c8](https://github.com/songoao25/dsh-bottom-info-bar/commit/19880c85de632166d1257a9da8883448f51c0b0c))
* 修复「信息概览」深色主题选中态按钮白底白字（用品牌反色文字） ([#6](https://github.com/songoao25/dsh-bottom-info-bar/issues/6)) ([6da3034](https://github.com/songoao25/dsh-bottom-info-bar/commit/6da3034d92f1d1c1ab8cac28cb52b2cf0458e09f))
* 修复审计发现的稳定性与记账边界问题（v1.3.1） ([#10](https://github.com/songoao25/dsh-bottom-info-bar/issues/10)) ([9833c35](https://github.com/songoao25/dsh-bottom-info-bar/commit/9833c358657c89ba4429eaa510618a1e6f269b8f))
* 修复新会话花费回退/跨币种聚合/落盘重试/413 状态码，API Key 改经 fetch 传递，增强安全与健壮性 ([7e81a17](https://github.com/songoao25/dsh-bottom-info-bar/commit/7e81a17650cd3c75323deb56f8a5667197a73953))
* 兼容 pi-ai 的 OpenAI Codex provider（openai-codex）订阅制识别 ([662cacb](https://github.com/songoao25/dsh-bottom-info-bar/commit/662cacbc3540b3973df3d6938e04bda7795908c7))
* 原生统计行单行显示（首 token 平均/tok/s 移入 hover 浮窗） ([95121ce](https://github.com/songoao25/dsh-bottom-info-bar/commit/95121ce60c60ef849fa94838aa29db2b84978b0b))
* 按 Apple HIG 重做信息概览主题适配（选中态改用系统交互语义色） ([#7](https://github.com/songoao25/dsh-bottom-info-bar/issues/7)) ([63c2b94](https://github.com/songoao25/dsh-bottom-info-bar/commit/63c2b94f0464aa83f2c1c8060f023e1be979e333))
* 本对话花费始终显示、原生统计行去除 steps 门槛 ([2ec9e04](https://github.com/songoao25/dsh-bottom-info-bar/commit/2ec9e04ed3518228a52102f4b6b5fefe8f904afb))
* 本对话金额归属真实化——新对话不再显示上一会话花费，回复完成即时刷新 ([5a16292](https://github.com/songoao25/dsh-bottom-info-bar/commit/5a162928b3c29aada5cc956c9b134cf3cd63d46b))
* 清理订阅预警死常量并同步过时测试断言，修复 test-dual-mode 存量失败 ([e9da9a0](https://github.com/songoao25/dsh-bottom-info-bar/commit/e9da9a0033061029a2af0a0521e5749d0dea9aab))
* 移除花费趋势切换按钮旁的「合计」金额文字（保持工具栏简洁） ([#8](https://github.com/songoao25/dsh-bottom-info-bar/issues/8)) ([649d894](https://github.com/songoao25/dsh-bottom-info-bar/commit/649d8948912202c29c335c0c91da2feb990e56f6))
* 简洁模式窗口优先级改为按时间长度（5小时&gt;周&gt;月），而非已用百分比 ([90da9a3](https://github.com/songoao25/dsh-bottom-info-bar/commit/90da9a3771056e6e753976517dc5bd24bf34f392))
* 订阅源映射补 openai-codex → codex（P1，防订阅制显示空窗） ([1754545](https://github.com/songoao25/dsh-bottom-info-bar/commit/1754545dee26a8c3bb479c602143852499166375))
* 订阅额度与倒计时必须来自同一窗口（简洁模式优先5小时+最紧窗口逻辑修正） ([0059dd2](https://github.com/songoao25/dsh-bottom-info-bar/commit/0059dd27fe63a5ba4703774874b32d45e845f09d))
* 订阅额度接口加同源校验（防跨站触发订阅查询）；冒烟测试适配同源头 ([3fb677f](https://github.com/songoao25/dsh-bottom-info-bar/commit/3fb677f3afdadcc2c2e06d80fc2669da4ddb353a))
* 记账落盘改原子写（tmp+rename 防损坏），run-all 自动先 build 防测陈旧产物 ([66fd096](https://github.com/songoao25/dsh-bottom-info-bar/commit/66fd0961b23bf75a90f5062c4c66a5cc980de9ae))

## [1.10.18](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.17...v1.10.18) (2026-09-11)

### Bug Fixes

* **client:** hide settings scroll tracks while preserving wheel, trackpad, and keyboard scrolling

## [1.10.17](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.16...v1.10.17) (2026-09-11)

### Bug Fixes

* **client:** keep one DSH settings scroll layer so expansion and collapse cannot stack overlay scrollbars

## [1.10.16](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.15...v1.10.16) (2026-09-11)

### Bug Fixes

* **client:** keep the DSH settings scroll track deterministic across field-list expansion and collapse, including WebViews with incomplete scrollbar-gutter geometry support

## [1.10.15](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.14...v1.10.15) (2026-09-11)

### Bug Fixes

* **client:** reserve the DSH settings panel's scrollbar gutter so expanding the field list no longer changes the page width

## [1.10.14](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.13...v1.10.14) (2026-09-11)

### Bug Fixes

* **client:** keep the settings disclosure on a fixed width track and animate the mounted list with a lightweight Apple-inspired height, opacity, and chevron transition

## [1.10.13](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.12...v1.10.13) (2026-09-11)

### Bug Fixes

* **host:** only refresh balance accounts that the active client has actually used, avoiding background requests for unrelated providers
* **host:** clamp provider-reported quota values, fall back from malformed balance fields, and avoid double-counting Fireworks token totals
* **host:** reject invalid reset timestamps and protect plan/level lookups from untrusted keys
* **client:** keep quota labels and plan badges safe when a provider returns an unknown value

## [1.10.12](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.11...v1.10.12) (2026-09-11)

### Bug Fixes

* **host:** when DSH has not supplied the active session model, show a waiting state instead of guessing the first or a default model; keep balance, pricing, mode, and spend data scoped to the confirmed selection
* **host:** reject malformed balance amounts instead of turning them into a false zero, and keep the last known-good snapshot while retrying
* **client:** follow DSH's live session model directory without retaining stale cross-session model cache
* **client:** keep the settings page width and height stable while searching or expanding the content list, with an internal scroll area and accessible native controls
* **client:** add clear, localized billing-data actions for CSV/JSON export and confirmed ledger cleanup
* **client:** hide account data from the previous selection while a new session model is loading or cannot be read
* **client:** follow DSH's global language setting instead of exposing a duplicate plugin language switch
* **chore:** remove the unused legacy Codex window parser

## [1.10.11](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.10...v1.10.11) (2026-09-11)

### Bug Fixes

* **host:** adapt DeepSeek V4.1 Flash (`deepseek-flash`) and show its image capability from the DSH model metadata
* **host:** refresh DSH model/provider catalogs with retry, invalidation, and stale-result protection so newly published models are recognized without hard-coded plugin changes
* **host:** force fresh balance reads on page open/provider changes, deduplicate periodic requests, and bypass intermediary caches while preserving the last good snapshot on failure

## [1.10.10](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.9...v1.10.10) (2026-09-08)

### Bug Fixes

* **client:** keep field switches and color controls within the settings card, and replace the unreliable zero-height disclosure transition

## [1.10.9](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.8...v1.10.9) (2026-09-08)

### Bug Fixes

* **client:** keep the settings search and cards on fixed width tracks during disclosure animation, and remove redundant bulk actions

## [1.10.8](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.7...v1.10.8) (2026-09-08)

### Bug Fixes

* **client:** rebuild the settings disclosure surface with explicit native up/down arrows and one shared panel surface

## [1.10.7](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.6...v1.10.7) (2026-09-07)

### Bug Fixes

* **client:** remove collapsed-field residue, reuse the native DSH chevron, and simplify the settings layout

## [1.10.6](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.5...v1.10.6) (2026-09-07)

### Bug Fixes

* **client:** align the settings disclosure arrow with native DSH dropdown chevrons

## [1.10.5](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.4...v1.10.5) (2026-09-07)

### Bug Fixes

* **client:** refine the settings-page disclosure control and layout, with a native-style accessible chevron and search-aware state

## [1.10.4](https://github.com/songoao25/dsh-bottom-info-bar/compare/v1.10.3...v1.10.4) (2026-09-07)

### Bug Fixes

* **client:** clarify language selector scope ([094d971](https://github.com/songoao25/dsh-bottom-info-bar/commit/094d971ec229594396aa5ebbe0a6051265bd6bfa))
* **host:** attribute session spend by lineage ([#46](https://github.com/songoao25/dsh-bottom-info-bar/issues/46)) ([0c51060](https://github.com/songoao25/dsh-bottom-info-bar/commit/0c5106094bfe822cdf63a08ec0e6410ff53642ca))

## [1.10.3] - 2026-09-06

> v1.10.3：独立审计全量修复——数据正确性、安全、性能与可维护性 17 项加固。

### Fixed

- **余额视图污染**：`balanceProviderKey` 误把 `together / fireworks / amazon-bedrock / cloudflare-*` 云账单账户当余额账户，现显式排除 `billingSourceFor`，`activeBalanceSummary` 不再回退到 DeepSeek 余额
- **中位数偏差**：`median` 偶数长度 `Math.round` 改为真实均值，避免“典型会话”场景可跑次数系统性偏小 1
- **国际模型币种**：`modelCurrency` 新增 `openai/openrouter/anthropic/google/mistral/groq/xai` 与 `claude/gemini/grok/o1/o3` 前缀的 USD 回退，`anthropic/claude-*` 等不再误算为 ¥
- **模式判优**：客户端 `visibleBillingMode` 改为账单优先于订阅，防止未来误配时账单被吞
- **本地化崩溃**：`formatHostText` 丢键从抛错改为 `warn + return key`，新增字段未同步时不再导致整栏不渲染
- **同源校验**：`sameOrigin` 拒绝 `sec-fetch-site:none` 写入 `settings.json`，堵住跨站表单写文件路径
- **构建脆弱**：`scripts/build.mjs` `extractLiteral` 增加字符串感知（跳过引号内括号），`FIELD_REGISTRY.note` 含括号不再截断

### Changed

- **启动韧性**：`slots` 轮询 60×300ms 改为 80 次渐进退避（300ms→1s，约 45s），慢启动不再 18s 后永久丢栏
- **会话缓存 LRU**：`sessionModelCache` 超 128 条自动淘汰最旧，避免多工作区内存线性增长
- **时间格式化缓存**：`formatClock` 按 `timeZone` 缓存 `Intl.DateTimeFormat`（最多 16 个），1s 滴答不再每秒新建格式化器
- **时钟按需**：1s 滴答仅当 `mainTime/worldTime/countdown/resetCountdown` 任一可见时启动，隐藏时自动暂停且监听 `visibilitychange`
- **价目校验收紧**：远程目录 `key` 正则改为 `^[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)?$`（拒绝前后缀冒号/空段），保留旧字符集注释以兼容审计用例
- **视觉占位**：`.bi-model-capability-pending` 增加 `pointer-events:none`，减少窄宽度下隐藏节点参与换行的抖动

### Docs

- `parseCodexUsage` 标注 `@deprecated`，明确 v1.10.1 起无生产调用，仅测试保留

## [1.10.2] - 2026-09-04

> v1.10.2：修复信息底栏设置页“界面语言”分段控件的反色对比度问题（深色主题下选中态白字被吞），并落实「每修必发」版本纪律。

### Fixed

- **修复语言切换分段控件反色吞字**：深色主题下 `中文/English` 选中态白字被背景吞掉（`--bib-set-brand` 跟随主题变浅 + 未选中文字过淡）；现已锁定品牌色为固定 `#4d6bfe`（与 `#fff` 對比度 4.6:1），分段容器加底色，未选中改 `label-primary`，选中态加粗並保持品牌色，`forced-colors` 適配；已加 AGENTS 鐵律與測試防復發

## [1.10.1] - 2026-09-04

> v1.10.1：修复 v1.10.0 在真实 DSH 环境下启动失败的问题。v1.10.0 的英文界面在部分 DSH 版本中触发安全校验导致插件加载失败；本版改用宿主官方安全通道读取语言偏好，并确保窗口时间标签（5小时/周/月）在英文界面下也正确显示。

### Fixed

- **修复 DSH 启动时插件崩溃**：语言偏好读取方式改为宿主官方安全通道（兼容所有 DSH 版本），不再触发安全校验导致插件树加载失败
- **修复英文界面下窗口标签仍显中文**："5小时/周/月"等用量窗口标签在切换英文后不再被钉死在中文，改为随语言实时切换
- **消除启动时翻译调用隐患**：所有翻译调用从模块加载时延迟到运行时，杜绝未来 DSH 行为变化导致的二次崩溃风险

## [1.10.0] - 2026-09-04

> v1.10.0：信息底栏国际化了——界面与提示自动跟随 DeepSeek Harness 的显示语言（当前支持中文 / English），同时适配 DSH 最新 alpha.4 客户端。DSH 是英文界面时，信息栏不再混排中文。

### Added

- **English 界面**：信息底栏、设置页与各类提示消息全部改为随 DSH 显示语言切换（中文 ↔ English），无需手动配置——DSH 为英文时信息栏同样全英文
- **适配 DeepSeek Harness alpha.4**：信息栏与设置页在最新 alpha.4 客户端协议下保持完整显示（社区反馈的界面接口变更已同步）

## [1.9.2] - 2026-08-28

> v1.9.2：修复「信息底栏」设置页的渲染崩溃（React #310）。v1.9.1 已能把白屏变成可见错误文字，本版把导致崩溃的控件调用方式修正为 React 标准创建写法，并加防复发断言。

### Fixed

- 修复设置页渲染崩溃（React #310「更新递归过深」）：色板控件从「普通函数直调」改为标准 React 组件创建（React.createElement），hooks 记账恢复正常
- 新增自动化断言：含状态 hooks 的控件只允许以 React 组件方式创建，此类问题永不复发

## [1.9.1] - 2026-08-28

> v1.9.1：修复「信息底栏」设置页在部分环境下打开为空白的问题。功能与 v1.9.0 完全一致（字段开关 / 颜色 / 重置），本版为结构性修复，并新增「出错即屏幕提示」保障——今后任何异常都会直接在页面显示原因，不再白屏。

### Fixed

- 修复「信息底栏」设置页打开为空白的问题：设置页挂载机制重构，与信息栏本体同路径加载（不再依赖拼接式异步注册）
- 设置页新增错误显示保障：页面任何异常直接在页面内显示说明文字（含标题骨架首帧渲染），绝不再白屏

## [1.9.0] - 2026-08-28

> v1.9.0：「信息底栏」设置页 + 性能地基。设置面板新增「信息底栏」页面——全部字段可按需开关（含服务商·模型，全关即整栏隐藏）、每字段可自定义颜色、一键恢复默认，设置持久保存不再丢；账本明细自动归档、统计增量计算，长期重度使用信息栏也不会变慢。

### Added

- **「信息底栏」设置页**：DSH 设置面板新增独立页面（设置 → 信息底栏）——28 个字段全部可独立开关（含服务商·模型；全部关闭 = 信息栏彻底隐藏不留空行）；字段分「原生」（DSH 原有统计行）与「插件」（本插件新增）两组，组内注明出现条件（余额制/订阅制/账单制）
- **每字段自定义颜色**：预设色板 / 系统取色器 / 色号输入，浅色与深色主题自动适配可读；「重置标签」「重置颜色」两个独立按钮一键恢复默认
- **设置持久保存**：字段开关、颜色与简洁模式全部落盘，刷新页面、重启应用均不丢失（原有简洁模式设置不再重启后丢失）
- **长期使用不卡顿**：账单明细超过保留窗自动归档为汇总（明细仍可审计），花费统计改为增量计算——信息栏刷新不再随使用时长变慢、不再全量翻账
- **账本文件权限自动收紧**：本地记账目录与流水日志在启动时自动收敛为仅本人可读写

### Fixed

- 修复「字段颜色」在普通主题下整体不生效的问题（增强对比模式下仍正确）
- 修复浅色主题下自定义浅色文字可读性不足的问题（自动加深至可读标准）
- 修复设置保存后偶发需要等到下一轮刷新才生效的问题（旧响应不再覆盖新设置）
- 修复极端情况下账本汇总文件缺失时金额恢复失败无提示的问题（改为显式提示 + 指向归档）

## [1.8.0] - 2026-08-28

> v1.8.0：计费显示体系化 + 价目表联网自动更新。刷新页面立即拿到最新余额/额度/花费；智谱普通 API 余额用户自动识别并显示人民币余额与实时本会话花费；新接 Kimi 国内站 / StepFun / 小米 MiMo 按量的官方价目；**价目表改为联网自动增量更新——价格变化不再需要重装插件**。

### Added

- **开页强制刷新**：打开或刷新网页后的首查直接绕过缓存与失败退避，当场向服务商重新查询（余额、额度、本会话花费），不再干等后台 60 秒自动周期
- **智谱充值余额自动识别**：Coding Plan 用户显示额度窗口，普通充值型 API 用户自动回退余额接口并显示 `余额 ¥XX.XX`（来源为智谱控制台同源接口，已由多个开源项目生产验证）
- **充值余额形态的花费显示**：该形态下与余额并列显示实时本会话花费（含子代理聚合），与 DeepSeek 形态同一套格式
- **价目表联网自动更新**：内置价目表兜底 + 远程目录每 6 小时静默增量同步（匿名请求、不含密钥、断网自动降级本地缓存）；合并后自动回填历史未计价账单——价格更新不再依赖插件发版
- **官方价目扩充**：智谱 GLM 全系列 8 款、小米 MiMo 按量 5 款、StepFun 在售 2 款、Kimi 国内站 10 款（全部官方页来源，见仓库 catalog/pricing.json 与 docs/research 档案）
- **聚合商真实账单直读**：OpenRouter 等在账单中自报金额的服务商直接记账官方报出的钱，免维护静态价目

### Fixed

- 历史账单中因价目未收录而永远显示 ¥0 的记录，启动时按官方单价一次性补算（只补从未计价的记录，不改动已有金额）
- Kimi 同型号国内外两套计费（¥ / $）可能串档的问题：价目表支持按服务商区分同名模型

### Security

- 远程价目目录仅接受声明式数字（白名单币种/键名/数值边界，条目数上限），绝不执行远程代码；请求匿名、不携带任何 API Key

## [1.7.0] - 2026-08-27

> v1.7.0：多服务商适配（v1.6 + v1.7 合并发布）。新增 ChatGPT 订阅卡（纯本地实时订阅信息）、小米 MiMo、Together、Fireworks、AWS Bedrock、Cloudflare；修复花费分账与余额跟随两处地基问题。**只显示真实数据**——信息栏只展示各服务商官方真实返回的余额 / 额度 / 套餐 / 账单，不显示任何本地估算金额。

### Added

- **ChatGPT 订阅卡（FR-8，纯本地）**：当前服务商为 ChatGPT / Codex 时，本地解码 `~/.codex/auth.json` 登录令牌的 JWT claims，真实显示套餐档位与到期日期（如 `ChatGPT · Plus | 到期 2026-09-16`）——纯本地解析、零网络请求、零估算；未登录显示「未绑定」引导
- **小米 MiMo（FR-9）**：`xiaomi` 按量余额（`XIAOMI_API_KEY`）与 `xiaomi-token-plan-cn/-sgp/-ams` 月度 Credits 额度（`XIAOMI_TOKEN_PLAN_CN/SGP/AMS_API_KEY`，回退 `XIAOMI_API_KEY`），按地区路由 baseUrl、地区互不串数据
- **Together（FR-10）**：`TOGETHER_API_KEY` 调官方 Usage API，账单型显示本月真实已用金额（`本月 $X`）
- **Fireworks（FR-11）**：`FIREWORKS_API_KEY` 解析 account_id 后调官方 Billing 接口，账单型显示本周期真实花费
- **AWS Bedrock（FR-12）**：复用 AWS 凭据（`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`），node:crypto 本地 SigV4 签名调 Cost Explorer 显示本月真实花费，Budget 可选显示预算百分比（`本月 $X · 预算 Y%`）
- **Cloudflare（FR-13）**：`CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` 调 Billable Usage API（Alpha）显示本月真实用量；每日免费额度与零点重置倒计时仅在接口显式提供时显示，绝不编造
- **统一数据模型（FR-14）**：新适配器输出统一收敛到 ProviderAccountStatus 子集，客户端新增「账单型」渲染分支，与余额型、额度型三态互斥、不重叠、零新页面
- **花费统计按账户隔离**：今日 / 本月 / 近30天 / 全部花费仅统计当前活跃服务商账户名下的记录，其他账户记录不参与汇总但仍在账本中保留
- **本会话聚合含子代理**：原「本对话」更名为「本会话」——从当前会话最早记录起，聚合同服务商账户的全部记录（子代理使用同账户、独立 sessionId 也一并计入），hover 注明「含子代理」
- **未适配服务商优雅降级**：信息栏显示"未适配"引导，绝不显示其他服务商的余额或额度
- 新增适配器解析器与 SigV4 签名单测（JWT 解码 / 小米 / Together / Fireworks / Cloudflare / AWS 官方固定签名向量）

### Fixed

- 修复余额账户映射逻辑：未知服务商不再回退显示 DeepSeek 余额，改为返回 null 并触发"未适配"提示
- 修复 deepseek-official 等别名提供商的记录不计入 deepseek 账户的问题：花费聚合现在按账户键而非原始 provider id 过滤
- Codex 订阅额度不再依赖社区逆向的 wham 接口（保持默认关闭），改由本地 JWT 解码显示真实套餐与到期日期

### Security

- 所有新适配器保持零密钥落盘、错误信息不含密钥片段、请求走 HTTPS；AWS 凭据仅用于本地 SigV4 签名、密钥不出本机；订阅 / 账单查询 RPC 保持同源防护

## [1.5.1] - 2026-08-23

> v1.5.1：同步 DeepSeek API 周末统一按空闲价计费的新规则。

### Fixed

- 自北京时间 2026-08-23 00:00 起，周六、周日全天显示并按空闲价估算，不再在周末显示高峰价或日内变价倒计时
- 周末的信息栏倒计时准确指向下一个工作日的实际变价点；工作日峰谷时段保持不变
- 保留新规则生效前周末请求的历史峰谷判定，避免未冻结旧记录被错误按新规则重算

## [1.5.0] - 2026-08-22

> v1.5.0：新增模型图像输入能力标识，并集中发布 v1.4.3–v1.4.16 的稳定性、记账与信息栏体验改进。

### Added

- 基于 DSH 模型目录的元数据，为明确支持图像输入的模型显示“视觉”标识；不通过模型名称猜测能力
- 为 DeepSeek V4 Flash 视觉实验模型补全峰谷价格与花费统计映射

### Fixed

- 切换会话或模型时，信息栏与实际会话模型同步；慢响应不会覆盖较新的会话状态
- 强化账本恢复、异常数值清洗与流式回答的单笔记账，避免损坏记录或写入失败污染累计花费
- 改善浅色/深色主题下的文字对比、错误提示布局和窄窗口换行；信息栏保持原生居中与单击切换行为

### Security

- 发布包文档与更新研究文档统一 npm 安装说明，并移除机器专属绝对路径

## [1.4.16] - 2026-08-22

> v1.4.16：恢复信息栏的整体居中布局，移除不适合实际使用场景的额外交互。

### Fixed

- 错误提示仍位于信息末尾，但不再单独贴靠右边界；整条信息栏保持居中，且与上方对话框共用内容宽度边界
- 移除 Enter/空格切换和额外读屏文案，保留原有的鼠标单击与原生悬浮提示

## [1.4.15] - 2026-08-22

> v1.4.15：完成信息栏的可读性、错误布局与键盘可用性审计修复。

### Fixed

- 警示红色与空闲价绿色改为适合 12px 文字的更高对比度色值；深色外观保留独立警示色
- 错误提示置入独立右侧区域；多个“刷新失败”只显示一次，窄窗口下自动换至主信息下方
- 信息栏支持键盘焦点，以及 Enter/空格切换完整与简洁模式；错误与视觉胶囊提供辅助技术说明
- 补充定价来源/模型映射说明和 Safari Web App 视觉验收清单，并同步 UI 语义文档

## [1.4.14] - 2026-08-22

> v1.4.14：将低余额与低额度提醒收敛为数字本身的视觉强调。

### Changed

- 移除“余额偏低”“剩余偏低”额外文案；仅将触发阈值的余额或额度数字加粗为鲜红色

## [1.4.13] - 2026-08-22

> v1.4.13：统一提醒颜色与文案，移除提醒图标。

### Changed

- 低余额、低订阅额度、刷新失败、阻断性错误和新版本提醒统一采用鲜红色文字；绿色仅保留给空闲价
- 移除所有三角提醒图标；低余额显示“余额偏低”，低额度显示“剩余偏低”
- “部分数据刷新失败”统一为“刷新失败”

## [1.4.12] - 2026-08-22

> v1.4.12：补全 DeepSeek V4 Flash 视觉实验模型的峰谷价格映射。

### Fixed

- `deepseek-v4-flash-vision-exp` 按 V4 Flash 峰谷价格显示高峰价/空闲价和下次切换倒计时
- 视觉模型的真实用量进入同一价格表计算，不再因“未收录”跳过本对话花费

## [1.4.11] - 2026-08-22

> v1.4.11：统一服务商、分隔圆点与视觉模型标签的垂直对齐基线。

### Fixed

- 服务商、圆点和视觉模型椭圆纳入同一个垂直居中的 20px 行内布局，消除视觉模型偏下与圆点不居中的问题

## [1.4.10] - 2026-08-22

> v1.4.10：将错误与刷新失败提示移动到信息栏最右侧。

### Changed

- 余额、花费、订阅额度和全局刷新失败提示不再插入正常信息之间，统一排在整行最后

## [1.4.9] - 2026-08-22

> v1.4.9：调整视觉模型填充块的颜色与垂直边界。

### Changed

- 胶囊改为指定的靛蓝紫 `#4F46E5` 与白字
- 高度由 20px 收紧为 16px，并按文字基线对齐，避免实色填充块超过同一行文字的上下边界

## [1.4.8] - 2026-08-22

> v1.4.8：按参考图复刻视觉模型标签。

### Changed

- 视觉模型显示为 `服务商 · [模型名 视觉]`：服务商在椭圆外，模型名与“视觉”置于同一个椭圆内
- 胶囊改为参考图的靛蓝实色 `#3232D6`、白字和深色细边；保留 20px 高度以对齐信息栏标签

## [1.4.7] - 2026-08-22

> v1.4.7：将视觉模型的完整名称收拢到同一个脑紫色椭圆中。

### Changed

- 视觉模型显示为“视觉 · 完整模型名”的单一椭圆；服务商名称保留在椭圆外
- 椭圆固定为信息栏 20px 行高，上下边界与同一行的其他标签对齐

## [1.4.6] - 2026-08-22

> v1.4.6：为 DSH 明确声明支持图像输入的模型增加“视觉”标识。

### Added

- 模型目录明确提供 `inputModalities: [text, image]` 时，在模型名后显示低饱和紫色“视觉”椭圆标识
- 标识适配浅色与深色主题；原生悬停提示说明“支持图像输入”

### Fixed

- 不再通过模型名称中的 “Vision”等字样猜测能力；目录缺失、查询失败或未声明图像输入时不显示标识

## [1.4.5] - 2026-08-22

> v1.4.5：提升状态文字在浅色和深色主题中的可读性，并统一原生悬浮提示文案。

### Changed

- 高峰价改用主文字，避免琥珀色小字号难以阅读
- 正常订阅额度改用中性文字；低额度保留琥珀色、`⚠` 与明确文案
- 估算余额改用中性说明色；错误、警告和余额/花费提示统一为简短原生悬浮文案

## [1.4.4] - 2026-08-22

> v1.4.4：统一信息栏颜色语义，避免把普通提醒显示为错误。

### Changed

- 集中管理主文字、分隔线、价格、警告、错误和信息提醒的主题变量
- 新版本提醒改用信息语义色，移除易被误解为链接的下划线和错误红

## [1.4.3] - 2026-08-22

> v1.4.3：在服务商与模型的悬停说明中显示已安装的插件版本。

### Added

- 余额制和订阅制下，悬停服务商/模型名称均可查看“插件版本：x.y.z”
- 版本号直接复用启动时已读取的本地 `package.json` 信息，不增加网络请求或占用信息栏空间

## [1.4.2] - 2026-08-20

> v1.4.2：优化订阅刷新失败提示和新版本提醒悬停说明。

### Fixed

- 订阅额度刷新失败时只显示 `⚠ 刷新失败`，不再在标签中显示“显示上次快照”
- 鼠标悬停失败标签时显示具体原因和解决方式
- 新版本提醒悬停提示动态显示检测到的最新版本号

## [1.4.1] - 2026-08-20

> v1.4.1：明确版本提醒标签与信息栏其他文字保持完全相同的点击行为。

### Fixed

- 版本提醒标签不增加独立交互，点击时与其他信息栏文字一样切换完整 / 简洁模式

## [1.4.0] - 2026-08-20

> v1.4.0：启动时检查 NPM 新版本，并在信息栏显示极简红色版本提醒。

### Added

- 每次 DSH 完全启动时检查一次 NPM 最新稳定版本
- 有新版本时在底部信息栏显示红色 `↑ vX.Y.Z` 标签
- 网络失败时静默处理，不影响信息栏和花费统计
- 安装文档增加 Agent 辅助更新指引

### Security

- 版本检查只访问固定的 NPM 官方 registry 地址
- 不自动下载、执行或替换插件代码

## [1.3.1] - 2026-08-20

> v1.3.1 定稿：修复代码审计发现的稳定性问题，保持底部信息栏的原生简洁体验。

### Fixed

- **局部刷新容错**：单个数据请求失败时不再让整条信息栏变成「加载失败」；成功数据继续显示，失败项目保留上次快照并自动重试
- **请求超时保护**：数据请求 20 秒无响应自动结束，避免界面永久停留在加载状态；组件卸载时会取消未完成请求
- **异常记账数值清洗**：过滤 NaN、Infinity、负数和损坏记录，避免出现 `¥NaN` 或污染累计花费
- **余额刷新稳定性**：凭据读取失败或暂时未配置时保留最后一次有效快照，并防止慢请求覆盖新数据
- **错误传播修复**：上游对话请求失败继续正确向上传递，不再被插件吞掉
- **跨服务商显示修复**：切换到 OpenAI 等模型时，余额、币种和花费统计跟随当前服务商，不再混用 DeepSeek 数据

### Tests

- 新增客户端容错、异常记账、余额竞态和跨服务商统计回归测试；全量测试 10 组通过

## [1.3.0] - 2026-08-19

> v1.3.0 定稿：**移除 v1.2.0 新增的「信息概览」页面，回归原生简洁**。信息栏保持"单行、原生一致、不喧宾夺主"的核心理念——设置页与对话页顶部标签栏不再有「信息概览」入口，相关数据接口与页面代码一并移除；信息栏本体行为不变。

### Removed

- **「信息概览」页面整体移除**：设置页左侧导航与对话页顶部标签栏的「信息概览」双入口删除，页面（花费总览卡 / 趋势图 / 模型统计 / 使用记录明细）不再存在
- **相关数据接口移除**：`getUsageRecords`、`getModelStats` 两个只读 RPC 删除；`getUsageSummary` 恢复为信息栏原始返回结构（不再含 currency 字段）
- **相关代码与测试清理**：信息概览页面组件、样式、双入口注册、专项测试（test-info-overview）与对应文档全部移除

### Fixed

- 无（信息栏本体行为与 v1.2.x 完全一致，回归 v1.1.x 简洁形态）

## [1.2.3] - 2026-08-18

> v1.2.3 定稿：**移除花费趋势切换按钮旁的「合计」金额文字**（用户反馈多余），保持工具栏简洁；图表无障碍描述（读屏 aria-label）保留、不占可见版面。

### Changed

- **移除趋势区「合计 ¥xx.xx」文字**：近7天 / 近30天 切换按钮旁不再显示区间合计金额，工具栏恢复简洁
- **无障碍保留**：图表容器的读屏描述（aria-label）仍保留，仅服务于屏幕阅读器，不影响可见界面

## [1.2.2] - 2026-08-18

> v1.2.2 定稿：**按 Apple HIG（人机界面指南）彻底重做「信息概览」页面的主题适配与视觉规范**。v1.2.1 的选中态修复不彻底——该主题的 `brand-primary` 与其"反色"变量在**同一主题下指向同一色值**（浅色主题都近黑、深色主题都近白），品牌色底配品牌反色字在两种主题下依然是同色底同色字；本次改用系统**交互语义色** `interactive-bg-active`，彻底解决。

### Changed

- **选中态切换按钮（HIG 分段控件）**：近7天 / 近30天 改为分段控件形态（圆角容器 + 段间分隔线）；选中段用系统交互激活色（浅色主题浅灰蓝底 / 深色主题浅灰底）+ 主文字色 + 加粗——**任何主题下都有清晰对比**，不再依赖品牌色
- **按钮触控尺寸（HIG 无障碍）**：按钮最小高度 28px，符合 macOS 最小控制尺寸规范
- **图表描述（HIG 图表规范）**：花费趋势图前显示所选区间「合计金额」，图表容器带 aria-label（如"近7天每日花费柱状图，合计 ¥12.34"），键盘/读屏可理解
- **列表可读性（HIG 列表规范）**：模型用量与使用记录列表采用交替行底色，跨行扫读更清晰
- **空态引导（HIG 写作规范）**：无记录时给出下一步说明（"开始对话后，每一笔 AI 调用的费用与 token 都会自动记录在这里"）

### Fixed

- **选中态白底白字彻底修复**：v1.2.1 用品牌反色变量，但该主题下品牌色与其反色同值；现改用系统交互语义色 + 主文字色，浅色 / 深色主题均清晰可读

## [1.2.1] - 2026-08-18

> v1.2.1 定稿：**修复「信息概览」页面深色主题下的显示问题**（选中态按钮白底白字不可见），并补齐按钮交互反馈与无障碍焦点态。
> 注：本版修复不彻底（品牌色与其反色变量同主题同值），已由 v1.2.2 彻底修复。

### Fixed

- **深色主题选中态按钮白底白字**：花费趋势「近7天 / 近30天」切换按钮选中态改用「品牌反色文字」（深色主题下品牌色为近白，原文字固定白色导致白底白字不可见）
- **按钮交互反馈**：切换 / 重试 / 加载更多按钮补充 hover 背景反馈与键盘焦点外圈（无障碍）

## [1.2.0] - 2026-08-18

> v1.2.0 定稿：**新增「信息概览」页面**——完整的使用追踪（费用 / 模型 / token / 明细），从**设置页**与**对话页顶部标签栏**两个入口进入同一个页面。信息栏本体行为不变。

### Added

- **「信息概览」页面（双入口）**：在**设置页左侧导航**与**对话页顶部标签栏**各注册一个「信息概览」入口，进入同一个页面，展示同一份数据；入口注册失败自动隔离，不影响信息栏本体
- **花费总览卡**：今日 / 本月 / 近30天 / 累计 四个金额卡片（北京时间、活动币种、千分位 + 2 位小数、小额「＜¥0.01」防误导），口径与信息栏完全一致
- **花费趋势图**：近 7 天 / 30 天每日花费柱状图（纯 CSS、自适应深浅主题、可切换、每柱悬停查看金额）
- **各模型用量统计**：按模型聚合调用次数 / token / 费用，按费用降序排列，占比条形展示；未知模型自动兜底不报错
- **使用记录明细**：每一笔调用的完整记录（时间 / 模型 / 服务商 / 输入·缓存·输出 token / 该笔费用），最新在前，「加载更多」每批 20 条直至全部；空记录显示空态
- **页面自动刷新**：每 30 秒自动刷新总览 / 趋势 / 模型统计，明细列表仅在用户操作时加载（不打扰滚动）；加载失败显示错误与「重试」，可恢复
- **新增只读 RPC**：`getUsageRecords`（记录明细分页）、`getModelStats`（模型聚合统计）；`getUsageSummary` 补充 `currency` 字段——全部纯内存只读、零写盘

### Security

- **响应最小化**：新 RPC 响应仅含展示所需字段（时间 / 模型 / 服务商 / token / 费用），**不返回 sessionId 与会话目的**，会话 ID 仅作宿主内部聚合键
- **零密钥 / 零新增依赖**：页面与接口不新增任何密钥处理与第三方依赖；全部走既有本地同源 RPC 通道

### Fixed

- 无（信息栏既有行为未改动）

## [1.1.0] - 2026-08-16

> v1.1.0 定稿：**纯显示插件**——双模式（余额制 / 订阅制）显示与订阅额度读取。ChatGPT 订阅的**模型接入**（绑定 / OAuth / 令牌续期 / 模型路由注册 / 凭据注入）已剥离，由独立插件 **dsh-chatgpt-subscription** 提供；本插件不再包含任何绑定 / 令牌管理代码。
> 已知限制：`chatgpt.com` 后端为非公开接口，可能变更或失效（失效时自动降级、不崩溃）；可用模型以订阅计划为准。

### Added

- **双模式信息栏（余额制 / 订阅制）**：按当前激活模型的 provider 自动检测——`codex` / `chatgpt` / `opencode-go` / `opencode` / `openai-codex` 走订阅制，其余走余额制；两种模式互斥替换、绝不叠加；内部 `billingMode: 'auto' | 'balance' | 'subscription'` 开关（默认 `auto`）可强制覆盖
- **订阅制额度显示（row2 只三类信息）**：**订阅服务 + 模型**（如 `OpenCode Go · V4 Flash`；"服务商"指订阅服务本身，不是模型厂商）| **`5h xx% · 周 xx% · 月 xx%`**（三窗口全显示，数值加粗，显示剩余百分比 = 100 − 已用）| **距重置倒计时**（最紧窗口，天级格式如 `1d 21h`）；余额 / 时段 / 本对话花费 / token 用量等余额制信息一律不显示；hover 浮窗展示订阅源、套餐名与每窗口的已用百分比 / 重置时刻 / 重置剩余
- **窗口缺失自适应**：某窗口不存在（如 Codex 无 5 小时窗口）自动跳过，不占位、不报错；compact 密度下订阅制精简为最紧窗口
- **额度预警**：任一窗口已用 ≥90%（剩余 ≤10%）红色 ⚠ 提示，title 说明哪个窗口告急
- **订阅数据源适配器（只读额度）**：Codex（`chatgpt.com/backend-api/wham/usage`，**只读** `~/.codex/auth.json` 的 access_token 查询额度；令牌缺失显示「未绑定」引导、令牌失效（HTTP 401）显示「重新绑定」引导，**不自行续期 / 不写回**）与 OpenCode Go（`opencode.ai/zen/go/v1/usage`，DSH credentials `OPENCODE_GO_API_KEY` → opencode auth.json 两级解析，未配置显示引导不报错）
- **快照机制复用余额模式**：60 秒周期刷新、失败保留上次快照、seq 防旧请求覆盖新数据；新增 `getBillingMode` / `getSubscriptionSnapshot` 两个 RPC，`getConfig` 新增 `billingMode` 字段
- **模型名 / 服务商名与模型切换器完全一致（M5）**：注入 `llm` 服务读取 DSH LLM 目录（`llm.listModels` / `llm.listProviders`），信息栏模型名显示目录 `name`（如 `DeepSeek-V4-Flash`），替代自建美化格式；`llm/adapters-updated` 事件自动重建缓存，模型改名即时反映；llm 缺失 / 未知模型回退原始 model id、服务商回退静态映射，绝不崩溃；服务商名已是模型名前缀时只显示模型名（切换器样式，避免 `DeepSeek · DeepSeek-V4-Flash` 重复）
- **模型切换秒级同步**：客户端每 2 秒轮询 host 纯本地的 `getBillingMode`（零网络开销），检测到模型 / 服务商切换立即完整刷新信息栏，不再等最长 30 秒；订阅额度接口仍保持惰性门控 + 60s 周期，不被高频轮询触发
- **原生统计行单行显示**：隐藏「首 token 平均 / tok/s」两个低优先级速度字段，原生统计行在标准对话宽度（748px）下单行放得下；hover 信息浮窗仍可查看完整原生统计（含被隐藏字段）

### Changed

- **ChatGPT 订阅模型接入剥离（移除 v1.2.0 绑定代码）**：dsh-bottom-info-bar 回归纯显示——OAuth 绑定 / 设置页「ChatGPT 订阅」/ 令牌续期与写回 / `openai-codex` 模型路由注册 / 凭据注入 / 绑定标记 全部移除，由独立插件 **dsh-chatgpt-subscription** 提供（该插件负责绑定并把令牌写入 `~/.codex/auth.json`，本插件只读令牌显示额度）；v1.2.0 遗留的 `uninstall.sh --purge-codex` 清理工具已一并移除（其清理对象已不存在，且为避免误触新插件的活体配置）
- **提供商显示名 Codex → ChatGPT**：Codex 与 ChatGPT 已合并，信息栏订阅服务名统一显示 ChatGPT（`codex` 保持 Codex）
- **额度显示改为剩余百分比**：订阅窗口显示 **剩余 = 100 − 已用**（如 `5h 91% · 周 56% · 月 60%`，紧凑标签 + 数值加粗）；hover 浮窗明确写「剩余 xx%（已用 xx%）· 重置 …· 距重置 …」；预警触发条件不变（已用 ≥90% = 剩余 ≤10%），告急文案同步改为「剩余 ≤10%」

### Security

- **订阅 token 零落盘**：Codex / OpenCode Go 的 token 只在本机内存中用于请求头，绝不写入任何文件、不打印、不进 git 历史、不进文档；错误信息不含 token 片段；本插件对令牌**只读**，无写回 / 续期 / 注入路径
- **订阅额度接口同源防护**：`getSubscriptionSnapshot` 列入 MUTATING（跨源请求拒绝），防跨站触发订阅查询

### Fixed

- **本对话金额归属**：新开对话不再显示上一个会话的花费（客户端多路获取当前会话 ID；宿主对空 / 未命中会话返回 ¥0.000 而非回退最近会话；会话 ID 前缀差异归一化）
- **回复完成即时更新金额**：会话统计变化时自动刷新，不再等最长 30 秒的轮询间隔
- **订阅额度刷新失败退避**：wham/usage 偶发失败后记录失败时刻，60s 退避期内（RPC 与周期刷新均）不重试——减少对未公开接口的请求，「刷新失败，显示上次快照」提示不再随每次轮询反复闪烁
- **测试隔离**：新增环境变量 `DSH_BOTTOM_INFO_BAR_CODEX_AUTH` / `DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH` 覆盖订阅源凭证文件路径，测试不读取真实登录态、不发真实网络请求

## [1.0.0] - 2026-08-15

首个可分发版本。以静态插件包（bundle）形式安装，安装一次后每次打开 DeepSeek Harness 自动生效，无需手动重新加载。

### Added

- **一体替换原生统计栏**：原生统计（轮·步 / LLM 耗时 / 工具调用 / 首 token 平均 / tok/s / 缓存命中 / 输入输出 tokens）与本插件信息合并为一条，格式与原生一致
- **服务商 + 具体模型自动识别**：DeepSeek V4 Flash、Kimi K3、GLM 4.6 等自动美化显示，服务商名加粗
- **真实余额**：DeepSeek 余额 API 直连，60 秒自动刷新，失败保留上次快照
- **高峰价 / 空闲价**：分别以琥珀色 / 绿色加粗显示，附下次切换倒计时；无峰谷价的服务商自动隐藏
- **真实花费**：逐请求记账，本对话 / 今天 / 近一月 / 全部 精确聚合，hover 查看明细；**记账数据落盘持久化，重启不丢失**
- **数字加粗**：余额、倒计时、花费与统计数字统一加粗
- **完整 / 简洁**：单击整条信息栏切换
- **余额预警**：低于 ¥20 显示 ⚠

### Fixed

- **本对话花费始终显示**：新对话 / 对话刚开始（尚无记账）时不再隐藏，显示 `本对话 ¥0.000`；hover 仍可查看持久化的 今天 / 近一月 / 全部
- **原生统计行**：完整模式下对话刚开始即显示 `0 轮 · 0 步`，不再等第一步完成才出现

[1.0.0]: https://github.com/songoao25/dsh-bottom-info-bar/releases/tag/v1.0.0
