const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(__dirname + '/../plugin/src/locales.js', 'utf8');
const dictionaries = JSON.parse(source.slice(source.indexOf('{')));
function format(locale, key, params) {
  assert.ok(Object.hasOwn(dictionaries[locale], key), 'Missing translation: ' + key);
  return dictionaries[locale][key].replace(/\{(\w+)\}/g, (match, name) =>
    params && Object.hasOwn(params, name) ? String(params[name]) : match);
}
// Public LocaleFace test double. No plugin-owned locale state is simulated.
function createLocale(active = 'zh') {
  let snapshot = { active, revision: 0 };
  const listeners = new Set();
  const registry = new Map();
  const bound = new Map();
  return {
    register(namespace, entries) {
      assert.ok(!registry.has(namespace), 'Duplicate namespace');
      assert.deepEqual(JSON.parse(JSON.stringify(entries)), dictionaries, 'Built dictionaries must match source');
      registry.set(namespace, entries);
      return () => registry.delete(namespace);
    },
    bind(namespace) {
      if (!bound.has(namespace)) bound.set(namespace, (key, params) => {
        const entries = registry.get(namespace);
        assert.ok(entries && Object.hasOwn(entries[snapshot.active], key), 'Missing translation: ' + key);
        return entries[snapshot.active][key].replace(/\{(\w+)\}/g, (match, name) =>
          params && Object.hasOwn(params, name) ? String(params[name]) : match);
      });
      return bound.get(namespace);
    },
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setLocale(active) { snapshot = { active, revision: snapshot.revision + 1 }; listeners.forEach(fn => fn()); },
  };
}
module.exports = { dictionaries, createLocale, t: (key, params) => format('zh', key, params) };
