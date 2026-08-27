# A8 调研：Meta Llama 承载生态 + OpenRouter + Groq/Together/Fireworks/Cerebras/HF 适配可行性

**生成日期**: 2026-08-27（本会话）
**任务书**: A8-llama-openrouter-inference（"Llama 生态 + OpenRouter + 推理平台"在 DSH Bottom Info Bar 插件的余额/用量/限额查询适配调研）
**可信度标识**: 🟢 官方文档 / 🔵 社区交叉验证 / 🟡 待核实
**方法**: 仅本 Agent 直接调研（未用子 Agent/工作流）；无密钥环境 → 所有样例均脱敏；未实测的字段标"待核实"

---

## 0. 结论摘要（给主 Agent）

| 平台 | 稳定性 | 有无官方 Balance API | 有无官方 Usage API | 是否推荐正式集成 |
|---|---|---|---|---|
| **OpenRouter** | **A** | ✅ `GET /api/v1/credits` | ⚠️ 无历史用量汇总 API（`GET /api/v1/key` 可看剩余） | **✅ 优先（已立项，v1.6 T4）** |
| **Together** | **B** | ❌ 无公开 | ✅ `GET /billing/usage`（月用量+美元成本） | ✅ 次优（显示"本月已用"，非余额） |
| **Fireworks** | **B** | ❌ 无公开（余额为网页） | ✅ `GET /v1/accounts/{id}/billingUsage` + `POST /usageCosts:query` + `GET /billing/summary` | ✅ 次优（需先解析 account_id） |
| **Groq** | **B** | ❌ 无 | ❌ 无 | ⚠️ 仅 rate-limit headers（免费额度/速率展示） |
| **Cerebras** | **C** | ❌ 无（仅网页 Cloud Console） | ❌ 无（仅网页 CSV 导出） | ⚠️ 暂不 |
| **HuggingFace** | **C** | ❌ 无（credits 网页化管理） | ❌ 无 | ⚠️ 暂不 |
| **Meta Llama 直连** | — | 不适用 | 不适用 | ❌ Meta 不提供商业托管 API |

**核心判断**：
1. **Llama 是模型不是平台**。用户调 Llama 时，钱花在哪、余额在哪，全看**承载平台**（见 §1 对照表），与 Meta 无关。
2. OpenRouter 是**唯一"一类直达、官方公开、持续稳定"的余额 API**（A 级），且 DSH 已内置 `OPENROUTER_API_KEY`，复用即可，无需用户再填 Key —— **正式集成无悬念**。
3. Together / Fireworks 有官方 **Usage（用量/花费）API** 但**没有余额 API**：适合显示"本月/本周期已花费 $X"，不适合显示"余额还剩多少"。
4. Groq 靠 **Response Headers** 暴露 4 维速率限额（社区已验证），可做"速率/免费层"展示，无余额概念（后付费）。
5. Cerebras / HuggingFace 目前**只有网页**（Cloud Console / settings），无公开 API —— 集成成本高、易碎，暂不接入。

---

## 1. Meta Llama 承载生态（原则 + 查哪家账户对照表）

### 1.1 原则说明

- Meta Llama 是 Meta 发布的开源权重模型家族（Llama 3/3.1/3.2/3.3、Llama 4 等），**Meta 不按模型向开发者卖 API**（Llama 权重免费下载；Meta AI 是 C 端聊天产品；企业合作走 NVIDIA/AWS/Azure/Google 等渠道）。
- 开发者实际调用 Llama 的入口是**第三方承载平台**：Groq、Together、Fireworks、Cerebras、NVIDIA NIM、Hugging Face Inference Providers、OpenRouter 以及 AWS Bedrock / Google Vertex / Azure AI 等云平台。
- **因此"Llama 余额/用量查询" = "查询承载平台的账户"**。哪个平台提供服务、API Key 属于哪个平台，就查哪个平台的账户；计费单位、余额形态（预付费 credits / 后付费账单 / 订阅）也由平台决定，与模型作者无关。
- 对本插件的影响：**多 Llama 承载平台 ≠ 多 Meta 接口**；而是复用本项目已按 DSH provider 划分的账户映射表（`accountForProvider`，见 tasks.md T1），把 Llama 请求路由到对应承载平台的余额卡片。

### 1.2 承载平台 → 查哪家账户对照表

| 调 Llama 的入口（承载平台） | 计费对象 | 余额/用量在哪查 | 查询手段与等级 |
|---|---|---|---|
| Groq | Groq 账户（后付费，按用量月结） | Groq Console（网页） | ④ headers 速率；余额❌（见 §3） |
| Together | Together 组织账户（预付费 credits） | api.together.ai 计费页（网页） | `GET /billing/usage` 🟢（见 §4） |
| Fireworks | Fireworks 账户（预付费 credits） | app.fireworks.ai 计费页（网页） | `GET /billingUsage` / `billing/summary` 🟢（见 §5） |
| Cerebras | Cerebras 账户（PayGo credits，1 年过期） | Cloud Console Billing（网页） | 仅网页 ❌（见 §6） |
| Hugging Face Inference Providers | HF 账户（credits，月赠） | huggingface.co/settings/billing（网页） | 仅网页 ❌（见 §7） |
| NVIDIA（build.nvidia.com） | NVIDIA 账户 | 待核实（NVIDIA 有 API key + 账户体系） | 🟡 待核实，未在本轮范围 |
| **OpenRouter** | OpenRouter credits（或 BYOK 直连底层平台） | 用户 OpenRouter 账户 | `GET /api/v1/credits` 🟢 **A 级**（见 §2） |
| AWS Bedrock / GCP Vertex / Azure | 云平台账单账户（按云账单计费，非 API key 计费） | 各云平台 Billing 控制台 | 云计费维度，与本插件"API key 余额"模型不匹配，另案 |
| ~~Meta 直连~~ | 不适用 | 不适用 | Meta 不提供商业托管 API；§无结论 |

> 云平台（Bedrock/Vertex/Azure）属于"云账单"计费，DSH 的 provider 认证是 API key，二者天然不对齐 —— 建议本轮不集成，标注"另案"。

---

## 2. OpenRouter（aggregator，credits 预付费）— **A 级**

### 2.1 14 项核查表

| # | 项 | 结论 |
|---|---|---|
| 1 | DSH provider id | `openrouter`（pi-ai `dist/providers/openrouter.js`，baseUrl `https://openrouter.ai/api/v1`）🟢 |
| 2 | DSH 认证方式 | API Key `OPENROUTER_API_KEY`（envApiKeyAuth）+ OAuth（`Sign in with OpenRouter`，lazyOAuth）🟢 |
| 3 | 消费方式 | 预付费 **Credits，永不过期**；另支持 BYOK（自带 provider key，费用走对应 provider 账户）🟢 [credits][byok] |
| 4 | 官方 Balance API | ✅ `GET https://openrouter.ai/api/v1/credits` → `{ "data": { "credits": <USD> } }` 🟢 [credits-api] |
| 5 | 官方 Usage API | ⚠️ 无"历史用量汇总"公开 API；`GET /api/v1/key` 返回该 key 的 `limit`/`limit_remaining`/`limit_reset`（余额视角）🟢 [limits][current-key]；Observability 用量面板为网页私有 API 🟡 |
| 6 | 官方 Subscription/Plan API | ❌ 无订阅；仅 credits 充值 + BYOK + Workspace Budgets（组织级预算，网页配置）🟢 [byok] |
| 7 | Rate Limit 从 Response Headers 返回 | ✅ 429 错误响应带 `X-RateLimit-*` headers（limit/remaining/reset）；正常 200 是否带待核实 🟢[limits]🟡 |
| 8 | Reset Time | `limit_reset` 字段（key 级）；rate-limit reset 在 `X-RateLimit-Reset-*` header 🟢[limits] |
| 9 | 套餐名 | 无套餐名概念（aggregator；BYOK 按 provider 计费）🟢 |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | Balance：✅ `credits`；Remaining（key 额度）：✅ `limit_remaining`；Used：⚠️ 可算（历史充值 - 现余额，不精确）；Percentage：⚠️ 可算（limit 非 null 时）；Reset：key 级 `limit_reset` 常为 null（credits 无重置）；Expiration：**Credits 永不过期** 🟢[credits][limits] |
| 11 | 无接口时本地 Token Usage × 官方价格 | ✅ 可行：`GET /api/v1/models` 返回每个模型 `pricing`（input/output/cache），DSH 本地记账可乘算 🟢[models] |
| 12 | 是否需要用户额外提供权限 | ❌ 不需要 —— 复用 DSH `OPENROUTER_API_KEY`，零重复填 Key 🟢 |
| 13 | 公开官方 API vs 网页私有 API | 公开官方：`/api/v1/credits`、`/api/v1/key`、`/api/v1/models`；网页私有：Observability 面板（用量明细图表）🟢/🟡 |
| 14 | 稳定性分级 | **A** —— 官方独立文档页、多 SDK 覆盖、社区大（OpenUsage 等工具接入）；**适合正式集成** 🟢 |

来源：🟢 [credits-api](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits) · [limits](https://openrouter.ai/docs/api_reference/limits) · [current-key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key) · [byok](https://openrouter.ai/docs/guides/overview/auth/byok) · [byok-fee](https://openrouter.ai/blog/announcements/1-million-free-byok-requests-per-month/) · [openusage-or](https://openusage.sh/docs/providers/openrouter/) · 🔵 [models](https://openrouter.ai/docs/api-reference/models/get-models)

### 2.2 适配方案（10 项）

| 可展示字段 | 获取方法 | Endpoint | Auth |
|---|---|---|---|
| 余额（USD Credits） | GET | `https://openrouter.ai/api/v1/credits` | `Authorization: Bearer sk-or-***`（复用 DSH 凭据） |
| key 额度剩余（可选用） | GET | `https://openrouter.ai/api/v1/key` | 同上 |

**请求示例**
```
curl https://openrouter.ai/api/v1/credits \
  -H "Authorization: Bearer sk-or-***"          # 样例脱敏
curl https://openrouter.ai/api/v1/key \
  -H "Authorization: Bearer sk-or-***"          # 返回 data.limit / limit_remaining / limit_reset
```

**Response 示例（脱敏）**
```json
{ "data": { "credits": 12.34 } }
{ "data": { "label": "sk-or-***...", "limit": 10.0, "limit_remaining": 4.56,
            "limit_reset": null, "is_free_tier": false, "usage": 0, "rate_limit": {...} } }
```

| 项 | 结论 |
|---|---|
| 刷新频率建议 | 每 10–15 分钟一次（credits 变动慢；**勿高频轮询**，OpenRouter 建议由 402 事件驱动刷新）🟢[limits] |
| 错误处理 | 401/403→凭据失效提示；**402→"Credits 耗尽，请充值"**（官方以 402 表示 credit 不足）；429→速率限制，退避重试；网络错误→保留旧快照 |
| 安全风险 | 低：只读 GET、仅需 API key、无写操作、无 Cookie；注意 Key 只存 DSH 环境变量、不在 UI 回显 |
| 是否推荐正式集成 | **✅ 是（本轮首选）**：官方长期文档化、稳定 A 级、credits 永不过期、复用既有 OPENROUTER_API_KEY，改动量最小（v1.6 T4 已立项） |
| billingMode 分类 | **`aggregator`**（跨模型聚合计费；余额=Credits，永不过期）—— 与 PROVIDER-DATA-MODEL.md v2 中 `creditBalance` 字段完全对齐 |

---

## 3. Groq（推理平台，后付费）— **B 级**

### 3.1 14 项核查表

| # | 项 | 结论 |
|---|---|---|
| 1 | DSH provider id | `groq`（baseUrl `https://api.groq.com/openai/v1`）🟢 |
| 2 | DSH 认证方式 | API Key `GROQ_API_KEY`（envApiKeyAuth）🟢 |
| 3 | 消费方式 | **后付费（postpaid）**：按用量计费、信用卡/发票月结；**无预付费 credits 余额体系** 🟢[billing-faqs]🟡（FAQ 正文被反爬，倾向后付费，待真实验证） |
| 4 | 官方 Balance API | ❌ 无公开（无余额概念）🟡 |
| 5 | 官方 Usage API | ❌ 无公开（用量在 Groq Console 网页）🟡 |
| 6 | 官方 Subscription/Plan API | ❌ 无（有 Spend Limits 网页配置：月度消费上限）🟢[spend-limits] |
| 7 | Rate Limit 从 Response Headers 返回 | ✅ **是，最完整的平台之一**：4 维额度走 headers —— `x-ratelimit-limit-requests/remaining-requests/reset-requests`（RPM）、`-limit-tokens/-remaining-tokens/-reset-tokens`（TPM）、`-limit-requests-day/-remaining-requests-day/-reset-requests-day`（RPD）、`-limit-tokens-day/-remaining-tokens-day/-reset-tokens-day`（TPD）🟢[rate-limits]🔵[openusage-groq] |
| 8 | Reset Time | headers 中 `x-ratelimit-reset-*`；分钟窗口 60s、日窗口按 UTC 日边界 🔵[openusage-groq] |
| 9 | 套餐名 | ❌ 无套餐（有免费层模型 + 后付费账户）🟢 |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | Balance：❌；Used：❌（无 API）；Remaining：✅ headers（requests/tokens 双维）；Percentage：⚠️ 可算（remaining/limit）；Reset：✅ headers；Expiration：不适用（后付费无余额） |
| 11 | 无接口时本地 Token Usage × 官方价格 | ✅ 可行：DSH token usage × [groq 官方定价](https://groq.com/pricing)（按 token 计费）🟢 |
| 12 | 是否需要用户额外提供权限 | ❌ 不需要 —— 复用 DSH `GROQ_API_KEY` 🟢 |
| 13 | 公开官方 API vs 网页私有 API | 公开官方：`/openai/v1/models`（探测 headers 用）、推理接口；网页私有：Console 用量仪表盘 🟢/🟡 |
| 14 | 稳定性分级 | **B** —— headers 官方+社区（OpenUsage）双重验证、零成本探测；但**无余额/用量 API**，只能展示速率额度，不适合做余额卡片 🟢🔵 |

来源：🟢 [rate-limits](https://console.groq.com/docs/rate-limits) · [spend-limits](https://console.groq.com/docs/spend-limits) · [billing-faqs](https://console.groq.com/docs/billing-faqs) · [pricing](https://groq.com/pricing) · 🔵 [openusage-groq](https://openusage.sh/docs/providers/groq/)

### 3.2 适配方案（10 项）

| 可展示字段 | 获取方法 | Endpoint | Auth |
|---|---|---|---|
| 速率额度：RPM/TPM/RPD/TPD 剩余 | GET（无成本探测） | `https://api.groq.com/openai/v1/models` | `Authorization: Bearer gsk_***`（复用 DSH 凭据） |
| 重置倒计时 | headers `x-ratelimit-reset-*` | 同上 | 同上 |

**请求示例**
```
curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer gsk_***"   # 只看响应头
# 关键响应头：x-ratelimit-limit-tokens: 30000 / x-ratelimit-remaining-tokens: 28650 / ...
```

**Response 示例（脱敏，headers 摘录）**
```
x-ratelimit-limit-requests: 30        x-ratelimit-remaining-requests: 29
x-ratelimit-limit-tokens: 30000       x-ratelimit-remaining-tokens: 28650
x-ratelimit-limit-requests-day: 14400 x-ratelimit-remaining-requests-day: 14321
x-ratelimit-limit-tokens-day: 1000000 x-ratelimit-remaining-tokens-day: 998450
x-ratelimit-reset-tokens: 42s
```

| 项 | 结论 |
|---|---|
| 刷新频率建议 | 30s–1min（OpenUsage daemon 默认 30s 轮询，成本极低）🔵[openusage-groq] |
| 错误处理 | 401→凭据失效；429→等待 reset 后重试（本就不应超过）；403 免费层模型切换等，提示用户 |
| 安全风险 | 低：只读 GET /models，headers 消费；无写操作 |
| 是否推荐正式集成 | **⚠️ 有条件**：作为"**速率/免费额度**信息源（source='response_headers'）"推荐，适合 free_tier 渲染（`rateLimit` 字段）；**不能**提供余额/花费 → 不作为余额卡片主数据源 |
| billingMode 分类 | **`pay_as_you_go`（后付费）**；展示侧可归 `free_tier` 风格（速率+重置） |

---

## 4. Together AI（推理平台，预付费 credits）— **B 级**

### 4.1 14 项核查表

| # | 项 | 结论 |
|---|---|---|
| 1 | DSH provider id | `together`（baseUrl `https://api.together.ai/v1`）🟢 |
| 2 | DSH 认证方式 | API Key `TOGETHER_API_KEY`（envApiKeyAuth）🟢 |
| 3 | 消费方式 | **完全预付费**：最低充 $5，无试用；余额为 0 → API 暂停（除 Scale/Enterprise 合同）；**credits 无过期**；支持自动充值 🟢[credits] |
| 4 | 官方 Balance API | ❌ **无公开**（OpenAPI 中无 credit/balance 端点；余额只在网页 billing 设置页）🟢[openapi] |
| 5 | 官方 Usage API | ✅ **`GET /billing/usage`**：组织当月用量，含成本标注 line items，按日/时窗口返回（finalized 到昨天/上一整点，UTC）🟢[openapi][billing-usage] |
| 6 | 官方 Subscription/Plan API | ❌ 无订阅 API（旧 Build Tier 1–5/Scale/Enterprise 标签已废弃；合同制客户走线下）🟢[billing-usage] |
| 7 | Rate Limit 从 Response Headers 返回 | ✅ **是**：每个 serverless 推理响应头返回最新动态 rate limits + 当前 usage + reset 时机（per model）🟢[billing-usage][rate-limits] |
| 8 | Reset Time | headers 中的 reset 字段；动态限额无固定套餐周期 🟢 |
| 9 | 套餐名 | ❌ 无固定套餐（动态 per-model limits）🟢 |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | Balance：❌ **无 API**；Used（月）：✅ `/billing/usage` 有美元成本与 token 用量；Remaining/Percentage：❌ 无余额无法算；Reset：headers；Expiration：credits 不过期 🟢 |
| 11 | 无接口时本地 Token Usage × 官方价格 | ✅ 可行：DSH token usage × [Together 定价](https://www.together.ai/pricing)（per token）🟢 |
| 12 | 是否需要用户额外提供权限 | ❌ 不需要 —— 复用 DSH `TOGETHER_API_KEY`（`/billing/usage` 自动作用于 key 所属组织）🟢 |
| 13 | 公开官方 API vs 网页私有 API | 公开官方：`/billing/usage`、`/v1/whoami`、`/openai/v1/models`；网页私有：组织计费设置页（余额/自动充值）🟢 |
| 14 | 稳定性分级 | **B** —— Usage API 是官方 OpenAPI 文档化端点，稳；但**余额缺失**是硬伤，只能展示"本月已花费/用量" 🟢 |

来源：🟢 [billing-usage](https://docs.together.ai/docs/billing-usage-limits) · [credits](https://docs.together.ai/docs/billing-credits) · [rate-limits](https://docs.together.ai/docs/serverless/rate-limits) · [openapi](https://docs.together.ai/openapi.yaml) · [whoami](https://docs.together.ai/reference/whoami.md) · [pricing](https://www.together.ai/pricing)

### 4.2 适配方案（10 项）

| 可展示字段 | 获取方法 | Endpoint | Auth |
|---|---|---|---|
| 本月已用（USD，含分模型） | GET | `https://api.together.ai/billing/usage?month=YYYY-MM&granularity=day` | `Authorization: Bearer <TOGETHER_API_KEY>`（复用 DSH 凭据） |
| （可选）key 身份 | GET | `https://api.together.ai/v1/whoami` | 同上 |

**请求示例**
```
curl "https://api.together.ai/billing/usage?month=2026-08&granularity=day" \
  -H "Authorization: Bearer 1c***"    # 样例脱敏
```

**Response 示例（脱敏）**
```json
{ "object": "list", "organization_id": "org_***", "billing_period": "2026-08",
  "currency": "USD", "earliest_window_start": "2026-08-01T00:00:00Z",
  "latest_window_end": "2026-08-26T23:00:00Z", "next_cursor": null,
  "data": [ { "window_start": "2026-08-26T00:00:00Z", "usage": [
      { "model": "meta-llama/Llama-4-Maverick-17B-128E", "input_tokens": 123456,
        "output_tokens": 7890, "cost": 0.1234 } ] } ] }
```

| 项 | 结论 |
|---|---|
| 刷新频率建议 | 每日 1 次足够（finalized 数据只到"昨天"；当天有小时粒度但整点后才 finalize）🟢 |
| 错误处理 | 401/403→组织不匹配提示；404→该组织未启用此端点（官方文档列明）→ 降级为本地记账；网络错误→保留旧快照 |
| 安全风险 | 低：只读 GET、API key 认证、无写操作；`organization_id` 参数不可乱传（非属组织返回 403） |
| 是否推荐正式集成 | **✅ 是（次优）**：官方 Usage API + 复用既有凭据，可展示 Llama/Together 用户"本月真实花费"；**但不宣称余额**（避免误导：credits 余额查不到） |
| billingMode 分类 | **`pay_as_you_go`（预付费 credits 制，但余额 API 缺失 → 用 usage 展示）**；渲染走 `billing.currentPeriodSpend` 或 usage 路径 |

---

## 5. Fireworks AI（推理平台，预付费 credits）— **B 级**

### 5.1 14 项核查表

| # | 项 | 结论 |
|---|---|---|
| 1 | DSH provider id | `fireworks`（baseUrl `https://api.fireworks.ai/inference`）🟢 |
| 2 | DSH 认证方式 | API Key `FIREWORKS_API_KEY`（envApiKeyAuth）🟢 |
| 3 | 消费方式 | **预付费 credits**：购 credits 使用；余额为 0 且未开 Auto Reload → 暂停；另有月度 spend limit（加 credits 不抬高此限）🟢[usage-costs] |
| 4 | 官方 Balance API | ❌ 无公开（"remaining credits" 在 KB 文章中提及，属于账号/网页概念；`billing/summary` 是美元用量非余额）🟡[kb] |
| 5 | 官方 Usage API | ✅ 三件套：`GET /v1/accounts/{id}/billingUsage`（用量：tokens/加速秒，无金额）、`GET /v1/accounts/{id}/billing/summary`（美元 line items + totalCost + DAILY buckets）、`POST /v1/accounts/{id}/usageCosts:query`（美元按 HOUR/DAY/MODEL/USER/API_KEY 分组）🟢[usage-costs][billing-api] |
| 6 | 官方 Subscription/Plan API | ❌ 无订阅 API（有 spending tiers / account quotas 网页）🟢 |
| 7 | Rate Limit 从 Response Headers 返回 | 🟡 **未确认有 `x-ratelimit-*`**：官方文档讲 serverless 自适应 TPM 上限与 429，但未见 header 名称 🟡[rate-limits] |
| 8 | Reset Time | 🟡 无公开 headers（自适应限额无固定窗口）🟡 |
| 9 | 套餐名 | ❌（spending tier 阈值非套餐）🟢 |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | Balance：❌；Used：✅（billingUsage / usageCosts）；Remaining/Percentage：❌；Reset：❌；Expiration：credits 有效期？🟡（KB 未提，待核实） |
| 11 | 无接口时本地 Token Usage × 官方价格 | ✅ 可行：DSH token usage × [Fireworks 定价](https://docs.fireworks.ai/serverless/pricing) 🟢 |
| 12 | 是否需要用户额外提供权限 | ❌ 不需要 —— 复用 DSH `FIREWORKS_API_KEY`；account_id 用 `GET /v1/accounts` 解析（同 key 可列）🟢[list-accounts] |
| 13 | 公开官方 API vs 网页私有 API | 公开官方：accounts/billingUsage/billing-summary/usageCosts；网页私有：credits 余额、账单详情（app.fireworks.ai）🟢 |
| 14 | 稳定性分级 | **B** —— 官方 REST API 文档完整（含 OpenAPI），自动化可行；扣分项：需 account_id 二次解析、无余额 API、支持面中等 🟢 |

来源：🟢 [usage-costs](https://docs.fireworks.ai/accounts/exporting-usage-and-costs) · [billing-api](https://docs.fireworks.ai/api-reference/get-billing-usage) · [billing-summary](https://docs.fireworks.ai/api-reference/get-billing-summary) · [list-accounts](https://docs.fireworks.ai/api-reference/list-accounts) · [rate-limits](https://docs.fireworks.ai/serverless/rate-limits) · 🔵 [kb（credits 余额概念）](https://support.fireworks.ai/hc/en-us/articles/account-be-suspended-even-with-remaining-credits)

### 5.2 适配方案（10 项）

| 可展示字段 | 获取方法 | Endpoint | Auth |
|---|---|---|---|
| 本月美元花费（账单分类+每日） | GET | `https://api.fireworks.ai/v1/accounts/{account_id}/billing/summary?granularity=DAILY` | `Authorization: Bearer fw_***`（复用 DSH 凭据） |
| 用量（tokens） | GET | `https://api.fireworks.ai/v1/accounts/{account_id}/billingUsage?startTime=...&endTime=...` | 同上 |
| 解析 account_id | GET | `https://api.fireworks.ai/v1/accounts`（List Accounts） | 同上 |

**请求示例**
```
curl -s https://api.fireworks.ai/v1/accounts \
  -H "Authorization: Bearer fw_***"                       # 取 name（account slug）
curl -s "https://api.fireworks.ai/v1/accounts/fw_org_***/billing/summary?granularity=DAILY" \
  -H "Authorization: Bearer fw_***"                       # 样例脱敏
```

**Response 示例（脱敏，billing/summary）**
```json
{ "lineItems": [ { "series": "SERVERLESS", "totalCost": 12.34 } ],
  "granularity": "DAILY",
  "usageBuckets": [ { "date": "2026-08-26", "cost": 0.56 } ] }
```

| 项 | 结论 |
|---|---|
| 刷新频率建议 | 每日 1 次（汇总级指标，实时性要求低；账单最终确认有延迟）🟢 |
| 错误处理 | 401→凭据失效；403→权限不足（usageCosts 需管理员 ACCOUNT 作用域 → 降级用 SELF 作用域或 billingUsage）；404→端点未启用/账号问题；网络错误→旧快照 |
| 安全风险 | 低-中：只读 GET；注意 account_id 是组织 slug，属半公开标识，不视为敏感；POST `usageCosts:query` 涉及更多作用域，建议仅用 GET |
| 是否推荐正式集成 | **✅ 是（次优）**：官方齐全的 Usage/Summary API，可展示"本周期花费 $X"；❌ 不承诺余额（credits 余额仅网页） |
| billingMode 分类 | **`pay_as_you_go`（预付费 credits；展示侧用 billing/usage 路径）** |

---

## 6. Cerebras（推理平台，PayGo 预付费 credits）— **C 级**

### 6.1 14 项核查表

| # | 项 | 结论 |
|---|---|---|
| 1 | DSH provider id | `cerebras`（baseUrl `https://api.cerebras.ai/v1`）🟢 |
| 2 | DSH 认证方式 | API Key `CEREBRAS_API_KEY`（envApiKeyAuth）🟢 |
| 3 | 消费方式 | PayGo（自服务）**预付费 credits**：余额为 0 → 速率归 0 直到充值；支持自动充值（阈值+目标）；**credits 购买后 1 年过期**；偶尔出现小额负余额会在账期结束扣款 🟢[paygo] |
| 4 | 官方 Balance API | ❌ 无公开；Cloud Console 有 "Check Your Credit Balance"（网页 UI）🟢[billing] |
| 5 | 官方 Usage API | ❌ 无公开 REST API；Cloud Console Analytics（Usage/Cached-Usage/Cost 三 tab，**Cost 有约 10 分钟延迟**，支持 CSV 导出）🟢[usage-mon] |
| 6 | 官方 Subscription/Plan API | ❌ 无（有 Dedicated Endpoints 合同模型，非订阅 API）🟢 |
| 7 | Rate Limit 从 Response Headers 返回 | 🟡 **未确认**：双桶模型（uncached/total token），429 会指明超限的是哪个桶；headers 是否带 `x-ratelimit-*` 官方文档未列，待核实 🟡[rate-limits] |
| 8 | Reset Time | 🟡 未公开（"quota replenishment"在文档中，具体窗口待核实）🟡[rate-limits] |
| 9 | 套餐名 | ❌（按模型列 TPM/RPM；PayGo 下模型速率可能随时调整）🟢[paygo] |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | Balance：❌ 无 API；Used：❌ 无 API（仅网页）；Remaining/Percentage：❌；Reset：❌；**Expiration：✅ credits 一年过期** 🟢[paygo] |
| 11 | 无接口时本地 Token Usage × 官方价格 | ✅ 可行：DSH token usage × [Cerebras 定价](https://www.cerebras.ai/pricing)（按输入/输出 token）🟢 |
| 12 | 是否需要用户额外提供权限 | ❌ 不需要（只涉及复用 `CEREBRAS_API_KEY`）；但**无 API 可查**，给了 Key 也没用 🟢 |
| 13 | 公开官方 API vs 网页私有 API | 公开官方：推理类 API；网页私有：Cloud Console（Analytics/Logs/Limits/Billing）🟢 |
| 14 | 稳定性分级 | **C** —— 全部靠网页，无官方 REST 查询端点；社区逆向信息少；集成成本高收益低 🟡 |

来源：🟢 [paygo-faq](https://support.cerebras.net/articles/5041581099-cerebras-self-serve-paygo-faq) · [billing](https://inference-docs.cerebras.ai/console/account-billing) · [usage-mon](https://inference-docs.cerebras.ai/console/usage-monitoring) · [rate-limits](https://inference-docs.cerebras.ai/support/rate-limits) · [pricing](https://www.cerebras.ai/pricing)

### 6.2 适配方案（10 项）

| 可展示字段 | 获取方法 | Endpoint | Auth |
|---|---|---|---|
| 无（本轮无公开 API） | 网页 CSV / 图形 | Cloud Console（cloud.cerebras.ai） | 浏览器登录态（非 API key） |

**请求示例**：无公开端点可给出（避免给猜测性 URL）。若后续社区出现 balance 端点，再补。
**Response 示例**：无。

| 项 | 结论 |
|---|---|
| 刷新频率建议 | —（未集成） |
| 错误处理 | 若接入：仅 401/凭据失效与 429 bucket 超限可处理；其余依赖网页 |
| 安全风险 | 无新攻击面（不接入）；若强行逆向网页会引入登录态/Cookie 风险 → **不建议** |
| 是否推荐正式集成 | **❌ 暂不**：无公开 API、无 header 证据、网页逆向成本高（参考百炼教训）；维持"本地记账估算（token usage × 官方价）"即可覆盖用户核心诉求 |
| billingMode 分类 | `pay_as_you_go`（预付费 credits，**credits 一年过期** —— 若未来有 API，需展示 expiration） |

---

## 7. Hugging Face Inference Providers（推理平台，credits）— **C 级**

### 7.1 14 项核查表

| # | 项 | 结论 |
|---|---|---|
| 1 | DSH provider id | `huggingface`（HF 生态）🟢 |
| 2 | DSH 认证方式 | API Key/Tokent **`HF_TOKEN`**（envApiKeyAuth；user access token）🟢 |
| 3 | 消费方式 | Inference Providers **pay-as-you-go per token，HF 无加价**；免费用户每月 $0.10 credits、PRO 用户 $2.00 credits（可花在所有 HF 计算服务）；超免费额度需**购买 credits** 🟢[pricing] |
| 4 | 官方 Balance API | ❌ 无公开（credits 余额在 huggingface.co/settings/billing 网页）🟡 |
| 5 | 官方 Usage API | ❌ 无公开（每条推理请求的 usage 在响应体里，可本地累计）🟢[pricing] |
| 6 | 官方 Subscription/Plan API | ❌ 无公开（PRO 是订阅制 $9/月，但无面向开发者的 Plan 查询 API）🟡 |
| 7 | Rate Limit 从 Response Headers 返回 | ❌ 推理计费无 rate-limit header 约定（Hub Rate limits 页面针对页面/前端请求，非推理计费）🟢[hub-rl] |
| 8 | Reset Time | N/A（每月 credits 发放，无窗口重置概念；🟡 具体发放日待核实） |
| 9 | 套餐名 | **PRO**（订阅权益包）与免费层；Inference Providers 本身无套餐 🟢 |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | Balance：❌ 无 API；Used：❌ 无 API（仅响应 usage）；Remaining/Percentage：❌；Reset：❌；Expiration：credits 有效期🟡（pricing 未写死，待核实） |
| 11 | 无接口时本地 Token Usage × 官方价格 | ✅ 可行：DSH token usage × HF 定价页（按模型列每百万 token 价，provider 各异）🟢 |
| 12 | 是否需要用户额外提供权限 | ❌ 不需要（复用 `HF_TOKEN`）—— 但无 API 可查，与 Cerebras 同理 🟢 |
| 13 | 公开官方 API vs 网页私有 API | 公开官方：推理与 Hub API（模型/推理）；网页私有：settings/billing（credits 购买与余额）🟢 |
| 14 | 稳定性分级 | **C** —— 无官方余额/用量查询端点；"每月送 credits + 按量扣费"的二元结构只能靠本地记账 + 免费额度提示 🟡 |

来源：🟢 [pricing](https://huggingface.co/docs/inference-providers/en/pricing) · [hub-billing](https://huggingface.co/docs/hub/main/billing) · [hub-rl](https://huggingface.co/docs/hub/en/rate-limits) · [security-tokens](https://huggingface.co/docs/hub/en/security-tokens)

### 7.2 适配方案（10 项）

| 可展示字段 | 获取方法 | Endpoint | Auth |
|---|---|---|---|
| 无（本轮无公开 API）。可展示：本地累计 spent + "每月 $0.10（免费）/ $2（PRO）赠送额度"提示 | 本地记账（token usage × 价格）+ 静态文案 | — | — |

**请求示例 / Response 示例**：无公开端点（不给猜测 URL）。

| 项 | 结论 |
|---|---|
| 刷新频率建议 | —（未集成）；本地记账按请求实时累加 |
| 错误处理 | 仅推理 401（token 失效）与 402/429 可提示 |
| 安全风险 | 无新攻击面（不接入） |
| 是否推荐正式集成 | **❌ 暂不**：无 API；提示用户"HF 赠送额度仅 $0.1/月"可放运营文案，但不做数据卡片 |
| billingMode 分类 | `pay_as_you_go`（credits 制 + 每月赠送；`free_tier` 元素） |

---

## 8. 汇总：billingMode 分类 + 推荐集成清单

### 8.1 billingMode 分类（对齐 PROVIDER-DATA-MODEL.md v2 枚举）

| provider | billingMode | 数据来源 | source 分级 | 关键限制 |
|---|---|---|---|---|
| openrouter | **aggregator** | `GET /api/v1/credits` | official_api | credits 永不过期；余额=可花金额 |
| together | **pay_as_you_go**（预付费 credits） | `GET /billing/usage` | official_api | 有用量无余额 → 展示"本月花费" |
| fireworks | **pay_as_you_go**（预付费 credits） | `GET /billing/summary` + `billingUsage` | official_api | 需 account_id 解析；无余额 |
| groq | **pay_as_you_go**（后付费） | headers（4 维速率） | response_headers | 无余额/用量 API |
| cerebras | **pay_as_you_go**（预付费，1 年过期） | — | unsupported | 无 API，仅网页 |
| huggingface | **pay_as_you_go**（credits 月赠） | — | unsupported（本地可记账） | 无 API |

### 8.2 推荐集成清单（主 Agent 可直接采信）

| 优先级 | provider | 集成内容 | 工作量估计 | 备注 |
|---|---|---|---|---|
| **P0** | openrouter | credits 余额卡片（`aggregator` / creditBalance） | 小（v1.6 T4 已立项，仅补 `/api/v1/key` 可选项） | A 级，复用 OPENROUTER_API_KEY |
| **P1** | together | 本月花费卡片（billing.currentPeriodSpend） | 小 | 官方 Usage API；UI 标注"本月已用"而非"余额" |
| **P1** | fireworks | 本周期花费卡片（billing.currentPeriodSpend） | 中（含 account_id 解析） | 官方三端点齐全；管理员作用域注意降级 |
| **P2** | groq | free_tier 速率/额度小卡片（rateLimit 字段） | 小 | headers 官方+社区验证；非余额 |
| **P3** | cerebras / huggingface | 仅本地记账估算（source='local_calculation'） | 复用现有记账 | 无 API，等官方开放 or 社区逆向成熟后再议 |

> 全部 P0/P1/P2 均**复用 DSH 既有凭据（OPENROUTER_API_KEY / TOGETHER_API_KEY / FIREWORKS_API_KEY / GROQ_API_KEY），零新增用户配置**，符合分发铁律"零密钥"。

---

## 9. 附录：来源 URL 汇总（各平台一节一行）

- **OpenRouter**: <https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits> · <https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key> · <https://openrouter.ai/docs/api_reference/limits> · <https://openrouter.ai/docs/guides/overview/auth/byok> · <https://openrouter.ai/blog/announcements/1-million-free-byok-requests-per-month/> · <https://openrouter.ai/docs/api-reference/models/get-models> · <https://openusage.sh/docs/providers/openrouter/>
- **Groq**: <https://console.groq.com/docs/rate-limits> · <https://console.groq.com/docs/spend-limits> · <https://console.groq.com/docs/billing-faqs> · <https://groq.com/pricing> · <https://openusage.sh/docs/providers/groq/>
- **Together**: <https://docs.together.ai/docs/billing-usage-limits> · <https://docs.together.ai/docs/billing-credits> · <https://docs.together.ai/docs/serverless/rate-limits> · <https://docs.together.ai/openapi.yaml>（`/billing/usage` → BillingUsageReport schema）· <https://docs.together.ai/reference/whoami.md> · <https://www.together.ai/pricing>
- **Fireworks**: <https://docs.fireworks.ai/accounts/exporting-usage-and-costs> · <https://docs.fireworks.ai/api-reference/get-billing-usage> · <https://docs.fireworks.ai/api-reference/get-billing-summary> · <https://docs.fireworks.ai/api-reference/list-accounts> · <https://docs.fireworks.ai/serverless/rate-limits> · <https://support.fireworks.ai/hc/en-us/articles/account-be-suspended-even-with-remaining-credits>
- **Cerebras**: <https://support.cerebras.net/articles/5041581099-cerebras-self-serve-paygo-faq> · <https://inference-docs.cerebras.ai/console/account-billing> · <https://inference-docs.cerebras.ai/console/usage-monitoring> · <https://inference-docs.cerebras.ai/support/rate-limits> · <https://www.cerebras.ai/pricing>
- **Hugging Face**: <https://huggingface.co/docs/inference-providers/en/pricing> · <https://huggingface.co/docs/hub/main/billing> · <https://huggingface.co/docs/hub/en/rate-limits> · <https://huggingface.co/docs/hub/en/security-tokens>
- **DSH 本地证据**: `…/@earendil-works/pi-ai/dist/env-api-keys.js`（GROQ_API_KEY/TOGETHER_API_KEY/FIREWORKS_API_KEY/CEREBRAS_API_KEY/OPENROUTER_API_KEY/HF_TOKEN 映射）、`…/dist/providers/{groq,together,fireworks,cerebras,openrouter}.js`（provider id/baseUrl/auth）、本项目 `docs/PROVIDER-DATA-MODEL.md`（billingMode 枚举）、`docs/tasks.md`（T4 openrouter 适配器）

**报告完成时间**: 2026-08-27 · **调研工程师**: AI Agent（委托执行，单 Agent 直接调研）· **审核状态**: 待主 Agent 验收