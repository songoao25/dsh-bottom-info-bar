// DeepSeek 价目自动更新抓取器（pricing-watch）
//
// 每小时读一次 DeepSeek 官方价目页（英文/USD + 中文/CNY）与 Change Log，
// 严格解析 + 全部校验通过后才把 catalog/pricing.json 写回仓库；
// 任一环节失败 → 整批拒绝、不写目录、退出码非零（CI 据此开 issue 告警）。
//
// 设计依据：~/workspace/plugin-fixes-20261123/RESEARCH-deepseek-auto-pricing-20261127.md §7。
// 关键铁律（报告 §3.3）：变化检测只认价目页本身，Change Log 只做旁证，
// “无新条目”绝不能当成“价格没变”的证据。
//
// 用法：
//   node scripts/pricing-watch.mjs [--catalog catalog/pricing.json] [--dry-run]
//                                   [--save-snapshots <dir>] [--fixtures <dir>]
//   --fixtures <dir>：离线模式，用目录里的四份快照代替联网抓取（测试用）。
//   --dry-run：只校验、不写目录。stdout 只输出一份 JSON 摘要（供 CI 取提交说明/告警正文），
//   人看的日志一律走 stderr。
//   退出码：0 = 已更新 / 无变化 / 仅验讫戳；1 = 校验失败或抓取失败（整批拒绝）。
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const USER_AGENT = 'dsh-bottom-info-bar pricing-watch (contact: feedback@songsong.win)'
export const SOURCES = {
  USD: 'https://api-docs.deepseek.com/quick_start/pricing',
  CNY: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
}
export const CHANGELOG_URLS = [
  'https://api-docs.deepseek.com/updates/',
  'https://api-docs.deepseek.com/zh-cn/updates/',
]
// 已知退役承接关系（官方出处见注释；未知退役模型只标 retired，不猜承接方）：
// deepseek-chat：Change Log 2026-04-24 条目，2026-07-24 起停用；报告 §10-4 决议按 Flash 计价。
// deepseek-v4-flash / deepseek-v4-flash-vision-exp：价目页脚注 (1) 原文，请求由 Flash 按 Flash 价提供服务。
export const KNOWN_SUCCESSORS = {
  'deepseek-chat': 'deepseek-flash',
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
}
export const FX_BAND = [5.0, 9.0] // 跨币种隐含汇率隔离带（报告 §7.3-6）
export const CHANGE_BAND = [0.2, 5.0] // 单档变动幅度隔离带（报告 §7.3-5）
export const FX_DRIFT_MAX = 0.10 // 隐含汇率相对上一份值的最大漂移
export const STAMP_INTERVAL_MS = 24 * 60 * 60 * 1000 // 无变化时每天最多一个验讫戳提交

const LEGS = ['inputCacheHit', 'inputCacheMiss', 'output']
const TOOL_IDS = ['search', 'fetch', 'ocr', 'tts', 'asr']
const TOOL_UNITS = {
  search: 'per 1000 successful requests',
  fetch: 'per 1000 successful requests',
  ocr: 'per 1000 pages',
  tts: 'per 10000 characters',
  asr: 'per hour of audio',
}

function log(msg) { console.error('[pricing-watch] ' + msg) }

// ---------- 十进制精确比较：价格字符串转微单位 BigInt，拒绝浮点近似 ----------
export function toMicro(str) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(str)
  if (!m) return null
  const frac = (m[2] || '').padEnd(6, '0').slice(0, 6)
  if ((m[2] || '').length > 6) return null // 超过 6 位小数 = 形态变化，拒收
  return BigInt(m[1]) * 1000000n + BigInt(frac)
}

// ---------- HTML 解析（无依赖：Docusaurus 静态页，article 内含完整表格） ----------
function decodeEntities(s) {
  return s
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)) })
}
export function stripCell(html) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''))
    .replace(/[ 　]+/g, ' ').replace(/\s+/g, ' ').trim()
}
function extractArticle(html) {
  const m = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html)
  return m ? m[1] : null
}
function parseTables(articleHtml) {
  const tables = []
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi
  let tm
  while ((tm = tableRe.exec(articleHtml)) !== null) {
    const rows = []
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let rm
    while ((rm = rowRe.exec(tm[1])) !== null) {
      const cells = []
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
      let cm
      while ((cm = cellRe.exec(rm[1])) !== null) cells.push(stripCell(cm[1]))
      if (cells.length > 0) rows.push(cells)
    }
    tables.push(rows)
  }
  return tables
}

// 价目单元格必须是严格形态：美元 "$0.003"、人民币 "0.02元"；
// 千分位符、符号粘连、单位变化一律视为解析失败（报告 §7.3-2：含糊一个就整批拒绝）。
function parsePriceCell(cell, currency) {
  if (typeof cell !== 'string') return null
  const m = currency === 'USD'
    ? /^\$(\d+(?:\.\d+)?)$/.exec(cell)
    : /^(\d+(?:\.\d+)?)元$/.exec(cell)
  return m ? m[1] : null
}

function cleanModelName(cell) {
  return cell.replace(/\s*\(\d+\)\s*$/, '').trim()
}

const CATEGORY_PATTERNS = [
  { key: 'inputCacheHit', en: /1M INPUT TOKENS\s*\(CACHE HIT\)/i, cn: /百万\s*tokens?\s*输入/ },
  { key: 'inputCacheMiss', en: /1M INPUT TOKENS\s*\(CACHE MISS\)/i, cn: /百万\s*tokens?\s*输入/ },
  { key: 'output', en: /1M OUTPUT TOKENS/i, cn: /百万\s*tokens?\s*输出/ },
]
function categoryOf(cell) {
  if (/CACHE HIT/i.test(cell) || (/缓存命中/.test(cell) && !/未命中/.test(cell))) return 'inputCacheHit'
  if (/CACHE MISS/i.test(cell) || /缓存未命中/.test(cell)) return 'inputCacheMiss'
  if (/OUTPUT TOKENS/i.test(cell) || /百万\s*tokens?\s*输出/.test(cell)) return 'output'
  return null
}
function periodOf(cell) {
  if (/OFF-PEAK/i.test(cell) || /空闲时段/.test(cell)) return 'offpeak'
  if (/PEAK/i.test(cell) || /高峰时段/.test(cell)) return 'peak'
  return null
}

// 解析一张价目页：返回 { models: {name: {inputCacheHit:{offpeak,peak}, ...}}, footnote, tools }
// 抛错即解析失败（调用方整批拒绝）。
export function parsePricingPage(html, currency) {
  const article = extractArticle(html)
  if (!article) throw new Error(currency + ' 页：找不到 <article>')
  const tables = parseTables(article)
  if (tables.length === 0) throw new Error(currency + ' 页：找不到任何表格')
  const main = tables[0]
  let models = null
  const prices = {} // model -> category -> period -> 价格字符串
  let currentCategory = null
  for (const row of main) {
    const first = row[0]
    if (!models && (/^MODEL$/i.test(first) || first === '模型')) {
      models = row.slice(1).map(cleanModelName)
      if (models.length === 0) throw new Error(currency + ' 页：模型行无模型名')
      for (const m of models) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(m)) throw new Error(currency + ' 页：模型名形态异常：' + m)
        prices[m] = {}
      }
      continue
    }
    if (!models) continue
    // 价目行：[类别?, 时段, 价格×N]；类别单元格带 rowspan，第二行只有 [时段, 价格×N]
    let periodIdx = -1
    let period = null
    let category = null
    for (let i = 0; i < row.length; i++) {
      const p = periodOf(row[i])
      if (p) { periodIdx = i; period = p; break }
      const c = categoryOf(row[i])
      if (c) category = c
    }
    if (periodIdx === -1) continue // 非价目行（版本/并发/功能行）
    if (category) currentCategory = category
    if (!currentCategory) throw new Error(currency + ' 页：价目行无类别：' + row.join(' | '))
    const priceCells = row.slice(periodIdx + 1)
    if (priceCells.length !== models.length) {
      throw new Error(currency + ' 页：' + currentCategory + '/' + period + ' 价格列数 ' + priceCells.length + ' ≠ 模型数 ' + models.length)
    }
    for (let i = 0; i < models.length; i++) {
      const v = parsePriceCell(priceCells[i], currency)
      if (v === null) throw new Error(currency + ' 页：价格形态异常：' + JSON.stringify(priceCells[i]))
      prices[models[i]][currentCategory] = prices[models[i]][currentCategory] || {}
      prices[models[i]][currentCategory][period] = v
    }
  }
  if (!models) throw new Error(currency + ' 页：找不到模型行')
  for (const m of models) {
    for (const cat of ['inputCacheHit', 'inputCacheMiss', 'output']) {
      if (!prices[m][cat] || prices[m][cat].offpeak === undefined || prices[m][cat].peak === undefined) {
        throw new Error(currency + ' 页：模型 ' + m + ' 缺 ' + cat + ' 的空闲/高峰价')
      }
    }
  }
  // 峰谷脚注 (2)：规则文本的哈希是“规则变了”的唯一探针（报告 §7.3-7）
  const foot = /<p>\(2\)([\s\S]*?)<\/p>/i.exec(article)
  if (!foot) throw new Error(currency + ' 页：找不到峰谷脚注 (2)')
  const footnote = stripCell(foot[1])
  if (footnote.length < 20) throw new Error(currency + ' 页：峰谷脚注过短，疑似结构变化')
  const tools = parseTools(tables, currency)
  return { models: prices, footnote: footnote, tools: tools }
}

function toolIdOf(cell) {
  if (/Search API/i.test(cell)) return 'search'
  if (/^Fetch API/i.test(cell)) return 'fetch'
  if (/File parsing/i.test(cell) || /文件解析/.test(cell)) return 'ocr'
  if (/Text to Speech/i.test(cell) || /语音合成/.test(cell)) return 'tts'
  if (/Speech to Text/i.test(cell) || /语音识别/.test(cell)) return 'asr'
  return null
}

function parseTools(tables, currency) {
  const tools = {}
  for (const table of tables) {
    for (const row of table) {
      const id = toolIdOf(row[0] || '')
      if (!id || tools[id]) continue
      if (id === 'tts' || id === 'asr') {
        // 语音表 4 列：[名称, 单位, 刊例价, 限时价]；限时列缺失 = 折扣已结束
        const list = parsePriceCell(row[2], currency)
        if (list === null) throw new Error(currency + ' 页：工具 ' + id + ' 刊例价形态异常：' + JSON.stringify(row[2]))
        let limited = null
        if (row.length >= 4 && row[3] !== undefined && row[3] !== '') {
          limited = parsePriceCell(row[3], currency)
          if (limited === null) throw new Error(currency + ' 页：工具 ' + id + ' 限时价形态异常：' + JSON.stringify(row[3]))
        }
        tools[id] = { list: list, limitedTime: limited }
      } else {
        const price = parsePriceCell(row[2], currency)
        if (price === null) throw new Error(currency + ' 页：工具 ' + id + ' 价格形态异常：' + JSON.stringify(row[2]))
        tools[id] = { price: price }
      }
    }
  }
  for (const id of TOOL_IDS) {
    if (!tools[id]) throw new Error(currency + ' 页：工具表缺 ' + id)
  }
  return tools
}

// Change Log 只做旁证：提取得最近条目与是否提到价格（绝不以此判断“无变化”）。
export function parseChangeLog(html) {
  const article = extractArticle(html)
  if (!article) return []
  // 按行提日期 + 标题：标签换行保留（不能走 stripCell 的空白折叠，否则日期行会被并进正文）
  const text = article
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, '\n')
  const lines = text.split('\n').map(function (s) { return decodeEntities(s).replace(/[ 　]+/g, ' ').replace(/\s+/g, ' ').trim() }).filter(Boolean)
  const entries = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:Date|时间):\s*(\d{4}-\d{2}-\d{2})$/.exec(lines[i])
    if (!m) continue
    const title = lines[i + 1] || ''
    const body = lines.slice(i + 2, i + 12).join(' ')
    entries.push({
      date: m[1],
      title: title,
      priceRelated: /pric|价格|降价|调价|discount/i.test(title + ' ' + body),
    })
  }
  return entries
}

export function sha256Hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

// 规范价格向量 → sourceHash（与目录 meta 比对，相同即无变化）
export function canonicalVector(parsed) {
  const out = { models: {}, tools: {}, ruleHash: {} }
  for (const currency of ['CNY', 'USD']) {
    out.models[currency] = {}
    const names = Object.keys(parsed[currency].models).sort()
    for (const name of names) out.models[currency][name] = parsed[currency].models[name]
    out.tools[currency] = parsed[currency].tools
    out.ruleHash[currency] = sha256Hex(parsed[currency].footnote)
  }
  return JSON.stringify(out)
}

// ---------- 校验（报告 §7.3 的 10 条契约；任一失败 → 整批拒绝） ----------
export function validateParsed(parsed, prevCatalog) {
  const failures = []
  const warnings = []
  const prevEntries = (prevCatalog && typeof prevCatalog === 'object') ? prevCatalog : {}
  const prevMeta = prevEntries.meta && typeof prevEntries.meta === 'object' ? prevEntries.meta : null
  // 1. 双页齐全（parsePricingPage 已抛错，这里只做集合比对）
  const enModels = Object.keys(parsed.USD.models).sort()
  const cnModels = Object.keys(parsed.CNY.models).sort()
  if (JSON.stringify(enModels) !== JSON.stringify(cnModels)) {
    failures.push('双页模型集合不一致：USD=' + enModels.join(',') + '；CNY=' + cnModels.join(','))
  }
  // 3. 空闲价必须精确等于高峰价一半（十进制归一化比较，不用浮点近似）
  // 4. 单调性：缓存命中 < 缓存未命中；全部 > 0
  for (const currency of ['CNY', 'USD']) {
    for (const name of Object.keys(parsed[currency].models)) {
      const m = parsed[currency].models[name]
      for (const cat of LEGS) {
        const off = toMicro(m[cat].offpeak)
        const peak = toMicro(m[cat].peak)
        if (off === null || peak === null) { failures.push(name + '/' + currency + '/' + cat + '：价格无法转十进制'); continue }
        if (off * 2n !== peak) failures.push(name + '/' + currency + '/' + cat + '：空闲价 ' + m[cat].offpeak + ' ≠ 高峰价 ' + m[cat].peak + ' 的一半')
        if (peak <= 0n || off <= 0n) failures.push(name + '/' + currency + '/' + cat + '：价格必须 > 0')
      }
      const hitPeak = toMicro(m.inputCacheHit.peak)
      const missPeak = toMicro(m.inputCacheMiss.peak)
      const hitOff = toMicro(m.inputCacheHit.offpeak)
      const missOff = toMicro(m.inputCacheMiss.offpeak)
      if (hitPeak !== null && missPeak !== null && hitPeak >= missPeak) failures.push(name + '/' + currency + '：缓存命中价 ≥ 未命中价（高峰）')
      if (hitOff !== null && missOff !== null && hitOff >= missOff) failures.push(name + '/' + currency + '：缓存命中价 ≥ 未命中价（空闲）')
    }
  }
  // 5. 变动幅度隔离带 [0.2×, 5×]（与目录上一份值比；新模型无上一份，跳过）
  // 6. 跨币种隐含汇率带 [5.0, 9.0]，且相对上一份值的漂移 ≤ 10%
  for (const name of enModels) {
    // 集合不一致已在上面记为失败；这里跳过缺失方，避免取不到数而抛错（校验必须总能返回失败清单）
    if (!parsed.CNY.models[name] || !parsed.USD.models[name]) continue
    for (const cat of LEGS) {
      for (const period of ['offpeak', 'peak']) {
        const cny = Number(parsed.CNY.models[name][cat][period])
        const usd = Number(parsed.USD.models[name][cat][period])
        const fx = cny / usd
        if (!(fx >= FX_BAND[0] && fx <= FX_BAND[1])) {
          failures.push(name + '/' + cat + '/' + period + '：隐含汇率 ' + fx.toFixed(2) + ' 超出 [' + FX_BAND[0] + ', ' + FX_BAND[1] + ']，疑似币种串表')
        }
        for (const currency of ['CNY', 'USD']) {
          const key = currency === 'CNY' ? name : 'deepseek-' + currency.toLowerCase() + ':' + name
          const prev = prevEntries[key]
          if (!prev || prev.mode !== 'peak-valley' || !prev[period] || prev[period][cat] === undefined) continue
          const old = Number(prev[period][cat])
          const cur = Number(parsed[currency].models[name][cat][period])
          if (!(old > 0)) continue
          const ratio = cur / old
          if (ratio < CHANGE_BAND[0] || ratio > CHANGE_BAND[1]) {
            failures.push(name + '/' + currency + '/' + cat + '/' + period + '：变动 ' + old + ' → ' + cur + '（' + ratio.toFixed(2) + '×）超出隔离带 [' + CHANGE_BAND[0] + '×, ' + CHANGE_BAND[1] + '×]')
          }
          if (currency === 'USD') {
            const prevCnyEntry = prevEntries[name]
            if (prevCnyEntry && prevCnyEntry.mode === 'peak-valley' && prevCnyEntry[period] && prevCnyEntry[period][cat] !== undefined
              && prev && prev.mode === 'peak-valley' && prev[period] && prev[period][cat] !== undefined) {
              const oldFx = Number(prevCnyEntry[period][cat]) / Number(prev[period][cat])
              if (oldFx > 0 && Math.abs(fx / oldFx - 1) > FX_DRIFT_MAX) {
                failures.push(name + '/' + cat + '/' + period + '：隐含汇率 ' + oldFx.toFixed(2) + ' → ' + fx.toFixed(2) + '，漂移超 10%')
              }
            }
          }
        }
      }
    }
  }
  // 7. 规则脚注哈希：脚注一变，整批隔离 + 告警（峰谷规则在插件代码里，不在目录数字里）
  const ruleHash = { CNY: sha256Hex(parsed.CNY.footnote), USD: sha256Hex(parsed.USD.footnote) }
  if (prevMeta && typeof prevMeta.ruleHash === 'string') {
    const prevRule = prevMeta.ruleHash
    const curRule = sha256Hex(JSON.stringify(ruleHash))
    if (prevRule !== curRule) failures.push('峰谷脚注哈希变化（ruleHash）：规则可能变了，需人工确认后再更新；本批已隔离')
  }
  // 8. 工具表：限时价消失 = 折扣结束 = 有效价翻倍，当作价格变化处理并告警（不静默续算）
  const prevTools = prevEntries.tools && typeof prevEntries.tools === 'object' ? prevEntries.tools : null
  if (prevTools) {
    for (const id of ['tts', 'asr']) {
      const prevLimited = prevTools[id] && prevTools[id].USD && prevTools[id].USD.limitedTime !== undefined
        ? prevTools[id].USD.limitedTime : (prevTools[id] && prevTools[id].limitedTime)
      const curLimited = parsed.USD.tools[id].limitedTime
      if (prevLimited !== undefined && prevLimited !== null && curLimited === null) {
        warnings.push('工具 ' + id + ' 限时折扣已结束：有效价 ' + prevLimited + ' → 刊例价 ' + parsed.USD.tools[id].list + '（USD），请人工确认')
      }
    }
  }
  return { failures: failures, warnings: warnings, ruleHash: ruleHash }
}

// ---------- 目录生成 ----------
function deepseekKey(model, currency) {
  return currency === 'CNY' ? model : 'deepseek-' + currency.toLowerCase() + ':' + model
}
function isManagedDeepSeekKey(key) {
  const model = key.indexOf(':') === -1 ? key : key.slice(key.indexOf(':') + 1)
  if (!/^deepseek/.test(model)) return false
  if (key.indexOf(':') === -1) return true
  return /^deepseek-[a-z]{3}:/.test(key)
}

export function holidaysThroughFromAccounting(accountingSrc) {
  const m = /CHINESE_PUBLIC_HOLIDAYS\s*=\s*\{([\s\S]*?)\};/.exec(accountingSrc || '')
  if (!m) return null
  const years = []
  const yearRe = /(\d{4})\s*:/g
  let ym
  while ((ym = yearRe.exec(m[1])) !== null) years.push(Number(ym[1]))
  return years.length > 0 ? Math.max.apply(null, years) : null
}

export function buildCatalog(prevCatalog, parsed, opts) {
  const nowIso = opts.nowIso
  const today = nowIso.slice(0, 10)
  const vector = canonicalVector(parsed)
  const sourceHash = sha256Hex(vector)
  const ruleHashCombined = sha256Hex(JSON.stringify({
    CNY: sha256Hex(parsed.CNY.footnote), USD: sha256Hex(parsed.USD.footnote),
  }))
  const prevMeta = prevCatalog && prevCatalog.meta && typeof prevCatalog.meta === 'object' ? prevCatalog.meta : null
  const holidaysThrough = opts.holidaysThrough || (prevMeta && prevMeta.holidaysThrough) || 2027
  const meta = {
    schemaVersion: 2,
    checkedAt: nowIso,
    sourceHash: sourceHash,
    ruleHash: ruleHashCombined,
    sources: { CNY: SOURCES.CNY, USD: SOURCES.USD },
    holidaysThrough: holidaysThrough,
  }
  const out = { meta: meta }
  const changes = []
  const newKeys = new Set()
  const newEntries = {}
  for (const currency of ['CNY', 'USD']) {
    for (const name of Object.keys(parsed[currency].models)) {
      const m = parsed[currency].models[name]
      const key = deepseekKey(name, currency)
      newKeys.add(key)
      const prev = prevCatalog[key]
      const entry = {
        currency: currency,
        mode: 'peak-valley',
        peak: { inputCacheHit: Number(m.inputCacheHit.peak), inputCacheMiss: Number(m.inputCacheMiss.peak), output: Number(m.output.peak) },
        offpeak: { inputCacheHit: Number(m.inputCacheHit.offpeak), inputCacheMiss: Number(m.inputCacheMiss.offpeak), output: Number(m.output.offpeak) },
        source: SOURCES[currency],
      }
      if (prev && typeof prev.notes === 'string' && prev.notes.length > 0) entry.notes = prev.notes
      else entry.notes = '官方' + (currency === 'CNY' ? '人民币' : '美元') + '价目，峰谷规则见价目页脚注 (2)：空闲价为高峰价一半。'
      newEntries[key] = entry
      if (prev && prev.mode === 'peak-valley') {
        for (const period of ['peak', 'offpeak']) {
          for (const cat of LEGS) {
            if (Number(prev[period][cat]) !== entry[period][cat]) {
              changes.push(key + ' ' + period + '.' + cat + ' ' + prev[period][cat] + ' → ' + entry[period][cat])
            }
          }
        }
      } else if (!prev) {
        changes.push('新增模型 ' + key + '（' + currency + '）')
      }
    }
  }
  // 其余条目保持原顺序原样保留；价目页上消失的 DeepSeek 模型标 retired（不删除，
  // 数字保留供历史账目回填），全新模型追加在原有条目之后、tools 之前。
  for (const key of Object.keys(prevCatalog)) {
    if (key === 'meta' || key === 'tools') continue
    if (newKeys.has(key)) { out[key] = newEntries[key]; continue }
    if (isManagedDeepSeekKey(key)) {
      const prev = prevCatalog[key]
      const model = key.indexOf(':') === -1 ? key : key.slice(key.indexOf(':') + 1)
      const retired = Object.assign({}, prev, { retired: true, retiredAt: today })
      if (KNOWN_SUCCESSORS[model]) retired.successor = KNOWN_SUCCESSORS[model]
      out[key] = retired
      changes.push('模型退役（保留数字供回填）：' + key + (retired.successor ? ' → 承接 ' + retired.successor : ''))
    } else {
      out[key] = prevCatalog[key]
    }
  }
  for (const key of Object.keys(newEntries)) {
    if (!Object.hasOwn(out, key)) out[key] = newEntries[key]
  }
  // 工具区（双币种；插件现阶段不消费，只存数据，为将来计工具费留数）
  const tools = {}
  for (const id of TOOL_IDS) {
    const cny = parsed.CNY.tools[id]
    const usd = parsed.USD.tools[id]
    const entry = { unit: TOOL_UNITS[id] }
    if (cny.price !== undefined) {
      entry.CNY = Number(cny.price)
      entry.USD = Number(usd.price)
    } else {
      entry.CNY = { list: Number(cny.list), limitedTime: cny.limitedTime === null ? null : Number(cny.limitedTime) }
      entry.USD = { list: Number(usd.list), limitedTime: usd.limitedTime === null ? null : Number(usd.limitedTime) }
    }
    tools[id] = entry
  }
  out.tools = tools
  return { catalog: out, changes: changes, sourceHash: sourceHash, ruleHash: ruleHashCombined }
}

// ---------- 抓取 ----------
async function fetchWithRetry(url, attempts) {
  let lastErr = null
  const delays = [5000, 15000]
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(30000),
        redirect: 'follow',
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.text()
    } catch (err) {
      lastErr = err
      log('抓取失败（第 ' + (i + 1) + '/' + attempts + ' 次）' + url + '：' + String((err && err.message) || err))
      if (i < attempts - 1) await new Promise(function (r) { setTimeout(r, delays[i] || 15000) })
    }
  }
  throw lastErr
}

function parseArgs(argvList) {
  const args = { catalog: null, dryRun: false, fixtures: null, saveSnapshots: null }
  for (let i = 0; i < argvList.length; i++) {
    const a = argvList[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--catalog') args.catalog = argvList[++i]
    else if (a === '--fixtures') args.fixtures = argvList[++i]
    else if (a === '--save-snapshots') args.saveSnapshots = argvList[++i]
  }
  return args
}

async function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const args = parseArgs(process.argv.slice(2))
  const catalogPath = args.catalog || join(root, 'catalog', 'pricing.json')
  const nowIso = new Date().toISOString()
  let prevCatalog = {}
  try { prevCatalog = JSON.parse(readFileSync(catalogPath, 'utf8')) } catch (err) { prevCatalog = {} }
  if (!prevCatalog || typeof prevCatalog !== 'object' || Array.isArray(prevCatalog)) prevCatalog = {}

  const summary = { status: 'failed', checkedAt: nowIso, changes: [], warnings: [], failures: [] }
  try {
    let htmlEn
    let htmlCn
    let changelogHtml = []
    if (args.fixtures) {
      htmlEn = readFileSync(join(args.fixtures, 'deepseek-pricing-en-20261127.html'), 'utf8')
      htmlCn = readFileSync(join(args.fixtures, 'deepseek-pricing-cn-20261127.html'), 'utf8')
      const enLog = join(args.fixtures, 'deepseek-changelog-en-20261127.html')
      const cnLog = join(args.fixtures, 'deepseek-changelog-cn-20261127.html')
      if (existsSync(enLog)) changelogHtml.push(readFileSync(enLog, 'utf8'))
      if (existsSync(cnLog)) changelogHtml.push(readFileSync(cnLog, 'utf8'))
    } else {
      htmlEn = await fetchWithRetry(SOURCES.USD, 3)
      htmlCn = await fetchWithRetry(SOURCES.CNY, 3)
      if (args.saveSnapshots) {
        mkdirSync(args.saveSnapshots, { recursive: true })
        writeFileSync(join(args.saveSnapshots, 'deepseek-pricing-en.html'), htmlEn)
        writeFileSync(join(args.saveSnapshots, 'deepseek-pricing-cn.html'), htmlCn)
      }
      // Change Log 只做旁证：读不到不阻断本批（报告 §7.3-10）
      for (const url of CHANGELOG_URLS) {
        try { changelogHtml.push(await fetchWithRetry(url, 2)) } catch (err) { log('Change Log 读取失败（旁证缺失，不阻断）：' + url) }
      }
    }
    const parsed = {
      USD: parsePricingPage(htmlEn, 'USD'),
      CNY: parsePricingPage(htmlCn, 'CNY'),
    }
    const { failures, warnings } = validateParsed(parsed, prevCatalog)
    summary.warnings = warnings
    if (failures.length > 0) {
      summary.failures = failures
      console.log(JSON.stringify(summary))
      log('校验失败，整批拒绝（目录未改动）：' + failures.join('；'))
      process.exitCode = 1
      return
    }
    // Change Log 旁证：最新条目是否提到价格（只记入提交说明）
    const changelogEntries = changelogHtml.flatMap(function (h) { return parseChangeLog(h) })
    const latestLog = changelogEntries.sort(function (a, b) { return b.date.localeCompare(a.date) })[0] || null
    if (latestLog && latestLog.priceRelated) {
      summary.changelogNote = 'Change Log 最新条目 ' + latestLog.date + ' 提到价格：' + latestLog.title
    }
    let accountingSrc = ''
    try { accountingSrc = readFileSync(join(root, 'src', 'accounting.js'), 'utf8') } catch (err) { /* 假期年份回退到目录 meta */ }
    const holidaysThrough = holidaysThroughFromAccounting(accountingSrc)
    const built = buildCatalog(prevCatalog, parsed, { nowIso: nowIso, holidaysThrough: holidaysThrough })
    summary.changes = built.changes
    summary.sourceHash = built.sourceHash
    summary.ruleHash = built.ruleHash
    const prevMeta = prevCatalog.meta && typeof prevCatalog.meta === 'object' ? prevCatalog.meta : null
    const unchanged = prevMeta && prevMeta.sourceHash === built.sourceHash
    if (unchanged) {
      const lastChecked = prevMeta.checkedAt ? Date.parse(prevMeta.checkedAt) : 0
      if (Number.isFinite(lastChecked) && Date.now() - lastChecked < STAMP_INTERVAL_MS) {
        summary.status = 'no-change'
        console.log(JSON.stringify(summary))
        log('价格与规则均无变化，且 24 小时内已有验讫戳，不提交。')
        return
      }
      // 每天最多一次只改 checkedAt 的验讫戳提交
      summary.status = 'stamp'
      const stamped = Object.assign({}, prevCatalog, { meta: Object.assign({}, prevMeta, { checkedAt: nowIso }) })
      if (!args.dryRun) writeFileSync(catalogPath, JSON.stringify(stamped, null, 2) + '\n')
      console.log(JSON.stringify(summary))
      log('价格无变化，更新验讫戳 checkedAt → ' + nowIso + (args.dryRun ? '（dry-run，未写盘）' : ''))
      return
    }
    summary.status = args.dryRun ? 'dry-run' : 'updated'
    if (!args.dryRun) writeFileSync(catalogPath, JSON.stringify(built.catalog, null, 2) + '\n')
    console.log(JSON.stringify(summary))
    log('目录已更新（' + built.changes.length + ' 项变化）' + (args.dryRun ? '（dry-run，未写盘）' : ''))
  } catch (err) {
    summary.failures = ['抓取/解析异常：' + String((err && err.message) || err)]
    console.log(JSON.stringify(summary))
    log('整批拒绝：' + summary.failures[0])
    process.exitCode = 1
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
