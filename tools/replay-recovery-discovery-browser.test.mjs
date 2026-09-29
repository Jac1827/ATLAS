import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {patchOccupancyImportBoundary} from './occupancy-compat-boundary.mjs';
import {patchReplayCheckpointBoundary} from './replay-checkpoint-compat.mjs';
import {patchArchiveBuilderBoundary} from './archive-builder-compat.mjs';
import {patchReplayRefreshBoundary,REPLAY_REFRESH_BOUNDARY_COUNT} from './replay-refresh-compat.mjs';
import {patchReplayRecoveryDiscoveryBoundary,REPLAY_RECOVERY_DISCOVERY_BOUNDARY_COUNT} from './replay-recovery-discovery-compat.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const root=path.resolve(import.meta.dirname,'..'),core=await fs.readFile(path.join(root,'docs/portfolio-operations-dashboard/workspace-core.js'),'utf8');
const fn=(name,body=core)=>{const match=body.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'));assert(match,name);return match[0];};
const ui=await fs.readFile(path.join(root,'docs/portfolio-operations-dashboard/features/import-workspace.js'),'utf8');
const old=execFileSync('git',['show','origin/atlas-asset-releases:_atlas-assets/774663d5c700ea5d00a0b13a627f965f78173d7a4700f6728ed6a6620adbf8df/portfolio-operations-dashboard/index.html'],{encoding:'utf8',maxBuffer:10*1024*1024});
const before=patchReplayRefreshBoundary(patchArchiveBuilderBoundary(patchReplayCheckpointBoundary(patchOccupancyImportBoundary(old,core,ui),core),core),core,ui);
const retained=patchReplayRecoveryDiscoveryBoundary(before,core),helpers=['dataImportReplayRecoveryReader','showDataImportReplayCheckpoint','selectDataImportReplayCheckpoint'];
assert.equal(REPLAY_REFRESH_BOUNDARY_COUNT,17);assert.equal(REPLAY_RECOVERY_DISCOVERY_BOUNDARY_COUNT,2);
const inserted=helpers.map(name=>fn(name)).join('\n\n')+'\n\n';
assert.equal(retained.replace(inserted,'').replace('\n    if(checkpoint)window.showDataImportReplayCheckpoint?.(checkpoint);',''),before,'Only helpers and checkpoint progress call alter retained startup');
assert.throws(()=>patchReplayRecoveryDiscoveryBoundary(retained,core),/boundary changed/);
assert.throws(()=>patchReplayRecoveryDiscoveryBoundary(before.replace('async function inspectDataImportReplayReceipt(archiveId) {','async function changedInspector(archiveId) {'),core),/boundary changed/);
const names=[...helpers,'inspectDataImportReplayReceipt'];
for(const name of names)assert.equal(fn(name,retained),fn(name),'Composed helper exact: '+name);
const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><body><script>'+names.map(name=>fn(name,req.url.includes('retained')?retained:core)).join('\n')+'</script>');});
let browser,passed=0;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});
 const modes=['empty','metadata','committed_cleaned','legacy','wrong_actor','wrong_access','wrong_database','wrong_source','wrong_hash','wrong_batch','wrong_report','malformed','malformed_date','missing_source_hash','conflicting_receipt','auth_after_read','profile_after_read','source_after_read','unauthorized','missing_primary','missing_store','missing_checkpoint','no_database_listing','deletion_race','pagination'];
 for(const surface of ['current','retained'])for(const mode of modes){
  const context=await browser.newContext(),page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/?'+surface);
  const result=await page.evaluate(async mode=>{
   const ok=(value,message)=>{if(!value)throw Error(message);},g=globalThis,prefix='atlas_replay_receipt_v1:',dbName='recovery-test-primary';
   const source={id:'source-a',fileHash:'exact-source-hash',batchId:'batch-a',reportType:'rent_roll',importStatus:'Approved',communities:['Example']};
   let actor='actor-a',access='access-a',profile={role:'admin',communities:['Example']},allowed=true;
   Object.assign(g,{ATLAS_STATE_DB_NAME:dbName,ATLAS_STATE_STORE_NAME:'records',dataImport2State:{sourceArchive:[source]},dataImportCanManageArchitecture:()=>true,atlasAccessDecision:()=>({ok:true}),atlasDashboardUserCanSeeCommunityName:()=>allowed});
   g.ATLAS_CENTRAL={getSession:()=>({user:{id:actor}}),getAccessContextKey:()=>access,getConfig:()=>({supabaseUrl:'https://synthetic.invalid'}),getStoredProfile:()=>profile};
   if(mode==='profile_after_read')delete g.ATLAS_CENTRAL.getAccessContextKey;
   const scope=()=>g.ATLAS_CENTRAL.getAccessContextKey?.()??JSON.stringify([g.ATLAS_CENTRAL.getConfig().supabaseUrl,profile]);
   const name=i=>'atlas_replay_checkpoint_00000000-0000-4000-8000-'+String(i).padStart(12,'0');
   const metadata=i=>({schemaVersion:1,checkpoint:name(i),receiptKey:prefix+name(i),actor,access:scope(),database:dbName,createdAt:'2026-09-29T12:00:00.000Z',source:{archiveId:source.id,fileHash:source.fileHash,batchId:source.batchId,reportType:source.reportType}});
   const open=(name,store,keyPath)=>new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore(store,keyPath?{keyPath}:undefined);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const io=(db,store,action)=>new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');action(tx.objectStore(store));tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});
   const seedCheckpoint=async(i,value)=>{const db=await open(name(i),'checkpoint');await io(db,'checkpoint',s=>{s.put({huge:new Blob([new Uint8Array(2*1024*1024)]),nullable:null,zero:0},'before');if(value!==null)s.put(value,'metadata');});db.close();};
   let primary=null;
   if(!['empty','missing_primary'].includes(mode)){primary=await open(dbName,mode==='missing_store'?'other':'records','key');if(mode!=='missing_store')await io(primary,'records',s=>{s.put({key:'imports',value:{huge:new Blob([new Uint8Array(2*1024*1024)])}});s.put({key:'community',value:'never read'});});}
   let value=metadata(1),receipt=null;
   const changes={wrong_actor:v=>v.actor='other',wrong_access:v=>v.access='other',wrong_database:v=>v.database='other',wrong_source:v=>v.source.archiveId='other',wrong_hash:v=>v.source.fileHash='other',wrong_batch:v=>v.source.batchId='other',wrong_report:v=>v.source.reportType='box_score',malformed:v=>v.schemaVersion='1',malformed_date:v=>v.createdAt='not-a-date'};
   changes[mode]?.(value);
   if(!['empty','committed_cleaned','missing_checkpoint','pagination','deletion_race'].includes(mode))await seedCheckpoint(1,mode==='legacy'?null:value);
   if(['committed_cleaned','conflicting_receipt'].includes(mode)){receipt={...metadata(1),status:'committed',publishedAt:'2026-09-29T12:01:00.000Z'};if(mode==='conflicting_receipt')receipt.actor='other';await io(primary,'records',s=>s.put({key:prefix+name(1),value:receipt}));}
   if(mode==='pagination')for(let i=1;i<=9;i++){
    const m=metadata(i);if(i%3===0)m.actor='other';
    if(i<=6)await seedCheckpoint(i,i===5?null:m);
    if(i>=4)await io(primary,'records',s=>s.put({key:prefix+name(i),value:{...m,status:'committed',publishedAt:'2026-09-29T12:01:00.000Z'}}));
   }
   primary?.close();
   const actualNames=indexedDB.databases.bind(indexedDB),actualOpen=indexedDB.open.bind(indexedDB),get=IDBObjectStore.prototype.get,tx=IDBDatabase.prototype.transaction,keyCursor=IDBObjectStore.prototype.openKeyCursor;
   const reads=[],transactions=[],opens=[],ranges=[];let upgrades=0,mutated=false;
   for(const method of ['put','add','delete','clear','getAll','getAllKeys','openCursor'])IDBObjectStore.prototype[method]=function(){throw Error('Forbidden discovery operation '+method);};
   IDBDatabase.prototype.transaction=function(store,mode='readonly',...rest){ok(mode==='readonly','Discovery must use readonly transactions');transactions.push([this.name,store,mode]);return tx.call(this,store,mode,...rest);};
   IDBObjectStore.prototype.get=function(key){const primary=this.transaction.db.name===dbName;ok(primary?String(key).startsWith(prefix):key==='metadata','Forbidden large or unrelated read '+key);reads.push([this.transaction.db.name,key]);const r=get.call(this,key);
    if(!mutated&&['auth_after_read','profile_after_read','source_after_read'].includes(mode)){mutated=true;r.addEventListener('success',()=>{if(mode==='auth_after_read')actor='other';if(mode==='profile_after_read')profile={role:'viewer',communities:[]};if(mode==='source_after_read')source.fileHash='changed';});}return r;};
   IDBObjectStore.prototype.openKeyCursor=function(range){ok(this.transaction.db.name===dbName&&range instanceof IDBKeyRange&&String(range.lower).startsWith(prefix)&&range.upper===prefix+'\uffff','Cursor must be bounded to receipt prefix');ranges.push({lower:range.lower,upper:range.upper});return keyCursor.call(this,range);};
   indexedDB.open=function(name,...args){ok(args.length===0,'No version/upgrade requested');opens.push(name);const r=actualOpen(name);r.addEventListener('upgradeneeded',()=>upgrades++);return r;};
   if(mode==='no_database_listing')indexedDB.databases=undefined;
   if(mode==='deletion_race')indexedDB.databases=async()=>[...await actualNames(),{name:name(1),version:1}];
   if(mode==='unauthorized')allowed=false;if(mode==='missing_source_hash')source.fileHash='';
   let error=null,reader,report,first,pages=0;
   try{
    reader=dataImportReplayRecoveryReader(source);
    if(mode==='deletion_race')await reader.inspect(name(1));
    else {
     first=await reader.page({limit:2});pages++;
     if(mode==='pagination'){
      const found=new Set(first.rows.map(x=>x.checkpoint));let cursor=first.cursor;let lastReads=reads.length;
      while(cursor){ok(pages<15,'Pagination terminates');const next=await reader.page({...cursor,limit:2});pages++;ok(reads.length-lastReads<=6,'Each page has at most two metadata, exact receipt and prefix reads');lastReads=reads.length;for(const r of next.rows)found.add(r.checkpoint);cursor=next.cursor;}
      ok([...found].sort().join()=== [1,2,4,5,7,8].map(name).sort().join(),'All matching records including cleaned checkpoint commits found without cross-actor disclosure');
     }else if(mode==='no_database_listing'){ok(first.discoveryAvailable===false&&opens.length===0,'Unavailable enumeration does not open/create anything');}
     else if(changes[mode]){ok(first.rows.length===0,'No foreign or malformed metadata disclosed');await reader.inspect(name(1));throw Error('Expected typed inspection rejection');}
     else if(!['empty'].includes(mode))report=await reader.inspect(name(1));
    }
   }catch(e){error=e.message;}
   if(changes[mode]||mode==='conflicting_receipt')ok(error?.includes('does not match')||error?.includes('does not match its'),'Invalid record rejected');
   else if(['auth_after_read','profile_after_read','source_after_read','unauthorized','missing_source_hash'].includes(mode))ok(error?.includes('authorized source or workspace changed'),'Authorization rechecked after async read');
   else if(mode==='missing_store')ok(error?.includes('unavailable'),'Missing layout fails closed');
   else if(mode==='deletion_race'){ok(error?.includes('no new database was created'),'Upgrade race aborts');await new Promise(r=>setTimeout(r,0));ok(!(await actualNames()).some(x=>x.name===name(1)),'Aborted open leaves no database');ok(upgrades===1,'No upgrade success');}
   else {ok(!error,error||'Unexpected error');ok(upgrades===0,'No upgrades');}
   if(mode==='empty')ok(first.rows.length===0&&first.cursor===null&&opens.length===0,'Empty discovery opens no database');
   if(mode==='metadata')ok(first.rows.length===1&&report.outcome==='no_atomic_commit_receipt_recorded'&&report.atomicCommitReceipt===false&&report.retainedCheckpoint===true,'Metadata alone never claims commit');
   if(mode==='legacy')ok(first.rows.length===0&&first.legacyMetadataUnavailable===1&&report.outcome==='legacy_or_unavailable_receipt_outcome_unknown'&&report.retainedCheckpoint,'Legacy unknown can be typed without reading before');
   if(mode==='committed_cleaned')ok(first.rows.length===1&&report.atomicCommitReceipt===true&&report.retainedCheckpoint===false&&report.outcome==='committed_in_this_local_workspace','Receipt survives temporary checkpoint cleanup');
   if(mode==='missing_primary')ok(report.atomicCommitReceipt===null&&report.outcome==='receipt_storage_unavailable'&&!opens.includes(dbName),'Missing primary is not created or treated as negative receipt');
   if(mode==='missing_checkpoint')ok(report.retainedCheckpoint===false&&!opens.includes(name(1)),'Typed missing checkpoint never created');
   return {mode,pages,reads:reads.length,transactions:transactions.length,upgrades};
  },mode);
  assert.equal(result.mode,mode);passed++;console.log('PASS',surface,mode);await context.close();
 }
 for(const surface of ['current','retained']){
  const context=await browser.newContext(),page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/?'+surface);
  await page.evaluate(()=>{globalThis.pickerResult='pending';globalThis.allowed=true;globalThis.check=()=>{if(!allowed)throw Error('changed')};globalThis.reader={check,page:async()=>({rows:[{checkpoint:'atlas_replay_checkpoint_00000000-0000-4000-8000-000000000001',atomicCommitReceipt:true,publishedAt:'2026-09-29T12:00:00Z'}],cursor:null,discoveryAvailable:true})};selectDataImportReplayCheckpoint({},reader).then(x=>pickerResult=x);});
  await page.getByRole('button',{name:'atlas_replay_checkpoint_00000000-0000-4000-8000-000000000001',exact:true}).click();assert.equal(await page.evaluate(()=>pickerResult),'atlas_replay_checkpoint_00000000-0000-4000-8000-000000000001');
  await page.evaluate(()=>{pickerResult='pending';selectDataImportReplayCheckpoint({},reader).then(x=>pickerResult=x);});await page.locator('[data-recovery-id]').fill('atlas_replay_checkpoint_00000000-0000-4000-8000-000000000002');await page.getByRole('button',{name:'Inspect entered identifier',exact:true}).click();assert.equal(await page.evaluate(()=>pickerResult),'atlas_replay_checkpoint_00000000-0000-4000-8000-000000000002');
  await page.evaluate(()=>{pickerResult='pending';reader.page=()=>new Promise(resolve=>globalThis.finishPage=resolve);selectDataImportReplayCheckpoint({},reader).then(x=>pickerResult=x);allowed=false;dispatchEvent(new Event('atlas-central-auth-change'));finishPage({rows:[],cursor:null});});assert.equal(await page.evaluate(()=>pickerResult),null);assert.equal(await page.locator('dialog').count(),0);
  await page.evaluate(()=>{allowed=true;showDataImportReplayCheckpoint({name:'exact-captured-id',mayRender:()=>allowed});});assert.match(await page.locator('#data-import-replay-checkpoint-status').textContent(),/exact-captured-id/);assert.match(await page.locator('#data-import-replay-checkpoint-status').textContent(),/does not confirm a commit/);await page.evaluate(()=>{allowed=false;dispatchEvent(new Event('atlas-central-auth-change'));});assert.equal(await page.locator('#data-import-replay-checkpoint-status').count(),0);
  passed+=4;console.log('PASS',surface,'picker selection, typed legacy ID, auth invalidation, start identifier');await context.close();
 }
 console.log(JSON.stringify({passed,failed:0,surfaces:['current','composed retained'],liveActions:0}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
