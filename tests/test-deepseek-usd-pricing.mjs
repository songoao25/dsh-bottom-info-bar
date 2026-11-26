// DeepSeek 双币种计费域（issue #317 第二阶段）：美元价目表、账户币种定价、2027 假期日历
// 覆盖：① 美元价目（官方英文页 2026-11-26 核对）与人民币价目逐项一致
//      ② pricingProviderFor 作用域映射（deepseek 三通道 × USD）
//      ③ modelCurrency / costOf 按账户币种选表；冻结币种决定 forecast 重算
//      ④ currentPeriod 的 2027 法定节假日（国办发明电〔2026〕10号）与调休上班日
//      ⑤ catalog/pricing.json 的 DeepSeek 四条目与内置表逐值一致
// 用法：node tests/test-deepseek-usd-pricing.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAccounting, currentPeriod, pricingProviderFor } from '../src/accounting.js'

const root = process.cwd()
let pass = 0, fail = 0
function check(label, ok) {
  if (ok) { pass++; console.log('PASS  ' + label) }
  else { fail++; console.log('FAIL  ' + label) }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

const accounting = createAccounting()
const PRICING = accounting.PRICING

// ---------- ① 美元价目与人民币价目 ----------
check('美元 flash 条目存在（USD / peak-valley）',
  PRICING['deepseek-usd:deepseek-flash']
  && PRICING['deepseek-usd:deepseek-flash'].currency === 'USD'
  && PRICING['deepseek-usd:deepseek-flash'].mode === 'peak-valley')
check('美元 flash 高峰价 = 官方 0.006 / 0.30 / 1.20',
  eq(PRICING['deepseek-usd:deepseek-flash'].peak, { inputCacheHit: 0.006, inputCacheMiss: 0.3, output: 1.2 }))
check('美元 flash 空闲价 = 官方 0.003 / 0.15 / 0.60（高峰一半）',
  eq(PRICING['deepseek-usd:deepseek-flash'].offpeak, { inputCacheHit: 0.003, inputCacheMiss: 0.15, output: 0.6 }))
check('美元 v4-pro 条目存在（USD / peak-valley）',
  PRICING['deepseek-usd:deepseek-v4-pro']
  && PRICING['deepseek-usd:deepseek-v4-pro'].currency === 'USD'
  && PRICING['deepseek-usd:deepseek-v4-pro'].mode === 'peak-valley')
check('美元 v4-pro 高峰价 = 官方 0.044 / 1.32 / 3.96',
  eq(PRICING['deepseek-usd:deepseek-v4-pro'].peak, { inputCacheHit: 0.044, inputCacheMiss: 1.32, output: 3.96 }))
check('美元 v4-pro 空闲价 = 官方 0.022 / 0.66 / 1.98（高峰一半）',
  eq(PRICING['deepseek-usd:deepseek-v4-pro'].offpeak, { inputCacheHit: 0.022, inputCacheMiss: 0.66, output: 1.98 }))
check('人民币 flash 价未变（高峰 0.04 / 2 / 8）',
  eq(PRICING['deepseek-flash'].peak, { inputCacheHit: 0.04, inputCacheMiss: 2, output: 8 })
  && eq(PRICING['deepseek-flash'].offpeak, { inputCacheHit: 0.02, inputCacheMiss: 1, output: 4 }))
check('人民币 v4-pro 价未变（高峰 0.30 / 9 / 27）',
  eq(PRICING['deepseek-v4-pro'].peak, { inputCacheHit: 0.3, inputCacheMiss: 9, output: 27 })
  && eq(PRICING['deepseek-v4-pro'].offpeak, { inputCacheHit: 0.15, inputCacheMiss: 4.5, output: 13.5 }))

// ---------- ② 作用域映射 ----------
// 人民币表与美元表不是简单换算：v4-pro 人民币未命中 ¥9.0 vs 美元 $1.32×6.67=¥8.80，
// 差约 2%——所以必须按账户币种选表，不能拿人民币价折算。
check('deepseek + USD → deepseek-usd', pricingProviderFor('deepseek', 'USD') === 'deepseek-usd')
check('deepseek-official + USD → deepseek-usd', pricingProviderFor('deepseek-official', 'USD') === 'deepseek-usd')
check('deepseek-account + USD → deepseek-usd', pricingProviderFor('deepseek-account', 'USD') === 'deepseek-usd')
check('deepseek + CNY → 不变', pricingProviderFor('deepseek', 'CNY') === 'deepseek')
check('deepseek + 无币种 → 不变（默认人民币价）', pricingProviderFor('deepseek', null) === 'deepseek'
  && pricingProviderFor('deepseek', undefined) === 'deepseek')
check('非 DeepSeek provider + USD → 不变', pricingProviderFor('openai', 'USD') === 'openai'
  && pricingProviderFor('moonshotai', 'USD') === 'moonshotai')
check('空/非法 provider 原样返回', pricingProviderFor('', 'USD') === '' && pricingProviderFor(null, 'USD') === null)

// ---------- ③ 按账户币种选表 ----------
check('modelCurrency：deepseek flash + USD → USD', accounting.modelCurrency('deepseek', 'deepseek-flash', 'USD') === 'USD')
check('modelCurrency：deepseek-official v4-pro + USD → USD', accounting.modelCurrency('deepseek-official', 'deepseek-v4-pro', 'USD') === 'USD')
check('modelCurrency：deepseek flash + CNY → CNY', accounting.modelCurrency('deepseek', 'deepseek-flash', 'CNY') === 'CNY')
check('modelCurrency：不传币种 → CNY（既有默认不变）', accounting.modelCurrency('deepseek', 'deepseek-flash') === 'CNY')
check('modelCurrency：deepseek-chat + USD → CNY（无美元官方价，不编造，回退人民币价）',
  accounting.modelCurrency('deepseek', 'deepseek-chat', 'USD') === 'CNY')
check('modelCurrency：openai 不受币种参数影响', accounting.modelCurrency('openai', 'gpt-4o', 'USD') === 'USD')

// 峰时：2026-11-27 周五北京时间 10:00（= UTC 02:00）；空闲：同日 20:00（= UTC 12:00）
const peakTs = Date.UTC(2026, 10, 27, 2, 0, 0)
const offpeakTs = Date.UTC(2026, 10, 27, 12, 0, 0)
check('currentPeriod：周五 10:00 北京时间 = 高峰', currentPeriod(peakTs) === 'peak')
check('currentPeriod：周五 20:00 北京时间 = 空闲', currentPeriod(offpeakTs) === 'offpeak')
function rec(provider, model, ts, input, cacheRead, cacheWrite, output, currency) {
  const r = { provider: provider, model: model, ts: ts, input: input, cacheRead: cacheRead, cacheWrite: cacheWrite, output: output }
  if (currency) r.currency = currency
  return r
}
// 1M 未命中输入 + 1M 输出：美元 flash 高峰 0.30+1.20=$1.50；空闲 0.15+0.60=$0.75
check('costOf：美元 flash 高峰 1M+1M = $1.50',
  accounting.costOf(rec('deepseek', 'deepseek-flash', peakTs, 1e6, 0, 0, 1e6), false, 'USD') === 1.5)
check('costOf：美元 flash 空闲 1M+1M = $0.75',
  accounting.costOf(rec('deepseek', 'deepseek-flash', offpeakTs, 1e6, 0, 0, 1e6), false, 'USD') === 0.75)
check('costOf：美元 flash 高峰 1M 缓存命中 = $0.006',
  accounting.costOf(rec('deepseek', 'deepseek-flash', peakTs, 0, 1e6, 0, 0), false, 'USD') === 0.006)
check('costOf：美元 v4-pro 高峰 1M+1M = $5.28',
  accounting.costOf(rec('deepseek', 'deepseek-v4-pro', peakTs, 1e6, 0, 0, 1e6), false, 'USD') === 5.28)
check('costOf：人民币 flash 高峰 1M+1M = ¥10（不传币种，行为不变）',
  accounting.costOf(rec('deepseek', 'deepseek-flash', peakTs, 1e6, 0, 0, 1e6), false) === 10)
// 冻结币种决定 forecast 重算：已落盘的美元记录，forceOffpeak 也按美元表重算
check('costOf：冻结 USD 的记录，forceOffpeak 重算 = 空闲美元价 $0.75',
  accounting.costOf(rec('deepseek', 'deepseek-flash', peakTs, 1e6, 0, 0, 1e6, 'USD'), true) === 0.75)
check('costOf：冻结 CNY 的记录，forceOffpeak 重算 = 空闲人民币价 ¥5',
  accounting.costOf(rec('deepseek', 'deepseek-flash', peakTs, 1e6, 0, 0, 1e6, 'CNY'), true) === 5)
check('costOf：冻结 USD 的记录，不传币种参数也走美元表',
  accounting.costOf(rec('deepseek', 'deepseek-flash', peakTs, 1e6, 0, 0, 1e6, 'USD'), false) === 1.5)

// ---------- ④ 2027 法定节假日 ----------
// 北京时间 10:00（= UTC 02:00）本是高峰窗口；落在法定节假日则为空闲。
function holidayTs(y, m, d) { return Date.UTC(y, m - 1, d, 2, 0, 0) }
check('2027 元旦 1/1（周五）= 空闲', currentPeriod(holidayTs(2027, 1, 1)) === 'offpeak')
check('2027 除夕 2/5（周五）= 空闲', currentPeriod(holidayTs(2027, 2, 5)) === 'offpeak')
check('2027 春节 2/8（周一）= 空闲', currentPeriod(holidayTs(2027, 2, 8)) === 'offpeak')
check('2027 清明 4/5（周一）= 空闲', currentPeriod(holidayTs(2027, 4, 5)) === 'offpeak')
check('2027 劳动节 5/3（周一）= 空闲', currentPeriod(holidayTs(2027, 5, 3)) === 'offpeak')
check('2027 端午 6/9（周三）= 空闲', currentPeriod(holidayTs(2027, 6, 9)) === 'offpeak')
check('2027 中秋 9/15（周三）= 空闲', currentPeriod(holidayTs(2027, 9, 15)) === 'offpeak')
check('2027 国庆 10/4（周一）= 空闲', currentPeriod(holidayTs(2027, 10, 4)) === 'offpeak')
check('2027 普通工作日 3/3（周三）10:00 = 高峰', currentPeriod(holidayTs(2027, 3, 3)) === 'peak')
check('2027 调休上班日 1/31（周日）= 空闲（周末规则；DeepSeek 高峰只认周一至周五）',
  currentPeriod(holidayTs(2027, 1, 31)) === 'offpeak')
check('2026 国庆 10/1（周四）仍为空闲（旧表未动）', currentPeriod(holidayTs(2026, 10, 1)) === 'offpeak')
check('2026 周末 11/28（周六）10:00 = 空闲', currentPeriod(Date.UTC(2026, 10, 28, 2, 0, 0)) === 'offpeak')

// ---------- ⑤ 目录与内置表逐值一致 ----------
// 远程目录是调价的更新通道：四条 DeepSeek 条目必须与内置表同一组数，否则“自动更新”
// 下发的值与内置兜底不一致，同一模型在断网/联网时算出两个价。
const catalog = JSON.parse(readFileSync(join(root, 'catalog/pricing.json'), 'utf8'))
for (const key of ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-usd:deepseek-flash', 'deepseek-usd:deepseek-v4-pro']) {
  const builtin = PRICING[key]
  const entry = catalog[key]
  check('目录 ' + key + ' 与内置表一致（币种/mode/两档三价）',
    !!entry && entry.currency === builtin.currency && entry.mode === builtin.mode
    && eq(entry.peak, builtin.peak) && eq(entry.offpeak, builtin.offpeak))
  check('目录 ' + key + ' 带官方来源链接', typeof entry.source === 'string' && entry.source.indexOf('api-docs.deepseek.com') !== -1)
}

console.log(pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail === 0 ? 0 : 1)
