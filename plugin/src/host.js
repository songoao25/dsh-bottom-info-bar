// Bottom Info Bar（底部信息栏插件）— host half（静态 bundle 形态）
// 业务：余额真实 API / 峰谷定价 / llm/stream 记账 / 会话聚合 / 显示名识别 / 订阅额度显示
// RPC：webServer HTTP 路由（GET/POST /_dsh/dsh-bottom-info-bar/<method>，JSON 进出，同源防护）
// 依赖：inject ['credentials', 'timer']；可选服务 webServer / sessionController（按能力读取）
// 记账持久化：追加账本 + 可恢复快照落盘 ~/.dsh/dsh-bottom-info-bar/（可用环境变量
// DSH_BOTTOM_INFO_BAR_DATA_DIR 覆盖目录），重启/中断后真实累计花费不丢失。
// 订阅额度：本插件只读令牌（~/.codex/auth.json / opencode auth.json）查询额度、仅作显示；
// 令牌的绑定/续期/写回由独立插件 dsh-chatgpt-subscription 维护，本插件不写回、不续期、不注入凭据。
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
// v1.9.0 PR2：字段注册表/预设色名单一来源（ESM 直接 import，构建时把 constants.js 一并复制进 lib/）
import { FIELD_REGISTRY, PRESET_COLOR_NAMES } from './constants.js'
import * as hostLocale from './host-locale.js'
const t = hostLocale.createHostTranslator()

const DATA_DIR = process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR || join(homedir(), '.dsh', 'dsh-bottom-info-bar')
const DATA_FILE = join(DATA_DIR, 'usage-records.json')
const DATA_BACKUP_FILE = DATA_FILE + '.bak'
const DATA_TEMP_FILE = DATA_FILE + '.tmp'
const DATA_TEMP_PREFIX = DATA_TEMP_FILE + '.'
// The journal is the source of truth.  The JSON file remains a compact,
// human-readable snapshot for backwards compatibility and quick recovery.
const USAGE_JOURNAL_FILE = join(DATA_DIR, 'usage-records.journal.jsonl')
// v1.9.0 性能地基（设计依据 docs/PERF-AUDIT-v1.9.md §③A/B）：滚动压缩阈值与汇总/归档文件。
// 汇总文件只保存"已折叠天"的聚合，是折叠部分金额的唯一权威；冷归档只留记录级副本，运行期绝不读。
const USAGE_SUMMARIES_FILE = join(DATA_DIR, 'usage-summaries.json')
const USAGE_SUMMARIES_BACKUP_FILE = USAGE_SUMMARIES_FILE + '.bak'
const USAGE_SUMMARIES_TEMP_PREFIX = USAGE_SUMMARIES_FILE + '.tmp.'
const USAGE_ARCHIVE_DIR = join(DATA_DIR, 'usage-archive')
// Clear is a multi-file operation (snapshot + journal + summaries + cold archive).
// The marker prevents a crash halfway through the operation from resurrecting
// old spend records on the next host start.
const LEDGER_CLEAR_MARKER_FILE = join(DATA_DIR, 'usage-records.clear-marker')
// v1.9.0 PR2：设置文件（字段显隐/颜色/信息密度），与记账数据同目录但互不干扰
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')
const SETTINGS_FORMAT_VERSION = 1
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/
const CUSTOM_TEXT_MAX_LEN = 64
const TIME_FORMAT_KEYS = ['year', 'month', 'day', 'hour', 'minute', 'second']
const DEFAULT_TIME_FORMAT = { year: true, month: true, day: true, hour: true, minute: true, second: false }
const DEFAULT_TIME_ZONES = { main: 'Asia/Shanghai', world: 'UTC' }
const SUMMARIES_FORMAT_VERSION = 1
const DETAIL_RETENTION_DAYS = 90 // 明细保留窗：更早的 priced 明细折叠进日桶
const DETAIL_HARD_CAP = 100000 // 明细硬顶：unpriced 永不折叠，故硬顶只对 priced 明细逐日推进折叠边界
const JOURNAL_COMPACT_MAX_LINES = 2000
const JOURNAL_COMPACT_MAX_BYTES = 2 * 1024 * 1024
const MS_PER_DAY = 86400 * 1000
const BEIJING_OFFSET_MS = 8 * 3600 * 1000
// recordAccount 为 null 的“无主记录”在桶/会话索引里的键（accountForProvider 永不返回空串，无碰撞）
const NULL_ACCOUNT_KEY = ''
const PACKAGE_FILE = new URL('../package.json', import.meta.url)
const UPDATE_REGISTRY_URL = 'https://registry.npmjs.org/dsh-bottom-info-bar/latest'
const UPDATE_CHECK_TIMEOUT_MS = 5000

function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_FILE, 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function stableVersion(value) {
  const match = typeof value === 'string' && value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function compareVersions(left, right) {
  const a = stableVersion(left)
  const b = stableVersion(right)
  if (!a || !b) return 0
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}

// 运行中的 profile 名。DSH CLI 强制要求 --profile <name>，拿不到时退回 web——
// 本插件的安装脚本默认就装到 web，这是最合理的兜底。
function runningProfileName() {
  const argv = Array.isArray(process.argv) ? process.argv : []
  const index = argv.indexOf('--profile')
  const value = index >= 0 && typeof argv[index + 1] === 'string' ? argv[index + 1].trim() : ''
  return value.length > 0 ? value : 'web'
}

function dshHomeDir() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return configured.length > 0 ? configured : join(homedir(), '.dsh')
}

// 「更新命令」取决于本插件是怎么装上的，两者不能混用：
//   - npm 安装       → dsh plugin add …@latest；
//   - link:（本地代码 / 一键脚本安装）→ git pull。这类安装若改用 npm 命令，会把符号
//     链接换成 registry 版本，用户本地那份代码从此不再生效（本仓库 install.sh 即此类）。
// 读不到 profile 配置时按 npm 处理：那是最常见、也是唯一能从 npm 自动更新的形态。
function updateCommandForInstall() {
  const profile = runningProfileName()
  const npmCommand = 'dsh plugin --profile ' + profile + ' add dsh-bottom-info-bar@latest'
  try {
    const profileFile = join(dshHomeDir(), 'profiles', profile, 'package.json')
    const pkg = JSON.parse(readFileSync(profileFile, 'utf8'))
    const spec = pkg && pkg.dependencies && pkg.dependencies['dsh-bottom-info-bar']
    if (typeof spec === 'string' && spec.startsWith('link:')) {
      const target = spec.slice('link:'.length).trim()
      if (target.length > 0) return { installMode: 'link', updateCommand: 'git -C ' + target + ' pull --ff-only' }
    }
  } catch (err) { /* 读不到就按 npm 处理 */ }
  return { installMode: 'npm', updateCommand: npmCommand }
}

async function checkLatestVersion() {
  const current = packageVersion()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS)
  try {
    const response = await fetch(UPDATE_REGISTRY_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return { available: false, current: current, latest: null }
    const body = await response.json()
    const latest = body && typeof body.version === 'string' ? body.version : null
    return { available: !!latest && compareVersions(latest, current) > 0, current: current, latest: latest }
  } catch {
    return { available: false, current: current, latest: null }
  } finally {
    clearTimeout(timer)
  }
}

// ---------- 双模式（余额制 / 订阅制）配置 ----------
// 订阅制 provider 集合：这些 provider 走"额度窗口"显示而非余额（共享常量注入，见 src/constants.js）
const SUBSCRIPTION_PROVIDERS = /*__SUBSCRIPTION_PROVIDERS__*/[];
// 云账单 provider 集合：这些 provider 走"账单型"显示（本月真实花费 / 预算%），与余额型/额度型互斥（FR-14 共享常量注入）
const BILLING_PROVIDERS = /*__BILLING_PROVIDERS__*/[];
// 窗口标签：模块顶层用硬编码中文兜底（避免加载时触发 translate）；
// apply 内部会重新计算以响应当前语言偏好（见 windowLabels 定义）。
const WINDOW_LABELS = { five_hour: '5 小时', seven_day: '周', monthly: '月' }
// 订阅窗口预警阈值由客户端本判定（剩余 ≤20% → 警示红 + 无框“低”字，见 client 的 LOW_QUOTA_PERCENT）；
// host 仅下发额度/重置数据，不重复判定，故移除原 WINDOW_ALERT_PERCENT=90 的死常量。
const CODEX_PLAN_NAMES = { plus: 'ChatGPT Plus', pro: 'ChatGPT Pro', team: 'ChatGPT Team', enterprise: 'ChatGPT Enterprise' }
const SUBSCRIPTION_REFRESH_MS = 60000 // 订阅额度快照刷新周期（与余额一致）
const SUBSCRIPTION_RETRY_BACKOFF_MS = 60000 // 订阅刷新失败后的退避期：减少重复请求，也避免“刷新失败”提示闪烁
// 订阅源 auth 文件路径（可用环境变量覆盖——测试隔离用，避免测试误读真实登录态）；
// 本插件只读令牌查询额度，令牌的绑定/续期由独立插件 dsh-chatgpt-subscription 维护
const CODEX_AUTH_FILE = process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH || join(homedir(), '.codex', 'auth.json')
const OPENCODE_AUTH_FILE = process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH || join(homedir(), '.local', 'share', 'opencode', 'auth.json')

// ---------- 服务商账户映射（v1.6 分账核心）：DSH provider id → 账户键；未知返回 null ----------
// v1.7：新增 xiaomi（按量）、xiaomi-token-plan-*（套餐）、together / fireworks / amazon-bedrock / cloudflare-*（云账单）
function accountForProvider(pid) {
  if (!pid) return null
  if (pid === 'deepseek' || pid === 'deepseek-official') return 'deepseek'
  if (pid === 'openai') return 'openai'
  if (pid === 'moonshotai' || pid === 'moonshotai-cn' || pid === 'kimi-coding') return 'moonshotai'
  if (pid === 'openrouter') return 'openrouter'
  if (pid === 'stepfun') return 'stepfun'
  if (pid === 'codex' || pid === 'chatgpt' || pid === 'openai-codex') return 'codex' // 订阅源 codex
  if (pid === 'opencode-go' || pid === 'opencode') return 'opencode-go' // 订阅源 opencode-go
  if (pid === 'zai' || pid === 'zai-coding-cn') return 'zai' // 订阅源 zai
  if (pid === 'xiaomi') return 'xiaomi'
  if (pid === 'xiaomi-token-plan-cn' || pid === 'xiaomi-token-plan-sgp' || pid === 'xiaomi-token-plan-ams') return 'xiaomi-token-plan'
  if (pid === 'together') return 'together'
  if (pid === 'fireworks') return 'fireworks'
  if (pid === 'amazon-bedrock') return 'amazon-bedrock'
  if (pid === 'cloudflare-ai-gateway' || pid === 'cloudflare-workers-ai') return 'cloudflare'
  return null
}

// 服务商在账单（usage）里直接报告真实金额时，按服务商固定币种回填。
// 仅列明确用美元计价的聚合商（如 OpenRouter）；未登记的走价目表币种回退。
// 动机：聚合商路由模型数量庞大、价目无法静态维护——官方报出的钱 > 本地任何换算。
const PROVIDER_REPORTED_CURRENCY = { openrouter: 'USD' }

// 订阅 provider → 订阅源标识（codex / opencode-go / zai / xiaomi-{cn,sgp,ams}）；非订阅 provider → null
// v1.7：小米 Token Plan 按地区分源（各地区独立 baseUrl 与凭据，避免跨地区串数据）
function subscriptionSourceFor(providerId) {
  if (providerId === 'codex' || providerId === 'chatgpt' || providerId === 'openai-codex') return 'codex'
  if (providerId === 'opencode-go' || providerId === 'opencode') return 'opencode-go'
  if (providerId === 'zai' || providerId === 'zai-coding-cn') return 'zai'
  if (providerId === 'xiaomi-token-plan-cn') return 'xiaomi-cn'
  if (providerId === 'xiaomi-token-plan-sgp') return 'xiaomi-sgp'
  if (providerId === 'xiaomi-token-plan-ams') return 'xiaomi-ams'
  return null
}

// 云账单 provider → 账单源标识（together / fireworks / amazon-bedrock / cloudflare）；非账单型 → null（FR-14）
function billingSourceFor(providerId) {
  if (providerId === 'together') return 'together'
  if (providerId === 'fireworks') return 'fireworks'
  if (providerId === 'amazon-bedrock') return 'amazon-bedrock'
  if (providerId === 'cloudflare-ai-gateway' || providerId === 'cloudflare-workers-ai') return 'cloudflare'
  return null
}

// ---------- M5：DSH 目录名 → 展示名（模型名/服务商名与模型切换器完全一致） ----------
// 模型切换器显示 DSH LLM 目录的 model.name（DSH 0.1.5-rc.2 中如 id=deepseek-flash 的 name="DeepSeek-V41-Flash"）。
// 以下两个纯函数只做"缓存优先 → 回退"解析；缓存由 apply 内异步填充（llm.listModels / llm.listProviders）。
// modelDisplay：优先缓存里的 DSH 目录 name；缓存缺失/未知模型回退原始 model id（不做自建美化）
function modelDisplayFromCache(model, provider, cache, translate) {
  if (translate === undefined) translate = t
  if (model && provider && cache) {
    const provMap = Object.hasOwn(cache, provider) ? cache[provider] : null
    if (provMap && Object.hasOwn(provMap, model) && typeof provMap[model] === 'string' && provMap[model].length > 0) return provMap[model]
  }
  return model || translate('ui.unknownModel')
}
// providerDisplay：优先 DSH 目录 name（llm.listProviders()）；缺失回退静态映射；再回退大写首字母
function providerDisplayFromCache(providerId, cache, staticMap, translate) {
  if (translate === undefined) translate = t
  if (!providerId) return translate('host.unknownProvider')
  if (cache && Object.hasOwn(cache, providerId) && typeof cache[providerId] === 'string' && cache[providerId].length > 0) return cache[providerId]
  if (staticMap && Object.hasOwn(staticMap, providerId) && staticMap[providerId]) return translate.json ? translate.json('displayName', staticMap[providerId]) : staticMap[providerId]
  return providerId.charAt(0).toUpperCase() + providerId.slice(1)
}

// 余额制/订阅制/账单制判定：只根据当前会话的 provider 自动识别。
// v1.7：FR-14 三态互斥——订阅 provider → subscription（额度窗），云账单 provider → billing（本月花费），其余 → balance。
// 这里不保留手动覆盖参数，避免用户选择的模型与账单通道脱节。
function detectBillingMode(providerId) {
  if (BILLING_PROVIDERS.indexOf(providerId) >= 0) {
    return { mode: 'billing', provider: providerId || '', reason: 'provider:' + (providerId || 'unknown') }
  }
  const sub = SUBSCRIPTION_PROVIDERS.indexOf(providerId) >= 0
  return { mode: sub ? 'subscription' : 'balance', provider: providerId || '', reason: 'provider:' + (providerId || 'unknown') }
}

// 本地令牌中的 plan_type → 显示名（未收录的 plan 类型按大写首字母兜底）
function planDisplayName(planType) {
  if (typeof planType === 'string' && planType.length > 0) {
    const known = Object.hasOwn(CODEX_PLAN_NAMES, planType) ? CODEX_PLAN_NAMES[planType] : null
    if (known) return known
    return 'ChatGPT ' + planType.charAt(0).toUpperCase() + planType.slice(1)
  }
  return 'ChatGPT Plus/Pro'
}

// OpenCode Go 窗口键（rolling=5小时滚动窗口 / weekly / monthly）
function openCodeGoWindowKey(apiKey) {
  if (apiKey === 'rolling') return 'five_hour'
  if (apiKey === 'weekly') return 'seven_day'
  if (apiKey === 'monthly') return 'monthly'
  return null
}

// 归一化重置时刻：数值（秒或毫秒）→ 毫秒；纯数字字符串同样按数值处理；ISO 字符串 → 毫秒；无法解析 → null
// 纯数字字符串必须走数值分支：Date.parse('1789284984350') 是 NaN，会让倒计时变 null，
// 而客户端简洁模式以 resetsAt 为选窗前提（无重置时刻 → 整组窗口消失），故不能只认 number。
function normalizeResetAt(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0 && /^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed)
      if (isFinite(numeric) && numeric >= 0) return numeric < 1e12 ? numeric * 1000 : numeric
      return null
    }
    const t = Date.parse(value)
    return isNaN(t) || t < 0 ? null : t
  }
  if (typeof value === 'number' && isFinite(value) && value >= 0) return value < 1e12 ? value * 1000 : value
  return null
}

// 解析 OpenCode Go usage 响应：usage.rolling / weekly / monthly → 统一窗口数组
// status 非 'ok' 的窗口跳过（如额度超限 / 接口异常）；结构异常返回 null
function parseOpenCodeGoUsage(body, windowLabels) {
  if (!body || typeof body !== 'object') return null
  const usage = body.usage
  if (!usage || typeof usage !== 'object') return null
  const windows = []
  for (const apiKey of ['rolling', 'weekly', 'monthly']) {
    const win = usage[apiKey]
    if (!win || typeof win !== 'object') continue
    if (win.status !== 'ok') continue
    const percent = parsePercent(win.percent)
    if (percent == null) continue
    const key = openCodeGoWindowKey(apiKey)
    windows.push({
      key: key,
      label: (windowLabels || WINDOW_LABELS)[key],
      usedPercent: Math.round(percent),
      resetsAt: normalizeResetAt(win.resetsAt),
    })
  }
  return { plan: 'OpenCode Go', windows: windows }
}

// 快照更新规则（"失败保留旧快照"的纯函数形态）：失败保留旧 data/fetchedAt 只换 error；成功换 data 并更新 fetchedAt
function mergeSubscriptionResult(prev, result, translate) {
  if (translate === undefined) translate = t
  if (!result || result.error) {
    return {
      data: prev && prev.data ? prev.data : null,
      fetchedAt: prev && prev.fetchedAt ? prev.fetchedAt : null,
      error: result ? result.error : { kind: 'exception', message: translate('host.unexpectedSubscriptionQuotaRequestFailure') },
    }
  }
  return { data: result.data || null, fetchedAt: Date.now(), error: null }
}

// 读 auth.json：{ ok:true, auth } 或 { ok:false, reason:'missing'|'corrupt' }（缺失/损坏一律不抛异常）
function readCodexAuthFile(filePath) {
  let raw = null
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (err) {
    return { ok: false, reason: err && err.code === 'ENOENT' ? 'missing' : 'corrupt' }
  }
  let auth = null
  try {
    auth = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: 'corrupt' }
  }
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return { ok: false, reason: 'corrupt' }
  return { ok: true, auth: auth }
}

// ================= v1.7 纯函数（FR-8/9/10/11/12/13/14；供单测直接提取） =================

// ---------- FR-8 / D7：本地 JWT 解码（纯本地，零网络） ----------
// 解码 JWT payload：base64url → base64（补 padding）→ Buffer → JSON；任何一步失败返回 null
function decodeJwtPayload(token) {
  if (typeof token !== 'string' || token.length === 0) return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4 !== 0) b64 += '='
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
    return payload && typeof payload === 'object' ? payload : null
  } catch (err) {
    return null
  }
}

// ChatGPT claims 命名空间：2026-08 实测 id_token 的订阅字段嵌套在
// "https://api.openai.com/auth" 下（非扁平顶层）；扁平形态做兼容兜底
function chatgptClaimSource(payload) {
  if (!payload || typeof payload !== 'object') return null
  const ns = payload['https://api.openai.com/auth']
  if (ns && typeof ns === 'object' && !Array.isArray(ns)) return ns
  return payload
}

// 解析 Codex/ChatGPT id_token → { planType, expiryMs }；字段全缺失 / 解码失败 → null（静默降级）
function parseCodexJwt(token) {
  const payload = decodeJwtPayload(token)
  if (!payload) return null
  const claims = chatgptClaimSource(payload)
  if (!claims) return null
  const planType = typeof claims.chatgpt_plan_type === 'string' && claims.chatgpt_plan_type.length > 0 ? claims.chatgpt_plan_type : null
  let expiryMs = null
  if (typeof claims.chatgpt_subscription_active_until === 'string' && claims.chatgpt_subscription_active_until.length > 0) {
    const t = Date.parse(claims.chatgpt_subscription_active_until)
    if (!isNaN(t)) expiryMs = t
  }
  if (!planType && !expiryMs) return null
  return { planType: planType, expiryMs: expiryMs }
}

// ---------- FR-9 / D8：小米 MiMo 解析（数值一律容错：字符串/数字、百分比 0-1 或 0-100 双形态） ----------
function xiaomiRegionBaseUrl(region) {
  if (region === 'sgp') return 'https://token-plan-sgp.xiaomimimo.com'
  if (region === 'ams') return 'https://token-plan-ams.xiaomimimo.com'
  return 'https://token-plan-cn.xiaomimimo.com'
}

// 百分比 → 0-100 整数（接口可能返回 0.1661=16.61% 或直接 16.61；>1 视为已是百分比）
function xiaomiPercentToUsed(percent) {
  const v = parseFiniteNonNegativeAmount(percent)
  if (v == null) return null
  const scaled = v <= 1 ? v * 100 : v
  return Math.round(Math.min(100, scaled))
}

// 解析 /v1/tokenPlan/usage：data.monthUsage（used/limit/percent）或 items[] 中 month_total_token；
// plan_name → 套餐名；返回统一月度窗口（重置时刻由本地推导：下月 1 日零点）
function parseXiaomiTokenPlanUsage(body, windowLabels) {
  if (!body || typeof body !== 'object') return null
  const data = body.data && typeof body.data === 'object' ? body.data : body
  let used = null
  let limit = null
  let percent = null
  const mu = data.monthUsage
  if (mu && typeof mu === 'object') {
    if (typeof mu.percent === 'number' || typeof mu.percent === 'string') percent = mu.percent
    if (typeof mu.used === 'number' || typeof mu.used === 'string') used = parseFiniteNonNegativeAmount(mu.used)
    if (typeof mu.limit === 'number' || typeof mu.limit === 'string') limit = parseFiniteNonNegativeAmount(mu.limit)
  }
  if (percent == null && Array.isArray(data.items)) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]
      if (!item || typeof item !== 'object') continue
      if (item.name !== 'month_total_token') continue
      if (typeof item.percent === 'number' || typeof item.percent === 'string') percent = item.percent
      if (typeof item.used === 'number' || typeof item.used === 'string') used = parseFiniteNonNegativeAmount(item.used)
      if (typeof item.limit === 'number' || typeof item.limit === 'string') limit = parseFiniteNonNegativeAmount(item.limit)
      break
    }
  }
  let usedPercent = xiaomiPercentToUsed(percent)
  if (usedPercent == null && used != null && limit != null && limit > 0) usedPercent = Math.round(Math.min(100, (used / limit) * 100))
  if (usedPercent == null) return null
  let planName = null
  const maybePlan = data.plan_name != null ? data.plan_name : (body.plan_name != null ? body.plan_name : (data.planName != null ? data.planName : null))
  if (typeof maybePlan === 'string' && maybePlan.length > 0) planName = maybePlan
  const wl = windowLabels || WINDOW_LABELS
  return { plan: planName, windows: [{ key: 'monthly', label: wl.monthly, usedPercent: usedPercent, resetsAt: nextMonthStartMs() }] }
}

// 解析 Token Plan /v1/user/balance 的套餐形态：{token_balance, token_limit, plan_name} → 月度额度窗
function parseXiaomiTokenPlanBalance(body, windowLabels) {
  if (!body || typeof body !== 'object') return null
  const data = body.data && typeof body.data === 'object' ? body.data : body
  const tokenBalance = parseFiniteNonNegativeAmount(data.token_balance)
  const tokenLimit = parseFiniteNonNegativeAmount(data.token_limit)
  if (tokenBalance == null || tokenLimit == null || tokenLimit <= 0) return null
  const usedPercent = xiaomiPercentToUsed(Math.max(0, Math.min(1, (tokenLimit - tokenBalance) / tokenLimit)))
  let planName = null
  const maybePlan = data.plan_name != null ? data.plan_name : (body.plan_name != null ? body.plan_name : null)
  if (typeof maybePlan === 'string' && maybePlan.length > 0) planName = maybePlan
  const wl = windowLabels || WINDOW_LABELS
  return { plan: planName, windows: [{ key: 'monthly', label: wl.monthly, usedPercent: usedPercent, resetsAt: nextMonthStartMs() }] }
}

// 解析按量 /v1/user/balance：{data:{balance, charge_balance, granted_balance, plan}}（balance 为字符串）
function parseXiaomiPaygBalance(body) {
  if (!body || typeof body !== 'object') return null
  const data = body.data && typeof body.data === 'object' ? body.data : body
  const total = parseFiniteNonNegativeAmount(data.balance)
  if (total == null) return null
  const granted = parseFiniteNonNegativeAmount(data.granted_balance)
  const toppedUp = parseFiniteNonNegativeAmount(data.charge_balance)
  return {
    currency: 'CNY',
    total: total,
    granted: granted == null ? 0 : granted,
    toppedUp: toppedUp == null ? 0 : toppedUp,
    plan: data.plan != null ? data.plan : null,
  }
}

// Balance APIs commonly encode amounts as strings.  Number.parseFloat is too
// permissive here ("12.3garbage" becomes 12.3) and `|| 0` turns a malformed
// response into a convincing but false zero balance.  A malformed required
// amount must make the whole snapshot fail so the caller can keep the last
// known-good value and show a refresh warning.
function parseFiniteNonNegativeAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function parsePercent(value) {
  const parsed = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim().length > 0 ? Number(value.trim()) : NaN)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(100, parsed) : null
}

// ---------- FR-3：智谱 Z.ai / GLM 套餐额度解析（parseZaiQuota） ----------
// 智谱 Coding Plan 2026-07-30 起改为积分制（credits）：同一批窗口的条目类型由
// TOKENS_LIMIT 变为 CREDIT_LIMIT，但 unit/number 语义不变（官方文档与 CodexBar、
// tokn、opencodex 三个社区实现一致）：
//   unit=3 表示「小时」，number=5 → 5 小时滚动窗口（配额消耗 5 小时后动态重置）
//   unit=6 表示「周」，  number=1 → 每周窗口（订阅激活起每 7 天重置）
// TIME_LIMIT 是另一类条目（MCP 工具调用月度额度），unit/number 语义与时间无关。
// 两种类型都必须接受——积分制账号只返回 CREDIT_LIMIT，老账号只返回 TOKENS_LIMIT，
// 迁移期还可能两种并存。
const ZAI_LIMIT_TYPES = ['TOKENS_LIMIT', 'CREDIT_LIMIT']
// (unit, number) → 窗口键：只在时长与已知窗口完全吻合时才映射，避免把未知时长
// （如未来新增的日窗口、10 小时窗口）错标成 5 小时窗口
const ZAI_LIMIT_WINDOWS = {
  '3:5': 'five_hour', // 3=小时 × 5 → 5 小时滚动窗口
  '6:1': 'seven_day', // 6=周 × 1 → 每周窗口
}

// 取 limit 里的数值字段（容忍数字型字符串，如 "5"；其余返回 null）
function zaiLimitNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

// 已用百分比：优先由原始计数推算，计数不可用时才回退接口给出的 percentage。
// 依据：上游 percentage 是整数（精度有限，低用量时可能取整到 0 → 底条显示 100%），
// 而 remaining/currentValue 与配额上限（usage，老形态为 total）是自洽的原始计数，
// 推算值更准也更抗 schema 漂移（CodexBar 同此策略）。
// 返回 0–100 的浮点数，无法计算时返回 null（调用方跳过该窗口）。
function zaiUsedPercent(limit) {
  // 配额上限：积分制用 usage，老 TOKENS_LIMIT 形态用 total
  const usage = zaiLimitNumber(limit.usage)
  const total = usage == null ? zaiLimitNumber(limit.total) : usage
  if (total == null || total <= 0) return parsePercent(limit.percentage)
  // 已用量：优先「上限 - 剩余」，回退 currentValue
  const remaining = zaiLimitNumber(limit.remaining)
  const current = zaiLimitNumber(limit.currentValue)
  const used = remaining != null ? total - remaining : current
  if (used == null) return parsePercent(limit.percentage)
  return Math.max(0, Math.min(100, (used / total) * 100))
}

// 解析智谱 quota 响应（GET /api/monitor/usage/quota/limit）→ 统一窗口数组
// data.limits[] 中 TOKENS_LIMIT / CREDIT_LIMIT 的已知窗口 → {key,label,usedPercent,resetsAt}；
// TIME_LIMIT（MCP 月度额度）→ monthly；未知类型/未知时长一律跳过，不报错（沿用「未知跳过」哲学）。
// level/planName → 套餐名（lite/standard/pro/max → 智谱 + 首字母大写）
function parseZaiQuota(body, windowLabels) {
  if (!body || typeof body !== 'object') return null
  const data = body.data
  if (!data || typeof data !== 'object') return null
  const wl = windowLabels || WINDOW_LABELS
  const limits = Array.isArray(data.limits) ? data.limits : []
  const windows = []
  const seen = {} // 窗口键去重：迁移期 TOKENS_LIMIT 与 CREDIT_LIMIT 可能并存，同键只取首个
  for (let i = 0; i < limits.length; i++) {
    const limit = limits[i]
    if (!limit || typeof limit !== 'object') continue
    const isMcp = limit.type === 'TIME_LIMIT'
    if (!isMcp && ZAI_LIMIT_TYPES.indexOf(limit.type) < 0) continue
    const number = zaiLimitNumber(limit.number)
    // TIME_LIMIT 的 unit/number 不表达窗口时长（unit=5 是 MCP 月度标记），直接归入月度窗口
    const key = isMcp ? 'monthly' : ZAI_LIMIT_WINDOWS[String(zaiLimitNumber(limit.unit)) + ':' + String(number)]
    if (!key || seen[key]) continue
    const usedPercent = zaiUsedPercent(limit)
    if (usedPercent == null) continue
    seen[key] = true
    windows.push({
      key: key,
      label: wl[key],
      usedPercent: Math.round(usedPercent),
      resetsAt: normalizeResetAt(limit.nextResetTime),
    })
  }
  // 套餐名：level 如 lite/standard/pro/max → 显示 '智谱 ' + 首字母大写
  let planName = null
  if (typeof data.level === 'string' && data.level.length > 0) {
    const levelMap = { lite: 'Lite', standard: 'Standard', pro: 'Pro', max: 'Max' }
    const levelKey = data.level.toLowerCase()
    const mapped = Object.hasOwn(levelMap, levelKey) ? levelMap[levelKey] : null
    planName = mapped ? t('host.zhipu', { mapped: mapped }) : (t('host.zhipu.parseZaiQuota', { value: data.level.charAt(0).toUpperCase(), value2: data.level.slice(1) }))
  } else if (typeof body.planName === 'string' && body.planName.length > 0) {
    planName = body.planName
  }
  return { plan: planName, windows: windows }
}

// 月度窗口重置时刻（本地推导）：下月 1 日零点（接口无重置字段，A4 记录为本地推导）
function nextMonthStartMs(nowMs) {
  const d = new Date(typeof nowMs === 'number' ? nowMs : Date.now())
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0).getTime()
}

// ---------- FR-10 / D9：Together 账单解析（本月真实已用金额 USD） ----------
// 官方 /billing/usage：data[].usage[].cost 逐项求和；结构异常返回 null
function parseTogetherUsage(body) {
  if (!body || typeof body !== 'object') return null
  const data = Array.isArray(body.data) ? body.data : []
  let spend = null
  for (let i = 0; i < data.length; i++) {
    const win = data[i]
    if (!win || typeof win !== 'object') continue
    const usages = Array.isArray(win.usage) ? win.usage : []
    for (let j = 0; j < usages.length; j++) {
      const u = usages[j]
      const cost = u && typeof u === 'object' ? parseFiniteNonNegativeAmount(u.cost) : null
      if (cost != null) spend = (spend || 0) + cost
    }
  }
  return spend
}

// ---------- FR-11 / D10：Fireworks 解析 ----------
// GET /v1/accounts → account_id（响应形态兼容数组 / {accounts:[]} / {data:[]}）
function parseFireworksAccountId(body) {
  if (!body || typeof body !== 'object') return null
  const candidates = []
  if (Array.isArray(body.accounts)) candidates.push.apply(candidates, body.accounts)
  if (Array.isArray(body.data)) candidates.push.apply(candidates, body.data)
  if (Array.isArray(body)) candidates.push.apply(candidates, body)
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    if (!c || typeof c !== 'object') continue
    const id = typeof c.id === 'string' && c.id.length > 0 ? c.id
      : (typeof c.name === 'string' && c.name.length > 0 ? c.name : null)
    if (id) return id
  }
  if (typeof body.id === 'string' && body.id.length > 0) return body.id
  return null
}

// 解析 billing/summary：lineItems[].totalCost 求和，回退 usageBuckets[].cost 求和
function parseFireworksSummary(body) {
  if (!body || typeof body !== 'object') return null
  let spend = null
  if (Array.isArray(body.lineItems)) {
    for (let i = 0; i < body.lineItems.length; i++) {
      const item = body.lineItems[i]
      const cost = item && typeof item === 'object' ? parseFiniteNonNegativeAmount(item.totalCost) : null
      if (cost != null) spend = (spend || 0) + cost
    }
  }
  if (spend == null && Array.isArray(body.usageBuckets)) {
    for (let i = 0; i < body.usageBuckets.length; i++) {
      const b = body.usageBuckets[i]
      const cost = b && typeof b === 'object' ? parseFiniteNonNegativeAmount(b.cost) : null
      if (cost != null) spend = (spend || 0) + cost
    }
  }
  return spend
}

// 解析 billingUsage（无金额时按 token 用量展示）：数值数组求和，字段名容错
function parseFireworksUsage(body) {
  if (!body || typeof body !== 'object') return null
  function tokenCount(value) {
    if (!value || typeof value !== 'object') return null
    const direct = parseFiniteNonNegativeAmount(value.totalTokens)
    if (direct != null) return direct
    const tokens = parseFiniteNonNegativeAmount(value.tokens)
    if (tokens != null) return tokens
    const input = parseFiniteNonNegativeAmount(value.inputTokens)
    const output = parseFiniteNonNegativeAmount(value.outputTokens)
    if (input == null && output == null) return null
    return (input || 0) + (output || 0)
  }
  let total = 0
  let hasToken = false
  const buckets = Array.isArray(body.usageBuckets) ? body.usageBuckets : (Array.isArray(body.buckets) ? body.buckets : [])
  for (let i = 0; i < buckets.length; i++) {
    const value = tokenCount(buckets[i])
    if (value != null) { total += value; hasToken = true }
  }
  if (!hasToken) {
    const value = tokenCount(body)
    if (value != null) { total = value; hasToken = true }
  }
  return hasToken ? total : null
}

// ---------- FR-12 / D11：AWS Bedrock（SigV4 纯实现，node:crypto） ----------
function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex')
}
function hmacSha256(key, data) {
  return createHmac('sha256', key).update(data).digest()
}
function awsAmzDate(now) {
  return now.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '')
}
function awsShortDate(amzDate) {
  return amzDate.slice(0, 8)
}
// SigV4 请求头计算（纯函数；单测用 AWS 官方 IAM ListUsers 固定向量验证）。
// headers: 现成请求头（小写 key）；body: 请求体字符串；service/region: 签名作用域。
// 返回 { 'X-Amz-Date', Authorization[, 'X-Amz-Security-Token'] }。payload hash 始终参与
// canonical request（协议要求），但不额外注入 x-amz-content-sha256 签名头（与官方测试向量一致，
// 且 AWS 服务器按请求体自算校验）。
function awsSigV4Headers(opts) {
  const method = opts.method || 'POST'
  const host = opts.host
  const path = opts.path || '/'
  const query = opts.query || ''
  const service = opts.service
  const region = opts.region || 'us-east-1'
  const body = opts.body || ''
  const now = opts.now || new Date()
  const amzDate = awsAmzDate(now)
  const dateStamp = awsShortDate(amzDate)
  const payloadHash = sha256Hex(body)
  const headers = {}
  for (const key in opts.headers) headers[key.toLowerCase()] = opts.headers[key]
  headers['host'] = host
  headers['x-amz-date'] = amzDate
  if (opts.sessionToken) headers['x-amz-security-token'] = opts.sessionToken
  const keys = Object.keys(headers).sort()
  const signedHeaders = keys.join(';')
  const canonicalHeaders = keys.map(function (key) { return key + ':' + String(headers[key]).trim().replace(/\s+/g, ' ') + '\n'; }).join('')
  const canonicalQuery = query.split('&').filter(Boolean).sort().map(function (pair) {
    const eq = pair.indexOf('=')
    const k = eq >= 0 ? pair.slice(0, eq) : pair
    const v = eq >= 0 ? pair.slice(eq + 1) : ''
    return awsUriEncode(k) + '=' + awsUriEncode(v)
  }).join('&')
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request'
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const kDate = hmacSha256('AWS4' + opts.secretAccessKey, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  const kSigning = hmacSha256(kService, 'aws4_request')
  const signature = hmacSha256(kSigning, stringToSign).toString('hex')
  const out = {
    'X-Amz-Date': amzDate,
    Authorization: 'AWS4-HMAC-SHA256 Credential=' + opts.accessKeyId + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
  }
  if (opts.sessionToken) out['X-Amz-Security-Token'] = opts.sessionToken
  return out
}
// AWS 路径/查询双编码：除 RFC3986 unreserved（A-Za-z0-9-_.~）外全部百分号编码（大写）。
// 不用正则实现，避免测试提取器被字符类内的引号干扰。
function awsUriEncode(value) {
  const str = String(value)
  let out = ''
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (c >= 'A' && c <= 'Z') out += c
    else if (c >= 'a' && c <= 'z') out += c
    else if (c >= '0' && c <= '9') out += c
    else if (c === '-' || c === '_' || c === '.' || c === '~') out += c
    else out += '%' + c.charCodeAt(0).toString(16).toUpperCase()
  }
  return out
}

// 解析 Cost Explorer GetCostAndUsage：ResultsByTime[0].Total.UnblendedCost.Amount（金额可为字符串）
function parseBedrockCost(json) {
  if (!json || typeof json !== 'object') return null
  const results = Array.isArray(json.ResultsByTime) ? json.ResultsByTime : []
  if (results.length === 0) return null
  const total = results[0] && results[0].Total
  const amount = total && total.UnblendedCost ? parseFiniteNonNegativeAmount(total.UnblendedCost.Amount) : null
  if (amount != null) return amount
  const alt = total && total.NetUnblendedCost ? parseFiniteNonNegativeAmount(total.NetUnblendedCost.Amount) : null
  return alt
}

// 解析 Budgets GetBudgets：首笔预算 actualSpend / budgetLimit → 预算使用百分比（0-100 整数）
function parseBedrockBudget(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.Budgets) || json.Budgets.length === 0) return null
  const budget = json.Budgets[0]
  if (!budget || typeof budget !== 'object') return null
  const limit = budget.BudgetLimit ? parseFiniteNonNegativeAmount(budget.BudgetLimit.Amount) : null
  const spend = budget.CalculatedSpend && budget.CalculatedSpend.ActualSpend
    ? parseFiniteNonNegativeAmount(budget.CalculatedSpend.ActualSpend.Amount) : null
  if (limit == null || limit <= 0 || spend == null) return null
  return Math.round(Math.min(100, (spend / limit) * 100))
}

// ---------- FR-13 / D12：Cloudflare Billable Usage 解析（Alpha） ----------
// result[] 逐项：cost → 本月真实花费；usage → 用量；
// 免费额度仅当接口显式给出 limit/allowance 类字段时才推导（拿不到就只显示用量，绝不编造）
function parseCloudflareBilling(body) {
  if (!body || typeof body !== 'object' || body.success !== true || !Array.isArray(body.result)) return null
  let spend = null
  let usage = null
  let usageUnit = null
  let freeRemaining = null
  let resetsAt = null
  let sawAny = false
  for (let i = 0; i < body.result.length; i++) {
    const item = body.result[i]
    if (!item || typeof item !== 'object') continue
    const itemCost = parseFiniteNonNegativeAmount(item.cost)
    const itemUsage = parseFiniteNonNegativeAmount(item.usage)
    if (itemCost != null) { spend = (spend || 0) + itemCost; sawAny = true }
    if (itemUsage != null) { usage = (usage || 0) + itemUsage; sawAny = true }
    if (!usageUnit && typeof item.unit === 'string' && item.unit.length > 0) usageUnit = item.unit
    // 免费额度：仅当同一条目显式给出已用 + 上限时推导（零点重置为 UTC 午夜，本地推导并注明）
    const explicitUsed = item.used != null ? parseFiniteNonNegativeAmount(item.used) : null
    const usedVal = explicitUsed != null ? explicitUsed : itemUsage
    const explicitLimit = item.limit != null ? parseFiniteNonNegativeAmount(item.limit) : null
    const limitVal = explicitLimit != null ? explicitLimit : parseFiniteNonNegativeAmount(item.allowance)
    if (usedVal != null && limitVal != null && limitVal > 0) {
      const remain = Math.max(0, limitVal - usedVal)
      if (freeRemaining == null || remain < freeRemaining) {
        freeRemaining = remain
        resetsAt = nextUtcMidnightMs()
      }
    }
  }
  if (!sawAny) return null
  return { spend: spend, usage: usage, usageUnit: usageUnit, freeRemaining: freeRemaining, resetsAt: resetsAt }
}
// 每日免费额度零点重置时刻（UTC 午夜；Cloudflare 免费额度按 UTC 日重置）
function nextUtcMidnightMs(nowMs) {
  const d = new Date(typeof nowMs === 'number' ? nowMs : Date.now())
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0)
}

// ---------- FR-14 / D13：统一账户状态收敛 ----------
// 新适配器（账单型）raw 输出 → 客户端统一契约（ProviderAccountStatus 子集）：
// { currency, currentPeriodSpend?, budgetPercent?, usage?, usageUnit?, freeRemaining?, resetsAt?, note }
function normalizeAccountStatus(kind, raw, fallbackCurrency) {
  const rawCurrency = raw && (raw.currency === 'CNY' || raw.currency === 'USD') ? raw.currency : null
  const safeFallback = fallbackCurrency === 'CNY' || fallbackCurrency === 'USD' ? fallbackCurrency : 'USD'
  const base = { currency: rawCurrency || safeFallback }
  if (kind === 'billing') {
    const spend = raw ? parseFiniteNonNegativeAmount(raw.spend) : null
    const budgetPercent = raw ? parsePercent(raw.budgetPercent) : null
    const usage = raw ? parseFiniteNonNegativeAmount(raw.usage) : null
    const freeRemaining = raw ? parseFiniteNonNegativeAmount(raw.freeRemaining) : null
    const resetsAt = raw ? normalizeResetAt(raw.resetsAt) : null
    if (spend != null) base.currentPeriodSpend = spend
    if (budgetPercent != null) base.budgetPercent = budgetPercent
    if (usage != null) base.usage = usage
    if (raw && typeof raw.usageUnit === 'string' && raw.usageUnit.length > 0) base.usageUnit = raw.usageUnit
    if (freeRemaining != null) base.freeRemaining = freeRemaining
    if (resetsAt != null) base.resetsAt = resetsAt
    if (raw && typeof raw.note === 'string' && raw.note.length > 0) base.note = raw.note
    return base
  }
  return null
}

// ---------- 订阅令牌与绑定（v1.2.0 起剥离）：绑定/OAuth/续期/写回/凭据注入由独立插件
// dsh-chatgpt-subscription 负责；本插件只保留 readCodexAuthFile（只读令牌用于额度请求） ----------

// 记账数值清洗：写入前的最后一道闸——NaN/Infinity/负数/非数字一律归 0（不让坏数值落盘、不污染汇总）
function sanitizeTokens(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

// 单条记账记录有效性（加载过滤）：ts/input/cacheRead/cacheWrite/output 均须为有限非负数；
// 手改/损坏文件里的 Infinity（如 JSON 字面量 1e999）与负值记录直接丢弃，绝不进入内存汇总
function isValidUsageRecord(r) {
  return !!r && typeof r === 'object' && typeof r.model === 'string' && typeof r.provider === 'string'
    && Number.isFinite(r.ts) && r.ts >= 0
    && Number.isFinite(r.input) && r.input >= 0
    && Number.isFinite(r.cacheRead) && r.cacheRead >= 0
    && Number.isFinite(r.cacheWrite) && r.cacheWrite >= 0
    && Number.isFinite(r.output) && r.output >= 0;
}

function legacyUsageRecordId(record, index, source) {
  const stable = JSON.stringify([source, index, record.ts, record.provider, record.model, record.sessionId, record.input, record.cacheRead, record.cacheWrite, record.output])
  return 'legacy-' + createHash('sha256').update(stable).digest('hex').slice(0, 24)
}

function normalizeUsageRecord(record, index, source) {
  const normalized = Object.assign({}, record)
  if (typeof normalized.id !== 'string' || normalized.id.length === 0) normalized.id = legacyUsageRecordId(normalized, index, source)
  if (typeof normalized.sessionId !== 'string') normalized.sessionId = normalized.sessionId == null ? '' : String(normalized.sessionId)
  if (typeof normalized.purpose !== 'string') normalized.purpose = normalized.purpose == null ? '' : String(normalized.purpose)
  if (normalized.status !== 'completed' && normalized.status !== 'interrupted') normalized.status = 'completed'
  const cost = parseFiniteNonNegativeAmount(normalized.cost)
  if (cost == null) {
    delete normalized.cost
    delete normalized.pricingVersion
    normalized.pricingStatus = 'unpriced'
  } else {
    normalized.cost = cost
    normalized.pricingStatus = 'priced'
  }
  if (normalized.currency !== 'CNY' && normalized.currency !== 'USD') delete normalized.currency
  return normalized
}

function readUsageSnapshot(filePath) {
  try {
    if (!existsSync(filePath)) return null
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter(isValidUsageRecord) : null
  } catch (err) { return null }
}

function usageRecordKey(record, index, source) {
  if (typeof record.id === 'string' && record.id.length > 0) return 'id:' + record.id
  // Legacy records had no stable id.  Keep their original snapshot position in
  // the key so upgrading never merges two legitimate, identical requests.
  return 'legacy:' + source + ':' + index + ':' + record.ts + ':' + record.provider + ':' + record.model + ':' + record.sessionId
}

// 账单数据清理只允许触达插件自己创建的精确文件/目录。临时文件也按固定前缀
// 收集，避免留下半次原子写；settings.json、pricing-cache.json 等非账单数据永不触达。
function ledgerArtifactPaths(includeClearMarker) {
  const paths = [
    DATA_FILE,
    DATA_BACKUP_FILE,
    DATA_TEMP_FILE,
    USAGE_JOURNAL_FILE,
    USAGE_SUMMARIES_FILE,
    USAGE_SUMMARIES_BACKUP_FILE,
    USAGE_ARCHIVE_DIR,
  ]
  try {
    if (existsSync(DATA_DIR)) {
      const dataTempPrefix = basename(DATA_TEMP_PREFIX)
      const summariesTempPrefix = basename(USAGE_SUMMARIES_TEMP_PREFIX)
      const journalCompactPrefix = basename(USAGE_JOURNAL_FILE) + '.compact.'
      const markerTempPrefix = basename(LEDGER_CLEAR_MARKER_FILE) + '.tmp.'
      for (const name of readdirSync(DATA_DIR)) {
        if (name.indexOf(dataTempPrefix) === 0
            || name.indexOf(summariesTempPrefix) === 0
            || name.indexOf(journalCompactPrefix) === 0
            || name.indexOf(markerTempPrefix) === 0) {
          paths.push(join(DATA_DIR, name))
        }
      }
    }
  } catch (err) { /* exact known paths remain clearable */ }
  if (includeClearMarker) paths.push(LEDGER_CLEAR_MARKER_FILE)
  return Array.from(new Set(paths))
}

function clearLedgerArtifacts() {
  const paths = ledgerArtifactPaths(false)
  for (const filePath of paths) {
    rmSync(filePath, { recursive: filePath === USAGE_ARCHIVE_DIR, force: true })
  }
  rmSync(LEDGER_CLEAR_MARKER_FILE, { force: true })
}

// 桶/索引的键都来自落盘记录（账户、币种、会话 ID）。JSON.parse 产生的 __proto__ 自有属性无害，
// 但 obj[key]= 赋值会触发原型污染——统一过一道键名护栏。
function safeMapKey(value) {
  const str = String(value)
  return str === '__proto__' || str === 'constructor' || str === 'prototype' ? '_' + str : str
}

// 北京日键（YYYY-MM-DD）→ 该日 0 点的毫秒时刻（桶的折叠边界按北京整天对齐）
function beijingDayStartMs(dayKey) {
  return Date.parse(dayKey + 'T00:00:00Z') - BEIJING_OFFSET_MS
}

function emptyDayBucket() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0, costOffpeak: 0, records: 0, unpriced: 0 }
}

function loadUsageRecords() {
  // A clear marker wins over every recovery source. If the host was interrupted
  // midway through deletion, never resurrect the old ledger from a backup/journal.
  if (existsSync(LEDGER_CLEAR_MARKER_FILE)) {
    return { records: [], migratedLegacyRecord: false, journalStats: { lines: 0, bytes: 0 }, clearPending: true }
  }
  // Recovery order: current snapshot → last known-good snapshot → interrupted
  // temporary snapshot.  A bad file must not turn a user's whole bill into 0.
  const temporarySnapshots = []
  try {
    if (existsSync(DATA_DIR)) {
      readdirSync(DATA_DIR).filter(function (name) { return name.indexOf('usage-records.json.tmp.') === 0; })
        .map(function (name) { return join(DATA_DIR, name); })
        .sort(function (a, b) { return statSync(b).mtimeMs - statSync(a).mtimeMs; })
        .forEach(function (file) { temporarySnapshots.push(file); })
    }
  } catch (err) { /* fall back to the legacy fixed temporary snapshot */ }
  const candidates = [DATA_FILE, DATA_BACKUP_FILE, DATA_TEMP_FILE].concat(temporarySnapshots)
  let snapshot = []
  for (let i = 0; i < candidates.length; i++) {
    const loaded = readUsageSnapshot(candidates[i])
    if (loaded) { snapshot = loaded; break }
  }
  const records = []
  const seen = new Set()
  let migratedLegacyRecord = false
  // journal 行数/字节数基线：滚动压缩只看阈值是否超限，不参与记账正确性
  let journalLines = 0
  function add(record, index, source) {
    if (!isValidUsageRecord(record)) return
    if (typeof record.id !== 'string' || record.id.length === 0) migratedLegacyRecord = true
    const normalized = normalizeUsageRecord(record, index, source)
    const key = usageRecordKey(normalized, index, source)
    if (seen.has(key)) return
    seen.add(key)
    records.push(normalized)
  }
  snapshot.forEach(function (record, index) { add(record, index, 'snapshot') })
  // A torn journal line only loses that one unfinished append; all preceding
  // valid lines remain usable.  This is deliberately unlike all-or-nothing JSON.
  let journalBytes = 0
  try {
    if (existsSync(USAGE_JOURNAL_FILE)) {
      const journalRaw = readFileSync(USAGE_JOURNAL_FILE, 'utf8')
      journalBytes = Buffer.byteLength(journalRaw)
      journalRaw.split('\n').forEach(function (line, index) {
        if (!line.trim()) return
        journalLines += 1
        try { add(JSON.parse(line), index, 'journal') } catch (err) { /* skip only the corrupt line */ }
      })
    }
  } catch (err) { /* snapshot is still a safe recovery source */ }
  return {
    records: records.sort(function (a, b) { return a.ts - b.ts }),
    migratedLegacyRecord: migratedLegacyRecord,
    journalStats: { lines: journalLines, bytes: journalBytes },
  }
}

function readArchivedUsageRecords() {
  const records = []
  const seen = new Set()
  try {
    if (!existsSync(USAGE_ARCHIVE_DIR)) return { records: records, error: null }
    const files = readdirSync(USAGE_ARCHIVE_DIR).filter(function (name) { return name.endsWith('.jsonl') }).sort()
    for (const name of files) {
      const filePath = join(USAGE_ARCHIVE_DIR, name)
      const raw = readFileSync(filePath, 'utf8')
      raw.split('\n').forEach(function (line, index) {
        if (!line.trim()) return
        try {
          const parsed = JSON.parse(line)
          if (!isValidUsageRecord(parsed)) return
          const normalized = normalizeUsageRecord(parsed, index, 'archive:' + name)
          const key = usageRecordKey(normalized, index, 'archive:' + name)
          if (seen.has(key)) return
          seen.add(key)
          records.push(normalized)
        } catch (err) { /* skip only a corrupt archive line */ }
      })
    }
    return { records: records.sort(function (a, b) { return a.ts - b.ts }), error: null }
  } catch (err) {
    return { records: records.sort(function (a, b) { return a.ts - b.ts }), error: String((err && err.message) || err) }
  }
}

// 测试/诊断专用遍历计数（不参与任何业务判定）：证明聚合不再随总记录数全量扫明细
function resetUsageInternals() {
  for (const key of Object.keys(__usageInternals.counters)) __usageInternals.counters[key] = 0;
}

export const __usageInternals = {
  counters: {
    detailScanCalls: 0,
    detailRecordsScanned: 0,
    recordUsageCount: 0,
    foldedRecords: 0,
    journalCompactions: 0,
    aggregatesVersion: 0,
  },
  reset: resetUsageInternals,
  normalizeSessionId: normalizeSessionIdValue,
  sessionLineageIds: sessionLineageIds,
}

// ---------- v1.9.0 PR2：settings.json（字段显隐/颜色/信息密度）读写 ----------
// 数据流：启动加载 → 内存缓存 → RPC 变更 → 原子落盘（tmp + fsync + rename，与账本快照同型）。
// 损坏/非法条目绝不拖垮信息栏：整体损坏回退默认并显式 warn；单条非法仅丢弃该条并聚合 warn。
// 字段 id 白名单 = FIELD_REGISTRY；颜色只接受预设色名或严格 #RRGGBB（存为大写）。
const FIELD_ID_SET = new Set(FIELD_REGISTRY.map(function (f) { return f.id }))
const PRESET_COLOR_SET = new Set(PRESET_COLOR_NAMES)

function isPlainSettingsObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// 保留键的纯对象浅拷贝，避免把宿主内部对象直接交给 JSON 序列化之外的路径
function shallowSettingsCopy(map) {
  const out = {}
  for (const key of Object.keys(map)) out[key] = map[key]
  return out
}

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}
function normalizeTimeFormatValue(raw) {
  if (!isPlainSettingsObject(raw)) return undefined
  const out = {}
  for (const k of TIME_FORMAT_KEYS) {
    const v = raw[k]
    if (typeof v !== 'boolean') return undefined
    out[k] = v
  }
  return out
}
function normalizeTimeZonesValue(raw) {
  if (!isPlainSettingsObject(raw)) return undefined
  const out = {}
  if ('main' in raw) {
    if (!isValidTimeZone(raw.main)) return undefined
    out.main = raw.main
  }
  if ('world' in raw) {
    if (!isValidTimeZone(raw.world)) return undefined
    out.world = raw.world
  }
  if (Object.keys(out).length === 0) return undefined
  return out
}
function normalizeCustomTextValue(value) {
  if (typeof value !== 'string') return undefined
  if (value.length > CUSTOM_TEXT_MAX_LEN) return undefined
  return value
}
function defaultFieldSettings() {
  const settings = { version: SETTINGS_FORMAT_VERSION, infoDensity: 'full', fields: {}, colors: {}, timeFormat: { ...DEFAULT_TIME_FORMAT }, timeZones: { ...DEFAULT_TIME_ZONES }, customText: '' }
  for (const field of FIELD_REGISTRY) {
    const isNewField = field.id === 'mainTime' || field.id === 'worldTime' || field.id === 'customText'
    settings.fields[field.id] = isNewField ? false : true
    settings.colors[field.id] = null // null=未自定义 → 客户端沿用原语义色（零回归）
  }
  return settings
}

// 非法颜色返回 undefined（调用方决定拒绝还是丢弃）；null=恢复默认；预设名原样；hex 归一化为 #RRGGBB 大写
function normalizeColorValue(value) {
  if (value === null) return null
  if (typeof value === 'string' && value.length > 0) {
    if (PRESET_COLOR_SET.has(value)) return value
    const lower = value.toLowerCase()
    if (HEX_COLOR_PATTERN.test(lower)) return lower.toUpperCase()
  }
  return undefined
}

// 逐条校验并归一化：返回 { settings, dropped }。dropped 非空时由调用方聚合 warn。
function sanitizeSettings(raw) {
  const settings = defaultFieldSettings()
  const dropped = []
  if (!isPlainSettingsObject(raw)) return { settings: settings, dropped: ['整个文件'] }
  if (raw.version !== SETTINGS_FORMAT_VERSION) dropped.push('version')
  if (raw.infoDensity === 'full' || raw.infoDensity === 'compact') settings.infoDensity = raw.infoDensity
  else dropped.push('infoDensity')
  if (isPlainSettingsObject(raw.fields)) {
    for (const key of Object.keys(raw.fields)) {
      const value = raw.fields[key]
      if (!FIELD_ID_SET.has(key) || typeof value !== 'boolean') { dropped.push('fields.' + key); continue }
      settings.fields[key] = value
    }
  } else dropped.push('fields')
  if (isPlainSettingsObject(raw.colors)) {
    for (const key of Object.keys(raw.colors)) {
      const normalized = normalizeColorValue(raw.colors[key])
      if (!FIELD_ID_SET.has(key) || normalized === undefined) { dropped.push('colors.' + key); continue }
      settings.colors[key] = normalized
    }
  } else dropped.push('colors')
  if (isPlainSettingsObject(raw.timeFormat)) {
    const normalized = normalizeTimeFormatValue(raw.timeFormat)
    if (normalized === undefined) dropped.push('timeFormat')
    else settings.timeFormat = normalized
  } else if ('timeFormat' in raw) dropped.push('timeFormat')
  if (isPlainSettingsObject(raw.timeZones)) {
    const out = { ...settings.timeZones }
    let ok = true
    if ('main' in raw.timeZones) {
      if (!isValidTimeZone(raw.timeZones.main)) { dropped.push('timeZones.main'); ok = false }
      else out.main = raw.timeZones.main
    }
    if ('world' in raw.timeZones) {
      if (!isValidTimeZone(raw.timeZones.world)) { dropped.push('timeZones.world'); ok = false }
      else out.world = raw.timeZones.world
    }
    if (ok) settings.timeZones = out
    if (!('main' in raw.timeZones) && !('world' in raw.timeZones) && Object.keys(raw.timeZones).length > 0) dropped.push('timeZones')
  } else if ('timeZones' in raw) dropped.push('timeZones')
  if ('customText' in raw) {
    const normalized = normalizeCustomTextValue(raw.customText)
    if (normalized === undefined) dropped.push('customText')
    else settings.customText = normalized
  }
  return { settings: settings, dropped: dropped }
}

function loadSettingsFromDisk() {
  try {
    if (!existsSync(SETTINGS_FILE)) return defaultFieldSettings()
    const parsed = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
    const result = sanitizeSettings(parsed)
    if (result.dropped.length > 0) {
      console.warn('[dsh-bottom-info-bar] settings.json 含无法识别的条目，已忽略：' + result.dropped.join(', '))
    }
    return result.settings
  } catch (err) {
    console.warn('[dsh-bottom-info-bar] settings.json 读取失败，已重置为默认设置：' + String((err && err.message) || err))
    return defaultFieldSettings()
  }
}

// 原子写：tmp 文件写满 + fsync 后 rename 覆盖（与 writeAndSync 快照路径同一模式，避免半截文件）
function writeFileAtomic(filePath, content, translate) {
  if (translate === undefined) translate = t
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  const tmp = filePath + '.tmp.' + process.pid + '.' + randomUUID()
  let fd = null
  try {
    fd = openSync(tmp, 'w', 0o600)
    const bytes = Buffer.from(content)
    let offset = 0
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset)
      if (!written) throw new Error(translate('host.settingsFileCouldNotBe'))
      offset += written
    }
    fsyncSync(fd)
  } finally {
    if (fd !== null) closeSync(fd)
  }
  renameSync(tmp, filePath)
}

// L1（安全审计低危建议）：启动时尽力而为收敛敏感文件权限——账本目录 0700、流水账 journal 0600。
// 只做 try/catch 包裹的 chmod：权限收敛失败（如非 POSIX 文件系统/只读挂载）绝不影响启动与记账。
function hardenLedgerFilePermissions() {
  try { chmodSync(DATA_DIR, 0o700) } catch (err) { /* 尽力而为，不因权限问题崩溃 */ }
  try {
    if (existsSync(USAGE_JOURNAL_FILE)) chmodSync(USAGE_JOURNAL_FILE, 0o600)
  } catch (err) { /* 尽力而为，不因权限问题崩溃 */ }
}

// DSH 的 sessionController 在宿主侧提供冷安全的会话摘要。这里仍接受
// id/parentId 两种字段名，方便和不同版本的宿主/测试桩对接。
function normalizeSessionIdValue(id) {
  if (!id) return ''
  return String(id).replace(/^session-/, '')
}

function sessionLineageIds(entries, rootSessionId) {
  const root = normalizeSessionIdValue(rootSessionId)
  const owned = new Set(root ? [root] : [])
  if (!root || !Array.isArray(entries)) return owned
  const childrenByParent = new Map()
  for (const entry of entries) {
    if (!entry || entry.origin !== 'subagent') continue
    const id = normalizeSessionIdValue(entry.sessionId != null ? entry.sessionId : entry.id)
    const parent = normalizeSessionIdValue(entry.parentSessionId != null ? entry.parentSessionId : entry.parentId)
    if (!id || !parent) continue
    const children = childrenByParent.get(parent) || []
    children.push(id)
    childrenByParent.set(parent, children)
  }
  const pending = [root]
  while (pending.length > 0) {
    const parent = pending.shift()
    const children = childrenByParent.get(parent) || []
    for (const child of children) {
      if (owned.has(child)) continue
      owned.add(child)
      pending.push(child)
    }
  }
  return owned
}

export const __settingsInternals = {
  // 测试/诊断专用：不参与任何业务判定
  sanitizeSettings: sanitizeSettings,
  normalizeColorValue: normalizeColorValue,
  defaultFieldSettings: defaultFieldSettings,
  settingsFile: SETTINGS_FILE,
  isValidTimeZone: isValidTimeZone,
  normalizeTimeFormatValue: normalizeTimeFormatValue,
  normalizeTimeZonesValue: normalizeTimeZonesValue,
  normalizeCustomTextValue: normalizeCustomTextValue,
  CUSTOM_TEXT_MAX_LEN: CUSTOM_TEXT_MAX_LEN,
  DEFAULT_TIME_FORMAT: DEFAULT_TIME_FORMAT,
  DEFAULT_TIME_ZONES: DEFAULT_TIME_ZONES,
}

export default {
  inject: ['credentials', 'timer'],
  apply(ctx) {
    const t = hostLocale.createHostTranslator(ctx);
    // 窗口标签：在 apply 内部按当前语言偏好重新计算（模块顶层 WINDOW_LABELS 仅作安全兜底）。
    const windowLabels = { five_hour: t('host.hour'), seven_day: t('ui.weekly'), monthly: t('ui.monthly') };
    // 版本检查只在 host 进程启动时发起一次；客户端后续只读取这个缓存结果。
    const updateInfoPromise = checkLatestVersion()
    // 会话谱系列表是冷安全读取，但仍可能触发持久化查询；短暂缓存避免信息栏轮询
    // 每次都重新扫描全部会话。缓存失效时再次读取，保证新建子代理最终能被纳入。
    const SESSION_LINEAGE_CACHE_MS = 1000
    let sessionLineageCache = { items: null, expiresAt: 0, pending: null }
    let sessionLineageWarningShown = false

    // 会话谱系控制器是可选服务，这里用 ctx.inject 声明式获取——它是 cordis 面向可选依赖的
    // 正规入口：服务缺席时回调不触发、不抛错，服务稍后就绪时还会自动补触发。
    // 严禁裸写 ctx.sessionController：cordis 4 的 Context 是 Proxy，读取未 provide 的属性会抛
    // "cannot get property ... without inject"，该异常曾让整个 getUsageSummary 恒返 500（Issue #67）。
    // DSH 自身的 dsh-subagent 也明确告诫过同一坑位，要求一律改用 ctx.get 严格全局读取。
    let sessionLineageController = null
    ctx.inject(['sessionController'], function (lineageCtx) {
      const service = lineageCtx.sessionController
      sessionLineageController = service && typeof service.list === 'function' ? service : null
      return function () { sessionLineageController = null }
    })

    function sessionControllerForLineage() {
      if (sessionLineageController) return sessionLineageController
      // 兜底：inject 回调尚未触发时（服务在本插件 apply 之后才就绪）主动探测一次。
      // ctx.get 对未注册服务返回 undefined，不抛错。
      try {
        if (ctx.get && typeof ctx.get === 'function') {
          const service = ctx.get('sessionController')
          if (service && typeof service.list === 'function') return service
        }
      } catch (err) { /* 老版本宿主没有 ctx.get：退回“只算选中会话” */ }
      // 拿不到就安全降级，任何情况下都不再触碰 ctx.<服务名> 属性。
      return null
    }

    // 谱系归并只是本会话花费的增强项：任何失败都只降级为“只算选中会话”，绝不冒泡打挂
    // 整个 getUsageSummary（否则余额照常显示、花费整块不可用）。每次启动只提示一次。
    function warnSessionLineageUnavailable(err) {
      if (sessionLineageWarningShown) return
      sessionLineageWarningShown = true
      console.warn('[dsh-bottom-info-bar] session lineage unavailable; current-session totals use the selected session only: ' + String((err && err.message) || err))
    }

    async function readSessionLineageItems() {
      let controller = null
      try {
        controller = sessionControllerForLineage()
      } catch (err) {
        warnSessionLineageUnavailable(err)
        return null
      }
      if (!controller) return null
      const now = Date.now()
      if (sessionLineageCache.expiresAt > now) return sessionLineageCache.items
      if (sessionLineageCache.pending) return sessionLineageCache.pending
      sessionLineageCache.pending = (async function () {
        try {
          const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(1500)
            : undefined
          const result = signal === undefined ? await controller.list({}) : await controller.list({}, signal)
          const items = Array.isArray(result) ? result : (result && Array.isArray(result.items) ? result.items : null)
          if (!items) throw new Error('sessionController.list returned no items')
          sessionLineageCache = { items: items, expiresAt: Date.now() + SESSION_LINEAGE_CACHE_MS, pending: null }
          return items
        } catch (err) {
          sessionLineageCache = { items: null, expiresAt: Date.now() + SESSION_LINEAGE_CACHE_MS, pending: null }
          warnSessionLineageUnavailable(err)
          return null
        }
      })()
      return sessionLineageCache.pending
    }

    // ---------- 定价表（元/美元 · 百万 tokens；来源与人工复核规则见 docs/PRICING-SOURCES.md） ----------
    const PRICING = {
      // DeepSeek 官方模型 & 价格页：deepseek-flash = DeepSeek-V4.1-Flash。
      // CNY/百万 tokens；工作日北京时间 09:00–12:00、14:00–18:00 为高峰，其余为空闲。
      'deepseek-flash': {
        currency: 'CNY', mode: 'peak-valley',
        peak:   { inputCacheHit: 0.04, inputCacheMiss: 2.0, output: 8.0 },
        offpeak:{ inputCacheHit: 0.02, inputCacheMiss: 1.0, output: 4.0 },
      },
      'deepseek-v4-flash': {
        currency: 'CNY', mode: 'peak-valley',
        peak:   { inputCacheHit: 0.04, inputCacheMiss: 2.0, output: 8.0 },
        offpeak:{ inputCacheHit: 0.02, inputCacheMiss: 1.0, output: 4.0 },
      },
      // 官方说明：此旧模型名仍暂时接受，但已下线，请求由 V4.1 Flash 提供服务并按 Flash 价格计费。
      'deepseek-v4-flash-vision-exp': {
        currency: 'CNY', mode: 'peak-valley',
        peak:   { inputCacheHit: 0.04, inputCacheMiss: 2.0, output: 8.0 },
        offpeak:{ inputCacheHit: 0.02, inputCacheMiss: 1.0, output: 4.0 },
      },
      'deepseek-v4-pro': {
        currency: 'CNY', mode: 'peak-valley',
        peak:   { inputCacheHit: 0.30, inputCacheMiss: 9.0, output: 27.0 },
        offpeak:{ inputCacheHit: 0.15, inputCacheMiss: 4.5, output: 13.5 },
      },
      'deepseek-chat': { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.5, inputCacheMiss: 2.0, output: 8.0 } },
      'gpt-4o':        { currency: 'USD', mode: 'flat', price: { inputCacheHit: 1.25, inputCacheMiss: 2.5, output: 10.0 } },
      'gpt-4o-mini':   { currency: 'USD', mode: 'flat', price: { inputCacheHit: 0.15, inputCacheMiss: 0.15, output: 0.6 } },
      // ---------- 智谱 BigModel 官方按量价（CNY/百万 tokens；来源 open.bigmodel.cn/pricing，
      // 采集记录与全档分段备注见 docs/research/bigmodel-pricing-202608.md）----------
      // 分段模型主条目取基础档（输入≤32K 等），长上下文档暂不计入——影响与限制见体系审计报告。
      'glm-5.3':       { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 2,    inputCacheMiss: 8,   output: 28 } },
      // flash 存在"5折限时两周"双价：内置表取刊例价 0.8/0.23/2.8（保守）；
      // 远程目录按用户当前实扣配促销价（活动窗口约至 2026-09 初，详见 catalog/pricing.json notes）
      'glm-5.3-flash': { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.23, inputCacheMiss: 0.8, output: 2.8 } },
      'glm-5.2':       { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 2,    inputCacheMiss: 8,   output: 28 } },
      'glm-5.1':       { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 1.3,  inputCacheMiss: 6,   output: 24 } },
      'glm-5-turbo':   { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 1.2,  inputCacheMiss: 5,   output: 22 } },
      'glm-5v-turbo':  { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 1.2,  inputCacheMiss: 5,   output: 22 } },
      'glm-4.7':       { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.4,  inputCacheMiss: 2,   output: 8 } },
      'glm-4.5-air':   { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.16, inputCacheMiss: 0.8, output: 2 } },
      // ---------- 小米 MiMo 按量官方价（mimo.mi.com/docs/zh-CN/price/pay-as-you-go，2026-08-06 调价后 CNY；
      // 本机 pi-ai 目录里的 cost 字段是 USD 数字——严禁混用，详见体系审计报告）----------
      'mimo-v2-flash':  { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.02,  inputCacheMiss: 1,   output: 2 } },
      'mimo-v2-omni':   { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.02,  inputCacheMiss: 1,   output: 2 } },
      'mimo-v2-pro':    { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.025, inputCacheMiss: 3,   output: 6 } },
      'mimo-v2.5':      { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.02,  inputCacheMiss: 1,   output: 2 } },
      'mimo-v2.5-pro':  { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.025, inputCacheMiss: 3,   output: 6 } },
      // mimo-v2.5-pro-ultraspeed：官方仅美元口径、人民币数未独立确认 → 按"不臆测"暂不收录
      // ---------- 阶跃 StepFun 在售文本模型（platform.stepfun.com 定价详情；step-1/2/3 系已于 2026-07 下线）----------
      'step-3.7-flash': { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.27,  inputCacheMiss: 1.35, output: 8.1 } },
      'step-3.5-flash': { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.14,  inputCacheMiss: 0.7,  output: 2.1 } },
      // ---------- Kimi 国内站（provider=moonshotai-cn → api.moonshot.cn 计费 ¥）----------
      // 同型号在 api.moonshot.ai 国际站按 $ 另计：官方 USD 数字待采集后以 'moonshotai:kimi-*'
      // 作用域键收录；裸 kimi-* 键刻意留空，防止币种串档。
      'moonshotai-cn:kimi-k3':                 { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 2,    inputCacheMiss: 20,   output: 100 } },
      'moonshotai-cn:kimi-k2.5':               { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.7,  inputCacheMiss: 4,    output: 21 } },
      'moonshotai-cn:kimi-k2.6':               { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 1.1,  inputCacheMiss: 6.5,  output: 27 } },
      'moonshotai-cn:kimi-k2.7-code':          { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 1.3,  inputCacheMiss: 6.5,  output: 27 } },
      'moonshotai-cn:kimi-k2.7-code-highspeed':{ currency: 'CNY', mode: 'flat', price: { inputCacheHit: 2.6,  inputCacheMiss: 13,   output: 54 } },
      'moonshotai-cn:kimi-k2-0711-preview':    { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.15, inputCacheMiss: 0.6,  output: 2.5 } },
      'moonshotai-cn:kimi-k2-0905-preview':    { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.15, inputCacheMiss: 0.6,  output: 2.5 } },
      'moonshotai-cn:kimi-k2-thinking':        { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.15, inputCacheMiss: 0.6,  output: 2.5 } },
      'moonshotai-cn:kimi-k2-thinking-turbo':  { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.15, inputCacheMiss: 1.15, output: 8 } },
      'moonshotai-cn:kimi-k2-turbo-preview':   { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.6,  inputCacheMiss: 2.4,  output: 10 } },
    };
    function modelCurrency(provider, model) {
      // 服务商作用域键优先：同名模型跨计费域时（Kimi 国内外），币种必须跟作用域走
      if (typeof provider !== 'string' || provider.trim().length === 0
          || typeof model !== 'string' || model.trim().length === 0) return null;
      const entry = pricingEntryFor(provider, model);
      if (entry && entry.currency) return entry.currency;
      if (provider === 'openai' || provider === 'openrouter' || provider === 'anthropic' || provider === 'google' || provider === 'gemini' || provider === 'mistral' || provider === 'groq' || provider === 'xai') return 'USD';
      if (provider === 'openai-codex' || provider === 'chatgpt' || provider === 'codex') return 'USD';
      if (model && /^(gpt|o1|o3|claude|gemini|grok)/.test(model)) return 'USD';
      return 'CNY';
    }
    // ---------- 远程价目目录（v1.8）：内置表兜底 + 启动/定时增量更新 ----------
    // 设计目标（用户铁律）：接入新模型/新价格不再依赖插件发版。
    // 机制：启动时先用磁盘缓存离线合并，再异步拉取远程 catalog/pricing.json 增量合并；
    //       每合并一次立即重跑 unpriced 回填 → 新覆盖的模型的历史账目自动补算。
    // 安全边界：仅接受"声明式数字"（统一价 + 白名单币种），绝不执行远程代码；
    //          匿名 GET 不携带任何密钥/用户标识；失败静默降级缓存与内置表，不影响信息栏。
    const REMOTE_PRICING_URL = process.env.DSH_BOTTOM_INFO_BAR_PRICING_URL
      || 'https://raw.githubusercontent.com/songoao25/dsh-bottom-info-bar/main/catalog/pricing.json';
    const REMOTE_PRICING_REFRESH_MS = 6 * 60 * 60 * 1000; // 定时刷新：6 小时
    const PRICING_CACHE_FILE = join(DATA_DIR, 'pricing-cache.json');
    let remotePricingEtag = null;

    // 校验目录条目：只放行可安全参与计算的声明式数据
    function sanitizeRemotePricingEntries(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const entries = Object.create(null);
      for (const key of Object.keys(raw)) {
        if (Object.keys(entries).length >= 512) break; // 容量上限，防滥用
        // 字符集 [A-Za-z0-9._:-] 允许 "provider:model" 作用域键，拒绝空段/前后缀冒号
        if (!/^[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)?$/.test(key) || key.length > 64) continue;
        const e = raw[key];
        if (!e || typeof e !== 'object') continue;
        // v1 仅接受统一价（flat）；分时价的窗口规则须随框架参数化后再开放远程下发
        if (e.mode !== 'flat' || !e.price || typeof e.price !== 'object') continue;
        if (e.currency !== 'CNY' && e.currency !== 'USD') continue; // 白名单币种
        const hit = parseFiniteNonNegativeAmount(e.price.inputCacheHit);
        const miss = parseFiniteNonNegativeAmount(e.price.inputCacheMiss);
        const out = parseFiniteNonNegativeAmount(e.price.output);
        if (hit == null || miss == null || out == null) continue;
        if (miss <= 0 || hit < 0 || out < 0) continue;
        if (hit > miss) continue; // 缓存命中不可能比未命中更贵：脏数据拒收
        entries[key] = { currency: e.currency, mode: 'flat', price: { inputCacheHit: hit, inputCacheMiss: miss, output: out } };
      }
      return Object.keys(entries).length > 0 ? entries : null;
    }

    // 合并进运行时价目表并触发回填；返回本次新增/更新的条数
    function applyRemotePricingEntries(entries) {
      if (!entries) return 0;
      let n = 0;
      for (const key of Object.keys(entries)) {
        PRICING[key] = entries[key];
        n++;
      }
      if (n > 0) backfillUnpricedRecords();
      return n;
    }

    function loadPricingCacheFromDisk() {
      try {
        const parsed = JSON.parse(readFileSync(PRICING_CACHE_FILE, 'utf8'));
        return sanitizeRemotePricingEntries(parsed && parsed.entries);
      } catch (err) { /* 无缓存/损坏 → 内置表兜底 */ }
      return null;
    }

    function savePricingCacheToDisk(entries) {
      try {
        mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
        writeAndSync(PRICING_CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), etag: remotePricingEtag, entries: entries }), 'w');
      } catch (err) { /* 缓存写失败不致命 */ }
    }

    async function refreshRemotePricing(reason) {
      try {
        const headers = {};
        if (remotePricingEtag) headers['If-None-Match'] = remotePricingEtag;
        const res = await fetch(REMOTE_PRICING_URL, { headers, signal: AbortSignal.timeout(10000) });
        if (res.status === 304) return { status: 'fresh' }; // 目录未变
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const body = await res.json();
        const entries = sanitizeRemotePricingEntries(body);
        if (!entries) throw new Error('目录格式不符合规范');
        remotePricingEtag = res.headers.get('etag');
        savePricingCacheToDisk(entries);
        const merged = applyRemotePricingEntries(entries);
        console.warn('[dsh-bottom-info-bar] 远程价目已合并（' + reason + '）：' + merged + ' 条有效条目');
        return { status: 'merged', count: merged };
      } catch (err) {
        console.warn('[dsh-bottom-info-bar] 远程价目获取失败（' + reason + '），沿用缓存/内置表：' + String((err && err.message) || err));
        return { status: 'error', message: String((err && err.message) || err) };
      }
    }

    const SCENARIOS = [
      { id: 'qa',       label: t('host.everydayQuestions'),            outputK: 2,   inputK: 4 },
      { id: 'coding',   label: t('host.mediumCodingTask'),        outputK: 15,  inputK: 30 },
      { id: 'doc',      label: t('host.longDocumentAnalysisCodeReview'), outputK: 40,  inputK: 120 },
      { id: 'refactor', label: t('host.largeProjectRefactorAcrossMultiple'),  outputK: 150, inputK: 500 },
      { id: 'subagent', label: t('host.subagentWorkflow'),        outputK: 300, inputK: 1000 },
    ];
    const CALIB_SESSIONS = 10;
    const SPEND_DAYS = 7;
    const ALERT_THRESHOLD = 20; // 默认预警阈值（¥/$）

    // ---------- 服务商适配器（余额仅 DeepSeek 真实 API；OpenAI 为记账回退估算） ----------
    const PROVIDERS = {
      deepseek: {
        id: 'deepseek', displayName: 'DeepSeek', credential: 'DEEPSEEK_API_KEY',
        balanceAPI: 'https://api.deepseek.com/user/balance',
        estimate: false,
        parseBalance: function (body) {
          const list = body && Array.isArray(body.balance_infos) ? body.balance_infos : [];
          let rec = null;
          for (let i = 0; i < list.length; i++) {
            if (list[i] && list[i].currency === 'CNY' && parseFiniteNonNegativeAmount(list[i].total_balance) != null) {
              rec = list[i]; break;
            }
          }
          if (!rec) {
            for (let i = 0; i < list.length; i++) {
              if (list[i] && list[i].currency === 'USD' && parseFiniteNonNegativeAmount(list[i].total_balance) != null) {
                rec = list[i]; break;
              }
            }
          }
          if (!rec) return null;
          const currency = rec.currency === 'USD' || rec.currency === 'CNY' ? rec.currency : null;
          if (!currency) return null;
          const total = parseFiniteNonNegativeAmount(rec.total_balance);
          if (total == null) return null;
          const granted = parseFiniteNonNegativeAmount(rec.granted_balance);
          const toppedUp = parseFiniteNonNegativeAmount(rec.topped_up_balance);
          return {
            currency: currency,
            total: total,
            granted: granted == null ? 0 : granted,
            toppedUp: toppedUp == null ? 0 : toppedUp,
          };
        },
      },
      openai: {
        id: 'openai', displayName: 'OpenAI', credential: 'OPENAI_API_KEY',
        balanceAPI: null, // 无公开余额 API → 记账回退
        estimate: true,
        initialTopUp: 20, // USD 起始充值额（内存态）
      },
      // v1.6 T3：moonshotai（Kimi）余额适配器
      moonshotai: {
        id: 'moonshotai', displayName: 'Kimi', credential: 'MOONSHOT_API_KEY',
        balanceAPI: 'https://api.moonshot.cn/v1/users/me/balance',
        estimate: false,
        parseBalance: function (body) {
          const list = body && Array.isArray(body.balance_infos) ? body.balance_infos : [];
          // 优先选择可用的 CNY 账户；没有时选择可用的 USD 账户，不依赖数组首项。
          let rec = null;
          for (let i = 0; i < list.length; i++) {
            if (list[i] && list[i].currency === 'CNY' && parseFiniteNonNegativeAmount(list[i].total_balance) != null) {
              rec = list[i]; break;
            }
          }
          if (!rec) {
            for (let i = 0; i < list.length; i++) {
              if (list[i] && list[i].currency === 'USD' && parseFiniteNonNegativeAmount(list[i].total_balance) != null) {
                rec = list[i]; break;
              }
            }
          }
          if (!rec) return null;
          const currency = rec.currency === 'USD' || rec.currency === 'CNY' ? rec.currency : null;
          if (!currency) return null;
          const total = parseFiniteNonNegativeAmount(rec.total_balance);
          if (total == null) return null;
          const granted = parseFiniteNonNegativeAmount(rec.granted_balance);
          const toppedUp = parseFiniteNonNegativeAmount(rec.topped_up_balance);
          return {
            currency: currency,
            total: total,
            granted: granted == null ? 0 : granted,
            toppedUp: toppedUp == null ? 0 : toppedUp,
          };
        },
      },
      // v1.6 T4：openrouter 余额适配器
      openrouter: {
        id: 'openrouter', displayName: 'OpenRouter', credential: 'OPENROUTER_API_KEY',
        balanceAPI: 'https://openrouter.ai/api/v1/credits',
        estimate: false,
        parseBalance: function (body) {
          const data = body && body.data;
          const total = data ? parseFiniteNonNegativeAmount(data.credits) : null;
          if (total == null) return null;
          return {
            currency: 'USD',
            total: total,
          };
        },
      },
      // v1.6 T5：stepfun（阶跃星辰）余额适配器
      stepfun: {
        id: 'stepfun', displayName: 'StepFun', credential: 'STEPFUN_API_KEY',
        balanceAPI: 'https://api.stepfun.com/v1/accounts',
        estimate: false,
        parseBalance: function (body) {
          // 官方文档：balance 为可用余额（CNY），total_cash_balance/total_voucher_balance/type
          // 注意：官方文档无 token_plan 字段，不要解析
          if (!body || typeof body !== 'object') return null;
          const balance = parseFiniteNonNegativeAmount(body.balance);
          if (balance == null) return null;
          const totalCashBalance = parseFiniteNonNegativeAmount(body.total_cash_balance);
          const totalVoucherBalance = parseFiniteNonNegativeAmount(body.total_voucher_balance);
          return {
            currency: body.currency === 'USD' ? 'USD' : 'CNY',
            total: balance,
            granted: 0,
            toppedUp: 0,
            type: body.type || null,
            totalCashBalance: totalCashBalance == null ? null : totalCashBalance,
            totalVoucherBalance: totalVoucherBalance == null ? null : totalVoucherBalance,
          };
        },
      },
      // v1.7 FR-9：xiaomi（MiMo 按量）余额适配器——B 级半公开端点，Bearer API Key 零设置
      xiaomi: {
        id: 'xiaomi', displayName: t('ui.xiaomiMiMo'), credential: 'XIAOMI_API_KEY', currency: 'CNY',
        balanceAPI: 'https://api.xiaomimimo.com/v1/user/balance',
        estimate: false,
        parseBalance: parseXiaomiPaygBalance,
      },
    };

    // ---------- 配置（内存态） ----------
    // v1.9.0 PR2：settings.json 启动加载进内存缓存；infoDensity 改为落盘持久（修复重启即丢）
    let fieldSettings = loadSettingsFromDisk();
    let settingsConfigVersion = 0; // configVersion：每次设置变更 +1，客户端据此识别新配置
    function settingsPayload(persistError) {
      return {
        version: fieldSettings.version,
        infoDensity: config.infoDensity,
        fields: shallowSettingsCopy(fieldSettings.fields),
        colors: shallowSettingsCopy(fieldSettings.colors),
        timeFormat: { ...fieldSettings.timeFormat },
        timeZones: { ...fieldSettings.timeZones },
        customText: fieldSettings.customText,
        configVersion: settingsConfigVersion,
        persisted: persistError == null,
        warning: persistError == null ? null : String(persistError),
      };
    }
    function persistSettings() {
      // 落盘失败不阻断内存态生效（本会话内一致），但显式 warn 并把结果带回客户端
      try {
        writeFileAtomic(SETTINGS_FILE, JSON.stringify(fieldSettings), t);
        return null;
      } catch (err) {
        const message = t('host.couldNotSaveSettingsJson', { value: String((err && err.message) || err) });
        console.warn('[dsh-bottom-info-bar] ' + message);
        return message;
      }
    }
    let config = {
      displayMode: 'replace',
      infoDensity: fieldSettings.infoDensity, // 'full' 完整 | 'compact' 简洁（v1.9 起落盘持久）
      alertThreshold: ALERT_THRESHOLD,
    };

    // ---------- 余额快照（60s 定时刷新；失败保留上次快照） ----------
    let balances = Object.create(null); // { [providerId]: { data, fetchedAt, error } }
    const BALANCE_CLIENT_ACTIVITY_MS = 90 * 1000; // 客户端每 30s 拉取；停止使用后不再后台轮询该账户
    const balanceRequestedAt = Object.create(null); // { [providerId]: last client request ms }

    // v1.6：记录归属账户（用于花费分账）；null 表示"无主记录"，不参与任何账户汇总
    function recordAccount(r) {
      return accountForProvider(r.provider);
    }

    // v1.6：providerSpend 改为按 recordAccount === pid 过滤（修复 deepseek-official 记录不计入 deepseek 的旧问题）
    // v1.9：改为读账户累计器（随记账/回填/折叠增量维护），openai 记账回退的 60s 轮询不再全扫明细
    function providerSpend(providerId) {
      const total = summariesState.accountTotals[safeMapKey(providerId == null ? NULL_ACCOUNT_KEY : providerId)];
      return typeof total === 'number' ? total : 0;
    }

    const balanceSeq = Object.create(null); // 每 provider 刷新序号：仅最新一次请求可写入快照，防慢请求覆盖新数据
    const balanceInFlight = Object.create(null); // 普通周期刷新并发去重；force 刷新可主动 supersede 旧请求

    function markBalanceRequested(pid, nowMs) {
      if (!pid || !Object.hasOwn(PROVIDERS, pid)) return false;
      const now = typeof nowMs === 'number' ? nowMs : Date.now();
      const previous = balanceRequestedAt[pid];
      balanceRequestedAt[pid] = now;
      return typeof previous !== 'number' || now - previous > BALANCE_CLIENT_ACTIVITY_MS;
    }

    function freshBalanceURL(endpoint) {
      try {
        const url = new URL(endpoint);
        // API 余额是易变数据，给可能存在的中间缓存一个明确的请求代次；不携带任何凭据。
        url.searchParams.set('_dsh_refresh', String(Date.now()));
        return url.toString();
      } catch (err) {
        return endpoint;
      }
    }

    function refreshProviderBalance(pid, force) {
      const prov = PROVIDERS[pid];
      if (!prov) return Promise.resolve();
      // 定时器可能与首屏请求重叠：普通刷新复用在途请求，避免无意义的重复 API 调用。
      // force 只用于用户打开/刷新页面或主动切换 provider，必须允许它重新取最新值。
      if (!force && balanceInFlight[pid]) return balanceInFlight[pid];
      const seq = (balanceSeq[pid] || 0) + 1;
      balanceSeq[pid] = seq;
      if (!prov.balanceAPI) {
        // 记账回退：估算余额 = 起始充值额 - 累计花费
        const spend = providerSpend(pid);
        const total = Math.max(0, prov.initialTopUp - spend);
        balances[pid] = { data: { currency: 'USD', total: total, granted: 0, toppedUp: prov.initialTopUp }, fetchedAt: Date.now(), error: null };
        return Promise.resolve();
      }
      // 返回本次刷新 Promise：强制刷新路径（客户端打开页面）需等待最新结果落快照后再返回
      const task = (async function () {
        let cred = null;
        try {
          cred = await ctx.credentials.resolve(prov.credential);
        } catch (err) {
          // 与下方 http/parse/exception 分支一致：失败保留旧 data/fetchedAt，仅换 error；seq guard 防慢请求覆盖新快照
          if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'credentials', message: t('host.couldNotReadCredentials') } };
          return;
        }
        if (!cred || !cred.value) {
          // no-key 同样保留旧快照：一次瞬断/未配置不把好数据清空（客户端据 error 显示配置引导/警示）
          if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'no-key', message: t('host.notConfigured', { credential: prov.credential }) } };
          return;
        }
        try {
          // API Key 经 HTTP 头传递，不进子进程命令行（避免 ps 可见 / shell 注入）
          const res = await fetch(freshBalanceURL(prov.balanceAPI), {
            headers: {
              Authorization: 'Bearer ' + cred.value,
              'Cache-Control': 'no-cache, no-store',
              Pragma: 'no-cache',
            },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) {
            if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'http', message: t('host.requestFailedHTTP', { status: res.status }) } };
            return;
          }
          const body = await res.json();
          const parsed = prov.parseBalance(body);
          if (!parsed) {
            if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'parse', message: t('host.unexpectedResponseFormat') } };
            return;
          }
          if (balanceSeq[pid] === seq) balances[pid] = { data: parsed, fetchedAt: Date.now(), error: null };
        } catch (err) {
          if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'exception', message: String((err && err.message) || err) } };
        }
      })();
      balanceInFlight[pid] = task;
      task.then(function () {
        if (balanceInFlight[pid] === task) balanceInFlight[pid] = null;
      }, function () {
        if (balanceInFlight[pid] === task) balanceInFlight[pid] = null;
      });
      return task;
    }

    function refreshAllBalances() {
      const now = Date.now();
      for (const pid of Object.keys(balanceRequestedAt)) {
        if (now - balanceRequestedAt[pid] > BALANCE_CLIENT_ACTIVITY_MS) {
          delete balanceRequestedAt[pid];
          continue;
        }
        refreshProviderBalance(pid, false);
      }
    }

    // ---------- 订阅额度快照（复用余额模式：周期刷新 / 失败保留旧快照 / seq 防旧覆盖） ----------
    let subscriptions = Object.create(null); // { [sourceKey]: { data: {provider,plan,windows}, fetchedAt, error } }
    const subscriptionSeq = Object.create(null); // 每 source 刷新序号：仅最新一次请求可写入快照
    const subscriptionInFlight = Object.create(null); // { [sourceKey]: Promise } 并发去重（同一时刻只发一个请求）
    const subscriptionRequested = Object.create(null); // 仅"客户端请求过"的源进入 60s 周期刷新（余额制下不打扰订阅接口）
    const subscriptionSourceProvider = Object.create(null); // { [sourceKey]: providerId }——记住请求该源时的 provider（zai 系按 provider 路由 host/凭据）
    const subscriptionLastFailAt = Object.create(null); // { [sourceKey]: ms } 上次订阅刷新失败时刻（失败退避：期内不重试）

    // FR-8 / D7：Codex / ChatGPT 订阅卡（纯本地通道）
    // 只读令牌：令牌由独立插件 dsh-chatgpt-subscription 维护，本插件不续期、不写回、不注入凭据；
    // 读 tokens.id_token 本地解码 JWT claims（chatgpt_plan_type / subscription_active_until）→ 真实套餐名与到期日。
    // 解码/字段缺失 → 静默降级（不显式报错、不访问远程订阅接口）；
    // 令牌缺失 → no-key（客户端显示"未绑定"引导）。
    async function fetchCodexUsage() {
      const read = readCodexAuthFile(CODEX_AUTH_FILE);
      if (!read.ok) {
        return { error: { kind: 'no-key', message: t('host.chatgptSubscriptionIsNotConnected') } };
      }
      const tokens = read.auth && read.auth.tokens;
      const idToken = tokens && typeof tokens.id_token === 'string' && tokens.id_token.length > 0 ? tokens.id_token : null;
      if (!idToken) {
        return { error: { kind: 'no-key', message: t('host.chatgptSubscriptionCredentialsAreMissing') } };
      }
      let parsed = null;
      try { parsed = parseCodexJwt(idToken); } catch (err) { /* 解码异常 → 静默降级 */ }
      if (!parsed) {
        // 静默降级：纯本地解析失败/字段缺失 → 返回无额度数据（非错误），客户端只显示服务名+模型，不打扰
        return { data: { provider: 'codex', plan: null, planType: null, expiryAt: null, windows: [] } };
      }
      const plan = parsed.planType ? planDisplayName(parsed.planType) : null;
      return { data: { provider: 'codex', plan: plan, planType: parsed.planType, expiryAt: parsed.expiryMs, windows: [] } };
    }

    // OpenCode Go key 解析：DSH credentials（OPENCODE_GO_API_KEY）→ opencode auth.json（opencode-go → opencode）
    async function resolveOpenCodeGoKey() {
      try {
        const cred = await ctx.credentials.resolve('OPENCODE_GO_API_KEY');
        if (cred && typeof cred.value === 'string' && cred.value.length > 0) return cred.value;
      } catch (err) { /* 回退到 auth.json */ }
      try {
        const auth = JSON.parse(readFileSync(OPENCODE_AUTH_FILE, 'utf8'));
        for (const name of ['opencode-go', 'opencode']) {
          const entry = auth && auth[name];
          if (entry && typeof entry === 'object') {
            if (typeof entry.key === 'string' && entry.key.length > 0) return entry.key;
            if (typeof entry.apiKey === 'string' && entry.apiKey.length > 0) return entry.apiKey;
          }
        }
      } catch (err) { /* 未配置 → 返回 null */ }
      return null;
    }

    async function fetchOpenCodeGoUsage() {
      const key = await resolveOpenCodeGoKey();
      if (!key) {
        return { error: { kind: 'no-key', message: t('host.opencodeGoIsNotConfigured') } };
      }
      try {
        const res = await fetch('https://opencode.ai/zen/go/v1/usage', {
          headers: { Authorization: 'Bearer ' + key },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return { error: { kind: 'http', message: t('host.requestFailedHTTP', { status: res.status }) } };
        const body = await res.json();
        const parsed = parseOpenCodeGoUsage(body, windowLabels);
        if (!parsed) return { error: { kind: 'parse', message: t('host.unexpectedResponseFormat') } };
        return { data: { provider: 'opencode-go', plan: parsed.plan, windows: parsed.windows } };
      } catch (err) {
        return { error: { kind: 'exception', message: String((err && err.message) || err) } };
      }
    }

    // v1.6 T6：智谱（zai）订阅额度查询
    // 凭据：优先 ZAI_CODING_CN_API_KEY，回退 ZAI_API_KEY
    // host：zai-coding-cn → https://open.bigmodel.cn；zai → https://api.z.ai
    // 认证：两者均 Authorization 裸 API Key，绝无 Bearer 前缀（加 Bearer 会 401）
    async function resolveZaiKey(providerId) {
      // 凭据与 host 匹配：zai（国际）→ 优先 ZAI_API_KEY；zai-coding-cn（国内）→ 优先 ZAI_CODING_CN_API_KEY。
      // 用户通常只配一个，回退另一名防止误配。
      const isCn = providerId === 'zai-coding-cn';
      const primary = isCn ? 'ZAI_CODING_CN_API_KEY' : 'ZAI_API_KEY';
      const fallback = isCn ? 'ZAI_API_KEY' : 'ZAI_CODING_CN_API_KEY';
      try {
        const cred = await ctx.credentials.resolve(primary);
        if (cred && typeof cred.value === 'string' && cred.value.length > 0) return cred.value;
      } catch (err) { /* 回退 */ }
      try {
        const cred = await ctx.credentials.resolve(fallback);
        if (cred && typeof cred.value === 'string' && cred.value.length > 0) return cred.value;
      } catch (err) { /* 未配置 */ }
      return null;
    }

    function zaiHostForProvider(providerId) {
      if (providerId === 'zai-coding-cn') return 'https://open.bigmodel.cn';
      return 'https://api.z.ai';
    }

    // 解析智谱 quota 响应见顶层 parseZaiQuota（已兼容 2026-07-30 起的 CREDIT_LIMIT 积分制）

    // 解析智谱充值余额响应（/api/biz/account/query-customer-account-report）
    // 被 CodexBar PR#3109、CodexMeter PR#2 等多个项目验证的非公开控制台 API
    function parseZaiBalance(body) {
      if (!body || typeof body !== 'object') return null;
      if (body.success === false || body.code !== 200) return null;
      const d = body.data;
      if (!d || typeof d !== 'object') return null;
      // availableBalance 优先（可用余额）；字段存在但格式损坏时仍回退到 balance。
      const available = parseFiniteNonNegativeAmount(d.availableBalance);
      const bal = available != null ? available : parseFiniteNonNegativeAmount(d.balance);
      if (bal == null) return null;
      return { balance: bal };
    }

    async function fetchZaiUsage(providerId) {
      // 按 provider 路由 host 与凭据：zai-coding-cn → open.bigmodel.cn（国内密钥）；
      // zai → api.z.ai（国际密钥）。两端均裸 API Key（无 Bearer 前缀）。
      // 自动检测用户类型：先尝试 Coding Plan 额度接口，失败后回退充值余额接口。
      const resolvedProvider = providerId === 'zai-coding-cn' ? 'zai-coding-cn' : 'zai';
      const key = await resolveZaiKey(resolvedProvider);
      if (!key) {
        return { error: { kind: 'no-key', message: t('host.zhipuAPIKeyIsNot') } };
      }
      const host = zaiHostForProvider(resolvedProvider);

      // ---- 第一步：尝试 Coding Plan 额度接口 ----
      try {
        const res = await fetch(host + '/api/monitor/usage/quota/limit', {
          headers: { Authorization: key }, // 裸 API Key，无 Bearer 前缀
          signal: AbortSignal.timeout(15000),
        });
        const body = await res.json().catch(() => null);
        // 智谱 API 常在 HTTP 200 内返回业务错误（{code:401, success:false, msg:...}），需先检查
        if (body && body.success === false) {
          const msg = body.msg || body.message || '';
          // "当前用户不存在 coding plan" → 非订阅用户，回退到充值余额接口
          if (/不存在.*coding\s*plan|no.*coding\s*plan/i.test(msg)) {
            return fetchZaiBalanceFallback(host, key, resolvedProvider);
          }
          if (body.code === 401 || /过期|不正确|unauthorized|expired/i.test(msg))
            return { error: { kind: 'auth', message: t('host.zhipuAPIAuthenticationFailedThe') } };
          return { error: { kind: 'http', message: t('host.requestFailed', { value: body.code || '', msg: msg }) } };
        }
        if (!res.ok) return { error: { kind: 'http', message: t('host.requestFailedHTTP', { status: res.status }) } };
        const parsed = parseZaiQuota(body, windowLabels);
        if (!parsed) return { error: { kind: 'parse', message: t('host.unexpectedResponseFormat') } };
        // 解析成功但零窗口 = 上游 schema 又漂移了（接口对订阅账号必返回 5 小时 + 周窗口，
        // 非订阅账号走上面的 success:false 分支）。此时按失败处理，让 mergeSubscriptionResult
        // 保留上一份好快照——否则空窗口会被当成"成功"覆盖旧数据，界面只剩套餐名、无窗口也无报错，
        // 正是 Issue #85 的原始症状（智谱接口已两次漂移：缺字段、TOKENS_LIMIT→CREDIT_LIMIT）。
        if (parsed.windows.length === 0)
          return { error: { kind: 'parse', message: t('host.zhipuQuotaWindowsUnrecognized') } };
        return { data: { provider: 'zai', plan: parsed.plan, windows: parsed.windows } };
      } catch (err) {
        return { error: { kind: 'exception', message: String((err && err.message) || err) } };
      }
    }

    // 智谱充值余额回退：Coding Plan 接口报"不存在 coding plan"时自动查询充值余额
    async function fetchZaiBalanceFallback(host, key, resolvedProvider) {
      try {
        // open.bigmodel.cn 与 www.bigmodel.cn 均可用；国际站 api.z.ai 无此接口
        const balanceHost = host === 'https://api.z.ai' ? 'https://open.bigmodel.cn' : host;
        const res = await fetch(balanceHost + '/api/biz/account/query-customer-account-report', {
          headers: { Authorization: 'Bearer ' + key }, // Bearer 认证（与裸 Key 均可）
          signal: AbortSignal.timeout(15000),
        });
        const body = await res.json().catch(() => null);
        if (body && body.success === false) {
          const msg = body.msg || body.message || '';
          if (body.code === 401 || body.code === 1000 || /过期|不正确|unauthorized|expired/i.test(msg))
            return { error: { kind: 'auth', message: t('host.zhipuAPIAuthenticationFailedThe') } };
          return { error: { kind: 'http', message: t('host.requestFailed', { value: body.code || '', msg: msg }) } };
        }
        if (!res.ok) return { error: { kind: 'http', message: t('host.requestFailedHTTP', { status: res.status }) } };
        const parsed = parseZaiBalance(body);
        if (!parsed) return { error: { kind: 'parse', message: t('host.unexpectedResponseFormat') } };
        // 返回充值余额：balance 字段携带金额，windows 为空（无额度窗口）
        return { data: { provider: 'zai', plan: t('ui.prepaidBalance'), windows: [], balance: parsed.balance } };
      } catch (err) {
        return { error: { kind: 'exception', message: String((err && err.message) || err) } };
      }
    }

    // v1.7 通用凭据读取：缺失/读取失败一律 null（错误信息不含密钥）
    async function resolveCredentialValue(name) {
      try {
        const cred = await ctx.credentials.resolve(name);
        if (cred && typeof cred.value === 'string' && cred.value.length > 0) return cred.value;
      } catch (err) { /* 未配置/读取失败 → null */ }
      return null;
    }

    // v1.7 FR-9：小米 MiMo Token Plan 订阅源（按地区路由 baseUrl + 凭据，地区互不串数据）
    // 凭据：XIAOMI_TOKEN_PLAN_CN/SGP/AMS_API_KEY 按地区优先，回退 XIAOMI_API_KEY；Bearer。
    // 主端点 GET /v1/tokenPlan/usage（月度 Credits 额度窗）；形态不符/失败回退 GET /v1/user/balance（token_balance/token_limit）。
    async function resolveXiaomiRegionKey(region) {
      const regionNames = {
        cn: 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
        sgp: 'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
        ams: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
      };
      const primary = regionNames[region];
      if (primary) {
        const cred = await resolveCredentialValue(primary);
        if (cred) return cred;
      }
      return resolveCredentialValue('XIAOMI_API_KEY');
    }

    async function fetchXiaomiTokenPlanUsage(region) {
      const key = await resolveXiaomiRegionKey(region);
      if (!key) {
        const regionNames = {
          cn: 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
          sgp: 'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
          ams: 'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
        };
        const credName = regionNames[region] || 'XIAOMI_TOKEN_PLAN_*_API_KEY';
        return { error: { kind: 'no-key', message: t('host.xiaomiMiMoTokenPlanCredentials', { credName: credName }) } };
      }
      const base = xiaomiRegionBaseUrl(region);
      const endpoints = [base + '/v1/tokenPlan/usage', base + '/v1/user/balance'];
      let lastStatus = null;
      for (let i = 0; i < endpoints.length; i++) {
        try {
          const res = await fetch(endpoints[i], {
            headers: { Authorization: 'Bearer ' + key },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) { lastStatus = res.status; continue; }
          const body = await res.json();
          const parsed = i === 0 ? parseXiaomiTokenPlanUsage(body, windowLabels) : parseXiaomiTokenPlanBalance(body, windowLabels);
          if (!parsed) continue; // 响应形态不符 → 尝试下一个端点
          return { data: { provider: 'xiaomi-' + region, plan: parsed.plan, windows: parsed.windows } };
        } catch (err) {
          if (i < endpoints.length - 1) continue;
          return { error: { kind: 'exception', message: String((err && err.message) || err) } };
        }
      }
      return { error: { kind: 'http', message: t('host.requestFailedHTTP.fetchXiaomiTokenPlanUsage', { value: lastStatus || '?' }) } };
    }

    // v1.7 FR-10：Together 本月真实账单（USD）。api.together.xyz 为主，api.together.ai 回退（A8 记录确认同源 API）。
    async function fetchTogetherBilling() {
      const key = await resolveCredentialValue('TOGETHER_API_KEY');
      if (!key) return { error: { kind: 'no-key', message: t('host.notConfiguredTOGETHERAPIKEY') } };
      const hosts = ['https://api.together.xyz', 'https://api.together.ai'];
      let lastStatus = null;
      for (let i = 0; i < hosts.length; i++) {
        try {
          const res = await fetch(hosts[i] + '/billing/usage', {
            headers: { Authorization: 'Bearer ' + key },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) {
            lastStatus = res.status;
            if (i < hosts.length - 1) continue;
            return { error: { kind: 'http', message: t('host.requestFailedHTTP', { status: res.status }) } };
          }
          const body = await res.json();
          const spend = parseTogetherUsage(body);
          if (spend == null) return { error: { kind: 'parse', message: t('host.unexpectedResponseFormat') } };
          return { data: { kind: 'billing', spend: Math.round(spend * 100) / 100, currency: 'USD', note: t('host.actualMonthlyBillFromThe') } };
        } catch (err) {
          if (i < hosts.length - 1) continue;
          return { error: { kind: 'exception', message: String((err && err.message) || err) } };
        }
      }
      return { error: { kind: 'http', message: t('host.requestFailedHTTP.fetchXiaomiTokenPlanUsage', { value: lastStatus || '?' }) } };
    }

    // v1.7 FR-11：Fireworks 本周期真实账单。先 GET /v1/accounts 解析 account_id，
    // 主端点 billing/summary（美元）；404 → 回退 billingUsage（token 用量，无金额时降级展示用量）。
    async function fetchFireworksBilling() {
      const key = await resolveCredentialValue('FIREWORKS_API_KEY');
      if (!key) return { error: { kind: 'no-key', message: t('host.notConfiguredFIREWORKSAPIKEY') } };
      try {
        const accRes = await fetch('https://api.fireworks.ai/v1/accounts', {
          headers: { Authorization: 'Bearer ' + key },
          signal: AbortSignal.timeout(15000),
        });
        if (!accRes.ok) return { error: { kind: 'http', message: t('host.requestFailedHTTP', { status: accRes.status }) } };
        const accountId = parseFireworksAccountId(await accRes.json());
        if (!accountId) return { error: { kind: 'parse', message: t('host.couldNotReadAccountAccount') } };
        const summaryRes = await fetch('https://api.fireworks.ai/v1/accounts/' + encodeURIComponent(accountId) + '/billing/summary?granularity=DAILY', {
          headers: { Authorization: 'Bearer ' + key },
          signal: AbortSignal.timeout(15000),
        });
        if (summaryRes.ok) {
          const spend = parseFireworksSummary(await summaryRes.json());
          if (spend == null) return { error: { kind: 'parse', message: t('host.unexpectedResponseFormat') } };
          return { data: { kind: 'billing', spend: Math.round(spend * 100) / 100, currency: 'USD', note: t('host.actualBillForThisPeriod') } };
        }
        if (summaryRes.status === 404) {
          const usageRes = await fetch('https://api.fireworks.ai/v1/accounts/' + encodeURIComponent(accountId) + '/billingUsage', {
            headers: { Authorization: 'Bearer ' + key },
            signal: AbortSignal.timeout(15000),
          });
          if (usageRes.ok) {
            const usage = parseFireworksUsage(await usageRes.json());
            if (usage != null) return { data: { kind: 'billing', usage: usage, usageUnit: 'tokens', currency: 'USD', note: t('host.actualUsageForThisPeriod') } };
            return { error: { kind: 'parse', message: t('host.unexpectedResponseFormat') } };
          }
          return { error: { kind: 'http', message: t('host.requestFailedHTTP', { status: usageRes.status }) } };
        }
        return { error: { kind: 'http', message: t('host.requestFailedHTTP', { status: summaryRes.status }) } };
      } catch (err) {
        return { error: { kind: 'exception', message: String((err && err.message) || err) } };
      }
    }

    // v1.7 FR-12：AWS Bedrock 本月真实账单（SigV4 本地签名，密钥不出本机）。
    // Cost Explorer GetCostAndUsage（SERVICE=Amazon Bedrock，MONTHLY）→ 本月花费；
    // 预算% 可选：STS GetCallerIdentity → Budgets GetBudgets，失败静默（null）。
    function awsDateKey(d) {
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }

    async function resolveAwsCredentials() {
      const accessKeyId = await resolveCredentialValue('AWS_ACCESS_KEY_ID');
      const secretAccessKey = await resolveCredentialValue('AWS_SECRET_ACCESS_KEY');
      if (!accessKeyId || !secretAccessKey) return null;
      const sessionToken = await resolveCredentialValue('AWS_SESSION_TOKEN');
      return { accessKeyId: accessKeyId, secretAccessKey: secretAccessKey, sessionToken: sessionToken || null };
    }

    // AWS 管理面 JSON POST（SigV4）：返回 { ok, status, json }；JSON 解析失败按 null 处理（交由解析层判定）
    async function awsJsonPost(host, service, region, target, payload, aws) {
      const body = JSON.stringify(payload);
      const headers = awsSigV4Headers({
        method: 'POST', host: host, path: '/', query: '', body: body, service: service, region: region,
        accessKeyId: aws.accessKeyId, secretAccessKey: aws.secretAccessKey, sessionToken: aws.sessionToken,
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': target },
      });
      const res = await fetch('https://' + host + '/', {
        method: 'POST', headers: headers, body: body, signal: AbortSignal.timeout(15000),
      });
      let json = null;
      try { json = await res.json(); } catch (err) { /* 交由解析层判定结构异常 */ }
      return { ok: res.ok, status: res.status, json: json };
    }

    async function fetchBedrockBilling() {
      const aws = await resolveAwsCredentials();
      if (!aws) {
        return { error: { kind: 'no-key', message: t('host.notConfiguredAWSCredentialsAWS') } };
      }
      try {
        const now = new Date();
        const nextDay = new Date(now.getTime() + 86400 * 1000);
        const ce = await awsJsonPost('ce.us-east-1.amazonaws.com', 'ce', 'us-east-1', 'AWSInsightsIndexService.GetCostAndUsage', {
          TimePeriod: { Start: awsDateKey(now), End: awsDateKey(nextDay) },
          Granularity: 'MONTHLY',
          Filter: { Dimensions: { Key: 'SERVICE', Values: ['Amazon Bedrock'] } },
        }, aws);
        if (!ce.ok) return { error: { kind: 'http', message: t('host.requestFailedHTTPTheToken', { status: ce.status }) } };
        const spend = parseBedrockCost(ce.json);
        if (spend == null) return { error: { kind: 'parse', message: t('host.unexpectedResponseFormat') } };
        let budgetPercent = null;
        try { budgetPercent = await fetchBedrockBudget(aws); } catch (err) { budgetPercent = null; } // 预算失败静默
        return { data: { kind: 'billing', spend: Math.round(spend * 100) / 100, budgetPercent: budgetPercent, currency: 'USD', note: t('host.actualMonthlyBillFromAWS') } };
      } catch (err) {
        return { error: { kind: 'exception', message: String((err && err.message) || err) } };
      }
    }

    async function fetchBedrockBudget(aws) {
      const query = 'Action=GetCallerIdentity&Version=2011-06-15';
      const headers = awsSigV4Headers({
        method: 'GET', host: 'sts.amazonaws.com', path: '/', query: query, body: '', service: 'sts', region: 'us-east-1',
        accessKeyId: aws.accessKeyId, secretAccessKey: aws.secretAccessKey, sessionToken: aws.sessionToken,
        headers: {},
      });
      const stsRes = await fetch('https://sts.amazonaws.com/?' + query, { headers: headers, signal: AbortSignal.timeout(15000) });
      if (!stsRes.ok) return null;
      const stsJson = await stsRes.json().catch(function () { return null; });
      const result = stsJson && stsJson.GetCallerIdentityResponse && stsJson.GetCallerIdentityResponse.GetCallerIdentityResult;
      const accountId = result && typeof result.Account === 'string' ? result.Account : null;
      if (!accountId) return null;
      const budgets = await awsJsonPost('budgets.amazonaws.com', 'budgets', 'us-east-1', 'AWSBudgetServiceGateway.GetBudgets', { AccountId: accountId, MaxResults: 10 }, aws);
      if (!budgets.ok || !budgets.json) return null;
      return parseBedrockBudget(budgets.json);
    }

    // v1.7 FR-13：Cloudflare Billable Usage（Alpha）。复用 CLOUDFLARE_API_KEY（需 Billing 读权限）+ CLOUDFLARE_ACCOUNT_ID。
    // 免费额度仅当接口显式返回 limit/allowance 字段时展示（拿不到只显示真实用量，绝不编造）；失败静默降级。
    async function fetchCloudflareBilling() {
      const key = await resolveCredentialValue('CLOUDFLARE_API_KEY');
      if (!key) return { error: { kind: 'no-key', message: t('host.notConfiguredCLOUDFLAREAPIKEY') } };
      const accountId = await resolveCredentialValue('CLOUDFLARE_ACCOUNT_ID');
      if (!accountId) return { error: { kind: 'no-key', message: t('host.notConfiguredCLOUDFLAREACCOUNTID') } };
      try {
        const res = await fetch('https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) + '/billing/usage/paygo', {
          headers: { Authorization: 'Bearer ' + key },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return { error: { kind: 'http', message: t('host.requestFailedHTTPTheToken.fetchCloudflareBilling', { status: res.status }) } };
        const parsed = parseCloudflareBilling(await res.json());
        if (!parsed) return { error: { kind: 'parse', message: t('host.unexpectedResponseFormat') } };
        return { data: Object.assign({ kind: 'billing', currency: 'USD', note: t('host.actualMonthlyUsageFromThe') }, parsed) };
      } catch (err) {
        return { error: { kind: 'exception', message: String((err && err.message) || err) } };
      }
    }

    const SUBSCRIPTION_SOURCES = {
      codex: { fetch: fetchCodexUsage },
      'opencode-go': { fetch: fetchOpenCodeGoUsage },
      zai: { fetch: fetchZaiUsage },
      // v1.7 FR-9：小米 Token Plan 三集群各为独立源（地区隔离，快照互不串扰）
      'xiaomi-cn': { fetch: function () { return fetchXiaomiTokenPlanUsage('cn'); } },
      'xiaomi-sgp': { fetch: function () { return fetchXiaomiTokenPlanUsage('sgp'); } },
      'xiaomi-ams': { fetch: function () { return fetchXiaomiTokenPlanUsage('ams'); } },
    };

    // 触发一次刷新（并发去重 + seq 防旧覆盖）；返回本次刷新 Promise
    // providerId：需要按 provider 路由 host/凭据的源（如 zai 系）使用；其余源忽略
    function kickSubscriptionRefresh(sourceKey, providerId) {
      const src = SUBSCRIPTION_SOURCES[sourceKey];
      if (!src) return Promise.resolve();
      if (subscriptionInFlight[sourceKey]) return subscriptionInFlight[sourceKey];
      const seq = (subscriptionSeq[sourceKey] || 0) + 1;
      subscriptionSeq[sourceKey] = seq;
      subscriptionInFlight[sourceKey] = src.fetch(providerId).then(function (result) {
        if (subscriptionSeq[sourceKey] === seq) {
          subscriptions[sourceKey] = mergeSubscriptionResult(subscriptions[sourceKey], result, t);
          // 失败退避记录：失败记时刻（期内不重试），成功清零
          if (result && result.error) subscriptionLastFailAt[sourceKey] = Date.now();
          else subscriptionLastFailAt[sourceKey] = 0;
        }
      }).catch(function (err) {
        if (subscriptionSeq[sourceKey] === seq) {
          subscriptions[sourceKey] = mergeSubscriptionResult(subscriptions[sourceKey], {
            error: { kind: 'exception', message: String((err && err.message) || err) },
          });
          subscriptionLastFailAt[sourceKey] = Date.now();
        }
      }).finally(function () {
        subscriptionInFlight[sourceKey] = null;
      });
      return subscriptionInFlight[sourceKey];
    }

    // 60s 周期刷新：仅刷新客户端请求过的源（余额制模式下不打扰未公开的订阅接口）；失败退避期内跳过
    function refreshActiveSubscriptions() {
      const nowMs = Date.now();
      for (const sourceKey in SUBSCRIPTION_SOURCES) {
        if (!subscriptionRequested[sourceKey]) continue;
        const lastFailAt = subscriptionLastFailAt[sourceKey] || 0;
        if (nowMs - lastFailAt < SUBSCRIPTION_RETRY_BACKOFF_MS) continue;
        kickSubscriptionRefresh(sourceKey, subscriptionSourceProvider[sourceKey]);
      }
    }

    // ---------- v1.7 FR-10~13：账单快照（云账单型；与订阅/余额快照完全隔离，同一套策略） ----------
    const BILLING_REFRESH_MS = 60000;
    const BILLING_RETRY_BACKOFF_MS = 60000;
    let billingSnapshots = Object.create(null); // { [key]: { data, fetchedAt, error } }
    const billingSeq = Object.create(null);
    const billingInFlight = Object.create(null);
    const billingRequested = Object.create(null);
    const billingLastFailAt = Object.create(null);

    function mergeBillingResult(prev, result) {
      if (!result || result.error) {
        return {
          data: prev && prev.data ? prev.data : null,
          fetchedAt: prev && prev.fetchedAt ? prev.fetchedAt : null,
          error: result ? result.error : { kind: 'exception', message: t('host.unexpectedBillingRequestFailure') },
        };
      }
      return { data: result.data || null, fetchedAt: Date.now(), error: null };
    }

    function kickBillingRefresh(key) {
      const src = BILLING_SOURCES[key];
      if (!src) return Promise.resolve();
      if (billingInFlight[key]) return billingInFlight[key];
      const seq = (billingSeq[key] || 0) + 1;
      billingSeq[key] = seq;
      billingInFlight[key] = src.fetch().then(function (result) {
        if (billingSeq[key] === seq) {
          // FR-14：适配器原始输出统一经 normalizeAccountStatus 收敛到客户端契约
          if (result && result.data) result.data = normalizeAccountStatus(result.data.kind, result.data);
          billingSnapshots[key] = mergeBillingResult(billingSnapshots[key], result);
          billingLastFailAt[key] = result && result.error ? Date.now() : 0;
        }
      }).catch(function (err) {
        if (billingSeq[key] === seq) {
          billingSnapshots[key] = mergeBillingResult(billingSnapshots[key], {
            error: { kind: 'exception', message: String((err && err.message) || err) },
          });
          billingLastFailAt[key] = Date.now();
        }
      }).finally(function () {
        billingInFlight[key] = null;
      });
      return billingInFlight[key];
    }

    function refreshActiveBilling() {
      const nowMs = Date.now();
      for (const key in BILLING_SOURCES) {
        if (!billingRequested[key]) continue;
        const lastFailAt = billingLastFailAt[key] || 0;
        if (nowMs - lastFailAt < BILLING_RETRY_BACKOFF_MS) continue;
        kickBillingRefresh(key);
      }
    }

    // RPC：当前订阅额度快照 + 模式判定（非订阅模式直接返回，不发任何订阅请求）
    async function getSubscriptionSnapshotRpc(selection, force) {
      const sel = selection || modelSelection();
      const bm = selectionIsResolved(sel)
        ? detectBillingMode(sel.provider)
        : { mode: 'unknown', provider: '', reason: sel.reason || 'selection-unavailable' };
      const out = { mode: bm.mode, provider: sel.provider, reason: bm.reason, source: null, plan: null, planType: null, expiryAt: null, windows: [], balance: null, fetchedAt: null, error: null };
      if (bm.mode !== 'subscription') return out;
      const sourceKey = subscriptionSourceFor(sel.provider);
      if (!sourceKey) return out;
      out.source = sourceKey;
      subscriptionRequested[sourceKey] = true; // 该源进入 60s 周期刷新
      subscriptionSourceProvider[sourceKey] = sel.provider; // 记住 provider（zai 系路由需要）
      const snap = subscriptions[sourceKey] || { data: null, fetchedAt: null, error: null };
      const nowMs = Date.now();
      const lastFailAt = subscriptionLastFailAt[sourceKey] || 0;
      // 失败退避：快照过期（>60s 无成功）且距上次失败 ≥ 退避期（60s）才重试——
      // 减少重复订阅请求，也避免“刷新失败”提示随每次轮询反复闪烁（失败期内直接读缓存快照）
      const stale = (!snap.fetchedAt || (nowMs - snap.fetchedAt) > SUBSCRIPTION_REFRESH_MS)
        && (nowMs - lastFailAt) >= SUBSCRIPTION_RETRY_BACKOFF_MS;
      // force（客户端打开/刷新网页后的首启窗口）绕过新鲜度与失败退避，当场重查，
      // 让用户手动刷新页面时立刻拿到最新额度/余额，而不是干等下一轮自动刷新
      if (force || stale) {
        const inflight = kickSubscriptionRefresh(sourceKey, subscriptionSourceProvider[sourceKey]);
        // 从未成功过（无旧数据）或强制刷新 → 等本次结果返回最新数据（含错误）；
        // 已有旧数据的普通刷新 → 后台刷新，本次直接返回快照（不阻塞轮询）
        if (!snap.data || force) await inflight;
      }
      const cur = subscriptions[sourceKey] || { data: null, fetchedAt: null, error: null };
      if (cur.data) {
        out.plan = cur.data.plan;
        out.windows = cur.data.windows;
        out.planType = cur.data.planType;
        out.expiryAt = cur.data.expiryAt;
        out.balance = typeof cur.data.balance === 'number' ? cur.data.balance : null;
      }
      out.fetchedAt = cur.fetchedAt;
      out.error = cur.error;
      return out;
    }

    // ---------- v1.7 FR-14：账单源与 RPC（三态互斥的"账单型"） ----------
    const BILLING_SOURCES = {
      together: { fetch: fetchTogetherBilling },
      fireworks: { fetch: fetchFireworksBilling },
      'amazon-bedrock': { fetch: fetchBedrockBilling },
      cloudflare: { fetch: fetchCloudflareBilling }, // cloudflare-ai-gateway / cloudflare-workers-ai 共用
    };

    async function getBillingSnapshotRpc(selection, force) {
      const sel = selection || modelSelection();
      const bm = selectionIsResolved(sel)
        ? detectBillingMode(sel.provider)
        : { mode: 'unknown', provider: '', reason: sel.reason || 'selection-unavailable' };
      const out = { mode: bm.mode, provider: sel.provider, reason: bm.reason, type: null, data: null, fetchedAt: null, error: null, now: Date.now() };
      if (bm.mode !== 'billing') return out;
      const key = billingSourceFor(sel.provider);
      if (!key) return out;
      out.type = key;
      billingRequested[key] = true; // 该源进入 60s 周期刷新
      const snap = billingSnapshots[key] || { data: null, fetchedAt: null, error: null };
      const nowMs = Date.now();
      const lastFailAt = billingLastFailAt[key] || 0;
      const stale = (!snap.fetchedAt || (nowMs - snap.fetchedAt) > BILLING_REFRESH_MS)
        && (nowMs - lastFailAt) >= BILLING_RETRY_BACKOFF_MS;
      // force（客户端打开/刷新网页后的首启窗口）绕过新鲜度与失败退避，当场重查最新账单
      if (force || stale) {
        const inflight = kickBillingRefresh(key);
        if (!snap.data || force) await inflight;
      }
      const cur = billingSnapshots[key] || { data: null, fetchedAt: null, error: null };
      out.data = cur.data;
      out.fetchedAt = cur.fetchedAt;
      out.error = cur.error;
      return out;
    }

    // ---------- 北京时间峰谷判定 ----------
    // DeepSeek 自 2026-08-23 00:00（北京时间）起，周六、周日全天按空闲价计费。
    // 以生效时刻为界，保留此前周末请求原有的峰谷结算规则，供未冻结的旧记录回算使用。
    const WEEKEND_OFFPEAK_EFFECTIVE_AT = Date.UTC(2026, 7, 22, 16, 0, 0);
    function beijingMinutes(nowMs) {
      const d = new Date(nowMs + 8 * 3600 * 1000);
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    }
    function currentPeriod(nowMs) {
      const d = new Date(nowMs + 8 * 3600 * 1000);
      const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      if (nowMs >= WEEKEND_OFFPEAK_EFFECTIVE_AT && weekend) return 'offpeak';
      const m = beijingMinutes(nowMs);
      return (m >= 9 * 60 && m < 12 * 60) || (m >= 14 * 60 && m < 18 * 60) ? 'peak' : 'offpeak';
    }
    function nextSwitchAt(nowMs) {
      const d = new Date(nowMs + 8 * 3600 * 1000);
      const bounds = [9, 12, 14, 18];
      const period = currentPeriod(nowMs);
      // 周末没有峰谷切换；从当前北京日期起查找下一个实际变价点（最长覆盖至下一周一）。
      for (let day = 0; day <= 8; day++) {
        for (let i = 0; i < bounds.length; i++) {
          const at = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + day, bounds[i], 0, 0) - 8 * 3600 * 1000).getTime();
          if (at > nowMs && currentPeriod(at) !== period) return at;
        }
      }
      return null;
    }
    function nextPeriodLabel(nowMs) {
      const at = nextSwitchAt(nowMs);
      if (at == null) return null;
      const d = new Date(at + 8 * 3600 * 1000);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      return { at: at, atLabel: hh + ':' + mm, nextIsPeak: currentPeriod(at) === 'peak' };
    }
    function beijingDayKey(ts) {
      const d = new Date(ts + 8 * 3600 * 1000);
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }

    // ---------- 当前模型识别 ----------
    function modelSelection() {
      let provider = '';
      let model = '';
      let fallback = true;
      let reason = 'selection-unavailable';
      let svc = null;
      try { svc = ctx.get('agentDefaultModel'); } catch (err) { reason = 'selection-service-error'; }
      if (svc && typeof svc.currentSelection === 'function') {
        try {
          const s = svc.currentSelection();
          const nextProvider = s && typeof s.provider === 'string' ? s.provider.trim() : '';
          const nextModel = s && typeof s.model === 'string' ? s.model.trim() : '';
          if (nextProvider.length > 0 && nextModel.length > 0) {
            provider = nextProvider;
            model = nextModel;
            fallback = false;
            reason = 'selected';
          } else {
            reason = 'selection-incomplete';
          }
        } catch (err) {
          reason = 'selection-read-error';
        }
      } else {
        reason = 'selection-service-unavailable';
      }
      return { provider: provider, model: model, fallback: fallback, reason: reason };
    }

    function selectionIsResolved(selection) {
      return !!(selection && selection.fallback !== true
        && typeof selection.provider === 'string' && selection.provider.trim().length > 0
        && typeof selection.model === 'string' && selection.model.trim().length > 0);
    }

    // Web client must supply the model selection owned by its currently active
    // session.  `agentDefaultModel` is process-wide and only a default for new
    // Agents; it must never be used by a display/accounting RPC as a substitute
    // for the active session.  Reject malformed or missing HTTP input as an
    // unresolved selection rather than letting a default reach any model or
    // credential operation.
    function selectionFromArgs(args) {
      const raw = args && typeof args === 'object' ? args.selection : null;
      const provider = raw && typeof raw.provider === 'string' ? raw.provider.trim() : '';
      const model = raw && typeof raw.model === 'string' ? raw.model.trim() : '';
      if (provider.length > 0 && model.length > 0) {
        return { provider: provider, model: model, fallback: false, reason: 'selected' };
      }
      return { provider: '', model: '', fallback: true, reason: raw ? 'selection-incomplete' : 'selection-required' };
    }

    // ---------- 服务商显示名静态映射（M5 起为 providerDisplayFromCache 的回退层） ----------
    const PROVIDER_DISPLAY = {
      deepseek: 'DeepSeek',
      'deepseek-official': 'DeepSeek',
      openrouter: 'OpenRouter',
      openai: 'OpenAI',
      moonshot: 'Moonshot',   // Kimi
      zhipu: 'Zhipu',         // GLM
      glm: 'GLM',
      kimi: 'Kimi',
      qwen: 'Qwen',
      anthropic: 'Anthropic',
      google: 'Google',
      gemini: 'Gemini',
      mistral: 'Mistral',
      xai: 'xAI',
      groq: 'Groq',
      // v1.7：新增服务商显示名（模型目录缺失时的兜底；账单/订阅行另有品牌名映射）
      xiaomi: t('ui.xiaomiMiMo'),
      'xiaomi-token-plan-cn': t('ui.xiaomiMiMo'),
      'xiaomi-token-plan-sgp': t('ui.xiaomiMiMo'),
      'xiaomi-token-plan-ams': t('ui.xiaomiMiMo'),
      together: 'Together',
      fireworks: 'Fireworks',
      'amazon-bedrock': 'AWS Bedrock',
      'cloudflare-ai-gateway': 'Cloudflare',
      'cloudflare-workers-ai': 'Cloudflare',
    };

    // ---------- DSH 模型/服务商目录名与能力缓存（M5：与模型切换器完全一致） ----------
    // llm.listModels(provider) → DSH LLM 目录 { id, name, inputModalities? }；
    // llm.resolveModelInfo(provider, model) → 当前模型的完整目录信息。
    // DSH 的模型目录会随适配器/客户端更新而变化，不能把“启动时尝试过一次”当成永久状态：
    // 成功后定期刷新，失败/目录外模型短暂退避后重试，并在 adapters/settings 事件中失效。
    // 能力只接受 DSH 明确给出的 inputModalities；null 表示未知，客户端会保持占位而不是误标。
    const MODEL_CATALOG_REFRESH_MS = 5 * 60 * 1000;
    const MODEL_DIRECTORY_RETRY_MS = 30 * 1000;
    let modelNameCache = Object.create(null);    // { provider: { modelId: name } }
    let providerNameCache = Object.create(null); // { provider: name }
    let modelCatalogRefreshed = Object.create(null); // { provider: true } 最近一次目录请求已完成
    let modelCatalogRetryAt = Object.create(null); // { provider: ms } 失败后的下一次重试时刻
    let modelCatalogMissingRetryAt = Object.create(null); // { provider: ms } 目录外模型的下一次探测时刻
    let modelCatalogIds = Object.create(null); // { provider: { modelId: true } } 最近一次完整目录的 id 集合
    let modelCatalogPending = Object.create(null); // { provider: Promise } 同一 provider 的目录请求并发去重
    let modelImageInputCache = Object.create(null); // { provider: { modelId: boolean } }；仅明确声明 image 才写入
    let modelCapabilityRefreshed = Object.create(null); // { provider + '\u0000' + model: true } 能力已明确或目录已明确
    let modelCapabilityRetryAt = Object.create(null); // { provider + '\u0000' + model: ms } 能力缺失/失败后的重试时刻
    let modelCapabilityPending = Object.create(null); // { provider + '\u0000' + model: Promise } 能力请求并发去重
    let modelCatalogGeneration = 0; // 适配器更新后丢弃旧请求结果，防止旧目录回写

    function llmService() {
      try {
        return ctx.get && typeof ctx.get === 'function' ? ctx.get('llm') : null;
      } catch (err) {
        return null;
      }
    }

    function modelImageInputCapability(info) {
      if (!info || !Array.isArray(info.inputModalities)) return null;
      return info.inputModalities.indexOf('image') !== -1;
    }

    function modelCatalogNeedsRefresh(provider, model, nowMs, force) {
      if (!provider) return false;
      if (force || !modelCatalogRefreshed[provider]) return true;
      const ids = modelCatalogIds[provider];
      if (ids && model && !Object.hasOwn(ids, model)) {
        return nowMs >= (modelCatalogMissingRetryAt[provider] || 0);
      }
      return nowMs >= (modelCatalogRetryAt[provider] || 0);
    }

    async function refreshModelCatalog(provider, force, model) {
      const llm = llmService();
      if (!llm || typeof llm.listModels !== 'function' || !provider) return;
      const now = Date.now();
      if (!force && !modelCatalogNeedsRefresh(provider, model || '', now, false)) return;
      if (modelCatalogPending[provider]) return modelCatalogPending[provider];
      const generation = modelCatalogGeneration;
      const task = (async function () {
        let catalogSucceeded = false;
        try {
          const models = await llm.listModels(provider);
          const map = Object.create(null);
          const imageInputMap = Object.create(null);
          const ids = Object.create(null);
          if (Array.isArray(models)) {
            for (let i = 0; i < models.length; i++) {
              const m = models[i];
              if (m && typeof m.id === 'string' && m.id.length > 0) {
                ids[m.id] = true;
                if (typeof m.name === 'string' && m.name.length > 0) map[m.id] = m.name;
                const capability = modelImageInputCapability(m);
                if (capability !== null) imageInputMap[m.id] = capability;
              }
            }
          }
          catalogSucceeded = true;
          if (generation === modelCatalogGeneration) {
            modelNameCache[provider] = map;
            modelImageInputCache[provider] = imageInputMap;
            modelCatalogIds[provider] = ids;
            modelCatalogRefreshed[provider] = true;
            modelCatalogRetryAt[provider] = Date.now() + MODEL_CATALOG_REFRESH_MS;
            modelCatalogMissingRetryAt[provider] = Date.now() + MODEL_DIRECTORY_RETRY_MS;
          }
        } catch (err) {
          // 目录查询失败保留旧缓存，但不要永久锁死；下一次按退避时间再试。
          if (generation === modelCatalogGeneration) {
            modelCatalogRefreshed[provider] = true;
            modelCatalogRetryAt[provider] = Date.now() + MODEL_DIRECTORY_RETRY_MS;
            modelCatalogMissingRetryAt[provider] = Date.now() + MODEL_DIRECTORY_RETRY_MS;
          }
        }
        try {
          const provs = typeof llm.listProviders === 'function' ? await llm.listProviders() : null;
          if (generation === modelCatalogGeneration && Array.isArray(provs)) {
            for (let i = 0; i < provs.length; i++) {
              const p = provs[i];
              if (p && typeof p.id === 'string' && p.id.length > 0 && typeof p.name === 'string' && p.name.length > 0) providerNameCache[p.id] = p.name;
            }
          }
        } catch (err) { /* 服务商目录失败不影响模型目录与信息栏其余内容 */ }
        // 仅用于让调试器/静态审计能明确看到“空数组也是成功响应”，不改变回退策略。
        return catalogSucceeded;
      })();
      modelCatalogPending[provider] = task;
      task.then(function () {
        if (modelCatalogPending[provider] === task) modelCatalogPending[provider] = null;
      }, function () {
        if (modelCatalogPending[provider] === task) modelCatalogPending[provider] = null;
      });
      return task;
    }

    // listModels 只提供目录概要时，按当前选中模型读取完整能力；失败或未知时不显示标识，
    // 避免通过模型名称猜测造成错误标注。未拿到能力时保留“未知”并退避重试，适配新模型无需发版。
    async function refreshModelCapability(provider, model, force) {
      const cacheKey = provider + '\u0000' + model;
      if (!provider || !model) return;
      if (!force && modelCapabilityRefreshed[cacheKey]) return;
      if (!force && Date.now() < (modelCapabilityRetryAt[cacheKey] || 0)) return;
      const llm = llmService();
      if (!llm || typeof llm.resolveModelInfo !== 'function') return;
      if (modelCapabilityPending[cacheKey]) return modelCapabilityPending[cacheKey];
      const generation = modelCatalogGeneration;
      const task = (async function () {
        let info = null;
        try {
          info = await llm.resolveModelInfo(provider, model);
        } catch (err) {
          if (generation === modelCatalogGeneration) modelCapabilityRetryAt[cacheKey] = Date.now() + MODEL_DIRECTORY_RETRY_MS;
          return;
        }
        if (generation !== modelCatalogGeneration) return;
        if (info && typeof info.name === 'string' && info.name.length > 0) {
          const providerNames = Object.hasOwn(modelNameCache, provider) ? modelNameCache[provider] : Object.create(null);
          providerNames[model] = info.name;
          modelNameCache[provider] = providerNames;
        }
        const capability = modelImageInputCapability(info);
        const providerMap = Object.hasOwn(modelImageInputCache, provider) ? modelImageInputCache[provider] : Object.create(null);
        if (capability !== null) {
          providerMap[model] = capability;
          modelImageInputCache[provider] = providerMap;
          modelCapabilityRefreshed[cacheKey] = true;
          modelCapabilityRetryAt[cacheKey] = 0;
        } else if (Object.hasOwn(providerMap, model)) {
          // listModels 已经明确给出能力，resolveModelInfo 的概要响应不能把它覆盖成 false。
          modelCapabilityRefreshed[cacheKey] = true;
          modelCapabilityRetryAt[cacheKey] = 0;
        } else {
          // 新模型可能刚出现，或新版 DSH 尚未提供完整字段；定时重试而不是永久缓存 unknown。
          modelCapabilityRetryAt[cacheKey] = Date.now() + MODEL_DIRECTORY_RETRY_MS;
        }
      })();
      modelCapabilityPending[cacheKey] = task;
      task.then(function () {
        if (modelCapabilityPending[cacheKey] === task) modelCapabilityPending[cacheKey] = null;
      }, function () {
        if (modelCapabilityPending[cacheKey] === task) modelCapabilityPending[cacheKey] = null;
      });
      return task;
    }

    // 刷新当前激活 provider 的目录名缓存（启动 / 适配器或设置变化 / 切模型后按需调用）
    function refreshActiveModelCatalog(force) {
      const sel = modelSelection();
      return Promise.resolve(refreshModelCatalog(sel.provider, force === true, sel.model)).then(function () {
        return refreshModelCapability(sel.provider, sel.model, force === true);
      });
    }

    // ---------- 定价计算 ----------
    // 价目键解析：优先"服务商:模型"作用域键（解决同名模型跨计费域价格/币种不同的问题，
    // 如 Kimi 同一型号在 api.moonshot.cn=¥ 与 api.moonshot.ai=$ 两套价）；
    // 无作用域键时回退裸模型键。远程目录可下发任意一种形态。
    // DeepSeek 官方计划：北京时间 2026-09-14 12:00 起，V4 Pro 请求路由到 V4.1 Flash 并按 Flash 价格计费。
    // 将生效时刻传入价格解析，保证新请求切换、历史请求回算与已冻结金额彼此一致。
    const DEEPSEEK_V4_PRO_FLASH_EFFECTIVE_AT = Date.parse('2026-09-14T12:00:00+08:00');
    function pricingEntryFor(provider, model, atMs) {
      const scopedKey = provider + ':' + model;
      const scoped = Object.hasOwn(PRICING, scopedKey) ? PRICING[scopedKey] : null;
      const entry = scoped && typeof scoped === 'object'
        ? scoped
        : (Object.hasOwn(PRICING, model) ? PRICING[model] : null);
      if (model === 'deepseek-v4-pro' && Number.isFinite(atMs) && atMs >= DEEPSEEK_V4_PRO_FLASH_EFFECTIVE_AT) {
        return Object.hasOwn(PRICING, 'deepseek-flash') ? PRICING['deepseek-flash'] : null;
      }
      return entry;
    }

    function computePricing(nowMs, selection) {
      const sel = selection || modelSelection();
      const entry = pricingEntryFor(sel.provider, sel.model, nowMs);
      const period = entry && entry.mode === 'peak-valley' ? currentPeriod(nowMs) : 'flat';
      let prices = null;
      if (entry) {
        prices = entry.mode === 'peak-valley' ? entry[period] : entry.price;
      }
      const switchInfo = entry && entry.mode === 'peak-valley' ? nextPeriodLabel(nowMs) : null;
      return {
        model: sel.model,
        provider: sel.provider,
        providerDisplay: providerDisplayFromCache(sel.provider, providerNameCache, PROVIDER_DISPLAY, t),
        modelDisplay: modelDisplayFromCache(sel.model, sel.provider, modelNameCache, t),
        acceptsImageInput: modelImageInputCache[sel.provider] && Object.hasOwn(modelImageInputCache[sel.provider], sel.model)
          ? modelImageInputCache[sel.provider][sel.model] : null,
        fallback: sel.fallback || !entry,
        mode: entry ? entry.mode : 'unknown',
        period: period,
        prices: prices,
        nextSwitch: switchInfo,
        refreshedAt: nowMs,
      };
    }

    // ---------- 当前激活服务商余额（含预警） ----------
    // 模型目录 provider id → 余额账户 key（v1.6 改用 accountForProvider 表）：
// 已知映射返回对应账户；未知返回 null，不借用其他服务商的账户。
    // 目的：余额/币种跟随"活跃模型的服务商"，避免 OpenAI 模型激活时仍显示 DeepSeek ¥ 余额与 ¥0 花费。
    function balanceProviderKey(pid) {
      if (!pid) return null;
      if (billingSourceFor(pid)) return null;
      if (subscriptionSourceFor(pid)) return null;
      const acct = accountForProvider(pid);
      if (acct !== null) return acct;
      return null;
    }

    function activeBalanceSummary(nowMs, selection) {
      // 只跟随已确认的活跃模型服务商。展示 RPC 传入 selection 时，缺失选择
      // 必须保持 pending，绝不借用默认 provider/模型或另一个请求里的 provider。
      const selected = selection || modelSelection();
      const activeProvider = selectionIsResolved(selected) ? selected.provider : '';
      if (!activeProvider) {
        return { provider: null, displayName: t('ui.modelSelectionPending'), selectionPending: true, unmapped: false, data: null, fetchedAt: null, error: null, alert: null, now: nowMs };
      }
      const pid = balanceProviderKey(activeProvider);
      // v1.6 T7：未知账户返回 unmapped=true，客户端渲染"未适配"引导
      if (pid === null) {
        return { provider: activeProvider, displayName: t('ui.notSupported'), selectionPending: false, unmapped: true, data: null, fetchedAt: null, error: null, alert: null, now: nowMs };
      }
      const prov = Object.hasOwn(PROVIDERS, pid) ? PROVIDERS[pid] : null;
      if (!prov) {
        return { provider: activeProvider, displayName: t('ui.notSupported'), selectionPending: false, unmapped: true, data: null, fetchedAt: null, error: null, alert: null, now: nowMs };
      }
      const snap = balances[pid] || { data: null, fetchedAt: null, error: null };
      let alert = null;
      if (snap.data && snap.data.total != null) {
        const threshold = config.alertThreshold;
        const total = snap.data.total;
        alert = {
          active: total < threshold,
          threshold: threshold,
          currency: snap.data.currency || 'CNY',
          total: total,
        };
      }
      return {
        provider: prov.id,
        displayName: prov.displayName,
        estimate: !!prov.estimate,
        currency: snap.data ? snap.data.currency : (prov.currency || (prov.id === 'deepseek' ? 'CNY' : 'USD')),
        data: snap.data,
        fetchedAt: snap.fetchedAt,
        error: snap.error,
        alert: alert,
        now: nowMs,
      };
    }

    // ---------- 用量记账（llm/stream waterfall；落盘持久化，重启不丢失） ----------
    const loadedUsageRecords = loadUsageRecords();
    let usageRecords = loadedUsageRecords.records; // { id, ts, model, provider, sessionId, input, cacheRead, cacheWrite, output, currency, cost, pricingStatus, pricingVersion, status }
    let saveDisposer = null;
    let dirty = loadedUsageRecords.migratedLegacyRecord;
    let ledgerError = null;
    let activeUsageStreams = 0;

    // A previous clear may have been interrupted. The marker made the in-memory
    // view empty on startup; finish the exact cleanup now and keep the marker if
    // the filesystem is still temporarily unavailable.
    if (loadedUsageRecords.clearPending) {
      try {
        clearLedgerArtifacts();
      } catch (err) {
        ledgerError = { kind: 'clear-failed', message: t('host.couldNotClearSpendRecords', { value: String((err && err.message) || err) }), at: Date.now() };
        console.warn('[dsh-bottom-info-bar] ' + ledgerError.message);
      }
    }

    // ---------- v1.9.0 性能地基：日桶 × 账户 × 币种聚合 + 会话索引（docs/PERF-AUDIT-v1.9.md §③B/C） ----------
    // 结构不变量：
    //  ① 内存桶 = 完整日聚合（token/条数含 unpriced，cost 只算 priced 且有限）——recordUsage O(1) 增量维护；
    //  ② 折叠只删明细，绝不动桶/索引（记账时已入桶）；折叠边界按北京整天对齐，
    //     “天 < foldedUpTo ⇒ 该日 priced 明细已不在明细里”恒成立；
    //  ③ summaries 文件只持久化“已折叠天”的桶 + 已折叠记录的会话/账户增量 → 重启时
    //     桶 = 文件冻结部分 + 明细重建部分，两块按“天/记录是否已折叠”严格不相交，天然防双算；
    //  ④ unpriced 明细永不折叠（保住启动回填与远程价目 6h 回填），旧 unpriced 记录留在明细侧参与会话索引。
    const summariesState = {
      foldedUpTo: null, // 折叠边界（北京日起点 ms）；null = 从未折叠
      dayBuckets: {},   // day → account → currency → bucket
      sessions: {},     // accountKey\0sessionKey → { sessionId, account, input, cacheRead, cacheWrite, output, costs, minTs, maxTs }
      accountTotals: {}, // account → Σ costOf（币种混算，保持旧 providerSpend 口径）
    };
    let foldedSessionsDelta = {}; // 折叠记录的会话增量（持久化于 summaries；与明细重建部分不相交）
    let foldedAccountTotals = {}; // 折叠记录的账户累计增量（持久化于 summaries）
    let summariesDirty = false;
    let aggregatesVersion = 0; // 记账/回填/折叠任一实际变更 +1（预留增量缓存比对）
    let oldestRetainedPricedTs = null; // 明细中最旧 priced 记录的 ts；null = 无（折叠触发的廉价判据）
    let detailSorted = true; // 明细按 ts 有序才能二分；乱序（时钟回拨）时扫描自动退化为全量线性
    let journalLineCount = 0;
    let journalByteCount = 0;
    const perfCounters = __usageInternals.counters;

    function bumpAggregatesVersion() {
      aggregatesVersion += 1;
      perfCounters.aggregatesVersion = aggregatesVersion;
    }

    function resetUsageLedgerState() {
      if (saveDisposer) { saveDisposer(); saveDisposer = null; }
      usageRecords = [];
      dirty = false;
      summariesState.foldedUpTo = null;
      summariesState.dayBuckets = {};
      summariesState.sessions = {};
      summariesState.accountTotals = {};
      foldedSessionsDelta = {};
      foldedAccountTotals = {};
      summariesDirty = false;
      oldestRetainedPricedTs = null;
      detailSorted = true;
      journalLineCount = 0;
      journalByteCount = 0;
      ledgerError = null;
      bumpAggregatesVersion();
    }

    function allUsageRecordsForExport() {
      const archived = readArchivedUsageRecords();
      const records = [];
      const seen = new Set();
      function add(record, index, source) {
        if (!isValidUsageRecord(record)) return;
        const normalized = normalizeUsageRecord(record, index, source);
        const key = usageRecordKey(normalized, index, source);
        if (seen.has(key)) return;
        seen.add(key);
        records.push(normalized);
      }
      usageRecords.forEach(function (record, index) { add(record, index, 'current') });
      archived.records.forEach(function (record, index) { add(record, index, 'archive-export') });
      return {
        records: records.sort(function (a, b) { return a.ts - b.ts }),
        archiveReadError: archived.error,
      };
    }

    function accountBucketKey(account) {
      return safeMapKey(account == null ? NULL_ACCOUNT_KEY : account);
    }

    function isPricedFinite(record) {
      return Number.isFinite(record.cost) && record.cost >= 0;
    }

    // 无 sessionId 的记录沿用 provider/model#ts 兜底键（与旧 sessionTotals 的 Map 键一致）
    function sessionIndexKey(record) {
      const account = accountBucketKey(recordAccount(record));
      const rawKey = record.sessionId || (record.provider + '/' + record.model + '#' + record.ts);
      return account + '\u0000' + safeMapKey(rawKey);
    }

    function addToDayBucket(record) {
      const day = beijingDayKey(record.ts);
      const dayBuckets = summariesState.dayBuckets[day] || (summariesState.dayBuckets[day] = {});
      const accountBuckets = dayBuckets[accountBucketKey(recordAccount(record))] || (dayBuckets[accountBucketKey(recordAccount(record))] = {});
      const bucket = accountBuckets[safeMapKey(recordCurrency(record))] || (accountBuckets[safeMapKey(recordCurrency(record))] = emptyDayBucket());
      bucket.input += record.input;
      bucket.cacheRead += record.cacheRead;
      bucket.cacheWrite += record.cacheWrite;
      bucket.output += record.output;
      const cost = costOf(record, false);
      if (cost != null) {
        bucket.cost += cost;
        bucket.records += 1;
        const offpeak = costOf(record, true);
        if (offpeak != null) bucket.costOffpeak += offpeak;
      } else {
        bucket.unpriced += 1;
      }
    }

    function addToSessionIndex(record) {
      const key = sessionIndexKey(record);
      let entry = summariesState.sessions[key];
      if (!entry) {
        entry = {
          sessionId: record.sessionId,
          account: recordAccount(record),
          input: 0, cacheRead: 0, cacheWrite: 0, output: 0,
          costs: {},
          minTs: record.ts,
          maxTs: record.ts,
        };
        summariesState.sessions[key] = entry;
      }
      entry.input += record.input;
      entry.cacheRead += record.cacheRead;
      entry.cacheWrite += record.cacheWrite;
      entry.output += record.output;
      const cost = costOf(record, false);
      if (cost != null) {
        const cur = recordCurrency(record);
        entry.costs[cur] = (entry.costs[cur] || 0) + cost;
      }
      if (record.ts < entry.minTs) entry.minTs = record.ts;
      if (record.ts > entry.maxTs) entry.maxTs = record.ts;
    }

    // 记账 O(1) 路径：push 后增量更新当日桶 + 会话索引 + 账户累计器
    function addRecordToAggregates(record) {
      addToDayBucket(record);
      addToSessionIndex(record);
      const cost = costOf(record, false);
      if (cost != null) {
        const key = accountBucketKey(recordAccount(record));
        summariesState.accountTotals[key] = (summariesState.accountTotals[key] || 0) + cost;
      }
      if (isPricedFinite(record) && (oldestRetainedPricedTs == null || record.ts < oldestRetainedPricedTs)) {
        oldestRetainedPricedTs = record.ts;
      }
      if (detailSorted && usageRecords.length > 0 && record.ts < usageRecords[usageRecords.length - 1].ts) {
        detailSorted = false; // 时钟回拨：后续边界天扫描退化为线性，正确性由 ts 过滤保证
      }
      bumpAggregatesVersion();
    }

    // unpriced 回填后同步聚合：token 已在桶里（记账时计入），只补 cost 维度
    function backfillRecordAggregates(record) {
      const cost = costOf(record, false);
      if (cost == null) return;
      const day = summariesState.dayBuckets[beijingDayKey(record.ts)];
      const bucket = day && day[accountBucketKey(recordAccount(record))] && day[accountBucketKey(recordAccount(record))][safeMapKey(recordCurrency(record))];
      if (bucket) {
        bucket.cost += cost;
        bucket.records += 1;
        bucket.unpriced = Math.max(0, bucket.unpriced - 1);
        const offpeak = costOf(record, true);
        if (offpeak != null) bucket.costOffpeak += offpeak;
      }
      const entry = summariesState.sessions[sessionIndexKey(record)];
      if (entry) {
        const cur = recordCurrency(record);
        entry.costs[cur] = (entry.costs[cur] || 0) + cost;
      }
      const key = accountBucketKey(recordAccount(record));
      summariesState.accountTotals[key] = (summariesState.accountTotals[key] || 0) + cost;
      if (oldestRetainedPricedTs == null || record.ts < oldestRetainedPricedTs) oldestRetainedPricedTs = record.ts;
      // 回填可能改写了已折叠天的桶：冻结部分必须随下次落盘重写，否则重启后该天金额回退
      if (summariesState.foldedUpTo != null && record.ts < summariesState.foldedUpTo) summariesDirty = true;
      bumpAggregatesVersion();
    }

    // 启动重建：桶 = 文件冻结部分 + 明细重建部分；会话索引 = 文件折叠增量 + 全部明细。
    // 明细里残留的“已折叠 priced 记录”（旧版本回滚重写过快照等）按桶去重剔除——金额在桶里，绝不重复计。
    function initUsageAggregates(journalStats) {
      journalLineCount = journalStats.lines;
      journalByteCount = journalStats.bytes;
      const fileSummaries = readSummariesFile();
      // D4：汇总文件与备份同时不可用（缺失/双损坏）且折叠确已发生 → 折叠天金额本轮无法恢复。
      // 绝不静默：控制台显式 warn + 客户端可见「账单待整理」（persistence 走既有 snapshot-stale 通道），
      // 冷归档 usage-archive/ 仍保留记录级明细，可人工恢复。
      if (!fileSummaries && archiveHasFoldedRecords()) {
        const message = t('host.spendSummaryFileMissingArchived');
        console.warn('[dsh-bottom-info-bar] ' + message);
        ledgerError = { kind: 'snapshot-stale', message: message, at: Date.now() };
      }
      const boundary = fileSummaries ? fileSummaries.foldedUpTo : null;
      summariesState.foldedUpTo = boundary;
      summariesState.dayBuckets = {};
      summariesState.sessions = {};
      summariesState.accountTotals = {};
      if (fileSummaries) {
        for (const day of Object.keys(fileSummaries.foldedDayBuckets)) {
          const dayBuckets = {};
          const raw = fileSummaries.foldedDayBuckets[day] || {};
          for (const account of Object.keys(raw)) {
            const accountBuckets = {};
            for (const currency of Object.keys(raw[account])) {
              accountBuckets[safeMapKey(currency)] = Object.assign(emptyDayBucket(), raw[account][currency]);
            }
            dayBuckets[safeMapKey(account)] = accountBuckets;
          }
          summariesState.dayBuckets[safeMapKey(day)] = dayBuckets;
        }
        for (const key of Object.keys(fileSummaries.foldedSessions)) {
          const entry = fileSummaries.foldedSessions[key];
          if (!entry || typeof entry !== 'object') continue;
          summariesState.sessions[safeMapKey(key)] = {
            sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : '',
            account: entry.account == null ? null : entry.account,
            input: Number(entry.input) || 0,
            cacheRead: Number(entry.cacheRead) || 0,
            cacheWrite: Number(entry.cacheWrite) || 0,
            output: Number(entry.output) || 0,
            costs: Object.assign({}, entry.costs && typeof entry.costs === 'object' ? entry.costs : {}),
            minTs: Number(entry.minTs) || 0,
            maxTs: Number(entry.maxTs) || 0,
          };
        }
        for (const key of Object.keys(fileSummaries.foldedAccountTotals)) {
          summariesState.accountTotals[safeMapKey(key)] = Number(fileSummaries.foldedAccountTotals[key]) || 0;
        }
        foldedSessionsDelta = {};
        for (const key of Object.keys(fileSummaries.foldedSessions)) {
          foldedSessionsDelta[safeMapKey(key)] = fileSummaries.foldedSessions[key];
        }
        foldedAccountTotals = Object.assign({}, fileSummaries.foldedAccountTotals);
      }
      let droppedStale = 0;
      const retained = [];
      for (let i = 0; i < usageRecords.length; i++) {
        const record = usageRecords[i];
        if (boundary != null && record.ts < boundary && isPricedFinite(record)) { droppedStale += 1; continue; }
        retained.push(record);
      }
      if (droppedStale > 0) {
        usageRecords = retained;
        dirty = true; // 下次落盘把快照重写为窗内明细
        console.warn('[dsh-bottom-info-bar] 快照含 ' + droppedStale + ' 条已折叠的残留明细，已按汇总去重（金额不受影响）');
      }
      for (let i = 0; i < usageRecords.length; i++) {
        const record = usageRecords[i];
        const alreadyFolded = boundary != null && record.ts < boundary; // priced 残留已被剔除，这里只剩“整日已冻结”的 unpriced 记录
        if (!alreadyFolded) addToDayBucket(record);
        addToSessionIndex(record);
        const cost = costOf(record, false);
        if (cost != null) {
          const key = accountBucketKey(recordAccount(record));
          summariesState.accountTotals[key] = (summariesState.accountTotals[key] || 0) + cost;
        }
        if (isPricedFinite(record) && (oldestRetainedPricedTs == null || record.ts < oldestRetainedPricedTs)) {
          oldestRetainedPricedTs = record.ts;
        }
      }
      detailSorted = true;
      perfCounters.aggregatesVersion = aggregatesVersion;
    }

    // 明细范围扫描（聚合唯一触明细的路径）：有序时二分定位，只遍历 [fromTs, toTs)；
    // 计数器仅统计真正命中范围的记录，供测试断言“不随总记录数全量扫描”。
    function scanDetailRange(fromTs, toTs, visit) {
      perfCounters.detailScanCalls += 1;
      let i = 0;
      if (detailSorted && usageRecords.length > 0) {
        let lo = 0;
        let hi = usageRecords.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (usageRecords[mid].ts < fromTs) lo = mid + 1;
          else hi = mid;
        }
        i = lo;
      }
      for (; i < usageRecords.length; i++) {
        const record = usageRecords[i];
        if (detailSorted && record.ts >= toTs) break;
        if (record.ts < fromTs || record.ts >= toTs) continue;
        perfCounters.detailRecordsScanned += 1;
        visit(record);
      }
    }

    // ---------- summaries 落盘（只含折叠部分；原子写 + .bak 轮换，复用快照的恢复模式） ----------
    function validateSummariesFile(parsed) {
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      if (parsed.version !== SUMMARIES_FORMAT_VERSION) return false;
      const cut = parsed.foldedUpTo;
      if (cut != null && (!Number.isFinite(cut) || cut < 0 || cut > Date.now() + MS_PER_DAY)) return false;
      return !!(parsed.foldedDayBuckets && typeof parsed.foldedDayBuckets === 'object'
        && parsed.foldedSessions && typeof parsed.foldedSessions === 'object'
        && parsed.foldedAccountTotals && typeof parsed.foldedAccountTotals === 'object');
    }

    function readSummariesFile() {
      const candidates = [USAGE_SUMMARIES_FILE, USAGE_SUMMARIES_BACKUP_FILE];
      for (let i = 0; i < candidates.length; i++) {
        try {
          if (!existsSync(candidates[i])) continue;
          const parsed = JSON.parse(readFileSync(candidates[i], 'utf8'));
          if (validateSummariesFile(parsed)) return parsed;
          console.warn('[dsh-bottom-info-bar] 汇总文件校验未通过：' + candidates[i]);
        } catch (err) { /* 损坏 → 依次回退 .bak → 全量重建 */ }
      }
      return null;
    }

    // 冷归档目录是否留有折叠明细（“折叠已发生”的可靠痕迹：目录只在 appendFoldArchive 时创建）
    function archiveHasFoldedRecords() {
      try {
        if (!existsSync(USAGE_ARCHIVE_DIR)) return false;
        return readdirSync(USAGE_ARCHIVE_DIR).some(function (name) { return name.indexOf('.jsonl') !== -1; });
      } catch (err) { return false; }
    }

    function writeSummariesFile(foldedUpTo, sessionsDelta, accountTotals) {
      mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      const boundaryDay = foldedUpTo != null ? beijingDayKey(foldedUpTo) : null;
      const foldedDayBuckets = {};
      for (const day of Object.keys(summariesState.dayBuckets)) {
        if (boundaryDay != null && day < boundaryDay) foldedDayBuckets[day] = summariesState.dayBuckets[day];
      }
      const payload = {
        version: SUMMARIES_FORMAT_VERSION,
        savedAt: Date.now(),
        foldedUpTo: foldedUpTo,
        foldedDayBuckets: foldedDayBuckets,
        foldedSessions: sessionsDelta,
        foldedAccountTotals: accountTotals,
      };
      const tmp = USAGE_SUMMARIES_TEMP_PREFIX + process.pid + '.' + randomUUID();
      writeAndSync(tmp, JSON.stringify(payload), 'w');
      if (existsSync(USAGE_SUMMARIES_FILE)) {
        try { renameSync(USAGE_SUMMARIES_FILE, USAGE_SUMMARIES_BACKUP_FILE); } catch (err) { /* 下面的替换仍是原子操作 */ }
      }
      renameSync(tmp, USAGE_SUMMARIES_FILE);
    }

    // ---------- 折叠：超窗 priced 明细 → 冷归档 + 冻结天桶/会话/账户增量 ----------
    function appendFoldArchive(foldSet) {
      try {
        mkdirSync(USAGE_ARCHIVE_DIR, { recursive: true, mode: 0o700 });
        const byMonth = {};
        for (let i = 0; i < foldSet.length; i++) {
          const month = beijingDayKey(foldSet[i].ts).slice(0, 7);
          (byMonth[month] || (byMonth[month] = [])).push(foldSet[i]);
        }
        for (const month of Object.keys(byMonth)) {
          const lines = byMonth[month].map(function (record) { return JSON.stringify(record) + '\n'; }).join('');
          writeAndSync(join(USAGE_ARCHIVE_DIR, month + '.jsonl'), lines, 'a');
        }
        return true;
      } catch (err) {
        console.warn('[dsh-bottom-info-bar] 折叠明细冷归档失败，本次折叠放弃（明细原样保留）：' + String((err && err.message) || err));
        return false;
      }
    }

    function planFoldBoundary(nowMs) {
      const windowBoundary = beijingDayStartMs(beijingDayKey(nowMs - DETAIL_RETENTION_DAYS * MS_PER_DAY));
      const needByAge = oldestRetainedPricedTs != null && oldestRetainedPricedTs < windowBoundary;
      if (!needByAge && usageRecords.length <= DETAIL_HARD_CAP) return null;
      // 单次遍历按天计数：同时解出“覆盖过期 priced”与“剩余 priced ≤ 硬顶”的整天边界（unpriced 永不折叠）
      const perDay = new Map();
      let oldestPricedDay = null;
      let pricedCount = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const record = usageRecords[i];
        if (!isPricedFinite(record)) continue;
        pricedCount += 1;
        const day = beijingDayKey(record.ts);
        const stat = perDay.get(day) || { priced: 0 };
        stat.priced += 1;
        perDay.set(day, stat);
        if (oldestPricedDay == null || day < oldestPricedDay) oldestPricedDay = day;
      }
      let boundary = windowBoundary;
      if (needByAge && oldestPricedDay != null) {
        boundary = Math.max(boundary, beijingDayStartMs(oldestPricedDay) + MS_PER_DAY);
      }
      if (pricedCount > DETAIL_HARD_CAP) {
        const days = Array.from(perDay.keys()).sort();
        let remaining = pricedCount;
        for (let i = 0; i < days.length; i++) {
          if (remaining <= DETAIL_HARD_CAP) break;
          const dayStartMs = beijingDayStartMs(days[i]);
          if (dayStartMs + MS_PER_DAY <= boundary) {
            remaining -= perDay.get(days[i]).priced;
            continue;
          }
          boundary = dayStartMs + MS_PER_DAY;
          remaining -= perDay.get(days[i]).priced;
        }
      }
      let foldCount = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const record = usageRecords[i];
        if (record.ts < boundary && isPricedFinite(record)) foldCount += 1;
      }
      return foldCount > 0 ? boundary : null;
    }

    // 折叠三步（每步可中断且不丢账）：①冷归档（唯一记录级副本）→ ②原子写 summaries（失败回滚增量）→ ③才动明细。
    // 桶/索引在记账时就含这些记录，折叠只移除明细副本，任何中断点金额口径都不变。
    function maybeFoldUsage(nowMs) {
      const boundary = planFoldBoundary(nowMs);
      if (boundary == null) return false;
      const foldSet = [];
      for (let i = 0; i < usageRecords.length; i++) {
        const record = usageRecords[i];
        if (record.ts < boundary && isPricedFinite(record)) foldSet.push(record);
      }
      if (foldSet.length === 0) return false;
      if (!appendFoldArchive(foldSet)) return false;
      const nextFoldedUpTo = summariesState.foldedUpTo != null ? Math.max(summariesState.foldedUpTo, boundary) : boundary;
      const nextSessionsDelta = Object.assign({}, foldedSessionsDelta);
      const nextAccountTotals = Object.assign({}, foldedAccountTotals);
      for (let i = 0; i < foldSet.length; i++) {
        const record = foldSet[i];
        const sKey = sessionIndexKey(record);
        const delta = nextSessionsDelta[sKey] || (nextSessionsDelta[sKey] = {
          sessionId: record.sessionId,
          account: recordAccount(record),
          input: 0, cacheRead: 0, cacheWrite: 0, output: 0,
          costs: {},
          minTs: record.ts,
          maxTs: record.ts,
        });
        delta.input += record.input;
        delta.cacheRead += record.cacheRead;
        delta.cacheWrite += record.cacheWrite;
        delta.output += record.output;
        const cost = costOf(record, false);
        if (cost != null) {
          const cur = recordCurrency(record);
          delta.costs[cur] = (delta.costs[cur] || 0) + cost;
        }
        if (record.ts < delta.minTs) delta.minTs = record.ts;
        if (record.ts > delta.maxTs) delta.maxTs = record.ts;
        const aKey = accountBucketKey(recordAccount(record));
        nextAccountTotals[aKey] = (nextAccountTotals[aKey] || 0) + (cost == null ? 0 : cost);
      }
      try {
        writeSummariesFile(nextFoldedUpTo, nextSessionsDelta, nextAccountTotals);
      } catch (err) {
        console.warn('[dsh-bottom-info-bar] 折叠汇总落盘失败，本次折叠放弃（明细原样保留）：' + String((err && err.message) || err));
        return false;
      }
      summariesState.foldedUpTo = nextFoldedUpTo;
      foldedSessionsDelta = nextSessionsDelta;
      foldedAccountTotals = nextAccountTotals;
      summariesDirty = false;
      const removeSet = new Set(foldSet);
      usageRecords = usageRecords.filter(function (record) { return !removeSet.has(record); });
      oldestRetainedPricedTs = null;
      for (let i = 0; i < usageRecords.length; i++) {
        const record = usageRecords[i];
        if (isPricedFinite(record) && (oldestRetainedPricedTs == null || record.ts < oldestRetainedPricedTs)) {
          oldestRetainedPricedTs = record.ts;
        }
      }
      dirty = true; // 快照需重写为窗内明细（首次折叠即“重写快照为窗内明细”）
      perfCounters.foldedRecords += foldSet.length;
      bumpAggregatesVersion();
      console.warn('[dsh-bottom-info-bar] 已折叠 ' + foldSet.length + ' 条超窗明细（冷归档 usage-archive/，汇总 usage-summaries.json）');
      return true;
    }

    // ---------- journal 滚动压缩：快照写成功后，把“不在当前快照里的行”原子替换回去 ----------
    // 以记录 id 判定残留（比审计建议的字节偏移基线更稳：多实例交替追加时行序交错，偏移量切不准）；
    // 解析失败/无 id 的行保守保留，靠加载侧 id 去重兜底，任何中断点至少快照或 journal 其一完整。
    function maybeCompactJournal() {
      try {
        let stat = null;
        try { stat = statSync(USAGE_JOURNAL_FILE); } catch (err) {
          journalLineCount = 0;
          journalByteCount = 0;
          return;
        }
        if (stat.size <= JOURNAL_COMPACT_MAX_BYTES && journalLineCount <= JOURNAL_COMPACT_MAX_LINES) return;
        const raw = readFileSync(USAGE_JOURNAL_FILE, 'utf8');
        const keepIds = new Set();
        for (let i = 0; i < usageRecords.length; i++) keepIds.add(usageRecords[i].id);
        // 折叠边界（若有）：折叠区的 priced 行金额已冻结进 summaries，可直接丢弃；
        // 否则这些行永远“不在明细里”，journal 会被反复保守保留、永远压不干净。
        const foldedUpTo = summariesState.foldedUpTo;
        const kept = [];
        raw.split('\n').forEach(function (line) {
          if (!line.trim()) return;
          try {
            const parsed = JSON.parse(line);
            if (parsed && typeof parsed.id === 'string' && keepIds.has(parsed.id)) return; // 已在快照里 → 可丢弃
            if (foldedUpTo != null && Number.isFinite(parsed.ts) && parsed.ts < foldedUpTo && Number.isFinite(parsed.cost) && parsed.cost >= 0) return; // 折叠区 priced 行：金额在冻结桶里
          } catch (err) { /* 撕裂行保守保留 */ }
          kept.push(line);
        });
        const tmp = USAGE_JOURNAL_FILE + '.compact.' + process.pid + '.' + randomUUID();
        writeAndSync(tmp, kept.length > 0 ? kept.join('\n') + '\n' : '', 'w');
        renameSync(tmp, USAGE_JOURNAL_FILE);
        journalLineCount = kept.length;
        journalByteCount = Buffer.byteLength(kept.length > 0 ? kept.join('\n') + '\n' : '', 'utf8');
        perfCounters.journalCompactions += 1;
      } catch (err) {
        // 压缩失败不影响记账：journal 仍是权威追加日志，下次落盘再试
        console.warn('[dsh-bottom-info-bar] 记账流水压缩失败（不影响记账）：' + String((err && err.message) || err));
      }
    }

    // 启动自愈：收敛账本目录/流水账权限（尽力而为，见 hardenLedgerFilePermissions）
    hardenLedgerFilePermissions();
    initUsageAggregates(loadedUsageRecords.journalStats);

    // ---------- 一次性回填：unpriced 历史记录按当前价目表补算 ----------
    // 背景：价目表随适配逐步收录；收录之前落账的记录 pricingStatus='unpriced'（cost=null），
    // 导致本会话/今日/累计花费长期漏算（例如接入智谱后其历史对话金额恒为 0）。
    // 规则：① 只补"从未有过价格"的记录，绝不改写已 priced 的历史金额；
    //      ② 仅限带稳定 id 的记录（无 id 的远古记录在快照+流水双源下无法安全幂等）；
    //      ③ 补算结果一次性写入快照，此后与正常记录同权参与全部汇总。
    function backfillUnpricedRecords() {
      let count = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const rec = usageRecords[i];
        if (!rec || rec.pricingStatus === 'priced') continue;
        if (!(typeof rec.id === 'string' && rec.id.length > 0)) continue;
        if (Number.isFinite(rec.cost) && rec.cost >= 0) continue;
        const billed = costOf(rec, false);
        if (billed == null) continue; // 价目表仍无该模型 → 维持 unpriced
        rec.cost = billed;
        rec.currency = modelCurrency(rec.provider, rec.model);
        rec.pricingStatus = 'priced';
        rec.pricingVersion = 'builtin-backfill-' + packageVersion();
        backfillRecordAggregates(rec);
        count++;
      }
      if (count > 0) {
        dirty = true;
        scheduleSave();
        console.warn('[dsh-bottom-info-bar] 价目表回填：' + count + ' 条 unpriced 记录已按官方单价补算');
      }
      return count;
    }

    function writeAndSync(filePath, content, flags) {
      let fd = null;
      try {
        fd = openSync(filePath, flags, 0o600);
        const bytes = Buffer.from(content);
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(fd, bytes, offset, bytes.length - offset);
          if (!written) throw new Error(t('host.spendLedgerCouldNotBe'));
          offset += written;
        }
        fsyncSync(fd);
      } finally {
        if (fd !== null) closeSync(fd);
      }
    }

    function appendUsageJournal(record) {
      try {
        mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
        // `a` opens with O_APPEND.  A record is admitted to the visible total
        // only after the operating system confirms this line has been flushed.
        writeAndSync(USAGE_JOURNAL_FILE, JSON.stringify(record) + '\n', 'a');
        return null;
      } catch (err) {
        return { kind: 'journal-failed', message: String((err && err.message) || err), at: Date.now() };
      }
    }

    function flushSave() {
      if (saveDisposer) { saveDisposer(); saveDisposer = null; }
      // 折叠汇总先于快照落盘：崩溃时“冻结桶已持久化、快照仍含明细”是安全方向——
      // 重启按桶去重剔除残留明细即可；反过来（快照已删、汇总未写）会丢折叠部分的金额。
      if (summariesDirty) {
        try {
          writeSummariesFile(summariesState.foldedUpTo, foldedSessionsDelta, foldedAccountTotals);
          summariesDirty = false;
        } catch (err) {
          ledgerError = { kind: 'snapshot-stale', message: t('host.couldNotSaveArchivedSpend', { value: String((err && err.message) || err) }), at: Date.now() };
          console.warn('[dsh-bottom-info-bar] 折叠汇总落盘失败（内存聚合继续，重启前重试）', ledgerError.message);
        }
      }
      try {
        mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
        // The append-only journal has already made each record durable.  This
        // snapshot is a recovery/cache layer, so an overlapping older process
        // can no longer erase newer records by writing stale memory here.
        const tmp = DATA_TEMP_PREFIX + process.pid + '.' + randomUUID();
        writeAndSync(tmp, JSON.stringify(usageRecords), 'w');
        if (existsSync(DATA_FILE)) {
          try { renameSync(DATA_FILE, DATA_BACKUP_FILE); } catch (err) { /* replacement below is still atomic */ }
        }
        renameSync(tmp, DATA_FILE);
        dirty = false; // 写盘成功后才清除脏标记：失败时保留，卸载冲刷可重试
        if (ledgerError && ledgerError.kind === 'snapshot-stale' && !summariesDirty) ledgerError = null;
        maybeCompactJournal();
      } catch (err) {
        // The journal remains authoritative, but tell the user that the
        // directly readable snapshot has not caught up yet.
        ledgerError = { kind: 'snapshot-stale', message: String((err && err.message) || err), at: Date.now() };
        console.warn('[dsh-bottom-info-bar] 记账快照落盘失败', ledgerError.message);
      }
      // 落盘后顺手检查折叠：触发则冻结部分已写盘，明细变化再排一次快照重写
      if (maybeFoldUsage(Date.now())) scheduleSave();
    }

    // 防抖落盘：记账后 4s 内合并写入；插件卸载时立即冲刷
    function scheduleSave() {
      dirty = true;
      if (saveDisposer) return;
      saveDisposer = ctx.timeout(function () {
        saveDisposer = null;
        if (dirty) flushSave();
      }, 4000);
    }

    // Persist the one-time legacy-id migration even if the user makes no new
    // request before restarting again.
    if (dirty) scheduleSave();

    function hasUsageTokens(usage) {
      if (!usage || typeof usage !== 'object') return false;
      return ['uncachedInputTokens', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'].some(function (key) {
        return usage[key] != null;
      });
    }

    const unpricedWarnedModels = new Set(); // 每个模型只提醒一次，避免高频 warn 刷日志

    function recordUsage(options, usage, status) {
      const u = usage || {};
      // 数值清洗：uncachedInputTokens 的 != null 对 NaN 恒真、|| 0 挡不住 Infinity/负值——
      // 统一 sanitizeTokens（NaN/Infinity/负数/非数字 → 0），坏数值不进内存汇总也不落盘
      const rec = {
        id: randomUUID(),
        ts: Date.now(),
        model: options.model || '',
        provider: options.provider || '',
        sessionId: options.sessionId || '',
        purpose: options.purpose || '',
        input: sanitizeTokens(u.uncachedInputTokens != null ? u.uncachedInputTokens : u.inputTokens),
        cacheRead: sanitizeTokens(u.cacheReadTokens),
        cacheWrite: sanitizeTokens(u.cacheWriteTokens),
        output: sanitizeTokens(u.outputTokens),
        status: status === 'interrupted' ? 'interrupted' : 'completed',
      };
      // 单调时间戳：保证同毫秒内的并发记账仍严格递增，避免 currentSession 按 ts>=起点 过滤时把同毫秒的其他会话误合并
      if (usageRecords.length > 0) {
        const lastTs = usageRecords[usageRecords.length - 1].ts;
        if (rec.ts <= lastTs) rec.ts = lastTs + 1;
      }
      // Freeze the actual price at usage time.  Historical totals must not
      // change merely because the plugin's reference price table is updated.
      const billed = costOf(rec, false);
      // ① 聚合商在 usage 中直接给出的真实金额（如 OpenRouter 的 usage.cost）——
      //    官方报出的钱优先级最高，聚合商场景从此免维护静态价目表；
      // ② 价目表换算（当前各家官方单价）；③ 都没有 → unpriced 待启动回填。
      const reportedCost = parseFiniteNonNegativeAmount(u.cost);
      if (billed == null && reportedCost != null) {
        rec.cost = reportedCost;
        rec.currency = Object.hasOwn(PROVIDER_REPORTED_CURRENCY, rec.provider)
          ? PROVIDER_REPORTED_CURRENCY[rec.provider]
          : modelCurrency(rec.provider, rec.model);
        rec.pricingStatus = 'priced';
        rec.pricingVersion = 'provider-reported-' + packageVersion();
      } else if (billed != null) {
        rec.currency = modelCurrency(rec.provider, rec.model);
        rec.cost = billed;
        rec.pricingStatus = 'priced';
        rec.pricingVersion = 'builtin-' + packageVersion();
      } else {
        rec.pricingStatus = 'unpriced';
        rec.pricingVersion = null;
        // 诊断：理论上本插件任一实例的 PRICING 均应同步；若此处为 false 说明存在多副本或键名不匹配。
        // 每个模型仅首次出现时提醒一次，防止未收录模型（如订阅目录下的混合路由）高频刷日志
        if (!unpricedWarnedModels.has(rec.model)) {
          unpricedWarnedModels.add(rec.model);
          console.warn('[dsh-bottom-info-bar] 记账未计价（每模型仅提示一次）：model="' + rec.model + '" 价目表含该模型=' + Boolean(
            Object.hasOwn(PRICING, rec.model) || Object.hasOwn(PRICING, rec.provider + ':' + rec.model)
          ));
        }
      }
      const writeError = appendUsageJournal(rec);
      if (writeError) {
        ledgerError = writeError;
        console.warn('[dsh-bottom-info-bar] 记账日志追加失败', writeError.message);
        return false;
      }
      usageRecords.push(rec);
      addRecordToAggregates(rec); // O(1) 增量聚合：桶/索引在记账时即完整，后续汇总不再回扫明细
      perfCounters.recordUsageCount += 1;
      ledgerError = null;
      scheduleSave();
      return true;
    }

    ctx.on('llm/stream', async function* (options, next) {
      try {
        activeUsageStreams += 1;
        let stream;
        try {
          stream = await next();
        } catch (err) {
          console.warn('[dsh-bottom-info-bar] llm/stream 获取失败，本次不记账', String((err && err.message) || err));
          throw err; // 保持错误向上传播：不把上游失败消化成空流（仅跳过记账逻辑）
        }
        let latestUsage = null;
        let sawFinish = false;
        let committed = false;
        function commitUsage(status) {
          if (committed || !hasUsageTokens(latestUsage)) return;
          committed = true;
          try { recordUsage(options, latestUsage, status); } catch (err) {
            ledgerError = { kind: 'journal-failed', message: String((err && err.message) || err), at: Date.now() };
            console.warn('[dsh-bottom-info-bar] 本次账单未保存', ledgerError.message);
          }
        }
        try {
          for await (const chunk of stream) {
            if (chunk && chunk.type === 'usage' && chunk.usage) {
              // DSH usage chunks are treated as snapshots.  Keep the last one
              // and commit it once when this model response finishes.
              latestUsage = Object.assign({}, chunk.usage);
            }
            if (chunk && chunk.type === 'finish') sawFinish = true;
            yield chunk;
          }
        } catch (err) {
          commitUsage('interrupted');
          throw err;
        } finally {
          commitUsage(sawFinish ? 'completed' : 'interrupted');
        }
      } finally {
        activeUsageStreams = Math.max(0, activeUsageStreams - 1);
      }
    });

    // M5：适配器/目录变更（模型增删、provider 改名）→ 丢弃旧能力并重建缓存，信息栏与切换器保持一致。
    // generation guard 会让事件前已经发出的异步请求失效，避免旧目录在新版 DSH 到达后回写。
    function invalidateModelCatalog() {
      modelCatalogGeneration += 1;
      modelCatalogRefreshed = Object.create(null);
      modelCatalogRetryAt = Object.create(null);
      modelCatalogMissingRetryAt = Object.create(null);
      modelCatalogIds = Object.create(null);
      modelCatalogPending = Object.create(null);
      modelImageInputCache = Object.create(null);
      modelCapabilityRefreshed = Object.create(null);
      modelCapabilityRetryAt = Object.create(null);
      modelCapabilityPending = Object.create(null);
    }
    ctx.on('llm/adapters-updated', function () {
      invalidateModelCatalog();
      refreshActiveModelCatalog(true);
    });
    // 新版 DSH 会在设置/客户端文档变化后重建模型目录；监听该事件覆盖“新模型已发布但适配器未重载”的路径。
    ctx.on('settings/document-updated', function () {
      invalidateModelCatalog();
      refreshActiveModelCatalog(true);
    });

    // ---------- 花费计算 ----------
    function costOf(record, forceOffpeak) {
      // v2 ledger records carry the charge as observed.  Use it for normal
      // reporting; only the "all-offpeak" forecast intentionally recalculates.
      if (!forceOffpeak && Number.isFinite(record.cost) && record.cost >= 0) return record.cost;
      const entry = pricingEntryFor(record.provider, record.model, record.ts);
      if (!entry) return null;
      let p;
      if (entry.mode === 'peak-valley') {
        p = forceOffpeak ? entry.offpeak : entry[currentPeriod(record.ts)];
      } else {
        p = entry.price;
      }
      const missInput = record.input + record.cacheWrite;
      const cost = (missInput * p.inputCacheMiss + record.cacheRead * p.inputCacheHit + record.output * p.output) / 1e6;
      // 结果非有限（任一字段 NaN/Infinity/缺失）→ null；调用方统一 `c != null` 判空即排除，NaN 不会累加进任何汇总
      return Number.isFinite(cost) ? cost : null;
    }

    // ---------- 会话聚合与中位数 ----------
    function median(arr) {
      if (!arr || arr.length === 0) return 0;
      const s = arr.slice().sort(function (a, b) { return a - b; });
      const mid = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }

    // v1.6：sessionTotals 增加账户维度参数——本对话统计只聚合当前账户记录
    // v1.9：改由会话索引直接输出（记账时增量维护，折叠不回删索引），O(会话数) 且与全扫逐字段等价；
    // 账户过滤保持旧口径：activeAccount 为 null/undefined 时不过滤（全部会话）
    function sessionTotals(activeAccount) {
      const out = [];
      for (const key of Object.keys(summariesState.sessions)) {
        const entry = summariesState.sessions[key];
        if (activeAccount != null && entry.account !== activeAccount) continue;
        out.push({
          sessionId: entry.sessionId,
          input: entry.input,
          cacheRead: entry.cacheRead,
          cacheWrite: entry.cacheWrite,
          output: entry.output,
          costs: Object.assign({}, entry.costs),
          lastTs: entry.maxTs,
        });
      }
      return out.sort(function (a, b) { return a.lastTs - b.lastTs; });
    }

    function calibrationFrom(sessions, n) {
      if (!sessions || sessions.length === 0) return null;
      const recent = sessions.slice(-n);
      const count = recent.length;
      return {
        count: count,
        label: t('host.basedOnYourLastSessions', { count: count }),
        medianInput: median(recent.map(function (s) { return s.input; })),
        medianCacheRead: median(recent.map(function (s) { return s.cacheRead; })),
        medianCacheWrite: median(recent.map(function (s) { return s.cacheWrite; })),
        medianOutput: median(recent.map(function (s) { return s.output; })),
      };
    }

    // Issue #44：本会话只聚合当前会话及 DSH 明确标记为 origin=subagent 的后代。
    // 旧实现用“当前会话最早时间 + 同账户后续所有记录”推测子代理，会把并行的其他会话
    // 一并算进来；没有 sessionController 的老宿主则安全退回“只算选中会话”，绝不猜测。
    async function currentSessionSummary(activeAccount, sessionId) {
      if (usageRecords.length === 0) return null;
      if (!sessionId) return null; // 无可用会话 ID：不猜测归属，客户端显示 ¥0.000，而非回退最近会话
      const norm = normalizeSessionIdValue(sessionId);
      if (!norm) return null;
      // 双保险：谱系增强属于可选能力，任何意外都不得让整个花费查询失败（Issue #67）。
      let lineageItems = null;
      try {
        lineageItems = await readSessionLineageItems();
      } catch (err) {
        warnSessionLineageUnavailable(err);
      }
      const ownedSessionIds = lineageItems ? sessionLineageIds(lineageItems, norm) : new Set([norm]);
      const acc = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costs: {} };
      let matched = false;
      for (const key of Object.keys(summariesState.sessions)) {
        const entry = summariesState.sessions[key];
        if (!entry || entry.account !== activeAccount) continue;
        if (!ownedSessionIds.has(normalizeSessionIdValue(entry.sessionId))) continue;
        matched = true;
        acc.input += entry.input;
        acc.cacheRead += entry.cacheRead;
        acc.cacheWrite += entry.cacheWrite;
        acc.output += entry.output;
        for (const currency of Object.keys(entry.costs || {})) {
          acc.costs[currency] = (acc.costs[currency] || 0) + (Number(entry.costs[currency]) || 0);
        }
      }
      if (!matched) return null; // 明确传入但未命中（新会话尚无记账）→ 客户端显示 ¥0.000
      const denom = acc.input + acc.cacheRead + acc.cacheWrite;
      return {
        input: acc.input,
        cacheRead: acc.cacheRead,
        cacheWrite: acc.cacheWrite,
        output: acc.output,
        tokens: acc.input + acc.cacheRead + acc.cacheWrite + acc.output,
        costs: acc.costs || {},
        hitRate: denom > 0 ? Math.round((acc.cacheRead / denom) * 1000) / 10 : null,
      };
    }

    function activeCurrency(selection) {
      // 币种跟随活跃模型服务商（与余额账户同源）：deepseek → CNY、openai → USD（估算快照）；
      // 余额快照未就绪时回退已确认模型的定价币种；未确认时返回 null，避免显示错币种
      const sel = selection || modelSelection();
      if (!selectionIsResolved(sel)) return null;
      const key = balanceProviderKey(sel.provider);
      if (key === null) return null;
      const snap = balances[key];
      if (snap && snap.data && snap.data.currency) return snap.data.currency;
      return modelCurrency(sel.provider, sel.model);
    }

    function recordCurrency(record) {
      return record && typeof record.currency === 'string' && record.currency.length > 0
        ? record.currency
        : modelCurrency(record && record.provider, record && record.model);
    }

    function spendSummary(nowMs, selection) {
      const sel = selection || modelSelection();
      if (!selectionIsResolved(sel)) return null;
      // v1.6：计算当前活跃账户
      const activeAccount = accountForProvider(sel.provider);
      const balanceKey = balanceProviderKey(sel.provider);
      if (balanceKey === null) return null;
      const snap = balances[balanceKey] || { data: null };
      const balance = snap.data ? snap.data.total : null;
      const cur = activeCurrency(sel);
      if (!cur) return null;
      const cutoff = nowMs - SPEND_DAYS * MS_PER_DAY;
      const cutoffDay = beijingDayKey(cutoff);
      const accountKey = accountBucketKey(activeAccount);
      const currencyKey = safeMapKey(cur);
      let total = 0;
      let offpeakTotal = 0;
      let daysActive = 0;
      // 完整天读桶；截止日（含 cutoff 之前的部分天）在明细上逐条过滤，保持与旧全扫等价
      for (const day of Object.keys(summariesState.dayBuckets)) {
        if (day <= cutoffDay) continue;
        const accountBuckets = summariesState.dayBuckets[day][accountKey];
        const bucket = accountBuckets && accountBuckets[currencyKey];
        if (!bucket || bucket.records <= 0) continue;
        daysActive += 1;
        total += bucket.cost;
        offpeakTotal += bucket.costOffpeak;
      }
      let boundaryDayActive = false;
      scanDetailRange(beijingDayStartMs(cutoffDay), beijingDayStartMs(cutoffDay) + MS_PER_DAY, function (r) {
        if (r.ts < cutoff) return;
        // v1.6：账户 + 币种双条件过滤
        if (activeAccount !== null && recordAccount(r) !== activeAccount) return;
        if (recordCurrency(r) !== cur) return; // 只聚合活动币种，避免跨币种相加
        const c = costOf(r, false);
        if (c == null) return;
        boundaryDayActive = true;
        total += c;
        const oc = costOf(r, true);
        if (oc != null) offpeakTotal += oc;
      });
      if (boundaryDayActive) daysActive += 1;
      if (total <= 0 || balance == null) return null;
      daysActive = Math.max(1, daysActive);
      const dailySpend = total / daysActive;
      const offpeakDailySpend = offpeakTotal / daysActive;
      return {
        days: SPEND_DAYS,
        daysActive: daysActive,
        totalSpend: Math.round(total * 100) / 100,
        dailySpend: Math.round(dailySpend * 100) / 100,
        balance: balance,
        daysLeft: dailySpend > 0 ? Math.round(balance / dailySpend * 10) / 10 : null,
        offpeakDailySpend: Math.round(offpeakDailySpend * 100) / 100,
        offpeakDaysLeft: offpeakDailySpend > 0 ? Math.round(balance / offpeakDailySpend * 10) / 10 : null,
        note: t('host.estimatedFromSpendingOverThe', { SPEND_DAYS: SPEND_DAYS }),
      };
    }

    // ---------- 今日花费（北京时间当日累计，v1.6 账户 + 币种双条件过滤） ----------
    // v1.9：直接读当日桶 O(1)（桶在记账时即含全部记录，含 unpriced 的 token，cost 只算 priced）
    function todaySpend(nowMs, selection) {
      const sel = selection || modelSelection();
      if (!selectionIsResolved(sel)) return null;
      const activeAccount = accountForProvider(sel.provider);
      const key = beijingDayKey(nowMs);
      const cur = activeCurrency(sel);
      if (!cur) return null;
      const accountBuckets = summariesState.dayBuckets[key] && summariesState.dayBuckets[key][accountBucketKey(activeAccount)];
      const bucket = accountBuckets && accountBuckets[safeMapKey(cur)];
      const total = bucket ? bucket.cost : 0;
      return Math.round(total * 1000) / 1000;
    }

    // ---------- 本月/近30天花费（v1.6 账户 + 币种双条件过滤） ----------
    function monthSpend(nowMs, selection) {
      const sel = selection || modelSelection();
      if (!selectionIsResolved(sel)) return null;
      const activeAccount = accountForProvider(sel.provider);
      const d = new Date(nowMs + 8 * 3600 * 1000);
      const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      const cur = activeCurrency(sel);
      if (!cur) return null;
      const accountKey = accountBucketKey(activeAccount);
      const currencyKey = safeMapKey(cur);
      let total = 0;
      for (const day of Object.keys(summariesState.dayBuckets)) {
        if (!day.startsWith(key)) continue;
        const accountBuckets = summariesState.dayBuckets[day][accountKey];
        const bucket = accountBuckets && accountBuckets[currencyKey];
        if (bucket) total += bucket.cost;
      }
      return Math.round(total * 1000) / 1000;
    }
    function last30dSpend(nowMs, selection) {
      const sel = selection || modelSelection();
      if (!selectionIsResolved(sel)) return null;
      const activeAccount = accountForProvider(sel.provider);
      const cutoff = nowMs - 30 * MS_PER_DAY;
      const cutoffDay = beijingDayKey(cutoff);
      const cur = activeCurrency(sel);
      if (!cur) return null;
      const accountKey = accountBucketKey(activeAccount);
      const currencyKey = safeMapKey(cur);
      let total = 0;
      for (const day of Object.keys(summariesState.dayBuckets)) {
        if (day <= cutoffDay) continue;
        const accountBuckets = summariesState.dayBuckets[day][accountKey];
        const bucket = accountBuckets && accountBuckets[currencyKey];
        if (bucket) total += bucket.cost;
      }
      // 截止日是半天：桶是整日聚合，不能整读，在明细上逐条过滤保持等价
      scanDetailRange(beijingDayStartMs(cutoffDay), beijingDayStartMs(cutoffDay) + MS_PER_DAY, function (r) {
        if (r.ts < cutoff) return;
        if (activeAccount !== null && recordAccount(r) !== activeAccount) return;
        if (recordCurrency(r) !== cur) return;
        const c = costOf(r, false);
        if (c != null) total += c;
      });
      return Math.round(total * 1000) / 1000;
    }

    // ---------- 场景估算 ----------
    function scenarioCost(sc, rate, prices) {
      const input = sc.inputK * 1000;
      const output = sc.outputK * 1000;
      const inputCost = input * (rate * prices.inputCacheHit + (1 - rate) * prices.inputCacheMiss);
      const outputCost = output * prices.output;
      return (inputCost + outputCost) / 1e6;
    }

    function computeEstimate(nowMs, selected) {
      // v1.9：会话合计取一次，估算与校准两处复用（原来各全扫一遍明细）
      const allSessions = sessionTotals();
      const selection = selected || modelSelection();
      const pricing = computePricing(nowMs, selection);
      const bal = activeBalanceSummary(nowMs, selection);
      const balance = bal.data ? bal.data.total : null;
      const currency = bal.currency || null;

      let conversion = null;
      if (balance != null && pricing.prices) {
        const p = pricing.prices;
        const outputTokens = (balance * 1e6) / p.output;
        const inputTokens = (balance * 1e6) / p.inputCacheMiss;
        conversion = {
          outputTokens: Math.floor(outputTokens),
          outputHanzi: Math.floor(outputTokens * 0.5),
          outputWords: Math.floor(outputTokens * 0.75),
          outputBooks: (outputTokens * 0.5) / 200000,
          inputTokens: Math.floor(inputTokens),
          inputHanzi: Math.floor(inputTokens * 0.5),
        };
      }

      let scenarios = [];
      if (balance != null && pricing.prices) {
        const p = pricing.prices;
        const pvEntry = pricing.mode === 'peak-valley' ? pricingEntryFor(pricing.provider, pricing.model, nowMs) : null;
        const peakPrices = pvEntry ? pvEntry.peak : p;
        const offpeakPrices = pvEntry ? pvEntry.offpeak : p;
        scenarios = SCENARIOS.map(function (sc) {
          return {
            id: sc.id, label: sc.label, outputK: sc.outputK, inputK: sc.inputK,
            optimistic: Math.floor(balance / scenarioCost(sc, 1.0, offpeakPrices)),
            pessimistic: Math.floor(balance / scenarioCost(sc, 0, peakPrices)),
            baseline: Math.floor(balance / scenarioCost(sc, 0.5, p)),
            offpeakBase: Math.floor(balance / scenarioCost(sc, 0.5, offpeakPrices)),
          };
        });
        const calib = calibrationFrom(allSessions, CALIB_SESSIONS);
        if (calib && calib.medianOutput > 0) {
          const sc = {
            id: 'calibrated', label: t('host.yourTypicalSession'),
            outputK: Math.max(1, Math.round(calib.medianOutput / 1000)),
            inputK: Math.max(1, Math.round((calib.medianInput + calib.medianCacheRead + calib.medianCacheWrite) / 1000)),
            calibrated: true, calibrationCount: calib.count,
          };
          scenarios.unshift({
            id: sc.id, label: sc.label, outputK: sc.outputK, inputK: sc.inputK,
            calibrated: true, calibrationCount: sc.calibrationCount,
            optimistic: Math.floor(balance / scenarioCost(sc, 1.0, offpeakPrices)),
            pessimistic: Math.floor(balance / scenarioCost(sc, 0, peakPrices)),
            baseline: Math.floor(balance / scenarioCost(sc, 0.5, p)),
            offpeakBase: Math.floor(balance / scenarioCost(sc, 0.5, offpeakPrices)),
          });
        }
      }

      return {
        currency: currency,
        balance: balance,
        conversion: conversion,
        scenarios: scenarios,
        calibration: calibrationFrom(allSessions, CALIB_SESSIONS),
        pricing: pricing,
        fetchedAt: bal.provider && balances[bal.provider] ? balances[bal.provider].fetchedAt : null,
        stale: !!(bal.provider && balances[bal.provider] && balances[bal.provider].error !== null && balances[bal.provider].data !== null),
        error: bal.provider && balances[bal.provider] ? balances[bal.provider].error : null,
      };
    }

    // ---------- 全部花费（v1.6 账户 + 币种双条件过滤） ----------
    // v1.9：全部历史读全量日桶（含已折叠天），不再回扫明细
    function totalSpend(selection) {
      const sel = selection || modelSelection();
      if (!selectionIsResolved(sel)) return null;
      const activeAccount = accountForProvider(sel.provider);
      const cur = activeCurrency(sel);
      if (!cur) return null;
      const accountKey = accountBucketKey(activeAccount);
      const currencyKey = safeMapKey(cur);
      let total = 0;
      for (const day of Object.keys(summariesState.dayBuckets)) {
        const accountBuckets = summariesState.dayBuckets[day][accountKey];
        const bucket = accountBuckets && accountBuckets[currencyKey];
        if (bucket) total += bucket.cost;
      }
      return Math.round(total * 1000) / 1000;
    }

    // ---------- 用量汇总 ----------
    // v1.9：全部字段由日桶/会话索引组装（O(桶数+会话数)+边界天扫描）；本会话改为
    // 会话索引 + DSH 谱系读取，各滚动窗仍只扫描截止日，不再随总记录数增长。
    async function getUsageSummary(nowMs, sessionId, selection) {
      const sel = selection || modelSelection();
      if (!selectionIsResolved(sel)) return null;
      // v1.6：计算当前活跃账户，用于会话聚合过滤
      const activeAccount = accountForProvider(sel.provider);
      const sessions = sessionTotals(activeAccount);
      return {
        sessions: sessions.length,
        calibration: calibrationFrom(sessions, CALIB_SESSIONS),
        currentSession: await currentSessionSummary(activeAccount, sessionId),
        spend: spendSummary(nowMs, selection),
        todaySpend: todaySpend(nowMs, selection),
        monthSpend: monthSpend(nowMs, selection),
        last30dSpend: last30dSpend(nowMs, selection),
        totalSpend: totalSpend(selection),
        persistence: ledgerError ? { state: ledgerError.kind, message: ledgerError.message, at: ledgerError.at } : { state: 'ok', message: null, at: null },
        now: nowMs,
      };
    }

    // ---------- 花费趋势 ----------
    // v1.9：逐日点位改读日桶（一次按桶扫描）；byModel 需要模型维度（桶无此维度），
    // 保留一次保留窗内的明细扫描（7/30 天 ⊆ 90 天窗，不再随总历史增长）
    function spendTrend(nowMs, days) {
      const d = days === 30 ? 30 : 7;
      const points = [];
      for (let i = d - 1; i >= 0; i--) {
        const dayStart = new Date(nowMs + 8 * 3600 * 1000);
        dayStart.setUTCDate(dayStart.getUTCDate() - i);
        dayStart.setUTCHours(0, 0, 0, 0);
        const startMs = dayStart.getTime() - 8 * 3600 * 1000;
        const dayKey = beijingDayKey(startMs);
        const label = String(dayStart.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dayStart.getUTCDate()).padStart(2, '0');
        let spend = 0;
        let offpeak = 0;
        const dayBuckets = summariesState.dayBuckets[dayKey] || {};
        for (const account of Object.keys(dayBuckets)) {
          for (const currency of Object.keys(dayBuckets[account])) {
            const bucket = dayBuckets[account][currency];
            spend += bucket.cost;
            offpeak += bucket.costOffpeak;
          }
        }
        points.push({ label: label, spend: Math.round(spend * 1000) / 1000, offpeak: Math.round(offpeak * 1000) / 1000 });
      }
      const cutoff = nowMs - d * MS_PER_DAY;
      const byModel = new Map();
      scanDetailRange(beijingDayStartMs(beijingDayKey(cutoff)), Infinity, function (r) {
        if (r.ts < cutoff) return;
        const c = costOf(r, false);
        if (c == null) return;
        const key = r.model || r.provider;
        byModel.set(key, (byModel.get(key) || 0) + c);
      });
      const byModelList = Array.from(byModel.entries()).map(function (entry) {
        return { model: entry[0], spend: Math.round(entry[1] * 1000) / 1000 };
      }).sort(function (a, b) { return b.spend - a.spend; });
      return { days: d, points: points, byModel: byModelList, now: nowMs };
    }

    // ---------- RPC 路由（webServer HTTP，替代动态沙箱 harness.handle） ----------
    const ROUTE_PREFIX = '/_dsh/dsh-bottom-info-bar';
    const ROUTES = {
      getUpdateInfo: async function () {
        // 版本信息（启动时查一次缓存）+ 本次安装形态对应的更新命令。
        // 命令按安装形态区分，避免把 link: 安装的用户引导到 npm 命令而丢掉本地代码。
        const info = await updateInfoPromise
        return Object.assign({}, info, updateCommandForInstall())
      },
      getBalanceSnapshot: async function (args) {
        const sel = selectionFromArgs(args);
        // force：客户端刚打开/刷新网页时的强制刷新——当场重查服务商，不等 60s 周期缓存
        const force = !!(args && typeof args === 'object' && args.force === true);
        if (selectionIsResolved(sel)) {
          const key = balanceProviderKey(sel.provider);
          if (key) {
            const firstRequest = markBalanceRequested(key);
            // 首次看到某个账户时也要完成一次初始读取；之后仅由 force 或 60s
            // 后台周期刷新。这样冷启动不轮询无关账户，同时首个非 force RPC
            // 不会拿到一个看似“还没请求过”的空快照。
            if (force || firstRequest) await refreshProviderBalance(key, true);
          }
        }
        return activeBalanceSummary(Date.now(), sel);
      },
      getPricing: async function (args) {
        // M5：目录成功后定期刷新；新出现的目录外模型也会按退避重试，
        // 保证模型名/能力与模型切换器一致，未来新模型无需修改插件代码。
        const sel = selectionFromArgs(args);
        const force = !!(args && typeof args === 'object' && args.force === true);
        const llm = llmService();
        if (llm && modelCatalogNeedsRefresh(sel.provider, sel.model, Date.now(), force)) await refreshModelCatalog(sel.provider, force, sel.model);
        if (llm) await refreshModelCapability(sel.provider, sel.model, force);
        return computePricing(Date.now(), sel);
      },
      getEstimate: function (args) {
        return computeEstimate(Date.now(), selectionFromArgs(args));
      },
      getUsageSummary: async function (args) {
        const sessionId = args && typeof args === 'object' ? String(args.sessionId || '') : '';
        return getUsageSummary(Date.now(), sessionId, selectionFromArgs(args));
      },
      exportUsageRecords: function () {
        const exported = allUsageRecordsForExport();
        return {
          version: 1,
          exportedAt: Date.now(),
          recordCount: exported.records.length,
          includesArchived: true,
          archiveReadError: exported.archiveReadError,
          records: exported.records,
        };
      },
      clearUsageRecords: function () {
        if (activeUsageStreams > 0) {
          const err = new Error(t('host.usageLedgerBusy'));
          err.status = 409;
          throw err;
        }
        const exported = allUsageRecordsForExport();
        try {
          // The marker is durable before any old artifact is removed. A host
          // crash after this point therefore fails closed on its next start.
          writeFileAtomic(LEDGER_CLEAR_MARKER_FILE, JSON.stringify({ requestedAt: Date.now() }), t);
        } catch (err) {
          throw new Error(t('host.couldNotClearSpendRecords', { value: String((err && err.message) || err) }));
        }
        let cleanupError = null;
        try {
          clearLedgerArtifacts();
        } catch (err) {
          cleanupError = err;
        }
        resetUsageLedgerState();
        if (cleanupError) {
          ledgerError = { kind: 'clear-failed', message: t('host.couldNotClearSpendRecords', { value: String((cleanupError && cleanupError.message) || cleanupError) }), at: Date.now() };
          console.warn('[dsh-bottom-info-bar] ' + ledgerError.message);
          return { cleared: false, recordCount: exported.records.length, warning: ledgerError.message };
        }
        return { cleared: true, recordCount: exported.records.length, warning: null };
      },
      getSpendTrend: function (args) {
        const days = args && typeof args === 'object' ? Number(args.days) : 7;
        return spendTrend(Date.now(), days);
      },
      getConfig: function () {
        return { displayMode: config.displayMode, infoDensity: config.infoDensity, alertThreshold: config.alertThreshold };
      },
      getBillingMode: function (args) {
        // 纯本地计算：优先使用客户端已订阅的当前会话模型，避免把另一个会话的
        // process-wide default 错显示到这里。
        const sel = selectionFromArgs(args);
        if (!selectionIsResolved(sel)) return { mode: 'unknown', provider: '', model: '', reason: sel.reason || 'selection-unavailable' };
        return Object.assign(detectBillingMode(sel.provider), { model: sel.model });
      },
      getSubscriptionSnapshot: function (args) {
        const force = !!(args && typeof args === 'object' && args.force === true);
        return getSubscriptionSnapshotRpc(selectionFromArgs(args), force);
      },
      // v1.7 FR-14：账单型快照（云账单 provider）
      getBillingStatus: function (args) {
        const force = !!(args && typeof args === 'object' && args.force === true);
        return getBillingSnapshotRpc(selectionFromArgs(args), force);
      },
      setDisplayMode: function (args) {
        const mode = args && typeof args === 'object' ? args.mode : null;
        if (mode === 'extend' || mode === 'replace') config.displayMode = mode;
        return { displayMode: config.displayMode };
      },
      setInfoDensity: function (args) {
        const d = args && typeof args === 'object' ? args.density : null;
        // v1.9.0 PR2：密度从内存态改为落盘持久（重启不再丢）；校验字面保持严格两态
        if (d === 'full' || d === 'compact') {
          if (fieldSettings.infoDensity !== d) {
            fieldSettings.infoDensity = d;
            settingsConfigVersion += 1;
            persistSettings();
          }
          if (config.infoDensity !== d) config.infoDensity = d;
        }
        return { infoDensity: config.infoDensity };
      },
      // ---------- v1.9.0 PR2：字段显隐/颜色配置（白名单校验 + 增量 patch + 原子落盘） ----------
      getFieldConfig: function () {
        return settingsPayload(null);
      },
      setFieldConfig: function (args) {
        const patch = isPlainSettingsObject(args) ? args : null;
        if (!patch || (!Object.hasOwn(patch, 'fields') && !Object.hasOwn(patch, 'colors') && !Object.hasOwn(patch, 'timeFormat') && !Object.hasOwn(patch, 'timeZones') && !Object.hasOwn(patch, 'customText') && !Object.hasOwn(patch, 'customTextValue'))) {
          throw invalidArgument(t('host.patchMustIncludeFieldsOr'));
        }
        // 先整包校验再应用：非法 patch 一个字段都不落，避免半新半旧
        let normalizedFields = null;
        let normalizedColors = null;
        let normalizedTimeFormat = null;
        let normalizedTimeZones = null;
        let normalizedCustomText = null;
        let hasCustomTextPatch = false;
        if (Object.hasOwn(patch, 'fields')) {
          const patchFields = patch.fields;
          if (!isPlainSettingsObject(patchFields)) throw invalidArgument(t('host.fieldsMustBeAnObject'));
          normalizedFields = {};
          for (const key of Object.keys(patchFields)) {
            if (!FIELD_ID_SET.has(key)) throw invalidArgument(t('host.unknownFieldId', { key: key }));
            // D6 用户拍板：锚点字段与其他字段同等可隐藏——白名单只校验 id 合法性，不再对锚点特殊拒绝
            if (typeof patchFields[key] !== 'boolean') throw invalidArgument(t('host.fieldVisibilityMustBeA', { key: key }));
            normalizedFields[key] = patchFields[key];
          }
        }
        if (Object.hasOwn(patch, 'colors')) {
          const patchColors = patch.colors;
          if (!isPlainSettingsObject(patchColors)) throw invalidArgument(t('host.colorsMustBeAnObject'));
          normalizedColors = {};
          for (const key of Object.keys(patchColors)) {
            if (!FIELD_ID_SET.has(key)) throw invalidArgument(t('host.unknownFieldId', { key: key }));
            const value = normalizeColorValue(patchColors[key]);
            if (value === undefined) throw invalidArgument(t('host.colorMustBeAPreset', { key: key }));
            normalizedColors[key] = value;
          }
        }
        if (Object.hasOwn(patch, 'timeFormat')) {
          const tf = patch.timeFormat;
          if (!isPlainSettingsObject(tf)) throw invalidArgument(t('host.timeFormatMustBeAnObject'));
          normalizedTimeFormat = {};
          for (const k of TIME_FORMAT_KEYS) {
            if (!Object.hasOwn(tf, k)) continue
            if (typeof tf[k] !== 'boolean') throw invalidArgument(t('host.timeFieldMustBeABoolean', { key: k }));
            normalizedTimeFormat[k] = tf[k]
          }
          if (Object.keys(normalizedTimeFormat).length === 0) throw invalidArgument(t('host.timeFormatMustBeAnObject'));
        }
        if (Object.hasOwn(patch, 'timeZones')) {
          const tz = patch.timeZones;
          if (!isPlainSettingsObject(tz)) throw invalidArgument(t('host.timeZonesMustBeAnObject'));
          normalizedTimeZones = {};
          if (Object.hasOwn(tz, 'main')) {
            if (!isValidTimeZone(tz.main)) throw invalidArgument(t('host.timeZoneMustBeAValid', { key: 'main' }));
            normalizedTimeZones.main = tz.main
          }
          if (Object.hasOwn(tz, 'world')) {
            if (!isValidTimeZone(tz.world)) throw invalidArgument(t('host.timeZoneMustBeAValid', { key: 'world' }));
            normalizedTimeZones.world = tz.world
          }
          if (Object.keys(normalizedTimeZones).length === 0) throw invalidArgument(t('host.timeZonesMustBeAnObject'));
        }
        const customTextKey = Object.hasOwn(patch, 'customText') ? 'customText' : (Object.hasOwn(patch, 'customTextValue') ? 'customTextValue' : null)
        if (customTextKey) {
          hasCustomTextPatch = true
          const raw = patch[customTextKey]
          const normalized = normalizeCustomTextValue(raw)
          if (normalized === undefined) {
            if (typeof raw !== 'string') throw invalidArgument(t('host.customTextMustBeAString'));
            else throw invalidArgument(t('host.customTextTooLong'));
          }
          normalizedCustomText = normalized
        }
        let changed = false;
        let persistError = null;
        for (const key of Object.keys(normalizedFields || {})) {
          if (fieldSettings.fields[key] !== normalizedFields[key]) {
            fieldSettings.fields[key] = normalizedFields[key];
            changed = true;
          }
        }
        for (const key of Object.keys(normalizedColors || {})) {
          if (fieldSettings.colors[key] !== normalizedColors[key]) {
            fieldSettings.colors[key] = normalizedColors[key];
            changed = true;
          }
        }
        for (const key of Object.keys(normalizedTimeFormat || {})) {
          if (fieldSettings.timeFormat[key] !== normalizedTimeFormat[key]) {
            fieldSettings.timeFormat[key] = normalizedTimeFormat[key];
            changed = true;
          }
        }
        for (const key of Object.keys(normalizedTimeZones || {})) {
          if (fieldSettings.timeZones[key] !== normalizedTimeZones[key]) {
            fieldSettings.timeZones[key] = normalizedTimeZones[key];
            changed = true;
          }
        }
        if (hasCustomTextPatch) {
          if (fieldSettings.customText !== normalizedCustomText) {
            fieldSettings.customText = normalizedCustomText
            changed = true;
          }
        }
        if (changed) {
          settingsConfigVersion += 1;
          persistError = persistSettings();
        }
        return settingsPayload(persistError);
      },
      resetFieldConfig: function () {
        // 只重置标签显隐 + 时间格式/时区/自定义文本；颜色保持不动（两个重置按钮彼此独立）
        const defaults = defaultFieldSettings()
        fieldSettings.fields = shallowSettingsCopy(defaults.fields);
        fieldSettings.timeFormat = { ...defaults.timeFormat }
        fieldSettings.timeZones = { ...defaults.timeZones }
        fieldSettings.customText = defaults.customText
        // 自定义文本重置后为空，开关已为 false，无需额外修正
        settingsConfigVersion += 1;
        const persistError = persistSettings();
        return settingsPayload(persistError);
      },
      resetFieldColors: function () {
        // 只重置颜色为默认（null）；标签显隐保持不动
        fieldSettings.colors = shallowSettingsCopy(defaultFieldSettings().colors);
        settingsConfigVersion += 1;
        const persistError = persistSettings();
        return settingsPayload(persistError);
      },
    };
    // 写操作与会触发宿主网络请求的方法一律要求同源（防跨站驱动宿主写文件/发请求）。
    // 余额快照即使不带 force 也可能命中刷新路径，因此整个端点统一保护。
    const MUTATING = { getBalanceSnapshot: true, setDisplayMode: true, setInfoDensity: true, getSubscriptionSnapshot: true, getBillingStatus: true, setFieldConfig: true, resetFieldConfig: true, resetFieldColors: true, clearUsageRecords: true };
    function invalidArgument(message) {
      const err = new Error(message);
      err.status = 400;
      return err;
    }

    function sameOrigin(req) {
      const fetchSite = req.headers['sec-fetch-site'];
      if (fetchSite === 'cross-site') return false;
      const origin = req.headers.origin;
      if (origin === undefined) return fetchSite === 'same-origin' || fetchSite === 'same-site';
      const host = req.headers.host;
      if (host === undefined) return false;
      try {
        const parsed = new URL(origin);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
      } catch {
        return false;
      }
    }

    function readBody(req, maxBytes) {
      return new Promise(function (resolve, reject) {
        const chunks = [];
        let size = 0;
        req.on('data', function (chunk) {
          size += chunk.length;
          if (size > maxBytes) {
            const err = new Error('body too large');
            err.status = 413;
            reject(err);
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
        req.on('error', reject);
      });
    }

    function respond(res, status, payload) {
      const body = JSON.stringify(payload, t.json);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      res.end(body);
    }

    ctx.inject(['webServer'], function (webCtx) {
      webCtx.effect(function () {
        const dispose = webCtx.webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: async function (req, res) {
            let method = '';
            try {
              const url = new URL(req.url || '/', 'http://localhost');
              const path = url.pathname;
              if (!path.startsWith(ROUTE_PREFIX + '/')) {
                respond(res, 404, { error: 'not found' });
                return;
              }
              method = decodeURIComponent(path.slice(ROUTE_PREFIX.length + 1));
              const fn = Object.hasOwn(ROUTES, method) ? ROUTES[method] : null;
              if (typeof fn !== 'function') {
                respond(res, 404, { error: 'unknown method: ' + method });
                return;
              }
              if (Object.hasOwn(MUTATING, method) && !sameOrigin(req)) {
                respond(res, 403, { error: 'cross-origin request rejected' });
                return;
              }
              let args = {};
              if (req.method === 'POST' || req.method === 'PUT') {
                const raw = await readBody(req, 64 * 1024);
                if (raw.length > 0) {
                  try { args = JSON.parse(raw); } catch (e) { respond(res, 400, { error: 'invalid JSON body' }); return; }
                }
              }
              const result = await fn(args);
              respond(res, 200, result);
            } catch (err) {
              const status = (err && err.status) || 500;
              // 500 属未预期错误，必须留痕：否则线上只剩 "internal error"，无从排查
              // （Issue #67 正是因此难以定位）。只记录方法名、错误信息与堆栈——本接口会接触
              // 凭据，严禁把请求体或凭据内容写进日志。
              if (status === 500) {
                console.warn('[dsh-bottom-info-bar] RPC ' + (method || 'unknown') + ' failed: ' + String((err && err.stack) || err));
              }
              respond(res, status, { error: status === 500 ? 'internal error' : String((err && err.message) || err) });
            }
          },
        });
        return function () { dispose(); };
      }, 'dsh-bottom-info-bar: Web routes');
    });

    // ---------- 启动即刷 + 定时刷新 ----------
    // 价目目录：① 离线兜底（磁盘缓存先同步合并）→ ② 回填 → ③ 异步拉远程增量（成功后再回填一次）
    const cachedPricing = loadPricingCacheFromDisk();
    if (cachedPricing) applyRemotePricingEntries(cachedPricing);
    backfillUnpricedRecords(); // 内置表已覆盖的部分先补算
    if (maybeFoldUsage(Date.now())) scheduleSave(); // 启动折叠超窗明细（在回填之后：刚可计价的记录先补算再折叠，不漏一分钱）
    refreshRemotePricing('启动'); // 网络刷新异步进行；成功后内部会再次触发回填
    ctx.interval(function () { refreshRemotePricing('定时'); }, REMOTE_PRICING_REFRESH_MS);
    refreshAllBalances();
    refreshActiveSubscriptions(); // 惰性：无客户端请求过订阅源则不发起网络请求
    refreshActiveBilling(); // v1.7：账单型同样惰性
    refreshActiveModelCatalog(); // M5：启动即拉一次 DSH 目录名（llm 缺失时静默回退，绝不崩溃）
    ctx.interval(refreshAllBalances, 60000);
    ctx.interval(refreshActiveSubscriptions, 60000);
    ctx.interval(refreshActiveBilling, 60000); // v1.7

    // 卸载时冲刷未落盘的记账记录
    return function () {
      if (dirty || summariesDirty) flushSave();
    };
  },
};
