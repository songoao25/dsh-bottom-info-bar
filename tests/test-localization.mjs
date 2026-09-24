// Exercise rendered English copy and the unfiltered host checker without real RPCs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import fixture from './locale-fixture.cjs'
import { createHostTranslator, localizeHostText, readHostLocalePreference } from '../src/host-locale.js'

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

// DSH 0.1.7 起 settings 服务换成 SettingsForms：get(ns) 被移除，只剩 describe()。
// 只认 get 的旧写法会在新宿主上静默回退 zh —— 宿主语言是英文时插件却吐中文。
// 这里锁定「新宿主 describe() 优先、旧宿主 get(ns) 兜底、都读不到回退 zh」三条路径。
{
  const describedHost = { settings: { describe: () => [{ ns: 'llm-deepseek', value: {} }, { ns: 'locale', value: { preference: 'en' } }] } }
  assert.equal(createHostTranslator(describedHost)('host.unknownProvider'), 'Unknown provider')
  assert.equal(readHostLocalePreference(describedHost.settings), 'en')

  const describedZhHost = { settings: { describe: () => [{ ns: 'locale', value: { preference: 'zh' } }] } }
  assert.equal(createHostTranslator(describedZhHost)('host.unknownProvider'), '未知服务商')

  // describe() 抛错时不得崩：继续走旧 get(ns) 兜底
  const brokenDescribeHost = { settings: { describe: () => { throw new Error('boom') }, get: () => ({ preference: 'en' }) } }
  assert.equal(createHostTranslator(brokenDescribeHost)('host.unknownProvider'), 'Unknown provider')

  // describe() 返回畸形值 / 没有 locale 节时回退 zh
  assert.equal(createHostTranslator({ settings: { describe: () => 'nope' } })('host.unknownProvider'), '未知服务商')
  assert.equal(createHostTranslator({ settings: { describe: () => [{ ns: 'locale', value: null }] } })('host.unknownProvider'), '未知服务商')
  assert.equal(readHostLocalePreference(undefined), undefined)
  assert.equal(readHostLocalePreference({}), undefined)
  console.log('PASS  host locale reads the 0.1.7 describe() shape and still falls back to the legacy get(ns)')
}

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

// Alpha1 exposes a declarative inject method on the context. The translator
// must use that path and never probe ctx.settings while the service is absent.
let injectedSettingsCalls = 0
const injectedCordisCtx = new Proxy({
  inject(dependencies, callback) {
    assert.deepEqual(dependencies, ['settings'])
    injectedSettingsCalls += 1
    callback({ settings: { get: () => ({ preference: 'en' }) } })
  },
}, {
  get(target, prop, receiver) {
    if (prop === 'settings') throw new Error('cannot get property "settings" without inject')
    return Reflect.get(target, prop, receiver)
  },
})
const injectedT = createHostTranslator(injectedCordisCtx)
assert.equal(injectedT('host.unknownProvider'), 'Unknown provider')
assert.equal(injectedSettingsCalls, 1)
console.log('PASS  translate uses declarative settings injection on alpha1 contexts')

const checker = readFileSync(new URL('./check-host.cjs', import.meta.url), 'utf8')
const host = readFileSync(new URL('../src/host.js', import.meta.url), 'utf8')
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

let states = [{ fields: {}, colors: {}, timeFormat: { year: true, month: true, day: true, hour: true, minute: true, second: false }, timeZones: { main: 'Asia/Shanghai', world: 'UTC' }, customText: '', configVersion: 0 }, 'ready', null, null, null, false, false, {}, null, 0, '', false]
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
let dock
let navLabel
let bundleConfig
const locale = createLocale('en')
const slots = {
  inject: (_, register) => register(),
  register(options, component) {
    assert.equal(options.locale, 'dsh-bottom-info-bar')
    // plugins.bundle.config 是唯一配置入口；落到 else 会把 dock（信息栏本体）覆盖掉。
    if (options.name === 'plugins.bundle.config') { bundleConfig = component; navLabel = options.label }
    else dock = component
    return () => {}
  },
}
vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  console, AbortController,
  window: {
    setTimeout: () => 0, clearTimeout() {},
    __ModuleLoader__: { load(mod) { plugin = mod.factory(() => React) } },
  },
  fetch: async () => { throw new Error('Offline') },
})
await plugin.apply({ slots, locale, get: () => null, effect(fn, label) { if (label.endsWith(': dictionaries')) fn() } })
assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale'])
function render() { stateIndex = 0; return expand(bundleConfig({ view: 'page' })) }
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
// 英文界面（含配置页各状态）不允许出现任何中文：漏译一条就会在这里露出来。
assert.doesNotMatch(text(render()), /\p{Script=Han}/u, 'the English configuration page must not fall back to Chinese')
const descriptions = rendered.filter((node) => node.props.className === 'bib-set-rowDesc').map(text)
assert.ok(descriptions.includes('Shows the account balance; a low balance appears in red.'))
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
// The plugin configuration page follows DSH's shared locale service and does not duplicate
// a plugin-only language switcher.
assert.doesNotMatch(text(render()), /Choose the DeepSeek Harness interface language|界面语言/)
console.log('PASS  Failed field saves use English punctuation and preserve rollback behavior')

// The same registered components and bound translator follow the LocaleFace.
const bound = locale.bind('dsh-bottom-info-bar')
assert.equal(navLabel(), 'Bottom Info Bar')
locale.setLocale('zh')
assert.equal(bound, locale.bind('dsh-bottom-info-bar'))
assert.equal(navLabel(), '底部信息栏')
const switchedAlerts = nodes(render()).filter(node => node.props.role === 'alert').map(text)
assert.ok(switchedAlerts.includes('「余额」：保存失败：Offline'), JSON.stringify(switchedAlerts))
states = [{ fields: {}, colors: {}, timeFormat: { year: true, month: true, day: true, hour: true, minute: true, second: false }, timeZones: { main: 'Asia/Shanghai', world: 'UTC' }, customText: '', configVersion: 0 }, 'ready', null, null, null, false, false, {}, null, 0, '', false]
assert.match(text(render()), /信息栏/)
assert.doesNotMatch(text(render()), /原生统计行字段/)
assert.match(text(render()), /账户余额/)
locale.setLocale('en')
assert.match(text(render()), /Info Bar/)

states = [{ fields: {}, colors: {}, configVersion: 0 }, 'ready', null, null, null, false, false, {}, null, 0, '', false]
locale.setLocale('zh')
assert.match(text(render()), /信息栏/)
locale.setLocale('en')
assert.match(text(render()), /Info Bar/)
assert.doesNotMatch(text(render()), /Choose the DeepSeek Harness interface language|界面语言/)
locale.setLocale('en')
console.log('PASS  Plugin configuration page follows DSH global locale without a duplicate language control')

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
  // ⚠ 本数组按「组件里 React.useState 的调用顺序」逐个对应（见上方 useState 桩）。
  // 组件新增/调整 useState 时，必须同步在这里插入对应位置的值——否则后面的状态会整体错位，
  // 渲染出错误的界面（本文件下方「新版本提醒」等断言就是用来兜住这种错位的，别把它们删掉）。
  // 当前顺序：state, updateInfo, updateCopied, now, sessionModel, ...
  states = [state, { current: '1.9.2', latest: '1.9.3', available: true }, false, Date.now(), null, 'unavailable', density, false, 0]
  stateIndex = 0
  return expand(dock({ density, onToggleDensity() {}, useProjection: name => name === 'sessionStats' ? stats : usage }))
}
for (const language of ['zh', 'en']) {
  locale.setLocale(language)
  // 插件管理页的 bundle 配置入口：简介视图必须是一行真文案（不吃 useState，不影响下面的顺序）
  const summary = text(bundleConfig({ view: 'summary' }))
  assert.ok(summary.length > 0, summary)
  assert.doesNotMatch(summary, /\b(?:ui|host|field|group)\.[A-Za-z]/)
  assert.doesNotMatch(summary, /undefined/)
  if (language === 'en') assert.doesNotMatch(summary, /\p{Script=Han}/u)
  for (const mode of ['balance', 'subscription', 'billing']) {
    for (const density of ['full', 'compact']) {
      const tree = infoBar(mode, density)
      const copy = text(tree) + nodes(tree).map(n => n.props.title || '').join('\n')
      assert.ok(!copy.includes('undefined'), copy)
      assert.doesNotMatch(copy, /\b(?:ui|host|field|group)\.[A-Za-z]/)
      if (language === 'en') assert.doesNotMatch(copy, /\p{Script=Han}/u)
      assert.match(copy, language === 'zh' ? /1 轮.*2 步/s : /1 turn.*2 steps/s)
      // 简洁模式只保留服务商、模型与一项核心账户信息；更新提醒属于完整模式的辅助信息。
      // 这个轻量 React 桩复用了同一组 hook 槽；以实际渲染出的切换说明判定密度，
      // 避免未来调整 hook 顺序时把测试参数误当作界面状态。
      const compactRendered = language === 'zh' ? copy.includes('切换为完整模式') : copy.includes('for full view')
      if (!compactRendered) assert.match(copy, language === 'zh' ? /新版本提醒/ : /Update available/)
      else assert.doesNotMatch(copy, language === 'zh' ? /新版本提醒/ : /Update available/)
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

// 插件页 / 插件列表里的插件名与描述走的是 DSH 的**包级字典**（<pkg>/locale/<lang>.json），
// 不是本插件自己的 locales.js —— 只在 src/locales.js 里写中文，宿主界面切英文时那段描述仍是中文。
// 这条链有三个契约，缺任何一个都**静默失效**（DSH 把 ERR_PACKAGE_PATH_NOT_EXPORTED 当作"没有字典"，
// 直接回退到 package.json 的 description，不报错）：
//   ① locale/en.json 必须存在（DSH 以它为发现入口，再读同目录下所有 *.json）；
//   ② package.json 的 exports 必须导出 "./locale/*.json"；
//   ③ package.json 的 files 必须包含 "locale/*.json"（否则 npm 包里没有这两个文件）。
{
  const root = new URL('../', import.meta.url)
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
  const en = JSON.parse(readFileSync(new URL('locale/en.json', root), 'utf8'))
  const zh = JSON.parse(readFileSync(new URL('locale/zh.json', root), 'utf8'))
  assert.ok(en.meta?.title && zh.meta?.title, 'locale dictionaries carry meta.title (otherwise the plugin card shows the package name)')
  assert.ok(en.meta?.description && zh.meta?.description, 'locale dictionaries carry meta.description')
  assert.notEqual(en.meta.title, zh.meta.title, 'the two titles must differ')
  assert.notEqual(en.meta.title, pkg.name, 'the display name must not be the package name')
  assert.equal(en.meta.title, dictionaries.en['meta.title'], 'locale/en.json must match the client dictionary')
  assert.equal(zh.meta.title, dictionaries.zh['meta.title'], 'locale/zh.json must match the client dictionary')
  assert.notEqual(en.meta.description, zh.meta.description, 'the two descriptions must differ')
  assert.match(zh.meta.description, /\p{Script=Han}/u, 'zh description is Chinese')
  assert.doesNotMatch(en.meta.description, /\p{Script=Han}/u, 'en description is not Chinese')
  assert.equal(pkg.description, en.meta.description, 'package.json description is the English fallback DSH uses for en')
  assert.ok(pkg.exports?.['./locale/*.json'], 'exports must expose ./locale/*.json or DSH silently finds no dictionaries')
  assert.ok(pkg.files?.includes('locale/*.json'), 'files must ship locale/*.json in the npm tarball')
  console.log('PASS  Plugin metadata dictionaries are discoverable (locale/en.json + exports + files)')
}
