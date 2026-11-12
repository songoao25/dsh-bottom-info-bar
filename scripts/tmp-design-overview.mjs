// 设计概览 harness（临时脚本，验收后删除）：
// 用真实 client-bundle 挂载全部设置区块 + 真实 CSS + DSH 0.2.2 暗色 token，
// 生成一张单页概览 HTML，供 Playwright 截长图给用户验收设计。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { CREDENTIAL_CATALOG } from '../src/constants.js'
import * as CONSTANTS from '../src/constants.js'

const projectRoot = join(new URL('.', import.meta.url).pathname, '..')
let clientSrc = readFileSync(join(projectRoot, 'src', 'client-bundle.js'), 'utf8')
const localesSrc = readFileSync(join(projectRoot, 'src', 'locales.js'), 'utf8')
const localesMarker = 'export const LOCALES ='
const LOCALES = JSON.parse(localesSrc.slice(localesSrc.indexOf(localesMarker) + localesMarker.length).trim().replace(/;$/, ''))
clientSrc = clientSrc.replace('const LOCALES = /*__LOCALES__*/{};', 'const LOCALES = ' + JSON.stringify(LOCALES) + ';')
clientSrc = clientSrc.replace('const CREDENTIAL_CATALOG = /*__CREDENTIAL_CATALOG__*/[];', 'const CREDENTIAL_CATALOG = ' + JSON.stringify(CREDENTIAL_CATALOG) + ';')
// 字段注册表等构建期注入（fieldGroups 分组渲染需要）—— 与 src/client-bundle.js 的声明逐字对应
function injectConst(src, name, value) {
  const decl = 'const ' + name + ' = /*__' + name + '__*/' + (name === 'FIELD_GROUP_LABELS' ? '{}' : '[]') + ';'
  if (src.indexOf(decl) === -1) throw new Error('marker not found: ' + name)
  return src.replace(decl, 'const ' + name + ' = ' + JSON.stringify(value) + ';')
}
clientSrc = injectConst(clientSrc, 'FIELD_REGISTRY', CONSTANTS.FIELD_REGISTRY)
clientSrc = injectConst(clientSrc, 'FIELD_GROUP_ORDER', CONSTANTS.FIELD_GROUP_ORDER)
clientSrc = injectConst(clientSrc, 'FIELD_GROUP_LABELS', CONSTANTS.FIELD_GROUP_LABELS)
clientSrc = injectConst(clientSrc, 'FIELD_SECTIONS', CONSTANTS.FIELD_SECTIONS)
clientSrc = injectConst(clientSrc, 'PRESET_COLORS', CONSTANTS.PRESET_COLORS)
if (clientSrc.indexOf('var SUBSCRIPTION_PROVIDERS = /*__SUBSCRIPTION_PROVIDERS__*/[];') >= 0) {
  clientSrc = clientSrc.replace('var SUBSCRIPTION_PROVIDERS = /*__SUBSCRIPTION_PROVIDERS__*/[];', 'var SUBSCRIPTION_PROVIDERS = ' + JSON.stringify(CONSTANTS.SUBSCRIPTION_PROVIDERS || []) + ';')
}
if (clientSrc.indexOf('var BILLING_PROVIDERS = /*__BILLING_PROVIDERS__*/[];') >= 0) {
  clientSrc = clientSrc.replace('var BILLING_PROVIDERS = /*__BILLING_PROVIDERS__*/[];', 'var BILLING_PROVIDERS = ' + JSON.stringify(CONSTANTS.BILLING_PROVIDERS || []) + ';')
}
clientSrc = clientSrc.replace('/*__HOST_TEXT__*/', 'function localizeHostText(message) { return typeof message === "string" ? message : ""; }')
const rtSrc = readFileSync(join(projectRoot, 'src', 'language-runtime.js'), 'utf8')
const rtMarker = 'export function createLanguageRuntime'
clientSrc = clientSrc.replace('/*__LANGUAGE_RUNTIME__*/', () => rtSrc.slice(rtSrc.indexOf(rtMarker)).trim().replace(/;$/, '').replace(/^export /, ''))

const capturedStyles = []
const fakeDocument = {
  createElement(tag) { return { tagName: tag, style: { setProperty() {}, }, dataset: {}, textContent: '' } },
  head: { appendChild(el) { capturedStyles.push(el.textContent) } },
  body: { appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {}, dataset: {} },
  documentElement: { dataset: {}, style: { setProperty() {} } },
  querySelector() { return null },
  querySelectorAll() { return [] },
  getElementById() { return null },
  addEventListener() {}, removeEventListener() {},
}

const hook = { api: null }
const sandbox = {
  React,
  require: (n) => { if (n === 'react') return React; throw new Error('no ' + n) },
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  document: fakeDocument,
  module: { exports: {} }, exports: {},
  __testHook: (api) => { hook.api = api },
}
vm.runInNewContext(clientSrc + '\n;__testHook({ t, bibSetLanguagePicker, bibSetTimeDateSection, bibSetCustomTextSection, bibSetQuotaDisplaySection, bibSetCredentialsSection, bibSetDataCard, bibSetVersionSection, bibSetFieldGroups, bibSetInput, bibSetButton, bibSetCardHeader, installStyles, bibSetInstallStyles });', sandbox, { filename: 'src/client-bundle.js' })
const A = hook.api
const t = A.t

// 让两个样式安装函数把 CSS 写进假 document
A.installStyles(); A.bibSetInstallStyles()
const infoCss = capturedStyles.length > 0 ? capturedStyles[0] : ''
const settingsCss = capturedStyles.length > 1 ? capturedStyles[1] : ''

// ---- TestRenderer JSON → HTML ----
const VOID = new Set(['br', 'img', 'input', 'hr', 'meta'])
const STYLE_PROPS = { className: 'class', htmlFor: 'for', maxLength: 'maxlength', spellCheck: 'spellcheck', autoComplete: 'autocomplete', tabIndex: 'tabindex', ariaLabel: 'aria-label', ariaLabelledby: 'aria-labelledby', ariaExpanded: 'aria-expanded', ariaControls: 'aria-controls', ariaHidden: 'aria-hidden', ariaLevel: 'aria-level', ariaInvalid: 'aria-invalid', ariaLive: 'aria-live', dataField: 'data-field', dataDensity: 'data-density' }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function styleText(style) {
  if (!style || typeof style !== 'object') return ''
  return Object.entries(style).filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => [k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), v].join(':')).join(';')
}
function nodeToHTML(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return esc(node)
  if (Array.isArray(node)) return node.map(nodeToHTML).join('')
  // toJSON 格式：{ type, props, children } —— children 在顶层（文本节点 type 为 null）
  if (!node.type) return nodeToHTML(node.children)
  const p = node.props || {}
  const attrs = []
  for (const [k, v] of Object.entries(p)) {
    if (k === 'children' || k === 'key' || k === 'ref' || v === null || v === undefined || v === false) continue
    if (typeof v === 'function') continue
    if (k === 'style') { const s = styleText(v); if (s) attrs.push('style="' + esc(s) + '"'); continue }
    if (k === 'hidden') { attrs.push('hidden'); continue }
    if (k === 'disabled') { attrs.push('disabled'); continue }
    if (STYLE_PROPS[k]) { attrs.push(STYLE_PROPS[k] + '="' + esc(v) + '"'); continue }
    if (/^(aria-|data-)/.test(k)) { attrs.push(k + '="' + esc(v) + '"'); continue }
    if (['id', 'title', 'type', 'value', 'placeholder', 'role', 'lang', 'dir'].includes(k)) attrs.push(k + '="' + esc(v) + '"')
  }
  const inner = nodeToHTML(node.children)
  if (VOID.has(node.type)) return '<' + node.type + (attrs.length ? ' ' + attrs.join(' ') : '') + '>'
  return '<' + node.type + (attrs.length ? ' ' + attrs.join(' ') : '') + '>' + inner + '</' + node.type + '>'
}
function renderToHTML(element) {
  let inst = null
  TestRenderer.act(function () { inst = TestRenderer.create(element) })
  let json = null
  TestRenderer.act(function () { json = inst.toJSON() })
  return nodeToHTML(json)
}
function clickFirst(element, finder) {
  let json = null
  let inst = null
  TestRenderer.act(function () { inst = TestRenderer.create(element) })
  const target = finder(inst.root)
  TestRenderer.act(function () { target.props.onClick() })
  TestRenderer.act(function () { json = inst.toJSON() })
  return nodeToHTML(json)
}

// ---- 挂载各区块 ----
const stubHandlers = { onCredentialDraft() {}, onCredentialSave() {}, onCredentialClear() {}, credentialDrafts: {}, credentialBusyRef: null, credentialFeedback: null }
const FULL_STATE = {
  canWrite: true, bound: 1, total: 1, kimiLogin: { configured: true }, items: [],
  groups: [{ id: 'alibaba', labelKey: 'ui.qwenTokenPlan', label: null, mode: 'subscription', bound: true,
    credentials: [
      { ref: 'ALIBABA_CLOUD_ACCESS_KEY_ID', labelKey: 'ui.credentialAlibabaIdLabel', hintKey: 'ui.credentialAlibabaIdHint', configured: true, source: 'file', writable: true },
      { ref: 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', labelKey: 'ui.credentialAlibabaSecretLabel', hintKey: 'ui.credentialAlibabaHint', configured: false, source: null, writable: true },
    ] }],
}
const NONE_STATE = {
  canWrite: true, bound: 0, total: 1, kimiLogin: { configured: false }, items: [],
  groups: [{ id: 'alibaba', labelKey: 'ui.qwenTokenPlan', label: null, mode: 'subscription', bound: false,
    credentials: FULL_STATE.groups[0].credentials.map((c) => Object.assign({}, c, { configured: false, source: null })) }],
}
const credEl = (state) => React.createElement(A.bibSetCredentialsSection, Object.assign({ credentialState: state }, stubHandlers))
const credHead = (root) => root.findAll((n) => n.type === 'button' && n.props['aria-controls'] === 'bib-set-credentials-body')[0]

const fieldGroupsProps = {
  nativePills: false,
  query: '',
  searchActive: false,
  matchesSearch: () => true,
  groupOpenOf: (g) => g === 'native',
  onGroupToggle() {},
  fieldOn: () => true,
  colorOf: () => null,
  hexDraftOf: () => '',
  committedHexText: () => '',
  onFieldToggle() {}, onColorChange() {}, onHexChange() {}, onHexCommit() {},
  timeZonesOf: () => ({ main: 'Asia/Shanghai', world: 'UTC' }),
  onTimeZoneChange() {},
  customTextDraft: null,
  customTextOf: () => '专注模式',
  onCustomTextChange() {}, onCustomTextCommit() {},
}

const versionState = {
  disabled: false, autoUpdate: true, available: false,
  diskVersion: '1.24.4', runningVersion: '1.24.4', latest: '1.24.4',
  holdVersion: null, lastError: null, lastCheckAt: Date.now(),
}

const sections = {
  language: renderToHTML(React.createElement(A.bibSetLanguagePicker, { runtime: { options: () => [{ id: 'zh', label: '简体中文' }, { id: 'en', label: 'English' }], preference: () => 'auto', setPreference() {} }, onError() {} })),
  fieldGroups: renderToHTML(React.createElement('div', null, React.createElement(A.bibSetFieldGroups, fieldGroupsProps))),
  timeDate: renderToHTML(React.createElement(A.bibSetTimeDateSection, { fieldOn: () => true, timeZonesOf: () => ({ main: 'Asia/Shanghai', world: 'UTC' }), onTimeZoneChange() {} })),
  customText: renderToHTML(React.createElement(A.bibSetCustomTextSection, { fieldOn: () => true, customTextDraft: null, customTextOf: () => '专注模式', onCustomTextChange() {}, onCustomTextCommit() {} })),
  quota: renderToHTML(React.createElement(A.bibSetQuotaDisplaySection, { fieldOn: () => true, modeOf: () => 'remaining', onModeChange() {} })),
  credCollapsed: renderToHTML(credEl(NONE_STATE)),
  credExpanded: clickFirst(credEl(FULL_STATE), credHead),
  data: renderToHTML(React.createElement(A.bibSetDataCard, { busy: false, onExport() {}, onClear() {} })),
  version: renderToHTML(React.createElement(A.bibSetVersionSection, { state: versionState, error: null, busy: false, phase: null, onToggleAuto() {}, onCheck() {}, onInstall() {}, onForce() {}, onRollback() {} })),
}

// ---- 信息栏行（真实 CSS + 真实类名语法，代表性状态） ----
function sep() { return '<span class="bi-sep">|</span>' }
function metric(label, value, extra) {
  return '<span class="bi-metric"><span>' + label + '</span><span class="bi-metric-data"><b class="bi-num">' + value + '</b></span>' + (extra || '') + '</span>'
}
const barBase = 'SONGOAO25<b class="bi-model-provider-group"><span class="bi-model-provider">OpenCode Go</span><span class="bi-model-dot">·</span><span class="bi-model-name">DeepSeek V4.1 Flash</span></b>'
const infoRows = {
  normal: '<div class="bi-root" data-density="full"><div class="bi-row2">' + barBase + sep() + metric('主时间', '2026-11-12 21:40') + sep() + metric('世界时间', '2026-11-12 13:40') + sep() + metric('5h', '80%') + ' · ' + metric('周', '30%') + ' · ' + metric('月', '45%') + sep() + metric('距重置', '00:00') + '</div></div>',
  updateNotice: '<div class="bi-root" data-density="full"><div class="bi-row2">' + barBase + sep() + metric('主时间', '2026-11-12 21:40') + sep() + metric('5h', '80%') + '<span class="bi-update-badge" data-field="updateNotice" title="已下载 1.24.4，重启后生效。">重启更新</span></div></div>',
  updateFailed: '<div class="bi-root" data-density="full"><div class="bi-row2">' + barBase + sep() + metric('5h', '80%') + '<span class="bi-update-badge bi-update-badge--error" data-field="updateFailure" title="更新失败 · 网络超时">更新失败</span></div></div>',
  refresh: '<div class="bi-root" data-density="full"><div class="bi-row2">' + barBase + sep() + metric('余额', '¥128.50') + '<span class="bi-stale" data-field="refreshFailure" title="余额、订阅额度暂时不可用，保留上次数据">刷新失败</span></div></div>',
  noKey: '<div class="bi-root" data-density="full"><div class="bi-row2">' + barBase + sep() + metric('5h', '80%') + '<span class="bi-err" data-field="noKeyHint" title="未找到 ChatGPT 登录凭证，请在 DSH 里重新授权。">未找到 ChatGPT 登录凭证</span></div></div>',
  compact: '<div class="bi-root" data-density="compact"><div class="bi-row2">' + barBase + sep() + metric('5h', '80%') + ' · ' + metric('周', '30%') + '</div></div>',
}

// ---- 组装概览页 ----
function label(txt, note) {
  return '<div class="h-label">' + esc(txt) + (note ? '<span class="h-note">' + esc(note) + '</span>' : '') + '</div>'
}
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>dsh-bottom-info-bar 设计概览</title>
<style>
  /* DSH 0.2.2 暗色主题 token（值取自本机 app.asar） */
  body {
    --dsw-radius-xs: 4px; --dsw-radius-sm: 8px; --dsw-radius-md: 12px; --dsw-radius-lg: 16px; --dsw-radius-xl: 20px;
    --dsw-alias-bg-layer-1: #232324; --dsw-alias-bg-layer-2: #2c2c2e; --dsw-alias-bg-layer-3: #353638;
    --dsw-alias-label-primary: #f9fafb; --dsw-alias-label-secondary: #cfd3d6; --dsw-alias-label-tertiary: #adb2b8;
    --dsw-alias-border-l2: #ffffff1f; --dsw-alias-border-l3: rgba(255,255,255,0.16); --dsw-alias-border-l4: #ffffff33;
    --dsw-alias-settings-card-fill: var(--dsw-alias-bg-layer-2);
    --dsw-alias-settings-card-stroke: var(--dsw-alias-border-l4);
    --dsw-alias-interactive-bg-hover: rgba(255,255,255,0.08);
    margin: 0; background: #1b1b1d; color: #f9fafb;
    font-family: -apple-system, 'SF Pro Text', 'PingFang SC', 'Helvetica Neue', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .sheet { width: 880px; margin: 0 auto; padding: 48px 56px 96px; }
  .h-title { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
  .h-sub { font-size: 12.5px; color: #adb2b8; margin: 0 0 8px; line-height: 1.6; }
  .h-label { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: #adb2b8; margin: 44px 0 12px; text-transform: uppercase; }
  .h-label:first-of-type { margin-top: 32px; }
  .h-note { font-weight: 400; letter-spacing: 0; text-transform: none; margin-left: 10px; color: #6f7378; }
  .frame { background: #232324; border-radius: 16px; padding: 24px 28px; }
  .bar { background: #2c2c2e; border: 1px solid rgba(255,255,255,0.10); border-radius: 12px; padding: 7px 14px; margin-bottom: 10px; }
</style>
${infoCss ? '<style data-info-css>' + infoCss + '</style>' : ''}
${settingsCss ? '<style data-settings-css>' + settingsCss + '</style>' : ''}
</head><body data-ds-dark-theme="dark">
<div class="sheet">
  <p class="h-title">dsh-bottom-info-bar · 设计概览（分支构建）</p>
  <p class="h-sub">DSH 0.2.2 暗色主题 · 真实组件 + 真实 CSS 渲染 · 用于推送前视觉验收，非发布产物</p>

  ${label('信息栏 · 状态一览', '提醒徽章统一软底胶囊；徽章只在真有事时出现')}
  <div class="bar">${infoRows.normal}</div>
  <div class="bar">${infoRows.compact}</div>
  <div class="bar">${infoRows.updateNotice}</div>
  <div class="bar">${infoRows.updateFailed}</div>
  <div class="bar">${infoRows.refresh}</div>
  <div class="bar">${infoRows.noKey}</div>

  ${label('设置页 · 各区块卡片', '每区块同一张设置卡（settings-card fill/stroke/radius-xl）')}
  <div class="frame bib-set-root bib-settings">
    ${sections.language}
    ${sections.timeDate}
    ${sections.customText}
    ${sections.quota}
    ${sections.credCollapsed}
    ${sections.data}
    ${sections.version}
  </div>

  ${label('设置页 · 额度凭据 · 默认折叠态（独立展示）')}
  <div class="frame bib-set-root bib-settings">${sections.credCollapsed}</div>

  ${label('设置页 · 额度凭据 · 展开态（点击卡头后）')}
  <div class="frame bib-set-root bib-settings">${sections.credExpanded}</div>

  ${label('设置页 · 显示内容卡（一级卡头 + 搜索 + 分组 + 恢复默认）', '原生信息组展开、插件信息组收起；卡头与账单数据等区块同层级')}
  <div class="frame bib-set-root bib-settings">
    <section class="bib-set-card bib-set-card--panel" aria-label="要显示的信息">
      <div class="bib-set-card-header bib-set-card-header--static"><span class="bib-set-card-header-main"><span id="bib-set-visible-fields-title" class="bib-set-card-title" role="heading" aria-level="2">要显示的信息</span></span><span class="bib-set-card-desc">信息栏里每一项内容的显示开关与配色都在这里，按组折叠管理。</span></div>
      <div class="bib-set-toolbar"><div class="bib-set-search-row"><div class="bib-set-search-shell">
        <input class="bib-set-search" type="search" placeholder="搜索要显示的内容…">
      </div></div></div>
      ${sections.fieldGroups}
      <div class="bib-set-data-row bib-set-reset-row">
        <div class="bib-set-data-copy">
          <p class="bib-set-data-title">恢复默认</p>
          <p class="bib-set-data-desc">将显示项与显示颜色恢复为默认。</p>
        </div>
        <div class="bib-set-data-button-group">
          <button class="bib-set-btn" type="button">恢复显示</button>
          <button class="bib-set-btn" type="button">恢复颜色</button>
        </div>
      </div>
    </section>
  </div>
</div>
</body></html>`
console.log('section lengths:', Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.length])))
writeFileSync('/tmp/bib-design-overview.html', html)
console.log('written /tmp/bib-design-overview.html, styles captured:', capturedStyles.map((s) => s.length).join(','))
