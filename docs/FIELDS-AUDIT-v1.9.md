# 字段自选与配色 · 产品工程审计报告（v1.9.0 立项依据）

- 日期：2026-08-28
- 审计人：产品工程审计员（独立子代理）
- 性质：只读审计，未修改任何文件
- 触发来源：视频评论区用户留言——①信息自选字段（含原有状态信息全部可选）②字段增加配色，一眼看到最关注的信息
- 推荐方案：**方案A 行内勾选面板 + 配置落盘 settings.json + 三档预设；配色=内置语义色名（不做自由取色为默认）**

## ① 字段清单（信息栏当前可能出现的全部字段/片段）

信息栏实际渲染两行：**row1 = 原生统计行**（完整模式可见、简洁模式 DOM 保留但动画收合），**row2 = 插件主行**（三态互斥）。主行结构 = `groups[]`（居中信息组）+ `trailingErrorGroups[]`（右尾错误组），组间以 `|` 分隔（client 926-944 行）。

### A. 通用组（三种模式共用）

| 字段/片段 | 标签文案 | 数据来源（宿主推送） | 显示条件 | 互斥 |
|---|---|---|---|---|
| 服务商+模型锚点组 | 服务商显示名 `·` 模型名；支持图像的模型变为「模型名 视觉」胶囊 | `getPricing`（providerDisplay/modelDisplay/acceptsImageInput）；订阅/账单制下服务名改由客户端 `subscriptionServiceName`/`billingServiceName` 映射 | 所有模式第一个组（client 533-548/588-606/859-872 行） | — |
| 「未适配」 | 未适配 | `getBalanceSnapshot.unmapped` | 余额制且 provider 无账户映射（host 1943-1944 行） | 与余额字段 else-if 互斥 |
| 本会话花费 | 「本会话 ¥X.XXX」（hover：含子代理说明+今天/近一月/全部） | `getUsageSummary.currentSession.costs`（宿主 `currentSessionSummary` 按会话起点+同账户聚合，host 2260-2296 行） | 余额制与订阅·充值余额形态；**始终显示**，无记账显示 ¥0.000（client 674-694 行） | — |
| 刷新失败 | 刷新失败（多个来源**去重合并为一个**，client 932-939 行） | 任一端点 RPC 失败（state.errors）或宿主快照带 error | 任一数据源降级 | — |
| 账单待整理 / 账单未保存 | 同文案 | `getUsageSummary.persistence.state ≠ 'ok'` | 记账落盘异常（client 908-917 行） | — |
| 新版本提醒 | 新版本提醒 | `getUpdateInfo`（宿主启动时查 npm registry，host 50-68 行） | `available===true`（client 919-923 行） | — |

### B. 原生统计行 row1（完整模式独占可见；简洁模式收合隐藏——已有的"字段分级"先例）

| 字段 | 文案 | 来源 | 条件 |
|---|---|---|---|
| 轮次/步数 | 「N 轮 · M 步」 | DSH 投影 `useProjection('sessionStats')` | statsProj 存在 |
| LLM 耗时 | 「LLM X」 | 同上 llmMs>0 | |
| 工具调用耗时 | 「工具调用 X」 | 同上 toolMs>0 | |
| 首 token 平均 / tok/s | 同文案 | 同上 | **恒隐藏**（`HIDE_SPEED_FIELDS=true`，仅 hover title 保留，client 22/977-980 行）——已存在的"官方隐藏字段" |
| 缓存命中 | 「缓存命中 N%」 | `useProjection('tokenUsage')` | 计费输入或输出 >0 |
| 输入/输出 tokens | 「输入 X tok · 输出 Y tok」 | 同上 | 同上 |

### C. 余额制组（`pushBalanceGroups`；billingMode 判定为 balance）

| 字段 | 文案 | 来源 | 显示条件 |
|---|---|---|---|
| 余额 | 「余额 ¥/$X.XX」+ 低余额红字加粗+「低」+「（估算）」 | `getBalanceSnapshot`（data.total/alert.active/estimate） | data 存在；total < 阈值（默认 ¥20，host 1950 行）触警 |
| 未配置凭据 | 「未配置 XXX → 设置→模型 填写」 | 同上 error.kind='no-key' | 凭据缺失 |
| 余额获取失败 | 同文案 | error 无 data / errors.balance | 快照失败且无旧数据 |
| 时段 | 「高峰价」红 /「空闲价」绿 | `getPricing.mode==='peak-valley'` | **仅峰谷价模型**（当前即 DeepSeek 系列，host 753-768 行 PRICING 表） |
| 倒计时 | 「距空闲/距高峰 H:MM:SS」 | `getPricing.nextSwitch` | peak-valley 且 nextSwitch 存在 |

### D. 订阅制组（`pushSubscriptionGroups`；provider ∈ SUBSCRIPTION_PROVIDERS：codex/chatgpt/openai-codex/opencode-go/opencode/zai/zai-coding-cn/xiaomi-token-plan-{cn,sgp,ams}，constants.js）

| 字段 | 文案 | 来源 | 显示条件 |
|---|---|---|---|
| 订阅服务组 | ChatGPT/Codex/OpenCode Go/智谱/小米 MiMo `·` 模型名或套餐档位（Plus/Pro/Team/Enterprise） | `getBillingMode`+`getPricing`+`sub.planType`（JWT 本地解码） | planType 存在时模型位换成档位名（client 586-606 行） |
| 到期 | 「到期 YYYY-MM-DD」 | `sub.planType`+`expiryAt` | 两者同时存在（client 719-722 行） |
| 额度窗口 | 「5h N%」「周 N%」「月 N%」+≤20% 红字+「低」 | `sub.windows`（宿主 parseCodexUsage/parseOpenCodeGoUsage/parseZaiQuota/parseXiaomiTokenPlanUsage） | **完整模式显示全部窗口；简洁模式只显示优先窗口（5h>周>月）**（client 760-791 行 `const visible = full ? windows : ...`）——density 已在此影响字段数量！ |
| 距重置 | 「距重置 Xd Xh / HH:MM」 | 所选窗口 resetsAt | 有 resetsAt |
| 充值余额形态 | 「余额 ¥X.XX」 | `sub.balance`（智谱按量账户回退接口） | windows 空且 balance 为数值；与额度窗互斥；**此形态额外追加本会话花费**（client 744-757 行） |

### E. 账单制组（`pushBillingGroups`；provider ∈ BILLING_PROVIDERS：together/fireworks/amazon-bedrock/cloudflare-*，v1.7 FR-14 第三态）

| 字段 | 文案 | 来源 | 显示条件 |
|---|---|---|---|
| 账单服务组 | Together/Fireworks/AWS Bedrock/Cloudflare `·` 模型 | `getBillingMode`+`getPricing` | |
| 本月花费/用量 | 「本月 $X.XX」或「本月用量 N tokens」 | `getBillingStatus.data`（currentPeriodSpend / usage+usageUnit） | 对应字段非空 |
| 预算 | 「预算 N%」 | data.budgetPercent | 仅 AWS Bedrock 提供预算查询 |
| 免费额度+距重置 | 「免费 N · 距重置 HH:MM」 | data.freeRemaining+resetsAt | **二者同时存在才显示，绝不编造**（client 847-850 行） |

**三态互斥判定**（client 880-893 行）：`isBilling`→账单组；`isSub`→订阅组；否则余额组，绝不叠加。判定源头：宿主 `detectBillingMode`（host 168-177 行），billingMode='auto' 按 provider 集合自动检测，'balance'/'subscription' 可手动强制。另有 `waitForSessionModel` 期间整行**故意留空**（client 885-886 行）。

## ② 数据流（宿主→客户端）

- **通道**：不是事件推送，是**客户端轮询拉取**。宿主 `apply` 里向 DSH webServer 注册 prefix 路由 `/_dsh/dsh-bottom-info-bar/<method>`（host 2587-2749 行），POST/PUT 读 JSON body（上限 64KB），统一 JSON 响应 + `Cache-Control: no-store`。写操作及会触发宿主网络请求的方法（`setActiveProvider/setDisplayMode/setInfoDensity/getSubscriptionSnapshot/getBillingStatus`）在 MUTATING 表中要求**同源校验**（sec-fetch-site/origin，host 2664-2677 行）。
- **客户端 rpc()**（client 35-73 行）：fetch POST + 20s 超时 + AbortSignal（组件卸载即取消）。
- **load()**（client 346-374 行）：`Promise.allSettled` 并发拉 6 个端点——`getBalanceSnapshot / getPricing / getUsageSummary / getBillingMode / getSubscriptionSnapshot / getBillingStatus`，`mergeLoadResults` 逐端点容错（成功写新值、失败保留旧值+记错误，client 78-93 行）。触发时机：①挂载 ②30s 定时轮询 ③首启 6 秒窗口内带 force=true 绕过宿主缓存（client 29-30/351-352 行）④会话模型变化 ⑤原生统计变化后 800ms 防抖。`getUpdateInfo`、`getConfig` 仅启动时拉一次。
- **各端点 JSON 形状**（字段级）：
  - `getBalanceSnapshot` → `{ provider, displayName, estimate, unmapped?, currency, data:{currency,total,granted?,toppedUp?,plan?}|null, fetchedAt, error:{kind,message}|null, alert:{active,threshold,currency,total}|null, now }`
  - `getPricing` → `{ model, provider, providerDisplay, modelDisplay, acceptsImageInput, fallback, mode:'peak-valley'|'flat'|'unknown', period:'peak'|'offpeak'|'flat', prices:{inputCacheHit,inputCacheMiss,output}|null, nextSwitch:{at,atLabel,nextIsPeak}|null, refreshedAt }`
  - `getUsageSummary` → `{ sessions, calibration, currentSession:{input,cacheRead,cacheWrite,output,tokens,costs:{CNY?,USD?},hitRate}|null, spend, todaySpend, monthSpend, last30dSpend, totalSpend, persistence:{state,message,at}, now }`
  - `getBillingMode` → `{ mode:'balance'|'subscription'|'billing', provider, reason, model }`
  - `getSubscriptionSnapshot` → `{ mode, provider, reason, source, plan, planType, expiryAt, windows:[{key,label,usedPercent,resetsAt}], balance, fetchedAt, error }`
  - `getBillingStatus` → `{ mode, provider, reason, type, data:{currency,currentPeriodSpend?,budgetPercent?,usage?,usageUnit?,freeRemaining?,resetsAt?,note}|null, fetchedAt, error, now }`
  - `getUpdateInfo` → `{ available, current, latest }`；`getConfig` → `{ displayMode, infoDensity, activeProvider, alertThreshold, billingMode }`；`setInfoDensity` ← `{density}` → `{infoDensity}`

## ③ 现有设置机制：density toggle 剖析（新功能的最佳参照，也是必须超越的基线）

- **触发**：整条信息栏就是一个 `role=button`（client 1004-1025 行），鼠标单击或键盘 Enter/Space 均触发 `onToggleDensity`；无快捷键。保存中 `cursor: progress` + aria-busy。
- **状态机**：模块级 `let density='full'` + `toggling` 防抖（禁连点）+ `densityVersion` 版本号。点击后**乐观更新**——立即切换 UI 再发 `rpc('setInfoDensity')`，失败才回退前一状态（client 210-226 行）；启动时 `getConfig` 拉持久值，但版本号守卫保证启动配置绝不覆盖用户已做的切换（client 233-240 行）。
- **持久化位置（关键发现）**：**宿主进程内存**。host 1008-1014 行 `let config = {...}` 是普通对象，`setInfoDensity`（host 2656-2660 行）严格校验 `d==='full'||d==='compact'` 后只改内存。**没有任何落盘**——DATA_DIR（`~/.dsh/dsh-bottom-info-bar/`）只存记账流水/快照/价目缓存；客户端**零 localStorage/sessionStorage**（grep 证实）。因此宿主重启（改 plugin 后重启 dsh web）后密度重置为 'full'。
- **渲染副作用**：密度不是显隐单个字段而是整行 CSS 收合（`bi-density-extra` 用 grid-template-rows 动画，DOM 保留，client 111-114 行）+ 订阅窗口数量随 density 减少（见①D）。
- **无障碍**：aria-pressed/aria-busy/aria-disabled、sr-only 操作说明、`prefers-reduced-motion` 降级。
- **测试形态**：test-density-toggle.js / test-static-client.js 都是**读源码字符串做 includes 断言**的静态测试（非 DOM 测试），断言大量绑定具体代码字面（如 `onClick: function () { props.onToggleDensity(); }`）。

**对新需求的启示**：①可复用的骨架 = 点击交互 + 宿主 RPC 保存 + 严格值校验 + 版本号守卫 + 静态断言测试；②不能照抄的 = 循环切换两态范式（字段组合是 C(n,k) 空间，循环不可枚举）；③必须超越的 = **配置必须落盘**，否则用户每次重启都要重新勾选字段，不可接受（density 只存活一个宿主进程是既存缺陷，不是可继承的规范）。

## ④ 实现路径候选方案与推荐

### 方案A：点击信息栏弹出就地小面板（勾选字段 + 色样）
- 交互入口：信息栏上新增固定小入口（如右侧齿轮字符/图标区），点击展开**同 Slot 内的绝对定位浮层**：字段 checkbox 列表（当前模式不适用的字段置灰标注）+ 每字段语义色样 + 预设档位（极简/标准/全部）+ 恢复默认。点外部/Esc 关闭。
- **是否违反"零新页面"**：不违反。该原则针对的是跳转独立页面；就地 popover 是信息栏行内交互的延伸，且密度切换已把整栏变成可点按钮。但注意：现在整栏单击=密度切换，新入口必须**划分点击区**（建议：主区点击保留密度切换，入口小区点击开面板），否则两个功能抢同一交互。
- 配置存哪：宿主 `~/.dsh/dsh-bottom-info-bar/settings.json`（新增 RPC，如 `getFieldConfig`/`setFieldConfig`，列入 MUTATING+同源），原子写+fsync 复用现有 `writeAndSync`（host 2008-2023 行）。**比 density 多做落盘**。
- 改动量：host 加 2 个 RPC+落盘+校验；client 加面板组件+渲染过滤+色彩变量注入。**中-大**。

### 方案B：density 式循环切换 / 右键菜单
- 循环切换：只对**预设档位**可行（极简→标准→全部 三档循环），单字段循环在字段数>3 后不可用；无法承载"每字段配色"。
- 右键菜单：可拦截 contextmenu 实现自定义菜单，但"每字段开关+每字段颜色子菜单"层级极深，非技术用户学习成本高，且 DSH 全局右键行为未验证。
- 配置存哪：同 A。**中**。交互天花板低，不适合作为主方案。

### 方案C：只提供配置文件手动编辑（settings.json 手写）
- 零 UI 开发量（**小**），配置格式与 A 完全一致（可共用宿主读写代码）。
- 对本项目目标用户（非技术个人开发者）**不可接受作为唯一途径**；可作为 A 的高级逃生舱并存（面板写的就是那个文件，格式天然互通）。

### 推荐：**方案A 为主干 + C 的落盘格式作为同一存储 + B 的合理内核（三档预设）收进 A 的面板**
理由：唯一同时满足"非技术用户可用"与"字段级显隐+配色"的路径；与"零新页面"原则正交（不跳页）；分期可拆（先显隐后配色）。
- host 改动：settings 读写与校验（**配置键用稳定英文 id** 如 `balance`/`period`/`countdown`/`subWindows`，绝不绑中文文案，否则文案微调即毁兼容）；字段 key 白名单=现有渲染分支枚举；颜色只接受内置语义名或严格 `#RRGGBB`。
- client 改动：把 `pushBalanceGroups/pushSubscriptionGroups/pushBillingGroups` 内各字段拆成可命名片段（现在是一整个函数体，需局部重构），渲染前按配置过滤；新增面板组件；CSS 变量注入。

## ⑤ 配色方案

**现状机制**（client 103-108 行，test-static-client 53-70 行有断言锁死）：
- 已有 CSS 变量体系：`--bi-label-primary / --bi-label-supporting / --bi-separator`（回退 DSH 的 `--dsw-alias-*` token）/ `--bi-state-price-low / --bi-state-alert`。
- **明暗适配 = 变量成对定义**：浅色默认值 → `body[data-ds-dark-theme] .bi-root` 覆盖 → `@media (prefers-contrast: more)` 第三套增强色阶。新颜色必须照此三套配对，禁止组件内硬编码 hex（视觉胶囊 `#0057ff/#0044cc` 是现存唯一硬编码反例）。
- **语义现状**：警示红被高峰价/低余额/低额度/错误/新版本/账单未保存**六类共用**；绿=空闲价；中性灰=正文与估算。
- **已有色弱友好基线（必须延续）**：项目明确约定"颜色不单独表达状态"——低余额有「低」字、估算有「（估算）」、错误有文字标签（test-static-client 53-75 行断言）。

**语义色建议（5 类）**：
- 花费类（本会话/累计）：默认**中性主色加粗不上色**——常态信息上色会稀释告警的红色焦点；可选蓝系。
- 余额类：默认中性；低余额保持红+「低」。
- 峰谷类：高峰=现有警示红、空闲=现有绿（维持不变）。
- 倒计时类：跟随峰谷语义（距空闲绿/距高峰红）或中性。
- 额度类（订阅窗口）：默认中性；≤20% 红+「低」（维持 LOW_QUOTA_PERCENT 机制）。
- 建议色板沿用现有"浅色深、深色浅"配对（浅 #d92d20/深 #ff6961；浅 #087f5b/深 #86efac），新增蓝/紫按同规则配对，对比度 ≥4.5:1（现有注释对警示色追求 7:1）。

**用户自定义 vs 内置语义默认+可关**：**推荐内置语义色默认（第一交付物），每字段在面板里选"语义色名"（红/绿/蓝/紫/中性）而非自由色值**。理由：明暗两套与增强对比自动成立、色弱安全兜底、宿主校验简单、零选色时外观与现版本完全一致（零回归）。完全自定义 hex 不推荐作默认能力——一个 hex 无法同时满足两套主题的对比度，适配责任被转嫁给用户；可作为"高级"选项保留，且需双主题实时预览+非法值拒绝回退。

## ⑥ 风险

1. **字段存在性交叉**：每字段只在特定模式/服务商存在（时段仅 peak-valley、预算仅 Bedrock、到期仅 JWT 订阅）。面板需对"当前模式没有的字段"置灰标注，否则用户勾了不显示会误以为坏了。
2. **锚点组不可全隐**：「服务商+模型」是既定原则"一行只显示当前服务商"的身份锚点，建议设为不可隐藏。
3. **状态信息可关与产品铁律冲突**：「账单未保存/账单待整理」被隐藏后金额可能**悄悄不准**，与"真实花费"铁律冲突。建议错误类字段允许折叠为最小标记但不可全关，面板中标注"建议保留"。
4. **点击区冲突 + 测试脆断**：整栏单击现=密度切换；test-density-toggle/test-static-client 以源码字面断言锁死了 `onClick: function () { props.onToggleDensity(); }` 等代码，任何点击分区改动都会大量破坏断言，测试必须同步重写（工作量常被低估的一块）。
5. **配置键稳定性**：键必须用稳定英文 id，不随中文文案变；宿主须严格白名单校验（对齐 setInfoDensity 的两态校验风格），防止非法值入库。
6. **持久化缺口**：若沿用 density 的内存态模式，重启即丢配置——新功能必须落盘（见③）。
7. **面板无障碍**：现插件无障碍水准很高（sr-only/aria-*/reduced-motion），新面板需焦点圈闭、Esc 关闭、aria-expanded，不能拉低基线。
8. **三态互斥别破坏**：过滤逻辑必须嵌在 pushXxxGroups 内部，不得在互斥判定之外另起渲染分支。

## ⑦ 工作量

- **方案A 完整版**（面板+字段自选+内置语义配色+落盘+测试同步）：**中-大**。跨 host/client/tests 三处；字段拆片段的重构与静态断言测试重写约占三成。
- **分期建议**：
  - 一期（**小-中**）：字段自选（面板勾选显隐+三档预设）+ settings.json 落盘；
  - 二期（**中**）：内置语义配色档（每字段选语义色名）+ 面板色样；
  - 三期（可选，**小**）：高级自定义 hex + 双主题预览。
- 方案C 单独做：**小**，但不满足非技术用户，仅可作为高级逃生舱。

## ⑧ 验收标准建议

**字段自选**
1. 勾选/取消任一字段，信息栏 1 秒内生效（无需刷新页面/重启）。
2. 配置在宿主重启、页面刷新、浏览器重启后均保留（落盘往返验证）。
3. 余额制/订阅制/账单制三模式分别验证：隐藏字段不占位，分隔符 `|` 正确收合（无双竖线/悬空竖线）。
4. 服务商+模型锚点组始终显示（若采纳"不可隐藏"决策）。
5. 错误/降级类字段按既定决策表现（最小标记保留或禁止全关）；「账单未保存」被隐藏时必须有可见替代提示或被禁止。
6. 最少字段状态下整栏仍有锚点；提供一键恢复默认。
7. 面板全程键盘可用（Tab/Enter/Esc），关闭后焦点回到信息栏。
8. 新增测试：字段 key 白名单校验（非法 key/值拒绝）、三模式×显隐组合断言、settings.json 读写往返与损坏容错（对齐记账快照的恢复策略风格）。

**字段配色**
1. 内置语义色在浅色/深色/增强对比三套下对比度 ≥4.5:1。
2. 去色（灰度）环境下「低」/文字标签仍可辨状态（颜色非唯一载体，延续现有断言）。
3. 不做任何自定义时外观与当前版本逐像素一致（零回归）。
4. 自定义 hex 仅接受 `#RRGGBB`，非法值拒绝并回退语义默认。
5. 明暗切换时自定义色仍可读（双输入或自动钳制）。
6. 新增测试：色值校验、CSS 变量三套成对定义断言、语义色覆盖各字段类。

**通用**
- 修改 plugin/ 后需重启 dsh web 生效（仓库既定约定，文档中明示）；
- README/CHANGELOG 只写用户视角功能，遵守仓库分发铁律（零密钥、零个人路径、语义化版本、Conventional Commits）。
