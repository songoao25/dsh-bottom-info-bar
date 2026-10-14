// Static child-process entry point; inputs are data, never executable source.
import {openLedgerStore} from '../src/ledger-store.js';
import {DatabaseSync} from 'node:sqlite';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [mode, dir, role, marker] = process.argv.slice(2);
const hooks={account:r=>r.provider,currency:r=>'CNY',cost:r=>r.cost??null,safeKey:x=>String(x)};
if (mode==='race') {
  const store=openLedgerStore(dir,hooks);
  console.log('ready');
  process.stdin.once('data',()=>{
    const count=store.backfill(()=>{
      if(role==='A') {writeFileSync(marker,'locked');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,750)}
      return 2;
    },()=> 'CNY','t');
    console.log('changed',count);store.close();
  });
} else if (mode==='complexity') {
  try {openLedgerStore(dir,hooks);process.exitCode=2;}
  catch(error) {if(error.code!=='BIB_LEDGER_UNAVAILABLE')throw error;console.log(error.message);}
} else if (mode==='crash') {
  const db=new DatabaseSync(join(dir,'usage-ledger.sqlite'));
  db.exec('BEGIN IMMEDIATE; UPDATE accounts SET cost=999; DELETE FROM records');
  if(process.platform==='win32')process.exit(23);else process.kill(process.pid,'SIGKILL');
} else {throw new Error('Unknown ledger worker mode');}
