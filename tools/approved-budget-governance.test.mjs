import assert from 'node:assert/strict';
import {approveOriginalBudget,readBudgetVersion,requiredBudgetCoverage} from '../docs/portfolio-operations-dashboard/features/approved-budget.mjs';
import {readApprovedBudget} from '../docs/portfolio-operations-dashboard/features/canonical-finance.mjs';
const cid='10000000-0000-4000-8000-000000000001',versionId='20000000-0000-4000-8000-000000000001',receiptId='30000000-0000-4000-8000-000000000001',verifiedId='30000000-0000-4000-8000-000000000002',requestId='40000000-0000-4000-8000-000000000001';
const payload={communityId:cid,year:2026,fiscalYear:2026,fiscalStartMonth:1,coverage:Array.from({length:12},(_,i)=>i),effectiveDate:'2026-01-01',sourceFile:'sanitized-budget.xlsx',sourceHash:'a'.repeat(64),mappingVersion:'reviewed-mapping-1',approvedLocked:true,reviewConfirmed:true,rows:[{glCode:'income',monthly:[0,-10,...Array(10).fill(100)]},{glCode:'expense',monthly:Array(12).fill(0)}],metricMappings:{revenue:[{glCode:'income',factor:1}],expenses:[{glCode:'expense',factor:1}]}};
const database={budget:null,requests:new Map(),approvals:0,verifications:0};
function session(){
 let actor='admin-one';const api={role:'admin',corrupt:false,failRead:false,failVerify:false,changeActor:false,getStoredProfile:()=>({role:api.role}),getSession:()=>({user:{id:actor}}),
 async rpc(name,args){
  if(name==='atlas_approve_original_budget_governed'){
   const fingerprint=JSON.stringify(args.p_payload),prior=database.requests.get(args.p_request_id);
   if(prior&&prior!==fingerprint)throw Error('Idempotency conflict');
   if(!prior){database.requests.set(args.p_request_id,fingerprint);database.approvals++;database.budget={version_id:versionId,community_id:cid,calendar_year:2026,status:'locked',covered_months:payload.coverage,content_hash:'b'.repeat(64),payload:structuredClone(args.p_payload)};}
   if(api.changeActor)actor='different-user';
   return {status:'committed',budget:structuredClone(database.budget),receipt:{receipt_id:receiptId,version_id:versionId,content_hash:database.budget.content_hash},publications:[{period:'2026-01',publicationId:'fixture-publication',contentHash:'c'.repeat(64)}]};
  }
  assert.equal(name,'atlas_verify_finance_receipt');assert.equal(args.p_receipt_id,receiptId);assert.equal(args.p_version_id,versionId);assert.equal(args.p_content_hash,database.budget.content_hash);
  if(api.failVerify)throw Error('Verification unavailable');database.verifications++;
  return {receipt_id:verifiedId,status:'readback_verified',state:'Readback Verified',version_id:versionId,content_hash:database.budget.content_hash,source_hash:database.budget.payload.sourceHash,mapping_version:database.budget.payload.mappingVersion,actor_id:actor,created_at:'2026-09-23T00:00:00Z'};
 },async fetchJson(path){assert.match(path,/atlas_approved_budget_versions/);if(api.failRead)throw Error('Network unavailable');const row=structuredClone(database.budget);if(api.corrupt)row.content_hash='d'.repeat(64);return row?[row]:[];}};return api;
}
const central=session(),states=[];
const approve=(changes={},extra={})=>approveOriginalBudget({central,cid,payload:{...payload,...changes},requestId,onStatus:value=>states.push(value),...extra});
const result=await approve();assert.deepEqual(states.map(s=>s.status),['queued','committed','readback_verified']);assert.equal(result.receiptId,verifiedId);assert.equal(result.budget.payload.rows[0].monthly[0],0);assert.equal(result.budget.payload.rows[0].monthly[1],-10);assert.equal(database.approvals,1);
await approve();assert.equal(database.approvals,1,'same exact request retries once without duplicate versions');
const second=session(),reloaded=await readApprovedBudget(second,cid,2026);assert.equal(reloaded.version_id,result.versionId);assert.deepEqual(reloaded.payload.rows,result.budget.payload.rows);assert.equal(reloaded.content_hash,result.contentHash,'fresh authorized session reads the same canonical version and values');
states.length=0;central.corrupt=true;await assert.rejects(approve(),/readback did not match/);assert.deepEqual(states.map(s=>s.status),['queued','committed','failed']);assert.equal(states.at(-1).committed,true);central.corrupt=false;
states.length=0;central.failVerify=true;await assert.rejects(approve(),/Verification unavailable/);assert(!states.some(s=>s.status==='readback_verified'));central.failVerify=false;await approve();assert.equal(database.approvals,1,'verification retry keeps the original committed request');
states.length=0;await assert.rejects(approve({coverage:[0]}),/Complete approved fiscal coverage/);assert.deepEqual(states.map(s=>s.status),['blocked']);
await assert.rejects(approve({rows:[{glCode:'income',monthly:[null,...Array(11).fill(0)]}]}),/Missing amounts/);
await assert.rejects(approve({effectiveDate:'2026-02'}),/exact valid effective date/);
await assert.rejects(approve({mappingVersion:''}),/mapping version/);
await assert.rejects(approve({sourceHash:''}),/Source hash/);
await assert.rejects(approve({rows:[payload.rows[0],payload.rows[0]]}),/unique identity/);
central.role='viewer';await assert.rejects(approve(),/Only an Admin/);central.role='admin';
states.length=0;await assert.rejects(approve({sourceFile:'changed-source.xlsx'}),/Idempotency conflict/);assert.equal(states.at(-1).status,'conflict');assert.equal(database.budget.payload.sourceFile,payload.sourceFile);
central.changeActor=true;states.length=0;await assert.rejects(approve(),/Session changed/);assert(!states.some(s=>s.status==='readback_verified'));
await assert.rejects(readBudgetVersion(second,{versionId,contentHash:'wrong',cid,year:2026}),/readback/);
assert.deepEqual(requiredBudgetCoverage(2025,2026,8),[7,8,9,10,11]);assert.deepEqual(requiredBudgetCoverage(2026,2026,8),[0,1,2,3,4,5,6]);assert.deepEqual(requiredBudgetCoverage(2027,2026,8),[]);
console.log('PASS governed budget state receipts, zero/sign/missing semantics, complete fiscal coverage, role/scope protection, stable idempotency, mismatch/failure retention and identical authorized-session reload.');
