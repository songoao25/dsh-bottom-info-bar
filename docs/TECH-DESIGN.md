# 技术设计：底部信息栏 v1.6（多服务商适配 + 分账修复）

## 方案概述（大白话）
插件有一套现成的"双模式机制"（余额制/订阅制 + 60s 刷新 + 失败保快照），v1.6 不改机制，只做三件事：
1. **给花费记账加上"户头"**：每条记录归属一个服务商账户，所有金额统计只数当前户头的钱 → OpenCode 的账永远进不了 DeepSeek 的视图；
2. **让余额严格认户主**：只有"认识的"服务商才查余额，认不出的显示"未适配"引导，绝不回退成 DeepSeek 余额；
3. **往机制里登记四个新服务商**：智谱（订阅额度）、Kimi、OpenRouter、阶跃星辰（余额），照着 DSH 的官方服务商 id 与官方密钥名自动识别，零设置。

沿用现状：零新增第三方依赖；记账文件格式不变；订阅令牌仍由独立插件维护。

## 技术选型
- **不引入任何新依赖/新框架**：沿用 node:fetch（请求）+ node:crypto（签名无需，四家全 Bearer/裸 Key）+ 现有 RPC/webServer 通道。
- **接口来源**：智谱 = 社区多项目验证的 quota 接口（🟢 稳定，见调研文档）；Kimi/OpenRouter = 官方文档公开接口（🟢）；阶跃 = 官方文档接口（⚠️ 实现时需实测，见风险）。
- **为什么不再做设置页**：用户明确要求零配置；DSH 凭据服务 `ctx.credentials.resolve(name)` 天然按密钥名读取，provider 的 id 即映射键。

## 关键设计

### 1. D1：服务商账户映射（分账 + 余额跟随的核心）
- 新增 `accountForProvider(pid)`：DSH provider id → 账户键；已知映射表：
  - `deepseek`/`deepseek-official` → `deepseek`（现逻辑）
  - `openai` → `openai`（估算账户）
  - `moonshotai`/`moonshotai-cn`/`kimi-coding` → `moonshotai`
  - `openrouter` → `openrouter`
  - `stepfun` → `stepfun`
  - `opencode-go`/`opencode` → 订阅源 `opencode-go`；`codex`/`chatgpt`/`openai-codex` → 订阅源 `codex`；`zai`/`zai-coding-cn` → 订阅源 `zai`
  - **未知 → null（不归属任何账户）**
- `balanceProviderKey(pid)` 改为基于该表：未知返回 null，**不再回退 config.activeProvider**（原回退即 Bug 2 根源）。

### 2. D2：花费按账户隔离（FR-1）
- `recordAccount(r)` = `accountForProvider(r.provider)`；null 视为"无主记录"，不进入任何账户汇总。
- 本对话（currentSessionSummary）、今日、本月/近30天、全部：全部改为 **账户过滤 + 币种过滤**（仅当账户匹配当前活动账户）。
- 会话聚合 `sessionTotals()`：增加账户维度参数——本对话统计只聚合当前账户记录（同一会话里其他账户的记录不计入）。
- 校准估算（median 会话）保留全量口径（用于"典型会话"参考，不参与具体金额显示）。

### 3. D3：余额账户与未适配降级（FR-2/FR-7）
- `PROVIDERS` 新增三个余额适配器（结构同 deepseek）：
  - `moonshotai`：credential `MOONSHOT_API_KEY`，`GET https://api.moonshot.cn/v1/users/me/balance`，解析 balance_infos（total/granted/topped_up，CNY）
  - `openrouter`：credential `OPENROUTER_API_KEY`，`GET https://openrouter.ai/api/v1/credits`，解析 data.credits（USD）
  - `stepfun`：credential `STEPFUN_API_KEY`，`GET https://api.stepfun.com/v1/accounts`（Bearer），解析 `balance`（可用余额，CNY）、`total_cash_balance`/`total_voucher_balance`、`type`（prepaid/postpaid）——**官方文档无 token_plan、无 currency 字段，不做此预期**
- `activeBalanceSummary` 对 null 账户返回 `{ provider: null, displayName: '未适配', unmapped: true, data: null }`；客户端渲染"未适配"引导。
- DSH 凭据名注册对照：ZAI_API_KEY / ZAI_CODING_CN_API_KEY / MOONSHOT_API_KEY / KIMI_API_KEY（moonshotai 回退）/ OPENROUTER_API_KEY / STEPFUN_API_KEY。

### 4. D4：智谱订阅额度适配（FR-3）
- `SUBSCRIPTION_PROVIDERS` += `zai`、`zai-coding-cn`；`subscriptionSourceFor` → 源 `zai`；客户端订阅识别列表同步 +=。
- 源实现 `fetchZaiUsage`：
  - 凭据：优先 `ZAI_CODING_CN_API_KEY`，回退 `ZAI_API_KEY`（按当前 provider 决定 host）
  - host：`zai-coding-cn` → `https://open.bigmodel.cn`；`zai` → `https://api.z.ai`（**两者认证方式一致：Authorization 头均裸放 API Key、无 Bearer 前缀**——依社区源码 tokn-provider-zai / ai-usagebar 交叉验证，加 Bearer 会返回 401）
  - 路径：`/api/monitor/usage/quota/limit`（GET，无参数）
  - 解析：`data.limits[]` 中 `type=TOKENS_LIMIT` 的窗口 → 统一窗口数组 `{key, label, usedPercent, resetsAt}`；`unit` 已知码（3=5小时）映射窗口键；未知 unit/类型跳过（沿用"未知跳过"哲学）；`data.level`/`planName` → 套餐名（lite/standard/pro/max → 智谱 Lite/Standard/Pro/Max）
- 订阅服务显示名：客户端 `subscriptionServiceName` += `zai`/`zai-coding-cn` → `智谱`（国际 `Z.ai`）。
- 预警沿用"剩余 ≤20% 红字"客户端机制。

### 5. D5：客户端展示（FR-1/2/3/7）
- **订阅识别列表提取为共享常量**（新建 `plugin/src/constants.js`，host 与 client 构建共用），消除两端硬编码漂移；客户端 `visibleBillingMode` 兜底使用该常量。
- 余额无密钥提示由写死的"DeepSeek"改为按账户显示 `未配置 {凭据名}`（如 `未配置 MOONSHOT_API_KEY`）。
- 未适配账户：渲染 `未适配` 弱提示（取代旧"余额获取失败"，避免误导）。

### 6. D6：记录归属策略（分账边界）
- 未知账户（`accountForProvider` 返回 null）的记录：**仍正常持久化到账本**（保证审计完整性），但不计入任何账户的金额统计，UI 不显示（避免误导）。
- 同一会话跨账户：**金额统计只认当前活跃账户**；切换账户后历史记录归属不变，但不再计入新账户视图（如本对话从 OpenCode 切到 DeepSeek，DeepSeek 视图只显示 DeepSeek 记录）。

## 目录/结构（改动面）
- `plugin/src/host.js`：账户映射表、三余额适配器、zai 订阅源、花费函数账户过滤、activeBalanceSummary 降级
- `plugin/src/client-bundle.js`：订阅识别列表、订阅服务名、未适配/无密钥提示
- `plugin/lib/*`：构建产物（build.mjs 重新生成）
- `tests/*`：新增 account-isolation、zai/moonshot/openrouter/stepfun 解析、降级单测；更新 spend-accounting 断言口径
- `docs/PRICING-SOURCES.md`：新增服务商常用模型定价（GLM-4.5/4.6、Kimi K2.7/K3、Step-2 基础价，来自官方价格页，未收录不臆测）
- `README.md` / `CHANGELOG.md`：用户视角更新

## API 契约（新适配器）
| 适配器 | 凭据 | 请求 | 响应要点 | 窗口/余额 |
|---|---|---|---|---|
| zai 订阅 | ZAI_CODING_CN_API_KEY / ZAI_API_KEY | GET {host}/api/monitor/usage/quota/limit | limits[].percentage/nextResetTime；level；**双 host 均裸 API Key（无 Bearer）** | 窗口制（5h 已知 unit=3） |
| moonshotai | MOONSHOT_API_KEY(/KIMI_API_KEY) | GET api.moonshot.cn/v1/users/me/balance | data.balance_infos[].total_balance | 余额 ¥ |
| openrouter | OPENROUTER_API_KEY | GET openrouter.ai/api/v1/credits | data.credits | 余额 $ |
| stepfun | STEPFUN_API_KEY | GET api.stepfun.com/v1/accounts | balance（CNY）/total_cash_balance/total_voucher_balance/type；**无 token_plan** | 余额 |

## 风险与对策
| 风险 | 等级 | 对策 |
|---|---|---|
| 阶跃 /v1/accounts 响应与文档不符 | 中 | 开发时实测；解析器容错；不符则以实测为准并更新调研文档；无法验证则先按获取账户信息文档实现 |
| 智谱 quota 接口为非官方文档化接口，未来可能变更 | 中低 | 社区多项目在用（CodexBar/zai-quota/harness-kit）；失败降级+退避沿用现有机制；用户有真实 API 可当场验证 |
| 新凭据名 resolve 可能需 DSH 注册 | 低 | 沿用 credentials.resolve 通用机制；缺失显示"未配置"引导；开发时以本机实测为准 |
| 客户端订阅识别列表与 host 双份维护漂移 | 低 | **提取共享常量 `plugin/src/constants.js`**（订阅 provider 集合），host 与 client 构建共用；单测断言常量一致性 |
| 花费口径变更影响既有 spend-accounting 测试 | 中 | 更新测试断言为账户口径，回归全量 |
| 订阅制下某服务商记录的定价缺失 → 花费不显示 | 低 | 新增基础定价条目；缺失时优雅不显示（现状行为） |
## v1.7 设计增补（D7–D13，2026-08-27 定稿：只做真实可查，零估算）

### D7 OpenAI/ChatGPT 订阅卡（FR-8，纯本地）
- 复用现有 codex 源登录态 ~/.codex/auth.json；新增本地通道：读 tokens.id_token 的 JWT payload（base64url → JSON，node crypto/Buffer 现成），取真实 claims：chatgpt_plan_type（plus/pro/team/enterprise → 显示名）、subscription_active_until（到期，本地时区格式化）。
- 显示：`ChatGPT · Plus | 到期 2026-09-16`；无登录态→"未绑定"引导；JWT 解码/字段缺失→静默降级（不调用 wham，wham 保持默认关闭的 D 级增强）。
- 不做：任何本地估算花费显示（用户原则）。

### D8 小米 MiMo（FR-9）
- provider→账户/端点路由：xiaomi(→cn?)、xiaomi-token-plan-cn → CN 集群；-sgp → 新加坡；-ams → 阿姆斯特丹；baseUrl 依 A4 报告。
- 凭据：XIAOMI_TOKEN_PLAN_CN/SGP/AMS_API_KEY 按地区、XIAOMI_API_KEY 回退；Bearer。
- 请求：GET /v1/user/balance（解析 balance CNY，pay_as_you_go）→ 余额制；GET /v1/tokenPlan/usage（month_total_token used/limit/percent + plan_name）→ 额度制（月度窗口 + 重置）。
- 未知地区响应形态差异：实现时以实测为准，记录（A4 待核实项）。

### D9 Together（FR-10）
- GET https://api.together.xyz/billing/usage（Bearer TOGETHER_API_KEY）→ 本月真实已用金额（USD）→ 账单型显示 "本月 $X"。

### D10 Fireworks（FR-11）
- GET /v1/accounts → account_id；再按 A8 报告三端点（billingUsage / billing/summary / usageCosts:query）取本周期花费 → 账单型显示。

### D11 AWS Bedrock（FR-12，cloud_billing）
- 复用 DSH 已保存 AWS 凭据（SigV4 签名，node:crypto，密钥不出本机；凭据名依 pi-ai env-api-keys 确认：AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION）。
- Cost Explorer：POST https://ce.us-east-1.amazonaws.com/ 周期=本月 → 真实花费；Budgets 可选→预算百分比。账单延迟 ~24h（hover 注明）。
- 展示：`AWS Bedrock | 本月 $X · 预算 Y%`；无凭据→"未配置"引导。

### D12 Cloudflare（FR-13）
- 复用 CLOUDFLARE_API_KEY（需用户 Token 带 Billing 读权限）；Billable Usage API（Alpha，B 级）→ 本月真实用量；每日免费额度剩余 + 零点重置倒计时（差异化卖点）；接口不可用→静默降级。

### D13 统一数据模型收敛（FR-14）
- host 新增 normalizeAccountStatus()：余额/额度/账单三型统一到 ProviderAccountStatus 子集（billingMode/planName/creditBalance/quotaWindows[monthly]/billing.currentPeriodSpend/budgetPercent/usage）。
- 客户端新增"账单型"渲染分支（本月花费 + 预算%），与余额型/额度型互斥；不重叠、不新增页面。
- 旧适配器（v1.6）保持原通道（兼容映射），避免回归；新适配器（D7–D12）走统一输出。

### v1.7 风险与对策
| 风险 | 等级 | 对策 |
|---|---|---|
| xiaomi cn/ams 响应形态未知 | 中 | 实现时以实测为准并记录；解析器容错（数值/字段缺失双保险） |
| Cloudflare Billable Usage 为 Alpha | 中 | 静默降级 + 失败退避；hover 说明数据源 |
| AWS SigV4 实现复杂度 | 中 | node:crypto 实现 SigV4（已有 crypto 依赖）；无凭据→"未配置"引导；单测用固定签名向量 |
| JWT 字段命名随 ChatGPT 变更 | 低 | 字段缺失→静默降级，不崩；仅展示已知字段 |
| 三型展示互斥回归 | 低 | 客户端单测覆盖 balance/windows/billing 三态渲染 |
