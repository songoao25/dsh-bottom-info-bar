# 全品牌适配调研总报告（Provider 全景矩阵）

> 依据用户调研任务书（15 模型品牌 + 11 平台/网关，每家 14 问 + A–E 稳定性分级 + 适配方案）。
> 分项报告：docs/research/A1–A9（每份含 14 项能力核查、10 项适配方案、来源 URL、待核实清单）。
> 稳定性：A=官方公开 API；B=官方 SDK/CLI 使用未正式公开；C=响应头/OAuth 可稳定获取；D=网页私有接口；E=只能本地估算。

## 一、总矩阵

| # | 品牌/平台 | DSH provider | billingMode | 余额/额度查询方式 | 稳定性 | 集成建议 |
|---|---|---|---|---|---|---|
| 01 | DeepSeek | deepseek | pay_as_you_go | /user/balance（官方） | A | ✅ 已集成（v1.0+） |
| 02 | OpenAI API | openai | pay_as_you_go | 无余额 API；Usage × 官方价本地算 | A(usage)/余额E | ◐ 能力就绪，待用户 Key（已有记账估算） |
| 03 | OpenAI Codex / ChatGPT 订阅 | openai-codex | subscription | ~/.codex/auth.json JWT 本地解析（套餐/到期/花费） | B/C | ✅ 强烈推荐立即集成（本机可验证） |
| 04 | 智谱 Z.ai/GLM | zai / zai-coding-cn | coding_plan | GET {host}/api/monitor/usage/quota/limit（裸 Key） | B/C | ✅ 已实现（v1.6，待真实密钥实测） |
| 05 | Kimi/Moonshot | moonshotai / moonshotai-cn | pay_as_you_go | /v1/users/me/balance（官方） | A | ✅ 已实现（v1.6） |
| 06 | Kimi Coding | kimi-coding | coding_plan | /coding/v1/usages（5h+周窗口） | B | ➕ 可加（v1.7） |
| 07 | MiniMax | minimax / minimax-cn | token_plan | /v1/token_plan/remains（**需 Subscription Key**） | B | ⏸ 条件集成（密钥性质特殊） |
| 08 | 阿里百炼 Qwen TP | qwen-token-plan(-cn) | token_plan | 无 API Key 路径（仅控制台 Cookie/CLI，D） | D | ❌ 本期不集成，本地记账兜底+留档 |
| 09 | 小米 MiMo | xiaomi / xiaomi-token-plan-* | pay_as_you_go / token_plan | /v1/user/balance + /v1/tokenPlan/usage（Bearer，半公开） | B | ✅ 集成（零设置，意外之喜） |
| 10 | StepFun | stepfun（自定义） | pay_as_you_go | /v1/accounts（官方） | A | ✅ 已实现（v1.6，待真 Key 实测） |
| 11 | 腾讯混元 | 自定义 | pay_as_you_go / cloud_billing | 兼容接口本地核算（B+）；真实余额需云密钥（可选） | B+/B- | ➕ 本地花费核算可加；云余额可选高级 |
| 12 | Anthropic Claude | anthropic | pay_as_you_go / subscription | 本地 usage×价（A）；订阅周额度逆向 oauth/usage（C，可静默降级） | A/C | ➕ P1 本地花费核算；订阅逆向可选 |
| 13 | Google Gemini | google | pay_as_you_go / free_tier | usageMetadata 本地累计（免费层无余额概念） | A(usage)/余额E | ➕ P1 本地花费核算 |
| 14 | xAI/Grok | xai | pay_as_you_go | 本地记账主干；Management API prepaid/balance（需独立 Key+team_id） | A-/自治 | ➕ P1 本地记账；进阶可选 |
| 15 | NVIDIA | nvidia | free_tier | Credits 体系 2025 已移除，无可读接口 | C- | 🔹 仅轻量角标（免费试用·限速） |
| 16 | Mistral | mistral | pay_as_you_go | Beta Admin API（需独立 Admin Key）；本地记账 | B- | ➕ P2 本地记账；进阶可选 |
| 17 | Meta Llama | —（生态） | — | 一律查承载平台账户（见 A8 对照表） | — | 原则：按 Provider 计费 |
| 18 | OpenRouter | openrouter | aggregator | /api/v1/credits（官方） | A | ✅ 已实现（v1.6） |
| 19 | Groq | groq | free_tier | 4 维 rate-limit headers（RPM/TPM/RPD/TPD） | B | ➕ P2 速率卡片 |
| 20 | Together | together | aggregator | /billing/usage（本月已用 $） | B | ➕ P1 花费卡片 |
| 21 | Fireworks | fireworks | aggregator | billingUsage 三端点（需先解析 account_id） | B | ➕ P1 花费卡片 |
| 22 | Cerebras | cerebras | — | 无公开 API（仅控制台网页） | E | ➕ 仅本地估算 |
| 23 | HuggingFace | huggingface | — | 无公开余额/用量 API | C/E | ➕ 仅本地估算 |
| 24 | AWS Bedrock | amazon-bedrock | cloud_billing | Cost Explorer + Budgets（复用 AWS 凭据，SigV4） | A | ✅ 推荐集成（周期花费，账单延迟~24h） |
| 25 | Azure OpenAI | azure-openai-responses | cloud_billing | 计费需另建 Azure AD 主体，API Key 查不了 | — | ❌ 暂不接入 |
| 26 | Google Vertex | google-vertex | cloud_billing | 需服务账号+预建预算，API Key 无效 | — | ❌ 暂不接入 |
| 27 | Cloudflare | cloudflare-ai-gateway / workers-ai | cloud_billing | Billable Usage（复用 CLOUDFLARE_API_KEY）+ 每日免费额度倒计时 | B | ✅ 推荐集成（差异化卖点） |
| 28 | Vercel | vercel-ai-gateway | cloud_billing | 需另配 VERCEL_TOKEN，用量端点待核实 | — | ❌ 暂不接入 |

## 二、推荐路由（按版本）

### v1.6（已开发完成，待发布）
分账修复（FR-1/2）+ 零设置四家：**智谱（zai/zai-coding-cn）· Kimi（moonshotai）· OpenRouter · StepFun**。

### v1.7 建议（第一批增量，全部零设置/低门槛）
1. **OpenAI Codex / ChatGPT 订阅卡**：本机 JWT 本地解析（套餐+到期+花费），零网络请求、零新增配置，本机可当场验证——性价比最高
2. **小米 MiMo**：/v1/user/balance + /v1/tokenPlan/usage，零设置（复用 DSH 内置密钥）
3. **Claude / Gemini 本地花费核算**：usage × 官方价（官方字段 A 级）
4. **Together / Fireworks 花费卡片**（aggregator 已有凭据）
5. **AWS Bedrock 周期花费**（复用 AWS 凭据）
6. **Cloudflare 免费额度倒计时**（复用 API Key，差异化）
7. **腾讯混元：兼容接口本地花费核算**（官方 APIKey 免签名）

### v1.8+（有前置条件/低优先级）
- Kimi Coding（kimi-coding，B）、MiniMax Token Plan（需 Subscription Key）、xAI（独立 Management Key 进阶）、Mistral（Admin Key）、Groq 速率卡、腾讯混元云余额（需云密钥）
- 百炼 Token Plan：**等官方开放 API Key 可查接口，或用户自愿用 CLI 登录态**后接入（本期明确不做）
- NVIDIA：仅轻量角标

### 明确不做（记录理由）
- Azure / Vertex / Vercel 云主体计费（凭据不可复用，配置成本过高，有需求时再评估）
- Gemini CLI / Claude Code 订阅逆向中不稳定的部分（C 级项目默认关闭，仅在探测到本地登录态且用户显式开启时启用）
- Gemini CLI/Code Assist 配额（服务端计算，无接口，E）

## 三、统一数据模型落地（见 docs/PROVIDER-DATA-MODEL.md）
所有适配器收敛到 ProviderAccountStatus：billingMode 枚举 + quotaWindows + cashBalance/giftBalance/creditBalance + source 分级——客户端一套渲染逻辑。

## 四、待核实清单（进入 v1.7 QA 真弹验证）
- 智谱 level→套餐名映射、国际端按量余额、GLM-4.6/4.7 精确单价
- 小米 cn/ams 集群响应形态、resetAt 字段
- Kimi balance 现网格式（新旧两种）
- MiniMax 档位名/速率头
- StepFun/混元响应头限速字段
- Claude 订阅逆向 usage 计量的已知 bug（GitHub #87419）
- Fireworks/Cerebras rate-limit headers 命名
- 混元免费包口径