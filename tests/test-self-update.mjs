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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
  PACKAGE_NAME,
  UPDATE_ERROR_KINDS,
  applyPayload,
  compareSemver,
  createSelfUpdater,
  describeUpdateError,
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
    // 通配条目（如 locale/*.json）展开成一个真实路径再验白名单；用 /g 全局替换：
    // 只替换首个星号是 CodeQL js/incomplete-sanitization 抓到的写法（一个条目里可能有多个 *）。
    if (entry.includes('*')) candidates.push(entry.replace(/\*/g, 'en'))
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

ok('verifyPayload：重复路径一律拒绝，避免校验的 manifest 与最终写入文件不一致', () => {
  const manifest = Buffer.from(JSON.stringify({ name: PACKAGE_NAME, version: '1.1.0' }))
  assert.throws(() => verifyPayload([
    { path: 'package.json', data: manifest },
    { path: 'package.json', data: Buffer.from(JSON.stringify({ name: 'evil-plugin', version: '9.9.9' })) },
  ], { version: '1.1.0' }), /duplicate or invalid path/)
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

ok('applyPayload：包内中间目录是符号链接时拒绝，绝不沿链接写到包外', () => {
  const fx = makeFixture()
  try {
    const outside = join(fx.base, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'index.js'), '// outside must not change\n')
    rmSync(join(fx.packageDir, 'lib'), { recursive: true, force: true })
    symlinkSync(outside, join(fx.packageDir, 'lib'), 'dir')
    assert.throws(
      () => applyPayload([{ path: 'lib/index.js', data: Buffer.from('// malicious replacement\n') }], {
        packageDir: fx.packageDir,
        backupDir: join(fx.dataDir, 'update-backup', 'symlink'),
      }),
      /symbolic link/,
    )
    assert.equal(readFileSync(join(outside, 'index.js'), 'utf8'), '// outside must not change\n')
    assert.equal(existsSync(join(fx.dataDir, 'update-backup', 'symlink')), false, '预检失败不得创建备份')
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
// 6b. 校验链上不允许「静默跳过」（安全纵深：fail closed）
// =====================================================================================
// 背景：本模块会替换自己的全部文件，所以任何"看不懂就放过去"的分支都是缺口。
// 两条曾经的真实缺口：① 远端版本号未校验就被拼进下载地址；② 校验值缺失/算法不认识时静默跳过校验。
await okAsync('远端版本不是规范 semver → 视为没有新版本，绝不把它拼进下载地址', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.2.0')
    const { updater, requests } = makeUpdater(fx, { payload, latestVersion: '1.2.0-rc.1' })
    const state = await updater.run({ manual: true })
    assert.equal(requests.length, 1, '只查 /latest，不去下载')
    assert.equal(state.pendingVersion, null)
    assert.equal(state.lastError, 'check-failed')
  } finally { fx.cleanup() }
})

await okAsync('远端没给校验值 → 放弃更新（宁可不升，也不装一个无法验证的包）', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.2.0')
    const { updater, requests } = makeUpdater(fx, {
      payload,
      onFetch: async (url) => (url.endsWith('/latest') ? jsonResponse({ version: '1.2.0', dist: {} }) : null),
    })
    const state = await updater.run({ manual: true })
    assert.equal(requests.length, 1, '只查 /latest，不去下载')
    assert.equal(state.pendingVersion, null)
    assert.equal(state.lastError, 'check-failed')
  } finally { fx.cleanup() }
})

ok('verifyPayload 拒绝看不懂的校验算法（给了校验值就必须验得动）', () => {
  const payload = makePayload('1.2.0')
  const files = extractPackageFiles(payload.tarball)
  assert.throws(
    () => verifyPayload(files, { integrity: 'sha1-deadbeef', version: '1.2.0', tarball: payload.tarball }),
    /unsupported algorithm/,
  )
  // 对照组：正确的 sha512 校验值照常通过（拒绝的是"看不懂"，不是"校验"本身）
  assert.equal(verifyPayload(files, { integrity: payload.integrity, version: '1.2.0', tarball: payload.tarball }).version, '1.2.0')
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
    // 状态里存的是归一后的原因代号（界面据此翻译成人话，不再把英文报错甩给用户）；
    // 原始报错必须同时进审计日志，否则排查线索断了。2026-09-25 第三轮起如此。
    assert.equal(state.lastError, 'integrity-mismatch')
    assert.match(readFileSync(join(fx.dataDir, 'update-log.jsonl'), 'utf8'), /integrity mismatch/)
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
    assert.equal(state.lastError, 'download-failed')
    assert.match(readFileSync(join(fx.dataDir, 'update-log.jsonl'), 'utf8'), /http 500/)
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
ok('host 接线：装载形态闸门 + 测试隔离开关 + 全部更新 RPC 与变更方法声明齐备', () => {
  const host = readFileSync(join(root, 'src', 'host.js'), 'utf8')
  assert.match(host, /function isLoadedAsProfilePlugin\(\)/, '必须只在被当作 profile 插件装载时启用自更新')
  assert.match(host, /DSH_BOTTOM_INFO_BAR_SELF_UPDATE/, '必须保留测试隔离开关')
  assert.match(host, /from '\.\/self-update\.js'/, 'host 必须复用同一份引擎')
  // 2026-09-26：检查与安装拆成两个接口，老名字 runUpdateCheck 只留给旧页面。
  for (const rpc of ['getUpdateState', 'checkUpdate', 'installUpdate', 'runUpdateCheck', 'setUpdateAuto', 'rollbackUpdate']) {
    assert.match(host, new RegExp(rpc + ': async function'), 'host 缺少 RPC ' + rpc)
  }
  // 只有真正会下载 / 改文件 / 写开关的才是变更方法（走 POST + 同源防护）；checkUpdate 虽然只读磁盘，
  // 但它会写「上次检查时间」并触发一次网络查询，同样必须 POST。
  // getUpdateState 是纯读，必须是 GET，否则客户端轮询会被同源防护挡下。
  for (const rpc of ['checkUpdate', 'installUpdate', 'runUpdateCheck', 'setUpdateAuto', 'rollbackUpdate']) {
    assert.match(host, new RegExp(rpc + ': true'), rpc + ' 必须声明为变更方法（POST + 同源防护）')
  }
  assert.doesNotMatch(host, /getUpdateState: true/, 'getUpdateState 是只读 RPC，不得声明为变更方法')
  // 检查走引擎的只读分支、安装走写分支 —— 写死了这两个 mode 才谈得上「检查不会装」
  assert.match(host, /run\(\{ mode: 'check', manual: true \}\)/, 'checkUpdate 必须走只读的检查分支')
  assert.match(host, /run\(\{ mode: 'install', manual: true, force: force \}\)/, 'installUpdate 必须走安装分支')
  assert.match(host, /runUpdateCheck: async function \(args\) \{\s*return ROUTES\.installUpdate\(args\)/,
    '老接口 runUpdateCheck 只能当作 installUpdate 的别名（旧页面的语义就是「检查并安装」）')
  // 状态只有一个出口：所有更新 RPC 都返回同一份 payload，客户端不必把两种形状拼起来
  assert.match(host, /async function updateStatePayload\(\)/)
  const payloadUses = (host.match(/updateStatePayload\(\)/g) || []).length
  assert.ok(payloadUses >= 6, '6 个更新 RPC 都应从同一个出口取状态（实得 ' + payloadUses + ' 处）')
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
  assert.match(client, /error: deps\.updateError/, '原因必须传给版本区（经设置区注册表转交）')
  assert.match(client, /updateError: updateError,/, '设置区上下文必须带上读失败的原因' )
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

await okAsync('磁盘已是新版、运行版本更旧：手动检查也不重复下载（原来手动绕过防重，连点会反复替换）', async () => {
  const fx = makeFixture({ version: '1.1.0' })
  try {
    const payload = makePayload('1.1.0')
    const { updater, requests } = makeUpdater(fx, { payload, latestVersion: '1.1.0', runningVersion: '1.0.0' })
    const state = await updater.run({ manual: true })
    const tarballRequests = requests.filter((url) => !url.endsWith('/latest'))
    assert.deepEqual(tarballRequests, [], '磁盘已经是这个版本，不该再下载一次')
    assert.equal(state.pendingVersion, '1.1.0', '但要记住「已装好待重启」')
    assert.equal(existsSync(join(fx.dataDir, 'update-backup', '1.1.0')), false, '没下载自然也不该多留备份')
    // 内存跑 1.0.0、磁盘已是 1.1.0：界面据此提示重启
    assert.equal(updater.getState().runningVersion, '1.0.0')
    assert.equal(updater.getState().diskVersion, '1.1.0')
  } finally { fx.cleanup() }
})

// =====================================================================================
// 14. 2026-09-25 第三轮：失败原因归一 + 设置页三层组织（用户拍板「状态—设置—兜底 / 说明随选择变 /
//     按需出现 / 保持只在启动时检查一次」）
// =====================================================================================
ok('失败原因归一：技术报错 → 稳定代号，认得出历史原始值，且幂等', () => {
  assert.equal(describeUpdateError('unexpected end of file'), 'incomplete-download')
  assert.equal(describeUpdateError('payload integrity mismatch'), 'integrity-mismatch')
  assert.equal(describeUpdateError('download failed: http 404'), 'download-failed')
  assert.equal(describeUpdateError('download failed: too large (99999 bytes)'), 'too-large')
  assert.equal(describeUpdateError('payload version mismatch: 1.0.0 != 1.1.0'), 'payload-mismatch')
  assert.equal(describeUpdateError('refusing to write outside package: x'), 'payload-unsafe')
  assert.equal(describeUpdateError('check-failed'), 'check-failed')
  // 已经是代号的值必须原样返回（幂等）：否则从磁盘加载回来的状态会被二次归一，越归越歪
  for (const kind of UPDATE_ERROR_KINDS) assert.equal(describeUpdateError(kind), kind)
  assert.equal(describeUpdateError('something nobody has seen before'), 'unknown')
  assert.equal(describeUpdateError(''), 'unknown')
  assert.equal(describeUpdateError(null), 'unknown')
})

ok('设置页三层组织：状态 / 设置 / 兜底，动作按钮与设置分开，且两个动词不混用', () => {
  const client = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')
  // ① 状态层：结论在上（大字）、事实在下（小字含「上次检查」，用户据此确认它有没有在干活）
  assert.match(client, /React\.createElement\('p', \{ className: 'bib-set-data-title' \}, statusText\)/)
  assert.match(client, /facts\.push\(t\('ui\.versionLastCheck', \{ time: checkedAt \}\)\)/)
  // ② 设置层：说明跟着选中项变，不再把两种方式的说明并排摊开
  assert.match(client, /manual \? t\('ui\.updateModeManualDesc'\) : t\('ui\.updateModeAutoDesc'\)/)
  // ③ 兜底层：回滚的唯一依据不再是 pendingVersion —— 它为了定位备份而永不清除，
  //    原来那样写会让「回滚到上一版」一旦更新成功就永久常驻（用户说「像乱加上去的」）。
  assert.match(client, /const canRollback = restartDirection === 'update' \|\| !!state\.lastError;/)
  assert.doesNotMatch(client, /canRollback = !!state\.pendingVersion/)
  // 失败原因讲人话：读代号，绝不把英文报错回显给用户
  assert.match(client, /updateErrorText\(state\.lastErrorKind \|\| state\.lastError\)/)
  assert.match(client, /state\.lastError && !disabled \? React\.createElement/)
})

ok('2026-09-26：检查与安装拆成两个按钮，检查按钮不再藏进「更新方式」行', () => {
  const client = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')
  // 两个动词：检查 = checkUpdate（纯读），安装 = installUpdate（唯一的写动作）
  assert.match(client, /rpc\('checkUpdate'\)/)
  assert.match(client, /rpc\('installUpdate'\)/)
  assert.match(client, /rpc\('installUpdate', \{ force: true \}\)/)
  assert.doesNotMatch(client, /rpc\('runUpdateCheck'/, '新界面不得再调用「检查即安装」的老接口')
  // 按钮标签：检查中 → 检查中…；安装中 → 正在更新到 X；有新版才出现「更新到 X」
  assert.match(client, /children: busy && phase === 'check' \? t\('ui\.updateChecking'\) : t\('ui\.updateCheckNow'\)/)
  assert.match(client, /const showInstall = !disabled && available && !held;/)
  assert.match(client, /\? t\('ui\.updateInstalling', \{ version: latest \}\)\s*\n\s*: t\('ui\.updateInstallNow', \{ version: latest \}\)/)
  // 被暂缓的版本不能再摆「更新到 X」：那一下会被引擎的暂缓分支吃掉，界面看起来像没反应。
  assert.doesNotMatch(client, /showInstall = .*holdVersion/, '暂缓判定必须参与 install 按钮的显隐')
  // 结论行：安装中要如实说「正在更新到 X」（装的过程好几秒，否则用户以为点漏了）
  assert.match(client, /else if \(busy && phase === 'install' && latest\) statusText = t\('ui\.updateInstalling', \{ version: latest \}\);/)
  // 「宿主还是旧版」这个真实窗口必须有人话（新版界面 + 未重启的旧 host → 404 unknown method）
  assert.match(client, /function bibSetMissingMethod\(err\)/)
  assert.match(client, /t\('ui\.updateHostOutdated'\)/)
})

ok('2026-09-26：动作完成后重新读状态（半状态会让结论说说谎最多 15 秒）', () => {
  const client = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')
  // 读状态只有一个入口：轮询与动作后共用它
  assert.match(client, /function loadUpdateState\(\)/)
  assert.match(client, /return loadUpdateState\(\)\.then\(function \(\) \{/)
  // 旧写法：把动作返回值 merge 进旧状态 —— 动作结果少几个字段，结论行就会短暂说假话
  assert.doesNotMatch(client, /setUpdateState\(function \(prev\) \{ return Object\.assign\(\{\}, prev \|\| \{\}, res\); \}\)/)
  // 四个动作全部走同一条通道（忙碌态 + 动作名 + 重读）
  for (const call of ["runUpdateAction('mode'", "runUpdateAction('check'", "runUpdateAction('install'"]) {
    assert.ok(client.includes(call), '更新动作必须统一走 runUpdateAction：' + call)
  }
  assert.equal((client.match(/runUpdateAction\('install'/g) || []).length, 2, '安装与强制安装都走 install 通道')
})

ok('2026-09-26：更新动作前后保护滚动位置（用户报「点完更新，设置页滑到最上端」）', () => {
  const client = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')
  assert.match(client, /const BIB_SET_SCROLL_RESTORE_MS = 2000;/)
  assert.match(client, /function bibSetScrollHost\(node\)/)
  assert.match(client, /function bibSetRememberScroll\(root\)/)
  assert.match(client, /function bibSetRestoreScroll\(\)/)
  assert.match(client, /bibSetRememberScroll\(settingsRootRef\.current\);/)
  // 三条自我约束：只在原本不为 0 时记、只在被重置为 0 且未过期时还原、节点已脱离文档就放弃
  assert.match(client, /if \(!host \|\| !\(host\.scrollTop > 0\)\) return;/)
  assert.match(client, /if \(Date\.now\(\) > pending\.expiresAt\) return;/)
  assert.match(client, /if \(!pending\.host\.isConnected\) return;/)
  assert.match(client, /if \(pending\.host\.scrollTop !== 0\) return;/)
  // 页面被重建时（React 重挂载）靠 layout effect 补回：记录存在模块作用域，跨重建存活
  assert.match(client, /bibSetRestoreScroll\(\);\s*\n\s*return bibSetHideHostScrollbars/)
})

// =====================================================================================
// 15. 2026-09-26：检查与安装拆开（用户报「点了一下检查更新，它就直接装好了」）
// =====================================================================================
await okAsync('检查模式：确认有新版后立刻返回 —— 不下载、不替换、不记待重启、不留备份', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const { updater, requests } = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    const state = await updater.run({ mode: 'check', manual: true })
    assert.deepEqual(requests.filter((url) => !url.endsWith('/latest')), [], '检查不该下载 tarball')
    assert.equal(state.checkedOnly, true, '返回值必须自报「这只是一次检查」')
    assert.equal(state.pendingVersion, null, '检查不得记「已装好待重启」')
    assert.equal(updater.getState().diskVersion, '1.0.0', '磁盘版本必须原封不动')
    assert.equal(existsSync(join(fx.dataDir, 'update-backup')), false, '检查不得留下备份目录')
    // 但「上次检查时间」必须更新：用户据此确认按钮真的去问了（否则按钮看起来像没反应）
    assert.equal(
      JSON.parse(readFileSync(join(fx.dataDir, 'update-state.json'), 'utf8')).lastCheckAt,
      1758800000000,
    )
  } finally { fx.cleanup() }
})

await okAsync('检查模式：连不上版本服务时记 check-failed，成功时只清这一条，绝不抹掉「上次更新失败」', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const offline = makeUpdater(fx, { payload, latestError: true })
    await offline.updater.run({ mode: 'check', manual: true })
    assert.equal(offline.updater.getState().lastErrorKind, 'check-failed', '检查失败也要让用户看得见')
    // 网络恢复：这一条被清掉
    writeFileSync(join(fx.dataDir, 'update-state.json'), JSON.stringify({ lastError: 'check-failed' }))
    const online = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    online.updater.loadState()
    await online.updater.run({ mode: 'check', manual: true })
    assert.equal(online.updater.getState().lastError, null)
    // 但「上次更新失败」是逃生门（回滚）的依据，检查顺利不能顺手抹掉它
    writeFileSync(join(fx.dataDir, 'update-state.json'), JSON.stringify({ lastError: 'integrity-mismatch' }))
    const afterFailure = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    afterFailure.updater.loadState()
    await afterFailure.updater.run({ mode: 'check', manual: true })
    assert.equal(afterFailure.updater.getState().lastErrorKind, 'integrity-mismatch')
  } finally { fx.cleanup() }
})

await okAsync('检查与安装各占一个在途槽位：检查在跑时来的安装请求照样会装（不被空转吞掉）', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    const { updater } = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    const [check, install] = await Promise.all([
      updater.run({ mode: 'check', manual: true }),
      updater.run({ mode: 'install', manual: true }),
    ])
    assert.equal(check.checkedOnly, true)
    assert.equal(install.pendingVersion, '1.1.0')
    assert.equal(updater.getState().diskVersion, '1.1.0', '安装请求不能被检查的去重吞掉')
  } finally { fx.cleanup() }
})

await okAsync('手动安装仍受「只升不降」与「暂缓」约束（检查拆开没有放松任何一条硬边界）', async () => {
  const fx = makeFixture({ version: '1.0.0' })
  try {
    const payload = makePayload('1.1.0')
    // 磁盘已是新版：手动安装也不重复下载
    const current = makeUpdater(fx, { payload, latestVersion: '1.1.0' })
    writeFileSync(join(fx.packageDir, 'package.json'), JSON.stringify({ name: PACKAGE_NAME, version: '1.1.0' }, null, 2) + '\n')
    const state = await current.updater.run({ mode: 'install', manual: true })
    assert.deepEqual(current.requests.filter((url) => !url.endsWith('/latest')), [], '磁盘已是这个版本就不该再下载')
    assert.equal(state.pendingVersion, '1.1.0')
    // 远端比运行版本低：一律不装
    const lower = makeUpdater(fx, { payload: makePayload('0.9.0'), latestVersion: '0.9.0' })
    const held = await lower.updater.run({ mode: 'install', manual: true })
    assert.deepEqual(lower.requests.filter((url) => !url.endsWith('/latest')), [], '只升不降')
    assert.equal(held.latest, '0.9.0')
  } finally { fx.cleanup() }
})

console.log('\n自更新引擎单测：' + passed + ' PASS / ' + failed + ' FAIL')
if (failed > 0) {
  console.log(failures.join('\n'))
  process.exit(1)
}
process.exit(0)
