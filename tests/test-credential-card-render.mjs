// 设置页「额度凭据」卡真实 React 渲染冒烟测试（2026-11-12，v1.24.1 事故防线）
// 背景：v1.24.1 的折叠卡把 React.useState 写在「普通函数内联调用」里，hooks 实际挂在父组件上，
// 父渲染路径一变计数就漂移 → React error #310 → 整页设置崩。当时的全量测试全是字符串断言，
// 没有任何真实渲染，所以 CI 全绿照样翻车。本测试用 react-test-renderer 真渲染四轮
// （状态缺 → 到达 → 又缺 → 到达），hooks 契约错误在这里直接炸出来；另验 ErrorBoundary 收敛。
// 结构（2026-11-12 二次收紧）：目录只留阿里百炼一组 inline 凭据 → 卡片头为各区块同款 static 头
// （动态摘要做说明），阿里两行 fieldblock 直接渲染，不再有任何组折叠；非 inline 服务商
// （复用推理 Key / 登录态）绝不出现在卡里。断言按该结构写。
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
vm.runInNewContext(clientSrc + '\n;__testHook({ bibCredentialsCard, bibCredentialsErrorBoundary, bibSetCredentialsSection, bibSetDisclosure, t });', sandbox, { filename: 'src/client-bundle.js' })
check('S1 沙箱装载成功且导出凭据卡与体系折叠符号',
  [typeof hook.api.bibCredentialsCard, typeof hook.api.bibCredentialsErrorBoundary, typeof hook.api.bibSetCredentialsSection, typeof hook.api.bibSetDisclosure],
  ['function', 'function', 'function', 'function'])

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
  bound: 1,
  total: 1,
  kimiLogin: { configured: true },
  items: [],
  groups: [
    { id: 'alibaba', labelKey: 'ui.qwenTokenPlan', label: null, mode: 'subscription', bound: true,
      credentials: [
        { ref: 'ALIBABA_CLOUD_ACCESS_KEY_ID', labelKey: 'ui.credentialAlibabaIdLabel', hintKey: 'ui.credentialAlibabaIdHint', configured: true, source: 'file', writable: true },
        { ref: 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', labelKey: 'ui.credentialAlibabaSecretLabel', hintKey: 'ui.credentialAlibabaHint', configured: false, source: null, writable: true },
      ] },
  ],
}
// 未绑定态（阿里 AccessKey 还没填）：卡片头说明位应显示「未检测到已绑定的额度凭据」。
const NONE_STATE = {
  canWrite: true,
  bound: 0,
  total: 1,
  kimiLogin: { configured: false },
  items: [],
  groups: [
    { id: 'alibaba', labelKey: 'ui.qwenTokenPlan', label: null, mode: 'subscription', bound: false,
      credentials: FULL_STATE.groups[0].credentials.map(function (c) { return Object.assign({}, c, { configured: false, source: null }) }) },
  ],
}

// 按「渲染实例树」拍平：TestInstance.children 才是渲染后的输出（root.props.children 是原始元素）
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
function credentialInputIds(view) {
  return view.findAll(function (node) { return node.type === 'input' && typeof node.props.id === 'string' && node.props.id.indexOf('bib-set-credential-') === 0 })
    .map(function (node) { return node.props.id.slice('bib-set-credential-'.length) })
}
// 体系折叠头：bibSetDisclosure 的 button[aria-controls=<contentId>]
function disclosureHead(view, contentId) {
  return view.findAll(function (node) { return node.type === 'button' && node.props['aria-controls'] === contentId })[0]
}
function collapseBox(view, contentId) {
  return view.findAll(function (node) { return node.props && node.props.id === contentId })[0]
}
function staticHeader(view) {
  return view.findAll(function (node) { return node.type === 'div' && typeof node.props.className === 'string' && node.props.className.indexOf('bib-set-card-header') >= 0 })[0]
}

// ---- 四轮渲染：状态缺 → 到达 → 又缺 → 到达。hooks 计数漂移（#310 场景）在这里直接炸 ----
const sectionEl = function (state) { return React.createElement(hook.api.bibSetCredentialsSection, Object.assign({ credentialState: state }, stubHandlers)) }
let renderer = null
let renderError = null
try {
  TestRenderer.act(function () {
    renderer = TestRenderer.create(sectionEl(null))
    renderer.update(sectionEl(FULL_STATE))
    renderer.update(sectionEl(null))
    renderer.update(sectionEl(FULL_STATE))
  })
} catch (err) { renderError = err }
check('R1 四轮渲染（状态缺→到达→又缺→到达）不抛 hooks 契约错误（#310 场景复现）', renderError ? renderError.message : null, null)

const tt = hook.api.t

// ---- 卡片态：卡片头是各区块同款 static 头（div，非 button），摘要进 description ----
const headerNode = staticHeader(renderer.root)
const headerText = headerNode ? flattenInstanceText(headerNode) : ''
const summaryText = tt('ui.credentialSummaryBound', { count: 1, names: tt('ui.qwenTokenPlan') })
check('R2 卡片头为 static 头（非折叠按钮）且摘要（已绑定 N 个服务商）在说明位',
  [!!headerNode, typeof headerNode.props.onClick, headerText.indexOf(summaryText) >= 0],
  [true, 'undefined', true])
check('R2b 阿里两行凭据直接渲染、无需任何展开交互（卡内已无组折叠）',
  credentialInputIds(renderer.root), ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET'])
check('R2c 复用推理 Key 的服务商（Kimi/MiniMax）绝不出现在卡里',
  ['KIMI_API_KEY', 'MINIMAX_API_KEY'].map(function (ref) { return credentialInputIds(renderer.root).indexOf(ref) >= 0 }),
  [false, false])

// ---- 未绑定态：说明位切换为「未检测到已绑定的额度凭据」，输入行仍在（用户要填的就是它） ----
TestRenderer.act(function () { renderer.update(sectionEl(NONE_STATE)) })
const noneHeaderText = staticHeader(renderer.root) ? flattenInstanceText(staticHeader(renderer.root)) : ''
check('R3 未绑定时摘要切换为「未检测到」且阿里填写行保持可见',
  [noneHeaderText.indexOf(tt('ui.credentialSummaryNone')) >= 0, credentialInputIds(renderer.root).length],
  [true, 2])
TestRenderer.act(function () { renderer.update(sectionEl(FULL_STATE)) })

// ---- 老宿主 fallback：state=null 仍列出目录 inline 凭据（阿里两行） ----
TestRenderer.act(function () { renderer.update(sectionEl(null)) })
check('R6 老宿主（state=null）仍列出目录 inline 凭据（阿里 AccessKey 两项）',
  credentialInputIds(renderer.root), ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET'])

// ---- ErrorBoundary：卡内崩溃收敛成警示条，不外抛 ----
const Boom = function () { throw new Error('boom-for-boundary-test') }
let boundaryRenderer = null
let boundaryError = null
try {
  TestRenderer.act(function () {
    boundaryRenderer = TestRenderer.create(React.createElement(hook.api.bibCredentialsErrorBoundary, { key: 'x' }, React.createElement(Boom, null)))
  })
} catch (err) { boundaryError = err }
const crashText = boundaryRenderer ? flattenInstanceText(boundaryRenderer.root) : ''
check('B1 卡内崩溃不外抛且收敛为警示条（credentialCardCrashed 文案）',
  [boundaryError ? boundaryError.message : null,
    crashText.indexOf(tt('ui.credentialCardCrashed')) >= 0],
  [null, true])

console.log('渲染冒烟结果：' + passed + ' passed, ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
