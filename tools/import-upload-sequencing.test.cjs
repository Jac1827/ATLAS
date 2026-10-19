const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./market-survey-approval.test.cjs');
const source=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const ui=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/features/import-workspace.js','utf8');
const extract=(name,text=source)=>text.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^\\}','m'))[0];
const tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(mode){
 const c=fixture(mode);let sequence=0;
 Object.assign(c,{AbortController,dataImportPreviewController:null,dataImportUploadType:'auto',dataImportUploadCommunity:'',document:{getElementById:()=>null},getDataImportUploadPeriod:()=>({monthIdx:9,year:2026}),dataImportBuildBatchId:()=>`new-batch-${++sequence}`,dataImportAnnotatePlan:x=>x,built:0});
 c.dataImportBuildFilePlan=async(file)=>{c.built++;const fileId='new-'+file.name;c.dataImportFileHandles.set(fileId,file);return {fileId,name:file.name,selected:true,status:'ready',reportType:'marketing_iq',communities:['Test'],issues:[]};};
 for(const name of ['cancelDataImportPreview','dataImportStageFiles','handleDataImport2Drop','clearDataImportPendingBatch','toggleDataImportFileApproval','toggleDataImportCommunityApproval','assignDataImportPlanCommunity','setDataImportBatchSelection','overrideDataImportReportType'])vm.runInContext(extract(name),c);
 return c;
}
async function assertBlocked(c){
 const before=JSON.stringify(c.dataImport2State.pendingBatch),handles=[...c.dataImportFileHandles.keys()],built=c.built;
 await c.dataImportStageFiles([{name:'next.xlsx'}]);
 c.handleDataImport2Drop({preventDefault(){},stopPropagation(){},dataTransfer:{files:[{name:'drop.xlsx'}]}});
 c.clearDataImportPendingBatch();c.toggleDataImportFileApproval('file',false);c.toggleDataImportCommunityApproval('file','Other',true);c.assignDataImportPlanCommunity('file','Other');c.setDataImportBatchSelection(false);await c.overrideDataImportReportType('file','rent_roll');
 await tick();assert.equal(c.built,built);assert.equal(JSON.stringify(c.dataImport2State.pendingBatch),before);assert.deepEqual([...c.dataImportFileHandles.keys()],handles);
 assert(!c.csvLog.some(s=>s.includes('approved and routed')));
}
test('picker/drop/discard cannot replace a batch during preflight, publication, or final writes',async()=>{
 const c=setup(),preflight=deferred(),publication=deferred(),cleanup=deferred();
 c.dataImportFileHandles.set('unrelated',{name:'other.xlsx'});
 c.ensureDataImportFullState=()=>preflight.promise;
 c.persistDataImportPublication=async()=>{c.writes++;await publication.promise;c.committed=structuredClone(c.dataImport2State);c.atlasStateWritePromise=cleanup.promise;};
 const pending=c.approveDataImportBatch();assert.equal(c.dataImportApprovalPreflight,true);await assertBlocked(c);
 preflight.resolve();await tick();assert.equal(c.writes,1);assert.equal(c.notices,0);assert.equal(c.dataImportApprovalInProgress,true);await assertBlocked(c);
 publication.resolve();await tick();assert.equal(c.notices,1);assert.equal(c.dataImportApprovalInProgress,true);await assertBlocked(c);
 cleanup.resolve();await pending;assert.equal(c.dataImportApprovalInProgress,false);assert(c.csvLog.some(s=>s.includes('approved and routed')));assert.equal(c.dataImport2State.pendingBatch,null);assert(c.dataImportFileHandles.has('unrelated'));assert(!c.dataImportFileHandles.has('file'));
 await c.dataImportStageFiles([{name:'after.xlsx'}]);assert.equal(c.dataImport2State.pendingBatch.id,'new-batch-1');assert(c.dataImportFileHandles.has('new-after.xlsx'));await tick();assert(c.dataImportFileHandles.has('new-after.xlsx'));
});
test('an earlier asynchronous preview is cancelled and cannot clear a newer preview after approval',async()=>{
 const c=setup(),parse=deferred(),original=c.dataImportBuildFilePlan;
 c.dataImportBuildFilePlan=async file=>{await parse.promise;return original(file);};
 const stale=c.dataImportStageFiles([{name:'stale.xlsx'}]);await tick();assert(c.dataImportPreviewController);
 await c.approveDataImportBatch();assert.equal(c.dataImport2State.pendingBatch,null);assert.equal(c.dataImportApprovalInProgress,false);
 c.dataImportBuildFilePlan=original;await c.dataImportStageFiles([{name:'fresh.xlsx'}]);const fresh=c.dataImport2State.pendingBatch;
 parse.resolve();await stale;assert.equal(c.dataImport2State.pendingBatch,fresh);assert(c.dataImportFileHandles.has('new-fresh.xlsx'));assert(!c.dataImportFileHandles.has('new-stale.xlsx'));
});
test('failed preflight or uncommitted publication leaves the original preview retryable and unlocks staging',async()=>{
 for(const where of ['preflight','publication']){
  const c=setup();if(where==='preflight')c.ensureDataImportFullState=async()=>{throw Error('read failed');};else c.persistDataImportPublication=async()=>{throw Error('not committed');};
  await c.approveDataImportBatch();assert.equal(c.dataImportApprovalPreflight,false);assert.equal(c.dataImportApprovalInProgress,false);assert.equal(c.dataImport2State.pendingBatch.id,'batch');assert(c.dataImportFileHandles.has('file'));assert.equal(c.notices,0);assert(!c.csvLog.some(s=>s.includes('approved and routed')));
  await c.dataImportStageFiles([{name:'retry.xlsx'}]);assert.equal(c.dataImport2State.pendingBatch.files[0].name,'retry.xlsx');
 }
});
test('acknowledged publication and final refresh failures never restore a retryable old preview',async()=>{
 for(const where of ['committed-error','load','grid']){
  const c=setup();c.dataImportFileHandles.set('unrelated',{name:'unrelated.xlsx'});
  if(where==='committed-error')c.persistDataImportPublication=async()=>{c.committed=structuredClone(c.dataImport2State);throw Object.assign(Error('cache failed'),{publicationCommitted:true});};
  if(where==='load')c.loadPropertyData=()=>{if(c.committed)throw Error('display failed');};
  if(where==='grid')c.renderPropGrid=()=>{if(c.committed)throw Error('display failed');};
  await c.approveDataImportBatch();assert.equal(c.dataImportApprovalInProgress,false);assert.equal(c.notices,1,'Every acknowledged commit attempts its post-commit notice once');assert.equal(c.dataImport2State.pendingBatch,null);assert.equal(c.dataImport2State.batches[0].status,'Approved');assert.equal(c.savedData.Test.marketSurveyData.compAverageRent,1709);assert(!c.dataImportFileHandles.has('file'));assert(c.dataImportFileHandles.has('unrelated'));assert.match(c.csvError,/import was saved.*Open Import History/);assert(!c.csvLog.some(s=>s.includes('remains in Import Preview')));
 }
});
test('missing source handles fail before routing, and busy upload/preview controls are disabled',async()=>{
 const c=setup();c.dataImportFileHandles.delete('file');await c.approveDataImportBatch();assert.equal(c.writes,0);assert.equal(c.notices,0);assert.match(c.csvError,/no longer available/);assert.equal(c.dataImportApprovalInProgress,false);
 Object.assign(c,{FULL_MONTHS:['October'],DATA_IMPORT_REPORT_ORDER:[],escapeHtml:String,dataImportReportLabel:String,dataImportGetHealthCommunityNames:()=>[],dataImportFormatBytes:String,dataImportFormatTimestamp:String,dataImportStatusClass:String,renderDataImportFileIssues:()=>'',renderDataImportPreviewStats:()=>'',renderDataImportBatchQuestions:()=>'',renderDataImportPlannedDownstreamAudit:()=>'',dataImport2State:{pendingBatch:{id:'batch',files:[],summary:{}}}});
 vm.runInContext(extract('renderDataImportDropzone',ui),c);vm.runInContext(extract('renderDataImportPendingBatch',ui),c);
 for(const [preflight,approval] of [[true,false],[false,true],[false,false]]){
  c.dataImportApprovalPreflight=preflight;c.dataImportApprovalInProgress=approval;
  const drop=c.renderDataImportDropzone(),preview=c.renderDataImportPendingBatch();
  assert.equal(/id="csv-input"[^>]*disabled/.test(drop),preflight||approval);assert.equal(/aria-disabled="true"/.test(drop),preflight||approval);assert.equal(/disabled onclick="clearDataImportPendingBatch/.test(preview),preflight||approval);
 }
});

test('acknowledged commits use the same stable notice event identity as normal publication',async()=>{
 for(const acknowledgedError of [false,true]){
  const c=setup(),sent=[];
  Object.assign(c,{atlasProfileCanManageSettings:()=>true,getAtlasAccessProfile:()=>({}),atlasAccessAdminState:{rows:[{email:'employee@example.com',role:'viewer',allowed_community_ids:['community'],locked_tab_ids:[]}],communities:[{display_name:'Test',community_id:'community'}]},ATLAS_ACCESS_ROLE_TABS:{viewer:['8']},getAtlasAccessTab:()=>({label:'Marketing',key:'marketing'}),atlasNormalizeSharedText:v=>String(v).toLowerCase(),normalizeAtlasAccessList:v=>v||[]});
  c.window.ATLAS_CENTRAL={publishEmployeeNotification:async notice=>{sent.push(notice);}};
  c.dataImportRouteApprovedFile=async()=>({rowsUpdated:1,communities:['Test'],destinations:['Marketing']});
  if(acknowledgedError)c.persistDataImportPublication=async()=>{throw Object.assign(Error('post-commit refresh failed'),{publicationCommitted:true});};
  vm.runInContext(extract('publishAtlasApprovedDataNotices'),c);
  await c.approveDataImportBatch();await tick();assert.equal(sent.length,1);assert.equal(sent[0].eventKey,'data:batch:employee@example.com:marketing_iq:Test');
  await c.publishAtlasApprovedDataNotices(c.dataImport2State.batches[0]);assert.equal(sent.length,2);assert.equal(new Set(sent.map(n=>n.eventKey)).size,1,'Repeating the existing notice publisher retains the backend idempotency key');
 }
});
