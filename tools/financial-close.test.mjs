import assert from 'node:assert/strict';
import {coverage,contract,createCache,projectBuilderActuals} from '../docs/portfolio-operations-dashboard/features/financial-close.mjs';
const versions=[2,3,4,5,6,7,8].map(m=>({version_id:'v'+m,community_id:'id',period_key:`2026-${String(m).padStart(2,'0')}`,status:'closed',coverage:'full_month',metrics:{netRentalIncome:0,grossPotentialRent:100}}));
assert.deepEqual(coverage(versions,2026),{first:2,last:8,missing:[1],completeYtd:false});
assert.equal(coverage(versions.filter(v=>v.period_key!=='2026-07'),2026).last,6);
assert.equal(contract(versions[0]).netRentalIncome,0);
assert.equal(contract({...versions[0],metrics:{grossPotentialRent:100}}).netRentalIncome,null);
let calls=0;const cache=createCache({readCommunitiesForAccess:async()=>[{community_id:'id',display_name:'Community',canonical_name:'community'}],fetchJson:async p=>{calls++;return p.startsWith('/atlas_financial_close_heads')?versions.map(v=>({version_id:v.version_id,community_id:'id'})):versions;}});
await Promise.all([cache.refresh(2026),cache.refresh(2026)]);assert.equal(calls,2);assert.equal(cache.get('Community','2026-08').version_id,'v8');assert.equal(cache.get('Community','2026-09'),null);cache.clear();assert.equal(cache.get('Community','2026-08'),null);
console.log('PASS closed scope, period gaps, missing vs zero, duplicate refresh coalescing and cleanup');

const state={actuals:{old:{propertyId:'DORO',year:2026,monthly:Array(12).fill(0)}},periods:{'DORO|2026':{closedThrough:6}}};
const projection=projectBuilderActuals(state,'DORO',new Map([['DORO|2026',{rows:new Map([['5120',{monthly:[null,0,100,null,null,null,null,100,null,null,null,null]}]]),versions,coverage:coverage(versions,2026)}]]));
assert.equal(projection.periods['DORO|2026'].closedThrough,8);assert.equal(state.periods['DORO|2026'].closedThrough,6);assert.equal(projection.actuals.old,undefined);assert.equal(projection.actuals['DORO|5120|2026'].monthly[0],null);assert.equal(projection.actuals['DORO|5120|2026'].monthly[1],0);assert.equal(projection.periods['DORO|2026'].canonicalVersions['2026-08'],'v8');
console.log('PASS read-only publication projection supersedes stale legacy markers without mutating saved budgets or actuals');
