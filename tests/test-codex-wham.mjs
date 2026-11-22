// Codex 后端额度（/backend-api/wham/usage）映射回归。
// 只测正式源码里抽出的真函数，不发网络请求。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const hostSource = readFileSync(join(ROOT, 'src', 'host.js'), 'utf8')

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
  const end = hostSource.indexOf('}', start + marker.length)
  return hostSource.slice(start + marker.length, end + 1)
}

const pure = eval(
  '(function () {'
  + 'const WINDOW_LABELS = ' + extractConst('WINDOW_LABELS') + ';'
  + 'const CODEX_PLAN_NAMES = ' + extractConst('CODEX_PLAN_NAMES') + ';'
  + extractFn('parsePercent')
  + extractFn('normalizeResetAt')
  + extractFn('planDisplayName')
  + extractFn('appAuthWindowKey')
  + extractFn('parseCodexWhamUsage')
  + 'return { parseCodexWhamUsage: parseCodexWhamUsage };'
  + '})()'
)
const parse = pure.parseCodexWhamUsage
assert.equal(typeof parse, 'function')

const WL = { five_hour: '5 小时', seven_day: '周', monthly: '月' }

// 5 小时 + 周：used_percent 是已用方向；reset_at 是 Unix 秒。
const parsed = parse({
  plan_type: 'plus',
  rate_limit: {
    primary_window: { used_percent: 22, reset_at: 1738300000, limit_window_seconds: 18000 },
    secondary_window: { used_percent: 64, reset_at: 1738900000, limit_window_seconds: 604800 },
  },
}, WL)
assert.equal(parsed.plan, 'ChatGPT Plus')
assert.equal(parsed.planType, 'plus')
assert.deepEqual(parsed.windows.map(function (w) { return w.key }), ['five_hour', 'seven_day'])
assert.equal(parsed.windows[0].usedPercent, 22)
assert.equal(parsed.windows[0].resetsAt, 1738300000000)
assert.equal(parsed.windows[1].usedPercent, 64)

// 只有 primary：月度窗口（30 天）。
const monthly = parse({ plan_type: 'free', rate_limit: { primary_window: { used_percent: 20, reset_at: 1797459718, limit_window_seconds: 2592000 } } }, WL)
assert.deepEqual(monthly.windows.map(function (w) { return w.key }), ['monthly'])
assert.equal(monthly.plan, 'ChatGPT Free')

// Business 的 spend_control 兜底。
const business = parse({ plan_type: 'business', rate_limit: null, spend_control: { individual_limit: { used: '1434.58', limit: '2400', reset_at: 1789000000 } } }, WL)
assert.deepEqual(business.windows.map(function (w) { return w.key }), ['monthly'])
assert.equal(business.windows[0].usedPercent, 60)

// 没有窗口 → null（调用方退回套餐/有效期）。
assert.equal(parse({ plan_type: 'plus', rate_limit: {} }, WL), null)
assert.equal(parse(null, WL), null)

// 源码必须把 wham 通道接进 fetchCodexUsage。
assert.ok(hostSource.includes('fetchCodexUsageFromWham'))
assert.ok(hostSource.includes('/backend-api/wham/usage'))
console.log('Codex wham usage mapping: PASS')
