import {roundMoney,sumMoney,multiplyMoney,rentDriverMoney} from './budget-money.mjs?v=c2a0e763406c2b63';
import {budgetYearPeriods} from './community-budget-identity.mjs?v=789e1cbad26c5366';

// All rates use fractions except tolerance.percent, which uses percentage points.
// Null means unavailable throughout; an explicit zero remains evidence.
export const BUDGET_DRIVER_TYPES=Object.freeze(['FIXED','VARIABLE','OCCUPANCY-DRIVEN','UNIT-DRIVEN','REVENUE-DRIVEN','MANUAL']);
export const BUDGET_OVERRIDE_REASONS=Object.freeze(['Management Adjustment','Known Contract Change','Market Adjustment','Ownership Direction','One-Time Expense','Known Revenue Change','Accounting Adjustment','Other']);
export const BUDGET_DRIVER_WARNING='This adjustment does not reconcile with the current Leasing Schedule or underlying budget drivers.';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const num=value=>finite(value)?value:null;
const clone=value=>structuredClone(value);
const sum=values=>values.every(finite)?values.reduce((a,b)=>a+b,0):null;
const product=(a,b)=>finite(a)&&finite(b)?a*b:null;
const ratio=(a,b)=>finite(a)&&finite(b)&&b>0?a/b:finite(a)&&a===0&&b===0?0:null;
const subtract=(a,b)=>finite(a)&&finite(b)?a-b:null;
const own=(row,key,fallback)=>Object.hasOwn(row,key)?num(row[key]):fallback;
const problem=(code,message,detail={})=>({code,message,severity:'blocking',...detail});
const periodPattern=/^20\d{2}-(0[1-9]|1[0-2])$/;
export function fiscalBudgetPeriods({year,startMonth=1}={}){
 if(!Number.isInteger(startMonth)||startMonth<1||startMonth>12)throw Error('A fiscal start month from 1 to 12 is required.');
 return budgetYearPeriods(year,{verified:true,startMonth});
}
export function validateBudgetPeriods(periods,{startMonth,annual=false}={}){
 const issues=[];
 if(!Array.isArray(periods)||!periods.length||periods.some(p=>!periodPattern.test(p))||new Set(periods).size!==periods.length)return [problem('fiscal_calendar','Choose distinct complete fiscal months in YYYY-MM format.')];
 for(let i=1;i<periods.length;i++){const previous=periods[i-1],next=new Date(Date.UTC(+previous.slice(0,4),+previous.slice(5),1)).toISOString().slice(0,7);if(periods[i]!==next)issues.push(problem('fiscal_calendar','Fiscal months must be contiguous and ordered.',{period:periods[i]}));}
 if(annual&&(periods.length!==12||startMonth&&Number(periods[0].slice(5))!==startMonth))issues.push(problem('fiscal_calendar','The annual budget must contain 12 months beginning with the community fiscal start month.'));
 return issues;
}
function inputs(periods,monthly){
 const issues=validateBudgetPeriods(periods),byPeriod=new Map();
 for(const row of monthly||[]){if(byPeriod.has(row.period))issues.push(problem('duplicate_leasing_period','The leasing schedule contains duplicate months.',{period:row.period}));byPeriod.set(row.period,row);}
 return {issues,byPeriod};
}
function bounds(issues,row,keys,{min=0,max=Infinity,integer=false}={}){for(const key of keys)if(finite(row[key])&&(row[key]<min||row[key]>max||integer&&!Number.isInteger(row[key])))issues.push(problem('leasing_input_range',key+' is outside its allowed range.',{period:row.period,driver:key}));}
function mismatch(issues,period,key,value,expected){if(finite(value)&&finite(expected)&&Math.abs(value-expected)>0.000001)issues.push(problem('leasing_reconciliation',key+' does not reconcile with the leasing schedule.',{period,driver:key,actual:value,expected}));}
export function calculateLeasingSchedule({periods=[],monthly=[],units=null,beginningOccupiedUnits=null}={}){
 const {issues,byPeriod}=inputs(periods,monthly),rows=[];let previous=beginningOccupiedUnits;
 for(const period of periods){const input=byPeriod.get(period)||{},inventory=own(input,'units',num(units)),beginning=own(input,'beginningOccupiedUnits',num(previous)),moveIns=num(input.moveIns),moveOuts=num(input.moveOuts),calculatedEnding=sum([beginning,moveIns,finite(moveOuts)?-moveOuts:null]),reportedEnding=own(input,'endingOccupiedUnits',num(input.occupiedUnits)),ending=finite(calculatedEnding)?calculatedEnding:reportedEnding;
  mismatch(issues,period,'Ending occupied units',reportedEnding,calculatedEnding);
  if(rows.length)mismatch(issues,period,'Beginning occupied units',beginning,previous);
  const average=finite(beginning)&&finite(ending)?(beginning+ending)/2:own(input,'averageOccupiedUnits',ending),physical=ratio(ending,inventory),budgeted=own(input,'budgetedOccupancy',ratio(average,inventory)),marketRent=num(input.marketRent),growth=own(input,'rentGrowth',0),loss=own(input,'lossToLeasePercent',0),effectiveRent=product(product(marketRent,finite(growth)?1+growth:null),finite(loss)?1-loss:null),rentalIncome=rentDriverMoney(average,marketRent,growth,loss),grossPotentialRent=rentDriverMoney(inventory,marketRent,growth),concessions=Object.hasOwn(input,'concessions')?num(input.concessions):multiplyMoney(moveIns,num(input.concessionPerMoveIn)),badDebt=multiplyMoney(rentalIncome,num(input.badDebtPercent));
  const row={...clone(input),period,units:inventory,beginningOccupiedUnits:beginning,moveIns,moveOuts,endingOccupiedUnits:ending,occupiedUnits:ending,physicalOccupancy:physical,occupancy:physical,leasedUnits:num(input.leasedUnits),leasedOccupancy:ratio(num(input.leasedUnits),inventory),budgetedOccupancy:budgeted,averageOccupiedUnits:average,availableUnits:subtract(inventory,ending),marketRent,effectiveRent,lossToLeasePercent:loss,rentGrowth:growth,newLeaseRent:num(input.newLeaseRent),renewalRent:num(input.renewalRent),renewals:num(input.renewals),grossPotentialRent,rentalIncome,vacancy:rentDriverMoney(subtract(average,inventory),marketRent,growth),concessions,badDebt,netRentalIncome:sumMoney([rentalIncome,finite(concessions)?-Math.abs(concessions):null,finite(badDebt)?-Math.abs(badDebt):null])};
  if(Object.hasOwn(input,'budgetedOccupancy'))mismatch(issues,period,'Budgeted occupancy',num(input.budgetedOccupancy),ratio(average,inventory));
  bounds(issues,row,['units','beginningOccupiedUnits','moveIns','moveOuts','endingOccupiedUnits','leasedUnits','averageOccupiedUnits','availableUnits']);bounds(issues,row,['physicalOccupancy','leasedOccupancy','budgetedOccupancy','lossToLeasePercent','badDebtPercent'],{max:1});
  if(finite(average)&&finite(inventory)&&average>inventory)issues.push(problem('leasing_inventory','Average occupied units exceed inventory.',{period}));
  if(!finite(inventory)||!finite(ending))issues.push(problem('missing_leasing_assumptions','Inventory and occupied units are required to validate this month.',{period}));
  rows.push(row);previous=ending;
 }
 return {schemaVersion:1,kind:'conventional',periods:[...periods],monthly:rows,totals:leasingScheduleTotals(rows,'conventional'),issues};
}
export function calculateStrLeasingSchedule({periods=[],monthly=[],beginningUnits=null,streamId=null,programmeId=null}={}){
 const {issues,byPeriod}=inputs(periods,monthly),rows=[];let previous=num(beginningUnits);
 for(const period of periods){const input=byPeriod.get(period)||{},beginning=own(input,'beginningAvailableUnits',previous),entering=num(input.unitsEntering),leaving=num(input.unitsLeaving),calculatedEnding=sum([beginning,entering,finite(leaving)?-leaving:null]),reportedEnding=own(input,'endingUnits',num(input.availableUnits)),ending=finite(calculatedEnding)?calculatedEnding:reportedEnding,days=new Date(Date.UTC(+period.slice(0,4),+period.slice(5),0)).getUTCDate(),available=product(ending,days),blocked=own(input,'blockedNights',product(available,num(input.blockedPercent))),permitCapped=own(input,'permitCappedNights',0),rentable=subtract(subtract(available,blocked),permitCapped),occupancy=own(input,'budgetedOccupancy',finite(input.occupancyPercent)?input.occupancyPercent/100:null),booked=product(rentable,occupancy),adr=own(input,'adr',num(input.grossPerOccupiedNight)),gross=multiplyMoney(booked,adr),alos=num(input.averageLengthOfStay),stays=ratio(booked,alos),revenue=Object.hasOwn(input,'budgetedRevenue')?num(input.budgetedRevenue):sumMoney([gross,own(input,'otherRevenue',0),finite(input.revenueDeductions)?-input.revenueDeductions:own(input,'revenueDeductions',0)]),expenses=num(input.operatingExpenses),noi=sumMoney([revenue,finite(expenses)?-expenses:null]),displaced=own(input,'conventionalUnitsDisplaced',ending),rentDisplaced=own(input,'conventionalRentDisplaced',multiplyMoney(displaced,num(input.conventionalRentPerUnit))),conventionalNoi=own(input,'conventionalNoi',rentDisplaced);
  mismatch(issues,period,'Ending STR units',reportedEnding,calculatedEnding);if(rows.length)mismatch(issues,period,'Beginning STR units',beginning,previous);
  for(const [key,expected] of Object.entries({availableNights:available,rentableNights:rentable,bookedNights:booked,grossRentalRevenue:gross}))mismatch(issues,period,key,input[key],expected);
  const row={...clone(input),period,beginningAvailableUnits:beginning,unitsEntering:entering,unitsLeaving:leaving,endingUnits:ending,availableUnits:ending,daysInMonth:days,availableNights:available,blockedNights:blocked,permitCappedNights:permitCapped,rentableNights:rentable,budgetedOccupancy:occupancy,bookedNights:booked,occupiedNights:booked,adr,revpar:roundMoney(ratio(gross,available)),stays,checkouts:stays,averageLengthOfStay:alos,grossRentalRevenue:gross,budgetedRevenue:revenue,operatingExpenses:expenses,strNoi:noi,conventionalUnitsDisplaced:displaced,conventionalRentDisplaced:rentDisplaced,conventionalNoi,strUplift:sumMoney([noi,finite(conventionalNoi)?-conventionalNoi:null])};
  bounds(issues,row,['beginningAvailableUnits','unitsEntering','unitsLeaving','endingUnits','availableNights','blockedNights','permitCappedNights','rentableNights','bookedNights','adr','stays','averageLengthOfStay']);bounds(issues,row,['budgetedOccupancy'],{max:1});
  if(finite(booked)&&booked>0&&!(alos>0))issues.push(problem('str_length_of_stay','Average length of stay must be greater than zero when nights are booked.',{period}));
  if([ending,blocked,occupancy,adr].some(value=>!finite(value)))issues.push(problem('missing_str_assumptions','STR inventory, blocked nights, occupancy and ADR are required.',{period}));
  rows.push(row);previous=ending;
 }
 return {schemaVersion:1,kind:'str',streamId,programmeId,periods:[...periods],monthly:rows,totals:leasingScheduleTotals(rows,'str'),issues};
}
export function resolveBudgetDriverAmount({driver={},period,leasing,strLeasing=[],lines=[]}={}){
 const type=driver.type,local=driver.monthly?.find(row=>row.period===period)||{},config={...driver,...local};
 if(!BUDGET_DRIVER_TYPES.includes(type))return null;
 if(type==='MANUAL')return null;
 if(type==='FIXED')return roundMoney(num(config.amount));
 const selected=driver.streamId?strLeasing.find(row=>row.streamId===driver.streamId||row.programmeId===driver.streamId):leasing;
 const row=selected?.monthly?.find(row=>row.period===period),metric=driver.metric||(type==='OCCUPANCY-DRIVEN'?'averageOccupiedUnits':type==='UNIT-DRIVEN'?'units':null);
 const volume=type==='REVENUE-DRIVEN'&&driver.baseAccountCode?num(lines.find(line=>line.period===period&&line.accountCode===driver.baseAccountCode)?.forecast):num(row?.[metric]);
 const direct=['rentalIncome','grossPotentialRent','vacancy','concessions','badDebt','netRentalIncome','grossRentalRevenue','budgetedRevenue','strNoi','strUplift'].includes(metric)&&!Object.hasOwn(config,'rate');
 return direct?roundMoney(volume):sumMoney([own(config,'baseAmount',0),multiplyMoney(volume,num(config.rate))]);
}
export function resolveBudgetTolerance(settings={},line={}){return {...{dollar:100,percent:5,operator:'or'},...(settings.default||{}),...(settings.categories?.[line.category]||{}),...(settings.accounts?.[line.accountCode]||{})};}
export function createBudgetDriverOverride({reason,comment='',userId,timestamp=new Date().toISOString(),calculatedAmount,manualAmount,affectedDrivers=[]}={}){
 if(!BUDGET_OVERRIDE_REASONS.includes(reason)||!userId||!Number.isFinite(Date.parse(timestamp))||!finite(calculatedAmount)||!finite(manualAmount)||reason==='Other'&&!String(comment).trim())throw Error('Choose an override reason and retain its user, timestamp and amounts. Other requires a written explanation.');
 return {schemaVersion:1,reason,comment:String(comment).trim(),userId,timestamp,calculatedAmount,manualAmount,affectedDrivers:[...affectedDrivers]};
}
export function validateBudgetDriverAdjustment({calculatedAmount,manualAmount,tolerance={},drivers=[],override=null}={}){
 const expected=num(calculatedAmount),manual=num(manualAmount),variance=finite(expected)&&finite(manual)?sumMoney([manual,-expected]):null,percent=finite(variance)&&expected!==0?Math.abs(variance/expected)*100:variance===0?0:null,rule={dollar:100,percent:5,operator:'or',...tolerance},checks=[];
 if(finite(rule.dollar)&&rule.dollar>=0)checks.push(finite(variance)&&Math.abs(variance)>rule.dollar);
 if(finite(rule.percent)&&rule.percent>=0)checks.push(finite(variance)&&(expected===0?variance!==0:percent>rule.percent));
 const material=checks.length>0&&(rule.operator==='and'?checks.every(Boolean):checks.some(Boolean));
 let accepted=false;
 if(override)try{const evidence=createBudgetDriverOverride(override);accepted=evidence.calculatedAmount===expected&&evidence.manualAmount===manual&&JSON.stringify([...evidence.affectedDrivers].sort())===JSON.stringify([...drivers].sort());}catch{}
 return {title:'BUDGET DRIVER WARNING',message:BUDGET_DRIVER_WARNING,currentCalculatedAmount:expected,manualAmount:manual,expectedAmount:expected,varianceAmount:variance,variancePercent:percent,affectedDrivers:[...drivers],tolerance:rule,material,overrideAccepted:accepted,missingAssumptions:expected===null,warning:material&&!accepted,override:accepted?clone(override):null};
}
export function buildBudgetDriverIntegrity({snapshot={},scenario={},tolerances={}}={}){
 const checks=[],warnings=[],issues=[],overrides=[];
 for(const line of snapshot.lines||[]){if(line.immutable||line.sourceKind!=='forecast'||line.retired)continue;
  if(!Object.hasOwn(line,'driverCalculatedAmount'))continue;
  const adjustment=(scenario.overrides||[]).find(row=>row.period===line.period&&String(row.accountCode)===String(line.accountCode)),drivers=line.budgetDriverIds||[];
  const check={period:line.period,accountCode:line.accountCode,category:line.category,...validateBudgetDriverAdjustment({calculatedAmount:line.driverCalculatedAmount,manualAmount:line.forecast,tolerance:resolveBudgetTolerance(tolerances,line),drivers,override:adjustment?.driverOverride})};checks.push(check);
  if(check.missingAssumptions)issues.push(problem('missing_driver_assumptions','A configured account driver is missing a required leasing or rate assumption.',{period:line.period,accountCode:line.accountCode}));
  if(check.warning){warnings.push(check);issues.push(problem('budget_driver_mismatch',BUDGET_DRIVER_WARNING,{...check}));}
  if(check.overrideAccepted)overrides.push({period:line.period,accountCode:line.accountCode,...check.override});
 }
 return {schemaVersion:1,checks,warnings,issues,overrides,reconciled:issues.length===0};
}

// Translate operating links into the engine's existing amount-driver operation.
// Browser, review UI and server payload retain the same cent-rounded amounts.
export function prepareBudgetLeasingDrivers({scenario={},baseline={},actuals={},periods=[],lockedPeriods=[],registry={}}={}){
 const sourceRows=new Map((baseline.leasing||[]).map(row=>[row.period,row])),actualRows=new Map((actuals.leasing||[]).map(row=>[row.period,row])),configured=new Map((scenario.leasingSchedule?.monthly||[]).map(row=>[row.period,row])),protectedPeriods=new Set(lockedPeriods),cutoff=actuals.cutoffPeriod||actuals.latestFullClosePeriod;
 const monthly=periods.map(period=>{const closed=protectedPeriods.has(period)||cutoff&&period<=cutoff,row={...(closed?actualRows.get(period)||sourceRows.get(period):sourceRows.get(period)),...(!closed?configured.get(period):{}),period};
  for(const driver of scenario.drivers||[])if(!closed&&driver.operation==='occupancy_vacancy'&&(!driver.periods||driver.periods.includes(period))&&finite(row.units)&&finite(driver.value))row.occupiedUnits=row.units*driver.value;
  return row;
 });
 const leasingSchedule=calculateLeasingSchedule({periods,monthly,units:scenario.leasingSchedule?.units,beginningOccupiedUnits:scenario.leasingSchedule?.beginningOccupiedUnits}),strLeasingSchedules=retainedStrLeasingSchedules({scenario,periods});
 const issues=[...(scenario.leasingSchedule?leasingSchedule.issues:[]),...strLeasingSchedules.flatMap(row=>row.issues)],accountDrivers=scenario.accountDrivers||[],pending=[...accountDrivers],resolved=[],amounts=[],lines=(baseline.lines||[]).map(line=>({...line,forecast:line.amount})),seen=new Set();
 while(pending.length){const index=pending.findIndex(driver=>!driver.baseAccountCode||!pending.some(other=>other.accountCode===driver.baseAccountCode));if(index<0){issues.push(problem('driver_dependency_cycle','Account driver references contain a cycle.'));break;}const driver=pending.splice(index,1)[0],id=driver.id||driver.accountCode;
  if(!BUDGET_DRIVER_TYPES.includes(driver.type)){issues.push(problem('driver_type','Choose a supported budget driver type.',{accountCode:driver.accountCode}));continue;}
  if(driver.type==='MANUAL')continue;
  for(const period of driver.periods||periods){if(!periods.includes(period)||protectedPeriods.has(period)||cutoff&&period<=cutoff)continue;
   const key=period+'|'+driver.accountCode;if(seen.has(key)){issues.push(problem('duplicate_account_driver','Only one operating driver may set an account in a month.',{period,accountCode:driver.accountCode}));continue;}seen.add(key);
   const amount=resolveBudgetDriverAmount({driver,period,leasing:leasingSchedule,strLeasing:strLeasingSchedules,lines});amounts.push({period,accountCode:String(driver.accountCode),amount,driverId:id,type:driver.type,metric:driver.metric||(driver.type==='OCCUPANCY-DRIVEN'?'averageOccupiedUnits':driver.type==='UNIT-DRIVEN'?'units':null)});
   const target=lines.find(row=>row.period===period&&String(row.accountCode)===String(driver.accountCode));if(target)target.forecast=amount;else lines.push({period,accountCode:String(driver.accountCode),forecast:amount});
   if(!finite(amount)){issues.push(problem('missing_driver_assumptions','A configured account driver is missing a required leasing or rate assumption.',{period,accountCode:String(driver.accountCode),driverId:id}));continue;}
   resolved.push({id:'budget-schedule-'+id+'-'+period,type:'leasing_schedule',operation:'amount',accountCodes:[String(driver.accountCode)],periods:[period],value:amount,reason:driver.reason||'Calculated from the reviewed leasing schedule',ownerId:driver.ownerId||scenario.ownerId,reviewedAt:driver.reviewedAt,source:{kind:'leasing_schedule',driverId:id,driverType:driver.type,metric:driver.metric,period}});
  }
 }
 return {scenario:{...clone(scenario),drivers:[...(scenario.drivers||[]).filter(row=>!Array.isArray(scenario.accountDrivers)||row.source?.kind!=='leasing_schedule'),...resolved]},leasingSchedule,strLeasingSchedules,amounts,issues};
}

export function leasingScheduleTotals(rows=[],kind='conventional'){
 const total=key=>sum(rows.map(row=>num(row[key]))),moneyTotal=key=>sumMoney(rows.map(row=>num(row[key]))),out={};
 const stocks=kind==='str'?['beginningAvailableUnits','endingUnits','availableUnits','conventionalUnitsDisplaced']:['units','beginningOccupiedUnits','endingOccupiedUnits','occupiedUnits','leasedUnits','availableUnits'];
 for(const key of stocks)out[key]=num((key.startsWith('beginning')?rows[0]:rows.at(-1))?.[key]);
 const flows=kind==='str'?['unitsEntering','unitsLeaving','availableNights','blockedNights','permitCappedNights','rentableNights','bookedNights','occupiedNights','stays','checkouts']:['moveIns','moveOuts','renewals'];for(const key of flows)out[key]=total(key);
 const money=kind==='str'?['grossRentalRevenue','budgetedRevenue','operatingExpenses','strNoi','conventionalRentDisplaced','conventionalNoi','strUplift','taxableRevenue']:['grossPotentialRent','rentalIncome','vacancy','concessions','badDebt','netRentalIncome'];for(const key of money)out[key]=moneyTotal(key);
 if(kind==='str'){out.adr=ratio(total('grossRentalRevenue'),out.bookedNights);out.revpar=ratio(total('grossRentalRevenue'),out.availableNights);out.budgetedOccupancy=ratio(out.bookedNights,out.rentableNights);out.averageLengthOfStay=ratio(out.bookedNights,out.stays);}
 else{out.averageOccupiedUnits=rows.length?ratio(total('averageOccupiedUnits'),rows.length):null;out.physicalOccupancy=ratio(total('endingOccupiedUnits'),total('units'));out.leasedOccupancy=ratio(total('leasedUnits'),total('units'));out.budgetedOccupancy=ratio(total('averageOccupiedUnits'),total('units'));out.marketRent=ratio(total('grossPotentialRent'),total('units'));}
 return out;
}

export function retainedStrLeasingSchedules({scenario={},periods=[],snapshot={}}={}){
 const explicit=snapshot.strLeasingSchedules?.length?snapshot.strLeasingSchedules:snapshot.strSchedules?.length?snapshot.strSchedules:[];
 if(explicit.length)return clone(explicit);
 return [...(scenario.strStreams||[]),...(scenario.strBudgetApplications||[])].flatMap(stream=>{
  const support=stream.supportingSchedules||stream.programme?.supportingSchedules;
  if(support){const retained=Object.values(support),monthly=retained.flatMap(source=>source.leasingSchedule?.monthly||[]).filter(row=>periods.includes(row.period)).sort((a,b)=>a.period.localeCompare(b.period));if(monthly.length)return [{schemaVersion:1,kind:'str',streamId:stream.id||stream.programmeId,programmeId:stream.programmeId||retained[0]?.leasingSchedule?.programmeId,name:stream.name,sourceKind:'str_builder',sourceReceiptId:stream.sourceReceiptId,sourceHash:stream.sourceHash,revisionId:stream.revisionId,contentHash:stream.contentHash,periods:[...periods],monthly:clone(monthly),totals:leasingScheduleTotals(monthly,'str'),issues:[],supportingSchedules:clone(support)}];}
  return stream.leasingSchedule?.monthly?[calculateStrLeasingSchedule({...stream.leasingSchedule,periods,streamId:stream.id,programmeId:stream.programmeId})]:[];
 });
}
