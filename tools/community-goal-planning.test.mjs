import test from 'node:test';
import assert from 'node:assert/strict';
import {occupancyBudgetForPeriod,installCommunityGoalPlanning,readCommunityGoalInventory} from '../docs/portfolio-operations-dashboard/features/community-goal-planning.mjs';
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
 assert.deepEqual(requests[0].ids,[cid]);assert.equal(requests[0].periods.length,12);assert.equal(requests[0].options.baselineMode,'original_budget');
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
