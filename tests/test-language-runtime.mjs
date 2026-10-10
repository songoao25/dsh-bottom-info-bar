import assert from 'node:assert/strict';
import { createLanguageRuntime } from '../src/language-runtime.js';

const dictionaries = {
  en: { 'meta.description': 'English description', name: 'Hello {name}', 'language.saveFailed': 'Storage failed' },
  zh: { name: '你好 {name}' },
  'zh-hant': { name: '您好 {name}' },
  es: { 'meta.description': 'Descripción en español', name: 'Hola {name}' },
  pt: { name: 'Olá {name}' },
};
function environment(language = 'pt-BR') {
  const values = new Map();
  const events = new Map();
  return {
    navigator: { languages: [language] },
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name),
    events,
  };
}
const env = environment();
let active = 'es-MX';
const hostListeners = new Set();
const notify = () => hostListeners.forEach(fn => fn());
const service = { getSnapshot: () => ({ active }), subscribe: fn => { hostListeners.add(fn); return () => hostListeners.delete(fn); } };
const runtime = createLanguageRuntime('first', dictionaries, service, env);
assert.equal(runtime.t('name', { name: 'Ana' }), 'Hola Ana', 'DSH overrides browser preference');
assert.equal(runtime.normalize('zh-TW'), 'zh-hant');
assert.equal(runtime.normalize('zh-Hant-HK'), 'zh-hant');
assert.equal(runtime.normalize('zh-CN'), 'zh');
assert.equal(runtime.normalize('pt_BR'), 'pt');
let changes = 0;
const stop = runtime.subscribe(() => { changes++; });
active = 'zh'; notify();
assert.equal(runtime.t('name', { name: 'Ana' }), '你好 Ana', 'host changes are immediately visible');
runtime.setPreference('pt');
assert.equal(runtime.t('name', { name: 'Ana' }), 'Olá Ana');
active = 'es'; notify();
assert.equal(runtime.locale(), 'pt', 'independent choice survives DSH switches');
const second = createLanguageRuntime('second', dictionaries, service, env);
assert.equal(second.preference(), 'auto', 'plugins do not share independent preferences');
assert.equal(second.locale(), 'es');
const reloaded = createLanguageRuntime('first', dictionaries, service, env);
assert.equal(reloaded.preference(), 'pt', 'choice survives runtime recreation');
runtime.setPreference('auto');
assert.equal(runtime.locale(), 'es');
active = 'xx-ZZ'; notify();
assert.equal(runtime.locale(), 'en', 'unknown host language falls back to English');
assert.equal(runtime.t('missing'), 'missing');
assert.equal(runtime.t('name', { name: 0 }), 'Hello 0');
assert.ok(changes >= 5);
stop(); runtime.dispose(); second.dispose(); reloaded.dispose();
const browserOnly = createLanguageRuntime('browser', dictionaries, null, environment('pt-BR'));
assert.equal(browserOnly.locale(), 'pt', 'Brazilian Portuguese resolves to Portuguese');
browserOnly.dispose();
const failureEnv = environment('en');
failureEnv.localStorage.setItem = () => { throw new Error('storage blocked'); };
const failed = createLanguageRuntime('failed', dictionaries, null, failureEnv);
assert.throws(() => failed.setPreference('es'), /storage blocked/);
assert.equal(failed.preference(), 'auto', 'failed persistence cannot masquerade as a saved choice');
assert.throws(() => failed.setPreference('xx'), /Unsupported language/);
failed.dispose();
const broken = createLanguageRuntime('broken', dictionaries, { bind() { throw new Error('injection unavailable'); }, getSnapshot() { throw new Error('not ready'); }, subscribe() { throw new Error('unavailable'); } }, environment('zh-TW'));
assert.equal(broken.t('name', { name: 'Ana' }), '您好 Ana', 'unavailable host services preserve a working translation');
broken.dispose();
const crossTabEnv = environment('en');
const crossTab = createLanguageRuntime('tabs', dictionaries, service, crossTabEnv);
let tabChanges = 0;
crossTab.subscribe(() => tabChanges++);
crossTabEnv.localStorage.setItem('tabs:language', 'pt');
crossTabEnv.events.get('storage')({ key: 'other:language' });
assert.equal(tabChanges, 0, 'unrelated plugin preferences are ignored');
crossTabEnv.events.get('storage')({ key: 'tabs:language' });
assert.equal(crossTab.locale(), 'pt', 'another tab can update the preference');
crossTabEnv.localStorage.removeItem('tabs:language');
crossTabEnv.events.get('storage')({ key: null });
assert.equal(crossTab.preference(), 'auto', 'storage clear returns to following DSH');
crossTab.dispose();
assert.equal(crossTabEnv.events.size, 0, 'disposal removes the storage listener');
assert.equal(hostListeners.size, 0, 'disposal removes the DSH subscription');
const legacy = createLanguageRuntime('legacy', dictionaries, { bind: () => key => dictionaries.es[key] || key }, environment('en'));
assert.equal(legacy.t('name', { name: 'Ana' }), 'Hola Ana');
assert.equal(legacy.locale(), 'es', 'legacy UI and OAuth use the same resolved language');
legacy.dispose();
console.log('language runtime behavior: PASS');
