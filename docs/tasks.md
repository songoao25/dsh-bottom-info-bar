# 任务清单：底部信息栏 v1.6

> 粒度 ≈ 一次 PR；每任务独立验收；依赖明确。开发按序执行，完成后跑全量测试。

| # | 任务 | 验收标准 | 依赖 |
|---|---|---|---|
| T1 | 账户映射表：新增 `accountForProvider(pid)`（deepseek/deepseek-official→deepseek；openai→openai；moonshotai/moonshotai-cn/kimi-coding→moonshotai；openrouter→openrouter；stepfun→stepfun；codex/chatgpt/openai-codex→订阅源codex；opencode-go/opencode→订阅源opencode-go；zai/zai-coding-cn→订阅源zai；未知→null）；`balanceProviderKey` 改用该表，未知返回 null 不再回退 config.activeProvider | 单测：未知 provider 返回 null；deepseek-official→deepseek；moonshotai-cn→moonshotai；不再有"未知→activeProvider"路径 | - |
| T2 | 花费账户隔离：`recordAccount(r)`；sessionTotals 增加账户维度；本对话/今日/本月/近30天/全部/summary 全部按 当前活跃账户 + 币种过滤；`providerSpend` 改为按 recordAccount 过滤（修复 deepseek-official 记录不计入 deepseek 的问题） | 单测：同会话 OpenCode+DeepSeek 记录，活动账户=deepseek 时只出 deepseek 金额；无记录账户显示 0；既有 spend-accounting 断言更新为账户口径 | T1 |
| T3 | moonshotai 余额适配器：PROVIDERS 条目 {credential:'MOONSHOT_API_KEY', balanceAPI:'https://api.moonshot.cn/v1/users/me/balance', parseBalance: balance_infos→{currency,total,granted,toppedUp}}；凭据回退 KIMI_API_KEY | 单测：官方响应样例解析正确；401/超时/无凭据→对应降级 error，不崩溃；60s 刷新走通用机制 | T1 |
| T4 | openrouter 余额适配器：PROVIDERS 条目 {credential:'OPENROUTER_API_KEY', balanceAPI:'https://openrouter.ai/api/v1/credits', parseBalance: data.credits→USD total} | 单测：{data:{credits:15.42}}→total 15.42 USD；失败降级 | T1 |
| T5 | stepfun 余额适配器：PROVIDERS 条目 {credential:'STEPFUN_API_KEY', balanceAPI:'https://api.stepfun.com/v1/accounts', Bearer；parseBalance: balance→total(CNY)/total_cash_balance/total_voucher_balance/type} | 单测：按官方文档响应样例解析（无 token_plan 预期）；401/超时/无凭据→降级 | T1 |
| T6 | zai 订阅源：SUBSCRIPTION_PROVIDERS/SUBSCRIPTION_SOURCES/subscriptionSourceFor += zai/zai-coding-cn；`fetchZaiUsage`（凭据 ZAI_CODING_CN_API_KEY→ZAI_API_KEY 回退；host=open.bigmodel.cn / api.z.ai，**两者均裸 API Key 无 Bearer**）；`parseZaiQuota`（TOKENS_LIMIT、unit 3→5小时、percentage→usedPercent、nextResetTime→resetsAt；未知跳过；level/planName→套餐名） | 单测：响应样例解析正确；未知 unit/类型跳过；401/超时/无凭据→降级；走通用订阅刷新/退避机制 | - |
| T7 | 客户端改造：**新建 plugin/src/constants.js 共享常量**（订阅 provider 集合，host/client 共用）；visibleBillingMode 兜底用常量；subscriptionServiceName += 智谱/Z.ai；余额"未配置"提示按账户显示凭据名；未适配账户渲染"未适配"引导 | 单测：客户端纯函数各映射正确，常量一致性断言；真机渲染目测：订阅制显示"智谱 · 模型 + 5h xx% + 倒计时"；未适配显示"未适配"；未知账户记录仍持久化但不计入任何金额 | T1,T6 |
| T8 | 定价表补充：GLM-4.5/4.6（智谱）、Kimi K2.7/K3（moonshot）、Step-2（stepfun）官方价格录入 PRICING（flat，CNY/USD 按官方），同步 docs/PRICING-SOURCES.md 复核日期与来源 | 每模型价格与官方价格页一致（来源链接可查）；未收录模型仍不臆测 | - |
| T9 | 测试更新与全量回归：新增 T1–T7 相关单测；更新 test-spend-accounting 等受影响断言；tests/run-all.mjs 全绿；构建 plugin/lib 产物 | 全量测试通过（现有 10+ 组 + 新增全绿）；lib 与 src 同步 | T1–T8 |
| T10 | 用户视角文档：README.md / README.zh-CN.md（支持服务商列表、零配置说明）、CHANGELOG.md（v1.6.0 Added/Fixed/Security 规范条目）、docs/INSTALL.md 如涉及 | 文档无开发内部代号/路径；功能描述与实现一致 | T9 |
| T11 | 真实环境验证（用户在智谱配置了 ZAI_API_KEY）：切换 zai 服务商后信息栏显示真实套餐额度；同时验证 deepseek 分账无串账；记录验证结果到 docs/ | 用户当场看到智谱真实额度；切 DeepSeek 后本对话/余额与 OpenCode 完全隔离 | T9 |

## 说明
- 安全自查并入 T9/T11 之间：凭据零落盘、错误信息不含密钥、订阅 RPC 同源防护不变；独立安全审计在 QA 阶段执行。
- 阿里云百炼（v1.7）：不在本版任务内，仅保留 ROADMAP 记录。