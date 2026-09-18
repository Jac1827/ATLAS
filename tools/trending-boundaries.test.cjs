const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/portfolio-operations-dashboard/index.html', 'utf8');
const c = vm.createContext({console, Date, Map, Set});
for (const match of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(match[0],c);
const raw = [['Trending Occupancy'], ['Date Range','Beginning Occupancy','Move-ins','Move-outs','Ending Occupancy',null,'Beginning Occupied Units','Ending Occupied Units','Unit Space Count'],
  ['08/01/2026 - 08/31/2026',null,9,0,null,null,60,70,200],
  ['09/01/2026 - 09/30/2026',null,6,1,null,null,70,75,200],
  ['10/01/2026 - 10/31/2026',null,10,0,null,null,75,85,200],
  ['08/01/2026 - 10/31/2026',null,25,1,null,null,60,85,null]];
const rows = c.dataImportParseTrendingRows(raw,'Example');
assert.equal(rows.length,3,'Multi-month summary excluded');
assert.equal(rows[0].values.beginning_occupancy,'30%');
assert.equal(rows[0].values.ending_occupancy,'35%');
assert.equal(rows[0].locators.ending_occupied_units.column,8);
assert.equal(c.dataImportRowPeriod({},rows[0],{reportType:'trending_occupancy'}).periodKey,'2026-08');
const record = {monthlyHistoryByPeriod:{},monthlyData:Array.from({length:12},()=>({}))};
Object.assign(c,{savedData:{Example:record},normalizeSavedCommunityRecord:(_,r)=>r,defaultMonthly:()=>Array.from({length:12},()=>({})),getAtlasTodayISODate:()=> '2026-09-18',getReportedOccupancyBaseUnits:()=>200,getCommunityCommandDashboardOverride:()=>null,getCommunityCommandApprovedGoal:()=>null});
const plan = {reportType:'trending_occupancy',name:'trend.xlsx',fileHash:'v1',sourceSystem:'Entrata',metadata:{dataAsOf:'2026-09-18T12:00:00Z'}};
const result = {issues:[],destinations:new Set()};
for(const row of rows) c.dataImportApplyGroupedSnapshot({communityName:'Example',period:c.dataImportRowPeriod({},row,plan),entries:[{row:row.values,sourceRow:row}]},plan,result);
assert.equal(record.monthlyData[7].physicalSnapshotHistory['2026-08-31'].occupiedSnapshot,70);
assert.equal(record.monthlyData[8].physicalSnapshotHistory['2026-09-01'].occupiedSnapshot,70);
assert.equal(record.monthlyData[8].physicalSnapshotHistory['2026-09-30'],undefined,'Future ending is not an actual');
assert.equal(record.monthlyData[9].physicalSnapshotHistory,undefined,'Future beginning is not an actual');
assert.equal(record.monthlyData[8].occupiedSnapshot,undefined,'Historical trend does not overwrite current Box Score');
assert.equal(result.issues.length,1,'Actual count/movement variance remains visible');
const periods=c.communityCommandOccupancyPeriods({record,monthlyData:record.monthlyData,year:2026,propName:'Example',totalUnits:200,corporateUnits:0});
assert.equal(periods[7].endingActualPct,35);
assert.equal(periods[8].beginningPct,35);
assert.equal(periods[8].endingForecastPct,37.5);
assert.equal(periods[9].beginningPct,37.5);
assert.equal(periods[9].endingForecastPct,42.5);
assert.equal(periods[0].beginningUnits,null,'Missing January is not zero');
assert(periods[7].warnings.some(w=>w.includes('Month-end variance')));
c.getCommunityCommandApprovedGoal=(_,month)=>month===8?{requiredMoveIns:8}:null;
assert.equal(c.communityCommandOccupancyPeriods({record,monthlyData:record.monthlyData,year:2026,propName:'Example',totalUnits:200,corporateUnits:0})[9].beginningUnits,77,'Approved move-in plan carries to next month');
console.log('PASS monthly source periods, uncached formulas, no summary duplicates, actual/forecast separation, variance and approved-plan roll-forward');
const legacy = {monthlyData:Array.from({length:12},()=>({occupiedSnapshot:72,leasedSnapshot:90})),monthlyHistoryByPeriod:{}};
const currentYear = new Date().getFullYear();
const writable = c.getWritableMonthlyPeriodEntries(legacy,7,currentYear);
assert.equal(writable.historyEntry.occupiedSnapshot,72,'Creating financial history preserves existing occupancy');
writable.historyEntry.closedFinancialActuals = {period:`${currentYear}-08`,netRentalIncome:100,grossPotentialRent:200};
assert.equal(c.getRecordHistoryEntry(legacy,7,currentYear,{create:true}).closedFinancialActuals.netRentalIncome,100);
assert.equal(c.getRecordHistoryEntry(legacy,7,currentYear-1,{create:true}).occupiedSnapshot,undefined,'Never copy current occupancy into another year');
assert.match(html,/closedFinancialHistory: Array\.isArray\(input\.closedFinancialHistory\)/,'Preserve financial approval audit on normalization');
console.log('PASS financial month creation retains occupancy without inventing prior-year history');
