import {workspaceRow,approvalTaskRows} from './governed-budget-workspace.mjs?v=4303b077988a803c';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function mountBudgetApprovalTasks(host,{central,openReview}={}){
 const actor=central?.getSession?.()?.user?.id;if(!actor)return;
 const current=()=>host.isConnected&&central.getSession?.()?.user?.id===actor;
 host.innerHTML='<h2>Budget and month-end approvals</h2><p role="status">Reading authorized tasks…</p>';
 try{
  const [communities,aliases,profiles]=await Promise.all([central.readCommunitiesForAccess(),central.fetchJson('/atlas_community_aliases?active=eq.true&select=community_id,alias,active&limit=1000'),central.readUserProfiles()]);
  if(!current())return;const ids=communities.filter(c=>!c.deleted_at).map(c=>c.community_id),entries=[],actuals=[];
  for(let offset=0;offset<ids.length;offset+=100){const scope=ids.slice(offset,offset+100),rpc=(name,args)=>central.fetchJson('/rpc/'+name,{method:'POST',body:JSON.stringify(args)}),[forecasts,closes]=await Promise.all([rpc('atlas_read_reforecast_workspace',{p_community_ids:scope}),rpc('atlas_month_end_queue',{p_community_ids:scope,p_year:null})]);if(!current())return;entries.push(...forecasts);actuals.push(...closes);}
  const context={communities,aliases,profiles},rows=approvalTaskRows([...entries.map(entry=>workspaceRow(entry,context)),...actuals.map(row=>({...row,submitterName:profiles.find(p=>p.user_id===row.submitter)?.display_name||'Authorized user',name:'Month-end actuals'}))]);
  host.innerHTML='<h2>Budget and month-end approvals</h2>'+(rows.length?'<div style="overflow:auto"><table><thead><tr><th>Community</th><th>Record</th><th>Submitter</th><th>Age</th><th>Exceptions</th><th>Status</th><th>Action</th></tr></thead><tbody>'+rows.map((row,index)=>'<tr><td>'+esc(row.communityName)+'</td><td>'+esc(row.recordType.replaceAll('_',' '))+'</td><td>'+esc(row.submitterName)+'</td><td>'+esc(row.ageDays??'—')+' days</td><td>'+esc(row.exceptionCount)+'</td><td>'+esc(row.state.replaceAll('_',' '))+'</td><td><button class="btn" data-budget-review="'+index+'">Review</button></td></tr>').join('')+'</tbody></table></div>':'<p>No pending approvals in your authorized communities.</p>');
  host.querySelectorAll('[data-budget-review]').forEach(button=>button.onclick=()=>{if(current())openReview(rows[Number(button.dataset.budgetReview)]);});
 }catch(error){if(current())host.innerHTML='<h2>Budget and month-end approvals</h2><p role="status">Approval tasks could not be loaded. '+esc(error.message)+'</p>';}
}
