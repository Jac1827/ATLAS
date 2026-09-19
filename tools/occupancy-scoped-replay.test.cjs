const assert=require('node:assert/strict');
const api=require('../docs/portfolio-operations-dashboard/occupancy-replay.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const base={communityId:'community:test',communityName:'Test',periodKey:'2026-09',sectionDate:'2026-09-16',generatedAt:'2026-09-16T15:38:00Z',dataAsOf:'2026-09-16T15:38:00Z',
 fileHash:'a'.repeat(64),archiveId:'src1',batchId:'batch1',sourceFile:'source.xlsx',sourceSheet:'Test',sourceRow:11,
 values:{total_units:100,excluded_units:4,rentable_units:96,occupied_units:90,source_leased_units:92,physical_occupancy:93.75,leased_occupancy:95.83333333333333},
 locators:Object.fromEntries(api.fields.map((f,i)=>[f,{row:11,column:i+1,group:f.endsWith('occupancy')?'percent':'count'}]))};
const data={Test:{communityId:'community:test',customUnits:100,monthlyData:Array.from({length:12},(_,i)=>({occupiedSnapshot:i===8?93.75:7,leasedSnapshot:8,applications:11,rentableUnits:198})),monthlyHistoryByPeriod:{'2026-01':{rentableUnits:98}},currentMonth:8}};
const state={sourceArchive:[{id:'src1',fileHash:base.fileHash,batchId:'batch1',importStatus:'Approved',reportType:'box_score'}],canonicalRecords:[{key:'legacy',fileHash:base.fileHash,communityName:'Test',periodKey:'2026-09',values:{occupied_units:'93.75%',rentable_units:198,applications:11}}],lineage:[],reconciliationLog:[]};
const run=(overrides={})=>api.prepare({communityData:data,importState:state,observations:[base],periodKey:'2026-09',now:'2026-09-19T00:00:00Z',...overrides});
const first=run();
assert.equal(data.Test.monthlyData[8].occupiedSnapshot,93.75,'input not mutated');
assert.equal(first.communityData.Test.monthlyData[8].occupiedSnapshot,90);
assert.equal(first.communityData.Test.monthlyData[8].rentableUnits,96);
assert.equal(first.communityData.Test.monthlyData[8].applications,11);
assert.deepEqual(first.communityData.Test.monthlyData.slice(0,8),data.Test.monthlyData.slice(0,8));
assert.deepEqual(first.communityData.Test.monthlyHistoryByPeriod['2026-01'],data.Test.monthlyHistoryByPeriod['2026-01']);
assert.equal(first.importState.canonicalRecords[0].values.occupied_units,'93.75%','old source retained');
assert(first.importState.canonicalRecords[0].fieldSupersession.occupied_units);
const again=run({communityData:first.communityData,importState:first.importState,now:'2026-09-20T00:00:00Z'});
assert.equal(again.changed,false,'duplicate replay is a strict no-op');
for(const value of [null,undefined,'93.75%',93.75]) {const o=clone(base);o.values.occupied_units=value;assert.throws(()=>run({observations:[o]}));}
const noDenom=clone(base);noDenom.values.rentable_units=null;assert.throws(()=>run({observations:[noDenom]}));
const badType=clone(base);badType.locators.occupied_units.group='percent';assert.throws(()=>run({observations:[badType]}));
const zero=clone(base);zero.values.occupied_units=0;zero.values.physical_occupancy=0;assert.equal(run({observations:[zero]}).communityData.Test.monthlyData[8].occupiedSnapshot,0);
const zeroStored=clone(data);zeroStored.Test.monthlyData[8].occupiedSnapshot=0;assert.equal(run({communityData:zeroStored}).communityData.Test.monthlyData[8].occupiedSnapshot,90);
const alias=clone(base);alias.communityId='wrong';assert.throws(()=>run({observations:[alias]}));
const later=clone(base);Object.assign(later,{sectionDate:'2026-09-18',generatedAt:'2026-09-18T14:33:00Z',dataAsOf:'2026-09-18T14:33:00Z',archiveId:'src2',fileHash:'b'.repeat(64)});
Object.assign(later.values,{total_units:102,rentable_units:98,occupied_units:91,physical_occupancy:91/98*100,leased_occupancy:92/98*100});
const twoState=clone(state);twoState.sourceArchive.push({...state.sourceArchive[0],id:later.archiveId,fileHash:later.fileHash});
const released=run({observations:[base,later],importState:twoState});
assert.equal(released.communityData.Test.monthlyData[8].rentableUnits,98);
assert.equal(released.communityData.Test.monthlyData[8].physicalSnapshotHistory['2026-09-16'].rentableUnits,96);
assert.equal(released.communityData.Test.monthlyData[8].physicalSnapshotHistory['2026-09-18'].rentableUnits,98);
assert.throws(()=>run({communityData:released.communityData,importState:released.importState}),'older replay cannot replace a newer current observation');
const closed=clone(state);closed.closedPeriods=['2026-09'];assert.throws(()=>run({importState:closed}));
console.log('PASS scoped occupancy replay: typed counts, rates, exclusions, dated release, revisions, idempotency, zero/missing, alias, source and historical boundaries');
const stale=clone(data);stale.Test.monthlyHistoryByPeriod['2026-09']=clone(stale.Test.monthlyData[8]);stale.Test.monthlyData[8].applications=99;
const protectedData=api.protectCommittedOccupancy(stale,first.communityData);
assert.equal(protectedData.Test.monthlyData[8].occupiedSnapshot,90,'stale tab cannot erase committed revision');
assert.equal(protectedData.Test.monthlyData[8].applications,99,'unrelated edits survive');
const fresh=clone(released.communityData);assert.equal(api.protectCommittedOccupancy(fresh,first.communityData).Test.monthlyData[8].occupiedSnapshot,91,'newer source can publish');
console.log('PASS stale writer protection retains newer sources and unrelated edits');
