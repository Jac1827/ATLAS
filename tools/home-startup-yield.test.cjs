const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {readDashboardSource}=require('./dashboard-source.cjs');
const core=readDashboardSource(__dirname+'/../docs/portfolio-operations-dashboard/index.html'),reskin=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/atlas-dashboard-reskin.js','utf8');
const extract=(name,async=false)=>core.match(new RegExp('^'+(async?'async ':'')+'function '+name+'\\([^]*?^\\}','m'))[0];
function fixture(){const c={console,structuredClone};vm.createContext(c);vm.runInContext(`
const getComputedStyle=()=>({getPropertyValue:()=>''});const document={readyState:'loading',addEventListener(){}};const window={addEventListener(){},ATLAS_CENTRAL:{getAccessContextKey:()=>actor}};
let actor='actor-a',month=2,calls=0,yields=0,valid=true;const localStorage={getItem:()=>null};
const PROPERTIES=[{name:'Synthetic'}],MONTHS=['Jan','Feb','Mar'],getProp=()=>PROPERTIES[0],getAtlasTodayISODate=()=> '2026-09-24',getSelectedDashboardMonthIndex=()=>month;
const atlasCommunityGoalStore={actor:'actor-a',scopes:new Map()},atlasWorkspaceAccess={source:{version:1}},communityCommandState={};let bonusQuarter='Q3',atlasHomeRenderDetails=null;
const snapshot={scopedDetails:[{name:'Synthetic',record:{reportYear:2026,monthlyData:[null,{occ:0,budget:95},{occ:84.5,budget:null}]}}]};
function getRecordMonthlyDataForYear(record){return record.monthlyData;}
function dashboardMonthlyEntryHasData(entry){return entry!==null;}
function buildCommunityDetailForMonth(name,record,m){calls++;return {summary:{occPct:record.monthlyData[m].occ,budgetOccPct:record.monthlyData[m].budget,budgetOccCoverage:{complete:record.monthlyData[m].budget!==null}}};}
function aggregateCommunitySummaries(rows){return rows[0]||{};}
function atlasDashboardMetricChartValues(instance,model){return [model.scopedDetails[0].summary.occPct];}
let widgets=[];const getAtlasDashboardViewWidgets=()=>widgets,getAtlasActiveDashboardView=()=>({});
function buildAtlasDashboardScopedDetails(instance, options){if(options?.includeSummary!==false)throw Error('Preparation must request records without current summaries');return instance.scope?.propertyName?snapshot.scopedDetails.filter(row=>row.name===instance.scope.propertyName):snapshot.scopedDetails;}
let visibleSnapshots=0;const buildAtlasDashboardWidgetSnapshot=()=>{visibleSnapshots++;return snapshot;};
const getAtlasCentralStatus=()=>({}),atlasUserDisplayName=()=> 'Synthetic',getAtlasAccessProfile=()=>({}),getAtlasDashboardLatestDataUploadAt=()=>0,renderAtlasDashboardWeatherPillContents=()=>'',escapeHtml=String;

const read=()=>window.AtlasReskin.history({widgetKey:'portfolio_overview'},snapshot);
`,c);vm.runInContext(extract('atlasExactPresentationInputString'),c);vm.runInContext(reskin,c);return c;}
(async()=>{
 let c=fixture();const run=code=>vm.runInContext(code,c),plain=x=>JSON.parse(JSON.stringify(x));
 assert.equal(await run('window.AtlasReskin.prepareInitialHome({current:()=>valid,yieldTask:async()=>{yields++;}})'),true);
 assert.equal(run('yields'),5,'Preparation yields before work, between each month and before retained-result publication');
 assert.equal(run('visibleSnapshots'),0,'Preparation does not build/format a visible current summary');
 assert.equal(run('calls'),2);assert.deepEqual(plain(run('read()')),{data:[null,0,84.5],budget:[null,95,null],labels:['Jan','Feb','Mar']});assert.equal(run('calls'),2,'Rendered chart consumes exact prepared rows without recalculation');
 c=fixture();assert.throws(()=>run('window.AtlasReskin.home({preparedOnly:true})'),error=>error.code==='ATLAS_HOME_PREPARATION_REQUIRED');assert.equal(run('calls'),0,'Visible Home refuses a synchronous monthly cache miss');
 await run('window.AtlasReskin.prepareInitialHome({yieldTask:async()=>{}})');assert.match(run('window.AtlasReskin.home({preparedOnly:true})'),/atlas-home-dashboard/);assert.equal(run('calls'),2);
 run('atlasWorkspaceAccess.source.version++');assert.throws(()=>run('window.AtlasReskin.home({preparedOnly:true})'),error=>error.code==='ATLAS_HOME_PREPARATION_REQUIRED');assert.equal(run('calls'),2,'A changed source requests fresh preparation before rendering');
 await run('window.AtlasReskin.prepareInitialHome({yieldTask:async()=>{}})');assert.match(run('window.AtlasReskin.home({preparedOnly:true})'),/atlas-home-dashboard/);assert.equal(run('calls'),4);
 c=fixture();run('snapshot.scopedDetails=Array.from({length:7},(_,i)=>({name:"Synthetic"+i,record:{reportYear:2026,monthlyData:[null,{occ:0,budget:95},{occ:84.5,budget:null}]}}));let lastCalls=0,maxChunk=0;');await run('window.AtlasReskin.prepareInitialHome({yieldTask:async()=>{maxChunk=Math.max(maxChunk,calls-lastCalls);lastCalls=calls;}})');assert.equal(run('calls'),14);assert.ok(run('Math.max(maxChunk,calls-lastCalls)')<=3,'Large monthly history yields between groups of at most three community calculations');
 c=fixture();run('snapshot.scopedDetails=Array.from({length:4},(_,i)=>({name:"Synthetic"+i,record:{reportYear:2026,monthlyData:[null,{occ:0,budget:95},{occ:84.5,budget:null}]}}));widgets=snapshot.scopedDetails.map(row=>({widgetKey:"portfolio_overview",metric:"Physical Occupancy",scope:{type:"single_property",propertyName:row.name}}));');await run('window.AtlasReskin.prepareInitialHome({yieldTask:async()=>{}})');const multiCalls=run('calls');run('read();for(const widget of widgets)window.AtlasReskin.history(widget,{scopedDetails:buildAtlasDashboardScopedDetails(widget,{includeSummary:false})});');assert.equal(run('calls'),multiCalls,'One-use prepared rows cover five scopes even when the three-entry persistent cache evicts earlier scopes');
 c=fixture();assert.equal(await run('window.AtlasReskin.prepareInitialHome({current:()=>valid,yieldTask:async()=>{if(++yields===3)valid=false;}})'),false);assert.equal(run('calls'),0,'Cancellation before a month prevents its calculation');run('read()');assert.equal(run('calls'),2,'Cancelled preparation publishes no partial rows');
 c=fixture();assert.equal(await run('window.AtlasReskin.prepareInitialHome({current:()=>true,yieldTask:async()=>{if(++yields===4)snapshot.scopedDetails[0].record.monthlyData[1].occ=40;}})'),false,'An input edit invalidates detached prepared results before they enter the cache');const before=run('calls');assert.deepEqual(plain(run('read().data')),[null,40,84.5]);assert.equal(run('calls'),before+2);
 c=fixture();assert.equal(await run('window.AtlasReskin.prepareInitialHome({current:()=>actor==="actor-a",yieldTask:async()=>{if(++yields===3)actor="actor-b";}})'),false);run('read()');assert.equal(run('calls'),2);
 const scheduled=[],order=[];let current=true;const d={atlasHomeRenderPreparation:null,setTimeout:fn=>scheduled.push(fn),window:{AtlasReskin:{prepareInitialHome:async({current:guard,yieldTask})=>{order.push('prepare');await yieldTask();return guard();}}},runAtlasStartupStep:(label,fn)=>{order.push(label);fn();},syncSharedPeopleAssignments(){},syncAllCommunityStaffingFromPeopleRoster(){},loadPropertyData(){},getProp:()=>({name:'Synthetic'}),renderPropGrid(){},shouldRenderAtlasWelcomeDashboard:()=>true,getAtlasRenderContextKey:()=> 'same-context',finishAtlasStartupLoadingState:()=>order.push('finished'),renderTab:()=>order.push('rendered')};vm.createContext(d);vm.runInContext(extract('runAtlasInitialRenderPassYielding',true),d);
 let task=d.runAtlasInitialRenderPassYielding(()=>current);assert.equal(order.includes('finished'),false);
 while(scheduled.length){scheduled.shift()();await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(await task,true);assert.ok(order.indexOf('finished')>order.indexOf('prepare'));assert.ok(order.indexOf('finished')>order.indexOf('rendered'),'Startup becomes usable only after final render');
 order.length=0;task=d.runAtlasInitialRenderPassYielding(()=>current);current=false;while(scheduled.length){scheduled.shift()();await new Promise(resolve=>setImmediate(resolve));}assert.equal(await task,false);assert.equal(order.includes('finished'),false,'Stale actor/source initialization never marks the old workspace usable');
 console.log('PASS yielded initial Home preparation exact null/zero history parity, detached source-edit rejection, actor cancellation, no partial cache publication and usable mark only after awaited preparation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
