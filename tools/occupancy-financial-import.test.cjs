const {readDashboardSource}=require('./dashboard-source.cjs');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir=__dirname+'/../docs/portfolio-operations-dashboard/';
const html=readDashboardSource(dir+'index.html');
const F=require(dir+'financial-publication.js'),B=require(dir+'application-source-bridge.js');
const c={selectedPropIdx:0,console,Date,Map,Set,window:{AtlasFinancialPublication:F,ATLAS_CENTRAL:{getSession:()=>null}},savedData:{Test:{}},dataImportRuntimeCurrentLineageIndex:null,dataImport2State:{lineage:[]},PROPERTIES:[{name:'Test',units:100}],MONTHS:Array(12).fill('Month')};
vm.createContext(c);for(const f of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm))vm.runInContext(f[0],c);
let rejectField='',month,sequence=0;
Object.assign(c,{normalizeSavedCommunityRecord:(n,r)=>r||{},getWritableMonthlyPeriodEntries:r=>({historyEntry:month,liveEntry:month,safeYear:2026,currentYear:2026}),dataImportShouldApplyCurrentMetric:(p,n,period,f)=>f!==rejectField,dataImportUpsertFloorPlan(){},dataImportGetReportDef:()=>({sourceRank:78}),dataImportMakeId:()=>String(++sequence),dataImportBufferLineage:items=>c.dataImport2State.lineage.push(...items)});
const period={monthIdx:8,year:2026,periodKey:'2026-09'};
function apply(rows,type='box_score',record={}){month={occupiedSnapshot:10,leasedSnapshot:12,rentableUnits:20,sourceTotalUnits:20};c.savedData.Test=record;c.dataImport2State.lineage=[];const result={issues:[],formulas:[],destinations:new Set(),batchId:'batch'};c.dataImportApplyGroupedSnapshot({communityName:'Test',period,entries:rows.map(row=>({row,sourceRow:{sourceSheet:'Test'}}))},{reportType:type,name:'synthetic.xlsx',fileHash:'hash',metadata:{dataAsOf:'2026-09-16T12:00:00Z'}},result);return {month,result,record:c.savedData.Test};}
const row={total_units:100,rentable_units:90,occupied_units:45,physical_occupancy:'50%',source_leased_units:54,leased_occupancy:'60%',measurement_basis:'units'};
let r=apply([row]);assert.equal(r.month.occupiedSnapshot,45);assert.equal(r.month.physicalOccupancyPct,50);assert.equal(r.month.rentableUnits,90);
for(const change of [{occupied_units:50},{occupied_units:45.5},{occupied_units:91},{physical_occupancy:'70%'},{rentable_units:101}]){r=apply([{...row,...change}]);assert.equal(r.month.occupiedSnapshot,10);assert.equal(r.month.rentableUnits,20);assert(r.result.issues.some(x=>x.title==='Occupancy publication held'));}
rejectField='rentable_units';r=apply([row]);assert.equal(r.month.occupiedSnapshot,10,'Inventory precedence rejection holds numerator too');rejectField='';
r=apply([{...row,occupied_units:0,physical_occupancy:'0%'}]);assert.equal(r.month.occupiedSnapshot,0);
r=apply([row],'box_score',{communityPropertyType:'Student Housing',customUnits:200});assert.equal(r.month.occupiedSnapshot,10,'Unit inventory is not published as beds');
r=apply([{...row,measurement_basis:'beds'}],'box_score',{communityPropertyType:'Student Housing'});assert.equal(r.month.occupiedSnapshot,45);
r=apply([row],'box_score',{customUnits:200});assert.equal(r.month.occupiedSnapshot,10);
// Duplicate source headings remain separately located, including percentages below 1%.
const sheet=[['Box Score'],['Availability (As of 09/16/2026)'],['Unit Type','Units','Rentable Units','Occupied','Occupied','Leased'],['Total',200,200,1,'0.5%','1%']];
const parsed=B.boxScore(sheet)[0];assert.equal(parsed.values.occupied_units,1);assert.equal(parsed.values.physical_occupancy,'0.5%');assert.equal(parsed.locators.occupied_units.column,4);assert.equal(parsed.locators.physical_occupancy.column,5);
assert.equal(c.dataImportPercentValue(parsed.values.physical_occupancy),0.5);
assert.equal(B.boxScore([['Box Score'],['Selected report filters returned no data']]).length,0);
// Sum financial detail, preserve signed credits and enforce source precedence.
r=apply([{actual_charges:100,gross_potential_rent:150},{actual_charges:-10,gross_potential_rent:50}],'rent_roll');assert.equal(r.month.actualCharges,90);assert.equal(r.month.grossPotentialRent,200);assert.equal(r.month.economicOccupancyPct,null);assert(c.dataImport2State.lineage.some(l=>l.atlasField==='actual_charges'));
rejectField='actual_charges';r=apply([{actual_charges:100,gross_potential_rent:150}],'rent_roll');assert.equal(r.month.actualCharges,undefined);assert.equal(r.month.economicOccupancyPct,null);rejectField='';
r=apply([{actual_charges:100,gross_potential_rent:150},{gross_potential_rent:50}],'rent_roll');assert.equal(r.month.actualCharges,undefined,'Incomplete detail is missing, not a partial total');
r=apply([{gl_account:'4000',monthly_actual:100,monthly_budget:120,financial_section:'Operating Income'},{gl_account:'6000',monthly_actual:40,monthly_budget:50,financial_section:'Operating Expenses'}],'approved_accounting');
assert.equal(r.record.financialLedger['2026-09'].length,2);assert.equal(r.record.financialBudgetLedger['2026-09'].length,2);let summary=c.getFinancialSummaryForMonth(r.record,8,2026);assert.equal(summary.hasData,false,'Uploaded ledger is not a canonical close');
assert.equal(c.getFinancialSummaryForMonth(r.record,8,2025).hasData,false);
summary=c.summarizeFinancialLedgerRows([{glCode:'4000',actual:999,monthlyActual:0,budget:0}],[]);assert.equal(summary.hasData,true);assert.equal(summary.noiActual,0);assert.equal(summary.noiVariance,0);
summary=c.summarizeFinancialLedgerRows([{glCode:'4000',actual:100}],[]);assert.equal(summary.hasData,true);assert.equal(summary.hasBudgetData,false);assert.equal(summary.noiVariance,null);
assert.equal(c.summarizeFinancialLedgerRows([{gl:'4000',actual:999,monthlyActual:null}]).hasData,false,'Explicit missing monthly value never falls back to YTD');
const same={gl_account:'4000',monthly_actual:100};r=apply([same,same],'approved_accounting');assert(!r.record.financialLedger);assert(r.result.issues.some(i=>i.title==='Financial ledger held'));
console.log('PASS qualified count/percent columns, atomic occupancy precedence, invalid snapshots held, unit/bed scope, financial aggregation/precedence, ledger publication and monthly NOI parity.');
