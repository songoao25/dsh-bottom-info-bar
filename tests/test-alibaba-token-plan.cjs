// 阿里 Token Plan 宿主适配单测（v1.22.0）
// 覆盖：
//  A) ACS3 签名：官方测试向量（CanonicalRequest 逐字节 / SHA256 / 签名 / Authorization）+ host 不发送
//  B) parseAlibabaTokenPlanUsage：多层信封 / 二次编码 / 0–1 与 0–100 双形态 / 秒毫秒 / 已知窗口 / 未知时长跳过
//  C) parseAlibabaSubscriptionStats：席位 Credits 求和换算 / 最早刷新时刻 / 到期时间 / 空 Items 与 Success=false
//  D) parseKimiCodingUsages：limits[] 窗口时长 / 顶层 usage / 数值字符串 / 重置时间 / 无窗口降级
//  E) fetchAlibabaTokenPlanUsage：凭据 / stats 直出 / stats 403 回退 CLI 令牌 / 表单与 URL / 国际站 / 错误分类
//  F) fetchKimiCodingUsage：凭据优先级 / 先 CN 后国际 / 401 回退 / 两站失败降级
//  G) 常量一致性：constants.js 集合与身份表 / host.js 订阅源与展示名 / client-bundle 品牌分支 / locale 键
// 用法：node tests/test-alibaba-token-plan.cjs
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { createHash } = require('node:crypto')
const { dictionaries } = require('./locale-fixture.cjs')

const root = join(__dirname, '..')
const hostSrc = readFileSync(join(root, 'src', 'host.js'), 'utf8')
const constantsSrc = readFileSync(join(root, 'src', 'constants.js'), 'utf8')
const clientSrc = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')
const zhDict = dictionaries.zh
const enDict = dictionaries.en

// ---- 从正式源码抽出模块级常量（apply 内 fetch 层要用；纯函数走 __usageInternals 真身） ----
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
const ALIBABA_TOKEN_PLAN_REGIONS = eval('(' + extractBraced(hostSrc, 'const ALIBABA_TOKEN_PLAN_REGIONS = ') + ')')
const ALIBABA_ACS3_VERSION = (hostSrc.match(/const ALIBABA_ACS3_VERSION = '([^']+)'/) || [])[1]
const ALIBABA_ACS3_ALGORITHM = (hostSrc.match(/const ALIBABA_ACS3_ALGORITHM = '([^']+)'/) || [])[1]
const ALIBABA_TOKEN_PLAN_USAGE_API = (hostSrc.match(/const ALIBABA_TOKEN_PLAN_USAGE_API = '([^']+)'/) || [])[1]
const KIMI_CODING_BASE_URLS = eval('(' + extractBracketed(hostSrc, 'const KIMI_CODING_BASE_URLS = ') + ')')
const KIMI_CODING_CREDENTIAL_NAMES = eval('(' + extractBracketed(hostSrc, 'const KIMI_CODING_CREDENTIAL_NAMES = ') + ')')
const KIMI_CODING_RECORD_KEY = (hostSrc.match(/const KIMI_CODING_RECORD_KEY = '([^']+)'/) || [])[1]
const HTTP_TIMEOUT_MS = Number((hostSrc.match(/const HTTP_TIMEOUT_MS = (\d+)/) || [])[1])
const SUBSCRIPTION_PROVIDERS = eval('(' + extractBracketed(constantsSrc, 'export const SUBSCRIPTION_PROVIDERS = ') + ')')
const DSH_PRESET_PROVIDERS = eval('(' + extractBracketed(constantsSrc, 'export const DSH_PRESET_PROVIDERS = ') + ')')
const PROVIDER_IDENTITY = eval('(' + extractBraced(constantsSrc, 'export const PROVIDER_IDENTITY = ') + ')')

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const AK_ID = 'LTAI-test-access-key-id'
const AK_SECRET = 'alibaba-test-secret-value-never-leak'
const CLI_TOKEN = 'cli-token-value-never-leak'
const KIMI_KEY = 'sk-kimi-test-key-never-leak'

// 顶层 t() 依赖宿主 locale 服务：单测用真实中文字典做替身（缺键直接抛错，防漏键）
function tStub(key, params) {
  const raw = zhDict[key]
  if (typeof raw !== 'string') throw new Error('未预期的 i18n key: ' + key)
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, function (m, name) {
    return params[name] !== undefined ? String(params[name]) : m
  })
}

// fetch 桩：按调用顺序消费 responses[]；未预期的请求直接抛错（定位「多发了请求」）
function makeRes(status, body) {
  return { ok: status >= 200 && status < 300, status: status, json: async function () { return body } }
}
function response(status, body) {
  return function () { return Promise.resolve(makeRes(status, body)) }
}
function networkError(message) {
  return function () { return Promise.reject(new Error(message)) }
}

// fetch 层装置：抽出真身 fetch 函数，注入桩 ctx / fetch / 常量；纯函数用 __usageInternals 真身
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
    '(function (ctx, t, windowLabels, fetch, AbortSignal, randomUUID, process,'
    + ' alibabaAcs3SignedRequest, alibabaExpandEmbeddedJson, alibabaFormEncode,'
    + ' parseAlibabaSubscriptionStats, parseAlibabaTokenPlanUsage, parseKimiCodingUsages) {'
    + 'const HTTP_TIMEOUT_MS = ' + HTTP_TIMEOUT_MS + ';'
    + 'const ALIBABA_TOKEN_PLAN_REGIONS = ' + JSON.stringify(ALIBABA_TOKEN_PLAN_REGIONS) + ';'
    + 'const ALIBABA_ACS3_VERSION = ' + JSON.stringify(ALIBABA_ACS3_VERSION) + ';'
    + 'const ALIBABA_TOKEN_PLAN_USAGE_API = ' + JSON.stringify(ALIBABA_TOKEN_PLAN_USAGE_API) + ';'
    + 'const KIMI_CODING_BASE_URLS = ' + JSON.stringify(KIMI_CODING_BASE_URLS) + ';'
    + 'const KIMI_CODING_CREDENTIAL_NAMES = ' + JSON.stringify(KIMI_CODING_CREDENTIAL_NAMES) + ';'
    + 'const KIMI_CODING_RECORD_KEY = ' + JSON.stringify(KIMI_CODING_RECORD_KEY) + ';'
    + extractFn('timeoutSignal')
    + extractFn('resolveCredentialValue')
    + extractFn('resolveWithFallback')
    + extractFn('processEnvValue')
    + extractFn('resolveAlibabaAccessKeys')
    + extractFn('alibabaRegionConfig')
    + extractFn('alibabaResponseErrorCode')
    + extractFn('alibabaCredentialError')
    + extractFn('alibabaSignedOpenApiRequest')
    + extractFn('alibabaConsoleApiRequest')
    + extractFn('alibabaGatewayError')
    + extractFn('fetchAlibabaTokenPlanUsage')
    + extractFn('readKimiCodingRecordToken')
    + extractFn('resolveKimiCodingKey')
    + extractFn('fetchKimiCodingUsage')
    + 'return { resolveAlibabaAccessKeys: resolveAlibabaAccessKeys, resolveKimiCodingKey: resolveKimiCodingKey,'
    + ' fetchAlibaba: fetchAlibabaTokenPlanUsage, fetchKimi: fetchKimiCodingUsage } })'
  )
  const api = factory(
    ctx, tStub, WINDOW_LABELS, fetchImpl, AbortSignal, require('node:crypto').randomUUID, { env: Object.assign({}, env) },
    u.alibabaAcs3SignedRequest, u.alibabaExpandEmbeddedJson, u.alibabaFormEncode,
    u.parseAlibabaSubscriptionStats, u.parseAlibabaTokenPlanUsage, u.parseKimiCodingUsages
  )
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

// 响应样例（结构照抄契约文档）
const STATS_OK_BODY = {
  Success: true,
  Code: '200',
  Message: '',
  Data: {
    SubscriptionStartTime: 1700000000000,
    SubscriptionEndTime: 1790920800000,
    Items: [{ SeatType: 'standard', SeatRefreshTime: 1780000000000, SeatCredits: 100, SeatRemainingCredits: 40 }],
  },
}
const STATS_EMPTY_BODY = { Success: true, Code: '200', Data: { Items: [] } }
const TOKEN_BODY = { cliAccessToken: CLI_TOKEN }
const USAGE_BODY = {
  code: '200',
  successResponse: true,
  data: { DataV2: { success: true, httpStatus: 200, data: { success: true, data: { per1MonthPercentage: 0.42, per1MonthResetTime: 1761926400000 } } } },
}
const USAGE_INNER = { per1MonthPercentage: 0.42, per1MonthResetTime: 1761926400000 }

async function main() {
  const { __usageInternals: u } = await import(pathToFileURL(join(root, 'src', 'host.js')).href)
  const WL = WINDOW_LABELS
  const CN_STATS_URL = 'https://modelstudio.cn-beijing.aliyuncs.com/tokenplan/subscription/stats'
  const INTL_STATS_URL = 'https://modelstudio.ap-southeast-1.aliyuncs.com/tokenplan/subscription/stats'
  const CN_TOKEN_URL = 'https://modelstudio.cn-beijing.aliyuncs.com/modelstudio/cli/generateAccessToken'
  const INTL_TOKEN_URL = 'https://modelstudio.ap-southeast-1.aliyuncs.com/modelstudio/cli/generateAccessToken'
  const CN_GATEWAY_PREFIX = 'https://bailian-cs.console.aliyun.com/cli/api.json?'
  const INTL_GATEWAY_PREFIX = 'https://bailian-singapore-cs.alibabacloud.com/cli/api.json?'

  // ================= A) ACS3 官方测试向量 =================
  const VECTOR = {
    accessKeyId: 'YourAccessKeyId',
    accessKeySecret: 'YourAccessKeySecret',
    method: 'POST',
    path: '/',
    query: 'ImageId=win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd&RegionId=cn-shanghai',
    body: '',
    headers: {
      host: 'ecs.cn-shanghai.aliyuncs.com',
      'x-acs-action': 'RunInstances',
      'x-acs-content-sha256': EMPTY_SHA,
      'x-acs-date': '2023-10-26T10:22:32Z',
      'x-acs-signature-nonce': '3156853299f313e23d1673dc12e1703d',
      'x-acs-version': '2014-05-26',
    },
  }
  const VECTOR_CANONICAL = [
    'POST',
    '/',
    'ImageId=win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd&RegionId=cn-shanghai',
    'host:ecs.cn-shanghai.aliyuncs.com',
    'x-acs-action:RunInstances',
    'x-acs-content-sha256:' + EMPTY_SHA,
    'x-acs-date:2023-10-26T10:22:32Z',
    'x-acs-signature-nonce:3156853299f313e23d1673dc12e1703d',
    'x-acs-version:2014-05-26',
    '',
    'host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version',
    EMPTY_SHA,
  ].join('\n')
  const canonical = u.alibabaAcs3CanonicalRequest({
    method: VECTOR.method,
    path: VECTOR.path,
    query: VECTOR.query,
    headers: VECTOR.headers,
    bodyHash: EMPTY_SHA,
  })
  check('A1 CanonicalRequest 逐字节匹配官方向量（含 headers 与 SignedHeaders 之间一个空行）', canonical, VECTOR_CANONICAL)
  check('A2 Hex(SHA256(CanonicalRequest)) = 7ea06492…', createHash('sha256').update(canonical).digest('hex'),
    '7ea06492da5221eba5297e897ce16e55f964061054b7695beedaac1145b1e259')
  const signed = u.alibabaAcs3SignedRequest(VECTOR)
  check('A3 空 body hash = e3b0c442…', signed.bodyHash, EMPTY_SHA)
  check('A4 签名 = 06563a9e…（官方向量）', signed.signature,
    '06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0')
  check('A5 Authorization 串逐字匹配官方向量', signed.headers.authorization,
    'ACS3-HMAC-SHA256 Credential=YourAccessKeyId,SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0')
  ok('A6 host 只参与签名、不出现在发送头里', !Object.prototype.hasOwnProperty.call(signed.headers, 'host'),
    JSON.stringify(Object.keys(signed.headers)))
  ok('A7 发送头保留 x-acs-content-sha256 且为小写名', signed.headers['x-acs-content-sha256'] === EMPTY_SHA)
  // 值前后空白按 trim 处理；头名按字母序（契约要求入参键本身已是小写）
  const normalized = u.alibabaAcs3CanonicalRequest({
    method: 'GET',
    path: '/tokenplan/subscription/stats',
    query: '',
    headers: { host: ' modelstudio.cn-beijing.aliyuncs.com ', 'x-acs-version': '2026-02-10', 'x-acs-action': 'GetSubscriptionStats' },
    bodyHash: EMPTY_SHA,
  })
  ok('A8 头值 trim、按字母序拼接（host;x-acs-action;x-acs-version）',
    normalized.indexOf('host:modelstudio.cn-beijing.aliyuncs.com\nx-acs-action:GetSubscriptionStats\nx-acs-version:2026-02-10\n') > 0
    && normalized.indexOf('\nhost;x-acs-action;x-acs-version\n') > 0, normalized)
  check('A9 缺省 path 回退 /、缺省 query 为空串（空头仍保留分隔空行）',
    u.alibabaAcs3CanonicalRequest({ method: 'GET', headers: {}, bodyHash: EMPTY_SHA }),
    'GET' + '\n' + '/' + '\n' + '' + '\n' + '' + '\n' + '' + '\n' + EMPTY_SHA)
  // RFC3986 表单编码（网关表单依赖）
  check('A10 空格 → %20（不是 +）', u.alibabaFormEncode('a b'), 'a%20b')
  check('A11 !\'()* 全部百分号编码', u.alibabaFormEncode("!'()*"), '%21%27%28%29%2A')
  check('A12 斜杠 → %2F', u.alibabaFormEncode('/tokenplan/personal'), '%2Ftokenplan%2Fpersonal')
  check('A13 ~ 与字母数字不编码、中文 UTF-8 编码', u.alibabaFormEncode('~Az9-_.中文'), '~Az9-_.%E4%B8%AD%E6%96%87')
  // 二次编码展开
  check('A14 嵌套字符串 JSON 递归展开', u.alibabaExpandEmbeddedJson({ a: '{"b":{"c":1}}' }, 0), { a: { b: { c: 1 } } })
  check('A15 非 JSON 字符串原样保留', u.alibabaExpandEmbeddedJson({ a: 'not json', b: '{bad' }, 0), { a: 'not json', b: '{bad' })
  check('A16 数组内字符串同样展开', u.alibabaExpandEmbeddedJson(['{"x":2}'], 0), [{ x: 2 }])
  check('A17 null/数字/布尔原样返回', u.alibabaExpandEmbeddedJson([null, 3, true], 0), [null, 3, true])

  // ================= B) parseAlibabaTokenPlanUsage =================
  const usage = u.parseAlibabaTokenPlanUsage({
    code: '200',
    data: { DataV2: { success: true, data: { success: true, data: { per1MonthPercentage: 0.42, per1MonthResetTime: 1761926400000 } } } },
  }, WL)
  ok('B1 完整信封 data.DataV2.data.data 解析成功', !!usage && usage.windows.length === 1, JSON.stringify(usage))
  check('B2 0.42 → 42%（已用方向）', usage && usage.windows[0].usedPercent, 42)
  check('B3 窗口键 monthly + 标签跟随字典', usage && [usage.windows[0].key, usage.windows[0].label], ['monthly', '月'])
  check('B4 毫秒重置时间直通', usage && usage.windows[0].resetsAt, 1761926400000)
  check('B5 plan 为 null（接口无套餐名）', usage && usage.plan, null)
  check('B6 少一层信封 data.DataV2.data 可解析',
    u.parseAlibabaTokenPlanUsage({ data: { DataV2: { data: { per1MonthPercentage: 0.1 } } } }, WL).windows[0].usedPercent, 10)
  check('B7 少两层信封 data.data 可解析',
    u.parseAlibabaTokenPlanUsage({ data: { data: { per1MonthPercentage: 0.2 } } }, WL).windows[0].usedPercent, 20)
  check('B8 data.DataV2 直接是业务层可解析',
    u.parseAlibabaTokenPlanUsage({ data: { DataV2: { per1MonthPercentage: 0.3 } } }, WL).windows[0].usedPercent, 30)
  check('B9 二次编码字符串信封（DataV2.data 是 JSON 字符串）',
    u.parseAlibabaTokenPlanUsage({ data: { DataV2: { data: JSON.stringify({ per1MonthPercentage: 0.1, per1MonthResetTime: 1761926400000 }) } } }, WL).windows[0].usedPercent, 10)
  check('B10 10 位秒级重置时间 ×1000',
    u.parseAlibabaTokenPlanUsage({ data: { data: { per1MonthPercentage: 0.5, per1MonthResetTime: 1761926400 } } }, WL).windows[0].resetsAt, 1761926400000)
  check('B11 ISO 重置时间 → 毫秒',
    u.parseAlibabaTokenPlanUsage({ data: { data: { per1MonthPercentage: 0.5, per1MonthResetTime: '2026-11-01T00:00:00Z' } } }, WL).windows[0].resetsAt,
    Date.parse('2026-11-01T00:00:00Z'))
  check('B12 0–100 形态 42 → 42%',
    u.parseAlibabaTokenPlanUsage({ data: { data: { per1MonthPercentage: 42 } } }, WL).windows[0].usedPercent, 42)
  check('B13 字符串百分比 "0.42" → 42%',
    u.parseAlibabaTokenPlanUsage({ data: { data: { per1MonthPercentage: '0.42' } } }, WL).windows[0].usedPercent, 42)
  check('B14 百分比 0 → 0%', u.parseAlibabaTokenPlanUsage({ data: { data: { per1MonthPercentage: 0 } } }, WL).windows[0].usedPercent, 0)
  check('B15 百分比 1 → 100%（0–1 形态上界）',
    u.parseAlibabaTokenPlanUsage({ data: { data: { per1MonthPercentage: 1 } } }, WL).windows[0].usedPercent, 100)
  check('B16 超界 150 钳制 100', u.parseAlibabaTokenPlanUsage({ data: { data: { per1MonthPercentage: 150 } } }, WL).windows[0].usedPercent, 100)
  check('B17 负数百分比 → 整条跳过 → null',
    u.parseAlibabaTokenPlanUsage({ data: { data: { per1MonthPercentage: -0.1 } } }, WL), null)
  check('B18 5h + 周历史窗口同时产出（顺序固定）',
    u.parseAlibabaTokenPlanUsage({
      data: { data: { per5HourPercentage: 0.3, per5HourResetTime: 1761926400000, per1WeekPercentage: 0.2, per1WeekResetTime: 1762926400000 } },
    }, WL).windows.map(function (w) { return [w.key, w.usedPercent] }),
    [['five_hour', 30], ['seven_day', 20]])
  check('B19 5h/周窗口各自 resetsAt',
    u.parseAlibabaTokenPlanUsage({
      data: { data: { per5HourPercentage: 0.3, per5HourResetTime: 1761926400000, per1WeekPercentage: 0.2, per1WeekResetTime: 1762926400000 } },
    }, WL).windows.map(function (w) { return w.resetsAt }),
    [1761926400000, 1762926400000])
  check('B20 未知时长 per10Hour 跳过、只保留月度',
    u.parseAlibabaTokenPlanUsage({ data: { data: { per10HourPercentage: 0.5, per1MonthPercentage: 0.2 } } }, WL).windows.map(function (w) { return w.key }),
    ['monthly'])
  check('B21 只有未知时长 → null',
    u.parseAlibabaTokenPlanUsage({ data: { data: { per10HourPercentage: 0.5 } } }, WL), null)
  check('B22 只有 ResetTime 没有 Percentage → null（窗口必须有已用比例）',
    u.parseAlibabaTokenPlanUsage({ data: { data: { per1MonthResetTime: 1761926400000 } } }, WL), null)
  check('B23 无任何 per* 字段 → null', u.parseAlibabaTokenPlanUsage({ code: '200', data: { DataV2: { success: true } } }, WL), null)
  check('B24 null/字符串/数组 body → null',
    [u.parseAlibabaTokenPlanUsage(null, WL), u.parseAlibabaTokenPlanUsage('oops', WL), u.parseAlibabaTokenPlanUsage([], WL)],
    [null, null, null])
  check('B25 缺 resetsAt → null 但窗口保留',
    u.parseAlibabaTokenPlanUsage({ data: { data: { per1MonthPercentage: 0.2 } } }, WL).windows[0].resetsAt, null)
  check('B26 非法百分比字符串 "abc" → null',
    u.parseAlibabaTokenPlanUsage({ data: { data: { per1MonthPercentage: 'abc' } } }, WL), null)
  check('B27 alibabaTokenPlanUsagePayload 定位到含 per*Percentage 的那层',
    Object.keys(u.alibabaTokenPlanUsagePayload({ data: { DataV2: { data: { per1MonthPercentage: 0.1 } } } })),
    ['per1MonthPercentage'])
  check('B28 alibabaTokenPlanUsagePayload 无业务层 → null',
    u.alibabaTokenPlanUsagePayload({ code: '200', data: { DataV2: { success: true } } }), null)

  // ================= C) parseAlibabaSubscriptionStats =================
  const stats = u.parseAlibabaSubscriptionStats(STATS_OK_BODY, WL)
  check('C1 席位 100/40 → 60% 已用', stats && stats.windows[0].usedPercent, 60)
  check('C2 窗口 key/label = monthly/月', stats && [stats.windows[0].key, stats.windows[0].label], ['monthly', '月'])
  check('C3 resetsAt 取 SeatRefreshTime', stats && stats.windows[0].resetsAt, 1780000000000)
  check('C4 expiryAt 取 SubscriptionEndTime', stats && stats.expiryAt, 1790920800000)
  check('C5 多席位 Credits 求和换算：[100/40, 50/10] → 67%',
    u.parseAlibabaSubscriptionStats({ Success: true, Data: { Items: [
      { SeatCredits: 100, SeatRemainingCredits: 40 },
      { SeatCredits: 50, SeatRemainingCredits: 10 },
    ] } }, WL).windows[0].usedPercent, 67)
  check('C6 resetsAt 取最早 SeatRefreshTime',
    u.parseAlibabaSubscriptionStats({ Success: true, Data: { Items: [
      { SeatCredits: 100, SeatRemainingCredits: 40, SeatRefreshTime: 1780000000000 },
      { SeatCredits: 100, SeatRemainingCredits: 40, SeatRefreshTime: 1770000000000 },
    ] } }, WL).windows[0].resetsAt, 1770000000000)
  check('C7 数值字符串同样接受',
    u.parseAlibabaSubscriptionStats({ Data: { Items: [{ SeatCredits: '100', SeatRemainingCredits: '40' }] } }, WL).windows[0].usedPercent, 60)
  check('C8 剩余超总额按总额钳制（0% 已用）',
    u.parseAlibabaSubscriptionStats({ Data: { Items: [{ SeatCredits: 100, SeatRemainingCredits: 400 }] } }, WL).windows[0].usedPercent, 0)
  check('C9 10 位秒级 SubscriptionEndTime → 毫秒',
    u.parseAlibabaSubscriptionStats({ Data: { Items: [{ SeatCredits: 10, SeatRemainingCredits: 5 }], SubscriptionEndTime: 1790920800 } }, WL).expiryAt,
    1790920800000)
  check('C10 全部席位额度耗尽 → 100% 已用（不是 null）',
    u.parseAlibabaSubscriptionStats({ Data: { Items: [{ SeatCredits: 100, SeatRemainingCredits: 0 }] } }, WL).windows[0].usedPercent, 100)
  check('C11 Items 为空 → null（个人版无席位数据时交给控制台网关）',
    u.parseAlibabaSubscriptionStats(STATS_EMPTY_BODY, WL), null)
  check('C12 Success=false → null',
    u.parseAlibabaSubscriptionStats({ Success: false, Data: { Items: [{ SeatCredits: 100, SeatRemainingCredits: 40 }] } }, WL), null)
  check('C13 非法条目全部跳过 → null',
    u.parseAlibabaSubscriptionStats({ Success: true, Data: { Items: [null, 'x', { SeatCredits: 'oops', SeatRemainingCredits: 1 }] } }, WL), null)
  check('C14 SeatCredits 为 0 → null（不能除零）',
    u.parseAlibabaSubscriptionStats({ Data: { Items: [{ SeatCredits: 0, SeatRemainingCredits: 0 }] } }, WL), null)
  check('C15 缺 Data / null / 字符串 → null',
    [u.parseAlibabaSubscriptionStats({ Success: true }, WL), u.parseAlibabaSubscriptionStats(null, WL), u.parseAlibabaSubscriptionStats('oops', WL)],
    [null, null, null])
  check('C16 SeatRefreshTime ISO 字符串 → 毫秒',
    u.parseAlibabaSubscriptionStats({ Data: { Items: [{ SeatCredits: 10, SeatRemainingCredits: 5, SeatRefreshTime: '2026-11-01T00:00:00Z' }] } }, WL).windows[0].resetsAt,
    Date.parse('2026-11-01T00:00:00Z'))
  check('C17 缺 SeatRefreshTime → resetsAt null 但窗口保留',
    u.parseAlibabaSubscriptionStats({ Data: { Items: [{ SeatCredits: 10, SeatRemainingCredits: 5 }] } }, WL).windows[0].resetsAt, null)

  // ================= D) parseKimiCodingUsages =================
  const kimi = u.parseKimiCodingUsages({
    limits: [{ window: { duration: 300 }, detail: { limit: '100', remaining: '80', resetTime: '2026-02-07T12:32:50.757Z' } }],
    usage: { limit: '1000', remaining: '900', resetTime: 1762000000000 },
  }, WL)
  ok('D1 limits[] 5h 与顶层 usage 周窗口共两个', !!kimi && kimi.windows.length === 2, JSON.stringify(kimi))
  check('D2 窗口顺序 five_hour → seven_day', kimi && kimi.windows.map(function (w) { return w.key }), ['five_hour', 'seven_day'])
  check('D3 5h used = 20%（limit 100 - remaining 80）', kimi && kimi.windows[0].usedPercent, 20)
  check('D4 周 used = 10%（1000 - 900）', kimi && kimi.windows[1].usedPercent, 10)
  check('D5 标签跟随字典 [5 小时, 周]', kimi && kimi.windows.map(function (w) { return w.label }), ['5 小时', '周'])
  check('D6 ISO resetTime → 毫秒', kimi && kimi.windows[0].resetsAt, Date.parse('2026-02-07T12:32:50.757Z'))
  check('D7 13 位毫秒 resetTime 直通', kimi && kimi.windows[1].resetsAt, 1762000000000)
  check('D8 plan 为 null', kimi && kimi.plan, null)
  check('D9 duration 10080 → seven_day',
    u.parseKimiCodingUsages({ limits: [{ window: { duration: 10080 }, detail: { limit: 100, remaining: 90 } }] }, WL).windows[0].key, 'seven_day')
  check('D10 单条 limits 缺 window 时长 → 按 5 小时兜底',
    u.parseKimiCodingUsages({ limits: [{ detail: { limit: 100, remaining: 70 } }] }, WL).windows[0].usedPercent, 30)
  check('D11 多条 limits 缺时长 → 无法归类 → null',
    u.parseKimiCodingUsages({ limits: [{ detail: { limit: 100, remaining: 70 } }, { detail: { limit: 100, remaining: 60 } }] }, WL), null)
  check('D12 只有顶层 usage → 周窗口',
    u.parseKimiCodingUsages({ usage: { limit: 100, remaining: 25 } }, WL).windows.map(function (w) { return [w.key, w.usedPercent] }),
    [['seven_day', 75]])
  check('D13 usages 对象按窗口名归类',
    u.parseKimiCodingUsages({ usages: { five_hour: { limit: 100, remaining: 20 }, weekly: { limit: 100, remaining: 60 } } }, WL).windows.map(function (w) { return [w.key, w.usedPercent] }),
    [['five_hour', 80], ['seven_day', 40]])
  check('D14 usages 数组按 window.duration 归类',
    u.parseKimiCodingUsages({ usages: [
      { window: { duration: 300 }, detail: { limit: 100, remaining: 50 } },
      { window: { duration: 10080 }, detail: { limit: 100, remaining: 90 } },
    ] }, WL).windows.map(function (w) { return w.key }),
    ['five_hour', 'seven_day'])
  check('D15 同窗口重复出现只保留第一条（limits 两条 300）',
    u.parseKimiCodingUsages({ limits: [
      { window: { duration: 300 }, detail: { limit: 100, remaining: 20 } },
      { window: { duration: 300 }, detail: { limit: 100, remaining: 50 } },
    ] }, WL).windows.map(function (w) { return w.usedPercent }),
    [80])
  check('D16 10 位秒级 resetTime ×1000',
    u.parseKimiCodingUsages({ usage: { limit: 100, remaining: 90, resetTime: 1762000000 } }, WL).windows[0].resetsAt, 1762000000000)
  check('D17 remaining 超过 limit → 0% 已用',
    u.parseKimiCodingUsages({ usage: { limit: 100, remaining: 150 } }, WL).windows[0].usedPercent, 0)
  check('D18 limit 为 0 / 缺失 / 非法 → null',
    [u.parseKimiCodingUsages({ usage: { limit: 0, remaining: 0 } }, WL),
      u.parseKimiCodingUsages({ usage: { remaining: 10 } }, WL),
      u.parseKimiCodingUsages({ usage: { limit: 'oops', remaining: 10 } }, WL)],
    [null, null, null])
  check('D19 空对象 / null / 字符串 → null',
    [u.parseKimiCodingUsages({}, WL), u.parseKimiCodingUsages(null, WL), u.parseKimiCodingUsages('oops', WL)],
    [null, null, null])
  check('D20 缺 resetTime → resetsAt null 但窗口保留',
    u.parseKimiCodingUsages({ usage: { limit: 100, remaining: 50 } }, WL).windows[0].resetsAt, null)

  // ================= E) fetchAlibabaTokenPlanUsage =================
  const alibabaResults = []
  function record(r) { alibabaResults.push(r); return r }

  // E1 无凭据
  const noKeyH = makeHarness(u, { creds: {}, responses: [] })
  const noKey = record(await noKeyH.api.fetchAlibaba('cn'))
  check('E1 无 AK/SK → kind no-key', noKey.error && noKey.error.kind, 'no-key')
  check('E2 无 AK/SK → 稳定 code', noKey.error && noKey.error.code, 'subscription.alibaba-not-configured')
  check('E3 无 AK/SK → 中文字案', noKey.error && noKey.error.message, zhDict['error.subscription.alibaba-not-configured'])
  ok('E4 无 AK/SK → 文案含凭据名 ALIBABA_CLOUD_ACCESS_KEY_ID', noKey.error.message.indexOf('ALIBABA_CLOUD_ACCESS_KEY_ID') >= 0)
  ok('E5 无 AK/SK → 不发起任何请求', noKeyH.calls.length === 0)
  check('E6 resolveAlibabaAccessKeys 双缺 → null', await noKeyH.api.resolveAlibabaAccessKeys(), null)
  const idOnlyH = makeHarness(u, { creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID }, responses: [] })
  check('E7 只有 AK ID → null（必须两个都有）', await idOnlyH.api.resolveAlibabaAccessKeys(), null)
  // 环境变量兜底
  const envH = makeHarness(u, { creds: {}, env: { ALIBABA_CLOUD_ACCESS_KEY_ID: 'ENV_ID', ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'ENV_SECRET' }, responses: [response(200, STATS_OK_BODY)] })
  check('E8 凭据服务缺失时回退 process.env', await envH.api.resolveAlibabaAccessKeys(), { id: 'ENV_ID', secret: 'ENV_SECRET' })
  // 凭据服务优先于环境变量
  const credsWinH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    env: { ALIBABA_CLOUD_ACCESS_KEY_ID: 'ENV_ID', ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'ENV_SECRET' },
    responses: [response(200, STATS_OK_BODY)],
  })
  const credsWin = await credsWinH.api.fetchAlibaba('cn')
  ok('E9 凭据服务优先于环境变量', credsWinH.calls[0].init.headers.authorization.indexOf('Credential=' + AK_ID + ',') > 0,
    credsWinH.calls[0].init.headers.authorization)

  // E10 stats 200 + Items → 直接返回，不发第二步
  const statsH = makeHarness(u, { creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET }, responses: [response(200, STATS_OK_BODY)] })
  const statsOk = record(await statsH.api.fetchAlibaba('cn'))
  check('E10 stats 成功 → data.provider=qwen-token-plan-cn', statsOk.data && statsOk.data.provider, 'qwen-token-plan-cn')
  check('E11 stats 成功 → 月度 60% 已用', statsOk.data && statsOk.data.windows[0].usedPercent, 60)
  check('E12 stats 成功 → 带出 expiryAt', statsOk.data && statsOk.data.expiryAt, 1790920800000)
  check('E13 stats 成功只发一次请求', statsH.calls.length, 1)
  check('E14 stats 请求 URL（CN 站点）', statsH.calls[0].url, CN_STATS_URL)
  check('E15 stats 请求 method=GET', statsH.calls[0].init.method, 'GET')
  check('E16 stats GET 无 body', statsH.calls[0].init.body, undefined)
  check('E17 stats 请求头 x-acs-action', statsH.calls[0].init.headers['x-acs-action'], 'GetSubscriptionStats')
  check('E18 stats 请求头 x-acs-version=2026-02-10', statsH.calls[0].init.headers['x-acs-version'], '2026-02-10')
  check('E19 stats 请求头空 body 哈希', statsH.calls[0].init.headers['x-acs-content-sha256'], EMPTY_SHA)
  ok('E20 stats 请求 Authorization 带 AK 与 ACS3 算法',
    /^ACS3-HMAC-SHA256 Credential=LTAI-test-access-key-id,SignedHeaders=[^,]*host[^,]*,Signature=[0-9a-f]{64}$/.test(statsH.calls[0].init.headers.authorization),
    statsH.calls[0].init.headers.authorization)
  ok('E21 host 不出现在发送头里（只参与签名）', !Object.prototype.hasOwnProperty.call(statsH.calls[0].init.headers, 'host'))
  ok('E22 请求带 AbortSignal 超时信号', !!statsH.calls[0].init.signal)
  ok('E23 x-acs-date 为 UTC ISO8601 秒级', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(statsH.calls[0].init.headers['x-acs-date']),
    statsH.calls[0].init.headers['x-acs-date'])
  ok('E24 x-acs-signature-nonce 为随机 UUID v4',
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(statsH.calls[0].init.headers['x-acs-signature-nonce']),
    statsH.calls[0].init.headers['x-acs-signature-nonce'])

  // E25 站点路由
  const intlStatsH = makeHarness(u, { creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET }, responses: [response(200, STATS_OK_BODY)] })
  const intlStats = record(await intlStatsH.api.fetchAlibaba('intl'))
  check('E25 国际站 stats → provider=qwen-token-plan', intlStats.data && intlStats.data.provider, 'qwen-token-plan')
  check('E26 国际站 stats URL', intlStatsH.calls[0].url, INTL_STATS_URL)
  const cnDefaultH = makeHarness(u, { creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET }, responses: [response(200, STATS_OK_BODY)] })
  const cnDefault = record(await cnDefaultH.api.fetchAlibaba(undefined))
  check('E27 未知/缺省 region → 中国站', [cnDefault.data.provider, cnDefaultH.calls[0].url], ['qwen-token-plan-cn', CN_STATS_URL])

  // E28 stats 403 → 换 CLI 令牌 → 网关 usage 成功
  const fallbackH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(403, { Code: 'Forbidden.RAM' }), response(200, TOKEN_BODY), response(200, USAGE_BODY)],
  })
  const fallback = record(await fallbackH.api.fetchAlibaba('cn'))
  check('E28 stats 403 → 回退链路成功后返回 data', fallback.data && fallback.data.windows[0].usedPercent, 42)
  check('E29 回退链路共三次请求（stats → token → gateway）', fallbackH.calls.length, 3)
  check('E30 第一步仍打 stats 端点', fallbackH.calls[0].url, CN_STATS_URL)
  check('E31 第二步打 generateAccessToken', fallbackH.calls[1].url, CN_TOKEN_URL)
  check('E32 令牌请求 method=POST', fallbackH.calls[1].init.method, 'POST')
  check('E33 令牌请求 Content-Type=application/json', fallbackH.calls[1].init.headers['content-type'], 'application/json')
  check('E34 令牌请求空 body', fallbackH.calls[1].init.body, '')
  check('E35 令牌请求头 x-acs-action', fallbackH.calls[1].init.headers['x-acs-action'], 'GenerateCLIAccessToken')
  ok('E36 令牌请求 content-type 参与签名头', fallbackH.calls[1].init.headers.authorization.indexOf(',SignedHeaders=content-type;host;x-acs-action;') >= 0,
    fallbackH.calls[1].init.headers.authorization)
  check('E37 网关请求 URL（action/product/api 编码）',
    fallbackH.calls[2].url,
    CN_GATEWAY_PREFIX + 'action=BroadScopeAspnGateway&product=sfm_bailian&api=' + u.alibabaFormEncode(ALIBABA_TOKEN_PLAN_USAGE_API))
  check('E38 网关请求 method=POST', fallbackH.calls[2].init.method, 'POST')
  check('E39 网关 Bearer 令牌', fallbackH.calls[2].init.headers.Authorization, 'Bearer ' + CLI_TOKEN)
  check('E40 网关 Accept: */*', fallbackH.calls[2].init.headers.Accept, '*/*')
  check('E41 网关 Content-Type 表单', fallbackH.calls[2].init.headers['Content-Type'], 'application/x-www-form-urlencoded')
  const expectedParams = {
    Api: ALIBABA_TOKEN_PLAN_USAGE_API,
    V: '1.0',
    Data: { cornerstoneParam: { protocol: 'V2', console: 'ONE_CONSOLE', productCode: 'p_efm', switchUserType: 3, consoleSite: 'BAILIAN_ALIYUN' } },
  }
  const expectedForm = 'params=' + u.alibabaFormEncode(JSON.stringify(expectedParams)) + '&region=cn-beijing'
  check('E42 网关表单逐字匹配（params RFC3986 编码 + region）', fallbackH.calls[2].init.body, expectedForm)
  ok('E43 params 编码后不含裸 { / " / 空格', /\{/.test(fallbackH.calls[2].init.body) === false
    && /"/.test(fallbackH.calls[2].init.body) === false && /\+/.test(fallbackH.calls[2].init.body) === false, fallbackH.calls[2].init.body)
  ok('E44 params 可 decode 成合法 JSON 且含 cornerstoneParam', (function () {
    try {
      const raw = fallbackH.calls[2].init.body.slice('params='.length, fallbackH.calls[2].init.body.indexOf('&region='))
      const payload = JSON.parse(decodeURIComponent(raw))
      return payload.Data.cornerstoneParam.consoleSite === 'BAILIAN_ALIYUN' && payload.Data.cornerstoneParam.switchUserType === 3
    } catch (err) { return false }
  })())
  ok('E45 cornerstoneParam 不带 switchAgent（CodexBar 踩坑点）', fallbackH.calls[2].init.body.indexOf('switchAgent') < 0)
  ok('E46 回退成功结果不含 AK secret / CLI token', JSON.stringify(fallback).indexOf(AK_SECRET) < 0 && JSON.stringify(fallback).indexOf(CLI_TOKEN) < 0)
  check('E47 回退成功 → provider 仍为中国站 id', fallback.data && fallback.data.provider, 'qwen-token-plan-cn')

  // E48 token 放在 data.cliAccessToken 也能取到
  const wrappedTokenH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(200, STATS_EMPTY_BODY), response(200, { data: { cliAccessToken: CLI_TOKEN } }), response(200, USAGE_BODY)],
  })
  const wrappedToken = record(await wrappedTokenH.api.fetchAlibaba('cn'))
  check('E48 令牌在 data.cliAccessToken 时同样可用', wrappedToken.data && wrappedToken.data.windows[0].usedPercent, 42)

  // E49 stats 200 但无 Items + token 200 无 cliAccessToken → 无法识别（kind parse）
  const noTokenH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(200, STATS_EMPTY_BODY), response(200, {})],
  })
  const noToken = record(await noTokenH.api.fetchAlibaba('cn'))
  check('E49 token 200 但无 cliAccessToken → kind parse', [noToken.error.kind, noToken.error.code],
    ['parse', 'subscription.alibaba-unrecognized'])
  check('E50 token 200 但无 cliAccessToken → 中文字案', noToken.error.message, zhDict['error.subscription.alibaba-unrecognized'])
  check('E51 该场景共两次请求', noTokenH.calls.length, 2)

  // E52 token 403 → auth
  const tokenAuthH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(200, STATS_EMPTY_BODY), response(403, { Code: 'InvalidAccessKeyId.NotFound' })],
  })
  const tokenAuth = record(await tokenAuthH.api.fetchAlibaba('cn'))
  check('E52 token 403 → kind auth + alibaba-auth-failed', [tokenAuth.error.kind, tokenAuth.error.code],
    ['auth', 'subscription.alibaba-auth-failed'])
  check('E53 token 403 → 中文字案', tokenAuth.error.message, zhDict['error.subscription.alibaba-auth-failed'])
  ok('E54 凭据错误文案不含 secret', JSON.stringify(tokenAuth).indexOf(AK_SECRET) < 0)

  // E55 stats 404 InvalidAccessKeyId → 也走回退并最终 auth（Lead 验证向量）
  const stats404H = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(404, { Code: 'InvalidAccessKeyId.NotFound' }), response(403, { Code: 'NoPermission' })],
  })
  const stats404 = record(await stats404H.api.fetchAlibaba('cn'))
  check('E55 stats 404 + 无效 AK → 最终 auth', [stats404.error.kind, stats404.error.code], ['auth', 'subscription.alibaba-auth-failed'])

  // E56 网关业务错误：NotSubscribed（data.DataV2 层）
  const notSubH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(200, STATS_EMPTY_BODY), response(200, TOKEN_BODY),
      response(200, { data: { DataV2: { success: false, errorCode: 'BailianGateway.NotSubscribed', errorMessage: 'no plan' } } })],
  })
  const notSub = record(await notSubH.api.fetchAlibaba('cn'))
  check('E56 网关 NotSubscribed → kind no-subscription + code', [notSub.error.kind, notSub.error.code],
    ['no-subscription', 'subscription.alibaba-no-subscription'])
  check('E57 未订阅中文字案', notSub.error.message, zhDict['error.subscription.alibaba-no-subscription'])
  ok('E58 未订阅文案不含 AK secret', JSON.stringify(notSub).indexOf(AK_SECRET) < 0)

  // E59 网关业务错误：NotSubscribed 落在 data.data 内层
  const notSubInnerH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(200, STATS_EMPTY_BODY), response(200, TOKEN_BODY),
      response(200, { data: { data: { success: false, errorCode: 'NoInstance' } } })],
  })
  const notSubInner = record(await notSubInnerH.api.fetchAlibaba('cn'))
  check('E59 网关失败标记在 data.data 层也能识别 → no-subscription', notSubInner.error && notSubInner.error.code,
    'subscription.alibaba-no-subscription')

  // E60 NotLogined → auth
  const notLoginH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(200, STATS_EMPTY_BODY), response(200, TOKEN_BODY),
      response(200, { data: { success: false, errorCode: 'NotLogined', errorMessage: 'session expired' } })],
  })
  const notLogin = record(await notLoginH.api.fetchAlibaba('cn'))
  check('E60 网关 NotLogined → auth（多为 AK/SK 权限不足）', [notLogin.error.kind, notLogin.error.code],
    ['auth', 'subscription.alibaba-auth-failed'])

  // E61 网关 Workspace.NotAuthorised → auth
  const workspaceH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(200, STATS_EMPTY_BODY), response(200, TOKEN_BODY),
      response(200, { data: { DataV2: { success: false, errorCode: 'BailianGateway.Workspace.NotAuthorised' } } })],
  })
  const workspace = record(await workspaceH.api.fetchAlibaba('cn'))
  check('E61 Workspace.NotAuthorised → auth', workspace.error && workspace.error.code, 'subscription.alibaba-auth-failed')

  // E62 网关 200 但无法识别的业务数据 → parse
  const gatewayUnrecognizedH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(200, STATS_EMPTY_BODY), response(200, TOKEN_BODY), response(200, { data: { DataV2: { success: true } } })],
  })
  const gatewayUnrecognized = record(await gatewayUnrecognizedH.api.fetchAlibaba('cn'))
  check('E62 网关数据无法识别 → kind parse + alibaba-unrecognized',
    [gatewayUnrecognized.error.kind, gatewayUnrecognized.error.code], ['parse', 'subscription.alibaba-unrecognized'])

  // E63 网关 500 业务失败 → http
  const gateway500H = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(200, STATS_EMPTY_BODY), response(200, TOKEN_BODY),
      response(500, { data: { success: false, errorCode: 'InternalError' } })],
  })
  const gateway500 = record(await gateway500H.api.fetchAlibaba('cn'))
  check('E63 网关 500 → kind http + request.http', [gateway500.error.kind, gateway500.error.code], ['http', 'request.http'])
  check('E64 网关 500 文案带状态码', gateway500.error.message, zhDict['error.request.http'].replace('{status}', '500'))

  // E65 stats/token 均 500 → http 500
  const http500H = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(500, { Code: 'InternalError' }), response(500, { Code: 'InternalError' })],
  })
  const http500 = record(await http500H.api.fetchAlibaba('cn'))
  check('E65 stats/token 均 HTTP 500 → http + 状态码文案', [http500.error.kind, http500.error.message],
    ['http', zhDict['error.request.http'].replace('{status}', '500')])

  // E66 网络异常 → exception 保留原始信息
  const netH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [networkError('fetch failed: ECONNRESET'), networkError('fetch failed: ECONNRESET')],
  })
  const netErr = record(await netH.api.fetchAlibaba('cn'))
  check('E66 网络异常 → kind exception + 原始信息', [netErr.error.kind, netErr.error.message], ['exception', 'fetch failed: ECONNRESET'])
  ok('E67 网络异常按约定不带 code', netErr.error.code === undefined)

  // E68 stats 网络异常但回退链路成功 → 仍返回 data
  const statsNetH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [networkError('fetch failed'), response(200, TOKEN_BODY), response(200, USAGE_BODY)],
  })
  const statsNet = record(await statsNetH.api.fetchAlibaba('cn'))
  check('E68 stats 网络异常但回退成功 → 返回 data', statsNet.data && statsNet.data.windows[0].usedPercent, 42)

  // E69 网关深层信封 + 二次编码字符串 → 可解析
  const deepH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(200, STATS_EMPTY_BODY), response(200, TOKEN_BODY),
      response(200, { data: JSON.stringify({ DataV2: { success: true, data: JSON.stringify(USAGE_INNER) } }) })],
  })
  const deep = record(await deepH.api.fetchAlibaba('cn'))
  check('E69 网关二次编码字符串信封 → 解析 42%', deep.data && deep.data.windows[0].usedPercent, 42)

  // E70 国际站回退链路：gateway action / region / consoleSite
  const intlFallbackH = makeHarness(u, {
    creds: { ALIBABA_CLOUD_ACCESS_KEY_ID: AK_ID, ALIBABA_CLOUD_ACCESS_KEY_SECRET: AK_SECRET },
    responses: [response(403, { Code: 'Forbidden' }), response(200, TOKEN_BODY),
      response(200, { data: { data: { per1MonthPercentage: 0.5 } } })],
  })
  const intlFallback = record(await intlFallbackH.api.fetchAlibaba('intl'))
  check('E70 国际站第一步 stats host', intlFallbackH.calls[0].url, INTL_STATS_URL)
  check('E71 国际站令牌端点 host', intlFallbackH.calls[1].url, INTL_TOKEN_URL)
  check('E72 国际站网关 host + action', intlFallbackH.calls[2].url,
    INTL_GATEWAY_PREFIX + 'action=IntlBroadScopeAspnGateway&product=sfm_bailian&api=' + u.alibabaFormEncode(ALIBABA_TOKEN_PLAN_USAGE_API))
  check('E73 国际站 region=ap-southeast-1', /&region=ap-southeast-1$/.test(intlFallbackH.calls[2].init.body), true)
  ok('E74 国际站 consoleSite 用官方历史拼写 MODELSTUDIO_ALBABACLOUD',
    decodeURIComponent(intlFallbackH.calls[2].init.body).indexOf('MODELSTUDIO_ALBABACLOUD') >= 0,
    intlFallbackH.calls[2].init.body)
  check('E75 国际站成功 → provider=qwen-token-plan 且 50%', [intlFallback.data.provider, intlFallback.data.windows[0].usedPercent],
    ['qwen-token-plan', 50])

  // E76 全部错误结果都不泄漏 secret
  ok('E76 所有错误/成功结果均不含 AK secret 与 CLI token',
    alibabaResults.every(function (r) {
      const text = JSON.stringify(r)
      return text.indexOf(AK_SECRET) < 0 && text.indexOf(CLI_TOKEN) < 0
    }), alibabaResults.length + ' 个结果')

  // ================= F) fetchKimiCodingUsage =================
  const kimiResultBody = {
    limits: [{ window: { duration: 300 }, detail: { limit: '100', remaining: '70', resetTime: 1761926400000 } }],
    usage: { limit: '1000', remaining: '800', resetTime: 1762000000000 },
  }
  const kimiResults = []
  function recordKimi(r) { kimiResults.push(r); return r }

  const kimiNoKeyH = makeHarness(u, { creds: {}, responses: [] })
  const kimiNoKey = recordKimi(await kimiNoKeyH.api.fetchKimi())
  check('F1 Kimi 无凭据 → kind no-key + code', [kimiNoKey.error.kind, kimiNoKey.error.code],
    ['no-key', 'subscription.kimi-not-configured'])
  ok('F2 Kimi 无凭据文案含 KIMI_CODING_API_KEY', kimiNoKey.error.message.indexOf('KIMI_CODING_API_KEY') >= 0)
  ok('F3 Kimi 无凭据 → 不发起请求', kimiNoKeyH.calls.length === 0)
  check('F4 resolveKimiCodingKey 双缺（含 env 空）→ null', await kimiNoKeyH.api.resolveKimiCodingKey(), null)

  const kimiCnH = makeHarness(u, { creds: { KIMI_CODING_API_KEY: KIMI_KEY }, responses: [response(200, kimiResultBody)] })
  const kimiCn = recordKimi(await kimiCnH.api.fetchKimi())
  check('F5 中国站成功只发一次请求', kimiCnH.calls.length, 1)
  check('F6 首个端点 = api.kimi.com/coding/v1/usages', kimiCnH.calls[0].url, 'https://api.kimi.com/coding/v1/usages')
  check('F7 Kimi 请求 Bearer API Key', kimiCnH.calls[0].init.headers.Authorization, 'Bearer ' + KIMI_KEY)
  check('F8 Kimi 请求 Accept: application/json', kimiCnH.calls[0].init.headers.Accept, 'application/json')
  ok('F9 Kimi 请求带 AbortSignal', !!kimiCnH.calls[0].init.signal)
  check('F10 Kimi 成功 → provider=kimi-coding', kimiCn.data.provider, 'kimi-coding')
  check('F11 Kimi 成功 → 两个窗口', kimiCn.data.windows.length, 2)
  check('F12 Kimi 5h 30% / 周 20%', kimiCn.data.windows.map(function (w) { return w.usedPercent }), [30, 20])
  ok('F13 Kimi 成功结果不含 key', JSON.stringify(kimiCn).indexOf(KIMI_KEY) < 0)

  // 凭据优先级：KIMI_API_KEY > KIMI_CODING_API_KEY > MOONSHOT_API_KEY > KIMI_CODE_API_KEY > kimi-coding
  const kimiPrefH = makeHarness(u, {
    creds: { KIMI_API_KEY: 'key-kimi', KIMI_CODING_API_KEY: 'key-coding', MOONSHOT_API_KEY: 'key-moonshot' },
    responses: [response(200, kimiResultBody)],
  })
  await kimiPrefH.api.fetchKimi()
  check('F14 KIMI_API_KEY 优先（DSH kimi-coding provider 的环境变量名）', kimiPrefH.calls[0].init.headers.Authorization, 'Bearer key-kimi')
  const kimiCodingKeyH = makeHarness(u, { creds: { KIMI_CODING_API_KEY: 'key-coding', MOONSHOT_API_KEY: 'key-moonshot' }, responses: [response(200, kimiResultBody)] })
  await kimiCodingKeyH.api.fetchKimi()
  check('F15 回退 KIMI_CODING_API_KEY', kimiCodingKeyH.calls[0].init.headers.Authorization, 'Bearer key-coding')
  const kimiMoonH = makeHarness(u, { creds: { MOONSHOT_API_KEY: 'key-moonshot' }, responses: [response(200, kimiResultBody)] })
  await kimiMoonH.api.fetchKimi()
  check('F16 回退 MOONSHOT_API_KEY', kimiMoonH.calls[0].init.headers.Authorization, 'Bearer key-moonshot')
  const kimiCodeKeyH = makeHarness(u, { creds: { KIMI_CODE_API_KEY: 'key-code' }, responses: [response(200, kimiResultBody)] })
  await kimiCodeKeyH.api.fetchKimi()
  check('F17 回退 KIMI_CODE_API_KEY', kimiCodeKeyH.calls[0].init.headers.Authorization, 'Bearer key-code')

  // CN 401 → 国际站
  // CN 401 → 国际站
  const kimiFallbackH = makeHarness(u, { creds: { KIMI_CODING_API_KEY: KIMI_KEY }, responses: [response(401, {}), response(200, kimiResultBody)] })
  const kimiFallback = recordKimi(await kimiFallbackH.api.fetchKimi())
  check('F18 CN 401 后仍尝试国际站', kimiFallbackH.calls.map(function (c) { return c.url }),
    ['https://api.kimi.com/coding/v1/usages', 'https://api.kimi.ai/coding/v1/usages'])
  check('F19 国际站成功后返回 data', kimiFallback.data && kimiFallback.data.windows.length, 2)

  // 两站 401 → auth
  const kimiUnauthorizedH = makeHarness(u, { creds: { KIMI_CODING_API_KEY: KIMI_KEY }, responses: [response(401, {}), response(401, {})] })
  const kimiUnauthorized = recordKimi(await kimiUnauthorizedH.api.fetchKimi())
  check('F20 两站均 401 → kind auth + kimi-auth-failed', [kimiUnauthorized.error.kind, kimiUnauthorized.error.code],
    ['auth', 'subscription.kimi-auth-failed'])
  check('F21 两站均 401 → 中文字案', kimiUnauthorized.error.message, zhDict['error.subscription.kimi-auth-failed'])
  ok('F22 鉴权失败文案不含 key', JSON.stringify(kimiUnauthorized).indexOf(KIMI_KEY) < 0)
  const kimi403H = makeHarness(u, { creds: { KIMI_CODING_API_KEY: KIMI_KEY }, responses: [response(403, {}), response(403, {})] })
  const kimi403 = recordKimi(await kimi403H.api.fetchKimi())
  check('F23 403 同样归 auth', [kimi403.error.kind, kimi403.error.code], ['auth', 'subscription.kimi-auth-failed'])

  // CN 500 → 国际站成功
  const kimi500ThenOkH = makeHarness(u, { creds: { KIMI_CODING_API_KEY: KIMI_KEY }, responses: [response(500, {}), response(200, kimiResultBody)] })
  const kimi500ThenOk = recordKimi(await kimi500ThenOkH.api.fetchKimi())
  check('F24 CN 5xx 后继续尝试国际站并成功', kimi500ThenOk.data && kimi500ThenOk.data.windows.length, 2)
  // 两站 500 → http
  const kimi500H = makeHarness(u, { creds: { KIMI_CODING_API_KEY: KIMI_KEY }, responses: [response(500, {}), response(500, {})] })
  const kimi500 = recordKimi(await kimi500H.api.fetchKimi())
  check('F25 两站均 500 → kind http + request.http', [kimi500.error.kind, kimi500.error.code], ['http', 'request.http'])
  check('F26 两站均 500 → 文案带状态码', kimi500.error.message, zhDict['error.request.http'].replace('{status}', '500'))

  // CN 200 但不可解析 → 国际站
  const kimiBadThenOkH = makeHarness(u, { creds: { KIMI_CODING_API_KEY: KIMI_KEY }, responses: [response(200, {}), response(200, kimiResultBody)] })
  const kimiBadThenOk = recordKimi(await kimiBadThenOkH.api.fetchKimi())
  check('F27 CN 200 无窗口 → 继续国际站并成功', kimiBadThenOk.data && kimiBadThenOk.data.windows.length, 2)
  // 两站 200 都不可解析 → parse
  const kimiBadH = makeHarness(u, { creds: { KIMI_CODING_API_KEY: KIMI_KEY }, responses: [response(200, {}), response(200, {})] })
  const kimiBad = recordKimi(await kimiBadH.api.fetchKimi())
  check('F28 两站 200 均无窗口 → kind parse + kimi-unrecognized', [kimiBad.error.kind, kimiBad.error.code],
    ['parse', 'subscription.kimi-unrecognized'])
  // 网络异常后第二站成功
  const kimiNetThenOkH = makeHarness(u, { creds: { KIMI_CODING_API_KEY: KIMI_KEY }, responses: [networkError('fetch failed'), response(200, kimiResultBody)] })
  const kimiNetThenOk = recordKimi(await kimiNetThenOkH.api.fetchKimi())
  check('F29 首站网络异常后国际站成功', kimiNetThenOk.data && kimiNetThenOk.data.windows.length, 2)
  // 两站网络异常 → exception 保留最后一条
  const kimiNetH = makeHarness(u, { creds: { KIMI_CODING_API_KEY: KIMI_KEY }, responses: [networkError('first fail'), networkError('second fail')] })
  const kimiNet = recordKimi(await kimiNetH.api.fetchKimi())
  check('F30 两站网络异常 → kind exception + 最后一条信息', [kimiNet.error.kind, kimiNet.error.message], ['exception', 'second fail'])

  // 凭据形态：环境变量兜底 / 订阅 OAuth 对象（accessToken / access_token）/ ctx 优先于 env
  const kimiEnvH = makeHarness(u, { creds: {}, env: { KIMI_API_KEY: 'env-kimi' }, responses: [response(200, kimiResultBody)] })
  await kimiEnvH.api.fetchKimi()
  check('F31 凭据服务缺失时回退 process.env', kimiEnvH.calls[0].init.headers.Authorization, 'Bearer env-kimi')
  const kimiOAuthH = makeHarness(u, { creds: { 'kimi-coding': { accessToken: 'oauth-access-token' } }, responses: [response(200, kimiResultBody)] })
  await kimiOAuthH.api.fetchKimi()
  check('F32 凭据值为对象时取 accessToken（订阅 OAuth）', kimiOAuthH.calls[0].init.headers.Authorization, 'Bearer oauth-access-token')
  const kimiOAuthSnakeH = makeHarness(u, { creds: { 'kimi-coding': { access_token: 'oauth-snake-token' } }, responses: [response(200, kimiResultBody)] })
  await kimiOAuthSnakeH.api.fetchKimi()
  check('F33 对象也接受 access_token 字段', kimiOAuthSnakeH.calls[0].init.headers.Authorization, 'Bearer oauth-snake-token')
  const kimiCtxEnvH = makeHarness(u, { creds: { KIMI_API_KEY: 'ctx-key' }, env: { KIMI_API_KEY: 'env-key' }, responses: [response(200, kimiResultBody)] })
  await kimiCtxEnvH.api.fetchKimi()
  check('F34 凭据服务优先于环境变量', kimiCtxEnvH.calls[0].init.headers.Authorization, 'Bearer ctx-key')

  // ================= G) 常量 / 接线 / 文案一致性 =================
  ok('G1 SUBSCRIPTION_PROVIDERS 含四个新 id',
    ['qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual', 'kimi-coding'].every(function (id) {
      return SUBSCRIPTION_PROVIDERS.indexOf(id) >= 0
    }), JSON.stringify(SUBSCRIPTION_PROVIDERS))
  ok('G2 DSH_PRESET_PROVIDERS 含阿里三 id 与 kimi-coding',
    ['qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual', 'kimi-coding'].every(function (id) {
      return DSH_PRESET_PROVIDERS.indexOf(id) >= 0
    }))
  check('G3 阿里三 id 的订阅源：intl / cn / intl',
    ['qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual'].map(function (id) {
      return PROVIDER_IDENTITY[id] && PROVIDER_IDENTITY[id].subscription
    }), ['alibaba-intl', 'alibaba-cn', 'alibaba-intl'])
  check('G4 kimi-coding 的订阅源 = kimi-coding', PROVIDER_IDENTITY['kimi-coding'] && PROVIDER_IDENTITY['kimi-coding'].subscription, 'kimi-coding')
  // 2026-11-12：fetch 外包了 annotateSubscriptionNoKey（no-key 引导参数），断言放宽到「仍接同一 fetch 函数」
  ok('G5 host.js：alibaba-cn / alibaba-intl 各为独立源',
    hostSrc.indexOf("'alibaba-cn': { fetch: function () { return fetchAlibabaTokenPlanUsage('cn')") >= 0
    && hostSrc.indexOf("'alibaba-intl': { fetch: function () { return fetchAlibabaTokenPlanUsage('intl')") >= 0)
  ok('G6 host.js：kimi-coding 接 fetchKimiCodingUsage', hostSrc.indexOf("'kimi-coding': { fetch: function () { return fetchKimiCodingUsage()") >= 0)
  ok('G7 host.js：展示名映射含阿里三 id 与 kimi-coding',
    ["'qwen-token-plan': t('ui.qwenTokenPlan')", "'qwen-token-plan-cn': t('ui.qwenTokenPlan')",
      "'qwen-token-plan-individual': t('ui.qwenTokenPlan')", "'kimi-coding': t('ui.kimiCoding')"].every(function (needle) {
      return hostSrc.indexOf(needle) >= 0
    }))
  const serviceFn = extractClientFnBody('subscriptionServiceName')
  ok('G8 client-bundle：subscriptionServiceName 含四个 provider 品牌分支',
    ["provider === 'qwen-token-plan'", "provider === 'qwen-token-plan-cn'", "provider === 'qwen-token-plan-individual'", "provider === 'kimi-coding'"].every(function (needle) {
      return serviceFn.indexOf(needle) >= 0
    }), serviceFn.slice(0, 160))
  ok('G9 client-bundle：品牌名走字典键 ui.qwenTokenPlan / ui.kimiCoding',
    serviceFn.indexOf("t('ui.qwenTokenPlan')") >= 0 && serviceFn.indexOf("t('ui.kimiCoding')") >= 0)
  check('G10 区域常量：CN/Intl apiHost 与 consoleHost',
    [ALIBABA_TOKEN_PLAN_REGIONS.cn.apiHost, ALIBABA_TOKEN_PLAN_REGIONS.cn.consoleHost,
      ALIBABA_TOKEN_PLAN_REGIONS.intl.apiHost, ALIBABA_TOKEN_PLAN_REGIONS.intl.consoleHost],
    ['modelstudio.cn-beijing.aliyuncs.com', 'bailian-cs.console.aliyun.com',
      'modelstudio.ap-southeast-1.aliyuncs.com', 'bailian-singapore-cs.alibabacloud.com'])
  check('G11 区域常量：gatewayAction / consoleRegion / consoleSite',
    [ALIBABA_TOKEN_PLAN_REGIONS.cn.gatewayAction, ALIBABA_TOKEN_PLAN_REGIONS.intl.gatewayAction,
      ALIBABA_TOKEN_PLAN_REGIONS.cn.consoleRegion, ALIBABA_TOKEN_PLAN_REGIONS.intl.consoleRegion,
      ALIBABA_TOKEN_PLAN_REGIONS.cn.consoleSite, ALIBABA_TOKEN_PLAN_REGIONS.intl.consoleSite],
    ['BroadScopeAspnGateway', 'IntlBroadScopeAspnGateway', 'cn-beijing', 'ap-southeast-1', 'BAILIAN_ALIYUN', 'MODELSTUDIO_ALBABACLOUD'])
  check('G12 ACS3 版本 = 2026-02-10', ALIBABA_ACS3_VERSION, '2026-02-10')
  check('G13 算法名 = ACS3-HMAC-SHA256', ALIBABA_ACS3_ALGORITHM, 'ACS3-HMAC-SHA256')
  check('G14 控制台 usage API 名', ALIBABA_TOKEN_PLAN_USAGE_API, 'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage')
  check('G15 Kimi 端点顺序：CN → 国际', KIMI_CODING_BASE_URLS, ['https://api.kimi.com/coding/v1', 'https://api.kimi.ai/coding/v1'])
  check('G16 Kimi 凭据名优先级（KIMI_API_KEY 为 DSH provider 环境变量名）', KIMI_CODING_CREDENTIAL_NAMES,
    ['KIMI_API_KEY', 'KIMI_CODING_API_KEY', 'MOONSHOT_API_KEY', 'KIMI_CODE_API_KEY', 'kimi-coding'])
  ok('G17 宿主源码未使用 switchAgent（网关工作区踩坑点）', hostSrc.indexOf('switchAgent') < 0)
  const ALIBABA_CODES = [
    'subscription.alibaba-not-configured',
    'subscription.alibaba-auth-failed',
    'subscription.alibaba-no-subscription',
    'subscription.alibaba-unrecognized',
  ]
  const KIMI_CODES = [
    'subscription.kimi-not-configured',
    'subscription.kimi-auth-failed',
    'subscription.kimi-unrecognized',
  ]
  ok('G18 阿里 4 个稳定 code 中英齐备且互不相同', ALIBABA_CODES.every(function (code) {
    const zh = zhDict['error.' + code], en = enDict['error.' + code]
    return typeof zh === 'string' && typeof en === 'string' && zh !== en
  }))
  ok('G19 Kimi 3 个稳定 code 中英齐备且互不相同', KIMI_CODES.every(function (code) {
    const zh = zhDict['error.' + code], en = enDict['error.' + code]
    return typeof zh === 'string' && typeof en === 'string' && zh !== en
  }))
  ok('G20 品牌名 ui.qwenTokenPlan / ui.kimiCoding 中英一致（品牌名不翻译）',
    zhDict['ui.qwenTokenPlan'] === 'Qwen Token Plan' && enDict['ui.qwenTokenPlan'] === 'Qwen Token Plan'
    && zhDict['ui.kimiCoding'] === 'Kimi Coding' && enDict['ui.kimiCoding'] === 'Kimi Coding')
  ok('G21 宿主 error 对象一律带稳定 code（阿里/Kimi 文案行）', hostSrc.split('\n').every(function (line) {
    if (!/error:\s*\{[^}]*message:\s*t\('error\.subscription\.(alibaba|kimi)-/.test(line)) return true
    return /code:/.test(line)
  }))

  console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项失败') + '：' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(function (err) {
  console.error('测试装置异常：' + String((err && err.stack) || err))
  process.exit(1)
})
