import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handleBudgetInvestorEmail} from '../src/budget-investor-email.mjs';
const draftId=randomUUID(),publicationId=randomUUID();
const summary={community:'Locked community',fiscalYear:2027,periodLabel:'Jan – Dec 2027',units:10,unitLabel:'unit',assetClass:'Conventional',address:'Test address',rows:[{name:'NOI',t12:80,final:100,perUnit:10}],groups:[],approvals:[],generatedAt:'2026-11-09T00:00:00Z'};
function fixture({providerTimeout=false,receiptTimeout=false}={}){
 let delivery=null,sends=0,finishCalls=0;
 const env={ATLAS_DLR_FROM_EMAIL:'reports@example.com',EMAIL:{send:async message=>{sends++;assert.equal(message.to[0],'investor@example.com');assert.match(message.html,/Locked community/);assert(message.attachments[0].content.length>100);if(providerTimeout)throw Error('Provider accepted but response timed out');return {messageId:'accepted-1'};}}};
 const api={requireAtlasAccessUser:async()=>({config:{},token:'user-token'}),apiResponse:(body,options={})=>({body,status:options.status||200}),
  callAtlasRpcAsUser:async(_config,token,name,body)=>{assert.equal(token,'user-token');assert.equal(name,'atlas_claim_budget_investor_delivery_v2');if(delivery)return {delivery:structuredClone(delivery),sendAuthorized:false};delivery={delivery_id:randomUUID(),draft_id:draftId,publication_id:publicationId,request_id:body.p_request_id,status:'claimed',recipients:['investor@example.com'],locked_summary:structuredClone(summary)};return {delivery:structuredClone(delivery),sendAuthorized:true};},
  supabaseRequest:async(_config,path,options)=>{assert.equal(path,'/rest/v1/rpc/atlas_finish_budget_investor_delivery');assert.equal(options.service,true);finishCalls++;if(receiptTimeout)throw Error('Receipt response unavailable');delivery.status=options.body.p_status;return delivery;}};
 const send=(recipients=['investor@example.com'])=>handleBudgetInvestorEmail(new Request('https://atlas.example/api/atlas/budget-investor/email',{method:'POST',body:JSON.stringify({draftId,requestId:randomUUID(),recipients})}),env,api);
 return {send,get sends(){return sends},get delivery(){return delivery},get finishCalls(){return finishCalls}};
}
// The provider can accept an email and then lose its response. A new browser request
// and a changed recipient list must still be blocked by the unresolved publication.
for(const options of [{providerTimeout:true},{receiptTimeout:true}]){
 const f=fixture(options),first=await f.send();assert.equal(first.body.ok,false);assert.equal(f.sends,1);
 const priorFinishCalls=f.finishCalls;
 const retry=await f.send(['investor@example.com','another@example.com']);assert.equal(retry.status,409);assert.equal(f.sends,1);assert.equal(f.finishCalls,priorFinishCalls,'a non-owner cannot finish or mutate the active claim');
}
const success=fixture();assert.equal((await success.send()).body.status,'sent');assert.equal((await success.send()).body.replay,true);assert.equal(success.sends,1,'sent package is not sent again');
const concurrent=fixture();const results=await Promise.all([concurrent.send(),concurrent.send()]);assert.equal(concurrent.sends,1);assert(results.some(r=>r.status===409));assert(results.some(r=>r.body.ok));
console.log('PASS investor email: immutable claimed summary, one send during concurrent requests, provider/receipt timeout blocks retries with new request IDs and changed recipients, sent replay');
