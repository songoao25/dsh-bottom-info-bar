// 信息栏两行节奏审计（防复发：2026-09-23「完整/简洁模式偶发两行间距异常扩大」）
//
// 根因：收合行原本用 fr 轨道（grid-template-rows: 1fr / 0fr）做高度动画。fr 轨道会吸收
// 容器的「自由空间」——一旦祖先被拉伸、被设成定高，或本节点被 flex 拉伸，那段自由空间
// 就正好落在两行之间，表现为「文字仍贴着行首、下面凭空多出一段空白」。真实浏览器实测复现：
//   .bi-root{display:flex;height:90px} + .bi-density-extra{flex:1} → 行间空隙 45px
//   .bi-root{display:grid;height:90px}                          → 行间空隙 22.5px
//   .bi-density-extra{height:40px}                              → 行间空隙 20px
// 修法（本测试锁定）：高度改成「确定值」——full = 原生行实测高度（--bi-extra-h，默认一行），
// compact = 0px；根节点与两行都加 flex/拉伸护栏；宽度取宿主内容宽度令牌，避免版式随内容抖动。
// 用法：node tests/test-info-bar-rhythm.js
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

// ---------- 取插件信息栏样式表（installStyles 的模板字符串） ----------
const marker = 'style.textContent = `';
const cssStart = clientSrc.indexOf(marker);
check('源码中能定位到信息栏样式表模板', cssStart > 0, true);
const cssEnd = clientSrc.indexOf('` + FIELD_COLOR_CSS', cssStart);
const css = clientSrc.slice(cssStart + marker.length, cssEnd);

// 取某条规则的声明块（选择器必须原样出现在样式表里）
function declarations(selector) {
  const at = css.indexOf(selector + ' {');
  if (at < 0) return null;
  const end = css.indexOf('}', at);
  return css.slice(at + selector.length + 2, end);
}
function has(sel, snippet) {
  const d = declarations(sel);
  return d !== null && d.includes(snippet);
}
const FR = /[0-9.]+fr/;

// ---------- 1) 收合行：确定高度，绝不用 fr ----------
const extraSel = '.bi-root > .bi-density-extra';
check('收合行规则存在', declarations(extraSel) !== null, true);
check('收合行高度用 --bi-extra-h（确定值）', has(extraSel, 'height: var(--bi-extra-h)'), true);
check('收合行裁剪溢出（收起时不留残影）', has(extraSel, 'overflow: hidden'), true);
check('收合行不参与 flex 伸缩（防被祖先拉伸）', has(extraSel, 'flex: none'), true);
check('收合行不含 grid-template-rows', has(extraSel, 'grid-template-rows'), false);
check('收合行不含任何 fr 单位', FR.test(declarations(extraSel) || ''), false);
check('收合行动画的是确定高度', has(extraSel, 'transition: height'), true);

const compactSel = '.bi-root[data-density="compact"] > .bi-density-extra';
check('简洁模式收合到 0px（确定值，不是 0fr）', has(compactSel, 'height: 0px'), true);
check('简洁模式不残留 fr 写法', FR.test(declarations(compactSel) || ''), false);
check('减少动态效果时关闭过渡', css.includes('@media (prefers-reduced-motion: reduce) { .bi-density-extra { transition: none; } }'), true);

// 语义断言：收合的两个端点都必须是可插值的确定长度
const extraDecl = declarations(extraSel) || '';
const compactDecl = declarations(compactSel) || '';
check('full 端点高度是长度（px / var），不是 auto/max-content',
  /height:\s*(var\(--bi-extra-h\)|[0-9.]+px)/.test(extraDecl), true);
check('compact 端点高度是 0px', /height:\s*0px/.test(compactDecl), true);

// ---------- 2) 根节点：单一节奏令牌 + 防拉伸 + 确定宽度 ----------
const rootDecl = declarations('.bi-root') || '';
check('节奏单位 --bi-line: 20px 定义在根节点', rootDecl.includes('--bi-line: 20px'), true);
check('收合高度默认取一行（--bi-extra-h: var(--bi-line)）', rootDecl.includes('--bi-extra-h: var(--bi-line)'), true);
check('行高引用同一令牌（不再散落魔法数字）', rootDecl.includes('line-height: var(--bi-line)'), true);
check('根节点是 column flex（行序与纵向排布由容器决定）', rootDecl.includes('display: flex') && rootDecl.includes('flex-direction: column'), true);
check('两行之间不设 gap（间距恒为 0）', rootDecl.includes('gap: 0'), true);
check('多余高度只落到第一行之上（flex 侧）', rootDecl.includes('justify-content: flex-end'), true);
check('多余高度只落到第一行之上（grid 侧）', rootDecl.includes('align-content: end'), true);
check('防拉伸：align-self: center', rootDecl.includes('align-self: center'), true);
check('防定高：height: auto', rootDecl.includes('height: auto'), true);
check('宽度取宿主内容宽度令牌（确定值）', rootDecl.includes('width: var(--dsh-chat-content-width, 100%)'), true);
check('宽度仍受可用空间约束', rootDecl.includes('max-width: 100%'), true);

// ---------- 3) 两行本身：不伸缩、无纵向 margin/padding ----------
const row2Decl = declarations('.bi-root > .bi-row2') || '';
check('主行不参与 flex 伸缩', row2Decl.includes('flex: none'), true);
check('主行无纵向 margin', /margin(-top|-bottom)?\s*:/.test(row2Decl), false);
check('主行无纵向 padding', /padding(-top|-bottom)?\s*:/.test(row2Decl), false);
check('原生统计行仍可折行（窄宽度不裁切内容）', has('.bi-native-row', 'flex-wrap: wrap'), true);

// ---------- 4) 整张信息栏样式表里不得再有 fr 轨道 ----------
// 逐条解析「选择器 { 声明 }」，只看命中 .bi-* 的规则（设置页 .bib-set-* 的折叠面板是另一套
// 语义：内容高度本来就可变，且不在固定 20px 节奏里，不在此断言范围）。
const barRules = [];
const ruleRe = /([^{}]*)\{([^{}]*)\}/g;
let match;
while ((match = ruleRe.exec(css)) !== null) {
  const selector = match[1].trim();
  if (/(^|[,\s>])\.bi-[a-z]/.test(selector)) barRules.push({ selector: selector, body: match[2] });
}
check('样式表解析出信息栏规则（防止断言空转）', barRules.length > 20, true);
const frRules = barRules.filter(r => FR.test(r.body));
check('信息栏规则中不存在 fr 轨道写法' + (frRules.length ? '（' + frRules.map(r => r.selector).join(' / ') + '）' : ''), frRules.length, 0);

// ---------- 5) 客户端实现：实测原生行高度并写入 --bi-extra-h ----------
check('收合行挂上 ref（供实测）', clientSrc.includes("className: 'bi-density-extra', ref: extraRowRef"), true);
check('不再有中间层 bi-density-extra-inner（少一层就可能多一处空隙）', clientSrc.includes('bi-density-extra-inner'), false);
check('实测原生行高度', clientSrc.includes('getBoundingClientRect().height'), true);
check('把实测高度写进 --bi-extra-h', clientSrc.includes("setProperty('--bi-extra-h'"), true);
check('用 ResizeObserver 跟随折行/缩放', clientSrc.includes('new ResizeObserver(sync)'), true);
check('React shim 缺 useLayoutEffect 时退回 useEffect', clientSrc.includes("typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect"), true);
check('测量在渲染早退之前（hooks 顺序稳定）',
  clientSrc.indexOf('const row1Present = row1 !== null;') < clientSrc.indexOf('if (infoBarShouldRemoveAll(FIELD_REGISTRY, fieldVisible)'), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
