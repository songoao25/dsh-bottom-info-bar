// Actual host startup/burst/restart under a restricted heap; all data is synthetic.
import assert from 'node:assert/strict'
import { mkdtempSync, openSync, writeSync, closeSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root = mkdtempSync(join(tmpdir(), 'bib-memory-'))
const count = 300000
try {
  const fd = openSync(join(root, 'usage-records.json'), 'w')
  writeSync(fd, '[')
  for (let i = 0; i < count; i++) {
    const r = { id: 'synthetic-' + i, ts: 1787000000000 + i, model: 'unknown-model', provider: 'deepseek', sessionId: 'session-' + i, purpose: 'chat', input: 100, cacheRead: 10, cacheWrite: 0, output: 50, pricingStatus: 'unpriced' }
    writeSync(fd, (i ? ',' : '') + JSON.stringify(r))
  }
  writeSync(fd, ']'); closeSync(fd)
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', '--expose-gc', fileURLToPath(new URL('./ledger-memory-worker.mjs', import.meta.url)), root, String(count)], { encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024, cwd: tmpdir() })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr + '\n' + result.stdout)
  const report = JSON.parse(result.stdout.trim().split('\n').at(-1))
  assert.equal(report.count, count + 200)
  assert.equal(report.sessions, count + 200)
  assert.equal(report.lastTokens, 160)
  assert.equal(report.restartedCount, report.count)
  assert.equal(report.price, 0)
  assert.ok(report.maxRssMiB < 320, JSON.stringify(report))
  assert.ok(report.retainedHeapMiB < 32, JSON.stringify(report))
  console.log('PASS  300000 unpriced records/distinct sessions + 200 concurrent bills retain all counts and survive restart under a 128 MiB JS heap: ' + JSON.stringify(report))
} finally { rmSync(root, { recursive: true, force: true }) }
