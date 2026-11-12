// 设置页「额度凭据」折叠卡真实 React 渲染冒烟测试（2026-11-12，v1.24.1 事故防线）
// 背景：v1.24.1 的折叠卡把 React.useState 写在「普通函数内联调用」里，hooks 实际挂在父组件上，
// 父渲染路径一变计数就漂移 → React error #310 → 整页设置崩。当时的全量测试全是字符串断言，
// 没有任何真实渲染，所以 CI 全绿照样翻车。本测试用 react-test-renderer 真渲染四轮
// （状态缺 → 到达 → 又缺 → 到达），hooks 契约错误在这里直接炸出来；另验 ErrorBoundary 收敛。
// 用法：node tests/test-credential-card-render.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { CREDENTIAL_CATALOG } from '../src/constants.js'

const projectRoot = join(new URL('.', import.meta.url).pathname, '..')
let passed = 0
let failed = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { passed++; console.log('PASS  ' + name) }
  else { failed++; console.log('FAIL  ' + name + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)) }
}

// ---- 沙箱装载 src/client-bundle.js（测真身，不是构建产物）----
// 构建期注入的 LOCALES 标记就地补齐；目录常量用真正的 src/constants.js（单一生源）。
// require 只放行 react：宿主 seed 模块（primitives / react-dom）在真宿主缺失时同样走 try/catch 兜底。
let clientSrc = readFileSync(join(projectRoot, 'src', 'client-bundle.js'), 'utf8')
const localesSrc = readFileSync(join(projectRoot, 'src', 'locales.js'), 'utf8')
const localesMarker = 'export const LOCALES ='
const LOCALES = JSON.parse(localesSrc.slice(localesSrc.indexOf(localesMarker) + localesMarker.length).trim().replace(/;$/, ''))
clientSrc = clientSrc.replace('const LOCALES = /*__LOCALES__*/{};', 'const LOCALES = ' + JSON.stringify(LOCALES) + ';')
clientSrc = clientSrc.replace('const CREDENTIAL_CATALOG = /*__CREDENTIAL_CATALOG__*/[];', 'const CREDENTIAL_CATALOG = ' + JSON.stringify(CREDENTIAL_CATALOG) + ';')
// 语言运行时同为构建期注入（createLanguageRuntime.toString()），就地补齐后沙箱才能初始化 t()
const rtSrc = readFileSync(join(projectRoot, 'src', 'language-runtime.js'), 'utf8')
const rtMarker = 'export function createLanguageRuntime'
clientSrc = clientSrc.replace('/*__LANGUAGE_RUNTIME__*/', () => rtSrc.slice(rtSrc.indexOf(rtMarker)).trim().replace(/;$/, '').replace(/^export /, ''))

const hook = { api: null }
const sandboxRequire = function (name) {
  if (name === 'react') return React
  throw new Error('seed module unavailable in test sandbox: ' + name)
}
const sandbox = {
  React,
  require: sandboxRequire,
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  module: { exports: {} },
  exports: {},
  __testHook: function (api) { hook.api = api },
}
vm.runInNewContext(clientSrc + '\n;__testHook({ bibCredentialsCard, bibCredentialsErrorBoundary, bibSetCredentialsSection, t });', sandbox, { filename: 'src/client-bundle.js' })
check('S1 沙箱装载成功且导出三个凭据卡符号',
  [typeof hook.api.bibCredentialsCard, typeof hook.api.bibCredentialsErrorBoundary, typeof hook.api.bibSetCredentialsSection],
  ['function', 'function', 'function'])

const stubHandlers = {
  onCredentialDraft: function () {},
  onCredentialSave: function () {},
  onCredentialClear: function () {},
  credentialDrafts: {},
  credentialBusyRef: null,
  credentialFeedback: null,
}
const FULL_STATE = {
  canWrite: true,
  bound: 2,
  total: 6,
  kimiLogin: { configured: true },
  items: [],
  groups: [
    { id: 'kimi-coding', labelKey: 'ui.kimiCoding', label: null, mode: 'subscription', bound: true,
      credentials: [{ ref: 'KIMI_API_KEY', labelKey: 'ui.credentialKimiKeyLabel', hintKey: 'ui.credentialKimiHint', configured: true, source: 'file', writable: true }] },
    { id: 'minimax', labelKey: 'ui.minimax', label: null, mode: 'subscription', bound: true,
      credentials: [{ ref: 'MINIMAX_API_KEY', labelKey: null, hintKey: null, configured: true, source: 'env', writable: false }] },
    { id: 'alibaba', labelKey: 'ui.qwenTokenPlan', label: null, mode: 'subscription', bound: false,
      credentials: [
        { ref: 'ALIBABA_CLOUD_ACCESS_KEY_ID', labelKey: 'ui.credentialAlibabaIdLabel', hintKey: 'ui.credentialAlibabaIdHint', configured: false, source: null, writable: true },
        { ref: 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', labelKey: 'ui.credentialAlibabaSecretLabel', hintKey: 'ui.credentialAlibabaHint', configured: false, source: null, writable: true },
      ] },
  ],
}

function flattenText(node) {
  let out = ''
  const walk = function (n) {
    if (!n) return
    if (typeof n === 'string') { out += n; return }
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (n.props && typeof n.props.children !== 'undefined') walk(n.props.children)
  }
  walk(node)
  return out
}
// 实例树拍平：TestInstance.children 才是渲染后的输出（root.props.children 是原始元素，
// 对根实例拍平会拿到未渲染的 children —— B1 之前就栽在这里）。
function flattenInstanceText(inst) {
  let out = ''
  const walk = function (n) {
    if (n === null || n === undefined || n === false) return
    if (typeof n === 'string' || typeof n === 'number') { out += String(n); return }
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (n.children) walk(n.children)
  }
  walk(inst)
  return out
}
function findHeader(view) {
  return view.findAll(function (node) { return node.type === 'button' && node.props['aria-controls'] === 'bib-set-credentials-body' })[0]
}

// ---- 四轮渲染：状态缺 → 到达 → 又缺 → 到达。hooks 计数漂移（#310 场景）在这里直接炸 ----
const sectionEl = function (state) { return React.createElement(hook.api.bibSetCredentialsSection, Object.assign({ credentialState: state }, stubHandlers)) }
let renderer = null
let renderError = null
try {
  renderer = TestRenderer.create(sectionEl(null))
  renderer.update(sectionEl(FULL_STATE))
  renderer.update(sectionEl(null))
  renderer.update(sectionEl(FULL_STATE))
} catch (err) { renderError = err }
check('R1 四轮渲染（状态缺→到达→又缺→到达）不抛 hooks 契约错误（#310 场景复现）', renderError ? renderError.message : null, null)

// ---- 折叠态：默认收起（body hidden），折叠头是 button ----
const headerButton = findHeader(renderer.root)
const bodyNodes = renderer.root.findAll(function (node) { return node.props && node.props.id === 'bib-set-credentials-body' })
check('R2 折叠头是 button 且默认折叠（aria-expanded=false + body hidden）',
  [!!headerButton, headerButton.props['aria-expanded'], bodyNodes[0].props.hidden === true], [true, false, true])

// ---- 展开：点击折叠头 → body 显示引导文案 + bound 组直接渲染 + 其他服务商折叠按钮 ----
headerButton.props.onClick()
const body2 = renderer.root.findAll(function (node) { return node.props && node.props.id === 'bib-set-credentials-body' })[0]
const textBody = flattenInstanceText(body2)
const tt = hook.api.t
const guideText = tt('ui.credentialGuide')
const othersText = tt('ui.credentialOthers', { count: 1 })
function credentialInputIds(view) {
  return view.findAll(function (node) { return node.type === 'input' && typeof node.props.id === 'string' && node.props.id.indexOf('bib-set-credential-') === 0 })
    .map(function (node) { return node.props.id.slice('bib-set-credential-'.length) })
}
check('R3 展开后 body 显示、含顶部引导与 bound 组凭据输入框',
  [body2.props.hidden === true,
    textBody.indexOf(guideText) >= 0,
    credentialInputIds(renderer.root).indexOf('KIMI_API_KEY') >= 0,
    textBody.indexOf(othersText) >= 0],
  [false, true, true, true])
// ---- bound 排前：bound 组输入框直接出现，未绑定组要点开「其他服务商」才渲染 ----
const othersButton = renderer.root.findAll(function (node) { return node.type === 'button' && typeof node.props.children === 'string' && node.props.children.indexOf(othersText) >= 0 })[0]
check('R4 其他服务商按钮带计数（展开态文案）',
  [!!othersButton, othersButton.props.children.indexOf(tt('ui.expand')) >= 0], [true, true])
othersButton.props.onClick()
const idsAfterOthers = credentialInputIds(renderer.root)
check('R4 展开其他服务商后输入框顺序 = bound 组在前、未绑定组在后',
  [idsAfterOthers.slice(0, 2), idsAfterOthers.slice(2)],
  [['KIMI_API_KEY', 'MINIMAX_API_KEY'], ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET']])

function boundNamesJoined() {
  return ['kimi-coding', 'minimax'].map(function (id) {
    const g = FULL_STATE.groups.filter(function (x) { return x.id === id })[0]
    return g.labelKey ? tt(g.labelKey) : g.label
  }).join('、')
}

// ---- 摘要：标题行 = 已绑定 N 个服务商 ----
const header2 = findHeader(renderer.root)
const headerText = flattenText(header2)
const summaryText = tt('ui.credentialSummaryBound', { count: 2, names: boundNamesJoined() })
check('R5 摘要 = 已绑定 N 个服务商（摘要含服务商名列表）',
  [headerText.indexOf(summaryText) >= 0,
    headerText.indexOf('Kimi') >= 0 || headerText.indexOf('MiniMax') >= 0],
  [true, true])

// ---- ErrorBoundary：卡内崩溃收敛成警示条，不外抛 ----
const Boom = function () { throw new Error('boom-for-boundary-test') }
let boundaryRenderer = null
let boundaryError = null
try {
  boundaryRenderer = TestRenderer.create(React.createElement(hook.api.bibCredentialsErrorBoundary, { key: 'x' }, React.createElement(Boom, null)))
} catch (err) { boundaryError = err }
const crashText = boundaryRenderer ? flattenInstanceText(boundaryRenderer.root) : ''
check('B1 卡内崩溃不外抛且收敛为警示条（credentialCardCrashed 文案）',
  [boundaryError ? boundaryError.message : null,
    crashText.indexOf(tt('ui.credentialCardCrashed')) >= 0],
  [null, true])

// ---- 老宿主 fallback：state=null 展开后仍列出目录 inline 凭据（none-bound 时自动展开其他组） ----
renderer.update(sectionEl(null))
const fallbackHeader = findHeader(renderer.root)
fallbackHeader.props.onClick()
const fallbackIds = credentialInputIds(renderer.root)
check('R6 老宿主（state=null）展开后仍列出目录 inline 凭据',
  ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'KIMI_API_KEY'].every(function (ref) { return fallbackIds.indexOf(ref) >= 0 }), true)

console.log('渲染冒烟结果：' + passed + ' passed, ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
