const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {readDashboardSource}=require('./dashboard-source.cjs');
const source=readDashboardSource('docs/portfolio-operations-dashboard/index.html');
const plain=value=>JSON.parse(JSON.stringify(value));
function context(overlay=""){
 const c=vm.createContext({Date,Map,Set,File,Blob,console,MONTHS:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']});
 for(const f of (source+"\n"+overlay).matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm))vm.runInContext(f[0],c);
 return c;
}
const plan=()=>({reportType:'rent_roll',reportTypeLabel:'Rent Roll',name:'September rent roll.xlsx',fileHash:'source-hash',sourceSystem:'Entrata',reportingMonthIdx:8,reportingYear:2026,reportingPeriodLabel:'Sep 2026',communities:['Example'],selectedCommunities:['Example'],periodSelection:{requested:{monthIdx:8,year:2026},detected:{monthIdx:8,year:2026},basis:'source_verified'},metadata:{dataAsOf:'2026-09-28T14:03:00Z'},occupancyEvidenceBySheet:{Example:{sourceFingerprint:'source-hash',period:'2026-09',pipeline:{signedVacantUnits:1,datedMoveIns:[{date:'2026-10-27',count:1}]}}}});
test('rent-roll reporting month controls all rows while lease and move-in attributes remain exact',()=>{
 const c=context(),p=plan(),row={lease_end:'2027-07-31',lease_start:'2026-08-01',move_in_date:'2026-10-27'},before=JSON.stringify(row);
 assert.deepEqual(plain(c.dataImportRowPeriod(row,{sourceSheet:'Example'},p)),{monthIdx:8,year:2026,periodKey:'2026-09'});assert.equal(JSON.stringify(row),before);
 assert.equal(c.dataImportRowPeriod(row,{sourceSheet:'Example'},{...p,reportType:'renewal_tracker'}).periodKey,'2027-07','Renewal cohorts still use expiration dates');
 assert.equal(c.dataImportRowPeriod(row,{}, {...p,reportingMonthIdx:null,reportingYear:null}).periodKey,'','Missing report context cannot come from a lease date');
 const mismatch=c.dataImportApplySelectedPeriod({...p,status:'ready',selected:true,issues:[]},{monthIdx:7,year:2026});assert.equal(mismatch.status,'blocked');assert.equal(mismatch.reportingMonthIdx,8);
});
function routeFixture(overlay=""){
 const c=context(overlay),calls={persist:0,shared:0,alerts:[],groups:[]},rows=[{sourceSheet:'Example',sourceRow:8,values:{unit:'synthetic-1',lease_end:'2027-07-31',move_in_date:'2026-10-27',scheduled_charges:0}},{sourceSheet:'Example',sourceRow:9,values:{unit:'synthetic-2',lease_end:'2028-01-31',move_in_date:'2026-12-01',scheduled_charges:1250.005}}];
 Object.assign(c,{window:{atlasCsPreviewRenewalSheetRows:()=>{},AtlasFeatures:{load:async()=>{}}},XLSX:{},savedData:{Example:{}},dataImport2State:{canonicalRecords:[],sourceArchive:[],lineage:[],reconciliationLog:[],exceptions:[],closedPeriods:[]},dataImportRuntimeCanonicalIndex:null,dataImportRuntimeCurrentLineageIndex:null,dataImportRuntimeLineageBuffer:null,dataImportApprovalInProgress:false,dataImportApprovalPreflight:false,dataImportApprovalProgress:{rowsDone:0},dataImportUpdateApprovalProgress:()=>{},DATA_IMPORT_FILE_ARCHIVE_PREFIX:'archive:',dataImportReadStructuredRows:async()=>[{sheetName:'Example',rows}],dataImportBuildAliasLookup:()=>new Map(),dataImportBuildInternalCommunityLookup:()=>new Map(),dataImportEffectiveFreshness:()=>({action:'warn',days:3650}),dataImportMapSourceRow:r=>({mapped:r.values,sourceFields:{},unmappedFields:[]}),dataImportResolveRowCommunity:()=> 'Example',dataImportCommunitySupportsReport:()=>true,dataImportGetReportDef:()=>null,dataImportApplyGroupedSnapshot:g=>calls.groups.push(plain(g)),dataImportRecordPlanLearningUsage:()=>{},persistSaved:()=>calls.persist++,persistDataImport2State:()=>{},getProp:()=>({name:'Example'}),loadPropertyData:()=>{},renderTab:()=>{},dataImportCanManageArchitecture:()=>true,ensureDataImportFullState:async()=>{},persistDataImportPublication:async()=>calls.shared++,alert:text=>calls.alerts.push(text)});
 // Route semantics use a lightweight checkpoint double here; the actual native
 // IndexedDB checkpoint and retained publication are covered by the browser suite.
 c.dataImportCreateReplayCheckpoint=async entry=>{const saved=structuredClone(c.savedData),imports=structuredClone(c.dataImport2State);return {assertCurrent(){},mayRender:()=>true,updateEntry:value=>Object.assign(entry,value),committed:async()=>{},restore:async()=>{c.savedData=saved;c.dataImport2State=imports;},retain(){}};};
 return {c,calls,rows};
}
test('scoped route accepts future lease dates in September and holds missing/mismatched report months',async()=>{
 const {c,rows}=routeFixture(),p=plan(),before=JSON.stringify(rows),r=await c.dataImportRouteStructuredFile({},p,'batch');assert.equal(r.rowsHeld,0);assert.equal(r.rowsInserted,2);assert.equal(JSON.stringify(rows),before);assert(c.dataImport2State.canonicalRecords.every(r=>r.periodKey==='2026-09'));assert.deepEqual(plain(c.dataImport2State.canonicalRecords.map(r=>r.values)),rows.map(r=>r.values));assert.deepEqual(plain(c.dataImport2State.canonicalRecords[0].occupancyEvidence),p.occupancyEvidenceBySheet.Example);
 const held=routeFixture();const missing=await held.c.dataImportRouteStructuredFile({}, {...plan(),reportingMonthIdx:null,reportingYear:null},'missing');assert.equal(missing.rowsHeld,2);assert.equal(held.c.dataImport2State.canonicalRecords.length,0);assert(missing.issues.every(i=>i.title==='Rent roll reporting period is missing'));
 const mismatch=routeFixture();const m=await mismatch.c.dataImportRouteStructuredFile({}, {...plan(),periodSelection:{requested:{monthIdx:7,year:2026}}},'mismatch');assert.equal(m.rowsHeld,2);assert.equal(mismatch.c.dataImport2State.canonicalRecords.length,0);assert(m.issues.every(i=>i.title==='Source section is outside the selected period'));
 const closed=routeFixture();closed.c.dataImport2State.closedPeriods=['2026-09'];const locked=await closed.c.dataImportRouteStructuredFile({},plan(),'closed');assert.equal(locked.rowsHeld,2);assert.equal(closed.c.dataImport2State.canonicalRecords.length,0);
});
async function assertRetainedReplay(overlay=""){
 const {c,calls}=routeFixture(overlay),p=plan(),bytes=Buffer.from('synthetic immutable source'),hash=crypto.createHash('sha256').update(bytes).digest('hex');p.fileHash=hash;p.occupancyEvidenceBySheet.Example.sourceFingerprint=hash;
 const archive={id:'archive-id',fileName:p.name,fileHash:hash,reportType:'rent_roll',importStatus:'Approved',batchId:'original-batch',communities:['Example'],sourceSystem:'Entrata',metadata:p.metadata};c.dataImport2State.sourceArchive=[archive];const historical={key:'untouched-prior-period',communityName:'Example',periodKey:'2026-08',values:{scheduled_charges:0},fileHash:'prior-hash'};c.dataImport2State.canonicalRecords=[historical];c.dataImport2State.lineage=[{id:'original-history',currentState:false}];
 c.atlasStateGetValue=async()=>({fileName:p.name,blob:new Blob([bytes]),type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});c.dataImportBuildFilePlan=async file=>({...structuredClone(p),fileHash:crypto.createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex')});
 await c.reprocessDataImportBoxScore(archive.id);assert.equal(calls.shared,1,JSON.stringify(calls.alerts));assert.equal(c.dataImport2State.canonicalRecords.length,3);assert.deepEqual(plain(c.dataImport2State.canonicalRecords[0]),historical);assert(c.dataImport2State.lineage.some(r=>r.id==='original-history'));assert.equal(archive.fileHash,hash);assert.equal(archive.importStatus,'Approved');assert.equal(archive.reprocessResult.rowsInserted,2);assert.equal(archive.reprocessResult.rowsHeld,0);
 const facts=()=>plain(c.dataImport2State.canonicalRecords.map(r=>({key:r.key,period:r.periodKey,values:r.values,originalValues:r.originalValues,sourceHash:r.fileHash,occupancyEvidence:r.occupancyEvidence,revisions:r.revisions||[]})));const beforeFacts=facts();await c.reprocessDataImportBoxScore(archive.id);assert.equal(calls.shared,2);assert.equal(archive.reprocessResult.rowsInserted,0);assert.equal(archive.reprocessResult.rowsUnchanged,2);assert.deepEqual(facts(),beforeFacts,'Replaying unchanged source must not duplicate canonical facts or erase revisions');assert.equal(c.dataImport2State.sourceArchive.length,1);
 const before=JSON.stringify(c.dataImport2State);c.dataImportBuildFilePlan=async()=>({...p,fileHash:'tampered'});await c.reprocessDataImportBoxScore(archive.id);assert.equal(calls.shared,2);assert.equal(JSON.stringify(c.dataImport2State),before);assert.match(calls.alerts.at(-1),/hash does not match/);
 c.dataImportCanManageArchitecture=()=>false;c.atlasStateGetValue=async()=>{throw Error('Unauthorized replay must not read archived bytes');};await c.reprocessDataImportBoxScore(archive.id);assert.equal(calls.shared,2);
}
test('explicit retained rent-roll replay verifies exact source, persists once, remains idempotent and preserves prior history',()=>assertRetainedReplay());
test('composed retained operational host executes the same safe source replay',async()=>{
 const {patchOccupancyImportBoundary}=await import('./occupancy-compat-boundary.mjs');
 const root=__dirname+'/../docs/portfolio-operations-dashboard/';
 const patched=patchOccupancyImportBoundary(fs.readFileSync(__dirname+'/fixtures/occupancy-retained-import-boundary.js','utf8'),fs.readFileSync(root+'workspace-core.js','utf8'),fs.readFileSync(root+'features/import-workspace.js','utf8'));
 await assertRetainedReplay(patched);
});
function correctionFixture(overlay=""){
 const f=routeFixture(overlay),{c,rows}=f,p=plan(),bytes=Buffer.from('exact correction source');p.fileHash=crypto.createHash('sha256').update(bytes).digest('hex');p.occupancyEvidenceBySheet.Example.sourceFingerprint=p.fileHash;
 const period=new Date().getFullYear()+'-07',archive={id:'correction-source',fileName:p.name,fileHash:p.fileHash,reportType:'rent_roll',importStatus:'Approved',batchId:'original-batch',communities:['Example'],metadata:p.metadata};
 c.window.ATLAS_CENTRAL={getSession:()=>({user:{id:'authorized-actor'}}),getStoredProfile:()=>({role:'admin'})};
 c.atlasStateGetValue=async()=>({fileName:p.name,blob:new Blob([bytes])});c.dataImportBuildFilePlan=async()=>structuredClone(p);
 c.dataImport2State.sourceArchive=[archive];
 const old={key:'old-period-key',reportType:'rent_roll',communityName:'Example',periodKey:period,fileHash:p.fileHash,sourceSheet:'Example',sourceRow:8,values:structuredClone(rows[0].values),originalValues:{retained:'full original evidence'},revisions:[{values:{scheduled_charges:-1.005},fileHash:'prior-version'}]};
 const other={...structuredClone(old),key:'another-source',fileHash:'newer-source',sourceRow:99},outside={...structuredClone(old),key:'outside-scope',communityName:'Other'},history={id:'prior-history',reportType:'rent_roll',fileHash:p.fileHash,communityName:'Example',periodKey:'2024-04',currentState:false,importedValue:9};
 c.dataImport2State.canonicalRecords=[old,other,outside];
 c.dataImport2State.lineage=[{id:'owned',reportType:'rent_roll',fileHash:p.fileHash,communityName:'Example',periodKey:period,atlasField:'scheduled_charges',importedValue:0,currentState:true},{id:'other-current',reportType:'approved_accounting',fileHash:'newer-source',communityName:'Example',periodKey:period,atlasField:'actual_charges',importedValue:99,currentState:true},history];
 const month={scheduledCharges:0,rentRollTotal:0,actualCharges:99,economicOccupancyPct:88,manualNote:'retained',metricProvenance:{scheduled_charges:{source:p.fileHash,field:'scheduled_charges'},rent_roll_total:{source:p.fileHash,field:'scheduled_charges'},actual_charges:{source:'newer-source',field:'actual_charges'}}};
 c.savedData={Example:{monthlyHistoryByPeriod:{[period]:structuredClone(month)},monthlyData:Array.from({length:12},(_,i)=>i===6?structuredClone(month):{})}};
 c.dataImport2State.closedPeriods=['2024-04'];
 return {...f,p,archive,period,old,other,outside,history};
}
async function assertCorrection(overlay=""){
 const {c,calls,archive,period,old,other,outside,history}=correctionFixture(overlay),beforeOld=structuredClone(old),beforeOthers=plain([other,outside,history]);
 await c.reprocessDataImportBoxScore(archive.id);assert.equal(calls.shared,1,JSON.stringify(calls.alerts));
 assert.equal(c.dataImport2State.canonicalRecords.some(r=>r.key===old.key),false);assert.deepEqual(plain([c.dataImport2State.canonicalRecords.find(r=>r.key===other.key),c.dataImport2State.canonicalRecords.find(r=>r.key===outside.key),c.dataImport2State.lineage.find(r=>r.id===history.id)]),beforeOthers);
 for(const month of [c.savedData.Example.monthlyHistoryByPeriod[period],c.savedData.Example.monthlyData[6]]){assert.equal(month.scheduledCharges,null);assert.equal(month.rentRollTotal,null);assert.equal(month.actualCharges,99);assert.equal(month.economicOccupancyPct,88);assert.equal(month.manualNote,'retained');assert.equal(Object.hasOwn(month,'grossPotentialRent'),false);assert.equal(Object.hasOwn(month.metricProvenance,'scheduled_charges'),false);assert.equal(month.metricProvenance.actual_charges.source,'newer-source');}
 const audit=c.dataImport2State.reconciliationLog.find(r=>r.action==='rent_roll_reporting_period_supersession');assert.deepEqual(plain(audit.supersededCanonicalRecords),[beforeOld]);assert.equal(audit.priorLineage.find(r=>r.id==='owned').currentState,true);assert(audit.metricChanges.every(r=>r.hadValue&&r.before===0&&r.after===null));assert.equal(audit.actor,'authorized-actor');assert.equal(c.dataImport2State.lineage.find(r=>r.id==='owned').currentState,false);assert.equal(c.dataImport2State.lineage.find(r=>r.id==='owned').supersededBy,audit.id);assert.equal(c.dataImport2State.lineage.find(r=>r.id==='other-current').currentState,true);
 const savedAudit=JSON.stringify(audit);await c.reprocessDataImportBoxScore(archive.id);assert.equal(calls.shared,2);assert.equal(c.dataImport2State.reconciliationLog.filter(r=>r.action==='rent_roll_reporting_period_supersession').length,1);assert.equal(JSON.stringify(c.dataImport2State.reconciliationLog.find(r=>r.id===audit.id)),savedAudit);assert.equal(c.dataImport2State.sourceArchive.length,1);
}
test('wrong-period source facts retire into reversible evidence and only proven owned metrics become unavailable',()=>assertCorrection());
test('retained host retires the same wrong-period facts without changing other source effects',async()=>{
 const {patchOccupancyImportBoundary}=await import('./occupancy-compat-boundary.mjs'),root=__dirname+'/../docs/portfolio-operations-dashboard/';
 const patched=patchOccupancyImportBoundary(fs.readFileSync(__dirname+'/fixtures/occupancy-retained-import-boundary.js','utf8'),fs.readFileSync(root+'workspace-core.js','utf8'),fs.readFileSync(root+'features/import-workspace.js','utf8'));
 await assertCorrection(patched);
});
test('owned charge-input retirement invalidates stale economic cache without substituting another ratio',async()=>{
 for(const priorCachedPercent of [0,50,55]){
  const {c,calls,archive,period,p}=correctionFixture();c.getCommunityCommandEconomicOccupancyData=()=>{throw Error('Correction must not choose another economic occupancy definition');};
  Object.assign(c.dataImport2State.lineage.find(r=>r.id==='other-current'),{reportType:'rent_roll',fileHash:p.fileHash,importedValue:1000});c.dataImport2State.lineage.push({id:'owned-gpr',reportType:'rent_roll',fileHash:p.fileHash,communityName:'Example',periodKey:period,atlasField:'gross_potential_rent',importedValue:2000,currentState:true});
  for(const month of [c.savedData.Example.monthlyHistoryByPeriod[period],c.savedData.Example.monthlyData[6]])Object.assign(month,{actualCharges:1000,grossPotentialRent:2000,economicOccupancyPct:priorCachedPercent,metricProvenance:{...month.metricProvenance,actual_charges:{source:p.fileHash,field:'actual_charges'},gross_potential_rent:{source:p.fileHash,field:'gross_potential_rent'}}});
  await c.reprocessDataImportBoxScore(archive.id);assert.equal(calls.shared,1,JSON.stringify(calls.alerts));const month=c.savedData.Example.monthlyHistoryByPeriod[period];assert.equal(month.actualCharges,null);assert.equal(month.grossPotentialRent,null);assert.equal(month.economicOccupancyPct,null);const audit=c.dataImport2State.reconciliationLog.find(r=>r.action==='rent_roll_reporting_period_supersession');assert(audit.metricChanges.some(r=>r.field==='economicOccupancyPct'&&r.before===priorCachedPercent&&r.after===null&&r.derivation.basis==='source_inputs_superseded'));
 }
});
test('future-year correction changes period history without touching current calendar-year monthlyData',async()=>{
 const {c,calls,archive,period}=correctionFixture(),future=(new Date().getFullYear()+1)+'-07';for(const row of c.dataImport2State.canonicalRecords)if(row.key==='old-period-key')row.periodKey=future;for(const row of c.dataImport2State.lineage)if(row.periodKey===period)row.periodKey=future;
 c.savedData.Example.monthlyHistoryByPeriod[future]=c.savedData.Example.monthlyHistoryByPeriod[period];delete c.savedData.Example.monthlyHistoryByPeriod[period];const beforeLive=JSON.stringify(c.savedData.Example.monthlyData);
 await c.reprocessDataImportBoxScore(archive.id);assert.equal(calls.shared,1,JSON.stringify(calls.alerts));assert.equal(c.savedData.Example.monthlyHistoryByPeriod[future].scheduledCharges,null);assert.equal(JSON.stringify(c.savedData.Example.monthlyData),beforeLive);
});
test('closed periods, changed/manual ownership and incomplete corrected-source coverage abort the whole replay',async()=>{
 for(const failure of ['closed','manual','mixed','missing_provenance','missing_source_row','unsigned','persistence']){
  const {c,calls,archive,period}=correctionFixture();
  if(failure==='closed')c.dataImport2State.closedPeriods.push(period);
  if(failure==='manual')c.savedData.Example.monthlyHistoryByPeriod[period].scheduledCharges=17;
  if(failure==='mixed')c.dataImport2State.lineage.push({id:'conflict',reportType:'approved_accounting',fileHash:'another',communityName:'Example',periodKey:period,atlasField:'scheduled_charges',currentState:true,importedValue:0});
  if(failure==='missing_provenance')delete c.savedData.Example.monthlyHistoryByPeriod[period].metricProvenance.scheduled_charges;
  if(failure==='missing_source_row')c.dataImport2State.canonicalRecords[0].sourceRow=888;
  if(failure==='unsigned')c.window.ATLAS_CENTRAL.getSession=()=>null;
  if(failure==='persistence')c.persistDataImportPublication=async()=>{throw Error('Synthetic persistence failure');};
  const before=JSON.stringify({saved:c.savedData,imports:c.dataImport2State});await c.reprocessDataImportBoxScore(archive.id);
  assert.equal(calls.shared,0,failure);assert.equal(JSON.stringify({saved:c.savedData,imports:c.dataImport2State}),before,failure+' must preserve the complete earlier state');assert.match(calls.alerts.at(-1),/Source recovery stopped/);
 }
});
test('supplied portfolio rent roll retains its declared month across future lease dates and exact Doro pipeline',{skip:!process.env.ATLAS_OCCUPANCY_SOURCE_DIR},async()=>{
 const c=context(),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js'),file=process.env.ATLAS_OCCUPANCY_SOURCE_DIR+'/03 - RISE - Rent Roll (3).xlsx',bytes=fs.readFileSync(file),hash=crypto.createHash('sha256').update(bytes).digest('hex'),book=XLSX.read(bytes,{type:'buffer',cellDates:true,raw:false});
 const {parseOccupancySheet}=await import('../docs/portfolio-operations-dashboard/features/occupancy-source-evidence.mjs');let datedOutside=0;
 for(const name of book.SheetNames.filter(n=>n!=='Report Parameters')){
  const raw=XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:null,raw:true,range:0}),e=parseOccupancySheet({rows:raw,reportType:'rent_roll',sourceSheet:name,fileHash:hash,sourceFile:'Rent Roll',metadata:{dataAsOf:'2026-09-28T14:03:00Z'}});assert.equal(e.period,'2026-09',name);
  const rows=XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',raw:false}),header=rows.findIndex(r=>r.includes('Lease End')&&r.includes('Bldg-Unit'));if(header<0)continue;const col=rows[header].indexOf('Lease End');
  for(const row of rows.slice(header+1)){const value=String(row[col]??'').trim(),date=new Date(value);if(!Number.isFinite(date.getTime())||date.getFullYear()<1991)continue;const mapped={lease_end:value},before=JSON.stringify(mapped);assert.equal(c.dataImportRowPeriod(mapped,{sourceSheet:name},plan()).periodKey,'2026-09');assert.equal(JSON.stringify(mapped),before);if(date.getFullYear()!==2026||date.getMonth()!==8)datedOutside++;}
  if(name==='RISE Doro'){assert.equal(e.pipeline.signedVacantUnits,37);assert.equal(e.pipeline.undatedUnits,34);assert.deepEqual(e.pipeline.datedMoveIns,[{date:'2026-10-27',count:1},{date:'2026-12-01',count:2}]);}
 }
 assert.equal(datedOutside,3527,'Source counts corroborate the lease-end/report-month defect without exporting resident data');
});

test('clean exact-source replay resolves only date conflicts whose physical rows reached the correct month',async()=>{
 const {c,calls,archive}=correctionFixture();
 const issue={id:'legacy-conflict',type:'conflict',status:'Open',reportType:'rent_roll',batchId:archive.batchId,fileName:archive.fileName,communityName:'Example',title:'Source section is outside the selected period',detail:'Example row 8 belongs to 2027-07; it was held without changing that date or another month.'};
 const unrelated=[{...issue,id:'other-batch',batchId:'other'},{...issue,id:'other-file',fileName:'other.xlsx'},{...issue,id:'other-row',detail:issue.detail.replace('row 8','row 999')},{...issue,id:'other-conflict',title:'Conflicting value'},{...issue,id:'other-community',communityName:'Other'}];
 c.dataImport2State.exceptions=[issue,...unrelated];const originals=plain(unrelated);
 await c.reprocessDataImportBoxScore(archive.id);assert.equal(calls.shared,1,JSON.stringify(calls.alerts));
 assert.equal(issue.status,'Resolved');assert.equal(issue.resolutionEvidence.fileHash,archive.fileHash);assert.equal(issue.resolutionEvidence.reportingPeriod,'2026-09');assert.equal(issue.detail,'Example row 8 belongs to 2027-07; it was held without changing that date or another month.');assert.deepEqual(plain(unrelated),originals);assert.equal(archive.reprocessResult.periodCorrection.resolvedExceptions,1);
 const resolution=plain(issue);await c.reprocessDataImportBoxScore(archive.id);assert.deepEqual(plain(issue),resolution);assert.equal(archive.reprocessResult.periodCorrection.resolvedExceptions,0);
});
test('held or failed replay preserves the original date conflict',async()=>{
 for(const mode of ['held','publication']){
  const {c,calls,archive}=correctionFixture();const issue={id:'legacy-conflict',type:'conflict',status:'Open',reportType:'rent_roll',batchId:archive.batchId,fileName:archive.fileName,communityName:'Example',title:'Source section is outside the selected period',detail:'Example row 8 belongs to 2027-07; it was held without changing that date or another month.'};c.dataImport2State.exceptions=[issue];const before=plain(issue);
  if(mode==='held')c.dataImport2State.closedPeriods.push('2026-09');else c.persistDataImportPublication=async()=>{throw Error('publication failed');};
  await c.reprocessDataImportBoxScore(archive.id);assert.equal(calls.shared,0);assert.deepEqual(plain(c.dataImport2State.exceptions),[before]);
 }
});

function structuredReader(){
 const c=context(),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
 Object.assign(c,{XLSX,window:{}});
 vm.runInContext(source.match(/^const DATA_IMPORT_FIELD_ALIASES = \{[\s\S]*?^\};/m)[0],c);
 // This test exercises the generic row reader; the separate aggregate parser
 // is covered by the real-file occupancy tests and must not alter row counts.
 const reader=source.match(/^async function dataImportReadStructuredRows\([^\n]*\) \{[\s\S]*?^\}/m)[0];
 vm.runInContext(reader.replace(/\(await import\("\.\/features\/occupancy-source-evidence\.mjs\?v=[^"]+"\)\)\.parseOccupancySheet/,'(() => null)'),c);
 return {c,XLSX};
}
test('rent-roll empty-section notices are excluded without dropping real values or other report types',async()=>{
 const {c,XLSX}=structuredReader(),book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
  ['Bldg-Unit','Resident','Actual Charges'],
  ['Selected report filters returned no data','',''],
  ['selected report filters returned no data','Selected report filters returned no data',''],
  ['synthetic-unit','Synthetic resident',0],
  ['Selected report filters returned no data','Synthetic resident',1]
 ]),'Example');
 const file=new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'source.xlsx');
 const rent=await c.dataImportReadStructuredRows(file,{reportType:'rent_roll'});
 assert.deepEqual(plain(rent[0].rows.map(row=>row.sourceRow)),[4,5]);
 const other=await c.dataImportReadStructuredRows(file,{reportType:'other'});assert.equal(other[0].rows.length,4);
});
test('supplied rent roll has no Sutton Place records behind its empty-section notice',{skip:!process.env.ATLAS_OCCUPANCY_SOURCE_DIR},async()=>{
 const {c}=structuredReader(),file=new File([fs.readFileSync(process.env.ATLAS_OCCUPANCY_SOURCE_DIR+'/03 - RISE - Rent Roll (3).xlsx')],'source.xlsx');
 const sheets=await c.dataImportReadStructuredRows(file,{reportType:'rent_roll'});
 assert.equal(sheets.length,13);assert.equal(sheets.some(sheet=>sheet.sheetName==='RISE Sutton Place'),false);
 assert.equal(sheets.reduce((sum,sheet)=>sum+sheet.rows.length,0),4741,'Three retained empty-section notices are not rent-roll facts');
});
