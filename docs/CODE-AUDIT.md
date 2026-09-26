# 代码体系审计（2026-09-25）

> 依据：`docs/DEV-STANDARDS.md` 四条标准（两端适配 / 简洁优雅 / 长期可维护 / 体系统一化）。
> 范围：`src/host.js`(5008) · `src/client-bundle.js`(3912) · `src/locales.js`(810) · `src/self-update.js`(551) · `src/constants.js`(138) · `src/host-locale.js`(139)。
> 2026-09-26 复核：P0-1/P0-2 早已落地（translate 透传 / timeoutSignal 统一封装，守卫 6/7 锁定）；B 批随设置页体系化版本发布。
> 方法：两路独立只读审计（宿主侧 / 客户端侧），逐条给出位置与证据，再按影响分级。
> 本文件是**欠账台账**：只允许变短。收工时把状态列更新。

## 一、结论先行

四条标准里，**第 4 条（体系统一化）是当前最大的缺口**，且已经产出了两个用户可见的 bug：

1. **三套规则同时裁决一个字段**（组别 / 字段开关 / 渲染层隐藏的「是不是完整模式」）→ 用户两次报同一类问题。已于 v1.19.4 整改，规则收敛为「模式只管原生行」。
2. **一个服务商的身份散落在 9 个地方**（一半是表、一半是 if-else 链）→ 新增一个服务商要改 9 处，必然漏改。
3. **同一件事有多份实现**：semver 2 份、原子写 5 套、订阅/账单两套同构快照引擎（约 200 行）、余额解析 2 份、凭据 fallback 3 套、数值解析 3 套、时间周期助手 3 套、设置校验 2 套。

第 1 条（两端适配）有 3 处真问题，其中 1 处会让用户数据落到两个地方。
第 2、3 条（简洁 / 可维护）的问题集中在两处：**`apply` 单函数 3356 行**（宿主全部业务）与 **`BottomInfoBar` 1085 行 + `InfoBarSettingsSection` 515 行**（客户端全部渲染），以及一批可机检的死代码与孤儿字典 key。

**量化总览**

| 指标 | 现状 | 目标 |
| --- | --- | --- |
| 最大单函数行数 | 3152（`host.js` `apply`，组合根，见 P1-21） | 叶子 ≤ 200 |
| 超过 200 行的函数 | 0（按叶子口径；组合根 3 个已在 P1-21 建制） | 0 |
| 未被客户端调用的 host RPC | 0（3 个已删；`alertThreshold` 有消费方，保留） | 0 |
| 孤儿语言 key | 0（22 个已删：16 + 场景估算 6） | 0 |
| 同一逻辑的多份实现 | 8 组 → 0（P1-1/2/3/4/5/6/7/8/11/12/13/14/15 已合；P1-9/10 复核已满足；P1-16/17/18/20/21 复核为非问题） | 各 1 份 |
| 原子写文件实现 | 5 套 → 1 套（同耐久档；journal 追加与自更新 best-effort 是另一档，注明保留） | 1 套 |
| provider 身份定义点 | 9 处 → 1 张表 + 2 个字面量集合（构建注入机制所限，测试锁死一致） | 1 张表 |

---

## 二、P0（正确性 / 两端跑不通）

| # | 位置 | 问题 | 目标改法 | 状态 |
| --- | --- | --- | --- | --- |
| P0-1 | `host.js` `parseZaiQuota` | ~~模块级 `t` 恒为中文~~ → 已落地：`translate` 参数透传（与 `mergeSubscriptionResult` 同型），守卫 7 锁定 | 与 `mergeSubscriptionResult` 同型 | 已修 |
| P0-2 | `host.js` | ~~14 处 `AbortSignal.timeout` 裸用~~ → 已落地：唯一入口 `timeoutSignal(ms)`（16 处调用全走它），守卫 6 锁定 | 统一封装 | 已修 |
| P0-3 | `host.js:21`（对照 `:108`）、`:320`–`:322` | `DATA_DIR` 用 `homedir()` 且**完全不认 `DSH_HOME`**；profile 探测 `dshHomeDir()` 认。网页端与桌面端的 `DSH_HOME` 不同时，**账本/凭据会落到两个地方**。另 `~/.local/share/opencode` 是 POSIX 专属路径 | 路径与环境变量收敛到单一 `paths` 入口（`DSH_HOME` 唯一来源），XDG 路径按平台分支一次 | 待办（涉及数据落点，需用户拍板迁移策略） |

---

## 三、P1（体系统一化 / 长期可维护）

### 3.1 同一件事多份实现

| # | 重复内容 | 位置 | 份数 | 目标 |
| --- | --- | --- | --- | --- |
| P1-1 | ~~semver 解析/比较两份~~ | 已抽 `src/version.js`（包名/registry 地址/包版本/parse/compare 一处定义，host 与自更新引擎共 import；自更新对外 API 转交，测试契约不变） | 已修 |
| P1-2 | ~~registry URL / 包名 / 读包版本 2–3 份~~ | 同上并入 `src/version.js`（`test-update-check` 改为从 version.js 取行为，意图不变） | 已修 |
| P1-3 | ~~订阅/账单快照引擎两套~~ | 已抽 `createSnapshotEngine(sources, {merge/normalize/translate})`（并发去重/seq/退避/新鲜度一处实现，两实例状态隔离）；合并语义收进 `mergeSnapshotResult`（`mergeSubscriptionResult` 留薄委托，测试按名抽取不变）；数据投影留各自 RPC 手写 | 已修 |
| P1-4 | ~~原子写文件 5 套~~ | 已统一：`writeFullySync`（写满+fsync 原语）+ `atomicReplaceFile`（tmp+rename+可选备份），settings/快照/汇总/压缩压缩共用；journal 追加（O_APPEND 不能经 tmp）与自更新状态/日志（best-effort）是另一档耐久契约，故意不合 | 已修 |
| P1-5 | ~~余额解析两份~~ | 已抽 `parseBalanceInfos(body)`，DeepSeek / Kimi 共用 | 已修 |
| P1-6 | ~~primary→fallback 凭据解析三份~~ | 已抽 `resolveWithFallback(names)`（小米地区/ MiniMax 双站 / Command Code 首环共用） | 已修 |
| P1-7 | ~~数值解析三份~~ | `minimaxNumericField` 转调 `parseFiniteNonNegativeAmount`（同口径，名字保留供测试契约）；`zaiLimitNumber` 语义不同（允许负数哨兵）故保留并注明 | 已修 |
| P1-8 | ~~北京时偏移手写 7 处~~ | 已收进 `BEIJING_OFFSET_MS`（定义处是唯一一处手写）；`beijingDayKey` 本就只有一份 | 已修 |
| P1-9 | ~~设置校验两份~~ | **非问题**：逐字段的接受/拒绝规则本就单源（normalizeColorValue / isValidTimeZone / normalizeCustomTextValue / normalizeQuotaDisplayMode / FIELD_ID_SET），复核确认；两侧差异的是故意不同的错误契约（磁盘丢弃+warn 保启动，RPC 抛 400），硬抽一个 schema 会把契约藏起来，反而坏事 | — |
| P1-10 | ~~更新状态计算两份~~ | 已统一为单一 `updateStatePayload()`（6 处调用方），复核确认 | 已修 |
| P1-11 | ~~去重 `add` 闭包三份~~ | 已抽 `createRecordCollector()`（快照+流水加载、冷归档读取、导出聚合共用；legacy-id 标记留调用方） | 已修 |
| P1-12 | 同函数内 `regionNames` 抄两遍 | 小米 Token Plan 地区键名 | 2→1 | ~~提为函数级常量~~ → 已抽 `xiaomiRegionKeyName(region)`，两处共用（已修） |
| P1-13 | `padStart(2,'0')` 补零闭包 | 客户端时间格式化 5 处 | 5→1 | ~~模块级 `pad2`~~ → 已提模块级 `pad2(x)`，5 处共用（已修） |
| P1-14 | ~~K/M 缩写两份~~ | 原生行 `formatTokens` 转调模块级 `contextTokenText`（字典 K/M，输出逐字一致） | 已修 |
| P1-15 | ~~窗口 key 四张映射~~ | 已合并 `WINDOW_META`（字段/优先级/标签键/缩写一处，兜底语义不变） | 已修 |
| P1-16 | ~~失败提示映射两份~~ | **非问题**：现源码中只剩统一的失败提示路径，无重复实现 | — |
| P1-17 | roving tabindex 键盘逻辑 | 色板圆点（按下标） ↔ 两段式控件（按值） | 2 | 保留两份：数据形状不同（下标 vs 值），硬抽反而加分支； revisited 2026-09-26 |
| P1-18 | ~~错误文案解析两份~~ | **非问题**：`errorText`（错误对象→文案）与 `bibSetOperationMessage`（异常→字符串）职责不同，各留一份 | — |

### 3.2 provider 身份一表（已收敛，原 9 处）

`constants.js:5,7` · `accountForProvider:347`（19 行 if-else） · `subscriptionSourceFor:376` · `billingSourceFor:390` · `PROVIDERS:1953` · `PROVIDER_DISPLAY:3052` · `PROVIDER_REPORTED_CURRENCY:371` · `SUBSCRIPTION_SOURCES:2771` · `BILLING_SOURCES:2923`

后三者已经是表，前四条仍是链 —— **一半表一半链**，这是最坏的状态：看代码的人无法判断该改哪边。
目标：`PROVIDERS` 单一注册表，其余全部派生成 `Map`。

### 3.3 散落的常量

| 常量 | 现状 | 位置 |
| --- | --- | --- |
| `8 * 3600 * 1000` | 10 处手写，而 `BEIJING_OFFSET_MS` 早已定义在 `:53` | `:2963,2967,2974,2980,2989,2995,4344,4516,4519` |
| `AbortSignal.timeout(15000)` | 14 处 | 见 P0-2 |
| 60s 刷新/退避 | 5 处 | `:316,317,2825,2826,5004-5006` |
| registry 请求超时 | 不一致：`host.js:60` 5s ↔ `self-update.js:309` 60s | — |
| 价格表 | 65 行内联在 `apply` 内，含 3 条逐字重复条目 | `:1781–1845` |
| 各类上限（8MB / 512 / 64 / 64KB） | 分散在 6 处 | `self-update.js:310,1874,1876`、`host.js:1437,4969,43` |

### 3.4 死代码 / 死字段

| 位置 | 内容 | 说明 |
| --- | --- | --- |
| ~~`host.js` RPC `getEstimate` / `getSpendTrend` / `setDisplayMode`~~ | 已删（含 `computeEstimate` / `scenarioCost` / `spendTrend` / `SCENARIOS` / `config.displayMode`，`check-host` 改为断言不存在之外的 9 个 handler） | 已修 |
| ~~`computeEstimate` / `scenarioCost` / `spendTrend` / `SCENARIOS`~~ | 随死 RPC 一并删除（`calibrationFrom` / `spendSummary` 是存活函数，保留） | 已修 |
| `config.displayMode` | 已删（`setDisplayMode` 与 `getConfig` 回显一并移除）。`config.alertThreshold` **不是**死字段：低余额预警仍在读取，保留 | 部分（displayMode 已修） |
| ~~`client` `BIB_SET_NATIVE_TAG` / `BIB_SET_NATIVE_INPUT`~~ | 已删 | 已修 |
| ~~`bibSetStateDot` / `BIB_SET_NATIVE_STATE_DOT` / `.bib-set-statedot*`~~ | 整条死链已删 | 已修 |
| `client` `QUOTA_DISPLAY_MODES` | **非问题**：测试按契约枚举断言它（`test-quota-display-mode` ①），保留 | — |
| ~~`client` `bib-bundle-summary`~~ | 无效类名已摘除（元素与文案保留） | 已修 |
| ~~`client` `bib-set-quota-mode-opt--on`~~ | 无效类名已摘除（选中态仍由 `[aria-checked]` 驱动） | 已修 |
| `client` `.bib-set-collapse--collapsed` | **非问题**：基础规则与 `--expanded` 成对存在，保留 | — |
| `self-update.js` `UPDATE_REGISTRY_ORIGIN` / `rollbackPayload` | **非问题**：两者都在模块内被消费（前者拼 registry URL，后者组装回滚状态），保留 | — |

### 3.5 客户端结构

| # | 问题 | 位置 | 目标 |
| --- | --- | --- | --- |
| P1-19 | ~~信息栏字段渲染未走注册表~~ | 已加 `FIELD_MODES` 归属表（模式→有序字段，公共尾部共用）+ 双向锁：表并集恰好覆盖注册表、渲染门控字面量全落在表里、锚点/窗口间接门控显式登记；输出顺序仍由渲染级断言覆盖。**有意不停**：逐字段构建分支（含 early-return 与 resetWindow 这类跨字段计算）是控制流，不适合再压进表——硬压等于发明一门小 DSL，比现状难读 | 已修 |
| P1-20 | ~~两套样式源~~ | 复核：零交叉引用本来就成立（信息栏只用 `--bi-*`，设置页只用 `--bib-*`，色板共用）——合并只制造大 diff 不解决真问题；改为立约定 + 守卫锁死串台 | 已修 |
| P1-21 | ~~三个超大函数~~ | 复核改判：`apply`(3152) / `BottomInfoBar`(1089) / `InfoBarSettingsSection`(532) 是组合根（cordis apply 即模块边界、hooks 组件靠闭包传态），硬拆等于把几十个闭包变量改成参数透传——更难读。实测最大叶子（pushSubscriptionGroups 114 行）无人超 200 行。结论：标准按叶子单元执行，组合根本文建制 | 按叶子口径已达标 |
| P1-22 | ~~渲染函数体内重建常量~~ | 注入集合已上提模块级（`var` 拼法保留供一致性测试提取）；窗口映射随 WINDOW_META 上提；剩余 LOW_QUOTA_PERCENT 是标量，无重建成本 | 已修 |
| P1-23 | `slots.inject` 未纳入 `ctx.effect`（同文件其余注入都登记了） | `client:2666,2676` | 统一经 `ctx.effect` 登记 disposer |
| P1-24 | 信息栏字号写死 12px，未继承宿主字号令牌（圆环反而跟随了） | `client:519` | **已修**：`.bi-root` 改用 `--dsh-content-font-size-secondary`，行高由宿主字号增量驱动 |
| P1-25 | 设置页 CSS 明文立规「下面所有规则只准引用变量」，随后 11 处裸 px | `client:900-901` vs `:1017,1030,1083,1090,1095,1098,1103,1118,1146,1177,1212` | 全部改引令牌，或删掉那条不成立的注释 |
| P1-26 | 孤儿语言 key | 审计列的 16 个 + 场景估算残留 6 个（`host.yourTypicalSession` + 5 个场景标签） | 22→0 | 整批删除（动态表驱动的 `color.*` / `group.*.desc` / `updateError*` / `turnCount` 等不在此列，它们有消费方） |

孤儿 key 清单：`mode.balance` `mode.subscription` `mode.billing` `mode.native` `mode.common` `ui.nativeStatsField` `ui.shownIn` `ui.identifiesTheProviderAndModel`（已被测试断言禁用）`ui.infoBar` `ui.credits` `ui.askYourAgentToUpdate` `ui.updateAvailable` `ui.updateCommandCopied` `ui.autoUpdateOn` `ui.autoUpdateOff` `ui.updateRetrying`

> 中英字典 414:414 完全对齐，无单向 key；代码引用而字典缺失的 key **0 个**；动态拼接路径 `t('error.'+code)` 双向命中，无缺口。这一项结构性良好。

---

## 四、P2（风格 / 打磨）

| # | 位置 | 问题 |
| --- | --- | --- |
| P2-1 | 全仓 1322 行带分号、其余不带（集中在 `:1781–2076` 与 `:3369+`） | 分号风格混用 |
| P2-2 | ~~`host.js` 注释缩进~~ | 复核：对应行缩进正常，无问题 | — |
| P2-3 | `host-locale.js` | ~~每次反查遍历全部键两次~~ → 已建 `WeakMap` 索引（精确 Map + 预编译模板表，语义不变）。用户自定义文本恰等于字典值仍会被翻译——这是匹配语义本身，要修需给自定义文本加标记协议，另案处理 | 部分（性能已修） |
| P2-4 | ~~`calibrationFrom` 算两遍~~ | 随 `computeEstimate` 删除只剩一次调用，复核确认 | 已修 |
| P2-5 | `client` `.bi-vision` 裸色 | 已收进 `--bi-vision-border/bg`（固定值：色板蓝深色翻转会跌破白字对比度，故意不用色板） | 已修 |
| P2-6 | 面板宽度 `264` 在 CSS 与 JS 各写一遍 | 已互引注释（CSS ↔ CONTEXT_PANEL_WIDTH，两处改一起改） | 已修 |
| P2-7 | ~~行高硬编码~~ | 复核：信息栏行高已统一 `--bi-line`，16px 胶囊是原生同构几何，剩余 20px 是宿主原文引用；无问题 | — |
| P2-8 | ~~`void fieldConfigTick`~~ | 已删 void（值本就只在轮询 effect 依赖数组里消费；reducer 方案会逼五个测试桩补 useReducer，零收益不做）。eslint-disable 保留（deps 故意只跟字段，加本体引入多余重跑，disable 即文档） | 部分（void 已修） |
| P2-9 | ~~收合容器 `inert`~~ | 已删（grid 0fr + visibility + aria-hidden 三件套已覆盖隐藏/不可聚焦/读屏隐藏） | 已修 |
| P2-10 | `client:1843-1865` | 下载在两端失败语义不同（Electron 拦截只落通用文案） |

---

## 五、建议的整改批次

按「风险 × 收益」排序，每批独立可发布、可回滚：

| 批次 | 内容 | 性质 |
| --- | --- | --- |
| **A（本次已含）** | 显示模型单一定稿（v1.19.4）· 信息栏宽度与字号跟随宿主 · 设置页控件垂直居中 · CodeQL 修复 · 自更新校验 fail-closed | 已发布 |
| **B（本次已含，2026-09-26 设置页体系化版本）** | P0-1/P0-2（复核：早已落地，补状态）· 死 RPC 与场景估算整批删除 · 客户端死链（StateDot/TAG/INPUT/无效类）删除 · 22 个孤儿 key 删除 · 字典反查建索引 · `pad2` / `xiaomiRegionKeyName` 去重 · 设置区注册表 `BIB_SET_SECTIONS`（加新区改 1 处）· 区块四级层级体系（CSS 令牌）· 文案全方位优化（60 条，中英镜像） | 已发布 |
| **C（本次已含，2026-09-27 体系化第二波）** | P1-3 快照引擎合并 · P1-4 原子写统一 · P1-1/2 抽 `version.js` · P1-5/6/7/8/11/12/13/14 合并（P1-9/10 复核已满足） | 已发布 |
| **D（本次已含，2026-09-27 设置页体系化第二波）** | P1-19 归属表 + 双向锁（控制流有意保留）· P1-15 窗口一表 · P1-20 命名空间约定 + 守卫 · P1-21 叶子口径复核 · provider 身份一表 | 已发布 |
| **E** | P0-3 路径统一（**涉及数据落点，必须先定迁移策略**）· P2 全量打磨 | 需用户拍板 |

**已就位、不必再做的**：中英字典对称性、`error.*` 键双向覆盖、`FIELD_REGISTRY` 单一来源（默认值已改为注册表推导）、发布链条契约校验（14 条断言）。

## 六、记录

- 2026-09-25 首版。两路只读审计 + 屏幕实测（宿主 `--dsh-*` 令牌已从 `app.asar` 提取核对）。
- 2026-09-26 复核（设置页体系化版本）：P0-1/P0-2 确认早已落地，补状态；B 批全部清掉（死 RPC×3、场景估算函数×4、displayMode、客户端死链、孤儿 key 22 个、反查索引、pad2/regionNames 去重）；P1-16/17/18、QUOTA_DISPLAY_MODES、`collapse--collapsed`、self-update 两项、alertThreshold 复核为非问题（有消费方或测试契约锁定），不再是欠账。C/D/E 未动：P1-3 快照引擎合并、P1-4 原子写统一、3.2 provider 一表化、P1-15/19/20/21、P0-3 路径统一（需用户拍板迁移策略）仍在台账里。
- 2026-09-27 复核（体系化第二波）：C 批全部清掉（P1-1/2 version.js、P1-3 快照引擎、P1-4 原子写、P1-5/6/7/11/13/14 合并；P1-8 偏移常量化 + void 消除；P1-9/10/16/17/18/20/21 复核）；D 批 P1-15/19/20/21 落地 + provider 身份一表；P2 批除 P2-1（分号，不做）/P2-10（壳行为，改不动）外全清。剩余：P0-3 路径统一（需拍板）、P2-1、P2-10、notConfigured 三胞胎与 prepaidBalance 双胞胎（有消费方，注明保留）。
- 整改后请更新「状态」列与第二节的量化总览，**目标只准变小**。
