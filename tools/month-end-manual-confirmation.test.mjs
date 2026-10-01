import assert from 'node:assert/strict';
import {mountMonthEndReview} from '../docs/portfolio-operations-dashboard/features/month-end-governance.mjs';
const review={review_id:'review-a',community_id:'community-a',period_key:'2026-01'};
function fixture({existing=false}={}){
 const nodes=Object.fromEntries(['data-confirm-accounting','data-accounting-confirmed','data-source-generated','data-accounting-reason','data-attest-status','data-save-decision','data-review-status'].map(key=>[key,{value:'',checked:false,textContent:'',disabled:false}]));
 nodes['data-source-generated'].value='2026-02-20T09:00';nodes['data-accounting-reason'].value='I verified this is the closed-month Accounting package';
 const state={actor:'actor-a',profile:{user_id:'actor-a',role:'admin',status:'active',allowed_community_ids:['community-a']},config:{supabaseUrl:'https://fixture.invalid',enabled:true},calls:[],confirmed:existing};
 const container={innerHTML:'',querySelector(selector){return nodes[selector.slice(1,-1)]||null;},querySelectorAll(){return[];}};
 const central={getSession:()=>({user:{id:state.actor}}),getStoredProfile:()=>state.profile,getConfig:()=>state.config,
 fetchJson:async()=>state.confirmed?[{review_id:review.review_id,accounting_closed_at:existing?'2026-02-12T10:00:00Z':null}]:[],
 rpc:async(name,args)=>{state.calls.push({name,args});if(name==='atlas_confirm_month_end_close_manually'){state.confirmed=true;await state.afterConfirm?.();return {confirmation_mode:'manual_closed_confirmation'};}return {reviewId:review.review_id,communityId:review.community_id,period:review.period_key,periods:['2026-01'],rows:[],blockers:[],calendar:{classification:'Multifamily'},expenseActual:0,expenseBudget:0};}};
 return {nodes,state,container,central};
}
const f=fixture();await mountMonthEndReview(f.container,f.central,review);
assert.match(f.container.innerHTML,/between the 10th and 15th; the date varies/);assert.match(f.container.innerHTML,/does not confirm closure/);assert.match(f.container.innerHTML,/unknown historical Accounting close time stays blank/);assert.match(f.container.innerHTML,/data-source-generated/);assert(!f.container.innerHTML.includes('data-accounting-close'));
await f.nodes['data-confirm-accounting'].onclick();assert.equal(f.state.calls.length,0);assert.match(f.nodes['data-attest-status'].textContent,/Explicitly confirm/);
f.nodes['data-accounting-confirmed'].checked=true;f.nodes['data-source-generated'].value='';await f.nodes['data-confirm-accounting'].onclick();assert.equal(f.state.calls.length,0);assert.match(f.nodes['data-attest-status'].textContent,/verified source generation time/);
f.nodes['data-source-generated'].value='2026-02-20T09:00';f.nodes['data-accounting-reason'].value='';await f.nodes['data-confirm-accounting'].onclick();assert.equal(f.state.calls.length,0);assert.match(f.nodes['data-attest-status'].textContent,/reason/);
f.nodes['data-accounting-reason'].value='Manual confirmation of closed Accounting actuals';await f.nodes['data-confirm-accounting'].onclick();
assert.deepEqual(f.state.calls[0],{name:'atlas_confirm_month_end_close_manually',args:{p_review_id:review.review_id,p_source_generated_at:new Date('2026-02-20T09:00').toISOString(),p_closed_confirmed:true,p_reason:'Manual confirmation of closed Accounting actuals'}});assert(!Object.hasOwn(f.state.calls[0].args,'p_accounting_closed_at'));assert.equal(f.state.calls[1].name,'atlas_read_month_end_review');
for(const after of [false,true])for(const mutate of [s=>s.actor='other',s=>s.profile.allowed_community_ids=[],s=>s.config.supabaseUrl='https://other.invalid']){
 const t=fixture();await mountMonthEndReview(t.container,t.central,review);t.nodes['data-accounting-confirmed'].checked=true;
 if(after)t.state.afterConfirm=()=>mutate(t.state);else mutate(t.state);
 await t.nodes['data-confirm-accounting'].onclick();assert.equal(t.state.calls.length,after?1:0);assert.match(t.nodes['data-attest-status'].textContent,/Session or financial access changed/);
}
const prior=fixture({existing:true});await mountMonthEndReview(prior.container,prior.central,review);assert.equal(prior.state.calls[0].name,'atlas_read_month_end_review');assert(!prior.container.innerHTML.includes('data-accounting-confirmed'),'Existing precise attestation is not replaced by a synthetic manual confirmation');
console.log('PASS explicit manual close UI, advisory window, required source generation/reason, no invented close time, context guards and preserved prior precise attestation.');
