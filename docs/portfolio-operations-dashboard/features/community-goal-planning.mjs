import {readFinance,financeAccessKey} from './canonical-finance.mjs?v=bc2709c0e3b81885';
import {readActive} from './reforecast-store.mjs?v=89302fd431288798';
import {readOccupancySourceEvidence} from './occupancy-source-evidence.mjs?v=8f6ac469f513c709';
import {recommendOccupancyGoals,applyOccupancyRecommendation} from './occupancy-goal-recommendations.mjs?v=a4ee2c9ccf3c92a8';
import {sha256,canonicalJson} from './financial-snapshot.mjs?v=848d058bdec07b4e';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const periodFor=(year,idx)=>`${year}-${String(idx+1).padStart(2,'0')}`;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>finite(value)?value.toLocaleString('en-US',{maximumFractionDigits:2}):'Unavailable';
const percent=value=>finite(value)?value.toFixed(2)+'%':'Unavailable';
function displayEvidence(r){
 if(!r)return null;
 const cite=s=>s?{file:s.sourceFile||null,period:s.period||null,observedAt:s.asOf||null,sourceFingerprint:s.sourceFingerprint||s.contentHash||null}:null;
 return {period:r.period,reportedLeased:r.leasedUnits,reportedRentable:r.rentableUnits,approvedBudgetPercent:r.budgetPct,targetUnits:r.targetUnits,minimumAdditionalLeases:r.signedLeaseGap,minimumApplications:r.minimumApplications,remainingScheduledMoveOuts:r.remainingMoveOuts,totalRequiredMoveIns:r.requiredMoveIns,grossLeaseGoal:r.grossLeaseGoal,applicationGoal:r.applicationGoal,activityRate:{completedLeases:r.closing.leases??null,completedApplications:r.closing.applications??null,rate:r.closing.rate,label:'Period activity; not a matched applicant cohort'},sources:{boxScore:cite(r.source.snapshot),closingActivity:cite(r.source.closing),rentRoll:cite(r.source.pipeline),approvedBudget:{...cite(r.source.budget),basis:r.source.budget?.measurementBasis,inventory:r.source.budget?.rentableUnits,inventorySource:r.source.budget?.inventory?.source,settingsVersion:r.source.budget?.inventory?.version}},warnings:r.warnings};
}
export async function readCommunityGoalInventory(central,communityId){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(communityId)||!central.getSession?.()?.user?.id)throw Error('Authorized community inventory is required.');
 const access=financeAccessKey(central),guard=()=>{if(access!==financeAccessKey(central))throw Error('Financial access changed while reading Community Settings.');};
 await central.refreshSession?.();guard();
 const rows=await central.fetchJson(`/atlas_communities?community_id=eq.${communityId}&deleted_at=is.null&select=community_id,units,version,updated_at,review_status,review_flags&limit=2`);guard();
 if(!Array.isArray(rows)||rows.length!==1||rows[0].community_id!==communityId)throw Error('Verified Community Settings inventory is unavailable.');
 const row=rows[0];
 if(!Number.isInteger(row.units)||row.units<1||!Number.isInteger(row.version)||row.version<1||!Number.isFinite(Date.parse(row.updated_at))||!['clean','review_required'].includes(row.review_status)||row.review_status==='review_required'&&/unit|inventor|bed|capacity/i.test(JSON.stringify(row.review_flags||[])))throw Error('Community Settings inventory requires mapping review.');
 return {status:'available',communityId,units:row.units,measurementBasis:'units',version:row.version,updatedAt:row.updated_at,source:'Community Settings: atlas_communities.units',sourceFingerprint:sha256(canonicalJson(row))};
}
export function occupancyBudgetForPeriod({communityId,period,finance=[],publications=[],inventory=null}){
 const missing=reason=>({status:'unavailable',communityId,period,reason});
 const rows=finance.filter(row=>row.community_id===communityId&&row.period_key===period);
 if(rows.length!==1)return missing('Approved budget evidence for this month is unavailable.');
 const summary=rows[0].summary,active=publications.filter(row=>row.communityId===communityId&&row.activePeriods?.includes(period));
 if(active.length>1)return missing('Multiple active occupancy baselines require review.');
 if(active.length===1){
  const p=active[0],leasing=p.snapshot?.leasing?.filter(row=>row.period===period)||[],expected=summary?.effectiveBaseline;
  if(p.verified!==true||p.approved!==true||p.locked!==true||!p.contentHash||!p.revisionId||!p.publicationId||leasing.length!==1||leasing[0].sourceKind!=='forecast'||!finite(leasing[0].occupancy)||expected?.publicationId&&expected.publicationId!==p.publicationId)return missing('The latest VP-approved occupancy schedule is missing or changed while loading.');
  return {status:'available',communityId,period,approvalStatus:'approved',versionId:p.revisionId,publicationId:p.publicationId,contentHash:p.contentHash,sourceType:'approved_reforecast',occupancyPct:leasing[0].occupancy*100,rentableUnits:leasing[0].units,measurementBasis:'units',source:leasing[0].source,publishedAt:p.publishedAt};
 }
 if(summary?.effectiveBaseline?.sourceType==='approved_reforecast')return missing('The active VP-approved occupancy schedule could not be verified.');
 if(summary?.targetApprovalStatus!=='approved'||!summary.budgetVersion||!summary.budgetContentHash||!finite(summary.occupancyPct))return missing('An approved original budget occupancy value for this month is required.');
 const basis=inventory?.status==='available'&&inventory.communityId===communityId?inventory:null;
 return {status:'available',communityId,period,approvalStatus:'approved',versionId:summary.budgetVersion,contentHash:summary.budgetContentHash,sourceType:'original_budget',occupancyPct:summary.occupancyPct,rentableUnits:basis?.units??null,measurementBasis:basis?.measurementBasis??null,inventory:basis,source:summary.budgetSource,effectiveDate:summary.budgetEffectiveDate};
}

export function installCommunityGoalPlanning({host=window,getImportState=()=>null,openGoals=null,readSources=readOccupancySourceEvidence,readBudgets=readFinance,readPublications=readActive,readInventory=readCommunityGoalInventory}={}){
 if(host.AtlasCommunityGoalPlanning)return host.AtlasCommunityGoalPlanning;
 const cache=new Map(),pending=new Map();let generation=0;
 const access=()=>financeAccessKey(host.ATLAS_CENTRAL||{});
 const scope=model=>{const row=host.getAtlasCommunityAccessRecord?.(model.propName);return row?.atlasCommunityId||row?.sourceIds?.atlasCommunityId||null;};
 const key=(model,cid)=>JSON.stringify([access(),cid,model.year]);
 const clear=()=>{generation++;cache.clear();pending.clear();};
 const current=()=>host.ATLAS_CENTRAL?.getSession?.()?.user?.id&&host.atlasAccessDecision?.(2)?.ok;
 async function hydrate(model,{force=false}={}){
  const cid=scope(model),central=host.ATLAS_CENTRAL;if(!cid||!current())return;
  const id=key(model,cid),prior=cache.get(id);if(!force&&prior&&Date.now()-prior.at<30000)return prior;
  if(pending.has(id))return pending.get(id);
  const token=generation,auth=access(),periods=Array.from({length:12},(_,idx)=>periodFor(model.year,idx));
  const valid=()=>token===generation&&auth===access()&&current();
  const task=(async()=>{try{
   const [finance,publications,inventory]=await Promise.all([readBudgets(central,[cid],periods,{baselineMode:'original_budget'}),readPublications(central,{communityIds:[cid],periods}),readInventory(central,cid).catch(error=>({status:'unavailable',reason:error.message}))]);
   if(!valid())return;
   const result={at:Date.now(),budgets:periods.map(period=>occupancyBudgetForPeriod({communityId:cid,period,finance,publications,inventory}))};cache.set(id,result);return result;
  }catch(error){if(valid()){const result={at:Date.now(),budgets:[],error:error.message};cache.set(id,result);return result;}}
  finally{if(token===generation)pending.delete(id);}})();pending.set(id,task);return task;
 }
 function evidence(model,idx){
  const cid=scope(model),period=periodFor(model.year,idx),state=cache.get(key(model,cid));
  if(!cid||!current())return recommendOccupancyGoals({communityId:cid,period,snapshot:{status:'unavailable',reason:'Verify authorized community access before reading source recommendations.'}});
  const today=host.getAtlasTodayISODate?.()||new Date().toISOString().slice(0,10),end=new Date(Date.UTC(model.year,idx+1,0)).toISOString().slice(0,10);
  const sources=readSources({communityId:cid,communityName:model.propName,period:'',targetPeriod:period,asOf:today<end?today:end,record:model.record,importState:getImportState()})||{};
  const budget=state?.budgets.find(row=>row.period===period)||{status:'unavailable',communityId:cid,period,reason:state?.error?'Approved occupancy budget could not load: '+state.error:'Reading approved occupancy budget…'};
  return recommendOccupancyGoals({communityId:cid,period,...sources,budget,corporateUnits:model.corporateUnits||0});
 }
 const originalModel=host.buildCommunityCommandModel,originalRows=host.buildCommunityCommandLeasingPlanRows,originalRender=host.renderCommunityCommandLeasingPlan,originalOpen=openGoals||host.approveCommunityCommandMonthlyGoals;
 if([originalModel,originalRows,originalRender,originalOpen].some(fn=>typeof fn!=='function'))throw Error('Community goal integration is unavailable in this interface.');
 host.buildCommunityCommandModel=function(){const model=originalModel.apply(this,arguments),recommendation=evidence(model,model.monthIdx),approved=host.getCommunityCommandApprovedGoal?.(model.propName,model.monthIdx,model.year);return {...model,leased:recommendation.leasedUnits,leasedPct:recommendation.actualLeasedPct,budgetOccPct:recommendation.budgetPct,budgetLeasedPct:recommendation.leasedGoal,goalPlanning:recommendation,plan:{...model.plan,currentAppNeed:approved?.applicationGoal??recommendation.applicationGoal,currentGrossLeaseNeed:approved?.grossLeaseGoal??recommendation.grossLeaseGoal,currentMoveInNeed:approved?.requiredMoveIns??recommendation.requiredMoveIns,currentGuestCardNeed:null}};};
 const originalKpi=host.renderCommunityCommandKpi,originalTrend=host.getCommunityCommandTrendPoints,originalAlerts=host.buildCommunityCommandAlerts;
 if(typeof originalKpi==='function')host.renderCommunityCommandKpi=function(model,field,label,value,formatter,sub,tone,tabIdx){
  if(field==='leased_occupancy'&&model.goalPlanning){const r=model.goalPlanning;value=r.actualLeasedPct;formatter=percent;sub=r.leasedUnits===null?'Verified Box Score leased inventory is unavailable.':`${number(r.leasedUnits)} leased of ${number(r.rentableUnits)} reported rentable units · ${r.source.snapshot.asOf}`;tone=value===null?'watch':tone;}
  if(field==='budget_occupancy'&&model.goalPlanning){value=model.goalPlanning.budgetPct;formatter=percent;}
  if(model.goalPlanning&&field==='applications_mtd'&&!finite(model.plan.currentAppNeed)||model.goalPlanning&&field==='net_leases_mtd'&&!finite(model.plan.currentMoveInNeed))tone='info';
  return originalKpi.call(this,model,field,label,value,formatter,sub,tone,tabIdx);
 };
 if(typeof originalTrend==='function')host.getCommunityCommandTrendPoints=function(model){return originalTrend.call(this,model).map(row=>row.idx===model.monthIdx&&model.goalPlanning?{...row,leased:model.goalPlanning.actualLeasedPct,budget:model.goalPlanning.budgetPct}:row);};
 if(typeof originalAlerts==='function')host.buildCommunityCommandAlerts=function(model){return originalAlerts.call(this,model).filter(row=>!model.goalPlanning||!(row.id==='lease_pace_risk'&&!finite(model.plan.currentGrossLeaseNeed)||row.id==='traffic_volume_watch'&&!finite(model.plan.currentGuestCardNeed)));};
 host.buildCommunityCommandLeasingPlanRows=function(model){return originalRows.call(this,model).map((row,idx)=>idx<model.monthIdx?row:applyOccupancyRecommendation(row,evidence(model,idx)));};
 host.renderCommunityCommandLeasingPlan=function(model){
  const cid=scope(model),id=key(model,cid),hasEntry=cache.has(id);
  if(cid&&current()&&!hasEntry&&!pending.has(id))void hydrate(model).then(()=>{if(current()&&host.getProp?.().name===model.propName)host.renderTab?.();});
  const rows=host.buildCommunityCommandLeasingPlanRows(model),row=rows[model.monthIdx],r=row?.planningRecommendation;
  if(!r)return originalRender.call(this,model);
  const fmt=value=>number(value),approved=row.approved,canApprove=host.communityCommandCanApproveGoals?.();
  const body=`<div data-occupancy-goal-planning><p class="community-command-note" style="margin-bottom:10px">Current Box Score leased: <strong data-current-leased>${percent(r.actualLeasedPct)}</strong> (${number(r.leasedUnits)} of ${number(r.rentableUnits)} reported rentable units), observed ${esc(r.source.snapshot?.asOf||'Unavailable')}. Recommended leased target: <strong data-leased-target>${percent(r.leasedGoal)}</strong> from the approved occupancy budget.</p><p class="community-command-note" style="margin-bottom:10px">Minimum additional leases from the current signed inventory: <strong data-signed-lease-gap>${number(r.signedLeaseGap)}</strong>. Minimum applications at the latest activity rate: <strong data-minimum-applications>${number(r.minimumApplications)}</strong>. These minimums exclude unknown future departures. Physical move-ins required: <strong>${number(r.requiredMoveIns)}</strong>. A signed lease does not establish a move-in date.</p><p class="community-command-note" style="margin-bottom:10px">Dated future move-ins through this month: ${number(r.datedPipelineMoveIns)}. Signed units with unavailable timing: ${number(r.undatedPipelineUnits)}.</p><p class="community-command-note" style="margin-bottom:10px">Latest application-to-lease activity rate: <strong data-activity-rate>${r.closing.status==='available'?percent(r.closing.rate*100):'Unavailable'}</strong>${r.closing.status==='available'?` · ${number(r.closing.leases)} completed leases / ${number(r.closing.applications)} completed applications · ${esc(r.closing.period)} · ${esc(r.closing.sourceFile||'')}`:''}. Period activity is not a matched applicant cohort.</p>${r.warnings.map(w=>`<p role="status" class="community-command-note" style="margin-bottom:10px">${esc(w)}</p>`).join('')}<p>${host.communityCommandCanApproveGoals?.()?`<button class="btn btn-blue" onclick="approveCommunityCommandMonthlyGoals(${model.monthIdx})">Edit Goals</button>`:''} <button class="btn btn-gray" data-refresh-goal-sources>Refresh source recommendations</button></p>${host.renderCommunityCommandGoalEditor(model)}${approved?.weeklyGoals?.length?`<p>Approved weekly applications / gross / net: ${approved.weeklyGoals.map(w=>[number(w.applicationGoal),number(w.grossLeaseGoal),number(w.netLeaseGoal)].join('/')).join(' · ')}</p>`:''}<div class="community-command-scroll"><table class="community-command-plan-table"><thead><tr><th>Month</th><th>Beginning occupancy</th><th>Approved budget occupancy</th><th>Ending actual / forecast</th><th>Minimum additional leases</th><th>Minimum applications</th><th>Required move-ins</th><th>Recommended applications</th><th>Approved applications</th><th>Recommended gross leases</th><th>Approved gross leases</th><th>Recommended net leases</th><th>Approved net leases</th><th>Actual applications / leases</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.month)}</td><td>${percent(x.beginningPct)}${host.communityCommandCanOverrideDashboard?.()?`<button class="btn btn-gray btn-sm" onclick="setCommunityCommandBeginningOverride(${x.monthIdx})">Beginning balance override</button>`:''}</td><td>${percent(x.budgetPct)}</td><td>${percent(x.occupancy?.endingActualPct??x.endingForecastPct)}</td><td>${fmt(x.planningRecommendation?.signedLeaseGap)}</td><td>${fmt(x.planningRecommendation?.minimumApplications)}</td><td>${fmt(x.approved?.requiredMoveIns??x.requiredMoveIns)}</td><td>${fmt(x.recommendedApps)}</td><td>${fmt(x.approvedApps)}</td><td>${fmt(x.recommendedGrossLeases)}</td><td>${fmt(x.approvedGrossLeases)}</td><td>${fmt(x.netLeaseGoal)}</td><td>${fmt(x.approvedNetLeases)}</td><td>${fmt(x.actualApplications)} / ${fmt(x.actualGrossLeases)}</td><td>${canApprove&&x.monthIdx>=model.monthIdx?`<button class="btn btn-gray btn-sm" onclick="approveCommunityCommandMonthlyGoals(${x.monthIdx})">Edit goals</button>`:''}<details><summary>Period evidence</summary><pre>${esc(JSON.stringify({beginningPercent:x.beginningPct,endingPercent:x.occupancy?.endingActualPct??x.endingForecastPct,occupancyWarnings:x.occupancy?.warnings,recommendation:displayEvidence(x.planningRecommendation)},null,2))}</pre></details></td></tr>`).join('')}</tbody></table></div><details><summary>Calculation and source evidence</summary><pre>${esc(JSON.stringify(displayEvidence(r),null,2))}</pre></details>${approved?`<p>Approved goal version ${esc(approved.version)} remains unchanged until you explicitly approve a revision.</p>`:''}</div>`;
  queueMicrotask(()=>{const button=host.document?.querySelector('[data-refresh-goal-sources]');if(button)button.onclick=()=>hydrate(model,{force:true}).then(()=>{if(current()&&host.getProp?.().name===model.propName)host.renderTab?.();});});
  return host.renderWindowshadeCard?host.renderWindowshadeCard({key:'community_command_leasing_plan',title:'Leasing & Occupancy Plan',subtitle:'Reported leased inventory, approved budget targets and source-based recommendations.',countLabel:model.monthLabel,bodyHtml:body,collapsedPreview:`${percent(r.actualLeasedPct)} leased · ${number(r.signedLeaseGap)} minimum additional leases · ${number(r.minimumApplications)} minimum applications`}):body;
 };
 host.approveCommunityCommandMonthlyGoals=async function(monthIdx){const model=host.buildCommunityCommandModel(host.getProp().name,host.getCurrentCommunityRecord()),auth=access(),cid=scope(model);await hydrate(model,{force:true});if(auth!==access()||!current()||cid!==scope(model)||host.getProp().name!==model.propName)return;return originalOpen.call(this,monthIdx);};
 for(const event of ['atlas-central-auth-change','atlas-finance-updated','atlas-reforecast-updated'])host.addEventListener?.(event,clear);
 const api={hydrate,clear,evidence};host.AtlasCommunityGoalPlanning=api;return api;
}
