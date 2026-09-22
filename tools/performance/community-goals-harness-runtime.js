/* Test-only boundaries around functions extracted from index.html by the harness server. */
'use strict';
const FULL_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const fixtureCommunities={'Test A':'10000000-0000-0000-0000-000000000001','Test B':'10000000-0000-0000-0000-000000000002'};
const fixtureScope=JSON.parse(sessionStorage.getItem('atlas-goal-harness-scope')||'{"name":"Test A","month":8,"year":2026}');
let selectedName=fixtureScope.name,selectedMonth=fixtureScope.month,selectedYear=fixtureScope.year;
let recommendationGeneration=Number(sessionStorage.getItem('atlas-goal-harness-recommendation')||0),fixtureAway=false;
let communityCommandState={},communityCommandGoalEditor=null;
let atlasBonusNavigationSnapshot=null;
const atlasBonusSectionCache=new Map();
let dataImport2State={exceptions:[]},savedData={'Test A':{},'Test B':{}},activeTab=2;
const simpleHash=value=>Array.from(String(value)).reduce((n,c)=>Math.imul(31,n)+c.charCodeAt(0)|0,0).toString(16);
const matchPropertyName=name=>fixtureCommunities[name]?name:null;
const clampNumber=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const normalizeOptionalNumber=value=>value==null||value===''||!Number.isFinite(Number(value))?null:Number(value);
const normalizeSharedDate=value=>String(value||'').slice(0,10);
const atlasNormalizeSharedEmail=value=>String(value||'').trim().toLowerCase();
const buildPeriodKey=(month,year)=>`${year}-${String(month+1).padStart(2,'0')}`;
const getAtlasTodayISODate=()=> '2026-09-22';
const getProp=()=>({name:selectedName});
const getCurrentCommunityRecord=()=>({communityId:fixtureCommunities[selectedName],year:selectedYear});
const getSelectedDashboardMonthIndex=()=>selectedMonth;
const getAtlasCentralStatus=()=>({configured:true,connected:true,signedIn:true,userId:'00000000-0000-0000-0000-000000000001',userEmail:'fixture@example.test',role:'admin'});
const getAtlasAccessProfile=()=>({id:'00000000-0000-0000-0000-000000000001',userId:'00000000-0000-0000-0000-000000000001',role:'admin',fullName:'Fixture approver',email:'fixture@example.test'});
const atlasUserDisplayName=()=> 'Fixture approver';
const getAtlasCurrentUserLabel=()=> 'Fixture approver';
const getAtlasCommunityAccessRecord=name=>({atlasCommunityId:fixtureCommunities[name],sourceIds:{atlasCommunityId:fixtureCommunities[name]}});
const atlasBonusPeopleEmployees=()=>[];
const atlasDashboardUserCanSeeCommunityName=()=>true;
const atlasAccessDecision=()=>({ok:true});
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const persistOpsGlobalData=()=>{};
const renderPropGrid=()=>{};
const scheduleAtlasSharedRender=()=>{};
const buildCommunityCommandModel=()=>({propName:selectedName,year:selectedYear,monthIdx:selectedMonth,totalUnits:200,corporateUnits:0,monthlyData:[]});
const buildCommunityCommandLeasingPlanRows=()=>Array.from({length:12},(_,monthIdx)=>({monthIdx,recommendedApps:30+recommendationGeneration,recommendedGrossLeases:20+recommendationGeneration,netLeaseGoal:10+recommendationGeneration,requiredMoveIns:12+recommendationGeneration,budgetPct:47.6,occupancy:{beginningUnits:88,warnings:[],lineage:{source:'Synthetic verified box score'},inputs:{moveOuts:3}}}));
const getRecordMonthlyDataForYear=(record,year)=>Array.from({length:12},(_,month)=>({applications:4,leasesSignedActual:2,netLeasesActual:1,moveIns:1,metricProvenance:Object.fromEntries(['applications','leasesSignedActual','netLeasesActual','moveIns'].map(field=>[field,{source:'Synthetic verified operating record',community:selectedName,period:buildPeriodKey(month,year)}]))}));
const getCommunityCommandEconomicOccupancyData=()=>({mtdPct:null});
const communityCommandBoundarySnapshot=()=>null;
window.alert=message=>{document.querySelector('#notice').textContent=String(message);};
window.ATLAS_CENTRAL={
 getStatus:getAtlasCentralStatus,
 getSession:()=>({user:{id:'00000000-0000-0000-0000-000000000001'}}),
 async fetchJson(path,options){const r=await fetch('/__goals_api/read?path='+encodeURIComponent(path),{signal:options?.signal});const v=await r.json();if(!r.ok)throw Error(v.message||'Read failed');return v;},
 async rpc(name,args,options){const r=await fetch('/__goals_api/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,args}),signal:options?.signal});const v=await r.json();if(!r.ok)throw Error(v.message||'Save failed');return v;}
};

/* PRODUCTION_FUNCTIONS */

function fixtureConsumers(){
 const approved=getCommunityCommandApprovedGoal(selectedName,selectedMonth,selectedYear);
 const period=buildPeriodKey(selectedMonth,selectedYear);
 const bonus=communityCommandBonusGoalResult({communityName:selectedName},{metricKey:'applications'},{start:period+'-01',end:period+'-'+new Date(selectedYear,selectedMonth+1,0).getDate()});
 return {scope:{community:selectedName,period},approved,weeklyTotals:approved?Object.fromEntries(['applicationGoal','grossLeaseGoal','netLeaseGoal'].map(field=>[field,(approved.weeklyGoals||[]).reduce((sum,row)=>sum+(row[field]??0),0)])):null,bonusGoalConsumer:bonus};
}
function renderTab(){
 if(fixtureAway){document.querySelector('#screen').innerHTML='<article><h2>Other workspace page</h2><p>Return to Community Command to reopen the saved goals.</p></article>';return;}
 const model=buildCommunityCommandModel();
 document.querySelector('#screen').innerHTML=`<h2>Community Command · ${escapeHtml(selectedName)} · ${FULL_MONTHS[selectedMonth]} ${selectedYear}</h2><p>Physical occupancy: 47.6%. Leased occupancy: 44.13%. Synthetic operating data.</p>${renderCommunityCommandGoalEditor(model)}`;
 document.querySelector('#consumers').textContent=JSON.stringify(fixtureConsumers(),null,2);
}
async function fixtureInspect(){const r=await fetch('/__goals_api/inspect');document.querySelector('#database').textContent=JSON.stringify(await r.json(),null,2);}
async function fixtureLoad(){
 communityCommandState=normalizeCommunityCommandState(communityCommandState);
 await hydrateCommunityCommandGoals({force:true});
 renderTab();await fixtureInspect();
 document.querySelector('#notice').textContent='Ready. Synthetic local database; no production data.';
}
for(const [id,value] of [['community',selectedName],['month',selectedMonth],['year',selectedYear]])document.getElementById(id).value=value;
for(const id of ['community','month','year'])document.getElementById(id).addEventListener('change',async()=>{
 selectedName=document.querySelector('#community').value;selectedMonth=Number(document.querySelector('#month').value);selectedYear=Number(document.querySelector('#year').value);communityCommandGoalEditor=null;
 sessionStorage.setItem('atlas-goal-harness-scope',JSON.stringify({name:selectedName,month:selectedMonth,year:selectedYear}));
 await fixtureLoad();
});
document.querySelector('#edit').onclick=async()=>{try{await approveCommunityCommandMonthlyGoals(selectedMonth);}catch(error){alert(error.message);}};
document.querySelector('#recalculate').onclick=async()=>{recommendationGeneration+=10;sessionStorage.setItem('atlas-goal-harness-recommendation',recommendationGeneration);if(communityCommandGoalEditor)await approveCommunityCommandMonthlyGoals(selectedMonth);else renderTab();document.querySelector('#notice').textContent='Recommendations recalculated; saved goals remain separate.';};
document.querySelector('#refresh').onclick=()=>location.reload();
document.querySelector('#navigate').onclick=()=>{fixtureAway=!fixtureAway;communityCommandGoalEditor=null;document.querySelector('#navigate').textContent=fixtureAway?'Return to Community Command':'Navigate away';renderTab();};
document.querySelector('#fail').onclick=async()=>{await fetch('/__goals_api/fail',{method:'POST'});document.querySelector('#notice').textContent='Next save will return a synthetic database error.';};
document.querySelector('#inspect').onclick=fixtureInspect;
window.addEventListener('unhandledrejection',event=>alert(event.reason?.stack||event.reason));
fixtureLoad().catch(error=>alert(error.stack));
