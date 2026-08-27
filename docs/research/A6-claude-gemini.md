# A6 调研报告：Anthropic Claude × Google Gemini 适配可行性

**生成日期**: 2025-08-27
**用途**: DSH Bottom Info Bar 插件对 Anthropic / Google Gemini 的余额·用量展示适配依据
**可信度标识**: 🟢 官方文档 / 🔵 社区逆向（多项目交叉验证）/ 🟡 待核实
**稳定性分级**: A=官方文档化长期稳定 · B=官方但受限（组织/Admin 权限）· C=社区逆向可持续 · D=脆弱/未文档化/依赖本地登录态 · E=该能力不存在

---

## 0. 总览

| 平台 | DSH provider | 计费模式 | 余额/用量读取 | 稳定性 | 推荐 |
|---|---|---|---|---|---|
| Claude（API Key） | `anthropic` | 预充值 Credits | ❌ 官方无余额 API，只能本地 usage×价格 | 余额 E / usage 字段 A | ⚠️ 部分集成 |
| Claude Pro/Max（订阅） | `anthropic` (OAuth) | 订阅周/月额度 | 🔵 逆向 `/api/oauth/usage`（本地登录态） | C（脆弱） | ⚠️ 可选增强 |
| Gemini Developer（AI Studio） | `google` | Free / PAYG | ❌ 无余额 API；usageMetadata 响应内建 | 余额 E / usage A | ⚠️ 部分集成 |
| Gemini CLI / Code Assist | （未接入 DSH） | OAuth 开发者额度 | ❌ 无任何 usage/配额 API（服务端算） | E | ❌ 不集成 |
| Vertex AI | `google-vertex` | Cloud Billing PAYG | getBillingInfo 无金额；费用需 BigQuery/costDetails | B/D | ❌ 暂不集成 |

**DSH 内置凭据名（源码确认）**: `ANTHROPIC_API_KEY` · `ANTHROPIC_OAUTH_TOKEN` · `ANTHROPIC_AUTH_TOKEN` · `GEMINI_API_KEY` · `GOOGLE_CLOUD_API_KEY`（Vertex，另支持 ADC）。`GOOGLE_API_KEY` 是 Google 官方 SDK(@google/genai) 的备用名——若与 `GEMINI_API_KEY` 同时设置 SDK 优先用前者；pi-ai 的 google provider 实际只读 `GEMINI_API_KEY`。
来源: [pi-ai env-api-keys.js](https://github.com/earendil-works/pi-ai/blob/main/src/env-api-keys.ts)（DSH 本地 node_modules 同源）

**本机现状**: `~/.claude/` 存在但为空（无 `.credentials.json`），`~/.claude.json` 不存在 → 本机无 Claude Code 订阅登录态；`~/.gemini` 不存在。Codex 登录态存在但不在本次范围。

---

## 一、Anthropic Claude

### 1.1 十四项事实核查

| # | 项目 | 结论 | 来源 |
|---|---|---|---|
| 1 | DSH provider id | `anthropic`（baseUrl `https://api.anthropic.com`，Messages API） | [pi-ai providers/anthropic.ts](https://github.com/earendil-works/pi-ai/blob/main/src/providers/anthropic.ts) |
| 2 | DSH 认证方式 | `ANTHROPIC_API_KEY`（apiKey）优先；`ANTHROPIC_OAUTH_TOKEN` / `ANTHROPIC_AUTH_TOKEN` 兜底；OAuth 用于 Pro/Max 订阅 | 同上 |
| 3 | 消费方式 | ① API Key=预充值 Credits ② Pro/Max=订阅（5h 会话+7 天周额度，Max 另有 Overage 按量）③ Claude Code=订阅 OAuth，限制为会话/周额度 | [Use Claude Code with Pro/Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan) |
| 4 | 官方 Balance API | ❌ **无**。社区多次请求被拒/未实现 | [anthropic-sdk-python #505](https://github.com/anthropics/anthropic-sdk-python/issues/505)、[claude-code #26937](https://github.com/anthropics/claude-code/issues/26937) |
| 5 | 官方 Usage API | ⚠️ 部分：Usage & Cost **Admin API**（`/v1/organizations/usage_report/messages` + `/cost_report`），**仅组织账户 + Admin API key（sk-ant-admin01…）**，个人账户不可用 | [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) |
| 6 | 官方 Subscription/Plan API | ❌ 无公开 API。逆向 OAuth profile 端点的 blob 内含 `subscriptionType`/`rateLimitTier`（🔵） | [claude-meter oauth.rs](https://github.com/m13v/claude-meter/blob/main/src/oauth.rs) |
| 7 | Rate Limit 返回方式 | 🟢 429 带 `retry-after` 头（速率限制命中时）；**spend cap 命中时 429 无 retry-after**，`error.details.error_code=enforced_spend_limit_reached`；命中自定义额度时为 400 | [Rate limits](https://platform.claude.com/docs/en/api/rate-limits)、[API errors](https://platform.claude.com/docs/en/api/errors) |
| 8 | Reset Time | ❌ 无固定重置窗口——token bucket 算法连续补充（组织级 RPM/ITPM/OTPM）；月 spend cap 在每月 1 日 00:00 UTC 重置 | [Rate limits](https://platform.claude.com/docs/en/api/rate-limits) |
| 9 | 套餐名 | API tier: Start / Build / Scale（月 spend cap）；订阅: Pro / Max；OAuth blob: `subscriptionType`=pro/max，`rateLimitTier`=default_claude_max_5x/20x 等 | 同上 + [claude-meter](https://github.com/m13v/claude-meter) |
| 10 | Balance/Used/… 字段 | 官方无。逆向 usage 端点返回 `five_hour`/`seven_day`/`seven_day_sonnet`/`seven_day_opus`/… 各 `{utilization, resets_at}`（**只有百分比+重置时间，无绝对额度**）+ `extra_usage{monthly_limit, used_credits, utilization}` | [claudeops-tui oauth-usage-endpoint.md](https://github.com/FullFran/claudeops-tui/blob/main/docs/oauth-usage-endpoint.md) |
| 11 | 无接口时本地计算 | ✅ Messages 响应 `usage{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` × 官方单价可行（🟢 官方字段） | [Messages API docs](https://platform.claude.com/docs/en/api/messages) |
| 12 | 用户额外权限 | 复用 `ANTHROPIC_API_KEY` 零额外；Admin API 需用户建组织+Admin key（不默认）；Claude Code 逆向仅**只读**本地登录态，禁止重复填 Key | 本文档 §1.3 |
| 13 | 公开官方 vs 网页私有 | 官方: Messages API/Admin API。私有/逆向: `api.anthropic.com/api/oauth/usage`（Claude Code `/usage` 内部端点，**未文档化**）、`console.anthropic.com/v1/oauth/token` | [claudeops-tui](https://github.com/FullFran/claudeops-tui/blob/main/docs/oauth-usage-endpoint.md) |
| 14 | 稳定性分级 | 官方 usage 字段 A；Admin API B（组织限定）；逆向 oauth/usage **C**（见 §1.3 详细标注）；余额 API **E** | 本文档 |

### 1.2 Claude Code 周额度逆向方案（重点）——稳定性标注

**方案链路**: 读本地 OAuth 凭据 → 调 `/api/oauth/usage` 拿各窗口 utilization%。

| 环节 | 细节 | 稳定性评估 |
|---|---|---|
| 凭据位置（macOS） | macOS Keychain，服务名 `Claude Code-credentials`；`security find-generic-password -s "Claude Code-credentials" -w` 读取 | 🔵 已由 [claude-meter](https://github.com/m13v/claude-meter/blob/main/src/oauth.rs) 验证；依赖 `claude` CLI 已登录 |
| 凭据位置（Linux/WSL） | `~/.claude/.credentials.json`（mode 0600），JSON 内含 `claudeAiOauth{accessToken, refreshToken, expiresAt(ms), scopes, subscriptionType, rateLimitTier}` | 🔵 [claudeops-tui](https://github.com/FullFran/claudeops-tui/blob/main/docs/oauth-usage-endpoint.md) + [claude-code #47661](https://github.com/anthropics/claude-code/issues/47661)（无 Keychain 平台） |
| usage 端点 | `GET https://api.anthropic.com/api/oauth/usage`，Headers: `Authorization: Bearer <accessToken>` + `anthropic-beta: oauth-2025-04-20` | 🔵 两独立项目交叉验证；**端点未文档化，属必须容忍的脆弱点** |
| 响应 | `{five_hour, seven_day, seven_day_sonnet, seven_day_opus, seven_day_oauth_apps, seven_day_omelette, seven_day_cowork}` 各 `{utilization(0–100), resets_at(RFC3339)}`，任一项可为 null；`extra_usage{is_enabled, monthly_limit, used_credits}` | 🟡 百分比语义在两项目表述略有差异，落地需实测 |
| token 过期 | accessToken 按 `expiresAt` 过期；过期后可 `POST console.anthropic.com/v1/oauth/token`（grant_type=refresh_token）刷新，或等 Claude Code CLI 自己刷新 | ⚠️ claude-meter 明确**不实现刷新**（依赖 CLI 运行）；claudeops-tui 实现刷新但要求严谨的加锁/回写流程——写回他人密钥文件风险高 |
| 数值可信度 | 🔵 [claude-code #87419](https://github.com/anthropics/claude-code/issues/87419)：Max 周计量自 8/17 起按 1.7–5x 速率消耗，utilization 本身可能失真 | ⚠️ 展示时标注"约值"更稳妥 |

**综合稳定性: 🔵 C 级（可用但脆弱）**。理由：两项目交叉验证、端点长期存在、只读成本低；但未文档化、依赖用户已登录订阅、token 过期机制（刷新在多 OS 上行为不同）、计量数值有已知 bug。**方案**: 探测到凭据才启用该模式（macOS Keychain 可用时）；任何失败静默降级为"无接口"模式，绝不阻塞主流程。

### 1.3 Claude 适配方案（10 项）

1. **可展示字段**: `billingMode` 判定（pay_as_you_go / subscription / 无接口）+ 实测花费（会话/今日/本月/累计）；订阅态另加 `utilization%`（5h / 7d）+ `resets_at` + subscriptionType+rateLimitTier 徽标
2. **获取方法**: ① API Key 模式：拦截 Messages 响应 usage → 本地累计（本插件已有框架）；② 订阅模式：Claude Code 本地凭据 → usage 端点
3. **Endpoint**: 官方 `https://api.anthropic.com`（业务）；逆向 `GET /api/oauth/usage`（仅订阅模式）
4. **Auth**: 官方 `x-api-key: $ANTHROPIC_API_KEY`；逆向 `Authorization: Bearer <oat token>`（macOS 走 `security` 命令，Linux 读 0600 文件）
5. **请求示例**: `curl https://api.anthropic.com/v1/messages -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -d '{...}'`；逆向: `curl https://api.anthropic.com/api/oauth/usage -H "Authorization: Bearer sk-ant-oat01-…" -H "anthropic-beta: oauth-2025-04-20"`
6. **Response 示例（脱敏）**: `{"five_hour":{"utilization":6.0,"resets_at":"2026-04-08T18:59:59Z"},"seven_day":{"utilization":35.0,...},"seven_day_opus":{"utilization":12.0,...},"extra_usage":{"is_enabled":false,"monthly_limit":100.0,"used_credits":12.5,"utilization":12.5,"currency":"USD"}}`（来源: claudeops-tui 示例，脱敏）
7. **刷新频率**: 花费=每次响应实时累计；usage 端点建议 5–10 min/次（注意 429 退避，参考 claudeops-tui 默认 300s 缓存）
8. **错误处理**: 429 读 `retry-after` 退避；`enforced_spend_limit_reached` → 显示"月度额度已耗尽，下月 1 日恢复"；逆向 401 → 判定凭据失效，降级"无接口"；`seven_day` 为 null → 隐藏对应字段
9. **安全风险**: 🔴 逆向凭据属**令牌机密**：只读、绝不写回（除非实现完整刷新流程并加锁，默认不做）；macOS `security` 输出不得落日志；`~/.claude/.credentials.json` 读取需保持 0600 权限不修改；Key 复用 DSH 环境变量，不新增存储
10. **是否推荐**: ⚠️ **有条件集成**。API Key 模式（无余额、token×价格本地累计）✅ 推荐（成本可控、零额外权限）；订阅逆向模式作为**可选增强**（探测到本地登录态才启用），稳定性 C 级须做静默降级。`billingMode`: `pay_as_you_go`（API Key）/ `subscription`（OAuth）/ `无接口`（两者皆无时）

---

## 二、Google Gemini

### 2.1 十四项事实核查

| # | 项目 | 结论 | 来源 |
|---|---|---|---|
| 1 | DSH provider id | `google`（baseUrl `https://generativelanguage.googleapis.com/v1beta`）；`google-vertex`（Vertex） | [pi-ai providers/google.ts & google-vertex.ts](https://github.com/earendil-works/pi-ai/tree/main/src/providers) |
| 2 | DSH 认证方式 | `google`: `GEMINI_API_KEY`；`google-vertex`: `GOOGLE_CLOUD_API_KEY` 或 ADC（`~/.config/gcloud/application_default_credentials.json`）+ `GOOGLE_CLOUD_PROJECT/LOCATION` | 同上 |
| 3 | 消费方式 | ① Developer API: Free tier / Pay-as-you-go（AI Studio Key，绑定 billing）② Vertex AI: Cloud Billing PAYG ③ Gemini CLI/Code Assist: OAuth 开发者每日请求额度 | [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| 4 | 官方 Balance API | ❌ **无**（AI Studio Key 无余额概念；PAYG 无查询余额接口） | 官方文档无此能力（🟢 确认缺失） |
| 5 | 官方 Usage API | ❌ Developer API 无账号级用量汇总 API；费用/用量只有 **Vertex/Cloud Billing** 路线（BigQuery export） | [Export billing to BigQuery](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery) |
| 6 | 官方 Subscription/Plan API | ❌ 无公共 API。Gemini 个人订阅（AI Pro/Ultra）额度在网页/服务端，无查询端点 | 🟡 经检索未见任何官方/逆向方案 |
| 7 | Rate Limit 返回方式 | 429 响应体 `RESOURCE_EXHAUSTED`；RPD 按 project 计；**无文档化 rate-limit 响应头**（与 Claude 不同） | [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)、[Troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting) |
| 8 | Reset Time | RPD 于**午夜 Pacific 时间重置**；RPM/TPM 滚动窗口；spend-based 限额为 10 分钟滚动窗口 | [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) |
| 9 | 套餐名 | usage tier: Free / Tier 1 / Tier 2 / Tier 3（按累计消费升级，billing cap $250/$2,000/$2 万–10 万+） | [Rate limits#usage-tiers](https://ai.google.dev/gemini-api/docs/rate-limits#usage-tiers) |
| 10 | Balance/Used/… 字段 | Developer API 无。*率限*页（AI Studio）可按 28 天查看，非 API；Vertex 的 `getBillingInfo` 仅返回 `billingEnabled/billingAccountName`，**无金额** | [projects.getBillingInfo](https://docs.cloud.google.com/billing/docs/reference/rest/v1/projects/getBillingInfo) |
| 11 | 无接口时本地计算 | ✅ **usageMetadata 随每个响应输出**（🟢 官方字段）：`promptTokenCount, cachedContentTokenCount, candidatesTokenCount, thoughtsTokenCount, totalTokenCount, serviceTier` → × 官方定价即可；免费层需标记"无费用概念" | [generate-content UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata) |
| 12 | 用户额外权限 | Developer API: 复用 `GEMINI_API_KEY` 零额外；Vertex 费用: 需 BigQuery export 配置或 costDetails 权限（超出 DSH 现成凭据，需用户额外操作）；Gemini CLI: 只读本地 OAuth（若存在）但无配额可查 | 本文档 |
| 13 | 公开官方 vs 网页私有 | 官方: generateContent 等 REST API；网页私有: AI Studio rate-limit 页面、Cloud Console 账单页；Gemini CLI OAuth 配额为服务端计算，**无任何 API 可读**（🟡 待核实是否有隐藏端点，社区未见逆向） | 本文档 §2.2 |
| 14 | 稳定性分级 | usageMetadata A；Tier/限额文档 B（官方但需 AI Studio 页面，非 API）；Gemini CLI 配额查询 E；Developer 余额 E | 本文档 |

### 2.2 Gemini CLI / Code Assist 专项

- 额度（🟢 官方文档）: Google 账号 Code Assist Individual **1,000 req/day**；AI Pro 1,500/天；AI Ultra 2,000/天；Workspace Standard 1,500/Enterprise 2,000/天；**API Key 免费层 250 req/day 且仅 Flash**（Gemini CLI 用 API key 登录时） | [gemini-cli quota-and-pricing.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/quota-and-pricing.md)、[Code Assist quotas](https://developers.google.com/gemini-code-assist/resources/quotas)
- **本地登录态**: Gemini CLI 凭据存于用户配置（本机 `~/.gemini` 不存在；🟡 具体路径待核实）；**即便读到 OAuth token，也无 usage/余额端点可调**——额度在服务端按 Google 账号实时计算，Cli 仅在 429 时感知
- **结论**: ❌ **不集成 Gemini CLI OAuth 模式**——无任何可读配额接口（稳定性 E），且要求用户已安装 Gemini CLI 并登录。与 Claude Code 逆向（有真实 usage 端点）本质不同。

### 2.3 Gemini 适配方案（10 项）

1. **可展示字段**: `billingMode`（free_tier / pay_as_you_go / cloud_billing）+ 实测花费（usageMetadata 累计×单价）；Free 层显示"免费层·无余额概念"而非金额；可显示 usage tier 徽标（来自 AI Studio 页，非 API，默认不取）
2. **获取方法**: 拦截 generateContent 响应体 `usageMetadata` → 本地累计（免费层只记 token，不换算金额）
3. **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`（业务，非查询接口——查询无可用端点）
4. **Auth**: `x-goog-api-key: $GEMINI_API_KEY`（DSH google provider 即此）
5. **请求示例**: `curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" -H "x-goog-api-key: $GEMINI_API_KEY" -d '{"contents":[{"parts":[{"text":"hi"}]}]}'`
6. **Response 示例（脱敏）**: `{"candidates":[…],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":5,"totalTokenCount":8,"serviceTier":"flex"},"modelVersion":"gemini-2.5-flash"}`（脱敏，字段取自官方 UsageMetadata 定义）
7. **刷新频率**: 每个响应用量实时累计入本地记录；无定时查询（无接口可查）
8. **错误处理**: 429 `RESOURCE_EXHAUSTED` → 显示"已达速率限制（RPD 午夜 PT 重置）"，指数退避；403 → 提示校验 Key/计费状态；免费层 429 提示"升级 tier"；不把 429 当花费
9. **安全风险**: 仅复用 DSH `GEMINI_API_KEY`，无新增密钥存储；不读取/不解析 Gemini CLI OAuth 凭据（无收益且有泄漏面）；Vertex 费用方案涉及 GCP 高权限读取 API，默认不做，避免放大攻击面
10. **是否推荐**: ⚠️ **部分集成**。免费/付费 Developer API 的**本地花费统计**（usageMetadata×价格）✅ 推荐，零额外权限、官方字段稳定；余额/配额展示 ❌ **不提供**（官方能力不存在）；Vertex 累计费用 ❌ 暂不集成（需 BigQuery export 或 costDetails 等额外配置，收益/成本比低，列入 roadmap 远期）。`billingMode`: `free_tier`（未绑计费）/ `pay_as_you_go`（绑计费）/ `cloud_billing`（Vertex，本次不落地）

### 1.4 运行期判定流程（工程视图）

```
启动 → 读 DSH 会话 provider
  ├─ anthropic 且 API Key 来源（ANTHROPIC_API_KEY）→ billingMode=pay_as_you_go，启用 usage×价格累计
  ├─ anthropic 且 OAuth 来源（ANTHROPIC_OAUTH_TOKEN / 订阅登录）→ 附加订阅探测器：
  │     macOS: `security find-generic-password -s "Claude Code-credentials" -w` → 解析 claudeAiOauth
  │     Linux: 存在 ~/.claude/.credentials.json（0600）→ 解析同结构
  │     ├─ 命中 → billingMode=subscription（复用读到的 accessToken 调 /api/oauth/usage）
  │     └─ 未命中/401/过期 → 降级 billingMode=subscription(无接口)，显示"已登录但额度不可读"
  └─ google → billingMode=free_tier 或 pay_as_you_go（用户开关「已绑定计费」），启用 usageMetadata×价格累计
```

补充（🔵 claude-meter models.rs 中 OAuth blob 可得的补充字段，便于展示）:
- `OverageResponse{is_enabled, monthly_credit_limit, currency, used_credits, disabled_reason, disabled_until, out_of_credits}` → Max 套餐 Overage 额度
- `SubscriptionResponse{status, next_charge_date, billing_interval, payment_method{brand,last4,kind}, currency}` → 订阅续费信息（🔴 含卡尾号，展示时**必须脱敏仅显示品牌+尾号**或隐藏）

### 2.4 免费层 vs 付费层判定与展示规则

- **判定**: 服务端按 project 的 usage tier 自动升级，插件无法通过 API 查询当前 tier（AI Studio 页面才能看）。可靠做法：由用户在插件设置中声明「已绑定计费账号」（或检测到 429 提示后引导），插件据此选择展示"免费层·不计费"或"按量·计费中"；`usageMetadata.serviceTier`（如 "flex"/"standard"）🟡 可作为旁证，但非 tier 判定的依据。
- **展示规则**: free_tier 只显示 token 花费估算「=0（免费层）」与速率上下文；pay_as_you_go 显示 usage×单价累计。**不虚构余额**——两大厂商任何模式都没有余额来源。
- **具体 RPM/TPM/RPD 数值**: 官方文档明确"限制随 tier/账号状态自动变化，实际容量不保证，以 [AI Studio 页面](https://aistudio.google.com/rate-limit?timeRange=last-28-days) 为准"，因此**不在插件内硬编码限额表**——若有展示额度需求，只能提示用户查看页面（🟡 社区旧例如 gemini-2.0-flash free 曾为 ~10 RPM / 1,500 RPD，数字随模型版本变化，不采信为当前值） | [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)

---

## 三、推荐集成清单（快照）

| 优先级 | 能力 | 依据 | 工作量 |
|---|---|---|---|
| P1 ✅ | Claude API Key: 花费=usage×价格（billingMode=pay_as_you_go） | usage 字段官方稳定；复用现有凭据 | 小（沿用现架构） |
| P1 ✅ | Gemini: 花费=usageMetadata×价格（free_tier/pay_as_you_go 判定: 是否绑定计费由用户自由开关） | usageMetadata 官方稳定 | 小 |
| P2 ⚠️ | Claude 订阅逆向: utilization%（探测到本地登录态才启用，静默降级） | 稳定性 C，需锁周期+降级 | 中 |
| P3 ❌ | Gemini CLI OAuth 配额 | 无接口可读（E） | — |
| P3 ❌ | Anthropic Admin Usage API | 仅组织账户，个人不可用（B） | — |
| P3 ❌ | Vertex 累计费用 | 需 GCP 额外权限（B/D），远期 | — |

**关键现实约束**: ① 两大厂商对"个人开发者 API 额度/余额"均无官方查询接口——Claude 已确认无公开 Balance API，Gemini Developer API 无账号用量 API；② 唯一可行的订阅额度展示是 Claude Code 逆向 `/api/oauth/usage`（仅 Claude 订阅，Gemini 无对应物）；③ 本插件本地 usage×价格累计方案对两家均成立且全部使用官方字段。

---

## 四、来源清单

- Anthropic: [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) · [Rate limits](https://platform.claude.com/docs/en/api/rate-limits) · [API errors](https://platform.claude.com/docs/en/api/errors) · [Messages API](https://platform.claude.com/docs/en/api/messages) · [Claude Code + Pro/Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)
- Claude 逆向: [m13v/claude-meter](https://github.com/m13v/claude-meter)（oauth.rs / models.rs）· [FullFran/claudeops-tui oauth-usage-endpoint.md](https://github.com/FullFran/claudeops-tui/blob/main/docs/oauth-usage-endpoint.md) · [claude-code #87419（计量 bug）](https://github.com/anthropics/claude-code/issues/87419) · [claude-code #47661（Linux 凭据）](https://github.com/anthropics/claude-code/issues/47661) · [#505 balance 请求](https://github.com/anthropics/anthropic-sdk-python/issues/505) · [#26937 balance 请求](https://github.com/anthropics/claude-code/issues/26937)
- Gemini: [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) · [Pricing](https://ai.google.dev/gemini-api/docs/pricing) · [generate-content UsageMetadata](https://ai.google.dev/api/generate-content#UsageMetadata) · [Troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting) · [gemini-cli quota-and-pricing.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/quota-and-pricing.md) · [Code Assist quotas](https://developers.google.com/gemini-code-assist/resources/quotas)
- Vertex/Cloud: [projects.getBillingInfo](https://docs.cloud.google.com/billing/docs/reference/rest/v1/projects/getBillingInfo) · [Export billing to BigQuery](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery)
- DSH 本地实现: `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/`（providers/anthropic.ts, google.ts, google-vertex.ts, env-api-keys.ts）