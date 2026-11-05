// DeepSeek 周末峰谷规则：2026-08-23 00:00（北京时间）起，周六日全天空闲价。
// 直接提取正式源码的纯函数，覆盖生效边界、周末及跨周倒计时。
import { readFileSync } from 'node:fs'
import { currentPeriod } from '../src/accounting.js'

// 峰谷判定已下沉到 src/accounting.js（issue #260，host 与账本 worker 共用同一份）。
// 这里只从 host.js 提取面向展示的 nextPeriodLabel，并把 currentPeriod 注入其求值作用域。
const source = readFileSync(new URL('../src/host.js', import.meta.url), 'utf8')
const nextBlock = source.match(/    function nextSwitchAt\(nowMs\) \{[\s\S]*?(?=\n    \/\/ ---------- 当前模型识别 ----------)/)
if (!nextBlock) throw new Error('未找到周末峰谷倒计时逻辑')
const offsetMatch = source.match(/const BEIJING_OFFSET_MS = ([^;\n]+)/)
if (!offsetMatch) throw new Error('未找到 BEIJING_OFFSET_MS 定义')
const { nextPeriodLabel } = new Function('BEIJING_OFFSET_MS', 'currentPeriod', nextBlock[0] + '\nreturn { nextPeriodLabel }')(eval(offsetMatch[1]), currentPeriod)

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

check('国庆首日北京时间上午为空闲价', currentPeriod(at('2026-10-01T10:00:00+08:00')), 'offpeak')
check('国庆末日下午为空闲价', currentPeriod(at('2026-10-07T15:00:00+08:00')), 'offpeak')
check('节后工作日恢复高峰价', currentPeriod(at('2026-10-08T09:00:00+08:00')), 'peak')
check('中秋工作日全天空闲', currentPeriod(at('2026-09-25T15:00:00+08:00')), 'offpeak')
check('调休上班的周六依旧空闲', currentPeriod(at('2026-10-10T10:00:00+08:00')), 'offpeak')
check('节前倒计时跨越国庆长假', nextPeriodLabel(at('2026-09-30T18:00:00+08:00')).at, at('2026-10-08T09:00:00+08:00'))
check('中秋倒计时跨越假期和周末', nextPeriodLabel(at('2026-09-24T18:00:00+08:00')).at, at('2026-09-28T09:00:00+08:00'))
check('国庆前一天仍为高峰', currentPeriod(at('2026-09-30T15:00:00+08:00')), 'peak')
check('UTC 日期不同仍按北京国庆日期', currentPeriod(at('2026-10-01T01:00:00Z')), 'offpeak')
check('旧规则时期不重算春节价格', currentPeriod(at('2026-02-16T10:00:00+08:00')), 'peak')
check('未知年份保留工作日规则', currentPeriod(at('2027-10-01T10:00:00+08:00')), 'peak')

process.exit(failures === 0 ? 0 : 1)
