import {compareWorkbookEvidence} from './workbook-integrity.mjs?v=612a2cdba3c9dba2';
import {persistWorkbookAudit,readWorkbookAudit} from './workbook-audit-store.mjs?v=9e9116b68ad81b7a';
import {monthlyGovernanceForm,readMonthlyGovernanceForm} from './financial-workbook-governance.mjs?v=ce3982266f91118e';
import {readFinance} from './canonical-finance.mjs?v=57c407b902ccd923';
import {applyControls,centralClient} from './financial-comparison.mjs?v=9395ecbdb212843b';
import {readPackage} from './financial-package-reader.mjs?v=311d5c4092dde6d1';
import {resolveCommunity,evaluateFinancialPackageSafety,finalizeFinancialPackageEvidence} from './financial-package.mjs?v=a378a0cb25083758';
import {createIntake,prepareReview,INTAKE_STATES,INTAKE_LABELS} from './financial-intake-store.mjs?v=e7ba2e324c419b26';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v===null||v===undefined?'Missing':Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
let active;
export function dispose(){active?.close();active=null;}
function download(certificate){const url=URL.createObjectURL(new Blob([JSON.stringify(certificate,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ATLAS-financial-review-'+(certificate.metadata?.period||'unknown')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function evidenceHtml(c){
 const e=c.intakeEvidence||{},inventory=e.rowInventory||[],leaves=e.leafChecks||[],controls=e.hierarchy||[],counts={};for(const row of inventory)counts[row.disposition]=(counts[row.disposition]||0)+1;
 const detail=value=>esc(JSON.stringify(value,null,2));
 return `<h3>Source reconciliation</h3><p>${esc(c.metadata?.sourceProperty||'Unidentified property')} · ${esc(c.metadata?.period||'Unidentified period')} · ${esc(c.metadata?.basis||'Unidentified basis')}</p><p>${esc(c.sourceFile)}<br>Source SHA-256: <code>${esc(c.sourceHash)}</code><br>Mapping: ${esc(e.mappingVersion||'Missing')}</p><p>${inventory.length} source rows inventoried · ${leaves.filter(x=>x.checked).length}/${(c.rows||[]).filter(x=>x.kind==='posting').length} account rows checked · ${controls.filter(x=>x.passed).length}/${controls.length} controls reconciled · ${(c.exceptions||[]).length} exceptions</p><p>${Object.entries(counts).map(([name,n])=>esc(name)+': '+n).join(' · ')}</p><p>Monthly actual column: ${detail(e.selectedActualColumn||{})}. T12 and other reporting columns remain supporting evidence.</p><div class="financial-review-scroll"><table><thead><tr><th>Control</th><th>Source</th><th>Calculated</th><th>Difference</th><th>Tolerance</th><th>Contributors</th><th>Result</th></tr></thead><tbody>${controls.map(x=>`<tr><th>${esc(x.label)}</th><td>${money(x.sourceTotal)}</td><td>${money(x.calculatedTotal)}</td><td>${money(x.difference)}</td><td>${money(x.tolerance)}</td><td><details><summary>${x.childRowIds?.length||0} rows</summary>${esc(x.childRowIds?.join(', '))}</details></td><td>${x.passed?'Pass':'Blocked'}</td></tr>`).join('')}</tbody></table></div><details><summary>Every row and disposition (${inventory.length})</summary><div class="financial-review-scroll"><table><thead><tr><th>Source row</th><th>Label / GL</th><th>Disposition</th><th>Evidence and reason</th></tr></thead><tbody>${inventory.map(x=>`<tr><td>${esc(x.id||x.sheet+'!'+x.row)}</td><td>${esc(x.rawLabel)} ${esc(x.glCode)}</td><td>${esc(x.disposition)}</td><td><details><summary>${esc(x.reason||'Source evidence')}</summary><pre>${detail(x)}</pre></details></td></tr>`).join('')}</tbody></table></div></details><details><summary>Excluded columns and coverage effects — review required</summary><pre style="white-space:pre-wrap">${detail(e.columnExclusions||[])}</pre></details><details><summary>Account validation (${leaves.length})</summary><pre style="white-space:pre-wrap">${detail(leaves)}</pre></details><details ${(c.exceptions||[]).length?'open':''}><summary>Blocking exceptions</summary><pre style="white-space:pre-wrap">${detail(c.exceptions||[])}</pre></details>`;
}
export async function openReview({communityId=null,period:requestedPeriod=null,file:initialFile=null}={}){
 if(communityId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(communityId))throw Error('Choose an authorized community.');
 if(requestedPeriod&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(requestedPeriod))throw Error('Choose a valid reporting month.');
 const central=centralClient(),actor=central.getSession?.()?.user?.id;
 const guard=()=>{if(!actor||actor!==central.getSession?.()?.user?.id)throw Error('The signed-in account changed. Reopen the review.');};
 const [communities,aliases]=await Promise.all([central.readCommunitiesForAccess(),central.fetchJson('/atlas_community_aliases?active=eq.true&select=community_id,alias,active&limit=1000')]);guard();
 if(communityId&&!communities.some(c=>c.community_id===communityId))throw Error('This community is outside your authorized scope.');
 dispose();const dialog=document.createElement('dialog');active=dialog;dialog.className='financial-package-review';
 dialog.innerHTML='<h2>Review and close monthly actuals</h2><p>Use the Accounting-approved Budget Comparison Income Statement (BCR). Each month requires its own source review and Admin close. T12 is supporting evidence.</p><ol data-workflow></ol><p data-receipt></p><label>Monthly financial package <input type="file" accept=".pdf,.xlsx" data-file></label><button type="button" data-cancel>Cancel processing</button><button type="button" data-close>Close window</button><p role="status" aria-live="polite"></p><section data-history><label>Reporting month <input type="month" data-period></label><button data-load>Load shared intake and reviews</button><div data-history-list></div></section><section data-result></section>';
 document.body.append(dialog);dialog.showModal();let epoch=0,operation,certificate,flow;
 const status=dialog.querySelector('[role=status]'),result=dialog.querySelector('[data-result]'),periodInput=dialog.querySelector('[data-period]');
 periodInput.value=requestedPeriod||new URL(location.href).searchParams.get('comparisonPeriod')||new Date().toISOString().slice(0,7);periodInput.disabled=Boolean(requestedPeriod);
 dialog.addEventListener?.('atlas-financial-intake-state',event=>{guard();state(event.detail);});
 function state(receipt){const index=INTAKE_STATES.indexOf(receipt?.status);dialog.querySelector('[data-workflow]').innerHTML=INTAKE_LABELS.map((label,i)=>`<li ${i===index?'aria-current="step"':''}>${i<=index?'✓ ':''}${label}</li>`).join('');dialog.querySelector('[data-receipt]').textContent=receipt?`${receipt.state||receipt.status} · receipt ${receipt.receipt_id} · ${receipt.created_at} · user ${receipt.actor_id}`:'No durable intake saved yet.';}state();
 const cancel=()=>{epoch++;operation?.abort();operation=null;certificate=null;flow=null;result.replaceChildren();state();};
 dialog.onclose=()=>{cancel();dialog.remove();if(active===dialog)active=null;};dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('[data-cancel]').onclick=()=>{cancel();status.textContent='Processing canceled. Completed receipts remain available in shared intake.';};
 async function showCertificate(parsed,resume=null,sourceBytes=null){
  const token=epoch,match=resolveCommunity(parsed.metadata?.sourceProperty,communities,aliases);
  if(communityId&&match.communityId!==communityId)throw Error('This source does not match the selected community. Open its matching community review.');
  if(requestedPeriod&&parsed.metadata?.period!==requestedPeriod)throw Error('The BCR monthly actual period is '+(parsed.metadata?.period||'unidentified')+', not '+requestedPeriod+'.');
  if(!requestedPeriod)periodInput.value=parsed.metadata?.period||periodInput.value;
  const picked=communityId||resume?.workflow?.community_id||match.communityId||'';
  if(parsed.intakeEvidence?.workbookAudit&&!parsed.intakeEvidence.workbookAudit.auditId){
   parsed=structuredClone(parsed);
   if(!resume&&picked){
    const priorRows=await central.fetchJson(`/atlas_financial_package_reviews?community_id=eq.${picked}&period_key=eq.${parsed.metadata.period}&select=review_id,community_id,period_key,source_hash,certificate&order=created_at.desc&limit=1`);guard();
    const prior=priorRows?.[0];if(prior&&(prior.community_id!==picked||prior.period_key!==parsed.metadata.period))throw Error('Previous workbook review scope mismatch.');
    const previousRef=prior?.certificate?.intakeEvidence?.workbookAudit;
    if(previousRef&&prior.source_hash!==parsed.sourceHash){
     const previous=previousRef.auditId?await readWorkbookAudit(central,previousRef,{sourceHash:prior.source_hash}):previousRef;
     parsed.intakeEvidence.workbookAudit=compareWorkbookEvidence(parsed.intakeEvidence.workbookAudit,previous);
     parsed.intakeEvidence.previousWorkbookReview={reviewId:prior.review_id,sourceHash:prior.source_hash,fingerprint:previous.fingerprint,communityId:picked,period:parsed.metadata.period};
    }
   }
   const retained=await persistWorkbookAudit(central,parsed.intakeEvidence.workbookAudit,{sourceHash:parsed.sourceHash,sourceBytes});guard();if(token!==epoch||!dialog.isConnected)return;
   parsed.intakeEvidence.workbookAudit=retained;parsed=await finalizeFinancialPackageEvidence(parsed);
  }
  certificate=parsed;flow=createIntake(central,{...(resume||{}),onState:receipt=>{if(token===epoch&&dialog.isConnected)state(receipt);}});const reviewFlow=flow;
  result.innerHTML=evidenceHtml(parsed)+monthlyGovernanceForm(parsed,actor)+`<label>Canonical community <select data-community><option value="">Choose the authorized community</option>${communities.map(c=>`<option value="${esc(c.community_id)}" ${c.community_id===picked?'selected':''}>${esc(c.display_name)}</option>`).join('')}</select></label><p>Source property: ${esc(parsed.metadata?.sourceProperty)}. A suggested match becomes authoritative only when you confirm it.</p><p data-coverage-policy></p><label><input type="checkbox" data-confirm> I confirm this canonical community and the BCR monthly period ${esc(parsed.metadata?.period)}.</label><label><input type="checkbox" data-exclusions> I reviewed every row disposition, excluded column and coverage effect above.</label><button data-download>Download full evidence</button><button data-save>Validate and save review</button><p data-saved>Saving a review does not close or publish actuals.</p><div data-controls></div>`;
  const select=result.querySelector('[data-community]');select.disabled=Boolean(communityId||resume?.workflow?.community_id);
  result.querySelector('[data-download]').onclick=async()=>{try{guard();const full=structuredClone(certificate);if(full.intakeEvidence.workbookAudit?.auditId)full.intakeEvidence.workbookAudit=await readWorkbookAudit(central,full.intakeEvidence.workbookAudit,{sourceHash:full.sourceHash});guard();download(full);}catch(error){status.textContent=error.message;}};
  const save=result.querySelector('[data-save]'),message=result.querySelector('[data-saved]');
  if(!parsed.intakeEvidence){save.disabled=true;message.textContent='This older certificate lacks the complete row inventory. Re-upload its original source for governed close.';return;}
  let coveragePolicy=null,coverageScope='',coverageEpoch=0;
  const coveragePanel=result.querySelector('[data-coverage-policy]');
  const loadCoverage=async()=>{
   const run=++coverageEpoch,selected=select.value;coveragePolicy=null;coverageScope='';save.disabled=true;result.querySelector('[data-confirm]').checked=false;result.querySelector('[data-exclusions]').checked=false;
   coveragePanel.textContent='Reading authoritative coverage for this community and month…';
   try{
    guard();if(!communities.some(c=>c.community_id===selected))throw Error('Choose an authorized community before reading its coverage.');
    const records=await readFinance(central,[selected],[parsed.metadata.period]);guard();
    if(run!==coverageEpoch||token!==epoch||!dialog.isConnected)return;
    const row=records?.[0];if(records?.length!==1||row.community_id!==selected||row.period_key!==parsed.metadata.period||row.summary?.communityId!==selected||row.summary?.period!==parsed.metadata.period)throw Error('Financial coverage scope mismatch.');
    const policy=row.summary.coveragePolicy;if(!policy||typeof policy.fullMonthAllowed!=='boolean'||!policy.classification)throw Error('Authoritative coverage policy is unavailable. Retain this source and retry before confirming.');
    coveragePolicy=JSON.parse(JSON.stringify(policy));coverageScope=selected+'|'+parsed.metadata.period;
    coveragePanel.textContent=`Authoritative coverage: ${policy.classification}. ${policy.reason||'Canonical full-month policy.'}${policy.carryIn?.length?' Carry-in disclosure: '+JSON.stringify(policy.carryIn)+'. The reported monthly amounts remain unchanged.':''}${policy.fullMonthAllowed?'':' Blocked: this source is not eligible for a full-month close.'}`;
    save.disabled=!policy.fullMonthAllowed;
    message.textContent=policy.fullMonthAllowed?'Saving a review does not close or publish actuals.':'Blocked: '+(policy.reason||'Outside authoritative full-month coverage.');
   }catch(error){if(run===coverageEpoch&&token===epoch){coveragePanel.textContent='Blocked: '+error.message;message.textContent=error.message;save.disabled=true;}}
  };
  select.onchange=loadCoverage;
  save.onclick=async()=>{save.disabled=true;try{guard();if(!select.value||!result.querySelector('[data-confirm]').checked||!result.querySelector('[data-exclusions]').checked)throw Error('Confirm the community, monthly period and exclusion review first.');
   if(coverageScope!==select.value+'|'+certificate.metadata.period||coveragePolicy?.fullMonthAllowed!==true)throw Error('Read the authoritative community/month coverage before saving a full-month review.');
   message.textContent='Saving reconciliation and reading back the shared review…';
   if(certificate.intakeEvidence.workbookAudit?.auditId)await persistWorkbookAudit(central,certificate.intakeEvidence.workbookAudit,{sourceHash:certificate.sourceHash,communityId:select.value});
   const saved=await prepareReview(central,certificate,{communityId:select.value,period:certificate.metadata.period,exclusionsReviewed:true,coverage:coveragePolicy,governance:readMonthlyGovernanceForm(result,certificate,actor),intake:reviewFlow});guard();if(token!==epoch)return;certificate=saved.certificate;
   message.textContent=`Review Saved · ${saved.review.review_id} · receipt ${saved.intake.receipt.receipt_id}. Admin close is the next step; the review has not published actuals.`;select.disabled=true;
   await applyControls(result.querySelector('[data-controls]'),saved.review,status);
  }catch(error){if(token===epoch){message.textContent=error.message;save.disabled=coveragePolicy?.fullMonthAllowed!==true;}}};
  try{
   if(!reviewFlow.receipt)await reviewFlow.stage('uploaded',parsed);if(token!==epoch||!dialog.isConnected)return;
   if(reviewFlow.receipt.status==='uploaded')await reviewFlow.stage('classified',parsed);if(token!==epoch||!dialog.isConnected)return;
   state(reviewFlow.receipt);status.textContent=evaluateFinancialPackageSafety(parsed).technicalReconciled?'All required source checks passed. Confirm identity and exclusions before saving the review.':'Blocked: review the account and control exceptions. Completed source receipts are retained.';
  }catch(error){if(token!==epoch||!dialog.isConnected)return;status.textContent=error.message;}

  await loadCoverage();
 }
 async function read(file){cancel();if(!file)return;const token=epoch;operation=new AbortController();status.textContent='Reading and inventorying the source…';try{const parsed=await readPackage(file,{signal:operation.signal,onProgress:text=>{if(token===epoch)status.textContent=text;}});guard();if(token===epoch)await showCertificate(parsed,null,await file.arrayBuffer());}catch(error){if(token===epoch)status.textContent=error.message;}}
 dialog.querySelector('[data-file]').onchange=async event=>{await read(event.target.files[0]);event.target.value='';};
 dialog.querySelector('[data-load]').onclick=async()=>{
  const list=dialog.querySelector('[data-history-list]'),period=periodInput.value,filter=communityId?'&community_id=eq.'+communityId:'';list.textContent='Loading central records…';
  try{guard();if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))throw Error('Choose a reporting month.');
   const [reviews,workflows]=await Promise.all([central.fetchJson(`/atlas_financial_package_reviews?period_key=eq.${period}${filter}&select=review_id,community_id,period_key,source_property,source_file,status,created_at&order=created_at.desc&limit=30`),central.fetchJson(`/atlas_financial_intake_workflows?kind=eq.actuals&period_key=eq.${period}${filter}&select=*&order=updated_at.desc&limit=30`)]);guard();if(!Array.isArray(reviews)||!Array.isArray(workflows)||[...reviews,...workflows].some(r=>r.period_key!==period||(communityId&&r.community_id!==communityId)))throw Error('Saved financial review scope mismatch.');if(!dialog.isConnected)return;
   list.replaceChildren();if(!reviews.length&&!workflows.length)list.textContent='No shared intake or reviews for this month.';
   for(const workflow of workflows){const p=document.createElement('p'),button=document.createElement('button');p.textContent=`${workflow.source_file} · ${workflow.status} · ${workflow.workflow_id} `;button.textContent='Read saved intake';p.append(button);list.append(p);button.onclick=async()=>{try{guard();const [receipt]=await central.fetchJson(`/atlas_financial_intake_receipts?receipt_id=eq.${workflow.current_receipt_id}&select=*&limit=1`);guard();if(receipt?.receipt_id!==workflow.current_receipt_id||receipt.workflow_id!==workflow.workflow_id||receipt.source_hash!==workflow.source_hash||receipt.community_id!==workflow.community_id)throw Error('Saved intake receipt scope mismatch.');if(!receipt?.evidence?.certificate)throw Error('This receipt has no source certificate. Open the saved review below.');cancel();if(INTAKE_STATES.indexOf(receipt.status)>=INTAKE_STATES.indexOf('review_saved')){result.innerHTML=evidenceHtml(receipt.evidence.certificate);state(receipt);}else await showCertificate(receipt.evidence.certificate,{workflow,receipt});}catch(error){status.textContent=error.message;}};}
   for(const review of reviews){const p=document.createElement('p'),button=document.createElement('button');p.textContent=`${review.source_property} · ${review.source_file} · ${review.status} · review ${review.review_id} `;button.textContent='Read review and close controls';p.append(button);list.append(p);button.onclick=async()=>{try{guard();const [stored]=await central.fetchJson(`/atlas_financial_package_reviews?review_id=eq.${review.review_id}&period_key=eq.${period}${filter}&select=*&limit=1`);guard();if(stored?.review_id!==review.review_id||stored.community_id!==review.community_id||stored.period_key!==period)throw Error('Saved financial review scope mismatch.');cancel();certificate=stored.certificate;result.innerHTML=evidenceHtml(certificate);const controls=document.createElement('div');result.append(controls);await applyControls(controls,stored,status);}catch(error){status.textContent=error.message;}};}
  }catch(error){list.textContent=error.message;}
 };
 if(initialFile)await read(initialFile);else await dialog.querySelector('[data-load]').onclick();
}
