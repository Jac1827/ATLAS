// Evidence is retained even when governance blocks calculation or publication.
const period=/^20\d{2}-(0[1-9]|1[0-2])$/;
const problem=(code,message,extra={})=>({code,message,severity:'error',...extra});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function validatePlanningCalendar(calendar,periods=[],scenario){
 const valid=Boolean(scenario)&&calendar?.confirmed===true&&['calendar','fiscal'].includes(calendar.basis)&&Number.isInteger(calendar.startMonth)&&calendar.startMonth>=1&&calendar.startMonth<=12&&(calendar.basis!=='calendar'||calendar.startMonth===1)&&calendar.scenario===scenario&&Array.isArray(periods)&&periods.length>0&&periods.every(p=>period.test(p))&&same([...(calendar.periods||[])].sort(),[...periods].sort())&&Boolean(calendar.reviewedBy&&calendar.reviewedAt);
 return valid?[]:[problem('calendar_scope_required','Explicitly confirm calendar or fiscal basis, fiscal start month, reporting months and exact scenario.')];
}
export function classifyPlanningCells(evidence){
 const mapped=new Map((evidence.lines||[]).map(line=>[line.id,line])),controls=new Set((evidence.reconciliation||[]).map(row=>`${row.sheet}!${row.address}`));
 return (evidence.sheets||[]).flatMap(sheet=>(sheet.cells||[]).filter(cell=>cell.formula||cell.hasValue&&cell.value!==null&&cell.value!=='').map(cell=>{
  const id=`${sheet.name}!${cell.address}`,line=mapped.get(id),column=(sheet.periodColumns||[]).find(p=>p.column===cell.column),planning=Boolean(line||column&&cell.row>column.headerRow+3&&typeof cell.value==='number');
  return {id,sheet:sheet.name,address:cell.address,period:line?.period||column?.period||null,scenario:line?.scenario||column?.scenario||null,classification:controls.has(id)?'control':cell.formula?'formula':planning?'unsupported_hardcode':'source_evidence',planning,populated:true};
 }));
}
export function validPlanningReview(review,{value,period:effectivePeriod,fingerprint}={}){
 return Boolean(review?.confirmed===true&&String(review.reason||'').trim().length>=3&&review.ownerId&&review.reviewedAt&&period.test(review.effectivePeriod||'')&&(!effectivePeriod||review.effectivePeriod===effectivePeriod)&&(!fingerprint||review.integrityFingerprint===fingerprint)&&Object.prototype.hasOwnProperty.call(review,'before')&&Object.prototype.hasOwnProperty.call(review,'after')&&(value===undefined||same(review.after,value)));
}
export function reviewPlanningIntegrity(evidence,mapping={}){
 const audit=evidence.integrity,issues=[];
 if(!audit?.fingerprint||!audit.inventory||!Array.isArray(audit.findings))return [problem('workbook_integrity_required','Re-import this workbook to retain the complete inventory and dependency audit before approval.')];
 for(const finding of audit.findings){
  const review=(mapping.integrityReviews||[]).find(r=>r.findingId===finding.id);
  if(finding.severity==='blocking'||!validPlanningReview(review,{fingerprint:audit.fingerprint}))issues.push(problem('workbook_integrity_'+finding.code,finding.reason||finding.message||'Workbook integrity finding requires review.',{sheet:finding.sheet,address:finding.address,findingId:finding.id,nonWaivable:finding.severity==='blocking'}));
 }
 for(const id of mapping.selectedLineIds||[]){
  const line=(evidence.lines||[]).find(l=>l.id===id);if(!line||line.scenario!==mapping.sourceScenario||!mapping.periods?.includes(line.period)||line.sourceKind==='workbook_actual_evidence')continue;
  if(!line.formula&&line.amount!==null){const review=(mapping.inputReviews||[]).find(r=>r.cellId===id);if(!validPlanningReview(review,{value:line.amount,period:line.period,fingerprint:audit.fingerprint}))issues.push(problem('planning_input_review_required','Review the populated planning input with its reason, owner and effective month before applying it.',{sourceLineId:id,period:line.period}));}
 }
 return issues;
}
export function reviewPlanningInputs(evidence,lineIds,{reason,ownerId,timestamp=new Date().toISOString()}={}){
 if(String(reason||'').trim().length<3||!ownerId)throw Error('Enter a specific input-review reason. The signed-in reviewer is the owner.');
 return (evidence.lines||[]).filter(line=>lineIds.includes(line.id)&&!line.formula&&line.amount!==null).map(line=>({cellId:line.id,classification:'reviewed_input',confirmed:true,reason:reason.trim(),ownerId,effectivePeriod:line.period,reviewedAt:timestamp,integrityFingerprint:evidence.integrity?.fingerprint,before:line.amount,after:line.amount}));
}
export function planningOverrideIssues(override){
 return validPlanningReview(override,{value:override.amount,period:override.period})?[]:[problem('override_review_required','Each changed forecast cell requires a specific reason, authorized owner, effective month and before/after history.',{period:override.period,accountCode:override.accountCode})];
}
export function planningMappingDispositions(evidence,mapping={}){
 const selected=new Set(mapping.selectedLineIds||[]),reviewed=new Map((mapping.inputReviews||[]).map(r=>[r.cellId,r]));
 const cellClassifications=(evidence.planningCells||classifyPlanningCells(evidence)).map(cell=>({...cell,classification:cell.classification==='unsupported_hardcode'&&selected.has(cell.id)&&validPlanningReview(reviewed.get(cell.id),{period:cell.period,fingerprint:evidence.integrity?.fingerprint})?'reviewed_input':cell.classification,reviewId:reviewed.has(cell.id)?cell.id:null}));
 const rows=(evidence.integrity?.inventory?.sheets||evidence.sheets||[]).flatMap(sheet=>{
  const groups=new Map();for(const cell of sheet.cells||[]){if(!groups.has(cell.row))groups.set(cell.row,[]);groups.get(cell.row).push(cell);}
  return [...groups].map(([row,cells])=>{const ids=cells.map(c=>c.id||`${sheet.name}!${c.address}`),included=(evidence.lines||[]).filter(l=>ids.includes(l.id)&&selected.has(l.id)&&l.scenario===mapping.sourceScenario&&mapping.periods?.includes(l.period));const control=(evidence.reconciliation||[]).some(r=>r.sheet===sheet.name&&r.row===row);return {id:`${sheet.name}!${row}`,sheet:sheet.name,row,sourceCoordinates:cells.map(c=>c.address),disposition:included.length?'included_leaf':control?'subtotal_control':cells.some(c=>c.formula||typeof c.value==='number')?'supporting_column':'header',reason:mapping.reason||'',ownerId:mapping.reviewedBy||'',reviewedAt:mapping.reviewedAt||'',confirmed:mapping.confirmed===true};});
 });return {cellClassificationCounts:cellClassifications.reduce((counts,c)=>(counts[c.classification]=(counts[c.classification]||0)+1,counts),{}),rowDispositions:rows};
}
