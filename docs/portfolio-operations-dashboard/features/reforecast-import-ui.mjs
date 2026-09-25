import {currentReforecastParserVersion,needsReforecastParserRecovery,upgradeReforecastParserEvidence} from './reforecast-parser-recovery.mjs?v=962f6c9558c4700f';
import {persistWorkbookAudit,readWorkbookAudit,readWorkbookAuditBytes,listPendingWorkbookUploads,cancelWorkbookStaging} from './workbook-audit-store.mjs?v=3f5ee248a90b8d0e';
import {compareWorkbookEvidence} from './workbook-integrity.mjs?v=612a2cdba3c9dba2';
import {reviewPlanningInputs,planningMappingDispositions} from './planning-governance.mjs?v=a4de8d3f5a50966c';
import {parseReforecastWorkbook,mapReforecastIntake,validateReforecastPropertyAssignment} from './reforecast-intake.mjs?v=87e68da483f77228';
import {saveUpload,readSourceBundle} from './reforecast-store.mjs?v=a31fb99b0826a753';
import {saveForecastRecovery,readForecastRecovery,listForecastRecovery,removeForecastRecovery} from './reforecast-recovery.mjs?v=33b82bf4c03a6af8';
import {prepareScopedReforecastEvidence,reforecastAuthoritySelectionKey} from './reforecast-authority.mjs?v=f6c72da26c9add9c';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID();
const PERIOD=/^20\d{2}-(0[1-9]|1[0-2])$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const groupKey=line=>JSON.stringify([line.sheet,line.accountCode,line.department]);
const communityId=c=>c.community_id||c.communityId;
const actorId=actor=>typeof actor==='string'?actor:actor?.id||actor?.userId||actor?.user_id;
const style=`.rfi{width:min(1180px,95vw);max-height:92vh;overflow:auto;color:#172b4d;background:#fff;border:1px solid #afbecf;border-radius:10px;padding:22px;font:14px system-ui}.rfi label{display:block;margin:10px 0}.rfi input,.rfi select,.rfi textarea,.rfi button{font:inherit;padding:7px;max-width:100%}.rfi button{margin:4px;cursor:pointer}.rfi textarea{display:block;min-width:300px;min-height:45px}.rfi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.rfi-scroll{overflow:auto;max-height:380px}.rfi table{border-collapse:collapse;width:100%;min-width:700px}.rfi td,.rfi th{text-align:left;padding:7px;border-bottom:1px solid #dbe2ec;vertical-align:top}.rfi th{position:sticky;top:0;background:#eff4fa}.rfi pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:280px;overflow:auto}.rfi .error{background:#fff2ef;border-left:4px solid #ad3535;padding:10px}.rfi .success{background:#edf8f2;border-left:4px solid #24734d;padding:10px}.rfi .muted{color:#596b7f}.rfi .months{display:flex;gap:10px;flex-wrap:wrap}.rfi .months label{white-space:nowrap}.rfi [data-status]{white-space:pre-wrap}.rfi summary{cursor:pointer;padding:8px 0}.rfi .source-label{font-size:12px}.rfi::backdrop{background:#172b4d77}`;

export function reforecastImportPeriods(evidence,defaultPeriods=[]) {
 const provided=[...new Set(defaultPeriods.filter(period=>PERIOD.test(period)))].sort();
 if(provided.length&&provided.length<=24)return provided;
 const all=[...new Set([...(evidence.lines||[]).map(line=>line.period),...(evidence.sheets||[]).flatMap(sheet=>(sheet.periodColumns||[]).map(column=>column.period))].filter(period=>PERIOD.test(period)))].sort();
 return all.slice(-24);
}
export function reforecastImportGroups(evidence,scenario,periods) {
 const groups=new Map();
 for(const line of evidence.lines||[]){
  if(line.scenario!==scenario||!periods.includes(line.period))continue;
  const key=groupKey(line);if(!groups.has(key))groups.set(key,{key,sheet:line.sheet,sourceAccountCode:line.accountCode,name:line.accountName,department:line.department,lines:[]});
  groups.get(key).lines.push(line);
 }
 return [...groups.values()].sort((a,b)=>a.sheet.localeCompare(b.sheet)||a.sourceAccountCode.localeCompare(b.sourceAccountCode));
}
export function reforecastMappingFromReview({evidence,source,assignment,scenario,currency,periods,accountChoices={},selectedLineIds=[],reason,confirmed=false,reviewerId,calendar,inputReviews=[],integrityReviews=[],currencyAliasConfirmed=false}) {
 // Checkbox state survives scenario/month changes. Only the explicitly visible
 // source scenario and reporting months may enter this authority selection.
 const selected=new Set(selectedLineIds);
 selectedLineIds=(evidence.lines||[]).filter(line=>selected.has(line.id)&&line.scenario===scenario&&periods.includes(line.period)).map(line=>line.id);
 const registry=source?.registry||{},groups=reforecastImportGroups(evidence,scenario,periods),accountMappings=[],reviewIssues=[];
 if(!confirmed)reviewIssues.push({code:'mapping_confirmation_required',severity:'error',message:'Confirm the source selection, GL mappings and signed amounts before applying values.'});
 if(!String(reason||'').trim())reviewIssues.push({code:'mapping_reason_required',severity:'error',message:'Enter the reason for using these workbook values.'});
 for(const group of groups){
  if(!group.lines.some(line=>selectedLineIds.includes(line.id)))continue;
  const choice=accountChoices[group.key]||{},matches=(registry.accounts||[]).filter(account=>account.accountCode===choice.accountCode);
  if(matches.length!==1){reviewIssues.push({code:'registry_account_required',severity:'error',message:`Choose one reviewed target GL for ${group.sourceAccountCode} on ${group.sheet}.`});continue;}
  const account=matches[0];
  if(source?.intakePurpose!=='original_budget'&&Array.isArray(source?.baseline?.lines)&&group.lines.some(line=>selectedLineIds.includes(line.id)&&!source.baseline.lines.some(base=>base.period===line.period&&String(base.accountCode??base.glCode)===account.accountCode))&&!choice.noOriginalBudgetRow)reviewIssues.push({code:'original_budget_row_disposition_required',severity:'error',message:`Review the missing original-budget row for ${account.accountCode}; preserve an unavailable baseline instead of assuming zero.`});
  for(const line of group.lines.filter(line=>selectedLineIds.includes(line.id)))if((account.effectiveFrom&&line.period<account.effectiveFrom)||(account.retiredAfter&&line.period>account.retiredAfter))reviewIssues.push({code:'account_not_effective',severity:'error',message:`Target ${account.accountCode} is not effective for ${line.period}.`,sourceLineId:line.id});
  accountMappings.push({sourceAccountCode:group.sourceAccountCode,sheet:group.sheet,department:group.department,accountCode:account.accountCode,category:account.category,nature:account.nature,placement:account.placement,signMultiplier:Number(choice.signMultiplier),allowReversal:choice.allowReversal===true,...(choice.noOriginalBudgetRow?{baselineDisposition:{kind:'no_original_budget_row',confirmed:true,reviewedBy:reviewerId||assignment.actorId,reviewedAt:new Date().toISOString(),reason:String(reason||'').trim()}}:{})});
 }
 const mapping={calendar,inputReviews,integrityReviews,version:registry.version,propertyAssignment:assignment,sourceScenario:scenario,currency,periods,selectedLineIds,accountMappings,reason:String(reason||'').trim(),confirmed,reviewedAt:new Date().toISOString(),reviewedBy:reviewerId||assignment.actorId};
 const currencies=[...new Set(evidence.metadata?.currencies||[])];if(currencies.length===1&&!/^[A-Z]{3}$/.test(currencies[0])){if(!currencyAliasConfirmed)reviewIssues.push({code:'currency_identity_review_required',severity:'error',message:'Confirm that the workbook currency label means the selected reporting currency without exchange conversion.'});mapping.currencyMapping={sourceCurrency:currencies[0],reportingCurrency:currency,method:'identity',confirmed:currencyAliasConfirmed,reviewedBy:mapping.reviewedBy,reviewedAt:mapping.reviewedAt,reason:mapping.reason};}
 Object.assign(mapping,planningMappingDispositions(evidence,mapping));
 return {mapping,reviewIssues};
}
export function evaluateReforecastImportReview(input,authorizedCommunityIds) {
 const {mapping,reviewIssues}=reforecastMappingFromReview(input);
 const noClosedPeriodsConfirmed=input.purpose==='original_budget'||input.source?.communityId===input.assignment.communityId&&/^[a-f0-9]{64}$/.test(input.source?.sourceVersion||'')&&input.source?.actuals?.cutoffPeriod===null&&Array.isArray(input.source?.actuals?.closeVersions)&&input.source.actuals.closeVersions.length===0;
 const result=mapReforecastIntake(input.evidence,mapping,{authorizedCommunityIds,cutoffPeriod:input.purpose==='original_budget'?null:input.source?.actuals?.cutoffPeriod,noClosedPeriodsConfirmed});
 return {...result,issues:[...reviewIssues,...result.issues],ready:result.ready&&!reviewIssues.some(issue=>issue.severity==='error')};
}
export function reforecastImportReconciliation(evidence,result){
 const included=new Map((result.lines||[]).map(line=>[line.sourceLineId,line])),mapping=result.mapping||{},selected=new Set(mapping.selectedLineIds||[]),monthly=new Map();
 const rows=(evidence.lines||[]).map(line=>{const mapped=included.get(line.id),disposition=mapped?'included':line.sourceKind==='workbook_actual_evidence'?'actual_evidence_only':line.scenario!==mapping.sourceScenario?'other_source_scenario':!mapping.periods?.includes(line.period)?'outside_eligible_months':line.amount===null?'blank_or_unavailable':!selected.has(line.id)?'excluded_by_review':'blocked';if(mapped)monthly.set(line.period,(monthly.get(line.period)||0)+mapped.amount);return {sourceLineId:line.id,sheet:line.sheet,cell:line.address,sourceAccountCode:line.accountCode,department:line.department??null,period:line.period,sourceAmount:line.amount,amount:mapped?.amount??null,canonicalGL:mapped?.accountCode??null,disposition};});
 return {includedCount:included.size,excludedCount:rows.length-included.size,zeroCount:[...included.values()].filter(row=>row.amount===0).length,total:[...included.values()].reduce((sum,row)=>sum+row.amount,0),monthly:[...monthly].sort(([a],[b])=>a.localeCompare(b)).map(([period,amount])=>({period,amount})),rows};
}
function showReview(state,result){
 const body=state.el.querySelector('[data-body]'),summary=reforecastImportReconciliation(state.evidence,result);
 body.querySelector('[data-review-status]').textContent=`${result.ready?'Ready to save':'UNSAVED — '+result.issues.filter(issue=>issue.severity==='error').length+' blockers'} · ${summary.includedCount} included cells (${summary.zeroCount} explicit zeros) · ${summary.excludedCount} retained exclusions · signed import total ${summary.total.toLocaleString(undefined,{maximumFractionDigits:2})}.`;
 body.querySelector('[data-mapping-findings]').textContent=JSON.stringify({issues:result.issues,mappingVersion:result.mapping?.version,decisions:result.mapping?.accountMappings,reconciliation:{...summary,rows:undefined}},null,2);
 body.querySelector('[data-reconciliation-rows]').innerHTML=`<table><thead><tr><th>Source cell / GL / department</th><th>Month</th><th>Source amount</th><th>Canonical GL / amount</th><th>Disposition</th></tr></thead><tbody>${summary.rows.map(row=>`<tr><td>${esc(row.sourceLineId)} · ${esc(row.sourceAccountCode)} · ${esc(row.department||'')}</td><td>${esc(row.period)}</td><td>${row.sourceAmount===null?'Blank / unavailable':esc(row.sourceAmount)}</td><td>${esc(row.canonicalGL||'')} / ${row.amount===null?'—':esc(row.amount)}</td><td>${esc(row.disposition)}</td></tr>`).join('')}</tbody></table>`;
}
function currentActor(central){return central.getSession?.()?.user?.id;}
function guard(state){if(!state.actor||currentActor(state.central)!==state.actor)throw Error('Your signed-in account changed. Reopen the import after signing in.');}
function selectOptions(items,value,placeholder='Choose explicitly'){return `<option value="">${esc(placeholder)}</option>`+items.map(item=>`<option value="${esc(item.value)}" ${item.value===value?'selected':''}>${esc(item.label)}</option>`).join('');}
function reportFindings(evidence){
 const counts=(evidence.issues||[]).reduce((all,item)=>(all[item.code]=(all[item.code]||0)+1,all),{});
 return `<details><summary>${evidence.issues?.length||0} workbook findings and retained source evidence</summary><p>File ${esc(evidence.source?.fileName)} · SHA-256 ${esc(evidence.sourceHash||evidence.source?.sha256)}</p><p>${evidence.sheets?.length||0} sheets · ${evidence.summary?.formulas||0} formulas retained without execution. Source Actual columns are evidence only.</p><pre>${esc(JSON.stringify({entities:evidence.metadata?.entities,currencies:evidence.metadata?.currencies,workbookLastClosedMonth:evidence.metadata?.lastClosedMonth,findings:counts,parserVersion:evidence.parserVersion,parserUpgrade:evidence.parserUpgrade,integrityFingerprint:evidence.integrity?.fingerprint,integrityFindingCount:evidence.integrity?.findings?.length||0,integrityFindings:evidence.integrity?.findings?.slice(0,100),planningCellClassifications:(evidence.planningCells||[]).reduce((all,c)=>(all[c.classification]=(all[c.classification]||0)+1,all),{})},null,2))}</pre><details><summary>Finding details</summary><pre>${esc(JSON.stringify(evidence.issues||[],null,2))}</pre></details></details>`;
}
function shell(title){
 const el=document.createElement('dialog');el.className='rfi';el.setAttribute('aria-label',title);
 el.innerHTML=`<style>${style}</style><h2>${esc(title)}</h2><p data-status role="status" aria-live="polite"></p><div data-body></div><div data-transfer-recovery></div><button data-close>Close</button>`;
 document.body.appendChild(el);el.querySelector('[data-close]').onclick=()=>el.close();
 el.addEventListener('close',()=>el.remove());el.showModal();return el;
}
function showStatus(state,message,error=false){const el=state.el.querySelector('[data-status]');el.className=error?'error':message?'success':'';el.textContent=message;}
const reviewFields=['assignment','periods','scenario','currency','accountChoices','reason','confirmed','calendar','inputReviews','integrityReviews','inputReason','requestId','priorVersionId','destination','forecastName','reviewId','currencyAliasConfirmed','scopeSelectionKey','scopedFingerprint','scopedUploadRequestId'];
function retainReview(state){
 const fields=Object.fromEntries(reviewFields.map(key=>[key,state[key]??null]));
 const value={kind:'import-review',communityId:state.assignment?.communityId||null,fileName:state.evidence.source.fileName,evidenceId:state.evidenceId,uploadId:state.upload?.upload_id||null,purpose:state.purpose||'reforecast',fields,selected:[...state.selected]};
 state.recoveryPromise=(state.recoveryPromise||Promise.resolve()).catch(()=>{}).then(()=>{guard(state);return saveForecastRecovery(state.central,state.reviewId,value);});
 state.recoveryPromise.catch(error=>showStatus(state,'Recovery could not be saved: '+error.message,true));return state.recoveryPromise;
}
async function prepareRecovery(state){
 state.evidenceId='workbook:'+state.evidence.source.sha256+':'+state.evidence.parserVersion;
 const reviews=await listForecastRecovery(state.central),prior=reviews.find(row=>row.kind==='import-review'&&row.evidenceId===state.evidenceId&&row.purpose===(state.purpose||'reforecast')&&(!state.upload||row.uploadId===state.upload.upload_id));
 if(prior){Object.assign(state,prior.fields);state.selected=new Set(prior.selected);state.reviewId=prior.id;const retained=await readForecastRecovery(state.central,state.evidenceId);if(retained?.evidence?.parserVersion===currentReforecastParserVersion&&retained?.evidence?.integrity?.fingerprint===state.scopedFingerprint)state.evidence=retained.evidence;else state.scopeSelectionKey=null;}
 else state.reviewId='import-review:'+uid();
 await saveForecastRecovery(state.central,state.evidenceId,{kind:'workbook-evidence',evidence:state.evidence});await retainReview(state);guard(state);
 state.el.addEventListener('input',()=>{if(state.busy)return;if(state.el.querySelector('[data-scenario]'))readReviewFields(state);retainReview(state);});
 state.el.addEventListener('change',()=>{if(state.busy)return;if(state.el.querySelector('[data-scenario]'))readReviewFields(state);retainReview(state);});
 state.el.addEventListener('click',()=>{if(!state.busy)retainReview(state);});
}
async function showTransferRecovery(state){
 const root=state.el.querySelector('[data-transfer-recovery]');
 try{
  guard(state);const rows=await listPendingWorkbookUploads(state.central);guard(state);
  if(!state.el.open)return;
  root.innerHTML=`<details open><summary>Unfinished workbook saves (${rows.length})</summary><p>Retry saving to resume the selected workbook. Discard an abandoned transfer to free save capacity. Saved imports and the selected workbook are retained.</p>${rows.map((row,index)=>{const community=state.communities.find(c=>communityId(c)===row.community_id);return `<p>${esc(community?.display_name||community?.name||'Workbook evidence')} · ${esc(row.kind==='audit'?'Source audit':'Import details')} · ${esc(row.created_at)} · ${esc(Math.ceil(row.declaredBytes/1024))} KB <button data-discard-transfer="${index}">Discard unfinished transfer</button></p>`;}).join('')||'<p>No unfinished saves.</p>'}<p data-recovery-status role="status"></p></details>`;
  for(const button of root.querySelectorAll('[data-discard-transfer]'))button.onclick=async()=>{
   if(state.busy)return;state.busy=true;for(const item of root.querySelectorAll('button'))item.disabled=true;
   try{guard(state);await cancelWorkbookStaging(state.central,rows[Number(button.dataset.discardTransfer)]);guard(state);await showTransferRecovery(state);}
   catch(error){root.querySelector('[data-recovery-status]').textContent=error.message;}
   finally{state.busy=false;for(const item of root.querySelectorAll('button'))item.disabled=false;}
  };
 }catch(error){root.textContent='Unfinished saves could not be loaded: '+error.message;}
}
function periodList(state){return [...new Set([...state.periods,...(state.evidence.lines||[]).filter(line=>line.scenario===state.scenario).map(line=>line.period)])].filter(period=>PERIOD.test(period)).sort();}
function renderProperty(state){
 const body=state.el.querySelector('[data-body]');
 body.innerHTML=`${reportFindings(state.evidence)}<p><a href="./templates/ATLAS_Short_Term_Rental_Planning.xlsx" download>Download the Short-Term Rental planning workbook</a></p><p><strong>Property Required</strong></p><label>Assign an authorized ATLAS community<select data-property>${selectOptions(state.communities.map(c=>({value:communityId(c),label:c.display_name||c.name||communityId(c)})),state.assignment?.communityId||'','Choose property; filenames are not authority')}</select></label><p>Workbook entity evidence: ${esc((state.evidence.metadata?.entities||[]).join(', ')||'Not specified')}</p><label>Assignment reason<textarea data-assignment-reason>${esc(state.assignment?.reason||'')}</textarea></label><label><input type="checkbox" data-confirm-property ${state.assignment?.confirmed?'checked':''}> I verified the source entities above belong to this canonical community.</label><label>Previous source version for formula and input comparison<select data-prior-version>${selectOptions([{value:'none',label:'First source version; no prior workbook to compare'},...(state.priorImports||[]).map(r=>({value:r.upload_id,label:(r.file_name||'Workbook')+' · '+r.created_at}))],state.priorVersionId||'','Choose prior import or explicitly confirm first source version')}</select></label><p>The original workbook bytes, formulas, cached values and findings will be saved as a new immutable import version. Saving evidence does not approve it or update the original budget.</p><button data-save-evidence ${state.busy?'disabled':''}>Save immutable import version</button>`;
 body.querySelector('[data-property]').onchange=async()=>{try{const selected=body.querySelector('[data-property]').value;if(!UUID.test(selected))return;const page=await readReforecastImportPage(state.central,{communityId:selected,limit:100});state.priorImports=page.rows;const select=body.querySelector('[data-prior-version]');select.innerHTML=selectOptions([{value:'none',label:'First source version; no prior workbook to compare'},...page.rows.map(r=>({value:r.upload_id,label:(r.file_name||'Workbook')+' · '+r.created_at}))],'','Choose prior import or confirm first source version');}catch(error){showStatus(state,error.message,true);}};
 body.querySelector('[data-save-evidence]').onclick=async()=>{
  if(state.busy)return;
  try{
   guard(state);const selected=body.querySelector('[data-property]').value,reason=body.querySelector('[data-assignment-reason]').value.trim(),confirmed=body.querySelector('[data-confirm-property]').checked;
   const previous=state.assignment;
   if(!previous||previous.communityId!==selected||previous.reason!==reason||previous.confirmed!==confirmed){state.assignment={communityId:selected,confirmed,explicit:confirmed,reason,actorId:state.actor,assignedAt:new Date().toISOString(),sourceEntities:state.evidence.metadata?.entities||[],entities:state.evidence.metadata?.entities||[]};state.requestId=uid();}
   const validation=validateReforecastPropertyAssignment(state.assignment,state.communities.map(communityId));if(!validation.valid)throw Error(validation.issues.map(item=>item.message).join('\n'));
   const priorId=body.querySelector('[data-prior-version]').value;if(!priorId)throw Error('Choose an earlier workbook version for comparison, or explicitly confirm this is the first source version.');
   if(priorId!=='none'&&state.priorVersionId!==priorId){const rows=await state.central.fetchJson(`/atlas_reforecast_uploads?upload_id=eq.${encodeURIComponent(priorId)}&community_id=eq.${selected}&select=upload_id,payload&limit=1`);guard(state);const prior=rows?.[0]?.payload;if(!prior)throw Error('The selected prior workbook version could not be read.');const priorAudit=prior.integrity?.auditId?await readWorkbookAudit(state.central,prior.integrity,{sourceHash:prior.source.sha256}):prior.integrity;if(!priorAudit?.inventory?.sheets)throw Error('Re-import the earlier workbook with the current inventory before using it as comparison evidence.');state.evidence.integrity=compareWorkbookEvidence(state.originalIntegrity,priorAudit);}
   else if(priorId==='none')state.evidence.integrity=state.originalIntegrity;if(state.priorVersionId!==priorId)state.requestId=uid();state.priorVersionId=priorId;
   state.busy=true;body.querySelector('[data-save-evidence]').disabled=true;showStatus(state,'Saving and verifying the immutable workbook…');
   await retainReview(state);
   const auditRef=await persistWorkbookAudit(state.central,state.evidence.integrity,{communityId:selected,sourceHash:state.evidence.source.sha256,sourceBytes:state.evidence.source.originalFile,onDiagnostic:diagnostic=>showStatus(state,`Saving immutable evidence: ${diagnostic.operation} · ${Math.ceil((diagnostic.requestBytes||0)/1024)} KB · ${(diagnostic.durationMs/1000).toFixed(1)} seconds · ${diagnostic.classification}. Your workbook is retained for recovery.`)});guard(state);
   await retainReview(state);state.upload=await saveUpload(state.central,{communityId:selected,requestId:state.requestId,payload:{...state.evidence,integrity:auditRef,comparison:{priorUploadId:priorId==='none'?null:priorId,firstVersionConfirmed:priorId==='none',confirmedBy:state.actor,confirmedAt:state.assignment.assignedAt},propertyAssignment:state.assignment}});guard(state);await retainReview(state);
   showStatus(state,'Workbook import saved and read back. Review the mapped values before applying them.');
   await loadSource(state);renderMapping(state);
  }catch(error){showStatus(state,error.message+' Your selected workbook and edits are retained.',true);if(state.upload)renderMapping(state);await showTransferRecovery(state);}
  finally{state.busy=false;const button=state.el.querySelector('[data-save-evidence]');if(button)button.disabled=false;}
 };
}
async function loadSource(state){
 guard(state);
 if(!state.periods.length)throw Error('The workbook has no unambiguous reporting months. Evidence is saved; choose reporting months in the reforecast workspace before resuming mapping.');
 if(state.periods.length>24)throw Error('Select at most 24 reporting months.');
 state.source=await readSourceBundle(state.central,{communityId:state.assignment.communityId,periods:state.periods});guard(state);if(state.purpose==='original_budget')state.source={...state.source,actuals:{...state.source.actuals,cutoffPeriod:null},intakePurpose:'original_budget'};
 if(state.purpose!=='original_budget'){
  const cutoff=state.source.actuals?.cutoffPeriod;
  if(cutoff){
   state.periods=state.periods.filter(period=>period>cutoff);
   state.selected=new Set([...state.selected].filter(id=>state.evidence.lines.some(line=>line.id===id&&line.period>cutoff&&line.sourceKind!=='workbook_actual_evidence')));
   if(!state.periods.length)throw Error('All selected months are governed actuals. Choose forecast months after '+cutoff+'.');
  }
 }
}
function readReviewFields(state){
 const root=state.el;
 state.scenario=root.querySelector('[data-scenario]')?.value??state.scenario;
 state.currency=root.querySelector('[data-currency]')?.value??state.currency;
 state.currencyAliasConfirmed=Boolean(root.querySelector('[data-currency-identity]')?.checked);
 state.calendar={basis:root.querySelector('[data-calendar]')?.value||state.calendar?.basis||'',startMonth:Number(root.querySelector('[data-start-month]')?.value||state.calendar?.startMonth||0),confirmed:Boolean(root.querySelector('[data-calendar-confirm]')?.checked),periods:[...state.periods],scenario:state.scenario,reviewedBy:state.actor,reviewedAt:new Date().toISOString()};
 state.reason=root.querySelector('[data-mapping-reason]')?.value??state.reason;
 state.inputReason=root.querySelector('[data-input-reason]')?.value??state.inputReason;
 state.confirmed=Boolean(root.querySelector('[data-confirm-mapping]')?.checked);
 state.destination=root.querySelector('[data-destination]')?.value||state.destination||'new';
 state.forecastName=root.querySelector('[data-forecast-name]')?.value||state.forecastName;
 for(const row of root.querySelectorAll('[data-group-index]')){
  const group=state.groups[Number(row.dataset.groupIndex)];
  state.accountChoices[group.key]={accountCode:row.querySelector('[data-target]').value,signMultiplier:row.querySelector('[data-sign]').value,allowReversal:Boolean(row.querySelector('[data-reversal]').checked),noOriginalBudgetRow:Boolean(row.querySelector('[data-no-original]')?.checked)};
 }
 for(const input of root.querySelectorAll('[data-line-index]')){const line=state.visibleLines[Number(input.dataset.lineIndex)];if(input.checked)state.selected.add(line.id);else state.selected.delete(line.id);}
}
function previewReview(state){
 if(needsReforecastParserRecovery(state.evidence))return {ready:false,lines:[],mapping:{},issues:[{code:'parser_review_required',severity:'error',message:'This retained evidence used an older workbook parser. Reopen the saved import to reparse its exact original workbook and review newly recognized cells.'}]};
 const result=evaluateReforecastImportReview({purpose:state.purpose,evidence:state.evidence,source:state.source,assignment:state.assignment,scenario:state.scenario,currency:state.currency,periods:state.periods,accountChoices:state.accountChoices,selectedLineIds:[...state.selected],reason:state.reason,confirmed:state.confirmed,reviewerId:state.actor,calendar:state.calendar,inputReviews:state.inputReviews,integrityReviews:state.integrityReviews,currencyAliasConfirmed:state.currencyAliasConfirmed},state.communities.map(communityId));
 if(state.purpose!=='original_budget'){let current=false;try{current=state.scopeSelectionKey===reforecastAuthoritySelectionKey(state.evidence,result.mapping);}catch{}if(!current){result.ready=false;result.issues.unshift({code:'forecast_authority_scope_required',severity:'error',message:'Review the selected forecast scope and its retained workbook findings before applying values.'});}}
 return result;
}
async function reviewAuthorityScope(state){
 readReviewFields(state);guard(state);const mapping={sourceScenario:state.scenario,periods:[...state.periods],selectedLineIds:(state.evidence.lines||[]).filter(line=>state.selected.has(line.id)&&line.scenario===state.scenario&&state.periods.includes(line.period)).map(line=>line.id)};let previousEvidence;
 if(state.evidence.integrity?.previousFingerprint){const rows=await state.central.fetchJson(`/atlas_reforecast_uploads?upload_id=eq.${encodeURIComponent(state.priorVersionId||'')}&select=payload&limit=1`),prior=rows?.[0]?.payload;if(!prior)throw Error('The exact earlier comparison evidence must be reloaded before scope review.');previousEvidence=prior.integrity?.auditId?await readWorkbookAudit(state.central,prior.integrity,{sourceHash:prior.source.sha256}):prior.integrity;}
 const scoped=await prepareScopedReforecastEvidence(state.evidence,mapping,{previousEvidence});guard(state);
 state.evidence=scoped.evidence;state.scopeSelectionKey=scoped.selectionKey;state.scopedFingerprint=scoped.evidence.integrity.fingerprint;state.scopedUploadRequestId=uid();state.inputReviews=[];state.integrityReviews=[];state.confirmed=false;
 await saveForecastRecovery(state.central,state.evidenceId,{kind:'workbook-evidence',evidence:state.evidence});await retainReview(state);renderMapping(state);showStatus(state,`Exact selected forecast authority reviewed: ${scoped.selectedLineIds.length} values and ${scoped.authoritativeCells.length} source relationships. Complete the input and supporting-finding reviews for this scope. All workbook evidence is retained.`);
}
async function saveScopedEvidence(state){
 if(state.purpose==='original_budget')return;
 const ref=await persistWorkbookAudit(state.central,state.evidence.integrity,{communityId:state.assignment.communityId,sourceHash:state.evidence.source.sha256,sourceBytes:state.evidence.source.originalFile,onDiagnostic:item=>showStatus(state,`Saving reviewed source scope: ${item.operation} · ${Math.ceil((item.requestBytes||0)/1024)} KB · ${(item.durationMs/1000).toFixed(1)} seconds · ${item.classification}.`)});guard(state);
 state.scopedUploadRequestId||=uid();await retainReview(state);
 state.upload=await saveUpload(state.central,{communityId:state.assignment.communityId,requestId:state.scopedUploadRequestId,payload:{...state.evidence,integrity:ref,propertyAssignment:state.assignment,comparison:state.upload?.payload?.comparison||{priorUploadId:state.priorVersionId==='none'?null:state.priorVersionId,firstVersionConfirmed:state.priorVersionId==='none',confirmedBy:state.actor,confirmedAt:state.assignment.assignedAt}}});guard(state);await retainReview(state);
}
function groupTable(state){
 return `<div class="rfi-scroll"><table><thead><tr><th>Source GL and sheet</th><th>Reviewed target GL</th><th>Source sign treatment</th><th>Reversal</th></tr></thead><tbody>${state.groups.map((group,index)=>{const choice=state.accountChoices[group.key]||{};return `<tr data-group-index="${index}"><td>${esc(group.sourceAccountCode)} ${esc(group.name)}<div class="source-label">${esc(group.sheet)} · ${esc(group.department||'No source department')}</div></td><td><select data-target aria-label="Target GL ${esc(group.sourceAccountCode)} ${esc(group.sheet)}">${selectOptions((state.source?.registry?.accounts||[]).map(account=>({value:account.accountCode,label:`${account.accountCode} ${account.name||account.category||''} · ${account.nature} · ${account.placement}`})),choice.accountCode||'')}</select></td><td><select data-sign aria-label="Sign ${esc(group.sourceAccountCode)} ${esc(group.sheet)}">${selectOptions([{value:'1',label:'Keep source sign'},{value:'-1',label:'Reverse source sign'}],String(choice.signMultiplier||''))}</select></td><td><label><input data-reversal type="checkbox" ${choice.allowReversal?'checked':''}> Explicitly allow reversal amounts</label><label><input data-no-original type="checkbox" ${choice.noOriginalBudgetRow?'checked':''}> I reviewed this GL’s absent original-budget rows; retain the baseline as unavailable.</label></td></tr>`;}).join('')||'<tr><td colspan="4">Choose a source scenario and reporting periods to review account mappings.</td></tr>'}</tbody></table></div>`;
}
function sourceTable(state){
 const counts=new Map();for(const line of state.visibleLines){const key=JSON.stringify([line.period,line.accountCode,line.department]);counts.set(key,(counts.get(key)||0)+1);}
 return `<details><summary>Choose source rows, including duplicates (${state.visibleLines.length})</summary><p>All candidate rows remain in the immutable evidence. Uncheck a row to exclude it from this mapping; the adjustment reason records why. Missing amounts are not changed to zero.</p><div class="rfi-scroll"><table><thead><tr><th>Use</th><th>Source</th><th>GL / month</th><th>Amount</th><th>Finding</th></tr></thead><tbody>${state.visibleLines.map((line,index)=>`<tr><td><input type="checkbox" data-line-index="${index}" aria-label="Use ${esc(line.id)}" ${state.selected.has(line.id)?'checked':''} ${line.sourceKind==='workbook_actual_evidence'||(state.source?.actuals?.cutoffPeriod&&line.period<=state.source.actuals.cutoffPeriod)?'disabled':''}></td><td>${esc(line.id)}</td><td>${esc(line.accountCode)} / ${esc(line.period)}</td><td>${line.amount===null?'Missing':esc(line.amount)}</td><td>${line.sourceKind==='workbook_actual_evidence'?'Workbook actual evidence only':line.period<=state.source?.actuals?.cutoffPeriod?'Closed month; governed actuals apply':counts.get(JSON.stringify([line.period,line.accountCode,line.department]))>1?'Duplicate candidate; select intended source row':line.amount===null?'Missing numeric source value':line.formula?'Cached formula evidence':'Source input'}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function renderMapping(state){
 state.groups=reforecastImportGroups(state.evidence,state.scenario,state.periods);
 state.visibleLines=state.groups.flatMap(group=>group.lines);
 const scenarios=[...new Set((state.evidence.lines||[]).map(line=>line.scenario).filter(Boolean))];
 const body=state.el.querySelector('[data-body]');
 body.innerHTML=`<p><strong>Mapping Required</strong> · Immutable import ${esc(state.upload?.upload_id)}</p>${reportFindings(state.evidence)}<p>Assigned community: ${esc(state.communities.find(c=>communityId(c)===state.assignment.communityId)?.display_name||state.assignment.communityId)}. ${state.purpose==='original_budget'?'Original budget intake retains budget amounts for every selected source month. It cannot change closed actuals.':`Canonical actual cutoff: <strong>${esc(state.source?.actuals?.cutoffPeriod||'Unavailable')}</strong>. Closed months use governed actuals.`}</p>${!state.source?.registry?.version?'<p class="error">A reviewed GL registry is required. You can keep this evidence, configure the GL registry in the reforecast workspace, and resume this import.</p>':`<p>Reviewed registry version: ${esc(state.source.registry.version)}</p>`}
 ${state.purpose==='original_budget'?'':`<p class="error"><strong>UNSAVED</strong> — workbook evidence is saved; reviewed values become shared only after the working forecast is saved and read back.</p><div class="rfi-grid"><label>Destination scenario<select data-destination><option value="new" ${state.destination==='new'?'selected':''}>Create new Conventional working forecast</option>${state.currentDraft?`<option value="current" ${state.destination==='current'?'selected':''}>Update ${esc(state.currentDraft.name)}</option>`:''}</select></label><label>Working forecast name<input data-forecast-name value="${esc(state.forecastName)}"></label></div>`}<div class="rfi-grid"><label>Exact workbook source scenario<select data-scenario>${selectOptions(scenarios.map(value=>({value,label:value+(/^Actual\b/i.test(value)?' — evidence only':'')})),state.scenario)}</select></label><label>Reporting currency<select data-currency>${selectOptions(['USD','CAD','EUR','GBP','AUD','NZD','JPY'].map(value=>({value,label:value})),state.currency)}</select></label></div>
 ${(state.evidence.metadata?.currencies||[]).length===1&&!/^[A-Z]{3}$/.test(state.evidence.metadata.currencies[0])?`<label><input type="checkbox" data-currency-identity ${state.currencyAliasConfirmed?'checked':''}> I verified workbook currency “${esc(state.evidence.metadata.currencies[0])}” means the selected reporting currency without exchange conversion.</label>`:''}
 <details><summary>Reporting months</summary><div class="months">${periodList(state).map(period=>`<label><input type="checkbox" data-period="${esc(period)}" ${state.periods.includes(period)?'checked':''}>${esc(period)}</label>`).join('')}</div><button data-reload-months>Load selected reporting months</button></details>
 <button data-exact>Use exact GL code matches</button><button data-reload-registry>Reload reviewed registry</button>${state.onReviewRegistry?'<button data-review-registry>Review / create canonical GL registry</button>':''}<p class="muted">Exact code matches are suggestions until you confirm the mappings. Target classifications come from the selected registry. Change classifications or add an account in the registry workflow before using them here.</p>
 <div class="rfi-grid"><label>Calendar basis<select data-calendar>${selectOptions([{value:'calendar',label:'Calendar year'},{value:'fiscal',label:'Fiscal year'}],state.calendar?.basis||'')}</select></label><label>Fiscal start month<select data-start-month>${selectOptions(Array.from({length:12},(_,i)=>({value:String(i+1),label:String(i+1)})),String(state.calendar?.startMonth||''))}</select></label></div><label><input type="checkbox" data-calendar-confirm ${state.calendar?.confirmed?'checked':''}> I confirm this calendar basis, first fiscal month, selected reporting months and scenario.</label>
 ${groupTable(state)}${sourceTable(state)}${state.purpose==='original_budget'?'':'<button data-scope>Review selected forecast scope</button><p>Scope review follows the selected value cells, period headers, account identifiers and their dependencies while retaining every other workbook cell as evidence.</p>'}<p>Every source cell retains its classification. Constants remain unsupported planning inputs until explicitly reviewed. Formula integrity blockers cannot be waived.</p><label>Input review reason<input data-input-reason value="${esc(state.inputReason||'')}"></label><p>Review owner: ${esc(state.actor)}. Each selected cell retains its own effective source month and before/after value.</p><button data-review-inputs>Review selected planning inputs</button><p>${state.inputReviews?.length||0} individually recorded input reviews.</p><details><summary>Review non-critical integrity findings</summary><button data-review-supporting>Record review of all displayed supporting findings</button>${(state.evidence.integrity?.findings||[]).filter(f=>f.severity==='review').map(f=>`<p>${esc(f.sheet||'')} ${esc(f.address||'')}: ${esc(f.reason||f.code)} <button data-integrity-review="${esc(f.id)}">Record explicit review</button></p>`).join('')||'<p>No non-critical findings.</p>'}</details><label>Mapping and exclusion reason<textarea data-mapping-reason>${esc(state.reason)}</textarea></label><label><input type="checkbox" data-confirm-mapping ${state.confirmed?'checked':''}> I reviewed the source scenario, months, selected rows, target GLs, statement placement and signs.</label><p data-review-status></p><details><summary>Mapping decisions, blockers and reconciliation</summary><pre data-mapping-findings></pre></details><details><summary>Included values and retained exclusions</summary><div class="rfi-scroll" data-reconciliation-rows></div></details><button data-check>Check mapping</button><button data-apply>${state.purpose==='original_budget'?'Continue to original budget approval':'Create / Save Working Draft and verify values'}</button><button data-evidence-only>Keep evidence; resolve mapping later</button>`;
 body.querySelector('[data-scope]')?.addEventListener('click',async()=>{if(state.busy)return;try{state.busy=true;showStatus(state,'Reviewing exact selected cell dependencies against the complete original workbook…');await reviewAuthorityScope(state);}catch(error){showStatus(state,error.message,true);}finally{state.busy=false;}});
 body.querySelector('[data-review-supporting]').onclick=()=>{try{readReviewFields(state);const reason=body.querySelector('[data-input-reason]').value.trim();if(reason.length<3)throw Error('Enter the reason for reviewing the displayed supporting findings.');state.integrityReviews=(state.evidence.integrity?.findings||[]).filter(f=>f.severity==='review').map(f=>({findingId:f.id,confirmed:true,reason,ownerId:state.actor,effectivePeriod:state.periods[0],reviewedAt:new Date().toISOString(),integrityFingerprint:state.evidence.integrity.fingerprint,before:f.evidence||null,after:f.evidence||null}));retainReview(state);showStatus(state,`${state.integrityReviews.length} individually recorded supporting-finding reviews. Blocking formula findings remain unresolved.`);}catch(error){showStatus(state,error.message,true);}};
 body.querySelector('[data-review-inputs]').onclick=()=>{try{readReviewFields(state);state.inputReason=body.querySelector('[data-input-reason]').value;state.inputReviews=reviewPlanningInputs(state.evidence,[...state.selected],{reason:state.inputReason,ownerId:state.actor});state.confirmed=false;renderMapping(state);}catch(error){showStatus(state,error.message,true);}};
 body.querySelectorAll('[data-integrity-review]').forEach(button=>button.onclick=()=>{try{readReviewFields(state);const reason=body.querySelector('[data-input-reason]').value.trim();if(reason.length<3)throw Error('Enter the reason for accepting this non-critical finding.');const finding=state.evidence.integrity.findings.find(f=>f.id===button.dataset.integrityReview);state.integrityReviews=(state.integrityReviews||[]).filter(r=>r.findingId!==finding.id).concat({findingId:finding.id,confirmed:true,reason,ownerId:state.actor,effectivePeriod:state.periods[0],reviewedAt:new Date().toISOString(),integrityFingerprint:state.evidence.integrity.fingerprint,before:finding.evidence||null,after:finding.evidence||null});showStatus(state,'Finding review recorded. Check mapping before applying.');}catch(error){showStatus(state,error.message,true);}});
 body.querySelector('[data-currency]').onchange=()=>{state.currencyAliasConfirmed=false;const checkbox=body.querySelector('[data-currency-identity]');if(checkbox)checkbox.checked=false;};
 body.querySelector('[data-scenario]').onchange=()=>{readReviewFields(state);state.confirmed=false;if(state.calendar)state.calendar.confirmed=false;renderMapping(state);};
 for(const selector of ['[data-calendar]','[data-start-month]'])body.querySelector(selector).onchange=()=>{body.querySelector('[data-calendar-confirm]').checked=false;};
 body.querySelector('[data-exact]').onclick=()=>{readReviewFields(state);for(const group of state.groups){const matches=(state.source?.registry?.accounts||[]).filter(account=>account.accountCode===group.sourceAccountCode);if(matches.length===1)state.accountChoices[group.key]={accountCode:matches[0].accountCode,signMultiplier:'1',allowReversal:false};}state.confirmed=false;renderMapping(state);};
 body.querySelector('[data-review-registry]')?.addEventListener('click',async()=>{try{readReviewFields(state);await retainReview(state);if(!state.scenario)throw Error('Choose the exact workbook source scenario before reviewing the registry proposal.');await state.onReviewRegistry({communityId:state.assignment.communityId,source:state.source,evidence:{...state.evidence,lines:state.evidence.lines.filter(line=>state.selected.has(line.id)&&line.scenario===state.scenario&&state.periods.includes(line.period)&&Number.isFinite(line.amount))}});showStatus(state,'Complete the explicit GL registry review, then Reload reviewed registry to continue.');}catch(error){showStatus(state,error.message,true);}});
 body.querySelector('[data-reload-registry]').onclick=async()=>{readReviewFields(state);try{await loadSource(state);state.confirmed=false;renderMapping(state);showStatus(state,'Reviewed registry and governed actual cutoff reloaded.');}catch(error){showStatus(state,error.message,true);}};
 body.querySelector('[data-reload-months]').onclick=async()=>{readReviewFields(state);const periods=[...body.querySelectorAll('[data-period]:checked')].map(input=>input.dataset.period);if(!periods.length||periods.length>24){showStatus(state,'Choose between 1 and 24 reporting months.',true);return;}state.periods=periods;if(state.calendar)state.calendar.confirmed=false;try{await loadSource(state);state.confirmed=false;renderMapping(state);}catch(error){showStatus(state,error.message,true);}};
 body.querySelector('[data-check]').onclick=()=>{readReviewFields(state);showReview(state,previewReview(state));retainReview(state);};
 body.querySelector('[data-apply]').onclick=async()=>{readReviewFields(state);try{guard(state);const result=previewReview(state);showReview(state,result);if(!result.ready){body.querySelector('[data-mapping-findings]').textContent=JSON.stringify(result.issues,null,2);throw Error(result.issues.filter(issue=>issue.severity==='error').slice(0,5).map(issue=>issue.message).join('\n'));}await finish(state,result);}catch(error){showStatus(state,error.message+' Your mapping edits are retained.',true);}};
 body.querySelector('[data-evidence-only]').onclick=async()=>{readReviewFields(state);try{guard(state);const result=previewReview(state);await finish(state,{...result,ready:false,lines:[],issues:[...result.issues,{code:'mapping_deferred',severity:'error',message:'Workbook evidence retained; no source amounts have been applied.'}]});}catch(error){showStatus(state,error.message,true);}};
}
async function finish(state,result){
 if(state.busy)return;state.busy=true;
 for(const button of state.el.querySelectorAll('button'))button.disabled=true;
 try{guard(state);await retainReview(state);showStatus(state,result.ready?'UNSAVED — saving the reviewed GL/month values and verifying the server receipt…':'Workbook evidence retained. Mapping can be resumed.');if(result.ready)await saveScopedEvidence(state);await state.onSaved?.({communityId:state.assignment.communityId,upload:state.upload,lines:result.ready?result.lines:[],mapping:result.mapping,issues:result.issues,ready:result.ready,source:state.source,destination:state.destination,forecastName:state.forecastName,recoveryId:state.reviewId});guard(state);if(result.ready)await removeForecastRecovery(state.central,state.reviewId);state.el.close();}
 finally{state.busy=false;for(const button of state.el.querySelectorAll('button'))button.disabled=false;}
}
function createState(options,evidence,upload=null){
 const actor=actorId(options.actor)||currentActor(options.central),assignment=upload?.payload?.propertyAssignment||null;
 const state={...options,actor,evidence,originalIntegrity:evidence.integrity,upload,assignment,periods:reforecastImportPeriods(evidence,options.defaultPeriods),scenario:'',currency:'',accountChoices:{},selected:new Set((evidence.lines||[]).filter(line=>Number.isFinite(line.amount)&&line.sourceKind!=='workbook_actual_evidence').map(line=>line.id)),reason:'',confirmed:false,calendar:null,inputReviews:[],integrityReviews:[],busy:false,requestId:uid(),source:null,destination:'new',forecastName:(evidence.source.fileName||'Workbook').replace(/\.xlsx$/i,'')+' Conventional Reforecast'};
 if(upload&&!state.communities.some(community=>communityId(community)===upload.community_id))throw Error('This saved import is not in your authorized community list.');
 guard(state);state.el=shell(upload?'Resume workbook mapping':state.purpose==='original_budget'?'Import original budget workbook':'Import reforecast workbook');return state;
}
export async function importReforecastWorkbook(options){
 if(!options.file?.arrayBuffer)throw Error('Choose an XLSX workbook.');
 const loading=shell(options.purpose==='original_budget'?'Read original budget workbook':'Read reforecast workbook');loading.querySelector('[data-status]').textContent='Reading workbook evidence; formulas will not execute…';
 try{const evidence=await parseReforecastWorkbook(await options.file.arrayBuffer(),{fileName:options.file.name,includeOriginalBytes:true});if(!loading.open)return null;loading.close();const state=createState(options,evidence);await prepareRecovery(state);renderProperty(state);return state.el;}
 catch(error){const status=loading.querySelector('[data-status]');if(status)status.textContent=error.message;throw error;}
}
export async function resumeReforecastImport({upload,uploadId,...options}) {
 if(!upload){if(!UUID.test(uploadId||''))throw Error('Select a saved workbook import.');const rows=await options.central.fetchJson(`/atlas_reforecast_uploads?upload_id=eq.${uploadId}&select=*&limit=1`);upload=rows?.[0];}
 if(!upload?.payload?.source||!upload?.payload?.propertyAssignment)throw Error('The saved workbook evidence or property assignment is unavailable.');
 let evidence={...upload.payload};const auditReference=evidence.integrity;let sourceBytes;
 if(needsReforecastParserRecovery(evidence)&&!evidence.source.originalFile&&auditReference?.manifestHash){const retained=await readWorkbookAuditBytes(options.central,auditReference,{sourceHash:evidence.source.sha256});evidence.integrity=retained.evidence;sourceBytes=retained.sourceBytes;}else if(evidence.integrity?.auditId)evidence.integrity=await readWorkbookAudit(options.central,evidence.integrity,{sourceHash:evidence.source.sha256});
 const upgraded=await upgradeReforecastParserEvidence(evidence,{sourceBytes,previousUploadId:upload.upload_id,previousAuditId:auditReference?.auditId});evidence=upgraded.evidence;
 if(upgraded.changed){const state=createState(options,evidence);state.assignment={...upload.payload.propertyAssignment,confirmed:false,explicit:false,actorId:state.actor};state.priorImports=[upload];await prepareRecovery(state);renderProperty(state);showStatus(state,`Workbook parser updated from ${upgraded.upgrade.fromParserVersion} to ${currentReforecastParserVersion}. ${upgraded.upgrade.addedLineIds.length} newly recognized source cells require a new immutable evidence version and complete mapping review. The previous upload and receipt remain unchanged.`);return state.el;}
 const state=createState(options,evidence,upload);
 await prepareRecovery(state);
 state.assignment={...upload.payload.propertyAssignment,explicit:true,actorId:upload.payload.propertyAssignment.actorId||upload.created_by,sourceEntities:upload.payload.propertyAssignment.sourceEntities||upload.payload.propertyAssignment.entities||[]};
 try{await loadSource(state);renderMapping(state);showStatus(state,'Saved workbook evidence loaded. Review and apply its mapping to the working draft.');}
 catch(error){renderMapping(state);showStatus(state,error.message,true);}
 return state.el;
}
export async function resumeLocalReforecastImport({recoveryId,...options}){
 const recovery=await readForecastRecovery(options.central,recoveryId);if(recovery?.kind!=='import-review')throw Error('This unfinished import could not be recovered.');
 if(recovery.uploadId)return resumeReforecastImport({...options,uploadId:recovery.uploadId});
 const saved=await readForecastRecovery(options.central,recovery.evidenceId);if(!saved?.evidence)throw Error('Retained workbook bytes are unavailable. Choose the original workbook again.');
 const upgraded=await upgradeReforecastParserEvidence(saved.evidence),state=createState(options,upgraded.evidence);if(upgraded.changed&&recovery.fields?.assignment)state.assignment={...recovery.fields.assignment,confirmed:false,explicit:false,actorId:state.actor};await prepareRecovery(state);renderProperty(state);showStatus(state,upgraded.changed?`UNSAVED — parser ${currentReforecastParserVersion} reread the exact retained workbook and recognized ${upgraded.upgrade.addedLineIds.length} additional source cells. Prior selections and approvals remain retained separately. Review the new evidence and mapping before applying.`:'UNSAVED — workbook and mapping recovered from this browser. Save immutable evidence, then create and verify the working forecast.');return state.el;
}

export function mergeReforecastImportIntoDraft(draft,result,{actor,timestamp=new Date().toISOString()}={}) {
 if(!result?.upload?.upload_id||result.upload.community_id!==result.communityId)throw Error('The saved import community does not match the working draft.');
 if(!result.ready&&(result.lines||[]).length)throw Error('Unreviewed workbook rows cannot be applied to a working draft.');
 if(result.ready&&(!result.mapping?.confirmed||!result.mapping?.version))throw Error('A confirmed, versioned mapping is required before applying workbook amounts.');
 const next=JSON.parse(JSON.stringify(draft)),before=next.overrides||[],incoming=(result.ready?result.lines:[]).map(line=>({period:line.period,accountCode:line.accountCode,amount:line.amount,sourceLineId:line.sourceLineId,uploadId:result.upload.upload_id,reason:result.mapping.reason,confirmed:true,ownerId:actor,effectivePeriod:line.period,reviewedAt:timestamp,before:(before.find(r=>r.period===line.period&&r.accountCode===line.accountCode)?.amount??null),after:line.amount,sourceCoordinates:line.sourceCoordinates}));
 const keys=new Set();for(const line of incoming){const key=JSON.stringify([line.period,line.accountCode]);if(keys.has(key))throw Error('The working forecast needs one reviewed amount per GL and month. Resolve department or source-row aggregation first.');keys.add(key);}
 next.importHistory||=[];
 if(draft.uploadId&&draft.importMapping&&!next.importHistory.some(entry=>entry.uploadId===draft.uploadId))next.importHistory.push({uploadId:draft.uploadId,mapping:JSON.parse(JSON.stringify(draft.importMapping)),issues:JSON.parse(JSON.stringify(draft.importIssues||[])),reviewedAt:draft.importMapping.reviewedAt||timestamp});
 next.importHistory=next.importHistory.filter(entry=>entry.uploadId!==result.upload.upload_id).concat({uploadId:result.upload.upload_id,mapping:result.mapping||null,issues:result.issues||[],reviewedAt:result.mapping?.reviewedAt||timestamp});
 next.governanceSchemaVersion=2;next.calendar=result.mapping?.calendar?{...result.mapping.calendar,scenario:next.name,confirmed:false}:next.calendar;next.uploadId=result.upload.upload_id;next.importMapping=result.mapping||null;next.importIssues=result.issues||[];
 next.overrides=before.filter(line=>!keys.has(JSON.stringify([line.period,line.accountCode]))).map(line=>line.sourceLineId&&!line.uploadId?{...line,uploadId:draft.uploadId}:line).concat(incoming);
 next.importState=result.ready?'reviewed':'mapping_required';next.registryVersionId=result.mapping?.version||next.registryVersionId||null;
 next.periods=[...new Set([...(next.periods||[]),...(result.mapping?.periods||[]),...incoming.map(line=>line.period)])].sort();
 if(next.periods.length>24)throw Error('The combined working draft exceeds 24 reporting months. Choose a separate draft for the additional periods.');
 next.history||=[];next.history.push({action:result.ready?'workbook_mapping_applied':'workbook_evidence_linked',actor,timestamp,uploadId:result.upload.upload_id,sourceHash:result.upload.source_hash||result.upload.payload?.source?.sha256,mappingVersion:result.mapping?.version||null,before:JSON.parse(JSON.stringify(before)),after:JSON.parse(JSON.stringify(next.overrides))});
 return next;
}

export async function readReforecastImportPage(central,{communityId:cid,offset=0,limit=25}) {
 if(!UUID.test(cid||'')||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw Error('Choose an authorized community and a valid import page.');
 const actor=currentActor(central),rows=await central.fetchJson(`/atlas_reforecast_uploads?community_id=eq.${cid}&select=upload_id,community_id,source_hash,created_by,created_at,file_name:payload->source->>fileName&order=created_at.desc,upload_id.desc&limit=${limit}&offset=${offset}`);
 if(currentActor(central)!==actor)throw Error('Your signed-in account changed while reading imports.');
 if(!Array.isArray(rows)||rows.some(row=>row.community_id!==cid))throw Error('Saved import scope could not be verified.');
 return {rows,offset,limit,hasMore:rows.length===limit};
}
