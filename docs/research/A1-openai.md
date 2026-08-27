# A1 调研报告：OpenAI 系适配可行性（openai / openai-codex / ChatGPT Consumer）

> 调研人：调研工程师（A1）｜日期：2026-08-27｜范围：① openai（OpenAI API）② openai-codex（Codex OAuth）③ ChatGPT Consumer 订阅（Plus/Pro/Business/Team + Credits）
> 方法：本地实测 DSH 凭据与 `~/.codex/auth.json` + web 官方文档/社区逆向交叉验证；所有断言带来源；脱敏处理；不确定项标"待核实"。

---

## 0. 本地事实（已实测，本机环境）

| 项 | 实测结果 | 来源 |
|---|---|---|
| DSH 已注册 OpenAI 系 provider | `openai-codex`：`apiKeyEnv: OPENAI_CODEX_API_KEY`、`displayName: ChatGPT`、`transport: sse`；另有 `opencode-go`(`OPENCODE_GO_API_KEY`)、`zai`(`ZAI_API_KEY`) | `~/.dsh/settings.yaml`（本机） |
| DSH 是否保存 OpenAI API Key | 未在 settings.yaml 发现 `OPENAI_API_KEY` 条目；API Key 需用户自行提供（用户名下目前无 OpenAI API Key） | 本机实测 |
| `~/.codex/auth.json` 是否存在 | **存在**，`auth_mode: "chatgpt"`，含 `tokens{id_token, access_token, refresh_token, account_id}` + `last_refresh` | 本机实测（已脱敏） |
| OAuth token 内嵌信息（JWT claims，脱敏） | `chatgpt_plan_type: "plus"`、`chatgpt_subscription_active_start: 2026-08-16`、`chatgpt_subscription_active_until: 2026-09-16`、`email`、`user_id`、`organizations[]`、access_token scope 含 `offline_access`/`api.connectors.*` | 本机实测 `~/.codex/auth.json` 解码 |
| 配套插件 | `~/.dsh/dsh-chatgpt-subscription/codex-bind.json` 存在（`bound: true, boundAt: 2026-08-15`）；仓库约定：本插件只读 auth.json，绑定/刷新归配套插件 | [AGENTS.md](../../AGENTS.md)、本机实测 |
| 关键结论 | **本机已是 ChatGPT Plus 已绑定状态**，openai-codex 通道零额外配置可立即做真实验证 | — |

⚠️ **本机账号 = ChatGPT Plus（订阅生效中）**：这是 v1.6 之后 openai-codex 适配的最强验证资源。

---

## 1. ① openai（OpenAI API，API Key + 按量计费）

### 14 项能力核查

| # | 问题 | 结论 | 来源 |
|---|---|---|---|
| 1 | DSH provider id | `openai`（协议 openai 兼容；DSH settings 中个别别名 `openai-codex` 见第 2 节） | `~/.dsh/settings.yaml` |
| 2 | DSH 认证方式 | `Authorization: Bearer <OPENAI_API_KEY>`；DSH 未保存该 Key，需用户提供 | 本机实测 |
| 3 | 消费方式 | **API PAYG**（预付费 credit 按量扣减；无订阅概念） | [help.openai 预付费](https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing) |
| 4 | 官方 Balance API | **无**。无文档化 balance 接口；网页私有 `platform.openai.com/dashboard/billing/credit_grants`（D 级，社区广泛使用但无官方文档） | [API Overview](https://developers.openai.com/api/reference/overview/)、社区共识 |
| 5 | 官方 Usage API | **有（A 级）**。旧 `GET /v1/usage?start_time=…&bucket_width=1d&group_by[]=model`（2025 前 API，仍需 admin 权限）；新 **`POST /v1/organization/usage/costs`**（Admin API，官方 SDK 落地） | [openai-node usage.ts](https://github.com/openai/openai-node/blob/master/src/resources/admin/organization/usage.ts)、[Cookbook](https://developers.openai.com/cookbook/examples/completions_usage_api)、[Costs API 参考](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs/) |
| 6 | 官方 Subscription/Plan API | **无**（API 账户无订阅） | [Admin APIs](https://developers.openai.com/api/docs/guides/admin-apis) |
| 7 | Rate Limit 从 Response Headers 返回 | **是**：`x-ratelimit-limit-requests` / `-remaining-requests` / `-limit-tokens` / `-remaining-tokens` 等 | [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits)、[社区确认](https://community.openai.com/t/how-to-get-rate-limit-reset-time-for-response-api/1268905) |
| 8 | 能否拿 Reset Time | **能**：`x-ratelimit-reset-requests` / `-reset-tokens`（秒数） | 同上 |
| 9 | 能否拿套餐名 | 不适用（无套餐） | — |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | Used：Usage/Cost API 可算（按日/模型）；Balance/Remaining：**无官方**；Reset：Rate Limit 头可拿 | 4/5/7 项来源 |
| 11 | 无官方接口时本地计算 | **能**：请求级 `usage{prompt_tokens,completion_tokens}` × 官方单价表可精确核算真实验花费 | [Pricing](https://developers.openai.com/api/docs/pricing) |
| 12 | 是否需要用户额外提供权限 | 需 OPENAI_API_KEY（DSH 未保存；用户当前无 OpenAI API Key）；**无法复用 OAuth**（API 与 ChatGPT 账号体系隔离，但同一 OpenAI 账号可生成） | 本机实测 |
| 13 | 公开 vs 私有 | 公开：Usage/Cost API、Rate Limit 头；私有：credit_grants 等 billing 网页接口 | 4/5/7 项来源 |
| 14 | 稳定性分级 | Usage/Cost API = **A**；Rate Limit 头 = **C**（公开接口返回但非契约）；credit_grants = **D** | — |

### 适配方案（10 项）

| 项 | 方案 |
|---|---|
| 可展示字段 | 本月/今日花费（Used+C 本地核算）、按模型 token 花费、Rate Limit 剩余与 Reset 倒计时 |
| 获取方法 | 官方 /v1/usage 或 /organization/usage/costs（A 级）；花费明细=本地 token×单价 |
| Endpoint | `GET https://api.openai.com/v1/usage`；`POST https://api.openai.com/v1/organization/usage/costs` |
| Auth | `Authorization: Bearer <admin 权限 OPENAI_API_KEY>`（个人 org owner 即 admin）+ `OpenAI-Organization` 头（多 org 时） |
| 请求示例（脱敏） | `GET /v1/usage?start_time=1724688000&end_time=1724774400&bucket_width=1d&group_by[]=model` |
| Response 示例（脱敏） | `{"data":[{"result":[{"aggregations":[{"bucket_width":"1d","model":"gpt-4o","n_requests":12,"n_tokens":345000}],"start_time":1724688000,"end_time":1724774400}]}], "has_more":false}`（字段以 SDK 类型为准） |
| 刷新频率建议 | Usage/Cost：1 次/小时（有延迟，非实时扣费）；Rate Limit 头：随每次请求一起捕获（免费） |
| 错误处理 | 401→提示 Key 无效/非 admin；403→提示需 Owner/Admin 角色（RBAC）；429→静默退避；404/接口变更→降级为仅本地 token 核算 |
| 安全风险 | Admin Key 权限极大（可查全 org 用量/成本，甚至改设置）→ 只读场景建议"Read-only Key"；私有关 credit_grants 接口有被拉黑风险，禁用 |
| 是否推荐正式集成 | **推荐（部分）**：官方 Usage/Cost API 为 A 级、稳定；但因用户当前无 OpenAI API Key，作为"能力就绪、待 Key"状态入版，不阻塞主流程；billingMode = **pay_as_you_go** |

---

## 2. ② openai-codex（Codex：OAuth / ChatGPT 账户路径）

### 14 项能力核查

| # | 问题 | 结论 | 来源 |
|---|---|---|---|
| 1 | DSH provider id | `openai-codex`（`displayName: ChatGPT`、`transport: sse`，`apiKeyEnv: OPENAI_CODEX_API_KEY`） | `~/.dsh/settings.yaml` |
| 2 | DSH 认证方式 | **OAuth（ChatGPT 账号）**：读 `~/.codex/auth.json` 的 `id_token`/`access_token`/`refresh_token`；`auth_mode=chatgpt` 时不需要任何 Key；`OPENAI_CODEX_API_KEY` 仅在 API-Key 模式使用 | 本机实测 + [Codex auth 文档](https://developers.openai.com/codex/auth/ci-cd-auth) |
| 3 | 消费方式 | **Coding Plan（含于 ChatGPT 订阅）**：Plus/Pro/Team 各档每周配额；2025 起叠加 **Credits 积分制**（月度重置）；也支持 Free Tier（免费额度） | [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)、[Codex rate card](https://help.openai.com/en/articles/20001106-codex-rate-card)、[Credits](https://help.openai.com/en/articles/12642688) |
| 4 | 官方 Balance API | **无**（订阅制无 balance 概念；剩余=配额/credits，走私有接口或头部） | [Codex Pricing](https://chatgpt.com/codex/pricing/) |
| 5 | 官方 Usage API | **无公开**；Codex CLI 自身轮询 `chatgpt.com/backend-api/wham/usage`（CLI 内部使用=非正式公开），社区已逆向 | [codex issue #10869](https://github.com/openai/codex/issues/10869)、[knightli Codex Usage Quota Check](https://knightli.com/en/2026/04/12/codex-usage-quota-check/)、[tokenuse.app](https://tokenuse.app/docs/development/tools/codex-subscription/) |
| 6 | 官方 Subscription/Plan API | 无公开 API；但 **OAuth id_token 的 JWT claims 直接含 plan_type**（本机实测 `chatgpt_plan_type=plus`）→ 解码即得，零请求 | 本机实测 + [codex issue #29243](https://github.com/openai/codex/issues/29243) |
| 7 | Rate Limit 从 Response Headers 返回 | **是（C 级）**：Responses API 对 ChatGPT 账号返回 `X-Codex-Plan-Type`（本机对应 plus）等头；标准 `x-ratelimit-*` 头字段名待核实 | [codex issue #29243](https://github.com/openai/codex/issues/29243)、[codex rate_limits.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/rate_limits.rs) |
| 8 | 能否拿 Reset Time | 部分能：`X-Codex-RateLimit-*` 类头含剩余/重置（字段名待核实）；订阅到期时间在 id_token（`subscription_active_until`，本机=2026-09-16）为精确 Expiration | 本机实测 + [pi-spark banked rate limits](https://github.com/zlliang/pi-spark/blob/main/docs/openai-codex-banked-rate-limit-resets.md) |
| 9 | 能否拿套餐名 | **能且零成本**：JWT claims `chatgpt_plan_type`（plus/pro/team/business…） | 本机实测 |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | Used/Remaining/Percentage：仅 wham/usage（D 级，社区逆向）或 CLI 每日消耗日志；Expiration：id_token 精确；Reset：配额周重置时间无公开字段 | [tokenuse.app](https://tokenuse.app/docs/development/tools/codex-subscription/)、[knightli](https://knightli.com/en/2026/04/12/codex-usage-quota-check/) |
| 11 | 无官方接口时本地计算 | **能（推荐主路径）**：每次请求 `usage` 字段 × Codex rate card 单价 → 显示"本会话/今日/本月真实花费"；订阅配额无法计费但可计数 | [Codex rate card](https://help.openai.com/en/articles/20001106-codex-rate-card)、[Pricing](https://developers.openai.com/codex/pricing) |
| 12 | 是否需要用户额外提供权限 | **不需要**：复用 `~/.codex/auth.json`（DSH/CLI 已保存），刷新由配套插件负责；禁止要求重复填 Key | 本机实测 |
| 13 | 公开 vs 私有 | 公开/标准：OAuth 登录、JWT（id_token 解码）；CLI 内部：wham/usage（私有，可随时变）；非文档化头：X-Codex-* | 5/6/7 项来源 |
| 14 | 稳定性分级 | id_token JWT claims = **B**（官方发布但非"面向第三方 UI"契约）；X-Codex 头 = **C**；wham/usage = **D** | — |

### 适配方案（10 项）

| 项 | 方案 |
|---|---|
| 可展示字段 | 套餐名（Plus/Pro/Team）、订阅到期倒计时、今日/本月/会话花费（本地核算）、配额剩余（D 级增强项，可关） |
| 获取方法 | ①主：解码 `~/.codex/auth.json` 的 id_token → plan_type + 到期时间；②次：本地 usage × 单价；③增强：wham/usage（默认关闭） |
| Endpoint | 无 HTTP 请求（主路径，纯本地文件）；增强：`https://chatgpt.com/backend-api/wham/usage`（D 级） |
| Auth | 主路径无；增强：`Authorization: Bearer <access_token from auth.json>`（脱敏；不落盘、不回显） |
| 请求示例（脱敏） | 主路径：解析 `~/.codex/auth.json` JWT payload 即可，无请求 |
| Response 示例（脱敏） | 主路径 JWT claims：`{"chatgpt_plan_type":"plus","chatgpt_subscription_active_until":"2026-09-16T08:26:46+00:00",…}`（真实字段，已脱敏账号信息） |
| 刷新频率建议 | 主路径：启动 + 每次刷新 UI 时重读 auth.json（last_refresh 变更即更新）；到期时间用系统时钟倒计时 |
| 错误处理 | auth.json 缺失/过期→显示"未绑定，请装配套插件"；JWT 解码失败→忽略该字段；增强接口 401→自动降级为本地核算 |
| 安全风险 | auth.json 含可调用 API 的 access_token（等同账号权限）→ 只读、永不复制、不在日志打印；OAuth token 泄露=账号风险（社区已警示） |
| 是否推荐正式集成 | **强烈推荐**：主路径零请求、纯本地、复用已保存凭据，完美契合"订阅识别"；JWT 解码为 B 级稳定；wham/usage 仅作默认关闭的增强项；billingMode = **subscription**（Coding Plan 含于订阅；Free Tier 时降级 handle） |

---

## 3. ③ ChatGPT Consumer 订阅（Plus/Pro/Business/Team；2025 起 Credits 积分制）

### 14 项能力核查

| # | 问题 | 结论 | 来源 |
|---|---|---|---|
| 1 | DSH provider id | 无独立 provider；经 `openai-codex`（OAuth）通道读取；绑定/刷新归配套插件 `dsh-chatgpt-subscription`（`codex-bind.json` 已 bound） | 本机实测 |
| 2 | DSH 认证方式 | 同 openai-codex：复用 `~/.codex/auth.json` OAuth | 本机实测 |
| 3 | 消费方式 | **Subscription**（按月订阅 Plus/Pro/Business/Team）+ **Credits 积分制**（2025 起：每月发放 Credits，月度重置，支持超额与涨价模型）；部分免费额度 | [help.openai Credits](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-plus-pro) |
| 4 | 官方 Balance API | 无公开；Credits 余额走网页私有接口（`/backend-api/accounts/check` 等，D 级） | [everything-chatgpt #9](https://github.com/terminalcommandnewsletter/everything-chatgpt/issues/9) |
| 5 | 官方 Usage API | 无公开；私有 `/backend-api/accounts/check`（含 plan/配额/credits 信息，社区逆向多年稳定字段） | 同上 + 社区项目（openusage/janekbaraniewski 等为 D 级佐证） |
| 6 | 官方 Subscription/Plan API | 无公开；**id_token JWT claims 直接含 plan_type 与订阅起止/最后核验时间**（本机实测 `last_checked` 在 token 内） | 本机实测 |
| 7 | Rate Limit 从 Response Headers | 部分：Codex/Responses 通道有 X-Codex-Plan-Type 头；普通 ChatGPT 网页无稳定头 | [codex issue #29243](https://github.com/openai/codex/issues/29243) |
| 8 | 能否拿 Reset Time | 订阅到期：id_token `subscription_active_until`（精确）；Credits 月度重置日期：无公开字段（待核实：重置日=账单日或自然月首日） | 本机实测 + [Credits 文档](https://help.openai.com/en/articles/12642688) |
| 9 | 能否拿套餐名 | **能且零成本**（JWT claims：plus/pro/business/team） | 本机实测 |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | Balance(Credits)：私有接口 D 级；Used：本地 token×单价可算真实花费；Expiration：JWT 精确；Percentage：无官方 | 4/5/6/8 项来源 |
| 11 | 无官方接口时本地计算 | **能**（主路径）：模型响应 usage × 官方单价 → 真实花费；订阅本身是固定月费，可在 UI 显示"月费已付"来中和"无限花费"焦虑 | [Rate card](https://help.openai.com/en/articles/20001106-codex-rate-card) |
| 12 | 是否需要用户额外提供权限 | **不需要**：复用 OAuth；配套插件已 bound（`codex-bind.json`） | 本机实测 |
| 13 | 公开 vs 私有 | 公开/标准：OAuth JWT；私有：accounts/check、wham/usage、billing 网页接口（全部禁用于默认路径） | 4/5/6 项来源 |
| 14 | 稳定性分级 | JWT claims = **B**；accounts/check = **D**（字段多年稳定但私有）；wham/usage = **D** | — |

### 适配方案（10 项）

| 项 | 方案 |
|---|---|
| 可展示字段 | 订阅套餐名、订阅到期日、Credits 月度周期提示（如"12 月 Credits 已重置"）、今日/本月本地核算花费 |
| 获取方法 | 主：JWT claims（plan_type、subscription_active_until、last_checked）；辅：本地 usage×单价；增强（关）私有接口查 Credits 余额 |
| Endpoint | 无（主路径本地）；增强：`https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27`（D 级，默认不启用） |
| Auth | 无（主路径）；增强：Bearer access_token（脱敏） |
| 请求示例（脱敏） | 无请求（JWT 本地解码） |
| Response 示例（脱敏） | `{"chatgpt_plan_type":"plus","chatgpt_subscription_active_start":"2026-08-16T08:26:46+00:00","chatgpt_subscription_active_until":"2026-09-16T08:26:46+00:00","chatgpt_subscription_last_checked":"2026-08-23T15:58:53Z"}`（本机实测，账号信息脱敏） |
| 刷新频率建议 | 启动与 UI 刷新时重读文件；到期日本地倒计时；last_checked 变化即刷新 |
| 错误处理 | 订阅已到期→显示"已过期"并引导续订；token 过期→提示"请通过配套插件重新登录"；无 token→"未绑定" |
| 安全风险 | 同上（token 即账号凭据）；Credits 私有接口避免触碰（被风控风险） |
| 是否推荐正式集成 | **推荐**：主路径纯本地+复用凭据，交付"套餐名+到期+真实花费"三项高价值字段；Credits 余额仅作后续增强（需配套插件或用户同意）；billingMode = **subscription** |

---

## 4. 推荐集成清单（汇总）

| 目标 | 推荐状态 | 展示字段 | 主路径 | billingMode |
|---|---|---|---|---|
| ① openai（API Key） | 能力就绪，待用户提供 Key | 花费、Rate Limit | Usage/Cost API（A）+本地核算 | pay_as_you_go |
| ② openai-codex（OAuth） | **强烈推荐，立即集成** | 套餐名、到期倒计时、花费 | JWT 本地解码（B）+本地核算 | subscription（含 coding_plan） |
| ③ ChatGPT Consumer | 推荐（并入 openai-codex 通道） | 套餐名、到期、月份花费 | JWT 本地解码 | subscription |
| Credits 余额（②③增强） | 暂缓（默认关闭） | 配额/Credits 剩余 | wham/usage（D，需配套插件协作） | — |

**优先级建议**：v1.7 先做 ②（本机 Plus 已绑定，可立即验收）→ 复用同一 JWT 机制覆盖 ③ → ① 留待用户拿到 OpenAI API Key；Credits 实时余额列为路线图增强项。

---

## 5. 重点来源清单

- [OpenAI Usage/Cost API（Admin）](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs/)｜[Cookbook 用法](https://developers.openai.com/cookbook/examples/completions_usage_api)｜[openai-node usage.ts](https://github.com/openai/openai-node/blob/master/src/resources/admin/organization/usage.ts)
- [Rate limits 文档](https://developers.openai.com/api/docs/guides/rate-limits)｜[社区：reset 时间](https://community.openai.com/t/how-to-get-rate-limit-reset-time-for-response-api/1268905)
- [针对 ChatGPT 的 Credits 积分制（2025 起）](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-plus-pro)
- [用 ChatGPT 计划使用 Codex](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)｜[Codex rate card](https://help.openai.com/en/articles/20001106-codex-rate-card)｜[Codex Pricing](https://chatgpt.com/codex/pricing/)
- [Codex 订阅配额逆向：tokenuse.app](https://tokenuse.app/docs/development/tools/codex-subscription/)｜[knightli 配额检查](https://knightli.com/en/2026/04/12/codex-usage-quota-check/)｜[wham/usage 讨论](https://github.com/openai/codex/issues/10869)
- [X-Codex-Plan-Type 头](https://github.com/openai/codex/issues/29243)｜[rate_limits.rs](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/rate_limits.rs)｜[banked rate limit resets](https://github.com/zlliang/pi-spark/blob/main/docs/openai-codex-banked-rate-limit-resets.md)
- [accounts/check 逆向讨论](https://github.com/terminalcommandnewsletter/everything-chatgpt/issues/9)｜[用 OAuth token 当后端的风险分析](https://gist.github.com/ravidsrk/4e72b774c044917cd260560ec5831e1d)
- [预付费计费说明](https://help.openai.com/en/articles/8264644-how-can-i-set-up-prepaid-billing)｜[Admin/RBAC](https://developers.openai.com/api/docs/guides/admin-apis)｜[CI/CD auth（auth.json 维护）](https://developers.openai.com/codex/auth/ci-cd-auth)

**待核实清单**：① openai-codex 通道确切 rate-limit 头名（X-Codex-RateLimit-* 字段）；② Credits 月度重置的具体日期规则（账单日 vs 自然月）；③ wham/usage 响应 schema（社区逆向，随 CLI 版本演进）；④ `OPENAI_CODEX_API_KEY` 在 DSH 中是否走纯 API-Key 模式（无 OAuth）——需读 DSH 源码确认（不影响结论：OAuth 主路径已实测可用）。