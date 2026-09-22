// MiniMax Token Plan 配额解析单测（FR-15）
// 背景：MiniMax Coding Plan / Token Plan 由 `/v1/token_plan/remains`（半官方 B 级端点，
// 官方 CLI MiniMax-AI/cli PR #104 已切换至此）提供 5 小时 + 周窗口剩余百分比。
//
// 真实响应字段（2026-09-23 用户给真实 Subscription Key 后实测修正）：
//   - 每个 model_remains[] 条目是「模型配额桶」（general / video / …），各自有 5h + 周窗口。
//   - current_interval_remaining_percent / current_weekly_remaining_percent：剩余 0-100。
//     **真实数据里这两个才是真正的额度信号**；current_interval_total_count /
//     current_interval_usage_count 在所有真实响应里恒为 0（占位字段），不能据此推算。
//   - end_time / weekly_end_time：窗口结束毫秒；start_time / weekly_start_time：窗口开始毫秒。
//   - current_interval_status / current_weekly_status：1=进行中 / 3=未启用（按观察数据，
//     不参与解析决策，仅作为日志参考；按剩余百分比直接呈现）。
//
// 多桶语义：聚合取「剩余最低」即最紧的桶（不取首个桶，否则未启用过的桶会把数字顶成 100%，
// 与用户在 general 上已用不少的体感相反）。
//
// 业务错误：
//   - base_resp.status_code=1004：按量 Key 错用 Subscription 端点（"login fail"）→ auth
//   - base_resp.status_code=2049：跨域/Key 失效（"invalid api key"，拿国内 Key 打 Global）→ auth
//   - HTTP 401/403：按量 Key → auth
//   - 其他非零 status_code → parse（前端显示「返回了无法识别的额度格式」）
//
// 用法：node tests/test-minimax-token-plan.js
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const hostSrc = readFileSync(join(root, 'plugin', 'src', 'host.js'), 'utf8')
const localeSrc = readFileSync(join(root, 'plugin', 'src', 'locales.js'), 'utf8')

// ---- 从正式源码抽出被测函数（与 test-zai-quota.js 同法） ----
function extractFn(name) {
  const start = hostSrc.indexOf('function ' + name)
  if (start < 0) throw new Error('未找到 function ' + name)
  let depth = 0, i = start, inStr = null
  while (i < hostSrc.length) {
    const c = hostSrc[i]
    if (inStr) {
      if (c === '\\') { i += 2; continue }
      if (c === inStr) inStr = null
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c
    } else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
    i++
  }
  return hostSrc.slice(start, i + 1)
}

const WINDOW_LABELS = { five_hour: '5 小时', seven_day: '周', monthly: '月' }
const minimaxNumericField = eval('(' + extractFn('minimaxNumericField') + ')')
const minimaxRemainingPercent = eval('(' + extractFn('minimaxRemainingPercent') + ')')
const minimaxAggregateRemainingPercents = eval('(' + extractFn('minimaxAggregateRemainingPercents') + ')')
const minimaxEarliestResetMs = eval('(' + extractFn('minimaxEarliestResetMs') + ')')
const parseMinimaxTokenPlanRemains = eval(
  '(function (t) {'
  + extractFn('minimaxNumericField')
  + extractFn('minimaxRemainingPercent')
  + extractFn('minimaxAggregateRemainingPercents')
  + extractFn('minimaxEarliestResetMs')
  + extractFn('parseMinimaxTokenPlanRemains')
  + 'return parseMinimaxTokenPlanRemains })'
)(null)
if (typeof parseMinimaxTokenPlanRemains !== 'function') throw new Error('parseMinimaxTokenPlanRemains 抽取失败')

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

// ================= ① 真实响应形态：general 桶已部分用 + video 桶未启用 =================
// 来自 2026-09-23 真实 Subscription Key 实测；保证与生产数据一致。
const REAL_PAYLOAD = {
  base_resp: { status_code: 0, status_msg: 'success' },
  model_remains: [
    {
      start_time: 1790060400000, end_time: 1790078400000, remains_time: 3169473,
      current_interval_total_count: 0, current_interval_usage_count: 0,
      model_name: 'general',
      current_weekly_total_count: 0, current_weekly_usage_count: 0,
      weekly_start_time: 1789920000000, weekly_end_time: 1790524800000, weekly_remains_time: 449569473,
      current_interval_status: 1, current_interval_remaining_percent: 64,
      current_weekly_status: 3, current_weekly_remaining_percent: 100,
    },
    {
      start_time: 1790006400000, end_time: 1790092800000, remains_time: 17569473,
      current_interval_total_count: 0, current_interval_usage_count: 0,
      model_name: 'video',
      current_weekly_total_count: 0, current_weekly_usage_count: 0,
      weekly_start_time: 1789920000000, weekly_end_time: 1790524800000, weekly_remains_time: 449569473,
      current_interval_status: 3, current_interval_remaining_percent: 100,
      current_weekly_status: 3, current_weekly_remaining_percent: 100,
    },
  ],
}
const real = parseMinimaxTokenPlanRemains(REAL_PAYLOAD, WINDOW_LABELS)
check('① 套餐名固定为 MiniMax Token Plan', real && real.plan, 'MiniMax Token Plan')
check('① 解析出 5 小时 + 周两个窗口', real && real.windows.map((w) => w.key), ['five_hour', 'seven_day'])
check('① 窗口标签跟随传入字典', real && real.windows.map((w) => w.label), ['5 小时', '周'])
check('① 5h 取最紧桶（general 64% 剩余 → 已用 36%）', real && real.windows[0].usedPercent, 36)
check('① 周取最紧桶（general/video 都是 100% 剩余 → 已用 0%）', real && real.windows[1].usedPercent, 0)
check('① 5h 重置时刻取最早 end_time（general 桶先结束）', real && real.windows[0].resetsAt, 1790078400000)
check('① 周重置时刻取最早 weekly_end_time（两个桶同值）', real && real.windows[1].resetsAt, 1790524800000)

// ================= ② 多桶聚合：取最紧（剩余最低）而非取首个 =================
// 第一个桶已用 80%（剩余 20%），第二个桶未启用（剩余 100%）；应取最紧 = 已用 80%。
const MULTI_BUCKET = {
  base_resp: { status_code: 0 },
  model_remains: [
    { model_name: 'A', current_interval_remaining_percent: 20, current_weekly_remaining_percent: 50,
      end_time: 2000000000000, weekly_end_time: 3000000000000 },
    { model_name: 'B', current_interval_remaining_percent: 100, current_weekly_remaining_percent: 90,
      end_time: 2100000000000, weekly_end_time: 3100000000000 },
  ],
}
const multi = parseMinimaxTokenPlanRemains(MULTI_BUCKET, WINDOW_LABELS)
check('② 多桶聚合：5h 已用 80%（取剩余最低 20%）', multi && multi.windows[0].usedPercent, 80)
check('② 多桶聚合：周已用 50%（取剩余最低 50%）', multi && multi.windows[1].usedPercent, 50)
check('② 多桶聚合：5h 重置取最早 end_time', multi && multi.windows[0].resetsAt, 2000000000000)
check('② 多桶聚合：周重置取最早 weekly_end_time', multi && multi.windows[1].resetsAt, 3000000000000)

// 极端：所有桶都没用过 5h（剩余都是 100%）；应输出已用 0%，不报"未知格式"
const allFull = parseMinimaxTokenPlanRemains({
  base_resp: { status_code: 0 },
  model_remains: [
    { model_name: 'A', current_interval_remaining_percent: 100, current_weekly_remaining_percent: 100 },
    { model_name: 'B', current_interval_remaining_percent: 100, current_weekly_remaining_percent: 100 },
  ],
}, WINDOW_LABELS)
check('② 全桶 100% 剩余：5h 已用 0%', allFull && allFull.windows[0].usedPercent, 0)
check('② 全桶 100% 剩余：周已用 0%', allFull && allFull.windows[1].usedPercent, 0)

// ================= ③ 数字容错（字符串数字、负数归零、缺失） =================
ok('③ 字符串数字：与 number 等价', minimaxNumericField('228') === 228)
ok('③ 带空白字符串：仍可解析', minimaxNumericField('  228  ') === 228)
ok('③ 数字：原样', minimaxNumericField(1500) === 1500)
ok('③ 负数：拒绝（返回 null）', minimaxNumericField(-5) === null)
ok('③ 空串：null', minimaxNumericField('') === null)
ok('③ 空白串：null', minimaxNumericField('   ') === null)
ok('③ 非数字字符串：null', minimaxNumericField('abc') === null)
ok('③ Infinity：null', minimaxNumericField(Infinity) === null)
ok('③ null：null', minimaxNumericField(null) === null)
ok('③ undefined：null', minimaxNumericField(undefined) === null)
// minimaxRemainingPercent 在 minimaxNumericField 之上还夹到 0-100 整数
ok('③ remainingPercent：字符串 "64" → 64', minimaxRemainingPercent('64') === 64)
ok('③ remainingPercent：number 64.4 → 64（四舍五入）', minimaxRemainingPercent(64.4) === 64)
ok('③ remainingPercent：number 64.6 → 65', minimaxRemainingPercent(64.6) === 65)
ok('③ remainingPercent：>100 → 夹到 100', minimaxRemainingPercent(150) === 100)
ok('③ remainingPercent：<0 → null（原始字段负值拒收）', minimaxRemainingPercent(-10) === null)
ok('③ remainingPercent：缺失 → null', minimaxRemainingPercent(null) === null)
ok('③ remainingPercent：非数字字符串 → null', minimaxRemainingPercent('abc') === null)

// ================= ④ 聚合 / 重置时刻辅助函数 =================
ok('④ 空 model_remains → null', minimaxAggregateRemainingPercents([]) === null)
ok('④ model_remains 非数组 → null', minimaxAggregateRemainingPercents(null) === null)
ok('④ 所有条目字段缺失 → null（anyWindow=false）',
  minimaxAggregateRemainingPercents([{}, { model_name: 'x' }]) === null)
const onlyFiveHour = minimaxAggregateRemainingPercents([
  { current_interval_remaining_percent: 50, end_time: 12345 },
])
check('④ 仅 5h 字段：weeklyRemaining=null weeklyEnd=null', onlyFiveHour,
  { fiveHourRemaining: 50, weeklyRemaining: null, fiveHourEnd: 12345, weeklyEnd: null })
const onlyWeekly = minimaxAggregateRemainingPercents([
  { current_weekly_remaining_percent: 75, weekly_end_time: 67890 },
])
check('④ 仅周字段：fiveHourRemaining=null fiveHourEnd=null', onlyWeekly,
  { fiveHourRemaining: null, weeklyRemaining: 75, fiveHourEnd: null, weeklyEnd: 67890 })
const earliestReset = minimaxEarliestResetMs(MULTI_BUCKET.model_remains, 'five_hour')
check('④ 最早结束时刻：2000000000000', earliestReset, 2000000000000)
const earliestWeekly = minimaxEarliestResetMs(MULTI_BUCKET.model_remains, 'weekly')
check('④ 最早周结束：3000000000000', earliestWeekly, 3000000000000)
const noReset = minimaxEarliestResetMs([{ model_name: 'x' }], 'five_hour')
ok('④ 无 end_time → null', noReset === null)

// ================= ⑤ 降级路径（parse 错误 = null，由调用方保留旧快照） =================
ok('⑤ body 非对象 → null', parseMinimaxTokenPlanRemains(null, WINDOW_LABELS) === null)
ok('⑤ body 缺 base_resp/model_remains → null', parseMinimaxTokenPlanRemains({}, WINDOW_LABELS) === null)
ok('⑤ model_remains 空数组 → null（与智谱零窗口同型，按解析失败保留旧快照）',
  parseMinimaxTokenPlanRemains({ base_resp: { status_code: 0 }, model_remains: [] }, WINDOW_LABELS) === null)
ok('⑤ model_remains 非数组 → null', parseMinimaxTokenPlanRemains({ base_resp: { status_code: 0 }, model_remains: 'oops' }, WINDOW_LABELS) === null)
ok('⑤ base_resp.status_code=1004（按量 Key 错用）→ null（fetch 层会转为 auth 错误）',
  parseMinimaxTokenPlanRemains({ base_resp: { status_code: 1004, status_msg: 'login fail' }, model_remains: REAL_PAYLOAD.model_remains }, WINDOW_LABELS) === null)
ok('⑤ base_resp.status_code=2049（跨域/Key 失效）→ null（fetch 层会转为 auth 错误）',
  parseMinimaxTokenPlanRemains({ base_resp: { status_code: 2049, status_msg: 'invalid api key' }, model_remains: REAL_PAYLOAD.model_remains }, WINDOW_LABELS) === null)
ok('⑤ base_resp.status_code=其他非零 → null（fetch 层会转为 parse 错误）',
  parseMinimaxTokenPlanRemains({ base_resp: { status_code: 9999 }, model_remains: REAL_PAYLOAD.model_remains }, WINDOW_LABELS) === null)
ok('⑤ 所有条目字段缺失 → null（不输出 0% 假窗口）',
  parseMinimaxTokenPlanRemains({ base_resp: { status_code: 0 }, model_remains: [{}, null, 'oops'] }, WINDOW_LABELS) === null)
// 半窗口：仅周窗口有 remaining → 仅输出周窗口
const halfWeekly = parseMinimaxTokenPlanRemains({
  base_resp: { status_code: 0 },
  model_remains: [{ current_weekly_remaining_percent: 25, weekly_end_time: 1776614400000 }],
}, WINDOW_LABELS)
check('⑤ 半窗口：仅周窗口有效 → 仅输出周窗口', halfWeekly && halfWeekly.windows.map((w) => w.key), ['seven_day'])
check('⑤ 半窗口：周已用 75%（25% 剩余）', halfWeekly && halfWeekly.windows[0].usedPercent, 75)
// 反向半窗口：仅 5h 有效
const halfFiveHour = parseMinimaxTokenPlanRemains({
  base_resp: { status_code: 0 },
  model_remains: [{ current_interval_remaining_percent: 30, end_time: 1776373200000 }],
}, WINDOW_LABELS)
check('⑤ 半窗口：仅 5h 有效 → 仅输出 5h 窗口', halfFiveHour && halfFiveHour.windows.map((w) => w.key), ['five_hour'])
check('⑤ 半窗口：5h 已用 70%（30% 剩余）', halfFiveHour && halfFiveHour.windows[0].usedPercent, 70)

// ================= ⑥ 业务错误码（fetch 层处理；本层只验证解析层返回 null） =================
// 1004 / 2049 / 其他非零：解析层均返回 null（不参与快照），错误翻译由 fetch 层负责。
ok('⑥ base_resp.status_code=1004 → null', parseMinimaxTokenPlanRemains({ base_resp: { status_code: 1004 } }, WINDOW_LABELS) === null)
ok('⑥ base_resp.status_code=2049 → null', parseMinimaxTokenPlanRemains({ base_resp: { status_code: 2049 } }, WINDOW_LABELS) === null)
ok('⑥ base_resp.status_code=其他非零 → null', parseMinimaxTokenPlanRemains({ base_resp: { status_code: 1 } }, WINDOW_LABELS) === null)
// host.js 中 fetch 层的 1004/2049 → auth 翻译逻辑必须存在
ok('⑥ host.js：fetch 层 1004 → auth',
  /fetchMinimaxTokenPlanUsage[\s\S]*?baseResp\.status_code === 1004 \|\| baseResp\.status_code === 2049/.test(hostSrc))

// ================= ⑦ i18n 文案三键齐备 =================
ok('⑦ locales：ui.minimax 存在（zh + en）',
  (localeSrc.match(/"ui\.minimax"/g) || []).length === 2)
ok('⑦ locales：host.minimaxTokenPlanCredentials 存在（zh + en）',
  (localeSrc.match(/"host\.minimaxTokenPlanCredentials"/g) || []).length === 2)
ok('⑦ locales：host.minimaxTokenPlanRequiresSubscription 存在（zh + en）',
  (localeSrc.match(/"host\.minimaxTokenPlanRequiresSubscription"/g) || []).length === 2)
ok('⑦ locales：host.minimaxTokenPlanQuotaUnrecognized 存在（zh + en）',
  (localeSrc.match(/"host\.minimaxTokenPlanQuotaUnrecognized"/g) || []).length === 2)

// ================= ⑧ 客户端显示名 =================
const clientSrc = readFileSync(join(root, 'plugin', 'src', 'client-bundle.js'), 'utf8')
ok('⑧ client-bundle.js：subscriptionServiceName 含 minimax → ui.minimax 映射',
  /minimax['"]\s*\|\|\s*provider\s*===\s*['"]minimax-cn['"]\)\s*return\s+t\(['"]ui\.minimax['"]\)/.test(clientSrc))

// ================= ⑨ 源映射（host.js）—— 模式识别走 subscription ================
ok('⑨ host.js：subscriptionSourceFor 含 minimax → minimax 源',
  /subscriptionSourceFor[\s\S]*?providerId === ['"]minimax['"]\s*\|\|\s*providerId === ['"]minimax-cn['"]\)\s*return ['"]minimax['"]/.test(hostSrc))
ok('⑨ host.js：accountForProvider 含 minimax → minimax 账户',
  /accountForProvider[\s\S]*?pid === ['"]minimax['"]\s*\|\|\s*pid === ['"]minimax-cn['"]\)\s*return ['"]minimax['"]/.test(hostSrc))
ok('⑨ host.js：PROVIDER_DISPLAY 含 minimax/minimax-cn → MiniMax',
  /PROVIDER_DISPLAY[\s\S]*?minimax: 'MiniMax'[\s\S]*?'minimax-cn': 'MiniMax'/.test(hostSrc))

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项失败') + '：' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)