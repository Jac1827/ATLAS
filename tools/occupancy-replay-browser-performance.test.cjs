const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/occupancy-replay-browser.js','utf8');
async function boot(){
 const bytes=new Uint8Array([1,2,3]);
 const digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const imported={key:'imports',value:{sourceArchive:[{id:'one',importStatus:'Approved',reportType:'box_score',fileHash:digest,fileName:'box.xlsx',metadata:{generatedAt:'2026-09-01'}}]}};
 const communities={key:'communities',value:{A:{communityId:'a',unrelatedHistory:{preserved:true}}}};
 const records=new Map([['imports',imported],['communities',communities],['file:one',{key:'file:one',value:{blob:new Blob([bytes]),fileName:'box.xlsx'}}]]);
 const reads=[],writes=[],downloads=[];let authorized=true,delayRead=null;
 const store={get(key){reads.push(key);return structuredClone(records.get(key));},getAll(){throw Error('Unbounded store read forbidden');}};
 const window={addEventListener(){},AtlasApplicationSources:{boxScore:()=>[{section:'Availability',period:{asOf:'2026-09-01'},values:{},locators:{},sourceRow:1}]},AtlasOccupancyReplay:{fields:[],prepare:({communityData,importState})=>({communityData:{...communityData,A:{...communityData.A,repaired:true}},importState:{...importState,repaired:true},changes:['A'],changed:true})}};
 const ctx={window,crypto:webcrypto,Blob,File,TextEncoder,Uint8Array,AbortController,DOMException,structuredClone,console,JSON,Date,Map,Promise,btoa,atob,setTimeout:fn=>setTimeout(fn,0),URL:{createObjectURL(blob){downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},document:{createElement:()=>({click(){}})},dataImportCanManageArchitecture:()=>authorized,dataImportApprovalInProgress:false,atlasStateWritePromise:Promise.resolve(),DATA_IMPORT_2_STATE_KEY:'imports',ATLAS_STATE_COMMUNITY_KEY:'communities',DATA_IMPORT_FILE_ARCHIVE_PREFIX:'file:',ATLAS_STATE_STORE_NAME:'records',withAtlasStateStore:async(_,fn)=>{if(delayRead)await delayRead;return fn(store);},dataImportBuildAliasLookup:()=>({}),dataImportBuildInternalCommunityLookup:()=>({}),dataImportBuildFilePlan:async()=>({fileHash:digest,metadata:{generatedAt:'2026-09-01'}}),XLSX:{read:()=>({SheetNames:['A'],Sheets:{A:{'!ref':'A1:A2'}}}),utils:{sheet_to_json:()=>[],decode_range:()=>({s:{r:0}})}},dataImportResolveRowCommunity:()=> 'A',dataImportIsActiveReportingCommunity:()=>true,dataImportCommunitySupportsReport:()=>true,getProp:()=>({name:'A'}),loadPropertyData(){},renderPropGrid(){},renderTab(){},alert(){},confirm:()=>true};
 ctx.openAtlasStateDb=async()=>({transaction(){
  const tx={objectStore:()=>({get(key){const req={};queueMicrotask(()=>{req.result=structuredClone(records.get(key));req.onsuccess();});return req;},put(row){writes.push(row.key);records.set(row.key,structuredClone(row));}}),abort(){this.onabort();}};
  setTimeout(()=>tx.oncomplete(),0);return tx;
 }});
 vm.runInNewContext(source,ctx);
 return {api:window.AtlasOccupancyReplayBrowser,records,reads,writes,downloads,deny:()=>{authorized=false;},delay:promise=>{delayRead=promise;}};
}
(async()=>{
 const c=await boot();await c.api.preview('one');
 assert.deepEqual(c.reads,['imports','communities','file:one']);
 const backup=JSON.parse(await c.downloads[0].text());
 assert.equal(backup.schema,'atlas_scoped_occupancy_repair_backup_v1');
 assert.deepEqual(backup.records.map(r=>r.key),['imports','communities']);
 assert.equal(backup.records[1].value.A.unrelatedHistory.preserved,true);
 const result=await c.api.apply();assert.equal(result.communityReadbackMatches,true);assert.equal(result.importReadbackMatches,true);
 assert.deepEqual(c.reads.slice(-2),['communities','imports']);assert.equal(c.records.get('file:one').value.blob.size,3);
 const cancel=await boot();await cancel.api.preview('one');cancel.api.cancel();await assert.rejects(cancel.api.apply(),/preview first/);assert.equal(cancel.writes.length,0);
 const stale=await boot();await stale.api.preview('one');stale.records.get('communities').value.A.concurrent=true;await assert.rejects(stale.api.apply(),/changed after preview/);assert.equal(stale.writes.length,0);
 const denied=await boot();await denied.api.preview('one');denied.deny();await assert.rejects(denied.api.apply(),/authorized/);assert.equal(denied.writes.length,0);
 const mid=await boot();let release;mid.delay(new Promise(r=>{release=r;}));const running=mid.api.preview('one');await Promise.resolve();mid.api.cancel();release();await assert.rejects(running,{name:'AbortError'});assert.equal(mid.downloads.length,0);
 console.log('PASS replay exact-key reads, complete affected-record backup, atomic guard, readback, cancellation and authorization');
})().catch(e=>{console.error(e);process.exitCode=1;});
