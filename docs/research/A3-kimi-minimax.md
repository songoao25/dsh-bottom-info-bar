# A3 · Kimi/Moonshot 与 MiniMax 适配可行性调研

**调研日期**: 2026-08  
**调研目标**: 为底部信息栏插件确认 Kimi/Moonshot（moonshotai / moonshotai-cn / kimi-coding）与 MiniMax（minimax / minimax-cn）的余额/用量/套餐查询可行性，输出每家的 14 问结论 + 10 项适配方案  
**可信度标识**:
- 🟢 **官方文档** — 官方文档页 / 官方 OpenAPI 规格
- 🔵 **官方 CLI** — 官方仓库代码（MiniMax-AI/cli）
- 🔷 **社区逆向** — 多个独立开源项目交叉验证
- 🟡 **待核实** — 信息有限或存在冲突

---

## 〇、DSH 内置凭据与 provider 映射（已核验 pi-ai 源码）

| DSH provider id | DSH 名称 | baseUrl | 认证方式 | 环境变量 | 协议 |
|---|---|---|---|---|---|
| `moonshotai` | Moonshot AI | `https://api.moonshot.ai/v1` | API Key (Bearer) | `MOONSHOT_API_KEY` | OpenAI Chat Completions |
| `moonshotai-cn` | Moonshot AI CN | `https://api.moonshot.cn/v1` | API Key (Bearer) | `MOONSHOT_API_KEY`（**与 Global 共用同一变量**） | OpenAI Chat Completions |
| `kimi-coding` | Kimi For Coding | `https://api.kimi.com/coding` | API Key (Bearer) **或** OAuth（Kimi Code 订阅登录） | `KIMI_API_KEY` | Anthropic Messages |
| `minimax` | MiniMax | `https://api.minimax.io/anthropic` | API Key (Bearer) | `MINIMAX_API_KEY` | Anthropic Messages |
| `minimax-cn` | MiniMax CN | `https://api.minimaxi.com/anthropic` | API Key (Bearer) | `MINIMAX_CN_API_KEY` | Anthropic Messages |

来源：[pi-ai README 凭据表](https://github.com/earendil-works/pi-ai)（本地 node_modules 源码 `env-api-keys.js`）、本地 `providers/moonshotai.js`、`moonshotai-cn.js`、`kimi-coding.js`（含 `lazyOAuth` 订阅登录）、`minimax.js`、`minimax-cn.js`。
关键点：**CN 与 Global 的 Moonshot 共用 `MOONSHOT_API_KEY`**；kimi-coding 同时支持 API Key 与 OAuth 订阅两种认证。

---

# 一、Kimi / Moonshot

## 1.1 每家必须回答的 14 问

| # | 问题 | 结论 |
|---|---|---|
| 1 | DSH provider id | `moonshotai`（Global）、`moonshotai-cn`（CN 开放平台）、`kimi-coding`（Kimi For Coding 订阅） |
| 2 | DSH 认证方式 | 开放平台：API Key（`Authorization: Bearer <MOONSHOT_API_KEY>`）；kimi-coding：API Key（`KIMI_API_KEY`）或 OAuth（Kimi Code 订阅 JWT） |
| 3 | 消费方式 | 开放平台按量充值（pay-as-you-go，余额制）；kimi-coding 为 Kimi Code 订阅套餐（月额度：5h 窗口 + 周窗口 + 加油包余额） |
| 4 | 官方 Balance API？ | ✅ 有：`GET /v1/users/me/balance`（Bearer，A 级）。🟢 官方文档明确列出，api-evangelist OpenAPI 规格收录。**响应格式两代并存**：旧格式 `data.balance_infos[]`（total/granted/topped_up，社区多项目使用）；新格式 `data.{available_balance, voucher_balance, cash_balance}`（当前 platform.kimi.com 文档页展示）。实际现场返回哪种 🟡 待核实（建议两种解析都兼容） |
| 5 | 官方 Usage API？ | 开放平台：未发现公开的 token 用量 API（🟡 待核实，与 OpenAI 不同，无 `/v1/usage`）。kimi-coding：有 `GET /coding/v1/usages`（见 #6） |
| 6 | 官方 Subscription/Plan API？ | 开放平台无订阅概念（无）。kimi-coding：✅ `GET https://api.kimi.com/coding/v1/usages`（Bearer，Key 或订阅 JWT 均可）。响应含 `limits[]`（5h 窗口，`detail.{limit,remaining,resetTime}`）+ `usage`（周窗口 `{limit,remaining,resetTime}`）或 `data[]` 行（`model_name:"all"`=周用量、`duration/timeUnit`）。未在公开文档逐字列出，但被 cc-switch、kimi-code-usage 等独立项目交叉验证 → 半官方数据面 API（B 级） |
| 7 | Rate Limit 从 Response Headers 返回？ | ✅ 是（开放平台）。🟢 官方帮助文档确认响应头含 `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`。限制按并发数、RPM、TPM、TPD 四维衡量，**用户级（非 Key 级）共享**，按累计充值金额分级 |
| 8 | Reset Time？ | Rate limit：`X-RateLimit-Reset` 头。Coding 订阅：`resetTime`/`reset_in` 字段（5h 窗口 + 周窗口各自重置；kimi-coding 的 5h 窗口为滚动窗口） |
| 9 | 套餐名？ | 开放平台：无套餐名（按量充值，速率等级按累计充值额分级，🟡 具体阈值在控制台）。kimi-coding：Kimi Code 会员订阅（「会员」档位，含月额度 + 加油包 Extra Usage 兜底余额；当前档位名/价格 🟡 待核实，见 [会员权益](https://www.kimi.ai/zh-hans/help/kimi-code/benefits)） |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration？ | 开放平台余额：全部可得（available_balance/voucher_balance/cash_balance，或旧格式 balance_infos 的 total/granted/topped_up + currency；无官方 Percentage/Warning 阈值，需本地算）。Coding 订阅：limit/remaining/resetTime 可得，used=limit−remaining，百分比本地计算 |
| 11 | 无接口时本地 Token Usage × 官方价格计算？ | ✅ 可行。DSH 模型目录自带单价（USD/百万 tokens）：`kimi-k3` input 3 / output 15 / cacheRead 0.3；`kimi-k2.7-code` 0.95 / 4 / 0.19。乘以每次响应 usage 字段的 token 数即可本地记账（开放平台余额制场景的兜底；K3 官方价格页：[platform.kimi.com/docs/pricing/chat-k3](https://platform.kimi.com/docs/pricing/chat-k3)） |
| 12 | 需用户额外提供权限？ | ❌ 不需要。全部复用 DSH 凭据：开放平台用 `MOONSHOT_API_KEY`，kimi-coding 复用 DSH 已存的 `KIMI_API_KEY` 或 OAuth 会话（禁止重复填 Key）。注：kimi-coding 的 `KIMI_API_KEY` 与开放平台 `MOONSHOT_API_KEY` 是两套体系，谁配了谁才可查对应部分 |
| 13 | 公开官方 API vs 网页私有 API | Balance：🟢 公开官方 API（platform.kimi.com 文档 + OpenAPI 规格）。Coding /usages：官方数据面 API，Kimi Code 开发者体系内使用（未在公开文档页逐字列出）→ 半官方。网页私有 API 不在本报告方案内（platform.kimi.com 控制台仪表盘属网页私有） |
| 14 | 稳定性分级 | `moonshotai`/`moonshotai-cn` 余额：**A 级**（官方文档化 + OpenAPI 规格）。`kimi-coding` /usages：**B 级**（官方数据面、无正式文档、社区稳定使用，接口可能演进；cc-switch、kimi-code-usage 均活跃）。速率头：A 级（官方文档化） |

### 1.2 Kimi/Moonshot 适配方案（10 项）

| 项 | 内容 |
|---|---|
| ① 可展示字段 | 开放平台：可用余额/现金余额/赠送余额 + 币种 + 预警阈值；kimi-coding：5h 窗口用量% + 周窗口用量% + 重置倒计时 + 加油包余额（如有） |
| ② 获取方法 | GET（幂等查询，无副作用） |
| ③ Endpoint | 余额：`https://api.moonshot.cn/v1/users/me/balance`（CN）/ `https://api.moonshot.ai/v1/users/me/balance`（Global）；Coding：`https://api.kimi.com/coding/v1/usages` |
| ④ Auth | `Authorization: Bearer <key>`（复用 MOONSHOT_API_KEY / KIMI_API_KEY 或 OAuth JWT） |
| ⑤ 请求示例 | `curl -H "Authorization: Bearer sk-***" https://api.moonshot.cn/v1/users/me/balance` |
| ⑥ Response 示例（脱敏） | 新格式 `{"code":0,"data":{"available_balance":49.59,"voucher_balance":46.59,"cash_balance":3.00},"scode":"0x0","status":true}`；旧格式 `{"data":{"balance_infos":[{"currency":"CNY","total_balance":"100.00","granted_balance":"0.00","topped_up_balance":"100.00"}]}}`；Coding `{"limits":[{"detail":{"limit":500000,"remaining":450000,"resetTime":...}}],"usage":{"limit":2000000,"remaining":1600000,"resetTime":...}}` |
| ⑦ 刷新频率建议 | 余额 5–10 分钟一次（官方未限频但避免高频）；Coding 用量 1–5 分钟一次（窗口滚动感知） |
| ⑧ 错误处理 | 401（Key 失效/非订阅 Key→开放平台/Coding 各自报错）、429（触速率上限→退避重试）、新旧 balance 格式双解析容错、失败保留旧快照仅标 error |
| ⑨ 安全风险 | 低：仅用只读 GET；Key 不出本地。注意不把 Key 打进日志/URL；OAuth JWT 不过期缓存即可 |
| ⑩ 是否推荐正式集成 (+理由) | ✅ 推荐微服务集成（两项分开）：余额 → `pay_as_you_go`（A 级，官方文档化，性价比最高）；Coding 订阅 → `coding_plan`（B 级，接口虽未文档化但社区成熟，先做只读展示、标注"非官方接口"即可）。格式双解析是唯一注意点 |

**billingMode 分类（Kimi）**: `moonshotai` / `moonshotai-cn` → **pay_as_you_go**（官方余额 API，A 级）；`kimi-coding` → **coding_plan**（5h+周窗口+加油包，半官方端点）。

---

# 二、MiniMax

## 2.1 每家必须回答的 14 问

| # | 问题 | 结论 |
|---|---|---|
| 1 | DSH provider id | `minimax`（Global，api.minimax.io）、`minimax-cn`（CN，api.minimaxi.com） |
| 2 | DSH 认证方式 | API Key（`Authorization: Bearer <MINIMAX_API_KEY>` / `MINIMAX_CN_API_KEY>`） |
| 3 | 消费方式 | 双轨：**Token Plan 订阅**（5h 固定窗口 + 周窗口的 token/次数额度，需 Subscription Key）与**按量计费**（普通 API Key 消耗账户余额，另有积分） |
| 4 | 官方 Balance API？ | ❌ 未发现公开的"账户余额"API（按量计费余额只能在控制台查看，🟡 待核实有无隐藏数据面接口）。**但 Token Plan 有专门额度端点**（见 #6，官方 CLI 使用中） |
| 5 | 官方 Usage API？ | ❌ 无公开 token 用量 API；Token Plan 端点返回的是窗口计数（见 #6）。按量场景用量只能本地记账 |
| 6 | 官方 Subscription/Plan API？ | ✅ 有：`GET /v1/token_plan/remains`。🔵 官方 CLI（MiniMax-AI/cli PR #104，已合并）从旧端点 `v1/api/openplatform/coding_plan/remains` 切换至此，并实测 **api.minimaxi.com 与 api.minimax.io 双域名均可**。响应：`base_resp.{status_code,status_msg}` + `model_remains[]`（`model_name, start_time, end_time, remains_time, current_interval_total_count, current_interval_usage_count, current_weekly_total_count, current_weekly_usage_count, weekly_start_time, weekly_end_time, weekly_remains_time`）。**注意 `current_interval_usage_count` 是"已用"不是"剩余"**（PR #104 明确修正）。⚠️ **必须用 Subscription Key**，按量 API Key 会被拒（实测 `base_resp.status_code=1004` "login fail"）。端点未在文档页逐字公开 → B 级（官方 CLI 背书 + 社区交叉验证） |
| 7 | Rate Limit 从 Response Headers 返回？ | 🟡 待核实。未发现官方文档说明速率头；MiniMax 限流主要报业务码（如超出窗口额度），建议以 400/429/业务码做错误处理而非依赖头 |
| 8 | Reset Time？ | ✅ `model_remains[].remains_time`（距 5h 窗口重置的剩余 ms，带 `start_time/end_time` 时间戳）+ `weekly_remains_time`。周窗口有独立 `weekly_start/end_time`。窗口语义：官方 FAQ 称"5 小时固定窗口和周窗口"，官方 CLI 样例为固定起止时间戳；社区有"滚动窗口"说法 🟡 以官方返回的时间戳为准即可，不依赖语义 |
| 9 | 套餐名？ | Token Plan 多档位（🟡 具体档位名待核实，社区提过 Plus/Ultra 才会有 `model_remains[]` 模型拆分）。按量计费无套餐名。订阅页：[platform.minimaxi.com/subscribe/token-plan](https://platform.minimaxi.com/subscribe/token-plan) |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration？ | Token Plan：total/used/reset 全可得（`current_interval_total_count`/`..._usage_count`/`remains_time`；周窗口同理），remaining=total−used，百分比本地计算；套餐到期时间 🟡 端点未直接给 expiresAt（需从订阅信息页另取）。按量余额：无 |
| 11 | 无接口时本地 Token Usage × 官方价格计算？ | ✅ 可行。🟢 官方按量价格（元/百万 tokens）：`MiniMax-M3`（≤512k 输入）2.10 输入 / 8.40 输出 / 0.42 缓存读（永久五折；>512k 双倍；priority ×1.5）；`MiniMax-M2.7` 2.1 / 8.4 / 0.42 / 缓存写 2.625。（来源：[pricing-paygo](https://platform.minimaxi.com/docs/guides/pricing-paygo)）。DSH 目录同步内置 USD 单价（M3 in 0.3 / out 1.2 / cacheRead 0.06）可作兜底 |
| 12 | 需用户额外提供权限？ | ⚠️ 有条件复用：查询 Token Plan 必须用户的 MiniMax Key 是 **Subscription Key**（在 Token Plan 订阅页生成/获取）。若 DSH 里存的是按量 API Key，`/token_plan/remains` 将 401/1004 → 该场景**不增加填 Key 流程**，直接降级为本地记账 + 提示"需 Subscription Key"（不要求重复填 Key） |
| 13 | 公开官方 API vs 网页私有 API | `token_plan/remains` 为**官方数据面 API**（官方 CLI 使用；文档页未逐字公开，半官方）。控制台网页的用量展示属网页私有 API。无公开 Balance API |
| 14 | 稳定性分级 | `token_plan/remains`：**B 级**（官方 CLI 背书、端点 2026-04 刚切换、社区活跃跟进；语义有坑：usage=已用）。按量余额：**E 级**（无接口）。旧端点 `v1/api/openplatform/coding_plan/remains`：**C 级**（已被官方弃用迁移） |

### 2.2 MiniMax 适配方案（10 项）

| 项 | 内容 |
|---|---|
| ① 可展示字段 | Token Plan：5h 窗口已用/总额/百分比/重置倒计时 + 周窗口同组 + 按模型拆分（如有）；按量场景：本地花费记账 |
| ② 获取方法 | GET（幂等查询）；POST 变体见 Eyozy/minimax-usage，以官方 CLI 的 GET 为准 |
| ③ Endpoint | `https://api.minimax.io/v1/token_plan/remains`（Global）/ `https://api.minimaxi.com/v1/token_plan/remains`（CN） |
| ④ Auth | `Authorization: Bearer <Subscription Key>`（复用 `MINIMAX_API_KEY`/`MINIMAX_CN_API_KEY`；Key 类型不匹配 → 401/1004，就地降级） |
| ⑤ 请求示例 | `curl -s -H "Authorization: Bearer sk-***" https://api.minimax.io/v1/token_plan/remains` |
| ⑥ Response 示例（脱敏） | `{"base_resp":{"status_code":0,"status_msg":"success"},"model_remains":[{"model_name":"MiniMax-M*","start_time":1776355200000,"end_time":1776373200000,"remains_time":7151954,"current_interval_total_count":1500,"current_interval_usage_count":228,"current_weekly_total_count":0,"current_weekly_usage_count":0,"weekly_start_time":1776009600000,"weekly_end_time":1776614400000,"weekly_remains_time":248351954}]}` |
| ⑦ 刷新频率建议 | 5–10 分钟一次（窗口级数据，变化粒度大；官方 CLI `mmx quota show` 为手动命令，无实时性要求） |
| ⑧ 错误处理 | `base_resp.status_code!=0`（1004=鉴权失败→提示 Subscription Key）、HTTP 401/403（Key 类型错→降级本地记账）、网络失败保留旧快照；`model_remains[]` 可能为空（无订阅/低价档）→ 显示"无活跃 Token Plan" |
| ⑨ 安全风险 | 低：只读 GET。Subscription Key 是真实账户凭证（官方文档警告"能消耗全部配额"），务必本地持有、不进日志。按量 Key 调该端点无写风险 |
| ⑩ 是否推荐正式集成 (+理由) | ⚠️ 有条件推荐：**仅当判定用户 Key 为 Subscription Key 时**启用 `token_plan` 查询（官方 CLI 背书、字段齐全）；否则降级本地记账。相比 Kimi 成熟度略低（端点 2026-04 才切换），建议 v1.7 先集成、标注"实验性/半官方" |

**billingMode 分类（MiniMax）**: `minimax` / `minimax-cn` → **token_plan**（Subscription Key 场景，5h+周窗口，B 级）；按量 API Key 场景 → pay_as_you_go 但无官方余额接口 → source=`local_calculation`（E 级）。

---

# 三、推荐集成清单

| 优先级 | provider | 模式 | 数据源 | 分级 | 说明 |
|---|---|---|---|---|---|
| P0 | `moonshotai` / `moonshotai-cn` | pay_as_you_go | 官方余额 API | A | 官方文档化，双格式解析，成本最低，先做 |
| P1 | `kimi-coding` | coding_plan | `/coding/v1/usages` | B | 社区成熟；复用 KIMI_API_KEY 或 OAuth；标注半官方 |
| P2 | `minimax` / `minimax-cn` | token_plan | `/v1/token_plan/remains` | B | 官方 CLI 背书；需 Subscription Key，成功率取决于用户 Key 类型，做降级 |
| 不做 | MiniMax 按量余额 | — | 无接口 | E | 仅本地记账 |

**每家一句话结论**:
- **Kimi/Moonshot**：开放平台余额查询是 A 级官方 API（直接复用 `MOONSHOT_API_KEY`，双格式解析即可上线），Kimi Coding 订阅额度是 B 级半官方接口（复用 `KIMI_API_KEY`/OAuth，5h+周窗口齐全），两家一起纳入没问题。
- **MiniMax**：Token Plan 端点已由官方 CLI 背书（`/v1/token_plan/remains`，5h+周窗口字段完整），但**必须用户的 Key 是 Subscription Key 才可查**，否则 401 降级本地记账，且该端点刚经历迁移、成熟度略低于 Kimi，建议作为第二批。

---

# 四、参考来源

### Kimi/Moonshot
- 🟢 [Kimi Platform API · 查询余额（platform.kimi.com/docs/api/balance）](https://platform.kimi.com/docs/api/balance)
- 🟢 [Kimi API 速率限制说明（X-RateLimit-* 头）](https://www.kimi.com/help/kimi-api/api-rate-limits)
- 🟢 [Kimi K3 API 定价](https://platform.kimi.com/docs/pricing/chat-k3)
- 🟢 [Kimi 开放平台 API 概览](https://platform.kimi.com/docs/api/overview)
- 🟢 [Kimi Code 会员权益](https://www.kimi.ai/zh-hans/help/kimi-code/benefits)
- 🟢 [Kimi Code 文档 · 会员指南](https://www.kimi.com/code/docs/kimi-code/membership.html)
- 🔵 api-evangelist Kimi/Moonshot Billing OpenAPI（「查询余额」+ 字段规格）: [kimi-moonshot-billing-api-openapi.yml](https://raw.githubusercontent.com/api-evangelist/kimi-moonshot/refs/heads/main/openapi/kimi-moonshot-billing-api-openapi.yml)
- 🔷 [cc-switch · coding_plan.rs（Kimi /coding/v1/usages 实现）](https://github.com/farion1231/cc-switch/blob/0b5da510/src-tauri/src/services/coding_plan.rs)
- 🔷 [kimi-code-usage（Kimi Coding Plan 用量跟踪）](https://github.com/Golden0Voyager/kimi-code-usage)
- 🔷 [kimi-quota-statusline](https://github.com/OrderG-X/kimi-quota-statusline)

### MiniMax
- 🟢 [Token Plan 介绍（platform.minimaxi.com/docs/token-plan/intro）](https://platform.minimaxi.com/docs/token-plan/intro)
- 🟢 [Token Plan 快速上手（platform.minimaxi.com/docs/token-plan/quickstart）](https://platform.minimaxi.com/docs/token-plan/quickstart)
- 🟢 [Token Plan 常见问题（5h+周窗口、额度不结转）](https://platform.minimaxi.com/docs/token-plan/faq)
- 🟢 [按量计费定价（M3/M2.7 单价）](https://platform.minimaxi.com/docs/guides/pricing-paygo)
- 🟢 [关于账户 FAQ](https://platform.minimaxi.com/docs/faq/about-account)
- 🟢 [Token Plan 订阅页](https://platform.minimaxi.com/subscribe/token-plan)
- 🔵 [MiniMax-AI/cli PR #104 · 切换至 /v1/token_plan/remains（含真实 fixture）](https://github.com/MiniMax-AI/cli/pull/104)
- 🔷 [me-speaker/token_manager · MiniMax Token Plan API 调研（含 1004 实测）](https://github.com/me-speaker/token_manager/blob/master/minimax-token-plan-api.md)
- 🔷 [Eyozy/minimax-usage（Token Plan 用量查询工具）](https://github.com/Eyozy/minimax-usage)
- 🔷 [cc-switch · coding_plan.rs（MiniMax 旧端点实现）](https://github.com/farion1231/cc-switch/blob/0b5da510/src-tauri/src/services/coding_plan.rs)
- 🔷 [openclaw · MiniMax Coding Plan 中国版与全球版 Key 说明](https://openclaw.cocoloop.cn/apikey/zh/minimax.html)

### 本地 DSH 源码核验（node_modules）
- `@earendil-works/pi-ai/dist/env-api-keys.js`（凭据名映射）、`dist/providers/{moonshotai,moonshotai-cn,kimi-coding,minimax,minimax-cn}.js`（baseUrl/认证）、`dist/providers/data/*.json`（模型单价：kimi-k3、kimi-k2.7-code、MiniMax-M2.7/M3）

---

**统计口径说明**: 所有金额/额度样例均已脱敏；标 🟡 项（Kimi 现网 balance 实际格式、MiniMax 档位名、MiniMax 速率头、套餐过期时间）待真实 Key 联调时确认。
**审核状态**: 待主 Agent 验收。