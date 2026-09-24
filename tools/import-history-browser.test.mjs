// Local synthetic browser storage only; requests are restricted to this test server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const root=path.resolve('docs/portfolio-operations-dashboard');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://local').pathname;if(pathname==='/'){res.setHeader('content-type','text/html');return res.end('<!doctype html><title>Local history fixture</title>');}const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(file));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const boot=async()=>{await page.goto(origin);await page.evaluate(async()=>{window.historyApi=await import('/features/import-history.mjs');window.run=(operation,extra={})=>historyApi.historyOperation({dbName:'synthetic-history',storeName:'records',key:'imports',operation,...extra});});};
 await boot();
 const seeded=await page.evaluate(async()=>{
   const legacy={batches:Array.from({length:66},(_,i)=>({id:'b'+i,status:'Approved',beforeSnapshot:{capturedAt:'snapshot'+i,savedData:{A:{occupied:0}},canonicalRecords:[{key:'zero',values:{value:0}}],lineage:[{id:'old',importedValue:0}],reconciliationLog:[]}})),sourceArchive:Array.from({length:181},(_,i)=>({id:'s'+i,batchId:'b0',reportType:'box_score',communities:['A']})),canonicalRecords:[{key:'current',communityName:'A',periodKey:'2026-09',fileHash:'verified',dataAsOf:'2026-09-24',reportType:'box_score',values:{occupied_units:0,total_units:247}}],lineage:Array.from({length:12051},(_,i)=>({id:'l'+i,currentState:i===0,atlasField:'occupied_units',importedValue:i===0?0:i,communityName:'A',periodKey:'2026-09',fileHash:'verified',dataAsOf:'2026-09-24'})),reconciliationLog:[],unknown:{retained:null}};
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('synthetic-history',1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');for(const [key,value]of Object.entries({imports:legacy,community_data:{A:{occupied:91}},rise_ops_global_v1:{preserved:true},atlas_workspace_source_v2:{identity:{archive:'a'},dirty:false}}))store.put({key,value});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
   window.originalHash=await (await import('/features/import-history-store.mjs')).historyHash(legacy);
   const current=await run('current');return {counts:current.historyStorage.counts,lineage:current.lineage,records:current.canonicalRecords,batches:current.batches.length};
 });
 assert.equal(seeded.counts.batches,66);assert.equal(seeded.counts.sourceArchive,181);assert.equal(seeded.counts.lineage,12051);assert.equal(seeded.batches,25);assert.equal(seeded.lineage.length,1);assert.equal(seeded.records[0].values.occupied_units,0);
 const first=await page.evaluate(()=>run('page',{collection:'batches',offset:50,limit:10,expectedRevision:1}));assert.equal(first.rows[0].id,'b50');assert.equal(first.rows[0].beforeSnapshot,undefined);assert.equal(first.nextOffset,60);
 // Cancelling an obsolete view terminates only its read; the next view is usable.
 assert.equal(await page.evaluate(async()=>{const c=new AbortController(),pending=run('export',{signal:c.signal});c.abort();try{await pending;return false;}catch(e){return e.name==='AbortError';}}),true);
 assert.equal((await page.evaluate(()=>run('current'))).historyStorage.revision,1);
 const written=await page.evaluate(async()=>{const c=new AbortController(),pending=run('update',{expectedRevision:1,set:{newBusinessSetting:0},signal:c.signal});setTimeout(()=>c.abort(),1);return pending;});assert.equal(written.revision,2);
 await boot(); // A fresh page and fresh workers read the exact committed durable state.
 const reopened=await page.evaluate(()=>run('load'));assert.equal(reopened.newBusinessSetting,0);assert.equal(reopened.batches.length,66);assert.equal(reopened.lineage.length,12051);
 assert.equal((await page.evaluate(()=>run('records',{keys:['atlas_workspace_source_v2']}))).records[0].value.dirty,true);
 const rolled=await page.evaluate(async()=>{const loaded=await run('load'),captures=await run('records',{keys:['community_data','rise_ops_global_v1']});return run('rollback',{expectedRevision:2,batch:loaded.batches[50],reason:'Synthetic restore',actor:'Fixture',communityHash:captures.records[0].hash,globalHash:captures.records[1].hash});});assert.equal(rolled.revision,3);
 await boot();const result=await page.evaluate(async()=>({full:await run('export'),records:await run('records',{keys:['community_data','rise_ops_global_v1']})}));
 assert.equal(result.full.batches.length,66);assert.equal(result.full.sourceArchive.length,181);assert.equal(result.full.batches[50].beforeSnapshot.capturedAt,'snapshot50');assert.equal(result.full.batches[50].status,'Rolled Back');assert.equal(result.full.lineage[0].importedValue,0);assert.equal(result.records.records[0].value.A.occupied,0);assert.equal(result.records.records[1].value.preserved,true);
 // Exercise the actual occupancy adapter against a split store, including its
 // portable pre-change backup and revision-checked publication.
 await page.evaluate(async()=>{
   window.savedWorker=window.Worker;window.Worker=undefined;
   const bytes=new Uint8Array([1,2,3]),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
   const state=await run('load'),captured=await run('records',{keys:['community_data','file:approved'],raw:true});
   const community=await run('records',{keys:['community_data']});
   state.sourceArchive.unshift({id:'approved',importStatus:'Approved',reportType:'box_score',fileHash:digest,fileName:'box.xlsx',metadata:{generatedAt:'2026-09-24'}});
   await run('publish',{value:state,expectedRevision:state.historyStorage.revision,records:[{key:'community_data',value:{A:{communityId:'a',occupied:0,unrelated:{retained:true}}},expectedHash:community.records[0].hash},{key:'file:approved',record:{key:'file:approved',value:{blob:new Blob([bytes]),fileName:'box.xlsx'}},expectedHash:captured.records[1].hash}]});
   window.ATLAS_STATE_DB_NAME='synthetic-history';window.ATLAS_STATE_STORE_NAME='records';window.DATA_IMPORT_2_STATE_KEY='imports';window.ATLAS_STATE_COMMUNITY_KEY='community_data';window.DATA_IMPORT_FILE_ARCHIVE_PREFIX='file:';
   window.atlasStateWritePromise=Promise.resolve();window.dataImportApprovalInProgress=false;window.actorScope='actor-A';window.getAtlasRenderContextKey=()=>actorScope;window.dataImportCanManageArchitecture=()=>true;
   window.openAtlasStateDb=()=>new Promise((resolve,reject)=>{const r=indexedDB.open(ATLAS_STATE_DB_NAME,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   window.withAtlasStateStore=async(mode,fn)=>{const db=await openAtlasStateDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('records',mode),r=fn(tx.objectStore('records'));tx.oncomplete=()=>resolve(r.result);tx.onerror=tx.onabort=()=>reject(tx.error);});}finally{db.close();}};
   window.AtlasApplicationSources={boxScore:()=>[{section:'Availability',period:{asOf:'2026-09-24'},values:{},locators:{},sourceRow:1}]};
   window.AtlasOccupancyReplay={fields:[],prepare:({communityData,importState})=>({communityData:{...communityData,A:{...communityData.A,repaired:true}},importState:{...importState,repaired:true},changes:['A'],changed:true})};
   window.dataImportBuildAliasLookup=window.dataImportBuildInternalCommunityLookup=()=>({});window.dataImportBuildFilePlan=async()=>({fileHash:digest,metadata:{generatedAt:'2026-09-24'}});
   window.XLSX={read:()=>({SheetNames:['A'],Sheets:{A:{'!ref':'A1:A2'}}}),utils:{sheet_to_json:()=>[],decode_range:()=>({s:{r:0}})}};
   window.dataImportResolveRowCommunity=()=> 'A';window.dataImportIsActiveReportingCommunity=window.dataImportCommunitySupportsReport=()=>true;window.getProp=()=>({name:'A'});window.loadPropertyData=window.renderPropGrid=window.renderTab=()=>{};
   window.downloads=[];URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:fixture';};URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=function(){};
 });
 await page.addScriptTag({path:path.join(root,'occupancy-replay-browser.js')});
 const repaired=await page.evaluate(async()=>{
   await AtlasOccupancyReplayBrowser.preview('approved');
   const backup=JSON.parse(await downloads[0].text());
   const result=await AtlasOccupancyReplayBrowser.apply();
   return {backup,result,stored:await run('export')};
 });
 assert.equal(repaired.backup.records[0].value.batches[50].beforeSnapshot.capturedAt,'snapshot50');assert.equal(repaired.backup.records[0].value.batches.length,66);assert.equal(repaired.result.importReadbackMatches,true);assert.equal(repaired.result.communityReadbackMatches,true);assert.equal(repaired.stored.sourceArchive.length,182);
 await page.evaluate(()=>AtlasOccupancyReplayBrowser.preview('approved'));
 await page.evaluate(()=>{window.actorScope='actor-B';});
 await assert.rejects(page.evaluate(()=>AtlasOccupancyReplayBrowser.apply()),/Workspace changed/);
 assert.deepEqual(errors,[]);
 console.log('PASS actual browser workers: durable split migration, >60/180/12000 preservation, scoped zero provenance, lazy pages, cancelled read, accepted write despite cancellation, reload readback, dirty-source protection and atomic rollback.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
