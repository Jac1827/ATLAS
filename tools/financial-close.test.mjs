import assert from 'node:assert/strict';
import {coverage,contract,createCache,projectBuilderActuals} from '../docs/portfolio-operations-dashboard/features/financial-close.mjs';
const versions=[2,3,4,5,6,7,8].map(m=>({version_id:'v'+m,community_id:'id',period_key:`2026-${String(m).padStart(2,'0')}`,status:'closed',coverage:'full_month',metrics:{netRentalIncome:0,grossPotentialRent:100}}));
assert.deepEqual(coverage(versions,2026),{first:2,last:8,missing:[1],firstExpectedMonth:1,completeYtd:false});
assert.equal(coverage(versions.filter(v=>v.period_key!=='2026-07'),2026).last,8);
assert.equal(contract(versions[0]).netRentalIncome,0);
assert.equal(contract({...versions[0],metrics:{grossPotentialRent:100}}).netRentalIncome,null);
let calls=0;const cache=createCache({readCommunitiesForAccess:async()=>[{community_id:'id',display_name:'Community',canonical_name:'community'}],fetchJson:async()=>{calls++;return versions.map(v=>({community_id:'id',period_key:v.period_key,summary:{effectiveBaseline:{status:'unavailable',communityId:'id',period:v.period_key,reason:'missing_baseline'},registryVersion:'atlas-finance-v1',communityId:'id',period:v.period_key,close:v}}));}});
await Promise.all([cache.refresh(2026),cache.refresh(2026)]);assert.equal(calls,1);assert.equal(cache.get('Community','2026-08').version_id,'v8');assert.equal(cache.get('Community','2026-09'),null);cache.clear();assert.equal(cache.get('Community','2026-08'),null);
console.log('PASS closed scope, period gaps, missing vs zero, duplicate refresh coalescing and cleanup');

const state={actuals:{old:{propertyId:'DORO',year:2026,monthly:Array(12).fill(0)}},periods:{'DORO|2026':{closedThrough:6}}};
const projection=projectBuilderActuals(state,'DORO',new Map([['DORO|2026',{rows:new Map([['5120',{monthly:[null,0,100,null,null,null,null,100,null,null,null,null]}]]),versions,coverage:coverage(versions,2026)}]]));
assert.equal(projection.periods['DORO|2026'].closedThrough,8);assert.equal(state.periods['DORO|2026'].closedThrough,6);assert.equal(projection.actuals.old,undefined);assert.equal(projection.actuals['DORO|5120|2026'].monthly[0],null);assert.equal(projection.actuals['DORO|5120|2026'].monthly[1],0);assert.equal(projection.periods['DORO|2026'].canonicalVersions['2026-08'],'v8');
console.log('PASS read-only publication projection supersedes stale legacy markers without mutating saved budgets or actuals');

assert.deepEqual(coverage(versions.slice(3).map(v=>({...v,financeEnvelope:{firstExpectedFinancialPeriod:'2026-05'}})),2026).missing,[]);
const {applyEffectiveBuilderTargets}=await import('../docs/portfolio-operations-dashboard/features/financial-close.mjs');
const monthlyFinance=[1,2].map(month=>({period_key:'2026-0'+month,summary:{effectiveBaseline:{status:'available',verified:true,approved:true,locked:true,sourceType:month===1?'original_budget':'approved_reforecast',versionId:'version-'+month,publicationId:month===1?null:'pub',contentHash:'hash-'+month,lines:[{accountCode:'5120',nature:'income',amount:month===1?100:140}]}}}));
const approvedRow=applyEffectiveBuilderTargets({gl:'5120',budget:Array(12).fill(999)},{finance:monthlyFinance,versions:[],budget:{payload:{rows:[{glCode:'5120',monthly:Array(12).fill(100)}]}},coverage:{completeYtd:true,firstExpectedMonth:1,last:2}},2026);
assert.deepEqual(approvedRow.budget.slice(0,3),[100,140,null]);assert.equal(approvedRow.ytdBudget,240);assert.equal(approvedRow.ytdOriginalBudget,200);assert.equal(approvedRow.fullYearBudget,null);assert.equal(approvedRow.remainingBudget,null);assert.equal(approvedRow.baselineEvidence['2026-02'].publicationId,'pub');assert.equal(approvedRow.canonicalNature,'income');
const missingRow=applyEffectiveBuilderTargets({gl:'5120',budget:Array(12).fill(999)},{finance:monthlyFinance.slice(0,1),versions:[],coverage:{completeYtd:true,firstExpectedMonth:1,last:2}},2026);assert.equal(missingRow.ytdBudget,null);assert.equal(missingRow.budget[1],null);
console.log('PASS legacy Budget variance uses each verified monthly baseline, retains original comparator and rejects incomplete yearly evidence');
