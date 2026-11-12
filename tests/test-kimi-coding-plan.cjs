// Kimi For Coding 宿主适配单测（v1.22.0）
// 覆盖：
//  K1 parseKimiCodingUsages：limits[] 窗口时长（300/10080）/ 顶层 usage / usages 名称归类 /
//     数值字符串 / 重置时间秒毫秒 ISO / 无窗口与非法额度降级 / 默认窗口标签
//  K2 fetchKimiCodingUsage：凭据优先级与环境变量 / OAuth 对象凭据 / 先 CN 后国际 /
//     401 与 403 归 auth / 5xx 与不可解析数据的降级 / 网络异常 / 错误信息不含 key
//  K3 常量与接线一致性：constants.js 身份表与集合 / host.js 订阅源与展示名 / client 品牌分支 / locale 键
// 用法：node tests/test-kimi-coding-plan.cjs
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { dictionaries } = require('./locale-fixture.cjs')

const root = join(__dirname, '..')
const hostSrc = readFileSync(join(root, 'src', 'host.js'), 'utf8')
const constantsSrc = readFileSync(join(root, 'src', 'constants.js'), 'utf8')
const clientSrc = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')
const zhDict = dictionaries.zh
const enDict = dictionaries.en

function extractFn(name) {
  let start = hostSrc.indexOf('function ' + name)
  if (start < 0) throw new Error('未找到 function ' + name)
  if (hostSrc.slice(start - 6, start) === 'async ') start -= 6
  let depth = 0, i = start, inStr = null
  while (i < hostSrc.length) {
    const c = hostSrc[i]
    if (inStr) {
      if (c === '\\') { i += 2; continue }
      if (c === inStr) inStr = null
    } else if (c === '"' || c === "'" || c === '\u0060') {
      inStr = c
    } else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
    i++
  }
  return hostSrc.slice(start, i + 1)
}
function extractBraced(src, marker) {
  const at = src.indexOf(marker)
  if (at < 0) throw new Error('未找到 ' + marker)
  const from = src.indexOf('{', at + marker.length)
  let depth = 0, i = from, inStr = null
  while (i < src.length) {
    const c = src[i]
    if (inStr) {
      if (c === '\\') { i += 2; continue }
      if (c === inStr) inStr = null
    } else if (c === '"' || c === "'" || c === '\u0060') {
      inStr = c
    } else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
    i++
  }
  return src.slice(from, i + 1)
}
function extractBracketed(src, marker) {
  const at = src.indexOf(marker)
  if (at < 0) throw new Error('未找到 ' + marker)
  const from = src.indexOf('[', at + marker.length)
  const end = src.indexOf(']', from)
  if (end < 0) throw new Error(marker + ' 结构不完整')
  return src.slice(from, end + 1)
}
function extractClientFnBody(name) {
  const start = clientSrc.indexOf('function ' + name)
  if (start < 0) throw new Error('未找到 client function ' + name)
  let depth = 0, i = start, inStr = null
  while (i < clientSrc.length) {
    const c = clientSrc[i]
    if (inStr) {
      if (c === '\\') { i += 2; continue }
      if (c === inStr) inStr = null
    } else if (c === '"' || c === "'" || c === '\u0060') {
      inStr = c
    } else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
    i++
  }
  return clientSrc.slice(start, i + 1)
}

const WINDOW_LABELS = eval('(' + extractBraced(hostSrc, 'const WINDOW_LABELS = ') + ')')
const KIMI_CODING_BASE_URLS = eval('(' + extractBracketed(hostSrc, 'const KIMI_CODING_BASE_URLS = ') + ')')
const KIMI_CODING_CREDENTIAL_NAMES = eval('(' + extractBracketed(hostSrc, 'const KIMI_CODING_CREDENTIAL_NAMES = ') + ')')
const KIMI_CODING_RECORD_KEY = (hostSrc.match(/const KIMI_CODING_RECORD_KEY = '([^']+)'/) || [])[1]
const HTTP_TIMEOUT_MS = Number((hostSrc.match(/const HTTP_TIMEOUT_MS = (\d+)/) || [])[1])
const SUBSCRIPTION_PROVIDERS = eval('(' + extractBracketed(constantsSrc, 'export const SUBSCRIPTION_PROVIDERS = ') + ')')
const DSH_PRESET_PROVIDERS = eval('(' + extractBracketed(constantsSrc, 'export const DSH_PRESET_PROVIDERS = ') + ')')
const PROVIDER_IDENTITY = eval('(' + extractBraced(constantsSrc, 'export const PROVIDER_IDENTITY = ') + ')')

const KIMI_KEY = 'sk-kimi-test-key-never-leak'

function tStub(key, params) {
  const raw = zhDict[key]
  if (typeof raw !== 'string') throw new Error('未预期的 i18n key: ' + key)
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, function (m, name) {
    return params[name] !== undefined ? String(params[name]) : m
  })
}

function makeRes(status, body) {
  return { ok: status >= 200 && status < 300, status: status, json: async function () { return body } }
}
function response(status, body) {
  return function () { return Promise.resolve(makeRes(status, body)) }
}
function networkError(message) {
  return function () { return Promise.reject(new Error(message)) }
}

// fetch 层装置：抽出 apply 内的 resolveKimiCodingKey / fetchKimiCodingUsage，注入桩依赖
function makeHarness(u, options) {
  const opts = options || {}
  const creds = opts.creds || {}
  const env = opts.env || {}
  const responses = opts.responses || []
  const calls = []
  const fetchImpl = async function (url, init) {
    calls.push({ url: url, init: init })
    const index = calls.length - 1
    const spec = responses[index]
    if (!spec) throw new Error('未预期的第 ' + (index + 1) + ' 次请求：' + url)
    return spec(url, init, index)
  }
  const ctx = {
    credentials: {
      resolve: async function (name) {
        return Object.prototype.hasOwnProperty.call(creds, name) ? { value: creds[name] } : null
      },
    },
  }
  const factory = eval(
    '(function (ctx, t, windowLabels, fetch, AbortSignal, process, parseKimiCodingUsages) {'
    + 'const HTTP_TIMEOUT_MS = ' + HTTP_TIMEOUT_MS + ';'
    + 'const KIMI_CODING_BASE_URLS = ' + JSON.stringify(KIMI_CODING_BASE_URLS) + ';'
    + 'const KIMI_CODING_CREDENTIAL_NAMES = ' + JSON.stringify(KIMI_CODING_CREDENTIAL_NAMES) + ';'
    + 'const KIMI_CODING_RECORD_KEY = ' + JSON.stringify(KIMI_CODING_RECORD_KEY) + ';'
    + extractFn('timeoutSignal')
    + extractFn('processEnvValue')
    + extractFn('readKimiCodingRecordToken')
    + extractFn('resolveKimiCodingKey')
    + extractFn('fetchKimiCodingUsage')
    + 'return { resolveKimiCodingKey: resolveKimiCodingKey, fetchKimi: fetchKimiCodingUsage } })'
  )
  const api = factory(ctx, tStub, WINDOW_LABELS, fetchImpl, AbortSignal, { env: Object.assign({}, env) }, u.parseKimiCodingUsages)
  return { calls: calls, api: api }
}

let pass = 0, fail = 0
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; console.log('PASS  ' + label + ' → ' + a) }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + e + '，实际 ' + a) }
}
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label) }
  else { fail++; console.log('FAIL  ' + label + (detail ? ' — ' + detail : '')) }
}

async function main() {
  const { __usageInternals: u } = await import(pathToFileURL(join(root, 'src', 'host.js')).href)
  const WL = WINDOW_LABELS
  const CN_URL = 'https://api.kimi.com/coding/v1/usages'
  const INTL_URL = 'https://api.kimi.ai/coding/v1/usages'

  // 社区三份实现交集的真实响应形态：limits[]（5h）+ 顶层 usage（周），数值均为字符串。
  const RESULT_BODY = {
    limits: [{ window: { duration: 300 }, detail: { limit: '100', remaining: '70', resetTime: 1761926400000 } }],
    usage: { limit: '1000', remaining: '800', resetTime: 1762000000000 },
  }

  // ================= K1) parseKimiCodingUsages =================
  const kimi = u.parseKimiCodingUsages({
    limits: [{ window: { duration: 300 }, detail: { limit: '100', remaining: '80', resetTime: '2026-02-07T12:32:50.757Z' } }],
    usage: { limit: '1000', remaining: '900', resetTime: 1762000000000 },
  }, WL)
  ok('K1 limits[] 5h 与顶层 usage 周窗口共两个', !!kimi && kimi.windows.length === 2, JSON.stringify(kimi))
  check('K2 窗口顺序 five_hour → seven_day', kimi && kimi.windows.map(function (w) { return w.key }), ['five_hour', 'seven_day'])
  check('K3 5h 已用 20%（limit 100 - remaining 80）', kimi && kimi.windows[0].usedPercent, 20)
  check('K4 周已用 10%（1000 - 900）', kimi && kimi.windows[1].usedPercent, 10)
  check('K5 标签跟随传入字典 [5 小时, 周]', kimi && kimi.windows.map(function (w) { return w.label }), ['5 小时', '周'])
  check('K6 ISO resetTime → 毫秒', kimi && kimi.windows[0].resetsAt, Date.parse('2026-02-07T12:32:50.757Z'))
  check('K7 13 位毫秒 resetTime 直通', kimi && kimi.windows[1].resetsAt, 1762000000000)
  check('K8 plan 为 null（接口无套餐名）', kimi && kimi.plan, null)
  check('K9 duration 10080 → seven_day',
    u.parseKimiCodingUsages({ limits: [{ window: { duration: 10080 }, detail: { limit: 100, remaining: 90 } }] }, WL).windows[0].usedPercent, 10)
  check('K10 window.duration 为字符串 "300" 也可用',
    u.parseKimiCodingUsages({ limits: [{ window: { duration: '300' }, detail: { limit: 100, remaining: 60 } }] }, WL).windows[0].key, 'five_hour')
  check('K11 单条 limits 缺 window 时长 → 按 5 小时兜底',
    u.parseKimiCodingUsages({ limits: [{ detail: { limit: 100, remaining: 70 } }] }, WL).windows[0].usedPercent, 30)
  check('K12 单条 limits 直接是 detail（无 detail 包裹）→ 5 小时兜底',
    u.parseKimiCodingUsages({ limits: [{ limit: 100, remaining: 40 }] }, WL).windows[0].usedPercent, 60)
  check('K13 多条 limits 缺时长 → 无法归类 → null',
    u.parseKimiCodingUsages({ limits: [{ detail: { limit: 100, remaining: 70 } }, { detail: { limit: 100, remaining: 60 } }] }, WL), null)
  check('K14 只有顶层 usage → 周窗口 75%',
    u.parseKimiCodingUsages({ usage: { limit: 100, remaining: 25 } }, WL).windows.map(function (w) { return [w.key, w.usedPercent] }),
    [['seven_day', 75]])
  check('K15 usages 对象按窗口名归类',
    u.parseKimiCodingUsages({ usages: { five_hour: { limit: 100, remaining: 20 }, weekly: { limit: 100, remaining: 60 } } }, WL)
      .windows.map(function (w) { return [w.key, w.usedPercent] }),
    [['five_hour', 80], ['seven_day', 40]])
  check('K16 usages 名称别名 hourly / rolling 归 five_hour',
    u.parseKimiCodingUsages({ usages: { hourly: { limit: 100, remaining: 10 }, rolling: { limit: 100, remaining: 20 } } }, WL).windows.length, 1)
  check('K17 usages 数组按 window.duration 归类',
    u.parseKimiCodingUsages({ usages: [
      { window: { duration: 300 }, detail: { limit: 100, remaining: 50 } },
      { window: { duration: 10080 }, detail: { limit: 100, remaining: 90 } },
    ] }, WL).windows.map(function (w) { return w.key }),
    ['five_hour', 'seven_day'])
  check('K18 同窗口重复出现只保留第一条（limits 两条 300）',
    u.parseKimiCodingUsages({ limits: [
      { window: { duration: 300 }, detail: { limit: 100, remaining: 20 } },
      { window: { duration: 300 }, detail: { limit: 100, remaining: 50 } },
    ] }, WL).windows.map(function (w) { return w.usedPercent }),
    [80])
  check('K19 limits 与顶层 usage 同窗口时先到者胜（limits 的周窗口）',
    u.parseKimiCodingUsages({
      limits: [{ window: { duration: 10080 }, detail: { limit: 100, remaining: 10 } }],
      usage: { limit: 100, remaining: 90 },
    }, WL).windows.map(function (w) { return w.usedPercent }),
    [90])
  check('K20 10 位秒级 resetTime ×1000',
    u.parseKimiCodingUsages({ usage: { limit: 100, remaining: 90, resetTime: 1762000000 } }, WL).windows[0].resetsAt, 1762000000000)
  check('K21 缺 resetTime → resetsAt null 但窗口保留',
    u.parseKimiCodingUsages({ usage: { limit: 100, remaining: 50 } }, WL).windows[0].resetsAt, null)
  check('K22 resetTime 为负数 → resetsAt null',
    u.parseKimiCodingUsages({ usage: { limit: 100, remaining: 50, resetTime: -1 } }, WL).windows[0].resetsAt, null)
  check('K23 remaining 超过 limit → 0% 已用',
    u.parseKimiCodingUsages({ usage: { limit: 100, remaining: 150 } }, WL).windows[0].usedPercent, 0)
  check('K24 remaining=0 → 100% 已用（窗口仍保留）',
    u.parseKimiCodingUsages({ usage: { limit: 100, remaining: 0 } }, WL).windows[0].usedPercent, 100)
  check('K25 剩余 0 的字符串 "0" 同样 100%',
    u.parseKimiCodingUsages({ usage: { limit: '100', remaining: '0' } }, WL).windows[0].usedPercent, 100)
  check('K26 小数 remaining 四舍五入',
    u.parseKimiCodingUsages({ usage: { limit: 100, remaining: 99.4 } }, WL).windows[0].usedPercent, 1)
  check('K27 limit 为 0 / 缺失 / 非法 / 负数 → null',
    [u.parseKimiCodingUsages({ usage: { limit: 0, remaining: 0 } }, WL),
      u.parseKimiCodingUsages({ usage: { remaining: 10 } }, WL),
      u.parseKimiCodingUsages({ usage: { limit: 'oops', remaining: 10 } }, WL),
      u.parseKimiCodingUsages({ usage: { limit: -5, remaining: 10 } }, WL)],
    [null, null, null, null])
  check('K28 空对象 / null / 字符串 / 数组 → null',
    [u.parseKimiCodingUsages({}, WL), u.parseKimiCodingUsages(null, WL), u.parseKimiCodingUsages('oops', WL), u.parseKimiCodingUsages([], WL)],
    [null, null, null, null])
  check('K29 limits 非数组时忽略', u.parseKimiCodingUsages({ limits: 'oops' }, WL), null)
  check('K30 条目为 null/字符串 → 全部跳过 → null',
    u.parseKimiCodingUsages({ limits: [null, 'x', 7] }, WL), null)
  check('K31 不传 windowLabels → 回退模块兜底字典标签',
    u.parseKimiCodingUsages({ usage: { limit: 100, remaining: 50 } }).windows[0].label, '周')

  // ================= K2) fetchKimiCodingUsage =================
  const results = []
  function record(r) { results.push(r); return r }

  // 无凭据
  const noKeyH = makeHarness(u, { creds: {}, responses: [] })
  const noKey = record(await noKeyH.api.fetchKimi())
  check('K32 无凭据 → kind no-key + code', [noKey.error.kind, noKey.error.code], ['no-key', 'subscription.kimi-not-configured'])
  check('K33 无凭据 → 中文字案', noKey.error.message, zhDict['error.subscription.kimi-not-configured'])
  ok('K34 无凭据 → 文案含 KIMI_CODING_API_KEY', noKey.error.message.indexOf('KIMI_CODING_API_KEY') >= 0)
  ok('K35 无凭据 → 不发起任何请求', noKeyH.calls.length === 0)
  check('K36 resolveKimiCodingKey 无凭据/无 env → null', await noKeyH.api.resolveKimiCodingKey(), null)

  // 中国站成功
  const cnH = makeHarness(u, { creds: { KIMI_API_KEY: KIMI_KEY }, responses: [response(200, RESULT_BODY)] })
  const cn = record(await cnH.api.fetchKimi())
  check('K37 中国站成功只发一次请求', cnH.calls.length, 1)
  check('K38 首个端点 = api.kimi.com/coding/v1/usages', cnH.calls[0].url, CN_URL)
  check('K39 请求 Bearer API Key', cnH.calls[0].init.headers.Authorization, 'Bearer ' + KIMI_KEY)
  check('K40 请求 Accept: application/json', cnH.calls[0].init.headers.Accept, 'application/json')
  ok('K41 请求带 AbortSignal 超时信号', !!cnH.calls[0].init.signal)
  ok('K42 请求不带 method（GET 语义）', cnH.calls[0].init.method === undefined)
  check('K43 成功 → provider=kimi-coding', cn.data.provider, 'kimi-coding')
  check('K44 成功 → 两个窗口 30% / 20%', cn.data.windows.map(function (w) { return w.usedPercent }), [30, 20])
  check('K45 成功 → plan 为 null', cn.data.plan, null)
  ok('K46 成功结果不含 key', JSON.stringify(cn).indexOf(KIMI_KEY) < 0)

  // 凭据优先级 / 形态
  const prefH = makeHarness(u, {
    creds: { KIMI_API_KEY: 'key-kimi', KIMI_CODING_API_KEY: 'key-coding', MOONSHOT_API_KEY: 'key-moonshot' },
    responses: [response(200, RESULT_BODY)],
  })
  await prefH.api.fetchKimi()
  check('K47 KIMI_API_KEY 优先（DSH provider 环境变量名）', prefH.calls[0].init.headers.Authorization, 'Bearer key-kimi')
  const codingKeyH = makeHarness(u, { creds: { KIMI_CODING_API_KEY: 'key-coding' }, responses: [response(200, RESULT_BODY)] })
  await codingKeyH.api.fetchKimi()
  check('K48 回退 KIMI_CODING_API_KEY', codingKeyH.calls[0].init.headers.Authorization, 'Bearer key-coding')
  const moonH = makeHarness(u, { creds: { MOONSHOT_API_KEY: 'key-moonshot' }, responses: [response(200, RESULT_BODY)] })
  await moonH.api.fetchKimi()
  check('K49 回退 MOONSHOT_API_KEY', moonH.calls[0].init.headers.Authorization, 'Bearer key-moonshot')
  const codeKeyH = makeHarness(u, { creds: { KIMI_CODE_API_KEY: 'key-code' }, responses: [response(200, RESULT_BODY)] })
  await codeKeyH.api.fetchKimi()
  check('K50 回退 KIMI_CODE_API_KEY', codeKeyH.calls[0].init.headers.Authorization, 'Bearer key-code')
  const envH = makeHarness(u, { creds: {}, env: { KIMI_API_KEY: 'env-kimi' }, responses: [response(200, RESULT_BODY)] })
  await envH.api.fetchKimi()
  check('K51 凭据服务缺失时回退 process.env', envH.calls[0].init.headers.Authorization, 'Bearer env-kimi')
  const oauthH = makeHarness(u, { creds: { 'kimi-coding': { accessToken: 'oauth-access-token' } }, responses: [response(200, RESULT_BODY)] })
  await oauthH.api.fetchKimi()
  check('K52 对象凭据取 accessToken（订阅 OAuth）', oauthH.calls[0].init.headers.Authorization, 'Bearer oauth-access-token')
  const oauthSnakeH = makeHarness(u, { creds: { 'kimi-coding': { access_token: 'oauth-snake-token' } }, responses: [response(200, RESULT_BODY)] })
  await oauthSnakeH.api.fetchKimi()
  check('K53 对象凭据也接受 access_token 字段', oauthSnakeH.calls[0].init.headers.Authorization, 'Bearer oauth-snake-token')
  const ctxEnvH = makeHarness(u, { creds: { KIMI_API_KEY: 'ctx-key' }, env: { KIMI_API_KEY: 'env-key' }, responses: [response(200, RESULT_BODY)] })
  await ctxEnvH.api.fetchKimi()
  check('K54 凭据服务优先于环境变量', ctxEnvH.calls[0].init.headers.Authorization, 'Bearer ctx-key')
  const emptyStringH = makeHarness(u, { creds: { KIMI_API_KEY: '' }, env: {}, responses: [] })
  check('K55 空字符串凭据视为未配置 → null', await emptyStringH.api.resolveKimiCodingKey(), null)

  // 401 → 国际站
  const fallbackH = makeHarness(u, { creds: { KIMI_API_KEY: KIMI_KEY }, responses: [response(401, {}), response(200, RESULT_BODY)] })
  const fallback = record(await fallbackH.api.fetchKimi())
  check('K56 CN 401 后仍尝试国际站', fallbackH.calls.map(function (c) { return c.url }), [CN_URL, INTL_URL])
  check('K57 国际站成功后返回两个窗口', fallback.data && fallback.data.windows.length, 2)

  // 两站 401 / 403 → auth
  const unauthorizedH = makeHarness(u, { creds: { KIMI_API_KEY: KIMI_KEY }, responses: [response(401, {}), response(401, {})] })
  const unauthorized = record(await unauthorizedH.api.fetchKimi())
  check('K58 两站均 401 → kind auth + kimi-auth-failed', [unauthorized.error.kind, unauthorized.error.code],
    ['auth', 'subscription.kimi-auth-failed'])
  check('K59 鉴权失败 → 中文字案', unauthorized.error.message, zhDict['error.subscription.kimi-auth-failed'])
  ok('K60 鉴权失败文案不含 key', JSON.stringify(unauthorized).indexOf(KIMI_KEY) < 0)
  const forbiddenH = makeHarness(u, { creds: { KIMI_API_KEY: KIMI_KEY }, responses: [response(403, {}), response(403, {})] })
  const forbidden = record(await forbiddenH.api.fetchKimi())
  check('K61 403 同样归 auth', [forbidden.error.kind, forbidden.error.code], ['auth', 'subscription.kimi-auth-failed'])
  const mixedAuthH = makeHarness(u, { creds: { KIMI_API_KEY: KIMI_KEY }, responses: [response(401, {}), response(500, {})] })
  const mixedAuth = record(await mixedAuthH.api.fetchKimi())
  check('K62 401 与 5xx 混合时 auth 优先', mixedAuth.error.kind, 'auth')

  // 5xx / 不可解析数据降级
  const recoverH = makeHarness(u, { creds: { KIMI_API_KEY: KIMI_KEY }, responses: [response(500, {}), response(200, RESULT_BODY)] })
  const recover = record(await recoverH.api.fetchKimi())
  check('K63 CN 5xx 后继续尝试国际站并成功', recover.data && recover.data.windows.length, 2)
  const both500H = makeHarness(u, { creds: { KIMI_API_KEY: KIMI_KEY }, responses: [response(500, {}), response(500, {})] })
  const both500 = record(await both500H.api.fetchKimi())
  check('K64 两站均 500 → kind http + request.http', [both500.error.kind, both500.error.code], ['http', 'request.http'])
  check('K65 两站均 500 → 文案带状态码', both500.error.message, zhDict['error.request.http'].replace('{status}', '500'))
  const badThenOkH = makeHarness(u, { creds: { KIMI_API_KEY: KIMI_KEY }, responses: [response(200, {}), response(200, RESULT_BODY)] })
  const badThenOk = record(await badThenOkH.api.fetchKimi())
  check('K66 CN 200 无窗口 → 继续国际站并成功', badThenOk.data && badThenOk.data.windows.length, 2)
  const badH = makeHarness(u, { creds: { KIMI_API_KEY: KIMI_KEY }, responses: [response(200, {}), response(200, {})] })
  const bad = record(await badH.api.fetchKimi())
  check('K67 两站 200 均无窗口 → kind parse + kimi-unrecognized', [bad.error.kind, bad.error.code],
    ['parse', 'subscription.kimi-unrecognized'])
  check('K68 无法识别中文字案', bad.error.message, zhDict['error.subscription.kimi-unrecognized'])
  const netThenOkH = makeHarness(u, { creds: { KIMI_API_KEY: KIMI_KEY }, responses: [networkError('fetch failed'), response(200, RESULT_BODY)] })
  const netThenOk = record(await netThenOkH.api.fetchKimi())
  check('K69 首站网络异常后国际站成功', netThenOk.data && netThenOk.data.windows.length, 2)
  const netH = makeHarness(u, { creds: { KIMI_API_KEY: KIMI_KEY }, responses: [networkError('first fail'), networkError('second fail')] })
  const net = record(await netH.api.fetchKimi())
  check('K70 两站网络异常 → kind exception + 最后一条信息', [net.error.kind, net.error.message], ['exception', 'second fail'])
  ok('K71 所有结果均不含 key', results.every(function (r) { return JSON.stringify(r).indexOf(KIMI_KEY) < 0 }), results.length + ' 个结果')

  // ================= K3) 常量与接线一致性 =================
  ok('K72 SUBSCRIPTION_PROVIDERS 含 kimi-coding', SUBSCRIPTION_PROVIDERS.indexOf('kimi-coding') >= 0)
  ok('K73 DSH_PRESET_PROVIDERS 含 kimi-coding', DSH_PRESET_PROVIDERS.indexOf('kimi-coding') >= 0)
  check('K74 PROVIDER_IDENTITY[kimi-coding]：account 与 subscription 均独立', PROVIDER_IDENTITY['kimi-coding'],
    { account: 'kimi-coding', subscription: 'kimi-coding', billing: null })
  ok('K75 host.js：订阅源接线 kimi-coding → fetchKimiCodingUsage',
    hostSrc.indexOf("'kimi-coding': { fetch: fetchKimiCodingUsage }") >= 0)
  ok('K76 host.js：展示名走 ui.kimiCoding 字典键', hostSrc.indexOf("'kimi-coding': t('ui.kimiCoding')") >= 0)
  const serviceFn = extractClientFnBody('subscriptionServiceName')
  ok('K77 client-bundle：subscriptionServiceName 含 kimi-coding 品牌分支',
    serviceFn.indexOf("provider === 'kimi-coding'") >= 0 && serviceFn.indexOf("t('ui.kimiCoding')") >= 0)
  check('K78 端点常量顺序：CN 站在前、国际站在后', KIMI_CODING_BASE_URLS, ['https://api.kimi.com/coding/v1', 'https://api.kimi.ai/coding/v1'])
  check('K79 凭据名常量优先级（KIMI_API_KEY 为 DSH provider 环境变量名）', KIMI_CODING_CREDENTIAL_NAMES,
    ['KIMI_API_KEY', 'KIMI_CODING_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_CODE_API_KEY', 'kimi-coding'])
  const KIMI_CODES = ['subscription.kimi-not-configured', 'subscription.kimi-auth-failed', 'subscription.kimi-unrecognized']
  ok('K80 三个稳定 code 中英齐备且互不相同', KIMI_CODES.every(function (code) {
    const zh = zhDict['error.' + code], en = enDict['error.' + code]
    return typeof zh === 'string' && typeof en === 'string' && zh !== en
  }))
  ok('K81 品牌名 ui.kimiCoding 中英一致（品牌名不翻译）',
    zhDict['ui.kimiCoding'] === 'Kimi Coding' && enDict['ui.kimiCoding'] === 'Kimi Coding')
  ok('K82 宿主 kimi 错误对象一律带稳定 code', hostSrc.split('\n').every(function (line) {
    if (!/error:\s*\{[^}]*message:\s*t\('error\.subscription\.kimi-/.test(line)) return true
    return /code:/.test(line)
  }))
  ok('K83 host.js 未引用 KIMI_* 的硬编码密钥值', hostSrc.indexOf('sk-kimi-') < 0)

  console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项失败') + '：' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(function (err) {
  console.error('测试装置异常：' + String((err && err.stack) || err))
  process.exit(1)
})
