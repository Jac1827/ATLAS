import test from 'node:test';
import assert from 'node:assert/strict';
import {occupancyBudgetForPeriod,installCommunityGoalPlanning,readCommunityGoalInventory,readLockedOccupancyBudgets} from '../docs/portfolio-operations-dashboard/features/community-goal-planning.mjs';
const cid='10000000-0000-0000-0000-000000000001',period='2026-09';
const budget=()=>({community_id:cid,period_key:period,summary:{targetApprovalStatus:'approved',budgetVersion:'original',budgetContentHash:'original-hash',occupancyPct:47.6}});
const active=()=>({communityId:cid,publicationId:'new-vp',revisionId:'new-vp-revision',contentHash:'vp-hash',activePeriods:[period],verified:true,approved:true,locked:true,investorStatus:'pending_investor_approval',snapshot:{leasing:[{period,sourceKind:'forecast',occupancy:0.6,units:247,source:{kind:'approved_occupancy'}}]}});
const sources=()=>({snapshot:{status:'valid',communityId:cid,period,sourceFingerprint:'box-hash',asOf:'2026-09-28',rentableUnits:247,measurementBasis:'units',occupiedUnits:78,leasedUnits:115},closing:{status:'valid',kind:'application_to_lease_activity',communityId:cid,period,sourceFingerprint:'activity-hash',asOf:'2026-09-28',applications:15,leases:1},pipeline:{status:'valid',communityId:cid,sourceFingerprint:'roll-hash',period:'2026-09',asOf:'2026-09-28',signedVacantUnits:37,complete:false,undatedUnits:34,datedMoveIns:[{date:'2026-10-27',count:1},{date:'2026-12-01',count:2}]}});
test('latest active VP occupancy supersedes original and older investor; unavailable latest never falls back',()=>{
 const f=budget(),p=active();let r=occupancyBudgetForPeriod({communityId:cid,period,finance:[f],publications:[p,{...p,publicationId:'old-investor',activePeriods:[],investorStatus:'investor_approved'}]});assert.equal(r.occupancyPct,60);assert.equal(r.publicationId,'new-vp');
 p.snapshot.leasing=[];r=occupancyBudgetForPeriod({communityId:cid,period,finance:[f],publications:[p]});assert.equal(r.status,'unavailable');
 p.snapshot.leasing=[{period,sourceKind:'closed_actual',occupancy:0.1,units:247}];assert.equal(occupancyBudgetForPeriod({communityId:cid,period,finance:[f],publications:[p]}).status,'unavailable','Closed actual occupancy is not a budget target');
 f.summary.effectiveBaseline={sourceType:'approved_reforecast',publicationId:'missing'};assert.equal(occupancyBudgetForPeriod({communityId:cid,period,finance:[f],publications:[]}).status,'unavailable');
 delete f.summary.effectiveBaseline;f.summary.occupancyPct=0;assert.equal(occupancyBudgetForPeriod({communityId:cid,period,finance:[f]}).occupancyPct,0);
 assert.equal(occupancyBudgetForPeriod({communityId:cid,period,finance:[f,f]}).status,'unavailable');
});
function hostFixture(){
 let actor='actor',version=1,allowed=true;const listeners={},model={propName:'Doro',year:2026,monthIdx:8,corporateUnits:26,record:{}};
 const approved={version:3,applicationGoal:0,netLeaseGoal:0};
 const host={ATLAS_CENTRAL:{getSession:()=>actor?({user:{id:actor}}):null,getStoredProfile:()=>({user_id:actor,role:'executive',status:'active',version}),fetchJson:async()=>[{community_id:cid,units:247,version:1,updated_at:'2026-09-28T00:00:00Z',review_status:'clean',review_flags:[]}]},atlasAccessDecision:()=>({ok:allowed}),getAtlasCommunityAccessRecord:()=>({atlasCommunityId:cid}),getAtlasTodayISODate:()=> '2026-09-28',getProp:()=>({name:'Doro'}),getCurrentCommunityRecord:()=>model.record,buildCommunityCommandModel:()=>model,buildCommunityCommandLeasingPlanRows:()=>Array.from({length:12},(_,idx)=>({monthIdx:idx,month:String(idx+1),approved,approvedApps:0,approvedNetLeases:0,occupancy:{beginningStatus:'Missing'},recommendedApps:65,netLeaseGoal:100})),renderCommunityCommandLeasingPlan:()=> 'old',renderCommunityCommandGoalEditor:()=>'',renderCommunityCommandKpi:(...args)=>args,getCommunityCommandTrendPoints:()=>[{idx:8,leased:40,budget:95}],approveCommunityCommandMonthlyGoals:()=> 'opened',renderTab(){},addEventListener:(name,fn)=>listeners[name]=fn};
 return {host,model,listeners,changeActor:()=>actor='other',changeScope:()=>version++,deny:()=>allowed=false};
}
test('current UI reads canonical budget, shows source minimums, preserves human zeroes and never saves finance',async()=>{
 const {host,model}=hostFixture(),requests=[];
 const api=installCommunityGoalPlanning({host,readSources:sources,readBudgets:async(_c,ids,periods,options)=>{requests.push({ids,periods,options});return[budget()];},readPublications:async()=>[]});
 await api.hydrate(model);const m=host.buildCommunityCommandModel(),row=host.buildCommunityCommandLeasingPlanRows(m)[8];
 assert.equal(m.leasedPct,115/247*100);assert.equal(row.planningRecommendation.minimumApplications,45);assert.equal(row.approvedApps,0);assert.equal(row.recommendedApps,null);assert.equal(row.approvedNetLeases,0);assert.equal(row.leasedGoal,47.6);
 assert.deepEqual(requests[0].ids,[cid]);assert.equal(requests[0].periods.length,12);assert.equal(requests[0].options,undefined);
 const html=host.renderCommunityCommandLeasingPlan(m);assert.match(html,/46.56%/);assert.match(html,/47.60%/);assert.match(html,/data-minimum-applications>45/);assert.match(html,/2026-09-28/);assert.match(html,/34/);assert.doesNotMatch(html,/65%|seasonality/);
 const kpi=host.renderCommunityCommandKpi(m,'leased_occupancy','Leased',40,x=>x,'old','good',2);assert.match(kpi[5],/115 leased of 247 reported/);assert.equal(host.getCommunityCommandTrendPoints(m)[0].leased,115/247*100);
 assert.equal(await host.approveCommunityCommandMonthlyGoals(8),'opened');
});
test('actor/profile/scope changes while read pending cannot install recommendations',async()=>{
 for(const change of ['changeActor','changeScope','deny']){
  const f=hostFixture();let release;const api=installCommunityGoalPlanning({host:f.host,readSources:sources,readBudgets:()=>new Promise(resolve=>release=resolve),readPublications:async()=>[]});const pending=api.hydrate(f.model);f[change]();release([budget()]);await pending;assert.equal(api.evidence(f.model,8).budgetPct,null);
 }
 const f=hostFixture();let release;const api=installCommunityGoalPlanning({host:f.host,readSources:sources,readBudgets:()=>new Promise(resolve=>release=resolve),readPublications:async()=>[]});const pending=api.hydrate(f.model);f.listeners['atlas-finance-updated']();release([budget()]);await pending;assert.equal(api.evidence(f.model,8).budgetPct,null);
});
test('denied synchronous renders never inspect retained source records',()=>{
 const f=hostFixture();let sourceReads=0;f.deny();const api=installCommunityGoalPlanning({host:f.host,readSources:()=>{sourceReads++;return sources();},readBudgets:async()=>[],readPublications:async()=>[]});
 assert.equal(api.evidence(f.model,8).actualLeasedPct,null);assert.equal(f.host.buildCommunityCommandModel().leasedPct,null);assert.equal(sourceReads,0);
});
test('original approved percentage requires explicit verified Settings inventory before goal counts',async()=>{
 const f=hostFixture(),inventory=await readCommunityGoalInventory(f.host.ATLAS_CENTRAL,cid);
 assert.equal(inventory.units,247);assert.equal(inventory.measurementBasis,'units');assert.match(inventory.sourceFingerprint,/^[a-f0-9]{64}$/);assert.equal(inventory.version,1);
 const original=occupancyBudgetForPeriod({communityId:cid,period,finance:[budget()],inventory});assert.equal(original.rentableUnits,247);assert.equal(original.inventory.sourceFingerprint,inventory.sourceFingerprint);
 const unknown=occupancyBudgetForPeriod({communityId:cid,period,finance:[budget()]});assert.equal(unknown.occupancyPct,47.6);assert.equal(unknown.rentableUnits,null);
 for(const edit of [r=>r.units=null,r=>r.units=0,r=>r.version=null,r=>r.updated_at='',r=>r.community_id='other',r=>r.review_status='blocked',r=>{r.review_status='review_required';r.review_flags=['unit inventory needs review'];}]){
  const x=hostFixture();x.host.ATLAS_CENTRAL.fetchJson=async()=>{const row={community_id:cid,units:247,version:1,updated_at:'2026-09-28T00:00:00Z',review_status:'clean',review_flags:[]};edit(row);return[row];};await assert.rejects(readCommunityGoalInventory(x.host.ATLAS_CENTRAL,cid));
 }
 const x=hostFixture();let finish;const pending=readCommunityGoalInventory({...x.host.ATLAS_CENTRAL,fetchJson:()=>new Promise(resolve=>finish=resolve)},cid);await new Promise(resolve=>setImmediate(resolve));x.changeScope();finish([{community_id:cid,units:247,version:1,updated_at:'2026-09-28T00:00:00Z',review_status:'clean',review_flags:[]}]);await assert.rejects(pending,/access changed/);
});
test('current goal alerts use explicit approved zeroes and cannot revive old conversion advice',async()=>{
 const f=hostFixture();f.model.plan={currentAppNeed:65,currentGrossLeaseNeed:55,currentMoveInNeed:44,currentGuestCardNeed:200};f.host.getCommunityCommandApprovedGoal=()=>({applicationGoal:0,grossLeaseGoal:0,requiredMoveIns:0});f.host.buildCommunityCommandAlerts=()=>[{id:'lease_pace_risk'},{id:'traffic_volume_watch'},{id:'other'}];
 const api=installCommunityGoalPlanning({host:f.host,readSources:sources,readBudgets:async()=>[budget()],readPublications:async()=>[]});await api.hydrate(f.model);
 let model=f.host.buildCommunityCommandModel();assert.equal(model.plan.currentAppNeed,0);assert.equal(model.plan.currentGrossLeaseNeed,0);assert.equal(model.plan.currentMoveInNeed,0);assert.equal(model.plan.currentGuestCardNeed,null);assert(!f.host.buildCommunityCommandAlerts(model).some(r=>r.id==='traffic_volume_watch'));
 f.host.getCommunityCommandApprovedGoal=()=>null;model=f.host.buildCommunityCommandModel();assert.equal(model.plan.currentAppNeed,null);assert.equal(model.plan.currentGrossLeaseNeed,null);assert.equal(model.plan.currentMoveInNeed,null);assert.deepEqual(f.host.buildCommunityCommandAlerts(model),[{id:'other'}]);assert.equal(f.model.plan.currentAppNeed,65,'Legacy source record is not modified');
});
test('trend uses the same exact-period approved targets as current and future plan rows without changing actuals or approved goals',async()=>{
 const f=hostFixture(),periods=['2026-09','2026-10','2026-11','2026-12'],targets=[56.085994,55.099174,60.383123,64.294217];
 const rows=[7,8,9,10,11].map((idx,i)=>({idx,budget:[34.3,47.6,56.1,55.1,60.4][i],physical:i===1?0:40,leased:42,beginning:38,endingActual:40,endingForecast:null,variance:99,occupancy:{approved:{version:3,occupancyGoal:0},status:'Verified Actual'}}));
 const before=structuredClone(rows);f.host.getCommunityCommandTrendPoints=()=>rows;
 const api=installCommunityGoalPlanning({host:f.host,readSources:sources,readBudgets:async()=>periods.map(period=>({...budget(),period_key:period})),readPublications:async()=>[{...active(),activePeriods:periods,snapshot:{leasing:periods.map((period,i)=>({period,sourceKind:'forecast',occupancy:targets[i]/100,units:247}))}}]});
 await api.hydrate(f.model);const model=f.host.buildCommunityCommandModel(),trend=f.host.getCommunityCommandTrendPoints(model),plan=f.host.buildCommunityCommandLeasingPlanRows(model);
 assert.equal(trend[0].budget,null,'Unverified historical browser target is not promoted to the approved baseline');assert.equal(trend[0].physical,rows[0].physical);
 for(const row of trend.slice(1)){
  assert.equal(row.budget,plan[row.idx].budgetPct,'Chart and plan use the same approved month');
  assert.equal(row.budget,targets[row.idx-8]/100*100);assert.equal(row.variance,row.physical-row.budget);
  const prior=rows.find(old=>old.idx===row.idx);for(const key of ['physical','beginning','endingActual','endingForecast','occupancy'])assert.deepEqual(row[key],prior[key]);
  assert.equal(row.leased,row.idx===8?115/247*100:prior.leased);
 }
 assert.deepEqual(rows,before,'No legacy source or approved-goal mutation');
});
test('trend keeps explicit approved zero, shows unavailable for missing months, and cannot reuse targets after access changes',async()=>{
 for(const change of ['changeActor','changeScope','deny']){
  const f=hostFixture();f.host.getCommunityCommandTrendPoints=()=>[8,9,10,11].map(idx=>({idx,budget:95,physical:0,leased:33,variance:-95,occupancy:{approved:{occupancyGoal:0}}}));
  const api=installCommunityGoalPlanning({host:f.host,readSources:sources,readBudgets:async()=>[budget(),{...budget(),period_key:'2026-10',summary:{...budget().summary,occupancyPct:0}}],readPublications:async()=>[]});
  await api.hydrate(f.model);const model=f.host.buildCommunityCommandModel();let rows=f.host.getCommunityCommandTrendPoints(model);
  assert.deepEqual(rows.map(row=>row.budget),[47.6,0,null,null]);assert.deepEqual(rows.map(row=>row.variance),[-47.6,0,null,null]);
  f[change]();rows=f.host.getCommunityCommandTrendPoints(model);assert.deepEqual(rows.map(row=>row.budget),[null,null,null,null]);assert(rows.every(row=>row.variance===null));assert(rows.every(row=>row.occupancy.approved.occupancyGoal===0));
 }
});

test('locked 2026 occupancy reads independently of missing financial closes and 2027 drafts',async()=>{
 const locked={community_id:cid,calendar_year:2026,status:'locked',version_id:'locked-2026',content_hash:'verified-hash',covered_months:Array.from({length:12},(_,i)=>i),payload:{occupancyPct:[0,1,2,3,4,5,6,7,56.085994,55.099174,60.383123,64.294217]}};
 const calls=[],central={getSession:()=>({user:{id:'actor'}}),fetchJson:async url=>{calls.push(url);return [locked];}};
 const rows=await readLockedOccupancyBudgets(central,[cid],['2026-09','2026-10','2026-11','2026-12']);
 assert.equal(calls.length,1);assert.match(calls[0],/atlas_approved_budget_versions/);assert.doesNotMatch(calls[0],/finance|draft/);
 assert.deepEqual(rows.map(row=>occupancyBudgetForPeriod({communityId:cid,period:row.period_key,finance:rows,publications:[{communityId:cid,activePeriods:['2027-01']}]}).occupancyPct),[56.085994,55.099174,60.383123,64.294217]);
 central.fetchJson=async()=>[locked,locked];await assert.rejects(readLockedOccupancyBudgets(central,[cid],['2026-09']),/overlaps/);
});

test('missing or conflicting Box Score cannot erase an approved occupancy target',async()=>{
 const f=hostFixture(),api=installCommunityGoalPlanning({host:f.host,readSources:()=>({snapshot:{status:'unavailable',reason:'Conflicting source versions'}}),readBudgets:async()=>[budget()],readPublications:async()=>[]});
 await api.hydrate(f.model);const m=f.host.buildCommunityCommandModel();assert.equal(m.budgetOccPct,47.6);assert.equal(m.leasedPct,null);assert.equal(m.goalPlanning.requiredMoveIns,null);assert.match(m.goalPlanning.warnings.join(' '),/Conflicting/);
});
