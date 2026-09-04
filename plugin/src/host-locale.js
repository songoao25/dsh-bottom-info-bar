import { LOCALES } from './locales.js'

// Host-only presentation: DSH's browser registry is not a host service.
// Read the supported persisted preference on demand, never copy locale state.
//
// v1.10.1 crash fix (DSH boot): a cordis context proxy throws
// "cannot get property 'settings' without inject" whenever a plugin touches
// ctx.settings without declaring it in `inject`. The supported way to read a
// host service is ctx.get(name), which returns undefined when the service is
// not (yet) provided instead of throwing. Prefer ctx.get('settings'); fall
// back to the bare property only for non-cordis hosts that expose it directly.
function readHostSettings(ctx) {
  if (!ctx) return undefined
  if (typeof ctx.get === 'function') {
    try { return ctx.get('settings') } catch { /* unknown host: treat as no settings */ }
  }
  try { return ctx.settings } catch { /* cordis without inject: treat as no settings */ }
  return undefined
}

export function createHostTranslator(ctx) {
  const translate = function (key, params) {
    const settings = readHostSettings(ctx)
    const preference = settings && typeof settings.get === 'function' ? settings.get('locale')?.preference : undefined
    const locale = preference === 'en' ? 'en' : 'zh'
    return formatHostText(locale, key, params)
  }
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
  if (template === undefined) throw new Error('Unknown localization key: ' + key)
  return template.replace(/\{(\w+)\}/g, function (match, name) {
    return params && Object.hasOwn(params, name) ? String(params[name]) : match
  })
}

// Existing RPCs expose text rather than translation metadata. Recognize only
// dictionary-owned text; leave provider/system details untouched. DSH still
// supplies the client translator and owns the active language.
export function localizeHostText(message, translate, dictionaries) {
  if (typeof message !== 'string' || message.length === 0) return message
  for (const key of Object.keys(dictionaries.zh)) {
    if (dictionaries.zh[key] === message || dictionaries.en[key] === message) return translate(key)
  }
  for (const key of Object.keys(dictionaries.zh)) {
    if (!key.startsWith('host.')) continue
    for (const language of ['zh', 'en']) {
      const template = dictionaries[language][key]
      if (!/\{\w+\}/.test(template)) continue
      const names = []
      const pattern = template.split(/(\{\w+\})/).map(function (part) {
        if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '([\\s\\S]*?)' }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }).join('')
      const match = new RegExp('^' + pattern + '$').exec(message)
      if (match) {
        const params = {}
        names.forEach(function (name, index) { params[name] = match[index + 1] })
        return translate(key, params)
      }
    }
  }
  return message
}
