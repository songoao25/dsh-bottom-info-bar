// Exercise rendered English copy and the unfiltered host checker without real RPCs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import fixture from './locale-fixture.cjs'
import { createHostTranslator, localizeHostText } from '../plugin/src/host-locale.js'

const { dictionaries, createLocale } = fixture
assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort())
for (const key of Object.keys(dictionaries.zh)) {
  const parameters = value => (value.match(/\{\w+\}/g) || []).sort()
  assert.deepEqual(parameters(dictionaries.zh[key]), parameters(dictionaries.en[key]), key)
}
let preference = 'zh'
const hostT = createHostTranslator({ settings: { get: () => ({ preference }) } })
assert.equal(hostT('host.unknownProvider'), '未知服务商')
for (const language of ['zh', 'en']) {
  preference = language
  for (const key of Object.keys(dictionaries.zh).filter(key => key.startsWith('host.'))) {
    const params = Object.fromEntries((dictionaries.zh[key].match(/\{\w+\}/g) || []).map(name => [name.slice(1, -1), 'sample']))
    const original = dictionaries.zh[key].replace(/\{(\w+)\}/g, (_, name) => params[name])
    assert.equal(localizeHostText(original, hostT, dictionaries), hostT(key, params), key)
  }
}
const wire = { provider: '未知服务商', modelDisplay: '未知模型', providerDisplay: '未知服务商', key: 'five_hour', usedPercent: 30, message: '请求失败（HTTP 503）' }
assert.deepEqual(JSON.parse(JSON.stringify(wire, hostT.json)), { ...wire, message: 'Request failed: HTTP 503.' })
assert.equal(localizeHostText('External provider detail', hostT, dictionaries), 'External provider detail')
assert.equal(localizeHostText('', hostT, dictionaries), '')
preference = 'en'
assert.equal(hostT('host.unknownProvider'), 'Unknown provider')
preference = '<invalid>'
assert.equal(hostT('host.unknownProvider'), '未知服务商')

// 防复发（v1.10.0 启动崩溃回归）：cordis 宿主 ctx 未 inject settings 时，直接访问
// ctx.settings 会抛 "cannot get property 'settings' without inject"。translate 必须
// 走 ctx.get('settings') 安全读取、不崩、回退 zh。修复前本用例在此抛错（=崩溃现场）。
const cordisLikeCtx = new Proxy({ get: () => undefined }, {
  get(target, prop, receiver) {
    if (prop === 'settings') throw new Error('cannot get property "settings" without inject')
    return Reflect.get(target, prop, receiver)
  },
})
const resilientT = createHostTranslator(cordisLikeCtx)
assert.equal(resilientT('host.unknownProvider'), '未知服务商')
assert.equal(resilientT('host.everydayQuestions'), dictionaries.zh['host.everydayQuestions'])
assert.equal(JSON.stringify({ message: '请求失败（HTTP 503）' }, resilientT.json), '{"message":"请求失败（HTTP 503）"}')
console.log('PASS  translate survives a host ctx that throws on direct .settings access (cordis without inject)')

const checker = readFileSync(new URL('./check-host.js', import.meta.url), 'utf8')
const host = readFileSync(new URL('../plugin/src/host.js', import.meta.url), 'utf8')
function checkSource(source) {
  const output = []
  let status
  vm.runInNewContext(checker, {
    require(name) {
      assert.equal(name, 'fs')
      return { readFileSync: () => source }
    },
    process: { argv: ['node', 'check-host.js', 'fixture.js'], exit(code) { status = code } },
    console: { log: (line) => output.push(line) },
  })
  return { status, output: output.join('\n') }
}
const prose = checkSource(host + '\nconst uiCopy = "Request failed: HTTP 500.";')
assert.equal(prose.status, 0, prose.output)
const missing = checkSource(host + "\nconst pattern = /'/; missingCall(); const label = 'text';")
assert.equal(missing.status, 1, missing.output)
assert.match(missing.output, /FAIL[^\n]*missingCall/)
console.log('PASS  English host prose passes; a quote in a regex cannot hide missingCall()')

let states = [{ fields: {}, colors: {}, configVersion: 0 }, 'ready', null, null, null, false, {}]
let stateIndex = 0
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState(initial) {
    const index = stateIndex++
    if (index >= states.length) states[index] = typeof initial === 'function' ? initial() : initial
    return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
  },
  useRef: (initial) => ({ current: initial }),
  useEffect() {},
  useCallback: (fn) => fn,
  cloneElement: (node, props) => ({ ...node, props: { ...node.props, ...props } }),
}
let plugin
let settings
let dock
let navLabel
const locale = createLocale('en')
const slots = {
  inject: (_, register) => register(),
  register(options, component) {
    assert.equal(options.locale, 'dsh-bottom-info-bar')
    if (options.name === 'settings.section') { settings = component; navLabel = options.label }
    else dock = component
    return () => {}
  },
}
vm.runInNewContext(readFileSync(new URL('../plugin/lib/client.js', import.meta.url), 'utf8'), {
  console, AbortController,
  window: {
    setTimeout: () => 0, clearTimeout() {},
    __ModuleLoader__: { load(mod) { plugin = mod.factory(() => React) } },
  },
  fetch: async () => { throw new Error('Offline') },
})
await plugin.apply({ slots, locale, get: () => null, effect(fn, label) { if (label.endsWith(': dictionaries')) fn() } })
assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale'])
function render() { stateIndex = 0; return settings({}) }
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...nodes(tree.props.children)]
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('')
  if (tree == null || typeof tree === 'boolean') return ''
  return typeof tree === 'object' ? text(tree.props.children) : String(tree)
}
const rendered = nodes(render())
const descriptions = rendered.filter((node) => node.props.className === 'bib-set-rowDesc').map(text)
assert.ok(descriptions.includes('Shown in: Balance. Actual account balance. A low balance appears in red with a Low label.'))
for (const description of descriptions) {
  assert.doesNotMatch(description, /\.[A-Z]| {2}/, description)
}
console.log('PASS  Rendered settings descriptions have sentence spacing without double spaces')
const toggle = rendered.find((node) => node.props.role === 'switch' && node.props['aria-label'] === 'Show Balance')
assert.ok(toggle, 'Balance switch must be rendered')
toggle.props.onClick()
await new Promise((resolve) => setImmediate(resolve))
const alerts = nodes(render()).filter((node) => node.props.role === 'alert').map(text)
assert.ok(alerts.includes('"Balance": Could not save: Offline'), JSON.stringify(alerts))
assert.equal(states[0].fields.balance, true, 'A failed save must restore field visibility')
// Language switcher shows native language names (中文 / English) in both locales — standard UI convention.
// Strip the language option text before checking for stray Chinese characters.
const langNames = ['中文', 'English']
const textWithoutLangOpts = text(render()).replace(new RegExp(langNames.join('|'), 'g'), '')
assert.doesNotMatch(textWithoutLangOpts, /\p{Script=Han}|[「」]/u)
console.log('PASS  Failed field saves use English punctuation and preserve rollback behavior')

// The same registered components and bound translator follow the LocaleFace.
const bound = locale.bind('dsh-bottom-info-bar')
assert.equal(navLabel(), 'Info Bar')
locale.setLocale('zh')
assert.equal(bound, locale.bind('dsh-bottom-info-bar'))
assert.equal(navLabel(), '信息底栏')
const switchedAlerts = nodes(render()).filter(node => node.props.role === 'alert').map(text)
assert.ok(switchedAlerts.includes('「余额」：保存失败：Offline'), JSON.stringify(switchedAlerts))
states = [{ fields: {}, colors: {}, configVersion: 0 }, 'ready', null, null, null, false, {}]
assert.match(text(render()), /信息底栏设置/)
assert.match(text(render()), /原生字段/)
assert.match(text(render()), /服务商账户的真实余额/)
locale.setLocale('en')
assert.match(text(render()), /Info Bar settings/)

// The in-plugin control delegates to DSH's shared locale service. Reset the
// state array so localeActive is initialized from the current LocaleFace, as it
// would be on a fresh React mount.
states = [{ fields: {}, colors: {}, configVersion: 0 }, 'ready', null, null, null, false, {}]
locale.setLocale('zh')
let languageOptions = nodes(render()).filter(node => node.props.role === 'radio')
let chineseOption = languageOptions.find(node => text(node) === '中文')
let englishOption = languageOptions.find(node => text(node) === 'English')
assert.ok(chineseOption && englishOption, 'Both native language options must render')
assert.equal(chineseOption.props['aria-checked'], true)
assert.equal(englishOption.props['aria-checked'], false)
englishOption.props.onClick()
assert.equal(locale.getSnapshot().active, 'en', 'English option must call the shared DSH locale service')
states = [{ fields: {}, colors: {}, configVersion: 0 }, 'ready', null, null, null, false, {}]
languageOptions = nodes(render()).filter(node => node.props.role === 'radio')
chineseOption = languageOptions.find(node => text(node) === '中文')
englishOption = languageOptions.find(node => text(node) === 'English')
assert.equal(chineseOption.props['aria-checked'], false)
assert.equal(englishOption.props['aria-checked'], true)
assert.match(text(render()), /Switch the DeepSeek Harness display language/)
chineseOption.props.onClick()
assert.equal(locale.getSnapshot().active, 'zh', 'Chinese option must call the shared DSH locale service')
locale.setLocale('en')
console.log('PASS  Language control changes the shared DSH locale and reflects the active option')

function expand(tree) {
  if (Array.isArray(tree)) return tree.map(expand)
  if (!tree || typeof tree !== 'object') return tree
  if (typeof tree.type === 'function') return expand(tree.type(tree.props))
  return { ...tree, props: { ...tree.props, children: expand(tree.props.children) } }
}
const stats = { turns: 1, steps: 2, llmMs: 1000, toolMs: 500, ttftSteps: 1, ttftMs: 100, decodeMs: 200, decodeTokens: 5 }
const usage = { uncachedInputTokens: 10, cacheReadTokens: 5, outputTokens: 8 }
function infoBar(mode, density = 'full', error = null) {
  const state = {
    loading: false, errors: {},
    pricing: { provider: 'deepseek', providerDisplay: 'DeepSeek', model: 'test-model', modelDisplay: 'Test Model', mode: 'peak-valley', period: 'peak', prices: {}, nextSwitch: { atLabel: '18:00', at: Date.now() + 60000 } },
    billingMode: { mode, provider: mode === 'subscription' ? 'codex' : mode === 'billing' ? 'together' : 'deepseek' },
    balance: { currency: 'CNY', data: { total: 12.34 }, alert: { active: true } },
    usage: { currentSession: { costs: { CNY: 1 } }, todaySpend: 2, monthSpend: 3, totalSpend: 4 },
    sub: { windows: [{ key: 'five_hour', label: '5 小时', usedPercent: 90, resetsAt: Date.now() + 60000 }], error },
    billing: { data: { currentPeriodSpend: 12, currency: 'USD', budgetPercent: 20, freeRemaining: 30, resetsAt: Date.now() + 60000 }, error },
  }
  if (error) state.sub.windows = []
  states = [state, { current: '1.9.2', latest: '1.9.3', available: true }, Date.now(), null, 'unavailable', density, false, 0]
  stateIndex = 0
  return expand(dock({ density, onToggleDensity() {}, useProjection: name => name === 'sessionStats' ? stats : usage }))
}
for (const language of ['zh', 'en']) {
  locale.setLocale(language)
  for (const mode of ['balance', 'subscription', 'billing']) {
    for (const density of ['full', 'compact']) {
      const tree = infoBar(mode, density)
      const copy = text(tree) + nodes(tree).map(n => n.props.title || '').join('\n')
      assert.ok(!copy.includes('undefined'), copy)
      assert.doesNotMatch(copy, /\b(?:ui|host|field|group)\.[A-Za-z]/)
      if (language === 'en') assert.doesNotMatch(copy, /\p{Script=Han}/u)
      assert.match(copy, language === 'zh' ? /1 轮.*2 步/s : /1 turn.*2 steps/s)
      assert.match(copy, language === 'zh' ? /新版本提醒/ : /Update available/)
      if (mode === 'balance') assert.match(copy, language === 'zh' ? /余额/ : /Balance/)
      if (mode === 'subscription') assert.match(copy, language === 'zh' ? /剩余/ : /remaining/)
      if (mode === 'billing') assert.match(copy, language === 'zh' ? /本月/ : /This month/)
    }
  }
  for (const message of ['Unrelated provider detail', '未配置 API_KEY']) {
    const tree = infoBar('subscription', 'full', { kind: 'no-key', message })
    const hints = nodes(tree).map(node => node.props.title || '').join('\n')
    assert.ok(hints.includes(language === 'en'
      ? 'No sign-in credentials found for Codex. Please reauthorize.'
      : '未找到 Codex 登录凭证。请重新授权。'), hints)
  }
}
console.log('PASS  Both dictionaries, interpolation, Settings, all three modes, both densities, and live binding')
