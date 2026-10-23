// Initial suggestions retain the immutable metric relationship that supports
// them. Ambiguous revenue signs and accounts absent from approval need review.
export function initialForecastRegistryProposal(source,evidence=null){
 const evidenceVersions=source?.baseline?.approvedMetricMappings||[],accounts=new Map();
 for(const line of source?.baseline?.lines||[]){const code=String(line.accountCode??line.glCode??'');if(code&&!accounts.has(code))accounts.set(code,{accountCode:code,name:line.accountName||line.name||code,category:'',nature:'',placement:'',effectiveFrom:source.periods?.[0]||'',candidateEvidence:[]});}
 for(const line of evidence?.lines||[]){const code=String(line.accountCode||'');if(code&&!accounts.has(code))accounts.set(code,{accountCode:code,name:line.accountName||code,category:'',nature:'',placement:'',effectiveFrom:source.periods?.[0]||'',candidateEvidence:[{kind:'workbook_account_absent_from_original_budget',sourceAccountCode:code,sheet:line.sheet,sourceLineId:line.id}]});}
 for(const account of accounts.values()){
  const memberships=[];
  for(const version of evidenceVersions)for(const metric of ['revenue','expenses','capital','debt'])for(const row of version.metricMappings?.[metric]||[])if(String(row.glCode??row.accountCode)===account.accountCode)memberships.push({kind:'approved_budget_metric_mapping',metric,factor:row.factor,versionId:version.versionId,sourceHash:version.sourceHash,mappingVersion:version.mappingVersion});
  account.candidateEvidence.push(...memberships);const metrics=[...new Set(memberships.filter(row=>Number(row.factor)===1).map(row=>row.metric))];
  if(metrics.length===1&&memberships.every(row=>Number(row.factor)===1)){
   const metric=metrics[0];account.category=metric==='revenue'?'Revenue':metric==='expenses'?'Operating expenses':metric==='capital'?'Capital':'Debt service';account.placement=['capital','debt'].includes(metric)?'below_noi':'above_noi';
   if(metric!=='revenue')account.nature={expenses:'expense',capital:'capital',debt:'debt'}[metric];
   else account.candidateReview='Choose income or contra-income explicitly; signed source amounts remain unchanged.';
  }else account.candidateReview=memberships.length?'Approved metric memberships overlap or use a non-unit factor; classify explicitly.':'No approved metric classification exists for this GL; review its classification explicitly.';
 }
 return {accounts:[...accounts.values()].sort((a,b)=>a.accountCode.localeCompare(b.accountCode)),driverMappings:{},relationships:[],reason:'',proposalSource:{kind:'immutable_original_budget_metric_mappings',versionIds:evidenceVersions.map(row=>row.versionId)}};
}
