// Disk-backed ledger. No history-sized arrays, caches or export responses.
import { createRequire } from 'node:module'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'

let DatabaseSync
try { ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite')) } catch { /* handled when opening, without breaking other plugin features */ }
export const LEDGER_FILE = 'usage-ledger.sqlite'
export const MAX_VALUE_BYTES = 1024 * 1024
export const EXPORT_PAGE_SIZE = 256
const DAY = 86400000
const OFFSET = 8 * 3600000
function dayKey(ts) { return new Date(ts + OFFSET).toISOString().slice(0, 10) }
function normalizeSession(id) { return String(id || '').replace(/^session-/, '') }
function invalid(message) { const err = new Error(message); err.code = 'BIB_LEDGER_INVALID_JSON'; return err }
function problem(message) { const err = new Error(message); err.code = 'BIB_LEDGER_UNAVAILABLE'; return err }

// Streaming JSON walker: only one selected record/map entry is materialized.
// The parser validates the complete document, including its closing delimiter.
export function walkJsonFile(file, select, visit, rootKind, shape) {
  const fd = openSync(file, 'r')
  const buffer = Buffer.alloc(64 * 1024)
  const decoder = new StringDecoder('utf8')
  let chunk = '', pos = 0, ended = false
  function peek() {
    while (pos >= chunk.length && !ended) {
      const n = readSync(fd, buffer, 0, buffer.length, null)
      chunk = n ? decoder.write(buffer.subarray(0, n)) : decoder.end()
      pos = 0
      if (!n) ended = true
    }
    return chunk[pos] || ''
  }
  function take() {
    const c = peek();
    if (c) {
      pos++;
      if (budget) { budget.bytes += Buffer.byteLength(c); if (budget.bytes > MAX_VALUE_BYTES) throw problem('Ledger entry exceeds the safe size limit; original files have been preserved.') }
    }
    return c
  }
  function space() { while (/\s/.test(peek()) && peek()) take() }
  let budget = null
  function value(path, capture, depth) {
    if (depth > 32) throw invalid('Ledger JSON nesting is too deep; original files have been preserved.')
    space()
    const selected = !capture && select(path)
    if (selected) budget = { bytes: 0, nodes: 0 }
    const keep = capture || selected
    if (budget && ++budget.nodes > 8192) throw problem('Ledger entry exceeds the safe complexity limit; original files have been preserved.')
    const c = take()
    if (shape) shape(path, c)
    if (depth === 0 && rootKind && c !== rootKind) throw invalid('Invalid ledger JSON root.')
    let out
    if (c === '[' || c === '{') {
      const array = c === '['
      out = keep ? (array ? [] : Object.create(null)) : undefined
      const end = array ? ']' : '}'
      space()
      if (peek() === end) take()
      else {
        let index = 0
        for (;;) {
          let key = index
          if (!array) { space(); key = scalar(); if (typeof key !== 'string') throw invalid('Invalid ledger JSON key.'); space(); if (take() !== ':') throw invalid('Invalid ledger JSON separator.') }
          const item = value(path.concat(key), keep, depth + 1)
          if (keep) out[key] = item
          space()
          const separator = take()
          if (separator === end) break
          if (separator !== ',') throw invalid('Incomplete ledger JSON; original files have been preserved.')
          index++
        }
      }
    } else {
      if (!c) throw invalid('Incomplete ledger JSON; original files have been preserved.')
      pos--
      out = scalar()
    }
    if (selected) { budget = null; visit(path, out) }
    return out
  }
  function scalar() {
    space()
    let raw = '', bytes = 0
    function append(c) {
      raw += c; bytes += c.length
      if (bytes > MAX_VALUE_BYTES) throw problem('Ledger entry exceeds the safe size limit; original files have been preserved.')
    }
    if (peek() === '"') {
      append(take())
      let escaped = false
      for (;;) {
        const c = take()
        if (!c) throw invalid('Incomplete ledger JSON string.')
        append(c)
        if (!escaped && c === '"') break
        if (!escaped && c === '\\') escaped = true
        else escaped = false
      }
    } else {
      while (peek() && !/[\s,\]}:]/.test(peek())) append(take())
    }
    return JSON.parse(raw)
  }
  try { value([], false, 0); space(); if (peek()) throw invalid('Invalid trailing ledger JSON.') } finally { closeSync(fd) }
}

export function forEachLedgerLine(file, visit) {
  const fd = openSync(file, 'r'), buffer = Buffer.alloc(64 * 1024)
  let carry = Buffer.alloc(0), index = 0
  try {
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null)
      if (!n) break
      const block = carry.length ? Buffer.concat([carry, buffer.subarray(0, n)]) : buffer.subarray(0, n)
      let start = 0
      for (let i = 0; i < block.length; i++) {
        if (block[i] !== 10) continue
        if (i - start > MAX_VALUE_BYTES) throw problem('Ledger line exceeds the safe size limit; original files have been preserved.')
        visit(block.subarray(start, i).toString('utf8'), index++)
        start = i + 1
      }
      if (block.length - start > MAX_VALUE_BYTES) throw problem('Ledger line exceeds the safe size limit; original files have been preserved.')
      carry = Buffer.from(block.subarray(start))
    }
    if (carry.length) visit(carry.toString('utf8'), index)
  } finally { closeSync(fd) }
}

export function validRecord(r) {
  return !!r && typeof r === 'object' && typeof r.model === 'string' && typeof r.provider === 'string'
    && ['ts', 'input', 'cacheRead', 'cacheWrite', 'output'].every(k => Number.isFinite(r[k]) && r[k] >= 0)
    && Number.isFinite(r.ts + OFFSET) && !Number.isNaN(new Date(r.ts + OFFSET).getTime())
}
function normalized(r, index, source) {
  const out = { ...r }
  if (typeof out.id !== 'string' || !out.id) {
    const stable = JSON.stringify([source, index, r.ts, r.provider, r.model, r.sessionId, r.input, r.cacheRead, r.cacheWrite, r.output])
    out.id = 'legacy-' + createHash('sha256').update(stable).digest('hex').slice(0, 24)
  }
  out.sessionId = String(r.sessionId == null ? '' : r.sessionId)
  out.purpose = String(r.purpose == null ? '' : r.purpose)
  out.status = r.status === 'interrupted' ? 'interrupted' : 'completed'
  const amount = typeof r.cost === 'string' && r.cost.trim() ? Number(r.cost) : r.cost
  if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) { out.cost = amount; out.pricingStatus = 'priced' }
  else { delete out.cost; delete out.pricingVersion; out.pricingStatus = 'unpriced' }
  if (out.currency !== 'CNY' && out.currency !== 'USD') delete out.currency
  return out
}

export function openLedgerStore(dir, hooks) {
  if (!DatabaseSync) throw problem('This DSH version cannot open the ledger. Update DSH to a version with Node.js 22.13 or newer; your existing ledger is unchanged.')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const file = join(dir, LEDGER_FILE)
  const db = new DatabaseSync(file)
  const statements = new Map()
  const sql = text => { let s = statements.get(text); if (!s) { s = db.prepare(text); statements.set(text, s) } return s }
  const get = (text, ...args) => sql(text).get(...args)
  const run = (text, ...args) => sql(text).run(...args)
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value } catch (err) { db.exec('ROLLBACK'); throw err } }
  function permissions() { for (const name of [file, file + '-wal', file + '-shm']) { if (existsSync(name)) chmodSync(name, 0o600) } }
  try {
    db.exec('PRAGMA busy_timeout=5000');
    if (get('PRAGMA user_version').user_version > 1) throw problem('This ledger needs a newer plugin version; no data has been changed.')
    db.exec(`PRAGMA busy_timeout=5000; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
      PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=256;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(seq INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,ts REAL NOT NULL,account TEXT NOT NULL,currency TEXT NOT NULL,cost REAL,offpeak REAL,folded INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_time ON records(ts);
      CREATE INDEX IF NOT EXISTS records_pending ON records(cost,seq);
      CREATE TABLE IF NOT EXISTS days(day TEXT,account TEXT,currency TEXT,input REAL,cacheRead REAL,cacheWrite REAL,output REAL,cost REAL,costOffpeak REAL,records INTEGER,unpriced INTEGER,PRIMARY KEY(day,account,currency));
      CREATE TABLE IF NOT EXISTS sessions(key TEXT PRIMARY KEY,account TEXT,norm TEXT,sessionId TEXT,input REAL,cacheRead REAL,cacheWrite REAL,output REAL,costs TEXT,minTs REAL,maxTs REAL,unpricedRecords INTEGER,unpricedTokens REAL);
      CREATE INDEX IF NOT EXISTS sessions_recent ON sessions(account,maxTs DESC);
      CREATE INDEX IF NOT EXISTS sessions_owned ON sessions(account,norm);
      CREATE TABLE IF NOT EXISTS accounts(account TEXT PRIMARY KEY,cost REAL NOT NULL);`)
    permissions()
    db.exec('PRAGMA user_version=1')
  } catch (err) { db.close(); throw err }

  function addAccount(account, cost) { run('INSERT INTO accounts VALUES(?,?) ON CONFLICT(account) DO UPDATE SET cost=cost+excluded.cost', account, cost) }
  function addDay(day, account, currency, b) {
    run(`INSERT INTO days VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(day,account,currency) DO UPDATE SET
      input=input+excluded.input,cacheRead=cacheRead+excluded.cacheRead,cacheWrite=cacheWrite+excluded.cacheWrite,output=output+excluded.output,
      cost=cost+excluded.cost,costOffpeak=costOffpeak+excluded.costOffpeak,records=records+excluded.records,unpriced=unpriced+excluded.unpriced`,
    day, account, currency, b.input || 0, b.cacheRead || 0, b.cacheWrite || 0, b.output || 0, b.cost || 0, b.costOffpeak || 0, b.records || 0, b.unpriced || 0)
  }
  function addSession(key, entry) {
    const old = get('SELECT * FROM sessions WHERE key=?', key)
    const costs = old ? JSON.parse(old.costs) : Object.create(null)
    for (const [cur, amount] of Object.entries(entry.costs || {})) costs[cur] = (costs[cur] || 0) + amount
    run(`INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET
      input=input+excluded.input,cacheRead=cacheRead+excluded.cacheRead,cacheWrite=cacheWrite+excluded.cacheWrite,output=output+excluded.output,
      costs=excluded.costs,minTs=MIN(minTs,excluded.minTs),maxTs=MAX(maxTs,excluded.maxTs),unpricedRecords=unpricedRecords+excluded.unpricedRecords,unpricedTokens=unpricedTokens+excluded.unpricedTokens`,
    key, entry.account == null ? '' : entry.account, normalizeSession(entry.sessionId), entry.sessionId || '', entry.input || 0, entry.cacheRead || 0, entry.cacheWrite || 0, entry.output || 0,
    JSON.stringify(costs), entry.minTs, entry.maxTs, entry.unpricedRecords || 0, entry.unpricedTokens || 0)
  }
  function insertRecord(raw, index, source, boundary, archiveOnly = false) {
    if (!validRecord(raw)) return false
    const r = normalized(raw, index, source), payload = JSON.stringify(r)
    if (Buffer.byteLength(payload) > MAX_VALUE_BYTES) throw problem('Ledger entry exceeds the safe size limit; original files have been preserved.')
    const account = hooks.account(r) || '', currency = hooks.currency(r) || ''
    const cost = r.cost == null ? null : r.cost
    const offpeak = hooks.cost(r, true)
    const folded = archiveOnly || (boundary != null && r.ts < boundary && r.cost != null)
    const result = run('INSERT OR IGNORE INTO records(id,ts,account,currency,cost,offpeak,folded,payload) VALUES(?,?,?,?,?,?,?,?)', r.id, r.ts, account, currency, cost, offpeak, folded ? 1 : 0, payload)
    if (!result.changes || folded) return !!result.changes
    if (boundary == null || r.ts >= boundary) addDay(dayKey(r.ts), account, currency, { ...r, cost: cost || 0, costOffpeak: offpeak || 0, records: cost == null ? 0 : 1, unpriced: cost == null ? 1 : 0 })
    const rawKey = r.sessionId || (r.provider + '/' + r.model + '#' + r.ts)
    const key = account + '\0' + hooks.safeKey(rawKey)
    addSession(key, { ...r, account, costs: cost == null ? {} : { [currency]: cost }, minTs: r.ts, maxTs: r.ts, unpricedRecords: cost == null ? 1 : 0, unpricedTokens: cost == null ? r.input + r.cacheRead + r.cacheWrite + r.output : 0 })
    addAccount(account, cost || 0)
    return true
  }

  let warning = null
  function importLegacy() {
    const archive = join(dir, 'usage-archive')
    const summaryFiles = ['usage-summaries.json', 'usage-summaries.json.bak']
    let summary = null, boundary = null
    for (const name of summaryFiles) {
      const path = join(dir, name)
      if (!existsSync(path)) continue
      const info = Object.create(null)
      try {
        walkJsonFile(path, p => p.length === 1 && ['version', 'foldedUpTo'].includes(p[0]), (p, v) => { info[p[0]] = v }, '{', (p, c) => { if (p.length === 1 && ['foldedDayBuckets', 'foldedSessions', 'foldedAccountTotals'].includes(p[0])) info[p[0]] = c === '{' })
        if (info.version === 1 && info.foldedDayBuckets && info.foldedSessions && info.foldedAccountTotals && (info.foldedUpTo == null || (Number.isFinite(info.foldedUpTo) && info.foldedUpTo >= 0 && info.foldedUpTo <= Date.now() + DAY))) { summary = path; boundary = info.foldedUpTo; break }
      } catch (err) { if (!(err instanceof SyntaxError) && err.code !== 'BIB_LEDGER_INVALID_JSON') throw err }
    }
    if (summary) {
      walkJsonFile(summary, p => p.length === 2 && ['foldedDayBuckets', 'foldedSessions', 'foldedAccountTotals'].includes(p[0]), (p, v) => {
        if (p[0] === 'foldedDayBuckets') for (const [account, currencies] of Object.entries(v || {})) for (const [currency, b] of Object.entries(currencies || {})) addDay(p[1], hooks.safeKey(account), hooks.safeKey(currency), b)
        else if (p[0] === 'foldedSessions' && v && typeof v === 'object') addSession(hooks.safeKey(p[1]), { ...v, account: v.account == null ? '' : v.account })
        else if (p[0] === 'foldedAccountTotals') addAccount(hooks.safeKey(p[1]), Number(v) || 0)
      })
    } else if (existsSync(archive) && readdirSync(archive).some(name => name.endsWith('.jsonl'))) {
      warning = 'Archived records exist but the legacy spend summary is unavailable. Original files in usage-archive have been preserved.'
    }
    const temps = readdirSync(dir).filter(n => n.startsWith('usage-records.json.tmp.')).sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs)
    const candidates = ['usage-records.json', 'usage-records.json.bak', 'usage-records.json.tmp', ...temps]
    let found = false, hadSnapshot = false
    for (const name of candidates) {
      const path = join(dir, name)
      if (!existsSync(path)) continue
      hadSnapshot = true
      db.exec('SAVEPOINT snapshot')
      try {
        walkJsonFile(path, p => p.length === 1, (p, v) => insertRecord(v, p[0], 'snapshot', boundary), '[')
        db.exec('RELEASE snapshot'); found = true; break
      } catch (err) {
        db.exec('ROLLBACK TO snapshot; RELEASE snapshot')
        if (!(err instanceof SyntaxError) && err.code !== 'BIB_LEDGER_INVALID_JSON') throw err
      }
    }
    if (hadSnapshot && !found) warning = 'No valid legacy snapshot could be read. Original ledger files have been preserved; only recoverable journal entries are shown.'
    function lines(file, source, archiveOnly) {
      forEachLedgerLine(file, (line, index) => {
        if (!line.trim()) return
        let record
        try { record = JSON.parse(line) } catch { return }
        insertRecord(record, index, source, boundary, archiveOnly)
      })
    }
    const journal = join(dir, 'usage-records.journal.jsonl')
    if (existsSync(journal)) lines(journal, 'journal', false)
    if (existsSync(archive)) for (const name of readdirSync(archive).filter(n => n.endsWith('.jsonl')).sort()) lines(join(archive, name), 'archive:' + name, true)
    run('INSERT OR REPLACE INTO meta VALUES(?,?)', 'migrated', '1')
    if (warning) run('INSERT OR REPLACE INTO meta VALUES(?,?)', 'warning', warning)
  }
  try {
    transaction(() => {
      if (existsSync(join(dir, 'usage-records.clear-marker'))) {
        db.exec('DELETE FROM records; DELETE FROM days; DELETE FROM sessions; DELETE FROM accounts; DELETE FROM meta');
        run('INSERT INTO meta VALUES(?,?)', 'migrated', '1');
      } else if (!get('SELECT value FROM meta WHERE key=?', 'migrated')) importLegacy();
    })
    warning = get('SELECT value FROM meta WHERE key=?', 'warning')?.value || null
    permissions()
  } catch (err) { db.close(); throw err }

  function sessionRow(row) { return row ? { ...row, account: row.account || null, costs: JSON.parse(row.costs) } : null }
  return {
    file, get warning() { return warning },
    append(r) { return transaction(() => insertRecord(r, 0, 'live', null)) },
    count() { return get('SELECT COUNT(*) n FROM records').n },
    lastTs() { return get('SELECT MAX(ts) ts FROM records').ts },
    providerSpend(account) { return get('SELECT cost FROM accounts WHERE account=?', account || '')?.cost || 0 },
    sessionsCount(account) { return account == null ? get('SELECT COUNT(*) n FROM sessions').n : get('SELECT COUNT(*) n FROM sessions WHERE account=?', account).n },
    recentSessions(account, count) {
      const rows = account == null ? sql('SELECT * FROM sessions ORDER BY maxTs DESC LIMIT ?').all(count) : sql('SELECT * FROM sessions WHERE account=? ORDER BY maxTs DESC LIMIT ?').all(account, count)
      return rows.map(sessionRow).reverse()
    },
    forOwnedSessions(account, owned, visit) {
      for (const id of owned) for (const row of sql('SELECT * FROM sessions WHERE account=? AND norm=?').iterate(account || '', id)) visit(sessionRow(row))
    },
    daySum(account, currency, from = '', to = '9999-99-99') {
      return get('SELECT COALESCE(SUM(cost),0) cost,COALESCE(SUM(costOffpeak),0) offpeak,COUNT(CASE WHEN records>0 THEN 1 END) active FROM days WHERE account=? AND currency=? AND day>=? AND day<?', hooks.safeKey(account || ''), hooks.safeKey(currency), from, to)
    },
    scan(from, to, visit) { for (const row of sql('SELECT payload FROM records WHERE folded=0 AND ts>=? AND ts<? ORDER BY ts').iterate(from, to)) visit(JSON.parse(row.payload)) },
    exportPage(after, limit = EXPORT_PAGE_SIZE) {
      const records = [];
      let next = after, bytes = 0;
      const pageSize = Math.min(EXPORT_PAGE_SIZE, limit);
      for (const row of sql('SELECT seq,payload FROM records WHERE seq>? ORDER BY seq LIMIT ?').iterate(after, pageSize)) {
        bytes += Buffer.byteLength(row.payload);
        if (bytes > 256 * 1024) { const err = problem('This export needs the streaming download interface. Reload the plugin settings and download the ledger.'); err.status = 413; throw err; }
        records.push(JSON.parse(row.payload)); next = row.seq;
      }
      return { records, next, done: records.length < pageSize };
    },
    exportSnapshot() {
      const reader = new DatabaseSync(file, { readOnly: true })
      try {
        reader.exec('PRAGMA cache_size=-2048; PRAGMA temp_store=FILE; BEGIN')
        const recordCount = reader.prepare('SELECT COUNT(*) n FROM records').get().n
        const rows = reader.prepare('SELECT payload FROM records ORDER BY ts,seq').iterate()
        let closed = false
        return { recordCount, rows, close() { if (!closed) { closed = true; reader.close() } } }
      } catch (err) { reader.close(); throw err }
    },
    backfill(price, currency, version) {
      let cursor = 0, changed = 0
      for (;;) {
        let more = true
        transaction(() => {
          const batch = sql('SELECT seq FROM records WHERE cost IS NULL AND seq>? ORDER BY seq LIMIT 256').all(cursor)
          if (!batch.length) { more = false; return }
          for (const item of batch) {
            const row = get('SELECT seq,payload,folded,account,currency FROM records WHERE seq=? AND cost IS NULL', item.seq)
            cursor = item.seq
            if (!row) continue
            const r = JSON.parse(row.payload), amount = price(r)
            if (amount == null || !Number.isFinite(amount) || amount < 0 || r.pricingStatus === 'priced' || row.folded) continue
            r.cost = amount; r.currency = currency(r); r.pricingStatus = 'priced'; r.pricingVersion = version
            // Update aggregates using a replacement record, with inverse old unpriced contribution.
            addDay(dayKey(r.ts), row.account, row.currency, { unpriced: -1 })
            const rawKey = r.sessionId || (r.provider + '/' + r.model + '#' + r.ts)
            const key = row.account + '\0' + hooks.safeKey(rawKey)
            run('UPDATE sessions SET unpricedRecords=MAX(0,unpricedRecords-1),unpricedTokens=MAX(0,unpricedTokens-?) WHERE key=?', r.input + r.cacheRead + r.cacheWrite + r.output, key)
            addDay(dayKey(r.ts), row.account, r.currency || '', { cost: amount, costOffpeak: hooks.cost(r, true) || 0, records: 1 })
            addSession(key, { account: row.account, sessionId: r.sessionId, costs: { [r.currency]: amount }, minTs: r.ts, maxTs: r.ts })
            addAccount(row.account, amount)
            run('UPDATE records SET cost=?,currency=?,offpeak=?,payload=? WHERE seq=?', amount, r.currency || '', hooks.cost(r, true), JSON.stringify(r), row.seq)
            changed++
          }
        })
        if (!more) break
      }
      return changed
    },
    clear() { return transaction(() => { const count = get('SELECT COUNT(*) n FROM records').n; db.exec("DELETE FROM records; DELETE FROM days; DELETE FROM sessions; DELETE FROM accounts; DELETE FROM meta WHERE key='warning'"); warning = null; return count }) },
    checkpoint() { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); permissions() },
    close() { db.close() },
  }
}
