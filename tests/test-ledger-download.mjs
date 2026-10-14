// Real HTTP response, injected auth boundary, and valid complete JSON/CSV.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const dir = mkdtempSync(join(tmpdir(), 'bib-download-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dir
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(dir, 'absent')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(dir, 'absent')
process.env.DSH_BOTTOM_INFO_BAR_SELF_UPDATE = 'off'
const realFetch = globalThis.fetch
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })
const records = Array.from({ length: 2000 }, (_, i) => ({ id: 'r-' + i, ts: 1787000000000 + i, provider: 'deepseek', model: 'deepseek-v4-flash', sessionId: 's-' + i, purpose: i === 0 ? '=synthetic,"quoted"\n第二行' : 'chat', input: i, cacheRead: 0, cacheWrite: 0, output: 1, cost: 0.01, currency: 'CNY' }))
writeFileSync(join(dir, 'usage-records.json'), JSON.stringify(records))
let route
const ctx = { get: () => undefined, credentials: { resolve: async () => null }, interval: () => () => {}, on: () => () => {}, inject(s, cb) { cb({ effect(fn) { const d = fn(); return () => d && d() }, connection: { requestRejection(req) { return req.headers.authorization === 'synthetic-local-test' ? undefined : 401 } }, webServer: { register(r) { route = r; return () => {} } } }); return () => {} } }
const plugin = (await import('../src/host.js')).default
const dispose = plugin.apply(ctx)
const server = createServer((req, res) => route.handler(req, res))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port + '/_dsh/dsh-bottom-info-bar/'
const headers = { authorization: 'synthetic-local-test', 'Content-Type': 'application/json' }
try {
  const unauthenticated = await realFetch(base + 'downloadUsageRecords')
  assert.equal(unauthenticated.status, 401)
  const metadata = await realFetch(base + 'exportUsageRecords', { method: 'POST', headers, body: '{"metadata":true}' }).then(r => r.json())
  assert.equal(metadata.recordCount, records.length)
  assert.equal(metadata.records, undefined)
  assert.equal((await realFetch(base + 'exportUsageRecords', { headers })).status, 413)
  const jsonResponse = await realFetch(base + 'downloadUsageRecords', { headers })
  assert.match(jsonResponse.headers.get('content-disposition'), /^attachment;/)
  const exported = await jsonResponse.json()
  assert.equal(exported.recordCount, records.length)
  assert.deepEqual(exported.records.map(r => [r.id, r.cost, r.input, r.purpose]), records.map(r => [r.id, r.cost, r.input, r.purpose]))
  const csv = await realFetch(base + 'downloadUsageRecords?format=csv', { headers }).then(r => r.text())
  assert.ok(csv.startsWith('timestamp,provider,model,sessionId'))
  assert.ok(csv.includes('"\'=synthetic,""quoted""\n第二行"'))
  assert.ok(csv.includes('s-1999'))
  assert.equal((await realFetch(base + 'downloadUsageRecords', { method: 'POST', headers })).status, 405)
  console.log('PASS  authenticated real HTTP streaming downloads preserve all 2000 records, Unicode/quoted CSV, and refuse unauthenticated or unbounded legacy responses')
} finally {
  await new Promise(resolve => server.close(resolve))
  dispose(); globalThis.fetch = realFetch
  rmSync(dir, { recursive: true, force: true })
}
