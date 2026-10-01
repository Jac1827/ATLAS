import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readAccountingEvidence} from '../docs/portfolio-operations-dashboard/features/data-health-accounting.mjs';
const id='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222';
function fixture(){
 const head={community_id:id,period_key:'2026-08',version_id:version};
 const close={...head,status:'closed',coverage:'full_month',accounting_basis:'accrual',source_file:'Approved August.xlsx',source_hash:'a'.repeat(64),approved_at:'2026-09-22T12:00:00Z',approved_by:'reviewer'};
 const data=[[head],[close],[]],calls=[];let actor='signed-in',access='scope-one';
 const central={getSession:()=>({user:{id:actor}}),getAccessContextKey:()=>access,fetchJson:async url=>{calls.push(url);return structuredClone(data[calls.length-1]);}};
 return {data,calls,central,close,changeActor:()=>actor='other',changeAccess:()=>access='scope-two'};
}
test('approved Central accounting is recognized by its current head and period end without reading financial amounts',async()=>{
 const f=fixture(),rows=await readAccountingEvidence(f.central,[{id,name:'Example'}],{throughPeriod:'2026-10'});
 assert.equal(rows.length,1);assert.equal(rows[0].reportingPeriodLabel,'2026-08');assert.equal(rows[0].dataDateIso,'2026-08-31T12:00:00.000Z');assert.equal(rows[0].fileHash,'a'.repeat(64));assert.equal(rows[0].uploadedAt,f.close.approved_at);assert.equal(rows[0].accountingReopened,false);assert.equal(f.calls.length,3);assert(f.calls.every(url=>!url.includes('metrics')&&!url.includes('select=*')));
});
test('reopened approved sources stay held even when their immutable close row is still retained',async()=>{
 const f=fixture();f.data[2]=[{community_id:id,period_key:'2026-08',version_id:version,action:'reopened',created_at:'2026-09-30'}];
 assert.equal((await readAccountingEvidence(f.central,[{id,name:'Example'}],{throughPeriod:'2026-10'}))[0].accountingReopened,true);
});
test('missing source, cross-scope response, incomplete read and changed authorization never become fresh evidence',async()=>{
 for(const failure of ['missing_version','wrong_community','unsigned','access_changed','actor_changed','navigation','truncated']){
  const f=fixture();let current=true;
  if(failure==='missing_version')f.data[1]=[];
  if(failure==='wrong_community')f.data[1][0].community_id='other';
  if(failure==='unsigned')f.data[1][0].approved_by='';
  if(failure==='truncated')f.data[0]=Array(1000).fill(f.data[0][0]);
  const fetch=f.central.fetchJson;f.central.fetchJson=async url=>{const value=await fetch(url);if(failure==='access_changed')f.changeAccess();if(failure==='actor_changed')f.changeActor();if(failure==='navigation')current=false;return value;};
  await assert.rejects(readAccountingEvidence(f.central,[{id,name:'Example'}],{throughPeriod:'2026-10',isCurrent:()=>current}),undefined,failure);
 }
 const f=fixture();f.data[0]=[];assert.deepEqual(await readAccountingEvidence(f.central,[{id,name:'Example'}],{throughPeriod:'2026-10'}),[]);
});
test('health uses scoped accounting evidence and exposes reopening instead of a healthy count',async()=>{
 const source=fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js','utf8'),c=vm.createContext({Date,Map,Set,console});
 for(const m of source.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm))vm.runInContext(m[0],c);
 const f=fixture(),[row]=await readAccountingEvidence(f.central,[{id,name:'Example'}],{throughPeriod:'2026-10'});
 Object.assign(c,{dataImportAccountingEvidence:{context:'current',rows:[row]},getAtlasFinancialContextKey:()=> 'current',dataImport2State:{sourceArchive:[],exceptions:[],batches:[]},DATA_IMPORT_REPORT_ORDER:['approved_accounting'],dataImportGetHealthCommunityNames:()=>['Example'],dataImportGetMatrixCommunityNames:()=>['Example'],dataImportIsActiveReportingCommunity:()=>true,dataImportCommunitySupportsReport:()=>true,dataImportGetReportDef:()=>({label:'Approved Accounting Report'}),dataImportEffectiveFreshness:()=>({days:35}),dataImportHasSavedFallbackData:()=>false,dataImportAgeForArchive:()=>31});
 assert.equal(c.dataImportBuildHealthModel().missingFeeds,0);assert.equal(c.dataImportBuildHealthModel().cells[0].status,'Fresh');
 row.accountingReopened=true;assert.equal(c.dataImportBuildHealthModel().cells[0].status,'Held');assert.equal(c.dataImportBuildHealthModel().fullyCurrentCommunities,0);
 c.getAtlasFinancialContextKey=()=> 'changed';assert.equal(c.dataImportBuildHealthModel().missingFeeds,1);
});
