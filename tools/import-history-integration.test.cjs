const {readDashboardSource}=require('./dashboard-source.cjs');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=readDashboardSource('docs/portfolio-operations-dashboard/index.html');
const context={Date,Map,Set,structuredClone,defaultDataImportMappingRules:()=>[],defaultDataImportPropertyAliases:()=>[],defaultDataImportSourceDefinitions:()=>[],defaultDataImportFreshnessPolicies:()=>({}),DATA_IMPORT_REPORT_ORDER:[],dataImportGetReportDef:()=>null,dataImportNormalizeText:x=>String(x).toLowerCase(),dataImportMakeId:()=> 'generated'};
vm.createContext(context);
for(const name of ['defaultDataImport2State','normalizeDataImport2State','serializeDataImport2State','dataImportBuildBatchId','dataImportUpsertCanonicalRecord']){
 const source=html.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))?.[0];assert(source,name);vm.runInContext(source,context);
}
const state={unknownFutureSetting:{zero:0,nullable:null},historyStorage:{view:'current',revision:4,counts:{batches:73}},batches:Array.from({length:73},(_,i)=>({id:'batch'+i})),sourceArchive:Array.from({length:193},(_,i)=>({id:'s'+i})),lineage:Array.from({length:13051},(_,i)=>({id:'l'+i,importedValue:i===0?0:null})),mappingAuditTrail:Array.from({length:300},(_,i)=>({id:'audit'+i})),temporaryIgnoreHistory:Array.from({length:700},(_,i)=>({id:'ignore'+i}))};
context.dataImport2State=context.normalizeDataImport2State(state);
assert.equal(context.dataImport2State.batches.length,73);assert.equal(context.dataImport2State.sourceArchive.length,193);assert.equal(context.dataImport2State.lineage.length,13051);assert.equal(context.dataImport2State.mappingAuditTrail.length,300);assert.equal(context.dataImport2State.temporaryIgnoreHistory.length,700);assert.equal(context.dataImport2State.historyStorage.revision,4);assert.equal(context.dataImport2State.unknownFutureSetting.zero,0);
assert.equal(context.serializeDataImport2State().lineage.length,13051);assert.match(context.dataImportBuildBatchId(),/-0074$/,'Compact counts cannot recycle a hidden batch ID');
context.dataImportRuntimeCanonicalIndex=null;
const prior={key:'source',values:{value:1},fileHash:'old',dataAsOf:'2026-09-01',revisions:Array.from({length:25},(_,i)=>({id:'r'+i}))};context.dataImport2State.canonicalRecords=[prior];
const result={rowsUpdated:0,rowsUnchanged:0,rowsHeld:0,issues:[]};context.dataImportUpsertCanonicalRecord({key:'source',periodKey:'2026-09',fileHash:'new',dataAsOf:'2026-09-24',values:{value:0}},result);
assert.equal(context.dataImport2State.canonicalRecords[0].revisions.length,26);assert.equal(context.dataImport2State.canonicalRecords[0].values.value,0);
console.log('PASS import integration: complete normalizer/serializer evidence, unknown metadata and zero preservation, safe compact batch identity, untruncated canonical revisions.');
