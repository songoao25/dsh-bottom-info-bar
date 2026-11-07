#!/usr/bin/env node
/**
 * Issue #260 GUI reproduction driver (temporary, branch-only).
 *
 * Launches the real DSH NEXT desktop app (Electron shell + Host), waits for the
 * Host URL, probes it, and captures native stacks if it stops answering. Unlike
 * driver.mjs this exercises the shell's IPC, the page load and plugin RPCs.
 */
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'

const real = (path) => { try { return realpathSync(path) } catch { return path } }
const env = process.env
const APP_DIR = env.APP_DIR
const RES = env.APP_RESOURCES || join(APP_DIR, 'resources')
const ELECTRON = env.ELECTRON_BIN || join(APP_DIR, 'dsh-desktop-next')
const ARCH = env.ARCH || (existsSync(join(RES, 'runtime', 'x64')) ? 'x64' : 'arm64')
const HOME_RAW = env.NEXT_HOME
mkdirSync(HOME_RAW, { recursive: true })
const HOME = realpathSync(HOME_RAW)
const OUT = env.OUT_DIR || join(process.cwd(), 'gui-out')
const VARIANT = env.VARIANT === 'on' ? 'on' : 'off'
const RUNS = Number(env.RUNS || 3)
const PLUGIN = env.PLUGIN_SRC
const PROFILE = join(HOME, 'profiles', 'desktop')
const CONFIG = join(HOME, 'xdg-config')

mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const stamp = () => new Date().toISOString()
const log = (...args) => console.log(`[gui-driver ${stamp()}]`, ...args)
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 15000 }).trim() } catch { return '' } }

function prepare() {
  mkdirSync(join(PROFILE, 'node_modules'), { recursive: true, mode: 0o700 })
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  if (VARIANT === 'on') {
    const dest = join(PROFILE, 'node_modules', 'dsh-bottom-info-bar')
    cpSync(PLUGIN, dest, { recursive: true })
    bundles.push('dsh-bottom-info-bar')
  }
  writeFileSync(join(PROFILE, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: {},
    dsh: {
      desktopNextPlugins: 1,
      desktopNextScheduleBundle: 2,
      desktopNextOnboarding: { version: 1, outcome: 'completed' },
      profile: { bundles },
    },
  }, null, 2) + '\n', { mode: 0o600 })
  writeFileSync(join(PROFILE, 'cordis.patch.yml'), env.COMPUTER_USE === 'on'
    ? '- id: computer-use-cua-driver-native\n  disabled: false\n'
    : '[]\n', { mode: 0o600 })
  // Record the data directory so the shell never shows the "different home" dialog.
  const location = join(CONFIG, 'DSH NEXT', 'home')
  mkdirSync(location, { recursive: true, mode: 0o700 })
  const file = join(location, 'desktop-next-last-home.json')
  writeFileSync(file, JSON.stringify({ home: HOME }, null, 2) + '\n')
  chmodSync(file, 0o600)
}

function probe(port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = net.connect({ host: '127.0.0.1', port })
    let connected = false
    const finish = (result) => { try { socket.destroy() } catch {} ; resolve({ ...result, ms: Date.now() - started }) }
    const timer = setTimeout(() => finish({ ok: false, reason: connected ? 'no-response' : 'no-connect' }), timeoutMs)
    socket.on('connect', () => { connected = true; socket.write('GET / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n') })
    socket.on('data', (chunk) => { clearTimeout(timer); finish({ ok: true, status: Number(String(chunk).split(' ')[1]) || null }) })
    socket.on('error', (error) => { clearTimeout(timer); finish({ ok: false, reason: error.code || String(error) }) })
  })
}

function snapshot(pid) {
  const out = { pid, at: Date.now() }
  try { out.threads = readdirSync(`/proc/${pid}/task`).map((tid) => {
    const read = (file) => { try { return readFileSync(`/proc/${pid}/task/${tid}/${file}`, 'utf8').trim() } catch { return '' } }
    return { tid, comm: read('comm'), wchan: read('wchan'), syscall: read('syscall') }
  }) } catch (error) { out.threadsError = String(error) }
  try { out.mainSyscall = readFileSync(`/proc/${pid}/task/${pid}/syscall`, 'utf8').trim() } catch (error) { out.mainSyscallError = String(error.code || error) }
  try { out.fdCount = readdirSync(`/proc/${pid}/fd`).length } catch {}
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')
    out.cpuTicks = { utime: Number(stat[13]), stime: Number(stat[14]), threads: Number(stat[19]) }
  } catch {}
  return out
}

function stack(pid, file) {
  try {
    const output = execFileSync('gdb', ['-p', String(pid), '-batch', '-ex', 'set pagination off', '-ex', 'info threads', '-ex', 'thread apply all bt full'],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 })
    writeFileSync(file, output)
    return output.slice(0, 4000)
  } catch (error) {
    writeFileSync(file, `gdb failed: ${String(error)}\n${error.stdout || ''}\n${error.stderr || ''}`)
    return String(error)
  }
}

function hostPidFromPort(port) {
  const line = sh('ss', ['-ltnp']).split('\n').find((item) => item.includes(`127.0.0.1:${port} `))
  const match = line && /pid=(\d+)/.exec(line)
  return match ? Number(match[1]) : null
}

async function runOnce(run) {
  // Fresh data directory and shell config for every run: a stale log would make
  // the driver believe a previous run's Host is still there.
  rmSync(HOME, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true, mode: 0o700 })
  prepare()
  const hookLog = '/tmp/ppoll-hook.log'
  try { rmSync(hookLog, { force: true }) } catch {}
  const startedAt = Date.now()
  const result = { run, variant: VARIANT, probes: [], hosts: [], app: null, wedge: false, errors: [] }
  const appLog = join(OUT, `${VARIANT}-gui-run${run}.app.log`)
  const extraArgs = (env.APP_EXTRA_ARGS || '').split(' ').filter(Boolean)
  const app = spawn(ELECTRON, ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', ...extraArgs], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      DSH_DESKTOP_NEXT_HOME: HOME,
      XDG_CONFIG_HOME: CONFIG,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let appOut = ''
  let appErr = ''
  app.stdout.on('data', (chunk) => { appOut += chunk })
  app.stderr.on('data', (chunk) => { appErr += chunk })
  result.app = { pid: app.pid }
  const closePromise = new Promise((resolve) => app.once('close', (code, signal) => resolve({ code, signal })))

  const logFile = join(HOME, 'logs', 'desktop-next.log')
  let port = null
  let hostPid = null
  const deadline = Date.now() + 180000
  while (Date.now() < deadline && port === null) {
    try {
      const text = readFileSync(logFile, 'utf8')
      const matches = [...text.matchAll(/dsh web: http:\/\/127\.0\.0\.1:(\d+)\//g)]
      if (matches.length > 0) {
        port = Number(matches[matches.length - 1][1])
        result.hostReadyMs = Date.now() - startedAt
        log(`run ${run}: host url at ${result.hostReadyMs}ms, port ${port}`)
      }
    } catch {}
    if (port === null) await sleep(500)
  }
  if (port === null) {
    result.errors.push('host url never appeared')
    result.appStderrTail = appErr.slice(-4000)
    result.appStdoutTail = appOut.slice(-2000)
    writeFileSync(appLog, `--- stdout ---\n${appOut}\n--- stderr ---\n${appErr}`)
    try { app.kill('SIGKILL') } catch {}
    writeFileSync(join(OUT, `${VARIANT}-gui-run${run}.json`), JSON.stringify(result, null, 2))
    return result
  }

  // Probe from 12s after launch, like the issue report.
  for (const offset of [12000, 14000, 16000, 18000, 20000]) {
    const wait = startedAt + offset - Date.now()
    if (wait > 0) await sleep(wait)
    const probed = await probe(port)
    result.probes.push({ ...probed, atMs: Date.now() - startedAt })
    log(`run ${run} probe @${Date.now() - startedAt}ms: ${JSON.stringify(probed)}`)
  }
  hostPid = hostPidFromPort(port) || result.app.pid
  result.hostPid = hostPid
  result.hosts.push(snapshot(hostPid))
  result.hosts.push(snapshot(hostPid))
  const late = result.probes.filter((item) => item.atMs >= 12000)
  result.wedge = late.filter((item) => !item.ok && item.reason === 'no-response').length >= 2 && late.every((item) => !item.ok)
  result.mapsFile = join(OUT, `${VARIANT}-gui-run${run}.maps`)
  try { writeFileSync(result.mapsFile, readFileSync(`/proc/${hostPid}/maps`, 'utf8')) } catch (error) { result.errors.push(`maps: ${error}`) }
  if (result.wedge) result.gdb = stack(hostPid, join(OUT, `${VARIANT}-gui-run${run}.stack.txt`))
  result.ss = { listen: sh('ss', ['-ltn']), listening: sh('ss', ['-ltnp']) }

  try { app.kill('SIGTERM') } catch {}
  const closed = await Promise.race([closePromise, sleep(10000).then(() => null)])
  if (!closed) {
    try { app.kill('SIGKILL') } catch {}
  }
  sh('pkill', ['-f', HOME])
  try {
    const shellLog = readFileSync(join(HOME, 'logs', 'desktop-next.log'), 'utf8')
    writeFileSync(join(OUT, `${VARIANT}-gui-run${run}.desktop-next.log`), shellLog)
    result.shellLogTail = shellLog.slice(-8000)
  } catch (error) { result.errors.push(`shell log: ${error}`) }
  try { cpSync(hookLog, join(OUT, `${VARIANT}-gui-run${run}.hook.log`)) } catch {}
  writeFileSync(appLog, `--- stdout ---\n${appOut}\n--- stderr ---\n${appErr}`)
  result.appStderrTail = appErr.slice(-4000)
  result.appStdoutTail = appOut.slice(-2000)
  writeFileSync(join(OUT, `${VARIANT}-gui-run${run}.json`), JSON.stringify(result, null, 2))
  log(`run ${run} done: wedge=${result.wedge}`)
  return result
}

const summary = []
for (let run = 1; run <= RUNS; run++) {
  try { summary.push(await runOnce(run)) } catch (error) { summary.push({ run, error: String((error && error.stack) || error) }) }
}
writeFileSync(join(OUT, `${VARIANT}-gui-summary.json`), JSON.stringify(summary, null, 2))
log(`SUMMARY variant=${VARIANT} runs=${summary.length} wedged=${summary.filter((item) => item.wedge).length}`)
