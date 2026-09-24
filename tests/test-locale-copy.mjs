// dsh-bottom-info-bar — 文案双语契约（对齐姊妹插件 dsh-chatgpt-subscription 的 test-locale-copy.mjs）
//
// 覆盖五条硬约束：
//   1) locale/{en,zh}.json 的 meta.title / meta.description 与 package.json 接线（展示名 ≠ 包名）
//   2) client 字典 zh/en 键完全对称、每条非空、两侧不同（品牌名与纯模板显式豁免）
//   3) 宿主每个用户可见错误的稳定 code 都有中英两条文案
//   4) 在「按 cordis inject 语义授权服务访问」的 ctx 上真实跑 client half：
//      未在 inject 里声明的服务属性一律抛 cannot get property "x" without inject，
//      而且 locale 服务抛错/缺席时也不能让 apply 崩 —— 这是「配置页整块消失」事故的回归锁
//   5) cordis.patch.yml 的行 id ≠ 模块名（否则插件卡片的「行 id / 模块名」是同一串字，显示两行）
//
// 用法：node tests/test-locale-copy.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginDir = root
const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
const clientSource = readFileSync(join(pluginDir, 'src', 'client-bundle.js'), 'utf8')
const localesSource = readFileSync(join(pluginDir, 'src', 'locales.js'), 'utf8')
const hostSource = readFileSync(join(pluginDir, 'src', 'host.js'), 'utf8')
const patchSource = readFileSync(join(pluginDir, 'cordis.patch.yml'), 'utf8')
const artifact = readFileSync(join(pluginDir, 'lib', 'client.js'), 'utf8')

// ---------- 1. locale 文件：DSH 内置语言只有 zh / en ----------
assert.deepEqual(readdirSync(join(pluginDir, 'locale')).sort(), ['en.json', 'zh.json'],
  'locale/ must carry exactly the two DSH built-in languages (zh, en)')
const en = JSON.parse(readFileSync(join(pluginDir, 'locale', 'en.json'), 'utf8'))
const zh = JSON.parse(readFileSync(join(pluginDir, 'locale', 'zh.json'), 'utf8'))
assert.deepEqual(Object.keys(en.meta).sort(), ['description', 'title'], 'plugin metadata carries a title and a description')
assert.deepEqual(Object.keys(zh.meta).sort(), Object.keys(en.meta).sort(), 'en/zh meta must declare the same fields')
for (const [lang, meta] of [['en', en.meta], ['zh', zh.meta]]) {
  for (const field of ['title', 'description']) {
    assert.equal(typeof meta[field], 'string', lang + '.' + field + ' must be a string')
    assert.ok(meta[field].trim() !== '', lang + '.' + field + ' must not be blank')
  }
}
assert.notEqual(en.meta.title, zh.meta.title, 'the two languages must not ship the same title')
assert.notEqual(en.meta.description, zh.meta.description, 'the two languages must not ship the same description')
assert.notEqual(en.meta.title, pkg.name, 'the display name must not be the package name (that is what the card falls back to)')
assert.ok(en.meta.description.length <= 90, 'English description must stay one short line')
assert.ok(zh.meta.description.length <= 40, '中文描述保持一行')

// ---------- 2. package.json 接线：exports 不放行，readPluginMeta 就解析不到 locale 文件 ----------
assert.equal(pkg.exports['./locale/*.json'], './locale/*.json',
  'exports must expose ./locale/*.json (readPluginMeta resolves the dictionary through the exports map)')
assert.ok(pkg.files.includes('locale/*.json'), 'the published tarball must include locale/*.json')
assert.equal(pkg.description, en.meta.description,
  'package.json description is the English fallback and must equal locale/en.json meta.description')

// ---------- 3. client 字典：键对称 / 非空 / 两侧不同 ----------
const dictionaryBlock = localesSource.match(/export const LOCALES = \{[\s\S]*\n\}/)
assert.ok(dictionaryBlock, 'src/locales.js must define the zh/en dictionary')
// 用本 realm 的 JSON.parse 取字典：vm 里造出来的对象跨 realm，deepStrictEqual 会因原型不同而误报。
const LOCALES = JSON.parse(dictionaryBlock[0].replace('export const LOCALES = ', ''))
const zhKeys = Object.keys(LOCALES.zh)
const enKeys = Object.keys(LOCALES.en)
assert.ok(zhKeys.length >= 300, 'the dictionary must cover every user-visible string (got ' + zhKeys.length + ')')
assert.deepEqual(enKeys.filter((key) => !zhKeys.includes(key)), [], 'every English key needs a Chinese one')
assert.deepEqual(zhKeys.filter((key) => !enKeys.includes(key)), [], 'every Chinese key needs an English one')
// 品牌名与纯格式模板在两种语言里天然同形，显式豁免（其余每条都必须真的翻译过）。
const SAME_BY_DESIGN = new Set(['ui.commandCode', 'ui.contextFigures', 'ui.minimax'])
for (const key of zhKeys) {
  assert.ok(LOCALES.zh[key].trim() !== '' && LOCALES.en[key].trim() !== '', key + ' must be non-empty in both languages')
  if (!SAME_BY_DESIGN.has(key)) assert.notEqual(LOCALES.zh[key], LOCALES.en[key], key + ' must actually be translated')
}
for (const key of ['meta.title', 'meta.description']) {
  assert.ok(zhKeys.includes(key), 'the dictionary carries ' + key + ' for the plugin card and detail page')
}
assert.equal(LOCALES.en['meta.title'], en.meta.title, 'the English title must match locale/en.json')
assert.equal(LOCALES.zh['meta.title'], zh.meta.title, 'the Chinese title must match locale/zh.json')
assert.equal(LOCALES.en['meta.description'], en.meta.description, 'the English description must match locale/en.json')
assert.equal(LOCALES.zh['meta.description'], zh.meta.description, 'the Chinese description must match locale/zh.json')

// ---------- 4. 文案去 AI 腔 ----------
const AI_SMELL_ZH = /一键|轻松|极致|丝滑|强大|完美|立即|马上|告别/
const AI_SMELL_EN = /seamless|effortless|powerful|unleash|revolutionary|game.?chang|supercharge/i
const AI_SMELL_SHARED = /[—–]|[!！]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
for (const lang of ['zh', 'en']) {
  for (const key of Object.keys(LOCALES[lang])) {
    const copy = LOCALES[lang][key]
    assert.doesNotMatch(copy, AI_SMELL_SHARED, lang + ' ' + key + ' must not use dashes dressed as prose, exclamation or emoji')
    assert.doesNotMatch(copy, lang === 'zh' ? AI_SMELL_ZH : AI_SMELL_EN, lang + ' ' + key + ' must stay free of marketing filler')
  }
}

// ---------- 5. 宿主每个用户可见错误的 code 都有中英两条文案 ----------
const hostCodes = new Set()
for (const match of hostSource.matchAll(/code:\s*(?:'([a-z][a-z0-9-]*\.[a-z0-9.-]+)'|res\.status === 401 \? '([a-z][a-z0-9-]*\.[a-z0-9.-]+)' : '([a-z][a-z0-9-]*\.[a-z0-9.-]+)')/g)) {
  for (const literal of [match[1], match[2], match[3]]) if (literal) hostCodes.add(literal)
}
assert.ok(hostCodes.size >= 25, 'the host must tag its user-visible errors with stable codes (got ' + hostCodes.size + ')')
for (const code of hostCodes) {
  assert.ok(zhKeys.includes('error.' + code), 'missing Chinese copy for host error code ' + code)
  assert.ok(enKeys.includes('error.' + code), 'missing English copy for host error code ' + code)
  assert.notEqual(LOCALES.zh['error.' + code], LOCALES.en['error.' + code], 'error code ' + code + ' must be translated')
}
// 字典里也不许留下「宿主错误键」的老写法（v1.15 起错误文案一律 error.<code>）
const strayHostErrorKeys = zhKeys.filter((key) => key.startsWith('host.') && /requestFailed|notConfigured|couldNot|unrecognized|credentialsAreMissing|IsNotConnected/.test(key))
assert.deepEqual(strayHostErrorKeys, [], 'host error copy must live under error.<code>, not host.*')
// 每个带字典文案的错误对象都必须带 code（否则前端只能退回宿主原文，跨语言就不稳）
const hostLines = hostSource.split('\n')
hostLines.forEach((line, index) => {
  if (!/error:\s*\{[^}]*message:\s*(?:t|translate)\('error\./.test(line)) return
  assert.match(line, /code:/, 'host error at line ' + (index + 1) + ' must carry a stable code')
})

// ---------- 6. 在 cordis 语义的 ctx 上真实跑 client half ----------
assert.match(clientSource, /inject:\s*\['slots',\s*'locale'\]/, 'the client half must declare the services it reads')

function createSandbox() {
  const sandbox = {
    console,
    AbortController,
    fetch: async () => { throw new Error('Offline') },
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, textContent: '', style: {} }),
      head: { appendChild: () => {} },
    },
  }
  sandbox.window = {
    navigator: { languages: ['zh-CN'] },
    setTimeout: () => 0,
    clearTimeout() {},
  }
  sandbox.window.__ModuleLoader__ = { load: (mod) => { sandbox.loaded = mod } }
  vm.createContext(sandbox)
  vm.runInContext(artifact, sandbox)
  assert.equal(sandbox.loaded.id, 'dsh-bottom-info-bar', 'client module id must stay the bundle name')
  return sandbox
}

/** 按 cordis 的 inject 语义构造 ctx：未在 inject 里声明的服务属性一律抛错。 */
function cordisLikeContext(declared, services) {
  const allowed = new Set([...declared, 'get', 'effect', 'inject', 'on', 'once', 'provide'])
  return new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      if (!allowed.has(prop)) {
        if (services[prop] !== undefined) throw new Error('cannot get property "' + prop + '" without inject')
        return undefined
      }
      if (prop === 'get') return (name) => services[name]
      if (prop === 'effect') return (fn) => (typeof fn === 'function' ? fn() : undefined)
      if (prop === 'inject') return () => {}
      return services[prop]
    },
  })
}

function createLocaleService(active) {
  const namespaces = new Map()
  let current = active
  return {
    setActive: (id) => { current = id },
    register: (ns, dicts) => {
      assert.deepEqual(JSON.parse(JSON.stringify(dicts)), LOCALES, 'the client must register the source dictionary verbatim')
      namespaces.set(ns, dicts)
      return () => namespaces.delete(ns)
    },
    bind: (ns) => (key, params) => {
      const dicts = namespaces.get(ns)
      if (!dicts || !dicts[current] || dicts[current][key] === undefined) return key
      const template = dicts[current][key]
      return params ? template.replace(/\{(\w+)\}/g, (m, name) => (params[name] === undefined ? m : String(params[name]))) : template
    },
    subscribe: () => () => {},
  }
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.children) return node.children.map(textOf).join('')
  return ''
}

function reactStub() {
  return {
    // 必须是普通函数：箭头函数没有自己的 arguments，children 会永远是空数组。
    createElement: function (type, props) { return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }; },
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (value) => ({ current: value }),
    useEffect: () => {},
    useLayoutEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    cloneElement: (node, props) => ({ ...node, props: { ...node.props, ...props } }),
  }
}

async function boot(options) {
  const sandbox = createSandbox()
  if (options.navigatorLanguages) sandbox.window.navigator = { languages: options.navigatorLanguages }
  const registry = {}
  const localeService = options.locale === false ? null : createLocaleService(options.locale || 'zh')
  const services = {
    slots: {
      inject: (name, callback) => { callback(); return () => {} },
      register: (entry, component) => {
        if (entry.name === 'plugins.bundle.config') registry.config = { entry, component }
        else registry.dock = component
        return () => {}
      },
    },
  }
  if (localeService) services.locale = localeService
  const React = reactStub()
  const requireStub = (name) => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    if (name === 'react-dom') return {}
    throw new Error('unexpected module request: ' + name)
  }
  const plugin = sandbox.loaded.factory(requireStub)
  const declared = options.declared || plugin.inject
  await plugin.apply(cordisLikeContext(declared, services))
  assert.ok(registry.config && typeof registry.config.component === 'function', 'the configuration entry must register through the slot')
  return {
    label: () => registry.config.entry.label(),
    summary: registry.config.component({ view: 'summary' }),
  }
}

// 正常宿主：locale 服务在 inject 名单里，能取到中英字典
const bootedZh = await boot({ locale: 'zh' })
assert.equal(bootedZh.label(), LOCALES.zh['meta.title'], 'the page label must follow the active language')
assert.equal(textOf(bootedZh.summary), LOCALES.zh['meta.description'], 'the summary must show the active description')
const bootedEn = await boot({ locale: 'en' })
assert.equal(bootedEn.label(), LOCALES.en['meta.title'], 'the English label must match locale/en.json')
assert.equal(textOf(bootedEn.summary), LOCALES.en['meta.description'], 'the English summary must match locale/en.json')

// 事故回归：宿主不给 locale（或访问就抛 cannot get property "locale" without inject）时，
// apply 绝不能崩 —— 崩了整块配置区会静默消失，页面只剩宿主渲染的标题和描述。
const noLocale = await boot({ locale: false, navigatorLanguages: ['zh-CN'] })
assert.equal(noLocale.label(), LOCALES.zh['meta.title'], 'without the locale service the browser language decides (zh-CN → zh)')
const noLocaleEn = await boot({ locale: false, navigatorLanguages: ['en-US', 'en'] })
assert.equal(noLocaleEn.label(), LOCALES.en['meta.title'], 'without the locale service the browser language decides (en-US → en)')
// 事故回归：未在 inject 名单里授权时，ctx.locale 会抛 cannot get property "locale" without inject。
// 客户端必须不崩：退回 ctx.get('locale')（cordis 的合法取值方式）—— 取到了就按它翻，
// 彻底取不到（服务缺席）才用浏览器语言。崩了整块配置区会静默消失。
const undeclaredLocale = await boot({ declared: ['slots'], locale: 'en' })
assert.equal(undeclaredLocale.label(), LOCALES.en['meta.title'],
  'a ctx that throws on ctx.locale must fall back to ctx.get("locale") instead of breaking apply')
const noServiceAtAll = await boot({ declared: ['slots'], locale: false, navigatorLanguages: ['zh-CN'] })
assert.equal(noServiceAtAll.label(), LOCALES.zh['meta.title'],
  'without any reachable locale service the browser language decides')

// ---------- 7. 产物必须已重建（lib 入库，CI 检查 git diff） ----------
assert.ok(artifact.includes(LOCALES.en['meta.description']) && artifact.includes(LOCALES.zh['meta.description']),
  'built client must carry both descriptions (run npm run build)')
assert.ok(artifact.includes(LOCALES.en['error.request.http']), 'built client must carry the translated error copy (run npm run build)')

// ---------- 8. cordis.patch.yml：行 id ≠ 模块名 ----------
const rowId = patchSource.match(/^\s*-\s*id:\s*(\S+)/m)
const rowName = patchSource.match(/^\s*name:\s*'?([^'\n]+)'?/m)
assert.ok(rowId && rowName, 'cordis.patch.yml must mount exactly one row with id and name')
assert.equal(rowName[1].trim(), pkg.name, 'the row name must stay the package name (it is the module this package exports)')
assert.notEqual(rowId[1].trim(), pkg.name,
  'the row id must differ from the module name: DSH prints both on separate lines and skips one only when it equals the row title')

console.log('bilingual copy contract OK (locale meta + dictionaries + host error codes + cordis ctx + patch row id)')
