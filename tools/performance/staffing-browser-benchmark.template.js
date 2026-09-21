() => {
if(getAtlasCentralStatus().signedIn || loadPeoplePlatformStateForSharedData().employees.length) throw Error("Use a signed-out, empty local test profile");
__ORIGINAL_SYNC__
__ORIGINAL_TURNOVER__
const repairedTurnover=getPeopleRosterTurnoverByQuarterForCommunity;
const originalSaved=savedData,originalShared=atlasSharedData;
const results=[];
try {
 const names=getAllCommunityNames();
 const fixture={employees:{},assignments:[]};
 for(let i=0;i<__EMPLOYEES__;i++) {const name=names[i%names.length],id='synthetic-'+i;fixture.employees[id]={employeeId:id,name:'Synthetic '+i,communityName:name,bonusRoleType:'lp',active:true};fixture.assignments.push({employeeId:id,communityName:name,bonusRoleType:'lp',effectiveStart:'2026-01-01',status:'active'});}
 for(let i=0;i<Math.min(30,__EMPLOYEES__);i++){fixture.employees['synthetic-'+i].terminationDate='2026-05-15';fixture.assignments[i].effectiveEnd='2026-05-15';}
 const seed=Object.fromEntries(names.map(name=>[name,defaultSavedCommunityRecord(name)]));
 for(const phase of ['changed','unchanged','terminated']) {
  savedData=structuredClone(seed);atlasSharedData=structuredClone(fixture);
  if(phase==='terminated'){for(let i=0;i<Math.min(30,__EMPLOYEES__);i++){fixture.employees['synthetic-'+i].status='Terminated';fixture.assignments[i].status='Terminated';}atlasSharedData=structuredClone(fixture);}
  if(phase==='unchanged') originalStaffingSync({persist:false});
  const initial=structuredClone(savedData);
  let expected;const timings={before:[],after:[]};
  for(let i=0;i<6;i++)for(const label of i%2?['after','before']:['before','after']) {
   savedData=structuredClone(initial);atlasSharedData=structuredClone(fixture);
   getPeopleRosterTurnoverByQuarterForCommunity=label==='before'?originalTurnover:repairedTurnover;
   const at=performance.now(); const outcome=(label==='before'?originalStaffingSync:syncAllCommunityStaffingFromPeopleRoster)({persist:false});
   timings[label].push(performance.now()-at);
   const output=JSON.stringify({outcome,state:savedData});
   if(expected===undefined) expected=output;
   if(output!==expected)throw new Error('Staffing output differs: '+phase+' '+label);
  }
  results.push({phase,communities:names.length,employees:__EMPLOYEES__,timings,parity:true});
 }
 return results;
} finally {getPeopleRosterTurnoverByQuarterForCommunity=repairedTurnover;savedData=originalSaved;atlasSharedData=originalShared;}
}