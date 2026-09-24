// Bottom Info Bar — MiniMax Token Plan / quotaDisplayMode 独立 E2E 验证装置
// ---------------------------------------------------------------------------
// 归属：独立验证者（verifier）。本文件**只做验证**，不参与实现；契约来自 task-3 / task-4
// 的冻结条款（Lead 定稿，含 2026-09-24 四条裁决）。
//
// 做法（对抗性优先）：
//   真实 plugin.apply() 真身 + 桩 ctx（credentials.resolve 返回受控值 / 注入 webServer 路由）
//   + monkey-patch globalThis.fetch（记录 URL/headers，返回受控响应；全程零真实网络）
//   → 通过真实 RPC（getSubscriptionSnapshot / getFieldConfig / setFieldConfig / resetFieldConfig /
//     getUsageSummary）与 __settingsInternals 驱动，断言只看对外可观察结果。
//
// 覆盖：
//   ① 双站点路由 + 请求头（Bearer / Accept / AbortSignal.timeout）
//   ② 凭据优先级与跨站回退、无凭据 no-key
//   ③ 真实响应 schema：多桶最紧聚合、usedPercent = 100 − remaining、字符串数字、取整钳制
//   ④ resetsAt 与聚合值同源（最紧桶的 end_time）+ 回退 + null
//   ⑤ 窗口按类型省略；两类都无 → parse 降级
//   ⑥ 错误矩阵：1004 / 2049 / 401 / 403 / 500 / 429 / 坏 JSON / 网络异常 / 空桶 / 畸形 body
//   ⑦ 失败保留旧快照（成功→失败→恢复）
//   ⑧ 非订阅 provider 零请求；minimax 与 minimax-cn 双源隔离；账户键合并
//   ⑨ 边界：0 / 100 / 负数 / >100 / null / 缺字段 / 非对象项
//   ⑩ quotaDisplayMode：宿主默认 remaining、设置/非法拒绝/复位/落盘、__settingsInternals
//   ⑪ 客户端源码：方向归一（真实切片求值）、告警与显示方向解耦、分段控件键盘可达、对比度 ≥ 4.5:1
//   ⑫ 密钥不泄漏：错误文案与 console.warn 均不含 Key 片段
//
// 反向验证（证明断言不空转）：把 src 复制到临时目录做故意破坏，用环境变量指向副本即可：
//   BIB_E2E_HOST_MODULE=/tmp/xxx/host.js  BIB_E2E_CLIENT_MODULE=/tmp/xxx/client-bundle.js
//   node tests/test-minimax-e2e.mjs   → 必须 FAIL（exit 1）
// 默认（不设变量）验证仓库当前源码。
//
// 用法：node tests/test-minimax-e2e.mjs
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)

// ---------- 隔离环境（必须在 import host 模块之前设置：DATA_DIR/SETTINGS_FILE 在模块顶层定型） ----------
const dataDir = mkdtempSync(join(tmpdir(), 'bib-minimax-e2e-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
process.env.DSH_BOTTOM_INFO_BAR_PROFILE_ROOT = join(dataDir, 'profiles') // 卸载判定不触碰真实用户 profile
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(dataDir, 'absent-codex-auth.json')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(dataDir, 'absent-opencode-auth.json')
process.env.DSH_BOTTOM_INFO_BAR_COMMAND_CODE_AUTH = join(dataDir, 'absent-commandcode-auth.json')

// 被测代码 = 构建产物（lib/index.js 是 package.json 的 main，也是 DSH 真正加载的那份）。
// 注意：src/host.js 第 251 行的 SUBSCRIPTION_PROVIDERS 是构建期注入锚点
// /*__SUBSCRIPTION_PROVIDERS__*/[]——直接 import src 会让订阅 provider 表为空，
// minimax 被误判成 balance，那是测试装置自己的假阴性，不是实现问题。
// 默认路径下若产物缺失/陈旧则先重建（与 run-all.mjs 同一约定）；BIB_E2E_*_MODULE 覆盖时绝不重建。
const LIB_HOST = join(ROOT, 'lib', 'index.js')
const LIB_CLIENT = join(ROOT, 'lib', 'client.js')
const SRC_FILES = ['host.js', 'constants.js', 'client-bundle.js', 'locales.js', 'host-locale.js']
  .map((f) => join(ROOT, 'src', f))
function libIsStale() {
  if (!existsSync(LIB_HOST) || !existsSync(LIB_CLIENT)) return true
  const newestSrc = Math.max(...SRC_FILES.filter((f) => existsSync(f)).map((f) => statSync(f).mtimeMs))
  return statSync(LIB_HOST).mtimeMs < newestSrc || statSync(LIB_CLIENT).mtimeMs < newestSrc
}
if (!process.env.BIB_E2E_HOST_MODULE && !process.env.BIB_E2E_CLIENT_MODULE && libIsStale()) {
  const built = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: ROOT, encoding: 'utf8' })
  if (built.status !== 0) {
    console.error('lib/ 产物陈旧且重建失败：' + (built.stderr || built.stdout))
    process.exit(1)
  }
  console.log('lib/ 产物陈旧 → 已重建（node scripts/build.mjs）')
}
const HOST_MODULE = process.env.BIB_E2E_HOST_MODULE
  ? resolve(process.env.BIB_E2E_HOST_MODULE)
  : LIB_HOST
const CLIENT_SOURCE_PATH = process.env.BIB_E2E_CLIENT_MODULE
  ? resolve(process.env.BIB_E2E_CLIENT_MODULE)
  : LIB_CLIENT

const LOCALES = (await import(pathToFileURL(join(ROOT, 'src', 'locales.js')).href)).LOCALES
const hostModule = await import(pathToFileURL(HOST_MODULE).href)
const plugin = hostModule.default
const internals = hostModule.__settingsInternals

// ---------- 断言框架 ----------
let pass = 0
const failures = []
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log('PASS  ' + name) }
  else {
    failures.push(name)
    const shown = detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : safeJson(detail))
    console.log('FAIL  ' + name + shown)
  }
}
function safeJson(value) {
  try {
    const s = JSON.stringify(value)
    return s && s.length > 400 ? s.slice(0, 400) + '…' : String(s)
  } catch { return String(value) }
}
function eq(name, actual, expected) {
  let ok = true
  try { assert.deepStrictEqual(actual, expected) } catch { ok = false }
  check(name + '（期望 ' + safeJson(expected) + '）', ok, { actual })
}
function eqNum(name, actual, expected) { check(name + '（期望 ' + expected + '）', actual === expected, { actual }) }

// ---------- 文案（语言无关：中/英任一命中即可） ----------
// 稳定 code 形如 'request.http' / 'subscription.minimax-auth-failed'，字典键是 'error.<code>'；
// 两者都接受，缺一不可（字典缺失时断言必须失败，不能空转成「通过」）。
function localeEntry(lang, key) {
  const dict = LOCALES[lang] || {}
  if (typeof dict[key] === 'string') return dict[key]
  if (typeof dict['error.' + key] === 'string') return dict['error.' + key]
  return null
}
function localeValues(key) {
  return Object.keys(LOCALES).map((lang) => localeEntry(lang, key)).filter((v) => typeof v === 'string')
}
function renderLocale(lang, key, params) {
  const raw = localeEntry(lang, key)
  if (raw == null) return null
  let s = raw
  for (const k of Object.keys(params || {})) s = s.split('{' + k + '}').join(String(params[k]))
  return s
}
function localeRendered(key, params) {
  return Object.keys(LOCALES).map((lang) => renderLocale(lang, key, params)).filter((v) => v != null)
}
function checkMessage(name, error, key, params) {
  const expected = params === undefined ? localeValues(key) : localeRendered(key, params)
  check(name + '（字典键 ' + key + ' / error.' + key + ' 存在）', expected.length > 0, { key })
  check(name + '（文案 = ' + key + '）',
    !!error && typeof error.message === 'string' && expected.includes(error.message),
    error && error.message)
}

// ---------- fetch 桩（全程零真实网络；按 hostname 路由） ----------
const realFetch = globalThis.fetch
const fetchLog = []
let minimaxHandler = null
const MINIMAX_HOSTS = new Set(['api.minimax.io', 'api.minimaxi.com'])

function respond(status, body, opts) {
  return Object.assign({ kind: 'response', status, body }, opts || {})
}
function okJson(body) { return respond(200, body) }
function throwErr(error) { return { kind: 'throw', error } }
function sequenceHandler(descs) {
  let i = 0
  return function () { const d = descs[Math.min(i, descs.length - 1)]; i += 1; return d }
}
function setMinimaxHandler(h) { minimaxHandler = h }

globalThis.fetch = async function fetchStub(url, options) {
  const entry = { url: String(url), options: options || {}, hostname: '' }
  try { entry.hostname = new URL(entry.url).hostname } catch { entry.hostname = '' }
  fetchLog.push(entry)
  let desc = null
  if (MINIMAX_HOSTS.has(entry.hostname)) {
    if (typeof minimaxHandler === 'function') desc = await minimaxHandler(entry)
    else if (minimaxHandler) desc = minimaxHandler
  }
  if (!desc) desc = respond(404, {})
  if (desc.kind === 'throw') throw desc.error
  const status = desc.status
  return {
    ok: desc.ok === undefined ? status >= 200 && status < 300 : desc.ok,
    status: status,
    json: async function () {
      if (desc.jsonThrows) throw new SyntaxError('Unexpected token < in JSON at position 0')
      return desc.body
    },
    text: async function () { return typeof desc.textBody === 'string' ? desc.textBody : JSON.stringify(desc.body) },
  }
}

function resetFetchLog() { fetchLog.length = 0 }
function minimaxCalls() { return fetchLog.filter((e) => MINIMAX_HOSTS.has(e.hostname)) }

// console.warn 捕获：用于「日志不得含密钥」断言
const warnLog = []
const realWarn = console.warn
console.warn = function (...args) { warnLog.push(args.map((a) => String(a)).join(' ')) }
const secretMarkers = []

// ---------- 桩 ctx + RPC 调用 ----------
function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }

function makeCtx(credentials) {
  const creds = credentials || {}
  const captured = { route: null, llmListener: null, intervalCalls: 0 }
  const ctx = {
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' }) }
      }
      return undefined
    },
    credentials: {
      resolve: async function (name) {
        const v = creds[name]
        return typeof v === 'string' && v.length > 0 ? { value: v } : undefined
      },
    },
    shell: { resolve: () => ({}), run: async () => ({ exitCode: 0, stdout: { text: '' } }) },
    interval() { captured.intervalCalls += 1; return () => {} },
    timeout() { return () => {} },
    on(event, listener) {
      if (event === 'llm/stream') captured.llmListener = listener
      return () => {}
    },
    inject(services, cb) {
      const deps = Array.isArray(services) ? services : []
      let ret
      if (deps.indexOf('webServer') >= 0) {
        const webCtx = {
          effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
          connection: { requestRejection(req) { return req.headers['sec-fetch-site'] === 'cross-site' ? 403 : undefined } },
          webServer: { register(route) { captured.route = route; return () => {} } },
        }
        ret = cb(webCtx)
      } else {
        // settings / sessionController 等可选服务：给一个「服务缺席」的空 ctx（与 cordis 服务缺席语义一致）
        ret = cb({})
      }
      return typeof ret === 'function' ? ret : () => {}
    },
  }
  return { captured, ctx }
}

async function withPlugin(credentials, fn) {
  const h = makeCtx(credentials)
  const dispose = plugin.apply(h.ctx)
  await delay(5) // 让启动期的异步任务（版本检查 / 价目刷新）落到 fetch 桩上
  try {
    return await fn(h)
  } finally {
    try { if (typeof dispose === 'function') dispose() } catch { /* 清理失败不影响断言 */ }
  }
}

function makeReq(path, method, body, headers) {
  const listeners = {}
  const req = {
    url: path,
    method: method || 'GET',
    headers: headers || {},
    on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return req },
    destroy() {},
  }
  return {
    req,
    emit() {
      if (body !== undefined) for (const cb of listeners.data || []) cb(Buffer.from(body))
      for (const cb of listeners.end || []) cb()
    },
  }
}
async function invoke(route, path, method, body, headers) {
  const { req, emit } = makeReq(path, method, body, headers)
  let status = 0
  let payload = null
  const res = {
    writeHead(s) { status = s },
    end(b) { try { payload = JSON.parse(b) } catch { payload = String(b) } },
  }
  const pending = route.handler(req, res)
  emit()
  await pending
  return { status, payload }
}
function callRpc(h, method, body, headers) {
  return invoke(h.captured.route, '/_dsh/dsh-bottom-info-bar/' + method, 'POST',
    body === undefined ? undefined : JSON.stringify(body),
    headers || { 'sec-fetch-site': 'same-origin' })
}
// 防御性取值：某条断言失败时后续断言不应因 undefined 抛错而中断（要看到全部 FAIL）
function winList(payload) { return payload && Array.isArray(payload.windows) ? payload.windows : [] }
function win(payload, i) { return winList(payload)[i] || {} }
function winKeys(payload) { return winList(payload).map((w) => w.key) }
function winCount(payload) { return winList(payload).length }
function urlOf(s) { const c = s.calls[0]; return c && c.url }
function authOf(s) {
  const c = s.calls[0]
  return c && c.options && c.options.headers ? c.options.headers.Authorization : undefined
}

// 一次性取快照：新 ctx + 受控响应
async function snapshotOnce(provider, opts) {
  const o = opts || {}
  return withPlugin(o.credentials || {}, async (h) => {
    resetFetchLog()
    setMinimaxHandler(o.handler || (() => okJson(o.body)))
    const rpc = await callRpc(h, 'getSubscriptionSnapshot', { selection: { provider, model: 'minimax-m1' }, force: true })
    return { h, rpc, payload: rpc.payload, calls: minimaxCalls() }
  })
}

// ---------- 夹具 ----------
const URL_MINIMAX = 'https://api.minimax.io/v1/token_plan/remains'
const URL_MINIMAX_CN = 'https://api.minimaxi.com/v1/token_plan/remains'
const PLAN = 'MiniMax Token Plan'
const T5 = 1800000000000
const TW = 1800500000000

function bucket(fields) { return Object.assign({ model_name: 'general' }, fields) }
function okBody(modelRemains, statusCode) {
  return { base_resp: { status_code: statusCode === undefined ? 0 : statusCode, status_msg: 'success' }, model_remains: modelRemains }
}
function labelIs(name, actual, key) {
  check(name + '（label ∈ LOCALES ' + key + '）', localeValues(key).includes(actual), actual)
}

// ===========================================================================
// ① 双站点路由 + 请求头
// ===========================================================================
console.log('\n===== ① 路由 / 请求头 =====')
{
  const body = okBody([bucket({ current_interval_remaining_percent: 64, end_time: T5, current_weekly_remaining_percent: 100, weekly_end_time: TW })])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k-global-abc' }, body })
  check('webServer 路由已注册（prefix /_dsh/dsh-bottom-info-bar）',
    s.h.captured.route && s.h.captured.route.kind === 'prefix' && s.h.captured.route.path === '/_dsh/dsh-bottom-info-bar')
  eqNum('Global 快照 RPC → HTTP 200', s.rpc.status, 200)
  eqNum('Global → 恰好 1 次 MiniMax 请求', s.calls.length, 1)
  eq('Global base URL', s.calls[0] && urlOf(s), URL_MINIMAX)
  eq('Global Authorization: Bearer <key>', s.calls[0] && s.calls[0].options.headers && authOf(s), 'Bearer k-global-abc')
  eq('Global Accept: application/json', s.calls[0] && s.calls[0].options.headers && s.calls[0].options.headers.Accept, 'application/json')
  check('Global 带 AbortSignal（超时信号）', !!(s.calls[0] && s.calls[0].options.signal) && typeof s.calls[0].options.signal.aborted === 'boolean')
  check('Global 未显式改方法（GET 语义）', !s.calls[0] || s.calls[0].options.method === undefined || s.calls[0].options.method === 'GET')
  eq('Global mode = subscription', s.payload && s.payload.mode, 'subscription')
  eq('Global source = minimax', s.payload && s.payload.source, 'minimax')
  eq('Global reason', s.payload && s.payload.reason, 'provider:minimax')
  eq('Global error = null', s.payload && s.payload.error, null)
  eq('套餐名 = 字面量常量', s.payload && s.payload.plan, PLAN)
  check('fetchedAt 为毫秒时间戳', typeof (s.payload && s.payload.fetchedAt) === 'number' && s.payload.fetchedAt > 0)
  eqNum('Global 窗口数 = 2', winCount(s.payload), 2)
  eq('Global 窗口键顺序', winKeys(s.payload), ['five_hour', 'seven_day'])
  labelIs('Global five_hour', win(s.payload, 0).label, 'host.hour')
  labelIs('Global seven_day', win(s.payload, 1).label, 'ui.weekly')
  eqNum('Global 5h usedPercent = 36（100 − 64）', win(s.payload, 0).usedPercent, 36)
  eqNum('Global 5h resetsAt = end_time', win(s.payload, 0).resetsAt, T5)
  eqNum('Global 周 usedPercent = 0（100 − 100）', win(s.payload, 1).usedPercent, 0)
  eqNum('Global 周 resetsAt = weekly_end_time', win(s.payload, 1).resetsAt, TW)
}
{
  const body = okBody([bucket({ current_interval_remaining_percent: 25, end_time: T5, current_weekly_remaining_percent: 50, weekly_end_time: TW })])
  const s = await snapshotOnce('minimax-cn', { credentials: { MINIMAX_CN_API_KEY: 'k-cn-abc' }, body })
  eqNum('CN → 恰好 1 次 MiniMax 请求', s.calls.length, 1)
  eq('CN base URL', s.calls[0] && urlOf(s), URL_MINIMAX_CN)
  eq('CN Authorization: Bearer <key>', s.calls[0] && s.calls[0].options.headers && authOf(s), 'Bearer k-cn-abc')
  eq('CN source = minimax-cn', s.payload && s.payload.source, 'minimax-cn')
  eq('CN 成功数据 provider = 实际 provider id', s.payload && winList(s.payload) && s.payload.mode, 'subscription')
  eqNum('CN 5h usedPercent = 75', win(s.payload, 0).usedPercent, 75)
  eqNum('CN 周 usedPercent = 50', win(s.payload, 1).usedPercent, 50)
}

// ===========================================================================
// ② 凭据优先级与跨站回退 / 无凭据
// ===========================================================================
console.log('\n===== ② 凭据优先级 / 回退 / no-key =====')
{
  const body = okBody([bucket({ current_interval_remaining_percent: 50 })])
  const s = await snapshotOnce('minimax-cn', {
    credentials: { MINIMAX_CN_API_KEY: 'k-cn-primary', MINIMAX_API_KEY: 'k-global-secondary' },
    body,
  })
  eq('CN 优先 MINIMAX_CN_API_KEY', authOf(s), 'Bearer k-cn-primary')
  eq('CN 仍打国内域名', urlOf(s), URL_MINIMAX_CN)
}
{
  const body = okBody([bucket({ current_interval_remaining_percent: 50 })])
  const s = await snapshotOnce('minimax', {
    credentials: { MINIMAX_API_KEY: 'k-global-primary', MINIMAX_CN_API_KEY: 'k-cn-secondary' },
    body,
  })
  eq('Global 优先 MINIMAX_API_KEY', authOf(s), 'Bearer k-global-primary')
  eq('Global 仍打国际域名', urlOf(s), URL_MINIMAX)
}
{
  const body = okBody([bucket({ current_interval_remaining_percent: 50 })])
  const s = await snapshotOnce('minimax-cn', { credentials: { MINIMAX_API_KEY: 'k-global-only' }, body })
  eq('CN 无本站 Key → 回退 MINIMAX_API_KEY', authOf(s), 'Bearer k-global-only')
  eq('CN 回退时域名不变（Key 与域名同域由服务端裁决）', urlOf(s), URL_MINIMAX_CN)
}
{
  const body = okBody([bucket({ current_interval_remaining_percent: 50 })])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_CN_API_KEY: 'k-cn-only' }, body })
  eq('Global 无本站 Key → 回退 MINIMAX_CN_API_KEY', authOf(s), 'Bearer k-cn-only')
  eq('Global 回退时域名不变', urlOf(s), URL_MINIMAX)
}
{
  const s = await snapshotOnce('minimax', { credentials: {} })
  eqNum('无凭据 → 零请求（不发网络）', s.calls.length, 0)
  eq('无凭据 kind = no-key', s.payload.error && s.payload.error.kind, 'no-key')
  eq('无凭据 code', s.payload.error && s.payload.error.code, 'subscription.minimax-not-configured')
  checkMessage('无凭据文案', s.payload.error, 'error.subscription.minimax-not-configured')
  eq('无凭据 → 无窗口', winList(s.payload), [])
  check('无凭据 → 文案不含 Bearer/Key 片段', !JSON.stringify(s.payload).includes('Bearer'))
}
{
  const s = await snapshotOnce('minimax-cn', { credentials: {} })
  eqNum('CN 无凭据 → 零请求', s.calls.length, 0)
  eq('CN 无凭据 code', s.payload.error && s.payload.error.code, 'subscription.minimax-not-configured')
}

// ===========================================================================
// ③ 真实 schema：多桶最紧聚合 / 字符串数字 / 取整钳制
// ===========================================================================
console.log('\n===== ③ 多桶最紧聚合 / 数值容忍 =====')
{
  // general（5h 64 / 周 100）+ video（5h 90 / 周 100，结束时刻更早）
  // 期望：最紧桶 general 胜出；resetsAt 必须取 general 自己的 end_time，而不是「全桶最早」
  const body = okBody([
    bucket({ model_name: 'general', current_interval_remaining_percent: 64, end_time: T5, current_weekly_remaining_percent: 100, weekly_end_time: TW }),
    bucket({ model_name: 'video', current_interval_remaining_percent: 90, end_time: T5 - 999000, current_weekly_remaining_percent: 100, weekly_end_time: TW - 999000 }),
  ])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body })
  eqNum('多桶：5h 取最紧 remaining=64 → used 36', win(s.payload, 0).usedPercent, 36)
  eqNum('多桶：5h resetsAt = 最紧桶 end_time（非全桶最早）', win(s.payload, 0).resetsAt, T5)
  eqNum('多桶：周 取最紧 remaining=100 → used 0', win(s.payload, 1).usedPercent, 0)
  eqNum('多桶：周并列取先出现桶的 weekly_end_time', win(s.payload, 1).resetsAt, TW)
}
{
  // 后出现的桶更紧 → 必须聚合到后桶（防「取首个桶」回归；最紧桶与首桶必须可区分）
  const body = okBody([
    bucket({ model_name: 'video', current_interval_remaining_percent: 90, end_time: T5 + 7000, current_weekly_remaining_percent: 80, weekly_end_time: TW + 7000 }),
    bucket({ model_name: 'general', current_interval_remaining_percent: 30, end_time: T5, current_weekly_remaining_percent: 20, weekly_end_time: TW }),
  ])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body })
  eqNum('后桶更紧 → 5h used 70（不是首桶的 10）', win(s.payload, 0).usedPercent, 70)
  eqNum('后桶更紧 → 周 used 80（不是首桶的 20）', win(s.payload, 1).usedPercent, 80)
  eqNum('后桶更紧 → resetsAt 取后桶 end_time', win(s.payload, 0).resetsAt, T5)
  eqNum('后桶更紧 → 周 resetsAt 取后桶 weekly_end_time', win(s.payload, 1).resetsAt, TW)
}
{
  const body = okBody([
    bucket({ current_interval_remaining_percent: 40, current_weekly_remaining_percent: 50 }),
    bucket({ current_interval_remaining_percent: 80, end_time: T5 - 5000, current_weekly_remaining_percent: 90, weekly_end_time: TW - 5000 }),
  ])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body })
  eqNum('最紧桶缺 end_time → 回退该窗口最早有效 end_time（5h）', win(s.payload, 0).resetsAt, T5 - 5000)
  eqNum('最紧桶缺 weekly_end_time → 回退最早有效值', win(s.payload, 1).resetsAt, TW - 5000)
  eqNum('回退不影响聚合值（5h used 60）', win(s.payload, 0).usedPercent, 60)
}
{
  const body = okBody([bucket({ current_interval_remaining_percent: 40, current_weekly_remaining_percent: 50 })])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body })
  eq('全无结束时刻 → resetsAt 为 null（窗口保留）', winList(s.payload).map((w) => w.resetsAt), [null, null])
  eqNum('全无结束时刻 → 窗口仍为 2 项', winCount(s.payload), 2)
}
{
  const body = okBody([bucket({ current_interval_remaining_percent: '64', current_weekly_remaining_percent: ' 100 ' })])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body })
  eqNum('字符串数字 "64" → used 36', win(s.payload, 0).usedPercent, 36)
  eqNum('带空格字符串 " 100 " → used 0', win(s.payload, 1).usedPercent, 0)
}
{
  const s646 = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body: okBody([bucket({ current_interval_remaining_percent: '64.6' })]) })
  eqNum('取整：64.6 → remaining 65 → used 35', s646.payload.windows[0].usedPercent, 35)
  const s644 = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body: okBody([bucket({ current_interval_remaining_percent: '64.4' })]) })
  eqNum('取整：64.4 → remaining 64 → used 36', s644.payload.windows[0].usedPercent, 36)
}
{
  const body = okBody([bucket({ current_interval_remaining_percent: 0, current_weekly_remaining_percent: 100 })])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body })
  eqNum('边界 remaining=0 → used 100', win(s.payload, 0).usedPercent, 100)
  eqNum('边界 remaining=100 → used 0', win(s.payload, 1).usedPercent, 0)
}
{
  const body = okBody([bucket({ current_interval_remaining_percent: -5, current_weekly_remaining_percent: 100 })])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body })
  eq('负数 remaining → 该窗口整项省略', winKeys(s.payload), ['seven_day'])
  eqNum('负数被跳过后周窗口正常（used 0）', win(s.payload, 0).usedPercent, 0)
}
{
  const body = okBody([bucket({ current_interval_remaining_percent: 150, current_weekly_remaining_percent: null })])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body })
  eqNum('remaining > 100 → 钳制 100 → used 0', win(s.payload, 0).usedPercent, 0)
  eq('null remaining → 该窗口省略', winKeys(s.payload), ['five_hour'])
}
{
  const body = okBody([bucket({ current_weekly_remaining_percent: 25 })])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body })
  eq('只有周窗口 → 仅产出 seven_day', winKeys(s.payload), ['seven_day'])
  eqNum('只有周窗口 → used 75', win(s.payload, 0).usedPercent, 75)
  eq('缺 end_time 的单独窗口 resetsAt = null', win(s.payload, 0).resetsAt, null)
}
{
  const body = okBody([null, 'x', 42, true, [], { current_interval_remaining_percent: 30, current_weekly_remaining_percent: 40 }])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body })
  eq('混入非对象项不崩且被忽略', s.payload.error, null)
  eqNum('非对象项忽略后 5h used 70', win(s.payload, 0).usedPercent, 70)
  eqNum('非对象项忽略后 周 used 60', win(s.payload, 1).usedPercent, 60)
}
{
  const body = okBody([bucket({ current_interval_remaining_percent: 64 }), 'garbage', bucket({ current_interval_remaining_percent: 90 })])
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body })
  eqNum('最紧聚合跨过垃圾项（64 < 90）', win(s.payload, 0).usedPercent, 36)
}

// ===========================================================================
// ④ 错误矩阵
// ===========================================================================
console.log('\n===== ④ 错误矩阵（kind + code + 文案） =====')
async function expectError(name, desc, kind, code, opts) {
  const o = opts || {}
  const creds = o.credentials || { MINIMAX_API_KEY: 'k-err-probe' }
  const provider = o.provider || 'minimax'
  const s = await snapshotOnce(provider, { credentials: creds, handler: typeof desc === 'function' ? desc : () => desc })
  eqNum(name + ' → RPC 仍 200（不把上游错误变 500）', s.rpc.status, 200)
  eq(name + ' → kind', s.payload.error && s.payload.error.kind, kind)
  if (code) eq(name + ' → code', s.payload.error && s.payload.error.code, code)
  if (code) checkMessage(name + ' → 文案', s.payload.error, code, o.params)
  eq(name + ' → 无旧数据时窗口为空', winList(s.payload), [])
  eq(name + ' → plan 为 null', s.payload.plan, null)
  return s
}
await expectError('HTTP 401', respond(401, {}), 'auth', 'subscription.minimax-auth-failed')
await expectError('HTTP 403', respond(403, {}), 'auth', 'subscription.minimax-auth-failed')
await expectError('base_resp 1004（按量 Key 打订阅端点）', okJson(okBody([], 1004)), 'auth', 'subscription.minimax-auth-failed')
await expectError('base_resp 2049（跨站 Key / Key 失效）', okJson(okBody([], 2049)), 'auth', 'subscription.minimax-auth-failed')
await expectError('base_resp 其他非 0（5001）', okJson(okBody([], 5001)), 'parse', 'subscription.minimax-unrecognized')
await expectError('HTTP 500', respond(500, {}), 'http', 'request.http', { params: { status: 500 } })
await expectError('HTTP 429', respond(429, {}), 'http', 'request.http', { params: { status: 429 } })
await expectError('坏 JSON', respond(200, null, { jsonThrows: true }), 'parse', 'request.parse')
await expectError('fetch 抛错（网络异常）', throwErr(new TypeError('e2e network down')), 'exception', null)
await expectError('fetch 抛 AbortError（超时）', throwErr(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })), 'exception', null)
await expectError('model_remains 空数组', okJson(okBody([])), 'parse', 'subscription.minimax-unrecognized')
await expectError('model_remains 缺失', okJson({ base_resp: { status_code: 0 } }), 'parse', 'subscription.minimax-unrecognized')
await expectError('body = null', okJson(null), 'parse', 'subscription.minimax-unrecognized')
await expectError('body = 数组', okJson([]), 'parse', 'subscription.minimax-unrecognized')
await expectError('model_remains 全是非法项', okJson(okBody([{}, { current_interval_remaining_percent: null }, { current_interval_remaining_percent: 'abc' }, { current_weekly_remaining_percent: -1 }])), 'parse', 'subscription.minimax-unrecognized')
{
  // base_resp.status_code 为字符串 '0' → 合法成功路径（数值字段容忍字符串）
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, body: okBody([bucket({ current_interval_remaining_percent: 50 })], '0') })
  eq("base_resp.status_code = '0' → 成功", s.payload.error, null)
  eqNum("base_resp.status_code = '0' → used 50", win(s.payload, 0).usedPercent, 50)
}
{
  // 网络异常文案：kind=exception 时 message = String(err.message || err)
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: 'k' }, handler: () => throwErr(new TypeError('e2e network down')) })
  check('exception → message 保留原始错误文本', s.payload.error && s.payload.error.message === 'e2e network down', s.payload.error)
}
{
  // 密钥泄漏：错误文案 / 整个 RPC 载荷 / console.warn 都不得出现 Key 片段
  const secret = 'sk-live-E2ESECRET-9f3a71'
  secretMarkers.push(secret)
  const s = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: secret }, handler: () => respond(401, {}) })
  check('auth 错误载荷不含密钥', !JSON.stringify(s.payload).includes(secret))
  check('auth 错误载荷不含密钥中间片段', !JSON.stringify(s.payload).includes('E2ESECRET-9f3a71'))
  check('auth 错误文案不含 Bearer', !(((s.payload.error || {}).message) || '').includes('Bearer'))
  // 契约：exception 的 message = String(err.message || err)（上游文本原样透传）。因此这里必须用
  // 「上游文本本身不含 Key」的异常来验证 host 没有自行拼接凭据；若上游错误文本自带 Key，
  // host 会原样透传（见最终报告的残留风险，非本适配器缺陷）。
  const s2 = await snapshotOnce('minimax', { credentials: { MINIMAX_API_KEY: secret }, handler: () => throwErr(new TypeError('e2e network down')) })
  check('exception 文案 = 上游文本且 host 不拼接凭据',
    s2.payload.error && s2.payload.error.message === 'e2e network down' && !JSON.stringify(s2.payload).includes(secret),
    s2.payload.error)
}

// ===========================================================================
// ⑤ 失败保留旧快照
// ===========================================================================
console.log('\n===== ⑤ 失败保留旧快照 =====')
{
  const goodBody = okBody([bucket({ current_interval_remaining_percent: 64, end_time: T5, current_weekly_remaining_percent: 100, weekly_end_time: TW })])
  await withPlugin({ MINIMAX_API_KEY: 'k-retain' }, async (h) => {
    resetFetchLog()
    setMinimaxHandler(sequenceHandler([okJson(goodBody), respond(500, {}), okJson(goodBody)]))
    const first = await callRpc(h, 'getSubscriptionSnapshot', { selection: { provider: 'minimax', model: 'm' }, force: true })
    const firstWindows = JSON.parse(JSON.stringify(winList(first.payload)))
    const firstFetchedAt = first.payload.fetchedAt
    const second = await callRpc(h, 'getSubscriptionSnapshot', { selection: { provider: 'minimax', model: 'm' }, force: true })
    eq('失败后 error 置位（http）', second.payload.error && second.payload.error.kind, 'http')
    eq('失败后 windows 保留旧值', winList(second.payload), firstWindows)
    eq('失败后 plan 保留', second.payload.plan, PLAN)
    eqNum('失败后 fetchedAt 保留（不刷新）', second.payload.fetchedAt, firstFetchedAt)
    const third = await callRpc(h, 'getSubscriptionSnapshot', { selection: { provider: 'minimax', model: 'm' }, force: true })
    eq('恢复成功后 error 清空', third.payload.error, null)
    check('恢复成功后 fetchedAt 前进', third.payload.fetchedAt >= firstFetchedAt)
    eq('恢复成功后窗口仍在', winCount(third.payload), 2)
  })
}
{
  const goodBody = okBody([bucket({ current_interval_remaining_percent: 10, current_weekly_remaining_percent: 20 })])
  await withPlugin({ MINIMAX_API_KEY: 'k-retain-auth' }, async (h) => {
    resetFetchLog()
    setMinimaxHandler(sequenceHandler([okJson(goodBody), respond(401, {})]))
    const first = await callRpc(h, 'getSubscriptionSnapshot', { selection: { provider: 'minimax', model: 'm' }, force: true })
    const second = await callRpc(h, 'getSubscriptionSnapshot', { selection: { provider: 'minimax', model: 'm' }, force: true })
    eq('401 失败后 kind = auth', second.payload.error && second.payload.error.kind, 'auth')
    eq('401 失败后旧窗口保留（used 90/80）', winList(second.payload).map((w) => w.usedPercent), [90, 80])
    eqNum('401 失败后 fetchedAt 不变', second.payload.fetchedAt, first.payload.fetchedAt)
  })
}
{
  const goodBody = okBody([bucket({ current_interval_remaining_percent: 30 })])
  await withPlugin({ MINIMAX_API_KEY: 'k-retain-parse' }, async (h) => {
    resetFetchLog()
    setMinimaxHandler(sequenceHandler([okJson(goodBody), okJson(okBody([]))]))
    const first = await callRpc(h, 'getSubscriptionSnapshot', { selection: { provider: 'minimax', model: 'm' }, force: true })
    const second = await callRpc(h, 'getSubscriptionSnapshot', { selection: { provider: 'minimax', model: 'm' }, force: true })
    eq('空桶降级后 kind = parse', second.payload.error && second.payload.error.kind, 'parse')
    eq('空桶降级后旧窗口保留', winList(second.payload).map((w) => w.usedPercent), [70])
    eqNum('空桶降级后 fetchedAt 不变', second.payload.fetchedAt, first.payload.fetchedAt)
  })
}

// ===========================================================================
// ⑥ 隔离性：非订阅零请求 / 双源互不串 / 账户键合并
// ===========================================================================
console.log('\n===== ⑥ 隔离性 =====')
{
  const s = await snapshotOnce('deepseek-official', { credentials: { MINIMAX_API_KEY: 'k-iso', MINIMAX_CN_API_KEY: 'k-iso-cn' }, body: okBody([bucket({ current_interval_remaining_percent: 50 })]) })
  eq('deepseek-official → balance 模式', s.payload.mode, 'balance')
  eq('deepseek-official → source = null', s.payload.source, null)
  eq('deepseek-official → windows 空', winList(s.payload), [])
  eqNum('非订阅 provider 零 MiniMax 请求', s.calls.length, 0)
}
{
  const s = await snapshotOnce('codex', { credentials: { MINIMAX_API_KEY: 'k-iso2' }, body: okBody([bucket({ current_interval_remaining_percent: 50 })]) })
  eq('codex → source = codex', s.payload.source, 'codex')
  eqNum('codex 不触发 MiniMax 请求', s.calls.length, 0)
}
{
  // 双站点同 ctx：Global / CN 各自独立快照，互不覆盖
  await withPlugin({ MINIMAX_API_KEY: 'k-both-global', MINIMAX_CN_API_KEY: 'k-both-cn' }, async (h) => {
    resetFetchLog()
    setMinimaxHandler((entry) => {
      if (entry.hostname === 'api.minimaxi.com') return okJson(okBody([bucket({ current_interval_remaining_percent: 10 })]))
      return okJson(okBody([bucket({ current_interval_remaining_percent: 70 })]))
    })
    const cn1 = await callRpc(h, 'getSubscriptionSnapshot', { selection: { provider: 'minimax-cn', model: 'm' }, force: true })
    const gl1 = await callRpc(h, 'getSubscriptionSnapshot', { selection: { provider: 'minimax', model: 'm' }, force: true })
    const cn2 = await callRpc(h, 'getSubscriptionSnapshot', { selection: { provider: 'minimax-cn', model: 'm' }, force: true })
    eq('CN 源快照 source = minimax-cn', cn1.payload.source, 'minimax-cn')
    eq('Global 源快照 source = minimax', gl1.payload.source, 'minimax')
    eqNum('CN 快照 = CN 数据（used 90）', win(cn1.payload, 0).usedPercent, 90)
    eqNum('Global 快照 = Global 数据（used 30）', win(gl1.payload, 0).usedPercent, 30)
    eqNum('再查 CN 不被 Global 覆盖（仍 90）', win(cn2.payload, 0).usedPercent, 90)
    const urls = minimaxCalls().map((c) => c.url)
    eq('三次 force 查询 → 三次请求且域名集合 = {Global, CN}', Array.from(new Set(urls)).sort(), [URL_MINIMAX, URL_MINIMAX_CN].sort())
    eqNum('CN 查询两次 → 国内域名两次', urls.filter((u) => u === URL_MINIMAX_CN).length, 2)
    eqNum('Global 查询一次 → 国际域名一次', urls.filter((u) => u === URL_MINIMAX).length, 1)
  })
}
{
  // 裁决 ④：accountForProvider 两者都映射 'minimax'（用真实记账路径验证）
  await withPlugin({ MINIMAX_API_KEY: 'k-acct' }, async (h) => {
    const listener = h.captured.llmListener
    check('llm/stream 监听器已注册（记账路径可用）', typeof listener === 'function')
    if (typeof listener === 'function') {
      async function* fakeStream() {
        yield { type: 'usage', usage: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 2000 } }
        yield { type: 'finish' }
      }
      const iter = listener({ model: 'minimax-m1', provider: 'minimax-cn', sessionId: 's-minimax-e2e' }, async () => fakeStream())
      for await (const _chunk of iter) { /* drain */ }
      const same = await callRpc(h, 'getUsageSummary', { sessionId: 's-minimax-e2e', selection: { provider: 'minimax', model: 'minimax-m1' } })
      const other = await callRpc(h, 'getUsageSummary', { sessionId: 's-minimax-e2e', selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
      check('minimax-cn 记账落在 minimax 账户（minimax 查询可见）', same.payload && same.payload.sessions >= 1, same.payload && same.payload.sessions)
      eqNum('同一记录不落到 deepseek 账户', other.payload && other.payload.sessions, 0)
    }
  })
}

// ===========================================================================
// ⑦ 同源防护（订阅请求由该端点驱动）
// ===========================================================================
console.log('\n===== ⑦ 同源防护 =====')
{
  await withPlugin({ MINIMAX_API_KEY: 'k-origin' }, async (h) => {
    resetFetchLog()
    setMinimaxHandler(() => okJson(okBody([bucket({ current_interval_remaining_percent: 50 })])))
    const cross = await invoke(h.captured.route, '/_dsh/dsh-bottom-info-bar/getSubscriptionSnapshot', 'POST',
      JSON.stringify({ selection: { provider: 'minimax', model: 'm' }, force: true }), { 'sec-fetch-site': 'cross-site' })
    eqNum('跨站 getSubscriptionSnapshot → 403', cross.status, 403)
    eqNum('跨站请求不驱动 MiniMax 网络请求', minimaxCalls().length, 0)
  })
}

// ===========================================================================
// ⑧ quotaDisplayMode（宿主）
// ===========================================================================
console.log('\n===== ⑧ quotaDisplayMode（宿主） =====')
const settingsFile = internals && internals.settingsFile
check('__settingsInternals.settingsFile 可用', typeof settingsFile === 'string' && settingsFile.length > 0, settingsFile)
check('__settingsInternals 导出 normalizeQuotaDisplayMode', typeof internals.normalizeQuotaDisplayMode === 'function')
eq('QUOTA_DISPLAY_MODES 取值与顺序', internals.QUOTA_DISPLAY_MODES, ['used', 'remaining'])
eq('defaultFieldSettings().quotaDisplayMode 默认 remaining', internals.defaultFieldSettings().quotaDisplayMode, 'remaining')
eq("normalizeQuotaDisplayMode('used')", internals.normalizeQuotaDisplayMode('used'), 'used')
eq("normalizeQuotaDisplayMode('remaining')", internals.normalizeQuotaDisplayMode('remaining'), 'remaining')
eq("normalizeQuotaDisplayMode('USED') → null", internals.normalizeQuotaDisplayMode('USED'), null)
eq('normalizeQuotaDisplayMode(null) → null', internals.normalizeQuotaDisplayMode(null), null)
eq('normalizeQuotaDisplayMode(undefined) → null', internals.normalizeQuotaDisplayMode(undefined), null)
eq('normalizeQuotaDisplayMode(0) → null', internals.normalizeQuotaDisplayMode(0), null)
eq('normalizeQuotaDisplayMode({}) → null', internals.normalizeQuotaDisplayMode({}), null)
{
  const sanitized = internals.sanitizeSettings({ version: internals.defaultFieldSettings().version, quotaDisplayMode: 'garbage' })
  eq('sanitizeSettings 非法值被丢弃（保留默认）', sanitized.settings.quotaDisplayMode, 'remaining')
  check('sanitizeSettings 记录 dropped.quotaDisplayMode', sanitized.dropped.includes('quotaDisplayMode'), sanitized.dropped)
  const good = internals.sanitizeSettings({ version: internals.defaultFieldSettings().version, quotaDisplayMode: 'used' })
  eq('sanitizeSettings 合法值被接受', good.settings.quotaDisplayMode, 'used')
}
{
  const absent = internals.sanitizeSettings({ version: internals.defaultFieldSettings().version })
  eq('sanitizeSettings 缺字段 → 默认 remaining', absent.settings.quotaDisplayMode, 'remaining')
  check('sanitizeSettings 缺字段不产生 dropped', !absent.dropped.includes('quotaDisplayMode'), absent.dropped)
}
{
  await withPlugin({}, async (h) => {
    const cfg0 = await callRpc(h, 'getFieldConfig')
    eqNum('getFieldConfig → 200', cfg0.status, 200)
    eq('getFieldConfig 默认 quotaDisplayMode = remaining（老用户语义不变）', cfg0.payload.quotaDisplayMode, 'remaining')
    check('getFieldConfig 响应含 configVersion', typeof cfg0.payload.configVersion === 'number')
    const set = await callRpc(h, 'setFieldConfig', { quotaDisplayMode: 'used' })
    eqNum('setFieldConfig(used) → 200', set.status, 200)
    eq('setFieldConfig(used) 回包生效', set.payload.quotaDisplayMode, 'used')
    eqNum('setFieldConfig 后 configVersion 递增', set.payload.configVersion > cfg0.payload.configVersion, true)
    const reread = await callRpc(h, 'getFieldConfig')
    eq('getFieldConfig 复读 = used', reread.payload.quotaDisplayMode, 'used')
    check('settings.json 已落盘 quotaDisplayMode=used',
      existsSync(settingsFile) && JSON.parse(readFileSync(settingsFile, 'utf8')).quotaDisplayMode === 'used',
      existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8').slice(0, 200) : 'missing')
    const bad = await callRpc(h, 'setFieldConfig', { quotaDisplayMode: 'garbage' })
    eqNum('setFieldConfig(非法值) → 400', bad.status, 400)
    const badExpected = localeValues('host.quotaDisplayModeInvalid')
    check('非法值文案 = host.quotaDisplayModeInvalid', badExpected.includes(String(bad.payload && bad.payload.error)), bad.payload)
    const afterBad = await callRpc(h, 'getFieldConfig')
    eq('非法 patch 一个字段都不落（原子性）', afterBad.payload.quotaDisplayMode, 'used')
    for (const garbage of ['USED', '', null, 1, {}, []]) {
      const r = await callRpc(h, 'setFieldConfig', { quotaDisplayMode: garbage })
      eqNum('非法值 ' + JSON.stringify(garbage) + ' → 400', r.status, 400)
    }
    const reset = await callRpc(h, 'resetFieldConfig')
    eqNum('resetFieldConfig → 200', reset.status, 200)
    eq('resetFieldConfig 复位为 remaining', reset.payload.quotaDisplayMode, 'remaining')
    check('reset 后磁盘 = remaining', JSON.parse(readFileSync(settingsFile, 'utf8')).quotaDisplayMode === 'remaining')
    const cross = await invoke(h.captured.route, '/_dsh/dsh-bottom-info-bar/setFieldConfig', 'POST',
      JSON.stringify({ quotaDisplayMode: 'used' }), { 'sec-fetch-site': 'cross-site' })
    eqNum('跨站 setFieldConfig → 403', cross.status, 403)
  })
}

// ===========================================================================
// ⑨ 客户端源码（真实切片求值 + 定向静态断言）
// ===========================================================================
console.log('\n===== ⑨ 客户端方向 / 告警 / 可达性 / 对比度 =====')
const clientSource = readFileSync(CLIENT_SOURCE_PATH, 'utf8')
function sliceBetween(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker)
  if (a < 0) return null
  const b = src.indexOf(endMarker, a + startMarker.length)
  if (b <= a) return null
  return src.slice(a, b)
}
{
  const snippet = sliceBetween(clientSource, "const DEFAULT_QUOTA_DISPLAY_MODE = 'remaining';", 'function activeQuotaDisplayMode()')
  check('客户端可切出方向归一源码（非空）', !!snippet && snippet.length > 60, snippet && snippet.length)
  let normalize = null
  if (snippet) {
    try { normalize = new Function(snippet + '\nreturn normalizeQuotaDisplayMode;')() } catch (err) { check('客户端归一函数可求值', false, String(err)) }
  }
  check('客户端归一函数可执行', typeof normalize === 'function')
  if (typeof normalize === 'function') {
    eq("客户端 normalize('used')", normalize('used'), 'used')
    eq("客户端 normalize('remaining')", normalize('remaining'), 'remaining')
    eq("客户端 normalize('USED') → remaining（回退）", normalize('USED'), 'remaining')
    eq('客户端 normalize(undefined) → remaining', normalize(undefined), 'remaining')
    eq('客户端 normalize(null) → remaining', normalize(null), 'remaining')
    eq('客户端 normalize(0) → remaining', normalize(0), 'remaining')
    eq('客户端 normalize({}) → remaining', normalize({}), 'remaining')
  }
}
{
  const snippet = sliceBetween(clientSource, 'function remainingPercent(w) {', 'function quotaWindowDetail(w, mode)')
  check('客户端可切出百分比源码（非空）', !!snippet && snippet.length > 200, snippet && snippet.length)
  let fns = null
  if (snippet) {
    try { fns = new Function(snippet + '\nreturn { remainingPercent: remainingPercent, quotaWindowPercent: quotaWindowPercent };')() } catch (err) { check('客户端百分比函数可求值', false, String(err)) }
  }
  check('客户端百分比函数可执行', !!fns && typeof fns.quotaWindowPercent === 'function')
  if (fns) {
    eqNum('remaining 方向显示 70（usedPercent 30）', fns.quotaWindowPercent({ usedPercent: 30 }, 'remaining'), 70)
    eqNum('used 方向显示 30（usedPercent 30）', fns.quotaWindowPercent({ usedPercent: 30 }, 'used'), 30)
    eqNum('非法方向回退 remaining', fns.quotaWindowPercent({ usedPercent: 30 }, 'garbage'), 70)
    eqNum('缺方向回退 remaining', fns.quotaWindowPercent({ usedPercent: 30 }, undefined), 70)
    eqNum('remainingPercent 钳制下界', fns.remainingPercent({ usedPercent: 130 }), 0)
    // 告警等价性：告警只看 remaining，与显示方向无关
    const low = { usedPercent: 85 } // 剩余 15 ≤ 20 → 告警
    const ok = { usedPercent: 15 } // 剩余 85 → 不告警
    check('低额度告警按剩余判定（85% 已用 → 告警）', fns.remainingPercent(low) <= 20)
    check('正常额度不告警（15% 已用 → 不告警）', fns.remainingPercent(ok) > 20)
    check('告警不受显示方向影响（used 模式下仍按剩余）',
      fns.remainingPercent(low) <= 20 && fns.remainingPercent(ok) > 20 &&
      fns.quotaWindowPercent(low, 'used') === 85 && fns.quotaWindowPercent(low, 'remaining') === 15)
  }
}
{
  const lowConst = /const LOW_QUOTA_PERCENT = (\d+);/.exec(clientSource)
  check('客户端存在 LOW_QUOTA_PERCENT 常量', !!lowConst, lowConst && lowConst[0])
  eqNum('低额度阈值 = 20（剩余）', lowConst ? Number(lowConst[1]) : null, 20)
  check('低额度样式绑定 remaining（非显示值）',
    /const numberClass = remaining <= LOW_QUOTA_PERCENT \? 'bi-quota-low' : '';/.test(clientSource))
  check('低额度「低」标签同样按 remaining 判定',
    /if \(remaining <= LOW_QUOTA_PERCENT\) winNodes\.push/.test(clientSource))
}
{
  const modeFn = sliceBetween(clientSource, 'function bibSetQuotaMode(props) {', 'function bibSetQuotaDisplaySection(props) {')
  check('分段控件源码可切出', !!modeFn && modeFn.length > 400, modeFn && modeFn.length)
  if (modeFn) {
    check('分段控件 role=radiogroup + 子项 role=radio', /role: 'radiogroup'/.test(modeFn) && /role: 'radio'/.test(modeFn))
    check('分段控件 aria-checked 绑定选中态', /'aria-checked': selected/.test(modeFn))
    check('分段控件 roving tabindex（选中 0 / 其余 -1）', /tabIndex: selected \? 0 : -1/.test(modeFn))
    check('分段控件方向键 / Home / End 可达',
      /ArrowRight/.test(modeFn) && /ArrowLeft/.test(modeFn) && /'Home'/.test(modeFn) && /'End'/.test(modeFn))
  }
  const sectionFn = sliceBetween(clientSource, 'function bibSetQuotaDisplaySection(props) {', 'const USAGE_EXPORT_COLUMNS')
  check('设置区源码可切出', !!sectionFn && sectionFn.length > 200, sectionFn && sectionFn.length)
  if (sectionFn) {
    check('三个订阅窗口全关时设置区整块隐藏',
      /const windowsOn = \['subWindow5h', 'subWindowWeek', 'subWindowMonth'\]\.some/.test(sectionFn) && /if \(!windowsOn\) return null;/.test(sectionFn))
  }
}
{
  // 对比度（AGENTS.md 反色铁律）：选中态品牌深档 × 白字 ≥ 4.5:1，hover 不退回浅档
  function channel(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  function luminance(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim())
    if (!m) return null
    const n = parseInt(m[1], 16)
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  }
  function contrast(a, b) {
    const la = luminance(a); const lb = luminance(b)
    if (la == null || lb == null) return null
    const hi = Math.max(la, lb); const lo = Math.min(la, lb)
    return (hi + 0.05) / (lo + 0.05)
  }
  const strong = /--bib-set-brand-strong:\s*(#[0-9a-fA-F]{6})/.exec(clientSource)
  check('存在品牌深档 --bib-set-brand-strong', !!strong, strong && strong[0])
  const onRule = /\.bib-set-quota-mode-opt\[aria-checked="true"\]\s*\{([^}]*)\}/.exec(clientSource)
  const hoverRule = /\.bib-set-quota-mode-opt\[aria-checked="true"\]:hover\s*\{([^}]*)\}/.exec(clientSource)
  check('选中态规则存在', !!onRule, onRule && onRule[1])
  check('hover 规则存在', !!hoverRule, hoverRule && hoverRule[1])
  if (strong && onRule) {
    const ratio = contrast(strong[1], '#ffffff')
    check('选中态背景 = 品牌深档 + #fff', /background:\s*var\(--bib-set-brand-strong\)/.test(onRule[1]) && /color:\s*#fff/.test(onRule[1]), onRule[1])
    check('选中态对比度 ≥ 4.5:1（实测 ' + (ratio == null ? 'n/a' : ratio.toFixed(2)) + ':1）', ratio != null && ratio >= 4.5)
  }
  if (hoverRule) {
    check('hover 仍保持品牌深档（不跟随主题变浅）', /background:\s*var\(--bib-set-brand-strong\)/.test(hoverRule[1]) && /color:\s*#fff/.test(hoverRule[1]), hoverRule[1])
  }
}

// ===========================================================================
// ⑩ 密钥泄漏（全量 console.warn 复查）
// ===========================================================================
console.log('\n===== ⑩ 日志密钥复查 =====')
check('测试期间产生的告警均不含任何测试密钥片段',
  secretMarkers.every((m) => !warnLog.some((line) => line.includes(m))),
  warnLog.filter((line) => secretMarkers.some((m) => line.includes(m))))

// ---------- 收尾 ----------
console.warn = realWarn
globalThis.fetch = realFetch
try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* 临时数据目录清理失败不影响结论 */ }
if (failures.length > 0) {
  console.log('\nFAIL 共 ' + failures.length + ' 条：')
  for (const f of failures) console.log('  - ' + f)
}
console.log('\n' + (failures.length === 0 ? '全部通过' : '存在失败') + '：' + pass + ' PASS / ' + failures.length + ' FAIL（host=' + HOST_MODULE + '）')
process.exit(failures.length === 0 ? 0 : 1)
