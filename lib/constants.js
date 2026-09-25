// Bottom Info Bar — shared constants (single source of truth)
// 订阅制 provider 集合：这些 provider 走"额度窗口"显示而非余额
// v1.7：新增小米 MiMo Token Plan 三集群（月度 Credits 额度窗）
// v1.16.0：新增 MiniMax（海螺）Token Plan 双站点（Global minimax / CN minimax-cn，5 小时 + 周窗口）
export const SUBSCRIPTION_PROVIDERS = ['codex', 'chatgpt', 'opencode-go', 'opencode', 'openai-codex', 'zai', 'zai-coding-cn', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams', 'command', 'command-code', 'minimax', 'minimax-cn']
// 云账单 provider 集合：这些 provider 走"账单型"显示（本月真实花费 / 预算%），与余额型/额度型互斥（FR-14）
export const BILLING_PROVIDERS = ['together', 'fireworks', 'amazon-bedrock', 'cloudflare-ai-gateway', 'cloudflare-workers-ai']

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
// 不存在第二份需要手工同步的清单。下面的注释按形态分组，仅为阅读方便。
// ============================================================================================
export const FIELD_REGISTRY = [
  // ---------- 插件信息 · 身份锚点（服务商 · 模型；三种计费形态各一个，用户可隐藏） ----------
  { id: 'anchorGroup', label: "field.anchorGroup.label", group: 'plugin', anchor: true, colorKind: 'provider', note: "field.anchorGroup.note" },
  { id: 'subServiceGroup', label: "field.subServiceGroup.label", group: 'plugin', anchor: true, colorKind: 'provider', note: "field.subServiceGroup.note" },
  { id: 'billingServiceGroup', label: "field.billingServiceGroup.label", group: 'plugin', anchor: true, colorKind: 'provider', note: "field.billingServiceGroup.note" },
  // ---------- 插件信息 · 通用（任何计费形态都可能出现） ----------
  // 自定义文字：纯自定义，位于服务商/模型左侧；为空时不渲染（开关可保持开启，无内容就无占位）
  { id: 'customText', label: "field.customText.label", group: 'plugin', defaultOff: true, colorKind: 'inherit', note: "field.customText.note" },
  // 主/世界时间：时区与格式在设置页「时间与日期」中独立配置
  { id: 'mainTime', label: "field.mainTime.label", group: 'plugin', defaultOff: true, colorKind: 'inherit', note: "field.mainTime.note" },
  { id: 'worldTime', label: "field.worldTime.label", group: 'plugin', defaultOff: true, colorKind: 'inherit', note: "field.worldTime.note" },
  // 上下文占用圆环（DSH 原生 ContextMeter 的接管版）：外观、几何与交互面板与原生一致，显隐/配色并入本插件字段体系；
  // 固定在主行最右端，原生那一份由样式隐藏。归 plugin 组是结论而非笔误：它住在主行，而主行两种模式都可见。
  { id: 'contextUsage', label: "field.contextUsage.label", group: 'plugin', colorKind: 'meter', note: "field.contextUsage.note" },
  // ---------- 插件信息 · 余额制（balance） ----------
  // 本会话花费：余额制与"订阅 · 充值余额"形态共用（见 pushSessionCost）
  { id: 'sessionCost', label: "field.sessionCost.label", group: 'plugin', colorKind: 'inherit', note: "field.sessionCost.note" },
  { id: 'balance', label: "ui.balance.pushBalanceGroups", group: 'plugin', colorKind: 'inherit', note: "field.balance.note" },
  { id: 'period', label: "field.period.label", group: 'plugin', colorKind: 'period', note: "field.period.note" },
  { id: 'countdown', label: "field.countdown.label", group: 'plugin', colorKind: 'inherit', note: "field.countdown.note" },
  // ---------- 插件信息 · 订阅制（subscription） ----------
  { id: 'expiry', label: "field.expiry.label", group: 'plugin', colorKind: 'inherit', note: "field.expiry.note" },
  { id: 'subWindow5h', label: "field.subWindow5h.label", group: 'plugin', colorKind: 'inherit', note: "field.subWindow5h.note" },
  { id: 'subWindowWeek', label: "field.subWindowWeek.label", group: 'plugin', colorKind: 'inherit', note: "field.subWindowWeek.note" },
  { id: 'subWindowMonth', label: "field.subWindowMonth.label", group: 'plugin', colorKind: 'inherit', note: "field.subWindowMonth.note" },
  { id: 'resetCountdown', label: "field.resetCountdown.label", group: 'plugin', colorKind: 'inherit', note: "field.resetCountdown.note" },
  { id: 'subBalance', label: "field.subBalance.label", group: 'plugin', colorKind: 'inherit', note: "field.subBalance.note" },
  // ---------- 插件信息 · 账单制（billing） ----------
  { id: 'billingSpend', label: "field.billingSpend.label", group: 'plugin', colorKind: 'inherit', note: "field.billingSpend.note" },
  { id: 'budget', label: "field.budget.label", group: 'plugin', colorKind: 'inherit', note: "field.budget.note" },
  { id: 'freeQuota', label: "field.freeQuota.label", group: 'plugin', colorKind: 'inherit', note: "field.freeQuota.note" },
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

// ---------- v1.9.0 PR2：预设色板（语义色名） ----------
// 客户端按「浅色默认 → 深色覆盖 → 增强对比」三套配对定义 --bi-palette-<name>；
// 宿主只校验名字白名单；'default'（恢复默认）不进白名单——它等价于 null，不入库。
export const PRESET_COLOR_NAMES = ['red', 'green', 'blue', 'purple', 'orange', 'neutral']
