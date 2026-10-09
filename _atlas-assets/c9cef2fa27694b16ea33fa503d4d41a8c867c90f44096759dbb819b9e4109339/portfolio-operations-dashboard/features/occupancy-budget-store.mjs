import {readApprovedBudgets,financeAccessKey} from './canonical-finance.mjs?v=210b482c6f40c656';
// Read-only bridge: never copy a governed budget into the mutable legacy curve.
export function createOccupancyBudgetStore(central,{read=readApprovedBudgets}={}) {
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
    const versions=await read(central,e.communityId,e.year);if(token!==epoch||auth!==access())return;
    cache.set(id,{versions});revision++;
   }catch(error){if(token===epoch&&auth===access()){cache.set(id,{error:error.message});revision++;}}})();
   pending.set(id,task);try{await task;}finally{if(pending.get(id)===task)pending.delete(id);}
  }));
 }
 function get(record,month,year){
  const cid=aliases.get(record?.atlasCommunityId||record?.sourceIds?.atlasCommunityId||record?.communityId||record?.communityName);
  if(!cid)return {status:'unmapped',reason:'Community budget mapping is unavailable.'};
  const state=cache.get(key({communityId:cid,year}));if(!state)return {status:'loading',reason:'Reading saved budget.'};
  if(state.error)return {status:'error',reason:'Saved budget could not be verified: '+state.error};
  if(!state.versions.length)return {status:'absent'};
  const rows=state.versions.filter(v=>v.covered_months?.includes(month));
  if(rows.length!==1)return {status:'missing',reason:rows.length?'Approved budget coverage overlaps.':'The approved budget does not cover this month.'};
  const row=rows[0],pct=row.payload?.occupancyPct?.[month];
  if(row.status!=='locked'||!row.version_id||!row.content_hash||typeof pct!=='number'||!Number.isFinite(pct)||pct<0||pct>100)return {status:'missing',reason:'Approved occupancy budget is unavailable for this month.'};
  return {status:'available',pct,sourceType:'locked_budget',source:row.source_file,versionId:row.version_id,contentHash:row.content_hash,period:`${year}-${String(month+1).padStart(2,'0')}`};
 }
 return {hydrate,get,clear,get accessKey(){return access();},ready:entries=>entries.every(e=>!e.communityId||cache.has(key(e))),get revision(){return `${access()}:${revision}`;}};
}
