import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {calculateComparison,concessionSchedule,calculatePayback} from '../docs/portfolio-operations-dashboard/features/str-ltr-comparison-engine.mjs';

// Exercise the actual Budget Builder preview and account library, not a second
// test implementation of the STR model. All test financial inputs are synthetic.
const html=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/RISE-Budget-Builder.html',import.meta.url),'utf8');
const context=vm.createContext({console,window:{},document:{}});
vm.runInContext(html.slice(html.indexOf('/* ==== 00-core.js'),html.indexOf('/* ==== 10-issues.js')),context);
const RBB=context.RBB, seed=RBB.buildState();
const property={...JSON.parse(JSON.stringify(seed.properties[0])),id:'TEST',name:'Synthetic comparison fixture',totalUnits:100,sqft:80000,units:[{id:'A',code:'A1',label:'One bedroom',units:60,avgSqft:700,marketRent:1500,cat:'conventional'},{id:'B',code:'B1',label:'Two bedroom',units:40,avgSqft:950,marketRent:2200,cat:'conventional'}],occupancyByYear:{2026:Array(12).fill(.8)}};
const state={...JSON.parse(JSON.stringify(seed)),properties:[property],lines:[],actuals:{},periods:{}};
const config={propertyId:'TEST',programmeId:'TEST-STR',name:'Test program',unitPicks:[{groupId:'A',units:2},{groupId:'B',units:1}],unitRamp:{2026:[0,1,3,3,3,3,3,3,3,3,3,3]},curve:'flat',adr:200,occupancy:.7,blockedPct:.1,permitNights:240,utilities:Object.fromEntries(['electric','water','sewer','gas'].map(key=>[key,{enabled:false}]))};
const program={id:'TEST-STR',name:'Synthetic program',version:3,config};
const source={year:2026,years:[2026],loadedAt:'2026-10-01T12:00:00Z',budgetLines:[{gl:'6810',name:'Real estate taxes',nature:'expense',monthly:Array(12).fill(1000),year:2026,behavior:'fixed_noncontract'}],concession:{type:'none',value:0,source:'Explicit test assumption'},badDebtPct:0};
const scenario={name:'Test scenario',year:2026,occupancy:{mode:'custom',str:.7,ltr:.8}};
const input={RBB,state,property,program,source,scenario};
const close=(actual,expected,message)=>assert(Math.abs(actual-expected)<.031,`${message}: ${actual} vs ${expected}`);
const before=JSON.stringify({state,property,program,source,scenario});
const base=calculateComparison(input);
assert.equal(JSON.stringify({state,property,program,source,scenario}),before,'No property, program, scenario or source writes');
assert.equal(base.metadata.inventoryUnits,3);
assert.deepEqual(base.floorPlans.map(row=>[row.code,row.units,row.ltRent]),[['A1',2,1500],['B1',1,2200]]);
assert.equal(base.monthly[0].units,0);assert.equal(base.monthly[1].units,1);assert.equal(base.metadata.partialYear,true);
close(base.ltrBridge.grossPotentialRent,(2*1500+2200)*31/3,'Matching ramp exposure uses plan rents');
for(const side of ['str','ltr']) {
  for(const key of ['income','expenses','noi','capex','cashFlow']) close(base.floorPlans.reduce((total,row)=>total+row[side][key],0),base.totals[side][key],`${side} floor plans reconcile ${key}`);
  for(const [section,key] of [['income','income'],['expenses','expenses'],['capex','capex']]) close(base.gl.filter(row=>row.section===section).reduce((total,row)=>total+row[side],0),base.totals[side][key],`${side} GL reconciles ${section}`);
  close(base.monthly.reduce((total,row)=>total+row[side].noi,0),base.totals[side].noi,`${side} monthly NOI reconciles`);
}
assert(base.gl.filter(row=>row.ltr===0).every(row=>row.percent===null),'Zero denominators remain N/A');
assert.equal(base.actuals.status,'unavailable');assert.equal(base.totals.actual.income,null);
assert(base.gl.find(row=>row.code==='1504').str>0);assert.equal(base.gl.find(row=>row.code==='6205').section,'capex');
assert.equal(base.gl.find(row=>row.code==='6850').section,'capex');
close(base.totals.str.cashFlow,base.totals.str.noi-base.totals.str.capex,'Capital remains outside NOI');

const full=calculateComparison({...input,scenario:{...scenario,occupancy:{mode:'full'}}});
for(const month of full.monthly) {close(month.nights.occupied,month.nights.rentable,'100% is 100% of eligible nights');assert(month.nights.rentable<=month.nights.physical-month.nights.blocked+.001);}
assert(full.assumptions.find(row=>row.name==='Permit-restricted nights').value>0,'Permit caps survive omit occupancy mode');
const empty=calculateComparison({...input,scenario:{...scenario,occupancy:{mode:'custom',str:0,ltr:.8}}});
assert.equal(empty.totals.str.income,0);assert(empty.totals.str.expenses>0,'Fixed expenses survive zero occupancy');
assert.equal(empty.gl.find(row=>row.code==='6228').str,0,'Turn costs respond to occupied nights');
close(empty.gl.find(row=>row.code==='6465').str,base.gl.find(row=>row.code==='6465').str,'Internet fixed expense does not scale by occupancy');
const sourceOcc=calculateComparison({...input,scenario:{...scenario,occupancy:{mode:'source'}}});
close(sourceOcc.occupancy.ltr,.8,'Source LTR occupancy');assert(sourceOcc.occupancy.str>0);

const credit=concessionSchedule({rent:1000,ramp:[0,2,2,3,3,3,3,3,3,3,3,3],occupancy:Array(12).fill(1),concession:{type:'credit',value:500,leaseTermMonths:12,eligiblePct:.5,startMonth:1,endMonth:3,timing:'upfront'}});
assert.deepEqual(credit,[0,500,0,0,0,0,0,0,0,0,0,0],'Move-in credit only on eligible activation cohorts, ending before next cohort');
const weeks=concessionSchedule({rent:1300,ramp:Array(12).fill(1),occupancy:Array(12).fill(1),concession:{type:'weeks',value:2,leaseTermMonths:12,timing:'upfront'}});
assert.equal(weeks[0],600);assert.equal(weeks.slice(1).reduce((a,b)=>a+b,0),0);
const amortized=concessionSchedule({rent:1200,ramp:Array(12).fill(1),occupancy:Array(12).fill(1),concession:{type:'months',value:1,leaseTermMonths:12,timing:'amortized'}});
assert.deepEqual(amortized,Array(12).fill(100));
const carryover=concessionSchedule({rent:1200,ramp:Array(12).fill(1),occupancy:Array(12).fill(1),openingUnits:1,concession:{type:'none'},priorCohorts:[{startMonth:-2,leaseTermMonths:12,amount:1200}]});
assert.deepEqual(carryover,[100,100,100,100,100,100,100,100,100,100,0,0],'Prior-year amortized grants run off over their remaining lease months');
const recurring=concessionSchedule({rent:1000,ramp:Array(12).fill(2),occupancy:Array(12).fill(.5),concession:{type:'percent',value:.1,timing:'recurring',leaseTermMonths:2,startMonth:3,endMonth:12}});
assert.deepEqual(recurring,[0,0,100,100,0,0,0,0,0,0,0,0],'Recurring modeled concession applies to occupied leases and stops at lease term');
const priorProgram={...program,config:{...config,unitRamp:{2025:[0,0,0,0,0,0,0,0,0,0,3,3],2026:Array(12).fill(3)}}};
const crossYear=calculateComparison({...input,program:priorProgram,scenario:{...scenario,concession:{type:'credit',value:1200,leaseTermMonths:12,timing:'amortized'}}});
close(crossYear.ltrBridge.concessions,-2400,'Prior-year cohorts retain remaining ten months of concession deductions');
const conceded=calculateComparison({...input,scenario:{...scenario,concession:{type:'credit',value:500,eligiblePct:1,leaseTermMonths:12,timing:'upfront'}}});
close(base.ltrBridge.grossPotentialRent,conceded.ltrBridge.grossPotentialRent,'Concessions leave GPR visible');
close(base.totals.ltr.income-conceded.totals.ltr.income,1200,'One-time occupied cohort credits annual effect');
assert.equal(conceded.monthly[5].ltrBridge.concessions,0,'Credit burns off');

const taxes=base.gl.find(row=>row.code==='6810');close(taxes.str,310,'Property tax allocated once to active units');close(taxes.ltr,310,'Same tax basis in LTR');
const custom=calculateComparison({...input,scenario:{...scenario,allocations:{6810:{str:{method:'custom',pct:.1},ltr:{method:'none'}}}}});
close(custom.gl.find(row=>row.code==='6810').str,1000*31/3*.1,'Custom allocation with matched exposure');assert.equal(custom.gl.find(row=>row.code==='6810').ltr,0);
const missingExpense=calculateComparison({...input,source:{...source,budgetLines:[]}});assert.equal(missingExpense.totals.str.noi,null);assert.equal(missingExpense.breakEven.operating.adr,null);
const missingRent=calculateComparison({...input,property:{...property,units:property.units.map(row=>row.id==='B'?{...row,marketRent:null}:row)}});assert.equal(missingRent.totals.ltr.income,null);
const missingGasInput={...input,program:{...program,config:{...config,utilities:{...config.utilities,gas:{enabled:true}}}}};
assert.equal(calculateComparison(missingGasInput).totals.str.noi,null,'Missing utility assumptions do not become fabricated zero');
const noGas=calculateComparison({...missingGasInput,scenario:{...scenario,allocations:{6464:{str:{method:'none'}}}}});
assert.notEqual(noGas.totals.str.noi,null,'Explicit not applicable rule resolves unsupported gas cost');
assert.equal(noGas.gl.find(row=>row.code==='6464').str,0);
assert(!noGas.limitations.some(value=>value.includes('no provider or usage')));
assert.throws(()=>calculateComparison({...input,scenario:{...scenario,occupancy:{mode:'custom',str:1.1,ltr:.8}}}),/between/);
assert.throws(()=>calculateComparison({...input,program:{...program,config:{...config,unitRamp:{2026:Array(12).fill(4)}}}}),/exceeds/);

const actuals=base.gl.flatMap(row=>row.monthly.filter(month=>month.period<='2026-03').map(month=>({period:month.period,gl:row.code,nature:row.nature,programId:'TEST-STR',amount:month.budget,status:'closed',updatedAt:'2026-04-17T10:00:00Z'})));
const performance=calculateComparison({...input,source:{...source,actuals},scenario:{...scenario,mode:'performance'}});
assert.equal(performance.metadata.endMonth,3);assert.equal(performance.monthly.length,3);assert.equal(performance.actuals.latestMonth,'2026-03');assert.equal(performance.actuals.status,'closed');
close(performance.totals.actual.noi,performance.totals.budget.noi,'Performance budget aligned to recorded months');
const otherProgramLater=calculateComparison({...input,source:{...source,actuals:[...actuals,{period:'2026-08',gl:'5144',programId:'OTHER',amount:900000,status:'closed'}]},scenario:{...scenario,mode:'performance'}});
assert.equal(otherProgramLater.actuals.latestMonth,'2026-03');assert.equal(otherProgramLater.actuals.latestPropertyMonth,'2026-08');
const zeroCost=calculateComparison({...input,source:{...source,actuals:actuals.filter(row=>row.gl!=='6228')},scenario:{...scenario,mode:'performance',strOverrides:{cleanCostPerStay:0}}});
assert.equal(zeroCost.totals.actual.expenses,null,'A zero model cost cannot certify that missing recorded cost is zero');
const investment=calculateComparison({...input,source:{...source,actuals},scenario:{...scenario,mode:'investment',occupancy:{mode:'full'}}});
close(investment.totals.str.income,performance.totals.actual.income,'Custom occupancy never rewrites actuals');
const incomplete=calculateComparison({...input,source:{...source,actuals:actuals.filter(row=>!(row.period==='2026-03'&&row.gl==='6228'))},scenario:{...scenario,mode:'investment'}});
assert.equal(incomplete.actuals.status,'incomplete');assert.equal(incomplete.totals.str.expenses,null);assert(incomplete.actuals.coverage.missing.some(row=>row.gl==='6228'));
const unallocated=calculateComparison({...input,source:{...source,actuals:actuals.map(({programId,...row})=>({...row,scope:'property'}))},scenario:{...scenario,mode:'investment'}});
assert.equal(unallocated.totals.str.income,null);assert.equal(unallocated.actuals.status,'unavailable');
assert.equal(unallocated.actuals.latestMonth,null,'Latest month used is unavailable without program attribution');
assert.equal(unallocated.actuals.latestPropertyMonth,'2026-03','Property latest available is disclosed separately');

assert(base.breakEven.operating.adr>0);assert(base.breakEven.operating.occupancy>0&&base.breakEven.operating.occupancy<=1);
const atThreshold=calculateComparison({...input,scenario:{...scenario,strOverrides:{adr:base.breakEven.operating.adr}}});
assert(Math.abs(atThreshold.totals.str.noi)<10,'Numerical operating ADR root reprices fees and variable costs');
const losing=calculateComparison({...input,scenario:{...scenario,strOverrides:{adr:1},rentOverrides:{A:100000,B:100000}}});
assert.equal(losing.breakEven.ltrParity.occupancy,null);assert.equal(losing.breakEven.ltrParity.occupancyFeasible,false);
assert.equal(losing.payback.reached,false);
const simplePayback=calculatePayback([{str:{noi:200,capex:500},ltr:{noi:100,capex:0}},{str:{noi:600,capex:0},ltr:{noi:100,capex:0}}]);assert.equal(simplePayback.months,1.8);
const lostLater=calculatePayback([{str:{noi:100,capex:50},ltr:{noi:0,capex:0}},{str:{noi:0,capex:1000},ltr:{noi:0,capex:0}}]);assert.equal(lostLater.reached,false,'Later ramp investment invalidates an earlier apparent recovery');
assert.equal(calculatePayback([{str:{noi:null,capex:1},ltr:{noi:0,capex:0}}]).months,null);
assert.equal(calculatePayback([{str:{noi:null,capex:1},ltr:{noi:0,capex:0}}]).incrementalInvestment,1,'Known investment survives incomplete operating NOI');
assert.equal(base.sensitivity.length,25);
const seasonalConfig={...config,curve:'str_jax'};
const seasonal=calculateComparison({...input,program:{...program,config:seasonalConfig},scenario:{...scenario,occupancy:{mode:'source'}}});
const uniform=RBB.strBuilder.preview(state,{...seasonalConfig,occMode:'monthly',occMonthly:{2026:Array(12).fill(.99)}},2026);
const weightedUniformAdr=uniform.gross.reduce((a,b)=>a+b,0)/uniform.booked.reduce((a,b)=>a+b,0);
const centerRates=seasonal.sensitivity.filter((_,index)=>index%5===2).map(row=>row.adr);
assert.equal(new Set(centerRates).size,1,'All occupancy rows share the same uniform-occupancy ADR columns');
close(centerRates[0],weightedUniformAdr,'Sensitivity labels use the actual weighted ADR of sampled uniform occupancy');
assert(base.recommendation.drivers.some(row=>row.includes('headroom')));assert(base.recommendation.drivers.some(row=>row.includes('Source:')));
const approvedOccupancy=calculateComparison({...input,scenario:{...scenario,occupancy:{mode:'source'}},source:{...source,budgetLeasing:Array.from({length:12},(_,m)=>({period:`2026-${String(m+1).padStart(2,'0')}`,units:100,occupiedUnits:40}))}});
close(approvedOccupancy.occupancy.ltr,.4,'Approved retained leasing occupancy takes precedence over saved property schedule');

const libraries={assumptions:JSON.parse(JSON.stringify(RBB.ASSUMPTIONS)),curves:JSON.parse(JSON.stringify(RBB.CURVES)),utilityProviders:JSON.parse(JSON.stringify(RBB.UTILITY_PROVIDERS)),utilityBenchmarks:JSON.parse(JSON.stringify(RBB.UTILITY_BENCHMARKS)),coa:JSON.parse(JSON.stringify(RBB.COA))};
const identities={assumptions:RBB.ASSUMPTIONS,curves:RBB.CURVES,providers:RBB.UTILITY_PROVIDERS,coa:RBB.COA,index:RBB.glIndex};
const retained=calculateComparison({...input,source:{...source,libraries}});
RBB.ASSUMPTIONS.global.str_mgmt_fee_pct={value:.99};
const repeated=calculateComparison({...input,source:{...source,libraries}});assert.deepEqual(repeated.totals,retained.totals,'Retained library references keep scenarios reproducible after live source changes');
assert.throws(()=>calculateComparison({...input,program:{...program,config:null},source:{...source,libraries}}));
assert.equal(RBB.ASSUMPTIONS,identities.assumptions);assert.equal(RBB.CURVES,identities.curves);assert.equal(RBB.UTILITY_PROVIDERS,identities.providers);assert.equal(RBB.COA,identities.coa);assert.equal(RBB.glIndex,identities.index);

if(process.env.ATLAS_COMPARISON_FIXTURE_OUT) fs.writeFileSync(process.env.ATLAS_COMPARISON_FIXTURE_OUT,JSON.stringify(base,null,2));
console.log('PASS direct saved inventory/rent/ramp, legacy STR model reuse, concessions timing, occupancy and permit controls, missing evidence, aligned closed actuals, fixed/shared costs, GL/floor-plan/monthly reconciliation, capital separation, numerical thresholds, payback and reproducible libraries.');
