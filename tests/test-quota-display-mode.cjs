const fixture = require('./locale-fixture.cjs');
const { t } = fixture;
// v1.16 客户端回归：订阅窗口百分比方向（quotaDisplayMode）+ 设置页分段控件 + MiniMax 展示名
// 背景：外部贡献者 PR #115 的 MiniMax Token Plan 适配，按当前架构重新落地（Lead 定稿契约）。
// 覆盖：
//   ① normalizeQuotaDisplayMode / QUOTA_DISPLAY_MODES：缺字段与非法值一律回退 'remaining'，绝不抛错
//   ② 配置快照管道：初始值 / applyFieldConfigSnapshot / activeQuotaDisplayMode 的归一
//   ③ 窗口渲染：两个方向的文案键与百分比方向；告警语义（剩余 ≤ 20%）两向严格等价
//   ④ 设置页：分段控件的显隐规则、radiogroup/radio/aria-checked/roving tabindex、方向键与 Home/End
//   ⑤ 对比度铁律：真实 sRGB 相对亮度计算（选中态 #4a63e8 × #fff ≥ 4.5:1、hover 不变浅、不跟随主题）
//   ⑥ 提交路径：setFieldConfig patch 携带 quotaDisplayMode、乐观更新、失败回滚（真实 RPC 替身渲染级）
//   ⑦ MiniMax 服务商展示名 + 构建产物接线
// 用法：node tests/test-quota-display-mode.cjs（需先 node scripts/build.mjs，run-all 会自己 build）
const fs = require('fs');
const vm = require('node:vm');

const clientSrc = fs.readFileSync(__dirname + '/../src/client-bundle.js', 'utf8');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

// 与 test-field-config-client.js 同法：按括号计数提取函数体，保持测试对真实源码求值。
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

// WCAG 2.x 相对亮度 / 对比度（真实计算，不用字符串断言代替）
function srgbLinear(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relativeLuminance(hex) {
  const v = parseInt(String(hex).slice(1), 16);
  return 0.2126 * srgbLinear((v >> 16) & 255) + 0.7152 * srgbLinear((v >> 8) & 255) + 0.0722 * srgbLinear(v & 255);
}
function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const flush = function () { return new Promise(function (resolve) { setImmediate(resolve); }); };

// ---------- ① + ② 模块级 quotaDisplayMode 状态与归一（对真实源码求值） ----------
const quotaState = (function () {
  const start = clientSrc.indexOf('// v1.16：订阅窗口百分比方向');
  const end = clientSrc.indexOf('function refreshFieldConfig');
  if (start < 0 || end <= start) throw new Error('未能定位 quotaDisplayMode 模块切片');
  const slice = clientSrc.slice(start, end);
  return new Function(slice + '\nreturn { normalize: normalizeQuotaDisplayMode, active: activeQuotaDisplayMode, apply: applyFieldConfigSnapshot, modes: QUOTA_DISPLAY_MODES, fallback: DEFAULT_QUOTA_DISPLAY_MODE, read: function () { return fieldConfig; } };')();
})();

check('① QUOTA_DISPLAY_MODES 恰为 used/remaining（与宿主契约同一枚举）', JSON.stringify(quotaState.modes), '["used","remaining"]');
check('① 默认值常量 = remaining（= 今天的行为，绝不改变老用户显示语义）', quotaState.fallback, 'remaining');
check('① normalize: 合法值 used 原样保留', quotaState.normalize('used'), 'used');
check('① normalize: 合法值 remaining 原样保留', quotaState.normalize('remaining'), 'remaining');
check('① normalize: undefined → remaining', quotaState.normalize(undefined), 'remaining');
check('① normalize: null → remaining', quotaState.normalize(null), 'remaining');
check('① normalize: 空串 → remaining', quotaState.normalize(''), 'remaining');
check('① normalize: 大小写与空白都不算合法（\'USED\' / \' used \' → remaining）',
  quotaState.normalize('USED') === 'remaining' && quotaState.normalize(' used ') === 'remaining', true);
check('① normalize: 0 / false / NaN → remaining', quotaState.normalize(0) === 'remaining' && quotaState.normalize(false) === 'remaining' && quotaState.normalize(Number.NaN) === 'remaining', true);
check('① normalize: 对象 / 数组 / 函数 → remaining', quotaState.normalize({}) === 'remaining' && quotaState.normalize(['used']) === 'remaining' && quotaState.normalize(function () {}) === 'remaining', true);
check('① normalize: 恶意对象（toString/valueOf 抛错）不崩且回退 remaining', (function () {
  const hostile = { toString: function () { throw new Error('boom'); }, valueOf: function () { throw new Error('boom'); } };
  try { return quotaState.normalize(hostile); } catch (err) { return 'threw: ' + err.message; }
})(), 'remaining');
check('① normalize: 遍历全部垃圾输入都不抛错', (function () {
  const junk = [undefined, null, '', 'used ', 'USED', 'remaining\n', 0, 1, -1, true, false, Number.NaN, Infinity, {}, [], [1, 2], function () {}, Symbol('x'), new Date()];
  try { for (const value of junk) quotaState.normalize(value); return 'ok'; } catch (err) { return 'threw: ' + err.message; }
})(), 'ok');
check('② 初始 fieldConfig.quotaDisplayMode = remaining', quotaState.read().quotaDisplayMode, 'remaining');
check('② 快照带 quotaDisplayMode=used → 应用后为 used', (function () {
  quotaState.apply({ fields: {}, quotaDisplayMode: 'used' });
  return quotaState.read().quotaDisplayMode;
})(), 'used');
check('② 快照缺 quotaDisplayMode（老宿主）→ 回退 remaining', (function () {
  quotaState.apply({ fields: {} });
  return quotaState.read().quotaDisplayMode;
})(), 'remaining');
check('② 快照为 null → 不抛错且回退 remaining', (function () {
  try { quotaState.apply(null); } catch (err) { return 'threw: ' + err.message; }
  return quotaState.read().quotaDisplayMode;
})(), 'remaining');
check('② 快照给垃圾值（42 / {} / []）→ 一律回退 remaining', (function () {
  quotaState.apply({ fields: {}, quotaDisplayMode: 42 });
  const a = quotaState.read().quotaDisplayMode;
  quotaState.apply({ fields: {}, quotaDisplayMode: {} });
  const b = quotaState.read().quotaDisplayMode;
  quotaState.apply({ fields: {}, quotaDisplayMode: [] });
  const c = quotaState.read().quotaDisplayMode;
  return a === 'remaining' && b === 'remaining' && c === 'remaining';
})(), true);
check('② activeQuotaDisplayMode() 读取时归一（脏值不会漏到渲染层）', (function () {
  quotaState.read().quotaDisplayMode = 'garbage';
  const normalized = quotaState.active();
  quotaState.read().quotaDisplayMode = 'used';
  const used = quotaState.active();
  quotaState.read().quotaDisplayMode = 'remaining';
  return normalized === 'remaining' && used === 'used';
})(), true);

// ---------- ③ 窗口百分比方向与告警等价 ----------
const remainingPercent = eval('(' + extractFunctionFrom(clientSrc, 'remainingPercent') + ')');
const quotaWindowPercent = eval('(function () {\n  const remainingPercent = ' + extractFunctionFrom(clientSrc, 'remainingPercent') + ';\n  return ' + extractFunctionFrom(clientSrc, 'quotaWindowPercent') + ';\n})()');

check('③ remaining 模式显示剩余（used 30 → 70）', quotaWindowPercent({ usedPercent: 30 }, 'remaining'), 70);
check('③ used 模式显示已用（used 30 → 30）', quotaWindowPercent({ usedPercent: 30 }, 'used'), 30);
check('③ used 模式端点：0 → 0、100 → 100', quotaWindowPercent({ usedPercent: 0 }, 'used') === 0 && quotaWindowPercent({ usedPercent: 100 }, 'used') === 100, true);
check('③ used 模式钳制上界（used 120 → 100，不出现 >100%）', quotaWindowPercent({ usedPercent: 120 }, 'used'), 100);
check('③ used 模式钳制下界（used -20 → 0，不出现负数）', quotaWindowPercent({ usedPercent: -20 }, 'used'), 0);
check('③ used 模式缺值 / NaN → 0（绝不渲染 NaN%）', (function () {
  const missing = quotaWindowPercent({}, 'used');
  const nan = quotaWindowPercent({ usedPercent: Number.NaN }, 'used');
  const text = String(missing) + '%' + String(nan) + '%';
  return missing === 0 && nan === 0 && text.indexOf('NaN') === -1;
})(), true);
check('③ remaining 模式保持历史行为（不四舍五入：used 12.5 → 87.5）', quotaWindowPercent({ usedPercent: 12.5 }, 'remaining'), 87.5);
check('③ 告警语义两向严格等价（剩余 ≤ 20% ⟺ 已用 ≥ 80%）', (function () {
  const samples = [0, 10, 19.9, 20, 20.1, 50, 79.9, 80, 80.1, 90, 100];
  return samples.every(function (usedPercent) {
    const w = { usedPercent: usedPercent };
    return (remainingPercent(w) <= 20) === (quotaWindowPercent(w, 'used') >= 80);
  });
})(), true);
check('③ 告警阈值常量仍是 20（与 host ALERT_THRESHOLD 一致，未随方向改动）', clientSrc.includes('const LOW_QUOTA_PERCENT = 20'), true);
check('③ bi-quota-low 仍由「剩余」判定（不改成按已用判定）', clientSrc.includes("const numberClass = remaining <= LOW_QUOTA_PERCENT ? 'bi-quota-low' : '';"), true);
check('③ 窗口内联百分比按方向取数（quotaWindowPercent + 同一告警类）', clientSrc.includes("metric(compactWindowLabel(w.key), quotaWindowPercent(w, windowMode) + '%', numberClass)"), true);
check('③ 渲染期方向来自 activeQuotaDisplayMode()（模块级配置，随 tick 重渲染）', clientSrc.includes('const windowMode = activeQuotaDisplayMode();'), true);
check('③ remaining 模式沿用 ui.windowRemainingUsed（参数 label/value/usedPercent 不变）', clientSrc.includes("t('ui.windowRemainingUsed', { label: quotaWindowLabel(w), value: remainingPercent(w), usedPercent: w.usedPercent })"), true);
check('③ used 模式改用 ui.windowUsedRemaining（同一组参数名）', clientSrc.includes("t('ui.windowUsedRemaining', { label: quotaWindowLabel(w), value: remainingPercent(w), usedPercent: w.usedPercent })"), true);
check('③ 倒计时明细两向都有：RemainingUsedResets / UsedRemainingResets 且都带 value4',
  clientSrc.includes("t('ui.windowUsedRemainingResets', { label: quotaWindowLabel(displayWindow), value: remainingPercent(displayWindow), usedPercent: displayWindow.usedPercent, value4: formatDateTime(displayWindow.resetsAt) })")
  && clientSrc.includes("t('ui.windowRemainingUsedResets', { label: quotaWindowLabel(displayWindow), value: remainingPercent(displayWindow), usedPercent: displayWindow.usedPercent, value4: formatDateTime(displayWindow.resetsAt) })"), true);

const quotaWindowDetail = eval('(function (t, quotaWindowLabel, remainingPercent) {\n  return ' + extractFunctionFrom(clientSrc, 'quotaWindowDetail') + ';\n})')(t, function (w) { return w.label; }, remainingPercent);
const weekWindow = { key: 'seven_day', label: '7 天', usedPercent: 30, resetsAt: 1700000000000 };
check('③ 运行时文案（remaining）：7 天窗口：剩余 70%（已用 30%）', quotaWindowDetail(weekWindow, 'remaining'), t('ui.windowRemainingUsed', { label: '7 天', value: 70, usedPercent: 30 }));
check('③ 运行时文案（used）：7 天窗口：已用 30%（剩余 70%）', quotaWindowDetail(weekWindow, 'used'), t('ui.windowUsedRemaining', { label: '7 天', value: 70, usedPercent: 30 }));
check('③ 两向文案都不得出现 undefined / NaN', (function () {
  const a = quotaWindowDetail(weekWindow, 'remaining');
  const b = quotaWindowDetail(weekWindow, 'used');
  return a.indexOf('undefined') === -1 && b.indexOf('undefined') === -1 && a.indexOf('NaN') === -1 && b.indexOf('NaN') === -1;
})(), true);
check('③ 两个文案键的占位符集合完全一致（{label}/{value}/{usedPercent}，含义不漂移）', (function () {
  const placeholders = function (key) { return (fixture.dictionaries.zh[key].match(/\{\w+\}/g) || []).sort().join(','); };
  return placeholders('ui.windowUsedRemaining') === placeholders('ui.windowRemainingUsed')
    && placeholders('ui.windowUsedRemaining') === '{label},{usedPercent},{value}';
})(), true);
check('③ 两个倒计时键的占位符集合一致（含 {value4}）', (function () {
  const placeholders = function (key) { return (fixture.dictionaries.zh[key].match(/\{\w+\}/g) || []).sort().join(','); };
  return placeholders('ui.windowUsedRemainingResets') === placeholders('ui.windowRemainingUsedResets')
    && placeholders('ui.windowUsedRemainingResets') === '{label},{usedPercent},{value4},{value}';
})(), true);

// ---------- ④ 设置页分段控件：显隐 / 语义 / 键盘 ----------
function buildQuotaUi() {
  const createElement = function (type, props) {
    return { type: typeof type === 'function' ? type.name : type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) };
  };
  const React = { createElement: createElement, useRef: function (initial) { return { current: initial }; } };
  const body = 'const t = arguments[0]; const React = arguments[1];\n'
    + 'const headerCalls = [];\n'
    + 'const bibSetCardHeader = function (props) { headerCalls.push(props); return { type: "bibSetCardHeader", props: props }; };\n'
    + 'const DEFAULT_QUOTA_DISPLAY_MODE = ' + JSON.stringify(quotaState.fallback) + ';\n'
    + extractFunctionFrom(clientSrc, 'normalizeQuotaDisplayMode') + '\n'
    + extractFunctionFrom(clientSrc, 'bibSetQuotaMode') + '\n'
    + extractFunctionFrom(clientSrc, 'bibSetQuotaDisplaySection') + '\n'
    + 'return { section: bibSetQuotaDisplaySection, mode: bibSetQuotaMode, headerCalls: headerCalls };';
  return new Function(body)(t, React);
}

const quotaUi = buildQuotaUi();
const flat = function (children) { return [].concat.apply([], children); };
const sectionOn = function (fields) {
  return quotaUi.section({
    fieldOn: function (id) { return fields.indexOf(id) !== -1; },
    modeOf: function () { return 'remaining'; },
    onModeChange: function () {},
  });
};
check('④ 三个窗口字段全开 → 整区渲染', (function () {
  const section = sectionOn(['subWindow5h', 'subWindowWeek', 'subWindowMonth']);
  return !!section && section.type === 'section';
})(), true);
check('④ 仅周窗口开启 → 整区仍渲染', (function () {
  const section = sectionOn(['subWindowWeek']);
  return !!section && section.type === 'section';
})(), true);
check('④ 三个窗口字段全关 → 整区隐藏（与其它设置区显隐规则一致）', sectionOn([]), null);
check('④ 显隐判定只认这三个窗口字段（subWindow5h / subWindowWeek / subWindowMonth）', (function () {
  const body = extractFunctionFrom(clientSrc, 'bibSetQuotaDisplaySection');
  return body.indexOf("['subWindow5h', 'subWindowWeek', 'subWindowMonth']") !== -1;
})(), true);
check('④ 区块标题 / 描述走已种下的文案键', (function () {
  const headers = quotaUi.headerCalls[0];
  return headers.title === t('ui.quotaDisplayModeTitle') && headers.description === t('ui.quotaDisplayModeDesc');
})(), true);
check('④ 区块头为静态卡片头并绑定 aria-labelledby（与时间与日期 / 自定义文字同构）', (function () {
  const section = sectionOn(['subWindow5h']);
  return section.props['aria-labelledby'] === 'bib-set-quota-mode-title' && quotaUi.headerCalls[0].static === true && quotaUi.headerCalls[0].titleId === 'bib-set-quota-mode-title';
})(), true);

const renderMode = function (value, onSelect) {
  const control = quotaUi.mode({ label: t('ui.quotaDisplayModeTitle'), value: value, onSelect: onSelect || function () {} });
  const radios = flat(control.children);
  return { control: control, radios: radios };
};
check('④ 控件语义：role=radiogroup + 可读名称（标题）', (function () {
  const r = renderMode('remaining');
  return r.control.props.role === 'radiogroup' && r.control.props['aria-label'] === t('ui.quotaDisplayModeTitle') && r.control.props.className === 'bib-set-quota-mode';
})(), true);
check('④ 两个子项 role=radio、type=button、标签为「剩余 / 已用」', (function () {
  const r = renderMode('remaining');
  return r.radios.length === 2
    && r.radios.every(function (radio) { return radio.props.role === 'radio' && radio.type === 'button'; })
    && r.radios[0].children[0] === t('ui.quotaDisplayRemaining')
    && r.radios[1].children[0] === t('ui.quotaDisplayUsed');
})(), true);
check('④ aria-checked 反映当前方向（remaining 选中）', (function () {
  const r = renderMode('remaining');
  return r.radios[0].props['aria-checked'] === true && r.radios[1].props['aria-checked'] === false;
})(), true);
check('④ aria-checked 反映当前方向（used 选中）', (function () {
  const r = renderMode('used');
  return r.radios[0].props['aria-checked'] === false && r.radios[1].props['aria-checked'] === true;
})(), true);
check('④ roving tabindex：恰一个可 Tab 进入（选中项 0，另一项 -1）', (function () {
  const remaining = renderMode('remaining');
  const used = renderMode('used');
  return remaining.radios.filter(function (r) { return r.props.tabIndex === 0; }).length === 1
    && remaining.radios[0].props.tabIndex === 0 && remaining.radios[1].props.tabIndex === -1
    && used.radios.filter(function (r) { return r.props.tabIndex === 0; }).length === 1
    && used.radios[1].props.tabIndex === 0 && used.radios[0].props.tabIndex === -1;
})(), true);
check('④ 非法 / 缺失方向 → 回退 remaining 选中且不崩', (function () {
  const junk = renderMode(undefined);
  const hostile = renderMode({ toString: function () { throw new Error('boom'); } });
  return junk.radios[0].props['aria-checked'] === true && junk.radios[1].props['aria-checked'] === false
    && hostile.radios[0].props['aria-checked'] === true;
})(), true);
check('④ 点击未选中项 → onSelect 收到该值（used）', (function () {
  let picked = null;
  const r = renderMode('remaining', function (value) { picked = value; });
  r.radios[1].props.onClick();
  return picked;
})(), 'used');
check('④ 点击已选中项 → 仍以该值回调（幂等由 setQuotaDisplayMode 兜底，不发请求）', (function () {
  let calls = 0, last = null;
  const r = renderMode('remaining', function (value) { calls++; last = value; });
  r.radios[0].props.onClick();
  return calls === 1 && last === 'remaining';
})(), true);
const keyEvent = function (key) {
  return { key: key, prevented: 0, preventDefault: function () { this.prevented++; } };
};
check('④ 键盘：ArrowRight 从 remaining → used 且 preventDefault', (function () {
  let picked = null;
  const r = renderMode('remaining', function (value) { picked = value; });
  const event = keyEvent('ArrowRight');
  r.radios[0].props.onKeyDown(event);
  return picked === 'used' && event.prevented === 1;
})(), true);
check('④ 键盘：ArrowLeft 从 remaining 环绕到 used（两段循环）', (function () {
  let picked = null;
  const r = renderMode('remaining', function (value) { picked = value; });
  const event = keyEvent('ArrowLeft');
  r.radios[0].props.onKeyDown(event);
  return picked === 'used' && event.prevented === 1;
})(), true);
check('④ 键盘：ArrowDown / ArrowUp 与左右方向键等价', (function () {
  let down = null, up = null;
  const a = renderMode('remaining', function (value) { down = value; });
  a.radios[0].props.onKeyDown(keyEvent('ArrowDown'));
  const b = renderMode('remaining', function (value) { up = value; });
  b.radios[0].props.onKeyDown(keyEvent('ArrowUp'));
  return down === 'used' && up === 'used';
})(), true);
check('④ 键盘：Home → 第一项（remaining）、End → 最后一项（used）', (function () {
  let home = null, end = null;
  const a = renderMode('used', function (value) { home = value; });
  a.radios[1].props.onKeyDown(keyEvent('Home'));
  const b = renderMode('remaining', function (value) { end = value; });
  b.radios[0].props.onKeyDown(keyEvent('End'));
  return home === 'remaining' && end === 'used';
})(), true);
check('④ 键盘：方向键把焦点移到新选中项（roving tabindex 的焦点跟随）', (function () {
  const focused = [];
  const r = renderMode('remaining', function () {});
  r.radios[0].props.ref({ focus: function () { focused.push('remaining'); } });
  r.radios[1].props.ref({ focus: function () { focused.push('used'); } });
  r.radios[0].props.onKeyDown(keyEvent('ArrowRight'));
  return focused.join(',');
})(), 'used');
check('④ 键盘：未处理的键不拦截、不回调（Tab / 字母键）', (function () {
  let calls = 0;
  const r = renderMode('remaining', function () { calls++; });
  const tab = keyEvent('Tab');
  const letter = keyEvent('a');
  r.radios[0].props.onKeyDown(tab);
  r.radios[0].props.onKeyDown(letter);
  return calls === 0 && tab.prevented === 0 && letter.prevented === 0;
})(), true);
check('④ 控件不含裸 div role=button 之类的伪语义（子项用原生 button）', (function () {
  const body = extractFunctionFrom(clientSrc, 'bibSetQuotaMode');
  return body.indexOf("React.createElement('button'") !== -1 && body.indexOf("role: 'radio'") !== -1 && body.indexOf("role: 'radiogroup'") !== -1;
})(), true);

// ---------- ⑤ 对比度铁律：真实颜色计算 ----------
{
  const bibSetInstallStyles = eval('(' + extractFunctionFrom(clientSrc, 'bibSetInstallStyles') + ')');
  const settingsCss = withFakeDocument(function () { bibSetInstallStyles(); });
  const cssOnly = settingsCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let rm;
  while ((rm = ruleRe.exec(cssOnly)) !== null) {
    rules.push({
      selectors: rm[1].split(',').map(function (s) { return s.trim(); }),
      decls: rm[2].split(';').map(function (d) { return d.trim(); }).filter(Boolean),
    });
  }
  const declsOf = function (selector) {
    return rules
      .filter(function (r) { return r.selectors.indexOf(selector) !== -1; })
      .reduce(function (acc, r) { return acc.concat(r.decls); }, []);
  };
  const valueOf = function (decls, property) {
    const hit = decls.filter(function (d) { return d.split(':')[0].trim() === property; })[0];
    return hit ? hit.slice(hit.indexOf(':') + 1).trim() : null;
  };
  const base = declsOf('.bib-set-quota-mode-opt');
  const selected = declsOf('.bib-set-quota-mode-opt[aria-checked="true"]');
  const selectedHover = declsOf('.bib-set-quota-mode-opt[aria-checked="true"]:hover');
  const rootDecls = declsOf('.bib-set-root');

  check('⑤ 全局 --bib-set-brand 保持 #4d6bfe 不变（focus 轮廓等仍在用）', valueOf(rootDecls, '--bib-set-brand'), '#4d6bfe');
  check('⑤ 新增填充态专用深档 --bib-set-brand-strong = #4a63e8', valueOf(rootDecls, '--bib-set-brand-strong'), '#4a63e8');
  check('⑤ 深档是固定 hex（不含 var()，不跟随主题 / 宿主令牌变浅）', /^#[0-9a-fA-F]{6}$/.test(valueOf(rootDecls, '--bib-set-brand-strong') || ''), true);
  check('⑤ 选中态背景 = var(--bib-set-brand-strong)', valueOf(selected, 'background'), 'var(--bib-set-brand-strong)');
  check('⑤ 选中态文字 = #fff（纯白，非透明 / 非继承）', valueOf(selected, 'color'), '#fff');
  check('⑤ 选中态字重 = 600（与 AGENTS.md 配方一致）', valueOf(selected, 'font-weight'), '600');
  check('⑤ hover 仍保持同一深档（不把底色提亮）', valueOf(selectedHover, 'background'), 'var(--bib-set-brand-strong)');
  check('⑤ hover 文字仍是 #fff', valueOf(selectedHover, 'color'), '#fff');
  check('⑤ 选中态与 hover 都不使用 filter/brightness（历史写法会把底色提亮、拉低对比度）',
    selected.every(function (d) { return d.indexOf('filter') !== 0; }) && selectedHover.every(function (d) { return d.indexOf('filter') !== 0; }), true);
  check('⑤ 未选中态文字用可见令牌 label-primary（不是二级淡色 / 透明）', valueOf(base, 'color'), 'var(--dsw-alias-label-primary)');
  check('⑤ 未选中态背景透明但控件容器有底色（分段控件的「槽」可见）', valueOf(base, 'background') === 'transparent' && valueOf(declsOf('.bib-set-quota-mode'), 'background') === 'var(--dsw-alias-bg-layer-3, transparent)', true);

  const strongHex = valueOf(rootDecls, '--bib-set-brand-strong');
  const brandHex = valueOf(rootDecls, '--bib-set-brand');
  const strongContrast = contrastRatio(strongHex, '#ffffff');
  const brandContrast = contrastRatio(brandHex, '#ffffff');
  console.log('      · 真实计算：' + strongHex + ' × #fff = ' + strongContrast.toFixed(3) + ':1；' + brandHex + ' × #fff = ' + brandContrast.toFixed(3) + ':1');
  check('⑤ 真实计算：选中态 ' + strongHex + ' × #fff ≥ 4.5:1（实际 ' + strongContrast.toFixed(2) + ':1）', strongContrast >= 4.5, true);
  check('⑤ 真实计算：hover 底色与选中态同色，对比度同样 ≥ 4.5:1', contrastRatio(strongHex, '#ffffff') >= 4.5, true);
  check('⑤ 真实计算：#4d6bfe × #fff 只有 4.33:1 < 4.5（历史提交 #38 的「4.6:1」是算错的，防止有人改回）', Math.round(brandContrast * 100) / 100, 4.33);
  check('⑤ 深档仍属同一品牌蓝族（色相接近：R<G<B 且蓝通道最高）', (function () {
    const v = parseInt(strongHex.slice(1), 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    return r < g && g < b && b > 200;
  })(), true);
  check('⑤ 明暗主题都成立：--bib-set-brand-strong 只有一处声明（无深色主题覆盖）', (clientSrc.match(/--bib-set-brand-strong\s*:/g) || []).length, 1);
  check('⑤ 明暗主题都成立：深色主题选择器内不得覆盖该 token', /data-ds-dark-theme[^{]*\{[^}]*--bib-set-brand-strong/.test(clientSrc), false);
  check('⑤ forced-colors（系统高对比）下选中态走 Highlight / HighlightText，白字不会被吞',
    cssOnly.indexOf('.bib-set-quota-mode-opt[aria-checked="true"] { forced-color-adjust: none; background: Highlight; color: HighlightText; }') !== -1, true);
  check('⑤ 选中态规则在 hover 规则之后声明（同特异性时选中态优先，不依赖顺序巧合）', (function () {
    const hoverIdx = cssOnly.indexOf('.bib-set-quota-mode-opt:hover');
    const checkedIdx = cssOnly.indexOf('.bib-set-quota-mode-opt[aria-checked="true"] {');
    return hoverIdx !== -1 && checkedIdx !== -1 && checkedIdx > hoverIdx;
  })(), true);
  check('⑤ 减少动态效果时控件过渡被关闭（尊重 prefers-reduced-motion）', cssOnly.indexOf('.bib-set-quota-mode-opt { transition: none; }') !== -1, true);
}

// ---------- ⑥ 提交路径：setFieldConfig patch + 乐观更新 + 失败回滚（渲染级，真实 RPC 替身） ----------
function jsonOk(payload) {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: function () { return Promise.resolve(JSON.stringify(payload)); },
  });
}
const CONFIG_FIXTURE = { fields: {}, colors: {}, timeFormat: { year: true, month: true, day: true, hour: true, minute: true, second: false }, timeZones: { main: 'Asia/Shanghai', world: 'UTC' }, customText: '', configVersion: 1 };

async function createSettingsHarness(handle) {
  const requests = [];
  let plugin = null;
  let bundleConfig = null;
  const hooks = { index: 0, slots: [], effects: [] };
  const React = {
    createElement: function (type, props) {
      return { type: type, props: Object.assign({}, props, { children: Array.prototype.slice.call(arguments, 2) }) };
    },
    useState: function (initial) {
      const i = hooks.index++;
      if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks.slots[i], function (value) { hooks.slots[i] = typeof value === 'function' ? value(hooks.slots[i]) : value; }];
    },
    useRef: function (initial) { hooks.index++; return { current: initial }; },
    useEffect: function (fn) { hooks.index++; hooks.effects.push(fn); },
    useCallback: function (fn) { hooks.index++; return fn; },
    cloneElement: function (node, props) { return Object.assign({}, node, { props: Object.assign({}, node.props, props) }); },
  };
  const locale = fixture.createLocale('zh');
  const slots = {
    inject: function (_, register) { return register(); },
    register: function (opts, component) {
      if (opts && opts.name === 'plugins.bundle.config') bundleConfig = component;
      return function () {};
    },
  };
  const fetchStub = function (url, init) {
    const method = String(url).split('/').pop();
    let args = null;
    try { args = JSON.parse(init.body); } catch (err) { args = null; }
    requests.push({ method: method, args: args });
    return handle(method, args);
  };
  vm.runInNewContext(fs.readFileSync(__dirname + '/../lib/client.js', 'utf8'), {
    console: console,
    AbortController: AbortController,
    fetch: fetchStub,
    window: {
      setTimeout: function () { return 0; },
      clearTimeout: function () {},
      __ModuleLoader__: { load: function (mod) { plugin = mod.factory(function () { return React; }); } },
    },
  });
  await plugin.apply({
    slots: slots,
    locale: locale,
    get: function () { return null; },
    effect: function (fn, label) { if (typeof label === 'string' && label.indexOf(': dictionaries') !== -1) fn(); },
  });
  const expand = function (tree) {
    if (Array.isArray(tree)) return tree.map(expand);
    if (!tree || typeof tree !== 'object') return tree;
    if (typeof tree.type === 'function') return expand(tree.type(tree.props));
    return Object.assign({}, tree, { props: Object.assign({}, tree.props, { children: expand(tree.props.children) }) });
  };
  const render = function () { hooks.index = 0; return expand(bundleConfig({ view: 'page' })); };
  const runEffects = function () {
    const pending = hooks.effects.slice();
    hooks.effects.length = 0;
    pending.forEach(function (fn) { fn(); });
  };
  const nodes = function (tree) {
    if (Array.isArray(tree)) return tree.reduce(function (acc, item) { return acc.concat(nodes(item)); }, []);
    if (!tree || typeof tree !== 'object') return [];
    return [tree].concat(nodes(tree.props.children));
  };
  const radiosOf = function (tree) {
    return nodes(tree).filter(function (n) { return n.props && n.props.role === 'radio' && String(n.props.className).indexOf('bib-set-quota-mode-opt') === 0; });
  };
  // 2026-09-25：设置页出现第二个同款两段式控件（更新方式：全自动 / 手动），
  // 两者共用 .bib-set-quota-mode-opt 类名，所以按文案把「方向」这一个单独取出来断言，
  // 否则 radiosOf 会同时数到另一组，direction 的序号断言全部错位。
  const quotaRadiosOf = function (tree) {
    const labels = [t('ui.quotaDisplayRemaining'), t('ui.quotaDisplayUsed')];
    return radiosOf(tree).filter(function (n) { return labels.indexOf(textOf(n.props.children)) !== -1; });
  };
  const updateRadiosOf = function (tree) {
    const labels = [t('ui.updateModeAuto'), t('ui.updateModeManual')];
    return radiosOf(tree).filter(function (n) { return labels.indexOf(textOf(n.props.children)) !== -1; });
  };
  const textOf = function (tree) {
    if (Array.isArray(tree)) return tree.map(textOf).join('');
    if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
    return typeof tree === 'object' ? textOf(tree.props.children) : String(tree);
  };
  return { render: render, runEffects: runEffects, requests: requests, radiosOf: radiosOf, quotaRadiosOf: quotaRadiosOf, updateRadiosOf: updateRadiosOf, nodes: nodes, textOf: textOf };
}

async function bootHarness(handle) {
  const harness = await createSettingsHarness(handle);
  harness.render();      // 首渲骨架（loading）
  harness.runEffects();  // getFieldConfig 生效
  await flush();
  const tree = harness.render();
  return { harness: harness, tree: tree };
}

(async function () {
try {
const okHarness = await bootHarness(function (method, args) {
  if (method === 'getFieldConfig') return jsonOk(Object.assign({}, CONFIG_FIXTURE, { quotaDisplayMode: 'remaining' }));
  if (method === 'setFieldConfig') return jsonOk(Object.assign({}, CONFIG_FIXTURE, { quotaDisplayMode: args.quotaDisplayMode, configVersion: 2, persisted: true }));
  return jsonOk({});
});
check('⑥ 设置页加载后渲染出分段控件（方向 2 项 + 更新方式 2 项 = 4 个 radio）', okHarness.harness.radiosOf(okHarness.tree).length, 4);
check('⑥ 方向控件恰 2 项（不受同款更新方式控件干扰）', okHarness.harness.quotaRadiosOf(okHarness.tree).length, 2);
check('⑥ 初始方向 remaining（缺字段回退）→ 第一项选中', okHarness.harness.quotaRadiosOf(okHarness.tree)[0].props['aria-checked'], true);
check('⑥ getFieldConfig 读取时归一（响应里的方向字段被 normalize）', clientSrc.includes('quotaDisplayMode: normalizeQuotaDisplayMode(cfg.quotaDisplayMode)'), true);
check('⑥ 提交复用既有 commit()：只有一个 setFieldConfig 调用点（不新写一套）', (clientSrc.match(/rpc\('setFieldConfig'/g) || []).length, 1);
check('⑥ patch 形状固定为 { quotaDisplayMode }（不夹带其它字段）', (function () {
  const body = extractFunctionFrom(clientSrc, 'setQuotaDisplayMode');
  return body.indexOf('commit({ quotaDisplayMode: value }') !== -1;
})(), true);
check('⑥ 乐观更新 + 失败回滚两条路径都在（previous 捕获 → revert 恢复）', (function () {
  const body = extractFunctionFrom(clientSrc, 'setQuotaDisplayMode');
  return body.indexOf('const previous = quotaDisplayModeOf();') !== -1
    && body.indexOf('quotaDisplayMode: value }); })') !== -1
    && body.indexOf('quotaDisplayMode: previous }); })') !== -1;
})(), true);
check('⑥ 保存成功后由 applyServerResult 回写快照并保留旧宿主缺失字段', (function () {
  const body = extractFunctionFrom(clientSrc, 'applyServerResult');
  return body.indexOf("typeof res.quotaDisplayMode === 'string' ? normalizeQuotaDisplayMode(res.quotaDisplayMode) : normalizeQuotaDisplayMode(prev && prev.quotaDisplayMode)") !== -1;
})(), true);
{
  const before = okHarness.harness.requests.length;
  okHarness.harness.quotaRadiosOf(okHarness.tree)[1].props.onClick(); // 选「已用」
  const optimistic = okHarness.harness.quotaRadiosOf(okHarness.harness.render());
  check('⑥ 乐观更新：点击后未等响应即切换选中态', optimistic[1].props['aria-checked'] === true && optimistic[0].props['aria-checked'] === false, true);
  const writes = okHarness.harness.requests.slice(before).filter(function (r) { return r.method === 'setFieldConfig'; });
  check('⑥ patch 携带 quotaDisplayMode=used（RPC 真实收到）', JSON.stringify(writes.map(function (r) { return r.args; })), '[{"quotaDisplayMode":"used"}]');
  await flush();
  const settled = okHarness.harness.quotaRadiosOf(okHarness.harness.render());
  check('⑥ 成功后保持 used（服务端回写 configVersion 生效）', settled[1].props['aria-checked'], true);
  const countAfterSuccess = okHarness.harness.requests.filter(function (r) { return r.method === 'setFieldConfig'; }).length;
  okHarness.harness.quotaRadiosOf(okHarness.harness.render())[1].props.onClick(); // 再点已选中项
  await flush();
  check('⑥ 点击已选中项不重复发请求（幂等短路）', okHarness.harness.requests.filter(function (r) { return r.method === 'setFieldConfig'; }).length, countAfterSuccess);
}

const failHarness = await bootHarness(function (method, args) {
  if (method === 'getFieldConfig') return jsonOk(Object.assign({}, CONFIG_FIXTURE, { quotaDisplayMode: 'remaining' }));
  if (method === 'setFieldConfig') return Promise.reject(new Error('Offline'));
  return jsonOk({});
});
{
  const before = failHarness.harness.requests.length;
  failHarness.harness.quotaRadiosOf(failHarness.tree)[1].props.onClick();
  const optimistic = failHarness.harness.quotaRadiosOf(failHarness.harness.render());
  check('⑥ 失败路径：先乐观切到 used', optimistic[1].props['aria-checked'], true);
  await flush();
  const reverted = failHarness.harness.render();
  const radios = failHarness.harness.quotaRadiosOf(reverted);
  check('⑥ 失败回滚：方向退回 remaining（不留下未保存状态）', radios[0].props['aria-checked'] === true && radios[1].props['aria-checked'] === false, true);
  check('⑥ 失败路径确实发出了请求（回滚不是「压根没提交」的假象）', failHarness.harness.requests.slice(before).filter(function (r) { return r.method === 'setFieldConfig'; }).length, 1);
  const alerts = failHarness.harness.nodes(reverted).filter(function (n) { return n.props && n.props.role === 'alert'; }).map(failHarness.harness.textOf);
  check('⑥ 失败提示可见：含字段名与错误原因（' + JSON.stringify(alerts) + '）',
    alerts.some(function (text) { return text.indexOf(t('ui.quotaDisplayModeTitle')) !== -1 && text.indexOf('Offline') !== -1; }), true);
}

// ---------- ⑥b 更新方式：同款两段式（全自动 / 手动）+ 检查更新按钮（2026-09-25 用户拍板） ----------
{
  const tree = okHarness.tree;
  const updateRadios = okHarness.harness.updateRadiosOf(tree);
  check('⑥b 更新方式恰 2 项：全自动更新 / 手动更新', updateRadios.map(okHarness.harness.textOf).join('|'),
    [t('ui.updateModeAuto'), t('ui.updateModeManual')].join('|'));
  check('⑥b 默认全自动（autoUpdate 缺省即视为开）→ 第一项选中', updateRadios[0].props['aria-checked'], true);
  check('⑥b 两个子项都是原生 button（不是裸 div role=radio）', updateRadios.every(function (n) { return n.type === 'button'; }), true);
  check('⑥b 复用同一套分段控件几何（bib-set-quota-mode 容器）', okHarness.harness.nodes(tree).some(function (n) {
    return n.props && typeof n.props.className === 'string' && n.props.className.indexOf('bib-set-quota-mode') === 0
      && n.props.role === 'radiogroup' && n.props['aria-label'] === t('ui.autoUpdateTitle');
  }), true);
  check('⑥b 取值归一显式注入（否则 auto/manual 被方向归一折成 remaining，两项都选不中）',
    clientSrc.includes("normalize: function (value) { return value === 'manual' ? 'manual' : 'auto'; }")
    && clientSrc.includes('const normalize = typeof props.normalize === \'function\' ? props.normalize : normalizeQuotaDisplayMode;'), true);
  check('⑥b 源码里更新方式以 createElement 创建（组件含 hooks，裸调用会 React #310）',
    clientSrc.indexOf('React.createElement(bibSetQuotaMode, {') !== -1 && clientSrc.includes('value: manual ? \'manual\' : \'auto\''), true);
  check('⑥b 选中手动 → 发 setUpdateAuto enabled=false（开关只表示开与关，与显示模式无关）', (function () {
    const before = okHarness.harness.requests.length;
    okHarness.harness.updateRadiosOf(okHarness.harness.render())[1].props.onClick();
    const writes = okHarness.harness.requests.slice(before).filter(function (r) { return r.method === 'setUpdateAuto'; });
    return JSON.stringify(writes.map(function (r) { return r.args; })) === '[{"enabled":false}]';
  })(), true);
  await flush(); // 等 setUpdateAuto 的响应落地：忙碌态解除后「检查更新」才会恢复成可点文案
  check('⑥b 检查更新按钮存在且走 runUpdateCheck（不是复制命令、不执行子进程）', (function () {
    const before = okHarness.harness.requests.length;
    const node = okHarness.harness.nodes(okHarness.harness.render()).filter(function (n) {
      return n.type === 'button' && okHarness.harness.textOf(n) === t('ui.updateCheckNow');
    })[0];
    if (!node) return false;
    node.props.onClick();
    const sent = okHarness.harness.requests.slice(before).filter(function (r) { return r.method === 'runUpdateCheck'; });
    // 不带 force：手动检查不等于「解除回滚暂缓」，否则用户点一次检查就会把回滚过的版本装回来。
    return sent.length === 1 && !sent[0].args.force;
  })(), true);
}

// ---------- ⑦ MiniMax 展示名 + 构建产物接线 ----------
check('⑦ minimax / minimax-cn → t(\'ui.minimax\')（订阅服务名映射）',
  clientSrc.includes("if (provider === 'minimax' || provider === 'minimax-cn') return t('ui.minimax');"), true);
check('⑦ ui.minimax 中英都有且品牌名同形（MiniMax）', t('ui.minimax'), 'MiniMax');
check('⑦ 订阅服务名兜底未受影响（未知 provider 仍是 ui.subscription）', clientSrc.includes("return t('ui.subscription');"), true);
{
  const lib = fs.readFileSync(__dirname + '/../lib/client.js', 'utf8');
  check('⑦ 构建产物含 quotaDisplayMode 归一与分段控件（lib 已重建）',
    lib.includes('function normalizeQuotaDisplayMode') && lib.includes('function bibSetQuotaMode') && lib.includes('bib-set-brand-strong'), true);
  check('⑦ 构建产物含 MiniMax 展示名映射', lib.includes("provider === 'minimax-cn'"), true);
  check('⑦ 构建产物含两个方向的窗口文案键', lib.includes("t('ui.windowUsedRemaining'") && lib.includes("t('ui.windowRemainingUsed'"), true);
}

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
} catch (err) {
  console.error('FAIL  测试装置自身抛错：' + ((err && err.stack) || err));
  process.exit(1);
}
})();
