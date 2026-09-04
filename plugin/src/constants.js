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
  { id: 'anchorGroup', label: "field.anchorGroup.label", group: 'plugin', modes: ['balance'], anchor: true, colorKind: 'provider', note: "field.anchorGroup.note" },
  { id: 'subServiceGroup', label: "field.subServiceGroup.label", group: 'plugin', modes: ['subscription'], anchor: true, colorKind: 'provider', note: "field.subServiceGroup.note" },
  { id: 'billingServiceGroup', label: "field.billingServiceGroup.label", group: 'plugin', modes: ['billing'], anchor: true, colorKind: 'provider', note: "field.billingServiceGroup.note" },
  // 插件字段 · 通用（多模式共用）
  { id: 'sessionCost', label: "field.sessionCost.label", group: 'plugin', modes: ['balance', 'subscription'], colorKind: 'inherit', note: "field.sessionCost.note" },
  // 插件字段 · 余额制
  { id: 'balance', label: "ui.balance.pushBalanceGroups", group: 'plugin', modes: ['balance'], colorKind: 'inherit', note: "field.balance.note" },
  { id: 'period', label: "field.period.label", group: 'plugin', modes: ['balance'], colorKind: 'period', note: "field.period.note" },
  { id: 'countdown', label: "field.countdown.label", group: 'plugin', modes: ['balance'], colorKind: 'inherit', note: "field.countdown.note" },
  // 插件字段 · 订阅制
  { id: 'expiry', label: "field.expiry.label", group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: "field.expiry.note" },
  { id: 'subWindow5h', label: "field.subWindow5h.label", group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: "field.subWindow5h.note" },
  { id: 'subWindowWeek', label: "field.subWindowWeek.label", group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: "field.subWindowWeek.note" },
  { id: 'subWindowMonth', label: "field.subWindowMonth.label", group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: "field.subWindowMonth.note" },
  { id: 'resetCountdown', label: "field.resetCountdown.label", group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: "field.resetCountdown.note" },
  { id: 'subBalance', label: "ui.prepaidBalance", group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: "field.subBalance.note" },
  // 插件字段 · 账单制
  { id: 'billingSpend', label: "field.billingSpend.label", group: 'plugin', modes: ['billing'], colorKind: 'inherit', note: "field.billingSpend.note" },
  { id: 'budget', label: "field.budget.label", group: 'plugin', modes: ['billing'], colorKind: 'inherit', note: "field.budget.note" },
  { id: 'freeQuota', label: "field.freeQuota.label", group: 'plugin', modes: ['billing'], colorKind: 'inherit', note: "field.freeQuota.note" },
  // 原生字段（DeepSeek 原生底部栏原有；完整模式独占可见）
  { id: 'turnsSteps', label: "field.turnsSteps.label", group: 'native', modes: ['native'], colorKind: 'inherit', note: "field.turnsSteps.note" },
  { id: 'llmTime', label: "field.llmTime.label", group: 'native', modes: ['native'], colorKind: 'inherit', note: "field.llmTime.note" },
  { id: 'toolTime', label: "field.toolTime.label", group: 'native', modes: ['native'], colorKind: 'inherit', note: "field.toolTime.note" },
  { id: 'cacheHit', label: "ui.cacheHit", group: 'native', modes: ['native'], colorKind: 'inherit', note: "field.cacheHit.note" },
  { id: 'tokensIO', label: "field.tokensIO.label", group: 'native', modes: ['native'], colorKind: 'inherit', note: "field.tokensIO.note" },
  // 插件字段 · 状态与提醒（建议保留）
  { id: 'unmapped', label: "field.unmapped.label", group: 'plugin', modes: ['balance'], colorKind: 'muted', note: "field.unmapped.note" },
  { id: 'noKeyHint', label: "field.noKeyHint.label", group: 'plugin', modes: ['balance'], suggestKeep: true, colorKind: 'alert', note: "field.noKeyHint.note" },
  { id: 'balanceError', label: "field.balanceError.label", group: 'plugin', modes: ['balance'], suggestKeep: true, colorKind: 'alert', note: "field.balanceError.note" },
  { id: 'usageError', label: "field.usageError.label", group: 'plugin', modes: ['balance', 'subscription'], suggestKeep: true, colorKind: 'alert', note: "field.usageError.note" },
  { id: 'refreshFailure', label: "field.refreshFailure.label", group: 'plugin', modes: ['balance', 'subscription', 'billing'], suggestKeep: true, colorKind: 'alert', note: "field.refreshFailure.note" },
  { id: 'persistWarning', label: "field.persistWarning.label", group: 'plugin', modes: ['balance', 'subscription', 'billing'], suggestKeep: true, colorKind: 'alert', note: "field.persistWarning.note" },
  { id: 'updateNotice', label: "ui.updateAvailable", group: 'plugin', modes: ['balance', 'subscription', 'billing'], suggestKeep: true, colorKind: 'alert', note: "field.updateNotice.note" },
]

// 字段分组在设置页的展示顺序与中文标题（D6 用户拍板两类：原生在前、插件在后；经构建注入客户端）
export const FIELD_GROUP_ORDER = ['native', 'plugin']
export const FIELD_GROUP_LABELS = {
  native: "group.native",
  plugin: "group.plugin",
}

// ---------- v1.9.0 PR2：预设色板（语义色名） ----------
// 客户端按「浅色默认 → 深色覆盖 → 增强对比」三套配对定义 --bi-palette-<name>；
// 宿主只校验名字白名单；'default'（恢复默认）不进白名单——它等价于 null，不入库。
export const PRESET_COLOR_NAMES = ['red', 'green', 'blue', 'purple', 'orange', 'neutral']
