// MiniMax Token Plan 配额解析单测（FR-15）
// 背景：MiniMax Coding Plan / Token Plan 由 `/v1/token_plan/remains`（半官方 B 级端点，
// 官方 CLI PR #104 已切换至此）提供 5 小时 + 周窗口计数。`current_interval_usage_count`
// / `current_weekly_usage_count` 是「已用」而非「剩余」（PR #104 明确修正）；必须用
// Subscription Key，按量 API Key 会被 base_resp.status_code=1004 拒绝。
//
// 覆盖：
//  ① 单一模型：5 小时 + 周窗口，百分比按总量推算
//  ② 多模型拆分（Plus/Ultra 等高阶档）：累加每个模型的 5h/周 计数，得整体百分比
//  ③ 数字容错（字符串数字、负数归零）
//  ④ 重置时刻：取最早到达的窗口结束毫秒（用户视角"何时能再用"）
//  ⑤ 降级：base_resp.status_code≠0、空 model_remains、字段缺失 → null
//  ⑥ base_resp.status_code===1004（按量 Key 错用）由 fetch 层单独处理为 auth 错误，
//     解析层只需返回 null（不算成功）
//  ⑦ i18n 文案三键齐备（zh/en 各两段）
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
const minimaxAggregateWindowCounts = eval('(' + extractFn('minimaxAggregateWindowCounts') + ')')
const minimaxEarliestResetMs = eval('(' + extractFn('minimaxEarliestResetMs') + ')')
const parseMinimaxTokenPlanRemains = eval(
  '(function (t) {'
  + extractFn('minimaxNumericField')
  + extractFn('minimaxAggregateWindowCounts')
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

// ================= ① 单一模型：5 小时 + 周窗口 =================
const SINGLE_MODEL = {
  base_resp: { status_code: 0, status_msg: 'success' },
  model_remains: [{
    model_name: 'MiniMax-M3',
    start_time: 1776355200000,
    end_time: 1776373200000,
    remains_time: 7151954,
    current_interval_total_count: 1500,
    current_interval_usage_count: 228,
    current_weekly_total_count: 10000,
    current_weekly_usage_count: 1240,
    weekly_start_time: 1776009600000,
    weekly_end_time: 1776614400000,
    weekly_remains_time: 248351954,
  }],
}
const single = parseMinimaxTokenPlanRemains(SINGLE_MODEL, WINDOW_LABELS)
check('① 套餐名固定为 MiniMax Token Plan', single && single.plan, 'MiniMax Token Plan')
check('① 解析出 5 小时 + 周两个窗口', single && single.windows.map((w) => w.key), ['five_hour', 'seven_day'])
check('① 窗口标签跟随传入字典', single && single.windows.map((w) => w.label), ['5 小时', '周'])
check('① 5 小时已用 15%（228/1500 → 15.2% 四舍五入）', single && single.windows[0].usedPercent, 15)
check('① 周窗口已用 12%（1240/10000 → 12.4% 四舍五入）', single && single.windows[1].usedPercent, 12)
check('① 5 小时重置时刻 = end_time（毫秒）', single && single.windows[0].resetsAt, 1776373200000)
check('① 周窗口重置时刻 = weekly_end_time', single && single.windows[1].resetsAt, 1776614400000)

// ================= ② 多模型拆分（Plus/Ultra 按模型拆分 model_remains[]） =================
// 每个模型各自有独立的 5h 窗口；总数应累加后算整体百分比，绝不取首个。
const MULTI_MODEL = {
  base_resp: { status_code: 0, status_msg: 'success' },
  model_remains: [
    {
      model_name: 'MiniMax-M3',
      current_interval_total_count: 1000,
      current_interval_usage_count: 800,   // 已用 80%
      current_weekly_total_count: 5000,
      current_weekly_usage_count: 3000,   // 已用 60%
      end_time: 1776373200000,
      weekly_end_time: 1776614400000,
    },
    {
      model_name: 'MiniMax-M2.7',
      current_interval_total_count: 500,
      current_interval_usage_count: 100,   // 已用 20%
      current_weekly_total_count: 3000,
      current_weekly_usage_count: 200,    // 已用 6.7%
      end_time: 1776373201000,
      weekly_end_time: 1776614401000,
    },
  ],
}
const multi = parseMinimaxTokenPlanRemains(MULTI_MODEL, WINDOW_LABELS)
check('② 多模型：5 小时整体已用 60%（900/1500）', multi && multi.windows[0].usedPercent, 60)
check('② 多模型：周整体已用 41%（3200/8000 → 40% 四舍五入）', multi && multi.windows[1].usedPercent, 40)
check('② 多模型：5 小时重置取最早 end_time', multi && multi.windows[0].resetsAt, 1776373200000)
check('② 多模型：周重置取最早 weekly_end_time', multi && multi.windows[1].resetsAt, 1776614400000)

// ================= ③ 数字容错（字符串/数字、负数归零、缺失） =================
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

// ================= ④ 聚合 / 重置时刻辅助函数 =================
const emptyAggregate = minimaxAggregateWindowCounts([])
ok('④ 空 model_remains → null', emptyAggregate === null)
const wrongShape = minimaxAggregateWindowCounts(null)
ok('④ model_remains 非数组 → null', wrongShape === null)
const allMiss = minimaxAggregateWindowCounts([{}, { model_name: 'x' }])
ok('④ 所有条目字段缺失 → null', allMiss === null)
const partial = minimaxAggregateWindowCounts([{ current_interval_total_count: 100, current_interval_usage_count: 50 }])
check('④ 仅 5h 字段：weekly 全 0、5h 已用 50%', partial, { fiveHourTotal: 100, fiveHourUsed: 50, weeklyTotal: 0, weeklyUsed: 0 })
const earliestReset = minimaxEarliestResetMs(MULTI_MODEL.model_remains, 'five_hour')
check('④ 最早结束时刻：1776373200000', earliestReset, 1776373200000)
const earliestWeekly = minimaxEarliestResetMs(MULTI_MODEL.model_remains, 'weekly')
check('④ 最早周结束：1776614400000', earliestWeekly, 1776614400000)
const noReset = minimaxEarliestResetMs([{ model_name: 'x' }], 'five_hour')
ok('④ 无 end_time → null', noReset === null)

// ================= ⑤ 降级路径（parse 错误 = null，由调用方保留旧快照） =================
ok('⑤ body 非对象 → null', parseMinimaxTokenPlanRemains(null, WINDOW_LABELS) === null)
ok('⑤ body 缺 base_resp/model_remains → null', parseMinimaxTokenPlanRemains({}, WINDOW_LABELS) === null)
ok('⑤ model_remains 空数组 → null（与智谱零窗口同型，按解析失败保留旧快照）',
  parseMinimaxTokenPlanRemains({ base_resp: { status_code: 0 }, model_remains: [] }, WINDOW_LABELS) === null)
ok('⑤ model_remains 非数组 → null', parseMinimaxTokenPlanRemains({ base_resp: { status_code: 0 }, model_remains: 'oops' }, WINDOW_LABELS) === null)
ok('⑤ base_resp.status_code=1004（按量 Key 错用）→ null（fetch 层会转为 auth 错误）',
  parseMinimaxTokenPlanRemains({ base_resp: { status_code: 1004, status_msg: 'login fail' }, model_remains: SINGLE_MODEL.model_remains }, WINDOW_LABELS) === null)
ok('⑤ base_resp.status_code=其他非零 → null（fetch 层会转为 parse 错误）',
  parseMinimaxTokenPlanRemains({ base_resp: { status_code: 9999 }, model_remains: SINGLE_MODEL.model_remains }, WINDOW_LABELS) === null)
ok('⑤ 所有条目字段缺失 → null（不输出 0% 假窗口）',
  parseMinimaxTokenPlanRemains({ base_resp: { status_code: 0 }, model_remains: [{}, null, 'oops'] }, WINDOW_LABELS) === null)
// 退化：仅 5h 字段但总额为 0（不应输出 0% 假窗口）
ok('⑤ 5h 总额 0 → 不输出该窗口',
  parseMinimaxTokenPlanRemains({ base_resp: { status_code: 0 }, model_remains: [{ current_interval_total_count: 0, current_interval_usage_count: 0 }] }, WINDOW_LABELS) === null)
// 半窗口：5h 字段缺失，仅周窗口 → 仅输出周窗口
const onlyWeekly = parseMinimaxTokenPlanRemains({
  base_resp: { status_code: 0 },
  model_remains: [{ current_weekly_total_count: 100, current_weekly_usage_count: 25, weekly_end_time: 1776614400000 }],
}, WINDOW_LABELS)
check('⑤ 半窗口：仅周窗口有效 → 仅输出周窗口', onlyWeekly && onlyWeekly.windows.map((w) => w.key), ['seven_day'])

// ================= ⑥ i18n 文案三键齐备 =================
ok('⑥ locales：ui.minimax 存在（zh + en）',
  (localeSrc.match(/"ui\.minimax"/g) || []).length === 2)
ok('⑥ locales：host.minimaxTokenPlanCredentials 存在（zh + en）',
  (localeSrc.match(/"host\.minimaxTokenPlanCredentials"/g) || []).length === 2)
ok('⑥ locales：host.minimaxTokenPlanRequiresSubscription 存在（zh + en）',
  (localeSrc.match(/"host\.minimaxTokenPlanRequiresSubscription"/g) || []).length === 2)
ok('⑥ locales：host.minimaxTokenPlanQuotaUnrecognized 存在（zh + en）',
  (localeSrc.match(/"host\.minimaxTokenPlanQuotaUnrecognized"/g) || []).length === 2)

// ================= ⑦ 客户端显示名 =================
const clientSrc = readFileSync(join(root, 'plugin', 'src', 'client-bundle.js'), 'utf8')
ok('⑦ client-bundle.js：subscriptionServiceName 含 minimax → ui.minimax 映射',
  /minimax['"]\s*\|\|\s*provider\s*===\s*['"]minimax-cn['"]\)\s*return\s+t\(['"]ui\.minimax['"]\)/.test(clientSrc))

// ================= ⑧ 源映射（host.js）—— 模式识别走 subscription ================
ok('⑧ host.js：subscriptionSourceFor 含 minimax → minimax 源',
  /subscriptionSourceFor[\s\S]*?providerId === ['"]minimax['"]\s*\|\|\s*providerId === ['"]minimax-cn['"]\)\s*return ['"]minimax['"]/.test(hostSrc))
ok('⑧ host.js：accountForProvider 含 minimax → minimax 账户',
  /accountForProvider[\s\S]*?pid === ['"]minimax['"]\s*\|\|\s*pid === ['"]minimax-cn['"]\)\s*return ['"]minimax['"]/.test(hostSrc))
ok('⑧ host.js：PROVIDER_DISPLAY 含 minimax/minimax-cn → MiniMax',
  /PROVIDER_DISPLAY[\s\S]*?minimax: 'MiniMax'[\s\S]*?'minimax-cn': 'MiniMax'/.test(hostSrc))

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项失败') + '：' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)