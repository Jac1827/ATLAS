const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/portfolio-operations-dashboard/index.html','utf8');
const c = vm.createContext({console,Date,Map,Set,MONTHS:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], dataImportUploadPeriod:null,renderTab:()=>{}});
for (const f of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(f[0],c);
c.renderTab=()=>{};
const plain=x=>JSON.parse(JSON.stringify(x));
assert.deepEqual(plain(c.getDataImportUploadPeriod(new Date(2026,8,18))),{monthIdx:8,year:2026});
assert.deepEqual(plain(c.getDataImportUploadPeriod(new Date(2027,0,1))),{monthIdx:0,year:2027});
c.setDataImportUploadPeriod('year','2025'); c.setDataImportUploadPeriod('monthIdx','0');
assert.deepEqual(plain(c.getDataImportUploadPeriod()),{monthIdx:0,year:2025});
c.setDataImportUploadPeriod('monthIdx','12'); c.setDataImportUploadPeriod('year','NaN');
assert.deepEqual(plain(c.getDataImportUploadPeriod()),{monthIdx:0,year:2025});
const source={reportingMonthIdx:7,reportingYear:2026,reportingPeriodLabel:'Aug 2026',status:'ready',selected:true,readyRows:13,issues:[],metadata:{generatedAt:'2026-09-16T22:31:00Z'},fileHash:'unaltered'};
const before=JSON.stringify(source);
const match=c.dataImportApplySelectedPeriod(source,{monthIdx:7,year:2026});
assert.equal(match.status,'ready'); assert.equal(match.metadata.generatedAt,source.metadata.generatedAt);
assert.equal(match.periodSelection.basis,'source_verified');
assert.equal(JSON.stringify(source),before,'Source plan is not mutated');
for(const target of [{monthIdx:8,year:2026},{monthIdx:7,year:2025}]){
 const blocked=c.dataImportApplySelectedPeriod(source,target);
 assert.equal(blocked.status,'blocked'); assert.equal(blocked.selected,false); assert.equal(blocked.readyRows,0);
 assert.equal(blocked.reportingMonthIdx,7); assert.equal(blocked.reportingYear,2026);
 assert.equal(blocked.fileHash,'unaltered');
}
const missing=c.dataImportApplySelectedPeriod({...source,reportingMonthIdx:null,reportingYear:null,reportingPeriodLabel:'Not detected'},{monthIdx:0,year:2025});
assert.equal(missing.reportingYear,2025); assert.equal(missing.reportingMonthIdx,0);
assert.equal(missing.periodSelection.basis,'user_selected');
assert.equal(c.dataImportApplySelectedPeriod(source,null),source,'Archive replay does not inherit current upload selection');
const plan={...match,reportType:'box_score'};
const section=c.dataImportRowPeriod({}, {period:{start:'2026-09-16'}},plan);
assert.equal(section.periodKey,'2026-09','Source section date never relabeled as August');
assert(c.dataImportPeriodConflict(plan.periodSelection.requested,section));
Object.assign(c, {
 dataImportReadStructuredRows:async()=>[{sheetName:'Source',rows:[{sourceRow:1,period:{start:'2026-09-16'},values:{}}]}],
 dataImportApprovalInProgress:false,dataImportApprovalProgress:{rowsDone:0},
 dataImportNormalizeText:x=>String(x).toLowerCase(),dataImportBuildAliasLookup:()=>new Map(),dataImportBuildInternalCommunityLookup:()=>new Map(),
 dataImportEffectiveFreshness:()=>({action:'warn',days:3}),dataImportMapSourceRow:()=>({mapped:{},sourceFields:{},unmappedFields:[]}),
 dataImportResolveRowCommunity:()=> 'Example', dataImportCommunitySupportsReport:()=>true,dataImportNumericValue:()=>null,
 dataImportGetReportDef:()=>null, atlasCaptureBoxScoreFile:async()=>{throw Error('Held section must not enter whole-file capture');},
 dataImport2State:{reconciliationLog:[]},persistSaved:()=>{},getProp:()=>({name:'Example'}),dataImportRecordPlanLearningUsage:()=>{},
 dataImportUpsertCanonicalRecord:()=>{throw Error('A conflicting section must never reach storage');},
 dataImportApplyGroupedSnapshot:()=>{throw Error('A conflicting section must never publish');}
});
(async()=>{
 const held=await c.dataImportRouteStructuredFile({},plan,'test');
 assert.equal(held.rowsHeld,1);assert.equal(held.rowsInserted,0);assert.equal(held.communities.length,0);
 assert(held.issues.some(x=>x.title==='Source section is outside the selected period'));
 console.log('PASS current defaults, year rollover, selection validation, source-date preservation, mismatch blocking, undated fallback and held sections without storage mutation');
})().catch(e=>{console.error(e);process.exitCode=1;});
