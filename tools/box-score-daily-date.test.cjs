const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const core=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const root=__dirname+'/../docs/portfolio-operations-dashboard/';
const XLSX=require(root+'assets/xlsx.full.min.js');
const plain=x=>JSON.parse(JSON.stringify(x));
function context(){
 const c=vm.createContext({Date,Map,Set,File,Blob,console,Intl,crypto:crypto.webcrypto});
 for(const fn of core.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm))vm.runInContext(fn[0],c);
 Object.assign(c,{XLSX,window:{AtlasApplicationSources:require(root+'application-source-bridge.js'),AtlasLeadSources:require(root+'lead-source-contract.js'),AtlasBoxScoreFloorPlans:require(root+'box-score-floor-plans.js')},refreshDataImportSharedLeadMappings:async()=>{},dataImportFindSavedRuleForHeader:()=>null});
 return c;
}
const rows=[['02 - RISE - Box Score'],['RISE Bartram Park'],['Availability (As of 10/19/2026)'],['Unit Type','Units','Rentable Units','Occupied','Vacant','Available','Occupied No Notice','Notice Rented','Notice Unrented','Vacant Rented','Availability / Leased Units'],['A',297,297,273,24,28,258,3,12,8,281],['Total:',297,297,273,24,28,258,3,12,8,281],['Property Pulse (10/01/2026 - 10/31/2026)'],['Unit Type','Move-Ins','Move-Outs','Renewals'],['Total:',6,10,1],['Make Ready (As of 10/31/2026)']];
function fileForRows(input=rows){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(input),'02 - RISE - Box Score');return new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'Box Score.xlsx');}
test('daily date follows Availability while activity and Make Ready section dates remain intact',async()=>{
 const c=context(),before=JSON.stringify(rows),file=fileForRows(),parsed=await c.parseDailyBoxScoreFile(file);
 assert.equal(parsed.snapshot.reportDateIso,'2026-10-19');assert.equal(parsed.availabilityDateIso,'2026-10-19');
 assert.equal(parsed.snapshot.reportDateLabel,'October 19, 2026');assert.equal(parsed.snapshot.occupiedUnits,273);assert.equal(parsed.snapshot.rentableUnits,297);assert.equal(parsed.snapshot.leasedUnits,281);assert.equal(parsed.snapshot.availableUnits,28);
 assert.equal(JSON.stringify(rows),before);assert.equal(c.buildDlrDateInputValue(c.pickDailyBoxScoreReportDate(rows,'2026-11-30 later filename.xlsx')),'2026-10-19');
 const sections=c.window.AtlasApplicationSources.boxScore(rows);assert.equal(sections[0].period.asOf,'2026-10-19');assert.equal(sections[1].period.start,'2026-10-01');assert.equal(sections[1].period.end,'2026-10-31');
});
test('repeated Availability headings agree, conflicting or impossible dates fail closed, legacy format remains supported',()=>{
 const c=context();assert.equal(c.buildDlrDateInputValue(c.pickDailyBoxScoreReportDate([...rows,['Availability (As of 10/19/2026)']])),'2026-10-19');
 assert.throws(()=>c.pickDailyBoxScoreReportDate([...rows,['Availability (As of 10/18/2026)']]),/conflicting Availability/);
 for(const invalid of ['02/30/2026','missing'])assert.throws(()=>c.pickDailyBoxScoreReportDate([['Availability (As of '+invalid+')'],['Make Ready 10/31/2026']]),/Availability date/);
 assert.equal(c.buildDlrDateInputValue(c.pickDailyBoxScoreReportDate([['Daily Report 10/19/2026']])),'2026-10-19');
});
test('two-digit Availability years retain established century semantics and strict validation',async()=>{
 const c=context();
 for(const [raw,expected] of [['10/19/26','2026-10-19'],['10.19.26','2026-10-19'],['10-19-26','2026-10-19'],['10/19/026','2026-10-19'],['12/31/49','2049-12-31'],['01/01/50','1950-01-01'],['02/29/24','2024-02-29']]){
  const input=[['Availability (As of '+raw+')'],['Make Ready (As of 10/31/2026)']];
  assert.equal(c.buildDlrDateInputValue(c.pickDailyBoxScoreReportDate(input)),expected);
  assert.equal(c.pickDailyBoxScoreReportDate(input).getTime(),c.extractDatesFromText(raw)[0].getTime());
 }
 assert.equal(c.buildDlrDateInputValue(c.pickDailyBoxScoreReportDate([['Availability (As of 10/19/26)'],['Availability (As of 10/19/2026)']])),'2026-10-19');
 assert.throws(()=>c.pickDailyBoxScoreReportDate([['Availability (As of 02/29/25)']]),/Availability date/);
 assert.throws(()=>c.pickDailyBoxScoreReportDate([['Availability (As of 10/19/26)'],['Availability (As of 10/20/2026)']]),/conflicting Availability/);
 const twoDigitRows=rows.map(row=>row.map(value=>String(value).replace('Availability (As of 10/19/2026)','Availability (As of 10/19/26)')));
 const parsed=await c.parseDailyBoxScoreFile(fileForRows(twoDigitRows));assert.equal(parsed.snapshot.reportDateIso,'2026-10-19');assert.equal(parsed.availabilityDateIso,'2026-10-19');assert.equal(parsed.snapshot.occupiedUnits,273);
});
async function fixture(){
 const c=context(),file=fileForRows(),snapshot=(await c.parseDailyBoxScoreFile(file)).snapshot,hash=await c.dataImportFileHash(file);
 const entry={id:'approved-source',batchId:'retained-batch',reportType:'box_score',fileName:file.name,fileHash:hash,communities:['Bartram Park'],importStatus:'Approved',reprocessResult:{prior:'preserve'}};
 const summary={reportDateIso:'2026-10-31',reportDateLabel:'October 31, 2026',reportPeriodLabel:'October 31, 2026',manualNote:'retain',dailyBoxScore:{...plain(snapshot),reportDateIso:'2026-10-31',reportDateLabel:'October 31, 2026'}};
 const saved={ 'Bartram Park':{latestDlrSummary:summary,monthlyHistoryByPeriod:{'2026-10':{metricProvenance:{occupiedSnapshot:{source:hash}},physicalSnapshotHistory:{'2026-10-19':{occupiedSnapshot:273}}}},boxScoreHistory:[{period:{start:'2026-10-01',end:'2026-10-31'}}]},Other:{untouched:true}};
 const imports={sourceArchive:[entry],batches:[{id:'retained-batch',beforeSnapshot:{full:'preserve'}}],reconciliationLog:[],closedPeriods:[]},calls={publish:0,restore:0,cleanup:0,retained:0,alerts:[]};let current=true;
 Object.assign(c,{savedData:saved,dataImport2State:imports,dataImportApprovalInProgress:false,dataImportApprovalPreflight:false,DATA_IMPORT_FILE_ARCHIVE_PREFIX:'source:',dataImportCanManageArchitecture:()=>true,atlasAccessDecision:()=>({ok:true}),ensureDataImportFullState:async()=>{},atlasStateGetValue:async()=>({blob:file,fileName:file.name}),dataImportBuildFilePlan:async()=>({fileHash:hash,communities:['Bartram Park']}),dataImportIsActiveReportingCommunity:()=>true,dataImportCommunitySupportsReport:()=>true,dataImportMakeId:()=> 'audit-id',loadPropertyData:()=>{},getProp:()=>({name:'Bartram Park'}),renderTab:()=>{},alert:message=>calls.alerts.push(message)});
 c.window.ATLAS_CENTRAL={getSession:()=>({user:{id:'current-authorized-actor'}})};
 c.dataImportCreateReplayCheckpoint=async()=>{
  const before={saved:plain(c.savedData),imports:plain(c.dataImport2State)};
  const check=()=>{if(!current)throw Error('Workspace changed');};
  return {name:'checkpoint',assertCurrent:check,mayRender:()=>current,retain:()=>calls.retained++,restore:async()=>{check();calls.restore++;c.savedData=before.saved;c.dataImport2State=before.imports;},committed:async()=>{calls.cleanup++;}};
 };
 c.persistDataImportPublication=async checkpoint=>{checkpoint.assertCurrent();calls.publish++;};
 return {c,file,entry,snapshot,hash,calls,stale:()=>{current=false;}};
}
test('supported archive correction changes only owned date fields, preserves all history and publishes once',async()=>{
 const {c,entry,calls}=await fixture(),before=plain(c.savedData),beforeImports=plain(c.dataImport2State);
 await c.correctDataImportBoxScoreDailyDate(entry.id);assert.equal(calls.publish,1,calls.alerts.join('\n'));assert.equal(calls.restore,0);assert.equal(calls.cleanup,1);
 const expected=structuredClone(before),summary=expected['Bartram Park'].latestDlrSummary;for(const obj of [summary,summary.dailyBoxScore]){obj.reportDateIso='2026-10-19';obj.reportDateLabel='October 19, 2026';}summary.reportPeriodLabel='October 19, 2026';
 assert.deepEqual(plain(c.savedData),expected);assert.deepEqual(plain(c.dataImport2State.batches),beforeImports.batches);assert.equal(c.dataImport2State.sourceArchive.length,1);assert.equal(entry.fileHash,beforeImports.sourceArchive[0].fileHash);assert.deepEqual(plain(entry.reprocessResult),{prior:'preserve'});assert.equal(c.dataImport2State.reconciliationLog.length,1);assert.equal(entry.dailyReportDateCorrection.changes.length,5);
 const once=JSON.stringify(c.dataImport2State);await c.correctDataImportBoxScoreDailyDate(entry.id);assert.equal(calls.publish,1);assert.equal(JSON.stringify(c.dataImport2State),once,'Repeated correction adds no source or audit');
});
test('independent summary date and period labels are retained',async()=>{
 const {c,entry,calls}=await fixture();const summary=c.savedData['Bartram Park'].latestDlrSummary;summary.reportDateIso='2026-10-20';summary.reportDateLabel='Manual date';summary.reportPeriodLabel='Custom period';
 await c.correctDataImportBoxScoreDailyDate(entry.id);assert.equal(calls.publish,1);assert.equal(summary.dailyBoxScore.reportDateIso,'2026-10-19');assert.equal(summary.reportDateIso,'2026-10-20');assert.equal(summary.reportDateLabel,'Manual date');assert.equal(summary.reportPeriodLabel,'Custom period');
});
test('source mismatch, missing/changed ownership, closed periods, ambiguity and unauthorized scope do not change facts',async()=>{
 for(const mode of ['hash','owner','metric','closed','ambiguous','inactive','scope','noavailability','publication']){
  const {c,entry,calls}=await fixture();
  if(mode==='hash')c.atlasStateGetValue=async()=>({blob:new Blob(['tampered']),fileName:entry.fileName});
  if(mode==='owner')c.savedData['Bartram Park'].monthlyHistoryByPeriod['2026-10'].metricProvenance.occupiedSnapshot.source='newer-source';
  if(mode==='metric')c.savedData['Bartram Park'].latestDlrSummary.dailyBoxScore.occupiedUnits=274;
  if(mode==='closed')c.dataImport2State.closedPeriods=['2026-10'];
  if(mode==='ambiguous')c.dataImportBuildFilePlan=async()=>({fileHash:entry.fileHash,communities:['Bartram Park','Other']});
  if(mode==='inactive')c.dataImportIsActiveReportingCommunity=()=>false;
  if(mode==='scope')c.dataImportCommunitySupportsReport=()=>false;
  if(mode==='noavailability'){const parser=c.parseDailyBoxScoreFile;c.parseDailyBoxScoreFile=async f=>({...await parser(f),availabilityDateIso:''});}
  if(mode==='publication')c.persistDataImportPublication=async()=>{throw Error('Atomic publication failure');};
  const before=JSON.stringify({saved:c.savedData,imports:c.dataImport2State});await c.correctDataImportBoxScoreDailyDate(entry.id);assert.equal(calls.publish,0,mode);assert.equal(JSON.stringify({saved:c.savedData,imports:c.dataImport2State}),before,mode);assert.equal(calls.restore,1,mode);
 }
});
test('workspace changes after parsing never mutate or restore another workspace',async()=>{
 const {c,entry,calls,stale}=await fixture(),parse=c.parseDailyBoxScoreFile,other={differentWorkspace:true};c.parseDailyBoxScoreFile=async file=>{const result=await parse(file);stale();c.savedData=other;return result;};await c.correctDataImportBoxScoreDailyDate(entry.id);assert.equal(c.savedData,other);assert.equal(calls.publish,0);assert.equal(calls.restore,0);assert.equal(calls.retained,1);
});
test('Source Archive limits date correction to approved managed Box Scores and receipts to supported approved sources',()=>{
 const ui=fs.readFileSync(root+'features/import-workspace.js','utf8');assert.match(ui,/entry\.reportType === "box_score" && entry\.importStatus === "Approved" && dataImportCanManageArchitecture\(\)[\s\S]*?correctDataImportBoxScoreDailyDate/);assert.match(ui,/\["rent_roll","trending_occupancy","box_score","marketing_iq"\]\.includes\(entry.reportType\)[\s\S]*?inspectDataImportReplayReceipt/);
 const entry={id:'source',communities:[]},renderer=ui.match(/^function renderDataImportArchiveView\([^\n]*\) \{[\s\S]*?^\}/m)[0],c=vm.createContext({window:{},dataImportHistoryDisplay:()=>({rows:[entry],controls:''}),dataImportCanManageArchitecture:()=>true,escapeHtml:x=>String(x??''),dataImportFormatBytes:()=>'',dataImportFormatTimestamp:()=>'',dataImportReportLabel:()=>'',dataImportStatusClass:()=>''});
 vm.runInContext(renderer,c);
 for(const reportType of ['box_score','rent_roll','trending_occupancy','marketing_iq','delinquency','leasing_resident_data','renewal_tracker','unknown'])for(const importStatus of ['Approved','Held','Rejected','Draft'])for(const managed of [true,false]){
  Object.assign(entry,{reportType,importStatus});c.dataImportCanManageArchitecture=()=>managed;const html=c.renderDataImportArchiveView(),label=reportType+' '+importStatus+' '+managed,approved=managed&&importStatus==='Approved';
  assert.equal(html.includes('correctDataImportBoxScoreDailyDate'),approved&&reportType==='box_score',label+' correction');
  assert.equal(html.includes('Inspect replay receipt'),approved&&['rent_roll','trending_occupancy','box_score','marketing_iq'].includes(reportType),label+' receipt');
 }
 const checkpoint=core.match(/^async function dataImportCreateReplayCheckpoint\([^\n]*\) \{[\s\S]*?^\}/m)[0];assert.match(checkpoint,/dailyReportDateCorrection:entry\.dailyReportDateCorrection/);
});
test('provided October19 workbook retains every section date and all numeric daily values',{skip:!process.env.ATLAS_BOX_DATE_SOURCE},async()=>{
 const c=context(),file=new File([fs.readFileSync(process.env.ATLAS_BOX_DATE_SOURCE)],'2026-10-19_02-RISE-Box-Score.xlsx'),parsed=await c.parseDailyBoxScoreFile(file);
 assert.equal(parsed.availabilityDateIso,'2026-10-19');assert.equal(parsed.snapshot.reportDateIso,'2026-10-19');assert.deepEqual([parsed.snapshot.occupiedUnits,parsed.snapshot.rentableUnits,parsed.snapshot.leasedUnits,parsed.snapshot.availableUnits],[273,297,281,28]);
 const book=XLSX.read(await file.arrayBuffer(),{type:'array'}),input=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:'',raw:false}),sections=c.window.AtlasApplicationSources.boxScore(input);assert.equal(sections.length,4);assert.equal(sections[0].period.asOf,'2026-10-19');for(const section of sections.slice(1))assert.deepEqual(plain(section.period),{start:'2026-10-01',end:'2026-10-31',asOf:''});
 assert(input.flat().some(v=>/Make Ready.*10\/31\/2026/i.test(v)));
 if(process.env.ATLAS_BOX_DATE_READBACK){const live=JSON.parse(fs.readFileSync(process.env.ATLAS_BOX_DATE_READBACK)).indexedDb.communityData['Bartram Park'].latestDlrSummary.dailyBoxScore;for(const key of Object.keys(c.defaultDlrBoxScoreSnapshot()).filter(k=>!['sourceFileName','importedAt','reportDateIso','reportDateLabel'].includes(k)))assert.equal(parsed.snapshot[key],live[key],key);}
});
