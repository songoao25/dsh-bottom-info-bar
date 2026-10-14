// 账本内存护栏（2026-10-14，Windows 宿主 OOM 修复）：
// ① 账本读写绝不把整本账同时变成一个大字符串 / 大 Buffer。旧路径单次 flush 的峰值分配 ≈ 2~4 倍账本
//    大小（快照串 + 整 Buffer + journal 整串/行数组/join 串），子代理密集记账时每 4 秒重来一次
//    （实测 10 万条账本单次 +150~200 MB 常驻 RSS）—— 这是插件对宿主内存峰值贡献最大的一块。
// ② 分块写出来的快照与压缩后的 journal 必须与旧路径等价：跨 500 条的写块边界也不能错、不能丢行。
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'bib-ledger-memory-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
process.env.DSH_BOTTOM_INFO_BAR_SELF_UPDATE = 'off'
const snapshotFile = join(dataDir, 'usage-records.json')
const journalFile = join(dataDir, 'usage-records.journal.jsonl')
const archiveDir = join(dataDir, 'usage-archive')

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')) }
}

// 4 万条窗内明细（不会被折叠；跨 500 条的写块边界 80 次）
const RECORDS = 40000
const TS_BASE = Date.now() - 6 * 60 * 60 * 1000
function record(i, sessionId) {
  return {
    id: 'mem-' + i, ts: TS_BASE + i, model: 'deepseek-v4-flash', provider: 'deepseek',
    sessionId: sessionId || ('sess-' + (i % 200)), purpose: 'chat',
    input: 100 + (i % 7), cacheRead: 200, cacheWrite: 0, output: 50,
    status: 'completed', currency: 'CNY', cost: 0.001, pricingStatus: 'priced', pricingVersion: 'builtin-test',
  }
}
const fixture = Array.from({ length: RECORDS }, (_, i) => record(i))
writeFileSync(snapshotFile, JSON.stringify(fixture))
writeFileSync(journalFile, fixture.map(function (r) { return JSON.stringify(r) + '\n' }).join(''))
const ledgerBytes = statSync(snapshotFile).size

// 夹具写完之后再装探针：只统计插件（以及后续被测代码）的单次分配
const realBufferFrom = Buffer.from
const realStringify = JSON.stringify
let maxBufferFrom = 0
let maxStringify = 0
Buffer.from = function () {
  const out = realBufferFrom.apply(Buffer, arguments)
  if (out.length > maxBufferFrom) maxBufferFrom = out.length
  return out
}
JSON.stringify = function () {
  const out = realStringify.apply(JSON, arguments)
  if (typeof out === 'string' && out.length > maxStringify) maxStringify = out.length
  return out
}

function makeStub() {
  const captured = { listener: null, route: null }
  return {
    captured,
    ctx: {
      get() { return undefined },
      credentials: { resolve: async () => null },
      interval() { return () => {} },
      timeout() { return () => {} },
      on(name, listener) { if (name === 'llm/stream') captured.listener = listener; return () => {} },
      inject(services, callback) {
        callback({ effect(fn) { const dispose = fn(); return () => dispose && dispose() }, connection: { requestRejection() { return undefined } }, webServer: { register(route) { captured.route = route; return () => {} } } })
        return () => {}
      },
    },
  }
}

async function drain(listener, sessionId) {
  async function* stream() {
    yield { type: 'usage', usage: { uncachedInputTokens: 11, cacheReadTokens: 22, outputTokens: 33 } }
    yield { type: 'finish' }
  }
  const iter = listener({ provider: 'deepseek', model: 'deepseek-v4-flash', sessionId }, async () => stream())
  for await (const chunk of iter) { /* drain */ }
}

const stub = makeStub()
const plugin = (await import('../src/host.js')).default
const dispose = plugin.apply(stub.ctx)
for (let i = 0; i < 3; i++) await drain(stub.captured.listener, 'mem-live')

// 防抖落盘 4 秒；这里等它跑完一次 flush（快照重写 + journal 压缩）
await new Promise(function (resolve) { setTimeout(resolve, 6000) })
dispose()

JSON.stringify = realStringify
Buffer.from = realBufferFrom

const halfLedger = Math.floor(ledgerBytes / 2)
check('① 没有任何一次 JSON.stringify 产出整本账大小的字符串（上限 = 半个账本 ' + Math.round(halfLedger / 1048576) + ' MB）',
  maxStringify <= halfLedger, 'max=' + maxStringify + 'B ledger=' + ledgerBytes + 'B')
check('② 没有任何一次 Buffer.from 复制整本账（上限 = 半个账本）',
  maxBufferFrom <= halfLedger, 'max=' + maxBufferFrom + 'B ledger=' + ledgerBytes + 'B')

let snapshot = null
try { snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8')) } catch (err) { snapshot = null }
check('③ 分块写出的快照仍是合法 JSON 数组', Array.isArray(snapshot), snapshot === null ? 'parse failed' : typeof snapshot)
check('④ 快照条数 = 原有 ' + RECORDS + ' 条 + 新记 3 条（分块边界不丢记录）',
  Array.isArray(snapshot) && snapshot.length === RECORDS + 3, snapshot ? String(snapshot.length) : 'null')
check('⑤ 快照顺序与内容保持（首条 / 末条）',
  Array.isArray(snapshot) && snapshot[0] && snapshot[0].id === 'mem-0' && snapshot[RECORDS] && snapshot[RECORDS].sessionId === 'mem-live',
  snapshot && snapshot[0] ? snapshot[0].id + ' / ' + (snapshot[RECORDS] && snapshot[RECORDS].sessionId) : 'n/a')

let journalText = ''
try { journalText = readFileSync(journalFile, 'utf8') } catch (err) { journalText = '' }
const journalLines = journalText.split('\n').filter(function (line) { return line.trim() !== '' })
check('⑥ 已在快照里的 journal 行被压干净（分块压缩不残留、不误删）',
  journalLines.length === 0, 'lines=' + journalLines.length + ' bytes=' + journalText.length)

let folded = false
try { folded = statSync(archiveDir).isDirectory() } catch (err) { folded = false }
check('⑦ 窗内明细不触发折叠（本次只验证写入路径，不改折叠语义）', folded === false)

dispose()
rmSync(dataDir, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
