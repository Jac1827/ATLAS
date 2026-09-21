import '../community-command-contract.js?v=e6064665e1d6e271';
const money=v=>Number(v).toLocaleString('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1});
let operation;
export function cancel(){operation?.abort();operation=null;}
export async function hydrate(entries,central){
 cancel();const abort=operation=new AbortController();
 const scope=entries.filter(e=>e.communityId&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.period));
 const periods=[...new Set(scope.map(e=>e.period))],ids=[...new Set(scope.map(e=>e.communityId))];
 if(!periods.length||!ids.length)return;
 const rows=[];
 try{
  // Bounded bulk reads, not one request per community or account.
  for(let i=0;i<ids.length;i+=100){const data=await central.fetchJson(`/atlas_command_financial_summaries?community_id=in.(${ids.slice(i,i+100).join(',')})&period_key=in.(${periods.join(',')})&select=*&limit=1200`,{signal:abort.signal});rows.push(...data);if(abort.signal.aborted)return;}
  const map=new Map(rows.map(r=>[r.community_id+'|'+r.period_key,r]));
  for(const e of entries){if(abort.signal.aborted)return;const tr=document.querySelector(`[data-command-finance="${e.key}"]`);if(!tr)continue;const source=map.get(e.communityId+'|'+e.period),summary=source?.summary;
   const scope={communityId:e.communityId,period:e.period,fiscalYear:source?.fiscal_year??e.year};
   const actual=e.actual?{...e.actual,...scope}:null;
   const budget=summary?{...scope,occupancyPct:summary.occupancyPct,approvalStatus:'approved',locked:true,scenarioId:summary.scenarioId,version:summary.scenarioVersion}:null;
   const units=window.AtlasCommunityCommandContract.occupancy(scope,actual,budget);
   for(const [metric,result] of [['units',units],['gpr',summary?.gpr],['expenses',summary?.expenses]]){
    const cell=tr.querySelector(`[data-metric="${metric}"]`);if(!cell)continue;
    cell.replaceChildren();const status=result?.status||'missing',text=result?(metric==='units'||status==='missing'?result.label:result.label+' '+(result.variance>0?'+':'')+money(Math.abs(result.variance))):'Missing publication';
    const node=document.createElement(source&&metric!=='units'&&status!=='missing'?'button':'span');node.textContent=text;node.style.color=status==='unfavorable'?'#c0392b':status==='favorable'?'#16713b':'var(--muted,#64748b)';node.title=`${e.period} · ${metric==='units'?'Actual occupied units − ceiling(approved occupancy % × period rentable units)':metric==='expenses'?'Approved budget − actual expenses':'Actual GPR − approved budget'}${summary?.sourceTimestamp?' · Source '+summary.sourceTimestamp:''}`;
    if(node.tagName==='BUTTON'){node.type='button';node.className='btn btn-gray btn-sm';node.onclick=()=>window.openCommunityFinancialDrilldown(source.publication_id,metric);}
    cell.append(node);
   }
  }
 }catch(error){if(abort.signal.aborted)return;for(const e of entries){const tr=document.querySelector(`[data-command-finance="${e.key}"]`);tr?.querySelectorAll('[data-metric]').forEach(cell=>{cell.textContent='Source unavailable';cell.title=error.message;});}}
}
