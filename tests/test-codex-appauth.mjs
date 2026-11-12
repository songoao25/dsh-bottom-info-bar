// Bottom Info Bar — Issue #274 回归：DSH Go / 安卓 App 里 ChatGPT 订阅额度刷新失败
// ---------------------------------------------------------------------------
// 背景：DSH Go 的 ChatGPT 登录由宿主侧 appAuth 服务完成（App 的 app/assets/engine/auth/
// index.mjs 把 bridge.mjs 注册成名为 appAuth 的 Remote 服务），OAuth grant 存在
// $DSH_HOME/.credentials.yaml（record key llm-pi-ai/openai-codex），不写 ~/.codex/auth.json。
// 旧版 fetchCodexUsage 只读 ~/.codex/auth.json → 安卓 proot 下没有该文件 → no-key →
// 客户端只显示红色「刷新失败」，原因藏在 title 里，手机上（无 hover）根本看不到。
//
// 修复：有 appAuth 的宿主优先调用 appAuth.usage('openai-codex')，把 windows 映射成插件的
// 订阅窗口；appAuth 报未登录/不可用时给出明确 code + 指引文案；服务缺席（桌面老宿主）时
// 逐字节保持原来的 ~/.codex/auth.json 行为。
//
// 覆盖：
//   A) 纯映射：windowSeconds 判窗口、百分比方向（usedPercent = 已用）、resetAt ISO → 毫秒、
//      plan_type → 套餐名、未知/畸形窗口跳过、状态透传
//   B) 真实 apply + 桩 ctx（敌意 Proxy：裸读未声明服务即抛）：
//      appAuth ok / 未登录 / 抛异常 / 过期 / 拒绝 / 不支持 / 空窗口 / 桌面无服务回归 /
//      桌面文件数据优先 / ctx.get 兜底 / 20 秒成功缓存
//   C) 文案：13 种语言都补了 error.subscription.app-auth-*（英文不是占位）
//   D) 客户端：subscriptionFailureHint 直出 appAuth 错误原文（手机上 title 可读）
//
// 用法：node tests/test-codex-appauth.mjs
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)

// ---------- 隔离环境（必须在 import 被测模块之前设置：路径在模块顶层定型） ----------
const dataDir = mkdtempSync(join(tmpdir(), 'bib-codex-appauth-'))
const codexAuthPath = join(dataDir, 'codex-auth.json')
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
process.env.DSH_BOTTOM_INFO_BAR_PROFILE_ROOT = join(dataDir, 'profiles')
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = codexAuthPath
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(dataDir, 'absent-opencode.json')
process.env.DSH_BOTTOM_INFO_BAR_COMMAND_CODE_AUTH = join(dataDir, 'absent-commandcode.json')
process.env.DSH_BOTTOM_INFO_BAR_SELF_UPDATE = 'off'

// 全程零真实网络：任何未预期的请求都直接失败，暴露出来而不是悄悄放过
globalThis.fetch = async function () { throw new Error('network disabled in tests') }

// ---------- 被测代码 = 构建产物（DSH 真正加载的 lib/index.js；src 里常量是注入锚点） ----------
const LIB_HOST = join(ROOT, 'lib', 'index.js')
const SRC_FILES = ['host.js', 'constants.js', 'client-bundle.js', 'locales.js', 'host-locale.js', 'self-update.js', 'startup-trace.js', 'version.js', 'ledger-store.js', 'accounting.js', 'ledger-client.js', 'ledger-worker.js']
  .map((f) => join(ROOT, 'src', f))
function libIsStale() {
  if (!existsSync(LIB_HOST)) return true
  const newestSrc = Math.max(...SRC_FILES.filter((f) => existsSync(f)).map((f) => statSync(f).mtimeMs))
  return statSync(LIB_HOST).mtimeMs < newestSrc
}
if (libIsStale()) {
  const built = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: ROOT, encoding: 'utf8' })
  if (built.status !== 0) {
    console.error('lib/ 产物陈旧且重建失败：' + (built.stderr || built.stdout))
    process.exit(1)
  }
  console.log('lib/ 产物陈旧 → 已重建（node scripts/build.mjs）')
}

const hostSource = readFileSync(join(ROOT, 'src', 'host.js'), 'utf8')
const clientSource = readFileSync(join(ROOT, 'src', 'client-bundle.js'), 'utf8')
const plugin = (await import(pathToFileURL(LIB_HOST).href)).default
const { LOCALES } = await import(pathToFileURL(join(ROOT, 'src', 'locales.js')).href)

// ---------- 断言框架（一条断言失败不中断后续断言） ----------
let pass = 0
const failures = []
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log('PASS  ' + name) } else {
    failures.push(name)
    const shown = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : safeJson(detail))
    console.log('FAIL  ' + name + shown)
  }
}
function safeJson(value) {
  try { const s = JSON.stringify(value); return s && s.length > 300 ? s.slice(0, 300) + '…' : String(s) } catch { return String(value) }
}
function eq(name, actual, expected) {
  let ok = true
  try { assert.deepStrictEqual(actual, expected) } catch { ok = false }
  check(name + '（期望 ' + safeJson(expected) + '）', ok, { actual })
}
function eqNum(name, actual, expected) { check(name + '（期望 ' + expected + '）', actual === expected, { actual }) }

// ===========================================================================
// A) 纯映射（从正式源码抽出被测函数，测真身而不是复制品）
// ===========================================================================
console.log('\n===== A) parseAppAuthCodexUsage / appAuthWindowKey =====')
function extractFn(name) {
  const start = hostSource.indexOf('function ' + name)
  if (start < 0) throw new Error('未找到 function ' + name)
  let depth = 0, i = start, inStr = null
  while (i < hostSource.length) {
    const c = hostSource[i]
    if (inStr) {
      if (c === '\\') { i += 2; continue }
      if (c === inStr) inStr = null
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c
    } else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
    i++
  }
  return hostSource.slice(start, i + 1)
}
function extractConst(name) {
  const marker = 'const ' + name + ' = '
  const start = hostSource.indexOf(marker)
  if (start < 0) throw new Error('未找到 const ' + name)
  const from = start + marker.length
  const end = hostSource.indexOf('}', from)
  if (end < 0) throw new Error('const ' + name + ' 结构不完整')
  return hostSource.slice(from, end + 1)
}
const pure = eval(
  '(function () {'
  + 'const WINDOW_LABELS = ' + extractConst('WINDOW_LABELS') + ';'
  + 'const CODEX_PLAN_NAMES = ' + extractConst('CODEX_PLAN_NAMES') + ';'
  + extractFn('parsePercent')
  + extractFn('normalizeResetAt')
  + extractFn('planDisplayName')
  + extractFn('appAuthWindowKey')
  + extractFn('parseAppAuthCodexUsage')
  + 'return { parseAppAuthCodexUsage: parseAppAuthCodexUsage, appAuthWindowKey: appAuthWindowKey };'
  + '})()'
)
const parseAppAuthCodexUsage = pure.parseAppAuthCodexUsage
if (typeof parseAppAuthCodexUsage !== 'function') throw new Error('parseAppAuthCodexUsage 抽取失败')
const WL = { five_hour: '5 小时', seven_day: '周', monthly: '月' }
const ISO_5H = '2026-11-12T20:00:00.000Z'
const ISO_WEEK = '2026-11-19T00:00:00.000Z'

// ① ok：primary/secondary → 5 小时 + 周；百分比方向 = 已用（不做翻转）
const okParsed = parseAppAuthCodexUsage({
  provider: 'openai-codex',
  status: 'ok',
  plan: 'plus',
  windows: [
    { id: 'primary', usedPercent: 22, resetAt: ISO_5H, windowSeconds: 18000 },
    { id: 'secondary', usedPercent: 64, resetAt: ISO_WEEK, windowSeconds: 604800 },
  ],
}, WL)
eq('① status = ok', okParsed.status, 'ok')
eq('① 套餐名 plus → ChatGPT Plus', okParsed.plan, 'ChatGPT Plus')
eq('① planType 原样保留', okParsed.planType, 'plus')
eq('① 窗口键顺序 = 5 小时 + 周', okParsed.windows.map(function (w) { return w.key }), ['five_hour', 'seven_day'])
eq('① 使用传入的窗口标签', okParsed.windows.map(function (w) { return w.label }), ['5 小时', '周'])
eq('① usedPercent 是「已用」方向（22 不是 78）', okParsed.windows.map(function (w) { return w.usedPercent }), [22, 64])
eq('① resetAt ISO → 毫秒', okParsed.windows.map(function (w) { return w.resetsAt }), [Date.parse(ISO_5H), Date.parse(ISO_WEEK)])

// ② 百分比边界：0 / 100 / 超范围钳制 / 负数与非法值跳过
const percentParsed = parseAppAuthCodexUsage({
  status: 'ok',
  windows: [
    { id: 'primary', usedPercent: 0 },
    { id: 'secondary', usedPercent: 150 },
    { id: 'monthly', usedPercent: -3 },
  ],
}, WL)
eq('② 0% 已用保留（剩下 100%）', percentParsed.windows[0] && percentParsed.windows[0].usedPercent, 0)
eq('② 150 钳制到 100', percentParsed.windows[1] && percentParsed.windows[1].usedPercent, 100)
eqNum('② 负数窗口被跳过', percentParsed.windows.length, 2)

// ③ windowSeconds 优先于 id：接口换窗口语义时按真实时长归位
eq('③ secondary + 5 小时时长 → five_hour', pure.appAuthWindowKey('secondary', 18000), 'five_hour')
eq('③ primary + 周时长 → seven_day', pure.appAuthWindowKey('primary', 604800), 'seven_day')
eq('③ primary + 30 天时长 → monthly', pure.appAuthWindowKey('primary', 2592000), 'monthly')
eq('③ 无时长时 primary 按历史语义 → five_hour', pure.appAuthWindowKey('primary', undefined), 'five_hour')
eq('③ 无时长时 secondary 按历史语义 → seven_day', pure.appAuthWindowKey('secondary', undefined), 'seven_day')
eq('③ 未知 id 且无时长 → 跳过', pure.appAuthWindowKey('tertiary', undefined), null)

// ④ resetAt 形态容错：null / 秒级数字 / 毫秒数字
const resetParsed = parseAppAuthCodexUsage({
  status: 'ok',
  windows: [
    { id: 'primary', usedPercent: 10, resetAt: null },
    { id: 'secondary', usedPercent: 20, resetAt: 1789284984 },
    { id: 'monthly', usedPercent: 30, resetAt: 1789284984350 },
  ],
}, WL)
eq('④ resetAt null → null', resetParsed.windows[0].resetsAt, null)
eq('④ 秒级时间戳 → 毫秒', resetParsed.windows[1].resetsAt, 1789284984000)
eq('④ 毫秒时间戳直通', resetParsed.windows[2].resetsAt, 1789284984350)

// ⑤ 同键去重 + 未知窗口跳过
const dedupeParsed = parseAppAuthCodexUsage({
  status: 'ok',
  windows: [
    { id: 'primary', usedPercent: 10 },
    { id: 'primary', usedPercent: 90 },
    { id: 'tertiary', usedPercent: 50 },
  ],
}, WL)
eqNum('⑤ 同键只取首个窗口', dedupeParsed.windows.length, 1)
eq('⑤ 同键取首个的数值', dedupeParsed.windows[0].usedPercent, 10)

// ⑥ 状态透传：not_signed_in / unsupported / unavailable + reason；畸形输入不抛错
eq('⑥ not_signed_in 透传', parseAppAuthCodexUsage({ status: 'not_signed_in', windows: [] }, WL).status, 'not_signed_in')
eq('⑥ unsupported 透传', parseAppAuthCodexUsage({ status: 'unsupported', windows: [] }, WL).status, 'unsupported')
const expiredParsed = parseAppAuthCodexUsage({ status: 'unavailable', reason: 'expired', windows: [] }, WL)
eq('⑥ unavailable 状态', expiredParsed.status, 'unavailable')
eq('⑥ unavailable reason 保留', expiredParsed.reason, 'expired')
eq('⑥ null 输入 → unavailable', parseAppAuthCodexUsage(null, WL).status, 'unavailable')
eq('⑥ null 输入 reason = invalid_response', parseAppAuthCodexUsage(null, WL).reason, 'invalid_response')
eq('⑥ 字符串输入 → 空窗口', parseAppAuthCodexUsage('nope', WL).windows.length, 0)
const unknownOnly = parseAppAuthCodexUsage({ status: 'ok', windows: [{ id: 'tertiary', usedPercent: 5 }] }, WL)
eq('⑥ ok 但全部窗口不认识 → 空窗口（调用方按 unavailable 处理）', unknownOnly.windows.length, 0)

// ===========================================================================
// B) 真实 plugin.apply() + 桩 ctx（敌意 Proxy）
// ===========================================================================
console.log('\n===== B) 真实 apply + RPC（appAuth / 桌面双通道） =====')
function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }

function appAuthStub(result) {
  const calls = []
  return {
    calls: calls,
    usage: async function (provider) {
      calls.push(provider)
      if (result instanceof Error) throw result
      return typeof result === 'function' ? result(provider, calls.length) : result
    },
  }
}

// cordis 4 语义的敌意 ctx：任何未声明/未 provide 的属性一读就抛（复刻 Proxy 脾气）
function makeCtx(options) {
  const opts = options || {}
  const services = {}
  if (opts.appAuth) services.appAuth = opts.appAuth
  const captured = { route: null, intervals: 0 }
  const target = {
    get(name) { return services[name] },
    credentials: {
      resolve: async function () { return undefined },
      readRecord: async function () { return undefined },
    },
    interval() { captured.intervals += 1; return function () {} },
    timeout() { return function () {} },
    on() { return function () {} },
    effect(fn) { const dispose = typeof fn === 'function' ? fn() : undefined; return function () { if (typeof dispose === 'function') dispose() } },
    inject(names, cb) {
      const deps = Array.isArray(names) ? names : []
      if (deps.indexOf('appAuth') >= 0 && opts.disableInjectFor === 'appAuth') return function () {}
      if (deps.indexOf('connection') >= 0 || deps.indexOf('webServer') >= 0) {
        const webCtx = {
          effect(fn) { const d = fn(); return function () { if (typeof d === 'function') d() } },
          connection: { requestRejection() { return undefined } },
          webServer: { register(route) { captured.route = route; return function () {} } },
        }
        const ret = cb(webCtx)
        return typeof ret === 'function' ? ret : function () {}
      }
      const child = {}
      for (const name of deps) {
        if (services[name] === undefined) return function () {}
        child[name] = services[name]
      }
      const ret = cb(child)
      return typeof ret === 'function' ? ret : function () {}
    },
  }
  const ctx = new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === 'symbol' || prop === 'then') return Reflect.get(t, prop, receiver)
      if (Reflect.has(t, prop)) return Reflect.get(t, prop, receiver)
      throw new Error('cannot get property "' + String(prop) + '" without inject')
    },
  })
  return { captured: captured, ctx: ctx }
}

async function invoke(route, path, method, body) {
  const listeners = {}
  const req = {
    url: path,
    method: method,
    headers: { 'sec-fetch-site': 'same-origin' },
    on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return req },
    destroy() {},
  }
  let status = 0
  let payload = null
  const res = {
    headersSent: false,
    writeHead(code) { status = code; res.headersSent = true },
    end(text) { try { payload = JSON.parse(text) } catch (err) { payload = String(text) } },
  }
  const pending = route.handler(req, res)
  if (body !== undefined) for (const cb of listeners.data || []) cb(Buffer.from(body))
  for (const cb of listeners.end || []) cb()
  await pending
  return { status: status, payload: payload }
}
function callSnapshot(captured) {
  const body = JSON.stringify({ selection: { provider: 'openai-codex', model: 'gpt-5-codex' }, force: true })
  return invoke(captured.route, '/_dsh/dsh-bottom-info-bar/getSubscriptionSnapshot', 'POST', body)
}

async function withPlugin(options, fn) {
  const h = makeCtx(options)
  const dispose = plugin.apply(h.ctx)
  try {
    await delay(0)
    return await fn(h)
  } finally {
    try { if (typeof dispose === 'function') dispose() } catch (err) { /* 清理失败不影响断言 */ }
  }
}
async function snapshotOnce(options) {
  return withPlugin(options, async function (h) {
    const rpc = await callSnapshot(h.captured)
    check('webServer 路由已注册', h.captured.route && h.captured.route.kind === 'prefix', h.captured.route)
    eqNum('RPC 返回 HTTP 200', rpc.status, 200)
    return rpc.payload
  })
}

const APP_AUTH_CODES = [
  'not-signed-in', 'expired', 'denied', 'network', 'rate-limited', 'unavailable', 'unsupported',
].map(function (suffix) { return 'subscription.app-auth-' + suffix })
function localeHas(lang, code) {
  const dict = LOCALES[lang] || {}
  return typeof dict['error.' + code] === 'string' && dict['error.' + code].length > 0
}
function localeValuesOf(code) {
  return Object.keys(LOCALES).map(function (lang) { return localeHas(lang, code) ? LOCALES[lang]['error.' + code] : null }).filter(Boolean)
}

// ① appAuth ok：真实 RPC 快照拿到窗口与套餐，usedPercent 方向不翻转
{
  const stub = appAuthStub({
    provider: 'openai-codex', status: 'ok', plan: 'plus',
    windows: [
      { id: 'primary', usedPercent: 22, resetAt: ISO_5H, windowSeconds: 18000 },
      { id: 'secondary', usedPercent: 64, resetAt: ISO_WEEK, windowSeconds: 604800 },
    ],
  })
  const payload = await snapshotOnce({ appAuth: stub })
  eq('① 调用参数 = openai-codex', stub.calls, ['openai-codex'])
  eq('① source = codex', payload.source, 'codex')
  eq('① mode = subscription', payload.mode, 'subscription')
  eq('① 无错误', payload.error, null)
  eq('① 套餐 = ChatGPT Plus', payload.plan, 'ChatGPT Plus')
  eq('① 窗口键', payload.windows.map(function (w) { return w.key }), ['five_hour', 'seven_day'])
  eq('① 窗口百分比（已用方向）', payload.windows.map(function (w) { return w.usedPercent }), [22, 64])
  eq('① 重置时刻', payload.windows.map(function (w) { return w.resetsAt }), [Date.parse(ISO_5H), Date.parse(ISO_WEEK)])
  check('① fetchedAt 为毫秒时间戳', typeof payload.fetchedAt === 'number' && payload.fetchedAt > 0, payload.fetchedAt)
}

// ② appAuth 未登录且没有桌面文件 → 明确指引（#274 用户看到的应该就是这条）
{
  const payload = await snapshotOnce({ appAuth: appAuthStub({ provider: 'openai-codex', status: 'not_signed_in', windows: [] }) })
  eq('② 错误码 = app-auth-not-signed-in', payload.error && payload.error.code, 'subscription.app-auth-not-signed-in')
  eq('② 错误 kind = no-key', payload.error && payload.error.kind, 'no-key')
  const values = localeValuesOf('subscription.app-auth-not-signed-in')
  check('② 文案在 13 种语言里都有', values.length === 13, values.length)
  check('② 文案包含「DSH」授权指引（中/英任一）',
    values.includes(payload.error.message) && /DSH/.test(payload.error.message), payload.error.message)
  eqNum('② 无窗口', (payload.windows || []).length, 0)
}

// ③ 桌面老宿主（没有 appAuth、没有 ~/.codex/auth.json）→ 原 no-key 文案逐字不变
{
  const payload = await snapshotOnce({})
  eq('③ 错误码 = subscription.not-connected（旧行为）', payload.error && payload.error.code, 'subscription.not-connected')
  eq('③ 错误 kind = no-key（旧行为）', payload.error && payload.error.kind, 'no-key')
  const expected = [LOCALES.zh['error.subscription.not-connected'], LOCALES.en['error.subscription.not-connected']]
  check('③ 文案 = 原字典文案', expected.includes(payload.error.message), payload.error.message)
}

// ④ appAuth 调用抛异常 → 降级到文件通道（桌面行为），不崩
{
  const payload = await snapshotOnce({ appAuth: appAuthStub(new Error('bridge boom')) })
  eq('④ 抛异常降级 → subscription.not-connected', payload.error && payload.error.code, 'subscription.not-connected')
  eqNum('④ 降级后无窗口', (payload.windows || []).length, 0)
}

// ⑤ appAuth ok 但零窗口（上游 schema 漂移）→ 明确 unavailable，不伪装成普通刷新失败
{
  const payload = await snapshotOnce({ appAuth: appAuthStub({ status: 'ok', windows: [] }) })
  eq('⑤ 错误码 = app-auth-unavailable', payload.error && payload.error.code, 'subscription.app-auth-unavailable')
  eq('⑤ 错误 kind = unavailable', payload.error && payload.error.kind, 'unavailable')
}

// ⑥ 过期 / 拒绝 / 网络 / 节流 / 不支持 各自有稳定 code 与 kind
{
  const matrix = [
    [{ status: 'unavailable', reason: 'expired', windows: [] }, 'subscription.app-auth-expired', 'auth'],
    [{ status: 'unavailable', reason: 'permission_denied', windows: [] }, 'subscription.app-auth-denied', 'auth'],
    [{ status: 'unavailable', reason: 'network', windows: [] }, 'subscription.app-auth-network', 'timeout'],
    [{ status: 'unavailable', reason: 'rate_limited', windows: [] }, 'subscription.app-auth-rate-limited', 'http'],
    [{ status: 'unsupported', windows: [] }, 'subscription.app-auth-unsupported', 'unsupported'],
  ]
  for (const [result, code, kind] of matrix) {
    const payload = await snapshotOnce({ appAuth: appAuthStub(result) })
    eq('⑥ ' + code + ' 错误码', payload.error && payload.error.code, code)
    eq('⑥ ' + code + ' kind', payload.error && payload.error.kind, kind)
    check('⑥ ' + code + ' 文案非空且在字典里', localeValuesOf(code).includes(payload.error.message), payload.error.message)
  }
}

// ⑦ ctx.get 兜底：inject 回调不触发（服务晚就绪的宿主）时仍能拿到 appAuth
{
  const stub = appAuthStub({ status: 'ok', windows: [{ id: 'primary', usedPercent: 11 }] })
  const payload = await snapshotOnce({ appAuth: stub, disableInjectFor: 'appAuth' })
  eq('⑦ ctx.get 兜底也能取到 appAuth', stub.calls, ['openai-codex'])
  eqNum('⑦ 兜底路径窗口数', (payload.windows || []).length, 1)
}

// ⑧ 20 秒成功缓存：连续两次强制刷新只问宿主一次（bridge 有 10 秒节流）
{
  await withPlugin({ appAuth: appAuthStub({ status: 'ok', windows: [{ id: 'primary', usedPercent: 5 }] }) }, async function (h) {
    const first = await callSnapshot(h.captured)
    const second = await callSnapshot(h.captured)
    eqNum('⑧ 首次刷新成功', (first.payload.windows || []).length, 1)
    eqNum('⑧ 第二次强制刷新仍成功（走缓存）', (second.payload.windows || []).length, 1)
  })
}

// ⑨ 桌面文件通道：appAuth 未登录但 ~/.codex/auth.json 有令牌 → 用文件数据（桌面不回归）
{
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'pro', chatgpt_subscription_active_until: '2027-01-01T00:00:00Z' } })).toString('base64url')
  const idToken = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + payload + '.sig'
  writeFileSync(codexAuthPath, JSON.stringify({ tokens: { id_token: idToken } }))
  try {
    const noService = await snapshotOnce({})
    eq('⑨ 无 appAuth + 桌面令牌 → 套餐 ChatGPT Pro', noService.plan, 'ChatGPT Pro')
    eq('⑨ 无 appAuth + 桌面令牌 → 无错误', noService.error, null)
    eqNum('⑨ 文件通道不提供额度窗口', (noService.windows || []).length, 0)
    const notSignedIn = await snapshotOnce({ appAuth: appAuthStub({ status: 'not_signed_in', windows: [] }) })
    eq('⑨ appAuth 未登录但文件有数据 → 用文件数据', notSignedIn.plan, 'ChatGPT Pro')
    eq('⑨ appAuth 未登录但文件有数据 → 无错误', notSignedIn.error, null)
  } finally {
    rmSync(codexAuthPath, { force: true })
  }
}

// ===========================================================================
// C) 13 种语文案齐全（英文不是占位）
// ===========================================================================
console.log('\n===== C) 文案 =====')
for (const code of APP_AUTH_CODES) {
  const missing = Object.keys(LOCALES).filter(function (lang) { return !localeHas(lang, code) })
  eq('C) ' + code + ' 13 种语言齐全', missing, [])
  check('C) ' + code + ' 英文不是占位', LOCALES.en['error.' + code] !== LOCALES.zh['error.' + code] && !/TODO|FIXME/.test(LOCALES.en['error.' + code]))
}

// ===========================================================================
// D) 客户端：appAuth 错误文案直出（手机上 title 可读，不再被通用文案覆盖）
// ===========================================================================
console.log('\n===== D) 客户端可读性 =====')
{
  const start = clientSource.indexOf('function subscriptionFailureHint')
  check('D) 找到 subscriptionFailureHint', start >= 0)
  const body = start >= 0 ? clientSource.slice(start, clientSource.indexOf('function pushSubscriptionGroups', start)) : ''
  check('D) 识别 appAuth 错误码前缀', body.includes("'subscription.app-auth-'"))
  check('D) 直接返回宿主错误原文', /return message;/.test(body))
  check('D) 其余分支仍走通用文案（未破坏旧行为）', body.includes("t('ui.noSignInCredentialsFound'"))
}

// ---------- 汇总 ----------
rmSync(dataDir, { recursive: true, force: true })
console.log('\n' + pass + ' passed, ' + failures.length + ' failed')
if (failures.length > 0) {
  console.log('失败项：\n- ' + failures.join('\n- '))
  process.exit(1)
}
console.log('Issue #274 appAuth 通道回归 OK')
