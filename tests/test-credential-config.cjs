// 设置页「额度凭据」目录驱动实现单测（v1.24.0）
// 覆盖：
//  A) CREDENTIAL_CATALOG 结构契约：17 条、字段类型、ref 正则与全局唯一、mode/verification 合法、
//     providers 合法且不重复、已适配的订阅/账单 provider 全部登记、host 白名单由目录派生、构建注入
//  B) 值校验：trim 后空 / 内部空白 / 换行制表符 / 非 ASCII / 控制字符 / 超长拒绝；512 边界通过
//  C) ref 白名单：目录全部 ref 可写、目录外一律拒绝
//  D) describeCredentialConfig：items 扁平视图 / groups 按目录分组（仅 inline）/ footnoteKey /
//     canWrite / kimiLogin{configured}，以及 describe 抛错、回退 resolve 的降级
//  E) ROUTES：getCredentialConfig / setCredential / clearCredential 的成功与
//     invalid-ref / invalid-value / write-unsupported / write-failed 语义 + 目录驱动刷新订阅源
//  F) Kimi OAuth 复用：resolveKimiCodingKey 顺序（ref 名单 → 环境变量 → readRecord 兜底），过期不返回
//  G) 客户端静态与行为：rows 来自 state.groups / 目录 fallback（仅 inline）、password 输入框、
//     保存成功广播重拉、canWrite 警示、kimiLogin 复用态、locale 键
//  H) 密钥不外泄：任何返回/错误对象都不含测试用凭据值
// 用例编号在各段落内递增；失败信息含编号与期望/实际，可直接定位。
// 用法：node tests/test-credential-config.cjs
const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { dictionaries } = require('./locale-fixture.cjs')

const root = join(__dirname, '..')
const hostSrc = readFileSync(join(root, 'src', 'host.js'), 'utf8')
const constantsSrc = readFileSync(join(root, 'src', 'constants.js'), 'utf8')
const clientSrc = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')
const buildSrc = readFileSync(join(root, 'scripts', 'build.mjs'), 'utf8')
const zhDict = dictionaries.zh
const enDict = dictionaries.en

// ---- 源码抽取工具（测真身，不复制实现） ----
function extractFn(src, name) {
  let start = src.indexOf('function ' + name)
  if (start < 0) throw new Error('未找到 function ' + name)
  if (src.slice(start - 6, start) === 'async ') start -= 6
  let depth = 0, i = start, inStr = null
  while (i < src.length) {
    const c = src[i]
    if (inStr) {
      if (c === '\\') { i += 2; continue }
      if (c === inStr) inStr = null
    } else if (c === '"' || c === "'" || c === String.fromCharCode(96)) {
      inStr = c
    } else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
    i++
  }
  return src.slice(start, i + 1)
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
    } else if (c === '"' || c === "'" || c === String.fromCharCode(96)) {
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
// ROUTES 里的对象方法：<name>: async function (args) { ... }
function extractRouteFn(src, name) {
  const marker = name + ': async function ('
  const at = src.indexOf(marker)
  if (at < 0) throw new Error('未找到 ROUTES.' + name)
  const start = src.indexOf('async function', at)
  const from = src.indexOf('{', start)
  let depth = 0, i = from, inStr = null
  while (i < src.length) {
    const c = src[i]
    if (inStr) {
      if (c === '\\') { i += 2; continue }
      if (c === inStr) inStr = null
    } else if (c === '"' || c === "'" || c === String.fromCharCode(96)) {
      inStr = c
    } else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
    i++
  }
  return src.slice(start, i + 1)
}

const CREDENTIAL_VALUE_MAX_LEN = Number((hostSrc.match(/const CREDENTIAL_VALUE_MAX_LEN = (\d+)/) || [])[1])
const KIMI_CODING_RECORD_KEY = (hostSrc.match(/const KIMI_CODING_RECORD_KEY = '([^']+)'/) || [])[1]
const KIMI_CODING_CREDENTIAL_NAMES = eval('(' + extractBracketed(hostSrc, 'const KIMI_CODING_CREDENTIAL_NAMES = ') + ')')
const MUTATING = eval('(' + extractBraced(hostSrc, 'const MUTATING = ') + ')')

const SECRET = 'LTAI-SECRET-value-never-leak-12345'
const KIMI_VALUE = 'sk-kimi-value-never-leak-67890'
const OAUTH_TOKEN = 'oauth-access-token-never-leak-abc'

const ENV_NAME_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_'
const ENV_NAME_FIRST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_'
function isEnvName(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  if (ENV_NAME_FIRST.indexOf(value.charAt(0)) < 0) return false
  for (let i = 1; i < value.length; i++) if (ENV_NAME_CHARS.indexOf(value.charAt(i)) < 0) return false
  return true
}

function tStub(key, params) {
  const raw = zhDict[key]
  if (typeof raw !== 'string') throw new Error('未预期的 i18n key: ' + key)
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, function (m, name) {
    return params[name] !== undefined ? String(params[name]) : m
  })
}

// ---- 宿主装置：抽 apply 内纯函数 + ROUTES 三方法，注入桩 ctx / 订阅引擎 / 目录常量 ----
function makeHostApi(C, options) {
  const opts = options || {}
  const calls = { describe: [], resolve: [], set: [], unset: [], readRecord: [], markRequested: [], kick: [] }
  const credentials = {}
  if (opts.describe !== undefined) credentials.describe = async function (ref) { calls.describe.push(ref); return opts.describe(ref) }
  if (opts.resolve !== undefined) credentials.resolve = async function (ref) { calls.resolve.push(ref); return opts.resolve(ref) }
  if (opts.set !== undefined) credentials.set = async function (ref, value) { calls.set.push([ref, value]); return opts.set(ref, value) }
  if (opts.unset !== undefined) credentials.unset = async function (ref) { calls.unset.push(ref); return opts.unset(ref) }
  if (opts.readRecord !== undefined) credentials.readRecord = async function (key) { calls.readRecord.push(key); return opts.readRecord(key) }
  const engine = opts.engine || {
    markRequested: function (key) { calls.markRequested.push(key) },
    kick: async function (key, provider) { calls.kick.push([key, provider]) },
  }
  const sourceProvider = opts.sourceProvider || {}
  const factory = eval(
    '(function (ctx, subscriptionEngine, subscriptionSourceProvider, CREDENTIAL_CATALOG,'
    + ' CREDENTIAL_CONFIG_REFS, subscriptionSourceFor, PROVIDER_IDENTITY) {'
    + 'const CREDENTIAL_VALUE_MAX_LEN = ' + CREDENTIAL_VALUE_MAX_LEN + ';'
    + 'const KIMI_CODING_RECORD_KEY = ' + JSON.stringify(KIMI_CODING_RECORD_KEY) + ';'
    + extractFn(hostSrc, 'credentialConfigRef')
    + extractFn(hostSrc, 'credentialConfigValue')
    + extractFn(hostSrc, 'describeCredentialRef')
    + extractFn(hostSrc, 'readKimiCodingRecordToken')
    + extractFn(hostSrc, 'describeCredentialConfig')
    + extractFn(hostSrc, 'refreshSubscriptionAfterCredential')
    + 'return {'
    + ' credentialConfigRef: credentialConfigRef, credentialConfigValue: credentialConfigValue,'
    + ' describeCredentialRef: describeCredentialRef, describeCredentialConfig: describeCredentialConfig,'
    + ' refreshSubscriptionAfterCredential: refreshSubscriptionAfterCredential,'
    + ' getCredentialConfig: ' + extractRouteFn(hostSrc, 'getCredentialConfig') + ','
    + ' setCredential: ' + extractRouteFn(hostSrc, 'setCredential') + ','
    + ' clearCredential: ' + extractRouteFn(hostSrc, 'clearCredential')
    + ' } })'
  )
  const api = factory({ credentials: credentials }, engine, sourceProvider,
    C.CREDENTIAL_CATALOG, C.CREDENTIAL_CONFIG_REFS, C.subscriptionSourceFor, C.PROVIDER_IDENTITY)
  return { api: api, calls: calls, sourceProvider: sourceProvider, credentials: credentials }
}

// ---- Kimi 凭据解析装置（ref 名单 → 环境变量 → readRecord 兜底） ----
function makeKimiKeyApi(options) {
  const opts = options || {}
  const calls = { resolve: [], readRecord: [] }
  const credentials = {}
  if (opts.resolve !== undefined) credentials.resolve = async function (name) { calls.resolve.push(name); return opts.resolve(name) }
  if (opts.readRecord !== undefined) credentials.readRecord = async function (key) { calls.readRecord.push(key); return opts.readRecord(key) }
  const factory = eval(
    '(function (ctx, process) {'
    + 'const KIMI_CODING_CREDENTIAL_NAMES = ' + JSON.stringify(KIMI_CODING_CREDENTIAL_NAMES) + ';'
    + 'const KIMI_CODING_RECORD_KEY = ' + JSON.stringify(KIMI_CODING_RECORD_KEY) + ';'
    + extractFn(hostSrc, 'processEnvValue')
    + extractFn(hostSrc, 'readKimiCodingRecordToken')
    + extractFn(hostSrc, 'resolveKimiCodingKey')
    + 'return { resolveKimiCodingKey: resolveKimiCodingKey, readKimiCodingRecordToken: readKimiCodingRecordToken } })'
  )
  return { api: factory({ credentials: credentials }, { env: Object.assign({}, opts.env || {}) }), calls: calls }
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
  const constants = await import(pathToFileURL(join(root, 'src', 'constants.js')).href)
  const C = {
    CREDENTIAL_CATALOG: constants.CREDENTIAL_CATALOG,
    SUBSCRIPTION_PROVIDERS: constants.SUBSCRIPTION_PROVIDERS,
    BILLING_PROVIDERS: constants.BILLING_PROVIDERS,
    DSH_PRESET_PROVIDERS: constants.DSH_PRESET_PROVIDERS,
    PROVIDER_IDENTITY: constants.PROVIDER_IDENTITY,
  }
  const PROVIDER_IDENTITY = C.PROVIDER_IDENTITY
  // host 的 PROFILE 里 subscriptionSourceFor 是模块级纯函数（依赖 PROVIDER_IDENTITY）
  C.subscriptionSourceFor = eval('(function (PROVIDER_IDENTITY) { ' + extractFn(hostSrc, 'subscriptionSourceFor')
    + ' return subscriptionSourceFor })')(PROVIDER_IDENTITY)
  // 真身派生 CREDENTIAL_CONFIG_REFS：直接求值 host 源码里的 reduce 表达式
  const refsExprStart = hostSrc.indexOf('const CREDENTIAL_CONFIG_REFS = ')
  const refsExprEnd = hostSrc.indexOf('const CREDENTIAL_VALUE_MAX_LEN', refsExprStart)
  if (refsExprStart < 0 || refsExprEnd < 0) throw new Error('未找到 CREDENTIAL_CONFIG_REFS 派生表达式')
  const refsExpr = hostSrc.slice(refsExprStart + 'const CREDENTIAL_CONFIG_REFS = '.length, refsExprEnd).trim()
  C.CREDENTIAL_CONFIG_REFS = eval('(function (CREDENTIAL_CATALOG) { return (' + refsExpr + ') })')(C.CREDENTIAL_CATALOG)

  const catalog = C.CREDENTIAL_CATALOG
  const allRefs = []
  for (const entry of catalog) {
    for (const credential of entry.credentials || []) if (allRefs.indexOf(credential.ref) < 0) allRefs.push(credential.ref)
  }
  const inlineRefs = []
  for (const entry of catalog) {
    for (const credential of entry.credentials || []) if (credential.inline === true && inlineRefs.indexOf(credential.ref) < 0) inlineRefs.push(credential.ref)
  }
  const inlineEntries = catalog.filter(function (entry) {
    return (entry.credentials || []).some(function (c) { return c && c.inline === true })
  })
  const allowedProviders = new Set([].concat(C.DSH_PRESET_PROVIDERS, Object.keys(PROVIDER_IDENTITY), ['deepseek-account']))
  const SECRETS = [SECRET, KIMI_VALUE, OAUTH_TOKEN]
  function leaks(value) {
    const text = JSON.stringify(value)
    return SECRETS.some(function (secret) { return text.indexOf(secret) >= 0 })
  }

  // ================= A) CREDENTIAL_CATALOG 结构契约 =================
  ok('A1 目录至少 17 条（冻结规格 17 条）', catalog.length >= 17, String(catalog.length))
  const catalogIds = catalog.map(function (entry) { return entry.id })
  check('A2 id 全局唯一', catalogIds.length, new Set(catalogIds).size)
  ok('A3 id 非空且只含小写字母/数字/连字符', catalogIds.every(function (id) {
    if (typeof id !== 'string' || id.length === 0) return false
    for (let i = 0; i < id.length; i++) if ('abcdefghijklmnopqrstuvwxyz0123456789-'.indexOf(id.charAt(i)) < 0) return false
    return true
  }), JSON.stringify(catalogIds))
  const MODES = ['subscription', 'balance', 'billing']
  const VERIFICATIONS = ['live', 'third-party', 'unverified']
  check('A4 每条 mode 都在三种口径内', catalog.map(function (entry) { return entry.mode }).filter(function (mode) { return MODES.indexOf(mode) < 0 }), [])
  check('A5 每条 official 都是 boolean', catalog.map(function (entry) { return typeof entry.official }).filter(function (t) { return t !== 'boolean' }), [])
  check('A6 每条 verification 都在三种可信度内', catalog.map(function (entry) { return entry.verification }).filter(function (v) { return VERIFICATIONS.indexOf(v) < 0 }), [])
  check('A7 每条恰有 labelKey 或 label 之一', catalog.map(function (entry) {
    const hasKey = typeof entry.labelKey === 'string' && entry.labelKey.length > 0
    const hasLabel = typeof entry.label === 'string' && entry.label.length > 0
    return hasKey !== hasLabel
  }).filter(function (good) { return good !== true }).length, 0)
  check('A8 labelKey 必须在 zh/en 字典存在', catalog.filter(function (entry) {
    return typeof entry.labelKey === 'string' && (typeof zhDict[entry.labelKey] !== 'string' || typeof enDict[entry.labelKey] !== 'string')
  }).map(function (entry) { return entry.labelKey }), [])
  const ENTRY_KEYS = ['id', 'labelKey', 'label', 'mode', 'providers', 'credentials', 'detectRefs', 'oauthRecord', 'official', 'verification', 'noteKey']
  check('A9 目录条目不允许未知字段', catalog.map(function (entry) {
    return Object.keys(entry).filter(function (key) { return ENTRY_KEYS.indexOf(key) < 0 })
  }).reduce(function (acc, list) { return acc.concat(list) }, []), [])
  check('A9b detectRefs 若存在必须是环境变量名形态的字符串数组', catalog.map(function (entry) {
    if (entry.detectRefs === undefined) return true
    return Array.isArray(entry.detectRefs) && entry.detectRefs.every(function (ref) { return isEnvName(ref) })
  }).filter(function (good) { return good !== true }).length, 0)
  check('A10 providers 是字符串数组', catalog.map(function (entry) { return Array.isArray(entry.providers) }).filter(function (isArray) { return isArray !== true }), [])
  check('A11 providers 内不重复', catalog.map(function (entry) { return new Set(entry.providers || []).size === (entry.providers || []).length }).filter(function (good) { return good !== true }).length, 0)
  const badProviders = []
  for (const entry of catalog) for (const provider of entry.providers || []) if (!allowedProviders.has(provider)) badProviders.push(entry.id + ':' + provider)
  check('A12 所有 provider 都在 DSH 预置/身份表/已知账户集合内', badProviders, [])
  const VALIDATION_ERRORS = {
    subscription: C.SUBSCRIPTION_PROVIDERS.filter(function (provider) {
      return !catalog.some(function (entry) { return (entry.providers || []).indexOf(provider) >= 0 })
    }),
    billing: C.BILLING_PROVIDERS.filter(function (provider) {
      return !catalog.some(function (entry) { return (entry.providers || []).indexOf(provider) >= 0 })
    }),
  }
  check('A13 每个 SUBSCRIPTION_PROVIDERS 都至少登记在一条目录里（新增也不许漏）', VALIDATION_ERRORS.subscription, [])
  check('A14 每个 BILLING_PROVIDERS 都至少登记在一条目录里', VALIDATION_ERRORS.billing, [])
  const CREDENTIAL_KEYS = ['ref', 'labelKey', 'hintKey', 'inline', 'generic']
  const badCredentialFields = []
  const badCredentialRefs = []
  for (const entry of catalog) {
    for (const credential of entry.credentials || []) {
      for (const key of Object.keys(credential)) if (CREDENTIAL_KEYS.indexOf(key) < 0) badCredentialFields.push(entry.id + ':' + key)
      if (!isEnvName(credential.ref)) badCredentialRefs.push(entry.id + ':' + String(credential.ref))
      if (typeof credential.inline !== 'boolean') badCredentialFields.push(entry.id + ':inline')
      if (credential.generic !== undefined && typeof credential.generic !== 'boolean') badCredentialFields.push(entry.id + ':generic')
      if (credential.labelKey !== undefined && typeof credential.labelKey !== 'string') badCredentialFields.push(entry.id + ':labelKey')
      if (credential.hintKey !== undefined && typeof credential.hintKey !== 'string') badCredentialFields.push(entry.id + ':hintKey')
    }
  }
  check('A15 凭据条目不允许未知字段/类型错误', badCredentialFields, [])
  check('A16 所有 ref 符合 /^[A-Za-z_][A-Za-z0-9_]*$/（环境变量名形态）', badCredentialRefs, [])
  check('A17 ref 在整张目录内全局唯一（含 inline 不重复）', allRefs.length, (function () {
    const flat = []
    for (const entry of catalog) for (const credential of entry.credentials || []) flat.push(credential.ref)
    return new Set(flat).size
  })())
  check('A18 inline 为 boolean 且 inline 集合非空、非 inline 也真实存在',
    [inlineRefs.length > 0, inlineRefs.length < allRefs.length], [true, true])
  check('A19 inline 凭据的 labelKey/hintKey 若存在必须在 zh/en 字典存在', catalog.reduce(function (bad, entry) {
    for (const credential of entry.credentials || []) {
      if (credential.inline !== true) continue
      for (const key of ['labelKey', 'hintKey']) {
        const value = credential[key]
        if (value !== undefined && (typeof zhDict[value] !== 'string' || typeof enDict[value] !== 'string')) bad.push(entry.id + ':' + value)
      }
    }
    return bad
  }, []), [])
  check('A20 oauthRecord 若存在必须是非空字符串', catalog.filter(function (entry) {
    return entry.oauthRecord !== undefined && (typeof entry.oauthRecord !== 'string' || entry.oauthRecord.length === 0)
  }).map(function (entry) { return entry.id }), [])
  check('A21 noteKey 若存在必须在 zh/en 字典存在', catalog.filter(function (entry) {
    return typeof entry.noteKey === 'string' && (typeof zhDict[entry.noteKey] !== 'string' || typeof enDict[entry.noteKey] !== 'string')
  }).map(function (entry) { return entry.id }), [])
  const alibabaEntry = catalog.filter(function (entry) { return entry.id === 'alibaba' })[0]
  const kimiEntry = catalog.filter(function (entry) { return entry.id === 'kimi-coding' })[0]
  ok('A22 阿里三条额度 provider 都登记在 alibaba 目录', ['qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual'].every(function (provider) {
    return alibabaEntry.providers.indexOf(provider) >= 0
  }))
  check('A23 kimi-coding 的 oauthRecord 与 host 只读凭据记录键一致', [kimiEntry.oauthRecord, KIMI_CODING_RECORD_KEY],
    ['llm-pi-ai/kimi-coding', 'llm-pi-ai/kimi-coding'])
  ok('A24 三个原内联 ref 仍是 inline（阿里 ID/Secret + Kimi Key）',
    ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'KIMI_API_KEY'].every(function (ref) {
      return inlineRefs.indexOf(ref) >= 0
    }), JSON.stringify(inlineRefs))
  check('A25 host 的 CREDENTIAL_CONFIG_REFS 与目录 inline ref 去重结果逐项一致（白名单只收 inline，2026-11-12 收紧）', C.CREDENTIAL_CONFIG_REFS, inlineRefs)
  ok('A26 host 白名单确实由 CREDENTIAL_CATALOG.reduce 派生（源码守卫）',
    hostSrc.indexOf('const CREDENTIAL_CONFIG_REFS = CREDENTIAL_CATALOG.reduce(') >= 0
    && hostSrc.indexOf("import { CREDENTIAL_CATALOG") >= 0)
  ok('A27 ROUTES 注册 getCredentialConfig / setCredential / clearCredential',
    hostSrc.indexOf('getCredentialConfig: async function') >= 0
    && hostSrc.indexOf('setCredential: async function') >= 0
    && hostSrc.indexOf('clearCredential: async function') >= 0)
  check('A28 MUTATING：setCredential / clearCredential 均为 true', [MUTATING.setCredential, MUTATING.clearCredential], [true, true])
  ok('A29 build.mjs 从 constants.js 提取并注入 CREDENTIAL_CATALOG',
    buildSrc.indexOf("extractLiteral('CREDENTIAL_CATALOG')") >= 0
    && buildSrc.indexOf('__CREDENTIAL_CATALOG__') >= 0)
  ok('A30 client-bundle 保留构建注入占位符',
    clientSrc.indexOf('const CREDENTIAL_CATALOG = /*__CREDENTIAL_CATALOG__*/[];') >= 0)
  const libClientPath = join(root, 'lib', 'client.js')
  if (existsSync(libClientPath)) {
    const libClient = readFileSync(libClientPath, 'utf8')
    ok('A31 lib/client.js 已注入目录（无占位符残留）', libClient.indexOf('__CREDENTIAL_CATALOG__') < 0)
    const libCatalogLiteral = (function () {
      const at = libClient.indexOf('const CREDENTIAL_CATALOG = ')
      if (at < 0) return null
      const from = libClient.indexOf('[', at)
      let depth = 0, i = from, inStr = null
      while (i < libClient.length) {
        const c = libClient[i]
        if (inStr) { if (c === '\\') { i += 2; continue } if (c === inStr) inStr = null }
        else if (c === '"' || c === "'" || c === String.fromCharCode(96)) inStr = c
        else if (c === '[') depth++
        else if (c === ']') { depth--; if (depth === 0) break }
        i++
      }
      return libClient.slice(from, i + 1)
    })()
    check('A32 lib/client.js 注入的目录与 src 目录一致',
      libCatalogLiteral ? eval('(' + libCatalogLiteral + ')').map(function (e) { return e.id }) : null, catalogIds)
  }

  // ================= B) 值校验 =================
  const baseHost = makeHostApi(C, { describe: function () { return { configured: false, source: null, writable: true } }, set: async function () {}, unset: async function () {} })
  const value = function (raw) { return baseHost.api.credentialConfigValue({ value: raw }) }
  const LF = String.fromCharCode(10)
  const CR = String.fromCharCode(13)
  const TAB = String.fromCharCode(9)
  const DEL = String.fromCharCode(127)
  check('B1 合法值返回 trim 结果', value('  LTAIabc123  '), 'LTAIabc123')
  check('B2 空串拒绝', value(''), null)
  check('B3 全空白拒绝', value('   ' + TAB + '  '), null)
  check('B4 内部空格拒绝', value('a b'), null)
  check('B5 内部换行拒绝', value('a' + LF + 'b'), null)
  check('B6 内部制表符拒绝', value('a' + TAB + 'b'), null)
  check('B7 内部回车拒绝', value('a' + CR + 'b'), null)
  check('B8 非 ASCII 拒绝（避免写坏 YAML）', [value('密钥'), value('ümlaut')], [null, null])
  check('B9 控制字符 DEL 拒绝', value('abc' + DEL), null)
  check('B10 512 字符边界通过', (value('x'.repeat(CREDENTIAL_VALUE_MAX_LEN)) || '').length, CREDENTIAL_VALUE_MAX_LEN)
  check('B11 超长 513 拒绝', value('x'.repeat(CREDENTIAL_VALUE_MAX_LEN + 1)), null)
  check('B12 超长全空白按空值拒绝', value(' '.repeat(CREDENTIAL_VALUE_MAX_LEN + 1)), null)
  check('B13 可打印 ASCII 特殊字符通过', ['a=b+c_d-e.f', '~!@#%^&*()', 'LTAI5tAbC123'].map(value),
    ['a=b+c_d-e.f', '~!@#%^&*()', 'LTAI5tAbC123'])
  check('B14 非字符串 value 拒绝', [value(42), value(null), value({}), value([1])], [null, null, null, null])
  check('B15 缺 args / 非对象 args 拒绝',
    [baseHost.api.credentialConfigValue(), baseHost.api.credentialConfigValue(null), baseHost.api.credentialConfigValue('abc')],
    [null, null, null])
  check('B16 宿主上限常量 = 512', CREDENTIAL_VALUE_MAX_LEN, 512)

  // ================= C) ref 白名单（目录派生，只收 inline） =================
  check('C1 目录 inline ref 都可写、非 inline ref 一律拒绝（推理 Key 走 DSH 设置 → 模型，不开放第二入口）',
    allRefs.map(function (ref) {
      const accepted = baseHost.api.credentialConfigRef({ ref: ref })
      return inlineRefs.indexOf(ref) >= 0 ? accepted === ref : accepted === null
    }).filter(function (good) { return good !== true }).length, 0)
  check('C2 目录外 ref 拒绝', ['DEEPSEEK_API_KEY', 'NOT_IN_CATALOG', 'KIMI_API_KEY/x', ' kimi ', 'KIMI_API_KEY ', 'kimi_api_key'].map(function (ref) {
    return baseHost.api.credentialConfigRef({ ref: ref })
  }), [null, null, null, null, null, null])
  check('C3 非字符串 / 缺参拒绝',
    [baseHost.api.credentialConfigRef({ ref: 42 }), baseHost.api.credentialConfigRef({ ref: null }), baseHost.api.credentialConfigRef(), baseHost.api.credentialConfigRef(null)],
    [null, null, null, null])
  check('C4 白名单条数 = 目录 inline 去重 ref 数', C.CREDENTIAL_CONFIG_REFS.length, inlineRefs.length)

  // ================= D) describeCredentialConfig =================
  function describeStub(ref) {
    if (ref === 'KIMI_API_KEY') return { configured: true, source: 'file', writable: true }
    if (ref === 'MINIMAX_API_KEY') return { configured: true, source: 'env', writable: false }
    return { configured: false, source: null, writable: true }
  }
  const describeHost = makeHostApi(C, {
    describe: describeStub,
    set: async function () {},
    unset: async function () {},
    readRecord: function () { return { payload: { access: OAUTH_TOKEN } } },
  })
  const described = await describeHost.api.describeCredentialConfig()
  check('D1 describeCredentialConfig 顶层字段固定', Object.keys(described).sort(), ['bound', 'canWrite', 'footnoteKey', 'groups', 'items', 'kimiLogin', 'total'])
  check('D2 items 是目录 inline ref 的扁平视图', described.items.map(function (item) { return item.ref }), inlineRefs)
  check('D3 items 每项字段固定为 ref/configured/source/writable',
    described.items.map(function (item) { return Object.keys(item).sort().join(',') }).filter(function (keys) { return keys !== 'configured,ref,source,writable' }), [])
  check('D4 items 状态来自 describe', [described.items.filter(function (i) { return i.ref === 'KIMI_API_KEY' })[0],
    described.items.filter(function (i) { return i.ref === 'MINIMAX_API_KEY' })[0]],
    [{ ref: 'KIMI_API_KEY', configured: true, source: 'file', writable: true },
      { ref: 'MINIMAX_API_KEY', configured: true, source: 'env', writable: false }])
  // D5（2026-11-12）：groups 仍只含 inline 组，但按「bound 优先、同内保持目录顺序」排序。
  // stub 里 KIMI_API_KEY / MINIMAX_API_KEY 已配置 → kimi-coding、minimax bound=true 排前面。
  const expectedGroupOrder = ['kimi-coding', 'minimax', 'alibaba', 'xiaomi-token-plan', 'command-code', 'opencode-go']
  check('D5 groups 只含 inline 组且按 bound 优先排序（同内保持目录顺序）', described.groups.map(function (g) { return g.id }), expectedGroupOrder)
  check('D5b bound/total 与逐组 bound 值',
    [described.bound, described.total, described.groups.map(function (g) { return g.bound })],
    [2, 6, [true, true, false, false, false, false]])
  check('D6 groups 每项字段固定为 bound/id/labelKey/label/mode/credentials',
    described.groups.map(function (g) { return Object.keys(g).sort().join(',') }).filter(function (keys) { return keys !== 'bound,credentials,id,label,labelKey,mode' }), [])
  // D6b（2026-11-12）：detectRefs 命中即 bound —— 用户没填 Token Plan Key，但 DSH 设置 → 模型
  // 里配了小米推理 Key（stub describe 命中 XIAOMI_API_KEY），xiaomi-token-plan 仍算「已绑定」。
  const detectStub = function (ref) {
    if (ref === 'XIAOMI_API_KEY') return { configured: true, source: 'env', writable: false }
    return { configured: false, source: null, writable: true }
  }
  const detectHost = makeHostApi(C, {
    describe: detectStub,
    set: async function () {},
    unset: async function () {},
    readRecord: function () { return { payload: { access: OAUTH_TOKEN } } },
  })
  const detectDescribed = await detectHost.api.describeCredentialConfig()
  const detectXiaomi = detectDescribed.groups.filter(function (g) { return g.id === 'xiaomi-token-plan' })[0]
  check('D6b detectRefs 命中推理 Key → 该组 bound=true（inline 凭据全未配置）',
    [detectXiaomi.bound, detectXiaomi.credentials.every(function (c) { return c.configured === false })], [true, true])
  const alibabaGroup = described.groups.filter(function (g) { return g.id === 'alibaba' })[0]
  const opencodeGroup = described.groups.filter(function (g) { return g.id === 'opencode-go' })[0]
  check('D7 有品牌字典键的组用 labelKey、label=null',
    [alibabaGroup.labelKey, alibabaGroup.label, alibabaGroup.mode], ['ui.qwenTokenPlan', null, 'subscription'])
  check('D8 只有原文字面量的组用 label、labelKey=null',
    [opencodeGroup.labelKey, opencodeGroup.label], [null, 'OpenCode Go'])
  check('D9 组内凭据只含 inline 条目', described.groups.reduce(function (bad, g) {
    for (const credential of g.credentials) if (inlineRefs.indexOf(credential.ref) < 0) bad.push(g.id + ':' + credential.ref)
    return bad
  }, []), [])
  check('D10 组内凭据每项字段固定',
    described.groups.reduce(function (bad, g) {
      for (const credential of g.credentials) if (Object.keys(credential).sort().join(',') !== 'configured,hintKey,labelKey,ref,source,writable') bad.push(g.id)
      return bad
    }, []), [])
  const groupCredentials = described.groups.reduce(function (list, g) { return list.concat(g.credentials) }, [])
  check('D11 组内凭据与 items 状态一致', groupCredentials.every(function (credential) {
    const item = described.items.filter(function (i) { return i.ref === credential.ref })[0]
    return item && item.configured === credential.configured && item.source === credential.source && item.writable === credential.writable
  }), true)
  check('D12 组内凭据保留 labelKey/hintKey 供客户端渲染',
    alibabaGroup.credentials.map(function (c) { return [c.ref, c.labelKey, c.hintKey] })[0],
    ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ui.credentialAlibabaIdLabel', 'ui.credentialAlibabaIdHint'])
  check('D13 无 labelKey/hintKey 的 inline 凭据为 null（客户端走 generic 文案）', described.groups.reduce(function (list, g) {
    return list.concat(g.credentials.filter(function (c) { return c.ref === 'MINIMAX_API_KEY' }))
  }, [])[0], { ref: 'MINIMAX_API_KEY', labelKey: null, hintKey: null, configured: true, source: 'env', writable: false })
  check('D14 footnoteKey 固定指向余额/账单说明', described.footnoteKey, 'ui.credentialFootnote')
  check('D15 canWrite = set+unset 都是函数', described.canWrite, true)
  const expiredLoginHost = makeHostApi(C, {
    describe: describeStub, set: async function () {}, unset: async function () {},
    readRecord: function () { return { payload: { access: 'expired-oauth-token', expires: Date.now() - 60000 } } },
  })
  const emptyAccessLoginHost = makeHostApi(C, {
    describe: describeStub, set: async function () {}, unset: async function () {},
    readRecord: function () { return { payload: { access: '' } } },
  })
  check('D16 kimiLogin.configured = 能读出未过期 access token：未过期→true；已过期→false；access 空→false',
    [described.kimiLogin, (await expiredLoginHost.api.describeCredentialConfig()).kimiLogin,
      (await emptyAccessLoginHost.api.describeCredentialConfig()).kimiLogin],
    [{ configured: true }, { configured: false }, { configured: false }])
  check('D17 readRecord 用 llm-pi-ai/kimi-coding 键读取', describeHost.calls.readRecord, ['llm-pi-ai/kimi-coding'])
  ok('D17b kimiLogin 判定复用 readKimiCodingRecordToken（过期的记录不算已登录）', (function () {
    const describeSource = extractFn(hostSrc, 'describeCredentialConfig')
    return describeSource.indexOf('readKimiCodingRecordToken()') >= 0 && describeSource.indexOf('!!accessToken') >= 0
  })())
  ok('D18 describe 结果不含 OAuth token / Secret', !leaks(described))
  const noRecordHost = makeHostApi(C, { describe: describeStub, set: async function () {}, unset: async function () {}, readRecord: function () { return null } })
  check('D19 readRecord 无记录 → kimiLogin.configured=false', (await noRecordHost.api.describeCredentialConfig()).kimiLogin, { configured: false })
  const recordThrowsHost = makeHostApi(C, { describe: describeStub, set: async function () {}, unset: async function () {}, readRecord: function () { throw new Error('boom') } })
  check('D20 readRecord 抛错 → kimiLogin.configured=false（不 500）', (await recordThrowsHost.api.describeCredentialConfig()).kimiLogin, { configured: false })
  const noReadRecordHost = makeHostApi(C, { describe: describeStub, set: async function () {}, unset: async function () {} })
  check('D21 宿主无 readRecord → kimiLogin.configured=false', (await noReadRecordHost.api.describeCredentialConfig()).kimiLogin, { configured: false })
  check('D22 canWrite 缺 unset 时为 false', (await makeHostApi(C, { describe: describeStub, set: async function () {} }).api.describeCredentialConfig()).canWrite, false)
  check('D23 canWrite 缺 set 时为 false', (await makeHostApi(C, { describe: describeStub, unset: async function () {} }).api.describeCredentialConfig()).canWrite, false)
  // 无 describe 时回退 resolve
  const fallbackHost = makeHostApi(C, {
    resolve: function (ref) { return ref === 'KIMI_API_KEY' ? { value: 'yes', source: 'env' } : null },
    set: async function () {}, unset: async function () {},
  })
  const fallback = await fallbackHost.api.describeCredentialConfig()
  check('D24 无 describe 回退 resolve：configured/source', [fallback.items.filter(function (i) { return i.ref === 'KIMI_API_KEY' })[0].configured,
    fallback.items.filter(function (i) { return i.ref === 'KIMI_API_KEY' })[0].source], [true, 'env'])
  check('D25 无 describe 时 writable 跟随 set 是否存在', fallback.items[0].writable, true)
  check('D26 resolve 抛错 → 按未配置展示', (await makeHostApi(C, {
    resolve: function () { throw new Error('boom') }, set: async function () {}, unset: async function () {},
  }).api.describeCredentialConfig()).items.every(function (i) { return i.configured === false }), true)
  check('D27 describe 单项抛错只影响该项、不影响 canWrite', await (async function () {
    const host = makeHostApi(C, {
      describe: function (ref) { if (ref === 'KIMI_API_KEY') throw new Error('boom'); return describeStub(ref) },
      set: async function () {}, unset: async function () {},
    })
    const res = await host.api.describeCredentialConfig()
    return [res.items.filter(function (i) { return i.ref === 'KIMI_API_KEY' })[0].configured, res.canWrite]
  })(), [false, true])
  // getCredentialConfig 路由与 describe 等价
  const readHost = makeHostApi(C, { describe: describeStub, set: async function () {}, unset: async function () {}, readRecord: function () { return { access: 'x' } } })
  const readRes = await readHost.api.getCredentialConfig()
  check('D28 getCredentialConfig 返回与 describeCredentialConfig 等价', readRes, await readHost.api.describeCredentialConfig())
  check('D29 getCredentialConfig 顶层字段固定',
    Object.keys(readRes).sort(), ['bound', 'canWrite', 'footnoteKey', 'groups', 'items', 'kimiLogin', 'total'])

  // ================= E) ROUTES：set / clear =================
  const ERROR_CODES = ['invalid-ref', 'invalid-value', 'write-unsupported', 'write-failed']
  const results = []
  async function run(host, method, args) {
    const res = await host.api[method](args)
    results.push(res)
    return res
  }
  ok('E1 setCredential 覆盖四个稳定错误 code（源码）',
    ["'invalid-ref'", "'invalid-value'", "'write-unsupported'", "'write-failed'"].every(function (code) {
      return extractRouteFn(hostSrc, 'setCredential').indexOf(code) >= 0
    }))
  ok('E2 clearCredential 覆盖 invalid-ref / write-unsupported / write-failed（源码）',
    ["'invalid-ref'", "'write-unsupported'", "'write-failed'"].every(function (code) {
      return extractRouteFn(hostSrc, 'clearCredential').indexOf(code) >= 0
    }))
  ok('E3 setCredential 走 ctx.credentials.set、clearCredential 走 ctx.credentials.unset',
    extractRouteFn(hostSrc, 'setCredential').indexOf('ctx.credentials.set(ref, value)') >= 0
    && extractRouteFn(hostSrc, 'clearCredential').indexOf('ctx.credentials.unset(ref)') >= 0)

  // 存储态桩：set/unset 修改 stored 集合，describe 读它
  function makeStoreHost() {
    const stored = new Set()
    return makeHostApi(C, {
      describe: function (ref) { return { configured: stored.has(ref), source: stored.has(ref) ? 'file' : null, writable: true } },
      set: async function (ref) { stored.add(ref) },
      unset: async function (ref) { stored.delete(ref) },
      readRecord: function () { return null },
    })
  }

  const writeHost = makeStoreHost()
  for (const badRef of ['DEEPSEEK_API_KEY', '', ' KIMI_API_KEY ', undefined]) {
    check('E4 setCredential 非白名单 ref → invalid-ref（' + String(badRef) + '）', await run(writeHost, 'setCredential', { ref: badRef, value: SECRET }),
      { ok: false, code: 'invalid-ref' })
  }
  check('E5 invalid-ref 时不调用 set', writeHost.calls.set.length, 0)
  const noSetHost = makeHostApi(C, { describe: describeStub, unset: async function () {} })
  check('E6 宿主无 set → write-unsupported', await run(noSetHost, 'setCredential', { ref: 'KIMI_API_KEY', value: KIMI_VALUE }),
    { ok: false, code: 'write-unsupported' })
  check('E7 无 set 时即使值非法也先报 write-unsupported', await run(noSetHost, 'setCredential', { ref: 'KIMI_API_KEY', value: 'a b' }),
    { ok: false, code: 'write-unsupported' })
  const badValueHost = makeStoreHost()
  for (const badValue of ['', '   ', 'a b', 'a' + LF + 'b', 'x'.repeat(CREDENTIAL_VALUE_MAX_LEN + 1)]) {
    check('E8 setCredential 非法值 → invalid-value（' + JSON.stringify(badValue).slice(0, 18) + '）',
      await run(badValueHost, 'setCredential', { ref: 'KIMI_API_KEY', value: badValue }), { ok: false, code: 'invalid-value' })
  }
  check('E9 invalid-value 时不调用 set', badValueHost.calls.set.length, 0)
  const setThrowsHost = makeHostApi(C, {
    describe: describeStub,
    set: async function () { throw new Error('host write failed: ' + SECRET) },
    unset: async function () {},
  })
  const failed = await run(setThrowsHost, 'setCredential', { ref: 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', value: SECRET })
  check('E10 set 抛错 → write-failed', failed, { ok: false, code: 'write-failed' })
  check('E11 set 收到 trim 后的原值', setThrowsHost.calls.set, [['ALIBABA_CLOUD_ACCESS_KEY_SECRET', SECRET]])
  ok('E12 write-failed 结果不含 Secret / 宿主原始错误', !leaks(failed) && JSON.stringify(failed).indexOf('host write failed') < 0)
  check('E13 失败结果只有 ok+code 两个字段', Object.keys(failed).sort(), ['code', 'ok'])

  const successHost = makeStoreHost()
  const saved = await run(successHost, 'setCredential', { ref: 'KIMI_API_KEY', value: '  ' + KIMI_VALUE + '  ' })
  check('E14 成功返回 ok:true 且带完整状态视图', [saved.ok, Object.keys(saved).sort()],
    [true, ['bound', 'canWrite', 'footnoteKey', 'groups', 'items', 'kimiLogin', 'ok', 'total']])
  check('E15 成功时 set 收到白名单 ref + trim 后值', successHost.calls.set, [['KIMI_API_KEY', KIMI_VALUE]])
  check('E16 成功返回的状态里该项 configured=true（保存后立即可见）',
    saved.items.filter(function (i) { return i.ref === 'KIMI_API_KEY' })[0].configured, true)
  check('E17 Kimi Key 保存后刷新 kimi-coding 订阅源', [successHost.calls.markRequested, successHost.calls.kick],
    [['kimi-coding'], [['kimi-coding', 'kimi-coding']]])
  ok('E18 成功结果不含 Key 值', !leaks(saved))

  const alibabaHost = makeStoreHost()
  await run(alibabaHost, 'setCredential', { ref: 'ALIBABA_CLOUD_ACCESS_KEY_ID', value: SECRET })
  check('E19 阿里 ID 保存后按目录刷新两个阿里源（来源去重、顺序按目录）',
    [alibabaHost.calls.markRequested, alibabaHost.calls.kick],
    [['alibaba-intl', 'alibaba-cn'], [['alibaba-intl', 'qwen-token-plan'], ['alibaba-cn', 'qwen-token-plan-cn']]])
  check('E20 刷新时写回 subscriptionSourceProvider', alibabaHost.sourceProvider,
    { 'alibaba-intl': 'qwen-token-plan', 'alibaba-cn': 'qwen-token-plan-cn' })
  const xiaomiHost = makeStoreHost()
  await run(xiaomiHost, 'setCredential', { ref: 'XIAOMI_TOKEN_PLAN_CN_API_KEY', value: 'xiaomi-key-value' })
  check('E21 小米 Key 保存后按目录刷新三集群（xiaomi 无订阅源被跳过）',
    [xiaomiHost.calls.markRequested, xiaomiHost.calls.kick],
    [['xiaomi-cn', 'xiaomi-sgp', 'xiaomi-ams'],
      [['xiaomi-cn', 'xiaomi-token-plan-cn'], ['xiaomi-sgp', 'xiaomi-token-plan-sgp'], ['xiaomi-ams', 'xiaomi-token-plan-ams']]])
  const billingHost = makeStoreHost()
  await run(billingHost, 'setCredential', { ref: 'TOGETHER_API_KEY', value: 'together-key-value' })
  check('E22 余额/账单类 ref 不触发订阅源刷新', billingHost.calls.markRequested, [])
  const kickThrowsHost = makeHostApi(C, {
    describe: describeStub,
    set: async function () {},
    unset: async function () {},
    engine: { markRequested: function () {}, kick: async function () { throw new Error('kick failed') } },
  })
  check('E23 订阅源刷新失败不影响保存成功', (await run(kickThrowsHost, 'setCredential', { ref: 'KIMI_API_KEY', value: KIMI_VALUE })).ok, true)
  check('E24 保存失败时不刷新订阅源', [setThrowsHost.calls.markRequested.length, setThrowsHost.calls.kick.length], [0, 0])
  // refresh 纯函数：未知 ref 不抛也不刷新
  const unknownRefreshHost = makeStoreHost()
  let unknownThrew = false
  try { await unknownRefreshHost.api.refreshSubscriptionAfterCredential('NOT_A_REF') } catch (err) { unknownThrew = true }
  check('E25 refresh 对未知 ref 静默跳过', [unknownThrew, unknownRefreshHost.calls.markRequested], [false, []])

  const clearHost = makeStoreHost()
  await run(clearHost, 'setCredential', { ref: 'KIMI_API_KEY', value: KIMI_VALUE })
  check('E26 clearCredential 非白名单 ref → invalid-ref', await run(clearHost, 'clearCredential', { ref: 'NOT_A_CATALOG_REF' }), { ok: false, code: 'invalid-ref' })
  const noUnsetHost = makeHostApi(C, { describe: describeStub, set: async function () {} })
  check('E27 宿主无 unset → write-unsupported', await run(noUnsetHost, 'clearCredential', { ref: 'KIMI_API_KEY' }), { ok: false, code: 'write-unsupported' })
  const unsetThrowsHost = makeHostApi(C, {
    describe: describeStub,
    set: async function () {},
    unset: async function () { throw new Error('unset failed: ' + SECRET) },
  })
  const clearFailed = await run(unsetThrowsHost, 'clearCredential', { ref: 'ALIBABA_CLOUD_ACCESS_KEY_SECRET' })
  check('E28 unset 抛错 → write-failed', clearFailed, { ok: false, code: 'write-failed' })
  ok('E29 清除失败结果不含 Secret / 原始错误', !leaks(clearFailed) && JSON.stringify(clearFailed).indexOf('unset failed') < 0)
  check('E30 清除失败不刷新订阅源', [unsetThrowsHost.calls.markRequested.length, unsetThrowsHost.calls.kick.length], [0, 0])
  const clearMarkAt = clearHost.calls.markRequested.length
  const clearKickAt = clearHost.calls.kick.length
  const clearOk = await run(clearHost, 'clearCredential', { ref: 'KIMI_API_KEY' })
  check('E31 清除成功 → ok:true + 完整状态视图', [clearOk.ok, Object.keys(clearOk).sort()],
    [true, ['bound', 'canWrite', 'footnoteKey', 'groups', 'items', 'kimiLogin', 'ok', 'total']])
  check('E32 unset 收到白名单 ref', clearHost.calls.unset, ['KIMI_API_KEY'])
  check('E33 清除后 configured=false 且刷新对应源', [clearOk.items.filter(function (i) { return i.ref === 'KIMI_API_KEY' })[0].configured,
    clearHost.calls.markRequested.slice(clearMarkAt), clearHost.calls.kick.slice(clearKickAt)], [false, ['kimi-coding'], [['kimi-coding', 'kimi-coding']]])
  check('E34 错误 code 只允许四个稳定值', results.filter(function (r) { return r && r.ok === false })
    .every(function (r) { return ERROR_CODES.indexOf(r.code) >= 0 }), true)

  // ================= F) Kimi OAuth 复用（readRecord 兜底） =================
  let kimiHost = makeKimiKeyApi({
    resolve: function (name) { return name === 'KIMI_API_KEY' ? { value: 'key-from-credential-store' } : null },
    readRecord: function () { return { payload: { access: OAUTH_TOKEN } } },
  })
  check('F1 ref 名单命中优先，readRecord 不读', [await kimiHost.api.resolveKimiCodingKey(), kimiHost.calls.readRecord], ['key-from-credential-store', []])
  kimiHost = makeKimiKeyApi({ resolve: function () { return { value: { accessToken: 'object-access-token' } } } })
  check('F2 凭据值为对象时取 accessToken', await kimiHost.api.resolveKimiCodingKey(), 'object-access-token')
  kimiHost = makeKimiKeyApi({ resolve: function () { return { value: { access_token: 'snake-access-token' } } } })
  check('F3 对象也接受 access_token', await kimiHost.api.resolveKimiCodingKey(), 'snake-access-token')
  kimiHost = makeKimiKeyApi({ resolve: function () { return null }, env: { KIMI_CODING_API_KEY: 'env-key' }, readRecord: function () { return { access: OAUTH_TOKEN } } })
  check('F4 环境变量优先于 readRecord', [await kimiHost.api.resolveKimiCodingKey(), kimiHost.calls.readRecord], ['env-key', []])
  kimiHost = makeKimiKeyApi({ resolve: function () { return null }, env: {}, readRecord: function () { return { payload: { access: OAUTH_TOKEN } } } })
  check('F5 readRecord 作为最后兜底（payload.access）', await kimiHost.api.resolveKimiCodingKey(), OAUTH_TOKEN)
  check('F6 readRecord 使用宿主登录态记录键', kimiHost.calls.readRecord, ['llm-pi-ai/kimi-coding'])
  kimiHost = makeKimiKeyApi({ resolve: function () { return null }, env: {}, readRecord: function () { return { access: 'plain-access' } } })
  check('F7 记录本体带 access 时同样可用', await kimiHost.api.resolveKimiCodingKey(), 'plain-access')
  kimiHost = makeKimiKeyApi({ resolve: function () { return null }, env: {}, readRecord: function () { return { payload: { access: 'future-token', expires: Date.now() + 60000 } } } })
  check('F8 未过期记录返回 token', await kimiHost.api.resolveKimiCodingKey(), 'future-token')
  kimiHost = makeKimiKeyApi({ resolve: function () { return null }, env: {}, readRecord: function () { return { payload: { access: 'expired-token', expires: Date.now() - 60000 } } } })
  check('F9 已过期记录不返回 token（交给模型请求续期）', await kimiHost.api.resolveKimiCodingKey(), null)
  kimiHost = makeKimiKeyApi({ resolve: function () { return null }, env: {}, readRecord: function () { return { payload: { access: 'token-no-expiry', expires: 'not-a-number' } } } })
  check('F10 expires 非数字视为无过期时间', await kimiHost.api.resolveKimiCodingKey(), 'token-no-expiry')
  kimiHost = makeKimiKeyApi({ resolve: function () { return null }, env: {}, readRecord: function () { return { payload: { access: '' } } } })
  check('F11 记录里 access 为空 → null', await kimiHost.api.resolveKimiCodingKey(), null)
  kimiHost = makeKimiKeyApi({ resolve: function () { return null }, env: {}, readRecord: function () { throw new Error('record boom') } })
  check('F12 readRecord 抛错 → null（不影响手填 Key）', await kimiHost.api.resolveKimiCodingKey(), null)
  kimiHost = makeKimiKeyApi({ resolve: function () { return null }, env: {} })
  check('F13 宿主无 readRecord → null', await kimiHost.api.resolveKimiCodingKey(), null)
  kimiHost = makeKimiKeyApi({ resolve: function () { return null }, env: {}, readRecord: function () { return 'not-an-object' } })
  check('F14 readRecord 返回非对象 → null', await kimiHost.api.resolveKimiCodingKey(), null)
  kimiHost = makeKimiKeyApi({ resolve: function () { return null }, env: {} })
  check('F15 全部来源都缺 → null', await kimiHost.api.resolveKimiCodingKey(), null)
  kimiHost = makeKimiKeyApi({ resolve: function () { return null }, env: {}, readRecord: function () { return { payload: { access: OAUTH_TOKEN, expires: Date.now() + 60000 } } } })
  check('F16 readKimiCodingRecordToken 直接返回 access 字符串', await kimiHost.api.readKimiCodingRecordToken(), OAUTH_TOKEN)
  const oauthDescribeHost = makeHostApi(C, {
    describe: describeStub, set: async function () {}, unset: async function () {},
    readRecord: function () { return { payload: { access: OAUTH_TOKEN } } },
  })
  ok('F17 OAuth token 只用于额度请求，不出现在设置页状态里', !leaks(await oauthDescribeHost.api.describeCredentialConfig()))

  // ================= G) 客户端静态与 rows 行为 =================
  const rowsFactory = eval('(function (t, CREDENTIAL_CATALOG) { ' + extractFn(clientSrc, 'bibSetCredentialRowsFromCatalog')
    + ' return bibSetCredentialRowsFromCatalog })')
  const rowsFromCatalog = rowsFactory(tStub, catalog)
  ok('G1 客户端不再硬编码三行凭据表（无 BIB_SET_CREDENTIAL_ROWS）', clientSrc.indexOf('BIB_SET_CREDENTIAL_ROWS') < 0)
  ok('G2 客户端渲染行来自 state.groups / 目录 fallback',
    clientSrc.indexOf('function bibSetCredentialRowsFromCatalog(state)') >= 0
    && clientSrc.indexOf('bibSetCredentialRowsFromCatalog(state)') >= 0)
  const hostGroups = described.groups.map(function (group) {
    return {
      id: group.id, labelKey: group.labelKey, label: group.label, mode: group.mode,
      credentials: group.credentials.map(function (credential) {
        return { ref: credential.ref, labelKey: credential.labelKey, hintKey: credential.hintKey, configured: credential.configured, source: credential.source, writable: credential.writable }
      }),
    }
  })
  const rows = rowsFromCatalog({ groups: hostGroups, kimiLogin: { configured: true }, canWrite: true })
  check('G3 rows 按 groups 顺序（bound 优先）拍平且只含 inline 凭据', rows.map(function (row) { return row.ref }),
    ['kimi-coding', 'minimax', 'alibaba', 'xiaomi-token-plan', 'command-code', 'opencode-go'].map(function (id) {
      return inlineRefs.filter(function (ref) {
        const entry = catalog.filter(function (e) { return e.id === id })[0]
        return entry && entry.credentials.some(function (c) { return c.ref === ref && c.inline === true })
      })
    }).reduce(function (acc, list) { return acc.concat(list) }, []))
  const alibabaRow = rows.filter(function (row) { return row.ref === 'ALIBABA_CLOUD_ACCESS_KEY_ID' })[0]
  check('G4 行显示名 = 组品牌 + 凭据标签，状态来自 host',
    [alibabaRow.providerLabel, alibabaRow.labelText, alibabaRow.hintText, alibabaRow.configured],
    [tStub('ui.qwenTokenPlan'), tStub('ui.credentialAlibabaIdLabel'), tStub('ui.credentialAlibabaIdHint'), false])
  const minimaxRow = rows.filter(function (row) { return row.ref === 'MINIMAX_API_KEY' })[0]
  check('G5 无 labelKey/hintKey 时回退 generic 文案',
    [minimaxRow.labelText, minimaxRow.hintText], [null, tStub('ui.credentialGenericHint')])
  check('G6 无 labelKey 的行标签拼接 = providerLabel · ref', tStub('ui.credentialGenericLabel', { provider: minimaxRow.providerLabel, ref: minimaxRow.ref }),
    tStub('ui.minimax') + ' · MINIMAX_API_KEY')
  const kimiReuseRows = rowsFromCatalog({
    groups: [{ id: 'kimi-coding', labelKey: 'ui.kimiCoding', label: null, mode: 'subscription',
      credentials: [{ ref: 'KIMI_API_KEY', labelKey: 'ui.credentialKimiKeyLabel', hintKey: 'ui.credentialKimiHint', configured: false, source: null, writable: true }] }],
    kimiLogin: { configured: true }, canWrite: true,
  })
  check('G7 KIMI_API_KEY 未配置且 kimiLogin.configured → 复用登录态展示', kimiReuseRows[0].kimiLoginReused, true)
  const kimiConfiguredRows = rowsFromCatalog({
    groups: [{ id: 'kimi-coding', labelKey: 'ui.kimiCoding', label: null, mode: 'subscription',
      credentials: [{ ref: 'KIMI_API_KEY', labelKey: 'ui.credentialKimiKeyLabel', hintKey: 'ui.credentialKimiHint', configured: true, source: 'file', writable: true }] }],
    kimiLogin: { configured: true }, canWrite: true,
  })
  check('G8 已手填 Kimi Key 时不显示复用态', kimiConfiguredRows[0].kimiLoginReused, false)
  const fallbackRows = rowsFromCatalog({ groups: [], canWrite: false })
  check('G9 老宿主无 groups → 目录 fallback 只列 inline 且状态未知', [fallbackRows.map(function (row) { return row.ref }), fallbackRows.every(function (row) { return row.configured === false && row.writable === false })],
    [inlineRefs, true])
  check('G10 fallback 行显示名来自目录品牌键', fallbackRows[0].providerLabel, tStub('ui.qwenTokenPlan'))

  const sectionFn = extractFn(clientSrc, 'bibSetCredentialsSection')
  ok('G10b 无 labelKey 的行标签统一走 t(ui.credentialGenericLabel, { provider, ref })（不再字符串拼接）',
    sectionFn.indexOf("t('ui.credentialGenericLabel', { provider: row.providerLabel, ref: row.ref })") >= 0
    && sectionFn.indexOf("' · '") < 0)
  ok('G11 凭据输入框 type=password + autoComplete=new-password',
    sectionFn.indexOf("type: 'password'") >= 0 && sectionFn.indexOf("autoComplete: 'new-password'") >= 0)
  ok('G12 输入框 maxLength 与宿主值上限一致', sectionFn.indexOf('maxLength: ' + CREDENTIAL_VALUE_MAX_LEN) >= 0)
  ok('G13 状态未加载时不闪写保护、加载后 canWrite=false 才警示',
    sectionFn.indexOf('const loaded = state !== null;') >= 0
    && sectionFn.indexOf('loaded && !canWrite ? bibSetAlert(') >= 0
    && sectionFn.indexOf("t('ui.credentialWriteUnsupported')") >= 0)
  ok('G14 渲染目录说明 footnote', sectionFn.indexOf("t('ui.credentialFootnote')") >= 0)
  ok('G15 Kimi 复用态有独立状态文案', sectionFn.indexOf("t('ui.credentialKimiLoginReused')") >= 0)
  ok('G16 凭据输入框挂到设置页区块注册表', clientSrc.indexOf("id: 'credentials'") >= 0 && clientSrc.indexOf('bibSetCredentialsSection(') >= 0)
  const actionFn = extractFn(clientSrc, 'runCredentialAction')
  ok('G17 保存/清除成功后广播信息栏立即重拉',
    actionFn.indexOf('bibSetDispatchLedgerChanged()') > actionFn.indexOf('if (res && res.ok) {'))
  ok('G18 失败按稳定 code 翻译，不显示宿主原文', actionFn.indexOf('credentialErrorText(res && res.code)') >= 0)
  const errorTextFn = extractFn(clientSrc, 'credentialErrorText')
  ok('G19 错误码映射 invalid-value / write-unsupported / 兜底 write-failed',
    errorTextFn.indexOf("code === 'invalid-value'") >= 0
    && errorTextFn.indexOf("code === 'write-unsupported'") >= 0
    && errorTextFn.indexOf("t('ui.credentialWriteFailed')") >= 0)
  const saveFn = extractFn(clientSrc, 'onCredentialSave')
  ok('G20 保存走 rpc(setCredential) 且先 trim 草稿', saveFn.indexOf("rpc('setCredential', { ref: ref, value: value })") >= 0 && saveFn.indexOf('.trim()') >= 0)
  ok('G21 保存成功后清空草稿（不回显已存值）', saveFn.indexOf("next[ref] = ''") >= 0)
  ok('G22 清除走 rpc(clearCredential)', extractFn(clientSrc, 'onCredentialClear').indexOf("rpc('clearCredential', { ref: ref })") >= 0)
  ok('G23 输入草稿只进本地 state', extractFn(clientSrc, 'onCredentialDraft').indexOf('setCredentialDrafts') >= 0)

  // ================= H) locale 与密钥不外泄 =================
  const MANDATED_KEYS = [
    'ui.credentialsTitle', 'ui.credentialsDesc',
    'ui.credentialAlibabaIdLabel', 'ui.credentialAlibabaIdHint',
    'ui.credentialAlibabaSecretLabel', 'ui.credentialAlibabaHint',
    'ui.credentialKimiKeyLabel', 'ui.credentialKimiHint',
    'ui.credentialConfigured', 'ui.credentialNotConfigured',
    'ui.credentialSourceFile', 'ui.credentialSourceEnv', 'ui.credentialSourceOther',
    'ui.credentialPlaceholder', 'ui.credentialSave', 'ui.credentialClear',
    'ui.credentialSaved', 'ui.credentialCleared',
    'ui.credentialInvalidValue', 'ui.credentialWriteFailed', 'ui.credentialWriteUnsupported',
    'ui.credentialStorageHint',
  ]
  ok('H1 任务要求的 22 个 ui.credential* 键中英齐备', MANDATED_KEYS.every(function (key) {
    return typeof zhDict[key] === 'string' && zhDict[key].length > 0
      && typeof enDict[key] === 'string' && enDict[key].length > 0
  }))
  const NEW_KEYS = ['ui.credentialGenericLabel', 'ui.credentialGenericHint', 'ui.credentialFootnote', 'ui.credentialKimiLoginReused']
  ok('H2 目录驱动新增的 generic/footnote/kimi-login 文案中英齐备', NEW_KEYS.every(function (key) {
    return typeof zhDict[key] === 'string' && typeof enDict[key] === 'string'
  }), NEW_KEYS.filter(function (key) { return typeof zhDict[key] !== 'string' || typeof enDict[key] !== 'string' }).join(','))
  check('H3 目录 footnoteKey 在 zh/en 字典存在', [zhDict['ui.credentialFootnote'] !== undefined, enDict['ui.credentialFootnote'] !== undefined], [true, true])
  // 客户端源码引用的所有 ui.credential* 键都必须存在（以后新加文案漏翻译会被这里拦住）
  const referenced = []
  let searchAt = 0
  while (true) {
    const found = clientSrc.indexOf("t('ui.credential", searchAt)
    if (found < 0) break
    const quoteAt = clientSrc.indexOf("'", found + 3)
    referenced.push(clientSrc.slice(found + 3, quoteAt))
    searchAt = quoteAt
  }
  const missingReferenced = referenced.filter(function (key) {
    return typeof zhDict[key] !== 'string' || typeof enDict[key] !== 'string'
  })
  check('H4 客户端引用的每个 ui.credential* 键都在 zh/en 字典存在', missingReferenced, [])
  const zhCredKeys = Object.keys(zhDict).filter(function (key) { return key.indexOf('ui.credential') === 0 }).sort()
  const enCredKeys = Object.keys(enDict).filter(function (key) { return key.indexOf('ui.credential') === 0 }).sort()
  check('H5 zh/en 的 ui.credential* 键集合完全一致', zhCredKeys, enCredKeys)
  const allLocalesSame = Object.keys(dictionaries).every(function (locale) {
    const keys = Object.keys(dictionaries[locale]).filter(function (key) { return key.indexOf('ui.credential') === 0 }).sort()
    return JSON.stringify(keys) === JSON.stringify(zhCredKeys)
  })
  ok('H6 13 种语言的 ui.credential* 键集合一致', allLocalesSame)
  ok('H7 所有 ROUTES 返回结果都不含凭据值/OAuth token',
    results.every(function (res) { return !leaks(res) }), results.length + ' 个结果')

  console.log(String.fromCharCode(10) + (fail === 0 ? '全部通过' : fail + ' 项失败') + '：' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(function (err) {
  console.error('测试装置异常：' + String((err && err.stack) || err))
  process.exit(1)
})
