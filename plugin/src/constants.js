// Bottom Info Bar — shared constants (single source of truth)
// 订阅制 provider 集合：这些 provider 走"额度窗口"显示而非余额
// v1.7：新增小米 MiMo Token Plan 三集群（月度 Credits 额度窗）
export const SUBSCRIPTION_PROVIDERS = ['codex', 'chatgpt', 'opencode-go', 'opencode', 'openai-codex', 'zai', 'zai-coding-cn', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams']
// 云账单 provider 集合：这些 provider 走"账单型"显示（本月真实花费 / 预算%），与余额型/额度型互斥（FR-14）
export const BILLING_PROVIDERS = ['together', 'fireworks', 'amazon-bedrock', 'cloudflare-ai-gateway', 'cloudflare-workers-ai']

// ---------- v1.9.0 PR2：字段注册表（信息底栏设置页与宿主白名单的共同数据源） ----------
// 每个可独立显隐的渲染片段一个稳定英文 id（绝不绑中文文案，文案微调不毁兼容）：
// - id：settings.json fields/colors 的键（稳定英文 id，宿主白名单校验来源）
// - label：设置页显示的中文短名
// - modes：字段可能出现的模式：balance 余额制 | subscription 订阅制 | billing 账单制 | native 原生统计行 | common 通用（多模式共用）
// - group：设置页「显示字段」的两级分组（D6 用户拍板）：native 原生字段（DeepSeek 原生底部栏原有）| plugin 插件字段（本插件新增）；
//   排序原生组在前、插件组在后；组内每行说明仍标注出现条件（余额制/订阅制/账单制）
// - note：出现条件说明（设置页每行的小字说明）
// - suggestKeep：错误/提醒类字段，页面标注「建议保留」（用户拍板：允许关闭但劝留）
// - anchor：身份锚点语义标记（服务商/模型标识）。D6 用户拍板：锚点与其他字段同等可隐藏（无恒开/禁用逻辑），
//   仅用于设置页说明文字与颜色语义（provider 色回退）。
// - colorKind：颜色回退语义（客户端生成 CSS 用）：inherit 继承正文色 | alert 警示红 | period 峰红/谷绿 |
//   provider 锚点组（正文 + 服务商名主色）| muted 弱提示灰。未自定义颜色时回退这些原语义色，默认外观零变化。
export const FIELD_REGISTRY = [
  // 插件字段 · 服务锚点（D6：与其他字段同等可隐藏）
  { id: 'anchorGroup', label: 'Provider and model', group: 'plugin', modes: ['balance'], anchor: true, colorKind: 'provider', note: 'Identifies the provider and model used in this conversation.' },
  { id: 'subServiceGroup', label: 'Subscription service and model', group: 'plugin', modes: ['subscription'], anchor: true, colorKind: 'provider', note: 'Subscription service (ChatGPT, Codex, OpenCode Go, Zhipu or Xiaomi MiMo) and model or plan tier.' },
  { id: 'billingServiceGroup', label: 'Billing service and model', group: 'plugin', modes: ['billing'], anchor: true, colorKind: 'provider', note: 'Cloud billing service (Together, Fireworks, AWS Bedrock or Cloudflare) and model.' },
  // 插件字段 · 通用（多模式共用）
  { id: 'sessionCost', label: 'Session spend', group: 'plugin', modes: ['balance', 'subscription'], colorKind: 'inherit', note: 'Actual session spend, including subagents; shows ¥0.000 before any records exist. Hover for today, the last 30 days and all time.' },
  // 插件字段 · 余额制
  { id: 'balance', label: 'Balance', group: 'plugin', modes: ['balance'], colorKind: 'inherit', note: 'Actual account balance. A low balance appears in red with a Low label.' },
  { id: 'period', label: 'Pricing period', group: 'plugin', modes: ['balance'], colorKind: 'period', note: 'For models with peak/off-peak pricing (currently DeepSeek): red for peak, green for off-peak.' },
  { id: 'countdown', label: 'Price switch countdown', group: 'plugin', modes: ['balance'], colorKind: 'inherit', note: 'Time until peak/off-peak pricing changes, for models with time-based pricing.' },
  // 插件字段 · 订阅制
  { id: 'expiry', label: 'Subscription expiry', group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: 'Shown when subscription credentials include an expiry date, such as a Codex plan.' },
  { id: 'subWindow5h', label: '5-hour quota', group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: 'Remaining quota in the rolling 5-hour window. Compact view shows only the shortest available window.' },
  { id: 'subWindowWeek', label: 'Weekly quota', group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: 'Weekly quota remaining. Shown in full view; compact view prioritizes shorter windows.' },
  { id: 'subWindowMonth', label: 'Monthly quota', group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: 'Monthly quota remaining. Shown in full view; compact view prioritizes shorter windows.' },
  { id: 'resetCountdown', label: 'Quota reset countdown', group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: 'Time until the displayed quota window resets.' },
  { id: 'subBalance', label: 'Prepaid balance', group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: 'Shown for prepaid accounts, such as Zhipu pay-as-you-go, in place of quota windows.' },
  // 插件字段 · 账单制
  { id: 'billingSpend', label: 'Monthly spend / usage', group: 'plugin', modes: ['billing'], colorKind: 'inherit', note: 'Actual cloud spend or usage for the current billing period.' },
  { id: 'budget', label: 'Budget used', group: 'plugin', modes: ['billing'], colorKind: 'inherit', note: 'Shown for providers that support budget queries (currently AWS Bedrock).' },
  { id: 'freeQuota', label: 'Free quota and reset', group: 'plugin', modes: ['billing'], colorKind: 'inherit', note: 'Shown only when the API reports a daily free allowance and reset time.' },
  // 原生字段（DeepSeek 原生底部栏原有；完整模式独占可见）
  { id: 'turnsSteps', label: 'Turns and steps', group: 'native', modes: ['native'], colorKind: 'inherit', note: 'Conversation progress: N turns · M steps.' },
  { id: 'llmTime', label: 'LLM time', group: 'native', modes: ['native'], colorKind: 'inherit', note: 'Total model inference time.' },
  { id: 'toolTime', label: 'Tool time', group: 'native', modes: ['native'], colorKind: 'inherit', note: 'Total tool execution time.' },
  { id: 'cacheHit', label: 'Cache hit', group: 'native', modes: ['native'], colorKind: 'inherit', note: 'Prompt cache hit rate as a percentage.' },
  { id: 'tokensIO', label: 'Input / output tokens', group: 'native', modes: ['native'], colorKind: 'inherit', note: 'Total session usage: Input X tok · Output Y tok.' },
  // 插件字段 · 状态与提醒（建议保留）
  { id: 'unmapped', label: 'Unsupported provider hint', group: 'plugin', modes: ['balance'], colorKind: 'muted', note: 'Shown when balance lookup is not supported for the current provider.' },
  { id: 'noKeyHint', label: 'Missing credentials hint', group: 'plugin', modes: ['balance'], suggestKeep: true, colorKind: 'alert', note: 'Setup instructions when an API key is missing.' },
  { id: 'balanceError', label: 'Balance error', group: 'plugin', modes: ['balance'], suggestKeep: true, colorKind: 'alert', note: 'Shown when balance lookup fails or the last data is being displayed.' },
  { id: 'usageError', label: 'Spend error', group: 'plugin', modes: ['balance', 'subscription'], suggestKeep: true, colorKind: 'alert', note: 'Shown when spend data is temporarily unavailable.' },
  { id: 'refreshFailure', label: 'Refresh error', group: 'plugin', modes: ['balance', 'subscription', 'billing'], suggestKeep: true, colorKind: 'alert', note: 'One alert at the end of the bar when any data source fails; duplicate alerts are combined.' },
  { id: 'persistWarning', label: 'Unsaved spend alert', group: 'plugin', modes: ['balance', 'subscription', 'billing'], suggestKeep: true, colorKind: 'alert', note: 'Shown when the ledger cannot be saved. Keep enabled to spot missing amounts.' },
  { id: 'updateNotice', label: 'Update available', group: 'plugin', modes: ['balance', 'subscription', 'billing'], suggestKeep: true, colorKind: 'alert', note: 'Shown when a new version is available on npm.' },
]

// 字段分组在设置页的展示顺序与中文标题（D6 用户拍板两类：原生在前、插件在后；经构建注入客户端）
export const FIELD_GROUP_ORDER = ['native', 'plugin']
export const FIELD_GROUP_LABELS = {
  native: 'Native fields',
  plugin: 'Plugin fields',
}

// ---------- v1.9.0 PR2：预设色板（语义色名） ----------
// 客户端按「浅色默认 → 深色覆盖 → 增强对比」三套配对定义 --bi-palette-<name>；
// 宿主只校验名字白名单；'default'（恢复默认）不进白名单——它等价于 null，不入库。
export const PRESET_COLOR_NAMES = ['red', 'green', 'blue', 'purple', 'orange', 'neutral']
