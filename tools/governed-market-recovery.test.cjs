// Synthetic native IndexedDB only. No live browser, account or source workbooks.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {indexedDB}=require(process.env.ATLAS_FAKE_INDEXEDDB || 'fake-indexeddb');
const {fixture}=require('./market-survey-approval.test.cjs');
const source=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const extract=name=>source.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^\\}','m'))[0];
const clone=structuredClone,plain=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(setImmediate);
let sequence=0;
global.indexedDB=indexedDB;
async function nativeFixture(){
 const c=fixture(),dbName='market-recovery-'+(++sequence),key='imports';
 const history=await import('../docs/portfolio-operations-dashboard/features/import-history-store.mjs');
 const bounded=await import('../docs/portfolio-operations-dashboard/features/bounded-json-integrity.mjs');
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onupgradeneeded=()=>r.result.createObjectStore('state',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const io=(mode,action)=>new Promise((resolve,reject)=>{const tx=db.transaction('state',mode);let r;try{r=action(tx.objectStore('state'));}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(r?.result);tx.onerror=tx.onabort=()=>reject(tx.error||r?.error||Error('aborted'));});
 Object.assign(c,{indexedDB,Blob,File,structuredClone,crypto:require('node:crypto').webcrypto,bounded,ATLAS_STATE_DB_NAME:dbName,ATLAS_STATE_COMMUNITY_KEY:'communities',OPS_GLOBAL_STORAGE_KEY:'ops',DATA_IMPORT_2_STATE_KEY:key,ATLAS_STATE_STORE_NAME:'state',DATA_IMPORT_FILE_ARCHIVE_PREFIX:'source:',atlasPersistenceMeta:{},dashboardSharedSyncMeta:{},errors:[],alerts:[],getAtlasRenderContextKey:()=>dbName,withAtlasStateStore:io,buildSerializedSavedDataPayload:()=>clone(c.savedData),serializeDataImport2State:()=>clone(c.dataImport2State),normalizeDataImport2State:x=>x,removeLegacyCommunityStorageKeys(){},clearAtlasPersistenceError(){},persistAtlasPersistenceMeta(){},persistDashboardSharedSyncMeta(){},markAtlasPersistenceError:e=>c.errors.push(e.message),alert:message=>c.alerts.push(message)});
 c.rememberDataImportHistoryState=()=>{c.dataImportHistoryRevision=c.dataImport2State.historyStorage.revision;};
 c.dataImportHistoryOperation=async(operation,args={})=>{if(operation==='publish'&&c.beforePublish){const hook=c.beforePublish;c.beforePublish=null;await hook();}return history.executeHistory({operation,dbName,storeName:'state',key,...args});};
 c.ensureDataImportFullState=async()=>{const pendingBatch=c.dataImport2State.pendingBatch;c.dataImport2State=await c.dataImportHistoryOperation('load');c.dataImport2State.pendingBatch=pendingBatch;c.rememberDataImportHistoryState();};
 for(const name of ['dataImportCreateCommunityGuard','atlasStateGetValue','atlasOpsGlobalChangedOnlyPeopleSyncTime','atlasStateSetValue','queueAtlasStateWrite','persistSaved','persistDataImportPublication'])vm.runInContext(extract(name).replace(/await import\('\.\/features\/bounded-json-integrity\.mjs\?v=[^']+'\)/g,'bounded'),c);
 await io('readwrite',s=>{s.put({key:'communities',value:clone(c.savedData),updatedAt:'initial'});s.put({key:'atlas_workspace_source_v2',value:{version:6,dirty:true},updatedAt:'initial'});return s.put({key,value:clone(c.dataImport2State),updatedAt:'initial'});});
 return {c,io,read:async()=>clone((await io('readonly',s=>s.get('communities'))).value),write:async value=>io('readwrite',s=>s.put({key:'communities',value:clone(value),updatedAt:'other-tab'})),close:()=>db.close()};
}
test('stale pre-approval community map cannot overwrite another tab; preview choices remain',async()=>{
 const f=await nativeFixture();try{const newer={Test:{marketSurveyData:{sourceFileName:'Oct25.xlsx',compAverageRent:1965}},Other:{intent:'retain'}};await f.write(newer);await f.c.approveDataImportBatch();assert.deepEqual(await f.read(),newer);assert.equal(f.c.originals.size,0);assert.equal(f.c.dataImport2State.pendingBatch.id,'batch');assert.equal(f.c.dataImportFileHandles.size,1);assert.match(f.c.alerts.at(-1),/Reload before importing/);assert.equal(f.c.persistSaved().ok,false);assert.equal(f.c.window.AtlasImportCommunityGuard,undefined);}finally{f.close();}
});
test('intervening community writes during parsing, intermediate persistence, and atomic publication survive failed approval',async()=>{
 for(const stage of ['parse','persist','publish']){const f=await nativeFixture();try{
  const c=f.c,newer={Test:{marketSurveyData:{sourceFileName:'Oct25.xlsx'},occupied:91},Other:{intent:'newer saved choice'}};
  if(stage==='publish')c.beforePublish=()=>f.write(newer);
  else c.handleMarketSurveyWorkbook=async()=>{c.savedData.Test.marketSurveyData={sourceFileName:'incoming.xlsx'};await f.write(newer);if(stage==='persist'){const result=c.persistSaved();await result.completion;assert.equal(result.ok,false);}return 'Test';};
  await c.approveDataImportBatch();assert.deepEqual(await f.read(),newer,stage);assert.equal(c.dataImport2State.pendingBatch.id,'batch');assert.equal(c.dataImportFileHandles.size,1);assert.equal(c.notices,0);assert(c.window.AtlasImportCommunityRecovery);assert.equal(c.persistSaved().ok,false);assert.equal(c.window.AtlasImportCommunityGuard,undefined);assert(!c.csvLog.some(line=>line.includes('approved and routed')));
  const retained=await c.dataImportHistoryOperation('load');assert.equal(retained.batches.length,0,'No false Approved batch');assert.equal((await f.io('readonly',s=>s.get('atlas_workspace_source_v2'))).value.dirty,true);
 }finally{f.close();}}
});
test('fresh approval commits community and receipt together with exact before-write protection',async()=>{
 const f=await nativeFixture();try{await f.c.approveDataImportBatch();assert.equal((await f.read()).Test.marketSurveyData.compAverageRent,1709);const history=await f.c.dataImportHistoryOperation('load');assert.equal(history.batches.length,1);assert.equal(history.sourceArchive.length,1);assert.equal(f.c.dataImport2State.pendingBatch,null);assert.equal(f.c.window.AtlasImportCommunityRecovery,undefined);assert.equal(f.c.notices,1);}finally{f.close();}
});
test('a direct community write delayed across approval cannot reuse an advanced or completed import guard',async()=>{
 for(const completion of ['advanced','completed']){const f=await nativeFixture();try{
  const c=f.c,io=c.withAtlasStateStore;let armed=false,release,late;
  c.withAtlasStateStore=async(mode,action)=>{if(armed&&mode==='readwrite'){armed=false;await new Promise(resolve=>release=resolve);}return io(mode,action);};
  if(completion==='completed'){
   c.handleMarketSurveyWorkbook=async()=>{armed=true;late=c.atlasStateSetValue('communities',clone(c.savedData));c.savedData.Test.marketSurveyData={sourceFileName:'approved-new.xlsx',compAverageRent:1709};return 'Test';};
   await c.approveDataImportBatch();
  }else{
   c.window.AtlasImportCommunityGuard=await c.dataImportCreateCommunityGuard(()=>{});armed=true;late=c.atlasStateSetValue('communities',clone(c.savedData));
   await c.atlasStateSetValue('communities',{Test:{marketSurveyData:{sourceFileName:'approved-new.xlsx'}}});
  }
  release();await assert.rejects(late,/Reload before importing/);assert.equal((await f.read()).Test.marketSurveyData.sourceFileName,'approved-new.xlsx',completion);
 }finally{f.close();}}
});
test('normal local and Central Save cannot publish a failed or still-active import workspace',async()=>{
 const f=await nativeFixture();try{const c=f.c;c.setAtlasCentralRuntimeMessage=()=>{};
  for(const name of ['saveCommunityData','saveBudgetCurve','saveAtlasCentralAppState'])vm.runInContext(extract(name),c);
  for(const mode of ['active','recovery']){delete c.window.AtlasImportCommunityGuard;delete c.window.AtlasImportCommunityRecovery;if(mode==='active')c.window.AtlasImportCommunityGuard={};else c.window.AtlasImportCommunityRecovery='Import requires reload';
   assert.equal(c.saveCommunityData(),false);assert.equal(c.saveBudgetCurve(),false);assert.equal(await c.saveAtlasCentralAppState(),false);assert.equal(await c.saveAtlasCentralAppState({silent:true}),false);
  }
 }finally{f.close();}
});

function installMarketReplay(c){
 c.XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
 const b=c.XLSX.utils.book_new();for(const [name,rows]of Object.entries({'Intro Page':[['RISE Test Market'],['Last updated: 10/25/2026']],'Property Summary':[['Updated on: 10/25/2026']],'Market Survey':[['','Comp Average','RISE Test'],['Rent',1965,2200],['NER',1900,2150]]}))c.XLSX.utils.book_append_sheet(b,c.XLSX.utils.aoa_to_sheet(rows),name);
 const bytes=c.XLSX.write(b,{type:'buffer',bookType:'xlsx'}),hash=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 const entry={aptiqSource:{kind:'aptiq_market_workbook',status:'valid',communityName:'Test'},id:'approved-market',batchId:'original-market-batch',reportType:'marketing_iq',importStatus:'Approved',communities:['Test'],fileName:'Oct25_Test_Market.xlsx',fileHash:hash,uploadedAt:'2026-10-26T12:00:00Z',dataDateIso:'2026-10-25T12:00:00Z',reportingMonthIdx:9,reportingYear:2026,reportingPeriodLabel:'October 2026'};
 Object.assign(c,{SHARED_COMMUNITY_ALIASES:{},getAllCommunityNames:()=>['Test','Other'],getProp:()=>({name:'Other'}),getSelectedDashboardPeriodKey:()=> '2026-10',getSelectedDashboardMonthIndex:()=>9,buildPeriodKey:(m,y)=>`${y}-${String(m+1).padStart(2,'0')}`,dataImportCanManageArchitecture:()=>true,atlasAccessDecision:()=>({ok:true}),atlasDashboardUserCanSeeCommunityName:()=>true,dataImportIsActiveReportingCommunity:()=>true,dataImportCommunitySupportsReport:()=>true,dataImportMakeId:()=> 'replay-log',dataImportResolveReplayedDelinquencyExceptions:()=>0,dataImportBuildFilePlan:async file=>({fileHash:require('node:crypto').createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'),metadata:{dataAsOf:entry.dataDateIso},communities:['Test']}),normalizeSavedCommunityRecord:(_name,value)=>clone(value||{}),normalizeMarketSurveyData:value=>clone(value||{}),normalizeMarketSurveyHistory:value=>clone(value||{}),normalizeImportTracking:value=>clone(value||{}),formatWorkbookDateLabel:String,extractMarketSurveyFloorPlanRates:()=>[{name:'A1',marketRent:1800,sourceSheet:'AptIQ'}],seedAptiqFloorPlanRatesFromCommunity:(_r,rows)=>clone(rows),syncCommunityFloorPlanRentMetrics(){},getCurrentCommunityRecord:()=>clone(c.savedData.Other),loadPropertyData(){},dataImportBeginApprovalRuntime(){},dataImportFinishApprovalRuntime(){}});
 c.window.ATLAS_CENTRAL={getSession:()=>({user:{id:'synthetic-admin'}}),getAccessContextKey:()=> 'synthetic-access'};
 c.window.AtlasBoxScoreFloorPlans=require('../docs/portfolio-operations-dashboard/box-score-floor-plans.js');
 vm.runInContext(fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/floor-plan-settings.js','utf8'),c);
 for(const name of ['normalizeCommunityLookupName','matchPropertyName','dataImportAptiqWorkbookSource','dataImportAptiqSourceFromWorkbook','getWorkbookSheetRows','findWorksheetRow','findWorksheetCellMatch','normalizeWorkbookNumber','normalizeWorkbookPercent','normalizeMarketSurveyCancellationPercent','buildMarketSurveyCompSet','buildMarketSurveyConcessionSummary','extractMarketSurveyCompRows','extractMarketSurveyWorkbookData','applyMarketSurveyDataToProperty','dataImportCreateReplayCheckpoint','dataImportMarketReplaySupported','checkDataImportMarketReplaySupport','dataImportFileHash','dataImportReconcileMarketSource','reprocessDataImportBoxScore'])vm.runInContext(extract(name),c);
 c.savedData={Test:{currentMonth:9,occupied:91,boxScoreHistory:[{sourceFile:'BoxScore52',value:91}],communityFloorPlans:[{id:'A1-id',name:'A1',approvalStatus:'approved',approvedForReporting:true,boxScoreManaged:true,marketedRent:2300,budgetRent:2400,sourceFileName:'BoxScore52',sourceAsOf:'2026-10-26'}],marketSurveyData:{sourceFileName:'Oct18.xlsx',compAverageRent:1953,pricingNotes:'Keep manual note',floorPlanRates:[]},marketSurveyHistory:{'2026-09':{compAverageRent:1700}},importTracking:{marketSurvey:{'2026-09':{sourceFileName:'Sept.xlsx'}}}},Other:{intent:'retain unrelated data'}};
 c.dataImport2State={sourceArchive:[entry],batches:[{id:entry.batchId,status:'Approved',archiveIds:[entry.id]}],canonicalRecords:[{key:'original-market-fact',values:{rent:1965}}],lineage:[],reconciliationLog:[],closedPeriods:[],pendingBatch:null};
 return {entry,blob:new Blob([bytes]),bytes};
}
async function replayFixture(){const f=await nativeFixture(),setup=installMarketReplay(f.c);await f.io('readwrite',s=>{s.put({key:'communities',value:clone(f.c.savedData),updatedAt:'before-replay'});s.put({key:'imports',value:clone(f.c.dataImport2State),updatedAt:'before-replay'});return s.put({key:'source:'+setup.entry.id,value:{blob:setup.blob,fileName:setup.entry.fileName},updatedAt:'before-replay'});});return {...f,...setup};}
test('approved market replay repairs current/history/tracking and retains Box Score subject rates, facts, and original receipts',async()=>{
 const f=await replayFixture();try{const before=clone(f.c.savedData),facts=clone(f.c.dataImport2State.canonicalRecords);await f.c.reprocessDataImportBoxScore(f.entry.id);const after=await f.read();assert.equal(after.Test.marketSurveyData.compAverageRent,1965,f.c.alerts.join('\n'));assert.equal(after.Test.marketSurveyData.floorPlanRates[0].marketRent,2300);assert.equal(after.Test.marketSurveyHistory['2026-10'].floorPlanRates[0].marketRent,2300);assert.equal(after.Test.marketSurveyData.sourceFileName,f.entry.fileName);assert.equal(after.Test.marketSurveyData.uploadedAt,f.entry.uploadedAt);assert.equal(after.Test.marketSurveyData.pricingNotes,'Keep manual note');assert.equal(after.Test.importTracking.marketSurvey['2026-10'].importedAt,f.entry.uploadedAt);assert.deepEqual(after.Test.communityFloorPlans,before.Test.communityFloorPlans);assert.deepEqual(after.Test.boxScoreHistory,before.Test.boxScoreHistory);assert.equal(after.Test.occupied,91);assert.deepEqual(after.Other,before.Other);assert.deepEqual(after.Test.marketSurveyHistory['2026-09'],before.Test.marketSurveyHistory['2026-09']);const history=await f.c.dataImportHistoryOperation('load');assert.equal(history.batches.length,1);assert.equal(history.sourceArchive.length,1);assert.deepEqual(history.canonicalRecords,facts);assert.equal(history.sourceArchive[0].batchId,f.entry.batchId);assert(history.sourceArchive[0].reprocessedAt);assert.equal(history.sourceArchive[0].uploadedAt,f.entry.uploadedAt);assert.equal(f.c.window.AtlasReplayWriteFence,undefined);}finally{f.close();}
});
test('market replay rejects changed original, missing batch, older source, wrong month and cross-tab changes without restoring over newer native data',async()=>{
 for(const mode of ['hash','batch','older','month','race']){const f=await replayFixture();try{
  const c=f.c,before=await f.read();
  if(mode==='hash')await f.io('readwrite',s=>s.put({key:'source:'+f.entry.id,value:{blob:new Blob(['different']),fileName:f.entry.fileName},updatedAt:'before-replay'}));
  if(mode==='batch'||mode==='older'){if(mode==='batch')c.dataImport2State.batches[0].archiveIds=[];else c.dataImport2State.sourceArchive.push({...f.entry,id:'later',dataDateIso:'2026-10-26T12:00:00Z'});await f.io('readwrite',s=>s.put({key:'imports',value:clone(c.dataImport2State),updatedAt:'before-replay'}));}
  if(mode==='month')c.getSelectedDashboardPeriodKey=()=> '2026-09';
  const newer={...before,Other:{intent:'concurrent tab choice'}};if(mode==='race')c.beforePublish=()=>f.write(newer);
  await c.reprocessDataImportBoxScore(f.entry.id);assert.deepEqual(await f.read(),mode==='race'?newer:before,mode);assert.equal(c.dataImportApprovalInProgress,false);assert(!c.alerts.some(message=>message.startsWith('Reprocessed ')),mode);if(mode==='race')assert(c.window.AtlasReplayWriteFence,'Uncertain recovery stays blocked until reload');
 }finally{f.close();}}
});
test('same-date market corrections use approval and upload order, and ambiguous differing sources fail closed',async()=>{
 for(const mode of ['later-upload','later-approval','ambiguous','missing-order','older-upload','older-approval','identical']){const f=await replayFixture();try{
  const c=f.c,before=await f.read(),other={...f.entry,id:'same-date-other',batchId:'other-batch',fileHash:mode==='identical'?f.entry.fileHash:'different-content'};
  const selectedBatch=c.dataImport2State.batches[0],otherBatch={id:other.batchId,status:'Approved',archiveIds:[other.id]};
  if(mode==='later-upload')other.uploadedAt='2026-10-26T13:00:00Z';
  if(mode==='older-upload')other.uploadedAt='2026-10-26T11:00:00Z';
  if(mode==='later-approval'||mode==='older-approval'){selectedBatch.approvedAt='2026-10-26T13:00:00Z';otherBatch.approvedAt=mode==='later-approval'?'2026-10-26T14:00:00Z':'2026-10-26T12:30:00Z';}
  if(mode==='missing-order')other.uploadedAt='invalid';
  c.dataImport2State.sourceArchive.push(other);c.dataImport2State.batches.push(otherBatch);await f.io('readwrite',s=>s.put({key:'imports',value:clone(c.dataImport2State),updatedAt:'before-replay'}));
  await c.reprocessDataImportBoxScore(f.entry.id);const succeeds=['older-upload','older-approval','identical'].includes(mode);
  if(succeeds){assert.equal((await f.read()).Test.marketSurveyData.compAverageRent,1965,mode+' '+c.alerts.join('\n'));assert(c.alerts.some(message=>message.startsWith('Reprocessed ')),mode);}
  else {assert.deepEqual(await f.read(),before,mode);assert(c.alerts.some(message=>/newer or ambiguously ordered/.test(message)),mode);}
 }finally{f.close();}}
});
test('legacy market recovery qualification verifies retained bytes on demand without modifying records',async()=>{
 for(const mode of ['valid','generic','hash','pdf','wrong-subject','scope']){const f=await replayFixture();try{
  const c=f.c;delete f.entry.aptiqSource;
  if(mode==='pdf')f.entry.fileName='market.pdf';
  if(mode==='wrong-subject')f.entry.communities=['Other'];
  if(mode==='hash')await f.io('readwrite',s=>s.put({key:'source:'+f.entry.id,value:{blob:new Blob(['changed'])}}));
  if(mode==='generic'){const book=c.XLSX.utils.book_new();c.XLSX.utils.book_append_sheet(book,c.XLSX.utils.aoa_to_sheet([['Generic market','Rent'],['Test',1000]]),'Data');const bytes=c.XLSX.write(book,{type:'buffer',bookType:'xlsx'});f.entry.fileHash=require('node:crypto').createHash('sha256').update(bytes).digest('hex');await f.io('readwrite',s=>s.put({key:'source:'+f.entry.id,value:{blob:new Blob([bytes])}}));}
  await f.io('readwrite',s=>s.put({key:'imports',value:clone(c.dataImport2State)}));await c.ensureDataImportFullState();
  const before=await f.read(),beforeHistory=clone(await c.dataImportHistoryOperation('load'));let renders=0;c.renderTab=()=>renders++;
  if(mode==='scope'){let current=true;const get=c.atlasStateGetValue;c.captureAtlasSaveContext=()=>()=>current;c.atlasStateGetValue=async key=>{const stored=await get(key);current=false;return stored;};}
  assert.equal(c.dataImportMarketReplaySupported(c.dataImport2State.sourceArchive[0]),false);await c.checkDataImportMarketReplaySupport(f.entry.id);
  assert.equal(c.dataImportMarketReplaySupported(c.dataImport2State.sourceArchive[0]),mode==='valid',mode+' '+c.alerts.join('\n'));assert.equal(renders,mode==='valid'?1:0,mode);assert.equal(c.dataImportApprovalPreflight,false);
  assert.deepEqual(await f.read(),before,mode);assert.deepEqual(await c.dataImportHistoryOperation('load'),beforeHistory,mode);assert.equal(c.window.AtlasReplayWriteFence,undefined);
  if(mode==='valid'){await c.reprocessDataImportBoxScore(f.entry.id);assert.equal((await f.read()).Test.marketSurveyData.compAverageRent,1965,'Verified legacy support survives a fresh full-history load');const row=c.dataImport2State.sourceArchive[0];assert.equal(row.aptiqSource,undefined,'Legacy receipt qualification remains a tab-local cache');row.fileHash='different';assert.equal(c.dataImportMarketReplaySupported(row),false,'Cached support cannot cross source changes');}
 }finally{f.close();}}
});
test('Source Archive offers reconciliation only for qualified market workbooks; unknown workbooks require a read-only check',()=>{
 const ui=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/features/import-workspace.js','utf8'),renderer=ui.match(/^function renderDataImportArchiveView\([^\n]*\) \{[\s\S]*?^\}/m)[0];
 for(const kind of ['qualified','legacy','pdf','generic','invalid','wrong-subject'])for(const approved of [true,false])for(const managed of [true,false]){
  const entry={id:'source',reportType:'marketing_iq',fileName:kind==='pdf'?'market.pdf':'market.xlsx',fileHash:'hash',communities:['Test'],importStatus:approved?'Approved':'Held'};
  if(['qualified','invalid','wrong-subject'].includes(kind))entry.aptiqSource={kind:'aptiq_market_workbook',status:kind==='invalid'?'invalid':'valid',communityName:kind==='wrong-subject'?'Other':'Test'};
  const c={window:{},dataImportHistoryDisplay:()=>({rows:[entry],controls:''}),dataImportCanManageArchitecture:()=>managed,escapeHtml:String,dataImportFormatBytes:()=>'',dataImportFormatTimestamp:()=>'',dataImportReportLabel:()=>'',dataImportStatusClass:()=>''};vm.createContext(c);vm.runInContext(extract('dataImportMarketReplaySupported')+'\n'+renderer,c);const html=c.renderDataImportArchiveView(),qualified=kind==='qualified';
  assert.equal(html.includes('Reconcile approved source'),approved&&managed&&qualified,kind);assert.equal(html.includes('Inspect replay receipt'),approved&&managed&&qualified,kind);assert.equal(html.includes('Check market recovery'),approved&&managed&&!qualified&&kind!=='pdf',kind);assert(!html.includes('Correct daily report date'));
 }
});
