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
check('触屏整栏点击展开明细，桌面仍切换密度',
  clientSrc.includes('if (touchDetails) {') && clientSrc.includes('setDetailsOpen(function (open) { return !open; });')
  && clientSrc.includes('props.onToggleDensity();'), true);
check('触屏根节点如实暴露 aria-expanded，并去掉无用的 hover title',
  clientSrc.includes("'aria-expanded': touchDetails ? detailsOpen : undefined")
  && clientSrc.includes('title: touchDetails ? undefined :'), true);
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
const tokenStart = css.indexOf('--dshgo-accent');
const gateStart = css.indexOf('@media (pointer: coarse)');
check('token 层只存在于 pointer:coarse 门控内（桌面不生效）',
  gateStart > 0 && tokenStart > gateStart, true);
const tokenBlock = css.slice(gateStart, css.indexOf('/* 字段级颜色消费规则', gateStart));
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
check('门控块只定义变量、不改任何现有元素视觉（准备阶段不换皮）',
  !/\.(bi|bib)-[a-z]/.test(tokenBlock), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
