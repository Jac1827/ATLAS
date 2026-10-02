import {readLockedOccupancyBudgets} from './community-goal-planning.mjs?v=8584729f30a29afc';
import {readFinance,financeAccessKey} from './canonical-finance.mjs?v=210b482c6f40c656';
import '../community-command-contract.js?v=e6064665e1d6e271';
const money=v=>Number(v).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const amount=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))?Number(v):null;
export function commandRentRollGpr(entry){
 const r=entry.rentRoll;
 return r?.status==='valid'&&r.period===entry.period&&r.communityName===entry.communityName&&r.source&&r.sourceFile&&r.asOf&&r.controls?.grossPotentialRent?.reconciled===true&&amount(r.grossPotentialRent)!==null?r:null;
}
export function commandExpenseActual(rows,communityId,period){
 const candidates=rows.filter(r=>r.community_id===communityId&&r.period_key<=period&&r.summary?.period===r.period_key);
 const valid=candidates.filter(r=>{const s=r.summary,c=s.close;return c?.community_id===communityId&&c.period_key===r.period_key&&c.status==='closed'&&c.coverage==='full_month'&&c.version_id===s.actualCloseVersion&&!['reopened','superseded'].includes(s.periodState)&&c.source_file&&c.approved_at&&c.approved_by&&amount(c.metrics?.operatingExpenses)!==null;}).sort((a,b)=>b.period_key.localeCompare(a.period_key));
 const row=valid[0];return row?{amount:amount(row.summary.close.metrics.operatingExpenses),period:row.period_key,close:row.summary.close,publicationId:row.publication_id,exact:row.period_key===period}:null;
}
let operation;
export function cancel(){operation?.abort();operation=null;}
export async function hydrate(entries,central){
 cancel();const abort=operation=new AbortController();
 const access=financeAccessKey(central),current=()=>!abort.signal.aborted&&access===financeAccessKey(central);
 const scope=entries.filter(e=>e.communityId&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.period));
 const periods=[...new Set(scope.map(e=>e.period))],ids=[...new Set(scope.map(e=>e.communityId))];
 if(!periods.length||!ids.length)return;
 const historyPeriods=[...new Set(periods.flatMap(period=>{const [year,month]=period.split('-').map(Number);return Array.from({length:12},(_,i)=>{const date=new Date(Date.UTC(year,month-1-i,1));return date.toISOString().slice(0,7);});}))];
 const rows=[],plans=[];let targetError=null,planError=null;
 try{
  // Bounded bulk reads, not one request per community or account.
  for(let i=0;i<ids.length;i+=100){const data=await readFinance(central,ids.slice(i,i+100),historyPeriods,{signal:abort.signal});if(!current())return;rows.push(...data);try{plans.push(...await central.fetchJson(`/atlas_command_plan_summaries?community_id=in.(${ids.slice(i,i+100).join(',')})&period_key=in.(${periods.join(',')})&select=*&limit=1200`,{signal:abort.signal}));}catch(error){planError=error;}if(!current())return;}
  window.AtlasCommandPlanSummaries ||= {};
  for(const e of scope)delete window.AtlasCommandPlanSummaries[e.communityId+'|'+e.period];
  for(const plan of plans)window.AtlasCommandPlanSummaries[plan.community_id+'|'+plan.period_key]=plan;
  let targets=[];try{targets=await readLockedOccupancyBudgets(central,ids,periods);}catch(error){targetError=error;}if(!current())return;
  const targetMap=new Map(targets.map(r=>[r.community_id+'|'+r.period_key,r.summary]));
  const map=new Map(rows.map(r=>[r.community_id+'|'+r.period_key,r]));
  for(const e of entries){if(!current())return;const tr=document.querySelector(`[data-command-finance="${e.key}"]`);if(!tr)continue;const source=map.get(e.communityId+'|'+e.period),summary=source?.summary;
   tr.querySelectorAll('[data-financial-period-warning]').forEach(node=>node.remove());
   if(summary?.snapshotFingerprint){tr.dataset.financialSnapshot=summary.snapshotFingerprint;tr.title='Canonical snapshot '+summary.snapshotFingerprint;}
   const plan=window.AtlasCommandPlanSummaries[e.communityId+'|'+e.period],planCell=tr.querySelector('[data-shared-plan]');
   if(planError&&planCell){planCell.title=planError.message;}
   if(plan&&planCell){planCell.textContent=`${plan.stage||'Draft'} · ${plan.task_count} tasks · ${plan.verified_count} verified`;planCell.title=`Shared plan, updated ${plan.updated_at}`;}
   const count=document.querySelector('[data-shared-plan-count]');if(count)count.textContent=String(scope.filter(e=>{const p=window.AtlasCommandPlanSummaries[e.communityId+'|'+e.period];return p?p.stage!=='Closed':e.hasLegacyPlan;}).length);

   const target=targetMap.get(e.communityId+'|'+e.period),pct=target?.occupancyPct;
   const validTarget=target?.targetApprovalStatus==='approved'&&target.budgetVersion&&typeof pct==='number'&&Number.isFinite(pct)&&pct>=0&&pct<=100;
   const budgetCell=tr.querySelector('[data-metric="occupancy-budget"]'),varianceCell=tr.querySelector('[data-metric="occupancy-variance"]');
   if(budgetCell){budgetCell.textContent=validTarget?pct.toFixed(1)+'%':'Missing budget';budgetCell.title=validTarget?`${e.period} · Locked approved budget · ${target.budgetSource||target.budgetVersion}`:'No locked budget for this community and month';}
   if(varianceCell){const physical=varianceCell.dataset.physicalPct,actualPct=physical==null||physical===''?null:Number(physical),gap=validTarget&&Number.isFinite(actualPct)?actualPct-pct:null;varianceCell.textContent=gap===null?(validTarget?'Missing actual':'Missing budget'):(gap>0?'+':'')+gap.toFixed(1)+' pp';varianceCell.title='Physical occupancy − locked approved budget occupancy (percentage points)';varianceCell.dataset.budgetStatus=gap===null?'missing':gap<-.5?'below':'ontrack';}
   if(targetError&&budgetCell){budgetCell.textContent='Budget unavailable';budgetCell.title=targetError.message;}
   const rentRoll=commandRentRollGpr(e),expense=commandExpenseActual(rows,e.communityId,e.period);
   for(const metric of ['gpr','expenses']){
    const cell=tr.querySelector(`[data-metric="${metric}"]`);if(!cell)continue;cell.replaceChildren();
    const value=metric==='gpr'?rentRoll?.grossPotentialRent:expense?.amount;
    const node=document.createElement(metric==='expenses'&&expense?.publicationId?'button':'span');if(node.tagName==='BUTTON'){node.type='button';node.className='btn btn-gray btn-sm';node.onclick=()=>window.openCommunityFinancialDrilldown(expense.publicationId,'expenses');}node.textContent=typeof value==='number'?money(value):metric==='gpr'?'Missing rent-roll GPR':'Missing closed expenses';cell.append(node);
    const note=document.createElement('small');note.style.display='block';
    note.textContent=metric==='gpr'?(rentRoll?`${rentRoll.period} · Rent roll`:`${e.period} · Source required`):(expense?`${expense.period} · Closed actual${expense.exact?'':` · ${e.period} close missing`}`:`${e.period} · No approved close`);cell.append(note);
    cell.title=metric==='gpr'?(rentRoll?`${rentRoll.sourceFile} · ${rentRoll.sourceSheet} · ${rentRoll.basis}`:'No reconciled rent-roll total for the selected community and month'):(expense?`${expense.close.source_file} · Version ${expense.close.version_id} · Monthly operating expenses`:'An uploaded accounting file must have an approved monthly close');
    if(metric==='expenses'&&summary?.periodWarning){const warning=document.createElement('p');warning.dataset.financialPeriodWarning='1';warning.setAttribute('role','alert');warning.textContent=summary.periodWarning;cell.append(warning);}
   }
   const metricScope={communityId:e.communityId,period:e.period,fiscalYear:source?.fiscal_year??e.year};
   const actual=e.actual?{...e.actual,...metricScope}:null;
   const budget=summary?.budgetVersion?{...metricScope,occupancyPct:summary.occupancyPct,approvalStatus:'approved',locked:true,scenarioId:summary.scenarioId,version:summary.scenarioVersion}:null;
   const units=window.AtlasCommunityCommandContract.occupancy(metricScope,actual,budget);
   const unitsCell=tr.querySelector('[data-metric="units"]');
   if(unitsCell){unitsCell.replaceChildren();const node=document.createElement('span');node.textContent=units.label;node.style.color=units.status==='unfavorable'?'#c0392b':units.status==='favorable'?'#16713b':'var(--muted,#64748b)';node.title=`${e.period} · Actual occupied units − ceiling(approved occupancy % × period rentable units)`;unitsCell.append(node);}

  }
  for(const status of ['below','ontrack']){const card=document.querySelector(`[data-roster-budget-count="${status}"] .value`);if(card)card.textContent=String(document.querySelectorAll(`[data-budget-status="${status}"]`).length);}
 }catch(error){if(!current())return;for(const e of entries){const tr=document.querySelector(`[data-command-finance="${e.key}"]`);tr?.querySelectorAll('[data-metric]').forEach(cell=>{const rent=cell.dataset.metric==='gpr'?commandRentRollGpr(e):null;cell.textContent=rent?money(rent.grossPotentialRent)+' · '+rent.period+' rent roll':'Source unavailable';cell.title=rent?rent.sourceFile:error.message;});}}
}
