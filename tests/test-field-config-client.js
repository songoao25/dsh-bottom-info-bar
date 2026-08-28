// v1.9.0 PR2 客户端静态断言：字段自选/配色
// ① 过滤逻辑嵌在三态渲染函数内部 + 分隔符正确收合 ② 默认配置渲染与旧版一致
// ③ 颜色变量默认不注入（未自定义零回归）④ 字段注册表一致性（宿主白名单 = 客户端渲染 = 设置页）
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
check('文字标签保留（低/估算），颜色永不是唯一信息载体', clientSrc.includes("className: 'bi-low-status' }, '低'")
  && clientSrc.includes("'（估算）'"), true);

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
check('分组顺序与中文标题齐备', FIELD_GROUP_ORDER.length === Object.keys(FIELD_GROUP_LABELS).length
  && FIELD_GROUP_LABELS.anchor === '身份锚点' && FIELD_GROUP_LABELS.status === '状态与提醒', true);
check('构建注入锚点存在于客户端源码', clientSrc.includes('const FIELD_REGISTRY = /*__FIELD_REGISTRY__*/[]')
  && clientSrc.includes('const PRESET_COLORS = /*__PRESET_COLORS__*/[]'), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
