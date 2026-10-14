import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = process.argv[2]
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(process.argv[2], 'absent')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(process.argv[2], 'absent')
process.env.DSH_BOTTOM_INFO_BAR_SELF_UPDATE = 'off'
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })
function stub() {
  const captured = {}
  return { captured, ctx: { get: () => undefined, credentials: { resolve: async () => null }, interval: () => () => {}, on(e, fn) { if (e === 'llm/stream') captured.listener = fn; return () => {} }, inject(s, cb) { cb({ effect(fn) { const d = fn(); return () => d && d() }, connection: { requestRejection: () => undefined }, webServer: { register(route) { captured.route = route; return () => {} } } }); return () => {} } } }
}
const plugin = (await import('../src/host.js')).default
const first = stub(), dispose = plugin.apply(first.ctx)
await Promise.all(Array.from({ length: 200 }, async (_, i) => {
  const stream = first.captured.listener({ provider: 'deepseek', model: 'unknown-model', sessionId: 'burst-' + i }, async function* () { yield { type: 'usage', usage: { inputTokens: 100, cacheReadTokens: 10, outputTokens: 50 } }; yield { type: 'finish' } })
  for await (const _ of stream) {}
}))
global.gc()
const retainedHeapMiB = Math.round(process.memoryUsage().heapUsed / 1048576)
let db = new DatabaseSync(join(process.argv[2], 'usage-ledger.sqlite'), { readOnly: true })
const count = db.prepare('SELECT COUNT(*) n FROM records').get().n
const sessions = db.prepare('SELECT COUNT(*) n FROM sessions').get().n
const last = JSON.parse(db.prepare('SELECT payload FROM records WHERE id=?').get('synthetic-' + (Number(process.argv[3]) - 1)).payload)
const price = db.prepare('SELECT SUM(cost) cost FROM accounts').get().cost
db.close(); dispose()
const second = stub(), dispose2 = plugin.apply(second.ctx)
db = new DatabaseSync(join(process.argv[2], 'usage-ledger.sqlite'), { readOnly: true })
const restartedCount = db.prepare('SELECT COUNT(*) n FROM records').get().n
db.close(); dispose2()
assert.equal(count, Number(process.argv[3]) + 200)
console.log(JSON.stringify({ count, sessions, lastTokens: last.input + last.cacheRead + last.cacheWrite + last.output, price, restartedCount, retainedHeapMiB, maxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }))
