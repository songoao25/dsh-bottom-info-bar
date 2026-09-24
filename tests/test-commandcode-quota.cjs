// Command Code 订阅额度解析测试：官方 CLI credits / subscriptions 响应、套餐映射、窗口和安全降级。
// 用法：node tests/test-commandcode-quota.js
const fs = require('fs')

const hostSrc = fs.readFileSync(__dirname + '/../src/host.js', 'utf8')

function extractFn(name) {
  const start = hostSrc.indexOf('function ' + name)
  if (start < 0) throw new Error('未找到 function ' + name)
  let depth = 0
  let i = start
  let inStr = null
  while (i < hostSrc.length) {
    const c = hostSrc[i]
    if (inStr) {
      if (c === '\\') { i += 2; continue }
      if (c === inStr) inStr = null
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) break
    }
    i++
  }
  return eval('(' + hostSrc.slice(start, i + 1) + ')')
}

const WINDOW_LABELS = { five_hour: '5 小时', seven_day: '周', monthly: '月' }
const COMMAND_CODE_PLAN_TOTAL_CREDITS = {
  'individual-go': 10,
  'individual-goat': 70,
  'individual-pro': 30,
  'individual-pro-v1': 80,
  'individual-provider': 15,
  'individual-max': 150,
  'individual-ultra': 300,
  'teams-pro': 40,
}
const COMMAND_CODE_PLAN_NAMES = {
  'individual-go': 'Go',
  'individual-goat': 'GOAT',
  'individual-pro': 'Pro',
  'individual-pro-v1': 'Pro',
  'individual-provider': 'Provider',
  'individual-max': 'Max',
  'individual-ultra': 'Ultra',
  'teams-pro': 'Teams Pro',
}
const parseFiniteNonNegativeAmount = extractFn('parseFiniteNonNegativeAmount')
const normalizeResetAt = extractFn('normalizeResetAt')
const commandCodePayload = extractFn('commandCodePayload')
const commandCodePlanInfo = extractFn('commandCodePlanInfo')
const commandCodeWindow = extractFn('commandCodeWindow')
const parseCommandCodeUsage = extractFn('parseCommandCodeUsage')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) { pass++; console.log('PASS  ' + label + ' → ' + JSON.stringify(actual)) }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)) }
}

const fullCredits = {
  success: true,
  data: {
    credits: {
      planId: 'individual-pro-v1',
      monthlyCredits: '60',
      purchasedCredits: 5,
      freeCredits: '2',
      windowLimits: {
        fiveHour: { cap: 100, used: 25, resetAt: '1789284984' },
        weekly: { cap: '1000', used: '400', resetAt: '2026-09-19T08:26:46Z' },
      },
    },
  },
}
const fullSubscription = {
  success: true,
  data: {
    planId: 'individual-pro-v1',
    status: 'active',
    currentPeriodEnd: '2026-10-01T00:00:00Z',
  },
}
const full = parseCommandCodeUsage(fullCredits, fullSubscription, WINDOW_LABELS)
check('完整响应：套餐名', full && full.plan, 'Command Code Pro')
check('完整响应：5 小时 / 周 / 月窗口顺序', full && full.windows.map((w) => w.key), ['five_hour', 'seven_day', 'monthly'])
check('完整响应：窗口已用比例', full && full.windows.map((w) => w.usedPercent), [25, 40, 25])
check('完整响应：秒级和 ISO 重置时间', full && full.windows.map((w) => w.resetsAt), [1789284984000, Date.parse('2026-09-19T08:26:46Z'), Date.parse('2026-10-01T00:00:00Z')])
check('完整响应：总剩余 credits', full && full.balance, 67)
check('完整响应：余额单位为 credits', full && full.balanceUnit, 'credits')

const unknownPlan = parseCommandCodeUsage({
  credits: {
    planId: 'individual-future-v2',
    monthlyCredits: 60,
    purchasedCredits: 5,
    freeCredits: 2,
    windowLimits: { fiveHour: { cap: 100, used: 1, resetAt: null } },
  },
}, { data: { planId: 'individual-future-v2', status: 'active', currentPeriodEnd: '2026-10-01T00:00:00Z' } }, WINDOW_LABELS)
check('未知套餐：不猜测月度窗口', unknownPlan && unknownPlan.windows.map((w) => w.key), ['five_hour'])
check('未知套餐：仍保留可确认的 credits', unknownPlan && unknownPlan.balance, 67)
check('未知套餐：不生成虚构套餐名', unknownPlan && unknownPlan.plan, null)

const malformed = parseCommandCodeUsage({
  credits: {
    monthlyCredits: 'not-a-number',
    purchasedCredits: 0,
    freeCredits: 0,
    windowLimits: {
      fiveHour: { cap: 0, used: 3 },
      weekly: { cap: 10, used: 'bad' },
    },
  },
}, { data: { planId: 'individual-go', status: 'active' } }, WINDOW_LABELS)
check('畸形响应：没有可确认数据时返回 null', malformed, null)
check('失败响应：success=false 不解析', parseCommandCodeUsage({ success: false }, null, WINDOW_LABELS), null)

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail > 0 ? 1 : 0)
