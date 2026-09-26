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
const BIB_SET_PRIMITIVES = require('@deepseek-ai/dsh-client-ui-primitives');
// 上下文明细面板要挂到 body（底栏处在多层 flex/滚动容器里，就地渲染会被裁切；原生 ContextMeter 同样用 portal）。
// react-dom 是 web 客户端公开的 seed 模块；缺失/形态不符时降级为就地渲染，不影响信息栏本身。
let ReactDOM = null;
try {
  const candidate = require('react-dom');
  if (candidate && typeof candidate.createPortal === 'function') ReactDOM = candidate;
} catch (err) { ReactDOM = null; }
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
const LOCALES = /*__LOCALES__*/{};
let t;
let localeService;
// 文案取值（跟随宿主界面语言）：优先 DSH 的 locale 服务；服务缺席、未授权或 bind 失效时
// 按浏览器语言兜底，最后退英文。**整段取值都必须包在 try/catch 里**——cordis 对未在 inject
// 里声明的服务属性会直接抛 cannot get property "locale" without inject，渲染期抛错会让
// 整块配置区静默消失（页面上只剩宿主渲染的标题和描述）。取不到文案是小事，页面消失是大事。
function browserDictionary() {
  const nav = typeof navigator !== 'undefined' ? navigator
    : (typeof window !== 'undefined' && window ? window.navigator : undefined);
  const tags = nav && nav.languages && nav.languages.length > 0 ? nav.languages : [nav && nav.language];
  for (let i = 0; i < tags.length; i++) {
    if (!tags[i]) continue;
    const base = String(tags[i]).toLowerCase().split('-')[0];
    if (LOCALES[base]) return LOCALES[base];
  }
  return LOCALES.en;
}
function formatCopy(template, params) {
  return String(template).replace(/\{(\w+)\}/g, function (match, name) {
    return params && Object.hasOwn(params, name) ? String(params[name]) : match;
  });
}
function createTranslator(service) {
  let bound = null;
  if (service && typeof service.bind === 'function') {
    try { bound = service.bind(LOCALE_NAMESPACE); } catch (err) { bound = null; }
  }
  return function translate(key, params) {
    if (bound) {
      try {
        const resolved = bound(key, params);
        if (typeof resolved === 'string' && resolved !== '' && resolved !== key) return resolved;
      } catch (err) { /* 绑定失效：继续走浏览器语言兜底 */ }
    }
    const dictionary = browserDictionary();
    const template = (dictionary && dictionary[key]) || (LOCALES.en && LOCALES.en[key]) || key;
    return params ? formatCopy(template, params) : template;
  };
}
// apply() 之前也可能有渲染路径（hostText）：先给一份按浏览器语言兜底的翻译器。
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

// 排版优化（正式版）：完整模式下隐藏"首 token 平均 / tok/s"两个低优先级原生字段，
// 让原生统计行在 748px 对话宽度下单行放得下；hover 信息浮窗（title）仍显示全部原生信息。
const HIDE_SPEED_FIELDS = true;
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
  const timer = window.setTimeout(function () { abortReason = t('ui.requestTimedOut'); controller.abort(); }, RPC_TIMEOUT_MS);
  function onExternalAbort() { abortReason = t('ui.requestCanceled'); controller.abort(); }
  function cleanup() {
    window.clearTimeout(timer);
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
const PRESET_COLORS = /*__PRESET_COLORS__*/[];
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
// 订阅窗口 key → 字段 id：三个窗口是三个独立字段，各自开关、各自着色，两种模式一视同仁
const WINDOW_FIELD_IDS = { five_hour: 'subWindow5h', seven_day: 'subWindowWeek', monthly: 'subWindowMonth' };
function windowFieldVisible(key) {
  const id = WINDOW_FIELD_IDS[key];
  return id ? fieldVisible(id) : true;
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

function installStyles() {
  const id = 'dsh-bottom-info-bar';
  const existing = document.querySelector('style[data-plugin-css="' + id + '"]');
  if (existing !== null) return function () {};
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-bottom-info-bar';
  style.dataset.pluginCss = id;
  style.textContent = `
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
      .bi-root { --bi-label-primary: var(--dsw-alias-label-primary, #333); --bi-label-supporting: #3f444a; --bi-separator: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.5)); --bi-state-price-low: #087f5b; --bi-state-alert: #d92d20; --bi-line: calc(20px + var(--dsh-content-font-delta-secondary, 0px)); --bi-extra-h: var(--bi-line); text-align: center; box-sizing: border-box; width: var(--dsh-chat-content-width, 100%); max-width: 100%; padding: 4px 0px 0px; margin: 0 auto; display: flex; flex-direction: column; justify-content: flex-end; align-content: end; align-items: stretch; gap: 0; align-self: center; height: auto; font-size: var(--dsh-content-font-size-secondary, 13px); line-height: var(--bi-line); color: var(--bi-label-supporting); font-variant-numeric: tabular-nums; cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
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
      .bi-vision { display: inline-flex; align-items: center; box-sizing: border-box; min-width: 0; max-width: 100%; height: 16px; margin: 0; padding: 0 6px; border: 1px solid #0044cc; border-radius: 999px; color: #fff; background: #0057ff; font-size: 12px; font-weight: 600; line-height: 14px; white-space: nowrap; }
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
      /* 构成明细面板：与原生 ContextMeter 面板同构（264px 宽 / 12px 内边距 / 12px 圆角 / 4px 构成条）。 */
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
  // 与原生 ContextMeter 同一用法：label / side / delayMs / disabled（面板打开时让位，不再弹提示）。
  const trigger = CONTEXT_TOOLTIP === null ? button
    : React.createElement(CONTEXT_TOOLTIP, { label: ariaText, side: 'top', delayMs: 200, disabled: open }, button);

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
const FIELD_GROUP_DESC_KEYS = { native: 'group.native.desc', plugin: 'group.plugin.desc', notice: 'group.notice.desc' };
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
    React.createElement('div', {
      id: props.contentId,
      className: 'bib-set-collapse' + (open ? ' bib-set-collapse--expanded' : ' bib-set-collapse--collapsed'),
      'aria-hidden': open ? undefined : 'true',
      inert: open ? undefined : true,
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
    window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 0);
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
  if (typeof window === 'undefined' || typeof window.setInterval !== 'function') return null;
  return window.setInterval(fn, ms);
}
function bibSetPollingStop(id) {
  if (id === null || typeof window === 'undefined' || typeof window.clearInterval !== 'function') return;
  window.clearInterval(id);
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
  let statusText = t('ui.updateUpToDate');
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

  // 设置页跟随 DSH 的全局语言；这里不提供重复的插件语言开关。
  const [, setLocaleRevision] = React.useState(0);
  React.useEffect(function () {
    if (!localeService || typeof localeService.subscribe !== 'function') return undefined;
    return localeService.subscribe(function () {
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
  // 与设置快照分开维护：后台自动更新是异步发生的（启动后延迟触发），状态会自己变，
  // 所以单独拉取并定期跟随，用户不必手动刷新页面。
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
  // 「检查更新」= 只问不装。走 checkUpdate（宿主侧是纯读接口），绝不碰包文件。
  function onCheckUpdate() {
    return runUpdateAction('check', function () { return rpc('checkUpdate'); });
  }
  // 「更新到 X」= 唯一的安装动作，只在真有可装的新版时出现。
  function onInstallUpdate() {
    return runUpdateAction('install', function () { return rpc('installUpdate'); });
  }
  // 「允许更新到 X」：用户回滚过的版本默认不再装回来（引擎侧 holdVersion），
  // 只有这个显式动作才解除暂缓 —— 逃生门不能被自动流程悄悄重新打开。
  function onForceUpdate() {
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
        bibSetAlert({ tone: 'info', children: t('ui.loadingInfoBarSettings') }));
    }
    if (status === 'error') {
      return React.createElement('div', { ref: settingsRootRef, className: 'bib-set-root bib-settings' },
        React.createElement('div', { className: 'bib-set-page-head' }, bibSetPageTitle()),
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
    // slots 服务可能晚于 apply 就绪：优先 ctx.slots（inject 注入属性），回退 ctx.get('slots')；
    // 轮询等待采用渐进退避（300ms 起步，逐步增至 1s，总计约 45s），避免固定间隔在启动慢时过早放弃
    let slots = ctx.slots || ctx.get('slots');
    for (let i = 0; slots === undefined && i < 80; i++) {
      const delay = Math.min(300 + i * 20, 1000);
      await new Promise(function (resolve) { window.setTimeout(resolve, delay); });
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
      const [fieldConfigTick, setFieldConfigTick] = React.useState(fieldConfigVersion);
      React.useEffect(function () {
        const listener = function () { setFieldConfigTick(fieldConfigVersion); };
        fieldConfigListeners.add(listener);
        setFieldConfigTick(fieldConfigVersion);
        return function () { fieldConfigListeners.delete(listener); };
      }, []);
      void fieldConfigTick;

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
        const id = window.setInterval(load, 30000);
        return function () { window.clearInterval(id); };
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
         const timer = window.setInterval(readUpdateInfo, UPDATE_INFO_REFRESH_MS);
         const onVisible = function () {
           if (document.visibilityState === 'visible') readUpdateInfo();
         };
         document.addEventListener('visibilitychange', onVisible);
         window.addEventListener('focus', onVisible);
         return function () {
           active = false;
           window.clearInterval(timer);
           document.removeEventListener('visibilitychange', onVisible);
           window.removeEventListener('focus', onVisible);
         };
       }, []);

      // 会话统计变化（回复中 turns/steps/tokens 增长，回复完成时停止）→ 防抖后即时刷新花费，
      // 不等下一个 30s 轮询：用户回复一结束即可看到真实金额
      React.useEffect(function () {
        if (!statsProj) return undefined;
        const timer = window.setTimeout(load, 800);
        return function () { window.clearTimeout(timer); };
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
          id = window.setInterval(function () { setNow(Date.now()); }, 1000);
        }
        function stop() {
          if (id !== null) { window.clearInterval(id); id = null; }
        }
        start();
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
      // v1.6 T7：订阅 provider 集合提取为共享常量，消除两端硬编码漂移
      var SUBSCRIPTION_PROVIDERS = /*__SUBSCRIPTION_PROVIDERS__*/[];
      // v1.7 FR-14：云账单 provider 集合（账单型显示，与余额/额度互斥）
      var BILLING_PROVIDERS = /*__BILLING_PROVIDERS__*/[];
      const visibleBillingMode = activeSessionModel && (!state.billingMode
        || state.billingMode.provider !== activeSessionModel.provider || state.billingMode.model !== activeSessionModel.model)
        ? { provider: activeSessionModel.provider, model: activeSessionModel.model, mode: BILLING_PROVIDERS.indexOf(activeSessionModel.provider) >= 0 ? 'billing' : (SUBSCRIPTION_PROVIDERS.indexOf(activeSessionModel.provider) >= 0 ? 'subscription' : 'balance') }
        : (waitForSessionModel ? null : state.billingMode);
      // ---- 与原生一致格式工具 ----
      function formatTokens(n) {
        const scaled = function (v) { return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); };
        if (n < 1e3) return String(n);
        if (n < 1e6) return scaled(n / 1e3) + 'K';
        return scaled(n / 1e6) + 'M';
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
        const keys = { five_hour: 'host.hour', seven_day: 'ui.weekly', monthly: 'ui.monthly' };
        return Object.hasOwn(keys, window.key) ? t(keys[window.key]) : window.label;
      }
      function compactWindowLabel(key) {
        if (key === 'five_hour') return '5h';
        if (key === 'seven_day') return t('ui.weekly');
        if (key === 'monthly') return t('ui.monthly');
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
          if (fieldVisible('balance')) {
            groups.push(fieldSpan('balance', 'bal', React.createElement('span', { title: balTitle },
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
            const costTxt = costCNY != null ? '¥' + costCNY.toFixed(3)
              : (costUSD != null ? '$' + costUSD.toFixed(3) : symbol + (0).toFixed(3));
            const today = usg.todaySpend != null ? t('ui.today', { symbol: symbol, value: fmt(usg.todaySpend, 3) }) : '';
            const month = usg.monthSpend != null ? t('ui.lastDays', { symbol: symbol, value: fmt(usg.monthSpend, 3) }) : '';
            const total = usg.totalSpend != null ? t('ui.allTime', { symbol: symbol, value: fmt(usg.totalSpend, 3) }) : '';
            const detail = [today, month, total].filter(function (s) { return s.length > 0; }).join(' · ');
            groups.push(fieldSpan('sessionCost', 'convo', React.createElement('span', {
              title: t('ui.sessionIncludingSubagents', { costTxt: costTxt, value: detail ? '\n' + detail : '' }) },
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
          const windowPriority = { five_hour: 1, seven_day: 2, monthly: 3 };
          const byPriority = function (a, b) {
            const pa = Object.hasOwn(windowPriority, a.key) ? windowPriority[a.key] : 99;
            const pb = Object.hasOwn(windowPriority, b.key) ? windowPriority[b.key] : 99;
            return pa - pb;
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
            winNodes.push(fieldSpan(WINDOW_FIELD_IDS[w.key] || 'subWindow5h', 'w' + i,
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
        function group(parts, hidden, fieldId) {
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
          ng.push({ nodes: nodesArr, text: texts.join(''), hidden: !!hidden, fieldId: fieldId || null });
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

        const speeds = [];
        if (statsProj.ttftSteps > 0) speeds.push(metric(t('ui.avgTTFT'), formatDuration(statsProj.ttftMs / statsProj.ttftSteps)));
        if (statsProj.decodeMs > 0) speeds.push(' · ', num(formatTps(statsProj.decodeTokens / (statsProj.decodeMs / 1e3)) + ' tok/s'));
        if (speeds.length > 0) group(speeds, HIDE_SPEED_FIELDS); // 不占可见版式，title 浮窗保留（官方隐藏字段，非用户可配）

        if (usageProj && (billedInput(usageProj) > 0 || (usageProj.outputTokens || 0) > 0)) {
          const denom = billedInput(usageProj);
          const hit = denom > 0 ? Math.round(((usageProj.cacheReadTokens || 0) / denom) * 100) : null;
          if (hit != null && fieldVisible('cacheHit')) group([metric(t('ui.cacheHit'), hit + '%')], false, 'cacheHit');
          if (fieldVisible('tokensIO')) {
            group([metric(t('ui.input.BottomInfoBar'), formatTokens(billedInput(usageProj)) + ' tok'), ' · ', metric(t('ui.output'), formatTokens(usageProj.outputTokens || 0) + ' tok')], false, 'tokensIO');
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
