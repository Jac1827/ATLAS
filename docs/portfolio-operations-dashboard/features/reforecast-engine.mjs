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
function aggregate(lines,field){
 const selected=predicate=>lines.filter(predicate).map(row=>row[field]);
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
export function computeReforecast(input){
 const {communityId,baseline={},actuals={},scenario={},registry={}}=input;
 const periods=[...new Set(input.periods||[])].sort();
 if(!communityId||!periods.length||periods.some(period=>!periodPattern.test(period)))throw Error('Community identity and explicit reporting periods are required.');
 if(!baseline.versionId&&!baseline.versionIds?.length)throw Error('An immutable original-budget version is required.');
 if(!scenario.versionId||!scenario.driverVersion||!registry.version)throw Error('Scenario, driver and mapping versions are required.');
 const cutoff=actuals.cutoffPeriod||null;
 const notApplicable=new Set(actuals.notApplicablePeriods||[]),controls=new Map((actuals.monthly||[]).map(row=>[row.period,row]));
 if(cutoff&&!periodPattern.test(cutoff))throw Error('Invalid actual close cutoff period.');
 const diagnostics=[],issue=(code,message,extra={},severity='blocking')=>diagnostics.push({code,message,severity,...extra});
 const accounts=new Map();
 for(const item of registry.accounts||[]){const key=String(item.accountCode||'');if(!key||accounts.has(key))throw Error('The account registry requires unique canonical account codes.');accounts.set(key,item);}
 const sourceMap=(values,label)=>{const result=new Map();for(const row of values||[]){const accountCode=String(row.accountCode??row.glCode??'');if(!periods.includes(row.period))continue;const key=compound(row.period,accountCode);if(result.has(key))throw Error(`${label} has duplicate community/period/account rows: ${key}`);if(row.communityId&&row.communityId!==communityId)throw Error(`${label} belongs to another community.`);result.set(key,row);}return result;};
 const budgets=sourceMap(baseline.lines,'Original budget'),closed=sourceMap(actuals.lines,'Actual ledger');
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
   const actualAmount=isClosed&&closeVersionId?amount(actual?.amount):null;
   if(isClosed&&actualAmount===null)issue('missing_actual','Closed-period GL evidence is unavailable; original budget is not an actual.',{period,accountCode},hasControls(period)?'advisory':'blocking');
   const originalBudget=amount(budget?.amount);
   const row={period,accountCode,accountName:mapping?.name||budget?.accountName||actual?.accountName||accountCode,originalBudget,actual:actualAmount,forecast:notApplicable.has(period)?null:isClosed?actualAmount:retired?0:originalBudget,sourceKind:notApplicable.has(period)?'not_applicable':isClosed?'closed_actual':'forecast',retired,applicable:!notApplicable.has(period),closeVersionId:isClosed?closeVersionId:null,category:mapping?.category||null,nature:mapping?.nature||null,placement:mapping?.placement||null,mappingValid:Boolean(mappingValid||historicalValid),driverIds:[],driverSources:[],source:clone((isClosed?actual:budget)?.source||null)};
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
   if(notApplicable.has(period)||(cutoff&&period<=cutoff)){impact.skippedClosed.push({period,accountCode});continue;}
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
  row.forecast=money(override.amount);row.driverIds.push('override-'+index);row.driverSources.push({driverId:'override-'+index,operation:'amount',value:override.amount,source:clone(override.source||null),reason:override.reason||''});
  if(!override.reason)issue('override_reason','A manual override requires an adjustment reason.',{period:override.period,accountCode:override.accountCode});
 }
 for(const row of lines)if(row.sourceKind==='forecast'&&row.forecast===null)issue('missing_forecast','An open-period original budget or explicit forecast amount is required.',{period:row.period,accountCode:row.accountCode});
 const monthly=periods.map(period=>{
  const rows=lines.filter(row=>row.period===period),isClosed=Boolean(cutoff&&period<=cutoff&&!notApplicable.has(period));
  let actualMetrics=isClosed?aggregate(rows,'actual'):emptyMetrics();
  const control=controls.get(period);
  if(isClosed&&control?.source==='governed_close_controls'&&control.closeVersionId===closes.get(period)){
   for(const key of Object.keys(emptyMetrics()))if(Object.hasOwn(control,key))actualMetrics[key]=amount(control[key]);
   if(Object.hasOwn(control,'opex'))actualMetrics.expenses=amount(control.opex);
  }
  return {period,closed:isClosed,applicable:!notApplicable.has(period),closeVersionId:closes.get(period)||null,originalBudget:aggregate(rows,'originalBudget'),reforecast:notApplicable.has(period)?emptyMetrics():isClosed?actualMetrics:aggregate(rows,'forecast'),actuals:actualMetrics,detailCoverage:rows.filter(row=>isClosed&&row.actual===null).map(row=>row.accountCode),controlSource:control?.source||null};
 });
 const budgetLeasing=new Map((baseline.leasing||[]).map(row=>[row.period,row])),actualLeasing=new Map((actuals.leasing||[]).map(row=>[row.period,row]));
 const leasing=periods.map(period=>{const isClosed=Boolean(cutoff&&period<=cutoff&&!notApplicable.has(period)),source=isClosed?actualLeasing.get(period):budgetLeasing.get(period);const row={period,sourceKind:notApplicable.has(period)?'not_applicable':isClosed?'closed_actual':'forecast',units:amount(source?.units),occupiedUnits:amount(source?.occupiedUnits),moveIns:amount(source?.moveIns),moveOuts:amount(source?.moveOuts),marketRent:amount(source?.marketRent),source:source?.source||null};for(const driver of scenario.drivers||[])if(!isClosed&&!notApplicable.has(period)&&driver.operation==='occupancy_vacancy'&&(!driver.periods||driver.periods.includes(period))&&finite(driver.value)&&finite(row.units)&&lines.some(line=>line.period===period&&line.mappingValid&&!line.retired&&finite(line.forecast)&&line.driverIds.includes(driver.id||`driver-${(scenario.drivers||[]).indexOf(driver)+1}`)))row.occupiedUnits=row.units*driver.value;row.occupancy=finite(row.units)&&row.units>0&&finite(row.occupiedUnits)?row.occupiedUnits/row.units:null;return row;});
 const categories=[...new Set(lines.map(row=>row.category))].filter(Boolean).sort().map(category=>({category,monthly:periods.map(period=>{const rows=lines.filter(row=>row.period===period&&row.category===category);return {period,originalBudget:strictSum(rows.map(row=>row.originalBudget)),forecast:strictSum(rows.map(row=>row.forecast)),actual:cutoff&&period<=cutoff?strictSum(rows.map(row=>row.actual)):null};})}));
 const identity={engineVersion:ENGINE_VERSION,communityId,periods,baselineVersionId:baseline.versionId||null,baselineVersionIds:baseline.versionIds||[],actualCloseVersions:(actuals.closeVersions||[]).filter(row=>periods.includes(row.period)).slice().sort((a,b)=>a.period.localeCompare(b.period)),actualCutoff:cutoff,reforecastVersion:scenario.versionId,driverVersion:scenario.driverVersion,mappingRegistryVersion:registry.version};
 const totalMetrics=(kind,selected=monthly.filter(row=>row.applicable))=>{const result=Object.fromEntries(Object.keys(emptyMetrics()).map(key=>[key,strictSum(selected.map(row=>row[kind][key]))]));result.margin=finite(result.revenue)&&result.revenue!==0&&finite(result.noi)?result.noi/result.revenue:null;return result;};
 const totals={originalBudget:totalMetrics('originalBudget',monthly),reforecast:totalMetrics('reforecast'),actuals:monthly.filter(row=>row.applicable).every(row=>row.closed)?totalMetrics('actuals'):emptyMetrics(),actualsThroughCutoff:monthly.some(row=>row.closed)?totalMetrics('actuals',monthly.filter(row=>row.closed)):emptyMetrics()};
 const result={identity,fingerprint:fingerprint({identity,baseline:[...budgets.values()].sort((a,b)=>compound(a.period,a.accountCode??a.glCode).localeCompare(compound(b.period,b.accountCode??b.glCode))),actuals:[...closed.values()].sort((a,b)=>compound(a.period,a.accountCode??a.glCode).localeCompare(compound(b.period,b.accountCode??b.glCode))),leasing:{baseline:baseline.leasing||[],actuals:actuals.leasing||[]},drivers:scenario.drivers||[],overrides:scenario.overrides||[],actualControls:actuals.monthly||[],notApplicablePeriods:actuals.notApplicablePeriods||[],registry}),status:diagnostics.some(row=>row.severity==='blocking')?'action_required':'ready',lines,monthly,totals,leasing,categories,driverImpacts,diagnostics};
 result.recommendations=recommendReforecast({snapshot:result});
 return freeze(result);
}

export function recommendReforecast({snapshot,minClosedPeriods=2}){
 const recommendations=[],cutoff=snapshot.identity.actualCutoff;
 for(const accountCode of [...new Set(snapshot.lines.map(row=>row.accountCode))]){
  const closed=snapshot.lines.filter(row=>row.accountCode===accountCode&&row.sourceKind==='closed_actual'&&row.closeVersionId),open=snapshot.lines.filter(row=>row.accountCode===accountCode&&row.sourceKind==='forecast');
  if(closed.length<minClosedPeriods||!open.length||open.some(row=>row.driverIds.includes('historical-'+accountCode))||closed.some(row=>!finite(row.actual)||!finite(row.originalBudget))||open.some(row=>!finite(row.forecast)))continue;
  const budget=strictSum(closed.map(row=>row.originalBudget)),actual=strictSum(closed.map(row=>row.actual));
  if(!budget||!finite(actual))continue;
  const rate=actual/budget-1;if(!finite(rate)||Math.abs(rate)<0.05||Math.abs(rate)>1)continue;
  const forecast=strictSum(open.map(row=>row.forecast)),impact=money(forecast*rate),periods=open.map(row=>row.period);
  recommendations.push({id:fingerprint({accountCode,rate,periods,baselineVersionIds:snapshot.identity.baselineVersionIds,mappingRegistryVersion:snapshot.identity.mappingRegistryVersion,closeVersions:closed.map(row=>({period:row.period,versionId:row.closeVersionId}))}),status:'proposed',accountCodes:[accountCode],periods,proposedValue:rate,operation:'percent_change',impact:{forecast:impact},source:snapshot.fingerprint,sourceCloseVersions:closed.map(row=>({period:row.period,versionId:row.closeVersionId})),cutoff,confidence:closed.length>=4?'medium':'low',confidenceReason:closed.length+' governed closed periods; timing, seasonality and one-time items require review.',reason:'Governed actuals differ from the same-period original budget. Review whether this variance is expected to continue.',driver:{id:'historical-'+accountCode,type:'historical_run_rate',operation:'percent_change',accountCodes:[accountCode],periods,value:rate,source:snapshot.fingerprint,reason:'Explicitly accepted historical actual-to-budget run-rate suggestion'}});
 }
 return freeze(recommendations);
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
