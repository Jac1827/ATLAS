import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EvictionCaseState} from '../src/eviction-store.mjs';
import {coversheetPdf} from '../src/eviction-packet.mjs';
class Storage {
  constructor(){this.data=new Map();this.queue=Promise.resolve();}
  async get(k){return structuredClone(this.data.get(k));}
  async put(k,v){this.data.set(k,structuredClone(v));}
  transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p;}
}
const actor={id:'test-user',name:'Test RISE User'},row={id:'synthetic-case',propertyName:'Inactive Test Community',residentName:'Synthetic Resident',unit:'TEST-1',evictionFiledAt:'2026-09-16T10:00:00Z',delinquentBalance:1500,aging0To30:1000,aging31To60:500,aging61To90:0,aging90Plus:0,lastDelinquencyNote:'Test-only note, not a real resident.',lastDelinquencyNoteDate:'2026-09-15',filingInformation:{recordedAt:'2026-09-16T10:00:00Z',activeDutyMilitary:false,cosignProgram:true,depositProgram:'deposit',depositAmount:500,adultOccupantCount:2,adultOccupantNames:['Synthetic Adult One','Synthetic Adult Two'],entrataConfirmed:true}};
let calls=[];const storage=new Storage(),env={ATLAS_DLR_FROM_EMAIL:'test@example.invalid',EMAIL:{async send(message){calls.push(message);return {messageId:'mock-provider-message-1'};}}},store=new EvictionCaseState({storage},env);
async function req(action,body={},target=store){const response=await target.fetch(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({caseId:row.id,actor,action,...body})}));return {status:response.status,result:response.headers.get('content-type')?.includes('json')?await response.json():await response.arrayBuffer()};}
let p=(await req('get')).result;assert.equal(calls.length,0);assert.equal(p.documents.length,0);
const upload=async(name,category,data='synthetic')=>req('upload',{file:{name,category,base64:btoa(data)}});
await upload('lease.pdf','lease');await upload('ledger.csv','ledger');await upload('lease.pdf','lease','new version');
p=(await req('get')).result;assert.equal(p.documents.length,3);assert.equal(p.documents.filter(d=>d.active).length,2);assert.equal(p.documents.at(-1).version,2);
const draft={to:['test-attorney@example.invalid'],subject:'Synthetic test filing packet',body:'This is a mock-only test.',exceptionReason:''};
p=(await req('draft',{row,draft,revision:p.revision})).result;assert.equal(calls.length,0);
assert.equal((await req('send',{revision:p.revision})).status,409);
assert.equal((await req('draft',{row,draft,revision:p.revision-1})).status,409);
p=(await req('ready',{revision:p.revision})).result;
const sent=await Promise.all([req('send',{revision:p.revision}),req('send',{revision:p.revision})]);
assert.equal(calls.length,1,'Concurrent requests may not duplicate sends');p=(await req('get')).result;
assert.equal(p.draft.status,'sent');assert.equal(p.draft.providerMessageId,'mock-provider-message-1');assert.equal(p.draft.deliveryStatus,'unconfirmed');
assert.equal(calls[0].attachments.length,3);assert.equal(calls[0].to[0],'test-attorney@example.invalid');assert.equal(p.draft.manifest.length,3);
assert.equal((await req('send',{revision:p.revision})).status,200);assert.equal(calls.length,1);
const archived=p.documents.find(d=>d.category==='cover');assert(archived);const pdf=await req('download',{documentId:archived.id});assert.equal(Buffer.from(pdf.result).subarray(0,4).toString(),'%PDF');
fs.writeFileSync('../eviction-attorney-test.pdf',Buffer.from(pdf.result));
assert.equal((await req('court',{date:'2026-09-16',reference:'SYNTHETIC-COURT-REF'})).result.court.reference,'SYNTHETIC-COURT-REF');
async function prepared(email){const st=new EvictionCaseState({storage:new Storage()},{ATLAS_DLR_FROM_EMAIL:'test@example.invalid',EMAIL:email});let r=(await req('draft',{row,draft:{...draft,exceptionReason:'Synthetic missing-document exception'},revision:0},st)).result;r=(await req('ready',{revision:r.revision},st)).result;return {st,r};}
let {st,r}=await prepared({async send(){throw Object.assign(new Error('rejected'),{code:'E_RECIPIENT_NOT_ALLOWED'});}});
let failure=await req('send',{revision:r.revision},st);assert.equal(failure.result.draft.status,'failed');assert.equal(failure.result.draft.sentAt,undefined);assert.equal(failure.result.draft.body,draft.body);
let retry=await req('draft',{row,draft:{...draft,exceptionReason:'Test exception'},revision:failure.result.revision},st);assert.equal(retry.status,200);
({st,r}=await prepared({async send(){throw Error('timeout');}}));failure=await req('send',{revision:r.revision},st);assert.equal(failure.result.draft.status,'uncertain');assert.equal((await req('send',{revision:failure.result.revision},st)).status,409);
({st,r}=await prepared(undefined));assert.equal((await req('send',{revision:r.revision},st)).status,503);assert.equal((await req('get',{},st)).result.draft.status,'ready');
const missing=new EvictionCaseState({storage:new Storage()},env);let noDocs=(await req('draft',{row,draft,revision:0},missing)).result;assert.equal((await req('ready',{revision:noDocs.revision},missing)).status,400);
const sentManifest=structuredClone(p.draft.manifest);await upload('later-notice.pdf','notice');p=(await req('get')).result;assert.equal(p.draft.status,'sent');assert.deepEqual(p.draft.manifest,sentManifest,'Later attachments cannot change the submitted manifest');
const bigStore=new EvictionCaseState({storage:new Storage()},env);let big=await req('upload',{file:{name:'large-lease.pdf',category:'lease',base64:Buffer.alloc(4*1024*1024).toString('base64')}},bigStore);big=(await req('draft',{row,draft:{...draft,exceptionReason:'Synthetic ledger exception'},revision:big.result.revision},bigStore)).result;big=(await req('ready',{revision:big.revision},bigStore)).result;assert.equal((await req('send',{revision:big.revision},bigStore)).status,413);assert.equal((await req('get',{},bigStore)).result.draft.status,'ready');assert.equal(calls.length,1,'Oversized packets must never be submitted');
const large=await coversheetPdf({...row,lastDelinquencyNote:'Long note '.repeat(3000)},actor);assert(large.length>1000);
console.log('PASS attachments, versions, generated PDF, exact recipients, missing-document gates, stale drafts, concurrent send protection, provider success/rejection/uncertainty, retry and unconfigured integration. No real email sent.');
// Exercise the public endpoint with mocked identity/community services, never a live account.
const {default:worker}=await import('../src/worker.mjs');
const originalFetch=globalThis.fetch;let forwarded=0,forwardedActor;let role='community_manager';
globalThis.fetch=async url=>{const u=new URL(url);let data;if(u.pathname==='/auth/v1/user')data={id:'verified-user',email:'verified@example.invalid'};else if(u.pathname.endsWith('/atlas_user_profiles'))data=[{display_name:'Verified User',role,status:'active',allowed_community_ids:['allowed-id']}];else if(u.pathname.endsWith('/atlas_communities')){const name=u.searchParams.get('display_name')?.slice(3);data=[{community_id:name==='Allowed Community'?'allowed-id':'other-id'}];}else throw Error('Unexpected mocked URL');return Response.json(data);};
const apiEnv={SUPABASE_SERVICE_ROLE_KEY:'mock-service-key',EVICTION_CASES:{idFromName:id=>id,get:id=>({async fetch(request){forwarded++;forwardedActor=(await request.json()).actor;return Response.json({ok:true,id});}})}};
const apiRequest=(communityName,action='get',token=true)=>worker.fetch(new Request('https://test.invalid/api/atlas/evictions/case',{method:'POST',headers:token?{authorization:'Bearer synthetic-token'}:{},body:JSON.stringify({caseId:row.id,communityName,action,actor:{name:'Spoofed User'}})}),apiEnv);
try{assert.equal((await apiRequest('Allowed Community','get',false)).status,401);assert.equal((await apiRequest('Other Community')).status,403);assert.equal(forwarded,0);assert.equal((await apiRequest('Allowed Community')).status,200);assert.equal(forwardedActor.name,'Verified User');role='viewer';assert.equal((await apiRequest('Allowed Community','upload')).status,403);}finally{globalThis.fetch=originalFetch;}
console.log('PASS authenticated community isolation and verified actor identity.');
