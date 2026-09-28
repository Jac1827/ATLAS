import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {parseOccupancySheet,readOccupancySourceEvidence} from '../docs/portfolio-operations-dashboard/features/occupancy-source-evidence.mjs';
const require=createRequire(import.meta.url),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const metadata={dataAsOf:'2026-09-28T13:00:00Z'},scope={communityId:'authorized-id',communityName:'Test Community',period:'2026-09',asOf:'2026-09-28'};
function box(){return [[],['Box Score'],['Test Community'],['09/01/2026 - 09/30/2026'],[],['Availability (As of 09/28/2026)'],['Unit Type','Units','Rentable Units','Excluded','Occupied','Occupied','Vacant Rented','Availability: Leased Units','Availability: Total Effective Rent','Availability: Total Budgeted Rent'],['A',100,98,2,40,.4081632653,10,50,75000.125,100000],['Total:',100,98,2,40,.4081632653,10,50,75000.125,100000]];}
function aging(){return [[],['Resident Aged Receivables'],['Test Community'],['Sep 2026'],[],['Bldg-Unit','Resident','Lease Status','0-30 Days','31-60 Days','61-90 Days','90+ Days','Pre-payments','Balance'],['PII-1','Private Resident','Current',999,100,20,5,500,624],['','','Test Community Total:',999,100,20,5,500,624]];}
function rent(){return [[],['Rent Roll'],['Test Community'],['Sep 2026'],[],['Unit Details'],['Bldg-Unit','Resident','Unit Status','Move-In','Lease Start','Expected Move-Out'],['A','Private A','Occupied No Notice','01/01/2026','01/01/2026',''],['B','Private B','Vacant Rented Ready','','',''],['C','Private C','Vacant Rented Ready','','',''],['','Test Community Total:'],[],['Future Resident Details'],['Bldg-Unit','Resident','Unit Status','Move-In','Lease Start'],['B','Private B','Vacant Rented Ready','10/20/2026','10/20/2026'],['A','Private A','Occupied No Notice','10/10/2026','10/10/2026'],['','Test Community Total:']];}
const parse=(rows,type,fileHash='hash')=>parseOccupancySheet({rows,reportType:type,sourceSheet:'Test Community',sourceFile:type+'.xlsx',fileHash,metadata});
function state(){const b=parse(box(),'box_score'),a=parse(aging(),'delinquency'),r=parse(rent(),'rent_roll');const record=(type,section,values,evidence)=>({communityName:scope.communityName,reportType:type,section,sectionPeriod:section==='Availability'?{asOf:'2026-09-28'}:undefined,values,occupancyEvidence:evidence,periodKey:scope.period,fileHash:type+'hash',dataAsOf:metadata.dataAsOf,sourceFile:type+'.xlsx',downstreamEligible:true,batchId:'batch'});b.sourceFingerprint='box_scorehash';a.sourceFingerprint='delinquencyhash';r.sourceFingerprint='rent_rollhash';return {sourceArchive:['box_score','delinquency','rent_roll'].map(reportType=>({reportType,fileHash:reportType+'hash',batchId:'batch',importStatus:'Approved'})),canonicalRecords:[record('box_score','Availability',{total_units:100,rentable_units:98,occupied_units:40,source_leased_units:50,vacant_rented:10,measurement_basis:'units'},b),record('box_score','Lead Conversions',{applications:20,leases_completed:8}),record('delinquency','aged receivables',{},a),record('rent_roll','unit detail',{},r)]};}
test('named source controls preserve precision, count/rate distinction and missing versus zero',()=>{
 const data=parse(box(),'box_score');assert.equal(data.snapshot.leasedUnits,50);assert.equal(data.snapshot.measurementBasis,'units');assert.equal(data.snapshot.leasedPercent,50/98*100);assert.equal(data.snapshot.totalEffectiveRent,75000.125);
 const blank=box();blank.at(-1)[9]=null;assert.equal(parse(blank,'box_score').snapshot.totalBudgetedRent,null);
 const zero=box();zero.at(-1)[4]=0;zero.at(-1)[6]=0;zero.at(-1)[7]=0;assert.equal(parse(zero,'box_score').snapshot.leasedUnits,0);assert.equal(parse(zero,'box_score').snapshot.status,'valid');
 const invalid=box();invalid.at(-1)[7]=99;assert.equal(parse(invalid,'box_score').snapshot.status,'unavailable');
 const mismatch=box();mismatch[2]=['Other Community'];assert.equal(parse(mismatch,'box_score').status,'unavailable');
 const empty=[[],['Box Score'],['Test Community'],['09/01/2026 - 09/30/2026'],['Selected report filters returned no data']];assert.equal(parse(empty,'box_score').status,'unavailable');
});
test('older aging only and signed values preserved; cash collections never inferred',()=>{
 const a=parse(aging(),'delinquency');assert.equal(a.aging.above30,125);assert.equal(a.aging.controls.days0to30Excluded.value,999);
 const source=state(),before=JSON.stringify(source),result=readOccupancySourceEvidence({...scope,importState:source});
 assert.equal(result.economic.percent,(75000.125-125)/100000*100);assert.equal(result.economic.actualCashCollected,null);assert.match(result.economic.label,/estimate/i);assert.equal(JSON.stringify(source),before);
 const missing=aging();missing.at(-1)[5]=null;assert.equal(parse(missing,'delinquency').aging.above30,null);
});
test('PII-free future pipeline counts unique current vacant-rented units and keeps unknown dates',()=>{
 const result=parse(rent(),'rent_roll');assert.deepEqual(result.pipeline.datedMoveIns,[{date:'2026-10-20',count:1}]);assert.equal(result.pipeline.signedVacantUnits,2);assert.equal(result.pipeline.undatedUnits,1);assert.equal(result.pipeline.complete,false);assert(!JSON.stringify(result).includes('Private'));assert(!JSON.stringify(result).includes('PII'));
 const missingIdentity=rent();missingIdentity[6][0]='Unmapped identity';assert.equal(parse(missingIdentity,'rent_roll').pipeline.status,'unavailable');
 const duplicate=rent();duplicate.splice(-1,0,['B','Private B','Vacant Rented Ready','11/01/2026','11/01/2026']);assert.equal(parse(duplicate,'rent_roll').pipeline.status,'unavailable');assert.deepEqual(parse(duplicate,'rent_roll').pipeline.datedMoveIns,[]);
});
test('latest approved same-period source selected without default conversion or previous source fallback',()=>{
 const s=state();let r=readOccupancySourceEvidence({...scope,importState:s});assert.equal(r.closing.rate,.4);assert.equal(r.snapshot.leasedUnits,50);assert.equal(r.pipeline.communityId,scope.communityId);assert.equal(r.movements.remainingMoveOuts,null);
 const latest={...s.canonicalRecords[1],fileHash:'newhash',dataAsOf:'2026-09-28T17:00:00Z',values:{applications:2,leases_completed:3}};s.sourceArchive.push({reportType:'box_score',fileHash:'newhash',importStatus:'Approved'});s.canonicalRecords.push(latest);
 r=readOccupancySourceEvidence({...scope,importState:s});assert.equal(r.closing.status,'unavailable');assert.equal(r.closing.rate,null);assert.equal(r.snapshot.status,'unavailable');
 latest.values={applications:0,leases_completed:0};assert.equal(readOccupancySourceEvidence({...scope,importState:s}).closing.rate,null);
 latest.values={applications:10,leases_completed:0};assert.equal(readOccupancySourceEvidence({...scope,importState:s}).closing.rate,0);
});
test('community, period, approval, source conflict and source-bound aggregate guards',()=>{
 const s=state();assert.equal(readOccupancySourceEvidence({...scope,communityName:'Unassigned',importState:s}).snapshot.status,'unavailable');assert.equal(readOccupancySourceEvidence({...scope,communityId:'',importState:s}).snapshot.status,'unavailable');assert.equal(readOccupancySourceEvidence({...scope,period:'2026-08',importState:s}).snapshot.status,'unavailable');
 const changed=structuredClone(s);changed.canonicalRecords[0].communityId='other-id';assert.equal(readOccupancySourceEvidence({...scope,importState:changed}).snapshot.status,'unavailable');
 const noApproval={...s,sourceArchive:[]};assert.equal(readOccupancySourceEvidence({...scope,importState:noApproval}).snapshot.status,'unavailable');
 const badEvidence=structuredClone(s);badEvidence.canonicalRecords[0].occupancyEvidence.sourceFingerprint='wrong';assert.equal(readOccupancySourceEvidence({...scope,importState:badEvidence}).snapshot.status,'unavailable');
 const badPeriod=structuredClone(s);badPeriod.canonicalRecords[2].periodKey='2026-08';assert.equal(readOccupancySourceEvidence({...scope,period:'',importState:badPeriod}).economic.value,null);
 const conflict=structuredClone(s);conflict.sourceArchive.push({reportType:'box_score',fileHash:'conflict',importStatus:'Approved'});conflict.canonicalRecords.push({...conflict.canonicalRecords[0],fileHash:'conflict'});assert.equal(readOccupancySourceEvidence({...scope,importState:conflict}).snapshot.status,'unavailable');
});
test('existing section-qualified imports work without new aggregate metadata; no fabricated economic value',()=>{
 const s=state();for(const r of s.canonicalRecords)delete r.occupancyEvidence;
 const r=readOccupancySourceEvidence({...scope,importState:s});assert.equal(r.snapshot.leasedUnits,50);assert.equal(r.closing.rate,.4);assert.equal(r.economic.value,null);assert.equal(r.pipeline.complete,false);
});
test('optional private supplied reports reproduce controls and all supplied economic targets',{skip:!process.env.ATLAS_OCCUPANCY_SOURCE_DIR},()=>{
 const dir=process.env.ATLAS_OCCUPANCY_SOURCE_DIR,files={box_score:'02 - RISE - Box Score (31).xlsx',rent_roll:'03 - RISE - Rent Roll (3).xlsx',delinquency:'04 - RISE - Delinquent and Prepaid Report (6).xlsx'};
 const books=Object.fromEntries(Object.entries(files).map(([type,file])=>[type,XLSX.read(fs.readFileSync(dir+'/'+file),{type:'buffer',cellDates:true})]));
 const targets={'Anthem House':93.2,'Ivy & Elm':81.5,'Pilots Pointe at LSUS':96.8,'Prosper On Fayette':96.5,'RISE 34th':93.1,'RISE Bartram Park':82.8,'RISE Baymeadows':76.8,'RISE Citrus Ridge Townhomes':66.9,'RISE Doro':29.4,'RISE Florence Villa Townhomes':89.8,'RISE Sereno':66.2,'RISE St. Augustine':7.4,'The Preserve at Tech':92.3};
 for(const [name,target] of Object.entries(targets)){
  const parsed=Object.fromEntries(Object.entries(books).map(([type,book])=>[type,parseOccupancySheet({rows:XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:null,raw:true,range:0}),reportType:type,sourceSheet:name,metadata,fileHash:type})]));
  const b=parsed.box_score.snapshot,a=parsed.delinquency.aging;assert.equal(b.status,'valid',name);assert.equal(a.status,'valid',name);assert.equal(Number(((b.totalEffectiveRent-a.above30)/b.totalBudgetedRent*100).toFixed(1)),target,name);
  if(name==='RISE Doro'){assert.equal(Number(b.leasedPercent.toFixed(2)),46.56);assert.deepEqual(parsed.rent_roll.pipeline.datedMoveIns,[{date:'2026-10-27',count:1},{date:'2026-12-01',count:2}]);assert.equal(parsed.rent_roll.pipeline.undatedUnits,34);}
 }
 for(const [type,book] of Object.entries(books)){assert.equal(parseOccupancySheet({rows:XLSX.utils.sheet_to_json(book.Sheets['RISE Sutton Place'],{header:1,defval:null,raw:true,range:0}),reportType:type,sourceSheet:'RISE Sutton Place',metadata}).status,'unavailable');}
});

test('actual structured import reader retains exact numeric source precision and safe report filters',async()=>{
 const source=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/workspace-core.js',import.meta.url),'utf8');
 const functionSource=source.match(/^async function dataImportReadStructuredRows\([^\n]*\) \{[\s\S]*?^\}/m)[0].replace(/import\((["'])\.\/features\/occupancy-source-evidence\.mjs(?:\?[^"']*)?\1\)/g,'import('+JSON.stringify(new URL('../docs/portfolio-operations-dashboard/features/occupancy-source-evidence.mjs',import.meta.url).href)+')');
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(box());sheet.J9.z='$#,##0.00';XLSX.utils.book_append_sheet(book,sheet,'Test Community');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Report Parameters'],['Lease Statuses','Current, Notice'],['Generated By','Private User']]),'Report Parameters');
 const buffer=XLSX.write(book,{type:'buffer',bookType:'xlsx'}),file={name:'Source.xlsx',arrayBuffer:async()=>buffer},plan={reportType:'box_score',name:file.name,fileHash:'hash',metadata};
 const win={AtlasApplicationSources:require('../docs/portfolio-operations-dashboard/application-source-bridge.js')};
 const read=Function('XLSX','window','dataImportGetFileExtension','dataImportIsMetadataSheetName',`${functionSource};return dataImportReadStructuredRows;`)(XLSX,win,()=>'.xlsx',n=>n==='Report Parameters');
 const result=await read(file,plan);assert.equal(result.length,1);assert.equal(plan.occupancyEvidenceBySheet['Test Community'].snapshot.totalEffectiveRent,75000.125);assert.deepEqual(plan.occupancyEvidenceBySheet['Test Community'].reportScope,[{label:'Lease Statuses',value:'Current, Notice'}]);assert(!JSON.stringify(plan.occupancyEvidenceBySheet).includes('Private User'));
});

test('existing scoped approval route attaches aggregate evidence once only after successful period and community checks',async()=>{
 const vm=await import('node:vm');const source=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/workspace-core.js',import.meta.url),'utf8');
 const c={console,Date,Map,Set,window:{},dataImportApprovalInProgress:false,dataImportApprovalProgress:{rowsDone:0},dataImport2State:{canonicalRecords:[],reconciliationLog:[]},planRows:[],MONTHS:[]};vm.createContext(c);
 for(const f of source.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm))vm.runInContext(f[0],c);
 const stored=[];Object.assign(c,{refreshDataImportSharedLeadMappings:async()=>{},dataImportReadStructuredRows:async()=>[{sheetName:'Test Community',rows:c.planRows}],dataImportNormalizeText:x=>String(x).toLowerCase(),dataImportBuildAliasLookup:()=>new Map(),dataImportBuildInternalCommunityLookup:()=>new Map(),dataImportEffectiveFreshness:()=>({action:'warn',days:999}),dataImportMapSourceRow:r=>({mapped:r.values,sourceFields:{},unmappedFields:[]}),dataImportResolveRowCommunity:r=>r.community_name,dataImportCommunitySupportsReport:()=>true,dataImportNumericValue:()=>null,dataImportRowPeriod:r=>({periodKey:r.period,monthIdx:8,year:2026}),dataImportPeriodConflict:(requested,p)=>requested.periodKey!==p.periodKey,dataImportCanonicalRecordKey:(plan,name,p,row,r)=>r.sourceRow,dataImportUpsertCanonicalRecord:r=>{stored.push(r);return {disposition:'inserted',record:r};},dataImportAddLineage(){},dataImportApplyGroupedSnapshot(){},atlasCaptureBoxScore(){},atlasCaptureBoxScoreFile:async()=>{},dataImportGetReportDef:()=>null,persistSaved(){},getProp:()=>({name:'none'}),dataImportRecordPlanLearningUsage(){}});
 const row=(i,name,period)=>({sourceRow:i,sourceSheet:'Test Community',values:{community_name:name,period}});c.planRows=[row(1,'Other','2026-09'),row(2,'Test Community','2026-08'),row(3,'Test Community','2026-09'),row(4,'Test Community','2026-09')];
 const evidence=parse(box(),'box_score'),plan={reportType:'box_score',name:'Test.xlsx',fileHash:'hash',metadata,selectedCommunities:['Test Community'],periodSelection:{requested:{periodKey:'2026-09'}},occupancyEvidenceBySheet:{'Test Community':evidence}};
 const result=await c.dataImportRouteStructuredFile({},plan,'batch');assert.equal(result.rowsHeld,2);assert.equal(stored.length,2);assert.equal(stored[0].occupancyEvidence,evidence);assert.equal(stored[1].occupancyEvidence,undefined);assert.equal(stored[0].periodKey,'2026-09');
});


test('legacy exposure-adjusted leased fallback cannot override source leased semantics',()=>{
 const s=state();for(const row of s.canonicalRecords)delete row.occupancyEvidence;
 const values=s.canonicalRecords[0].values;delete values.source_leased_units;values.leased_units=99;
 assert.equal(readOccupancySourceEvidence({...scope,importState:s}).snapshot.leasedUnits,50);
 delete values.vacant_rented;assert.equal(readOccupancySourceEvidence({...scope,importState:s}).snapshot.status,'unavailable');
 values.source_leased_units=50;assert.equal(readOccupancySourceEvidence({...scope,importState:s}).snapshot.leasedUnits,50);
 values.vacant_rented=9;assert.equal(readOccupancySourceEvidence({...scope,importState:s}).snapshot.status,'unavailable');
});


test('undated approved source and invalid cutoff cannot silently select a convenient older version',()=>{
 const s=state();const row={...s.canonicalRecords[1],fileHash:'undated',dataAsOf:'',values:{applications:20,leases_completed:4}};
 s.sourceArchive.push({reportType:'box_score',fileHash:'undated',importStatus:'Approved'});s.canonicalRecords.push(row);
 assert.equal(readOccupancySourceEvidence({...scope,importState:s}).closing.status,'unavailable');
 assert.equal(readOccupancySourceEvidence({...scope,asOf:'not-a-date',importState:state()}).snapshot.status,'unavailable');
});


test('rolled-back archive cannot regain approval through stale current lineage',()=>{
 const s=state();s.sourceArchive[0].importStatus='Rolled Back';s.lineage=[{currentState:true,communityName:scope.communityName,periodKey:scope.period,reportType:'box_score',fileHash:'box_scorehash'}];
 assert.equal(readOccupancySourceEvidence({...scope,importState:s}).snapshot.status,'unavailable');
});


test('source timestamps are normalized before date-bound planning comparisons',()=>{
 const s=state();for(const row of s.canonicalRecords)row.dataAsOf='09/28/2026 09:00 AM EDT';
 const r=readOccupancySourceEvidence({...scope,importState:s});assert.equal(r.snapshot.asOf,'2026-09-28');assert.equal(r.snapshot.sourceEffectiveAt,'2026-09-28T13:00:00.000Z');assert.equal(r.closing.asOf,r.snapshot.sourceEffectiveAt);
});


test('a newer approved but held source prevents silent fallback to an older report',()=>{
 const s=state();s.sourceArchive.push({reportType:'box_score',fileHash:'held',importStatus:'Approved'});
 s.canonicalRecords.push({...s.canonicalRecords[1],fileHash:'held',downstreamEligible:false,dataAsOf:'2026-09-28T17:00:00Z'});
 const result=readOccupancySourceEvidence({...scope,importState:s});assert.equal(result.snapshot.status,'unavailable');assert.equal(result.closing.status,'unavailable');assert.equal(result.closing.rate,null);
});


test('printed availability observation date is distinct from generated time; legacy missing date is not inferred',()=>{
 const s=state();s.canonicalRecords[0].occupancyEvidence.snapshot.asOf='2026-09-27';
 let r=readOccupancySourceEvidence({...scope,importState:s});assert.equal(r.snapshot.asOf,'2026-09-27');assert.equal(r.snapshot.sourceEffectiveAt,'2026-09-28T13:00:00.000Z');
 delete s.canonicalRecords[0].occupancyEvidence;s.canonicalRecords[0].sectionPeriod={asOf:'2026-09-26'};
 r=readOccupancySourceEvidence({...scope,importState:s});assert.equal(r.snapshot.asOf,'2026-09-26');
 delete s.canonicalRecords[0].sectionPeriod;assert.equal(readOccupancySourceEvidence({...scope,importState:s}).snapshot.status,'unavailable');
});


test('future printed observations are not accepted at an earlier cutoff; estimate periods stay aligned',()=>{
 const s=state();s.canonicalRecords[0].occupancyEvidence.snapshot.asOf='2026-09-30';
 assert.equal(readOccupancySourceEvidence({...scope,importState:s}).snapshot.status,'unavailable');
 assert.equal(readOccupancySourceEvidence({...scope,asOf:'2026-09-30',importState:s}).snapshot.status,'valid');
 s.canonicalRecords[0].occupancyEvidence.snapshot.asOf='2026-08-31';
 const r=readOccupancySourceEvidence({...scope,importState:s});assert.equal(r.snapshot.period,'2026-08');assert.equal(r.economic.value,null);
});
test('explicit canonical community ID controls renamed display labels; conflicting IDs never match by name',()=>{
 const s=state();for(const row of s.canonicalRecords)row.communityId=scope.communityId;
 const before=JSON.stringify(s),renamed={...scope,communityName:'Renamed Community',importState:s};
 assert.equal(readOccupancySourceEvidence(renamed).snapshot.leasedUnits,50);assert.equal(JSON.stringify(s),before);
 for(const row of s.canonicalRecords)row.communityId='other-id';assert.equal(readOccupancySourceEvidence({...scope,importState:s}).snapshot.status,'unavailable');
 const legacy=state();assert.equal(readOccupancySourceEvidence({...renamed,importState:legacy}).snapshot.status,'unavailable','An unbound name is not treated as an approved alias');
 for(const row of legacy.canonicalRecords)row.communityId=scope.communityId;legacy.sourceArchive=[];legacy.lineage=legacy.canonicalRecords.map(row=>({currentState:true,communityName:row.communityName,periodKey:row.periodKey,reportType:row.reportType,fileHash:row.fileHash}));
 assert.equal(readOccupancySourceEvidence({...renamed,importState:legacy}).snapshot.leasedUnits,50,'Same stored source name binds historical lineage to the explicit canonical record');
 for(const row of legacy.lineage)row.communityId='other-id';assert.equal(readOccupancySourceEvidence({...renamed,importState:legacy}).snapshot.status,'unavailable');
});
