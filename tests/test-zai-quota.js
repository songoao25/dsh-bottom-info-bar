// 智谱 Z.ai / GLM Coding Plan 配额解析单测（Issue #85）
// 背景：2026-07-30 起智谱 Coding Plan 改为积分制，quota 接口条目类型由 TOKENS_LIMIT
//       变为 CREDIT_LIMIT；修复前 parseZaiQuota 只认 TOKENS_LIMIT + unit=3，
//       导致积分制账号 windows:[] → 底条完全不显示额度。
// 覆盖：
//  ① 积分制报障样例（CREDIT_LIMIT unit3/unit6）→ 5 小时 + 周窗口
//  ② 老套餐 TOKENS_LIMIT 形态不回归
//  ③ unit/number 时长闸门：未知时长不被错标成 5 小时窗口
//  ④ 百分比推算：接口 percentage 向下取整时以原始计数为准；计数缺失时回退 percentage
//  ⑤ TIME_LIMIT（MCP 月度额度）→ monthly；未知类型/畸形条目静默跳过
//  ⑥ 去重、套餐名映射、重置时刻归一化、结构异常返回 null
// 用法：node tests/test-zai-quota.mjs
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const hostSrc = readFileSync(join(root, 'plugin', 'src', 'host.js'), 'utf8')
const localeSrc = readFileSync(join(root, 'plugin', 'src', 'locales.js'), 'utf8')

// ---- 从正式源码抽出被测函数（保证测的是真身，而不是复制品） ----
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

function extractConst(name) {
  const marker = 'const ' + name + ' = '
  const start = hostSrc.indexOf(marker)
  if (start < 0) throw new Error('未找到 const ' + name)
  const from = start + marker.length
  const open = hostSrc[from]
  const closer = open === '{' ? '}' : ']'
  const end = hostSrc.indexOf(closer, from)
  if (end < 0) throw new Error('const ' + name + ' 结构不完整')
  return hostSrc.slice(from, end + 1)
}

// 顶层 t() 依赖宿主 locale 服务，单测里用固定字典替身（只覆盖本文件用到的键）
const stubT = (key, params) => {
  if (key === 'host.zhipu') return '智谱 ' + params.mapped
  if (key === 'host.zhipu.parseZaiQuota') return '智谱 ' + params.value + params.value2
  throw new Error('未预期的 i18n key: ' + key)
}

const WINDOW_LABELS = { five_hour: '5 小时', seven_day: '周', monthly: '月' }
const parsePercent = eval('(' + extractFn('parsePercent') + ')')
const normalizeResetAt = eval('(' + extractFn('normalizeResetAt') + ')')
const zaiLimitNumber = eval('(' + extractFn('zaiLimitNumber') + ')')
const zaiUsedPercent = eval('(' + extractFn('zaiUsedPercent') + ')' + '')
const ZAI_LIMIT_TYPES = eval('(' + extractConst('ZAI_LIMIT_TYPES') + ')')
const ZAI_LIMIT_WINDOWS = eval('(' + extractConst('ZAI_LIMIT_WINDOWS') + ')')
const parseZaiQuota = eval(
  '(function (t) {'
  + 'const ZAI_LIMIT_TYPES = ' + extractConst('ZAI_LIMIT_TYPES') + ';'
  + 'const ZAI_LIMIT_WINDOWS = ' + extractConst('ZAI_LIMIT_WINDOWS') + ';'
  + extractFn('parsePercent')
  + extractFn('normalizeResetAt')
  + extractFn('zaiLimitNumber')
  + extractFn('zaiUsedPercent')
  + extractFn('parseZaiQuota')
  + 'return parseZaiQuota })'
)(stubT)
if (typeof parseZaiQuota !== 'function') throw new Error('parseZaiQuota 抽取失败')

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

// ================= ① 积分制报障样例（Issue #85 原始 payload） =================
const CREDIT_PAYLOAD = {
  code: 200,
  msg: 'Operation successful',
  data: {
    limits: [
      { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 2000, currentValue: 188, remaining: 1811, percentage: 9, nextResetTime: 1789284984350 },
      { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 10000, currentValue: 188, remaining: 9811, percentage: 1, nextResetTime: 1789871510984 },
    ],
    level: 'lite',
  },
  success: true,
}
const credit = parseZaiQuota(CREDIT_PAYLOAD, WINDOW_LABELS)
check('① 积分制：解析出 2 个窗口', credit && credit.windows.length, 2)
check('① 积分制：套餐名 lite → 智谱 Lite', credit && credit.plan, '智谱 Lite')
check('① 积分制：窗口键顺序 = 5小时 + 周', credit && credit.windows.map(function (w) { return w.key }), ['five_hour', 'seven_day'])
check('① 积分制：窗口标签跟随传入字典', credit && credit.windows.map(function (w) { return w.label }), ['5 小时', '周'])
check('① 积分制：5 小时已用 9%（188/2000）', credit && credit.windows[0].usedPercent, 9)
check('① 积分制：周窗口已用 2%（188/10000，四舍五入）', credit && credit.windows[1].usedPercent, 2)
check('① 积分制：5 小时重置时刻（毫秒直通）', credit && credit.windows[0].resetsAt, 1789284984350)
check('① 积分制：周窗口重置时刻（毫秒直通）', credit && credit.windows[1].resetsAt, 1789871510984)
ok('① 积分制：不再出现"解析成功但零窗口"', credit && credit.windows.length > 0)

// ================= ② 老套餐 TOKENS_LIMIT 形态不回归 =================
const LEGACY_PAYLOAD = {
  code: 200,
  data: {
    level: 'PRO',
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 18.5, total: 6000000, nextResetTime: 1735000000000 },
      { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 47.2, total: 80000000, nextResetTime: 1735500000000 },
      { type: 'TIME_LIMIT', percentage: 4.0, currentValue: 12, usage: 300, nextResetTime: 1736000000000 },
    ],
  },
}
const legacy = parseZaiQuota(LEGACY_PAYLOAD, WINDOW_LABELS)
check('② 老套餐：5 小时窗口保留（total 形态 + 浮点 percentage）', legacy && legacy.windows[0], { key: 'five_hour', label: '5 小时', usedPercent: 19, resetsAt: 1735000000000 })
check('② 老套餐：周窗口（unit=6）不再被丢弃', legacy && legacy.windows[1].key, 'seven_day')
check('② 老套餐：套餐名大小写不敏感（PRO → 智谱 Pro）', legacy && legacy.plan, '智谱 Pro')
// 老套餐此前的已知行为：只返回 5 小时窗口；修复后 5 小时窗口的数值必须与修复前完全一致
check('② 老套餐：5 小时百分比与修复前一致（18.5 → 19）', legacy && legacy.windows[0].usedPercent, 19)

// ================= ③ unit/number 时长闸门 =================
const unitTable = parseZaiQuota({
  data: { level: 'lite', limits: [
    { type: 'CREDIT_LIMIT', unit: 1, number: 1, usage: 100, currentValue: 10, percentage: 10 }, // 日窗口：尚无展示位
    { type: 'CREDIT_LIMIT', unit: 3, number: 10, usage: 100, currentValue: 10, percentage: 10 }, // 10 小时：不能标成 5 小时
    { type: 'CREDIT_LIMIT', unit: 6, number: 4, usage: 100, currentValue: 10, percentage: 10 }, // 4 周：不能标成周窗口
    { type: 'CREDIT_LIMIT', unit: '5', number: '5', usage: 100, currentValue: 10, percentage: 10 }, // unit=5 非时间单位
  ] },
}, WINDOW_LABELS)
check('③ 时长闸门：未知时长一律跳过，不误标', unitTable && unitTable.windows, [])
check('③ 时长闸门：数字型字符串 unit/number 可识别', parseZaiQuota({ data: { limits: [{ type: 'CREDIT_LIMIT', unit: '3', number: '5', usage: 2000, currentValue: 100, percentage: 5 }] } }, WINDOW_LABELS).windows.length, 1)
check('③ 时长闸门：(3,5) → five_hour', ZAI_LIMIT_WINDOWS['3:5'], 'five_hour')
check('③ 时长闸门：(6,1) → seven_day', ZAI_LIMIT_WINDOWS['6:1'], 'seven_day')
check('③ 时长闸门：映射表不含未知时长', Object.keys(ZAI_LIMIT_WINDOWS).sort(), ['3:5', '6:1'])
check('③ 时长闸门：接受类型仅 TOKENS_LIMIT / CREDIT_LIMIT', ZAI_LIMIT_TYPES, ['TOKENS_LIMIT', 'CREDIT_LIMIT'])

// ================= ④ 百分比推算与兜底 =================
// 上游 CodexBar issue #2724 原始 payload：71/2000、上游 percentage 报 3（精确值 3.55%）。
// 注：单凭 issue #85 的样本（188/2000→报 9、188/10000→报 1）无法判定上游是 round 还是 floor
// （9.4→9 与 1.88→1 两种规则都成立）；这里锁定的是**行为选择**——优先用原始计数推算，
// 与 CodexBar 同策略，因为计数比整数 percentage 精确（低用量时 percentage 取整到 0 会让底条显示 100%）。
const FLOOR_PAYLOAD = {
  data: { level: 'lite', limits: [
    { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 2000, currentValue: 71, remaining: 1929, percentage: 3, nextResetTime: 1786073946574 },
    { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 10000, currentValue: 71, remaining: 9929, percentage: 1, nextResetTime: 1786660486998 },
  ] },
}
const floored = parseZaiQuota(FLOOR_PAYLOAD, WINDOW_LABELS)
check('④ 推算：5 小时按原始计数 3.55% → 4%（不跟随上游整数 3）', floored && floored.windows[0].usedPercent, 4)
check('④ 推算：周窗口 0.71% → 1%', floored && floored.windows[1].usedPercent, 1)
// 计数缺失 → 回退接口 percentage（含无 usage 上限的异常形态）
check('④ 兜底：有上限无 remaining → currentValue 作为已用量（25/100）', zaiUsedPercent({ usage: 100, currentValue: 25, percentage: 10 }), 25)
check('④ 兜底：计数与 percentage 均缺失 → null（该窗口跳过）', zaiUsedPercent({}), null)
check('④ 兜底：仅 percentage（无任何计数）→ 采用 percentage', zaiUsedPercent({ percentage: 42.5 }), 42.5)
check('④ 兜底：remaining > usage（上游脏数据）→ 夹到 0%', zaiUsedPercent({ usage: 100, remaining: 200 }), 0)
check('④ 兜底：currentValue > usage → 夹到 100%', zaiUsedPercent({ usage: 100, currentValue: 250 }), 100)
check('④ 兜底：usage=0（上限缺失）→ 回退 percentage', zaiUsedPercent({ usage: 0, currentValue: 150, percentage: 7 }), 7)
check('④ 兜底：usage=0 且无 percentage → null', zaiUsedPercent({ usage: 0, currentValue: 150 }), null)
// TIME_LIMIT（MCP 调用次数）字段语义与时间窗口不同：usage=上限、currentValue=已用，且提供 percentage
check('④ TIME_LIMIT：usage=300 / currentValue=12 → 4%', zaiUsedPercent({ usage: 300, currentValue: 12, percentage: 4 }), 4)
check('④ TIME_LIMIT：上限与已用齐备但无 percentage → 仍按计数推算', zaiUsedPercent({ usage: 300, currentValue: 3 }), 1)
check('④ 兜底：数字型字符串计数可用', zaiUsedPercent({ usage: '2000', remaining: '1900' }), 5)
check('④ 兜底：老形态 total 作为上限', zaiUsedPercent({ total: 100, currentValue: 30 }), 30)
check('④ 兜底：percentage 为负 → parsePercent 返回 null', zaiUsedPercent({ percentage: -1 }), null)
check('④ zaiLimitNumber：非数字字符串 → null', zaiLimitNumber('abc'), null)
check('④ zaiLimitNumber：空串 → null', zaiLimitNumber('  '), null)

// ================= ⑤ TIME_LIMIT 与未知类型 =================
const withMcp = parseZaiQuota({
  data: { level: 'lite', limits: [
    { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 2000, currentValue: 200, percentage: 10 },
    { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 10000, currentValue: 200, percentage: 2 },
    { type: 'TIME_LIMIT', percentage: 4, currentValue: 12, usage: 300, nextResetTime: 1736000000000 },
  ] },
}, WINDOW_LABELS)
check('⑤ MCP：TIME_LIMIT → monthly 窗口', withMcp && withMcp.windows[2], { key: 'monthly', label: '月', usedPercent: 4, resetsAt: 1736000000000 })
check('⑤ MCP：窗口总数 3（5 小时 + 周 + 月）', withMcp && withMcp.windows.length, 3)
check('⑤ MCP：三窗口顺序 = 5小时 / 周 / 月', withMcp && withMcp.windows.map(function (w) { return w.key }), ['five_hour', 'seven_day', 'monthly'])
// TIME_LIMIT 的 percentage 缺失时不得因字段语义不同而误算成 100%
check('⑤ MCP：TIME_LIMIT 缺 percentage 但计数齐备 → 按计数推算', (function () {
  const r = parseZaiQuota({ data: { limits: [{ type: 'TIME_LIMIT', usage: 300, currentValue: 12 }] } }, WINDOW_LABELS)
  return r && r.windows[0] && r.windows[0].usedPercent
})(), 4)
check('⑤ MCP：TIME_LIMIT 缺 percentage 且缺计数 → 跳过该窗口', (function () {
  const r = parseZaiQuota({ data: { limits: [{ type: 'TIME_LIMIT', usage: 300 }] } }, WINDOW_LABELS)
  return r && r.windows
})(), [])
const unknownOnly = parseZaiQuota({
  data: { limits: [
    { type: 'RATE_LIMIT', unit: 3, number: 5, percentage: 10 },
    { type: 'SESSION_LIMIT', unit: 3, number: 5, percentage: 10 },
    { type: 'FUTURE_KIND', percentage: 10 },
    null,
    'not-an-object',
    { type: 'CREDIT_LIMIT' },
  ] },
}, WINDOW_LABELS)
check('⑤ 未知类型/畸形条目：全部静默跳过，不抛错', unknownOnly && unknownOnly.windows, [])
check('⑤ 未知类型：套餐名缺失 → plan=null', unknownOnly && unknownOnly.plan, null)

// ================= ⑥ 去重 / 套餐名 / 重置时刻 / 异常结构 =================
const bothKinds = parseZaiQuota({
  data: { level: 'standard', limits: [
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, usage: 100, currentValue: 10, percentage: 10 },
    { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 2000, currentValue: 400, percentage: 20 },
  ] },
}, WINDOW_LABELS)
check('⑥ 迁移期类型并存：同窗口键只取首个，不重复渲染', bothKinds && bothKinds.windows.length, 1)
check('⑥ 迁移期类型并存：取首个窗口的数值', bothKinds && bothKinds.windows[0].usedPercent, 10)
check('⑥ 套餐名：未知 level 走首字母大写兜底', parseZaiQuota({ data: { level: 'ultra', limits: [] } }, WINDOW_LABELS).plan, '智谱 Ultra')
check('⑥ 套餐名：无 level 时回退 body.planName', parseZaiQuota({ planName: 'GLM Coding Pro', data: { limits: [] } }, WINDOW_LABELS).plan, 'GLM Coding Pro')
check('⑥ 重置时刻：秒级时间戳 → 毫秒', parseZaiQuota({ data: { limits: [{ type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 100, currentValue: 1, nextResetTime: 1789284984 }] } }, WINDOW_LABELS).windows[0].resetsAt, 1789284984000)
check('⑥ 重置时刻：ISO 字符串 → 毫秒', parseZaiQuota({ data: { limits: [{ type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 100, currentValue: 1, nextResetTime: '2026-09-16T08:26:46+00:00' }] } }, WINDOW_LABELS).windows[0].resetsAt, Date.parse('2026-09-16T08:26:46+00:00'))
check('⑥ 重置时刻：缺失 → null（完整模式仍显示该窗口；简洁模式由客户端兜底选窗）', parseZaiQuota({ data: { limits: [{ type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 100, currentValue: 1 }] } }, WINDOW_LABELS).windows[0].resetsAt, null)
// 数字字符串时间戳：Date.parse('1789284984350') 是 NaN → 必须走数值分支，否则简洁模式会整组消失
check('⑥ 重置时刻：纯数字字符串（毫秒）→ 毫秒', parseZaiQuota({ data: { limits: [{ type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 100, currentValue: 1, nextResetTime: '1789284984350' }] } }, WINDOW_LABELS).windows[0].resetsAt, 1789284984350)
check('⑥ 重置时刻：纯数字字符串（秒）→ 毫秒', normalizeResetAt('1789284984'), 1789284984000)
check('⑥ 重置时刻：带空白数字字符串 → 毫秒', normalizeResetAt('  1789284984350  '), 1789284984350)
check('⑥ 重置时刻：非数字字符串仍走 Date.parse', normalizeResetAt('2026-09-16T08:26:46+00:00'), Date.parse('2026-09-16T08:26:46+00:00'))
check('⑥ 重置时刻：垃圾字符串 → null', normalizeResetAt('not-a-date'), null)
check('⑥ 重置时刻：负数 → null', normalizeResetAt(-5), null)
check('⑥ 异常结构：body 非对象 → null', parseZaiQuota(null, WINDOW_LABELS), null)
check('⑥ 异常结构：data 缺失 → null', parseZaiQuota({ code: 200 }, WINDOW_LABELS), null)
check('⑥ 异常结构：limits 缺失 → 空窗口（有套餐名）', parseZaiQuota({ data: { level: 'lite' } }, WINDOW_LABELS), { plan: '智谱 Lite', windows: [] })
check('⑥ 异常结构：limits 非数组 → 空窗口', parseZaiQuota({ data: { level: 'lite', limits: 'oops' } }, WINDOW_LABELS), { plan: '智谱 Lite', windows: [] })
check('⑥ 不传 windowLabels → 回退模块兜底字典', parseZaiQuota({ data: { limits: [{ type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 100, currentValue: 1 }] } }).windows[0].label, '5 小时')

// ================= ⑦ i18n 与客户端兜底 =================
ok('⑦ locales：host.hour / ui.weekly / ui.monthly 三键齐备', ["host.hour", "ui.weekly", "ui.monthly"].every(function (k) { return localeSrc.indexOf('"' + k + '"') >= 0 }))
ok('⑦ locales：空窗口错误文案中英双语齐备', localeSrc.split('"host.zhipuQuotaWindowsUnrecognized"').length === 3)
// 客户端简洁模式兜底：resetsAt 全为 null 时必须退回按时长选最短窗口，否则额度整组静默消失
const clientSrc = readFileSync(join(root, 'plugin', 'src', 'client-bundle.js'), 'utf8')
ok('⑦ 客户端：简洁模式无重置时刻时仍选窗（不复用只认 resetsAt 的旧写法）',
  clientSrc.indexOf('windowsWithReset.length > 0 ? windowsWithReset : windows') >= 0)

console.log('\n' + (fail === 0 ? '全部通过' : fail + ' 项失败') + '：' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
