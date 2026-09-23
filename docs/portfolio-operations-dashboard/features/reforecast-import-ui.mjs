import {parseReforecastWorkbook,mapReforecastIntake,validateReforecastPropertyAssignment} from './reforecast-intake.mjs?v=24b8279a354390ef';
import {saveUpload,readSourceBundle} from './reforecast-store.mjs?v=4a7a84c04ff55a0f';

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
export function reforecastMappingFromReview({evidence,source,assignment,scenario,currency,periods,accountChoices={},selectedLineIds=[],reason,confirmed=false,reviewerId}) {
 const registry=source?.registry||{},groups=reforecastImportGroups(evidence,scenario,periods),accountMappings=[],reviewIssues=[];
 if(!confirmed)reviewIssues.push({code:'mapping_confirmation_required',severity:'error',message:'Confirm the source selection, GL mappings and signed amounts before applying values.'});
 if(!String(reason||'').trim())reviewIssues.push({code:'mapping_reason_required',severity:'error',message:'Enter the reason for using these workbook values.'});
 for(const group of groups){
  if(!group.lines.some(line=>selectedLineIds.includes(line.id)))continue;
  const choice=accountChoices[group.key]||{},matches=(registry.accounts||[]).filter(account=>account.accountCode===choice.accountCode);
  if(matches.length!==1){reviewIssues.push({code:'registry_account_required',severity:'error',message:`Choose one reviewed target GL for ${group.sourceAccountCode} on ${group.sheet}.`});continue;}
  const account=matches[0];
  for(const line of group.lines.filter(line=>selectedLineIds.includes(line.id)))if((account.effectiveFrom&&line.period<account.effectiveFrom)||(account.retiredAfter&&line.period>account.retiredAfter))reviewIssues.push({code:'account_not_effective',severity:'error',message:`Target ${account.accountCode} is not effective for ${line.period}.`,sourceLineId:line.id});
  accountMappings.push({sourceAccountCode:group.sourceAccountCode,sheet:group.sheet,department:group.department,accountCode:account.accountCode,category:account.category,nature:account.nature,placement:account.placement,signMultiplier:Number(choice.signMultiplier),allowReversal:choice.allowReversal===true});
 }
 const mapping={version:registry.version,propertyAssignment:assignment,sourceScenario:scenario,currency,periods,selectedLineIds,accountMappings,reason:String(reason||'').trim(),confirmed,reviewedAt:new Date().toISOString(),reviewedBy:reviewerId||assignment.actorId};
 return {mapping,reviewIssues};
}
export function evaluateReforecastImportReview(input,authorizedCommunityIds) {
 const {mapping,reviewIssues}=reforecastMappingFromReview(input);
 const noClosedPeriodsConfirmed=input.source?.communityId===input.assignment.communityId&&/^[a-f0-9]{64}$/.test(input.source?.sourceVersion||'')&&input.source?.actuals?.cutoffPeriod===null&&Array.isArray(input.source?.actuals?.closeVersions)&&input.source.actuals.closeVersions.length===0;
 const result=mapReforecastIntake(input.evidence,mapping,{authorizedCommunityIds,cutoffPeriod:input.source?.actuals?.cutoffPeriod,noClosedPeriodsConfirmed});
 return {...result,issues:[...reviewIssues,...result.issues],ready:result.ready&&!reviewIssues.some(issue=>issue.severity==='error')};
}
function currentActor(central){return central.getSession?.()?.user?.id;}
function guard(state){if(!state.actor||currentActor(state.central)!==state.actor)throw Error('Your signed-in account changed. Reopen the import after signing in.');}
function selectOptions(items,value,placeholder='Choose explicitly'){return `<option value="">${esc(placeholder)}</option>`+items.map(item=>`<option value="${esc(item.value)}" ${item.value===value?'selected':''}>${esc(item.label)}</option>`).join('');}
function reportFindings(evidence){
 const counts=(evidence.issues||[]).reduce((all,item)=>(all[item.code]=(all[item.code]||0)+1,all),{});
 return `<details><summary>${evidence.issues?.length||0} workbook findings and retained source evidence</summary><p>File ${esc(evidence.source?.fileName)} · SHA-256 ${esc(evidence.sourceHash||evidence.source?.sha256)}</p><p>${evidence.sheets?.length||0} sheets · ${evidence.summary?.formulas||0} formulas retained without execution. Source Actual columns are evidence only.</p><pre>${esc(JSON.stringify({entities:evidence.metadata?.entities,currencies:evidence.metadata?.currencies,workbookLastClosedMonth:evidence.metadata?.lastClosedMonth,findings:counts},null,2))}</pre><details><summary>Finding details</summary><pre>${esc(JSON.stringify(evidence.issues||[],null,2))}</pre></details></details>`;
}
function shell(title){
 const el=document.createElement('dialog');el.className='rfi';el.setAttribute('aria-label',title);
 el.innerHTML=`<style>${style}</style><h2>${esc(title)}</h2><p data-status role="status" aria-live="polite"></p><div data-body></div><button data-close>Close</button>`;
 document.body.appendChild(el);el.querySelector('[data-close]').onclick=()=>el.close();
 el.addEventListener('close',()=>el.remove());el.showModal();return el;
}
function showStatus(state,message,error=false){const el=state.el.querySelector('[data-status]');el.className=error?'error':message?'success':'';el.textContent=message;}
function periodList(state){return [...new Set([...state.periods,...(state.evidence.lines||[]).filter(line=>line.scenario===state.scenario).map(line=>line.period)])].filter(period=>PERIOD.test(period)).sort();}
function renderProperty(state){
 const body=state.el.querySelector('[data-body]');
 body.innerHTML=`${reportFindings(state.evidence)}<p><strong>Property Required</strong></p><label>Assign an authorized ATLAS community<select data-property>${selectOptions(state.communities.map(c=>({value:communityId(c),label:c.display_name||c.name||communityId(c)})),state.assignment?.communityId||'','Choose property; filenames are not authority')}</select></label><p>Workbook entity evidence: ${esc((state.evidence.metadata?.entities||[]).join(', ')||'Not specified')}</p><label>Assignment reason<textarea data-assignment-reason>${esc(state.assignment?.reason||'')}</textarea></label><label><input type="checkbox" data-confirm-property ${state.assignment?.confirmed?'checked':''}> I verified the source entities above belong to this canonical community.</label><p>The original workbook bytes, formulas, cached values and findings will be saved as a new immutable import version. Saving evidence does not approve it or update the original budget.</p><button data-save-evidence ${state.busy?'disabled':''}>Save immutable import version</button>`;
 body.querySelector('[data-save-evidence]').onclick=async()=>{
  if(state.busy)return;
  try{
   guard(state);const selected=body.querySelector('[data-property]').value,reason=body.querySelector('[data-assignment-reason]').value.trim(),confirmed=body.querySelector('[data-confirm-property]').checked;
   const previous=state.assignment;
   if(!previous||previous.communityId!==selected||previous.reason!==reason||previous.confirmed!==confirmed){state.assignment={communityId:selected,confirmed,explicit:confirmed,reason,actorId:state.actor,assignedAt:new Date().toISOString(),sourceEntities:state.evidence.metadata?.entities||[],entities:state.evidence.metadata?.entities||[]};state.requestId=uid();}
   const validation=validateReforecastPropertyAssignment(state.assignment,state.communities.map(communityId));if(!validation.valid)throw Error(validation.issues.map(item=>item.message).join('\n'));
   state.busy=true;body.querySelector('[data-save-evidence]').disabled=true;showStatus(state,'Saving and verifying the immutable workbook…');
   state.upload=await saveUpload(state.central,{communityId:selected,requestId:state.requestId,payload:{...state.evidence,propertyAssignment:state.assignment}});guard(state);
   showStatus(state,'Workbook import saved and read back. Review the mapped values before applying them.');
   await loadSource(state);renderMapping(state);
  }catch(error){showStatus(state,error.message+' Your selected workbook and edits are retained.',true);if(state.upload)renderMapping(state);}
  finally{state.busy=false;const button=state.el.querySelector('[data-save-evidence]');if(button)button.disabled=false;}
 };
}
async function loadSource(state){
 guard(state);
 if(!state.periods.length)throw Error('The workbook has no unambiguous reporting months. Evidence is saved; choose reporting months in the reforecast workspace before resuming mapping.');
 if(state.periods.length>24)throw Error('Select at most 24 reporting months.');
 state.source=await readSourceBundle(state.central,{communityId:state.assignment.communityId,periods:state.periods});guard(state);
}
function readReviewFields(state){
 const root=state.el;
 state.scenario=root.querySelector('[data-scenario]')?.value??state.scenario;
 state.currency=root.querySelector('[data-currency]')?.value??state.currency;
 state.reason=root.querySelector('[data-mapping-reason]')?.value??state.reason;
 state.confirmed=Boolean(root.querySelector('[data-confirm-mapping]')?.checked);
 for(const row of root.querySelectorAll('[data-group-index]')){
  const group=state.groups[Number(row.dataset.groupIndex)];
  state.accountChoices[group.key]={accountCode:row.querySelector('[data-target]').value,signMultiplier:row.querySelector('[data-sign]').value,allowReversal:Boolean(row.querySelector('[data-reversal]').checked)};
 }
 for(const input of root.querySelectorAll('[data-line-index]')){const line=state.visibleLines[Number(input.dataset.lineIndex)];if(input.checked)state.selected.add(line.id);else state.selected.delete(line.id);}
}
function previewReview(state){
 return evaluateReforecastImportReview({evidence:state.evidence,source:state.source,assignment:state.assignment,scenario:state.scenario,currency:state.currency,periods:state.periods,accountChoices:state.accountChoices,selectedLineIds:[...state.selected],reason:state.reason,confirmed:state.confirmed,reviewerId:state.actor},state.communities.map(communityId));
}
function groupTable(state){
 return `<div class="rfi-scroll"><table><thead><tr><th>Source GL and sheet</th><th>Reviewed target GL</th><th>Source sign treatment</th><th>Reversal</th></tr></thead><tbody>${state.groups.map((group,index)=>{const choice=state.accountChoices[group.key]||{};return `<tr data-group-index="${index}"><td>${esc(group.sourceAccountCode)} ${esc(group.name)}<div class="source-label">${esc(group.sheet)} · ${esc(group.department||'No source department')}</div></td><td><select data-target aria-label="Target GL ${esc(group.sourceAccountCode)} ${esc(group.sheet)}">${selectOptions((state.source?.registry?.accounts||[]).map(account=>({value:account.accountCode,label:`${account.accountCode} ${account.name||account.category||''} · ${account.nature} · ${account.placement}`})),choice.accountCode||'')}</select></td><td><select data-sign aria-label="Sign ${esc(group.sourceAccountCode)} ${esc(group.sheet)}">${selectOptions([{value:'1',label:'Keep source sign'},{value:'-1',label:'Reverse source sign'}],String(choice.signMultiplier||''))}</select></td><td><label><input data-reversal type="checkbox" ${choice.allowReversal?'checked':''}> Explicitly allow reversal amounts</label></td></tr>`;}).join('')||'<tr><td colspan="4">Choose a source scenario and reporting periods to review account mappings.</td></tr>'}</tbody></table></div>`;
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
 body.innerHTML=`<p><strong>Mapping Required</strong> · Immutable import ${esc(state.upload?.upload_id)}</p>${reportFindings(state.evidence)}<p>Assigned community: ${esc(state.communities.find(c=>communityId(c)===state.assignment.communityId)?.display_name||state.assignment.communityId)}. Canonical actual cutoff: <strong>${esc(state.source?.actuals?.cutoffPeriod||'Unavailable')}</strong>. Closed months use governed actuals.</p>${!state.source?.registry?.version?'<p class="error">A reviewed GL registry is required. You can keep this evidence, configure the GL registry in the reforecast workspace, and resume this import.</p>':`<p>Reviewed registry version: ${esc(state.source.registry.version)}</p>`}
 <div class="rfi-grid"><label>Exact source scenario<select data-scenario>${selectOptions(scenarios.map(value=>({value,label:value+(/^Actual\b/i.test(value)?' — evidence only':'')})),state.scenario)}</select></label><label>Reporting currency<select data-currency>${selectOptions(['USD','CAD','EUR','GBP','AUD','NZD','JPY'].map(value=>({value,label:value})),state.currency)}</select></label></div>
 <details><summary>Reporting months</summary><div class="months">${periodList(state).map(period=>`<label><input type="checkbox" data-period="${esc(period)}" ${state.periods.includes(period)?'checked':''}>${esc(period)}</label>`).join('')}</div><button data-reload-months>Load selected reporting months</button></details>
 <button data-exact>Use exact GL code matches</button><button data-reload-registry>Reload reviewed registry</button><p class="muted">Exact code matches are suggestions until you confirm the mappings. Target classifications come from the selected registry. Change classifications or add an account in the registry workflow before using them here.</p>
 ${groupTable(state)}${sourceTable(state)}<label>Mapping and exclusion reason<textarea data-mapping-reason>${esc(state.reason)}</textarea></label><label><input type="checkbox" data-confirm-mapping ${state.confirmed?'checked':''}> I reviewed the source scenario, months, selected rows, target GLs, statement placement and signs.</label><p data-review-status></p><details><summary>Mapping findings</summary><pre data-mapping-findings></pre></details><button data-check>Check mapping</button><button data-apply>Apply reviewed values to working draft</button><button data-evidence-only>Keep evidence; resolve mapping later</button>`;
 body.querySelector('[data-scenario]').onchange=()=>{readReviewFields(state);state.confirmed=false;renderMapping(state);};
 body.querySelector('[data-exact]').onclick=()=>{readReviewFields(state);for(const group of state.groups){const matches=(state.source?.registry?.accounts||[]).filter(account=>account.accountCode===group.sourceAccountCode);if(matches.length===1)state.accountChoices[group.key]={accountCode:matches[0].accountCode,signMultiplier:'1',allowReversal:false};}state.confirmed=false;renderMapping(state);};
 body.querySelector('[data-reload-registry]').onclick=async()=>{readReviewFields(state);try{await loadSource(state);state.confirmed=false;renderMapping(state);showStatus(state,'Reviewed registry and governed actual cutoff reloaded.');}catch(error){showStatus(state,error.message,true);}};
 body.querySelector('[data-reload-months]').onclick=async()=>{readReviewFields(state);const periods=[...body.querySelectorAll('[data-period]:checked')].map(input=>input.dataset.period);if(!periods.length||periods.length>24){showStatus(state,'Choose between 1 and 24 reporting months.',true);return;}state.periods=periods;try{await loadSource(state);state.confirmed=false;renderMapping(state);}catch(error){showStatus(state,error.message,true);}};
 body.querySelector('[data-check]').onclick=()=>{readReviewFields(state);const result=previewReview(state);body.querySelector('[data-review-status]').textContent=result.ready?`${result.lines.length} mapped open-month values are ready for the working draft.`:`${result.issues.filter(issue=>issue.severity==='error').length} blockers remain. Evidence is saved; values have not been applied.`;body.querySelector('[data-mapping-findings]').textContent=JSON.stringify(result.issues,null,2);};
 body.querySelector('[data-apply]').onclick=async()=>{readReviewFields(state);try{guard(state);const result=previewReview(state);if(!result.ready){body.querySelector('[data-mapping-findings]').textContent=JSON.stringify(result.issues,null,2);throw Error(result.issues.filter(issue=>issue.severity==='error').slice(0,5).map(issue=>issue.message).join('\n'));}await finish(state,result);}catch(error){showStatus(state,error.message+' Your mapping edits are retained.',true);}};
 body.querySelector('[data-evidence-only]').onclick=async()=>{readReviewFields(state);try{guard(state);const result=previewReview(state);await finish(state,{...result,ready:false,lines:[],issues:[...result.issues,{code:'mapping_deferred',severity:'error',message:'Workbook evidence retained; no source amounts have been applied.'}]});}catch(error){showStatus(state,error.message,true);}};
}
async function finish(state,result){
 if(state.busy)return;state.busy=true;
 for(const button of state.el.querySelectorAll('button'))button.disabled=true;
 try{guard(state);await state.onSaved?.({communityId:state.assignment.communityId,upload:state.upload,lines:result.ready?result.lines:[],mapping:result.mapping,issues:result.issues,ready:result.ready,source:state.source});guard(state);state.el.close();}
 finally{state.busy=false;for(const button of state.el.querySelectorAll('button'))button.disabled=false;}
}
function createState(options,evidence,upload=null){
 const actor=actorId(options.actor)||currentActor(options.central),assignment=upload?.payload?.propertyAssignment||null;
 const state={...options,actor,evidence,upload,assignment,periods:reforecastImportPeriods(evidence,options.defaultPeriods),scenario:'',currency:'',accountChoices:{},selected:new Set((evidence.lines||[]).map(line=>line.id)),reason:'',confirmed:false,busy:false,requestId:uid(),source:null};
 if(upload&&!state.communities.some(community=>communityId(community)===upload.community_id))throw Error('This saved import is not in your authorized community list.');
 guard(state);state.el=shell(upload?'Resume workbook mapping':'Import reforecast workbook');return state;
}
export async function importReforecastWorkbook(options){
 if(!options.file?.arrayBuffer)throw Error('Choose an XLSX workbook.');
 const loading=shell('Read reforecast workbook');loading.querySelector('[data-status]').textContent='Reading workbook evidence; formulas will not execute…';
 try{const evidence=await parseReforecastWorkbook(await options.file.arrayBuffer(),{fileName:options.file.name,includeOriginalBytes:true});if(!loading.open)return null;loading.close();const state=createState(options,evidence);renderProperty(state);return state.el;}
 catch(error){const status=loading.querySelector('[data-status]');if(status)status.textContent=error.message;throw error;}
}
export async function resumeReforecastImport({upload,uploadId,...options}) {
 if(!upload){if(!UUID.test(uploadId||''))throw Error('Select a saved workbook import.');const rows=await options.central.fetchJson(`/atlas_reforecast_uploads?upload_id=eq.${uploadId}&select=*&limit=1`);upload=rows?.[0];}
 if(!upload?.payload?.source||!upload?.payload?.propertyAssignment)throw Error('The saved workbook evidence or property assignment is unavailable.');
 const state=createState(options,upload.payload,upload);
 state.assignment={...upload.payload.propertyAssignment,explicit:true,actorId:upload.payload.propertyAssignment.actorId||upload.created_by,sourceEntities:upload.payload.propertyAssignment.sourceEntities||upload.payload.propertyAssignment.entities||[]};
 try{await loadSource(state);renderMapping(state);showStatus(state,'Saved workbook evidence loaded. Review and apply its mapping to the working draft.');}
 catch(error){renderMapping(state);showStatus(state,error.message,true);}
 return state.el;
}

export function mergeReforecastImportIntoDraft(draft,result,{actor,timestamp=new Date().toISOString()}={}) {
 if(!result?.upload?.upload_id||result.upload.community_id!==result.communityId)throw Error('The saved import community does not match the working draft.');
 if(!result.ready&&(result.lines||[]).length)throw Error('Unreviewed workbook rows cannot be applied to a working draft.');
 if(result.ready&&(!result.mapping?.confirmed||!result.mapping?.version))throw Error('A confirmed, versioned mapping is required before applying workbook amounts.');
 const next=JSON.parse(JSON.stringify(draft)),before=next.overrides||[],incoming=(result.ready?result.lines:[]).map(line=>({period:line.period,accountCode:line.accountCode,amount:line.amount,sourceLineId:line.sourceLineId,uploadId:result.upload.upload_id,reason:result.mapping.reason||'Explicitly mapped workbook input'}));
 const keys=new Set();for(const line of incoming){const key=JSON.stringify([line.period,line.accountCode]);if(keys.has(key))throw Error('The working forecast needs one reviewed amount per GL and month. Resolve department or source-row aggregation first.');keys.add(key);}
 next.importHistory||=[];
 if(draft.uploadId&&draft.importMapping&&!next.importHistory.some(entry=>entry.uploadId===draft.uploadId))next.importHistory.push({uploadId:draft.uploadId,mapping:JSON.parse(JSON.stringify(draft.importMapping)),issues:JSON.parse(JSON.stringify(draft.importIssues||[])),reviewedAt:draft.importMapping.reviewedAt||timestamp});
 next.importHistory=next.importHistory.filter(entry=>entry.uploadId!==result.upload.upload_id).concat({uploadId:result.upload.upload_id,mapping:result.mapping||null,issues:result.issues||[],reviewedAt:result.mapping?.reviewedAt||timestamp});
 next.uploadId=result.upload.upload_id;next.importMapping=result.mapping||null;next.importIssues=result.issues||[];
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
