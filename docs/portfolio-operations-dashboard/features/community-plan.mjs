import {readFinance} from './canonical-finance.mjs?v=60c13a0342f297e2';
import {reportHtml,reportSummary,reportGoalRows,activeReforecastRows} from './community-plan-report.mjs?v=be0c6d9dc0729ed4';
/* Community-scoped, versioned plans. Loaded only when the plan editor opens. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stages = ['Suggested','Accepted/Open','In Progress','Completed','Verified','Cancelled'];
const fields = {
 title:'Task title',description:'Description',owner:'Owner',verifier:'Verifier',dueDate:'Due date',
 baselineValue:'Baseline value',targetValue:'Target value',currentValue:'Current value',measurementUnit:'Measurement unit',
 linkedGlCodes:'Linked GL codes (comma separated)',supportingEvidence:'Supporting evidence URL',completionEvidence:'Completion evidence',notes:'Notes'
};
let current;
export function close() { current?.abort.abort(); current?.dialog.remove(); current = null; }
function download(blob,name) { const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
export async function open(context) {
 close();
 if (!/^[0-9a-f-]{36}$/i.test(context.communityId) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(context.period)) throw Error('A verified community identity and reporting month are required.');
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Community Performance Plan');
 dialog.style.cssText='width:min(1050px,94vw);max-height:90vh;overflow:auto;background:var(--bg,#fff);color:var(--text,#172b4d);border:1px solid var(--border,#ccd);border-radius:8px;padding:20px';
 const state=current={context,dialog,abort:new AbortController(),plan:null,report:null,busy:false};
 document.body.append(dialog);dialog.addEventListener('close',()=>{if(current===state)close();});dialog.showModal();
 dialog.innerHTML='<p role="status">Loading shared plan…</p><button type="button">Close</button>';dialog.querySelector('button').onclick=close;
 try {
  const [rows,financial]=await Promise.all([
   context.central.fetchJson(`/atlas_community_plans?community_id=eq.${context.communityId}&period_key=eq.${context.period}&select=*&limit=1`,{signal:state.abort.signal}),
   readFinance(context.central,[context.communityId],[context.period],{signal:state.abort.signal})
  ]);
  state.financial=financial[0];
  state.findings=state.financial?.publication_id ? await context.central.fetchJson(`/atlas_command_findings?community_id=eq.${context.communityId}&period_key=eq.${context.period}&publication_id=eq.${state.financial.publication_id}&select=*&limit=10`,{signal:state.abort.signal}) : [];
  if(current!==state)return;
  state.plan=rows[0] || {version:0,payload:{tasks:[],owner:'',executionOwner:'',stage:'Draft'}};render(state);
 } catch(error) { if(current===state) {dialog.innerHTML=`<p role="alert">${esc(error.message)}</p><button type="button">Close</button>`;dialog.querySelector('button').onclick=close;} }
}
function message(state,text,error=false) {const el=state.dialog.querySelector('[data-message]');if(el){el.textContent=text;el.setAttribute('role',error?'alert':'status');}}
function render(state) {
 if(current!==state)return;
 const {context,plan,dialog}=state,p=plan.payload,tasks=p.tasks||[],canEdit=context.canEdit;
 const complete=tasks.filter(t=>['Completed','Verified'].includes(t.status)).length,verified=tasks.filter(t=>t.status==='Verified').length;
 dialog.innerHTML=`<header style="display:flex;justify-content:space-between;gap:16px"><div><h2>Community Performance Plan</h2><p>${esc(context.name)} · ${esc(context.period)} · Version ${plan.version} · ${tasks.length} tasks · ${complete} completed · ${verified} verified</p></div><button class="btn btn-gray btn-sm" data-close>Close</button></header>
 <p data-message role="status">${plan.updated_at?`Saved ${esc(plan.updated_at)}`:'Changes are saved to shared community records.'}</p>
 <form data-plan><div style="display:flex;gap:12px;flex-wrap:wrap">${['owner','executionOwner'].map(k=>`<label>${k==='owner'?'Plan owner':'Primary execution owner'}<input name="${k}" value="${esc(p[k])}" ${canEdit?'':'disabled'}></label>`).join('')}<label>Plan stage<select name="stage" ${canEdit?'':'disabled'}>${['Draft','Active','Improving','Monitoring','Ready for Close','Closed'].map(v=>`<option ${p.stage===v?'selected':''}>${v}</option>`).join('')}</select></label>${canEdit?'<button class="btn btn-blue btn-sm">Save plan details</button>':''}</div><fieldset ${canEdit?'':'disabled'} style="margin-top:12px"><legend>Leadership report review</legend><p>Summarize causes and risks without resident identifiers or confidential unit details.</p><label>Top causes<textarea name="topCauses" maxlength="2000">${esc(p.reportReview?.topCauses)}</textarea></label><label>Material risks<textarea name="materialRisks" maxlength="2000">${esc(p.reportReview?.materialRisks)}</textarea></label><label>Expected resolution date<input name="expectedResolutionDate" type="date" value="${esc(p.reportReview?.expectedResolutionDate)}"></label><label><input name="reviewed" type="checkbox" ${p.reportReview?.reviewed?'checked':''}> I reviewed these causes, risks and resolution date for this reporting period.</label></fieldset></form>
 <div class="tbl-wrap" style="overflow:auto;margin-top:12px"><table class="community-command-plan-table" style="width:100%"><thead><tr><th>Task</th><th>Source</th><th>Owner</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${tasks.map((t,i)=>`<tr><td>${esc(t.title)}</td><td>${esc(t.origin)}</td><td>${esc(t.owner||'Unassigned')}</td><td>${esc(t.dueDate||'Not set')}</td><td>${esc(t.status)}</td><td><button class="btn btn-gray btn-sm" data-edit="${i}">${canEdit?'Edit':'View'}</button></td></tr>`).join('')||'<tr><td colspan="6">No shared tasks for this period.</td></tr>'}</tbody></table></div>
 <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${canEdit?'<button class="btn btn-blue btn-sm" data-add>Add manual task</button>':''}${canEdit&&context.legacy?.tasks?.length&&!p.legacyPlanId?'<button class="btn btn-gray btn-sm" data-copy>Copy existing plan tasks</button>':''}<button class="btn btn-gray btn-sm" data-history>View change history</button>${canEdit&&plan.plan_id?'<button class="btn btn-gray btn-sm" data-report>Generate task execution report</button>':''}</div><section style="margin-top:12px"><h3>Source-backed findings</h3>${(state.findings||[]).map((f,i)=>`<p>${esc(f.payload.category)} · ${esc(f.payload.recommendedResponse)} ${canEdit&&!tasks.some(t=>t.sourceFindingId===f.finding_id)?`<button type="button" data-recommend="${i}" class="btn btn-gray btn-sm">Review recommended task</button>`:''}</p>`).join('')||'<p>No current published financial findings. Missing publication does not imply good performance.</p>'}</section><section data-detail style="margin-top:16px"></section>`;
 dialog.querySelector('[data-close]').onclick=close;
 dialog.querySelector('[data-plan]').onsubmit=event=>{event.preventDefault();if(!canEdit)return;const data=new FormData(event.target);save(state,{...p,owner:data.get('owner'),executionOwner:data.get('executionOwner'),stage:data.get('stage'),reportReview:{topCauses:data.get('topCauses'),materialRisks:data.get('materialRisks'),expectedResolutionDate:data.get('expectedResolutionDate'),reviewed:data.get('reviewed')==='on'}});};
 dialog.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>edit(state,Number(b.dataset.edit)));
 dialog.querySelector('[data-add]')?.addEventListener('click',()=>edit(state,-1));
 dialog.querySelector('[data-copy]')?.addEventListener('click',()=>{
  const legacy=context.legacy;
  const copied=legacy.tasks.map(t=>({id:`legacy-${legacy.id}-${t.id}`,title:t.title,description:t.description,owner:t.assignedTo,verifier:legacy.ownerName,priority:t.priority,dueDate:t.dueDate,category:'Manual',origin:'Manual',legacySource:{planId:legacy.id,taskId:t.id,stage:t.stage,alertId:t.alertId},status:'Accepted/Open',notes:t.notes,baselineValue:t.baselineMetric,targetValue:t.targetMetric,currentValue:t.actualOutcome,measurementUnit:'',completionEvidence:''}));
  save(state,{...p,legacyPlanId:legacy.id,tasks:[...tasks,...copied.filter(t=>!tasks.some(x=>x.id===t.id))]});
 });
 dialog.querySelector('[data-history]').onclick=()=>history(state);
 dialog.querySelectorAll('[data-recommend]').forEach(button=>button.onclick=()=>{const f=state.findings[Number(button.dataset.recommend)];edit(state,-1,{id:'finding-'+f.finding_id,sourceFindingId:f.finding_id,title:f.payload.recommendedResponse,description:`${f.payload.label} · ${context.period} · ${f.payload.source}`,category:f.payload.category,origin:'Recommended',status:'Accepted/Open',priority:'High',baselineValue:f.payload.actual,targetValue:f.payload.target,measurementUnit:'USD',linkedGlCodes:f.metric==='gpr'?['5120']:[],budgetBuilderDeepLink:`?ccPublication=${f.publication_id}&ccMetric=${f.metric}`});});
 dialog.querySelector('[data-report]')?.addEventListener('click',()=>report(state));
}
async function save(state,payload) {
 if(state.busy||current!==state)return;
 state.busy=true;message(state,'Saving and verifying shared record…');
 try {
  const row=await state.context.central.rpc('atlas_save_community_plan',{p_community_id:state.context.communityId,p_period:state.context.period,p_expected_version:state.plan.version,p_payload:payload});
  if(current!==state)return;
  const read=await state.context.central.fetchJson(`/atlas_community_plans?plan_id=eq.${row.plan_id}&select=*&limit=1`,{signal:state.abort.signal});
  if(current!==state)return;
  if(!read[0]||read[0].version<row.version)throw Error('Save returned, but committed readback is unavailable. Reload before editing.');
  state.plan=read[0];state.report=null;render(state);message(state,'Shared plan saved and read back.');
 }catch(error){if(current===state)message(state,error.message,true);}finally{state.busy=false;}
}
function edit(state,index,seed) {
 const task=seed||state.plan.payload.tasks[index]||{id:crypto.randomUUID(),title:'',origin:'Manual',category:'Manual',priority:'Normal',status:'Accepted/Open'};
 const readonly=!state.context.canEdit,detail=state.dialog.querySelector('[data-detail]');
 detail.innerHTML=`<form data-task><h3>${index<0?'New manual task':'Task details'}</h3><p>Source: ${esc(task.origin)}${task.sourceFindingId?' · Finding '+esc(task.sourceFindingId):''} · ${esc(state.context.period)}</p><fieldset ${readonly?'disabled':''} style="border:0;padding:0"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">${Object.entries(fields).map(([key,label])=>`<label>${label}<${['description','notes','completionEvidence'].includes(key)?'textarea':'input'} name="${key}" ${key==='dueDate'?'type="date"':''} ${key==='title'?'required maxlength="300"':''} ${['description','notes','completionEvidence'].includes(key)?`>${esc(task[key])}</textarea>`:`value="${esc(Array.isArray(task[key])?task[key].join(', '):task[key])}">`}</label>`).join('')}
 <label>Category<select name="category">${['Occupancy','GPR','Expenses','Data Readiness','Manual'].map(v=>`<option ${task.category===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Priority<select name="priority">${['Low','Normal','High','Critical'].map(v=>`<option ${task.priority===v?'selected':''}>${v}</option>`).join('')}</select></label><label>Status<select name="status">${stages.map(v=>`<option ${task.status===v?'selected':''} ${v==='Verified'&&(!state.context.canVerify||!['Completed','Verified'].includes(task.status))?'disabled':''}>${v}</option>`).join('')}</select></label></div><p>Completion requires evidence. Verification is a separate authorized action. Reopen a verified task before changing its details.</p>${readonly?'':'<button class="btn btn-blue btn-sm">Save task</button>'}</fieldset><button type="button" data-cancel class="btn btn-gray btn-sm">Close details</button></form>`;
 detail.querySelector('[data-cancel]').onclick=()=>detail.replaceChildren();
 detail.querySelector('form').onsubmit=event=>{event.preventDefault();if(readonly)return;const values=Object.fromEntries(new FormData(event.target)),tasks=state.plan.payload.tasks.slice();values.linkedGlCodes=values.linkedGlCodes.split(',').map(v=>v.trim()).filter(Boolean);const next={...task,...values};if(index<0)tasks.push(next);else tasks[index]=next;save(state,{...state.plan.payload,tasks});};
}
async function history(state) {
 if(!state.plan.plan_id){message(state,'No saved changes yet.');return;}
 try {const events=await state.context.central.fetchJson(`/atlas_community_plan_events?plan_id=eq.${state.plan.plan_id}&select=event_id,version,actor_id,created_at&order=version.desc&limit=25`,{signal:state.abort.signal});if(current!==state)return;
 const container=state.dialog.querySelector('[data-detail]');
 container.innerHTML='<h3>Latest 25 changes</h3>'+events.map((e,i)=>`<details data-event="${i}"><summary>Version ${e.version} · ${esc(e.created_at)} · ${esc(e.actor_id)}</summary><pre style="white-space:pre-wrap"></pre></details>`).join('');
 container.querySelectorAll('[data-event]').forEach(el=>el.addEventListener('toggle',async()=>{
  if(!el.open||el.dataset.loaded)return;el.dataset.loaded='pending';
  try{const rows=await state.context.central.fetchJson(`/atlas_community_plan_events?event_id=eq.${events[Number(el.dataset.event)].event_id}&select=previous_payload,next_payload&limit=1`,{signal:state.abort.signal});if(current!==state||!el.isConnected)return;el.querySelector('pre').textContent=JSON.stringify(rows[0],null,2);el.dataset.loaded='true';}
  catch(e){if(current===state){el.querySelector('pre').textContent=e.message;delete el.dataset.loaded;}}
 }));
 }catch(e){if(current===state)message(state,e.message,true);}
}

async function report(state) {
 const note=prompt('Executive note for the task execution report (no resident or confidential unit details):','');if(note===null)return;
 try {message(state,'Saving immutable report…');const record=await state.context.central.rpc('atlas_generate_community_plan_report',{p_plan_id:state.plan.plan_id,p_expected_version:state.plan.version,p_note:note,p_occupancy:state.context.occupancy||null});if(current!==state)return;state.report=record;
 const detail=state.dialog.querySelector('[data-detail]');detail.innerHTML=`<div data-preview>${reportHtml(record)}</div><div style="display:flex;gap:8px;margin-top:12px"><button data-html class="btn btn-gray btn-sm">Export report</button><button data-print class="btn btn-gray btn-sm">Print / Save PDF</button><button data-xlsx class="btn btn-gray btn-sm">Export supporting XLSX</button><button data-email class="btn btn-gray btn-sm">Email this report</button></div>`;
 const html=`<!doctype html><html><head><meta charset="utf-8"><title>Community Plan Task Execution</title></head><body style="font:14px Arial;padding:24px">${reportHtml(record)}</body></html>`;
 detail.querySelector('[data-html]').onclick=()=>download(new Blob([html],{type:'text/html'}),`community-plan-${record.report_id}.html`);
 detail.querySelector('[data-print]').onclick=()=>{const frame=document.createElement('iframe');frame.style.display='none';frame.srcdoc=html;frame.onload=()=>{frame.contentWindow.onafterprint=()=>frame.remove();frame.contentWindow.print();setTimeout(()=>frame.remove(),60000);};document.body.append(frame);};
 detail.querySelector('[data-email]').onclick=async()=>{
  const recipients=prompt('Recipients for this exact report snapshot (comma separated):','');if(recipients===null)return;
  const to=recipients.split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);if(!to.length)return;
  if(!confirm('Send the report shown above to '+to.join(', ')+'?'))return;
  try{const config=state.context.central.getConfig(),token=state.context.central.getSession()?.access_token;
   const response=await fetch(new URL('/api/atlas/community-plan/email',config.accessApiBaseUrl||location.origin),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({reportId:record.report_id,recipients:to})});const result=await response.json();if(!response.ok)throw Error(result.error||'Email delivery failed.');if(current===state)message(state,'Report sent and delivery recorded.');
  }catch(e){if(current===state)message(state,e.message,true);}
 };
 detail.querySelector('[data-xlsx]').onclick=()=>{if(!window.XLSX){message(state,'Workbook export library is unavailable. Export the report or try again.',true);return;}const workbook=window.XLSX.utils.book_new(),rows=record.snapshot.plan.tasks.map(t=>({Community:record.snapshot.community,Period:record.snapshot.period,Task:t.title,Source:t.origin,Owner:t.owner||'',Due:t.dueDate||'',Status:t.status,Report_ID:record.report_id,Source_updated:record.snapshot.sourceUpdatedAt}));window.XLSX.utils.book_append_sheet(workbook,window.XLSX.utils.json_to_sheet(rows),'Tasks');window.XLSX.utils.book_append_sheet(workbook,window.XLSX.utils.json_to_sheet(['gpr','revenue','expenses','noi','cashFlow','capital','debt','assets','liabilities','equity','ytdGpr','ytdExpenses'].map(metric=>({Metric:metric,...record.snapshot.financial?.summary?.[metric],Budget_version:record.snapshot.financial?.summary?.budgetVersion,Close_version:record.snapshot.financial?.summary?.actualCloseVersion,Registry:record.snapshot.financial?.summary?.registryVersion,Period:record.snapshot.period,Report_ID:record.report_id,Source_updated:record.snapshot.financial?.summary?.sourceTimestamp||'Unavailable'}))),'Financial summary');window.XLSX.utils.book_append_sheet(workbook,window.XLSX.utils.json_to_sheet([{Community:record.snapshot.community,Period:record.snapshot.period,...record.snapshot.occupancy,Executive_note:record.executive_note,Coverage:record.snapshot.coverage,Report_ID:record.report_id,Generated:record.created_at}]),'Report context');window.XLSX.utils.book_append_sheet(workbook,window.XLSX.utils.json_to_sheet(reportSummary(record).progress),'Prior report comparison');window.XLSX.utils.book_append_sheet(workbook,window.XLSX.utils.json_to_sheet([{...record.snapshot.review,Overall_status:reportSummary(record).overall,Prior_report:record.snapshot.previousReport?.reportId||'Unavailable',Prior_period:record.snapshot.previousReport?.period||'Unavailable',Report_ID:record.report_id}]),'Leadership review');window.XLSX.utils.book_append_sheet(workbook,window.XLSX.utils.json_to_sheet(activeReforecastRows(record)),'Active reforecast');const goalRows=reportGoalRows(record);window.XLSX.utils.book_append_sheet(workbook,window.XLSX.utils.json_to_sheet(goalRows.goals),'Approved goals');window.XLSX.utils.book_append_sheet(workbook,window.XLSX.utils.json_to_sheet(goalRows.weekly),'Weekly goals');window.XLSX.writeFile(workbook,`community-plan-${record.report_id}.xlsx`);};message(state,'Report saved. Exports use this exact snapshot.');
 }catch(e){if(current===state)message(state,e.message,true);}
}

window.addEventListener("pagehide",close);
