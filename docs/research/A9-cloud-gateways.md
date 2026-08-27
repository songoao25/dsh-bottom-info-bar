# A9 云网关/云计费适配可行性调研报告

> 调研对象：AWS Bedrock / Azure OpenAI / Google Vertex / Cloudflare(AI Gateway + Workers AI) / Vercel AI Gateway
> 目的：为「底部信息栏」插件评估这些云平台是否可接入、按什么模式接入。
> 方法：web_search 官方文档 + 社区现状；DSH 源码确认 provider id 与凭据（`pi-ai/dist/env-api-keys.js`）；无 workflow/subagent。
> 调研日期：2026-07（依赖版本：dsh pi-ai 内置 providers/manifest 生成于 2026-07-25）。
> 标注：`待核实` = 未能从官方文档二次确认，需在实现时验证。

## 0. 全局结论（先读这节）

- 五家云平台全部是**「账单/用量」计费**（按 token/用量/神经元后付费，或按周期结算），**没有一家提供真正的「余额」概念**。AWS/GCP/Azure/Vercel 均为先用量后出账；Cloudflare 有「免费额度/用量上限」但无 API 暴露余额。
- 因此五家**全部归入 `cloud_billing` 模式**（显示周期花费、预算百分比、用量趋势），**不应进入余额制双模式逻辑**（与订阅制/余额制互斥的机制无关）。
- 判断标准：能否**复用 DSH 现有凭据**（零设置原则）+ 官方 API 稳定性。
- **推荐正式集成（2 家）**：
  1. `amazon-bedrock` —— 复用现有 AWS 凭据（SigV4 本地签名），官方 Cost Explorer/Budgets API 稳定（A 级），显示「本月/今日 Bedrock 花费 + 预算百分比」（账单延迟约 24h，定位为周期花费而非实时）。
  2. `cloudflare-ai-gateway` / `cloudflare-workers-ai` —— 唯一可复用同一把平台 API Key 直读计费与用量的云（CLOUDFLARE_API_KEY 兼作管理 API Key），支持「本月花费 + 每日免费额度剩余/重置倒计时」。缺点：Billable Usage API 仍是 Alpha（B 级）。
- **暂不接入（3 家）**：`azure-openai-responses`、`google-vertex`、`vercel-ai-gateway` —— 计费/用量 API 均**无法复用 DSH 现有凭据**，必须额外配置云账号级凭证（Azure 服务主体 / GCP 服务账号 + 预算 / Vercel 账号 Token），配置成本与「零设置」铁律冲突；列入 roadmap 可选。
- 五家都可用「本地 Token Usage × 官方单价」兜底显示花费（响应体带 usage + DSH 模型目录内置 cost 字段），这不依赖任何计费 API，可普遍启用。

---

## 1. amazon-bedrock（AWS）

### 1.1 十四项事实清单

| # | 项目 | 结论 |
|---|---|---|
| 1 | DSH provider id | `amazon-bedrock`（api: `bedrock-converse-stream`） |
| 2 | DSH 认证方式 | SigV4；凭据来自 `AWS_PROFILE`（~/.aws/credentials）或 `AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY`+`AWS_SESSION_TOKEN`，亦支持 `AWS_BEARER_TOKEN_BEDROCK`/ECS/IRSA；region 从模型 ARN/环境推断，默认 us-east-1（源码 env-api-keys.js L135-151、bedrock-converse-stream.js 确认） |
| 3 | 消费方式 | 按 token 后付费（输入/输出/缓存读取/缓存写入单价），或 Provisioned Throughput 包时 |
| 4 | 官方 Balance API？ | **无「账户余额」**。新 AWS Billing API 有 [billing:GetCredits](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_GetCredits.html) 返回账户可用赠金/信用额度（仅发放过 credit 的账户有意义），PAYG 常规账户不适用 → 视为无余额 |
| 5 | 官方 Usage API？ | 有。[Cost Explorer GetCostAndUsage](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html)（+CLI [get-cost-and-usage](https://docs.aws.amazon.com/cli/latest/reference/ce/get-cost-and-usage.html)），按 SERVICE=BEDROCK 过滤取日/月花费；数据延迟约 24h |
| 6 | 官方 Subscription/Plan API？ | 无「套餐」概念。有 [AWS Budgets 预算 API](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_GetBudget.html)（可读预算与实际花费/预测）与 Service Quotas API；均非余额型套餐 |
| 7 | Rate Limit 是否从 Response Headers 返回？ | 未标准化。Bedrock 429 带 `Retry-After`，无统一 x-ratelimit 头；额度按「每分钟 token」（[Bedrock quotas](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html)），需另查 Service Quotas API（待核实响应头细节） |
| 8 | Reset Time？ | 每分钟级 quota 重置，无头信息；账期按自然月/日 |
| 9 | 套餐名？ | N/A（PAYG 后付费；可选 Provisioned Throughput / Saving Plans） |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration？ | 全无余额维度。可拿：Used=CE 日/月花费；Percentage=预算 API actualVsBudget；Remaining/Reset/Expiration=N/A |
| 11 | 本地 Token Usage × 官方价格？ | 可行。Bedrock Converse 响应体带 `usage`（input/output/cacheRead/cacheWrite tokens）；DSH 模型目录已内置各模型单价（provider/data/amazon-bedrock.json 有 cost 字段 + [官方定价页](https://aws.amazon.com/bedrock/pricing/)） |
| 12 | 额外权限？ | **复用现有 AWS 凭据**（SigV4 本地签名、密钥不出本机）。但需该凭据带 `ce:GetCostAndUsage` + `budgets:ViewBudget` IAM 权限——若用户给 Bedrock 的是最小权限 Key 则查不了；数据是**账号/组织级**（可过滤 SERVICE=BEDROCK 隔离）。零设置冲突：低-中 |
| 13 | 公开官方 API vs 网页私有 API？ | 全部为公开官方 REST API（CE/Budgets/Billing/Quotas），无网页私有接口 |
| 14 | 稳定性分级 + 定位 | **A 级**，适合正式集成。明确为 **cloud_billing（周期花费+预算百分比）**，非实时余额 |

### 1.2 适配方案（10 项）

| 项 | 方案 |
|---|---|
| 可展示字段 | 本月 Bedrock 花费、今日花费、月度预算百分比（actual/Budget）、(可选) GetCredits 可用赠金 |
| 获取方法 | Cost Explorer `GetCostAndUsage`（日粒度 + SERVICE=BEDROCK 过滤）；预算走 Budgets API；赠金走 Billing `GetCredits` |
| Endpoint | `https://ce.us-east-1.amazonaws.com/`（CE 全局服务；预算/计费同理 us-east-1；SigV4 POST） |
| Auth | 复用 DSH 现有 AWS 凭据本地 SigV4 签名；需 IAM 增加 ce/budgets 读权限 |
| 请求示例 | `POST / → {"TimePeriod":{"Start":"2026-07-01","End":"2026-07-31"},"Granularity":"DAILY","Filter":{"Dimensions":{"Key":"SERVICE","Values":["Amazon Bedrock"]}}}`（脱敏，字段名以官方为准） |
| Response 示例 | `{"ResultsByTime":[{"TimePeriod":{"Start":"2026-07-01","End":"2026-07-02"},"Total":{"UnblendedCost":{"Amount":"1.2345","Unit":"USD"}}}]}`（示例数值） |
| 刷新频率建议 | 每 6–12h（账单延迟 ~24h，过频无意义）；预算百分比可 1h 一次 |
| 错误处理 | 429→退避重试；`ExpiredTokenException`→提示刷新 AWS 凭据；`AccessDeniedException`→提示缺少 ce:GetCostAndUsage 权限并降级为本地换算 |
| 安全风险 | 低：SigV4 本地签名不发送密钥；只读 API；注意 token 权限最小化，避免用管理密钥 |
| 是否推荐 + billingMode | **推荐**（官方稳定 API + 复用凭据 + 本地签名零泄露）；billingMode=`cloud_billing` |

---

## 2. azure-openai-responses（Azure OpenAI / Azure）

### 2.1 十四项事实清单

| # | 项目 | 结论 |
|---|---|---|
| 1 | DSH provider id | `azure-openai-responses` |
| 2 | DSH 认证方式 | `AZURE_OPENAI_API_KEY`（Azure OpenAI 资源 Key / APIM Key），Bearer 直连 `{resource}.openai.azure.com`（env-api-keys.js L77 确认） |
| 3 | 消费方式 | 按部署 PAYG（token 计费，区域/部署定价）+ Provisioned Throughput 可选 |
| 4 | 官方 Balance API？ | **无**。Azure Consumption [Balances - Get By Billing Account](https://learn.microsoft.com/en-us/rest/api/consumption/balances/get-by-billing-account) 仅适用于 EA/MPA 账单账户（预付额度），常规 PAYG 订阅查不到 |
| 5 | 官方 Usage API？ | 有。[Cost Management Query - Usage](https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage)（按订阅/资源组 scope 聚合花费，可按服务过滤）+ [Consumption Usage Details](https://learn.microsoft.com/en-us/rest/api/consumption/usage-details)（明细） |
| 6 | 官方 Subscription/Plan API？ | 无「套餐」；[Azure Budgets API](https://learn.microsoft.com/en-us/rest/api/cost-management/budgets/get) 可读预算与实际花费（需先建预算）；订阅/配额是管理面 |
| 7 | Rate Limit 是否从 Response Headers 返回？ | **是（少见的云）**：Azure OpenAI 返回 `x-ratelimit-limit-tokens` / `x-ratelimit-remaining-tokens` / `x-ratelimit-limit-requests` / `x-ratelimit-remaining-requests`，429 带 Retry-After（[官方配额文档](https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits)、[社区头解析](https://pabloaicorner.hashnode.dev/how-to-extract-and-analyze-azure-openai-response-headers)）；Responses API 具体头集合待核实 |
| 8 | Reset Time？ | 头无重置时间；TPM 配额按分钟滑动 / 订阅配额按月（待核实） |
| 9 | 套餐名？ | N/A（PAYG + Provisioned）；Foundry 配额页显示 TPM/RPM |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration？ | 无余额。可拿：Used=CM Query 花费；Percentage=预算（若用户建了预算）；x-ratelimit-remaining-tokens 是**限流配额**非账单额 |
| 11 | 本地 Token Usage × 官方价格？ | 可行。Responses API 响应带 `usage`（prompt/completion tokens）；但 Azure 定价按部署+区域，DSH 目录价格近似 OpenAI 目录价 → 本地换算精确性**待核实** |
| 12 | 额外权限？ | **冲突大**。Cost Management/Budgets 需要 Azure AD Token（服务主体 client credentials 或用户 OAuth + 资源组 Reader），`AZURE_OPENAI_API_KEY` **无法访问 ARM 计费** → 必须另建服务主体并授权，配置成本中-高 |
| 13 | 公开官方 API vs 网页私有 API？ | 全部公开官方 ARM REST API |
| 14 | 稳定性分级 + 定位 | API 本身 **A 级**（文档完善稳定），但接入门槛 **E 级**（凭据不可复用）。定位 cloud_billing，**首版暂不接入** |

### 2.2 适配方案（10 项）

| 项 | 方案 |
|---|---|
| 可展示字段 | 本月/今日 Azure OpenAI 花费（按服务过滤）、订阅预算百分比、（仅限流层面）TPM 剩余% |
| 获取方法 | Cost Management `Query - Usage`（scope=订阅，Filter 服务名含 "OpenAI"）+ Budgets `Get` |
| Endpoint | `https://management.azure.com/subscriptions/{subId}/providers/Microsoft.CostManagement/query?api-version=2025-03-01` |
| Auth | Azure AD Bearer（服务主体 `client_credentials` 拿 token）——**新增凭证体系**，与 AZURE_OPENAI_API_KEY 无关 |
| 请求示例 | `{"type":"Usage","timeframe":"MonthToDate","dataset":{"granularity":"Daily","aggregation":{"totalCost":{"name":"PreTaxCost","function":"Sum"}}}}`（脱敏示例） |
| Response 示例 | `{"properties":{"rows":[[17356.25,"Azure OpenAI",...]],"columns":[...]}}`（示例数值，明细按官方 schema） |
| 刷新频率建议 | 6–12h（账单聚合延迟）；若有预算可 1h |
| 错误处理 | 401/403→提示服务主体权限不足；429→退避；无订阅 Reader → 降级本地换算 |
| 安全风险 | 中：需要存储服务主体 secret（client secret）在环境中 → 新增敏感凭据；建议用证书轮转，代价高 |
| 是否推荐 + billingMode | 首版**不推荐**（凭据不可复用 + 需建服务主体）；roadmap 可选；billingMode=`cloud_billing` |

---

## 3. google-vertex（Google Cloud / Vertex AI）

### 3.1 十四项事实清单

| # | 项目 | 结论 |
|---|---|---|
| 1 | DSH provider id | `google-vertex` |
| 2 | DSH 认证方式 | 双通道：a) `GOOGLE_CLOUD_API_KEY`（API Key Bearer）；b) ADC 服务账号（`GOOGLE_APPLICATION_CREDENTIALS` 或 ~/.config/gcloud/application_default_credentials.json）+ `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION`（源码 env-api-keys.js L125-134 确认） |
| 3 | 消费方式 | 按 token 后付费（区域/location 差异化定价） |
| 4 | 官方 Balance API？ | **无余额**。[Cloud Billing API](https://docs.cloud.google.com/billing/docs/reference/rest) 只返回账号信息/项目挂接关系，无余额/剩余 |
| 5 | 官方 Usage API？ | 半有。[Billing Budgets API](https://docs.cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets) 的 budget 资源含 `currentSpend`（当前周期累计花费）+ `budgetAmount`，**前提是用户在 GCP 先创建预算**；完整账单走 BigQuery 导出（重方案）。无「实时累计费用」直查接口 |
| 6 | 官方 Subscription/Plan API？ | 无套餐；只有 Billing Account 与 Budget 概念 |
| 7 | Rate Limit 是否从 Response Headers 返回？ | 部分。Vertex AI 429 有文档化错误码与有限重试语义（[error-code-429](https://cloud.google.com/vertex-ai/generative-ai/docs/error-code-429)）；**headers 无 x-ratelimit 全家桶**（待核实；Gemini API 的 x-ratelimit 头不适用于 aiplatform） |
| 8 | Reset Time？ | 无头信息；分钟级 quota，重置机制待核实 |
| 9 | 套餐名？ | N/A |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration？ | 全无余额。可拿：Used=预算 currentSpend（需建预算）；Percentage=currentSpend/budgetAmount |
| 11 | 本地 Token Usage × 官方价格？ | 可行。Vertex 响应带 `usageMetadata`（promptTokenCount / candidatesTokenCount）；DSH 目录已内置 Vertex 各模型单价（data/google-vertex.json 有 cost 字段） |
| 12 | 额外权限？ | **冲突大**。[Cloud Billing API 认证文档](https://docs.cloud.google.com/billing/docs/authentication) 明确计费接口走 OAuth2（服务账号/授权用户），**不接受 API Key** → `GOOGLE_CLOUD_API_KEY` 无法查费；若用 ADC 服务账号则需另建服务账号 + 授权 `billing.budgets.get` 等，并需用户先在控制台建预算 |
| 13 | 公开官方 API vs 网页私有 API？ | 公开官方 REST API |
| 14 | 稳定性分级 + 定位 | 接口 **A 级**、生态长期稳定；接入门槛 **E 级**（无余额 + 需服务账号 + 需预建预算）。**首版暂不接入**；定位 cloud_billing |

### 3.2 适配方案（10 项）

| 项 | 方案 |
|---|---|
| 可展示字段 | 「本月已花费（预算口径）」「预算剩余%/倒计时」（需用户建预算）；无余额 |
| 获取方法 | Billing Budgets `billingAccounts.budgets.get` → `currentSpend`/`budgetAmount`；辅助 `projects.getBillingInfo` |
| Endpoint | `https://cloudbilling.googleapis.com/v1/billingAccounts/{billingAccountId}/budgets/{budgetId}`（Budget API v1） |
| Auth | OAuth2（ADC 服务账号，域 `https://www.googleapis.com/auth/cloud-billing`）——API Key 不可用 |
| 请求示例 | `GET /v1/billingAccounts/{id}/budgets/{budgetId}`（Authorization: Bearer <SA token>） |
| Response 示例 | `{"name":"billingAccounts/xxxx/budgets/1111","budgetAmount":{"specifiedAmount":{"units":"100"}},"currentSpend":{"costAmount":{"units":"42","nanos":500000000}}}`（示例数值，脱敏） |
| 刷新频率建议 | 6–12h（账单口径本就延迟；预算 currentSpend 非实时） |
| 错误处理 | 403 FORBIDDEN→提示服务账号缺 billing 权限或未建预算；429→指数退避；未配置 SA→静默降级本地换算 |
| 安全风险 | 中：需保存服务账号 JSON（含私钥）到本地环境；建议最小权限 + 定期轮转 |
| 是否推荐 + billingMode | 首版**不推荐**（无余额概念 + 双重要求服务账号与预算，与零设置铁律冲突）；roadmap 可选；billingMode=`cloud_billing` |

---

## 4. cloudflare-ai-gateway / cloudflare-workers-ai（Cloudflare）

### 4.1 十四项事实清单

| # | 项目 | 结论 |
|---|---|---|
| 1 | DSH provider id | `cloudflare-ai-gateway` 与 `cloudflare-workers-ai` 两个 id（共用一套凭据） |
| 2 | DSH 认证方式 | `CLOUDFLARE_API_KEY`（账户级 API Token，Bearer）+ `CLOUDFLARE_ACCOUNT_ID`（URL 内）；Gateway 另用 `CLOUDFLARE_GATEWAY_ID`。注意：这把 Key 同时就是 Cloudflare 管理 API 的凭据 → 天然可复用（env-api-keys.js L101-102 确认） |
| 3 | 消费方式 | Workers AI 按 **Neurons** 计费（1 Neuron≈1 token 级用量单位）；AI Gateway 按转发 token 计费 + 平台加价；免费版有每日用量上限 |
| 4 | 官方 Balance API？ | **无余额 API**。计价是后付费 + 用量配额，无「余额/剩余」直查 |
| 5 | 官方 Usage API？ | 有（核心亮点）。[Billable Usage API](https://developers.cloudflare.com/api/resources/billing/subresources/usage/methods/paygo/)（`GET /accounts/{id}/billing/usage/paygo`，Alpha）+ [AI Gateway usage_history](https://developers.cloudflare.com/api/resources/ai_gateway/subresources/billing/methods/usage_history/) + [AI Gateway Logs](https://developers.cloudflare.com/api/resources/ai_gateway/subresources/logs/methods/list/)（含 usage 字段）；另有 [GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/) 可查账户级 AI 用量 |
| 6 | 官方 Subscription/Plan API？ | 有账户/区域订阅类接口（api.cloudflare.com 控制面），AI 相关以 Billable Usage 为准（Neurons 消费）；具体「套餐」API 待核实 |
| 7 | Rate Limit 是否从 Response Headers 返回？ | 部分。CF 管理 API 429 带 `Retry-After`，2025-09 起新增限流头（官方 [Changelog](https://developers.cloudflare.com/changelog/post/2025-09-03-rate-limiting-improvement/)）；具体头名待核实；Workers AI 是**每日用量上限**（非滑动配额），无头 |
| 8 | Reset Time？ | 免费额度每日 UTC 午夜重置（可在文档明确计算）；付费按自然月 |
| 9 | 套餐名？ | Workers 免费版 / Workers Standard+ / 企业版；按 Neurons 计费（[定价页](https://developers.cloudflare.com/workers-ai/platform/pricing/)） |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration？ | 无余额。可拿：Used=Billable Usage / AI Gateway usage_history；Remaining/Percentage=「每日免费额度」口径可由 Used 推算；Reset=每日 UTC 零点 |
| 11 | 本地 Token Usage × 官方价格？ | 可行。AI Gateway / Workers AI 响应带 usage；DSH 目录内置两类模型单价（data/cloudflare-ai-gateway.json / cloudflare-workers-ai.json 有 cost 字段） |
| 12 | 额外权限？ | **冲突最小**：复用同一把 `CLOUDFLARE_API_KEY`；仅需在 CF 控制台给该 Token 追加 `Account > Billing > Read` 权限（已有 Workers AI 权限的 Token 通常需手动加）。无新凭证体系 |
| 13 | 公开官方 API vs 网页私有 API？ | 全部公开官方 REST/GraphQL API |
| 14 | 稳定性分级 + 定位 | Billable Usage 为 **Alpha（B 级）**，其余用量接口稳定；功能上最贴合插件（花费 + 免费额度倒计时）。定位 cloud_billing，**推荐正式集成（次选）** |

### 4.2 适配方案（10 项）

| 项 | 方案 |
|---|---|
| 可展示字段 | 本月 Workers AI/AI Gateway 花费（按产品聚合）、每日免费额度使用%（剩余）、每日重置倒计时 |
| 获取方法 | Billable Usage `paygo`（拿月度花费/用量聚合）；免费额度由「用量 vs 免费上限」推算；AI Gateway 明细走 usage_history |
| Endpoint | `https://api.cloudflare.com/client/v4/accounts/{account_id}/billing/usage/paygo`（Alpha；AI Gateway：`.../accounts/{id}/ai-gateway/billing/usage_history`） |
| Auth | 复用 `CLOUDFLARE_API_KEY` Bearer + 账户 ID；需 Billing 读权限 |
| 请求示例 | `GET /client/v4/accounts/{account_id}/billing/usage/paygo`（Header: Authorization: Bearer <key>，示例脱敏） |
| Response 示例 | `{"success":true,"result":[{"product":"workers-ai","usage":123456.7,"cost":0.9876,"currency":"USD"}]}`（示例字段名/结构以官方 schema 为准，待核实） |
| 刷新频率建议 | 1–6h（用量接口近实时）；免费额度倒计时可 30–60min |
| 错误处理 | 403→提示 Token 缺 Billing 读权限并给出控制台指引；Alpha 接口 500/结构变动→降级本地换算；429→退避 |
| 安全风险 | 低-中：复用管理 Token 读取计费数据；建议为该 Token 单独最小权限；勿输出账户级完整账单到信息栏（只显示聚合值） |
| 是否推荐 + billingMode | **推荐（次选）**：凭据可复用 + 有官方用量/计费 API + 免费额度倒计时是差异化卖点；注意 Alpha 风险。billingMode=`cloud_billing` |

---

## 5. vercel-ai-gateway（Vercel AI Gateway）

### 5.1 十四项事实清单

| # | 项目 | 结论 |
|---|---|---|
| 1 | DSH provider id | `vercel-ai-gateway`（baseUrl `https://ai-gateway.vercel.sh`） |
| 2 | DSH 认证方式 | `AI_GATEWAY_API_KEY`——Vercel AI Gateway 的**网关级 Key**（在 [AI Gateway 控制台](https://vercel.com/docs/ai-gateway/authentication-and-byok/api-keys) 创建，仅用于推理转发鉴权） |
| 3 | 消费方式 | 网关按转发 token 计费（模型厂商价 + 网关加价；[Pricing](https://vercel.com/docs/ai-gateway/pricing)），归属 Vercel 账户账单；有**网关 Credits（用量额度）**概念 |
| 4 | 官方 Balance API？ | **无公开余额 API**；账户扣费无「余额」直查 |
| 5 | 官方 Usage API？ | 有：[AI Gateway 用量与账单页](https://vercel.com/docs/ai-gateway/observability-and-spend/usage) 对应 REST 接口（[AI Gateway REST API](https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api)）；Vercel 平台侧有 [「通过 API 获取账单用量」](https://vercel.com/changelog/access-billing-usage-cost-data-api)（平台级用量/费用接口）与 [list-focus-billing-charges](https://vercel.com/docs/rest-api/billing/list-focus-billing-charges)（Focus 计费条目）。具体可查「网关 Credits/Spend」的端点路径**待核实** |
| 6 | 官方 Subscription/Plan API？ | 有账户订阅（Hobby/Pro/Enterprise），费用归账单；无「套餐配额」型读取 |
| 7 | Rate Limit 是否从 Response Headers 返回？ | Vercel API 与网关对 429 有 Retry-After；标准限流头**待核实** |
| 8 | Reset Time？ | 账单周期（自然月）重置；无头信息 |
| 9 | 套餐名？ | Vercel 账户 Plan（Hobby/Pro/Enterprise）+ 网关按量 Credits |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration？ | 无余额。可拿：Used=网关用量/账户费用；Remaining=网关 Credits（若有公开端点，待核实） |
| 11 | 本地 Token Usage × 官方价格？ | 可行。网关透传响应仍含 usage；DSH 目录内置网关模型单价（data/vercel-ai-gateway.json 有 cost 字段） |
| 12 | 额外权限？ | **冲突中**：`AI_GATEWAY_API_KEY` 仅能转发推理，**查不了费用** → 需另配 Vercel 账户 Token（`VERCEL_TOKEN`，含 Billing 读权限）或 OAuth，新增一套凭据 |
| 13 | 公开官方 API vs 网页私有 API？ | 官方公开 REST API（但使用时需再确认网关侧用量端点是否为公开 beta） |
| 14 | 稳定性分级 + 定位 | 网关产品较新、API 面**B-C 级**。**首版暂不接入**；定位 cloud_billing |

### 5.2 适配方案（10 项）

| 项 | 方案 |
|---|---|
| 可展示字段 | 本月网关花费 / 网关 Credits 用量与剩余%（若端点可用，待核实） |
| 获取方法 | AI Gateway REST API 用量端点 + Vercel 平台账单用量 API（changelog 所述） |
| Endpoint | `https://api.vercel.com/...`（平台账单/用量，具体路径待核实）；网关侧走 ai-gateway REST API |
| Auth | **新增** `VERCEL_TOKEN`（账户级，Billing 读权限）——不能复用 AI_GATEWAY_API_KEY |
| 请求示例 | `GET https://api.vercel.com/v1/...?teamId={team}`（Authorization: Bearer <VERCEL_TOKEN>；路径/参数待核实） |
| Response 示例 | `{"usage":[{"product":"ai-gateway","period":"2026-07","amount":12.34,"credits":...}]}`（示例结构，待核实） |
| 刷新频率建议 | 6–12h（账单口径；网关用量若支持可 1h） |
| 错误处理 | 401→提示需 create VERCEL_TOKEN；网关用量端点 404/门槛→降级本地换算并标注「估算」 |
| 安全风险 | 中：额外保存账户级 Token（比网关 Key 权限大得多），需最小权限与加密存储 |
| 是否推荐 + billingMode | 首版**不推荐**（额外账户 Token + 接口年轻、路径未完全公开）；roadmap 候选；billingMode=`cloud_billing` |

---

## 6. 汇总：推荐集成清单

| 平台 | DSH provider | 复用现有凭据？ | 官方计费/用量 API | 稳定性 | 首版结论 | billingMode |
|---|---|---|---|---|---|---|
| AWS Bedrock | amazon-bedrock | ✅ AWS 凭据（需补 IAM 权限） | ✅ CE/Budgets | A | **推荐集成** | cloud_billing |
| Cloudflare | cloudflare-ai-gateway / cloudflare-workers-ai | ✅ 同一把 CLOUDFLARE_API_KEY（补 Billing 读） | ✅ Billable Usage(Alpha)/AI Gateway | B | **推荐集成** | cloud_billing |
| Azure OpenAI | azure-openai-responses | ❌ 需另建服务主体 | ✅ Cost Mgmt/Budgets | A（接口）/ E（门槛） | 暂不接入 | cloud_billing |
| Google Vertex | google-vertex | ❌ API Key 不可查费；需服务账号+预算 | ⚠️ 预算 currentSpend（需预建预算） | A（接口）/ E（门槛） | 暂不接入 | cloud_billing |
| Vercel AI Gateway | vercel-ai-gateway | ❌ 需另配 VERCEL_TOKEN | ⚠️ 有但端点待核实 | B-C | 暂不接入 | cloud_billing |

- **通用兜底（三家暂不接入时也生效）**：本地「响应 usage × DSH 目录单价」换算花费，显示标注「估算」，不依赖任何云端计费接口。
- 首版实现顺序建议：`amazon-bedrock`（稳定）→ `cloudflare`（差异化：免费额度倒计时）→ 其余三家进 roadmap，等用户实际购买后再按需接入。

## 7. 主要来源

- AWS：https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_GetCostAndUsage.html · https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_billing_GetCredits.html · https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html · https://aws.amazon.com/bedrock/pricing/
- Azure：https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage · https://learn.microsoft.com/en-us/rest/api/consumption/balances/get-by-billing-account · https://learn.microsoft.com/en-us/rest/api/cost-management/budgets/get · https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits
- Google：https://docs.cloud.google.com/billing/docs/reference/rest · https://docs.cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets · https://docs.cloud.google.com/billing/docs/authentication · https://cloud.google.com/vertex-ai/generative-ai/docs/error-code-429
- Cloudflare：https://developers.cloudflare.com/api/resources/billing/subresources/usage/methods/paygo/ · https://developers.cloudflare.com/api/resources/ai_gateway/subresources/billing/methods/usage_history/ · https://developers.cloudflare.com/api/resources/ai_gateway/subresources/logs/methods/list/ · https://blog.cloudflare.com/billable-usage-api/ · https://developers.cloudflare.com/workers-ai/platform/pricing/ · https://developers.cloudflare.com/changelog/post/2025-09-03-rate-limiting-improvement/
- Vercel：https://vercel.com/docs/ai-gateway/pricing · https://vercel.com/docs/ai-gateway/observability-and-spend/usage · https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api · https://vercel.com/changelog/access-billing-usage-cost-data-api · https://vercel.com/docs/rest-api/billing/list-focus-billing-charges
- DSH 内部确认：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/env-api-keys.js`（provider→env 映射与认证特例）、`providers/data/*.json`（模型单价 catalog）