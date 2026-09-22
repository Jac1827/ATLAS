// Shared, period-specific finance adapter. No browser-state fallback.
export const number = value => value === null || value === undefined || String(value).trim() === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
export async function readFinance(central, communityIds, periods, {signal} = {}) {
 const ids=[...new Set(communityIds)], months=[...new Set(periods)];
 if(!ids.length||!months.length)return [];
 if(months.length>24||months.some(p=>!/^20\d{2}-(0[1-9]|1[0-2])$/.test(p)))throw Error('Invalid finance reporting periods.');
 const actor=central.getSession?.()?.user?.id, result=[];
 const batchSize=Math.min(100,Math.floor(1200/months.length));
 for(let i=0;i<ids.length;i+=batchSize){
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const rows=await central.rpc('atlas_read_finance',{p_community_ids:ids.slice(i,i+batchSize),p_periods:months});
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(central.getSession&&actor!==central.getSession()?.user?.id)throw Error('Session changed while reading financial evidence.');
  for(const row of rows||[]){
   if(!ids.slice(i,i+batchSize).includes(row.community_id)||!months.includes(row.period_key)||row.summary?.registryVersion!=='atlas-finance-v1'||row.summary.communityId!==row.community_id||row.summary.period!==row.period_key)throw Error('Financial readback scope or registry mismatch.');
   result.push(row);
  }
 }
 return result;
}
export function financialSummary(envelope) {
 const s=envelope||{},value=(key,field)=>number(s[key]?.[field]);
 const revenueActual=value('revenue','actual'),expenseActual=value('expenses','actual'),noiActual=value('noi','actual');
 const revenueBudget=value('revenue','budget'),expenseBudget=value('expenses','budget'),noiBudget=value('noi','budget');
 const difference=(a,b)=>a===null||b===null?null:a-b;
 return {hasData:!!s.actualCloseVersion,source:s.actualSource||'Missing closed financial package',version:s.actualCloseVersion||null,budgetVersion:s.budgetVersion||null,
  revenueActual,expenseActual,noiActual,revenueBudget,expenseBudget,noiBudget,annualBudget:null,
  cashFlowActual:value('cashFlow','actual'),cashFlowBudget:value('cashFlow','budget'),
  revenueVariance:difference(revenueActual,revenueBudget),expenseVariance:difference(expenseActual,expenseBudget),noiVariance:difference(noiActual,noiBudget),
  coverage:{latestClosedPeriod:s.latestClosedPeriod||null,completeYtd:s.completeYtd===true,missingPeriods:s.missingPeriods||[]},metrics:s};
}
export function bonusEvidence(envelopes,metric,periods) {
 // Input evidence only; assignment, plan and payroll eligibility remain separate gates.
 if(periods.length!==3||new Set(periods).size!==3)return null;
 const start=Number(periods[0].slice(5));
 if(![1,4,7,10].includes(start)||periods.some((p,i)=>p!==periods[0].slice(0,5)+String(start+i).padStart(2,'0')))return null;
 const rows=periods.map(p=>envelopes.find(s=>s?.period===p));
 if(rows.some(s=>!s?.actualCloseVersion||!s.budgetVersion||s.targetApprovalStatus!=='approved'||s.registryVersion!=='atlas-finance-v1'||number(s[metric]?.actual)===null||number(s[metric]?.budget)===null))return null;
 if(rows.some(s=>s.communityId!==rows[0].communityId||s.accountingBasis!==rows[0].accountingBasis||s.currency!==rows[0].currency))return null;
 const actual=rows.reduce((n,s)=>n+number(s[metric].actual),0),budget=rows.reduce((n,s)=>n+number(s[metric].budget),0);
 if(budget===0)return null;
 return {actual,budget,approvedTargetVersion:rows.map(s=>s.budgetVersion),targetApprovalStatus:'approved',actualCloseVersions:rows.map(s=>s.actualCloseVersion),periods,registryVersion:'atlas-finance-v1',attainment:100+(metric==='expenses'||metric==='capital'||metric==='debt'?-1:1)*(actual-budget)/Math.abs(budget)*100};
}
export async function readApprovedBudgets(central,cid,year){
 const rows=await central.fetchJson(`/atlas_approved_budget_versions?community_id=eq.${encodeURIComponent(cid)}&calendar_year=eq.${year}&select=*&limit=12`);
 if(rows.some(b=>b.community_id!==cid||b.calendar_year!==Number(year)||b.status!=='locked'))throw Error('Approved budget scope mismatch.');
 return rows;
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
