import {completeOriginalBudgetRecovery} from './reforecast-recovery.mjs?v=638a3b09b938c845';
import {reviewOriginalWorkbook} from './original-budget-intake.mjs?v=6387777eeeeed16f';
import {readApprovedBudgets} from './canonical-finance.mjs?v=aaf7ab487e3250de';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digest=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v)))),b=>b.toString(16).padStart(2,'0')).join('');
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v||'');
const labels={nothing_eligible:'Nothing eligible',blocked:'Blocked',queued:'Queued',committed:'Committed',readback_verified:'Readback verified',conflict:'Conflict',failed:'Failed'};
export function budgetPublicationStatus(status,message,extra={}){return {status,label:labels[status]||status,message,...extra};}
export function requiredBudgetCoverage(year,fiscalYear,start){
 if(!Number.isInteger(year)||!Number.isInteger(fiscalYear)||!Number.isInteger(start)||start<1||start>12)return [];
 return Array.from({length:12},(_,i)=>i).filter(m=>start===1?year===fiscalYear:(year===fiscalYear-1&&m>=start-1)||(year===fiscalYear&&m<start-1));
}
export function validateBudgetApproval(payload,cid,requestId,{historicalReceiptVerified=false}={}){
 if(!uuid(cid)||payload.communityId!==cid||!uuid(requestId))throw Error('Canonical community and a valid approval request ID are required.');
 if(!Number.isInteger(payload.year)||!/^\d{4}-\d{2}-\d{2}$/.test(payload.effectiveDate||'')||!Number.isFinite(Date.parse(payload.effectiveDate+'T00:00:00Z'))||new Date(payload.effectiveDate+'T00:00:00Z').toISOString().slice(0,10)!==payload.effectiveDate)throw Error('An exact valid effective date and calendar year are required. Month-only source dates must be confirmed before approval.');
 const required=requiredBudgetCoverage(payload.year,payload.fiscalYear,payload.fiscalStartMonth),coverage=payload.coverage;
 if(!required.length||!Array.isArray(coverage)||coverage.length!==required.length||new Set(coverage).size!==coverage.length||required.some(m=>!coverage.includes(m)))throw Error('Complete approved fiscal coverage is required for this calendar-year segment. Partial schedules remain staged.');
 if(!/^[a-f0-9]{64}$/i.test(payload.sourceHash||'')||!String(payload.mappingVersion||'').trim())throw Error('Source hash and reviewed mapping version are required.');
 if(!historicalReceiptVerified&&(payload.sourceHashKind!=='workbook_bytes'||payload.governance?.schemaVersion!=='atlas-original-budget-workbook/1'||!uuid(payload.governance?.uploadId)||!payload.governance?.mapping?.confirmed))throw Error('Review the immutable original workbook, calendar scope, populated cells and GL mappings. Browser-normalized rows cannot be approved.');
 if(!payload.reviewConfirmed||!payload.approvedLocked||!payload.sourceFile||!payload.rows?.length)throw Error('Complete source and mapping review is required.');
 const codes=new Set();for(const r of payload.rows){if(!r.glCode||codes.has(r.glCode)||!Array.isArray(r.monthly)||r.monthly.length!==12||coverage.some(m=>!finite(r.monthly[m]))||r.monthly.some((v,m)=>!coverage.includes(m)&&v!==null))throw Error('Each approved GL needs a unique identity and explicit amounts for every covered month. Missing amounts cannot become zero.');codes.add(r.glCode);}
 for(const parts of Object.values(payload.metricMappings||{}))for(const part of parts)if(!codes.has(part.glCode)||![1,-1].includes(part.factor))throw Error('Every metric mapping must reference a reviewed source GL with an explicit sign.');
}
export async function readBudgetVersion(central,{versionId,contentHash,cid,year}){
 const actor=central.getSession?.()?.user?.id;
 const rows=await central.fetchJson(`/atlas_approved_budget_versions?version_id=eq.${encodeURIComponent(versionId)}&community_id=eq.${encodeURIComponent(cid)}&calendar_year=eq.${year}&select=*&limit=1`),row=rows?.[0];
 if(central.getSession&&actor!==central.getSession()?.user?.id)throw Error('Session changed during budget readback.');
 if(rows?.length!==1||row.version_id!==versionId||row.content_hash!==contentHash||row.community_id!==cid||row.calendar_year!==year||row.status!=='locked')throw Error('Committed budget version/hash readback did not match. No verified success was recorded. Retry verification with the same request.');
 return row;
}
// This is the only frontend publication path. A receipt is verified after exact-ID readback.
export async function approveOriginalBudget({central,cid,payload,requestId,importRecovery,onStatus=()=>{}}){
 let committed=null,phase='blocked';const actor=central.getSession?.()?.user?.id;
 const session=()=>{if(central.getSession&&actor!==central.getSession()?.user?.id)throw Error('Session changed during budget approval.');};
 try{
  if(central.getStoredProfile()?.role!=='admin')throw Error('Only an Admin may approve the shared original budget.');
  let historicalReceiptVerified=false;
  if(payload.governance?.schemaVersion!=='atlas-original-budget-workbook/1'&&uuid(requestId)){const receipts=await central.fetchJson(`/atlas_financial_intake_receipts?request_id=eq.${encodeURIComponent(requestId)}&community_id=eq.${encodeURIComponent(cid)}&select=receipt_id,actor_id,status,version_id,content_hash&limit=1`);session();const r=receipts?.[0];historicalReceiptVerified=receipts?.length===1&&r.actor_id===actor&&r.status==='canonically_published'&&uuid(r.version_id)&&uuid(r.receipt_id)&&/^[a-f0-9]{64}$/i.test(r.content_hash||'');}
  validateBudgetApproval(payload,cid,requestId,{historicalReceiptVerified});session();phase='queued';onStatus(budgetPublicationStatus(phase,'Submitting the reviewed source to central approval.',{requestId}));
  const response=await central.rpc('atlas_approve_original_budget_governed',{p_community_id:cid,p_request_id:requestId,p_payload:payload});session();
  const result=Array.isArray(response)?response[0]:response,version=result?.budget,receipt=result?.receipt;
  if(result?.status!=='committed'||!uuid(version?.version_id)||!/^[a-f0-9]{64}$/i.test(version?.content_hash||'')||!uuid(receipt?.receipt_id)||receipt.version_id!==version.version_id||receipt.content_hash!==version.content_hash)throw Error('Central approval did not return a matching durable budget receipt. No verified success was recorded.');
  committed={versionId:version.version_id,contentHash:version.content_hash,receiptId:receipt.receipt_id,receipt,publications:result.publications||[]};phase='committed';onStatus(budgetPublicationStatus(phase,'Central budget committed; verifying the stored version and reporting projections.',{...committed,requestId}));
  const read=await readBudgetVersion(central,{...committed,cid,year:payload.year});session();
  if(read.payload?.sourceHash!==payload.sourceHash||read.payload?.mappingVersion!==payload.mappingVersion)throw Error('Committed source hash or mapping version differs from this review.');
  const verified=await central.rpc('atlas_verify_finance_receipt',{p_receipt_id:receipt.receipt_id,p_version_id:read.version_id,p_content_hash:read.content_hash});session();
  const proof=Array.isArray(verified)?verified[0]:verified;
  if(proof?.status!=='readback_verified'||proof.version_id!==read.version_id||proof.content_hash!==read.content_hash||!uuid(proof.receipt_id)||proof.source_hash!==payload.sourceHash||proof.mapping_version!==payload.mappingVersion||!proof.actor_id||!proof.created_at)throw Error('Central readback verification receipt is incomplete or unavailable. Retry verification with the same request.');
  const outcome=budgetPublicationStatus('readback_verified','Original budget and central reporting projections verified.',{...committed,receiptId:proof.receipt_id,receipt:proof,requestId,budget:read});if(importRecovery)await completeOriginalBudgetRecovery(central,{recovery:importRecovery,payload,result:outcome});session();onStatus(outcome);return outcome;
 }catch(error){
  const conflict=/conflict|already.*(?:approved|locked)|overlap|idempotency|immutable|request ID reused/i.test(error.message),status=conflict?'conflict':phase==='blocked'?'blocked':'failed';
  error.publication=budgetPublicationStatus(status,error.message,{...committed,requestId,committed:!!committed});onStatus(error.publication);throw error;
 }
}
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
export async function reviewOriginalBudget({R,central,cid,prop,year,onStatus=()=>{}}){
 if(central.getStoredProfile()?.role!=='admin')throw Error('Only an Admin may approve the shared original budget.');
 const state=R.app.state,baseline=state.approvedBudgetImports?.[prop.id+'|'+year],scenario=state.scenarios.find(s=>s.id===state.activeScenario&&s.type==='approved'&&s.locked);
 if(!scenario||!baseline?.rows?.length||!baseline.effectiveDate)throw Error('Nothing eligible: select the locked original-budget scenario and stage the full approved source with its effective date first. An accepted import log alone is not a central approval.');
 if(state.demoActuals)throw Error('Disable demo mode before approving financial sources.');
 const coverage=baseline.coverage||Array.from({length:12},(_,i)=>i);
 const existing=(await readApprovedBudgets(central,cid,year)).find(b=>(b.covered_months||Array.from({length:12},(_,i)=>i)).some(m=>coverage.includes(m)));
 if(existing&&!baseline.approvalAttempt){const message=`The central original budget is already locked: ${existing.source_file} · version ${existing.version_id} · hash ${existing.content_hash}. Revisions cannot replace the original baseline.`;onStatus(budgetPublicationStatus('conflict',message,{versionId:existing.version_id,contentHash:existing.content_hash}));throw Error(message);}
 if(!baseline.governance&&baseline.approvalAttempt?.committed){const outcome=await approveOriginalBudget({central,cid,payload:baseline.approvalAttempt.payload,requestId:baseline.approvalAttempt.requestId,importRecovery:baseline.importRecovery,onStatus});baseline.publishedAt=outcome.receipt.created_at;baseline.canonicalVersionId=outcome.versionId;baseline.canonicalContentHash=outcome.contentHash;baseline.publicationReceipt=outcome.receipt;baseline.stage='readback_verified';R.persist?.autosave?.();return outcome;}
 if(baseline.governance?.schemaVersion!=='atlas-original-budget-workbook/1'||baseline.sourceHashKind!=='workbook_bytes')return reviewOriginalWorkbook({central,cid,propertyId:prop.id,year,effectiveDate:baseline.effectiveDate,onReviewed:async reviewed=>{state.approvedBudgetImports[prop.id+'|'+year]=reviewed;R.persist?.autosave?.();await reviewOriginalBudget({R,central,cid,prop,year,onStatus});}});
 const rows=baseline.rows.map(r=>({glCode:String(r.gl),name:r.name,monthly:r.monthly.slice(),sourceRow:r.sourceRow??null,sourceCells:r.sourceCells,nature:r.nature,group:r.group,placement:r.placement}));
 if(rows.some(r=>r.monthly.length!==12||coverage.some(m=>!finite(r.monthly[m]))))throw Error('All approved GLs require explicit amounts in every covered month. Missing amounts cannot become zero.');
 for(const row of rows)row.monthly=row.monthly.map((v,m)=>coverage.includes(m)?v:null);
 const mappings=baseline.approvalAttempt?.payload?.metricMappings||proposeMappings(rows),el=document.createElement('dialog');el.style.cssText='width:min(1000px,94vw);max-height:90vh;overflow:auto;padding:24px';
 el.innerHTML=`<h2>Approve shared original budget</h2><p>${esc(prop.name)} · ${year} · ${esc(baseline.sourceFile)} · Effective ${esc(baseline.effectiveDate)} · Covered months: ${coverage.map(m=>months[m]).join(', ')}</p><p>Review the complete annual source and each metric’s GL mapping. This locks the original baseline for all authorized sessions. Later revisions and reforecasts must remain separate.</p><label>Fiscal year label <input data-year type="number" value="${year}"></label><label>Fiscal start month <select data-start>${months.map((m,i)=>`<option value="${i+1}" ${m===(prop.fiscalYearBegins||'Jan')?'selected':''}>${m}</option>`).join('')}</select></label><p>Confirm these fiscal settings agree with Community Settings before approval.</p><table><thead><tr><th>GL</th><th>Account</th><th>Annual total</th><th>Classification</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.glCode)}</td><td>${esc(r.name)}</td><td>${r.monthly.reduce((a,b)=>a+(b??0),0).toFixed(2)}</td><td>${esc(r.nature||'Unmapped')}</td></tr>`).join('')}</tbody></table><h3>Review metric GL mappings</h3>${Object.entries(mappings).map(([key,parts])=>`<details data-metric="${esc(key)}"><summary>${esc(key.replace(/([A-Z])/g,' $1'))} · ${parts.length} GLs</summary><label>Add signed amounts for GLs <input data-add value="${esc(parts.filter(p=>p.factor===1).map(p=>p.glCode).join(', '))}"></label><label>Subtract signed amounts for GLs <input data-subtract value="${esc(parts.filter(p=>p.factor===-1).map(p=>p.glCode).join(', '))}"></label></details>`).join('')}<p>Add net rental income or cash flow mappings only after reviewing their full approved scope. Blank mappings remain unavailable. Balance sheet metrics require a reconciled balance sheet source.</p><label><input data-confirm type="checkbox"> I verified the approved original budget, community, fiscal settings, signed values, complete GL coverage, and metric mappings.</label><p><button data-save>Approve and publish budget</button> <button data-close>Cancel</button></p><p data-status role="status"></p>`;
 document.body.append(el);el.showModal();el.querySelector('[data-close]').onclick=()=>el.close();el.onclose=()=>el.remove();
 const initialStart=baseline.governance.mapping.calendar.startMonth;el.querySelector('[data-start]').value=String(initialStart);
 el.querySelector('[data-year]').value=baseline.approvalAttempt?.payload?.fiscalYear||year+(initialStart>1&&coverage.every(m=>m>=initialStart-1)?1:0);
 if(baseline.approvalAttempt?.payload?.fiscalStartMonth)el.querySelector('[data-start]').value=baseline.approvalAttempt.payload.fiscalStartMonth;
 const effective=document.createElement('label');effective.textContent='Confirmed effective date ';const effectiveInput=document.createElement('input');effectiveInput.type='date';effectiveInput.value=baseline.approvalAttempt?.payload?.effectiveDate||(/^\d{4}-\d{2}-\d{2}$/.test(baseline.effectiveDate)?baseline.effectiveDate:'');effective.append(effectiveInput);el.querySelector('[data-save]').parentElement.before(effective);
 const sourceEvidence=document.createElement('p');sourceEvidence.textContent=`Immutable workbook upload ${baseline.governance.uploadId} · Source SHA-256: ${baseline.sourceHash} · Reviewed mapping ${baseline.governance.mapping.version}`;sourceEvidence.style.overflowWrap='anywhere';effective.before(sourceEvidence);
 const emit=value=>{const status=el.querySelector('[data-status]');status.textContent=`${value.label}: ${value.message}${value.versionId?' · Version '+value.versionId:''}${value.contentHash?' · Hash '+value.contentHash:''}${value.receiptId?' · Receipt '+value.receiptId:''}`;status.dataset.state=value.status;baseline.publicationStatus={...value,budget:undefined};baseline.syncStatus=status.textContent;onStatus(value);try{R.persist?.autosave?.();}catch{ /* central receipts remain authoritative */ }};
 emit(budgetPublicationStatus('blocked','Staged evidence only. Complete the source, coverage and mapping review to authorize central approval.'));
 el.querySelector('[data-save]').onclick=async()=>{
  const status=el.querySelector('[data-status]'),button=el.querySelector('[data-save]');
  if(!el.querySelector('[data-confirm]').checked){emit(budgetPublicationStatus('blocked','Complete the source and mapping review first.'));return;}
  button.disabled=true;
  try{
   const sourceHash=baseline.sourceHash;
   const payload={communityId:cid,year,coverage,fiscalYear:Number(el.querySelector('[data-year]').value),fiscalStartMonth:Number(el.querySelector('[data-start]').value),scenarioId:scenario.id,scenarioVersion:await digest(scenario),effectiveDate:baseline.effectiveDate,sourceFile:baseline.sourceFile,sourceHash,sourceHashKind:'workbook_bytes',governance:baseline.governance,currency:baseline.governance.mapping.currency,sourceSheet:baseline.sourceSheet||'',rows,metricMappings:Object.fromEntries([...el.querySelectorAll('[data-metric]')].map(field=>[field.dataset.metric,[...field.querySelector('[data-add]').value.split(',').map(v=>v.trim()).filter(Boolean).map(glCode=>({glCode,factor:1})),...field.querySelector('[data-subtract]').value.split(',').map(v=>v.trim()).filter(Boolean).map(glCode=>({glCode,factor:-1}))]])),occupancyPct:Array.from({length:12},(_,i)=>finite(prop.occupancyByYear?.[year]?.[i])?Math.round(prop.occupancyByYear[year][i]*10000)/100:null),registryVersion:'atlas-finance-v1',approvedLocked:true,reviewConfirmed:true};
   payload.effectiveDate=effectiveInput.value;payload.sourceHashKind='workbook_bytes';payload.mappingVersion='budget-mapping-'+await digest({metricMappings:payload.metricMappings,rows:rows.map(r=>({glCode:r.glCode,nature:r.nature,group:r.group})),coverage,fiscalYear:payload.fiscalYear,fiscalStartMonth:payload.fiscalStartMonth});
   payload.rowCount=rows.length;payload.exceptionCount=0;payload.priorVersionId=null;
   const fingerprint=await digest(payload),prior=baseline.approvalAttempt;
   if(prior?.committed&&prior.fingerprint!==fingerprint)throw Error('A committed approval is awaiting verification. Restore its reviewed inputs before retrying; a different source requires a separate review.');
   const attempt=prior?.fingerprint===fingerprint?prior:{requestId:crypto.randomUUID(),fingerprint,payload};baseline.approvalAttempt=attempt;
   // Save the stable request before issuing the RPC so an uncertain response is safely retryable.
   R.persist?.autosave?.();
   const outcome=await approveOriginalBudget({central,cid,payload,requestId:attempt.requestId,importRecovery:baseline.importRecovery,onStatus:value=>{if(value.versionId){attempt.committed=true;attempt.versionId=value.versionId;attempt.contentHash=value.contentHash;}emit(value);}});
   baseline.publishedAt=outcome.receipt.created_at;baseline.canonicalVersionId=outcome.versionId;baseline.canonicalContentHash=outcome.contentHash;baseline.publicationReceipt=outcome.receipt;baseline.stage='readback_verified';R.persist?.autosave?.();
   button.textContent='Readback verified';
   try{await window.parent.refreshAtlasClosedFinancials?.(year,true);}catch(e){status.textContent+=' · Reporting refresh failed; reload to read the verified central version. '+e.message;}
  }catch(e){if(!e.publication)emit(budgetPublicationStatus(/conflict|already.*locked/i.test(e.message)?'conflict':'blocked',e.message));button.disabled=false;}
 };
 return el;
}
