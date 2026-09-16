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

export function createHostTranslator(ctx) {
  let injectedSettings
  if (ctx && typeof ctx.inject === 'function') {
    try {
      ctx.inject(['settings'], function (settingsCtx) {
        injectedSettings = settingsCtx.settings
      })
    } catch { /* older hosts without declarative injection: use the safe default locale */ }
  }
  const translate = function (key, params) {
    const settings = injectedSettings || readHostSettings(ctx)
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
