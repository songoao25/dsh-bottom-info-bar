# DSH 预置服务商兼容性

本表的“支持”按可验证能力划分，而不是把没有数据的服务商显示成 `¥0`、`$0` 或“未适配”。

- **模型与账本**：识别 DSH 当前会话的服务商/模型；记录该会话的输入、缓存和输出 token，并按明确的币种分账。没有已核验定价或宿主上报金额时，金额保持未定价，不猜测。
- **账户数据**：读取真实余额、配额或本月账单。只有接口、凭据种类和返回语义都已确认时才启用。
- **明确降级**：服务商已支持模型和本地账本，但不能安全读取账户数据时显示“无公开账户数据”，而不是“未适配”。

## 当前 DSH 桌面端预置目录（2026-09-26）

| 服务商 id | 模型与账本 | 账户数据形态 | 说明 |
| --- | --- | --- | --- |
| `deepseek` | 是 | 真实余额 | API Key 或桌面内置账号通道 |
| `moonshotai` | 是 | 真实余额 | 国际站，美元账户桶 |
| `moonshotai-cn` | 是 | 真实余额 | 中国站，人民币账户桶；不与国际站串账 |
| `openrouter`、`stepfun`、`xiaomi` | 是 | 真实余额 | 已核验的服务商账户端点 |
| `openai` | 是 | 估算余额 | OpenAI 没有通用公开余额端点；估算值会明确标注 |
| `openai-codex`、`opencode`、`opencode-go`、`zai`、`zai-coding-cn`、`xiaomi-token-plan-*`、`minimax`、`minimax-cn`、`qwen-token-plan`、`qwen-token-plan-cn`、`qwen-token-plan-individual`、`kimi-coding` | 是 | 真实订阅/套餐数据 | 走各自已适配的额度来源；阿里 Token Plan 与 Kimi For Coding 的验证边界见文末小节 |
| `together`、`fireworks`、`amazon-bedrock`、`cloudflare-ai-gateway`、`cloudflare-workers-ai` | 是 | 真实本月账单 | 走服务商/云账户账单接口 |
| `ant-ling`、`anthropic`、`azure-openai-responses`、`baseten`、`cerebras`、`github-copilot`、`google`、`google-vertex`、`groq`、`huggingface`、`mistral`、`nvidia`、`vercel-ai-gateway`、`xai` | 是 | 明确降级 | 当前没有可由 DSH 常规推理凭据安全、稳定读取的统一余额/配额接口；仍显示模型并保持本地账本 |

## 为什么不直接把所有管理接口都接上

“有一个管理 API”不等于“可拿当前模型 API Key 去读”。例如 Anthropic、Mistral 和 xAI 的用量/账单 API 都可能要求单独的组织管理员或管理密钥，有的还要求 team/workspace id；把普通推理密钥发送到这些端点既会失败，也会误导用户配置凭据。插件目前不自动猜测团队标识、不提升权限、不读取网页 Cookie，也不调用写操作。

后续为某一服务商增加账户数据适配前，必须同时满足：官方稳定文档、只读端点、明确的最小权限凭据、可测试的响应样本、币种/时间范围语义，以及失败时不覆盖旧快照。否则维持“模型与账本 + 明确降级”。

## 维护约束

`src/constants.js` 中的 `CREDENTIAL_CATALOG` 是额度数据源的单一生源：host 的可写凭据白名单、设置页「额度凭据」区、测试的覆盖守卫都从它派生；新增一个来源只改这张表 + fetch/parse，不要在别处再硬编码凭据名。适配新服务商的选型顺序、凭据规则与验收清单见 [CONTRIBUTING.md 的 “Quota data source adapters”](../CONTRIBUTING.md#quota-data-source-adapters)。

`src/constants.js` 中的 `DSH_PRESET_PROVIDERS` 是测试锁定的宿主兼容性基线。DSH 增加预置 provider 时，必须先为它在 `PROVIDER_IDENTITY` 指定账户归属和在需要时指定默认账本币种；测试不允许它悄悄退化为未知服务商。

### Volcengine Ark

Custom provider `volcengine-ark` is recognized without an account balance API. Built-in pricing covers `deepseek-v4-1-flash-economy-261017` and `deepseek-v4-1-flash-261017`, using Beijing weekday peak windows (09:00–12:00, 14:00–18:00) at request completion. Prices verified against [Ark pricing](https://www.volcengine.com/docs/ark/model-pricing) on 2026-10-29. Cache storage fees are excluded. Historical account assignments and stored costs are unchanged; previously unpriced records are not backfilled. Other custom provider IDs and model aliases require separate pricing entries.

### 阿里 Token Plan（百炼 Credits 订阅）

Provider id `qwen-token-plan`、`qwen-token-plan-individual`（国际站 `ap-southeast-1`）与 `qwen-token-plan-cn`（中国站 `cn-beijing`），信息栏显示名统一为 Qwen Token Plan；两个站点的额度快照各自独立，不串账。额度没有 API Key 数据面端点：推理套餐 Key（`sk-sp-…`）只能推理，读不到额度，所以改用阿里云 AccessKey（`ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET`，RAM 用户即可），走两条只读链路——一是官方 OpenAPI `GetSubscriptionStats`（按席位汇总总/剩余 Credits），二是官方 CLI 同款链路（AK/SK 换控制台临时令牌，再从控制台网关取月度已用百分比与重置时间）。RAM 用户需由主账号在 RAM 控制台同时授予系统策略 `AliyunTokenPlanReadOnlyAccess` 与 `AliyunBSSReadOnlyAccess`，并在百炼控制台「账号管理」分配管理员或订阅套餐权限（只授系统策略、漏掉这步分配，额度仍读不到）；控制台链路还需额外自定义策略授予 `modelstudio:GenerateCLIAccessToken`。任一链路成功即显示对应窗口；都失败时按“未配置 / 凭据或权限不足 / 未订阅 / 无法识别”给可操作提示，并保留上一份成功快照，不显示 0%。凭据可以在插件设置页的「额度凭据」里直接填（写入 DSH 凭据存储，不写插件配置），也可以走环境变量。两条链路都只读，不读浏览器 Cookie，也不写远端状态。验证程度：签名与解析按官方文档、官方 CLI 源码实现并有单测覆盖，但尚未用真实订阅账号做端到端实测——个人版 `GetSubscriptionStats` 的返回形态与国际站网关组合以实机为准。

### Kimi For Coding

Provider id `kimi-coding`，凭据是订阅的专属 API Key（`KIMI_API_KEY`，DSH 里 kimi-coding 的凭据名；回退 `KIMI_CODING_API_KEY` / `MOONSHOT_API_KEY`），以 Bearer 调 `GET https://api.kimi.com/coding/v1/usages`，国内站失败时自动回退国际站 `https://api.kimi.ai/coding/v1/usages`；显示 5 小时与周两个窗口，401/403 按凭据失效提示，不显示 0%。Key 同样可以在插件设置页的「额度凭据」里填。Kimi 没有公开的官方文档，端点与字段来自三份独立社区实现的一致口径，属于非官方文档接口，可能随上游变化；解析失败时保留上一份快照并提示无法识别。验证程度：解析层有单测覆盖，端点本身未在本机用真实 Key 实测。
