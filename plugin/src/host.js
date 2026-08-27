// Bottom Info Bar（底部信息栏插件）— host half（静态 bundle 形态）
// 业务：余额真实 API / 峰谷定价 / llm/stream 记账 / 会话聚合 / 显示名识别 / 订阅额度显示
// RPC：webServer HTTP 路由（GET/POST /_dsh/dsh-bottom-info-bar/<method>，JSON 进出，同源防护）
// 依赖：inject ['credentials', 'timer']；可选服务 webServer（ctx.inject 等待）
// 记账持久化：追加账本 + 可恢复快照落盘 ~/.dsh/dsh-bottom-info-bar/（可用环境变量
// DSH_BOTTOM_INFO_BAR_DATA_DIR 覆盖目录），重启/中断后真实累计花费不丢失。
// 订阅额度：本插件只读令牌（~/.codex/auth.json / opencode auth.json）查询额度、仅作显示；
// 令牌的绑定/续期/写回由独立插件 dsh-chatgpt-subscription 维护，本插件不写回、不续期、不注入凭据。
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, writeSync } from 'node:fs'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const DATA_DIR = process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR || join(homedir(), '.dsh', 'dsh-bottom-info-bar')
const DATA_FILE = join(DATA_DIR, 'usage-records.json')
const DATA_BACKUP_FILE = DATA_FILE + '.bak'
const DATA_TEMP_FILE = DATA_FILE + '.tmp'
const DATA_TEMP_PREFIX = DATA_TEMP_FILE + '.'
// The journal is the source of truth.  The JSON file remains a compact,
// human-readable snapshot for backwards compatibility and quick recovery.
const USAGE_JOURNAL_FILE = join(DATA_DIR, 'usage-records.journal.jsonl')
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
// 订阅窗口时长（秒）：5 小时 / 7 天 / 30 天；映射带 5% 容差（接口值可能微调）
const WINDOW_SECONDS = { five_hour: 18000, seven_day: 604800, monthly: 2592000 }
const WINDOW_LABELS = { five_hour: '5 小时', seven_day: '周', monthly: '月' }
// 订阅窗口预警阈值由客户端本判定（剩余 ≤20% → 警示红 + 无框“低”字，见 client 的 LOW_QUOTA_PERCENT）；
// host 仅下发额度/重置数据，不重复判定，故移除原 WINDOW_ALERT_PERCENT=90 的死常量。
const CODEX_PLAN_NAMES = { plus: 'ChatGPT Plus', pro: 'ChatGPT Pro', team: 'ChatGPT Team', enterprise: 'ChatGPT Enterprise' }
const SUBSCRIPTION_REFRESH_MS = 60000 // 订阅额度快照刷新周期（与余额一致）
const SUBSCRIPTION_RETRY_BACKOFF_MS = 60000 // 订阅刷新失败后退避期：期内不重试（减少对未公开 wham 接口的请求 + 避免"刷新失败"提示闪烁）
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

// ---------- 双模式纯逻辑（模式检测 / 窗口映射 / 响应解析；单测直接提取） ----------

// 窗口时长（秒）→ 窗口键：18000≈5小时 / 604800≈7天 / 2592000≈30天，5% 容差；未知返回 null
function codexWindowKey(limitWindowSeconds) {
  if (typeof limitWindowSeconds !== 'number' || !isFinite(limitWindowSeconds)) return null
  for (const key in WINDOW_SECONDS) {
    const target = WINDOW_SECONDS[key]
    if (Math.abs(limitWindowSeconds - target) / target <= 0.05) return key
  }
  return null
}

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
// 模型切换器显示 DSH LLM 目录的 model.name（如 id=deepseek-v4-flash 的 name="DeepSeek-V4-Flash"）。
// 以下两个纯函数只做"缓存优先 → 回退"解析；缓存由 apply 内异步填充（llm.listModels / llm.listProviders）。
// modelDisplay：优先缓存里的 DSH 目录 name；缓存缺失/未知模型回退原始 model id（不做自建美化）
function modelDisplayFromCache(model, provider, cache) {
  if (model && provider && cache) {
    const provMap = cache[provider]
    if (provMap && typeof provMap[model] === 'string' && provMap[model].length > 0) return provMap[model]
  }
  return model || '未知模型'
}
// providerDisplay：优先 DSH 目录 name（llm.listProviders()）；缺失回退静态映射；再回退大写首字母
function providerDisplayFromCache(providerId, cache, staticMap) {
  if (!providerId) return '未知服务商'
  if (cache && typeof cache[providerId] === 'string' && cache[providerId].length > 0) return cache[providerId]
  if (staticMap && staticMap[providerId]) return staticMap[providerId]
  return providerId.charAt(0).toUpperCase() + providerId.slice(1)
}

// 余额制/订阅制/账单制判定：billingMode='auto' 按 provider 检测；'balance'/'subscription' 手动强制覆盖
// v1.7：FR-14 三态互斥——订阅 provider → subscription（额度窗），云账单 provider → billing（本月花费），其余 → balance
function detectBillingMode(providerId, billingMode) {
  if (billingMode === 'balance' || billingMode === 'subscription') {
    return { mode: billingMode, provider: providerId || '', reason: 'manual-override' }
  }
  if (BILLING_PROVIDERS.indexOf(providerId) >= 0) {
    return { mode: 'billing', provider: providerId || '', reason: 'provider:' + (providerId || 'unknown') }
  }
  const sub = SUBSCRIPTION_PROVIDERS.indexOf(providerId) >= 0
  return { mode: sub ? 'subscription' : 'balance', provider: providerId || '', reason: 'provider:' + (providerId || 'unknown') }
}

// wham 响应的 plan_type → 显示名（未收录的 plan 类型按大写首字母兜底）
function planDisplayName(planType) {
  if (typeof planType === 'string' && planType.length > 0) {
    const known = CODEX_PLAN_NAMES[planType]
    if (known) return known
    return 'ChatGPT ' + planType.charAt(0).toUpperCase() + planType.slice(1)
  }
  return 'ChatGPT Plus/Pro'
}

// 解析 Codex wham usage 响应：顶层 rate_limit.primary_window / secondary_window → 统一窗口数组
// （wham 响应无 usage 包装层；结构异常返回 null；窗口缺失 / 未知时长 / 无百分比自动跳过，不报错、不占位）
function parseCodexUsage(body) {
  if (!body || typeof body !== 'object') return null
  const rl = body.rate_limit
  if (!rl || typeof rl !== 'object') return null
  const windows = []
  for (const slot of ['primary_window', 'secondary_window']) {
    const win = rl[slot]
    if (!win || typeof win !== 'object') continue
    const key = codexWindowKey(win.limit_window_seconds)
    if (!key) continue
    const used = win.used_percent
    if (typeof used !== 'number' || !isFinite(used)) continue
    windows.push({
      key: key,
      label: WINDOW_LABELS[key],
      usedPercent: Math.round(used),
      resetsAt: typeof win.reset_at === 'number' && isFinite(win.reset_at) ? win.reset_at * 1000 : null,
    })
  }
  // 同一窗口键去重（primary 优先）；保持出现顺序
  const seen = {}
  const unique = []
  for (const w of windows) {
    if (seen[w.key]) continue
    seen[w.key] = true
    unique.push(w)
  }
  return { plan: planDisplayName(body.plan_type), windows: unique }
}

// OpenCode Go 窗口键（rolling=5小时滚动窗口 / weekly / monthly）
function openCodeGoWindowKey(apiKey) {
  if (apiKey === 'rolling') return 'five_hour'
  if (apiKey === 'weekly') return 'seven_day'
  if (apiKey === 'monthly') return 'monthly'
  return null
}

// 归一化重置时刻：数值（秒或毫秒）→ 毫秒；ISO 字符串 → 毫秒；无法解析 → null
function normalizeResetAt(value) {
  if (typeof value === 'number' && isFinite(value)) return value < 1e12 ? value * 1000 : value
  if (typeof value === 'string') {
    const t = Date.parse(value)
    return isNaN(t) ? null : t
  }
  return null
}

// 解析 OpenCode Go usage 响应：usage.rolling / weekly / monthly → 统一窗口数组
// status 非 'ok' 的窗口跳过（如额度超限 / 接口异常）；结构异常返回 null
function parseOpenCodeGoUsage(body) {
  if (!body || typeof body !== 'object') return null
  const usage = body.usage
  if (!usage || typeof usage !== 'object') return null
  const windows = []
  for (const apiKey of ['rolling', 'weekly', 'monthly']) {
    const win = usage[apiKey]
    if (!win || typeof win !== 'object') continue
    if (win.status !== 'ok') continue
    const percent = win.percent
    if (typeof percent !== 'number' || !isFinite(percent)) continue
    const key = openCodeGoWindowKey(apiKey)
    windows.push({
      key: key,
      label: WINDOW_LABELS[key],
      usedPercent: Math.round(percent),
      resetsAt: normalizeResetAt(win.resetsAt),
    })
  }
  return { plan: 'OpenCode Go', windows: windows }
}

// 快照更新规则（"失败保留旧快照"的纯函数形态）：失败保留旧 data/fetchedAt 只换 error；成功换 data 并更新 fetchedAt
function mergeSubscriptionResult(prev, result) {
  if (!result || result.error) {
    return {
      data: prev && prev.data ? prev.data : null,
      fetchedAt: prev && prev.fetchedAt ? prev.fetchedAt : null,
      error: result ? result.error : { kind: 'exception', message: '订阅额度请求未知异常' },
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
  const v = typeof percent === 'string' ? parseFloat(percent) : percent
  if (typeof v !== 'number' || !isFinite(v) || v < 0) return null
  const scaled = v <= 1 ? v * 100 : v
  return Math.round(scaled)
}

// 解析 /v1/tokenPlan/usage：data.monthUsage（used/limit/percent）或 items[] 中 month_total_token；
// plan_name → 套餐名；返回统一月度窗口（重置时刻由本地推导：下月 1 日零点）
function parseXiaomiTokenPlanUsage(body) {
  if (!body || typeof body !== 'object') return null
  const data = body.data && typeof body.data === 'object' ? body.data : body
  let used = null
  let limit = null
  let percent = null
  const mu = data.monthUsage
  if (mu && typeof mu === 'object') {
    if (typeof mu.percent === 'number' || typeof mu.percent === 'string') percent = mu.percent
    if (typeof mu.used === 'number' || typeof mu.used === 'string') used = parseFloat(mu.used)
    if (typeof mu.limit === 'number' || typeof mu.limit === 'string') limit = parseFloat(mu.limit)
  }
  if (percent == null && Array.isArray(data.items)) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]
      if (!item || typeof item !== 'object') continue
      if (item.name !== 'month_total_token') continue
      if (typeof item.percent === 'number' || typeof item.percent === 'string') percent = item.percent
      if (typeof item.used === 'number' || typeof item.used === 'string') used = parseFloat(item.used)
      if (typeof item.limit === 'number' || typeof item.limit === 'string') limit = parseFloat(item.limit)
      break
    }
  }
  let usedPercent = xiaomiPercentToUsed(percent)
  if (usedPercent == null && used != null && limit != null && limit > 0) usedPercent = Math.round((used / limit) * 100)
  if (usedPercent == null) return null
  let planName = null
  const maybePlan = data.plan_name != null ? data.plan_name : (body.plan_name != null ? body.plan_name : (data.planName != null ? data.planName : null))
  if (typeof maybePlan === 'string' && maybePlan.length > 0) planName = maybePlan
  return { plan: planName, windows: [{ key: 'monthly', label: WINDOW_LABELS.monthly, usedPercent: usedPercent, resetsAt: nextMonthStartMs() }] }
}

// 解析 Token Plan /v1/user/balance 的套餐形态：{token_balance, token_limit, plan_name} → 月度额度窗
function parseXiaomiTokenPlanBalance(body) {
  if (!body || typeof body !== 'object') return null
  const data = body.data && typeof body.data === 'object' ? body.data : body
  const tokenBalance = data.token_balance != null ? parseFloat(data.token_balance) : NaN
  const tokenLimit = data.token_limit != null ? parseFloat(data.token_limit) : NaN
  if (!Number.isFinite(tokenLimit) || tokenLimit <= 0 || !Number.isFinite(tokenBalance)) return null
  const usedPercent = xiaomiPercentToUsed(Math.max(0, Math.min(1, (tokenLimit - tokenBalance) / tokenLimit)))
  let planName = null
  const maybePlan = data.plan_name != null ? data.plan_name : (body.plan_name != null ? body.plan_name : null)
  if (typeof maybePlan === 'string' && maybePlan.length > 0) planName = maybePlan
  return { plan: planName, windows: [{ key: 'monthly', label: WINDOW_LABELS.monthly, usedPercent: usedPercent, resetsAt: nextMonthStartMs() }] }
}

// 解析按量 /v1/user/balance：{data:{balance, charge_balance, granted_balance, plan}}（balance 为字符串）
function parseXiaomiPaygBalance(body) {
  if (!body || typeof body !== 'object') return null
  const data = body.data && typeof body.data === 'object' ? body.data : body
  const total = data.balance != null ? parseFloat(data.balance) : NaN
  if (!Number.isFinite(total)) return null
  return {
    currency: 'CNY',
    total: total,
    granted: data.granted_balance != null ? parseFloat(data.granted_balance) || 0 : 0,
    toppedUp: data.charge_balance != null ? parseFloat(data.charge_balance) || 0 : 0,
    plan: data.plan != null ? data.plan : null,
  }
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
      if (u && typeof u === 'object' && typeof u.cost === 'number' && isFinite(u.cost)) spend = (spend || 0) + u.cost
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
      if (item && typeof item === 'object' && typeof item.totalCost === 'number' && isFinite(item.totalCost)) spend = (spend || 0) + item.totalCost
    }
  }
  if (spend == null && Array.isArray(body.usageBuckets)) {
    for (let i = 0; i < body.usageBuckets.length; i++) {
      const b = body.usageBuckets[i]
      if (b && typeof b === 'object' && typeof b.cost === 'number' && isFinite(b.cost)) spend = (spend || 0) + b.cost
    }
  }
  return spend
}

// 解析 billingUsage（无金额时按 token 用量展示）：数值数组求和，字段名容错
function parseFireworksUsage(body) {
  if (!body || typeof body !== 'object') return null
  let total = null
  let hasToken = false
  const buckets = Array.isArray(body.usageBuckets) ? body.usageBuckets : (Array.isArray(body.buckets) ? body.buckets : [])
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]
    if (!b || typeof b !== 'object') continue
    for (const key of ['totalTokens', 'tokens', 'inputTokens', 'outputTokens']) {
      const v = b[key]
      if (typeof v === 'number' && isFinite(v)) { total = (total || 0) + v; hasToken = true }
    }
  }
  if (total == null && hasToken === false) {
    for (const key of ['totalTokens', 'tokens', 'inputTokens', 'outputTokens']) {
      const v = body[key]
      if (typeof v === 'number' && isFinite(v)) { total = (total || 0) + v; hasToken = true }
    }
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
  const amount = total && total.UnblendedCost && parseFloat(total.UnblendedCost.Amount)
  if (Number.isFinite(amount)) return amount
  const alt = total && total.NetUnblendedCost && parseFloat(total.NetUnblendedCost.Amount)
  return Number.isFinite(alt) ? alt : null
}

// 解析 Budgets GetBudgets：首笔预算 actualSpend / budgetLimit → 预算使用百分比（0-100 整数）
function parseBedrockBudget(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.Budgets) || json.Budgets.length === 0) return null
  const budget = json.Budgets[0]
  if (!budget || typeof budget !== 'object') return null
  const limit = budget.BudgetLimit && parseFloat(budget.BudgetLimit.Amount)
  const spend = budget.CalculatedSpend && budget.CalculatedSpend.ActualSpend && parseFloat(budget.CalculatedSpend.ActualSpend.Amount)
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(spend)) return null
  return Math.round((spend / limit) * 100)
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
    if (typeof item.cost === 'number' && isFinite(item.cost)) { spend = (spend || 0) + item.cost; sawAny = true }
    if (typeof item.usage === 'number' && isFinite(item.usage)) { usage = (usage || 0) + item.usage; sawAny = true }
    if (!usageUnit && typeof item.unit === 'string' && item.unit.length > 0) usageUnit = item.unit
    // 免费额度：仅当同一条目显式给出已用 + 上限时推导（零点重置为 UTC 午夜，本地推导并注明）
    const usedVal = typeof item.used === 'number' ? item.used : (typeof item.usage === 'number' ? item.usage : null)
    const limitVal = typeof item.limit === 'number' ? item.limit : (typeof item.allowance === 'number' ? item.allowance : null)
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
  const base = { currency: raw && typeof raw.currency === 'string' && raw.currency.length > 0 ? raw.currency : (fallbackCurrency || 'USD') }
  if (kind === 'billing') {
    if (raw && Number.isFinite(raw.spend)) base.currentPeriodSpend = raw.spend
    if (raw && Number.isFinite(raw.budgetPercent)) base.budgetPercent = raw.budgetPercent
    if (raw && Number.isFinite(raw.usage)) base.usage = raw.usage
    if (raw && typeof raw.usageUnit === 'string' && raw.usageUnit.length > 0) base.usageUnit = raw.usageUnit
    if (raw && Number.isFinite(raw.freeRemaining)) base.freeRemaining = raw.freeRemaining
    if (raw && Number.isFinite(raw.resetsAt)) base.resetsAt = raw.resetsAt
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
  if (normalized.status !== 'completed' && normalized.status !== 'interrupted') normalized.status = 'completed'
  if (normalized.pricingStatus !== 'priced' && normalized.pricingStatus !== 'unpriced') {
    normalized.pricingStatus = Number.isFinite(normalized.cost) && normalized.cost >= 0 ? 'priced' : 'unpriced'
  }
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

function loadUsageRecords() {
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
  try {
    if (existsSync(USAGE_JOURNAL_FILE)) {
      readFileSync(USAGE_JOURNAL_FILE, 'utf8').split('\n').forEach(function (line, index) {
        if (!line.trim()) return
        try { add(JSON.parse(line), index, 'journal') } catch (err) { /* skip only the corrupt line */ }
      })
    }
  } catch (err) { /* snapshot is still a safe recovery source */ }
  return { records: records.sort(function (a, b) { return a.ts - b.ts }), migratedLegacyRecord: migratedLegacyRecord }
}

export default {
  inject: ['credentials', 'timer'],
  apply(ctx) {
    // 版本检查只在 host 进程启动时发起一次；客户端后续只读取这个缓存结果。
    const updateInfoPromise = checkLatestVersion()

    // ---------- 定价表（元/美元 · 百万 tokens；来源与人工复核规则见 docs/PRICING-SOURCES.md） ----------
    const PRICING = {
      'deepseek-v4-flash': {
        currency: 'CNY', mode: 'peak-valley',
        peak:   { inputCacheHit: 0.10, inputCacheMiss: 3.0, output: 9.0 },
        offpeak:{ inputCacheHit: 0.05, inputCacheMiss: 1.5, output: 4.5 },
      },
      // 官方价格页已单列视觉实验模型，当前各档价格与 V4 Flash 相同；保留独立条目以便后续独立调价。
      'deepseek-v4-flash-vision-exp': {
        currency: 'CNY', mode: 'peak-valley',
        peak:   { inputCacheHit: 0.10, inputCacheMiss: 3.0, output: 9.0 },
        offpeak:{ inputCacheHit: 0.05, inputCacheMiss: 1.5, output: 4.5 },
      },
      'deepseek-v4-pro': {
        currency: 'CNY', mode: 'peak-valley',
        peak:   { inputCacheHit: 0.30, inputCacheMiss: 9.0, output: 27.0 },
        offpeak:{ inputCacheHit: 0.15, inputCacheMiss: 4.5, output: 13.5 },
      },
      'deepseek-chat': { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.5, inputCacheMiss: 2.0, output: 8.0 } },
      'gpt-4o':        { currency: 'USD', mode: 'flat', price: { inputCacheHit: 1.25, inputCacheMiss: 2.5, output: 10.0 } },
      'gpt-4o-mini':   { currency: 'USD', mode: 'flat', price: { inputCacheHit: 0.15, inputCacheMiss: 0.15, output: 0.6 } },
    };
    function modelCurrency(model) {
      const entry = PRICING[model];
      if (entry && entry.currency) return entry.currency;
      return model && model.indexOf('gpt') === 0 ? 'USD' : 'CNY';
    }
    const DEFAULT_MODEL = 'deepseek-v4-flash';
    const SCENARIOS = [
      { id: 'qa',       label: '日常问答',            outputK: 2,   inputK: 4 },
      { id: 'coding',   label: '中等编码任务',        outputK: 15,  inputK: 30 },
      { id: 'doc',      label: '长文档分析/代码审查', outputK: 40,  inputK: 120 },
      { id: 'refactor', label: '大工程重构（多轮）',  outputK: 150, inputK: 500 },
      { id: 'subagent', label: '子代理工作流',        outputK: 300, inputK: 1000 },
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
          let cny = null;
          for (let i = 0; i < list.length; i++) {
            if (list[i].currency === 'CNY') { cny = list[i]; break; }
          }
          const rec = cny || list[0];
          if (!rec) return null;
          return {
            currency: rec.currency || 'CNY',
            total: parseFloat(rec.total_balance) || 0,
            granted: parseFloat(rec.granted_balance) || 0,
            toppedUp: parseFloat(rec.topped_up_balance) || 0,
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
          // 找 CNY 或第一条
          let cny = null;
          for (let i = 0; i < list.length; i++) {
            if (list[i].currency === 'CNY') { cny = list[i]; break; }
          }
          const rec = cny || list[0];
          if (!rec) return null;
          return {
            currency: rec.currency || 'CNY',
            total: parseFloat(rec.total_balance) || 0,
            granted: parseFloat(rec.granted_balance) || 0,
            toppedUp: parseFloat(rec.topped_up_balance) || 0,
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
          if (!data || typeof data.credits !== 'number') return null;
          return {
            currency: 'USD',
            total: data.credits,
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
          const balance = body.balance;
          if (typeof balance !== 'number' || !isFinite(balance)) return null;
          return {
            currency: body.currency || 'CNY',
            total: balance,
            granted: 0,
            toppedUp: 0,
            type: body.type || null,
            totalCashBalance: body.total_cash_balance || null,
            totalVoucherBalance: body.total_voucher_balance || null,
          };
        },
      },
      // v1.7 FR-9：xiaomi（MiMo 按量）余额适配器——B 级半公开端点，Bearer API Key 零设置
      xiaomi: {
        id: 'xiaomi', displayName: '小米 MiMo', credential: 'XIAOMI_API_KEY',
        balanceAPI: 'https://api.xiaomimimo.com/v1/user/balance',
        estimate: false,
        parseBalance: parseXiaomiPaygBalance,
      },
    };

    // ---------- 配置（内存态） ----------
    let config = {
      displayMode: 'replace',
      infoDensity: 'full', // 'full' 完整 | 'compact' 简洁
      activeProvider: 'deepseek',
      alertThreshold: ALERT_THRESHOLD,
      billingMode: 'auto', // 'auto' 按 provider 检测余额/订阅 | 'balance'/'subscription' 手动强制覆盖
    };

    // ---------- 余额快照（60s 定时刷新；失败保留上次快照） ----------
    let balances = {}; // { [providerId]: { data, fetchedAt, error } }

    // v1.6：记录归属账户（用于花费分账）；null 表示"无主记录"，不参与任何账户汇总
    function recordAccount(r) {
      return accountForProvider(r.provider);
    }

    // v1.6：providerSpend 改为按 recordAccount === pid 过滤（修复 deepseek-official 记录不计入 deepseek 的旧问题）
    function providerSpend(providerId) {
      let total = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        if (accountForProvider(r.provider) !== providerId) continue;
        const c = costOf(r, false);
        if (c != null) total += c;
      }
      return total;
    }

    const balanceSeq = {}; // 每 provider 刷新序号：仅最新一次请求可写入快照，防慢请求覆盖新数据

    function refreshProviderBalance(pid) {
      const prov = PROVIDERS[pid];
      if (!prov) return;
      const seq = (balanceSeq[pid] || 0) + 1;
      balanceSeq[pid] = seq;
      if (!prov.balanceAPI) {
        // 记账回退：估算余额 = 起始充值额 - 累计花费
        const spend = providerSpend(pid);
        const total = Math.max(0, prov.initialTopUp - spend);
        balances[pid] = { data: { currency: 'USD', total: total, granted: 0, toppedUp: prov.initialTopUp }, fetchedAt: Date.now(), error: null };
        return;
      }
      (async function () {
        let cred = null;
        try {
          cred = await ctx.credentials.resolve(prov.credential);
        } catch (err) {
          // 与下方 http/parse/exception 分支一致：失败保留旧 data/fetchedAt，仅换 error；seq guard 防慢请求覆盖新快照
          if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'credentials', message: '凭据读取失败' } };
          return;
        }
        if (!cred || !cred.value) {
          // no-key 同样保留旧快照：一次瞬断/未配置不把好数据清空（客户端据 error 显示配置引导/警示）
          if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'no-key', message: '未配置 ' + prov.credential } };
          return;
        }
        try {
          // API Key 经 HTTP 头传递，不进子进程命令行（避免 ps 可见 / shell 注入）
          const res = await fetch(prov.balanceAPI, {
            headers: { Authorization: 'Bearer ' + cred.value },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) {
            if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'http', message: '请求失败（HTTP ' + res.status + '）' } };
            return;
          }
          const body = await res.json();
          const parsed = prov.parseBalance(body);
          if (!parsed) {
            if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'parse', message: '响应格式异常' } };
            return;
          }
          if (balanceSeq[pid] === seq) balances[pid] = { data: parsed, fetchedAt: Date.now(), error: null };
        } catch (err) {
          if (balanceSeq[pid] === seq) balances[pid] = { data: balances[pid] && balances[pid].data, fetchedAt: balances[pid] && balances[pid].fetchedAt, error: { kind: 'exception', message: String((err && err.message) || err) } };
        }
      })();
    }

    function refreshAllBalances() {
      for (const pid in PROVIDERS) refreshProviderBalance(pid);
    }

    // ---------- 订阅额度快照（复用余额模式：周期刷新 / 失败保留旧快照 / seq 防旧覆盖） ----------
    let subscriptions = {}; // { [sourceKey]: { data: {provider,plan,windows}, fetchedAt, error } }
    const subscriptionSeq = {}; // 每 source 刷新序号：仅最新一次请求可写入快照
    const subscriptionInFlight = {}; // { [sourceKey]: Promise } 并发去重（同一时刻只发一个请求）
    const subscriptionRequested = {}; // 仅"客户端请求过"的源进入 60s 周期刷新（余额制下不打扰订阅接口）
    const subscriptionLastFailAt = {}; // { [sourceKey]: ms } 上次订阅刷新失败时刻（失败退避：期内不重试）

    // FR-8 / D7：Codex / ChatGPT 订阅卡（纯本地通道）
    // 只读令牌：令牌由独立插件 dsh-chatgpt-subscription 维护，本插件不续期、不写回、不注入凭据；
    // 读 tokens.id_token 本地解码 JWT claims（chatgpt_plan_type / subscription_active_until）→ 真实套餐名与到期日。
    // 解码/字段缺失 → 静默降级（不显式报错、不调用 wham——wham 保持默认关闭）；
    // 令牌缺失 → no-key（客户端显示"未绑定"引导）。
    async function fetchCodexUsage() {
      const read = readCodexAuthFile(CODEX_AUTH_FILE);
      if (!read.ok) {
        return { error: { kind: 'no-key', message: '未找到 ChatGPT 订阅登录凭证（~/.codex/auth.json），请安装 dsh-chatgpt-subscription 插件绑定' } };
      }
      const tokens = read.auth && read.auth.tokens;
      const idToken = tokens && typeof tokens.id_token === 'string' && tokens.id_token.length > 0 ? tokens.id_token : null;
      if (!idToken) {
        return { error: { kind: 'no-key', message: 'ChatGPT 订阅登录凭证缺少 id_token，请安装 dsh-chatgpt-subscription 插件重新绑定' } };
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
        return { error: { kind: 'no-key', message: '未配置 OpenCode Go（OPENCODE_GO_API_KEY 或 opencode auth.json）' } };
      }
      try {
        const res = await fetch('https://opencode.ai/zen/go/v1/usage', {
          headers: { Authorization: 'Bearer ' + key },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return { error: { kind: 'http', message: '请求失败（HTTP ' + res.status + '）' } };
        const body = await res.json();
        const parsed = parseOpenCodeGoUsage(body);
        if (!parsed) return { error: { kind: 'parse', message: '响应格式异常' } };
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
      try {
        const cred = await ctx.credentials.resolve('ZAI_CODING_CN_API_KEY');
        if (cred && typeof cred.value === 'string' && cred.value.length > 0) return cred.value;
      } catch (err) { /* 回退 */ }
      try {
        const cred = await ctx.credentials.resolve('ZAI_API_KEY');
        if (cred && typeof cred.value === 'string' && cred.value.length > 0) return cred.value;
      } catch (err) { /* 未配置 */ }
      return null;
    }

    function zaiHostForProvider(providerId) {
      if (providerId === 'zai-coding-cn') return 'https://open.bigmodel.cn';
      return 'https://api.z.ai';
    }

    // 解析智谱 quota 响应：data.limits[] 中 type=TOKENS_LIMIT 的窗口
    // unit 映射：已知 3=5小时对应 five_hour；未知 unit/类型跳过
    // level/planName → 套餐名（lite/standard/pro/max → 智谱 + 首字母大写）
    function parseZaiQuota(body) {
      if (!body || typeof body !== 'object') return null;
      const data = body.data;
      if (!data || typeof data !== 'object') return null;
      const limits = Array.isArray(data.limits) ? data.limits : [];
      const windows = [];
      for (let i = 0; i < limits.length; i++) {
        const limit = limits[i];
        if (!limit || typeof limit !== 'object') continue;
        if (limit.type !== 'TOKENS_LIMIT') continue;
        const unit = limit.unit;
        // 已知 unit 码映射
        let key = null;
        if (unit === 3) key = 'five_hour'; // 5小时
        if (!key) continue; // 未知 unit 跳过
        const usedPercent = limit.percentage;
        if (typeof usedPercent !== 'number' || !isFinite(usedPercent)) continue;
        const resetsAt = typeof limit.nextResetTime === 'number' && isFinite(limit.nextResetTime)
          ? limit.nextResetTime
          : (typeof limit.nextResetTime === 'string' ? Date.parse(limit.nextResetTime) : null);
        windows.push({
          key: key,
          label: WINDOW_LABELS[key],
          usedPercent: Math.round(usedPercent),
          resetsAt: isNaN(resetsAt) ? null : resetsAt,
        });
      }
      // 套餐名：level 如 lite/standard/pro/max → 显示 '智谱 ' + 首字母大写
      let planName = null;
      if (typeof data.level === 'string' && data.level.length > 0) {
        const levelMap = { lite: 'Lite', standard: 'Standard', pro: 'Pro', max: 'Max' };
        const mapped = levelMap[data.level.toLowerCase()];
        planName = mapped ? '智谱 ' + mapped : ('智谱 ' + data.level.charAt(0).toUpperCase() + data.level.slice(1));
      } else if (typeof body.planName === 'string' && body.planName.length > 0) {
        planName = body.planName;
      }
      return { plan: planName, windows: windows };
    }

    async function fetchZaiUsage() {
      // 从当前 provider 决定用哪个 host（zai-coding-cn vs zai）
      // 这里通过 subscriptionSourceFor 反推，但实际 RPC 调用时 selection 会传 provider
      // 为简化，先尝试两个 host
      const key = await resolveZaiKey();
      if (!key) {
        return { error: { kind: 'no-key', message: '未配置智谱 API Key（ZAI_CODING_CN_API_KEY 或 ZAI_API_KEY）' } };
      }
      // 尝试两个 host，优先国内
      const hosts = ['https://open.bigmodel.cn', 'https://api.z.ai'];
      for (let i = 0; i < hosts.length; i++) {
        try {
          const res = await fetch(hosts[i] + '/api/monitor/usage/quota/limit', {
            headers: { Authorization: key }, // 裸 API Key，无 Bearer 前缀
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) {
            if (i < hosts.length - 1) continue; // 尝试下一个 host
            return { error: { kind: 'http', message: '请求失败（HTTP ' + res.status + '）' } };
          }
          const body = await res.json();
          const parsed = parseZaiQuota(body);
          if (!parsed) return { error: { kind: 'parse', message: '响应格式异常' } };
          return { data: { provider: 'zai', plan: parsed.plan, windows: parsed.windows } };
        } catch (err) {
          if (i < hosts.length - 1) continue; // 尝试下一个 host
          return { error: { kind: 'exception', message: String((err && err.message) || err) } };
        }
      }
      return { error: { kind: 'exception', message: '所有 host 均失败' } };
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
        return { error: { kind: 'no-key', message: '未配置小米 MiMo Token Plan 凭据（' + credName + ' 或 XIAOMI_API_KEY）' } };
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
          const parsed = i === 0 ? parseXiaomiTokenPlanUsage(body) : parseXiaomiTokenPlanBalance(body);
          if (!parsed) continue; // 响应形态不符 → 尝试下一个端点
          return { data: { provider: 'xiaomi-' + region, plan: parsed.plan, windows: parsed.windows } };
        } catch (err) {
          if (i < endpoints.length - 1) continue;
          return { error: { kind: 'exception', message: String((err && err.message) || err) } };
        }
      }
      return { error: { kind: 'http', message: '请求失败（HTTP ' + (lastStatus || '?') + '）' } };
    }

    // v1.7 FR-10：Together 本月真实账单（USD）。api.together.xyz 为主，api.together.ai 回退（A8 记录确认同源 API）。
    async function fetchTogetherBilling() {
      const key = await resolveCredentialValue('TOGETHER_API_KEY');
      if (!key) return { error: { kind: 'no-key', message: '未配置 TOGETHER_API_KEY' } };
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
            return { error: { kind: 'http', message: '请求失败（HTTP ' + res.status + '）' } };
          }
          const body = await res.json();
          const spend = parseTogetherUsage(body);
          if (spend == null) return { error: { kind: 'parse', message: '响应格式异常' } };
          return { data: { kind: 'billing', spend: Math.round(spend * 100) / 100, currency: 'USD', note: '本月真实账单（Together 官方 Usage API）' } };
        } catch (err) {
          if (i < hosts.length - 1) continue;
          return { error: { kind: 'exception', message: String((err && err.message) || err) } };
        }
      }
      return { error: { kind: 'http', message: '请求失败（HTTP ' + (lastStatus || '?') + '）' } };
    }

    // v1.7 FR-11：Fireworks 本周期真实账单。先 GET /v1/accounts 解析 account_id，
    // 主端点 billing/summary（美元）；404 → 回退 billingUsage（token 用量，无金额时降级展示用量）。
    async function fetchFireworksBilling() {
      const key = await resolveCredentialValue('FIREWORKS_API_KEY');
      if (!key) return { error: { kind: 'no-key', message: '未配置 FIREWORKS_API_KEY' } };
      try {
        const accRes = await fetch('https://api.fireworks.ai/v1/accounts', {
          headers: { Authorization: 'Bearer ' + key },
          signal: AbortSignal.timeout(15000),
        });
        if (!accRes.ok) return { error: { kind: 'http', message: '请求失败（HTTP ' + accRes.status + '）' } };
        const accountId = parseFireworksAccountId(await accRes.json());
        if (!accountId) return { error: { kind: 'parse', message: '账户解析失败（未取得 account_id）' } };
        const summaryRes = await fetch('https://api.fireworks.ai/v1/accounts/' + encodeURIComponent(accountId) + '/billing/summary?granularity=DAILY', {
          headers: { Authorization: 'Bearer ' + key },
          signal: AbortSignal.timeout(15000),
        });
        if (summaryRes.ok) {
          const spend = parseFireworksSummary(await summaryRes.json());
          if (spend == null) return { error: { kind: 'parse', message: '响应格式异常' } };
          return { data: { kind: 'billing', spend: Math.round(spend * 100) / 100, currency: 'USD', note: '本周期真实账单（Fireworks Billing Summary）' } };
        }
        if (summaryRes.status === 404) {
          const usageRes = await fetch('https://api.fireworks.ai/v1/accounts/' + encodeURIComponent(accountId) + '/billingUsage', {
            headers: { Authorization: 'Bearer ' + key },
            signal: AbortSignal.timeout(15000),
          });
          if (usageRes.ok) {
            const usage = parseFireworksUsage(await usageRes.json());
            if (usage != null) return { data: { kind: 'billing', usage: usage, usageUnit: 'tokens', currency: 'USD', note: '本周期真实用量（billingUsage 回退端点，无金额）' } };
            return { error: { kind: 'parse', message: '响应格式异常' } };
          }
          return { error: { kind: 'http', message: '请求失败（HTTP ' + usageRes.status + '）' } };
        }
        return { error: { kind: 'http', message: '请求失败（HTTP ' + summaryRes.status + '）' } };
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
        return { error: { kind: 'no-key', message: '未配置 AWS 凭据（AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY）' } };
      }
      try {
        const now = new Date();
        const nextDay = new Date(now.getTime() + 86400 * 1000);
        const ce = await awsJsonPost('ce.us-east-1.amazonaws.com', 'ce', 'us-east-1', 'AWSInsightsIndexService.GetCostAndUsage', {
          TimePeriod: { Start: awsDateKey(now), End: awsDateKey(nextDay) },
          Granularity: 'MONTHLY',
          Filter: { Dimensions: { Key: 'SERVICE', Values: ['Amazon Bedrock'] } },
        }, aws);
        if (!ce.ok) return { error: { kind: 'http', message: '请求失败（HTTP ' + ce.status + '）——可能缺少 ce:GetCostAndUsage 权限' } };
        const spend = parseBedrockCost(ce.json);
        if (spend == null) return { error: { kind: 'parse', message: '响应格式异常' } };
        let budgetPercent = null;
        try { budgetPercent = await fetchBedrockBudget(aws); } catch (err) { budgetPercent = null; } // 预算失败静默
        return { data: { kind: 'billing', spend: Math.round(spend * 100) / 100, budgetPercent: budgetPercent, currency: 'USD', note: 'AWS Cost Explorer 本月真实账单（账单延迟约 24 小时）' } };
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
      if (!key) return { error: { kind: 'no-key', message: '未配置 CLOUDFLARE_API_KEY（需账号级 Token 并授予 Billing 读权限）' } };
      const accountId = await resolveCredentialValue('CLOUDFLARE_ACCOUNT_ID');
      if (!accountId) return { error: { kind: 'no-key', message: '未配置 CLOUDFLARE_ACCOUNT_ID' } };
      try {
        const res = await fetch('https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) + '/billing/usage/paygo', {
          headers: { Authorization: 'Bearer ' + key },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return { error: { kind: 'http', message: '请求失败（HTTP ' + res.status + '）——Token 需 Billing 读权限' } };
        const parsed = parseCloudflareBilling(await res.json());
        if (!parsed) return { error: { kind: 'parse', message: '响应格式异常' } };
        return { data: Object.assign({ kind: 'billing', currency: 'USD', note: 'Cloudflare Billable Usage API（Alpha），本月真实用量' }, parsed) };
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
    function kickSubscriptionRefresh(sourceKey) {
      const src = SUBSCRIPTION_SOURCES[sourceKey];
      if (!src) return Promise.resolve();
      if (subscriptionInFlight[sourceKey]) return subscriptionInFlight[sourceKey];
      const seq = (subscriptionSeq[sourceKey] || 0) + 1;
      subscriptionSeq[sourceKey] = seq;
      subscriptionInFlight[sourceKey] = src.fetch().then(function (result) {
        if (subscriptionSeq[sourceKey] === seq) {
          subscriptions[sourceKey] = mergeSubscriptionResult(subscriptions[sourceKey], result);
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
        kickSubscriptionRefresh(sourceKey);
      }
    }

    // ---------- v1.7 FR-10~13：账单快照（云账单型；与订阅/余额快照完全隔离，同一套策略） ----------
    const BILLING_REFRESH_MS = 60000;
    const BILLING_RETRY_BACKOFF_MS = 60000;
    let billingSnapshots = {}; // { [key]: { data, fetchedAt, error } }
    const billingSeq = {};
    const billingInFlight = {};
    const billingRequested = {};
    const billingLastFailAt = {};

    function mergeBillingResult(prev, result) {
      if (!result || result.error) {
        return {
          data: prev && prev.data ? prev.data : null,
          fetchedAt: prev && prev.fetchedAt ? prev.fetchedAt : null,
          error: result ? result.error : { kind: 'exception', message: '账单请求未知异常' },
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
    async function getSubscriptionSnapshotRpc(selection) {
      const sel = selection || modelSelection();
      const bm = detectBillingMode(sel.provider, config.billingMode);
      const out = { mode: bm.mode, provider: sel.provider, reason: bm.reason, source: null, plan: null, planType: null, expiryAt: null, windows: [], fetchedAt: null, error: null };
      if (bm.mode !== 'subscription') return out;
      const sourceKey = subscriptionSourceFor(sel.provider);
      if (!sourceKey) return out;
      out.source = sourceKey;
      subscriptionRequested[sourceKey] = true; // 该源进入 60s 周期刷新
      const snap = subscriptions[sourceKey] || { data: null, fetchedAt: null, error: null };
      const nowMs = Date.now();
      const lastFailAt = subscriptionLastFailAt[sourceKey] || 0;
      // 失败退避：快照过期（>60s 无成功）且距上次失败 ≥ 退避期（60s）才重试——
      // 减少对未公开 wham 接口的请求，也避免"刷新失败"提示随每次轮询反复闪烁（失败期内直接读缓存快照）
      const stale = (!snap.fetchedAt || (nowMs - snap.fetchedAt) > SUBSCRIPTION_REFRESH_MS)
        && (nowMs - lastFailAt) >= SUBSCRIPTION_RETRY_BACKOFF_MS;
      if (stale) {
        const inflight = kickSubscriptionRefresh(sourceKey);
        // 从未成功过（无旧数据）→ 等本次刷新返回最新结果（含错误），避免退避重试后仍返回旧失败快照；
        // 已有旧数据 → 后台刷新，本次直接返回快照（不阻塞轮询）
        if (!snap.data) await inflight;
      }
      const cur = subscriptions[sourceKey] || { data: null, fetchedAt: null, error: null };
      if (cur.data) {
        out.plan = cur.data.plan;
        out.windows = cur.data.windows;
        out.planType = cur.data.planType;
        out.expiryAt = cur.data.expiryAt;
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

    async function getBillingSnapshotRpc(selection) {
      const sel = selection || modelSelection();
      const bm = detectBillingMode(sel.provider, config.billingMode);
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
      if (stale) {
        const inflight = kickBillingRefresh(key);
        if (!snap.data) await inflight;
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
      const svc = ctx.get('agentDefaultModel');
      let fallback = false;
      let provider = '';
      let model = DEFAULT_MODEL;
      if (svc && typeof svc.currentSelection === 'function') {
        try {
          const s = svc.currentSelection();
          if (s && typeof s.model === 'string' && s.model.length > 0) {
            provider = typeof s.provider === 'string' ? s.provider : '';
            model = s.model;
          } else {
            fallback = true;
          }
        } catch (err) {
          fallback = true;
        }
      } else {
        fallback = true;
      }
      return { provider: provider, model: model, fallback: fallback };
    }

    // Web client may supply the model selection owned by its currently active
    // session.  `agentDefaultModel` is deliberately process-wide and only a
    // default for new Agents, so it must never win over a valid session value.
    // Treat this HTTP input as display/accounting context only: reject malformed
    // values and fall back to the host default rather than letting bad input
    // reach any model or credential operation.
    function selectionFromArgs(args) {
      const raw = args && typeof args === 'object' ? args.selection : null;
      if (raw && typeof raw.provider === 'string' && raw.provider.length > 0
          && typeof raw.model === 'string' && raw.model.length > 0) {
        return { provider: raw.provider, model: raw.model, fallback: false };
      }
      return modelSelection();
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
      xiaomi: '小米 MiMo',
      'xiaomi-token-plan-cn': '小米 MiMo',
      'xiaomi-token-plan-sgp': '小米 MiMo',
      'xiaomi-token-plan-ams': '小米 MiMo',
      together: 'Together',
      fireworks: 'Fireworks',
      'amazon-bedrock': 'AWS Bedrock',
      'cloudflare-ai-gateway': 'Cloudflare',
      'cloudflare-workers-ai': 'Cloudflare',
    };

    // ---------- DSH 模型/服务商目录名与能力缓存（M5：与模型切换器完全一致） ----------
    // llm.listModels(provider) → DSH LLM 目录 { id, name, inputModalities? }；
    // llm.resolveModelInfo(provider, model) → 当前模型的完整目录信息。
    // 缓存异步填充：启动即刷 + llm/adapters-updated 事件刷新 + getPricing 首次缺缓存时按需等待；
    // llm 服务缺失/查询失败保留旧缓存（stale 可接受），展示层回退原始 id / 静态映射，绝不崩溃。
    let modelNameCache = {};    // { provider: { modelId: name } }
    let providerNameCache = {}; // { provider: name }
    let modelCatalogRefreshed = {}; // { provider: true } 已尝试刷新（防 getPricing 反复打目录）
    let modelImageInputCache = {}; // { provider: { modelId: boolean } }；仅 DSH 明确声明 image 才为 true
    let modelCapabilityRefreshed = {}; // { provider + '\u0000' + model: true } 已尝试读取完整模型能力

    function modelAcceptsImageInput(info) {
      return !!(info && Array.isArray(info.inputModalities) && info.inputModalities.indexOf('image') !== -1);
    }

    async function refreshModelCatalog(provider) {
      const llm = ctx.get ? ctx.get('llm') : null;
      if (!llm || typeof llm.listModels !== 'function' || !provider) return;
      try {
        const models = await llm.listModels(provider);
        const map = {};
        const imageInputMap = {};
        if (Array.isArray(models)) {
          for (let i = 0; i < models.length; i++) {
            const m = models[i];
            if (m && typeof m.id === 'string' && m.id.length > 0) {
              if (typeof m.name === 'string' && m.name.length > 0) map[m.id] = m.name;
              imageInputMap[m.id] = modelAcceptsImageInput(m);
            }
          }
        }
        modelNameCache[provider] = map;
        modelImageInputCache[provider] = imageInputMap;
      } catch (err) { /* 目录查询失败保留旧缓存，绝不崩溃 */ }
      try {
        const provs = typeof llm.listProviders === 'function' ? await llm.listProviders() : null;
        if (Array.isArray(provs)) {
          for (let i = 0; i < provs.length; i++) {
            const p = provs[i];
            if (p && typeof p.id === 'string' && p.id.length > 0 && typeof p.name === 'string' && p.name.length > 0) providerNameCache[p.id] = p.name;
          }
        }
      } catch (err) { /* 同上 */ }
      modelCatalogRefreshed[provider] = true;
    }

    // listModels 只提供目录概要时，按当前选中模型读取完整能力；失败或未知时不显示标识，
    // 避免通过模型名称猜测造成错误标注。每个 provider/model 组合只读取一次，适配器更新后再读。
    async function refreshModelCapability(provider, model) {
      const cacheKey = provider + '\u0000' + model;
      if (!provider || !model || modelCapabilityRefreshed[cacheKey]) return;
      const llm = ctx.get ? ctx.get('llm') : null;
      if (!llm || typeof llm.resolveModelInfo !== 'function') {
        modelCapabilityRefreshed[cacheKey] = true;
        return;
      }
      try {
        const info = await llm.resolveModelInfo(provider, model);
        const providerMap = modelImageInputCache[provider] || {};
        providerMap[model] = modelAcceptsImageInput(info);
        modelImageInputCache[provider] = providerMap;
      } catch (err) { /* 能力查询失败视为未知，不影响信息栏其余内容 */ }
      modelCapabilityRefreshed[cacheKey] = true;
    }

    // 刷新当前激活 provider 的目录名缓存（启动 / llm/adapters-updated / 切模型后按需调用）
    function refreshActiveModelCatalog() {
      const sel = modelSelection();
      return refreshModelCatalog(sel.provider).then(function () {
        return refreshModelCapability(sel.provider, sel.model);
      });
    }

    // ---------- 定价计算 ----------
    function computePricing(nowMs, selection) {
      const sel = selection || modelSelection();
      const entry = PRICING[sel.model];
      const period = entry && entry.mode === 'peak-valley' ? currentPeriod(nowMs) : 'flat';
      let prices = null;
      if (entry) {
        prices = entry.mode === 'peak-valley' ? entry[period] : entry.price;
      }
      const switchInfo = entry && entry.mode === 'peak-valley' ? nextPeriodLabel(nowMs) : null;
      return {
        model: sel.model,
        provider: sel.provider,
        providerDisplay: providerDisplayFromCache(sel.provider, providerNameCache, PROVIDER_DISPLAY),
        modelDisplay: modelDisplayFromCache(sel.model, sel.provider, modelNameCache),
        acceptsImageInput: !!(modelImageInputCache[sel.provider] && modelImageInputCache[sel.provider][sel.model]),
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
    // 已知映射返回对应账户；未知返回 null（不再回退 config.activeProvider，修复 Bug 2）。
    // 目的：余额/币种跟随"活跃模型的服务商"，避免 OpenAI 模型激活时仍显示 DeepSeek ¥ 余额与 ¥0 花费。
    function balanceProviderKey(pid) {
      if (!pid) return null;
      const acct = accountForProvider(pid);
      if (acct !== null) return acct;
      // 订阅源账户不走余额制，直接返回 null
      if (subscriptionSourceFor(pid)) return null;
      return null;
    }

    function activeBalanceSummary(providerId, nowMs) {
      // 默认跟随活跃模型的服务商（而非恒 deepseek）；显式 providerId（RPC 传参）优先
      const pid = balanceProviderKey(providerId || modelSelection().provider || config.activeProvider);
      // v1.6 T7：未知账户返回 unmapped=true，客户端渲染"未适配"引导
      if (pid === null) {
        return { provider: null, displayName: '未适配', unmapped: true, data: null, fetchedAt: null, error: null, alert: null, now: nowMs };
      }
      const prov = PROVIDERS[pid] || PROVIDERS.deepseek;
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
        currency: snap.data ? snap.data.currency : (prov.id === 'deepseek' ? 'CNY' : 'USD'),
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

    function writeAndSync(filePath, content, flags) {
      let fd = null;
      try {
        fd = openSync(filePath, flags, 0o600);
        const bytes = Buffer.from(content);
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(fd, bytes, offset, bytes.length - offset);
          if (!written) throw new Error('账单文件写入未完成');
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
        if (ledgerError && ledgerError.kind === 'snapshot-stale') ledgerError = null;
      } catch (err) {
        // The journal remains authoritative, but tell the user that the
        // directly readable snapshot has not caught up yet.
        ledgerError = { kind: 'snapshot-stale', message: String((err && err.message) || err), at: Date.now() };
        console.warn('[dsh-bottom-info-bar] 记账快照落盘失败', ledgerError.message);
      }
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
      // Freeze the actual price at usage time.  Historical totals must not
      // change merely because the plugin's reference price table is updated.
      const billed = costOf(rec, false);
      if (billed != null) {
        rec.currency = modelCurrency(rec.model);
        rec.cost = billed;
        rec.pricingStatus = 'priced';
        rec.pricingVersion = 'builtin-' + packageVersion();
      } else {
        rec.pricingStatus = 'unpriced';
        rec.pricingVersion = null;
      }
      const writeError = appendUsageJournal(rec);
      if (writeError) {
        ledgerError = writeError;
        console.warn('[dsh-bottom-info-bar] 记账日志追加失败', writeError.message);
        return false;
      }
      usageRecords.push(rec);
      ledgerError = null;
      scheduleSave();
      return true;
    }

    ctx.on('llm/stream', async function* (options, next) {
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
    });

    // M5：适配器/目录变更（模型增删、provider 改名）→ 重建目录名缓存，信息栏模型名与切换器保持一致
    ctx.on('llm/adapters-updated', function () {
      modelCatalogRefreshed = {};
      modelCapabilityRefreshed = {};
      refreshActiveModelCatalog();
    });

    // ---------- 花费计算 ----------
    function costOf(record, forceOffpeak) {
      // v2 ledger records carry the charge as observed.  Use it for normal
      // reporting; only the "all-offpeak" forecast intentionally recalculates.
      if (!forceOffpeak && Number.isFinite(record.cost) && record.cost >= 0) return record.cost;
      const entry = PRICING[record.model];
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
      return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
    }

    // v1.6：sessionTotals 增加账户维度参数——本对话统计只聚合当前账户记录
    function sessionTotals(activeAccount) {
      const map = new Map();
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        // v1.6：账户过滤——只聚合匹配当前活跃账户的记录
        if (activeAccount !== undefined && activeAccount !== null && recordAccount(r) !== activeAccount) continue;
        const key = r.sessionId || (r.provider + '/' + r.model + '#' + r.ts);
        let s = map.get(key);
        if (!s) {
          s = { sessionId: r.sessionId, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costs: {}, lastTs: r.ts };
          map.set(key, s);
        }
        s.input += r.input;
        s.cacheRead += r.cacheRead;
        s.cacheWrite += r.cacheWrite;
        s.output += r.output;
        const c = costOf(r, false);
        if (c != null) {
          const cur = recordCurrency(r);
          s.costs[cur] = (s.costs[cur] || 0) + c;
        }
        if (r.ts > s.lastTs) s.lastTs = r.ts;
      }
      return Array.from(map.values()).sort(function (a, b) { return a.lastTs - b.lastTs; });
    }

    function calibrationFrom(sessions, n) {
      if (!sessions || sessions.length === 0) return null;
      const recent = sessions.slice(-n);
      const count = recent.length;
      return {
        count: count,
        label: '基于你最近 ' + count + ' 次会话',
        medianInput: median(recent.map(function (s) { return s.input; })),
        medianCacheRead: median(recent.map(function (s) { return s.cacheRead; })),
        medianCacheWrite: median(recent.map(function (s) { return s.cacheWrite; })),
        medianOutput: median(recent.map(function (s) { return s.output; })),
      };
    }

    // 会话 ID 归一化：DSH 部分路径会给 sessionId 加 'session-' 前缀，去掉后统一比较
    function normalizeSessionId(id) {
      if (!id) return '';
      return String(id).replace(/^session-/, '');
    }

    // v1.7（发布前微调）：本会话聚合含子代理花费——从"按 sessionId 精确匹配"改为
    // "会话起点 = 当前 sessionId 的最早记录时间戳；聚合同账户（recordAccount === activeAccount）
    //  且 ts >= 会话起点的全部记录"——子代理/同账户不同 sessionId 的并行记录自然被纳入。
    // 未知账户（activeAccount=null）时匹配无主记录（recordAccount 同为 null），绝不混入其他账户。
    function currentSessionSummary(usageRecords, activeAccount, sessionId) {
      if (!usageRecords || usageRecords.length === 0) return null;
      if (!sessionId) return null; // 无可用会话 ID：不猜测归属，客户端显示 ¥0.000，而非回退最近会话
      const norm = normalizeSessionId(sessionId);
      let sessionStart = null;
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        if (normalizeSessionId(r.sessionId) !== norm) continue;
        if (sessionStart === null || r.ts < sessionStart) sessionStart = r.ts;
      }
      if (sessionStart === null) return null; // 明确传入但未命中（新会话尚无记账）→ 客户端显示 ¥0.000
      const acc = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costs: {} };
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        if (r.ts < sessionStart) continue;
        if (recordAccount(r) !== activeAccount) continue; // 只聚合当前账户（含无主 null 账户匹配）
        acc.input += r.input;
        acc.cacheRead += r.cacheRead;
        acc.cacheWrite += r.cacheWrite;
        acc.output += r.output;
        const c = costOf(r, false);
        if (c != null) {
          const cur = recordCurrency(r);
          acc.costs[cur] = (acc.costs[cur] || 0) + c;
        }
      }
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
      // 余额快照未就绪时回退活跃模型定价币种，避免启动初期/无快照时显示错币种
      const sel = selection || modelSelection();
      const key = balanceProviderKey(sel.provider || config.activeProvider);
      const snap = balances[key];
      if (snap && snap.data && snap.data.currency) return snap.data.currency;
      return modelCurrency(sel.model);
    }

    function recordCurrency(record) {
      return record && typeof record.currency === 'string' && record.currency.length > 0
        ? record.currency
        : modelCurrency(record && record.model);
    }

    function spendSummary(nowMs, selection) {
      const sel = selection || modelSelection();
      // v1.6：计算当前活跃账户
      const activeAccount = accountForProvider(sel.provider);
      const snap = balances[balanceProviderKey(sel.provider || config.activeProvider)] || { data: null };
      const balance = snap.data ? snap.data.total : null;
      const cur = activeCurrency(sel);
      const cutoff = nowMs - SPEND_DAYS * 86400 * 1000;
      let total = 0;
      let offpeakTotal = 0;
      const daySet = new Set();
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        if (r.ts < cutoff) continue;
        // v1.6：账户 + 币种双条件过滤
        if (activeAccount !== null && recordAccount(r) !== activeAccount) continue;
        if (recordCurrency(r) !== cur) continue; // 只聚合活动币种，避免跨币种相加
        const c = costOf(r, false);
        if (c == null) continue;
        total += c;
        const oc = costOf(r, true);
        if (oc != null) offpeakTotal += oc;
        daySet.add(beijingDayKey(r.ts));
      }
      if (total <= 0 || balance == null) return null;
      const daysActive = Math.max(1, daySet.size);
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
        note: '基于过去 ' + SPEND_DAYS + ' 天消耗速度的估算',
      };
    }

    // ---------- 今日花费（北京时间当日累计，v1.6 账户 + 币种双条件过滤） ----------
    function todaySpend(nowMs, selection) {
      const sel = selection || modelSelection();
      const activeAccount = accountForProvider(sel.provider);
      const key = beijingDayKey(nowMs);
      const cur = activeCurrency(selection);
      let total = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        if (beijingDayKey(r.ts) !== key) continue;
        // v1.6：账户 + 币种双条件过滤
        if (activeAccount !== null && recordAccount(r) !== activeAccount) continue;
        if (recordCurrency(r) !== cur) continue;
        const c = costOf(r, false);
        if (c != null) total += c;
      }
      return Math.round(total * 1000) / 1000;
    }

    // ---------- 本月/近30天花费（v1.6 账户 + 币种双条件过滤） ----------
    function monthSpend(nowMs, selection) {
      const sel = selection || modelSelection();
      const activeAccount = accountForProvider(sel.provider);
      const d = new Date(nowMs + 8 * 3600 * 1000);
      const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      const cur = activeCurrency(selection);
      let total = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        const rd = new Date(r.ts + 8 * 3600 * 1000);
        if (rd.getUTCFullYear() + '-' + String(rd.getUTCMonth() + 1).padStart(2, '0') !== key) continue;
        // v1.6：账户 + 币种双条件过滤
        if (activeAccount !== null && recordAccount(r) !== activeAccount) continue;
        if (recordCurrency(r) !== cur) continue;
        const c = costOf(r, false);
        if (c != null) total += c;
      }
      return Math.round(total * 1000) / 1000;
    }
    function last30dSpend(nowMs, selection) {
      const sel = selection || modelSelection();
      const activeAccount = accountForProvider(sel.provider);
      const cutoff = nowMs - 30 * 86400 * 1000;
      const cur = activeCurrency(selection);
      let total = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        if (r.ts < cutoff) continue;
        // v1.6：账户 + 币种双条件过滤
        if (activeAccount !== null && recordAccount(r) !== activeAccount) continue;
        if (recordCurrency(r) !== cur) continue;
        const c = costOf(r, false);
        if (c != null) total += c;
      }
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

    function computeEstimate(nowMs) {
      const pricing = computePricing(nowMs);
      const bal = activeBalanceSummary(config.activeProvider, nowMs);
      const balance = bal.data ? bal.data.total : null;
      const currency = bal.currency || 'CNY';

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
        const peakPrices = pricing.mode === 'peak-valley' ? PRICING[pricing.model].peak : p;
        const offpeakPrices = pricing.mode === 'peak-valley' ? PRICING[pricing.model].offpeak : p;
        scenarios = SCENARIOS.map(function (sc) {
          return {
            id: sc.id, label: sc.label, outputK: sc.outputK, inputK: sc.inputK,
            optimistic: Math.floor(balance / scenarioCost(sc, 1.0, offpeakPrices)),
            pessimistic: Math.floor(balance / scenarioCost(sc, 0, peakPrices)),
            baseline: Math.floor(balance / scenarioCost(sc, 0.5, p)),
            offpeakBase: Math.floor(balance / scenarioCost(sc, 0.5, offpeakPrices)),
          };
        });
        const calib = calibrationFrom(sessionTotals(), CALIB_SESSIONS);
        if (calib && calib.medianOutput > 0) {
          const sc = {
            id: 'calibrated', label: '你的典型会话',
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
        calibration: calibrationFrom(sessionTotals(), CALIB_SESSIONS),
        pricing: pricing,
        fetchedAt: balances[config.activeProvider] ? balances[config.activeProvider].fetchedAt : null,
        stale: !!balances[config.activeProvider] && balances[config.activeProvider].error !== null && balances[config.activeProvider].data !== null,
        error: balances[config.activeProvider] ? balances[config.activeProvider].error : null,
      };
    }

    // ---------- 全部花费（v1.6 账户 + 币种双条件过滤） ----------
    function totalSpend(selection) {
      const sel = selection || modelSelection();
      const activeAccount = accountForProvider(sel.provider);
      const cur = activeCurrency(selection);
      let total = 0;
      for (let i = 0; i < usageRecords.length; i++) {
        const r = usageRecords[i];
        // v1.6：账户 + 币种双条件过滤
        if (activeAccount !== null && recordAccount(r) !== activeAccount) continue;
        if (recordCurrency(r) !== cur) continue;
        const c = costOf(r, false);
        if (c != null) total += c;
      }
      return Math.round(total * 1000) / 1000;
    }

    // ---------- 用量汇总 ----------
    function getUsageSummary(nowMs, sessionId, selection) {
      const sel = selection || modelSelection();
      // v1.6：计算当前活跃账户，用于会话聚合过滤
      const activeAccount = accountForProvider(sel.provider);
      const sessions = sessionTotals(activeAccount);
      return {
        sessions: sessions.length,
        calibration: calibrationFrom(sessions, CALIB_SESSIONS),
        currentSession: currentSessionSummary(usageRecords, activeAccount, sessionId),
        spend: spendSummary(nowMs, selection),
        todaySpend: todaySpend(nowMs, selection),
        monthSpend: monthSpend(nowMs, selection),
        last30dSpend: last30dSpend(nowMs, selection),
        totalSpend: totalSpend(selection),
        persistence: ledgerError ? { state: ledgerError.kind, message: ledgerError.message, at: ledgerError.at } : { state: 'ok', message: null, at: null },
        now: nowMs,
      };
    }

    // ---------- 服务商列表 ----------
    function providerList(nowMs) {
      const out = [];
      for (const pid in PROVIDERS) {
        const prov = PROVIDERS[pid];
        const snap = balances[pid] || { data: null, fetchedAt: null, error: null };
        out.push({
          id: prov.id,
          displayName: prov.displayName,
          estimate: !!prov.estimate,
          active: pid === config.activeProvider,
          currency: snap.data ? snap.data.currency : (pid === 'deepseek' ? 'CNY' : 'USD'),
          total: snap.data ? snap.data.total : null,
          fetchedAt: snap.fetchedAt,
          error: snap.error,
        });
      }
      return out;
    }

    // ---------- 花费趋势 ----------
    function spendTrend(nowMs, days) {
      const d = days === 30 ? 30 : 7;
      const points = [];
      const byModel = {};
      for (let i = d - 1; i >= 0; i--) {
        const dayStart = new Date(nowMs + 8 * 3600 * 1000);
        dayStart.setUTCDate(dayStart.getUTCDate() - i);
        dayStart.setUTCHours(0, 0, 0, 0);
        const startMs = dayStart.getTime() - 8 * 3600 * 1000;
        const endMs = startMs + 86400 * 1000;
        const label = String(dayStart.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dayStart.getUTCDate()).padStart(2, '0');
        let spend = 0;
        let offpeak = 0;
        for (let j = 0; j < usageRecords.length; j++) {
          const r = usageRecords[j];
          if (r.ts < startMs || r.ts >= endMs) continue;
          const c = costOf(r, false);
          if (c == null) continue;
          spend += c;
          const oc = costOf(r, true);
          if (oc != null) offpeak += oc;
        }
        points.push({ label: label, spend: Math.round(spend * 1000) / 1000, offpeak: Math.round(offpeak * 1000) / 1000 });
      }
      const cutoff = nowMs - d * 86400 * 1000;
      for (let j = 0; j < usageRecords.length; j++) {
        const r = usageRecords[j];
        if (r.ts < cutoff) continue;
        const c = costOf(r, false);
        if (c == null) continue;
        const key = r.model || r.provider;
        byModel[key] = (byModel[key] || 0) + c;
      }
      const byModelList = Object.keys(byModel).map(function (m) {
        return { model: m, spend: Math.round(byModel[m] * 1000) / 1000 };
      }).sort(function (a, b) { return b.spend - a.spend; });
      return { days: d, points: points, byModel: byModelList, now: nowMs };
    }

    // ---------- RPC 路由（webServer HTTP，替代动态沙箱 harness.handle） ----------
    const ROUTE_PREFIX = '/_dsh/dsh-bottom-info-bar';
    const ROUTES = {
      getUpdateInfo: function () {
        return updateInfoPromise
      },
      getBalanceSnapshot: function (args) {
        const pid = args && typeof args === 'object' && args.provider ? String(args.provider) : '';
        return activeBalanceSummary(pid || undefined, Date.now());
      },
      getPricing: async function (args) {
        // M5：首次遇到未刷新过的 provider → 等待一次目录名拉取（llm 缺失则直接回退），
        // 保证模型名/服务商名与模型切换器一致；已刷新过则零等待直接读缓存
        const sel = selectionFromArgs(args);
        const llm = ctx.get ? ctx.get('llm') : null;
        if (llm && !modelCatalogRefreshed[sel.provider]) await refreshModelCatalog(sel.provider);
        if (llm) await refreshModelCapability(sel.provider, sel.model);
        return computePricing(Date.now(), sel);
      },
      getEstimate: function () {
        return computeEstimate(Date.now());
      },
      getUsageSummary: function (args) {
        const sessionId = args && typeof args === 'object' ? String(args.sessionId || '') : '';
        return getUsageSummary(Date.now(), sessionId, selectionFromArgs(args));
      },
      getProviders: function () {
        return { providers: providerList(Date.now()), activeProvider: config.activeProvider };
      },
      setActiveProvider: function (args) {
        const pid = args && typeof args === 'object' ? args.provider : null;
        if (pid && Object.hasOwn(PROVIDERS, pid)) {
          config.activeProvider = pid;
          refreshProviderBalance(pid);
        }
        return { activeProvider: config.activeProvider };
      },
      getSpendTrend: function (args) {
        const days = args && typeof args === 'object' ? Number(args.days) : 7;
        return spendTrend(Date.now(), days);
      },
      getConfig: function () {
        return { displayMode: config.displayMode, infoDensity: config.infoDensity, activeProvider: config.activeProvider, alertThreshold: config.alertThreshold, billingMode: config.billingMode };
      },
      getBillingMode: function (args) {
        // 纯本地计算：优先使用客户端已订阅的当前会话模型，避免把另一个会话的
        // process-wide default 错显示到这里。
        const sel = selectionFromArgs(args);
        return Object.assign(detectBillingMode(sel.provider, config.billingMode), { model: sel.model });
      },
      getSubscriptionSnapshot: function (args) {
        return getSubscriptionSnapshotRpc(selectionFromArgs(args));
      },
      // v1.7 FR-14：账单型快照（云账单 provider）
      getBillingStatus: function (args) {
        return getBillingSnapshotRpc(selectionFromArgs(args));
      },
      setDisplayMode: function (args) {
        const mode = args && typeof args === 'object' ? args.mode : null;
        if (mode === 'extend' || mode === 'replace') config.displayMode = mode;
        return { displayMode: config.displayMode };
      },
      setInfoDensity: function (args) {
        const d = args && typeof args === 'object' ? args.density : null;
        if (d === 'full' || d === 'compact') config.infoDensity = d;
        return { infoDensity: config.infoDensity };
      },
    };
    const MUTATING = { setActiveProvider: true, setDisplayMode: true, setInfoDensity: true, getSubscriptionSnapshot: true, getBillingStatus: true };

    function sameOrigin(req) {
      const fetchSite = req.headers['sec-fetch-site'];
      if (fetchSite === 'cross-site') return false;
      const origin = req.headers.origin;
      if (origin === undefined) return fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none';
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
      const body = JSON.stringify(payload);
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
            try {
              const url = new URL(req.url || '/', 'http://localhost');
              const path = url.pathname;
              if (!path.startsWith(ROUTE_PREFIX + '/')) {
                respond(res, 404, { error: 'not found' });
                return;
              }
              const method = decodeURIComponent(path.slice(ROUTE_PREFIX.length + 1));
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
              respond(res, status, { error: status === 500 ? 'internal error' : String((err && err.message) || err) });
            }
          },
        });
        return function () { dispose(); };
      }, 'dsh-bottom-info-bar: Web routes');
    });

    // ---------- 启动即刷 + 60s 定时刷新 ----------
    refreshAllBalances();
    refreshActiveSubscriptions(); // 惰性：无客户端请求过订阅源则不发起网络请求
    refreshActiveBilling(); // v1.7：账单型同样惰性
    refreshActiveModelCatalog(); // M5：启动即拉一次 DSH 目录名（llm 缺失时静默回退，绝不崩溃）
    ctx.interval(refreshAllBalances, 60000);
    ctx.interval(refreshActiveSubscriptions, 60000);
    ctx.interval(refreshActiveBilling, 60000); // v1.7

    // 卸载时冲刷未落盘的记账记录
    return function () {
      if (dirty) flushSave();
    };
  },
};
