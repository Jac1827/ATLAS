const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path'),root=path.join(__dirname,'../docs/portfolio-operations-dashboard');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const XLSX=require(process.env.ATLAS_XLSX||'xlsx'),bridge=require(path.join(root,'application-source-bridge.js'));
const c={console,Date,Map,Set,XLSX,window:{AtlasApplicationSources:bridge},DATA_IMPORT_MAX_SAMPLE_CHARS:180000,savedData:{},MONTHS:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']};vm.createContext(c);
for(const f of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm))vm.runInContext(f[0],c);
vm.runInContext(html.slice(html.indexOf('const DATA_IMPORT_FIELD_ALIASES ='),html.indexOf('const DATA_IMPORT_DESTINATION_GROUPS =')),c);
assert.equal(c.dataImportExtractMetadata({sampleText:'New Lead Created On | 08/07/2026',metadataText:'Resident Data 3.1 generated | 09/16/2026 12:20 PM EDT\ndata as of | 09/16/2026 12:20 PM EDT'}).dataAsOf,'2026-09-16T16:20:00.000Z');
c.buildPeriodKey=(m,y)=>`${y}-${String(m+1).padStart(2,'0')}`;
assert.equal(c.dataImportRowPeriod({application_date:'2025-01-01'},{},{reportType:'leasing_resident_data',reportingMonthIdx:8,reportingYear:2026}).periodKey,'2026-09');
// A corrected report timestamp must not make the identical archived source look stale.
Object.assign(c,{dataImport2State:{canonicalRecords:[{key:'k',fileHash:'same',dataAsOf:'',importedAt:'2026-09-16T19:00:00Z',values:{}}],closedPeriods:[],lineage:[]},dataImportRuntimeCanonicalIndex:null,dataImportRuntimeCurrentLineageIndex:null});
const replayResult=()=>({issues:[],rowsHeld:0,rowsUnchanged:0,rowsUpdated:0,duplicatesIgnored:0});
const replayRecord={key:'k',fileHash:'same',dataAsOf:'2026-09-16T15:00:00Z',importedAt:'2026-09-17T01:00:00Z',periodKey:'2026-09',values:{balance:35}};
assert.equal(c.dataImportUpsertCanonicalRecord(replayRecord,replayResult(),{reprocess:true}).disposition,'updated');
assert.equal(c.dataImportUpsertCanonicalRecord({...replayRecord,fileHash:'different',dataAsOf:'2026-09-15'},replayResult(),{reprocess:true}).disposition,'older');
c.dataImport2State.closedPeriods=['2026-09'];
assert.equal(c.dataImportUpsertCanonicalRecord(replayRecord,replayResult(),{reprocess:true}).disposition,'held');
c.dataImportGetReportDef=()=>({sourceRank:1});
c.dataImport2State.lineage=[{currentState:true,communityName:'Test',periodKey:'2026-09',atlasField:'balance',fileHash:'same',sourceRank:1,importedAt:'2026-09-16T19:00:00Z'}];
assert.equal(c.dataImportShouldApplyCurrentMetric({fileHash:'same',reprocessArchivedSource:true},'Test','2026-09','balance','2026-09-16T15:00:00Z',replayResult()),true);
assert.equal(c.dataImportShouldApplyCurrentMetric({fileHash:'different',reprocessArchivedSource:true},'Test','2026-09','balance','2026-09-16T15:00:00Z',replayResult()),false);
let month;
Object.assign(c,{normalizeSavedCommunityRecord:(n,r)=>r||{},getWritableMonthlyPeriodEntries:()=>({historyEntry:month,liveEntry:month}),dataImportShouldApplyCurrentMetric:()=>true,dataImportUpsertFloorPlan:()=>{},dataImportApplyMetric:(record,plan,result,name,period,target,value)=>{if(value==null)return false;return c.applyValueToRecord(record,period.monthIdx,target,value,period.year);}});
function apply(entries,type){month={occupiedSnapshot:7.35,leasedSnapshot:10.66,rentableUnits:544};c.dataImportApplyGroupedSnapshot({communityName:'Test',period:{monthIdx:8,year:2026,periodKey:'2026-09'},entries}, {reportType:type,name:'Fixture.xlsx'}, {issues:[],formulas:[],destinations:new Set()});return month;}
const del=apply([{row:{aging_0_30:10,aging_31_60:2,aging_61_90:0,aging_90_plus:0,resident_balance:12,unpaid_rent:0}},{row:{aging_0_30:20,aging_31_60:3,aging_61_90:0,aging_90_plus:0,resident_balance:23,unpaid_rent:0}}],'delinquency');assert.equal(del.netResidentBalance,35);assert.equal(del.delinquentGross,35);
c.savedData.Test={communityPropertyType:'Student Housing'};
c.window.ATLAS_CENTRAL={getStoredProfile:()=>({community_access_records:[{display_name:'Test',property_type:'Multifamily'}]})};
const canonicalMonth=apply([{sourceRow:{sourceSheet:'Test'},row:{measurement_basis:'units',occupied_units:10,rentable_units:20,total_units:20,available_units:8}}],'box_score');
assert.equal(canonicalMonth.occupiedSnapshot,10,'Current canonical property type supersedes stale local type');
delete c.window.ATLAS_CENTRAL; c.savedData.Test={};
const ui={window:{getAtlasApplicationScopeCommunityNames:()=>{scopeCalls++;return ['Allowed'];},atlasApplicationCommunityInScope:()=>true,AtlasApplicationSources:bridge,getAtlasApplicationIntelligenceData:()=>({records:Array.from({length:2500},(_,i)=>({property:i%2?'Allowed':'Denied'}))}),addEventListener:()=>{}},Date};let scopeCalls=0;vm.createContext(ui);vm.runInContext(fs.readFileSync(path.join(root,'application-performance-ui.js'),'utf8'),ui);assert.equal(ui.window.getAtlasApplicationCommandRecords().length,1250);assert.equal(scopeCalls,1);ui.window.getAtlasApplicationScopeCommunityNames=()=>[];assert.equal(ui.window.getAtlasApplicationCommandRecords().length,0);
console.log('PASS source dates, snapshot periods, multi-account aggregation and 2,500-row scope filtering with fresh access checks.');
(async()=>{
 if(!process.env.ATLAS_SOURCE_DIR)return;
 const file=name=>({name,arrayBuffer:async()=>fs.readFileSync(path.join(process.env.ATLAS_SOURCE_DIR,name))});
 const sheets=await c.dataImportReadStructuredRows(file('02 - RISE - Box Score (8).xlsx'),{reportType:'box_score'});
 let totals={guestCards:0,tours:0,applications:0,applicationsApproved:0,denied:0};
 for(const sheet of sheets){const m=apply(sheet.rows.map(sourceRow=>({row:sourceRow.values,sourceRow})),'box_score');for(const k of Object.keys(totals))totals[k]+=m[k]||0;if(sheet.sheetName==='RISE St. Augustine'){assert.equal(m.occupiedSnapshot,20);assert.equal(m.rentableUnits,272);assert.equal(m.sourceLeasedUnits,29);assert.equal(m.guestCards,24);assert(m.proformaRent>2800);assert(m.marketRent>2500);assert(m.nerActual>2100);}}
 assert.deepEqual(totals,{guestCards:561,tours:138,applications:65,applicationsApproved:54,denied:10});
 const ds=await c.dataImportReadStructuredRows(file('04 - RISE - Delinquent and Prepaid Report (2).xlsx'),{reportType:'delinquency'});
 for(const [name,amount] of [['RISE Bartram Park',18925.09],['RISE Florence Villa Townhomes',67634]]){const sheet=ds.find(s=>s.sheetName===name);const m=apply(sheet.rows.map(sourceRow=>({row:sourceRow.values,sourceRow})),'delinquency');assert(Math.abs(m.netResidentBalance-amount)<.01);assert(Math.abs(m.delinquentGross-amount)<.01);}
 for(const name of ['RISE - Resident Data (5).xlsx','RISE - Resident Data (6).xlsx']){const sample=await c.dataImportReadFileSample(file(name));assert.equal(c.dataImportExtractMetadata(sample).dataAsOf.slice(0,10),'2026-09-16');}
 console.log('PASS original reports: 13-community flows, St Augustine counts/rents, full Bartram/Florence balances and both Resident Data cutoffs.');
})().catch(e=>{console.error(e);process.exitCode=1;});
