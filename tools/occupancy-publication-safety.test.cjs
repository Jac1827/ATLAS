const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const html = fs.readFileSync(`${__dirname}/../docs/portfolio-operations-dashboard/index.html`, 'utf8');
const bridge = require('../docs/portfolio-operations-dashboard/application-source-bridge.js');
const c = vm.createContext({console, Date, Map, Set, window:{}, savedData:{}, dataImportRuntimeCurrentLineageIndex:null,
  dataImport2State:{lineage:[],learningSettings:{autoMapThreshold:95}}});
for (const f of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(f[0],c);
const raw = [['Availability (As of 09/16/2026)'],
  ['Unit Type','Units','Excluded','Rentable Units','Occupied','Vacant','Available','Occupied No Notice','Notice Rented','Notice Unrented','Vacant Rented','Occupied','Leased','Availability (As of 09/16/2026): Leased Units'],
  ['Total:',204,4,200,180,20,15,175,0,5,10,'90.00%','95.00%',190]];
const source = {...bridge.boxScore(raw)[0],sourceSheet:'Example'};
assert.equal(source.values.occupied_units,180);
assert.equal(source.values.physical_occupancy,'90%');
assert.equal(source.values.source_leased_units,190);
assert.equal(source.locators.occupied_units.group,'count');
assert.equal(source.locators.physical_occupancy.group,'percent');
c.dataImportDestinationExists = () => true;
const badMapping = c.dataImportMapSourceRow(source,{reportType:'box_score',questionAnswers:[{kind:'mapping',originalField:'physical_occupancy',value:'occupied_units'}]});
assert.equal(badMapping.mapped.occupied_units,180,'A rate cannot overwrite a correctly mapped count');
assert.equal(badMapping.unmappedFields.length,1);
const legacyMapping = c.dataImportMapSourceRow({values:{'Occupied %':'90%'}},{reportType:'box_score',questionAnswers:[{kind:'mapping',originalField:'Occupied %',value:'occupied_units'}]});
assert.equal(legacyMapping.mapped.occupied_units,undefined);
assert.equal(legacyMapping.unmappedFields.length,1);
let month, allow = true;
Object.assign(c,{
  normalizeSavedCommunityRecord:(_,r)=>r || {},getResolvedTotalUnitsForRecord:()=>204,
  getWritableMonthlyPeriodEntries:()=>({historyEntry:month,liveEntry:month}),dataImportUpsertFloorPlan:()=>{},
  dataImportShouldApplyCurrentMetric:()=>allow,
  dataImportApplyMetric:(_record,_plan,_result,_name,_period,target,value)=>{
    if(value===null || value===undefined)return false;
    const field={occupied:'occupiedSnapshot',leased:'leasedSnapshot'}[target];
    if(field)month[field]=value;
    return true;
  }
});
const prior = {occupiedSnapshot:150,leasedSnapshot:160,rentableUnits:200,sourceTotalUnits:204,physicalOccupancyPct:75,leasedOccupancyPct:80};
function apply(values, publish=true) {
  month=JSON.parse(JSON.stringify(prior));allow=publish;
  const result={issues:[],formulas:[],destinations:new Set()};
  c.dataImportApplyGroupedSnapshot({communityName:'Example',period:{monthIdx:8,year:2026,periodKey:'2026-09'},entries:[{row:values,sourceRow:source}]},
    {reportType:'box_score',name:'Synthetic.xlsx',fileHash:'verified-file',metadata:{dataAsOf:'2026-09-16T12:00:00Z'}},result);
  return {month:JSON.parse(JSON.stringify(month)),result};
}
let valid = apply(source.values);
assert.equal(valid.month.occupiedSnapshot,180);
assert.equal(valid.month.leasedSnapshot,190);
assert.equal(valid.month.rentableUnits,200);
assert.equal(valid.month.physicalSnapshotHistory['2026-09-16'].occupiedSnapshot,180);
assert.equal(valid.result.occupancyGroupsHeld,undefined);
for (const [label,patch] of Object.entries({percentCount:{occupied_units:'180%'},fractional:{occupied_units:90.25},integerPercentage:{occupied_units:90},overflow:{occupied_units:201},negative:{occupied_units:-1},
  badRentable:{rentable_units:408},badTotal:{total_units:205},badExcluded:{excluded_units:3},rateConflict:{physical_occupancy:'25%'},
  missingCount:{occupied_units:null,occupied_no_notice:null},missingRentable:{rentable_units:null},badLeased:{source_leased_units:201},badAvailable:{available_units:201}})) {
  const held=apply({...source.values,...patch});
  assert.deepEqual(held.month,prior,`${label}: neither counts, denominator, rates nor history may publish`);
  assert.equal(held.result.occupancyGroupsHeld,1,label);
}
const zero=apply({...source.values,occupied_units:0,occupied_no_notice:0,notice_unrented:0,vacant_units:200,source_leased_units:0,physical_occupancy:'0%',leased_occupancy:'0%'});
assert.equal(zero.month.occupiedSnapshot,0,'Verified zero is retained');
assert.equal(c.getVerifiedMonthlySnapshot(zero.month),0);
assert.equal(c.getVerifiedMonthlySnapshot({occupiedSnapshot:90.25,snapshotVerified:true}),null,'Provenance cannot validate fractional unit counts');
assert.equal(c.getVerifiedMonthlySnapshot({occupiedSnapshot:201,rentableUnits:200,snapshotVerified:true}),null,'Provenance cannot validate impossible counts');
assert.deepEqual(apply(source.values,false).month,prior,'An older source cannot mix its counts into the current denominator');
// Real freshness function: only repair an undated same-file import timestamp.
vm.runInContext(html.match(/^function dataImportShouldApplyCurrentMetric\([^\n]*\) \{[\s\S]*?^\}/m)[0],c);
c.dataImportGetReportDef=()=>({sourceRank:100});
c.dataImport2State.lineage=[{currentState:true,communityName:'Example',periodKey:'2026-09',atlasField:'occupied_units',fileHash:'same',sourceRank:100,dataAsOf:'2026-09-18',importedAt:'2026-09-18'}];
const canApply=(date)=>c.dataImportShouldApplyCurrentMetric({reportType:'box_score',fileHash:'same',reprocessArchivedSource:true},'Example','2026-09','occupied_units',date,{issues:[]});
assert.equal(canApply('2026-09-16'),false);
assert.equal(canApply(''),false);
c.dataImport2State.lineage[0].dataAsOf='';
assert.equal(canApply('2026-09-16'),true);
console.log('PASS typed mapping, count/rate reconciliation, atomic publication, real zero, missing counts, exclusions, verified history and stale replay protection.');
