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
  { id: 'anchorGroup', label: '服务商与模型', group: 'plugin', modes: ['balance'], anchor: true, colorKind: 'provider', note: '当前对话使用的服务商与模型名，信息栏的身份锚点' },
  { id: 'subServiceGroup', label: '订阅服务与模型', group: 'plugin', modes: ['subscription'], anchor: true, colorKind: 'provider', note: '订阅服务名（ChatGPT/Codex/OpenCode Go/智谱/小米 MiMo）与模型或套餐档位' },
  { id: 'billingServiceGroup', label: '账单服务与模型', group: 'plugin', modes: ['billing'], anchor: true, colorKind: 'provider', note: '云账单服务名（Together/Fireworks/AWS Bedrock/Cloudflare）与模型名' },
  // 插件字段 · 通用（多模式共用）
  { id: 'sessionCost', label: '本会话花费', group: 'plugin', modes: ['balance', 'subscription'], colorKind: 'inherit', note: '当前会话（含子代理）的真实花费；新会话尚无记账时显示 ¥0.000，悬停可看今天/近一月/全部' },
  // 插件字段 · 余额制
  { id: 'balance', label: '余额', group: 'plugin', modes: ['balance'], colorKind: 'inherit', note: '服务商账户的真实余额；低余额时数字变红并带「低」字' },
  { id: 'period', label: '定价时段', group: 'plugin', modes: ['balance'], colorKind: 'period', note: '仅峰谷价模型显示（当前为 DeepSeek 系列）：高峰价红色 / 空闲价绿色' },
  { id: 'countdown', label: '时段切换倒计时', group: 'plugin', modes: ['balance'], colorKind: 'inherit', note: '仅峰谷价模型显示：距空闲/距高峰的小时计倒计时' },
  // 插件字段 · 订阅制
  { id: 'expiry', label: '订阅到期日', group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: '订阅登录凭据中带有到期信息时显示（如 Codex 套餐）' },
  { id: 'subWindow5h', label: '5 小时额度窗口', group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: '5 小时滚动额度剩余百分比；简洁模式下仅显示时间最短的可用窗口' },
  { id: 'subWindowWeek', label: '周额度窗口', group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: '每周额度剩余百分比；完整模式显示，简洁模式让位给更短窗口' },
  { id: 'subWindowMonth', label: '月额度窗口', group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: '每月额度剩余百分比；完整模式显示，简洁模式让位给更短窗口' },
  { id: 'resetCountdown', label: '额度重置倒计时', group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: '当前显示的额度窗口距重置的倒计时' },
  { id: 'subBalance', label: '充值余额', group: 'plugin', modes: ['subscription'], colorKind: 'inherit', note: '订阅源为充值余额形态时显示（如智谱按量账户），与额度窗口互斥' },
  // 插件字段 · 账单制
  { id: 'billingSpend', label: '本月花费/用量', group: 'plugin', modes: ['billing'], colorKind: 'inherit', note: '云账单当前计费周期的真实花费或用量' },
  { id: 'budget', label: '预算使用', group: 'plugin', modes: ['billing'], colorKind: 'inherit', note: '仅提供预算查询的服务商显示（当前为 AWS Bedrock）' },
  { id: 'freeQuota', label: '免费额度与重置', group: 'plugin', modes: ['billing'], colorKind: 'inherit', note: '接口显式给出每日免费额度与重置时刻时才显示，绝不编造' },
  // 原生字段（DeepSeek 原生底部栏原有；完整模式独占可见）
  { id: 'turnsSteps', label: '轮次与步数', group: 'native', modes: ['native'], colorKind: 'inherit', note: '「N 轮 · M 步」对话进度统计' },
  { id: 'llmTime', label: 'LLM 耗时', group: 'native', modes: ['native'], colorKind: 'inherit', note: '模型推理累计耗时' },
  { id: 'toolTime', label: '工具调用耗时', group: 'native', modes: ['native'], colorKind: 'inherit', note: '工具调用累计耗时' },
  { id: 'cacheHit', label: '缓存命中', group: 'native', modes: ['native'], colorKind: 'inherit', note: '提示词缓存命中率百分比' },
  { id: 'tokensIO', label: '输入/输出 tokens', group: 'native', modes: ['native'], colorKind: 'inherit', note: '「输入 X tok · 输出 Y tok」本次会话累计用量' },
  // 插件字段 · 状态与提醒（建议保留）
  { id: 'unmapped', label: '未适配提示', group: 'plugin', modes: ['balance'], colorKind: 'muted', note: '当前服务商暂无余额查询适配时出现的弱提示' },
  { id: 'noKeyHint', label: '未配置凭据提示', group: 'plugin', modes: ['balance'], suggestKeep: true, colorKind: 'alert', note: '缺少 API Key 时的设置引导文案' },
  { id: 'balanceError', label: '余额获取/刷新失败提示', group: 'plugin', modes: ['balance'], suggestKeep: true, colorKind: 'alert', note: '余额查询失败或正在显示上次数据时的提示' },
  { id: 'usageError', label: '花费获取失败提示', group: 'plugin', modes: ['balance', 'subscription'], suggestKeep: true, colorKind: 'alert', note: '花费数据暂时不可用时的提示' },
  { id: 'refreshFailure', label: '刷新失败提示', group: 'plugin', modes: ['balance', 'subscription', 'billing'], suggestKeep: true, colorKind: 'alert', note: '任一数据源降级时在行尾合并显示的一个提醒（多个来源自动去重）' },
  { id: 'persistWarning', label: '账单未保存提醒', group: 'plugin', modes: ['balance', 'subscription', 'billing'], suggestKeep: true, colorKind: 'alert', note: '账本落盘异常时出现；隐藏后金额可能悄悄不准，建议保留' },
  { id: 'updateNotice', label: '新版本提醒', group: 'plugin', modes: ['balance', 'subscription', 'billing'], suggestKeep: true, colorKind: 'alert', note: 'npm 上有新版本时提醒更新' },
]

// 字段分组在设置页的展示顺序与中文标题（D6 用户拍板两类：原生在前、插件在后；经构建注入客户端）
export const FIELD_GROUP_ORDER = ['native', 'plugin']
export const FIELD_GROUP_LABELS = {
  native: '原生字段',
  plugin: '插件字段',
}

// ---------- v1.9.0 PR2：预设色板（语义色名） ----------
// 客户端按「浅色默认 → 深色覆盖 → 增强对比」三套配对定义 --bi-palette-<name>；
// 宿主只校验名字白名单；'default'（恢复默认）不进白名单——它等价于 null，不入库。
export const PRESET_COLOR_NAMES = ['red', 'green', 'blue', 'purple', 'orange', 'neutral']
