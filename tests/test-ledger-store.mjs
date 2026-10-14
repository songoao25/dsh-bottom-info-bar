import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, openSync, writeSync, closeSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { openLedgerStore } from '../src/ledger-store.js';
const worker = fileURLToPath(new URL('./ledger-store-worker.mjs', import.meta.url));
const hooks = { account:r=>r.provider, currency:r=>r.currency||'CNY', cost:r=>r.cost??null, safeKey:x=>String(x) };
const rec={id:'a',ts:Date.parse('2026-01-01T00:00:00Z'),provider:'test',model:'test',input:10,cacheRead:0,cacheWrite:0,output:1,cost:2,currency:'CNY',sessionId:'s'};
const directories=[];
const temp=name=>{const dir=mkdtempSync(join(tmpdir(),'bib-store-'+name+'-'));directories.push(dir);return dir};
try {
const legacy=(dir,name,value)=>writeFileSync(join(dir,name),JSON.stringify(value));
const summary={version:1,foldedUpTo:rec.ts+86400000,foldedDayBuckets:{'2026-01-01':{test:{CNY:{cost:2,records:1,input:10}}}},foldedSessions:{'test\0s':{account:'test',sessionId:'s',costs:{CNY:2},minTs:rec.ts,maxTs:rec.ts}},foldedAccountTotals:{test:2}};
{
 const dir=temp('summary');legacy(dir,'usage-records.json',[rec]);legacy(dir,'usage-summaries.json',{version:1,foldedUpTo:rec.ts+86400000});legacy(dir,'usage-summaries.json.bak',summary);
 const s=openLedgerStore(dir,hooks);assert.equal(s.count(),1);assert.equal(s.providerSpend('test'),2);assert.equal(s.warning,null);s.close();console.log('PASS missing summary maps uses valid backup');
}
{
 const dir=temp('unpriced'), r={...rec,id:'b'};delete r.cost;legacy(dir,'usage-records.json',[r]);legacy(dir,'usage-summaries.json',{...summary,foldedDayBuckets:{'2026-01-01':{test:{CNY:{input:10,output:1,unpriced:1}}}},foldedSessions:{},foldedAccountTotals:{}});
 const s=openLedgerStore(dir,hooks), db=new DatabaseSync(s.file);assert.equal(db.prepare('SELECT input FROM days').get().input,10);assert.equal(s.backfill(()=>2,()=> 'CNY','test'),1);const b=db.prepare('SELECT input,output,unpriced,cost FROM days').get();assert.equal(b.input,10);assert.equal(b.output,1);assert.equal(b.unpriced,0);assert.equal(b.cost,2);db.close();s.close();console.log('PASS frozen unpriced day does not double count');
}
{
 const dir=temp('race'), marker=join(dir,'locked');const s=openLedgerStore(dir,hooks);const r={...rec};delete r.cost;s.append(r);s.close();
 const a=spawn(process.execPath,[worker,'race',dir,'A',marker]),b=spawn(process.execPath,[worker,'race',dir,'B',marker]);let ready=0;let output='';
 const done=[a,b].map(c=>new Promise((resolve,reject)=>{c.stderr.on('data',buf=>process.stderr.write(buf));c.on('error',reject);c.on('exit',code=>code===0?resolve():reject(new Error('child failed '+code)));c.stdout.on('data',buf=>{const text=buf.toString();output+=text;if(text.includes('ready')&&++ready===2){a.stdin.end('go');const timer=setInterval(()=>{if(existsSync(marker)){clearInterval(timer);b.stdin.end('go')}},5)}})}));
 await Promise.all(done);const check=openLedgerStore(dir,hooks);assert.equal(check.providerSpend('test'),2);check.close();assert.match(output,/changed 0/);console.log('PASS two processes backfill one charge once');
}
{
 const dir=temp('complexity'), file=join(dir,'usage-records.json'),fd=openSync(file,'w');writeSync(fd,'[{"id":"a","ts":1,"model":"x","provider":"p","input":1,"cacheRead":0,"cacheWrite":0,"output":1,"extra":[');for(let i=0;i<70;i++)writeSync(fd,'{},'.repeat(10000));writeSync(fd,'{}]}]');closeSync(fd);
 const result=spawnSync(process.execPath,['--max-old-space-size=32',worker,'complexity',dir],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/complexity limit/);assert.ok(existsSync(file));const db=new DatabaseSync(join(dir,'usage-ledger.sqlite'));assert.equal(db.prepare("SELECT COUNT(*) n FROM meta WHERE key='migrated'").get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM records').get().n,0);db.close();console.log('PASS complex record fails controllably at 32 MB with original intact and no migration marker');
}
{
 const dir=temp('version'), file=join(dir,'usage-ledger.sqlite'),db=new DatabaseSync(file);db.exec('PRAGMA user_version=2; CREATE TABLE future_private(value TEXT)');db.close();const before=readFileSync(file);assert.throws(()=>openLedgerStore(dir,hooks),/newer plugin/);assert.deepEqual(readFileSync(file),before);const check=new DatabaseSync(file);assert.deepEqual(check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name),['future_private']);check.close();console.log('PASS newer schema database byte-for-byte unchanged');
}
{
 const host=readFileSync(new URL('../src/host.js',import.meta.url),'utf8');const start=host.indexOf('    let activeExports = 0;'),end=host.indexOf('    // ---------- RPC 路由',start);const block=host.slice(start,end);let opened=0,closed=0;
 const store={warning:null,exportSnapshot(){opened++;return {recordCount:1,rows:(function*(){yield {payload:JSON.stringify(rec)}})(),close(){closed++}}}};
 const stream=new Function('requireLedger',block+'\nreturn streamUsageExport;')(()=>store);
 class Res extends EventEmitter{writeHead(){this.headersSent=true}write(){return false}end(){this.ended=true}}
 const a=new Res(),b=new Res(),c=new Res();const one=stream({},a,'json').catch(e=>e),two=stream({},b,'csv').catch(e=>e);await assert.rejects(stream({},c,'json'),e=>e.status===409);assert.equal(opened,2);a.destroyed=true;a.emit('close');await one;assert.equal(closed,1);const next=new Res(),three=stream({},next,'json').catch(e=>e);assert.equal(opened,3);b.destroyed=true;b.emit('close');next.destroyed=true;next.emit('close');await Promise.all([two,three]);assert.equal(closed,3);
 class FastRes extends Res {constructor(){super();this.text=''}write(t){this.text+=t;return true}end(t){this.text+=t;this.ended=true}}
 const good=new FastRes();await stream({},good,'json');assert.equal(JSON.parse(good.text).recordCount,1);assert.equal(closed,4);console.log('PASS export limit, backpressure cancellation, slot release and JSON download');
}
{
 const dir=temp('export-snapshot');const a=openLedgerStore(dir,hooks),b=openLedgerStore(dir,hooks);
 a.append(rec);const snapshot=a.exportSnapshot();b.append({...rec,id:'new',ts:rec.ts+1});
 assert.equal(snapshot.recordCount,1);assert.deepEqual(Array.from(snapshot.rows,row=>JSON.parse(row.payload).id),['a']);snapshot.rows.return();snapshot.close();assert.equal(a.count(),2);a.close();b.close();console.log('PASS export snapshot remains consistent while another writer appends');
}
{
 const dir=temp('crash');const store=openLedgerStore(dir,hooks);store.append(rec);store.close();
 const crashed=spawnSync(process.execPath,[worker,'crash',dir],{encoding:'utf8'});
 assert.ok(crashed.signal==='SIGKILL'||crashed.status===23,crashed.stderr);
 const recovered=openLedgerStore(dir,hooks);assert.equal(recovered.count(),1);assert.equal(recovered.providerSpend('test'),2);recovered.close();console.log('PASS interrupted transaction restores both record and aggregate without partial charges');
}
console.log('ALL independent counterexample retests passed on '+process.platform+' '+process.version);

} finally { for (const dir of directories) rmSync(dir,{recursive:true,force:true}) }
