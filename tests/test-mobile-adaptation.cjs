// 移动端基础适配回归锁（2026-11-12）
// 桌面端像素零变化是硬约束：所有手机规则必须只存在于媒体查询里；基础声明一个字不动。
// 手机宽度（≤480px / 横屏矮视口）保证：可折行、分隔符不悬空、触控目标 44px、底部安全区。
// 触屏（hover 不可用）保证：整栏点按展开内联明细（title 文案可达），桌面端行为不变。
// 用法：node tests/test-mobile-adaptation.cjs
'use strict';
const fs = require('fs');
const path = require('path');

const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'client-bundle.js'), 'utf8');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

// ---------- 取信息栏样式表（installStyles 模板字符串） ----------
const marker = 'style.textContent = `';
const cssStart = clientSrc.indexOf(marker);
check('源码中能定位到信息栏样式表模板', cssStart > 0, true);
const cssEnd = clientSrc.indexOf('` + FIELD_COLOR_CSS', cssStart);
const css = clientSrc.slice(cssStart + marker.length, cssEnd);

// ---------- 1) 桌面端：基础声明保持不变（像素零变化的前提） ----------
const rootAt = css.indexOf('.bi-root {');
const rootDecl = css.slice(rootAt, css.indexOf('}', rootAt));
check('桌面根节点宽度仍取宿主内容宽度令牌', rootDecl.includes('width: var(--dsh-chat-content-width, 100%)'), true);
check('桌面根节点内边距仍是 4px 0px 0px（手机规则不得挤进基础层）', rootDecl.includes('padding: 4px 0px 0px'), true);
check('桌面字号仍取宿主次级字号令牌', rootDecl.includes('font-size: var(--dsh-content-font-size-secondary, 13px)'), true);
check('桌面节奏令牌 --bi-line 仍由宿主字号增量驱动', rootDecl.includes('--bi-line: calc(20px + var(--dsh-content-font-delta-secondary, 0px))'), true);
check('基础层没有新增手机专属的 min-height/安全区声明', !rootDecl.includes('min-height: 44px') && !rootDecl.includes('safe-area-inset'), true);

// ---------- 2) 手机宽度媒体查询 ----------
const mobileAt = css.indexOf('@media (max-width: 480px)');
check('存在手机宽度媒体查询', mobileAt > 0, true);
check('同一查询覆盖横屏矮视口（orientation: landscape + max-height: 480px）', css.slice(mobileAt, mobileAt + 120).includes('(orientation: landscape) and (max-height: 480px)'), true);
const mobileEnd = css.indexOf('/* 横屏矮视口', mobileAt);
check('手机规则块可完整切出', mobileEnd > mobileAt, true);
const mobileBlock = css.slice(mobileAt, mobileEnd);
check('窄屏允许字段组内折行（长模型名/三窗口/长错误不再撑破容器）',
  mobileBlock.includes('.bi-root > .bi-row2 > span:not(.bi-tail) { white-space: normal; overflow-wrap: anywhere; }'), true);
check('窄屏隐藏悬空分隔符，改用 8px 间距分组',
  mobileBlock.includes('.bi-sep { display: none; }') && mobileBlock.includes('column-gap: 8px'), true);
check('窄屏整栏触控目标 ≥44px', mobileBlock.includes('min-height: 44px'), true);
check('窄屏底部安全区使用 env(safe-area-inset-bottom)', mobileBlock.includes('env(safe-area-inset-bottom'), true);
check('圆环命中区用伪元素扩到 44px（不把整行撑高）',
  mobileBlock.includes('.bi-ctx-trigger::after') && mobileBlock.includes('height: 44px'), true);
check('圆环尾巴保持整体不折行（防 2026-09-24 圆环单独占行回归）',
  mobileBlock.includes('> span:not(.bi-tail)') && !mobileBlock.includes('.bi-tail { white-space: normal'), true);
check('手机规则没有改写宽度/字号/节奏令牌（只改布局与触控）',
  !mobileBlock.includes('width: var(--dsh-chat-content-width') && !mobileBlock.includes('font-size: var(--dsh-content-font-size-secondary')
  && !mobileBlock.includes('--bi-line:'), true);
check('横屏矮视口单独收窄上下留白', css.includes('@media (orientation: landscape) and (max-height: 480px) {') && css.includes('padding-top: 4px'), true);

// ---------- 3) 触屏点按明细（hover-only → 轻点展开） ----------
check('存在触屏判定函数（hover 不可用 / coarse pointer）', clientSrc.includes('function touchDetailsEnabled()'), true);
check('触屏判定有 matchMedia 缺失兜底（极简宿主按桌面处理）',
  clientSrc.includes("typeof window.matchMedia !== 'function'") && clientSrc.includes("matchMedia('(hover: hover)')") && clientSrc.includes("matchMedia('(pointer: coarse)')"), true);
check('存在明细收集函数（读各字段 title，与桌面 hover 同一份文案）',
  clientSrc.includes('function collectInfoBarDetails(rootEl)') && clientSrc.includes("rootEl.querySelectorAll('[title]')"), true);
check('收集时跳过已收起（高度为 0 / visibility:hidden）的节点', clientSrc.includes('rect.width > 0') && clientSrc.includes("style.visibility === 'hidden'"), true);
check('收集按 title 去重、跳过与可见文本相同的空信息标题',
  clientSrc.includes('seen.has(text)') && clientSrc.includes('visibleText === text'), true);
check('错误提示（.bi-stale/.bi-err）不在收集层被排除（#274 原因可达）',
  !/collectInfoBarDetails[\s\S]{0,600}bi-stale/.test(clientSrc), true);

// ---------- 4) 渲染接线 ----------
check('组件在渲染前判定触屏（hooks 早于渲染早退）',
  clientSrc.indexOf('const [touchDetails] = React.useState(touchDetailsEnabled);') > 0
  && clientSrc.indexOf('const [touchDetails] = React.useState(touchDetailsEnabled);') < clientSrc.indexOf('if (infoBarShouldRemoveAll(removalRegistry, fieldVisible)'), true);
check('面板状态存在（打开/收起 + 明细数组 + 栏 ref）',
  clientSrc.includes('const [detailsOpen, setDetailsOpen] = React.useState(false);')
  && clientSrc.includes('const [detailsItems, setDetailsItems] = React.useState([]);')
  && clientSrc.includes('const barRef = React.useRef(null);'), true);
check('面板在数据/配置/语言变化时重取明细',
  clientSrc.includes('}, [touchDetails, detailsOpen, state, fieldConfigTick, languageRevision]);'), true);
check('面板是信息栏的兄弟节点（文档流内展开，不覆盖输入框）',
  clientSrc.includes('React.createElement(React.Fragment, null, barNode, detailsNode)'), true);
check('面板是 region 语义且带可读名称', clientSrc.includes("role: 'region'") && clientSrc.includes("'aria-label': t('ui.infoBarSettings')"), true);
check('面板含完整/简洁切换与收起按钮（触屏上原「点整栏切换」的替代入口）',
  clientSrc.includes("className: 'bi-mobile-details-button'") && clientSrc.includes('onClick: function () { props.onToggleDensity(); }')
  && clientSrc.includes('onClick: function () { setDetailsOpen(false); }'), true);
check('面板样式只在触屏渲染（桌面没有该 DOM）', css.includes('.bi-mobile-details {') && css.includes('.bi-mobile-details-button {'), true);
check('整栏点击展开明细（Go 卡或触屏），桌面仍切换密度',
  clientSrc.includes('const barExpandsSheet = useGoCard || touchDetails;')
  && clientSrc.includes('if (barExpandsSheet) {') && clientSrc.includes('setDetailsOpen(function (open) { return !open; });')
  && clientSrc.includes('props.onToggleDensity();'), true);
check('Go 卡不依赖触屏也能展开（hover 可用的 Go 表面不再打不开面板）',
  clientSrc.includes('const barExpandsSheet = useGoCard || touchDetails;'), true);
check('根节点如实暴露 aria-expanded，并去掉无用的 hover title',
  clientSrc.includes("'aria-expanded': barExpandsSheet ? detailsOpen : undefined")
  && clientSrc.includes('title: barExpandsSheet ? undefined :'), true);
check('面板打开时可用 Esc 收起', clientSrc.includes("event.key === 'Escape'") && clientSrc.includes("document.addEventListener('keydown', onKeyDown)"), true);
check('面板高度受限、可内部滚动（不把输入框挤出视口）',
  css.includes('max-height: 40vh') && css.includes('overflow: hidden auto'), true);

// ---------- 5) DSH Go 皮肤层门控与 token（2026-11-12，只做准备，不含视觉规则） ----------
check('存在 DSH Go 表面判定函数（网页版属性 / 整页岛 hash / 注入通道）',
  clientSrc.includes('function dshGoSurfaceEnabled()')
  && clientSrc.includes("root.getAttribute('data-dsh-app-layout') !== null")
  && clientSrc.includes("root.getAttribute('data-dsh-go-island') !== null")
  && clientSrc.includes("indexOf('dsh-go-island=')"), true);
check('整页岛信号会归一成 data-dsh-go-island 属性（CSS 与 JS 共用同一信号）',
  clientSrc.includes("root.setAttribute('data-dsh-go-island', '1')"), true);
check('apply 在安装样式前调用门控（CSS 首帧即可生效）',
  clientSrc.indexOf('dshGoSurfaceEnabled();') > 0
  && clientSrc.indexOf('dshGoSurfaceEnabled();') < clientSrc.indexOf('const disposeStyles = installStyles();'), true);
const tokenStart = css.indexOf('/* ---------- DSH Go 皮肤层');
const gateStart = css.indexOf(':root[data-dsh-app-layout], :root[data-dsh-go-island] {', tokenStart);
check('Go 皮肤层由宿主属性门控，不依赖触屏（DSH Go 在任何指针环境都套 Go 形态）',
  tokenStart > 0 && gateStart > tokenStart
  && !css.slice(tokenStart, css.indexOf('/* ---------- DSH Go 信息栏三列卡', tokenStart)).includes('@media (pointer: coarse)'), true);
check('Go 设置页预览卡与真实卡同构：无 chevron、16 页边、56 高、三列按内容分布',
  !clientSrc.includes('bib-go-preview-chevron')
  && clientSrc.includes('justify-content: space-between; gap: 10px; height: 100%; padding: 0 16px')
  && clientSrc.includes('bib-go-preview-card, :root[data-dsh-go-island] .bib-go-preview-card { height: 56px; padding: 0; box-sizing: border-box; }')
  && clientSrc.includes('.bib-go-preview-col:last-child, :root[data-dsh-go-island] .bib-go-preview-col:last-child { align-items: flex-end; text-align: right; }'), true);
check('Go 形态判定不再要求触屏（平板/大窗/鼠标环境仍是 DSH Go）',
  /function dshGoCompactEnabled\(\) \{\s*return dshGoSurfaceEnabled\(\);/.test(clientSrc), true);
const tokenBlock = css.slice(gateStart, css.indexOf('/* ---------- DSH Go 信息栏三列卡', gateStart));
const visualBlock = css.slice(css.indexOf('/* ---------- DSH Go 信息栏三列卡', gateStart), css.indexOf('/* 字段级颜色消费规则', gateStart));
check('门控选择器覆盖 DSH Go 网页版与整页岛两种信号',
  tokenBlock.includes(':root[data-dsh-app-layout], :root[data-dsh-go-island]'), true);
check('token 颜色对齐 DESIGN-FINAL（雾蓝主色/渐变/玻璃卡/发丝/danger）',
  tokenBlock.includes('--dshgo-accent: #4B67B4') && tokenBlock.includes('--dshgo-accent-soft: #DEE8FF')
  && tokenBlock.includes('--dshgo-bg-1: #F1F4FB') && tokenBlock.includes('--dshgo-bg-2: #FAFBFE')
  && tokenBlock.includes('--dshgo-surface: #FBFCFF') && tokenBlock.includes('--dshgo-surface-low: #F6F9FE')
  && tokenBlock.includes('--dshgo-ink: #1E232E') && tokenBlock.includes('--dshgo-label: #4F5562')
  && tokenBlock.includes('--dshgo-line: rgba(30, 35, 46, 0.07)')
  && tokenBlock.includes('--dshgo-card: rgba(255, 255, 255, 0.62)')
  && tokenBlock.includes('--dshgo-card-rim: rgba(255, 255, 255, 0.70)')
  && tokenBlock.includes('--dshgo-danger: #A54743'), true);
check('token 间距/栅格对齐 DESIGN-FINAL（8 卡距 / 16 卡内 / 24 组间 / 2 行距 / 页边 16/20）',
  tokenBlock.includes('--dshgo-gap: 8px') && tokenBlock.includes('--dshgo-card-pad: 16px')
  && tokenBlock.includes('--dshgo-group-gap: 24px') && tokenBlock.includes('--dshgo-row-gap: 2px')
  && tokenBlock.includes('--dshgo-page-x: 16px') && tokenBlock.includes('--dshgo-config-page-x: 20px'), true);
check('token 行高/字号/开关/分段/面板上限/安全区对齐 DESIGN-FINAL',
  tokenBlock.includes('--dshgo-row-h: 56px') && tokenBlock.includes('--dshgo-row-h2: 64px')
  && tokenBlock.includes('--dshgo-panel-row: 40px') && tokenBlock.includes('--dshgo-panel-row2: 56px')
  && tokenBlock.includes('--dshgo-font-caption: 12px') && tokenBlock.includes('--dshgo-font-desc: 13px')
  && tokenBlock.includes('--dshgo-font-row: 15px') && tokenBlock.includes('--dshgo-font-value: 16px')
  && tokenBlock.includes('--dshgo-font-title: 26px')
  && tokenBlock.includes('--dshgo-switch-w: 52px') && tokenBlock.includes('--dshgo-switch-h: 32px')
  && tokenBlock.includes('--dshgo-switch-thumb: 28px')
  && tokenBlock.includes('--dshgo-seg-h: 36px') && tokenBlock.includes('--dshgo-seg-thumb: 30px')
  && tokenBlock.includes('--dshgo-control-h: 44px') && tokenBlock.includes('--dshgo-panel-max: 40vh')
  && tokenBlock.includes('--dshgo-hairline: 0.5px')
  && tokenBlock.includes('--dshgo-radius-card: 20px') && tokenBlock.includes('--dshgo-radius-sheet: 28px')
  && tokenBlock.includes('--dshgo-radius-control: 14px') && tokenBlock.includes('--dshgo-radius-segment: 18px')
  && tokenBlock.includes('--dshgo-safe-bottom:'), true);
check('深色 token 由 DSH 外观属性覆盖（同一套门控）',
  tokenBlock.includes(':root[data-dsh-app-layout] body[data-ds-dark-theme]')
  && tokenBlock.includes('--dshgo-accent: #97B1F0') && tokenBlock.includes('--dshgo-danger: #E69089')
  && tokenBlock.includes('--dshgo-bg-1: #1D222C') && tokenBlock.includes('--dshgo-bg-2: #171920')
  && tokenBlock.includes('--dshgo-card: rgba(255, 255, 255, 0.05)'), true);
check('token 块只定义变量、不改任何现有元素视觉（视觉规则单独成块）',
  !/\.(bi|bib)-[a-z]/.test(tokenBlock), true);
check('三列卡：56 高 / 20 圆角 / 纯白卡面 / 0.5 发丝 / 页边 16 / 等间隙分布 / 末列贴右 / 无箭头格',
  visualBlock.includes('.bi-go-strip') && visualBlock.includes('height: 56px')
  && visualBlock.includes('border-radius: var(--dshgo-radius-card, 20px)')
  && visualBlock.includes('background: var(--dshgo-card-bg, #FFFFFF)')
  && tokenBlock.includes('--dshgo-card-bg: #FFFFFF')
  && visualBlock.includes('justify-content: space-between')
  && visualBlock.includes('height: 56px; padding: 0 16px;')
  && visualBlock.includes('max-width: calc((100% - 20px) / 3)')
  && visualBlock.includes('.bi-go-col:last-child') && visualBlock.includes('align-items: flex-end')
  && !visualBlock.includes('bi-go-chev')
  && !visualBlock.includes('.bi-go-col + .bi-go-col::before'), true);
check('宽屏（≥600）卡片与输入框同宽，只调内边距，不缩版心',
  visualBlock.includes('@media (min-width: 600px) {')
  && !visualBlock.includes('max-width: 560px')
  && visualBlock.includes('padding: 0 20px')
  && visualBlock.includes('padding: 0 20px 20px;'), true);
check('宽屏增量列按档位递进（760 / 960 / 1180），手机档不占位',
  visualBlock.includes('.bi-go-col[data-extra]') && visualBlock.includes('display: none')
  && visualBlock.includes('@media (min-width: 760px)') && visualBlock.includes('[data-extra="1"]')
  && visualBlock.includes('@media (min-width: 960px)') && visualBlock.includes('[data-extra="2"]')
  && visualBlock.includes('@media (min-width: 1180px)') && visualBlock.includes('[data-extra="3"]'), true);
check('档位让 1024 / 1280 两个常见窗口各落进正确档位（1040 会把 1024 卡在门外）',
  !visualBlock.includes('@media (min-width: 1040px)')
  && !visualBlock.includes('@media (min-width: 1320px)'), true);
check('宽屏展开面板变双栏（把宽度换成信息密度，而不是把行拉长）',
  visualBlock.includes('grid-template-columns: calc(50% - 22px) calc(50% - 22px)'), true);
check('窄屏断点不再要求触屏（只按宽度分档）',
  visualBlock.includes('@media (max-width: 360px) {') && !visualBlock.includes('and (max-width: 360px)'), true);
check('面板标题行只留「刷新」一个动作：15/600 accent，无重复的「收起」按钮（点信息栏本体收起）',
  clientSrc.includes("className: 'bi-go-act'")
  && clientSrc.includes("t('ui.refresh')")
  && !clientSrc.includes("className: 'bi-go-sheet-collapse'")
  && !clientSrc.includes("className: 'bi-go-head-acts'")
  && visualBlock.includes('color: var(--dshgo-accent)')
  && visualBlock.includes('.bi-go-act'), true);
check('面板：28 圆角 / 40vh 内滚 / 行间 2px 空隙 / 分组 16 / 无行分割线 / 动作行无上边框',
  visualBlock.includes('border-radius: var(--dshgo-radius-sheet, 28px)')
  && visualBlock.includes('max-height: var(--dshgo-panel-max, 40vh)')
  && visualBlock.includes('gap: var(--dshgo-row-gap, 2px)')
  && visualBlock.includes('margin-top: var(--dshgo-section-gap, 16px)')
  && !visualBlock.includes('.bi-go-row + .bi-go-row')
  && !visualBlock.includes('border-top'), true);
check('三列卡数值：caption 12/500、value 16/600、tabular-nums、长金额缩字号、窗口 progress 4px',
  visualBlock.includes('font-size: var(--dshgo-font-caption, 12px)')
  && visualBlock.includes('font-size: var(--dshgo-font-value, 16px)')
  && visualBlock.includes('font-variant-numeric: tabular-nums')
  && visualBlock.includes('.bi-go-val--shrink') && visualBlock.includes('font-size: 11px; letter-spacing: -0.5px;')
  && visualBlock.includes('.bi-go-bar') && visualBlock.includes('height: 4px'), true);

// ---------- R1（2026-11-13）：缺额度凭据的配置引导必须到达 DSH Go 卡与面板 ----------
// 桌面缺凭据（sub.error no-key + params.setup=plugin）走 subscriptionSetupHint，给「打开插件设置 →
// 额度凭据填写」的可自助引导。Go 三列卡此前误显示「账号未登录」、面板只给通用「请重新授权」，
// 对缺 AK/SK 无效。修复后：卡列显「未配置」，面板提醒行优先用 setup 引导文案。
check('Go 卡第 1 列：缺插件凭据时显「未配置」而非「账号未登录」',
  clientSrc.includes("sub && sub.error && subscriptionSetupHint(sub.error)")
  && clientSrc.includes("goSlots.push({ key: 'setup', caption: t('ui.account'), value: t('ui.credentialNotConfigured') });"), true);
check('Go 面板提醒行：缺凭据优先用 subscriptionSetupHint 文案，不退回通用「请重新授权」',
  clientSrc.includes('const subSetupHint = subscriptionSetupHint(renderedState.sub.error);')
  && clientSrc.includes('v: subSetupHint ? subSetupHint.text : subscriptionFailureHint(renderedState.sub.error'), true);
check('配置引导复用既有 13 语言键，不新造文案（credentialNotConfigured / quotaCredentialSetupText）',
  clientSrc.includes("t('ui.credentialNotConfigured')") && clientSrc.includes('subSetupHint.text'), true);

// ---------- R2（2026-11-13）：接手时收尾的门控修复 ----------
// ① Go 设置页更新卡：updateState 还没读到（首屏 / 旧宿主没有 getUpdateState）时，
//   不能把「无状态」渲染成「检查更新没成功」，也不能摆出会报错的更新动作。
check('Go 更新卡：读不到状态时按「旧宿主错误 / 加载中」分流，不谎报检查失败',
  clientSrc.includes('const upNull = deps.updateState == null;')
  && clientSrc.includes("? React.createElement(BibSetGoRow, { title: deps.updateError ? t('ui.versionUnavailable') : t('ui.loadingInfoBarSettings') })")
  && clientSrc.includes('upNull ? null : upErrorRow')
  && clientSrc.includes('upNull ? null : upModeRow')
  && clientSrc.includes('upNull ? null : upFallbackRow')
  && clientSrc.includes('upNull ? null : upActionBar'), true);
check('Go 更新卡空态复用既有 13 语言键（versionUnavailable / loadingInfoBarSettings）',
  clientSrc.includes("t('ui.versionUnavailable')") && clientSrc.includes("t('ui.loadingInfoBarSettings')"), true);

// ② Go 三列卡 / 展开面板与桌面共用同一套字段显隐：用户关掉的字段不能在 Go 表面继续出现。
check('Go 三列卡：本月花费列受 billingSpend 开关约束（与桌面 pushBillingGroups 一致）',
  clientSrc.includes('// 本月花费列受设置页 billingSpend 开关约束')
  && clientSrc.includes("if (fieldVisible('billingSpend')) {"), true);
check('Go 三列卡：余额列受 balance 开关约束（含「账户 —」占位也一并隐藏）',
  clientSrc.includes("if (bal && bal.data && fieldVisible('balance')) {")
  && clientSrc.includes("} else if (fieldVisible('balance')) {"), true);
check('Go 面板：额度窗口的重置倒计时受 resetCountdown 开关约束',
  clientSrc.includes("small: (w.resetsAt && fieldVisible('resetCountdown')) ? fmtResetCountdown(w.resetsAt - now) : null"), true);
check('Go 面板：本会话 / 今天 / 近 30 天花费各自受 sessionCost / todaySpend / last30dSpend 约束',
  clientSrc.includes("if (costCNY != null || costUSD != null) { if (fieldVisible('sessionCost')) spendRows.push(")
  && clientSrc.includes("if (usg.todaySpend != null && fieldVisible('todaySpend')) spendRows.push(")
  && clientSrc.includes("if (usg.last30dSpend != null && fieldVisible('last30dSpend')) spendRows.push("), true);

// ③ 订阅制多窗口：三列卡每列 key 必须带窗口名，否则 React 复用同一 key 会让窗口数据串位。
check('Go 三列卡：额度窗口列 key 带窗口名（多窗口不同列不串数据）',
  clientSrc.includes("return { key: 'quota-' + w.key, caption: compactWindowLabel(w.key)"), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
