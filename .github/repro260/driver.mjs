#!/usr/bin/env node
/**
 * Issue #260 reproduction driver (temporary, branch-only).
 *
 * Boots DSH NEXT's real Node-mode Host without the Electron shell UI, loads the
 * Desktop profile with an optional copy of dsh-bottom-info-bar, then probes the
 * Host port and captures a native stack if the Host stops answering.
 *
 * Inputs (env):
 *   APP_DIR         extracted DSH NEXT application directory
 *   APP_RESOURCES   directory containing app.asar and runtime/ (default: <APP_DIR>/resources)
 *   ELECTRON_BIN    Electron executable to run in Node mode
 *   ARCH            runtime arch directory under runtime/ (x64 | arm64)
 *   NEXT_HOME       disposable DSH NEXT home
 *   OUT_DIR         artifact directory
 *   VARIANT         on | off  (whether the plugin is installed into the profile)
 *   PLUGIN_SRC      unpacked dsh-bottom-info-bar package directory (variant on)
 *   RUNS            number of runs (default 3)
 *   T12_MS          probe start in ms after spawn (default 8000)
 */
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'

const real = (path) => { try { return realpathSync(path) } catch { return path } }
const env = process.env
const APP_DIR = env.APP_DIR
const RES = env.APP_RESOURCES || join(APP_DIR, 'resources')
const ELECTRON = env.ELECTRON_BIN
const ARCH = env.ARCH || (existsSync(join(RES, 'runtime', 'x64')) ? 'x64' : 'arm64')
const HOME_RAW = env.NEXT_HOME
mkdirSync(HOME_RAW, { recursive: true })
const HOME = realpathSync(HOME_RAW)
const OUT = env.OUT_DIR || join(process.cwd(), 'repro-out')
const VARIANT = env.VARIANT === 'on' ? 'on' : 'off'
const RUNS = Number(env.RUNS || 3)
const PLUGIN = env.PLUGIN_SRC
const IS_LINUX = process.platform === 'linux'
const T12 = Number(env.T12_MS || 8000)
const PROFILE = join(HOME, 'profiles', 'desktop')
const APP_PKG = real(join(RES, 'app.asar'))
const PRIMARY = real(join(RES, 'runtime', ARCH, 'primary-runtime'))
const HOST_ENTRY = join(APP_PKG, 'lib', 'host.js')

mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const stamp = () => new Date().toISOString()
const log = (...args) => console.log(`[driver ${stamp()}]`, ...args)

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 15000 }).trim()
  } catch {
    return ''
  }
}

function installExtras(deps) {
  const src = env.EXTRA_PLUGINS_SRC
  const names = (env.EXTRA_PLUGINS || '').split(',').map((item) => item.trim()).filter(Boolean)
  if (!src || names.length === 0) return
  for (const name of names) {
    const from = join(src, name)
    if (!existsSync(join(from, 'package.json'))) { console.log(`[driver] missing extra plugin ${name}`); continue }
    const dest = join(PROFILE, 'node_modules', name)
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(from, dest, { recursive: true })
    deps[name] = '*'
  }
}

function prepareHome() {
  rmSync(HOME, { recursive: true, force: true })
  mkdirSync(join(PROFILE, 'node_modules'), { recursive: true })
  const deps = {}
  installExtras(deps)
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  if (VARIANT === 'on') {
    if (!PLUGIN || !existsSync(join(PLUGIN, 'package.json'))) throw new Error(`missing plugin package: ${PLUGIN}`)
    const dest = join(PROFILE, 'node_modules', 'dsh-bottom-info-bar')
    cpSync(PLUGIN, dest, { recursive: true })
    bundles.push('dsh-bottom-info-bar')
  }
  writeFileSync(join(PROFILE, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: deps,
    dsh: {
      desktopNextPlugins: 1,
      desktopNextScheduleBundle: 2,
      desktopNextOnboarding: { version: 1, outcome: 'completed' },
      profile: { bundles },
    },
  }, null, 2) + '\n')
  writeFileSync(join(PROFILE, 'cordis.patch.yml'), env.COMPUTER_USE === 'on'
    ? '- id: computer-use-cua-driver-native\n  disabled: false\n'
    : '[]\n')
}

function snapshotProc(pid) {
  const out = { at: Date.now(), pid }
  try { out.cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ') } catch {}
  try { out.environ = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).filter((line) => /ELECTRON_RUN_AS_NODE|DSH_HOME|DSH_NEXT/.test(line)).join(' ') } catch {}
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')
    out.cpuTicks = { utime: Number(stat[13]), stime: Number(stat[14]), threads: Number(stat[19]) }
    out.state = stat[2]
  } catch {}
  try { out.threads = readdirSync(`/proc/${pid}/task`).map((tid) => {
    const read = (file) => { try { return readFileSync(`/proc/${pid}/task/${tid}/${file}`, 'utf8').trim() } catch { return '' } }
    return { tid, comm: read('comm'), wchan: read('wchan') }
  }) } catch {}
  try { out.mainSyscall = readFileSync(`/proc/${pid}/task/${pid}/syscall`, 'utf8').trim() } catch (error) { out.mainSyscallError = String(error.code || error) }
  try { out.mainWchan = readFileSync(`/proc/${pid}/task/${pid}/wchan`, 'utf8').trim() } catch {}
  try { out.fdCount = readdirSync(`/proc/${pid}/fd`).length } catch {}
  try { out.fds = readdirSync(`/proc/${pid}/fd`).map((fd) => {
    try { return `${fd} -> ${readFileSync(`/proc/${pid}/fdinfo/${fd}`, 'utf8').trim().split('\n')[0]}` } catch { return fd }
  }).slice(0, 400) } catch {}
  return out
}

function snapshotLibs(pid) {
  try {
    const maps = readFileSync(`/proc/${pid}/maps`, 'utf8')
    const paths = [...new Set(maps.split('\n').map((line) => line.split(/\s+/).pop()).filter((path) => path && path.startsWith('/')))]
    return { libCount: paths.length, interesting: paths.filter((path) => /libglib|libgio|libgtk|libdbus|libsystemd|libudev|libatspi|libsecret|sqlite|cua|ubjs|meshcall|\.node$/i.test(path)) }
  } catch (error) { return { error: String(error) } }
}

function stackLinux(pid, file) {
  const commands = [
    ['gdb', ['-p', String(pid), '-batch', '-ex', 'set pagination off', '-ex', 'info threads', '-ex', 'thread apply all bt full']],
    ['eu-stack', ['-p', String(pid)]],
  ]
  let output = ''
  for (const [cmd, args] of commands) {
    try {
      output += `\n===== ${cmd} =====\n` + execFileSync(cmd, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 })
      break
    } catch (error) {
      output += `\n===== ${cmd} FAILED =====\n${error.stdout || ''}${error.stderr || ''}${String(error)}\n`
    }
  }
  writeFileSync(file, output)
  return output.slice(0, 4000)
}

function stackDarwin(pid, file) {
  try {
    const output = execFileSync('sample', [String(pid), '1', '1', '-file', file], { encoding: 'utf8', timeout: 60000 })
    return output.slice(0, 2000)
  } catch (error) { return String(error) }
}

function probe(port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = net.connect({ host: '127.0.0.1', port })
    let connected = false
    const finish = (result) => { try { socket.destroy() } catch {} ; resolve({ ...result, ms: Date.now() - started }) }
    const timer = setTimeout(() => finish({ ok: false, reason: connected ? 'no-response' : 'no-connect' }), timeoutMs)
    socket.on('connect', () => {
      connected = true
      socket.write('GET / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')
    })
    socket.on('data', (chunk) => {
      clearTimeout(timer)
      finish({ ok: true, status: Number(String(chunk).split(' ')[1]) || null })
    })
    socket.on('error', (error) => { clearTimeout(timer); finish({ ok: false, reason: error.code || String(error) }) })
  })
}

function listenerPid(port) {
  const line = sh('ss', ['-ltnp']).split('\n').find((item) => item.includes(`127.0.0.1:${port} `))
  const match = line && /pid=(\d+)/.exec(line)
  return match ? Number(match[1]) : null
}

async function runOnce(run) {
  prepareHome()
  const startedAt = Date.now()
  const logFile = join(OUT, `${VARIANT}-run${run}.log`)
  const result = { run, variant: VARIANT, startedAt: new Date().toISOString(), probes: [], samples: [], ready: null, wedge: false, errors: [] }
  const child = spawn(ELECTRON, [
    '--expose-internals',
    '--max-http-header-size=1048576',
    HOST_ENTRY,
    APP_PKG,
    PROFILE,
    PRIMARY,
  ], {
    cwd: PROFILE,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_HOME: HOME,
      DSH_NEXT_NATIVE_TOKEN: randomBytes(32).toString('base64url'),
      DSH_NEXT_PREFERENCES: JSON.stringify({ port: 0 }),
      DSH_NEXT_TRUSTED_HOSTS: JSON.stringify([]),
      DSH_NEXT_SYSTEM_PROXY: JSON.stringify({}),
      DSH_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  result.pid = child.pid
  let stdout = ''
  let stderr = ''
  let port = null
  let readyAt = null
  child.stdout?.on('data', (chunk) => { stdout += chunk })
  child.stderr?.on('data', (chunk) => { stderr += chunk })
  const exitPromise = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
  child.on('message', (message) => {
    if (message && message.type === 'ready') {
      readyAt = Date.now()
      result.ready = { url: message.url, ms: readyAt - startedAt, at: new Date().toISOString() }
      try { port = Number(new URL(message.url).port) } catch { port = null }
      log(`run ${run} ready in ${readyAt - startedAt}ms: ${message.url}`)
    }
  })
  child.on('error', (error) => result.errors.push(String(error)))

  // Sampler: every 500ms until the run ends.
  let sampling = true
  const sampler = (async () => {
    while (sampling) {
      try {
        const snap = IS_LINUX ? snapshotProc(child.pid) : { at: Date.now(), note: 'darwin' }
        result.samples.push(snap)
      } catch (error) { /* host may already be gone */ }
      await sleep(500)
    }
  })()

  // Wait for readiness or a hard timeout.
  const readyDeadline = Date.now() + 120000
  while (result.ready === null && Date.now() < readyDeadline) {
    const exit = await Promise.race([exitPromise, sleep(500).then(() => null)])
    if (exit) { result.exitEarly = exit; break }
  }

  if (result.ready !== null) {
    // Probe window: fixed offsets after spawn, matching the reporter's t=12s check plus margin.
    for (const offset of [T12, T12 + 2000, T12 + 4000, T12 + 6000, T12 + 8000, T12 + 10000, T12 + 12000]) {
      const wait = startedAt + offset - Date.now()
      if (wait > 0) await sleep(wait)
      const probeResult = await probe(port)
      result.probes.push({ ...probeResult, atMs: Date.now() - startedAt })
      log(`run ${run} probe @${Date.now() - startedAt}ms: ${JSON.stringify(probeResult)}`)
    }
    const late = result.probes.filter((item) => item.atMs >= T12)
    const lateFailures = late.filter((item) => !item.ok && item.reason === 'no-response').length
    result.wedge = lateFailures >= 2 && late.every((item) => !item.ok)
    const hostPid = (IS_LINUX && listenerPid(port)) || child.pid
    result.hostPid = hostPid
    result.serverPid = child.pid
    if (IS_LINUX) {
      result.snapshotWedge = snapshotProc(hostPid)
      result.libs = snapshotLibs(hostPid)
      result.mapsFile = join(OUT, `${VARIANT}-run${run}.maps`)
      try { writeFileSync(result.mapsFile, readFileSync(`/proc/${hostPid}/maps`, 'utf8')) } catch (error) { result.errors.push(`maps: ${error}`) }
      result.gdb = stackLinux(hostPid, join(OUT, `${VARIANT}-run${run}.stack.txt`))
    } else {
      result.gdb = stackDarwin(child.pid, join(OUT, `${VARIANT}-run${run}.sample.txt`))
    }
    result.ss = { listen: sh('ss', ['-ltn']), listening: sh('ss', ['-ltnp']) }
  }

  sampling = false
  await sampler.catch(() => {})
  // Shut the host down gracefully like the shell does, then escalate.
  try { if (child.connected) child.send({ type: 'shutdown' }) } catch {}
  const exit = await Promise.race([exitPromise, sleep(8000).then(() => null)])
  if (!exit) {
    try { child.kill('SIGTERM') } catch {}
    const killed = await Promise.race([exitPromise, sleep(5000).then(() => null)])
    if (!killed) { try { child.kill('SIGKILL') } catch {} }
  }
  sh('pkill', ['-f', HOME])
  writeFileSync(logFile, `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`)
  result.logFile = logFile
  result.stderrTail = stderr.slice(-6000)
  result.stdoutTail = stdout.slice(-2000)
  writeFileSync(join(OUT, `${VARIANT}-run${run}.json`), JSON.stringify(result, null, 2))
  log(`run ${run} done: ready=${result.ready !== null} wedge=${result.wedge}`)
  return result
}

const summary = []
for (let run = 1; run <= RUNS; run++) {
  try {
    summary.push(await runOnce(run))
  } catch (error) {
    summary.push({ run, error: String(error && error.stack || error) })
  }
}
writeFileSync(join(OUT, `${VARIANT}-summary.json`), JSON.stringify(summary, null, 2))
const wedged = summary.filter((item) => item.wedge).length
log(`SUMMARY variant=${VARIANT} runs=${summary.length} wedged=${wedged}`)
