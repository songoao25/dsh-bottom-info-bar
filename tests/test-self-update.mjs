// Bottom Info Bar — 自更新引擎单测（src/self-update.js）
// 用法：node tests/test-self-update.mjs
//
// 为什么单独一个文件：自更新在真实运行时会下载 tarball 并替换插件自己的包文件，所以整个测试套件里
// host 侧一律关闭（DSH_BOTTOM_INFO_BAR_SELF_UPDATE=off，见 tests/run-all.mjs）。引擎本身在这里用
// 桩依赖直接单测 —— 不发真实网络请求、不碰真实包目录、不动真实数据目录。
//
// 覆盖 docs/DECISIONS-AUTO-UPDATE.md §5 的 7 条验收标准，外加两条真实世界必须成立的行为：
// 「内存运行版本 vs 磁盘版本」分离、以及「重启后待重启提示自动消失」。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
  PACKAGE_NAME,
  applyPayload,
  compareSemver,
  createSelfUpdater,
  extractPackageFiles,
  isAllowedPayloadPath,
  parseSemver,
  parseTar,
  resolveSafePath,
  verifyPayload,
} from '../src/self-update.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let passed = 0
let failed = 0
const failures = []

function ok(label, fn) {
  try {
    fn()
    passed += 1
    console.log('PASS  ' + label)
  } catch (error) {
    failed += 1
    failures.push(label + ' → ' + error.message)
    console.log('FAIL  ' + label + ' → ' + error.message)
  }
}

async function okAsync(label, fn) {
  try {
    await fn()
    passed += 1
    console.log('PASS  ' + label)
  } catch (error) {
    failed += 1
    failures.push(label + ' → ' + error.message)
    console.log('FAIL  ' + label + ' → ' + error.message)
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

// ---------- tar / gzip 构造（只为造出 npm 形态的 tarball 供解析） ----------

function octalField(value, length) {
  return value.toString(8).padStart(length - 1, '0') + '\0'
}

function tarHeader(name, size, typeflag, prefix) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write(octalField(0o644, 8), 100, 8, 'utf8')
  header.write(octalField(0, 8), 108, 8, 'utf8')
  header.write(octalField(0, 8), 116, 8, 'utf8')
  header.write(octalField(size, 12), 124, 12, 'utf8')
  header.write(octalField(0, 12), 136, 12, 'utf8')
  header.write('        ', 148, 8, 'utf8') // 校验和位置先填空格再回填
  header.write(typeflag, 156, 1, 'utf8')
  header.write('ustar\0', 257, 6, 'utf8')
  header.write('00', 263, 2, 'utf8')
  if (prefix) header.write(prefix, 345, 155, 'utf8')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8')
  return header
}

function tarEntry(name, data, typeflag = '0', prefix) {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const chunks = [tarHeader(name, body.length, typeflag, prefix), body]
  const pad = (512 - (body.length % 512)) % 512
  if (pad > 0) chunks.push(Buffer.alloc(pad))
  return Buffer.concat(chunks)
}

// pax 记录是「总长度 key=value\n」，长度字段自身占位会随位数变化，迭代到稳定。
function paxRecord(key, value) {
  const body = key + '=' + value + '\n'
  let length = body.length + 2
  for (let i = 0; i < 6; i++) length = body.length + String(length).length + 1
  return String(length) + ' ' + body
}

function tarArchive(entries) {
  const chunks = entries.map((entry) => tarEntry(entry.path, entry.data, entry.typeflag, entry.prefix))
  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

function makeTarball(files, options) {
  const opts = options || {}
  const entries = []
  for (const file of files) {
    const pax = opts.paxPath === file.path
    if (pax) {
      const record = paxRecord('path', 'package/' + file.path)
      entries.push({ path: 'PaxHeader/' + file.path.slice(0, 40), data: Buffer.from(record), typeflag: 'x' })
      entries.push({ path: 'package/' + file.path.slice(0, 90), data: file.data })
      continue
    }
    entries.push({ path: 'package/' + file.path, data: file.data })
  }
  return gzipSync(tarArchive(entries))
}

function integrityOf(buffer) {
  return 'sha512-' + createHash('sha512').update(buffer).digest('base64')
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => Buffer.alloc(0),
  }
}

function bufferResponse(buffer) {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    arrayBuffer: async () => buffer,
  }
}

// ---------- 装置 ----------

// 仿真实安装形态：packageDir 落在 profile 的 node_modules 里，profile 自身另有 package.json 与 lockfile。
function makeFixture(options) {
  const opts = options || {}
  const base = mkdtempSync(join(tmpdir(), 'bib-self-update-'))
  const profileDir = join(base, 'profiles', 'desktop')
  const packageDir = join(profileDir, 'node_modules', PACKAGE_NAME)
  const dataDir = join(base, 'data')
  mkdirSync(join(packageDir, 'lib'), { recursive: true })
  mkdirSync(join(packageDir, 'locale'), { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: { [PACKAGE_NAME]: 'github:songoao25/dsh-bottom-info-bar#a07433b' },
  }, null, 2) + '\n')
  writeFileSync(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\nimporters:\n  .: {}\n')
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
    name: PACKAGE_NAME,
    version: opts.version || '1.0.0',
    files: ['lib', 'cordis.patch.yml', 'locale/*.json', 'README.md', 'README.zh-CN.md', 'docs/INSTALL.md', 'LICENSE'],
  }, null, 2) + '\n')
  writeFileSync(join(packageDir, 'lib', 'index.js'), '// old host\n')
  writeFileSync(join(packageDir, 'lib', 'client.js'), '// old client\n')
  writeFileSync(join(packageDir, 'cordis.patch.yml'), '- name: dsh-bottom-info-bar\n')
  writeFileSync(join(packageDir, 'README.md'), '# old readme\n')
  writeFileSync(join(packageDir, 'LICENSE'), 'MIT\n')
  writeFileSync(join(packageDir, 'locale', 'en.json'), '{}\n')
  writeFileSync(join(packageDir, 'locale', 'zh.json'), '{}\n')
  return {
    base,
    profileDir,
    packageDir,
    dataDir,
    cleanup() { rmSync(base, { recursive: true, force: true }) },
  }
}

// 造一个「版本号 = version」的完整 payload，返回 { files, tarball, integrity }
function makePayload(version, extra) {
  const files = [
    { path: 'package.json', data: Buffer.from(JSON.stringify({ name: PACKAGE_NAME, version }, null, 2) + '\n') },
    { path: 'lib/index.js', data: Buffer.from('// host ' + version + '\n') },
    { path: 'lib/client.js', data: Buffer.from('// client ' + version + '\n') },
    { path: 'cordis.patch.yml', data: Buffer.from('- name: dsh-bottom-info-bar\n') },
    { path: 'README.md', data: Buffer.from('# readme ' + version + '\n') },
    { path: 'LICENSE', data: Buffer.from('MIT\n') },
  ].concat(extra || [])
  const tarball = makeTarball(files)
  return { files, tarball, integrity: integrityOf(tarball) }
}

function makeUpdater(fixture, options) {
  const opts = options || {}
  const requests = []
  const payload = opts.payload
  const updater = createSelfUpdater({
    packageDir: fixture.packageDir,
    dataDir: fixture.dataDir,
    runningVersion: opts.runningVersion || '1.0.0',
    keepBackups: opts.keepBackups,
    now: () => 1758800000000,
    fetch: async (url, init) => {
      requests.push(url)
      if (opts.onFetch) {
        const custom = await opts.onFetch(url, init, requests.length)
        if (custom) return custom
      }
      if (url.endsWith('/latest')) {
        if (opts.latestError) throw new Error('network down')
        if (opts.latest === null) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => Buffer.alloc(0) }
        return jsonResponse({
          version: payload && !opts.latestVersion ? undefined : (opts.latestVersion || payload.version),
          dist: { integrity: opts.latestIntegrity || payload.integrity },
        })
      }
      return bufferResponse(payload.tarball)
    },
  })
  return { updater, requests }
}

// =====================================================================================
// 1. 语义化版本比较严格（验收 1 的前置）
// =====================================================================================
ok('parseSemver 只认 x.y.z（可带 v 前缀），预发布/缺段一律 null', () => {
  assert.deepEqual(parseSemver('1.2.3'), [1, 2, 3])
  assert.deepEqual(parseSemver('v10.20.30'), [10, 20, 30])
  assert.deepEqual(parseSemver(' 1.0.0 '), [1, 0, 0])
  assert.equal(parseSemver('1.2'), null)
  assert.equal(parseSemver('1.2.3-beta.1'), null)
  assert.equal(parseSemver('1.2.3+build'), null)
  assert.equal(parseSemver(1.2), null)
  assert.equal(parseSemver(null), null)
})

ok('compareSemver：严格三档，非法输入按「不高于」处理（宁可不更新）', () => {
  assert.equal(compareSemver('1.2.3', '1.2.4'), -1)
  assert.equal(compareSemver('1.2.4', '1.2.4'), 0)
  assert.equal(compareSemver('2.0.0', '1.99.99'), 1)
  assert.equal(compareSemver('1.10.0', '1.9.0'), 1)
  // 预发布版本解析失败 → 返回 0 → runOnce 里 <= 0 会跳过：绝不把用户升到预发布版
  assert.equal(compareSemver('1.2.3-rc.1', '1.2.3'), 0)
  assert.equal(compareSemver('garbage', '1.2.3'), 0)
})

// =====================================================================================
// 2. 路径安全（验收 4）
// =====================================================================================
ok('resolveSafePath 拒绝绝对路径 / 盘符 / .. / . / 空段 / NUL', () => {
  const base = '/tmp/pkg'
  assert.equal(resolveSafePath(base, '/etc/passwd'), null)
  assert.equal(resolveSafePath(base, 'C:\\Windows\\system32'), null)
  assert.equal(resolveSafePath(base, 'lib/../../etc/passwd'), null)
  assert.equal(resolveSafePath(base, 'lib/./x.js'), null)
  assert.equal(resolveSafePath(base, 'lib//x.js'), null)
  assert.equal(resolveSafePath(base, 'lib/x\0.js'), null)
  assert.equal(resolveSafePath(base, ''), null)
  assert.equal(resolveSafePath(base, null), null)
  assert.equal(resolveSafePath(base, '..'), null)
})

ok('resolveSafePath 放行包内正常路径，并解析到基准目录下', () => {
  const base = join(tmpdir(), 'pkg-base')
  assert.equal(resolveSafePath(base, 'lib/index.js'), join(base, 'lib', 'index.js'))
  assert.equal(resolveSafePath(base, 'a\\b\\c.js'), join(base, 'a', 'b', 'c.js'))
  assert.equal(resolveSafePath(base, 'package.json'), join(base, 'package.json'))
})

ok('isAllowedPayloadPath 只管白名单：源码 / 测试 / .git / node_modules 全部不许被自更新写入', () => {
  for (const allowed of ['lib/index.js', 'locale/en.json', 'docs/INSTALL.md', 'package.json', 'cordis.patch.yml', 'LICENSE', 'README.md', 'README.zh-CN.md']) {
    assert.equal(isAllowedPayloadPath(allowed), true, allowed + ' should be allowed')
  }
  for (const denied of ['src/host.js', 'tests/test-self-update.mjs', '.github/workflows/ci.yml', 'node_modules/x/index.js', '.git/config', 'install.sh', 'lib', '', null]) {
    assert.equal(isAllowedPayloadPath(denied), false, String(denied) + ' should be denied')
  }
})

ok('白名单覆盖 package.json 的 files 全部分发内容（新增分发根必须显式加白名单）', () => {
  // 这条是「静默失效」的守门人：若往 files 里加了新目录却没加进 PAYLOAD_ROOTS，
  // 自更新会悄悄不更新那部分文件，只有这条断言会红。
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.ok(pkg.files.length >= 5, 'files whitelist unexpectedly short')
  for (const entry of pkg.files) {
    // 一条分发声明可能是文件（LICENSE）、带通配（locale/*.json）或目录（lib）；
    // 只要「原样 / 通配展开后 / 当作目录」任一形态被白名单覆盖，就算这条分发内容可被自更新。
    const candidates = [entry]
    if (entry.includes('*')) candidates.push(entry.replace('*', 'en'))
    candidates.push(entry + '/sample.js')
    assert.ok(
      candidates.some((candidate) => isAllowedPayloadPath(candidate)),
      'distribution entry ' + entry + ' is not updatable (missing from PAYLOAD_ROOTS / PAYLOAD_FILES)',
    )
  }
})

// =====================================================================================
// 3. tar 解析（含 pax 长路径与前缀字段）
// =====================================================================================
ok('extractPackageFiles 只取 package/ 前缀并剥掉它，忽略其它前缀', () => {
  const tarball = gzipSync(tarArchive([
    { path: 'package/package.json', data: Buffer.from('{"a":1}') },
    { path: 'package/lib/index.js', data: Buffer.from('//x') },
    { path: 'other/stray.js', data: Buffer.from('//stray') },
  ]))
  const files = extractPackageFiles(tarball)
  assert.deepEqual(files.map((file) => file.path).sort(), ['lib/index.js', 'package.json'])
  assert.equal(files.find((file) => file.path === 'lib/index.js').data.toString(), '//x')
})

ok('parseTar 支持 ustar prefix 字段拼出完整路径', () => {
  const header = tarHeader('index.js', 4, '0', 'package/lib')
  const body = Buffer.concat([header, Buffer.from('abcd'), Buffer.alloc(512 - 4)])
  const entries = parseTar(Buffer.concat([body, Buffer.alloc(1024)]))
  assert.deepEqual(entries.map((entry) => entry.path), ['package/lib/index.js'])
})

ok('parseTar 支持 pax 扩展头（长路径），且 pax 头本身不作为文件计入', () => {
  const tarball = makeTarball([{ path: 'lib/index.js', data: Buffer.from('//pax') }], { paxPath: 'lib/index.js' })
  const files = extractPackageFiles(tarball)
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'lib/index.js')
  assert.equal(files[0].data.toString(), '//pax')
})

// =====================================================================================
// 4. 校验先行：任一不符都不落盘（验收 2）
// =====================================================================================
ok('verifyPayload：name 不符 / version 不符 / 非 semver / 缺 package.json 全部抛出', () => {
  const good = [{ path: 'package.json', data: Buffer.from(JSON.stringify({ name: PACKAGE_NAME, version: '1.1.0' })) }]
  assert.doesNotThrow(() => verifyPayload(good, { version: '1.1.0' }))
  assert.throws(() => verifyPayload([{ path: 'package.json', data: Buffer.from(JSON.stringify({ name: 'evil-plugin', version: '1.1.0' })) }], { version: '1.1.0' }), /name mismatch/)
  assert.throws(() => verifyPayload([{ path: 'package.json', data: Buffer.from(JSON.stringify({ name: PACKAGE_NAME, version: '1.1.0' })) }], { version: '9.9.9' }), /version mismatch/)
  assert.throws(() => verifyPayload([{ path: 'package.json', data: Buffer.from(JSON.stringify({ name: PACKAGE_NAME, version: 'nightly' })) }], {}), /not semver/)
  assert.throws(() => verifyPayload([{ path: 'lib/index.js', data: Buffer.from('x') }], {}), /no package.json/)
  assert.throws(() => verifyPayload([{ path: 'package.json', data: Buffer.from('{oops') }], {}), /not valid JSON/)
})

ok('verifyPayload：sha512 完整性不符即抛出（防投毒 / 传输损坏）', () => {
  const payload = makePayload('1.1.0')
  const files = extractPackageFiles(payload.tarball)
  assert.doesNotThrow(() => verifyPayload(files, { integrity: payload.integrity, version: '1.1.0', tarball: payload.tarball }))
  assert.throws(
    () => verifyPayload(files, { integrity: 'sha512-' + Buffer.alloc(64).toString('base64'), version: '1.1.0', tarball: payload.tarball }),
    /integrity mismatch/,
  )
})

ok('verifyPayload：白名单外文件与逃逸路径都被拒绝（lib/../ 也拦得住）', () => {
  const withSource = extractPackageFiles(makeTarball([
    { path: 'package.json', data: Buffer.from(JSON.stringify({ name: PACKAGE_NAME, version: '1.1.0' })) },
    { path: 'src/host.js', data: Buffer.from('// 不该被自更新写入') },
  ]))
  assert.throws(() => verifyPayload(withSource, { version: '1.1.0' }), /path not allowed: src\/host\.js/)

  // 前缀看着合法（lib/），展开后却逃出包目录 —— 白名单放行、resolveSafePath 必须拦住
  const escaping = [
    { path: 'package.json', data: Buffer.from(JSON.stringify({ name: PACKAGE_NAME, version: '1.1.0' })) },
    { path: 'lib/../../../../etc/passwd', data: Buffer.from('pwned') },
  ]
  assert.throws(() => verifyPayload(escaping, { version: '1.1.0' }), /escapes/)
})

// =====================================================================================
// 5. 替换中途失败要回滚（验收 3）
// =====================================================================================
ok('applyPayload：写入中途失败 → 包目录完整回到替换前，且无临时文件残留', () => {
  const fx = makeFixture()
  try {
    const before = {
      manifest: readFileSync(join(fx.packageDir, 'package.json'), 'utf8'),
      index: readFileSync(join(fx.packageDir, 'lib', 'index.js'), 'utf8'),
    }
    const backupDir = join(fx.dataDir, 'update-backup', 'broken')
    const files = [
      { path: 'lib/index.js', data: Buffer.from('// partial write\n') },
      { path: 'lib/broken.js', data: null }, // 触发 writeFileSync 抛错，模拟「替换到一半失败」
    ]
    assert.throws(() => applyPayload(files, { packageDir: fx.packageDir, backupDir }))
    assert.equal(readFileSync(join(fx.packageDir, 'lib', 'index.js'), 'utf8'), before.index, '已写入的文件必须回滚')
    assert.equal(readFileSync(join(fx.packageDir, 'package.json'), 'utf8'), before.manifest, 'package.json 必须回滚')
    assert.equal(existsSync(join(fx.packageDir, 'lib', 'broken.js')), false, '失败写入的新文件必须被删掉')
    assert.equal(existsSync(join(fx.packageDir, 'lib', 'broken.js.update-tmp')), false, '不许留下临时文件')
    assert.equal(existsSync(backupDir), false, '回滚后备份目录要清掉')
  } finally { fx.cleanup() }
})

ok('applyPayload：逃逸路径直接拒绝，且不产生任何写入', () => {
  const fx = makeFixture()
  try {
    const before = sha256(join(fx.packageDir, 'lib', 'index.js'))
    assert.throws(
      () => applyPayload([{ path: 'lib/../../evil.js', data: Buffer.from('x') }], { packageDir: fx.packageDir, backupDir: join(fx.dataDir, 'update-backup', 'evil') }),
      /refusing to write outside package/,
    )
    assert.equal(sha256(join(fx.packageDir, 'lib', 'index.js')), before)
    assert.equal(existsSync(join(fx.profileDir, 'node_modules', 'evil.js')), false)
  } finally { fx.cleanup() }
})

// =====================================================================================
// 6. 只升不降（验收 1）
// =====================================================================================
await okAsync('远端版本等于运行中版本 → 不下载、不替换、不写待重启状态', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.0.0')
    const { updater, requests } = makeUpdater(fx, { payload, latestVersion: '1.0.0' })
    const state = await updater.run()
    assert.equal(requests.length, 1, '只应查一次 /latest，绝不下载 tarball')
    assert.ok(requests[0].endsWith('/latest'))
    assert.equal(state.pendingVersion, null)
    assert.equal(JSON.parse(readFileSync(join(fx.packageDir, 'package.json'), 'utf8')).version, '1.0.0')
    assert.equal(readFileSync(join(fx.packageDir, 'lib', 'index.js'), 'utf8'), '// old host\n')
    assert.equal(existsSync(join(fx.dataDir, 'update-backup')), false)
  } finally { fx.cleanup() }
})

await okAsync('远端版本低于运行中版本 → 同样跳过（防误回退 / 防投毒）', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('0.9.0')
    const { updater, requests } = makeUpdater(fx, { payload, latestVersion: '0.9.0' })
    const state = await updater.run({ manual: true })
    assert.equal(requests.length, 1)
    assert.equal(state.pendingVersion, null)
    assert.equal(state.lastError, null)
    assert.equal(readFileSync(join(fx.packageDir, 'lib', 'index.js'), 'utf8'), '// old host\n')
  } finally { fx.cleanup() }
})

// =====================================================================================
// 7. 正常升级：替换 + 校验 + 备份 + 状态
// =====================================================================================
await okAsync('正常升级：替换包内文件、留下备份、记录待重启，且运行中版本不变', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const { updater, requests } = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    const state = await updater.run()
    assert.equal(requests.length, 2, '一次查版本 + 一次下载 tarball')
    assert.ok(requests[1].includes('/-/' + PACKAGE_NAME + '-1.1.0.tgz'))
    assert.equal(state.pendingVersion, '1.1.0')
    assert.equal(state.lastError, null)
    assert.equal(state.updatedAt, 1758800000000)
    // 磁盘已换新
    assert.equal(JSON.parse(readFileSync(join(fx.packageDir, 'package.json'), 'utf8')).version, '1.1.0')
    assert.equal(readFileSync(join(fx.packageDir, 'lib', 'index.js'), 'utf8'), '// host 1.1.0\n')
    assert.equal(readFileSync(join(fx.packageDir, 'lib', 'client.js'), 'utf8'), '// client 1.1.0\n')
    // 备份里是旧内容
    const backupManifest = join(fx.dataDir, 'update-backup', '1.1.0', 'package.json')
    assert.equal(JSON.parse(readFileSync(backupManifest, 'utf8')).version, '1.0.0')
    // 内存仍在跑旧版本：这正是「必须提示重启」的原因
    const view = updater.getState()
    assert.equal(view.runningVersion, '1.0.0')
    assert.equal(view.diskVersion, '1.1.0')
    assert.equal(view.updated, true, 'runningVersion 与磁盘不一致时 updated 必须为 true')
  } finally { fx.cleanup() }
})

await okAsync('升级后状态落盘，重启（新实例、新运行版本）后提示自动消失', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const first = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    await first.updater.run()
    // 模拟重启：磁盘已是 1.1.0，宿主加载到的运行版本也就是 1.1.0
    const second = makeUpdater(fx, { payload, latestVersion: '1.1.0', runningVersion: '1.1.0' })
    second.updater.loadState()
    const view = second.updater.getState()
    assert.equal(view.pendingVersion, '1.1.0')
    assert.equal(view.diskVersion, '1.1.0')
    assert.equal(view.updated, false, '重启后 pendingVersion === runningVersion，提示必须消失')
    // 下次启动再跑一次：磁盘已是新版，不该重复下载
    const after = await second.updater.run()
    assert.equal(after.pendingVersion, '1.1.0')
    assert.equal(second.requests.length, 1, '磁盘已是新版，只查版本、不重复下载')
    assert.equal(second.requests[0].endsWith('/latest'), true)
  } finally { fx.cleanup() }
})

// =====================================================================================
// 8. 校验失败不破坏现有安装（验收 2 的落盘侧）
// =====================================================================================
await okAsync('完整性问题：不落盘、状态记失败，现有安装与账单数据都不受影响', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    writeFileSync(join(fx.dataDir, 'usage-records.json'), '{"records":[1,2,3]}\n')
    const payload = makePayload('1.1.0')
    const { updater } = makeUpdater(fx, {
      payload,
      latestVersion: '1.1.0',
      latestIntegrity: 'sha512-' + Buffer.alloc(64).toString('base64'),
    })
    const state = await updater.run()
    assert.match(state.lastError, /integrity mismatch/)
    assert.equal(state.pendingVersion, null)
    assert.equal(JSON.parse(readFileSync(join(fx.packageDir, 'package.json'), 'utf8')).version, '1.0.0')
    assert.equal(readFileSync(join(fx.packageDir, 'lib', 'index.js'), 'utf8'), '// old host\n')
    assert.equal(existsSync(join(fx.dataDir, 'update-backup', '1.1.0')), false, '校验失败时连备份目录都不该留下')
    assert.equal(readFileSync(join(fx.dataDir, 'usage-records.json'), 'utf8'), '{"records":[1,2,3]}\n', '账单数据绝不被更新流程触碰')
  } finally { fx.cleanup() }
})

await okAsync('下载失败（HTTP 500）：状态记失败、包目录不变', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const { updater } = makeUpdater(fx, {
      payload,
      latestVersion: '1.1.0',
      onFetch: async (url) => (url.endsWith('/latest') ? null : { ok: false, status: 500, json: async () => ({}), arrayBuffer: async () => Buffer.alloc(0) }),
    })
    const state = await updater.run()
    assert.match(state.lastError, /http 500/)
    assert.equal(readFileSync(join(fx.packageDir, 'lib', 'index.js'), 'utf8'), '// old host\n')
  } finally { fx.cleanup() }
})

await okAsync('网络不可用：latest 为 null；手动检查记 check-failed，自动检查保留上次错误', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const auto = makeUpdater(fx, { payload, latestError: true })
    const autoState = await auto.updater.run()
    assert.equal(autoState.latest, null)
    assert.equal(autoState.lastError, null, '自动检查失败不该在界面上冒错误（安静重试）')

    const manual = makeUpdater(fx, { payload, latestError: true })
    manual.updater.loadState()
    const manualState = await manual.updater.run({ manual: true })
    assert.equal(manualState.latest, null)
    assert.equal(manualState.lastError, 'check-failed', '用户主动点的检查必须给出反馈')
  } finally { fx.cleanup() }
})

await okAsync('registry 404（包不存在）：不抛错、不落盘', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const { updater } = makeUpdater(fx, { payload, latest: null })
    const state = await updater.run()
    assert.equal(state.latest, null)
    assert.equal(readFileSync(join(fx.packageDir, 'lib', 'index.js'), 'utf8'), '// old host\n')
  } finally { fx.cleanup() }
})

// =====================================================================================
// 9. 不碰依赖树（验收 5）
// =====================================================================================
await okAsync('更新只改插件包自身：profile 的 package.json / pnpm-lock.yaml 字节不变', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const profileManifest = sha256(join(fx.profileDir, 'package.json'))
    const lockfile = sha256(join(fx.profileDir, 'pnpm-lock.yaml'))
    const payload = makePayload('1.1.0')
    const { updater } = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    await updater.run()
    assert.equal(sha256(join(fx.profileDir, 'package.json')), profileManifest)
    assert.equal(sha256(join(fx.profileDir, 'pnpm-lock.yaml')), lockfile)
    assert.deepEqual(
      readdirSync(join(fx.profileDir, 'node_modules')).sort(),
      [PACKAGE_NAME],
      '不该在 node_modules 里额外创建任何东西（不引入依赖、不写 .pnpm 快照）',
    )
  } finally { fx.cleanup() }
})

ok('源码级证据：引擎自身不引入子进程 / 包管理器，不触碰 profile 清单', () => {
  // 只看代码，不看注释 —— 文件头部的说明文字本身就在讲「绝不执行 pnpm」，那不是调用。
  const code = readFileSync(join(root, 'src', 'self-update.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /child_process|execSync|spawnSync|execFile/, '自更新不许执行子进程')
  assert.doesNotMatch(code, /\bpnpm\b|\bnpm\s+install\b|\byarn\b|\bnpx\b/, '自更新不许调用包管理器')
  assert.doesNotMatch(code, /pnpm-lock\.yaml|profiles[\/\\]/, '自更新不许触碰 profile 清单')
  // 允许操作的根：只有包目录内白名单
  assert.match(code, /const PAYLOAD_ROOTS = \['lib\/', 'locale\/', 'docs\/'\]/)
})

// =====================================================================================
// 10. 可关闭（验收 6）
// =====================================================================================
await okAsync('关闭自动更新后：只查版本、不下载、不替换，并给出 skipped 原因', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const { updater, requests } = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    updater.setAutoUpdate(false)
    const state = await updater.run()
    assert.equal(requests.length, 1, '关闭后不许产生任何下载请求')
    assert.equal(state.skipped, 'auto-disabled')
    assert.equal(state.latest, '1.1.0', '仍要知道有新版本，才能提示用户')
    assert.equal(state.pendingVersion, null)
    assert.equal(readFileSync(join(fx.packageDir, 'lib', 'index.js'), 'utf8'), '// old host\n')
  } finally { fx.cleanup() }
})

await okAsync('开关状态落盘，重启后仍是关闭', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const first = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    first.updater.setAutoUpdate(false)
    const second = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    second.updater.loadState()
    assert.equal(second.updater.getState().autoUpdate, false)
  } finally { fx.cleanup() }
})

await okAsync('手动检查可以越过开关（用户显式要求时才下载）', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const { updater, requests } = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    updater.setAutoUpdate(false)
    const state = await updater.run({ manual: true })
    assert.equal(requests.length, 2)
    assert.equal(state.pendingVersion, '1.1.0')
    assert.equal(JSON.parse(readFileSync(join(fx.packageDir, 'package.json'), 'utf8')).version, '1.1.0')
  } finally { fx.cleanup() }
})

// =====================================================================================
// 11. 回滚
// =====================================================================================
await okAsync('回滚：恢复备份内容、清掉待重启状态', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const { updater } = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    await updater.run()
    assert.equal(JSON.parse(readFileSync(join(fx.packageDir, 'package.json'), 'utf8')).version, '1.1.0')
    const result = updater.rollback()
    assert.equal(result.restored, true)
    assert.equal(result.version, '1.1.0')
    assert.equal(JSON.parse(readFileSync(join(fx.packageDir, 'package.json'), 'utf8')).version, '1.0.0')
    assert.equal(readFileSync(join(fx.packageDir, 'lib', 'index.js'), 'utf8'), '// old host\n')
    assert.equal(readFileSync(join(fx.packageDir, 'lib', 'client.js'), 'utf8'), '// old client\n')
    assert.equal(updater.getState().pendingVersion, null)
  } finally { fx.cleanup() }
})

ok('回滚的两条兜底：没有待重启版本 / 备份缺失，都返回可辨识原因而不是抛错', () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const updater = createSelfUpdater({ packageDir: fx.packageDir, dataDir: fx.dataDir, runningVersion: '1.0.0' })
    updater.loadState()
    assert.deepEqual(updater.rollback(), { restored: false, reason: 'nothing-to-roll-back' })
    writeFileSync(join(fx.dataDir, 'update-state.json'), JSON.stringify({ pendingVersion: '1.1.0' }))
    updater.loadState()
    assert.deepEqual(updater.rollback(), { restored: false, reason: 'no-backup' })
  } finally { fx.cleanup() }
})

// =====================================================================================
// 12. 并发与日志
// =====================================================================================
await okAsync('并发调用复用同一次运行（不会重复下载）', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const { updater, requests } = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    const [a, b] = await Promise.all([updater.run(), updater.run()])
    assert.equal(requests.length, 2, '两次调用只应产生 1 次 /latest + 1 次 tarball')
    assert.equal(a.pendingVersion, '1.1.0')
    assert.equal(b.pendingVersion, '1.1.0')
  } finally { fx.cleanup() }
})

await okAsync('所有动作写审计日志到 update-log.jsonl（用户可自查插件改了什么）', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const { updater } = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    await updater.run()
    updater.rollback()
    const lines = readFileSync(join(fx.dataDir, 'update-log.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(lines.map((line) => line.event), ['updated', 'rolled-back'])
    assert.equal(lines[0].version, '1.1.0')
    assert.equal(lines[0].ts, 1758800000000)
  } finally { fx.cleanup() }
})

await okAsync('备份只保留最近 keepBackups 份，不无限占用户空间', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    for (const version of ['1.1.0', '1.2.0', '1.3.0']) {
      const payload = makePayload(version)
      const updater = createSelfUpdater({
        packageDir: fx.packageDir,
        dataDir: fx.dataDir,
        runningVersion: '1.0.0',
        keepBackups: 2,
        fetch: async (url) => (url.endsWith('/latest')
          ? jsonResponse({ version, dist: { integrity: payload.integrity } })
          : bufferResponse(payload.tarball)),
      })
      await updater.run()
    }
    const backups = readdirSync(join(fx.dataDir, 'update-backup')).sort()
    assert.deepEqual(backups, ['1.2.0', '1.3.0'])
  } finally { fx.cleanup() }
})

// =====================================================================================
// 13. host / client 接线（验收 7 的接线侧）
// =====================================================================================
ok('host 接线：装载形态闸门 + 测试隔离开关 + 4 个 RPC 与变更方法声明齐备', () => {
  const host = readFileSync(join(root, 'src', 'host.js'), 'utf8')
  assert.match(host, /function isLoadedAsProfilePlugin\(\)/, '必须只在被当作 profile 插件装载时启用自更新')
  assert.match(host, /DSH_BOTTOM_INFO_BAR_SELF_UPDATE/, '必须保留测试隔离开关')
  assert.match(host, /from '\.\/self-update\.js'/, 'host 必须复用同一份引擎')
  for (const rpc of ['getUpdateState', 'runUpdateCheck', 'setUpdateAuto', 'rollbackUpdate']) {
    assert.match(host, new RegExp(rpc + ': async function'), 'host 缺少 RPC ' + rpc)
  }
  // 只有真正会下载 / 改文件 / 写开关的三个才是变更方法（走 POST + 同源防护）；
  // getUpdateState 是纯读，必须是 GET，否则客户端轮询会被同源防护挡下。
  for (const rpc of ['runUpdateCheck', 'setUpdateAuto', 'rollbackUpdate']) {
    assert.match(host, new RegExp(rpc + ': true'), rpc + ' 必须声明为变更方法（POST + 同源防护）')
  }
  assert.doesNotMatch(host, /getUpdateState: true/, 'getUpdateState 是只读 RPC，不得声明为变更方法')
  // 老宿主 / 缺 effect 的桩 ctx 不许把 apply 打崩（本仓库已踩过 ctx Proxy 的坑）
  assert.match(host, /typeof ctx\.effect === 'function'/, 'ctx.effect 必须做能力检测')
})

ok('client 接线：设置页有版本与更新区，信息栏只在待重启 / 失败时出短标记', () => {
  const client = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')
  assert.match(client, /function bibSetVersionSection\(/)
  assert.match(client, /bibSetVersionSection\(\{/, '设置页必须渲染版本与更新区')
  assert.match(client, /\.bi-update-badge\{/)
  assert.match(client, /\.bi-update-badge--error\{/)
  // 短标记只在两种真正需要用户动作的情况下出现，绝不常驻占位
  assert.match(client, /const restartVersion = updateInfo && updateInfo\.pendingRestart === true \? updateInfo\.diskVersion : null/)
  assert.match(client, /const updateFailed = !!\(updateStatus && updateStatus\.lastError\)/)
  // 两枚标记各自挂在「提醒信息」组的独立开关上（2026-09-25 用户拍板 4c）：
  // 必须是两条独立门控，不能合并成一个总开关，也不能受简洁/完整模式影响。
  assert.match(client, /if \(restartVersion && fieldVisible\('updateNotice'\)\) \{/)
  assert.match(client, /if \(updateFailed && fieldVisible\('updateFailure'\)\) \{/)
  assert.doesNotMatch(client, /if \(restartVersion \|\| updateFailed\) \{/, '两枚标记不得共用一个总开关')
  assert.doesNotMatch(client, /(restartVersion|updateFailed)[\s\S]{0,80}(full|compact) &&/, '更新标记不得受简洁/完整模式门控')
  // 不许引导用户去复制命令：自更新已接管，旧提示词只在收到更新命令时使用
  assert.doesNotMatch(client, /bi-update-badge[\s\S]{0,200}navigator\.clipboard/, '短标记不该再复制命令')
})

ok('版本与更新区在读不到状态时也不消失（2026-09-25 血案：桌面端没重启时整块不见了）', () => {
  const client = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')
  // 场景：包文件已被替换成新版，但 DSH 进程仍是启动时载入的旧 host —— 此时 getUpdateState
  // 这个 RPC 在旧 host 里不存在，读状态必然失败。旧写法 `if (!state) return null` 会让整块消失，
  // 用户只能得出「还是得卸载重装」的结论，于是来报「设置页里还是没有更新相关的内容」。
  assert.doesNotMatch(client, /function bibSetVersionSection\(props\) \{\s*const state = props\.state;\s*if \(!state\) return null;/,
    '读不到状态时不得直接返回 null：整块消失等于用户看不到任何更新入口')
  assert.match(client, /const \[updateError, setUpdateError\] = React\.useState\(null\)/, '必须记录读不到状态的原因')
  assert.match(client, /setUpdateError\(String\(\(err && err\.message\) \|\| err \|\| 'unknown'\)\)/, '失败时必须留下原因')
  assert.match(client, /error: updateError,/, '原因必须传给版本区')
  assert.match(client, /t\('ui\.versionUnavailable'\)/, '必须有一句说明「重启 DSH 后就会出现」')
  // 成功读到一次即清除；此后的偶发失败不得把已经显示出来的版本信息换掉
  assert.match(client, /setUpdateError\(null\);/, '成功读取必须清除错误状态')
})

ok('文案齐备：新增的版本与更新键中英双语、无 AI 腔、无长破折号', () => {
  const source = readFileSync(join(root, 'src', 'locales.js'), 'utf8')
  const block = source.match(/export const LOCALES = \{[\s\S]*\n\}/)
  const dictionary = JSON.parse(block[0].replace('export const LOCALES = ', ''))
  const keys = Object.keys(dictionary.zh).filter((key) => /^ui\.(version|autoUpdate|update)/.test(key))
  assert.ok(keys.length >= 18, '版本与更新文案键数量异常：' + keys.length)
  const smellZh = /一键|轻松|极致|丝滑|强大|完美|立即|马上|告别/
  const smellEn = /seamless|effortless|powerful|unleash|revolutionary|game.?chang|supercharge/i
  const shared = /[—–]|[!！]/
  for (const key of keys) {
    assert.equal(typeof dictionary.en[key], 'string', 'English copy missing for ' + key)
    assert.notEqual(dictionary.zh[key], dictionary.en[key], key + ' must be translated')
    assert.doesNotMatch(dictionary.zh[key], smellZh, key + ' zh has marketing filler')
    assert.doesNotMatch(dictionary.en[key], smellEn, key + ' en has marketing filler')
    assert.doesNotMatch(dictionary.zh[key], shared, key + ' zh must not use exclamation / long dash')
    assert.doesNotMatch(dictionary.en[key], shared, key + ' en must not use exclamation / long dash')
  }
})

console.log('\n自更新引擎单测：' + passed + ' PASS / ' + failed + ' FAIL')
if (failed > 0) {
  console.log(failures.join('\n'))
  process.exit(1)
}
process.exit(0)
