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
const reviewEqual=(a,b)=>a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>a[key]===b[key]);
// A reviewer may keep an absent source account in the forecast as an intentional
// blank. This is a separate server-verified decision, never a workbook cell.
export function retainedReviewedForecastBlank(cell,mapping,{uploadId}={}){
 const policy=mapping?.workbookSourcePolicy,source=cell?.source;
 if(!reviewedWorkbookSourcePolicy(mapping)||!uploadId||!cell||cell.amount!==null||cell.disposition!=='reviewed_forecast_blank'||cell.isBlank!==true||cell.legitimateBlank!==true||cell.reviewedForecastBlankConfirmed!==true||cell.sourceScopeExclusionConfirmed!==false||!mapping.periods.includes(cell.period)||!cell.accountCode)return false;
 if(!Array.isArray(policy.reviewedForecastBlanks)||policy.outsideForecastScope!==undefined&&!Array.isArray(policy.outsideForecastScope))return false;
 const reviews=policy.reviewedForecastBlanks.filter(review=>review.period===cell.period&&review.accountCode===cell.accountCode);
 if(reviews.length!==1||(policy.outsideForecastScope||[]).some(review=>review.period===cell.period&&review.accountCode===cell.accountCode))return false;
 const review=reviews[0];
 return review.confirmed===true&&review.reviewedBy===mapping.reviewedBy&&Boolean(review.reviewedAt)&&String(review.reason||'').trim().length>=3&&source?.kind==='reviewed_forecast_blank'&&source.workbookSourceAbsent===true&&source.uploadId===uploadId&&Boolean(source.auditId)&&Boolean(source.sourceHash)&&source.sourceScenario===mapping.sourceScenario&&source.mappingVersion===mapping.version&&reviewEqual(source.review,review);
}
export const confirmedReviewedForecastBlank=(row,field='forecast')=>['forecast','amount'].includes(field)&&row[field]===null&&row.isBlank===true&&row.legitimateBlank===true&&row.disposition==='reviewed_forecast_blank'&&row.reviewedForecastBlankConfirmed===true&&row.sourceScopeExclusionConfirmed===false&&row.source?.kind==='reviewed_forecast_blank'&&row.source.workbookSourceAbsent===true&&row.source.review?.confirmed===true&&row.source.review.accountCode===row.accountCode&&row.source.review.period===row.period&&Boolean(row.source.uploadId&&row.source.auditId&&row.source.sourceHash&&row.source.mappingVersion&&row.source.sourceScenario)&&Boolean(row.source.review.reviewedBy)&&Boolean(row.source.review.reviewedAt)&&String(row.source.review.reason||'').trim().length>=3;
export function resolveInheritedReviewedForecastBlank(row,baseline,{communityId,publicationIds}={}){
 if(!row||!communityId||baseline?.sourceType!=='approved_reforecast'||baseline.communityId&&baseline.communityId!==communityId||!Array.isArray(publicationIds)||!Array.isArray(baseline.lines)||!Array.isArray(baseline.periodVersions))return null;
 const matches=baseline.lines.filter(line=>line.period===row.period&&String(line.accountCode??line.glCode)===String(row.accountCode??row.glCode)),versions=baseline.periodVersions.filter(version=>version.period===row.period);
 if(matches.length!==1||versions.length!==1)return null;
 const original=matches[0],version=versions[0];
 if(version.sourceType!=='approved_reforecast'||!version.publicationId||!version.versionId||!version.contentHash||!publicationIds.includes(version.publicationId))return null;
 const wrapper=original.source,ancestry=wrapper?.sourceType==='approved_reforecast'?wrapper:original.baselineLineage;
 if(!ancestry||ancestry.publicationId!==version.publicationId||ancestry.versionId!==version.versionId||ancestry.contentHash!==version.contentHash||ancestry.revisionId&&ancestry.revisionId!==version.versionId)return null;
 const source=wrapper?.sourceType==='approved_reforecast'?wrapper.priorSource:wrapper;
 const normalized={...original,accountCode:String(original.accountCode??original.glCode),source};
 if(!confirmedReviewedForecastBlank(normalized,'amount')||!Number.isFinite(Date.parse(source.review.reviewedAt))||['sourceLineId','sheet','address','sourceCoordinates','sourceAmount'].some(key=>source[key]!=null))return null;
 if(original.workbookSourceAmount!==null||original.workbookSourceDisposition!=='source_absent')return null;
 const retained=original.workbookSource;
 if(!retained||['kind','workbookSourceAbsent','uploadId','auditId','sourceHash','sourceScenario','mappingVersion'].some(key=>retained[key]!==source[key])||!reviewEqual(retained.review,source.review))return null;
 return {...structuredClone(normalized),baselineLineage:{period:row.period,sourceType:'approved_reforecast',publicationId:version.publicationId,versionId:version.versionId,contentHash:version.contentHash},workbookSource:structuredClone(retained)};
}
export const confirmedForecastBlank=(row,field)=>['forecast','amount'].includes(field)&&row[field]===null&&row.legitimateBlank===true&&(row.disposition==='workbook_blank'||confirmedReviewedForecastBlank(row,field));
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
