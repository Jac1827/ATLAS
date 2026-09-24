const {readDashboardSource}=require('./dashboard-source.cjs');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=readDashboardSource('docs/portfolio-operations-dashboard/index.html');
const pick=name=>html.match(new RegExp('^function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))[0];
const events=[]; const c={Date,Object,JSON,performance,window:{AtlasPerformance:{enabled:true,record:(...args)=>events.push(args)}},savedData:{A:{propertyTeamConfig:{lp:1},propertyTurnoverConfig:{},propertyTurnoverByQuarter:{}},B:{propertyTeamConfig:{lp:1},propertyTurnoverConfig:{},propertyTurnoverByQuarter:{}}},atlasSharedData:{employees:{one:{name:'One'}},assignments:[]}};
let normalizations=0,persisted=0;const snapshots=[];
Object.assign(c,{syncSharedPeopleAssignments(){},normalizeAtlasSharedData:value=>{normalizations++;return structuredClone(value)},getAllCommunityNames:()=>['A','B'],normalizeSavedCommunityRecord:()=>{throw new Error("Unchanged staffing must not normalize full records")},normalizeCommunityStaffingFields:v=>structuredClone(v),
 getPeopleRosterStaffingModel:(_,v,options)=>{snapshots.push(options.normalizedSharedData);return {teamConfig:v.propertyTeamConfig,turnoverConfig:v.propertyTurnoverConfig,turnoverByQuarter:v.propertyTurnoverByQuarter}}, applyPeopleRosterStaffingToNormalizedRecord:()=>{throw new Error("Unchanged staffing must not rebuild full records")},persistSaved:()=>persisted++,persistOpsGlobalData:()=>persisted++});
vm.createContext(c);vm.runInContext(pick('atlasPeopleRosterStaffingAvailable')+'\n'+pick('syncAllCommunityStaffingFromPeopleRoster'),c);
assert.equal(c.syncAllCommunityStaffingFromPeopleRoster().changed,false);assert.equal(normalizations,1);assert.equal(snapshots[0],snapshots[1]);assert.equal(persisted,0);
c.atlasSharedData.employees.two={name:'Two'};c.syncAllCommunityStaffingFromPeopleRoster();assert.equal(normalizations,2);assert.notEqual(snapshots[0],snapshots[2]);assert.equal(Object.keys(snapshots[2].employees).length,2);
console.log('PASS one roster normalization per sync, fresh snapshot after changes, no redundant persistence');

assert.equal(events[0][2].fullRecordsNormalized,0);assert.equal(events[0][2].writesScheduled,0);assert.equal(events[0][2].renderRequests,0);assert.equal(events[0][2].communitiesInspected,2);
