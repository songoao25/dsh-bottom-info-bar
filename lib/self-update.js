// Bottom Info Bar — 自更新引擎（host 侧，独立模块以便单测）
//
// 为什么需要它：DSH 的插件管理只有「安装 / 卸载 / 启用 / 停用」，没有「更新」；对已安装的包再填
// 同一地址会被 inspect 以 already-installed 拦下。于是用户侧原本唯一路径是「卸载 → 重装」——
// 2026-09-25 用户明确要求给出更方便的方式，并逐项拍板「一键自更新 + 全自动（除重启）」，
// 见 docs/DECISIONS-AUTO-UPDATE.md。
//
// 可行性前提：本插件零运行时依赖（dependencies 为空、peer 只有 react），所以「更新」只需要替换
// 包内自己的文件，完全不涉及依赖树。
//
// 五条硬边界（违反任何一条都算 bug）：
//   ① 只写自己：目标必须落在本插件包目录内的白名单路径，解析后不得逃逸（不许绝对路径、不许 ..）；
//   ② 不碰依赖树：绝不执行 pnpm、绝不写 profile 的 package.json / pnpm-lock.yaml；
//   ③ 只升不降：远端版本必须严格高于「运行中版本」，同版本或更低一律跳过（防投毒与误回退）；
//   ④ 先备份后替换：替换前完整备份，失败自动回滚；
//   ⑤ 校验不过绝不落盘：完整性（sha512）与包身份（name/version）双校验。
//
// 「运行中版本」与「磁盘版本」必须分开：自更新会替换磁盘上的 package.json，而内存里跑的仍是旧
// 代码。若只读磁盘版本，「已下载待重启」的提示会自己消失、用户永远等不到重启理由。
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'

export const PACKAGE_NAME = 'dsh-bottom-info-bar'
export const UPDATE_REGISTRY_ORIGIN = 'https://registry.npmjs.org'

// 允许被自更新替换的路径：正好是 package.json 的 files 字段声明的分发内容。
// 白名单而非黑名单——新增一种分发内容时必须显式加进来，不允许"顺手"写到别处。
const PAYLOAD_ROOTS = ['lib/', 'locale/', 'docs/']
const PAYLOAD_FILES = ['package.json', 'cordis.patch.yml', 'LICENSE', 'README.md', 'README.zh-CN.md']

export function isAllowedPayloadPath(relative) {
  if (typeof relative !== 'string' || relative.length === 0) return false
  return PAYLOAD_FILES.includes(relative) || PAYLOAD_ROOTS.some((root) => relative.startsWith(root))
}

// 把相对路径安全地接到基准目录下：拒绝绝对路径、盘符、空段、'.'、'..' 与 NUL，
// 并再断言解析结果确实在基准目录内（双保险，防规范化边界情况）。
export function resolveSafePath(baseDir, relative) {
  if (typeof relative !== 'string' || relative.length === 0) return null
  const normalized = relative.split('\\').join('/')
  if (normalized.startsWith('/') || isAbsolute(relative)) return null
  if (/^[A-Za-z]:/.test(normalized)) return null
  if (normalized.includes('\0')) return null
  const parts = normalized.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null
  const base = resolve(baseDir)
  const full = resolve(base, normalized)
  // 基准目录自身以分隔符结尾时（最典型的是根目录 '/'）不能直接拼 sep，否则 '//x' 永远匹配不上，
  // 合法路径会被误判成逃逸 —— 2026-09-25 由 tests/test-self-update.mjs 首次跑到该分支时抓出。
  const boundary = base.endsWith(sep) ? base : base + sep
  if (full !== base && !full.startsWith(boundary)) return null
  return full
}

// 语义化版本比较：只接受 x.y.z（可带 v 前缀），返回 [major, minor, patch] 或 null。
export function parseSemver(value) {
  const match = typeof value === 'string' && value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function compareSemver(left, right) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) return 0
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}

// ---------- tar 解析 ----------
// npm 的 tarball 是 gzip + ustar（长路径用 pax 扩展头）。只为解包自己的包服务，
// 因此只认常规文件与目录，忽略符号链接等其余类型（我们的分发内容里没有）。

function readTarText(header, start, length) {
  const slice = header.subarray(start, start + length)
  let end = slice.length
  while (end > 0 && (slice[end - 1] === 0 || slice[end - 1] === 0x20)) end--
  return slice.subarray(0, end).toString('utf8')
}

// pax 扩展头的内容是若干条 "总长度 key=value\n" 记录；我们只关心 path。
function readPaxPath(chunk) {
  const text = chunk.toString('utf8')
  let cursor = 0
  let path = null
  while (cursor < text.length) {
    const space = text.indexOf(' ', cursor)
    if (space < 0) break
    const length = Number(text.slice(cursor, space))
    if (!Number.isFinite(length) || length <= 0 || cursor + length > text.length) break
    const record = text.slice(space + 1, cursor + length)
    const eq = record.indexOf('=')
    if (eq > 0 && record.slice(0, eq) === 'path') path = record.slice(eq + 1).replace(/\n$/, '')
    cursor += length
  }
  return path
}

export function parseTar(buffer) {
  const entries = []
  let offset = 0
  let paxPath = null
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    // 连续的全零块表示归档结束
    let allZero = true
    for (let i = 0; i < header.length; i++) {
      if (header[i] !== 0) { allZero = false; break }
    }
    if (allZero) break
    const rawName = readTarText(header, 0, 100)
    const size = parseInt(readTarText(header, 124, 12).replace(/[^0-7]/g, ''), 8)
    if (!Number.isFinite(size) || size < 0) break
    const typeflag = String.fromCharCode(header[156] || 0x30)
    const prefix = readTarText(header, 345, 155)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    const next = dataStart + Math.ceil(size / 512) * 512
    if (dataEnd > buffer.length) break
    if (typeflag === 'x') {
      paxPath = readPaxPath(buffer.subarray(dataStart, dataEnd))
      offset = next
      continue
    }
    const name = paxPath || (prefix.length > 0 ? prefix + '/' + rawName : rawName)
    paxPath = null
    if (typeflag === '0' || typeflag === '\0') {
      entries.push({ path: name, data: buffer.subarray(dataStart, dataEnd) })
    }
    offset = next > dataStart ? next : dataStart + 512
  }
  return entries
}

// gzip 解开后只取 package/ 前缀下的条目，并剥掉该前缀。tarball 里其它前缀（不存在）一律忽略。
export function extractPackageFiles(tarballBuffer) {
  const entries = parseTar(gunzipSync(tarballBuffer))
  const files = []
  for (const entry of entries) {
    const normalized = entry.path.split('\\').join('/')
    if (!normalized.startsWith('package/')) continue
    const relative = normalized.slice('package/'.length)
    if (relative.length === 0) continue
    files.push({ path: relative, data: entry.data })
  }
  return files
}

// 校验：完整性（registry 给的 sha512）→ 包身份（name / version）→ 路径白名单。
// 任一条不过就抛出，调用方据此放弃整次更新（绝不落盘）。
export function verifyPayload(files, options) {
  const { integrity, version } = options || {}
  const manifestFile = files.find((file) => file.path === 'package.json')
  if (!manifestFile) throw new Error('payload has no package.json')
  let manifest
  try {
    manifest = JSON.parse(manifestFile.data.toString('utf8'))
  } catch {
    throw new Error('payload package.json is not valid JSON')
  }
  if (manifest.name !== PACKAGE_NAME) throw new Error('payload package name mismatch: ' + String(manifest.name))
  if (version && manifest.version !== version) throw new Error('payload version mismatch: ' + String(manifest.version) + ' != ' + version)
  if (parseSemver(manifest.version) === null) throw new Error('payload version is not semver: ' + String(manifest.version))
  if (typeof integrity === 'string' && integrity.length > 0) {
    const [algorithm, expected] = integrity.split('-')
    if (algorithm === 'sha512' && expected) {
      const digest = createHash('sha512').update(options.tarball).digest('base64')
      if (digest !== expected) throw new Error('payload integrity mismatch')
    }
  }
  for (const file of files) {
    if (!isAllowedPayloadPath(file.path)) throw new Error('payload path not allowed: ' + file.path)
    if (resolveSafePath('/', file.path) === null) throw new Error('payload path escapes: ' + file.path)
  }
  return manifest
}

// ---------- 落盘 ----------
// 备份 + 替换 + 回滚。替换以「单文件原子写（临时文件 + rename）」进行；整批不是原子的，
// 所以失败时必须回滚到备份状态：先删掉本次新增的文件，再把备份里的文件覆盖回去。
function listPayloadFiles(baseDir) {
  const found = []
  const walk = (dir, prefix) => {
    let names
    try { names = readdirSync(dir) } catch { return }
    for (const name of names) {
      const full = join(dir, name)
      const relative = prefix ? prefix + '/' + name : name
      let info
      try { info = statSync(full) } catch { continue }
      if (info.isDirectory()) walk(full, relative)
      else if (isAllowedPayloadPath(relative)) found.push(relative)
    }
  }
  walk(baseDir, '')
  return found
}

export function applyPayload(files, context) {
  const { packageDir, backupDir, log } = context || {}
  if (!packageDir || !backupDir) throw new Error('applyPayload needs packageDir and backupDir')
  const before = listPayloadFiles(packageDir)
  // 备份当前内容（含目录结构），用于失败回滚
  rmSync(backupDir, { recursive: true, force: true })
  mkdirSync(backupDir, { recursive: true })
  const backedUp = []
  for (const relative of before) {
    const source = resolveSafePath(packageDir, relative)
    const target = resolveSafePath(backupDir, relative)
    if (!source || !target || !existsSync(source)) continue
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
    backedUp.push(relative)
  }
  const restoredFiles = () => {
    rmSync(backupDir, { recursive: true, force: true })
  }
  const written = []
  try {
    for (const file of files) {
      const target = resolveSafePath(packageDir, file.path)
      if (!target) throw new Error('refusing to write outside package: ' + file.path)
      mkdirSync(dirname(target), { recursive: true })
      const temp = target + '.update-tmp'
      writeFileSync(temp, file.data)
      renameSync(temp, target)
      written.push(file.path)
    }
  } catch (error) {
    rollbackPayload({ packageDir, backupDir, before: backedUp, written })
    restoredFiles()
    if (typeof log === 'function') log('update rolled back: ' + error.message)
    throw error
  }
  return { before: backedUp, written, backupDir }
}

export function rollbackPayload(context) {
  const { packageDir, backupDir, before, written } = context || {}
  if (!packageDir || !backupDir) return { restored: [], removed: [] }
  const keep = new Set(Array.isArray(before) ? before : [])
  const removed = []
  for (const relative of Array.isArray(written) ? written : []) {
    if (keep.has(relative)) continue
    const target = resolveSafePath(packageDir, relative)
    if (!target) continue
    rmSync(target, { force: true })
    removed.push(relative)
  }
  const restored = []
  if (existsSync(backupDir)) {
    for (const relative of keep) {
      const source = resolveSafePath(backupDir, relative)
      const target = resolveSafePath(packageDir, relative)
      if (!source || !target || !existsSync(source)) continue
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(source, target)
      restored.push(relative)
    }
  }
  return { restored, removed }
}

// ---------- 引擎 ----------
// 依赖全部由外部注入，便于单测：不注入就走真实实现（fetch / 真实目录 / 真实时钟）。
export function createSelfUpdater(options) {
  const config = options || {}
  const packageDir = config.packageDir
  const dataDir = config.dataDir
  const runningVersion = typeof config.runningVersion === 'string' ? config.runningVersion : '0.0.0'
  const fetchImpl = config.fetch || ((...args) => fetch(...args))
  const now = config.now || (() => Date.now())
  const log = typeof config.log === 'function' ? config.log : () => {}
  const stateFile = join(dataDir, 'update-state.json')
  const logFile = join(dataDir, 'update-log.jsonl')
  const backupRoot = join(dataDir, 'update-backup')
  const keepBackups = Number.isInteger(config.keepBackups) ? config.keepBackups : 3
  const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 60000
  const maxBytes = Number.isFinite(config.maxBytes) ? config.maxBytes : 8 * 1024 * 1024

  // holdVersion：用户回滚过的版本。回滚是「新版有问题」时的逃生门，若重启后 8 秒的自动检查又把它
  // 装回来，等于逃生门自己会关上。因此回滚后只暂缓「正好等于该版本」的更新，更高版本照常进行。
  let state = { autoUpdate: true, pendingVersion: null, holdVersion: null, updatedAt: null, lastError: null, lastCheckAt: null }
  let inFlight = null

  function loadState() {
    try {
      const parsed = JSON.parse(readFileSync(stateFile, 'utf8'))
      if (parsed && typeof parsed === 'object') {
        state = {
          autoUpdate: parsed.autoUpdate !== false,
          pendingVersion: typeof parsed.pendingVersion === 'string' ? parsed.pendingVersion : null,
          holdVersion: typeof parsed.holdVersion === 'string' ? parsed.holdVersion : null,
          updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null,
          lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
          lastCheckAt: typeof parsed.lastCheckAt === 'number' ? parsed.lastCheckAt : null,
        }
      }
    } catch { /* 首次运行或文件损坏：用默认值 */ }
    return state
  }

  function saveState() {
    try {
      mkdirSync(dataDir, { recursive: true })
      const temp = stateFile + '.tmp'
      writeFileSync(temp, JSON.stringify(state, null, 2) + '\n')
      renameSync(temp, stateFile)
    } catch (error) {
      log('failed to persist update state: ' + error.message)
    }
  }

  function appendLog(entry) {
    try {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(logFile, JSON.stringify(Object.assign({ ts: now() }, entry)) + '\n', { flag: 'a' })
    } catch { /* 日志失败不影响更新本身 */ }
  }

  function diskVersion() {
    try {
      const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
      return typeof pkg.version === 'string' ? pkg.version : null
    } catch { return null }
  }

  async function fetchLatestRelease() {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(UPDATE_REGISTRY_ORIGIN + '/' + PACKAGE_NAME + '/latest', {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) return null
      const body = await response.json()
      if (!body || typeof body.version !== 'string') return null
      const integrity = body.dist && typeof body.dist.integrity === 'string' ? body.dist.integrity : null
      return { version: body.version, integrity }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async function downloadTarball(version) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const url = UPDATE_REGISTRY_ORIGIN + '/' + PACKAGE_NAME + '/-/' + PACKAGE_NAME + '-' + version + '.tgz'
      const response = await fetchImpl(url, { headers: { accept: 'application/octet-stream' }, signal: controller.signal })
      if (!response.ok) throw new Error('download failed: http ' + response.status)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length === 0) throw new Error('download failed: empty body')
      if (buffer.length > maxBytes) throw new Error('download failed: too large (' + buffer.length + ' bytes)')
      return buffer
    } finally {
      clearTimeout(timer)
    }
  }

  // 备份目录只保留最近若干份，避免长期堆积占用户空间。
  function pruneBackups() {
    try {
      const names = readdirSync(backupRoot).filter((name) => name !== 'previous').sort()
      for (const name of names.slice(0, Math.max(0, names.length - keepBackups))) {
        rmSync(join(backupRoot, name), { recursive: true, force: true })
      }
    } catch { /* 目录不存在即无需清理 */ }
  }

  async function performUpdate(target) {
    const tarball = await downloadTarball(target.version)
    const files = extractPackageFiles(tarball)
    verifyPayload(files, { integrity: target.integrity, version: target.version, tarball })
    const result = applyPayload(files, { packageDir, backupDir: join(backupRoot, target.version), log })
    pruneBackups()
    return result
  }

  async function runOnce(options) {
    const manual = !!(options && options.manual)
    const force = !!(options && options.force)
    const latest = await fetchLatestRelease()
    state.lastCheckAt = now()
    if (!latest) {
      state.lastError = manual ? 'check-failed' : state.lastError
      saveState()
      appendLog({ event: 'check-failed' })
      return Object.assign({}, state, { latest: null })
    }
    // 只升不降：等于或低于运行中版本一律不动
    if (compareSemver(latest.version, runningVersion) <= 0) {
      // 这里绝不抹掉 pendingVersion。它同时承担两个身份：① 「刚替换到磁盘的版本」；
      // ② 回滚时定位备份目录的唯一线索。升级成功→用户重启→运行版本追平 latest，重启后
      // 8 秒的这次检查就会走到本分支；若在此清空，用户「新版有问题想回滚」时逃生门已被焊死
      // （rollback() 会返回 nothing-to-roll-back）。「待重启」由 UI 用 diskVersion 与 runningVersion
      // 是否相等判定，不依赖本字段被清空 —— 2026-09-25 由 tests/test-self-update.mjs 抓出。
      state.lastError = null
      saveState()
      return Object.assign({}, state, { latest: latest.version })
    }
    // 用户回滚过的版本不再装回来（自动与手动都跳过）；更高版本照常。force 是「我就要这个版本」的
    // 显式表达（设置页的「允许更新到 X」按钮），只有它能把暂缓解除。
    if (state.holdVersion && latest.version === state.holdVersion && !force) {
      saveState()
      return Object.assign({}, state, { latest: latest.version, skipped: 'held' })
    }
    if (diskVersion() === latest.version && !manual) {
      // 磁盘已是新版：等用户重启，别重复下载
      state.pendingVersion = latest.version
      state.lastError = null
      saveState()
      return Object.assign({}, state, { latest: latest.version })
    }
    if (!state.autoUpdate && !manual) {
      saveState()
      return Object.assign({}, state, { latest: latest.version, skipped: 'auto-disabled' })
    }
    try {
      await performUpdate(latest)
      state.pendingVersion = latest.version
      // 装上了一个「不等于暂缓版本」的新版：暂缓自动解除（回滚过的那个旧版本已被越过）
      state.holdVersion = null
      state.updatedAt = now()
      state.lastError = null
      saveState()
      appendLog({ event: 'updated', version: latest.version })
    } catch (error) {
      state.lastError = error && error.message ? error.message : 'update-failed'
      saveState()
      appendLog({ event: 'update-failed', version: latest.version, message: state.lastError })
    }
    return Object.assign({}, state, { latest: latest.version })
  }

  return {
    loadState,
    getState() {
      return Object.assign({}, state, {
        runningVersion,
        diskVersion: diskVersion(),
        updated: state.pendingVersion !== null && state.pendingVersion !== runningVersion,
      })
    },
    // 自动与手动共用一条流水线，并发调用复用同一次运行
    run(options) {
      if (inFlight) return inFlight
      const pending = runOnce(options).finally(() => { inFlight = null })
      inFlight = pending
      return pending
    },
    setAutoUpdate(enabled) {
      state.autoUpdate = enabled !== false
      saveState()
      return this.getState()
    },
    // 回滚：把最近一次成功更新的备份恢复回去（供新版启动异常时人工兜底）。
    // 同时把被回滚掉的版本记入 holdVersion —— 否则重启后 8 秒的自动检查会把它装回来，
    // 逃生门等于白开。解除方式是设置页的「允许更新到 X」（runUpdateCheck 带 force）。
    rollback() {
      const target = state.pendingVersion
      if (!target) return { restored: false, reason: 'nothing-to-roll-back' }
      const backupDir = join(backupRoot, target)
      if (!existsSync(backupDir)) return { restored: false, reason: 'no-backup' }
      const before = listPayloadFiles(backupDir)
      const current = listPayloadFiles(packageDir)
      const result = rollbackPayload({ packageDir, backupDir, before, written: current })
      state.pendingVersion = null
      state.holdVersion = target
      state.updatedAt = now()
      state.lastError = null
      saveState()
      appendLog({ event: 'rolled-back', version: target, restored: result.restored.length })
      return { restored: true, version: target, holdVersion: target, files: result.restored.length }
    },
    _internal: { fetchLatestRelease, downloadTarball, performUpdate, listPayloadFiles },
  }
}
