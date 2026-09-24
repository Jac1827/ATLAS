import {readFinance} from './canonical-finance.mjs?v=bed590780060af51';
import {mountCloseControls,readYear,coverage,readRows} from './financial-close.mjs?v=155276c1a35a7182';
import {resolveCommunity} from './financial-package.mjs?v=a378a0cb25083758';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>n===null||n===undefined?'Missing':Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export function centralClient(){const host=window.parent;if(host===window||host.location.origin!==location.origin||!host.atlasAccessDecision?.(12)?.ok)throw Error('Open Budget Builder in your signed-in ATLAS workspace.');return host.ATLAS_CENTRAL;}
export async function applyReview(reviewId,{reason,expectedVersionId=null}={}){
 const central=centralClient();
 const response=await central.rpc('atlas_apply_financial_comparison',{p_review_id:reviewId,p_expected_version_id:expectedVersionId,p_reason:reason||null});
 const row=Array.isArray(response)?response[0]:response;
 const read=await central.fetchJson(`/atlas_financial_comparison_versions?version_id=eq.${row.version_id}&select=*&limit=1`);
 if(read[0]?.content_hash!==row.content_hash||read[0]?.row_count!==row.row_count)throw Error('Applied actuals could not be verified. Reload shared comparisons before retrying.');
 return read[0];
}
export async function applyControls(container,review,status){
 const central=centralClient();
 container.innerHTML='<p>Review saved centrally. Only an authorized Admin close publishes this month to financial consumers.</p>';
 await mountCloseControls(container,central,review);
}

export function comparisonScope({communityName,communityId,period,year,url,now=new Date()}={}){
 const context=new URL(url),savedPeriod=context.searchParams.get('comparisonPeriod');
 const selected=communityId||(!communityName?context.searchParams.get('comparisonCommunity'):'')||'';
 const validMonth=value=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(value||'');
 const reportYear=Number(year)||(validMonth(period)?Number(period.slice(0,4)):validMonth(savedPeriod)?Number(savedPeriod.slice(0,4)):now.getFullYear());
 const retainedPeriod=validMonth(savedPeriod)&&Number(savedPeriod.slice(0,4))===reportYear?savedPeriod:'';
 const defaultPeriod=reportYear+'-'+String(reportYear===now.getFullYear()?now.getMonth()+1:1).padStart(2,'0');
 return {communityId:selected,year:reportYear,period:validMonth(period)?period:retainedPeriod,defaultPeriod};
}

export async function mountComparison(container,{communityName,period,year}={}){
 if(container.dataset.comparisonMounted)return;container.dataset.comparisonMounted='1';
 let epoch=0;const alive=()=>container.isConnected;
 container.innerHTML='<h3>Shared actuals comparison</h3><p role="status">Loading saved actuals…</p>';
 try{
  const central=centralClient();
  const [communities,aliases]=await Promise.all([central.readCommunitiesForAccess(),central.fetchJson('/atlas_community_aliases?active=eq.true&select=community_id,alias,active&limit=1000')]);if(!alive())return;
  const match=resolveCommunity(communityName,communities,aliases),scope=comparisonScope({communityName,communityId:match.communityId,period,year,url:location.href}),selected=scope.communityId;
  period=scope.period;
  if(!period&&selected){const y=scope.year;const latest=await central.fetchJson(`/atlas_financial_comparison_heads?community_id=eq.${encodeURIComponent(selected)}&period_key=gte.${y}-01&period_key=lt.${y+1}-01&select=period_key&order=period_key.desc&limit=1`);if(!alive())return;period=latest[0]?.period_key;}

  container.innerHTML=`<h3>Shared actuals comparison</h3><p>Select a month to view its saved actuals. The status below distinguishes reviewed records from Admin-closed actuals. Statement budgets are references; the original approved budget is unchanged.</p><label>Community <select data-community><option value="">Choose community</option>${communities.map(c=>`<option value="${esc(c.community_id)}" ${c.community_id===selected?'selected':''}>${esc(c.display_name)}</option>`).join('')}</select></label> <label>Period <input data-period type="month" value="${esc(period||scope.defaultPeriod)}"></label> <button data-load>Load saved comparison</button><p role="status"></p><div data-comparison></div>`;
  const result=container.querySelector('[data-comparison]'),status=container.querySelector('[role=status]');
  async function load(){const token=++epoch;result.replaceChildren();const cid=container.querySelector('[data-community]').value,p=container.querySelector('[data-period]').value;
   if(!cid||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(p)){status.textContent='Choose a community and period.';return;}
   status.textContent='Reading shared actuals…';
   try{const [finance]=await readFinance(central,[cid],[p]);if(!alive()||token!==epoch)return;const policy=finance?.summary?.coveragePolicy;
    if(finance?.summary?.budgetVersion&&(!finance.summary.actualCloseVersion||policy?.fullMonthAllowed===false)){status.textContent='Reading the approved original budget for screen and exports…';const {mountBudgetReport}=await import('./canonical-budget-report.mjs?v=d6bbe9de42cdb96b');await mountBudgetReport(result,central,cid,p,{isCurrent:()=>alive()&&token===epoch});if(!alive()||token!==epoch)return;status.textContent='Approved original budget. Actuals remain unavailable for this period; screen, PDF, CSV and Excel use the same retained canonical snapshot.';return;}
    if(policy?.fullMonthAllowed===false){status.textContent=(policy.classification||'Unavailable')+' — '+policy.reason;result.innerHTML='<p>This period is excluded from authoritative full-month actuals. Its original source and any earlier versions remain retained as evidence.</p><p>Retained versions: '+esc((policy.retainedVersionIds||[]).join(', ')||'None')+'</p>';return;}const closedVersions=await readYear(central,cid,Number(p.slice(0,4)));const closed=closedVersions.find(v=>v.period_key===p);const closedCoverage=coverage(closedVersions,Number(p.slice(0,4)));const heads=await central.fetchJson(`/atlas_financial_comparison_heads?community_id=eq.${encodeURIComponent(cid)}&period_key=eq.${p}&select=version_id&limit=1`);if(!alive()||token!==epoch)return;
    if(closed){status.textContent='Reading the published version for screen and exports…';const {mountCloseReport}=await import('./financial-close-report.mjs?v=c42228307aa97487');await mountCloseReport(result,central,cid,p,{isCurrent:()=>alive()&&token===epoch});if(!alive()||token!==epoch)return;status.textContent='Published full-month actuals. Screen, PDF, CSV and Excel use the same retained canonical snapshot.';return;}
    if(closed)heads.splice(0,heads.length,{version_id:closed.comparison_version_id});
    if(!heads.length){status.textContent='Missing/Open: no actuals applied for this community and month. Open a saved import review; only Admin close makes it published actuals.';return;}
    const [version]=await central.fetchJson(`/atlas_financial_comparison_versions?version_id=eq.${heads[0].version_id}&select=*&limit=1`);if(!alive()||token!==epoch)return;if(!version)throw Error('The saved version is unavailable.');
    let offset=0;status.textContent=`${closed?'Closed · revision '+closed.revision:version.status} · ${version.period_key} · ${version.accounting_basis} · ${version.row_count} GLs · ${closed?"Closed":"Saved"} ${new Date(closed?.approved_at||version.applied_at).toLocaleString()}`;
    result.innerHTML=`${closedCoverage.last?`<p>Closed through ${new Date(Number(p.slice(0,4)),closedCoverage.last-1,1).toLocaleString('en-US',{month:'long',year:'numeric'})}. ${closedCoverage.completeYtd?'Full consecutive YTD coverage.':'Incomplete YTD coverage: missing months '+closedCoverage.missing.join(', ')+'. Source-statement YTD is shown separately; missing months are not zero.'}</p>`:''}<p>Canonical close: ${esc(closed?.version_id||'Not closed')}</p><p>Source: ${esc(closed?.source_file||version.source_file)}<br>SHA-256: <code>${esc(closed?.source_hash||version.source_hash)}</code></p><p>Variance below is Actual − source-statement budget, not a favorable/unfavorable rating. Approval of the original budget and GL nature must be verified separately.</p><div style="max-height:520px;overflow:auto"><table><thead><tr><th>GL</th><th>Account</th><th>Actual</th><th>Statement budget</th><th>Variance</th><th>YTD actual</th><th>YTD statement budget</th><th>Source</th></tr></thead><tbody></tbody></table></div><button data-more>Load rows</button>`;
    const more=result.querySelector('[data-more]'),body=result.querySelector('tbody');
    if(closed){const exportButton=document.createElement('button');exportButton.textContent='Export closed actuals with lineage';result.prepend(exportButton);exportButton.onclick=async()=>{exportButton.disabled=true;try{const rows=await readRows(central,closed);if(!alive()||token!==epoch)return;const quote=x=>'"'+String(x??'').replaceAll('"','""')+'"';const csv=[['Community ID','Period','Basis','Close version','Revision','Source','SHA-256','GL','Account','Actual','Source YTD actual','Source location'],...rows.map(r=>[closed.community_id,closed.period_key,closed.accounting_basis,closed.version_id,closed.revision,closed.source_file,closed.source_hash,r.gl_code,r.account_name,r.actual,r.ytd_actual,JSON.stringify(r.source_location)])].map(row=>row.map(quote).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='closed-actuals-'+closed.period_key+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){status.textContent=e.message;}finally{exportButton.disabled=false;}};}

    async function next(){more.disabled=true;try{const rows=await central.fetchJson(`/atlas_financial_comparison_rows?version_id=eq.${version.version_id}&select=gl_code,account_name,actual,source_budget,ytd_actual,source_ytd_budget,source_location&order=gl_code&limit=250&offset=${offset}`);if(!alive()||token!==epoch)return;
      if(closed){const canonical=await central.fetchJson(`/atlas_financial_close_rows?version_id=eq.${closed.version_id}&select=gl_code,account_name,actual,ytd_actual,source_location&order=gl_code&limit=250&offset=${offset}`);if(!alive()||token!==epoch)return;const map=new Map(canonical.map(r=>[r.gl_code,r]));for(const row of rows){if(!map.has(row.gl_code))throw Error('Closed source rows do not match the comparison reference.');Object.assign(row,map.get(row.gl_code));}}
      for(const r of rows){const tr=document.createElement('tr');tr.innerHTML=`<th>${esc(r.gl_code)}</th><td>${esc(r.account_name)}</td><td>${money(r.actual)}</td><td>${money(r.source_budget)}</td><td>${money(r.source_budget===null?null:Number(r.actual)-Number(r.source_budget))}</td><td>${money(r.ytd_actual)}</td><td>${money(r.source_ytd_budget)}</td><td>${esc(r.source_location.page?'Page '+r.source_location.page:(r.source_location.sheet||'')+' row '+(r.source_location.row||r.source_location.line||''))}</td>`;body.append(tr);}
      offset+=rows.length;more.hidden=offset>=version.row_count;more.textContent='Load next 250 rows';more.disabled=false;
     }catch(error){status.textContent=error.message;more.disabled=false;}}
    more.onclick=next;await next();if(!alive()||token!==epoch)return;const u=new URL(location.href);u.searchParams.set('comparisonPeriod',p);u.searchParams.set('comparisonCommunity',cid);history.replaceState(null,'',u);
   }catch(error){if(alive()&&token===epoch)status.textContent=error.message;}
  }
  container.querySelector('[data-load]').onclick=load;container.querySelector('[data-community]').onchange=load;container.querySelector('[data-period]').onchange=load;await load();
 }catch(error){if(alive())container.querySelector('[role=status]').textContent=error.message;}
}
