import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createOccupancyBudgetStore} from '../docs/portfolio-operations-dashboard/features/occupancy-budget-store.mjs';
let actor='a',fail=false,calls=0;
const central={getSession:()=>({user:{id:actor}}),refreshSession:async()=>{}};
const approved={community_id:'doro',calendar_year:2026,status:'locked',version_id:'v1',content_hash:'hash',covered_months:[0,8],payload:{occupancyPct:[0,null,null,null,null,null,null,null,56.085994]}};
const store=createOccupancyBudgetStore(central,{read:async(_,id)=>{calls++;if(fail)throw Error('offline');return id==='doro'?[approved]:[];},readReforecasts:async()=>[]});
const entries=[{name:'Doro',recordId:'community:doro',communityId:'doro',year:2026},{name:'Other',recordId:'community:other',communityId:'other',year:2026}];
await Promise.all([store.hydrate(entries),store.hydrate(entries)]);assert.equal(calls,2);
const core=fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const c=vm.createContext({console,window:{AtlasOccupancyBudgets:store},Date});
for(const f of core.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm))vm.runInContext(f[0],c);
const record={communityId:'community:doro',reportYear:2026,savedBudgetTargets:Array(12).fill(47.6),monthlyData:Array.from({length:12},()=>({budgetOcc:47.6}))};
assert.equal(c.getRecordSavedBudgetOccPct(record,8,2026),56.085994,'locked budget takes precedence over stale curve');
assert.equal(c.getRecordSavedBudgetOccPct(record,0,2026),0,'approved zero remains available');
assert.equal(c.getRecordSavedBudgetOccPct(record,7,2026),null,'canonical missing month cannot fall back to stale curve');
assert.equal(c.getRecordSavedBudgetOccPct({...record,communityId:'community:other'},8,2026),null,'communities without an approved original/reforecast do not promote a saved curve');
assert.equal(c.getRecordSavedBudgetOccPct(record,8,2025),null,'no cross-year budget substitution');
assert.equal(c.getRecordSavedBudgetOccPct(JSON.parse(JSON.stringify(record)),8,2026),56.085994,'reload preserves canonical resolution');
const revision=store.revision;store.clear();assert.notEqual(store.revision,revision);fail=true;await store.hydrate(entries);
assert.equal(c.getRecordSavedBudgetOccPct(record,8,2026),null,'failed shared read never silently returns stale curve');
assert.equal(store.get(record,8,2026).status,'error');
fail=false;store.clear();await store.hydrate(entries);actor='b';assert.equal(store.get(record,8,2026).status,'loading','access change cannot reuse another actor evidence');
let release;const delayed=createOccupancyBudgetStore(central,{read:()=>new Promise(resolve=>{release=resolve;}),readReforecasts:async()=>[]});const task=delayed.hydrate(entries.slice(0,1));await new Promise(resolve=>setImmediate(resolve));delayed.clear();release([approved]);await task;assert(!delayed.ready(entries.slice(0,1)),'clear discards in-flight completion');
console.log('PASS all-community budget precedence, approved zero, missing coverage/year, saved curve rejection, reload, request deduplication, errors and access/in-flight invalidation.');

const untouched=JSON.stringify(record);
const publication={communityId:'doro',activePeriods:['2026-09'],verified:true,approved:true,locked:true,contentHash:'publication-hash',revisionId:'revision-v2',publicationId:'publication-v2',snapshot:{leasing:[{period:'2026-09',sourceKind:'forecast',occupancy:.88,units:100}]}};
async function scope(versions,publications=[]){
 const next=createOccupancyBudgetStore(central,{read:async()=>versions,readReforecasts:async()=>publications});
 await next.hydrate(entries.slice(0,1));c.window.AtlasOccupancyBudgets=next;return next;
}
for(const pct of [null,'97',NaN,-1,101]){
 await scope([{...approved,payload:{occupancyPct:Array(12).fill(pct)}}]);
 assert.equal(c.getRecordSavedBudgetOccPct(record,8,2026),null,'invalid approved percentage cannot revive legacy curve');
}
await scope([approved,approved]);assert.equal(c.getRecordSavedBudgetOccPct(record,8,2026),null,'overlapping originals are unavailable');
await scope([{...approved,status:'draft'}]);assert.equal(c.getRecordSavedBudgetOccPct(record,8,2026),null,'draft does not become approved');
let current=await scope([approved],[publication]);assert.equal(c.getRecordSavedBudgetOccPct(record,8,2026),88);
assert.equal(current.get(record,8,2026).publicationId,'publication-v2');assert.equal(current.get(record,8,2026).contentHash,'publication-hash');
await scope([], [{...publication,snapshot:{leasing:[{...publication.snapshot.leasing[0],occupancy:0}]}}]);assert.equal(c.getRecordSavedBudgetOccPct(record,8,2026),0,'approved reforecast zero remains available without an original');
await scope([approved],[{...publication,verified:false}]);assert.equal(c.getRecordSavedBudgetOccPct(record,8,2026),null,'failed active baseline cannot fall back to an older original');
await scope([approved],[publication,publication]);assert.equal(c.getRecordSavedBudgetOccPct(record,8,2026),null,'overlapping active baselines are unavailable');
delete c.window.AtlasOccupancyBudgets;assert.equal(c.getRecordSavedBudgetOccPct(record,8,2026),null,'unhydrated view cannot use a legacy curve');
assert.equal(JSON.stringify(record),untouched,'readback never rewrites source or history');

// Use the real module graph and transport adapters, allowing only their two read routes.
const cid='10000000-0000-0000-0000-000000000001',transportCalls=[],transport={getSession:()=>({user:{id:'authorized-fixture'}}),refreshSession:async()=>{},fetchJson:async(url,options={})=>{
 transportCalls.push({url,options});
 if(url.startsWith('/atlas_approved_budget_versions?'))return [{...approved,community_id:cid}];
 if(url==='/rpc/atlas_read_active_reforecast')return [];
 throw Error('Unexpected transport: '+url);
}};
const real=createOccupancyBudgetStore(transport);await real.hydrate([{name:'Synthetic',recordId:'synthetic',communityId:cid,year:2026}]);
assert.equal(real.get({communityId:'synthetic'},8,2026).pct,56.085994);
assert.equal(transportCalls.length,2);assert(transportCalls.some(call=>call.url.includes('calendar_year=eq.2026')));
const rpcCall=transportCalls.find(call=>call.url==='/rpc/atlas_read_active_reforecast'),body=JSON.parse(rpcCall.options.body);
assert.deepEqual(body.p_community_ids,[cid]);assert.equal(body.p_periods.length,12);assert.equal(body.p_periods[8],'2026-09');
console.log('PASS approved original/reforecast/missing parity, invalid/overlap rejection, immutable sources and real read-only transport scope.');

// The real transport rejects an annual response when one active month is invalid.
// An exact-period retry must not carry that failure (or a sibling's successful
// verification) into another month of the same publication.
const isolatedCalls=[],isolatedOriginal={...approved,community_id:cid,covered_months:[0,7,8],payload:{occupancyPct:Array(12).fill(92)}};
const multiPeriod={...publication,communityId:cid,activePeriods:['2026-08','2026-09'],snapshot:{leasing:[
 {period:'2026-08',sourceKind:'forecast',occupancy:.86,units:100},
 {period:'2026-09',sourceKind:'forecast',occupancy:.88,units:100}
]}};
let unavailableAll=false;
const isolatedTransport={...transport,fetchJson:async(url,options={})=>{
 if(url.startsWith('/atlas_approved_budget_versions?'))return [isolatedOriginal];
 assert.equal(url,'/rpc/atlas_read_active_reforecast');
 const request=JSON.parse(options.body);isolatedCalls.push(request.p_periods);
 if(unavailableAll)throw Error('Reforecast service unavailable');
 return request.p_periods.some(period=>multiPeriod.activePeriods.includes(period))
  ? [{...multiPeriod,verified:!request.p_periods.includes('2026-08')}] : [];
}};
const isolated=createOccupancyBudgetStore(isolatedTransport),isolatedEntries=[{name:'Synthetic',recordId:'synthetic',communityId:cid,year:2026}];
await isolated.hydrate(isolatedEntries);
assert.equal(isolatedCalls[0].length,12,'healthy batches retain one yearly request');
assert.equal(isolatedCalls.length,13,'failed batch is verified at exact period scope');
assert(isolatedCalls.slice(1).every(periods=>periods.length===1));
assert.equal(isolated.get({communityId:'synthetic'},0,2026).pct,92,'unaffected original survives a failed active publication in another month');
assert.equal(isolated.get({communityId:'synthetic'},8,2026).pct,88,'valid sibling month of the same publication remains available');
const invalidMonth=isolated.get({communityId:'synthetic'},7,2026);
assert.equal(invalidMonth.status,'error');assert.equal(invalidMonth.pct,undefined,'failed active month cannot fall back to its older original or reuse sibling verification');
assert.match(invalidMonth.reason,/this month/);
unavailableAll=true;isolated.clear();await isolated.hydrate(isolatedEntries);
assert.equal(isolated.get({communityId:'synthetic'},0,2026).status,'error','an unverified active-head read cannot treat an original as current');
assert.equal(isolated.get({communityId:'synthetic'},8,2026).status,'error');
let fallbackCalls=0;const releases=[];
const interrupted=createOccupancyBudgetStore(central,{read:async()=>[approved],readReforecasts:async(_,options)=>{
 fallbackCalls++;if(options.periods.length>1)throw Error('Annual read rejected');
 return new Promise(resolve=>releases.push(resolve));
}});
const interruptedTask=interrupted.hydrate(entries.slice(0,1));await new Promise(resolve=>setImmediate(resolve));
assert.equal(releases.length,4,'period retries have bounded concurrency');
interrupted.clear();for(const resolve of releases)resolve([]);await interruptedTask;
assert.equal(fallbackCalls,5,'invalidated reads stop before scheduling more periods');
assert.equal(interrupted.ready(entries.slice(0,1)),false,'late period retries cannot repopulate cleared evidence');
console.log('PASS exact-period failure isolation across original budgets and shared publications; affected periods and full transport failures remain unavailable.');
