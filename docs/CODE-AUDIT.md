# 代码体系审计（2026-09-25）

> 依据：`docs/DEV-STANDARDS.md` 四条标准（两端适配 / 简洁优雅 / 长期可维护 / 体系统一化）。
> 范围：`src/host.js`(5013) · `src/client-bundle.js`(3791) · `src/locales.js`(838) · `src/self-update.js`(526) · `src/constants.js`(115) · `src/host-locale.js`(110)。
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
| 最大单函数行数 | 3356（`host.js` `apply`） | ≤ 200 |
| 超过 200 行的函数 | 4 个（3356 / 1205 / 1085 / 515） | 0 |
| 未被客户端调用的 host RPC | 3 个（+ 2 个无消费方的配置字段） | 0 |
| 孤儿语言 key | 16 个 | 0 |
| 同一逻辑的多份实现 | 8 组 | 各 1 份 |
| 原子写文件实现 | 5 套 | 1 套 |
| provider 身份定义点 | 9 处（5 处是链） | 1 张表 |

---

## 二、P0（正确性 / 两端跑不通）

| # | 位置 | 问题 | 目标改法 | 状态 |
| --- | --- | --- | --- | --- |
| P0-1 | `host.js:900`、`:933` | `parseZaiQuota` 是模块级函数，内部直接用模块级 `t`（`:19`，**恒为中文**）。apply 内部另有一个语言感知的 `t`（`:1658`）。结果：**英文宿主下智谱套餐名仍显示中文** | 与 `mergeSubscriptionResult`(`:677`) 同型：把 `translate` 作为参数传入，调用处显式传 apply 的 `t` | 待办 |
| P0-2 | `host.js:2193` 等 **14 处**（`:1763` 是唯一做了守卫的一处） | `AbortSignal.timeout(15000)` 裸用。缺该 API 的运行时（宿主内嵌 / 旧 Electron）会在多个 fetch 直接抛，表现为「余额、订阅、账单同时报错」 | 新增 `timeoutSignal(ms)` 统一封装并全局替换 14 处；守卫写在封装里，只写一次 | 待办 |
| P0-3 | `host.js:21`（对照 `:108`）、`:320`–`:322` | `DATA_DIR` 用 `homedir()` 且**完全不认 `DSH_HOME`**；profile 探测 `dshHomeDir()` 认。网页端与桌面端的 `DSH_HOME` 不同时，**账本/凭据会落到两个地方**。另 `~/.local/share/opencode` 是 POSIX 专属路径 | 路径与环境变量收敛到单一 `paths` 入口（`DSH_HOME` 唯一来源），XDG 路径按平台分支一次 | 待办（涉及数据落点，需用户拍板迁移策略） |

---

## 三、P1（体系统一化 / 长期可维护）

### 3.1 同一件事多份实现

| # | 重复内容 | 位置 | 份数 | 目标 |
| --- | --- | --- | --- | --- |
| P1-1 | semver 解析/比较（含同一条正则） | `host.js:71,89` ↔ `self-update.js:86,91` | 2 | 抽 `version.js`，host 只 import |
| P1-2 | npm registry URL / 包名 / 读 package.json 版本 | `host.js:59,62,241,245` ↔ `self-update.js:26,25,352` | 2–3 | 同上，一处定义 |
| P1-3 | **订阅快照引擎 ↔ 账单快照引擎** | `:677,2787,2814,2881` ↔ `:2833,2844,2870,2930` | 2（约 200 行同构） | 抽 `createSnapshotEngine(sources)` |
| P1-4 | 原子写文件 | `:1569`、`:3912`、`:3700`、`:3959`、`self-update.js:334,255` | **5** | 统一 `atomicWrite(file, data, {rotateTo})` |
| P1-5 | 余额解析（CNY→USD 选择逻辑逐行同构） | `:1958` ↔ `:1999` | 2 | 抽 `parseBalanceInfos(body)` |
| P1-6 | primary→fallback 凭据解析 | `:2381`、`:2441`、`:2561` | 3 | 抽 `resolveWithFallback(names)` |
| P1-7 | 数值解析（行为等价） | `:587`、`:837`、`:869` | 3 | 保留一个 |
| P1-8 | 时间周期 / 日键 / 北京时偏移 | `:941,1168` · `:2994,2680,4344` · `:2962` | 3 组 | 合并 `time.js` |
| P1-9 | 设置校验（磁盘宽松丢弃 ↔ RPC 严格抛错） | `:1498` ↔ `:4735` | 2 | 抽共享 schema，两侧共用 |
| P1-10 | 更新状态计算 | `getUpdateInfo:4552` ↔ `getUpdateState:4577` | 2 | 抽 `updateStatusPayload()` |
| P1-11 | 去重 `add` 闭包 | `:1340` ↔ `:3421` | 2 | 抽 `createRecordCollector()` |
| P1-12 | 同函数内 `regionNames` 抄两遍 | `:2562`、`:2578` | 2 | 提为函数级常量 |
| P1-13 | `padStart(2,'0')` 补零闭包 | `client:3017,3023,3035,3168` | 4 | 模块级 `pad2` |
| P1-14 | K/M 缩写格式化（后者还绕过字典） | `client:668` ↔ `client:2987` | 2 | 删一个 |
| P1-15 | 窗口 key → 字段/标签/优先级映射 | `client:440,3044,3048,3427` | **4** | 合并 `WINDOW_META` |
| P1-16 | 失败提示映射 | `client:3353` ↔ `client:3487` | 2 | 抽 `failureHint()` |
| P1-17 | roving tabindex 键盘逻辑 | `client:1312` ↔ `client:1755` | 2 | 抽 `useRovingFocus()` |
| P1-18 | 错误文案解析 | `client:109` ↔ `client:1905` | 2 | 合并 `errorText()` |

### 3.2 provider 身份散落 9 处（新增一个要改 9 处）

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
| `host.js:4644,4690,4713` | RPC `getEstimate` / `getSpendTrend` / `setDisplayMode` | 客户端从不调用；`tests/check-host.cjs` 只断言「存在」，反而把它们固化成了契约 |
| `host.js:4396,4388,4512,1941` | `computeEstimate` / `scenarioCost` / `spendTrend` / `SCENARIOS` | 随上面三个 RPC 一起不可达 |
| `host.js:2111,2113` | `config.displayMode`、`config.alertThreshold` | 无任何消费方（前者只被 `getConfig` 回显） |
| `client:52,54` | `BIB_SET_NATIVE_TAG` / `BIB_SET_NATIVE_INPUT` | 定义即未用；后者是 `DSH-HOST-COMPATIBILITY.md:39` 规划但从未接线的兜底 |
| `client:1283` + `:53` + CSS `:1098-1101` | `bibSetStateDot` / `BIB_SET_NATIVE_STATE_DOT` / `.bib-set-statedot*` | 整条死链 |
| `client:215` | `QUOTA_DISPLAY_MODES` | 真正用的是 `normalizeQuotaDisplayMode` |
| `client:2578` `bib-bundle-summary` | 有类名，两段 CSS 都没有该选择器 | 无效类 |
| `client:1776` `bib-set-quota-mode-opt--on` | 有类名，无对应规则（选中态由 `[aria-checked]` 驱动） | 无效类 |
| `client:1011/1218` `.bib-set-collapse--collapsed` | 有基础规则缺失（只有 `--expanded`） | 有类无样式 |
| `self-update.js:26,269` | `UPDATE_REGISTRY_ORIGIN` / `rollbackPayload` | 导出但无外部引用 |

### 3.5 客户端结构

| # | 问题 | 位置 | 目标 |
| --- | --- | --- | --- |
| P1-19 | **信息栏字段渲染未走注册表**（设置页走了）。加字段要同时改 `constants.js` + 三处手写渲染 + CSS | `client:3240/3369/3499` 的 `fieldVisible('字面量')` vs `client:1632` 的注册表遍历 | 把「位置 / 门控」也纳入注册表，渲染按表分发 |
| P1-20 | 两段独立 CSS + 两套前缀（`--bi-*` / `--bib-*`），色板却同时挂在两个根 | `client:510-624` ↔ `:894-1219` | 合并为一份样式源，统一下度量层 |
| P1-21 | 三个超大函数：`apply`(1205) / `BottomInfoBar`(1085) / `InfoBarSettingsSection`(515) | `client:2585/2705/2055` | 拆 `useInfoBarData` / `useSettingsSnapshot`，常量上提模块级 |
| P1-22 | 常量在渲染函数体内每次重建（构建期注入、永不变） | `client:2979,2981,3427,3444` | 上提模块级 |
| P1-23 | `slots.inject` 未纳入 `ctx.effect`（同文件其余注入都登记了） | `client:2666,2676` | 统一经 `ctx.effect` 登记 disposer |
| P1-24 | 信息栏字号写死 12px，未继承宿主字号令牌（圆环反而跟随了） | `client:519` | **已修**：`.bi-root` 改用 `--dsh-content-font-size-secondary`，行高由宿主字号增量驱动 |
| P1-25 | 设置页 CSS 明文立规「下面所有规则只准引用变量」，随后 11 处裸 px | `client:900-901` vs `:1017,1030,1083,1090,1095,1098,1103,1118,1146,1177,1212` | 全部改引令牌，或删掉那条不成立的注释 |
| P1-26 | 孤儿语言 key 16 个 | `locales.js`（见下表） | 整批删除 |

孤儿 key 清单：`mode.balance` `mode.subscription` `mode.billing` `mode.native` `mode.common` `ui.nativeStatsField` `ui.shownIn` `ui.identifiesTheProviderAndModel`（已被测试断言禁用）`ui.infoBar` `ui.credits` `ui.askYourAgentToUpdate` `ui.updateAvailable` `ui.updateCommandCopied` `ui.autoUpdateOn` `ui.autoUpdateOff` `ui.updateRetrying`

> 中英字典 414:414 完全对齐，无单向 key；代码引用而字典缺失的 key **0 个**；动态拼接路径 `t('error.'+code)` 双向命中，无缺口。这一项结构性良好。

---

## 四、P2（风格 / 打磨）

| # | 位置 | 问题 |
| --- | --- | --- |
| P2-1 | 全仓 1322 行带分号、其余不带（集中在 `:1781–2076` 与 `:3369+`） | 分号风格混用 |
| P2-2 | `host.js:3295–3297` | 注释缩进错位 |
| P2-3 | `host-locale.js:84` | `localizeHostText` 对每个字符串遍历 414 键两次反查；用户自定义文本若恰等于字典值会被**误翻译** |
| P2-4 | `host.js:4435,4459` | `calibrationFrom` 同一函数内算两遍 |
| P2-5 | `client:577` | `.bi-vision` 用裸色 `#0057ff`（不入色板），而 `#0044cc` 已有 `--bi-palette-blue` |
| P2-6 | `client:602` ↔ `client:644` | 面板宽度 `264` 在 CSS 与 JS 各写一遍 |
| P2-7 | `client:572,573,592` | 行高 20px / 胶囊高 16px 多处硬编码（行高已统一到 `--bi-line`） |
| P2-8 | `client:2749,2916` | `void fieldConfigTick;` 与 eslint-disable 绕过检查，而非消除根因 |
| P2-9 | `client:1624` | React 18 下 `inert` 非受控属性告警且冗余（收合已靠 `visibility`） |
| P2-10 | `client:1843-1865` | 下载在两端失败语义不同（Electron 拦截只落通用文案） |

---

## 五、建议的整改批次

按「风险 × 收益」排序，每批独立可发布、可回滚：

| 批次 | 内容 | 性质 |
| --- | --- | --- |
| **A（本次已含）** | 显示模型单一定稿（v1.19.4）· 信息栏宽度与字号跟随宿主 · 设置页控件垂直居中 · CodeQL 修复 · 自更新校验 fail-closed | 已发布 |
| **B** | P0-1（语言参数）· P0-2（超时统一封装）· 3.4 死代码整批删除 · P1-26 孤儿 key 删除 · P2-3（字典反查建索引） | 纯修复，不改行为 |
| **C** | P1-3 快照引擎合并 · P1-4 原子写统一 · P1-1/2 抽 `version.js` · P1-5～P1-12 宿主侧重复实现合并 | 重构，行为不变（靠现有 43 套件兜底） |
| **D** | P1-19 信息栏渲染改注册表驱动 · P1-15 窗口映射合并 · P1-20 样式源合并 · P1-21 拆三个超大函数 | 结构改造，风险最高，需逐项回归 |
| **E** | P0-3 路径统一（**涉及数据落点，必须先定迁移策略**）· P2 全量打磨 | 需用户拍板 |

**已就位、不必再做的**：中英字典对称性、`error.*` 键双向覆盖、`FIELD_REGISTRY` 单一来源（默认值已改为注册表推导）、发布链条契约校验（14 条断言）。

## 六、记录

- 2026-09-25 首版。两路只读审计 + 屏幕实测（宿主 `--dsh-*` 令牌已从 `app.asar` 提取核对）。
- 整改后请更新「状态」列与第二节的量化总览，**目标只准变小**。
