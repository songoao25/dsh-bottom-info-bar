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

const host = readFileSync(join(root, 'plugin/src/host.js'), 'utf8')

// 1) 框架构件齐全
check('host 含远程价目 URL 常量', host.includes("REMOTE_PRICING_URL ="), true)
check('host 含条目白名单校验（sanitizeRemotePricingEntries）', host.includes('function sanitizeRemotePricingEntries'), true)
check('host 合并后自动重跑 unpriced 回填', /applyRemotePricingEntries\(entries\) \{[\s\S]*?backfillUnpricedRecords\(\)/.test(host), true)
check('启动序列：磁盘缓存→回填→异步远程刷新', host.includes("refreshRemotePricing('启动')") && host.includes('cachedPricing'), true)
check('定时刷新存在（6h）', host.includes('REMOTE_PRICING_REFRESH_MS'), true)
check('304 短路（ETag 未变不重复合并）', host.includes("res.status === 304"), true)
check('失败降级路径（沿用缓存/内置表，不抛出）', host.includes('沿用缓存/内置表'), true)
check('只接受声明式数字（拒绝 remote 分时价/未知币种）', host.includes("e.mode !== 'flat'") && host.includes("e.currency !== 'CNY' && e.currency !== 'USD'"), true)
check('容量上限防滥用（≤512 条）', host.includes('>= 512'), true)

// 3) 聚合商"直读真实账单"路径：官方报出的钱优先于本地换算
check('记录层支持服务商报告的真实金额（u.cost）', /billed == null && typeof u\.cost === 'number'/.test(host), true)
check('聚合商币种登记表存在（OpenRouter=USD）', host.includes("PROVIDER_REPORTED_CURRENCY = { openrouter: 'USD' }"), true)
check('账单来源版本标记 provider-reported', host.includes("'provider-reported-'"), true)

// 4) 服务商作用域键（同名模型跨币种计费域）
check('host 支持作用域键回退链（provider:model → model）', /const scoped = PRICING\[provider \+ ':' \+ model\]/.test(host), true)
check('目录允许作用域键（sanitizer 含冒号白名单）', host.includes('[A-Za-z0-9._:-]'), true)
check('Kimi 国内域以 moonshotai-cn: 作用域收录（防串币种）', host.includes("'moonshotai-cn:kimi-k3'"), true)

// 2) 目录文件本体
const catalogPath = join(root, 'catalog/pricing.json')
check('catalog/pricing.json 存在', existsSync(catalogPath), true)
if (existsSync(catalogPath)) {
  let raw = null
  try { raw = JSON.parse(readFileSync(catalogPath, 'utf8')) } catch (err) { raw = null }
  check('catalog 可解析为 JSON 对象', raw && typeof raw === 'object' && !Array.isArray(raw), true)
  const badKey = Object.keys(raw).filter(function (k) { return !/^[A-Za-z0-9._:-]{1,64}$/.test(k) })
  check('所有 key 符合模型名规范', badKey.length === 0, true)
  const badVal = Object.keys(raw).filter(function (k) {
    const e = raw[k]
    if (!e || typeof e !== 'object' || e.mode !== 'flat') return true
    if (e.currency !== 'CNY' && e.currency !== 'USD') return true
    const hit = Number(e.price && e.price.inputCacheHit)
    const miss = Number(e.price && e.price.inputCacheMiss)
    const out = Number(e.price && e.price.output)
    if (!Number.isFinite(hit) || !Number.isFinite(miss) || !Number.isFinite(out)) return true
    if (miss <= 0 || hit < 0 || out < 0 || hit > miss) return true
    return false
  })
  check('所有条目通过数值与币种校验', badVal.length === 0, true)
  // 用户当前主用模型的价目必须在场（无论内置还是目录提供）
  const glmKeys = Object.keys(raw).filter(function (k) { return k.indexOf('glm-5.3') === 0 })
  check('glm-5.3 系列价目已在目录收录', glmKeys.length >= 1, true)
}

console.log(pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail === 0 ? 0 : 1)
