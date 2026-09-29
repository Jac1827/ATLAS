// An explicit source policy is reviewed metadata, not permission to invent zero.
const has=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
export function explicitWorkbookBlankSource(line){
 return has(line,'amount')&&line.amount===null&&line.blank===true&&!line.formula&&line.cellType!=='e'&&(line.cachedValue===null||line.cachedValue==='')&&line.sourceKind!=='workbook_actual_evidence';
}
export function reviewedWorkbookSourcePolicy(mapping){
 const policy=mapping?.workbookSourcePolicy;
 return policy?.schemaVersion===1&&policy.mode==='workbook_exact'&&policy.blankDisposition==='preserve_null'&&policy.confirmed===true&&typeof policy.reviewedBy==='string'&&policy.reviewedBy===mapping.reviewedBy&&Boolean(policy.reviewedAt)&&String(policy.reason||'').trim().length>=3&&mapping.confirmed===true&&Array.isArray(mapping.periods)&&Array.isArray(mapping.selectedLineIds);
}
// This checks the retained receipt shape. The server separately authenticates
// the owner and proves the source cell, account and headers against its audit.
export function retainedWorkbookBlank(cell,mapping){
 return reviewedWorkbookSourcePolicy(mapping)&&has(cell,'amount')&&cell.amount===null&&cell.disposition==='workbook_blank'&&cell.isBlank===true&&cell.legitimateBlank===true&&cell.sourceAmount===null&&cell.mappingVersion===mapping.version&&cell.sourceScenario===mapping.sourceScenario&&mapping.periods.includes(cell.period)&&mapping.selectedLineIds.includes(cell.sourceLineId)&&cell.sourceCoordinates?.sheet&&cell.sourceLineId===`${cell.sourceCoordinates.sheet}!${cell.sourceCoordinates.address}`;
}
export function compactWorkbookBlankReference(cell,{uploadId,period,accountCode,sourceLineId}={}){
 return has(cell,'amount')&&cell.amount===null&&cell.disposition==='workbook_blank'&&cell.isBlank===true&&cell.legitimateBlank===true&&cell.uploadId===uploadId&&cell.period===period&&cell.accountCode===accountCode&&cell.sourceLineId===sourceLineId;
}
export function resolveReviewedWorkbookBlankReference(cell,scenario,source){
 const mappings=new Map((scenario?.importHistory||[]).filter(row=>row.mapping).map(row=>[row.uploadId,row.mapping]));
 if(scenario?.uploadId&&scenario.importMapping)mappings.set(scenario.uploadId,scenario.importMapping);
 const mapping=mappings.get(cell?.uploadId),matches=(source?.workbookBlankCells||[]).filter(row=>compactWorkbookBlankReference(cell,row)&&retainedWorkbookBlank(row,mapping));
 return matches.length===1?matches[0]:null;
}
export const confirmedForecastBlank=(row,field)=>['forecast','amount'].includes(field)&&row[field]===null&&row.legitimateBlank===true&&row.disposition==='workbook_blank';
export const excludedForecastScope=(row,field)=>['forecast','amount'].includes(field)&&row[field]===null&&row.disposition==='outside_forecast_scope'&&row.sourceScopeExclusionConfirmed===true;

// Source completeness is separate from generated destination lines: an unmapped
// numeric source GL cannot disappear merely because it is absent from a registry.
export function sourceRowExclusionIssues(evidence,mapping,{cutoffPeriod}={}){
 if(mapping?.sourceScopeVersion!==1&&!reviewedWorkbookSourcePolicy(mapping))return [];
 const issues=[],selected=new Set(mapping.selectedLineIds||[]),reviews=mapping.sourceRowExclusions||[];
 // Actual classification comes from the source scenario, not a caller-supplied
 // marker. Retained exclusion reviews remain valid after their month closes.
 const scoped=(evidence?.lines||[]).filter(row=>Number.isFinite(row.amount)&&row.scenario===mapping.sourceScenario&&mapping.periods?.includes(row.period)&&!/^actual(?:\b|$)/i.test(row.scenario));
 const eligible=scoped.filter(row=>!cutoffPeriod||row.period>cutoffPeriod);
 for(const row of eligible){
  if(selected.has(row.id))continue;
  const matches=reviews.filter(review=>review.sourceLineId===row.id);
  if(matches.length!==1||matches[0].confirmed!==true||matches[0].reviewedBy!==mapping.reviewedBy||!matches[0].reviewedAt||String(matches[0].reason||'').trim().length<3)issues.push({code:'numeric_source_exclusion_review_required',severity:'error',sourceLineId:row.id,period:row.period,message:`Map numeric source ${row.id} / GL ${row.accountCode}, or explicitly review its exclusion with a specific reason.`});
 }
 for(const review of reviews)if(!scoped.some(row=>row.id===review.sourceLineId)||selected.has(review.sourceLineId))issues.push({code:'invalid_source_exclusion',severity:'error',sourceLineId:review.sourceLineId,message:'A source exclusion must identify a scoped unselected numeric source cell.'});
 return issues;
}
