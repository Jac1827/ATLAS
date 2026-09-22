import {readApprovedBudgets} from './canonical-finance.mjs?v=60c13a0342f297e2';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digest=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v)))),b=>b.toString(16).padStart(2,'0')).join('');
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function proposeMappings(rows){
 const scope=(filter,factor=1)=>rows.filter(filter).map(r=>({glCode:r.glCode,factor}));
 const revenue=scope(r=>['income','contra_income'].includes(r.nature)),expenses=scope(r=>r.nature==='expense');
 const result={gpr:[{glCode:'5120',factor:1}],revenue,expenses,noi:[...revenue,...expenses.map(r=>({...r,factor:-1}))],netRentalIncome:[],cashFlow:[],capital:scope(r=>r.nature==='capital'),debt:scope(r=>r.nature==='debt')};
 const gls={lossToLease:['5125'],vacancyLoss:['5220','5224'],concessions:['5250','5258'],employeeModelLoss:['5221','5222','5223'],badDebt:['5255'],utilityReimbursement:['5912','5915','5916','5917','5942','5943','5944','5956'],parkingIncome:['5170','5936'],storageIncome:['5175'],petIncome:['5952','5964'],amenityIncome:['5941'],contractLabor:['6523'],security:['6530'],landscaping:['6537'],propertyTaxes:['6710','6715','6750','6810','6820','6830'],insurance:['6719','6720','6721','6800']};
 for(const [key,codes] of Object.entries(gls))result[key]=scope(r=>codes.includes(r.glCode),['lossToLease','vacancyLoss','concessions','employeeModelLoss','badDebt'].includes(key)?-1:1);
 const groups={payroll:['PAYROLL & RELATED EXPENSES'],repairs:['REPAIRS & MAINTENANCE'],turnExpense:['TURNOVER EXPENSE'],utilities:['COMMON AREA UTILITIES EXPENSE','UNIT UTILITIES EXPENSE'],marketingExpense:['MARKETING & ADVERTISING'],adminExpense:['GENERAL & ADMINISTRATIVE'],managementFees:['MANAGEMENT FEES'],otherIncome:['OTHER INCOME']};
 for(const [key,names] of Object.entries(groups))result[key]=scope(r=>names.includes(r.group));
 return result;
}
export async function reviewOriginalBudget({R,central,cid,prop,year}){
 if(central.getStoredProfile()?.role!=='admin')throw Error('Only an Admin may approve the shared original budget.');
 const state=R.app.state,baseline=state.approvedBudgetImports?.[prop.id+'|'+year],scenario=state.scenarios.find(s=>s.id===state.activeScenario&&s.type==='approved'&&s.locked);
 if(!scenario||!baseline?.rows?.length||!baseline.effectiveDate)throw Error('Select the locked approved scenario and import the approved annual budget with its effective date first.');
 if(state.demoActuals)throw Error('Disable demo mode before approving financial sources.');
 const coverage=baseline.coverage||Array.from({length:12},(_,i)=>i);
 const existing=(await readApprovedBudgets(central,cid,year)).find(b=>(b.covered_months||Array.from({length:12},(_,i)=>i)).some(m=>coverage.includes(m)));
 if(existing){alert(`The shared original budget is already locked: ${existing.source_file} · ${existing.version_id}. Revisions cannot replace the original baseline.`);return existing;}
 const rows=baseline.rows.map(r=>({glCode:String(r.gl),name:r.name,monthly:r.monthly.slice(),sourceRow:r.sourceRow??null,nature:R.gl(r.gl).nature,group:R.gl(r.gl).group}));
 if(rows.some(r=>r.monthly.length!==12||coverage.some(m=>!finite(r.monthly[m]))))throw Error('All approved GLs require explicit amounts in every covered month. Missing amounts cannot become zero.');
 for(const row of rows)row.monthly=row.monthly.map((v,m)=>coverage.includes(m)?v:null);
 const mappings=proposeMappings(rows),el=document.createElement('dialog');el.style.cssText='width:min(1000px,94vw);max-height:90vh;overflow:auto;padding:24px';
 el.innerHTML=`<h2>Approve shared original budget</h2><p>${esc(prop.name)} · ${year} · ${esc(baseline.sourceFile)} · Effective ${esc(baseline.effectiveDate)} · Covered months: ${coverage.map(m=>months[m]).join(', ')}</p><p>Review the complete annual source and each metric’s GL mapping. This locks the original baseline for all authorized sessions. Later revisions and reforecasts must remain separate.</p><label>Fiscal year label <input data-year type="number" value="${year}"></label><label>Fiscal start month <select data-start>${months.map((m,i)=>`<option value="${i+1}" ${m===(prop.fiscalYearBegins||'Jan')?'selected':''}>${m}</option>`).join('')}</select></label><p>Confirm these fiscal settings agree with Community Settings before approval.</p><table><thead><tr><th>GL</th><th>Account</th><th>Annual total</th><th>Classification</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.glCode)}</td><td>${esc(r.name)}</td><td>${r.monthly.reduce((a,b)=>a+(b??0),0).toFixed(2)}</td><td>${esc(r.nature||'Unmapped')}</td></tr>`).join('')}</tbody></table><h3>Review metric GL mappings</h3>${Object.entries(mappings).map(([key,parts])=>`<details data-metric="${esc(key)}"><summary>${esc(key.replace(/([A-Z])/g,' $1'))} · ${parts.length} GLs</summary><label>Add signed amounts for GLs <input data-add value="${esc(parts.filter(p=>p.factor===1).map(p=>p.glCode).join(', '))}"></label><label>Subtract signed amounts for GLs <input data-subtract value="${esc(parts.filter(p=>p.factor===-1).map(p=>p.glCode).join(', '))}"></label></details>`).join('')}<p>Add net rental income or cash flow mappings only after reviewing their full approved scope. Blank mappings remain unavailable. Balance sheet metrics require a reconciled balance sheet source.</p><label><input data-confirm type="checkbox"> I verified the approved original budget, community, fiscal settings, signed values, complete GL coverage, and metric mappings.</label><p><button data-save>Approve and publish budget</button> <button data-close>Cancel</button></p><p data-status role="status"></p>`;
 document.body.append(el);el.showModal();el.querySelector('[data-close]').onclick=()=>el.close();el.onclose=()=>el.remove();
 el.querySelector('[data-save]').onclick=async()=>{
  const status=el.querySelector('[data-status]'),button=el.querySelector('[data-save]');
  if(!el.querySelector('[data-confirm]').checked){status.textContent='Complete the source and mapping review first.';return;}
  button.disabled=true;
  try{
   const sourceHash=await digest({sourceFile:baseline.sourceFile,sourceSheet:baseline.sourceSheet,effectiveDate:baseline.effectiveDate,rows});
   const payload={communityId:cid,year,coverage,fiscalYear:Number(el.querySelector('[data-year]').value),fiscalStartMonth:Number(el.querySelector('[data-start]').value),scenarioId:scenario.id,scenarioVersion:await digest(scenario),effectiveDate:baseline.effectiveDate,sourceFile:baseline.sourceFile,sourceHash,sourceHashKind:'normalized_approved_rows',sourceSheet:baseline.sourceSheet||'',rows,metricMappings:Object.fromEntries([...el.querySelectorAll('[data-metric]')].map(field=>[field.dataset.metric,[...field.querySelector('[data-add]').value.split(',').map(v=>v.trim()).filter(Boolean).map(glCode=>({glCode,factor:1})),...field.querySelector('[data-subtract]').value.split(',').map(v=>v.trim()).filter(Boolean).map(glCode=>({glCode,factor:-1}))]])),occupancyPct:Array.from({length:12},(_,i)=>finite(prop.occupancyByYear?.[year]?.[i])?Math.round(prop.occupancyByYear[year][i]*10000)/100:null),registryVersion:'atlas-finance-v1',approvedLocked:true,reviewConfirmed:true};
   const response=await central.rpc('atlas_approve_original_budget',{p_community_id:cid,p_payload:payload}),version=Array.isArray(response)?response[0]:response;
   const read=(await readApprovedBudgets(central,cid,year)).find(b=>b.version_id===version.version_id);if(read?.version_id!==version.version_id||read?.content_hash!==version.content_hash)throw Error('Budget approval readback unavailable. Reload before retrying.');
   status.textContent=`Original budget approved, published and read back · ${read.version_id}`;
   await window.parent.refreshAtlasClosedFinancials?.(year,true);
  }catch(e){status.textContent=e.message;button.disabled=false;}
 };
 return el;
}
