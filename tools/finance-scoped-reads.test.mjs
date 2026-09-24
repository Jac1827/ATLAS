import assert from 'node:assert/strict';
import {readFinance,invalidateFinanceReads} from '../docs/portfolio-operations-dashboard/features/canonical-finance.mjs';
import {createCache} from '../docs/portfolio-operations-dashboard/features/financial-close.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const periods=['2026-07','2026-08','2026-09'];
const rows=(ids,months,version='v1')=>ids.flatMap(community_id=>months.map(period_key=>({community_id,period_key,publication_id:'publication-'+version,fiscal_year:2026,summary:{registryVersion:'atlas-finance-v1',communityId:community_id,period:period_key,actualCloseVersion:'close-'+version,budgetVersion:'budget-'+version,revenue:{actual:0,budget:2,activeBaseline:2,baselineVersion:version,baselineSourceType:'original_budget',baselinePublicationId:null},effectiveBaseline:{communityId:community_id,period:period_key,status:'available',verified:true,locked:true,approved:true,sourceType:'original_budget',versionId:version,publicationId:null,contentHash:'hash-'+version,lines:[{accountCode:'5120',nature:'income',placement:'above_noi',amount:2}]}}})));
function fake(){
 const state={actor:'actor-1',backend:'https://test.invalid',profile:{user_id:'actor-1',status:'active',role:'regional',allowed_community_ids:['a','b'],locked_tab_ids:[],locked_page_keys:[],version:1},calls:[],rosterCalls:0,reply:null};
 const central={getSession:()=>({user:{id:state.actor}}),getConfig:()=>({supabaseUrl:state.backend,enabled:true}),getStoredProfile:()=>state.profile,refreshSession:async()=>{},readCommunitiesForAccess:async()=>{state.rosterCalls++;return [{community_id:'a',display_name:'Alpha',canonical_name:'alpha'},{community_id:'b',display_name:'Beta'}];},fetchJson:async(path,options)=>{const input=JSON.parse(options.body);state.calls.push({path,options,input});return state.reply?state.reply(input,options):rows(input.p_community_ids,input.p_periods);}};
 return {state,central};
}
{
 const {state,central}=fake(),d=deferred();state.reply=()=>d.promise;
 const a=readFinance(central,['a'],periods,{readMode:'presentation'}),b=readFinance(central,['a'],periods,{readMode:'presentation'});await tick();assert.equal(state.calls.length,1);assert.deepEqual(state.calls[0].input,{p_community_ids:['a'],p_periods:periods});assert(state.calls[0].options.signal instanceof AbortSignal);
 d.resolve(rows(['a'],periods));const [one,two]=await Promise.all([a,b]);one[0].summary.revenue.actual=999;assert.equal(two[0].summary.revenue.actual,0);state.reply=null;await readFinance(central,['a'],periods,{readMode:'presentation'});assert.equal(state.calls.length,2,'completed financial reads are not cached');
 await Promise.all([readFinance(central,['a'],periods),readFinance(central,['a'],periods)]);assert.equal(state.calls.length,4,'canonical default/postwrite reads stay fresh');
}
{
 const {state,central}=fake(),d=deferred(),a=new AbortController(),b=new AbortController();state.reply=()=>d.promise;
 const one=readFinance(central,['a'],periods,{readMode:'presentation',signal:a.signal}),two=readFinance(central,['a'],periods,{readMode:'presentation',signal:b.signal});await tick();a.abort();await assert.rejects(one,{name:'AbortError'});assert.equal(state.calls[0].options.signal.aborted,false,'one navigation must not cancel another consumer');d.resolve(rows(['a'],periods));await two;
 const end=deferred();state.reply=()=>end.promise;const c=new AbortController(),four=readFinance(central,['a'],periods,{readMode:'presentation',signal:c.signal});await tick();c.abort();await assert.rejects(four,{name:'AbortError'});assert.equal(state.calls.at(-1).options.signal.aborted,true,'last departing consumer aborts fetch');end.resolve(rows(['a'],periods));await tick();
}
for(const mutate of[(s)=>s.actor='actor-2',(s)=>s.profile={...s.profile,allowed_community_ids:['b']},(s)=>s.profile={...s.profile,status:'disabled'},(s)=>s.backend='https://other.invalid']){
 const {state,central}=fake(),d=deferred();state.reply=()=>d.promise;const request=readFinance(central,['a'],periods,{readMode:'presentation'});await tick();mutate(state);d.resolve(rows(['a'],periods));await assert.rejects(request,/Session.*changed/);
}
{
 const {state,central}=fake(),d=deferred();state.reply=()=>d.promise;const a=readFinance(central,['a'],periods,{readMode:'presentation',versionKey:'head-1'}),b=readFinance(central,['a'],periods,{readMode:'presentation',versionKey:'head-2'});await tick();assert.equal(state.calls.length,2,'different evidence revisions cannot coalesce');invalidateFinanceReads(central);d.resolve(rows(['a'],periods));await assert.rejects(a);await assert.rejects(b);
}
{
 const {state,central}=fake();state.reply=()=>Promise.reject(Error('offline'));await assert.rejects(()=>readFinance(central,['a'],periods,{readMode:'presentation'}),/offline/);state.reply=null;await readFinance(central,['a'],periods,{readMode:'presentation'});assert.equal(state.calls.length,2);
}
{
 const {state,central}=fake(),cache=createCache(central),known=[{community_id:'a',display_name:'Alpha',canonical_name:'alpha'}];
 await cache.refreshScope({communityIds:['a'],periods,communities:known,versionKey:'head-1'});assert.equal(state.rosterCalls,0);assert.equal(state.calls.length,1);assert.deepEqual(state.calls[0].input,{p_community_ids:['a'],p_periods:periods});assert.equal(cache.envelope('Alpha','2026-08').actualCloseVersion,'close-v1');assert.equal(cache.envelope('b','2026-08'),null);
 assert.equal(await cache.refreshScope({communityIds:['a'],periods,communities:known,versionKey:'head-1'}),false);assert.equal(state.calls.length,1);
 await cache.refreshScope({communityIds:['a'],periods:['2026-10'],communities:known});assert.equal(cache.envelope('a','2026-08').actualCloseVersion,'close-v1');assert.equal(cache.envelope('a','2026-10').actualCloseVersion,'close-v1');
 await cache.refreshScope({communityIds:['a'],periods,communities:known,versionKey:'head-2'});assert.equal(state.calls.length,3,'evidence revision invalidates display TTL');
 state.reply=()=>Promise.reject(Error('refresh failed'));await assert.rejects(()=>cache.refreshScope({communityIds:['a'],periods:['2026-08'],communities:known,force:true}),/refresh failed/);assert.equal(cache.envelope('Alpha','2026-08'),null);assert(cache.envelope('Alpha','2026-07'),'unrelated period remains');
 state.actor='actor-2';assert.equal(cache.envelope('a','2026-07'),null,'access change clears old actor data before display');
}
{
 const {state,central}=fake(),cache=createCache(central),older=deferred(),newer=deferred();let n=0;state.reply=()=>++n===1?older.promise:newer.promise;
 const first=cache.refreshScope({communityIds:['a'],periods,communities:[],versionKey:'old'});first.catch(()=>{});await tick();const second=cache.refreshScope({communityIds:['a'],periods,communities:[],force:true,versionKey:'new'});await tick();newer.resolve(rows(['a'],periods,'new'));await second;older.resolve(rows(['a'],periods,'old'));await assert.rejects(first,{name:'AbortError'});assert.equal(cache.envelope('a','2026-08').actualCloseVersion,'close-new','late older read cannot overwrite postwrite/fresh evidence');
}
{
 const {state,central}=fake(),cache=createCache(central),roster=deferred(),controller=new AbortController();central.readCommunitiesForAccess=()=>roster.promise;
 const request=cache.refreshScope({communityIds:['a'],periods,signal:controller.signal});controller.abort();await assert.rejects(request,{name:'AbortError'});assert.equal(state.calls.length,0);roster.resolve([]);await tick();
}
console.log('PASS exact scoped reads, version/access/backend isolation, independent coalesced consumers, cancellation, fresh postwrite reads, no failed-result cache and late-response protection');

{
 const {state,central}=fake(),cache=createCache(central),d=deferred(),controller=new AbortController();state.reply=()=>d.promise;const one=cache.refreshScope({communityIds:['a'],periods,communities:[]}),two=cache.refreshScope({communityIds:['a'],periods,communities:[],signal:controller.signal});await tick();controller.abort();await assert.rejects(two,{name:'AbortError'});d.resolve(rows(['a'],periods));await one;assert(cache.envelope('a','2026-08'),'canceling one cache consumer cannot suppress the other');
}
