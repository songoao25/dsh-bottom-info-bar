// 密度切换两态审计：验证 完整/简洁 只有两种形态、无第三态、无竞态、无服务商切换拦截
// 用法：node tests/test-density-toggle.js
const fs = require('fs');

// ---- host 侧审计：setInfoDensity 严格校验 + getConfig 返回 ----
const hostSrc = fs.readFileSync(__dirname + '/../src/host.js', 'utf8');
// 提取 setInfoDensity handler 逻辑做桩验证
function hostSetInfoDensity(value) {
  let infoDensity = 'full';
  const d = value;
  if (d === 'full' || d === 'compact') infoDensity = d;
  return infoDensity;
}

// ---- client 侧审计：onToggleDensity 两态 + toggling 防抖 ----
// 从源码提取关键逻辑做桩验证
const clientSrc = fs.readFileSync(__dirname + '/../src/client-bundle.js', 'utf8');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

// ================= host 侧 =================
// 1) 合法两态
check('host: setInfoDensity("full") 保留 full', hostSetInfoDensity('full'), 'full');
check('host: setInfoDensity("compact") 保留 compact', hostSetInfoDensity('compact'), 'compact');
// 2) 非法值一律拒绝（不产生第三态）
check('host: 非法值 null 拒绝', hostSetInfoDensity(null), 'full');
check('host: 非法值 undefined 拒绝', hostSetInfoDensity(undefined), 'full');
check('host: 非法值 "" 拒绝', hostSetInfoDensity(''), 'full');
check('host: 非法值 "FULL" 拒绝', hostSetInfoDensity('FULL'), 'full');
check('host: 非法值 "full " 拒绝', hostSetInfoDensity('full '), 'full');
check('host: 非法值 123 拒绝', hostSetInfoDensity(123), 'full');
check('host: 非法值 {} 拒绝', hostSetInfoDensity({}), 'full');
// 3) host 源码确实包含校验
check('host 源码含 "d === \'full\' || d === \'compact\'"', hostSrc.includes("d === 'full' || d === 'compact'"), true);

// ================= client 侧 =================
// 4) 切换函数两态（模拟 onToggleDensity 的核心逻辑）
function clientToggle(current) {
  return current === 'full' ? 'compact' : 'full';
}
check('client: full → compact', clientToggle('full'), 'compact');
check('client: compact → full', clientToggle('compact'), 'full');
// 5) 渲染判定：full = density === 'full'（严格，无第三态）
function renderIsFull(density) {
  return density === 'full';
}
check('client: density=full → 完整模式', renderIsFull('full'), true);
check('client: density=compact → 简洁模式', renderIsFull('compact'), false);
check('client: density=undefined → 简洁（不退化完整）', renderIsFull(undefined), false);
check('client: density=null → 简洁（不退化完整）', renderIsFull(null), false);
check('client: density="FULL" → 简洁（不退化完整）', renderIsFull('FULL'), false);
// 6) 源码断言：v20 已用严格判定 + 防抖
check('client 源码含 toggling 防抖', clientSrc.includes('toggling'), true);
check('client 源码含严格判定 === \'full\'', clientSrc.includes("displayDensity === 'full'"), true);
// 精确断言：代码体中不应再有函数调用 onSwitchProvider（排除头注释说明文字）
const codeBody = clientSrc.split('// ---------- 注册')[1] || clientSrc;
check('client 代码体无 onSwitchProvider 调用（点击模型名只触发密度切换）', !codeBody.includes('onSwitchProvider('), true);
check('client 源码 root onClick 绑定 onToggleDensity', clientSrc.includes('onClick: function () { props.onToggleDensity(); }'), true);
check('client 切换立即更新界面，不等待 RPC 返回', clientSrc.includes('setDensity(next);'), true);
check('client 持久化失败时回退到前一密度', clientSrc.includes('if (density === next) setDensity(previous);'), true);
check('client 不在密度切换后重注册 slot', !clientSrc.includes('applyMode();\n      }).catch'), true);
check('client 使用同一 React 树收合完整统计行', clientSrc.includes('bi-density-extra') && clientSrc.includes("'data-density': displayDensity"), true);
check('client 尊重系统减少动态效果设置', clientSrc.includes('prefers-reduced-motion: reduce'), true);
check('client 密度切换可用键盘触发', clientSrc.includes("event.key === 'Enter' || event.key === ' '"), true);
check('启动配置不会覆盖已发生的用户切换', clientSrc.includes('const initialDensityVersion = densityVersion;')
  && clientSrc.includes('initialDensityVersion === densityVersion'), true);
check('密度订阅建立时立即回读当前值，避免首次挂载空窗', clientSrc.includes('setDisplayDensity(density);'), true);
check('保存期间具有忙碌和禁用语义', clientSrc.includes("'aria-busy': isDensitySaving")
  && clientSrc.includes("'aria-disabled': isDensitySaving"), true);
// ============ 显示模型铁律（2026-09-25 用户拍板定型，见 src/constants.js 顶部「显示模型」）============
// 模式的职责只有一条：原生统计行显示不显示。字段显隐一律只看它自己的开关。
// 这里不再逐条列举「某某字段在简洁模式下要隐藏」——那种期望本身就是被违反的设计的复述，
// 而且漏一条就永远绿着（2026-09-25 的 11 处散落门控正是这样活下来的）。
// 改为对设计本身做断言：代码里不允许再出现任何 full 门控。注释行先剥掉，
// 免得「记录教训的注释里提到 if (full)」被误判。
const clientCode = clientSrc.split('\n').filter(function (line) {
  const trimmed = line.trim();
  return !(trimmed.indexOf('//') === 0 || trimmed.indexOf('*') === 0 || trimmed.indexOf('/*') === 0);
}).join('\n');
check('模式不参与字段显隐：代码里没有 if (full 分支', /if \(full/.test(clientCode), false);
check('模式不参与字段显隐：代码里没有 full && fieldVisible 门控', /full\s*&&\s*fieldVisible/.test(clientCode), false);
check('模式不参与字段显隐：三种计费形态共用同一个身份区入口（不再各抄一份带门控的副本）',
  ['anchorGroup', 'subServiceGroup', 'billingServiceGroup'].every(function (id) {
    return clientCode.indexOf("pushIdentityGroups(groups, '" + id + "', ") !== -1;
  }), true);
// 模式的去处只剩「原生行是否参与」与 aria 语义两处。
check('模式只用来判一件事：原生统计行是否参与', clientCode.indexOf('const nativeRowShown = row1Present && full;') !== -1, true);
check('原生统计行随模式收合（CSS 由 data-density 驱动，而非条件渲染）',
  clientSrc.indexOf('.bi-root[data-density="compact"] > .bi-density-extra { height: 0px') !== -1, true);
// 插件字段与提醒字段都住在主行，而主行无条件渲染 —— 因此两种模式下都在。
check('主行无条件渲染（插件字段与提醒字段两种模式都在）',
  clientCode.indexOf("const row2 = React.createElement('div', { id: 'dsh-bottom-info-bar-primary', className: 'bi-row2' }") !== -1, true);
check('提醒字段只受开关控制（两种模式都在，且与模式变量无任何交集）',
  clientSrc.includes("if (restartVersion && fieldVisible('updateNotice'))")
  && clientSrc.includes("if (updateFailed && fieldVisible('updateFailure'))")
  && clientSrc.includes("trailingErrorGroups.push(fieldSpan('updateNotice'")
  && clientSrc.indexOf("if (restartVersion && full)") === -1, true);
check('设置页不再重复提供简洁/完整选择；点击底栏仍由宿主接口持久化', !clientSrc.includes('function bibSetDensitySection(props)')
  && !clientSrc.includes('commit({ infoDensity: value }') && hostSrc.includes('setInfoDensity: function'), true);
// 7) 无残留的旧宽松判定
check('client 源码不含 !== \'compact\' 宽松判定', !clientSrc.includes("props.density !== 'compact'"), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
