import { LOCALES } from './locales.js'

// Host-only presentation: DSH's browser registry is not a host service.
// Read the supported persisted preference on demand, never copy locale state.
//
// v1.10.1 / alpha1 crash fix (DSH boot): a cordis context proxy throws
// "cannot get property 'settings' without inject" whenever a plugin touches
// ctx.settings without declaring it in `inject`. Cordis contexts are therefore
// handled only through declaration-style injection below. Direct-property and
// ctx.get fallbacks remain limited to plain non-cordis test/legacy hosts.
function readHostSettings(ctx) {
  if (!ctx || typeof ctx.inject === 'function') return undefined
  if (typeof ctx.get === 'function') {
    try { return ctx.get('settings') } catch { return undefined }
  }
  try { return ctx.settings } catch { return undefined }
}

// DSH 0.1.7 起 settings 服务换了实现（@deepseek-ai/dsh-settings 的 SettingsForms）：
// 旧的 settings.get(ns) 被整块移除，只剩 describe() / update() / replace() / mutate()，
// 描述项形如 [{ ns: 'locale', value: { preference: 'en' }, … }]。
// 这里按宿主能力择优读取：先认新宿主的 describe()，再退回旧宿主的 get(ns)，
// 都认不出来就用 zh —— 读不到语言绝不能抛错（宿主语言只是显示层细节）。
export function readHostLocalePreference(settings) {
  if (!settings || typeof settings !== 'object') return undefined
  if (typeof settings.describe === 'function') {
    try {
      const described = settings.describe()
      if (Array.isArray(described)) {
        for (const entry of described) {
          if (!entry || entry.ns !== 'locale') continue
          const value = entry.value
          if (value && typeof value.preference === 'string') return value.preference
        }
      }
    } catch { /* 落到旧宿主路径 */ }
  }
  if (typeof settings.get === 'function') {
    try {
      const value = settings.get('locale')
      if (value && typeof value.preference === 'string') return value.preference
    } catch { /* 读不到就按默认语言 */ }
  }
  return undefined
}

export function createHostTranslator(ctx) {
  let injectedSettings
  if (ctx && typeof ctx.inject === 'function') {
    try {
      ctx.inject(['settings'], function (settingsCtx) {
        injectedSettings = settingsCtx.settings
      })
    } catch { /* older hosts without declarative injection: use the safe default locale */ }
  }
  // 「当前是哪种语言」只在这一个地方判定。需要按语言做非文案决定的调用方
  // （例如向宿主账号服务上报 locale 参数）读 translate.locale()，
  // 不要各自再读一次 settings —— 判定逻辑写两遍，两边迟早会分叉。
  function activeLocale() {
    const settings = injectedSettings || readHostSettings(ctx)
    return readHostLocalePreference(settings) === 'en' ? 'en' : 'zh'
  }
  const translate = function (key, params) {
    return formatHostText(activeLocale(), key, params)
  }
  translate.locale = activeLocale
  // Only presentation fields are localized at serialization. Cached snapshots
  // keep their original shape, identifiers, amounts, and refresh schedule.
  translate.json = function (key, value) {
    return ['message', 'warning', 'label', 'note', 'plan', 'displayName'].includes(key)
      ? localizeHostText(value, translate, LOCALES) : value
  }
  return translate
}

export function formatHostText(locale, key, params) {
  const template = LOCALES[locale === 'en' ? 'en' : 'zh'][key]
  if (template === undefined) {
    console.warn('[dsh-bottom-info-bar] missing locale key: ' + key)
    return key
  }
  return template.replace(/\{(\w+)\}/g, function (match, name) {
    return params && Object.hasOwn(params, name) ? String(params[name]) : match
  })
}

// Existing RPCs expose text rather than translation metadata. Recognize only
// dictionary-owned text; leave provider/system details untouched. DSH still
// supplies the client translator and owns the active language.
// 反查索引：原来对每个字符串遍历全部字典键两次（精确一次 + 模板一次），每次信息栏渲染
// 都要跑。语义原样保留（首个命中 wins、键序与原来一致），只是把两趟扫描预计算成精确 Map +
// 模板表，按传入的 dictionaries 对象缓存（测试传自造字典时各自建一份）。
// 索具与缓存都收在这个函数体内：构建脚本把本函数整体 `.toString()` 注入客户端 bundle，
// 拆出去的帮手跟不过去（localizeIndex is not defined），所以不许再拆第二函数。
export function localizeHostText(message, translate, dictionaries) {
  if (typeof message !== 'string' || message.length === 0) return message
  const cache = localizeHostText.cache || (localizeHostText.cache = new WeakMap())
  let index = cache.get(dictionaries)
  if (!index) {
    const zh = dictionaries.zh || {}
    const en = dictionaries.en || {}
    const exact = new Map()
    const templates = []
    for (const key of Object.keys(zh)) {
      for (const language of ['zh', 'en']) {
        const value = language === 'zh' ? zh[key] : en[key]
        if (typeof value === 'string' && !exact.has(value)) exact.set(value, key)
      }
      // host.* 是宿主自述文案；error.* 是「宿主错误码 → 中英文案」的同一批句子（v1.15 起错误键改名为
      // error.<code>），两者都可能出现在旧快照的 message 里，都要能按模板反查回客户端语言。
      if (key.startsWith('host.') || key.startsWith('error.')) {
        for (const language of ['zh', 'en']) {
          const template = language === 'zh' ? zh[key] : en[key]
          if (typeof template !== 'string' || !/\{\w+\}/.test(template)) continue
          const names = []
          const pattern = template.split(/(\{\w+\})/).map(function (part) {
            if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '([\\s\\S]*?)' }
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          }).join('')
          templates.push({ key: key, names: names, re: new RegExp('^' + pattern + '$') })
        }
      }
    }
    index = { exact: exact, templates: templates }
    cache.set(dictionaries, index)
  }
  if (index.exact.has(message)) return translate(index.exact.get(message))
  for (const entry of index.templates) {
    const match = entry.re.exec(message)
    if (match) {
      const params = {}
      entry.names.forEach(function (name, number) { params[name] = match[number + 1] })
      return translate(entry.key, params)
    }
  }
  return message
}
