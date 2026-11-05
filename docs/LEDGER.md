# Ledger storage and recovery

The ledger stores usage metadata and frozen charges locally. It does not store
conversation content or upload billing records. The location remains the plugin's
existing data directory under `DSH_HOME`, or `DSH_BOTTOM_INFO_BAR_DATA_DIR` when set.

## Coverage

The ledger records calls the Host observes while the plugin is running. Usage that
happened before the plugin started, or before the ledger was cleared, is never
invented or estimated: the four spend tallies (this session, today, last 30 days,
all time) simply start at the first recorded call, and the spend tooltip states
that start time so a partial figure is not mistaken for a whole session. The
provider's own balance or bill remains the authoritative number for a full
session.

## Execution model: worker thread (issue #260)

The SQLite connection is owned by a dedicated worker thread (`src/ledger-worker.js`);
the host's main thread never opens or queries `node:sqlite` synchronously. The host
talks to the worker through an async client (`src/ledger-client.js`) and awaits it like
any other async dependency. Two consequences matter:

- The ledger opens lazily on the first operation that needs it (usage summary, a bill
  write, price backfill) instead of during plugin apply. A slow disk, a locked file or
  a wedged SQLite call therefore cannot block the host event loop, which keeps accepting
  connections and serving the rest of DSH. This is the mitigation for the desktop freeze
  reported in issue #260, where the host stopped accepting new TCP connections right
  after startup while only this plugin was enabled.
- If the worker fails to open or stops answering, spend reporting degrades with the
  existing visible persistence warning; balance, pricing and the rest of the info bar
  keep working. A failed bill write is reported as "spend record was not saved" instead
  of pretending the bill was persisted.

The worker also owns legacy migration and unpriced backfill (both are pure ledger work
that used to run synchronously on the host main thread). Pricing and account mapping
come from the shared `src/accounting.js` engine, so the worker and the main thread
compute identical amounts; remote price-catalog merges are forwarded to the worker
before it re-runs the backfill.

Opening is bounded: the client waits at most 20 seconds for the worker to answer, and a
worker that is known to be wedged marks the ledger unavailable for the rest of the
session instead of leaving requests hanging. `DSH_BOTTOM_INFO_BAR_LEDGER=off` disables
the ledger entirely as a diagnostic A/B switch; the rest of the info bar keeps working.

## Memory and durability

`usage-ledger.sqlite` holds records, daily totals, account totals and session
indexes. The host does not keep the full history or all historical sessions in
JavaScript arrays. Inserts and aggregate changes commit together using SQLite
transactions and full synchronous durability. Overlapping plugin instances use
the same database, with a bounded lock wait.

The SQLite page cache is limited to approximately 8 MiB per ledger connection;
temporary query results use disk. This is a cache budget, not a promise that the
whole DSH process uses only 8 MiB. JavaScript, SQLite and DSH have additional memory
costs. Queries and price backfill read bounded batches or single records. The last
ten sessions are sufficient for calibration; older sessions remain queryable on
disk. Unpriced records remain recoverable without staying resident in memory.

Legacy JSON entries have a 1 MiB size budget, an 8,192-node complexity budget and a
32-level nesting limit. Oversized or excessively complex input aborts migration
with a visible ledger error; the source files remain intact. The plugin does not
hide these errors by dropping the whole ledger or switching to a memory-intensive
fallback. Ordinary torn journal lines remain individually recoverable.

## Migration

On the first successful opening, the plugin:

1. Validates frozen legacy summaries, falling back to their backup when needed.
2. Reads a valid current snapshot, backup or interrupted temporary snapshot one
   record at a time. An incomplete snapshot rolls back before trying another.
3. Imports valid journal entries and archived records with stable-ID deduplication.
   Frozen summaries remain authoritative for their historical aggregates.
4. Commits the migration marker together with the imported data. If parsing,
   storage or permission checks fail, no partial migration is accepted.

The original JSON files and archives are retained. Once migration is complete,
the database is authoritative and those old files are recovery material, not
additional live writers. Missing historical summary data produces a visible
warning; exports are refused rather than claiming an incomplete bill is complete.

Large first migrations and price backfills still take time proportional to the
records examined and memory stays bounded, but they now run inside the ledger
worker, so the host main thread stays responsive while they finish. A synthetic
low-memory test is not acceptance of every DSH desktop startup time or Windows
crash report.

## Export and clear

Settings exports use an authenticated streaming download, with JSON or CSV
records sent incrementally. The host respects the response buffer and releases
the read snapshot on completion or interruption. At most two downloads can run
per plugin instance. CSV escapes quoted fields and spreadsheet formula prefixes.

The old RPC export response remains available only for small ledgers (at most 256
records and 256 KiB). Larger requests receive an explicit error instructing the
caller to reload settings and use the streaming download; they do not allocate a
history-sized response.

Clearing requires the existing explicit settings action. A durable clear marker
precedes a database transaction and removal of the legacy recovery files. If a
clear is interrupted, the marker prevents old records from being resurrected on
the next startup. Uninstalling or disabling the plugin does not delete records.

## Runtime and downgrade boundary

The ledger requires a DSH host with Node.js 22.13 or newer, its built-in
`node:sqlite` module and `worker_threads` (the database runs in a worker thread, see
[Execution model](#execution-model-worker-thread-issue-260)). No separately compiled
database driver is installed. If the runtime cannot provide these, balance and other
plugin features can load, but spend is marked unavailable instead of reporting a
fabricated zero.

The old plugin cannot read database writes made after migration. Export the
current ledger before manually reverting its data format; retained legacy files
alone are not an up-to-date backup. Do not run old and new ledger writers against
the same data directory. A database created by a newer schema version is rejected
before any schema changes. Copying an open database file alone can miss its WAL;
prefer a completed export for a portable billing backup.
