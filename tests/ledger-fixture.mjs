// Synthetic fixture inspection only. Production exports never materialize all rows.
import { DatabaseSync } from 'node:sqlite'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
export function readLedgerRecords(dir) {
  const db = new DatabaseSync(join(dir, 'usage-ledger.sqlite'), { readOnly: true })
  try { return db.prepare('SELECT payload FROM records ORDER BY ts,seq').all().map(r => JSON.parse(r.payload)) } finally { db.close() }
}
export function resetSyntheticDatabase(dir) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(join(dir, 'usage-ledger.sqlite' + suffix), { force: true })
}
