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
| `openai-codex`、`opencode`、`opencode-go`、`zai`、`zai-coding-cn`、`xiaomi-token-plan-*`、`minimax`、`minimax-cn` | 是 | 真实订阅/套餐数据 | 走各自已适配的额度来源 |
| `together`、`fireworks`、`amazon-bedrock`、`cloudflare-ai-gateway`、`cloudflare-workers-ai` | 是 | 真实本月账单 | 走服务商/云账户账单接口 |
| `ant-ling`、`anthropic`、`azure-openai-responses`、`baseten`、`cerebras`、`github-copilot`、`google`、`google-vertex`、`groq`、`huggingface`、`kimi-coding`、`mistral`、`nvidia`、`qwen-token-plan`、`qwen-token-plan-cn`、`qwen-token-plan-individual`、`vercel-ai-gateway`、`xai` | 是 | 明确降级 | 当前没有可由 DSH 常规推理凭据安全、稳定读取的统一余额/配额接口；仍显示模型并保持本地账本 |

## 为什么不直接把所有管理接口都接上

“有一个管理 API”不等于“可拿当前模型 API Key 去读”。例如 Anthropic、Mistral 和 xAI 的用量/账单 API 都可能要求单独的组织管理员或管理密钥，有的还要求 team/workspace id；把普通推理密钥发送到这些端点既会失败，也会误导用户配置凭据。插件目前不自动猜测团队标识、不提升权限、不读取网页 Cookie，也不调用写操作。

后续为某一服务商增加账户数据适配前，必须同时满足：官方稳定文档、只读端点、明确的最小权限凭据、可测试的响应样本、币种/时间范围语义，以及失败时不覆盖旧快照。否则维持“模型与账本 + 明确降级”。

## 维护约束

`src/constants.js` 中的 `DSH_PRESET_PROVIDERS` 是测试锁定的宿主兼容性基线。DSH 增加预置 provider 时，必须先为它在 `PROVIDER_IDENTITY` 指定账户归属和在需要时指定默认账本币种；测试不允许它悄悄退化为未知服务商。
