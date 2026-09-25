const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function savedStrProgrammeReceipt(stream,source){return source.savedStrSourceReceipts?.find(row=>row.source_receipt_id===stream.sourceReceiptId)||null;}
export function validateSavedStrProgrammeStream(draft,source,stream){
 const issues=[],add=(code,message,detail={})=>issues.push({code,severity:'blocking',message,...detail}),receipt=savedStrProgrammeReceipt(stream,source),review=receipt?.review;
 if(!receipt||receipt.status!=='approved'||receipt.community_id!==source.communityId||receipt.source_hash!==stream.sourceHash||receipt.source_fingerprint!==stream.sourceFingerprint||receipt.content_hash!==stream.contentHash||!review?.ready||review.blockers?.length){add('saved_str_source_required','Read the immutable approved saved programme source receipt before applying its contribution.');return issues;}
 if(stream.application!=='add'||review.application!=='add'||!equal(review.parentPublication,draft.parentPublication)||review.mappingVersion!==stream.mappingVersion||stream.mappingVersion!==source.registry?.version||!review.periods?.every(period=>draft.periods.includes(period)))add('saved_str_parent_or_mapping','Saved STR contribution must remain additive to its exact Conventional publication and mapping registry.');
 if(stream.reviewed!==true||stream.reviewedBy!==receipt.actor_id||stream.reviewedAt!==review.reviewedAt||stream.assumptionReason!==review.reason)add('saved_str_review_changed','Source review identity, time and reason must match its immutable receipt.');
 if(receipt.registry_extension&&!equal(draft.strRegistryExtension,receipt.registry_extension))add('saved_str_registry_receipt','The overlay must retain both immutable registry versions and hashes from its source receipt.');
 const overrides=draft.overrides||[];
 if(overrides.length!==review.cells?.length)add('saved_str_cell_count','Saved programme cell count differs from its exact reviewed monthly contribution.');
 for(const cell of review.cells||[]){
  if(source.lockedPeriods?.includes(cell.period)||(source.actuals?.latestFullClosePeriod||source.actuals?.cutoffPeriod)&&cell.period<=(source.actuals.latestFullClosePeriod||source.actuals.cutoffPeriod))add('saved_str_closed_month','Saved STR contributions cannot change governed actuals or locked months.',{period:cell.period});
  const values=overrides.filter(row=>row.period===cell.period&&row.accountCode===cell.accountCode),row=values[0];
  if(values.length!==1||row.amount!==cell.combinedForecast||row.before!==cell.parentAmount||row.after!==cell.combinedForecast||row.source?.kind!=='str_schedule'||row.source.sourceKind!=='saved_json_monthly_programme'||row.source.sourceReceiptId!==receipt.source_receipt_id||row.source.sourceHash!==receipt.source_hash||row.source.sourceLineId!==cell.sourceLineId||row.source.sourcePath!==cell.sourcePath||row.source.sourceAmount!==cell.sourceAmount||row.source.application!=='add')add('saved_str_cell_readback','The working GL/month value or provenance differs from the approved saved programme contribution.',{period:cell.period,accountCode:cell.accountCode});
 }
 return issues;
}
