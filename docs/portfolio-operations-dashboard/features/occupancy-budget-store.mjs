import {readApprovedBudgets,financeAccessKey} from './canonical-finance.mjs?v=210b482c6f40c656';
import {readActive} from './reforecast-store.mjs?v=b59fd4df88ff8fe3';
import {occupancyBudgetForPeriod} from './community-goal-planning.mjs?v=e58e6bfdee0a1dee';
// Read-only bridge: never copy a governed budget into the mutable legacy curve.
export function createOccupancyBudgetStore(central,{read=readApprovedBudgets,readReforecasts=readActive}={}) {
 const cache=new Map(),pending=new Map(),aliases=new Map();let epoch=0,revision=0;
 const access=()=>financeAccessKey(central),key=e=>JSON.stringify([access(),e.communityId,e.year]);
 function clear(){epoch++;revision++;cache.clear();pending.clear();aliases.clear();}
 function bind(entries){for(const e of entries)for(const alias of [e.name,e.recordId,e.communityId].filter(Boolean))aliases.set(alias,e.communityId);}
 async function hydrate(entries){
  bind(entries);const unique=[...new Map(entries.filter(e=>e.communityId).map(e=>[key(e),e])).values()];
  for(let i=0;i<unique.length;i+=4)await Promise.all(unique.slice(i,i+4).map(async e=>{
   const id=key(e);if(cache.has(id))return;if(pending.has(id))return pending.get(id);
   const token=epoch,auth=access();
   const task=(async()=>{try{
    await central.refreshSession?.();if(token!==epoch||auth!==access())return;
    const periods=Array.from({length:12},(_,idx)=>`${e.year}-${String(idx+1).padStart(2,'0')}`);
    const [versions,publications]=await Promise.all([read(central,e.communityId,e.year),readReforecasts(central,{communityIds:[e.communityId],periods})]);if(token!==epoch||auth!==access())return;
    cache.set(id,{versions,publications});revision++;
   }catch(error){if(token===epoch&&auth===access()){cache.set(id,{error:error.message});revision++;}}})();
   pending.set(id,task);try{await task;}finally{if(pending.get(id)===task)pending.delete(id);}
  }));
 }
 function get(record,month,year){
  const cid=aliases.get(record?.atlasCommunityId||record?.sourceIds?.atlasCommunityId||record?.communityId||record?.communityName);
  if(!cid)return {status:'unmapped',reason:'Community budget mapping is unavailable.'};
  const state=cache.get(key({communityId:cid,year}));if(!state)return {status:'loading',reason:'Reading saved budget.'};
  if(state.error)return {status:'error',reason:'Saved budget could not be verified: '+state.error};
  const period=`${year}-${String(month+1).padStart(2,'0')}`;
  const rows=state.versions.filter(v=>v.covered_months?.includes(month));
  if(rows.length>1)return {status:'missing',reason:'Approved budget coverage overlaps.'};
  const row=rows[0];
  const finance=[{community_id:cid,period_key:period,summary:row?{targetApprovalStatus:row.status==='locked'?'approved':null,budgetVersion:row.version_id,budgetContentHash:row.content_hash,occupancyPct:row.payload?.occupancyPct?.[month]??null,budgetSource:row.source_file,budgetEffectiveDate:row.effective_date}:{}}];
  const evidence=occupancyBudgetForPeriod({communityId:cid,period,finance,publications:state.publications});
  if(evidence.status!=='available'||typeof evidence.occupancyPct!=='number'||!Number.isFinite(evidence.occupancyPct)||evidence.occupancyPct<0||evidence.occupancyPct>100)return {...evidence,status:'missing',reason:evidence.reason||'Approved occupancy budget is unavailable for this month.'};
  return {...evidence,pct:evidence.occupancyPct};
 }
 return {hydrate,get,clear,get accessKey(){return access();},ready:entries=>entries.every(e=>!e.communityId||cache.has(key(e))),get revision(){return `${access()}:${revision}`;}};
}
