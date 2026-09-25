import {acknowledgeBudgetConsumer} from './budget-consumer-delivery.mjs?v=f5342574d4b39aa2';
import {readActive,effectiveActiveSnapshot} from './reforecast-store.mjs?v=116417158a586ff4';
import {esc,money,reportHtml,exportRows,csv,download} from './reforecast-report.mjs?v=17298028335ec1f6';
const finitePercent=value=>typeof value==='number'&&Number.isFinite(value)?(value*100).toFixed(2)+'%':'Unavailable';
// One publication reader shared by operating screens, plan/report evidence and Scout.
export function createActiveReforecastCache(central){
 const cache=new Map(),pending=new Map();let actor=central.getSession()?.user?.id,epoch=0;
 const api={
  clear(){epoch++;cache.clear();pending.clear();actor=central.getSession()?.user?.id;},
  get(communityId,period){return cache.get(communityId)?.records.find(r=>(r.activePeriods||r.periods).includes(period))||null;},
  async refresh(communityIds,periods,{force=false}={}){
   const user=central.getSession()?.user?.id;if(!user){api.clear();return [];}
   if(user!==actor)api.clear();const ids=[...new Set(communityIds)],key=ids.slice().sort().join('|')+'|'+periods.join('|');
   if(!force&&ids.every(id=>cache.get(id)?.key===key&&Date.now()-cache.get(id).at<30000))return ids.flatMap(id=>cache.get(id).records);
   if(pending.has(key))return pending.get(key);const generation=epoch;
   const task=(async()=>{try{const records=await readActive(central,{communityIds:ids,periods});if(generation!==epoch||user!==central.getSession()?.user?.id)throw Error('Session changed while reading the active reforecast.');for(const id of ids)cache.set(id,{records:records.filter(r=>r.communityId===id),at:Date.now(),key});return records;}catch(error){ids.forEach(id=>cache.delete(id));throw error;}finally{if(generation===epoch)pending.delete(key);}})();pending.set(key,task);return task;
  }
 };return api;
}
export function activeBenchmark(publication,period){
 if(!publication||!(publication.activePeriods||publication.periods||publication.snapshot?.identity?.periods||[]).includes(period))return null;const operating=effectiveActiveSnapshot(publication);const monthly=operating?.monthly?.find(row=>row.period===period);if(!monthly)return null;
 return {type:'active_reforecast',communityId:publication.communityId,period,publicationId:publication.publicationId,version:publication.version,revisionId:publication.revisionId,publishedAt:publication.publishedAt,cutoff:operating.identity?.actualCutoff,metrics:monthly.reforecast,leasing:operating.leasing?.find(row=>row.period===period)||null,sourceVersions:operating.identity,fingerprint:operating.fingerprint,financialSnapshot:operating.outputSnapshot,publishedFingerprint:publication.snapshot.fingerprint,projectionKind:operating.isActiveReadProjection?'current_actuals_projection':'published_vintage'};
}
export async function mountActiveBenchmark(container,{central,communityId,communityName,period,cache,openWorkspace}={}){
 const token=Symbol(),actor=central.getSession?.()?.user?.id;container._reforecastToken=token;container.innerHTML='<p>Reading active operating reforecast…</p>';
 const alive=()=>container.isConnected&&container._reforecastToken===token&&central.getSession?.()?.user?.id===actor;
 try{const records=await cache.refresh([communityId],[period]);if(!alive())return;const publication=records.find(r=>r.communityId===communityId&&(r.activePeriods||r.periods).includes(period)),benchmark=activeBenchmark(publication,period),operating=publication?effectiveActiveSnapshot(publication):null;
  if(benchmark)await acknowledgeBudgetConsumer(central,publication,'dashboard');if(!alive())return;
  if(!benchmark){container.innerHTML='<h3>Active operating reforecast</h3><p>No locked reforecast has been published for this property and period.</p>';if(openWorkspace){const b=document.createElement('button');b.textContent='Open Reforecast Approval Center';b.onclick=openWorkspace;container.append(b);}return;}
  container.innerHTML=`<h3>Active operating reforecast · ${esc(communityName||communityId)} · ${esc(period)}</h3><p>Published version ${esc(benchmark.version)} · ${esc(benchmark.publishedAt)} · Actual cutoff ${esc(benchmark.cutoff||'None')}</p><table><thead><tr><th>Income</th><th>OPEX</th><th>NOI</th><th>Cash flow</th></tr></thead><tbody><tr>${['revenue','expenses','noi','cashFlow'].map(k=>`<td>${money(benchmark.metrics?.[k])}</td>`).join('')}</tr></tbody></table><details><summary>Leasing and occupancy forecast</summary><p>Physical occupancy: ${finitePercent(benchmark.leasing?.occupancy)} · Occupied units: ${money(benchmark.leasing?.occupiedUnits)} · Move-ins: ${money(benchmark.leasing?.moveIns)} · Move-outs: ${money(benchmark.leasing?.moveOuts)}</p><p>Physical occupancy changes require move-ins and move-outs. A lease alone does not change physical occupancy. Missing schedule inputs stay unavailable.</p></details><p>Original-budget and approved leasing targets remain separately identified. Eligible Bonus targets use each full month’s verified effective baseline; paid and locked evidence is retained.</p><details><summary>Reforecast, original budget and actuals</summary>${reportHtml(operating,publication.source,{communityName,status:'Published / Active',periods:[period]})}</details><button data-export>Export active forecast evidence</button><p>Closed months use the governed actuals shown in this snapshot. Open months retain the locked published forecast.</p><p>Publication ${esc(benchmark.publicationId)} · Snapshot ${esc(benchmark.fingerprint)}</p>`;
  container.querySelector('[data-export]').onclick=()=>download(csv(exportRows(operating,publication.source,{periods:[period]})),`active-reforecast-${period}.csv`);
 }catch(e){if(alive())container.innerHTML=`<h3>Active operating reforecast</h3><p role="alert">Active reforecast unavailable: ${esc(e.message)}</p>`;}
}
export function scoutForecastEvidence(publication,period){const evidence=activeBenchmark(publication,period);return evidence?{...evidence,authority:'locked_published_reforecast',instruction:'Compare this operating benchmark separately from the immutable original budget and governed actuals.'}:null;}

const finiteAmount=value=>typeof value==='number'&&Number.isFinite(value);
const fullMonth=/^20\d{2}-(0[1-9]|1[0-2])$/;
const frozenCopy=value=>{const copy=structuredClone(value);const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};return freeze(copy);};
export function resolveEffectiveBaseline(envelopes,{communityId,period,accountCodes=null}={}){
 const unavailable=reason=>({status:'unavailable',communityId,period,reason});
 if(!communityId||!fullMonth.test(period||''))return unavailable('invalid_full_month_scope');
 const matches=(Array.isArray(envelopes)?envelopes:[envelopes]).filter(row=>row?.communityId===communityId&&row.period===period);
 if(matches.length!==1)return unavailable(matches.length?'ambiguous_baseline':'missing_baseline');
 const row=matches[0];
 if(row.status!=='available')return unavailable(row.reason||'baseline_unavailable');
 if(!row.verified||!row.approved||!row.locked||row.stale||row.reopened||row.reconciled===false||!row.versionId||!row.contentHash||!['original_budget','approved_reforecast'].includes(row.sourceType)||row.sourceType==='approved_reforecast'&&!row.publicationId)return unavailable('unverified_baseline');
 if(!Array.isArray(row.lines)||!row.lines.length)return unavailable('missing_baseline_detail');
 const seen=new Set();
 for(const line of row.lines){if(!line.accountCode||seen.has(line.accountCode)||line.period&&line.period!==period||line.communityId&&line.communityId!==communityId)return unavailable('invalid_baseline_detail');seen.add(line.accountCode);}
 const selected=accountCodes?row.lines.filter(line=>accountCodes.includes(line.accountCode)):row.lines;
 if(accountCodes?.some(code=>!seen.has(code))||selected.some(line=>!finiteAmount(line.amount)))return unavailable('missing_baseline_amount');
 return frozenCopy({...row,lines:selected});
}
export async function readEffectiveBaselines(central,{communityIds,periods}={}){
 const ids=[...new Set(communityIds||[])];
 if(!ids.length||!Array.isArray(periods)||!periods.length||periods.length>24||periods.some(period=>!fullMonth.test(period))||new Set(periods).size!==periods.length)throw Error('Explicit communities and full calendar months are required.');
 const actor=central.getSession?.()?.user?.id;
 await central.refreshSession?.();
 const result=await central.fetchJson('/rpc/atlas_reforecast_effective_baseline',{method:'POST',body:JSON.stringify({p_community_ids:ids,p_periods:periods})});
 if(central.getSession&&actor!==central.getSession()?.user?.id)throw Error('Session changed while reading the effective baseline.');
 if(!Array.isArray(result)||result.some(row=>!ids.includes(row.communityId)||!periods.includes(row.period)))throw Error('Effective baseline scope mismatch.');
 return frozenCopy(ids.flatMap(communityId=>periods.map(period=>resolveEffectiveBaseline(result,{communityId,period}))));
}
export function effectiveBaselineMetric(baseline,metric,{accountCodes=null}={}){
 if(baseline?.status!=='available')return null;
 const factors={revenue:row=>['income','contra_income'].includes(row.nature)&&row.placement==='above_noi'?1:0,expenses:row=>row.nature==='expense'&&row.placement==='above_noi'?1:0,capital:row=>row.nature==='capital'?1:0,debt:row=>row.nature==='debt'||row.accountRole==='debt'?1:0,noi:row=>row.placement==='above_noi'?['income','contra_income'].includes(row.nature)?1:row.nature==='expense'?-1:0:0,cashFlow:row=>['income','contra_income'].includes(row.nature)?1:['expense','capital','debt','below_noi'].includes(row.nature)?-1:0};
 if(metric==='margin'){const revenue=effectiveBaselineMetric(baseline,'revenue',{accountCodes}),noi=effectiveBaselineMetric(baseline,'noi',{accountCodes});return revenue&&noi!==null?noi/revenue:null;}
 const factor=factors[metric==='opex'?'expenses':metric];if(!factor)return null;
 const rows=baseline.lines.filter(row=>!accountCodes||accountCodes.includes(row.accountCode));
 if(accountCodes?.some(code=>!rows.some(row=>row.accountCode===code))||rows.some(row=>!row.nature||!row.placement||!finiteAmount(row.amount)))return null;
 return Math.round(rows.reduce((total,row)=>total+row.amount*factor(row),0)*100)/100;
}
// Paid/locked month evidence is supplied by the governed bonus ledger and is never recalculated here.
export function composeBonusQuarter({communityId,periods,baselines=[],actuals=[],plan,assignment,calculationVersion,retainedResults=[]}={}){
 const unavailable=reason=>({status:'unavailable',payable:false,reason,communityId,periods});
 if(!Array.isArray(periods)||periods.length!==3||periods.some(period=>!fullMonth.test(period)))return unavailable('full_quarter_required');
 const start=Number(periods[0].slice(5));if(![1,4,7,10].includes(start)||periods.some((period,index)=>period!==periods[0].slice(0,5)+String(start+index).padStart(2,'0')))return unavailable('full_quarter_required');
 if(!plan?.id||!plan.versionId||!plan.metricDefinitionId||plan.eligible!==true||!Array.isArray(plan.accountCodes)||!plan.accountCodes.length||new Set(plan.accountCodes).size!==plan.accountCodes.length||!['higher','lower'].includes(plan.favorableDirection))return unavailable('eligible_plan_and_gl_rules_required');
 if(!assignment?.id||!assignment.employeeId||assignment.communityId!==communityId||assignment.eligible!==true||periods.some(period=>period<assignment.startPeriod||assignment.endPeriod&&period>assignment.endPeriod)||!calculationVersion)return unavailable('matching_assignment_and_calculation_version_required');
 const months=[];
 for(const period of periods){
  const retained=retainedResults.filter(row=>row.communityId===communityId&&row.period===period&&row.employeeId===assignment.employeeId&&row.planId===plan.id&&(row.paid===true||row.locked===true));
  if(retained.length){if(retained.length!==1||retained[0].verified!==true||!retained[0].calculationVersion||!retained[0].baselineEvidence||!retained[0].actualCloseVersionId)return unavailable('invalid_retained_bonus_evidence');months.push(frozenCopy(retained[0]));continue;}
  const baseline=resolveEffectiveBaseline(baselines,{communityId,period,accountCodes:plan.accountCodes});if(baseline.status!=='available')return unavailable(baseline.reason);
  const candidates=actuals.filter(row=>row.communityId===communityId&&row.period===period);
  if(candidates.length!==1)return unavailable('missing_or_ambiguous_governed_actuals');const actual=candidates[0];
  if(actual.status!=='closed'||actual.fullMonth!==true||!actual.verified||!actual.versionId||!actual.contentHash||actual.stale||actual.reopened)return unavailable('unverified_closed_actuals');
  const selected=plan.accountCodes.map(code=>actual.lines?.filter(row=>row.accountCode===code));if(selected.some(rows=>rows?.length!==1||!finiteAmount(rows[0].amount)))return unavailable('missing_actual_gl_evidence');
  const budget=baseline.lines.reduce((total,row)=>total+row.amount,0),value=selected.reduce((total,rows)=>total+rows[0].amount,0),variance=Math.round((value-budget)*100)/100,attainment=budget===0?null:100+(plan.favorableDirection==='lower'?-1:1)*variance/Math.abs(budget)*100;
  const favorability=variance===0?'neutral':(plan.favorableDirection==='lower'?variance<0:variance>0)?'favorable':'unfavorable';
  months.push({communityId,period,employeeId:assignment.employeeId,assignmentId:assignment.id,planId:plan.id,planVersionId:plan.versionId,metricDefinitionId:plan.metricDefinitionId,calculationVersion,accountCodes:[...plan.accountCodes],budget,actual:value,variance,favorability,attainment,baselineEvidence:{sourceType:baseline.sourceType,versionId:baseline.versionId,publicationId:baseline.publicationId||null,contentHash:baseline.contentHash,period,accountCodes:[...plan.accountCodes]},actualCloseVersionId:actual.versionId,actualContentHash:actual.contentHash,paid:false,locked:false});
 }
 if(months.some(row=>!finiteAmount(row.budget)||!finiteAmount(row.actual)))return unavailable('missing_retained_amount');
 const budget=months.reduce((total,row)=>total+row.budget,0),actual=months.reduce((total,row)=>total+row.actual,0),variance=Math.round((actual-budget)*100)/100;
 return frozenCopy({status:'available',payable:false,reason:'server_calculation_receipt_required',communityId,periods,employeeId:assignment.employeeId,planId:plan.id,calculationVersion,months,budget,actual,variance,attainment:budget===0?null:100+(plan.favorableDirection==='lower'?-1:1)*variance/Math.abs(budget)*100,baselineVersions:months.map(row=>row.baselineEvidence)});
}
