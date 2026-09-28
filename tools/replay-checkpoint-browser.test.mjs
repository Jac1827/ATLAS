// Synthetic isolated browser only; no live app, auth credentials or external requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {patchOccupancyImportBoundary} from './occupancy-compat-boundary.mjs';
import {patchReplayCheckpointBoundary} from './replay-checkpoint-compat.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const root=path.resolve(import.meta.dirname,'..'),source=await fs.readFile(path.join(root,'docs/portfolio-operations-dashboard/workspace-core.js'),'utf8');
const fn=(name,body=source)=>{const found=body.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'));assert(found,name);return found[0];};
const script=['queueAtlasStateWrite','dataImportCreateReplayCheckpoint','reprocessDataImportBoxScore','saveCommunityData','saveBudgetCurve','saveAtlasCentralAppState','pushDashboardSharedState','buildDashboardStorageBundle','buildAtlasCentralAppStatePayload'].map(name=>fn(name)).join('\n');
const old=execFileSync('git',['show','origin/atlas-asset-releases:_atlas-assets/774663d5c700ea5d00a0b13a627f965f78173d7a4700f6728ed6a6620adbf8df/portfolio-operations-dashboard/index.html'],{encoding:'utf8',maxBuffer:10*1024*1024});
const retained=patchReplayCheckpointBoundary(patchOccupancyImportBoundary(old,source,await fs.readFile(path.join(root,'docs/portfolio-operations-dashboard/features/import-workspace.js'),'utf8')),source);
const retainedHistory=execFileSync('git',['show','origin/atlas-asset-releases:_atlas-assets/774663d5c700ea5d00a0b13a627f965f78173d7a4700f6728ed6a6620adbf8df/portfolio-operations-dashboard/features/import-history-store.mjs'],{encoding:'utf8'});
const retainedScript=['queueAtlasStateWrite','dataImportCreateReplayCheckpoint','reprocessDataImportBoxScore','saveCommunityData','saveBudgetCurve','saveAtlasCentralAppState','pushDashboardSharedState','buildDashboardStorageBundle','buildAtlasCentralAppStatePayload','persistDataImportPublication'].map(name=>fn(name,retained)).join('\n');
const normalizerScript=body=>['DATA_IMPORT_REPORT_ORDER','DATA_IMPORT_REPORT_TYPES','DATA_IMPORT_FIELD_ALIASES'].map(name=>{
 const found=body.match(new RegExp('^const '+name+' = (?:[^\\n]+;|\\{[\\s\\S]*?^\\};)','m'));assert(found,name);return found[0];
}).join('\n')+'\n'+['dataImportMakeId','dataImportNormalizeText','dataImportCanonicalFieldLabel','dataImportGetReportDef','defaultDataImportMappingRules','defaultDataImportPropertyAliases','defaultDataImportSourceDefinitions','defaultDataImportFreshnessPolicies','defaultDataImport2State','normalizeDataImport2State'].map(name=>fn(name,body)).join('\n');
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;res.setHeader('content-type',pathname.endsWith('.js')||pathname.endsWith('.mjs')?'text/javascript':'text/html');
 if(pathname==='/features/import-history-store.mjs')res.end(retainedHistory);
 else if(pathname==='/normalizer.js'||pathname==='/retained-normalizer.js')res.end(normalizerScript(pathname.startsWith('/retained-')?old:source));
 else if(pathname.startsWith('/features/'))res.end(await fs.readFile(path.join(root,'docs/portfolio-operations-dashboard',pathname)));
 else res.end(pathname==='/functions.js'?script:pathname==='/retained-functions.js'?retainedScript:'<!doctype html><script src="'+(req.url.includes('retained')?'/retained-functions.js':'/functions.js')+'"></script>');
 }catch(error){res.statusCode=500;res.end(error.message);}});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({headless:true});
 const cases=['success','publication_failure','capture_failure','navigation','actor','root_replacement','queued_write','stored_version','source_change','profile_change','legacy_capture_failure','capture_abort','restore_read_failure','unrelated_during_replay','pending_during_replay','stale_roots','projected_history','bad_snapshot_reference','commit_readback_failure','pre_dispatch_guard','central_inflight','normalization_defaults','normalization_mapping_edit','normalization_metadata_edit','normalization_null_zero','normalization_unstable'];
 for(const surface of ['current','retained'])for(const mode of cases){
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/?'+surface);
  if(mode.startsWith('normalization_'))await page.addScriptTag({url:'/'+(surface==='retained'?'retained-':'')+'normalizer.js'});
  const proof=await page.evaluate(async ({mode,surface})=>{
   const retainedPublish=globalThis.persistDataImportPublication;let lastCheckpoint;const originalCapture=globalThis.dataImportCreateReplayCheckpoint;globalThis.dataImportCreateReplayCheckpoint=async entry=>{lastCheckpoint=await originalCapture(entry);if(mode==='pre_dispatch_guard'){const own=lastCheckpoint.ownWrite;lastCheckpoint.ownWrite=promise=>{own(promise);g.AtlasReplayWriteFence.assert=()=>{throw Error('Synthetic guard rejects before callback');};};}return lastCheckpoint;};
   const g=globalThis,actualNormalizer=g.normalizeDataImport2State,alerts=[],loads=[];let actor='original-actor',scope='scope-v1',profile={role:'admin',allowed_community_ids:['Example']},publishCount=0,routeCount=0,unrelatedWrites=0,normalizationEvidence=null;
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('synthetic-workspace',1);r.onupgradeneeded=()=>r.result.createObjectStore('state',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const io=(mode,action)=>new Promise((resolve,reject)=>{const tx=db.transaction('state',mode);let req;try{req=action(tx.objectStore('state'));}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(req?.result);tx.onabort=tx.onerror=()=>reject(tx.error||req?.error||Error('transaction failed'));});
   const blob=new Blob([new Uint8Array([0,255,12,0,64])],{type:'application/x-source'});
   const entry={id:'source',fileHash:'verified-hash',importStatus:'Approved',reportType:mode==='legacy_capture_failure'?'box_score':'rent_roll',communities:['Example'],fileName:'source.xlsx',batchId:'original-batch'};
   Object.assign(g,{ATLAS_STATE_DB_NAME:'synthetic-workspace',ATLAS_STATE_COMMUNITY_KEY:'communities',DATA_IMPORT_2_STATE_KEY:'imports',DATA_IMPORT_FILE_ARCHIVE_PREFIX:'source:',activeTab:1,workspaceScopeValue:'Example',XLSX:{},dataImportApprovalInProgress:false,dataImportApprovalPreflight:false,dataImportRuntimeLineageBuffer:null,atlasPersistenceMeta:{},clearAtlasPersistenceError:()=>{},persistAtlasPersistenceMeta:()=>{},markAtlasPersistenceError:()=>{},atlasStateWritePromise:Promise.resolve(),savedData:{Example:{reportYear:2026,value:0,missing:null,signed:-1.005},Other:{value:42}},dataImport2State:{sourceArchive:[entry],batches:Array.from({length:32},(_,i)=>({id:i,beforeSnapshot:{rows:Array.from({length:300},(_,j)=>({id:j,value:0,missing:null,signed:-1.005})),blob}})),canonicalRecords:[],lineage:[{id:'prior',currentState:false}],reconciliationLog:[]}});
   g.ATLAS_CENTRAL={getSession:()=>({user:{id:actor}}),getAccessContextKey:()=>scope,getStoredProfile:()=>profile};if(mode==='profile_change')delete g.ATLAS_CENTRAL.getAccessContextKey;g.atlasCsPreviewRenewalSheetRows=()=>{};g.AtlasFeatures={load:async()=>{}};
   Object.assign(g,{openAtlasStateDb:async()=>db,removeLegacyCommunityStorageKeys:()=>{},serializeDataImport2State:()=>g.dataImport2State,normalizeDataImport2State:value=>value,buildSerializedSavedDataPayload:()=>g.savedData,getProp:()=>({name:g.workspaceScopeValue}),getSelectedDashboardMonthIndex:()=>8,dataImportCanManageArchitecture:()=>true,ensureDataImportFullState:async()=>{},withAtlasStateStore:io,atlasStateGetValue:async()=>({blob,fileName:'source.xlsx'}),dataImportBuildFilePlan:async()=>({fileHash:entry.fileHash,communities:['Example'],metadata:{}}),dataImportBeginApprovalRuntime:()=>{g.dataImportRuntimeLineageBuffer=[];},dataImportFinishApprovalRuntime:()=>{if(g.dataImportRuntimeLineageBuffer?.length)g.dataImport2State.lineage.push(...g.dataImportRuntimeLineageBuffer);g.dataImportRuntimeLineageBuffer=null;},dataImportSupersedeRentRollPeriods:()=>({supersededRows:0}),dataImportResolveReplayedDelinquencyExceptions:()=>0,dataImportMakeId:()=> 'replay',loadPropertyData:name=>loads.push({name,value:g.savedData[name]?.value}),alert:text=>alerts.push(text),renderTab:()=>{},persistSaved:()=>{throw Error('No compensating disk save permitted');},persistDataImport2State:()=>{throw Error('No compensating import save permitted');}});
   if(mode.startsWith('normalization_')){g.PROPERTIES=[{name:'Example'}];g.dataImport2State.mappingRules=[];g.dataImport2State.canonicalRecords=[{financialValue:null}];}
   await io('readwrite',store=>{store.put({key:'communities',updatedAt:'v1',value:g.savedData});store.put({key:'imports',updatedAt:'v1',value:g.dataImport2State});return store.put({key:'source:source',updatedAt:'v1',value:{blob}});});
   const storedImportsBefore=JSON.stringify((await io('readonly',store=>store.get('imports'))).value);
   if(mode.startsWith('normalization_')){
    const {executeHistory}=await import('/features/import-history-store.mjs');g.normalizeDataImport2State=actualNormalizer;
    g.dataImport2State=actualNormalizer(await executeHistory({operation:'load',dbName:'synthetic-workspace',storeName:'state',key:'imports'}));
    const twice=actualNormalizer(g.dataImport2State),third=actualNormalizer(twice),fourth=actualNormalizer(third);
    normalizationEvidence={injected:g.dataImport2State.mappingRules.length,firstHasConfidence:Object.hasOwn(g.dataImport2State.mappingRules[0],'confidence'),secondConfidence:twice.mappingRules[0].confidence,thirdConfidence:third.mappingRules[0].confidence,fixedPoint:JSON.stringify(third)===JSON.stringify(fourth)};
    if(mode==='normalization_mapping_edit')g.dataImport2State.mappingRules[0].canonicalField='genuine_edited_destination';
    if(mode==='normalization_metadata_edit')g.dataImport2State.mappingRules[0].savedBy='different_mapping_owner';
    if(mode==='normalization_null_zero')g.dataImport2State.canonicalRecords[0].financialValue=0;
    if(mode==='normalization_unstable')g.normalizeDataImport2State=value=>({...actualNormalizer(value),unstableComparisonGeneration:(value.unstableComparisonGeneration||0)+1});
   }
   if(['projected_history','bad_snapshot_reference'].includes(mode)){const {executeHistory}=await import('/features/import-history-store.mjs');g.dataImport2State=g.normalizeDataImport2State(await executeHistory({operation:'load',dbName:'synthetic-workspace',storeName:'state',key:'imports'}));if(mode==='bad_snapshot_reference')g.dataImport2State.batches[0].beforeSnapshotRef.capturedAt='wrong';}
   const before=JSON.stringify({saved:g.savedData,imports:g.dataImport2State});
   if(mode==='central_inflight')g.saveAtlasCentralAppState.inFlight=new Promise(()=>{});
   if(mode==='stale_roots')await io('readwrite',store=>store.put({key:'communities',updatedAt:'newer-before-replay',value:{Example:{value:777}}}));
   g.dataImportRouteStructuredFile=async(_file,plan)=>{
    routeCount++;plan.assertReplayCurrent?.();g.savedData.Example.value=99;g.dataImport2State.canonicalRecords.push({source:'replay',value:0,missing:null});g.dataImportRuntimeLineageBuffer.push({id:'partial'});
    if(mode==='navigation'){g.workspaceScopeValue='Other';g.activeTab=2;}
    if(mode==='actor'){actor='different-actor';scope='different-scope';g.savedData={New:{value:888}};g.dataImport2State={sourceArchive:[],lineage:[],marker:'new-user'};}
    if(mode==='root_replacement'){g.savedData={Example:{value:777}};g.dataImport2State={sourceArchive:[],lineage:[],marker:'new-state'};}
    if(mode==='queued_write')g.atlasStateWritePromise=Promise.resolve('newer-save');
    if(mode==='stored_version')await io('readwrite',store=>store.put({key:'communities',updatedAt:'v2',value:{Example:{value:777}}}));
    if(mode==='source_change')entry.fileHash='newer-source';
    if(mode==='profile_change')profile={role:'admin',allowed_community_ids:['Other']};
    if(['unrelated_during_replay','pending_during_replay'].includes(mode)){const attempted=g.queueAtlasStateWrite(async()=>{unrelatedWrites++;await io('readwrite',store=>store.put({key:'communities',updatedAt:'forbidden',value:g.savedData}));},'unrelated');if(mode==='unrelated_during_replay')await attempted;}
    return {communities:['Example'],rowsHeld:0,issues:[]};
   };
   g.persistDataImportPublication=async replay=>{
    replay.assertCurrent?.();await replay.assertRecords?.();
    let failure,committed=false;const write=g.queueAtlasStateWrite(async()=>{try{replay.assertCurrent?.();if(['publication_failure','restore_read_failure','normalization_defaults'].includes(mode))throw Error('Synthetic atomic publication failure');await io('readwrite',store=>{const r=store.get('communities');r.onsuccess=()=>{try{replay.assertRecord?.('communities',r.result);store.put({key:'communities',updatedAt:'v2',value:g.savedData});}catch(e){store.transaction.abort();}};return r;});publishCount++;committed=true;}catch(error){failure=error;throw error;}},'community_and_import_publication',null,replay);
    replay.ownWrite?.(write);await write;if(failure)throw failure;if(!committed)throw Error('Queue guard stopped the write before callback');if(mode==='commit_readback_failure')throw Error('Publication readback was interrupted after commit');
   };
   if(surface==='retained')g.persistDataImportPublication=async replay=>{await retainedPublish(replay);publishCount++;if(mode==='commit_readback_failure')throw Error('Publication readback was interrupted after commit');};
   const stringify=JSON.stringify,open=indexedDB.open.bind(indexedDB),put=IDBObjectStore.prototype.put,get=IDBObjectStore.prototype.get;
   IDBObjectStore.prototype.put=function(...args){if(mode==='capture_abort'&&this.transaction.db.name.startsWith('atlas_replay_checkpoint_'))throw new DOMException('Synthetic capture abort','DataCloneError');if(surface==='retained'&&['publication_failure','restore_read_failure','normalization_defaults'].includes(mode)&&routeCount&&this.transaction.db.name==='synthetic-workspace'&&args[0]?.key==='imports')throw Error('Synthetic atomic import write failure');return put.apply(this,args);};
   if(mode==='restore_read_failure')IDBObjectStore.prototype.get=function(...args){if(this.transaction.db.name.startsWith('atlas_replay_checkpoint_'))throw Error('Synthetic restore read failure');return get.apply(this,args);};JSON.stringify=function(value,...args){if(value===g.savedData||value===g.dataImport2State)throw Error('Whole-history JSON allocation forbidden');return stringify.call(this,value,...args);};
   if(mode==='capture_failure')indexedDB.open=function(name,...args){if(name.startsWith('atlas_replay_checkpoint_'))throw new DOMException('Synthetic quota failure','QuotaExceededError');return open(name,...args);};
   try{await g.reprocessDataImportBoxScore('source');}finally{JSON.stringify=stringify;indexedDB.open=open;IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.get=get;}
   if(mode==='success'){await lastCheckpoint.committed();await lastCheckpoint.committed();}
   const records=await io('readonly',store=>store.getAll()),checkpoints=(await indexedDB.databases()).filter(x=>x.name.startsWith('atlas_replay_checkpoint_'));
   const restored=JSON.stringify({saved:g.savedData,imports:g.dataImport2State})===before;
   const retainedBlob=g.dataImport2State.batches?.[0].beforeSnapshot?.blob;const blobExact=retainedBlob instanceof Blob&&retainedBlob.type===blob.type&&JSON.stringify([...new Uint8Array(await retainedBlob.arrayBuffer())])===JSON.stringify([...new Uint8Array(await blob.arrayBuffer())]);
   let blockedAfter=false;if(g.AtlasReplayWriteFence){await g.queueAtlasStateWrite(async()=>{unrelatedWrites++;},'later ordinary save');blockedAfter=unrelatedWrites===0;}
   return {mode,normalizationEvidence,storedImportsUnchanged:JSON.stringify(records.find(x=>x.key==='imports').value)===storedImportsBefore,unrelatedWrites,blockedAfter,publishCount,routeCount,restored,blobExact,busy:g.dataImportApprovalInProgress,checkpoints:checkpoints.length,alerts,loads,current:g.savedData,disk:records.find(x=>x.key==='communities').value,historyRows:g.dataImport2State.batches?.length};
  },{mode,surface});
  assert.equal(proof.busy,false,mode+' releases busy flag');
  if(mode.startsWith('normalization_')){
   assert(proof.normalizationEvidence.injected>200);assert.deepEqual({...proof.normalizationEvidence,injected:undefined},{injected:undefined,firstHasConfidence:false,secondConfidence:null,thirdConfidence:0,fixedPoint:true});
   assert(proof.storedImportsUnchanged,'Comparison and rejected/rolled-back replay preserve exact stored history');assert(proof.restored,'Comparison does not rewrite loaded source/mapping state');assert.equal(proof.publishCount,0);assert.equal(proof.checkpoints,0);assert.equal(proof.disk.Example.value,0);
   assert.equal(proof.routeCount,mode==='normalization_defaults'?1:0,'Equivalent defaults allow replay; true mapping/metadata/null changes and unstable normalization reject before mutation');
   if(mode==='normalization_unstable')assert(proof.alerts.some(message=>message.includes('normalization did not stabilize')));
   console.log('PASS',surface,mode);await page.close();continue;
  }
  if(mode==='commit_readback_failure')assert(proof.alerts.some(message=>message.includes('No rollback was applied. Publication may have committed or newer data may exist; reload to verify the outcome.')),'Uncertain committed/readback outcome is explicit');
  if(['success','projected_history'].includes(mode)){assert.equal(proof.publishCount,1);assert.equal(proof.checkpoints,0);assert.equal(proof.current.Example.value,99);assert.equal(proof.historyRows,32);if(mode==='success')assert(proof.blobExact);}
  else if(mode==='bad_snapshot_reference'){assert.equal(proof.routeCount,0);assert.equal(proof.publishCount,0);assert.equal(proof.checkpoints,0);assert.equal(proof.restored,true);assert.equal(proof.disk.Example.value,0);}
  else if(mode==='stale_roots'){assert.equal(proof.routeCount,0);assert.equal(proof.publishCount,0);assert.equal(proof.checkpoints,0);assert.equal(proof.restored,true);assert.equal(proof.disk.Example.value,777);}
  else if(['publication_failure','capture_failure','navigation','legacy_capture_failure','capture_abort','pre_dispatch_guard','central_inflight'].includes(mode)){assert.equal(proof.publishCount,0);assert.equal(proof.restored,true,mode);assert.equal(proof.checkpoints,0,mode);assert.equal(proof.disk.Example.value,0);assert(proof.blobExact);if(mode==='navigation')assert.deepEqual(proof.loads.at(-1),{name:'Other',value:42});}
  else {assert.equal(proof.publishCount,mode==='commit_readback_failure'?1:0);assert.equal(proof.unrelatedWrites,0);assert.equal(proof.blockedAfter,true,mode+' refuses later stale writes');assert.equal(proof.checkpoints,1,mode+' retains recoverable checkpoint');if(mode==='actor')assert.deepEqual(proof.current,{New:{value:888}});if(mode==='root_replacement')assert.equal(proof.current.Example.value,777);if(mode==='stored_version')assert.equal(proof.disk.Example.value,777);}
  console.log('PASS',surface,mode);await page.close();
 }
 for(const surface of ['current','retained']){
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/?'+surface);
  const evidence=await page.evaluate(async()=>{
   const g=globalThis;let alerts=0,posts=0,gets=0,built=0,release;
   Object.assign(g,{alert:()=>alerts++,setAtlasCentralRuntimeMessage:()=>{},dashboardSharedSyncMeta:{},persistDashboardSharedSyncMeta:()=>{},DASHBOARD_SHARED_SYNC_ENDPOINT:'/synthetic',DASHBOARD_SHARED_SYNC_SCOPE:'synthetic',getDashboardSharedSyncWriteAccess:()=>({ok:true,writeToken:'synthetic-local-test'}),mergeDashboardStorageBundles:(_a,b)=>b,fetch:async(_url,options)=>{if(options.method==='POST'){posts++;return {ok:true,json:async()=>({ok:true,record:{updatedAt:'synthetic'}})};}gets++;return {ok:false};}});
   const originalBuild=g.buildDashboardStorageBundle,originalArchive=g.buildAtlasCentralAppStatePayload;
   g.AtlasReplayWriteFence={assert(){throw Error('Recovery must reload before saving');}};
   const top=g.saveCommunityData(),budget=g.saveBudgetCurve(),central=await g.saveAtlasCentralAppState({silent:true}),cloud=await g.pushDashboardSharedState({silent:true});
   let buildBlocked=false;try{await originalBuild();}catch{buildBlocked=true;}
   delete g.AtlasReplayWriteFence;g.AtlasReplayGeneration=1;
   g.buildDashboardStorageBundle=async()=>{built++;await new Promise(resolve=>release=resolve);return {source:'unchanged-before-replay'};};
   const pending=g.pushDashboardSharedState({silent:true});await Promise.resolve();g.AtlasReplayGeneration=2;g.AtlasReplayWriteFence={assert(){throw Error('replay active');}};delete g.AtlasReplayWriteFence;release();const stalePush=await pending;
   g.buildDashboardStorageBundle=async()=>({source:'coherent-current'});const ordinary=await g.pushDashboardSharedState({silent:true});
   Object.assign(g,{saveCommunityData:()=>true,persistOperationsWorkspaceContext:()=>{},persistOpsPropertyCatalog:()=>{},DASHBOARD_STORAGE_MIGRATION_KEYS:[],buildAtlasIndexedDbBundlePayload:()=>new Promise(resolve=>release=resolve)});
   const preparing=originalBuild();await Promise.resolve();g.AtlasReplayGeneration++;release({unchanged:'native stored data'});let mixedBundleBlocked=false;try{await preparing;}catch(error){mixedBundleBlocked=/bundle preparation/.test(error.message);}
   let hashStarted;const awaitingHash=new Promise(resolve=>hashStarted=resolve);
   Object.assign(g,{AtlasFeatures:{load:async()=>{}},collectAtlasCentralMigrationSnapshot:async()=>({reconciliation:{},exceptions:[]}),redactAtlasCentralStorageBundle:value=>value,buildDashboardStorageBundle:async()=>({keys:{},indexedDb:{communityData:{}}}),atlasStateWritePromise:Promise.resolve(),withAtlasStateStore:async()=>[],DATA_IMPORT_2_STATE_KEY:'imports',DATA_IMPORT_FILE_ARCHIVE_PREFIX:'source:',JSZip:{},AtlasMigrationArchive:{pack:async()=>({archive:'synthetic'}),unpack:async()=>({bundle:{keys:{},indexedDb:{communityData:{}}}})},buildAtlasMigrationReconciliationSummary:()=>({}),parseAtlasMigrationJson:()=>null,hashAtlasMigrationPayload:async()=>{hashStarted();return await new Promise(resolve=>release=resolve);},buildOperationsWorkspaceContext:()=>({}),normalizeAtlasSharedData:value=>value,atlasSharedData:{}});
   const archivePreparing=originalArchive();await awaitingHash;g.AtlasReplayGeneration++;release('synthetic-hash');let mixedArchiveBlocked=false;try{await archivePreparing;}catch(error){mixedArchiveBlocked=/archive preparation/.test(error.message);}
   return {top,budget,central,cloud,buildBlocked,mixedBundleBlocked,mixedArchiveBlocked,stalePush,ordinary,posts,gets,built,alerts};
  });
  assert.deepEqual({...evidence,alerts:undefined},{top:false,budget:false,central:false,cloud:false,buildBlocked:true,mixedBundleBlocked:true,mixedArchiveBlocked:true,stalePush:false,ordinary:true,posts:1,gets:2,built:1,alerts:undefined});
  console.log('PASS',surface,'ordinary save/Central Save/bundle/legacy cloud fences and completed-replay generation guard');await page.close();
 }
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
