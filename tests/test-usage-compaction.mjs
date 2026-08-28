// v1.9.0 性能地基验收测试（docs/PERF-AUDIT-v1.9.md §⑦）：
// ① 压缩等价：~5000 条快照 + 5000 行 journal 折叠后，totalSpend/todaySpend/last30dSpend/
//    spendSummary/currentSessionSummary 与旧版全扫基线逐字段相等；快照 ≤ 保留窗、journal ≤ 阈值；重启总额不变
// ② 会话语义回归锁：会话起点早于折叠窗的 sessionId，currentSessionSummary tokens/costs 压缩前后相等；
//    窗内会话保持“起点当天逐条过滤”的精确边界（起点之前的同日记录绝不混入）
// ③ unpriced 永不折叠、仍可被价目补算（远程价目缓存合并 → totalSpend 随之增加）
// ④ 扫描量断言：getUsageSummary 只扫边界天（不随总记录数增长）、recordUsage 零明细遍历
// ⑤ 崩溃安全：快照残留已折叠明细（旧版本回滚重写）/ summaries 主文件损坏走 .bak /
//    journal 撕裂行与重复行 → 重启后总额一致、无重复计费
// 数据目录隔离：DATA_DIR 在模块加载时固化，因此每个分节通过带 query 的 URL 重新 import，
// 并在 import 之前设置 env——绝不触碰 ~/.dsh 真实用户数据。
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MS_PER_DAY = 86400 * 1000
const NOW = Date.now()

let failures = 0
let passes = 0
function check(name, condition, detail) {
  if (condition) { passes += 1; console.log('PASS  ' + name) }
  else { failures += 1; console.log('FAIL  ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function close(a, b, eps) {
  return Math.abs(a - b) <= (eps || 1e-6)
}
function sameMoney(a, b) {
  if (a == null || b == null) return a === b
  return close(a, b)
}

// ---------- 分节加载：env 先于 import（query URL 强制独立模块实例） ----------
async function loadPluginFor(dataDir) {
  if (dataDir.indexOf(join(tmpdir(), 'bib-compact-')) !== 0) {
    throw new Error('安全护栏：数据目录必须是测试临时目录，拒绝运行（' + dataDir + '）')
  }
  process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
  process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(dataDir, 'no-codex.json')
  process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(dataDir, 'no-opencode.json')
  // 唯一 query → Node 视为独立模块 → 模块顶层的 DATA_DIR 常量按当前 env 重新固化
  const mod = await import('../plugin/src/host.js?dir=' + encodeURIComponent(dataDir))
  return { plugin: mod.default, internals: mod.__usageInternals }
}

// fetch 桩：DeepSeek 余额 88.5 CNY；版本检查/远程价目返回最小响应（无真实网络）
globalThis.fetch = async (url) => {
  const parsed = new URL(String(url))
  if (parsed.hostname === 'api.deepseek.com') {
    return { ok: true, status: 200, json: async () => ({ balance_infos: [{ currency: 'CNY', total_balance: '88.5', granted_balance: '0', topped_up_balance: '88.5' }] }) }
  }
  if (parsed.hostname === 'registry.npmjs.org') return { ok: true, status: 200, json: async () => ({ version: '1.8.0' }) }
  return { ok: false, status: 404, json: async () => ({}) }
}

// ---------- 旧版全扫基线（与 v1.8 host.js 聚合逐行同构，作为等价性参照） ----------
function refDayKey(ts) {
  const d = new Date(ts + 8 * 3600 * 1000)
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
}
function refDayStartMs(dayKey) {
  return Date.parse(dayKey + 'T00:00:00Z') - 8 * 3600 * 1000
}
function refNormalize(id) {
  if (!id) return ''
  return String(id).replace(/^session-/, '')
}
function refAccount(r) {
  if (r.provider === 'deepseek') return 'deepseek'
  if (r.provider === 'openai') return 'openai'
  return null
}
function refCurrency(r) {
  return r.currency || 'CNY'
}
function refCostOf(r) {
  return Number.isFinite(r.cost) && r.cost >= 0 ? r.cost : null
}
// 强制空闲价口径：deepseek-chat 为 flat 价（0.5/2/8 CNY·百万），重算式与 host 一致
function refOffpeak(r) {
  return ((r.input + r.cacheWrite) * 2 + r.cacheRead * 0.5 + r.output * 8) / 1e6
}
function refTotalSpend(records, account, currency) {
  let total = 0
  for (const r of records) {
    if (account !== null && refAccount(r) !== account) continue
    if (refCurrency(r) !== currency) continue
    const c = refCostOf(r)
    if (c != null) total += c
  }
  return Math.round(total * 1000) / 1000
}
function refTodaySpend(records, nowMs, account, currency) {
  const key = refDayKey(nowMs)
  let total = 0
  for (const r of records) {
    if (refDayKey(r.ts) !== key) continue
    if (account !== null && refAccount(r) !== account) continue
    if (refCurrency(r) !== currency) continue
    const c = refCostOf(r)
    if (c != null) total += c
  }
  return Math.round(total * 1000) / 1000
}
function refLast30d(records, nowMs, account, currency) {
  const cutoff = nowMs - 30 * MS_PER_DAY
  let total = 0
  for (const r of records) {
    if (r.ts < cutoff) continue
    if (account !== null && refAccount(r) !== account) continue
    if (refCurrency(r) !== currency) continue
    const c = refCostOf(r)
    if (c != null) total += c
  }
  return Math.round(total * 1000) / 1000
}
function refMonthSpend(records, nowMs, account, currency) {
  const monthKey = refDayKey(nowMs).slice(0, 7)
  let total = 0
  for (const r of records) {
    if (!refDayKey(r.ts).startsWith(monthKey)) continue
    if (account !== null && refAccount(r) !== account) continue
    if (refCurrency(r) !== currency) continue
    const c = refCostOf(r)
    if (c != null) total += c
  }
  return Math.round(total * 1000) / 1000
}
function refSpendSummary(records, nowMs, account, currency, balance) {
  const cutoff = nowMs - 7 * MS_PER_DAY
  let total = 0
  let offpeak = 0
  const daySet = new Set()
  for (const r of records) {
    if (r.ts < cutoff) continue
    if (account !== null && refAccount(r) !== account) continue
    if (refCurrency(r) !== currency) continue
    const c = refCostOf(r)
    if (c == null) continue
    total += c
    const oc = refOffpeak(r)
    if (oc != null) offpeak += oc
    daySet.add(refDayKey(r.ts))
  }
  if (total <= 0 || balance == null) return null
  const daysActive = Math.max(1, daySet.size)
  const dailySpend = total / daysActive
  const offpeakDailySpend = offpeak / daysActive
  return {
    days: 7,
    daysActive,
    totalSpend: Math.round(total * 100) / 100,
    dailySpend: Math.round(dailySpend * 100) / 100,
    balance,
    daysLeft: dailySpend > 0 ? Math.round(balance / dailySpend * 10) / 10 : null,
    offpeakDailySpend: Math.round(offpeakDailySpend * 100) / 100,
    offpeakDaysLeft: offpeakDailySpend > 0 ? Math.round(balance / offpeakDailySpend * 10) / 10 : null,
  }
}
function refCurrentSession(records, account, sessionId) {
  if (!sessionId) return null
  const norm = refNormalize(sessionId)
  let start = null
  for (const r of records) {
    if (refNormalize(r.sessionId) !== norm) continue
    if (start === null || r.ts < start) start = r.ts
  }
  if (start === null) return null
  const acc = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costs: {} }
  for (const r of records) {
    if (r.ts < start) continue
    if (refAccount(r) !== account) continue
    acc.input += r.input
    acc.cacheRead += r.cacheRead
    acc.cacheWrite += r.cacheWrite
    acc.output += r.output
    const c = refCostOf(r)
    if (c != null) acc.costs[refCurrency(r)] = (acc.costs[refCurrency(r)] || 0) + c
  }
  return {
    input: acc.input, cacheRead: acc.cacheRead, cacheWrite: acc.cacheWrite, output: acc.output,
    tokens: acc.input + acc.cacheRead + acc.cacheWrite + acc.output,
    costs: acc.costs,
  }
}
function refSessionCount(records, account) {
  const keys = new Set()
  for (const r of records) {
    if (account !== null && refAccount(r) !== account) continue
    keys.add(r.sessionId || (r.provider + '/' + r.model + '#' + r.ts))
  }
  return keys.size
}

// ---------- 桩环境（与 test-usage-ledger 同构；余额桩让 spendSummary 物化） ----------
function makeStub() {
  const captured = { route: null, llmListener: null }
  const ctx = {
    get(name) { return name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) } : undefined },
    credentials: { resolve: async (name) => (name === 'DEEPSEEK_API_KEY' ? { value: 'sk-test' } : null) },
    interval() { return () => {} },
    timeout() { return () => {} },
    on(event, listener) { if (event === 'llm/stream') captured.llmListener = listener; return () => {} },
    inject(services, callback) {
      callback({ effect(fn) { const dispose = fn(); return () => dispose && dispose() }, webServer: { register(route) { captured.route = route; return () => {} } } })
      return () => {}
    },
  }
  return { captured, ctx }
}

async function invokeSummary(route, sessionId, provider, model) {
  const listeners = {}
  const req = { url: '/_dsh/dsh-bottom-info-bar/getUsageSummary', method: 'POST', headers: {}, on(n, cb) { (listeners[n] ||= []).push(cb); return req }, destroy() {} }
  let payload = null
  const pending = route.handler(req, { writeHead() {}, end(text) { payload = JSON.parse(text) } })
  const body = JSON.stringify({ sessionId, selection: { provider: provider || 'deepseek', model: model || 'deepseek-chat' } })
  for (const cb of listeners.data || []) cb(Buffer.from(body))
  for (const cb of listeners.end || []) cb()
  await pending
  return payload
}

async function feedUsage(listener, sessionId, usage) {
  async function* fakeStream() {
    yield { type: 'usage', usage }
    yield { type: 'finish' }
  }
  const iter = listener({ model: 'deepseek-chat', provider: 'deepseek', sessionId }, async () => fakeStream())
  for await (const chunk of iter) { /* drain */ }
}

// 北京时刻助手：beijingTs(100, 10, 30) = 100 天前北京时间 10:30
function beijingTs(daysBack, hour, minute) {
  const d = new Date(NOW - daysBack * MS_PER_DAY + 8 * 3600 * 1000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute || 0, 0) - 8 * 3600 * 1000
}
function foldBoundaryMs(nowMs) {
  return refDayStartMs(refDayKey((nowMs || NOW) - 90 * MS_PER_DAY))
}

// 可复现伪随机（种子固定，失败可重放）
function mulberry32(seed) {
  let a = seed
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 记录工厂：cost 全部取二进制精确值（0.125 的倍数），保证不同求和顺序下浮点完全一致
function makeRecord(id, ts, sessionId, opts) {
  const o = opts || {}
  const rec = {
    id,
    ts,
    model: o.model || 'deepseek-chat',
    provider: o.provider || 'deepseek',
    sessionId,
    purpose: '',
    input: o.input != null ? o.input : 500,
    cacheRead: o.cacheRead != null ? o.cacheRead : 100,
    cacheWrite: o.cacheWrite != null ? o.cacheWrite : 0,
    output: o.output != null ? o.output : 200,
    status: 'completed',
  }
  if (o.unpriced) {
    rec.pricingStatus = 'unpriced'
  } else {
    rec.cost = o.cost != null ? o.cost : 0.125
    rec.currency = o.currency || 'CNY'
    rec.pricingStatus = 'priced'
    rec.pricingVersion = 'test-fixture'
  }
  return rec
}

// ---------- 大规模等价性夹具：~4900 条快照（120 天）+ 恰好 5000 行 journal ----------
function buildBigFixture() {
  const rand = mulberry32(20190900)
  const snapshot = []
  const journalLines = []
  let seq = 0
  for (let dayBack = 120; dayBack >= 0; dayBack--) {
    const perDay = dayBack === 0 ? 70 : 40
    for (let i = 0; i < perDay; i++) {
      const ts = dayBack === 0 ? NOW - (i + 1) * 60000 : beijingTs(dayBack, Math.floor(rand() * 24), Math.floor(rand() * 60))
      seq += 1
      const roll = rand()
      if (roll < 0.06) {
        // unpriced：无 cost 字段（含 120 天前的老 unpriced——永不折叠的硬保证）
        snapshot.push(makeRecord('snap-' + seq, ts, 'sess-mix-' + Math.floor(seq / 5), {
          provider: 'mystery', model: 'mystery-model', unpriced: true, input: 111, cacheRead: 22, cacheWrite: 0, output: 33,
        }))
      } else if (roll < 0.13) {
        snapshot.push(makeRecord('snap-' + seq, ts, 'sess-usd-' + Math.floor(seq / 5), {
          provider: 'openai', model: 'gpt-4o', currency: 'USD', cost: 0.25, input: 400, cacheRead: 50, cacheWrite: 0, output: 100,
        }))
      } else if (roll < 0.16) {
        // 无主 priced 记录（账户键为空串的路径）
        snapshot.push(makeRecord('snap-' + seq, ts, 'sess-none-' + Math.floor(seq / 5), {
          provider: 'ghost', model: 'ghost-model', currency: 'CNY', cost: 0.5, input: 300, cacheRead: 0, cacheWrite: 0, output: 60,
        }))
      } else {
        snapshot.push(makeRecord('snap-' + seq, ts, 'sess-mix-' + Math.floor(seq / 5), {
          cost: [0.125, 0.25, 0.5, 1, 2][Math.floor(rand() * 5)], input: 1000 + Math.floor(rand() * 900), cacheRead: Math.floor(rand() * 500), cacheWrite: 0, output: 100 + Math.floor(rand() * 900),
        }))
      }
    }
  }
  // 专门的“本会话”校验会话：今天 5 条主会话 + 2 条子代理（独立 sessionId，晚于起点）
  for (let i = 0; i < 5; i++) {
    snapshot.push(makeRecord('snap-recent-' + i, NOW - (10 - i) * 60000, 'recent-check', { cost: 0.5, input: 800, cacheRead: 200, cacheWrite: 0, output: 300 }))
  }
  for (let i = 0; i < 2; i++) {
    snapshot.push(makeRecord('snap-recent-sub-' + i, NOW - (3 - i) * 60000, 'recent-check-sub', { cost: 0.25, input: 150, cacheRead: 50, cacheWrite: 0, output: 70 }))
  }
  // journal：恰好 5000 行，全部为可独立成账的 priced 记录（90~120 天前 → 全部落入折叠区）
  for (let i = 0; i < 5000; i++) {
    const ts = beijingTs(90 + (i % 30), Math.floor(rand() * 24), Math.floor(rand() * 60))
    journalLines.push(JSON.stringify(makeRecord('jnl-' + i, ts, 'jsess-' + Math.floor(i / 4), {
      cost: 0.125, input: 600, cacheRead: 100, cacheWrite: 0, output: 150,
    })))
  }
  return { snapshot, journalLines }
}

function writeFixture(dataDir, snapshot, journalLines) {
  writeFileSync(join(dataDir, 'usage-records.json'), JSON.stringify(snapshot))
  writeFileSync(join(dataDir, 'usage-records.journal.jsonl'), journalLines.join('\n') + '\n')
}

function archiveLineCount(dataDir) {
  const archiveDir = join(dataDir, 'usage-archive')
  let lines = 0
  if (existsSync(archiveDir)) {
    for (const name of readdirSync(archiveDir)) {
      lines += readFileSync(join(archiveDir, name), 'utf8').split('\n').filter((l) => l.trim()).length
    }
  }
  return lines
}

// ================================================================
// ① 压缩等价 + journal 滚动 + 重启幂等
// ================================================================
const dataDir1 = mkdtempSync(join(tmpdir(), 'bib-compact-1-'))
const m1 = await loadPluginFor(dataDir1)
const fixture = buildBigFixture()
writeFixture(dataDir1, fixture.snapshot, fixture.journalLines)
const allRecords = fixture.snapshot.concat(fixture.journalLines.map((line) => JSON.parse(line)))

const first = makeStub()
const dispose1 = m1.plugin.apply(first.ctx)
await new Promise((resolve) => setTimeout(resolve, 50))
const summary1 = await invokeSummary(first.captured.route, 'recent-check')
const summary1Sub = await invokeSummary(first.captured.route, 'recent-check-sub')
check('① 大账本折叠后 getUsageSummary 返回 200', !!summary1 && typeof summary1.totalSpend === 'number', summary1 && summary1.persistence)

{
  const nowMs = summary1.now
  const account = 'deepseek'
  check('① totalSpend 与全扫基线逐字段相等', sameMoney(summary1.totalSpend, refTotalSpend(allRecords, account, 'CNY')), { got: summary1.totalSpend, want: refTotalSpend(allRecords, account, 'CNY') })
  check('① todaySpend 与全扫基线相等', sameMoney(summary1.todaySpend, refTodaySpend(allRecords, nowMs, account, 'CNY')), { got: summary1.todaySpend, want: refTodaySpend(allRecords, nowMs, account, 'CNY') })
  check('① last30dSpend 与全扫基线相等（含截止日半天）', sameMoney(summary1.last30dSpend, refLast30d(allRecords, nowMs, account, 'CNY')), { got: summary1.last30dSpend, want: refLast30d(allRecords, nowMs, account, 'CNY') })
  check('① monthSpend 与全扫基线相等', sameMoney(summary1.monthSpend, refMonthSpend(allRecords, nowMs, account, 'CNY')), { got: summary1.monthSpend, want: refMonthSpend(allRecords, nowMs, account, 'CNY') })
  const wantSpend = refSpendSummary(allRecords, nowMs, account, 'CNY', 88.5)
  check('① spendSummary daysActive/totalSpend/dailySpend/offpeak 相等',
    summary1.spend && summary1.spend.daysActive === wantSpend.daysActive
    && sameMoney(summary1.spend.totalSpend, wantSpend.totalSpend)
    && sameMoney(summary1.spend.dailySpend, wantSpend.dailySpend)
    && sameMoney(summary1.spend.offpeakDailySpend, wantSpend.offpeakDailySpend)
    && sameMoney(summary1.spend.daysLeft, wantSpend.daysLeft),
    { got: summary1.spend, want: wantSpend })
  const wantSession = refCurrentSession(allRecords, account, 'recent-check')
  const wantSub = refCurrentSession(allRecords, account, 'recent-check-sub')
  // v1.7 语义：主会话聚合 = 起点 + 同账户全部记录 → 本身已并入子代理记录（wantMain 含 sub），
  // 故主会话与基线逐字段相等 + 子代理自身聚合也与基线相等，即为等价（且证明子代理未被丢账）
  check('① currentSessionSummary 逐字段相等（主会话含同账户子代理并入）',
    summary1.currentSession && summary1Sub.currentSession
    && summary1.currentSession.tokens === wantSession.tokens
    && close(summary1.currentSession.costs.CNY, wantSession.costs.CNY)
    && summary1.currentSession.tokens > wantSub.tokens
    && summary1Sub.currentSession.tokens === wantSub.tokens,
    { gotMain: summary1.currentSession, gotSub: summary1Sub.currentSession, wantMain: wantSession, wantSub: wantSub })
  check('① sessions 计数与全扫基线相等', summary1.sessions === refSessionCount(allRecords, account), { got: summary1.sessions, want: refSessionCount(allRecords, account) })
  check('① 持久化状态 ok', summary1.persistence && summary1.persistence.state === 'ok', summary1.persistence)
}

dispose1() // 冲刷：快照重写为窗内明细 + journal 滚动压缩 + summaries 落盘

{
  const boundary = foldBoundaryMs()
  const snapshotAfter = JSON.parse(readFileSync(join(dataDir1, 'usage-records.json'), 'utf8'))
  const expectedDetail = allRecords.filter((r) => !(r.ts < boundary && Number.isFinite(r.cost) && r.cost >= 0))
  check('① 折叠后快照条数 = 保留窗内明细 + unpriced（≤ 保留窗）', snapshotAfter.length === expectedDetail.length, { got: snapshotAfter.length, want: expectedDetail.length, boundary })
  const expectedFolded = allRecords.filter((r) => r.ts < boundary && Number.isFinite(r.cost) && r.cost >= 0).length
  const archivedLines = archiveLineCount(dataDir1)
  check('① 折叠记录已进冷归档（只写不读，行数 == 折叠数）', archivedLines === expectedFolded, { archivedLines, expectedFolded })
  const journalAfter = readFileSync(join(dataDir1, 'usage-records.journal.jsonl'), 'utf8')
  const journalLineCount = journalAfter.split('\n').filter((l) => l.trim()).length
  check('① journal 行数压缩到阈值内（≤2000）', journalLineCount <= 2000, { got: journalLineCount })
  check('① summaries 汇总文件已生成', existsSync(join(dataDir1, 'usage-summaries.json')))
}

// 重启（重新 load）后总额不变（幂等）
const second = makeStub()
const dispose2 = m1.plugin.apply(second.ctx)
await new Promise((resolve) => setTimeout(resolve, 50))
const summary2 = await invokeSummary(second.captured.route, 'recent-check')
check('① 重启后 totalSpend 不变', sameMoney(summary2.totalSpend, summary1.totalSpend), { got: summary2.totalSpend, want: summary1.totalSpend })
check('① 重启后 todaySpend/last30dSpend 不变', sameMoney(summary2.todaySpend, summary1.todaySpend) && sameMoney(summary2.last30dSpend, summary1.last30dSpend), { got: summary2 })
check('① 重启后 currentSessionSummary 不变', summary2.currentSession && summary1.currentSession && summary2.currentSession.tokens === summary1.currentSession.tokens, { got: summary2.currentSession })
check('① 重启后 sessions 计数不变', summary2.sessions === summary1.sessions, { got: summary2.sessions, want: summary1.sessions })
dispose2()

// ================================================================
// ④ 扫描量断言（独立目录与模块实例，避免计数互相污染）
// ================================================================
{
  const dataDir4 = mkdtempSync(join(tmpdir(), 'bib-compact-4-'))
  const m4 = await loadPluginFor(dataDir4)
  writeFixture(dataDir4, fixture.snapshot, fixture.journalLines)
  const stub4 = makeStub()
  const dispose4 = m4.plugin.apply(stub4.ctx)
  await new Promise((resolve) => setTimeout(resolve, 50))
  m4.internals.reset()
  const totalRecords = fixture.snapshot.length + fixture.journalLines.length
  await invokeSummary(stub4.captured.route, 'recent-check')
  const scanned = m4.internals.counters.detailRecordsScanned
  // 三处边界天扫描上限：本会话边界天 + 30 天截止日 + 7 天截止日（各 ≤ 一天记录量 ≈ 130）
  check('④ getUsageSummary 明细遍历只落在边界天（不随总记录数增长）', scanned > 0 && scanned <= 3 * 130 && scanned < totalRecords / 10, { scanned, totalRecords, detailScanCalls: m4.internals.counters.detailScanCalls })
  const scanCallsBefore = m4.internals.counters.detailScanCalls
  // 5 次记账金额各异；live-4 最后一次记账 → 其会话起点最晚 → 本会话只含自身一条
  for (let i = 1; i <= 5; i++) {
    await feedUsage(stub4.captured.llmListener, 'live-' + i, { inputTokens: 100 * i, outputTokens: 10 * i })
  }
  check('④ recordUsage 单条 O(1)：5 次记账零明细扫描', m4.internals.counters.detailScanCalls === scanCallsBefore && m4.internals.counters.recordUsageCount === 5, m4.internals.counters)
  const liveLast = await invokeSummary(stub4.captured.route, 'live-5')
  // deepseek-chat 单笔 live-5 = (500×2 + 50×8)/1e6 = 0.0014；currentSession.costs 不做四舍五入，可精确断言
  check('④ 增量记账同步进汇总（本会话金额精确可见）', liveLast.currentSession && liveLast.currentSession.tokens === 550 && close(liveLast.currentSession.costs.CNY, 0.0014, 1e-12), liveLast.currentSession)
  const after4 = (await invokeSummary(stub4.captured.route, 'recent-check')).totalSpend
  // 5 笔合计 = 280×(1+2+3+4+5)/1e6 = 0.0042
  check('④ 增量记账同步进总账（+0.0042）', close(after4 - summary1.totalSpend, 0.0042, 0.0006), { after4, base: summary1.totalSpend })
  dispose4()
  rmSync(dataDir4, { recursive: true, force: true })
}

// ================================================================
// ② 会话语义回归锁（起点早于折叠窗 + 窗内边界天精度）
// ================================================================
{
  const dataDir2 = mkdtempSync(join(tmpdir(), 'bib-compact-2-'))
  const m2 = await loadPluginFor(dataDir2)
  const legacy = []
  // 起点 100 天前 10:00（当天该账户无更早记录）；后续 10 天前与 1 小时前各有记录（跨折叠窗的长会话）
  legacy.push(makeRecord('old-1', beijingTs(100, 10, 0), 'legacy-long', { cost: 1, input: 1200, cacheRead: 300, cacheWrite: 0, output: 400 }))
  legacy.push(makeRecord('old-2', beijingTs(100, 10, 30), 'legacy-sub', { cost: 0.5, input: 220, cacheRead: 20, cacheWrite: 0, output: 40 })) // 子代理
  legacy.push(makeRecord('old-3', beijingTs(100, 18, 0), 'legacy-other', { cost: 0.25, input: 90, cacheRead: 0, cacheWrite: 0, output: 10 })) // 同日另一会话（起点之后 → 应并入）
  legacy.push(makeRecord('old-4', beijingTs(10, 12, 0), 'legacy-long', { cost: 0.5, input: 500, cacheRead: 100, cacheWrite: 0, output: 100 }))
  legacy.push(makeRecord('old-5', NOW - 3600 * 1000, 'legacy-long', { cost: 0.25, input: 300, cacheRead: 0, cacheWrite: 0, output: 50 }))
  // 窗内会话：起点 10 天前 09:00，同日 08:00 有一条“起点之前的噪声”（窗内边界天必须逐条剔除）
  legacy.push(makeRecord('mid-noise', beijingTs(10, 8, 0), 'mid-noise-sess', { cost: 2, input: 999, cacheRead: 0, cacheWrite: 0, output: 999 }))
  legacy.push(makeRecord('mid-1', beijingTs(10, 9, 0), 'mid-session', { cost: 0.5, input: 400, cacheRead: 100, cacheWrite: 0, output: 100 }))
  legacy.push(makeRecord('mid-2', beijingTs(10, 9, 30), 'mid-session-sub', { cost: 0.125, input: 60, cacheRead: 0, cacheWrite: 0, output: 10 }))
  legacy.push(makeRecord('mid-3', NOW - 2 * 3600 * 1000, 'mid-session', { cost: 0.25, input: 100, cacheRead: 0, cacheWrite: 0, output: 20 }))
  writeFixture(dataDir2, legacy, [])
  const stub2 = makeStub()
  const dispose2b = m2.plugin.apply(stub2.ctx)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const legacyNow = await invokeSummary(stub2.captured.route, 'legacy-long')
  const wantLegacy = refCurrentSession(legacy, 'deepseek', 'legacy-long')
  check('② 会话起点早于压缩窗：currentSessionSummary 压缩前后 tokens 相等（含子代理与同日后续会话）',
    legacyNow.currentSession && legacyNow.currentSession.tokens === wantLegacy.tokens, { got: legacyNow.currentSession, want: wantLegacy })
  check('② 会话起点早于压缩窗：costs 压缩前后相等',
    legacyNow.currentSession && close(legacyNow.currentSession.costs.CNY, wantLegacy.costs.CNY), { got: legacyNow.currentSession && legacyNow.currentSession.costs, want: wantLegacy.costs })
  const midNow = await invokeSummary(stub2.captured.route, 'mid-session')
  const wantMid = refCurrentSession(legacy, 'deepseek', 'mid-session')
  check('② 窗内会话保持起点当天逐条过滤：起点之前的同日噪声绝不混入',
    midNow.currentSession && midNow.currentSession.tokens === wantMid.tokens && close(midNow.currentSession.costs.CNY, wantMid.costs.CNY),
    { got: midNow.currentSession, want: wantMid })
  dispose2b()
  rmSync(dataDir2, { recursive: true, force: true })
}

// ================================================================
// ③ unpriced 永不折叠 + 价目补算回填
// ================================================================
{
  const dataDir3 = mkdtempSync(join(tmpdir(), 'bib-compact-3-'))
  const m3 = await loadPluginFor(dataDir3)
  const unpricedOld = []
  for (let i = 0; i < 10; i++) {
    unpricedOld.push(makeRecord('unpriced-old-' + i, beijingTs(100 + i, 12, 0), 'unpriced-sess-' + i, {
      provider: 'moonshotai-cn', model: 'future-model', unpriced: true, input: 1000, cacheRead: 0, cacheWrite: 0, output: 500,
    }))
  }
  unpricedOld.push(makeRecord('priced-old', beijingTs(100, 13, 0), 'priced-sess', { cost: 1, input: 100, cacheRead: 0, cacheWrite: 0, output: 100 }))
  writeFixture(dataDir3, unpricedOld, [])
  const stub3a = makeStub()
  const dispose3a = m3.plugin.apply(stub3a.ctx)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const before = await invokeSummary(stub3a.captured.route, 'unpriced-sess-0', 'moonshotai-cn', 'kimi-k3')
  dispose3a()
  const snapshot3a = JSON.parse(readFileSync(join(dataDir3, 'usage-records.json'), 'utf8'))
  const archiveMonth = refDayKey(beijingTs(100, 13, 0)).slice(0, 7)
  const archivePath = join(dataDir3, 'usage-archive', archiveMonth + '.jsonl')
  const archiveFiles = existsSync(archivePath) ? readFileSync(archivePath, 'utf8').split('\n').filter((l) => l.trim()) : []
  check('③ unpriced 老明细永不折叠（仍留在快照）', snapshot3a.filter((r) => r.id && r.id.indexOf('unpriced-old-') === 0).length === 10, snapshot3a.map((r) => r.id))
  check('③ 冷归档只含 priced 折叠记录', archiveFiles.length === 1 && JSON.parse(archiveFiles[0]).id === 'priced-old', archiveFiles.map((l) => JSON.parse(l).id))
  check('③ 补算前 moonshotai 账户 totalSpend 不含 unpriced', sameMoney(before.totalSpend, 0), before.totalSpend)

  // 远程价目目录缓存合并（插件真实的 6h 回填通道）→ future-model 获得官方单价 → totalSpend 增加
  writeFileSync(join(dataDir3, 'pricing-cache.json'), JSON.stringify({
    fetchedAt: Date.now(),
    etag: null,
    entries: { 'future-model': { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 1, inputCacheMiss: 2, output: 4 } } },
  }))
  const stub3b = makeStub()
  const dispose3b = m3.plugin.apply(stub3b.ctx)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const after = await invokeSummary(stub3b.captured.route, 'unpriced-sess-0', 'moonshotai-cn', 'kimi-k3')
  const afterDeepseek = await invokeSummary(stub3b.captured.route, 'priced-sess')
  // 单条补算 = (1000×2 + 0×1 + 500×4)/1e6 = 0.004；10 条 = 0.04
  check('③ 价目补算后 totalSpend 随之增加（unpriced → priced）', close(after.totalSpend, 0.04, 1e-9), { got: after.totalSpend, want: 0.04 })
  check('③ 补算只影响所属账户（deepseek 账户金额不变）', sameMoney(afterDeepseek.totalSpend, 1), afterDeepseek.totalSpend)
  dispose3b()
  rmSync(dataDir3, { recursive: true, force: true })
}

// ================================================================
// ⑤ 崩溃安全（三种中断形态）
// ================================================================
{
  const dataDir5 = mkdtempSync(join(tmpdir(), 'bib-compact-5-'))
  const m5 = await loadPluginFor(dataDir5)
  const crashFixture = buildBigFixture()
  writeFixture(dataDir5, crashFixture.snapshot, crashFixture.journalLines)
  const stub5 = makeStub()
  const dispose5 = m5.plugin.apply(stub5.ctx)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const base = await invokeSummary(stub5.captured.route, 'recent-check')
  dispose5()

  // ⑤a 快照残留已折叠明细（模拟旧版本回滚后整本重写快照）→ 不得重复计费
  writeFixture(dataDir5, crashFixture.snapshot, crashFixture.journalLines)
  const stub5a = makeStub()
  const dispose5a = m5.plugin.apply(stub5a.ctx)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const after5a = await invokeSummary(stub5a.captured.route, 'recent-check')
  check('⑤ 快照残留已折叠明细 → 按汇总去重，总额一致无重复计费',
    sameMoney(after5a.totalSpend, base.totalSpend) && after5a.sessions === base.sessions, { got: after5a.totalSpend, want: base.totalSpend })
  dispose5a()

  // ⑤b summaries 主文件损坏（写入中途崩溃）→ 回退 .bak，金额不丢
  copyFileSync(join(dataDir5, 'usage-summaries.json'), join(dataDir5, 'usage-summaries.json.bak'))
  writeFileSync(join(dataDir5, 'usage-summaries.json'), '{ torn summaries write')
  const stub5b = makeStub()
  const dispose5b = m5.plugin.apply(stub5b.ctx)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const after5b = await invokeSummary(stub5b.captured.route, 'recent-check')
  check('⑤ summaries 主文件损坏 → .bak 恢复，总额一致', sameMoney(after5b.totalSpend, base.totalSpend), { got: after5b.totalSpend, want: base.totalSpend })
  dispose5b()

  // ⑤c journal 撕裂行 + 与快照重复的行 → 只计一次，总额不变
  const snapshotNow = JSON.parse(readFileSync(join(dataDir5, 'usage-records.json'), 'utf8'))
  const dupLine = JSON.stringify(snapshotNow.find((r) => r.id === 'snap-recent-0'))
  const journalPath = join(dataDir5, 'usage-records.journal.jsonl')
  writeFileSync(journalPath, readFileSync(journalPath, 'utf8') + dupLine + '\n' + '{ torn journal line\n')
  const stub5c = makeStub()
  const dispose5c = m5.plugin.apply(stub5c.ctx)
  await new Promise((resolve) => setTimeout(resolve, 50))
  const after5c = await invokeSummary(stub5c.captured.route, 'recent-check')
  check('⑤ journal 撕裂行/重复行 → 总额一致无重复计费', sameMoney(after5c.totalSpend, base.totalSpend), { got: after5c.totalSpend, want: base.totalSpend })
  dispose5c()
  rmSync(dataDir5, { recursive: true, force: true })
}

rmSync(dataDir1, { recursive: true, force: true })
console.log('\n结果：' + passes + ' PASS / ' + failures + ' FAIL')
process.exit(failures === 0 ? 0 : 1)
