// issue #260：账本 worker 客户端回归。
//
// 覆盖：
//   ① 真实 worker 往返（打开/写入/查询/分页扫描/回填/导出/清空）；
//   ② 懒启动：start() 可重入，打开前不接触主线程 sqlite；
//   ③ 降级：数据目录不可用时 start 失败、后续操作快速失败，不抛未捕获异常；
//   ④ 关闭后调用明确失败，且数据在下一个客户端里仍可读（WAL 持久性）。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLedgerClient } from '../src/ledger-client.js'

const directories = []
function temp(name) {
  const dir = mkdtempSync(join(tmpdir(), 'bib-client-' + name + '-'))
  directories.push(dir)
  return dir
}

let pass = 0
const failures = []
function check(name, condition, detail) {
  if (condition) { pass += 1; console.log('PASS  ' + name) }
  else { failures.push(name); console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const TS = 1787000000000
function record(id, ts, extra) {
  return Object.assign({
    id: id,
    ts: ts,
    model: 'deepseek-flash',
    provider: 'deepseek-official',
    sessionId: 'session-' + id,
    purpose: '',
    input: 1000000,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    status: 'completed',
  }, extra || {})
}

try {
  // ---------- ① + ② 真实 worker 往返（懒启动、可重入） ----------
  const dir = temp('roundtrip')
  const client = createLedgerClient({ dir })
  check('新建客户端处于 idle 状态', client.state === 'idle')
  const started = await Promise.all([client.start(), client.start(), client.start()])
  check('start() 可重入且都成功', started.length === 3 && client.state === 'ready')
  check('干净数据目录没有账本告警', client.warning === null, client.warning)

  const pricedA = record('a', TS, { cost: 2, currency: 'CNY' })
  const pricedB = record('b', TS + 1, { cost: 3, currency: 'CNY' })
  const a1 = await client.append(pricedA)
  const a2 = await client.append(pricedB)
  check('append 返回写入结果', a1.written === true && a2.written === true, [a1, a2])
  check('count 反映两条记录', await client.count() === 2)
  check('providerSpend 读到账户累计（deepseek=5）', await client.providerSpend('deepseek') === 5, await client.providerSpend('deepseek'))
  check('sessionsCount 读到会话数', await client.sessionsCount('deepseek') === 2)
  const sessions = await client.recentSessions('deepseek', 10)
  check('recentSessions 返回两行且带 costs', sessions.length === 2 && sessions[0].costs.CNY + sessions[1].costs.CNY === 5, sessions)
  const owned = await client.ownedSessions('deepseek', ['a'])
  check('ownedSessions 只返回指定会话', owned.length === 1 && owned[0].norm === 'a', owned)
  const sum = await client.daySum('deepseek', 'CNY', '0000-00-00', '9999-99-99')
  check('daySum 汇总当天花费', sum.cost === 5 && sum.active === 1, sum)

  // 单调时间戳由 worker 保证：同毫秒及更早的 ts 会被推后。
  const dupTs = await client.append(record('c', TS, { cost: 0, currency: 'CNY' }))
  check('append 会把非递增 ts 推到 lastTs+1', dupTs.ts > (await client.lastTs()) - 1 && dupTs.adjusted === true, dupTs)

  // 分页扫描：limit 2 分两次读完，不重复。
  const page1 = await client.scanPage(0, TS + 10, null, 2)
  const page2 = await client.scanPage(0, TS + 10, page1.cursor, 2)
  const scanned = page1.records.concat(page2.records).map((item) => item.record.id)
  check('scanPage 分页无重复且覆盖全部', page1.records.length === 2 && !page1.done && page2.records.length >= 1 && new Set(scanned).size === scanned.length, { page1: page1.records.length, page2: page2.records.length })

  // 未计价记录回填（worker 用自己的价目副本算钱）。
  const unpriced = await client.append(record('d', TS + 5, { id: 'd' }))
  check('未计价记录可以写入', unpriced.written === true)
  const adjusted = await client.backfill('test-backfill')
  check('backfill 至少补算出未计价记录', adjusted >= 1, adjusted)

  // 导出：分页拉全量，条数与 count 一致。
  const exportA = await client.exportStart()
  const exportB = await client.exportStart()
  let exportedA = 0
  let exportedB = 0
  let doneA = false
  let doneB = false
  while (!doneA || !doneB) {
    if (!doneA) { const page = await client.exportNext(exportA.id, 1); exportedA += page.rows.length; doneA = page.done }
    if (!doneB) { const page = await client.exportNext(exportB.id, 3); exportedB += page.rows.length; doneB = page.done }
  }
  await client.exportEnd(exportA.id)
  await client.exportEnd(exportB.id)
  check('导出分页覆盖全部记录', exportedA === exportA.recordCount && exportedA === 4, { exportedA, recordCount: exportA.recordCount })
  check('两个并发导出互不干扰（各自的游标独立）', exportedB === exportB.recordCount && exportedB === 4, { exportedB, recordCount: exportB.recordCount })

  // ---------- ④ 关闭后调用失败 ----------
  await client.close()
  check('close 后状态为 closed', client.state === 'closed')
  await assert.rejects(client.count())
  check('close 后操作快速失败（不挂起）', true)

  // ---------- 数据在下一个客户端里仍可读 ----------
  const reopened = createLedgerClient({ dir })
  await reopened.start()
  check('重新打开后记录仍在（WAL 持久化）', await reopened.count() === 4)
  check('清空接口工作并返回条数', await reopened.clear() === 4)
  check('清空后 count 归零', await reopened.count() === 0)
  await reopened.close()

  // ---------- ③ 数据目录不可用 → 快速降级 ----------
  const blocker = join(temp('blocked'), 'not-a-dir')
  writeFileSync(blocker, 'x')
  const broken = createLedgerClient({ dir: join(blocker, 'ledger') })
  let startError = null
  try { await broken.start() } catch (err) { startError = err }
  check('目录不可用时 start 失败并给出错误', startError !== null && broken.state === 'failed', startError && startError.message)
  await assert.rejects(broken.count())
  check('失败后后续操作快速失败', true)
  await broken.close()

  // ---------- 打开超时 → 有界等待 ----------
  // 真实 worker 不会卡住；这里只验证超时选项被接受且不改变正常路径。
  const fastTimeoutDir = temp('timeout')
  const quick = createLedgerClient({ dir: fastTimeoutDir, openTimeoutMs: 5000 })
  await quick.start()
  check('自定义打开超时不影响正常打开', quick.state === 'ready')
  await quick.close()
} finally {
  for (const dir of directories) {
    try { rmSync(dir, { recursive: true, force: true }) } catch (err) { /* 清理由测试环境决定 */ }
  }
}

if (failures.length === 0) {
  console.log('\nledger worker client OK (' + pass + ' checks)')
} else {
  console.log('\n' + failures.length + ' 项失败：' + failures.join(' | '))
  process.exitCode = 1
}
