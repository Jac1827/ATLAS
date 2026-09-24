const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {readDashboardSource}=require('./dashboard-source.cjs');
const core=readDashboardSource(__dirname+'/../docs/portfolio-operations-dashboard/index.html');
const source=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/atlas-dashboard-reskin.js','utf8');
const extract=name=>core.match(new RegExp('^function '+name+'\\([^]*?^\\}','m'))[0];
const c={console};vm.createContext(c);
vm.runInContext(`
const listeners={};const window={addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn)};
const document={readyState:'loading',addEventListener(){}};
let access='actor-a|scope-a',day='2026-09-24',month=2,detailCalls=0,monthlyCalls=0,graph=null;
window.ATLAS_CENTRAL={getAccessContextKey:()=>access};
const localStorage={getItem:()=>graph};const PROPERTIES=[{name:'Synthetic',units:100}];
const getProp=()=>PROPERTIES[0],getAtlasTodayISODate=()=>day,getSelectedDashboardMonthIndex=()=>month;
const atlasCommunityGoalStore={actor:'actor-a',scopes:new Map()};
const atlasWorkspaceAccess={source:{version:1},binding:{scope:'a'}};
const communityCommandState={};let bonusQuarter='Q3',atlasHomeRenderDetails=new Map();
const MONTHS=['Jan','Feb','Mar'];
const snapshot={scopedDetails:[{name:'Synthetic',record:{reportYear:2026,monthlyData:[null,{occ:0,budget:95},{occ:84.5,budget:null}]}}]};
const instance={widgetKey:'portfolio_overview',metric:'Physical Occupancy'};
function getRecordMonthlyDataForYear(record){monthlyCalls++;return record.monthlyData;}
function dashboardMonthlyEntryHasData(entry){return entry!==null;}
function buildCommunityDetailForMonth(name,record,m,year,options){detailCalls++;if(options?.includeRecommendations!==false)throw Error('Charts must not calculate unused recommendations');return {summary:{occPct:record.monthlyData[m].occ,guestCards:m+1,budgetOccPct:record.monthlyData[m].budget,budgetOccCoverage:{complete:record.monthlyData[m].budget!==null}}};}
function aggregateCommunitySummaries(rows){return rows[0]||{};}
function atlasDashboardMetricChartValues(instance,model){return [instance.metric==='Guest Cards'?model.scopedDetails[0].summary.guestCards:model.scopedDetails[0].summary.occPct];}
function readHistory(target=instance){atlasHomeRenderDetails=new Map();return window.AtlasReskin.history(target,snapshot);}
`,c);
vm.runInContext(extract('atlasExactPresentationInputString'),c);vm.runInContext(source,c);
const run=code=>vm.runInContext(code,c),plain=x=>JSON.parse(JSON.stringify(x));
assert.deepEqual(plain(run('readHistory()')),{labels:['Jan','Feb','Mar'],data:[null,0,84.5],budget:[null,95,null]});
assert.equal(run('detailCalls'),2);assert.equal(run('monthlyCalls'),1,'One monthly-source read per record per calculation');
assert.deepEqual(plain(run('readHistory()')),{labels:['Jan','Feb','Mar'],data:[null,0,84.5],budget:[null,95,null]});assert.equal(run('detailCalls'),2,'Unchanged navigation reuses history summaries');
assert.deepEqual(plain(run("readHistory({...instance,metric:'Guest Cards'}).data")),[null,2,3]);assert.equal(run('detailCalls'),2,'Different chart metrics reuse the same exact monthly summaries');
for(const edit of [
 'snapshot.scopedDetails[0].record.monthlyData[1].occ=12',
 'atlasCommunityGoalStore.scopes.set("goal",{version:2,value:0})',
 'access="actor-a|new-scope"',
 'access="actor-b|new-scope";for(const fn of listeners["atlas-central-auth-change"]||[])fn()',
 'atlasWorkspaceAccess.source.version=2',
 'graph="changed-shared-property-map"',
 'day="2026-09-25"',
 'snapshot.scopedDetails[0].record.optional=undefined'
]) {const before=run('detailCalls');run(edit);run('readHistory()');assert.equal(run('detailCalls'),before+2,edit+' invalidates history');}
const before=run('detailCalls');run('delete snapshot.scopedDetails[0].record.optional;readHistory()');assert.equal(run('detailCalls'),before,'Returning to an exactly retained prior input safely reuses its matching result');run('for(const fn of listeners["atlas-central-auth-change"]||[])fn();readHistory()');assert.equal(run('detailCalls'),before,'Same-access token refresh retains results');
assert.deepEqual(plain(run('readHistory().data')),[null,12,84.5]);
run('month=1');assert.deepEqual(plain(run('readHistory().data')),[null,12]);
run('snapshot.scopedDetails[0].record.large="x".repeat(4*1024*1024)');const large=run('detailCalls');run('readHistory();readHistory()');assert.equal(run('detailCalls'),large+2,'Oversized keys safely recompute instead of retaining unbounded snapshots');
// The actual shared detail builder preserves summaries when optional recommendations are omitted.
vm.runInContext(`
let recommendationCalls=0;function normalizeSavedCommunityRecord(name,record){return record;}
function getPropertyByName(){return {units:100};}function getResolvedTotalUnitsForRecord(){return 100;}
function getCorporateLeaseUnitsForRecord(){return 0;}function getRecordComparableSnapshotUnits(record,total,m,key){return key==='occupiedSnapshot'?25:30;}
function getCommunitySummary(name,record){return {occupied:record.currentOccupied,leased:record.currentLeased,unknown:null,zero:0};}
function buildRecommendationsForRecord(){recommendationCalls++;return [{title:'Recommendation'}];}
`,c);vm.runInContext(extract('buildCommunityDetailForMonth'),c);
const details=plain(run('const testRecord={monthlyData:[{}, {}, {}]};const full=buildCommunityDetailForMonth("Synthetic",testRecord,1,2026);const chart=buildCommunityDetailForMonth("Synthetic",testRecord,1,2026,{includeRecommendations:false});({full,chart,recommendationCalls})'));
assert.deepEqual(details.chart.summary,details.full.summary);assert.deepEqual(details.chart.record,details.full.record);assert.deepEqual(details.chart.recommendations,[]);assert.equal(details.recommendationCalls,1);
console.log('PASS exact Home history values, null/zero gaps, metric reuse, record/goal/scope/actor/source/day invalidation, stable token refresh, bounded retention and omitted unused recommendations.');
// The upload label reuses only this render's exact portfolio membership, while
// community scope continues to read its current unsaved record.
const freshness={};vm.createContext(freshness);vm.runInContext(`
let portfolio=true,atlasHomeRenderDetails=new Map(),detailReads=0;
const getSelectedDashboardMonthIndex=()=>8,isPortfolioWorkspaceSelected=()=>portfolio;
const atlasHomePortfolioDetails=()=>[{name:'Other'}];
const getWorkspaceScopedDetails=()=>{detailReads++;return portfolio?[{name:'Other'}]:[{name:'Current'}];};
const getProp=()=>({name:'Current'}),getCurrentCommunityRecord=()=>({latestDlrSummary:{importedAt:'2026-09-23'}});
const savedData={Other:{latestDlrSummary:{importedAt:'2026-09-21'}}};
const normalizeSavedCommunityRecord=(name,row)=>row,normalizeImportTracking=v=>v||{},normalizeMarketSurveyData=v=>v||{};
`,freshness);vm.runInContext(extract('getAtlasDashboardLatestDataUploadAt'),freshness);
const cached=vm.runInContext('getAtlasDashboardLatestDataUploadAt()',freshness);assert.equal(vm.runInContext('detailReads',freshness),0);
assert.equal(vm.runInContext('atlasHomeRenderDetails=null;getAtlasDashboardLatestDataUploadAt()',freshness),cached);
assert.equal(vm.runInContext('portfolio=false;atlasHomeRenderDetails=new Map();getAtlasDashboardLatestDataUploadAt()',freshness),Date.parse('2026-09-23'));
