import {resolveEffectiveBaseline,effectiveBaselineMetric,readEffectiveBaselines} from './reforecast-consumers.mjs?v=42aba35c99c5d2c5';
import {financeSnapshot,retainedSnapshot,lineageColumns} from './financial-snapshot.mjs?v=848d058bdec07b4e';
// Shared, period-specific finance adapter. No browser-state fallback.
export const number = value => value === null || value === undefined || String(value).trim() === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const sorted=value=>Array.isArray(value)?[...value].map(String).sort():[];
export function financeAccessKey(central){
 const session=central.getSession?.(),profile=central.getStoredProfile?.(),config=central.getConfig?.();
 return JSON.stringify({actor:session?.user?.id||null,backend:config?.supabaseUrl||null,enabled:config?.enabled??null,profileUser:profile?.user_id||null,role:profile?.role||null,status:profile?.status||null,scope:sorted(profile?.allowed_community_ids),markets:sorted(profile?.allowed_market_values),regions:sorted(profile?.allowed_region_values),communityRecords:sorted(profile?.community_access_records?.map(row=>row.community_id||row.atlasCommunityId||row.sourceIds?.atlasCommunityId).filter(Boolean)),accountStatus:profile?.account_status||null,tabs:sorted(profile?.locked_tab_ids),pages:sorted(profile?.locked_page_keys),permissions:sorted(profile?.bonus_permissions),profileVersion:profile?.version??null,profileUpdatedAt:profile?.updated_at||null});
}
export async function readFinance(central, communityIds, periods, {signal,baselineMode='effective'} = {}) {
 const ids=[...new Set(communityIds)], months=[...new Set(periods)];
 if(!ids.length||!months.length)return [];
 if(months.length>24||months.some(p=>!/^20\d{2}-(0[1-9]|1[0-2])$/.test(p)))throw Error('Invalid finance reporting periods.');
 const actor=central.getSession?.()?.user?.id, result=[];
 const batchSize=Math.min(100,Math.floor(1200/months.length));
 for(let i=0;i<ids.length;i+=batchSize){
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  // rpc() intentionally unwraps the first row for single-record mutations.
  // A table-returning read must retain the full REST response.
  await central.refreshSession?.();
  const rows=await central.fetchJson('/rpc/atlas_read_finance',{method:'POST',body:JSON.stringify({p_community_ids:ids.slice(i,i+batchSize),p_periods:months})});
  if(!Array.isArray(rows))throw Error('Financial readback must be a row array.');
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(central.getSession&&actor!==central.getSession()?.user?.id)throw Error('Session changed while reading financial evidence.');
  for(const row of rows||[]){
   if(!ids.slice(i,i+batchSize).includes(row.community_id)||!months.includes(row.period_key)||row.summary?.registryVersion!=='atlas-finance-v1'||row.summary.communityId!==row.community_id||row.summary.period!==row.period_key)throw Error('Financial readback scope or registry mismatch.');
   const snapshot=financeSnapshot(row.summary,row.publication_id||null);
   result.push({...row,summary:{...row.summary,publicationId:row.publication_id||null,snapshotFingerprint:snapshot.fingerprint,financialSnapshot:snapshot}});
  }
 }
 if(baselineMode==='effective'){
  let baselines=result.map(row=>row.summary.effectiveBaseline).filter(Boolean);
  if(result.some(row=>!Object.hasOwn(row.summary,'effectiveBaseline'))){try{baselines=await readEffectiveBaselines(central,{communityIds:ids,periods:months});}catch(error){baselines=ids.flatMap(communityId=>months.map(period=>({status:'unavailable',communityId,period,reason:'effective_baseline_read_failed: '+error.message})));}}
  if(central.getSession&&actor!==central.getSession()?.user?.id)throw Error('Session changed while reading financial baseline evidence.');
  for(const row of result){const baseline=resolveEffectiveBaseline(baselines,{communityId:row.community_id,period:row.period_key}),summary=withEffectiveBaseline(row.summary,baseline),snapshot=financeSnapshot(summary,row.publication_id||null);row.summary={...summary,snapshotFingerprint:snapshot.fingerprint,financialSnapshot:snapshot};}
 }else if(baselineMode==='original_budget'){
  for(const row of result){if(!row.summary.effectiveBaseline)continue;const summary=withOriginalBudget(row.summary),snapshot=financeSnapshot(summary,row.publication_id||null);row.summary={...summary,snapshotFingerprint:snapshot.fingerprint,financialSnapshot:snapshot};}
 }else throw Error('Choose an explicit effective or original-budget reporting baseline.');
 return result;
}
function withOriginalBudget(summary){
 const metric=(value,key)=>{if(!value||typeof value!=='object')return value;const target=number(Object.hasOwn(value,'originalBudget')?value.originalBudget:value.budget),actual=number(value.actual),variance=actual===null||target===null?null:actual-target,direction=['expenses','capital','debt','liabilities','belowNoi'].includes(key)?-1:1,favorability=variance===null?'unavailable':variance===0?'neutral':variance*direction>0?'favorable':'unfavorable';return {...value,budget:target,originalBudget:target,variance,favorability,status:favorability==='unavailable'?'missing':favorability,label:favorability==='unavailable'?'Original budget comparison unavailable':favorability,availability:actual===null?'actual_unavailable':target===null?'budget_unavailable':'available',comparisonBasis:'original_budget'};};
 const next={...summary,comparisonBasis:'original_budget'};
 for(const key of ['gpr','netRentalIncome','revenue','expenses','noi','margin','cashFlow','capital','debt','assets','liabilities','equity'])if(summary[key])next[key]=metric(summary[key],key);
 if(summary.ytd){next.ytd=Object.fromEntries(Object.entries(summary.ytd).map(([key,value])=>[key,metric(value,key)]));next.ytdGpr=next.ytd.gpr||null;next.ytdExpenses=next.ytd.expenses||null;}
 return next;
}
function metricTarget(summary,baseline,key){
 if(baseline?.status!=='available')return null;
 const metric=summary[key];
 // The server resolves reviewed GL-to-metric mappings that are not aggregate natures.
 if(metric&&Object.hasOwn(metric,'activeBaseline')&&metric.baselineVersion===baseline.versionId&&metric.baselineSourceType===baseline.sourceType&&(metric.baselinePublicationId||null)===(baseline.publicationId||null))return number(metric.activeBaseline);
 if(baseline.sourceType==='original_budget'&&baseline.versionId===summary.budgetVersion)return number(Object.hasOwn(metric||{},'originalBudget')?metric.originalBudget:metric?.budget);
 return effectiveBaselineMetric(baseline,key);
}
export function withEffectiveBaseline(summary,baseline){
 const next={...summary,effectiveBaseline:baseline||{status:'unavailable',reason:'missing_baseline'},originalBudgetVersion:summary.originalBudgetVersion||summary.budgetVersion||null,activeBaselineVersion:baseline?.status==='available'?baseline.versionId:null,activeBaselinePublicationId:baseline?.status==='available'?baseline.publicationId||null:null};
 for(const key of ['gpr','netRentalIncome','revenue','expenses','noi','margin','cashFlow','capital','debt','assets','liabilities','equity']){
  if(!summary[key])continue;const originalBudget=Object.hasOwn(summary[key],'originalBudget')?summary[key].originalBudget:summary[key].budget;
  const target=metricTarget(summary,baseline,key);
  const actual=number(summary[key].actual),variance=actual===null||target===null?null:actual-target,direction=['expenses','capital','debt','liabilities'].includes(key)?-1:1,favorability=variance===null?'unavailable':variance===0?'neutral':variance*direction>0?'favorable':'unfavorable';
  next[key]={...summary[key],originalBudget,budget:target,activeBaseline:target,variance,favorability,status:favorability==='unavailable'?'missing':favorability,label:favorability==='unavailable'?'Effective baseline unavailable':favorability};
 }
 if(summary.ytd){
  const periods=summary.fiscalPeriods,evidence=summary.ytdBaselinePeriods,verified=Array.isArray(periods)&&periods.length>0&&new Set(periods).size===periods.length&&Array.isArray(evidence)&&evidence.length===periods.length&&periods.every(period=>evidence.filter(item=>item.period===period&&item.status==='available'&&item.versionId&&item.contentHash).length===1);
  next.ytd=Object.fromEntries(Object.entries(summary.ytd).map(([key,metric])=>{const target=verified?number(metric.activeBaseline):null,actual=number(metric.actual),variance=actual===null||target===null?null:actual-target,direction=['expenses','capital','debt','belowNoi'].includes(key)?-1:1,favorability=variance===null?'unavailable':variance===0?'neutral':variance*direction>0?'favorable':'unfavorable';return [key,{...metric,originalBudget:Object.hasOwn(metric,'originalBudget')?metric.originalBudget:metric.budget,budget:target,activeBaseline:target,variance,favorability,status:favorability==='unavailable'?'missing':favorability}];}));
  next.ytdGpr=next.ytd.gpr||null;next.ytdExpenses=next.ytd.expenses||null;
 }
 return next;
}
export function financialSummary(envelope) {
 const s=envelope||{},value=(key,field)=>number(s[key]?.[field]);
 const revenueActual=value('revenue','actual'),expenseActual=value('expenses','actual'),noiActual=value('noi','actual');
 const revenueBudget=value('revenue','budget'),expenseBudget=value('expenses','budget'),noiBudget=value('noi','budget');
 const difference=(a,b)=>a===null||b===null?null:a-b;
 return {hasData:!!s.actualCloseVersion,source:s.actualSource||'Missing closed financial package',version:s.actualCloseVersion||null,budgetVersion:s.budgetVersion||null,
  revenueActual,expenseActual,noiActual,revenueBudget,expenseBudget,noiBudget,annualBudget:null,revenueOriginalBudget:value('revenue','originalBudget'),expenseOriginalBudget:value('expenses','originalBudget'),noiOriginalBudget:value('noi','originalBudget'),effectiveBaseline:s.effectiveBaseline||null,activeBaselineVersion:s.activeBaselineVersion||null,
  cashFlowActual:value('cashFlow','actual'),cashFlowBudget:value('cashFlow','budget'),
  revenueVariance:difference(revenueActual,revenueBudget),expenseVariance:difference(expenseActual,expenseBudget),noiVariance:difference(noiActual,noiBudget),
  snapshotFingerprint:s.snapshotFingerprint||financeSnapshot(s).fingerprint,financialSnapshot:s.financialSnapshot||financeSnapshot(s),
  coverage:{latestClosedPeriod:s.latestClosedPeriod||null,completeYtd:s.completeYtd===true,missingPeriods:s.missingPeriods||[]},metrics:s};
}
export function bonusEvidence(envelopes,metric,periods,{requireEffectiveBaseline=false}={}) {
 // Input evidence only; assignment, plan and payroll eligibility remain separate gates.
 if(periods.length!==3||new Set(periods).size!==3)return null;
 const start=Number(periods[0].slice(5));
 if(![1,4,7,10].includes(start)||periods.some((p,i)=>p!==periods[0].slice(0,5)+String(start+i).padStart(2,'0')))return null;
 const rows=periods.map(p=>envelopes.find(s=>s?.period===p));
 if(rows.some(s=>!s?.actualCloseVersion||!s.budgetVersion||s.targetApprovalStatus!=='approved'||s.registryVersion!=='atlas-finance-v1'||number(s[metric]?.actual)===null||number(s[metric]?.budget)===null))return null;
 if(rows.some(s=>s.communityId!==rows[0].communityId||s.accountingBasis!==rows[0].accountingBasis||s.currency!==rows[0].currency))return null;
 const useEffective=requireEffectiveBaseline||rows.some(s=>Object.hasOwn(s,'effectiveBaseline'));
 const baselines=useEffective?rows.map(s=>resolveEffectiveBaseline(s.effectiveBaseline,{communityId:s.communityId,period:s.period})):[];
 if(useEffective&&baselines.some(s=>s.status!=='available'))return null;
 const targets=rows.map((s,index)=>useEffective?metricTarget(s,baselines[index],metric):number(s[metric].budget));if(targets.some(value=>value===null))return null;
 const actual=rows.reduce((n,s)=>n+number(s[metric].actual),0),budget=targets.reduce((total,value)=>total+value,0);
 if(budget===0)return null;
 const inputs=rows.map(s=>s.financialSnapshot||financeSnapshot(s)),retained=retainedSnapshot({kind:'bonus_financial_evidence',identity:{communityId:rows[0].communityId,metric,periods,sourceSnapshots:inputs.map(s=>s.fingerprint)},values:{actual,budget,baselineEvidence:baselines.map(row=>({period:row.period,sourceType:row.sourceType,versionId:row.versionId,publicationId:row.publicationId||null,contentHash:row.contentHash}))}});
 return {actual,budget,snapshotFingerprint:retained.fingerprint,sourceSnapshots:inputs.map(s=>({period:s.identity.period,...lineageColumns(s)})),financialSnapshot:retained,baselineEvidence:baselines,mathematicalVariance:actual-budget,favorability:actual===budget?'neutral':(['expenses','capital','debt'].includes(metric)?actual<budget:actual>budget)?'favorable':'unfavorable',approvedTargetVersion:useEffective?baselines.map(s=>s.versionId):rows.map(s=>s.budgetVersion),targetApprovalStatus:'approved',actualCloseVersions:rows.map(s=>s.actualCloseVersion),periods,registryVersion:'atlas-finance-v1',attainment:100+(metric==='expenses'||metric==='capital'||metric==='debt'?-1:1)*(actual-budget)/Math.abs(budget)*100};
}
export async function readApprovedBudgets(central,cid,year){
 const rows=await central.fetchJson(`/atlas_approved_budget_versions?community_id=eq.${encodeURIComponent(cid)}&calendar_year=eq.${year}&select=*&limit=12`);
 if(rows.some(b=>b.community_id!==cid||b.calendar_year!==Number(year)||b.status!=='locked'))throw Error('Approved budget scope mismatch.');
 return rows.map(row=>{const snapshot=retainedSnapshot({kind:'approved_original_budget',identity:{communityId:cid,calendarYear:Number(year),versionId:row.version_id,contentHash:row.content_hash||null,mappingVersion:row.payload?.mappingVersion||null,sourceHash:row.source_hash||row.payload?.sourceHash||null},values:row.payload});return {...row,snapshotFingerprint:snapshot.fingerprint,financialSnapshot:snapshot};});
}
export async function readApprovedBudget(central,cid,year){
 const versions=await readApprovedBudgets(central,cid,year);if(!versions.length)return null;
 const gls=new Map(),covered=new Set(),periodVersions={};
 for(const version of versions)for(const month of version.covered_months||Array.from({length:12},(_,i)=>i)){
  if(covered.has(month))throw Error('Overlapping original budget coverage.');covered.add(month);periodVersions[month]=version.version_id;
  for(const row of version.payload.rows){let merged=gls.get(row.glCode);if(!merged){merged={...row,monthly:Array(12).fill(null)};gls.set(row.glCode,merged);}merged.monthly[month]=number(row.monthly[month]);}
 }
 return {...versions[0],versions,periodVersions,covered_months:[...covered].sort((a,b)=>a-b),payload:{...versions[0].payload,rows:[...gls.values()]}};
}
export async function readDetail(central,envelope){
 if(!envelope?.actualCloseVersion)return [];
 const rows=[];let offset=0;
 for(;;){const page=await central.fetchJson(`/atlas_financial_close_rows?version_id=eq.${envelope.actualCloseVersion}&select=*&order=gl_code&limit=500&offset=${offset}`);rows.push(...page);if(page.length<500)break;offset+=500;if(offset>10000)throw Error('Financial detail exceeds the read limit.');}
 if(envelope.close?.row_count!==undefined&&rows.length!==envelope.close.row_count)throw Error('Financial detail readback incomplete.');
 return rows;
}
