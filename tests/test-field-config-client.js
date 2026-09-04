const { t } = require('./locale-fixture.cjs');
// v1.9.0 PR2 → v1.9.1 客户端静态断言：字段自选/配色 + 设置页单文件化
// ① 过滤逻辑嵌在三态渲染函数内部 + 分隔符正确收合 ② 默认配置渲染与旧版一致
// ③ 颜色变量默认不注入（未自定义零回归）④ 字段注册表一致性（宿主白名单 = 客户端渲染 = 设置页）
// ⑤ 设置页（settings.section）：M1 单文件注册 / M2 屏显防护与首渲骨架 / 无障碍 / 乐观更新 / CustomEvent
// 用法：node tests/test-field-config-client.js
const fs = require('fs');

const clientSrc = fs.readFileSync(__dirname + '/../plugin/src/client-bundle.js', 'utf8');
const { FIELD_REGISTRY, PRESET_COLOR_NAMES, FIELD_GROUP_ORDER, FIELD_GROUP_LABELS } = require('../plugin/src/constants.js');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

// ---------- ① 过滤逻辑嵌在三态渲染函数内部 + 分隔符正确收合 ----------
check('余额制过滤内嵌 pushBalanceGroups（锚点组起步）', /function pushBalanceGroups\(groups, trailingErrorGroups\) \{[\s\S]*?fieldVisible\('anchorGroup'\)/.test(clientSrc), true);
check('订阅制过滤内嵌 pushSubscriptionGroups', /function pushSubscriptionGroups\(groups, trailingErrorGroups\) \{[\s\S]*?fieldVisible\('subServiceGroup'\)/.test(clientSrc), true);
check('账单制过滤内嵌 pushBillingGroups', /function pushBillingGroups\(groups, trailingErrorGroups\) \{[\s\S]*?fieldVisible\('billingServiceGroup'\)/.test(clientSrc), true);
check('锚点组仍由三态互斥分支渲染（不在互斥判定外另起渲染分支）', clientSrc.includes("} else if (isBilling) {")
  && clientSrc.includes("} else if (isSub) {"), true);
check('订阅窗口逐窗过滤（5h/周/月各自独立）', clientSrc.includes('windowFieldVisible(w.key)')
  && clientSrc.includes("five_hour: 'subWindow5h'") && clientSrc.includes("seven_day: 'subWindowWeek'") && clientSrc.includes("monthly: 'subWindowMonth'"), true);
check('订阅窗口组全隐藏时整组不推送（分隔符收合）', clientSrc.includes('if (winNodes.length > 0) {')
  && clientSrc.includes("key: 'subwin', title: titleLines.join('\\n')"), true);
check('账单组合片段全隐藏时整组不推送（分隔符收合）', clientSrc.includes('if (nodes.length > 0) {')
  && clientSrc.includes("key: 'bill', title: titleLines.join('\\n')"), true);
check('组间分隔符仍由统一组装层生成', clientSrc.includes("className: 'bi-sep' }, '|'"), true);
check('原生统计行隐藏组不占版式（visCount 门控分隔符）', clientSrc.includes('if (ng[i].hidden) continue;')
  && clientSrc.includes("key: 'nsep' + i, className: 'bi-sep'"), true);
check('本会话花费过滤在公共小部件内部（余额制/订阅制共用）', clientSrc.includes("if (fieldVisible('sessionCost')) {")
  && (clientSrc.match(/pushSessionCost\(groups/g) || []).length >= 2, true);
check('错误/提醒类字段同样可关（用户拍板：全标签可勾选）', clientSrc.includes("fieldVisible('refreshFailure')")
  && clientSrc.includes("fieldVisible('persistWarning')") && clientSrc.includes("fieldVisible('updateNotice')"), true);

// ---------- ② 默认配置渲染与旧版一致（未知/缺省一律显示） ----------
check('fieldVisible 未知/缺省 id 一律显示（!== false）', clientSrc.includes('return fieldConfig.fields[id] !== false;'), true);
check('配置快照缺 fields/colors 时回退空对象（不抛错）', clientSrc.includes("fields: next && next.fields && typeof next.fields === 'object' ? next.fields : {}"), true);
check('density 点击切换行为保留不变', clientSrc.includes('onClick: function () { props.onToggleDensity(); }')
  && clientSrc.includes('setDensity(next);'), true);
check('信息栏 load() 周期顺带校准字段配置', /const load = React\.useCallback\(function \(selection\) \{[\s\S]*?refreshFieldConfig\(\);/.test(clientSrc), true);
check('设置页变更经 CustomEvent 即时同步到信息栏', clientSrc.includes("document.addEventListener('dsh-bib-config-changed', onConfigChanged)")
  && clientSrc.includes("document.removeEventListener('dsh-bib-config-changed', onConfigChanged)"), true);
check('组件订阅字段配置变化（版本号 tick 触发重渲染）', clientSrc.includes('fieldConfigListeners.add(listener)')
  && clientSrc.includes('setFieldConfigTick(fieldConfigVersion);'), true);

// ---------- ③ 颜色变量默认不注入（零回归） ----------
check('fieldStyle 未自定义返回 undefined（变量不存在）', /function fieldStyle\(id\) \{\s*\n  const color = fieldColor\(id\);\s*\n  if \(!color\) return undefined;/.test(clientSrc), true);
check('预设色名映射到三套主题变量 var(--bi-palette-<name>)', clientSrc.includes("'var(--bi-palette-' + color + ')'"), true);
check('自定义 hex 注入深色加亮变体（--bi-field-<id>-dark）', clientSrc.includes("style['--bi-field-' + id + '-dark'] = readableDarkVariant(color);"), true);
check('字段级 CSS 由注册表生成，回退值=原语义色', clientSrc.includes('const FIELD_COLOR_CSS = buildFieldColorCss();')
  && clientSrc.includes("'var(--bi-state-alert)'") && clientSrc.includes("'var(--bi-state-price-low)'")
  && clientSrc.includes("'var(--bi-label-primary)'") && clientSrc.includes("'inherit'"), true);
check('预设色板三套成对：浅色默认', clientSrc.includes('--bi-palette-red: #d92d20') && clientSrc.includes('--bi-palette-green: #087f5b'), true);
check('预设色板三套成对：深色覆盖', clientSrc.includes('body[data-ds-dark-theme] .bi-root, body[data-ds-dark-theme] .bib-set-root { --bi-palette-red: #ff6961; --bi-palette-green: #86efac; --bi-palette-blue: #66a3ff; --bi-palette-purple: #b19cf7; --bi-palette-orange: #fdb022; }'), true);
check('预设色板三套成对：增强对比', clientSrc.includes('@media (prefers-contrast: more) { body:not([data-ds-dark-theme]) .bi-root, body:not([data-ds-dark-theme]) .bib-set-root { --bi-palette-red: #ad1717; --bi-palette-green: #05603a; --bi-palette-blue: #003399; --bi-palette-purple: #4a1fb8; --bi-palette-orange: #7a2e0e; }'), true);
check('字段着色经 data-field 属性锚定（容器注入 + CSS 生成共用同一选择器写法）', clientSrc.includes("'data-field': id")
  && clientSrc.includes("const attr = '[data-field=\"' + id + '\"]';"), true);
check('状态语义色变量保持三套成对（零回归基线不动）', clientSrc.includes('--bi-state-alert: #d92d20')
  && clientSrc.includes('--bi-state-alert: #ff6961')
  && clientSrc.includes('--bi-state-price-low: #087f5b')
  && clientSrc.includes('--bi-state-price-low: #86efac'), true);
check('文字标签保留（低/估算），颜色永不是唯一信息载体', clientSrc.includes("className: 'bi-low-status' }, t('ui.low')")
  && clientSrc.includes("t('ui.estimated')"), true);

// ---------- ④ 字段注册表一致性（宿主白名单 = 客户端渲染 = 设置页） ----------
check('注册表非空且 id 稳定唯一', Array.isArray(FIELD_REGISTRY) && FIELD_REGISTRY.length >= 25
  && new Set(FIELD_REGISTRY.map((f) => f.id)).size === FIELD_REGISTRY.length, true);
check('每个字段含 id/label/group/modes/colorKind', FIELD_REGISTRY.every((f) => typeof f.id === 'string' && f.id.length > 0
  && typeof f.label === 'string' && f.label.length > 0
  && typeof f.group === 'string' && FIELD_GROUP_ORDER.includes(f.group)
  && Array.isArray(f.modes) && f.modes.length > 0
  && ['inherit', 'alert', 'period', 'provider', 'muted'].includes(f.colorKind)), true);
check('modes 只用约定枚举', FIELD_REGISTRY.every((f) => f.modes.every((m) => ['balance', 'subscription', 'billing', 'native', 'common'].includes(m))), true);
check('锚点组恰三个且标注 anchor', FIELD_REGISTRY.filter((f) => f.anchor === true).map((f) => f.id).join(',') === 'anchorGroup,subServiceGroup,billingServiceGroup', true);
check('错误/提醒类字段标注建议保留', ['noKeyHint', 'balanceError', 'usageError', 'refreshFailure', 'persistWarning', 'updateNotice']
  .every((id) => FIELD_REGISTRY.find((f) => f.id === id).suggestKeep === true), true);
check('注册表无 defaultHidden 语义（默认值全部=显示，由宿主测试锁定）', FIELD_REGISTRY.every((f) => f.defaultHidden !== true), true);
check('每个注册字段都在信息栏渲染层被引用（id ↔ 渲染片段一一对应）', FIELD_REGISTRY.every((f) => clientSrc.includes("'" + f.id + "'")), true);
check('预设色板非空（含语义色名）', Array.isArray(PRESET_COLOR_NAMES) && PRESET_COLOR_NAMES.length >= 5
  && PRESET_COLOR_NAMES.includes('red') && PRESET_COLOR_NAMES.includes('neutral'), true);
check('D6 分组：仅「原生字段/插件字段」两类且原生在前', JSON.stringify(FIELD_GROUP_ORDER) === JSON.stringify(['native', 'plugin'])
  && t(FIELD_GROUP_LABELS.native) === '原生字段' && t(FIELD_GROUP_LABELS.plugin) === '插件字段', true);
check('D6 分组：原生组恰 5 个 DeepSeek 原生标签', FIELD_REGISTRY.filter((f) => f.group === 'native').map((f) => f.id).join(',')
  === 'turnsSteps,llmTime,toolTime,cacheHit,tokensIO', true);
check('D6 分组：其余 23 个全部归入插件组', FIELD_REGISTRY.filter((f) => f.group === 'plugin').length === 23
  && FIELD_REGISTRY.every((f) => f.group === 'native' || f.group === 'plugin'), true);
check('构建注入锚点存在于客户端源码', clientSrc.includes('const FIELD_REGISTRY = /*__FIELD_REGISTRY__*/[]')
  && clientSrc.includes('const PRESET_COLORS = /*__PRESET_COLORS__*/[]'), true);

// ---------- ⑤ 设置页（settings.section）：M1 单文件注册 / M2 屏显防护 / 无障碍 / 乐观更新 / CustomEvent ----------
check('设置页注册 DSH settings.section 插座（apply 内直接 slots.inject）', clientSrc.includes("slots.inject('settings.section'"), true);
check('注册条目含 id/order/label（侧栏导航行自动生成）', clientSrc.includes("id: 'bottom-info-bar'")
  && clientSrc.includes('order: 100')
  && clientSrc.includes("label: function () { return t('ui.infoBar'); }"), true);
check('设置页组件为普通函数组件（纯 React.createElement，无 JSX 标签）', clientSrc.includes('function InfoBarSettingsSection(')
  && !/<[A-Z][A-Za-z]*[\s/>]/.test(clientSrc), true);
check('M1 单文件化：client-settings.js 已删除，构建不再读取/拼接第二源码', (function () {
  const buildSrc = fs.readFileSync(__dirname + '/../plugin/scripts/build.mjs', 'utf8');
  return !fs.existsSync(__dirname + '/../plugin/src/client-settings.js')
    && !buildSrc.includes('client-settings.js')
    && !buildSrc.includes('baseExports')
    && !buildSrc.includes('applyInfoBarSettingsSection');
})(), true);
check('M1 拆除拼接：settings.section 与信息栏同一 apply、同一 slots.inject 路径（无 async 串接/module.exports 重写）', (function () {
  const applyStart = clientSrc.indexOf('async apply(ctx)');
  const applySlice = applyStart === -1 ? '' : clientSrc.slice(applyStart);
  const dockIdx = applySlice.indexOf("slots.inject('conversation.composer.dock'");
  const setIdx = applySlice.indexOf("slots.inject('settings.section'");
  return applyStart !== -1
    && dockIdx !== -1 && setIdx !== -1 && setIdx > dockIdx
    && !clientSrc.includes('const baseExports = module.exports;')
    && !clientSrc.includes('applyInfoBarSettingsSection')
    && !clientSrc.includes('await applyInfoBarSettingsSection');
})(), true);
check('M2 屏显防护：渲染主体包在 try/catch，任何渲染期异常 → role=alert 错误框（含错误信息）', (function () {
  const body = extractFunctionFrom(clientSrc, 'InfoBarSettingsSection');
  const tryIdx = body.indexOf('try {');
  const catchIdx = body.indexOf('} catch (err) {');
  return tryIdx !== -1 && catchIdx !== -1 && catchIdx > tryIdx
    && body.includes("role: 'alert'")
    && body.includes("t('ui.couldNotDisplayInfoBar'")
    && body.includes('bibSetOperationMessage(err)');
})(), true);
check('M2 首渲骨架：加载分支先渲染页面标题行「信息底栏设置」（bibSetPageTitle → h1）', (function () {
  const body = extractFunctionFrom(clientSrc, 'InfoBarSettingsSection');
  return clientSrc.includes('function bibSetPageTitle()')
    && clientSrc.includes("React.createElement('h1', { className: 'bib-set-page-title' }, t('ui.infoBarSettings'))")
    && body.includes("t('ui.loadingInfoBarSettings')")
    && body.includes('bibSetPageTitle()');
})(), true);
check('字段开关使用 role=switch + aria-checked（含中文可读名）', clientSrc.includes("role: 'switch'")
  && clientSrc.includes("'aria-checked': checked") && clientSrc.includes("t('ui.show', { label: t(field.label) })"), true);
check('D6 解锁：锚点开关与其他字段同等可用（无禁用态、无恒开文案）', (function () {
  const body = extractFunctionFrom(clientSrc, 'InfoBarSettingsSection');
  return !body.includes('disabled: isAnchor') && !body.includes('始终显示');
})(), true);
check('D6 解锁：「身份锚点」仅作为说明文字保留', clientSrc.includes("t('ui.identifiesTheProviderAndModel')"), true);
check('错误/提醒类字段带「建议保留」徽标', clientSrc.includes("t('ui.recommended')"), true);
check('色板为 radiogroup/radio + roving tabindex（方向键/Home/End 键盘可达）', clientSrc.includes("role: 'radiogroup'")
  && clientSrc.includes("role: 'radio'") && clientSrc.includes('ArrowRight') && clientSrc.includes("'Home'"), true);
check('原生取色器与 hex 输入各带可读名 + 非法描红（aria-invalid）', clientSrc.includes("'aria-label': t('ui.customColor', { label: t(field.label) })")
  && clientSrc.includes("'aria-label': t('ui.hexColor', { label: t(field.label) })")
  && clientSrc.includes("'aria-invalid': hexInvalid ? 'true' : 'false'"), true);
check('hex 非法拒绝回退：仅 Enter/失焦提交且非法值不入库', clientSrc.includes('if (!BIB_SET_HEX_PATTERN.test(value))')
  && clientSrc.includes("onBlur: function () { commitHex(field.id); }"), true);
check('乐观更新 + 失败回退 + 版本号守卫（参照 density toggle）', clientSrc.includes('applyOptimistic();')
  && clientSrc.includes('revertOptimistic();') && clientSrc.includes('const seq = ++opSeqRef.current;')
  && clientSrc.includes('if (seq !== opSeqRef.current)'), true);
check('保存成功后派发 CustomEvent 联动信息栏', clientSrc.includes('bibSetDispatchChanged()')
  && clientSrc.includes("document.dispatchEvent(new CustomEvent(BIB_SET_EVENT))"), true);
check('重置标签/重置颜色为两个独立按钮', clientSrc.includes("runReset('fields')") && clientSrc.includes("runReset('colors')")
  && clientSrc.includes("t('ui.resetLabels')") && clientSrc.includes("t('ui.resetColors')"), true);
check('保存失败有 role=alert 文案；状态通知 aria-live=polite', clientSrc.includes("role: 'alert'")
  && clientSrc.includes("'aria-live': 'polite'"), true);
check('焦点可见 + 减少动效降级', clientSrc.includes(':focus-visible')
  && clientSrc.includes('@media (prefers-reduced-motion: reduce)'), true);
check('设置页样式复用 DSH 设计令牌（--dsw-alias-*）融入既有面板风格', clientSrc.includes('--dsw-alias-border-l2')
  && clientSrc.includes('--dsw-alias-bg-layer-3') && clientSrc.includes('--dsw-alias-label-tertiary'), true);
check('设置页复用信息栏预设定色板变量（同一三套主题）', clientSrc.includes("'var(--bi-palette-' + option + ')'"), true);
check('构建产物含被注入的字段注册表与设置页注册（非空锚点占位）', (function () {
  const lib = fs.readFileSync(__dirname + '/../plugin/lib/client.js', 'utf8');
  return lib.includes("id: 'anchorGroup'")
    && lib.includes("name: 'settings.section'")
    && lib.includes('function InfoBarSettingsSection');
})(), true);

// ---------- ⑥ 组装 bundle 可执行性（ModuleLoader 工厂真实加载一次） ----------
{
  const code = fs.readFileSync(__dirname + '/../plugin/lib/client.js', 'utf8');
  let captured = null;
  const fakeWindow = { __ModuleLoader__: { load(o) { captured = o; } } };
  const fakeRequire = function (name) {
    if (name === 'react') return { createElement: function () { return null; }, useState: function () {}, useRef: function () {}, useEffect: function () {}, useCallback: function () {} };
    throw new Error('unexpected require: ' + name);
  };
  try {
    new Function('window', 'require', code)(fakeWindow, fakeRequire);
    const exported = captured && captured.factory(fakeRequire);
    check('lib/client.js 工厂可加载且导出 inject/apply', !!captured && captured.id === 'dsh-bottom-info-bar'
      && Array.isArray(exported.inject) && typeof exported.apply === 'function', true);
  } catch (err) {
    check('lib/client.js 工厂可加载且导出 inject/apply（' + err.message + '）', false, true);
  }
}

// ---------- ⑦ 最终 CSS 结构校验（D1 回归锁，堵住「纯字符串断言测 CSS」的盲区） ----------
// 用真实注册表还原 installStyles 注入的最终 CSS（与浏览器收到的文本一致），做括号深度分析：
// 全程不为负、结尾配平、增强对比 @media 块在字段色规则之前闭合、每条字段色规则位于样式表顶层。
function extractFunctionFrom(source, name) {
  const start = source.indexOf('function ' + name);
  if (start < 0) throw new Error('未找到 function ' + name);
  let depth = 0, i = start, inStr = null;
  while (i < source.length) {
    const c = source[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c;
    } else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return source.slice(start, i + 1);
}
function withFakeDocument(run) {
  const fakeStyle = { dataset: {}, textContent: '' };
  const originalDocument = global.document;
  global.document = {
    querySelector: function () { return null; },
    createElement: function () { return fakeStyle; },
    head: { appendChild: function () {} },
  };
  try { run(); } finally {
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
  }
  return fakeStyle.textContent;
}
{
  const startMarker = 'const FIELD_REGISTRY = /*__FIELD_REGISTRY__*/[];';
  const endMarker = 'module.exports = {';
  const start = clientSrc.indexOf(startMarker);
  const end = clientSrc.indexOf(endMarker);
  try {
    if (start === -1 || end === -1 || end <= start) throw new Error('未能定位客户端 CSS 模块切片');
    let slice = clientSrc.slice(start, end);
    slice = slice.replace('/*__FIELD_REGISTRY__*/[]', JSON.stringify(FIELD_REGISTRY))
      .replace('/*__PRESET_COLORS__*/[]', JSON.stringify(PRESET_COLOR_NAMES));
    const installStyles = new Function(slice + '\nreturn installStyles;')();
    const finalCss = withFakeDocument(function () { installStyles(); });
    const depths = new Array(finalCss.length);
    let d = 0;
    for (let i = 0; i < finalCss.length; i++) {
      if (finalCss[i] === '{') d += 1;
      else if (finalCss[i] === '}') d -= 1;
      depths[i] = d;
    }
    const depthBefore = function (idx) { return idx <= 0 ? 0 : depths[idx - 1]; };
    check('D1：最终 CSS 括号全程不为负', depths.every(function (x) { return x >= 0; }), true);
    check('D1：最终 CSS 括号配平（结尾深度为 0）', depths[depths.length - 1] === 0, true);
    check('D1：增强对比 @media 块在字段色规则之前闭合', (function () {
      const mediaStart = finalCss.indexOf('@media (prefers-contrast: more)');
      if (mediaStart === -1) return false;
      for (let i = mediaStart + 1; i < finalCss.length; i++) {
        if (depths[i] === 0) return true; // media 块的闭合点
      }
      return false;
    })(), true);
    check('D1：全部字段色规则位于样式表顶层（不在任何 @media 内）', FIELD_REGISTRY.every(function (f) {
      const idx = finalCss.indexOf('.bi-root [data-field="' + f.id + '"]');
      return idx !== -1 && depthBefore(idx) === 0;
    }), true);
    check('D1：字段色规则浅色/深色两层成对生成', FIELD_REGISTRY.every(function (f) {
      return finalCss.indexOf('var(--bi-field-' + f.id + ',') !== -1
        && finalCss.indexOf('var(--bi-field-' + f.id + '-dark,') !== -1;
    }), true);
  } catch (err) {
    check('D1：最终 CSS 结构校验（' + err.message + '）', false, true);
  }
  try {
    const bibSetInstallStyles = eval('(' + extractFunctionFrom(clientSrc, 'bibSetInstallStyles') + ')');
    const settingsCss = withFakeDocument(function () { bibSetInstallStyles(); });
    let d = 0, negative = false;
    for (let i = 0; i < settingsCss.length; i++) {
      if (settingsCss[i] === '{') d += 1;
      else if (settingsCss[i] === '}') d -= 1;
      if (d < 0) negative = true;
    }
    check('设置页样式表括号配平（不为负且结尾为 0）', !negative && d === 0, true);
    check('M2：设置页样式含页面标题行规则（.bib-set-page-title）', settingsCss.includes('.bib-set-page-title'), true);
  } catch (err) {
    check('设置页样式表括号配平（' + err.message + '）', false, true);
  }
}

// ---------- ⑧ D2：自定义 hex 浅色钳制（对比度驱动，向黑混合至 ≥4.5:1） ----------
{
  // readableLightVariant 依赖模块级 hexLuminance：先提取依赖再提取本体，保持在同一作用域
  const hexLuminance = eval('(' + extractFunctionFrom(clientSrc, 'hexLuminance') + ')');
  const readableLightVariant = eval('(' + extractFunctionFrom(clientSrc, 'readableLightVariant') + ')');
  function luminance(value) {
    function linear(channel) {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * linear((value >> 16) & 255) + 0.7152 * linear((value >> 8) & 255) + 0.0722 * linear(value & 255);
  }
  function contrastVsWhite(hex) {
    return 1.05 / (luminance(parseInt(hex.slice(1), 16)) + 0.05);
  }
  check('D2：已可读的自定义颜色原样保留（#333333 不被改动）', readableLightVariant('#333333') === '#333333', true);
  check('D2：过浅颜色钳制后对白对比度 ≥4.5:1', ['#FFFF00', '#FFFFFF', '#00FFFF', '#F8F8F8', '#C0C0C0', '#FFFFCC'].every(function (hex) {
    const out = readableLightVariant(hex);
    return contrastVsWhite(out) >= 4.5;
  }), true);
  check('D2：输出为严格 #RRGGBB 大写', /^#[0-9A-F]{6}$/.test(readableLightVariant('#ab12cd')), true);
  check('D2：fieldStyle 浅色默认层使用钳制变体（源码断言）', clientSrc.includes("style['--bi-field-' + id] = readableLightVariant(color);")
    && clientSrc.includes("style['--bi-field-' + id + '-dark'] = readableDarkVariant(color);"), true);
}

// ---------- ⑨ D3：字段配置刷新的版本守卫 + 在途补拉 ----------
{
  const fieldConfigSnapshotIsNewer = eval('(' + extractFunctionFrom(clientSrc, 'fieldConfigSnapshotIsNewer') + ')');
  check('D3：无版本号（旧宿主）一律接受', fieldConfigSnapshotIsNewer(null, 5) === true && fieldConfigSnapshotIsNewer(undefined, 5) === true, true);
  check('D3：尚未应用过快照（applied=-1）接受', fieldConfigSnapshotIsNewer(3, -1) === true, true);
  check('D3：更新版本接受', fieldConfigSnapshotIsNewer(4, 3) === true, true);
  check('D3：过期响应拒绝（不回退刚保存的配置）', fieldConfigSnapshotIsNewer(2, 3) === false, true);
  check('D3：相同版本不重复应用（省去 30s 轮询无谓重渲染）', fieldConfigSnapshotIsNewer(3, 3) === false, true);
  check('D3：refreshFieldConfig 使用版本守卫 + 在途补拉（源码断言）', clientSrc.includes('fieldConfigSnapshotIsNewer(incoming, fieldConfigServerVersion)')
    && clientSrc.includes('fieldConfigRefetchPending = true; return;')
    && clientSrc.includes('fieldConfigRefetchPending = false; refreshFieldConfig();'), true);
}

// ---------- ⑩ D6：全部字段隐藏 = 底栏彻底移除（零节点/零分隔符/无占位） ----------
{
  // assembleInfoBarRow 依赖模块级 trailingErrorText：先提取依赖再提取本体，保持在同一作用域
  const trailingErrorText = eval('(' + extractFunctionFrom(clientSrc, 'trailingErrorText') + ')');
  const assembleInfoBarRow = eval('(' + extractFunctionFrom(clientSrc, 'assembleInfoBarRow') + ')');
  const infoBarShouldRemoveAll = eval('(' + extractFunctionFrom(clientSrc, 'infoBarShouldRemoveAll') + ')');
  const stubCreate = function (type, props) {
    return { type: type, props: props, children: Array.prototype.slice.call(arguments, 2) };
  };
  const errNode = function (text) {
    return { props: { 'data-field': 'refreshFailure', children: { props: { className: 'bi-stale', children: text } } } };
  };
  check('D6：全部字段隐藏 → 组装输出为空（零节点/零分隔符）', assembleInfoBarRow([], [], stubCreate).length === 0, true);
  check('D6：分隔符只在相邻可见组之间（3 组恰好 2 个）', (function () {
    const nodes = assembleInfoBarRow([{}, {}, {}], [], stubCreate);
    return nodes.length === 5 && nodes.filter(function (n) { return n.props.className === 'bi-sep'; }).length === 2;
  })(), true);
  check('D6：组与错误组之间的分隔符正确收合（1 组 + 2 错误 → 2 个分隔符）', (function () {
    const nodes = assembleInfoBarRow([{}], [errNode('刷新失败'), errNode('账单未保存')], stubCreate);
    return nodes.length === 5 && nodes.filter(function (n) { return n.props.className === 'bi-sep'; }).length === 2;
  })(), true);
  check('D6：多个「刷新失败」去重仍生效（组装函数内）', (function () {
    const nodes = assembleInfoBarRow([], [errNode('刷新失败'), errNode('账单未保存'), errNode('刷新失败')], stubCreate);
    return nodes.length === 3 && nodes.filter(function (n) { return n.props.className === 'bi-sep'; }).length === 1;
  })(), true);
  check('D6：配置层面全隐藏判定（注册表全关 → true；任一可见 → false）', infoBarShouldRemoveAll(FIELD_REGISTRY, function () { return false; }) === true
    && infoBarShouldRemoveAll(FIELD_REGISTRY, function (id) { return id === 'anchorGroup'; }) === false
    && infoBarShouldRemoveAll([], function () { return false; }) === false, true);
  check('D6：全隐藏整体移除判定已接入渲染（源码断言：return null 优先于 root 组装）',
    clientSrc.indexOf('infoBarShouldRemoveAll(FIELD_REGISTRY, fieldVisible)') !== -1
    && clientSrc.indexOf('return null;') < clientSrc.indexOf('const animatedRow1')
    && clientSrc.includes('if (ngNodes.length === 0) row1 = null;'), true);
  check('D6：构建产物含注入的两级分组常量（设置页渲染不落空）', (function () {
    const lib = fs.readFileSync(__dirname + '/../plugin/lib/client.js', 'utf8');
    return lib.indexOf("['native', 'plugin']") !== -1 && lib.includes('native: "group.native"') && lib.includes('plugin: "group.plugin"');
  })(), true);
  check('310防复发：含 React hooks 的组件 bibSetPalette 必须以 createElement 创建（禁止裸函数调用，防 hook 记账错乱→React #310）',
    clientSrc.indexOf('React.createElement(bibSetPalette, {') !== -1 && clientSrc.indexOf('bibSetPalette({') === -1, true);
  check('310防复发：构建产物同样不含裸调用', (function () {
    const lib = fs.readFileSync(__dirname + '/../plugin/lib/client.js', 'utf8');
    return lib.indexOf('React.createElement(bibSetPalette, {') !== -1 && lib.indexOf('bibSetPalette({') === -1;
  })(), true);
}

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
