import {readActive,effectiveActiveSnapshot} from './reforecast-store.mjs?v=4a7a84c04ff55a0f';
import {esc,money,reportHtml,exportRows,csv,download} from './reforecast-report.mjs?v=99ee4126571c1988';
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
 return {type:'active_reforecast',communityId:publication.communityId,period,publicationId:publication.publicationId,version:publication.version,revisionId:publication.revisionId,publishedAt:publication.publishedAt,cutoff:operating.identity?.actualCutoff,metrics:monthly.reforecast,leasing:operating.leasing?.find(row=>row.period===period)||null,sourceVersions:operating.identity,fingerprint:operating.fingerprint};
}
export async function mountActiveBenchmark(container,{central,communityId,communityName,period,cache,openWorkspace}={}){
 const token=Symbol();container._reforecastToken=token;container.innerHTML='<p>Reading active operating reforecast…</p>';
 const alive=()=>container.isConnected&&container._reforecastToken===token;
 try{const records=await cache.refresh([communityId],[period]);if(!alive())return;const publication=records.find(r=>r.communityId===communityId&&(r.activePeriods||r.periods).includes(period)),benchmark=activeBenchmark(publication,period),operating=publication?effectiveActiveSnapshot(publication):null;
  if(!benchmark){container.innerHTML='<h3>Active operating reforecast</h3><p>No locked reforecast has been published for this property and period.</p>';if(openWorkspace){const b=document.createElement('button');b.textContent='Open Reforecast Approval Center';b.onclick=openWorkspace;container.append(b);}return;}
  container.innerHTML=`<h3>Active operating reforecast · ${esc(communityName||communityId)} · ${esc(period)}</h3><p>Published version ${esc(benchmark.version)} · ${esc(benchmark.publishedAt)} · Actual cutoff ${esc(benchmark.cutoff||'None')}</p><table><thead><tr><th>Income</th><th>OPEX</th><th>NOI</th><th>Cash flow</th></tr></thead><tbody><tr>${['revenue','expenses','noi','cashFlow'].map(k=>`<td>${money(benchmark.metrics?.[k])}</td>`).join('')}</tr></tbody></table><details><summary>Leasing and occupancy forecast</summary><p>Physical occupancy: ${finitePercent(benchmark.leasing?.occupancy)} · Occupied units: ${money(benchmark.leasing?.occupiedUnits)} · Move-ins: ${money(benchmark.leasing?.moveIns)} · Move-outs: ${money(benchmark.leasing?.moveOuts)}</p><p>Physical occupancy changes require move-ins and move-outs. A lease alone does not change physical occupancy. Missing schedule inputs stay unavailable.</p></details><p>Original-budget and approved leasing targets remain separately identified. Bonus target selection is unchanged.</p><details><summary>Reforecast, original budget and actuals</summary>${reportHtml(operating,publication.source,{communityName,status:'Published / Active',periods:[period]})}</details><button data-export>Export active forecast evidence</button><p>Closed months use the governed actuals shown in this snapshot. Open months retain the locked published forecast.</p><p>Publication ${esc(benchmark.publicationId)} · Snapshot ${esc(benchmark.fingerprint)}</p>`;
  container.querySelector('[data-export]').onclick=()=>download(csv(exportRows(operating,publication.source,{periods:[period]})),`active-reforecast-${period}.csv`);
 }catch(e){if(alive())container.innerHTML=`<h3>Active operating reforecast</h3><p role="alert">Active reforecast unavailable: ${esc(e.message)}</p>`;}
}
export function scoutForecastEvidence(publication,period){const evidence=activeBenchmark(publication,period);return evidence?{...evidence,authority:'locked_published_reforecast',instruction:'Compare this operating benchmark separately from the immutable original budget and governed actuals.'}:null;}
