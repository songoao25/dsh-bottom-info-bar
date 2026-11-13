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
// 2026-10-13：文本输入与「几个互斥模式选一个」的分段控件同样优先用宿主原生组件。
// 仍然是同一个铁律：逐成员做存在性判断，取不到时退回插件内等价实现（老宿主行为不变）。
const BIB_SET_NATIVE_INPUT = bibSetNative('Input');
const BIB_SET_NATIVE_SEGMENTED = bibSetNative('SegmentedControl');
const LOCALE_NAMESPACE = 'dsh-bottom-info-bar';
const LOCALES = /*__LOCALES__*/{};
let t;
let localeService;
// 语言选择行：与设置页里的时区选择共用同一条原生控件路径——锚点是宿主原生 Button，
// 展开的是宿主原生 Menu 卡片（宿主没有 Menu 的老版本才退回 <select>，见 bibSetSelect）。
// 原先这里是一个裸 <select>：那是操作系统自带的古老控件（灰色直角框 + 系统菜单），
// 和旁边的原生按钮/输入框明显不是一套东西，所以改成姊妹插件（dsh-chatgpt-sub）同款的原生下拉，
// 整行的形状/配色/动效都交还宿主维护。语言本身仍只存在本浏览器的 localStorage，不改 DSH 偏好。
function bibSetLanguagePicker(props) {
  const runtime = props.runtime;
  const options = [{ id: 'auto', label: t('language.auto') }].concat(
    runtime.options().map(function (language) { return { id: language.id, label: language.label }; }));
  // 2026-11-12 卡片化统一：语言选择是独立一张设置卡（与其它区块同一张面），
  // 不再是悬在页面顶部的裸行 —— 整页每个区块共用同一套卡面（fill/stroke/radius-xl）。
  return React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-label': t('language.title') },
    React.createElement('div', { className: 'bib-set-row' },
      React.createElement('div', { className: 'bib-set-rowText' },
        React.createElement('label', { htmlFor: 'bib-language', className: 'bib-set-rowTitle' }, t('language.title')),
        React.createElement('p', { className: 'bib-set-rowDesc' }, t('language.description'))),
      React.createElement(bibSetSelect, {
        id: 'bib-language',
        value: runtime.preference(),
        label: t('language.title'),
        options: options,
        fallbackClassName: 'bib-set-language',
        onChange: function (next) {
          try { runtime.setPreference(next); props.onError(null); }
          catch { props.onError({ text: function () { return t('language.saveFailed'); } }); }
        },
      })));
}
/*__LANGUAGE_RUNTIME__*/
let languageRuntime;
function createTranslator(service) {
  if (languageRuntime) languageRuntime.dispose();
  languageRuntime = createLanguageRuntime(LOCALE_NAMESPACE, LOCALES, service);
  return languageRuntime.t;
}
t = createTranslator(null);
// Compatibility with existing host snapshots, whose display fields are text.
// Known labels and messages follow the browser locale even while snapshots are cached.
/*__HOST_TEXT__*/
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
const FIELD_REGISTRY = /*__FIELD_REGISTRY__*/[];
// DSH 0.2.1 owns its clickable activity/usage entries. Observe their actual
// registrations rather than guessing a version or copying private components.
const nativeDockState = { pills: false, listeners: new Set() };
function hasNativeDockPills(slots) {
  if (!slots || typeof slots.entries !== 'function') return false;
  const entries = slots.entries('conversation.composer.dock');
  return entries.some(function (entry) {
    const id = entry.options && entry.options.id;
    return id === 'activity' || id === 'usage';
  });
}
function useNativeDockPills() {
  const [pills, setPills] = React.useState(nativeDockState.pills);
  React.useEffect(function () {
    nativeDockState.listeners.add(setPills);
    setPills(nativeDockState.pills);
    return function () { nativeDockState.listeners.delete(setPills); };
  }, []);
  return pills;
}
function settingsFieldsForHost(pills) {
  // 新宿主（Harness 自己的 activity/usage 按钮）：用两个「原生按钮」开关，旧统计行的七个字段不再出现；
  // 旧宿主没有这两个入口，反过来隐藏它们。两组开关永不混在同一个设置页里。
  if (pills) return FIELD_REGISTRY.filter(function (field) {
    return field.group !== 'native' || NATIVE_PILL_FIELDS.some(function (entry) { return entry.fieldId === field.id; });
  });
  return FIELD_REGISTRY.filter(function (field) {
    return !NATIVE_PILL_FIELDS.some(function (entry) { return entry.fieldId === field.id; });
  });
}
// 桌面设置页的字段清单：goOnly 字段（今天花费 / 近 30 天花费这类 DSH Go 宽屏增量列）
// 只在 Go 配置页出现。桌面信息栏没有对应渲染分支，开关在这里点了没有效果，
// 所以桌面设置页既不列行、也不计入「已启用 N 项」（用户 2026-11-13 拍板）。
// Go 配置页仍走 settingsFieldsForHost 全量，行为不变。
function settingsFieldsForPage(pills) {
  return settingsFieldsForHost(pills).filter(function (field) { return field.goOnly !== true; });
}
// 新宿主原生按钮的字段 id ↔ 宿主 data-composer-stat 值。设置页开关只隐藏对应入口，
// 不复制、不重注册宿主组件 —— 按钮的弹窗、快捷键与 Harness 设置全部保持宿主所有。
const NATIVE_PILL_FIELDS = [
  { fieldId: 'nativeActivity', stat: 'activity' },
  { fieldId: 'nativeUsage', stat: 'usage' },
];
const NATIVE_PILL_HIDDEN_ATTR = 'data-bi-native-hidden';
// 把字段开关落成 documentElement 属性，交给样式隐藏宿主按钮。
// 放在模块级而不是组件里：插件信息全部关掉时信息栏根节点不渲染，但原生按钮的开关仍必须生效。
function applyNativePillVisibility() {
  if (typeof document === 'undefined' || !document || !document.documentElement) return;
  // 字面量 fieldVisible(...) 是显示模型测试的锚点：两个开关都必须走同一套显隐判定。
  const hidden = [];
  if (!fieldVisible('nativeActivity')) hidden.push('activity');
  if (!fieldVisible('nativeUsage')) hidden.push('usage');
  if (hidden.length > 0) document.documentElement.setAttribute(NATIVE_PILL_HIDDEN_ATTR, hidden.join(' '));
  else document.documentElement.removeAttribute(NATIVE_PILL_HIDDEN_ATTR);
}
function clearNativePillVisibility() {
  if (typeof document === 'undefined' || !document || !document.documentElement) return;
  document.documentElement.removeAttribute(NATIVE_PILL_HIDDEN_ATTR);
}
const PRESET_COLORS = /*__PRESET_COLORS__*/[];
// v1.6 T7 / v1.7 FR-14：订阅/账单 provider 集合（构建注入，永不变）。以前在 BottomInfoBar 里每次渲染重建
// 字面量——值从不变，多建的只是垃圾。提到模块级，var 拼法保留（一致性测试按该字面锚点提取）。
var SUBSCRIPTION_PROVIDERS = /*__SUBSCRIPTION_PROVIDERS__*/[];
var BILLING_PROVIDERS = /*__BILLING_PROVIDERS__*/[];
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
// 每次配置快照落地都同步一次原生按钮显隐（监听器只在模块初始化时注册一次，
// 因此单独抽出的配置切片测试不会因为缺少 helper 而抛错）。
fieldConfigListeners.add(function () {
  // 切片测试只抽配置状态机、不带 helper：typeof 守卫让同一段源码在两种求值方式下都安全。
  if (typeof applyNativePillVisibility === 'function') applyNativePillVisibility();
});

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

// ---------- 触屏基础适配：hover 明细 → 点按内联面板（2026-11-12） ----------
// 信息栏的明细（余额构成、今天/近一月/全部花费、定价模式、订阅窗口明细、错误原因）历来只挂在
// title 属性上：桌面端 hover 可读，触屏设备没有 hover，这些内容等于永远看不到（DSH Go 网页版、
// 手机浏览器同理；issue #274 的红色「刷新失败」原因就只写在 title 里）。
// 这里在「hover 不可用 / coarse pointer」的设备上把整栏点击改成「展开内联明细」：
//   · 面板是信息栏的兄弟节点、在文档流里展开，不覆盖输入框，也不改动任何字段显隐
//     （字段开关仍是唯一显隐来源；面板只搬运本来就存在的 title 文案）；
//   · 桌面端不渲染面板、行为与像素零变化（matchMedia 不可用 / hover 可用 → 保持原样）；
//   · 触屏上完整/简洁切换改由面板里的按钮触发，原「点整栏切换」在触屏让位给「看明细」。
function touchDetailsEnabled() {
  try {
    if (typeof window === 'undefined' || !window || typeof window.matchMedia !== 'function') return false;
    const hover = window.matchMedia('(hover: hover)');
    if (hover && hover.matches) return false;
    const coarse = window.matchMedia('(pointer: coarse)');
    if (coarse && coarse.matches) return true;
    return typeof navigator !== 'undefined' && navigator !== null && navigator.maxTouchPoints > 0;
  } catch (err) {
    // 媒体查询不可用的极简宿主：按桌面处理，绝不让适配逻辑挡住信息栏本身。
    return false;
  }
}

// 收集栏内各字段的 hover 明细（title 原文，与桌面端看到的是同一份文案）。
// 只收「当前真正可见」的节点：简洁模式收起的原生行高度为 0，不能把用户已收起的明细再列出来；
// 同一段文案只列一次（嵌套节点会重复），顺序即字段在栏内的视觉顺序。
function collectInfoBarDetails(rootEl) {
  if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return [];
  const nodes = rootEl.querySelectorAll('[title]');
  const seen = new Set();
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const raw = el.getAttribute('title');
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (text.length === 0 || seen.has(text)) continue;
    // 标题与可见文本逐字相同 = 这行没有额外信息（如自定义文字），不占面板篇幅。
    const visibleText = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (visibleText === text.replace(/\s+/g, ' ').trim()) continue;
    let node = el;
    let visible = true;
    while (node && node !== rootEl) {
      let rect = null;
      try { if (typeof node.getBoundingClientRect === 'function') rect = node.getBoundingClientRect(); } catch (err) { rect = null; }
      if (rect && (!(rect.width > 0) || !(rect.height > 0))) { visible = false; break; }
      let style = null;
      try {
        if (typeof window !== 'undefined' && window && typeof window.getComputedStyle === 'function') style = window.getComputedStyle(node);
      } catch (err) { style = null; }
      if (style && (style.visibility === 'hidden' || style.display === 'none')) { visible = false; break; }
      node = node.parentElement;
    }
    if (!visible) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

// ---------- DSH Go 皮肤层门控（2026-11-12，只做门控与信号归一，不含视觉） ----------
// DSH Go 的网页版/整页 WebView 岛会在 <html> 上留下三种信号之一：
//   ① data-dsh-app-layout（网页版：drawer / desktop，见 dsh-Go assets/web/dsh_web_phone.js）
//   ② data-dsh-go-island（若宿主直接注入）
//   ③ location.hash 里的 dsh-go-island= 片段，或注入的 window.DshGoIsland 通道（整页岛）
// 这里把 ②③ 归一成 data-dsh-go-island 属性，CSS 与 JS 共用同一个信号；桌面浏览器三者皆无，
// 属性不存在 → 皮肤层不生效（桌面像素不变）。视觉规则等 design-go v2 稿再落地。
function dshGoSurfaceEnabled() {
  try {
    if (typeof document === 'undefined' || !document || !document.documentElement) return false;
    const root = document.documentElement;
    if (root.getAttribute('data-dsh-app-layout') !== null) return true;
    if (root.getAttribute('data-dsh-go-island') !== null) return true;
    let island = false;
    try {
      island = typeof window !== 'undefined' && window && typeof window.DshGoIsland !== 'undefined';
    } catch (err) { island = false; }
    if (!island && typeof window !== 'undefined' && window && window.location) {
      island = String(window.location.hash || '').indexOf('dsh-go-island=') !== -1;
    }
    if (island) {
      try { root.setAttribute('data-dsh-go-island', '1'); } catch (err) { /* 写不了属性就只靠 JS 判定 */ }
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}
// DSH Go 形态：只要在 DSH Go 表面内就套 Go 皮肤，不再额外要求触屏。
// DSH Go 跑在平板、大窗或被鼠标操作时依然是 DSH Go，不能退回桌面那条双行 pill；
// 尺寸差异交给 CSS 断点（≤360 / 常规 / ≥600），形态与行为保持一套。
// 桌面 DSH 没有上面任何一个信号，dshGoSurfaceEnabled() 为 false，像素不变。
function dshGoCompactEnabled() {
  return dshGoSurfaceEnabled();
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
      /* Keep native entries in the real host outlet: no copied dialog or private API.
         Visual order (user decision 2026-10-17): the native line on top, the plugin line below.
         DOM order cannot express this because it follows registration priority, so flex order
         lifts the plugin row to the second line while the native entries keep order 0. */
      [data-composer-dock]:has(.bi-root[data-native-pills="true"]) { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; column-gap: 12px; row-gap: 0; }
      [data-composer-dock]:has(.bi-root[data-native-pills="true"]) > [data-slot="conversation.composer.dock"] { display: contents; }
      [data-composer-dock] .bi-root[data-native-pills="true"] { flex: 0 0 100%; width: 100%; min-width: 0; order: 1; }
      [data-composer-dock]:has(.bi-root[data-native-pills="true"]) [data-composer-stat] { order: 0; min-width: 0; max-width: 100%; max-height: calc(22px + var(--dsh-content-font-delta-secondary, 0px)); overflow: hidden; opacity: 1; visibility: visible; transition: max-height 160ms cubic-bezier(0.2, 0, 0, 1), opacity 120ms linear, visibility 0s linear 0s; }
      /* 简洁模式收合原生那一行：和旧宿主统计行同一套节奏（160ms 高度 + 120ms 淡出）。
         原生按钮由宿主渲染、插件不能包一层容器，因此收合落在每个 [data-composer-stat] 上：
         高度归零 → 整条 flex 行高随之归零，行序仍是「原生在上、插件在下」。
         visibility 延迟到高度动画结束后才隐藏，既保留过渡又让隐藏按钮退出 Tab 序与读屏树。 */
      [data-composer-dock]:has(.bi-root[data-native-pills="true"][data-density="compact"]) [data-composer-stat] { max-height: 0px; opacity: 0; visibility: hidden; pointer-events: none; transition: max-height 160ms cubic-bezier(0.2, 0, 0, 1), opacity 120ms linear, visibility 0s linear 160ms; }
      @media (prefers-reduced-motion: reduce) {
        [data-composer-dock]:has(.bi-root[data-native-pills="true"]) [data-composer-stat] { transition: none; }
      }
      /* 两个原生按钮各自的开关：只隐藏对应入口，不碰 Harness 的组件与弹窗。
         属性挂在 documentElement 上，因此插件行全部关闭、根节点不渲染时开关照样生效。 */
      [data-bi-native-hidden~="activity"] [data-composer-dock] [data-composer-stat="activity"],
      [data-bi-native-hidden~="usage"] [data-composer-dock] [data-composer-stat="usage"] { display: none; }
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
      /* 状态标签统一软底胶囊（2026-11-12 重设计，与 DSH 原生状态徽章同语言）：
         底色由文字色派生（color-mix currentColor 14%）—— 字段自定义色照常生效（改色时底色跟着走），
         明暗主题都不引入新的前景/背景配对；去掉旧 1px 描边胶囊，色块自成形，更轻、更原生。
         高度锁 16px；vertical-align: middle 让 16px 胶囊在 20px 文字行里取文本的光学中心，
         不再因 top 对齐把上沿顶出整行（2026-11-13 用户报告的「重启生效」上沿超出）。
         超长引导文案缩略、完整说明保留在 title 悬停。 */
      .bi-err, .bi-stale { display: inline-flex; align-items: center; box-sizing: border-box; flex: 0 1 auto; min-width: 0; max-width: 100%; height: 16px; padding: 0 7px; border-radius: 999px; background: color-mix(in srgb, currentColor 14%, transparent); color: var(--bi-state-alert); font-weight: 600; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
      .bi-muted{ color: var(--bi-label-supporting); }
      /* 低余额/低额度是数值的状态修饰，而非独立组件：无框“低”字避免制造第二个视觉焦点。 */
      .bi-low-status { margin-left: 3px; color: var(--bi-state-alert); font-weight: 600; }
      .bi-root b.bi-alert-num, .bi-root b.bi-quota-low { color: var(--bi-state-alert); font-weight: 700; }
      /* 新版本需要用户处理：与其它提醒统一用鲜红警示色，不伪装成链接。
         只用手型光标作提示——不加下划线、不改颜色，保持「告警」而非「链接」的语义
         （test-update-check 有「无下划线」的专项断言）。 */
      .bi-update{ color: var(--bi-state-alert); font-weight: 600; cursor: pointer; }
      /* 自更新状态短标记：只在「已下载待重启」或「上次自动更新失败」时出现，重启/修复后自动消失。
         与 .bi-update 区分：它不需要用户点击，用默认光标 + 软底胶囊（同 .bi-err 语法），
         明确「这是状态标签，不是可点链接」。失败态用更高浓度底色分层，不换颜色不加字重。 */
      /* 与 .bi-err/.bi-stale 同一套垂直居中口径：16px 胶囊按文本光学中心对齐，不再上沿顶出。 */
      .bi-update-badge{ margin-left: 6px; display: inline-flex; align-items: center; box-sizing: border-box; flex: 0 1 auto; min-width: 0; max-width: 100%; height: 16px; padding: 0 7px; border: 0; border-radius: 999px; background: color-mix(in srgb, currentColor 14%, transparent); color: var(--bi-state-alert); font-weight: 600; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; cursor: default; }
      /* 胶囊的字段容器撑满当前行高并 flex 居中：不同字号下行高会变成 20/24/…，
         vertical-align: middle 仍会低 0.6–1.1px；这里直接按行高中线对齐，和左右文字同一条中线。
         只作用于两个更新标记字段，不碰其它 data-field 的文本基线。 */
      .bi-row2 span[data-field="updateNotice"], .bi-row2 span[data-field="updateFailure"] { display: inline-flex; align-items: center; height: var(--bi-line); }
      /* 失败态比「待重启」（可预期的正常流程）更需要被看见：底色浓度分层（24% vs 14%）。 */
      .bi-update-badge--error{ background: color-mix(in srgb, currentColor 24%, transparent); }
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
      /* ---------- 触屏点按明细（hover 不可用时的替代路径，2026-11-12） ----------
         只有组件判定为触屏（hover 不可用 / coarse pointer）时才渲染这个面板；桌面端没有这个 DOM，
         像素零变化。面板是信息栏的兄弟节点、在文档流里展开（不 position:fixed），因此不会盖住
         输入框，也不依赖任何浮层定位；明细内容就是各字段原有的 title 文案。 */
      .bi-mobile-details { box-sizing: border-box; width: 100%; max-height: 40vh; overflow: hidden auto; overscroll-behavior: contain; flex: 0 0 100%; order: 2; margin: 4px 0 0; padding: 8px 12px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2)); color: var(--dsw-alias-label-secondary, #5a6169); font-size: var(--dsh-content-font-size-secondary, 13px); line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px)); text-align: left; user-select: text; -webkit-user-select: text; }
      .bi-mobile-details-list { margin: 0; padding: 0; list-style: none; }
      .bi-mobile-details-item { padding: 6px 0; white-space: pre-line; overflow-wrap: anywhere; }
      .bi-mobile-details-item + .bi-mobile-details-item { border-top: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.14)); }
      .bi-mobile-details-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
      .bi-mobile-details-button { flex: 1 1 140px; min-height: 44px; margin: 0; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l3, rgba(128, 128, 128, 0.35)); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary, #1f2328); font: inherit; line-height: 1.3; cursor: pointer; -webkit-tap-highlight-color: transparent; }
      .bi-mobile-details-button:active { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.14)); }
      /* 手机宽度（含 320px 极窄）与横屏矮视口的基础适配：全部规则落在媒体查询里，
         桌面端一条都不生效（像素零变化）。几何仍取宿主令牌，插件只表达意图：
         触控目标、可折行、分隔符不悬空、安全区不重叠。 */
      @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
        /* 触控目标：整栏本身是一个 role=button。DSH Go 网页版对 [data-slot="main"] 里的
           button/[role=button] 强制 44px（assets/web/dsh_web_phone.css）；独立移动浏览器没有
           这条，这里补同一意图。min-height 只在单行时生效（多行本来就高），
           上下内边距保持 4px，避免为了触控把整条底栏撑高。 */
        .bi-root { min-height: 44px; padding: 4px 0 max(4px, env(safe-area-inset-bottom, 0px)); justify-content: center; }
        /* 折行：桌面上「一个字段组不拆行」是版式；窄屏下单个 nowrap 组（长模型名、三个订阅窗口、
           长错误提示、自定义文字）会撑破容器。允许组内折行，桌面端不变。 */
        .bi-root > .bi-row2 > span:not(.bi-tail) { white-space: normal; overflow-wrap: anywhere; }
        /* 分隔符是独立 flex 项：折行时会孤零零落在行首或行尾（320px 实测每行都有）。
           窄屏改用间距分组（组间 8px），分隔符不参与排版；圆环尾巴仍整体不折行，
           避免圆环被单独挤到下一行（2026-09-24 修过的回归）。 */
        .bi-root > .bi-row2, .bi-root > .bi-density-extra .bi-native-row { column-gap: 8px; }
        .bi-root > .bi-row2 > .bi-sep, .bi-root > .bi-density-extra .bi-native-row > .bi-sep { display: none; }
        /* 上下文圆环按钮原高 22px：用伪元素把命中区扩到 44px，而不把整行撑到 44px。
           DSH Go 网页版已由宿主对按钮强制 44px；独立移动浏览器用这条补同一意图。 */
        .bi-ctx-trigger { position: relative; }
        .bi-ctx-trigger::after { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 44px; transform: translateY(-50%); }
      }
      /* 横屏矮视口：把上下留白再压回一点，高度还给对话区。 */
      @media (orientation: landscape) and (max-height: 480px) {
        .bi-root { padding-top: 4px; padding-bottom: max(4px, env(safe-area-inset-bottom, 0px)); }
      }
      /* ---------- DSH Go 皮肤层：门控 + token（DESIGN-FINAL 定稿，只定义变量，不改现有视觉） ----------
         门控信号：:root[data-dsh-app-layout]（DSH Go 网页版）或 :root[data-dsh-go-island]
         （整页 WebView 岛，由模块级 dshGoSurfaceEnabled 从 hash / DshGoIsland 通道归一）。
         不再叠 pointer:coarse：DSH Go 在平板 / 大窗 / 鼠标环境里还是 DSH Go，皮肤跟着表面走，
         尺寸差异由断点处理。桌面 DSH 两者皆无 → 不生效，像素不变。
         数值唯一来源：.private/mobile-design/DESIGN-FINAL.md §1/§2/§3/§7（真机 412×915）。 */
      :root[data-dsh-app-layout], :root[data-dsh-go-island] {
        /* 颜色（§1） */
        --dshgo-accent: #4B67B4; --dshgo-accent-soft: #DEE8FF; --dshgo-danger: #A54743;
        --dshgo-bg-1: #F1F4FB; --dshgo-bg-2: #FAFBFE;
        --dshgo-surface: #FBFCFF; --dshgo-surface-low: #F6F9FE;
        --dshgo-ink: #1E232E; --dshgo-label: #4F5562; --dshgo-muted: #646974; --dshgo-faint: #646974; --dshgo-ghost: #A1A5AC;
        --dshgo-line: rgba(30, 35, 46, 0.07);
        --dshgo-card: rgba(255, 255, 255, 0.62); --dshgo-card-rim: rgba(255, 255, 255, 0.70);
        /* 卡片实体感：底色比页面背景亮一档 + 极轻投影，边界靠「亮 + 影 + 发丝线」三层，
           不靠色差（surface-low #F6F9FE 与背景 #FAFBFE 只差 4 个灰阶，白底上等于没有卡片）。 */
        --dshgo-card-bg: #FFFFFF;
        --dshgo-card-shadow: 0 1px 2px rgba(16, 24, 40, 0.05), 0 10px 24px -16px rgba(16, 24, 40, 0.26);
        /* 展开面板是「从卡片下方抽出的抽屉」：比卡片低一档，上层亮、下层沉，层次一眼分得开。 */
        --dshgo-sheet-bg: #F1F4FB;
        --dshgo-sheet-shadow: 0 12px 28px -20px rgba(16, 24, 40, 0.22);
        /* 几何（§3） */
        --dshgo-hairline: 0.5px;
        --dshgo-radius-card: 20px; --dshgo-radius-sheet: 28px; --dshgo-radius-control: 14px; --dshgo-radius-segment: 18px;
        --dshgo-page-x: 16px; --dshgo-config-page-x: 20px;
        --dshgo-gap: 8px; --dshgo-group-gap: 24px; --dshgo-card-pad: 16px; --dshgo-row-gap: 2px;
        --dshgo-row-h: 56px; --dshgo-row-h2: 64px; --dshgo-panel-row: 40px; --dshgo-panel-row2: 56px;
        --dshgo-switch-w: 52px; --dshgo-switch-h: 32px; --dshgo-switch-thumb: 28px;
        --dshgo-seg-h: 36px; --dshgo-seg-thumb: 30px;
        --dshgo-control-h: 44px;
        --dshgo-panel-max: 40vh;
        /* 字号 / 行高（§2） */
        --dshgo-font-title: 26px; --dshgo-font-panel-title: 16px; --dshgo-font-value: 16px;
        --dshgo-font-row: 15px; --dshgo-font-label: 14px; --dshgo-font-setting: 14px;
        --dshgo-font-desc: 13px; --dshgo-font-caption: 12px; --dshgo-font-micro: 11px;
        --dshgo-lh-value: 20px; --dshgo-lh-panel: 22px; --dshgo-lh-body: 1.4; --dshgo-lh-desc: 1.45;
        --dshgo-safe-bottom: var(--dsh-app-inset-bottom, env(safe-area-inset-bottom, 0px));
      }
      :root[data-dsh-app-layout] body[data-ds-dark-theme], :root[data-dsh-go-island] body[data-ds-dark-theme] {
        --dshgo-accent: #97B1F0; --dshgo-accent-soft: #2E3C5F; --dshgo-danger: #E69089;
        --dshgo-bg-1: #1D222C; --dshgo-bg-2: #171920;
        --dshgo-surface: #232730; --dshgo-surface-low: #232730;
        --dshgo-ink: #E6E9F0; --dshgo-label: #B6BBC5; --dshgo-muted: #9A9EA9; --dshgo-faint: #9A9EA9; --dshgo-ghost: #656971;
        --dshgo-line: rgba(230, 233, 240, 0.08);
        --dshgo-card: rgba(255, 255, 255, 0.05); --dshgo-card-rim: rgba(255, 255, 255, 0);
        /* 暗色里投影没有意义（背景比卡片更暗），修正一层：卡片比背景亮一档自身就是边界。 */
        --dshgo-card-bg: #232730; --dshgo-card-shadow: none;
        --dshgo-sheet-bg: #1F232C; --dshgo-sheet-shadow: none;
      }
      /* ---------- DSH Go 信息栏三列卡 + 展开面板（DESIGN-FINAL §3/§4/§5；无分割线） ----------
         只在 Go 表面内生效；三档断点：≤360 收边距降字号、360–599 定稿值、≥600 收版心居中。
         三列之间不画竖线：页边 16、间隙用 space-between 均分；卡内行间 2px 空隙、分组 16。 */
      /* 卡片与上方内容（DSH Go 宿主自带的原生统计行 / 对话区）之间留 8px 呼吸：
         宿主那行 pill 是它自己的 DOM，删不得，只能把卡片往下让一档，两者才不会粘成一片。 */
      /* 一个容器承载「条 + 明细」：收起时卡面在 strip 上，展开时卡面整个交给容器，
         strip 与 sheet 都变成内部区域（无边框、无间距、无第二层背景），
         所以展开后是同一张卡往下长，而不是条下面再摆一张卡。 */
      :root[data-dsh-app-layout] .bi-go-card, :root[data-dsh-go-island] .bi-go-card { display: block; width: calc(100% - var(--dshgo-page-x, 16px) * 2); box-sizing: border-box; margin: var(--dshgo-gap, 8px) auto 0; padding: 0; }
      :root[data-dsh-app-layout] .bi-go-card[data-open="1"], :root[data-dsh-go-island] .bi-go-card[data-open="1"] { overflow: hidden; border: var(--dshgo-hairline, 0.5px) solid var(--dshgo-line); border-radius: var(--dshgo-radius-card, 20px); background: var(--dshgo-card-bg, #FFFFFF); box-shadow: var(--dshgo-card-shadow, none); }
      :root[data-dsh-app-layout] .bi-root.bi-go-bar, :root[data-dsh-go-island] .bi-root.bi-go-bar { display: block; width: 100%; max-width: 100%; min-height: 0; padding: 0; margin: 0; box-sizing: border-box; cursor: pointer; text-align: left; }
      /* 三列卡已承载完整信息：原生统计行在 Go 模式整体隐藏（结构保留，靠 CSS 收合，不条件渲染）。 */
      :root[data-dsh-app-layout] .bi-root.bi-go-bar .bi-density-extra, :root[data-dsh-go-island] .bi-root.bi-go-bar .bi-density-extra { display: none; }
      /* 宿主 StatsPills 直挂在同一个 composer.dock slot 里，与插件根是兄弟；
         Go 模式下它的内容全部在「原生信息」分组里有了，样式又是宿主自己的，故收合。 */
      :root[data-dsh-app-layout] [data-slot="conversation.composer.dock"] > span:not([class*="bi-"]),
      :root[data-dsh-go-island] [data-slot="conversation.composer.dock"] > span:not([class*="bi-"]) { display: none !important; }
      :root[data-dsh-app-layout] .bi-go-row2, :root[data-dsh-go-island] .bi-go-row2 { display: block; width: 100%; }
      :root[data-dsh-app-layout] .bi-go-strip, :root[data-dsh-go-island] .bi-go-strip { display: flex; align-items: center; justify-content: space-between; gap: 10px; box-sizing: border-box; width: 100%; height: 56px; padding: 0 16px; border: var(--dshgo-hairline, 0.5px) solid var(--dshgo-line); border-radius: var(--dshgo-radius-card, 20px); background: var(--dshgo-card-bg, #FFFFFF); box-shadow: var(--dshgo-card-shadow, none); overflow: hidden; -webkit-tap-highlight-color: transparent; transition: background-color 120ms linear; }
      :root[data-dsh-app-layout] .bi-go-strip:active, :root[data-dsh-go-island] .bi-go-strip:active { background: color-mix(in srgb, var(--dshgo-ink) 6%, var(--dshgo-card-bg, #FFFFFF)); }
      /* 三列按内容宽度排布，再用 space-between 均分剩余空间：
         首列贴左页边、末列贴右页边、三块之间的两个间隙严格相等。
         如果用等分网格再各自左对齐，末列内容短的时候右边就会空出一大块。 */
      :root[data-dsh-app-layout] .bi-go-col, :root[data-dsh-go-island] .bi-go-col { display: flex; flex: 0 1 auto; flex-direction: column; align-items: flex-start; justify-content: center; min-width: 0; max-width: calc((100% - 20px) / 3); padding: 0; }
      :root[data-dsh-app-layout] .bi-go-col:last-child, :root[data-dsh-go-island] .bi-go-col:last-child { align-items: flex-end; text-align: right; }
      /* 列内元素按内容收缩（不撑满列宽），但不得超过列宽，省略号才会正常出现。 */
      :root[data-dsh-app-layout] .bi-go-col > .bi-go-cap, :root[data-dsh-go-island] .bi-go-col > .bi-go-cap,
      :root[data-dsh-app-layout] .bi-go-col > .bi-go-val, :root[data-dsh-go-island] .bi-go-col > .bi-go-val,
      :root[data-dsh-app-layout] .bi-go-col > .bi-go-ringrow, :root[data-dsh-go-island] .bi-go-col > .bi-go-ringrow { max-width: 100%; }
      :root[data-dsh-app-layout] .bi-go-cap, :root[data-dsh-go-island] .bi-go-cap { margin-bottom: 2px; font-size: var(--dshgo-font-caption, 12px); font-weight: 500; line-height: 16px; letter-spacing: 0.2px; color: var(--dshgo-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      :root[data-dsh-app-layout] .bi-go-val, :root[data-dsh-go-island] .bi-go-val { font-size: var(--dshgo-font-value, 16px); font-weight: 600; line-height: var(--dshgo-lh-value, 20px); color: var(--dshgo-ink); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      :root[data-dsh-app-layout] .bi-go-val--shrink, :root[data-dsh-go-island] .bi-go-val--shrink { font-size: 11px; letter-spacing: -0.5px; }
      :root[data-dsh-app-layout] .bi-go-val--low, :root[data-dsh-go-island] .bi-go-val--low { color: var(--dshgo-danger); }
      :root[data-dsh-app-layout] .bi-go-ph, :root[data-dsh-go-island] .bi-go-ph { display: block; width: 64px; max-width: 100%; height: 10px; margin-top: 6px; border-radius: 4px; background: var(--dshgo-ghost); opacity: 0.34; }
      :root[data-dsh-app-layout] .bi-go-ringrow, :root[data-dsh-go-island] .bi-go-ringrow { display: flex; align-items: center; gap: 5px; min-width: 0; }
      :root[data-dsh-app-layout] .bi-go-ring, :root[data-dsh-go-island] .bi-go-ring { flex: none; display: block; }
      :root[data-dsh-app-layout] .bi-go-ring-track, :root[data-dsh-go-island] .bi-go-ring-track { stroke: var(--dshgo-line); }
      :root[data-dsh-app-layout] .bi-go-ring-fill, :root[data-dsh-go-island] .bi-go-ring-fill { stroke: var(--dshgo-accent); }
      /* 展开面板：卡内无分割线（行间 2px、分组 16）；动作行无上边框，靠 16 上间距 + 右对齐。 */
      :root[data-dsh-app-layout] .bi-go-sheet, :root[data-dsh-go-island] .bi-go-sheet { flex: 0 0 100%; order: 2; box-sizing: border-box; display: flex; flex-direction: column; max-height: var(--dshgo-panel-max, 40vh); margin: var(--dshgo-gap, 8px) 0 0; overflow: hidden; border: var(--dshgo-hairline, 0.5px) solid var(--dshgo-line); border-radius: var(--dshgo-radius-sheet, 28px); background: var(--dshgo-sheet-bg, #F1F4FB); box-shadow: var(--dshgo-sheet-shadow, none); color: var(--dshgo-ink); text-align: left; }
      :root[data-dsh-app-layout] .bi-go-card[data-open="1"] .bi-go-strip, :root[data-dsh-go-island] .bi-go-card[data-open="1"] .bi-go-strip { border: 0; border-radius: 0; box-shadow: none; background: transparent; }
      :root[data-dsh-app-layout] .bi-go-card[data-open="1"] .bi-go-strip:active, :root[data-dsh-go-island] .bi-go-card[data-open="1"] .bi-go-strip:active { background: transparent; }
      :root[data-dsh-app-layout] .bi-go-card[data-open="1"] .bi-go-sheet, :root[data-dsh-go-island] .bi-go-card[data-open="1"] .bi-go-sheet { margin: 0; border: 0; border-radius: 0; box-shadow: none; background: transparent; }
      :root[data-dsh-app-layout] .bi-go-sheet-head, :root[data-dsh-go-island] .bi-go-sheet-head { display: flex; align-items: center; justify-content: space-between; min-height: 48px; padding: 0 8px 0 16px; flex: none; }
      :root[data-dsh-app-layout] .bi-go-sheet-title, :root[data-dsh-go-island] .bi-go-sheet-title { font-size: var(--dshgo-font-panel-title, 16px); font-weight: 600; line-height: 1.4; color: var(--dshgo-ink); }
      :root[data-dsh-app-layout] .bi-go-sheet-body, :root[data-dsh-go-island] .bi-go-sheet-body { flex: 1 1 auto; min-height: 0; padding: 0 16px 16px; overflow: hidden auto; overscroll-behavior: contain; }
      :root[data-dsh-app-layout] .bi-go-sheet-body[data-more="1"], :root[data-dsh-go-island] .bi-go-sheet-body[data-more="1"] { -webkit-mask-image: linear-gradient(to bottom, #000 0, #000 calc(100% - 24px), transparent 100%); mask-image: linear-gradient(to bottom, #000 0, #000 calc(100% - 24px), transparent 100%); }
      :root[data-dsh-app-layout] .bi-go-sec, :root[data-dsh-go-island] .bi-go-sec { margin-top: var(--dshgo-section-gap, 16px); }
      :root[data-dsh-app-layout] .bi-go-sec:first-child, :root[data-dsh-go-island] .bi-go-sec:first-child { margin-top: 0; }
      :root[data-dsh-app-layout] .bi-go-sec-lbl, :root[data-dsh-go-island] .bi-go-sec-lbl { margin: 0 0 4px; font-size: var(--dshgo-font-caption, 12px); font-weight: 600; line-height: 16px; letter-spacing: 0.4px; color: var(--dshgo-muted); }
      :root[data-dsh-app-layout] .bi-go-rows, :root[data-dsh-go-island] .bi-go-rows { display: flex; flex-direction: column; gap: var(--dshgo-row-gap, 2px); }
      :root[data-dsh-app-layout] .bi-go-row, :root[data-dsh-go-island] .bi-go-row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; min-height: var(--dshgo-panel-row, 40px); padding: 8px 0; box-sizing: border-box; }
      :root[data-dsh-app-layout] .bi-go-row--sub, :root[data-dsh-go-island] .bi-go-row--sub { min-height: var(--dshgo-panel-row2, 56px); align-items: flex-start; }
      :root[data-dsh-app-layout] .bi-go-k, :root[data-dsh-go-island] .bi-go-k { flex: none; font-size: var(--dshgo-font-label, 14px); line-height: var(--dshgo-lh-panel, 22px); color: var(--dshgo-muted); }
      :root[data-dsh-app-layout] .bi-go-v-wrap, :root[data-dsh-go-island] .bi-go-v-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 0; text-align: right; }
      :root[data-dsh-app-layout] .bi-go-v, :root[data-dsh-go-island] .bi-go-v { font-size: var(--dshgo-font-row, 15px); font-weight: 600; line-height: var(--dshgo-lh-panel, 22px); color: var(--dshgo-ink); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      :root[data-dsh-app-layout] .bi-go-v--low, :root[data-dsh-go-island] .bi-go-v--low { color: var(--dshgo-danger); }
      :root[data-dsh-app-layout] .bi-go-small, :root[data-dsh-go-island] .bi-go-small { font-size: var(--dshgo-font-caption, 12px); font-weight: 400; line-height: 16px; color: var(--dshgo-muted); }
      :root[data-dsh-app-layout] .bi-go-progress, :root[data-dsh-go-island] .bi-go-progress { display: block; width: 132px; max-width: 100%; height: 4px; margin-top: 3px; border-radius: 2px; background: var(--dshgo-line); overflow: hidden; }
      :root[data-dsh-app-layout] .bi-go-progress-fill, :root[data-dsh-go-island] .bi-go-progress-fill { display: block; height: 100%; border-radius: 2px; background: var(--dshgo-accent); }
      :root[data-dsh-app-layout] .bi-go-progress--low .bi-go-progress-fill, :root[data-dsh-go-island] .bi-go-progress--low .bi-go-progress-fill { background: var(--dshgo-danger); }
      /* 额度行整行宽两段式：头行左窗口名/右百分比+倒计时，进度条铺满整行，消除右侧窄列留下的大片左空白。 */
      :root[data-dsh-app-layout] .bi-go-row--meter, :root[data-dsh-go-island] .bi-go-row--meter { flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 6px; }
      :root[data-dsh-app-layout] .bi-go-meter-head, :root[data-dsh-go-island] .bi-go-meter-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
      :root[data-dsh-app-layout] .bi-go-meter-val, :root[data-dsh-go-island] .bi-go-meter-val { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
      :root[data-dsh-app-layout] .bi-go-row--meter .bi-go-progress, :root[data-dsh-go-island] .bi-go-row--meter .bi-go-progress { width: 100%; margin-top: 0; }
      /* 标题行唯一动作「刷新」：15/600 accent、右对齐、44 热区（用户拍板 A：收起靠点信息栏本体）。 */
      :root[data-dsh-app-layout] .bi-go-act, :root[data-dsh-go-island] .bi-go-act { display: inline-flex; align-items: center; min-height: 44px; margin-left: auto; padding: 0 8px; border: 0; border-radius: 12px; background: transparent; color: var(--dshgo-accent); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
      :root[data-dsh-app-layout] .bi-go-act:active, :root[data-dsh-go-island] .bi-go-act:active { opacity: 0.7; }
      :root[data-dsh-app-layout] .bi-go-empty, :root[data-dsh-go-island] .bi-go-empty { padding: 8px 0 4px; font-size: 13px; line-height: var(--dshgo-lh-value, 20px); color: var(--dshgo-muted); }
      /* ---------- DSH Go 窄屏自适应（≤360，SE 一档） ----------
         412 定稿的 12px 列内边距 + 16px 数值在 320 上放不下：可用宽只剩 60px，
         「¥123万」和「上下文用量」都会被省略号吞掉。窄屏收边距并各降一档字号，
         宁可小一档也不丢信息。必须写成组合媒体查询（CSS 不支持 @media 套 @media）。 */
      @media (max-width: 360px) {
        :root[data-dsh-app-layout] .bi-go-strip, :root[data-dsh-go-island] .bi-go-strip { gap: 8px; padding: 0 12px; }
        :root[data-dsh-app-layout] .bi-go-col, :root[data-dsh-go-island] .bi-go-col { max-width: calc((100% - 16px) / 3); }
        :root[data-dsh-app-layout] .bi-go-cap, :root[data-dsh-go-island] .bi-go-cap { font-size: 11px; letter-spacing: 0.1px; }
        :root[data-dsh-app-layout] .bi-go-val, :root[data-dsh-go-island] .bi-go-val { font-size: 15px; }
        :root[data-dsh-app-layout] .bi-go-val--shrink, :root[data-dsh-go-island] .bi-go-val--shrink { font-size: 12px; letter-spacing: -0.3px; }
        :root[data-dsh-app-layout] .bi-go-card[data-open="1"] .bi-go-strip, :root[data-dsh-go-island] .bi-go-card[data-open="1"] .bi-go-strip { border: 0; border-radius: 0; box-shadow: none; background: transparent; }
        :root[data-dsh-app-layout] .bi-go-card[data-open="1"] .bi-go-strip:active, :root[data-dsh-go-island] .bi-go-card[data-open="1"] .bi-go-strip:active { background: transparent; }
        :root[data-dsh-app-layout] .bi-go-card[data-open="1"] .bi-go-sheet, :root[data-dsh-go-island] .bi-go-card[data-open="1"] .bi-go-sheet { margin: 0; border: 0; border-radius: 0; box-shadow: none; background: transparent; }
        :root[data-dsh-app-layout] .bi-go-sheet-head, :root[data-dsh-go-island] .bi-go-sheet-head { padding: 0 8px 0 14px; }
      }
      /* ---------- DSH Go 宽屏自适应（≥600，平板竖屏 / 桌面浏览器大窗） ----------
         卡片始终跟输入框同宽（100% − 16 页边），宽出来的空间不放空、也不把三列硬拉开：
         ① 收起态按宽度递进补列（今天 / 近 30 天 / 累计），一屏能看到的花费越来越多；
         ② 展开面板 ≥760 变双栏，同一块 40vh 高度里一屏能读完两倍的行。
         形态仍是 Go 的卡（20 圆角 / 发丝线 / 三列语言），不退回桌面那条双行 pill。 */
      @media (min-width: 600px) {
        :root[data-dsh-app-layout] .bi-go-strip, :root[data-dsh-go-island] .bi-go-strip { padding: 0 20px; }
        :root[data-dsh-app-layout] .bi-go-sheet-head, :root[data-dsh-go-island] .bi-go-sheet-head { padding: 0 8px 0 20px; }
        :root[data-dsh-app-layout] .bi-go-sheet-body, :root[data-dsh-go-island] .bi-go-sheet-body { padding: 0 20px 20px; }
      }
      /* 增量列默认不占位：DOM 里存在，display:none 后不参与 space-between 的分配，
         手机档与定稿逐像素一致。 */
      :root[data-dsh-app-layout] .bi-go-col[data-extra], :root[data-dsh-go-island] .bi-go-col[data-extra] { display: none; }
      @media (min-width: 760px) {
        :root[data-dsh-app-layout] .bi-go-col[data-extra="1"], :root[data-dsh-go-island] .bi-go-col[data-extra="1"] { display: flex; }
        /* 用百分比而不是 fr：信息栏样式表里有「不得出现 fr 轨道」的节奏锁（历史回归）。 */
        :root[data-dsh-app-layout] .bi-go-sheet-body, :root[data-dsh-go-island] .bi-go-sheet-body {
          display: grid; grid-template-columns: calc(50% - 22px) calc(50% - 22px);
          column-gap: 44px; row-gap: 24px; align-items: start;
        }
        :root[data-dsh-app-layout] .bi-go-sheet-body .bi-go-sec, :root[data-dsh-go-island] .bi-go-sheet-body .bi-go-sec { margin-top: 0; }
        :root[data-dsh-app-layout] .bi-go-progress, :root[data-dsh-go-island] .bi-go-progress { width: 160px; }
      }
      /* 档位按「加一列后列间距仍落在 ~160px」推出来，而不是拍数字：
         4 列 = 40 内边距 + 222 内容 + 3×160 ≈ 736 卡宽（视口 768）；
         5 列 ≈ 990 卡宽（视口 1022）；6 列 ≈ 1206 卡宽（视口 1238）。
         取 760 / 960 / 1180 留出余量，顺带让 1024、1280 这两个常见窗口
         各自落进正确档位——否则 1024 会卡在 1040 门口，中间空出一大片。 */
      @media (min-width: 960px) {
        :root[data-dsh-app-layout] .bi-go-col[data-extra="2"], :root[data-dsh-go-island] .bi-go-col[data-extra="2"] { display: flex; }
      }
      @media (min-width: 1180px) {
        :root[data-dsh-app-layout] .bi-go-col[data-extra="3"], :root[data-dsh-go-island] .bi-go-col[data-extra="3"] { display: flex; }
      }
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
const FIELD_GROUP_ORDER = /*__FIELD_GROUP_ORDER__*/[];
const FIELD_GROUP_LABELS = /*__FIELD_GROUP_LABELS__*/{};
// 三组的分工说明（2026-09-25 用户拍板新增第三组「提醒信息」）：只在这里给「整组一句」，
// 不在每个字段上重复解释 —— 字段行的小字继续只讲「什么条件下会出现」。
// 这一句也是唯一说明「开关与显示模式的关系」的地方，不另设模式开关。
const FIELD_GROUP_DESC_KEYS = { native: 'group.native.desc', plugin: 'group.plugin.desc' };
// 设置页小节（顺序 + 标题 + 一句话说明），构建时从 src/constants.js 注入。
// 只有「插件信息」这一组有 section；native / notice 两个组本来就只有一块，不设小节。
const FIELD_SECTIONS = /*__FIELD_SECTIONS__*/[];
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
           --bib-btn-h/radius/pad/font  primitives Button.module.css .sm { 28 / 8 / 0 10 / 12 18 }
           --bib-input-h/radius/pad/font  primitives settings-form fields.module.css .input { 34 / 12 / 0 12 / 13 }

         2026-10-13 / DSH 0.2.0-rc.2 复测（安装版 app.asar；重点是圆角，其余数字顺手复核）：
           · Button.module.css：.button 声明 border-radius: var(--dsw-radius-md)，.sm 覆盖为
             var(--dsw-radius-sm)；tokens --dsw-radius-sm = 8px → 按钮圆角 8px（旧注释写 14，订正）。
           · settings-form fields.module.css：.input 的 border-radius: var(--dsw-radius-md) = 12px
             （旧注释写 8，订正；兜底输入框随之改为单独取 --dsw-radius-md，见变量块里的注释）。
           · 其余与旧注释一致、未改：.sm { 28 / 12 / 0 10 / 12 18 } 与 .input { 34 / 0 12 / 13 /
             .5px border-l4 / bg-layer-3 }；tokens --dsw-radius-xs/sm/md/lg = 4 / 8 / 12 / 16。

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
        /* 2026-11-12 设计体系迁移（DSH 0.2.2 settings-form 实测）：
           原生设置表单已经卡片化 —— tUAPGa_rowCard { .5px settings-card-stroke / settings-card-fill /
           radius-xl / 12px 14px 内衬 }，卡片列表 rows { gap:8px }，字段 .field { 列向 gap:6px }，
           行与行、组与组之间**没有任何分隔线**，分层全靠留白与卡片表面。
           本页随之整体迁移：区块 = 设置卡（fill + stroke + radius-xl），行间只留白，废除全部发丝线。 */
        --bib-sec-gap: 24px;      /* 卡片之间（页面留白） */
        --bib-sec-inner: 12px;    /* 卡片内部（标题/行/提示条之间的节奏） */
        --bib-card-fill: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.05)));
        --bib-card-stroke: var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4, rgba(128,128,128,0.22)));
        --bib-card-radius: var(--dsw-radius-xl, 20px);
        --bib-card-pad-block: 14px; --bib-card-pad-inline: 16px;
        --bib-group-gap: 16px;
        --bib-head-gap: 10px;
        --bib-title-size: 14px; --bib-title-weight: 500; --bib-title-line: 20px;
        --bib-sub-label-size: 12px; --bib-sub-label-weight: 600; --bib-sub-label-line: 18px;
        --bib-desc-size: 13px; --bib-desc-line: 18px;
        --bib-row-pad-block: 8px; --bib-row-pad-inline: 10px;
        --bib-row-gap: 16px;
        --bib-row-label-size: 13.5px; --bib-row-label-weight: 500; --bib-row-label-line: 20px;
        --bib-row-hint-size: 11.5px; --bib-row-hint-line: 16px;
        --bib-control-radius: 8px;
        --bib-btn-height: 28px; --bib-btn-radius: var(--bib-control-radius); --bib-btn-pad-inline: 10px; --bib-btn-size: 12px; --bib-btn-line: 18px;
        /* 兜底输入框（老宿主取不到 primitives）：几何照宿主 0.2.2 settings-form fields.module.css 的 .input
           —— 32px / r12 / 0 10px / 14px / .5px border-l4 / bg-layer-1（2026-11-12 复测 tUAPGa_input）。
           圆角必须单独取 --dsw-radius-md（12px），**不能**跟 --bib-control-radius（8px）走：后者管的是
           行 hover 填充、色块、警示条、分段控件槽那类「8px 形状」，两者形状不同。 */
        --bib-input-height: 32px; --bib-input-radius: var(--dsw-radius-md, 12px); --bib-input-pad-inline: 10px; --bib-input-size: 14px;
        --bib-input-bg: var(--dsw-alias-bg-layer-1, transparent);
        --bib-swatch-size: 20px; --bib-swatch-radius: var(--bib-control-radius);
        --bib-menu-dot-size: 12px;
        box-sizing: border-box; max-inline-size: 100%; min-inline-size: 0;
      }
      .bib-settings, .bib-settings * { box-sizing: border-box; }
      /* 2026-10-14：页面标题与 .bib-set-page-head 一并删除——详情页顶部已由宿主渲染插件名与简介。
         区块标题一律走 .bib-set-card-title（14/500/20），不需要第二套字号。 */
      /* 只保留 DSH 设置面板这一层纵向滚动：根节点比宿主视口多 2px，确保收起时也会
         进入同一个滚动状态；插件自身和字段清单不再创建第二、第三条滚动轨道。
         注意：这里**不能**设 px 级 max-width（见上面「宽度铁律」）。 */
      .bib-settings { display: flex; flex: 0 0 auto; align-self: stretch; width: 100%; inline-size: 100%; max-inline-size: 100%; min-width: 0; min-inline-size: 0; min-height: calc(100% + 2px); min-block-size: calc(100% + 2px); overflow: visible; contain: inline-size; flex-direction: column; gap: var(--bib-sec-gap); color: var(--dsw-alias-label-primary); }
      /* 仅隐藏视觉轨道，不关闭滚动能力；宿主标记由组件生命周期维护。 */
      .bib-settings, .bib-set-field-list, [data-dsh-bib-hide-scrollbars="true"] { scrollbar-width: none; -ms-overflow-style: none; }
      .bib-settings::-webkit-scrollbar, .bib-set-field-list::-webkit-scrollbar, [data-dsh-bib-hide-scrollbars="true"]::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      /* 区块说明：原生 pageIntro 的 13/20 二级色（宿主 .X_2TxG_pageIntro）。 */
      /* 搜索行：独立一张安静的面（卡片内首行），不再画下边线 —— 行间分层只靠留白。 */
      .bib-set-toolbar { width: 100%; max-width: 100%; min-width: 0; min-inline-size: 0; box-sizing: border-box; padding: 0; }
      .bib-set-search-row { display: block; width: 100%; min-width: 0; min-height: var(--bib-input-height); padding: 0 0 8px; }
      .bib-set-search-shell { position: relative; width: 100%; min-width: 0; }
      .bib-set-search { box-sizing: border-box; display: block; width: 100%; height: var(--bib-input-height); min-height: var(--bib-input-height); padding: 0 30px 0 var(--bib-input-pad-inline); border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--bib-input-radius); background: var(--bib-input-bg); color: var(--dsw-alias-label-primary); font: inherit; font-size: var(--bib-input-size); line-height: 1.5; }
      .bib-set-search::placeholder { color: var(--dsw-alias-label-tertiary); }
      .bib-set-search:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 1px; }
      .bib-set-count { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
      /* ===== 区块：2026-11-12 迁移到 DSH 0.2.2 原生设置表单的卡片语法（tUAPGa_rowCard）=====
         原生设置表单（模型/凭据/服务器等配置页）现在是一张张设置卡：
           rowCard { border:.5px settings-card-stroke; background:settings-card-fill;
                     border-radius:radius-xl(20px); padding:12px 14px; 内部 column gap:12px }
           rows    { 列向 gap:8px，无分隔线 }
         行与行、组与组之间没有任何线 —— 分层靠卡片表面 + 留白。本页所有顶层区块跟随该语法：
         .bib-set-card--panel 即一张设置卡；内部行保留两栏语法但废除发丝线，
         行自带 8px 纵向留白与 8px 圆角 hover 填充（宿主 --dsw-alias-interactive-bg-hover）。 */
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
      /* 扁平化之后分组就是一条条相邻的行，行间靠 .5px 分割线，不再留 16px 卡片间距
         （宿主 .rows 也是 gap:0）。 */
      .bib-set-field-list { gap: 0; }
      /* 2026-10-14：区块去卡片化。原先每组/每区都是「描边 + 8px 圆角 + 底色」的卡片，
         与姊妹插件的扁平列表（标题 + 右控件 + 分割线）不是一套东西。现在只留一条 1px 顶线
         做区块分界（照姊妹插件的 .cgpt-updates：border-top 1px border-primary + padding-top 16px），
         组内/行间的分隔一律靠 .5px 分割线。 */
      .bib-set-group { display: flex; flex-direction: column; gap: 0; width: 100%; inline-size: 100%; max-width: 100%; max-inline-size: 100%; min-width: 0; min-inline-size: 0; }
      /* 区块即设置卡：表面/描边/圆角/内衬全部取宿主 rowCard 同款 token（值见 token 层注释）。
         卡片自身不再画任何线 —— 区块与区块之间只有 --bib-sec-gap 的留白。 */
      .bib-set-card--panel { border: 0.5px solid var(--bib-card-stroke); background: var(--bib-card-fill); border-radius: var(--bib-card-radius); padding: var(--bib-card-pad-block) var(--bib-card-pad-inline); }
      .bib-set-group-head { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .bib-set-group-label { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--bib-title-size); font-weight: var(--bib-title-weight); line-height: var(--bib-title-line); color: var(--dsw-alias-label-primary); }
      /* 分组说明（三组区分 + 模式归属）走次要色 12/1.5，与字段行小字同一套排版基线。 */
      /* 分组说明与行说明同一套排版基线（11.5/16 三级色），不再自带 12/1.5 那一档。 */
      .bib-set-group-desc { display: block; min-width: 0; font-size: var(--bib-row-hint-size); font-weight: 400; line-height: var(--bib-row-hint-line); color: var(--dsw-alias-label-tertiary); }
      /* 小节：只做阅读分组，让「余额制 / 订阅制 / 账单制 / 通用」一眼分得开。
         三级层级不变：卡片标题 14/500 主色 → 小节眉 12/600 次色单行眉题 → 字段行 13.5/500 主色。
         节与节之间不再画线，只靠眉题上方的留白分组（12px 眉题 + 8px 行距）。 */
      .bib-set-subsection { display: flex; flex-direction: column; gap: 0; min-width: 0; }
      .bib-set-subsection-head { display: flex; flex-direction: row; align-items: baseline; gap: 8px; min-width: 0; padding: 16px var(--bib-row-pad-inline) 2px; }
      .bib-set-subsection-label { flex: none; min-width: 0; font-size: var(--bib-sub-label-size); font-weight: var(--bib-sub-label-weight); line-height: var(--bib-sub-label-line); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
      .bib-set-subsection-desc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--bib-sub-label-size); font-weight: 400; line-height: var(--bib-sub-label-line); color: var(--dsw-alias-label-tertiary); }
      /* 分组头也是一行：左「名称 + 分工说明」、右「展开/收起 + 箭头」，几何与 .bib-set-row 同源
         （8px 10px 内边距 + 8px 圆角），整块仍是可点击面；行间不再画线。 */
      .bib-set-group-fallback-head { appearance: none; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--bib-row-gap); width: 100%; min-width: 0; box-sizing: border-box; margin: 0; padding: var(--bib-row-pad-block) var(--bib-row-pad-inline); border: 0; border-radius: var(--bib-control-radius); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background-color 120ms ease; }
      .bib-set-group-fallback-head:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.06)); }
      .bib-set-group-fallback-head:focus-visible { position: relative; z-index: 1; outline: 2px solid var(--bib-set-brand); outline-offset: -2px; }
      /* 展开/收起不再用品牌蓝：宿主自己的 DisclosureRow 是三级色起、hover 升二级色，
         姊妹插件的行里也没有任何彩色文字。统一成中性色，hover 时提一级。 */
      .bib-set-group-action { display: inline-flex; align-items: center; gap: 4px; flex: none; color: var(--dsw-alias-label-secondary); font-size: 13px; font-weight: 500; line-height: 20px; white-space: nowrap; }
      .bib-set-group-fallback-head:hover .bib-set-group-action { color: var(--dsw-alias-label-primary); }
      .bib-set-group-action .bib-set-chevron { color: currentColor; }
      .bib-set-group .bib-set-body { padding: 0; }
      /* 行 = 设置卡内的标准行：两栏语法不变（左「标题 + 说明」、右控件），但废除 .5px 下边线 ——
         行与行之间只有行自带的 8px 纵向留白（两行相邻 = 16px 呼吸）。
         行是可交互面：8px 圆角 + hover 浅填充（宿主 --dsw-alias-interactive-bg-hover，
         ≈6% 墨色，与原生设置卡的行 hover 同款），指针扫过时行自己浮起来。 */
      .bib-set-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--bib-row-gap); width: 100%; min-width: 0; box-sizing: border-box; margin: 0; padding: var(--bib-row-pad-block) var(--bib-row-pad-inline); border: 0; border-radius: var(--bib-control-radius); transition: background-color 120ms ease; }
      .bib-set-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.06)); }
      .bib-set-collapse-inner > .bib-set-row:last-child { padding-bottom: var(--bib-row-pad-block); }
      .bib-set-row--field { flex-direction: column; align-items: stretch; gap: 0; }
      /* 字段行 = 单行网格：「标签」col1、「开关」col2、「色块」col3。不再有第二行
         （决策 1：调色板收进色块弹层；决策 3：时区/格式/自定义文字拆去独立设置区）。
         fallback（宿主无 Menu）时控件块仍按 grid-column: 1 / -1 落第二行，见 .bib-set-controls--field。 */
      .bib-set-row-main { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; column-gap: var(--bib-row-gap); row-gap: 8px; align-items: start; width: 100%; min-width: 0; }
      /* 只有开关、没有颜色控件的行（新宿主两个原生按钮）：去掉空的第三列，避免多出一段栏间距。 */
      .bib-set-row-main--switch-only { grid-template-columns: minmax(0, 1fr) auto; }
      /* 语言下拉的兜底形态（仅老宿主没有原生 Menu 时走）：几何照宿主 .input —— 34px 高 / r12 /
         0.5px border-l4 / bg-layer-3 / 13px，与同一页的输入框、时区下拉同高同形。
         原生 Menu 分支不读这条规则（锚点是宿主 Button，外观归宿主）。 */
      .bib-set-language { box-sizing: border-box; height: var(--bib-input-height); max-width: 100%; min-width: 0; padding: 0 var(--bib-input-pad-inline); border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--bib-input-radius); background: var(--bib-input-bg); color: var(--dsw-alias-label-primary); font: inherit; font-size: var(--bib-input-size); line-height: 1.5; }
      /* 行内两栏 = 宿主 .rowLine(flex/gap16) + .rowMain(flex:1/column/gap2)：
         文字块吃掉剩余宽度，控件自然贴右，不再靠 space-between 硬推。 */
      .bib-set-rowText { display: flex; flex-direction: column; flex: 1; gap: 2px; min-width: 0; }
      .bib-set-rowText--field { min-width: 0; }
      /* 行标题照原生 .X_2TxG_rowId：13.5/500/20。 */
      .bib-set-rowTitle { display: flex; align-items: center; gap: 6px; font-size: var(--bib-row-label-size); font-weight: var(--bib-row-label-weight); line-height: var(--bib-row-label-line); color: var(--dsw-alias-label-primary); }
      /* margin 必须清零：<p> 的浏览器默认上下边距（1em）会把每一行顶高 23px，
         行高变成 86px 而不是 62px——正是「比姊妹插件的行更松散」的来源。 */
      .bib-set-rowDesc { margin: 0; font-size: var(--bib-row-hint-size); line-height: var(--bib-row-hint-line); color: var(--dsw-alias-label-tertiary); }
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
      /* ===== 原生输入框衔接（2026-10-13）=====
         宿主原生 Input 的外观（边框 / 底色 / 圆角 / 焦点态）全部交还宿主；插件只补三类声明：
         ① 布局（整行宽度 / 不拉伸）② 宿主没有的 hex 等宽 + 固定宽度 ③ 宿主没有的非法态描红。
         绝不把 .bib-set-search / .bib-set-custom-text-input / .bib-set-hex 这些自绘外观类挂给原生 Input——
         同特异性 + 插件样式后插入 = 反向覆盖宿主（与原生 Button / Switch 同一个坑）。 */
      .bib-set-input { min-width: 0; }
      .bib-set-input--block { display: flex; width: 100%; min-inline-size: 0; }
      /* placeholder 可读性修正（2026-11-13，浅色主题实测）：宿主原生 Input 的 ::placeholder
         在浅色主题下渲染成近白（rgb(225,229,238)），插件页搜索框/凭据输入框在浅色卡片上
         几乎不可读——DSH 自己的会话搜索框用的是 tertiary（#81858c），两级明显不一致。
         这里把插件域内的原生 Input placeholder 统一取宿主自己的 --dsw-alias-label-tertiary，
         明暗两主题都不劣化；宿主将来修正 placeholder 色后这条可整体移除。 */
      .bib-set-input input::placeholder { color: var(--dsw-alias-label-tertiary); opacity: 1; }
      /* 行内右栏的输入框：宽度收窄到一栏控件的量级（与下拉触发器同宽），不铺满整行。
         只声明布局宽度，边框/底色/圆角/焦点态仍全部由宿主 Input 维护。 */
      .bib-set-input--field { display: flex; flex: none; width: 260px; max-width: 100%; min-inline-size: 0; }
      .bib-set-input--hex { flex: none; }
      .bib-set-input--hex input { flex: none; width: 96px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .bib-set-input--invalid { border-color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error, #d92d20)); }
      /* ===== 原生分段控件衔接（2026-10-13）=====
         原生 SegmentedControl 是 inline-grid：落进列向 flex 会被默认的 stretch 拉满整行，
         这里只把布局收口（外观仍全部交还宿主）。 */
      .bib-set-segmented { align-self: flex-start; max-width: 100%; min-width: 0; }
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
      /* 参数区（时区 / 自定义文字 / 额度凭据）行与字段节的通用几何。
         【对齐铁律】行 / 字段节 / 组头 / 可点击卡头的横向内衬只用于 hover 填充外扩，
         文字必须仍压在卡面 16px 内衬线上 —— 用负 margin 抵掉横向 padding。
         没有这条，行内文字会比卡头缩进多 10px，出现「标题一层缩进、行文字另一层缩进」
         的碎节奏（2026-11-12 用户截图点名）。 */
      .bib-set-row, .bib-set-fieldblock, .bib-set-data-row, .bib-set-group-fallback-head,
      .bib-set-subsection-head, .bib-set-field, .bib-set-card-header:not(.bib-set-card-header--static) { margin-inline: calc(-1 * var(--bib-row-pad-inline)); }
      .bib-set-fieldblock { display: flex; flex-wrap: wrap; align-items: center; gap: var(--bib-row-gap); min-width: 0; box-sizing: border-box; padding: var(--bib-row-pad-block) var(--bib-row-pad-inline); border: 0; border-radius: var(--bib-control-radius); transition: background-color 120ms ease; }
      .bib-set-fieldblock:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.06)); }
      /* 行左侧的「标题 + 说明」两行堆叠（与 .bib-set-rowText 同构）。 */
      .bib-set-fieldblock-copy { display: flex; flex-direction: column; flex: 1; gap: 2px; min-width: 0; }
      .bib-set-fieldblock-label { flex: none; min-width: 0; font-size: var(--bib-row-label-size); font-weight: var(--bib-row-label-weight); line-height: var(--bib-row-label-line); color: var(--dsw-alias-label-primary); }
      /* 行右侧的控件列：竖排（控件在下、计数/说明在上或下）时右对齐，单控件时也走这一层。 */
      .bib-set-fieldblock-control { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none; min-width: 0; }
      /* 需要横跨整行的附属说明（如分段控件的 tabpanel）：换行到控件下方，仍是同一行的一部分。 */
      .bib-set-fieldblock-panel { flex: 1 0 100%; }
      .bib-set-fieldblock-hint { margin: 0; font-size: var(--bib-row-hint-size); line-height: var(--bib-row-hint-line); color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
      /* ===== 字段节（2026-11-12 体系化）=====
         参数型字段（凭据、自定义文字）照 DSH 0.2.2 原生 settings-form 的 .field 语法排：
         列向 gap 6px —— 第一行「标签 + 状态」、第二行说明、第三行控件（输入框满宽 + 动作按钮同行）。
         与两栏「行」是两套语义：行承载开关与入口（copy 左 + 控件右），字段节承载输入。
         凭据行原先把三行文字挤在左、窄输入框和孤立按钮堆在右，正是没有这套语义的产物
         （2026-11-12 用户在真实客户端截图点名「突然多出来两节」）。 */
      .bib-set-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; box-sizing: border-box; padding: var(--bib-row-pad-block) var(--bib-row-pad-inline); border: 0; border-radius: var(--bib-control-radius); transition: background-color 120ms ease; }
      .bib-set-field:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.06)); }
      .bib-set-field-head { display: flex; align-items: center; justify-content: space-between; gap: var(--bib-row-gap); min-width: 0; }
      .bib-set-field-label { flex: none; min-width: 0; font-size: var(--bib-row-label-size); font-weight: var(--bib-row-label-weight); line-height: var(--bib-row-label-line); color: var(--dsw-alias-label-primary); }
      .bib-set-field-hint { margin: 0; font-size: var(--bib-row-hint-size); line-height: var(--bib-row-hint-line); color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
      .bib-set-field-control { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 6px; min-width: 0; }
      /* 字段节里的输入框吃满剩余宽度：512 长度的凭据值在 260px 窄框里没法核对首尾。
         原生分支吃 layout 类（--block），兜底分支吃外观类，两条都要覆盖。 */
      .bib-set-field-control .bib-set-input--block,
      .bib-set-field-control .bib-set-credential-input { flex: 1 1 240px; }
      /* 状态胶囊：与信息栏软底徽章同一语言（14% 同色底 + 999 胶囊）。已配置=次要色胶囊、
         未配置=三级色裸文字 —— 一眼分出两态，不引入红绿装饰色。 */
      .bib-set-status-pill { display: inline-flex; align-items: center; height: 16px; padding: 0 7px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-secondary) 14%, transparent); color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 600; line-height: 1; white-space: nowrap; }
      .bib-set-status-plain { font-size: var(--bib-row-hint-size); line-height: var(--bib-row-hint-line); color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
      .bib-set-custom-text-input { box-sizing: border-box; width: 100%; height: var(--bib-input-height); padding: 0 var(--bib-input-pad-inline); border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--bib-input-radius); background: var(--bib-input-bg); color: var(--dsw-alias-label-primary); font: inherit; font-size: var(--bib-input-size); line-height: 1.5; }
      /* v1.24.0：额度凭据输入框与自定义文字同一套自绘外观（宿主没有原生 Input 时走这里）。
         独立声明块而不是合并选择器：几何守卫按类逐个检查 --bib-input-radius。 */
      .bib-set-credential-input { box-sizing: border-box; width: 260px; max-width: 100%; height: var(--bib-input-height); padding: 0 var(--bib-input-pad-inline); border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--bib-input-radius); background: var(--bib-input-bg); color: var(--dsw-alias-label-primary); font: inherit; font-size: var(--bib-input-size); line-height: 1.5; }
      .bib-set-custom-text-input:focus-visible, .bib-set-credential-input:focus-visible, .bib-set-time-zone:focus-visible, .bib-set-language:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 1px; }
      .bib-set-time-zone { box-sizing: border-box; height: var(--bib-input-height); max-width: 100%; min-width: 0; padding: 0 var(--bib-input-pad-inline); border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--bib-input-radius); background: var(--bib-input-bg); color: var(--dsw-alias-label-primary); font: inherit; font-size: var(--bib-input-size); line-height: 1.5; }
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
      .bib-set-reset-row { margin-top: 4px; }
      .bib-set-reset-row .bib-set-data-copy { display: flex; flex-direction: column; gap: 2px; }
      /* 按钮优先渲染宿主原生 Button（.sm = h28 / r8 / 12px / 0 10px）；
         下面这份只是宿主没有 Button 时的等价兜底。 */
      .bib-set-btn { appearance: none; font: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; height: var(--bib-btn-height); border: 0.5px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); background: transparent; border-radius: var(--bib-btn-radius); padding: 0 var(--bib-btn-pad-inline); font-size: var(--bib-btn-size); font-weight: 400; line-height: var(--bib-btn-line); transition: background-color 120ms ease, border-color 120ms ease; }
      .bib-set-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); border-color: var(--dsw-alias-border-l3); }
      .bib-set-btn:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 2px; }
      .bib-set-btn:disabled { opacity: 0.5; cursor: default; }
      .bib-set-notice { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; flex: 1 1 auto; min-width: 0; }
      .bib-set-data-actions { display: flex; flex-direction: column; gap: 2px; width: 100%; min-width: 0; box-sizing: border-box; margin: 0; padding: 0; }
      /* 账单数据行同样是设置卡内的标准行几何（8px 10px 内衬 + 圆角 hover，无线）。 */
      .bib-set-data-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--bib-row-gap); width: 100%; min-width: 0; padding: var(--bib-row-pad-block) var(--bib-row-pad-inline); border: 0; border-radius: var(--bib-control-radius); transition: background-color 120ms ease; }
      .bib-set-data-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.06)); }
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
      /* DSH Go 皮肤层：token 定义在 installStyles 的 :root 门控块里（同一文档只定义一次），
         设置页规则只消费 --dshgo-*，不重复定义；视觉规则等 design-go v2 稿再落地。 */
      /* ---------- DSH Go 配置页（DESIGN-FINAL §2/§3/§6；412×915；卡内无分割线） ----------
         只在 Go 表面内生效；桌面设置页结构/像素不变。控件全部自绘，数值走 --dshgo-* token。 */
      :root[data-dsh-app-layout] .bib-go-page, :root[data-dsh-go-island] .bib-go-page { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; padding: 16px var(--dshgo-config-page-x, 20px) calc(24px + var(--dshgo-safe-bottom, 0px)); background: linear-gradient(180deg, var(--dshgo-bg-1), var(--dshgo-bg-2)); color: var(--dshgo-ink); display: flex; flex-direction: column; gap: var(--dshgo-group-gap, 24px); }
      :root[data-dsh-app-layout] .bib-go-head, :root[data-dsh-go-island] .bib-go-head { padding: 0 0 0; }
      :root[data-dsh-app-layout] .bib-go-title, :root[data-dsh-go-island] .bib-go-title { margin: 0; font-size: var(--dshgo-font-title, 26px); font-weight: 600; line-height: 1.3; letter-spacing: 0; color: var(--dshgo-ink); }
      :root[data-dsh-app-layout] .bib-go-subtitle, :root[data-dsh-go-island] .bib-go-subtitle { margin: 8px 0 0; font-size: var(--dshgo-font-row, 15px); font-weight: 400; line-height: 1.45; color: var(--dshgo-muted); }
      :root[data-dsh-app-layout] .bib-go-section, :root[data-dsh-go-island] .bib-go-section { display: flex; flex-direction: column; gap: var(--dshgo-gap, 8px); }
      :root[data-dsh-app-layout] .bib-go-section-label, :root[data-dsh-go-island] .bib-go-section-label { padding: 0 4px; font-size: var(--dshgo-font-desc, 13px); font-weight: 600; line-height: 1.4; color: var(--dshgo-muted); }
      :root[data-dsh-app-layout] .bib-go-hint, :root[data-dsh-go-island] .bib-go-hint { margin: 0; padding: 0 4px; font-size: var(--dshgo-font-desc, 13px); line-height: 1.45; color: var(--dshgo-muted); }
      :root[data-dsh-app-layout] .bib-go-card, :root[data-dsh-go-island] .bib-go-card { box-sizing: border-box; width: 100%; min-width: 0; padding: 4px 0; border: var(--dshgo-hairline, 0.5px) solid var(--dshgo-line); border-radius: var(--dshgo-radius-card, 20px); background: var(--dshgo-card); box-shadow: inset 0 0 0 0.5px var(--dshgo-card-rim); }
      :root[data-dsh-app-layout] .bib-go-srow, :root[data-dsh-go-island] .bib-go-srow { display: flex; align-items: center; gap: 12px; min-height: var(--dshgo-row-h, 56px); padding: 0 16px; box-sizing: border-box; }
      :root[data-dsh-app-layout] .bib-go-srow--tall, :root[data-dsh-go-island] .bib-go-srow--tall { min-height: var(--dshgo-row-h2, 64px); }
      :root[data-dsh-app-layout] .bib-go-srow-main, :root[data-dsh-go-island] .bib-go-srow-main { flex: 1 1 auto; min-width: 0; }
      :root[data-dsh-app-layout] .bib-go-srow-title, :root[data-dsh-go-island] .bib-go-srow-title { font-size: var(--dshgo-font-row, 15px); font-weight: 600; line-height: 1.4; color: var(--dshgo-ink); }
      :root[data-dsh-app-layout] .bib-go-srow-desc, :root[data-dsh-go-island] .bib-go-srow-desc { margin-top: 2px; font-size: var(--dshgo-font-desc, 13px); font-weight: 400; line-height: 1.45; color: var(--dshgo-muted); }
      :root[data-dsh-app-layout] .bib-go-srow-control, :root[data-dsh-go-island] .bib-go-srow-control { flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
      :root[data-dsh-app-layout] .bib-go-group-label, :root[data-dsh-go-island] .bib-go-group-label { padding: 12px 16px 4px; font-size: var(--dshgo-font-caption, 12px); font-weight: 600; line-height: 1.4; letter-spacing: 0.4px; color: var(--dshgo-muted); }
      :root[data-dsh-app-layout] .bib-go-group-label:first-child, :root[data-dsh-go-island] .bib-go-group-label:first-child { padding-top: 8px; }
        :root[data-dsh-app-layout] .bib-go-switch, :root[data-dsh-go-island] .bib-go-switch { position: relative; flex: none; width: var(--dshgo-switch-w, 52px); height: var(--dshgo-switch-h, 32px); padding: 0; border: 0; border-radius: var(--dshgo-radius-pill, 999px); background: var(--dshgo-surface-low); box-shadow: inset 0 0 0 var(--dshgo-hairline, 0.5px) var(--dshgo-line); cursor: pointer; transition: background-color 160ms ease; }
        /* 描边走 inset 阴影而不是 border：0.5px 的 border 会被浏览器取整成 1px，
           上下各吃掉 1px 后轨道内高只剩 30，28 的滑块贴底、右侧顶边 —— 看起来整排开关都是歪的。 */
        :root[data-dsh-app-layout] .bib-go-switch--on, :root[data-dsh-go-island] .bib-go-switch--on { background: var(--dshgo-accent); box-shadow: none; }
      :root[data-dsh-app-layout] .bib-go-switch-thumb, :root[data-dsh-go-island] .bib-go-switch-thumb { position: absolute; top: 2px; left: 2px; width: var(--dshgo-switch-thumb, 28px); height: var(--dshgo-switch-thumb, 28px); display: flex; align-items: center; justify-content: center; border-radius: var(--dshgo-radius-pill, 999px); background: #fff; color: var(--dshgo-accent); transition: transform 160ms ease; }
      :root[data-dsh-app-layout] .bib-go-switch--on .bib-go-switch-thumb, :root[data-dsh-go-island] .bib-go-switch--on .bib-go-switch-thumb { transform: translateX(20px); }
      :root[data-dsh-app-layout] .bib-go-seg, :root[data-dsh-go-island] .bib-go-seg { display: inline-flex; align-items: center; gap: 2px; padding: 3px; height: var(--dshgo-seg-h, 36px); box-sizing: border-box; border-radius: var(--dshgo-radius-segment, 18px); background: var(--dshgo-surface-low); border: var(--dshgo-hairline, 0.5px) solid var(--dshgo-line); }
      :root[data-dsh-app-layout] .bib-go-seg-opt, :root[data-dsh-go-island] .bib-go-seg-opt { appearance: none; height: var(--dshgo-seg-thumb, 30px); padding: 0 12px; border: 0; border-radius: calc(var(--dshgo-radius-segment, 18px) - 2px); background: transparent; color: var(--dshgo-muted); font: inherit; font-size: var(--dshgo-font-setting, 14px); font-weight: 400; cursor: pointer; white-space: nowrap; }
      :root[data-dsh-app-layout] .bib-go-seg-opt--active, :root[data-dsh-go-island] .bib-go-seg-opt--active { background: var(--dshgo-accent-soft); color: var(--dshgo-ink); font-weight: 600; }
      :root[data-dsh-app-layout] .bib-go-btn, :root[data-dsh-go-island] .bib-go-btn { appearance: none; min-height: var(--dshgo-control-h, 44px); padding: 0 16px; border: var(--dshgo-hairline, 0.5px) solid var(--dshgo-line); border-radius: var(--dshgo-radius-control, 14px); background: var(--dshgo-surface); color: var(--dshgo-ink); font: inherit; font-size: var(--dshgo-font-row, 15px); font-weight: 600; cursor: pointer; }
      :root[data-dsh-app-layout] .bib-go-btn--primary, :root[data-dsh-go-island] .bib-go-btn--primary { border-color: transparent; background: var(--dshgo-accent); color: #fff; }
      :root[data-dsh-app-layout] .bib-go-btn--danger, :root[data-dsh-go-island] .bib-go-btn--danger { border-color: var(--dshgo-danger); background: transparent; color: var(--dshgo-danger); }
      :root[data-dsh-app-layout] .bib-go-btn:disabled, :root[data-dsh-go-island] .bib-go-btn:disabled { opacity: 0.5; cursor: default; }
      :root[data-dsh-app-layout] .bib-go-disclosure, :root[data-dsh-go-island] .bib-go-disclosure { display: block; }
      :root[data-dsh-app-layout] .bib-go-disclosure-head, :root[data-dsh-go-island] .bib-go-disclosure-head { display: flex; align-items: center; gap: 12px; width: 100%; min-height: var(--dshgo-row-h, 56px); padding: 0 16px; border: 0; background: transparent; text-align: left; font: inherit; cursor: pointer; box-sizing: border-box; }
      :root[data-dsh-app-layout] .bib-go-chevron, :root[data-dsh-go-island] .bib-go-chevron { flex: none; display: flex; align-items: center; justify-content: center; color: var(--dshgo-faint); transition: transform 160ms ease; }
      :root[data-dsh-app-layout] .bib-go-chevron--up, :root[data-dsh-go-island] .bib-go-chevron--up { transform: rotate(180deg); }
      :root[data-dsh-app-layout] .bib-go-disclosure-body, :root[data-dsh-go-island] .bib-go-disclosure-body { padding-bottom: 4px; }
      :root[data-dsh-app-layout] .bib-go-static-row, :root[data-dsh-go-island] .bib-go-static-row { display: flex; align-items: center; min-height: 44px; padding: 0 16px; box-sizing: border-box; }
      :root[data-dsh-app-layout] .bib-go-actions, :root[data-dsh-go-island] .bib-go-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 8px; min-width: 0; padding: 8px 16px; }
      @media (max-width: 600px) {
        :root[data-dsh-app-layout] .bib-go-srow--stack, :root[data-dsh-go-island] .bib-go-srow--stack { flex-direction: column; align-items: stretch; gap: 8px; }
        :root[data-dsh-app-layout] .bib-go-srow--stack .bib-go-srow-control, :root[data-dsh-go-island] .bib-go-srow--stack .bib-go-srow-control { flex: none; justify-content: flex-start; }
      }
      /* 预览卡与真实卡同一套几何（2026-11-13 用户指出）：56 高、20 圆角、16 页边、
         三列按 content 均分且无 chevron；不再用 28px 箭头列和每列 12px 内边距把比例拉歪。 */
      :root[data-dsh-app-layout] .bib-go-preview, :root[data-dsh-go-island] .bib-go-preview { display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 100%; padding: 0 16px; box-sizing: border-box; }
      :root[data-dsh-app-layout] .bib-go-preview-col, :root[data-dsh-go-island] .bib-go-preview-col { display: flex; flex: 0 1 auto; flex-direction: column; align-items: flex-start; justify-content: center; min-width: 0; max-width: calc((100% - 20px) / 3); padding: 0; }
      :root[data-dsh-app-layout] .bib-go-preview-col:last-child, :root[data-dsh-go-island] .bib-go-preview-col:last-child { align-items: flex-end; text-align: right; }
      :root[data-dsh-app-layout] .bib-go-preview-cap, :root[data-dsh-go-island] .bib-go-preview-cap { margin-bottom: 2px; font-size: var(--dshgo-font-caption, 12px); font-weight: 500; line-height: 16px; letter-spacing: 0.2px; color: var(--dshgo-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      :root[data-dsh-app-layout] .bib-go-preview-val, :root[data-dsh-go-island] .bib-go-preview-val { font-size: var(--dshgo-font-value, 16px); font-weight: 600; line-height: var(--dshgo-lh-value, 20px); color: var(--dshgo-ink); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      :root[data-dsh-app-layout] .bib-go-preview-ring, :root[data-dsh-go-island] .bib-go-preview-ring { display: flex; align-items: center; gap: 5px; color: var(--dshgo-accent); }
      :root[data-dsh-app-layout] .bib-go-preview-ring span, :root[data-dsh-go-island] .bib-go-preview-ring span { color: var(--dshgo-ink); }
      :root[data-dsh-app-layout] .bib-go-preview-card, :root[data-dsh-go-island] .bib-go-preview-card { height: 56px; padding: 0; box-sizing: border-box; }
      :root[data-dsh-app-layout] .bib-go-feedback, :root[data-dsh-go-island] .bib-go-feedback { padding: 0 4px; font-size: var(--dshgo-font-desc, 13px); color: var(--dshgo-muted); }
      :root[data-dsh-app-layout] .bib-go-footer, :root[data-dsh-go-island] .bib-go-footer { padding: 8px 4px 0; text-align: center; font-size: var(--dshgo-font-caption, 12px); line-height: 1.5; color: var(--dshgo-faint); }
      :root[data-dsh-app-layout] .bib-go-page .bib-set-dots, :root[data-dsh-go-island] .bib-go-page .bib-set-dots { display: flex; align-items: center; gap: 6px; }
      :root[data-dsh-app-layout] .bib-go-page .bib-set-dot, :root[data-dsh-go-island] .bib-go-page .bib-set-dot { width: 28px; height: 28px; }
      /* 宽屏（平板 / 浏览器大窗）：Go 配置页按表单阅读宽度收在 720 居中；
         不铺满整屏，否则行标题与开关之间空出 1000px，眼睛要在两点之间来回找。 */
      @media (min-width: 600px) {
        :root[data-dsh-app-layout] .bib-go-page, :root[data-dsh-go-island] .bib-go-page { max-width: 720px; margin: 0 auto; padding: 24px var(--dshgo-config-page-x, 20px) calc(40px + var(--dshgo-safe-bottom, 0px)); }
      }
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

// 按钮：优先用宿主原生 Button（size=sm 即 28px、8px 圆角，与插件详情页的原生按钮同一套几何）。
// variant: 'outline' 普通、'primary' 主操作、'ghost' 无边框。
//
// 【原生分支只准挂布局类与插件专有态类】宿主按钮的外观规则（.button / .sm / .outline / hover /
// focus-visible / disabled）与插件规则特异性同为 (0,1,0)，而插件 <style> 后插入 —— 只要把
// .bib-set-btn 交给原生 Button，插件的边框/圆角/hover/焦点环/禁用不透明度就会反过来压过宿主，
// 宿主换皮时按钮也不跟随（与原生 Switch 同一个坑，见测试 ⑤-2 的取证）。
// 因此 .bib-set-btn 只服务兜底 <button>；原生分支最多挂两类：
//   · props.className            —— 调用方给的纯布局类（如 bib-set-select-trigger）
//   · .bib-set-btn--destructive  —— 宿主没有「危险按钮」变体，这一条外观必须由插件补。
function bibSetButton(props) {
  const variant = props.variant || (props.primary ? 'primary' : 'outline');
  const destructive = props.destructive ? ' bib-set-btn--destructive' : '';
  const layout = props.className ? ' ' + props.className : '';
  const children = props.children;
  // id / role / aria-label 原样透传：下拉锚点要靠 id 与左侧可见 <label for> 配对，
  // 原生按钮的 role/aria-* 也都是调用方给的语义，不该在包装层丢掉。
  const semantics = {
    id: props.id,
    role: props.role,
    'aria-label': props.ariaLabel,
    disabled: props.disabled === true,
    title: props.title,
    onClick: props.onClick,
  };
  if (BIB_SET_NATIVE_BUTTON) {
    return React.createElement(BIB_SET_NATIVE_BUTTON, Object.assign({}, semantics, {
      type: 'button',
      variant: variant,
      size: 'sm',
      className: (destructive + layout).trim() || undefined,
    }), children);
  }
  return React.createElement('button', Object.assign({}, semantics, {
    type: 'button',
    className: 'bib-set-btn' + destructive + layout,
  }), children);
}

// 文本输入：优先用宿主原生 Input（.wrap 的边框 / 底色 / 圆角 / 焦点态都由宿主维护）。
// 与 Button / Switch 同一条铁律：原生分支只挂布局类与宿主没有的插件态类，绝不把 .bib-set-*
// 的自绘外观交给宿主组件（同特异性 + 插件样式后插入 = 反向覆盖）。
//   attrs             —— 直接透传给 <input> 的属性（value / onChange / aria-* / data-* 等）
//   layout            —— 原生分支的附加布局类（bib-set-input 本体由本函数补）
//   fallbackClassName —— 宿主没有 Input 时使用的自绘外观类
function bibSetInput(props) {
  const attrs = props.attrs || {};
  if (BIB_SET_NATIVE_INPUT) {
    return React.createElement(BIB_SET_NATIVE_INPUT, Object.assign({}, attrs, {
      className: 'bib-set-input' + (props.layout ? ' ' + props.layout : ''),
    }));
  }
  return React.createElement('input', Object.assign({}, attrs, { className: props.fallbackClassName }));
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

// 下拉选择：浏览器原生 <select> 是操作系统自带的古老控件（灰色直角框 + 系统菜单），
// 与 DSH 的观感完全脱节。这里优先用宿主原生 Menu（锚点 = 原生 outline Button，列表 = 原生菜单卡片），
// 宿主没有 Menu 时才退回 <select>，保证老版本仍可用。
// 时区与语言两处共用这一条路径：锚点/弹层/选中态/关闭行为只有一套实现，
// 原生分支只给宿主组件挂布局类，形状/配色/hover/焦点态全部由宿主维护。
//   id / value / label / options([{id,label}]) / fallbackClassName / onChange
function bibSetSelect(props) {
  const [open, setOpen] = React.useState(false);
  const value = props.value;
  const options = props.options || [];
  if (!BIB_SET_NATIVE_MENU) {
    return React.createElement('select', {
      id: props.id,
      className: props.fallbackClassName,
      value: value,
      'aria-label': props.label,
      onChange: function (event) { props.onChange(event.target.value); },
    }, options.map(function (option) {
      return React.createElement('option', { key: option.id, value: option.id }, option.label);
    }));
  }
  let current = null;
  for (let i = 0; i < options.length; i++) {
    if (options[i].id === value) current = options[i];
  }
  const anchor = bibSetButton({
    id: props.id,
    variant: 'outline',
    className: 'bib-set-select-trigger' + (open ? ' bib-set-select-trigger--open' : ''),
    ariaLabel: props.label,
    title: props.label,
    onClick: function () { setOpen(!open); },
    children: [
      React.createElement('span', { key: 'v', className: 'bib-set-select-value' }, current ? current.label : String(value)),
      BIB_SET_CHEVRON_ICON
        ? React.createElement(BIB_SET_CHEVRON_ICON, { key: 'c', size: 14, className: 'bib-set-select-chevron' })
        : React.createElement('span', { key: 'c', className: 'bib-set-chevron-glyph bib-set-select-chevron' }),
    ],
  });
  return React.createElement(BIB_SET_NATIVE_MENU, {
    open: open,
    anchor: anchor,
    items: options.map(function (option) { return { id: option.id, label: option.label }; }),
    selectedId: value,
    onSelect: function (id) { setOpen(false); props.onChange(id); },
    onClose: function () { setOpen(false); },
    align: 'start',
    portal: true,
    className: 'bib-set-select',
  });
}

function bibSetTimeZonePicker(props) {
  return React.createElement(bibSetSelect, {
    value: props.value,
    label: props.label,
    options: TIME_ZONE_OPTIONS.map(function (z) { return { id: z, label: z }; }),
    fallbackClassName: 'bib-set-time-zone',
    onChange: props.onChange,
  });
}

// ---------- 页面组件 ----------
// 2026-10-14：页面内不再自造标题。宿主详情页顶部已经渲染了插件名（底部信息栏）与简介，
// 这里再写一个「信息栏」h1 就是同一件事说两遍——姊妹插件（dsh-chatgpt-sub）同样不放页面标题。
// 首渲保障不变：任何状态下都先输出「语言」这一行，页面不会是白屏。

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
  const description = props.description
    ? React.createElement('span', { className: 'bib-set-card-desc' }, props.description)
    : null;
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
      // 原生 Input 的非法态：宿主没有错误变体，插件用 .bib-set-input--invalid 补一条描红
      // （只覆盖 border-color，几何与焦点态仍归宿主）；兜底路径继续用 data-invalid 描红。
      return bibSetInput({
        layout: 'bib-set-input--hex' + (hexInvalid ? ' bib-set-input--invalid' : ''),
        fallbackClassName: 'bib-set-hex',
        attrs: {
          type: 'text',
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
        },
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
  // noColor 字段（新宿主两个原生按钮）只给开关：颜色由 Harness 自己决定，插件不提供假色块。
  let colorControl = null;
  if (field.noColor === true) {
    colorControl = null;
  } else if (BIB_SET_NATIVE_MENU) {
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
      bibSetInput({
        layout: 'bib-set-input--hex' + (hexInvalid ? ' bib-set-input--invalid' : ''),
        fallbackClassName: 'bib-set-hex',
        attrs: {
          type: 'text',
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
        },
      }));
  }

  const rowMain = React.createElement('div', { className: 'bib-set-row-main' + (field.noColor === true ? ' bib-set-row-main--switch-only' : '') },
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
  // 设置页只列「当前宿主真正有效」的开关：新宿主 = 两个原生按钮开关；旧宿主 = 旧统计行七个字段。
  // 桌面页再用 settingsFieldsForPage 去掉 goOnly 字段（只在 DSH Go 配置页出现）。
  const hostFields = settingsFieldsForPage(props.nativePills);
  for (let g = 0; g < FIELD_GROUP_ORDER.length; g++) {
    const group = FIELD_GROUP_ORDER[g];
    const groupFields = hostFields.filter(function (field) { return field.group === group; });
    if (groupFields.length === 0) continue;
    const visibleFields = groupFields.filter(function (field) { return props.matchesSearch(field, props.query); });
    // 搜索无命中的组整组不渲染（空状态由上层统一给出）
    if (props.searchActive && visibleFields.length === 0) continue;
    const groupLabel = FIELD_GROUP_LABELS[group] ? t(FIELD_GROUP_LABELS[group]) : group;
    // 组卡只保留名称、分工说明与明确的动作；状态数字会增加阅读负担。
    // 新宿主原生组只有两个「原生按钮」开关，说明文字必须换成按钮版（旧说明讲的是统计行七个字段）。
    const descKey = group === 'native' && props.nativePills
      ? 'group.native.desc.pills'
      : (props.nativePills && group === 'plugin' ? 'meta.description' : FIELD_GROUP_DESC_KEYS[group]);
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
  const zoneRow = function (key, labelKey, zone) {
    // 与「语言」卡同一行语义：label 左、控件右（B 型参数行）。select 右对齐后
    // 两行的控件边缘齐线，不再随 label 宽度漂移（2026-11-12 概览审计）。
    return React.createElement('div', { key: key, className: 'bib-set-fieldblock' },
      React.createElement('div', { className: 'bib-set-fieldblock-copy' },
        React.createElement('span', { className: 'bib-set-fieldblock-label' }, t(labelKey))),
      React.createElement('div', { className: 'bib-set-fieldblock-control' },
        React.createElement(bibSetTimeZonePicker, {
          label: t(labelKey),
          value: zone,
          onChange: function (value) { props.onTimeZoneChange(key === 'main-zone' ? 'main' : 'world', value); },
        })));
  };
  const blocks = [];
  if (mainOn) blocks.push(zoneRow('main-zone', 'ui.mainTimeZone', props.timeZonesOf().main));
  if (worldOn) blocks.push(zoneRow('world-zone', 'ui.worldTimeZone', props.timeZonesOf().world));
  return React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-labelledby': 'bib-set-time-date-title' },
    bibSetCardHeader({
      static: true,
      titleId: 'bib-set-time-date-title',
      title: t('ui.timeDateTitle'),
      description: t('ui.timeDateDesc'),
    }),
    React.createElement('div', { className: 'bib-set-fieldblocks' }, blocks));
}

// 「自定义文字」独立设置区（决策 3）：与其它区块同一张卡面 + 同一个一级卡头，
// 输入框是字段节（C 型）：控件满宽在上、字数提示在下（照原生 field「控件上、说明下」）。
// 对应开关关闭时整区隐藏。
function bibSetCustomTextSection(props) {
  if (!props.fieldOn('customText')) return null;
  return React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-labelledby': 'bib-set-custom-text-title' },
    bibSetCardHeader({
      static: true,
      titleId: 'bib-set-custom-text-title',
      // 与字段开关同一名字（field.customText.label「自定义文字」）：ui.customTextTitle 是
      // 「自定义文本」，同一东西两个名字会被读成两个功能（概览审计抓出）。
      title: t('field.customText.label'),
      description: t('ui.customTextSectionDesc'),
    }),
    React.createElement('div', { className: 'bib-set-fieldblocks' },
      React.createElement('div', { className: 'bib-set-field' },
        bibSetInput({
          layout: 'bib-set-input--block',
          fallbackClassName: 'bib-set-custom-text-input',
          attrs: {
            id: 'bib-set-custom-text-input',
            type: 'text',
            placeholder: t('ui.customTextPlaceholder'),
            maxLength: 64,
            value: props.customTextDraft !== null ? props.customTextDraft : props.customTextOf(),
            onChange: function (event) { props.onCustomTextChange(event.target.value); },
            onBlur: props.onCustomTextCommit,
            onKeyDown: function (event) { if (event.key === 'Enter') { event.preventDefault(); props.onCustomTextCommit(); } },
            'aria-label': t('field.customText.label'),
          },
        }),
        React.createElement('p', { className: 'bib-set-field-hint' },
          t('ui.customTextCount', { value: props.customTextOf().length })))));
}

// ===== 插件设置页的通用两段式分段控件 =====
// 最初只服务「订阅窗口百分比方向」（quotaDisplayMode），2026-09-25 起也服务「更新方式」
// （全自动更新 / 手动更新），因此取值归一改为可注入：默认仍是 normalizeQuotaDisplayMode，
// 别的用途必须显式传 normalize —— 否则非余额方向的值会被归一成 remaining，出现「两项都没选中」。
//
// 2026-10-13：优先渲染宿主原生 SegmentedControl（半透明轨道 + 白色滑块 + 主色文字，
// 与宿主自己的「添加方式」等两选一控件完全同一套外观，宿主换皮自动跟随）。
// 它的语义是 tablist：每个 tab 用 aria-controls 指向 <id>-<value>-panel，调用方必须把
// 对应的 tabpanel 一起渲染出来（本插件的两处用法都这样做，见 bibSetQuotaDisplaySection
// 与 bibSetVersionSection）——不渲染就会留下悬空引用。
//
// 兜底路径（老宿主没有该组件）仍是插件自绘的两段式：role=radiogroup + 子项 role=radio + aria-checked
// + roving tabindex，方向键 / Home / End 键盘可达（与色板圆点同一套交互约定）。
// 兜底选中态：background: var(--bib-set-brand-strong)（#4a63e8 同色相深档 × #fff = 4.95:1，
// 满足 AGENTS.md 对比度铁律 4.5:1 主句；#4d6bfe 实测只有 4.33:1 达不到）+ #fff + font-weight:600，
// hover 仍保持该深档、不跟随主题变浅。真实色值由 tests/test-quota-display-mode.js 做真实
// sRGB 相对亮度计算锁定（不用字符串断言代替）。
function bibSetQuotaMode(props) {
  const options = props.options || [
    { value: 'remaining', label: t('ui.quotaDisplayRemaining') },
    { value: 'used', label: t('ui.quotaDisplayUsed') },
  ];
  const normalize = typeof props.normalize === 'function' ? props.normalize : normalizeQuotaDisplayMode;
  const normalized = normalize(props.value);
  // 归一结果必须落在选项集合里：原生控件用「选中项的下标」摆滑块，落在集合外会让
  // selected = -1（滑块消失、所有 tab 的 tabIndex 都是 -1，整组不可 Tab）。落空时取第一项。
  const current = options.some(function (option) { return option.value === normalized; })
    ? normalized
    : options[0].value;
  if (BIB_SET_NATIVE_SEGMENTED) {
    return React.createElement(BIB_SET_NATIVE_SEGMENTED, {
      id: props.id || 'bib-set-quota-mode',
      value: current,
      options: options,
      label: props.label || t('ui.quotaDisplayModeTitle'),
      disabled: props.disabled === true,
      className: props.className,
      onChange: function (next) { if (props.onSelect) props.onSelect(next); },
    });
  }
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
const BIB_SET_QUOTA_MODE_ID = 'bib-set-quota-mode';
function bibSetQuotaDisplaySection(props) {
  const windowsOn = ['subWindow5h', 'subWindowWeek', 'subWindowMonth'].some(function (id) { return props.fieldOn(id); });
  if (!windowsOn) return null;
  const native = !!BIB_SET_NATIVE_SEGMENTED;
  const mode = normalizeQuotaDisplayMode(props.modeOf());
  const desc = t('ui.quotaDisplayModeDesc');
  // 原生分段控件是 tablist，用 aria-controls 指向 <id>-<value>-panel。宿主自己的用法是
  // 「两个 panel 都渲染、非选中项 hidden」，照做：页面上不留悬空引用，说明文案也就近放在控件下面
  // （与宿主「控件在上、说明在下」的排布一致）。兜底路径没有 tablist，说明仍留在区块头里。
  const panels = native ? ['remaining', 'used'].map(function (value) {
    return React.createElement('p', {
      key: value,
      id: BIB_SET_QUOTA_MODE_ID + '-' + value + '-panel',
      role: 'tabpanel',
      'aria-labelledby': BIB_SET_QUOTA_MODE_ID + '-' + value,
      className: 'bib-set-fieldblock-hint',
      hidden: value !== mode,
    }, desc);
  }) : null;
  // 卡头承载「标题」与其他区块同一层级；说明不进卡头 —— 原生分支里说明是选中的那条
  // 可见 tabpanel（控件下方，随选中项切换），卡头再放一份就是重复文案（概览审计抓出）；
  // 兜底分支没有 tabpanel，说明留在卡头。
  return React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-labelledby': 'bib-set-quota-mode-title' },
    bibSetCardHeader({
      static: true,
      titleId: 'bib-set-quota-mode-title',
      title: t('ui.quotaDisplayModeTitle'),
      description: native ? undefined : desc,
    }),
    React.createElement('div', { className: 'bib-set-fieldblocks' },
      React.createElement('div', { className: 'bib-set-field' },
        React.createElement('div', { className: 'bib-set-field-control' },
          React.createElement(bibSetQuotaMode, {
            id: BIB_SET_QUOTA_MODE_ID,
            label: t('ui.quotaDisplayModeTitle'),
            value: mode,
            onSelect: props.onModeChange,
            // 布局类：原生控件是 inline-grid，落在列向 flex 里会被 stretch 拉满整行；
            // 只做 align-self / 最大宽度这类布局声明，外观仍全部交还宿主。
            className: native ? 'bib-set-segmented' : null,
          })),
        native ? panels : null)));
}

// 设置区注册表：设置页的区块组成与顺序只在这里排。要加一个新区 = 在这张表里加一行，
// 不要在 InfoBarSettingsSection 的 return 里再插一段（体系统一化：加东西改 1 处）。
// 每行 render(ctx) 收到同一个上下文包；返回 null 的区不占位（与原来直写 null 一致）。

// ---------- v1.24.0：额度凭据设置区（阿里 AccessKey / Kimi Key）----------
// 目的：用户不看发布说明，也能在插件页里把「查额度需要的只读凭据」配好。
// 值由 host 侧写进 DSH 凭据存储（ctx.credentials.set → 本机 .credentials.yaml，0600），
// 插件自己的 settings.json 里不留明文，界面保存后也不再回显。
// v1.24.0：额度凭据目录（构建时从 src/constants.js 注入；新增额度来源只改那张表）
const CREDENTIAL_CATALOG = /*__CREDENTIAL_CATALOG__*/[];

function bibSetCredentialSourceLabel(source) {
  // 来源取自 DSH 凭据服务的 describe()：file / env / project-env / user-env（后两者是 .env 文件）
  if (source === 'file') return t('ui.credentialSourceFile');
  if (source === 'env') return t('ui.credentialSourceEnv');
  if (source === 'project-env') return t('ui.credentialSourceProjectEnv');
  if (source === 'user-env') return t('ui.credentialSourceUserEnv');
  if (typeof source === 'string' && source.length > 0) return source;
  return t('ui.credentialSourceOther');
}

// 把「设置页要渲染的凭据行」从 host 返回的 groups 拍平；老宿主还没实现该接口时，
// 退回目录表本身（状态未知、写入不可用），至少把「需要配什么」告诉用户。
function bibSetCredentialRowsFromCatalog(state) {
  const rows = [];
  const groups = state && Array.isArray(state.groups) ? state.groups : [];
  if (groups.length > 0) {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const credentials = group && Array.isArray(group.credentials) ? group.credentials : [];
      for (let j = 0; j < credentials.length; j++) {
        const c = credentials[j];
        if (!c || typeof c.ref !== 'string') continue;
        rows.push({
          ref: c.ref,
          providerLabel: (typeof group.labelKey === 'string' && group.labelKey.length > 0) ? t(group.labelKey) : (typeof group.label === 'string' && group.label.length > 0 ? group.label : t('ui.subscription')),
          labelText: (typeof c.labelKey === 'string' && c.labelKey.length > 0) ? t(c.labelKey) : null,
          hintText: (typeof c.hintKey === 'string' && c.hintKey.length > 0) ? t(c.hintKey) : t('ui.credentialGenericHint'),
          configured: c.configured === true,
          source: c.source || null,
          writable: c.writable !== false,
          kimiLoginReused: false,
        });
      }
    }
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].ref === 'KIMI_API_KEY' && !rows[i].configured && state && state.kimiLogin && state.kimiLogin.configured === true) {
        rows[i].kimiLoginReused = true;
      }
    }
    return rows;
  }
  for (let i = 0; i < CREDENTIAL_CATALOG.length; i++) {
    const entry = CREDENTIAL_CATALOG[i];
    const credentials = entry && Array.isArray(entry.credentials) ? entry.credentials : [];
    for (let j = 0; j < credentials.length; j++) {
      const c = credentials[j];
      if (!c || c.inline !== true || typeof c.ref !== 'string') continue;
      rows.push({
        ref: c.ref,
        providerLabel: (typeof entry.labelKey === 'string' && entry.labelKey.length > 0) ? t(entry.labelKey) : (typeof entry.label === 'string' && entry.label.length > 0 ? entry.label : t('ui.subscription')),
        labelText: (typeof c.labelKey === 'string' && c.labelKey.length > 0) ? t(c.labelKey) : null,
        hintText: (typeof c.hintKey === 'string' && c.hintKey.length > 0) ? t(c.hintKey) : t('ui.credentialGenericHint'),
        configured: false,
        source: null,
        writable: false,
        kimiLoginReused: false,
      });
    }
  }
  return rows;
}

// host groups（含 bound）或目录 fallback → 分组行视图。老宿主没返回 bound 时全部归「其他」。
// 行字段与 bibSetCredentialRowsFromCatalog 一致（labelText 通用模板键、hintText 悬停提示）。
function bibSetCredentialGroupsFromCatalog(state) {
  const makeRow = function (group, c, kimiLoginReused) {
    return {
      ref: c.ref,
      providerLabel: (typeof group.labelKey === 'string' && group.labelKey.length > 0) ? t(group.labelKey) : (typeof group.label === 'string' && group.label.length > 0 ? group.label : t('ui.subscription')),
      labelText: (typeof c.labelKey === 'string' && c.labelKey.length > 0) ? t(c.labelKey) : null,
      hintText: (typeof c.hintKey === 'string' && c.hintKey.length > 0) ? t(c.hintKey) : t('ui.credentialGenericHint'),
      configured: c.configured === true,
      source: c.source || null,
      writable: c.writable !== false,
      kimiLoginReused: kimiLoginReused === true,
    };
  };
  const hostGroups = state && Array.isArray(state.groups) ? state.groups : [];
  if (hostGroups.length > 0) {
    const kimiLoginOn = state && state.kimiLogin && state.kimiLogin.configured === true;
    const groups = [];
    for (let i = 0; i < hostGroups.length; i++) {
      const group = hostGroups[i];
      const credentials = group && Array.isArray(group.credentials) ? group.credentials : [];
      const rows = [];
      let kimiBound = false;
      for (let j = 0; j < credentials.length; j++) {
        const c = credentials[j];
        if (!c || typeof c.ref !== 'string') continue;
        const reused = c.ref === 'KIMI_API_KEY' && c.configured !== true && kimiLoginOn;
        if (reused) kimiBound = true;
        rows.push(makeRow(group, c, reused));
      }
      if (rows.length === 0) continue;
      groups.push({ id: group.id, providerLabel: rows[0].providerLabel, bound: group.bound === true || kimiBound, credentials: rows });
    }
    return groups;
  }
  // 目录 fallback（老宿主无接口）：只列目录里的 inline 凭据，状态未知、写入不可用。
  const groups = [];
  for (let i = 0; i < CREDENTIAL_CATALOG.length; i++) {
    const entry = CREDENTIAL_CATALOG[i];
    const credentials = entry && Array.isArray(entry.credentials) ? entry.credentials : [];
    const rows = [];
    for (let j = 0; j < credentials.length; j++) {
      const c = credentials[j];
      if (!c || c.inline !== true || typeof c.ref !== 'string') continue;
      rows.push(makeRow(entry, c, false));
    }
    if (rows.length === 0) continue;
    groups.push({ id: entry.id, providerLabel: rows[0].providerLabel, bound: false, credentials: rows });
  }
  return groups;
}

// 额度凭据卡的错误边界（2026-11-12）：卡内任何渲染错误都收敛成一张警示条，
// 不允许再出现「一个区块崩 → 整页设置打不开」（v1.24.1 事故）。宿主 React 缺少
// Component（极端老宿主）时退回直通组件，至少不比没有边界更差。
const bibCredentialsErrorBoundary = (typeof React === 'object' && React && typeof React.Component === 'function')
  ? class extends React.Component {
      constructor(props) { super(props); this.state = { failed: false }; }
      static getDerivedStateFromError() { return { failed: true }; }
      componentDidCatch(err) { try { console.warn('[dsh-bottom-info-bar] credentials card render failed: ' + ((err && err.message) || err)); } catch (e) { /* 日志失败无害 */ } }
      render() {
        if (this.state.failed) {
          return React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-labelledby': 'bib-set-credentials-title' },
            bibSetCardHeader({ static: true, titleId: 'bib-set-credentials-title', title: t('ui.credentialsTitle'), description: t('ui.credentialsDesc') }),
            bibSetAlert({ tone: 'error', children: t('ui.credentialCardCrashed') }));
        }
        return this.props.children;
      }
    }
  : function (props) { return props.children; };

// 额度凭据卡本体：真正的 React 组件。useState/useEffect 必须由 React 管理（v1.24.1 的 React #310
// 教训：折叠卡如果作为普通函数在父渲染里内联执行，函数体里的 hooks 实际挂在父组件上，
// 父渲染路径一变 hooks 计数就漂移，整个设置页崩）。
// 结构完全走插件体系：卡片头与其它区块同款（static 头 + 动态摘要做说明），
// 折叠用组卡同款的 bibSetDisclosure（展开/收起文字 + 原生箭头 + grid 收合动画），
// 行用 v1.24.0 的 fieldblock 基线（copy=标签+说明+状态，control=原生 Input+保存/清除）。
// 不自绘任何体系外的折叠头、组标题或展开按钮。
function bibCredentialsCard(props) {
  // 默认折叠（2026-11-12 用户拍板）：与「原生信息 / 插件信息」等折叠区块同一行为 ——
  // 卡头可点、右侧展开箭头，摘要（已绑定 / 未检测到）常驻说明位。
  const [open, setOpen] = React.useState(false);
  const state = props.credentialState;
  // 还没读到状态（首次加载/旧宿主没有该接口）时不显示"不支持写入"警告，避免闪一下；
  // 输入框在状态到达前保持禁用，读到 canWrite=true 后启用。
  const loaded = state !== null;
  const canWrite = loaded && state.canWrite === true;
  const drafts = props.credentialDrafts || {};
  const feedback = props.credentialFeedback;
  // 目录口径：只有必须单独填写额度凭据的服务商（当前仅阿里百炼）会出现。
  // 其余服务商全部复用推理 Key / 登录态自动检测，没在用就不占设置页一寸地方。
  const groups = bibSetCredentialGroupsFromCatalog(state);
  const boundGroups = groups.filter(function (g) { return g.bound; });
  const boundNames = boundGroups.map(function (g) { return g.providerLabel; });
  const summaryNames = boundNames.slice(0, 3).join('、') + (boundNames.length > 3 ? ' +' + String(boundNames.length - 3) : '');
  const summary = boundGroups.length > 0
    ? t('ui.credentialSummaryBound', { count: boundGroups.length, names: summaryNames })
    : t('ui.credentialSummaryNone');
  function renderRow(row) {
    const busy = props.credentialBusyRef === row.ref;
    const draft = typeof drafts[row.ref] === 'string' ? drafts[row.ref] : '';
    const labelId = 'bib-set-credential-' + row.ref + '-label';
    // 标签单一来源：有专属 labelKey 用专属文案，否则用通用模板键（{provider} · {ref}），
    // 不在客户端拼接字符串 —— 文案改一处即可，也不会绕开 locale 测试的键覆盖检查。
    const labelText = row.labelText || t('ui.credentialGenericLabel', { provider: row.providerLabel, ref: row.ref });
    const statusText = row.kimiLoginReused
      ? t('ui.credentialKimiLoginReused')
      : (row.configured
        ? t('ui.credentialConfigured', { source: bibSetCredentialSourceLabel(row.source) })
        : t('ui.credentialNotConfigured'));
    // 字段节（C 型，照原生 .field 列向语法）：「标签 + 状态」在上、说明居中、控件满宽在下。
    // 状态是同一行里与标签相对的胶囊/裸文字，不再混进说明堆里（2026-11-12 用户点名）。
    return React.createElement('div', { key: row.ref, className: 'bib-set-field' },
      React.createElement('div', { className: 'bib-set-field-head' },
        React.createElement('label', { id: labelId, htmlFor: 'bib-set-credential-' + row.ref, className: 'bib-set-field-label' }, labelText),
        row.configured
          ? React.createElement('span', { className: 'bib-set-status-pill' }, statusText)
          : React.createElement('span', { className: 'bib-set-status-plain' }, statusText)),
      React.createElement('span', { className: 'bib-set-field-hint' }, row.hintText),
      React.createElement('div', { className: 'bib-set-field-control' },
        bibSetInput({
          layout: 'bib-set-input--block',
          fallbackClassName: 'bib-set-credential-input',
          attrs: {
            id: 'bib-set-credential-' + row.ref,
            type: 'password',
            autoComplete: 'new-password',
            spellCheck: false,
            maxLength: 512,
            placeholder: t('ui.credentialPlaceholder'),
            value: draft,
            disabled: !canWrite || busy,
            onChange: function (event) { props.onCredentialDraft(row.ref, event && event.target ? event.target.value : ''); },
            'aria-labelledby': labelId,
          },
        }),
        bibSetButton({
          disabled: !canWrite || busy || draft.trim().length === 0,
          onClick: function () { props.onCredentialSave(row.ref); },
          children: t('ui.credentialSave'),
        }),
        row.configured ? bibSetButton({
          disabled: !canWrite || busy,
          onClick: function () { props.onCredentialClear(row.ref); },
          children: t('ui.credentialClear'),
        }) : null));
  }
  function renderRows(list) {
    const nodes = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list[i].credentials.length; j++) nodes.push(renderRow(list[i].credentials[j]));
    }
    return nodes;
  }
  // 卡头与「原生信息 / 插件信息」折叠组同一布局组件（bibSetDisclosure）：
  // 左侧「标题 + 摘要说明」、右侧「展开 / 收起 ⌄」——展开标识与其它区块逐字逐形一致
  //（2026-11-12 用户拍板：图标和“展开”两个字都要和其他的保持一样，布局组件写成同一个）。
  return React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-labelledby': 'bib-set-credentials-title' },
    React.createElement(bibSetDisclosure, {
      contentId: 'bib-set-credentials-body',
      open: open,
      onToggle: function () { setOpen(function (v) { return !v; }); },
      title: React.createElement('span', { className: 'bib-set-group-head' },
        React.createElement('span', { id: 'bib-set-credentials-title', className: 'bib-set-group-label' }, t('ui.credentialsTitle')),
        React.createElement('span', { className: 'bib-set-group-desc' }, summary)),
    },
      React.createElement('p', { className: 'bib-set-fieldblock-hint' }, t('ui.credentialGuide')),
      React.createElement('div', { className: 'bib-set-fieldblocks' }, renderRows(groups)),
      loaded && !canWrite ? bibSetAlert({ tone: 'warning', children: t('ui.credentialWriteUnsupported') }) : null,
      feedback ? bibSetAlert({ tone: feedback.tone || 'info', children: feedback.text }) : null,
      React.createElement('p', { className: 'bib-set-fieldblock-hint' }, t('ui.credentialStorageHint')),
      React.createElement('p', { className: 'bib-set-fieldblock-hint' }, t('ui.credentialFootnote'))));
}

// 设置页区块入口保持普通函数（render(deps) 内联调用）：hooks 全部在 bibCredentialsCard
// 这个真组件里，由 React 管理 —— 这里只做 createElement，任何渲染路径下 hooks 计数恒定。
function bibSetCredentialsSection(props) {
  return React.createElement(bibCredentialsErrorBoundary, { key: 'bib-credentials-card' },
    React.createElement(bibCredentialsCard, {
      credentialState: props.credentialState,
      credentialDrafts: props.credentialDrafts,
      credentialBusyRef: props.credentialBusyRef,
      credentialFeedback: props.credentialFeedback,
      onCredentialDraft: props.onCredentialDraft,
      onCredentialSave: props.onCredentialSave,
      onCredentialClear: props.onCredentialClear,
    }));
}

const BIB_SET_SECTIONS = [
  { id: 'timeDate', render: function (deps) { return bibSetTimeDateSection({ fieldOn: deps.fieldOn, timeZonesOf: deps.timeZonesOf, onTimeZoneChange: deps.setTimeZone }); } },
  { id: 'customText', render: function (deps) { return bibSetCustomTextSection({ fieldOn: deps.fieldOn, customTextDraft: deps.customTextDraft, customTextOf: deps.customTextOf, onCustomTextChange: deps.onCustomTextChange, onCustomTextCommit: deps.commitCustomText }); } },
  { id: 'quota', render: function (deps) { return bibSetQuotaDisplaySection({ fieldOn: deps.fieldOn, modeOf: deps.quotaDisplayModeOf, onModeChange: deps.setQuotaDisplayMode }); } },
  { id: 'credentials', render: function (deps) { return bibSetCredentialsSection({ credentialState: deps.credentialState, credentialDrafts: deps.credentialDrafts, credentialBusyRef: deps.credentialBusyRef, credentialFeedback: deps.credentialFeedback, onCredentialDraft: deps.onCredentialDraft, onCredentialSave: deps.onCredentialSave, onCredentialClear: deps.onCredentialClear }); } },
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
  if (payload && payload.downloadUrl === '/_dsh/dsh-bottom-info-bar/downloadUsageRecords') {
    if (typeof document === 'undefined' || !document.body) throw new Error(t('ui.exportNotSupported'));
    const link = document.createElement('a');
    link.href = payload.downloadUrl + '?format=' + (format === 'csv' ? 'csv' : 'json');
    link.download = 'dsh-bottom-info-bar-billing.' + (format === 'csv' ? 'csv' : 'json');
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    try { link.click(); } finally { if (link.parentNode) link.parentNode.removeChild(link); }
    return;
  }
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
// 重启方向：优先认 host 给的三分类 restartKind（'update' / 'rollback' / 'downgrade'）。
// 宿主还是旧版时（包文件已替换、DSH 没重启 —— 正是这块最常出问题的窗口）没有这个字段，
// 就用回滚记录现场判一次：只做字符串相等，不做版本比较（版本比较的唯一出口在 host）。
// 拿不到「用户点过回滚」的凭据就只能中性陈述，绝不替用户编一个他没做过的动作。
function bibSetRestartKind(state) {
  if (!state) return null;
  if (state.restartKind === 'update' || state.restartKind === 'rollback' || state.restartKind === 'downgrade') return state.restartKind;
  if (state.restartDirection === 'update') return 'update';
  if (state.restartDirection !== 'rollback') return null;
  return typeof state.holdVersion === 'string' && state.holdVersion.length > 0 && state.holdVersion === state.runningVersion
    ? 'rollback' : 'downgrade';
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
const BIB_SET_UPDATE_MODE_ID = 'bib-set-update-mode';
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
  // 方向由 host 判定（见 getUpdateState）：update = 磁盘已是新版待重启；rollback = 用户点过回滚、
  // 磁盘比运行版本旧；downgrade = 磁盘比运行版本旧，但不是用户回滚的（插件被外部装成了旧版）。
  // 三者都只有重启才生效，但说法必须分开：把外部降级说成「已回滚」既冤枉用户又让人看不懂。
  const restartKind = bibSetRestartKind(state);
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
  // 真正需要逃生门的窗口只有两个：新版已装好但还没重启（restartKind === 'update'，此时退回最省事），
  // 以及上次更新失败（lastError）。磁盘已经比运行中旧（'rollback' / 'downgrade'）时不再显示 ——
  // 回滚过的那次 pendingVersion 已清空，外部降级则根本没有可回滚的对象，点了也没意义。
  const canRollback = restartKind === 'update' || !!state.lastError;
  const showFallback = !disabled && (canRollback || held);
  const showInstall = !disabled && available && !held;
  // ① 状态层：先给结论，再把事实摆在下面
  let statusText = t(latest ? 'ui.updateUpToDate' : 'ui.updateErrorCheckFailed');
  if (disabled) statusText = t('ui.updateDisabled');
  else if (busy && phase === 'install' && latest) statusText = t('ui.updateInstalling', { version: latest });
  else if (restartKind === 'update') statusText = t('ui.updatePendingRestart', { version: shown(state.diskVersion) });
  else if (restartKind === 'rollback') statusText = t('ui.updateRolledBack', { version: shown(state.diskVersion) });
  else if (restartKind === 'downgrade') statusText = t('ui.updateDowngradePending', { version: shown(state.diskVersion), running: shown(state.runningVersion) });
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
          // 原生分段控件是 tablist：两种方式的说明各自成为一个 tabpanel（非选中项 hidden），
          // 供 tab 的 aria-controls 指向。兜底路径没有 tablist，仍是一句随选中项切换的说明。
          BIB_SET_NATIVE_SEGMENTED
            ? [
              React.createElement('p', {
                key: 'auto',
                id: BIB_SET_UPDATE_MODE_ID + '-auto-panel',
                role: 'tabpanel',
                'aria-labelledby': BIB_SET_UPDATE_MODE_ID + '-auto',
                className: 'bib-set-data-desc',
                hidden: manual,
              }, t('ui.updateModeAutoDesc')),
              React.createElement('p', {
                key: 'manual',
                id: BIB_SET_UPDATE_MODE_ID + '-manual-panel',
                role: 'tabpanel',
                'aria-labelledby': BIB_SET_UPDATE_MODE_ID + '-manual',
                className: 'bib-set-data-desc',
                hidden: !manual,
              }, t('ui.updateModeManualDesc')),
            ]
            : React.createElement('p', { className: 'bib-set-data-desc' }, manual ? t('ui.updateModeManualDesc') : t('ui.updateModeAutoDesc'))),
        // 更新方式用两段式选择而不是开关：用户拍板「全自动更新 / 手动更新」是二选一，不是开与关。
        // 组件复用订阅窗口方向的两段式（同一套几何与对比度），必须以 createElement 创建（内部有 hooks）。
        React.createElement('div', { className: 'bib-set-data-button-group' },
          React.createElement(bibSetQuotaMode, {
            id: BIB_SET_UPDATE_MODE_ID,
            label: t('ui.autoUpdateTitle'),
            value: manual ? 'manual' : 'auto',
            // 更新动作在途时锁住分段控件（与旁边两个按钮的 disabled 同步），避免切换方式与在途写操作打架。
            disabled: busy,
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

// ---------- DSH Go 配置页（DESIGN-FINAL §6，2026-11-12） ----------
// 只在 DSH Go 表面（网页版/整页岛，见 dshGoCompactEnabled）下渲染；桌面走原设置页，结构与像素不变。
// 不额外要求触屏或手机宽度：平板/大窗/鼠标仍是 DSH Go，尺寸差异交给 CSS 断点。
// 控件全部自绘（开关 52×32 / 分段 36 / 按钮 44）；卡片玻璃面、卡内无分割线（行间 2、分组 24）。
// 动作全部复用原设置页的同一批函数（rpc / 字段语义不变）。
const BIB_GO_MINIMAL_FIELDS = ['contextUsage', 'balance', 'subBalance', 'subWindow5h', 'subWindowWeek', 'subWindowMonth', 'billingSpend'];
const BIB_GO_ACCOUNT_FIELDS = ['anchorGroup', 'subServiceGroup', 'billingServiceGroup', 'balance', 'subBalance', 'subWindow5h', 'subWindowWeek', 'subWindowMonth', 'resetCountdown', 'expiry', 'billingSpend', 'budget', 'freeQuota'];
// 宽屏增量列（todaySpend / last30dSpend）与花费同组：只在卡片宽到装得下时出现，
// 但开关在这里就得能关——用户不必猜「为什么宽屏多了一列」。
const BIB_GO_COST_FIELDS = ['sessionCost', 'todaySpend', 'last30dSpend', 'period', 'countdown', 'contextUsage'];
const BIB_GO_ADVANCED_FIELDS = ['customText', 'mainTime', 'worldTime'];
const BIB_GO_PRESETS = [
  { id: 'minimal', labelKey: 'ui.presetMinimal' },
  { id: 'standard', labelKey: 'ui.presetStandard' },
  { id: 'full', labelKey: 'ui.presetFull' },
];
function bibSetGoDesired(field, preset) {
  if (preset === 'full') return true;
  if (preset === 'minimal') return BIB_GO_MINIMAL_FIELDS.indexOf(field.id) !== -1;
  return field.defaultOff !== true;
}
function BibSetGoSwitch(props) {
  const checked = props.checked === true;
  return React.createElement('button', {
    type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': props.label,
    disabled: props.disabled === true,
    className: 'bib-go-switch' + (checked ? ' bib-go-switch--on' : ''),
    onClick: function () { if (props.disabled !== true && props.onToggle) props.onToggle(!checked); },
  }, React.createElement('span', { className: 'bib-go-switch-thumb', 'aria-hidden': 'true' }));
}
function BibSetGoSegmented(props) {
  const options = props.options || [];
  const disabled = props.disabled === true;
  return React.createElement('div', { className: 'bib-go-seg', role: 'tablist', 'aria-label': props.label },
    options.map(function (option) {
      const active = option.value === props.value;
      return React.createElement('button', {
        key: option.value, type: 'button', role: 'tab', 'aria-selected': active,
        disabled: disabled,
        className: 'bib-go-seg-opt' + (active ? ' bib-go-seg-opt--active' : ''),
        onClick: function () { if (!disabled && !active && props.onChange) props.onChange(option.value); },
      }, option.label);
    }));
}
function BibSetGoButton(props) {
  return React.createElement('button', {
    type: 'button',
    disabled: props.disabled === true,
    className: 'bib-go-btn' + (props.variant ? ' bib-go-btn--' + props.variant : ''),
    onClick: props.onClick,
  }, props.children);
}
function BibSetGoRow(props) {
  return React.createElement('div', { className: 'bib-go-srow' + (props.desc ? ' bib-go-srow--tall' : '') + (props.stack ? ' bib-go-srow--stack' : '') },
    React.createElement('div', { className: 'bib-go-srow-main' },
      React.createElement('div', { className: 'bib-go-srow-title' }, props.title),
      props.desc ? React.createElement('div', { className: 'bib-go-srow-desc' }, props.desc) : null),
    props.control != null ? React.createElement('div', { className: 'bib-go-srow-control' }, props.control) : null);
}
function BibSetGoCard(props) {
  return React.createElement('div', { className: 'bib-go-card' + (props.className ? ' ' + props.className : '') }, props.children);
}
function BibSetGoDisclosure(props) {
  return React.createElement('div', { className: 'bib-go-disclosure' },
    React.createElement('button', {
      type: 'button', className: 'bib-go-disclosure-head', 'aria-expanded': props.open === true,
      onClick: function () { if (props.onToggle) props.onToggle(!(props.open === true)); },
    },
      React.createElement('div', { className: 'bib-go-srow-main' },
        React.createElement('div', { className: 'bib-go-srow-title' }, props.title),
        props.desc ? React.createElement('div', { className: 'bib-go-srow-desc' }, props.desc) : null),
      React.createElement('span', { className: 'bib-go-chevron' + (props.open === true ? ' bib-go-chevron--up' : ''), 'aria-hidden': 'true' },
        React.createElement('svg', { viewBox: '0 0 16 16', width: 16, height: 16 },
          React.createElement('path', { d: 'M4 6l4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
    props.open === true ? React.createElement('div', { className: 'bib-go-disclosure-body' }, props.children) : null);
}
function BibSetDshGoPage(props) {
  const deps = props.deps;
  const [bibGoAdvancedOpen, setBibGoAdvancedOpen] = React.useState(false);
  const [bibGoColorsOpen, setBibGoColorsOpen] = React.useState(false);
  const hostFields = settingsFieldsForHost(deps.nativePills);
  const byIds = function (ids) {
    return ids.map(function (id) {
      for (let i = 0; i < hostFields.length; i++) if (hostFields[i].id === id) return hostFields[i];
      return null;
    }).filter(Boolean);
  };
  const rowFor = function (field) {
    return React.createElement(BibSetGoRow, {
      key: field.id,
      title: t(field.label),
      desc: field.note ? t(field.note) : null,
      control: React.createElement(BibSetGoSwitch, {
        label: t('ui.show', { label: t(field.label) }),
        checked: deps.fieldOn(field.id),
        onToggle: function (next) { deps.onFieldToggle(field.id, next); },
      }),
    });
  };
  const rowsFor = function (ids) { return byIds(ids).map(rowFor); };
  const densityOptions = BIB_GO_PRESETS.map(function (preset) { return { value: preset.id, label: t(preset.labelKey) }; });
  const activePreset = deps.activePreset();
  const preview = React.createElement(BibSetGoCard, { className: 'bib-go-preview-card' },
    React.createElement('div', { className: 'bib-go-preview' },
      React.createElement('div', { className: 'bib-go-preview-col' },
        React.createElement('span', { className: 'bib-go-preview-cap' }, t('ui.balance.pushBalanceGroups')),
        React.createElement('span', { className: 'bib-go-preview-val' }, '¥123.45')),
      React.createElement('div', { className: 'bib-go-preview-col' },
        React.createElement('span', { className: 'bib-go-preview-cap' }, t('ui.session')),
        React.createElement('span', { className: 'bib-go-preview-val' }, '¥1.23')),
      React.createElement('div', { className: 'bib-go-preview-col' },
        React.createElement('span', { className: 'bib-go-preview-cap' }, t('field.contextUsage.label')),
        React.createElement('span', { className: 'bib-go-preview-val bib-go-preview-ring' },
          React.createElement('svg', { viewBox: '0 0 20 20', width: 17, height: 17, 'aria-hidden': 'true' },
            React.createElement('circle', { cx: 10, cy: 10, r: 7.5, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.25, strokeWidth: 2.5 }),
            React.createElement('circle', { cx: 10, cy: 10, r: 7.5, fill: 'none', stroke: 'currentColor', strokeWidth: 2.5, strokeLinecap: 'round', strokeDasharray: 47.1, strokeDashoffset: 32.5, transform: 'rotate(-90 10 10)' })),
          React.createElement('span', null, '31%')))));
  const colorRows = hostFields.filter(function (field) { return field.noColor !== true; }).map(function (field) {
    return React.createElement(BibSetGoRow, {
      key: 'c-' + field.id,
      title: t(field.label),
      desc: null,
      stack: true,
      control: React.createElement(bibSetPalette, {
        label: t('ui.presetColor', { label: t(field.label) }),
        value: deps.colorOf(field.id),
        onSelect: function (next) { deps.onColorChange(field.id, next); },
      }),
    });
  });
  // 版本/更新区与桌面 bibSetVersionSection 同一套判定（结论→事实→动作→方式→兜底），
  // 只是换成 Go 的行语言。旧 Go 版只摆运行/最新两行 + 一个自动开关 + 右挤按钮排，
  // 缺结论/上次检查/失败原因/回滚逃生门，且「允许更新到 X」误接回滚、暂缓时仍摆安装按钮。
  const update = deps.updateState || {};
  // 读不到更新状态（首次加载 / 旧宿主没有 getUpdateState）时不能谎报「检查更新没成功」并摆出会报错的按钮：
  // 结论与桌面 bibSetVersionSection 一致（无错误=还没读到，有错误=旧宿主），但 Go 页有固定分区骨架，
  // 所以这里给一行占位（桌面那边则整块隐藏），不能留一张空卡。
  const upNull = deps.updateState == null;
  const upBusy = deps.updateBusy === true;
  const upPhase = deps.updatePhase === 'check' || deps.updatePhase === 'install' ? deps.updatePhase : null;
  const upDisabled = update.disabled === true;
  const upManual = update.autoUpdate === false;
  const upShown = function (v) { return typeof v === 'string' && v.length > 0 ? v : t('ui.versionUnknown'); };
  const upRestartKind = bibSetRestartKind(update);
  const upLatest = typeof update.latest === 'string' && update.latest.length > 0 ? update.latest : null;
  const upAvailable = update.available === true && upLatest !== null;
  const upHeld = typeof update.holdVersion === 'string' && update.holdVersion.length > 0 && update.holdVersion === update.latest;
  const upCanRollback = upRestartKind === 'update' || !!update.lastError;
  const upShowFallback = !upDisabled && (upCanRollback || upHeld);
  const upShowInstall = !upDisabled && upAvailable && !upHeld;
  let upStatus = t(upLatest ? 'ui.updateUpToDate' : 'ui.updateErrorCheckFailed');
  if (upDisabled) upStatus = t('ui.updateDisabled');
  else if (upBusy && upPhase === 'install' && upLatest) upStatus = t('ui.updateInstalling', { version: upLatest });
  else if (upRestartKind === 'update') upStatus = t('ui.updatePendingRestart', { version: upShown(update.diskVersion) });
  else if (upRestartKind === 'rollback') upStatus = t('ui.updateRolledBack', { version: upShown(update.diskVersion) });
  else if (upRestartKind === 'downgrade') upStatus = t('ui.updateDowngradePending', { version: upShown(update.diskVersion), running: upShown(update.runningVersion) });
  else if (update.lastError) upStatus = t('ui.updateFailed');
  else if (upHeld) upStatus = t('ui.updateHeld', { version: update.holdVersion });
  else if (upAvailable) upStatus = t('ui.updateAvailableNow', { version: upLatest });
  const upFacts = [
    t('ui.versionRunning', { version: upShown(update.runningVersion) }),
    t('ui.versionLatest', { version: upShown(update.latest) }),
  ];
  const upCheckedAt = bibSetRelativeTime(update.lastCheckAt);
  if (upCheckedAt) upFacts.push(t('ui.versionLastCheck', { time: upCheckedAt }));
  // 统一卡片语言：行只放设置/状态控件，所有「动作按钮」收进卡底 .bib-go-actions 一条，
  // 不再出现「按钮挤在行右 / 按钮垫在状态字下面 / 重置按钮串到别的卡」三种摆法混用。
  const upButtons = [];
  if (!upDisabled) {
    upButtons.push(React.createElement(BibSetGoButton, { key: 'check', variant: 'secondary', disabled: upBusy, onClick: deps.onCheckUpdate },
      upBusy && upPhase === 'check' ? t('ui.updateChecking') : t('ui.updateCheckNow')));
    if (upShowInstall) upButtons.push(React.createElement(BibSetGoButton, { key: 'install', variant: 'primary', disabled: upBusy, onClick: deps.onInstallUpdate },
      upBusy && upPhase === 'install' ? t('ui.updateInstalling', { version: upLatest }) : t('ui.updateInstallNow', { version: upLatest })));
    if (upCanRollback) upButtons.push(React.createElement(BibSetGoButton, { key: 'rb', variant: 'secondary', disabled: upBusy, onClick: deps.onRollbackUpdate }, t('ui.updateRollback')));
    if (upHeld) upButtons.push(React.createElement(BibSetGoButton, { key: 'held', variant: 'secondary', disabled: upBusy, onClick: deps.onForceUpdate }, t('ui.updateAllowHeld', { version: update.holdVersion })));
  }
  const upActionBar = upButtons.length > 0 ? React.createElement('div', { className: 'bib-go-actions' }, upButtons) : null;
  const upStatusRow = React.createElement(BibSetGoRow, {
    title: upStatus,
    desc: upDisabled
      ? t('ui.versionRunning', { version: upShown(update.runningVersion) }) + ' · ' + t('ui.updateDisabledWhy')
      : upFacts.join(' · '),
  });
  const upErrorRow = (update.lastError && !upDisabled) ? React.createElement('div', { className: 'bib-go-static-row' },
    React.createElement('span', { className: 'bib-go-srow-desc' }, updateErrorText(update.lastErrorKind || update.lastError))) : null;
  const upModeRow = upDisabled ? null : React.createElement(BibSetGoRow, {
    title: t('ui.autoUpdateTitle'),
    desc: upManual ? t('ui.updateModeManualDesc') : t('ui.updateModeAutoDesc'),
    stack: true,
    control: React.createElement(BibSetGoSegmented, {
      label: t('ui.autoUpdateTitle'), value: upManual ? 'manual' : 'auto', disabled: upBusy,
      options: [
        { value: 'auto', label: t('ui.updateModeAuto') },
        { value: 'manual', label: t('ui.updateModeManual') },
      ],
      onChange: function (value) { if (!upBusy) deps.onToggleUpdateAuto(value !== 'manual'); },
    }),
  });
  const upFallbackRow = upShowFallback ? React.createElement('div', { className: 'bib-go-static-row' },
    React.createElement('span', { className: 'bib-go-srow-desc' }, upCanRollback ? t('ui.updateFallbackWhy') : t('ui.updateHoldWhy'))) : null;
  return React.createElement('div', { ref: deps.rootRef, className: 'bib-set-root bib-settings bib-go-page' },
    React.createElement('header', { className: 'bib-go-head' },
      React.createElement('h1', { className: 'bib-go-title' }, t('ui.infoBarSettings')),
      React.createElement('p', { className: 'bib-go-subtitle' }, t('meta.description'))),
    React.createElement('div', { className: 'bib-go-section' },
      React.createElement('div', { className: 'bib-go-section-label' }, t('ui.preview')),
      preview,
      React.createElement(BibSetGoCard, null,
        React.createElement(BibSetGoRow, {
          title: t('ui.densityTitle'),
          desc: t('ui.densityDesc'),
          stack: true,
          control: React.createElement(BibSetGoSegmented, { label: t('ui.densityTitle'), options: densityOptions, value: activePreset || 'standard', onChange: deps.applyPreset }),
        })),
      React.createElement('p', { className: 'bib-go-hint' }, t('ui.densityHint'))),
    React.createElement('div', { className: 'bib-go-section' },
      React.createElement('div', { className: 'bib-go-section-label' }, t('ui.visibleFields')),
      React.createElement(BibSetGoCard, null,
        React.createElement('div', { className: 'bib-go-group-label' }, t('ui.account')),
        rowsFor(BIB_GO_ACCOUNT_FIELDS),
        React.createElement('div', { className: 'bib-go-group-label' }, t('ui.spend')),
        rowsFor(BIB_GO_COST_FIELDS),
        React.createElement(BibSetGoDisclosure, {
          title: t('ui.advanced'),
          desc: t('ui.advancedDesc'),
          open: bibGoAdvancedOpen,
          onToggle: setBibGoAdvancedOpen,
        },
          React.createElement('div', { className: 'bib-go-group-label' }, t('field.customText.label')),
          React.createElement(BibSetGoRow, {
            title: t('field.customText.label'),
            desc: t('field.customText.note'),
            stack: true,
            control: bibSetInput({
              layout: 'bib-set-input--block',
              fallbackClassName: 'bib-set-custom-text-input',
              attrs: {
                type: 'text', maxLength: 64,
                value: deps.customTextDraft !== null ? deps.customTextDraft : deps.customTextOf(),
                placeholder: t('field.customText.note'),
                'aria-label': t('field.customText.label'),
                onChange: function (event) { deps.onCustomTextChange(event && event.target ? event.target.value : ''); },
                onBlur: function () { deps.onCustomTextCommit(); },
              },
            }),
          }),
          React.createElement('div', { className: 'bib-go-group-label' }, t('ui.timeDateTitle')),
          React.createElement(BibSetGoRow, {
            title: t('ui.mainTime'),
            control: bibSetInput({
              layout: 'bib-set-input--field', fallbackClassName: 'bib-set-time-zone',
              attrs: { type: 'text', value: deps.timeZonesOf().main, 'aria-label': t('ui.mainTime'), onChange: function (event) { deps.onTimeZoneChange('main', event && event.target ? event.target.value : ''); } },
            }),
          }),
          React.createElement(BibSetGoRow, {
            title: t('ui.worldTime'),
            control: bibSetInput({
              layout: 'bib-set-input--field', fallbackClassName: 'bib-set-time-zone',
              attrs: { type: 'text', value: deps.timeZonesOf().world, 'aria-label': t('ui.worldTime'), onChange: function (event) { deps.onTimeZoneChange('world', event && event.target ? event.target.value : ''); } },
            }),
          }),
          React.createElement('div', { className: 'bib-go-group-label' }, t('group.native')),
          rowsFor(['nativeActivity', 'nativeUsage'])),
        React.createElement('div', { className: 'bib-go-actions' },
          React.createElement(BibSetGoButton, { variant: 'secondary', disabled: deps.busy === true, onClick: function () { deps.requestReset('fields'); } }, t('ui.resetLabels'))))),
      React.createElement('div', { className: 'bib-go-section' },
        React.createElement('div', { className: 'bib-go-section-label' }, t('ui.appearance')),
        React.createElement(BibSetGoCard, null,
          React.createElement(BibSetGoRow, {
            title: t('ui.quotaDisplayModeTitle'),
            desc: t('ui.quotaDisplayModeDesc'),
            stack: true,
            control: React.createElement(BibSetGoSegmented, {
              label: t('ui.quotaDisplayModeTitle'),
              options: [{ value: 'remaining', label: t('ui.quotaDisplayRemaining') }, { value: 'used', label: t('ui.quotaDisplayUsed') }],
              value: deps.quotaDisplayModeOf(),
              onChange: deps.setQuotaDisplayMode,
            }),
          }),
          React.createElement(BibSetGoDisclosure, { title: t('ui.colors'), desc: null, open: bibGoColorsOpen, onToggle: setBibGoColorsOpen }, colorRows),
          React.createElement('div', { className: 'bib-go-actions' },
            React.createElement(BibSetGoButton, { variant: 'secondary', disabled: deps.busy === true, onClick: function () { deps.requestReset('colors'); } }, t('ui.resetColors'))))),
      // 额度凭据：直接复用宿主的凭据卡（自带标题与折叠、自带错误边界）。
      // 不在这里用 Go 自绘控件重写一遍 —— 那会把凭据校验、错误码、OAuth 复用等逻辑分叉成两份。
      React.createElement('div', { className: 'bib-go-section' },
        bibSetCredentialsSection({
          credentialState: deps.credentialState,
          credentialDrafts: deps.credentialDrafts,
          credentialBusyRef: deps.credentialBusyRef,
          credentialFeedback: deps.credentialFeedback,
          onCredentialDraft: deps.onCredentialDraft,
          onCredentialSave: deps.onCredentialSave,
          onCredentialClear: deps.onCredentialClear,
        })),
      React.createElement('div', { className: 'bib-go-section' },
        React.createElement('div', { className: 'bib-go-section-label' }, t('ui.dataAndBilling')),
        React.createElement(BibSetGoCard, null,
          React.createElement(BibSetGoRow, { title: t('ui.exportBillingRecords'), desc: t('ui.exportBillingRecordsDesc') }),
          React.createElement(BibSetGoRow, { title: t('ui.clearBillingRecords'), desc: t('ui.clearBillingRecordsDesc') }),
          React.createElement('div', { className: 'bib-go-actions' },
            React.createElement(BibSetGoButton, { variant: 'secondary', disabled: deps.busy === true, onClick: function () { deps.runExport('csv'); } }, t('ui.exportBillingCsv')),
            React.createElement(BibSetGoButton, { variant: 'secondary', disabled: deps.busy === true, onClick: function () { deps.runExport('json'); } }, t('ui.exportBillingJson')),
            React.createElement(BibSetGoButton, { variant: 'danger', disabled: deps.busy === true, onClick: deps.runClearRecords }, t('ui.clearBillingRecords'))))),
      React.createElement('div', { className: 'bib-go-section' },
        React.createElement('div', { className: 'bib-go-section-label' }, t('ui.versionAndUpdateTitle')),
        React.createElement(BibSetGoCard, null,
          upNull
            ? React.createElement(BibSetGoRow, { title: deps.updateError ? t('ui.versionUnavailable') : t('ui.loadingInfoBarSettings') })
            : upStatusRow,
          upNull ? null : upErrorRow,
          upNull ? null : upModeRow,
          upNull ? null : upFallbackRow,
          upNull ? null : upActionBar)),
    deps.feedback ? React.createElement('div', { className: 'bib-go-feedback' }, deps.feedback) : null,
    deps.alerts.length > 0 ? React.createElement('div', { className: 'bib-go-alerts' }, deps.alerts) : null,
    deps.resetDialog,
    deps.installDialog,
    React.createElement('footer', { className: 'bib-go-footer' }, t('meta.title') + ' · DSH Go' + (typeof update.runningVersion === 'string' ? ' · ' + update.runningVersion : '')));
}

function InfoBarSettingsSection() {
  const [snapshot, setSnapshot] = React.useState(null);
  // DSH Go 配置页门控（见模块级 dshGoCompactEnabled）：桌面端 false，走原设置页。
  // 用普通常量而不是 useState：门控在页面生命周期内不变，也避免测试装置的 hook 顺序被新状态挤位。
  const dshGoPage = dshGoCompactEnabled();
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
  // 安装新版本的二次确认（2026-11-13，对齐 dsh-chatgpt-sub 同款弹窗）：
  // null=未在确认；{ version, force }=待确认的安装动作。勾选态独立保存，每次打开都重置。
  const [installConfirm, setInstallConfirm] = React.useState(null);
  const [installAck, setInstallAck] = React.useState(false);
  const nativePills = useNativeDockPills();
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
  // 安装确认（2026-11-13）：对齐 ChatGPT 订阅插件（dsh-chatgpt-sub）的同款确认窗 ——
  // 新宿主用原生 RiskConfirmation（「安装新版本？」+ 说明 + 勾选「我已了解」后才能点确认）；
  // 组件缺失（旧宿主）退回 window.confirm。两条路径都保证「未确认不执行」。
  function runConfirmedInstall(force) {
    return runUpdateAction('install', function () { return rpc('installUpdate', force ? { force: true } : undefined); });
  }
  function requestInstall(version, force) {
    if (typeof version !== 'string' || !version) return;
    if (!BIB_SET_NATIVE_RISK_CONFIRM) {
      let ok = false;
      try {
        ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm(t('ui.updateConfirm', { version: version })) : false;
      } catch (err) { ok = false; }
      if (ok) runConfirmedInstall(force === true);
      return;
    }
    setInstallAck(false);
    setInstallConfirm({ version: version, force: force === true });
  }
  // 「检查更新」只问版本；发现新版后在当前页面弹窗确认，确认才走安装接口。
  // 暂缓版本（holdVersion === latest）不弹窗：那次安装会被引擎的暂缓分支吃掉，
  // 弹了等于让用户确认一个注定没反应的动作 —— 与版本卡「暂缓时不摆更新按钮」同一条规矩。
  function onCheckUpdate() {
    return runUpdateAction('check', function () { return rpc('checkUpdate'); }).then(function (state) {
      if (state && state.available === true && state.pendingRestart !== true && state.holdVersion !== state.latest) requestInstall(state.latest, false);
      return state;
    });
  }
  // 状态轮询出现的「更新到 X」按钮也须确认，不能绕过弹窗。
  function onInstallUpdate() {
    if (!updateState) return;
    requestInstall(updateState.latest, false);
  }
  // 「允许更新到 X」：用户回滚过的版本默认不再装回来（引擎侧 holdVersion），
  // 只有这个显式动作才解除暂缓 —— 逃生门不能被自动流程悄悄重新打开。
  function onForceUpdate() {
    if (!updateState) return;
    requestInstall(updateState.holdVersion, true);
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

  // ---------- v1.24.0：额度凭据（阿里 AccessKey / Kimi Key）----------
  // 只保存到 DSH 凭据存储；读状态与动作结果都不含明文，保存成功后清空输入框。
  const [credentialState, setCredentialState] = React.useState(null);
  const [credentialDrafts, setCredentialDrafts] = React.useState({});
  const [credentialBusyRef, setCredentialBusyRef] = React.useState(null);
  const [credentialFeedback, setCredentialFeedback] = React.useState(null);
  React.useEffect(function () {
    let active = true;
    rpc('getCredentialConfig').then(function (res) {
      if (active && res && Array.isArray(res.items)) setCredentialState(res);
    }).catch(function () {
      // 旧宿主没有该接口：区块照常显示，但写入能力标为不可用，避免给出假按钮。
      if (active) setCredentialState({ items: [], canWrite: false });
    });
    return function () { active = false; };
  }, []);
  function credentialErrorText(code) {
    if (code === 'invalid-value') return t('ui.credentialInvalidValue');
    if (code === 'write-unsupported') return t('ui.credentialWriteUnsupported');
    return t('ui.credentialWriteFailed');
  }
  function runCredentialAction(ref, factory, successKey) {
    setCredentialBusyRef(ref);
    setCredentialFeedback(null);
    return factory().then(function (res) {
      setCredentialBusyRef(null);
      if (res && res.ok) {
        setCredentialState(res);
        setCredentialFeedback({ tone: 'info', text: t(successKey) });
        // 信息栏监听该事件后立即重拉，不用等 30 秒轮询才看到新额度。
        bibSetDispatchLedgerChanged();
      } else {
        setCredentialFeedback({ tone: 'error', text: credentialErrorText(res && res.code) });
      }
      return res;
    }).catch(function (err) {
      setCredentialBusyRef(null);
      setCredentialFeedback({ tone: 'error', text: bibSetOperationMessage(err) });
    });
  }
  function onCredentialDraft(ref, value) {
    setCredentialDrafts(function (prev) { const next = Object.assign({}, prev); next[ref] = value; return next; });
  }
  function onCredentialSave(ref) {
    const value = typeof credentialDrafts[ref] === 'string' ? credentialDrafts[ref].trim() : '';
    if (value.length === 0) return Promise.resolve();
    return runCredentialAction(ref, function () { return rpc('setCredential', { ref: ref, value: value }); }, 'ui.credentialSaved').then(function (res) {
      if (res && res.ok) setCredentialDrafts(function (prev) { const next = Object.assign({}, prev); next[ref] = ''; return next; });
    });
  }
  function onCredentialClear(ref) {
    return runCredentialAction(ref, function () { return rpc('clearCredential', { ref: ref }); }, 'ui.credentialCleared');
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
        React.createElement(bibSetLanguagePicker, { runtime: languageRuntime, onError: setOpError }),
        bibSetAlert({ tone: 'info', children: t('ui.loadingInfoBarSettings') }));
    }
    if (status === 'error') {
      return React.createElement('div', { ref: settingsRootRef, className: 'bib-set-root bib-settings' },
        React.createElement(bibSetLanguagePicker, { runtime: languageRuntime, onError: setOpError }),
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
    rpc('exportUsageRecords', { metadata: true }).then(function (payload) {
      if (payload && payload.archiveReadError) {
        throw new Error(t('ui.exportIncomplete', { value: hostText(payload.archiveReadError) }));
      }
      const records = payload && Array.isArray(payload.records) ? payload.records : [];
      const count = payload && payload.downloadUrl ? payload.recordCount : records.length;
      if (count === 0) {
        setNotice({ text: function () { return t('ui.noBillingRecordsToExport'); } });
        return;
      }
      downloadUsageExport(format, payload);
      setNotice({ text: function () { return t(payload && payload.downloadUrl ? 'ui.exportDownloadStarted' : 'ui.exportedBillingRecords', { count: count, format: format.toUpperCase() }); } });
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

  // DSH Go 三档密度预设：复用同一批字段开关（RPC 语义不变）。
  function applyFieldPreset(preset) {
    const hostFields = settingsFieldsForHost(nativePills);
    for (let i = 0; i < hostFields.length; i++) {
      const field = hostFields[i];
      const desired = bibSetGoDesired(field, preset);
      if (fieldOn(field.id) !== desired) setFieldFlag(field.id, desired);
    }
  }
  function activeFieldPreset() {
    const hostFields = settingsFieldsForHost(nativePills);
    const matches = function (preset) {
      for (let i = 0; i < hostFields.length; i++) {
        if (fieldOn(hostFields[i].id) !== bibSetGoDesired(hostFields[i], preset)) return false;
      }
      return true;
    };
    if (matches('minimal')) return 'minimal';
    if (matches('full')) return 'full';
    if (matches('standard')) return 'standard';
    return null;
  }

  // ---- 渲染 ----
  // 搜索只负责筛选；输入时两分组自动展开（决策 2），但用户随后仍可明确折叠，
  // 箭头和 aria-expanded 始终反映真实 DOM 状态。
  const searchActive = searchQuery.trim().length > 0;
  const fieldsEnabledCount = settingsFieldsForPage(nativePills).filter(function (f) { return fieldOn(f.id); }).length;
  const fieldsMatchCount = settingsFieldsForPage(nativePills).filter(function (f) { return matchesSearch(f, searchQuery); }).length;
  const groupsChildren = bibSetFieldGroups({
    nativePills: nativePills,
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
  // 安装确认弹窗（2026-11-13，对齐 dsh-chatgpt-sub 同款）：勾选前「确定」按钮由 RiskConfirmation
  // 保持禁用；「取消 / 右上角关闭 / Esc」都只是关窗，不产生任何安装动作。
  const installDialog = installConfirm !== null && BIB_SET_NATIVE_RISK_CONFIRM
    ? React.createElement(BIB_SET_NATIVE_RISK_CONFIRM, {
      open: true,
      title: t('ui.updateConfirmTitle'),
      description: t('ui.updateConfirm', { version: installConfirm.version }),
      acknowledgeLabel: t('ui.updateConfirmAcknowledge'),
      cancelLabel: t('ui.updateConfirmCancel'),
      closeLabel: t('ui.updateConfirmCancel'),
      confirmLabel: t('ui.updateConfirmConfirm'),
      acknowledged: installAck,
      disabled: updateBusy,
      onAcknowledgedChange: function (next) { setInstallAck(next === true); },
      onCancel: function () { setInstallConfirm(null); },
      onConfirm: function () {
        const requested = installConfirm;
        setInstallConfirm(null);
        if (requested) runConfirmedInstall(requested.force);
      },
    })
    : null;
  // DSH Go 配置页（4 屏单页）：只换呈现层与信息架构，动作全部复用上面的函数。
  if (dshGoPage) {
    return React.createElement(BibSetDshGoPage, {
      deps: {
        nativePills: nativePills,
        fieldOn: fieldOn,
        onFieldToggle: setFieldFlag,
        applyPreset: applyFieldPreset,
        activePreset: activeFieldPreset,
        colorOf: colorOf,
        onColorChange: setColor,
        timeZonesOf: timeZonesOf,
        onTimeZoneChange: setTimeZone,
        customTextDraft: customTextDraft,
        customTextOf: customTextOf,
        onCustomTextChange: onCustomTextChange,
        onCustomTextCommit: commitCustomText,
        quotaDisplayModeOf: quotaDisplayModeOf,
        setQuotaDisplayMode: setQuotaDisplayMode,
        // 额度凭据是 v1.24 才有的设置分区（Go 分支分叉时还不存在）。Go 页整个替换掉设置页，
        // 不接这一组依赖的话，DSH Go 用户就没有任何入口配置额度凭据了。
        credentialState: credentialState,
        credentialDrafts: credentialDrafts,
        credentialBusyRef: credentialBusyRef,
        credentialFeedback: credentialFeedback,
        onCredentialDraft: onCredentialDraft,
        onCredentialSave: onCredentialSave,
        onCredentialClear: onCredentialClear,
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
        languageRuntime: languageRuntime,
        onLanguageError: setOpError,
        feedback: feedback,
        alerts: alerts,
        resetDialog: resetDialog,
        // 安装确认弹窗与重置弹窗同源：Go 页整个替换设置页，不传这一项的话，
        // Go 模式点「更新到 X」只会设确认态却不弹窗，安装动作永远落不了地。
        installDialog: installDialog,
        requestReset: requestReset,
        rootRef: settingsRootRef,
      },
    });
  }
  return React.createElement('div', { ref: settingsRootRef, className: 'bib-set-root bib-settings' },
    React.createElement(bibSetLanguagePicker, { runtime: languageRuntime, onError: setOpError }),
    React.createElement('section', { className: 'bib-set-card bib-set-card--panel', 'aria-label': t('ui.visibleFields') },
      // 卡头（2026-11-12）：与「账单数据 / 版本」等区块同一套「一级标题 + 汇总说明」，
      // 整页层级拉齐 —— 之前这张卡只有搜索行和分组，缺一级标题，观感上高一级低一级不成体系。
      bibSetCardHeader({
        static: true,
        titleId: 'bib-set-visible-fields-title',
        title: t('ui.visibleFields'),
        description: t('ui.visibleFieldsDesc'),
      }),
      React.createElement('div', { className: 'bib-set-toolbar' },
        React.createElement('div', { className: 'bib-set-search-row' },
          React.createElement('div', { className: 'bib-set-search-shell' },
            bibSetInput({
              layout: 'bib-set-input--block',
              fallbackClassName: 'bib-set-search',
              attrs: {
                type: 'search',
                placeholder: t('ui.searchPlaceholder') || '搜索内容…',
                value: searchQuery,
                onChange: function (e) {
                  const value = e && e.target ? e.target.value : '';
                  setSearchQuery(value);
                  if (value.trim().length > 0) setGroupOpen({ native: true, plugin: true, notice: true });
                },
                'aria-label': t('ui.searchFieldsLabel') || 'Search visible content',
              },
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
      credentialState: credentialState,
      credentialDrafts: credentialDrafts,
      credentialBusyRef: credentialBusyRef,
      credentialFeedback: credentialFeedback,
      onCredentialDraft: onCredentialDraft,
      onCredentialSave: onCredentialSave,
      onCredentialClear: onCredentialClear,
    }),
    alerts.length > 0 ? React.createElement('div', { className: 'bib-set-alerts' }, alerts) : null,
    resetDialog,
    installDialog);
  } catch (err) {
    return React.createElement('div', { ref: settingsRootRef, className: 'bib-set-root bib-settings' },
      React.createElement(bibSetLanguagePicker, { runtime: languageRuntime, onError: setOpError }),
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
    // 先把 DSH Go 表面信号归一成 data-dsh-go-island（见 dshGoSurfaceEnabled 注释）：
    // 必须在样式安装与组件挂载之前，CSS 门控才能第一时间生效。
    dshGoSurfaceEnabled();
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

    // 卸载时把宿主按钮的隐藏属性摘掉：插件不在了，Harness 自己的两个按钮必须恢复原样。
    ctx.effect(function () {
      return function () { clearNativePillVisibility(); };
    }, 'dsh-bottom-info-bar: native pill switches');

    // Watch late registration, removal and remounts; native buttons retain their
    // own components, settings, dialogs and injected capabilities.
    const syncNativeDock = function () {
      const pills = hasNativeDockPills(slots);
      if (nativeDockState.pills === pills) return;
      nativeDockState.pills = pills;
      nativeDockState.listeners.forEach(function (listener) { listener(pills); });
    };
    ctx.effect(function () {
      const stop = typeof slots.subscribe === 'function'
        ? slots.subscribe('conversation.composer.dock', syncNativeDock) : null;
      syncNativeDock();
      return function () {
        if (typeof stop === 'function') stop();
        nativeDockState.pills = false;
        nativeDockState.listeners.forEach(function (listener) { listener(false); });
      };
    }, 'dsh-bottom-info-bar: native statistics contract');

    // ---------- 注册：旧宿主替换 stats；新版保留原生 activity / usage ----------
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
      const nativePills = useNativeDockPills();
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
      const [languageRevision, setLanguageRevision] = React.useState(0);
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
      // 触屏基础适配（见模块级 touchDetailsEnabled / collectInfoBarDetails 注释）：
      // 桌面端 touchDetails=false，本组状态与面板都不参与渲染，像素零变化。
      const [touchDetails] = React.useState(touchDetailsEnabled);
      // DSH Go 三列卡门控（见模块级 dshGoCompactEnabled）：桌面/纯浏览器 false。
      const [dshGoCompact] = React.useState(dshGoCompactEnabled);
      if (typeof window !== 'undefined') { try { window.__dshGoDebug = { compact: dshGoCompact, direct: dshGoCompactEnabled(), surface: dshGoSurfaceEnabled(), touch: touchDetailsEnabled() }; } catch (e) { window.__dshGoDebug = String(e); } }
      const [detailsOpen, setDetailsOpen] = React.useState(false);
      const [detailsItems, setDetailsItems] = React.useState([]);
      const barRef = React.useRef(null);

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

      // 点按明细面板的内容取自栏内各字段的 title（与桌面 hover 同一份文案）。
      // 面板打开期间数据/字段配置/语言变化都会重取；渲染完成后读取 DOM，避免把 title 文案
      // 在渲染层再抄一份（抄一份就多一处会和真实 tooltip 漂移的来源）。
      React.useEffect(function () {
        if (!touchDetails || !detailsOpen) return undefined;
        setDetailsItems(collectInfoBarDetails(barRef.current));
        return undefined;
      }, [touchDetails, detailsOpen, state, fieldConfigTick, languageRevision]);
      // 点卡外收起（DESIGN-FINAL §3「关闭方式」）：面板与信息栏之外按下即关闭。
      React.useEffect(function () {
        if (!detailsOpen) return undefined;
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined;
        const onPointerDown = function (event) {
          const target = event && event.target;
          const root = barRef.current;
          if (root && target && root.contains(target)) return;
          if (target && typeof target.closest === 'function' && target.closest('.bi-go-sheet')) return;
          if (target && typeof target.closest === 'function' && target.closest('.bi-mobile-details')) return;
          setDetailsOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return function () { document.removeEventListener('pointerdown', onPointerDown, true); };
      }, [detailsOpen]);
      // 触屏面板可用 Esc 收起（键盘/外接键盘场景）。
      React.useEffect(function () {
        if (!detailsOpen) return undefined;
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined;
        const onKeyDown = function (event) { if (event && event.key === 'Escape') setDetailsOpen(false); };
        document.addEventListener('keydown', onKeyDown);
        return function () { document.removeEventListener('keydown', onKeyDown); };
      }, [detailsOpen]);

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
        // v1.22：阿里 Token Plan（中国站/国际站）与 Kimi For Coding
        if (provider === 'qwen-token-plan' || provider === 'qwen-token-plan-cn' || provider === 'qwen-token-plan-individual') return t('ui.qwenTokenPlan');
        if (provider === 'kimi-coding') return t('ui.kimiCoding');
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
          trailingErrorGroups.push(fieldSpan('unmapped', 'unmapped',
            React.createElement('span', { className: 'bi-muted', title: t('ui.balanceLookupIsNotYet') }, t('ui.notSupported'))));
        }
        // 已纳入兼容性基线、但服务商没有公开的账户余额/配额接口：保留服务商、模型和
        // 本地 token 账本，不把“没有公开接口”误说成“插件未适配”。
        else if (bal && bal.accountDataUnavailable) {
          trailingErrorGroups.push(fieldSpan('unmapped', 'account-data-unavailable',
            React.createElement('span', { className: 'bi-muted', title: t('ui.accountDataUnavailableDetail') }, t('ui.accountDataUnavailable'))));
        }
        // 配置引导（未配置 API Key / 内置账号未登录）：与数据展示互斥，占 noKeyHint 槽位
        else if (configHint) {
          trailingErrorGroups.push(fieldSpan('noKeyHint', 'nokey',
            React.createElement('span', { className: 'bi-err', title: configHint.title }, configHint.text)));
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
          if (bal.error || errors.balance) {
            trailingErrorGroups.push(fieldSpan('balanceError', 'balerr',
              React.createElement('span', { className: 'bi-stale', title: t('ui.balanceIsTemporarilyUnavailableShowing') }, t('ui.refreshFailed'))));
          }
        } else if (bal && bal.error) {
          trailingErrorGroups.push(fieldSpan('balanceError', 'berr',
            React.createElement('span', { className: 'bi-err', title: t('ui.couldNotLoadBalanceCheck') }, t('ui.balanceUnavailable'))));
        } else if (errors.balance) {
          // 本次 RPC 失败且无旧数据：只降级余额块，其余端点数据照常渲染
          trailingErrorGroups.push(fieldSpan('balanceError', 'berr',
            React.createElement('span', { className: 'bi-err', title: t('ui.couldNotLoadBalanceCheck') }, t('ui.balanceUnavailable'))));
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
            const month = usg.last30dSpend != null ? t('ui.lastDays', { symbol: symbol, value: fmt(usg.last30dSpend, 3) }) : '';
            const total = usg.totalSpend != null ? t('ui.allTime', { symbol: symbol, value: fmt(usg.totalSpend, 3) }) : '';
            const detail = [today, month, total].filter(function (s) { return s.length > 0; }).join(' · ');
            const costTitle = [t('ui.sessionIncludingSubagents', { costTxt: costTxt, value: detail ? '\n' + detail : '' })];
            if (!priced && hasTokens) costTitle.push(t('ui.pricingNotListedUsingDefaults'));
            else if (priced && unpricedRecords > 0) costTitle.push(t('ui.spendPartlyUnpriced'));
            // Issue #245：账本从插件开始运行时才有记录，装插件之前跑掉的调用不在里面。
            // 标签保持「本会话」不动，只在 tooltip 里如实写出统计起点；宿主没给出起点时
            // 一个字都不编（旧宿主 / 本会话尚无记账都走这条空路径）。
            if (cs && cs.sinceTs) costTitle.push(t('ui.sessionCostSince', { time: formatDateTime(cs.sinceTs) }));
            groups.push(fieldSpan('sessionCost', 'convo', React.createElement('span', {
              title: costTitle.join('\n') },
              metric(t('ui.session'), costTxt))));
          }
        } else if (errs.usage) {
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
         // Issue #274：宿主 appAuth 通道（DSH Go / 安卓 App）的错误自带完整指引（例如「到 DSH App
         // 的账号页授权 ChatGPT」），且已按用户语言本地化。通用兜底文案会把这条最有用的原因盖掉，
         // 而手机上没有 hover，只能靠这个 title 说清为什么刷新失败（点按展开由移动适配面板负责）。
         if (error && typeof error.code === 'string' && error.code.indexOf('subscription.app-auth-') === 0) return message;
         // HTTP 状态优先取宿主给的 params（结构化、跨语言稳定），退回从文案里解析（旧快照）。
         const statusMatch = message.match(/HTTP (\d{3})/);
         const status = error && error.params && error.params.status != null ? String(error.params.status) : (statusMatch ? statusMatch[1] : '');
         if (kind === 'no-key') return t('ui.noSignInCredentialsFound', { serviceName: serviceName });
         // v1.22：账号能登录但读不到订阅（阿里 Token Plan 之类 AK/SK 场景）——给准确提示，不说“暂时不可用”
         if (kind === 'no-subscription') return t('ui.noSubscriptionFound', { serviceName: serviceName });
         if (kind === 'auth' || status === '401') return t('ui.credentialsHaveExpiredPleaseReauthorize', { serviceName: serviceName });
         if (status === '403') return t('ui.deniedAccessReauthorizeOrTry', { serviceName: serviceName });
         if (status === '429') return t('ui.rateLimitReachedPleaseTry', { serviceName: serviceName });
         if (kind === 'timeout' || /timeout|timed out|abort/i.test(message)) return t('ui.timedOutCheckYourConnection', { serviceName: serviceName });
         if (kind === 'parse') return t('ui.returnedAnUnrecognizedResponsePlease', { serviceName: serviceName });
          return t('ui.isTemporarilyUnavailableCheckYour', { serviceName: serviceName });
      }

      // 订阅制「配置引导」（2026-11-12）：凭据缺失（kind:'no-key'）时不再只给悬停提示。
      // host 按目录注入 error.params.setup：'plugin' = 该服务商需要插件设置页专属凭据
      // （阿里 AK/SK、MiniMax Subscription Key 等），凭据名以字典键列表下发、在此翻译；
      // 'models' 或缺参 → 返回 null，保持原有"刷新失败"降级，不改变既有行为。
      function subscriptionSetupHint(error) {
        if (!error || error.kind !== 'no-key') return null;
        const params = error.params || {};
        if (params.setup !== 'plugin') return null;
        const keys = Array.isArray(params.credentialKeys) ? params.credentialKeys.filter(function (k) { return typeof k === 'string' && k.length > 0; }) : [];
        const serviceName = subscriptionServiceName(visibleBillingMode && visibleBillingMode.provider);
        const credential = keys.length > 0 ? keys.map(function (k) { return t(k); }).join(' / ') : serviceName;
        return {
          title: t('ui.quotaCredentialSetupTitle', { serviceName: serviceName, credential: credential }),
          text: t('ui.quotaCredentialSetupText', { serviceName: serviceName, credential: credential }),
        };
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
          if (errors.sub) {
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
          // 凭据缺失（host 按目录注入 params.setup）→ 与余额制同款的配置引导占 noKeyHint 槽位：
          // 需要插件页专属凭据的服务商（阿里 AK/SK、MiniMax Subscription Key 等）直接给出路径，
          // 不再只留一个悬停才看得见的"刷新失败"。
          const setupHint = subscriptionSetupHint(sub.error);
          if (setupHint) {
            trailingErrorGroups.push(fieldSpan('noKeyHint', 'nokey',
              React.createElement('span', { className: 'bi-err', title: setupHint.title }, setupHint.text)));
            return;
          }
          // 其余 no-key（Codex 令牌缺失 / 需在 DSH 设置 → 模型 配置推理 Key 的服务商）：
          // 失败原因不能只放进 title —— 触屏宿主（DSH Go）没有悬停，用户只会看到裸"刷新失败"
          // 而无法自助（Issue #274：已授权 ChatGPT 却只显示刷新失败）。可见文本直接给
          // 「未找到登录凭证」引导（原悬停文案提升为可见），完整说明保留在 title。
          if (sub.error.kind === 'no-key') {
            const noKeySource = sub.source || (visibleBillingMode && visibleBillingMode.provider);
            trailingErrorGroups.push(fieldSpan('noKeyHint', 'nokey',
              React.createElement('span', { className: 'bi-err', title: subscriptionFailureHint(sub.error, noKeySource) },
                t('ui.noSignInCredentialsFound', { serviceName: subscriptionServiceName(noKeySource) }))));
            return;
          }
          trailingErrorGroups.push(fieldSpan('refreshFailure', 'substale',
            React.createElement('span', { className: 'bi-stale', title: subscriptionFailureHint(sub.error, sub.source || (visibleBillingMode && visibleBillingMode.provider)) }, t('ui.refreshFailed'))));
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
          if ((sub.error || errors.sub)) {
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
          if ((sub.error || errors.sub)) {
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
          if (errors.billing) {
            trailingErrorGroups.push(fieldSpan('refreshFailure', 'billerr',
              React.createElement('span', { className: 'bi-stale', title: billingFailureHint({ kind: 'exception', message: String(errors.billing) }, visibleBillingMode && visibleBillingMode.provider) }, t('ui.refreshFailed'))));
          }
          return;
        }
        const d = bill.data;
        const hasSpend = !!(d && (d.currentPeriodSpend != null || d.usage != null));
        if (bill.error && !hasSpend) {
          trailingErrorGroups.push(fieldSpan('refreshFailure', 'billstale',
            React.createElement('span', { className: 'bi-stale', title: billingFailureHint(bill.error, bill.type || (visibleBillingMode && visibleBillingMode.provider)) }, t('ui.refreshFailed'))));
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
          if ((bill.error || errors.billing)) {
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

      // ---- DSH Go 信息栏三列卡（DESIGN-FINAL §3/§4/§5）----
      // 只在 DSH Go 表面（网页版/整页岛，dshGoCompact）下替换整行；尺寸差异交给 CSS 断点，不要求触屏。
      // 数据只读 renderedState / fieldVisible，不新增 RPC；字段开关仍是唯一显隐来源。
      const goErrors = renderedState.errors || {};
      const goPending = waitForSessionModel || (renderedState.loading === true && !renderedState.billingMode);
      const goUnknownMode = !visibleBillingMode || visibleBillingMode.mode === 'unknown';
      const goContextInfo = fieldVisible('contextUsage') ? contextOccupancy(pressureProj) : null;
      const goWindowMode = activeQuotaDisplayMode();
      const goLanguage = languageRuntime && typeof languageRuntime.locale === 'function' ? languageRuntime.locale() : 'zh';
      const goNarrow = (function () { try { return typeof window !== 'undefined' && window && typeof window.innerWidth === 'number' && window.innerWidth <= 360; } catch (err) { return false; } })();
      const goUnit = function (key) { return t(key); };
      const goMoneyFull = function (currency, value) {
        const symbol = currency === 'USD' ? '$' : '¥';
        const n = typeof value === 'number' && isFinite(value) ? value : 0;
        const fixed = Math.abs(n).toFixed(2);
        const whole = fixed.split('.')[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return symbol + (n < 0 ? '-' : '') + whole + '.' + fixed.split('.')[1];
      };
      const goMoneyCompact = function (currency, value) {
        const symbol = currency === 'USD' ? '$' : '¥';
        const n = typeof value === 'number' && isFinite(value) ? value : 0;
        const abs = Math.abs(n);
        const cjk = goLanguage === 'zh' || goLanguage === 'zh-hant' || goLanguage === 'ja' || goLanguage === 'ko';
        let scaled = abs;
        let unit = '';
        if (cjk) {
          if (abs >= 1e8) { scaled = abs / 1e8; unit = goUnit('number.compactYi'); }
          else if (abs >= 1e4) { scaled = abs / 1e4; unit = goUnit('number.compactWan'); }
        } else if (abs >= 1e9) { scaled = abs / 1e9; unit = goUnit('number.compactB'); }
        else if (abs >= 1e6) { scaled = abs / 1e6; unit = goUnit('number.compactM'); }
        else if (abs >= 1e3) { scaled = abs / 1e3; unit = goUnit('number.compactK'); }
        if (unit === '') return goMoneyFull(currency, n);
        const digits = scaled >= 100 ? 0 : (scaled >= 10 ? 1 : 2);
        const text = scaled.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
        return symbol + (n < 0 ? '-' : '') + text + unit;
      };
      // 金额：≤360 用紧凑单位；窄屏 >8 / 宽屏 >10 字符降一档字号（不截断）；面板永远精确值。
      const goMoneySlot = function (currency, value) {
        if (goNarrow) { const compact = goMoneyCompact(currency, value); return { text: compact, shrink: compact.length > 8 }; }
        const full = goMoneyFull(currency, value);
        return { text: full, shrink: full.length > 10 };
      };
      const goPercent = function (value) {
        const n = typeof value === 'number' && isFinite(value) ? value : 0;
        return Math.max(0, Math.min(100, Math.round(n))) + '%';
      };
      const goWindows = (function () {
        if (!isSub || !renderedState.sub || !Array.isArray(renderedState.sub.windows)) return [];
        return renderedState.sub.windows.filter(function (w) {
          return w && typeof w.usedPercent === 'number' && windowFieldVisible(w.key);
        }).slice().sort(function (a, b) {
          const ma = windowMeta(a.key);
          const mb = windowMeta(b.key);
          return (ma ? ma.priority : 99) - (mb ? mb.priority : 99);
        });
      })();
      const goSlots = [];
      const goPushMoney = function (key, caption, currency, value) {
        const money = goMoneySlot(currency, value);
        goSlots.push({ key: key, caption: caption, value: money.text, shrink: money.shrink });
      };
      // 选列按计费方案智能适配（2026-11-13 用户拍板）：订阅制主列铺额度窗口（5h/周/月），
      // 不把「本会话花了多少钱」这种按量概念摆给订阅用户；按量/账单制才用钱列。
      // 上下文环 / 输出速率作补充列；每列仍受设置页同一套显隐开关约束（可自定义）。
      const goCtxSlot = function () {
        if (!fieldVisible('contextUsage')) return null;
        if (goContextInfo !== null) return { key: 'ctx', caption: t('field.contextUsage.label'), percent: goContextInfo.percent };
        return { key: 'ctx', caption: t('field.contextUsage.label'), value: '—' };
      };
      const goSpeedSlot = function () {
        if (statsProj && fieldVisible('outputSpeed') && statsProj.decodeMs > 0) {
          return { key: 'speed', caption: t('field.outputSpeed.label'), value: formatTps(statsProj.decodeTokens / (statsProj.decodeMs / 1e3)) + ' tok/s' };
        }
        return null;
      };
      if (goPending) {
        // 加载骨架：三列都先给 caption + 占位条（DESIGN-FINAL §5）。
        goSlots.push({ key: 'account', caption: t('ui.balance.pushBalanceGroups'), loading: true });
        goSlots.push({ key: 'cost', caption: t('ui.session'), loading: true });
        goSlots.push({ key: 'ctx', caption: t('field.contextUsage.label'), loading: true });
      } else if (isSub) {
        // 订阅：额度窗口按优先级铺主列；满 3 个时上下文环降为宽屏增量列，不足时环补主列。
        const winSlots = goWindows.map(function (w) {
          return { key: 'quota-' + w.key, caption: compactWindowLabel(w.key), value: goPercent(quotaWindowPercent(w, goWindowMode)), low: remainingPercent(w) <= 20 };
        });
        if (winSlots.length > 0) {
          winSlots.forEach(function (s) { goSlots.push(s); });
        } else {
          const sub = renderedState.sub;
          if (sub && typeof sub.balance === 'number' && fieldVisible('subBalance')) goPushMoney('subbal', t('ui.availableBalanceLabel'), 'CNY', sub.balance);
          else if (sub && sub.plan) goSlots.push({ key: 'plan', caption: t('ui.account'), value: hostText(sub.plan) });
          else if (sub && sub.error && subscriptionSetupHint(sub.error)) goSlots.push({ key: 'setup', caption: t('ui.account'), value: t('ui.credentialNotConfigured') });
          else goSlots.push({ key: 'unbound', caption: t('ui.account'), value: t('ui.accountSignedOut') });
        }
        const speed = goSpeedSlot();
        if (speed) { speed.extra = winSlots.length >= 3 ? 2 : 1; goSlots.push(speed); }
        const ctxSlot = goCtxSlot();
        if (ctxSlot) { if (winSlots.length >= 3) ctxSlot.extra = 1; goSlots.push(ctxSlot); }
      } else {
        // 按量/账单/未知：账户位 + 本会话 + 上下文；宽屏递进补今天/近30天/速率（插在环前）。
        if (isBilling) {
          // 本月花费列受设置页 billingSpend 开关约束（与桌面 pushBillingGroups 同一套显隐）。
          if (fieldVisible('billingSpend')) {
            const bill = renderedState.billing;
            const d = bill && bill.data;
            if (d && d.currentPeriodSpend != null) goPushMoney('bill', t('ui.thisMonth'), d.currency, d.currentPeriodSpend);
            else if (d && d.usage != null) goSlots.push({ key: 'bill', caption: t('ui.thisMonthSUsage'), value: String(d.usage) + (d.usageUnit ? ' ' + d.usageUnit : '') });
            else goSlots.push({ key: 'bill', caption: t('ui.thisMonth'), value: '—' });
          }
        } else {
          const bal = renderedState.balance;
          if (bal && bal.data && fieldVisible('balance')) {
            goPushMoney('balance', t('ui.balance.pushBalanceGroups'), bal.currency, bal.data.total);
            if (bal.alert && bal.alert.active) goSlots[goSlots.length - 1].low = true;
          } else if (bal && bal.error) {
            goSlots.push({ key: 'unbound', caption: t('ui.account'), value: t('ui.accountSignedOut') });
          } else if (goErrors.balance) {
            goSlots.push({ key: 'error', caption: t('ui.account'), value: '—' });
          } else if (goUnknownMode) {
            const pr = visiblePricing;
            goSlots.push({ key: 'model', caption: t('ui.unknown'), value: pr ? (pr.modelDisplay || pr.model || '—') : '—' });
          } else if (fieldVisible('balance')) {
            goSlots.push({ key: 'account', caption: t('ui.account'), value: '—' });
          }
        }
        // 本会话花费（无价格表退化 token；无数据则隐藏该列，宽度让给其余列）
        if (fieldVisible('sessionCost')) {
          const usg = renderedState.usage;
          const cs = usg && usg.currentSession;
          const costCNY = cs && cs.costs && cs.costs.CNY != null ? cs.costs.CNY : null;
          const costUSD = cs && cs.costs && cs.costs.USD != null ? cs.costs.USD : null;
          if (costCNY != null || costUSD != null) {
            goPushMoney('cost', t('ui.session'), costCNY != null ? 'CNY' : 'USD', costCNY != null ? costCNY : costUSD);
          } else if (cs && cs.tokens > 0) {
            goSlots.push({ key: 'cost', caption: t('ui.session'), value: formatTokens(cs.tokens) + ' tok' });
          } else if (usg || goErrors.usage) {
            goSlots.push({ key: 'cost', caption: t('ui.session'), value: '—' });
          }
        }
        const ctxSlot = goCtxSlot();
        if (ctxSlot) goSlots.push(ctxSlot);
        // 宽屏增量列：今天 → 近 30 天 → 输出速率；data-extra 档位显隐由 CSS 断点决定，
        // 手机档不占位；上下文环始终最后（圆环贴右），增量插在它前面。
        if (renderedState.usage && (fieldVisible('todaySpend') || fieldVisible('last30dSpend'))) {
          const goUsage = renderedState.usage;
          const goInsertExtra = function (slot) {
            const ctxAt = goSlots.findIndex(function (s) { return s.key === 'ctx'; });
            if (ctxAt >= 0) goSlots.splice(ctxAt, 0, slot);
            else goSlots.push(slot);
          };
          const extraSlot = function (key, caption, value, tier) {
            if (value == null || !isFinite(value)) return;
            const money = goMoneySlot('CNY', value);
            goInsertExtra({ key: key, caption: caption, value: money.text, shrink: money.shrink, extra: tier });
          };
          extraSlot('today', t('field.todaySpend.label'), fieldVisible('todaySpend') ? goUsage.todaySpend : null, 1);
          extraSlot('month', t('field.last30dSpend.label'), fieldVisible('last30dSpend') ? goUsage.last30dSpend : null, 2);
          const speed = goSpeedSlot();
          if (speed) { speed.extra = 3; goInsertExtra(speed); }
        }
      }
      const useGoCard = dshGoCompact && goSlots.length > 0;

      // ---- 展开面板数据（DESIGN-FINAL §3/§5；无分割线：行间 2px、分组 16）----
      const goSheetSections = [];
      const goSection = function (label, rows) {
        const list = rows.filter(function (row) { return row && row.v != null && String(row.v).length > 0; });
        if (list.length > 0) goSheetSections.push({ label: label, rows: list });
      };
      if (useGoCard) {
        const accountRows = [];
        const pr = visiblePricing;
        if (pr) {
          const modelText = [pr.providerDisplay, pr.modelDisplay || pr.model].filter(Boolean).join(' · ');
          if (modelText) accountRows.push({ k: t('section.identity.label'), v: modelText });
        }
        if (isSub) {
          const sub = renderedState.sub;
          if (sub && sub.plan) accountRows.push({ k: t('ui.subscription'), v: hostText(sub.plan) });
          if (sub && sub.expiryAt) accountRows.push({ k: t('ui.expires'), v: formatDate(sub.expiryAt) });
          if (sub && typeof sub.balance === 'number' && sub.balanceUnit !== 'credits') accountRows.push({ k: t('ui.availableBalanceLabel'), v: goMoneyFull('CNY', sub.balance) });
        } else if (isBilling) {
          const bill = renderedState.billing;
          const d = bill && bill.data;
          if (d && d.currentPeriodSpend != null) accountRows.push({ k: t('ui.thisMonth'), v: goMoneyFull(d.currency, d.currentPeriodSpend) });
          if (d && d.budgetPercent != null) accountRows.push({ k: t('ui.budget'), v: Math.round(d.budgetPercent) + '%' });
          if (d && d.freeRemaining != null) accountRows.push({ k: t('ui.free'), v: String(d.freeRemaining) });
        } else {
          const bal = renderedState.balance;
          if (bal && bal.data) {
            const granted = typeof bal.data.granted === 'number' && isFinite(bal.data.granted) ? bal.data.granted : 0;
            const toppedUp = typeof bal.data.toppedUp === 'number' && isFinite(bal.data.toppedUp) ? bal.data.toppedUp : 0;
            accountRows.push({
              k: t('ui.balance.pushBalanceGroups'),
              v: goMoneyFull(bal.currency, bal.data.total),
              small: granted > 0 ? t('ui.balanceDetailToppedUp', { symbol: bal.currency === 'USD' ? '$' : '¥', value: goMoneyFull(bal.currency, toppedUp).slice(1) }) + ' · ' + t('ui.balanceDetailGranted', { symbol: bal.currency === 'USD' ? '$' : '¥', value: goMoneyFull(bal.currency, granted).slice(1) }) : null,
            });
          }
        }
        if (goPending) accountRows.push({ k: t('ui.loadingInfoBarSettings'), v: '' });
        goSection(t('ui.account'), accountRows);
        if (!goPending && !isSub && !isBilling && renderedState.balance && renderedState.balance.error) {
          const hint = configHintFor(renderedState.balance.error);
          if (hint) goSection(t('ui.account'), [{ k: t('ui.account'), v: t('ui.accountSignedOut'), small: hint.title }]);
        }
        if (isSub && goWindows.length > 0) {
          goSection(t('ui.subscriptionQuota'), goWindows.map(function (w) {
            const remaining = remainingPercent(w);
            return { k: quotaWindowLabel(w), v: goPercent(quotaWindowPercent(w, goWindowMode)), low: remaining <= 20, bar: quotaWindowPercent(w, goWindowMode), small: (w.resetsAt && fieldVisible('resetCountdown')) ? fmtResetCountdown(w.resetsAt - now) : null };
          }));
        }
        const spendRows = [];
        const usg = renderedState.usage;
        if (usg) {
          const cs = usg.currentSession;
          const costCNY = cs && cs.costs && cs.costs.CNY != null ? cs.costs.CNY : null;
          const costUSD = cs && cs.costs && cs.costs.USD != null ? cs.costs.USD : null;
          if (costCNY != null || costUSD != null) { if (fieldVisible('sessionCost')) spendRows.push({ k: t('ui.session'), v: goMoneyFull(costCNY != null ? 'CNY' : 'USD', costCNY != null ? costCNY : costUSD) }); }
          if (usg.todaySpend != null && fieldVisible('todaySpend')) spendRows.push({ k: t('ui.today', { symbol: '¥', value: '' }).replace(/\s*¥?\s*$/, '').trim(), v: goMoneyFull('CNY', usg.todaySpend) });
          if (usg.last30dSpend != null && fieldVisible('last30dSpend')) spendRows.push({ k: t('ui.lastDays', { symbol: '¥', value: '' }).replace(/\s*¥?\s*$/, '').trim(), v: goMoneyFull('CNY', usg.last30dSpend) });
          if (usg.totalSpend != null) spendRows.push({ k: t('ui.allTime', { symbol: '¥', value: '' }).replace(/\s*¥?\s*$/, '').trim(), v: goMoneyFull('CNY', usg.totalSpend) });
        }
        goSection(t('ui.spend'), spendRows);
        // 宿主原生统计行的全部指标：不再以宿主样式单独占一行，收进同一套行里。
        const nativeRows = [];
        if (statsProj) {
          if (fieldVisible('turnsSteps')) nativeRows.push({ k: t('field.turnsSteps.label'), v: t(statsProj.turns === 1 ? 'ui.turnCount' : 'ui.turnCountPlural', { count: statsProj.turns }) + ' · ' + t(statsProj.steps === 1 ? 'ui.stepCount' : 'ui.stepCountPlural', { count: statsProj.steps }) });
          if (statsProj.llmMs > 0 && fieldVisible('llmTime')) nativeRows.push({ k: t('field.llmTime.label'), v: formatDuration(statsProj.llmMs) });
          if (statsProj.toolMs > 0 && fieldVisible('toolTime')) nativeRows.push({ k: t('ui.tools'), v: formatDuration(statsProj.toolMs) });
          if (statsProj.ttftSteps > 0 && fieldVisible('avgTTFT')) nativeRows.push({ k: t('ui.avgTTFT'), v: formatDuration(statsProj.ttftMs / statsProj.ttftSteps) });
          if (statsProj.decodeMs > 0 && fieldVisible('outputSpeed')) nativeRows.push({ k: t('field.outputSpeed.label'), v: formatTps(statsProj.decodeTokens / (statsProj.decodeMs / 1e3)) + ' tok/s' });
        }
        if (usageProj) {
          const nativeDenom = billedInput(usageProj);
          const nativeCache = usageProj.cacheReadTokens || 0;
          if (nativeDenom > 0 && fieldVisible('cacheHit')) nativeRows.push({ k: t('ui.cacheHit'), v: (Math.round((nativeCache / nativeDenom) * 1000) / 10) + '%' });
          if (nativeDenom > 0 || (usageProj.outputTokens || 0) > 0) nativeRows.push({ k: t('field.tokensIO.label'), v: formatTokens(nativeDenom) + ' / ' + formatTokens(usageProj.outputTokens || 0) });
        }
        goSection(t('group.native'), nativeRows);
        const periodRows = [];
        if (pr && pr.mode === 'peak-valley' && fieldVisible('period')) periodRows.push({ k: t('field.period.label'), v: pr.period === 'peak' ? t('ui.peakPrice') : t('ui.offPeakPrice') });
        if (pr && pr.mode === 'peak-valley' && pr.nextSwitch && fieldVisible('countdown')) periodRows.push({ k: t('ui.until') + (pr.period === 'peak' ? t('ui.offPeak') : t('ui.peak')), v: fmtCountdown(pr.nextSwitch.at - now) });
        goSection(t('field.period.label'), periodRows);
        if (goContextInfo !== null) {
          goSection(t('field.contextUsage.label'), [
            { k: t('ui.contextUsed'), v: contextTokenText(goContextInfo.usedTokens) + ' / ' + contextTokenText(goContextInfo.contextWindow) },
            { k: t('ui.percent'), v: goPercent(goContextInfo.percent) },
          ]);
        }
        const noticeRows = [];
        if (renderedState.balance && renderedState.balance.error) {
          const hint = configHintFor(renderedState.balance.error);
          noticeRows.push({ k: t('ui.refreshFailed'), v: hint ? hint.text : t('ui.balanceUnavailable') });
        }
        if (goErrors.balance) noticeRows.push({ k: t('ui.refreshFailed'), v: t('ui.balanceUnavailable') });
        if (isSub && renderedState.sub && renderedState.sub.error) {
          // 缺插件专属凭据时给可自助的配置引导（与桌面 noKeyHint 槽位同源），
          // 不再退回通用「未找到登录凭证·请重新授权」——重新授权对缺 AK/SK 无效。
          const subSetupHint = subscriptionSetupHint(renderedState.sub.error);
          noticeRows.push({ k: t('ui.refreshFailed'), v: subSetupHint ? subSetupHint.text : subscriptionFailureHint(renderedState.sub.error, visibleBillingMode && visibleBillingMode.provider) });
        }
        if (isSub && goErrors.sub) noticeRows.push({ k: t('ui.refreshFailed'), v: subscriptionFailureHint({ kind: 'exception', message: String(goErrors.sub) }, visibleBillingMode && visibleBillingMode.provider) });
        if (isBilling && renderedState.billing && renderedState.billing.error) noticeRows.push({ k: t('ui.refreshFailed'), v: billingFailureHint(renderedState.billing.error, visibleBillingMode && visibleBillingMode.provider) });
        if (isBilling && goErrors.billing) noticeRows.push({ k: t('ui.refreshFailed'), v: billingFailureHint({ kind: 'exception', message: String(goErrors.billing) }, visibleBillingMode && visibleBillingMode.provider) });
        if (goErrors.usage) noticeRows.push({ k: t('ui.spendUnavailable'), v: t('ui.spendIsTemporarilyUnavailableChat') });
        if (goErrors.pricing) noticeRows.push({ k: t('ui.pricing'), v: t('ui.refreshFailed') });
        if (goErrors.billingMode) noticeRows.push({ k: t('ui.mode'), v: t('ui.refreshFailed') });
        if (renderedState.usage && renderedState.usage.persistence && renderedState.usage.persistence.state && renderedState.usage.persistence.state !== 'ok') {
          noticeRows.push({ k: t('ui.spend'), v: renderedState.usage.persistence.state === 'snapshot-stale' ? t('ui.ledgerUpdatePending') : t('ui.spendNotSaved') });
        }
        goSection(t('group.notice'), noticeRows);
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
      if (failedLabels.length > 0) {
        trailingErrorGroups.push(fieldSpan('refreshFailure', 'degraded',
          React.createElement('span', { className: 'bi-stale', key: 'degraded',
            title: failedLabels.join(t('ui.listSeparator')) + t('ui.temporarilyUnavailableKeepingTheLast') }, t('ui.refreshFailed'))));
      }
      const persistence = renderedState.usage && renderedState.usage.persistence;
      if (persistence && persistence.state && persistence.state !== 'ok') {
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
       // 悬浮提示也要按重启方向选：磁盘被外部换成旧版时，说「已更新到 X」等于把方向说反了。
       const restartKind = restartVersion ? bibSetRestartKind(updateStatus) : null;
       const restartRunning = updateStatus && typeof updateStatus.runningVersion === 'string' && updateStatus.runningVersion.length > 0
         ? updateStatus.runningVersion : t('ui.versionUnknown');
       const restartTitle = restartKind === 'rollback'
         ? t('ui.updateRolledBack', { version: restartVersion })
         : (restartKind === 'update'
           ? t('ui.updatePendingRestart', { version: restartVersion })
           : t('ui.updateDowngradePending', { version: restartVersion, running: restartRunning }));
       const updateFailed = !!(updateStatus && updateStatus.lastError);
       if (restartVersion) {
         trailingErrorGroups.push(fieldSpan('updateNotice', 'updatebadge', React.createElement('span', {
           key: 'updateBadge',
           className: 'bi-update-badge',
           title: restartTitle,
           onClick: function (event) { event.stopPropagation(); },
           onKeyDown: function (event) { event.stopPropagation(); },
         }, t('ui.updateRestartBadge'))));
       }
       if (updateFailed) {
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
       // DSH Go 三列卡：无竖线，三列等分，首/中/末分别贴左、居中、贴右。
       const goRingRadius = 8;
       const goRingLength = 2 * Math.PI * goRingRadius;
       const goStrip = !useGoCard ? null : React.createElement('div', { className: 'bi-go-strip', 'data-slots': String(goSlots.length) },
         goSlots.map(function (slot) {
           const cap = React.createElement('span', { key: 'cap', className: 'bi-go-cap' }, slot.caption);
           let body;
           if (slot.loading) {
             body = React.createElement('span', { key: 'ph', className: 'bi-go-ph', 'aria-hidden': 'true' });
           } else if (slot.percent != null) {
             body = React.createElement('span', { key: 'val', className: 'bi-go-ringrow' },
               React.createElement('svg', { className: 'bi-go-ring', viewBox: '0 0 20 20', width: 17, height: 17, 'aria-hidden': 'true' },
                 React.createElement('circle', { className: 'bi-go-ring-track', cx: 10, cy: 10, r: goRingRadius, fill: 'none', strokeWidth: 3 }),
                 React.createElement('circle', { className: 'bi-go-ring-fill', cx: 10, cy: 10, r: goRingRadius, fill: 'none', strokeWidth: 3, strokeLinecap: 'round', strokeDasharray: goRingLength, strokeDashoffset: goRingLength * (1 - slot.percent / 100), transform: 'rotate(-90 10 10)' })),
               React.createElement('span', { className: 'bi-go-val' }, slot.percent + '%'));
           } else {
             body = React.createElement('span', { key: 'val', className: 'bi-go-val' + (slot.low ? ' bi-go-val--low' : '') + (slot.shrink ? ' bi-go-val--shrink' : '') }, slot.value);
           }
           return React.createElement('div', {
             key: slot.key,
             className: 'bi-go-col',
             'data-slot': slot.key,
             'data-extra': slot.extra || undefined,
           }, cap, body);
         }));
       // 桌面/纯浏览器：主行无条件渲染（圆环与末节点同组），保持原有结构与像素。
       const row2 = React.createElement('div', { id: 'dsh-bottom-info-bar-primary', className: 'bi-row2' }, ...attachContextMeter(nodes, contextNode, React.createElement));
       // DSH Go：同一位置换成三列卡（主行仍然无条件渲染，只是内容不同）。
       const goRow2 = useGoCard ? React.createElement('div', { id: 'dsh-bottom-info-bar-primary', className: 'bi-row2 bi-go-row2' }, goStrip) : row2;

      let row1 = null;
      if (statsProj && !nativePills) {
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
      // 新宿主原生组不在插件行里渲染（是 Harness 自己的两个按钮），因此不计入「插件底栏是否有内容」；
      // 它们的开关由 documentElement 属性单独生效，底栏整行移除时也照样能隐藏按钮。
      const removalRegistry = nativePills
        ? FIELD_REGISTRY.filter(function (field) { return field.group !== 'native'; })
        : FIELD_REGISTRY;
      // DSH Go 三列卡始终有内容（账户位永不为空），允许加载态先渲染骨架；全部字段关闭仍整体移除。
      if (infoBarShouldRemoveAll(removalRegistry, fieldVisible) || (!useGoCard && (row1 === null && nodes.length === 0 && contextNode === null))) {
        return null;
      }

      // Modern DSH keeps the real native buttons and their dialogs in the host outlet.
      // This row is still the Full/Compact switch: clicking any plugin field toggles the
      // density (the user decision from 2026-10-17), while the native buttons above keep
      // their own click behavior. Nested plugin controls stop propagation themselves.
      // 触屏例外（2026-11-12）：hover 不可用时整栏点击改为展开明细面板，密度切换移到面板按钮上
      // （见模块级 touchDetailsEnabled 注释）；桌面端这条分支不生效。
      // DSH Go 卡（2026-11-13）：Go 皮肤按表面门控、不要求触屏（平板/大窗/鼠标环境也是 Go），
      // 而 Go 卡没有桌面那条双行密度切换——点整栏的语义永远是「展开/收起明细面板」。
      // 所以只要走 Go 卡就展开面板，不能再依赖 touchDetails，否则 hover 可用的 Go 表面上面板永远打不开。
      const barExpandsSheet = useGoCard || touchDetails;
      const onBarActivate = function () {
        if (barExpandsSheet) {
          setDetailsOpen(function (open) { return !open; });
          return;
        }
        props.onToggleDensity();
      };
      const onBarKeyDown = function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (barExpandsSheet) {
            setDetailsOpen(function (open) { return !open; });
            return;
          }
          props.onToggleDensity();
        }
      };
      const animatedRow1 = row1 === null ? null : React.createElement('div', { className: 'bi-density-extra', ref: extraRowRef }, row1);
      const actionNode = React.createElement('span', { id: 'dsh-bottom-info-bar-action', className: 'bi-sr-only' },
        full ? t('ui.pressEnterOrSpaceFor') : t('ui.pressEnterOrSpaceFor.BottomInfoBar'));
      const barProps = {
        className: 'bi-root' + (useGoCard ? ' bi-go-bar' : ''),
        ref: barRef,
        onClick: onBarActivate,
        onKeyDown: onBarKeyDown,
        role: 'button',
        tabIndex: 0,
        'aria-describedby': 'dsh-bottom-info-bar-action',
        'aria-pressed': full,
        // 触屏/Go 卡上的点击语义是「展开明细」，不是「切换密度」：用 aria-expanded 如实表达。
        'aria-expanded': barExpandsSheet ? detailsOpen : undefined,
        'aria-busy': isDensitySaving,
        'aria-disabled': isDensitySaving,
        'data-density': displayDensity,
        'data-density-saving': isDensitySaving,
        // 触屏没有 hover：title 提示没有意义，还会让长按弹出无用提示；桌面端保持原文案。
        title: barExpandsSheet ? undefined : (isDensitySaving ? t('ui.savingView') : t('ui.clickToSwitchFullCompact')),
      };
      const barNode = nativePills
        ? React.createElement('div', Object.assign({}, barProps, {
          'data-native-pills': 'true',
          'aria-labelledby': 'dsh-bottom-info-bar-primary',
        }), goRow2, actionNode)
        : React.createElement('div', Object.assign({}, barProps, {
          'aria-labelledby': nativeRowShown ? 'dsh-bottom-info-bar-native dsh-bottom-info-bar-primary' : 'dsh-bottom-info-bar-primary',
        }), animatedRow1, goRow2, actionNode);

      // DSH Go 展开面板（DESIGN-FINAL §3/§5）：28 圆角、面 low、16 内边距、40vh 内滚；
      // 卡内无分割线（行间 2px、分组 16）；动作行只保留「刷新」（设置无导航 API，隐藏）。
      // 面板底部渐隐只在「下面还有内容」时出现：滚到底就撤掉，
      // 否则最后一行会一直蒙着一层灰，看起来像被裁坏了。
      const goSheetSyncFade = function (el) {
        if (!el) return;
        var more = el.scrollHeight - el.scrollTop - el.clientHeight > 2;
        if (more) el.setAttribute('data-more', '1');
        else el.removeAttribute('data-more');
      };
      const goSheet = !(useGoCard && detailsOpen) ? null : React.createElement('div', {
        className: 'bi-go-sheet',
        role: 'region',
        'aria-label': t('ui.infoDetails'),
      },
        React.createElement('div', { className: 'bi-go-sheet-head' },
          React.createElement('span', { className: 'bi-go-sheet-title' }, t('ui.infoDetails')),
          // 标题行只留「刷新」一个动作（2026-11-13 用户拍板 A）：
          // 信息栏整条本身就能点开/点收，再摆一个「收起」属于重复入口，删掉。
          React.createElement('button', {
            type: 'button',
            className: 'bi-go-act',
            onClick: function () { if (typeof load === 'function') load(); },
          }, t('ui.refresh'))),
        React.createElement('div', {
          className: 'bi-go-sheet-body',
          ref: goSheetSyncFade,
          onScroll: function (e) { goSheetSyncFade(e.currentTarget); },
        },
          goSheetSections.length === 0
            ? React.createElement('div', { className: 'bi-go-empty' }, goPending ? t('ui.loadingInfoBarSettings') : t('ui.unknown'))
            : goSheetSections.map(function (section, sectionIndex) {
              return React.createElement('div', { key: 'gs' + sectionIndex, className: 'bi-go-sec' },
                React.createElement('div', { className: 'bi-go-sec-lbl' }, section.label),
                React.createElement('div', { className: 'bi-go-rows' }, section.rows.map(function (row, rowIndex) {
                  // 带进度条的额度行：整行宽两段式——头行左窗口名、右百分比+倒计时，下面整行宽进度条。
                  // 旧版把条塞进右侧窄列（132px），左半边整片空白，与上面左标签右值的行不成体系。
                  if (row.bar != null) {
                    return React.createElement('div', { key: 'gr' + rowIndex, className: 'bi-go-row bi-go-row--meter' },
                      React.createElement('div', { className: 'bi-go-meter-head' },
                        React.createElement('span', { className: 'bi-go-k' }, row.k),
                        React.createElement('span', { className: 'bi-go-meter-val' },
                          React.createElement('span', { className: 'bi-go-v' + (row.low ? ' bi-go-v--low' : '') }, row.v),
                          row.small ? React.createElement('small', { className: 'bi-go-small' }, row.small) : null)),
                      React.createElement('span', { className: 'bi-go-progress' + (row.low ? ' bi-go-progress--low' : ''), 'aria-hidden': 'true' },
                        React.createElement('span', { className: 'bi-go-progress-fill', style: { width: Math.max(0, Math.min(100, row.bar)) + '%' } })));
                  }
                  return React.createElement('div', { key: 'gr' + rowIndex, className: 'bi-go-row' + (row.small ? ' bi-go-row--sub' : '') },
                    React.createElement('span', { className: 'bi-go-k' }, row.k),
                    React.createElement('span', { className: 'bi-go-v-wrap' },
                      React.createElement('span', { className: 'bi-go-v' + (row.low ? ' bi-go-v--low' : '') }, row.v),
                      row.small ? React.createElement('small', { className: 'bi-go-small' }, row.small) : null));
                })));
            })));

      // 非 DSH Go 手机浏览器：保留上一版的 title 明细面板（桌面端不渲染）。
      const detailsNode = useGoCard ? goSheet : !(touchDetails && detailsOpen) ? null : React.createElement('div', {
        className: 'bi-mobile-details',
        role: 'region',
        'aria-label': t('ui.infoBarSettings'),
      },
        React.createElement('ul', { className: 'bi-mobile-details-list' },
          detailsItems.map(function (item, index) {
            return React.createElement('li', { key: 'md' + index, className: 'bi-mobile-details-item' }, item);
          })),
        React.createElement('div', { className: 'bi-mobile-details-actions' },
          React.createElement('button', {
            key: 'md-density',
            type: 'button',
            className: 'bi-mobile-details-button',
            onClick: function () { props.onToggleDensity(); },
          }, isDensitySaving ? t('ui.savingView') : t('ui.clickToSwitchFullCompact')),
          React.createElement('button', {
            key: 'md-close',
            type: 'button',
            className: 'bi-mobile-details-button',
            onClick: function () { setDetailsOpen(false); },
          }, t('ui.collapse'))));

      // Go 模式：条与明细同属一张卡，展开是这张卡往下长，不是下面再放一张。
      // 容器必须始终存在：页边与宽度都挂在它身上，收起态也不能少。
      if (useGoCard) return React.createElement('div', { className: 'bi-go-card', 'data-open': detailsOpen ? '1' : '0' }, barNode, detailsNode);
      if (detailsNode === null) return barNode;
      return React.createElement(React.Fragment, null, barNode, detailsNode);
    }
  },
};
