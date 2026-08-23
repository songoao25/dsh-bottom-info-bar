// DeepSeek 周末峰谷规则：2026-08-23 00:00（北京时间）起，周六日全天空闲价。
// 直接提取正式源码的纯函数，覆盖生效边界、周末及跨周倒计时。
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../plugin/src/host.js', import.meta.url), 'utf8')
const block = source.match(/const WEEKEND_OFFPEAK_EFFECTIVE_AT = [\s\S]*?(?=\n    \/\/ ---------- 当前模型识别 ----------)/)
if (!block) throw new Error('未找到周末峰谷判定逻辑')
const { currentPeriod, nextPeriodLabel } = eval(`(() => {${block[0]}\nreturn { currentPeriod, nextPeriodLabel }; })()`)

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`)
  if (!ok) failures += 1
}
const at = (value) => Date.parse(value)

check('新规则生效前的周六高峰仍按高峰价', currentPeriod(at('2026-08-22T10:00:00+08:00')), 'peak')
check('生效时刻起的周日高峰时段按空闲价', currentPeriod(at('2026-08-23T10:00:00+08:00')), 'offpeak')
check('此后周六高峰时段按空闲价', currentPeriod(at('2026-08-29T15:00:00+08:00')), 'offpeak')
check('工作日高峰时段保持高峰价', currentPeriod(at('2026-08-24T09:00:00+08:00')), 'peak')
check('工作日非高峰保持空闲价', currentPeriod(at('2026-08-24T12:00:00+08:00')), 'offpeak')
const nextMondayFromSaturday = nextPeriodLabel(at('2026-08-29T15:00:00+08:00'))
const nextMondayFromSunday = nextPeriodLabel(at('2026-08-30T10:00:00+08:00'))
check('周六倒计时跳过周末，指向周一 09:00', nextMondayFromSaturday.at, at('2026-08-31T09:00:00+08:00'))
check('周日倒计时跳过周末，指向周一 09:00', nextMondayFromSunday.at, at('2026-08-31T09:00:00+08:00'))

process.exit(failures === 0 ? 0 : 1)
