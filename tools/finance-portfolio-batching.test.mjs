import assert from 'node:assert/strict';
import test from 'node:test';
import {readFinance} from '../docs/portfolio-operations-dashboard/features/canonical-finance.mjs';
import {createCache} from '../docs/portfolio-operations-dashboard/features/financial-close.mjs';

const uuid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const ids=Array.from({length:14},(_,i)=>uuid(i+1));
const periods=Array.from({length:12},(_,i)=>'2026-'+String(i+1).padStart(2,'0'));
const roster=ids.map((community_id,i)=>({community_id,display_name:'Community '+i}));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const state={actor:uuid(100),profileVersion:1,reads:[],receipts:[],active:0,maxActive:0,beforeRead:null,missing:null,approved:false,refreshes:0,onRefresh:null};
 const row=(community_id,period_key,index)=>{
  const baseline={communityId:community_id,period:period_key,status:'available',verified:true,approved:true,locked:true,sourceType:state.approved?'approved_reforecast':'original_budget',versionId:uuid(200+ids.indexOf(community_id)),publicationId:state.approved?uuid(300+ids.indexOf(community_id)):null,contentHash:'a'.repeat(64),lines:[{accountCode:'rent',nature:'income',placement:'above_noi',amount:20}]};
  return {community_id,period_key,fiscal_year:2026,publication_id:uuid(400+ids.indexOf(community_id)),summary:{communityId:community_id,period:period_key,registryVersion:'atlas-finance-v1',actualCloseVersion:uuid(500+ids.indexOf(community_id)),budgetVersion:baseline.versionId,effectiveBaseline:baseline,revenue:{actual:[null,0,-10.125][index%3],budget:20,originalBudget:20,activeBaseline:20,baselineVersion:baseline.versionId,baselineSourceType:baseline.sourceType,baselinePublicationId:baseline.publicationId}}};
 };
 const central={getSession:()=>({user:{id:state.actor}}),getStoredProfile:()=>({user_id:state.actor,role:'executive',status:'active',allowed_community_ids:ids,version:state.profileVersion}),readCommunitiesForAccess:async()=>roster,refreshSession:async()=>{state.refreshes++;await state.onRefresh?.();},fetchJson:async(url,options)=>{
  const args=JSON.parse(options.body);
  if(url==='/rpc/atlas_verify_budget_consumer'){state.receipts.push(args);assert.equal(state.active,0);assert.equal(state.reads.length,14,'No consumer delivery is acknowledged before every requested community is read');return {publication_id:args.p_publication_id,consumer_key:args.p_consumer_key,content_fingerprint:args.p_observed_fingerprint,delivery_status:'verified'};}
  assert.equal(url,'/rpc/atlas_read_finance');state.reads.push(args);
  if(args.p_community_ids.length>1)throw Error('statement timeout: portfolio request exceeds the verified one-community workload');
  state.active++;state.maxActive=Math.max(state.maxActive,state.active);
  try{await state.beforeRead?.(args,options);await tick();return args.p_community_ids[0]===state.missing?[]:args.p_community_ids.flatMap(id=>args.p_periods.map((period,index)=>row(id,period,index)));}finally{state.active--;}
 }};
 return {state,central,row};
}

test('retained yearly cache reads all14 communities serially and verifies only the complete result',async()=>{
 const {state,central}=fixture(),cache=createCache(central);state.approved=true;
 assert.equal(await cache.refresh(2026),true);assert.equal(state.reads.length,14);assert.equal(state.maxActive,1);assert.equal(state.receipts.length,14);assert.equal(cache.status,'Verified');
 assert.deepEqual(state.reads,ids.map(id=>({p_community_ids:[id],p_periods:periods})));
 for(const [index,id] of ids.entries())for(const period of periods){const value=cache.envelope(id,period);assert.equal(value.communityId,id);assert.equal(value.period,period);assert.equal(value.activeBaselinePublicationId,uuid(300+index));}
 assert.deepEqual(periods.slice(0,3).map(period=>cache.envelope(ids[0],period).revenue.actual),[null,0,-10.125]);
});

test('a later timeout rejects the whole refresh, clears selected cache, and sends no partial ACK',async()=>{
 const {state,central}=fixture(),cache=createCache(central);await cache.refresh(2026);state.reads=[];state.approved=true;
 state.beforeRead=()=>{if(state.reads.length===2)throw Error('statement timeout');};
 await assert.rejects(cache.refresh(2026,true),/statement timeout/);assert.equal(state.reads.length,2);assert.equal(state.receipts.length,0);assert.notEqual(cache.status,'Verified');
 for(const id of ids)assert.equal(cache.envelope(id,periods[0]),null,'No previously or partially loaded selected community remains apparently current');
});

for(const kind of ['actor','profile','abort'])test(kind+' changes between chunks stop subsequent reads and consumer ACK',async()=>{
 const {state,central}=fixture(),controller=new AbortController();state.approved=true;
 state.onRefresh=()=>{if(state.refreshes===2){if(kind==='actor')state.actor=uuid(999);else if(kind==='profile')state.profileVersion++;else controller.abort();}};
 await assert.rejects(readFinance(central,ids,periods,{signal:controller.signal}),kind==='abort'?{name:'AbortError'}:/Session.*changed/);
 assert.equal(state.reads.length,1);assert.equal(state.receipts.length,0);
});

test('missing community data remains absent; duplicate scope is removed without fabricating values',async()=>{
 const {state,central}=fixture();state.missing=ids[1];
 const result=await readFinance(central,[ids[0],ids[1],ids[0]],[periods[0],periods[0]],{baselineMode:'original_budget'});
 assert.equal(state.reads.length,2);assert.equal(result.length,1);assert.equal(result[0].community_id,ids[0]);assert.equal(result[0].summary.revenue.actual,null);
});

test('period contracts and wrong-community response rejection remain unchanged',async()=>{
 const {state,central,row}=fixture();
 await assert.rejects(readFinance(central,ids,['2026-13']),/Invalid finance reporting periods/);assert.equal(state.reads.length,0);
 central.fetchJson=async()=>[row(ids[1],periods[0],0)];
 await assert.rejects(readFinance(central,[ids[0]],[periods[0]]),/scope or registry mismatch/);
});

test('simultaneous presentation readers share the entire serial portfolio request, not partial chunks',async()=>{
 const {state,central}=fixture();
 const [one,two]=await Promise.all([readFinance(central,ids,periods,{readMode:'presentation'}),readFinance(central,ids,periods,{readMode:'presentation'})]);
 assert.equal(state.reads.length,14);assert.equal(one.length,168);assert.deepEqual(one,two);one[0].summary.revenue.actual=999;assert.equal(two[0].summary.revenue.actual,null);
});
