// Boot policy tests for issue #260.
//
// 背景：DSH NEXT（Linux）在只加载本插件时，宿主约 10 秒后不再接受新连接。插件侧无法证明宿主
// 原生层的原因，但可以保证「插件自己的启动刷新不占用宿主 boot 窗口」。这里钉住三件事：
//   1) 默认 normal：行为与之前一致（apply 内立即启动后台刷新）；
//   2) 环境变量只接受 normal / deferred / inert，拼错回退 normal，不会把插件静默关掉；
//   3) deferred：第一次 trigger（页面首个 RPC）或兜底定时器才启动，且幂等、可清理、定时器 unref。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BOOT_MODE_ENV,
  BOOT_MODES,
  DEFERRED_FALLBACK_MS,
  createStartupGate,
  parseBootMode,
} from '../src/boot-policy.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const checks = []
function check(name, run) {
  run()
  checks.push(name)
}

function fakeTimers() {
  let current = 0
  let sequence = 0
  const timers = []
  function add(kind, fn, delay) {
    const timer = { id: ++sequence, kind, fn, delay, due: current + delay, unrefCalls: 0 }
    timer.unref = () => { timer.unrefCalls++ }
    timers.push(timer)
    return timer
  }
  function remove(timer) {
    const index = timers.indexOf(timer)
    if (index !== -1) timers.splice(index, 1)
  }
  return {
    setTimeout: (fn, delay) => add('timeout', fn, delay),
    clearTimeout: remove,
    advance(ms) {
      current += ms
      for (;;) {
        const due = timers.filter((timer) => timer.due <= current).sort((a, b) => a.due - b.due)[0]
        if (!due) return
        remove(due)
        due.fn()
      }
    },
    pending: () => timers.length,
    timers,
  }
}

// ---------- 1) 模式解析 ----------
check('boot mode defaults to normal and rejects unknown values', () => {
  assert.deepEqual(BOOT_MODES, ['normal', 'deferred', 'inert'])
  assert.equal(parseBootMode({}), 'normal')
  assert.equal(parseBootMode(undefined), 'normal')
  assert.equal(parseBootMode({ [BOOT_MODE_ENV]: 'normal' }), 'normal')
  assert.equal(parseBootMode({ [BOOT_MODE_ENV]: 'deferred' }), 'deferred')
  assert.equal(parseBootMode({ [BOOT_MODE_ENV]: 'inert' }), 'inert')
  // 拼错/大小写/空值都回退 normal：环境变量不能把插件静默变哑。
  for (const value of ['def', 'DEFERRED', 'Inert', '', 'lazy', '0', 1, null, {}]) {
    assert.equal(parseBootMode({ [BOOT_MODE_ENV]: value }), 'normal', `unexpected mode for ${String(value)}`)
  }
})

// ---------- 2) normal：立即启动、只启动一次 ----------
check('normal mode runs immediately exactly once', () => {
  const timers = fakeTimers()
  let runs = 0
  const gate = createStartupGate({ mode: 'normal', run: () => { runs += 1 }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
  assert.equal(runs, 1, 'normal mode must start the background refresh during apply')
  assert.equal(gate.started(), true)
  assert.equal(gate.mode, 'normal')
  assert.equal(timers.pending(), 0, 'normal mode schedules no fallback timer')
  gate.trigger()
  assert.equal(runs, 1, 'trigger must be idempotent')
})

// ---------- 3) deferred：首个 RPC 触发或兜底定时器 ----------
check('deferred mode waits for the first page RPC', () => {
  const timers = fakeTimers()
  let runs = 0
  const gate = createStartupGate({ mode: 'deferred', run: () => { runs += 1 }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
  assert.equal(runs, 0, 'deferred mode must not touch the host boot window')
  assert.equal(gate.started(), false)
  assert.equal(timers.pending(), 1, 'one unref fallback timer')
  for (const timer of timers.timers) assert.ok(timer.unrefCalls > 0, 'fallback timer must not keep the process alive')
  assert.equal(gate.trigger(), true)
  assert.equal(runs, 1)
  assert.equal(timers.pending(), 0, 'trigger clears the fallback timer')
  assert.equal(gate.trigger(), false, 'second trigger is a no-op')
  assert.equal(runs, 1)
  timers.advance(DEFERRED_FALLBACK_MS * 2)
  assert.equal(runs, 1)
})

check('deferred mode falls back to the timer when no RPC ever arrives', () => {
  const timers = fakeTimers()
  let runs = 0
  const gate = createStartupGate({ mode: 'deferred', run: () => { runs += 1 }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, fallbackMs: 1234 })
  timers.advance(1233)
  assert.equal(runs, 0)
  timers.advance(1)
  assert.equal(runs, 1)
  assert.equal(gate.started(), true)
})

check('deferred mode disposal cancels the pending fallback', () => {
  const timers = fakeTimers()
  let runs = 0
  const gate = createStartupGate({ mode: 'deferred', run: () => { runs += 1 }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
  gate.dispose()
  assert.equal(timers.pending(), 0)
  timers.advance(DEFERRED_FALLBACK_MS * 2)
  assert.equal(runs, 0, 'a disposed gate must never start')
  assert.equal(gate.trigger(), false, 'trigger after dispose is a no-op')
})

check('startup failures are logged, never thrown into the host', () => {
  const timers = fakeTimers()
  const warnings = []
  const originalWarn = console.warn
  console.warn = (line) => warnings.push(String(line))
  let gate
  try {
    gate = createStartupGate({ mode: 'normal', run: () => { throw new Error('boom') }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout })
  } finally {
    console.warn = originalWarn
  }
  assert.equal(gate.started(), true, 'a failed start still counts as started; the RPC retry path owns recovery')
  assert.equal(timers.pending(), 0)
  assert.match(warnings.join('\n'), /background startup failed: boom/, 'the failure must be logged once')
})

// ---------- 4) 源码/产物契约：host 接线、构建复制、文档同步 ----------
check('host wires the boot gate and the inert bisect mode', () => {
  const hostSource = readFileSync(join(root, 'src', 'host.js'), 'utf8')
  assert.match(hostSource, /import \{ createStartupGate, parseBootMode \} from '\.\/boot-policy\.js'/)
  assert.match(hostSource, /const BOOT_MODE = parseBootMode\(process\.env\)/)
  assert.match(hostSource, /if \(BOOT_MODE === 'inert'\)/, 'inert mode must return before registering anything')
  assert.match(hostSource, /startupGate = createStartupGate\(\{/, 'background work must run through the gate')
  assert.match(hostSource, /if \(startupGate !== null\) startupGate\.trigger\(\)/, 'first RPC must trigger deferred startup')
  assert.match(hostSource, /if \(startupGate !== null\) \{ try \{ startupGate\.dispose\(\) \}/, 'dispose must clean the gate')
  // normal 模式必须仍然立即启动（不能把默认行为改成 deferred）。
  assert.match(hostSource, /mode: BOOT_MODE === 'deferred' \? 'deferred' : 'normal'/)
})

check('boot policy module is built into lib/ and imported by the built host', () => {
  const buildSource = readFileSync(join(root, 'scripts', 'build.mjs'), 'utf8')
  assert.match(buildSource, /'boot-policy\.js'/, 'scripts/build.mjs must copy boot-policy.js into lib/')
  assert.ok(existsSync(join(root, 'lib', 'boot-policy.js')), 'lib/boot-policy.js must exist after the build')
  const builtHost = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  assert.match(builtHost, /from '\.\/boot-policy\.js'/, 'the built host entry must import its built sibling')
})

check('install docs document the boot mode switch', () => {
  const docs = readFileSync(join(root, 'docs', 'INSTALL.md'), 'utf8')
  assert.match(docs, /DSH_BOTTOM_INFO_BAR_BOOT=deferred/, 'docs must explain the deferred diagnostic mode')
  assert.match(docs, /DSH_BOTTOM_INFO_BAR_BOOT=inert/, 'docs must explain the inert bisect mode')
})

console.log(`boot-policy: ${checks.length} checks passed`)
