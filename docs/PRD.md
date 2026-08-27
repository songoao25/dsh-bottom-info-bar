# PRD：底部信息栏 v1.6（多服务商适配 + 分账修复）

## 背景与目标
用户反馈：① 插件未适配智谱清言与阿里云百炼的订阅套餐/余额；② 现场实证两个 bug——花费未按服务商分开统计（OpenCode 的花费混入 DeepSeek 视图，用户误以为扣了 DeepSeek 的钱）、余额对未适配服务商一律回退显示 DeepSeek 余额。用户要求：零配置、自动识别（配好密钥即显示，不需要设置页）。

v1.6 目标：修好分账与余额跟随两个地基 bug + 四家国产/常用服务商零设置接入。阿里云百炼因官方限制（API 密钥查不了额度）排 v1.7。

## 目标用户
在 DeepSeek Harness 中使用任意 AI 服务商的个人开发者（非技术背景，只配置密钥，不做任何插件设置）。

## 功能需求

### FR-1 花费按服务商账户隔离（Bug 修复）
- 描述：本对话、今日、本月/近30天、全部的花费统计，只统计"当前活动服务商账户"名下的记账记录；其他服务商的记录不得混入。
- 验收标准（Given-When-Then）：
  - Given 用户在一个会话里先后使用 OpenCode 与 DeepSeek，账本含两家的记录；When 当前服务商为 DeepSeek；Then "本对话/今日/本月/全部"均只含 provider 归属 DeepSeek 账户的记录，OpenCode 记录不出现
  - Given 某服务商在当前记账中无任何记录；When 信息栏渲染；Then 对应金额显示 0 而不是显示其他服务商的合计

### FR-2 余额严格跟随当前服务商（Bug 修复）
- 描述：余额账户映射只认当前活动服务商；对未适配/未知服务商，不再回退显示 DeepSeek 余额。
- 验收标准：
  - Given 当前服务商为 opencode-go（订阅制）；When 信息栏渲染；Then 不显示任何余额（含不显示 DeepSeek 余额）
  - Given 当前服务商为未适配平台（如 minimax）；When 信息栏渲染；Then 显示"未适配"引导而非 DeepSeek 余额
  - Given 当前服务商为 deepseek；Then 照常显示 DeepSeek 真实余额（行为不变）

### FR-3 智谱适配器（GLM Coding Plan 订阅额度，零设置）
- 描述：自动识别服务商 zai（国际）/ zai-coding-cn（国内 BigModel），读取 DSH 凭据 ZAI_API_KEY / ZAI_CODING_CN_API_KEY，查询 GLM Coding Plan 套餐等级与已用/剩余百分比、重置时刻；按订阅窗口制显示（剩余百分比 + 重置倒计时）。
- 接口：GET {host}/api/monitor/usage/quota/limit；国内 host=open.bigmodel.cn（Authorization 头直接放 API Key，无 Bearer），国际 host=api.z.ai（Bearer 前缀）。
- 验收标准：
  - Given 用户配置 ZAI_API_KEY（或 ZAI_CODING_CN_API_KEY）；When 当前服务商为 zai（或 zai-coding-cn）；Then 信息栏显示套餐等级（lite/standard/pro/max）与已用/剩余百分比，且无需任何插件设置
  - Given 接口返回 TOKENS_LIMIT（unit=3 等窗口）与 TIME_LIMIT；Then 正确映射为窗口显示，未知窗口类型跳过不报错
  - Given 接口 401/超时/格式异常；Then 显示"刷新失败/降级"，保留上次快照，不崩溃
  - Given 无凭据；Then 显示"未配置密钥"引导

### FR-4 Kimi 适配器（API 余额，零设置）
- 描述：自动识别服务商 moonshotai / moonshotai-cn / kimi-coding，读取凭据 MOONSHOT_API_KEY / KIMI_API_KEY，查询余额。
- 接口：GET https://api.moonshot.cn/v1/users/me/balance（Bearer），解析 balance_infos（total/granted/topped_up，CNY）。
- 验收标准：
  - Given 配置 MOONSHOT_API_KEY；When 当前服务商为 moonshotai；Then 显示真实余额（¥），60s 自动刷新
  - Given 接口失败/无凭据；Then 降级提示，不崩溃、不串显示其他服务商余额

### FR-5 OpenRouter 适配器（credits 余额，零设置）
- 描述：自动识别服务商 openrouter，读取凭据 OPENROUTER_API_KEY，查询剩余 credits（USD）。
- 接口：GET https://openrouter.ai/api/v1/credits（Bearer），解析 data.credits。
- 验收标准：
  - Given 配置 OPENROUTER_API_KEY；When 当前服务商为 openrouter；Then 显示剩余 credits（$），60s 自动刷新
  - Given 接口失败/无凭据；Then 降级提示，不崩溃

### FR-6 阶跃星辰适配器（API 余额，零设置）
- 描述：自动识别 StepFun（凭据 STEPFUN_API_KEY 或 step 前缀模型），查询账户余额/额度。
- 接口：GET https://api.stepfun.com/v1/accounts（Bearer，按官方文档；实现时以实测响应为准，文档与实测不符时记录差异并适配）。
- 验收标准：
  - Given 配置 STEPFUN_API_KEY 且当前服务商为 stepfun；Then 显示真实余额/额度
  - Given 文档与实测响应不一致；Then 以实测为准适配解析器，并更新 PRICING-SOURCES/调研文档备注
  - Given 接口失败/无凭据；Then 降级提示，不崩溃

### FR-7 未适配服务商优雅降级
- 描述：对清单外的服务商，信息栏显示"未适配/未配置引导"（可区分：近期将支持 vs 无接口平台），绝不显示其他服务商的余额/额度。
- 验收标准：
  - Given 当前服务商不在任何适配器清单内；Then 显示明确的"未适配"或"未配置"引导，且无任何其他服务商数据冒充

## 非功能需求
- 安全：凭据只在内存中用于请求头，零落盘、不进 git、错误信息不含密钥；请求全部走 HTTPS；订阅查询 RPC 保持同源防护
- 性能：余额/额度 60s 周期刷新，请求 15s 超时；RPC 20s 超时；失败保留旧快照并退避重试
- 兼容：不新增第三方依赖（沿用 node:fetch / node:crypto）；不改变现有 DeepSeek/OpenAI/OpenCode Go/ChatGPT 行为；旧版本记账文件无损升级
- 展示：订阅制与余额制互斥；未适配不打扰主干信息

## 非目标（v1.6 不做）
- 阿里云百炼 Token Plan 真实接入（v1.7，官方小工具方式）
- 火山方舟/百度千帆/腾讯混元等 AccessKey 型平台
- 设置页新增配置项
- 订阅令牌绑定/续期（独立插件职责）
- 讯飞星火、零一万物、MiniMax（无接口或待确认）

## v1.7 增补需求（2026-08-27 定稿：只做"真实可查"，零估算）
> 与 v1.6 合并一次发布（v1.7.0）。原则：只显示官方真实返回的余额/额度/套餐/账单；任何本地估算显示一律不做。

### FR-8 OpenAI / ChatGPT 订阅卡（真实订阅信息，纯本地）
- 描述：复用现有 codex 源的 ~/.codex/auth.json 登录态，本地解析 id_token 的 JWT claims（chatgpt_plan_type / subscription_active_until 等）显示真实套餐名与到期时间；不显示任何本地估算花费。
- 验收标准：Given 本机存在已绑定登录态；When 当前服务商为 openai-codex；Then 显示真实套餐名 + 到期日期（降级：无登录态→"未绑定"引导）；纯本地解析，零网络请求；JWT 解码失败不崩溃、静默降级。

### FR-9 小米 MiMo（真实余额 + 套餐额度，零设置）
- 描述：自动识别 xiaomi / xiaomi-token-plan-cn / -sgp / -ams，复用 DSH 凭据（XIAOMI_TOKEN_PLAN_*_API_KEY 等），调 /v1/user/balance 与 /v1/tokenPlan/usage，按 provider 路由 baseUrl。
- 验收标准：Given 配置对应地区凭据；When 当前服务商为 xiaomi 系；Then 显示真实余额或套餐额度（百分比+重置）；接口失败→降级；cn/ams 响应差异以实测为准并记录。

### FR-10 Together（真实月度账单）
- 描述：复用 TOGETHER_API_KEY，调 GET /billing/usage 显示本月真实已用金额（USD）。
- 验收标准：Given 配置密钥；When 当前服务商为 together；Then 显示"本月 $X"真实账单；失败降级。

### FR-11 Fireworks（真实周期账单）
- 描述：复用 FIREWORKS_API_KEY，先 GET /v1/accounts 解析 account_id，再调 billingUsage 显示本周期真实花费。
- 验收标准：Given 配置密钥；When 当前服务商为 fireworks；Then 显示本周期真实花费；解析失败→降级提示。

### FR-12 AWS Bedrock（真实云账单 + 预算%）
- 描述：复用已保存 AWS 凭据（SigV4 本地签名，密钥不出本机），调 Cost Explorer / Budgets 显示本月真实花费与预算百分比。
- 验收标准：Given 已配置 AWS 凭据；When 当前服务商为 amazon-bedrock；Then 显示真实周期花费+预算%；无凭据→"未配置"引导。

### FR-13 Cloudflare（真实用量 + 免费额度倒计时）
- 描述：复用 CLOUDFLARE_API_KEY，调 Billable Usage（Alpha）显示本月真实用量；显示每日免费额度剩余与零点重置倒计时。
- 验收标准：Given 配置密钥；When 当前服务商为 cloudflare 系；Then 显示真实用量/免费额度；接口不可用→静默降级。

### FR-14 统一数据模型收敛（内部）
- 描述：新增适配器输出收敛到 ProviderAccountStatus（billingMode/planName/creditBalance/quotaWindows/billing 等），客户端统一渲染；余额/额度窗口/周期账单三种展示互斥。
- 验收标准：单一渲染逻辑覆盖所有新老适配器；三种展示不叠加；单测覆盖统一结构与渲染映射。

## 长期非目标（记录理由）
- Claude/Gemini/腾讯混元 本地花费核算、NVIDIA 角标、Groq 速率卡、Cerebras/HuggingFace 估算（用户原则：不做估算显示）
- xAI / Mistral / MiniMax 进阶真实接口（需用户额外提供独立密钥，不符合零设置；待用户明确后 v1.8）
- 阿里云百炼 Token Plan（官方无 API Key 路径）
- Azure / Vertex / Vercel 云主体计费（凭据不可复用）
- 任何新页面、信息栏外的新入口

## 成功指标
- 智谱密钥配置后 60 秒内显示真实套餐额度（用户当场可验证）
- 切换服务商后信息栏零串账、零串台（FR-1/FR-2 验收通过）
- 全量测试通过（tests/run-all.mjs 全绿，新增分账与适配器单测）
- Git 提交符合 Conventional Commits，发布符合仓库既有规范（授权作者 songoao25）