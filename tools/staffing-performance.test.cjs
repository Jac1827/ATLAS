const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('docs/portfolio-operations-dashboard/index.html','utf8');
const pick=name=>html.match(new RegExp('^function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))[0];
const c={Date,Object,JSON,savedData:{A:{propertyTeamConfig:{lp:1},propertyTurnoverConfig:{},propertyTurnoverByQuarter:{}},B:{propertyTeamConfig:{lp:1},propertyTurnoverConfig:{},propertyTurnoverByQuarter:{}}},atlasSharedData:{employees:{one:{name:'One'}},assignments:[]}};
let normalizations=0,persisted=0;const snapshots=[];
Object.assign(c,{syncSharedPeopleAssignments(){},normalizeAtlasSharedData:value=>{normalizations++;return structuredClone(value)},getAllCommunityNames:()=>['A','B'],normalizeSavedCommunityRecord:(_,v)=>structuredClone(v),
 applyPeopleRosterStaffingToCommunityRecord:(_,v,options)=>{snapshots.push(options.normalizedSharedData);return v},persistSaved:()=>persisted++,persistOpsGlobalData:()=>persisted++});
vm.createContext(c);vm.runInContext(pick('atlasPeopleRosterStaffingAvailable')+'\n'+pick('syncAllCommunityStaffingFromPeopleRoster'),c);
assert.equal(c.syncAllCommunityStaffingFromPeopleRoster().changed,false);assert.equal(normalizations,1);assert.equal(snapshots[0],snapshots[1]);assert.equal(persisted,0);
c.atlasSharedData.employees.two={name:'Two'};c.syncAllCommunityStaffingFromPeopleRoster();assert.equal(normalizations,2);assert.notEqual(snapshots[0],snapshots[2]);assert.equal(Object.keys(snapshots[2].employees).length,2);
console.log('PASS one roster normalization per sync, fresh snapshot after changes, no redundant persistence');
