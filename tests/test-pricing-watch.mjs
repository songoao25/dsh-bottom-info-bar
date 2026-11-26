// pricing-watch 抓取器测试（离线）：解析 + 校验 + 目录生成
// 覆盖：① 对 2026-11-27 实测页面快照解析，模型六数/工具价/脚注与报告 §2 表逐值一致
//      ② 10 条校验契约的正反两面（半价恒等式、单调性、变动隔离带、隐含汇率带与漂移、
//         脚注哈希、限时价消失告警、新模型双币种、退役标记不删）
//      ③ 目录生成：meta 块、tools 区、原有条目原样保留、退役模型标 retired
//      ④ Change Log 只做旁证（最新条目提取，不影响校验）
// 用法：node tests/test-pricing-watch.mjs（无网络，读 tests/fixtures 快照）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parsePricingPage, parseChangeLog, validateParsed, buildCatalog, canonicalVector,
  holidaysThroughFromAccounting, toMicro, sha256Hex, stripCell,
} from '../scripts/pricing-watch.mjs'

const root = process.cwd()
const fixtures = join(root, 'tests', 'fixtures')
let pass = 0, fail = 0
function check(label, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + label) }
  else { fail++; console.log('FAIL  ' + label + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

const htmlEn = readFileSync(join(fixtures, 'deepseek-pricing-en-20261127.html'), 'utf8')
const htmlCn = readFileSync(join(fixtures, 'deepseek-pricing-cn-20261127.html'), 'utf8')
const logEn = readFileSync(join(fixtures, 'deepseek-changelog-en-20261127.html'), 'utf8')
const logCn = readFileSync(join(fixtures, 'deepseek-changelog-cn-20261127.html'), 'utf8')
const catalog = JSON.parse(readFileSync(join(root, 'catalog', 'pricing.json'), 'utf8'))
const accountingSrc = readFileSync(join(root, 'src', 'accounting.js'), 'utf8')

// ---------- ① 解析：模型六数与报告 §2 表逐值一致 ----------
const parsedEn = parsePricingPage(htmlEn, 'USD')
const parsedCn = parsePricingPage(htmlCn, 'CNY')
const parsed = { USD: parsedEn, CNY: parsedCn }
check('英文页解析出 flash 与 v4-pro 两个模型', eq(Object.keys(parsedEn.models).sort(), ['deepseek-flash', 'deepseek-v4-pro']))
check('中文页解析出 flash 与 v4-pro 两个模型', eq(Object.keys(parsedCn.models).sort(), ['deepseek-flash', 'deepseek-v4-pro']))
check('USD flash 六数 = 官方 0.003/0.006、0.15/0.30、0.60/1.20',
  eq(parsedEn.models['deepseek-flash'], {
    inputCacheHit: { offpeak: '0.003', peak: '0.006' },
    inputCacheMiss: { offpeak: '0.15', peak: '0.3' },
    output: { offpeak: '0.6', peak: '1.2' },
  }))
check('USD v4-pro 六数 = 官方 0.022/0.044、0.66/1.32、1.98/3.96',
  eq(parsedEn.models['deepseek-v4-pro'], {
    inputCacheHit: { offpeak: '0.022', peak: '0.044' },
    inputCacheMiss: { offpeak: '0.66', peak: '1.32' },
    output: { offpeak: '1.98', peak: '3.96' },
  }))
check('CNY flash 六数 = 官方 0.02/0.04、1/2、4/8',
  eq(parsedCn.models['deepseek-flash'], {
    inputCacheHit: { offpeak: '0.02', peak: '0.04' },
    inputCacheMiss: { offpeak: '1', peak: '2' },
    output: { offpeak: '4', peak: '8' },
  }))
check('CNY v4-pro 六数 = 官方 0.15/0.30、4.5/9.0、13.5/27.0',
  eq(parsedCn.models['deepseek-v4-pro'], {
    inputCacheHit: { offpeak: '0.15', peak: '0.30' },
    inputCacheMiss: { offpeak: '4.5', peak: '9.0' },
    output: { offpeak: '13.5', peak: '27.0' },
  }))
check('英文脚注 (2) 含峰谷规则原文', parsedEn.footnote.indexOf('Off-peak rates are half of the peak rates') === 0
  && parsedEn.footnote.indexOf('excluding Chinese public holidays') !== -1)
check('中文脚注 (2) 含峰谷规则原文', parsedCn.footnote.indexOf('空闲时段价格为高峰时段价格的一半') === 0
  && parsedCn.footnote.indexOf('中国法定节假日') !== -1)
check('工具表：search/fetch 0.75、ocr 0.225（USD）',
  eq(parsedEn.tools.search, { price: '0.75' }) && eq(parsedEn.tools.fetch, { price: '0.75' })
  && eq(parsedEn.tools.ocr, { price: '0.225' }))
check('工具表：tts 刊例 0.45/限时 0.225、asr 刊例 0.116/限时 0.058（USD）',
  eq(parsedEn.tools.tts, { list: '0.45', limitedTime: '0.225' })
  && eq(parsedEn.tools.asr, { list: '0.116', limitedTime: '0.058' }))
check('工具表：search/fetch 5、ocr 1.5、tts 3/1.5、asr 0.78/0.39（CNY）',
  eq(parsedCn.tools.search, { price: '5' }) && eq(parsedCn.tools.ocr, { price: '1.5' })
  && eq(parsedCn.tools.tts, { list: '3', limitedTime: '1.5' })
  && eq(parsedCn.tools.asr, { list: '0.78', limitedTime: '0.39' }))

// ---------- ② 校验：当前页 + 当前目录全部通过 ----------
const good = validateParsed(parsed, catalog)
check('当前快照全部校验通过（零失败）', good.failures.length === 0, good.failures)
check('当前快照零警告（限时折扣未消失）', good.warnings.length === 0, good.warnings)

// 反面：空闲价不是高峰一半 → 拒绝
{
  const bad = JSON.parse(JSON.stringify(parsed))
  bad.USD.models['deepseek-flash'].inputCacheHit.offpeak = '0.004'
  const r = validateParsed(bad, catalog)
  check('反面：空闲价 ≠ 高峰一半 → 拒绝', r.failures.some(function (f) { return f.indexOf('一半') !== -1 }), r.failures)
}
// 反面：价格形态含千分位符 → 解析失败（整批拒绝）
{
  const badHtml = htmlEn.replace('<td>$0.003</td>', '<td>$1,000.003</td>')
  let threw = false
  try { parsePricingPage(badHtml, 'USD') } catch (err) { threw = true }
  check('反面：价格带千分位符 → 解析抛错', threw)
}
// 反面：缺一个数字 → 解析失败
{
  const badHtml = htmlEn.replace('<td>$0.003</td>', '<td></td>')
  let threw = false
  try { parsePricingPage(badHtml, 'USD') } catch (err) { threw = true }
  check('反面：缺一个价格 → 解析抛错', threw)
}
// 反面：单档变动超隔离带（10×）→ 拒绝
{
  const bad = JSON.parse(JSON.stringify(parsed))
  bad.USD.models['deepseek-flash'].output.peak = '12'
  bad.USD.models['deepseek-flash'].output.offpeak = '6'
  const r = validateParsed(bad, catalog)
  check('反面：单档 10× 变动 → 拒绝（隔离带）', r.failures.some(function (f) { return f.indexOf('隔离带') !== -1 }), r.failures)
}
// 反面：隐含汇率出带（把人民币数抄进美元表）→ 拒绝
{
  const bad = JSON.parse(JSON.stringify(parsed))
  bad.USD.models['deepseek-flash'].output.peak = '8'
  bad.USD.models['deepseek-flash'].output.offpeak = '4'
  const r = validateParsed(bad, catalog)
  check('反面：隐含汇率 4.0 超出 [5.0, 9.0] → 拒绝', r.failures.some(function (f) { return f.indexOf('隐含汇率') !== -1 }), r.failures)
}
// 反面：脚注变化 → 隔离
{
  const bad = JSON.parse(JSON.stringify(parsed))
  bad.USD.footnote = bad.USD.footnote + ' (changed)'
  const r = validateParsed(bad, catalog)
  check('反面：峰谷脚注变化 → 隔离拒绝', r.failures.some(function (f) { return f.indexOf('脚注') !== -1 }), r.failures)
}
// 反面：双页模型集合不一致 → 拒绝
{
  const bad = JSON.parse(JSON.stringify(parsed))
  delete bad.CNY.models['deepseek-v4-pro']
  const r = validateParsed(bad, catalog)
  check('反面：双页模型集合不一致 → 拒绝', r.failures.some(function (f) { return f.indexOf('不一致') !== -1 }), r.failures)
}
// 正面：限时价消失 → 警告（不当作静默续算），但不拒绝本批
{
  const prev = JSON.parse(JSON.stringify(catalog))
  const bad = JSON.parse(JSON.stringify(parsed))
  bad.USD.tools.tts.limitedTime = null
  bad.CNY.tools.tts.limitedTime = null
  const r = validateParsed(bad, prev)
  check('限时价消失 → 警告不拒绝', r.failures.length === 0 && r.warnings.some(function (w) { return w.indexOf('限时折扣已结束') !== -1 }), { failures: r.failures, warnings: r.warnings })
}
// 十进制精确比较：0.003*2 === 0.006（不用浮点近似）
check('toMicro 十进制精确：0.003×2 = 0.006', toMicro('0.003') * 2n === toMicro('0.006'))
check('toMicro 拒收超 6 位小数', toMicro('0.0000001') === null)

// ---------- ③ 目录生成 ----------
const built = buildCatalog(catalog, parsed, { nowIso: '2026-11-27T00:00:00.000Z', holidaysThrough: 2027 })
check('生成目录含 meta 块（schemaVersion 2）', built.catalog.meta.schemaVersion === 2)
check('meta.checkedAt = 本轮时间', built.catalog.meta.checkedAt === '2026-11-27T00:00:00.000Z')
check('meta.sourceHash = 规范向量哈希', built.catalog.meta.sourceHash === sha256Hex(canonicalVector(parsed)))
check('meta.sources 指回两张官方价目页',
  built.catalog.meta.sources.CNY === 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
  && built.catalog.meta.sources.USD === 'https://api-docs.deepseek.com/quick_start/pricing')
check('meta.holidaysThrough = 2027', built.catalog.meta.holidaysThrough === 2027)
check('非 DeepSeek 条目原样保留（glm-5.3 未动）', eq(built.catalog['glm-5.3'], catalog['glm-5.3']))
check('DeepSeek 四条目数值与上一份一致（无价格变化）', built.changes.length === 0, built.changes)
check('tools 区：search 双币种 5 / 0.75', eq(built.catalog.tools.search, { unit: 'per 1000 successful requests', CNY: 5, USD: 0.75 }))
check('tools 区：tts 双币种刊例/限时',
  eq(built.catalog.tools.tts, { unit: 'per 10000 characters', CNY: { list: 3, limitedTime: 1.5 }, USD: { list: 0.45, limitedTime: 0.225 } }))
check('tools 区：asr 双币种刊例/限时',
  eq(built.catalog.tools.asr, { unit: 'per hour of audio', CNY: { list: 0.78, limitedTime: 0.39 }, USD: { list: 0.116, limitedTime: 0.058 } }))
check('假期年份从 accounting.js 表读到 2027', holidaysThroughFromAccounting(accountingSrc) === 2027)
// 退役：上一份目录有的 DeepSeek 模型从页上消失 → 标 retired 不删，承接关系写入
{
  const prev = JSON.parse(JSON.stringify(catalog))
  prev['deepseek-chat'] = { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.5, inputCacheMiss: 2, output: 8 }, source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing' }
  const b = buildCatalog(prev, parsed, { nowIso: '2026-11-27T00:00:00.000Z', holidaysThrough: 2027 })
  check('退役模型标 retired 不删（数字保留）',
    b.catalog['deepseek-chat'].retired === true && b.catalog['deepseek-chat'].retiredAt === '2026-11-27'
    && eq(b.catalog['deepseek-chat'].price, { inputCacheHit: 0.5, inputCacheMiss: 2, output: 8 }))
  check('退役模型写 successor（已知承接关系）', b.catalog['deepseek-chat'].successor === 'deepseek-flash')
  check('退役记入 changes', b.changes.some(function (c) { return c.indexOf('模型退役') !== -1 }), b.changes)
}
// 新模型：只有双币种齐全才进目录（单边缺失已在校验层拒绝，这里只验生成）
{
  const next = JSON.parse(JSON.stringify(parsed))
  next.USD.models['deepseek-v5'] = {
    inputCacheHit: { offpeak: '0.001', peak: '0.002' },
    inputCacheMiss: { offpeak: '0.1', peak: '0.2' },
    output: { offpeak: '0.4', peak: '0.8' },
  }
  next.CNY.models['deepseek-v5'] = {
    inputCacheHit: { offpeak: '0.007', peak: '0.014' },
    inputCacheMiss: { offpeak: '0.7', peak: '1.4' },
    output: { offpeak: '2.8', peak: '5.6' },
  }
  const r = validateParsed(next, catalog)
  check('新模型双币种齐全 → 校验通过', r.failures.length === 0, r.failures)
  const b = buildCatalog(catalog, next, { nowIso: '2026-11-27T00:00:00.000Z', holidaysThrough: 2027 })
  check('新模型双币种条目进目录', !!b.catalog['deepseek-v5'] && !!b.catalog['deepseek-usd:deepseek-v5'])
}

// ---------- ⑤ 清洗顺序（CodeQL 回归）：先解码再剥标签 ----------
check('stripCell：普通标签剥掉', stripCell('<b>$0.003</b>') === '$0.003')
check('stripCell：编码过的 <script> 解码后也被剥掉，不残留',
  stripCell('&lt;script&gt;alert(1)') === 'alert(1)' && stripCell('&lt;script&gt;alert(1)').indexOf('<') === -1)
check('stripCell：&amp;lt; 只解一次，不二次解成标签',
  stripCell('&amp;lt;script&amp;gt;') === '&lt;script&gt;')
check('stripCell：无闭合 > 的孤立标签也被剥掉', stripCell('abc<script') === 'abc')

// ---------- ④ Change Log 只做旁证 ----------
const entriesEn = parseChangeLog(logEn)
const entriesCn = parseChangeLog(logCn)
check('英文 Change Log 最新条目 2026-11-13', entriesEn.length > 0 && entriesEn[0].date === '2026-11-13', entriesEn.slice(0, 2))
check('中文 Change Log 存在且最新条目 2026-11-13', entriesCn.length > 0 && entriesCn[0].date === '2026-11-13', entriesCn.slice(0, 2))
check('Change Log 含 2026-09-10 Flash 降价条目', entriesEn.some(function (e) { return e.date === '2026-09-10' }))
check('Change Log 无 2026-08-22 条目（两次只改价目页的先例，日志不能当变化检测器）',
  !entriesEn.some(function (e) { return e.date === '2026-08-22' }))

console.log(pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail === 0 ? 0 : 1)
