/* Explicit interpretation of accounting evidence. Suggestions never approve a mapping. */
export const MONTHLY_GOVERNANCE_VERSION='atlas-monthly-governance/1';
export const ACCOUNT_NATURES=['income','contra_income','expense','below_noi','capital','debt'];
const id=row=>row.source?.rowId;
export function suggestMonthlyMappings(certificate){
 const nodes=certificate.intakeEvidence?.hierarchy||[],node=metric=>nodes.find(n=>n.metricKey===metric)?.factors||{},revenue=node('revenue'),noi=node('noi'),cash=node('cashFlow');
 return (certificate.rows||[]).filter(row=>row.kind==='posting').map(row=>{
  const key=id(row),label=[row.section,row.accountName].filter(Boolean).join(' ');let nature='',placement='below_noi',signMultiplier=1;
  if(Object.hasOwn(revenue,key)){placement='above_noi';nature=/vacancy|concession|bad debt|loss to lease|loss.to.lease/i.test(label)?'contra_income':'income';signMultiplier=revenue[key];}
  else if(Object.hasOwn(noi,key)){placement='above_noi';nature='expense';signMultiplier=-noi[key];}
  else if(/capital|equipment|improvement|replacement reserve/i.test(label)){nature='capital';placement='below_noi';signMultiplier=Object.hasOwn(cash,key)?-cash[key]:1;}
  else if(/debt|mortgage|interest|principal/i.test(label)){nature='debt';placement='below_noi';signMultiplier=Object.hasOwn(cash,key)?-cash[key]:1;}
  else if(Object.hasOwn(cash,key)){nature='below_noi';placement='below_noi';signMultiplier=-cash[key];}
  return {sourceRowId:key,glCode:row.glCode,accountName:row.accountName,nature,placement,signMultiplier,source:{sheet:row.source.sheet,address:row.source.cells?.actual||null,row:row.source.row},suggested:true};
 });
}
export function monthlyGovernanceIssues(certificate){
 const e=certificate.intakeEvidence||{},g=e.governance,issues=[],fail=(code,condition)=>{if(condition)issues.push(code);};
 fail('monthly_governance_required',g?.schemaVersion!==MONTHLY_GOVERNANCE_VERSION);if(!g)return issues;
 fail('reporting_basis_confirmation',!['calendar','fiscal'].includes(g.reportingBasis)||!Number.isInteger(g.fiscalStartMonth)||g.fiscalStartMonth<1||g.fiscalStartMonth>12||(g.reportingBasis==='calendar'&&g.fiscalStartMonth!==1));
 fail('actual_scenario_confirmation',g.scenario!=='actuals'||g.accountingBasis!==certificate.metadata?.basis||g.currency!=='USD');
 fail('mapping_confirmation',g.mappingVersion!==e.mappingVersion||g.confirmed!==true);
 fail('mapping_review_owner_period',!g.review?.owner||g.review.owner!==e.confirmedBy||g.review.effectivePeriod!==certificate.metadata?.period||String(g.review.reason||'').trim().length<10||!g.review.at);
 const leaves=(certificate.rows||[]).filter(r=>r.kind==='posting'),mappings=g.mappings||[];
 fail('complete_leaf_mapping_required',mappings.length!==leaves.length||new Set(mappings.map(m=>m.sourceRowId)).size!==leaves.length||leaves.some(r=>!mappings.some(m=>m.sourceRowId===id(r)&&m.glCode===r.glCode&&m.source?.sheet===r.source.sheet&&m.source?.row===r.source.row&&m.source?.address===(r.source.cells?.actual||null))));
 fail('account_nature_placement_sign_required',mappings.some(m=>!ACCOUNT_NATURES.includes(m.nature)||!['above_noi','below_noi'].includes(m.placement)||![1,-1].includes(m.signMultiplier)));
 const expected=new Map(suggestMonthlyMappings(certificate).map(m=>[m.sourceRowId,m]));
 fail('mapping_differs_from_reconciled_controls',mappings.some(m=>{const target=expected.get(m.sourceRowId);return !target||target.placement!==m.placement||target.signMultiplier!==m.signMultiplier||(target.placement==='above_noi'?(target.nature==='expense'?m.nature!=='expense':!['income','contra_income'].includes(m.nature)):!['below_noi','capital','debt'].includes(m.nature));}));
 const audit=e.workbookAudit;
 if(/\.xlsx$/i.test(certificate.sourceFile||'')){
  fail('workbook_inventory_required',!audit?.schemaVersion||!audit.inventory||!audit.fingerprint||g.auditFingerprint!==audit.fingerprint);
  fail('workbook_dependency_blocked',(audit?.findings||[]).some(f=>f.severity==='blocking'));
  fail('workbook_findings_review_required',(audit?.findings||[]).some(f=>f.severity==='review')&&g.findingsReviewed!==true);
 }
 return issues;
}
export function confirmMonthlyGovernance(certificate,{reportingBasis,fiscalStartMonth,currency,reason,mappings,findingsReviewed,actor,timestamp=new Date().toISOString()}={}){
 if(!actor)throw Error('A signed-in reviewer is required.');
 return {schemaVersion:MONTHLY_GOVERNANCE_VERSION,reportingBasis,fiscalStartMonth:Number(fiscalStartMonth),currency,scenario:'actuals',accountingBasis:certificate.metadata?.basis,mappingVersion:certificate.intakeEvidence?.mappingVersion,confirmed:true,mappings:structuredClone(mappings||[]).map(({suggested,...mapping})=>mapping),review:{owner:actor,reason:String(reason||'').trim(),effectivePeriod:certificate.metadata?.period,at:timestamp},auditFingerprint:certificate.intakeEvidence?.workbookAudit?.fingerprint||null,findingsReviewed:findingsReviewed===true};
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function monthlyGovernanceForm(certificate,actor){
 const g=certificate.intakeEvidence?.governance||{},mappings=g.mappings||suggestMonthlyMappings(certificate),options=(list,selected)=>list.map(value=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(value||'Choose')}</option>`).join('');
 return `<fieldset data-monthly-governance><legend>Confirm accounting interpretation</legend><label>Reporting calendar <select data-basis>${options(['','calendar','fiscal'],g.reportingBasis)}</select></label> <label>Fiscal start month <select data-fiscal>${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i+1===(g.fiscalStartMonth||1)?'selected':''}>${i+1}</option>`).join('')}</select></label> <label>Currency (USD supported) <input data-currency maxlength="3" value="${esc(g.currency||'USD')}"></label><p>Scenario: Actuals · Accounting basis: ${esc(certificate.metadata?.basis)} · Reporting month: ${esc(certificate.metadata?.period)} · Mapping: ${esc(certificate.intakeEvidence?.mappingVersion)}<br>Review owner: ${esc(actor)}</p><details><summary>Review every account's nature, placement and sign (${mappings.length})</summary><div class="financial-review-scroll"><table><thead><tr><th>GL / Account / Source</th><th>Nature</th><th>Statement placement</th><th>Sign multiplier</th></tr></thead><tbody>${mappings.map((m,i)=>`<tr data-mapping-row="${i}"><td>${esc(m.glCode)} · ${esc(m.accountName)}<br>${esc(m.source?.sheet)}!${esc(m.source?.address||m.source?.row)}</td><td><select data-nature>${options(['',...ACCOUNT_NATURES],m.nature)}</select></td><td><select data-placement>${options(['above_noi','below_noi'],m.placement)}</select></td><td><select data-sign><option value="1" ${m.signMultiplier===1?'selected':''}>+1</option><option value="-1" ${m.signMultiplier===-1?'selected':''}>−1</option></select></td></tr>`).join('')}</tbody></table></div></details><details><summary>Full workbook inventory and dependency findings</summary><pre style="white-space:pre-wrap">${esc(JSON.stringify({summary:certificate.intakeEvidence?.workbookAudit?.summary,findings:certificate.intakeEvidence?.workbookAudit?.findings||[],fingerprint:certificate.intakeEvidence?.workbookAudit?.fingerprint},null,2))}</pre></details><label>Review reason <textarea data-mapping-reason placeholder="Explain the reviewed source mapping and any supporting-only findings">${esc(g.review?.reason||'')}</textarea></label><label><input type="checkbox" data-mapping-confirm> I reviewed all account mappings, source coordinates, reporting basis, and workbook findings. The effective period is ${esc(certificate.metadata?.period)}.</label></fieldset>`;
}
export function readMonthlyGovernanceForm(container,certificate,actor){
 const form=container.querySelector('[data-monthly-governance]');if(!form?.querySelector('[data-mapping-confirm]')?.checked)throw Error('Review and confirm every account mapping and the reporting basis.');
 const base=certificate.intakeEvidence?.governance?.mappings||suggestMonthlyMappings(certificate),mappings=[...form.querySelectorAll('[data-mapping-row]')].map(row=>({...base[Number(row.dataset.mappingRow)],nature:row.querySelector('[data-nature]').value,placement:row.querySelector('[data-placement]').value,signMultiplier:Number(row.querySelector('[data-sign]').value)}));
 return confirmMonthlyGovernance(certificate,{reportingBasis:form.querySelector('[data-basis]').value,fiscalStartMonth:Number(form.querySelector('[data-fiscal]').value),currency:form.querySelector('[data-currency]').value.trim().toUpperCase(),reason:form.querySelector('[data-mapping-reason]').value,mappings,findingsReviewed:true,actor});
}
