// Bottom Info Bar — 账本 worker（issue #260）
//
// 为什么账本要放进 worker：node:sqlite 是同步 API。以前插件在宿主主线程上直接打开/查询
// sqlite；在用户报告的 Linux 桌面环境里，宿主启动后约 2 秒事件循环就停住，不再 accept 新
// TCP 连接（进程空闲、fd 稳定、已有 WebSocket 仍可用），而本插件是唯一会同步碰 sqlite 的
// 插件。把唯一的 DatabaseSync 连接放进 worker 后，主线程只收发消息，任何慢/卡住的 sqlite
// 调用都只会让账本功能降级，而不是把整个宿主拖死。
//
// 这里同时接管旧数据迁移与未计价回填：两者本来就是纯账本工作，以前同步跑在宿主主线程上。
// 计价与账户映射来自 ./accounting.js —— 与主线程同一份实现，避免两边金额漂移。
//
// 协议：主线程发 { id, op, ...payload }，这里回 { id, ok: true, value } 或
// { id, ok: false, error: { message, code, status } }。所有操作按到达顺序串行执行。
import { parentPort, workerData } from 'node:worker_threads'
import { openLedgerStore } from './ledger-store.js'
import { accountForProvider, createAccounting, safeMapKey } from './accounting.js'

const accounting = createAccounting()
let store = null
let storeError = null
let exportSeq = 0
const exportSessions = new Map()

function recordCurrency(record) {
  return record && typeof record.currency === 'string' && record.currency.length > 0
    ? record.currency
    : accounting.modelCurrency(record && record.provider, record && record.model)
}

function openStore() {
  if (store) return store
  if (storeError) throw storeError
  try {
    store = openLedgerStore(workerData.dir, {
      account: function (record) { return accountForProvider(record.provider) },
      currency: function (record) { return recordCurrency(record) },
      cost: function (record, offpeak) { return accounting.costOf(record, offpeak) },
      safeKey: safeMapKey,
    })
    return store
  } catch (err) {
    storeError = err
    throw err
  }
}

function closeExportSession(id) {
  const session = exportSessions.get(id)
  if (!session) return
  exportSessions.delete(id)
  try { session.close() } catch (err) { /* 释放失败不影响下一位下载 */ }
}

function errorPayload(err) {
  const message = err && err.message ? String(err.message) : String(err)
  return {
    message: message,
    code: err && err.code ? String(err.code) : null,
    status: err && Number.isFinite(err.status) ? err.status : null,
  }
}

// 每个 op 都是同步的（worker 自己的事件循环可以随便被 sqlite 阻塞，与宿主无关）。
const handlers = {
  open() {
    const opened = openStore()
    return { warning: opened.warning || null }
  },
  append(message) {
    const opened = openStore()
    const record = message.record
    if (!record || typeof record !== 'object') {
      const err = new Error('Ledger append requires a record object.')
      err.code = 'BIB_LEDGER_INVALID_RECORD'
      throw err
    }
    // 单调时间戳在 worker 内保证：同毫秒并发记账也不会让 currentSession 按 ts 过滤时串会话。
    const lastTs = opened.lastTs()
    let adjusted = false
    if (Number.isFinite(record.ts) && lastTs != null && record.ts <= lastTs) {
      record.ts = lastTs + 1
      adjusted = true
    }
    return { written: !!opened.append(record), ts: record.ts, adjusted: adjusted }
  },
  lastTs() { return { ts: openStore().lastTs() } },
  count() { return { count: openStore().count() } },
  providerSpend(message) { return { total: openStore().providerSpend(message.account == null ? null : message.account) } },
  sessionsCount(message) { return { count: openStore().sessionsCount(message.account == null ? null : message.account) } },
  recentSessions(message) { return { rows: openStore().recentSessions(message.account == null ? null : message.account, message.count) } },
  ownedSessions(message) {
    const rows = []
    openedOwned(message, function (row) { rows.push(row) })
    return { rows: rows }
  },
  daySum(message) {
    const bucket = openStore().daySum(message.account == null ? null : message.account, message.currency, message.from, message.to)
    return { cost: Number(bucket.cost) || 0, offpeak: Number(bucket.offpeak) || 0, active: Number(bucket.active) || 0 }
  },
  scanPage(message) {
    return openStore().scanPage(message.from, message.to, message.cursor, message.limit)
  },
  backfill(message) {
    const changed = openStore().backfill(
      function (record) { return accounting.costOf(record, false) },
      function (record) { return accounting.modelCurrency(record.provider, record.model) },
      message.version
    )
    return { changed: changed }
  },
  exportStart() {
    // 每个导出各持一份只读快照：宿主允许两个下载并行，不能互相顶掉对方的游标。
    const snapshot = openStore().exportSnapshot()
    exportSeq += 1
    const id = exportSeq
    exportSessions.set(id, snapshot)
    return { id: id, recordCount: snapshot.recordCount }
  },
  exportNext(message) {
    const session = exportSessions.get(message.exportId)
    if (!session) {
      const err = new Error('No export snapshot is open.')
      err.code = 'BIB_LEDGER_EXPORT_CLOSED'
      throw err
    }
    const wanted = Math.max(1, Math.min(Number(message.count) || 64, 256))
    const rows = []
    let done = false
    while (rows.length < wanted) {
      const item = session.rows.next()
      if (item.done) { done = true; break }
      rows.push(item.value.payload)
    }
    return { rows: rows, done: done }
  },
  exportEnd(message) {
    closeExportSession(message.exportId)
    return {}
  },
  exportPage(message) {
    return openStore().exportPage(message.after, message.limit)
  },
  clear() { return { count: openStore().clear() } },
  setPricing(message) { return { added: accounting.setRemotePricingEntries(message.entries) } },
  checkpoint() { openStore().checkpoint(); return {} },
  close() {
    for (const id of Array.from(exportSessions.keys())) closeExportSession(id)
    if (store) {
      try { store.checkpoint() } catch (err) { /* 尽力冲刷，失败不影响关闭 */ }
      store.close()
      store = null
    }
    return {}
  },
}

function openedOwned(message, visit) {
  const ids = Array.isArray(message.ids) ? message.ids : []
  openStore().forOwnedSessions(message.account == null ? null : message.account, ids, visit)
}

function reply(id, payload) {
  try { parentPort.postMessage(Object.assign({ id: id }, payload)) } catch (err) {
    // 序列化失败（payload 异常）时至少给出错误，避免主线程永远等这一条
    try { parentPort.postMessage({ id: id, ok: false, error: errorPayload(err) }) } catch (err2) { /* 退出前最后一次尝试 */ }
  }
}

parentPort.on('message', function (message) {
  if (!message || typeof message !== 'object') return
  const id = message.id
  try {
    const handler = Object.hasOwn(handlers, message.op) ? handlers[message.op] : null
    if (!handler) {
      const err = new Error('Unknown ledger worker operation: ' + String(message.op))
      err.code = 'BIB_LEDGER_UNKNOWN_OP'
      throw err
    }
    reply(id, { ok: true, value: handler(message) })
  } catch (err) {
    reply(id, { ok: false, error: errorPayload(err) })
  }
})

// worker 内部未捕获异常只上报，不静默吞掉；主线程会把它当作账本不可用。
process.on('uncaughtException', function (err) {
  try { parentPort.postMessage({ type: 'fatal', error: errorPayload(err) }) } catch (err2) { /* 宿主已关闭 */ }
})
process.on('unhandledRejection', function (err) {
  try { parentPort.postMessage({ type: 'fatal', error: errorPayload(err) }) } catch (err2) { /* 宿主已关闭 */ }
})
