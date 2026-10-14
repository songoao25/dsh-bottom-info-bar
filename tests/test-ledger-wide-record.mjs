import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openLedgerStore} from '../src/ledger-store.js';
const dir=mkdtempSync(join(tmpdir(),'bib-review-wide-batch-'));
const hooks={account:r=>r.provider,currency:r=>'CNY',cost:r=>r.cost??null,safeKey:x=>String(x)};
try {
const s=openLedgerStore(dir,hooks);
const record={ts:Date.now(),provider:'test',model:'x',input:1,cacheRead:0,cacheWrite:0,output:1,purpose:'x'.repeat(400000)};
for(let i=0;i<100;i++)s.append({...record,id:String(i)});
s.close();
const moduleUrl=new URL('../src/ledger-store.js',import.meta.url).href;
const code=`import {openLedgerStore} from ${JSON.stringify(moduleUrl)};const s=openLedgerStore(${JSON.stringify(dir)},{account:r=>r.provider,currency:r=>'CNY',cost:r=>r.cost??null,safeKey:x=>String(x)});s.backfill(()=>2,()=> 'CNY','test');console.log('cost',s.providerSpend('test'));try{const page=s.exportPage(0);console.log('export',page.records.length)}catch(e){if(e.status!==413)throw e;console.log('controlled oversized legacy export rejection')}s.close();`;
const result=spawnSync(process.execPath,['--max-old-space-size=32','--input-type=module','-e',code],{encoding:'utf8',maxBuffer:5000});
assert.equal(result.status,0,result.stderr);
assert.match(result.stdout,/cost 200/);
console.log(result.stdout.trim());
console.log('PASS 100 permitted 400 KB records backfill and legacy export remain safe at 32 MB');

} finally { rmSync(dir,{recursive:true,force:true}) }
