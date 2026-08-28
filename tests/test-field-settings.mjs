// v1.9.0 PR2 宿主设置验收：settings.json 读写往返 / 损坏回退 / 白名单拒绝 / density 落盘 /
// 双重置 / configVersion / 同源防护。
// 账本类铁律：涉及 DATA_DIR 的测试必须在 import 被测模块前先设 env 指向临时目录
//（参照 tests/test-usage-compaction.mjs 护栏），绝不触碰 ~/.dsh 真实用户数据。
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
let passes = 0
function check(name, condition, detail) {
  if (condition) { passes += 1; console.log('PASS  ' + name) }
  else { failures += 1; console.log('FAIL  ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}

// ---------- 分节加载：env 先于 import（query URL 强制独立模块实例） ----------
async function loadPluginFor(dataDir) {
  if (dataDir.indexOf(join(tmpdir(), 'bib-settings-')) !== 0) {
    throw new Error('安全护栏：数据目录必须是测试临时目录，拒绝运行（' + dataDir + '）')
  }
  process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
  process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(dataDir, 'no-codex.json')
  process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(dataDir, 'no-opencode.json')
  // 唯一 query → Node 视为独立模块 → 模块顶层的 DATA_DIR/SETTINGS_FILE 按当前 env 重新固化
  const mod = await import('../plugin/src/host.js?settings=' + encodeURIComponent(dataDir))
  return { plugin: mod.default, internals: mod.__settingsInternals }
}

// fetch 桩：无真实网络（余额/版本检查/远程价目全部本地假响应）
globalThis.fetch = async (url) => {
  const parsed = new URL(String(url))
  if (parsed.hostname === 'api.deepseek.com') {
    return { ok: true, status: 200, json: async () => ({ balance_infos: [{ currency: 'CNY', total_balance: '88.5', granted_balance: '0', topped_up_balance: '88.5' }] }) }
  }
  if (parsed.hostname === 'registry.npmjs.org') return { ok: true, status: 200, json: async () => ({ version: '1.8.0' }) }
  return { ok: false, status: 404, json: async () => ({}) }
}

// ---------- 桩环境（与 test-usage-compaction.mjs 同构） ----------
function makeStub() {
  const captured = { route: null }
  const ctx = {
    get(name) { return name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) } : undefined },
    credentials: { resolve: async (name) => (name === 'DEEPSEEK_API_KEY' ? { value: 'sk-test' } : null) },
    interval() { return () => {} },
    timeout() { return () => {} },
    on(event, listener) { void event; void listener; return () => {} },
    inject(services, callback) {
      callback({ effect(fn) { const dispose = fn(); return () => dispose && dispose() }, webServer: { register(route) { captured.route = route; return () => {} } } })
      return () => {}
    },
  }
  return { captured, ctx }
}

async function invokeRoute(route, method, body, headers) {
  const listeners = {}
  const req = {
    url: '/_dsh/dsh-bottom-info-bar/' + method,
    method: 'POST',
    headers: headers || { 'sec-fetch-site': 'same-origin' },
    on(n, cb) { (listeners[n] ||= []).push(cb); return req },
    destroy() {},
  }
  let status = null
  let payload = null
  const pending = route.handler(req, { writeHead(s) { status = s }, end(text) { payload = JSON.parse(text) } })
  const raw = JSON.stringify(body || {})
  for (const cb of listeners.data || []) cb(Buffer.from(raw))
  for (const cb of listeners.end || []) cb()
  await pending
  return { status, body: payload }
}

function readSettingsFile(dataDir) {
  return JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))
}

function newSection(name) {
  const dir = mkdtempSync(join(tmpdir(), 'bib-settings-' + name + '-'))
  return { dir, mod: null, stub: null }
}

async function mount(section) {
  section.mod = await loadPluginFor(section.dir)
  section.stub = makeStub()
  section.mod.plugin.apply(section.stub.ctx)
  return section
}

// ---------- ① 读写往返 + 落盘持久（重启不丢） ----------
{
  const s = await mount(newSection('roundtrip'))
  const route = s.stub.captured.route
  const first = await invokeRoute(route, 'getFieldConfig')
  check('getFieldConfig 默认全部显示', Object.values(first.body.fields).every(Boolean) && Object.keys(first.body.fields).length >= 20, Object.keys(first.body.fields).length)
  check('getFieldConfig 默认颜色全部为 null', Object.values(first.body.colors).every((v) => v === null), true)
  check('getFieldConfig 初始 configVersion=0', first.body.configVersion === 0, first.body.configVersion)
  check('getFieldConfig 带 version/persisted', first.body.version === 1 && first.body.persisted === true, first.body)

  const patched = await invokeRoute(route, 'setFieldConfig', { fields: { balance: false }, colors: { balance: '#00ff00', period: 'red' } })
  check('setFieldConfig 应用增量 patch', patched.body.fields.balance === false && patched.body.colors.balance === '#00FF00' && patched.body.colors.period === 'red', patched.body)
  check('setFieldConfig 后 configVersion=1', patched.body.configVersion === 1, patched.body.configVersion)
  const onDisk = readSettingsFile(s.dir)
  check('settings.json 已原子落盘（含 patch 值）', onDisk.fields.balance === false && onDisk.colors.balance === '#00FF00' && onDisk.infoDensity === 'full', onDisk)
  check('落盘无临时残留', !settingsTmpResidue(s.dir), true)

  // 模拟宿主重启：另一目录放入同一份落盘文件，全新模块实例应原样恢复
  const s2 = newSection('roundtrip-restart')
  copySettings(s.dir, s2.dir)
  await mount(s2)
  const rebooted = await invokeRoute(s2.stub.captured.route, 'getFieldConfig')
  check('重启后字段/颜色从磁盘恢复', rebooted.body.fields.balance === false && rebooted.body.colors.balance === '#00FF00' && rebooted.body.colors.period === 'red', rebooted.body)
}

function settingsTmpResidue(dir) {
  try {
    return readdirSync(dir).some((name) => name.indexOf('settings.json.tmp.') === 0)
  } catch { return true }
}
function copySettings(fromDir, toDir) {
  writeFileSync(join(toDir, 'settings.json'), readFileSync(join(fromDir, 'settings.json'), 'utf8'))
}

// ---------- ② 损坏回退（显式 warn + 默认值） ----------
{
  const s = newSection('corrupt')
  writeFileSync(join(s.dir, 'settings.json'), '{ this is not json !!')
  const warns = []
  const originalWarn = console.warn
  console.warn = function (...args) { warns.push(args.join(' ')) }
  try {
    await mount(s)
  } finally {
    console.warn = originalWarn
  }
  const body = (await invokeRoute(s.stub.captured.route, 'getFieldConfig')).body
  check('损坏文件回退默认：字段全部显示', Object.values(body.fields).every(Boolean), true)
  check('损坏文件回退默认：颜色全部为 null', Object.values(body.colors).every((v) => v === null), true)
  check('损坏文件触发显式 warn', warns.some((w) => w.indexOf('settings.json') !== -1), warns)
}

// ---------- ③ 白名单校验（字段 id / 颜色值 / 锚点恒开 / 全有或全无） ----------
{
  const s = await mount(newSection('whitelist'))
  const route = s.stub.captured.route
  const unknown = await invokeRoute(route, 'setFieldConfig', { fields: { notAField: false } })
  check('未知字段 id 拒绝（400）', unknown.status === 400 && /未知字段/.test(unknown.body.error), unknown)
  const badBool = await invokeRoute(route, 'setFieldConfig', { fields: { balance: 'no' } })
  check('非布尔开关拒绝（400）', badBool.status === 400 && /布尔值/.test(badBool.body.error), badBool)
  const anchor = await invokeRoute(route, 'setFieldConfig', { fields: { anchorGroup: false } })
  check('身份锚点拒绝关闭（400）', anchor.status === 400 && /锚点/.test(anchor.body.error), anchor)
  for (const bad of ['red!', '#12345', '#1234567', '123456', 'javascript:alert(1)', 5, {}]) {
    const r = await invokeRoute(route, 'setFieldConfig', { colors: { balance: bad } })
    check('非法颜色拒绝（400）: ' + JSON.stringify(bad), r.status === 400, r)
  }
  const noPatch = await invokeRoute(route, 'setFieldConfig', {})
  check('缺 fields/colors 的 patch 拒绝（400）', noPatch.status === 400, noPatch)
  const partial = await invokeRoute(route, 'setFieldConfig', { fields: { balance: false }, colors: { balance: 'oops' } })
  check('整包校验：一处非法则整个 patch 不落', partial.status === 400 && (await invokeRoute(route, 'getFieldConfig')).body.fields.balance === true, partial)
  const preset = await invokeRoute(route, 'setFieldConfig', { colors: { balance: 'purple', period: null } })
  check('预设色名接受、null 恢复默认接受', preset.status === 200 && preset.body.colors.balance === 'purple' && preset.body.colors.period === null, preset)
}

// ---------- ④ density 落盘（修复重启即丢） ----------
{
  const s = await mount(newSection('density'))
  const route = s.stub.captured.route
  const set = await invokeRoute(route, 'setInfoDensity', { density: 'compact' })
  check('setInfoDensity 即时生效', set.body.infoDensity === 'compact', set.body)
  check('setInfoDensity 落盘', readSettingsFile(s.dir).infoDensity === 'compact', true)
  const s2 = newSection('density-restart')
  copySettings(s.dir, s2.dir)
  await mount(s2)
  const cfg = (await invokeRoute(s2.stub.captured.route, 'getConfig')).body
  check('重启后 density 保持 compact（修复重启即丢）', cfg.infoDensity === 'compact', cfg)
  const bad = await invokeRoute(route, 'setInfoDensity', { density: 'FULL' })
  check('density 非法值仍拒绝', bad.body.infoDensity === 'compact', bad.body)
}

// ---------- ⑤ 双重置（彼此独立） + configVersion ----------
{
  const s = await mount(newSection('reset'))
  const route = s.stub.captured.route
  await invokeRoute(route, 'setFieldConfig', { fields: { balance: false, period: false }, colors: { balance: 'blue' } })
  const versionAfterPatch = (await invokeRoute(route, 'getFieldConfig')).body.configVersion
  const resetFields = await invokeRoute(route, 'resetFieldConfig')
  check('重置标签：字段回默认且颜色保留', resetFields.body.fields.balance === true && resetFields.body.colors.balance === 'blue', resetFields.body)
  check('重置标签：configVersion 递增', resetFields.body.configVersion === versionAfterPatch + 1, resetFields.body.configVersion)
  const noop = await invokeRoute(route, 'setFieldConfig', { fields: { balance: true } })
  check('无效 patch（值未变化）不递增 configVersion', noop.body.configVersion === resetFields.body.configVersion, noop.body.configVersion)
  const resetColors = await invokeRoute(route, 'resetFieldColors')
  check('重置颜色：颜色回 null 且标签保持', resetColors.body.colors.balance === null && resetColors.body.fields.balance === true, resetColors.body)
  check('重置颜色：configVersion 再递增', resetColors.body.configVersion === noop.body.configVersion + 1, resetColors.body.configVersion)
  check('重置后落盘', readSettingsFile(s.dir).colors.balance === null, true)
}

// ---------- ⑥ 同源防护（MUTATING 扩容） ----------
{
  const s = await mount(newSection('mutating'))
  const route = s.stub.captured.route
  const crossSite = { 'sec-fetch-site': 'cross-site' }
  for (const method of ['setFieldConfig', 'resetFieldConfig', 'resetFieldColors', 'setInfoDensity']) {
    const r = await invokeRoute(route, method, { density: 'full', fields: { balance: false } }, crossSite)
    check('跨站拒绝（403）: ' + method, r.status === 403, r)
  }
  const readAcross = await invokeRoute(route, 'getFieldConfig', null, crossSite)
  check('只读方法不做同源限制', readAcross.status === 200, readAcross)
}

// ---------- ⑦ __settingsInternals 单元（颜色归一化） ----------
{
  const s = newSection('internals')
  s.mod = await loadPluginFor(s.dir)
  const n = s.mod.internals.normalizeColorValue
  check('normalize：预设名原样', n('red') === 'red', n('red'))
  check('normalize：hex 转大写', n('#ab12cd') === '#AB12CD', n('#ab12cd'))
  check('normalize：null 合法（恢复默认）', n(null) === null, n(null))
  check('normalize：非法返回 undefined', n('#12345') === undefined && n('nope') === undefined && n(7) === undefined, true)
  check('sanitize：默认结构含全部注册字段且颜色为 null', (() => {
    const d = s.mod.internals.defaultFieldSettings()
    return d.version === 1 && d.infoDensity === 'full' && Object.values(d.fields).every(Boolean) && Object.values(d.colors).every((v) => v === null)
  })(), true)
}

// ---------- ⑧ D4：summaries 与 .bak 同时缺失且折叠已发生 → 显式 warn + 客户端可见「账单待整理」 ----------
{
  // 对照组：正常启动（从未折叠、无冷归档）→ 无告警、persistence=ok
  const s = await mount(newSection('d4-baseline'))
  const baseline = (await invokeRoute(s.stub.captured.route, 'getUsageSummary')).body
  check('D4 对照：未折叠时 persistence=ok 且无告警', baseline.persistence.state === 'ok', baseline.persistence)

  // 制造“折叠已发生”的痕迹：冷归档目录留有明细（appendFoldArchive 只在折叠时创建）
  mkdirSync(join(s.dir, 'usage-archive'), { recursive: true })
  writeFileSync(join(s.dir, 'usage-archive', '2026-07.jsonl'), '{"id":"archived","ts":0}\n')

  // 重启（同目录、全新模块实例）：summaries 与 .bak 均缺失
  const warns = []
  const originalWarn = console.warn
  console.warn = function (...args) { warns.push(args.join(' ')) }
  let restartRoute = null
  try {
    const mod2 = await import('../plugin/src/host.js?settings=' + encodeURIComponent(s.dir) + '&round=2')
    const stub2 = makeStub()
    mod2.default.apply(stub2.ctx)
    restartRoute = stub2.captured.route
  } finally {
    console.warn = originalWarn
  }
  const restarted = (await invokeRoute(restartRoute, 'getUsageSummary')).body
  check('D4：缺失+已折叠触发显式控制台 warn（非静默）', warns.some((w) => w.indexOf('账单汇总文件缺失') !== -1), warns)
  check('D4：客户端可见告警（persistence=snapshot-stale「账单待整理」+ 指向冷归档文案）',
    restarted.persistence.state === 'snapshot-stale' && /usage-archive/.test(restarted.persistence.message || ''), restarted.persistence)
}

// ---------- ⑨ L1：启动自愈权限收敛（DATA_DIR 0700 / journal 0600，尽力而为不崩溃） ----------
{
  const s = newSection('perms')
  mkdirSync(s.dir, { recursive: true })
  chmodSync(s.dir, 0o755)
  const journalPath = join(s.dir, 'usage-records.journal.jsonl')
  writeFileSync(journalPath, '')
  chmodSync(journalPath, 0o644)
  await mount(s)
  check('L1：DATA_DIR 权限收敛为 0700', (statSync(s.dir).mode & 0o777) === 0o700, (statSync(s.dir).mode & 0o777).toString(8))
  check('L1：journal 权限收敛为 0600', (statSync(journalPath).mode & 0o777) === 0o600, (statSync(journalPath).mode & 0o777).toString(8))
  const set = await invokeRoute(s.stub.captured.route, 'setInfoDensity', { density: 'compact' })
  check('L1：权限收敛后设置仍可正常落盘（未影响可写性）', set.body.infoDensity === 'compact' && readSettingsFile(s.dir).infoDensity === 'compact', set.body)
}

console.log('\n结果：' + passes + ' PASS / ' + failures + ' FAIL')
process.exit(failures > 0 ? 1 : 0)
