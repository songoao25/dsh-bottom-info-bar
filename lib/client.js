window.__ModuleLoader__.load({ id: "dsh-bottom-info-bar", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
// Bottom Info Bar（底部信息栏插件）— client half（静态 bundle 形态）
// - host.call(method, args) → fetch POST /_dsh/dsh-bottom-info-bar/<method>（JSON）
// - ctx.interval / ctx.timeout → window.setInterval / window.setTimeout
// - styles.insert(css) → document 注入 <style>（installStyles）
// - React 由 bundle 的 require('react') 提供（seed 模块）
// 样式策略：① 整个数据令牌加粗（.bi-num 700）② 服务商名加粗 ③ 高峰价与低余额用警示红、空闲价用绿色
// 显示行为：① 本会话花费始终显示——新会话/对话刚开始（尚无记账）时显示"本会话 ¥0.000"，
//   hover 仍可查看持久化的 今天/近一月/全部；
//   ② 完整模式下原生统计行无 steps 门槛，对话刚开始即显示"0 轮 · 0 步"。
// 失败策略（AUDIT-CODE-REVIEW 缺陷 #1）：逐接口容错——
//   ① rpc 带 20s 超时且可被外部 AbortSignal 中止（组件卸载即取消），杜绝永久"加载中…"；
//   ② load 用 Promise.allSettled 逐端点处理：成功端点写新值，失败端点保留旧值并记入 errors 表；
//   ③ 渲染永不整栏降级：旧数据照常显示，仅失败项打降级标记（分块/全局提示）。
'use strict';

const React = require('react');
// 宿主 seed 模块缺席时整包不得在加载期抛错：灰度桌面端可能不提供该模块，
// 缺了它设置页退回自绘控件、信息栏不受影响（见 bibSetNative 的存在性判定）。
// 取不到时给空对象（而非 null），下面的成员读取与 bibSetNative 无需再加空守卫。
let BIB_SET_PRIMITIVES = null;
try {
  const candidate = require('@deepseek-ai/dsh-client-ui-primitives');
  if (candidate && (typeof candidate === 'object' || typeof candidate === 'function')) BIB_SET_PRIMITIVES = candidate;
} catch (err) { BIB_SET_PRIMITIVES = null; }
if (BIB_SET_PRIMITIVES === null) BIB_SET_PRIMITIVES = {};
// 上下文明细面板要挂到 body（底栏处在多层 flex/滚动容器里，就地渲染会被裁切；原生 ContextMeter 同样用 portal）。
// react-dom 是 web 客户端公开的 seed 模块；缺失/形态不符时降级为就地渲染，不影响信息栏本身。
let ReactDOM = null;
try {
  const candidate = require('react-dom');
  if (candidate && typeof candidate.createPortal === 'function') ReactDOM = candidate;
} catch (err) { ReactDOM = null; }
// 定时器统一入口（两端适配，2026-09-26 审计）：浏览器 / Electron 渲染进程 / Node 都有全局
// setTimeout；只在三者全缺的极简宿主里退化为「不定超时」（rpc 按无超时继续、轮询按不轮询继续），
// 绝不在业务路径上裸读 window 定时器。调用方一律走这两个函数，不再各自写 typeof window
// 判定（守卫写在调用点就等于没写，见 host 侧 timeoutSignal 的同型教训）。
function scheduleTimeout(fn, ms) {
  try {
    if (typeof setTimeout === 'function') return setTimeout(fn, ms);
  } catch (err) { /* 全局定时器不可用时继续试 window */ }
  if (typeof window !== 'undefined' && window && typeof window.setTimeout === 'function') {
    try { return window.setTimeout(fn, ms); } catch (err) { return null; }
  }
  return null;
}
function cancelTimeout(id) {
  if (id === null || id === undefined) return;
  try {
    if (typeof clearTimeout === 'function') { clearTimeout(id); return; }
  } catch (err) { /* 继续试 window */ }
  if (typeof window !== 'undefined' && window && typeof window.clearTimeout === 'function') {
    try { window.clearTimeout(id); } catch (err) { /* 定时器都清不掉就放弃，超时回调自生自灭 */ }
  }
}
function scheduleInterval(fn, ms) {
  try {
    if (typeof setInterval === 'function') return setInterval(fn, ms);
  } catch (err) { /* 全局定时器不可用时继续试 window */ }
  if (typeof window !== 'undefined' && window && typeof window.setInterval === 'function') {
    try { return window.setInterval(fn, ms); } catch (err) { return null; }
  }
  return null;
}
function cancelInterval(id) {
  if (id === null || id === undefined) return;
  try {
    if (typeof clearInterval === 'function') { clearInterval(id); return; }
  } catch (err) { /* 继续试 window */ }
  if (typeof window !== 'undefined' && window && typeof window.clearInterval === 'function') {
    try { window.clearInterval(id); } catch (err) { /* 定时器都清不掉就放弃 */ }
  }
}
// 原生上下文圆环的悬浮说明用 primitives 的 Tooltip（组件，非浏览器原生 title）；能用就复用，外观与原生一致，
// 该成员缺失时退回 title——两者不同时使用，避免叠出两个提示框。
// 必须定义在这里（FIELD_REGISTRY 锚点之前）：D1 结构测试会切片求值锚点之后到 module.exports 之间的源码，
// 那段切片里引用不到 BIB_SET_PRIMITIVES，多一条依赖就会让求值抛错。
const CONTEXT_TOOLTIP = typeof BIB_SET_PRIMITIVES.Tooltip === 'function' ? BIB_SET_PRIMITIVES.Tooltip : null;
// 设置页卡片头部的折叠箭头同样取自 primitives，但它的导出名跟着宿主版本变过：
//   DSH ≤0.1.6：IconChevronDownOutline14（尺寸写进名字）
//   DSH ≥0.1.7：IconChevronDownOutlineRegular / IconChevronDownOutlineMedium（改成描边档位）
// 两边各只有自己那一套名字，所以运行时择优；都取不到时退回 CSS 画的箭头。
// 绝不能把 undefined 直接交给 React.createElement：那会让整个插件页配置区块抛
// React #130 而整块白屏——2026-09-22 升级到 0.1.7-alpha.1 后正是这么踩的（信息栏
// 本体照常显示，只有插件页的「信息栏设置」整块空白且控制台报 slot entry crashed）。
// 同样必须定义在 FIELD_REGISTRY 锚点之前：锚点之后的切片求值看不到 BIB_SET_PRIMITIVES。
const BIB_SET_CHEVRON_ICON = BIB_SET_PRIMITIVES.IconChevronDownOutlineRegular
  || BIB_SET_PRIMITIVES.IconChevronDownOutlineMedium
  || BIB_SET_PRIMITIVES.IconChevronDownOutline14
  || null;
// 设置面板一律优先渲染宿主原生组件（primitives），而不是自己画一套长得像的：
// 按钮/开关/标签/状态点/输入框/下拉菜单的形状、配色、动效都由宿主维护，宿主换皮时插件自动跟随。
// 每个成员都做存在性判断，取不到时退回插件内的等价实现——绝不能把 undefined 交给
// React.createElement（会产生 React #130 并让整个配置区块白屏，见上面折叠箭头的教训）。
function bibSetNative(name) {
  const member = BIB_SET_PRIMITIVES[name];
  return typeof member === 'function' || (member && typeof member === 'object') ? member : null;
}
const BIB_SET_NATIVE_BUTTON = bibSetNative('Button');
const BIB_SET_NATIVE_SWITCH = bibSetNative('Switch');
const BIB_SET_NATIVE_MENU = bibSetNative('Menu');
// 决策 2/4：分组折叠用原生 DisclosureRow，重置二次确认用原生 RiskConfirmation。
// 与上面同一条铁律：取不到时退回插件内等价实现，绝不把 undefined 交给 React.createElement。
const BIB_SET_NATIVE_RISK_CONFIRM = bibSetNative('RiskConfirmation');
const LOCALE_NAMESPACE = 'dsh-bottom-info-bar';
const LOCALES = {"zh":{"meta.title":"底部信息栏","meta.description":"在输入框下方显示当前模型、余额和花费。","ui.requestTimedOut":"请求超时","ui.requestCanceled":"请求已取消","ui.couldNotParseResponse":"响应解析失败","ui.rpcFailed":"RPC 失败","ui.refreshFailed":"刷新失败","color.red":"红","color.green":"绿","color.blue":"蓝","color.purple":"紫","color.orange":"橙","color.neutral":"中性","ui.pleaseTryAgainLater":"请稍后再试","ui.restoreDefaultColor":"恢复默认颜色","ui.infoBarSettings":"信息栏","ui.settingsAreTemporarilyUnavailable":"暂时无法读取设置","ui.loadingInfoBarSettings":"正在加载设置…","ui.couldNotLoadInfoBar":"无法读取信息栏设置：","ui.changesAppliedButCouldNot":"已应用，但无法保存到本地：","ui.unknownReason":"未知原因","ui.couldNotSave":"{errorPrefix}保存失败：{value}","ui.color":"“{value}”颜色：","ui.hasAnInvalidColorEnter":"“{value}”的颜色格式不正确，请输入 #RRGGBB（例如 #0044CC）。","ui.defaultColorsRestored":"已恢复默认颜色","ui.defaultLabelsRestored":"已恢复默认显示设置","ui.couldNotReset":"重置失败：{value}","ui.show":"显示{label}","ui.clickToHide":"点击隐藏","ui.clickToShow":"点击显示","ui.presetColor":"{label}的预设颜色","ui.customColor":"{label}的自定义颜色","ui.customColorOpenColorPicker":"自定义颜色（打开系统取色器）","ui.customColorItem":"自定义…","ui.colorSwatchLabel":"{label}的颜色","ui.hexColor":"{label}的十六进制颜色","ui.expand":"展开","ui.collapse":"收起","ui.saving":"正在保存…","ui.processing":"正在处理…","ui.visibleFields":"要显示的信息","ui.timeDateTitle":"时间与日期","ui.timeDateDesc":"主时间和世界时间的时区。","ui.customTextSectionDesc":"在信息栏中显示一行自定义文字。","ui.resetConfirmTitle":"重置信息栏设置","ui.resetConfirmDescFields":"将所有显示项恢复为默认；自定义颜色不受影响，改动会直接生效。","ui.resetConfirmDescColors":"将清除全部自定义颜色并恢复默认配色，字段显示开关不受影响。该操作会直接应用到信息栏。","ui.resetConfirmAcknowledge":"我了解这次重置不可撤销","ui.resetConfirmCancel":"取消","ui.resetConfirmConfirm":"确认重置","ui.resetLabels":"恢复显示","ui.resetColors":"恢复颜色","ui.resetRowTitle":"恢复默认","ui.resetRowDesc":"将显示项或颜色恢复为默认。","ui.customTextCount":"已输入 {value}/64 个字符","ui.couldNotDisplayInfoBar":"无法显示信息栏设置：{value}","ui.dataAndBilling":"账单数据","ui.dataAndBillingDesc":"导出或清除本插件保存的用量与花费记录。","ui.exportBillingRecords":"导出账单","ui.exportBillingRecordsDesc":"将记录导出为 CSV 或 JSON 文件。","ui.exportBillingCsv":"导出 CSV","ui.exportBillingJson":"导出 JSON","ui.clearBillingRecords":"清除账单","ui.clearBillingRecordsDesc":"清除后无法恢复。","ui.clearBillingRecordsConfirm":"确定清除本插件保存的全部账单记录吗？建议先导出。清除后无法恢复，但不会影响设置或登录信息。","ui.exportedBillingRecords":"已导出 {count} 条账单记录（{format}）","ui.noBillingRecordsToExport":"目前没有可导出的账单记录。","ui.exportFailed":"导出失败：{value}","ui.exportIncomplete":"历史账单读取不完整：{value}。本次未导出，请稍后再试。","ui.clearFailed":"清除失败：{value}","ui.clearFailedWithoutDetails":"账单记录未能全部清除","ui.clearedBillingRecords":"已清除 {count} 条账单记录","ui.clearCanceled":"已取消","ui.exportNotSupported":"当前环境不支持下载文件。","ui.weekly":"周","ui.monthly":"月","ui.window":"窗口","ui.quotaDisplayUsed":"已用","ui.quotaDisplayRemaining":"剩余","ui.quotaDisplayModeTitle":"订阅窗口百分比方向","ui.quotaDisplayModeDesc":"订阅额度窗口按「剩余」或「已用」显示；低额度告警始终按剩余不足 20% 判定。","ui.windowUsedRemaining":"{label}窗口：已用 {usedPercent}%（剩余 {value}%）","ui.windowUsedRemainingResets":"{label}窗口 已用 {usedPercent}%（剩余 {value}%） · 重置 {value4}","ui.minimax":"MiniMax","ui.supportsImageInput":"支持图像输入。","ui.vision":"视觉","ui.unknown":"未知","ui.unknownModel":"未知模型","ui.modelSelectionPending":"正在读取当前模型","ui.modelCapabilityPending":"正在确认是否支持图像输入","ui.pluginVersion":"\n插件版本：{current}","ui.provider":"服务商：{provLabel} {modelLabel}\n","ui.pricingPeakOffPeakBeijing":"定价：峰谷价（北京时间周一至周五高峰 9-12、14-18 点；周末及中国节假日全天空闲）","ui.pricingFixed":"定价：固定价","ui.pricingNotListedUsingDefaults":"定价：暂未收录，不计算花费","ui.zhipu":"智谱","ui.xiaomiMiMo":"小米 MiMo","ui.commandCode":"Command Code","ui.subscription":"订阅","ui.cloudBilling":"云账单","ui.plan":"\n套餐：{plan}","ui.expiresLocalTime":"\n到期：{value}（本地时区）","ui.subscriptionServiceModel":"订阅服务：{serviceName}\n模型：{rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.balanceLookupIsNotYet":"暂时无法读取该服务商的余额。","ui.notSupported":"未适配","ui.accountDataUnavailable":"无公开账户数据","ui.accountDataUnavailableDetail":"该服务商已支持模型识别与本地用量记账，但没有可由插件安全读取的公开余额或配额接口。","ui.notConfigured":"未配置 ","ui.notConfiguredConfigureItIn":"未配置 {credName}。请在\"设置 → 模型\"中填写。","ui.notConfiguredSettingsModels":"未配置 {credName}。请在设置 → 模型中填写。","ui.accountSignedOut":"账号未登录","ui.accountSignedOutHow":"在 DSH 的「设置 → 账户」里登录 DeepSeek 账号，这里就会显示余额。","ui.estimatedBalance":"估算余额：{symbol}{value}","ui.balance":"余额：{symbol}{value}","ui.balanceDetailToppedUp":"充值余额：{symbol}{value}","ui.balanceDetailGranted":"赠金余额：{symbol}{value}","ui.balance.pushBalanceGroups":"余额","ui.low":"低","ui.estimated":"（估算）","ui.balanceIsTemporarilyUnavailableShowing":"余额暂不可用；正在显示上次数据并自动重试。","ui.couldNotLoadBalanceCheck":"余额获取失败。请检查网络和 API Key。","ui.balanceUnavailable":"余额获取失败","ui.beijingTime":"北京时间 ","ui.peakPrice":"高峰价","ui.offPeakPrice":"空闲价","ui.input":"：输入 ¥","ui.mCachedInput":"/M · 缓存 ¥","ui.mOutput":"/M · 输出 ¥","ui.beijingTimeSwitchesTo":"北京时间 {atLabel} 切换为","ui.until":"距","ui.offPeak":"空闲","ui.peak":"高峰","ui.today":"今天 {symbol}{value}","ui.lastDays":"近一月 {symbol}{value}","ui.allTime":"全部 {symbol}{value}","ui.sessionIncludingSubagents":"本会话 {costTxt}（含子代理）{value}","ui.session":"本会话","ui.spendIsTemporarilyUnavailableChat":"花费暂不可用；不会影响对话。","ui.spendUnavailable":"花费获取失败","ui.noSignInCredentialsFound":"未找到 {serviceName} 登录凭证。请重新授权。","ui.credentialsHaveExpiredPleaseReauthorize":"{serviceName} 登录凭证已失效。请重新授权。","ui.deniedAccessReauthorizeOrTry":"{serviceName} 拒绝访问。请重新授权或稍后再试。","ui.rateLimitReachedPleaseTry":"{serviceName} 请求过于频繁。请稍后再试。","ui.timedOutCheckYourConnection":"{serviceName} 响应超时。请检查网络后再试。","ui.returnedAnUnrecognizedResponsePlease":"{serviceName} 返回的数据暂时无法识别。请稍后再试。","ui.isTemporarilyUnavailableCheckYour":"{serviceName} 暂不可用。请检查网络后再试。","ui.subscriptionExpiresLocalTime":"订阅到期：{value}（本地时区）","ui.expires":"到期","ui.subscriptionSource":"订阅源：{value}（","ui.prepaidBalance":"可用余额","ui.availableBalanceLabel":"可用余额","ui.remainingCredits":"剩余额度","ui.availableBalance":"可用余额：{balTxt}","ui.availableCredits":"剩余 credits：{value}","ui.subscriptionSource.titleLines":"订阅源：{value}","ui.windowRemainingUsed":"{label}窗口：剩余 {value}%（已用 {usedPercent}%）","ui.resetsResetsIn":" · 重置 {value} · 距重置 {value2}","ui.windowRemainingUsedResets":"{label}窗口 剩余 {value}%（已用 {usedPercent}%） · 重置 {value4}","ui.resetsIn":"距重置","ui.configureItInSettingsModels":"。请在\"设置 → 模型\"中填写。","ui.deniedAccessTheTokenMay":"{serviceName} 拒绝访问：Token 可能缺少账单读取权限。","ui.billingIsTemporarilyUnavailableCheck":"{serviceName} 账单暂不可用。请检查网络与权限后再试。","ui.billingSource":"账单源：{value}","ui.thisMonthSSpend":"本月花费：{symbol}{value}","ui.budgetUsed":"预算使用：{value}%","ui.dailyFreeQuotaRemaining":"每日免费额度剩余：{value}","ui.thisMonth":"本月","ui.thisMonthSUsage":"本月用量","ui.budget":"预算","ui.free":"免费","ui.resetsIn.pushBillingGroups":"{value} · 距重置 {value2}","ui.billingServiceModel":"账单服务：{serviceName}\n模型：{modelLabel}{versionLine}","ui.pricing":"定价","ui.spend":"花费","ui.mode":"模式","ui.subscriptionQuota":"订阅额度","ui.billing":"账单","ui.temporarilyUnavailableKeepingTheLast":"暂不可用；正在保留上次数据并自动重试。","ui.spendJournalSavedButThe":"账单流水已保存，但可直接查看的账单文件暂未更新：","ui.thisSpendRecordWasNot":"本次账单未保存，不会计入金额：","ui.ledgerUpdatePending":"账单待整理","ui.spendNotSaved":"账单未保存","ui.versionAndUpdateTitle":"版本与更新","ui.versionAndUpdateDesc":"更新只替换插件自己的程序文件，账单记录和设置不受影响。","ui.versionUnavailable":"当前运行的 DSH 还没载入这一版插件的更新功能，所以这里暂时只显示这一行。重启 DSH 后，下面就会出现当前版本、更新方式与「检查更新」。","ui.versionRunning":"运行中版本 {version}","ui.versionLatest":"最新版本 {version}","ui.versionLastCheck":"上次检查：{time}","ui.versionUnknown":"未知","ui.timeJustNow":"刚刚","ui.timeMinutesAgo":"{n} 分钟前","ui.timeHoursAgo":"{n} 小时前","ui.timeDaysAgo":"{n} 天前","ui.autoUpdateTitle":"更新方式","ui.updateModeAutoDesc":"启动 DSH 时自动检查并安装。使用中手动检查到新版后，确认才会更新。","ui.updateModeManualDesc":"启动时不自动安装。使用中手动检查到新版后，确认才会更新。","ui.updateModeAuto":"自动更新","ui.updateModeManual":"手动更新","ui.updateConfirm":"发现新版本 {version}。现在更新插件吗？更新后需重启 DSH 才会生效。","ui.updateCheckNow":"检查更新","ui.updateChecking":"检查中…","ui.updateInstallNow":"更新到 {version}","ui.updateInstalling":"正在更新到 {version}…","ui.updateAvailableNow":"发现新版本 {version}，现在可以更新。","ui.updateRollbackFailed":"回滚没成功，本机没有可用的备份。你可以到插件页卸载后重装。","ui.updateHostOutdated":"这次动作没有执行：当前运行的 DSH 还带着旧版本的更新逻辑，重启 DSH 之后按钮就好用了。","ui.updateUpToDate":"已是最新版本。","ui.updateDisabled":"当前环境不支持自动更新","ui.updateDisabledWhy":"自动更新只在插件装进 DSH 插件目录后可用。这一份是从源码或链接装进来的，升级请用原来的命令。","ui.updatePendingRestart":"已更新到 {version}，重启 DSH 后生效。","ui.updateFailed":"上次更新没成功","ui.updateFallbackWhy":"万一新版有问题，可以退回上一版。","ui.updateHoldWhy":"这个版本被你暂缓过，不会自己装回来。","ui.updateErrorIncompleteDownload":"更新包没下完整（网络中途断了），这次已放弃，你现在用的版本没受影响。","ui.updateErrorIntegrityMismatch":"更新包没通过安全校验，这次已放弃，你现在用的版本没受影响。","ui.updateErrorDownloadFailed":"连不上更新服务器，稍后再试。","ui.updateErrorTooLarge":"更新包大得反常，出于安全已放弃。","ui.updateErrorPayloadMismatch":"更新包的内容和版本号对不上，已放弃。","ui.updateErrorPayloadUnsafe":"更新包里出现了不该有的文件路径，已放弃。","ui.updateErrorCheckFailed":"检查更新没成功，可能是网络问题。","ui.updateErrorUnknown":"更新没成功，详细原因记在更新日志里。","ui.updateRollback":"回滚到上一版","ui.updateRolledBack":"已回滚到上一版 {version}。","ui.updateHeld":"新版 {version} 已被你暂缓，不会自动装回来。","ui.updateAllowHeld":"允许更新到 {version}","ui.updateRestartBadge":"重启生效","ui.updateFailedBadge":"更新失败","ui.tools":"工具调用","ui.avgTTFT":"首 token 平均","ui.cacheHit":"缓存命中","ui.cacheHitScope":"按 token 计：命中 {hit} / 未命中 {miss}（{percent}% 命中）。\n口径：当前会话主 Agent 的模型调用，不含子代理。","ui.tokenScope":"输入 / 输出是本会话主 Agent 的模型调用累计，不含子代理；右侧『本会话』花费含子代理。","ui.spendPartlyUnpriced":"其中部分调用尚未收录价格（绝不套用其他模型价格估算），实际花费高于此处显示值。","ui.input.BottomInfoBar":"输入","ui.output":"输出","ui.savingView":"正在保存切换…","ui.clickToSwitchFullCompact":"单击切换 完整/简洁","ui.pressEnterOrSpaceFor":"按 Enter 或空格切换为简洁模式。","ui.pressEnterOrSpaceFor.BottomInfoBar":"按 Enter 或空格切换为完整模式。","host.hour":"5 小时","host.unknownProvider":"未知服务商","error.subscription.request-failed":"订阅额度请求未知异常","host.settingsFileCouldNotBe":"设置文件写入未完成","error.settings.save-failed":"settings.json 落盘失败：{value}","error.balance.credentials":"凭据读取失败","error.balance.not-configured":"未配置 {credential}","error.balance.account-signed-out":"内置账号未登录","error.balance.account-unavailable":"当前宿主没有内置账号服务","error.balance.account-request-failed":"内置账号余额获取失败","error.request.http":"请求失败（HTTP {status}）","error.request.parse":"响应格式异常","error.subscription.not-connected":"未找到 ChatGPT 订阅登录凭证（~/.codex/auth.json），请安装 dsh-chatgpt-sub 插件绑定","error.subscription.credentials-missing":"ChatGPT 订阅登录凭证缺少 id_token，请安装 dsh-chatgpt-sub 插件重新绑定","error.subscription.opencode-not-configured":"未配置 OpenCode Go（OPENCODE_GO_API_KEY 或 opencode auth.json）","error.subscription.commandcode-not-configured":"未配置 Command Code（COMMAND_CODE_API_KEY、CMD_API_KEY 或 ~/.commandcode/auth.json）","error.subscription.commandcode-auth-failed":"Command Code 登录凭证已失效。请重新登录或更新 API Key","error.subscription.commandcode-unrecognized":"Command Code 返回了无法识别的额度格式（接口可能已变更），已保留上次数据","host.zhipu":"智谱 {mapped}","host.zhipu.parseZaiQuota":"智谱 {value}{value2}","error.subscription.zhipu-not-configured":"未配置智谱 API Key（ZAI_API_KEY 或 ZAI_CODING_CN_API_KEY）","error.subscription.zhipu-auth-failed":"智谱 API 认证失败（密钥过期或不正确）","error.subscription.zhipu-unrecognized":"智谱返回了无法识别的额度格式（接口可能已变更），已保留上次数据","error.request.failed":"请求失败（{value} {msg}）","error.subscription.xiaomi-not-configured":"未配置小米 MiMo Token Plan 凭据（{credName} 或 XIAOMI_API_KEY）","error.subscription.xiaomi-http":"请求失败（HTTP {value}）","error.subscription.minimax-not-configured":"未配置 MiniMax 凭据（MINIMAX_API_KEY 或 MINIMAX_CN_API_KEY）。查询 Token Plan 必须使用 Subscription Key，按量 API Key 会被服务端拒绝","error.subscription.minimax-auth-failed":"MiniMax 拒绝了当前 API Key：查询 Token Plan 必须使用 Subscription Key（在 Token Plan 订阅页生成），按量 API Key 会被服务端拒绝（status_code=1004 / HTTP 401）","error.subscription.minimax-unrecognized":"MiniMax 返回了无法识别的额度格式（接口可能已变更），已保留上次数据","error.billing.together-not-configured":"未配置 TOGETHER_API_KEY","host.actualMonthlyBillFromThe":"本月真实账单（Together 官方 Usage API）","error.billing.fireworks-not-configured":"未配置 FIREWORKS_API_KEY","error.billing.fireworks-account":"账户解析失败（未取得 account_id）","host.actualBillForThisPeriod":"本周期真实账单（Fireworks Billing Summary）","host.actualUsageForThisPeriod":"本周期真实用量（billingUsage 回退端点，无金额）","error.billing.aws-not-configured":"未配置 AWS 凭据（AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY）","error.billing.aws-http":"请求失败（HTTP {status}），可能缺少 ce:GetCostAndUsage 权限","host.actualMonthlyBillFromAWS":"AWS Cost Explorer 本月真实账单（账单延迟约 24 小时）","error.billing.cloudflare-not-configured":"未配置 CLOUDFLARE_API_KEY（需账号级 Token 并授予 Billing 读权限）","error.billing.cloudflare-account":"未配置 CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"请求失败（HTTP {status}），Token 需 Billing 读权限","host.actualMonthlyUsageFromThe":"Cloudflare Billable Usage API（Alpha），本月真实用量","error.billing.huggingface-not-configured":"未配置 HF_TOKEN（细粒度 token 需授予 Billing 读权限）","host.actualMonthlyBillFromHF":"本月真实账单（Hugging Face Billing API）","error.billing.request-failed":"账单请求未知异常","host.spendSummaryFileMissingArchived":"账单汇总文件缺失：折叠期间的历史金额暂未计入显示（明细仍在冷归档 usage-archive/，可人工恢复）","host.spendLedgerCouldNotBe":"账单文件写入未完成","host.usageLedgerBusy":"当前仍有回答正在进行，完成后再清除账单记录","error.ledger.clear-failed":"账单记录清理未完成：{value}","error.ledger.snapshot-stale":"折叠汇总落盘失败：{value}","host.basedOnYourLastSessions":"基于你最近 {count} 次会话","host.estimatedFromSpendingOverThe":"基于过去 {SPEND_DAYS} 天消耗速度的估算","host.patchMustIncludeFieldsOr":"patch 需包含 fields、colors、timeZones 或 customText 之一","host.timeZonesMustBeAnObject":"timeZones 必须是对象","host.timeZoneMustBeAValid":"时区必须是有效的 IANA 时区：{key}","host.customTextMustBeAString":"自定义文本必须是字符串","host.customTextTooLong":"自定义文本不能超过 64 个字符","host.quotaDisplayModeInvalid":"订阅窗口百分比方向必须是 used 或 remaining","host.infoDensityMustBeFullOrCompact":"信息显示方式必须是完整或简洁","host.fieldsMustBeAnObject":"fields 必须是对象","host.unknownFieldId":"未知字段 id: {key}","host.fieldVisibilityMustBeA":"字段开关必须是布尔值: {key}","host.colorsMustBeAnObject":"colors 必须是对象","host.colorMustBeAPreset":"颜色只接受预设色名或 #RRGGBB: {key}","field.anchorGroup.label":"服务商与模型","field.anchorGroup.note":"显示当前会话使用的服务商和模型。","field.subServiceGroup.label":"订阅服务与模型","field.subServiceGroup.note":"显示订阅服务和当前模型或套餐。","field.billingServiceGroup.label":"账单服务与模型","field.billingServiceGroup.note":"显示账单服务和当前模型。","field.customText.label":"自定义文字","field.customText.note":"显示一段自定义文字，可用作备注或签名。","field.mainTime.label":"主时间","field.mainTime.note":"显示主时区的时间；时区在「时间与日期」中调整。","field.worldTime.label":"世界时间","field.worldTime.note":"显示另一时区的时间。","field.sessionCost.label":"本次会话花费","field.sessionCost.note":"显示本次会话的实际花费，包含子代理。","field.balance.note":"显示账户余额；余额过低时标红提醒。","field.period.label":"当前时段","field.period.note":"峰谷定价的服务商显示当前是高峰还是空闲时段。","field.countdown.label":"下次价格切换","field.countdown.note":"显示距离下次高峰 / 空闲价格切换的时间。","field.expiry.label":"订阅到期日","field.expiry.note":"服务商返回到期时间时显示。","field.subWindow5h.label":"5 小时额度","field.subWindow5h.note":"显示滚动 5 小时额度的剩余比例。","field.subWindowWeek.label":"每周额度","field.subWindowWeek.note":"显示每周额度的剩余比例。","field.subWindowMonth.label":"每月额度","field.subWindowMonth.note":"显示每月额度的剩余比例。","field.resetCountdown.label":"距额度重置","field.resetCountdown.note":"显示当前额度重置的剩余时间。","field.subBalance.label":"可用余额或剩余额度","field.subBalance.note":"按量账户显示可用余额；没有额度窗口的 credits 订阅显示剩余额度。","field.billingSpend.label":"本月用量","field.billingSpend.note":"显示本计费周期的实际用量或花费。","field.budget.label":"预算使用情况","field.budget.note":"服务商支持时显示已使用的预算比例。","field.freeQuota.label":"免费额度","field.freeQuota.note":"服务商提供免费额度时显示剩余额度和重置时间。","field.turnsSteps.label":"轮次与步数","field.turnsSteps.note":"显示本会话对话的轮次和步数。","field.llmTime.label":"模型耗时","field.llmTime.note":"显示模型推理累计耗时。","field.toolTime.label":"工具耗时","field.toolTime.note":"显示工具调用累计耗时。","field.avgTTFT.label":"首 Token 平均耗时","field.avgTTFT.note":"显示本会话模型步骤的平均首 Token 时间。","field.outputSpeed.label":"输出速率","field.outputSpeed.note":"显示本会话已上报用量的模型步骤的平均输出速率（tok/s）。","field.cacheHit.note":"显示提示词缓存命中率。","field.tokensIO.label":"输入/输出 Token","field.tokensIO.note":"显示本会话累计的输入 / 输出 Token 量。","field.contextUsage.label":"上下文用量","field.contextUsage.note":"显示上下文占用比例；圆环越满表示剩余可写空间越少。","ui.contextAria":"上下文已用 {percent}","ui.contextUsed":"上下文已用","ui.contextSystem":"系统提示词","ui.contextTools":"工具定义","ui.contextMessages":"对话消息","ui.contextFigures":"~{used} / {window}","number.thousand":"{value}K","number.million":"{value}M","field.unmapped.label":"账户数据状态提示","field.unmapped.note":"服务商未知或未公开账户余额/配额接口时显示；本地用量记账仍正常工作。","field.noKeyHint.label":"缺少密钥提示","field.noKeyHint.note":"缺少 API Key 时显示去填写的提示。","field.balanceError.label":"余额更新失败提示","field.balanceError.note":"余额更新失败时显示。","field.usageError.label":"用量更新失败提示","field.usageError.note":"花费暂时不可用时显示。","field.refreshFailure.label":"更新失败提示","field.refreshFailure.note":"任一数据刷新失败时显示提醒。","field.persistWarning.label":"记录未保存提醒","field.persistWarning.note":"账单保存失败时显示提醒，建议保留。","field.updateNotice.label":"更新提醒","field.updateNotice.note":"有新版本可更新、或新版已就绪待重启时显示短标记。","field.updateFailure.label":"更新失败提醒","field.updateFailure.note":"自动更新失败时显示短标记。","group.native":"原生信息","group.plugin":"插件信息","group.notice":"提醒信息","group.native.desc":"DSH 原生底栏自带的字段，列在原生统计行；这一行只在完整模式显示。","group.plugin.desc":"本插件新增的字段（含接管过来的上下文圆环），归在主行里；简洁与完整都显示。","group.notice.desc":"更新、失败等一次性提醒。当下真有事要提醒就出现，与模式无关。","section.identity.label":"服务商与模型","section.identity.desc":"任何计费方式都显示的一行：当前用的是哪家的服务、哪个模型。","section.balance.label":"余额制：充值后按用量扣钱","section.balance.desc":"这类服务商只有下面几项有数据：余额、本次会话花费、当前时段与下次价格切换。","section.subscription.label":"订阅制：按月付费，额度内不限量","section.subscription.desc":"ChatGPT 这类订阅只有下面几项有数据：额度窗口、额度重置、到期日与可用余额。","section.billing.label":"账单制：先用后付，按月出账","section.billing.desc":"这类服务商只有下面几项有数据：本月用量、预算使用情况、免费额度。","section.common.label":"通用显示项","section.common.desc":"和计费方式无关，用什么服务商都能开：自定义文字、时间、上下文用量。","ui.listSeparator":"、","ui.sentenceEnd":"。","ui.fieldErrorPrefix":"「{label}」：","ui.turnCount":"{count} 轮","ui.turnCountPlural":"{count} 轮","ui.stepCount":"{count} 步","ui.stepCountPlural":"{count} 步","ui.mainTimeZone":"主时间时区","ui.worldTimeZone":"世界时间时区","ui.customTextTitle":"自定义文本","ui.customTextPlaceholder":"输入文字（最多 64 个字符）","ui.searchPlaceholder":"按名称或说明搜索…","ui.searchFieldsLabel":"搜索显示内容","ui.searchResultCount":"找到 {count} 项","ui.enabledFieldsCount":"已启用 {count} 项","ui.noSearchResults":"没有找到匹配的设置项","ui.mainTime":"主时间","ui.worldTime":"世界时间","ui.customText":"自定义文本","language.title":"语言","language.description":"跟随 DSH，或在此浏览器中单独选择本插件的语言。","language.auto":"跟随 DSH","language.saveFailed":"语言选择未能保存，请允许本地存储后重试。"},"zh-hant":{"color.blue":"藍","color.green":"綠","color.neutral":"中性","color.orange":"橙","color.purple":"紫","color.red":"紅","error.balance.account-request-failed":"內置帳號餘額獲取失敗","error.balance.account-signed-out":"內置帳號未登入","error.balance.account-unavailable":"當前宿主沒有內置帳號服務","error.balance.credentials":"憑證讀取失敗","error.balance.not-configured":"未配置 {credential}","error.billing.aws-http":"請求失敗（HTTP {status}），可能缺少 ce:GetCostAndUsage 權限","error.billing.aws-not-configured":"未配置 AWS 憑證（AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY）","error.billing.cloudflare-account":"未配置 CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"請求失敗（HTTP {status}），Token 需 Billing 讀權限","error.billing.cloudflare-not-configured":"未配置 CLOUDFLARE_API_KEY（需帳號級 Token 並授予 Billing 讀權限）","error.billing.fireworks-account":"帳戶解析失敗（未取得 account_id）","error.billing.fireworks-not-configured":"未配置 FIREWORKS_API_KEY","error.billing.huggingface-not-configured":"未配置 HF_TOKEN（細粒度 token 需授予 Billing 讀權限）","error.billing.request-failed":"帳單請求未知異常","error.billing.together-not-configured":"未配置 TOGETHER_API_KEY","error.ledger.clear-failed":"帳單記錄清理未完成：{value}","error.ledger.snapshot-stale":"折疊匯總寫入磁碟失敗：{value}","error.request.failed":"請求失敗（{value} {msg}）","error.request.http":"請求失敗（HTTP {status}）","error.request.parse":"回應格式異常","error.settings.save-failed":"settings.json 寫入磁碟失敗：{value}","error.subscription.commandcode-auth-failed":"Command Code 登入憑證已失效。請重新登入或更新 API Key","error.subscription.commandcode-not-configured":"尚未設定 Command Code。請設定 COMMAND_CODE_API_KEY、CMD_API_KEY，或使用 Command Code CLI 登入。","error.subscription.commandcode-unrecognized":"Command Code 回傳了無法識別的額度格式（介面可能已變更），已保留上次資料","error.subscription.credentials-missing":"ChatGPT 訂閱登入憑證缺少 id_token，請安裝 dsh-chatgpt-sub 外掛重新綁定","error.subscription.minimax-auth-failed":"MiniMax 拒絕了當前 API Key：查詢 Token Plan 必須使用 Subscription Key（在 Token Plan 訂閱頁生成），按用量 API Key 會被服務端拒絕（status_code=1004 / HTTP 401）","error.subscription.minimax-not-configured":"未配置 MiniMax 憑證（MINIMAX_API_KEY 或 MINIMAX_CN_API_KEY）。查詢 Token Plan 必須使用 Subscription Key，按用量 API Key 會被服務端拒絕","error.subscription.minimax-unrecognized":"MiniMax 回傳了無法識別的額度格式（介面可能已變更），已保留上次資料","error.subscription.not-connected":"未找到 ChatGPT 訂閱登入憑證（~/.codex/auth.json），請安裝 dsh-chatgpt-sub 外掛綁定","error.subscription.opencode-not-configured":"未配置 OpenCode Go（OPENCODE_GO_API_KEY 或 opencode auth.json）","error.subscription.request-failed":"訂閱額度請求未知異常","error.subscription.xiaomi-http":"請求失敗（HTTP {value}）","error.subscription.xiaomi-not-configured":"未配置小米 MiMo Token Plan 憑證（{credName} 或 XIAOMI_API_KEY）","error.subscription.zhipu-auth-failed":"智譜 API 認證失敗（金鑰過期或不正確）","error.subscription.zhipu-not-configured":"未配置智譜 API Key（ZAI_API_KEY 或 ZAI_CODING_CN_API_KEY）","error.subscription.zhipu-unrecognized":"智譜回傳了無法識別的額度格式（介面可能已變更），已保留上次資料","field.anchorGroup.label":"服務供應商與模型","field.anchorGroup.note":"顯示當前會話使用的服務供應商和模型。","field.avgTTFT.label":"首 Token 平均耗時","field.avgTTFT.note":"顯示本會話模型步驟的平均首 Token 時間。","field.balance.note":"顯示帳戶餘額；餘額過低時標紅提醒。","field.balanceError.label":"餘額更新失敗提示","field.balanceError.note":"餘額更新失敗時顯示。","field.billingServiceGroup.label":"帳單服務與模型","field.billingServiceGroup.note":"顯示帳單服務和當前模型。","field.billingSpend.label":"本月用量","field.billingSpend.note":"顯示本計費週期的實際用量或花費。","field.budget.label":"預算使用情況","field.budget.note":"服務供應商支援時顯示已使用的預算比例。","field.cacheHit.note":"顯示提示詞快取命中率。","field.contextUsage.label":"上下文用量","field.contextUsage.note":"顯示上下文佔用比例；圓環越滿表示剩餘可寫空間越少。","field.countdown.label":"下次價格切換","field.countdown.note":"顯示距離下次高峰 / 空閒價格切換的時間。","field.customText.label":"自訂文字","field.customText.note":"顯示一段自訂文字，可用作備注或簽名。","field.expiry.label":"訂閱到期日","field.expiry.note":"服務供應商回傳到期時間時顯示。","field.freeQuota.label":"免費額度","field.freeQuota.note":"服務供應商提供免費額度時顯示剩餘額度和重置時間。","field.llmTime.label":"模型耗時","field.llmTime.note":"顯示模型推理累計耗時。","field.mainTime.label":"主時間","field.mainTime.note":"顯示主時區的時間；時區在「時間與日期」中調整。","field.noKeyHint.label":"缺少金鑰提示","field.noKeyHint.note":"缺少 API Key 時顯示去填寫的提示。","field.outputSpeed.label":"輸出速率","field.outputSpeed.note":"顯示本會話已上報用量的模型步驟的平均輸出速率（tok/s）。","field.period.label":"當前時段","field.period.note":"峰谷定價的服務供應商顯示當前是高峰還是空閒時段。","field.persistWarning.label":"記錄未儲存提醒","field.persistWarning.note":"帳單儲存失敗時顯示提醒，建議保留。","field.refreshFailure.label":"更新失敗提示","field.refreshFailure.note":"任一資料重新整理失敗時顯示提醒。","field.resetCountdown.label":"距額度重置","field.resetCountdown.note":"顯示當前額度重置的剩餘時間。","field.sessionCost.label":"本次會話花費","field.sessionCost.note":"顯示本次會話的實際花費，包含子代理。","field.subBalance.label":"可用餘額或剩餘額度","field.subBalance.note":"按用量帳戶顯示可用餘額；沒有額度窗口的 credits 訂閱顯示剩餘額度。","field.subServiceGroup.label":"訂閱服務與模型","field.subServiceGroup.note":"顯示訂閱服務和當前模型或方案。","field.subWindow5h.label":"5 小時額度","field.subWindow5h.note":"顯示滾動 5 小時額度的剩餘比例。","field.subWindowMonth.label":"每月額度","field.subWindowMonth.note":"顯示每月額度的剩餘比例。","field.subWindowWeek.label":"每周額度","field.subWindowWeek.note":"顯示每周額度的剩餘比例。","field.tokensIO.label":"輸入/輸出 Token","field.tokensIO.note":"顯示本會話累計的輸入 / 輸出 Token 量。","field.toolTime.label":"工具耗時","field.toolTime.note":"顯示工具調用累計耗時。","field.turnsSteps.label":"輪次與步數","field.turnsSteps.note":"顯示本會話對話的輪次和步數。","field.unmapped.label":"帳戶資料狀態提示","field.unmapped.note":"服務供應商未知或未公開帳戶餘額/配額介面時顯示；本機用量記賬仍正常工作。","field.updateFailure.label":"更新失敗提醒","field.updateFailure.note":"自動更新失敗時顯示短標記。","field.updateNotice.label":"更新提醒","field.updateNotice.note":"有新版本可更新、或新版已就緒待重啓時顯示短標記。","field.usageError.label":"用量更新失敗提示","field.usageError.note":"花費暫時不可用時顯示。","field.worldTime.label":"世界時間","field.worldTime.note":"顯示另一時區的時間。","group.native":"原生資訊","group.native.desc":"DSH 原生底欄自帶的欄位，列在原生統計行；這一行只在完整模式顯示。","group.notice":"提醒資訊","group.notice.desc":"更新、失敗等一次性提醒。當下真有事要提醒就出現，與模式無關。","group.plugin":"外掛資訊","group.plugin.desc":"本外掛新增的欄位（含接管過來的上下文圓環），歸在主行裡；簡潔與完整都顯示。","host.actualBillForThisPeriod":"本週期真實帳單（Fireworks Billing Summary）","host.actualMonthlyBillFromAWS":"AWS Cost Explorer 本月真實帳單（帳單延遲約 24 小時）","host.actualMonthlyBillFromHF":"本月真實帳單（Hugging Face Billing API）","host.actualMonthlyBillFromThe":"本月真實帳單（Together 官方 Usage API）","host.actualMonthlyUsageFromThe":"Cloudflare Billable Usage API（Alpha），本月真實用量","host.actualUsageForThisPeriod":"本週期真實用量（billingUsage 回退端點，無金額）","host.basedOnYourLastSessions":"基於你最近 {count} 次會話","host.colorMustBeAPreset":"顏色只接受預設色名或 #RRGGBB: {key}","host.colorsMustBeAnObject":"colors 必須是物件","host.customTextMustBeAString":"自訂文本必須是字串","host.customTextTooLong":"自訂文本不能超過 64 個字符","host.estimatedFromSpendingOverThe":"基於過去 {SPEND_DAYS} 天消耗速度的估算","host.fieldsMustBeAnObject":"fields 必須是物件","host.fieldVisibilityMustBeA":"欄位開關必須是布林值: {key}","host.hour":"5 小時","host.infoDensityMustBeFullOrCompact":"資訊顯示方式必須是完整或簡潔","host.patchMustIncludeFieldsOr":"patch 需包含 fields、colors、timeZones 或 customText 之一","host.quotaDisplayModeInvalid":"訂閱窗口百分比方向必須是 used 或 remaining","host.settingsFileCouldNotBe":"設定檔案寫入未完成","host.spendLedgerCouldNotBe":"帳單檔案寫入未完成","host.spendSummaryFileMissingArchived":"帳單匯總檔案缺失：折疊期間的歷史金額暫未計入顯示（明細仍在冷歸檔 usage-archive/，可人工恢復）","host.timeZoneMustBeAValid":"時區必須是有效的 IANA 時區：{key}","host.timeZonesMustBeAnObject":"timeZones 必須是物件","host.unknownFieldId":"未知欄位 id: {key}","host.unknownProvider":"未知服務供應商","host.usageLedgerBusy":"當前仍有回答正在進行，完成後再清除帳單記錄","host.zhipu":"智譜 {mapped}","host.zhipu.parseZaiQuota":"智譜 {value}{value2}","language.auto":"跟隨 DSH","language.description":"跟隨 DSH，或在此瀏覽器中單獨選擇本外掛的語言。","language.saveFailed":"語言選擇未能儲存，請允許本機儲存後重試。","language.title":"語言","meta.description":"在輸入框下方顯示當前模型、餘額和花費。","meta.title":"底部資訊欄","number.million":"{value}M","number.thousand":"{value}K","section.balance.desc":"這類服務供應商只有下面幾項有資料：餘額、本次會話花費、當前時段與下次價格切換。","section.balance.label":"餘額制：充值後按用量扣錢","section.billing.desc":"這類服務供應商只有下面幾項有資料：本月用量、預算使用情況、免費額度。","section.billing.label":"帳單制：先用後付，按月出賬","section.common.desc":"和計費方式無關，用什麼服務供應商都能開：自訂文字、時間、上下文用量。","section.common.label":"通用顯示項","section.identity.desc":"任何計費方式都顯示的一行：當前用的是哪家的服務、哪個模型。","section.identity.label":"服務供應商與模型","section.subscription.desc":"ChatGPT 這類訂閱只有下面幾項有資料：額度窗口、額度重置、到期日與可用餘額。","section.subscription.label":"訂閱制：按月付費，包含額度","ui.accountDataUnavailable":"無公開帳戶資料","ui.accountDataUnavailableDetail":"該服務供應商已支援模型識別與本機用量記賬，但沒有可由外掛安全讀取的公開餘額或配額介面。","ui.accountSignedOut":"帳號未登入","ui.accountSignedOutHow":"在 DSH 的「設定 → 帳戶」裡登入 DeepSeek 帳號，這裡就會顯示餘額。","ui.allTime":"全部 {symbol}{value}","ui.autoUpdateTitle":"更新方式","ui.availableBalance":"可用餘額：{balTxt}","ui.availableBalanceLabel":"可用餘額","ui.availableCredits":"剩餘 credits：{value}","ui.avgTTFT":"首 token 平均","ui.balance":"餘額：{symbol}{value}","ui.balance.pushBalanceGroups":"餘額","ui.balanceDetailGranted":"贈金餘額：{symbol}{value}","ui.balanceDetailToppedUp":"充值餘額：{symbol}{value}","ui.balanceIsTemporarilyUnavailableShowing":"餘額暫不可用；正在顯示上次資料並自動重試。","ui.balanceLookupIsNotYet":"暫時無法讀取該服務供應商的餘額。","ui.balanceUnavailable":"餘額獲取失敗","ui.beijingTime":"北京時間 ","ui.beijingTimeSwitchesTo":"北京時間 {atLabel} 切換為","ui.billing":"帳單","ui.billingIsTemporarilyUnavailableCheck":"{serviceName} 帳單暫不可用。請檢查網路與權限後再試。","ui.billingServiceModel":"帳單服務：{serviceName}\n模型：{modelLabel}{versionLine}","ui.billingSource":"帳單源：{value}","ui.budget":"預算","ui.budgetUsed":"預算使用：{value}%","ui.cacheHit":"快取命中","ui.cacheHitScope":"按 token 計：命中 {hit} / 未命中 {miss}（{percent}% 命中）。\n口徑：當前會話主 Agent 的模型調用，不含子代理。","ui.changesAppliedButCouldNot":"已應用，但無法儲存到本機：","ui.clearBillingRecords":"清除帳單","ui.clearBillingRecordsConfirm":"確定清除本外掛儲存的全部帳單記錄嗎？建議先匯出。清除後無法恢復，但不會影響設定或登入資訊。","ui.clearBillingRecordsDesc":"清除後無法恢復。","ui.clearCanceled":"已取消","ui.clearedBillingRecords":"已清除 {count} 條帳單記錄","ui.clearFailed":"清除失敗：{value}","ui.clearFailedWithoutDetails":"帳單記錄未能全部清除","ui.clickToHide":"點選隱藏","ui.clickToShow":"點選顯示","ui.clickToSwitchFullCompact":"單擊切換 完整/簡潔","ui.cloudBilling":"雲帳單","ui.collapse":"收起","ui.color":"“{value}”顏色：","ui.colorSwatchLabel":"{label}的顏色","ui.commandCode":"Command Code","ui.configureItInSettingsModels":"。請在\"設定 → 模型\"中填寫。","ui.contextAria":"上下文已用 {percent}","ui.contextFigures":"~{used} / {window}","ui.contextMessages":"對話消息","ui.contextSystem":"系統提示詞","ui.contextTools":"工具定義","ui.contextUsed":"上下文已用","ui.couldNotDisplayInfoBar":"無法顯示資訊欄設定：{value}","ui.couldNotLoadBalanceCheck":"餘額獲取失敗。請檢查網路和 API Key。","ui.couldNotLoadInfoBar":"無法讀取資訊欄設定：","ui.couldNotParseResponse":"回應解析失敗","ui.couldNotReset":"重置失敗：{value}","ui.couldNotSave":"{errorPrefix}儲存失敗：{value}","ui.credentialsHaveExpiredPleaseReauthorize":"{serviceName} 登入憑證已失效。請重新授權。","ui.customColor":"{label}的自訂顏色","ui.customColorItem":"自訂…","ui.customColorOpenColorPicker":"自訂顏色（打開系統取色器）","ui.customText":"自訂文本","ui.customTextCount":"已輸入 {value}/64 個字符","ui.customTextPlaceholder":"輸入文字（最多 64 個字符）","ui.customTextSectionDesc":"在資訊欄中顯示一行自訂文字。","ui.customTextTitle":"自訂文本","ui.dailyFreeQuotaRemaining":"每日免費額度剩餘：{value}","ui.dataAndBilling":"帳單資料","ui.dataAndBillingDesc":"匯出或清除本外掛儲存的用量與花費記錄。","ui.defaultColorsRestored":"已恢復預設顏色","ui.defaultLabelsRestored":"已恢復預設顯示設定","ui.deniedAccessReauthorizeOrTry":"{serviceName} 拒絕訪問。請重新授權或稍後再試。","ui.deniedAccessTheTokenMay":"{serviceName} 拒絕訪問：Token 可能缺少帳單讀取權限。","ui.enabledFieldsCount":"已啓用 {count} 項","ui.estimated":"（估算）","ui.estimatedBalance":"估算餘額：{symbol}{value}","ui.expand":"展開","ui.expires":"到期","ui.expiresLocalTime":"\n到期：{value}（本機時區）","ui.exportBillingCsv":"匯出 CSV","ui.exportBillingJson":"匯出 JSON","ui.exportBillingRecords":"匯出帳單","ui.exportBillingRecordsDesc":"將記錄匯出為 CSV 或 JSON 檔案。","ui.exportedBillingRecords":"已匯出 {count} 條帳單記錄（{format}）","ui.exportFailed":"匯出失敗：{value}","ui.exportIncomplete":"歷史帳單讀取不完整：{value}。本次未匯出，請稍後再試。","ui.exportNotSupported":"當前環境不支援下載檔案。","ui.fieldErrorPrefix":"「{label}」：","ui.free":"免費","ui.hasAnInvalidColorEnter":"“{value}”的顏色格式不正確，請輸入 #RRGGBB（例如 #0044CC）。","ui.hexColor":"{label}的十六進制顏色","ui.infoBarSettings":"資訊欄","ui.input":"：輸入 ¥","ui.input.BottomInfoBar":"輸入","ui.isTemporarilyUnavailableCheckYour":"{serviceName} 暫不可用。請檢查網路後再試。","ui.lastDays":"最近 30 天 {symbol}{value}","ui.ledgerUpdatePending":"帳單待整理","ui.listSeparator":"、","ui.loadingInfoBarSettings":"正在載入設定…","ui.low":"低","ui.mainTime":"主時間","ui.mainTimeZone":"主時間時區","ui.mCachedInput":"/M · 快取 ¥","ui.minimax":"MiniMax","ui.mode":"模式","ui.modelCapabilityPending":"正在確認是否支援圖像輸入","ui.modelSelectionPending":"正在讀取當前模型","ui.monthly":"月","ui.mOutput":"/M · 輸出 ¥","ui.noBillingRecordsToExport":"目前沒有可匯出的帳單記錄。","ui.noSearchResults":"沒有找到匹配的設定項","ui.noSignInCredentialsFound":"未找到 {serviceName} 登入憑證。請重新授權。","ui.notConfigured":"未配置 ","ui.notConfiguredConfigureItIn":"未配置 {credName}。請在\"設定 → 模型\"中填寫。","ui.notConfiguredSettingsModels":"未配置 {credName}。請在設定 → 模型中填寫。","ui.notSupported":"未適配","ui.offPeak":"空閒","ui.offPeakPrice":"空閒價","ui.output":"輸出","ui.peak":"高峰","ui.peakPrice":"尖峰價","ui.plan":"\n方案：{plan}","ui.pleaseTryAgainLater":"請稍後再試","ui.pluginVersion":"\n外掛版本：{current}","ui.prepaidBalance":"可用餘額","ui.presetColor":"{label}的預設顏色","ui.pressEnterOrSpaceFor":"按 Enter 或空格切換為簡潔模式。","ui.pressEnterOrSpaceFor.BottomInfoBar":"按 Enter 或空格切換為完整模式。","ui.pricing":"定價","ui.pricingFixed":"定價：固定價","ui.pricingNotListedUsingDefaults":"定價：暫未收錄，不計算花費","ui.pricingPeakOffPeakBeijing":"定價：尖峰／離峰（北京時間；平日尖峰 09:00–12:00 與 14:00–18:00；週末及中國法定假日為離峰）","ui.processing":"正在處理…","ui.provider":"服務供應商：{provLabel} {modelLabel}\n","ui.quotaDisplayModeDesc":"訂閱額度窗口按「剩餘」或「已用」顯示；低額度告警始終按剩餘不足 20% 判定。","ui.quotaDisplayModeTitle":"訂閱窗口百分比方向","ui.quotaDisplayRemaining":"剩餘","ui.quotaDisplayUsed":"已用","ui.rateLimitReachedPleaseTry":"{serviceName} 請求過於頻繁。請稍後再試。","ui.refreshFailed":"重新整理失敗","ui.remainingCredits":"剩餘額度","ui.requestCanceled":"請求已取消","ui.requestTimedOut":"請求逾時","ui.resetColors":"恢復顏色","ui.resetConfirmAcknowledge":"我瞭解這次重置不可撤銷","ui.resetConfirmCancel":"取消","ui.resetConfirmConfirm":"確認重置","ui.resetConfirmDescColors":"將清除全部自訂顏色並恢復預設配色，欄位顯示開關不受影響。該操作會直接應用到資訊欄。","ui.resetConfirmDescFields":"將所有顯示項恢復為預設；自訂顏色不受影響，改動會直接生效。","ui.resetConfirmTitle":"重置資訊欄設定","ui.resetLabels":"恢復顯示","ui.resetRowDesc":"將顯示項或顏色恢復為預設。","ui.resetRowTitle":"恢復預設","ui.resetsIn":"距重置","ui.resetsIn.pushBillingGroups":"{value} · 距重置 {value2}","ui.resetsResetsIn":" · 重置 {value} · 距重置 {value2}","ui.restoreDefaultColor":"恢復預設顏色","ui.returnedAnUnrecognizedResponsePlease":"{serviceName} 回傳的資料暫時無法識別。請稍後再試。","ui.rpcFailed":"RPC 失敗","ui.saving":"正在儲存…","ui.savingView":"正在儲存切換…","ui.searchFieldsLabel":"搜尋顯示內容","ui.searchPlaceholder":"按名稱或說明搜尋…","ui.searchResultCount":"找到 {count} 項","ui.sentenceEnd":"。","ui.session":"本會話","ui.sessionIncludingSubagents":"本會話 {costTxt}（含子代理）{value}","ui.settingsAreTemporarilyUnavailable":"暫時無法讀取設定","ui.show":"顯示{label}","ui.spend":"花費","ui.spendIsTemporarilyUnavailableChat":"花費暫不可用；不會影響對話。","ui.spendJournalSavedButThe":"帳單流水已儲存，但可直接查看的帳單檔案暫未更新：","ui.spendNotSaved":"帳單未儲存","ui.spendPartlyUnpriced":"其中部分調用尚未收錄價格（絕不套用其他模型價格估算），實際花費高於此處顯示值。","ui.spendUnavailable":"花費獲取失敗","ui.stepCount":"{count} 步","ui.stepCountPlural":"{count} 步","ui.subscription":"訂閱","ui.subscriptionExpiresLocalTime":"訂閱到期：{value}（本機時區）","ui.subscriptionQuota":"訂閱額度","ui.subscriptionServiceModel":"訂閱服務：{serviceName}\n模型：{rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.subscriptionSource":"訂閱源：{value}（","ui.subscriptionSource.titleLines":"訂閱源：{value}","ui.supportsImageInput":"支援圖像輸入。","ui.temporarilyUnavailableKeepingTheLast":"暫不可用；正在保留上次資料並自動重試。","ui.thisMonth":"本月","ui.thisMonthSSpend":"本月花費：{symbol}{value}","ui.thisMonthSUsage":"本月用量","ui.thisSpendRecordWasNot":"本次帳單未儲存，不會計入金額：","ui.timeDateDesc":"主時間和世界時間的時區。","ui.timeDateTitle":"時間與日期","ui.timeDaysAgo":"{n} 天前","ui.timedOutCheckYourConnection":"{serviceName} 回應逾時。請檢查網路後再試。","ui.timeHoursAgo":"{n} 小時前","ui.timeJustNow":"剛剛","ui.timeMinutesAgo":"{n} 分鐘前","ui.today":"今天 {symbol}{value}","ui.tokenScope":"輸入 / 輸出是本會話主 Agent 的模型調用累計，不含子代理；右側『本會話』花費含子代理。","ui.tools":"工具調用","ui.turnCount":"{count} 輪","ui.turnCountPlural":"{count} 輪","ui.unknown":"未知","ui.unknownModel":"未知模型","ui.unknownReason":"未知原因","ui.until":"距","ui.updateAllowHeld":"允許更新到 {version}","ui.updateAvailableNow":"發現新版本 {version}，現在可以更新。","ui.updateChecking":"檢查中…","ui.updateCheckNow":"檢查更新","ui.updateConfirm":"發現新版本 {version}。現在更新外掛嗎？更新後需重啓 DSH 才會生效。","ui.updateDisabled":"當前環境不支援自動更新","ui.updateDisabledWhy":"自動更新只在外掛裝進 DSH 外掛目錄後可用。這一份是從源碼或連結裝進來的，升級請用原來的命令。","ui.updateErrorCheckFailed":"檢查更新沒成功，可能是網路問題。","ui.updateErrorDownloadFailed":"連不上更新服務器，稍後再試。","ui.updateErrorIncompleteDownload":"更新包沒下完整（網路中途斷了），這次已放棄，你現在用的版本沒受影響。","ui.updateErrorIntegrityMismatch":"更新包沒通過安全校驗，這次已放棄，你現在用的版本沒受影響。","ui.updateErrorPayloadMismatch":"更新包的內容和版本號對不上，已放棄。","ui.updateErrorPayloadUnsafe":"更新包裡出現了不該有的檔案路徑，已放棄。","ui.updateErrorTooLarge":"更新包大得反常，出於安全已放棄。","ui.updateErrorUnknown":"更新沒成功，詳細原因記在更新日誌裡。","ui.updateFailed":"上次更新沒成功","ui.updateFailedBadge":"更新失敗","ui.updateFallbackWhy":"萬一新版有問題，可以退回上一版。","ui.updateHeld":"新版 {version} 已被你暫緩，不會自動裝回來。","ui.updateHoldWhy":"這個版本被你暫緩過，不會自己裝回來。","ui.updateHostOutdated":"這次動作沒有執行：當前運行的 DSH 還帶著舊版本的更新邏輯，重啓 DSH 之後按鈕就好用了。","ui.updateInstalling":"正在更新到 {version}…","ui.updateInstallNow":"更新到 {version}","ui.updateModeAuto":"自動更新","ui.updateModeAutoDesc":"啓動 DSH 時自動檢查並安裝。使用中手動檢查到新版後，確認才會更新。","ui.updateModeManual":"手動更新","ui.updateModeManualDesc":"啓動時不自動安裝。使用中手動檢查到新版後，確認才會更新。","ui.updatePendingRestart":"已更新到 {version}，重啓 DSH 後生效。","ui.updateRestartBadge":"重啓生效","ui.updateRollback":"回滾到上一版","ui.updateRollbackFailed":"回滾沒成功，本機沒有可用的備份。你可以到外掛頁解除安裝後重裝。","ui.updateRolledBack":"已回滾到上一版 {version}。","ui.updateUpToDate":"已是最新版本。","ui.versionAndUpdateDesc":"更新只替換外掛自己的程序檔案，帳單記錄和設定不受影響。","ui.versionAndUpdateTitle":"版本與更新","ui.versionLastCheck":"上次檢查：{time}","ui.versionLatest":"最新版本 {version}","ui.versionRunning":"運行中版本 {version}","ui.versionUnavailable":"當前運行的 DSH 還沒載入這一版外掛的更新功能，所以這裡暫時只顯示這一行。重啓 DSH 後，下面就會出現當前版本、更新方式與「檢查更新」。","ui.versionUnknown":"未知","ui.visibleFields":"要顯示的資訊","ui.vision":"視覺","ui.weekly":"周","ui.window":"窗口","ui.windowRemainingUsed":"{label}窗口：剩餘 {value}%（已用 {usedPercent}%）","ui.windowRemainingUsedResets":"{label}窗口 剩餘 {value}%（已用 {usedPercent}%） · 重置 {value4}","ui.windowUsedRemaining":"{label}窗口：已用 {usedPercent}%（剩餘 {value}%）","ui.windowUsedRemainingResets":"{label}窗口 已用 {usedPercent}%（剩餘 {value}%） · 重置 {value4}","ui.worldTime":"世界時間","ui.worldTimeZone":"世界時間時區","ui.xiaomiMiMo":"小米 MiMo","ui.zhipu":"智譜"},"en":{"meta.title":"Bottom Info Bar","meta.description":"Shows the current model, balance and spend under the composer.","ui.requestTimedOut":"Request timed out","ui.requestCanceled":"Request canceled","ui.couldNotParseResponse":"Could not parse response","ui.rpcFailed":"RPC failed","ui.refreshFailed":"Refresh failed","color.red":"Red","color.green":"Green","color.blue":"Blue","color.purple":"Purple","color.orange":"Orange","color.neutral":"Neutral","ui.pleaseTryAgainLater":"Please try again later","ui.restoreDefaultColor":"Restore default color","ui.infoBarSettings":"Info Bar","ui.settingsAreTemporarilyUnavailable":"Settings are temporarily unavailable","ui.loadingInfoBarSettings":"Loading settings…","ui.couldNotLoadInfoBar":"Could not load Info Bar settings: ","ui.changesAppliedButCouldNot":"Applied, but could not save locally: ","ui.unknownReason":"Unknown reason","ui.couldNotSave":"{errorPrefix}Could not save: {value}","ui.color":"\"{value}\" color: ","ui.hasAnInvalidColorEnter":"\"{value}\" has an invalid color. Enter #RRGGBB (for example, #0044CC).","ui.defaultColorsRestored":"Default colors restored","ui.defaultLabelsRestored":"Default display restored","ui.couldNotReset":"Could not reset: {value}","ui.show":"Show {label}","ui.clickToHide":"Click to hide","ui.clickToShow":"Click to show","ui.presetColor":"{label} preset color","ui.customColor":"{label} custom color","ui.customColorOpenColorPicker":"Custom color (open color picker)","ui.customColorItem":"Custom…","ui.colorSwatchLabel":"{label} color","ui.hexColor":"{label} hex color","ui.expand":"Expand","ui.collapse":"Collapse","ui.saving":"Saving…","ui.processing":"Working…","ui.visibleFields":"Information to show","ui.timeDateTitle":"Time and date","ui.timeDateDesc":"Time zones for main and world time.","ui.customTextSectionDesc":"Shows one line of custom text in the info bar.","ui.resetConfirmTitle":"Reset Info Bar settings","ui.resetConfirmDescFields":"Restore all display choices to their defaults. Custom colors are not affected and the change applies right away.","ui.resetConfirmDescColors":"All custom colors will be cleared and defaults restored. Field switches are not affected. This applies to the Info Bar right away.","ui.resetConfirmAcknowledge":"I understand this reset cannot be undone","ui.resetConfirmCancel":"Cancel","ui.resetConfirmConfirm":"Reset","ui.resetLabels":"Restore display","ui.resetColors":"Restore colors","ui.resetRowTitle":"Reset to defaults","ui.resetRowDesc":"Restore displayed items or colors to their defaults.","ui.customTextCount":"{value}/64 characters","ui.couldNotDisplayInfoBar":"Could not display Info Bar settings: {value}","ui.dataAndBilling":"Billing data","ui.dataAndBillingDesc":"Export or clear the usage and spend records saved by this plugin.","ui.exportBillingRecords":"Export billing","ui.exportBillingRecordsDesc":"Export the records as a CSV or JSON file.","ui.exportBillingCsv":"Export CSV","ui.exportBillingJson":"Export JSON","ui.clearBillingRecords":"Clear billing","ui.clearBillingRecordsDesc":"This cannot be undone.","ui.clearBillingRecordsConfirm":"Clear all billing records saved by this plugin? Export first. This cannot be undone, but settings and sign-in information will stay unchanged.","ui.exportedBillingRecords":"Exported {count} billing records ({format})","ui.noBillingRecordsToExport":"There are no billing records to export.","ui.exportFailed":"Export failed: {value}","ui.exportIncomplete":"Some historical billing records could not be read: {value}. Nothing was exported; try again later.","ui.clearFailed":"Could not clear billing records: {value}","ui.clearFailedWithoutDetails":"Billing records could not be fully cleared","ui.clearedBillingRecords":"Cleared {count} billing records","ui.clearCanceled":"Canceled","ui.exportNotSupported":"File downloads are not supported in this environment.","ui.weekly":"Weekly","ui.monthly":"Monthly","ui.window":"Window","ui.quotaDisplayUsed":"Used","ui.quotaDisplayRemaining":"Remaining","ui.quotaDisplayModeTitle":"Subscription window percentage","ui.quotaDisplayModeDesc":"Show subscription quota windows as remaining or used. The low-quota warning always triggers when less than 20% remains.","ui.windowUsedRemaining":"{label} window: used {usedPercent}% (remaining {value}%)","ui.windowUsedRemainingResets":"{label} window: used {usedPercent}% (remaining {value}%) · Resets {value4}","ui.minimax":"MiniMax","ui.supportsImageInput":"Supports image input.","ui.vision":"Vision","ui.unknown":"Unknown","ui.unknownModel":"Unknown model","ui.modelSelectionPending":"Reading current model","ui.modelCapabilityPending":"Checking image-input support","ui.pluginVersion":"\nPlugin version: {current}","ui.provider":"Provider: {provLabel} {modelLabel}\n","ui.pricingPeakOffPeakBeijing":"Pricing: peak/off-peak (Beijing time; weekday peaks 09:00-12:00 and 14:00-18:00; weekends and Chinese public holidays off-peak)","ui.pricingFixed":"Pricing: fixed","ui.pricingNotListedUsingDefaults":"Pricing: not listed; spend is not calculated","ui.zhipu":"Zhipu","ui.xiaomiMiMo":"Xiaomi MiMo","ui.commandCode":"Command Code","ui.subscription":"Subscription","ui.cloudBilling":"Cloud billing","ui.plan":"\nPlan: {plan}","ui.expiresLocalTime":"\nExpires: {value} (local time)","ui.subscriptionServiceModel":"Subscription service: {serviceName}\nModel: {rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.balanceLookupIsNotYet":"This provider's balance is not available yet.","ui.notSupported":"Not supported","ui.accountDataUnavailable":"No public account data","ui.accountDataUnavailableDetail":"This provider is supported for model recognition and local usage accounting, but has no public balance or quota endpoint that the plugin can safely read.","ui.notConfigured":"Not configured: ","ui.notConfiguredConfigureItIn":"Not configured: {credName}. Configure it in Settings → Models.","ui.notConfiguredSettingsModels":"{credName} is not configured. Add it in Settings → Models.","ui.accountSignedOut":"Account signed out","ui.accountSignedOutHow":"Sign in to your DeepSeek account in DSH settings, Account, and the balance will appear here.","ui.estimatedBalance":"Estimated balance: {symbol}{value}","ui.balance":"Balance: {symbol}{value}","ui.balanceDetailToppedUp":"Topped-up balance: {symbol}{value}","ui.balanceDetailGranted":"Granted balance: {symbol}{value}","ui.balance.pushBalanceGroups":"Balance","ui.low":"Low","ui.estimated":"(estimated)","ui.balanceIsTemporarilyUnavailableShowing":"Balance is temporarily unavailable. Showing the last data and retrying automatically.","ui.couldNotLoadBalanceCheck":"Could not load balance. Check your connection and API key.","ui.balanceUnavailable":"Balance unavailable","ui.beijingTime":"Beijing time: ","ui.peakPrice":"Peak price","ui.offPeakPrice":"Off-peak price","ui.input":": input ¥","ui.mCachedInput":"/M · cached input ¥","ui.mOutput":"/M · output ¥","ui.beijingTimeSwitchesTo":"Beijing time: {atLabel} switches to ","ui.until":"Until ","ui.offPeak":"off-peak","ui.peak":"peak","ui.today":"Today {symbol}{value}","ui.lastDays":"Last 30 days {symbol}{value}","ui.allTime":"All time {symbol}{value}","ui.sessionIncludingSubagents":"Session {costTxt} (including subagents){value}","ui.session":"Session","ui.spendIsTemporarilyUnavailableChat":"Spend is temporarily unavailable. Chat is unaffected.","ui.spendUnavailable":"Spend unavailable","ui.noSignInCredentialsFound":"No sign-in credentials found for {serviceName}. Please reauthorize.","ui.credentialsHaveExpiredPleaseReauthorize":"{serviceName} credentials have expired. Please reauthorize.","ui.deniedAccessReauthorizeOrTry":"{serviceName} denied access. Reauthorize or try again later.","ui.rateLimitReachedPleaseTry":"{serviceName} rate limit reached. Please try again later.","ui.timedOutCheckYourConnection":"{serviceName} timed out. Check your connection and try again.","ui.returnedAnUnrecognizedResponsePlease":"{serviceName} returned an unrecognized response. Please try again later.","ui.isTemporarilyUnavailableCheckYour":"{serviceName} is temporarily unavailable. Check your connection and try again.","ui.subscriptionExpiresLocalTime":"Subscription expires: {value} (local time)","ui.expires":"Expires","ui.subscriptionSource":"Subscription source: {value} (","ui.prepaidBalance":"Available balance","ui.availableBalanceLabel":"Available balance","ui.remainingCredits":"Credits remaining","ui.availableBalance":"Available balance: {balTxt}","ui.availableCredits":"Credits remaining: {value}","ui.subscriptionSource.titleLines":"Subscription source: {value}","ui.windowRemainingUsed":"{label} window: remaining {value}% (used {usedPercent}%)","ui.resetsResetsIn":" · Resets {value} · Resets in {value2}","ui.windowRemainingUsedResets":"{label} window: remaining {value}% (used {usedPercent}%) · Resets {value4}","ui.resetsIn":"Resets in","ui.configureItInSettingsModels":". Configure it in Settings → Models.","ui.deniedAccessTheTokenMay":"{serviceName} denied access: the token may lack billing read permissions.","ui.billingIsTemporarilyUnavailableCheck":"{serviceName} billing is temporarily unavailable. Check your connection and permissions, then try again.","ui.billingSource":"Billing source: {value}","ui.thisMonthSSpend":"This month’s spend: {symbol}{value}","ui.budgetUsed":"Budget used: {value}%","ui.dailyFreeQuotaRemaining":"Daily free quota remaining: {value}","ui.thisMonth":"This month","ui.thisMonthSUsage":"This month’s usage","ui.budget":"Budget","ui.free":"Free","ui.resetsIn.pushBillingGroups":"{value} · Resets in {value2}","ui.billingServiceModel":"Billing service: {serviceName}\nModel: {modelLabel}{versionLine}","ui.pricing":"Pricing","ui.spend":"Spend","ui.mode":"Mode","ui.subscriptionQuota":"Subscription quota","ui.billing":"Billing","ui.temporarilyUnavailableKeepingTheLast":": temporarily unavailable. Keeping the last data and retrying automatically.","ui.spendJournalSavedButThe":"Spend journal saved, but the readable ledger has not been updated: ","ui.thisSpendRecordWasNot":"This spend record was not saved and will not be added to totals: ","ui.ledgerUpdatePending":"Ledger update pending","ui.spendNotSaved":"Spend not saved","ui.versionAndUpdateTitle":"Version and updates","ui.versionAndUpdateDesc":"Updates replace only the plugin's own files; billing records and settings are untouched.","ui.versionUnavailable":"The DSH currently running has not loaded this version of the plugin yet, so only this line can be shown here. Restart DSH and the running version, the update mode and the check button will appear.","ui.versionRunning":"Running version {version}","ui.versionLatest":"Latest version {version}","ui.versionLastCheck":"Last checked {time}","ui.versionUnknown":"Unknown","ui.timeJustNow":"just now","ui.timeMinutesAgo":"{n} min ago","ui.timeHoursAgo":"{n} h ago","ui.timeDaysAgo":"{n} d ago","ui.autoUpdateTitle":"Update method","ui.updateModeAutoDesc":"Checks and installs when DSH starts. During use, a manual check asks before installing.","ui.updateModeManualDesc":"Does not install at startup. During use, a manual check asks before installing.","ui.updateModeAuto":"Automatic updates","ui.updateModeManual":"Manual updates","ui.updateConfirm":"Version {version} is available. Update the plugin now? Restart DSH to apply it.","ui.updateCheckNow":"Check now","ui.updateChecking":"Checking…","ui.updateInstallNow":"Update to {version}","ui.updateInstalling":"Updating to {version}…","ui.updateAvailableNow":"Version {version} is ready; you can update now.","ui.updateRollbackFailed":"The rollback did not succeed because no usable backup exists. Uninstall and reinstall from the plugins page instead.","ui.updateHostOutdated":"This action did not run: the DSH now running still carries the old update logic. Restart DSH and the button will work.","ui.updateUpToDate":"Up to date.","ui.updateDisabled":"Automatic updates are unavailable here","ui.updateDisabledWhy":"Automatic updates need the plugin installed into the DSH plugin directory. This copy came from a source checkout or a link, so use the original update command.","ui.updatePendingRestart":"Updated to {version}. Restart DSH to activate.","ui.updateFailed":"The last update did not succeed","ui.updateFallbackWhy":"If the new version misbehaves, you can go back to the previous one.","ui.updateHoldWhy":"You held this version back, so it will not be installed automatically.","ui.updateErrorIncompleteDownload":"The download was incomplete (the connection dropped). This update was abandoned and the version you have is untouched.","ui.updateErrorIntegrityMismatch":"The update package failed its safety check, so it was abandoned. The version you have is untouched.","ui.updateErrorDownloadFailed":"Could not reach the update server. Try again later.","ui.updateErrorTooLarge":"The update package was unusually large, so it was abandoned.","ui.updateErrorPayloadMismatch":"The update package did not match its version number, so it was abandoned.","ui.updateErrorPayloadUnsafe":"The update package contained an unexpected file path, so it was abandoned.","ui.updateErrorCheckFailed":"The version check did not succeed, possibly a network problem.","ui.updateErrorUnknown":"The update did not succeed. Details are in the update log.","ui.updateRollback":"Roll back to previous version","ui.updateRolledBack":"Rolled back to the previous version {version}.","ui.updateHeld":"Version {version} is held back and will not be installed automatically.","ui.updateAllowHeld":"Allow updating to {version}","ui.updateRestartBadge":"Restart to apply","ui.updateFailedBadge":"Update failed","ui.tools":"Tools","ui.avgTTFT":"Avg. TTFT","ui.cacheHit":"Cache hit","ui.cacheHitScope":"By token: {hit} hit / {miss} miss ({percent}% hit).\nScope: this session's main Agent only, subagents excluded.","ui.tokenScope":"Input/output accumulate this session's main Agent only (subagents excluded); Session cost includes subagents.","ui.spendPartlyUnpriced":"Some calls have no listed price (no other model's price is substituted); the real cost is higher than shown.","ui.input.BottomInfoBar":"Input","ui.output":"Output","ui.savingView":"Saving view…","ui.clickToSwitchFullCompact":"Click to switch full/compact view","ui.pressEnterOrSpaceFor":"Press Enter or Space for compact view.","ui.pressEnterOrSpaceFor.BottomInfoBar":"Press Enter or Space for full view.","host.hour":"5-hour","host.unknownProvider":"Unknown provider","error.subscription.request-failed":"Unexpected subscription quota request failure","host.settingsFileCouldNotBe":"Settings file could not be saved","error.settings.save-failed":"Could not save settings.json: {value}","error.balance.credentials":"Could not read credentials","error.balance.not-configured":"Not configured: {credential}","error.balance.account-signed-out":"The built-in account is signed out","error.balance.account-unavailable":"This host has no built-in account service","error.balance.account-request-failed":"Could not fetch the built-in account balance","error.request.http":"Request failed: HTTP {status}.","error.request.parse":"Unexpected response format","error.subscription.not-connected":"ChatGPT subscription is not connected: credentials not found in ~/.codex/auth.json. Install dsh-chatgpt-sub and sign in.","error.subscription.credentials-missing":"ChatGPT subscription credentials are missing id_token. Install dsh-chatgpt-sub and reauthorize.","error.subscription.opencode-not-configured":"OpenCode Go is not configured. Set OPENCODE_GO_API_KEY or use opencode auth.json.","error.subscription.commandcode-not-configured":"Command Code is not configured. Set COMMAND_CODE_API_KEY, CMD_API_KEY, or sign in with the Command Code CLI.","error.subscription.commandcode-auth-failed":"Command Code credentials were rejected. Sign in again or update the API key.","error.subscription.commandcode-unrecognized":"Command Code returned an unrecognized quota format; the previous snapshot was kept.","host.zhipu":"Zhipu {mapped}","host.zhipu.parseZaiQuota":"Zhipu {value}{value2}","error.subscription.zhipu-not-configured":"Zhipu API key is not configured. Set ZAI_API_KEY or ZAI_CODING_CN_API_KEY.","error.subscription.zhipu-auth-failed":"Zhipu API authentication failed: the key is expired or invalid.","error.subscription.zhipu-unrecognized":"Zhipu returned an unrecognized quota format (the API may have changed); the last known data is kept.","error.request.failed":"Request failed: {value} {msg}.","error.subscription.xiaomi-not-configured":"Xiaomi MiMo Token Plan credentials are not configured: {credName} or XIAOMI_API_KEY.","error.subscription.xiaomi-http":"Request failed: HTTP {value}.","error.subscription.minimax-not-configured":"MiniMax is not configured. Set MINIMAX_API_KEY or MINIMAX_CN_API_KEY. Token Plan queries require a Subscription Key; pay-as-you-go API keys are rejected by the server.","error.subscription.minimax-auth-failed":"MiniMax rejected the API key: Token Plan queries require a Subscription Key (generated on the Token Plan subscription page). Pay-as-you-go keys are rejected (status_code=1004 / HTTP 401).","error.subscription.minimax-unrecognized":"MiniMax returned an unrecognized quota format (the API may have changed); the last known data is kept.","error.billing.together-not-configured":"Not configured: TOGETHER_API_KEY","host.actualMonthlyBillFromThe":"Actual monthly bill from the Together Usage API","error.billing.fireworks-not-configured":"Not configured: FIREWORKS_API_KEY","error.billing.fireworks-account":"Could not read account (account_id missing)","host.actualBillForThisPeriod":"Actual bill for this period (Fireworks Billing Summary)","host.actualUsageForThisPeriod":"Actual usage for this period (billingUsage fallback; no spend amount)","error.billing.aws-not-configured":"Not configured: AWS credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)","error.billing.aws-http":"Request failed: HTTP {status}. The token may lack ce:GetCostAndUsage permission","host.actualMonthlyBillFromAWS":"Actual monthly bill from AWS Cost Explorer (about 24 hours behind)","error.billing.cloudflare-not-configured":"Not configured: CLOUDFLARE_API_KEY (requires an account-level token with Billing read permission)","error.billing.cloudflare-account":"Not configured: CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"Request failed: HTTP {status}. The token requires Billing read permission","host.actualMonthlyUsageFromThe":"Actual monthly usage from the Cloudflare Billable Usage API (Alpha)","error.billing.huggingface-not-configured":"Not configured: HF_TOKEN (fine-grained tokens require Billing read permission)","host.actualMonthlyBillFromHF":"Actual monthly bill from the Hugging Face Billing API","error.billing.request-failed":"Unexpected billing request failure","host.spendSummaryFileMissingArchived":"Spend summary file missing: archived amounts are not included in displayed totals. Details remain in usage-archive/ for manual recovery.","host.spendLedgerCouldNotBe":"Spend ledger could not be saved","host.usageLedgerBusy":"A response is still in progress. Clear billing records after it finishes.","error.ledger.clear-failed":"Billing records could not be fully cleared: {value}","error.ledger.snapshot-stale":"Could not save archived spend summaries: {value}","host.basedOnYourLastSessions":"Based on your last {count} sessions","host.estimatedFromSpendingOverThe":"Estimated from spending over the last {SPEND_DAYS} days","host.patchMustIncludeFieldsOr":"patch must include fields, colors, timeZones or customText","host.timeZonesMustBeAnObject":"timeZones must be an object","host.timeZoneMustBeAValid":"Time zone must be a valid IANA zone: {key}","host.customTextMustBeAString":"Custom text must be a string","host.customTextTooLong":"Custom text must not exceed 64 characters","host.quotaDisplayModeInvalid":"Subscription window percentage mode must be \"used\" or \"remaining\"","host.infoDensityMustBeFullOrCompact":"Information display must be full or compact","host.fieldsMustBeAnObject":"fields must be an object","host.unknownFieldId":"Unknown field id: {key}","host.fieldVisibilityMustBeA":"Field visibility must be a boolean: {key}","host.colorsMustBeAnObject":"colors must be an object","host.colorMustBeAPreset":"Color must be a preset name or #RRGGBB: {key}","field.anchorGroup.label":"Provider and model","field.anchorGroup.note":"Shows the provider and model used in this conversation.","field.subServiceGroup.label":"Subscription service and model","field.subServiceGroup.note":"Shows the subscription service and current model or plan.","field.billingServiceGroup.label":"Billing service and model","field.billingServiceGroup.note":"Shows the billing service and current model.","field.customText.label":"Custom text","field.customText.note":"Shows custom text for a note or signature.","field.mainTime.label":"Main time","field.mainTime.note":"Shows the main time zone; adjust zone in Time and date.","field.worldTime.label":"World time","field.worldTime.note":"Shows another time zone.","field.sessionCost.label":"Session spend","field.sessionCost.note":"Shows actual spend for this session, including subagents.","field.balance.note":"Shows the account balance; a low balance is highlighted in red.","field.period.label":"Current period","field.period.note":"For peak-valley pricing providers, shows whether the current period is peak or off-peak.","field.countdown.label":"Next price change","field.countdown.note":"Shows the time until the next peak / off-peak price change.","field.expiry.label":"Subscription expiry","field.expiry.note":"Shown when the provider returns an expiry date.","field.subWindow5h.label":"5-hour quota","field.subWindow5h.note":"Shows the remaining rolling 5-hour quota.","field.subWindowWeek.label":"Weekly quota","field.subWindowWeek.note":"Shows the remaining weekly quota.","field.subWindowMonth.label":"Monthly quota","field.subWindowMonth.note":"Shows the remaining monthly quota.","field.resetCountdown.label":"Quota reset","field.resetCountdown.note":"Shows the time remaining until the current quota resets.","field.subBalance.label":"Available balance or credits","field.subBalance.note":"Shows available balance for pay-as-you-go accounts, or remaining credits when a subscription has no visible quota window.","field.billingSpend.label":"Monthly usage","field.billingSpend.note":"Shows actual usage or spend for the current billing period.","field.budget.label":"Budget status","field.budget.note":"Shown when the provider reports a budget percentage.","field.freeQuota.label":"Free quota","field.freeQuota.note":"Shown when the provider offers a free allowance, with the remaining amount and reset time.","field.turnsSteps.label":"Turns and steps","field.turnsSteps.note":"Shows turns and steps in this session.","field.llmTime.label":"Model time","field.llmTime.note":"Shows total model inference time.","field.toolTime.label":"Tool time","field.toolTime.note":"Shows total tool execution time.","field.avgTTFT.label":"Average time to first token","field.avgTTFT.note":"Shows the average time to first token across model steps in this session.","field.outputSpeed.label":"Output speed","field.outputSpeed.note":"Shows average output speed for usage-reporting model steps in this session (tok/s).","field.cacheHit.note":"Shows the prompt cache hit rate.","field.tokensIO.label":"Input / output tokens","field.tokensIO.note":"Shows this session’s total input / output tokens.","field.contextUsage.label":"Context usage","field.contextUsage.note":"Shows context usage; a fuller ring means less writable space remains.","ui.contextAria":"{percent} of context used","ui.contextUsed":"Context used","ui.contextSystem":"System prompt","ui.contextTools":"Tool definitions","ui.contextMessages":"Conversation messages","ui.contextFigures":"~{used} / {window}","number.thousand":"{value}K","number.million":"{value}M","field.unmapped.label":"Account data status","field.unmapped.note":"Shown when a provider is unknown or has no public balance/quota endpoint; local usage accounting still works.","field.noKeyHint.label":"Missing key hint","field.noKeyHint.note":"Shown when an API key is missing, pointing to where it goes.","field.balanceError.label":"Balance update error","field.balanceError.note":"Shown when balance update fails.","field.usageError.label":"Usage update error","field.usageError.note":"Shown when spend data is temporarily unavailable.","field.refreshFailure.label":"Update error","field.refreshFailure.note":"Shown when any data refresh fails.","field.persistWarning.label":"Unsaved record alert","field.persistWarning.note":"Shown when billing records cannot be saved; recommended.","field.updateNotice.label":"Update notice","field.updateNotice.note":"Shows a short marker when a new version is ready, or a downloaded version is waiting for a restart.","field.updateFailure.label":"Update failure notice","field.updateFailure.note":"Shows a short marker when the automatic update failed.","group.native":"Native information","group.plugin":"Plugin information","group.notice":"Notices","group.native.desc":"Fields the DSH bar already had. They live in the native stats row, which only Full mode shows.","group.plugin.desc":"Fields this plugin adds, the adopted context ring included. They live in the main row, shown in both modes.","group.notice.desc":"One-off notices such as updates and failures. They appear whenever there is really something to say, whatever the mode.","section.identity.label":"Provider and model","section.identity.desc":"Shown whatever you pay with: which service and model this conversation runs on.","section.subscription.label":"Subscription: monthly plan, quota included","section.subscription.desc":"A plan like ChatGPT only fills the items below: quota windows, quota reset, expiry date and available balance.","section.balance.label":"Prepaid balance: top up, then usage is deducted","section.balance.desc":"These providers only fill the items below: balance, session spend, current period and next price change.","section.billing.label":"Billed usage: use first, invoiced monthly","section.billing.desc":"These providers only fill the items below: this month's usage, budget and free allowance.","section.common.label":"General items","section.common.desc":"Nothing to do with billing, useful on any provider: custom text, clocks, context usage.","ui.listSeparator":", ","ui.sentenceEnd":".","ui.fieldErrorPrefix":"\"{label}\": ","ui.turnCount":"{count} turn","ui.turnCountPlural":"{count} turns","ui.stepCount":"{count} step","ui.stepCountPlural":"{count} steps","ui.mainTimeZone":"Main time zone","ui.worldTimeZone":"World time zone","ui.customTextTitle":"Custom text","ui.customTextPlaceholder":"Enter text (up to 64 characters)","ui.searchPlaceholder":"Search by name or description…","ui.searchFieldsLabel":"Search visible content","ui.searchResultCount":"{count} found","ui.enabledFieldsCount":"{count} enabled","ui.noSearchResults":"No matching settings found","ui.mainTime":"Main time","ui.worldTime":"World time","ui.customText":"Custom text","language.title":"Language","language.description":"Follow DSH or choose a language for this plugin in this browser.","language.auto":"Follow DSH","language.saveFailed":"Could not save the language preference. Allow local storage and try again."},"ja":{"meta.title":"下部情報バー","meta.description":"入力欄の下に現在のモデル、残高、利用料金を表示します。","ui.requestTimedOut":"リクエストがタイムアウトしました","ui.requestCanceled":"リクエストがキャンセルされました","ui.couldNotParseResponse":"応答を解析できませんでした","ui.rpcFailed":"RPC に失敗しました","ui.refreshFailed":"更新に失敗しました","color.red":"赤","color.green":"緑","color.blue":"青","color.purple":"紫","color.orange":"オレンジ","color.neutral":"ニュートラル","ui.pleaseTryAgainLater":"しばらくしてから再試行してください","ui.restoreDefaultColor":"既定の色に戻す","ui.infoBarSettings":"情報バー","ui.settingsAreTemporarilyUnavailable":"設定を一時的に利用できません","ui.loadingInfoBarSettings":"設定を読み込み中…","ui.couldNotLoadInfoBar":"情報バーの設定を読み込めませんでした：","ui.changesAppliedButCouldNot":"適用しましたが、ローカルに保存できませんでした：","ui.unknownReason":"原因不明","ui.couldNotSave":"{errorPrefix}保存できませんでした：{value}","ui.color":"「{value}」の色：","ui.hasAnInvalidColorEnter":"「{value}」の色が無効です。#RRGGBB 形式で入力してください（例：#0044CC）。","ui.defaultColorsRestored":"既定の色に戻しました","ui.defaultLabelsRestored":"既定の表示に戻しました","ui.couldNotReset":"リセットできませんでした：{value}","ui.show":"{label}を表示","ui.clickToHide":"クリックして非表示","ui.clickToShow":"クリックして表示","ui.presetColor":"{label}のプリセット色","ui.customColor":"{label}のカスタム色","ui.customColorOpenColorPicker":"カスタム色（カラーピッカーを開く）","ui.customColorItem":"カスタム…","ui.colorSwatchLabel":"{label}の色","ui.hexColor":"{label}の16進数カラーコード","ui.expand":"展開","ui.collapse":"折りたたむ","ui.saving":"保存中…","ui.processing":"処理中…","ui.visibleFields":"表示する情報","ui.timeDateTitle":"時刻と日付","ui.timeDateDesc":"メイン時刻と世界時刻のタイムゾーン。","ui.customTextSectionDesc":"情報バーにカスタムテキストを1行表示します。","ui.resetConfirmTitle":"情報バーの設定をリセット","ui.resetConfirmDescFields":"すべての表示設定を既定値に戻します。カスタム色は変更されず、すぐに適用されます。","ui.resetConfirmDescColors":"すべてのカスタム色を消去し、既定の色に戻します。項目の表示スイッチは変更されません。情報バーにすぐに適用されます。","ui.resetConfirmAcknowledge":"このリセットは取り消せないことを理解しています","ui.resetConfirmCancel":"キャンセル","ui.resetConfirmConfirm":"リセット","ui.resetLabels":"表示を元に戻す","ui.resetColors":"色を元に戻す","ui.resetRowTitle":"既定値に戻す","ui.resetRowDesc":"表示項目または色を既定値に戻します。","ui.customTextCount":"{value}/64 文字","ui.couldNotDisplayInfoBar":"情報バーの設定を表示できませんでした：{value}","ui.dataAndBilling":"請求データ","ui.dataAndBillingDesc":"このプラグインが保存した使用量と利用料金の記録を書き出すか、消去します。","ui.exportBillingRecords":"請求記録を書き出す","ui.exportBillingRecordsDesc":"記録を CSV または JSON ファイルとして書き出します。","ui.exportBillingCsv":"CSV を書き出す","ui.exportBillingJson":"JSON を書き出す","ui.clearBillingRecords":"請求記録を消去","ui.clearBillingRecordsDesc":"この操作は取り消せません。","ui.clearBillingRecordsConfirm":"このプラグインが保存した請求記録をすべて消去しますか？先に書き出してください。この操作は取り消せませんが、設定とログイン情報は変更されません。","ui.exportedBillingRecords":"請求記録 {count} 件を書き出しました（{format}）","ui.noBillingRecordsToExport":"書き出せる請求記録はありません。","ui.exportFailed":"書き出しに失敗しました：{value}","ui.exportIncomplete":"一部の過去の請求記録を読み込めませんでした：{value}。何も書き出していません。しばらくしてから再試行してください。","ui.clearFailed":"請求記録を消去できませんでした：{value}","ui.clearFailedWithoutDetails":"請求記録をすべて消去できませんでした","ui.clearedBillingRecords":"請求記録 {count} 件を消去しました","ui.clearCanceled":"キャンセルしました","ui.exportNotSupported":"この環境ではファイルのダウンロードを利用できません。","ui.weekly":"週間","ui.monthly":"月間","ui.window":"期間","ui.quotaDisplayUsed":"使用済み","ui.quotaDisplayRemaining":"残り","ui.quotaDisplayModeTitle":"サブスクリプション期間の割合","ui.quotaDisplayModeDesc":"サブスクリプション枠を残りまたは使用済みで表示します。残りが 20% 未満になると、表示方式にかかわらず警告します。","ui.windowUsedRemaining":"{label}枠：使用済み {usedPercent}%（残り {value}%）","ui.windowUsedRemainingResets":"{label}枠：使用済み {usedPercent}%（残り {value}%） · リセット {value4}","ui.minimax":"MiniMax","ui.supportsImageInput":"画像入力に対応しています。","ui.vision":"画像認識","ui.unknown":"不明","ui.unknownModel":"不明なモデル","ui.modelSelectionPending":"現在のモデルを読み取り中","ui.modelCapabilityPending":"画像入力への対応を確認中","ui.pluginVersion":"\nプラグインのバージョン：{current}","ui.provider":"プロバイダー：{provLabel} {modelLabel}\n","ui.pricingPeakOffPeakBeijing":"料金：ピーク／オフピーク（北京時間。平日のピークは 09:00–12:00 と 14:00–18:00。週末と中国の祝日はオフピーク）","ui.pricingFixed":"料金：固定","ui.pricingNotListedUsingDefaults":"料金：未登録のため利用料金を計算しません","ui.zhipu":"Zhipu","ui.xiaomiMiMo":"Xiaomi MiMo","ui.commandCode":"Command Code","ui.subscription":"サブスクリプション","ui.cloudBilling":"クラウド請求","ui.plan":"\nプラン：{plan}","ui.expiresLocalTime":"\n有効期限：{value}（現地時刻）","ui.subscriptionServiceModel":"サブスクリプションサービス：{serviceName}\nモデル：{rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.balanceLookupIsNotYet":"このプロバイダーの残高はまだ取得できません。","ui.notSupported":"未対応","ui.accountDataUnavailable":"公開アカウントデータなし","ui.accountDataUnavailableDetail":"このプロバイダーはモデルの識別とローカルでの使用量記録に対応していますが、プラグインが安全に読み取れる公開の残高・利用枠取得先がありません。","ui.notConfigured":"未設定：","ui.notConfiguredConfigureItIn":"{credName} が未設定です。「設定 → モデル」で設定してください。","ui.notConfiguredSettingsModels":"{credName} が未設定です。「設定 → モデル」で追加してください。","ui.accountSignedOut":"アカウントからログアウトしています","ui.accountSignedOutHow":"DSH の「設定 → アカウント」で DeepSeek アカウントにログインすると、ここに残高が表示されます。","ui.estimatedBalance":"推定残高：{symbol}{value}","ui.balance":"残高：{symbol}{value}","ui.balanceDetailToppedUp":"チャージ残高：{symbol}{value}","ui.balanceDetailGranted":"付与残高：{symbol}{value}","ui.balance.pushBalanceGroups":"残高","ui.low":"少ない","ui.estimated":"（推定）","ui.balanceIsTemporarilyUnavailableShowing":"残高を一時的に取得できません。前回のデータを表示し、自動的に再試行します。","ui.couldNotLoadBalanceCheck":"残高を取得できませんでした。接続と API キーを確認してください。","ui.balanceUnavailable":"残高を取得できません","ui.beijingTime":"北京時間：","ui.peakPrice":"ピーク料金","ui.offPeakPrice":"オフピーク料金","ui.input":"：入力 ¥","ui.mCachedInput":"/M · キャッシュ入力 ¥","ui.mOutput":"/M · 出力 ¥","ui.beijingTimeSwitchesTo":"北京時間：{atLabel} に切り替え：","ui.until":"切り替えまで ","ui.offPeak":"オフピーク","ui.peak":"ピーク","ui.today":"今日 {symbol}{value}","ui.lastDays":"過去30日 {symbol}{value}","ui.allTime":"全期間 {symbol}{value}","ui.sessionIncludingSubagents":"このセッション {costTxt}（サブエージェントを含む）{value}","ui.session":"セッション","ui.spendIsTemporarilyUnavailableChat":"利用料金を一時的に取得できません。チャットには影響しません。","ui.spendUnavailable":"利用料金を取得できません","ui.noSignInCredentialsFound":"{serviceName} のログイン情報が見つかりません。再認証してください。","ui.credentialsHaveExpiredPleaseReauthorize":"{serviceName} の認証情報の有効期限が切れています。再認証してください。","ui.deniedAccessReauthorizeOrTry":"{serviceName} がアクセスを拒否しました。再認証するか、しばらくしてから再試行してください。","ui.rateLimitReachedPleaseTry":"{serviceName} のリクエスト上限に達しました。しばらくしてから再試行してください。","ui.timedOutCheckYourConnection":"{serviceName} がタイムアウトしました。接続を確認して再試行してください。","ui.returnedAnUnrecognizedResponsePlease":"{serviceName} から認識できない応答が返されました。しばらくしてから再試行してください。","ui.isTemporarilyUnavailableCheckYour":"{serviceName} を一時的に利用できません。接続を確認して再試行してください。","ui.subscriptionExpiresLocalTime":"サブスクリプションの有効期限：{value}（現地時刻）","ui.expires":"有効期限","ui.subscriptionSource":"サブスクリプション取得元：{value}（","ui.prepaidBalance":"利用可能残高","ui.availableBalanceLabel":"利用可能残高","ui.remainingCredits":"残りクレジット","ui.availableBalance":"利用可能残高：{balTxt}","ui.availableCredits":"残りクレジット：{value}","ui.subscriptionSource.titleLines":"サブスクリプション取得元：{value}","ui.windowRemainingUsed":"{label}枠：残り {value}%（使用済み {usedPercent}%）","ui.resetsResetsIn":" · リセット {value} · リセットまで {value2}","ui.windowRemainingUsedResets":"{label}枠：残り {value}%（使用済み {usedPercent}%） · リセット {value4}","ui.resetsIn":"リセットまで","ui.configureItInSettingsModels":"。「設定 → モデル」で設定してください。","ui.deniedAccessTheTokenMay":"{serviceName} がアクセスを拒否しました。トークンに請求データの読み取り権限がない可能性があります。","ui.billingIsTemporarilyUnavailableCheck":"{serviceName} の請求データを一時的に取得できません。接続と権限を確認して再試行してください。","ui.billingSource":"請求取得元：{value}","ui.thisMonthSSpend":"今月の利用料金：{symbol}{value}","ui.budgetUsed":"予算使用率：{value}%","ui.dailyFreeQuotaRemaining":"1日の無料枠の残り：{value}","ui.thisMonth":"今月","ui.thisMonthSUsage":"今月の使用量","ui.budget":"予算","ui.free":"無料","ui.resetsIn.pushBillingGroups":"{value} · リセットまで {value2}","ui.billingServiceModel":"請求サービス：{serviceName}\nモデル：{modelLabel}{versionLine}","ui.pricing":"料金","ui.spend":"利用料金","ui.mode":"モード","ui.subscriptionQuota":"サブスクリプション枠","ui.billing":"請求","ui.temporarilyUnavailableKeepingTheLast":"：一時的に取得できません。前回のデータを保持し、自動的に再試行します。","ui.spendJournalSavedButThe":"利用料金のログは保存しましたが、閲覧用の台帳は未更新です：","ui.thisSpendRecordWasNot":"この利用料金の記録は保存されておらず、合計に加算されません：","ui.ledgerUpdatePending":"台帳の更新待ち","ui.spendNotSaved":"利用料金が未保存","ui.versionAndUpdateTitle":"バージョンと更新","ui.versionAndUpdateDesc":"更新ではプラグイン自身のファイルだけを置き換えます。請求記録と設定は変更しません。","ui.versionUnavailable":"実行中の DSH はこのバージョンのプラグインをまだ読み込んでいないため、ここにはこの行だけが表示されます。DSH を再起動すると、実行中のバージョン、更新方式、確認ボタンが表示されます。","ui.versionRunning":"実行中のバージョン {version}","ui.versionLatest":"最新バージョン {version}","ui.versionLastCheck":"最終確認 {time}","ui.versionUnknown":"不明","ui.timeJustNow":"たった今","ui.timeMinutesAgo":"{n} 分前","ui.timeHoursAgo":"{n} 時間前","ui.timeDaysAgo":"{n} 日前","ui.autoUpdateTitle":"更新方式","ui.updateModeAutoDesc":"DSH の起動時に確認してインストールします。使用中に手動で確認した場合は、インストール前に確認します。","ui.updateModeManualDesc":"起動時にはインストールしません。使用中に手動で確認した場合は、インストール前に確認します。","ui.updateModeAuto":"自動更新","ui.updateModeManual":"手動更新","ui.updateConfirm":"バージョン {version} が利用可能です。今すぐプラグインを更新しますか？適用するには DSH を再起動してください。","ui.updateCheckNow":"今すぐ確認","ui.updateChecking":"確認中…","ui.updateInstallNow":"{version} に更新","ui.updateInstalling":"{version} に更新中…","ui.updateAvailableNow":"バージョン {version} の準備ができました。今すぐ更新できます。","ui.updateRollbackFailed":"利用できるバックアップがないため、元のバージョンに戻せませんでした。プラグインページでアンインストールしてから再インストールしてください。","ui.updateHostOutdated":"この操作は実行されませんでした。実行中の DSH に古い更新処理が残っています。DSH を再起動するとボタンが使えるようになります。","ui.updateUpToDate":"最新です。","ui.updateDisabled":"この環境では自動更新を利用できません","ui.updateDisabledWhy":"自動更新には DSH のプラグインディレクトリへのインストールが必要です。このコピーはソースコードまたはリンクから導入されているため、元の更新コマンドを使ってください。","ui.updatePendingRestart":"{version} に更新しました。有効にするには DSH を再起動してください。","ui.updateFailed":"前回の更新に失敗しました","ui.updateFallbackWhy":"新しいバージョンに問題がある場合は、前のバージョンに戻せます。","ui.updateHoldWhy":"このバージョンの更新を保留したため、自動ではインストールされません。","ui.updateErrorIncompleteDownload":"ダウンロードが不完全でした（接続が切れました）。今回の更新は中止し、現在のバージョンは変更していません。","ui.updateErrorIntegrityMismatch":"更新パッケージが安全性チェックに合格しなかったため、更新を中止しました。現在のバージョンは変更していません。","ui.updateErrorDownloadFailed":"更新サーバーに接続できませんでした。しばらくしてから再試行してください。","ui.updateErrorTooLarge":"更新パッケージが異常に大きいため、更新を中止しました。","ui.updateErrorPayloadMismatch":"更新パッケージの内容とバージョン番号が一致しないため、更新を中止しました。","ui.updateErrorPayloadUnsafe":"更新パッケージに想定外のファイルパスが含まれていたため、更新を中止しました。","ui.updateErrorCheckFailed":"バージョンの確認に失敗しました。ネットワークの問題の可能性があります。","ui.updateErrorUnknown":"更新に失敗しました。詳しくは更新ログを確認してください。","ui.updateRollback":"前のバージョンに戻す","ui.updateRolledBack":"前のバージョン {version} に戻しました。","ui.updateHeld":"バージョン {version} は保留中のため、自動ではインストールされません。","ui.updateAllowHeld":"{version} への更新を許可","ui.updateRestartBadge":"再起動して適用","ui.updateFailedBadge":"更新失敗","ui.tools":"ツール","ui.avgTTFT":"平均 TTFT","ui.cacheHit":"キャッシュヒット","ui.cacheHitScope":"トークン単位：ヒット {hit} / ミス {miss}（ヒット率 {percent}%）。\n対象：このセッションのメイン Agent のみ。サブエージェントは含みません。","ui.tokenScope":"入力／出力は、このセッションのメイン Agent の分だけを累計します（サブエージェントを除く）。セッションの利用料金にはサブエージェントを含みます。","ui.spendPartlyUnpriced":"一部の呼び出しに登録済みの料金がありません（他のモデルの料金で代用しません）。実際の利用料金は表示額より高くなります。","ui.input.BottomInfoBar":"入力","ui.output":"出力","ui.savingView":"表示を保存中…","ui.clickToSwitchFullCompact":"クリックして完全表示／コンパクト表示を切り替え","ui.pressEnterOrSpaceFor":"Enter または Space を押すとコンパクト表示になります。","ui.pressEnterOrSpaceFor.BottomInfoBar":"Enter または Space を押すと完全表示になります。","host.hour":"5時間","host.unknownProvider":"不明なプロバイダー","error.subscription.request-failed":"サブスクリプション枠のリクエストで予期しないエラーが発生しました","host.settingsFileCouldNotBe":"設定ファイルを保存できませんでした","error.settings.save-failed":"settings.json を保存できませんでした：{value}","error.balance.credentials":"認証情報を読み取れませんでした","error.balance.not-configured":"未設定：{credential}","error.balance.account-signed-out":"内蔵アカウントからログアウトしています","error.balance.account-unavailable":"このホストには内蔵アカウントサービスがありません","error.balance.account-request-failed":"内蔵アカウントの残高を取得できませんでした","error.request.http":"リクエストに失敗しました：HTTP {status}。","error.request.parse":"想定外の応答形式","error.subscription.not-connected":"ChatGPT サブスクリプションが接続されていません。~/.codex/auth.json に認証情報が見つかりません。dsh-chatgpt-sub をインストールしてログインしてください。","error.subscription.credentials-missing":"ChatGPT サブスクリプションの認証情報に id_token がありません。dsh-chatgpt-sub をインストールして再認証してください。","error.subscription.opencode-not-configured":"OpenCode Go が未設定です。OPENCODE_GO_API_KEY を設定するか、opencode auth.json を使用してください。","error.subscription.commandcode-not-configured":"Command Code が未設定です。COMMAND_CODE_API_KEY、CMD_API_KEY を設定するか、Command Code CLI でログインしてください。","error.subscription.commandcode-auth-failed":"Command Code が認証情報を拒否しました。再度ログインするか、API キーを更新してください。","error.subscription.commandcode-unrecognized":"Command Code から認識できない利用枠の形式が返されました。前回のデータを保持しています。","host.zhipu":"Zhipu {mapped}","host.zhipu.parseZaiQuota":"Zhipu {value}{value2}","error.subscription.zhipu-not-configured":"Zhipu の API キーが未設定です。ZAI_API_KEY または ZAI_CODING_CN_API_KEY を設定してください。","error.subscription.zhipu-auth-failed":"Zhipu API の認証に失敗しました。キーの有効期限が切れているか、無効です。","error.subscription.zhipu-unrecognized":"Zhipu から認識できない利用枠の形式が返されました（API が変更された可能性があります）。最後に取得できたデータを保持しています。","error.request.failed":"リクエストに失敗しました：{value} {msg}。","error.subscription.xiaomi-not-configured":"Xiaomi MiMo Token Plan の認証情報が未設定です：{credName} または XIAOMI_API_KEY。","error.subscription.xiaomi-http":"リクエストに失敗しました：HTTP {value}。","error.subscription.minimax-not-configured":"MiniMax が未設定です。MINIMAX_API_KEY または MINIMAX_CN_API_KEY を設定してください。Token Plan の照会には Subscription Key が必要です。従量課金の API キーはサーバーに拒否されます。","error.subscription.minimax-auth-failed":"MiniMax が API キーを拒否しました。Token Plan の照会には Subscription Key（Token Plan のサブスクリプションページで生成）が必要です。従量課金のキーは拒否されます（status_code=1004 / HTTP 401）。","error.subscription.minimax-unrecognized":"MiniMax から認識できない利用枠の形式が返されました（API が変更された可能性があります）。最後に取得できたデータを保持しています。","error.billing.together-not-configured":"未設定：TOGETHER_API_KEY","host.actualMonthlyBillFromThe":"Together Usage API による今月の実際の請求額","error.billing.fireworks-not-configured":"未設定：FIREWORKS_API_KEY","error.billing.fireworks-account":"アカウントを読み取れませんでした（account_id がありません）","host.actualBillForThisPeriod":"今期の実際の請求額（Fireworks Billing Summary）","host.actualUsageForThisPeriod":"今期の実際の使用量（billingUsage による代替取得。利用料金は含みません）","error.billing.aws-not-configured":"未設定：AWS 認証情報（AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY）","error.billing.aws-http":"リクエストに失敗しました：HTTP {status}。トークンに ce:GetCostAndUsage 権限がない可能性があります","host.actualMonthlyBillFromAWS":"AWS Cost Explorer による今月の実際の請求額（約24時間の遅延）","error.billing.cloudflare-not-configured":"未設定：CLOUDFLARE_API_KEY（Billing 読み取り権限を持つアカウントレベルのトークンが必要）","error.billing.cloudflare-account":"未設定：CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"リクエストに失敗しました：HTTP {status}。トークンには Billing 読み取り権限が必要です","host.actualMonthlyUsageFromThe":"Cloudflare Billable Usage API（Alpha）による今月の実際の使用量","error.billing.huggingface-not-configured":"未設定：HF_TOKEN（細粒度トークンには Billing 読み取り権限が必要）","host.actualMonthlyBillFromHF":"Hugging Face Billing API による今月の実際の請求額","error.billing.request-failed":"請求データのリクエストで予期しないエラーが発生しました","host.spendSummaryFileMissingArchived":"利用料金の集計ファイルがありません。アーカイブされた金額は表示合計に含まれていません。明細は usage-archive/ に残っており、手動で復元できます。","host.spendLedgerCouldNotBe":"利用料金の台帳を保存できませんでした","host.usageLedgerBusy":"回答がまだ進行中です。終了後に請求記録を消去してください。","error.ledger.clear-failed":"請求記録をすべて消去できませんでした：{value}","error.ledger.snapshot-stale":"アーカイブの利用料金集計を保存できませんでした：{value}","host.basedOnYourLastSessions":"最近 {count} 回のセッションに基づく","host.estimatedFromSpendingOverThe":"過去 {SPEND_DAYS} 日間の利用料金から推定","host.patchMustIncludeFieldsOr":"patch には fields、colors、timeZones、customText のいずれかが必要です","host.timeZonesMustBeAnObject":"timeZones はオブジェクトである必要があります","host.timeZoneMustBeAValid":"有効な IANA タイムゾーンを指定してください：{key}","host.customTextMustBeAString":"カスタムテキストは文字列である必要があります","host.customTextTooLong":"カスタムテキストは64文字以内にしてください","host.quotaDisplayModeInvalid":"サブスクリプション期間の割合の表示方式は「used」または「remaining」である必要があります","host.infoDensityMustBeFullOrCompact":"情報表示は full または compact である必要があります","host.fieldsMustBeAnObject":"fields はオブジェクトである必要があります","host.unknownFieldId":"不明な項目 ID：{key}","host.fieldVisibilityMustBeA":"項目の表示設定は真偽値である必要があります：{key}","host.colorsMustBeAnObject":"colors はオブジェクトである必要があります","host.colorMustBeAPreset":"色はプリセット名または #RRGGBB で指定してください：{key}","field.anchorGroup.label":"プロバイダーとモデル","field.anchorGroup.note":"この会話で使用しているプロバイダーとモデルを表示します。","field.subServiceGroup.label":"サブスクリプションサービスとモデル","field.subServiceGroup.note":"サブスクリプションサービスと現在のモデルまたはプランを表示します。","field.billingServiceGroup.label":"請求サービスとモデル","field.billingServiceGroup.note":"請求サービスと現在のモデルを表示します。","field.customText.label":"カスタムテキスト","field.customText.note":"メモや署名としてカスタムテキストを表示します。","field.mainTime.label":"メイン時刻","field.mainTime.note":"メインタイムゾーンの時刻を表示します。タイムゾーンは「時刻と日付」で変更できます。","field.worldTime.label":"世界時刻","field.worldTime.note":"別のタイムゾーンの時刻を表示します。","field.sessionCost.label":"セッションの利用料金","field.sessionCost.note":"サブエージェントを含む、このセッションの実際の利用料金を表示します。","field.balance.note":"アカウント残高を表示します。残高が少なくなると赤で強調します。","field.period.label":"現在の料金時間帯","field.period.note":"ピーク／オフピーク料金のプロバイダーでは、現在どちらの時間帯かを表示します。","field.countdown.label":"次の料金切り替え","field.countdown.note":"次のピーク／オフピーク料金への切り替えまでの時間を表示します。","field.expiry.label":"サブスクリプションの有効期限","field.expiry.note":"プロバイダーから有効期限が返される場合に表示します。","field.subWindow5h.label":"5時間枠","field.subWindow5h.note":"直近5時間の利用枠の残りを表示します。","field.subWindowWeek.label":"週間枠","field.subWindowWeek.note":"週間利用枠の残りを表示します。","field.subWindowMonth.label":"月間枠","field.subWindowMonth.note":"月間利用枠の残りを表示します。","field.resetCountdown.label":"利用枠のリセット","field.resetCountdown.note":"現在の利用枠がリセットされるまでの時間を表示します。","field.subBalance.label":"利用可能残高またはクレジット","field.subBalance.note":"従量課金アカウントでは利用可能残高を表示します。期間枠が表示されないサブスクリプションでは、残りクレジットを表示します。","field.billingSpend.label":"月間使用量","field.billingSpend.note":"現在の請求期間の実際の使用量または利用料金を表示します。","field.budget.label":"予算状況","field.budget.note":"プロバイダーから予算の割合が返される場合に表示します。","field.freeQuota.label":"無料枠","field.freeQuota.note":"無料枠がある場合に、残量とリセット時刻を表示します。","field.turnsSteps.label":"ターン数とステップ数","field.turnsSteps.note":"このセッションのターン数とステップ数を表示します。","field.llmTime.label":"モデル処理時間","field.llmTime.note":"モデル推論の合計時間を表示します。","field.toolTime.label":"ツール処理時間","field.toolTime.note":"ツール実行の合計時間を表示します。","field.avgTTFT.label":"最初のトークンまでの平均時間","field.avgTTFT.note":"このセッションのモデル処理で、最初のトークンまでの平均時間を表示します。","field.outputSpeed.label":"出力速度","field.outputSpeed.note":"このセッションで使用量が報告されたモデル処理の平均出力速度（tok/s）を表示します。","field.cacheHit.note":"プロンプトキャッシュのヒット率を表示します。","field.tokensIO.label":"入力／出力トークン","field.tokensIO.note":"このセッションの入力／出力トークンの合計を表示します。","field.contextUsage.label":"コンテキスト使用量","field.contextUsage.note":"コンテキスト使用量を表示します。リングが埋まるほど、書き込める残りの領域が少なくなります。","ui.contextAria":"コンテキストの {percent} を使用済み","ui.contextUsed":"コンテキスト使用済み","ui.contextSystem":"システムプロンプト","ui.contextTools":"ツール定義","ui.contextMessages":"会話メッセージ","ui.contextFigures":"~{used} / {window}","number.thousand":"{value}K","number.million":"{value}M","field.unmapped.label":"アカウントデータの状態","field.unmapped.note":"プロバイダーが不明、または公開の残高・利用枠取得先がない場合に表示します。ローカルでの使用量記録は引き続き動作します。","field.noKeyHint.label":"キー未設定の案内","field.noKeyHint.note":"API キーが未設定の場合に、設定場所を案内します。","field.balanceError.label":"残高の更新エラー","field.balanceError.note":"残高の更新に失敗した場合に表示します。","field.usageError.label":"使用量の更新エラー","field.usageError.note":"利用料金を一時的に取得できない場合に表示します。","field.refreshFailure.label":"更新エラー","field.refreshFailure.note":"いずれかのデータ更新に失敗した場合に表示します。","field.persistWarning.label":"未保存の記録の警告","field.persistWarning.note":"請求記録を保存できない場合に表示します。有効にしておくことを推奨します。","field.updateNotice.label":"更新のお知らせ","field.updateNotice.note":"新しいバージョンが利用可能な場合や、ダウンロード済みのバージョンが再起動待ちの場合に短い印を表示します。","field.updateFailure.label":"更新失敗のお知らせ","field.updateFailure.note":"自動更新に失敗した場合に短い印を表示します。","group.native":"標準情報","group.plugin":"プラグイン情報","group.notice":"お知らせ","group.native.desc":"DSH のバーに元からある項目です。標準統計行にあり、完全表示モードでのみ表示されます。","group.plugin.desc":"このプラグインが追加する項目です。引き継いだコンテキストリングも含みます。メイン行にあり、両方のモードで表示されます。","group.notice.desc":"更新や失敗など、その時だけのお知らせです。伝えることがある場合はモードにかかわらず表示されます。","section.identity.label":"プロバイダーとモデル","section.identity.desc":"支払い方式にかかわらず、この会話で使用するサービスとモデルを表示します。","section.subscription.label":"サブスクリプション：月額プラン、利用枠付き","section.subscription.desc":"ChatGPT などのプランでは、以下の項目だけにデータが入ります：利用期間枠、枠のリセット、有効期限、利用可能残高。","section.balance.label":"プリペイド残高：チャージ後に利用分を差し引く","section.balance.desc":"この種類のプロバイダーでは、以下の項目だけにデータが入ります：残高、セッションの利用料金、現在の時間帯、次の料金切り替え。","section.billing.label":"後払い：利用後に月ごとに請求","section.billing.desc":"この種類のプロバイダーでは、以下の項目だけにデータが入ります：今月の使用量、予算、無料枠。","section.common.label":"共通項目","section.common.desc":"請求方式にかかわらず、どのプロバイダーでも使える項目です：カスタムテキスト、時計、コンテキスト使用量。","ui.listSeparator":"、","ui.sentenceEnd":"。","ui.fieldErrorPrefix":"「{label}」：","ui.turnCount":"{count} ターン","ui.turnCountPlural":"{count} ターン","ui.stepCount":"{count} ステップ","ui.stepCountPlural":"{count} ステップ","ui.mainTimeZone":"メインタイムゾーン","ui.worldTimeZone":"世界時刻のタイムゾーン","ui.customTextTitle":"カスタムテキスト","ui.customTextPlaceholder":"テキストを入力（64文字まで）","ui.searchPlaceholder":"名前または説明で検索…","ui.searchFieldsLabel":"表示内容を検索","ui.searchResultCount":"{count} 件見つかりました","ui.enabledFieldsCount":"{count} 件が有効","ui.noSearchResults":"一致する設定が見つかりません","ui.mainTime":"メイン時刻","ui.worldTime":"世界時刻","ui.customText":"カスタムテキスト","language.title":"言語","language.description":"DSH の言語に合わせるか、このブラウザーでプラグインの言語を個別に選びます。","language.auto":"DSH に合わせる","language.saveFailed":"言語設定を保存できませんでした。ローカルストレージを許可して再試行してください。"},"ko":{"meta.title":"하단 정보 표시줄","meta.description":"입력창 아래에 현재 모델, 잔액, 사용 금액을 표시합니다.","ui.requestTimedOut":"요청 시간이 초과되었습니다","ui.requestCanceled":"요청이 취소되었습니다","ui.couldNotParseResponse":"응답을 해석할 수 없습니다","ui.rpcFailed":"RPC가 실패했습니다","ui.refreshFailed":"새로 고침에 실패했습니다","color.red":"빨강","color.green":"초록","color.blue":"파랑","color.purple":"보라","color.orange":"주황","color.neutral":"중성","ui.pleaseTryAgainLater":"잠시 후 다시 시도하세요","ui.restoreDefaultColor":"기본 색상 복원","ui.infoBarSettings":"정보 표시줄","ui.settingsAreTemporarilyUnavailable":"설정을 일시적으로 사용할 수 없습니다","ui.loadingInfoBarSettings":"설정 불러오는 중…","ui.couldNotLoadInfoBar":"정보 표시줄 설정을 불러올 수 없습니다: ","ui.changesAppliedButCouldNot":"적용했지만 로컬에 저장할 수 없습니다: ","ui.unknownReason":"알 수 없는 이유","ui.couldNotSave":"{errorPrefix}저장할 수 없습니다: {value}","ui.color":"“{value}” 색상: ","ui.hasAnInvalidColorEnter":"“{value}”의 색상이 올바르지 않습니다. #RRGGBB 형식으로 입력하세요(예: #0044CC).","ui.defaultColorsRestored":"기본 색상을 복원했습니다","ui.defaultLabelsRestored":"기본 표시 설정을 복원했습니다","ui.couldNotReset":"초기화할 수 없습니다: {value}","ui.show":"{label} 표시","ui.clickToHide":"클릭하여 숨기기","ui.clickToShow":"클릭하여 표시","ui.presetColor":"{label} 기본 제공 색상","ui.customColor":"{label} 사용자 지정 색상","ui.customColorOpenColorPicker":"사용자 지정 색상(색상 선택기 열기)","ui.customColorItem":"사용자 지정…","ui.colorSwatchLabel":"{label} 색상","ui.hexColor":"{label} 16진수 색상","ui.expand":"펼치기","ui.collapse":"접기","ui.saving":"저장 중…","ui.processing":"처리 중…","ui.visibleFields":"표시할 정보","ui.timeDateTitle":"시간과 날짜","ui.timeDateDesc":"기본 시간과 세계 시간의 시간대입니다.","ui.customTextSectionDesc":"정보 표시줄에 사용자 지정 텍스트 한 줄을 표시합니다.","ui.resetConfirmTitle":"정보 표시줄 설정 초기화","ui.resetConfirmDescFields":"모든 표시 설정을 기본값으로 복원합니다. 사용자 지정 색상에는 영향을 주지 않으며 즉시 적용됩니다.","ui.resetConfirmDescColors":"모든 사용자 지정 색상을 지우고 기본 색상으로 복원합니다. 항목 표시 스위치에는 영향을 주지 않습니다. 정보 표시줄에 즉시 적용됩니다.","ui.resetConfirmAcknowledge":"이 초기화는 되돌릴 수 없음을 이해합니다","ui.resetConfirmCancel":"취소","ui.resetConfirmConfirm":"초기화","ui.resetLabels":"표시 설정 복원","ui.resetColors":"색상 복원","ui.resetRowTitle":"기본값으로 복원","ui.resetRowDesc":"표시 항목이나 색상을 기본값으로 복원합니다.","ui.customTextCount":"{value}/64자","ui.couldNotDisplayInfoBar":"정보 표시줄 설정을 표시할 수 없습니다: {value}","ui.dataAndBilling":"청구 데이터","ui.dataAndBillingDesc":"이 플러그인이 저장한 사용량과 사용 금액 기록을 내보내거나 지웁니다.","ui.exportBillingRecords":"청구 기록 내보내기","ui.exportBillingRecordsDesc":"기록을 CSV 또는 JSON 파일로 내보냅니다.","ui.exportBillingCsv":"CSV 내보내기","ui.exportBillingJson":"JSON 내보내기","ui.clearBillingRecords":"청구 기록 지우기","ui.clearBillingRecordsDesc":"이 작업은 되돌릴 수 없습니다.","ui.clearBillingRecordsConfirm":"이 플러그인이 저장한 모든 청구 기록을 지울까요? 먼저 내보내세요. 이 작업은 되돌릴 수 없지만 설정과 로그인 정보는 변경되지 않습니다.","ui.exportedBillingRecords":"청구 기록 {count}개를 내보냈습니다({format})","ui.noBillingRecordsToExport":"내보낼 청구 기록이 없습니다.","ui.exportFailed":"내보내기에 실패했습니다: {value}","ui.exportIncomplete":"일부 과거 청구 기록을 읽을 수 없습니다: {value}. 아무것도 내보내지 않았습니다. 잠시 후 다시 시도하세요.","ui.clearFailed":"청구 기록을 지울 수 없습니다: {value}","ui.clearFailedWithoutDetails":"청구 기록을 모두 지우지 못했습니다","ui.clearedBillingRecords":"청구 기록 {count}개를 지웠습니다","ui.clearCanceled":"취소되었습니다","ui.exportNotSupported":"이 환경에서는 파일 다운로드를 지원하지 않습니다.","ui.weekly":"주간","ui.monthly":"월간","ui.window":"기간","ui.quotaDisplayUsed":"사용량","ui.quotaDisplayRemaining":"잔여량","ui.quotaDisplayModeTitle":"구독 기간별 비율","ui.quotaDisplayModeDesc":"구독 한도를 잔여량 또는 사용량으로 표시합니다. 표시 방식과 관계없이 잔여량이 20% 미만이면 경고합니다.","ui.windowUsedRemaining":"{label} 한도: 사용 {usedPercent}%(잔여 {value}%)","ui.windowUsedRemainingResets":"{label} 한도: 사용 {usedPercent}%(잔여 {value}%) · 초기화 {value4}","ui.minimax":"MiniMax","ui.supportsImageInput":"이미지 입력을 지원합니다.","ui.vision":"이미지 인식","ui.unknown":"알 수 없음","ui.unknownModel":"알 수 없는 모델","ui.modelSelectionPending":"현재 모델 읽는 중","ui.modelCapabilityPending":"이미지 입력 지원 확인 중","ui.pluginVersion":"\n플러그인 버전: {current}","ui.provider":"제공업체: {provLabel} {modelLabel}\n","ui.pricingPeakOffPeakBeijing":"요금: 최대/비최대 시간대(베이징 시간; 평일 최대 시간대 09:00–12:00 및 14:00–18:00; 주말과 중국 공휴일은 비최대 시간대)","ui.pricingFixed":"요금: 고정","ui.pricingNotListedUsingDefaults":"요금: 등록되지 않아 사용 금액을 계산하지 않음","ui.zhipu":"Zhipu","ui.xiaomiMiMo":"Xiaomi MiMo","ui.commandCode":"Command Code","ui.subscription":"구독","ui.cloudBilling":"클라우드 청구","ui.plan":"\n요금제: {plan}","ui.expiresLocalTime":"\n만료: {value}(현지 시간)","ui.subscriptionServiceModel":"구독 서비스: {serviceName}\n모델: {rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.balanceLookupIsNotYet":"이 제공업체의 잔액은 아직 조회할 수 없습니다.","ui.notSupported":"지원하지 않음","ui.accountDataUnavailable":"공개 계정 데이터 없음","ui.accountDataUnavailableDetail":"이 제공업체의 모델 인식과 로컬 사용량 기록은 지원하지만, 플러그인이 안전하게 읽을 수 있는 공개 잔액 또는 한도 조회 경로가 없습니다.","ui.notConfigured":"설정되지 않음: ","ui.notConfiguredConfigureItIn":"{credName}이(가) 설정되지 않았습니다. 설정 → 모델에서 설정하세요.","ui.notConfiguredSettingsModels":"{credName}이(가) 설정되지 않았습니다. 설정 → 모델에서 추가하세요.","ui.accountSignedOut":"계정이 로그아웃됨","ui.accountSignedOutHow":"DSH 설정 → 계정에서 DeepSeek 계정에 로그인하면 여기에 잔액이 표시됩니다.","ui.estimatedBalance":"예상 잔액: {symbol}{value}","ui.balance":"잔액: {symbol}{value}","ui.balanceDetailToppedUp":"충전 잔액: {symbol}{value}","ui.balanceDetailGranted":"지급 잔액: {symbol}{value}","ui.balance.pushBalanceGroups":"잔액","ui.low":"낮음","ui.estimated":"(예상)","ui.balanceIsTemporarilyUnavailableShowing":"잔액을 일시적으로 조회할 수 없습니다. 이전 데이터를 표시하고 자동으로 다시 시도합니다.","ui.couldNotLoadBalanceCheck":"잔액을 불러올 수 없습니다. 연결과 API 키를 확인하세요.","ui.balanceUnavailable":"잔액 조회 불가","ui.beijingTime":"베이징 시간: ","ui.peakPrice":"최대 시간대 요금","ui.offPeakPrice":"비최대 시간대 요금","ui.input":": 입력 ¥","ui.mCachedInput":"/M · 캐시된 입력 ¥","ui.mOutput":"/M · 출력 ¥","ui.beijingTimeSwitchesTo":"베이징 시간: {atLabel}에 다음으로 전환: ","ui.until":"전환까지 ","ui.offPeak":"비최대 시간대","ui.peak":"최대 시간대","ui.today":"오늘 {symbol}{value}","ui.lastDays":"최근 30일 {symbol}{value}","ui.allTime":"전체 기간 {symbol}{value}","ui.sessionIncludingSubagents":"이 세션 {costTxt}(하위 에이전트 포함){value}","ui.session":"세션","ui.spendIsTemporarilyUnavailableChat":"사용 금액을 일시적으로 조회할 수 없습니다. 채팅에는 영향이 없습니다.","ui.spendUnavailable":"사용 금액 조회 불가","ui.noSignInCredentialsFound":"{serviceName}의 로그인 정보를 찾지 못했습니다. 다시 인증하세요.","ui.credentialsHaveExpiredPleaseReauthorize":"{serviceName}의 인증 정보가 만료되었습니다. 다시 인증하세요.","ui.deniedAccessReauthorizeOrTry":"{serviceName}에서 접근을 거부했습니다. 다시 인증하거나 잠시 후 다시 시도하세요.","ui.rateLimitReachedPleaseTry":"{serviceName}의 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.","ui.timedOutCheckYourConnection":"{serviceName}의 응답 시간이 초과되었습니다. 연결을 확인하고 다시 시도하세요.","ui.returnedAnUnrecognizedResponsePlease":"{serviceName}에서 인식할 수 없는 응답을 반환했습니다. 잠시 후 다시 시도하세요.","ui.isTemporarilyUnavailableCheckYour":"{serviceName}을(를) 일시적으로 사용할 수 없습니다. 연결을 확인하고 다시 시도하세요.","ui.subscriptionExpiresLocalTime":"구독 만료: {value}(현지 시간)","ui.expires":"만료","ui.subscriptionSource":"구독 출처: {value}(","ui.prepaidBalance":"사용 가능 잔액","ui.availableBalanceLabel":"사용 가능 잔액","ui.remainingCredits":"잔여 크레딧","ui.availableBalance":"사용 가능 잔액: {balTxt}","ui.availableCredits":"잔여 크레딧: {value}","ui.subscriptionSource.titleLines":"구독 출처: {value}","ui.windowRemainingUsed":"{label} 한도: 잔여 {value}%(사용 {usedPercent}%)","ui.resetsResetsIn":" · 초기화 {value} · 초기화까지 {value2}","ui.windowRemainingUsedResets":"{label} 한도: 잔여 {value}%(사용 {usedPercent}%) · 초기화 {value4}","ui.resetsIn":"초기화까지","ui.configureItInSettingsModels":". 설정 → 모델에서 설정하세요.","ui.deniedAccessTheTokenMay":"{serviceName}에서 접근을 거부했습니다. 토큰에 청구 데이터 읽기 권한이 없을 수 있습니다.","ui.billingIsTemporarilyUnavailableCheck":"{serviceName}의 청구 데이터를 일시적으로 조회할 수 없습니다. 연결과 권한을 확인하고 다시 시도하세요.","ui.billingSource":"청구 출처: {value}","ui.thisMonthSSpend":"이번 달 사용 금액: {symbol}{value}","ui.budgetUsed":"예산 사용률: {value}%","ui.dailyFreeQuotaRemaining":"일일 무료 한도 잔여량: {value}","ui.thisMonth":"이번 달","ui.thisMonthSUsage":"이번 달 사용량","ui.budget":"예산","ui.free":"무료","ui.resetsIn.pushBillingGroups":"{value} · 초기화까지 {value2}","ui.billingServiceModel":"청구 서비스: {serviceName}\n모델: {modelLabel}{versionLine}","ui.pricing":"요금","ui.spend":"사용 금액","ui.mode":"모드","ui.subscriptionQuota":"구독 한도","ui.billing":"청구","ui.temporarilyUnavailableKeepingTheLast":": 일시적으로 조회할 수 없습니다. 이전 데이터를 유지하고 자동으로 다시 시도합니다.","ui.spendJournalSavedButThe":"사용 금액 로그는 저장했지만 조회용 장부가 아직 갱신되지 않았습니다: ","ui.thisSpendRecordWasNot":"이 사용 금액 기록은 저장되지 않았으며 합계에 추가되지 않습니다: ","ui.ledgerUpdatePending":"장부 갱신 대기 중","ui.spendNotSaved":"사용 금액이 저장되지 않음","ui.versionAndUpdateTitle":"버전과 업데이트","ui.versionAndUpdateDesc":"업데이트는 플러그인 자체 파일만 교체합니다. 청구 기록과 설정은 변경하지 않습니다.","ui.versionUnavailable":"현재 실행 중인 DSH가 이 버전의 플러그인을 아직 불러오지 않아 여기에는 이 줄만 표시됩니다. DSH를 다시 시작하면 실행 중인 버전, 업데이트 방식, 확인 버튼이 표시됩니다.","ui.versionRunning":"실행 중인 버전 {version}","ui.versionLatest":"최신 버전 {version}","ui.versionLastCheck":"마지막 확인 {time}","ui.versionUnknown":"알 수 없음","ui.timeJustNow":"방금","ui.timeMinutesAgo":"{n}분 전","ui.timeHoursAgo":"{n}시간 전","ui.timeDaysAgo":"{n}일 전","ui.autoUpdateTitle":"업데이트 방식","ui.updateModeAutoDesc":"DSH 시작 시 확인하고 설치합니다. 사용 중 수동 확인으로 발견한 업데이트는 설치 전에 확인을 요청합니다.","ui.updateModeManualDesc":"시작 시 설치하지 않습니다. 사용 중 수동 확인으로 발견한 업데이트는 설치 전에 확인을 요청합니다.","ui.updateModeAuto":"자동 업데이트","ui.updateModeManual":"수동 업데이트","ui.updateConfirm":"버전 {version}을(를) 사용할 수 있습니다. 지금 플러그인을 업데이트할까요? 적용하려면 DSH를 다시 시작하세요.","ui.updateCheckNow":"지금 확인","ui.updateChecking":"확인 중…","ui.updateInstallNow":"{version}(으)로 업데이트","ui.updateInstalling":"{version}(으)로 업데이트 중…","ui.updateAvailableNow":"버전 {version}이(가) 준비되어 지금 업데이트할 수 있습니다.","ui.updateRollbackFailed":"사용 가능한 백업이 없어 이전 버전으로 복원하지 못했습니다. 플러그인 페이지에서 제거한 다음 다시 설치하세요.","ui.updateHostOutdated":"이 작업을 실행하지 않았습니다. 실행 중인 DSH에 이전 업데이트 처리가 남아 있습니다. DSH를 다시 시작하면 버튼이 작동합니다.","ui.updateUpToDate":"최신 버전입니다.","ui.updateDisabled":"이 환경에서는 자동 업데이트를 사용할 수 없습니다","ui.updateDisabledWhy":"자동 업데이트는 DSH 플러그인 디렉터리에 설치해야 사용할 수 있습니다. 이 복사본은 소스 코드나 링크로 설치되었으므로 원래 업데이트 명령을 사용하세요.","ui.updatePendingRestart":"{version}(으)로 업데이트했습니다. 활성화하려면 DSH를 다시 시작하세요.","ui.updateFailed":"지난 업데이트에 실패했습니다","ui.updateFallbackWhy":"새 버전에 문제가 생기면 이전 버전으로 돌아갈 수 있습니다.","ui.updateHoldWhy":"이 버전의 업데이트를 보류했으므로 자동으로 설치되지 않습니다.","ui.updateErrorIncompleteDownload":"다운로드가 완료되지 않았습니다(연결이 끊김). 이번 업데이트를 중단했으며 현재 버전은 변경하지 않았습니다.","ui.updateErrorIntegrityMismatch":"업데이트 패키지가 안전 검사를 통과하지 못해 중단했습니다. 현재 버전은 변경하지 않았습니다.","ui.updateErrorDownloadFailed":"업데이트 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.","ui.updateErrorTooLarge":"업데이트 패키지가 비정상적으로 커서 중단했습니다.","ui.updateErrorPayloadMismatch":"업데이트 패키지와 버전 번호가 일치하지 않아 중단했습니다.","ui.updateErrorPayloadUnsafe":"업데이트 패키지에 예상하지 못한 파일 경로가 포함되어 중단했습니다.","ui.updateErrorCheckFailed":"버전 확인에 실패했습니다. 네트워크 문제일 수 있습니다.","ui.updateErrorUnknown":"업데이트에 실패했습니다. 자세한 내용은 업데이트 로그에 있습니다.","ui.updateRollback":"이전 버전으로 복원","ui.updateRolledBack":"이전 버전 {version}(으)로 복원했습니다.","ui.updateHeld":"버전 {version}은(는) 보류 중이므로 자동으로 설치되지 않습니다.","ui.updateAllowHeld":"{version}(으)로 업데이트 허용","ui.updateRestartBadge":"다시 시작하여 적용","ui.updateFailedBadge":"업데이트 실패","ui.tools":"도구","ui.avgTTFT":"평균 TTFT","ui.cacheHit":"캐시 적중","ui.cacheHitScope":"토큰 기준: 적중 {hit} / 미적중 {miss}(적중률 {percent}%).\n범위: 이 세션의 기본 Agent만 포함하며 하위 에이전트는 제외합니다.","ui.tokenScope":"입력/출력은 이 세션의 기본 Agent만 누적합니다(하위 에이전트 제외). 세션 비용에는 하위 에이전트가 포함됩니다.","ui.spendPartlyUnpriced":"일부 호출에는 등록된 요금이 없습니다(다른 모델 요금으로 대체하지 않음). 실제 비용은 표시된 금액보다 높습니다.","ui.input.BottomInfoBar":"입력","ui.output":"출력","ui.savingView":"표시 설정 저장 중…","ui.clickToSwitchFullCompact":"클릭하여 전체/간략 보기 전환","ui.pressEnterOrSpaceFor":"Enter 또는 Space를 눌러 간략 보기로 전환하세요.","ui.pressEnterOrSpaceFor.BottomInfoBar":"Enter 또는 Space를 눌러 전체 보기로 전환하세요.","host.hour":"5시간","host.unknownProvider":"알 수 없는 제공업체","error.subscription.request-failed":"구독 한도 요청 중 예기치 않은 오류가 발생했습니다","host.settingsFileCouldNotBe":"설정 파일을 저장할 수 없습니다","error.settings.save-failed":"settings.json을 저장할 수 없습니다: {value}","error.balance.credentials":"인증 정보를 읽을 수 없습니다","error.balance.not-configured":"설정되지 않음: {credential}","error.balance.account-signed-out":"내장 계정이 로그아웃되었습니다","error.balance.account-unavailable":"이 호스트에는 내장 계정 서비스가 없습니다","error.balance.account-request-failed":"내장 계정의 잔액을 조회할 수 없습니다","error.request.http":"요청에 실패했습니다: HTTP {status}.","error.request.parse":"예상하지 못한 응답 형식","error.subscription.not-connected":"ChatGPT 구독이 연결되지 않았습니다. ~/.codex/auth.json에서 인증 정보를 찾지 못했습니다. dsh-chatgpt-sub를 설치하고 로그인하세요.","error.subscription.credentials-missing":"ChatGPT 구독 인증 정보에 id_token이 없습니다. dsh-chatgpt-sub를 설치하고 다시 인증하세요.","error.subscription.opencode-not-configured":"OpenCode Go가 설정되지 않았습니다. OPENCODE_GO_API_KEY를 설정하거나 opencode auth.json을 사용하세요.","error.subscription.commandcode-not-configured":"Command Code가 설정되지 않았습니다. COMMAND_CODE_API_KEY, CMD_API_KEY를 설정하거나 Command Code CLI로 로그인하세요.","error.subscription.commandcode-auth-failed":"Command Code에서 인증 정보를 거부했습니다. 다시 로그인하거나 API 키를 갱신하세요.","error.subscription.commandcode-unrecognized":"Command Code에서 인식할 수 없는 한도 형식을 반환했습니다. 이전 데이터를 유지합니다.","host.zhipu":"Zhipu {mapped}","host.zhipu.parseZaiQuota":"Zhipu {value}{value2}","error.subscription.zhipu-not-configured":"Zhipu API 키가 설정되지 않았습니다. ZAI_API_KEY 또는 ZAI_CODING_CN_API_KEY를 설정하세요.","error.subscription.zhipu-auth-failed":"Zhipu API 인증에 실패했습니다. 키가 만료되었거나 유효하지 않습니다.","error.subscription.zhipu-unrecognized":"Zhipu에서 인식할 수 없는 한도 형식을 반환했습니다(API가 변경되었을 수 있음). 마지막으로 확인된 데이터를 유지합니다.","error.request.failed":"요청에 실패했습니다: {value} {msg}.","error.subscription.xiaomi-not-configured":"Xiaomi MiMo Token Plan 인증 정보가 설정되지 않았습니다: {credName} 또는 XIAOMI_API_KEY.","error.subscription.xiaomi-http":"요청에 실패했습니다: HTTP {value}.","error.subscription.minimax-not-configured":"MiniMax가 설정되지 않았습니다. MINIMAX_API_KEY 또는 MINIMAX_CN_API_KEY를 설정하세요. Token Plan 조회에는 Subscription Key가 필요하며, 종량제 API 키는 서버에서 거부됩니다.","error.subscription.minimax-auth-failed":"MiniMax에서 API 키를 거부했습니다. Token Plan 조회에는 Subscription Key(Token Plan 구독 페이지에서 생성)가 필요합니다. 종량제 키는 거부됩니다(status_code=1004 / HTTP 401).","error.subscription.minimax-unrecognized":"MiniMax에서 인식할 수 없는 한도 형식을 반환했습니다(API가 변경되었을 수 있음). 마지막으로 확인된 데이터를 유지합니다.","error.billing.together-not-configured":"설정되지 않음: TOGETHER_API_KEY","host.actualMonthlyBillFromThe":"Together Usage API의 이번 달 실제 청구액","error.billing.fireworks-not-configured":"설정되지 않음: FIREWORKS_API_KEY","error.billing.fireworks-account":"계정을 읽을 수 없습니다(account_id 없음)","host.actualBillForThisPeriod":"이번 기간의 실제 청구액(Fireworks Billing Summary)","host.actualUsageForThisPeriod":"이번 기간의 실제 사용량(billingUsage 대체 경로, 사용 금액 없음)","error.billing.aws-not-configured":"설정되지 않음: AWS 인증 정보(AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)","error.billing.aws-http":"요청에 실패했습니다: HTTP {status}. 토큰에 ce:GetCostAndUsage 권한이 없을 수 있습니다","host.actualMonthlyBillFromAWS":"AWS Cost Explorer의 이번 달 실제 청구액(약 24시간 지연)","error.billing.cloudflare-not-configured":"설정되지 않음: CLOUDFLARE_API_KEY(Billing 읽기 권한이 있는 계정 수준 토큰 필요)","error.billing.cloudflare-account":"설정되지 않음: CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"요청에 실패했습니다: HTTP {status}. 토큰에 Billing 읽기 권한이 필요합니다","host.actualMonthlyUsageFromThe":"Cloudflare Billable Usage API(Alpha)의 이번 달 실제 사용량","error.billing.huggingface-not-configured":"설정되지 않음: HF_TOKEN(세분화된 토큰에는 Billing 읽기 권한 필요)","host.actualMonthlyBillFromHF":"Hugging Face Billing API의 이번 달 실제 청구액","error.billing.request-failed":"청구 요청 중 예기치 않은 오류가 발생했습니다","host.spendSummaryFileMissingArchived":"사용 금액 요약 파일이 없습니다. 보관된 금액은 표시 합계에 포함되지 않습니다. 상세 기록은 usage-archive/에 남아 있어 수동 복원이 가능합니다.","host.spendLedgerCouldNotBe":"사용 금액 장부를 저장할 수 없습니다","host.usageLedgerBusy":"응답이 아직 진행 중입니다. 완료 후 청구 기록을 지우세요.","error.ledger.clear-failed":"청구 기록을 모두 지울 수 없습니다: {value}","error.ledger.snapshot-stale":"보관된 사용 금액 요약을 저장할 수 없습니다: {value}","host.basedOnYourLastSessions":"최근 {count}개 세션 기준","host.estimatedFromSpendingOverThe":"지난 {SPEND_DAYS}일간 사용 금액으로 추정","host.patchMustIncludeFieldsOr":"patch에는 fields, colors, timeZones 또는 customText가 포함되어야 합니다","host.timeZonesMustBeAnObject":"timeZones는 객체여야 합니다","host.timeZoneMustBeAValid":"시간대는 유효한 IANA 시간대여야 합니다: {key}","host.customTextMustBeAString":"사용자 지정 텍스트는 문자열이어야 합니다","host.customTextTooLong":"사용자 지정 텍스트는 64자를 초과할 수 없습니다","host.quotaDisplayModeInvalid":"구독 기간별 비율 모드는 “used” 또는 “remaining”이어야 합니다","host.infoDensityMustBeFullOrCompact":"정보 표시 방식은 full 또는 compact여야 합니다","host.fieldsMustBeAnObject":"fields는 객체여야 합니다","host.unknownFieldId":"알 수 없는 항목 ID: {key}","host.fieldVisibilityMustBeA":"항목 표시 여부는 불리언 값이어야 합니다: {key}","host.colorsMustBeAnObject":"colors는 객체여야 합니다","host.colorMustBeAPreset":"색상은 기본 제공 색상 이름 또는 #RRGGBB여야 합니다: {key}","field.anchorGroup.label":"제공업체와 모델","field.anchorGroup.note":"이 대화에서 사용하는 제공업체와 모델을 표시합니다.","field.subServiceGroup.label":"구독 서비스와 모델","field.subServiceGroup.note":"구독 서비스와 현재 모델 또는 요금제를 표시합니다.","field.billingServiceGroup.label":"청구 서비스와 모델","field.billingServiceGroup.note":"청구 서비스와 현재 모델을 표시합니다.","field.customText.label":"사용자 지정 텍스트","field.customText.note":"메모나 서명용 사용자 지정 텍스트를 표시합니다.","field.mainTime.label":"기본 시간","field.mainTime.note":"기본 시간대의 시간을 표시합니다. 시간대는 시간과 날짜에서 변경하세요.","field.worldTime.label":"세계 시간","field.worldTime.note":"다른 시간대의 시간을 표시합니다.","field.sessionCost.label":"세션 사용 금액","field.sessionCost.note":"하위 에이전트를 포함한 이 세션의 실제 사용 금액을 표시합니다.","field.balance.note":"계정 잔액을 표시합니다. 잔액이 낮으면 빨간색으로 강조합니다.","field.period.label":"현재 요금 시간대","field.period.note":"최대/비최대 시간대 요금을 적용하는 제공업체의 현재 시간대를 표시합니다.","field.countdown.label":"다음 요금 변경","field.countdown.note":"다음 최대/비최대 시간대 요금 변경까지 남은 시간을 표시합니다.","field.expiry.label":"구독 만료일","field.expiry.note":"제공업체가 만료일을 반환하면 표시합니다.","field.subWindow5h.label":"5시간 한도","field.subWindow5h.note":"최근 5시간 기준 한도의 잔여량을 표시합니다.","field.subWindowWeek.label":"주간 한도","field.subWindowWeek.note":"주간 한도의 잔여량을 표시합니다.","field.subWindowMonth.label":"월간 한도","field.subWindowMonth.note":"월간 한도의 잔여량을 표시합니다.","field.resetCountdown.label":"한도 초기화","field.resetCountdown.note":"현재 한도가 초기화될 때까지 남은 시간을 표시합니다.","field.subBalance.label":"사용 가능 잔액 또는 크레딧","field.subBalance.note":"종량제 계정의 사용 가능 잔액을 표시합니다. 표시할 기간별 한도가 없는 구독은 잔여 크레딧을 표시합니다.","field.billingSpend.label":"월간 사용량","field.billingSpend.note":"현재 청구 기간의 실제 사용량 또는 사용 금액을 표시합니다.","field.budget.label":"예산 상태","field.budget.note":"제공업체가 예산 비율을 알려 주면 표시합니다.","field.freeQuota.label":"무료 한도","field.freeQuota.note":"무료 한도가 있으면 잔여량과 초기화 시간을 표시합니다.","field.turnsSteps.label":"턴과 단계","field.turnsSteps.note":"이 세션의 턴 수와 단계 수를 표시합니다.","field.llmTime.label":"모델 처리 시간","field.llmTime.note":"모델 추론의 총 시간을 표시합니다.","field.toolTime.label":"도구 처리 시간","field.toolTime.note":"도구 실행의 총 시간을 표시합니다.","field.avgTTFT.label":"첫 토큰까지 평균 시간","field.avgTTFT.note":"이 세션의 모델 단계에서 첫 토큰까지 걸리는 평균 시간을 표시합니다.","field.outputSpeed.label":"출력 속도","field.outputSpeed.note":"이 세션에서 사용량을 보고한 모델 단계의 평균 출력 속도(tok/s)를 표시합니다.","field.cacheHit.note":"프롬프트 캐시 적중률을 표시합니다.","field.tokensIO.label":"입력/출력 토큰","field.tokensIO.note":"이 세션의 총 입력/출력 토큰을 표시합니다.","field.contextUsage.label":"컨텍스트 사용량","field.contextUsage.note":"컨텍스트 사용량을 표시합니다. 원이 가득 찰수록 남은 입력 공간이 적습니다.","ui.contextAria":"컨텍스트 {percent} 사용됨","ui.contextUsed":"사용한 컨텍스트","ui.contextSystem":"시스템 프롬프트","ui.contextTools":"도구 정의","ui.contextMessages":"대화 메시지","ui.contextFigures":"~{used} / {window}","number.thousand":"{value}K","number.million":"{value}M","field.unmapped.label":"계정 데이터 상태","field.unmapped.note":"제공업체가 알려져 있지 않거나 공개 잔액/한도 조회 경로가 없으면 표시합니다. 로컬 사용량 기록은 계속 작동합니다.","field.noKeyHint.label":"키 누락 안내","field.noKeyHint.note":"API 키가 없으면 입력할 위치를 안내합니다.","field.balanceError.label":"잔액 갱신 오류","field.balanceError.note":"잔액 갱신에 실패하면 표시합니다.","field.usageError.label":"사용량 갱신 오류","field.usageError.note":"사용 금액을 일시적으로 조회할 수 없으면 표시합니다.","field.refreshFailure.label":"갱신 오류","field.refreshFailure.note":"데이터 새로 고침이 하나라도 실패하면 표시합니다.","field.persistWarning.label":"기록 저장 실패 알림","field.persistWarning.note":"청구 기록을 저장할 수 없으면 표시합니다. 사용을 권장합니다.","field.updateNotice.label":"업데이트 알림","field.updateNotice.note":"새 버전이 준비되었거나 다운로드된 버전이 다시 시작을 기다릴 때 짧은 표시를 보여 줍니다.","field.updateFailure.label":"업데이트 실패 알림","field.updateFailure.note":"자동 업데이트가 실패하면 짧은 표시를 보여 줍니다.","group.native":"기본 정보","group.plugin":"플러그인 정보","group.notice":"알림","group.native.desc":"DSH 표시줄에 원래 있던 항목입니다. 기본 통계 행에 있으며 전체 모드에서만 표시합니다.","group.plugin.desc":"이 플러그인이 추가한 항목입니다. 이어받은 컨텍스트 원도 포함합니다. 기본 행에 있으며 두 모드 모두 표시합니다.","group.notice.desc":"업데이트와 오류 같은 일시적 알림입니다. 실제로 알릴 내용이 있으면 모드와 관계없이 표시합니다.","section.identity.label":"제공업체와 모델","section.identity.desc":"결제 방식과 관계없이 이 대화에서 사용하는 서비스와 모델을 표시합니다.","section.subscription.label":"구독: 한도가 포함된 월간 요금제","section.subscription.desc":"ChatGPT 같은 요금제에는 다음 항목만 채워집니다: 기간별 한도, 한도 초기화, 만료일, 사용 가능 잔액.","section.balance.label":"선불 잔액: 충전 후 사용량만큼 차감","section.balance.desc":"이 제공업체 유형에는 다음 항목만 채워집니다: 잔액, 세션 사용 금액, 현재 요금 시간대, 다음 요금 변경.","section.billing.label":"후불 사용량: 사용 후 월별 청구","section.billing.desc":"이 제공업체 유형에는 다음 항목만 채워집니다: 이번 달 사용량, 예산, 무료 한도.","section.common.label":"공통 항목","section.common.desc":"청구 방식과 관계없이 모든 제공업체에서 사용합니다: 사용자 지정 텍스트, 시계, 컨텍스트 사용량.","ui.listSeparator":", ","ui.sentenceEnd":".","ui.fieldErrorPrefix":"“{label}”: ","ui.turnCount":"{count}턴","ui.turnCountPlural":"{count}턴","ui.stepCount":"{count}단계","ui.stepCountPlural":"{count}단계","ui.mainTimeZone":"기본 시간대","ui.worldTimeZone":"세계 시간대","ui.customTextTitle":"사용자 지정 텍스트","ui.customTextPlaceholder":"텍스트 입력(최대 64자)","ui.searchPlaceholder":"이름이나 설명으로 검색…","ui.searchFieldsLabel":"표시 내용 검색","ui.searchResultCount":"{count}개 찾음","ui.enabledFieldsCount":"{count}개 사용 중","ui.noSearchResults":"일치하는 설정이 없습니다","ui.mainTime":"기본 시간","ui.worldTime":"세계 시간","ui.customText":"사용자 지정 텍스트","language.title":"언어","language.description":"DSH 언어를 따르거나 이 브라우저에서 플러그인 언어를 별도로 선택하세요.","language.auto":"DSH 따르기","language.saveFailed":"언어 설정을 저장할 수 없습니다. 로컬 저장소를 허용하고 다시 시도하세요."},"es":{"meta.title":"Barra de información inferior","meta.description":"Muestra el modelo actual, el saldo y el gasto debajo del cuadro de mensaje.","ui.requestTimedOut":"Se agotó el tiempo de la solicitud","ui.requestCanceled":"Solicitud cancelada","ui.couldNotParseResponse":"No se pudo interpretar la respuesta","ui.rpcFailed":"Falló RPC","ui.refreshFailed":"Error al actualizar","color.red":"Rojo","color.green":"Verde","color.blue":"Azul","color.purple":"Morado","color.orange":"Naranja","color.neutral":"Neutro","ui.pleaseTryAgainLater":"Inténtalo de nuevo más tarde","ui.restoreDefaultColor":"Restaurar color predeterminado","ui.infoBarSettings":"Barra de información","ui.settingsAreTemporarilyUnavailable":"Los ajustes no están disponibles temporalmente","ui.loadingInfoBarSettings":"Cargando ajustes…","ui.couldNotLoadInfoBar":"No se pudieron cargar los ajustes de la barra: ","ui.changesAppliedButCouldNot":"Aplicado, pero no se pudo guardar localmente: ","ui.unknownReason":"Motivo desconocido","ui.couldNotSave":"{errorPrefix}No se pudo guardar: {value}","ui.color":"Color de «{value}»: ","ui.hasAnInvalidColorEnter":"«{value}» tiene un color no válido. Introduce #RRGGBB (por ejemplo, #0044CC).","ui.defaultColorsRestored":"Colores predeterminados restaurados","ui.defaultLabelsRestored":"Visualización predeterminada restaurada","ui.couldNotReset":"No se pudo restablecer: {value}","ui.show":"Mostrar {label}","ui.clickToHide":"Haz clic para ocultar","ui.clickToShow":"Haz clic para mostrar","ui.presetColor":"Color predefinido de {label}","ui.customColor":"Color personalizado de {label}","ui.customColorOpenColorPicker":"Color personalizado (abrir selector)","ui.customColorItem":"Personalizado…","ui.colorSwatchLabel":"Color de {label}","ui.hexColor":"Color hexadecimal de {label}","ui.expand":"Expandir","ui.collapse":"Contraer","ui.saving":"Guardando…","ui.processing":"Procesando…","ui.visibleFields":"Información que mostrar","ui.timeDateTitle":"Hora y fecha","ui.timeDateDesc":"Zonas horarias de la hora principal y mundial.","ui.customTextSectionDesc":"Muestra una línea de texto personalizado en la barra.","ui.resetConfirmTitle":"Restablecer ajustes de la barra","ui.resetConfirmDescFields":"Restaura todas las opciones de visualización a sus valores predeterminados. No afecta a los colores personalizados y se aplica de inmediato.","ui.resetConfirmDescColors":"Se borrarán todos los colores personalizados y se restaurarán los predeterminados. No afecta a los interruptores de los campos. Se aplica de inmediato a la barra.","ui.resetConfirmAcknowledge":"Entiendo que este restablecimiento no se puede deshacer","ui.resetConfirmCancel":"Cancelar","ui.resetConfirmConfirm":"Restablecer","ui.resetLabels":"Restaurar visualización","ui.resetColors":"Restaurar colores","ui.resetRowTitle":"Restaurar valores predeterminados","ui.resetRowDesc":"Restaura los elementos mostrados o los colores a sus valores predeterminados.","ui.customTextCount":"{value}/64 caracteres","ui.couldNotDisplayInfoBar":"No se pudieron mostrar los ajustes de la barra: {value}","ui.dataAndBilling":"Datos de facturación","ui.dataAndBillingDesc":"Exporta o borra los registros de uso y gasto guardados por este plugin.","ui.exportBillingRecords":"Exportar facturación","ui.exportBillingRecordsDesc":"Exporta los registros como archivo CSV o JSON.","ui.exportBillingCsv":"Exportar CSV","ui.exportBillingJson":"Exportar JSON","ui.clearBillingRecords":"Borrar facturación","ui.clearBillingRecordsDesc":"Esta acción no se puede deshacer.","ui.clearBillingRecordsConfirm":"¿Borrar todos los registros de facturación guardados por este plugin? Expórtalos primero. No se puede deshacer, pero los ajustes y la información de inicio de sesión se conservarán.","ui.exportedBillingRecords":"Se exportaron {count} registros de facturación ({format})","ui.noBillingRecordsToExport":"No hay registros de facturación que exportar.","ui.exportFailed":"Error al exportar: {value}","ui.exportIncomplete":"No se pudieron leer algunos registros históricos: {value}. No se exportó nada; inténtalo más tarde.","ui.clearFailed":"No se pudieron borrar los registros: {value}","ui.clearFailedWithoutDetails":"No se pudieron borrar por completo los registros de facturación","ui.clearedBillingRecords":"Se borraron {count} registros de facturación","ui.clearCanceled":"Cancelado","ui.exportNotSupported":"Este entorno no permite descargar archivos.","ui.weekly":"Semanal","ui.monthly":"Mensual","ui.window":"Período","ui.quotaDisplayUsed":"Usado","ui.quotaDisplayRemaining":"Restante","ui.quotaDisplayModeTitle":"Porcentaje del período de suscripción","ui.quotaDisplayModeDesc":"Muestra las cuotas de suscripción como restantes o usadas. La advertencia de cuota baja siempre aparece cuando queda menos del 20 %.","ui.windowUsedRemaining":"Período {label}: usado {usedPercent}% (restante {value}%)","ui.windowUsedRemainingResets":"Período {label}: usado {usedPercent}% (restante {value}%) · Se restablece {value4}","ui.minimax":"MiniMax","ui.supportsImageInput":"Admite entrada de imágenes.","ui.vision":"Visión","ui.unknown":"Desconocido","ui.unknownModel":"Modelo desconocido","ui.modelSelectionPending":"Leyendo el modelo actual","ui.modelCapabilityPending":"Comprobando la entrada de imágenes","ui.pluginVersion":"\nVersión del plugin: {current}","ui.provider":"Proveedor: {provLabel} {modelLabel}\n","ui.pricingPeakOffPeakBeijing":"Tarifas: horas punta/valle (hora de Pekín; punta laborable 09:00-12:00 y 14:00-18:00; fines de semana y festivos chinos: valle)","ui.pricingFixed":"Tarifas: fijas","ui.pricingNotListedUsingDefaults":"Tarifas: no publicadas; no se calcula el gasto","ui.zhipu":"Zhipu","ui.xiaomiMiMo":"Xiaomi MiMo","ui.commandCode":"Command Code","ui.subscription":"Suscripción","ui.cloudBilling":"Facturación en la nube","ui.plan":"\nPlan: {plan}","ui.expiresLocalTime":"\nCaduca: {value} (hora local)","ui.subscriptionServiceModel":"Servicio de suscripción: {serviceName}\nModelo: {rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.balanceLookupIsNotYet":"El saldo de este proveedor aún no está disponible.","ui.notSupported":"No compatible","ui.accountDataUnavailable":"Sin datos públicos de cuenta","ui.accountDataUnavailableDetail":"Este proveedor admite el reconocimiento de modelos y el registro local de uso, pero no ofrece una interfaz pública de saldo o cuota que el plugin pueda consultar de forma segura.","ui.notConfigured":"Sin configurar: ","ui.notConfiguredConfigureItIn":"Sin configurar: {credName}. Configúralo en Ajustes → Modelos.","ui.notConfiguredSettingsModels":"{credName} no está configurado. Añádelo en Ajustes → Modelos.","ui.accountSignedOut":"Sesión de la cuenta cerrada","ui.accountSignedOutHow":"Inicia sesión en tu cuenta de DeepSeek en Ajustes → Cuenta de DSH y el saldo aparecerá aquí.","ui.estimatedBalance":"Saldo estimado: {symbol}{value}","ui.balance":"Saldo: {symbol}{value}","ui.balanceDetailToppedUp":"Saldo recargado: {symbol}{value}","ui.balanceDetailGranted":"Saldo concedido: {symbol}{value}","ui.balance.pushBalanceGroups":"Saldo","ui.low":"Bajo","ui.estimated":"(estimado)","ui.balanceIsTemporarilyUnavailableShowing":"El saldo no está disponible temporalmente. Se muestran los últimos datos y se reintenta automáticamente.","ui.couldNotLoadBalanceCheck":"No se pudo cargar el saldo. Comprueba la conexión y la clave API.","ui.balanceUnavailable":"Saldo no disponible","ui.beijingTime":"Hora de Pekín: ","ui.peakPrice":"Tarifa punta","ui.offPeakPrice":"Tarifa valle","ui.input":": entrada ¥","ui.mCachedInput":"/M · entrada en caché ¥","ui.mOutput":"/M · salida ¥","ui.beijingTimeSwitchesTo":"Hora de Pekín: a las {atLabel} cambia a ","ui.until":"Hasta ","ui.offPeak":"valle","ui.peak":"punta","ui.today":"Hoy {symbol}{value}","ui.lastDays":"Últimos 30 días {symbol}{value}","ui.allTime":"Total histórico {symbol}{value}","ui.sessionIncludingSubagents":"Sesión {costTxt} (incluye subagentes){value}","ui.session":"Sesión","ui.spendIsTemporarilyUnavailableChat":"El gasto no está disponible temporalmente. No afecta al chat.","ui.spendUnavailable":"Gasto no disponible","ui.noSignInCredentialsFound":"No se encontraron credenciales de inicio de sesión para {serviceName}. Vuelve a autorizar.","ui.credentialsHaveExpiredPleaseReauthorize":"Las credenciales de {serviceName} han caducado. Vuelve a autorizar.","ui.deniedAccessReauthorizeOrTry":"{serviceName} denegó el acceso. Vuelve a autorizar o inténtalo más tarde.","ui.rateLimitReachedPleaseTry":"Se alcanzó el límite de solicitudes de {serviceName}. Inténtalo más tarde.","ui.timedOutCheckYourConnection":"Se agotó el tiempo de {serviceName}. Comprueba la conexión e inténtalo de nuevo.","ui.returnedAnUnrecognizedResponsePlease":"{serviceName} devolvió una respuesta desconocida. Inténtalo más tarde.","ui.isTemporarilyUnavailableCheckYour":"{serviceName} no está disponible temporalmente. Comprueba la conexión e inténtalo de nuevo.","ui.subscriptionExpiresLocalTime":"La suscripción caduca: {value} (hora local)","ui.expires":"Caduca","ui.subscriptionSource":"Origen de suscripción: {value} (","ui.prepaidBalance":"Saldo disponible","ui.availableBalanceLabel":"Saldo disponible","ui.remainingCredits":"Créditos restantes","ui.availableBalance":"Saldo disponible: {balTxt}","ui.availableCredits":"Créditos restantes: {value}","ui.subscriptionSource.titleLines":"Origen de suscripción: {value}","ui.windowRemainingUsed":"Período {label}: restante {value}% (usado {usedPercent}%)","ui.resetsResetsIn":" · Se restablece {value} · Dentro de {value2}","ui.windowRemainingUsedResets":"Período {label}: restante {value}% (usado {usedPercent}%) · Se restablece {value4}","ui.resetsIn":"Se restablece en","ui.configureItInSettingsModels":". Configúralo en Ajustes → Modelos.","ui.deniedAccessTheTokenMay":"{serviceName} denegó el acceso: es posible que el token no tenga permiso para leer la facturación.","ui.billingIsTemporarilyUnavailableCheck":"La facturación de {serviceName} no está disponible temporalmente. Comprueba la conexión y los permisos e inténtalo de nuevo.","ui.billingSource":"Origen de facturación: {value}","ui.thisMonthSSpend":"Gasto de este mes: {symbol}{value}","ui.budgetUsed":"Presupuesto usado: {value}%","ui.dailyFreeQuotaRemaining":"Cuota gratuita diaria restante: {value}","ui.thisMonth":"Este mes","ui.thisMonthSUsage":"Uso de este mes","ui.budget":"Presupuesto","ui.free":"Gratis","ui.resetsIn.pushBillingGroups":"{value} · Se restablece en {value2}","ui.billingServiceModel":"Servicio de facturación: {serviceName}\nModelo: {modelLabel}{versionLine}","ui.pricing":"Tarifas","ui.spend":"Gasto","ui.mode":"Modo","ui.subscriptionQuota":"Cuota de suscripción","ui.billing":"Facturación","ui.temporarilyUnavailableKeepingTheLast":": temporalmente no disponible. Se conservan los últimos datos y se reintenta automáticamente.","ui.spendJournalSavedButThe":"Diario de gastos guardado, pero el registro legible no se ha actualizado: ","ui.thisSpendRecordWasNot":"Este gasto no se guardó y no se añadirá a los totales: ","ui.ledgerUpdatePending":"Actualización del registro pendiente","ui.spendNotSaved":"Gasto no guardado","ui.versionAndUpdateTitle":"Versiones y actualizaciones","ui.versionAndUpdateDesc":"Las actualizaciones solo sustituyen los archivos del plugin; no modifican los registros de facturación ni los ajustes.","ui.versionUnavailable":"El DSH en ejecución aún no ha cargado esta versión del plugin, por lo que solo se muestra esta línea. Reinicia DSH para ver la versión activa, el modo de actualización y el botón de comprobación.","ui.versionRunning":"Versión activa {version}","ui.versionLatest":"Última versión {version}","ui.versionLastCheck":"Última comprobación {time}","ui.versionUnknown":"Desconocida","ui.timeJustNow":"ahora mismo","ui.timeMinutesAgo":"hace {n} min","ui.timeHoursAgo":"hace {n} h","ui.timeDaysAgo":"hace {n} días","ui.autoUpdateTitle":"Método de actualización","ui.updateModeAutoDesc":"Comprueba e instala al iniciar DSH. Durante el uso, la comprobación manual pide confirmación antes de instalar.","ui.updateModeManualDesc":"No instala al iniciar. Durante el uso, la comprobación manual pide confirmación antes de instalar.","ui.updateModeAuto":"Actualizaciones automáticas","ui.updateModeManual":"Actualizaciones manuales","ui.updateConfirm":"La versión {version} está disponible. ¿Actualizar el plugin ahora? Reinicia DSH para aplicarla.","ui.updateCheckNow":"Comprobar ahora","ui.updateChecking":"Comprobando…","ui.updateInstallNow":"Actualizar a {version}","ui.updateInstalling":"Actualizando a {version}…","ui.updateAvailableNow":"La versión {version} está lista; puedes actualizar ahora.","ui.updateRollbackFailed":"No se pudo volver a la versión anterior porque no hay una copia de seguridad utilizable. Desinstala y reinstala desde la página de plugins.","ui.updateHostOutdated":"No se ejecutó esta acción: el DSH en ejecución aún usa la lógica de actualización antigua. Reinicia DSH para que funcione el botón.","ui.updateUpToDate":"Está actualizado.","ui.updateDisabled":"Las actualizaciones automáticas no están disponibles aquí","ui.updateDisabledWhy":"Las actualizaciones automáticas requieren instalar el plugin en el directorio de plugins de DSH. Esta copia viene del código fuente o de un enlace; usa el comando de actualización original.","ui.updatePendingRestart":"Actualizado a {version}. Reinicia DSH para activarlo.","ui.updateFailed":"La última actualización falló","ui.updateFallbackWhy":"Si la nueva versión funciona mal, puedes volver a la anterior.","ui.updateHoldWhy":"Has bloqueado esta versión, por lo que no se instalará automáticamente.","ui.updateErrorIncompleteDownload":"La descarga quedó incompleta (se perdió la conexión). Se canceló la actualización y tu versión no se modificó.","ui.updateErrorIntegrityMismatch":"El paquete de actualización no superó la comprobación de seguridad y se descartó. Tu versión no se modificó.","ui.updateErrorDownloadFailed":"No se pudo conectar al servidor de actualizaciones. Inténtalo más tarde.","ui.updateErrorTooLarge":"El paquete de actualización era inusualmente grande y se descartó.","ui.updateErrorPayloadMismatch":"El paquete no coincidía con su número de versión y se descartó.","ui.updateErrorPayloadUnsafe":"El paquete contenía una ruta de archivo inesperada y se descartó.","ui.updateErrorCheckFailed":"Falló la comprobación de versión, posiblemente por un problema de conexión.","ui.updateErrorUnknown":"La actualización falló. Consulta los detalles en el registro de actualización.","ui.updateRollback":"Volver a la versión anterior","ui.updateRolledBack":"Se volvió a la versión anterior {version}.","ui.updateHeld":"La versión {version} está bloqueada y no se instalará automáticamente.","ui.updateAllowHeld":"Permitir actualización a {version}","ui.updateRestartBadge":"Reiniciar para aplicar","ui.updateFailedBadge":"Error de actualización","ui.tools":"Herramientas","ui.avgTTFT":"TTFT medio","ui.cacheHit":"Aciertos de caché","ui.cacheHitScope":"Por token: {hit} aciertos / {miss} fallos ({percent}% de aciertos).\nAlcance: solo el agente principal de esta sesión, sin subagentes.","ui.tokenScope":"La entrada/salida acumula solo el agente principal de esta sesión (sin subagentes); el gasto de sesión incluye subagentes.","ui.spendPartlyUnpriced":"Algunas llamadas no tienen tarifa publicada (no se sustituye por la de otro modelo); el coste real es mayor que el mostrado.","ui.input.BottomInfoBar":"Entrada","ui.output":"Salida","ui.savingView":"Guardando vista…","ui.clickToSwitchFullCompact":"Haz clic para alternar entre vista completa y compacta","ui.pressEnterOrSpaceFor":"Pulsa Intro o Espacio para la vista compacta.","ui.pressEnterOrSpaceFor.BottomInfoBar":"Pulsa Intro o Espacio para la vista completa.","host.hour":"5 horas","host.unknownProvider":"Proveedor desconocido","error.subscription.request-failed":"Error inesperado al solicitar la cuota de suscripción","host.settingsFileCouldNotBe":"No se pudo guardar el archivo de ajustes","error.settings.save-failed":"No se pudo guardar settings.json: {value}","error.balance.credentials":"No se pudieron leer las credenciales","error.balance.not-configured":"Sin configurar: {credential}","error.balance.account-signed-out":"Se cerró la sesión de la cuenta integrada","error.balance.account-unavailable":"Este entorno no tiene un servicio de cuenta integrado","error.balance.account-request-failed":"No se pudo obtener el saldo de la cuenta integrada","error.request.http":"Error en la solicitud: HTTP {status}.","error.request.parse":"Formato de respuesta inesperado","error.subscription.not-connected":"Suscripción de ChatGPT no conectada: no se encontraron credenciales en ~/.codex/auth.json. Instala dsh-chatgpt-sub e inicia sesión.","error.subscription.credentials-missing":"Falta id_token en las credenciales de suscripción de ChatGPT. Instala dsh-chatgpt-sub y vuelve a autorizar.","error.subscription.opencode-not-configured":"OpenCode Go no está configurado. Define OPENCODE_GO_API_KEY o usa auth.json de opencode.","error.subscription.commandcode-not-configured":"Command Code no está configurado. Define COMMAND_CODE_API_KEY, CMD_API_KEY o inicia sesión con Command Code CLI.","error.subscription.commandcode-auth-failed":"Command Code rechazó las credenciales. Vuelve a iniciar sesión o actualiza la clave API.","error.subscription.commandcode-unrecognized":"Command Code devolvió un formato de cuota desconocido; se conservó la instantánea anterior.","host.zhipu":"Zhipu {mapped}","host.zhipu.parseZaiQuota":"Zhipu {value}{value2}","error.subscription.zhipu-not-configured":"La clave API de Zhipu no está configurada. Define ZAI_API_KEY o ZAI_CODING_CN_API_KEY.","error.subscription.zhipu-auth-failed":"Falló la autenticación de la API de Zhipu: la clave caducó o no es válida.","error.subscription.zhipu-unrecognized":"Zhipu devolvió un formato de cuota desconocido (la API puede haber cambiado); se conservan los últimos datos conocidos.","error.request.failed":"Error en la solicitud: {value} {msg}.","error.subscription.xiaomi-not-configured":"Las credenciales de Xiaomi MiMo Token Plan no están configuradas: {credName} o XIAOMI_API_KEY.","error.subscription.xiaomi-http":"Error en la solicitud: HTTP {value}.","error.subscription.minimax-not-configured":"MiniMax no está configurado. Define MINIMAX_API_KEY o MINIMAX_CN_API_KEY. Las consultas de Token Plan requieren una Subscription Key; el servidor rechaza las claves API de pago por uso.","error.subscription.minimax-auth-failed":"MiniMax rechazó la clave API: las consultas de Token Plan requieren una Subscription Key (generada en la página de suscripción de Token Plan). Se rechazan las claves de pago por uso (status_code=1004 / HTTP 401).","error.subscription.minimax-unrecognized":"MiniMax devolvió un formato de cuota desconocido (la API puede haber cambiado); se conservan los últimos datos conocidos.","error.billing.together-not-configured":"Sin configurar: TOGETHER_API_KEY","host.actualMonthlyBillFromThe":"Factura mensual real de Together Usage API","error.billing.fireworks-not-configured":"Sin configurar: FIREWORKS_API_KEY","error.billing.fireworks-account":"No se pudo leer la cuenta (falta account_id)","host.actualBillForThisPeriod":"Factura real de este período (Fireworks Billing Summary)","host.actualUsageForThisPeriod":"Uso real de este período (alternativa billingUsage; sin importe de gasto)","error.billing.aws-not-configured":"Sin configurar: credenciales AWS (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)","error.billing.aws-http":"Error en la solicitud: HTTP {status}. Es posible que el token no tenga permiso ce:GetCostAndUsage","host.actualMonthlyBillFromAWS":"Factura mensual real de AWS Cost Explorer (retraso de unas 24 horas)","error.billing.cloudflare-not-configured":"Sin configurar: CLOUDFLARE_API_KEY (requiere un token de cuenta con permiso de lectura de Billing)","error.billing.cloudflare-account":"Sin configurar: CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"Error en la solicitud: HTTP {status}. El token requiere permiso de lectura de Billing","host.actualMonthlyUsageFromThe":"Uso mensual real de Cloudflare Billable Usage API (Alpha)","error.billing.huggingface-not-configured":"Sin configurar: HF_TOKEN (los tokens de permisos específicos requieren lectura de Billing)","host.actualMonthlyBillFromHF":"Factura mensual real de Hugging Face Billing API","error.billing.request-failed":"Error inesperado al solicitar la facturación","host.spendSummaryFileMissingArchived":"Falta el archivo de resumen de gastos: los importes archivados no se incluyen en los totales mostrados. Los detalles siguen en usage-archive/ para recuperarlos manualmente.","host.spendLedgerCouldNotBe":"No se pudo guardar el registro de gastos","host.usageLedgerBusy":"Todavía hay una respuesta en curso. Borra los registros cuando termine.","error.ledger.clear-failed":"No se pudieron borrar por completo los registros: {value}","error.ledger.snapshot-stale":"No se pudieron guardar los resúmenes archivados: {value}","host.basedOnYourLastSessions":"Basado en tus últimas {count} sesiones","host.estimatedFromSpendingOverThe":"Estimado a partir del gasto de los últimos {SPEND_DAYS} días","host.patchMustIncludeFieldsOr":"patch debe incluir fields, colors, timeZones o customText","host.timeZonesMustBeAnObject":"timeZones debe ser un objeto","host.timeZoneMustBeAValid":"La zona horaria debe ser una zona IANA válida: {key}","host.customTextMustBeAString":"El texto personalizado debe ser una cadena","host.customTextTooLong":"El texto personalizado no debe superar los 64 caracteres","host.quotaDisplayModeInvalid":"El modo de porcentaje de suscripción debe ser \"used\" o \"remaining\"","host.infoDensityMustBeFullOrCompact":"La visualización debe ser full o compact","host.fieldsMustBeAnObject":"fields debe ser un objeto","host.unknownFieldId":"Identificador de campo desconocido: {key}","host.fieldVisibilityMustBeA":"La visibilidad del campo debe ser un booleano: {key}","host.colorsMustBeAnObject":"colors debe ser un objeto","host.colorMustBeAPreset":"El color debe ser un nombre predefinido o #RRGGBB: {key}","field.anchorGroup.label":"Proveedor y modelo","field.anchorGroup.note":"Muestra el proveedor y el modelo usados en esta conversación.","field.subServiceGroup.label":"Servicio de suscripción y modelo","field.subServiceGroup.note":"Muestra el servicio de suscripción y el modelo o plan actual.","field.billingServiceGroup.label":"Servicio de facturación y modelo","field.billingServiceGroup.note":"Muestra el servicio de facturación y el modelo actual.","field.customText.label":"Texto personalizado","field.customText.note":"Muestra texto personalizado como nota o firma.","field.mainTime.label":"Hora principal","field.mainTime.note":"Muestra la zona horaria principal; ajústala en Hora y fecha.","field.worldTime.label":"Hora mundial","field.worldTime.note":"Muestra otra zona horaria.","field.sessionCost.label":"Gasto de sesión","field.sessionCost.note":"Muestra el gasto real de esta sesión, incluidos los subagentes.","field.balance.note":"Muestra el saldo de la cuenta; el saldo bajo se resalta en rojo.","field.period.label":"Período actual","field.period.note":"En proveedores con tarifas punta/valle, muestra si el período actual es punta o valle.","field.countdown.label":"Próximo cambio de tarifa","field.countdown.note":"Muestra el tiempo hasta el próximo cambio entre tarifa punta y valle.","field.expiry.label":"Caducidad de suscripción","field.expiry.note":"Se muestra cuando el proveedor devuelve una fecha de caducidad.","field.subWindow5h.label":"Cuota de 5 horas","field.subWindow5h.note":"Muestra la cuota restante del período móvil de 5 horas.","field.subWindowWeek.label":"Cuota semanal","field.subWindowWeek.note":"Muestra la cuota semanal restante.","field.subWindowMonth.label":"Cuota mensual","field.subWindowMonth.note":"Muestra la cuota mensual restante.","field.resetCountdown.label":"Restablecimiento de cuota","field.resetCountdown.note":"Muestra el tiempo restante hasta el restablecimiento de la cuota actual.","field.subBalance.label":"Saldo o créditos disponibles","field.subBalance.note":"Muestra el saldo disponible de las cuentas de pago por uso o los créditos restantes si la suscripción no muestra un período de cuota.","field.billingSpend.label":"Uso mensual","field.billingSpend.note":"Muestra el uso o gasto real del período de facturación actual.","field.budget.label":"Estado del presupuesto","field.budget.note":"Se muestra cuando el proveedor indica un porcentaje de presupuesto.","field.freeQuota.label":"Cuota gratuita","field.freeQuota.note":"Se muestra cuando el proveedor ofrece una cuota gratuita, con el importe restante y el momento de restablecimiento.","field.turnsSteps.label":"Turnos y pasos","field.turnsSteps.note":"Muestra los turnos y pasos de esta sesión.","field.llmTime.label":"Tiempo del modelo","field.llmTime.note":"Muestra el tiempo total de inferencia del modelo.","field.toolTime.label":"Tiempo de herramientas","field.toolTime.note":"Muestra el tiempo total de ejecución de las herramientas.","field.avgTTFT.label":"Tiempo medio hasta el primer token","field.avgTTFT.note":"Muestra el tiempo medio hasta el primer token en los pasos del modelo de esta sesión.","field.outputSpeed.label":"Velocidad de salida","field.outputSpeed.note":"Muestra la velocidad media de salida de los pasos del modelo que informan de uso en esta sesión (tok/s).","field.cacheHit.note":"Muestra la tasa de aciertos de la caché de instrucciones.","field.tokensIO.label":"Tokens de entrada / salida","field.tokensIO.note":"Muestra el total de tokens de entrada y salida de esta sesión.","field.contextUsage.label":"Uso del contexto","field.contextUsage.note":"Muestra el uso del contexto; cuanto más lleno el anillo, menos espacio queda para escribir.","ui.contextAria":"{percent} del contexto usado","ui.contextUsed":"Contexto usado","ui.contextSystem":"Instrucción del sistema","ui.contextTools":"Definiciones de herramientas","ui.contextMessages":"Mensajes de conversación","ui.contextFigures":"~{used} / {window}","number.thousand":"{value}K","number.million":"{value}M","field.unmapped.label":"Estado de datos de cuenta","field.unmapped.note":"Se muestra si el proveedor es desconocido o no tiene una interfaz pública de saldo/cuota; el registro local de uso sigue funcionando.","field.noKeyHint.label":"Aviso de clave ausente","field.noKeyHint.note":"Se muestra si falta una clave API e indica dónde añadirla.","field.balanceError.label":"Error de actualización del saldo","field.balanceError.note":"Se muestra si falla la actualización del saldo.","field.usageError.label":"Error de actualización del uso","field.usageError.note":"Se muestra si los datos de gasto no están disponibles temporalmente.","field.refreshFailure.label":"Error de actualización","field.refreshFailure.note":"Se muestra si falla cualquier actualización de datos.","field.persistWarning.label":"Aviso de registro no guardado","field.persistWarning.note":"Se muestra si no se pueden guardar los registros de facturación; recomendado.","field.updateNotice.label":"Aviso de actualización","field.updateNotice.note":"Muestra un aviso breve si hay una nueva versión lista o una versión descargada espera el reinicio.","field.updateFailure.label":"Aviso de fallo de actualización","field.updateFailure.note":"Muestra un aviso breve si falla la actualización automática.","group.native":"Información nativa","group.plugin":"Información del plugin","group.notice":"Avisos","group.native.desc":"Campos que ya tenía la barra de DSH. Se muestran en la fila de estadísticas nativa, visible solo en modo completo.","group.plugin.desc":"Campos que añade este plugin, incluido el anillo de contexto integrado. Se muestran en la fila principal, visible en ambos modos.","group.notice.desc":"Avisos puntuales como actualizaciones y errores. Aparecen cuando hay algo que comunicar, sea cual sea el modo.","section.identity.label":"Proveedor y modelo","section.identity.desc":"Se muestra con cualquier método de pago: el servicio y el modelo que usa esta conversación.","section.subscription.label":"Suscripción: plan mensual con cuota incluida","section.subscription.desc":"Un plan como ChatGPT solo rellena estos elementos: períodos de cuota, restablecimiento, fecha de caducidad y saldo disponible.","section.balance.label":"Saldo prepago: recarga y se descuenta según el uso","section.balance.desc":"Estos proveedores solo rellenan estos elementos: saldo, gasto de sesión, período actual y próximo cambio de tarifa.","section.billing.label":"Uso facturado: usa primero, paga mensualmente","section.billing.desc":"Estos proveedores solo rellenan estos elementos: uso del mes, presupuesto y cuota gratuita.","section.common.label":"Elementos generales","section.common.desc":"Sin relación con la facturación, útiles con cualquier proveedor: texto personalizado, relojes y uso del contexto.","ui.listSeparator":", ","ui.sentenceEnd":".","ui.fieldErrorPrefix":"«{label}»: ","ui.turnCount":"{count} turno","ui.turnCountPlural":"{count} turnos","ui.stepCount":"{count} paso","ui.stepCountPlural":"{count} pasos","ui.mainTimeZone":"Zona horaria principal","ui.worldTimeZone":"Zona horaria mundial","ui.customTextTitle":"Texto personalizado","ui.customTextPlaceholder":"Introduce texto (hasta 64 caracteres)","ui.searchPlaceholder":"Buscar por nombre o descripción…","ui.searchFieldsLabel":"Buscar contenido visible","ui.searchResultCount":"{count} encontrados","ui.enabledFieldsCount":"{count} activados","ui.noSearchResults":"No se encontraron ajustes coincidentes","ui.mainTime":"Hora principal","ui.worldTime":"Hora mundial","ui.customText":"Texto personalizado","language.title":"Idioma","language.description":"Sigue el idioma de DSH o elige uno para este plugin en este navegador.","language.auto":"Seguir DSH","language.saveFailed":"No se pudo guardar el idioma preferido. Permite el almacenamiento local e inténtalo de nuevo."},"pt":{"meta.title":"Barra de informações inferior","meta.description":"Mostra o modelo atual, o saldo e os gastos abaixo do campo de mensagem.","ui.requestTimedOut":"Tempo limite da solicitação atingido","ui.requestCanceled":"Solicitação cancelada","ui.couldNotParseResponse":"Não foi possível interpretar a resposta","ui.rpcFailed":"Falha na RPC","ui.refreshFailed":"Falha na atualização","color.red":"Vermelho","color.green":"Verde","color.blue":"Azul","color.purple":"Roxo","color.orange":"Laranja","color.neutral":"Neutro","ui.pleaseTryAgainLater":"Tente novamente mais tarde","ui.restoreDefaultColor":"Restaurar cor padrão","ui.infoBarSettings":"Barra de informações","ui.settingsAreTemporarilyUnavailable":"As configurações estão temporariamente indisponíveis","ui.loadingInfoBarSettings":"Carregando configurações…","ui.couldNotLoadInfoBar":"Não foi possível carregar as configurações da barra: ","ui.changesAppliedButCouldNot":"Aplicado, mas não foi possível salvar localmente: ","ui.unknownReason":"Motivo desconhecido","ui.couldNotSave":"{errorPrefix}Não foi possível salvar: {value}","ui.color":"Cor de \"{value}\": ","ui.hasAnInvalidColorEnter":"\"{value}\" tem uma cor inválida. Insira #RRGGBB (por exemplo, #0044CC).","ui.defaultColorsRestored":"Cores padrão restauradas","ui.defaultLabelsRestored":"Exibição padrão restaurada","ui.couldNotReset":"Não foi possível redefinir: {value}","ui.show":"Mostrar {label}","ui.clickToHide":"Clique para ocultar","ui.clickToShow":"Clique para mostrar","ui.presetColor":"Cor predefinida de {label}","ui.customColor":"Cor personalizada de {label}","ui.customColorOpenColorPicker":"Cor personalizada (abrir seletor de cores)","ui.customColorItem":"Personalizada…","ui.colorSwatchLabel":"Cor de {label}","ui.hexColor":"Cor hexadecimal de {label}","ui.expand":"Expandir","ui.collapse":"Recolher","ui.saving":"Salvando…","ui.processing":"Processando…","ui.visibleFields":"Informações a exibir","ui.timeDateTitle":"Hora e data","ui.timeDateDesc":"Fusos horários da hora principal e mundial.","ui.customTextSectionDesc":"Mostra uma linha de texto personalizado na barra.","ui.resetConfirmTitle":"Redefinir configurações da barra","ui.resetConfirmDescFields":"Restaura todas as opções de exibição para o padrão. As cores personalizadas não são afetadas, e a alteração é aplicada imediatamente.","ui.resetConfirmDescColors":"Todas as cores personalizadas serão apagadas e as cores padrão restauradas. As opções de visibilidade dos campos não serão afetadas. A alteração será aplicada imediatamente à barra.","ui.resetConfirmAcknowledge":"Entendo que esta redefinição não pode ser desfeita","ui.resetConfirmCancel":"Cancelar","ui.resetConfirmConfirm":"Redefinir","ui.resetLabels":"Restaurar exibição","ui.resetColors":"Restaurar cores","ui.resetRowTitle":"Restaurar padrões","ui.resetRowDesc":"Restaura os itens exibidos ou as cores para o padrão.","ui.customTextCount":"{value}/64 caracteres","ui.couldNotDisplayInfoBar":"Não foi possível exibir as configurações da barra: {value}","ui.dataAndBilling":"Dados de faturamento","ui.dataAndBillingDesc":"Exporte ou apague os registros de uso e gastos salvos por este plugin.","ui.exportBillingRecords":"Exportar faturamento","ui.exportBillingRecordsDesc":"Exporte os registros como arquivo CSV ou JSON.","ui.exportBillingCsv":"Exportar CSV","ui.exportBillingJson":"Exportar JSON","ui.clearBillingRecords":"Apagar faturamento","ui.clearBillingRecordsDesc":"Esta ação não pode ser desfeita.","ui.clearBillingRecordsConfirm":"Apagar todos os registros de faturamento salvos por este plugin? Exporte-os primeiro. Esta ação não pode ser desfeita, mas as configurações e os dados de login serão mantidos.","ui.exportedBillingRecords":"Exportados {count} registros de faturamento ({format})","ui.noBillingRecordsToExport":"Não há registros de faturamento para exportar.","ui.exportFailed":"Falha ao exportar: {value}","ui.exportIncomplete":"Alguns registros históricos não puderam ser lidos: {value}. Nada foi exportado; tente novamente mais tarde.","ui.clearFailed":"Não foi possível apagar os registros de faturamento: {value}","ui.clearFailedWithoutDetails":"Não foi possível apagar todos os registros de faturamento","ui.clearedBillingRecords":"Apagados {count} registros de faturamento","ui.clearCanceled":"Cancelado","ui.exportNotSupported":"Este ambiente não permite baixar arquivos.","ui.weekly":"Semanal","ui.monthly":"Mensal","ui.window":"Período","ui.quotaDisplayUsed":"Usado","ui.quotaDisplayRemaining":"Restante","ui.quotaDisplayModeTitle":"Porcentagem do período da assinatura","ui.quotaDisplayModeDesc":"Mostra as cotas da assinatura como restantes ou usadas. O aviso de cota baixa sempre aparece quando resta menos de 20%.","ui.windowUsedRemaining":"Período {label}: usado {usedPercent}% (restante {value}%)","ui.windowUsedRemainingResets":"Período {label}: usado {usedPercent}% (restante {value}%) · Redefine em {value4}","ui.minimax":"MiniMax","ui.supportsImageInput":"Aceita entrada de imagens.","ui.vision":"Visão","ui.unknown":"Desconhecido","ui.unknownModel":"Modelo desconhecido","ui.modelSelectionPending":"Lendo o modelo atual","ui.modelCapabilityPending":"Verificando suporte a imagens","ui.pluginVersion":"\nVersão do plugin: {current}","ui.provider":"Provedor: {provLabel} {modelLabel}\n","ui.pricingPeakOffPeakBeijing":"Preços: horário de pico/fora de pico (horário de Pequim; pico em dias úteis 09:00-12:00 e 14:00-18:00; fins de semana e feriados chineses fora de pico)","ui.pricingFixed":"Preços: fixos","ui.pricingNotListedUsingDefaults":"Preços: não informados; gastos não calculados","ui.zhipu":"Zhipu","ui.xiaomiMiMo":"Xiaomi MiMo","ui.commandCode":"Command Code","ui.subscription":"Assinatura","ui.cloudBilling":"Faturamento na nuvem","ui.plan":"\nPlano: {plan}","ui.expiresLocalTime":"\nExpira: {value} (hora local)","ui.subscriptionServiceModel":"Serviço de assinatura: {serviceName}\nModelo: {rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.balanceLookupIsNotYet":"O saldo deste provedor ainda não está disponível.","ui.notSupported":"Não suportado","ui.accountDataUnavailable":"Sem dados públicos da conta","ui.accountDataUnavailableDetail":"Este provedor permite identificar modelos e registrar o uso localmente, mas não oferece uma interface pública de saldo ou cota que o plugin possa consultar com segurança.","ui.notConfigured":"Não configurado: ","ui.notConfiguredConfigureItIn":"Não configurado: {credName}. Configure em Configurações → Modelos.","ui.notConfiguredSettingsModels":"{credName} não está configurado. Adicione em Configurações → Modelos.","ui.accountSignedOut":"Conta desconectada","ui.accountSignedOutHow":"Entre na sua conta DeepSeek em Configurações → Conta do DSH, e o saldo aparecerá aqui.","ui.estimatedBalance":"Saldo estimado: {symbol}{value}","ui.balance":"Saldo: {symbol}{value}","ui.balanceDetailToppedUp":"Saldo recarregado: {symbol}{value}","ui.balanceDetailGranted":"Saldo concedido: {symbol}{value}","ui.balance.pushBalanceGroups":"Saldo","ui.low":"Baixo","ui.estimated":"(estimado)","ui.balanceIsTemporarilyUnavailableShowing":"O saldo está temporariamente indisponível. Exibindo os últimos dados e tentando novamente automaticamente.","ui.couldNotLoadBalanceCheck":"Não foi possível carregar o saldo. Verifique a conexão e a chave de API.","ui.balanceUnavailable":"Saldo indisponível","ui.beijingTime":"Hora de Pequim: ","ui.peakPrice":"Preço de pico","ui.offPeakPrice":"Preço fora de pico","ui.input":": entrada ¥","ui.mCachedInput":"/M · entrada em cache ¥","ui.mOutput":"/M · saída ¥","ui.beijingTimeSwitchesTo":"Hora de Pequim: às {atLabel} muda para ","ui.until":"Até ","ui.offPeak":"fora de pico","ui.peak":"pico","ui.today":"Hoje {symbol}{value}","ui.lastDays":"Últimos 30 dias {symbol}{value}","ui.allTime":"Todo o período {symbol}{value}","ui.sessionIncludingSubagents":"Sessão {costTxt} (inclui subagentes){value}","ui.session":"Sessão","ui.spendIsTemporarilyUnavailableChat":"Os gastos estão temporariamente indisponíveis. O chat não é afetado.","ui.spendUnavailable":"Gastos indisponíveis","ui.noSignInCredentialsFound":"Nenhuma credencial de login encontrada para {serviceName}. Autorize novamente.","ui.credentialsHaveExpiredPleaseReauthorize":"As credenciais de {serviceName} expiraram. Autorize novamente.","ui.deniedAccessReauthorizeOrTry":"{serviceName} negou o acesso. Autorize novamente ou tente mais tarde.","ui.rateLimitReachedPleaseTry":"Limite de solicitações de {serviceName} atingido. Tente mais tarde.","ui.timedOutCheckYourConnection":"Tempo limite de {serviceName} atingido. Verifique a conexão e tente novamente.","ui.returnedAnUnrecognizedResponsePlease":"{serviceName} retornou uma resposta não reconhecida. Tente mais tarde.","ui.isTemporarilyUnavailableCheckYour":"{serviceName} está temporariamente indisponível. Verifique a conexão e tente novamente.","ui.subscriptionExpiresLocalTime":"A assinatura expira: {value} (hora local)","ui.expires":"Expira","ui.subscriptionSource":"Origem da assinatura: {value} (","ui.prepaidBalance":"Saldo disponível","ui.availableBalanceLabel":"Saldo disponível","ui.remainingCredits":"Créditos restantes","ui.availableBalance":"Saldo disponível: {balTxt}","ui.availableCredits":"Créditos restantes: {value}","ui.subscriptionSource.titleLines":"Origem da assinatura: {value}","ui.windowRemainingUsed":"Período {label}: restante {value}% (usado {usedPercent}%)","ui.resetsResetsIn":" · Redefine em {value} · Em {value2}","ui.windowRemainingUsedResets":"Período {label}: restante {value}% (usado {usedPercent}%) · Redefine em {value4}","ui.resetsIn":"Redefine em","ui.configureItInSettingsModels":". Configure em Configurações → Modelos.","ui.deniedAccessTheTokenMay":"{serviceName} negou o acesso: o token pode não ter permissão para ler o faturamento.","ui.billingIsTemporarilyUnavailableCheck":"O faturamento de {serviceName} está temporariamente indisponível. Verifique a conexão e as permissões e tente novamente.","ui.billingSource":"Origem do faturamento: {value}","ui.thisMonthSSpend":"Gastos deste mês: {symbol}{value}","ui.budgetUsed":"Orçamento usado: {value}%","ui.dailyFreeQuotaRemaining":"Cota gratuita diária restante: {value}","ui.thisMonth":"Este mês","ui.thisMonthSUsage":"Uso deste mês","ui.budget":"Orçamento","ui.free":"Grátis","ui.resetsIn.pushBillingGroups":"{value} · Redefine em {value2}","ui.billingServiceModel":"Serviço de faturamento: {serviceName}\nModelo: {modelLabel}{versionLine}","ui.pricing":"Preços","ui.spend":"Gastos","ui.mode":"Modo","ui.subscriptionQuota":"Cota da assinatura","ui.billing":"Faturamento","ui.temporarilyUnavailableKeepingTheLast":": temporariamente indisponível. Mantendo os últimos dados e tentando novamente automaticamente.","ui.spendJournalSavedButThe":"Diário de gastos salvo, mas o registro legível não foi atualizado: ","ui.thisSpendRecordWasNot":"Este gasto não foi salvo e não será somado aos totais: ","ui.ledgerUpdatePending":"Atualização do registro pendente","ui.spendNotSaved":"Gasto não salvo","ui.versionAndUpdateTitle":"Versão e atualizações","ui.versionAndUpdateDesc":"As atualizações substituem apenas os arquivos do plugin; os registros de faturamento e as configurações não são alterados.","ui.versionUnavailable":"O DSH em execução ainda não carregou esta versão do plugin, então apenas esta linha pode ser exibida. Reinicie o DSH para ver a versão ativa, o modo de atualização e o botão de verificação.","ui.versionRunning":"Versão em execução {version}","ui.versionLatest":"Versão mais recente {version}","ui.versionLastCheck":"Última verificação {time}","ui.versionUnknown":"Desconhecida","ui.timeJustNow":"agora mesmo","ui.timeMinutesAgo":"há {n} min","ui.timeHoursAgo":"há {n} h","ui.timeDaysAgo":"há {n} dias","ui.autoUpdateTitle":"Método de atualização","ui.updateModeAutoDesc":"Verifica e instala ao iniciar o DSH. Durante o uso, a verificação manual pede confirmação antes de instalar.","ui.updateModeManualDesc":"Não instala ao iniciar. Durante o uso, a verificação manual pede confirmação antes de instalar.","ui.updateModeAuto":"Atualizações automáticas","ui.updateModeManual":"Atualizações manuais","ui.updateConfirm":"A versão {version} está disponível. Atualizar o plugin agora? Reinicie o DSH para aplicar.","ui.updateCheckNow":"Verificar agora","ui.updateChecking":"Verificando…","ui.updateInstallNow":"Atualizar para {version}","ui.updateInstalling":"Atualizando para {version}…","ui.updateAvailableNow":"A versão {version} está pronta; você pode atualizar agora.","ui.updateRollbackFailed":"Não foi possível voltar à versão anterior porque não há um backup utilizável. Desinstale e reinstale pela página de plugins.","ui.updateHostOutdated":"Esta ação não foi executada: o DSH em execução ainda usa a lógica antiga de atualização. Reinicie o DSH para que o botão funcione.","ui.updateUpToDate":"Está atualizado.","ui.updateDisabled":"Atualizações automáticas indisponíveis aqui","ui.updateDisabledWhy":"As atualizações automáticas exigem que o plugin esteja instalado no diretório de plugins do DSH. Esta cópia veio do código-fonte ou de um link; use o comando original de atualização.","ui.updatePendingRestart":"Atualizado para {version}. Reinicie o DSH para ativar.","ui.updateFailed":"A última atualização falhou","ui.updateFallbackWhy":"Se a nova versão apresentar problemas, você pode voltar à anterior.","ui.updateHoldWhy":"Você bloqueou esta versão, então ela não será instalada automaticamente.","ui.updateErrorIncompleteDownload":"O download ficou incompleto (a conexão caiu). A atualização foi abandonada, e sua versão não foi alterada.","ui.updateErrorIntegrityMismatch":"O pacote de atualização falhou na verificação de segurança e foi descartado. Sua versão não foi alterada.","ui.updateErrorDownloadFailed":"Não foi possível acessar o servidor de atualizações. Tente mais tarde.","ui.updateErrorTooLarge":"O pacote de atualização era muito grande e foi descartado.","ui.updateErrorPayloadMismatch":"O pacote não correspondia ao número da versão e foi descartado.","ui.updateErrorPayloadUnsafe":"O pacote continha um caminho de arquivo inesperado e foi descartado.","ui.updateErrorCheckFailed":"A verificação de versão falhou, possivelmente por um problema de rede.","ui.updateErrorUnknown":"A atualização falhou. Consulte os detalhes no log de atualização.","ui.updateRollback":"Voltar à versão anterior","ui.updateRolledBack":"Restaurada a versão anterior {version}.","ui.updateHeld":"A versão {version} está bloqueada e não será instalada automaticamente.","ui.updateAllowHeld":"Permitir atualização para {version}","ui.updateRestartBadge":"Reinicie para aplicar","ui.updateFailedBadge":"Falha na atualização","ui.tools":"Ferramentas","ui.avgTTFT":"TTFT médio","ui.cacheHit":"Acertos de cache","ui.cacheHitScope":"Por token: {hit} acertos / {miss} falhas ({percent}% de acertos).\nEscopo: apenas o agente principal desta sessão, sem subagentes.","ui.tokenScope":"Entrada/saída acumulam apenas o agente principal desta sessão (sem subagentes); o custo da sessão inclui subagentes.","ui.spendPartlyUnpriced":"Algumas chamadas não têm preço informado (não é usado o preço de outro modelo); o custo real é maior que o exibido.","ui.input.BottomInfoBar":"Entrada","ui.output":"Saída","ui.savingView":"Salvando visualização…","ui.clickToSwitchFullCompact":"Clique para alternar entre visualização completa e compacta","ui.pressEnterOrSpaceFor":"Pressione Enter ou Espaço para a visualização compacta.","ui.pressEnterOrSpaceFor.BottomInfoBar":"Pressione Enter ou Espaço para a visualização completa.","host.hour":"5 horas","host.unknownProvider":"Provedor desconhecido","error.subscription.request-failed":"Falha inesperada ao solicitar a cota da assinatura","host.settingsFileCouldNotBe":"Não foi possível salvar o arquivo de configurações","error.settings.save-failed":"Não foi possível salvar settings.json: {value}","error.balance.credentials":"Não foi possível ler as credenciais","error.balance.not-configured":"Não configurado: {credential}","error.balance.account-signed-out":"A conta integrada está desconectada","error.balance.account-unavailable":"Este ambiente não tem serviço de conta integrado","error.balance.account-request-failed":"Não foi possível obter o saldo da conta integrada","error.request.http":"Falha na solicitação: HTTP {status}.","error.request.parse":"Formato de resposta inesperado","error.subscription.not-connected":"Assinatura do ChatGPT não conectada: credenciais não encontradas em ~/.codex/auth.json. Instale dsh-chatgpt-sub e entre na conta.","error.subscription.credentials-missing":"Falta id_token nas credenciais da assinatura ChatGPT. Instale dsh-chatgpt-sub e autorize novamente.","error.subscription.opencode-not-configured":"OpenCode Go não está configurado. Defina OPENCODE_GO_API_KEY ou use auth.json do opencode.","error.subscription.commandcode-not-configured":"Command Code não está configurado. Defina COMMAND_CODE_API_KEY, CMD_API_KEY ou entre pelo Command Code CLI.","error.subscription.commandcode-auth-failed":"Command Code rejeitou as credenciais. Entre novamente ou atualize a chave de API.","error.subscription.commandcode-unrecognized":"Command Code retornou um formato de cota não reconhecido; os dados anteriores foram mantidos.","host.zhipu":"Zhipu {mapped}","host.zhipu.parseZaiQuota":"Zhipu {value}{value2}","error.subscription.zhipu-not-configured":"A chave de API Zhipu não está configurada. Defina ZAI_API_KEY ou ZAI_CODING_CN_API_KEY.","error.subscription.zhipu-auth-failed":"Falha na autenticação da API Zhipu: a chave expirou ou é inválida.","error.subscription.zhipu-unrecognized":"Zhipu retornou um formato de cota não reconhecido (a API pode ter mudado); os últimos dados conhecidos são mantidos.","error.request.failed":"Falha na solicitação: {value} {msg}.","error.subscription.xiaomi-not-configured":"As credenciais do Xiaomi MiMo Token Plan não estão configuradas: {credName} ou XIAOMI_API_KEY.","error.subscription.xiaomi-http":"Falha na solicitação: HTTP {value}.","error.subscription.minimax-not-configured":"MiniMax não está configurado. Defina MINIMAX_API_KEY ou MINIMAX_CN_API_KEY. Consultas do Token Plan exigem uma Subscription Key; o servidor rejeita chaves de API de pagamento por uso.","error.subscription.minimax-auth-failed":"MiniMax rejeitou a chave de API: consultas do Token Plan exigem uma Subscription Key (gerada na página de assinatura do Token Plan). Chaves de pagamento por uso são rejeitadas (status_code=1004 / HTTP 401).","error.subscription.minimax-unrecognized":"MiniMax retornou um formato de cota não reconhecido (a API pode ter mudado); os últimos dados conhecidos são mantidos.","error.billing.together-not-configured":"Não configurado: TOGETHER_API_KEY","host.actualMonthlyBillFromThe":"Fatura mensal real da Together Usage API","error.billing.fireworks-not-configured":"Não configurado: FIREWORKS_API_KEY","error.billing.fireworks-account":"Não foi possível ler a conta (account_id ausente)","host.actualBillForThisPeriod":"Fatura real deste período (Fireworks Billing Summary)","host.actualUsageForThisPeriod":"Uso real deste período (alternativa billingUsage; sem valor de gastos)","error.billing.aws-not-configured":"Não configurado: credenciais AWS (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)","error.billing.aws-http":"Falha na solicitação: HTTP {status}. O token pode não ter permissão ce:GetCostAndUsage","host.actualMonthlyBillFromAWS":"Fatura mensal real do AWS Cost Explorer (atraso de cerca de 24 horas)","error.billing.cloudflare-not-configured":"Não configurado: CLOUDFLARE_API_KEY (exige token de conta com permissão de leitura de Billing)","error.billing.cloudflare-account":"Não configurado: CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"Falha na solicitação: HTTP {status}. O token exige permissão de leitura de Billing","host.actualMonthlyUsageFromThe":"Uso mensal real da Cloudflare Billable Usage API (Alpha)","error.billing.huggingface-not-configured":"Não configurado: HF_TOKEN (tokens de permissões específicas exigem leitura de Billing)","host.actualMonthlyBillFromHF":"Fatura mensal real da Hugging Face Billing API","error.billing.request-failed":"Falha inesperada ao solicitar o faturamento","host.spendSummaryFileMissingArchived":"Arquivo de resumo de gastos ausente: valores arquivados não são incluídos nos totais exibidos. Os detalhes permanecem em usage-archive/ para recuperação manual.","host.spendLedgerCouldNotBe":"Não foi possível salvar o registro de gastos","host.usageLedgerBusy":"Uma resposta ainda está em andamento. Apague os registros de faturamento após sua conclusão.","error.ledger.clear-failed":"Não foi possível apagar todos os registros de faturamento: {value}","error.ledger.snapshot-stale":"Não foi possível salvar os resumos de gastos arquivados: {value}","host.basedOnYourLastSessions":"Com base nas suas últimas {count} sessões","host.estimatedFromSpendingOverThe":"Estimado com base nos gastos dos últimos {SPEND_DAYS} dias","host.patchMustIncludeFieldsOr":"patch deve incluir fields, colors, timeZones ou customText","host.timeZonesMustBeAnObject":"timeZones deve ser um objeto","host.timeZoneMustBeAValid":"O fuso horário deve ser uma zona IANA válida: {key}","host.customTextMustBeAString":"O texto personalizado deve ser uma string","host.customTextTooLong":"O texto personalizado não deve ultrapassar 64 caracteres","host.quotaDisplayModeInvalid":"O modo de porcentagem da assinatura deve ser \"used\" ou \"remaining\"","host.infoDensityMustBeFullOrCompact":"A exibição deve ser full ou compact","host.fieldsMustBeAnObject":"fields deve ser um objeto","host.unknownFieldId":"Identificador de campo desconhecido: {key}","host.fieldVisibilityMustBeA":"A visibilidade do campo deve ser um booleano: {key}","host.colorsMustBeAnObject":"colors deve ser um objeto","host.colorMustBeAPreset":"A cor deve ser um nome predefinido ou #RRGGBB: {key}","field.anchorGroup.label":"Provedor e modelo","field.anchorGroup.note":"Mostra o provedor e o modelo usados nesta conversa.","field.subServiceGroup.label":"Serviço de assinatura e modelo","field.subServiceGroup.note":"Mostra o serviço de assinatura e o modelo ou plano atual.","field.billingServiceGroup.label":"Serviço de faturamento e modelo","field.billingServiceGroup.note":"Mostra o serviço de faturamento e o modelo atual.","field.customText.label":"Texto personalizado","field.customText.note":"Mostra texto personalizado como nota ou assinatura.","field.mainTime.label":"Hora principal","field.mainTime.note":"Mostra o fuso horário principal; ajuste em Hora e data.","field.worldTime.label":"Hora mundial","field.worldTime.note":"Mostra outro fuso horário.","field.sessionCost.label":"Gastos da sessão","field.sessionCost.note":"Mostra os gastos reais desta sessão, incluindo subagentes.","field.balance.note":"Mostra o saldo da conta; saldos baixos são destacados em vermelho.","field.period.label":"Período atual","field.period.note":"Em provedores com preços de pico/fora de pico, mostra em qual período estamos.","field.countdown.label":"Próxima mudança de preço","field.countdown.note":"Mostra o tempo até a próxima mudança entre preço de pico e fora de pico.","field.expiry.label":"Validade da assinatura","field.expiry.note":"Exibido quando o provedor informa uma data de expiração.","field.subWindow5h.label":"Cota de 5 horas","field.subWindow5h.note":"Mostra a cota restante do período móvel de 5 horas.","field.subWindowWeek.label":"Cota semanal","field.subWindowWeek.note":"Mostra a cota semanal restante.","field.subWindowMonth.label":"Cota mensal","field.subWindowMonth.note":"Mostra a cota mensal restante.","field.resetCountdown.label":"Redefinição da cota","field.resetCountdown.note":"Mostra o tempo restante até a redefinição da cota atual.","field.subBalance.label":"Saldo ou créditos disponíveis","field.subBalance.note":"Mostra o saldo disponível de contas de pagamento por uso ou os créditos restantes quando a assinatura não tem um período de cota visível.","field.billingSpend.label":"Uso mensal","field.billingSpend.note":"Mostra o uso ou gasto real do período de faturamento atual.","field.budget.label":"Status do orçamento","field.budget.note":"Exibido quando o provedor informa uma porcentagem do orçamento.","field.freeQuota.label":"Cota gratuita","field.freeQuota.note":"Exibido quando o provedor oferece uma cota gratuita, com a quantidade restante e o horário de redefinição.","field.turnsSteps.label":"Turnos e etapas","field.turnsSteps.note":"Mostra os turnos e etapas desta sessão.","field.llmTime.label":"Tempo do modelo","field.llmTime.note":"Mostra o tempo total de inferência do modelo.","field.toolTime.label":"Tempo das ferramentas","field.toolTime.note":"Mostra o tempo total de execução das ferramentas.","field.avgTTFT.label":"Tempo médio até o primeiro token","field.avgTTFT.note":"Mostra o tempo médio até o primeiro token nas etapas do modelo desta sessão.","field.outputSpeed.label":"Velocidade de saída","field.outputSpeed.note":"Mostra a velocidade média de saída nas etapas do modelo que informam uso nesta sessão (tok/s).","field.cacheHit.note":"Mostra a taxa de acertos do cache de prompts.","field.tokensIO.label":"Tokens de entrada / saída","field.tokensIO.note":"Mostra o total de tokens de entrada e saída desta sessão.","field.contextUsage.label":"Uso do contexto","field.contextUsage.note":"Mostra o uso do contexto; quanto mais cheio o anel, menos espaço resta para escrever.","ui.contextAria":"{percent} do contexto usado","ui.contextUsed":"Contexto usado","ui.contextSystem":"Prompt do sistema","ui.contextTools":"Definições de ferramentas","ui.contextMessages":"Mensagens da conversa","ui.contextFigures":"~{used} / {window}","number.thousand":"{value}K","number.million":"{value}M","field.unmapped.label":"Status dos dados da conta","field.unmapped.note":"Exibido quando o provedor é desconhecido ou não tem uma interface pública de saldo/cota; o registro local de uso continua funcionando.","field.noKeyHint.label":"Aviso de chave ausente","field.noKeyHint.note":"Exibido quando falta uma chave de API, indicando onde adicioná-la.","field.balanceError.label":"Erro ao atualizar saldo","field.balanceError.note":"Exibido quando a atualização do saldo falha.","field.usageError.label":"Erro ao atualizar uso","field.usageError.note":"Exibido quando os dados de gastos estão temporariamente indisponíveis.","field.refreshFailure.label":"Erro de atualização","field.refreshFailure.note":"Exibido quando qualquer atualização de dados falha.","field.persistWarning.label":"Aviso de registro não salvo","field.persistWarning.note":"Exibido quando os registros de faturamento não podem ser salvos; recomendado.","field.updateNotice.label":"Aviso de atualização","field.updateNotice.note":"Mostra um aviso breve quando uma nova versão está pronta ou uma versão baixada aguarda reinício.","field.updateFailure.label":"Aviso de falha na atualização","field.updateFailure.note":"Mostra um aviso breve quando a atualização automática falha.","group.native":"Informações nativas","group.plugin":"Informações do plugin","group.notice":"Avisos","group.native.desc":"Campos que a barra do DSH já tinha. Ficam na linha de estatísticas nativa, visível apenas no modo completo.","group.plugin.desc":"Campos adicionados por este plugin, incluindo o anel de contexto integrado. Ficam na linha principal, visível nos dois modos.","group.notice.desc":"Avisos pontuais, como atualizações e falhas. Aparecem quando há algo a informar, independentemente do modo.","section.identity.label":"Provedor e modelo","section.identity.desc":"Exibido com qualquer forma de pagamento: o serviço e o modelo usados nesta conversa.","section.subscription.label":"Assinatura: plano mensal com cota incluída","section.subscription.desc":"Um plano como ChatGPT preenche apenas estes itens: períodos de cota, redefinição, data de expiração e saldo disponível.","section.balance.label":"Saldo pré-pago: recarregue e o uso é descontado","section.balance.desc":"Estes provedores preenchem apenas estes itens: saldo, gastos da sessão, período atual e próxima mudança de preço.","section.billing.label":"Uso faturado: use primeiro, pague mensalmente","section.billing.desc":"Estes provedores preenchem apenas estes itens: uso do mês, orçamento e cota gratuita.","section.common.label":"Itens gerais","section.common.desc":"Sem relação com o faturamento, úteis em qualquer provedor: texto personalizado, relógios e uso do contexto.","ui.listSeparator":", ","ui.sentenceEnd":".","ui.fieldErrorPrefix":"\"{label}\": ","ui.turnCount":"{count} turno","ui.turnCountPlural":"{count} turnos","ui.stepCount":"{count} etapa","ui.stepCountPlural":"{count} etapas","ui.mainTimeZone":"Fuso horário principal","ui.worldTimeZone":"Fuso horário mundial","ui.customTextTitle":"Texto personalizado","ui.customTextPlaceholder":"Digite um texto (até 64 caracteres)","ui.searchPlaceholder":"Buscar por nome ou descrição…","ui.searchFieldsLabel":"Buscar conteúdo visível","ui.searchResultCount":"{count} encontrados","ui.enabledFieldsCount":"{count} ativados","ui.noSearchResults":"Nenhuma configuração correspondente encontrada","ui.mainTime":"Hora principal","ui.worldTime":"Hora mundial","ui.customText":"Texto personalizado","language.title":"Idioma","language.description":"Siga o idioma do DSH ou escolha um idioma para este plugin neste navegador.","language.auto":"Seguir DSH","language.saveFailed":"Não foi possível salvar a preferência de idioma. Permita o armazenamento local e tente novamente."},"fr":{"meta.title":"Barre d’informations inférieure","meta.description":"Affiche le modèle actuel, le solde et les dépenses sous la zone de saisie.","ui.requestTimedOut":"Délai de la requête dépassé","ui.requestCanceled":"Requête annulée","ui.couldNotParseResponse":"Impossible d’analyser la réponse","ui.rpcFailed":"Échec RPC","ui.refreshFailed":"Échec de l’actualisation","color.red":"Rouge","color.green":"Vert","color.blue":"Bleu","color.purple":"Violet","color.orange":"Orange","color.neutral":"Neutre","ui.pleaseTryAgainLater":"Veuillez réessayer plus tard","ui.restoreDefaultColor":"Rétablir la couleur par défaut","ui.infoBarSettings":"Barre d’informations","ui.settingsAreTemporarilyUnavailable":"Les paramètres sont temporairement indisponibles","ui.loadingInfoBarSettings":"Chargement des paramètres…","ui.couldNotLoadInfoBar":"Impossible de charger les paramètres de la barre d’informations : ","ui.changesAppliedButCouldNot":"Appliqué, mais impossible d’enregistrer localement : ","ui.unknownReason":"Raison inconnue","ui.couldNotSave":"{errorPrefix}Impossible d’enregistrer : {value}","ui.color":"Couleur de « {value} » : ","ui.hasAnInvalidColorEnter":"La couleur de « {value} » est invalide. Saisissez #RRGGBB (par exemple, #0044CC).","ui.defaultColorsRestored":"Couleurs par défaut rétablies","ui.defaultLabelsRestored":"Affichage par défaut rétabli","ui.couldNotReset":"Impossible de réinitialiser : {value}","ui.show":"Afficher {label}","ui.clickToHide":"Cliquer pour masquer","ui.clickToShow":"Cliquer pour afficher","ui.presetColor":"Couleur prédéfinie de {label}","ui.customColor":"Couleur personnalisée de {label}","ui.customColorOpenColorPicker":"Couleur personnalisée (ouvrir le sélecteur)","ui.customColorItem":"Personnalisée…","ui.colorSwatchLabel":"Couleur de {label}","ui.hexColor":"Couleur hexadécimale de {label}","ui.expand":"Développer","ui.collapse":"Réduire","ui.saving":"Enregistrement…","ui.processing":"Traitement…","ui.visibleFields":"Informations à afficher","ui.timeDateTitle":"Heure et date","ui.timeDateDesc":"Fuseaux horaires de l’heure principale et mondiale.","ui.customTextSectionDesc":"Affiche une ligne de texte personnalisé dans la barre d’informations.","ui.resetConfirmTitle":"Réinitialiser les paramètres de la barre d’informations","ui.resetConfirmDescFields":"Rétablit tous les choix d’affichage par défaut. Les couleurs personnalisées sont conservées et le changement est immédiat.","ui.resetConfirmDescColors":"Toutes les couleurs personnalisées seront effacées et les couleurs par défaut rétablies. Les choix des champs sont conservés. L’effet sur la barre d’informations est immédiat.","ui.resetConfirmAcknowledge":"Je comprends que cette réinitialisation est irréversible","ui.resetConfirmCancel":"Annuler","ui.resetConfirmConfirm":"Réinitialiser","ui.resetLabels":"Rétablir l’affichage","ui.resetColors":"Rétablir les couleurs","ui.resetRowTitle":"Rétablir les valeurs par défaut","ui.resetRowDesc":"Rétablir les éléments affichés ou les couleurs par défaut.","ui.customTextCount":"{value}/64 caractères","ui.couldNotDisplayInfoBar":"Impossible d’afficher les paramètres de la barre d’informations : {value}","ui.dataAndBilling":"Données de facturation","ui.dataAndBillingDesc":"Exporter ou effacer les relevés d’utilisation et de dépenses enregistrés par ce plugin.","ui.exportBillingRecords":"Exporter la facturation","ui.exportBillingRecordsDesc":"Exporter les relevés en fichier CSV ou JSON.","ui.exportBillingCsv":"Exporter en CSV","ui.exportBillingJson":"Exporter en JSON","ui.clearBillingRecords":"Effacer la facturation","ui.clearBillingRecordsDesc":"Cette action est irréversible.","ui.clearBillingRecordsConfirm":"Effacer tous les relevés de facturation enregistrés par ce plugin ? Exportez-les d’abord. Cette action est irréversible, mais les paramètres et les informations de connexion seront conservés.","ui.exportedBillingRecords":"{count} relevés de facturation exportés ({format})","ui.noBillingRecordsToExport":"Aucun relevé de facturation à exporter.","ui.exportFailed":"Échec de l’exportation : {value}","ui.exportIncomplete":"Certains anciens relevés de facturation n’ont pas pu être lus : {value}. Rien n’a été exporté ; réessayez plus tard.","ui.clearFailed":"Impossible d’effacer les relevés de facturation : {value}","ui.clearFailedWithoutDetails":"Les relevés de facturation n’ont pas pu être entièrement effacés","ui.clearedBillingRecords":"{count} relevés de facturation effacés","ui.clearCanceled":"Annulé","ui.exportNotSupported":"Le téléchargement de fichiers n’est pas pris en charge dans cet environnement.","ui.weekly":"Hebdomadaire","ui.monthly":"Mensuel","ui.window":"Période","ui.quotaDisplayUsed":"Utilisé","ui.quotaDisplayRemaining":"Restant","ui.quotaDisplayModeTitle":"Pourcentage de quota de l’abonnement","ui.quotaDisplayModeDesc":"Afficher les quotas de l’abonnement restants ou utilisés. L’alerte de quota faible se déclenche toujours lorsqu’il reste moins de 20 %.","ui.windowUsedRemaining":"Période {label} : {usedPercent} % utilisés ({value} % restants)","ui.windowUsedRemainingResets":"Période {label} : {usedPercent} % utilisés ({value} % restants) · Réinitialisation {value4}","ui.minimax":"MiniMax","ui.supportsImageInput":"Prend en charge les images en entrée.","ui.vision":"Vision","ui.unknown":"Inconnu","ui.unknownModel":"Modèle inconnu","ui.modelSelectionPending":"Lecture du modèle actuel","ui.modelCapabilityPending":"Vérification de la prise en charge des images","ui.pluginVersion":"\nVersion du plugin : {current}","ui.provider":"Fournisseur : {provLabel} {modelLabel}\n","ui.pricingPeakOffPeakBeijing":"Tarification : heures pleines/creuses (heure de Pékin ; heures pleines en semaine 09:00-12:00 et 14:00-18:00 ; heures creuses le week-end et les jours fériés chinois)","ui.pricingFixed":"Tarification : fixe","ui.pricingNotListedUsingDefaults":"Tarification : non publiée ; dépenses non calculées","ui.zhipu":"Zhipu","ui.xiaomiMiMo":"Xiaomi MiMo","ui.commandCode":"Command Code","ui.subscription":"Abonnement","ui.cloudBilling":"Facturation cloud","ui.plan":"\nFormule : {plan}","ui.expiresLocalTime":"\nExpiration : {value} (heure locale)","ui.subscriptionServiceModel":"Service d’abonnement : {serviceName}\nModèle : {rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.balanceLookupIsNotYet":"Le solde de ce fournisseur n’est pas encore disponible.","ui.notSupported":"Non pris en charge","ui.accountDataUnavailable":"Aucune donnée de compte publique","ui.accountDataUnavailableDetail":"Ce fournisseur est pris en charge pour la reconnaissance du modèle et le suivi local de l’utilisation, mais ne propose aucun point d’accès public au solde ou au quota que le plugin puisse lire en toute sécurité.","ui.notConfigured":"Non configuré : ","ui.notConfiguredConfigureItIn":"Non configuré : {credName}. Configurez-le dans Paramètres → Modèles.","ui.notConfiguredSettingsModels":"{credName} n’est pas configuré. Ajoutez-le dans Paramètres → Modèles.","ui.accountSignedOut":"Compte déconnecté","ui.accountSignedOutHow":"Connectez-vous à votre compte DeepSeek dans les paramètres DSH, rubrique Compte, et le solde apparaîtra ici.","ui.estimatedBalance":"Solde estimé : {symbol}{value}","ui.balance":"Solde : {symbol}{value}","ui.balanceDetailToppedUp":"Solde rechargé : {symbol}{value}","ui.balanceDetailGranted":"Solde offert : {symbol}{value}","ui.balance.pushBalanceGroups":"Solde","ui.low":"Faible","ui.estimated":"(estimé)","ui.balanceIsTemporarilyUnavailableShowing":"Le solde est temporairement indisponible. Les dernières données sont affichées ; une nouvelle tentative aura lieu automatiquement.","ui.couldNotLoadBalanceCheck":"Impossible de charger le solde. Vérifiez votre connexion et votre clé API.","ui.balanceUnavailable":"Solde indisponible","ui.beijingTime":"Heure de Pékin : ","ui.peakPrice":"Tarif heures pleines","ui.offPeakPrice":"Tarif heures creuses","ui.input":": entrée ¥","ui.mCachedInput":"/M · entrée en cache ¥","ui.mOutput":"/M · sortie ¥","ui.beijingTimeSwitchesTo":"Heure de Pékin : {atLabel}, passage en ","ui.until":"Jusqu’à ","ui.offPeak":"heures creuses","ui.peak":"heures pleines","ui.today":"Aujourd’hui {symbol}{value}","ui.lastDays":"30 derniers jours {symbol}{value}","ui.allTime":"Total {symbol}{value}","ui.sessionIncludingSubagents":"Session {costTxt} (sous-agents inclus){value}","ui.session":"Session","ui.spendIsTemporarilyUnavailableChat":"Les dépenses sont temporairement indisponibles. La conversation n’est pas affectée.","ui.spendUnavailable":"Dépenses indisponibles","ui.noSignInCredentialsFound":"Aucun identifiant de connexion trouvé pour {serviceName}. Veuillez autoriser à nouveau.","ui.credentialsHaveExpiredPleaseReauthorize":"Les identifiants {serviceName} ont expiré. Veuillez autoriser à nouveau.","ui.deniedAccessReauthorizeOrTry":"{serviceName} a refusé l’accès. Autorisez à nouveau ou réessayez plus tard.","ui.rateLimitReachedPleaseTry":"Limite de requêtes de {serviceName} atteinte. Réessayez plus tard.","ui.timedOutCheckYourConnection":"Délai de {serviceName} dépassé. Vérifiez la connexion et réessayez.","ui.returnedAnUnrecognizedResponsePlease":"{serviceName} a renvoyé une réponse non reconnue. Réessayez plus tard.","ui.isTemporarilyUnavailableCheckYour":"{serviceName} est temporairement indisponible. Vérifiez la connexion et réessayez.","ui.subscriptionExpiresLocalTime":"Expiration de l’abonnement : {value} (heure locale)","ui.expires":"Expiration","ui.subscriptionSource":"Source de l’abonnement : {value} (","ui.prepaidBalance":"Solde disponible","ui.availableBalanceLabel":"Solde disponible","ui.remainingCredits":"Crédits restants","ui.availableBalance":"Solde disponible : {balTxt}","ui.availableCredits":"Crédits restants : {value}","ui.subscriptionSource.titleLines":"Source de l’abonnement : {value}","ui.windowRemainingUsed":"Période {label} : {value} % restants ({usedPercent} % utilisés)","ui.resetsResetsIn":" · Réinitialisation {value} · Dans {value2}","ui.windowRemainingUsedResets":"Période {label} : {value} % restants ({usedPercent} % utilisés) · Réinitialisation {value4}","ui.resetsIn":"Réinitialisation dans","ui.configureItInSettingsModels":". Configurez-le dans Paramètres → Modèles.","ui.deniedAccessTheTokenMay":"{serviceName} a refusé l’accès : le jeton n’a peut-être pas l’autorisation de lire la facturation.","ui.billingIsTemporarilyUnavailableCheck":"La facturation {serviceName} est temporairement indisponible. Vérifiez la connexion et les autorisations, puis réessayez.","ui.billingSource":"Source de facturation : {value}","ui.thisMonthSSpend":"Dépenses du mois : {symbol}{value}","ui.budgetUsed":"Budget utilisé : {value} %","ui.dailyFreeQuotaRemaining":"Quota gratuit quotidien restant : {value}","ui.thisMonth":"Ce mois-ci","ui.thisMonthSUsage":"Utilisation du mois","ui.budget":"Budget","ui.free":"Gratuit","ui.resetsIn.pushBillingGroups":"{value} · Réinitialisation dans {value2}","ui.billingServiceModel":"Service de facturation : {serviceName}\nModèle : {modelLabel}{versionLine}","ui.pricing":"Tarification","ui.spend":"Dépenses","ui.mode":"Mode","ui.subscriptionQuota":"Quota d’abonnement","ui.billing":"Facturation","ui.temporarilyUnavailableKeepingTheLast":": temporairement indisponible. Les dernières données sont conservées ; nouvelle tentative automatique.","ui.spendJournalSavedButThe":"Journal des dépenses enregistré, mais le relevé lisible n’a pas été mis à jour : ","ui.thisSpendRecordWasNot":"Cette dépense n’a pas été enregistrée et ne sera pas ajoutée aux totaux : ","ui.ledgerUpdatePending":"Mise à jour du relevé en attente","ui.spendNotSaved":"Dépense non enregistrée","ui.versionAndUpdateTitle":"Version et mises à jour","ui.versionAndUpdateDesc":"Les mises à jour remplacent uniquement les fichiers du plugin ; les relevés de facturation et les paramètres sont conservés.","ui.versionUnavailable":"Le DSH en cours d’exécution n’a pas encore chargé cette version du plugin ; seule cette ligne peut donc être affichée. Redémarrez DSH pour voir la version active, le mode de mise à jour et le bouton de vérification.","ui.versionRunning":"Version active {version}","ui.versionLatest":"Dernière version {version}","ui.versionLastCheck":"Dernière vérification {time}","ui.versionUnknown":"Inconnue","ui.timeJustNow":"à l’instant","ui.timeMinutesAgo":"il y a {n} min","ui.timeHoursAgo":"il y a {n} h","ui.timeDaysAgo":"il y a {n} j","ui.autoUpdateTitle":"Méthode de mise à jour","ui.updateModeAutoDesc":"Vérifie et installe au démarrage de DSH. En cours d’utilisation, une vérification manuelle demande confirmation avant l’installation.","ui.updateModeManualDesc":"N’installe rien au démarrage. En cours d’utilisation, une vérification manuelle demande confirmation avant l’installation.","ui.updateModeAuto":"Mises à jour automatiques","ui.updateModeManual":"Mises à jour manuelles","ui.updateConfirm":"La version {version} est disponible. Mettre à jour le plugin maintenant ? Redémarrez DSH pour l’appliquer.","ui.updateCheckNow":"Vérifier maintenant","ui.updateChecking":"Vérification…","ui.updateInstallNow":"Mettre à jour vers {version}","ui.updateInstalling":"Mise à jour vers {version}…","ui.updateAvailableNow":"La version {version} est prête ; vous pouvez la mettre à jour maintenant.","ui.updateRollbackFailed":"Le retour à la version précédente a échoué, car aucune sauvegarde utilisable n’existe. Désinstallez puis réinstallez depuis la page des plugins.","ui.updateHostOutdated":"Cette action n’a pas été exécutée : le DSH en cours utilise encore l’ancienne logique de mise à jour. Redémarrez DSH pour que le bouton fonctionne.","ui.updateUpToDate":"À jour.","ui.updateDisabled":"Les mises à jour automatiques sont indisponibles ici","ui.updateDisabledWhy":"Les mises à jour automatiques nécessitent une installation dans le dossier des plugins DSH. Cette copie provient du code source ou d’un lien ; utilisez la commande de mise à jour d’origine.","ui.updatePendingRestart":"Mise à jour vers {version} effectuée. Redémarrez DSH pour l’activer.","ui.updateFailed":"La dernière mise à jour a échoué","ui.updateFallbackWhy":"Si la nouvelle version pose problème, vous pouvez revenir à la précédente.","ui.updateHoldWhy":"Vous avez bloqué cette version ; elle ne sera pas installée automatiquement.","ui.updateErrorIncompleteDownload":"Le téléchargement était incomplet (connexion interrompue). Cette mise à jour a été abandonnée ; votre version reste intacte.","ui.updateErrorIntegrityMismatch":"Le contrôle de sécurité du paquet de mise à jour a échoué ; la mise à jour a été abandonnée. Votre version reste intacte.","ui.updateErrorDownloadFailed":"Impossible de joindre le serveur de mise à jour. Réessayez plus tard.","ui.updateErrorTooLarge":"Le paquet de mise à jour était anormalement volumineux ; la mise à jour a été abandonnée.","ui.updateErrorPayloadMismatch":"Le paquet de mise à jour ne correspondait pas à son numéro de version ; la mise à jour a été abandonnée.","ui.updateErrorPayloadUnsafe":"Le paquet de mise à jour contenait un chemin de fichier inattendu ; la mise à jour a été abandonnée.","ui.updateErrorCheckFailed":"La vérification de version a échoué, peut-être à cause du réseau.","ui.updateErrorUnknown":"La mise à jour a échoué. Les détails figurent dans le journal de mise à jour.","ui.updateRollback":"Revenir à la version précédente","ui.updateRolledBack":"Retour à la version précédente {version} effectué.","ui.updateHeld":"La version {version} est bloquée et ne sera pas installée automatiquement.","ui.updateAllowHeld":"Autoriser la mise à jour vers {version}","ui.updateRestartBadge":"Redémarrer pour appliquer","ui.updateFailedBadge":"Échec de mise à jour","ui.tools":"Outils","ui.avgTTFT":"TTFT moyen","ui.cacheHit":"Succès du cache","ui.cacheHitScope":"Par jeton : {hit} succès / {miss} échecs ({percent} % de succès).\nPérimètre : agent principal de cette session uniquement, hors sous-agents.","ui.tokenScope":"Les entrées/sorties cumulent uniquement l’agent principal de cette session (hors sous-agents) ; les dépenses de session incluent les sous-agents.","ui.spendPartlyUnpriced":"Certains appels n’ont aucun tarif publié (aucun tarif d’un autre modèle n’est substitué) ; le coût réel dépasse le montant affiché.","ui.input.BottomInfoBar":"Entrée","ui.output":"Sortie","ui.savingView":"Enregistrement de l’affichage…","ui.clickToSwitchFullCompact":"Cliquer pour basculer entre affichage complet et compact","ui.pressEnterOrSpaceFor":"Appuyez sur Entrée ou Espace pour l’affichage compact.","ui.pressEnterOrSpaceFor.BottomInfoBar":"Appuyez sur Entrée ou Espace pour l’affichage complet.","host.hour":"5 heures","host.unknownProvider":"Fournisseur inconnu","error.subscription.request-failed":"Échec inattendu de la requête de quota d’abonnement","host.settingsFileCouldNotBe":"Impossible d’enregistrer le fichier de paramètres","error.settings.save-failed":"Impossible d’enregistrer settings.json : {value}","error.balance.credentials":"Impossible de lire les identifiants","error.balance.not-configured":"Non configuré : {credential}","error.balance.account-signed-out":"Le compte intégré est déconnecté","error.balance.account-unavailable":"Cet hôte n’a aucun service de compte intégré","error.balance.account-request-failed":"Impossible de récupérer le solde du compte intégré","error.request.http":"Échec de la requête : HTTP {status}.","error.request.parse":"Format de réponse inattendu","error.subscription.not-connected":"L’abonnement ChatGPT n’est pas connecté : identifiants introuvables dans ~/.codex/auth.json. Installez dsh-chatgpt-sub et connectez-vous.","error.subscription.credentials-missing":"Les identifiants d’abonnement ChatGPT ne contiennent pas id_token. Installez dsh-chatgpt-sub et autorisez à nouveau.","error.subscription.opencode-not-configured":"OpenCode Go n’est pas configuré. Définissez OPENCODE_GO_API_KEY ou utilisez le fichier auth.json d’opencode.","error.subscription.commandcode-not-configured":"Command Code n’est pas configuré. Définissez COMMAND_CODE_API_KEY, CMD_API_KEY, ou connectez-vous via la CLI Command Code.","error.subscription.commandcode-auth-failed":"Les identifiants Command Code ont été refusés. Reconnectez-vous ou mettez à jour la clé API.","error.subscription.commandcode-unrecognized":"Command Code a renvoyé un format de quota non reconnu ; les données précédentes ont été conservées.","host.zhipu":"Zhipu {mapped}","host.zhipu.parseZaiQuota":"Zhipu {value}{value2}","error.subscription.zhipu-not-configured":"La clé API Zhipu n’est pas configurée. Définissez ZAI_API_KEY ou ZAI_CODING_CN_API_KEY.","error.subscription.zhipu-auth-failed":"Échec de l’authentification API Zhipu : la clé est expirée ou invalide.","error.subscription.zhipu-unrecognized":"Zhipu a renvoyé un format de quota non reconnu (l’API a peut-être changé) ; les dernières données connues sont conservées.","error.request.failed":"Échec de la requête : {value} {msg}.","error.subscription.xiaomi-not-configured":"Les identifiants Xiaomi MiMo Token Plan ne sont pas configurés : {credName} ou XIAOMI_API_KEY.","error.subscription.xiaomi-http":"Échec de la requête : HTTP {value}.","error.subscription.minimax-not-configured":"MiniMax n’est pas configuré. Définissez MINIMAX_API_KEY ou MINIMAX_CN_API_KEY. Les requêtes Token Plan nécessitent une Subscription Key ; le serveur refuse les clés API facturées à l’usage.","error.subscription.minimax-auth-failed":"MiniMax a refusé la clé API : les requêtes Token Plan nécessitent une Subscription Key (générée sur la page d’abonnement Token Plan). Les clés facturées à l’usage sont refusées (status_code=1004 / HTTP 401).","error.subscription.minimax-unrecognized":"MiniMax a renvoyé un format de quota non reconnu (l’API a peut-être changé) ; les dernières données connues sont conservées.","error.billing.together-not-configured":"Non configuré : TOGETHER_API_KEY","host.actualMonthlyBillFromThe":"Facture mensuelle réelle issue de l’API Together Usage","error.billing.fireworks-not-configured":"Non configuré : FIREWORKS_API_KEY","error.billing.fireworks-account":"Impossible de lire le compte (account_id manquant)","host.actualBillForThisPeriod":"Facture réelle de cette période (Fireworks Billing Summary)","host.actualUsageForThisPeriod":"Utilisation réelle de cette période (repli billingUsage ; sans montant de dépenses)","error.billing.aws-not-configured":"Non configuré : identifiants AWS (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)","error.billing.aws-http":"Échec de la requête : HTTP {status}. Le jeton n’a peut-être pas l’autorisation ce:GetCostAndUsage","host.actualMonthlyBillFromAWS":"Facture mensuelle réelle issue d’AWS Cost Explorer (environ 24 heures de retard)","error.billing.cloudflare-not-configured":"Non configuré : CLOUDFLARE_API_KEY (nécessite un jeton au niveau du compte avec l’autorisation de lecture Billing)","error.billing.cloudflare-account":"Non configuré : CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"Échec de la requête : HTTP {status}. Le jeton nécessite l’autorisation de lecture Billing","host.actualMonthlyUsageFromThe":"Utilisation mensuelle réelle issue de l’API Cloudflare Billable Usage (Alpha)","error.billing.huggingface-not-configured":"Non configuré : HF_TOKEN (les jetons à permissions fines nécessitent l’autorisation de lecture Billing)","host.actualMonthlyBillFromHF":"Facture mensuelle réelle issue de l’API Hugging Face Billing","error.billing.request-failed":"Échec inattendu de la requête de facturation","host.spendSummaryFileMissingArchived":"Fichier récapitulatif des dépenses manquant : les montants archivés ne sont pas inclus dans les totaux affichés. Les détails restent dans usage-archive/ pour une récupération manuelle.","host.spendLedgerCouldNotBe":"Impossible d’enregistrer le relevé des dépenses","host.usageLedgerBusy":"Une réponse est encore en cours. Effacez les relevés de facturation une fois celle-ci terminée.","error.ledger.clear-failed":"Les relevés de facturation n’ont pas pu être entièrement effacés : {value}","error.ledger.snapshot-stale":"Impossible d’enregistrer les récapitulatifs des dépenses archivées : {value}","host.basedOnYourLastSessions":"D’après vos {count} dernières sessions","host.estimatedFromSpendingOverThe":"Estimation d’après les dépenses des {SPEND_DAYS} derniers jours","host.patchMustIncludeFieldsOr":"patch doit inclure fields, colors, timeZones ou customText","host.timeZonesMustBeAnObject":"timeZones doit être un objet","host.timeZoneMustBeAValid":"Le fuseau horaire doit être une zone IANA valide : {key}","host.customTextMustBeAString":"Le texte personnalisé doit être une chaîne de caractères","host.customTextTooLong":"Le texte personnalisé ne doit pas dépasser 64 caractères","host.quotaDisplayModeInvalid":"Le mode de pourcentage de quota d’abonnement doit être \"used\" ou \"remaining\"","host.infoDensityMustBeFullOrCompact":"L’affichage des informations doit être full ou compact","host.fieldsMustBeAnObject":"fields doit être un objet","host.unknownFieldId":"Identifiant de champ inconnu : {key}","host.fieldVisibilityMustBeA":"La visibilité du champ doit être un booléen : {key}","host.colorsMustBeAnObject":"colors doit être un objet","host.colorMustBeAPreset":"La couleur doit être un nom prédéfini ou #RRGGBB : {key}","field.anchorGroup.label":"Fournisseur et modèle","field.anchorGroup.note":"Affiche le fournisseur et le modèle utilisés dans cette conversation.","field.subServiceGroup.label":"Service d’abonnement et modèle","field.subServiceGroup.note":"Affiche le service d’abonnement et le modèle ou la formule actuels.","field.billingServiceGroup.label":"Service de facturation et modèle","field.billingServiceGroup.note":"Affiche le service de facturation et le modèle actuel.","field.customText.label":"Texte personnalisé","field.customText.note":"Affiche un texte personnalisé comme note ou signature.","field.mainTime.label":"Heure principale","field.mainTime.note":"Affiche le fuseau horaire principal ; modifiez-le dans Heure et date.","field.worldTime.label":"Heure mondiale","field.worldTime.note":"Affiche un autre fuseau horaire.","field.sessionCost.label":"Dépenses de session","field.sessionCost.note":"Affiche les dépenses réelles de cette session, sous-agents inclus.","field.balance.note":"Affiche le solde du compte ; un solde faible est surligné en rouge.","field.period.label":"Période actuelle","field.period.note":"Pour les fournisseurs à tarification heures pleines/creuses, indique la période actuelle.","field.countdown.label":"Prochain changement de tarif","field.countdown.note":"Affiche le temps restant avant le prochain changement de tarif heures pleines/creuses.","field.expiry.label":"Expiration de l’abonnement","field.expiry.note":"Affiché lorsque le fournisseur renvoie une date d’expiration.","field.subWindow5h.label":"Quota de 5 heures","field.subWindow5h.note":"Affiche le quota restant sur une période glissante de 5 heures.","field.subWindowWeek.label":"Quota hebdomadaire","field.subWindowWeek.note":"Affiche le quota hebdomadaire restant.","field.subWindowMonth.label":"Quota mensuel","field.subWindowMonth.note":"Affiche le quota mensuel restant.","field.resetCountdown.label":"Réinitialisation du quota","field.resetCountdown.note":"Affiche le temps restant avant la réinitialisation du quota actuel.","field.subBalance.label":"Solde ou crédits disponibles","field.subBalance.note":"Affiche le solde disponible des comptes facturés à l’usage, ou les crédits restants d’un abonnement sans période de quota visible.","field.billingSpend.label":"Utilisation mensuelle","field.billingSpend.note":"Affiche l’utilisation ou les dépenses réelles de la période de facturation actuelle.","field.budget.label":"État du budget","field.budget.note":"Affiché lorsque le fournisseur indique un pourcentage de budget.","field.freeQuota.label":"Quota gratuit","field.freeQuota.note":"Affiché lorsque le fournisseur propose un quota gratuit, avec le montant restant et l’heure de réinitialisation.","field.turnsSteps.label":"Tours et étapes","field.turnsSteps.note":"Affiche les tours et étapes de cette session.","field.llmTime.label":"Temps du modèle","field.llmTime.note":"Affiche le temps total d’inférence du modèle.","field.toolTime.label":"Temps des outils","field.toolTime.note":"Affiche le temps total d’exécution des outils.","field.avgTTFT.label":"Délai moyen avant le premier jeton","field.avgTTFT.note":"Affiche le délai moyen avant le premier jeton sur les étapes du modèle de cette session.","field.outputSpeed.label":"Vitesse de sortie","field.outputSpeed.note":"Affiche la vitesse moyenne de sortie des étapes du modèle qui déclarent leur utilisation dans cette session (jetons/s).","field.cacheHit.note":"Affiche le taux de succès du cache de prompts.","field.tokensIO.label":"Jetons en entrée / sortie","field.tokensIO.note":"Affiche le total des jetons en entrée/sortie de cette session.","field.contextUsage.label":"Utilisation du contexte","field.contextUsage.note":"Affiche l’utilisation du contexte ; plus l’anneau est rempli, moins il reste d’espace pour écrire.","ui.contextAria":"{percent} du contexte utilisé","ui.contextUsed":"Contexte utilisé","ui.contextSystem":"Prompt système","ui.contextTools":"Définitions des outils","ui.contextMessages":"Messages de la conversation","ui.contextFigures":"~{used} / {window}","number.thousand":"{value}k","number.million":"{value}M","field.unmapped.label":"État des données du compte","field.unmapped.note":"Affiché lorsqu’un fournisseur est inconnu ou sans point d’accès public au solde/quota ; le suivi local de l’utilisation fonctionne toujours.","field.noKeyHint.label":"Indication de clé manquante","field.noKeyHint.note":"Affiché lorsqu’une clé API manque, avec son emplacement de configuration.","field.balanceError.label":"Erreur d’actualisation du solde","field.balanceError.note":"Affiché lorsque l’actualisation du solde échoue.","field.usageError.label":"Erreur d’actualisation de l’utilisation","field.usageError.note":"Affiché lorsque les données de dépenses sont temporairement indisponibles.","field.refreshFailure.label":"Erreur d’actualisation","field.refreshFailure.note":"Affiché lorsqu’une actualisation des données échoue.","field.persistWarning.label":"Alerte de relevé non enregistré","field.persistWarning.note":"Affiché lorsque les relevés de facturation ne peuvent pas être enregistrés ; recommandé.","field.updateNotice.label":"Avis de mise à jour","field.updateNotice.note":"Affiche un indicateur lorsqu’une nouvelle version est prête ou qu’une version téléchargée attend un redémarrage.","field.updateFailure.label":"Avis d’échec de mise à jour","field.updateFailure.note":"Affiche un indicateur lorsque la mise à jour automatique a échoué.","group.native":"Informations natives","group.plugin":"Informations du plugin","group.notice":"Avis","group.native.desc":"Champs déjà présents dans la barre DSH. Ils se trouvent dans la ligne native des statistiques, visible uniquement en mode complet.","group.plugin.desc":"Champs ajoutés par ce plugin, y compris l’anneau de contexte repris. Ils se trouvent dans la ligne principale, visible dans les deux modes.","group.notice.desc":"Avis ponctuels comme les mises à jour et les erreurs. Ils apparaissent uniquement lorsqu’il y a quelque chose à signaler, quel que soit le mode.","section.identity.label":"Fournisseur et modèle","section.identity.desc":"Affiché quel que soit le mode de paiement : le service et le modèle utilisés pour cette conversation.","section.subscription.label":"Abonnement : formule mensuelle avec quota","section.subscription.desc":"Une formule comme ChatGPT ne renseigne que les éléments suivants : périodes de quota, réinitialisation, date d’expiration et solde disponible.","section.balance.label":"Solde prépayé : recharge puis déduction à l’usage","section.balance.desc":"Ces fournisseurs ne renseignent que les éléments suivants : solde, dépenses de session, période actuelle et prochain changement de tarif.","section.billing.label":"Utilisation facturée : utilisation puis facture mensuelle","section.billing.desc":"Ces fournisseurs ne renseignent que les éléments suivants : utilisation du mois, budget et quota gratuit.","section.common.label":"Éléments généraux","section.common.desc":"Sans lien avec la facturation, utiles pour tout fournisseur : texte personnalisé, horloges, utilisation du contexte.","ui.listSeparator":", ","ui.sentenceEnd":".","ui.fieldErrorPrefix":"« {label} » : ","ui.turnCount":"{count} tour","ui.turnCountPlural":"{count} tours","ui.stepCount":"{count} étape","ui.stepCountPlural":"{count} étapes","ui.mainTimeZone":"Fuseau horaire principal","ui.worldTimeZone":"Fuseau horaire mondial","ui.customTextTitle":"Texte personnalisé","ui.customTextPlaceholder":"Saisir du texte (64 caractères maximum)","ui.searchPlaceholder":"Rechercher par nom ou description…","ui.searchFieldsLabel":"Rechercher dans les éléments affichables","ui.searchResultCount":"{count} résultats","ui.enabledFieldsCount":"{count} activés","ui.noSearchResults":"Aucun paramètre correspondant trouvé","ui.mainTime":"Heure principale","ui.worldTime":"Heure mondiale","ui.customText":"Texte personnalisé","language.title":"Langue","language.description":"Suivre DSH ou choisir une langue pour ce plugin dans ce navigateur.","language.auto":"Suivre DSH","language.saveFailed":"Impossible d’enregistrer la préférence de langue. Autorisez le stockage local et réessayez."},"de":{"meta.title":"Untere Infoleiste","meta.description":"Zeigt das aktuelle Modell, Guthaben und Ausgaben unter dem Eingabefeld.","ui.requestTimedOut":"Zeitüberschreitung der Anfrage","ui.requestCanceled":"Anfrage abgebrochen","ui.couldNotParseResponse":"Antwort konnte nicht ausgewertet werden","ui.rpcFailed":"RPC fehlgeschlagen","ui.refreshFailed":"Aktualisierung fehlgeschlagen","color.red":"Rot","color.green":"Grün","color.blue":"Blau","color.purple":"Violett","color.orange":"Orange","color.neutral":"Neutral","ui.pleaseTryAgainLater":"Bitte später erneut versuchen","ui.restoreDefaultColor":"Standardfarbe wiederherstellen","ui.infoBarSettings":"Infoleiste","ui.settingsAreTemporarilyUnavailable":"Einstellungen sind vorübergehend nicht verfügbar","ui.loadingInfoBarSettings":"Einstellungen werden geladen…","ui.couldNotLoadInfoBar":"Einstellungen der Infoleiste konnten nicht geladen werden: ","ui.changesAppliedButCouldNot":"Angewendet, aber lokal nicht gespeichert: ","ui.unknownReason":"Unbekannter Grund","ui.couldNotSave":"{errorPrefix}Speichern fehlgeschlagen: {value}","ui.color":"Farbe für „{value}“: ","ui.hasAnInvalidColorEnter":"„{value}“ hat eine ungültige Farbe. #RRGGBB eingeben (zum Beispiel #0044CC).","ui.defaultColorsRestored":"Standardfarben wiederhergestellt","ui.defaultLabelsRestored":"Standardanzeige wiederhergestellt","ui.couldNotReset":"Zurücksetzen fehlgeschlagen: {value}","ui.show":"{label} anzeigen","ui.clickToHide":"Zum Ausblenden klicken","ui.clickToShow":"Zum Anzeigen klicken","ui.presetColor":"Voreingestellte Farbe für {label}","ui.customColor":"Benutzerdefinierte Farbe für {label}","ui.customColorOpenColorPicker":"Benutzerdefinierte Farbe (Farbauswahl öffnen)","ui.customColorItem":"Benutzerdefiniert…","ui.colorSwatchLabel":"Farbe für {label}","ui.hexColor":"Hex-Farbe für {label}","ui.expand":"Aufklappen","ui.collapse":"Einklappen","ui.saving":"Wird gespeichert…","ui.processing":"Wird verarbeitet…","ui.visibleFields":"Anzuzeigende Informationen","ui.timeDateTitle":"Uhrzeit und Datum","ui.timeDateDesc":"Zeitzonen für Haupt- und Weltzeit.","ui.customTextSectionDesc":"Zeigt eine Zeile eigenen Text in der Infoleiste.","ui.resetConfirmTitle":"Einstellungen der Infoleiste zurücksetzen","ui.resetConfirmDescFields":"Setzt alle Anzeigeoptionen auf die Standardwerte zurück. Eigene Farben bleiben erhalten; die Änderung gilt sofort.","ui.resetConfirmDescColors":"Alle eigenen Farben werden gelöscht und die Standardfarben wiederhergestellt. Feldschalter bleiben unverändert. Dies gilt sofort für die Infoleiste.","ui.resetConfirmAcknowledge":"Ich verstehe, dass dieses Zurücksetzen nicht rückgängig gemacht werden kann","ui.resetConfirmCancel":"Abbrechen","ui.resetConfirmConfirm":"Zurücksetzen","ui.resetLabels":"Anzeige wiederherstellen","ui.resetColors":"Farben wiederherstellen","ui.resetRowTitle":"Standardwerte wiederherstellen","ui.resetRowDesc":"Angezeigte Elemente oder Farben auf Standardwerte zurücksetzen.","ui.customTextCount":"{value}/64 Zeichen","ui.couldNotDisplayInfoBar":"Einstellungen der Infoleiste konnten nicht angezeigt werden: {value}","ui.dataAndBilling":"Abrechnungsdaten","ui.dataAndBillingDesc":"Die vom Plugin gespeicherten Nutzungs- und Ausgabenaufzeichnungen exportieren oder löschen.","ui.exportBillingRecords":"Abrechnung exportieren","ui.exportBillingRecordsDesc":"Aufzeichnungen als CSV- oder JSON-Datei exportieren.","ui.exportBillingCsv":"CSV exportieren","ui.exportBillingJson":"JSON exportieren","ui.clearBillingRecords":"Abrechnung löschen","ui.clearBillingRecordsDesc":"Dies kann nicht rückgängig gemacht werden.","ui.clearBillingRecordsConfirm":"Alle vom Plugin gespeicherten Abrechnungsaufzeichnungen löschen? Zuerst exportieren. Dies ist nicht rückgängig zu machen; Einstellungen und Anmeldedaten bleiben erhalten.","ui.exportedBillingRecords":"{count} Abrechnungsaufzeichnungen exportiert ({format})","ui.noBillingRecordsToExport":"Es gibt keine Abrechnungsaufzeichnungen zum Exportieren.","ui.exportFailed":"Export fehlgeschlagen: {value}","ui.exportIncomplete":"Einige ältere Abrechnungsaufzeichnungen konnten nicht gelesen werden: {value}. Es wurde nichts exportiert; bitte später erneut versuchen.","ui.clearFailed":"Abrechnungsaufzeichnungen konnten nicht gelöscht werden: {value}","ui.clearFailedWithoutDetails":"Abrechnungsaufzeichnungen konnten nicht vollständig gelöscht werden","ui.clearedBillingRecords":"{count} Abrechnungsaufzeichnungen gelöscht","ui.clearCanceled":"Abgebrochen","ui.exportNotSupported":"Dateidownloads werden in dieser Umgebung nicht unterstützt.","ui.weekly":"Wöchentlich","ui.monthly":"Monatlich","ui.window":"Zeitfenster","ui.quotaDisplayUsed":"Verbraucht","ui.quotaDisplayRemaining":"Verbleibend","ui.quotaDisplayModeTitle":"Prozentanzeige der Abonnement-Zeitfenster","ui.quotaDisplayModeDesc":"Abonnementkontingente als verbleibend oder verbraucht anzeigen. Die Warnung bei niedrigem Kontingent erscheint immer, wenn weniger als 20 % übrig sind.","ui.windowUsedRemaining":"Zeitfenster {label}: {usedPercent} % verbraucht ({value} % verbleibend)","ui.windowUsedRemainingResets":"Zeitfenster {label}: {usedPercent} % verbraucht ({value} % verbleibend) · Zurücksetzung {value4}","ui.minimax":"MiniMax","ui.supportsImageInput":"Unterstützt Bildeingaben.","ui.vision":"Bilderkennung","ui.unknown":"Unbekannt","ui.unknownModel":"Unbekanntes Modell","ui.modelSelectionPending":"Aktuelles Modell wird ermittelt","ui.modelCapabilityPending":"Unterstützung für Bildeingaben wird geprüft","ui.pluginVersion":"\nPlugin-Version: {current}","ui.provider":"Anbieter: {provLabel} {modelLabel}\n","ui.pricingPeakOffPeakBeijing":"Preise: Spitzen-/Nebenzeiten (Pekinger Zeit; werktags Spitzenzeiten 09:00-12:00 und 14:00-18:00; an Wochenenden und chinesischen Feiertagen Nebenzeiten)","ui.pricingFixed":"Preise: fest","ui.pricingNotListedUsingDefaults":"Preise: nicht angegeben; Ausgaben werden nicht berechnet","ui.zhipu":"Zhipu","ui.xiaomiMiMo":"Xiaomi MiMo","ui.commandCode":"Command Code","ui.subscription":"Abonnement","ui.cloudBilling":"Cloud-Abrechnung","ui.plan":"\nTarif: {plan}","ui.expiresLocalTime":"\nLäuft ab: {value} (Ortszeit)","ui.subscriptionServiceModel":"Abonnementdienst: {serviceName}\nModell: {rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.balanceLookupIsNotYet":"Das Guthaben dieses Anbieters ist noch nicht verfügbar.","ui.notSupported":"Nicht unterstützt","ui.accountDataUnavailable":"Keine öffentlichen Kontodaten","ui.accountDataUnavailableDetail":"Dieser Anbieter unterstützt Modellerkennung und lokale Nutzungserfassung, bietet jedoch keinen öffentlichen Guthaben- oder Kontingent-Endpunkt, den das Plugin sicher abfragen kann.","ui.notConfigured":"Nicht eingerichtet: ","ui.notConfiguredConfigureItIn":"Nicht eingerichtet: {credName}. Unter Einstellungen → Modelle einrichten.","ui.notConfiguredSettingsModels":"{credName} ist nicht eingerichtet. Unter Einstellungen → Modelle hinzufügen.","ui.accountSignedOut":"Konto abgemeldet","ui.accountSignedOutHow":"In den DSH-Einstellungen unter Konto bei DeepSeek anmelden; das Guthaben erscheint dann hier.","ui.estimatedBalance":"Geschätztes Guthaben: {symbol}{value}","ui.balance":"Guthaben: {symbol}{value}","ui.balanceDetailToppedUp":"Aufgeladenes Guthaben: {symbol}{value}","ui.balanceDetailGranted":"Gewährtes Guthaben: {symbol}{value}","ui.balance.pushBalanceGroups":"Guthaben","ui.low":"Niedrig","ui.estimated":"(geschätzt)","ui.balanceIsTemporarilyUnavailableShowing":"Guthaben ist vorübergehend nicht verfügbar. Die letzten Daten werden angezeigt; der Abruf wird automatisch wiederholt.","ui.couldNotLoadBalanceCheck":"Guthaben konnte nicht geladen werden. Verbindung und API-Schlüssel prüfen.","ui.balanceUnavailable":"Guthaben nicht verfügbar","ui.beijingTime":"Pekinger Zeit: ","ui.peakPrice":"Spitzenpreis","ui.offPeakPrice":"Nebenzeitpreis","ui.input":": Eingabe ¥","ui.mCachedInput":"/M · zwischengespeicherte Eingabe ¥","ui.mOutput":"/M · Ausgabe ¥","ui.beijingTimeSwitchesTo":"Pekinger Zeit: {atLabel}, Wechsel zu ","ui.until":"Bis ","ui.offPeak":"Nebenzeiten","ui.peak":"Spitzenzeiten","ui.today":"Heute {symbol}{value}","ui.lastDays":"Letzte 30 Tage {symbol}{value}","ui.allTime":"Gesamt {symbol}{value}","ui.sessionIncludingSubagents":"Sitzung {costTxt} (einschließlich Unteragenten){value}","ui.session":"Sitzung","ui.spendIsTemporarilyUnavailableChat":"Ausgaben sind vorübergehend nicht verfügbar. Der Chat bleibt nutzbar.","ui.spendUnavailable":"Ausgaben nicht verfügbar","ui.noSignInCredentialsFound":"Keine Anmeldedaten für {serviceName} gefunden. Bitte erneut autorisieren.","ui.credentialsHaveExpiredPleaseReauthorize":"Die Anmeldedaten für {serviceName} sind abgelaufen. Bitte erneut autorisieren.","ui.deniedAccessReauthorizeOrTry":"{serviceName} hat den Zugriff verweigert. Erneut autorisieren oder später erneut versuchen.","ui.rateLimitReachedPleaseTry":"Anfragelimit von {serviceName} erreicht. Bitte später erneut versuchen.","ui.timedOutCheckYourConnection":"Zeitüberschreitung bei {serviceName}. Verbindung prüfen und erneut versuchen.","ui.returnedAnUnrecognizedResponsePlease":"{serviceName} hat eine unbekannte Antwort geliefert. Bitte später erneut versuchen.","ui.isTemporarilyUnavailableCheckYour":"{serviceName} ist vorübergehend nicht verfügbar. Verbindung prüfen und erneut versuchen.","ui.subscriptionExpiresLocalTime":"Abonnement läuft ab: {value} (Ortszeit)","ui.expires":"Läuft ab","ui.subscriptionSource":"Abonnementquelle: {value} (","ui.prepaidBalance":"Verfügbares Guthaben","ui.availableBalanceLabel":"Verfügbares Guthaben","ui.remainingCredits":"Verbleibende Credits","ui.availableBalance":"Verfügbares Guthaben: {balTxt}","ui.availableCredits":"Verbleibende Credits: {value}","ui.subscriptionSource.titleLines":"Abonnementquelle: {value}","ui.windowRemainingUsed":"Zeitfenster {label}: {value} % verbleibend ({usedPercent} % verbraucht)","ui.resetsResetsIn":" · Zurücksetzung {value} · In {value2}","ui.windowRemainingUsedResets":"Zeitfenster {label}: {value} % verbleibend ({usedPercent} % verbraucht) · Zurücksetzung {value4}","ui.resetsIn":"Zurücksetzung in","ui.configureItInSettingsModels":". Unter Einstellungen → Modelle einrichten.","ui.deniedAccessTheTokenMay":"{serviceName} hat den Zugriff verweigert: Dem Token fehlen möglicherweise Leserechte für die Abrechnung.","ui.billingIsTemporarilyUnavailableCheck":"Die Abrechnung von {serviceName} ist vorübergehend nicht verfügbar. Verbindung und Berechtigungen prüfen und erneut versuchen.","ui.billingSource":"Abrechnungsquelle: {value}","ui.thisMonthSSpend":"Ausgaben diesen Monat: {symbol}{value}","ui.budgetUsed":"Budget verbraucht: {value} %","ui.dailyFreeQuotaRemaining":"Verbleibendes tägliches Freikontingent: {value}","ui.thisMonth":"Diesen Monat","ui.thisMonthSUsage":"Nutzung diesen Monat","ui.budget":"Budget","ui.free":"Kostenlos","ui.resetsIn.pushBillingGroups":"{value} · Zurücksetzung in {value2}","ui.billingServiceModel":"Abrechnungsdienst: {serviceName}\nModell: {modelLabel}{versionLine}","ui.pricing":"Preise","ui.spend":"Ausgaben","ui.mode":"Modus","ui.subscriptionQuota":"Abonnementkontingent","ui.billing":"Abrechnung","ui.temporarilyUnavailableKeepingTheLast":": vorübergehend nicht verfügbar. Die letzten Daten bleiben erhalten; der Abruf wird automatisch wiederholt.","ui.spendJournalSavedButThe":"Ausgabenjournal gespeichert, aber die lesbare Übersicht wurde nicht aktualisiert: ","ui.thisSpendRecordWasNot":"Dieser Ausgabeneintrag wurde nicht gespeichert und wird nicht zu den Summen hinzugefügt: ","ui.ledgerUpdatePending":"Aktualisierung der Übersicht ausstehend","ui.spendNotSaved":"Ausgabe nicht gespeichert","ui.versionAndUpdateTitle":"Version und Updates","ui.versionAndUpdateDesc":"Updates ersetzen nur die eigenen Plugin-Dateien; Abrechnungsaufzeichnungen und Einstellungen bleiben erhalten.","ui.versionUnavailable":"Das laufende DSH hat diese Plugin-Version noch nicht geladen, daher erscheint hier nur diese Zeile. DSH neu starten, um die aktive Version, den Updatemodus und die Prüfschaltfläche zu sehen.","ui.versionRunning":"Aktive Version {version}","ui.versionLatest":"Neueste Version {version}","ui.versionLastCheck":"Zuletzt geprüft {time}","ui.versionUnknown":"Unbekannt","ui.timeJustNow":"gerade eben","ui.timeMinutesAgo":"vor {n} Min.","ui.timeHoursAgo":"vor {n} Std.","ui.timeDaysAgo":"vor {n} Tagen","ui.autoUpdateTitle":"Updatemethode","ui.updateModeAutoDesc":"Prüft und installiert beim Start von DSH. Während der Nutzung fragt eine manuelle Prüfung vor der Installation nach.","ui.updateModeManualDesc":"Installiert nicht beim Start. Während der Nutzung fragt eine manuelle Prüfung vor der Installation nach.","ui.updateModeAuto":"Automatische Updates","ui.updateModeManual":"Manuelle Updates","ui.updateConfirm":"Version {version} ist verfügbar. Plugin jetzt aktualisieren? DSH neu starten, um sie zu aktivieren.","ui.updateCheckNow":"Jetzt prüfen","ui.updateChecking":"Wird geprüft…","ui.updateInstallNow":"Auf {version} aktualisieren","ui.updateInstalling":"Wird auf {version} aktualisiert…","ui.updateAvailableNow":"Version {version} ist bereit; sie kann jetzt installiert werden.","ui.updateRollbackFailed":"Die Wiederherstellung ist fehlgeschlagen, da keine nutzbare Sicherung vorhanden ist. Auf der Plugin-Seite deinstallieren und neu installieren.","ui.updateHostOutdated":"Diese Aktion wurde nicht ausgeführt: Das laufende DSH nutzt noch die alte Updatelogik. DSH neu starten, damit die Schaltfläche funktioniert.","ui.updateUpToDate":"Aktuell.","ui.updateDisabled":"Automatische Updates sind hier nicht verfügbar","ui.updateDisabledWhy":"Automatische Updates benötigen eine Installation im DSH-Pluginverzeichnis. Diese Kopie stammt aus einem Quellcodeverzeichnis oder einer Verknüpfung; den ursprünglichen Updatebefehl verwenden.","ui.updatePendingRestart":"Auf {version} aktualisiert. DSH zur Aktivierung neu starten.","ui.updateFailed":"Das letzte Update ist fehlgeschlagen","ui.updateFallbackWhy":"Falls die neue Version Probleme verursacht, kann die vorherige wiederhergestellt werden.","ui.updateHoldWhy":"Diese Version wurde von dir zurückgehalten und wird nicht automatisch installiert.","ui.updateErrorIncompleteDownload":"Der Download war unvollständig (Verbindung unterbrochen). Das Update wurde abgebrochen; die vorhandene Version bleibt unverändert.","ui.updateErrorIntegrityMismatch":"Das Updatepaket hat die Sicherheitsprüfung nicht bestanden und wurde verworfen. Die vorhandene Version bleibt unverändert.","ui.updateErrorDownloadFailed":"Updateserver nicht erreichbar. Bitte später erneut versuchen.","ui.updateErrorTooLarge":"Das Updatepaket war ungewöhnlich groß und wurde verworfen.","ui.updateErrorPayloadMismatch":"Das Updatepaket passte nicht zur Versionsnummer und wurde verworfen.","ui.updateErrorPayloadUnsafe":"Das Updatepaket enthielt einen unerwarteten Dateipfad und wurde verworfen.","ui.updateErrorCheckFailed":"Die Versionsprüfung ist fehlgeschlagen, möglicherweise wegen eines Netzwerkproblems.","ui.updateErrorUnknown":"Das Update ist fehlgeschlagen. Details stehen im Updateprotokoll.","ui.updateRollback":"Vorherige Version wiederherstellen","ui.updateRolledBack":"Vorherige Version {version} wiederhergestellt.","ui.updateHeld":"Version {version} wird zurückgehalten und nicht automatisch installiert.","ui.updateAllowHeld":"Update auf {version} erlauben","ui.updateRestartBadge":"Neustart erforderlich","ui.updateFailedBadge":"Update fehlgeschlagen","ui.tools":"Werkzeuge","ui.avgTTFT":"Durchschn. TTFT","ui.cacheHit":"Cache-Treffer","ui.cacheHitScope":"Nach Token: {hit} Treffer / {miss} Fehltreffer ({percent} % Treffer).\nUmfang: nur der Hauptagent dieser Sitzung, ohne Unteragenten.","ui.tokenScope":"Eingabe/Ausgabe summiert nur den Hauptagenten dieser Sitzung (ohne Unteragenten); Sitzungskosten enthalten Unteragenten.","ui.spendPartlyUnpriced":"Für einige Aufrufe ist kein Preis angegeben (es wird kein Preis eines anderen Modells eingesetzt); die tatsächlichen Kosten sind höher als angezeigt.","ui.input.BottomInfoBar":"Eingabe","ui.output":"Ausgabe","ui.savingView":"Ansicht wird gespeichert…","ui.clickToSwitchFullCompact":"Klicken, um zwischen vollständiger und kompakter Ansicht zu wechseln","ui.pressEnterOrSpaceFor":"Enter oder Leertaste für die kompakte Ansicht drücken.","ui.pressEnterOrSpaceFor.BottomInfoBar":"Enter oder Leertaste für die vollständige Ansicht drücken.","host.hour":"5 Stunden","host.unknownProvider":"Unbekannter Anbieter","error.subscription.request-failed":"Unerwarteter Fehler bei der Abfrage des Abonnementkontingents","host.settingsFileCouldNotBe":"Einstellungsdatei konnte nicht gespeichert werden","error.settings.save-failed":"settings.json konnte nicht gespeichert werden: {value}","error.balance.credentials":"Anmeldedaten konnten nicht gelesen werden","error.balance.not-configured":"Nicht eingerichtet: {credential}","error.balance.account-signed-out":"Das integrierte Konto ist abgemeldet","error.balance.account-unavailable":"Dieser Host hat keinen integrierten Kontodienst","error.balance.account-request-failed":"Guthaben des integrierten Kontos konnte nicht abgerufen werden","error.request.http":"Anfrage fehlgeschlagen: HTTP {status}.","error.request.parse":"Unerwartetes Antwortformat","error.subscription.not-connected":"ChatGPT-Abonnement nicht verbunden: keine Anmeldedaten in ~/.codex/auth.json gefunden. dsh-chatgpt-sub installieren und anmelden.","error.subscription.credentials-missing":"In den ChatGPT-Abonnement-Anmeldedaten fehlt id_token. dsh-chatgpt-sub installieren und erneut autorisieren.","error.subscription.opencode-not-configured":"OpenCode Go ist nicht eingerichtet. OPENCODE_GO_API_KEY setzen oder opencode auth.json verwenden.","error.subscription.commandcode-not-configured":"Command Code ist nicht eingerichtet. COMMAND_CODE_API_KEY oder CMD_API_KEY setzen oder über die Command Code CLI anmelden.","error.subscription.commandcode-auth-failed":"Command Code-Anmeldedaten wurden abgelehnt. Erneut anmelden oder API-Schlüssel aktualisieren.","error.subscription.commandcode-unrecognized":"Command Code hat ein unbekanntes Kontingentformat geliefert; die vorherigen Daten bleiben erhalten.","host.zhipu":"Zhipu {mapped}","host.zhipu.parseZaiQuota":"Zhipu {value}{value2}","error.subscription.zhipu-not-configured":"Zhipu-API-Schlüssel ist nicht eingerichtet. ZAI_API_KEY oder ZAI_CODING_CN_API_KEY setzen.","error.subscription.zhipu-auth-failed":"Zhipu-API-Authentifizierung fehlgeschlagen: Der Schlüssel ist abgelaufen oder ungültig.","error.subscription.zhipu-unrecognized":"Zhipu hat ein unbekanntes Kontingentformat geliefert (die API könnte sich geändert haben); die letzten bekannten Daten bleiben erhalten.","error.request.failed":"Anfrage fehlgeschlagen: {value} {msg}.","error.subscription.xiaomi-not-configured":"Xiaomi MiMo Token Plan-Anmeldedaten sind nicht eingerichtet: {credName} oder XIAOMI_API_KEY.","error.subscription.xiaomi-http":"Anfrage fehlgeschlagen: HTTP {value}.","error.subscription.minimax-not-configured":"MiniMax ist nicht eingerichtet. MINIMAX_API_KEY oder MINIMAX_CN_API_KEY setzen. Token Plan-Abfragen benötigen einen Subscription Key; nutzungsabhängige API-Schlüssel werden vom Server abgelehnt.","error.subscription.minimax-auth-failed":"MiniMax hat den API-Schlüssel abgelehnt: Token Plan-Abfragen benötigen einen Subscription Key (auf der Token Plan-Abonnementseite erzeugt). Nutzungsabhängige Schlüssel werden abgelehnt (status_code=1004 / HTTP 401).","error.subscription.minimax-unrecognized":"MiniMax hat ein unbekanntes Kontingentformat geliefert (die API könnte sich geändert haben); die letzten bekannten Daten bleiben erhalten.","error.billing.together-not-configured":"Nicht eingerichtet: TOGETHER_API_KEY","host.actualMonthlyBillFromThe":"Tatsächliche Monatsabrechnung aus der Together Usage API","error.billing.fireworks-not-configured":"Nicht eingerichtet: FIREWORKS_API_KEY","error.billing.fireworks-account":"Konto konnte nicht gelesen werden (account_id fehlt)","host.actualBillForThisPeriod":"Tatsächliche Abrechnung dieses Zeitraums (Fireworks Billing Summary)","host.actualUsageForThisPeriod":"Tatsächliche Nutzung dieses Zeitraums (billingUsage als Ersatz; ohne Ausgabenbetrag)","error.billing.aws-not-configured":"Nicht eingerichtet: AWS-Anmeldedaten (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)","error.billing.aws-http":"Anfrage fehlgeschlagen: HTTP {status}. Dem Token fehlt möglicherweise die Berechtigung ce:GetCostAndUsage","host.actualMonthlyBillFromAWS":"Tatsächliche Monatsabrechnung aus AWS Cost Explorer (etwa 24 Stunden verzögert)","error.billing.cloudflare-not-configured":"Nicht eingerichtet: CLOUDFLARE_API_KEY (Kontotoken mit Billing-Leseberechtigung erforderlich)","error.billing.cloudflare-account":"Nicht eingerichtet: CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"Anfrage fehlgeschlagen: HTTP {status}. Der Token benötigt Billing-Leseberechtigung","host.actualMonthlyUsageFromThe":"Tatsächliche Monatsnutzung aus der Cloudflare Billable Usage API (Alpha)","error.billing.huggingface-not-configured":"Nicht eingerichtet: HF_TOKEN (feingranulare Tokens benötigen Billing-Leseberechtigung)","host.actualMonthlyBillFromHF":"Tatsächliche Monatsabrechnung aus der Hugging Face Billing API","error.billing.request-failed":"Unerwarteter Fehler bei der Abrechnungsabfrage","host.spendSummaryFileMissingArchived":"Ausgabenübersicht fehlt: Archivierte Beträge sind nicht in den angezeigten Summen enthalten. Details bleiben in usage-archive/ zur manuellen Wiederherstellung.","host.spendLedgerCouldNotBe":"Ausgabenübersicht konnte nicht gespeichert werden","host.usageLedgerBusy":"Eine Antwort läuft noch. Abrechnungsaufzeichnungen erst nach deren Abschluss löschen.","error.ledger.clear-failed":"Abrechnungsaufzeichnungen konnten nicht vollständig gelöscht werden: {value}","error.ledger.snapshot-stale":"Archivierte Ausgabenübersichten konnten nicht gespeichert werden: {value}","host.basedOnYourLastSessions":"Basierend auf deinen letzten {count} Sitzungen","host.estimatedFromSpendingOverThe":"Geschätzt anhand der Ausgaben der letzten {SPEND_DAYS} Tage","host.patchMustIncludeFieldsOr":"patch muss fields, colors, timeZones oder customText enthalten","host.timeZonesMustBeAnObject":"timeZones muss ein Objekt sein","host.timeZoneMustBeAValid":"Zeitzone muss eine gültige IANA-Zone sein: {key}","host.customTextMustBeAString":"Eigener Text muss eine Zeichenkette sein","host.customTextTooLong":"Eigener Text darf 64 Zeichen nicht überschreiten","host.quotaDisplayModeInvalid":"Der Prozentmodus für Abonnement-Zeitfenster muss \"used\" oder \"remaining\" sein","host.infoDensityMustBeFullOrCompact":"Die Informationsanzeige muss full oder compact sein","host.fieldsMustBeAnObject":"fields muss ein Objekt sein","host.unknownFieldId":"Unbekannte Feld-ID: {key}","host.fieldVisibilityMustBeA":"Feldsichtbarkeit muss ein boolescher Wert sein: {key}","host.colorsMustBeAnObject":"colors muss ein Objekt sein","host.colorMustBeAPreset":"Farbe muss ein voreingestellter Name oder #RRGGBB sein: {key}","field.anchorGroup.label":"Anbieter und Modell","field.anchorGroup.note":"Zeigt Anbieter und Modell dieser Unterhaltung.","field.subServiceGroup.label":"Abonnementdienst und Modell","field.subServiceGroup.note":"Zeigt den Abonnementdienst und das aktuelle Modell oder den Tarif.","field.billingServiceGroup.label":"Abrechnungsdienst und Modell","field.billingServiceGroup.note":"Zeigt den Abrechnungsdienst und das aktuelle Modell.","field.customText.label":"Eigener Text","field.customText.note":"Zeigt eigenen Text als Notiz oder Signatur.","field.mainTime.label":"Hauptzeit","field.mainTime.note":"Zeigt die Hauptzeitzone; unter Uhrzeit und Datum anpassen.","field.worldTime.label":"Weltzeit","field.worldTime.note":"Zeigt eine weitere Zeitzone.","field.sessionCost.label":"Sitzungsausgaben","field.sessionCost.note":"Zeigt die tatsächlichen Ausgaben dieser Sitzung einschließlich Unteragenten.","field.balance.note":"Zeigt das Kontoguthaben; niedriges Guthaben wird rot hervorgehoben.","field.period.label":"Aktueller Zeitraum","field.period.note":"Zeigt bei Anbietern mit Spitzen-/Nebenzeitpreisen den aktuellen Zeitraum.","field.countdown.label":"Nächste Preisänderung","field.countdown.note":"Zeigt die Zeit bis zum nächsten Wechsel zwischen Spitzen- und Nebenzeitpreisen.","field.expiry.label":"Abonnementablauf","field.expiry.note":"Wird angezeigt, wenn der Anbieter ein Ablaufdatum liefert.","field.subWindow5h.label":"5-Stunden-Kontingent","field.subWindow5h.note":"Zeigt das verbleibende Kontingent im rollierenden 5-Stunden-Zeitfenster.","field.subWindowWeek.label":"Wöchentliches Kontingent","field.subWindowWeek.note":"Zeigt das verbleibende wöchentliche Kontingent.","field.subWindowMonth.label":"Monatliches Kontingent","field.subWindowMonth.note":"Zeigt das verbleibende monatliche Kontingent.","field.resetCountdown.label":"Kontingentzurücksetzung","field.resetCountdown.note":"Zeigt die verbleibende Zeit bis zur Zurücksetzung des aktuellen Kontingents.","field.subBalance.label":"Verfügbares Guthaben oder Credits","field.subBalance.note":"Zeigt das verfügbare Guthaben nutzungsabhängiger Konten oder verbleibende Credits bei Abonnements ohne sichtbares Kontingent-Zeitfenster.","field.billingSpend.label":"Monatliche Nutzung","field.billingSpend.note":"Zeigt tatsächliche Nutzung oder Ausgaben des aktuellen Abrechnungszeitraums.","field.budget.label":"Budgetstatus","field.budget.note":"Wird angezeigt, wenn der Anbieter einen Budgetprozentsatz meldet.","field.freeQuota.label":"Freikontingent","field.freeQuota.note":"Wird angezeigt, wenn der Anbieter ein Freikontingent anbietet, mit Restmenge und Zurücksetzungszeit.","field.turnsSteps.label":"Gesprächsrunden und Schritte","field.turnsSteps.note":"Zeigt Gesprächsrunden und Schritte dieser Sitzung.","field.llmTime.label":"Modellzeit","field.llmTime.note":"Zeigt die gesamte Inferenzzeit des Modells.","field.toolTime.label":"Werkzeugzeit","field.toolTime.note":"Zeigt die gesamte Ausführungszeit der Werkzeuge.","field.avgTTFT.label":"Durchschnittliche Zeit bis zum ersten Token","field.avgTTFT.note":"Zeigt die durchschnittliche Zeit bis zum ersten Token über die Modellschritte dieser Sitzung.","field.outputSpeed.label":"Ausgabegeschwindigkeit","field.outputSpeed.note":"Zeigt die durchschnittliche Ausgabegeschwindigkeit der Modellschritte mit Nutzungsdaten in dieser Sitzung (Token/s).","field.cacheHit.note":"Zeigt die Trefferquote des Prompt-Caches.","field.tokensIO.label":"Eingabe-/Ausgabetokens","field.tokensIO.note":"Zeigt die gesamten Eingabe-/Ausgabetokens dieser Sitzung.","field.contextUsage.label":"Kontextnutzung","field.contextUsage.note":"Zeigt die Kontextnutzung; je voller der Ring, desto weniger beschreibbarer Platz bleibt.","ui.contextAria":"{percent} des Kontexts genutzt","ui.contextUsed":"Genutzter Kontext","ui.contextSystem":"System-Prompt","ui.contextTools":"Werkzeugdefinitionen","ui.contextMessages":"Nachrichten der Unterhaltung","ui.contextFigures":"~{used} / {window}","number.thousand":"{value} Tsd.","number.million":"{value} Mio.","field.unmapped.label":"Status der Kontodaten","field.unmapped.note":"Wird bei unbekannten Anbietern oder fehlendem öffentlichen Guthaben-/Kontingent-Endpunkt angezeigt; die lokale Nutzungserfassung funktioniert weiterhin.","field.noKeyHint.label":"Hinweis auf fehlenden Schlüssel","field.noKeyHint.note":"Wird bei fehlendem API-Schlüssel angezeigt und weist auf den Einrichtungsort hin.","field.balanceError.label":"Fehler bei der Guthabenaktualisierung","field.balanceError.note":"Wird angezeigt, wenn die Guthabenaktualisierung fehlschlägt.","field.usageError.label":"Fehler bei der Nutzungsaktualisierung","field.usageError.note":"Wird angezeigt, wenn Ausgabendaten vorübergehend nicht verfügbar sind.","field.refreshFailure.label":"Aktualisierungsfehler","field.refreshFailure.note":"Wird angezeigt, wenn eine Datenaktualisierung fehlschlägt.","field.persistWarning.label":"Warnung bei ungespeicherten Aufzeichnungen","field.persistWarning.note":"Wird angezeigt, wenn Abrechnungsaufzeichnungen nicht gespeichert werden können; empfohlen.","field.updateNotice.label":"Updatehinweis","field.updateNotice.note":"Zeigt einen kurzen Hinweis, wenn eine neue Version bereitsteht oder eine heruntergeladene Version auf einen Neustart wartet.","field.updateFailure.label":"Hinweis auf Updatefehler","field.updateFailure.note":"Zeigt einen kurzen Hinweis, wenn das automatische Update fehlgeschlagen ist.","group.native":"Native Informationen","group.plugin":"Plugin-Informationen","group.notice":"Hinweise","group.native.desc":"Felder, die bereits in der DSH-Leiste vorhanden waren. Sie stehen in der nativen Statistikzeile, die nur im vollständigen Modus erscheint.","group.plugin.desc":"Felder, die dieses Plugin ergänzt, einschließlich des übernommenen Kontextrings. Sie stehen in der Hauptzeile, die in beiden Modi erscheint.","group.notice.desc":"Einmalige Hinweise wie Updates und Fehler. Sie erscheinen nur bei einem tatsächlichen Anlass, unabhängig vom Modus.","section.identity.label":"Anbieter und Modell","section.identity.desc":"Unabhängig von der Zahlungsart: Dienst und Modell dieser Unterhaltung.","section.subscription.label":"Abonnement: Monatstarif mit Kontingent","section.subscription.desc":"Ein Tarif wie ChatGPT füllt nur die folgenden Angaben: Kontingent-Zeitfenster, Kontingentzurücksetzung, Ablaufdatum und verfügbares Guthaben.","section.balance.label":"Prepaid-Guthaben: aufladen, dann nach Nutzung abbuchen","section.balance.desc":"Diese Anbieter füllen nur die folgenden Angaben: Guthaben, Sitzungsausgaben, aktueller Zeitraum und nächste Preisänderung.","section.billing.label":"Abgerechnete Nutzung: erst nutzen, dann monatliche Rechnung","section.billing.desc":"Diese Anbieter füllen nur die folgenden Angaben: Monatsnutzung, Budget und Freikontingent.","section.common.label":"Allgemeine Angaben","section.common.desc":"Unabhängig von der Abrechnung und bei jedem Anbieter nützlich: eigener Text, Uhren, Kontextnutzung.","ui.listSeparator":", ","ui.sentenceEnd":".","ui.fieldErrorPrefix":"„{label}“: ","ui.turnCount":"{count} Gesprächsrunde","ui.turnCountPlural":"{count} Gesprächsrunden","ui.stepCount":"{count} Schritt","ui.stepCountPlural":"{count} Schritte","ui.mainTimeZone":"Hauptzeitzone","ui.worldTimeZone":"Weltzeitzone","ui.customTextTitle":"Eigener Text","ui.customTextPlaceholder":"Text eingeben (höchstens 64 Zeichen)","ui.searchPlaceholder":"Nach Name oder Beschreibung suchen…","ui.searchFieldsLabel":"Anzeigbare Inhalte suchen","ui.searchResultCount":"{count} gefunden","ui.enabledFieldsCount":"{count} aktiviert","ui.noSearchResults":"Keine passenden Einstellungen gefunden","ui.mainTime":"Hauptzeit","ui.worldTime":"Weltzeit","ui.customText":"Eigener Text","language.title":"Sprache","language.description":"DSH folgen oder in diesem Browser eine Sprache für dieses Plugin wählen.","language.auto":"DSH folgen","language.saveFailed":"Spracheinstellung konnte nicht gespeichert werden. Lokalen Speicher erlauben und erneut versuchen."},"it":{"meta.title":"Barra informazioni inferiore","meta.description":"Mostra il modello attuale, il saldo e le spese sotto il campo di composizione.","ui.requestTimedOut":"Richiesta scaduta","ui.requestCanceled":"Richiesta annullata","ui.couldNotParseResponse":"Impossibile interpretare la risposta","ui.rpcFailed":"RPC non riuscita","ui.refreshFailed":"Aggiornamento non riuscito","color.red":"Rosso","color.green":"Verde","color.blue":"Blu","color.purple":"Viola","color.orange":"Arancione","color.neutral":"Neutro","ui.pleaseTryAgainLater":"Riprova più tardi","ui.restoreDefaultColor":"Ripristina il colore predefinito","ui.infoBarSettings":"Barra informazioni","ui.settingsAreTemporarilyUnavailable":"Le impostazioni sono temporaneamente indisponibili","ui.loadingInfoBarSettings":"Caricamento delle impostazioni…","ui.couldNotLoadInfoBar":"Impossibile caricare le impostazioni della barra informazioni: ","ui.changesAppliedButCouldNot":"Applicato, ma impossibile salvare in locale: ","ui.unknownReason":"Motivo sconosciuto","ui.couldNotSave":"{errorPrefix}Impossibile salvare: {value}","ui.color":"Colore di «{value}»: ","ui.hasAnInvalidColorEnter":"«{value}» ha un colore non valido. Inserisci #RRGGBB (ad esempio #0044CC).","ui.defaultColorsRestored":"Colori predefiniti ripristinati","ui.defaultLabelsRestored":"Visualizzazione predefinita ripristinata","ui.couldNotReset":"Impossibile ripristinare: {value}","ui.show":"Mostra {label}","ui.clickToHide":"Fai clic per nascondere","ui.clickToShow":"Fai clic per mostrare","ui.presetColor":"Colore predefinito di {label}","ui.customColor":"Colore personalizzato di {label}","ui.customColorOpenColorPicker":"Colore personalizzato (apri il selettore)","ui.customColorItem":"Personalizzato…","ui.colorSwatchLabel":"Colore di {label}","ui.hexColor":"Colore esadecimale di {label}","ui.expand":"Espandi","ui.collapse":"Comprimi","ui.saving":"Salvataggio…","ui.processing":"Elaborazione…","ui.visibleFields":"Informazioni da mostrare","ui.timeDateTitle":"Ora e data","ui.timeDateDesc":"Fusi orari dell’ora principale e mondiale.","ui.customTextSectionDesc":"Mostra una riga di testo personalizzato nella barra informazioni.","ui.resetConfirmTitle":"Ripristina le impostazioni della barra informazioni","ui.resetConfirmDescFields":"Ripristina tutte le scelte di visualizzazione predefinite. I colori personalizzati restano invariati e la modifica si applica subito.","ui.resetConfirmDescColors":"Tutti i colori personalizzati saranno cancellati e quelli predefiniti ripristinati. Gli interruttori dei campi restano invariati. Si applica subito alla barra informazioni.","ui.resetConfirmAcknowledge":"Comprendo che questo ripristino è irreversibile","ui.resetConfirmCancel":"Annulla","ui.resetConfirmConfirm":"Ripristina","ui.resetLabels":"Ripristina visualizzazione","ui.resetColors":"Ripristina colori","ui.resetRowTitle":"Ripristina valori predefiniti","ui.resetRowDesc":"Ripristina gli elementi visualizzati o i colori predefiniti.","ui.customTextCount":"{value}/64 caratteri","ui.couldNotDisplayInfoBar":"Impossibile mostrare le impostazioni della barra informazioni: {value}","ui.dataAndBilling":"Dati di fatturazione","ui.dataAndBillingDesc":"Esporta o cancella i registri di utilizzo e spesa salvati da questo plugin.","ui.exportBillingRecords":"Esporta fatturazione","ui.exportBillingRecordsDesc":"Esporta i registri come file CSV o JSON.","ui.exportBillingCsv":"Esporta CSV","ui.exportBillingJson":"Esporta JSON","ui.clearBillingRecords":"Cancella fatturazione","ui.clearBillingRecordsDesc":"Questa azione è irreversibile.","ui.clearBillingRecordsConfirm":"Cancellare tutti i registri di fatturazione salvati da questo plugin? Esportali prima. Questa azione è irreversibile, ma le impostazioni e i dati di accesso resteranno invariati.","ui.exportedBillingRecords":"Esportati {count} registri di fatturazione ({format})","ui.noBillingRecordsToExport":"Non ci sono registri di fatturazione da esportare.","ui.exportFailed":"Esportazione non riuscita: {value}","ui.exportIncomplete":"Impossibile leggere alcuni registri storici di fatturazione: {value}. Non è stato esportato nulla; riprova più tardi.","ui.clearFailed":"Impossibile cancellare i registri di fatturazione: {value}","ui.clearFailedWithoutDetails":"Impossibile cancellare completamente i registri di fatturazione","ui.clearedBillingRecords":"Cancellati {count} registri di fatturazione","ui.clearCanceled":"Annullato","ui.exportNotSupported":"Il download di file non è supportato in questo ambiente.","ui.weekly":"Settimanale","ui.monthly":"Mensile","ui.window":"Finestra","ui.quotaDisplayUsed":"Utilizzato","ui.quotaDisplayRemaining":"Rimanente","ui.quotaDisplayModeTitle":"Percentuale della finestra di abbonamento","ui.quotaDisplayModeDesc":"Mostra le quote di abbonamento rimanenti o utilizzate. L’avviso di quota bassa si attiva sempre quando rimane meno del 20%.","ui.windowUsedRemaining":"Finestra {label}: utilizzato {usedPercent}% (rimanente {value}%)","ui.windowUsedRemainingResets":"Finestra {label}: utilizzato {usedPercent}% (rimanente {value}%) · Ripristino {value4}","ui.minimax":"MiniMax","ui.supportsImageInput":"Supporta immagini in ingresso.","ui.vision":"Visione","ui.unknown":"Sconosciuto","ui.unknownModel":"Modello sconosciuto","ui.modelSelectionPending":"Lettura del modello attuale","ui.modelCapabilityPending":"Verifica del supporto delle immagini in ingresso","ui.pluginVersion":"\nVersione del plugin: {current}","ui.provider":"Fornitore: {provLabel} {modelLabel}\n","ui.pricingPeakOffPeakBeijing":"Tariffe: ore di punta/non di punta (ora di Pechino; punta nei giorni feriali 09:00-12:00 e 14:00-18:00; non di punta nei fine settimana e nei giorni festivi cinesi)","ui.pricingFixed":"Tariffe: fisse","ui.pricingNotListedUsingDefaults":"Tariffe: non pubblicate; spesa non calcolata","ui.zhipu":"Zhipu","ui.xiaomiMiMo":"Xiaomi MiMo","ui.commandCode":"Command Code","ui.subscription":"Abbonamento","ui.cloudBilling":"Fatturazione cloud","ui.plan":"\nPiano: {plan}","ui.expiresLocalTime":"\nScadenza: {value} (ora locale)","ui.subscriptionServiceModel":"Servizio di abbonamento: {serviceName}\nModello: {rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.balanceLookupIsNotYet":"Il saldo di questo fornitore non è ancora disponibile.","ui.notSupported":"Non supportato","ui.accountDataUnavailable":"Nessun dato pubblico dell’account","ui.accountDataUnavailableDetail":"Questo fornitore supporta il riconoscimento del modello e la contabilizzazione locale dell’utilizzo, ma non offre un endpoint pubblico di saldo o quota che il plugin possa leggere in sicurezza.","ui.notConfigured":"Non configurato: ","ui.notConfiguredConfigureItIn":"Non configurato: {credName}. Configuralo in Impostazioni → Modelli.","ui.notConfiguredSettingsModels":"{credName} non è configurato. Aggiungilo in Impostazioni → Modelli.","ui.accountSignedOut":"Account disconnesso","ui.accountSignedOutHow":"Accedi al tuo account DeepSeek nelle impostazioni DSH, sezione Account, e il saldo apparirà qui.","ui.estimatedBalance":"Saldo stimato: {symbol}{value}","ui.balance":"Saldo: {symbol}{value}","ui.balanceDetailToppedUp":"Saldo ricaricato: {symbol}{value}","ui.balanceDetailGranted":"Saldo assegnato: {symbol}{value}","ui.balance.pushBalanceGroups":"Saldo","ui.low":"Basso","ui.estimated":"(stimato)","ui.balanceIsTemporarilyUnavailableShowing":"Il saldo è temporaneamente indisponibile. Sono mostrati gli ultimi dati e il tentativo verrà ripetuto automaticamente.","ui.couldNotLoadBalanceCheck":"Impossibile caricare il saldo. Controlla la connessione e la chiave API.","ui.balanceUnavailable":"Saldo non disponibile","ui.beijingTime":"Ora di Pechino: ","ui.peakPrice":"Tariffa di punta","ui.offPeakPrice":"Tariffa non di punta","ui.input":": ingresso ¥","ui.mCachedInput":"/M · ingresso in cache ¥","ui.mOutput":"/M · uscita ¥","ui.beijingTimeSwitchesTo":"Ora di Pechino: {atLabel}, passaggio a ","ui.until":"Fino a ","ui.offPeak":"ore non di punta","ui.peak":"ore di punta","ui.today":"Oggi {symbol}{value}","ui.lastDays":"Ultimi 30 giorni {symbol}{value}","ui.allTime":"Totale {symbol}{value}","ui.sessionIncludingSubagents":"Sessione {costTxt} (inclusi gli agenti secondari){value}","ui.session":"Sessione","ui.spendIsTemporarilyUnavailableChat":"La spesa è temporaneamente indisponibile. La chat non è interessata.","ui.spendUnavailable":"Spesa non disponibile","ui.noSignInCredentialsFound":"Nessun dato di accesso trovato per {serviceName}. Autorizza di nuovo.","ui.credentialsHaveExpiredPleaseReauthorize":"I dati di accesso a {serviceName} sono scaduti. Autorizza di nuovo.","ui.deniedAccessReauthorizeOrTry":"{serviceName} ha negato l’accesso. Autorizza di nuovo o riprova più tardi.","ui.rateLimitReachedPleaseTry":"Limite di richieste di {serviceName} raggiunto. Riprova più tardi.","ui.timedOutCheckYourConnection":"Tempo scaduto per {serviceName}. Controlla la connessione e riprova.","ui.returnedAnUnrecognizedResponsePlease":"{serviceName} ha restituito una risposta non riconosciuta. Riprova più tardi.","ui.isTemporarilyUnavailableCheckYour":"{serviceName} è temporaneamente indisponibile. Controlla la connessione e riprova.","ui.subscriptionExpiresLocalTime":"Scadenza abbonamento: {value} (ora locale)","ui.expires":"Scadenza","ui.subscriptionSource":"Origine abbonamento: {value} (","ui.prepaidBalance":"Saldo disponibile","ui.availableBalanceLabel":"Saldo disponibile","ui.remainingCredits":"Crediti rimanenti","ui.availableBalance":"Saldo disponibile: {balTxt}","ui.availableCredits":"Crediti rimanenti: {value}","ui.subscriptionSource.titleLines":"Origine abbonamento: {value}","ui.windowRemainingUsed":"Finestra {label}: rimanente {value}% (utilizzato {usedPercent}%)","ui.resetsResetsIn":" · Ripristino {value} · Tra {value2}","ui.windowRemainingUsedResets":"Finestra {label}: rimanente {value}% (utilizzato {usedPercent}%) · Ripristino {value4}","ui.resetsIn":"Ripristino tra","ui.configureItInSettingsModels":". Configuralo in Impostazioni → Modelli.","ui.deniedAccessTheTokenMay":"{serviceName} ha negato l’accesso: il token potrebbe non avere il permesso di lettura della fatturazione.","ui.billingIsTemporarilyUnavailableCheck":"La fatturazione di {serviceName} è temporaneamente indisponibile. Controlla connessione e permessi, poi riprova.","ui.billingSource":"Origine fatturazione: {value}","ui.thisMonthSSpend":"Spesa del mese: {symbol}{value}","ui.budgetUsed":"Budget utilizzato: {value}%","ui.dailyFreeQuotaRemaining":"Quota gratuita giornaliera rimanente: {value}","ui.thisMonth":"Questo mese","ui.thisMonthSUsage":"Utilizzo del mese","ui.budget":"Budget","ui.free":"Gratuito","ui.resetsIn.pushBillingGroups":"{value} · Ripristino tra {value2}","ui.billingServiceModel":"Servizio di fatturazione: {serviceName}\nModello: {modelLabel}{versionLine}","ui.pricing":"Tariffe","ui.spend":"Spesa","ui.mode":"Modalità","ui.subscriptionQuota":"Quota abbonamento","ui.billing":"Fatturazione","ui.temporarilyUnavailableKeepingTheLast":": temporaneamente indisponibile. Gli ultimi dati sono conservati e il tentativo verrà ripetuto automaticamente.","ui.spendJournalSavedButThe":"Diario delle spese salvato, ma il registro leggibile non è stato aggiornato: ","ui.thisSpendRecordWasNot":"Questa spesa non è stata salvata e non verrà aggiunta ai totali: ","ui.ledgerUpdatePending":"Aggiornamento del registro in attesa","ui.spendNotSaved":"Spesa non salvata","ui.versionAndUpdateTitle":"Versione e aggiornamenti","ui.versionAndUpdateDesc":"Gli aggiornamenti sostituiscono solo i file del plugin; i registri di fatturazione e le impostazioni restano invariati.","ui.versionUnavailable":"DSH attualmente in esecuzione non ha ancora caricato questa versione del plugin, quindi qui può essere mostrata solo questa riga. Riavvia DSH per vedere la versione attiva, la modalità di aggiornamento e il pulsante di verifica.","ui.versionRunning":"Versione in esecuzione {version}","ui.versionLatest":"Ultima versione {version}","ui.versionLastCheck":"Ultima verifica {time}","ui.versionUnknown":"Sconosciuta","ui.timeJustNow":"adesso","ui.timeMinutesAgo":"{n} min fa","ui.timeHoursAgo":"{n} h fa","ui.timeDaysAgo":"{n} giorni fa","ui.autoUpdateTitle":"Metodo di aggiornamento","ui.updateModeAutoDesc":"Verifica e installa all’avvio di DSH. Durante l’uso, una verifica manuale chiede conferma prima dell’installazione.","ui.updateModeManualDesc":"Non installa all’avvio. Durante l’uso, una verifica manuale chiede conferma prima dell’installazione.","ui.updateModeAuto":"Aggiornamenti automatici","ui.updateModeManual":"Aggiornamenti manuali","ui.updateConfirm":"È disponibile la versione {version}. Aggiornare ora il plugin? Riavvia DSH per applicarla.","ui.updateCheckNow":"Verifica ora","ui.updateChecking":"Verifica…","ui.updateInstallNow":"Aggiorna a {version}","ui.updateInstalling":"Aggiornamento a {version}…","ui.updateAvailableNow":"La versione {version} è pronta; puoi aggiornare ora.","ui.updateRollbackFailed":"Il ripristino non è riuscito perché non esiste un backup utilizzabile. Disinstalla e reinstalla dalla pagina dei plugin.","ui.updateHostOutdated":"Questa azione non è stata eseguita: DSH in esecuzione usa ancora la vecchia logica di aggiornamento. Riavvia DSH per far funzionare il pulsante.","ui.updateUpToDate":"Aggiornato.","ui.updateDisabled":"Gli aggiornamenti automatici non sono disponibili qui","ui.updateDisabledWhy":"Gli aggiornamenti automatici richiedono che il plugin sia installato nella cartella dei plugin DSH. Questa copia proviene dal codice sorgente o da un collegamento; usa il comando di aggiornamento originale.","ui.updatePendingRestart":"Aggiornato a {version}. Riavvia DSH per attivarla.","ui.updateFailed":"L’ultimo aggiornamento non è riuscito","ui.updateFallbackWhy":"Se la nuova versione dà problemi, puoi tornare a quella precedente.","ui.updateHoldWhy":"Hai bloccato questa versione, quindi non verrà installata automaticamente.","ui.updateErrorIncompleteDownload":"Il download era incompleto (connessione interrotta). Questo aggiornamento è stato abbandonato e la versione attuale è rimasta intatta.","ui.updateErrorIntegrityMismatch":"Il pacchetto di aggiornamento non ha superato il controllo di sicurezza ed è stato scartato. La versione attuale è rimasta intatta.","ui.updateErrorDownloadFailed":"Impossibile raggiungere il server degli aggiornamenti. Riprova più tardi.","ui.updateErrorTooLarge":"Il pacchetto di aggiornamento era insolitamente grande ed è stato scartato.","ui.updateErrorPayloadMismatch":"Il pacchetto di aggiornamento non corrispondeva al numero di versione ed è stato scartato.","ui.updateErrorPayloadUnsafe":"Il pacchetto di aggiornamento conteneva un percorso di file inatteso ed è stato scartato.","ui.updateErrorCheckFailed":"La verifica della versione non è riuscita, forse per un problema di rete.","ui.updateErrorUnknown":"L’aggiornamento non è riuscito. I dettagli sono nel registro degli aggiornamenti.","ui.updateRollback":"Torna alla versione precedente","ui.updateRolledBack":"Ripristinata la versione precedente {version}.","ui.updateHeld":"La versione {version} è bloccata e non verrà installata automaticamente.","ui.updateAllowHeld":"Consenti aggiornamento a {version}","ui.updateRestartBadge":"Riavvia per applicare","ui.updateFailedBadge":"Aggiornamento non riuscito","ui.tools":"Strumenti","ui.avgTTFT":"TTFT medio","ui.cacheHit":"Riscontri cache","ui.cacheHitScope":"Per token: {hit} riscontri / {miss} mancati ({percent}% di riscontri).\nAmbito: solo l’agente principale di questa sessione, esclusi gli agenti secondari.","ui.tokenScope":"Ingresso/uscita sommano solo l’agente principale di questa sessione (esclusi gli agenti secondari); il costo della sessione include gli agenti secondari.","ui.spendPartlyUnpriced":"Alcune chiamate non hanno un prezzo pubblicato (non viene sostituito con il prezzo di un altro modello); il costo reale supera quello mostrato.","ui.input.BottomInfoBar":"Ingresso","ui.output":"Uscita","ui.savingView":"Salvataggio della visualizzazione…","ui.clickToSwitchFullCompact":"Fai clic per passare tra visualizzazione completa e compatta","ui.pressEnterOrSpaceFor":"Premi Invio o Spazio per la visualizzazione compatta.","ui.pressEnterOrSpaceFor.BottomInfoBar":"Premi Invio o Spazio per la visualizzazione completa.","host.hour":"5 ore","host.unknownProvider":"Fornitore sconosciuto","error.subscription.request-failed":"Errore inatteso nella richiesta della quota di abbonamento","host.settingsFileCouldNotBe":"Impossibile salvare il file delle impostazioni","error.settings.save-failed":"Impossibile salvare settings.json: {value}","error.balance.credentials":"Impossibile leggere le credenziali","error.balance.not-configured":"Non configurato: {credential}","error.balance.account-signed-out":"L’account integrato è disconnesso","error.balance.account-unavailable":"Questo host non ha un servizio account integrato","error.balance.account-request-failed":"Impossibile recuperare il saldo dell’account integrato","error.request.http":"Richiesta non riuscita: HTTP {status}.","error.request.parse":"Formato della risposta inatteso","error.subscription.not-connected":"L’abbonamento ChatGPT non è collegato: credenziali non trovate in ~/.codex/auth.json. Installa dsh-chatgpt-sub e accedi.","error.subscription.credentials-missing":"Nelle credenziali dell’abbonamento ChatGPT manca id_token. Installa dsh-chatgpt-sub e autorizza di nuovo.","error.subscription.opencode-not-configured":"OpenCode Go non è configurato. Imposta OPENCODE_GO_API_KEY o usa auth.json di opencode.","error.subscription.commandcode-not-configured":"Command Code non è configurato. Imposta COMMAND_CODE_API_KEY, CMD_API_KEY o accedi con la CLI di Command Code.","error.subscription.commandcode-auth-failed":"Le credenziali Command Code sono state rifiutate. Accedi di nuovo o aggiorna la chiave API.","error.subscription.commandcode-unrecognized":"Command Code ha restituito un formato di quota non riconosciuto; i dati precedenti sono stati conservati.","host.zhipu":"Zhipu {mapped}","host.zhipu.parseZaiQuota":"Zhipu {value}{value2}","error.subscription.zhipu-not-configured":"La chiave API Zhipu non è configurata. Imposta ZAI_API_KEY o ZAI_CODING_CN_API_KEY.","error.subscription.zhipu-auth-failed":"Autenticazione API Zhipu non riuscita: la chiave è scaduta o non valida.","error.subscription.zhipu-unrecognized":"Zhipu ha restituito un formato di quota non riconosciuto (l’API potrebbe essere cambiata); gli ultimi dati noti sono conservati.","error.request.failed":"Richiesta non riuscita: {value} {msg}.","error.subscription.xiaomi-not-configured":"Le credenziali Xiaomi MiMo Token Plan non sono configurate: {credName} o XIAOMI_API_KEY.","error.subscription.xiaomi-http":"Richiesta non riuscita: HTTP {value}.","error.subscription.minimax-not-configured":"MiniMax non è configurato. Imposta MINIMAX_API_KEY o MINIMAX_CN_API_KEY. Le richieste Token Plan richiedono una Subscription Key; le chiavi API a consumo sono rifiutate dal server.","error.subscription.minimax-auth-failed":"MiniMax ha rifiutato la chiave API: le richieste Token Plan richiedono una Subscription Key (generata nella pagina di abbonamento Token Plan). Le chiavi a consumo sono rifiutate (status_code=1004 / HTTP 401).","error.subscription.minimax-unrecognized":"MiniMax ha restituito un formato di quota non riconosciuto (l’API potrebbe essere cambiata); gli ultimi dati noti sono conservati.","error.billing.together-not-configured":"Non configurato: TOGETHER_API_KEY","host.actualMonthlyBillFromThe":"Fattura mensile effettiva dall’API Together Usage","error.billing.fireworks-not-configured":"Non configurato: FIREWORKS_API_KEY","error.billing.fireworks-account":"Impossibile leggere l’account (account_id mancante)","host.actualBillForThisPeriod":"Fattura effettiva per questo periodo (Fireworks Billing Summary)","host.actualUsageForThisPeriod":"Utilizzo effettivo per questo periodo (ripiego billingUsage; senza importo della spesa)","error.billing.aws-not-configured":"Non configurato: credenziali AWS (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)","error.billing.aws-http":"Richiesta non riuscita: HTTP {status}. Il token potrebbe non avere il permesso ce:GetCostAndUsage","host.actualMonthlyBillFromAWS":"Fattura mensile effettiva da AWS Cost Explorer (ritardo di circa 24 ore)","error.billing.cloudflare-not-configured":"Non configurato: CLOUDFLARE_API_KEY (richiede un token a livello di account con permesso di lettura Billing)","error.billing.cloudflare-account":"Non configurato: CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"Richiesta non riuscita: HTTP {status}. Il token richiede il permesso di lettura Billing","host.actualMonthlyUsageFromThe":"Utilizzo mensile effettivo dall’API Cloudflare Billable Usage (Alpha)","error.billing.huggingface-not-configured":"Non configurato: HF_TOKEN (i token con permessi granulari richiedono la lettura Billing)","host.actualMonthlyBillFromHF":"Fattura mensile effettiva dall’API Hugging Face Billing","error.billing.request-failed":"Errore inatteso nella richiesta di fatturazione","host.spendSummaryFileMissingArchived":"File di riepilogo delle spese mancante: gli importi archiviati non sono inclusi nei totali mostrati. I dettagli restano in usage-archive/ per il recupero manuale.","host.spendLedgerCouldNotBe":"Impossibile salvare il registro delle spese","host.usageLedgerBusy":"Una risposta è ancora in corso. Cancella i registri di fatturazione al termine.","error.ledger.clear-failed":"Impossibile cancellare completamente i registri di fatturazione: {value}","error.ledger.snapshot-stale":"Impossibile salvare i riepiloghi delle spese archiviate: {value}","host.basedOnYourLastSessions":"In base alle ultime {count} sessioni","host.estimatedFromSpendingOverThe":"Stima basata sulla spesa degli ultimi {SPEND_DAYS} giorni","host.patchMustIncludeFieldsOr":"patch deve includere fields, colors, timeZones o customText","host.timeZonesMustBeAnObject":"timeZones deve essere un oggetto","host.timeZoneMustBeAValid":"Il fuso orario deve essere una zona IANA valida: {key}","host.customTextMustBeAString":"Il testo personalizzato deve essere una stringa","host.customTextTooLong":"Il testo personalizzato non deve superare 64 caratteri","host.quotaDisplayModeInvalid":"La modalità percentuale della finestra di abbonamento deve essere \"used\" o \"remaining\"","host.infoDensityMustBeFullOrCompact":"La visualizzazione delle informazioni deve essere full o compact","host.fieldsMustBeAnObject":"fields deve essere un oggetto","host.unknownFieldId":"Identificatore di campo sconosciuto: {key}","host.fieldVisibilityMustBeA":"La visibilità del campo deve essere un valore booleano: {key}","host.colorsMustBeAnObject":"colors deve essere un oggetto","host.colorMustBeAPreset":"Il colore deve essere un nome predefinito o #RRGGBB: {key}","field.anchorGroup.label":"Fornitore e modello","field.anchorGroup.note":"Mostra il fornitore e il modello usati in questa conversazione.","field.subServiceGroup.label":"Servizio di abbonamento e modello","field.subServiceGroup.note":"Mostra il servizio di abbonamento e il modello o piano attuale.","field.billingServiceGroup.label":"Servizio di fatturazione e modello","field.billingServiceGroup.note":"Mostra il servizio di fatturazione e il modello attuale.","field.customText.label":"Testo personalizzato","field.customText.note":"Mostra testo personalizzato come nota o firma.","field.mainTime.label":"Ora principale","field.mainTime.note":"Mostra il fuso orario principale; modificalo in Ora e data.","field.worldTime.label":"Ora mondiale","field.worldTime.note":"Mostra un altro fuso orario.","field.sessionCost.label":"Spesa della sessione","field.sessionCost.note":"Mostra la spesa effettiva di questa sessione, inclusi gli agenti secondari.","field.balance.note":"Mostra il saldo dell’account; un saldo basso è evidenziato in rosso.","field.period.label":"Periodo attuale","field.period.note":"Per i fornitori con tariffe di punta/non di punta, mostra il periodo attuale.","field.countdown.label":"Prossimo cambio tariffa","field.countdown.note":"Mostra il tempo fino al prossimo cambio tra tariffe di punta e non di punta.","field.expiry.label":"Scadenza abbonamento","field.expiry.note":"Mostrato quando il fornitore restituisce una data di scadenza.","field.subWindow5h.label":"Quota di 5 ore","field.subWindow5h.note":"Mostra la quota rimanente nella finestra mobile di 5 ore.","field.subWindowWeek.label":"Quota settimanale","field.subWindowWeek.note":"Mostra la quota settimanale rimanente.","field.subWindowMonth.label":"Quota mensile","field.subWindowMonth.note":"Mostra la quota mensile rimanente.","field.resetCountdown.label":"Ripristino quota","field.resetCountdown.note":"Mostra il tempo rimanente fino al ripristino della quota attuale.","field.subBalance.label":"Saldo o crediti disponibili","field.subBalance.note":"Mostra il saldo disponibile degli account a consumo o i crediti rimanenti quando un abbonamento non ha una finestra di quota visibile.","field.billingSpend.label":"Utilizzo mensile","field.billingSpend.note":"Mostra l’utilizzo o la spesa effettivi del periodo di fatturazione attuale.","field.budget.label":"Stato del budget","field.budget.note":"Mostrato quando il fornitore comunica una percentuale di budget.","field.freeQuota.label":"Quota gratuita","field.freeQuota.note":"Mostrato quando il fornitore offre una quota gratuita, con quantità rimanente e orario di ripristino.","field.turnsSteps.label":"Turni e passaggi","field.turnsSteps.note":"Mostra i turni e i passaggi di questa sessione.","field.llmTime.label":"Tempo del modello","field.llmTime.note":"Mostra il tempo totale di inferenza del modello.","field.toolTime.label":"Tempo degli strumenti","field.toolTime.note":"Mostra il tempo totale di esecuzione degli strumenti.","field.avgTTFT.label":"Tempo medio al primo token","field.avgTTFT.note":"Mostra il tempo medio al primo token nei passaggi del modello di questa sessione.","field.outputSpeed.label":"Velocità di uscita","field.outputSpeed.note":"Mostra la velocità media di uscita dei passaggi del modello che riportano l’utilizzo in questa sessione (token/s).","field.cacheHit.note":"Mostra la percentuale di riscontri della cache dei prompt.","field.tokensIO.label":"Token in ingresso / uscita","field.tokensIO.note":"Mostra il totale dei token in ingresso/uscita di questa sessione.","field.contextUsage.label":"Utilizzo del contesto","field.contextUsage.note":"Mostra l’utilizzo del contesto; più l’anello è pieno, meno spazio scrivibile rimane.","ui.contextAria":"{percent} del contesto utilizzato","ui.contextUsed":"Contesto utilizzato","ui.contextSystem":"Prompt di sistema","ui.contextTools":"Definizioni degli strumenti","ui.contextMessages":"Messaggi della conversazione","ui.contextFigures":"~{used} / {window}","number.thousand":"{value} mila","number.million":"{value} mln","field.unmapped.label":"Stato dei dati dell’account","field.unmapped.note":"Mostrato quando un fornitore è sconosciuto o senza endpoint pubblico di saldo/quota; la contabilizzazione locale dell’utilizzo continua a funzionare.","field.noKeyHint.label":"Indicazione chiave mancante","field.noKeyHint.note":"Mostrato quando manca una chiave API, indicando dove inserirla.","field.balanceError.label":"Errore di aggiornamento saldo","field.balanceError.note":"Mostrato quando l’aggiornamento del saldo non riesce.","field.usageError.label":"Errore di aggiornamento utilizzo","field.usageError.note":"Mostrato quando i dati di spesa sono temporaneamente indisponibili.","field.refreshFailure.label":"Errore di aggiornamento","field.refreshFailure.note":"Mostrato quando un aggiornamento dei dati non riesce.","field.persistWarning.label":"Avviso di registro non salvato","field.persistWarning.note":"Mostrato quando non è possibile salvare i registri di fatturazione; consigliato.","field.updateNotice.label":"Avviso di aggiornamento","field.updateNotice.note":"Mostra un breve indicatore quando una nuova versione è pronta o una versione scaricata attende un riavvio.","field.updateFailure.label":"Avviso di aggiornamento non riuscito","field.updateFailure.note":"Mostra un breve indicatore quando l’aggiornamento automatico non è riuscito.","group.native":"Informazioni native","group.plugin":"Informazioni del plugin","group.notice":"Avvisi","group.native.desc":"Campi già presenti nella barra DSH. Si trovano nella riga delle statistiche native, mostrata solo in modalità completa.","group.plugin.desc":"Campi aggiunti da questo plugin, incluso l’anello del contesto adottato. Si trovano nella riga principale, mostrata in entrambe le modalità.","group.notice.desc":"Avvisi occasionali come aggiornamenti ed errori. Appaiono solo quando c’è qualcosa da segnalare, in qualsiasi modalità.","section.identity.label":"Fornitore e modello","section.identity.desc":"Mostrato con qualsiasi metodo di pagamento: servizio e modello usati in questa conversazione.","section.subscription.label":"Abbonamento: piano mensile con quota inclusa","section.subscription.desc":"Un piano come ChatGPT compila solo le voci seguenti: finestre di quota, ripristino quota, scadenza e saldo disponibile.","section.balance.label":"Saldo prepagato: ricarica, poi addebito a consumo","section.balance.desc":"Questi fornitori compilano solo le voci seguenti: saldo, spesa della sessione, periodo attuale e prossimo cambio tariffa.","section.billing.label":"Utilizzo fatturato: usa prima, fattura mensile dopo","section.billing.desc":"Questi fornitori compilano solo le voci seguenti: utilizzo del mese, budget e quota gratuita.","section.common.label":"Voci generali","section.common.desc":"Indipendenti dalla fatturazione, utili con ogni fornitore: testo personalizzato, orologi, utilizzo del contesto.","ui.listSeparator":", ","ui.sentenceEnd":".","ui.fieldErrorPrefix":"«{label}»: ","ui.turnCount":"{count} turno","ui.turnCountPlural":"{count} turni","ui.stepCount":"{count} passaggio","ui.stepCountPlural":"{count} passaggi","ui.mainTimeZone":"Fuso orario principale","ui.worldTimeZone":"Fuso orario mondiale","ui.customTextTitle":"Testo personalizzato","ui.customTextPlaceholder":"Inserisci testo (fino a 64 caratteri)","ui.searchPlaceholder":"Cerca per nome o descrizione…","ui.searchFieldsLabel":"Cerca contenuti visualizzabili","ui.searchResultCount":"{count} risultati","ui.enabledFieldsCount":"{count} attivati","ui.noSearchResults":"Nessuna impostazione corrispondente trovata","ui.mainTime":"Ora principale","ui.worldTime":"Ora mondiale","ui.customText":"Testo personalizzato","language.title":"Lingua","language.description":"Segui DSH o scegli una lingua per questo plugin in questo browser.","language.auto":"Segui DSH","language.saveFailed":"Impossibile salvare la preferenza della lingua. Consenti l’archiviazione locale e riprova."},"ru":{"meta.title":"Нижняя информационная панель","meta.description":"Показывает текущую модель, баланс и расходы под полем сообщения.","ui.requestTimedOut":"Время ожидания запроса истекло","ui.requestCanceled":"Запрос отменён","ui.couldNotParseResponse":"Не удалось разобрать ответ","ui.rpcFailed":"Ошибка RPC","ui.refreshFailed":"Ошибка обновления","color.red":"Красный","color.green":"Зелёный","color.blue":"Синий","color.purple":"Фиолетовый","color.orange":"Оранжевый","color.neutral":"Нейтральный","ui.pleaseTryAgainLater":"Повторите попытку позже","ui.restoreDefaultColor":"Восстановить цвет по умолчанию","ui.infoBarSettings":"Информационная панель","ui.settingsAreTemporarilyUnavailable":"Настройки временно недоступны","ui.loadingInfoBarSettings":"Загрузка настроек…","ui.couldNotLoadInfoBar":"Не удалось загрузить настройки панели: ","ui.changesAppliedButCouldNot":"Изменения применены, но не сохранены локально: ","ui.unknownReason":"Неизвестная причина","ui.couldNotSave":"{errorPrefix}Не удалось сохранить: {value}","ui.color":"Цвет «{value}»: ","ui.hasAnInvalidColorEnter":"Цвет «{value}» недопустим. Введите #RRGGBB (например, #0044CC).","ui.defaultColorsRestored":"Цвета по умолчанию восстановлены","ui.defaultLabelsRestored":"Отображение по умолчанию восстановлено","ui.couldNotReset":"Не удалось сбросить: {value}","ui.show":"Показать {label}","ui.clickToHide":"Нажмите, чтобы скрыть","ui.clickToShow":"Нажмите, чтобы показать","ui.presetColor":"Предустановленный цвет {label}","ui.customColor":"Свой цвет {label}","ui.customColorOpenColorPicker":"Свой цвет (открыть выбор цвета)","ui.customColorItem":"Свой…","ui.colorSwatchLabel":"Цвет {label}","ui.hexColor":"Шестнадцатеричный цвет {label}","ui.expand":"Развернуть","ui.collapse":"Свернуть","ui.saving":"Сохранение…","ui.processing":"Обработка…","ui.visibleFields":"Отображаемая информация","ui.timeDateTitle":"Время и дата","ui.timeDateDesc":"Часовые пояса основного и мирового времени.","ui.customTextSectionDesc":"Показывает строку своего текста на панели.","ui.resetConfirmTitle":"Сбросить настройки панели","ui.resetConfirmDescFields":"Восстановить все настройки отображения по умолчанию. Свои цвета сохранятся. Изменения применятся сразу.","ui.resetConfirmDescColors":"Все свои цвета будут удалены и заменены цветами по умолчанию. Видимость полей не изменится. Изменения применятся к панели сразу.","ui.resetConfirmAcknowledge":"Я понимаю, что сброс нельзя отменить","ui.resetConfirmCancel":"Отмена","ui.resetConfirmConfirm":"Сбросить","ui.resetLabels":"Восстановить отображение","ui.resetColors":"Восстановить цвета","ui.resetRowTitle":"Восстановить по умолчанию","ui.resetRowDesc":"Восстановить отображаемые элементы или цвета по умолчанию.","ui.customTextCount":"{value}/64 символа","ui.couldNotDisplayInfoBar":"Не удалось показать настройки панели: {value}","ui.dataAndBilling":"Данные расходов","ui.dataAndBillingDesc":"Экспортируйте или удалите записи использования и расходов, сохранённые плагином.","ui.exportBillingRecords":"Экспорт расходов","ui.exportBillingRecordsDesc":"Экспорт записей в файл CSV или JSON.","ui.exportBillingCsv":"Экспорт CSV","ui.exportBillingJson":"Экспорт JSON","ui.clearBillingRecords":"Удалить расходы","ui.clearBillingRecordsDesc":"Это действие нельзя отменить.","ui.clearBillingRecordsConfirm":"Удалить все записи расходов, сохранённые плагином? Сначала экспортируйте их. Удаление нельзя отменить. Настройки и данные входа сохранятся.","ui.exportedBillingRecords":"Экспортировано записей расходов: {count} ({format})","ui.noBillingRecordsToExport":"Нет записей расходов для экспорта.","ui.exportFailed":"Ошибка экспорта: {value}","ui.exportIncomplete":"Некоторые старые записи расходов не удалось прочитать: {value}. Ничего не экспортировано; повторите попытку позже.","ui.clearFailed":"Не удалось удалить записи расходов: {value}","ui.clearFailedWithoutDetails":"Записи расходов удалены не полностью","ui.clearedBillingRecords":"Удалено записей расходов: {count}","ui.clearCanceled":"Отменено","ui.exportNotSupported":"В этой среде скачивание файлов не поддерживается.","ui.weekly":"За неделю","ui.monthly":"За месяц","ui.window":"Период","ui.quotaDisplayUsed":"Использовано","ui.quotaDisplayRemaining":"Осталось","ui.quotaDisplayModeTitle":"Процент квоты за период подписки","ui.quotaDisplayModeDesc":"Показывать оставшуюся или использованную квоту подписки. Предупреждение о низкой квоте всегда срабатывает, когда осталось менее 20%.","ui.windowUsedRemaining":"Период {label}: использовано {usedPercent}% (осталось {value}%)","ui.windowUsedRemainingResets":"Период {label}: использовано {usedPercent}% (осталось {value}%) · Сброс {value4}","ui.minimax":"MiniMax","ui.supportsImageInput":"Поддерживает ввод изображений.","ui.vision":"Зрение","ui.unknown":"Неизвестно","ui.unknownModel":"Неизвестная модель","ui.modelSelectionPending":"Определение текущей модели","ui.modelCapabilityPending":"Проверка поддержки изображений","ui.pluginVersion":"\nВерсия плагина: {current}","ui.provider":"Провайдер: {provLabel} {modelLabel}\n","ui.pricingPeakOffPeakBeijing":"Тарифы: пиковые/непиковые часы (время Пекина; пик в будни 09:00-12:00 и 14:00-18:00; выходные и китайские праздники — непиковые)","ui.pricingFixed":"Тарифы: фиксированные","ui.pricingNotListedUsingDefaults":"Тарифы: не указаны; расходы не рассчитываются","ui.zhipu":"Zhipu","ui.xiaomiMiMo":"Xiaomi MiMo","ui.commandCode":"Command Code","ui.subscription":"Подписка","ui.cloudBilling":"Облачные расходы","ui.plan":"\nТариф: {plan}","ui.expiresLocalTime":"\nИстекает: {value} (местное время)","ui.subscriptionServiceModel":"Сервис подписки: {serviceName}\nМодель: {rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.balanceLookupIsNotYet":"Баланс этого провайдера пока недоступен.","ui.notSupported":"Не поддерживается","ui.accountDataUnavailable":"Нет открытых данных аккаунта","ui.accountDataUnavailableDetail":"Плагин распознаёт модели этого провайдера и учитывает использование локально, но у провайдера нет открытого интерфейса баланса или квоты, который плагин мог бы безопасно читать.","ui.notConfigured":"Не настроено: ","ui.notConfiguredConfigureItIn":"Не настроено: {credName}. Настройте в разделе Настройки → Модели.","ui.notConfiguredSettingsModels":"{credName} не настроено. Добавьте в разделе Настройки → Модели.","ui.accountSignedOut":"Вход в аккаунт не выполнен","ui.accountSignedOutHow":"Войдите в аккаунт DeepSeek в разделе настроек DSH «Аккаунт», и баланс появится здесь.","ui.estimatedBalance":"Расчётный баланс: {symbol}{value}","ui.balance":"Баланс: {symbol}{value}","ui.balanceDetailToppedUp":"Пополненный баланс: {symbol}{value}","ui.balanceDetailGranted":"Бонусный баланс: {symbol}{value}","ui.balance.pushBalanceGroups":"Баланс","ui.low":"Низкий","ui.estimated":"(оценка)","ui.balanceIsTemporarilyUnavailableShowing":"Баланс временно недоступен. Показаны последние данные; повторная попытка выполняется автоматически.","ui.couldNotLoadBalanceCheck":"Не удалось загрузить баланс. Проверьте соединение и ключ API.","ui.balanceUnavailable":"Баланс недоступен","ui.beijingTime":"Время Пекина: ","ui.peakPrice":"Пиковый тариф","ui.offPeakPrice":"Непиковый тариф","ui.input":": ввод ¥","ui.mCachedInput":"/M · кэшированный ввод ¥","ui.mOutput":"/M · вывод ¥","ui.beijingTimeSwitchesTo":"Время Пекина: в {atLabel} переход на ","ui.until":"До ","ui.offPeak":"непиковый","ui.peak":"пиковый","ui.today":"Сегодня {symbol}{value}","ui.lastDays":"За 30 дней {symbol}{value}","ui.allTime":"За всё время {symbol}{value}","ui.sessionIncludingSubagents":"Сессия {costTxt} (включая субагентов){value}","ui.session":"Сессия","ui.spendIsTemporarilyUnavailableChat":"Расходы временно недоступны. Чат работает.","ui.spendUnavailable":"Расходы недоступны","ui.noSignInCredentialsFound":"Данные входа {serviceName} не найдены. Авторизуйтесь снова.","ui.credentialsHaveExpiredPleaseReauthorize":"Срок действия данных входа {serviceName} истёк. Авторизуйтесь снова.","ui.deniedAccessReauthorizeOrTry":"{serviceName} отказал в доступе. Авторизуйтесь снова или повторите попытку позже.","ui.rateLimitReachedPleaseTry":"Достигнут лимит запросов {serviceName}. Повторите попытку позже.","ui.timedOutCheckYourConnection":"Время ожидания {serviceName} истекло. Проверьте соединение и повторите попытку.","ui.returnedAnUnrecognizedResponsePlease":"{serviceName} вернул нераспознанный ответ. Повторите попытку позже.","ui.isTemporarilyUnavailableCheckYour":"{serviceName} временно недоступен. Проверьте соединение и повторите попытку.","ui.subscriptionExpiresLocalTime":"Подписка истекает: {value} (местное время)","ui.expires":"Истекает","ui.subscriptionSource":"Источник подписки: {value} (","ui.prepaidBalance":"Доступный баланс","ui.availableBalanceLabel":"Доступный баланс","ui.remainingCredits":"Оставшиеся кредиты","ui.availableBalance":"Доступный баланс: {balTxt}","ui.availableCredits":"Оставшиеся кредиты: {value}","ui.subscriptionSource.titleLines":"Источник подписки: {value}","ui.windowRemainingUsed":"Период {label}: осталось {value}% (использовано {usedPercent}%)","ui.resetsResetsIn":" · Сброс {value} · Через {value2}","ui.windowRemainingUsedResets":"Период {label}: осталось {value}% (использовано {usedPercent}%) · Сброс {value4}","ui.resetsIn":"Сброс через","ui.configureItInSettingsModels":". Настройте в разделе Настройки → Модели.","ui.deniedAccessTheTokenMay":"{serviceName} отказал в доступе: у токена может отсутствовать разрешение на чтение расходов.","ui.billingIsTemporarilyUnavailableCheck":"Данные расходов {serviceName} временно недоступны. Проверьте соединение и разрешения, затем повторите попытку.","ui.billingSource":"Источник расходов: {value}","ui.thisMonthSSpend":"Расходы за месяц: {symbol}{value}","ui.budgetUsed":"Использовано бюджета: {value}%","ui.dailyFreeQuotaRemaining":"Оставшаяся дневная бесплатная квота: {value}","ui.thisMonth":"Этот месяц","ui.thisMonthSUsage":"Использование за месяц","ui.budget":"Бюджет","ui.free":"Бесплатно","ui.resetsIn.pushBillingGroups":"{value} · Сброс через {value2}","ui.billingServiceModel":"Сервис расходов: {serviceName}\nМодель: {modelLabel}{versionLine}","ui.pricing":"Тарифы","ui.spend":"Расходы","ui.mode":"Режим","ui.subscriptionQuota":"Квота подписки","ui.billing":"Расходы","ui.temporarilyUnavailableKeepingTheLast":": временно недоступно. Последние данные сохранены; повторная попытка выполняется автоматически.","ui.spendJournalSavedButThe":"Журнал расходов сохранён, но читаемый реестр не обновлён: ","ui.thisSpendRecordWasNot":"Эта запись расходов не сохранена и не будет включена в итог: ","ui.ledgerUpdatePending":"Ожидается обновление реестра","ui.spendNotSaved":"Расходы не сохранены","ui.versionAndUpdateTitle":"Версия и обновления","ui.versionAndUpdateDesc":"Обновления заменяют только файлы плагина; записи расходов и настройки сохраняются.","ui.versionUnavailable":"Запущенный DSH ещё не загрузил эту версию плагина, поэтому здесь показана только эта строка. Перезапустите DSH: появятся текущая версия, режим обновления и кнопка проверки.","ui.versionRunning":"Запущенная версия {version}","ui.versionLatest":"Последняя версия {version}","ui.versionLastCheck":"Последняя проверка {time}","ui.versionUnknown":"Неизвестна","ui.timeJustNow":"только что","ui.timeMinutesAgo":"{n} мин назад","ui.timeHoursAgo":"{n} ч назад","ui.timeDaysAgo":"{n} д назад","ui.autoUpdateTitle":"Способ обновления","ui.updateModeAutoDesc":"Проверяет и устанавливает при запуске DSH. Во время работы ручная проверка запрашивает подтверждение перед установкой.","ui.updateModeManualDesc":"Не устанавливает при запуске. Во время работы ручная проверка запрашивает подтверждение перед установкой.","ui.updateModeAuto":"Автоматические обновления","ui.updateModeManual":"Ручные обновления","ui.updateConfirm":"Доступна версия {version}. Обновить плагин сейчас? Для применения перезапустите DSH.","ui.updateCheckNow":"Проверить сейчас","ui.updateChecking":"Проверка…","ui.updateInstallNow":"Обновить до {version}","ui.updateInstalling":"Обновление до {version}…","ui.updateAvailableNow":"Версия {version} готова; можно обновить сейчас.","ui.updateRollbackFailed":"Откат не удался: нет пригодной резервной копии. Удалите и установите плагин заново на странице плагинов.","ui.updateHostOutdated":"Действие не выполнено: запущенный DSH использует старую логику обновления. Перезапустите DSH, чтобы кнопка заработала.","ui.updateUpToDate":"Установлена последняя версия.","ui.updateDisabled":"Автоматические обновления здесь недоступны","ui.updateDisabledWhy":"Для автоматических обновлений плагин должен быть установлен в папку плагинов DSH. Эта копия запущена из исходников или по ссылке; используйте исходную команду обновления.","ui.updatePendingRestart":"Обновлено до {version}. Перезапустите DSH для активации.","ui.updateFailed":"Последнее обновление не удалось","ui.updateFallbackWhy":"Если новая версия работает неправильно, можно вернуться к предыдущей.","ui.updateHoldWhy":"Вы отложили эту версию, поэтому она не установится автоматически.","ui.updateErrorIncompleteDownload":"Загрузка неполная (соединение прервано). Обновление отменено, текущая версия сохранена.","ui.updateErrorIntegrityMismatch":"Пакет обновления не прошёл проверку безопасности и был отклонён. Текущая версия сохранена.","ui.updateErrorDownloadFailed":"Не удалось связаться с сервером обновлений. Повторите попытку позже.","ui.updateErrorTooLarge":"Пакет обновления необычно большой и был отклонён.","ui.updateErrorPayloadMismatch":"Пакет не соответствовал номеру версии и был отклонён.","ui.updateErrorPayloadUnsafe":"Пакет содержал неожиданный путь к файлу и был отклонён.","ui.updateErrorCheckFailed":"Проверка версии не удалась, возможно, из-за сети.","ui.updateErrorUnknown":"Обновление не удалось. Подробности в журнале обновления.","ui.updateRollback":"Откатить к предыдущей версии","ui.updateRolledBack":"Восстановлена предыдущая версия {version}.","ui.updateHeld":"Версия {version} отложена и не будет установлена автоматически.","ui.updateAllowHeld":"Разрешить обновление до {version}","ui.updateRestartBadge":"Перезапустите для применения","ui.updateFailedBadge":"Ошибка обновления","ui.tools":"Инструменты","ui.avgTTFT":"Среднее TTFT","ui.cacheHit":"Попадания в кэш","ui.cacheHitScope":"По токенам: {hit} попаданий / {miss} промахов ({percent}% попаданий).\nОбласть: только главный агент этой сессии, без субагентов.","ui.tokenScope":"Ввод/вывод учитывает только главного агента этой сессии (без субагентов); расходы сессии включают субагентов.","ui.spendPartlyUnpriced":"Для некоторых вызовов цена не указана (цена другой модели не подставляется); реальные расходы выше показанных.","ui.input.BottomInfoBar":"Ввод","ui.output":"Вывод","ui.savingView":"Сохранение вида…","ui.clickToSwitchFullCompact":"Нажмите для переключения полного и компактного вида","ui.pressEnterOrSpaceFor":"Нажмите Enter или пробел для компактного вида.","ui.pressEnterOrSpaceFor.BottomInfoBar":"Нажмите Enter или пробел для полного вида.","host.hour":"5 часов","host.unknownProvider":"Неизвестный провайдер","error.subscription.request-failed":"Непредвиденная ошибка запроса квоты подписки","host.settingsFileCouldNotBe":"Не удалось сохранить файл настроек","error.settings.save-failed":"Не удалось сохранить settings.json: {value}","error.balance.credentials":"Не удалось прочитать учётные данные","error.balance.not-configured":"Не настроено: {credential}","error.balance.account-signed-out":"Встроенный аккаунт не авторизован","error.balance.account-unavailable":"В этой среде нет сервиса встроенного аккаунта","error.balance.account-request-failed":"Не удалось получить баланс встроенного аккаунта","error.request.http":"Ошибка запроса: HTTP {status}.","error.request.parse":"Неожиданный формат ответа","error.subscription.not-connected":"Подписка ChatGPT не подключена: учётные данные не найдены в ~/.codex/auth.json. Установите dsh-chatgpt-sub и войдите.","error.subscription.credentials-missing":"В данных подписки ChatGPT отсутствует id_token. Установите dsh-chatgpt-sub и авторизуйтесь снова.","error.subscription.opencode-not-configured":"OpenCode Go не настроен. Задайте OPENCODE_GO_API_KEY или используйте auth.json opencode.","error.subscription.commandcode-not-configured":"Command Code не настроен. Задайте COMMAND_CODE_API_KEY, CMD_API_KEY или войдите через Command Code CLI.","error.subscription.commandcode-auth-failed":"Command Code отклонил учётные данные. Войдите снова или обновите ключ API.","error.subscription.commandcode-unrecognized":"Command Code вернул нераспознанный формат квоты; предыдущие данные сохранены.","host.zhipu":"Zhipu {mapped}","host.zhipu.parseZaiQuota":"Zhipu {value}{value2}","error.subscription.zhipu-not-configured":"Ключ API Zhipu не настроен. Задайте ZAI_API_KEY или ZAI_CODING_CN_API_KEY.","error.subscription.zhipu-auth-failed":"Ошибка авторизации API Zhipu: ключ просрочен или недействителен.","error.subscription.zhipu-unrecognized":"Zhipu вернул нераспознанный формат квоты (API мог измениться); последние известные данные сохранены.","error.request.failed":"Ошибка запроса: {value} {msg}.","error.subscription.xiaomi-not-configured":"Данные Xiaomi MiMo Token Plan не настроены: {credName} или XIAOMI_API_KEY.","error.subscription.xiaomi-http":"Ошибка запроса: HTTP {value}.","error.subscription.minimax-not-configured":"MiniMax не настроен. Задайте MINIMAX_API_KEY или MINIMAX_CN_API_KEY. Запросы Token Plan требуют Subscription Key; сервер отклоняет ключи API с оплатой по использованию.","error.subscription.minimax-auth-failed":"MiniMax отклонил ключ API: запросы Token Plan требуют Subscription Key (создаётся на странице подписки Token Plan). Ключи с оплатой по использованию отклоняются (status_code=1004 / HTTP 401).","error.subscription.minimax-unrecognized":"MiniMax вернул нераспознанный формат квоты (API мог измениться); последние известные данные сохранены.","error.billing.together-not-configured":"Не настроено: TOGETHER_API_KEY","host.actualMonthlyBillFromThe":"Фактические месячные расходы из Together Usage API","error.billing.fireworks-not-configured":"Не настроено: FIREWORKS_API_KEY","error.billing.fireworks-account":"Не удалось прочитать аккаунт (отсутствует account_id)","host.actualBillForThisPeriod":"Фактические расходы за период (Fireworks Billing Summary)","host.actualUsageForThisPeriod":"Фактическое использование за период (резервный billingUsage; без суммы расходов)","error.billing.aws-not-configured":"Не настроено: учётные данные AWS (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)","error.billing.aws-http":"Ошибка запроса: HTTP {status}. У токена может отсутствовать разрешение ce:GetCostAndUsage","host.actualMonthlyBillFromAWS":"Фактические месячные расходы из AWS Cost Explorer (задержка около 24 часов)","error.billing.cloudflare-not-configured":"Не настроено: CLOUDFLARE_API_KEY (нужен токен уровня аккаунта с разрешением на чтение Billing)","error.billing.cloudflare-account":"Не настроено: CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"Ошибка запроса: HTTP {status}. Токену нужно разрешение на чтение Billing","host.actualMonthlyUsageFromThe":"Фактическое месячное использование из Cloudflare Billable Usage API (Alpha)","error.billing.huggingface-not-configured":"Не настроено: HF_TOKEN (токенам с детальными правами нужно разрешение на чтение Billing)","host.actualMonthlyBillFromHF":"Фактические месячные расходы из Hugging Face Billing API","error.billing.request-failed":"Непредвиденная ошибка запроса расходов","host.spendSummaryFileMissingArchived":"Файл сводки расходов отсутствует: архивные суммы не входят в показанные итоги. Подробности остались в usage-archive/ для ручного восстановления.","host.spendLedgerCouldNotBe":"Не удалось сохранить реестр расходов","host.usageLedgerBusy":"Ответ ещё формируется. Удалите записи расходов после завершения.","error.ledger.clear-failed":"Не удалось полностью удалить записи расходов: {value}","error.ledger.snapshot-stale":"Не удалось сохранить архивные сводки расходов: {value}","host.basedOnYourLastSessions":"На основе последних {count} сессий","host.estimatedFromSpendingOverThe":"Оценка по расходам за последние {SPEND_DAYS} дней","host.patchMustIncludeFieldsOr":"patch должен содержать fields, colors, timeZones или customText","host.timeZonesMustBeAnObject":"timeZones должен быть объектом","host.timeZoneMustBeAValid":"Часовой пояс должен быть допустимым поясом IANA: {key}","host.customTextMustBeAString":"Свой текст должен быть строкой","host.customTextTooLong":"Свой текст не должен превышать 64 символа","host.quotaDisplayModeInvalid":"Режим процента квоты подписки должен быть \"used\" или \"remaining\"","host.infoDensityMustBeFullOrCompact":"Режим отображения должен быть full или compact","host.fieldsMustBeAnObject":"fields должен быть объектом","host.unknownFieldId":"Неизвестный идентификатор поля: {key}","host.fieldVisibilityMustBeA":"Видимость поля должна быть логическим значением: {key}","host.colorsMustBeAnObject":"colors должен быть объектом","host.colorMustBeAPreset":"Цвет должен быть названием предустановки или #RRGGBB: {key}","field.anchorGroup.label":"Провайдер и модель","field.anchorGroup.note":"Показывает провайдера и модель этой беседы.","field.subServiceGroup.label":"Сервис подписки и модель","field.subServiceGroup.note":"Показывает сервис подписки и текущую модель или тариф.","field.billingServiceGroup.label":"Сервис расходов и модель","field.billingServiceGroup.note":"Показывает сервис расходов и текущую модель.","field.customText.label":"Свой текст","field.customText.note":"Показывает свой текст для заметки или подписи.","field.mainTime.label":"Основное время","field.mainTime.note":"Показывает основной часовой пояс; настройте его в разделе «Время и дата».","field.worldTime.label":"Мировое время","field.worldTime.note":"Показывает другой часовой пояс.","field.sessionCost.label":"Расходы сессии","field.sessionCost.note":"Показывает фактические расходы этой сессии, включая субагентов.","field.balance.note":"Показывает баланс аккаунта; низкий баланс выделен красным.","field.period.label":"Текущий период","field.period.note":"У провайдеров с пиковыми и непиковыми тарифами показывает текущий период.","field.countdown.label":"Следующая смена тарифа","field.countdown.note":"Показывает время до следующей смены пикового/непикового тарифа.","field.expiry.label":"Срок подписки","field.expiry.note":"Показывается, когда провайдер сообщает дату окончания.","field.subWindow5h.label":"Квота на 5 часов","field.subWindow5h.note":"Показывает оставшуюся квоту за скользящий период 5 часов.","field.subWindowWeek.label":"Недельная квота","field.subWindowWeek.note":"Показывает оставшуюся недельную квоту.","field.subWindowMonth.label":"Месячная квота","field.subWindowMonth.note":"Показывает оставшуюся месячную квоту.","field.resetCountdown.label":"Сброс квоты","field.resetCountdown.note":"Показывает время до сброса текущей квоты.","field.subBalance.label":"Доступный баланс или кредиты","field.subBalance.note":"Показывает доступный баланс при оплате по использованию или оставшиеся кредиты, если у подписки нет видимого периода квоты.","field.billingSpend.label":"Месячное использование","field.billingSpend.note":"Показывает фактическое использование или расходы за текущий расчётный период.","field.budget.label":"Состояние бюджета","field.budget.note":"Показывается, когда провайдер сообщает процент бюджета.","field.freeQuota.label":"Бесплатная квота","field.freeQuota.note":"Показывается при наличии бесплатной квоты у провайдера: остаток и время сброса.","field.turnsSteps.label":"Ходы и шаги","field.turnsSteps.note":"Показывает ходы и шаги этой сессии.","field.llmTime.label":"Время модели","field.llmTime.note":"Показывает общее время работы модели.","field.toolTime.label":"Время инструментов","field.toolTime.note":"Показывает общее время выполнения инструментов.","field.avgTTFT.label":"Среднее время до первого токена","field.avgTTFT.note":"Показывает среднее время до первого токена по шагам модели в этой сессии.","field.outputSpeed.label":"Скорость вывода","field.outputSpeed.note":"Показывает среднюю скорость вывода по шагам модели, сообщающим об использовании в этой сессии (tok/s).","field.cacheHit.note":"Показывает долю попаданий в кэш запросов.","field.tokensIO.label":"Токены ввода / вывода","field.tokensIO.note":"Показывает общее число токенов ввода и вывода этой сессии.","field.contextUsage.label":"Использование контекста","field.contextUsage.note":"Показывает использование контекста: чем полнее кольцо, тем меньше места остаётся для записи.","ui.contextAria":"Использовано {percent} контекста","ui.contextUsed":"Использованный контекст","ui.contextSystem":"Системная инструкция","ui.contextTools":"Определения инструментов","ui.contextMessages":"Сообщения беседы","ui.contextFigures":"~{used} / {window}","number.thousand":"{value}K","number.million":"{value}M","field.unmapped.label":"Состояние данных аккаунта","field.unmapped.note":"Показывается для неизвестного провайдера или при отсутствии открытого интерфейса баланса/квоты; локальный учёт использования работает.","field.noKeyHint.label":"Подсказка об отсутствующем ключе","field.noKeyHint.note":"Показывается при отсутствии ключа API и указывает, куда его добавить.","field.balanceError.label":"Ошибка обновления баланса","field.balanceError.note":"Показывается при ошибке обновления баланса.","field.usageError.label":"Ошибка обновления использования","field.usageError.note":"Показывается, когда данные расходов временно недоступны.","field.refreshFailure.label":"Ошибка обновления","field.refreshFailure.note":"Показывается при ошибке любого обновления данных.","field.persistWarning.label":"Предупреждение о несохранённой записи","field.persistWarning.note":"Показывается, когда записи расходов не удаётся сохранить; рекомендуется.","field.updateNotice.label":"Уведомление об обновлении","field.updateNotice.note":"Показывает краткую отметку, когда новая версия готова или загруженная версия ожидает перезапуска.","field.updateFailure.label":"Уведомление об ошибке обновления","field.updateFailure.note":"Показывает краткую отметку при ошибке автоматического обновления.","group.native":"Встроенная информация","group.plugin":"Информация плагина","group.notice":"Уведомления","group.native.desc":"Поля, уже имевшиеся на панели DSH. Они находятся во встроенной строке статистики, видимой только в полном режиме.","group.plugin.desc":"Поля, добавляемые плагином, включая встроенное кольцо контекста. Они находятся в основной строке и видны в обоих режимах.","group.notice.desc":"Разовые уведомления, например об обновлениях и ошибках. Появляются, когда есть что сообщить, в любом режиме.","section.identity.label":"Провайдер и модель","section.identity.desc":"Показывается при любом способе оплаты: сервис и модель этой беседы.","section.subscription.label":"Подписка: месячный тариф с квотой","section.subscription.desc":"Тариф вроде ChatGPT заполняет только эти пункты: периоды квоты, сброс квоты, срок действия и доступный баланс.","section.balance.label":"Предоплата: пополнение и списание за использование","section.balance.desc":"Эти провайдеры заполняют только эти пункты: баланс, расходы сессии, текущий период и следующая смена тарифа.","section.billing.label":"Постоплата: использование с месячным счётом","section.billing.desc":"Эти провайдеры заполняют только эти пункты: использование за месяц, бюджет и бесплатная квота.","section.common.label":"Общие пункты","section.common.desc":"Не связаны с оплатой и полезны у любого провайдера: свой текст, часы, использование контекста.","ui.listSeparator":", ","ui.sentenceEnd":".","ui.fieldErrorPrefix":"«{label}»: ","ui.turnCount":"{count} ход","ui.turnCountPlural":"{count} ходов","ui.stepCount":"{count} шаг","ui.stepCountPlural":"{count} шагов","ui.mainTimeZone":"Основной часовой пояс","ui.worldTimeZone":"Мировой часовой пояс","ui.customTextTitle":"Свой текст","ui.customTextPlaceholder":"Введите текст (до 64 символов)","ui.searchPlaceholder":"Поиск по названию или описанию…","ui.searchFieldsLabel":"Поиск отображаемого содержимого","ui.searchResultCount":"Найдено: {count}","ui.enabledFieldsCount":"Включено: {count}","ui.noSearchResults":"Подходящие настройки не найдены","ui.mainTime":"Основное время","ui.worldTime":"Мировое время","ui.customText":"Свой текст","language.title":"Язык","language.description":"Используйте язык DSH или выберите язык плагина в этом браузере.","language.auto":"Как в DSH","language.saveFailed":"Не удалось сохранить выбранный язык. Разрешите локальное хранилище и повторите попытку."},"hi":{"meta.title":"निचला जानकारी बार","meta.description":"लिखने वाले बॉक्स के नीचे वर्तमान मॉडल, शेष राशि और खर्च दिखाता है।","ui.requestTimedOut":"अनुरोध का समय समाप्त हो गया","ui.requestCanceled":"अनुरोध रद्द किया गया","ui.couldNotParseResponse":"जवाब को पढ़ा नहीं जा सका","ui.rpcFailed":"RPC विफल हुआ","ui.refreshFailed":"रीफ़्रेश विफल हुआ","color.red":"लाल","color.green":"हरा","color.blue":"नीला","color.purple":"बैंगनी","color.orange":"नारंगी","color.neutral":"तटस्थ","ui.pleaseTryAgainLater":"कृपया थोड़ी देर बाद फिर कोशिश करें","ui.restoreDefaultColor":"डिफ़ॉल्ट रंग बहाल करें","ui.infoBarSettings":"जानकारी बार","ui.settingsAreTemporarilyUnavailable":"सेटिंग अभी उपलब्ध नहीं हैं","ui.loadingInfoBarSettings":"सेटिंग लोड हो रही हैं…","ui.couldNotLoadInfoBar":"जानकारी बार की सेटिंग लोड नहीं हो सकीं: ","ui.changesAppliedButCouldNot":"लागू किया, लेकिन स्थानीय रूप से सहेज नहीं सके: ","ui.unknownReason":"अज्ञात कारण","ui.couldNotSave":"{errorPrefix}सहेज नहीं सके: {value}","ui.color":"“{value}” का रंग: ","ui.hasAnInvalidColorEnter":"“{value}” का रंग अमान्य है। #RRGGBB दर्ज करें (उदाहरण: #0044CC)।","ui.defaultColorsRestored":"डिफ़ॉल्ट रंग बहाल कर दिए गए","ui.defaultLabelsRestored":"डिफ़ॉल्ट प्रदर्शन बहाल कर दिया गया","ui.couldNotReset":"रीसेट नहीं कर सके: {value}","ui.show":"{label} दिखाएँ","ui.clickToHide":"छिपाने के लिए क्लिक करें","ui.clickToShow":"दिखाने के लिए क्लिक करें","ui.presetColor":"{label} का पूर्वनिर्धारित रंग","ui.customColor":"{label} का अपना रंग","ui.customColorOpenColorPicker":"अपना रंग (रंग चुनने वाला खोलें)","ui.customColorItem":"अपना रंग…","ui.colorSwatchLabel":"{label} का रंग","ui.hexColor":"{label} का हेक्स रंग","ui.expand":"विस्तृत करें","ui.collapse":"समेटें","ui.saving":"सहेजा जा रहा है…","ui.processing":"काम चल रहा है…","ui.visibleFields":"दिखाई जाने वाली जानकारी","ui.timeDateTitle":"समय और तारीख","ui.timeDateDesc":"मुख्य समय और विश्व समय के समय क्षेत्र।","ui.customTextSectionDesc":"जानकारी बार में अपने लिखे पाठ की एक पंक्ति दिखाता है।","ui.resetConfirmTitle":"जानकारी बार की सेटिंग रीसेट करें","ui.resetConfirmDescFields":"सभी प्रदर्शन विकल्पों को डिफ़ॉल्ट पर बहाल करें। अपने चुने रंग नहीं बदलेंगे और बदलाव तुरंत लागू होगा।","ui.resetConfirmDescColors":"अपने चुने सभी रंग मिटा दिए जाएँगे और डिफ़ॉल्ट रंग बहाल होंगे। जानकारी दिखाने वाले स्विच नहीं बदलेंगे। यह जानकारी बार पर तुरंत लागू होगा।","ui.resetConfirmAcknowledge":"मैं समझता हूँ कि इस रीसेट को वापस नहीं किया जा सकता","ui.resetConfirmCancel":"रद्द करें","ui.resetConfirmConfirm":"रीसेट करें","ui.resetLabels":"प्रदर्शन बहाल करें","ui.resetColors":"रंग बहाल करें","ui.resetRowTitle":"डिफ़ॉल्ट पर बहाल करें","ui.resetRowDesc":"दिखाए जाने वाले मदों या रंगों को डिफ़ॉल्ट पर बहाल करें।","ui.customTextCount":"{value}/64 अक्षर","ui.couldNotDisplayInfoBar":"जानकारी बार की सेटिंग दिखाई नहीं जा सकीं: {value}","ui.dataAndBilling":"बिलिंग डेटा","ui.dataAndBillingDesc":"इस प्लगइन के सहेजे हुए उपयोग और खर्च के रिकॉर्ड निर्यात करें या मिटाएँ।","ui.exportBillingRecords":"बिलिंग निर्यात करें","ui.exportBillingRecordsDesc":"रिकॉर्ड को CSV या JSON फ़ाइल के रूप में निर्यात करें।","ui.exportBillingCsv":"CSV निर्यात करें","ui.exportBillingJson":"JSON निर्यात करें","ui.clearBillingRecords":"बिलिंग मिटाएँ","ui.clearBillingRecordsDesc":"इसे वापस नहीं किया जा सकता।","ui.clearBillingRecordsConfirm":"इस प्लगइन के सहेजे हुए सभी बिलिंग रिकॉर्ड मिटाएँ? पहले निर्यात करें। इसे वापस नहीं किया जा सकता, लेकिन सेटिंग और साइन-इन जानकारी नहीं बदलेंगी।","ui.exportedBillingRecords":"{count} बिलिंग रिकॉर्ड निर्यात किए गए ({format})","ui.noBillingRecordsToExport":"निर्यात करने के लिए कोई बिलिंग रिकॉर्ड नहीं है।","ui.exportFailed":"निर्यात विफल हुआ: {value}","ui.exportIncomplete":"कुछ पुराने बिलिंग रिकॉर्ड पढ़े नहीं जा सके: {value}। कुछ भी निर्यात नहीं हुआ; थोड़ी देर बाद फिर कोशिश करें।","ui.clearFailed":"बिलिंग रिकॉर्ड मिटा नहीं सके: {value}","ui.clearFailedWithoutDetails":"सभी बिलिंग रिकॉर्ड पूरी तरह नहीं मिट सके","ui.clearedBillingRecords":"{count} बिलिंग रिकॉर्ड मिटा दिए गए","ui.clearCanceled":"रद्द किया गया","ui.exportNotSupported":"इस वातावरण में फ़ाइल डाउनलोड उपलब्ध नहीं है।","ui.weekly":"साप्ताहिक","ui.monthly":"मासिक","ui.window":"अवधि","ui.quotaDisplayUsed":"इस्तेमाल हुआ","ui.quotaDisplayRemaining":"शेष","ui.quotaDisplayModeTitle":"सदस्यता अवधि का प्रतिशत","ui.quotaDisplayModeDesc":"सदस्यता कोटे की अवधि को शेष या इस्तेमाल हुए प्रतिशत के रूप में दिखाएँ। शेष कोटा 20% से कम होने पर कम-कोटे की चेतावनी हमेशा दी जाती है।","ui.windowUsedRemaining":"{label} कोटा: इस्तेमाल {usedPercent}% (शेष {value}%)","ui.windowUsedRemainingResets":"{label} कोटा: इस्तेमाल {usedPercent}% (शेष {value}%) · रीसेट {value4}","ui.minimax":"MiniMax","ui.supportsImageInput":"छवि इनपुट का समर्थन करता है।","ui.vision":"छवि पहचान","ui.unknown":"अज्ञात","ui.unknownModel":"अज्ञात मॉडल","ui.modelSelectionPending":"वर्तमान मॉडल पढ़ा जा रहा है","ui.modelCapabilityPending":"छवि इनपुट का समर्थन जाँचा जा रहा है","ui.pluginVersion":"\nप्लगइन संस्करण: {current}","ui.provider":"प्रदाता: {provLabel} {modelLabel}\n","ui.pricingPeakOffPeakBeijing":"मूल्य: पीक/ऑफ़-पीक (बीजिंग समय; कार्यदिवसों में पीक 09:00–12:00 और 14:00–18:00; सप्ताहांत और चीन के सार्वजनिक अवकाश ऑफ़-पीक)","ui.pricingFixed":"मूल्य: तय","ui.pricingNotListedUsingDefaults":"मूल्य: सूची में नहीं है; खर्च की गणना नहीं होती","ui.zhipu":"Zhipu","ui.xiaomiMiMo":"Xiaomi MiMo","ui.commandCode":"Command Code","ui.subscription":"सदस्यता","ui.cloudBilling":"क्लाउड बिलिंग","ui.plan":"\nप्लान: {plan}","ui.expiresLocalTime":"\nसमाप्ति: {value} (स्थानीय समय)","ui.subscriptionServiceModel":"सदस्यता सेवा: {serviceName}\nमॉडल: {rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.balanceLookupIsNotYet":"इस प्रदाता की शेष राशि अभी उपलब्ध नहीं है।","ui.notSupported":"समर्थित नहीं है","ui.accountDataUnavailable":"सार्वजनिक खाता डेटा नहीं है","ui.accountDataUnavailableDetail":"इस प्रदाता के मॉडल की पहचान और स्थानीय उपयोग की गणना समर्थित है, लेकिन प्लगइन के सुरक्षित पढ़ने के लिए कोई सार्वजनिक शेष राशि या कोटा API उपलब्ध नहीं है।","ui.notConfigured":"सेट नहीं है: ","ui.notConfiguredConfigureItIn":"{credName} सेट नहीं है। इसे सेटिंग → मॉडल में सेट करें।","ui.notConfiguredSettingsModels":"{credName} सेट नहीं है। इसे सेटिंग → मॉडल में जोड़ें।","ui.accountSignedOut":"खाते से साइन आउट है","ui.accountSignedOutHow":"DSH की सेटिंग → खाता में अपने DeepSeek खाते से साइन इन करें, फिर शेष राशि यहाँ दिखाई देगी।","ui.estimatedBalance":"अनुमानित शेष राशि: {symbol}{value}","ui.balance":"शेष राशि: {symbol}{value}","ui.balanceDetailToppedUp":"रीचार्ज की शेष राशि: {symbol}{value}","ui.balanceDetailGranted":"दी गई शेष राशि: {symbol}{value}","ui.balance.pushBalanceGroups":"शेष राशि","ui.low":"कम","ui.estimated":"(अनुमानित)","ui.balanceIsTemporarilyUnavailableShowing":"शेष राशि अभी उपलब्ध नहीं है। पिछला डेटा दिखाया जा रहा है और अपने-आप फिर कोशिश होगी।","ui.couldNotLoadBalanceCheck":"शेष राशि लोड नहीं हो सकी। अपना कनेक्शन और API कुंजी जाँचें।","ui.balanceUnavailable":"शेष राशि उपलब्ध नहीं है","ui.beijingTime":"बीजिंग समय: ","ui.peakPrice":"पीक मूल्य","ui.offPeakPrice":"ऑफ़-पीक मूल्य","ui.input":": इनपुट ¥","ui.mCachedInput":"/M · कैश किया हुआ इनपुट ¥","ui.mOutput":"/M · आउटपुट ¥","ui.beijingTimeSwitchesTo":"बीजिंग समय: {atLabel} पर बदलेगा: ","ui.until":"बदलाव तक ","ui.offPeak":"ऑफ़-पीक","ui.peak":"पीक","ui.today":"आज {symbol}{value}","ui.lastDays":"पिछले 30 दिन {symbol}{value}","ui.allTime":"कुल {symbol}{value}","ui.sessionIncludingSubagents":"इस सत्र का खर्च {costTxt} (उप-एजेंटों सहित){value}","ui.session":"सत्र","ui.spendIsTemporarilyUnavailableChat":"खर्च अभी उपलब्ध नहीं है। चैट पर कोई असर नहीं है।","ui.spendUnavailable":"खर्च उपलब्ध नहीं है","ui.noSignInCredentialsFound":"{serviceName} की साइन-इन जानकारी नहीं मिली। कृपया फिर अनुमति दें।","ui.credentialsHaveExpiredPleaseReauthorize":"{serviceName} की साइन-इन जानकारी समाप्त हो गई है। कृपया फिर अनुमति दें।","ui.deniedAccessReauthorizeOrTry":"{serviceName} ने पहुँच अस्वीकार कर दी। फिर अनुमति दें या थोड़ी देर बाद फिर कोशिश करें।","ui.rateLimitReachedPleaseTry":"{serviceName} की अनुरोध सीमा पूरी हो गई है। कृपया थोड़ी देर बाद फिर कोशिश करें।","ui.timedOutCheckYourConnection":"{serviceName} का समय समाप्त हो गया। कनेक्शन जाँचें और फिर कोशिश करें।","ui.returnedAnUnrecognizedResponsePlease":"{serviceName} ने अपरिचित जवाब दिया। कृपया थोड़ी देर बाद फिर कोशिश करें।","ui.isTemporarilyUnavailableCheckYour":"{serviceName} अभी उपलब्ध नहीं है। कनेक्शन जाँचें और फिर कोशिश करें।","ui.subscriptionExpiresLocalTime":"सदस्यता की समाप्ति: {value} (स्थानीय समय)","ui.expires":"समाप्ति","ui.subscriptionSource":"सदस्यता स्रोत: {value} (","ui.prepaidBalance":"उपलब्ध शेष राशि","ui.availableBalanceLabel":"उपलब्ध शेष राशि","ui.remainingCredits":"शेष क्रेडिट","ui.availableBalance":"उपलब्ध शेष राशि: {balTxt}","ui.availableCredits":"शेष क्रेडिट: {value}","ui.subscriptionSource.titleLines":"सदस्यता स्रोत: {value}","ui.windowRemainingUsed":"{label} कोटा: शेष {value}% (इस्तेमाल {usedPercent}%)","ui.resetsResetsIn":" · रीसेट {value} · रीसेट होने में {value2}","ui.windowRemainingUsedResets":"{label} कोटा: शेष {value}% (इस्तेमाल {usedPercent}%) · रीसेट {value4}","ui.resetsIn":"रीसेट होने में","ui.configureItInSettingsModels":"। इसे सेटिंग → मॉडल में सेट करें।","ui.deniedAccessTheTokenMay":"{serviceName} ने पहुँच अस्वीकार की: टोकन में बिलिंग पढ़ने की अनुमति नहीं हो सकती है।","ui.billingIsTemporarilyUnavailableCheck":"{serviceName} की बिलिंग अभी उपलब्ध नहीं है। कनेक्शन और अनुमति जाँचें, फिर कोशिश करें।","ui.billingSource":"बिलिंग स्रोत: {value}","ui.thisMonthSSpend":"इस महीने का खर्च: {symbol}{value}","ui.budgetUsed":"इस्तेमाल हुआ बजट: {value}%","ui.dailyFreeQuotaRemaining":"दैनिक मुफ़्त कोटा शेष: {value}","ui.thisMonth":"इस महीने","ui.thisMonthSUsage":"इस महीने का उपयोग","ui.budget":"बजट","ui.free":"मुफ़्त","ui.resetsIn.pushBillingGroups":"{value} · रीसेट होने में {value2}","ui.billingServiceModel":"बिलिंग सेवा: {serviceName}\nमॉडल: {modelLabel}{versionLine}","ui.pricing":"मूल्य","ui.spend":"खर्च","ui.mode":"मोड","ui.subscriptionQuota":"सदस्यता कोटा","ui.billing":"बिलिंग","ui.temporarilyUnavailableKeepingTheLast":": अभी उपलब्ध नहीं है। पिछला डेटा रखा जा रहा है और अपने-आप फिर कोशिश होगी।","ui.spendJournalSavedButThe":"खर्च का लॉग सहेजा गया, लेकिन पढ़ने योग्य खाता-बही अभी अपडेट नहीं हुई: ","ui.thisSpendRecordWasNot":"यह खर्च रिकॉर्ड सहेजा नहीं गया और कुल में नहीं जोड़ा जाएगा: ","ui.ledgerUpdatePending":"खाता-बही अपडेट बाकी है","ui.spendNotSaved":"खर्च सहेजा नहीं गया","ui.versionAndUpdateTitle":"संस्करण और अपडेट","ui.versionAndUpdateDesc":"अपडेट केवल प्लगइन की अपनी फ़ाइलें बदलते हैं; बिलिंग रिकॉर्ड और सेटिंग नहीं बदलतीं।","ui.versionUnavailable":"अभी चल रहे DSH ने प्लगइन का यह संस्करण लोड नहीं किया है, इसलिए यहाँ केवल यह पंक्ति दिखाई जा सकती है। DSH फिर शुरू करें, तब चल रहा संस्करण, अपडेट मोड और जाँच बटन दिखाई देंगे।","ui.versionRunning":"चल रहा संस्करण {version}","ui.versionLatest":"नवीनतम संस्करण {version}","ui.versionLastCheck":"पिछली जाँच {time}","ui.versionUnknown":"अज्ञात","ui.timeJustNow":"अभी-अभी","ui.timeMinutesAgo":"{n} मिनट पहले","ui.timeHoursAgo":"{n} घंटे पहले","ui.timeDaysAgo":"{n} दिन पहले","ui.autoUpdateTitle":"अपडेट का तरीका","ui.updateModeAutoDesc":"DSH शुरू होने पर जाँच करके इंस्टॉल करता है। उपयोग के दौरान मैन्युअल जाँच में इंस्टॉल करने से पहले आपकी पुष्टि माँगता है।","ui.updateModeManualDesc":"शुरू होने पर इंस्टॉल नहीं करता। उपयोग के दौरान मैन्युअल जाँच में इंस्टॉल करने से पहले आपकी पुष्टि माँगता है।","ui.updateModeAuto":"अपने-आप अपडेट","ui.updateModeManual":"मैन्युअल अपडेट","ui.updateConfirm":"संस्करण {version} उपलब्ध है। अभी प्लगइन अपडेट करें? इसे लागू करने के लिए DSH फिर शुरू करें।","ui.updateCheckNow":"अभी जाँचें","ui.updateChecking":"जाँच हो रही है…","ui.updateInstallNow":"{version} पर अपडेट करें","ui.updateInstalling":"{version} पर अपडेट हो रहा है…","ui.updateAvailableNow":"संस्करण {version} तैयार है; आप अभी अपडेट कर सकते हैं।","ui.updateRollbackFailed":"कोई उपयोग योग्य बैकअप न होने के कारण पिछला संस्करण बहाल नहीं हुआ। प्लगइन पृष्ठ से अनइंस्टॉल करके फिर इंस्टॉल करें।","ui.updateHostOutdated":"यह कार्रवाई नहीं हुई: अभी चल रहे DSH में अपडेट करने का पुराना तरीका है। DSH फिर शुरू करें, तब बटन काम करेगा।","ui.updateUpToDate":"नवीनतम संस्करण है।","ui.updateDisabled":"यहाँ अपने-आप अपडेट उपलब्ध नहीं हैं","ui.updateDisabledWhy":"अपने-आप अपडेट के लिए प्लगइन का DSH की प्लगइन डायरेक्टरी में इंस्टॉल होना ज़रूरी है। यह प्रति स्रोत कोड या लिंक से आई है, इसलिए मूल अपडेट कमांड इस्तेमाल करें।","ui.updatePendingRestart":"{version} पर अपडेट किया गया। सक्रिय करने के लिए DSH फिर शुरू करें।","ui.updateFailed":"पिछला अपडेट सफल नहीं हुआ","ui.updateFallbackWhy":"नए संस्करण में समस्या होने पर आप पिछले संस्करण पर लौट सकते हैं।","ui.updateHoldWhy":"आपने इस संस्करण को रोक रखा है, इसलिए यह अपने-आप इंस्टॉल नहीं होगा।","ui.updateErrorIncompleteDownload":"डाउनलोड अधूरा था (कनेक्शन टूट गया)। यह अपडेट छोड़ दिया गया और आपका वर्तमान संस्करण नहीं बदला।","ui.updateErrorIntegrityMismatch":"अपडेट पैकेज सुरक्षा जाँच में सफल नहीं हुआ, इसलिए अपडेट छोड़ दिया गया। आपका वर्तमान संस्करण नहीं बदला।","ui.updateErrorDownloadFailed":"अपडेट सर्वर से संपर्क नहीं हो सका। थोड़ी देर बाद फिर कोशिश करें।","ui.updateErrorTooLarge":"अपडेट पैकेज असामान्य रूप से बड़ा था, इसलिए अपडेट छोड़ दिया गया।","ui.updateErrorPayloadMismatch":"अपडेट पैकेज अपने संस्करण नंबर से मेल नहीं खाता था, इसलिए अपडेट छोड़ दिया गया।","ui.updateErrorPayloadUnsafe":"अपडेट पैकेज में अप्रत्याशित फ़ाइल पथ था, इसलिए अपडेट छोड़ दिया गया।","ui.updateErrorCheckFailed":"संस्करण की जाँच सफल नहीं हुई; नेटवर्क की समस्या हो सकती है।","ui.updateErrorUnknown":"अपडेट सफल नहीं हुआ। विवरण अपडेट लॉग में हैं।","ui.updateRollback":"पिछला संस्करण बहाल करें","ui.updateRolledBack":"पिछला संस्करण {version} बहाल कर दिया गया।","ui.updateHeld":"संस्करण {version} रोका गया है और अपने-आप इंस्टॉल नहीं होगा।","ui.updateAllowHeld":"{version} पर अपडेट की अनुमति दें","ui.updateRestartBadge":"लागू करने के लिए फिर शुरू करें","ui.updateFailedBadge":"अपडेट विफल","ui.tools":"टूल","ui.avgTTFT":"औसत TTFT","ui.cacheHit":"कैश हिट","ui.cacheHitScope":"टोकन के अनुसार: हिट {hit} / मिस {miss} ({percent}% हिट)।\nदायरा: केवल इस सत्र का मुख्य Agent, उप-एजेंट शामिल नहीं हैं।","ui.tokenScope":"इनपुट/आउटपुट केवल इस सत्र के मुख्य Agent के लिए जुड़ते हैं (उप-एजेंट शामिल नहीं); सत्र के खर्च में उप-एजेंट शामिल हैं।","ui.spendPartlyUnpriced":"कुछ कॉल का मूल्य सूची में नहीं है (किसी दूसरे मॉडल का मूल्य नहीं लगाया जाता); वास्तविक खर्च दिखाए गए खर्च से अधिक है।","ui.input.BottomInfoBar":"इनपुट","ui.output":"आउटपुट","ui.savingView":"प्रदर्शन सहेजा जा रहा है…","ui.clickToSwitchFullCompact":"पूरा/संक्षिप्त प्रदर्शन बदलने के लिए क्लिक करें","ui.pressEnterOrSpaceFor":"संक्षिप्त प्रदर्शन के लिए Enter या Space दबाएँ।","ui.pressEnterOrSpaceFor.BottomInfoBar":"पूरा प्रदर्शन के लिए Enter या Space दबाएँ।","host.hour":"5 घंटे","host.unknownProvider":"अज्ञात प्रदाता","error.subscription.request-failed":"सदस्यता कोटा अनुरोध में अप्रत्याशित विफलता","host.settingsFileCouldNotBe":"सेटिंग फ़ाइल सहेजी नहीं जा सकी","error.settings.save-failed":"settings.json सहेज नहीं सके: {value}","error.balance.credentials":"साइन-इन जानकारी पढ़ी नहीं जा सकी","error.balance.not-configured":"सेट नहीं है: {credential}","error.balance.account-signed-out":"अंतर्निहित खाते से साइन आउट है","error.balance.account-unavailable":"इस होस्ट में अंतर्निहित खाता सेवा नहीं है","error.balance.account-request-failed":"अंतर्निहित खाते की शेष राशि नहीं मिल सकी","error.request.http":"अनुरोध विफल हुआ: HTTP {status}।","error.request.parse":"अप्रत्याशित जवाब प्रारूप","error.subscription.not-connected":"ChatGPT सदस्यता जुड़ी नहीं है: ~/.codex/auth.json में साइन-इन जानकारी नहीं मिली। dsh-chatgpt-sub इंस्टॉल करें और साइन इन करें।","error.subscription.credentials-missing":"ChatGPT सदस्यता की साइन-इन जानकारी में id_token नहीं है। dsh-chatgpt-sub इंस्टॉल करें और फिर अनुमति दें।","error.subscription.opencode-not-configured":"OpenCode Go सेट नहीं है। OPENCODE_GO_API_KEY सेट करें या opencode auth.json इस्तेमाल करें।","error.subscription.commandcode-not-configured":"Command Code सेट नहीं है। COMMAND_CODE_API_KEY, CMD_API_KEY सेट करें, या Command Code CLI से साइन इन करें।","error.subscription.commandcode-auth-failed":"Command Code ने साइन-इन जानकारी अस्वीकार कर दी। फिर साइन इन करें या API कुंजी अपडेट करें।","error.subscription.commandcode-unrecognized":"Command Code ने अपरिचित कोटा प्रारूप लौटाया; पिछला डेटा रखा गया है।","host.zhipu":"Zhipu {mapped}","host.zhipu.parseZaiQuota":"Zhipu {value}{value2}","error.subscription.zhipu-not-configured":"Zhipu API कुंजी सेट नहीं है। ZAI_API_KEY या ZAI_CODING_CN_API_KEY सेट करें।","error.subscription.zhipu-auth-failed":"Zhipu API प्रमाणीकरण विफल हुआ: कुंजी समाप्त हो गई है या अमान्य है।","error.subscription.zhipu-unrecognized":"Zhipu ने अपरिचित कोटा प्रारूप लौटाया (API बदल गई हो सकती है); अंतिम ज्ञात डेटा रखा गया है।","error.request.failed":"अनुरोध विफल हुआ: {value} {msg}।","error.subscription.xiaomi-not-configured":"Xiaomi MiMo Token Plan की साइन-इन जानकारी सेट नहीं है: {credName} या XIAOMI_API_KEY।","error.subscription.xiaomi-http":"अनुरोध विफल हुआ: HTTP {value}।","error.subscription.minimax-not-configured":"MiniMax सेट नहीं है। MINIMAX_API_KEY या MINIMAX_CN_API_KEY सेट करें। Token Plan की जाँच के लिए Subscription Key ज़रूरी है; इस्तेमाल के हिसाब से भुगतान वाली API कुंजियाँ सर्वर अस्वीकार करता है।","error.subscription.minimax-auth-failed":"MiniMax ने API कुंजी अस्वीकार की: Token Plan की जाँच के लिए Subscription Key ज़रूरी है (Token Plan सदस्यता पृष्ठ पर बनाई जाती है)। इस्तेमाल के हिसाब से भुगतान वाली कुंजियाँ अस्वीकार होती हैं (status_code=1004 / HTTP 401)।","error.subscription.minimax-unrecognized":"MiniMax ने अपरिचित कोटा प्रारूप लौटाया (API बदल गई हो सकती है); अंतिम ज्ञात डेटा रखा गया है।","error.billing.together-not-configured":"सेट नहीं है: TOGETHER_API_KEY","host.actualMonthlyBillFromThe":"Together Usage API से इस महीने का वास्तविक बिल","error.billing.fireworks-not-configured":"सेट नहीं है: FIREWORKS_API_KEY","error.billing.fireworks-account":"खाता नहीं पढ़ सके (account_id नहीं है)","host.actualBillForThisPeriod":"इस अवधि का वास्तविक बिल (Fireworks Billing Summary)","host.actualUsageForThisPeriod":"इस अवधि का वास्तविक उपयोग (वैकल्पिक billingUsage स्रोत; खर्च की राशि नहीं है)","error.billing.aws-not-configured":"सेट नहीं है: AWS साइन-इन जानकारी (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)","error.billing.aws-http":"अनुरोध विफल हुआ: HTTP {status}। टोकन में ce:GetCostAndUsage की अनुमति नहीं हो सकती है","host.actualMonthlyBillFromAWS":"AWS Cost Explorer से इस महीने का वास्तविक बिल (लगभग 24 घंटे की देरी)","error.billing.cloudflare-not-configured":"सेट नहीं है: CLOUDFLARE_API_KEY (Billing पढ़ने की अनुमति वाला खाता-स्तर का टोकन ज़रूरी है)","error.billing.cloudflare-account":"सेट नहीं है: CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"अनुरोध विफल हुआ: HTTP {status}। टोकन को Billing पढ़ने की अनुमति चाहिए","host.actualMonthlyUsageFromThe":"Cloudflare Billable Usage API (Alpha) से इस महीने का वास्तविक उपयोग","error.billing.huggingface-not-configured":"सेट नहीं है: HF_TOKEN (विशिष्ट अनुमतियों वाले टोकन को Billing पढ़ने की अनुमति चाहिए)","host.actualMonthlyBillFromHF":"Hugging Face Billing API से इस महीने का वास्तविक बिल","error.billing.request-failed":"बिलिंग अनुरोध में अप्रत्याशित विफलता","host.spendSummaryFileMissingArchived":"खर्च की सारांश फ़ाइल नहीं है: संग्रहित राशियाँ दिखाए गए कुल में शामिल नहीं हैं। विवरण usage-archive/ में हैं और हाथ से बहाल किए जा सकते हैं।","host.spendLedgerCouldNotBe":"खर्च की खाता-बही सहेजी नहीं जा सकी","host.usageLedgerBusy":"एक जवाब अभी चल रहा है। उसके पूरा होने के बाद बिलिंग रिकॉर्ड मिटाएँ।","error.ledger.clear-failed":"बिलिंग रिकॉर्ड पूरी तरह नहीं मिट सके: {value}","error.ledger.snapshot-stale":"संग्रहित खर्च के सारांश सहेज नहीं सके: {value}","host.basedOnYourLastSessions":"आपके पिछले {count} सत्रों पर आधारित","host.estimatedFromSpendingOverThe":"पिछले {SPEND_DAYS} दिनों के खर्च से अनुमानित","host.patchMustIncludeFieldsOr":"patch में fields, colors, timeZones या customText शामिल होना चाहिए","host.timeZonesMustBeAnObject":"timeZones एक ऑब्जेक्ट होना चाहिए","host.timeZoneMustBeAValid":"समय क्षेत्र मान्य IANA क्षेत्र होना चाहिए: {key}","host.customTextMustBeAString":"अपना पाठ एक स्ट्रिंग होना चाहिए","host.customTextTooLong":"अपना पाठ 64 अक्षरों से अधिक नहीं होना चाहिए","host.quotaDisplayModeInvalid":"सदस्यता अवधि के प्रतिशत का मोड “used” या “remaining” होना चाहिए","host.infoDensityMustBeFullOrCompact":"जानकारी का प्रदर्शन full या compact होना चाहिए","host.fieldsMustBeAnObject":"fields एक ऑब्जेक्ट होना चाहिए","host.unknownFieldId":"अज्ञात फ़ील्ड आईडी: {key}","host.fieldVisibilityMustBeA":"फ़ील्ड की दृश्यता बूलियन होनी चाहिए: {key}","host.colorsMustBeAnObject":"colors एक ऑब्जेक्ट होना चाहिए","host.colorMustBeAPreset":"रंग पूर्वनिर्धारित नाम या #RRGGBB होना चाहिए: {key}","field.anchorGroup.label":"प्रदाता और मॉडल","field.anchorGroup.note":"इस बातचीत में इस्तेमाल हो रहे प्रदाता और मॉडल को दिखाता है।","field.subServiceGroup.label":"सदस्यता सेवा और मॉडल","field.subServiceGroup.note":"सदस्यता सेवा और वर्तमान मॉडल या प्लान को दिखाता है।","field.billingServiceGroup.label":"बिलिंग सेवा और मॉडल","field.billingServiceGroup.note":"बिलिंग सेवा और वर्तमान मॉडल को दिखाता है।","field.customText.label":"अपना पाठ","field.customText.note":"नोट या हस्ताक्षर के लिए अपना पाठ दिखाता है।","field.mainTime.label":"मुख्य समय","field.mainTime.note":"मुख्य समय क्षेत्र का समय दिखाता है; समय और तारीख में क्षेत्र बदलें।","field.worldTime.label":"विश्व समय","field.worldTime.note":"दूसरे समय क्षेत्र का समय दिखाता है।","field.sessionCost.label":"सत्र का खर्च","field.sessionCost.note":"उप-एजेंटों सहित इस सत्र का वास्तविक खर्च दिखाता है।","field.balance.note":"खाते की शेष राशि दिखाता है; कम शेष राशि लाल रंग में दिखाई जाती है।","field.period.label":"वर्तमान अवधि","field.period.note":"पीक/ऑफ़-पीक मूल्य वाले प्रदाताओं के लिए दिखाता है कि वर्तमान अवधि पीक है या ऑफ़-पीक।","field.countdown.label":"अगला मूल्य बदलाव","field.countdown.note":"अगले पीक/ऑफ़-पीक मूल्य बदलाव तक का समय दिखाता है।","field.expiry.label":"सदस्यता की समाप्ति","field.expiry.note":"प्रदाता के समाप्ति तारीख लौटाने पर दिखाया जाता है।","field.subWindow5h.label":"5 घंटे का कोटा","field.subWindow5h.note":"पिछले 5 घंटे के चलते रहने वाले कोटे में शेष मात्रा दिखाता है।","field.subWindowWeek.label":"साप्ताहिक कोटा","field.subWindowWeek.note":"शेष साप्ताहिक कोटा दिखाता है।","field.subWindowMonth.label":"मासिक कोटा","field.subWindowMonth.note":"शेष मासिक कोटा दिखाता है।","field.resetCountdown.label":"कोटा रीसेट","field.resetCountdown.note":"वर्तमान कोटा रीसेट होने तक शेष समय दिखाता है।","field.subBalance.label":"उपलब्ध शेष राशि या क्रेडिट","field.subBalance.note":"इस्तेमाल के हिसाब से भुगतान वाले खातों में उपलब्ध शेष राशि दिखाता है, या ऐसी सदस्यता में शेष क्रेडिट दिखाता है जिसका अवधि-आधारित कोटा दिखाई नहीं देता।","field.billingSpend.label":"मासिक उपयोग","field.billingSpend.note":"वर्तमान बिलिंग अवधि का वास्तविक उपयोग या खर्च दिखाता है।","field.budget.label":"बजट की स्थिति","field.budget.note":"प्रदाता के बजट का प्रतिशत बताने पर दिखाया जाता है।","field.freeQuota.label":"मुफ़्त कोटा","field.freeQuota.note":"प्रदाता के मुफ़्त कोटा देने पर शेष मात्रा और रीसेट समय दिखाता है।","field.turnsSteps.label":"बारी और चरण","field.turnsSteps.note":"इस सत्र की बारियाँ और चरण दिखाता है।","field.llmTime.label":"मॉडल समय","field.llmTime.note":"मॉडल के अनुमान लगाने का कुल समय दिखाता है।","field.toolTime.label":"टूल समय","field.toolTime.note":"टूल चलने का कुल समय दिखाता है।","field.avgTTFT.label":"पहले टोकन तक औसत समय","field.avgTTFT.note":"इस सत्र के मॉडल चरणों में पहले टोकन तक का औसत समय दिखाता है।","field.outputSpeed.label":"आउटपुट गति","field.outputSpeed.note":"इस सत्र के उपयोग रिपोर्ट करने वाले मॉडल चरणों की औसत आउटपुट गति (tok/s) दिखाता है।","field.cacheHit.note":"प्रॉम्प्ट कैश की हिट दर दिखाता है।","field.tokensIO.label":"इनपुट / आउटपुट टोकन","field.tokensIO.note":"इस सत्र के कुल इनपुट / आउटपुट टोकन दिखाता है।","field.contextUsage.label":"संदर्भ का उपयोग","field.contextUsage.note":"संदर्भ का उपयोग दिखाता है; घेरा जितना भरा होगा, लिखने की शेष जगह उतनी कम होगी।","ui.contextAria":"संदर्भ का {percent} इस्तेमाल हुआ","ui.contextUsed":"इस्तेमाल हुआ संदर्भ","ui.contextSystem":"सिस्टम प्रॉम्प्ट","ui.contextTools":"टूल की परिभाषाएँ","ui.contextMessages":"बातचीत के संदेश","ui.contextFigures":"~{used} / {window}","number.thousand":"{value}K","number.million":"{value}M","field.unmapped.label":"खाता डेटा की स्थिति","field.unmapped.note":"प्रदाता अज्ञात होने या सार्वजनिक शेष राशि/कोटा API न होने पर दिखाया जाता है; स्थानीय उपयोग की गणना फिर भी काम करती है।","field.noKeyHint.label":"कुंजी नहीं होने की सूचना","field.noKeyHint.note":"API कुंजी न होने पर दिखाता है कि उसे कहाँ भरना है।","field.balanceError.label":"शेष राशि अपडेट की त्रुटि","field.balanceError.note":"शेष राशि अपडेट विफल होने पर दिखाया जाता है।","field.usageError.label":"उपयोग अपडेट की त्रुटि","field.usageError.note":"खर्च का डेटा अभी उपलब्ध न होने पर दिखाया जाता है।","field.refreshFailure.label":"अपडेट की त्रुटि","field.refreshFailure.note":"किसी भी डेटा का रीफ़्रेश विफल होने पर दिखाया जाता है।","field.persistWarning.label":"रिकॉर्ड न सहेजने की चेतावनी","field.persistWarning.note":"बिलिंग रिकॉर्ड सहेजे न जा सकने पर दिखाया जाता है; इसे चालू रखने की सलाह है।","field.updateNotice.label":"अपडेट की सूचना","field.updateNotice.note":"नया संस्करण तैयार होने या डाउनलोड किए गए संस्करण के फिर शुरू होने की प्रतीक्षा में होने पर छोटा संकेत दिखाता है।","field.updateFailure.label":"अपडेट विफल होने की सूचना","field.updateFailure.note":"अपने-आप अपडेट विफल होने पर छोटा संकेत दिखाता है।","group.native":"मूल जानकारी","group.plugin":"प्लगइन की जानकारी","group.notice":"सूचनाएँ","group.native.desc":"DSH बार में पहले से मौजूद फ़ील्ड। ये मूल आँकड़ों की पंक्ति में हैं, जो केवल पूरे मोड में दिखाई देती है।","group.plugin.desc":"इस प्लगइन के जोड़े हुए फ़ील्ड, जिसमें अपनाया गया संदर्भ घेरा भी है। ये मुख्य पंक्ति में हैं और दोनों मोड में दिखाई देते हैं।","group.notice.desc":"अपडेट और विफलता जैसी एक बार की सूचनाएँ। जब बताने के लिए सच में कुछ हो तो मोड की परवाह किए बिना दिखाई देती हैं।","section.identity.label":"प्रदाता और मॉडल","section.identity.desc":"भुगतान के किसी भी तरीके में दिखाता है कि इस बातचीत में कौन सी सेवा और मॉडल चल रहा है।","section.subscription.label":"सदस्यता: कोटे वाला मासिक प्लान","section.subscription.desc":"ChatGPT जैसे प्लान केवल नीचे के मद भरते हैं: कोटा अवधि, कोटा रीसेट, समाप्ति तारीख और उपलब्ध शेष राशि।","section.balance.label":"प्रीपेड शेष राशि: पहले रीचार्ज, फिर उपयोग के अनुसार कटौती","section.balance.desc":"ये प्रदाता केवल नीचे के मद भरते हैं: शेष राशि, सत्र का खर्च, वर्तमान अवधि और अगला मूल्य बदलाव।","section.billing.label":"बिल वाला उपयोग: पहले इस्तेमाल, फिर मासिक बिल","section.billing.desc":"ये प्रदाता केवल नीचे के मद भरते हैं: इस महीने का उपयोग, बजट और मुफ़्त कोटा।","section.common.label":"सामान्य मद","section.common.desc":"बिलिंग से अलग, किसी भी प्रदाता पर उपयोगी: अपना पाठ, घड़ियाँ और संदर्भ का उपयोग।","ui.listSeparator":", ","ui.sentenceEnd":"।","ui.fieldErrorPrefix":"“{label}”: ","ui.turnCount":"{count} बारी","ui.turnCountPlural":"{count} बारियाँ","ui.stepCount":"{count} चरण","ui.stepCountPlural":"{count} चरण","ui.mainTimeZone":"मुख्य समय क्षेत्र","ui.worldTimeZone":"विश्व समय क्षेत्र","ui.customTextTitle":"अपना पाठ","ui.customTextPlaceholder":"पाठ दर्ज करें (अधिकतम 64 अक्षर)","ui.searchPlaceholder":"नाम या विवरण से खोजें…","ui.searchFieldsLabel":"दिखाई देने वाली जानकारी खोजें","ui.searchResultCount":"{count} मिले","ui.enabledFieldsCount":"{count} चालू हैं","ui.noSearchResults":"कोई मेल खाती सेटिंग नहीं मिली","ui.mainTime":"मुख्य समय","ui.worldTime":"विश्व समय","ui.customText":"अपना पाठ","language.title":"भाषा","language.description":"DSH की भाषा अपनाएँ या इस ब्राउज़र में इस प्लगइन के लिए अलग भाषा चुनें।","language.auto":"DSH की भाषा अपनाएँ","language.saveFailed":"भाषा की पसंद सहेज नहीं सके। स्थानीय संग्रहण की अनुमति दें और फिर कोशिश करें।"},"id":{"meta.title":"Bilah Info Bawah","meta.description":"Menampilkan model aktif, saldo, dan biaya di bawah kotak pesan.","ui.requestTimedOut":"Waktu permintaan habis","ui.requestCanceled":"Permintaan dibatalkan","ui.couldNotParseResponse":"Respons tidak dapat diuraikan","ui.rpcFailed":"RPC gagal","ui.refreshFailed":"Penyegaran gagal","color.red":"Merah","color.green":"Hijau","color.blue":"Biru","color.purple":"Ungu","color.orange":"Jingga","color.neutral":"Netral","ui.pleaseTryAgainLater":"Coba lagi nanti","ui.restoreDefaultColor":"Pulihkan warna bawaan","ui.infoBarSettings":"Bilah Info","ui.settingsAreTemporarilyUnavailable":"Pengaturan sementara tidak tersedia","ui.loadingInfoBarSettings":"Memuat pengaturan…","ui.couldNotLoadInfoBar":"Pengaturan Bilah Info tidak dapat dimuat: ","ui.changesAppliedButCouldNot":"Diterapkan, tetapi tidak dapat disimpan secara lokal: ","ui.unknownReason":"Penyebab tidak diketahui","ui.couldNotSave":"{errorPrefix}Tidak dapat menyimpan: {value}","ui.color":"Warna \"{value}\": ","ui.hasAnInvalidColorEnter":"Warna \"{value}\" tidak valid. Masukkan #RRGGBB (misalnya #0044CC).","ui.defaultColorsRestored":"Warna bawaan dipulihkan","ui.defaultLabelsRestored":"Tampilan bawaan dipulihkan","ui.couldNotReset":"Tidak dapat mengatur ulang: {value}","ui.show":"Tampilkan {label}","ui.clickToHide":"Klik untuk menyembunyikan","ui.clickToShow":"Klik untuk menampilkan","ui.presetColor":"Warna prasetel {label}","ui.customColor":"Warna khusus {label}","ui.customColorOpenColorPicker":"Warna khusus (buka pemilih warna)","ui.customColorItem":"Khusus…","ui.colorSwatchLabel":"Warna {label}","ui.hexColor":"Warna heksadesimal {label}","ui.expand":"Perluas","ui.collapse":"Ciutkan","ui.saving":"Menyimpan…","ui.processing":"Memproses…","ui.visibleFields":"Informasi yang ditampilkan","ui.timeDateTitle":"Waktu dan tanggal","ui.timeDateDesc":"Zona waktu utama dan dunia.","ui.customTextSectionDesc":"Menampilkan satu baris teks khusus pada bilah info.","ui.resetConfirmTitle":"Atur ulang pengaturan Bilah Info","ui.resetConfirmDescFields":"Pulihkan semua pilihan tampilan ke bawaan. Warna khusus tidak berubah dan perubahan langsung diterapkan.","ui.resetConfirmDescColors":"Semua warna khusus akan dihapus dan warna bawaan dipulihkan. Sakelar bidang tidak berubah. Langsung diterapkan pada Bilah Info.","ui.resetConfirmAcknowledge":"Saya memahami pengaturan ulang ini tidak dapat dibatalkan","ui.resetConfirmCancel":"Batal","ui.resetConfirmConfirm":"Atur ulang","ui.resetLabels":"Pulihkan tampilan","ui.resetColors":"Pulihkan warna","ui.resetRowTitle":"Pulihkan bawaan","ui.resetRowDesc":"Pulihkan item tampilan atau warna ke bawaan.","ui.customTextCount":"{value}/64 karakter","ui.couldNotDisplayInfoBar":"Pengaturan Bilah Info tidak dapat ditampilkan: {value}","ui.dataAndBilling":"Data tagihan","ui.dataAndBillingDesc":"Ekspor atau hapus catatan penggunaan dan biaya yang disimpan plugin ini.","ui.exportBillingRecords":"Ekspor tagihan","ui.exportBillingRecordsDesc":"Ekspor catatan sebagai berkas CSV atau JSON.","ui.exportBillingCsv":"Ekspor CSV","ui.exportBillingJson":"Ekspor JSON","ui.clearBillingRecords":"Hapus tagihan","ui.clearBillingRecordsDesc":"Tindakan ini tidak dapat dibatalkan.","ui.clearBillingRecordsConfirm":"Hapus semua catatan tagihan plugin ini? Ekspor terlebih dahulu. Tindakan ini tidak dapat dibatalkan, tetapi pengaturan dan informasi masuk tidak berubah.","ui.exportedBillingRecords":"{count} catatan tagihan diekspor ({format})","ui.noBillingRecordsToExport":"Tidak ada catatan tagihan untuk diekspor.","ui.exportFailed":"Ekspor gagal: {value}","ui.exportIncomplete":"Sebagian catatan tagihan lama tidak dapat dibaca: {value}. Tidak ada yang diekspor; coba lagi nanti.","ui.clearFailed":"Catatan tagihan tidak dapat dihapus: {value}","ui.clearFailedWithoutDetails":"Catatan tagihan tidak dapat dihapus seluruhnya","ui.clearedBillingRecords":"{count} catatan tagihan dihapus","ui.clearCanceled":"Dibatalkan","ui.exportNotSupported":"Unduhan berkas tidak didukung di lingkungan ini.","ui.weekly":"Mingguan","ui.monthly":"Bulanan","ui.window":"Jendela","ui.quotaDisplayUsed":"Terpakai","ui.quotaDisplayRemaining":"Tersisa","ui.quotaDisplayModeTitle":"Persentase jendela langganan","ui.quotaDisplayModeDesc":"Tampilkan kuota langganan sebagai tersisa atau terpakai. Peringatan kuota rendah selalu muncul saat sisa kurang dari 20%.","ui.windowUsedRemaining":"Jendela {label}: terpakai {usedPercent}% (tersisa {value}%)","ui.windowUsedRemainingResets":"Jendela {label}: terpakai {usedPercent}% (tersisa {value}%) · Diatur ulang {value4}","ui.minimax":"MiniMax","ui.supportsImageInput":"Mendukung masukan gambar.","ui.vision":"Visi","ui.unknown":"Tidak diketahui","ui.unknownModel":"Model tidak diketahui","ui.modelSelectionPending":"Membaca model aktif","ui.modelCapabilityPending":"Memeriksa dukungan masukan gambar","ui.pluginVersion":"\nVersi plugin: {current}","ui.provider":"Penyedia: {provLabel} {modelLabel}\n","ui.pricingPeakOffPeakBeijing":"Harga: jam sibuk/sepi (waktu Beijing; hari kerja 09:00-12:00 dan 14:00-18:00 sibuk; akhir pekan dan hari libur nasional Tiongkok sepi)","ui.pricingFixed":"Harga: tetap","ui.pricingNotListedUsingDefaults":"Harga: belum tercantum; biaya tidak dihitung","ui.zhipu":"Zhipu","ui.xiaomiMiMo":"Xiaomi MiMo","ui.commandCode":"Command Code","ui.subscription":"Langganan","ui.cloudBilling":"Tagihan cloud","ui.plan":"\nPaket: {plan}","ui.expiresLocalTime":"\nKedaluwarsa: {value} (waktu lokal)","ui.subscriptionServiceModel":"Layanan langganan: {serviceName}\nModel: {rawModelLabel}{planLine}{expiryLine}{versionLine}","ui.balanceLookupIsNotYet":"Saldo penyedia ini belum tersedia.","ui.notSupported":"Tidak didukung","ui.accountDataUnavailable":"Tidak ada data akun publik","ui.accountDataUnavailableDetail":"Penyedia ini mendukung pengenalan model dan pencatatan penggunaan lokal, tetapi tidak memiliki layanan saldo atau kuota publik yang dapat dibaca plugin dengan aman.","ui.notConfigured":"Belum dikonfigurasi: ","ui.notConfiguredConfigureItIn":"{credName} belum dikonfigurasi. Atur di Pengaturan → Model.","ui.notConfiguredSettingsModels":"{credName} belum dikonfigurasi. Tambahkan di Pengaturan → Model.","ui.accountSignedOut":"Akun belum masuk","ui.accountSignedOutHow":"Masuk ke akun DeepSeek melalui Pengaturan DSH → Akun untuk menampilkan saldo di sini.","ui.estimatedBalance":"Perkiraan saldo: {symbol}{value}","ui.balance":"Saldo: {symbol}{value}","ui.balanceDetailToppedUp":"Saldo isi ulang: {symbol}{value}","ui.balanceDetailGranted":"Saldo bonus: {symbol}{value}","ui.balance.pushBalanceGroups":"Saldo","ui.low":"Rendah","ui.estimated":"(perkiraan)","ui.balanceIsTemporarilyUnavailableShowing":"Saldo sementara tidak tersedia. Menampilkan data terakhir dan mencoba lagi secara otomatis.","ui.couldNotLoadBalanceCheck":"Saldo tidak dapat dimuat. Periksa koneksi dan kunci API.","ui.balanceUnavailable":"Saldo tidak tersedia","ui.beijingTime":"Waktu Beijing: ","ui.peakPrice":"Harga jam sibuk","ui.offPeakPrice":"Harga jam sepi","ui.input":": masukan ¥","ui.mCachedInput":"/M · masukan tersimpan ¥","ui.mOutput":"/M · keluaran ¥","ui.beijingTimeSwitchesTo":"Waktu Beijing: {atLabel} beralih ke ","ui.until":"Hingga ","ui.offPeak":"jam sepi","ui.peak":"jam sibuk","ui.today":"Hari ini {symbol}{value}","ui.lastDays":"30 hari terakhir {symbol}{value}","ui.allTime":"Sepanjang waktu {symbol}{value}","ui.sessionIncludingSubagents":"Sesi {costTxt} (termasuk subagen){value}","ui.session":"Sesi","ui.spendIsTemporarilyUnavailableChat":"Biaya sementara tidak tersedia. Percakapan tidak terpengaruh.","ui.spendUnavailable":"Biaya tidak tersedia","ui.noSignInCredentialsFound":"Informasi masuk {serviceName} tidak ditemukan. Otorisasi ulang.","ui.credentialsHaveExpiredPleaseReauthorize":"Informasi masuk {serviceName} kedaluwarsa. Otorisasi ulang.","ui.deniedAccessReauthorizeOrTry":"{serviceName} menolak akses. Otorisasi ulang atau coba lagi nanti.","ui.rateLimitReachedPleaseTry":"Batas permintaan {serviceName} tercapai. Coba lagi nanti.","ui.timedOutCheckYourConnection":"Waktu permintaan {serviceName} habis. Periksa koneksi dan coba lagi.","ui.returnedAnUnrecognizedResponsePlease":"Format respons {serviceName} tidak dikenali. Coba lagi nanti.","ui.isTemporarilyUnavailableCheckYour":"{serviceName} sementara tidak tersedia. Periksa koneksi dan coba lagi.","ui.subscriptionExpiresLocalTime":"Langganan kedaluwarsa: {value} (waktu lokal)","ui.expires":"Kedaluwarsa","ui.subscriptionSource":"Sumber langganan: {value} (","ui.prepaidBalance":"Saldo tersedia","ui.availableBalanceLabel":"Saldo tersedia","ui.remainingCredits":"Kredit tersisa","ui.availableBalance":"Saldo tersedia: {balTxt}","ui.availableCredits":"Kredit tersisa: {value}","ui.subscriptionSource.titleLines":"Sumber langganan: {value}","ui.windowRemainingUsed":"Jendela {label}: tersisa {value}% (terpakai {usedPercent}%)","ui.resetsResetsIn":" · Diatur ulang {value} · Diatur ulang dalam {value2}","ui.windowRemainingUsedResets":"Jendela {label}: tersisa {value}% (terpakai {usedPercent}%) · Diatur ulang {value4}","ui.resetsIn":"Diatur ulang dalam","ui.configureItInSettingsModels":". Atur di Pengaturan → Model.","ui.deniedAccessTheTokenMay":"{serviceName} menolak akses: token mungkin tidak memiliki izin baca tagihan.","ui.billingIsTemporarilyUnavailableCheck":"Tagihan {serviceName} sementara tidak tersedia. Periksa koneksi dan izin, lalu coba lagi.","ui.billingSource":"Sumber tagihan: {value}","ui.thisMonthSSpend":"Biaya bulan ini: {symbol}{value}","ui.budgetUsed":"Anggaran terpakai: {value}%","ui.dailyFreeQuotaRemaining":"Kuota gratis harian tersisa: {value}","ui.thisMonth":"Bulan ini","ui.thisMonthSUsage":"Penggunaan bulan ini","ui.budget":"Anggaran","ui.free":"Gratis","ui.resetsIn.pushBillingGroups":"{value} · Diatur ulang dalam {value2}","ui.billingServiceModel":"Layanan tagihan: {serviceName}\nModel: {modelLabel}{versionLine}","ui.pricing":"Harga","ui.spend":"Biaya","ui.mode":"Mode","ui.subscriptionQuota":"Kuota langganan","ui.billing":"Tagihan","ui.temporarilyUnavailableKeepingTheLast":": sementara tidak tersedia. Data terakhir dipertahankan dan dicoba lagi secara otomatis.","ui.spendJournalSavedButThe":"Jurnal biaya disimpan, tetapi buku catatan belum diperbarui: ","ui.thisSpendRecordWasNot":"Catatan biaya ini belum disimpan dan tidak masuk total: ","ui.ledgerUpdatePending":"Pembaruan buku catatan tertunda","ui.spendNotSaved":"Biaya belum disimpan","ui.versionAndUpdateTitle":"Versi dan pembaruan","ui.versionAndUpdateDesc":"Pembaruan hanya mengganti berkas plugin; catatan tagihan dan pengaturan tetap utuh.","ui.versionUnavailable":"DSH yang sedang berjalan belum memuat versi plugin ini. Mulai ulang DSH agar versi aktif, mode pembaruan, dan tombol pemeriksaan muncul.","ui.versionRunning":"Versi aktif {version}","ui.versionLatest":"Versi terbaru {version}","ui.versionLastCheck":"Terakhir diperiksa {time}","ui.versionUnknown":"Tidak diketahui","ui.timeJustNow":"baru saja","ui.timeMinutesAgo":"{n} menit lalu","ui.timeHoursAgo":"{n} jam lalu","ui.timeDaysAgo":"{n} hari lalu","ui.autoUpdateTitle":"Metode pembaruan","ui.updateModeAutoDesc":"Memeriksa dan memasang saat DSH mulai. Saat digunakan, pemeriksaan manual meminta konfirmasi sebelum memasang.","ui.updateModeManualDesc":"Tidak memasang saat mulai. Saat digunakan, pemeriksaan manual meminta konfirmasi sebelum memasang.","ui.updateModeAuto":"Pembaruan otomatis","ui.updateModeManual":"Pembaruan manual","ui.updateConfirm":"Versi {version} tersedia. Perbarui plugin sekarang? Mulai ulang DSH untuk menerapkan.","ui.updateCheckNow":"Periksa sekarang","ui.updateChecking":"Memeriksa…","ui.updateInstallNow":"Perbarui ke {version}","ui.updateInstalling":"Memperbarui ke {version}…","ui.updateAvailableNow":"Versi {version} siap; Anda dapat memperbarui sekarang.","ui.updateRollbackFailed":"Pemulihan gagal karena tidak ada cadangan yang dapat digunakan. Hapus lalu pasang ulang melalui halaman plugin.","ui.updateHostOutdated":"Tindakan tidak dijalankan karena DSH masih menggunakan logika pembaruan lama. Mulai ulang DSH agar tombol berfungsi.","ui.updateUpToDate":"Sudah terbaru.","ui.updateDisabled":"Pembaruan otomatis tidak tersedia di sini","ui.updateDisabledWhy":"Pembaruan otomatis memerlukan pemasangan di direktori plugin DSH. Salinan ini berasal dari kode sumber atau tautan; gunakan perintah pembaruan semula.","ui.updatePendingRestart":"Diperbarui ke {version}. Mulai ulang DSH untuk mengaktifkan.","ui.updateFailed":"Pembaruan terakhir gagal","ui.updateFallbackWhy":"Jika versi baru bermasalah, Anda dapat kembali ke versi sebelumnya.","ui.updateHoldWhy":"Versi ini Anda tunda sehingga tidak dipasang secara otomatis.","ui.updateErrorIncompleteDownload":"Unduhan tidak lengkap karena koneksi terputus. Pembaruan dibatalkan dan versi yang terpasang tidak berubah.","ui.updateErrorIntegrityMismatch":"Paket pembaruan gagal pemeriksaan keamanan. Pembaruan dibatalkan dan versi yang terpasang tidak berubah.","ui.updateErrorDownloadFailed":"Server pembaruan tidak dapat dihubungi. Coba lagi nanti.","ui.updateErrorTooLarge":"Paket pembaruan terlalu besar sehingga dibatalkan.","ui.updateErrorPayloadMismatch":"Paket pembaruan tidak cocok dengan nomor versinya sehingga dibatalkan.","ui.updateErrorPayloadUnsafe":"Paket pembaruan berisi jalur berkas tidak terduga sehingga dibatalkan.","ui.updateErrorCheckFailed":"Pemeriksaan versi gagal, mungkin karena masalah jaringan.","ui.updateErrorUnknown":"Pembaruan gagal. Rincian ada di log pembaruan.","ui.updateRollback":"Kembali ke versi sebelumnya","ui.updateRolledBack":"Dipulihkan ke versi sebelumnya {version}.","ui.updateHeld":"Versi {version} ditunda dan tidak akan dipasang secara otomatis.","ui.updateAllowHeld":"Izinkan pembaruan ke {version}","ui.updateRestartBadge":"Mulai ulang untuk menerapkan","ui.updateFailedBadge":"Pembaruan gagal","ui.tools":"Alat","ui.avgTTFT":"Rata-rata TTFT","ui.cacheHit":"Cache cocok","ui.cacheHitScope":"Berdasarkan token: {hit} cocok / {miss} tidak cocok ({percent}% cocok).\nCakupan: hanya agen utama sesi ini, tanpa subagen.","ui.tokenScope":"Masukan/keluaran hanya menghitung agen utama sesi ini (tanpa subagen); biaya sesi mencakup subagen.","ui.spendPartlyUnpriced":"Sebagian panggilan belum memiliki harga tercantum (harga model lain tidak digunakan); biaya sebenarnya lebih tinggi dari yang ditampilkan.","ui.input.BottomInfoBar":"Masukan","ui.output":"Keluaran","ui.savingView":"Menyimpan tampilan…","ui.clickToSwitchFullCompact":"Klik untuk beralih antara tampilan lengkap/ringkas","ui.pressEnterOrSpaceFor":"Tekan Enter atau Spasi untuk tampilan ringkas.","ui.pressEnterOrSpaceFor.BottomInfoBar":"Tekan Enter atau Spasi untuk tampilan lengkap.","host.hour":"5 jam","host.unknownProvider":"Penyedia tidak diketahui","error.subscription.request-failed":"Permintaan kuota langganan gagal secara tidak terduga","host.settingsFileCouldNotBe":"Berkas pengaturan tidak dapat disimpan","error.settings.save-failed":"settings.json tidak dapat disimpan: {value}","error.balance.credentials":"Informasi masuk tidak dapat dibaca","error.balance.not-configured":"Belum dikonfigurasi: {credential}","error.balance.account-signed-out":"Akun bawaan belum masuk","error.balance.account-unavailable":"Host ini tidak memiliki layanan akun bawaan","error.balance.account-request-failed":"Saldo akun bawaan tidak dapat diambil","error.request.http":"Permintaan gagal: HTTP {status}.","error.request.parse":"Format respons tidak terduga","error.subscription.not-connected":"Langganan ChatGPT belum terhubung: informasi masuk tidak ditemukan di ~/.codex/auth.json. Pasang dsh-chatgpt-sub lalu masuk.","error.subscription.credentials-missing":"Informasi masuk langganan ChatGPT tidak memiliki id_token. Pasang dsh-chatgpt-sub dan otorisasi ulang.","error.subscription.opencode-not-configured":"OpenCode Go belum dikonfigurasi. Atur OPENCODE_GO_API_KEY atau gunakan opencode auth.json.","error.subscription.commandcode-not-configured":"Command Code belum dikonfigurasi. Atur COMMAND_CODE_API_KEY, CMD_API_KEY, atau masuk melalui CLI Command Code.","error.subscription.commandcode-auth-failed":"Informasi masuk Command Code ditolak. Masuk kembali atau perbarui kunci API.","error.subscription.commandcode-unrecognized":"Format kuota Command Code tidak dikenali; data sebelumnya dipertahankan.","host.zhipu":"Zhipu {mapped}","host.zhipu.parseZaiQuota":"Zhipu {value}{value2}","error.subscription.zhipu-not-configured":"Kunci API Zhipu belum dikonfigurasi. Atur ZAI_API_KEY atau ZAI_CODING_CN_API_KEY.","error.subscription.zhipu-auth-failed":"Autentikasi API Zhipu gagal: kunci kedaluwarsa atau tidak valid.","error.subscription.zhipu-unrecognized":"Format kuota Zhipu tidak dikenali (API mungkin berubah); data terakhir dipertahankan.","error.request.failed":"Permintaan gagal: {value} {msg}.","error.subscription.xiaomi-not-configured":"Informasi masuk Xiaomi MiMo Token Plan belum dikonfigurasi: {credName} atau XIAOMI_API_KEY.","error.subscription.xiaomi-http":"Permintaan gagal: HTTP {value}.","error.subscription.minimax-not-configured":"MiniMax belum dikonfigurasi. Atur MINIMAX_API_KEY atau MINIMAX_CN_API_KEY. Token Plan memerlukan Subscription Key; kunci API bayar sesuai pemakaian ditolak server.","error.subscription.minimax-auth-failed":"MiniMax menolak kunci API: Token Plan memerlukan Subscription Key dari halaman langganan Token Plan. Kunci bayar sesuai pemakaian ditolak (status_code=1004 / HTTP 401).","error.subscription.minimax-unrecognized":"Format kuota MiniMax tidak dikenali (API mungkin berubah); data terakhir dipertahankan.","error.billing.together-not-configured":"Belum dikonfigurasi: TOGETHER_API_KEY","host.actualMonthlyBillFromThe":"Tagihan bulanan sebenarnya dari Together Usage API","error.billing.fireworks-not-configured":"Belum dikonfigurasi: FIREWORKS_API_KEY","error.billing.fireworks-account":"Akun tidak dapat dibaca (account_id tidak ada)","host.actualBillForThisPeriod":"Tagihan sebenarnya periode ini (Fireworks Billing Summary)","host.actualUsageForThisPeriod":"Penggunaan sebenarnya periode ini (cadangan billingUsage; tanpa jumlah biaya)","error.billing.aws-not-configured":"Kredensial AWS belum dikonfigurasi (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)","error.billing.aws-http":"Permintaan gagal: HTTP {status}. Token mungkin tidak memiliki izin ce:GetCostAndUsage","host.actualMonthlyBillFromAWS":"Tagihan bulanan sebenarnya dari AWS Cost Explorer (terlambat sekitar 24 jam)","error.billing.cloudflare-not-configured":"CLOUDFLARE_API_KEY belum dikonfigurasi (memerlukan token tingkat akun dengan izin baca Billing)","error.billing.cloudflare-account":"Belum dikonfigurasi: CLOUDFLARE_ACCOUNT_ID","error.billing.cloudflare-http":"Permintaan gagal: HTTP {status}. Token memerlukan izin baca Billing","host.actualMonthlyUsageFromThe":"Penggunaan bulanan sebenarnya dari Cloudflare Billable Usage API (Alpha)","error.billing.huggingface-not-configured":"HF_TOKEN belum dikonfigurasi (token terperinci memerlukan izin baca Billing)","host.actualMonthlyBillFromHF":"Tagihan bulanan sebenarnya dari Hugging Face Billing API","error.billing.request-failed":"Permintaan tagihan gagal secara tidak terduga","host.spendSummaryFileMissingArchived":"Berkas ringkasan biaya tidak ada: jumlah arsip tidak masuk total tampilan. Rincian tetap di usage-archive/ untuk pemulihan manual.","host.spendLedgerCouldNotBe":"Buku catatan biaya tidak dapat disimpan","host.usageLedgerBusy":"Respons masih berlangsung. Hapus catatan tagihan setelah selesai.","error.ledger.clear-failed":"Catatan tagihan tidak dapat dihapus seluruhnya: {value}","error.ledger.snapshot-stale":"Ringkasan biaya arsip tidak dapat disimpan: {value}","host.basedOnYourLastSessions":"Berdasarkan {count} sesi terakhir","host.estimatedFromSpendingOverThe":"Perkiraan dari biaya selama {SPEND_DAYS} hari terakhir","host.patchMustIncludeFieldsOr":"patch harus berisi fields, colors, timeZones, atau customText","host.timeZonesMustBeAnObject":"timeZones harus berupa objek","host.timeZoneMustBeAValid":"Zona waktu harus berupa zona IANA yang valid: {key}","host.customTextMustBeAString":"Teks khusus harus berupa teks","host.customTextTooLong":"Teks khusus tidak boleh melebihi 64 karakter","host.quotaDisplayModeInvalid":"Mode persentase jendela langganan harus \"used\" atau \"remaining\"","host.infoDensityMustBeFullOrCompact":"Tampilan informasi harus lengkap atau ringkas","host.fieldsMustBeAnObject":"fields harus berupa objek","host.unknownFieldId":"ID bidang tidak diketahui: {key}","host.fieldVisibilityMustBeA":"Visibilitas bidang harus berupa boolean: {key}","host.colorsMustBeAnObject":"colors harus berupa objek","host.colorMustBeAPreset":"Warna harus berupa nama prasetel atau #RRGGBB: {key}","field.anchorGroup.label":"Penyedia dan model","field.anchorGroup.note":"Menampilkan penyedia dan model percakapan ini.","field.subServiceGroup.label":"Layanan langganan dan model","field.subServiceGroup.note":"Menampilkan layanan langganan serta model atau paket aktif.","field.billingServiceGroup.label":"Layanan tagihan dan model","field.billingServiceGroup.note":"Menampilkan layanan tagihan dan model aktif.","field.customText.label":"Teks khusus","field.customText.note":"Menampilkan teks khusus untuk catatan atau tanda tangan.","field.mainTime.label":"Waktu utama","field.mainTime.note":"Menampilkan zona waktu utama; ubah di Waktu dan tanggal.","field.worldTime.label":"Waktu dunia","field.worldTime.note":"Menampilkan zona waktu lain.","field.sessionCost.label":"Biaya sesi","field.sessionCost.note":"Menampilkan biaya sebenarnya sesi ini, termasuk subagen.","field.balance.note":"Menampilkan saldo akun; saldo rendah ditandai merah.","field.period.label":"Periode aktif","field.period.note":"Untuk harga jam sibuk/sepi, menampilkan jenis periode aktif.","field.countdown.label":"Perubahan harga berikutnya","field.countdown.note":"Menampilkan waktu hingga perubahan harga jam sibuk/sepi berikutnya.","field.expiry.label":"Kedaluwarsa langganan","field.expiry.note":"Ditampilkan jika penyedia memberi tanggal kedaluwarsa.","field.subWindow5h.label":"Kuota 5 jam","field.subWindow5h.note":"Menampilkan sisa kuota bergulir 5 jam.","field.subWindowWeek.label":"Kuota mingguan","field.subWindowWeek.note":"Menampilkan sisa kuota mingguan.","field.subWindowMonth.label":"Kuota bulanan","field.subWindowMonth.note":"Menampilkan sisa kuota bulanan.","field.resetCountdown.label":"Pengaturan ulang kuota","field.resetCountdown.note":"Menampilkan waktu tersisa hingga kuota aktif diatur ulang.","field.subBalance.label":"Saldo atau kredit tersedia","field.subBalance.note":"Menampilkan saldo akun bayar sesuai pemakaian, atau kredit tersisa jika langganan tidak memiliki jendela kuota terlihat.","field.billingSpend.label":"Penggunaan bulanan","field.billingSpend.note":"Menampilkan penggunaan atau biaya sebenarnya untuk periode tagihan aktif.","field.budget.label":"Status anggaran","field.budget.note":"Ditampilkan jika penyedia melaporkan persentase anggaran.","field.freeQuota.label":"Kuota gratis","field.freeQuota.note":"Ditampilkan jika penyedia memberi kuota gratis, beserta jumlah tersisa dan waktu pengaturan ulang.","field.turnsSteps.label":"Giliran dan langkah","field.turnsSteps.note":"Menampilkan giliran dan langkah dalam sesi ini.","field.llmTime.label":"Waktu model","field.llmTime.note":"Menampilkan total waktu pemrosesan model.","field.toolTime.label":"Waktu alat","field.toolTime.note":"Menampilkan total waktu pelaksanaan alat.","field.avgTTFT.label":"Rata-rata waktu token pertama","field.avgTTFT.note":"Menampilkan rata-rata waktu hingga token pertama untuk langkah model sesi ini.","field.outputSpeed.label":"Kecepatan keluaran","field.outputSpeed.note":"Menampilkan rata-rata kecepatan keluaran langkah model dengan laporan penggunaan sesi ini (tok/s).","field.cacheHit.note":"Menampilkan tingkat kecocokan cache prompt.","field.tokensIO.label":"Token masukan / keluaran","field.tokensIO.note":"Menampilkan total token masukan / keluaran sesi ini.","field.contextUsage.label":"Penggunaan konteks","field.contextUsage.note":"Menampilkan penggunaan konteks; lingkaran semakin penuh berarti ruang yang dapat ditulis semakin sedikit.","ui.contextAria":"{percent} konteks terpakai","ui.contextUsed":"Konteks terpakai","ui.contextSystem":"Prompt sistem","ui.contextTools":"Definisi alat","ui.contextMessages":"Pesan percakapan","ui.contextFigures":"~{used} / {window}","number.thousand":"{value}K","number.million":"{value}M","field.unmapped.label":"Status data akun","field.unmapped.note":"Ditampilkan jika penyedia tidak diketahui atau tidak memiliki layanan saldo/kuota publik; pencatatan penggunaan lokal tetap berjalan.","field.noKeyHint.label":"Petunjuk kunci belum ada","field.noKeyHint.note":"Ditampilkan jika kunci API belum ada, dengan petunjuk tempat mengisinya.","field.balanceError.label":"Kesalahan pembaruan saldo","field.balanceError.note":"Ditampilkan jika pembaruan saldo gagal.","field.usageError.label":"Kesalahan pembaruan penggunaan","field.usageError.note":"Ditampilkan jika data biaya sementara tidak tersedia.","field.refreshFailure.label":"Kesalahan pembaruan","field.refreshFailure.note":"Ditampilkan jika penyegaran data gagal.","field.persistWarning.label":"Peringatan catatan belum disimpan","field.persistWarning.note":"Ditampilkan jika catatan tagihan tidak dapat disimpan; disarankan.","field.updateNotice.label":"Pemberitahuan pembaruan","field.updateNotice.note":"Menampilkan penanda singkat jika versi baru siap atau versi yang diunduh menunggu mulai ulang.","field.updateFailure.label":"Pemberitahuan pembaruan gagal","field.updateFailure.note":"Menampilkan penanda singkat jika pembaruan otomatis gagal.","group.native":"Informasi bawaan","group.plugin":"Informasi plugin","group.notice":"Pemberitahuan","group.native.desc":"Bidang yang sudah ada pada bilah DSH, di baris statistik bawaan yang hanya terlihat dalam mode Lengkap.","group.plugin.desc":"Bidang yang ditambahkan plugin, termasuk lingkaran konteks; di baris utama yang terlihat dalam kedua mode.","group.notice.desc":"Pemberitahuan sesekali seperti pembaruan dan kegagalan; muncul saat ada informasi yang perlu disampaikan dalam mode apa pun.","section.identity.label":"Penyedia dan model","section.identity.desc":"Menampilkan layanan dan model percakapan ini, untuk semua cara pembayaran.","section.subscription.label":"Langganan: paket bulanan dengan kuota","section.subscription.desc":"Paket seperti ChatGPT hanya mengisi kuota, pengaturan ulang kuota, tanggal kedaluwarsa, dan saldo tersedia di bawah.","section.balance.label":"Saldo prabayar: isi ulang, lalu biaya penggunaan dipotong","section.balance.desc":"Penyedia ini hanya mengisi saldo, biaya sesi, periode aktif, dan perubahan harga berikutnya di bawah.","section.billing.label":"Tagihan penggunaan: pakai dahulu, ditagih bulanan","section.billing.desc":"Penyedia ini hanya mengisi penggunaan bulan ini, anggaran, dan kuota gratis di bawah.","section.common.label":"Item umum","section.common.desc":"Berguna untuk semua penyedia dan tidak terkait tagihan: teks khusus, jam, penggunaan konteks.","ui.listSeparator":", ","ui.sentenceEnd":".","ui.fieldErrorPrefix":"\"{label}\": ","ui.turnCount":"{count} giliran","ui.turnCountPlural":"{count} giliran","ui.stepCount":"{count} langkah","ui.stepCountPlural":"{count} langkah","ui.mainTimeZone":"Zona waktu utama","ui.worldTimeZone":"Zona waktu dunia","ui.customTextTitle":"Teks khusus","ui.customTextPlaceholder":"Masukkan teks (maksimal 64 karakter)","ui.searchPlaceholder":"Cari berdasarkan nama atau deskripsi…","ui.searchFieldsLabel":"Cari konten yang terlihat","ui.searchResultCount":"{count} ditemukan","ui.enabledFieldsCount":"{count} diaktifkan","ui.noSearchResults":"Tidak ada pengaturan yang cocok","ui.mainTime":"Waktu utama","ui.worldTime":"Waktu dunia","ui.customText":"Teks khusus","language.title":"Bahasa","language.description":"Ikuti DSH atau pilih bahasa plugin ini di peramban ini.","language.auto":"Ikuti DSH","language.saveFailed":"Pilihan bahasa tidak dapat disimpan. Izinkan penyimpanan lokal dan coba lagi."}};
let t;
let localeService;
function pluginLanguagePicker(React, runtime, onError) {
  return React.createElement('div', { className: 'bib-set-row' },
    React.createElement('div', { className: 'bib-set-rowText' },
      React.createElement('label', { htmlFor: 'bib-language', className: 'bib-set-rowTitle' }, t('language.title')),
      React.createElement('p', { className: 'bib-set-rowDesc' }, t('language.description'))),
    React.createElement('select', {
      id: 'bib-language', value: runtime.preference(), className: 'bib-set-language',
      onChange: function (event) {
        try { runtime.setPreference(event.target.value); onError(null); }
        catch { onError({ text: function () { return t('language.saveFailed'); } }); }
      },
    }, React.createElement('option', { value: 'auto' }, t('language.auto')),
      runtime.options().map(function (language) { return React.createElement('option', { key: language.id, value: language.id }, language.label); })));
}
function createLanguageRuntime(namespace, dictionaries, service, environment) {
  const env = environment || (typeof window !== 'undefined' ? window : {});
  const storageKey = namespace + ':language';
  const listeners = new Set();
  const labels = {
    zh: '简体中文', 'zh-hant': '繁體中文', en: 'English', ja: '日本語', ko: '한국어',
    es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', it: 'Italiano',
    ru: 'Русский', hi: 'हिन्दी', id: 'Bahasa Indonesia',
  };
  function normalize(tag) {
    const value = String(tag || '').toLowerCase().replace(/_/g, '-');
    if (/^zh-(hant|tw|hk|mo)(-|$)/.test(value)) return dictionaries['zh-hant'] ? 'zh-hant' : 'zh';
    if (dictionaries[value]) return value;
    const base = value.split('-')[0];
    return dictionaries[base] ? base : undefined;
  }
  function readPreference() {
    try {
      const saved = env.localStorage && env.localStorage.getItem(storageKey);
      return saved && Object.hasOwn(dictionaries, saved) ? saved : 'auto';
    } catch { return 'auto'; }
  }
  let preference = readPreference();
  let bound;
  try { bound = service && typeof service.bind === 'function' ? service.bind(namespace) : undefined; } catch { /* fall back to dictionaries */ }
  function hostLanguage() {
    try {
      const snapshot = service && (typeof service.getSnapshot === 'function' ? service.getSnapshot()
        : typeof service.getLocale === 'function' ? service.getLocale() : undefined);
      if (snapshot && typeof snapshot.active === 'string') return snapshot.active;
      // Older hosts expose only bind(): identify the locale using a unique built-in phrase.
      if (bound) {
        const description = bound('meta.description');
        const language = Object.keys(dictionaries).find(id => dictionaries[id]['meta.description'] === description);
        if (language) return language;
      }
      return undefined;
    } catch { return undefined; }
  }
  function browserLanguage() {
    const nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : {});
    for (const tag of nav.languages && nav.languages.length ? nav.languages : [nav.language]) {
      const language = normalize(tag);
      if (language) return language;
    }
    return 'en';
  }
  function activeLanguage() {
    if (preference !== 'auto') return preference;
    const host = hostLanguage();
    return host ? normalize(host) || 'en' : browserLanguage();
  }
  function format(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (match, key) =>
      params && Object.hasOwn(params, key) ? String(params[key]) : match);
  }
  function translate(key, params) {
    // Legacy hosts without snapshots still expose their active language through bind().
    if (preference === 'auto' && !hostLanguage() && bound) {
      try {
        const text = bound(key, params);
        if (typeof text === 'string' && text && text !== key) return format(text, params);
      } catch { /* use the local dictionary */ }
    }
    const dictionary = dictionaries[activeLanguage()] || dictionaries.en;
    return format(dictionary[key] ?? dictionaries.en[key] ?? key, params);
  }
  function notify() { listeners.forEach(listener => listener()); }
  function setPreference(value) {
    if (value !== 'auto' && !Object.hasOwn(dictionaries, value)) throw new Error('Unsupported language');
    // A failed write must not look like a saved preference.
    const storage = env.localStorage;
    if (!storage) throw new Error(translate('language.saveFailed'));
    if (value === 'auto') storage.removeItem(storageKey);
    else storage.setItem(storageKey, value);
    preference = value;
    notify();
  }
  function onStorage(event) {
    if (event.key !== storageKey && event.key !== null) return;
    preference = readPreference();
    notify();
  }
  let unsubscribeHost;
  try { if (service && typeof service.subscribe === 'function') unsubscribeHost = service.subscribe(notify); } catch { /* legacy host */ }
  if (typeof env.addEventListener === 'function') env.addEventListener('storage', onStorage);
  return {
    t: translate, locale: activeLanguage, normalize, preference: () => preference,
    options: () => Object.keys(labels).filter(id => dictionaries[id]).map(id => ({ id, label: labels[id] })),
    setPreference,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      if (typeof unsubscribeHost === 'function') unsubscribeHost();
      if (typeof env.removeEventListener === 'function') env.removeEventListener('storage', onStorage);
      listeners.clear();
    },
  };
}
let languageRuntime;
function createTranslator(service) {
  if (languageRuntime) languageRuntime.dispose();
  languageRuntime = createLanguageRuntime(LOCALE_NAMESPACE, LOCALES, service);
  return languageRuntime.t;
}
t = createTranslator(null);
// Compatibility with existing host snapshots, whose display fields are text.
// Known labels and messages follow the browser locale even while snapshots are cached.
function localizeHostText(message, translate, dictionaries) {
  if (typeof message !== 'string' || message.length === 0) return message
  const cache = localizeHostText.cache || (localizeHostText.cache = new WeakMap())
  let index = cache.get(dictionaries)
  if (!index) {
    const zh = dictionaries.zh || {}
    const languages = Object.keys(dictionaries)
    const exact = new Map()
    const templates = []
    for (const key of Object.keys(zh)) {
      for (const language of languages) {
        const value = dictionaries[language][key]
        if (typeof value === 'string' && !exact.has(value)) exact.set(value, key)
      }
      // host.* 是宿主自述文案；error.* 是「宿主错误码 → 中英文案」的同一批句子（v1.15 起错误键改名为
      // error.<code>），两者都可能出现在旧快照的 message 里，都要能按模板反查回客户端语言。
      if (key.startsWith('host.') || key.startsWith('error.')) {
        for (const language of languages) {
          const template = dictionaries[language][key]
          if (typeof template !== 'string' || !/\{\w+\}/.test(template)) continue
          const names = []
          const pattern = template.split(/(\{\w+\})/).map(function (part) {
            if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '([\\s\\S]*?)' }
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          }).join('')
          templates.push({ key: key, names: names, re: new RegExp('^' + pattern + '$') })
        }
      }
    }
    index = { exact: exact, templates: templates }
    cache.set(dictionaries, index)
  }
  if (index.exact.has(message)) return translate(index.exact.get(message))
  for (const entry of index.templates) {
    const match = entry.re.exec(message)
    if (match) {
      const params = {}
      entry.names.forEach(function (name, number) { params[name] = match[number + 1] })
      return translate(entry.key, params)
    }
  }
  return message
}
function hostText(message) { return localizeHostText(message, t, LOCALES); }
// 宿主错误文案（v1.15）：优先按稳定 code 取中英文案（error.<code>，宿主与客户端共用同一份字典），
// 字典里没有这个 code 时退回宿主原文（旧快照 / 宿主新错误码的兜底）。这样以后改宿主文案
// 不会让界面串语言，也不需要靠「按文案反查」来猜。
function errorText(error) {
  if (!error) return '';
  if (typeof error === 'string') return hostText(error);
  if (error.code) {
    const key = 'error.' + error.code;
    const localized = t(key, error.params);
    if (localized !== key) return localized;
  }
  return typeof error.message === 'string' ? hostText(error.message) : '';
}

const RPC_BASE = '/_dsh/dsh-bottom-info-bar';

// RPC 超时兜底：host 侧 15s 超时之上再留余量；端点挂起时 20s 内必失败，杜绝永久"加载中…"
const RPC_TIMEOUT_MS = 20000;

// 首启强制刷新窗口：页面刚打开/用户手动刷新后的这几秒内，快照请求带 force=true，
// host 会绕过缓存与失败退避当场重查服务商——用户刷新页面立即看到最新余额/额度，
// 不必干等后台 60s 自动周期。覆盖窗口需容纳会话模型从空到确定的短暂翻转期。
const BOOT_AT = Date.now();
const FORCE_REFRESH_WINDOW_MS = 6000;
// 版本提醒的重读间隔：npm 侧由 host 按 TTL 缓存，这里只是读本地接口，
// 60 秒一次足够让「本地副本更新完」的提醒自己消失，也不会给宿主添负担。
const UPDATE_INFO_REFRESH_MS = 60000;

// rpc(method, args, externalSignal)：
// - 超时：20s 未响应 → abort 并以"请求超时"失败（fetch 挂起不阻塞界面）
// - 可中止：传入外部 AbortSignal（组件卸载时 abort）→ 立即取消并拒绝"请求已取消"
function rpc(method, args, externalSignal) {
  let abortReason = null;
  const controller = new AbortController();
  // 无定时器的极简宿主里 timer 为 null：按无超时继续（与 host 侧 timeoutSignal 缺席降级同型）。
  const timer = scheduleTimeout(function () { abortReason = t('ui.requestTimedOut'); controller.abort(); }, RPC_TIMEOUT_MS);
  function onExternalAbort() { abortReason = t('ui.requestCanceled'); controller.abort(); }
  function cleanup() {
    cancelTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
  if (externalSignal) {
    if (externalSignal.aborted) {
      cleanup();
      return Promise.reject(new Error(t('ui.requestCanceled')));
    }
    externalSignal.addEventListener('abort', onExternalAbort);
  }
  return fetch(RPC_BASE + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
    signal: controller.signal,
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (raw) {
        let body = null;
        try { body = JSON.parse(raw); } catch (e) { /* 非 JSON 错误体 */ }
        throw new Error((body && body.error) || ('HTTP ' + res.status));
      });
    }
    return res.text().then(function (raw) {
      try { return JSON.parse(raw); } catch (e) { throw new Error(t('ui.couldNotParseResponse')); }
    });
  }).catch(function (err) {
    // 本函数主动 abort（超时/外部取消）→ 统一为可读错误；其余错误原样抛出
    if (abortReason !== null) throw new Error(abortReason);
    if (err && err.name === 'AbortError') throw new Error(t('ui.requestCanceled'));
    throw err;
  }).finally(cleanup);
}

// load() 的逐接口容错状态合并（模块级纯函数，供单测提取）：
// 成功端点 → 写新值 + 清除错误；失败端点 → 保留旧值（无旧数据则为 null）+ 记录错误信息。
// results 与端点顺序一一对应：balance / pricing / usage / billingMode / sub / billing。
function mergeLoadResults(prev, results, selectionKey) {
  const keys = ['balance', 'pricing', 'usage', 'billingMode', 'sub', 'billing'];
  const hasSelectionKey = typeof selectionKey === 'string';
  const previousSelectionKey = prev && typeof prev.selectionKey === 'string' ? prev.selectionKey : '';
  const nextSelectionKey = hasSelectionKey ? selectionKey : previousSelectionKey;
  const sameSelection = !hasSelectionKey || previousSelectionKey === nextSelectionKey;
  const next = { loading: false, selectionKey: nextSelectionKey, errors: { balance: null, pricing: null, usage: null, billingMode: null, sub: null, billing: null } };
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const r = results[i];
    if (r && r.status === 'fulfilled') {
      next[key] = r.value;
    } else {
      // A failed request may keep the last good value only for the same
      // session/model. Never let a previous session balance, quota, bill,
      // or spend cross the selection boundary while the new request fails.
      next[key] = sameSelection ? prev[key] : null;
      const reason = r && r.reason;
      next.errors[key] = reason && reason.message ? String(reason.message) : String(reason || t('ui.rpcFailed'));
    }
  }
  return next;
}

// ---------- v1.9.0 PR2：字段显隐/颜色配置（宿主落盘，设置页变更后经 CustomEvent 即时同步） ----------
// 字段注册表/预设色板由构建从 constants.js 注入（单一来源，宿主白名单同源）
const FIELD_REGISTRY = [
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
  { id: 'avgTTFT', label: "field.avgTTFT.label", group: 'native', colorKind: 'inherit', note: "field.avgTTFT.note" },
  { id: 'outputSpeed', label: "field.outputSpeed.label", group: 'native', colorKind: 'inherit', note: "field.outputSpeed.note" },
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
];
const PRESET_COLORS = ['red', 'green', 'blue', 'purple', 'orange', 'neutral'];
// v1.6 T7 / v1.7 FR-14：订阅/账单 provider 集合（构建注入，永不变）。以前在 BottomInfoBar 里每次渲染重建
// 字面量——值从不变，多建的只是垃圾。提到模块级，var 拼法保留（一致性测试按该字面锚点提取）。
var SUBSCRIPTION_PROVIDERS = ['codex', 'chatgpt', 'opencode-go', 'opencode', 'openai-codex', 'zai', 'zai-coding-cn', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams', 'command', 'command-code', 'minimax', 'minimax-cn'];
var BILLING_PROVIDERS = ['together', 'fireworks', 'amazon-bedrock', 'cloudflare-ai-gateway', 'cloudflare-workers-ai', 'huggingface'];
const PRESET_COLOR_SET = new Set(PRESET_COLORS);

// v1.16：订阅窗口百分比方向（quotaDisplayMode）。'remaining' = 历史行为（默认），'used' = 显示已用。
// 契约：宿主缺字段 / 给出非法值时一律回退 'remaining'，任何输入都不得抛错（老宿主 = 老行为）。
const QUOTA_DISPLAY_MODES = ['used', 'remaining'];
const DEFAULT_QUOTA_DISPLAY_MODE = 'remaining';
function normalizeQuotaDisplayMode(value) {
  return value === 'used' || value === 'remaining' ? value : DEFAULT_QUOTA_DISPLAY_MODE;
}
// 信息栏渲染期读取当前方向（模块级配置，随 fieldConfigVersion 触发重渲染）
function activeQuotaDisplayMode() {
  return normalizeQuotaDisplayMode(fieldConfig.quotaDisplayMode);
}

let fieldConfig = { fields: {}, colors: {}, timeZones: { main: 'Asia/Shanghai', world: 'UTC' }, customText: '', quotaDisplayMode: DEFAULT_QUOTA_DISPLAY_MODE };
let fieldConfigVersion = 0;
let fieldConfigServerVersion = -1; // 宿主 configVersion（-1=尚未取得）；过期响应据此丢弃（D3）
const fieldConfigListeners = new Set();
let fieldConfigInFlight = false;
let fieldConfigRefetchPending = false; // 在途期间收到刷新请求（如设置页 CustomEvent）→ 当前响应落地后立即补拉（D3）

function applyFieldConfigSnapshot(next) {
  fieldConfig = {
    fields: next && next.fields && typeof next.fields === 'object' ? next.fields : {},
    colors: next && next.colors && typeof next.colors === 'object' ? next.colors : {},
    timeZones: next && next.timeZones && typeof next.timeZones === 'object' ? next.timeZones : { main: 'Asia/Shanghai', world: 'UTC' },
    customText: typeof (next && next.customText) === 'string' ? next.customText : '',
    quotaDisplayMode: normalizeQuotaDisplayMode(next && next.quotaDisplayMode),
  };
  if (next && typeof next.customTextValue === 'string' && !next.customText) fieldConfig.customText = next.customTextValue;
  fieldConfigVersion += 1;
  fieldConfigListeners.forEach(function (listener) { listener(); });
}

// 版本守卫（纯函数，供单测）：只有严格更新的快照才应用。
// - incoming 缺失（旧宿主无 configVersion）→ 接受，兼容不阻断；
// - 尚未应用过任何快照（applied < 0）→ 接受；
// - 相同版本不重复应用（宿主每次变更必 +1，同版本即同内容，省去 30s 轮询的无谓重渲染）；
// - 过期响应（incoming < applied）→ 拒绝，绝不回退用户刚保存的配置。
// 注：宿主重启必然伴随 dsh web 重启与页面重载，客户端版本号随之重置，不存在版本回退场景。
function fieldConfigSnapshotIsNewer(incomingVersion, appliedVersion) {
  if (typeof incomingVersion !== 'number') return true;
  if (!(appliedVersion >= 0)) return true;
  return incomingVersion > appliedVersion;
}

// 宿主把配置常驻内存缓存，拉取即回；在途去重避免 30s 轮询叠加请求。
// D3：在途期间的新刷新请求（设置页 CustomEvent）记为 pending，当前响应落地后立即补拉，
// 配合版本守卫——过期响应直接丢弃——保证刚保存的配置最迟一次往返内生效，绝不被旧响应覆盖。
function refreshFieldConfig() {
  if (fieldConfigInFlight) { fieldConfigRefetchPending = true; return; }
  fieldConfigInFlight = true;
  rpc('getFieldConfig').then(function (cfg) {
    fieldConfigInFlight = false;
    if (cfg && typeof cfg === 'object') {
      const incoming = typeof cfg.configVersion === 'number' ? cfg.configVersion : null;
      if (fieldConfigSnapshotIsNewer(incoming, fieldConfigServerVersion)) {
        if (incoming !== null) fieldConfigServerVersion = incoming;
        applyFieldConfigSnapshot(cfg);
      }
      // 过期/相同版本响应：直接丢弃，不触发重渲染
    }
    if (fieldConfigRefetchPending) { fieldConfigRefetchPending = false; refreshFieldConfig(); }
  }).catch(function () {
    fieldConfigInFlight = false;
    if (fieldConfigRefetchPending) { fieldConfigRefetchPending = false; refreshFieldConfig(); }
  });
}

// 未知/缺省 id 一律视为显示：与历史行为一致（默认值全部=显示），前向兼容新字段
function fieldVisible(id) {
  return fieldConfig.fields[id] !== false;
}

function fieldColor(id) {
  const value = fieldConfig.colors[id];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// 时间格式化（主/世界共用）：固定通用格式 YYYY-MM-DD HH:mm，不提供自定义选项。
const _formatClockCache = new Map();
function _getClockFormatter(timeZone) {
  const zone = typeof timeZone === 'string' && timeZone.length > 0 ? timeZone : 'UTC';
  let f = _formatClockCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    if (_formatClockCache.size >= 16) {
      const first = _formatClockCache.keys().next().value;
      _formatClockCache.delete(first);
    }
    _formatClockCache.set(zone, f);
  }
  return f;
}
function pad2(x) { return String(x).padStart(2, '0'); }
function formatClock(nowMs, timeZone) {
  const zone = typeof timeZone === 'string' && timeZone.length > 0 ? timeZone : 'UTC';
  try {
    const parts = _getClockFormatter(zone).formatToParts(new Date(nowMs));
    const map = {};
    for (let i = 0; i < parts.length; i++) { const p = parts[i]; if (p.type !== 'literal') map[p.type] = p.value; }
    if (!map.year || !map.month || !map.day || !map.hour || !map.minute) return '';
    return map.year + '-' + map.month + '-' + map.day + ' ' + map.hour + ':' + map.minute;
  } catch (e) {
    return '';
  }
}
const TIME_ZONE_OPTIONS = ['Asia/Shanghai', 'UTC', 'Asia/Tokyo', 'Asia/Singapore', 'Asia/Dubai', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'];

// 深色主题下把自定义 hex 向白色混合 45%，避免深底上不可读；预设色名走三套主题变量，无需处理
function readableDarkVariant(hex) {
  const value = parseInt(hex.slice(1), 16);
  function mix(channel) { return Math.round(channel + (255 - channel) * 0.45); }
  const r = mix((value >> 16) & 255);
  const g = mix((value >> 8) & 255);
  const b = mix(value & 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

// WCAG 相对亮度（对比度计算用，纯函数供单测）
function hexLuminance(value) {
  function linear(channel) {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return 0.2126 * linear((value >> 16) & 255) + 0.7152 * linear((value >> 8) & 255) + 0.0722 * linear(value & 255);
}

// 浅色主题钳制（D2）：自定义 hex 对白底对比度 < 4.5:1 时逐级向黑混合（每步 5%，至多 95%），
// 直到可读；本就可读的颜色原样返回（大写规范化）。深浅两套变量由此始终各自可读。
function readableLightVariant(hex) {
  const value = parseInt(hex.slice(1), 16);
  if (1.05 / (hexLuminance(value) + 0.05) >= 4.5) return hex.toUpperCase();
  for (let step = 1; step <= 19; step++) {
    const keep = 1 - step * 0.05;
    const r = Math.round(((value >> 16) & 255) * keep);
    const g = Math.round(((value >> 8) & 255) * keep);
    const b = Math.round((value & 255) * keep);
    const candidate = (r << 16) | (g << 8) | b;
    if (step === 19 || 1.05 / (hexLuminance(candidate) + 0.05) >= 4.5) {
      return '#' + candidate.toString(16).padStart(6, '0').toUpperCase();
    }
  }
  return hex.toUpperCase();
}

// 字段已自定义颜色时返回要注入的 CSS 变量；未自定义返回 undefined → 变量不存在 → 完全沿用现有颜色（零回归）
// 浅色默认层取浅色钳制变体（--bi-field-<id>），深色覆盖层取向白加亮变体（--bi-field-<id>-dark）
function fieldStyle(id) {
  const color = fieldColor(id);
  if (!color) return undefined;
  const style = {};
  if (PRESET_COLOR_SET.has(color)) {
    style['--bi-field-' + id] = 'var(--bi-palette-' + color + ')';
    return style;
  }
  style['--bi-field-' + id] = readableLightVariant(color);
  style['--bi-field-' + id + '-dark'] = readableDarkVariant(color);
  return style;
}

// 字段级颜色 CSS 生成：回退值=各字段原语义色，未自定义时渲染结果与旧版一致。
// 深色主题规则用更高优先级选择器优先取 hex 加亮变体（--bi-field-<id>-dark；预设色名无该变量时自然回落）。
function buildFieldColorCss() {
  const rules = [];
  for (let i = 0; i < FIELD_REGISTRY.length; i++) {
    const field = FIELD_REGISTRY[i];
    const id = field.id;
    const kind = field.colorKind;
    const attr = '[data-field="' + id + '"]';
    let pairs;
    if (kind === 'alert') {
      pairs = [
        ['.bi-root ' + attr + '.bi-err', 'var(--bi-state-alert)'],
        ['.bi-root ' + attr + '.bi-stale', 'var(--bi-state-alert)'],
        ['.bi-root ' + attr + '.bi-update', 'var(--bi-state-alert)'],
      ];
    } else if (kind === 'period') {
      pairs = [
        ['.bi-root ' + attr + '.bi-peak', 'var(--bi-state-alert)'],
        ['.bi-root ' + attr + '.bi-offpeak', 'var(--bi-state-price-low)'],
      ];
    } else if (kind === 'provider') {
      pairs = [
        ['.bi-root ' + attr, 'inherit'],
        ['.bi-root ' + attr + ' .bi-model-provider', 'var(--bi-label-primary)'],
      ];
    } else if (kind === 'meter') {
      // 原生圆环类：回退原生同款弱提示色（--bi-separator 即 --dsw-alias-label-tertiary，与原生 ContextMeter 同色）
      pairs = [['.bi-root ' + attr, 'var(--bi-separator)']];
    } else if (kind === 'muted') {
      pairs = [['.bi-root ' + attr, 'var(--bi-label-supporting)']];
    } else {
      pairs = [['.bi-root ' + attr, 'inherit']];
    }
    for (let j = 0; j < pairs.length; j++) {
      const selector = pairs[j][0];
      const fallback = pairs[j][1];
      const light = 'var(--bi-field-' + id + ', ' + fallback + ')';
      const dark = 'var(--bi-field-' + id + '-dark, ' + light + ')';
      rules.push(selector + ' { color: ' + light + '; }');
      rules.push('body[data-ds-dark-theme] ' + selector + ' { color: ' + dark + '; }');
    }
  }
  return rules.join('\n');
}
const FIELD_COLOR_CSS = buildFieldColorCss();
// 订阅窗口元表（一个概念只允许一张表）：key → 字段 id / 排序优先级 / 完整标签字典键 / 紧凑缩写。
// 三个窗口是三个独立字段，各自开关、各自着色，两种模式一视同仁；未知 key 走兜底（字段回 subWindow5h、标签回传进来的 label）。
const WINDOW_META = {
  five_hour: { field: 'subWindow5h', priority: 1, labelKey: 'host.hour', short: '5h' },
  seven_day: { field: 'subWindowWeek', priority: 2, labelKey: 'ui.weekly', short: null },
  monthly: { field: 'subWindowMonth', priority: 3, labelKey: 'ui.monthly', short: null },
};
function windowMeta(key) {
  return Object.hasOwn(WINDOW_META, key) ? WINDOW_META[key] : null;
}
function windowFieldVisible(key) {
  const meta = windowMeta(key);
  return meta ? fieldVisible(meta.field) : true;
}

// 降级节点现在包着 data-field 容器（fieldSpan 着色），文案要穿透一层包装再读
function trailingErrorText(node) {
  let current = node;
  for (let depth = 0; depth < 3 && current && current.props; depth++) {
    const child = current.props.children;
    if (typeof child === 'string') return child;
    current = child;
  }
  return '';
}

// 行组装（模块级纯函数，createElement 注入以便单测用桩验证分隔符收合与全隐藏零输出）：
// 居中组之间插一个分隔符；尾部错误组多来源「刷新失败」去重后逐个接在右侧，
// 分隔符只在已有内容之后出现——全空输入返回空数组（D6：零节点/零分隔符）。
function assembleInfoBarRow(groups, trailingErrorGroups, createElement) {
  const nodes = [];
  for (let i = 0; i < groups.length; i++) {
    if (i > 0) nodes.push(createElement('span', { key: 'sep' + i, className: 'bi-sep' }, '|'));
    nodes.push(createElement('span', { key: 'g' + i }, groups[i]));
  }
  const seenRefreshFailure = { value: false };
  const visibleErrors = trailingErrorGroups.filter(function (node) {
    const text = trailingErrorText(node);
    if (text !== t('ui.refreshFailed')) return true;
    if (seenRefreshFailure.value) return false;
    seenRefreshFailure.value = true;
    return true;
  });
  for (let i = 0; i < visibleErrors.length; i++) {
    if (groups.length > 0 || i > 0) nodes.push(createElement('span', { key: 'errsep' + i, className: 'bi-sep' }, '|'));
    nodes.push(createElement('span', { key: 'err' + i }, visibleErrors[i]));
  }
  return nodes;
}

// 上下文圆环的落位（2026-09-24 用户报「圆环被单独挤到下一行并居中」）：
// 圆环原本作为主行的独立 flex 子项追加在末尾 —— 行满换行时它会独占一行，居中后非常难看。
// 改为与「最后一个内容节点」一起包进同一个 nowrap 尾巴（.bi-tail）：要换行两者一起走，
// 圆环永远不会孤零零占一行；没有内容节点时（只显示圆环）保持原样。
function attachContextMeter(nodes, contextNode, createElement) {
  if (!contextNode) return nodes.slice();
  if (nodes.length === 0) return [contextNode];
  const out = nodes.slice();
  out[out.length - 1] = createElement('span', { key: 'tail', className: 'bi-tail' }, out[out.length - 1], contextNode);
  return out;
}

// D6 用户拍板：全部字段隐藏 = 底栏彻底移除。此判定为纯函数供单测：
// 注册表内没有任何可见字段，或渲染结果（原生行/主行/错误组）全空 → 信息栏整体不渲染，
// 不留空行、占位高度或悬空分隔符；density 点击因无 DOM 而天然无副作用。
function infoBarShouldRemoveAll(registry, isVisible) {
  for (let i = 0; i < registry.length; i++) {
    if (isVisible(registry[i].id)) return false;
  }
  return registry.length > 0;
}

// 余额悬停明细（2026-10-07 用户拍板）：底栏只放得下一个总数，但用户想知道其中「充的钱」与
// 「送的钱」各是多少 —— 两者的来源与规则不同，并成一个数就分不清了。
// 文案与 DSH 设置页逐字对齐（充值余额 / 赠金余额，见 src/locales.js）：宿主已经这么叫，
// 插件换一套说法只会让同一个数在同一个界面上有两个名字。
// 展开条件只有一条「赠金为正」：
//   · 赠金为 0 时（大多数服务商没有赠金概念）多出来的两行只是把同一个数字说三遍；
//   · 首行直接沿用调用方给的既有文案，不展开时与老版本逐字一致 —— 零回归。
// 金额取不到（老快照 / 非数字形态）按 0 处理：宁可少显示一行明细，也不猜一个数。
function balanceHoverLines(baseTitle, data, symbol, translate, format) {
  const lines = [baseTitle];
  if (!data || typeof data !== 'object') return lines;
  const granted = typeof data.granted === 'number' && isFinite(data.granted) ? data.granted : 0;
  if (!(granted > 0)) return lines;
  const toppedUp = typeof data.toppedUp === 'number' && isFinite(data.toppedUp) ? data.toppedUp : 0;
  lines.push(translate('ui.balanceDetailToppedUp', { symbol: symbol, value: format(toppedUp) }));
  lines.push(translate('ui.balanceDetailGranted', { symbol: symbol, value: format(granted) }));
  return lines;
}

// 两处样式安装函数各自先探 DOM（无 DOM 的宿主启动路径上直接返回空 disposer，绝不抛）：
// 有意各写一遍而不抽 helper——两个函数都会被测试单独抽出求值（installStyles 走切片、
// bibSetInstallStyles 走单函数抽取），helper 在抽离求值时不可见（localizeHostText 自包含原则）；
// 改一处必须改另一处， tests/test-static-client.cjs 把两处同时锁死。
function installStyles() {
  if (typeof document === 'undefined' || !document
    || typeof document.querySelector !== 'function'
    || typeof document.createElement !== 'function' || !document.head) return function () {};
  const id = 'dsh-bottom-info-bar';
  const existing = document.querySelector('style[data-plugin-css="' + id + '"]');
  if (existing !== null) return function () {};
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-bottom-info-bar';
  style.dataset.pluginCss = id;
  style.textContent = `
      /* 样式源约定（P1-20 收尾）：信息栏只用 --bi-*，设置页只用 --bib-*，色板/状态色共用同一套。
         两边零交叉引用是测出来的（见测试），不是约出来的——新规则不许串台，串了测试会红。 */
      /* 垂直节奏只有 --bi-line 一个来源：两行永远相邻，行间间距恒为 0（无 gap、无 margin）。
         宽度取宿主的内容宽度令牌（确定值），而不是让 fit-content 的 dock 按内容反推宽度——
         否则「文字变长 → 根节点变宽 → 另一行换行时机改变」会让版式随内容抖动。
         本节点是 column flex + 两个 flex:none 的行：既不会被拉伸/压扁，也不会增长；
         justify-content / align-content 双双收尾（flex 与 grid 各认一个），
         保证「万一祖先强行给出多余高度」时，多余部分只会落在第一行之上（栏外侧），
         绝不会落在两行之间——那正是用户看到的「间距异常扩大」。
         align-self / height 是防拉伸护栏，让本节点高度只由内容决定。
         宽度与字号都必须是「宿主的确定值」，且不得再叠加任何近似推导：
         · 宽度取 --dsh-chat-content-width。宿主侧 --dsh-composer-card-max-width = 内容宽度 + 32px，
           而卡片自身左右各有 --dsh-composer-side-clearance(16px) 内边距，两者相抵 ——
           **卡片的文字区宽度恰好等于内容宽度**，也就是本节点的宽度。
           所以本节点左右内边距必须是 0：再补 clearance+16px 属于把已经算过的账算第二遍，
           可用宽度白白少 64px（2026-09-25 用户报「能一行显示却换行」的直接原因）。
         · 字号取 --dsh-content-font-size-secondary（宿主次级字号），行高 = 基础 20px + 宿主的字号增量。
           不得写死 px：宿主提供字号设置，写死会让信息栏在用户调大字号后仍停在旧尺寸。 */
      /* 视觉胶囊配色是固定值而非色板变量：色板蓝在深色主题会翻成 #66a3ff，而胶囊的白字对比度是按 #0057ff 实测的，跟随翻转会跌破 4.5:1。 */
      .bi-root { --bi-vision-border: #0044cc; --bi-vision-bg: #0057ff; --bi-label-primary: var(--dsw-alias-label-primary, #333); --bi-label-supporting: #3f444a; --bi-separator: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.5)); --bi-state-price-low: #087f5b; --bi-state-alert: #d92d20; --bi-line: calc(20px + var(--dsh-content-font-delta-secondary, 0px)); --bi-extra-h: var(--bi-line); text-align: center; box-sizing: border-box; width: var(--dsh-chat-content-width, 100%); max-width: 100%; padding: 4px 0px 0px; margin: 0 auto; display: flex; flex-direction: column; justify-content: flex-end; align-content: end; align-items: stretch; gap: 0; align-self: center; height: auto; font-size: var(--dsh-content-font-size-secondary, 13px); line-height: var(--bi-line); color: var(--bi-label-supporting); font-variant-numeric: tabular-nums; cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
      .bi-root[data-density-saving="true"] { cursor: progress; }
      /* 以 DSH 实际外观属性切换，避免用户在 DSH 内手动选择外观时与系统偏好失配。 */
      body[data-ds-dark-theme] .bi-root { --bi-label-supporting: var(--dsw-alias-label-secondary, #cfd3d6); --bi-state-price-low: #86efac; --bi-state-alert: #ff6961; }
      /* 系统要求增强对比度时，浅色使用更深的同语义色；深色仅提高尚未达到 7:1 的警示红。 */
      @media (prefers-contrast: more) { body:not([data-ds-dark-theme]) .bi-root { --bi-state-price-low: #05603a; --bi-state-alert: #ad1717; } body[data-ds-dark-theme] .bi-root { --bi-state-alert: #ff7770; } }
      .bi-native-row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; width: 100%; }
      /* 密度切换只收合完整模式独有的原生统计行：160ms 足以表达层级变化，又不会拖慢连续操作。
         高度必须是「确定值」：full = 原生行实测高度（--bi-extra-h，默认一行），compact = 0px。
         严禁改用 fr 轨道（grid-template-rows: 1fr/0fr）收合：fr 轨道会吸收容器的自由空间，
         一旦祖先被拉伸或拿到确定高度，那段自由空间就正好落在两行之间变成凭空的空隙
         （2026-09-23 用户报告的「偶发间距异常扩大」就是这一形态：文字仍贴在行首，下面多出一段空白）。 */
      .bi-root > .bi-density-extra { flex: none; display: block; height: var(--bi-extra-h); overflow: hidden; opacity: 1; transition: height 160ms cubic-bezier(0.2, 0, 0, 1), opacity 120ms linear; }
      .bi-root[data-density="compact"] > .bi-density-extra { height: 0px; opacity: 0; }
      @media (prefers-reduced-motion: reduce) { .bi-density-extra { transition: none; } }
      /* 整条信息栏始终作为一个居中的内容组；不会超过上方对话框的内容宽度。 */
      .bi-root > .bi-row2 { flex: none; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; width: 100%; }
      .bi-native-row > span, .bi-row2 > span { white-space: nowrap; }
      /* 圆环与最后一个内容节点同组：换行时一起走，绝不单独占一行（见 attachContextMeter） */
      .bi-tail { display: inline-flex; align-items: center; flex: 0 0 auto; max-width: 100%; white-space: nowrap; }
      /* 只有模型组可在窄宽度折行；服务商与模型详情仍成组，不会让圆点落在行尾。 */
      .bi-row2 > .bi-model-group { white-space: normal; }
      /* 组间 6px、模型内部圆点 4px：保留分组层级，同时避免过大的留白把这一行文字拉散。 */
      .bi-sep { color: var(--bi-separator); margin: 0 6px; }
      /* 服务商名等一般强调：加粗 600 */
      .bi-root b { color: var(--bi-label-primary); font-weight: 600; }
      /* 数字：加粗 700（余额/倒计时/本会话花费/原生统计数字） */
      .bi-root b.bi-num { font-weight: 700; }
      /* 标签与数据不用字符空格拼接：统一由 4px 布局间距控制，避免中英文/数字字宽造成忽松忽紧。 */
      .bi-metric { display: inline-flex; align-items: baseline; white-space: nowrap; }
      .bi-metric-data { margin-left: 4px; }
      /* 状态标签用 600；核心数值才用 700，避免颜色、字重双重过度强调。 */
      .bi-peak    { color: var(--bi-state-alert); font-weight: 600; }
      .bi-offpeak { color: var(--bi-state-price-low); font-weight: 600; }
      .bi-err, .bi-stale { color: var(--bi-state-alert); font-weight: 600; }
      .bi-muted{ color: var(--bi-label-supporting); }
      /* 低余额/低额度是数值的状态修饰，而非独立组件：无框“低”字避免制造第二个视觉焦点。 */
      .bi-low-status { margin-left: 3px; color: var(--bi-state-alert); font-weight: 600; }
      .bi-root b.bi-alert-num, .bi-root b.bi-quota-low { color: var(--bi-state-alert); font-weight: 700; }
      /* 新版本需要用户处理：与其它提醒统一用鲜红警示色，不伪装成链接。
         只用手型光标作提示——不加下划线、不改颜色，保持「告警」而非「链接」的语义
         （test-update-check 有「无下划线」的专项断言）。 */
      .bi-update{ color: var(--bi-state-alert); font-weight: 600; cursor: pointer; }
      /* 自更新状态短标记：只在「已下载待重启」或「上次自动更新失败」时出现，重启/修复后自动消失。
         与 .bi-update 区分：它不需要用户点击，所以用默认光标 + 1px currentColor 描边成胶囊，
         明确「这是状态标签，不是可点链接」。
         反色铁律：只描边、不加背景色，文字仍落在信息栏自身底色上（与 .bi-err 同色同底），
         不引入任何新的前景/背景配对，明暗主题都沿用既有已验证的对比度。 */
      .bi-update-badge{ margin-left: 6px; padding: 0 5px; border: 1px solid currentColor; border-radius: 4px; font-weight: 600; color: var(--bi-state-alert); cursor: default; }
      /* 失败态比「待重启」（可预期的正常流程）更需要被看见：同色加到 700，靠字重分层而非换颜色。 */
      .bi-update-badge--error{ font-weight: 700; }
      /* 视觉能力是模型属性，不是告警：电光蓝实色、白字；高度收紧到字形范围内，避免压过同一行文字。 */
      /* 服务商、圆点、视觉胶囊在同一 20px flex 行内居中，避免混用文字基线造成上下漂移。 */
      .bi-model-group { display: inline-flex; align-items: center; justify-content: center; flex-wrap: wrap; max-width: 100%; min-width: 0; min-height: var(--bi-line); vertical-align: top; }
      .bi-model-provider, .bi-model-dot { display: inline-flex; align-items: center; height: 16px; line-height: 14px; }
      .bi-model-detail { display: inline-flex; align-items: center; min-width: 0; max-width: 100%; }
      .bi-model-dot { margin: 0 4px; flex: 0 0 auto; }
      .bi-model-name { min-width: 0; overflow-wrap: anywhere; }
      .bi-vision { display: inline-flex; align-items: center; box-sizing: border-box; min-width: 0; max-width: 100%; height: 16px; margin: 0; padding: 0 6px; border: 1px solid var(--bi-vision-border); border-radius: 999px; color: #fff; background: var(--bi-vision-bg); font-size: 12px; font-weight: 600; line-height: 14px; white-space: nowrap; }
      .bi-vision-model { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .bi-vision-kind { flex: 0 0 auto; margin-left: 4px; }
      /* 会话目录未给出能力时，保留模型名称；只等待能力标识，不猜测为文本模型。 */
      .bi-model-capability-pending { pointer-events: none; }
      /* 读屏说明不参与视觉排版。 */
      .bi-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
      /* v1.9.0 PR2 预设色板：浅色默认 → 深色覆盖 → 增强对比三套成对（与现有语义色同一套规则）；设置页共用 .bib-set-root 取同一色板 */
      .bi-root, .bib-set-root { --bi-palette-red: #d92d20; --bi-palette-green: #087f5b; --bi-palette-blue: #0044cc; --bi-palette-purple: #6941c6; --bi-palette-orange: #b54708; --bi-palette-neutral: var(--dsw-alias-label-primary, var(--bi-label-primary, #333)); }
      body[data-ds-dark-theme] .bi-root, body[data-ds-dark-theme] .bib-set-root { --bi-palette-red: #ff6961; --bi-palette-green: #86efac; --bi-palette-blue: #66a3ff; --bi-palette-purple: #b19cf7; --bi-palette-orange: #fdb022; }
      @media (prefers-contrast: more) { body:not([data-ds-dark-theme]) .bi-root, body:not([data-ds-dark-theme]) .bib-set-root { --bi-palette-red: #ad1717; --bi-palette-green: #05603a; --bi-palette-blue: #003399; --bi-palette-purple: #4a1fb8; --bi-palette-orange: #7a2e0e; } body[data-ds-dark-theme] .bi-root, body[data-ds-dark-theme] .bib-set-root { --bi-palette-red: #ff7770; --bi-palette-blue: #80b3ff; --bi-palette-purple: #c9b8ff; --bi-palette-orange: #ffcc80; } }
      /* 上下文占用圆环（接管 DSH 原生 ContextMeter）：几何、字体、字号、圆角与原生逐条对齐，
         唯一的变化是它现在住在信息栏主行最右端，与这一行文字共用同一条基线。 */
      .bi-ctx { display: inline-flex; align-items: center; flex: 0 0 auto; margin-left: 8px; }
      /* 颜色走字段体系：容器带 data-field，描边用 currentColor，因此换色只改一处（未自定义时回退原生弱提示色）。 */
      .bi-ctx-trigger { display: inline-flex; align-items: center; gap: 6px; flex: none; margin: 0; padding: 1px 8px; border: none; border-radius: 24px; background: 0 0; color: inherit; font-family: inherit; font-size: var(--dsh-content-font-size-secondary, 13px); font-variant-numeric: tabular-nums; line-height: var(--bi-line); white-space: nowrap; cursor: pointer; }
      .bi-ctx-trigger:hover, .bi-ctx-trigger[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.14)); color: var(--bi-label-primary); }
      .bi-ctx-ring { flex: none; display: block; }
      .bi-ctx-track { fill: none; stroke: var(--dsw-alias-border-l3, rgba(128, 128, 128, 0.35)); stroke-width: 2px; }
      .bi-ctx-fill { fill: none; stroke: currentColor; stroke-width: 2px; stroke-linecap: round; }
      /* 构成明细面板：与原生 ContextMeter 面板同构（264px 宽 / 12px 内边距 / 12px 圆角 / 4px 构成条）。
         宽度另见 CONTEXT_PANEL_WIDTH（JS 定位算法用同一数值，两处改必须一起改）。 */
      /* 面板底色必须不透明（2026-09-24 用户报「面板透明、文字和底下的信息栏叠在一起看不清」）：
         宿主 --dsw-specific-menu 是带 alpha 的色（浅 #f8f9fa94 / 深 #30313680），且宿主菜单另有毛玻璃层，
         本面板悬在信息栏文字之上，直接用它必然透字。改用不透明的层级底色（浅 #fff / 深 #353638，随主题走），
         并保留宿主阴影；不引用任何可能带 alpha 的 token。 */
      .bi-ctx-panel { z-index: 1100; box-sizing: border-box; width: min(264px, calc(100vw - 24px)); padding: 12px; border: 0.5px solid var(--dsw-alias-border-l4, rgba(128, 128, 128, 0.28)); border-radius: 12px; background: var(--dsw-alias-bg-layer-3, #fff); color: var(--dsw-alias-label-secondary, #5a6169); box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0, 0, 0, 0.18)); font-size: 12px; line-height: var(--bi-line); cursor: default; position: fixed; }
      .bi-ctx-panel-header { display: flex; align-items: center; gap: 6px; }
      .bi-ctx-panel-headline { color: var(--dsw-alias-label-tertiary, #8a9099); }
      .bi-ctx-panel-headline:empty { display: none; }
      .bi-ctx-panel-percent { color: var(--dsw-alias-label-primary, #1f2328); font-weight: 500; }
      .bi-ctx-panel-figures { margin-left: auto; color: var(--dsw-alias-label-primary, #1f2328); font-weight: 500; font-variant-numeric: tabular-nums; }
      .bi-ctx-panel-bar { display: flex; gap: 1px; height: 4px; margin: 10px 0 12px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.14)); overflow: hidden; }
      .bi-ctx-segment { flex: none; min-width: 2px; height: 100%; border-radius: 1px; background: var(--bi-ctx-tint, var(--dsw-alias-label-tertiary, #8a9099)); }
      .bi-ctx-seg-system { --bi-ctx-tint: var(--dsw-static-neutral-bluish-400, #a5b4fc); }
      .bi-ctx-seg-tools { --bi-ctx-tint: #a78bfa; }
      .bi-ctx-seg-messages { --bi-ctx-tint: var(--dsw-static-blue-450, #3b7bfa); }
      .bi-ctx-panel-rows { display: block; margin: 6px 0 0; }
      .bi-ctx-panel-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 2px 0; }
      .bi-ctx-panel-row dt { display: flex; align-items: center; color: var(--dsw-alias-label-secondary, #5a6169); }
      .bi-ctx-panel-row dd { margin: 0; color: var(--dsw-alias-label-primary, #1f2328); font-variant-numeric: tabular-nums; }
      .bi-ctx-swatch { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 2px; background: var(--bi-ctx-tint, var(--dsw-alias-label-tertiary, #8a9099)); }
      /* 圆环已由本插件接管：隐藏信息栏所在 dock 里的原生那一份，保证屏幕上有且只有一个圆环。
         不绑 DSH 的哈希类名，只认结构——「同一个 dock 行 + 直接子级 span + 内含 14px 圆环按钮」，
         并要求该 span 内不含本插件信息栏（避免误伤包着信息栏的插槽包装元素）。 */
      [class*="_dock"]:has(.bi-root) > span:not(:has(.bi-root)):has(button[aria-haspopup="dialog"] svg[viewBox="0 0 14 14"]) { display: none !important; }
      /* 字段级颜色消费规则由注册表生成，拼接在样式表顶层（任何环境生效）——严禁并入上方 @media 块（D1 回归警戒） */
` + FIELD_COLOR_CSS + `
    `;
  document.head.appendChild(style);
  return function () { style.remove(); };
}

// ---------- 上下文占用圆环（接管 DSH 原生 ContextMeter） ----------
// DSH 0.1.6-alpha.2 起，原生把「上下文占用」圆环从输入框工具行挪到了信息栏所在的 dock 行，
// 于是它与本插件注册进同一 dock 的信息栏成了同一行的两个兄弟节点（原生固定 12px 间隙，看起来是两块东西）。
// 用户拍板（2026-09-18）：圆环由本插件接管——外观、几何、文字与交互面板与原生完全一致，
// 但显隐（fields.contextUsage）与配色（colors.contextUsage）并入本插件的字段体系，
// 并渲染在本插件信息栏主行（即「简洁模式」可见的那一行）最右端；原生那一份由样式隐藏，
// 屏幕上有且只有一个圆环，且它不再是"另一块"，而是这一行的收尾。
// 几何与原生 ContextMeter 相同：14px viewBox、2px 描边、半径 5.5。
const CONTEXT_RADIUS = 5.5;
const CONTEXT_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RADIUS;
// 本地化占位标记：把「上下文已用 {percent}」这句按语序切开，让百分比单独着色（与原生同一手法，兼容中英语序）。
const CONTEXT_READING_SLOT = '\u0000';
// 面板位置参数与原生 useAnchoredPosition(side:'top', gap:8, margin:12) 一致。
const CONTEXT_PANEL_GAP = 8;
const CONTEXT_PANEL_MARGIN = 12;
// 与 CSS 中 .bi-ctx-panel 的 264px 是同一数值（定位退避算法用，两处改必须一起改）。
const CONTEXT_PANEL_WIDTH = 264;
// 构成明细三行（顺序即色块顺序；色值与原生 ContextMeter 完全相同）。
const CONTEXT_PANEL_ROWS = [
  { key: 'systemTokens', label: 'ui.contextSystem', tint: 'bi-ctx-seg-system' },
  { key: 'toolsTokens', label: 'ui.contextTools', tint: 'bi-ctx-seg-tools' },
  { key: 'messageTokens', label: 'ui.contextMessages', tint: 'bi-ctx-seg-messages' },
];
// 原生圆环的悬浮说明走 primitives 的 Tooltip（组件而非浏览器 title）；定义见文件顶部的 CONTEXT_TOOLTIP。

// 上下文占用（算法与 DSH 原生 contextOccupancy 完全一致）：分子优先取 projectedTokens，退回 pressureTokens；
// 分子或容量任一缺失就整块不渲染——与原生"两者齐备才显示"同一条规矩，绝不猜数字。
function contextOccupancy(pressure) {
  if (!pressure) return null;
  const usedTokens = pressure.projectedTokens != null ? pressure.projectedTokens : pressure.pressureTokens;
  const contextWindow = pressure.contextWindow;
  // 容量必须为正：原生对 0 会算出 Infinity / NaN（渲染成 100% 或 NaN%），这里按"没有容量"处理。
  if (usedTokens == null || contextWindow == null || !(contextWindow > 0)) return null;
  const percent = Math.min(100, Math.round((usedTokens / contextWindow) * 100));
  if (!isFinite(percent)) return null;
  return { percent: percent, usedTokens: usedTokens, contextWindow: contextWindow };
}

// 与原生的 formatTokens 同规则；K/M 缩写走 number.thousand / number.million，
// 字典里带了一份与宿主 common 命名空间同值的兜底（缺键时界面会直接显示键名）。
function contextTokenText(value) {
  const scaled = function (candidate) { return candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10); };
  if (value < 1e3) return String(value);
  if (value < 1e6) return t('number.thousand', { value: scaled(value / 1e3) });
  return t('number.million', { value: scaled(value / 1e6) });
}

// 圆环 + 可点开的构成明细面板。props：{ context: contextOccupancy 结果, breakdown: contextBreakdown 投影 }
function ContextMeterRing(props) {
  const context = props.context;
  const [open, setOpen] = React.useState(false);
  const [panelPosition, setPanelPosition] = React.useState(null);
  const rootRef = React.useRef(null);
  const panelRef = React.useRef(null);

  // 数据消失时收起面板（与原生同一处理）：面板内容依赖 context，留着会显示空白。
  React.useEffect(function () {
    if (!context && open) setOpen(false);
  }, [context, open]);

  // 打开时才量一次位置：超出视口就翻到下方，滚动/缩放时重算，避免面板飘离圆环。
  React.useEffect(function () {
    if (!open || !context) return undefined;
    if (typeof window === 'undefined') return undefined;
    const place = function () {
      const root = rootRef.current;
      if (!root || typeof root.getBoundingClientRect !== 'function') return;
      const rect = root.getBoundingClientRect();
      const panel = panelRef.current;
      const width = panel && panel.offsetWidth ? panel.offsetWidth : CONTEXT_PANEL_WIDTH;
      const height = panel && panel.offsetHeight ? panel.offsetHeight : 0;
      const maxLeft = Math.max(CONTEXT_PANEL_MARGIN, window.innerWidth - CONTEXT_PANEL_MARGIN - width);
      let left = rect.left + rect.width / 2 - width / 2;
      left = Math.min(Math.max(left, CONTEXT_PANEL_MARGIN), maxLeft);
      let top = rect.top - CONTEXT_PANEL_GAP - height;
      if (top < CONTEXT_PANEL_MARGIN) {
        top = Math.min(window.innerHeight - CONTEXT_PANEL_MARGIN - height, rect.bottom + CONTEXT_PANEL_GAP);
        if (top < CONTEXT_PANEL_MARGIN) top = CONTEXT_PANEL_MARGIN;
      }
      setPanelPosition({ left: left, top: top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return function () {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, context]);

  // Esc 关闭 + 点圆环与面板之外关闭（与原生 useDismissOnOutsidePointer 同一行为）
  React.useEffect(function () {
    if (!open) return undefined;
    if (typeof document === 'undefined') return undefined;
    const onKeyDown = function (event) { if (event.key === 'Escape') setOpen(false); };
    const onPointerDown = function (event) {
      const target = event && event.target;
      const root = rootRef.current;
      const panel = panelRef.current;
      if (root && target && root.contains(target)) return;
      if (panel && target && panel.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return function () {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  // 数据不足整块不渲染（与原生一致）。hooks 已全部就位，调用顺序稳定。
  if (!context) return null;

  const percent = context.percent;
  const reading = percent + '%';
  const ariaText = t('ui.contextAria', { percent: reading });
  const parts = t('ui.contextAria', { percent: CONTEXT_READING_SLOT }).split(CONTEXT_READING_SLOT);
  const headBefore = String(parts[0] || '').trim();
  const headAfter = String(parts[1] || '').trim();
  const breakdown = props.breakdown || null;
  const breakdownTotal = breakdown
    ? (breakdown.systemTokens || 0) + (breakdown.toolsTokens || 0) + (breakdown.messageTokens || 0)
    : 0;
  // 有构成数据就按三段着色，否则退化成整条（与原生同一降级）。
  const segments = (!breakdown || breakdownTotal <= 0
    ? [{ key: 'total', tint: 'bi-ctx-seg-total', width: percent }]
    : CONTEXT_PANEL_ROWS.map(function (row) {
      return { key: row.key, tint: row.tint, width: (percent * (breakdown[row.key] || 0)) / breakdownTotal };
    })).filter(function (segment) { return segment.width > 0; });

  const buttonProps = {
    type: 'button',
    className: 'bi-ctx-trigger',
    'aria-label': ariaText,
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    // 信息栏根节点自带 onClick（切换完整/简洁），不拦下冒泡会把界面顺带切走。
    onClick: function (event) { event.stopPropagation(); setOpen(!open); },
    onKeyDown: function (event) { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); },
  };
  if (CONTEXT_TOOLTIP === null) buttonProps.title = ariaText;
  const button = React.createElement('button', buttonProps,
    React.createElement('svg', { className: 'bi-ctx-ring', viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true },
      React.createElement('circle', { className: 'bi-ctx-track', cx: 7, cy: 7, r: CONTEXT_RADIUS }),
      React.createElement('circle', {
        className: 'bi-ctx-fill', cx: 7, cy: 7, r: CONTEXT_RADIUS,
        strokeDasharray: (CONTEXT_CIRCUMFERENCE * percent / 100) + ' ' + CONTEXT_CIRCUMFERENCE,
        transform: 'rotate(-90 7 7)',
      })),
    React.createElement('span', { className: 'bi-ctx-percent' }, reading));
  // Keep the native tooltip appearance and delay, but mount its bubble outside the dock.
  // Avoid hover-time descendant changes in the dock (Issue #218); the host-supported
  // body portal also escapes clipping ancestors.
  // Opening the statistics panel still disables the tooltip.
  const trigger = CONTEXT_TOOLTIP === null ? button
    : React.createElement(CONTEXT_TOOLTIP, { label: ariaText, side: 'top', delayMs: 200, disabled: open, portal: true }, button);

  const panel = open ? React.createElement('div', {
    ref: panelRef,
    className: 'bi-ctx-panel',
    style: panelPosition || { visibility: 'hidden', left: 0, top: 0 },
    role: 'dialog',
    'aria-label': t('ui.contextUsed'),
    onClick: function (event) { event.stopPropagation(); },
  },
    React.createElement('div', { className: 'bi-ctx-panel-header' },
      React.createElement('span', { className: 'bi-ctx-panel-headline' }, headBefore),
      React.createElement('span', { className: 'bi-ctx-panel-percent' }, reading),
      React.createElement('span', { className: 'bi-ctx-panel-headline' }, headAfter),
      React.createElement('span', { className: 'bi-ctx-panel-figures' },
        t('ui.contextFigures', { used: contextTokenText(context.usedTokens), window: contextTokenText(context.contextWindow) }))),
    React.createElement('div', { className: 'bi-ctx-panel-bar' },
      segments.map(function (segment) {
        return React.createElement('div', {
          key: segment.key, className: 'bi-ctx-segment ' + segment.tint, style: { width: segment.width + '%' },
        });
      })),
    breakdown && breakdownTotal > 0 ? React.createElement('dl', { className: 'bi-ctx-panel-rows' },
      CONTEXT_PANEL_ROWS.map(function (row) {
        return React.createElement('div', { key: row.key, className: 'bi-ctx-panel-row' },
          React.createElement('dt', null,
            React.createElement('span', { className: 'bi-ctx-swatch ' + row.tint, 'aria-hidden': true }),
            t(row.label)),
          React.createElement('dd', null, '~' + contextTokenText(breakdown[row.key] || 0)));
      })) : null) : null;

  // 面板挂到 body（原生同样 portal 到 body）；react-dom 不可用时降级为就地渲染，position:fixed 仍按量到的坐标摆。
  const portalTarget = typeof document !== 'undefined' && document.body ? document.body : null;
  const panelNode = panel === null ? null
    : (ReactDOM !== null && portalTarget ? ReactDOM.createPortal(panel, portalTarget) : panel);

  return React.createElement('span', {
    ref: rootRef,
    className: 'bi-ctx',
    'data-field': 'contextUsage',
    style: fieldStyle('contextUsage'),
  }, trigger, panelNode);
}

// ---------- 插件配置页 ----------
// 与信息栏共用同一 bundle 作用域；页面只负责呈现配置状态和提交用户操作。
const BIB_SET_EVENT = 'dsh-bib-config-changed';
const BIB_LEDGER_EVENT = 'dsh-bib-ledger-changed';
const BIB_SET_PRESET_LABELS = { red: "color.red", green: "color.green", blue: "color.blue", purple: "color.purple", orange: "color.orange", neutral: "color.neutral" };
// 原生取色器（input[type=color]）在未自定义时显示的代表色（浅色主题值；实际信息栏渲染仍按主题变量）
const BIB_SET_PRESET_WELL_HEX = { red: '#D92D20', green: '#087F5B', blue: '#0044CC', purple: '#6941C6', orange: '#B54708', neutral: '#333333' };
const BIB_SET_HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
// 字段分组由 constants.js 注入，保持宿主白名单、信息栏和设置页一致。
const FIELD_GROUP_ORDER = ['native', 'plugin', 'notice'];
const FIELD_GROUP_LABELS = {
  native: "group.native",
  plugin: "group.plugin",
  notice: "group.notice",
};
// 三组的分工说明（2026-09-25 用户拍板新增第三组「提醒信息」）：只在这里给「整组一句」，
// 不在每个字段上重复解释 —— 字段行的小字继续只讲「什么条件下会出现」。
// 这一句也是唯一说明「开关与显示模式的关系」的地方，不另设模式开关。
const FIELD_GROUP_DESC_KEYS = { native: 'group.native.desc', plugin: 'group.plugin.desc', notice: 'group.notice.desc' };
// 设置页小节（顺序 + 标题 + 一句话说明），构建时从 src/constants.js 注入。
// 只有「插件信息」这一组有 section；native / notice 两个组本来就只有一块，不设小节。
const FIELD_SECTIONS = [
  { id: 'identity', label: "section.identity.label", desc: "section.identity.desc" },
  { id: 'balance', label: "section.balance.label", desc: "section.balance.desc" },
  { id: 'subscription', label: "section.subscription.label", desc: "section.subscription.desc" },
  { id: 'billing', label: "section.billing.label", desc: "section.billing.desc" },
  { id: 'common', label: "section.common.label", desc: "section.common.desc" },
];
function bibSetDispatchChanged() {
  // 设置页保存成功后广播：信息栏监听并立即重拉配置（宿主内存缓存，即回）
  try { document.dispatchEvent(new CustomEvent(BIB_SET_EVENT)); } catch (err) { /* 事件总线不可用时静默：30s 周期校准兜底 */ }
}

function bibSetDispatchLedgerChanged() {
  // 清理账单后让正在显示的信息栏立即重拉会话花费，不必等 30 秒轮询。
  try { document.dispatchEvent(new CustomEvent(BIB_LEDGER_EVENT)); } catch (err) { /* 下一轮刷新会校准 */ }
}

function bibSetOperationMessage(err) {
  return String((err && err.message) || err || t('ui.pleaseTryAgainLater'));
}

// 「宿主还是旧版」的辨认（2026-09-26）：插件刚更新完、DSH 还没重启时，页面已经换上新版界面，
// 而进程里跑的仍是旧 host —— 新增的动作接口在它那里不存在，路由回 404 unknown method。
// 这个窗口真实存在（用户恰恰最爱在更新后立刻打开设置页），必须给一句人话而不是英文报错。
function bibSetMissingMethod(err) {
  return String((err && err.message) || err || '').indexOf('unknown method') >= 0;
}

// 设置页不需要显示滚动条轨道，但仍要保留滚轮、触控板和键盘滚动。
// 不改宿主的 overflow/尺寸，只给当前设置滚动祖先加一个生命周期内的标记，
// 因而不会再次触发宽度重排；插件卸载时恢复原属性。
function bibSetHideHostScrollbars(root) {
  if (!root || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return function () {};
  }
  const hosts = [];
  let parent = root.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    let computed = null;
    try { computed = window.getComputedStyle(parent); } catch (err) { computed = null; }
    const overflowY = computed && computed.overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') hosts.push(parent);
    parent = parent.parentElement;
  }
  if (hosts.length === 0) return function () {};

  const attr = 'data-dsh-bib-hide-scrollbars';
  const previous = hosts.map(function (host) {
    return { host: host, value: host.getAttribute(attr) };
  });
  hosts.forEach(function (entry) { entry.setAttribute(attr, 'true'); });

  return function () {
    previous.forEach(function (entry) {
      if (entry.value === null) entry.host.removeAttribute(attr);
      else entry.host.setAttribute(attr, entry.value);
    });
  };
}

// ---------- 更新动作的滚动位置保护（2026-09-26） ----------
// 更新是一次「替换插件自己的包文件」的动作，宿主有可能因为包变了而重建插件页 ——
// 用户看到的现象是「点完更新，插件的设置页直接滑到了屏幕最上端，没有停留在原地」（用户原报）。
// 插件拦不住宿主重建页面，但可以在动作前记住偏移、动作完成后察觉「它被重置为 0」再还原。
// 三条自我约束，防止变成抢用户的滚动条：
//   ① 只在动作那一刻偏移确实 > 0 时才记（用户本来就在顶部就什么都不用做）；
//   ② 只在 2 秒窗口内、且当前确实被重置为 0 时才还原（用户自己滑到顶部时目标值本来就是 0）；
//   ③ 节点已脱离文档（页面真被重建过）时不再猜，直接放弃 —— 猜错会把用户弹到莫名其妙的位置。
const BIB_SET_SCROLL_RESTORE_MS = 2000;
let bibSetScrollRestore = null;

// 与 bibSetHideHostScrollbars 同一套判定：设置页自身不滚动，真正的滚动层是宿主的某个祖先。
function bibSetScrollHost(node) {
  if (!node || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return null;
  let parent = node;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    let computed = null;
    try { computed = window.getComputedStyle(parent); } catch (err) { computed = null; }
    const overflowY = computed && computed.overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return parent;
    parent = parent.parentElement;
  }
  return null;
}

function bibSetRememberScroll(root) {
  bibSetScrollRestore = null;
  const host = bibSetScrollHost(root);
  if (!host || !(host.scrollTop > 0)) return;
  bibSetScrollRestore = { host: host, top: host.scrollTop, expiresAt: Date.now() + BIB_SET_SCROLL_RESTORE_MS };
}

function bibSetRestoreScroll() {
  const pending = bibSetScrollRestore;
  if (!pending) return;
  bibSetScrollRestore = null;
  if (Date.now() > pending.expiresAt) return;
  if (!pending.host.isConnected) return;
  if (pending.host.scrollTop !== 0) return;
  pending.host.scrollTop = pending.top;
}

// ---------- 插件配置页样式（融入 DSH 面板：卡片/行布局/控件全部走 --dsw-alias-* 令牌） ----------
function bibSetInstallStyles() {
  if (typeof document === 'undefined' || !document
    || typeof document.querySelector !== 'function'
    || typeof document.createElement !== 'function' || !document.head) return function () {};
  const id = 'dsh-bottom-info-bar-settings';
  const existing = document.querySelector('style[data-plugin-css="' + id + '"]');
  if (existing !== null) return function () {};
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-bottom-info-bar';
  style.dataset.pluginCss = id;
  style.textContent = `
      /* ============================================================================
         度量层（唯一的数值来源）
         ----------------------------------------------------------------------------
         本插件的配置区由宿主渲染进「插件详情页」的 .X_2TxG_detailSection 里，
         所以视觉基线**只有一套**：宿主自己的 dsh-client-ui-plugin-manager 的 X_2TxG_*。
         为避免数值散落在上百条规则里、以后又各改各的，这里把全部度量抽成变量；
         下面所有规则只准引用变量，不准再写裸数字。

         变量命名与取值来源（逐条实测 2026-09-22 / DSH 0.1.7-alpha.1，见 docs/DSH-PLUGIN-PAGE-BASELINE.md）：
           --bib-sec-gap        .X_2TxG_detailSections { gap: 32px }
           --bib-sec-inner      .X_2TxG_detailSection  { gap: 12px }
           --bib-head-gap       .X_2TxG_sectionHead    { align-items: baseline; gap: 10px }
           --bib-title-size/weight/line  .X_2TxG_sectionTitle { 14 / 500 / 20 }
           --bib-desc-*         .X_2TxG_cardDesc       { 13 / 400 / 18, label-tertiary }
           --bib-row-pad        .X_2TxG_row            { padding: 12px 2px }
           --bib-row-rule       .X_2TxG_row            { border-bottom: .5px, last-child 无线 }
           --bib-row-gap        .X_2TxG_rowLine        { gap: 16px }
           --bib-row-label-*    .X_2TxG_rowId          { 13.5 / 500 / 20 }
           --bib-row-hint-*     .X_2TxG_rowModule      { 11.5 / 400 / 16, label-tertiary }
           --bib-btn-h/radius/pad/font  primitives Button.module.css .sm { 28 / 14 / 0 10 / 12 18 }
           --bib-input-h/radius/pad/font  primitives settings-form fields.module.css .input { 34 / 8 / 0 12 / 13 }

         【横向对齐铁律】宿主给我们的容器 .X_2TxG_detailSection 实测 padding:0、左沿 323.2，
         宿主自己的区块标题文字左沿也是 323.2。所以我们的内容块一律 padding 左右为 0，
         横向内缩只能来自行自己的 --bib-row-pad；任何内容块自带左右内边距都会整体错位。

         【宽度铁律】宿主的 .X_2TxG_page > * 已经把宽度钉在 min(100%, 960px)。插件根节点
         **不得再设 px 级 max-width**（曾经写 max-width:760px，在 ≥816px 的视口里把内容
         整体压窄 200px，右侧控件够不到宿主右边界——这就是「被裁掉/对不齐」的真凶）。
         只允许 max-inline-size: 100%。 */
      .bib-set-root {
        --bib-set-brand: #4d6bfe; /* 固定品牌蓝（focus 轮廓 / 链接等），不跟随 --dsw-alias-brand-primary 在深色主题下变浅 */
        /* 填充式选中态专用深档：同一品牌蓝族。#4d6bfe × #fff 实测仅 4.33:1（历史提交 #38 写的「4.6:1」是算错的），
           达不到 AGENTS.md 对比度铁律的 4.5:1 主句；#4a63e8 × #fff = 4.95:1，肉眼与 #4d6bfe 几乎无差。 */
        --bib-set-brand-strong: #4a63e8;
        /* 配置区只是详情页里的**一个** section：区块间距取宿主 .X_2TxG_detailSection 的 12px，
           不取 .X_2TxG_detailSections 的 32px（那是区块之间的间距，套进来会凭空多出大段空白）。
           同一区块中的独立操作组 16px；卡片内部 16px；相邻行 0px。 */
        --bib-sec-gap: 12px;
        --bib-sec-inner: 16px;
        --bib-group-gap: 16px;
        --bib-head-gap: 10px;
        --bib-title-size: 14px; --bib-title-weight: 500; --bib-title-line: 20px;
        --bib-page-title-size: 15px; --bib-page-title-weight: 600; --bib-page-title-line: 22px;
        --bib-sub-label-size: 12px; --bib-sub-label-weight: 600; --bib-sub-label-line: 18px;
        --bib-panel-pad: 12px;
        --bib-desc-size: 13px; --bib-desc-line: 18px;
        --bib-row-pad-block: 12px; --bib-row-pad-inline: 2px;
        --bib-row-gap: 16px;
        --bib-row-label-size: 13.5px; --bib-row-label-weight: 500; --bib-row-label-line: 20px;
        --bib-row-hint-size: 11.5px; --bib-row-hint-line: 16px;
        --bib-control-radius: 8px;
        --bib-btn-height: 28px; --bib-btn-radius: var(--bib-control-radius); --bib-btn-pad-inline: 10px; --bib-btn-size: 12px; --bib-btn-line: 18px;
        --bib-input-height: 34px; --bib-input-radius: var(--bib-control-radius); --bib-input-pad-inline: 12px; --bib-input-size: 13px;
        --bib-rule: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.16));
        --bib-swatch-size: 20px; --bib-swatch-radius: var(--bib-control-radius);
        --bib-menu-dot-size: 12px;
        --bib-field-gap: 6px; --bib-field-pad-block: 12px;
        --bib-field-label-size: 13px; --bib-field-label-weight: 500; --bib-field-label-line: 1.5;
        --bib-field-hint-size: 12px; --bib-field-hint-line: 1.5;
        box-sizing: border-box; max-inline-size: 100%; min-inline-size: 0;
      }
      .bib-settings, .bib-settings * { box-sizing: border-box; }
      /* 页头（标题 + 说明）：标题与本页其它区块同级（原生 sectionTitle），不另起一套字号。
         宿主已经在页面上方渲染了插件名（20/500）与简介，这里只是本配置块的区块头。 */
      .bib-set-page-head { display: flex; flex-direction: column; gap: 2px; width: 100%; min-width: 0; padding: 0; }
      .bib-set-page-title { width: 100%; margin: 0; font-size: var(--bib-page-title-size); font-weight: var(--bib-page-title-weight); line-height: var(--bib-page-title-line); color: var(--dsw-alias-label-primary); }
      /* 只保留 DSH 设置面板这一层纵向滚动：根节点比宿主视口多 2px，确保收起时也会
         进入同一个滚动状态；插件自身和字段清单不再创建第二、第三条滚动轨道。
         注意：这里**不能**设 px 级 max-width（见上面「宽度铁律」）。 */
      .bib-settings { display: flex; flex: 0 0 auto; align-self: stretch; width: 100%; inline-size: 100%; max-inline-size: 100%; min-width: 0; min-inline-size: 0; min-height: calc(100% + 2px); min-block-size: calc(100% + 2px); overflow: visible; contain: inline-size; flex-direction: column; gap: var(--bib-sec-gap); color: var(--dsw-alias-label-primary); }
      /* 仅隐藏视觉轨道，不关闭滚动能力；宿主标记由组件生命周期维护。 */
      .bib-settings, .bib-set-field-list, [data-dsh-bib-hide-scrollbars="true"] { scrollbar-width: none; -ms-overflow-style: none; }
      .bib-settings::-webkit-scrollbar, .bib-set-field-list::-webkit-scrollbar, [data-dsh-bib-hide-scrollbars="true"]::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      /* 区块说明：原生 pageIntro 的 13/20 二级色（宿主 .X_2TxG_pageIntro）。 */
      /* 搜索行：左侧输入框吃满剩余宽度，右侧计数用 auto 轨道。
         计数框原来是写死的 104px + nowrap，文案一变长就会被切——改成 auto 轨道，永不裁切。 */
      .bib-set-toolbar { width: 100%; max-width: 100%; min-width: 0; min-inline-size: 0; box-sizing: border-box; padding: 0; }
      .bib-set-search-row { display: block; width: 100%; min-width: 0; min-height: 34px; }
      .bib-set-search-shell { position: relative; width: 100%; min-width: 0; }
      .bib-set-search { box-sizing: border-box; display: block; width: 100%; height: var(--bib-input-height); min-height: var(--bib-input-height); padding: 0 30px 0 var(--bib-input-pad-inline); border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--bib-input-radius); background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); font: inherit; font-size: var(--bib-input-size); line-height: 1.5; }
      .bib-set-search::placeholder { color: var(--dsw-alias-label-tertiary); }
      .bib-set-search:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 1px; }
      .bib-set-count { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
      /* ===== 区块：完全照宿主插件详情页（dsh-client-ui-plugin-manager 的 X_2TxG_*）=====
         .X_2TxG_detailSections { flex-direction:column; gap:32px }   → .bib-settings 的 32px
         .X_2TxG_detailSection  { flex-direction:column; gap:12px }   → .bib-set-card
         .X_2TxG_sectionHead    { align-items:baseline; gap:10px; padding:0 } → .bib-set-card-header
         .X_2TxG_sectionTitle   { 14/500/20 }                         → .bib-set-card-title
         .X_2TxG_sectionCount   { 12/18 二级色 }                       → .bib-set-card-desc / .bib-set-count
         .X_2TxG_rows           { flex-direction:column; gap:0; padding:0 }    → .bib-set-field-list
         .X_2TxG_row            { padding:12px 2px; border-bottom:.5px solid border-l2 } → .bib-set-row
         .X_2TxG_row:last-child { border-bottom:0 }
         .X_2TxG_rowLine        { align-items:center; gap:16px }        → .bib-set-row-main 的列间距
         .X_2TxG_rowId          { 13.5/500/20 }                        → .bib-set-rowTitle
         ===== 实测数字（2026-09-22，宿主 0.1.7-alpha.1）=====
         .X_2TxG_row{padding:12px 2px; border-bottom:.5px solid var(--dsw-alias-border-l2)}
         .X_2TxG_row:last-child{border-bottom:0}
         .X_2TxG_rowLine{align-items:center; gap:16px; min-width:0}
         .X_2TxG_rowMain{flex-direction:column; flex:1; gap:2px; min-width:0}
         .X_2TxG_rowId{font-size:13.5px; font-weight:500; line-height:20px}
         注意：行**没有** margin:0 -8px，也**没有**圆角和 hover 填充——那是插件列表的
         .X_2TxG_card 那一套，不是详情页的行。 */
      .bib-set-card { box-sizing: border-box; display: flex; flex-direction: column; gap: var(--bib-sec-inner); flex: 0 0 auto; width: 100%; inline-size: 100%; max-width: 100%; max-inline-size: 100%; min-width: 0; min-inline-size: 0; overflow: visible; border: 0; background: transparent; border-radius: 0; }
      .bib-set-card-header { appearance: none; box-sizing: border-box; display: flex; flex-direction: column; gap: 0; width: 100%; margin: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; }
      .bib-set-card-header:not(.bib-set-card-header--static) { cursor: pointer; user-select: none; -webkit-user-select: none; }
      .bib-set-card-header:not(.bib-set-card-header--static):hover { background: transparent; }
      .bib-set-card-header:not(.bib-set-card-header--static):focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 2px; }
      .bib-set-card-header--static { cursor: default; }
      /* 标题与折叠箭头同一基线、间距 10px（照原生 sectionHead 的 align-items:baseline + gap:10px）。 */
      .bib-set-card-header-main { display: flex; align-items: baseline; justify-content: flex-start; gap: var(--bib-head-gap); width: 100%; min-width: 0; }
      /* 实测基线（宿主插件详情页）：区块标题 14/500/20；行标题 13.5/500/20（原生 .rowId）；
         区块说明 13/20 二级色（原生 pageIntro）；行说明 12/18 三级色（原生 .detailName）。 */
      .bib-set-card-title { min-width: 0; margin: 0; font-size: var(--bib-title-size); font-weight: var(--bib-title-weight); line-height: var(--bib-title-line); color: var(--dsw-alias-label-primary); }
      .bib-set-card-desc { width: 100%; min-width: 0; margin: 0; font-size: var(--bib-desc-size); line-height: var(--bib-desc-line); color: var(--dsw-alias-label-secondary); }
      /* 字段清单以 grid-template-rows 0fr→1fr 展开：高度本身参与过渡，不再用
         max-height 巨值把内容瞬间撑开、再让淡入/位移拖满 220ms（观感拖沓的来源）。
         仍然保持挂载（不用 display:none），避免宿主 WebView 重新计算固有宽度。 */
      .bib-set-collapse { display: grid; grid-template-rows: 0fr; width: 100%; inline-size: 100%; max-width: 100%; max-inline-size: 100%; min-width: 0; min-inline-size: 0; overflow: hidden; opacity: 0; visibility: hidden; contain: layout paint; transition: grid-template-rows 150ms cubic-bezier(0.4, 0, 0.2, 1), opacity 120ms ease, visibility 0s linear 150ms; }
      .bib-set-collapse--expanded { grid-template-rows: 1fr; opacity: 1; visibility: visible; transition: grid-template-rows 150ms cubic-bezier(0.4, 0, 0.2, 1), opacity 120ms ease 30ms, visibility 0s linear 0s; }
      .bib-set-collapse-inner { width: 100%; inline-size: 100%; max-width: 100%; max-inline-size: 100%; min-width: 0; min-inline-size: 0; min-height: 0; overflow: visible; }
      /* 字段清单跟随唯一的宿主滚动层，避免覆盖式滚动条彼此重叠。
         形态照原生 .X_2TxG_rows：纵向 flex、gap 0（行的分隔靠 .5px 下边线，不靠间距）。 */
      .bib-set-field-list { display: flex; flex-direction: column; gap: 0; width: 100%; inline-size: 100%; max-width: 100%; max-inline-size: 100%; min-width: 0; min-inline-size: 0; max-height: none; overflow: visible; }
      .bib-set-body { width: 100%; inline-size: 100%; max-width: 100%; max-inline-size: 100%; min-width: 0; min-inline-size: 0; box-sizing: border-box; margin: 0; padding: 0; background: transparent; }
      .bib-set-empty { margin: 0; padding: 16px 0; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
      /* ===== 内容分组 =====
         这是“可进入的设置分组”，不是一行注释。采用受 macOS 设置启发的分组表单：
         一整块可点击的表面、标题/状态/动作文字三层信息，以及稳定可见的“展开/收起”。
         这样用户不会把一个小箭头旁的文字误认为说明文案。 */
      /* 两个可展开分组是并列的独立入口，留出 16px 呼吸空间，不能像同一列表行挤在一起。 */
      .bib-set-field-list { gap: var(--bib-group-gap); }
      /* 面板表面（唯一的一套卡片外观）：可折叠分组与静态设置区共用。边框 / 圆角 / 底色只在这里写一遍，
         展开态的底色变化是分组独有的行为状态，留在分组自己的规则里。 */
      .bib-set-group, .bib-set-card--panel { border: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.16)); border-radius: var(--bib-control-radius); background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.06)); }
      .bib-set-group { display: flex; flex-direction: column; gap: 0; width: 100%; inline-size: 100%; max-width: 100%; max-inline-size: 100%; min-width: 0; min-inline-size: 0; overflow: hidden; }
      .bib-set-card--panel { padding: var(--bib-panel-pad); }
      .bib-set-group--expanded { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.03)); }
      .bib-set-group-head { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .bib-set-group-label { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--bib-title-size); font-weight: var(--bib-title-weight); line-height: var(--bib-title-line); color: var(--dsw-alias-label-primary); }
      /* 分组说明（三组区分 + 模式归属）走次要色 12/1.5，与字段行小字同一套排版基线。 */
      .bib-set-group-desc { display: block; min-width: 0; font-size: var(--bib-field-hint-size); font-weight: 400; line-height: var(--bib-field-hint-line); color: var(--dsw-alias-label-tertiary); }
      /* 设置页小节：只做阅读分组，让「余额制 / 订阅制 / 账单制 / 通用」一眼分得开。
         四级层级（字号/色阶逐级收敛，行式各不相同，第一眼即分得开）：
           页标题 15/600 主色独占一行 → 分组/卡片标题 14/500 主色（可折叠的带动作）
           → 小节眉 12/600 次色单行眉题 → 字段行 13.5/500 主色 + 说明另起一行。
         小节眉故意做成单行眉题（标题与说明同行、说明超长省略），与上下两级的双行堆叠
         形成对比；节与节之间一条细线。 */
      .bib-set-subsection { display: flex; flex-direction: column; gap: 0; min-width: 0; }
      .bib-set-subsection + .bib-set-subsection { border-top: var(--bib-rule); }
      .bib-set-subsection-head { display: flex; flex-direction: row; align-items: baseline; gap: 8px; min-width: 0; padding: 14px 0 2px; }
      .bib-set-subsection-label { flex: none; min-width: 0; font-size: var(--bib-sub-label-size); font-weight: var(--bib-sub-label-weight); line-height: var(--bib-sub-label-line); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
      .bib-set-subsection-desc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--bib-sub-label-size); font-weight: 400; line-height: var(--bib-sub-label-line); color: var(--dsw-alias-label-tertiary); }
      .bib-set-group-fallback-head { appearance: none; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; min-width: 0; min-height: 48px; box-sizing: border-box; margin: 0; padding: 8px 12px; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background-color 120ms ease; }
      .bib-set-group-fallback-head:hover { background: var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,0.08)); }
      .bib-set-group-fallback-head:focus-visible { position: relative; z-index: 1; outline: 2px solid var(--bib-set-brand); outline-offset: -2px; }
      .bib-set-group--expanded .bib-set-group-fallback-head { border-bottom: var(--bib-rule); }
      .bib-set-group-action { display: inline-flex; align-items: center; gap: 4px; flex: none; color: var(--bib-set-brand); font-size: 13px; font-weight: 500; line-height: 20px; white-space: nowrap; }
      .bib-set-group-action .bib-set-chevron { color: currentColor; }
      .bib-set-group .bib-set-body { padding: 0 12px 2px; }
      /* 行 = 原生详情页的 .X_2TxG_row：padding 12px 2px、下边线 .5px、最后一行无线、
         无圆角、无 hover 填充、无负外边距。
         之前照插件列表的 .X_2TxG_card 写成「margin 0 -8px + padding 8px + r12」，又被
         overflow:hidden 的折叠容器裁掉右侧控件；后来改成「行不越界 + 内容左右各内缩 8px」，
         虽然不裁了，却把整行文字推离了宿主的 323.2 左边界。现在按详情页行的真实值来，
         既对齐又不越界。 */
      .bib-set-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--bib-row-gap); width: 100%; min-width: 0; box-sizing: border-box; margin: 0; padding: var(--bib-row-pad-block) var(--bib-row-pad-inline); border: 0; border-bottom: var(--bib-rule); border-radius: 0; }
      /* 列表首行去上内边距、末行去下内边距与边线（同姊妹插件 .cgpt-row:first-child/:last-child）：
         列表与所属区块齐平，不再在顶部/底部留一段看不见的空白。 */
      .bib-set-collapse-inner > .bib-set-row:first-child { padding-top: 0; }
      .bib-set-collapse-inner > .bib-set-row:last-child { padding-bottom: 0; }
      .bib-set-row:last-child { border-bottom: 0; }
      .bib-set-row--field { flex-direction: column; align-items: stretch; gap: 0; }
      /* 字段行 = 单行网格：「标签」col1、「开关」col2、「色块」col3。不再有第二行
         （决策 1：调色板收进色块弹层；决策 3：时区/格式/自定义文字拆去独立设置区）。
         fallback（宿主无 Menu）时控件块仍按 grid-column: 1 / -1 落第二行，见 .bib-set-controls--field。 */
      .bib-set-row-main { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; column-gap: var(--bib-row-gap); row-gap: 8px; align-items: start; width: 100%; min-width: 0; }
      .bib-set-language { max-width: 100%; min-width: 0; font: inherit; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-background-primary, transparent); border: 1px solid var(--dsw-alias-border-l3); border-radius: 6px; padding: 5px 8px; }
      .bib-set-rowText { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .bib-set-rowText--field { min-width: 0; }
      /* 行标题照原生 .X_2TxG_rowId：13.5/500/20。 */
      .bib-set-rowTitle { display: flex; align-items: center; gap: 6px; font-size: var(--bib-row-label-size); font-weight: var(--bib-row-label-weight); line-height: var(--bib-row-label-line); color: var(--dsw-alias-label-primary); }
      .bib-set-rowDesc { font-size: var(--bib-row-hint-size); line-height: var(--bib-row-hint-line); color: var(--dsw-alias-label-tertiary); }
      /* ===== 原生组件衔接 ===== */
      /* 开关：宿主原生 Switch 自带 track/thumb 几何，插件只允许给它布局类声明。
         宿主开关规则（._switch_*）与 .bib-set-switch-host 特异性同为 (0,1,0)，而插件 <style>
         后插入 → 任何外观声明都会反过来压过宿主：OFF 态轨道 background 被清成透明（整列开关
         看不见，实测对比度 light 1.00:1 / dark 1.02:1）、轨道 padding 被清零（滑块 18/2 →
         16/4，2px 错位）。故原生分支只挂 .bib-set-switch-host；本规则体内禁止出现
         appearance/background/border/padding/margin/transform/opacity/width/height/
         border-radius 等任何外观或尺寸声明。 */
      .bib-set-switch-host { flex: none; }
      /* 原生 Switch 的行内定位：它目前靠 CSS 网格自动放置「恰好」落在 (1,2)，但这是顺序依赖的隐式
         定位——同容器里 .bib-set-controls--field 带 grid-column: 1 / -1，一旦有人把 controls 挪到
         switch 之前，自动放置游标就会把开关挤到第二行。本规则只做定位、不含任何外观或尺寸声明
         （外观一律交还宿主，见上），把开关的行内位置显式钉死，不再取决于兄弟节点的书写顺序。
         旧版写死的正是 grid-column: 2; grid-row: 1; align-self: start;，本次按新类名恢复回来。 */
      .bib-set-row-main > .bib-set-switch-host { grid-column: 2; grid-row: 1; align-self: start; }
      /* 色块（决策 1）的行内定位：与开关同一套显式钉死思路，落在 col3。
         两个选择器成对写是因为原生 Menu 传了 portal:true——弹层去 body，但锚点根节点
         到底以 .bib-set-color-host 还是 .bib-set-swatch 出现在行内，取决于宿主 Menu
         是否再包一层；两个都钉死，哪个是网格直接子级就用哪个，不赌实现细节。
         本规则体同样只做定位、不含任何外观或尺寸声明——色块本体（.bib-set-swatch）
         是插件自绘控件，外观声明写在自己的规则里，不经过宿主原生组件。 */
      .bib-set-row-main > .bib-set-color-host, .bib-set-row-main > .bib-set-swatch { grid-column: 3; grid-row: 1; align-self: start; }
      /* 时区下拉：锚点是原生 Button，展开的是原生 Menu 卡片（替代系统自带的 <select>）。 */
      .bib-set-select { display: inline-flex; flex: none; min-width: 0; }
      .bib-set-select-trigger { justify-content: space-between; gap: 6px; min-width: 160px; max-width: 100%; }
      .bib-set-select-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .bib-set-select-chevron { flex: none; color: var(--dsw-alias-label-tertiary); }
      .bib-set-select-trigger--open .bib-set-select-chevron { color: var(--dsw-alias-label-primary); }
      /* ===== 提示条：照宿主插件详情页的三种原生形态 ===== */
      /* 错误：.X_2TxG_failure（错误色 + 行内 + gap 10）+ .X_2TxG_reason（12/18、可任意换行） */
      .bib-set-alerts { display: flex; flex-direction: column; gap: 12px; width: 100%; min-width: 0; padding: 0; }
      .bib-set-alert { width: 100%; min-width: 0; box-sizing: border-box; margin: 0; font-size: 12px; line-height: 18px; }
      /* 错误：完全照原生 .X_2TxG_failure（行内 flex + 错误色 + gap 10）+ .X_2TxG_reason（12/18 可换行）。
         左边界与区块标题一致（都是容器左边缘），不再有自己的内缩。 */
      .bib-set-alert--error { display: flex; align-items: center; gap: 10px; color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error, #d92d20)); overflow-wrap: anywhere; white-space: pre-wrap; }
      /* 警示：.X_2TxG_banner（12% 警示色底、r10、8px 12px 内边距） */
      .bib-set-alert--warning { background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #f59e0b) 12%, transparent); color: var(--dsw-alias-label-primary); border-radius: var(--bib-control-radius); padding: 8px 12px; }
      /* 信息/加载中：安静的一行（原生 sectionCount 的字号与色阶） */
      .bib-set-alert--info { color: var(--dsw-alias-label-secondary); }
      /* 只使用 DSH 已验证的原生下箭头；展开态旋转 SVG 本身，确保跨宿主版本仍是上下方向。 */
      .bib-set-chevron { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; width: 14px; height: 14px; margin: 0; flex: none; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
      .bib-set-card-header:not(.bib-set-card-header--static):hover .bib-set-chevron, .bib-set-card-header:not(.bib-set-card-header--static):focus-visible .bib-set-chevron { color: var(--dsw-alias-label-primary); }
      .bib-set-chevron-icon { display: block; width: 14px; height: 14px; transform-box: fill-box; transform-origin: center; backface-visibility: hidden; will-change: transform; transition: transform 160ms cubic-bezier(0.32, 0.72, 0, 1), color 120ms ease; }
      .bib-set-chevron-icon--expanded { transform: rotate(180deg); }
      /* 兜底箭头：宿主 primitives 两边都取不到图标时使用（见 BIB_SET_CHEVRON_ICON）。
         尺寸/描边对齐 14px 图标观感，方向由父级 data-expanded 驱动，不依赖任何宿主类名。 */
      .bib-set-chevron-glyph { display: block; width: 6px; height: 6px; margin-top: -3px; border-right: 1.6px solid currentColor; border-bottom: 1.6px solid currentColor; transform: rotate(45deg); backface-visibility: hidden; transition: transform 160ms cubic-bezier(0.32, 0.72, 0, 1), color 120ms ease; }
      .bib-set-chevron[data-expanded="true"] .bib-set-chevron-glyph { transform: rotate(225deg); }
      /* 开关：本规则只服务插件自己的兜底 <button>（宿主 primitives 取不到原生 Switch 时才走这条路径）。
         原生分支不得使用 .bib-set-switch 这个类名——它带外观声明，会以「同特异性 + 后插入」压过宿主，
         详见上方「原生组件衔接」处的说明。兜底几何对齐宿主原生 Switch
         （36×20 轨道 + 16px 圆钮 + 10px 圆角），语义 = role:switch + aria-checked */
      .bib-set-switch { appearance: none; background: 0 0; border: 0; padding: 0; margin: 0; cursor: pointer; display: inline-flex; flex: none; border-radius: 10px; }
      .bib-set-switch:disabled { cursor: default; opacity: 0.5; }
      .bib-set-switch:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 2px; }
      .bib-set-switch-track { position: relative; display: inline-block; box-sizing: border-box; width: 36px; height: 20px; border-radius: 10px; background: var(--dsw-alias-border-l3, rgba(128,128,128,0.4)); transition: background-color 120ms ease; }
      .bib-set-switch-track[data-on="true"] { background: var(--dsw-alias-brand-primary, var(--bib-set-brand)); }
      .bib-set-switch-thumb { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-label-primary-foreground, #fff); box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: transform 120ms ease; }
      .bib-set-switch-track[data-on="true"] .bib-set-switch-thumb { transform: translateX(16px); }
      /* 色板圆点：role:radio + roving tabindex（方向键/Home/End 可达），选中态外圈描边 */
      .bib-set-row-main > .bib-set-switch { grid-column: 2; grid-row: 1; align-self: start; }
      .bib-set-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
      .bib-set-controls--field { grid-column: 1 / -1; justify-content: flex-start; }
      /* ===== 独立参数设置区（决策 3）=====
         「时间与日期」「自定义文字」两个字段块照宿主 settings-form fields.module.css 基线：
         .field 列向 + gap 6 + padding 12px 0；相邻字段块之间 .5px 细线；label 13/500；
         输入框 34px / r8 / 0 12px；hint 12/1.5。全部度量走 --bib-* token。 */
      .bib-set-fieldblocks { display: flex; flex-direction: column; gap: 0; width: 100%; inline-size: 100%; max-width: 100%; max-inline-size: 100%; min-width: 0; min-inline-size: 0; box-sizing: border-box; }
      .bib-set-fieldblock { display: flex; flex-direction: column; gap: var(--bib-field-gap); min-width: 0; box-sizing: border-box; padding: var(--bib-field-pad-block) 0; }
      .bib-set-fieldblocks > .bib-set-fieldblock:first-child { padding-top: 0; }
      .bib-set-fieldblocks > .bib-set-fieldblock:last-child { padding-bottom: 0; }
      .bib-set-fieldblock + .bib-set-fieldblock { border-top: var(--bib-rule); }
      .bib-set-fieldblock-label { flex: none; min-width: 0; font-size: var(--bib-field-label-size); font-weight: var(--bib-field-label-weight); line-height: var(--bib-field-label-line); color: var(--dsw-alias-label-primary); }
      .bib-set-fieldblock-hint { margin: 0; font-size: var(--bib-field-hint-size); line-height: var(--bib-field-hint-line); color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
      .bib-set-custom-text-input { box-sizing: border-box; width: 100%; height: var(--bib-input-height); padding: 0 var(--bib-input-pad-inline); border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--bib-input-radius); background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); font: inherit; font-size: var(--bib-input-size); line-height: 1.5; }
      .bib-set-custom-text-input:focus-visible, .bib-set-time-zone:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 1px; }
      .bib-set-time-zone { box-sizing: border-box; height: var(--bib-input-height); max-width: 100%; min-width: 0; padding: 0 var(--bib-input-pad-inline); border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--bib-input-radius); background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); font: inherit; font-size: var(--bib-input-size); line-height: 1.5; }
      .bib-set-dots { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
      /* 色板：预设色不再描边（描边 + 虚线圈是「手绘控件」的观感），选中用宿主主文字色的双环，
         hover 用一层浅环；「默认」用一个带斜杠的空圈，与原生「无/恢复默认」的语义一致。 */
      .bib-set-dot { appearance: none; width: 22px; height: 22px; padding: 0; margin: 0; border-radius: 50%; border: 0; background: transparent; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; transition: box-shadow 120ms var(--ds-ease-in-out, ease); }
      .bib-set-dot:hover { box-shadow: 0 0 0 2px var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,0.16)); }
      .bib-set-dot:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 2px; }
      .bib-set-dot[aria-checked="true"] { box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-2, #fff), 0 0 0 4px var(--dsw-alias-label-primary); }
      .bib-set-dot-core { display: block; width: 16px; height: 16px; border-radius: 50%; }
      /* 「默认」色点描边改用 label-tertiary：border-l3 在浅色主题只有 12% 黑，16px 小圆上对比度约 1.3:1 等于看不见；label-tertiary 与中间那道斜线同令牌，浅色约 3.9:1、深色约 5:1，达标且随主题自动翻转。
         决策 1 后行内色块的未设置态与「默认」色点同语义：选择器成对扩展到 .bib-set-swatch--default。 */
      .bib-set-dot-default .bib-set-dot-core, .bib-set-swatch--default .bib-set-swatch-core { background: var(--dsw-alias-bg-layer-2, transparent); box-shadow: inset 0 0 0 1px var(--dsw-alias-label-tertiary, rgba(128,128,128,0.5)); position: relative; overflow: hidden; }
      .bib-set-dot-default .bib-set-dot-core::after, .bib-set-swatch--default .bib-set-swatch-core::after { content: ''; position: absolute; left: -2px; top: 50%; width: 20px; height: 1px; background: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.5)); transform: rotate(-45deg); }
      /* ===== 行内色块（决策 1）===== 
         字段行右侧唯一颜色入口：20px 圆角色块显示当前色（预设走 --bi-palette-*，
         自定义 hex 直填）；未设置时显示与「默认」色点同语义的斜线态。
         点击打开原生 Menu 弹层（6 预设 + 自定义… + 恢复默认 + hex 输入）。 */
      .bib-set-color-host { display: inline-flex; flex: none; min-width: 0; }
      .bib-set-swatch { appearance: none; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: var(--bib-swatch-size); height: var(--bib-swatch-size); padding: 0; margin: 0; border: 0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.4)); border-radius: var(--bib-swatch-radius); background: var(--dsw-alias-bg-layer-3, transparent); cursor: pointer; transition: box-shadow 120ms ease; }
      .bib-set-swatch:hover { box-shadow: 0 0 0 2px var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,0.16)); }
      .bib-set-swatch:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 2px; }
      .bib-set-swatch-core { display: block; width: calc(var(--bib-swatch-size) - 6px); height: calc(var(--bib-swatch-size) - 6px); border-radius: calc(var(--bib-swatch-radius) - 2px); }
      /* 色块弹层内的预设色点（Menu item icon） */
      .bib-set-menu-dot { display: inline-block; flex: none; width: var(--bib-menu-dot-size); height: var(--bib-menu-dot-size); border-radius: 50%; }
      /* 弹层底部 hex 输入行 + 隐藏的系统取色器（「自定义…」菜单项触发 .click()） */
      .bib-set-color-menu-extra { display: flex; align-items: center; gap: 6px; min-width: 0; box-sizing: border-box; padding: 6px 8px; }
      .bib-set-color-native-input { position: absolute; width: 1px; height: 1px; padding: 0; margin: 0; border: 0; opacity: 0; pointer-events: none; }
      /* 原生取色器色井：保留系统行为，仅样式化为圆角色井 */
      .bib-set-well { display: inline-flex; flex: none; }
      .bib-set-well input[type="color"] { appearance: none; -webkit-appearance: none; box-sizing: border-box; width: 28px; height: 28px; padding: 3px; border: 0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.4)); border-radius: var(--bib-control-radius); background: var(--dsw-alias-bg-layer-3, transparent); cursor: pointer; }
      .bib-set-well input[type="color"]::-webkit-color-swatch-wrapper { padding: 2px; }
      .bib-set-well input[type="color"]::-webkit-color-swatch { border: none; border-radius: 5px; }
      .bib-set-well input[type="color"]::-moz-color-swatch { border: none; border-radius: 5px; }
      .bib-set-well input[type="color"]:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 2px; }
      /* hex 输入：等宽字体、即时校验（非法描红 + aria-invalid），Enter/失焦提交，非法回退 */
      .bib-set-hex { box-sizing: border-box; width: 96px; height: var(--bib-input-height); padding: 0 var(--bib-input-pad-inline); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: var(--bib-input-size); line-height: 1.5; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-3, transparent); border: 0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.4)); border-radius: var(--bib-input-radius); }
      .bib-set-hex:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 1px; }
      .bib-set-hex[data-invalid="true"] { border-color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error, #d92d20)); }
      /* 页脚操作行已被「恢复默认」行取代：它现在是「显示内容」区块里的最后一个
         .bib-set-data-row（同「导出账单」的行几何），不再悬浮在页面右下角。 */
      .bib-set-reset-row { border-top: var(--bib-rule); border-bottom: 0; }
      .bib-set-reset-row .bib-set-data-copy { display: flex; flex-direction: column; gap: 2px; }
      /* 按钮优先渲染宿主原生 Button（.sm = h28 / r14 / 12px / 0 10px）；
         下面这份只是宿主没有 Button 时的等价兜底。 */
      .bib-set-btn { appearance: none; font: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; height: var(--bib-btn-height); border: 0.5px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); background: transparent; border-radius: var(--bib-btn-radius); padding: 0 var(--bib-btn-pad-inline); font-size: var(--bib-btn-size); font-weight: 400; line-height: var(--bib-btn-line); transition: background-color 120ms ease, border-color 120ms ease; }
      .bib-set-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); border-color: var(--dsw-alias-border-l3); }
      .bib-set-btn:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 2px; }
      .bib-set-btn:disabled { opacity: 0.5; cursor: default; }
      .bib-set-notice { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; flex: 1 1 auto; min-width: 0; }
      .bib-set-data-actions { display: flex; flex-direction: column; gap: 2px; width: 100%; min-width: 0; box-sizing: border-box; margin: 0; padding: 0; }
      /* 账单数据行同样是原生 .X_2TxG_row 的几何（12px 2px + .5px 下边线，末行无线）。 */
      .bib-set-data-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--bib-row-gap); width: 100%; min-width: 0; padding: var(--bib-row-pad-block) var(--bib-row-pad-inline); border: 0; border-bottom: var(--bib-rule); border-radius: 0; }
      .bib-set-data-actions > .bib-set-data-row:first-child { padding-top: 0; }
      .bib-set-data-row:last-child { padding-bottom: 0; border-bottom: 0; }
      .bib-set-data-copy { min-width: 0; }
      .bib-set-data-title { margin: 0 0 2px; color: var(--dsw-alias-label-primary); font-size: var(--bib-row-label-size); font-weight: var(--bib-row-label-weight); line-height: var(--bib-row-label-line); }
      .bib-set-data-desc { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: var(--bib-row-hint-size); line-height: var(--bib-row-hint-line); }
      /* align-items: center 不能省（2026-09-25 用户报「按钮一个上一个下，不协调」）：
         这一组里放的是「有确定高度」的控件（两段式 33px / 按钮 28px），而 flex 默认 align-items: stretch
         对确定高度的子项退化为「按顶边对齐」——分组行本身的 align-items: center 只管到分组这一层，
         管不到分组内部的并排控件，于是两个盒子顶边齐平、整体高度差 2.5px，看上去就是错位。 */
      .bib-set-data-button-group { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
      .bib-set-btn--destructive { border-color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error, #d92d20)); color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error, #d92d20)); }
      .bib-set-btn--destructive:hover { background: rgba(217,45,32,0.08); border-color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error, #d92d20)); }
      @media (max-width: 600px) { .bib-settings { gap: 24px; } .bib-set-rowText { min-width: 0; flex-basis: 100%; } .bib-set-data-row { grid-template-columns: 1fr; gap: 10px; } .bib-set-data-button-group { justify-content: flex-start; } }
      /* ===== 订阅窗口百分比方向：两段式分段控件（v1.16）=====
         对比度铁律的**主句是可度量的阈值**（文字与背景 ≥ 4.5:1），品牌色只是当时的配方：
         实测 #4d6bfe × #fff = 4.33:1（历史提交 #38 写的「4.6:1」是算错的），达不到 4.5:1。
         因此填充式选中态改用同色相深档 --bib-set-brand-strong（#4a63e8 × #fff = 4.95:1）；
         --bib-set-brand（#4d6bfe）本身保持不变，focus 轮廓等仍在用。
         hover 仍保持该深档（绝不加 filter/brightness 提亮），浅深主题同一条规则、不跟随
         --dsw-alias-brand-primary 变浅。以上数值由 tests/test-quota-display-mode.js 用真实
         sRGB 相对亮度计算锁死——真实计算，不用字符串断言代替。 */
      .bib-set-quota-mode { display: inline-flex; align-items: center; gap: 2px; width: fit-content; max-width: 100%; min-width: 0; box-sizing: border-box; padding: 2px; border: 0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.4)); border-radius: var(--bib-control-radius); background: var(--dsw-alias-bg-layer-3, transparent); }
      .bib-set-quota-mode-opt { appearance: none; font: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; min-width: 72px; height: var(--bib-btn-height); padding: 0 var(--bib-input-pad-inline); border: 0; border-radius: calc(var(--bib-control-radius) - 2px); background: transparent; color: var(--dsw-alias-label-primary); font-size: var(--bib-input-size); line-height: var(--bib-btn-line); transition: background-color 120ms ease, color 120ms ease; }
      .bib-set-quota-mode-opt:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); }
      .bib-set-quota-mode-opt:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 1px; }
      .bib-set-quota-mode-opt[aria-checked="true"] { background: var(--bib-set-brand-strong); color: #fff; font-weight: 600; }
      .bib-set-quota-mode-opt[aria-checked="true"]:hover { background: var(--bib-set-brand-strong); color: #fff; }
      @media (forced-colors: active) { .bib-set-quota-mode-opt[aria-checked="true"] { forced-color-adjust: none; background: Highlight; color: HighlightText; } }
      @media (prefers-reduced-motion: reduce) { .bib-set-card-header, .bib-set-chevron-icon, .bib-set-chevron-glyph, .bib-set-collapse, .bib-set-btn, .bib-set-switch-track, .bib-set-switch-thumb, .bib-set-quota-mode-opt { transition: none; } .bib-set-collapse--collapsed { grid-template-rows: 0fr; visibility: hidden; } .bib-set-collapse--expanded { grid-template-rows: 1fr; visibility: visible; } }
    `;
  document.head.appendChild(style);
  return function () { style.remove(); };
}

// ---------- 控件 ----------
// 开关：优先用宿主原生 Switch（几何/配色/动效由宿主维护）；取不到时退回插件内实现，
// 两者语义一致（role=switch + aria-checked）。
function bibSetSwitch(props) {
  const checked = !!props.checked;
  if (BIB_SET_NATIVE_SWITCH) {
    return React.createElement(BIB_SET_NATIVE_SWITCH, {
      checked: checked,
      onChange: function (next) { if (props.onToggle) props.onToggle(next); },
      label: props.label,
      disabled: props.disabled === true,
      title: props.title,
      // 只挂布局类：绝不把插件的外观类名交给宿主原生 Switch（会反向覆盖宿主外观，见该规则处注释）
      className: 'bib-set-switch-host',
    });
  }
  return React.createElement('button', {
    type: 'button',
    className: 'bib-set-switch',
    role: 'switch',
    'aria-checked': checked,
    'aria-label': props.label,
    disabled: props.disabled === true,
    title: props.title,
    onClick: function () { if (props.onToggle) props.onToggle(!checked); },
  },
  React.createElement('span', { className: 'bib-set-switch-track', 'data-on': checked ? 'true' : 'false', 'aria-hidden': 'true' },
    React.createElement('span', { className: 'bib-set-switch-thumb' })));
}

// 按钮：优先用宿主原生 Button（size=sm 即 28px 胶囊，与插件详情页的原生按钮同一套几何）。
// variant: 'outline' 普通、'primary' 主操作、'ghost' 无边框；danger 走宿主错误色令牌。
function bibSetButton(props) {
  const variant = props.variant || (props.primary ? 'primary' : 'outline');
  const className = 'bib-set-btn'
    + (props.destructive ? ' bib-set-btn--destructive' : '')
    + (props.className ? ' ' + props.className : '');
  const children = props.children;
  if (BIB_SET_NATIVE_BUTTON) {
    return React.createElement(BIB_SET_NATIVE_BUTTON, {
      type: 'button',
      variant: variant,
      size: 'sm',
      className: className,
      disabled: props.disabled === true,
      title: props.title,
      onClick: props.onClick,
    }, children);
  }
  return React.createElement('button', {
    type: 'button',
    className: className,
    disabled: props.disabled === true,
    title: props.title,
    onClick: props.onClick,
  }, children);
}

// 提示条：照宿主插件详情页的三种原生形态做——
//   error   → .X_2TxG_failure（错误色、行内、gap 10）+ .X_2TxG_reason（12/18、可换行）
//   warning → .X_2TxG_banner（12% 警示色底、r10、8px 12px 内边距、12/18）
//   info    → 中性 12/18 次要色
// 原先是一段裸色文字贴在标题旁边，既没有形状也和页面其它部分对不齐。
function bibSetAlert(props) {
  const tone = props.tone || 'info';
  const className = 'bib-set-alert bib-set-alert--' + tone + (props.className ? ' ' + props.className : '');
  const role = tone === 'error' ? 'alert' : 'status';
  return React.createElement('div', { className: className, role: role }, props.children);
}

// 色板圆点组：默认 + 预设色名；role=radiogroup/radio + roving tabindex（方向键/Home/End）
function bibSetPalette(props) {
  const options = ['default'].concat(PRESET_COLORS);
  const refs = React.useRef({});
  const isSelected = function (option) {
    return option === 'default' ? props.value === null : props.value === option;
  };
  const select = function (option) {
    if (props.onSelect) props.onSelect(option === 'default' ? null : option);
  };
  const move = function (from, step) {
    const next = (from + step + options.length) % options.length;
    const node = refs.current[next];
    if (node && typeof node.focus === 'function') node.focus();
    select(options[next]);
  };
  const onKey = function (event, index) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(index, 1); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(index, -1); }
    else if (event.key === 'Home') { event.preventDefault(); move(index, -index); }
    else if (event.key === 'End') { event.preventDefault(); move(index, options.length - 1 - index); }
  };
  const children = options.map(function (option, index) {
    const selected = isSelected(option);
    const isDefault = option === 'default';
    const coreStyle = {};
    if (!isDefault) coreStyle.background = 'var(--bi-palette-' + option + ')';
    const ariaLabel = isDefault ? t('ui.restoreDefaultColor') : (t(BIB_SET_PRESET_LABELS[option]) || option);
    return React.createElement('button', {
      key: option,
      type: 'button',
      ref: function (node) { refs.current[index] = node; },
      className: 'bib-set-dot' + (isDefault ? ' bib-set-dot-default' : ''),
      role: 'radio',
      'aria-checked': selected,
      'aria-label': ariaLabel,
      title: ariaLabel,
      tabIndex: selected ? 0 : -1,
      onClick: function () { select(option); },
      onKeyDown: function (event) { onKey(event, index); },
    }, React.createElement('span', { className: 'bib-set-dot-core', style: coreStyle, 'aria-hidden': 'true' }));
  });
  return React.createElement('span', { className: 'bib-set-dots', role: 'radiogroup', 'aria-label': props.label }, children);
}

// 时区选择：原先用浏览器原生 <select>，那是操作系统自带的古老控件（灰色直角框 + 系统菜单），
// 与 DSH 的观感完全脱节。这里优先用宿主原生 Menu（锚点 = 原生 Button，列表 = 原生菜单卡片），
// 宿主没有 Menu 时才退回 <select>，保证老版本仍可用。
function bibSetTimeZonePicker(props) {
  const [open, setOpen] = React.useState(false);
  const value = props.value;
  if (!BIB_SET_NATIVE_MENU) {
    return React.createElement('select', {
      className: 'bib-set-time-zone',
      value: value,
      'aria-label': props.label,
      onChange: function (event) { props.onChange(event.target.value); },
    }, TIME_ZONE_OPTIONS.map(function (z) { return React.createElement('option', { key: z, value: z }, z); }));
  }
  const items = TIME_ZONE_OPTIONS.map(function (z) { return { id: z, label: z }; });
  const anchor = bibSetButton({
    variant: 'outline',
    className: 'bib-set-select-trigger' + (open ? ' bib-set-select-trigger--open' : ''),
    title: props.label,
    onClick: function () { setOpen(!open); },
    children: [
      React.createElement('span', { key: 'v', className: 'bib-set-select-value' }, value),
      BIB_SET_CHEVRON_ICON
        ? React.createElement(BIB_SET_CHEVRON_ICON, { key: 'c', size: 14, className: 'bib-set-select-chevron' })
        : React.createElement('span', { key: 'c', className: 'bib-set-chevron-glyph bib-set-select-chevron' }),
    ],
  });
  return React.createElement(BIB_SET_NATIVE_MENU, {
    open: open,
    anchor: anchor,
    items: items,
    selectedId: value,
    onSelect: function (id) { setOpen(false); props.onChange(id); },
    onClose: function () { setOpen(false); },
    align: 'start',
    portal: true,
    className: 'bib-set-select',
  });
}

// ---------- 页面组件 ----------
// M2 首渲骨架：页面标题行——任何状态下都先输出可见标题（数据未到、加载失败也一样有东西看）
function bibSetPageTitle() {
  return React.createElement('h1', { className: 'bib-set-page-title' }, t('ui.infoBarSettings'));
}

function bibSetChevron(props) {
  const iconClass = 'bib-set-chevron-icon' + (props.expanded ? ' bib-set-chevron-icon--expanded' : '');
  // 宿主图标缺失时退回同一位置上的 CSS 箭头（见 .bib-set-chevron-glyph）：
  // 宁可少一个图形，也不让 React 收到 undefined 类型的元素。
  const glyph = BIB_SET_CHEVRON_ICON
    ? React.createElement(BIB_SET_CHEVRON_ICON, { size: 14, className: iconClass })
    : React.createElement('span', { className: 'bib-set-chevron-glyph' });
  return React.createElement('span', {
    className: 'bib-set-chevron',
    'data-expanded': props.expanded ? 'true' : 'false',
    'aria-hidden': 'true',
  }, glyph);
}

function bibSetCardHeader(props) {
  const className = 'bib-set-card-header' + (props.static ? ' bib-set-card-header--static' : '');
  // 标题与折叠箭头同一行、左对齐（对齐原生 X_2TxG_sectionHead 的「标题 + 计数」排布）；
  // 箭头紧贴标题，不再甩到整行最右端留出几百像素空白。
  const title = React.createElement('span', {
    id: props.titleId,
    className: 'bib-set-card-title',
    role: 'heading',
    'aria-level': 2,
  }, props.title);
  const main = React.createElement('span', { className: 'bib-set-card-header-main' },
    title,
    props.static ? null : bibSetChevron({ expanded: props.expanded }));
  const description = React.createElement('span', { className: 'bib-set-card-desc' }, props.description);
  if (props.static) return React.createElement('div', { className: className }, main, description);
  return React.createElement('button', {
    type: 'button',
    className: className,
    'aria-expanded': props.expanded,
    'aria-controls': props.contentId,
    onClick: props.onToggle,
  }, main, description);
}

// 行内色块 + Menu 弹层（决策 1）：
// 字段行右侧唯一颜色入口。弹层项依次为 6 个预设色（带色点）、「自定义…」（触发系统
// <input type="color">）、「恢复默认」；弹层底部是 hex 输入框（Enter/失焦提交，非法回退）。
// 仅在宿主有原生 Menu 时走本组件；没有 Menu 时 bibSetFieldRow 退回旧的行内控件。
function bibSetColorPicker(props) {
  const [open, setOpen] = React.useState(false);
  const customInputRef = React.useRef(null);
  const value = props.value; // null = 默认 | 预设色名 | '#RRGGBB'
  const isDefault = value === null;
  const isPreset = !isDefault && PRESET_COLOR_SET.has(value);
  const swatchStyle = {};
  if (!isDefault) swatchStyle.background = isPreset ? 'var(--bi-palette-' + value + ')' : value;
  const swatch = React.createElement('button', {
    type: 'button',
    className: 'bib-set-swatch' + (isDefault ? ' bib-set-swatch--default' : ''),
    'aria-label': t('ui.colorSwatchLabel', { label: props.label }),
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    title: t('ui.colorSwatchLabel', { label: props.label }),
    onClick: function () { setOpen(!open); },
  }, React.createElement('span', { className: 'bib-set-swatch-core', style: swatchStyle, 'aria-hidden': 'true' }));
  const items = PRESET_COLORS.map(function (name) {
    return {
      id: name,
      label: t(BIB_SET_PRESET_LABELS[name]) || name,
      icon: React.createElement('span', {
        className: 'bib-set-menu-dot',
        style: { background: 'var(--bi-palette-' + name + ')' },
        'aria-hidden': 'true',
      }),
    };
  });
  items.push({ id: 'bib-set-color-sep', type: 'separator' });
  items.push({ id: 'custom', label: t('ui.customColorItem') });
  items.push({ id: 'default', label: t('ui.restoreDefaultColor') });
  const onSelect = function (id) {
    if (id === 'custom') {
      // 系统取色器由隐藏的 <input type="color"> 承担；.click() 处于用户点击链路内。
      const input = customInputRef.current;
      if (input && typeof input.click === 'function') input.click();
      return;
    }
    if (id === 'default') { setOpen(false); props.onColorChange(null); return; }
    if (PRESET_COLOR_SET.has(id)) { setOpen(false); props.onColorChange(id); }
  };
  // 弹层底部：hex 输入 + 隐藏的系统取色器。children 渲染在 Menu 视口内，
  // pointerdown/Escape 的关闭逻辑都把列表内部当作菜单自身，输入不会被误关。
  const menuExtra = React.createElement('div', { className: 'bib-set-color-menu-extra' },
    React.createElement('input', {
      ref: customInputRef,
      type: 'color',
      className: 'bib-set-color-native-input',
      'aria-label': t('ui.customColor', { label: props.label }),
      title: t('ui.customColorOpenColorPicker'),
      value: isPreset ? (BIB_SET_PRESET_WELL_HEX[value] || '#333333') : (isDefault ? '#333333' : value),
      onChange: function (event) {
        const picked = event && event.target ? event.target.value : null;
        if (picked && BIB_SET_HEX_PATTERN.test(picked)) props.onColorChange(picked.toUpperCase());
      },
    }),
    (function () {
      const draft = props.hexDraftOf(props.fieldId);
      const hexValue = draft !== null ? draft : props.committedHexText(props.fieldId);
      const hexInvalid = draft !== null && draft.trim().length > 0 && !BIB_SET_HEX_PATTERN.test(draft.trim());
      return React.createElement('input', {
        type: 'text',
        className: 'bib-set-hex',
        'aria-label': t('ui.hexColor', { label: props.label }),
        'aria-invalid': hexInvalid ? 'true' : 'false',
        'data-invalid': hexInvalid ? 'true' : 'false',
        placeholder: '#RRGGBB',
        spellCheck: false,
        maxLength: 7,
        value: hexValue,
        onChange: function (event) { props.onHexChange(props.fieldId, event && event.target ? event.target.value : ''); },
        onBlur: function () { props.onHexCommit(props.fieldId); },
        onKeyDown: function (event) { if (event.key === 'Enter') { event.preventDefault(); props.onHexCommit(props.fieldId); } },
      });
    })());
  return React.createElement(BIB_SET_NATIVE_MENU, {
    open: open,
    anchor: swatch,
    items: items,
    selectedId: isPreset ? value : undefined,
    onSelect: onSelect,
    onClose: function () { setOpen(false); },
    align: 'end',
    portal: true,
    className: 'bib-set-color-host',
  }, menuExtra);
}

function bibSetFieldRow(field, props) {
  const descParts = [];
  if (field.note) descParts.push(t(field.note));

  const value = props.colorOf(field.id);
  const isPreset = value !== null && PRESET_COLOR_SET.has(value);
  const isHex = value !== null && !isPreset;
  const draft = props.hexDraftOf(field.id);
  const hexValue = draft !== null ? draft : props.committedHexText(field.id);
  const hexInvalid = draft !== null && draft.trim().length > 0 && !BIB_SET_HEX_PATTERN.test(draft.trim());
  const wellValue = isHex ? value : (isPreset ? (BIB_SET_PRESET_WELL_HEX[value] || '#333333') : '#333333');
  const fieldLabel = t(field.label);

  // 决策 1：行内右侧 = 开关 + 一个色块。宿主没有原生 Menu 时才退回旧的行内控件组
  // （色板圆点 + 系统取色器色井 + hex 输入）——这是兜底路径，不是死代码。
  let colorControl;
  if (BIB_SET_NATIVE_MENU) {
    colorControl = React.createElement(bibSetColorPicker, {
      key: 'color-picker',
      fieldId: field.id,
      label: fieldLabel,
      value: value,
      onColorChange: function (next) { props.onColorChange(field.id, next); },
      hexDraftOf: props.hexDraftOf,
      committedHexText: props.committedHexText,
      onHexChange: props.onHexChange,
      onHexCommit: props.onHexCommit,
    });
  } else {
    colorControl = React.createElement('div', { className: 'bib-set-controls bib-set-controls--field' },
      React.createElement(bibSetPalette, {
        label: t('ui.presetColor', { label: fieldLabel }),
        value: value,
        onSelect: function (next) { props.onColorChange(field.id, next); },
      }),
      React.createElement('label', { className: 'bib-set-well' },
        React.createElement('input', {
          type: 'color',
          'aria-label': t('ui.customColor', { label: fieldLabel }),
          title: t('ui.customColorOpenColorPicker'),
          value: wellValue,
          onChange: function (event) {
            const picked = event && event.target ? event.target.value : null;
            if (picked && BIB_SET_HEX_PATTERN.test(picked)) props.onColorChange(field.id, picked.toUpperCase());
          },
        })),
      React.createElement('input', {
        type: 'text',
        className: 'bib-set-hex',
        'aria-label': t('ui.hexColor', { label: fieldLabel }),
        'aria-invalid': hexInvalid ? 'true' : 'false',
        'data-invalid': hexInvalid ? 'true' : 'false',
        placeholder: '#RRGGBB',
        spellCheck: false,
        maxLength: 7,
        value: hexValue,
        onChange: function (event) { props.onHexChange(field.id, event && event.target ? event.target.value : ''); },
        onBlur: function () { props.onHexCommit(field.id); },
        onKeyDown: function (event) { if (event.key === 'Enter') { event.preventDefault(); props.onHexCommit(field.id); } },
      }));
  }

  const rowMain = React.createElement('div', { className: 'bib-set-row-main' },
    React.createElement('div', { className: 'bib-set-rowText bib-set-rowText--field' },
      React.createElement('div', { className: 'bib-set-rowTitle' }, fieldLabel),
      React.createElement('div', { className: 'bib-set-rowDesc' }, descParts)),
    bibSetSwitch({
      label: t('ui.show', { label: fieldLabel }),
      checked: props.fieldOn(field.id),
      title: props.fieldOn(field.id) ? t('ui.clickToHide') : t('ui.clickToShow'),
      onToggle: function (next) { props.onFieldToggle(field.id, next); },
    }),
    colorControl);

  // 决策 3：带参数的字段（主/世界时间、自定义文字）已拆出为独立设置区，
  // 字段行从此单行，只承载「显隐开关 + 颜色」。
  return React.createElement('div', { key: field.id, className: 'bib-set-row bib-set-row--field' },
    rowMain);
}

// 分组折叠头：整块表面都是明确的操作入口，末端以“展开/收起”文字补足箭头的含义。
// 这比把 DisclosureRow 当作标题文字更接近 macOS 设置里的可进入分组，也保留原生 button 语义。
function bibSetDisclosure(props) {
  const open = props.open === true;
  const onToggle = function () { if (props.onToggle) props.onToggle(); };
  return React.createElement('section', { className: 'bib-set-group' + (open ? ' bib-set-group--expanded' : '') },
    React.createElement('button', {
      type: 'button',
      className: 'bib-set-group-fallback-head',
      'aria-expanded': open,
      'aria-controls': props.contentId,
      onClick: onToggle,
    },
      props.title,
      React.createElement('span', { className: 'bib-set-group-action', 'aria-hidden': 'true' },
        open ? t('ui.collapse') : t('ui.expand'),
        bibSetChevron({ expanded: open }))),
    // 收合态隐藏三件套：grid 0fr（无高度）+ visibility（不可见且不可聚焦）+ aria-hidden（读屏隐藏）。
    // 不再挂 inert：visibility:hidden 的内容本来就进不了 Tab 序，React 18 又不认识这个属性。
    React.createElement('div', {
      id: props.contentId,
      className: 'bib-set-collapse' + (open ? ' bib-set-collapse--expanded' : ' bib-set-collapse--collapsed'),
      'aria-hidden': open ? undefined : 'true',
    }, React.createElement('div', { className: 'bib-set-collapse-inner' }, props.children)));
}

// 「插件信息」内部的小节分块：同一计费形态的字段放在一块，各自带标题与一句话说明。
// 只做阅读分组 —— 不改变任何字段的显隐、顺序语义或信息栏位置（section 与 group 互不读写）。
// 没有声明 section 的组（native / notice）原样返回，一个字节都不用改。
function bibSetFieldBlocks(visibleFields, props) {
  const rowsOf = function (fields) { return fields.map(function (field) { return bibSetFieldRow(field, props); }); };
  if (!visibleFields.some(function (field) { return !!field.section; })) return rowsOf(visibleFields);
  const known = FIELD_SECTIONS.map(function (section) { return section.id; });
  const blocks = [];
  for (const section of FIELD_SECTIONS) {
    const sectionFields = visibleFields.filter(function (field) { return field.section === section.id; });
    if (sectionFields.length === 0) continue;
    blocks.push(React.createElement('div', { key: 's-' + section.id, className: 'bib-set-subsection' },
      React.createElement('span', { className: 'bib-set-subsection-head' },
        React.createElement('span', { className: 'bib-set-subsection-label' }, t(section.label)),
        React.createElement('span', { className: 'bib-set-subsection-desc' }, t(section.desc))),
      rowsOf(sectionFields)));
  }
  // 认不出小节的字段不能被悄悄丢掉（漏标由守卫测试拦，这里保证渲染不丢行），排在最后。
  const orphans = visibleFields.filter(function (field) { return known.indexOf(field.section) === -1; });
  if (orphans.length > 0) blocks.push(React.createElement('div', { key: 's-orphan', className: 'bib-set-subsection' }, rowsOf(orphans)));
  return blocks;
}

function bibSetFieldGroups(props) {
  const groups = [];
  for (let g = 0; g < FIELD_GROUP_ORDER.length; g++) {
    const group = FIELD_GROUP_ORDER[g];
    const groupFields = FIELD_REGISTRY.filter(function (field) { return field.group === group; });
    if (groupFields.length === 0) continue;
    const visibleFields = groupFields.filter(function (field) { return props.matchesSearch(field, props.query); });
    // 搜索无命中的组整组不渲染（空状态由上层统一给出）
    if (props.searchActive && visibleFields.length === 0) continue;
    const groupLabel = FIELD_GROUP_LABELS[group] ? t(FIELD_GROUP_LABELS[group]) : group;
    // 组卡只保留名称、分工说明与明确的动作；状态数字会增加阅读负担。
    const descKey = FIELD_GROUP_DESC_KEYS[group];
    const title = React.createElement('span', { className: 'bib-set-group-head' },
      React.createElement('span', { className: 'bib-set-group-label' }, groupLabel),
      descKey ? React.createElement('span', { className: 'bib-set-group-desc' }, t(descKey)) : null);
    groups.push(React.createElement(bibSetDisclosure, {
      key: 'g-' + group,
      title: title,
      contentId: 'bib-set-group-' + group,
      open: props.groupOpenOf(group),
      onToggle: function () { props.onGroupToggle(group); },
    }, React.createElement('div', { className: 'bib-set-body' }, bibSetFieldBlocks(visibleFields, props))));
  }
  return groups;
}

// 「时间与日期」独立设置区（决策 3）：主/世界时间的时区。时间显示统一用通用格式，不提供格式选项。
// 对应字段开关全关时整区隐藏；区内每个字段块照宿主 settings-form 字段基线。
function bibSetTimeDateSection(props) {
  const mainOn = props.fieldOn('mainTime');
  const worldOn = props.fieldOn('worldTime');
  if (!mainOn && !worldOn) return null;
  const blocks = [];
  if (mainOn) {
    blocks.push(React.createElement('div', { key: 'main-zone', className: 'bib-set-fieldblock' },
      React.createElement('span', { className: 'bib-set-fieldblock-label' }, t('ui.mainTimeZone')),
      React.createElement(bibSetTimeZonePicker, {
        label: t('ui.mainTimeZone'),
        value: props.timeZonesOf().main,
        onChange: function (value) { props.onTimeZoneChange('main', value); },
      })));
  }
  if (worldOn) {
    blocks.push(React.createElement('div', { key: 'world-zone', className: 'bib-set-fieldblock' },
      React.createElement('span', { className: 'bib-set-fieldblock-label' }, t('ui.worldTimeZone')),
      React.createElement(bibSetTimeZonePicker, {
        label: t('ui.worldTimeZone'),
        value: props.timeZonesOf().world,
        onChange: function (value) { props.onTimeZoneChange('world', value); },
      })));
  }
  return React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-labelledby': 'bib-set-time-date-title' },
    bibSetCardHeader({
      static: true,
      titleId: 'bib-set-time-date-title',
      title: t('ui.timeDateTitle'),
      description: t('ui.timeDateDesc'),
    }),
    React.createElement('div', { className: 'bib-set-fieldblocks' }, blocks));
}

// 「自定义文字」独立设置区（决策 3）：输入框 + 字数提示；对应开关关闭时整区隐藏。
function bibSetCustomTextSection(props) {
  if (!props.fieldOn('customText')) return null;
  return React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-labelledby': 'bib-set-custom-text-title' },
    bibSetCardHeader({
      static: true,
      titleId: 'bib-set-custom-text-title',
      title: t('field.customText.label'),
      description: t('ui.customTextSectionDesc'),
    }),
    React.createElement('div', { className: 'bib-set-fieldblocks' },
      React.createElement('div', { className: 'bib-set-fieldblock' },
        React.createElement('input', {
          id: 'bib-set-custom-text-input',
          type: 'text',
          className: 'bib-set-custom-text-input',
          placeholder: t('ui.customTextPlaceholder'),
          maxLength: 64,
          value: props.customTextDraft !== null ? props.customTextDraft : props.customTextOf(),
          onChange: function (event) { props.onCustomTextChange(event.target.value); },
          onBlur: props.onCustomTextCommit,
          onKeyDown: function (event) { if (event.key === 'Enter') { event.preventDefault(); props.onCustomTextCommit(); } },
          'aria-label': t('ui.customTextTitle'),
        }),
        React.createElement('p', { className: 'bib-set-fieldblock-hint' },
          t('ui.customTextCount', { value: props.customTextOf().length })))));
}

// ===== 插件设置页的通用两段式分段控件 =====
// 最初只服务「订阅窗口百分比方向」（quotaDisplayMode），2026-09-25 起也服务「更新方式」
// （全自动更新 / 手动更新），因此取值归一改为可注入：默认仍是 normalizeQuotaDisplayMode，
// 别的用途必须显式传 normalize —— 否则非余额方向的值会被归一成 remaining，出现「两项都没选中」。
// role=radiogroup + 子项 role=radio + aria-checked + roving tabindex，
// 方向键 / Home / End 键盘可达（与色板圆点同一套交互约定）。
// 选中态：background: var(--bib-set-brand-strong)（#4a63e8 同色相深档 × #fff = 4.95:1，
// 满足 AGENTS.md 对比度铁律 4.5:1 主句；#4d6bfe 实测只有 4.33:1 达不到）+ #fff + font-weight:600，
// hover 仍保持该深档、不跟随主题变浅。真实色值由 tests/test-quota-display-mode.js 做真实
// sRGB 相对亮度计算锁定（不用字符串断言代替）。
function bibSetQuotaMode(props) {
  const options = props.options || [
    { value: 'remaining', label: t('ui.quotaDisplayRemaining') },
    { value: 'used', label: t('ui.quotaDisplayUsed') },
  ];
  const normalize = typeof props.normalize === 'function' ? props.normalize : normalizeQuotaDisplayMode;
  const current = normalize(props.value);
  const refs = React.useRef({});
  const select = function (value) { if (props.onSelect) props.onSelect(value); };
  const moveTo = function (value) {
    const node = refs.current[value];
    if (node && typeof node.focus === 'function') node.focus();
    select(value);
  };
  const step = function (value, offset) {
    let index = 0;
    for (let i = 0; i < options.length; i++) { if (options[i].value === value) index = i; }
    moveTo(options[(index + offset + options.length) % options.length].value);
  };
  const onKey = function (event, value) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); step(value, 1); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); step(value, -1); }
    else if (event.key === 'Home') { event.preventDefault(); moveTo(options[0].value); }
    else if (event.key === 'End') { event.preventDefault(); moveTo(options[options.length - 1].value); }
  };
  return React.createElement('span', {
    className: 'bib-set-quota-mode',
    role: 'radiogroup',
    'aria-label': props.label || t('ui.quotaDisplayModeTitle'),
  }, options.map(function (option) {
    const selected = option.value === current;
    return React.createElement('button', {
      key: option.value,
      type: 'button',
      ref: function (node) { refs.current[option.value] = node; },
      className: props.optionClassName || 'bib-set-quota-mode-opt',
      role: 'radio',
      'aria-checked': selected,
      tabIndex: selected ? 0 : -1,
      onClick: function () { select(option.value); },
      onKeyDown: function (event) { onKey(event, option.value); },
    }, option.label);
  }));
}

// 「订阅窗口百分比方向」独立设置区：与「时间与日期」「自定义文字」同构（静态卡片头 + 字段块）。
// 三个订阅窗口字段（5 小时 / 周 / 月）全关时整区隐藏，与其它设置区的显隐规则一致。
function bibSetQuotaDisplaySection(props) {
  const windowsOn = ['subWindow5h', 'subWindowWeek', 'subWindowMonth'].some(function (id) { return props.fieldOn(id); });
  if (!windowsOn) return null;
  return React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-labelledby': 'bib-set-quota-mode-title' },
    bibSetCardHeader({
      static: true,
      titleId: 'bib-set-quota-mode-title',
      title: t('ui.quotaDisplayModeTitle'),
      description: t('ui.quotaDisplayModeDesc'),
    }),
    React.createElement('div', { className: 'bib-set-fieldblocks' },
      React.createElement('div', { className: 'bib-set-fieldblock' },
        React.createElement(bibSetQuotaMode, {
          label: t('ui.quotaDisplayModeTitle'),
          value: props.modeOf(),
          onSelect: props.onModeChange,
        }))));
}

// 设置区注册表：设置页的区块组成与顺序只在这里排。要加一个新区 = 在这张表里加一行，
// 不要在 InfoBarSettingsSection 的 return 里再插一段（体系统一化：加东西改 1 处）。
// 每行 render(ctx) 收到同一个上下文包；返回 null 的区不占位（与原来直写 null 一致）。
const BIB_SET_SECTIONS = [
  { id: 'timeDate', render: function (deps) { return bibSetTimeDateSection({ fieldOn: deps.fieldOn, timeZonesOf: deps.timeZonesOf, onTimeZoneChange: deps.setTimeZone }); } },
  { id: 'customText', render: function (deps) { return bibSetCustomTextSection({ fieldOn: deps.fieldOn, customTextDraft: deps.customTextDraft, customTextOf: deps.customTextOf, onCustomTextChange: deps.onCustomTextChange, onCustomTextCommit: deps.commitCustomText }); } },
  { id: 'quota', render: function (deps) { return bibSetQuotaDisplaySection({ fieldOn: deps.fieldOn, modeOf: deps.quotaDisplayModeOf, onModeChange: deps.setQuotaDisplayMode }); } },
  { id: 'data', render: function (deps) { return bibSetDataCard({ busy: deps.busy, onExport: deps.runExport, onClear: deps.runClearRecords }); } },
  { id: 'version', render: function (deps) { return bibSetVersionSection({ state: deps.updateState, error: deps.updateError, busy: deps.updateBusy, phase: deps.updatePhase, onToggleAuto: deps.onToggleUpdateAuto, onCheck: deps.onCheckUpdate, onInstall: deps.onInstallUpdate, onForce: deps.onForceUpdate, onRollback: deps.onRollbackUpdate }); } },
];
function bibSetSectionNodes(deps) {
  return BIB_SET_SECTIONS.map(function (section) {
    const node = section.render(deps);
    // 数组子节点需要稳定 key（直写多参数时 React 按位置隐式处理，map 则不会）：
    // 有 key 直接用，没有就补一个，补不上也不抛（null 区本来就不占位）。
    if (node && typeof node === 'object' && (node.key === undefined || node.key === null)) {
      try { return React.cloneElement(node, { key: 'bib-set-section-' + section.id }); } catch (err) { return node; }
    }
    return node;
  });
}

const USAGE_EXPORT_COLUMNS = [
  ['timestamp', function (record) { return usageExportTimestamp(record.ts); }],
  ['provider', function (record) { return record.provider; }],
  ['model', function (record) { return record.model; }],
  ['sessionId', function (record) { return record.sessionId; }],
  ['purpose', function (record) { return record.purpose; }],
  ['inputTokens', function (record) { return record.input; }],
  ['cacheReadTokens', function (record) { return record.cacheRead; }],
  ['cacheWriteTokens', function (record) { return record.cacheWrite; }],
  ['outputTokens', function (record) { return record.output; }],
  ['currency', function (record) { return record.currency; }],
  ['cost', function (record) { return record.cost; }],
  ['pricingStatus', function (record) { return record.pricingStatus; }],
  ['pricingVersion', function (record) { return record.pricingVersion; }],
  ['status', function (record) { return record.status; }],
];

function usageExportTimestamp(value) {
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function usageExportCsv(payload) {
  function cell(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  const rows = [USAGE_EXPORT_COLUMNS.map(function (column) { return cell(column[0]); }).join(',')];
  const records = payload && Array.isArray(payload.records) ? payload.records : [];
  for (let i = 0; i < records.length; i++) {
    rows.push(USAGE_EXPORT_COLUMNS.map(function (column) { return cell(column[1](records[i])); }).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}

function downloadUsageExport(format, payload) {
  if (typeof window === 'undefined' || !window.URL || typeof window.URL.createObjectURL !== 'function'
      || typeof window.URL.revokeObjectURL !== 'function' || typeof Blob === 'undefined'
      || typeof document === 'undefined' || !document.body) {
    throw new Error(t('ui.exportNotSupported'));
  }
  const isCsv = format === 'csv';
  const content = isCsv ? usageExportCsv(payload) : JSON.stringify(payload, null, 2) + '\n';
  const mime = isCsv ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
  const extension = isCsv ? 'csv' : 'json';
  const blob = new Blob([content], { type: mime });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'dsh-bottom-info-bar-billing-' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + extension;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  try { link.click(); } finally {
    if (link.parentNode) link.parentNode.removeChild(link);
    const revoke = function () { window.URL.revokeObjectURL(url); };
    if (scheduleTimeout(revoke, 0) === null) revoke();
  }
}

// ---------- 版本与更新（2026-09-25 自更新体系）----------
// 宿主插件管理没有「更新」动作，插件自己把新版替到包内（见 src/self-update.js 与
// docs/DECISIONS-AUTO-UPDATE.md）。这里只把进度讲清楚，并在失败时给人工兜底。
// 「运行中版本」与「磁盘版本」是两个概念：替换完成后磁盘已是新版、内存里仍跑旧代码，
// 所以要明确提示重启，而不是把版本号一改了事。
// 轮询定时器：极简宿主 / 测试桩可能不提供 window 定时器。缺了就退化为「不轮询」——
// 设置页仍能手动点「检查更新」，绝不因为缺一个定时器把整页打崩（与上面 document 的守卫同源）。
function bibSetPollingStart(fn, ms) {
  return scheduleInterval(fn, ms);
}
function bibSetPollingStop(id) {
  cancelInterval(id);
}
// 相对时间：设置页每 15 秒轮询一次更新状态，所以「刚刚 / N 分钟前」会自己往前走，不需要额外定时器。
// 拿不到时间戳（从未检查过、或当前环境不支持自更新）时返回 null，调用方直接不显示这一段。
function bibSetRelativeTime(stamp) {
  if (typeof stamp !== 'number' || !Number.isFinite(stamp) || stamp <= 0) return null;
  const diff = Date.now() - stamp;
  if (diff < 60000) return t('ui.timeJustNow');
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return t('ui.timeMinutesAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('ui.timeHoursAgo', { n: hours });
  return t('ui.timeDaysAgo', { n: Math.floor(hours / 24) });
}
// 更新失败原因：引擎把技术报错归一成稳定代号（见 self-update.js 的 describeUpdateError），这里翻成人话。
// 认不出的代号回退成「原因已记进更新日志」，绝不把 "unexpected end of file" 这种英文报错甩给用户。
const UPDATE_ERROR_COPY = {
  'incomplete-download': 'ui.updateErrorIncompleteDownload',
  'integrity-mismatch': 'ui.updateErrorIntegrityMismatch',
  'download-failed': 'ui.updateErrorDownloadFailed',
  'too-large': 'ui.updateErrorTooLarge',
  'payload-mismatch': 'ui.updateErrorPayloadMismatch',
  'payload-unsafe': 'ui.updateErrorPayloadUnsafe',
  'check-failed': 'ui.updateErrorCheckFailed',
};
function updateErrorText(kind) {
  return t(UPDATE_ERROR_COPY[kind] || 'ui.updateErrorUnknown');
}
// 设置页「版本与更新」区。三层结构（2026-09-25 第三轮用户拍板「分三层：状态—设置—兜底」）：
//   ① 状态：一句结论 + 一行事实（运行中 / 最新 / 上次检查）+ 动作按钮（只看 / 只装）；
//   ② 设置：唯一的决策项「更新方式」二选一，说明跟着选中项变；
//   ③ 兜底：只在真需要处置时出现，并说明为什么会出现。
// 为什么改成这样：三块内容性质不同（事实 / 决策 / 异常处置），原来平铺成三行掺在一起，
// 同一套机制还在卡片说明、更新方式说明、状态行里讲了三遍 —— 用户原话「感觉就是乱加上去的」。
//
// 2026-09-26：按钮从「更新方式」行挪到状态行（结论旁边），并拆成两个语义 ——
//   检查更新（只读：问一次 npm，绝不下载 / 不替换）与 更新到 X（唯一的写动作）。
//   以前只有一个按钮，它落到引擎里走的是「检查 + 下载 + 替换」同一条流水线，于是点「检查更新」
//   等于立即安装、设置页还会被弹回顶部（用户原话：「我刚刚的测试发现，点了一下检查更新，
//   它就直接装好了」）。语义拆开之后，检查是纯读动作，按钮放在哪里都无害，也就不必再按方式隐藏。
function bibSetVersionSection(props) {
  const state = props.state;
  // 【2026-09-25 血案】宿主进程还没加载到这一版插件代码时（典型场景：包文件已被替换成新版，
  // 但 DSH 还跑着启动时载入的旧 host —— 桌面端更新插件后没重启就是这个样子），
  // getUpdateState 这个接口在旧 host 里根本不存在，读状态必然失败。
  // 旧写法是 `if (!state) return null` —— 整块连同标题一起消失。用户看到一个「完全没有更新入口」
  // 的设置页，只能得出「还是得卸载重装」的结论。所以失败时**必须保留板块**并讲清原因。
  if (!state) {
    if (!props.error) return null;
    return React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-labelledby': 'bib-set-version-title' },
      bibSetCardHeader({
        static: true,
        titleId: 'bib-set-version-title',
        title: t('ui.versionAndUpdateTitle'),
        description: t('ui.versionAndUpdateDesc'),
      }),
      React.createElement('div', { className: 'bib-set-data-actions' },
        React.createElement('div', { className: 'bib-set-data-row' },
          React.createElement('div', { className: 'bib-set-data-copy' },
            React.createElement('p', { className: 'bib-set-data-desc' }, t('ui.versionUnavailable'))))));
  }
  const busy = props.busy === true;
  // 进行中的动作（本地态）：只有它能让结论行说「正在更新到 X」。装的过程有好几秒，
  // 不写清楚用户会以为按钮点漏了。
  const phase = props.phase === 'check' || props.phase === 'install' ? props.phase : null;
  const disabled = state.disabled === true;
  // 「手动更新」= 自动下载关掉了。方向必须按 `=== false` 判定：任何非 false 的值都算全自动。
  const manual = state.autoUpdate === false;
  const shown = function (value) { return typeof value === 'string' && value.length > 0 ? value : t('ui.versionUnknown'); };
  // 方向由 host 判定（见 getUpdateState）：update = 磁盘已是新版待重启；rollback = 用户回滚过、
  // 磁盘比运行版本旧，同样只有重启才生效，但说法必须不同，否则用户会以为自己在跑新版。
  const restartDirection = state.restartDirection === 'update' || state.restartDirection === 'rollback'
    ? state.restartDirection : null;
  const latest = typeof state.latest === 'string' && state.latest.length > 0 ? state.latest : null;
  // 「有新版可装」由 host 判定（latest 严格高于磁盘版本）。没有确切版本号就不摆出装按钮 ——
  // 文案里带不出版本号的按钮，等于让用户闭着眼睛点。
  const available = state.available === true && latest !== null;
  // 回滚过的版本被暂缓：默认不再装回来，需要用户显式点「允许更新到 X」才会覆盖。
  // 此时不能再摆「更新到 X」（那次点击会被引擎的暂缓分支吃掉，界面看起来像没反应）。
  const held = typeof state.holdVersion === 'string' && state.holdVersion.length > 0
    && state.holdVersion === state.latest;
  // ③ 兜底的显示条件（2026-09-25 第三轮拍板「按需出现」）：
  // 这里**刻意不再包含 pendingVersion**。它为了在回滚时定位备份而永不清除（见 self-update.js），
  // 于是只要成功更新过一次，「回滚到上一版」就永远挂在界面上 —— 这正是用户觉得最像「乱加」的一处。
  // 真正需要逃生门的窗口只有两个：新版已装好但还没重启（restartDirection === 'update'，此时退回最省事），
  // 以及上次更新失败（lastError）。已经回滚过的（restartDirection === 'rollback'）不再显示 ——
  // 那时引擎侧的 pendingVersion 已清空，再点一次也没有可回滚的对象。
  const canRollback = restartDirection === 'update' || !!state.lastError;
  const showFallback = !disabled && (canRollback || held);
  const showInstall = !disabled && available && !held;
  // ① 状态层：先给结论，再把事实摆在下面
  let statusText = t(latest ? 'ui.updateUpToDate' : 'ui.updateErrorCheckFailed');
  if (disabled) statusText = t('ui.updateDisabled');
  else if (busy && phase === 'install' && latest) statusText = t('ui.updateInstalling', { version: latest });
  else if (restartDirection === 'update') statusText = t('ui.updatePendingRestart', { version: shown(state.diskVersion) });
  else if (restartDirection === 'rollback') statusText = t('ui.updateRolledBack', { version: shown(state.diskVersion) });
  else if (state.lastError) statusText = t('ui.updateFailed');
  else if (held) statusText = t('ui.updateHeld', { version: state.holdVersion });
  else if (available) statusText = t('ui.updateAvailableNow', { version: latest });
  // 事实行：运行中 / 最新 / 上次检查时间。最后一项是这一轮新加的 —— 状态文件里一直记着它，
  // 界面却不显示，用户没法确认「它到底有没有在干活」（用户第三轮的原问题就是「实现了吗」）。
  const facts = [
    t('ui.versionRunning', { version: shown(state.runningVersion) }),
    t('ui.versionLatest', { version: shown(state.latest) }),
  ];
  const checkedAt = bibSetRelativeTime(state.lastCheckAt);
  if (checkedAt) facts.push(t('ui.versionLastCheck', { time: checkedAt }));
  // 动作按钮：两个动词分开就是这一轮的全部要点 ——
  // 「检查更新」只问不装（纯读），「更新到 X」才装。全自动模式下同样给出「检查更新」：
  // 它现在是无害的，而用户想立刻确认有没有新版时不必为此切换更新方式。
  const actions = disabled ? null : React.createElement('div', { className: 'bib-set-data-button-group' },
    bibSetButton({
      disabled: busy,
      onClick: props.onCheck,
      children: busy && phase === 'check' ? t('ui.updateChecking') : t('ui.updateCheckNow'),
    }),
    showInstall ? bibSetButton({
      disabled: busy,
      onClick: props.onInstall,
      children: busy && phase === 'install'
        ? t('ui.updateInstalling', { version: latest })
        : t('ui.updateInstallNow', { version: latest }),
    }) : null);
  return React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-labelledby': 'bib-set-version-title' },
    bibSetCardHeader({
      static: true,
      titleId: 'bib-set-version-title',
      title: t('ui.versionAndUpdateTitle'),
      description: t('ui.versionAndUpdateDesc'),
    }),
    React.createElement('div', { className: 'bib-set-data-actions' },
      // ① 状态：结论在上（大字），事实在下（小字）；按钮就贴在结论右侧 —— 结论与处置同一处，
      // 不再让用户去「更新方式」那一行找按钮（那里是设置，不是动作）。
      React.createElement('div', { className: 'bib-set-data-row' },
        React.createElement('div', { className: 'bib-set-data-copy' },
          React.createElement('p', { className: 'bib-set-data-title' }, statusText),
          React.createElement('p', { className: 'bib-set-data-desc' }, disabled
            ? t('ui.versionRunning', { version: shown(state.runningVersion) }) + ' · ' + t('ui.updateDisabledWhy')
            : facts.join(' · '))),
        actions),
      // 失败原因单独一行讲人话：代号由 host 归一（历史数据里的原始报错同样能被翻译成代号）。
      state.lastError && !disabled ? React.createElement('div', { className: 'bib-set-data-row' },
        React.createElement('div', { className: 'bib-set-data-copy' },
          React.createElement('p', { className: 'bib-set-data-desc' }, updateErrorText(state.lastErrorKind || state.lastError)))) : null,
      // ② 更新方式：这一块唯一的设置项。说明跟着选中项走，不再把两种方式的说明并排摊开成一段话。
      // 当前环境不支持自更新时整块不渲染：摆出用不了的控件，只会让人以为是自己点错了地方。
      disabled ? null : React.createElement('div', { className: 'bib-set-data-row' },
        React.createElement('div', { className: 'bib-set-data-copy' },
          React.createElement('p', { className: 'bib-set-data-title' }, t('ui.autoUpdateTitle')),
          React.createElement('p', { className: 'bib-set-data-desc' }, manual ? t('ui.updateModeManualDesc') : t('ui.updateModeAutoDesc'))),
        // 更新方式用两段式选择而不是开关：用户拍板「全自动更新 / 手动更新」是二选一，不是开与关。
        // 组件复用订阅窗口方向的两段式（同一套几何与对比度），必须以 createElement 创建（内部有 hooks）。
        React.createElement('div', { className: 'bib-set-data-button-group' },
          React.createElement(bibSetQuotaMode, {
            label: t('ui.autoUpdateTitle'),
            value: manual ? 'manual' : 'auto',
            // 取值归一必须显式给出：控件默认按「订阅窗口方向」归一，会把 auto/manual 折成 remaining，
            // 结果是两个子项都没选中（2026-09-25 由 tests/test-quota-display-mode.cjs 抓出）。
            normalize: function (value) { return value === 'manual' ? 'manual' : 'auto'; },
            onSelect: function (value) {
              if (busy) return;
              props.onToggleAuto(value !== 'manual');
            },
            options: [
              { value: 'auto', label: t('ui.updateModeAuto') },
              { value: 'manual', label: t('ui.updateModeManual') },
            ],
          }))),
      // ③ 兜底：平时不占位；出现时先说清为什么会出现，再给按钮。
      showFallback ? React.createElement('div', { className: 'bib-set-data-row' },
        React.createElement('div', { className: 'bib-set-data-copy' },
          React.createElement('p', { className: 'bib-set-data-desc' }, canRollback ? t('ui.updateFallbackWhy') : t('ui.updateHoldWhy'))),
        React.createElement('div', { className: 'bib-set-data-button-group' },
          canRollback ? bibSetButton({ disabled: busy, onClick: props.onRollback, children: t('ui.updateRollback') }) : null,
          held ? bibSetButton({ disabled: busy, onClick: props.onForce, children: t('ui.updateAllowHeld', { version: state.holdVersion }) }) : null)) : null));
}

function bibSetDataCard(props) {
  const disabled = props.busy === true;
  return React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-labelledby': 'bib-set-data-title' },
    bibSetCardHeader({
      static: true,
      titleId: 'bib-set-data-title',
      title: t('ui.dataAndBilling'),
      description: t('ui.dataAndBillingDesc'),
    }),
    React.createElement('div', { className: 'bib-set-data-actions' },
      React.createElement('div', { className: 'bib-set-data-row' },
        React.createElement('div', { className: 'bib-set-data-copy' },
          React.createElement('p', { className: 'bib-set-data-title' }, t('ui.exportBillingRecords')),
          React.createElement('p', { className: 'bib-set-data-desc' }, t('ui.exportBillingRecordsDesc'))),
        React.createElement('div', { className: 'bib-set-data-button-group' },
          bibSetButton({ disabled: disabled, onClick: function () { props.onExport('csv'); }, children: t('ui.exportBillingCsv') }),
          bibSetButton({ disabled: disabled, onClick: function () { props.onExport('json'); }, children: t('ui.exportBillingJson') }))),
      React.createElement('div', { className: 'bib-set-data-row' },
        React.createElement('div', { className: 'bib-set-data-copy' },
          React.createElement('p', { className: 'bib-set-data-title' }, t('ui.clearBillingRecords')),
          React.createElement('p', { className: 'bib-set-data-desc' }, t('ui.clearBillingRecordsDesc'))),
        React.createElement('div', { className: 'bib-set-data-button-group' },
          bibSetButton({ destructive: true, disabled: disabled, onClick: props.onClear, children: t('ui.clearBillingRecords') })))));
}

function InfoBarSettingsSection() {
  const [snapshot, setSnapshot] = React.useState(null);
  const [status, setStatus] = React.useState('loading');
  const [loadError, setLoadError] = React.useState(null);
  const [opError, setOpError] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [dataBusy, setDataBusy] = React.useState(false);
  const [hexDrafts, setHexDrafts] = React.useState({});
  const [customTextDraft, setCustomTextDraft] = React.useState(null);
  const opSeqRef = React.useRef(0); // 版本号守卫：慢响应绝不覆盖更新的操作
  const savingCountRef = React.useRef(0);
  const settingsRootRef = React.useRef(null);
  // 宿主滚动祖先只加“隐藏轨道”的标记，不改变其尺寸或 overflow，避免再次引入布局抖动。
  const useLayoutEffect = React.useLayoutEffect || React.useEffect;
  useLayoutEffect(function () {
    // 页面若因更新被重建，这里是唯一能补回滚动位置的地方（记录存在模块作用域，跨重建存活）。
    bibSetRestoreScroll();
    return bibSetHideHostScrollbars(settingsRootRef.current);
  }, []);

  // Language changes redraw this page without reloading or changing DSH preferences.
  const [, setLocaleRevision] = React.useState(0);
  React.useEffect(function () {
    return languageRuntime.subscribe(function () {
      setLocaleRevision(function (value) { return value + 1; });
    });
  }, []);
  const [searchQuery, setSearchQuery] = React.useState('');
  // 三个分组各自独立折叠，**默认全部收起**（2026-09-25 用户拍板）：
  // 全展开会让设置页一次性铺满几十行，用户找不到想看的那一组；先给三行标题，
  // 想看哪组点哪组。搜索框一有输入就自动全展开（见下方搜索框的 onChange），
  // 所以「找字段」这条路径不会因为默认收起而变慢。
  const [groupOpen, setGroupOpen] = React.useState({ native: false, plugin: false, notice: false });
  // 决策 4：重置的二次确认。null=未在确认；'fields'/'colors'=待确认的重置类别。
  const [resetConfirm, setResetConfirm] = React.useState(null);
  const [resetAcknowledged, setResetAcknowledged] = React.useState(false);
  function matchesSearch(field, query) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const label = t(field.label).toLowerCase();
    const note = field.note ? t(field.note).toLowerCase() : '';
    const id = field.id.toLowerCase();
    return label.indexOf(q) !== -1 || note.indexOf(q) !== -1 || id.indexOf(q) !== -1;
  }

  React.useEffect(function () {
    let active = true;
    rpc('getFieldConfig').then(function (cfg) {
      if (!active) return;
      if (cfg && typeof cfg === 'object' && cfg.fields) {
        setSnapshot({ fields: cfg.fields, colors: cfg.colors || {}, infoDensity: cfg.infoDensity === 'compact' ? 'compact' : 'full', timeZones: cfg.timeZones || { main: 'Asia/Shanghai', world: 'UTC' }, customText: typeof cfg.customText === 'string' ? cfg.customText : '', quotaDisplayMode: normalizeQuotaDisplayMode(cfg.quotaDisplayMode), configVersion: cfg.configVersion || 0 });
        setStatus('ready');
      } else {
        setLoadError(t('ui.settingsAreTemporarilyUnavailable')); setStatus('error');
      }
    }).catch(function (err) {
      if (!active) return;
      setLoadError(bibSetOperationMessage(err)); setStatus('error');
    });
    return function () { active = false; };
  }, []);

  // ---------- 版本与更新（自更新体系）----------
  // 进入插件设置页就通知宿主：本次启动的自动更新若尚未安装，应留待下次重启。
  // 旧宿主不认识这个接口时安静降级，新页仍可查看版本信息。
  React.useEffect(function () {
    rpc('enterUpdatePage').catch(function () {});
  }, []);
  // 与设置快照分开维护：更新状态可能异步变化，定期跟随而不刷新整页。
  const [updateState, setUpdateState] = React.useState(null);
  const [updateBusy, setUpdateBusy] = React.useState(false);
  // 正在跑的是哪个动作（'check' / 'install' / 'mode'）。结论行据此说「正在更新到 X」——
  // 安装要好几秒，不写清楚用户会以为按钮点漏了。
  const [updatePhase, setUpdatePhase] = React.useState(null);
  // 读不到更新状态时保留原因：不能只是静默不显示（见 bibSetVersionSection 顶部）。
  // 一旦成功读到过一次就清掉；此后的偶发失败沿用上一次的好状态，不打断已显示的版本信息。
  const [updateError, setUpdateError] = React.useState(null);
  // 更新状态只有一个读入口（轮询与动作之后共用同一条），所以不存在「动作返回值 vs 轮询结果」
  // 拼出来的半状态 —— 那种半状态会让结论行说谎：点完检查更新，界面还说「已是最新」，
  // 要等最多 15 秒的下一次轮询才对上（2026-09-26 用户报的问题之一）。
  function loadUpdateState() {
    return rpc('getUpdateState').then(function (res) {
      setUpdateError(null);
      if (res && typeof res === 'object') setUpdateState(res);
      return res;
    }).catch(function (err) {
      // 读不到更新状态不影响设置页其余部分
      setUpdateError(String((err && err.message) || err || 'unknown'));
      return null;
    });
  }
  React.useEffect(function () {
    let active = true;
    function load() { if (active) loadUpdateState(); }
    load();
    const timer = bibSetPollingStart(load, 15000);
    return function () { active = false; bibSetPollingStop(timer); };
  }, []);
  // 所有更新动作的统一通道：忙碌态 + 动作名 → 执行 → 重新读一次状态。
  // 「重新读一次」是刻意的：动作的返回值可能与轮询到的状态形状不同，而界面只认一个形状。
  function runUpdateAction(phase, factory) {
    bibSetRememberScroll(settingsRootRef.current);
    setUpdateBusy(true);
    setUpdatePhase(phase);
    const settle = function () {
      setUpdateBusy(false);
      setUpdatePhase(null);
    };
    return factory().then(function (res) {
      settle();
      return loadUpdateState().then(function () {
        bibSetRestoreScroll();
        return res;
      });
    }).catch(function (err) {
      settle();
      bibSetRestoreScroll();
      // 新版界面 + 旧版宿主（更新后还没重启）：给一句能解释得通的话，而不是 unknown method: xxx。
      if (bibSetMissingMethod(err)) {
        setOpError({ text: function () { return t('ui.updateHostOutdated'); } });
        return;
      }
      setOpError({ text: function () { return t('ui.couldNotSave', { errorPrefix: t('ui.versionAndUpdateTitle'), value: hostText(bibSetOperationMessage(err)) }); } });
    });
  }
  function onToggleUpdateAuto(next) {
    const enabled = next !== false;
    setUpdateState(function (prev) { return prev ? Object.assign({}, prev, { autoUpdate: enabled }) : prev; });
    runUpdateAction('mode', function () { return rpc('setUpdateAuto', { enabled: enabled }); });
  }
  function confirmUpdate(version) {
    if (typeof version !== 'string' || !version) return false;
    try {
      return typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(t('ui.updateConfirm', { version: version })) : false;
    } catch (err) { return false; }
  }
  // 「检查更新」只问版本；发现新版后在当前页面弹窗确认，确认才走安装接口。
  function onCheckUpdate() {
    return runUpdateAction('check', function () { return rpc('checkUpdate'); }).then(function (state) {
      if (state && state.available === true && state.pendingRestart !== true && confirmUpdate(state.latest)) {
        return runUpdateAction('install', function () { return rpc('installUpdate'); });
      }
      return state;
    });
  }
  // 状态轮询出现的「更新到 X」按钮也须确认，不能绕过弹窗。
  function onInstallUpdate() {
    if (!updateState || !confirmUpdate(updateState.latest)) return;
    return runUpdateAction('install', function () { return rpc('installUpdate'); });
  }
  // 「允许更新到 X」：用户回滚过的版本默认不再装回来（引擎侧 holdVersion），
  // 只有这个显式动作才解除暂缓 —— 逃生门不能被自动流程悄悄重新打开。
  function onForceUpdate() {
    if (!updateState || !confirmUpdate(updateState.holdVersion)) return;
    return runUpdateAction('install', function () { return rpc('installUpdate', { force: true }); });
  }
  function onRollbackUpdate() {
    // 回滚也是「替换包文件」，但结论行不能借用安装的文案（那会说成「正在更新到 X」）。
    // 它的阶段名独立，结论行沿用回滚前的那句，动作完成后再由重读到的状态改写。
    return runUpdateAction('rollback', function () { return rpc('rollbackUpdate'); }).then(function (res) {
      // 回滚失败（没有备份 / 没有可回滚版本）必须说出来：点一下什么都没发生，用户只会以为坏了。
      if (res && res.rollback && res.rollback.restored !== true) {
        setOpError({ text: function () { return t('ui.updateRollbackFailed'); } });
      }
    });
  }

  const beginOp = React.useCallback(function () {
    savingCountRef.current += 1;
    setSaving(true);
  }, []);
  const endOp = React.useCallback(function () {
    savingCountRef.current = Math.max(0, savingCountRef.current - 1);
    if (savingCountRef.current === 0) setSaving(false);
  }, []);

  // 渲染期异常显示在页面内，避免设置页变成白屏。
  try {
    if (status === 'loading') {
      return React.createElement('div', { ref: settingsRootRef, className: 'bib-set-root bib-settings' },
        React.createElement('div', { className: 'bib-set-page-head' }, bibSetPageTitle()),
    pluginLanguagePicker(React, languageRuntime, setOpError),
        bibSetAlert({ tone: 'info', children: t('ui.loadingInfoBarSettings') }));
    }
    if (status === 'error') {
      return React.createElement('div', { ref: settingsRootRef, className: 'bib-set-root bib-settings' },
        React.createElement('div', { className: 'bib-set-page-head' }, bibSetPageTitle()),
    pluginLanguagePicker(React, languageRuntime, setOpError),
        bibSetAlert({ tone: 'error', children: t('ui.couldNotLoadInfoBar') + (hostText(loadError) || t('ui.pleaseTryAgainLater')) }));
    }

  const fieldsById = {};
  for (let i = 0; i < FIELD_REGISTRY.length; i++) fieldsById[FIELD_REGISTRY[i].id] = FIELD_REGISTRY[i];
  function fieldOn(id) { return snapshot.fields[id] !== false; }
  function colorOf(id) {
    const value = snapshot.colors[id];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  function labelOf(id) { const f = fieldsById[id]; return f ? t(f.label) : id; }
  function makePair(key, value) { const pair = {}; pair[key] = value; return pair; }
  function toggleGroup(group) {
    setGroupOpen(function (state) { return Object.assign({}, state, makePair(group, !(state && state[group] === true))); });
  }

  // 服务端快照回写（configVersion 一并更新；persisted=false 时如实提示落盘失败）
  function applyServerResult(res) {
    if (!res || typeof res !== 'object') return;
    setSnapshot(function (prev) {
      return {
        fields: res.fields || (prev && prev.fields) || {},
        colors: res.colors || (prev && prev.colors) || {},
        infoDensity: res.infoDensity === 'compact' ? 'compact' : ((res.infoDensity === 'full') ? 'full' : ((prev && prev.infoDensity) || 'full')),
        timeZones: res.timeZones || (prev && prev.timeZones) || { main: 'Asia/Shanghai', world: 'UTC' },
        customText: typeof res.customText === 'string' ? res.customText : ((prev && prev.customText) || ''),
        // 旧宿主不回传该字段时保留本地值（绝不因一次保存把方向重置掉）
        quotaDisplayMode: typeof res.quotaDisplayMode === 'string' ? normalizeQuotaDisplayMode(res.quotaDisplayMode) : normalizeQuotaDisplayMode(prev && prev.quotaDisplayMode),
        configVersion: typeof res.configVersion === 'number' ? res.configVersion : ((prev && prev.configVersion) || 0),
      };
    });
    if (res.persisted === false) setNotice({ text: function () { return t('ui.changesAppliedButCouldNot') + (errorText(res.warning) || t('ui.unknownReason')); } });
  }

  // 乐观更新 + 失败回退（参照 density toggle）+ 版本号守卫
  function commit(patch, applyOptimistic, revertOptimistic, errorPrefix) {
    setOpError(null);
    setNotice(null);
    const seq = ++opSeqRef.current;
    applyOptimistic();
    beginOp();
    rpc('setFieldConfig', patch).then(function (res) {
      if (seq !== opSeqRef.current) { endOp(); return; }
      endOp();
      applyServerResult(res);
      bibSetDispatchChanged();
    }).catch(function (err) {
      if (seq !== opSeqRef.current) { endOp(); return; }
      endOp();
      revertOptimistic();
      // Translate feedback during rendering, including its field label. The
      // object wrapper prevents React from treating the thunk as a state updater.
      setOpError({ text: function () { return t('ui.couldNotSave', { errorPrefix: errorPrefix(), value: hostText(bibSetOperationMessage(err)) }); } });
    });
  }

  function setFieldFlag(id, next) {
    const previous = fieldOn(id);
    if (previous === next) return;
    commit({ fields: makePair(id, next) },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { fields: Object.assign({}, s.fields, makePair(id, next)) }); }); },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { fields: Object.assign({}, s.fields, makePair(id, previous)) }); }); },
      function () { return t('ui.fieldErrorPrefix', { label: labelOf(id) }); });
  }

  function setColor(id, next) {
    const previous = colorOf(id);
    if (previous === next) {
      setHexDrafts(function (drafts) { return Object.assign({}, drafts, makePair(id, undefined)); });
      return;
    }
    commit({ colors: makePair(id, next) },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { colors: Object.assign({}, s.colors, makePair(id, next)) }); }); },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { colors: Object.assign({}, s.colors, makePair(id, previous)) }); }); },
      function () { return t('ui.color', { value: labelOf(id) }); });
  }

  // hex 输入：输入中仅标记非法（描红 + aria-invalid）；Enter/失焦时合法才提交，非法回退当前值
  function hexDraftOf(id) {
    const draft = hexDrafts[id];
    return typeof draft === 'string' ? draft : null;
  }
  function committedHexText(id) {
    const value = colorOf(id);
    if (value === null) return '';
    return PRESET_COLOR_SET.has(value) ? value.toUpperCase() : value;
  }
  function onHexChange(id, raw) {
    setHexDrafts(function (drafts) { return Object.assign({}, drafts, makePair(id, raw)); });
  }
  function commitHex(id) {
    const draft = hexDraftOf(id);
    if (draft === null) return;
    const value = draft.trim();
    setHexDrafts(function (drafts) { return Object.assign({}, drafts, makePair(id, undefined)); });
    if (value.length === 0) return;
    if (!BIB_SET_HEX_PATTERN.test(value)) {
      setOpError({ text: function () { return t('ui.hasAnInvalidColorEnter', { value: labelOf(id) }); } });
      return;
    }
    setColor(id, value.toUpperCase());
  }
  function timeZonesOf() { return snapshot.timeZones || { main: 'Asia/Shanghai', world: 'UTC' }; }
  function customTextOf() { return typeof snapshot.customText === 'string' ? snapshot.customText : ''; }
  function quotaDisplayModeOf() { return normalizeQuotaDisplayMode(snapshot.quotaDisplayMode); }
  function infoDensityOf() { return snapshot.infoDensity === 'compact' ? 'compact' : 'full'; }
  function setTimeZone(which, next) {
    const current = timeZonesOf();
    if (current[which] === next) return;
    const patch = { timeZones: Object.assign({}, current, makePair(which, next)) };
    const prev = current[which];
    commit(patch,
      function () { setSnapshot(function (s) { return Object.assign({}, s, { timeZones: Object.assign({}, s.timeZones, makePair(which, next)) }); }); },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { timeZones: Object.assign({}, s.timeZones, makePair(which, prev)) }); }); },
      function () { return which === 'main' ? t('ui.mainTimeZone') : t('ui.worldTimeZone'); });
  }
  // 订阅窗口百分比方向：复用与字段开关/颜色同一条 commit()（乐观更新 + 失败回滚 + 版本号守卫），
  // 成功由 applyServerResult 回写快照并广播 CustomEvent，信息栏随即重拉配置。
  function setQuotaDisplayMode(next) {
    const value = normalizeQuotaDisplayMode(next);
    const previous = quotaDisplayModeOf();
    if (previous === value) return;
    commit({ quotaDisplayMode: value },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { quotaDisplayMode: value }); }); },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { quotaDisplayMode: previous }); }); },
      function () { return t('ui.quotaDisplayModeTitle'); });
  }

  function onCustomTextChange(raw) { setCustomTextDraft(raw); }
  function committedCustomText() { return customTextOf(); }
  function commitCustomText() {
    const draft = customTextDraft;
    if (draft === null) return;
    const value = draft;
    setCustomTextDraft(null);
    if (value === committedCustomText()) return;
    if (value.length > 64) {
      setOpError({ text: function () { return t('host.customTextTooLong'); } });
      return;
    }
    commit({ customText: value },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { customText: value }); }); },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { customText: committedCustomText() }); }); },
      function () { return t('ui.customText'); });
  }

  function runReset(kind) {
    setOpError(null);
    setNotice(null);
    const seq = ++opSeqRef.current;
    beginOp();
    rpc(kind === 'colors' ? 'resetFieldColors' : 'resetFieldConfig').then(function (res) {
      if (seq !== opSeqRef.current) { endOp(); return; }
      endOp();
      applyServerResult(res);
      bibSetDispatchChanged();
      setNotice({ text: function () { return kind === 'colors' ? t('ui.defaultColorsRestored') : t('ui.defaultLabelsRestored'); } });
    }).catch(function (err) {
      if (seq !== opSeqRef.current) { endOp(); return; }
      endOp();
      setOpError({ text: function () { return t('ui.couldNotReset', { value: hostText(bibSetOperationMessage(err)) }); } });
    });
  }

  // 决策 4：重置不再一键执行。宿主有原生 RiskConfirmation 时先弹确认（勾选后才能确认）；
  // 取不到时退回 window.confirm——两条路径都保证「未确认不执行」。
  function requestReset(kind) {
    if (!BIB_SET_NATIVE_RISK_CONFIRM) {
      let confirmed = false;
      try {
        confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(kind === 'colors' ? t('ui.resetConfirmDescColors') : t('ui.resetConfirmDescFields')) : false;
      } catch (err) { confirmed = false; }
      if (confirmed) runReset(kind);
      return;
    }
    setResetAcknowledged(false);
    setResetConfirm(kind === 'colors' ? 'colors' : 'fields');
  }

  function runExport(format) {
    if (saving || dataBusy) return;
    setOpError(null);
    setNotice(null);
    setDataBusy(true);
    rpc('exportUsageRecords').then(function (payload) {
      if (payload && payload.archiveReadError) {
        throw new Error(t('ui.exportIncomplete', { value: hostText(payload.archiveReadError) }));
      }
      const records = payload && Array.isArray(payload.records) ? payload.records : [];
      if (records.length === 0) {
        setNotice({ text: function () { return t('ui.noBillingRecordsToExport'); } });
        return;
      }
      downloadUsageExport(format, payload);
      setNotice({ text: function () { return t('ui.exportedBillingRecords', { count: records.length, format: format.toUpperCase() }); } });
    }).catch(function (err) {
      setOpError({ text: function () { return t('ui.exportFailed', { value: hostText(bibSetOperationMessage(err)) }); } });
    }).finally(function () { setDataBusy(false); });
  }

  function runClearRecords() {
    if (saving || dataBusy) return;
    let confirmed = false;
    try {
      confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(t('ui.clearBillingRecordsConfirm')) : false;
    } catch (err) { confirmed = false; }
    if (!confirmed) {
      setNotice({ text: function () { return t('ui.clearCanceled'); } });
      return;
    }
    setOpError(null);
    setNotice(null);
    setDataBusy(true);
    rpc('clearUsageRecords').then(function (result) {
      if (!result || result.cleared !== true) throw new Error((result && result.warning) || t('ui.clearFailedWithoutDetails'));
      setNotice({ text: function () { return t('ui.clearedBillingRecords', { count: result.recordCount || 0 }); } });
      bibSetDispatchLedgerChanged();
    }).catch(function (err) {
      setOpError({ text: function () { return t('ui.clearFailed', { value: hostText(bibSetOperationMessage(err)) }); } });
    }).finally(function () { setDataBusy(false); });
  }

  // ---- 渲染 ----
  // 搜索只负责筛选；输入时两分组自动展开（决策 2），但用户随后仍可明确折叠，
  // 箭头和 aria-expanded 始终反映真实 DOM 状态。
  const searchActive = searchQuery.trim().length > 0;
  const fieldsEnabledCount = FIELD_REGISTRY.filter(function (f) { return fieldOn(f.id); }).length;
  const fieldsMatchCount = FIELD_REGISTRY.filter(function (f) { return matchesSearch(f, searchQuery); }).length;
  const groupsChildren = bibSetFieldGroups({
    query: searchQuery,
    searchActive: searchActive,
    matchesSearch: matchesSearch,
    groupOpenOf: function (group) { return groupOpen && groupOpen[group] === true; },
    onGroupToggle: toggleGroup,
    fieldOn: fieldOn,
    colorOf: colorOf,
    hexDraftOf: hexDraftOf,
    committedHexText: committedHexText,
    onFieldToggle: setFieldFlag,
    onColorChange: setColor,
    onHexChange: onHexChange,
    onHexCommit: commitHex,
    timeZonesOf: timeZonesOf,
    onTimeZoneChange: setTimeZone,
    customTextDraft: customTextDraft,
    customTextOf: customTextOf,
    onCustomTextChange: onCustomTextChange,
    onCustomTextCommit: commitCustomText,
  });

  // 提示分两类：错误/警示是独立整块（照宿主 .X_2TxG_failure / .X_2TxG_banner 的形态），
  // 状态文字（已保存/保存中）是页脚左侧的安静一行（照宿主 .X_2TxG_sectionCount 的 12/18 次要色）。
  const alerts = [];
  if (opError) alerts.push(bibSetAlert({ tone: 'error', key: 'err', children: opError.text() }));
  const feedback = [];
  if (notice) feedback.push(React.createElement('span', { key: 'notice', className: 'bib-set-notice', role: 'status' }, notice.text()));
  else if (saving) feedback.push(React.createElement('span', { key: 'saving', className: 'bib-set-notice', 'aria-live': 'polite' }, t('ui.saving')));
  else if (dataBusy) feedback.push(React.createElement('span', { key: 'processing', className: 'bib-set-notice', 'aria-live': 'polite' }, t('ui.processing')));

  const fieldSummary = searchActive
    ? t('ui.searchResultCount', { count: fieldsMatchCount })
    : t('ui.enabledFieldsCount', { count: fieldsEnabledCount });
  // 字段卡片 = 搜索工具栏 + 两个独立折叠的分组（决策 2）。搜索无命中时给明确空状态。
  // 分组必须作为 field-list 的直接子项，flex gap 才会真实落在两张卡之间；
  // 旧的 .bib-set-body 包装层让 16px 间距只存在于样式表中，画面上仍会挤在一起。
  const fieldsBody = React.createElement('div', { className: 'bib-set-field-list' },
    searchActive && fieldsMatchCount === 0
      ? React.createElement('p', { className: 'bib-set-empty', role: 'status' }, t('ui.noSearchResults'))
      : groupsChildren);
  // 决策 4：确认弹窗（勾选前「确认」按钮由 RiskConfirmation 禁用）。
  const resetDialog = resetConfirm !== null && BIB_SET_NATIVE_RISK_CONFIRM
    ? React.createElement(BIB_SET_NATIVE_RISK_CONFIRM, {
      open: true,
      title: t('ui.resetConfirmTitle'),
      description: resetConfirm === 'colors' ? t('ui.resetConfirmDescColors') : t('ui.resetConfirmDescFields'),
      acknowledgeLabel: t('ui.resetConfirmAcknowledge'),
      cancelLabel: t('ui.resetConfirmCancel'),
      closeLabel: t('ui.resetConfirmCancel'),
      confirmLabel: t('ui.resetConfirmConfirm'),
      acknowledged: resetAcknowledged,
      onAcknowledgedChange: function (next) { setResetAcknowledged(next === true); },
      onCancel: function () { setResetConfirm(null); },
      onConfirm: function () {
        const kind = resetConfirm;
        setResetConfirm(null);
        if (kind) runReset(kind);
      },
    })
    : null;
  return React.createElement('div', { ref: settingsRootRef, className: 'bib-set-root bib-settings' },
    React.createElement('div', { className: 'bib-set-page-head' }, bibSetPageTitle()),
    pluginLanguagePicker(React, languageRuntime, setOpError),
    React.createElement('section', { className: 'bib-set-card', 'aria-label': t('ui.visibleFields') },
      React.createElement('div', { className: 'bib-set-toolbar' },
        React.createElement('div', { className: 'bib-set-search-row' },
          React.createElement('div', { className: 'bib-set-search-shell' },
            React.createElement('input', {
              type: 'search',
              className: 'bib-set-search',
              placeholder: t('ui.searchPlaceholder') || '搜索内容…',
              value: searchQuery,
              onChange: function (e) {
                const value = e && e.target ? e.target.value : '';
                setSearchQuery(value);
                if (value.trim().length > 0) setGroupOpen({ native: true, plugin: true, notice: true });
              },
              'aria-label': t('ui.searchFieldsLabel') || 'Search visible content'
            })),
          React.createElement('span', { className: 'bib-set-count', role: 'status', 'aria-live': 'polite' }, fieldSummary))),
      fieldsBody,
      // 「恢复默认」行（决策 4：带二次确认）：照「导出账单」的原生行几何，
      // 挂在「显示内容」区块底部，不再悬浮在页面右下角。
      React.createElement('div', { className: 'bib-set-data-row bib-set-reset-row' },
        React.createElement('div', { className: 'bib-set-data-copy' },
          React.createElement('p', { className: 'bib-set-data-title' }, t('ui.resetRowTitle')),
          React.createElement('p', { className: 'bib-set-data-desc' }, t('ui.resetRowDesc')),
          feedback),
        React.createElement('div', { className: 'bib-set-data-button-group' },
          bibSetButton({
            disabled: saving || dataBusy,
            onClick: function () { requestReset('fields'); },
            children: t('ui.resetLabels'),
          }),
          bibSetButton({
            disabled: saving || dataBusy,
            onClick: function () { requestReset('colors'); },
            children: t('ui.resetColors'),
          })))),
    bibSetSectionNodes({
      fieldOn: fieldOn,
      timeZonesOf: timeZonesOf,
      setTimeZone: setTimeZone,
      customTextDraft: customTextDraft,
      customTextOf: customTextOf,
      onCustomTextChange: onCustomTextChange,
      commitCustomText: commitCustomText,
      quotaDisplayModeOf: quotaDisplayModeOf,
      setQuotaDisplayMode: setQuotaDisplayMode,
      busy: saving || dataBusy,
      runExport: runExport,
      runClearRecords: runClearRecords,
      updateState: updateState,
      updateError: updateError,
      updateBusy: updateBusy,
      updatePhase: updatePhase,
      onToggleUpdateAuto: onToggleUpdateAuto,
      onCheckUpdate: onCheckUpdate,
      onInstallUpdate: onInstallUpdate,
      onForceUpdate: onForceUpdate,
      onRollbackUpdate: onRollbackUpdate,
    }),
    alerts.length > 0 ? React.createElement('div', { className: 'bib-set-alerts' }, alerts) : null,
    resetDialog);
  } catch (err) {
    return React.createElement('div', { ref: settingsRootRef, className: 'bib-set-root bib-settings' },
      React.createElement('div', { className: 'bib-set-page-head' }, bibSetPageTitle()),
    pluginLanguagePicker(React, languageRuntime, setOpError),
      bibSetAlert({ tone: 'error', children: t('ui.couldNotDisplayInfoBar', { value: bibSetOperationMessage(err) }) }));
  }
}

// DSH 0.1.6-alpha.2 的 bundle 配置入口：显示在插件页里本 bundle 自己的页面上。
// 宿主通过 props.view 要两种形态：'summary' 是标题下那一行简介，'page' 是带自己保存控件的表单。
// 插件页是唯一配置入口，避免与全局设置页维护两份相同表单。
function InfoBarBundleConfig(props) {
  const view = props && props.view;
  if (view === 'summary') {
    // 摘要与插件描述同源（姊妹插件同款）：宿主已经渲染过标题，这里不再自造第二句描述。
    return React.createElement('span', null, t('meta.description'));
  }
  return React.createElement(InfoBarSettingsSection);
}

module.exports = {
  inject: ['slots', 'locale'],
  async apply(ctx) {
    // locale 是 inject 里声明过的服务，但宿主版本差异与测试替身都可能缺席/抛错；
    // 取值与注册全部 try/catch，失败就退回浏览器语言（见 createTranslator）。
    try { localeService = ctx.locale; } catch (err) { localeService = null; }
    if (!localeService && typeof ctx.get === 'function') {
      try { localeService = ctx.get('locale'); } catch (err) { localeService = null; }
    }
    if (localeService && typeof localeService.register === 'function') {
      try {
        const disposeDictionaries = localeService.register(LOCALE_NAMESPACE, LOCALES);
        if (typeof ctx.effect === 'function') ctx.effect(function () { return disposeDictionaries; }, 'info bar: dictionaries');
      } catch (err) { /* 注册失败：退回浏览器语言 */ }
    }
    t = createTranslator(localeService);
    ctx.effect(function () { return function () { languageRuntime.dispose(); }; }, 'dsh-bottom-info-bar: language preference');
    // slots 服务可能晚于 apply 就绪：优先 ctx.slots（inject 注入属性），回退 ctx.get('slots')；
    // 轮询等待采用渐进退避（300ms 起步，逐步增至 1s，总计约 45s），避免固定间隔在启动慢时过早放弃
    let slots = ctx.slots || ctx.get('slots');
    for (let i = 0; slots === undefined && i < 80; i++) {
      const delay = Math.min(300 + i * 20, 1000);
      // 无定时器的极简宿主里 scheduleTimeout 返回 null：不等直接重试，重试 80 次即放弃（不抛错）。
      await new Promise(function (resolve) { if (scheduleTimeout(resolve, delay) === null) resolve(); });
      slots = ctx.slots || ctx.get('slots');
    }
    if (slots === undefined) {
      console.warn('[dsh-bottom-info-bar] slots 服务 45s 内未就绪，信息栏未注册');
      return;
    }

    ctx.effect(function () {
      const disposeStyles = installStyles();
      return function () { disposeStyles(); };
    }, 'dsh-bottom-info-bar: styles');

    // ---------- 注册：一体替换（同 id 'stats'） ----------
    let density = 'full';
    let toggling = false; // 持久化期间禁止重复切换（只允许 full/compact 两态）
    let densityVersion = 0;
    let occupantDispose = null;
    const densityListeners = new Set();
    const densityBusyListeners = new Set();
    // Survives composer remounts, so returning to an already visited session
    // does not require even one paint of an intermediate state.
    function applyMode() {
      if (occupantDispose) { occupantDispose(); occupantDispose = null; }
      occupantDispose = slots.register(
        // 静态注册无动态沙箱的优先级自动分配：显式给低 priority（最低者渲染）以遮蔽原生 stats 栏（priority 0）
        { name: 'conversation.composer.dock', id: 'stats', priority: -1000, locale: LOCALE_NAMESPACE },
        function (slotProps) {
          return React.createElement(BottomInfoBar, Object.assign({}, slotProps, { density: density, onToggleDensity: onToggleDensity }));
        }
      );
    }

    // 不重新注册 slot：保留同一个 React 树，CSS 才能连续地收合/展开行高。
    function setDensity(next) {
      density = next;
      densityListeners.forEach(function (listener) { listener(next); });
    }

    function setDensitySaving(next) {
      toggling = next;
      densityBusyListeners.forEach(function (listener) { listener(next); });
    }

    function onToggleDensity() {
      if (toggling) return; // 切换进行中，忽略连点
      const requestVersion = ++densityVersion;
      setDensitySaving(true);
      const previous = density;
      const next = density === 'full' ? 'compact' : 'full';
      // 交互反馈不等网络；写入失败才回退，避免慢网络让点击看似没有生效。
      setDensity(next);
      rpc('setInfoDensity', { density: next }).then(function () {
        if (requestVersion === densityVersion) setDensitySaving(false);
      }).catch(function (err) {
        if (requestVersion !== densityVersion) return;
        setDensitySaving(false);
        if (density === next) setDensity(previous);
        console.error('Bottom Info Bar 切换信息密度失败', err);
      });
    }

    slots.inject('conversation.composer.dock', function () {
      applyMode();
      return function () { if (occupantDispose) occupantDispose(); };
    });

    // 插件配置页与信息栏同一 bundle/生命周期；样式在插件页打开时复用。
    ctx.effect(function () {
      return bibSetInstallStyles();
    }, 'dsh-bottom-info-bar: plugin config styles');
    // Bundle 自己的配置页，键为本 bundle 的包名。卸载时随 slots.inject 一起撤销。
    slots.inject('plugins.bundle.config', function () {
      return slots.register(
        // `plugins.bundle.config` is a keyed slot. DSH validates `key` (the
        // bundle package name), not the list-slot `id` field; using `id` makes
        // this entire web entry fail during boot.
        { name: 'plugins.bundle.config', key: 'dsh-bottom-info-bar', locale: LOCALE_NAMESPACE, label: function () { return t('meta.title'); } },
        InfoBarBundleConfig);
    });

    const initialDensityVersion = densityVersion;
    try {
      const cfg = await rpc('getConfig');
      // 用户已经作出新选择时，绝不让启动阶段的旧配置覆盖它。
      if (initialDensityVersion === densityVersion && cfg && (cfg.infoDensity === 'full' || cfg.infoDensity === 'compact') && cfg.infoDensity !== density) {
        setDensity(cfg.infoDensity);
      }
    } catch (err) { /* 默认完整 */ }

    // 字段配置与密度同型——启动拉取一次；插件页保存成功后派发 CustomEvent 即时同步；
    // load() 周期顺带校准（宿主常驻内存缓存，拉取即回）
    refreshFieldConfig();
    ctx.effect(function () {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined;
      const onConfigChanged = function () { refreshFieldConfig(); };
      document.addEventListener('dsh-bib-config-changed', onConfigChanged);
      return function () { document.removeEventListener('dsh-bib-config-changed', onConfigChanged); };
    }, 'dsh-bottom-info-bar: field config sync');

    // ---------- 组件 ----------
    function BottomInfoBar(props) {
      // 原生/会话投影（hooks 无条件调用）
      const statsProj = props.useProjection ? props.useProjection('sessionStats') : undefined;
      const usageProj = props.useProjection ? props.useProjection('tokenUsage') : undefined;
      // DSH 0.1.6-alpha.2 原生上下文圆环的同一对投影：插件接管后由这里读数。
      // 键缺席时快照是 undefined（不是缺面），因此与原生一样"没数据就不渲染"。
      const pressureProj = props.useProjection ? props.useProjection('contextPressure') : undefined;
      const breakdownProj = props.useProjection ? props.useProjection('contextBreakdown') : undefined;

      const [state, setState] = React.useState({
        loading: true, selectionKey: '', balance: null, pricing: null, usage: null, billingMode: null, sub: null, billing: null,
        errors: { balance: null, pricing: null, usage: null, billingMode: null, sub: null, billing: null },
      });
      // 版本信息由 host 在启动时从 package.json 读取；无论是否有新版，都用于服务商/模型 hover 展示。
      const [, setLanguageRevision] = React.useState(0);
      React.useEffect(function () {
        return languageRuntime.subscribe(function () { setLanguageRevision(function (value) { return value + 1; }); });
      }, []);
      const [updateInfo, setUpdateInfo] = React.useState(null);
      const [now, setNow] = React.useState(Date.now());
      // This state is owned by DSH's per-session model selector, not by the
      // process-wide default for newly-created Agents.
      const [sessionModel, setSessionModel] = React.useState(null);
      const [displayDensity, setDisplayDensity] = React.useState(props.density);
      const [isDensitySaving, setIsDensitySaving] = React.useState(toggling);

      // 外层持有持久化后的密度；组件只订阅数值变化，避免 slot 卸载重建打断动画。
      React.useEffect(function () {
        densityListeners.add(setDisplayDensity);
        densityBusyListeners.add(setIsDensitySaving);
        // 订阅前后没有异步间隙：立即回读，避免首次 effect 建立前的更新丢失。
        setDisplayDensity(density);
        setIsDensitySaving(toggling);
        return function () {
          densityListeners.delete(setDisplayDensity);
          densityBusyListeners.delete(setIsDensitySaving);
        };
      }, []);

      // 字段配置订阅——插件页保存（CustomEvent）或周期校准更新配置时重渲染。
      // 配置本体存模块级单例，组件只记版本号；订阅建立时立即回读避免首帧用过期配置。
      // 已见配置版本：订阅回调把最新版本号写进来，值变化才重渲染 + 重跑下面的轮询 effect。
      // 相同版本号 set 进来时 React 按值比对直接 bail out；这个值只在下面轮询 effect 的
      // 依赖数组里消费，不需要额外的 void 压住未使用检查。
      const [fieldConfigTick, setFieldConfigTick] = React.useState(fieldConfigVersion);
      React.useEffect(function () {
        const listener = function () { setFieldConfigTick(fieldConfigVersion); };
        fieldConfigListeners.add(listener);
        setFieldConfigTick(fieldConfigVersion);
        return function () { fieldConfigListeners.delete(listener); };
      }, []);

      // 当前会话 ID 多路获取：slotProps 标准 kit → session 快照 → 运行时 sessions 服务
      // （DSH 各版本注入方式不同，任一路可用即拿到真实会话 ID，避免回退到上一会话的账）
      const propsRef = React.useRef(props);
      propsRef.current = props;
      // 完整模式的原生统计行容器（.bi-density-extra）：它的 CSS 高度由 --bi-extra-h 决定，
      // 而该变量在下面的 layout effect 里按「原生行自己的高度」实测写入。
      const extraRowRef = React.useRef(null);
      const resolveSessionId = React.useCallback(function () {
        const p = propsRef.current;
        try {
          if (p.sessionId) return p.sessionId;
          if (p.session && p.session.sessionId) return p.session.sessionId;
          const sessions = ctx.get ? ctx.get('sessions') : null;
          const cur = sessions && sessions.list && sessions.list.getSnapshot().current;
          if (cur) return cur;
        } catch (e) { /* 拿不到则返回空串，host 端对空串返回 null（显示 ¥0.000） */ }
        return '';
      }, []);
      const sessionId = resolveSessionId();

      // Subscribe to the exact store the native model seat uses.  A session
      // activation or a successful model switch publishes here immediately;
      // no polling and no host HTTP request sit on the display path.
      React.useEffect(function () {
        let stop = null;
        let active = true;
        setSessionModel(null);
        if (!sessionId) return function () {};
        try {
          let directories = null;
          try { directories = ctx.get ? ctx.get('modelDirectories') : null; } catch (err) { /* property form below */ }
          // cordis 4 的 Context 是 Proxy：读取未 provide 的属性会抛 "cannot get property
          // ... without inject"，所以属性兜底必须自带 try/catch，不能裸取（Issue #67 同类）。
          if (!directories) {
            try { directories = ctx.modelDirectories || null; } catch (err) { /* 该可选服务未提供：保持未知态 */ }
          }
          if (!directories || typeof directories.directoryFor !== 'function') {
            return function () {};
          }
          const directory = directories.directoryFor(sessionId);
          const publish = function () {
            if (!active || !directory.store || typeof directory.store.getSnapshot !== 'function') return;
            const snapshot = directory.store.getSnapshot();
            const selected = snapshot && snapshot.current;
            if (!selected || typeof selected.provider !== 'string' || typeof selected.model !== 'string'
                || selected.provider.trim().length === 0 || selected.model.trim().length === 0) {
              setSessionModel(null);
              return;
            }
            const group = Array.isArray(snapshot.groups) ? snapshot.groups.find(function (g) { return g && g.id === selected.provider; }) : null;
            const model = group && Array.isArray(group.models) ? group.models.find(function (m) { return m && m.id === selected.model; }) : null;
            const inputModalities = model && Array.isArray(model.inputModalities) ? model.inputModalities : null;
            const value = {
              sessionId: sessionId,
              provider: selected.provider,
              model: selected.model,
              providerDisplay: group && typeof group.name === 'string' ? group.name : selected.provider,
              modelDisplay: model && typeof model.name === 'string' ? model.name : selected.model,
              // 某些较新的 DSH 目录只提供身份与名称；能力字段缺失时交给 host
              // 的 resolveModelInfo 查询，不能把缺失当成“不支持图像”。
              acceptsImageInput: inputModalities === null ? null : inputModalities.indexOf('image') !== -1,
            };
            setSessionModel(value);
          };
          publish();
          // The model picker normally loads this directory for itself.  The
          // info bar must also be able to identify a fresh session on its own;
          // otherwise the first render could stay pending until the picker is opened.
          if (typeof directory.load === 'function') {
            Promise.resolve(directory.load()).then(publish, function () { /* keep pending; the next DSH update retries */ });
          }
          if (directory.store && typeof directory.store.subscribe === 'function') stop = directory.store.subscribe(publish);
        } catch (err) { /* no current directory: keep the display in the unknown state */ }
        return function () { active = false; if (typeof stop === 'function') stop(); };
      }, [sessionId]);

      // 组件生命周期 AbortSignal：卸载时中止所有在途 RPC（配合 rpc 20s 超时，双保险防旧响应写 state）
      const abortRef = React.useRef(null);
      React.useEffect(function () {
        const controller = new AbortController();
        abortRef.current = controller;
        return function () { controller.abort(); };
      }, []);

      const loadVersionRef = React.useRef(0);
      const lastSelectionKeyRef = React.useRef('');
      const activeSessionModel = sessionModel && sessionModel.sessionId === sessionId ? sessionModel : null;
      const load = React.useCallback(function (selection) {
        // 周期顺带校准字段配置（宿主内存缓存，即回；插件页变更另有 CustomEvent 即时通道）
        refreshFieldConfig();
        const requestVersion = ++loadVersionRef.current;
        const activeSelection = selection || activeSessionModel;
        const selectionArgs = activeSelection ? { selection: { provider: activeSelection.provider, model: activeSelection.model } } : {};
        const balanceArgs = activeSelection
          ? { selection: { provider: activeSelection.provider, model: activeSelection.model } }
          : {};
        // 首启和切换模型后的第一次请求强制重查，之后的 30s 轮询走缓存节奏。
        // 这样切换回一个很久没用的服务商时不会等宿主下一轮 60s 定时器。
        const selectionKey = activeSelection ? activeSelection.provider + '\u0000' + activeSelection.model : '';
        const selectionChanged = selectionKey !== lastSelectionKeyRef.current;
        lastSelectionKeyRef.current = selectionKey;
        const force = selectionChanged || Date.now() - BOOT_AT < FORCE_REFRESH_WINDOW_MS;
        if (force) { selectionArgs.force = true; }
        const signal = abortRef.current ? abortRef.current.signal : null;
        // 逐接口容错：allSettled 等全部 settle（最坏 20s 超时兜底），任一失败只降级该端点，
        // 不拖垮其他成功数据；合并逻辑在 mergeLoadResults（失败端点保留旧值 + 记录错误）
        Promise.allSettled([
          rpc('getBalanceSnapshot', Object.assign(balanceArgs, force ? { force: true } : {}), signal),
          rpc('getPricing', selectionArgs, signal),
          rpc('getUsageSummary', Object.assign({ sessionId: sessionId }, selectionArgs), signal),
          rpc('getBillingMode', selectionArgs, signal),
          rpc('getSubscriptionSnapshot', selectionArgs, signal),
          rpc('getBillingStatus', selectionArgs, signal),
        ]).then(function (results) {
          // Do not allow a late A response to overwrite newly active B.
          if ((signal && signal.aborted) || requestVersion !== loadVersionRef.current) return;
          setState(function (s) { return mergeLoadResults(s, results, selectionKey); });
        });
      }, [resolveSessionId, activeSessionModel, sessionId]);

      React.useEffect(function () {
        load();
        const id = scheduleInterval(load, 30000);
        return function () { cancelInterval(id); };
      }, [load]);

      React.useEffect(function () {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined;
        const onLedgerChanged = function () { load(activeSessionModel || undefined); };
        document.addEventListener(BIB_LEDGER_EVENT, onLedgerChanged);
        return function () { document.removeEventListener(BIB_LEDGER_EVENT, onLedgerChanged); };
      }, [load, activeSessionModel]);

      // 版本信息：打开页面读一次，之后每 60 秒、以及页面重新可见/窗口重新获得焦点时重读。
      // 这样本地副本更新完（git pull + 重建，或 dsh plugin add …@latest）之后，红色提醒会自己消失，
      // 不必等用户刷新页面或重启 dsh web —— 2026-09-24 用户报的「更新完还显示提醒」就出在这里。
      // 每次读的都是本地 host 接口，NPM 只在 host 侧按 TTL 重查，这里不轮询 NPM。
       React.useEffect(function () {
         let active = true;
         const readUpdateInfo = function () {
           rpc('getUpdateInfo').then(function (info) {
             if (active && info && typeof info.current === 'string') setUpdateInfo(info);
           }).catch(function () { /* 版本检查失败静默，不影响信息栏 */ });
         };
         readUpdateInfo();
         const timer = scheduleInterval(readUpdateInfo, UPDATE_INFO_REFRESH_MS);
         if (typeof document === 'undefined' || typeof document.addEventListener !== 'function'
             || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
           return function () { active = false; cancelInterval(timer); };
         }
         const onVisible = function () {
           if (document.visibilityState === 'visible') readUpdateInfo();
         };
         document.addEventListener('visibilitychange', onVisible);
         window.addEventListener('focus', onVisible);
         return function () {
           active = false;
           cancelInterval(timer);
           document.removeEventListener('visibilitychange', onVisible);
           window.removeEventListener('focus', onVisible);
         };
       }, []);

      // 会话统计变化（回复中 turns/steps/tokens 增长，回复完成时停止）→ 防抖后即时刷新花费，
      // 不等下一个 30s 轮询：用户回复一结束即可看到真实金额
      React.useEffect(function () {
        if (!statsProj) return undefined;
        const timer = scheduleTimeout(load, 800);
        return function () { cancelTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [load,
        statsProj && statsProj.turns,
        statsProj && statsProj.steps,
        statsProj && statsProj.decodeTokens,
      ]);

      React.useEffect(function () {
        function needsTick() {
          return fieldVisible('mainTime') || fieldVisible('worldTime') || fieldVisible('countdown') || fieldVisible('resetCountdown');
        }
        if (!needsTick()) return undefined;
        let id = null;
        function start() {
          if (id !== null) return;
          id = scheduleInterval(function () { setNow(Date.now()); }, 1000);
        }
        function stop() {
          if (id !== null) { cancelInterval(id); id = null; }
        }
        start();
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
          return function () { stop(); };
        }
        function onVisibility() {
          if (document.hidden) stop();
          else if (needsTick()) start();
        }
        document.addEventListener('visibilitychange', onVisibility);
        const cfgListener = function () {
          if (needsTick()) start();
          else stop();
        };
        fieldConfigListeners.add(cfgListener);
        return function () {
          stop();
          document.removeEventListener('visibilitychange', onVisibility);
          fieldConfigListeners.delete(cfgListener);
        };
      }, [fieldConfigTick]);

      // While background RPCs catch up, render the newly activated session's
      // model and suppress details from the prior session rather than showing
      // a convincing but wrong provider/model combination.
      const waitForSessionModel = !!sessionId && !activeSessionModel;
      const activeSelectionKey = activeSessionModel ? activeSessionModel.provider + '\u0000' + activeSessionModel.model : '';
      // A new session/model is published before its six RPC responses return.
      // Mask every selection-scoped payload during that gap so the old account
      // can never appear beside the new provider/model, even for one render.
      const stateMatchesActiveSelection = !activeSessionModel || state.selectionKey === activeSelectionKey;
      const renderedState = stateMatchesActiveSelection ? state : {
        loading: true,
        selectionKey: activeSelectionKey,
        balance: null,
        pricing: null,
        usage: null,
        billingMode: null,
        sub: null,
        billing: null,
        errors: { balance: null, pricing: null, usage: null, billingMode: null, sub: null, billing: null },
      };
      const visiblePricing = activeSessionModel && (!state.pricing
        || state.pricing.provider !== activeSessionModel.provider || state.pricing.model !== activeSessionModel.model)
        ? { provider: activeSessionModel.provider, model: activeSessionModel.model, providerDisplay: activeSessionModel.providerDisplay, modelDisplay: activeSessionModel.modelDisplay, mode: 'unknown', acceptsImageInput: activeSessionModel.acceptsImageInput }
        : (waitForSessionModel ? null : state.pricing);
      const visibleBillingMode = activeSessionModel && (!state.billingMode
        || state.billingMode.provider !== activeSessionModel.provider || state.billingMode.model !== activeSessionModel.model)
        ? { provider: activeSessionModel.provider, model: activeSessionModel.model, mode: BILLING_PROVIDERS.indexOf(activeSessionModel.provider) >= 0 ? 'billing' : (SUBSCRIPTION_PROVIDERS.indexOf(activeSessionModel.provider) >= 0 ? 'subscription' : 'balance') }
        : (waitForSessionModel ? null : state.billingMode);
      // ---- 与原生一致格式工具（走模块级 contextTokenText，K/M 经字典，可随宿主语言切换） ----
      function formatTokens(n) {
        return contextTokenText(n);
      }
      function formatDuration(ms) {
        const s = ms / 1e3;
        if (s < 60) return Math.round(s * 10) / 10 + 's';
        const whole = Math.round(s);
        const sec = whole % 60;
        return Math.floor(whole / 60) + 'm' + pad2(sec) + 's';
      }
      function formatTps(tps) {
        const clamped = Math.max(0, tps);
        return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
      }
      function billedInput(usage) {
        return (usage.uncachedInputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
      }
      function fmt(n, digits) {
        if (n == null || isNaN(n)) return '—';
        return n.toFixed(digits == null ? 2 : digits);
      }
      function fmtCountdown(ms) {
        if (ms == null || ms <= 0) return '00:00';
        const totalSec = Math.floor(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        return h > 0 ? h + 'h' + pad2(m) + 'm' : pad2(m) + ':' + pad2(s);
      }
      // 订阅窗口重置时刻（本地时区，hover 浮窗用）
      function formatDateTime(ms) {
        const d = new Date(ms);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      }
      // 订阅窗口重置倒计时（天级格式）：≥1 天 → '1d 21h'；≥1 小时 → '3h 12m'；<1 小时 → '12:34'
      function fmtResetCountdown(ms) {
        if (ms == null || ms <= 0) return '00:00';
        const totalSec = Math.floor(ms / 1000);
        const d = Math.floor(totalSec / 86400);
        const h = Math.floor((totalSec % 86400) / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        if (d > 0) return d + 'd ' + h + 'h';
        if (h > 0) return h + 'h ' + pad2(m) + 'm';
        return pad2(m) + ':' + pad2(totalSec % 60);
      }

      // 订阅窗口剩余百分比（剩余 = 100 - 已用；钳制 ≥0 防接口异常值）
      function remainingPercent(w) {
        return Math.max(0, 100 - w.usedPercent);
      }
      // 订阅窗口紧凑行标签（5小时 → '5h'，周 → '周'，月 → '月'）；hover 明细仍用完整标签
      function quotaWindowLabel(window) {
        const meta = windowMeta(window.key);
        return meta ? t(meta.labelKey) : window.label;
      }
      function compactWindowLabel(key) {
        const meta = windowMeta(key);
        if (meta && meta.short) return meta.short;
        if (meta) return t(meta.labelKey);
        return t('ui.window');
      }
      // v1.16 订阅窗口百分比方向：remaining（默认）= 显示剩余；used = 显示已用（= 100 - 剩余，钳制 [0,100]）。
      // 只改「显示哪个数」，不改告警语义——告警始终等价于「剩余 ≤ 20%」。
      function quotaWindowPercent(w, mode) {
        if (mode !== 'used') return remainingPercent(w);
        const remaining = remainingPercent(w);
        return Number.isFinite(remaining) ? Math.max(0, Math.min(100, 100 - remaining)) : 0;
      }
      // 窗口明细（hover）文案：方向决定键名，两边参数名严格一致（label/value/usedPercent），
      // value 恒为剩余、usedPercent 恒为已用，避免两个方向下含义漂移。
      function quotaWindowDetail(w, mode) {
        return mode === 'used'
          ? t('ui.windowUsedRemaining', { label: quotaWindowLabel(w), value: remainingPercent(w), usedPercent: w.usedPercent })
          : t('ui.windowRemainingUsed', { label: quotaWindowLabel(w), value: remainingPercent(w), usedPercent: w.usedPercent });
      }

      // 数字统一加粗（仅数字本身）
      function num(t, extraClass) {
        return React.createElement('b', { className: 'bi-num' + (extraClass ? ' ' + extraClass : '') }, String(t));
      }

      // 统一数值语法：标签保持常规，数值与紧随的单位/货币符号作为一个加粗的数据令牌。
      function metric(label, value, extraClass) {
        return React.createElement('span', { className: 'bi-metric', 'data-metric-text': label + ' ' + value },
          React.createElement('span', { className: 'bi-metric-label' }, label),
          React.createElement('span', { className: 'bi-metric-data' }, num(value, extraClass)));
      }

      // 仅在 DSH 模型目录明确声明 inputModalities 包含 image 时，将“完整模型名 视觉”合并为一个椭圆。
      function modelLabelWithCapability(pr, modelLabel) {
        if (pr && pr.acceptsImageInput === null) {
          return React.createElement('span', {
            className: 'bi-model-capability-pending bi-model-name',
            title: t('ui.modelCapabilityPending')
          }, modelLabel);
        }
        if (!pr || pr.acceptsImageInput !== true) return React.createElement('span', { className: 'bi-model-name' }, modelLabel);
        return React.createElement('span', { className: 'bi-vision', title: t('ui.supportsImageInput') },
          React.createElement('span', { className: 'bi-vision-model' }, modelLabel),
          React.createElement('span', { className: 'bi-vision-kind' }, t('ui.vision')));
      }

      function modelSeparator() {
        return React.createElement('span', { className: 'bi-model-dot', 'aria-hidden': 'true' }, '·');
      }

      function modelDetail(pr, modelName) {
        return React.createElement('span', { className: 'bi-model-detail' },
          modelSeparator(), modelLabelWithCapability(pr, modelName));
      }

      // 参考图的视觉标签将服务商显示在椭圆外；仅移除重复的服务商前缀，不截断真实模型名。
      function modelLabelWithoutProvider(modelLabel, providerLabel) {
        if (modelLabel.toLowerCase().indexOf(providerLabel.toLowerCase()) !== 0) return modelLabel;
        const suffix = modelLabel.slice(providerLabel.length);
        // 只有目录以分隔符明确写成“服务商 + 模型”时才去重；例如 OpenAICode 不是 OpenAI 的重复前缀。
        if (!/^[\s·._/-]+/.test(suffix)) return modelLabel;
        return suffix.replace(/^[\s·._/-]+/, '') || modelLabel;
      }

      // 服务商 + 具体模型（两种模式共用；纯显示，不拦截点击——点击冒泡到整条信息栏触发密度切换；hover 展示定价模式）
      // 模型目录名可能重复服务商前缀（如 DeepSeek V4 Flash）；始终拆分为“DeepSeek · V4 Flash”，
      // 既保留服务商信息，也不让模型名重复前缀。
      function providerGroup() {
        const pr = visiblePricing;
        const provLabel = (pr && pr.providerDisplay) ? pr.providerDisplay : t('ui.unknown');
        const modelLabel = (pr && pr.modelDisplay) ? pr.modelDisplay
          : (pr && pr.model ? pr.model : t('ui.unknownModel'));
        const modelName = modelLabelWithoutProvider(modelLabel, provLabel);
        const versionLine = updateInfo && typeof updateInfo.current === 'string'
          ? t('ui.pluginVersion', { current: updateInfo.current }) : '';
        const provTitle = t('ui.provider', { provLabel: provLabel, modelLabel: modelLabel })
          + (pr && pr.mode === 'peak-valley' ? t('ui.pricingPeakOffPeakBeijing')
            : (pr && pr.mode === 'flat' ? t('ui.pricingFixed') : t('ui.pricingNotListedUsingDefaults')))
          + versionLine;
        return React.createElement('span', { key: 'prov', className: 'bi-model-group', title: provTitle },
          React.createElement('b', { className: 'bi-model-provider' }, provLabel),
          modelDetail(pr, modelName));
      }

      // 订阅服务名（订阅制模式下"服务商"指订阅服务本身，不是模型厂商）
      // Codex 与 ChatGPT 已合并：实际 provider openai-codex / chatgpt 均显示 ChatGPT；codex 保持 Codex
      // v1.6 T7：新增 zai/zai-coding-cn → '智谱'；v1.7：小米 Token Plan → '小米 MiMo'
      function subscriptionServiceName(provider) {
        if (provider === 'chatgpt' || provider === 'openai-codex') return 'ChatGPT';
        if (provider === 'codex') return 'Codex';
        if (provider === 'opencode-go' || provider === 'opencode') return 'OpenCode Go';
        if (provider === 'zai' || provider === 'zai-coding-cn') return t('ui.zhipu');
        if (provider === 'xiaomi-token-plan-cn' || provider === 'xiaomi-token-plan-sgp' || provider === 'xiaomi-token-plan-ams') return t('ui.xiaomiMiMo');
        // v1.16：MiniMax Token Plan（minimax = Global / minimax-cn = CN）；品牌名不翻译，走字典键保持一致来源
        if (provider === 'minimax' || provider === 'minimax-cn') return t('ui.minimax');
        if (provider === 'command' || provider === 'command-code') return t('ui.commandCode');
        return t('ui.subscription');
      }

      // 账单型服务名（v1.7：云账单 provider 显示品牌名，未知保持兜底）
      function billingServiceName(provider) {
        if (provider === 'together') return 'Together';
        if (provider === 'fireworks') return 'Fireworks';
        if (provider === 'amazon-bedrock') return 'AWS Bedrock';
        if (provider === 'cloudflare-ai-gateway' || provider === 'cloudflare-workers-ai') return 'Cloudflare';
        if (provider === 'huggingface') return 'Hugging Face';
        return t('ui.cloudBilling');
      }

      // 本地时区 YYYY-MM-DD（订阅到期日）
      function formatDate(ms) {
        if (ms == null || isNaN(ms)) return '—';
        const d = new Date(ms);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
      }

      // 订阅制模型组：订阅服务名 · 具体模型（如 `OpenCode Go · V4 Flash`、`ChatGPT · GPT 5.6 Codex`）
      // 模型位永远显示模型。2026-09-26 修正了 v1.7 FR-8 留下的一个错位：当年只要 id_token 里有
      // 已识别的套餐档位，模型位就被档位顶掉（`ChatGPT · Plus`）—— 于是用户换了模型，信息栏
      // 纹丝不动，看起来像「不显示模型」。档位不是模型，两件事不共用同一个位置；
      // 档位继续留在 hover 里（planLine）。用户报的就是这一条。
      function subscriptionProviderGroup() {
        const pr = visiblePricing;
        const serviceName = subscriptionServiceName(visibleBillingMode && visibleBillingMode.provider);
        const subSnapshot = renderedState.sub;
        const modelLabel = (pr && pr.modelDisplay) ? pr.modelDisplay
          : (pr && pr.model ? pr.model : t('ui.unknownModel'));
        const modelName = modelLabelWithoutProvider(modelLabel, serviceName);
        const versionLine = updateInfo && typeof updateInfo.current === 'string'
          ? t('ui.pluginVersion', { current: updateInfo.current }) : '';
        const planLine = subSnapshot && subSnapshot.plan ? t('ui.plan', { plan: hostText(subSnapshot.plan) }) : '';
        const expiryLine = subSnapshot && subSnapshot.expiryAt ? t('ui.expiresLocalTime', { value: formatDate(subSnapshot.expiryAt) }) : '';
        const title = t('ui.subscriptionServiceModel', { serviceName: serviceName, rawModelLabel: modelLabel, planLine: planLine, expiryLine: expiryLine, versionLine: versionLine });
        return React.createElement('span', { key: 'subprov', className: 'bi-model-group', title: title },
          React.createElement('b', { className: 'bi-model-provider' }, serviceName),
          modelDetail(pr, modelName),
        );
      }

      // 字段包装：带 data-field 与（可选）颜色变量的容器 span，供 CSS 按字段着色（未自定义时变量不存在，零回归）
      function fieldSpan(id, key, children) {
        return React.createElement('span', { key: key, 'data-field': id, style: fieldStyle(id) }, children);
      }

      // 自定义文本：默认位于服务商/模型左侧；为空时不渲染（开关可保持开启，空白无占位）
      function pushCustomText(groups) {
        if (!fieldVisible('customText')) return;
        const txt = fieldConfig.customText;
        if (typeof txt !== 'string' || txt.trim().length === 0) return;
        const title = txt.trim();
        groups.push(fieldSpan('customText', 'ct', React.createElement('span', { title: title }, title)));
      }
      // 时间：主/世界各自独立时区，显示统一用通用格式
      function pushTimeGroups(groups) {
        const zones = fieldConfig.timeZones;
        if (fieldVisible('mainTime')) {
          const txt = formatClock(now, zones && zones.main);
          if (txt) {
            const zoneLabel = zones && zones.main ? zones.main : '';
            groups.push(fieldSpan('mainTime', 'mt', React.createElement('span', { title: zoneLabel ? (t('ui.mainTime') + ' (' + zoneLabel + ')') : t('ui.mainTime') }, metric(t('ui.mainTime'), txt))));
          }
        }
        if (fieldVisible('worldTime')) {
          const txt = formatClock(now, zones && zones.world);
          if (txt) {
            const zoneLabel = zones && zones.world ? zones.world : '';
            groups.push(fieldSpan('worldTime', 'wt', React.createElement('span', { title: zoneLabel ? (t('ui.worldTime') + ' (' + zoneLabel + ')') : t('ui.worldTime') }, metric(t('ui.worldTime'), txt))));
          }
        }
      }

      // 主行开头的「身份区」：自定义文字 → 服务锚点 → 主/世界时间。三种计费形态完全同型，
      // 共用这一个入口 —— 以前三处各抄一遍，还各带一个 `if (full)` 门控，同一个 bug 抄了三遍。
      // 门控只有「锚点字段是否存在」一条；自定义文字与时间各自在自己的函数里判开关，与模式无关。
      function pushIdentityGroups(groups, anchorId, buildAnchor) {
        pushCustomText(groups);
        if (fieldVisible(anchorId)) {
          groups.push(React.cloneElement(buildAnchor(), { 'data-field': anchorId, style: fieldStyle(anchorId) }));
        }
        pushTimeGroups(groups);
      }

      // 「需要你去设置里做点什么」这一类提示：API Key 未配置、内置账号未登录。
      // 两者共用 noKeyHint 这个配置引导槽位，但文案按 error.code 选 —— 靠 kind 猜会把
      // 「账号没登录」说成「未配置 API_KEY」，那是错误的指引。
      function configHintFor(error) {
        if (!error) return null;
        if (error.code === 'balance.account-signed-out') {
          return { title: t('ui.accountSignedOutHow'), text: t('ui.accountSignedOut') };
        }
        if (error.kind !== 'no-key') return null;
        // 凭据名优先取宿主给的结构化 params（跨语言稳定），旧快照才退回从文案里剥前缀。
        const credName = (error.params && error.params.credential)
          ? String(error.params.credential)
          : (error.message ? String(hostText(error.message)).replace(/(?:未配置 |Not configured: )/, '') : 'API_KEY');
        return {
          title: t('ui.notConfiguredConfigureItIn', { credName: credName }),
          text: t('ui.notConfiguredSettingsModels', { credName: credName }),
        };
      }

      // ---- 余额制模式（v1.0.0 现状，完全不动）：服务商+模型 → 余额 → 时段 → 倒计时 → 本会话花费 ----
      // v1.9.0 PR2：每个渲染片段按设置过滤（fieldVisible）；隐藏不占位，组间分隔符由组装层自动收合
      function pushBalanceGroups(groups, trailingErrorGroups) {
        const bal = renderedState.balance;
        const errors = renderedState.errors || {};
        if (bal && bal.selectionPending) return;
        const alertActive = !!(bal && bal.alert && bal.alert.active);
        const configHint = configHintFor(bal && bal.error);
        pushIdentityGroups(groups, 'anchorGroup', providerGroup);

        // v1.6 T7：未适配账户渲染"未适配"弱提示
        if (bal && bal.unmapped) {
          if (fieldVisible('unmapped')) {
            trailingErrorGroups.push(fieldSpan('unmapped', 'unmapped',
              React.createElement('span', { className: 'bi-muted', title: t('ui.balanceLookupIsNotYet') }, t('ui.notSupported'))));
          }
        }
        // 已纳入兼容性基线、但服务商没有公开的账户余额/配额接口：保留服务商、模型和
        // 本地 token 账本，不把“没有公开接口”误说成“插件未适配”。
        else if (bal && bal.accountDataUnavailable) {
          if (fieldVisible('unmapped')) {
            trailingErrorGroups.push(fieldSpan('unmapped', 'account-data-unavailable',
              React.createElement('span', { className: 'bi-muted', title: t('ui.accountDataUnavailableDetail') }, t('ui.accountDataUnavailable'))));
          }
        }
        // 配置引导（未配置 API Key / 内置账号未登录）：与数据展示互斥，占 noKeyHint 槽位
        else if (configHint) {
          if (fieldVisible('noKeyHint')) {
            trailingErrorGroups.push(fieldSpan('noKeyHint', 'nokey',
              React.createElement('span', { className: 'bi-err', title: configHint.title }, configHint.text)));
          }
        } else if (bal && bal.data) {
          const symbol = bal.currency === 'USD' ? '$' : '¥';
          const balTitle = bal.estimate
            ? t('ui.estimatedBalance', { symbol: symbol, value: fmt(bal.data.total) })
            : t('ui.balance', { symbol: symbol, value: fmt(bal.data.total) });
          // 悬停明细：赠金为正时在总计下面补「充值余额 / 赠金余额」两行（2026-10-07 拍板）。
          // 原生 title 里的换行符由浏览器渲染成多行；不展开时与老版本逐字一致。
          const balHoverTitle = balanceHoverLines(balTitle, bal.data, symbol, t, fmt).join('\n');
          if (fieldVisible('balance')) {
            groups.push(fieldSpan('balance', 'bal', React.createElement('span', { title: balHoverTitle },
              metric(t('ui.balance.pushBalanceGroups'), symbol + fmt(bal.data.total), alertActive ? 'bi-alert-num' : ''),
              alertActive ? React.createElement('span', { className: 'bi-low-status' }, t('ui.low')) : null,
              bal.estimate ? React.createElement('span', { className: 'bi-muted' }, t('ui.estimated')) : null,
            )));
          }
          // host 快照失败（bal.error）或本次 RPC 失败（errors.balance）→ 均保留旧数据 + 降级标记
          if (fieldVisible('balanceError') && (bal.error || errors.balance)) {
            trailingErrorGroups.push(fieldSpan('balanceError', 'balerr',
              React.createElement('span', { className: 'bi-stale', title: t('ui.balanceIsTemporarilyUnavailableShowing') }, t('ui.refreshFailed'))));
          }
        } else if (bal && bal.error) {
          if (fieldVisible('balanceError')) {
            trailingErrorGroups.push(fieldSpan('balanceError', 'berr',
              React.createElement('span', { className: 'bi-err', title: t('ui.couldNotLoadBalanceCheck') }, t('ui.balanceUnavailable'))));
          }
        } else if (errors.balance) {
          // 本次 RPC 失败且无旧数据：只降级余额块，其余端点数据照常渲染
          if (fieldVisible('balanceError')) {
            trailingErrorGroups.push(fieldSpan('balanceError', 'berr',
              React.createElement('span', { className: 'bi-err', title: t('ui.couldNotLoadBalanceCheck') }, t('ui.balanceUnavailable'))));
          }
        }

        // 时段：仅峰谷价服务商显示"高峰价/空闲价"（flat/unknown 服务商不显示；hover 展示具体价格）
        const pr = visiblePricing;
        if (pr && pr.mode === 'peak-valley' && fieldVisible('period')) {
          const peakNow = pr.period === 'peak';
          const p = pr.prices || {};
          const periodTitle = t('ui.beijingTime') + (peakNow ? t('ui.peakPrice') : t('ui.offPeakPrice')) + t('ui.input') + (p.inputCacheMiss != null ? p.inputCacheMiss : '?')
            + t('ui.mCachedInput') + (p.inputCacheHit != null ? p.inputCacheHit : '?')
            + t('ui.mOutput') + (p.output != null ? p.output : '?') + '/M';
          groups.push(fieldSpan('period', 'period', React.createElement('span', { className: peakNow ? 'bi-peak' : 'bi-offpeak', title: periodTitle },
            peakNow ? t('ui.peakPrice') : t('ui.offPeakPrice'))));
        }

        // 倒计时：仅峰谷价服务商显示"距高峰/距空闲"（hover 展示下次切换时刻；数字加粗）
        if (pr && pr.mode === 'peak-valley' && pr.nextSwitch && fieldVisible('countdown')) {
          const peakNow = pr.period === 'peak';
          const countdownTitle = t('ui.beijingTimeSwitchesTo', { atLabel: pr.nextSwitch.atLabel }) + (peakNow ? t('ui.offPeakPrice') : t('ui.peakPrice')) + t('ui.sentenceEnd');
          groups.push(fieldSpan('countdown', 'countdown', React.createElement('span', { title: countdownTitle },
            metric(t('ui.until') + (peakNow ? t('ui.offPeak') : t('ui.peak')), fmtCountdown(pr.nextSwitch.at - now)))));
        }

        // 本会话花费（公共小部件 pushSessionCost：只显示钱；hover 显示 今天/近一月/全部）
        // 始终显示：新会话/对话刚开始尚无记账时显示 ¥0.000，hover 仍可查看持久化的 今天/近一月/全部
        pushSessionCost(groups, trailingErrorGroups, !!(bal && bal.currency === 'USD'));
      }

      // 本会话花费块（余额制 与 订阅·充值余额 形态共用的小部件）：
      // 只显示钱；hover 浮窗显示 含子代理说明 + 今天 / 近一月 / 全部；金额数字加粗。
      // usdSymbol：账户币种为美元时，hover 汇总行用 $ 前缀（本会话单值仍按其真实计价币种）
      function pushSessionCost(groups, trailingErrorGroups, usdSymbol) {
        const usg = renderedState.usage;
        const errs = renderedState.errors || {};
        if (usg) {
          // 隐藏不占位（错误提示属于独立字段 usageError，两支互斥不受影响）
          if (fieldVisible('sessionCost')) {
            const cs = usg.currentSession;
            const costCNY = cs && cs.costs && cs.costs.CNY != null ? cs.costs.CNY : null;
            const costUSD = cs && cs.costs && cs.costs.USD != null ? cs.costs.USD : null;
            const symbol = usdSymbol ? '$' : '¥';
            const priced = costCNY != null || costUSD != null;
            const unpricedRecords = cs && cs.unpricedRecords ? cs.unpricedRecords : 0;
            // 有 token 但一条都没定价 → 绝不用 ¥0.000 冒充“没有花费”（审计 2026-10-05）：
            // 未收录模型只记账、不猜价，界面必须直说“暂不可计算”；部分未计价则前缀 ≈。
            const hasTokens = !!(cs && cs.tokens > 0);
            const costTxt = priced
              ? (unpricedRecords > 0 ? '≈' : '') + (costCNY != null ? '¥' + costCNY.toFixed(3) : '$' + costUSD.toFixed(3))
              : (hasTokens ? symbol + '—' : symbol + (0).toFixed(3));
            const today = usg.todaySpend != null ? t('ui.today', { symbol: symbol, value: fmt(usg.todaySpend, 3) }) : '';
            const month = usg.monthSpend != null ? t('ui.lastDays', { symbol: symbol, value: fmt(usg.monthSpend, 3) }) : '';
            const total = usg.totalSpend != null ? t('ui.allTime', { symbol: symbol, value: fmt(usg.totalSpend, 3) }) : '';
            const detail = [today, month, total].filter(function (s) { return s.length > 0; }).join(' · ');
            const costTitle = [t('ui.sessionIncludingSubagents', { costTxt: costTxt, value: detail ? '\n' + detail : '' })];
            if (!priced && hasTokens) costTitle.push(t('ui.pricingNotListedUsingDefaults'));
            else if (priced && unpricedRecords > 0) costTitle.push(t('ui.spendPartlyUnpriced'));
            groups.push(fieldSpan('sessionCost', 'convo', React.createElement('span', {
              title: costTitle.join('\n') },
              metric(t('ui.session'), costTxt))));
          }
        } else if (errs.usage && fieldVisible('usageError')) {
          trailingErrorGroups.push(fieldSpan('usageError', 'usageerr',
            React.createElement('span', { className: 'bi-err', title: t('ui.spendIsTemporarilyUnavailableChat') }, t('ui.spendUnavailable'))));
        }
      }

      // ---- 订阅制模式（互斥替换余额制版）：
      //      套餐额度型：订阅服务+模型 → 三窗口额度 → 距重置倒计时（余额/时段/花费/token 不显示）
      //      充值余额型（如智谱按量账户，windows 空且有 sub.balance）：服务商+模型 → 余额 → 本会话花费 ----
       function subscriptionFailureHint(error, source) {
         const kind = error && error.kind;
         const serviceName = subscriptionServiceName(source);
         const message = errorText(error);
         // HTTP 状态优先取宿主给的 params（结构化、跨语言稳定），退回从文案里解析（旧快照）。
         const statusMatch = message.match(/HTTP (\d{3})/);
         const status = error && error.params && error.params.status != null ? String(error.params.status) : (statusMatch ? statusMatch[1] : '');
         if (kind === 'no-key') return t('ui.noSignInCredentialsFound', { serviceName: serviceName });
         if (kind === 'auth' || status === '401') return t('ui.credentialsHaveExpiredPleaseReauthorize', { serviceName: serviceName });
         if (status === '403') return t('ui.deniedAccessReauthorizeOrTry', { serviceName: serviceName });
         if (status === '429') return t('ui.rateLimitReachedPleaseTry', { serviceName: serviceName });
         if (kind === 'timeout' || /timeout|timed out|abort/i.test(message)) return t('ui.timedOutCheckYourConnection', { serviceName: serviceName });
         if (kind === 'parse') return t('ui.returnedAnUnrecognizedResponsePlease', { serviceName: serviceName });
         return t('ui.isTemporarilyUnavailableCheckYour', { serviceName: serviceName });
       }

      function pushSubscriptionGroups(groups, trailingErrorGroups) {
        pushIdentityGroups(groups, 'subServiceGroup', subscriptionProviderGroup);
        const sub = renderedState.sub;
        const errors = renderedState.errors || {};
        // v1.7 FR-8：JWT 订阅卡——真实套餐到期日（纯本地解码；无登录态/解析失败不显示此处）
        if (sub && sub.planType && sub.expiryAt && fieldVisible('expiry')) {
          groups.push(fieldSpan('expiry', 'subexp', React.createElement('span', { title: t('ui.subscriptionExpiresLocalTime', { value: formatDate(sub.expiryAt) }) },
            metric(t('ui.expires'), formatDate(sub.expiryAt)))));
        }
        if (!sub) {
          if (errors.sub && fieldVisible('refreshFailure')) {
            // 本次 RPC 失败且无旧数据：显示失败信息而非永久"加载中…"
            trailingErrorGroups.push(fieldSpan('refreshFailure', 'suberr',
              React.createElement('span', { className: 'bi-stale', title: subscriptionFailureHint({ kind: 'exception', message: String(errors.sub) }, visibleBillingMode && visibleBillingMode.provider) }, t('ui.refreshFailed'))));
          }
          return;
        }
        const rawWindows = Array.isArray(sub.windows) ? sub.windows : [];
        // v1.9.0 PR2：逐窗口显隐过滤（5h/周/月各自独立开关），后续优先窗口/重置倒计时都基于过滤后的集合
        const windows = rawWindows.filter(function (w) {
          return w && typeof w.usedPercent === 'number' && windowFieldVisible(w.key);
        });
        const hasData = windows.length > 0;
        // 错误分支：无旧数据时给出明确引导 / 错误文案；有旧数据时走下方渲染并附"刷新失败"标记。
        // no-key（无令牌/缺 access_token）与 auth（令牌失效 401）→ 统一"未绑定/重新绑定"引导——
        // 令牌由独立插件 dsh-chatgpt-sub 维护，本插件只读令牌显示额度，不自行绑定/续期
        if (sub.error && !hasData) {
          if (fieldVisible('refreshFailure')) {
            trailingErrorGroups.push(fieldSpan('refreshFailure', 'substale',
              React.createElement('span', { className: 'bi-stale', title: subscriptionFailureHint(sub.error, sub.source || (visibleBillingMode && visibleBillingMode.provider)) }, t('ui.refreshFailed'))));
          }
          return;
        }
        // v1.8：充值余额模式——无额度窗口但有 balance 字段（如智谱普通 API 余额用户）
        // 显示"余额 ¥XX.XX"，与 Coding Plan 额度窗口互斥
        if (!hasData && typeof sub.balance === 'number' && isFinite(sub.balance)) {
          const isCreditsBalance = sub.balanceUnit === 'credits';
          const balanceValue = isCreditsBalance ? fmt(sub.balance, 2) : '¥' + fmt(sub.balance, 2);
          if (fieldVisible('subBalance')) {
            const titleLines = [t('ui.subscriptionSource', { value: subscriptionServiceName(visibleBillingMode && visibleBillingMode.provider) }) + (hostText(sub.plan) || (isCreditsBalance ? t('ui.commandCode') : t('ui.prepaidBalance'))) + ')',
              isCreditsBalance ? t('ui.availableCredits', { value: balanceValue }) : t('ui.availableBalance', { balTxt: balanceValue })];
            groups.push(fieldSpan('subBalance', 'subbal', React.createElement('span', { title: titleLines.join('\n') },
              metric(isCreditsBalance ? t('ui.remainingCredits') : t('ui.availableBalanceLabel'), balanceValue))));
          }
          // 充值余额用户按量付费，花销与余额同等重要 → 追加公共花费块（含子代理聚合）
          if (!isCreditsBalance) pushSessionCost(groups, trailingErrorGroups, false);
          // host 快照失败（sub.error）或本次 RPC 失败（errors.sub）→ 保留旧数据 + 降级标记
          if (fieldVisible('refreshFailure') && (sub.error || errors.sub)) {
            trailingErrorGroups.push(fieldSpan('refreshFailure', 'substale',
              React.createElement('span', { className: 'bi-stale', title: subscriptionFailureHint(sub.error || { kind: 'exception', message: String(errors.sub || '') }, sub.source || (visibleBillingMode && visibleBillingMode.provider)) }, t('ui.refreshFailed'))));
          }
          return;
        }
        // 窗口缺失（如 Codex 无 5 小时窗口）→ 跳过窗口组，不占位、不报错
        if (hasData) {
          // 重置倒计时挂在哪个窗口上？取"时间最短且有重置时刻"的那个（刷新最快，用户最需关注）：
          // 优先级：5小时 > 周 > 月（按窗口时长排序，而非已用百分比）。
          // 窗口组本身按各自的开关全部列出（见下），倒计时只可能挂一个窗口，故单独挑一个。
          const byPriority = function (a, b) {
            const ma = windowMeta(a.key);
            const mb = windowMeta(b.key);
            return (ma ? ma.priority : 99) - (mb ? mb.priority : 99);
          };
          const windowsWithReset = windows.filter(function (w) { return w.resetsAt; });
          // 有重置时刻的窗口优先（倒计时才有意义）；全都没有时退回按时长取最短窗口 ——
          // 否则 resetsAt 缺失会让整组额度静默丢失倒计时（接口不返回 nextResetTime 时）
          const resetWindow = (windowsWithReset.length > 0 ? windowsWithReset : windows)
            .slice().sort(byPriority)[0] || null;

          // 窗口组：开着的窗口全部列出，简洁模式与完整模式一致（2026-09-26 用户拍板：模式不参与字段显隐）
          const visible = windows;

          // 预警触发条件：已用 ≥80%（= 剩余 ≤20%）→ 鲜红色文字；正常额度使用中性文字。
          // 该判定与 quotaDisplayMode 无关（used 模式下即「已用 ≥ 80%」），两种方向语义严格等价。
          const LOW_QUOTA_PERCENT = 20;
          // v1.16 显示方向：remaining（默认，= 历史行为）/ used；缺字段或非法值在读取时已归一。
          const windowMode = activeQuotaDisplayMode();
          const titleLines = [t('ui.subscriptionSource.titleLines', { value: subscriptionServiceName(visibleBillingMode && visibleBillingMode.provider) }) + (sub.plan ? ' (' + hostText(sub.plan) + ')' : '')]
            .concat(sub.balanceUnit === 'credits' && typeof sub.balance === 'number' && isFinite(sub.balance)
              ? [t('ui.availableCredits', { value: fmt(sub.balance, 2) })] : [])
            .concat(windows.map(function (w) {
              return quotaWindowDetail(w, windowMode)
                + (w.resetsAt ? t('ui.resetsResetsIn', { value: formatDateTime(w.resetsAt), value2: fmtResetCountdown(w.resetsAt - now) }) : '');
            }));
          const winNodes = [];
          for (let i = 0; i < visible.length; i++) {
            const w = visible[i];
            if (i > 0) winNodes.push(' · ');
            const remaining = remainingPercent(w);
            const numberClass = remaining <= LOW_QUOTA_PERCENT ? 'bi-quota-low' : '';
            // 每个窗口独立 data-field（subWindow5h/Week/Month），色变量按字段注入；「低」字标签保留
            winNodes.push(fieldSpan((windowMeta(w.key) || {}).field || 'subWindow5h', 'w' + i,
              metric(compactWindowLabel(w.key), quotaWindowPercent(w, windowMode) + '%', numberClass)));
            if (remaining <= LOW_QUOTA_PERCENT) winNodes.push(React.createElement('span', { key: 'low' + i, className: 'bi-low-status' }, t('ui.low')));
          }
          // 全部窗口被隐藏（或紧凑模式无候选）→ 整组不推送，分隔符由组装层正确收合
          if (winNodes.length > 0) {
            groups.push(React.createElement('span', { key: 'subwin', title: titleLines.join('\n') }, ...winNodes));
          }
          // host 快照失败（sub.error）或本次 RPC 失败（errors.sub）→ 均保留旧数据 + 降级标记
          if (fieldVisible('refreshFailure') && (sub.error || errors.sub)) {
            trailingErrorGroups.push(fieldSpan('refreshFailure', 'substale',
              React.createElement('span', { className: 'bi-stale', title: subscriptionFailureHint(sub.error || { kind: 'exception', message: String(errors.sub || '') }, sub.source || (visibleBillingMode && visibleBillingMode.provider)) }, t('ui.refreshFailed'))));
          }
          // 距重置倒计时（挂在上面挑出的那个窗口上，与它显示的额度匹配）
          if (resetWindow && resetWindow.resetsAt && fieldVisible('resetCountdown')) {
            const cdTitle = windowMode === 'used'
              ? t('ui.windowUsedRemainingResets', { label: quotaWindowLabel(resetWindow), value: remainingPercent(resetWindow), usedPercent: resetWindow.usedPercent, value4: formatDateTime(resetWindow.resetsAt) })
              : t('ui.windowRemainingUsedResets', { label: quotaWindowLabel(resetWindow), value: remainingPercent(resetWindow), usedPercent: resetWindow.usedPercent, value4: formatDateTime(resetWindow.resetsAt) });
            groups.push(fieldSpan('resetCountdown', 'subcd', React.createElement('span', { title: cdTitle },
              metric(t('ui.resetsIn'), fmtResetCountdown(resetWindow.resetsAt - now)))));
          }
        }
      }

      // ---- v1.7 账单型模式（FR-10~13/FR-14，互斥第三态）：
      //      账单服务+模型 → 本月真实花费 →（预算%）→（免费额度+重置倒计时）；余额/额度/本会话花费均不显示 ----
      function billingFailureHint(error, provider) {
        const serviceName = billingServiceName(provider);
        const message = errorText(error);
        const statusMatch = message.match(/HTTP (\d{3})/);
        const status = error && error.params && error.params.status != null ? String(error.params.status) : (statusMatch ? statusMatch[1] : '');
        if (error && error.kind === 'no-key') return t('ui.notConfigured') + message.replace(/(?:未配置 |Not configured: )/, '') + t('ui.configureItInSettingsModels');
        if (status === '403' || /缺少 .*权限|lack .*permission/.test(message)) return t('ui.deniedAccessTheTokenMay', { serviceName: serviceName });
        if (error && error.kind === 'parse') return t('ui.returnedAnUnrecognizedResponsePlease', { serviceName: serviceName });
        if (/timeout|timed out|abort/i.test(message)) return t('ui.timedOutCheckYourConnection', { serviceName: serviceName });
        return t('ui.billingIsTemporarilyUnavailableCheck', { serviceName: serviceName });
      }

      function pushBillingGroups(groups, trailingErrorGroups) {
        pushIdentityGroups(groups, 'billingServiceGroup', billingProviderGroup);
        const bill = renderedState.billing;
        const errors = renderedState.errors || {};
        if (!bill) {
          if (errors.billing && fieldVisible('refreshFailure')) {
            trailingErrorGroups.push(fieldSpan('refreshFailure', 'billerr',
              React.createElement('span', { className: 'bi-stale', title: billingFailureHint({ kind: 'exception', message: String(errors.billing) }, visibleBillingMode && visibleBillingMode.provider) }, t('ui.refreshFailed'))));
          }
          return;
        }
        const d = bill.data;
        const hasSpend = !!(d && (d.currentPeriodSpend != null || d.usage != null));
        if (bill.error && !hasSpend) {
          if (fieldVisible('refreshFailure')) {
            trailingErrorGroups.push(fieldSpan('refreshFailure', 'billstale',
              React.createElement('span', { className: 'bi-stale', title: billingFailureHint(bill.error, bill.type || (visibleBillingMode && visibleBillingMode.provider)) }, t('ui.refreshFailed'))));
          }
          return;
        }
        if (hasSpend) {
          const symbol = d.currency === 'CNY' ? '¥' : '$';
          const titleLines = [t('ui.billingSource', { value: billingServiceName(visibleBillingMode && visibleBillingMode.provider) })]
            .concat(d.note ? [hostText(d.note)] : [])
            .concat(d.currentPeriodSpend != null ? [t('ui.thisMonthSSpend', { symbol: symbol, value: fmt(d.currentPeriodSpend, 2) })] : [])
            .concat(d.budgetPercent != null ? [t('ui.budgetUsed', { value: fmt(d.budgetPercent, 0) })] : [])
            .concat(d.freeRemaining != null ? [t('ui.dailyFreeQuotaRemaining', { value: fmt(d.freeRemaining, 0) })] : []);
          // v1.9.0 PR2：本月/预算/免费额度三片段各自显隐，分隔符只在可见片段之间
          const nodes = [];
          if (d.currentPeriodSpend != null && fieldVisible('billingSpend')) {
            nodes.push(fieldSpan('billingSpend', 'billspend', metric(t('ui.thisMonth'), symbol + fmt(d.currentPeriodSpend, 2))));
          } else if (d.usage != null && fieldVisible('billingSpend')) {
            nodes.push(fieldSpan('billingSpend', 'billspend', metric(t('ui.thisMonthSUsage'), fmt(d.usage, 2) + (d.usageUnit ? ' ' + d.usageUnit : ''))));
          }
          if (d.budgetPercent != null && fieldVisible('budget')) {
            if (nodes.length > 0) nodes.push(' · ');
            nodes.push(fieldSpan('budget', 'billbudget', metric(t('ui.budget'), fmt(d.budgetPercent, 0) + '%')));
          }
          // 免费额度仅当接口显式给出（freeRemaining/resetsAt 同时存在）才显示，绝不编造
          if (d.freeRemaining != null && d.resetsAt && fieldVisible('freeQuota')) {
            if (nodes.length > 0) nodes.push(' · ');
            nodes.push(fieldSpan('freeQuota', 'billfree', metric(t('ui.free'), t('ui.resetsIn.pushBillingGroups', { value: fmt(d.freeRemaining, 0), value2: fmtResetCountdown(d.resetsAt - now) }))));
          }
          if (nodes.length > 0) {
            groups.push(React.createElement('span', { key: 'bill', title: titleLines.join('\n') }, ...nodes));
          }
          if (fieldVisible('refreshFailure') && (bill.error || errors.billing)) {
            trailingErrorGroups.push(fieldSpan('refreshFailure', 'billstale',
              React.createElement('span', { className: 'bi-stale', title: billingFailureHint(bill.error || { kind: 'exception', message: String(errors.billing || '') }, bill.type || (visibleBillingMode && visibleBillingMode.provider)) }, t('ui.refreshFailed'))));
          }
        }
      }

      // 账单型模型组：账单服务名 · 具体模型（如 `AWS Bedrock · Claude`）
      function billingProviderGroup() {
        const pr = visiblePricing;
        const serviceName = billingServiceName(visibleBillingMode && visibleBillingMode.provider);
        const modelLabel = (pr && pr.modelDisplay) ? pr.modelDisplay
          : (pr && pr.model ? pr.model : t('ui.unknownModel'));
        const modelName = modelLabelWithoutProvider(modelLabel, serviceName);
        const versionLine = updateInfo && typeof updateInfo.current === 'string'
          ? t('ui.pluginVersion', { current: updateInfo.current }) : '';
        const title = t('ui.billingServiceModel', { serviceName: serviceName, modelLabel: modelLabel, versionLine: versionLine });
        return React.createElement('span', { key: 'billprov', className: 'bi-model-group', title: title },
          React.createElement('b', { className: 'bi-model-provider' }, serviceName),
          modelDetail(pr, modelName),
        );
      }

      const groups = [];
      // 报错不打断主要信息的阅读顺序：统一延后到整行最右侧。
      const trailingErrorGroups = [];
      // 两态严格判定：density 只能是 'full' 或 'compact'（host 校验 + 本地防抖保证）。
      // 注意：这个变量唯一的语义是「原生统计行是否参与」——它的全部读取点只有下面构造 row1 之后的
      // nativeRowShown 与 aria（pressed / 无障碍说明）。字段显隐一律不读它，读它就是设计被破坏
      // （见 constants.js 的「显示模型」；tests/test-density-toggle.cjs 有硬断言）。
      const full = displayDensity === 'full';
      // 模式互斥：订阅制渲染订阅版 row2，账单制渲染账单版 row2，余额制渲染 v1.0.0 现状——三态绝不叠加（FR-14）
      const isSub = !!(visibleBillingMode && visibleBillingMode.mode === 'subscription');
      const isBilling = !!(visibleBillingMode && visibleBillingMode.mode === 'billing');
      const selectionPending = waitForSessionModel || !visibleBillingMode || visibleBillingMode.mode === 'unknown';
      // Never paint a loading placeholder.  Before the active session's model
      // is available, leave this compact row empty rather than briefly showing
      // either a generic loading label or data from the previous session.
      if (selectionPending) {
        // Intentionally empty: session model publish fills the row immediately.
      } else if (isBilling) {
        pushBillingGroups(groups, trailingErrorGroups);
      } else if (isSub) {
        pushSubscriptionGroups(groups, trailingErrorGroups);
      } else {
        pushBalanceGroups(groups, trailingErrorGroups);
      }

      // 全局降级提示：任一端点失败 → 旧数据照常渲染 + 角落提示（title 列出失败项），仅失败项降级
      const errors = renderedState.errors || {};
      const failedLabels = [];
      if (errors.balance) failedLabels.push(t('ui.balance.pushBalanceGroups'));
      if (errors.pricing) failedLabels.push(t('ui.pricing'));
      if (errors.usage) failedLabels.push(t('ui.spend'));
      if (errors.billingMode) failedLabels.push(t('ui.mode'));
      if (errors.sub) failedLabels.push(t('ui.subscriptionQuota'));
      if (errors.billing) failedLabels.push(t('ui.billing'));
      if (failedLabels.length > 0 && fieldVisible('refreshFailure')) {
        trailingErrorGroups.push(fieldSpan('refreshFailure', 'degraded',
          React.createElement('span', { className: 'bi-stale', key: 'degraded',
            title: failedLabels.join(t('ui.listSeparator')) + t('ui.temporarilyUnavailableKeepingTheLast') }, t('ui.refreshFailed'))));
      }
      const persistence = renderedState.usage && renderedState.usage.persistence;
      if (persistence && persistence.state && persistence.state !== 'ok' && fieldVisible('persistWarning')) {
        const snapshotOnly = persistence.state === 'snapshot-stale';
        trailingErrorGroups.push(fieldSpan('persistWarning', 'ledger-save', React.createElement('span', {
          className: snapshotOnly ? 'bi-stale' : 'bi-err',
          title: snapshotOnly
            ? t('ui.spendJournalSavedButThe') + (errorText(persistence) || t('ui.unknownReason'))
            : t('ui.thisSpendRecordWasNot') + (errorText(persistence) || t('ui.unknownReason')),
        }, snapshotOnly ? t('ui.ledgerUpdatePending') : t('ui.spendNotSaved'))));
      }

       // 新版本是低频维护事件，不是这次对话的状态。桌面客户端也不能可靠执行 Web/终端安装命令，
       // 因此这里不塞更新命令，只在两种真正需要用户动作的情况下给一个短标记：
       // ① 新版已下载、等重启激活；② 上次自动更新失败。升级重启后标记自动消失，平时不占位。
       // 插件没有「打开设置页」的能力（client 仅 inject slots / locale），所以标记只作提示，
       // 点击一律拦在本地 —— 否则会冒泡到根节点，把简洁/完整模式切走。
       // 两条标记各自挂在「提醒信息」组里的独立开关上（2026-09-25 用户拍板）：
       // updateNotice = 有新版本 / 待重启；updateFailure = 自动更新失败。
       // 开关只管「出现还是不出现」，与当前是简洁模式还是完整模式无关 —— 主行两种模式都可见。
       const updateStatus = updateInfo && updateInfo.updateStatus ? updateInfo.updateStatus : null;
       const restartVersion = updateInfo && updateInfo.pendingRestart === true ? updateInfo.diskVersion : null;
       const updateFailed = !!(updateStatus && updateStatus.lastError);
       if (restartVersion && fieldVisible('updateNotice')) {
         trailingErrorGroups.push(fieldSpan('updateNotice', 'updatebadge', React.createElement('span', {
           key: 'updateBadge',
           className: 'bi-update-badge',
           title: t('ui.updatePendingRestart', { version: restartVersion }),
           onClick: function (event) { event.stopPropagation(); },
           onKeyDown: function (event) { event.stopPropagation(); },
         }, t('ui.updateRestartBadge'))));
       }
       if (updateFailed && fieldVisible('updateFailure')) {
         trailingErrorGroups.push(fieldSpan('updateFailure', 'updatefailed', React.createElement('span', {
           key: 'updateFailureBadge',
           className: 'bi-update-badge bi-update-badge--error',
           title: t('ui.updateFailed') + ' · ' + updateErrorText(updateStatus.lastErrorKind || updateStatus.lastError),
           onClick: function (event) { event.stopPropagation(); },
           onKeyDown: function (event) { event.stopPropagation(); },
         }, t('ui.updateFailedBadge'))));
       }

       // ---- 组装（分隔符收合与「刷新失败」去重见模块级 assembleInfoBarRow） ----
       const nodes = assembleInfoBarRow(groups, trailingErrorGroups, React.createElement);
       // 上下文占用圆环（原型是 DSH 原生信息，已由本插件接管）：挂在主行最右端。
       // 与其它字段同源：fields.contextUsage 管显隐、colors.contextUsage 管配色；数据不足时整块不渲染。
       // 归 plugin 组、门控只有 fieldVisible 一条 —— 它住在主行，而主行两种模式都可见（见 constants.js 显示模型）。
       const contextInfo = fieldVisible('contextUsage') ? contextOccupancy(pressureProj) : null;
       const contextNode = contextInfo === null ? null : React.createElement(ContextMeterRing, {
         key: 'ctx',
         context: contextInfo,
         breakdown: breakdownProj,
       });
       const row2 = React.createElement('div', { id: 'dsh-bottom-info-bar-primary', className: 'bi-row2' }, ...attachContextMeter(nodes, contextNode, React.createElement));

      let row1 = null;
      if (statsProj) {
        // 每组：{ nodes: React 节点数组（数字用 num 加粗）, text: 纯文本（title 用）, fieldId: 字段 id（着色用） }
        const ng = [];
        // title：可选的原生悬浮说明。整行已有 title（nativeLine），组级 title 让每个指标
        // 能自带口径说明（例如“缓存命中”按 token 计、只含主 Agent），浏览器悬停取最内层。
        function group(parts, hidden, fieldId, title) {
          const nodesArr = [];
          const texts = [];
          function textOf(part) {
            if (part == null) return '';
            if (typeof part === 'string' || typeof part === 'number') return String(part);
            if (Array.isArray(part)) return part.map(textOf).join('');
            if (part.props && part.props['data-metric-text']) return part.props['data-metric-text'];
            return part.props ? textOf(part.props.children) : '';
          }
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (typeof p === 'string') { nodesArr.push(p); texts.push(p); }
            else if (Array.isArray(p)) { for (let j = 0; j < p.length; j++) nodesArr.push(p[j]); texts.push(textOf(p)); }
            else { nodesArr.push(p); texts.push(textOf(p)); }
          }
          ng.push({ nodes: nodesArr, text: texts.join(''), hidden: !!hidden, fieldId: fieldId || null, title: title || null });
        }

        // v1.9.0 PR2：原生统计行字段按设置过滤（隐藏组完全不进 ng，不占版式也不进 title）
        if (fieldVisible('turnsSteps')) {
          // 中文界面遵循数字与汉字混排留白：数值与量词视觉上分开，便于快速扫读。
          group([num(t(statsProj.turns === 1 ? 'ui.turnCount' : 'ui.turnCountPlural', { count: statsProj.turns })), ' · ', num(t(statsProj.steps === 1 ? 'ui.stepCount' : 'ui.stepCountPlural', { count: statsProj.steps }))], false, 'turnsSteps');
        }

        const durations = [];
        if (statsProj.llmMs > 0 && fieldVisible('llmTime')) durations.push(fieldSpan('llmTime', 'durl', metric('LLM', formatDuration(statsProj.llmMs))));
        if (statsProj.toolMs > 0 && fieldVisible('toolTime')) {
          if (durations.length > 0) durations.push(' · ');
          durations.push(fieldSpan('toolTime', 'durt', metric(t('ui.tools'), formatDuration(statsProj.toolMs))));
        }
        if (durations.length > 0) group(durations);

        if (statsProj.ttftSteps > 0 && fieldVisible('avgTTFT')) {
          group([metric(t('ui.avgTTFT'), formatDuration(statsProj.ttftMs / statsProj.ttftSteps))], false, 'avgTTFT');
        }
        if (statsProj.decodeMs > 0 && fieldVisible('outputSpeed')) {
          group([num(formatTps(statsProj.decodeTokens / (statsProj.decodeMs / 1e3)) + ' tok/s')], false, 'outputSpeed');
        }

        if (usageProj && (billedInput(usageProj) > 0 || (usageProj.outputTokens || 0) > 0)) {
          const denom = billedInput(usageProj);
          const cacheReadTokens = usageProj.cacheReadTokens || 0;
          // 一位小数（审计 2026-10-05）：99.6% 过去被四舍五入成“100%”，用户会误以为缓存全命中、
          // 输入几乎免费。100% 只能意味着未命中为 0，否则必须把小数露出来。
          const hit = denom > 0 ? Math.round((cacheReadTokens / denom) * 1000) / 10 : null;
          if (hit != null && fieldVisible('cacheHit')) {
            group([metric(t('ui.cacheHit'), hit + '%')], false, 'cacheHit', t('ui.cacheHitScope', {
              hit: formatTokens(cacheReadTokens),
              miss: formatTokens(Math.max(0, denom - cacheReadTokens)),
              percent: hit,
            }));
          }
          if (fieldVisible('tokensIO')) {
            group([metric(t('ui.input.BottomInfoBar'), formatTokens(billedInput(usageProj)) + ' tok'), ' · ', metric(t('ui.output'), formatTokens(usageProj.outputTokens || 0) + ' tok')], false, 'tokensIO', t('ui.tokenScope'));
          }
        }

        const nativeLine = ng.map(function (g) { return g.text; }).join(' | ');
        const ngNodes = [];
        let visCount = 0;
        for (let i = 0; i < ng.length; i++) {
          if (ng[i].hidden) continue; // 隐藏分组不占版式（title 仍含其文本）
          if (visCount > 0) ngNodes.push(React.createElement('span', { key: 'nsep' + i, className: 'bi-sep' }, '|'));
          visCount++;
          ngNodes.push(React.createElement('span', {
            key: 'ng' + i,
            'data-field': ng[i].fieldId || undefined,
            style: ng[i].fieldId ? fieldStyle(ng[i].fieldId) : undefined,
            title: ng[i].title || undefined,
          }, ng[i].nodes));
        }
        // D6：原生组全部被隐藏（或全空）→ 原生行不渲染（不留空行/占位；hover 浮窗随之消失）
        if (ngNodes.length === 0) row1 = null;
        else row1 = React.createElement('div', { id: 'dsh-bottom-info-bar-native', className: 'bi-native-row', title: nativeLine }, ...ngNodes);
      }

      // 收合行的 CSS 高度 = --bi-extra-h，必须是「确定值且等于原生行自身高度」：
      //  · 单行时就是 --bi-line（20px），与 CSS 默认值一致，首帧即正确；
      //  · 窄宽度下原生行折成两行时同步放大，内容不被裁切；
      //  · 绝不依赖 fr 轨道或容器自由空间，因此祖先被拉伸/定高时也不会在两行之间冒出空隙。
      // ResizeObserver 跟随折行、字号与缩放变化；缺失该 API 的环境退回「只测一次」。
      const row1Present = row1 !== null;
      // `full` 的唯一去处：原生统计行是否参与（可见 + 无障碍名称）。字段显隐与它无关。
      const nativeRowShown = row1Present && full;
      // 优先 layout effect（首帧前测量，折行时不会闪一下裁切）；React shim 只提供 useEffect
      // 时退回它——功能等价，只是晚一帧对齐高度。
      const measureEffect = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect;
      measureEffect(function () {
        const host = extraRowRef.current;
        const row = host && host.firstElementChild;
        if (!host || !row) return undefined;
        const sync = function () {
          const measured = row.getBoundingClientRect().height;
          // 高度取整到 0.01px：既保留分数缩放的精度，又避免无意义的亚像素抖动。
          const next = measured > 0 ? Math.round(measured * 100) / 100 : 20;
          host.style.setProperty('--bi-extra-h', next + 'px');
        };
        sync();
        if (typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver(sync);
        observer.observe(row);
        return function () { observer.disconnect(); };
      }, [row1Present]);

      // D6 用户拍板：全部字段隐藏 = 底栏彻底移除——不渲染任何 DOM（无空行/占位高度/悬空分隔符），
      // density 点击因无 DOM 而天然无副作用、不报错。两条路径：①配置层面所有字段都被关闭；
      // ②渲染层面（数据条件导致）原生行/主行/圆环全空。
      if (infoBarShouldRemoveAll(FIELD_REGISTRY, fieldVisible) || (row1 === null && nodes.length === 0 && contextNode === null)) {
        return null;
      }

      const animatedRow1 = row1 === null ? null : React.createElement('div', { className: 'bi-density-extra', ref: extraRowRef }, row1);
      const rootCls = 'bi-root';
      return React.createElement('div', {
        className: rootCls,
        onClick: function () { props.onToggleDensity(); },
        onKeyDown: function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            props.onToggleDensity();
          }
        },
        role: 'button',
        tabIndex: 0,
        'aria-labelledby': nativeRowShown ? 'dsh-bottom-info-bar-native dsh-bottom-info-bar-primary' : 'dsh-bottom-info-bar-primary',
        'aria-describedby': 'dsh-bottom-info-bar-action',
        'aria-pressed': full,
        'aria-busy': isDensitySaving,
        'aria-disabled': isDensitySaving,
        'data-density': displayDensity,
        'data-density-saving': isDensitySaving,
        title: isDensitySaving ? t('ui.savingView') : t('ui.clickToSwitchFullCompact'),
      }, animatedRow1, row2,
      React.createElement('span', { id: 'dsh-bottom-info-bar-action', className: 'bi-sr-only' },
        full ? t('ui.pressEnterOrSpaceFor') : t('ui.pressEnterOrSpaceFor.BottomInfoBar')));
    }
  },
};

return module.exports;
} });
