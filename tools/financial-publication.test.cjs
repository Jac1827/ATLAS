const {readDashboardSource}=require('./dashboard-source.cjs');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {indexedDB}=require('fake-indexeddb');
const dir=__dirname+'/../docs/portfolio-operations-dashboard/';
const F=require(dir+'financial-publication.js');
const packet=(amount=80,date='2026-09-16')=>({period:'2026-09',actuals:[{glCode:'4000',section:'Operating Income',actual:amount}],budgets:[{glCode:'4000',section:'Operating Income',budget:100}],source:{id:'hash-'+date,file:'fixture.xlsx',effectiveAt:date}});
(async()=>{
 const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('financial-test',1);q.onupgradeneeded=()=>q.result.createObjectStore('records',{keyPath:'key'});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 const seed={A:{communityId:'A-ID',nonfinancial:'preserve'},B:{communityId:'B-ID',nonfinancial:'preserve too'}};
 await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put({key:'community_data',value:seed});tx.oncomplete=resolve;tx.onerror=reject;});
 const read=()=>new Promise((resolve,reject)=>{const q=db.transaction('records').objectStore('records').get('community_data');q.onsuccess=()=>resolve(q.result.value);q.onerror=reject;});
 await Promise.all([F.transact(db,{communityId:'A-ID'},[packet()]),F.transact(db,{communityId:'B-ID'},[packet(0)])]);
 let store=await read();assert.equal(store.A.nonfinancial,'preserve');assert.equal(store.B.financialLedger['2026-09'][0].actual,0);
 await F.transact(db,{communityName:'A'},[packet()]);assert.equal((await read()).A.financialPublications['2026-09:actual'].history.length,0,'Duplicate replay adds no rows or history');
 await F.transact(db,{communityId:'A-ID'},[packet(90,'2026-09-17')]);store=await read();assert.equal(store.A.financialLedger['2026-09'].length,1);assert.equal(store.A.financialPublications['2026-09:actual'].history[0].rows[0].actual,80);
 await assert.rejects(F.transact(db,{communityId:'A-ID'},[packet(70)]),/newer/);
 await assert.rejects(F.transact(db,{communityId:'A-ID'},[packet(70,'2026-09-17')]),/Conflicting/);
 await assert.rejects(F.transact(db,{communityName:'Unknown'},[packet()]),/canonical/);
 await assert.rejects(F.transact(db,{communityId:'B-ID',communityName:'A'},[{...packet(),period:'2026-13'}]),/month/);
 const before=JSON.stringify(await read()),bad=packet(95,'2026-09-18');bad.budgets.push({...bad.budgets[0]});
 await assert.rejects(F.transact(db,{communityId:'A-ID'},[bad]),/unique GL/);assert.equal(JSON.stringify(await read()),before,'Actual and budget publication abort together');
 const changed=F.apply(store.A,{period:'2026-09',actuals:[{glCode:'6000',actual:10}],mode:'merge',source:{id:'next',file:'next.csv',effectiveAt:'2026-09-19'}});assert.equal(changed.financialLedger['2026-09'].length,2);assert.equal(store.A.financialLedger['2026-09'].length,1);
 // A second database connection sees committed period values without legacy keys.
 const second=await new Promise(resolve=>{const q=indexedDB.open('financial-test',1);q.onsuccess=()=>resolve(q.result);});
 const restored=await new Promise(resolve=>{const q=second.transaction('records').objectStore('records').get('community_data');q.onsuccess=()=>resolve(q.result.value);});assert.equal(restored.A.financialLedger['2026-09'][0].actual,90);second.close();
 // Standalone adapter: monthly figures, actual/budget separation, known community.
 const standalone=fs.readFileSync(dir+'financial-accountability.html','utf8');
 const c={AtlasFinancialPublication:F,Date,openAtlasStateDb:async()=>db,normalizeFinancialPeriodKey:p=>p};vm.createContext(c);
 const start=standalone.indexOf('function buildFinancialLedgerRows('),end=standalone.indexOf('\nasync function removeDatasetFromAtlasStore',start);vm.runInContext(standalone.slice(start,end),c);
 const ds={id:'january',name:'financial.xlsx',period:'2026-01',rows:[{gl:'4000',section:'Operating Income',mAct:10,mBud:20,yAct:999,yBud:888}]};
 assert.equal((await c.applyDatasetToAtlasStore(ds,{kind:'community',label:'A'})).ok,true);
 store=await read();assert.equal(store.A.financialLedger['2026-01'][0].actual,10);assert.equal(store.A.financialLedger['2026-01'][0].ytdActual,999);
 assert.equal((await c.applyDatasetToAtlasStore({...ds,uploadType:'budget'},{kind:'community',label:'A'})).ok,true);store=await read();assert.equal(store.A.financialLedger['2026-01'][0].actual,10);assert.equal(store.A.financialBudgetLedger['2026-01'][0].budget,20);
 assert.equal((await c.applyDatasetToAtlasStore(ds,{kind:'community',label:'Unknown'})).ok,false);
 // The retired browser budget endpoint cannot claim publication or mutate local actuals.
 const mounts=fs.readFileSync(dir+'atlas-mounts.js','utf8');
 const publisher=mounts.slice(mounts.indexOf('  function publishBudgetToAtlas('),mounts.indexOf('  function publishBudgetContractToAtlas('));
 const parent={Date,window:{AtlasFinancialPublication:F},savedData:{A:{}},persistSaved:()=>{throw Error('retired path must not save');}};vm.createContext(parent);vm.runInContext(publisher,parent);
 const payload={locked:true,property:{name:'A'},year:2026,coverage:[8],scenario:{id:'s',name:'Approved'},budgetByPeriod:{'2026-09':[{gl:'4000',budget:100}]},actualsByPeriod:{'2026-09':[{gl:'4000',actual:0}]},effectiveDate:'2026-09-17'};
 const result=parent.publishBudgetToAtlas(payload);assert.equal(result.ok,false);assert.equal(result.published,false);assert.equal(result.status,'blocked');assert.equal(result.receiptId,null);assert.deepEqual(JSON.parse(JSON.stringify(parent.savedData)),{A:{}});
 // Core Data Import commits community values and full durable lineage in one transaction.
 const main=readDashboardSource(dir+'index.html'),core={window:{},Date,Map,Set,Promise,console,ATLAS_STATE_DB_NAME:'financial-test',ATLAS_STATE_STORE_NAME:'records',ATLAS_STATE_COMMUNITY_KEY:'community_data',DATA_IMPORT_2_STATE_KEY:'imports',atlasStateWritePromise:Promise.resolve(),atlasPersistenceMeta:{},dashboardSharedSyncMeta:{}};
 vm.createContext(core);
 for(const name of ['withAtlasStateStore','queueAtlasStateWrite','persistDataImportPublication','persistSaved']){
  const source=main.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))[0];
  vm.runInContext(source,core);
 }
 globalThis.indexedDB=indexedDB;
 const {executeHistory}=await import('../docs/portfolio-operations-dashboard/features/import-history-store.mjs');
 const history=(operation,extra={})=>executeHistory({operation,dbName:'financial-test',storeName:'records',key:'imports',...extra});
 const historySnapshot={capturedAt:'2026-09-01',savedData:{A:{old:1}}};
 await history('save',{value:{batches:[{id:'old',beforeSnapshot:historySnapshot}],lineage:[{id:'l1',field:'occupied_units'}]}});
 let snapshot=await read(),importSnapshot=await history('load');
 Object.assign(core,{openAtlasStateDb:async()=>db,buildSerializedSavedDataPayload:()=>snapshot,serializeDataImport2State:()=>importSnapshot,removeLegacyCommunityStorageKeys(){},clearAtlasPersistenceError(){},persistAtlasPersistenceMeta(){},markAtlasPersistenceError(){},persistDashboardSharedSyncMeta(){},getAtlasRenderContextKey:()=> 'actor+scope',dataImportHistoryOperation:history,dataImportHistoryRevision:importSnapshot.historyStorage.revision,normalizeDataImport2State:v=>v,rememberDataImportHistoryState(){core.dataImportHistoryRevision=core.dataImport2State.historyStorage.revision;}});
 await core.persistDataImportPublication();
 core.window.AtlasOccupancyReplay={protectCommittedOccupancy:(incoming,committed)=>({...incoming,protectedMarker:committed.A.nonfinancial})};
 importSnapshot=await history('load');
 await core.persistDataImportPublication();assert.equal((await read()).protectedMarker,'preserve');
 delete core.window.AtlasOccupancyReplay;
 assert.deepEqual((await history('export')).batches[0].beforeSnapshot,historySnapshot,'Publication preserves complete immutable snapshots');
 importSnapshot=await history('load');importSnapshot.batches[0].beforeSnapshotRef.capturedAt='changed';
 await assert.rejects(core.persistDataImportPublication(),/unavailable|changed/);
 const committed=JSON.stringify(await read());snapshot={A:{shouldNotCommit:true}};importSnapshot={...await history('load'),uncloneable:()=>{}};
 await assert.rejects(core.persistDataImportPublication());assert.equal(JSON.stringify(await read()),committed,'A failed lineage write aborts the companion community write');
 core.openAtlasStateDb=async()=>null;
 core.atlasStateSetValue=async()=>{throw new Error('Unavailable')};
 const failedSave=core.persistSaved();await failedSave.completion;assert.equal(failedSave.ok,false);assert.equal(failedSave.pending,false);
 db.close();await assert.rejects(F.transact(db,{communityId:'A-ID'},[packet()]));
 console.log('PASS canonical identity, transactional actual/budget publication, duplicate replay/history, conflicts, concurrent communities, second connection, monthly basis, budget isolation and save-failure acknowledgement.');
})().catch(e=>{console.error(e);process.exitCode=1;});
