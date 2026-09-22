const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/../docs/portfolio-operations-dashboard/index.html', 'utf8');
const c = { PROPERTIES:[{name:'Synthetic Community',units:200}],selectedPropIdx:0,console, Date, Map, Set, window: {}, MONTHS: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], dataImport2State: {lineage: [], canonicalRecords: []}, communityCommandState: {} };
c.FULL_MONTHS=c.MONTHS; vm.createContext(c);
for (const f of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(f[0],c);
Object.assign(c, { getCommunityCommandApprovedGoal:()=>null,
  getRenewalMonthEntryForRecord:()=>({}), communityCommandCanApproveGoals:()=>false,
  renderWindowshadeCard:x=>x.bodyHtml });
const clone=x=>JSON.parse(JSON.stringify(x));
const close=(a,b)=>assert(Math.abs(a-b)<1e-8, `${a} != ${b}`);
const record={propertyName:'Synthetic Community',reportYear:2026,currentMonth:8,corporateLeaseUnits:2,monthlyData:c.defaultMonthly(),monthlyHistoryByPeriod:{}};
for(let i=0;i<9;i++) Object.assign(record.monthlyData[i],{occupiedSnapshot:80+i*2,sourceTotalUnits:200,rentableUnits:190,physicalOccupancyPct:(80+i*2)/190*100});
const model={propName:record.propertyName,record,totalUnits:200,monthIdx:8,year:2026,monthlyData:record.monthlyData,occupancyBaseUnits:188,occupied:94,
  schedule:Array.from({length:12},(_,i)=>({skip:i<8,occupied:i<8?0:180,occPct:i<8?0:95,budgetOcc:95}))};
// The newer boundary-date leasing plan contract is covered by occupancy-contract.test.cjs.
record.monthlyData[1]=c.defaultMonthly()[1];
// Explicit source zero is measured; default/blank is not. Corporate exclusion is once.
const zero=clone(record);zero.corporateLeaseUnits=0;
Object.assign(zero.monthlyData[1],{occupiedSnapshot:0,sourceTotalUnits:200,rentableUnits:190,physicalOccupancyPct:0});
assert.equal(c.getObservedOccupiedSnapshot(zero,200,1,2026).pct,0);
const zeroModel={...model,record:zero,monthlyData:zero.monthlyData};

for(const bad of [null,undefined,'',NaN,-1,2.5,201]){
  zero.monthlyData[1].occupiedSnapshot=bad;
  assert.equal(c.getObservedOccupiedSnapshot(zero,200,1,2026),null);
}
const mismatch=clone(record);mismatch.monthlyData[0].sourceTotalUnits=400;
assert.equal(c.getObservedOccupiedSnapshot(mismatch,200,0,2026),null,'Unit/bed mismatch is not comparable');
mismatch.monthlyData[0].sourceTotalUnits=200;mismatch.monthlyData[0].occupiedSnapshot=42.1;
assert.equal(c.getObservedOccupiedSnapshot(mismatch,200,0,2026),null,'Percent cannot be an occupied count');
mismatch.monthlyData[0].occupiedSnapshot=80;mismatch.monthlyData[0].physicalOccupancyPct=80;
assert.equal(c.getObservedOccupiedSnapshot(mismatch,200,0,2026),null,'Count/percent disagreement requires review');
assert.equal(c.getObservedOccupiedSnapshot(record,200,0,2025),null,'No cross-year live fallback');
record.monthlyHistoryByPeriod['2026-01']={occupiedSnapshot:60,sourceTotalUnits:200,rentableUnits:180,physicalOccupancyPct:60/180*100};
close(c.getObservedOccupiedSnapshot(record,200,0,2026).pct,58/178*100);
// No fabricated source/lineage: the date must remain absent, including null->0 regression.
let estimate=c.getMonthsToStabilization(model);assert.equal(estimate.months,null);
let markup=c.renderCommunityCommandStabilization(model);assert(markup.includes('Range Needed'));assert(!markup.includes('September 2026'));assert(!markup.includes('renewal exposure'));
// Independent synthetic source fields and the exact current occupied lineage.
const period='2026-09',fileHash='synthetic-current',dataAsOf='2026-09-16T16:00:00Z';
c.dataImport2State.lineage.push({currentState:true,communityName:model.propName,periodKey:period,atlasField:'occupied_units',importedValue:96,fileHash,dataAsOf});
c.dataImport2State.canonicalRecords.push({communityName:model.propName,periodKey:period,reportType:'box_score',fileHash,dataAsOf,values:{occupied_units:96,total_units:200,rentable_units:190,physical_occupancy:96/190*100}});
// All eight closed months must be documented, including four measured zeros.
for(let i=0;i<8;i++){
  const moveIns=i%2===0?10:0;
  Object.assign(record.monthlyData[i],{moveIns,moveOuts:0});
  const key=`2026-${String(i+1).padStart(2,'0')}`;
  const asOf=new Date(Date.UTC(2026,i+1,0,23,59,59)).toISOString();
  c.dataImport2State.canonicalRecords.push({communityName:model.propName,periodKey:key,reportType:'box_score',fileHash:`synthetic-${i}`,dataAsOf:asOf,values:{move_ins:moveIns,move_outs:0,total_units:200,rentable_units:190}});
  for(const [field,value] of [['move_ins',moveIns],['move_outs',0]]) c.dataImport2State.lineage.push({currentState:true,communityName:model.propName,periodKey:key,atlasField:field,importedValue:value,fileHash:`synthetic-${i}`,dataAsOf:asOf});
}
// Clear the deliberate history override so it does not shadow the activity fixture.
record.monthlyHistoryByPeriod={};
estimate=c.getMonthsToStabilization(model);
assert.equal(estimate.avgNetAbsorption,5,'Zero-activity months participate in the denominator');
assert.equal(estimate.targetUnits,179);assert.equal(estimate.months,17);
const report={sourceRecord:record,totalUnits:200,reportMonthIdx:8,reportYear:2026,communityName:model.propName,communityCount:1};
assert.equal(c.buildCommunityProgressStabilization(report).months,estimate.months);
assert.equal(c.buildCommunityProgressStabilization({...report,communityCount:2}).months,null,'A first-community record cannot verify a portfolio');
// Real parser shape: Availability inventory and Property Pulse activity are separate rows.
const joinedBefore=clone(c.dataImport2State.canonicalRecords);
c.dataImport2State.canonicalRecords=c.dataImport2State.canonicalRecords.flatMap(item=>{
 if(item.periodKey===period)return [item];
 const last=item.dataAsOf.slice(0,10);
 return [{...item,sectionPeriod:{asOf:last},values:{total_units:200,rentable_units:190}},
 {...item,sectionPeriod:{start:item.periodKey+'-01',end:last},values:{move_ins:item.values.move_ins,move_outs:item.values.move_outs}}];
});
assert.equal(c.getMonthsToStabilization(model).months,17,'Join qualified sections from the same source');
c.dataImport2State.canonicalRecords=joinedBefore;
// Selected model supplies all context; rendering must never depend on active-property globals.
markup=c.renderCommunityCommandStabilization(model);assert(markup.includes('February 2028'));
const last=c.dataImport2State.lineage.pop();assert.equal(c.getMonthsToStabilization(model).months,null,'One missing zero activity field invalidates the series');c.dataImport2State.lineage.push(last);
const originalDate=last.dataAsOf;last.dataAsOf='2026-08-16T16:00:00Z';assert.equal(c.getMonthsToStabilization(model).months,null,'Partial months cannot represent closed months');last.dataAsOf=originalDate;
for(let i=0;i<8;i++) {record.monthlyData[i].moveIns=0;for(const item of c.dataImport2State.lineage)if(item.periodKey!==period&&item.atlasField==='move_ins')item.importedValue=0;}
for(const item of c.dataImport2State.canonicalRecords) if(item.periodKey!==period)item.values.move_ins=0;
assert.equal(c.getMonthsToStabilization(model).months,null,'Flat absorption has no finite stabilization date');
assert.match(c.getMonthsToStabilization(model).reason,/flat or negative/);
assert.equal(c.calculateReconciledStabilization({baseline:{baseUnits:100,units:96},documented:[],verified:false,reason:'Unverified'}).months,null,'Unverified above-target baseline is not reported as achieved');
assert.equal(c.calculateReconciledStabilization({baseline:{baseUnits:100,units:96},documented:[],verified:true}).months,0);
assert.equal(c.calculateReconciledStabilization({baseline:{baseUnits:100,units:20},documented:[-1,0],verified:true}).months,null);
console.log('PASS period observations, missing vs zero, inventory reconciliation, corporate exclusions, history precedence, complete absorption including zeros, source gating, null date and report parity.');

c.getRecordMonthlyDataForYear=()=>[];
// Uploaded rent charges cannot substitute for a canonical close.
const financial={reportYear:2026,monthlyHistoryByPeriod:{'2026-01':{actualCharges:80,grossPotentialRent:100}}};
assert.equal(c.getCommunityCommandEconomicOccupancyData(financial,0,2026).mtdPct,null);
console.log('PASS uploaded financials remain unavailable until canonical close.');
