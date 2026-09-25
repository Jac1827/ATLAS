import {readFinance} from './canonical-finance.mjs?v=4a0ab39278f685cd';
import '../community-command-contract.js?v=e6064665e1d6e271';
const money=v=>Number(v).toLocaleString('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1});
let operation;
export function cancel(){operation?.abort();operation=null;}
export async function hydrate(entries,central){
 cancel();const abort=operation=new AbortController();
 const scope=entries.filter(e=>e.communityId&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.period));
 const periods=[...new Set(scope.map(e=>e.period))],ids=[...new Set(scope.map(e=>e.communityId))];
 if(!periods.length||!ids.length)return;
 const rows=[],plans=[];
 try{
  // Bounded bulk reads, not one request per community or account.
  for(let i=0;i<ids.length;i+=100){const data=await readFinance(central,ids.slice(i,i+100),periods,{signal:abort.signal});rows.push(...data);if(abort.signal.aborted)return;plans.push(...await central.fetchJson(`/atlas_command_plan_summaries?community_id=in.(${ids.slice(i,i+100).join(',')})&period_key=in.(${periods.join(',')})&select=*&limit=1200`,{signal:abort.signal}));if(abort.signal.aborted)return;}
  window.AtlasCommandPlanSummaries ||= {};
  for(const e of scope)delete window.AtlasCommandPlanSummaries[e.communityId+'|'+e.period];
  for(const plan of plans)window.AtlasCommandPlanSummaries[plan.community_id+'|'+plan.period_key]=plan;
  const map=new Map(rows.map(r=>[r.community_id+'|'+r.period_key,r]));
  for(const e of entries){if(abort.signal.aborted)return;const tr=document.querySelector(`[data-command-finance="${e.key}"]`);if(!tr)continue;const source=map.get(e.communityId+'|'+e.period),summary=source?.summary;
   if(summary?.snapshotFingerprint){tr.dataset.financialSnapshot=summary.snapshotFingerprint;tr.title='Canonical snapshot '+summary.snapshotFingerprint;}
   const plan=window.AtlasCommandPlanSummaries[e.communityId+'|'+e.period],planCell=tr.querySelector('[data-shared-plan]');
   if(plan&&planCell){planCell.textContent=`${plan.stage||'Draft'} · ${plan.task_count} tasks · ${plan.verified_count} verified`;planCell.title=`Shared plan, updated ${plan.updated_at}`;}
   const count=document.querySelector('[data-shared-plan-count]');if(count)count.textContent=String(scope.filter(e=>{const p=window.AtlasCommandPlanSummaries[e.communityId+'|'+e.period];return p?p.stage!=='Closed':e.hasLegacyPlan;}).length);

   const metricScope={communityId:e.communityId,period:e.period,fiscalYear:source?.fiscal_year??e.year};
   const actual=e.actual?{...e.actual,...metricScope}:null;
   const budget=summary?.budgetVersion?{...metricScope,occupancyPct:summary.occupancyPct,approvalStatus:'approved',locked:true,scenarioId:summary.scenarioId,version:summary.scenarioVersion}:null;
   const units=window.AtlasCommunityCommandContract.occupancy(metricScope,actual,budget);
   for(const [metric,result] of [['units',units],['gpr',summary?.gpr],['expenses',summary?.expenses]]){
    const cell=tr.querySelector(`[data-metric="${metric}"]`);if(!cell)continue;
    cell.replaceChildren();const status=result?.status||'missing',text=result?(metric==='units'?result.label:status==='missing'?(typeof result.actual==='number'&&Number.isFinite(result.actual)?'Actual '+money(result.actual)+' · ':'')+result.label:result.label+' '+(result.variance>0?'+':'')+money(Math.abs(result.variance))):'Missing publication';
    const node=document.createElement(source&&metric!=='units'&&typeof result?.actual==='number'&&Number.isFinite(result.actual)?'button':'span');node.textContent=text;node.style.color=status==='unfavorable'?'#c0392b':status==='favorable'?'#16713b':'var(--muted,#64748b)';node.title=`${e.period} · ${metric==='units'?'Actual occupied units − ceiling(approved occupancy % × period rentable units)':metric==='expenses'?'Approved budget − actual expenses':'Actual GPR − approved budget'}${summary?.sourceTimestamp?' · Source '+summary.sourceTimestamp:''}`;
    if(node.tagName==='BUTTON'){node.type='button';node.className='btn btn-gray btn-sm';node.onclick=()=>window.openCommunityFinancialDrilldown(source.publication_id,metric);}
    if(metric!=='units'&&summary?.snapshotFingerprint)node.title+=' · Snapshot '+summary.snapshotFingerprint;
    cell.append(node);
   }
  }
 }catch(error){if(abort.signal.aborted)return;for(const e of entries){const tr=document.querySelector(`[data-command-finance="${e.key}"]`);tr?.querySelectorAll('[data-metric]').forEach(cell=>{cell.textContent='Source unavailable';cell.title=error.message;});}}
}
