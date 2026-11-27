const fs = require('fs');
const vm = require('node:vm');
// v1.28.0 显示货币（issue #317）：报告人 jt-at-home 指会话花费 ¥、余额 $ 币种错位。
// 覆盖：
//   ① 常量单一生源：DISPLAY_CURRENCIES（auto + 7 币种）/ DISPLAY_CURRENCY_META
//      （符号/小数位/兑美元汇率）/ DISPLAY_FX_AS_OF
//   ② 换算纯函数（accounting.js）：convertMoney（USD 枢纽）+ normalizeDisplayCurrency（宽松版）
//   ③ 落屏格式化（client-bundle.js）：displayMoneyParts（符号/千分位/小数位/~ 标记/3 位小数）
//   ④ host 落盘链路：默认值 / sanitize / payload / patch 白名单与校验 / 应用 / 重置
//   ⑤ 设置页接线：BIB_SET_SECTIONS currency 卡片（quota 之后）+ Go 页同行 + 快照管道
//   ⑥ 文案：4 键 × 13 语齐全非空，zh/en 对称互异
//   ⑦ 构建注入：lib/client.js 含真实换算表、无残留占位
//   ⑧ native.js：moneyText 走换算、闭包传 displayCurrency
// 用法：node tests/test-display-currency.cjs（需先 node scripts/build.mjs，run-all 会自己 build）
const constantsSrc = fs.readFileSync(__dirname + '/../src/constants.js', 'utf8');
const accountingSrc = fs.readFileSync(__dirname + '/../src/accounting.js', 'utf8');
const clientSrc = fs.readFileSync(__dirname + '/../src/client-bundle.js', 'utf8');
const hostSrc = fs.readFileSync(__dirname + '/../src/host.js', 'utf8');
const nativeSrc = fs.readFileSync(__dirname + '/../src/native.js', 'utf8');
const localesSrc = fs.readFileSync(__dirname + '/../src/locales.js', 'utf8');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}
function checkNear(label, actual, expected, tolerance) {
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tolerance;
  if (ok) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ≈' + expected + ' (±' + tolerance + ')，实际 ' + JSON.stringify(actual)); }
}
function checkContains(label, source, needle) {
  check(label, source.indexOf(needle) !== -1, true);
}

// 与 test-quota-display-mode.cjs 同法：按括号计数提取函数体，保持测试对真实源码求值。
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

// 与 scripts/build.mjs 同法：按括号配对提取字面量（支持字符串内的括号）。
function extractLiteral(source, name) {
  const marker = 'export const ' + name + ' = ';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('无法从 constants.js 中找到 ' + name);
  let openIdx = -1, openCh = '', closeCh = '';
  for (let i = start + marker.length; i < source.length; i++) {
    const ch = source[i];
    if (ch === '[' || ch === '{') { openIdx = i; openCh = ch; closeCh = ch === '[' ? ']' : '}'; break; }
  }
  if (openIdx === -1) throw new Error(name + ' 不是数组/对象字面量');
  let depth = 0, inStr = null, escaped = false;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === openCh) depth++;
    else if (ch === closeCh) { depth--; if (depth === 0) return source.slice(openIdx, i + 1); }
  }
  throw new Error(name + ' 的字面量未闭合');
}

const metaLiteral = extractLiteral(constantsSrc, 'DISPLAY_CURRENCY_META');
const currenciesLiteral = extractLiteral(constantsSrc, 'DISPLAY_CURRENCIES');
const META = vm.runInNewContext('(' + metaLiteral + ')', {});
const CURRENCIES = vm.runInNewContext('(' + currenciesLiteral + ')', {});

// ---------- ① 常量单一生源 ----------
check('DISPLAY_CURRENCIES 为 auto + 7 币种', JSON.stringify(CURRENCIES), JSON.stringify(['auto', 'USD', 'CNY', 'EUR', 'GBP', 'JPY', 'HKD', 'KRW']));
check('换算表含 7 币种', Object.keys(META).sort().join(','), 'CNY,EUR,GBP,HKD,JPY,KRW,USD');
check('USD 符号与小数位', META.USD.symbol + '/' + META.USD.decimals + '/' + META.USD.perUsd, '$/2/1');
check('CNY 兑美元 6.67', META.CNY.perUsd, 6.67);
check('EUR 兑美元 0.91', META.EUR.perUsd, 0.91);
check('GBP 兑美元 0.763', META.GBP.perUsd, 0.763);
check('JPY 兑美元 159、0 位小数', META.JPY.perUsd + '/' + META.JPY.decimals, '159/0');
check('HKD 符号 HK$、兑美元 7.84', META.HKD.symbol + '/' + META.HKD.perUsd, 'HK$/7.84');
check('KRW 符号 ₩、0 位小数、兑美元 1343', META.KRW.symbol + '/' + META.KRW.decimals + '/' + META.KRW.perUsd, '₩/0/1343');
checkContains('汇率 as-of 日期在位', constantsSrc, "export const DISPLAY_FX_AS_OF = '2026-11-26'");
checkContains('默认值 auto 在位', constantsSrc, "export const DEFAULT_DISPLAY_CURRENCY = 'auto'");

// ---------- ② 换算纯函数（accounting.js 顶层导出） ----------
const accountingBox = {};
vm.createContext(accountingBox);
vm.runInContext(
  'const DISPLAY_CURRENCY_META = ' + metaLiteral + ';\n' +
  'const DISPLAY_CURRENCIES = ' + currenciesLiteral + ';\n' +
  extractFunctionFrom(accountingSrc, 'convertMoney') + '\n' +
  extractFunctionFrom(accountingSrc, 'normalizeDisplayCurrency') + '\n',
  accountingBox);
const convertMoney = accountingBox.convertMoney;
const normalizeDisplayCurrency = accountingBox.normalizeDisplayCurrency;
check('归一：USD 原样', normalizeDisplayCurrency('USD'), 'USD');
check('归一：JPY 原样', normalizeDisplayCurrency('JPY'), 'JPY');
check('归一：undefined 回 auto', normalizeDisplayCurrency(undefined), 'auto');
check('归一：null 回 auto', normalizeDisplayCurrency(null), 'auto');
check('归一：非法值回 auto', normalizeDisplayCurrency('XXX'), 'auto');
check('归一：空串回 auto', normalizeDisplayCurrency(''), 'auto');
check('归一：数字回 auto', normalizeDisplayCurrency(123), 'auto');
check('换算：auto 不换算', JSON.stringify(convertMoney(6.67, 'CNY', 'auto')), JSON.stringify({ value: 6.67, currency: 'CNY', converted: false }));
check('换算：同币种不换算', JSON.stringify(convertMoney(5, 'USD', 'USD')), JSON.stringify({ value: 5, currency: 'USD', converted: false }));
checkNear('换算：CNY 6.67 → USD 1.00', convertMoney(6.67, 'CNY', 'USD').value, 1, 0.001);
check('换算：CNY 6.67 → USD 标记 converted', convertMoney(6.67, 'CNY', 'USD').converted, true);
checkNear('换算：USD 1 → CNY 6.67', convertMoney(1, 'USD', 'CNY').value, 6.67, 0.001);
checkNear('换算：USD 10 → EUR 9.10', convertMoney(10, 'USD', 'EUR').value, 9.1, 0.001);
checkNear('换算：CNY 100 → JPY ≈2383.8', convertMoney(100, 'CNY', 'JPY').value, 2383.8, 0.5);
checkNear('换算：USD 5 → HKD 39.20', convertMoney(5, 'USD', 'HKD').value, 39.2, 0.001);
checkNear('换算：USD 1 → KRW 1343', convertMoney(1, 'USD', 'KRW').value, 1343, 0.001);
checkNear('换算：EUR 0.91 → USD 1.00', convertMoney(0.91, 'EUR', 'USD').value, 1, 0.001);
check('换算：未知源币种不换算', JSON.stringify(convertMoney(5, 'XXX', 'USD')), JSON.stringify({ value: 5, currency: 'XXX', converted: false }));
check('换算：未知目标币种不换算', JSON.stringify(convertMoney(5, 'USD', 'XXX')), JSON.stringify({ value: 5, currency: 'USD', converted: false }));
check('换算：NaN 原样返回不换算', convertMoney(NaN, 'USD', 'CNY').converted, false);
check('createAccounting 返回值仍挂 convertMoney', accountingSrc.indexOf('convertMoney: convertMoney,') !== -1, true);

// ---------- ③ 落屏格式化（client-bundle.js） ----------
const clientBox = { fieldConfig: { displayCurrency: 'auto' } };
vm.createContext(clientBox);
vm.runInContext(
  'const DISPLAY_CURRENCY_META = ' + metaLiteral + ';\n' +
  'const DISPLAY_CURRENCIES = ' + currenciesLiteral + ';\n' +
  "const DEFAULT_DISPLAY_CURRENCY = 'auto';\n" +
  'let fieldConfig = { displayCurrency: \'auto\' };\n' +
  extractFunctionFrom(clientSrc, 'normalizeDisplayCurrency') + '\n' +
  extractFunctionFrom(clientSrc, 'activeDisplayCurrency') + '\n' +
  extractFunctionFrom(clientSrc, 'convertDisplayMoney') + '\n' +
  extractFunctionFrom(clientSrc, 'displayMoneyParts') + '\n',
  clientBox);
const displayMoneyParts = clientBox.displayMoneyParts;
// 注意：eval 代码里 `let fieldConfig` 是词法绑定，会遮住 sandbox 上的同名属性，
// 所以改值必须在 vm 上下文里执行，不能改 clientBox.fieldConfig。
function setCurrency(code) { vm.runInContext('fieldConfig.displayCurrency = ' + JSON.stringify(code) + ';', clientBox); }
setCurrency('auto');
check('落屏 auto：CNY 1234.5 符号 ¥', displayMoneyParts('CNY', 1234.5, null).symbol, '¥');
check('落屏 auto：CNY 1234.5 数字带千分位', displayMoneyParts('CNY', 1234.5, null).text, '1,234.50');
check('落屏 auto：未换算标记 false', displayMoneyParts('CNY', 1234.5, null).converted, false);
setCurrency('USD');
check('落屏 USD：CNY 6.67 符号 ~$', displayMoneyParts('CNY', 6.67, null).symbol, '~$');
check('落屏 USD：CNY 6.67 数字 1.00', displayMoneyParts('CNY', 6.67, null).text, '1.00');
setCurrency('JPY');
check('落屏 JPY：CNY 6.67 符号 ~¥', displayMoneyParts('CNY', 6.67, null).symbol, '~¥');
check('落屏 JPY：CNY 6.67 数字 159（0 位小数）', displayMoneyParts('CNY', 6.67, null).text, '159');
setCurrency('HKD');
check('落屏 HKD：USD 1 符号 ~HK$', displayMoneyParts('USD', 1, null).symbol, '~HK$');
check('落屏 HKD：USD 1 数字 7.84', displayMoneyParts('USD', 1, null).text, '7.84');
setCurrency('KRW');
check('落屏 KRW：USD 1 符号 ~₩', displayMoneyParts('USD', 1, null).symbol, '~₩');
check('落屏 KRW：USD 1 数字 1,343（千分位、0 位小数）', displayMoneyParts('USD', 1, null).text, '1,343');
setCurrency('EUR');
check('落屏 EUR：USD 10 符号 ~€', displayMoneyParts('USD', 10, null).symbol, '~€');
check('落屏 EUR：USD 10 数字 9.10', displayMoneyParts('USD', 10, null).text, '9.10');
setCurrency('auto');
check('落屏 auto：负数符号与数字分离', displayMoneyParts('USD', -12.3, null).symbol + '|' + displayMoneyParts('USD', -12.3, null).text, '$|-12.30');
check('落屏 auto：3 位小数模式', displayMoneyParts('CNY', 6.67, 3).text, '6.670');
setCurrency('USD');
check('落屏 USD：3 位小数换算', displayMoneyParts('CNY', 6.67, 3).symbol + '|' + displayMoneyParts('CNY', 6.67, 3).text, '~$|1.000');
setCurrency('XXX');
check('落屏非法设置值回退 auto（不抛错）', displayMoneyParts('CNY', 6.67, null).symbol, '¥');
// 全部金额显示点走统一换算口（旧的符号二选一写法不得残留于金额落屏处）
checkContains('会话成本走换算口', clientSrc, 'displayMoneyParts(costNative,');
checkContains('汇总行走换算口', clientSrc, 'displayMoneyParts(hoverNative,');
checkContains('账单本月花费走换算口', clientSrc, 'displayMoneyParts(d.currency,');
checkContains('余额明细走换算口', clientSrc, 'displayMoneyParts(bal.currency,');
checkContains('余额块总计走换算口', clientSrc, 'const balParts = displayMoneyParts(bal.currency, bal.data.total, null);');
check('余额块不再用原生符号二选一直出', clientSrc.indexOf("const symbol = bal.currency === 'USD' ? '$' : '¥';") === -1, true);
checkContains('余额悬停明细与总计同一换算口径', clientSrc, 'return displayMoneyParts(bal.currency, n, null).text;');
checkContains('智谱充值余额走换算口（CNY 原生）', clientSrc, "displayMoneyParts('CNY', sub.balance, null)");
check('智谱充值余额不再 ¥ 直拼', clientSrc.indexOf("'¥' + fmt(sub.balance, 2)") === -1, true);
check('积分余额仍不带币种符号（积分不是钱）', clientSrc.indexOf('isCreditsBalance ? fmt(sub.balance, 2) : subBalParts.symbol + subBalParts.text') !== -1, true);
check('旧 slice(1) 剥符号写法已清除', clientSrc.indexOf('goMoneyFull(bal.currency, toppedUp).slice(1)') === -1, true);
checkContains('goMoneyFull 走 parts', clientSrc, 'const parts = displayMoneyParts(currency, value, null);');
checkContains('goMoneyCompact 走换算', clientSrc, 'const converted = convertDisplayMoney(currency, value);');

// ---------- ④ host 落盘链路 ----------
const hostBox = {};
vm.createContext(hostBox);
vm.runInContext(
  'const DISPLAY_CURRENCIES = ' + currenciesLiteral + ';\n' +
  extractFunctionFrom(hostSrc, 'normalizeDisplayCurrencyStrict') + '\n',
  hostBox);
const normalizeStrict = hostBox.normalizeDisplayCurrencyStrict;
check('host 严格归一：USD 原样', normalizeStrict('USD'), 'USD');
check('host 严格归一：非法值回 null（拒收）', normalizeStrict('XXX'), null);
check('host 严格归一：undefined 回 null', normalizeStrict(undefined), null);
checkContains('host 默认值 auto', hostSrc, "displayCurrency: 'auto'");
checkContains('host sanitize 分支', hostSrc, "if ('displayCurrency' in raw) {");
checkContains('host payload 字段', hostSrc, 'displayCurrency: fieldSettings.displayCurrency,');
checkContains('host patch 白名单', hostSrc, "Object.hasOwn(patch, 'displayCurrency')");
checkContains('host patch 校验用新文案键', hostSrc, "t('host.displayCurrencyInvalid')");
checkContains('host 应用分支', hostSrc, 'if (hasDisplayCurrencyPatch) {');
checkContains('host reset 回默认值', hostSrc, 'fieldSettings.displayCurrency = defaults.displayCurrency');

// ---------- ⑤ 设置页接线 ----------
const quotaIdx = clientSrc.indexOf("{ id: 'quota'");
const currencyIdx = clientSrc.indexOf("{ id: 'currency'");
check('BIB_SET_SECTIONS 含 currency 区', currencyIdx !== -1, true);
check('currency 区紧跟 quota 之后', quotaIdx !== -1 && currencyIdx > quotaIdx, true);
checkContains('currency 卡片函数在位', clientSrc, 'function bibSetDisplayCurrencySection(props) {');
checkContains('currency 卡片用下拉选择器', clientSrc, 'React.createElement(bibSetSelect, {');
checkContains('currency 卡片不用分段控件', clientSrc, 'displayCurrencyOptions()');
checkContains('Go 页同行用 displayCurrencyOf', clientSrc, 'value: deps.displayCurrencyOf(),');
checkContains('Go 页同行接 setDisplayCurrency', clientSrc, 'onChange: deps.setDisplayCurrency,');
checkContains('快照加载含 displayCurrency', clientSrc, 'displayCurrency: normalizeDisplayCurrency(cfg.displayCurrency)');
checkContains('fieldConfig 默认含 displayCurrency', clientSrc, 'displayCurrency: DEFAULT_DISPLAY_CURRENCY');
checkContains('applyFieldConfigSnapshot 含 displayCurrency', clientSrc, 'displayCurrency: normalizeDisplayCurrency(next && next.displayCurrency)');
checkContains('setDisplayCurrency 用 commit 乐观更新', clientSrc, 'commit({ displayCurrency: value },');

// ---------- ⑥ 文案：4 键 × 13 语 ----------
const MARKER = 'export const LOCALES =';
const markerAt = localesSrc.indexOf(MARKER);
if (markerAt < 0) throw new Error('src/locales.js 缺少 ' + MARKER);
const dictionaries = JSON.parse(localesSrc.slice(markerAt + MARKER.length).trim().replace(/;$/, ''));
const LOCALE_CODES = Object.keys(dictionaries);
check('locale 数量 13', LOCALE_CODES.length, 13);
const DISPLAY_KEYS = ['ui.displayCurrencyTitle', 'ui.displayCurrencyDesc', 'ui.displayCurrencyAuto', 'host.displayCurrencyInvalid'];
for (const code of LOCALE_CODES) {
  for (const key of DISPLAY_KEYS) {
    const value = dictionaries[code][key];
    check('文案 ' + code + ' ' + key + ' 非空', typeof value === 'string' && value.length > 0, true);
  }
}
check('zh/en 标题互异', dictionaries.zh['ui.displayCurrencyTitle'] !== dictionaries.en['ui.displayCurrencyTitle'], true);
check('zh/en 说明互异', dictionaries.zh['ui.displayCurrencyDesc'] !== dictionaries.en['ui.displayCurrencyDesc'], true);
check('zh/en auto 互异', dictionaries.zh['ui.displayCurrencyAuto'] !== dictionaries.en['ui.displayCurrencyAuto'], true);
check('zh/en 校验文案互异', dictionaries.zh['host.displayCurrencyInvalid'] !== dictionaries.en['host.displayCurrencyInvalid'], true);

// ---------- ⑦ 构建注入 ----------
const builtClient = fs.readFileSync(__dirname + '/../lib/client.js', 'utf8');
check('构建产物含真实换算表（HKD，单引号字面量）', builtClient.indexOf("'HKD'") !== -1 && builtClient.indexOf('7.84') !== -1, true);
check('构建产物无残留占位', builtClient.indexOf('/*__DISPLAY_CURRENCY_META__*/') === -1, true);

// ---------- ⑧ native.js ----------
checkContains('native moneyText 走换算', nativeSrc, 'convertMoney(n, currency, normalizeDisplayCurrency(displayCurrency))');
checkContains('native 闭包传 displayCurrency', nativeSrc, 'moneyText(m.currency, m.value, fieldSettings && fieldSettings.displayCurrency)');
checkContains('native 导入换算表', nativeSrc, "import { DISPLAY_CURRENCY_META } from './constants.js'");
checkContains('native 导入换算函数', nativeSrc, "import { convertMoney, normalizeDisplayCurrency } from './accounting.js'");

// ---------- ⑨ v1.29.1 下拉显示即时刷新（issue #317 跟进） ----------
// 报告人：选 USD 后下拉仍显示 Automatic，重开面板才对。根因在 bibSetSelect 的原生
// 分支：宿主 Menu 在挂载时快照锚点按钮，value 变了不重画锚点文字；React 树本身是对的
// （commit 乐观更新快照、value 往下传），所以纯字符串断言查不出，须把真实函数跑起来：
// 用桩 React + 桩宿主渲染 bibSetSelect，断言 Menu 元素的 key 跟 value 走、锚点文字
// 就是当前选项；再断言 onSelect 把所选项交出去；兜底 <select> 分支受控，本来就即时。
function makeStubReact() {
  function createElement(type, config) {
    const props = Object.assign({}, config || {});
    const key = props.key !== undefined ? props.key : null;
    delete props.key;
    const children = Array.prototype.slice.call(arguments, 2);
    props.children = children.length === 1 ? children[0] : children;
    return { type: type, props: props, key: key };
  }
  return { createElement: createElement, useState: function (initial) { return [initial, function () {}]; } };
}
function NativeMenuStub() {}
const SELECT_SRC = extractFunctionFrom(clientSrc, 'bibSetSelect') + '\n' + extractFunctionFrom(clientSrc, 'bibSetButton');
const SELECT_OPTIONS = [
  { id: 'auto', label: 'Automatic (billing currency)' },
  { id: 'USD', label: 'USD $' },
  { id: 'EUR', label: 'EUR €' },
];
function renderSelect(nativeMenu, value, onChange) {
  const box = { React: makeStubReact(), BIB_SET_NATIVE_MENU: nativeMenu, BIB_SET_NATIVE_BUTTON: null, BIB_SET_CHEVRON_ICON: null };
  vm.createContext(box);
  vm.runInContext(SELECT_SRC, box);
  return box.bibSetSelect({ value: value, label: 'Display currency', options: SELECT_OPTIONS, fallbackClassName: 'bib-set-display-currency', onChange: onChange || function () {} });
}
function anchorLabel(menuEl) {
  const kids = menuEl.props.anchor.props.children;
  const list = Array.isArray(kids) ? kids : [kids];
  for (const k of list) {
    if (k && k.props && typeof k.props.className === 'string' && k.props.className.indexOf('bib-set-select-value') !== -1) return k.props.children;
  }
  return null;
}
const menuAuto = renderSelect(NativeMenuStub, 'auto');
check('原生分支：value=auto 时 Menu key=auto', menuAuto.key, 'auto');
check('原生分支：value=auto 时锚点显示 auto 文案', anchorLabel(menuAuto), 'Automatic (billing currency)');
const menuUsd = renderSelect(NativeMenuStub, 'USD');
check('原生分支：value=USD 时 Menu key=USD', menuUsd.key, 'USD');
check('原生分支：value=USD 时锚点显示 USD $', anchorLabel(menuUsd), 'USD $');
check('原生分支：换值即换 key（强制重挂 Menu 与锚点）', menuAuto.key !== menuUsd.key, true);
check('原生分支：selectedId 跟 value 走', menuUsd.props.selectedId, 'USD');
let picked = null;
const menuPick = renderSelect(NativeMenuStub, 'auto', function (id) { picked = id; });
menuPick.props.onSelect('EUR');
check('原生分支：onSelect 把所选项交给 onChange', picked, 'EUR');
const selectFallback = renderSelect(null, 'USD');
check('兜底分支：受控 select 的 value 跟 value 走', selectFallback.props.value, 'USD');
check('兜底分支：仍是 select 元素', selectFallback.type, 'select');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
