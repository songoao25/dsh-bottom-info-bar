# 迭代路线图：底部信息栏（dsh-bottom-info-bar）

> 第 8 阶段产出 · 本条目的：把用户反馈变成下一版计划，回环后进入新一轮开发。
> 状态：反馈已归档，方向待用户确认（Gate 8）。

## 反馈池

| 反馈 | 来源 | 优先级 | 建议方案 |
|---|---|---|---|
| 底部插件未适配「智谱清言」的余额与 token 套餐（订阅额度） | 用户直接反馈 | 高 | 调研智谱清言会员套餐 + BigModel API 余额接口，新增 zhipu 适配器（订阅制/余额制按平台形态接入） |
| 底部插件未适配「阿里云百炼」的 Token Plan | 用户直接反馈 | 高 | 调研阿里云百炼 Token Plan 结构与查询方式，新增 bailian/qwen 适配器 |
| 【Bug】本对话/今日/本月/全部花费没按服务商分家：切到 DeepSeek 后仍显示整个会话（含 OpenCode 期间记录）的合计，用户误以为扣了 DeepSeek 的钱 | 用户直接反馈（现场实证：会话 18 笔全为 opencode-go，¥0.88 被混入 DeepSeek 视图） | 高 | 花费统计按「服务商账户」隔离聚合：本对话/今日/本月/全部都只算当前服务商的记录 |
| 【Bug】余额显示没做区分：对未适配服务商（含 opencode-go）一律回退显示 DeepSeek 余额（现场实证：provider=opencode-go 查余额返回 DeepSeek ¥22.47 + 401） | 用户直接反馈（现场实证） | 高 | 余额账户映射严格跟随当前服务商；未适配/未知服务商不再回退 DeepSeek，显示"未适配/估算"引导 |
| 用户要求：把国产 AI 和国外 AI 的订阅套餐 + 订阅的 API 余额「全都适配一遍」 | 用户直接反馈 | 高 | 全量调研国产/国外平台（OpenAI、Claude、Gemini、OpenRouter、Kimi、豆包等），按「可真实接入 → 记账估算 → 无接口」分级，分批开发 |

## 现状盘点（2026-08-24）

- 已支持：余额制（DeepSeek 真实余额、OpenAI 记账回退估算）+ 订阅制（ChatGPT 会员 wham 接口、OpenCode Go usage 接口）
- 双模式机制已成型：`detectBillingMode` 按 provider 自动判定；`SUBSCRIPTION_PROVIDERS` 集合可增删；窗口映射（5小时/周/月）+ 剩余百分比 + 重置倒计时 + 60s 快照刷新 + 失败退避 —— **新服务商接入 = 新增适配器 + 注册 provider，架构复用成本低**

## 路线图（Now / Next / Later，依据 2026-08-27 全品牌调研总报告 docs/research/README.md）

### Now（v1.6：已开发完成，QA/审计通过，待发布）
- 分账修复（花费按服务商账户隔离）+ 余额严格跟随当前服务商（修两个现场 bug）
- 零设置四家：智谱（zai/zai-coding-cn）、Kimi（moonshotai）、OpenRouter、StepFun
- 未适配服务商优雅降级（"未适配/未配置"引导，不串台不冒充）

### Next（v1.7：调研结论的第一批增量，**只做"真实可查"项，零估算**）
用户原则（2026-08-27 定稿）：只做服务商官方真实返回的余额/额度/账单；任何本地估算显示一律不做。
1. OpenAI / ChatGPT 订阅卡（本机 JWT 本地解析真实套餐/到期；B/C 级，本机可验证）
2. 小米 MiMo（/v1/user/balance + /v1/tokenPlan/usage，真实余额+额度，B 级，零设置）
3. Together 本月真实账单（/billing/usage，B 级，复用凭据）
4. Fireworks 本周期真实账单（billingUsage 三端点，B 级，复用凭据）
5. AWS Bedrock 本月真实云账单+预算%（Cost Explorer/Budgets，A 级，复用 AWS 凭据）
6. Cloudflare 真实用量 + 每日免费额度剩余/倒计时（Billable Usage，B 级，复用 API Key）
- 统一数据模型（ProviderAccountStatus）聚合层开始落地

### 明确不做的估算类（用户原则，记录理由）
- Claude / Gemini / 腾讯混元 本地花费核算（usage×价格=估算，用户明确不要）
- NVIDIA 角标 / Groq 速率卡 / Cerebras / HuggingFace 估算（同上）
- xAI / Mistral / MiniMax 进阶真实接口（需用户额外提供独立密钥，不符合零设置；留 v1.8 待用户明确）
- 阿里云百炼 Token Plan（官方无 API Key 路径，等官方开放或用户自愿用 CLI 登录态）

## 不做（明确排除，长期）
- 不接入需要用户提供平台控制台 AccessKey/密码的查询方式（安全边界：零密钥落盘、只用 API Key 或已保存登录态）——除非调研证明必要且安全
- 不替用户处理绑定/续费/刷新令牌（继续由独立插件 dsh-chatgpt-subscription 负责 ChatGPT 系）

## 下一版本计划
- 版本号：**v1.7.0**（v1.6 内容一并合并发布：分账修复 + 智谱/Kimi/OpenRouter/StepFun + v1.7 六项真账适配）
- 做：分账修复 + 四家零设置适配（v1.6 已就绪）+ OpenAI 订阅卡/小米 MiMo/Together/Fireworks/AWS/Cloudflare（v1.7 真账六项）
- 不做：任何本地估算显示（用户原则）；信息栏 UI 架构改动/新页面

## 回环
- Gate 8 用户确认后：新功能 → 回阶段 1（调研结果已在途）→ 阶段 2 PRD（多服务商适配需求文档）→ 阶段 3 设计 → 阶段 4 开发/QA/审计 → 阶段 5 发布