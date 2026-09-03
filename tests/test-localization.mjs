// Exercise rendered English copy and the unfiltered host checker without real RPCs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

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

const states = [{ fields: {}, colors: {}, configVersion: 0 }, 'ready', null, null, null, false, {}]
let stateIndex = 0
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState(initial) {
    const index = stateIndex++
    if (index >= states.length) states[index] = initial
    return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
  },
  useRef: (initial) => ({ current: initial }),
  useEffect() {},
  useCallback: (fn) => fn,
}
let plugin
let settings
const slots = {
  inject: (_, register) => register(),
  register(options, component) {
    if (options.name === 'settings.section') settings = component
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
await plugin.apply({ slots, get: () => null, effect() {} })
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
assert.doesNotMatch(text(render()), /\p{Script=Han}|[「」]/u)
console.log('PASS  Failed field saves use English punctuation and preserve rollback behavior')
