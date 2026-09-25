// 自更新的真机端到端验证（**手动运行，不进 CI**）
//
// 用法：node scripts/verify-self-update-live.mjs
//
// 为什么需要它：tests/test-self-update.mjs 跑的全是桩依赖，证明不了「真实网络 + 真实 tarball +
// 真实替换」这条路通。本脚本在系统临时目录里造一台「装着旧版的机器」，用真实 registry 跑三条路径，
// **全程不碰本机安装的插件**（packageDir / dataDir 都指向临时目录，结束时整个删掉）：
//
//   ① mode:'check'   —— 必须对磁盘纯读：不下 tarball、包目录哈希不变、无备份、不记待重启，
//                       但「上次检查时间」要更新（用户据此确认按钮真的去问了）。
//   ② mode:'install' —— 必须真装上 npm 上的最新版：磁盘版本追上、旧标记被换掉、有备份与审计日志、
//                       不引入 node_modules；内存运行版本保持旧值（这正是「重启 DSH 生效」的由来）。
//   ③ 坏包           —— 把真实 tarball 截断成前 100 字节喂进去：必须被拒、记成 incomplete-download、
//                       那台「机器」的包目录一个字节都不变、无 .update-tmp 残留、日志有 update-failed。
//
// 需要联网。三条路径全过才算「更新真的可用」。
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSelfUpdater } from '../src/self-update.js'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const root = mkdtempSync(join(tmpdir(), 'bib-verify-'))
const pkg = join(root, 'pkg')
const data = join(root, 'data')
const PAYLOAD_ENTRIES = ['lib', 'locale', 'package.json', 'cordis.patch.yml', 'README.md', 'LICENSE']

let fails = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) fails += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)))
}
function hashOf(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}
// 包目录全量快照：用来断言「一个字节都没变」，比逐个文件断言更严
function snapshotOf(dir) {
  const out = {}
  const walk = (base, prefix) => {
    for (const name of readdirSync(base)) {
      const full = join(base, name)
      let info
      try { info = statSync(full) } catch { continue }
      if (info.isDirectory()) walk(full, prefix + name + '/')
      else out[prefix + name] = hashOf(full)
    }
  }
  walk(dir, '')
  return out
}
function stageOldMachine(target, version) {
  mkdirSync(target, { recursive: true })
  for (const entry of PAYLOAD_ENTRIES) cpSync(join(repo, entry), join(target, entry), { recursive: true })
  const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  manifest.version = version
  writeFileSync(join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(target, 'lib', 'client.js'), readFileSync(join(target, 'lib', 'client.js'), 'utf8') + '\n// OLD-BUILD-MARKER\n')
}

// 计量真实网络请求：检查路径必须一次 tarball 都不要下
const realFetch = globalThis.fetch
const requests = []
globalThis.fetch = async (url, init) => { requests.push(String(url)); return realFetch(url, init) }
const tarballCalls = () => requests.filter((url) => !url.endsWith('/latest')).length

try {
  stageOldMachine(pkg, '0.0.1')
  mkdirSync(data, { recursive: true })
  const updater = createSelfUpdater({ packageDir: pkg, dataDir: data, runningVersion: '0.0.1' })
  updater.loadState()

  // ---------- ① 检查：纯读 ----------
  const before = snapshotOf(pkg)
  const state = await updater.run({ mode: 'check', manual: true })
  check('① 检查：拿到 npm 上的最新版本号', typeof state.latest === 'string' && /^\d+\.\d+\.\d+$/.test(state.latest), true)
  check('① 检查：没有下载 tarball（只问了一次版本）', tarballCalls(), 0)
  check('① 检查：包目录一个字节都没变', snapshotOf(pkg), before)
  check('① 检查：没有留下备份目录', existsSync(join(data, 'update-backup')), false)
  check('① 检查：没有记「已装好待重启」', state.pendingVersion, null)
  check('① 检查：磁盘版本仍是旧版', updater.getState().diskVersion, '0.0.1')
  check('① 检查：更新了「上次检查时间」',
    typeof JSON.parse(readFileSync(join(data, 'update-state.json'), 'utf8')).lastCheckAt, 'number')

  // ---------- ② 安装：真装上 ----------
  const installed = await updater.run({ mode: 'install', manual: true })
  check('② 安装：磁盘版本变成最新版', JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version, state.latest)
  check('② 安装：真的下载了 tarball', tarballCalls() > 0, true)
  check('② 安装：内存运行版本仍是旧版（只有重启才生效）', updater.getState().runningVersion, '0.0.1')
  check('② 安装：旧代码标记已被换掉', readFileSync(join(pkg, 'lib', 'client.js'), 'utf8').includes('OLD-BUILD-MARKER'), false)
  check('② 安装：留下了更新前的备份', existsSync(join(data, 'update-backup', state.latest)), true)
  check('② 安装：审计日志有 updated 事件', readFileSync(join(data, 'update-log.jsonl'), 'utf8').includes('"event":"updated"'), true)
  check('② 安装：没有引入 node_modules（不碰依赖树）', existsSync(join(pkg, 'node_modules')), false)
  // 返回形状稳定：客户端只认一种形状，多一种就会被拼成半状态
  const keysOf = (value) => Object.keys(value).filter((key) => key !== 'checkedOnly').sort().join(',')
  check('② 安装：与检查返回同一个状态形状（唯一的差别是 checkedOnly 标记）', keysOf(installed), keysOf(state))

  // ---------- ③ 坏包：必须被拒且不破坏安装 ----------
  const brokenPkg = join(root, 'pkg-broken')
  const brokenData = join(root, 'data-broken')
  stageOldMachine(brokenPkg, '0.0.1')
  mkdirSync(brokenData, { recursive: true })
  const broken = createSelfUpdater({
    packageDir: brokenPkg,
    dataDir: brokenData,
    runningVersion: '0.0.1',
    fetch: async (url, init) => {
      const response = await realFetch(url, init)
      if (String(url).endsWith('/latest')) return response
      const buffer = Buffer.from(await response.arrayBuffer())
      // 真·前 100 字节：Buffer.subarray 是同一块内存的视图，必须复制一份新的 ArrayBuffer
      const truncated = new Uint8Array(buffer.subarray(0, 100))
      return { ok: true, status: 200, arrayBuffer: async () => truncated.buffer }
    },
  })
  const beforeBroken = snapshotOf(brokenPkg)
  await broken.run({ mode: 'install', manual: true })
  check('③ 坏包：被拒且记成 incomplete-download', broken.getState().lastErrorKind, 'incomplete-download')
  check('③ 坏包：包目录一个字节都没变', snapshotOf(brokenPkg), beforeBroken)
  check('③ 坏包：没有留下 .update-tmp 残留', Object.keys(snapshotOf(brokenPkg)).some((name) => name.endsWith('.update-tmp')), false)
  check('③ 坏包：日志里有 update-failed', readFileSync(join(brokenData, 'update-log.jsonl'), 'utf8').includes('"event":"update-failed"'), true)
} finally {
  globalThis.fetch = realFetch
  rmSync(root, { recursive: true, force: true })
}

console.log(fails === 0 ? '\n真机验证全部通过（检查纯读 / 安装真装上 / 坏包被拒）' : '\n' + fails + ' 项失败')
process.exit(fails === 0 ? 0 : 1)
