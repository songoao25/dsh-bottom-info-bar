# A7 调研：xAI(Grok) / NVIDIA / Mistral 底部信息栏适配可行性

**调研日期**: 2026-01（文档以当日抓取的官方站点为准）
**任务**: 为「DSH 底部信息栏」插件评估三家国外平台服务商的余额/用量/订阅可读性，决定能否进入正式集成。
**DSH 内置凭据确认**（源码实测 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/providers/`）：

| 平台 | DSH provider id | baseUrl | 凭据 env | DSH 认证方式 |
|---|---|---|---|---|
| xAI | `xai` | `https://api.x.ai/v1` | `XAI_API_KEY` | API Key **+** OAuth 设备码（SuperGrok / X Premium 订阅兑换） |
| NVIDIA | `nvidia` | `https://integrate.api.nvidia.com/v1` | `NVIDIA_API_KEY` | 仅 API Key |
| Mistral | `mistral` | `https://api.mistral.ai` | `MISTRAL_API_KEY` | 仅 API Key |

- xAI 内置 `xaiProvider()` 同时注册 `openai-completions` 与 `openai-responses` 两种 API；OAuth 流程见 `dist/auth/oauth/xai.js`（端点 `auth.x.ai/oauth2/device/code`、`auth.x.ai/oauth2/token`，scope 含 `grok-cli:access api:access`，兑换出的 access_token 直接当作 Bearer API Key 使用）。来源：[DSH pi-ai 源码](https://github.com/earendil-works/pi-ai)
- NVIDIA 用 openai-completions 兼容层；Mistral 用 `mistral-conversations` API。

---

## 一、xAI（Grok）

### 1.1 十四问

| # | 问题 | 结论 |
|---|---|---|
| 1 | DSH provider id | `xai` |
| 2 | DSH 认证方式 | `XAI_API_KEY`（Bearer）或 OAuth 设备码（SuperGrok / X Premium 订阅） |
| 3 | 消费方式 | **预付费 Credits**（默认，逐请求扣减）+ **按月发票后付费**（postpaid，默认关闭，需 sales 开通）；另有**消费型订阅与 API 计费完全分离**：SuperGrok / X Premium+ 订阅仅供 Grok 消费端与 OAuth 兑换 API Key，API 计费另走 Credits（来源：[Manage Billing](https://docs.x.ai/console/billing)） |
| 4 | 官方 Balance API | **有**：`GET https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance`——返回预付费 Credits 变动明细 + `total`（当前余额，USD 分）。**注意：这是 Management API，需独立 Management Key**（[Billing Management](https://docs.x.ai/developers/rest-api-reference/management/billing#list-prepaid-credit-balance-and-balance-changes)） |
| 5 | 官方 Usage API | **有**：`POST /v1/billing/teams/{team_id}/usage`——按时间范围聚合的**历史累计用量**（USD/tokens 维度，可 groupBy），**无"剩余额度"语义**，仅累计（[usage 端点](https://docs.x.ai/developers/rest-api-reference/management/billing#get-historical-usage-of-the-api)） |
| 6 | 官方 Subscription/Plan API | **无公开端点**。Management API 只有 billing-info / invoices / payment-method / spending-limits / prepaid / usage；消费订阅（SuperGrok 等）套餐与配额无 API（待核实：OAuth 兑换的订阅 token 亦无可查套餐的公开接口） |
| 7 | Rate Limit 是否从 Response Headers 返回 | **否**。官方只文档化 429 + 指数退避，未发布 x-ratelimit 类响应头（[Rate Limits](https://docs.x.ai/developers/rate-limits) / [Debugging](https://docs.x.ai/developers/debugging)） |
| 8 | Reset Time | 无窗口式重置概念：限速按**套餐 Tier × 模型**（RPS/TPM 硬顶），Tier 随累计消费自动升级；余额为预付费扣减，无周期重置（待核实：postpaid 有自然月账单周期） |
| 9 | 套餐名 | API 侧无套餐名，只有 Credtis 充值/后付费；消费侧套餐：SuperGrok（约 $30/月）、SuperGrok+（约 $300/月）、X Premium+（约 $40/月，含 SuperGrok）——与 API 计费分离（[Compare Grok Plans](https://x.ai/pricing)、[Grok Pricing 拆解](https://www.datastudios.org/post/grok-pricing-subscription-tiers-api-token-costs-and-model-access-across-x-grok-com-and-xai-deve)） |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | Balance=✔（prepaid/balance.total，分）；Used=✔（usage 端点累计 USD）；Remaining=✔（= current prepaid total，近似）；Percentage=△ 可推导（usage ÷ postpaid spending-limits）；Reset=✘（无）；Expiration=△（Credits 过期规则未文档化，待核实；OAuth token 1h+refresh 由 DSH 内管理） |
| 11 | 无接口时能否本地 Token Usage × 官方价格 | **能**。DSH pi-ai 内置 xAI 模型成本表（如 grok-4.3 入 $1.25/M、出 $2.50/M，含缓存价，实测 `xai.json`），且官方公布[每 token 价格](https://docs.x.ai/developers/pricing)，本地记账完全可行 |
| 12 | 是否需要用户额外提供权限 | **需要（进阶模式）**：Balance/Usage API 必须用独立的 **Management Key**（`console.x.ai/team/default/management-keys`，需"Management Keys Read+Write"权限）+ **team_id**，**不能复用 XAI_API_KEY**；基础模式（本地记账 + 模型/用量展示）零额外凭据 |
| 13 | 公开官方 API vs 网页私有 API | 全部走公开官方 API（api.x.ai + management-api.x.ai）；无网页逆向依赖。消费订阅页（x.ai/pricing）仅为人工参考 |
| 14 | 稳定性分级 + 是否适合正式集成 | **A-**：API Key 主链路成熟稳定；Management API（billing 端点）较新但文档完整（2026-02 更新）。**适合正式集成**：本地记账为默认主干（稳定），Management API 作为**可选进阶**（Beta 级对待：降级容错，失败回退本地记账） |

### 1.2 适配方案（10 项）

| 项 | 内容 |
|---|---|
| 可展示字段 | 模型名、Credits 余额（$）、本月累计花费（$）、套餐 Tier（● 可选）、用量状态 |
| 获取方法 | 主：本地记账（DSH usage.cost 累加）；进阶：Management API 拉余额/用量 |
| Endpoint | 主：无（本地）；进阶：`GET https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance`、`POST .../usage`、`GET .../postpaid/spending-limits` |
| Auth | 主：复用 `XAI_API_KEY`（零额外）；进阶：`Authorization: Bearer <MANAGEMENT_KEY>`（全新凭据 + team_id） |
| 请求示例 | `curl https://management-api.x.ai/v1/billing/teams/TEAM_ID/prepaid/balance -H "Authorization: Bearer ••••••"` |
| Response 示例（脱敏） | `{"changes":[{"changeOrigin":"SPEND","amount":{"val":"-120"},"createTime":"2026-01-10T08:00:00Z"}],"total":{"val":"-1040"}}`（total 为净变动额；源码默认值为刷新的演示数据） |
| 刷新频率建议 | 本地记账随会话实时；进阶余额 5–10 min 一次（避免高频打 Management API） |
| 错误处理 | 401 → 提示检查 Management Key/权限；429 → 退避重试；失败保留旧快照并降级本地记账；no_money 状态（0 余额）高亮 |
| 安全风险 | Management Key 权限大（可建 Key/充值/改限），**绝不能**写入本插件的 usage-records.json 或日志；仅进程内存使用；建议引导用户用最小权限 Key |
| 是否推荐正式集成 | **推荐（v1.7 候选）**：本地记账主干 + Management API 可选进阶，双保险、无凭据外泄 |
| billingMode 分类 | API Key 模式=`pay_as_you_go`（Credits 预付费）；OAuth 订阅模式=`subscription`（但配额不可读 → 降级显示"订阅制·用量不可见"） |

---

## 二、NVIDIA（build.nvidia.com / NIM API）

### 2.1 十四问

| # | 问题 | 结论 |
|---|---|---|
| 1 | DSH provider id | `nvidia` |
| 2 | DSH 认证方式 | `NVIDIA_API_KEY`（Bearer，openai-completions 兼容） |
| 3 | 消费方式 | **免费试用（trial）**：build.nvidia.com 是 NVIDIA NIM 的试用体验，按**每模型速率限制**（RPM/RPS/TPM）供评估与原型；**Credits 系统已于 2025 年移除**（官方在论坛明确答复）。生产使用需 NVIDIA AI Enterprise 许可或自托管 NIM（[NIM FAQ](https://docs.api.nvidia.com/nim/docs/product)、[Forum: credits 已移除](https://forums.developer.nvidia.com/t/request-more-4-000-credits-option-on-build-nvidia-com/344567)） |
| 4 | 官方 Balance API | **无**。Credits 系统移除后无余额概念；官方文档与论坛均确认无余额查询接口（[Forum: 找不到 Credits 余额](https://forums.developer.nvidia.com/t/cannot-find-the-amount-of-credits-left-on-nim-api/337051)） |
| 5 | 官方 Usage API | **无**。docs.api.nvidia.com 无 usage/credits 端点；用量仅登录后在 build.nvidia.com 页首角查看速率上限，无历史用量 API |
| 6 | 官方 Subscription/Plan API | **无**。NVIDIA AI Enterprise（商业许可/90 天试用）无编程查询 API；开发者计划与 AI Enterprise 的区别只在[官方 FAQ](https://docs.api.nvidia.com/nim/docs/product)里以文字说明 |
| 7 | Rate Limit 是否从 Response Headers 返回 | **未文档化（待核实）**。社区反馈 429 频繁、无头信息可读（[429 讨论](https://forums.developer.nvidia.com/t/429-too-many-requests-below-the-documented-40-rpm-limit/379374)） |
| 8 | Reset Time | 无。限速按分钟/秒滚动，官方不发布每模型阈值（staff 原话 "we do not publish those"），无重置窗口信息 |
| 9 | 套餐名 | 开发者计划（免费试用）；NVIDIA AI Enterprise（商业，90 天免费试用后可购）；无 API 侧套餐名 |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | 全部 ✘（无接口；历史 1000–5000 Credits 时代亦仅 UI 可见，现已废弃）。唯一可读：页首角"每模型 max rate limit"（UI 手工查看） |
| 11 | 无接口时能否本地 Token Usage × 官方价格 | **部分能**。DSH pi-ai 实测 NVIDIA 模型 cost 全为 0（试用免费 → 无处计价）；本地可记 **token/请求用量**（统计意义），但**无金额语义**（成本恒 0） |
| 12 | 是否需要用户额外提供权限 | **不需要**（也没有更多接口可复用）；复用 `NVIDIA_API_KEY` 只能做用量/模型展示 |
| 13 | 公开官方 API vs 网页私有 API | 官方 API 仅推理端点；速率/用量信息只在 build.nvidia.com 网页 UI（私有页面），无官方读取接口 |
| 14 | 稳定性分级 + 是否适合正式集成 | **C-（信息层）/ B（推理链路）**：推理 API 稳定，但**账户信息零可读**，且试用性质（随时可能 429/限速变化）。**不建议作为"余额/花费"正式集成**；只适合"模型名 + 免费试用·限速"标签展示 |

### 2.2 适配方案（10 项）

| 项 | 内容 |
|---|---|
| 可展示字段 | 模型名、请求/Token 用量（本地统计）、"免费试用·速率受限"状态标签（不可得：余额/花费/重置） |
| 获取方法 | 仅本地记账 + 状态标注；无网络账户接口 |
| Endpoint | 无（官方不提供账户接口）；仅推理端点可顺带读 429 触发降级 |
| Auth | 复用 `NVIDIA_API_KEY`（零额外凭据） |
| 请求示例 | 不适用（无余额请求）；推理流量由 DSH 主链路产生 |
| Response 示例（脱敏） | 不适用（无账户数据响应）；本地快照形如 `{provider:"nvidia", source:"local_calculation", tokens:{…}, cost:0}` |
| 刷新频率建议 | 随会话实时（本地）；无轮询 |
| 错误处理 | 429 → 显示"限速中"并退避；401 → 提示 Key 无效；无余额数据 → 渲染"Unavailable"态而非报错 |
| 安全风险 | 极低（无新增凭据、无新网络调用）；注意不要把"免费"误标为"0 余额告警" |
| 是否推荐正式集成 | **不推荐做账户信息集成**；**推荐轻量接入**：识别 provider=nvidia 时显示"试用·限速"角标，绝不做余额渲染，避免误导 |
| billingMode 分类 | `free_tier`（试用限速、成本 0） |

---

## 三、Mistral

### 3.1 十四问

| # | 问题 | 结论 |
|---|---|---|
| 1 | DSH provider id | `mistral` |
| 2 | DSH 认证方式 | `MISTRAL_API_KEY`（Bearer，`mistral-conversations` API） |
| 3 | 消费方式 | API 按量计费，**组织级月结发票 + 可充值 Credits**；另有 Vibe/Le Chat 消费套餐（Free/Pro/Education/Team/Enterprise），Pro 订阅含每月 API Credits 额度（[Billing](https://docs.mistral.ai/admin/billing-usage/billing)、[Subscriptions](https://docs.mistral.ai/admin/billing-usage/subscriptions)） |
| 4 | 官方 Balance API | **无公开余额 API（待核实）**。Admin Panel 的 Billing→Credits 可看余额/历史/过期，但 Beta Admin API 仅暴露 rate-limit / spend-limit / usage，**未暴露 credit balance** |
| 5 | 官方 Usage API | **有（Beta Admin 端点）**：`GET https://api.mistral.ai/v1/admin/usage?month=&year=`——返回周期内分品类（chat/completion/ocr/audio 等）的成本与消费明细，**累计口径，无剩余额度**（[Usage metrics](https://docs.mistral.ai/admin/admin-api/usage-metrics)、[Admin Billing API](https://docs.mistral.ai/api/endpoint/beta/admin/billing)） |
| 6 | 官方 Subscription/Plan API | **无**。套餐（Pro/Team/Enterprise）仅在 UI 与 pricing 页；Admin API 无订阅/席位端点 |
| 7 | Rate Limit 是否从 Response Headers 返回 | **未文档化（待核实）**。错误文档仅给 429 + 指数退避，无响应头说明（[Error glossary](https://docs.mistral.ai/resources/error-glossary)） |
| 8 | Reset Time | **自然月**：Billing 周期与组织月额度按自然月重置（`monthly_limit_reached` 为月度布尔）；速率限制按 RPS/TPM 滚动无窗口 |
| 9 | 套餐名 | API 侧：无套餐名（按量）；组织计划：Free / Pro（$14.99/月，含 $30/月 API Credits，[pricing](https://mistral.ai/pricing/)）/ Education / Team（$24.99/用户/月）/ Enterprise；Vibe 订阅另计 |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | Balance=✘（API 不可读，UI 有）；Used=✔（admin/usage）；Remaining=△ 可推导（usage vs spend-limit，`monthly_limit_reached` 布尔可感知"是否触顶"）；Percentage=△ 可推导；Reset=✔（自然月）；Expiration=△（Credits 有过期字段，仅 UI，待核实） |
| 11 | 无接口时能否本地 Token Usage × 官方价格 | **能**。DSH pi-ai 内置 Mistral 成本（如 codestral 入 $0.3/M、出 $0.9/M，实测 `mistral.json`）；官方发布[每 token 价格](https://mistral.ai/pricing/api/) |
| 12 | 是否需要用户额外提供权限 | **需要（进阶模式）**：Admin API 需独立 **Admin API Key**（Backoffice 创建，`x-api-key` 头，Admin/Billing 角色），**不能复用 MISTRAL_API_KEY**；基础本地记账零额外 |
| 13 | 公开官方 API vs 网页私有 API | 账户数据分两路：公开官方 Admin API（beta）可读用量/限额；**Credits 余额只在 Admin Panel UI**（私有页面，无 API） |
| 14 | 稳定性分级 + 是否适合正式集成 | **B-**：推理 API 成熟；Admin 用量 API 标 **Beta**（可变动），余额不可读。**适合"有条件"正式集成**：本地记账为主（费用准确），Admin API 用量作为**可选增强**（Beta 降级容错） |

### 3.2 适配方案（10 项）

| 项 | 内容 |
|---|---|
| 可展示字段 | 模型名、本月累计花费（$）、当月用量 vs 月额度百分比、触顶标志 |
| 获取方法 | 主：本地记账（DSH usage.cost）；进阶：Admin API 拉月用量/限额 |
| Endpoint | 主：无（本地）；进阶：`GET https://api.mistral.ai/v1/admin/usage?month={M}&year={Y}`、`GET /v1/admin/spend-limit`、`GET /v1/admin/rate-limit` |
| Auth | 主：复用 `MISTRAL_API_KEY`；进阶：`x-api-key: <ADMIN_API_KEY>`（独立凭据 + Admin/Billing 角色） |
| 请求示例 | `curl "https://api.mistral.ai/v1/admin/usage?month=5&year=2026" -H "x-api-key: ••••••"`（官方文档示例） |
| Response 示例（脱敏） | `{"date":"2026-05-01T00:00:00Z","currency":"USD","start_date":…,"end_date":…,"chat":[{…成本/用量…}],…}`与 `{"limits":{"completion":{"monthly_limit_reached":false},"currency":"USD"}}` |
| 刷新频率建议 | 本地实时；进阶月用量 15–30 min 一次（月底接近限额时可加密） |
| 错误处理 | 401/403 → 提示 Admin Key 权限（Admin/Billing 角色）或降级本地；429 → 退避；`monthly_limit_reached=true` → 高亮"已达月限额"；失败保留旧快照 |
| 安全风险 | Admin Key 可读全组织计费 → 仅进程内存、禁用落盘；建议提示用户角色最小化；Beta 端点字段可能变动，解析需白名单容错 |
| 是否推荐正式集成 | **推荐（v1.7 候选，第二优先）**：本地记账主干 + Admin 用量增强，Beta 端点加降级 |
| billingMode 分类 | `pay_as_you_go`（月结发票/ Credits）；Pro 订阅含 API Credits 属特殊形态，信息栏标注"套餐含 Credits"可选显示 |

---

## 四、三家对比与推荐集成清单

| 维度 | xAI | NVIDIA | Mistral |
|---|---|---|---|
| 余额可读 | ✔（Management API） | ✘（无 Credits 系统） | ✘（仅 UI，API 无） |
| 用量可读 | ✔（Management API 累计） | ✘ | ✔（Admin API Beta，累计） |
| 限速头/重置 | ✘ / 无窗口 | ✘ / 无窗口 | ✘ / 自然月 |
| 本地记账 | ✔（内置价格） | 仅用量（无金额） | ✔（内置价格） |
| 额外凭据 | Management Key（可选） | 无 | Admin Key（可选） |
| billingMode | pay_as_you_go / subscription(OAuth) | free_tier | pay_as_you_go |
| 稳定性 | A- | C-（信息层） | B- |
| 正式集成 | ✅ 推荐 | ⚠️ 仅轻量标签 | ✅ 推荐（第二优先） |

**推荐集成清单（v1.7 候选）**
1. **xAI grok**（第一优先）：本地记账主干（复用 XAI_API_KEY，实时花费/会话/月度/累计）+ 可选进阶 Management API（余额 + 月度限额，需用户主动提供 Management Key 与 team_id，默认关闭）。
2. **Mistral**（第二优先）：本地记账主干（复用 MISTRAL_API_KEY）+ 可选进阶 Admin API 月用量/触顶标志（需用户主动提供 Admin Key，默认关闭）。
3. **NVIDIA**：仅轻量识别（provider=nvidia 显示"免费试用·限速"角标 + 本地 token 用量统计），**不做余额/花费渲染**，防止误导。

**共同注意**
- 三家均无 Rate-Limit 响应头与重置窗口 → 插件不依赖头部限速信息。
- 两家进阶接口（xAI Management、Mistral Admin）均为**新接口/Beta**，实现必须"降级优先"：任何失败回退本地记账，绝不阻塞主链路。
- 进阶凭据（Management Key / Admin Key）为"同账号、不同角色权限"的独立密钥，**不得**与 API Key 混用、不得落盘记录，仅驻内存且需用户显式开启。
- 消费订阅（SuperGrok / Le Chat Pro 等）均无公开配额 API；若用户走 DSH OAuth 订阅路线，信息栏只能显示"订阅制·配额不可见"占位（三家通用），待官方开放接口后再补充。

**主要来源**：[Billing Management API](https://docs.x.ai/developers/rest-api-reference/management/billing) · [Manage Billing](https://docs.x.ai/console/billing) · [xAI Rate Limits](https://docs.x.ai/developers/rate-limits) · [xAI Pricing](https://docs.x.ai/developers/pricing) · [Grok Plans](https://x.ai/pricing) · [NIM General FAQ](https://docs.api.nvidia.com/nim/docs/product) · [NVIDIA Forum: credits 已移除](https://forums.developer.nvidia.com/t/request-more-4-000-credits-option-on-build-nvidia-com/344567) · [NVIDIA Forum: 无法查余额](https://forums.developer.nvidia.com/t/cannot-find-the-amount-of-credits-left-on-nim-api/337051) · [Mistral Admin Billing API (beta)](https://docs.mistral.ai/api/endpoint/beta/admin/billing) · [Mistral Usage metrics](https://docs.mistral.ai/admin/admin-api/usage-metrics) · [Mistral Billing](https://docs.mistral.ai/admin/billing-usage/billing) · [Mistral Pricing](https://mistral.ai/pricing/)