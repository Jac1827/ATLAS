/* Reviewed utility rate evidence. No property-name match, peer proxy, or default rate. */
import {readSourceBundle} from './reforecast-store.mjs?v=687b772cb423649c';
import {validateForecastPeriods,fingerprint,sumMoney,moneyDriverAmount} from './reforecast-engine.mjs?v=addea678a6fc086d';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const priorYear=period=>(Number(period.slice(0,4))-1)+period.slice(4);
const utilities=value=>value==='gas'?['natural_gas']:value==='water_sewer'?['water','sewer']:['electricity','natural_gas','water','sewer'].includes(value)?[value]:[];
export function utilityTargets(registry){
 const relationships=registry.utilityRelationships||registry.relationships||registry.payload?.utilityRelationships||registry.payload?.relationships||[];
 return relationships.flatMap(relationship=>[relationship.accountCode||relationship.expenseAccount,relationship.incomeAccount].filter(Boolean).map(accountCode=>({accountCode:String(accountCode),relationship})));
}
// Reporting pairs are exact reviewed GL relationships; setup credits and common-area
// costs are deliberately separate from recoverable resident usage.
export function utilityRecoveryRows(snapshot,relationships=[]){
 const lines=snapshot.lines||snapshot.gl||[],periods=snapshot.identity?.periods||snapshot.periods||[...new Set(lines.map(row=>row.period))].sort();validateForecastPeriods(periods);
 const pairs=relationships.filter(row=>row.relationship==='usage_recovery'&&row.expenseAccount&&row.incomeAccount&&row.expenseAccount!==row.incomeAccount&&![row.expenseAccount,row.incomeAccount].map(String).includes('5956'));
 const difference=(income,expense)=>finite(income)&&finite(expense)?sumMoney([income,-expense]):null;
 return Object.freeze(periods.flatMap(period=>pairs.map(pair=>{
  const expenseAccount=String(pair.expenseAccount),incomeAccount=String(pair.incomeAccount),ambiguous=pairs.filter(row=>String(row.expenseAccount)===expenseAccount||String(row.incomeAccount)===incomeAccount).length!==1;
  const detail=code=>{const matches=lines.filter(row=>row.period===period&&String(row.accountCode||row.glCode)===code);return !ambiguous&&matches.length===1?matches[0]:null;},expense=detail(expenseAccount),income=detail(incomeAccount),value=(row,key)=>finite(row?.[key])?row[key]:null;
  const row={period,utility:pair.utility||null,expenseAccount,incomeAccount,originalExpense:value(expense,'originalBudget'),originalIncome:value(income,'originalBudget'),selectedExpense:value(expense,expense&&Object.hasOwn(expense,'selectedBaseline')?'selectedBaseline':'originalBudget'),selectedIncome:value(income,income&&Object.hasOwn(income,'selectedBaseline')?'selectedBaseline':'originalBudget'),forecastExpense:value(expense,'forecast'),forecastIncome:value(income,'forecast'),actualExpense:value(expense,'actual'),actualIncome:value(income,'actual')};
  for(const basis of ['original','selected','forecast','actual'])row[basis+'RecoveryGap']=difference(row[basis+'Income'],row[basis+'Expense']);
  row.forecastRecoveryChange=difference(row.forecastRecoveryGap,row.selectedRecoveryGap);row.actualRecoveryVariance=difference(row.actualRecoveryGap,row.forecastRecoveryGap);
  row.status=row.forecastRecoveryGap===null?'unavailable':'available';row.reason=ambiguous?'Ambiguous reviewed utility relationship':row.status==='unavailable'?'Both gross utility GL amounts are required; missing values remain unavailable.':null;
  return Object.freeze(row);
 })));
}
export function utilityRecommendations({communityId,periods,registry,vintages=[],rows=[],activations=[],history,closeVersions=[]}){
 validateForecastPeriods(periods);const proposals=[],unavailable=[],targets=utilityTargets(registry),latest=new Map();
 for(const activation of activations)if(!latest.has(activation.fiscal_year)||Number(activation.id)>Number(latest.get(activation.fiscal_year).id))latest.set(activation.fiscal_year,activation);
 const active=vintages.filter(v=>latest.get(v.fiscal_year)?.vintage_id===v.id);
 const missing=(period,accountCode,reason)=>unavailable.push({period,accountCode,status:'unavailable',reason});
 if(!registry?.version)throw Error('A reviewed immutable GL relationship registry is required.');
 for(const period of periods)for(const {accountCode,relationship} of targets){
  if(relationship.relationship==='separate_income'||accountCode==='5956'){missing(period,accountCode,'Separate setup-fee/provider-credit income is not usage recapture.');continue;}
  if(targets.filter(target=>target.accountCode===accountCode).length!==1){missing(period,accountCode,'Conflicting utility relationships require mapping review.');continue;}
  const types=utilities(relationship.utility),mapping=registry.accounts?.find(row=>row.accountCode===accountCode);
  if(!types.length||!mapping||!['expense','income','contra_income'].includes(mapping.identifier||mapping.nature)||mapping.retiredAfter&&mapping.retiredAfter<period){missing(period,accountCode,'An effective reviewed utility type and GL classification are required.');continue;}
  const matches=active.filter(v=>v.metadata?.periods?.includes(period));if(matches.length!==1){missing(period,accountCode,'No unambiguous active utility vintage covers this month.');continue;}
  const vintage=matches[0],index=vintage.metadata.periods.indexOf(period),components=[];
  for(const type of types){const matched=rows.filter(row=>row.vintage_id===vintage.id&&row.community_id===communityId&&row.utility===type);if(matched.length!==1||matched[0].cancelled||matched[0].payload?.status!=='Eligible'||!finite(matched[0].payload?.monthly?.[index]))break;const row=matched[0];components.push({type,sheet:row.sheet,row:row.source_row,monthlyRate:row.payload.monthly[index],weight:1});}
  if(components.length!==types.length){missing(period,accountCode,'Provider rate is unavailable, blank, cancelled, or ambiguous for this community and month.');continue;}
  const allocation=relationship.allocation;
  if(types.length>1){if(allocation?.reviewed!==true||!allocation.source||types.some(type=>!finite(allocation[type])||allocation[type]<0)||types.reduce((n,type)=>n+allocation[type],0)<=0){missing(period,accountCode,'Combined water/sewer requires a reviewed allocation with source evidence.');continue;}for(const component of components)component.weight=allocation[component.type];}
  const sourcePeriod=priorYear(period),closes=closeVersions.filter(close=>close.community_id===communityId&&close.period_key===sourcePeriod),close=closes[0],head=history?.actuals?.closeVersions?.find(row=>row.period===sourcePeriod);
  if(closes.length!==1||close?.status!=='closed'||close?.coverage!=='full_month'||close?.version_id!==head?.versionId||close?.source_hash!==head?.sourceHash){missing(period,accountCode,'Matching prior-year governed full-month close is unavailable or stale.');continue;}
  const actuals=history.actuals.lines.filter(row=>row.period===sourcePeriod&&row.accountCode===accountCode&&row.closeVersionId===close.version_id);if(actuals.length!==1||!finite(actuals[0].amount)){missing(period,accountCode,'Same-month prior-year GL actual is unavailable.');continue;}
  const totalWeight=components.reduce((n,row)=>n+row.weight,0),rate=components.reduce((n,row)=>n+row.monthlyRate*row.weight,0)/totalWeight;
  const source={kind:'utility_forecast',vintageId:vintage.id,sheet:components[0].sheet,row:components[0].row,sourceHash:vintage.source_hash,type:types.join('_'),monthlyRate:rate,sourcePeriod,closeVersionId:close.version_id,closeSourceHash:close.source_hash,historicalAmount:actuals[0].amount,registryVersionId:registry.version,components,currency:close.currency||close.metrics?.currency||registry.currency||null};
  proposals.push({id:fingerprint({period,accountCode,source}),period,accountCode,amount:moneyDriverAmount('percent_change',actuals[0].amount,rate),source,reason:'Same-month prior-year governed actual × (1 + reviewed monthly provider rate); the original seasonal month is retained.'});
 }
 return {proposals,unavailable,registryVersionId:registry.version};
}
export async function readUtilityRecommendations(central,{communityId,periods,registry}){
 validateForecastPeriods(periods);if(!communityId||!registry?.version)throw Error('Select a canonical community and reviewed mapping registry.');const actor=central.getSession?.()?.user?.id,guard=()=>{if(central.getSession&&actor!==central.getSession()?.user?.id)throw Error('Session changed while reading utility evidence.');};
 const [registryRows,history,activations]=await Promise.all([central.fetchJson(`/atlas_reforecast_registries?version_id=eq.${encodeURIComponent(registry.version)}&community_id=eq.${encodeURIComponent(communityId)}&select=version_id,community_id,payload&limit=1`),readSourceBundle(central,{communityId,periods:periods.map(priorYear)}),central.fetchJson('/atlas_utility_forecast_activations?select=id,fiscal_year,vintage_id&order=id.desc&limit=1000')]);guard();
 if(!Array.isArray(registryRows)||registryRows.length!==1||registryRows[0].community_id!==communityId||registryRows[0].version_id!==registry.version)throw Error('Utility registry scope/readback mismatch.');
 const reviewed={...registry,...registryRows[0].payload,version:registry.version},latest=[...new Map(activations.map(row=>[row.fiscal_year,row]).reverse()).values()],ids=[...new Set(latest.map(row=>row.vintage_id))],closeIds=(history.actuals?.closeVersions||[]).map(row=>row.versionId);
 const [vintages,rows,closeVersions]=await Promise.all([ids.length?central.fetchJson(`/atlas_utility_forecast_vintages?id=in.(${ids.join(',')})&select=id,fiscal_year,source_hash,metadata`):[],ids.length?central.fetchJson(`/atlas_utility_forecast_rows?community_id=eq.${encodeURIComponent(communityId)}&vintage_id=in.(${ids.join(',')})&select=vintage_id,community_id,utility,sheet,source_row,cancelled,payload&limit=1000`):[],closeIds.length?central.fetchJson(`/atlas_financial_close_versions?version_id=in.(${closeIds.join(',')})&select=version_id,community_id,period_key,status,coverage,source_hash,metrics`):[]]);guard();
 return utilityRecommendations({communityId,periods,registry:reviewed,vintages,rows,activations,history,closeVersions});
}
