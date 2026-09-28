import assert from 'node:assert/strict';
import {createCache,isGovernedEconomicClose,latestClosedEnvelope} from '../docs/portfolio-operations-dashboard/features/financial-close.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const known=[{community_id:'community-a',display_name:'Community A',canonical_name:'community-a-canonical'},{community_id:'community-b',display_name:'Community B'}];
function envelope(period,{communityId='community-a',nri=80,gpr=100,version='version-'+period,...extra}={}){
 return {communityId,period,registryVersion:'atlas-finance-v1',periodState:'locked',actualCloseVersion:version,
  effectiveBaseline:{status:'unavailable',communityId,period,reason:'No approved comparison'},
  close:{community_id:communityId,period_key:period,version_id:version,status:'closed',coverage:'full_month',source_file:'accounting-package.xlsx',approved_by:'accounting-approver',approved_at:period+'-28T12:00:00Z',metrics:{netRentalIncome:nri,grossPotentialRent:gpr}},...extra};
}
const row=summary=>({community_id:summary.communityId,period_key:summary.period,summary});
const valid=envelope('2026-08');
assert(isGovernedEconomicClose(valid));
assert(isGovernedEconomicClose({period:valid.period,close:valid.close}),'Optional transport metadata is already checked by readFinance');
assert.equal(isGovernedEconomicClose({close:valid.close}),false,'The enclosing publication must identify the same exact month');
for(const nri of [0,-20,'0','-20'])assert(isGovernedEconomicClose(envelope('2026-08',{nri})),'Zero and signed closed NRI are valid');
for(const patch of [{periodState:'reopened'},{periodState:'superseded'},{status:'reopened'},{status:'superseded'},{period:'2026-07'},{communityId:'community-b'},{actualCloseVersion:'superseded-version'}])assert.equal(isGovernedEconomicClose({...valid,...patch}),false);
for(const patch of [{status:'open'},{status:'reopened'},{status:'superseded'},{coverage:'mtd'},{coverage:'partial_month'},{period_key:'2026-13'},{source_file:''},{source_file:'   '},{approved_by:null},{approved_at:''}])assert.equal(isGovernedEconomicClose({...valid,close:{...valid.close,...patch}}),false);
for(const nri of [null,undefined,' ',NaN,Infinity,false])assert.equal(isGovernedEconomicClose({...valid,close:{...valid.close,metrics:{...valid.close.metrics,netRentalIncome:nri}}}),false);
for(const gpr of [0,-1,null,undefined,' ',NaN,Infinity,true])assert.equal(isGovernedEconomicClose({...valid,close:{...valid.close,metrics:{...valid.close.metrics,grossPotentialRent:gpr}}}),false);
assert.equal(isGovernedEconomicClose(valid,{communityId:'community-b'}),false);
assert.equal(isGovernedEconomicClose(valid,{period:'2026-07'}),false);
const history=[envelope('2026-03'),envelope('2025-12'),envelope('2026-01'),envelope('2026-02',{periodState:'reopened'})],before=JSON.stringify(history);
assert.equal(latestClosedEnvelope(history,'2026-02').period,'2026-01');
assert.equal(latestClosedEnvelope(history,'2025-12').period,'2025-12');
assert.equal(latestClosedEnvelope(history,'2025-11'),null);
assert.equal(latestClosedEnvelope(history,'bad'),null);
assert.equal(latestClosedEnvelope([...history,envelope('2026-03',{version:'ambiguous-version'})],'2026-03'),null,'Ambiguous latest versions cannot silently substitute an older month');
assert.equal(latestClosedEnvelope([valid,envelope('2026-07',{communityId:'community-b'})],'2026-08'),null,'Unscoped mixed communities cannot choose a financial source');
assert.equal(latestClosedEnvelope([valid,envelope('2026-07',{communityId:'community-b'})],'2026-08',{communityId:'community-a'}),valid);
assert.equal(JSON.stringify(history),before,'Latest selection cannot sort or edit source evidence');

function fixture(){
 const state={actor:'actor-a',profile:{role:'regional',status:'active',allowed_community_ids:['community-a','community-b']},calls:0,reply:()=>[]};
 const central={getSession:()=>({user:{id:state.actor}}),getStoredProfile:()=>state.profile,refreshSession:async()=>{},readCommunitiesForAccess:async()=>known,
  fetchJson:async(path,options)=>{assert.equal(path,'/rpc/atlas_read_finance');state.calls++;return state.reply(JSON.parse(options.body));}};
 return {state,cache:createCache(central)};
}
{
 const {state,cache}=fixture(),pending=deferred(),periods=['2025-12','2026-01','2026-02'];state.reply=()=>pending.promise;
 assert.equal(cache.scopeState('Community A',periods),'loading');
 const load=cache.refreshScope({communityIds:['community-a'],periods,communities:known});
 assert.equal(cache.scopeState('Community A',periods),'loading');
 assert.equal(cache.latestClosed('Community A','2026-02'),null);
 pending.resolve([row(envelope('2025-12')),row(envelope('2026-01',{nri:0})),row(envelope('2026-02',{periodState:'reopened'}))]);await load;
 assert.equal(cache.scopeState('Community A',periods),'ready');assert.equal(cache.scopeState('community-a-canonical',periods),'ready');
 assert.equal(cache.latestClosed('Community A','2026-02').period_key,'2026-01');
 assert.equal(cache.latestClosed('Community A','2025-12').period_key,'2025-12');
 assert.equal(cache.isGovernedEconomicClose(cache.envelope('Community A','2026-02')),false);
 assert.equal(cache.scopeState('Community B',periods),'loading');assert.equal(cache.latestClosed('Community B','2026-02'),null);
 assert.equal(await cache.refreshScope({communityIds:['community-a'],periods,communities:known}),false);assert.equal(state.calls,1,'Existing fresh scope deduplication remains intact');
 state.reply=()=>[];await cache.refreshScope({communityIds:['community-a'],periods:['2026-03'],communities:known});
 assert.equal(cache.scopeState('Community A',['2026-03']),'ready');assert.equal(cache.envelope('Community A','2026-03'),null,'Completed empty read is missing evidence, not loading');
 state.reply=()=>Promise.reject(Error('Financial connection unavailable'));
 await assert.rejects(()=>cache.refreshScope({communityIds:['community-a'],periods:['2026-01'],communities:known,force:true}),/Financial connection/);
 assert.equal(cache.scopeState('Community A',['2026-01']),'failed');assert.equal(cache.envelope('Community A','2026-01'),null);
 assert.equal(cache.scopeState('Community A',['2025-12']),'ready');assert.equal(cache.latestClosed('Community A','2026-01').period_key,'2025-12','A failed requested cell cannot remove unrelated closed evidence');
 state.reply=()=>[row(envelope('2026-01',{nri:-5}))];await cache.refreshScope({communityIds:['community-a'],periods:['2026-01'],communities:known,force:true});
 assert.equal(cache.scopeState('Community A',['2026-01']),'ready');assert.equal(cache.latestClosed('Community A','2026-01').metrics.netRentalIncome,-5);
 state.profile={...state.profile,allowed_community_ids:['community-b']};
 assert.equal(cache.scopeState('Community A',['2026-01']),'loading');assert.equal(cache.latestClosed('Community A','2026-01'),null,'Changed authorization clears close evidence and completion state');
}
{
 const {state,cache}=fixture(),pending=deferred(),controller=new AbortController(),periods=['2026-08'];state.reply=()=>pending.promise;
 const one=cache.refreshScope({communityIds:['community-a'],periods,communities:known}),two=cache.refreshScope({communityIds:['community-a'],periods,communities:known,signal:controller.signal});await tick();
 assert.equal(state.calls,1);controller.abort();await assert.rejects(two,{name:'AbortError'});assert.equal(cache.scopeState('Community A',periods),'loading');
 pending.resolve([row(valid)]);await one;assert.equal(cache.scopeState('Community A',periods),'ready');
 const canceled=deferred(),cancel=new AbortController();state.reply=()=>canceled.promise;
 const refresh=cache.refreshScope({communityIds:['community-a'],periods,communities:known,force:true,signal:cancel.signal});await tick();assert.equal(cache.scopeState('Community A',periods),'loading');
 cancel.abort();canceled.resolve([row(envelope('2026-08',{version:'canceled-version'}))]);await assert.rejects(refresh,{name:'AbortError'});assert.equal(cache.scopeState('Community A',periods),'ready','Canceled navigation restores the prior completed state');
 await tick();assert.equal(cache.get('Community A','2026-08').version_id,valid.close.version_id);
}
{
 const {state,cache}=fixture(),older=deferred(),newer=deferred(),periods=['2026-08'];let calls=0;state.reply=()=>++calls===1?older.promise:newer.promise;
 const old=cache.refreshScope({communityIds:['community-a'],periods,communities:known});old.catch(()=>{});await tick();
 const current=cache.refreshScope({communityIds:['community-a'],periods,communities:known,force:true});await tick();
 newer.resolve([row(envelope('2026-08',{version:'replacement'}))]);await current;older.resolve([row(valid)]);await assert.rejects(old,{name:'AbortError'});
 assert.equal(cache.scopeState('Community A',periods),'ready');assert.equal(cache.latestClosed('Community A','2026-08').version_id,'replacement');
 const pending=deferred();state.reply=()=>pending.promise;const scoped=cache.refreshScope({communityIds:['community-a'],periods,communities:known,force:true});scoped.catch(()=>{});await tick();
 state.actor='actor-b';assert.equal(cache.scopeState('Community A',periods),'loading');pending.resolve([row(valid)]);await assert.rejects(scoped);
 assert.equal(cache.scopeState('Community A',periods),'loading');assert.equal(cache.latestClosed('Community A','2026-08'),null,'Late prior-account response cannot restore data or ready state');
}
console.log('PASS governed closed economic evidence, signed/zero values, latest eligible month, exact-community cache states, empty/failure distinctions, coalescing, cancellation and access/late-response isolation');
