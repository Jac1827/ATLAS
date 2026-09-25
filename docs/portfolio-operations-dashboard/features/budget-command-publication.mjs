import {reviewOriginalBudget,budgetPublicationStatus} from './approved-budget.mjs?v=631bead1e9164b89';
import {readDetail} from './canonical-finance.mjs?v=fd8a20e264fb5c1b';
/* Explicit, reviewed publication from Budget Builder; never runs in dashboard startup. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numeric=v=>typeof v==='number'&&Number.isFinite(v);
const money=v=>numeric(v)?v.toLocaleString('en-US',{style:'currency',currency:'USD'}):'Missing';
let active;
function host(){if(window.parent===window||window.parent.location.origin!==location.origin||!window.parent.atlasAccessDecision(12).ok)throw Error('Open Budget Builder inside an authorized ATLAS session.');return window.parent;}
function dialog(title){active?.remove();const el=document.createElement('dialog');el.style.cssText='width:min(1100px,94vw);max-height:90vh;overflow:auto;background:white;color:#172b4d;border:1px solid #ccd;border-radius:8px;padding:20px';document.body.append(el);el.innerHTML=`<h2>${esc(title)}</h2><div data-body></div><button data-close type="button">Close</button>`;el.querySelector('[data-close]').onclick=()=>el.close();el.onclose=()=>{el.remove();if(active===el)active=null;};active=el;el.showModal();return el;}
function showPublicationStatus(value){const A=window.RBB?.app;if(A){A.budgetPublicationState=value;A.toast?.(`${value.label}: ${value.message}`,['blocked','conflict','failed'].includes(value.status)?'r':'');}const line=document.querySelector('[data-budget-publication-status]');if(line)line.textContent=`${value.label}: ${value.message}`;return value;}
export async function review(options={}){
 const shell=host(),central=shell.ATLAS_CENTRAL,R=window.RBB,state=R.app.state,prop=state.properties.find(p=>p.id===(options.propertyId||state.activeProperty)),year=Number(options.year||state.budgetYear);
 if(!prop||!Number.isInteger(year))throw Error('Select a community and calendar year before reviewing a budget.');
 const module=await import('./financial-package.mjs?v=a378a0cb25083758');
 const [authorized,aliases]=await Promise.all([central.readCommunitiesForAccess(),central.fetchJson('/atlas_community_aliases?active=eq.true&select=community_id,alias,active&limit=1000')]);
 const cid=module.resolveCommunity(prop.name,authorized,aliases).communityId;if(!cid)throw Error('Canonical community mapping required');
 return reviewOriginalBudget({R,central,cid,prop,year,onStatus:showPublicationStatus});
}
export async function reviewStaged(){
 const R=window.RBB,pending=Object.values(R.app.state.approvedBudgetImports||{}).filter(s=>s.rows?.length&&s.stage!=='readback_verified'&&!s.canonicalVersionId);
 if(!pending.length)return showPublicationStatus(budgetPublicationStatus('nothing_eligible','No staged budget source is eligible here. Accepted import-log entries do not contain approval authority. A new approval requires immutable workbook intake, populated-cell review and a canonical GL registry. Import the complete source for review, or use the central approved budget already shown in financial reports.'));
 host();
 if(pending.length===1)return review({propertyId:pending[0].propertyId,year:pending[0].year});
 showPublicationStatus(budgetPublicationStatus('blocked','Select one staged community/year below for explicit Admin review. No approval has been submitted.'));
 const el=dialog('Staged budget sources — central approval required'),body=el.querySelector('[data-body]');
 body.innerHTML='<p>Import acceptance is staging only. Review and approve each complete fiscal segment separately.</p>'+pending.map((s,i)=>`<p>${esc(R.app.state.properties.find(p=>p.id===s.propertyId)?.name||s.propertyId)} · ${s.year} · ${esc(s.sourceFile)} <button data-budget-review="${i}">Review for central approval</button></p>`).join('');
 for(const button of body.querySelectorAll('[data-budget-review]'))button.onclick=async()=>{const s=pending[Number(button.dataset.budgetReview)];try{const result=await review({propertyId:s.propertyId,year:s.year});el.close();return result;}catch(e){showPublicationStatus(budgetPublicationStatus(/already.*locked|conflict/i.test(e.message)?'conflict':'blocked',e.message));}};
 return el;
}
export async function detail(id,metric='gpr') {
 const shell=host();if(!/^[0-9a-f-]{36}$/i.test(id)||!['gpr','expenses'].includes(metric))throw Error('Invalid financial drill-down.');
 const el=dialog('Budget Builder — published variance'),body=el.querySelector('[data-body]');body.textContent='Loading authorized GL detail…';
 const row=(await shell.ATLAS_CENTRAL.fetchJson(`/atlas_command_financial_publications?publication_id=eq.${id}&select=*&limit=1`))[0];if(!el.isConnected)return;
 if(!row){body.textContent='This published source is unavailable or your role cannot access its financial detail.';return;}
 let p=row.payload;const canonicalSummary=p.canonical?p.summary:null;
 if(p.canonical){
  const s=p.summary,closeRows=await readDetail(shell.ATLAS_CENTRAL,{...s,actualCloseVersion:p.actualCloseVersion});
  const budgetRows=p.budgetVersion?(await shell.ATLAS_CENTRAL.fetchJson(`/atlas_approved_budget_versions?version_id=eq.${p.budgetVersion}&select=*&limit=1`))[0]:null;
  const mapping=budgetRows?.payload.metricMappings?.[metric]||[];
  const codes=new Set([...mapping.map(r=>r.glCode),...(metric==='gpr'?['5120']:[])]);
  const month=Number(row.period_key.slice(5))-1;
  p={builderPropertyName:s.communityId,scenarioId:s.scenarioId,scenarioVersion:s.budgetVersion,actualSource:s.actualSource,budgetSource:s.budgetSource,sourceTimestamp:s.sourceTimestamp,fiscalStartPeriod:s.fiscalStartPeriod,rows:[...codes].map(gl=>({glCode:gl,name:closeRows.find(r=>r.gl_code===gl)?.account_name||budgetRows?.payload.rows.find(r=>r.glCode===gl)?.name,metric,actual:closeRows.find(r=>r.gl_code===gl)?.actual==null?null:Number(closeRows.find(r=>r.gl_code===gl).actual),budget:budgetRows?.payload.rows.find(r=>r.glCode===gl)?.monthly[month]??null,ytdActual:null,ytdBudget:null}))};
 }
 const variance=(r,ytd=false)=>{const a=r[ytd?'ytdActual':'actual'],b=r[ytd?'ytdBudget':'budget'];return numeric(a)&&numeric(b)?(metric==='expenses'?b-a:a-b):null;},rows=p.rows.filter(r=>r.metric===metric).sort((a,b)=>(variance(a)??Infinity)-(variance(b)??Infinity));
 body.innerHTML=`${canonicalSummary?`<p>Canonical ${esc(metric)}: Actual ${money(canonicalSummary[metric]?.actual)} · Approved budget ${money(canonicalSummary[metric]?.budget)} · Favorable variance ${money(canonicalSummary[metric]?.variance)}. Close ${esc(canonicalSummary.actualCloseVersion)}.</p><p>The GL reference below follows the approved budget mapping. The reconciled close control above is authoritative; GL YTD is unavailable in this detail view.</p>`:''}<p><strong>${esc(p.builderPropertyName)}</strong> · Community_ID ${esc(row.community_id)} · ${esc(row.period_key)} · Fiscal year ${row.fiscal_year}</p><p>Approved scenario ${esc(p.scenarioId)} · Version ${esc(p.scenarioVersion)} · Publication ${row.version}</p><p>Actuals: ${esc(p.actualSource)} · ${esc(p.sourceTimestamp)}<br>Budget: ${esc(p.budgetSource)}</p><p>${metric==='expenses'?'Positive variance is favorable underspend. Timing differences, missing invoices and true savings require review.':'Variance is actual GPR minus approved budget.'}</p><table style="width:100%"><thead><tr><th>GL</th><th>Description</th><th>Period actual</th><th>Period budget</th><th>Variance</th><th>YTD actual</th><th>YTD budget</th><th>YTD variance</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.glCode)}</td><td>${esc(r.name)}</td>${[r.actual,r.budget,variance(r),r.ytdActual,r.ytdBudget,variance(r,true)].map(v=>`<td>${money(v)}</td>`).join('')}</tr>`).join('')}</tbody></table><p>Fiscal YTD: ${esc(p.fiscalStartPeriod||'Legacy source')} through ${esc(row.period_key)}. YTD coverage is shown only when the published fiscal period is complete. This immutable snapshot remains unchanged by later uploads.</p><button data-back>Back to Community Command</button>`;
 body.querySelector('[data-back]').onclick=()=>{el.close();const url=new URL(shell.location.href);url.searchParams.delete('ccPublication');url.searchParams.delete('ccMetric');url.searchParams.set('tab','2');shell.history.replaceState(null,'',url);shell.setTab(2);};
}
const failure=e=>showPublicationStatus(budgetPublicationStatus(/already.*locked|conflict/i.test(e.message)?'conflict':/Nothing eligible/i.test(e.message)?'nothing_eligible':'blocked',e.message));
window.AtlasBudgetCommand={review:options=>review(options).catch(failure),reviewStaged:()=>reviewStaged().catch(failure),detail:(id,metric)=>detail(id,metric).catch(e=>alert(e.message))};
if(new URLSearchParams(location.search).get('investorReader')!=='1'&&window.parent!==window){const params=new URLSearchParams(window.parent.location.search);if(params.has('ccPublication'))window.AtlasBudgetCommand.detail(params.get('ccPublication'),params.get('ccMetric')||'gpr');}
