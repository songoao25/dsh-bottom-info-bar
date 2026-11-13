// Bottom Info Bar — shared constants (single source of truth)
// 订阅制 provider 集合：这些 provider 走"额度窗口"显示而非余额
// v1.7：新增小米 MiMo Token Plan 三集群（月度 Credits 额度窗）
// v1.16.0：新增 MiniMax（海螺）Token Plan 双站点（Global minimax / CN minimax-cn，5 小时 + 周窗口）
// v1.22.0：新增阿里 Token Plan 中国站/国际站（百炼 Credits 订阅，月度窗口）与 Kimi For Coding（5 小时 + 周窗口）
export const SUBSCRIPTION_PROVIDERS = ['codex', 'chatgpt', 'opencode-go', 'opencode', 'openai-codex', 'zai', 'zai-coding-cn', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams', 'command', 'command-code', 'minimax', 'minimax-cn', 'qwen-token-plan-cn', 'qwen-token-plan', 'qwen-token-plan-individual', 'kimi-coding']
// 云账单 provider 集合：这些 provider 走"账单型"显示（本月真实花费 / 预算%），与余额型/额度型互斥（FR-14）
export const BILLING_PROVIDERS = ['together', 'fireworks', 'amazon-bedrock', 'cloudflare-ai-gateway', 'cloudflare-workers-ai', 'huggingface']

// ---------- v1.24.0：额度数据源凭据目录（单一生源） ----------
// 为什么要有这张表：插件支持的额度来源越来越多，凭据名、官方渠道、验证程度如果散落在
// host 的 fetch 函数里，新人/未来的自己能加的只有"再写一个 if"。这张表是唯一清单：
//   · host 用它派生「设置页可写入的凭据白名单」（只认同表里的 ref，写进 DSH 凭据存储）；
//   · 设置页用它渲染「额度凭据」区（内联的 = 需要用户额外准备的凭据）；
//   · 测试用它锁「已适配服务商 ↔ 凭据 ↔ 官方渠道 ↔ 验证程度」不漂移；
//   · 文档（docs/PROVIDER-COMPATIBILITY.md 与 CONTRIBUTING 的适配规范）以它为同一口径。
// 新增一个额度来源 = 这里加一条 + host 的 fetch/parse + 测试；不要在其他地方再硬编码凭据名。
// 字段约定：
//   id            稳定短 id（测试/文档引用；不要随文案改）
//   labelKey      显示名（已有品牌字典键；没有就用 label 原文字面量，品牌名不翻译）
//   mode          subscription | balance | billing（与信息栏三种口径一致）
//   providers     关联的 DSH provider id（用于一致性测试与排障；成本类 provider 可留空）
//   credentials   [{ ref, labelKey?, hintKey?, inline }]，inline=true 表示需要用户在本插件设置页
//                 额外准备（DSH 设置 → 模型 里通常没有这一项）；inline=false 只在目录里登记。
//                 2026-11-12 收紧口径：推理 Key 能复用的一律 inline=false —— 用户在 DSH 设置 → 模型
//                 里填过一次就能直接查额度，插件设置页不再提供第二遍输入（不做重复入口）。
//   detectRefs    可选：目录登记的「DSH 设置 → 模型 里可能已有的推理 Key」。host 逐个查已配置状态，
//                 命中即视为「已绑定」——设置页折叠卡摘要与信息栏引导态都按它判定，不在别处硬编码。
//   oauthRecord   可选：宿主已有的登录态凭据记录（llm-pi-ai/<provider>），插件只读复用
//   official      true=官方文档/官方接口；false=社区逆向或半官方端点
//   verification  live=有官方文档且被真实账号验证过；third-party=按官方文档/官方源码/多份社区实现实现；
//                 unverified=仅按文档实现、未用真实账号端到端验证
export const CREDENTIAL_CATALOG = [
  {
    id: 'alibaba',
    labelKey: 'ui.qwenTokenPlan',
    mode: 'subscription',
    providers: ['qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual'],
    official: true,
    verification: 'unverified',
    detectRefs: ['QWEN_TOKEN_PLAN_API_KEY', 'QWEN_TOKEN_PLAN_CN_API_KEY'],
    credentials: [
      { ref: 'ALIBABA_CLOUD_ACCESS_KEY_ID', labelKey: 'ui.credentialAlibabaIdLabel', hintKey: 'ui.credentialAlibabaIdHint', inline: true },
      { ref: 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', labelKey: 'ui.credentialAlibabaSecretLabel', hintKey: 'ui.credentialAlibabaHint', inline: true },
    ],
  },
  {
    id: 'kimi-coding',
    labelKey: 'ui.kimiCoding',
    mode: 'subscription',
    providers: ['kimi-coding'],
    oauthRecord: 'llm-pi-ai/kimi-coding',
    official: false,
    verification: 'third-party',
    credentials: [
      { ref: 'KIMI_API_KEY', labelKey: 'ui.credentialKimiKeyLabel', hintKey: 'ui.credentialKimiHint', inline: false },
    ],
  },
  {
    id: 'minimax',
    labelKey: 'ui.minimax',
    mode: 'subscription',
    providers: ['minimax', 'minimax-cn'],
    official: false,
    verification: 'third-party',
    credentials: [
      { ref: 'MINIMAX_API_KEY', inline: false },
      { ref: 'MINIMAX_CN_API_KEY', inline: false },
    ],
  },
  {
    id: 'xiaomi-token-plan',
    labelKey: 'ui.xiaomiMiMo',
    mode: 'subscription',
    providers: ['xiaomi', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams'],
    official: false,
    verification: 'third-party',
    credentials: [
      { ref: 'XIAOMI_TOKEN_PLAN_CN_API_KEY', inline: false },
      { ref: 'XIAOMI_TOKEN_PLAN_SGP_API_KEY', inline: false },
      { ref: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY', inline: false },
      // XIAOMI_API_KEY 是按量余额的推理 Key（DSH 设置 → 模型 里配），不进插件设置页。
      { ref: 'XIAOMI_API_KEY', inline: false },
    ],
    detectRefs: ['XIAOMI_API_KEY', 'XIAOMI_TOKEN_PLAN_CN_API_KEY', 'XIAOMI_TOKEN_PLAN_SGP_API_KEY', 'XIAOMI_TOKEN_PLAN_AMS_API_KEY'],
  },
  {
    id: 'zhipu',
    labelKey: 'ui.zhipu',
    mode: 'subscription',
    providers: ['zai', 'zai-coding-cn'],
    official: false,
    verification: 'third-party',
    // 两个 Key 都是推理 Key（DSH 设置 → 模型 里 zai / zai-coding-cn 的模型 Key），查额度直接复用：
    // 插件设置页不再提供第二遍输入，只靠 detectRefs 识别「已绑定」。
    credentials: [
      { ref: 'ZAI_API_KEY', inline: false },
      { ref: 'ZAI_CODING_CN_API_KEY', inline: false },
    ],
    detectRefs: ['ZAI_API_KEY', 'ZAI_CODING_CN_API_KEY'],
  },
  {
    id: 'command-code',
    labelKey: 'ui.commandCode',
    mode: 'subscription',
    providers: ['command', 'command-code'],
    official: false,
    verification: 'third-party',
    credentials: [
      { ref: 'COMMAND_CODE_API_KEY', inline: false },
      { ref: 'CMD_API_KEY', inline: false },
    ],
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    mode: 'subscription',
    providers: ['opencode-go', 'opencode'],
    official: false,
    verification: 'third-party',
    credentials: [
      { ref: 'OPENCODE_GO_API_KEY', inline: false },
    ],
  },
  {
    id: 'codex',
    label: 'ChatGPT / Codex',
    mode: 'subscription',
    providers: ['openai-codex', 'chatgpt', 'codex'],
    official: true,
    verification: 'third-party',
    credentials: [],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    mode: 'balance',
    providers: ['deepseek', 'deepseek-official', 'deepseek-account'],
    official: true,
    verification: 'third-party',
    credentials: [],
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    mode: 'balance',
    providers: ['moonshotai', 'moonshotai-cn', 'kimi-coding'],
    official: true,
    verification: 'third-party',
    credentials: [{ ref: 'MOONSHOT_API_KEY', inline: false }],
    detectRefs: ['MOONSHOT_API_KEY'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    mode: 'balance',
    providers: ['openrouter'],
    official: true,
    verification: 'third-party',
    credentials: [{ ref: 'OPENROUTER_API_KEY', inline: false }],
    detectRefs: ['OPENROUTER_API_KEY'],
  },
  {
    id: 'stepfun',
    label: 'StepFun',
    mode: 'balance',
    providers: ['stepfun'],
    official: true,
    verification: 'third-party',
    credentials: [{ ref: 'STEPFUN_API_KEY', inline: false }],
    detectRefs: ['STEPFUN_API_KEY'],
  },
  {
    id: 'together',
    label: 'Together',
    mode: 'billing',
    providers: ['together'],
    official: true,
    verification: 'third-party',
    credentials: [{ ref: 'TOGETHER_API_KEY', inline: false }],
    detectRefs: ['TOGETHER_API_KEY'],
  },
  {
    id: 'fireworks',
    label: 'Fireworks',
    mode: 'billing',
    providers: ['fireworks'],
    official: true,
    verification: 'third-party',
    credentials: [{ ref: 'FIREWORKS_API_KEY', inline: false }],
    detectRefs: ['FIREWORKS_API_KEY'],
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    mode: 'billing',
    providers: ['cloudflare-ai-gateway', 'cloudflare-workers-ai'],
    official: true,
    verification: 'third-party',
    credentials: [
      { ref: 'CLOUDFLARE_API_KEY', inline: false },
      { ref: 'CLOUDFLARE_ACCOUNT_ID', inline: false },
    ],
    detectRefs: ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID'],
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    mode: 'billing',
    providers: ['huggingface'],
    official: true,
    verification: 'third-party',
    credentials: [
      { ref: 'HF_TOKEN', inline: false },
      { ref: 'HUGGING_FACE_HUB_TOKEN', inline: false },
    ],
    detectRefs: ['HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN'],
  },
  {
    id: 'amazon-bedrock',
    label: 'AWS Bedrock',
    mode: 'billing',
    providers: ['amazon-bedrock'],
    official: true,
    verification: 'third-party',
    credentials: [
      { ref: 'AWS_ACCESS_KEY_ID', inline: false },
      { ref: 'AWS_SECRET_ACCESS_KEY', inline: false },
      { ref: 'AWS_SESSION_TOKEN', inline: false },
    ],
  },
]

// DeepSeek Harness 当前内置的 pi-ai 服务商目录（2026-09-26 从桌面端 app.asar 核对）。
// 这不是一份“建议支持”的清单，而是兼容性基线：每一个预置 id 都必须在
// PROVIDER_IDENTITY 里有明确归属；新增 DSH 预置服务商时，测试会要求显式决定其
// 账户数据能力，不能再悄悄落进未知服务商的错误提示。
export const DSH_PRESET_PROVIDERS = [
  'amazon-bedrock', 'ant-ling', 'anthropic', 'azure-openai-responses', 'baseten', 'cerebras',
  'cloudflare-ai-gateway', 'cloudflare-workers-ai', 'deepseek', 'fireworks', 'github-copilot',
  'google', 'google-vertex', 'groq', 'huggingface', 'kimi-coding', 'minimax', 'minimax-cn',
  'mistral', 'moonshotai', 'moonshotai-cn', 'nvidia', 'openai', 'openai-codex', 'opencode',
  'opencode-go', 'openrouter', 'qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual',
  'together', 'vercel-ai-gateway', 'xai', 'xiaomi', 'xiaomi-token-plan-ams',
  'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'zai', 'zai-coding-cn',
]

// 价目表和宿主上报金额尚未覆盖时的保守币种。它只决定本地 token 账本的分币种
// 汇总，绝不把不同币种换算或伪装为账户余额。跨区同名模型必须在此处显式分开。
export const PROVIDER_DEFAULT_CURRENCY = {
  'deepseek': 'CNY', 'deepseek-official': 'CNY', 'moonshotai-cn': 'CNY', 'stepfun': 'CNY',
  'xiaomi': 'CNY', 'xiaomi-token-plan-cn': 'CNY', 'qwen-token-plan-cn': 'CNY', 'minimax-cn': 'CNY',
  'ant-ling': 'USD', 'anthropic': 'USD', 'amazon-bedrock': 'USD', 'azure-openai-responses': 'USD',
  'baseten': 'USD', 'cerebras': 'USD', 'cloudflare-ai-gateway': 'USD', 'cloudflare-workers-ai': 'USD',
  'fireworks': 'USD', 'github-copilot': 'USD', 'google': 'USD', 'google-vertex': 'USD', 'groq': 'USD',
  'huggingface': 'USD', 'kimi-coding': 'USD', 'mistral': 'USD', 'moonshotai': 'USD', 'nvidia': 'USD', 'openai': 'USD',
  'openai-codex': 'USD', 'chatgpt': 'USD', 'codex': 'USD', 'openrouter': 'USD',
  'qwen-token-plan': 'USD', 'qwen-token-plan-individual': 'USD', 'together': 'USD',
  'vercel-ai-gateway': 'USD', 'xai': 'USD',
}

// ---------- provider 身份总表（新增服务商只改这里 + 上面两个集合） ----------
// 一个 DSH provider id 一行：account 花费记在哪个账户（分账轴）；subscription / billing
// 快照源键（无→null）。以前这是三条 if-else 链（accountForProvider / subscriptionSourceFor /
// billingSourceFor），加一个服务商要改三处，必然漏改；现在三函数只查这张表。
// 上面两个集合保留字面量（构建直接正则提取注入客户端，派生写法提不出来）；
// tests/test-subscription-providers-consistency.cjs 锁死「表 ↔ 集合」双向一致，漂移即红。
// 不在这张表里的：余额来源例外（PLATFORM_BALANCE_PROVIDERS，另一条轴）、上报币种
// （PROVIDER_REPORTED_CURRENCY，不同语义）、显示名（PROVIDER_DISPLAY，目录驱动+翻译）。
export const PROVIDER_IDENTITY = {
  'deepseek': { account: 'deepseek', subscription: null, billing: null },
  'deepseek-official': { account: 'deepseek', subscription: null, billing: null },
  'openai': { account: 'openai', subscription: null, billing: null },
  // Moonshot 的国际站与中国站是不同端点、不同结算币种，不能共用账户桶。
  'moonshotai': { account: 'moonshotai', subscription: null, billing: null },
  'moonshotai-cn': { account: 'moonshotai-cn', subscription: null, billing: null },
  // v1.22.0：Kimi For Coding 订阅额度（GET /coding/v1/usages，API Key 数据面）
  'kimi-coding': { account: 'kimi-coding', subscription: 'kimi-coding', billing: null },
  'openrouter': { account: 'openrouter', subscription: null, billing: null },
  'stepfun': { account: 'stepfun', subscription: null, billing: null },
  'codex': { account: 'codex', subscription: 'codex', billing: null },
  'chatgpt': { account: 'codex', subscription: 'codex', billing: null },
  'openai-codex': { account: 'codex', subscription: 'codex', billing: null },
  'opencode-go': { account: 'opencode-go', subscription: 'opencode-go', billing: null },
  'opencode': { account: 'opencode-go', subscription: 'opencode-go', billing: null },
  'zai': { account: 'zai', subscription: 'zai', billing: null },
  'zai-coding-cn': { account: 'zai', subscription: 'zai', billing: null },
  'xiaomi': { account: 'xiaomi', subscription: null, billing: null },
  'xiaomi-token-plan-cn': { account: 'xiaomi-token-plan', subscription: 'xiaomi-cn', billing: null },
  'xiaomi-token-plan-sgp': { account: 'xiaomi-token-plan', subscription: 'xiaomi-sgp', billing: null },
  'xiaomi-token-plan-ams': { account: 'xiaomi-token-plan', subscription: 'xiaomi-ams', billing: null },
  'command': { account: 'command-code', subscription: 'command-code', billing: null },
  'command-code': { account: 'command-code', subscription: 'command-code', billing: null },
  'minimax': { account: 'minimax', subscription: 'minimax', billing: null },
  'minimax-cn': { account: 'minimax', subscription: 'minimax-cn', billing: null },
  'together': { account: 'together', subscription: null, billing: 'together' },
  'fireworks': { account: 'fireworks', subscription: null, billing: 'fireworks' },
  'amazon-bedrock': { account: 'amazon-bedrock', subscription: null, billing: 'amazon-bedrock' },
  'cloudflare-ai-gateway': { account: 'cloudflare', subscription: null, billing: 'cloudflare' },
  'cloudflare-workers-ai': { account: 'cloudflare', subscription: null, billing: 'cloudflare' },
  'ant-ling': { account: 'ant-ling', subscription: null, billing: null },
  'anthropic': { account: 'anthropic', subscription: null, billing: null },
  'azure-openai-responses': { account: 'azure-openai-responses', subscription: null, billing: null },
  'baseten': { account: 'baseten', subscription: null, billing: null },
  'cerebras': { account: 'cerebras', subscription: null, billing: null },
  'github-copilot': { account: 'github-copilot', subscription: null, billing: null },
  'google': { account: 'google', subscription: null, billing: null },
  'google-vertex': { account: 'google-vertex', subscription: null, billing: null },
  'groq': { account: 'groq', subscription: null, billing: null },
  'huggingface': { account: 'huggingface', subscription: null, billing: 'huggingface' },
  'mistral': { account: 'mistral', subscription: null, billing: null },
  'nvidia': { account: 'nvidia', subscription: null, billing: null },
  // v1.22.0：阿里 Token Plan 中国站/国际站各成独立源（地区隔离，快照互不串）；两个国际站 id 共用国际源
  'qwen-token-plan': { account: 'qwen-token-plan', subscription: 'alibaba-intl', billing: null },
  'qwen-token-plan-cn': { account: 'qwen-token-plan-cn', subscription: 'alibaba-cn', billing: null },
  'qwen-token-plan-individual': { account: 'qwen-token-plan-individual', subscription: 'alibaba-intl', billing: null },
  'vercel-ai-gateway': { account: 'vercel-ai-gateway', subscription: null, billing: null },
  'xai': { account: 'xai', subscription: null, billing: null },
}

// ============================================================================================
// 显示模型（唯一一套逻辑，2026-09-26 用户拍板定型 —— 动任何显示相关的代码前先读完这一段）
// ============================================================================================
// 一个字段「出现还是不出现」只由两件事决定，没有第三件：
//   ① 字段开关（settings.json 的 fields.<id>）—— 用户唯一要管的东西，开=出现、关=消失；
//   ② 数据条件（当前 provider 有没有这项数据）—— 由 provider 决定，用户在设置页看不到。
//
// 字段「属于谁」（group）只决定它出现在哪里、列在设置页哪个列表里：
//   native  原生信息：DSH 原生底栏原有的信息 → 旧宿主渲染进「原生统计行」，新宿主是两个原生按钮 → **只在完整模式可见**
//   plugin  插件信息：本插件新增的字段（含接管过来的上下文圆环）→ 渲染进主行 → **两种模式都可见**
//   notice  提醒信息：一次性提醒 → 渲染在**主行右端** → **两种模式都可见**，只在真有事时出现
//
// 模式（简洁 / 完整）的全部职责只有一条：**原生那一行显示不显示**。
// 它绝不参与任何字段的显隐判定 —— 因此「这个字段在简洁模式下能不能出现」不是独立问题，看 group 就够了。
//   group = native → 旧宿主进原生统计行（.bi-native-row），新宿主是 Harness 自己的两个按钮行；
//                    两种形态都随 data-density 收合到 0 高度（新宿主由 [data-composer-stat] 的 CSS 收合）
//   group = plugin / notice → 进主行（.bi-row2），门控只有 fieldVisible(id) 一条
//
// 2026-10-17 用户拍板（新宿主适配第二版）：两个原生按钮（activity / usage）恢复各自的字段开关，
// 但插件**不复制**按钮本身，只通过样式隐藏/显示 Harness 注册的那两个入口；原生按钮自己的明细弹窗、
// 注入状态和 Harness 设置全部保持宿主所有。旧宿主仍然渲染旧统计行与旧的七个开关（宿主没有这两个入口）。
//
// 反面教训（严禁复发）：2026-09 曾出现 11 处 `if (full) …` / `full && fieldVisible(…)` 的散落门控，
// 等于给插件字段偷偷加了第二套规则 —— 开关明明开着、简洁模式下却整块消失。用户报的
// 「自定义文字打开了却在简洁模式看不到」就是这么来的。tests/test-density-toggle.cjs 里有硬断言：
// 源码中不允许再出现 `if (full` 分支或 `full && fieldVisible` 门控。
//
// 字段对象的键：
// - id：settings.json fields/colors 的键（稳定英文 id，宿主白名单校验来源）
// - label：设置页显示文案的字典键
// - group：见上（native | plugin | notice）
// - section：**只**决定它列在设置页「插件信息」里的哪一小节（见 FIELD_SECTIONS）。
//   与 group 的分工写清楚：group 管「住在信息栏哪一行」，section 管「列在设置页哪一块」，
//   两者互不读写、互不影响显隐。native / notice 两个组不设小节（它们本来就只有一块）。
// - defaultOff：新装默认关闭（默认缺省=开启）。只有"用户不主动打开就不该出现"的字段才标它。
// - note：设置页每行的小字说明（只讲"这是什么/什么条件下有数据"，不讲模式 —— 模式已由 group 表达）
// - suggestKeep：错误/提醒类字段，页面标注「建议保留」（用户拍板：允许关闭但劝留）
// - anchor：身份锚点语义标记（服务商/模型标识）。D6 用户拍板：锚点与其他字段同等可隐藏（无恒开/禁用逻辑），
//   仅用于设置页说明文字与颜色语义（provider 色回退）。
// - colorKind：颜色回退语义（客户端生成 CSS 用）：inherit 继承正文色 | alert 警示红 | period 峰红/谷绿 |
//   provider 锚点组（正文 + 服务商名主色）| muted 弱提示灰 | meter 原生圆环类（回退原生同款弱提示色 --bi-separator）。
//   未自定义颜色时回退这些原语义色，默认外观零变化。
// - noColor：该字段由宿主渲染、插件改不了它的颜色，因此设置页不显示颜色控件（只留显隐开关）。
//   目前只有新宿主两个原生按钮用；给它们一个可以点、却没有任何效果的色块，等于提供假控件。
//
// 关于「计费形态」（余额制 balance / 订阅制 subscription / 账单制 billing）：它由 provider 决定，
// 不是字段属性，因此不写进注册表 —— 一个字段属于哪种计费形态，看它在 src/client-bundle.js 里由哪个
// push*Groups 函数渲染即可（pushBalanceGroups / pushSubscriptionGroups / pushBillingGroups），
// 不存在第二份需要手工同步的清单。section 借用了同一套名字，那只是"列在设置页哪一块"的阅读分组。
// ============================================================================================
export const FIELD_REGISTRY = [
  // ---------- 插件信息 · 身份锚点（服务商 · 模型；三种计费形态各一个，用户可隐藏） ----------
  { id: 'anchorGroup', label: "field.anchorGroup.label", group: 'plugin', section: 'identity', anchor: true, colorKind: 'provider', note: "field.anchorGroup.note" },
  { id: 'subServiceGroup', label: "field.subServiceGroup.label", group: 'plugin', section: 'identity', anchor: true, colorKind: 'provider', note: "field.subServiceGroup.note" },
  { id: 'billingServiceGroup', label: "field.billingServiceGroup.label", group: 'plugin', section: 'identity', anchor: true, colorKind: 'provider', note: "field.billingServiceGroup.note" },
  // ---------- 插件信息 · 通用（任何计费形态都可能出现） ----------
  // 自定义文字：纯自定义，位于服务商/模型左侧；为空时不渲染（开关可保持开启，无内容就无占位）
  { id: 'customText', label: "field.customText.label", group: 'plugin', section: 'common', defaultOff: true, colorKind: 'inherit', note: "field.customText.note" },
  // 主/世界时间：时区在设置页「时间与日期」中独立配置；显示统一用通用格式
  { id: 'mainTime', label: "field.mainTime.label", group: 'plugin', section: 'common', defaultOff: true, colorKind: 'inherit', note: "field.mainTime.note" },
  { id: 'worldTime', label: "field.worldTime.label", group: 'plugin', section: 'common', defaultOff: true, colorKind: 'inherit', note: "field.worldTime.note" },
  // 上下文占用圆环（DSH 原生 ContextMeter 的接管版）：外观、几何与交互面板与原生一致，显隐/配色并入本插件字段体系；
  // 固定在主行最右端，原生那一份由样式隐藏。归 plugin 组是结论而非笔误：它住在主行，而主行两种模式都可见。
  { id: 'contextUsage', label: "field.contextUsage.label", group: 'plugin', section: 'common', colorKind: 'meter', note: "field.contextUsage.note" },
  // ---------- 插件信息 · 余额制（balance） ----------
  // 本会话花费：余额制与"订阅 · 充值余额"形态共用（见 pushSessionCost）
  { id: 'sessionCost', label: "field.sessionCost.label", group: 'plugin', section: 'balance', colorKind: 'inherit', note: "field.sessionCost.note" },
  { id: 'balance', label: "ui.balance.pushBalanceGroups", group: 'plugin', section: 'balance', colorKind: 'inherit', note: "field.balance.note" },
  { id: 'period', label: "field.period.label", group: 'plugin', section: 'balance', colorKind: 'period', note: "field.period.note" },
  { id: 'countdown', label: "field.countdown.label", group: 'plugin', section: 'balance', colorKind: 'inherit', note: "field.countdown.note" },
  // ---------- 插件信息 · 订阅制（subscription） ----------
  { id: 'expiry', label: "field.expiry.label", group: 'plugin', section: 'subscription', colorKind: 'inherit', note: "field.expiry.note" },
  { id: 'subWindow5h', label: "field.subWindow5h.label", group: 'plugin', section: 'subscription', colorKind: 'inherit', note: "field.subWindow5h.note" },
  { id: 'subWindowWeek', label: "field.subWindowWeek.label", group: 'plugin', section: 'subscription', colorKind: 'inherit', note: "field.subWindowWeek.note" },
  { id: 'subWindowMonth', label: "field.subWindowMonth.label", group: 'plugin', section: 'subscription', colorKind: 'inherit', note: "field.subWindowMonth.note" },
  { id: 'resetCountdown', label: "field.resetCountdown.label", group: 'plugin', section: 'subscription', colorKind: 'inherit', note: "field.resetCountdown.note" },
  { id: 'subBalance', label: "field.subBalance.label", group: 'plugin', section: 'subscription', colorKind: 'inherit', note: "field.subBalance.note" },
  // ---------- 插件信息 · 账单制（billing） ----------
  { id: 'billingSpend', label: "field.billingSpend.label", group: 'plugin', section: 'billing', colorKind: 'inherit', note: "field.billingSpend.note" },
  { id: 'budget', label: "field.budget.label", group: 'plugin', section: 'billing', colorKind: 'inherit', note: "field.budget.note" },
  { id: 'freeQuota', label: "field.freeQuota.label", group: 'plugin', section: 'billing', colorKind: 'inherit', note: "field.freeQuota.note" },
  // ---------- 原生信息 · 新宿主（DSH 0.2.1）的两个原生按钮 ----------
  // 新版把旧统计行换成了 Harness 自己的 activity / usage 两个按钮，点开各有明细弹窗。
  // 这两个开关只控制「显示 / 隐藏对应按钮」，不接管按钮组件、不改它的行为；
  // 和旧原生行一样，整行只在完整模式可见。旧宿主没有这两个入口，因此不在旧宿主设置页出现。
  { id: 'nativeActivity', label: "field.nativeActivity.label", group: 'native', colorKind: 'inherit', noColor: true, note: "field.nativeActivity.note" },
  { id: 'nativeUsage', label: "field.nativeUsage.label", group: 'native', colorKind: 'inherit', noColor: true, note: "field.nativeUsage.note" },
  // ---------- 原生信息 · 旧宿主（DSH 0.2.0 及更早）统计行的七个字段 ----------
  { id: 'turnsSteps', label: "field.turnsSteps.label", group: 'native', colorKind: 'inherit', note: "field.turnsSteps.note" },
  { id: 'llmTime', label: "field.llmTime.label", group: 'native', colorKind: 'inherit', note: "field.llmTime.note" },
  { id: 'toolTime', label: "field.toolTime.label", group: 'native', colorKind: 'inherit', note: "field.toolTime.note" },
  { id: 'avgTTFT', label: "field.avgTTFT.label", group: 'native', colorKind: 'inherit', note: "field.avgTTFT.note" },
  { id: 'outputSpeed', label: "field.outputSpeed.label", group: 'native', colorKind: 'inherit', note: "field.outputSpeed.note" },
  { id: 'cacheHit', label: "ui.cacheHit", group: 'native', colorKind: 'inherit', note: "field.cacheHit.note" },
  { id: 'tokensIO', label: "field.tokensIO.label", group: 'native', colorKind: 'inherit', note: "field.tokensIO.note" },
]

// 字段分组在设置页的展示顺序与标题（经构建注入客户端）。
// 顺序与信息栏的实际版式一致：原生行在上、主行在下。
// 提醒信息不再有开关（2026-11-12 用户拍板）：提醒只由数据条件触发
// （真有事才出现，没事零占位），不需要也不应该提供「关掉提醒」的入口。
export const FIELD_GROUP_ORDER = ['native', 'plugin']
export const FIELD_GROUP_LABELS = {
  native: "group.native",
  plugin: "group.plugin",
}

// ---------- 设置页小节（只影响设置页的阅读分组，不影响信息栏里的任何东西） ----------
// 为什么需要它：「插件信息」这一组里有 20 个字段，但它们分属三种**互斥**的计费形态 ——
// 一个用 ChatGPT 订阅的人，看到「余额」「本月用量」「预算使用情况」只会更困惑：那是什么？
// 什么时候会有数？小节把同一形态的字段放在一块，并用一句话说明「什么时候属于这一组」。
//
// 三件事互不越界，读代码时先分清：
//   group    → 字段住在信息栏哪一行（native 原生行 / plugin 主行 / notice 主行右端）
//   section  → 字段列在设置页哪一小节（**只有阅读顺序作用**）
//   开关     → 字段显不显示（唯一裁判）
// 顺序即数组顺序：先「身份」，再三种互斥的计费形态，最后与形态无关的通用项。
// 字段自报家门（FIELD_REGISTRY[].section），所以不存在第二份需要手工同步的清单；
// tests/test-field-sections.cjs 会拦住漏标、错标与空小节。
export const FIELD_SECTIONS = [
  { id: 'identity', label: "section.identity.label", desc: "section.identity.desc" },
  { id: 'balance', label: "section.balance.label", desc: "section.balance.desc" },
  { id: 'subscription', label: "section.subscription.label", desc: "section.subscription.desc" },
  { id: 'billing', label: "section.billing.label", desc: "section.billing.desc" },
  { id: 'common', label: "section.common.label", desc: "section.common.desc" },
]

// ---------- 字段在信息栏的归属（位置 + 门控的机器可读版） ----------
// 每个模式列出它可能渲染的字段 id（按渲染顺序）；公共尾部（提醒 + 圆环）三种模式共用。
// 注意这张表只管「谁可能出现在哪一行」，不管显隐——显隐永远只由字段开关决定，
// 数据条件（provider 有没有这项数据）由各字段自己的构建分支判定。两者都满足才出现。
// tests/test-display-model.cjs 双向锁死：表里的每个 id 必须在对应渲染分支有门控，
// 渲染分支里的每个门控 id 必须在这张表里；渲染出的实际顺序由渲染级断言覆盖。
// 订阅窗口三字段走 WINDOW_META 间接门控（windowFieldVisible），锚点三字段走 anchorId 参数门控，
// 见表下注释与测试里的机制说明——三者都是 fieldVisible，只是写法不同。
export const FIELD_MODES = {
  // 前两个是新宿主 Harness 自己注册的按钮（整行两种开关）；后七个是旧宿主统计行的字段。
  // 两组不会同时渲染：原生入口探测结果决定用哪一组（见 client-bundle 的 nativePills）。
  native: ['nativeActivity', 'nativeUsage', 'turnsSteps', 'llmTime', 'toolTime', 'avgTTFT', 'outputSpeed', 'cacheHit', 'tokensIO'],
  balance: ['customText', 'anchorGroup', 'mainTime', 'worldTime', 'unmapped', 'noKeyHint', 'balance', 'balanceError', 'period', 'countdown', 'sessionCost', 'usageError'],
  subscription: ['customText', 'subServiceGroup', 'mainTime', 'worldTime', 'expiry', 'subWindow5h', 'subWindowWeek', 'subWindowMonth', 'resetCountdown', 'subBalance', 'sessionCost'],
  billing: ['customText', 'billingServiceGroup', 'mainTime', 'worldTime', 'billingSpend', 'budget', 'freeQuota'],
  // 公共尾部（提醒 + 圆环）三种模式共用。提醒（refreshFailure/persistWarning/updateNotice/
  // updateFailure）没有用户开关 —— 显隐只由各自的数据条件决定（2026-11-12 起移除提醒开关组）。
  trailing: ['refreshFailure', 'persistWarning', 'updateNotice', 'updateFailure', 'contextUsage'],
}

// ---------- v1.9.0 PR2：预设色板（语义色名） ----------
// 客户端按「浅色默认 → 深色覆盖 → 增强对比」三套配对定义 --bi-palette-<name>；
// 宿主只校验名字白名单；'default'（恢复默认）不进白名单——它等价于 null，不入库。
export const PRESET_COLOR_NAMES = ['red', 'green', 'blue', 'purple', 'orange', 'neutral']
