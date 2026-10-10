import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOCALES } from '../src/locales.js';
import { createLanguageRuntime } from '../src/language-runtime.js';
const supported = ['zh', 'zh-hant', 'en', 'ja', 'ko', 'es', 'pt', 'fr', 'de', 'it', 'ru', 'hi', 'id'];
assert.deepEqual(Object.keys(LOCALES).sort(), supported.slice().sort());
const keys = Object.keys(LOCALES.en).sort();
const placeholders = text => [...text.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
for (const language of supported) {
  const dictionary = LOCALES[language];
  assert.deepEqual(Object.keys(dictionary).sort(), keys, language + ': complete key set');
  for (const key of keys) {
    assert.equal(typeof dictionary[key], 'string', language + ': ' + key);
    assert.ok(dictionary[key].trim(), language + ': nonempty ' + key);
    assert.deepEqual(placeholders(dictionary[key]), placeholders(LOCALES.en[key]), language + ': placeholders in ' + key);
  }
  const metadata = JSON.parse(readFileSync(new URL('../locale/' + language + '.json', import.meta.url), 'utf8')).meta;
  assert.equal(metadata.title, dictionary['meta.title']);
  assert.equal(metadata.description, dictionary['meta.description']);
  if (language !== 'en') {
    assert.notEqual(dictionary['meta.description'], LOCALES.en['meta.description'], language + ': description must be translated');
    const translated = keys.filter(key => dictionary[key] !== LOCALES.en[key]).length;
    assert.ok(translated / keys.length > 0.9, language + ': do not replace missing translations with English');
  }
  const runtime = createLanguageRuntime('test', LOCALES, { getSnapshot: () => ({ active: language }) }, {});
  assert.equal(runtime.locale(), language);
  assert.equal(runtime.t('meta.title'), dictionary['meta.title']);
  const params = Object.fromEntries(placeholders(dictionary['language.description']).map(name => [name.slice(1, -1), 'sample']));
  assert.equal(typeof runtime.t('language.description', params), 'string');
  runtime.dispose();
}
console.log('13-language dictionaries, metadata, placeholders and selection: PASS');
