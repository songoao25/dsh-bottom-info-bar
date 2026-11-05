// Startup policy guards for issue #260.
//
// DSH NEXT (Linux) stopped accepting new TCP connections ~10s after the host booted when this
// plugin was the only third-party plugin enabled. The plugin cannot prove the host-side cause from
// here, so the reviewable contract is:
//   1) apply() does not start a registry request during the host boot window;
//   2) the first self-update check runs after the boot window (default 30s + 0-5s jitter), and the
//      delay is overridable only through the documented diagnostic env var;
//   3) startup tracing is opt-in, unref'd and disposable, and reports fd/handle/event-loop-lag data
//      that can tell a plugin-side block apart from a host-side one.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SELF_UPDATE_DEFAULT_DELAY_MS,
  SELF_UPDATE_JITTER_MS,
  SELF_UPDATE_MAX_DELAY_MS,
  selfUpdateDelayMs,
} from '../src/self-update.js'
import {
  EVENT_LOOP_LAG_ALERT_MS,
  EVENT_LOOP_SAMPLE_MS,
  STARTUP_TRACE_ENV,
  STARTUP_TRACE_OFFSETS_MS,
  countOpenFds,
  createStartupTrace,
  isStartupTraceEnabled,
} from '../src/startup-trace.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const checks = []
function check(name, run) {
  run()
  checks.push(name)
}

// ---------- 1) 自更新延迟：必须晚于宿主启动窗口 ----------
check('self-update delay defaults past the host boot window', () => {
  assert.ok(SELF_UPDATE_DEFAULT_DELAY_MS >= 30000, 'default self-update delay must be >= 30s')
  assert.ok(SELF_UPDATE_JITTER_MS > 0, 'self-update delay must be jittered')
  assert.equal(selfUpdateDelayMs({}, () => 0), SELF_UPDATE_DEFAULT_DELAY_MS)
  assert.equal(selfUpdateDelayMs({}, () => 0.5), SELF_UPDATE_DEFAULT_DELAY_MS + 2500)
  // random() === 1 is out of contract, but the delay must still stay bounded.
  assert.equal(selfUpdateDelayMs({}, () => 1), SELF_UPDATE_DEFAULT_DELAY_MS + SELF_UPDATE_JITTER_MS)
  assert.equal(selfUpdateDelayMs({}, () => 0.999999), SELF_UPDATE_DEFAULT_DELAY_MS + 4999)
})

check('self-update delay env override is validated and clamped', () => {
  const env = (value) => ({ DSH_BOTTOM_INFO_BAR_SELF_UPDATE_DELAY_MS: value })
  assert.equal(selfUpdateDelayMs(env('0'), () => 0), 0)
  assert.equal(selfUpdateDelayMs(env('1200'), () => 0), 1200)
  assert.equal(selfUpdateDelayMs(env('1200.5'), () => 0), SELF_UPDATE_DEFAULT_DELAY_MS, 'non-integer must be ignored')
  assert.equal(selfUpdateDelayMs(env('-1'), () => 0), SELF_UPDATE_DEFAULT_DELAY_MS)
  assert.equal(selfUpdateDelayMs(env('abc'), () => 0), SELF_UPDATE_DEFAULT_DELAY_MS)
  assert.equal(selfUpdateDelayMs(env(String(SELF_UPDATE_MAX_DELAY_MS * 10)), () => 0), SELF_UPDATE_MAX_DELAY_MS)
})

// ---------- 2) 启动诊断：默认关闭、定时器 unref、可清理 ----------
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
    setInterval: (fn, delay) => add('interval', fn, delay),
    clearTimeout: remove,
    clearInterval: remove,
    now: () => current,
    advance(ms) {
      current += ms
      for (;;) {
        const due = timers.filter((timer) => timer.due <= current).sort((a, b) => a.due - b.due)[0]
        if (!due) return
        if (due.kind === 'interval') due.due += due.delay
        else remove(due)
        due.fn()
      }
    },
    pending: () => timers.length,
    timers,
  }
}

check('startup trace is off by default and schedules nothing', () => {
  const lines = []
  const timers = fakeTimers()
  const trace = createStartupTrace({ env: {}, log: (line) => lines.push(line), now: timers.now, setTimeout: timers.setTimeout, setInterval: timers.setInterval, clearTimeout: timers.clearTimeout, clearInterval: timers.clearInterval, pid: 42 })
  assert.equal(trace.enabled, false)
  assert.equal(trace.start(), false)
  assert.equal(lines.length, 0)
  assert.equal(timers.pending(), 0)
})

check('startup trace samples apply/schedule/lag and unrefs every timer', () => {
  const lines = []
  const timers = fakeTimers()
  const trace = createStartupTrace({
    env: { [STARTUP_TRACE_ENV]: '1' },
    log: (line) => lines.push(line),
    now: timers.now,
    setTimeout: timers.setTimeout,
    setInterval: timers.setInterval,
    clearTimeout: timers.clearTimeout,
    clearInterval: timers.clearInterval,
    countFds: () => 17,
    countHandles: () => 9,
    pid: 42,
  })
  assert.equal(trace.enabled, true)
  assert.equal(trace.start(), true)
  assert.equal(lines.length, 1, 'apply stage must be the first record')
  const first = JSON.parse(lines[0].replace('[dsh-bottom-info-bar] startup-trace ', ''))
  assert.deepEqual(first, { stage: 'apply', t: 0, pid: 42, fds: 17, handles: 9 })
  assert.equal(timers.pending(), STARTUP_TRACE_OFFSETS_MS.length + 1, 'one timer per sample offset plus the lag interval')
  for (const timer of timers.timers) assert.ok(timer.unrefCalls > 0, 'diagnostic timers must not keep the process alive')

  timers.advance(2000)
  const sampled = JSON.parse(lines.at(-1).replace('[dsh-bottom-info-bar] startup-trace ', ''))
  assert.equal(sampled.stage, 't+2000')
  assert.equal(sampled.t, 2000)

  // A 3s jump on a 1s sampler means the event loop was blocked ~2s.
  timers.advance(3000)
  const lag = JSON.parse(lines.at(-1).replace('[dsh-bottom-info-bar] startup-trace ', ''))
  assert.equal(lag.stage, 'event-loop-lag')
  assert.ok(lag.lagMs >= EVENT_LOOP_LAG_ALERT_MS)
  assert.ok(lag.lagMs >= 1500)
})

check('startup trace dispose clears timers and silences further records', () => {
  const lines = []
  const timers = fakeTimers()
  const trace = createStartupTrace({
    env: { [STARTUP_TRACE_ENV]: '1' },
    log: (line) => lines.push(line),
    now: timers.now,
    setTimeout: timers.setTimeout,
    setInterval: timers.setInterval,
    clearTimeout: timers.clearTimeout,
    clearInterval: timers.clearInterval,
    countFds: () => 1,
    countHandles: () => 1,
  })
  trace.start()
  const before = lines.length
  assert.equal(timers.pending(), STARTUP_TRACE_OFFSETS_MS.length + 1)
  trace.dispose()
  assert.equal(timers.pending(), 0, 'dispose must cancel every timer')
  timers.advance(60000)
  assert.equal(lines.length, before, 'a disposed trace must stay silent')
  assert.equal(EVENT_LOOP_SAMPLE_MS, 1000)
})

check('fd counting degrades to null instead of throwing', () => {
  assert.equal(countOpenFds('/definitely-not-a-proc-directory'), null)
  assert.equal(isStartupTraceEnabled({}), false)
  assert.equal(isStartupTraceEnabled({ [STARTUP_TRACE_ENV]: 'true' }), false, 'only the literal "1" enables tracing')
  assert.equal(isStartupTraceEnabled({ [STARTUP_TRACE_ENV]: '1' }), true)
})

// ---------- 3) 源码契约：启动路径不预热、诊断入口/构建产物对齐 ----------
check('apply() no longer prewarms the registry in the host boot path', () => {
  const hostSource = readFileSync(join(root, 'src', 'host.js'), 'utf8')
  assert.ok(
    !/^[ \t]*latestVersion\(\)[ \t]*$/m.test(hostSource),
    'apply() must not call latestVersion() as a bare boot-time prewarm (issue #260)',
  )
  assert.match(hostSource, /const SELF_UPDATE_DELAY_MS = selfUpdateDelayMs\(process\.env\)/)
  assert.match(hostSource, /createStartupTrace\(\{\}\)/)
  assert.match(hostSource, /startupTrace\.dispose\(\)/)
})

check('startup trace module is built into lib/ and imported by the host entry', () => {
  const buildSource = readFileSync(join(root, 'scripts', 'build.mjs'), 'utf8')
  assert.match(buildSource, /'startup-trace\.js'/, 'scripts/build.mjs must copy startup-trace.js into lib/')
  const builtTrace = join(root, 'lib', 'startup-trace.js')
  assert.ok(existsSync(builtTrace), 'lib/startup-trace.js must exist after the build')
  const builtHost = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  assert.match(builtHost, /from '\.\/startup-trace\.js'/, 'the built host entry must import its built sibling')
  assert.ok(
    !/^[ \t]*latestVersion\(\)[ \t]*$/m.test(builtHost),
    'the built host entry must not reintroduce the boot-time prewarm',
  )
})

// ---------- 4) issue #260：宿主主线程不再同步碰 sqlite ----------
check('host no longer owns the synchronous ledger store (sqlite moved to a worker thread)', () => {
  const hostSource = readFileSync(join(root, 'src', 'host.js'), 'utf8')
  assert.ok(!/from '\.\/ledger-store\.js'/.test(hostSource), 'host must not import the synchronous ledger store')
  assert.ok(!/openLedgerStore\s*\(/.test(hostSource), 'host must not call openLedgerStore')
  assert.ok(!/DatabaseSync/.test(hostSource), 'host must not reference node:sqlite')
  assert.match(hostSource, /from '\.\/ledger-client\.js'/, 'host must talk to the ledger through the async worker client')
  assert.match(hostSource, /createLedgerClient\(/, 'host must create the worker-backed ledger client')
})

check('ledger worker and shared accounting engine are built into lib/', () => {
  const buildSource = readFileSync(join(root, 'scripts', 'build.mjs'), 'utf8')
  for (const file of ['accounting.js', 'ledger-client.js', 'ledger-worker.js']) {
    assert.ok(buildSource.includes("'" + file + "'"), 'scripts/build.mjs must copy ' + file)
    assert.ok(existsSync(join(root, 'lib', file)), 'lib/' + file + ' must exist after the build')
  }
  const workerSource = readFileSync(join(root, 'src', 'ledger-worker.js'), 'utf8')
  assert.match(workerSource, /openLedgerStore\(/, 'the worker owns the synchronous store')
  assert.match(workerSource, /createAccounting\(\)/, 'the worker prices records with the shared accounting engine')
})

console.log(`startup policy OK (${checks.length} checks)`)
