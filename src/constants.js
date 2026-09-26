// Bottom Info Bar — shared constants (single source of truth)
// 订阅制 provider 集合：这些 provider 走"额度窗口"显示而非余额
// v1.7：新增小米 MiMo Token Plan 三集群（月度 Credits 额度窗）
// v1.16.0：新增 MiniMax（海螺）Token Plan 双站点（Global minimax / CN minimax-cn，5 小时 + 周窗口）
export const SUBSCRIPTION_PROVIDERS = ['codex', 'chatgpt', 'opencode-go', 'opencode', 'openai-codex', 'zai', 'zai-coding-cn', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams', 'command', 'command-code', 'minimax', 'minimax-cn']
// 云账单 provider 集合：这些 provider 走"账单型"显示（本月真实花费 / 预算%），与余额型/额度型互斥（FR-14）
export const BILLING_PROVIDERS = ['together', 'fireworks', 'amazon-bedrock', 'cloudflare-ai-gateway', 'cloudflare-workers-ai', 'huggingface']

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
  'kimi-coding': { account: 'kimi-coding', subscription: null, billing: null },
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
  'qwen-token-plan': { account: 'qwen-token-plan', subscription: null, billing: null },
  'qwen-token-plan-cn': { account: 'qwen-token-plan-cn', subscription: null, billing: null },
  'qwen-token-plan-individual': { account: 'qwen-token-plan-individual', subscription: null, billing: null },
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
//   native  原生信息：DSH 原生底栏原有的字段 → 渲染进「原生统计行」→ **只在完整模式可见**
//   plugin  插件信息：本插件新增的字段（含接管过来的上下文圆环）→ 渲染进主行 → **两种模式都可见**
//   notice  提醒信息：一次性提醒 → 渲染在**主行右端** → **两种模式都可见**，只在真有事时出现
//
// 模式（简洁 / 完整）的全部职责只有一条：**原生统计行显示不显示**。
// 它绝不参与任何字段的显隐判定 —— 因此「这个字段在简洁模式下能不能出现」不是独立问题，看 group 就够了。
//   group = native → 进原生统计行（.bi-native-row），随 data-density 收合到 0 高度
//   group = plugin / notice → 进主行（.bi-row2），门控只有 fieldVisible(id) 一条
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
  // ---------- 原生信息（DSH 原生统计行原有字段；整组只在完整模式可见） ----------
  { id: 'turnsSteps', label: "field.turnsSteps.label", group: 'native', colorKind: 'inherit', note: "field.turnsSteps.note" },
  { id: 'llmTime', label: "field.llmTime.label", group: 'native', colorKind: 'inherit', note: "field.llmTime.note" },
  { id: 'toolTime', label: "field.toolTime.label", group: 'native', colorKind: 'inherit', note: "field.toolTime.note" },
  { id: 'cacheHit', label: "ui.cacheHit", group: 'native', colorKind: 'inherit', note: "field.cacheHit.note" },
  { id: 'tokensIO', label: "field.tokensIO.label", group: 'native', colorKind: 'inherit', note: "field.tokensIO.note" },
  // ---------- 提醒信息（第三个列表，2026-09-25 用户拍板从插件组独立） ----------
  // 独立成组的理由：提醒是「一次性事件」而不是「常驻信息」，诉求与插件信息相反 ——
  // 想看花费但不想被红字打扰的人，必须能只关提醒而不动信息。
  // 三条铁律：① 两种模式都显示（主行右端）；② 只在真有事时出现，没事零占位；③ 开关只管开与关，与模式互不读写。
  // 更新提醒 / 更新失败提醒（自更新体系，见 docs/DECISIONS-AUTO-UPDATE.md）
  { id: 'updateNotice', label: "field.updateNotice.label", group: 'notice', suggestKeep: true, colorKind: 'alert', note: "field.updateNotice.note" },
  { id: 'updateFailure', label: "field.updateFailure.label", group: 'notice', suggestKeep: true, colorKind: 'alert', note: "field.updateFailure.note" },
  // 数据类提醒
  { id: 'balanceError', label: "field.balanceError.label", group: 'notice', suggestKeep: true, colorKind: 'alert', note: "field.balanceError.note" },
  { id: 'usageError', label: "field.usageError.label", group: 'notice', suggestKeep: true, colorKind: 'alert', note: "field.usageError.note" },
  { id: 'refreshFailure', label: "field.refreshFailure.label", group: 'notice', suggestKeep: true, colorKind: 'alert', note: "field.refreshFailure.note" },
  { id: 'persistWarning', label: "field.persistWarning.label", group: 'notice', suggestKeep: true, colorKind: 'alert', note: "field.persistWarning.note" },
  // 配置类提醒
  { id: 'noKeyHint', label: "field.noKeyHint.label", group: 'notice', suggestKeep: true, colorKind: 'alert', note: "field.noKeyHint.note" },
  { id: 'unmapped', label: "field.unmapped.label", group: 'notice', colorKind: 'muted', note: "field.unmapped.note" },
]

// 字段分组在设置页的展示顺序与标题（经构建注入客户端）。
// 顺序与信息栏的实际版式一致：原生行在上、主行在下、提醒贴主行右端。
export const FIELD_GROUP_ORDER = ['native', 'plugin', 'notice']
export const FIELD_GROUP_LABELS = {
  native: "group.native",
  plugin: "group.plugin",
  notice: "group.notice",
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
  native: ['turnsSteps', 'llmTime', 'toolTime', 'cacheHit', 'tokensIO'],
  balance: ['customText', 'anchorGroup', 'mainTime', 'worldTime', 'unmapped', 'noKeyHint', 'balance', 'balanceError', 'period', 'countdown', 'sessionCost', 'usageError'],
  subscription: ['customText', 'subServiceGroup', 'mainTime', 'worldTime', 'expiry', 'subWindow5h', 'subWindowWeek', 'subWindowMonth', 'resetCountdown', 'subBalance', 'sessionCost'],
  billing: ['customText', 'billingServiceGroup', 'mainTime', 'worldTime', 'billingSpend', 'budget', 'freeQuota'],
  trailing: ['refreshFailure', 'persistWarning', 'updateNotice', 'updateFailure', 'contextUsage'],
}

// ---------- v1.9.0 PR2：预设色板（语义色名） ----------
// 客户端按「浅色默认 → 深色覆盖 → 增强对比」三套配对定义 --bi-palette-<name>；
// 宿主只校验名字白名单；'default'（恢复默认）不进白名单——它等价于 null，不入库。
export const PRESET_COLOR_NAMES = ['red', 'green', 'blue', 'purple', 'orange', 'neutral']
