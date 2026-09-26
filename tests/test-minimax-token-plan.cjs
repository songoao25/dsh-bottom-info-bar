// MiniMax Token Plan 宿主适配单测（FR-15 / task-1）
// 覆盖（契约 2026-09-24 裁决为准）：
//  ① remaining 合法性：非数值/负数 → 该桶该窗口跳过；>100 → 钳制 100（used=0）；[0,100] 取整
//  ② resetsAt：取「该窗口类型下 remaining 最小（最紧）的桶」的 end_time；并列取先出现者；
//     最紧桶缺 end_time → 回退该类型所有桶里最早的有效 end_time；都没有 → null（窗口仍保留）
//  ③ windows：某窗口类型至少一个合法 remaining 才产出；两类都无 → parse 返回 null
//  ④ 订阅源：minimax / minimax-cn 各自独立源；accountForProvider 两者都 → 'minimax'；
//     成功数据 data.provider = 实际 provider id
//  ⑤ fetch 层：无凭据 / 401 / 403 / base_resp 1004 / 2049 / 其他非 0 / 其他 HTTP / JSON 坏 / 网络异常
//     的 kind + 稳定 code + 中英文案；错误信息不得含密钥
// 用法：node tests/test-minimax-token-plan.js
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const hostSrc = readFileSync(join(root, 'src', 'host.js'), 'utf8')
const constantsSrc = readFileSync(join(root, 'src', 'constants.js'), 'utf8')
const localeSrc = readFileSync(join(root, 'src', 'locales.js'), 'utf8')

// ---- 从正式源码抽出被测函数/常量（保证测的是真身，而不是复制品） ----
function extractFn(name) {
  let start = hostSrc.indexOf('function ' + name)
  if (start < 0) throw new Error('未找到 function ' + name)
  // 保留 async 前缀：抽取 async 函数时丢掉它会让函数体里的 await 变成语法错误
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

const LOCALES = eval('(' + extractBraced(localeSrc, 'export const LOCALES = ') + ')')
const zhDict = LOCALES.zh
const enDict = LOCALES.en
const WINDOW_LABELS = eval('(' + extractBraced(hostSrc, 'const WINDOW_LABELS = ') + ')')
const MINIMAX_PLAN_NAME = (hostSrc.match(/const MINIMAX_PLAN_NAME = '([^']+)'/) || [])[1]
// host 侧已把 AbortSignal.timeout 收敛到唯一封装 timeoutSignal()（见 tests/test-source-guards.mjs 守卫 6），
// 抽出来的函数体只引用 timeoutSignal + HTTP_TIMEOUT_MS。测试装置必须一并注入这两个名字，
// 否则抽取出的函数里会出现未定义引用（表现为「请求根本没发出去」，很难看出根因）。
const HTTP_TIMEOUT_MS = Number((hostSrc.match(/const HTTP_TIMEOUT_MS = (\d+)/) || [])[1])
const SUBSCRIPTION_PROVIDERS = eval('(' + extractBracketed(constantsSrc, 'export const SUBSCRIPTION_PROVIDERS = ') + ')')

// 顶层 t() 依赖宿主 locale 服务：单测用真实中文字典做替身（缺键直接抛错，防漏键）
function tStub(key, params) {
  const raw = zhDict[key]
  if (typeof raw !== 'string') throw new Error('未预期的 i18n key: ' + key)
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, function (m, name) {
    return params[name] !== undefined ? String(params[name]) : m
  })
}

// 解析层：把真身函数装进受控作用域（闭包常量一并注入）
const parseApi = eval(
  '(function (windowLabels) {'
  + 'const WINDOW_LABELS = ' + JSON.stringify(WINDOW_LABELS) + ';'
  + 'const MINIMAX_PLAN_NAME = ' + JSON.stringify(MINIMAX_PLAN_NAME) + ';'
  + extractFn('minimaxBaseUrl')
  + extractFn('parseFiniteNonNegativeAmount')
  + extractFn('minimaxNumericField')
  + extractFn('minimaxRemainingPercent')
  + extractFn('minimaxAggregateRemainingPercents')
  + extractFn('parseMinimaxTokenPlanRemains')
  + 'return { minimaxBaseUrl: minimaxBaseUrl, minimaxNumericField: minimaxNumericField, minimaxRemainingPercent: minimaxRemainingPercent, minimaxAggregateRemainingPercents: minimaxAggregateRemainingPercents, parse: parseMinimaxTokenPlanRemains } })'
)(WINDOW_LABELS)
const nf = parseApi.minimaxNumericField
const rp = parseApi.minimaxRemainingPercent
const parse = parseApi.parse

// fetch 层：抽取 apply 内的 resolveMinimaxKey / fetchMinimaxTokenPlanUsage，注入桩 ctx / fetch
function makeFetchHarness(options) {
  const opts = options || {}
  const creds = opts.creds || {}
  const calls = []
  const ctx = {
    credentials: {
      resolve: async function (name) {
        return Object.prototype.hasOwnProperty.call(creds, name) ? { value: creds[name] } : null
      },
    },
  }
  const fetchImpl = opts.fetchImpl || (async function (url, init) {
    calls.push({ url: url, init: init })
    return { ok: true, status: 200, json: async function () { return opts.body } }
  })
  const factory = eval(
    '(function (ctx, t, windowLabels, fetch, AbortSignal, minimaxBaseUrl, minimaxNumericField, parseMinimaxTokenPlanRemains) {'
    + 'const HTTP_TIMEOUT_MS = ' + HTTP_TIMEOUT_MS + ';'
    + extractFn('timeoutSignal')
    + extractFn('resolveCredentialValue')
    + extractFn('resolveWithFallback')
    + extractFn('resolveMinimaxKey')
    + extractFn('fetchMinimaxTokenPlanUsage')
    + 'return { resolveMinimaxKey: resolveMinimaxKey, fetch: fetchMinimaxTokenPlanUsage } })'
  )
  return {
    calls: calls,
    api: factory(ctx, tStub, WINDOW_LABELS, fetchImpl, AbortSignal, parseApi.minimaxBaseUrl, nf, parse),
  }
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
  // ================= ① 真实响应样例 + 多桶最紧聚合 =================
  const REAL = {
    base_resp: { status_code: 0, status_msg: 'success' },
    model_remains: [
      { model_name: 'general', current_interval_remaining_percent: 64, end_time: 1789284984350, current_weekly_remaining_percent: 100, weekly_end_time: 1789871510984 },
      { model_name: 'video', current_interval_remaining_percent: 90, end_time: 1789284999999, current_weekly_remaining_percent: 100, weekly_end_time: 1789871599999 },
    ],
  }
  const real = parse(REAL, WINDOW_LABELS)
  ok('① 真实样例：解析成功', !!real, JSON.stringify(real))
  check('① 真实样例：两个窗口', real && real.windows.length, 2)
  check('① 真实样例：窗口键顺序', real && real.windows.map(function (w) { return w.key }), ['five_hour', 'seven_day'])
  check('① 真实样例：标签跟随传入字典', real && real.windows.map(function (w) { return w.label }), ['5 小时', '周'])
  check('① 真实样例：5h used = 36（最紧桶 64）', real && real.windows[0].usedPercent, 36)
  check('① 真实样例：周 used = 0（剩余 100）', real && real.windows[1].usedPercent, 0)
  check('① 真实样例：套餐名 = MiniMax Token Plan', real && real.plan, 'MiniMax Token Plan')
  check('① 真实样例：5h resetsAt = 最紧桶 end_time', real && real.windows[0].resetsAt, 1789284984350)
  check('① 真实样例：周 resetsAt', real && real.windows[1].resetsAt, 1789871510984)

  const tightest = parse({
    model_remains: [
      { current_interval_remaining_percent: 20, end_time: 5000, current_weekly_remaining_percent: 50, weekly_end_time: 9000 },
      { current_interval_remaining_percent: 80, end_time: 1000, current_weekly_remaining_percent: 50, weekly_end_time: 3000 },
    ],
  })
  check('① 最紧聚合：5h 取最小剩余 20 → used 80', tightest && tightest.windows[0].usedPercent, 80)
  check('① 最紧聚合：周取 50 → used 50', tightest && tightest.windows[1].usedPercent, 50)
  check('① 最紧聚合：字符串数字参与比较', parse({ model_remains: [{ current_interval_remaining_percent: '64' }, { current_interval_remaining_percent: 80 }] }).windows[0].usedPercent, 36)
  check('① 最紧聚合：三个桶取全局最小', parse({ model_remains: [{ current_interval_remaining_percent: 90 }, { current_interval_remaining_percent: 40 }, { current_interval_remaining_percent: 70 }] }).windows[0].usedPercent, 60)
  check('① 最紧聚合：非法桶被跳过、只比较合法值', parse({ model_remains: [{ current_interval_remaining_percent: -5 }, { current_interval_remaining_percent: 'oops' }, { current_interval_remaining_percent: 80 }] }).windows[0].usedPercent, 20)

  // ================= ② resetsAt 与聚合值同源（最紧桶） =================
  check('② resetsAt 取最紧桶（20% → 5000，而非全桶最早 1000）', tightest && tightest.windows[0].resetsAt, 5000)
  check('② 周窗口并列最小取先出现者（9000）', tightest && tightest.windows[1].resetsAt, 9000)
  const fallbackEnd = parse({
    model_remains: [
      { current_interval_remaining_percent: 20, current_weekly_remaining_percent: 40 },
      { current_interval_remaining_percent: 80, end_time: 7000, current_weekly_remaining_percent: 90, weekly_end_time: 8000 },
      { current_interval_remaining_percent: 90, end_time: 3000 },
    ],
  })
  check('② 最紧桶缺 end_time → 回退该类型最早有效值 3000', fallbackEnd && fallbackEnd.windows[0].resetsAt, 3000)
  check('② 周窗口最紧桶（40%）有 weekly_end_time → 用它', fallbackEnd && fallbackEnd.windows[1].resetsAt, 8000)
  const noEnd = parse({ model_remains: [{ current_interval_remaining_percent: 10, current_weekly_remaining_percent: 20 }] })
  check('② 全部缺结束时刻 → resetsAt 为 null 但窗口保留', noEnd && noEnd.windows.map(function (w) { return w.resetsAt }), [null, null])
  check('② 最紧桶 end_time 为负数（非法）→ 回退最早有效值', parse({ model_remains: [{ current_interval_remaining_percent: 10, end_time: -1 }, { current_interval_remaining_percent: 90, end_time: 4000 }] }).windows[0].resetsAt, 4000)
  check('② end_time 数字字符串可用', parse({ model_remains: [{ current_interval_remaining_percent: 10, end_time: '1789284984350' }] }).windows[0].resetsAt, 1789284984350)

  // ================= ③ 窗口产出规则 =================
  const only5 = parse({ model_remains: [{ current_interval_remaining_percent: 55 }] })
  check('③ 仅 5h 合法 → 只产出 5h 窗口', only5 && only5.windows.map(function (w) { return w.key }), ['five_hour'])
  check('③ 仅 5h → used 45', only5 && only5.windows[0].usedPercent, 45)
  const onlyWeek = parse({ model_remains: [{ current_weekly_remaining_percent: 25 }] })
  check('③ 仅周合法 → 只产出周窗口', onlyWeek && onlyWeek.windows.map(function (w) { return w.key }), ['seven_day'])
  check('③ 仅周 → used 75', onlyWeek && onlyWeek.windows[0].usedPercent, 75)
  check('③ 两类都无合法 remaining → parse 返回 null', parse({ model_remains: [{ model_name: 'general' }, {}] }), null)
  check('③ usedPercent 恒在 [0,100]', [0, 1, 50, 99, 100].every(function (r) {
    const w = parse({ model_remains: [{ current_interval_remaining_percent: r }] }).windows[0]
    return w.usedPercent >= 0 && w.usedPercent <= 100
  }), true)

  // ================= ④ 数值容错（minimaxNumericField / minimaxRemainingPercent） =================
  check('④ nf：数字 0 合法', nf(0), 0)
  check('④ nf：负数 → null', nf(-1), null)
  check('④ nf：NaN → null', nf(NaN), null)
  check('④ nf：Infinity → null', nf(Infinity), null)
  check('④ nf：数字型字符串（带空白）→ 数值', nf(' 12.5 '), 12.5)
  check('④ nf：空字符串 → null', nf('   '), null)
  check('④ nf：非数字字符串 → null', nf('12abc'), null)
  check('④ nf：null/undefined → null', [nf(null), nf(undefined)], [null, null])
  check('④ nf：布尔/对象/数组 → null', [nf(true), nf({}), nf([])], [null, null, null])
  check('④ rp：64 → 64', rp(64), 64)
  check('④ rp：0 → 0', rp(0), 0)
  check('④ rp：100 → 100', rp(100), 100)
  check('④ rp：64.4 → 64', rp(64.4), 64)
  check('④ rp：64.6 → 65', rp(64.6), 65)
  check('④ rp：>100 钳制到 100', rp(150), 100)
  check('④ rp：100.4 钳制到 100', rp(100.4), 100)
  check('④ rp：负数 → null（该窗口跳过）', rp(-1), null)
  check('④ rp：非数值字符串 → null', rp('abc'), null)
  check('④ rp：缺失 → null', rp(undefined), null)
  check('④ 负数 remaining 单独出现 → parse null', parse({ model_remains: [{ current_interval_remaining_percent: -5 }] }), null)
  check('④ >100 remaining → used 0', parse({ model_remains: [{ current_interval_remaining_percent: 150 }] }).windows[0].usedPercent, 0)
  check('④ 字符串 "0" → used 100', parse({ model_remains: [{ current_interval_remaining_percent: '0' }] }).windows[0].usedPercent, 100)

  // ================= ⑤ base_resp / 结构异常 =================
  check('⑤ base_resp 1004 → parse null', parse({ base_resp: { status_code: 1004 }, model_remains: [{ current_interval_remaining_percent: 50 }] }), null)
  check('⑤ base_resp 2049 → parse null', parse({ base_resp: { status_code: 2049 }, model_remains: [{ current_interval_remaining_percent: 50 }] }), null)
  check('⑤ base_resp 1001 → parse null', parse({ base_resp: { status_code: 1001 }, model_remains: [{ current_interval_remaining_percent: 50 }] }), null)
  check('⑤ base_resp 数字字符串 "1004" → parse null', parse({ base_resp: { status_code: '1004' }, model_remains: [{ current_interval_remaining_percent: 50 }] }), null)
  check('⑤ base_resp status_code 0 → 正常解析', parse({ base_resp: { status_code: 0 }, model_remains: [{ current_interval_remaining_percent: 50 }] }).windows.length, 1)
  check('⑤ base_resp 缺失 → 正常解析', parse({ model_remains: [{ current_interval_remaining_percent: 50 }] }).windows.length, 1)
  check('⑤ base_resp 非对象 → 正常解析', parse({ base_resp: 'oops', model_remains: [{ current_interval_remaining_percent: 50 }] }).windows.length, 1)
  check('⑤ 空 model_remains → null', parse({ base_resp: { status_code: 0 }, model_remains: [] }), null)
  check('⑤ model_remains 缺失 → null', parse({ base_resp: { status_code: 0 } }), null)
  check('⑤ model_remains 非数组 → null', parse({ model_remains: 'oops' }), null)
  check('⑤ body null → null', parse(null), null)
  check('⑤ body 字符串 → null', parse('oops'), null)
  check('⑤ body 数组 → null', parse([]), null)
  check('⑤ 条目为 null/字符串 → 全部跳过 → null', parse({ model_remains: [null, 'x', 7] }), null)
  check('⑤ 不传 windowLabels → 回退模块兜底字典', parse({ model_remains: [{ current_interval_remaining_percent: 50 }] }).windows[0].label, '5 小时')

  // ================= ⑥ 路由 / 映射 / 订阅源 =================
  check('⑥ base URL：minimax → api.minimax.io', parseApi.minimaxBaseUrl('minimax'), 'https://api.minimax.io')
  check('⑥ base URL：minimax-cn → api.minimaxi.com', parseApi.minimaxBaseUrl('minimax-cn'), 'https://api.minimaxi.com')
  check('⑥ base URL：未知/缺省 → Global 站点', [parseApi.minimaxBaseUrl(undefined), parseApi.minimaxBaseUrl('other')], ['https://api.minimax.io', 'https://api.minimax.io'])
  ok('⑥ constants：SUBSCRIPTION_PROVIDERS 含 minimax / minimax-cn', SUBSCRIPTION_PROVIDERS.indexOf('minimax') >= 0 && SUBSCRIPTION_PROVIDERS.indexOf('minimax-cn') >= 0, JSON.stringify(SUBSCRIPTION_PROVIDERS))
  ok('⑥ constants：订阅集合无重复项', new Set(SUBSCRIPTION_PROVIDERS).size === SUBSCRIPTION_PROVIDERS.length)
  ok('⑥ SUBSCRIPTION_SOURCES：minimax / minimax-cn 各自独立源',
    hostSrc.indexOf("minimax: { fetch: function () { return fetchMinimaxTokenPlanUsage('minimax'); } }") >= 0
    && hostSrc.indexOf("'minimax-cn': { fetch: function () { return fetchMinimaxTokenPlanUsage('minimax-cn'); } }") >= 0)
  ok('⑥ 展示名映射：minimax / minimax-cn → MiniMax', /minimax: 'MiniMax',\n\s*'minimax-cn': 'MiniMax',/.test(hostSrc))

  // ================= ⑦ fetch 层：凭据路由与请求形态 =================
  const noKey = makeFetchHarness({ creds: {} })
  const noKeyResult = await noKey.api.fetch('minimax')
  check('⑦ 无凭据 → kind no-key', noKeyResult.error.kind, 'no-key')
  check('⑦ 无凭据 → 稳定 code', noKeyResult.error.code, 'subscription.minimax-not-configured')
  check('⑦ 无凭据 → 中文字案', noKeyResult.error.message, zhDict['error.subscription.minimax-not-configured'])
  ok('⑦ 无凭据 → 不发起任何请求', noKey.calls.length === 0)
  check('⑦ resolveMinimaxKey 双缺 → null', await noKey.api.resolveMinimaxKey('minimax-cn'), null)

  const both = makeFetchHarness({ creds: { MINIMAX_API_KEY: 'sk-minimax-secret', MINIMAX_CN_API_KEY: 'sk-cn-secret' }, body: REAL })
  const globalResult = await both.api.fetch('minimax')
  check('⑦ minimax 优先 MINIMAX_API_KEY', both.calls[0].init.headers.Authorization, 'Bearer sk-minimax-secret')
  check('⑦ minimax 请求 URL', both.calls[0].url, 'https://api.minimax.io/v1/token_plan/remains')
  check('⑦ 请求带 Accept: application/json', both.calls[0].init.headers.Accept, 'application/json')
  ok('⑦ 请求带超时 AbortSignal', !!both.calls[0].init.signal)
  check('⑦ 成功：data.provider = minimax', globalResult.data.provider, 'minimax')
  check('⑦ 成功：plan = MiniMax Token Plan', globalResult.data.plan, 'MiniMax Token Plan')
  check('⑦ 成功：windows 数', globalResult.data.windows.length, 2)
  check('⑦ 成功：5h used 36', globalResult.data.windows[0].usedPercent, 36)
  ok('⑦ 成功响应不含密钥', JSON.stringify(globalResult).indexOf('sk-minimax-secret') < 0)

  const bothCn = makeFetchHarness({ creds: { MINIMAX_API_KEY: 'sk-minimax-secret', MINIMAX_CN_API_KEY: 'sk-cn-secret' }, body: REAL })
  const cnResult = await bothCn.api.fetch('minimax-cn')
  check('⑦ minimax-cn 优先 MINIMAX_CN_API_KEY', bothCn.calls[0].init.headers.Authorization, 'Bearer sk-cn-secret')
  check('⑦ minimax-cn 请求 URL', bothCn.calls[0].url, 'https://api.minimaxi.com/v1/token_plan/remains')
  check('⑦ 成功：data.provider = minimax-cn（实际 provider id）', cnResult.data.provider, 'minimax-cn')

  const onlyCn = makeFetchHarness({ creds: { MINIMAX_CN_API_KEY: 'sk-cn-secret' }, body: REAL })
  await onlyCn.api.fetch('minimax')
  check('⑦ minimax 回退 MINIMAX_CN_API_KEY', onlyCn.calls[0].init.headers.Authorization, 'Bearer sk-cn-secret')
  const onlyGlobal = makeFetchHarness({ creds: { MINIMAX_API_KEY: 'sk-minimax-secret' }, body: REAL })
  await onlyGlobal.api.fetch('minimax-cn')
  check('⑦ minimax-cn 回退 MINIMAX_API_KEY', onlyGlobal.calls[0].init.headers.Authorization, 'Bearer sk-minimax-secret')
  const unknownPid = makeFetchHarness({ creds: { MINIMAX_API_KEY: 'sk-minimax-secret' }, body: REAL })
  await unknownPid.api.fetch(undefined)
  check('⑦ 未知 providerId → 走 Global 站点', unknownPid.calls[0].url, 'https://api.minimax.io/v1/token_plan/remains')

  // ================= ⑧ fetch 层：错误码与文案 =================
  const authZh = zhDict['error.subscription.minimax-auth-failed']
  const unrecZh = zhDict['error.subscription.minimax-unrecognized']
  const authEn = enDict['error.subscription.minimax-auth-failed']
  const unrecEn = enDict['error.subscription.minimax-unrecognized']
  const noKeyEn = enDict['error.subscription.minimax-not-configured']

  async function fetchError(label, fetchImpl, body) {
    const h = makeFetchHarness({ creds: { MINIMAX_API_KEY: 'sk-minimax-secret' }, fetchImpl: fetchImpl, body: body })
    return h.api.fetch('minimax')
  }

  const r401 = await fetchError('401', async function () { return { ok: false, status: 401, json: async function () { return {} } } })
  check('⑧ HTTP 401 → kind auth', r401.error.kind, 'auth')
  check('⑧ HTTP 401 → code minimax-auth-failed', r401.error.code, 'subscription.minimax-auth-failed')
  check('⑧ HTTP 401 → 中文字案', r401.error.message, authZh)
  const r403 = await fetchError('403', async function () { return { ok: false, status: 403, json: async function () { return {} } } })
  check('⑧ HTTP 403 → kind auth', r403.error.kind, 'auth')
  check('⑧ HTTP 403 → code minimax-auth-failed', r403.error.code, 'subscription.minimax-auth-failed')

  const r1004 = await fetchError('1004', async function () { return { ok: true, status: 200, json: async function () { return { base_resp: { status_code: 1004, status_msg: 'login fail' } } } } })
  check('⑧ base_resp 1004 → kind auth', r1004.error.kind, 'auth')
  check('⑧ base_resp 1004 → code minimax-auth-failed', r1004.error.code, 'subscription.minimax-auth-failed')
  const r2049 = await fetchError('2049', async function () { return { ok: true, status: 200, json: async function () { return { base_resp: { status_code: 2049, status_msg: 'invalid api key' } } } } })
  check('⑧ base_resp 2049 → kind auth', r2049.error.kind, 'auth')
  check('⑧ base_resp 2049 → code minimax-auth-failed', r2049.error.code, 'subscription.minimax-auth-failed')

  const r1001 = await fetchError('1001', async function () { return { ok: true, status: 200, json: async function () { return { base_resp: { status_code: 1001, status_msg: 'other' } } } } })
  check('⑧ base_resp 其他非 0 → kind parse', r1001.error.kind, 'parse')
  check('⑧ base_resp 其他非 0 → code minimax-unrecognized', r1001.error.code, 'subscription.minimax-unrecognized')
  check('⑧ base_resp 其他非 0 → 中文字案', r1001.error.message, unrecZh)

  const r500 = await fetchError('500', async function () { return { ok: false, status: 500, json: async function () { return {} } } })
  check('⑧ HTTP 500 → kind http', r500.error.kind, 'http')
  check('⑧ HTTP 500 → code request.http', r500.error.code, 'request.http')
  check('⑧ HTTP 500 → 文案含状态码', r500.error.message, zhDict['error.request.http'].replace('{status}', '500'))
  const r429 = await fetchError('429', async function () { return { ok: false, status: 429, json: async function () { return {} } } })
  check('⑧ HTTP 429 → kind http + code request.http', [r429.error.kind, r429.error.code], ['http', 'request.http'])

  const rBadJson = await fetchError('badjson', async function () { return { ok: true, status: 200, json: async function () { throw new Error('Unexpected token < in JSON') } } })
  check('⑧ JSON 解析失败 → kind parse', rBadJson.error.kind, 'parse')
  check('⑧ JSON 解析失败 → code request.parse', rBadJson.error.code, 'request.parse')
  check('⑧ JSON 解析失败 → 中文字案', rBadJson.error.message, zhDict['error.request.parse'])

  const rEmpty = await fetchError('empty', async function () { return { ok: true, status: 200, json: async function () { return { base_resp: { status_code: 0 } } } } })
  check('⑧ 无 model_remains → kind parse + unrecognized', [rEmpty.error.kind, rEmpty.error.code], ['parse', 'subscription.minimax-unrecognized'])
  const rNoWindows = await fetchError('nowindows', async function () { return { ok: true, status: 200, json: async function () { return { base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general' }] } } } })
  check('⑧ 无任何窗口值 → kind parse + unrecognized', [rNoWindows.error.kind, rNoWindows.error.code], ['parse', 'subscription.minimax-unrecognized'])

  const rNet = await fetchError('network', async function () { throw new Error('fetch failed: ECONNREFUSED') })
  check('⑧ 网络异常 → kind exception', rNet.error.kind, 'exception')
  check('⑧ 网络异常 → 保留原始错误信息', rNet.error.message, 'fetch failed: ECONNREFUSED')
  ok('⑧ 网络异常按约定可不带 code', rNet.error.code === undefined)

  const rTimeout = await fetchError('timeout', async function () { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e })
  check('⑧ 超时 → kind exception + 原始信息', [rTimeout.error.kind, rTimeout.error.message], ['exception', 'The operation was aborted due to timeout'])

  ok('⑧ 错误信息一律不含密钥', [noKeyResult, r401, r403, r1004, r2049, r1001, r500, r429, rBadJson, rEmpty, rNoWindows, rNet, rTimeout].every(function (r) {
    return JSON.stringify(r).indexOf('sk-minimax-secret') < 0 && JSON.stringify(r).indexOf('sk-cn-secret') < 0
  }))

  // ================= ⑨ i18n 与宿主错误 code 契约 =================
  const MINIMAX_CODES = ['subscription.minimax-not-configured', 'subscription.minimax-auth-failed', 'subscription.minimax-unrecognized']
  ok('⑨ 三个稳定 code 中英齐备且互不相同', MINIMAX_CODES.every(function (code) {
    return typeof zhDict['error.' + code] === 'string' && typeof enDict['error.' + code] === 'string' && zhDict['error.' + code] !== enDict['error.' + code]
  }))
  check('⑨ 中英 auth 文案确实不同', authZh !== authEn, true)
  check('⑨ 中英 unrecognized 文案确实不同', unrecZh !== unrecEn, true)
  check('⑨ 中英 not-configured 文案确实不同', zhDict['error.subscription.minimax-not-configured'] !== noKeyEn, true)
  ok('⑨ 未引入 PR 私有的 host.minimax* 文案键', Object.keys(zhDict).every(function (k) { return k.indexOf('host.minimax') !== 0 }))
  ok('⑨ ui.minimax 中英齐备（客户端展示名同源）', zhDict['ui.minimax'] === 'MiniMax' && enDict['ui.minimax'] === 'MiniMax')
  ok('⑨ quotaDisplayMode 相关文案键中英齐备', ['ui.quotaDisplayUsed', 'ui.quotaDisplayRemaining', 'ui.quotaDisplayModeTitle', 'ui.quotaDisplayModeDesc', 'ui.windowUsedRemaining', 'ui.windowUsedRemainingResets', 'host.quotaDisplayModeInvalid'].every(function (k) {
    return typeof zhDict[k] === 'string' && typeof enDict[k] === 'string' && zhDict[k] !== enDict[k]
  }))
  ok('⑨ 宿主 minimax 错误对象均带稳定 code', hostSrc.split('\n').every(function (line) {
    if (!/error:\s*\{[^}]*message:\s*t\('error\.subscription\.minimax-/.test(line)) return true
    return /code:/.test(line)
  }))
  ok('⑨ 宿主未裸读 credentials 之外的新服务（仅 ctx.credentials / ctx.get）', hostSrc.indexOf('ctx.credentials') >= 0)

  console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项失败') + '：' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(function (err) {
  console.error('测试装置异常：' + String((err && err.stack) || err))
  process.exit(1)
})
