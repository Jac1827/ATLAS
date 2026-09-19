const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const html=fs.readFileSync('docs/portfolio-operations-dashboard/index.html','utf8');
const cs=fs.readFileSync('docs/portfolio-operations-dashboard/central-services.js','utf8');
const c=vm.createContext({console,Date,Map,Set,window:{},MONTHS:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']});
vm.runInContext(cs.replace(/\}\)\(\);\s*$/, 'window.testRenewalUpsert = upsertRenewals; })();'),c);
for(const f of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm))vm.runInContext(f[0],c);
const source=[['Resident','Unit','Expiration Date','Renewal Status','Renewal Signed Date'],['Synthetic A','101','01/31/2027','Signed & Executed','09/15/2026'],['Synthetic B','102','10/31/2026','Undecided','']];
const preview=c.window.atlasCsPreviewRenewalSheetRows(source,{propertyName:'Example',monthIdx:8,year:2026,importId:'first',fileName:'Example.xlsx'});
assert.equal(preview.length,2);
const periods=c.groupImportedRenewalDetailRowsByPeriod(preview,8,2026);
const january=periods.find(p=>p.periodKey==='2027-01');
assert.equal(january.summary.renewalsSigned,1,'Advance signing remains in January expiration cohort');
assert.equal(periods.find(p=>p.periodKey==='2026-10').summary.undecided,1);
const updated=c.window.atlasCsPreviewRenewalSheetRows([source[0],source[1],['Synthetic B','102','10/31/2026','Signed & Executed','09/18/2026']],{propertyName:'Example',monthIdx:8,year:2026,importId:'second',fileName:'Example revised.xlsx'});
const merged=c.mergeImportedRenewalDetails(preview,updated);
assert.equal(merged.length,2,'New import ID/filename does not duplicate agreements');
assert.equal(c.groupImportedRenewalDetailRowsByPeriod(merged).find(p=>p.periodKey==='2026-10').summary.renewalsSigned,1);
const state={renewals:[]};c.window.testRenewalUpsert(state,preview);c.window.testRenewalUpsert(state,updated);
assert.equal(state.renewals.length,2,'Central Services stable agreement identity');
const plan=c.dataImportApplySelectedPeriod({reportType:'renewal_tracker',reportingMonthIdx:0,reportingYear:2027,reportingPeriodLabel:'Jan 2027',metadata:{},status:'ready',issues:[],sampleSummary:{sheets:[{sheetName:'Oct 2026'},{sheetName:'Jan 2027'}]}},{monthIdx:8,year:2026});
assert.equal(plan.status,'ready');assert.equal(plan.periodSelection.mode,'multiple_months');
assert.deepEqual(Array.from(plan.renewalPeriods),['2026-10','2027-01']);
assert.equal(c.dataImportRowPeriod({renewal_expiration:'01/31/2027',post_month:'09/01/2026',renewal_signed_date:'09/15/2026'},{sourceSheet:'September'},plan).periodKey,'2027-01');
Object.assign(c,{getSelectedDashboardMonthIndex:()=>8});
assert.equal(c.dataImportRowPeriod({}, {sourceSheet:'Undated'},plan).periodKey,'','Never assign undated renewal to upload month');
const record={renewalDetailRowsByPeriod:{},renewalDetailRowsByMonth:Array.from({length:12},()=>[])};
c.window.atlasCsIngestRenewalSheetRows=()=>({renewalRows:updated,importId:'second',ntvCount:0});
const result=c.syncRenewalSheetRowsToCentralServices(record,{propertyName:'Example',monthIdx:8,year:2026},[],{});
c.syncRenewalSheetRowsToCentralServices(record,{propertyName:'Example',monthIdx:8,year:2026},[],{});
assert.equal(record.renewalDetailRowsByPeriod['2027-01'].length,1);
assert.equal(record.renewalDetailRowsByPeriod['2026-10'].length,1);
if(new Date().getFullYear()!==2027) assert.equal(record.renewalDetailRowsByMonth[0].length,0,'Future year must not overwrite current January');
assert.equal(result.periodSummaries.find(p=>p.periodKey==='2027-01').summary.expirations,1);
console.log('PASS actual renewal parser, advance signing by expiration, cross-year coverage, updated/duplicate replay, independent current-year detail, missing period hold');
const workbook={SheetNames:['Setup','Annual agreements'],Sheets:{Setup:[['Property Name','Example'],['Month/Year','September 2026']], 'Annual agreements':source}};
const applied={monthlyData:Array.from({length:12},()=>({occupiedSnapshot:123})),monthlyHistoryByPeriod:{}};
Object.assign(c,{XLSX:{read:()=>workbook,utils:{sheet_to_json:sheet=>sheet}},
 resolveRenewalWorkbookPropertyName:()=> 'Example', getPropertyRecordForApply:()=>applied,
 getProp:()=>({name:'Other'}),savedData:{},renewalImportLog:[],dataImport2State:{closedPeriods:[]},
 getRecordMonthEntryForPeriod:(r,m,y)=>r.monthlyHistoryByPeriod[`${y}-${String(m+1).padStart(2,'0')}`] ||= {},
 normalizeSavedCommunityRecord:(_,r)=>r,setRecordPeriodImportStamp:()=>{}
});
c.window.atlasCsIngestRenewalSheetRows=(rows,context)=>({renewalRows:c.window.atlasCsPreviewRenewalSheetRows(rows,context),importId:context.importId,ntvCount:0});
(async()=>{
 const file={name:'Example.xlsx',arrayBuffer:async()=>new ArrayBuffer(0)};
 const staged=await c.dataImportPreviewRenewalWorkbook(file,{communities:['Example'],selectedCommunities:['Example'],issues:[],reportingYear:2026,status:'ready'});
 assert.deepEqual(Array.from(staged.renewalPeriods),['2026-10','2027-01']);
 const canonical=await c.dataImportReadStructuredRows(file,{reportType:'renewal_tracker',communities:['Example'],reportingYear:2026});
 assert.equal(canonical[0].rows[0].values.renewal_expiration,'2027-01-31');
 assert.equal(canonical[0].rows[0].sourceRow,2);
 await c.handleRenewalWorkbook(file,{communityName:'Example',reportingYear:2026});
 await c.handleRenewalWorkbook(file,{communityName:'Example',reportingYear:2026});
 assert.equal(applied.monthlyHistoryByPeriod['2027-01'].renewalSigned,1);
 assert.equal(applied.monthlyHistoryByPeriod['2026-10'].renewalUndecided,1);
 assert.equal(applied.renewalDetailRowsByPeriod['2027-01'].length,1);
 assert(applied.monthlyData.every(month=>month.occupiedSnapshot===123),'Renewal uploads do not modify occupancy');
 c.dataImport2State.closedPeriods=['2026-10'];
 workbook.Sheets['Annual agreements']=[source[0],source[1],['Synthetic B','102','10/31/2026','Signed & Executed','09/18/2026']];
 await c.handleRenewalWorkbook(file,{communityName:'Example',reportingYear:2026});
 assert.equal(applied.monthlyHistoryByPeriod['2026-10'].renewalUndecided,1,'Closed period remains unchanged');
 await assert.rejects(c.handleRenewalWorkbook(file,{communityName:'Wrong property'}),/conflicts/);
 console.log('PASS full annual-sheet preview and repeated workbook publication, closed-period preservation, community mismatch and unrelated occupancy unchanged');
})().catch(error=>{console.error(error);process.exitCode=1;});
