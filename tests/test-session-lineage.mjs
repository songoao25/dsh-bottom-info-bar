// Issue #44：本会话花费必须只包含选中会话及 DSH 明确标记的子代理后代。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'bib-lineage-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(dataDir, 'no-codex.json')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(dataDir, 'no-opencode.json')
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })

const records = [
  { id: 'root-call', ts: 1787000000000, model: 'deepseek-chat', provider: 'deepseek', sessionId: 'root', input: 10, cacheRead: 0, cacheWrite: 0, output: 1, currency: 'CNY', cost: 1 },
  { id: 'child-call', ts: 1787000000001, model: 'deepseek-chat', provider: 'deepseek', sessionId: 'child', input: 20, cacheRead: 0, cacheWrite: 0, output: 2, currency: 'CNY', cost: 2 },
  { id: 'grandchild-call', ts: 1787000000002, model: 'deepseek-chat', provider: 'deepseek', sessionId: 'grandchild', input: 30, cacheRead: 0, cacheWrite: 0, output: 3, currency: 'CNY', cost: 3 },
  { id: 'other-call', ts: 1787000000003, model: 'deepseek-chat', provider: 'deepseek', sessionId: 'other', input: 40, cacheRead: 0, cacheWrite: 0, output: 4, currency: 'CNY', cost: 4 },
  { id: 'other-child-call', ts: 1787000000004, model: 'deepseek-chat', provider: 'deepseek', sessionId: 'other-child', input: 50, cacheRead: 0, cacheWrite: 0, output: 5, currency: 'CNY', cost: 5 },
  { id: 'fork-call', ts: 1787000000005, model: 'deepseek-chat', provider: 'deepseek', sessionId: 'fork', input: 60, cacheRead: 0, cacheWrite: 0, output: 6, currency: 'CNY', cost: 6 },
]
writeFileSync(join(dataDir, 'usage-records.json'), JSON.stringify(records))

const lineage = [
  { sessionId: 'root' },
  { sessionId: 'session-child', parentSessionId: 'session-root', origin: 'subagent' },
  { sessionId: 'grandchild', parentSessionId: 'child', origin: 'subagent' },
  { sessionId: 'other' },
  { sessionId: 'other-child', parentSessionId: 'other', origin: 'subagent' },
  // A parent field without the durable subagent marker is intentionally excluded.
  { sessionId: 'fork', parentSessionId: 'root' },
  // Cycles must not make lineage expansion loop forever.
  { sessionId: 'cycle-a', parentSessionId: 'cycle-b', origin: 'subagent' },
  { sessionId: 'cycle-b', parentSessionId: 'cycle-a', origin: 'subagent' },
]

const mod = await import('../plugin/src/host.js?lineage=' + encodeURIComponent(dataDir))
const plugin = mod.default
let listCalls = 0
const captured = { route: null }
const ctx = {
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }
    if (name === 'sessionController') return { list: async () => { listCalls += 1; return { items: lineage } } }
    return undefined
  },
  credentials: { resolve: async () => null },
  interval() { return () => {} },
  timeout() { return () => {} },
  on() { return () => {} },
  inject(services, callback) {
    callback({ effect(fn) { const dispose = fn(); return () => dispose && dispose() }, webServer: { register(route) { captured.route = route; return () => {} } } })
    return () => {}
  },
}

async function invoke(sessionId) {
  const listeners = {}
  const req = { url: '/_dsh/dsh-bottom-info-bar/getUsageSummary', method: 'POST', headers: {}, on(name, listener) { (listeners[name] ||= []).push(listener); return req }, destroy() {} }
  let payload = null
  const pending = captured.route.handler(req, { writeHead() {}, end(text) { payload = JSON.parse(text) } })
  for (const listener of listeners.data || []) listener(Buffer.from(JSON.stringify({ sessionId, selection: { provider: 'deepseek', model: 'deepseek-chat' } })))
  for (const listener of listeners.end || []) listener()
  await pending
  return payload
}

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail ? ' — ' + JSON.stringify(detail) : '')) }
}

const pureIds = [...mod.__usageInternals.sessionLineageIds(lineage, 'root')].sort()
check('谱系只包含根会话和 origin=subagent 后代', JSON.stringify(pureIds) === JSON.stringify(['child', 'grandchild', 'root']), pureIds)
check('循环谱系不会把无关会话带入', !mod.__usageInternals.sessionLineageIds(lineage, 'root').has('cycle-a'))

const dispose = plugin.apply(ctx)
const root = await invoke('session-root')
const child = await invoke('child')
const other = await invoke('other')
check('主会话包含子代理和孙代理', root.currentSession && root.currentSession.tokens === 66 && root.currentSession.costs.CNY === 6, root.currentSession)
check('主会话不包含同账户其他会话或未标记 fork', root.currentSession && root.currentSession.tokens !== 165 && root.currentSession.costs.CNY !== 15, root.currentSession)
check('子代理只包含自己及其后代', child.currentSession && child.currentSession.tokens === 55 && child.currentSession.costs.CNY === 5, child.currentSession)
check('另一个根会话拥有自己的子代理', other.currentSession && other.currentSession.tokens === 99 && other.currentSession.costs.CNY === 9, other.currentSession)
check('短缓存避免一次汇总轮询重复读取会话列表', listCalls === 1, { listCalls })
dispose()
rmSync(dataDir, { recursive: true, force: true })
console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
