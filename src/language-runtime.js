// Injected into each client bundle at build time; keep this function self-contained.
export function createLanguageRuntime(namespace, dictionaries, service, environment) {
  const env = environment || (typeof window !== 'undefined' ? window : {});
  const storageKey = namespace + ':language';
  const listeners = new Set();
  const labels = {
    zh: '简体中文', 'zh-hant': '繁體中文', en: 'English', ja: '日本語', ko: '한국어',
    es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', it: 'Italiano',
    ru: 'Русский', hi: 'हिन्दी', id: 'Bahasa Indonesia',
  };
  function normalize(tag) {
    const value = String(tag || '').toLowerCase().replace(/_/g, '-');
    if (/^zh-(hant|tw|hk|mo)(-|$)/.test(value)) return dictionaries['zh-hant'] ? 'zh-hant' : 'zh';
    if (dictionaries[value]) return value;
    const base = value.split('-')[0];
    return dictionaries[base] ? base : undefined;
  }
  function readPreference() {
    try {
      const saved = env.localStorage && env.localStorage.getItem(storageKey);
      return saved && Object.hasOwn(dictionaries, saved) ? saved : 'auto';
    } catch { return 'auto'; }
  }
  let preference = readPreference();
  let bound;
  try { bound = service && typeof service.bind === 'function' ? service.bind(namespace) : undefined; } catch { /* fall back to dictionaries */ }
  function hostLanguage() {
    try {
      const snapshot = service && (typeof service.getSnapshot === 'function' ? service.getSnapshot()
        : typeof service.getLocale === 'function' ? service.getLocale() : undefined);
      if (snapshot && typeof snapshot.active === 'string') return snapshot.active;
      // Older hosts expose only bind(): identify the locale using a unique built-in phrase.
      if (bound) {
        const description = bound('meta.description');
        const language = Object.keys(dictionaries).find(id => dictionaries[id]['meta.description'] === description);
        if (language) return language;
      }
      return undefined;
    } catch { return undefined; }
  }
  function browserLanguage() {
    const nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : {});
    for (const tag of nav.languages && nav.languages.length ? nav.languages : [nav.language]) {
      const language = normalize(tag);
      if (language) return language;
    }
    return 'en';
  }
  function activeLanguage() {
    if (preference !== 'auto') return preference;
    const host = hostLanguage();
    return host ? normalize(host) || 'en' : browserLanguage();
  }
  function format(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (match, key) =>
      params && Object.hasOwn(params, key) ? String(params[key]) : match);
  }
  function translate(key, params) {
    // Legacy hosts without snapshots still expose their active language through bind().
    if (preference === 'auto' && !hostLanguage() && bound) {
      try {
        const text = bound(key, params);
        if (typeof text === 'string' && text && text !== key) return format(text, params);
      } catch { /* use the local dictionary */ }
    }
    const dictionary = dictionaries[activeLanguage()] || dictionaries.en;
    return format(dictionary[key] ?? dictionaries.en[key] ?? key, params);
  }
  function notify() { listeners.forEach(listener => listener()); }
  function setPreference(value) {
    if (value !== 'auto' && !Object.hasOwn(dictionaries, value)) throw new Error('Unsupported language');
    // A failed write must not look like a saved preference.
    const storage = env.localStorage;
    if (!storage) throw new Error(translate('language.saveFailed'));
    if (value === 'auto') storage.removeItem(storageKey);
    else storage.setItem(storageKey, value);
    preference = value;
    notify();
  }
  function onStorage(event) {
    if (event.key !== storageKey && event.key !== null) return;
    preference = readPreference();
    notify();
  }
  let unsubscribeHost;
  try { if (service && typeof service.subscribe === 'function') unsubscribeHost = service.subscribe(notify); } catch { /* legacy host */ }
  if (typeof env.addEventListener === 'function') env.addEventListener('storage', onStorage);
  return {
    t: translate, locale: activeLanguage, normalize, preference: () => preference,
    options: () => Object.keys(labels).filter(id => dictionaries[id]).map(id => ({ id, label: labels[id] })),
    setPreference,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      if (typeof unsubscribeHost === 'function') unsubscribeHost();
      if (typeof env.removeEventListener === 'function') env.removeEventListener('storage', onStorage);
      listeners.clear();
    },
  };
}
