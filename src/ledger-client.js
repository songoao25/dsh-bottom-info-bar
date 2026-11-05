// Bottom Info Bar — 账本异步客户端（主线程侧，issue #260）
//
// 主线程永远不会同步碰 sqlite：所有账本操作都发消息给 ledger-worker，自己只等 Promise。
// 三条硬边界：
//   ① 打开超时（默认 20s）——worker 卡死也不能让宿主主线程跟着卡；
//   ② worker 崩了/退了，所有在途请求立刻以「账本不可用」失败，调用方按既有降级路径显示；
//   ③ worker 只在有在途请求时 ref()，空闲时 unref()，不拖住宿主/测试进程退出。
// 打开之前合并进来的远程价目（setPricing）暂存在本客户端，worker 打开成功后先发送这些
// 增量、再放行其他操作，保证 worker 的价目表与主线程一致。
import { Worker } from 'node:worker_threads'

export const LEDGER_OPEN_TIMEOUT_MS = 20000
export const LEDGER_REQUEST_TIMEOUT_MS = 120000
export const LEDGER_BACKFILL_TIMEOUT_MS = 600000
export const LEDGER_CLOSE_TIMEOUT_MS = 5000

function ledgerError(message, code, status) {
  const err = new Error(message)
  if (code) err.code = code
  if (status != null) err.status = status
  return err
}

function unrefTimer(timer) {
  if (timer && typeof timer.unref === 'function') timer.unref()
  return timer
}

function delay(ms) {
  return new Promise(function (resolve) { unrefTimer(setTimeout(resolve, ms)) })
}

export function createLedgerClient(options) {
  const settings = options || {}
  const dir = settings.dir
  const log = typeof settings.log === 'function' ? settings.log : function () {}
  const openTimeoutMs = Number.isFinite(settings.openTimeoutMs) ? settings.openTimeoutMs : LEDGER_OPEN_TIMEOUT_MS
  const requestTimeoutMs = Number.isFinite(settings.requestTimeoutMs) ? settings.requestTimeoutMs : LEDGER_REQUEST_TIMEOUT_MS
  const backfillTimeoutMs = Number.isFinite(settings.backfillTimeoutMs) ? settings.backfillTimeoutMs : LEDGER_BACKFILL_TIMEOUT_MS

  let worker = null
  let state = 'idle' // idle | starting | ready | failed | closed
  let warning = null
  let failure = null
  let startPromise = null
  let nextId = 0
  const pending = new Map()
  let queuedPricing = Object.create(null)
  let hasQueuedPricing = false

  function setState(next) { state = next }

  function settle(reason) {
    for (const entry of pending.values()) {
      try { entry.reject(reason) } catch (err) { /* 调用方已不再关心 */ }
    }
    pending.clear()
    if (worker && typeof worker.unref === 'function') {
      try { worker.unref() } catch (err) { /* worker 已退出 */ }
    }
  }

  function terminateWorker() {
    const current = worker
    worker = null
    if (!current) return Promise.resolve()
    try { current.removeAllListeners() } catch (err) { /* 已终止 */ }
    try {
      const termination = current.terminate()
      return termination && typeof termination.then === 'function' ? termination.catch(function () {}) : Promise.resolve()
    } catch (err) {
      return Promise.resolve()
    }
  }

  function onMessage(message) {
    if (!message || typeof message !== 'object') return
    if (message.type === 'fatal') {
      // worker 内部未捕获异常：标记账本不可用，后续调用走降级路径。
      if (state !== 'closed' && state !== 'failed') log('[dsh-bottom-info-bar] ledger worker fatal: ' + (message.error && message.error.message))
      return
    }
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (pending.size === 0 && worker && typeof worker.unref === 'function') {
      try { worker.unref() } catch (err) { /* worker 已退出 */ }
    }
    if (message.ok) {
      entry.resolve(message.value)
    } else {
      const info = message.error || {}
      entry.reject(ledgerError(info.message || 'Ledger operation failed.', info.code, info.status))
    }
  }

  function onWorkerError(err) {
    if (state === 'closed') return
    const wrapped = ledgerError('Ledger worker failed: ' + String((err && err.message) || err), 'BIB_LEDGER_WORKER_FAILED')
    failure = wrapped
    setState('failed')
    startPromise = null
    settle(wrapped)
    log('[dsh-bottom-info-bar] ' + wrapped.message)
  }

  function onWorkerExit(code) {
    if (state === 'closed') return
    const wrapped = ledgerError('Ledger worker exited unexpectedly (code ' + code + ').', 'BIB_LEDGER_WORKER_EXITED')
    failure = wrapped
    if (state !== 'failed') setState('failed')
    startPromise = null
    settle(wrapped)
    log('[dsh-bottom-info-bar] ' + wrapped.message)
  }

  function spawn() {
    if (!dir) throw ledgerError('The ledger data directory is not configured.', 'BIB_LEDGER_NO_DIR')
    const created = new Worker(new URL('./ledger-worker.js', import.meta.url), { workerData: { dir: dir } })
    created.on('message', onMessage)
    created.on('error', onWorkerError)
    created.on('exit', onWorkerExit)
    if (typeof created.unref === 'function') created.unref()
    return created
  }

  function send(op, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (state === 'failed') { reject(failure || ledgerError('Ledger is unavailable.', 'BIB_LEDGER_UNAVAILABLE')); return }
      if (state === 'closed') { reject(ledgerError('Ledger is closed.', 'BIB_LEDGER_CLOSED')); return }
      if (!worker) {
        try { worker = spawn() } catch (err) { reject(err); return }
      }
      const id = nextId += 1
      const timer = unrefTimer(setTimeout(function () {
        if (!pending.has(id)) return
        pending.delete(id)
        if (pending.size === 0 && worker && typeof worker.unref === 'function') {
          try { worker.unref() } catch (err) { /* worker 已退出 */ }
        }
        reject(ledgerError('The ledger worker did not answer "' + op + '" within ' + timeoutMs + ' ms.', 'BIB_LEDGER_TIMEOUT'))
      }, timeoutMs))
      pending.set(id, {
        resolve: function (value) { clearTimeout(timer); resolve(value) },
        reject: function (err) { clearTimeout(timer); reject(err) },
      })
      if (typeof worker.ref === 'function') worker.ref()
      try {
        worker.postMessage(Object.assign({ id: id, op: op }, payload))
      } catch (err) {
        pending.delete(id)
        clearTimeout(timer)
        reject(ledgerError('Could not send a ledger request: ' + String((err && err.message) || err), 'BIB_LEDGER_POST_FAILED'))
      }
    })
  }

  function start() {
    if (state === 'ready') return Promise.resolve()
    if (state === 'failed') return Promise.reject(failure || ledgerError('Ledger is unavailable.', 'BIB_LEDGER_UNAVAILABLE'))
    if (state === 'closed') return Promise.reject(ledgerError('Ledger is closed.', 'BIB_LEDGER_CLOSED'))
    if (startPromise) return startPromise
    setState('starting')
    startPromise = send('open', {}, openTimeoutMs).then(function (value) {
      warning = value && value.warning ? String(value.warning) : null
      setState('ready')
      if (!hasQueuedPricing) return undefined
      const entries = queuedPricing
      queuedPricing = Object.create(null)
      hasQueuedPricing = false
      // 远程价目先送达 worker，再放行后续回填/汇总，避免两边价目表不一致。
      return send('setPricing', { entries: entries }, requestTimeoutMs)
    }).then(function () {
      return undefined
    }).catch(function (err) {
      const wrapped = ledgerError('Ledger unavailable: ' + String((err && err.message) || err), (err && err.code) || 'BIB_LEDGER_UNAVAILABLE')
      failure = wrapped
      setState('failed')
      startPromise = null
      terminateWorker()
      throw wrapped
    })
    return startPromise
  }

  async function call(op, payload, timeoutMs) {
    await start()
    return send(op, payload || {}, timeoutMs == null ? requestTimeoutMs : timeoutMs)
  }

  function setPricing(entries) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return Promise.resolve(0)
    if (state === 'closed') return Promise.reject(ledgerError('Ledger is closed.', 'BIB_LEDGER_CLOSED'))
    if (state === 'failed') return Promise.reject(failure || ledgerError('Ledger is unavailable.', 'BIB_LEDGER_UNAVAILABLE'))
    if (state === 'ready') {
      return call('setPricing', { entries: entries }).then(function (value) { return Number(value && value.added) || 0 })
    }
    Object.assign(queuedPricing, entries)
    hasQueuedPricing = true
    return Promise.resolve(0)
  }

  async function close() {
    if (state === 'closed') return
    const ready = state === 'ready'
    // 先让 worker 自己 checkpoint + close（保证 WAL 落盘、释放文件锁），再改状态，
    // 否则 Windows 上测试/宿主紧接着读或删数据目录会碰到 "database is locked"。
    if (ready && worker) {
      try { await Promise.race([send('close', {}, LEDGER_CLOSE_TIMEOUT_MS), delay(LEDGER_CLOSE_TIMEOUT_MS + 500)]) } catch (err) { /* 尽力关闭 */ }
    }
    setState('closed')
    settle(ledgerError('Ledger is closed.', 'BIB_LEDGER_CLOSED'))
    await terminateWorker()
  }

  return {
    start: start,
    close: close,
    setPricing: setPricing,
    append: function (record) { return call('append', { record: record }) },
    lastTs: function () { return call('lastTs').then(function (value) { return value && value.ts != null ? value.ts : null }) },
    count: function () { return call('count').then(function (value) { return value && Number(value.count) || 0 }) },
    providerSpend: function (account) { return call('providerSpend', { account: account == null ? null : account }).then(function (value) { return Number(value && value.total) || 0 }) },
    sessionsCount: function (account) { return call('sessionsCount', { account: account == null ? null : account }).then(function (value) { return Number(value && value.count) || 0 }) },
    recentSessions: function (account, count) { return call('recentSessions', { account: account == null ? null : account, count: count }).then(function (value) { return Array.isArray(value && value.rows) ? value.rows : [] }) },
    ownedSessions: function (account, ids) {
      return call('ownedSessions', { account: account == null ? null : account, ids: Array.from(ids || []) }).then(function (value) { return Array.isArray(value && value.rows) ? value.rows : [] })
    },
    daySum: function (account, currency, from, to) {
      return call('daySum', { account: account == null ? null : account, currency: currency, from: from, to: to }).then(function (value) {
        return { cost: Number(value && value.cost) || 0, offpeak: Number(value && value.offpeak) || 0, active: Number(value && value.active) || 0 }
      })
    },
    scanPage: function (from, to, cursor, limit) {
      return call('scanPage', { from: from, to: to, cursor: cursor || null, limit: limit }).then(function (value) {
        return {
          records: Array.isArray(value && value.records) ? value.records : [],
          cursor: (value && value.cursor) || null,
          done: !!(value && value.done),
        }
      })
    },
    backfill: function (version) { return call('backfill', { version: version }, backfillTimeoutMs).then(function (value) { return Number(value && value.changed) || 0 }) },
    exportStart: function () {
      return call('exportStart').then(function (value) { return { id: value && value.id, recordCount: Number(value && value.recordCount) || 0 } })
    },
    exportPage: function (after, limit) {
      return call('exportPage', { after: after == null ? 0 : after, limit: limit }).then(function (value) {
        return {
          records: Array.isArray(value && value.records) ? value.records : [],
          next: value && value.next != null ? value.next : 0,
          done: !!(value && value.done),
        }
      })
    },
    exportNext: function (id, count) { return call('exportNext', { exportId: id, count: count }).then(function (value) { return { rows: Array.isArray(value && value.rows) ? value.rows : [], done: !!(value && value.done) } }) },
    exportEnd: function (id) { return call('exportEnd', { exportId: id }) },
    clear: function () { return call('clear').then(function (value) { return Number(value && value.count) || 0 }) },
    checkpoint: function () { return call('checkpoint') },
    get state() { return state },
    get warning() { return warning },
    get error() { return failure },
  }
}
