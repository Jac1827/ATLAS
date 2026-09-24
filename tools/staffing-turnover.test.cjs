const {readDashboardSource}=require('./dashboard-source.cjs');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=readDashboardSource('docs/portfolio-operations-dashboard/index.html');
const pick=name=>html.match(new RegExp('^function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))[0];
let lookups=0;
const empty=()=>Object.fromEntries(['Q1','Q2','Q3','Q4'].map(q=>[q,{lp:0,gm:0}]));
const c={Date,Object,Set,PROPERTY_TEAM_ROLE_DEFS:{lp:{},gm:{}},BONUS_QUARTERS:['Q1','Q2','Q3','Q4'],
 normalizePropertyTurnoverByQuarter:()=>empty(),defaultPropertyTurnoverByQuarter:empty,
 atlasPeopleRosterStaffingAvailable:()=>true,
 findCanonicalCommunityName:name=>{lookups++;return name==='Alias A'?'A':name},
 normalizeSharedDate:value=>value||'',sharedDateTime:value=>Number.isFinite(Date.parse(value))?Date.parse(value):null,
 getBonusQuarterDateRange:(q,y)=>({start:`${y}-${String((Number(q[1])-1)*3+1).padStart(2,'0')}-01`,end:`${y}-${String(Number(q[1])*3).padStart(2,'0')}-31`})};
vm.createContext(c);vm.runInContext(pick('getPeopleRosterTurnoverEventDate')+'\n'+pick('getPeopleRosterTurnoverByQuarterForCommunity'),c);
const active={employees:{},assignments:Array.from({length:1000},(_,i)=>({employeeId:String(i),communityName:'A',bonusRoleType:'lp',status:'Active'}))};
assert.deepEqual(JSON.parse(JSON.stringify(c.getPeopleRosterTurnoverByQuarterForCommunity('A', {year:2026,normalizedSharedData:active}).turnoverByQuarter)),empty());
assert.equal(lookups,1,'Active rows must not resolve community names in turnover processing');
const terminated={employees:{one:{employeeId:'one',communityName:'Alias A',bonusRoleType:'lp',terminationDate:'2026-05-15'}},assignments:[
 {employeeId:'one',communityName:'Alias A',bonusRoleType:'lp',status:'Terminated',effectiveEnd:'2026-05-15'},
 {employeeId:'two',communityName:'B',bonusRoleType:'gm',status:'Terminated',effectiveEnd:'2026-08-10'},
 {employeeId:'three',communityName:'A',bonusRoleType:'gm',status:'Terminated',effectiveEnd:'2025-08-10'},
 {employeeId:'four',communityName:'A',bonusRoleType:'gm',status:'Terminated',effectiveEnd:'2026-08-10'}]};
const expected=empty();expected.Q2.lp=1;expected.Q3.gm=1;
assert.deepEqual(JSON.parse(JSON.stringify(c.getPeopleRosterTurnoverByQuarterForCommunity('A',{year:2026,normalizedSharedData:terminated}).turnoverByQuarter)),expected);
console.log('PASS turnover: active-row work bounded; alias, duplicate, year and community scope preserved');
