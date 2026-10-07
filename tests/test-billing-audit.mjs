// 计费审计回归（2026-10-05）：DeepSeek 官方价目 / 峰谷口径 / 缓存命中口径 / 去重 / 未计价。
//
// 覆盖用户提出的 17 项：
//   ①纯 cache hit ②纯 cache miss ③hit+miss 混合 ④有 output ⑤output=0 ⑥超大 token（50M）
//   ⑦小数价格 ⑧多 Agent ⑨retry ⑩duplicate usage event ⑪session restore ⑫stream 只统计一次
//   ⑬未知模型 ⑭模型 alias ⑮跨价格生效时间（V4 Pro 不再被重定向到 Flash 价）⑯cache hit rate 展示
//   ⑰K/M UI formatter
//
// 第一段直接从 src/host.js 提取真实函数求值（与 test-weekend-pricing 同法），
// 第二段用真实 apply 走 llm/stream → 记账 → getUsageSummary 全链路。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const src = readFileSync(new URL('../src/host.js', import.meta.url), 'utf8')
const clientSrc = readFileSync(new URL('../src/client-bundle.js', import.meta.url), 'utf8')
const localeSrc = readFileSync(new URL('../src/locales.js', import.meta.url), 'utf8')

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
function close(a, b, eps) { return typeof a === 'number' && Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps) }

// ---------------------------------------------------------------- 第一段：纯价格数学
function slice(re, label) {
  const m = src.match(re)
  if (!m) throw new Error('无法从 src/host.js 提取 ' + label)
  return m[0]
}
const periodBlock = slice(/\/\/ ---------- 北京时间峰谷判定 ----------[\s\S]*?(?=\n    \/\/ ---------- 当前模型识别 ----------)/, '峰谷判定块')
const pricingBlock = slice(/const PRICING = \{[\s\S]*?\n    \};\n(?=    function modelCurrency)/, 'PRICING')
const entryBlock = slice(/function pricingEntryFor\(provider, model\) \{[\s\S]*?\n    \}/, 'pricingEntryFor')
const costBlock = slice(/function costOf\(record, forceOffpeak\) \{[\s\S]*?\n    \}/, 'costOf')

const B = eval('(() => { const BEIJING_OFFSET_MS = 8 * 3600 * 1000;\n'
  + periodBlock + '\n' + pricingBlock + '\n' + entryBlock + '\n' + costBlock
  + '\nreturn { PRICING, currentPeriod, pricingEntryFor, costOf }; })()')

const OFF = Date.parse('2026-10-05T20:00:00+08:00') // 国庆假期 → 空闲
const PEAK = Date.parse('2026-10-08T10:00:00+08:00') // 节后工作日 10:00 → 高峰
const flash = (o) => Object.assign({ provider: 'deepseek-official', model: 'deepseek-flash', ts: OFF, cacheWrite: 0 }, o)

// ① 纯 cache hit：1M 命中 @¥0.02/M
check('① 纯 cache hit：1M 命中 = ¥0.02（空闲价）', close(B.costOf(flash({ input: 0, cacheRead: 1e6, output: 0 })), 0.02), B.costOf(flash({ input: 0, cacheRead: 1e6, output: 0 })))
// ② 纯 cache miss：1M 未命中 @¥1.00/M
check('② 纯 cache miss：1M 未命中 = ¥1.00（空闲价）', close(B.costOf(flash({ input: 1e6, cacheRead: 0, output: 0 })), 1), B.costOf(flash({ input: 1e6, cacheRead: 0, output: 0 })))
// ③ hit + miss 混合：200K miss + 800K hit + 100K output
check('③ 混合：0.2×1 + 0.8×0.02 + 0.1×4 = ¥0.616', close(B.costOf(flash({ input: 2e5, cacheRead: 8e5, output: 1e5 })), 0.616), B.costOf(flash({ input: 2e5, cacheRead: 8e5, output: 1e5 })))
// ④ output 计价独立
check('④ output 单独计价：1M 输出 = ¥4（空闲）', close(B.costOf(flash({ input: 0, cacheRead: 0, output: 1e6 })), 4), B.costOf(flash({ input: 0, cacheRead: 0, output: 1e6 })))
// ⑤ output = 0
check('⑤ output=0 不产生输出费用', close(B.costOf(flash({ input: 1e5, cacheRead: 1e5, output: 0 })), 0.1 + 0.002), B.costOf(flash({ input: 1e5, cacheRead: 1e5, output: 0 })))
// ⑥ 超大 token：50M 未命中
check('⑥ 50M 未命中 = ¥50（无浮点漂移）', close(B.costOf(flash({ input: 50e6, cacheRead: 0, output: 0 })), 50), B.costOf(flash({ input: 50e6, cacheRead: 0, output: 0 })))
// ⑦ 小数价格（glm-4.5-air 0.16/0.8/2）
check('⑦ 小数价：glm-4.5-air 1M 未命中 = ¥0.8', close(B.costOf({ provider: 'zhipu', model: 'glm-4.5-air', ts: OFF, input: 1e6, cacheRead: 0, cacheWrite: 0, output: 0 }), 0.8), B.costOf({ provider: 'zhipu', model: 'glm-4.5-air', ts: OFF, input: 1e6, cacheRead: 0, cacheWrite: 0, output: 0 }))
// ⑬ 未知模型绝不套用别的价格
check('⑬ 未知模型 → costOf 返回 null（不静默套价）', B.costOf({ provider: 'opencode-go-v41', model: 'deepseek-v4.1-flash', ts: OFF, input: 1e6, cacheRead: 0, cacheWrite: 0, output: 1e6 }) === null)
check('⑬ 未知模型不享受任何作用域键兜底', B.pricingEntryFor('mystery', 'mystery-model') === null)
// ⑭ alias：旧视觉别名 = Flash 价；deepseek-v4-pro 仍是 Pro 价
check('⑭ 旧视觉别名同 Flash 价', JSON.stringify(B.pricingEntryFor('deepseek-official', 'deepseek-v4-flash-vision-exp')) === JSON.stringify(B.PRICING['deepseek-flash']))
// ⑮ 跨价格生效时间：2026-09-14 12:00 之后 V4 Pro 不再被重定向到 Flash 价（官方已改口：继续提供、计费不变）
check('⑮ V4 Pro 在 2026-09-15 仍按 Pro 高峰价（1M 未命中 = ¥9）',
  close(B.costOf({ provider: 'deepseek-official', model: 'deepseek-v4-pro', ts: Date.parse('2026-09-15T10:00:00+08:00'), input: 1e6, cacheRead: 0, cacheWrite: 0, output: 0 }), 9),
  B.costOf({ provider: 'deepseek-official', model: 'deepseek-v4-pro', ts: Date.parse('2026-09-15T10:00:00+08:00'), input: 1e6, cacheRead: 0, cacheWrite: 0, output: 0 }))
check('⑮ V4 Pro 空闲价 1M 输出 = ¥13.5', close(B.costOf({ provider: 'deepseek-official', model: 'deepseek-v4-pro', ts: OFF, input: 0, cacheRead: 0, cacheWrite: 0, output: 1e6 }), 13.5))

// 官方价目钉死（改价必须同时更新 src/host.js 定价表上方的来源注释，并在此显式失败）
check('价目：deepseek-flash 峰谷 = 0.04/2/8 与 0.02/1/4', JSON.stringify(B.PRICING['deepseek-flash']) === JSON.stringify({ currency: 'CNY', mode: 'peak-valley', peak: { inputCacheHit: 0.04, inputCacheMiss: 2, output: 8 }, offpeak: { inputCacheHit: 0.02, inputCacheMiss: 1, output: 4 } }))
check('价目：deepseek-v4-pro 峰谷 = 0.30/9/27 与 0.15/4.5/13.5', JSON.stringify(B.PRICING['deepseek-v4-pro']) === JSON.stringify({ currency: 'CNY', mode: 'peak-valley', peak: { inputCacheHit: 0.3, inputCacheMiss: 9, output: 27 }, offpeak: { inputCacheHit: 0.15, inputCacheMiss: 4.5, output: 13.5 } }))

// 峰谷边界：高峰 = 北京时间工作日 9:00-12:00、14:00-18:00；周末/节假日全天空闲
check('峰谷：工作日 08:59 空闲', B.currentPeriod(Date.parse('2026-10-08T08:59:00+08:00')) === 'offpeak')
check('峰谷：工作日 09:00 高峰', B.currentPeriod(Date.parse('2026-10-08T09:00:00+08:00')) === 'peak')
check('峰谷：工作日 12:00 空闲', B.currentPeriod(Date.parse('2026-10-08T12:00:00+08:00')) === 'offpeak')
check('峰谷：工作日 14:00 高峰', B.currentPeriod(Date.parse('2026-10-08T14:00:00+08:00')) === 'peak')
check('峰谷：工作日 18:00 空闲', B.currentPeriod(Date.parse('2026-10-08T18:00:00+08:00')) === 'offpeak')
check('峰谷：周六全天空闲', B.currentPeriod(Date.parse('2026-10-10T10:00:00+08:00')) === 'offpeak')
check('峰谷：国庆假期 10:00 空闲', B.currentPeriod(Date.parse('2026-10-06T10:00:00+08:00')) === 'offpeak')
check('峰谷：未知年份按工作日规则（不猜农历）', B.currentPeriod(Date.parse('2027-10-01T10:00:00+08:00')) === 'peak')
check('峰谷：高峰价 = 空闲价 2 倍（用户口径：谷时省一半）',
  B.costOf(flash({ input: 1e6, cacheRead: 0, output: 0 })) * 2 === B.costOf(flash({ input: 1e6, cacheRead: 0, output: 0, ts: PEAK })))

// ⑯ 38.6M / 262K 真实案例复算（2026-10-05 20:31 主会话快照）
{
  const input = 148220, cacheRead = 38490624, output = 262177
  const expected = (input * 1 + cacheRead * 0.02 + output * 4) / 1e6
  const got = B.costOf(flash({ input, cacheRead, output }))
  check('⑯ 真实快照 38.64M/262.2K → ¥' + expected.toFixed(6), close(got, expected), got)
  const hitRate = cacheRead / (input + cacheRead) * 100
  check('⑯ 该快照命中率 99.62% → 一位小数显示 99.6%（旧实现显示 100%）', Math.round(hitRate * 10) / 10 === 99.6 && Math.round(hitRate) === 100, hitRate)
}

// ---------------------------------------------------------------- 第二段：全链路（真实 apply）
const dataDir = mkdtempSync(join(tmpdir(), 'bib-billing-audit-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(dataDir, 'no-codex.json')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(dataDir, 'no-opencode.json')
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })

const lineage = [
  { sessionId: 'main' },
  { sessionId: 'main-sub', parentSessionId: 'main', origin: 'subagent' },
  { sessionId: 'other' },
]
const mod = await import('../src/host.js?billing=' + encodeURIComponent(dataDir))
const plugin = mod.default

function makeStub() {
  const captured = { listener: null, route: null }
  return {
    captured,
    ctx: {
      get(name) {
        if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) }
        if (name === 'sessionController') return { list: async () => ({ items: lineage }) }
        return undefined
      },
      credentials: { resolve: async () => null },
      interval() { return () => {} },
      timeout() { return () => {} },
      on(name, listener) { if (name === 'llm/stream') captured.listener = listener; return () => {} },
      inject(services, callback) {
        callback({ effect(fn) { const dispose = fn(); return () => dispose && dispose() }, connection: { requestRejection(req) { return req.headers['sec-fetch-site'] === 'cross-site' ? 403 : undefined } }, webServer: { register(route) { captured.route = route; return () => {} } } })
        return () => {}
      },
    },
  }
}

async function drain(listener, options, chunks) {
  async function* stream() { for (const chunk of chunks) { if (chunk instanceof Error) throw chunk; yield chunk } }
  const iter = listener(options, async () => stream())
  for await (const _chunk of iter) { /* preserve normal stream behavior */ }
}

async function invoke(route, sessionId, provider) {
  const listeners = {}
  const req = { url: '/_dsh/dsh-bottom-info-bar/getUsageSummary', method: 'POST', headers: {}, on(name, listener) { (listeners[name] ||= []).push(listener); return req }, destroy() {} }
  let payload = null
  const pending = route.handler(req, { writeHead() {}, end(text) { payload = JSON.parse(text) } })
  const body = JSON.stringify({ sessionId, selection: { provider: provider || 'deepseek-official', model: 'deepseek-flash' } })
  for (const listener of listeners.data || []) listener(Buffer.from(body))
  for (const listener of listeners.end || []) listener()
  await pending
  return payload
}

const stub = makeStub()
const dispose = plugin.apply(stub.ctx)
const opts = (sessionId, model) => ({ provider: 'deepseek-official', model: model || 'deepseek-flash', sessionId })

// ⑫ stream 里多条 usage 快照 → 只记最后一笔（DSH 的 usage 是累计快照）
await drain(stub.captured.listener, opts('dup'), [
  { type: 'usage', usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 1000 } },
  { type: 'usage', usage: { inputTokens: 300, outputTokens: 400, cacheReadTokens: 5000 } },
  { type: 'finish' },
])
let summary = await invoke(stub.captured.route, 'dup')
check('⑫ 多条 usage 快照只记一笔（取最后一笔，不累加）', summary.currentSession && summary.currentSession.tokens === 300 + 400 + 5000, summary.currentSession)
const journalRecords = () => readFileSync(join(dataDir, 'usage-records.journal.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
check('⑩ duplicate usage event 不产生第二条记录', journalRecords().filter((r) => r.sessionId === 'dup').length === 1)

// ⑨ retry = 第二次 llm/stream：两次尝试各自计费（DSH 的 retry 会重新发起请求）
await drain(stub.captured.listener, opts('retry'), [{ type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } }, new Error('upstream 500')]).catch(() => {})
await drain(stub.captured.listener, opts('retry'), [{ type: 'usage', usage: { inputTokens: 20, outputTokens: 2 } }, { type: 'finish' }])
summary = await invoke(stub.captured.route, 'retry')
check('⑨ retry 两次尝试分别记账（10+1 与 20+2）', summary.currentSession && summary.currentSession.tokens === 33, summary.currentSession)

// ⑬ 未知模型：保留用量但成本不可计算
await drain(stub.captured.listener, opts('unknown-session', 'mystery-model'), [{ type: 'usage', usage: { inputTokens: 1234, outputTokens: 56 } }, { type: 'finish' }])
summary = await invoke(stub.captured.route, 'unknown-session')
check('⑬ 未知模型：用量保留、无伪造金额', summary.currentSession && summary.currentSession.tokens === 1290 && JSON.stringify(summary.currentSession.costs) === '{}', summary.currentSession)
check('⑬ 未知模型：unpricedRecords/unpricedTokens 已上报（客户端据此显示“暂不可计算”）', summary.currentSession && summary.currentSession.unpricedRecords === 1 && summary.currentSession.unpricedTokens === 1290, summary.currentSession)

// ⑧ 多 Agent：主会话 + 子代理都进「本会话」，Σ request cost = 展示金额
await drain(stub.captured.listener, opts('main'), [{ type: 'usage', usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 10000 } }, { type: 'finish' }])
await drain(stub.captured.listener, opts('main-sub'), [{ type: 'usage', usage: { inputTokens: 2000, outputTokens: 200, cacheReadTokens: 20000 } }, { type: 'finish' }])
await drain(stub.captured.listener, opts('other'), [{ type: 'usage', usage: { inputTokens: 7, outputTokens: 7 } }, { type: 'finish' }])
summary = await invoke(stub.captured.route, 'main')
check('⑧ 本会话 = 主 Agent + 子代理（token 与金额都是合计）',
  summary.currentSession && summary.currentSession.tokens === 33300 && summary.currentSession.costs.CNY > 0
  && summary.currentSession.unpricedRecords === 0, summary.currentSession)
{
  const all = journalRecords()
  const owned = all.filter((r) => r.sessionId === 'main' || r.sessionId === 'main-sub')
  const sum = owned.reduce((a, r) => a + (Number(r.cost) || 0), 0)
  check('Σ 每条 request cost = 会话展示金额（误差只允许来自 UI 取整）', close(sum, summary.currentSession.costs.CNY, 1e-9), { sum, shown: summary.currentSession.costs.CNY })
  check('其他会话不计入本会话', all.filter((r) => r.sessionId === 'other').length === 1)
}

// ⑪ session restore / 重启：同一目录再次 apply 不得重复累计
const before = await invoke(stub.captured.route, 'main')
const recordsBeforeReload = journalRecords().length
dispose()
const stub2 = makeStub()
const dispose2 = plugin.apply(stub2.ctx)
const after = await invoke(stub2.captured.route, 'main')
check('⑪ 重新装载账本后金额完全一致（不重复累计）',
  after.currentSession && before.currentSession && close(after.currentSession.costs.CNY, before.currentSession.costs.CNY, 1e-12)
  && after.currentSession.tokens === before.currentSession.tokens, { before: before.currentSession, after: after.currentSession })
check('⑪ 重新装载后流水记录数与装载前一致（没有把历史重新记一遍）', journalRecords().length === recordsBeforeReload, { before: recordsBeforeReload, after: journalRecords().length })
dispose2()

// ---------------------------------------------------------------- 第三段：客户端展示口径
check('⑯ client 命中率按一位小数（99.6% 不再显示 100%）', clientSrc.includes('Math.round((cacheReadTokens / denom) * 1000) / 10'))
check('⑯ client 不再用整数四舍五入命中率', !clientSrc.includes('(usageProj.cacheReadTokens || 0) / denom) * 100)'))
check('⑯ client 命中率带 token 级口径悬浮说明', clientSrc.includes("t('ui.cacheHitScope'") && clientSrc.includes("t('ui.tokenScope'"))
check('⑯ client 明确区分主 Agent 与含子代理的口径', clientSrc.includes('不含子代理') === false && localeSrc.includes('不含子代理'))
check('⑬ client 未定价时显示“—”，不用 ¥0.000 冒充', clientSrc.includes("hasTokens ? symbol + '—' : symbol + (0).toFixed(3)"))
check('⑬ client 部分未定价时前缀 ≈', clientSrc.includes("unpricedRecords > 0 ? '≈'"))
check('⑰ K/M 用 1e3 / 1e6，不是 1024', clientSrc.includes('if (value < 1e6) return') && !clientSrc.includes('1024 * 1024'))
check('⑰ 内部 token 始终是整数、展示才格式化（账本字段为 Number）', src.includes('input: sanitizeTokens(') && src.includes('output: sanitizeTokens('))
const localeKeys = ['ui.cacheHitScope', 'ui.tokenScope', 'ui.spendPartlyUnpriced']
for (const key of localeKeys) {
  const count = (localeSrc.match(new RegExp('"' + key + '"', 'g')) || []).length
  check('locale 中英双语齐备：' + key, count === 2, count)
}
check('⑬ 未计价文案不承诺任何金额', localeSrc.includes('绝不套用其他模型价格估算') && localeSrc.includes('no other model\'s price is substituted'))

rmSync(dataDir, { recursive: true, force: true })
console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
