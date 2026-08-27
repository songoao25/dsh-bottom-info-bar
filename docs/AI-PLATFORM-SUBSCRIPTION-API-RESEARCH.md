# 国外 AI 平台订阅与 API 余额调研报告

**调研日期**: 2026-01  
**调研范围**: 7+ 主流国外 AI 平台的订阅套餐机制与 API 余额查询能力  
**用途**: 为 DSH 底部信息栏插件扩展多平台支持提供技术依据

---

## 一、OpenAI

### 1.1 订阅套餐（ChatGPT）

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Free | $0 | 有限 GPT-4o-mini 使用，高级模型受限 | 按会话限制 | [帮助文档](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-plus-pro) |
| ChatGPT Go | $5/月 | GPT-4o mini + 部分高级功能，有用量上限 | 月度重置 | 同上 |
| Plus | $20/月 | 更高 GPT-4o 配额，优先访问新模型 | 月度重置 | 同上 |
| Pro | $200/月 | 最高配额，包含 o1/o3 等推理模型大量使用 | 月度重置 | 同上 |
| Team | $25-30/用户/月 | 团队协作，管理控制台，统一账单 | 月度计费 | [Team 页面](https://openai.com/chatgpt/team/) |

**重要说明**: OpenAI 在 2025 年引入了 **Credits（积分）系统**，Plus/Pro 用户每月获得固定积分额度，不同模型消耗不同积分。额度按自然月重置，未用完不结转。这是典型的「订阅窗口制」。

### 1.2 API 余额查询

| 项目 | 详情 |
|------|------|
| 接口 URL | `https://api.openai.com/v1/dashboard/billing/credit_grants`（旧版，已逐步弃用）<br/>新版需通过 [Usage API](https://platform.openai.com/docs/api-reference/usage) 或 Dashboard |
| 请求方法 | GET |
| 认证方式 | Bearer Token (API Key) |
| 响应字段样例 | ```json { "object": "credit_summary", "total_granted": 18.00, "total_used": 12.34, "total_available": 5.66 } ``` |
| 是否公开稳定接口 | △ 仅对付费账户开放，且接口版本频繁变更；推荐通过 Dashboard 手动查看或使用官方 SDK |
| 官方文档链接 | [Billing API](https://platform.openai.com/docs/api-reference/billing) / [Usage API](https://platform.openai.com/docs/api-reference/usage) |

**接入可行性**: ✘ 无稳定公开的 API 接口。OpenAI 官方不提供实时余额查询的稳定 REST API，Dashboard 数据可通过浏览器自动化获取但不推荐生产环境使用。Codex wham 接口（如 `dsh-chatgpt-subscription` 插件所用）是社区逆向工程方案，非官方支持。

---

## 二、Anthropic Claude

### 2.1 订阅套餐（Claude.ai）

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Free | $0 | Claude Sonnet 有限次数，高峰期限流 | 每日重置 | [定价页](https://www.anthropic.com/pricing) |
| Pro | $20/月 | 约 5 倍 Free 用量，优先访问 Claude Opus/Sonnet | 月度重置 | 同上 |
| Max | $100/月 | 约 20 倍 Pro 用量，更高并发，早期访问新模型 | 月度重置 | 同上 |
| Team | $30/用户/月（最低 5 用户） | 团队协作，SSO，用量分析 | 月度计费 | [Team 页面](https://www.anthropic.com/team) |

**重要说明**: Anthropic 采用「消息计数 + token 限制」双重机制。Pro/Max 套餐有每月消息上限和每消息最大 token 限制。这是典型的「订阅窗口制」。详细限制见[官方文档](https://support.anthropic.com/en/articles/11647753-understanding-usage-and-length-limits)。

### 2.2 API 余额查询

| 项目 | 详情 |
|------|------|
| 接口 URL | 无公开余额查询接口 |
| 请求方法 | - |
| 认证方式 | - |
| 响应字段样例 | - |
| 是否公开稳定接口 | ✘ 无 |
| 官方文档链接 | [Usage & Cost 文档](https://platform.claude.com/docs/en/manage-claude/usage-cost-api.md) |

**接入可行性**: ✘ 无接口。Anthropic API 采用预充值 Credits 模式，但**不提供实时余额查询 API**。用户需在 [Console Dashboard](https://console.anthropic.com/) 手动查看剩余额度。API 调用失败时会返回 `429 Too Many Requests` 或 `402 Payment Required`，但无法提前获知余额。

---

## 三、Google Gemini

### 3.1 订阅套餐

Google Gemini 分为两条产品线：

#### A. Google AI Studio / Gemini Developer API（面向开发者）

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Free Tier | $0 | Gemini 1.5 Flash: 15 RPM, 1M TPM, 1500 RPD<br/>Gemini 1.5 Pro: 2 RPM, 32K TPM, 50 RPD | 每分钟/每天重置 | [定价页](https://ai.google.dev/gemini-api/docs/pricing) |
| Pay-as-you-go | $0.075-2.50 / 百万 tokens | 按实际用量计费，无固定配额上限 | 按月结算 | 同上 |

#### B. Vertex AI（企业级，走 Google Cloud 计费）

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| On-demand | 按 token 计费 | 无固定配额，受项目配额限制 | 持续可用 | [Vertex Pricing](https://cloud.google.com/vertex-ai/pricing) |
| Committed Use | 折扣价 | 承诺 1-3 年用量，享受折扣 | 合同期 | 同上 |

**重要说明**: Google AI Studio 的 Free Tier 是「速率限制制」（RPM/TPM/RPD），而非「总量窗口制」。付费档是按量计费，无月度配额概念。这是「充值余额制」变体。

### 3.2 API 余额查询

| 项目 | 详情 |
|------|------|
| 接口 URL | 无直接余额接口；通过 [Google Cloud Billing API](https://cloud.google.com/billing/docs/reference/rest) 查询项目费用 |
| 请求方法 | GET |
| 认证方式 | OAuth 2.0 / Service Account Key |
| 响应字段样例 | ```json { "billingAccountName": "billingAccounts/XXXXX", "cost": { "currencyCode": "USD", "units": "12", "nanos": 340000000 } } ``` |
| 是否公开稳定接口 | △ 仅适用于 Vertex AI（走 GCP 计费）；Google AI Studio 免费层无余额概念 |
| 官方文档链接 | [Gemini API Billing](https://ai.google.dev/gemini-api/docs/billing) / [Cloud Billing API](https://cloud.google.com/billing/docs) |

**接入可行性**: △ 只能文档实现或记账估算。Google AI Studio 免费层无余额概念（只有速率限制），付费层按量计费且无预充值余额。Vertex AI 可通过 GCP Billing API 查询累计费用，但无法实时显示「剩余额度」。建议本地记录调用次数进行估算。

---

## 四、OpenRouter

### 4.1 订阅套餐

OpenRouter **无传统订阅套餐**，纯按量计费平台。

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Pay-as-you-go | 各模型价格不同（通常 $0.1-10 / 百万 tokens） | 预充值 credits，按实际用量扣费 | 无过期时间 | [定价页](https://openrouter.ai/models) |

**重要说明**: OpenRouter 是路由聚合平台，用户预充值 credits，credits **永不过期**。这是典型的「充值余额制」，而非订阅窗口制。

### 4.2 API 余额查询

| 项目 | 详情 |
|------|------|
| 接口 URL | `https://openrouter.ai/api/v1/credits` |
| 请求方法 | GET |
| 认证方式 | Bearer Token (API Key) |
| 响应字段样例 | ```json { "data": { "credits": 15.42 } } ``` |
| 是否公开稳定接口 | ✔ 可真实查询，官方稳定接口 |
| 官方文档链接 | [Get Remaining Credits](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits) |

**接入可行性**: ✔ 可真实查询。OpenRouter 提供了简洁稳定的 REST API，返回当前剩余 credits（美元值）。认证只需在 Header 中携带 `Authorization: Bearer <API_KEY>`。这是目前最容易接入的平台之一。

---

## 五、xAI Grok

### 5.1 订阅套餐

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Free | $0 | Grok-3 有限访问 | 按会话限制 | [xAI 官网](https://x.ai/grok) |
| Premium | $16/月（X Premium 捆绑） | 无限 Grok 访问，包括 Grok-3 | 月度重置 | 同上 |

**重要说明**: xAI 主要通过 X（Twitter）Premium 订阅捆绑销售 Grok 访问，独立 API 产品尚在早期阶段。

### 5.2 API 余额查询

| 项目 | 详情 |
|------|------|
| 接口 URL | `https://api.x.ai/v1/usage`（Management API） |
| 请求方法 | GET |
| 认证方式 | Bearer Token (API Key) |
| 响应字段样例 | ```json { "data": { "total_tokens": 123456, "requests": 789 } } ``` |
| 是否公开稳定接口 | △ 仅返回累计用量，无剩余额度字段 |
| 官方文档链接 | [Usage Explorer](https://docs.x.ai/console/usage) / [Management API](https://docs.x.ai/developers/rest-api-reference/management) |

**接入可行性**: △ 只能文档实现或记账估算。xAI Management API 仅返回历史累计用量（tokens 和请求数），**不返回剩余额度或配额**。由于 Premium 是「无限访问」模式，理论上无余额概念，但可能存在隐性速率限制。建议本地记录调用频率进行监控。

---

## 六、Mistral AI

### 6.1 订阅套餐

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Free | $0 | Mistral Small/Large 有限用量，速率限制 | 按日/月限制 | [La Plateforme](https://mistral.ai/technology/#la-plateforme) |
| Pay-as-you-go | €0.1-2.0 / 百万 tokens | 按实际用量计费 | 按月结算 | [定价页](https://mistral.ai/technology/pricing/) |

**重要说明**: Mistral 采用混合模式：Free 层有速率限制，付费层按量计费。无传统订阅窗口制。

### 6.2 API 余额查询

| 项目 | 详情 |
|------|------|
| 接口 URL | 无公开余额接口 |
| 请求方法 | - |
| 认证方式 | - |
| 响应字段样例 | - |
| 是否公开稳定接口 | ✘ 无 |
| 官方文档链接 | [API 文档](https://docs.mistral.ai/) |

**接入可行性**: ✘ 无接口。Mistral 不提供实时余额查询 API。用户需在 [La Plateforme Console](https://console.mistral.ai/) 手动查看用量和账单。

---

## 七、Groq

### 7.1 订阅套餐

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Free Tier | $0 | Llama/Mixtral 模型，速率限制（RPM/TPM） | 每分钟重置 | [Groq Cloud](https://groq.com/) |
| Pay-as-you-go | 待公布 | 按 token 计费，更高配额 | 按用量结算 | 同上 |

**重要说明**: Groq 以超高速推理著称，目前主要面向开发者免费试用，商业化定价尚未完全公开。

### 7.2 API 余额查询

| 项目 | 详情 |
|------|------|
| 接口 URL | 无公开余额接口 |
| 请求方法 | - |
| 认证方式 | - |
| 响应字段样例 | - |
| 是否公开稳定接口 | ✘ 无 |
| 官方文档链接 | [API 文档](https://console.groq.com/docs) |

**接入可行性**: ✘ 无接口。Groq 不提供余额查询 API，Free Tier 仅有速率限制，无余额概念。

---

## 八、Together AI

### 8.1 订阅套餐

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Free Tier | $0 | $5 初始 credits，各类开源模型 | credits 用完为止 | [定价页](https://www.together.ai/pricing) |
| Pay-as-you-go | $0.1-10 / 百万 tokens | 预充值 credits，按用量扣费 | 无过期时间 | 同上 |

**重要说明**: Together AI 采用预充值 credits 模式，credits **永不过期**。Free Tier 赠送 $5 credits 供测试。这是「充值余额制」。

### 8.2 API 余额查询

| 项目 | 详情 |
|------|------|
| 接口 URL | 无直接 REST API；需通过 [Developer Portal](https://api.together.xyz/settings) 查看 |
| 请求方法 | - |
| 认证方式 | - |
| 响应字段样例 | - |
| 是否公开稳定接口 | ✘ 无公开 API |
| 官方文档链接 | [Billing & Credits](https://docs.together.ai/docs/billing-credits) |

**接入可行性**: ✘ 无接口。Together AI 文档提到 credits 管理，但**未提供程序化查询接口**。用户需在 Web Console 手动查看剩余额度。

---

## 九、Cerebras

### 9.1 订阅套餐

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Free Tier | $0 | Llama 3.1 70B/405B，速率限制 | 每分钟重置 | [定价页](https://www.cerebras.ai/pricing) |
| Enterprise | 联系销售 | 定制化配额，SLA 保障 | 合同约定 | 同上 |

**重要说明**: Cerebras 主打超低延迟推理，目前以 Free Tier 吸引开发者，企业级定价需定制。

### 9.2 API 余额查询

| 项目 | 详情 |
|------|------|
| 接口 URL | 无公开余额接口 |
| 请求方法 | - |
| 认证方式 | - |
| 响应字段样例 | - |
| 是否公开稳定接口 | ✘ 无 |
| 官方文档链接 | [Rate Limits](https://inference-docs.cerebras.ai/support/rate-limits) |

**接入可行性**: ✘ 无接口。Cerebras 仅提供速率限制信息，无余额查询能力。

---

## 十、Perplexity

### 10.1 订阅套餐

#### A. Perplexity.ai（消费者产品）

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Free | $0 | 每日有限次搜索问答 | 每日重置 | [定价页](https://www.perplexity.ai/pricing) |
| Pro | $20/月 | 无限搜索，Sonar 模型，文件上传 | 月度重置 | 同上 |
| Business | $40/用户/月 | 团队协作，API 访问 | 月度计费 | 同上 |

#### B. Perplexity API（开发者产品）

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Pay-as-you-go | $1-15 / 百万 tokens | 按实际用量计费 | 按月结算 | [API 文档](https://docs.perplexity.ai/) |

**重要说明**: Perplexity 的消费者产品（Pro）是订阅窗口制，但 API 产品是按量计费。

### 10.2 API 余额查询

| 项目 | 详情 |
|------|------|
| 接口 URL | 无公开余额接口 |
| 请求方法 | - |
| 认证方式 | - |
| 响应字段样例 | - |
| 是否公开稳定接口 | ✘ 无 |
| 官方文档链接 | [Rate Limits & Usage Tiers](https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers) |

**接入可行性**: ✘ 无接口。Perplexity API 不提供余额查询，仅文档中提到速率限制层级。

---

## 十一、Hugging Face（可选）

### 11.1 订阅套餐

| 套餐名 | 价格 | 额度/权益 | 窗口周期 | 官网链接 |
|--------|------|-----------|----------|----------|
| Free | $0 | 公共模型推理，队列等待 | 按可用性 | [定价页](https://huggingface.co/pricing) |
| PRO | $9/月 | 优先推理，私有空间，更多存储 | 月度重置 | 同上 |
| Enterprise | 联系销售 | 专用硬件，SLA，SSO | 合同约定 | 同上 |

**重要说明**: Hugging Face Inference API 的 Free 层无保证，PRO 层提供优先访问但仍无固定配额。

### 11.2 API 余额查询

| 项目 | 详情 |
|------|------|
| 接口 URL | 无公开余额接口 |
| 请求方法 | - |
| 认证方式 | - |
| 响应字段样例 | - |
| 是否公开稳定接口 | ✘ 无 |
| 官方文档链接 | [Inference API 文档](https://huggingface.co/docs/api-inference/index) |

**接入可行性**: ✘ 无接口。Hugging Face 不提供用量或余额查询 API。

---

## 汇总对比表

| 平台 | 订阅类型 | API 余额接口 | 接入可行性 | 备注 |
|------|---------|-------------|-----------|------|
| **OpenAI** | 订阅窗口制（Credits 月度重置） | ✘ 无稳定接口 | ✘ | Codex wham 为社区逆向方案 |
| **Anthropic** | 订阅窗口制（消息+token 双限制） | ✘ 无接口 | ✘ | 仅 Dashboard 可查看 |
| **Google Gemini** | 速率限制制 + 按量计费 | △ GCP Billing API（仅 Vertex） | △ | 免费层无余额概念 |
| **OpenRouter** | 充值余额制（永不过期） | ✔ `/api/v1/credits` | ✔ | **最易接入** |
| **xAI Grok** | 订阅窗口制（捆绑 X Premium） | △ 仅累计用量 | △ | 无剩余额度字段 |
| **Mistral** | 速率限制制 + 按量计费 | ✘ 无接口 | ✘ | 仅 Console 查看 |
| **Groq** | 速率限制制（Free Tier） | ✘ 无接口 | ✘ | 商业化定价未完全公开 |
| **Together AI** | 充值余额制（永不过期） | ✘ 无公开 API | ✘ | 仅 Web Console 查看 |
| **Cerebras** | 速率限制制（Free Tier） | ✘ 无接口 | ✘ | 企业定制为主 |
| **Perplexity** | 订阅窗口制（Pro）+ 按量计费（API） | ✘ 无接口 | ✘ | 消费者与 API 分离 |
| **Hugging Face** | 订阅窗口制（PRO） | ✘ 无接口 | ✘ | 推理队列制 |

---

## 结论与建议

### 高优先级接入目标

1. **OpenRouter**（✔ 可真实查询）
   - 唯一提供稳定公开余额接口的平台
   - 接口简单：`GET /api/v1/credits` 返回 `{ "data": { "credits": 15.42 } }`
   - 充值余额制，credits 永不过期，适合长期监控

2. **DeepSeek**（已支持）
   - 已有余额查询接口

### 中等优先级（需记账估算）

3. **Google Gemini**（△ 部分可实现）
   - Vertex AI 可通过 GCP Billing API 查询累计费用
   - 需本地记录调用次数进行剩余额度估算

4. **xAI Grok**（△ 部分可实现）
   - Management API 返回累计用量
   - 由于是「无限访问」模式，仅需监控调用频率防限流

### 低优先级（暂不支持）

5. **OpenAI / Anthropic / Mistral / Together AI / 其他**（✘ 无接口）
   - 均无公开稳定余额查询 API
   - 如需支持，需依赖社区逆向工程方案（如 Codex wham）或用户手动配置本地记账
   - 风险：接口不稳定，可能随时失效

### 技术建议

- **优先实现 OpenRouter 支持**：接口稳定、文档清晰、认证简单
- **对于无接口平台**：可提供「本地记账模式」，用户手动输入初始额度，插件根据调用记录自动扣减并提示更新
- **订阅窗口制平台**：需额外处理「窗口重置逻辑」（如每月 1 日清零），增加复杂度

---

**数据来源**:
- [OpenAI Help Center - Credits System](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-plus-pro)
- [Anthropic Platform Docs - Usage & Cost](https://platform.claude.com/docs/en/manage-claude/usage-cost-api.md)
- [Anthropic Support - Usage Limits](https://support.anthropic.com/en/articles/11647753-understanding-usage-and-length-limits)
- [Google AI - Gemini API Billing](https://ai.google.dev/gemini-api/docs/billing)
- [Google AI - Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Google AI - Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [OpenRouter API Docs - Get Remaining Credits](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits)
- [OpenRouter TypeScript SDK - GetCreditsResponse](https://openrouter.ai/docs/client-sdks/typescript/models/operations/getcreditsresponse)
- [xAI Docs - Usage Explorer](https://docs.x.ai/console/usage)
- [xAI Docs - Management API](https://docs.x.ai/developers/rest-api-reference/management)
- [Together AI Docs - Billing & Credits](https://docs.together.ai/docs/billing-credits)
- [Cerebras Pricing](https://www.cerebras.ai/pricing)
- [Cerebras Docs - Rate Limits](https://inference-docs.cerebras.ai/support/rate-limits)
- [Perplexity Docs - Rate Limits & Usage Tiers](https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers)
- [Perplexity API Pricing](https://costbench.com/software/llm-api-providers/perplexity-api/)
- [Tracking Claude, Codex, and Gemini Quotas](https://ianlpaterson.com/blog/tracking-claude-codex-gemini-quotas-from-one-script/)
