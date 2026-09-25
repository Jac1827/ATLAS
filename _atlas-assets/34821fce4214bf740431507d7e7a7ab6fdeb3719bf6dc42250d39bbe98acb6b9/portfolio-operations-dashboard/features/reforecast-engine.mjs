import {validatePlanningCalendar,planningOverrideIssues} from './planning-governance.mjs?v=a4de8d3f5a50966c';
/* Pure, deterministic reforecast calculations. This module never reads browser state or publishes. */
export const ENGINE_VERSION='atlas-reforecast-v1';
export const DRIVER_OPERATIONS=Object.freeze(['percent_change','amount','add','percent_of_account','occupancy_vacancy']);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const amount=v=>finite(v)?v:null;
const money=v=>finite(v)?Math.sign(v)*Math.round((Math.abs(v)+Number.EPSILON)*100)/100:null;
const periodPattern=/^20\d{2}-(0[1-9]|1[0-2])$/;
const compound=(period,account)=>`${period}|${account}`;
export const stableStringify=value=>JSON.stringify(canonical(value));
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;}
export function fingerprint(value){const text=stableStringify(value);let a=2166136261,b=2246822519;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),3266489917);}return `${ENGINE_VERSION}:${(a>>>0).toString(16).padStart(8,'0')}${(b>>>0).toString(16).padStart(8,'0')}:${text.length}`;}
const clone=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
const strictSum=values=>values.some(value=>!finite(value))?null:money(values.reduce((sum,value)=>sum+value,0));
const subtract=(a,b)=>finite(a)&&finite(b)?money(a-b):null;
const selectedAmount=row=>Object.hasOwn(row,'selectedBaseline')?row.selectedBaseline:row.originalBudget;
function aggregate(lines,field){
 const selected=predicate=>lines.filter(row=>predicate(row)&&!(['originalBudget','selectedBaseline'].includes(field)&&row[field]===null&&row.baselineDisposition?.kind==='no_original_budget_row')).map(row=>row[field]);
 const grossIncome=strictSum(selected(row=>row.nature==='income'&&row.placement==='above_noi'));
 const contraRevenue=strictSum(selected(row=>row.nature==='contra_income'&&row.placement==='above_noi'));
 const revenue=strictSum([grossIncome,contraRevenue]);
 const opex=strictSum(selected(row=>row.nature==='expense'&&row.placement==='above_noi'));
 const belowExpenses=strictSum(selected(row=>row.nature==='below_noi'||row.nature==='expense'&&row.placement==='below_noi'));
 const belowIncome=strictSum(selected(row=>['income','contra_income'].includes(row.nature)&&row.placement==='below_noi'));
 const belowNoi=subtract(belowExpenses,belowIncome);
 const capital=strictSum(selected(row=>row.nature==='capital')),debt=strictSum(selected(row=>row.nature==='debt'));
 const noi=subtract(revenue,opex),cashFlow=subtract(subtract(subtract(noi,belowNoi),debt),capital);
 const invalid=lines.some(row=>!row.mappingValid);
 return {grossIncome:invalid?null:grossIncome,contraRevenue:invalid?null:contraRevenue,revenue:invalid?null:revenue,opex:invalid?null:opex,expenses:invalid?null:opex,belowNoi:invalid?null:belowNoi,capital:invalid?null:capital,debt:invalid?null:debt,noi:invalid?null:noi,cashFlow:invalid?null:cashFlow,margin:!invalid&&finite(noi)&&finite(revenue)&&revenue!==0?noi/revenue:null};
}
function emptyMetrics(){return Object.fromEntries(['grossIncome','contraRevenue','revenue','opex','expenses','belowNoi','capital','debt','noi','cashFlow','margin'].map(key=>[key,null]));}
const validNature=new Set(['income','contra_income','expense','capital','debt','below_noi']);
// Full months are identities, never dates coerced to a month.
export function validateForecastPeriods(periods,{periodEvidence=[]}={}){
 if(!Array.isArray(periods)||!periods.length||periods.length>24||periods.some(period=>typeof period!=='string'||!periodPattern.test(period))||new Set(periods).size!==periods.length)throw Error('Choose distinct full calendar months in YYYY-MM form.');
 for(const evidence of periodEvidence)if(periods.includes(evidence.period)&&(evidence.fullMonth===false||evidence.partial===true||evidence.coverage==='partial'))throw Error('Partial close evidence cannot establish a governed full month: '+evidence.period);
 return [...periods].sort();
}
export function defaultForecastPeriods({latestFullClosePeriod=null,fiscalYearEndMonth=12,year=new Date().getUTCFullYear()}={}){
 if(!Number.isInteger(fiscalYearEndMonth)||fiscalYearEndMonth<1||fiscalYearEndMonth>12)throw Error('Choose a valid fiscal year end month.');
 if(latestFullClosePeriod&&!periodPattern.test(latestFullClosePeriod))throw Error('A full governed close month is required.');
 const start=latestFullClosePeriod?new Date(Date.UTC(Number(latestFullClosePeriod.slice(0,4)),Number(latestFullClosePeriod.slice(5)),1)):new Date(Date.UTC(year,0,1));
 const endYear=start.getUTCMonth()+1>fiscalYearEndMonth?start.getUTCFullYear()+1:start.getUTCFullYear(),end=new Date(Date.UTC(endYear,fiscalYearEndMonth-1,1)),periods=[];
 for(let date=new Date(start);date<=end;date.setUTCMonth(date.getUTCMonth()+1))periods.push(date.toISOString().slice(0,7));return periods;
}
export function varianceFavorability({value,baseline,nature,favorableDirection}={}){
 const variance=subtract(value,baseline),direction=favorableDirection||(['income','contra_income'].includes(nature)?'higher':['expense','capital','debt','below_noi'].includes(nature)?'lower':null);
 return {variance,favorability:variance===null||!direction?'unavailable':variance===0?'neutral':(direction==='higher'?variance>0:variance<0)?'favorable':'unfavorable'};
}
// A selector consumes server readback evidence, never publication timestamp ordering.
export function selectForecastBaseline({communityId,periods,originalBudget,publications=[],choice='latest_approved_forecast'}={}){
 periods=validateForecastPeriods(periods);
 if(!communityId||!originalBudget||originalBudget.communityId&&originalBudget.communityId!==communityId)throw Error('A canonical community and matching original budget are required.');
 if(!['original_budget','latest_approved_forecast'].includes(choice))throw Error('Choose an original budget or latest approved forecast.');
 const selected=[],missing=[];
 for(const period of periods){
  const candidates=publications.filter(row=>row.communityId===communityId&&(row.activePeriods||[]).includes(period)&&row.verified===true&&row.approved===true&&row.locked===true&&row.status!=='reopened'&&row.stale!==true&&row.reconciled!==false&&row.publicationId&&row.contentHash);
  if(candidates.length!==1){missing.push(period);continue;}selected.push({period,publication:candidates[0]});
 }
 const useLatest=choice==='latest_approved_forecast'&&!missing.length;
 const baseline=clone(originalBudget),originalLines=clone(originalBudget.lines||[]);
 baseline.sourceType=useLatest?'approved_reforecast':'original_budget';baseline.originalBudgetLines=originalLines;
 baseline.periodVersions=periods.map(period=>{const p=useLatest?selected.find(row=>row.period===period).publication:null;return {period,sourceType:p?'approved_reforecast':'original_budget',versionId:p?.revisionId||originalBudget.periodVersions?.find(row=>row.period===period)?.versionId||originalBudget.versionId||originalBudget.versionIds?.[0]||null,publicationId:p?.publicationId||null,contentHash:p?.contentHash||originalBudget.contentHash||null};});
 if(useLatest)baseline.lines=selected.flatMap(({period,publication})=>(publication.snapshot?.lines||publication.lines||[]).filter(row=>row.period===period).map(row=>({...clone(row),amount:Object.hasOwn(row,'forecast')?row.forecast:row.amount,baselineLineage:{publicationId:publication.publicationId,contentHash:publication.contentHash,versionId:publication.revisionId||publication.versionId},source:clone(row.source||null)})));
 if(useLatest&&periods.some(period=>!baseline.lines.some(row=>row.period===period)))throw Error('The verified baseline is missing GL detail for a covered month.');
 return freeze({baseline,selected:baseline.sourceType,defaultReason:useLatest?'The active approved and locked forecast covers every selected month and passed server readback.':choice==='original_budget'?'Original approved budget selected explicitly.':'Original approved budget selected because an approved forecast does not have verified coverage for every selected month.',unavailablePeriods:missing});
}
export function validateSunsetDisposition(account){
 if(!account.retiredAfter&&!account.deactivationDate)return [];
 const issues=[];if(!account.retirementReason?.trim())issues.push({code:'sunset_reason',message:'A sunset GL requires a deactivation reason.'});
 if(!account.successorAccountCode&&account.successorDisposition!=='no_successor')issues.push({code:'sunset_disposition',message:'Specify the approved GL for new activity or explicitly choose no successor.'});
 if(account.successorAccountCode===account.accountCode)issues.push({code:'sunset_cycle',message:'A sunset GL cannot be its own successor.'});return issues;
}
export function computeReforecast(input){
 const {communityId,baseline={},actuals={},scenario={},registry={}}=input;
 const periods=validateForecastPeriods(input.periods,{periodEvidence:actuals.closeVersions||[]});
 if(!communityId||!periods.length||periods.some(period=>!periodPattern.test(period)))throw Error('Community identity and explicit reporting periods are required.');
 if(!baseline.versionId&&!baseline.versionIds?.length)throw Error('An immutable original-budget version is required.');
 if(!scenario.versionId||!scenario.driverVersion||!registry.version)throw Error('Scenario, driver and mapping versions are required.');
 const cutoff=actuals.cutoffPeriod||null;
 const notApplicable=new Set(actuals.notApplicablePeriods||[]),controls=new Map((actuals.monthly||[]).map(row=>[row.period,row]));
 if(cutoff&&!periodPattern.test(cutoff))throw Error('Invalid actual close cutoff period.');
 const diagnostics=[],issue=(code,message,extra={},severity='blocking')=>diagnostics.push({code,message,severity,...extra});
 if(scenario.governanceSchemaVersion===2)diagnostics.push(...validatePlanningCalendar(scenario.calendar,periods,scenario.calendar?.scenario===scenario.name?scenario.name:scenario.importMapping?.sourceScenario).map(d=>({...d,severity:'blocking'})));
 const accounts=new Map();
 for(const item of registry.accounts||[]){const key=String(item.accountCode||'');if(!key||accounts.has(key))throw Error('The account registry requires unique canonical account codes.');accounts.set(key,item);}
 const sourceMap=(values,label)=>{const result=new Map();for(const row of values||[]){const accountCode=String(row.accountCode??row.glCode??'');if(!periods.includes(row.period))continue;const key=compound(row.period,accountCode);if(result.has(key))throw Error(`${label} has duplicate community/period/account rows: ${key}`);if(row.communityId&&row.communityId!==communityId)throw Error(`${label} belongs to another community.`);result.set(key,row);}return result;};
 const budgets=sourceMap(baseline.lines,'Selected baseline'),originalBudgets=sourceMap(baseline.originalBudgetLines||baseline.lines,'Original budget'),closed=sourceMap(actuals.lines,'Actual ledger'),inherited=sourceMap(input.inheritedLines||baseline.inheritedLines,'Inherited locked baseline');
 const lockedPeriods=new Set(input.lockedPeriods||baseline.lockedPeriods||[]);
 const closes=new Map((actuals.closeVersions||[]).map(row=>[row.period,row.versionId]));
 const hasControls=period=>{const row=controls.get(period);return row?.source==='governed_close_controls'&&row.closeVersionId===closes.get(period)&&['revenue','opex','noi'].every(key=>finite(row[key]));};
 const codes=[...new Set([...accounts.keys(),...[...budgets.values(),...closed.values()].map(row=>String(row.accountCode??row.glCode))])].sort();
 for(const driver of [...(scenario.drivers||[]),...(scenario.overrides||[]).map(row=>({accountCodes:[row.accountCode]}))])for(const code of driver.accountCodes||registry.driverMappings?.[driver.type]||[])if(!codes.includes(String(code)))codes.push(String(code));
 codes.sort();
 const lines=[],byKey=new Map();
 for(const period of periods){
  const isClosed=Boolean(cutoff&&period<=cutoff&&!notApplicable.has(period)),closeVersionId=closes.get(period)||null;
  if(isClosed&&!closeVersionId)issue('missing_close','A historical reporting month has no governed close version.',{period});
  for(const accountCode of codes){
   const key=compound(period,accountCode),budget=budgets.get(key),actual=closed.get(key),mapping=accounts.get(accountCode);
   const active=Boolean(mapping&&(!mapping.effectiveFrom||mapping.effectiveFrom<=period)&&(!mapping.retiredAfter||mapping.retiredAfter>=period));
   const retired=Boolean(!isClosed&&mapping?.retiredAfter&&mapping.retiredAfter<period);
   if(!active&&!budget&&!actual&&!retired)continue;
   const mappingValid=(active||retired)&&validNature.has(mapping.nature)&&['above_noi','below_noi'].includes(mapping.placement)&&Boolean(mapping.category);
   // Retired accounts remain immutable evidence in closed periods; the historical classification is retained.
   const historicalValid=isClosed&&mapping&&validNature.has(mapping.nature)&&['above_noi','below_noi'].includes(mapping.placement)&&Boolean(mapping.category);
   if(!notApplicable.has(period)&&!mappingValid&&!historicalValid)issue('account_mapping','An account needs an effective classification and statement placement.',{period,accountCode});
   const closeEvidence=(actuals.closeVersions||[]).find(item=>item.period===period),eligibleClose=closeEvidence&&closeEvidence.status!=='reopened'&&closeEvidence.fullMonth!==false&&closeEvidence.partial!==true&&closeEvidence.stale!==true;
   const actualAmount=isClosed&&closeVersionId&&eligibleClose?amount(actual?.amount):null;
   if(isClosed&&actualAmount===null)issue('missing_actual','Closed-period GL evidence is unavailable; original budget is not an actual.',{period,accountCode},hasControls(period)?'advisory':'blocking');
   const originalBudget=amount(originalBudgets.get(key)?.amount),selectedBaseline=amount(budget?.amount),inheritedLine=inherited.get(key),immutable=lockedPeriods.has(period);
   if(immutable&&!inheritedLine)issue('missing_locked_inheritance','A locked month requires its exact baseline and lineage.',{period,accountCode});
   const row={period,accountCode,identifier:['income','contra_income','expense','capital'].includes(mapping?.identifier||mapping?.nature)?mapping.identifier||mapping.nature:['debt','below_noi'].includes(mapping?.nature)?'expense':null,accountRole:mapping?.accountRole||(mapping?.isDebt?'debt':['debt','below_noi'].includes(mapping?.nature)?mapping.nature:null),isDebt:mapping?.isDebt===true||mapping?.nature==='debt',noncontrollable:mapping?.noncontrollable===true,intercompany:mapping?.intercompany===true,accountName:mapping?.name||budget?.accountName||actual?.accountName||accountCode,originalBudget,selectedBaseline,baselineLineage:clone(budget?.baselineLineage||baseline.periodVersions?.find(item=>item.period===period)||{sourceType:baseline.sourceType||'original_budget',versionId:baseline.versionId||baseline.versionIds?.[0]||null}),actual:actualAmount,forecast:notApplicable.has(period)?null:immutable?amount(inheritedLine&&Object.hasOwn(inheritedLine,'forecast')?inheritedLine.forecast:inheritedLine?.amount):isClosed?actualAmount:retired?0:selectedBaseline,sourceKind:notApplicable.has(period)?'not_applicable':immutable?'inherited_locked':isClosed?'closed_actual':'forecast',immutable,inheritedDetail:immutable?clone(inheritedLine||null):null,historyEligible:Boolean(isClosed&&eligibleClose),sourceHash:closeEvidence?.sourceHash||actual?.source?.hash||null,retired,applicable:!notApplicable.has(period),closeVersionId:isClosed?closeVersionId:null,category:mapping?.category||null,nature:mapping?.nature||null,placement:mapping?.placement||null,mappingValid:Boolean(mappingValid||historicalValid),driverIds:[],driverSources:[],source:clone((isClosed?actual:budget)?.source||null)};
   if(immutable&&inheritedLine){for(const field of ['originalBudget','selectedBaseline','baselineLineage','source','nature','identifier','accountRole','isDebt','intercompany','noncontrollable','placement','category','mappingValid','driverIds','driverSources'])if(Object.hasOwn(inheritedLine,field))row[field]=clone(inheritedLine[field]);row.source=clone(inheritedLine.source||null);}
   const importedMappings=[scenario.importMapping,...(scenario.importHistory||[]).map(entry=>entry.mapping)].filter(Boolean),reviewedAbsence=importedMappings.filter(review=>review.periods?.includes(period)).flatMap(review=>review.accountMappings||[]).find(item=>item.accountCode===accountCode&&item.baselineDisposition?.kind==='no_original_budget_row'&&item.baselineDisposition.confirmed===true)?.baselineDisposition;
   if(originalBudget===null&&!originalBudgets.has(key)&&(reviewedAbsence||budget?.baselineDisposition?.kind==='no_original_budget_row'))row.baselineDisposition=clone(reviewedAbsence||budget.baselineDisposition);
   if(originalBudget===null&&!originalBudgets.has(key)&&!row.baselineDisposition){const savedStream=scenario.strStreams?.find(stream=>stream.type==='saved_json_monthly_programme'),receipt=input.savedStrSourceReceipts?.find(item=>item.source_receipt_id===savedStream?.sourceReceiptId&&item.status==='approved'),cell=receipt?.review?.cells?.find(item=>item.period===period&&item.accountCode===accountCode&&item.parentDisposition==='no_parent_publication_row');if(cell&&!budgets.has(key))row.baselineDisposition={kind:'no_original_budget_row',confirmed:true,reviewedBy:receipt.actor_id,reviewedAt:receipt.review.reviewedAt,reason:receipt.review.reason,originalBudgetVersionIds:clone(baseline.versionIds||[]),parentDisposition:'no_parent_publication_row',sourceReceiptId:receipt.source_receipt_id};}
   lines.push(row);byKey.set(key,row);
  }
 }
 const driverImpacts=[];
 if(!(scenario.drivers||[]).length&&!(scenario.overrides||[]).length)issue('no_driver_changes','This draft has no accepted drivers or overrides; open-period amounts equal the original budget.',{},'advisory');
 for(const [index,driver] of (scenario.drivers||[]).entries()){
  const id=driver.id||`driver-${index+1}`,targets=[...new Set((driver.accountCodes||registry.driverMappings?.[driver.type]||[]).map(String))];
  const targetPeriods=[...new Set(driver.periods||periods)].filter(period=>periods.includes(period));
  const impact={id,type:driver.type||'',operation:driver.operation,value:driver.value,source:driver.source||null,reason:driver.reason||'',changed:[],skippedClosed:[],unavailable:[],status:'no_impact',explanation:''};
  if(!targets.length){issue('unmapped_driver','The driver has no reviewed applicable account mapping.',{driverId:id});impact.explanation='No reviewed applicable account mapping.';impact.status='unavailable';driverImpacts.push(impact);continue;}
  if(!DRIVER_OPERATIONS.includes(driver.operation)||!finite(driver.value)||(driver.operation==='occupancy_vacancy'&&(driver.value<0||driver.value>1))){issue('invalid_driver','The driver operation or numeric value is invalid.',{driverId:id});impact.status='unavailable';impact.explanation='Invalid driver operation or value.';driverImpacts.push(impact);continue;}
  for(const period of targetPeriods)for(const accountCode of targets){
   const row=byKey.get(compound(period,accountCode));
   if(lockedPeriods.has(period)||notApplicable.has(period)||(cutoff&&period<=cutoff)){impact.skippedClosed.push({period,accountCode});continue;}
   if(row?.retired){impact.skippedClosed.push({period,accountCode,reason:'Prospectively retired by reviewed mapping registry'});continue;}
   if(!row?.mappingValid){impact.unavailable.push({period,accountCode,reason:'Missing effective account mapping'});continue;}
   const before=row.forecast,base=driver.baseAccountCode?byKey.get(compound(period,String(driver.baseAccountCode)))?.forecast:null;
   let next=null;
   switch(driver.operation){case 'amount':next=driver.value;break;case 'add':next=finite(before)?before+driver.value:null;break;case 'percent_change':next=finite(before)?before*(1+driver.value):null;break;case 'percent_of_account':next=finite(base)?base*driver.value:null;break;case 'occupancy_vacancy':next=finite(base)?-Math.abs(base)*(1-driver.value):null;break;}
   row.forecast=money(next);row.driverIds.push(id);row.driverSources.push({driverId:id,operation:driver.operation,value:driver.value,source:clone(driver.source||null),reason:driver.reason||''});
   if(row.forecast===null){impact.unavailable.push({period,accountCode,reason:'Missing required source amount'});issue('missing_driver_source','A driver cannot calculate without its source amount.',{driverId:id,period,accountCode});}
   if(before!==row.forecast)impact.changed.push({period,accountCode,before,after:row.forecast,delta:subtract(row.forecast,before)});
  }
  if(impact.unavailable.length){impact.status='unavailable';impact.explanation='One or more applicable periods or account inputs are unavailable.';issue('unavailable_driver','Resolve the driver mapping or missing source before approval.',{driverId:id});}
  else if(impact.changed.length){impact.status='applied';impact.explanation=`Changed ${impact.changed.length} open-period account amount(s).`;}
  else impact.explanation=impact.skippedClosed.length?'All applicable changes are in governed closed periods and were not applied.':!targetPeriods.length?'No driver periods overlap the reporting period.':'Mapped open-period values already equal this driver result.';
  driverImpacts.push(impact);
 }
 for(const [index,override] of (scenario.overrides||[]).entries()){
  const row=byKey.get(compound(override.period,String(override.accountCode)));
  if(!row){issue('invalid_override','The override does not reference a reporting account and period.',{period:override.period,accountCode:override.accountCode});continue;}
  if(row.sourceKind!=='forecast'||row.retired){issue('protected_override','The override was not applied to a closed or non-applicable period.',{period:override.period,accountCode:override.accountCode},'advisory');continue;}
  row.forecast=(override.sourceLineId||override.source?.sourceKind==='saved_json_monthly_programme')&&finite(override.amount)?override.amount:money(override.amount);row.driverIds.push('override-'+index);row.driverSources.push({driverId:'override-'+index,operation:'amount',value:override.amount,source:clone(override.source||null),reason:override.reason||''});
  if(scenario.governanceSchemaVersion===2)diagnostics.push(...planningOverrideIssues(override).map(d=>({...d,severity:'blocking'})));
  if(!override.reason)issue('override_reason','A manual override requires an adjustment reason.',{period:override.period,accountCode:override.accountCode});
 }
 for(const row of lines)if(row.sourceKind==='forecast'&&row.forecast===null)issue('missing_forecast','An open-period original budget or explicit forecast amount is required.',{period:row.period,accountCode:row.accountCode});
 for(const row of lines){const forecastVariance=varianceFavorability({value:row.forecast,baseline:row.selectedBaseline,nature:row.identifier||row.nature}),actualVariance=varianceFavorability({value:row.actual,baseline:row.immutable?row.forecast:row.selectedBaseline,nature:row.identifier||row.nature});row.forecastVariance=forecastVariance.variance;row.forecastFavorability=forecastVariance.favorability;row.actualVariance=actualVariance.variance;row.actualFavorability=actualVariance.favorability;}
 const monthly=periods.map(period=>{
  const rows=lines.filter(row=>row.period===period),isClosed=Boolean(cutoff&&period<=cutoff&&!notApplicable.has(period));
  let actualMetrics=isClosed?aggregate(rows,'actual'):emptyMetrics();
  const control=controls.get(period);
  if(isClosed&&control?.source==='governed_close_controls'&&control.closeVersionId===closes.get(period)){
   for(const key of Object.keys(emptyMetrics()))if(Object.hasOwn(control,key))actualMetrics[key]=amount(control[key]);
   if(Object.hasOwn(control,'opex'))actualMetrics.expenses=amount(control.opex);
  }
  return {period,closed:isClosed,applicable:!notApplicable.has(period),closeVersionId:closes.get(period)||null,originalBudget:aggregate(rows,'originalBudget'),selectedBaseline:aggregate(rows,'selectedBaseline'),reforecast:notApplicable.has(period)?emptyMetrics():lockedPeriods.has(period)?aggregate(rows,'forecast'):isClosed?actualMetrics:aggregate(rows,'forecast'),actuals:actualMetrics,detailCoverage:rows.filter(row=>isClosed&&row.actual===null).map(row=>row.accountCode),controlSource:control?.source||null};
 });
 const budgetLeasing=new Map((baseline.leasing||[]).map(row=>[row.period,row])),actualLeasing=new Map((actuals.leasing||[]).map(row=>[row.period,row]));
 const leasing=periods.map(period=>{const isClosed=Boolean(cutoff&&period<=cutoff&&!notApplicable.has(period)),source=isClosed?actualLeasing.get(period):budgetLeasing.get(period);const row={period,sourceKind:notApplicable.has(period)?'not_applicable':isClosed?'closed_actual':'forecast',units:amount(source?.units),occupiedUnits:amount(source?.occupiedUnits),moveIns:amount(source?.moveIns),moveOuts:amount(source?.moveOuts),marketRent:amount(source?.marketRent),source:source?.source||null};for(const driver of scenario.drivers||[])if(!isClosed&&!notApplicable.has(period)&&driver.operation==='occupancy_vacancy'&&(!driver.periods||driver.periods.includes(period))&&finite(driver.value)&&finite(row.units)&&lines.some(line=>line.period===period&&line.mappingValid&&!line.retired&&finite(line.forecast)&&line.driverIds.includes(driver.id||`driver-${(scenario.drivers||[]).indexOf(driver)+1}`)))row.occupiedUnits=row.units*driver.value;row.occupancy=finite(row.units)&&row.units>0&&finite(row.occupiedUnits)?row.occupiedUnits/row.units:null;return row;});
 const categories=[...new Set(lines.map(row=>row.category))].filter(Boolean).sort().map(category=>({category,monthly:periods.map(period=>{const rows=lines.filter(row=>row.period===period&&row.category===category);return {period,originalBudget:strictSum(rows.filter(row=>!(row.originalBudget===null&&row.baselineDisposition?.kind==='no_original_budget_row')).map(row=>row.originalBudget)),forecast:strictSum(rows.map(row=>row.forecast)),actual:cutoff&&period<=cutoff?strictSum(rows.map(row=>row.actual)):null};})}));
 const identity={engineVersion:ENGINE_VERSION,communityId,periods,baselineVersionId:baseline.versionId||null,baselineVersionIds:baseline.versionIds||[],baselineSourceType:baseline.sourceType||'original_budget',baselinePeriodVersions:clone(baseline.periodVersions||[]),priorPublicationIds:[...new Set((baseline.periodVersions||[]).map(row=>row.publicationId).filter(Boolean))],lockedPeriods:[...lockedPeriods].sort(),sourceHashes:clone(input.sourceHashes||[]),actualCloseVersions:(actuals.closeVersions||[]).filter(row=>periods.includes(row.period)).slice().sort((a,b)=>a.period.localeCompare(b.period)),actualCutoff:cutoff,reforecastVersion:scenario.versionId,driverVersion:scenario.driverVersion,mappingRegistryVersion:registry.version};
 const totalMetrics=(kind,selected=monthly.filter(row=>row.applicable))=>{const result=Object.fromEntries(Object.keys(emptyMetrics()).map(key=>[key,strictSum(selected.map(row=>row[kind][key]))]));result.margin=finite(result.revenue)&&result.revenue!==0&&finite(result.noi)?result.noi/result.revenue:null;return result;};
 const totals={originalBudget:totalMetrics('originalBudget',monthly),...(baseline.sourceType?{selectedBaseline:totalMetrics('selectedBaseline',monthly)}:{}),reforecast:totalMetrics('reforecast'),actuals:monthly.filter(row=>row.applicable).every(row=>row.closed)?totalMetrics('actuals'):emptyMetrics(),actualsThroughCutoff:monthly.some(row=>row.closed)?totalMetrics('actuals',monthly.filter(row=>row.closed)):emptyMetrics()};
 if(Array.isArray(input.recommendationHistory))identity.recommendationHistoryFingerprint=fingerprint(input.recommendationHistory);
 const result={identity,fingerprint:fingerprint({identity,baseline:[...budgets.values()].sort((a,b)=>compound(a.period,a.accountCode??a.glCode).localeCompare(compound(b.period,b.accountCode??b.glCode))),originalBudget:[...originalBudgets.values()],inheritedLines:[...inherited.values()],actuals:[...closed.values()].sort((a,b)=>compound(a.period,a.accountCode??a.glCode).localeCompare(compound(b.period,b.accountCode??b.glCode))),leasing:{baseline:baseline.leasing||[],actuals:actuals.leasing||[]},drivers:scenario.drivers||[],overrides:scenario.overrides||[],actualControls:actuals.monthly||[],notApplicablePeriods:actuals.notApplicablePeriods||[],registry}),status:diagnostics.some(row=>row.severity==='blocking')?'action_required':'ready',lines,monthly,totals,leasing,categories,driverImpacts,diagnostics};
 result.sunsetRelationships=(registry.accounts||[]).filter(row=>row.retiredAfter&&row.successorAccountCode&&validateSunsetDisposition(row).length===0&&accounts.has(row.successorAccountCode)).map(row=>({accountCode:row.accountCode,successorAccountCode:row.successorAccountCode,retiredAfter:row.retiredAfter,reason:row.retirementReason,mappingRegistryVersion:registry.version,approved:true}));
 if(Array.isArray(input.recommendationHistory))result.recommendationHistory=clone(input.recommendationHistory);
 result.recommendations=recommendReforecast({snapshot:result});result.recommendationAvailability=recommendationAvailability(result);
 return freeze(result);
}

function recommendationHistoryLines(snapshot){
 const rows=snapshot.lines.filter(row=>(row.sourceKind==='closed_actual'||row.sourceKind==='inherited_locked'&&row.historyEligible===true&&row.sourceHash)&&row.closeVersionId&&row.historyEligible!==false&&!row.retired).map(clone);
 for(const month of snapshot.recommendationHistory||[]){
  const baseline=month.baseline;
  if(month.status!=='available'||month.eligible!==true||!month.closeVersionId||!month.sourceHash||baseline?.status!=='available'||baseline.period!==month.period||baseline.verified!==true||baseline.approved!==true||baseline.locked!==true||!['original_budget','approved_reforecast'].includes(baseline.sourceType)||baseline.sourceType==='approved_reforecast'&&!baseline.publicationId||!baseline.versionId||!baseline.contentHash)continue;
  for(const line of month.lines||[]){const matches=baseline.lines?.filter(row=>row.accountCode===line.accountCode);if(line.closeVersionId!==month.closeVersionId||matches?.length!==1||!finite(line.actual)||!finite(matches[0].amount))continue;
   rows.push({period:month.period,accountCode:line.accountCode,actual:line.actual,selectedBaseline:matches[0].amount,closeVersionId:month.closeVersionId,sourceHash:month.sourceHash,sourceKind:'governed_history',historyEligible:true,baselineLineage:{sourceType:baseline.sourceType,versionId:baseline.versionId,publicationId:baseline.publicationId||null,contentHash:baseline.contentHash}});
  }
 }
 const grouped=new Map();for(const row of rows){const key=row.period+'|'+row.accountCode;grouped.set(key,[...(grouped.get(key)||[]),row]);}
 return [...grouped.values()].flatMap(matches=>matches.every(row=>row.closeVersionId===matches[0].closeVersionId&&row.actual===matches[0].actual&&selectedAmount(row)===selectedAmount(matches[0]))?[matches.find(row=>row.sourceKind==='governed_history')||matches[0]]:[]).filter(row=>finite(row.actual)&&finite(selectedAmount(row))&&selectedAmount(row)!==0&&row.partial!==true&&row.closeStatus!=='reopened'&&row.sourceType!=='forecast'&&row.stale!==true);
}
export function recommendReforecast({snapshot,minClosedPeriods=3,weights={},minimumChange=.05,maximumChange=1}){
 const recommendations=[],history=recommendationHistoryLines(snapshot),cutoff=snapshot.identity.actualCutoff||history.map(row=>row.period).sort().at(-1)||null;
 for(const accountCode of [...new Set(snapshot.lines.map(row=>row.accountCode))]){
  const predecessors=(snapshot.sunsetRelationships||[]).filter(row=>row.successorAccountCode===accountCode&&row.approved&&row.mappingRegistryVersion===snapshot.identity.mappingRegistryVersion&&snapshot.lines.filter(line=>line.accountCode===accountCode&&line.sourceKind==='forecast').every(line=>line.period>row.retiredAfter)),historyCodes=new Set([accountCode,...predecessors.map(row=>row.accountCode)]);
  const eligible=history.filter(row=>historyCodes.has(row.accountCode)),open=snapshot.lines.filter(row=>row.accountCode===accountCode&&row.sourceKind==='forecast'&&!row.retired);
  if(eligible.length<minClosedPeriods||!open.length||open.some(row=>row.driverIds?.includes('historical-'+accountCode))||open.some(row=>!finite(selectedAmount(row))))continue;
  const observations=[...new Set(eligible.map(row=>row.period))].sort().map((period,index)=>{const rows=eligible.filter(row=>row.period===period),sourceRows=rows.map(row=>({accountCode:row.accountCode,actual:row.actual,baseline:selectedAmount(row),baselineLineage:row.baselineLineage||null,versionId:row.closeVersionId,sourceHash:row.sourceHash||null}));return {period,accountCode:rows.length===1?rows[0].accountCode:null,accountCodes:rows.map(row=>row.accountCode),sourceRows,versionId:rows[0].closeVersionId,sourceHash:rows[0].sourceHash||null,actual:strictSum(rows.map(row=>row.actual)),baseline:strictSum(rows.map(selectedAmount)),weight:weights[period]??index+1};}).filter(row=>finite(row.weight)&&row.weight>0&&finite(row.actual)&&finite(row.baseline)&&row.baseline!==0);
  if(observations.length<minClosedPeriods)continue;
  const totalWeight=observations.reduce((sum,row)=>sum+row.weight,0),rate=observations.reduce((sum,row)=>sum+(row.actual/row.baseline-1)*row.weight,0)/totalWeight;
  if(!finite(rate)||Math.abs(rate)<minimumChange||Math.abs(rate)>maximumChange)continue;
  const forecast=strictSum(open.map(row=>row.forecast)),impact=money(forecast*rate),periods=open.map(row=>row.period),evidence={method:'weighted_actual_to_selected_baseline',sampleCount:observations.length,totalWeight,observations,seasonality:'selected_baseline_monthly_curve',successorRelationships:predecessors};
  recommendations.push({id:fingerprint({accountCode,rate,periods,evidence,baselinePeriodVersions:snapshot.identity.baselinePeriodVersions,baselineVersionIds:snapshot.identity.baselineVersionIds,mappingRegistryVersion:snapshot.identity.mappingRegistryVersion}),status:'proposed',accountCodes:[accountCode],periods,proposedValue:rate,operation:'percent_change',impact:{forecast:impact},source:snapshot.fingerprint,sourceCloseVersions:observations.map(row=>({period:row.period,versionId:row.versionId})),evidence,cutoff,confidence:observations.length>=6?'medium':'low',confidenceReason:observations.length+' eligible governed full months; weighted observations retain the selected baseline monthly curve.',reason:'Weighted governed actuals differ from their selected baseline. Review timing and one-time items before acceptance.',driver:{id:'historical-'+accountCode,type:'historical_weighted_blend',operation:'percent_change',accountCodes:[accountCode],periods,value:rate,source:snapshot.fingerprint,evidence,reason:'Explicitly accepted weighted governed history suggestion'}});
 }
 return freeze(recommendations);
}
export function recommendationAvailability(snapshot,{minClosedPeriods=3}={}){
 const history=recommendationHistoryLines(snapshot);return [...new Set(snapshot.lines.map(row=>row.accountCode))].map(accountCode=>{const predecessors=(snapshot.sunsetRelationships||[]).filter(row=>row.successorAccountCode===accountCode&&row.approved&&row.mappingRegistryVersion===snapshot.identity.mappingRegistryVersion).map(row=>row.accountCode),codes=new Set([accountCode,...predecessors]),eligible=new Set(history.filter(row=>codes.has(row.accountCode)).map(row=>row.period));return {accountCode,status:eligible.size>=minClosedPeriods?'eligible':'unavailable',reason:eligible.size>=minClosedPeriods?null:'insufficient_history',sampleCount:eligible.size,requiredCount:minClosedPeriods};});
}
export function applyRecommendations(scenario,recommendations,{ids,action='accept',actor,timestamp,versionId,driverVersion}={}){
 if(!actor||!timestamp||!versionId||!driverVersion||!['accept','reject'].includes(action))throw Error('Explicit action, actor, timestamp and new versions are required.');
 const selected=recommendations.filter(row=>ids?.includes(row.id));if(selected.length!==(new Set(ids||[])).size)throw Error('Select existing recommendation IDs explicitly.');
 const next=clone(scenario),before=clone(scenario.drivers||[]),beforeDecisions=clone(scenario.suggestionDecisions||[]);next.drivers=clone(before);next.suggestionDecisions=clone(beforeDecisions);
 for(const suggestion of selected)if(action==='accept'){if(next.drivers.some(driver=>driver.recommendationId===suggestion.id))throw Error('This recommendation was already accepted.');next.drivers.push({...clone(suggestion.driver),recommendationId:suggestion.id});}
 for(const suggestion of selected)next.suggestionDecisions.push({id:suggestion.id,status:action==='accept'?'accepted':'rejected',actor,timestamp,reason:scenario.reason||'Explicit user decision',source:suggestion.source,cutoff:suggestion.cutoff});
 next.versionId=versionId;next.driverVersion=driverVersion;next.history=[...(next.history||[]),{action,actor,timestamp,recommendationIds:selected.map(row=>row.id),before,after:clone(next.drivers),beforeDecisions,afterDecisions:clone(next.suggestionDecisions)}];return next;
}
export function undoRecommendationAction(scenario,{actor,timestamp,versionId,driverVersion}={}){
 const event=scenario.history?.at(-1);if(!event||!actor||!timestamp||!versionId||!driverVersion)throw Error('An existing action and explicit undo metadata are required.');
 if(stableStringify(scenario.drivers||[])!==stableStringify(event.after))throw Error('Drivers changed after this action; review the changes before undoing.');
 return {...clone(scenario),versionId,driverVersion,drivers:clone(event.before),suggestionDecisions:clone(event.beforeDecisions||scenario.suggestionDecisions||[]),history:[...clone(scenario.history),{action:'undo',actor,timestamp,before:clone(event.after),after:clone(event.before),beforeDecisions:clone(scenario.suggestionDecisions||[]),afterDecisions:clone(event.beforeDecisions||scenario.suggestionDecisions||[]),undoes:event.timestamp}]};
}
