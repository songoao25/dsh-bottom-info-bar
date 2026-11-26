// 远程价目目录体系（v1.8）静态与数据校验
// 覆盖：① host 具备远程合并/回填联动 ② catalog/pricing.json 存在且条目全部通过白名单规则
//      ③ 内置表兜底仍存在（断网可用）
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
let pass = 0, fail = 0
function check(label, ok) {
  if (ok) { pass++; console.log('PASS  ' + label) }
  else { fail++; console.log('FAIL  ' + label) }
}

const host = readFileSync(join(root, 'src/host.js'), 'utf8')
// 价目表与作用域键解析已下沉到 src/accounting.js（issue #260）。
const accounting = readFileSync(join(root, 'src/accounting.js'), 'utf8')

// 1) 框架构件齐全
check('host 含远程价目 URL 常量', host.includes("REMOTE_PRICING_URL ="), true)
check('host 含条目白名单校验（sanitizeRemotePricingEntries）', host.includes('function sanitizeRemotePricingEntries'), true)
check('host 合并后自动重跑 unpriced 回填', /applyRemotePricingEntries\(entries\) \{[\s\S]*?backfillUnpricedRecords\(\)/.test(host), true)
check('启动序列：磁盘缓存→回填→异步远程刷新', host.includes("refreshRemotePricing('启动')") && host.includes('cachedPricing'), true)
check('定时刷新存在（6h）', host.includes('REMOTE_PRICING_REFRESH_MS'), true)
check('304 短路（ETag 未变不重复合并）', host.includes("res.status === 304"), true)
check('失败降级路径（沿用缓存/内置表，不抛出）', host.includes('沿用缓存/内置表'), true)
check('只接受声明式数字（flat 与 peak-valley 均过数值护栏，其余 mode 拒收）', host.includes("e.mode === 'flat'") && host.includes("e.mode === 'peak-valley'") && host.includes('offpeak.inputCacheHit > peak.inputCacheHit') && host.includes("/^[A-Z]{3}$/.test(e.currency)"), true)
check('币种白名单改为 ISO 4217 通用（pricing-watch §7.6，不再写死 CNY/USD）', !host.includes("e.currency !== 'CNY' && e.currency !== 'USD'"), true)
check('退役字段透传（retired/retiredAt/successor 校验后保留）', host.includes("e.retired === true") && host.includes("e.retiredAt") && host.includes("e.successor"), true)
check('目录 meta 块校验存在（sanitizePricingCatalogMeta）', host.includes('function sanitizePricingCatalogMeta'), true)
check('价目验证状态存在（pricingCatalogStatus：stale > 7 天 + 节假日过期）', host.includes('function pricingCatalogStatus') && host.includes('isPricingStale'), true)
check('设置页 payload 带 pricingCatalog（供价目行展示）', host.includes('pricingCatalog: pricingCatalogStatus()'), true)
check('磁盘缓存存 meta（checkedAt 随条目同源落盘）', host.includes('meta: remotePricingMeta'), true)
check('容量上限防滥用（≤512 条）', host.includes('>= 512'), true)

// 3) 聚合商"直读真实账单"路径：官方报出的钱优先于本地换算
check('记录层支持服务商报告的真实金额（严格清洗 u.cost）', host.includes('const reportedCost = parseFiniteNonNegativeAmount(u.cost)')
  && host.includes('billed == null && reportedCost != null'), true)
check('聚合商币种登记表存在（OpenRouter=USD）', host.includes("PROVIDER_REPORTED_CURRENCY = { openrouter: 'USD' }"), true)
check('账单来源版本标记 provider-reported', host.includes("'provider-reported-'"), true)

// 4) 服务商作用域键（同名模型跨币种计费域）
check('记账引擎支持作用域键回退链（provider:model → model）', accounting.includes("const scopedKey = pricingProviderFor(provider, billingCurrency) + ':' + model")
  && accounting.includes('Object.hasOwn(PRICING, scopedKey)')
  && accounting.includes('Object.hasOwn(PRICING, model)'), true)
check('目录允许作用域键（sanitizer 含冒号白名单）', host.includes('[A-Za-z0-9._:-]'), true)
check('Kimi 国内域以 moonshotai-cn: 作用域收录（防串币种）', accounting.includes("'moonshotai-cn:kimi-k3'"), true)

// 2) 目录文件本体
const catalogPath = join(root, 'catalog/pricing.json')
check('catalog/pricing.json 存在', existsSync(catalogPath), true)
if (existsSync(catalogPath)) {
  let raw = null
  try { raw = JSON.parse(readFileSync(catalogPath, 'utf8')) } catch (err) { raw = null }
  check('catalog 可解析为 JSON 对象', raw && typeof raw === 'object' && !Array.isArray(raw), true)
  const badKey = Object.keys(raw).filter(function (k) { return !/^[A-Za-z0-9._:-]{1,64}$/.test(k) })
  check('所有 key 符合模型名规范', badKey.length === 0, true)
  // pricing-watch §7.5：目录顶层除模型条目外含 meta 块与 tools 区；数值校验跳过这两个键
  const entryKeys = Object.keys(raw).filter(function (k) { return k !== 'meta' && k !== 'tools' })
  const badVal = entryKeys.filter(function (k) {
    const e = raw[k]
    if (!e || typeof e !== 'object') return true
    if (!/^[A-Z]{3}$/.test(e.currency)) return true
    function legBad(leg) {
      if (!leg || typeof leg !== 'object') return true
      const hit = Number(leg.inputCacheHit)
      const miss = Number(leg.inputCacheMiss)
      const out = Number(leg.output)
      if (!Number.isFinite(hit) || !Number.isFinite(miss) || !Number.isFinite(out)) return true
      if (miss <= 0 || hit < 0 || out < 0 || hit > miss) return true
      return false
    }
    if (e.mode === 'flat') return legBad(e.price)
    if (e.mode === 'peak-valley') {
      if (legBad(e.peak) || legBad(e.offpeak)) return true
      if (e.offpeak.inputCacheHit > e.peak.inputCacheHit || e.offpeak.inputCacheMiss > e.peak.inputCacheMiss || e.offpeak.output > e.peak.output) return true
      return false
    }
    return true
  })
  check('所有条目通过数值与币种校验', badVal.length === 0, true)
  // 用户当前主用模型的价目必须在场（无论内置还是目录提供）
  const glmKeys = Object.keys(raw).filter(function (k) { return k.indexOf('glm-5.3') === 0 })
  check('glm-5.3 系列价目已在目录收录', glmKeys.length >= 1, true)
  // pricing-watch §7.5：meta 块（验证戳）与 tools 区（TTS/ASR 工具价）随目录同源
  check('目录含 meta 块（schemaVersion 2 + checkedAt + sourceHash + holidaysThrough）',
    raw.meta && raw.meta.schemaVersion === 2
    && typeof raw.meta.checkedAt === 'string' && !Number.isNaN(Date.parse(raw.meta.checkedAt))
    && /^[0-9a-f]{64}$/.test(raw.meta.sourceHash || '')
    && typeof raw.meta.ruleHash === 'string'
    && Number.isInteger(raw.meta.holidaysThrough) && raw.meta.holidaysThrough >= 2027, true)
  check('meta.sources 指回两张官方价目页',
    raw.meta && raw.meta.sources
    && raw.meta.sources.USD === 'https://api-docs.deepseek.com/quick_start/pricing'
    && raw.meta.sources.CNY === 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing', true)
  check('目录含 tools 区（search/fetch/ocr 单价 + tts/asr 刊例/限时，双币种）',
    raw.tools && typeof raw.tools.search === 'object' && typeof raw.tools.search.CNY === 'number' && typeof raw.tools.search.USD === 'number'
    && raw.tools.tts && typeof raw.tools.tts.CNY === 'object' && typeof raw.tools.tts.CNY.limitedTime === 'number'
    && raw.tools.asr && typeof raw.tools.asr.USD === 'object' && typeof raw.tools.asr.USD.list === 'number', true)
  check('tools.tts/asr 限时价低于刊例价（限时折扣在场）',
    raw.tools && raw.tools.tts.CNY.limitedTime < raw.tools.tts.CNY.list
    && raw.tools.asr.USD.limitedTime < raw.tools.asr.USD.list, true)
  // 设置页价目行（client-bundle + locales）
  const bundle = readFileSync(join(root, 'src/client-bundle.js'), 'utf8')
  check('设置页有价目验证状态区（bibSetPricingCatalogSection）', bundle.includes('function bibSetPricingCatalogSection'), true)
  check('价目行注册在货币设置之后', bundle.includes("{ id: 'pricing', render: function (deps) { return bibSetPricingCatalogSection({ pricingCatalog: deps.pricingCatalog }); } }"), true)
  check('价目行接 getFieldConfig 下发的 pricingCatalog', bundle.includes('pricingCatalog: cfg.pricingCatalog || null') && bundle.includes('pricingCatalog: snapshot.pricingCatalog || null'), true)
  const locales = readFileSync(join(root, 'src/locales.js'), 'utf8')
  check('价目行 5 个文案键在全部 13 语齐全',
    ['ui.pricingCatalogTitle', 'ui.pricingCatalogVerified', 'ui.pricingCatalogBuiltin', 'ui.pricingCatalogStale', 'ui.pricingCatalogHolidaysExpired']
      .every(function (k) { return (locales.match(new RegExp('"' + k + '"', 'g')) || []).length === 13 }), true)
  // 工作流与抓取器存在（pricing-watch）
  check('pricing-watch 工作流存在', existsSync(join(root, '.github/workflows/pricing-watch.yml')), true)
  check('pricing-watch 抓取器存在', existsSync(join(root, 'scripts/pricing-watch.mjs')), true)
  const wf = readFileSync(join(root, '.github/workflows/pricing-watch.yml'), 'utf8')
  check('工作流每小时跑且有 contents: write（提交价目更新）', wf.includes('7 * * * *') && wf.includes('contents: write'), true)
  check('工作流每年 11 月 15 日跑节假日闹钟', wf.includes('0 0 15 11 *') && wf.includes('holiday-alarm'), true)
}

console.log(pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail === 0 ? 0 : 1)
