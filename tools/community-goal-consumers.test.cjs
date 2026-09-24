const {readDashboardSource}=require('./dashboard-source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = readDashboardSource('docs/portfolio-operations-dashboard/index.html') + '\n' + fs.readFileSync('docs/portfolio-operations-dashboard/community-goal-editor.js', 'utf8');
const ctx = vm.createContext({ console, Date, Map, Set, window: {} });
const scopeInitializer = html.match(/^let atlasSynchronousReadScope = null;$/m);
assert(scopeInitializer, 'Real synchronous-read scope initializer');
vm.runInContext(scopeInitializer[0], ctx);
for (const match of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(match[0], ctx);
const plain = value => JSON.parse(JSON.stringify(value));
Object.assign(ctx, {
  matchPropertyName: name => name,
  getAtlasTodayISODate: () => '2026-09-22',
  communityCommandState: ctx.defaultCommunityCommandState(),
  getRecordMonthlyDataForYear: (record, year) => record.years?.[year] || [],
  FULL_MONTHS: Array.from({length:12}, (_,i) => `Month ${i+1}`),
  getAtlasCentralStatus: () => ({configured:true,signedIn:true}),
  window:{ATLAS_CENTRAL:{getSession:()=>({user:{id:'synthetic'}}),getAccessContextKey:()=> 'synthetic-access',getConfig:()=>({supabaseUrl:'https://fixture.invalid'})}},
  ATLAS_STATE_DB_NAME:'synthetic-goals',atlasWorkspaceAccess:{validated:true,epoch:1},
  communityCommandGoalBuffers:new Map(),communityCommandGoalNotices:new Map(),communityCommandGoalEditor:null,
  getAtlasCommunityAccessRecord: name => ({atlasCommunityId:name}),
  atlasCommunityGoalStore: {scopes:new Map()}
});
ctx.syncCommunityCommandGoalContext();
const goal = (community, month, year, values = {}, version = 1) => ({
  id: `${community}-${year}-${month}-${version}`, propName: community, monthIdx: month, year,
  status: 'Approved', approvedAt: `${year}-01-01T12:00:00Z`, effectiveDate: `${year}-01-01`,
  approver: 'Synthetic reviewer', reason: 'Synthetic saved adjustment', version,
  applicationGoal: 10, grossLeaseGoal: 8, netLeaseGoal: 6, requiredMoveIns: 5,
  occupancyGoal: 47.6, leasedGoal: 50, economicGoal: null, renewalGoal: null,
  weeklyGoals: [{week:1,startDay:1,applicationGoal:10,grossLeaseGoal:8,netLeaseGoal:6}], ...values
});
ctx.communityCommandState.approvedGoals = [
  goal('A',7,2026,{applicationGoal:0,grossLeaseGoal:0,netLeaseGoal:0,requiredMoveIns:0}),
  goal('A',8,2026,{applicationGoal:12}), goal('B',7,2026,{applicationGoal:33}),
  goal('A',7,2025,{applicationGoal:44}), goal('A',8,2026,{applicationGoal:99,effectiveDate:'2026-09-30'},2)
];
ctx.communityCommandState.goalDrafts = [goal('A',7,2026,{status:'Draft',applicationGoal:77})];
function publishFixtureApprovals() {
  const groups = new Map();
  for (const item of ctx.communityCommandState.approvedGoals) {
    const key=ctx.communityCommandGoalScope(item.propName,item.monthIdx,item.year).key;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(item);
  }
  ctx.atlasCommunityGoalStore.scopes = new Map([...groups].map(([key,approvedHistory]) => [key,{approvedHistory}]));
}
publishFixtureApprovals();
assert.equal(ctx.getCommunityCommandApprovedGoal('A',7,2026).applicationGoal,0);
assert.equal(ctx.getCommunityCommandApprovedGoal('A',8,2026).applicationGoal,12,'future effective revision does not replace active goal');
assert.equal(ctx.getCommunityCommandApprovedGoal('B',7,2026).applicationGoal,33);
assert.equal(ctx.getCommunityCommandApprovedGoal('A',7,2025).applicationGoal,44);
assert.equal(ctx.getCommunityCommandApprovedGoal('B',8,2026),null);

// Approved columns must use official values including zero; live recommendations remain separate.
const occupancy = Array.from({length:12}, () => ({beginningPct:40,endingActualPct:45,endingForecastPct:46}));
Object.assign(ctx, {
  communityCommandOccupancyPeriods: () => occupancy,
  getApplicationDecisionMetrics: entry => ({applications:entry.applications ?? 0}),
  getEffectiveMoveOutsForMonth: () => ({effective:2}),
  getRenewalSummaryForMonth: () => ({expirations:0}),
  getRenewalMonthEntryForRecord: () => ({}),
  getExplicitLeaseSignedCount: entry => entry.leasesSignedActual ?? 0
});
const model = {propName:'A',year:2026,monthIdx:7,monthlyData:Array.from({length:12},()=>({})),record:{},schedule:Array.from({length:12},()=>({budgetOcc:47.6,recommendedApps:88,recommendedGrossLeases:66,netOccLeases:9}))};
let rows = ctx.buildCommunityCommandLeasingPlanRows(model);
assert.equal(rows[7].approvedApps,0); assert.equal(rows[7].approvedGrossLeases,0); assert.equal(rows[7].approvedNetLeases,0);
assert.equal(rows[7].recommendedApps,88); assert.equal(rows[7].recommendedGrossLeases,66);
assert.equal(rows[8].approvedApps,12); assert.equal(rows[6].approvedApps,null);
assert.equal(rows[7].approved.weeklyGoals[0].applicationGoal,10,'weekly allocations come from the approved record');
model.schedule[7].recommendedApps=101;
rows=ctx.buildCommunityCommandLeasingPlanRows(model);
assert.equal(rows[7].approvedApps,0); assert.equal(rows[7].recommendedApps,101);

// Physical targets cannot be replaced by lease production, and an approved zero is binding.
assert.equal(ctx.getMoveInTargetFromScheduleRow({approvedRequiredMoveIns:0,netOccLeases:9,grossLeases:12}),0);
assert.equal(ctx.getMoveInTargetFromScheduleRow({approvedRequiredMoveIns:4,netOccLeases:9,grossLeases:12}),4);
assert.equal(ctx.getMoveInTargetFromScheduleRow({approvedRequiredMoveIns:null,netOccLeases:9,grossLeases:12}),9);
assert.equal(ctx.getMoveInTargetFromScheduleRow({netOccLeases:0,grossLeases:12}),0);
assert.equal(ctx.getMoveInTargetFromScheduleRow({grossLeases:12}),0);

// Actual schedule calculations feed downstream performance/report goals without changing recommendations.
Object.assign(ctx, {
  MONTHS:ctx.FULL_MONTHS,DEFAULT_SEASONAL:Array(12).fill(1),
  getReportedOccupancyBaseUnits:(_entry,total)=>total,
  getComparableOccupancyUnits:(units,corporate)=>Math.max(0,units-(corporate||0))
});
const scheduleContext={propName:'A',year:2026,totalUnits:200,corporateLeaseUnits:0,countsAreComparable:true,currentOccupied:80,currentLeased:90,occupancyGoal:95,leasedGoal:97,currentMonth:7,conversionRate:65,monthlyData:Array.from({length:12},()=>({})),savedBudgetTargets:Array(12).fill(47.6),seasonal:Array(12).fill(1)};
let scheduled=ctx.computeScheduleFromContext(scheduleContext);
assert.equal(scheduled[7].apps,0);assert.equal(scheduled[7].grossLeases,0);
assert.equal(scheduled[7].approvedRequiredMoveIns,0);assert.equal(ctx.getMoveInTargetFromScheduleRow(scheduled[7]),0);
assert(scheduled[7].recommendedApps>0);assert(scheduled[7].recommendedGrossLeases>0);
assert(scheduled[7].netOccLeases>0,'physical recommendation remains separate from official move-ins');
assert.equal(scheduled[8].apps,12);assert.equal(scheduled[7].approvedGoalId,'A-2026-7-1');
scheduleContext.savedBudgetTargets=Array(12).fill(60);
scheduled=ctx.computeScheduleFromContext(scheduleContext);
assert.equal(scheduled[7].apps,0);assert.equal(scheduled[7].grossLeases,0);
assert.equal(ctx.getMoveInTargetFromScheduleRow(scheduled[7]),0);
scheduleContext.propName='No saved goal';scheduleContext.monthlyData[7]={grossLeaseGoalManual:0,appGoalManual:0};
scheduled=ctx.computeScheduleFromContext(scheduleContext);
assert.equal(scheduled[7].apps,0);assert.equal(scheduled[7].grossLeases,0,'legacy manual zero remains intentional');

// Bonus Engine must consume approved same-period goals, never a draft or a selected dashboard month.
const provenance = (community, period, date) => ({community,period,dataAsOf:date,source:'Synthetic verified source'});
ctx.savedData = {A:{years:{2026:Array.from({length:12},()=>({}))}},B:{years:{2026:Array.from({length:12},()=>({}))}}};
const entry = ctx.savedData.A.years[2026][7] = {applications:0,leasesSignedActual:0,rentableUnits:200,occupiedSnapshot:90,leasedSnapshot:100,metricProvenance:{applications:provenance('A','2026-08','2026-08-31'),leasesSignedActual:provenance('A','2026-08','2026-08-31'),occupiedSnapshot:provenance('A','2026-08','2026-08-31'),leasedSnapshot:provenance('A','2026-08','2026-08-31')}};
const period={start:'2026-08-01',end:'2026-08-31'},employee={communityName:'A'};
let result=ctx.communityCommandBonusGoalResult(employee,{metricKey:'applications'},period);
assert.equal(result.goal,0);assert.equal(result.actual,0);assert.equal(result.reason,'');
assert.equal(result.versions[0].id,'A-2026-7-1');
ctx.communityCommandState.goalDrafts[0].applicationGoal=999;
assert.equal(ctx.communityCommandBonusGoalResult(employee,{metricKey:'applications'},period).goal,0);
ctx.communityCommandState.approvedGoals.unshift(goal('A',7,2026,{applicationGoal:24},2));
publishFixtureApprovals();
assert.equal(ctx.communityCommandBonusGoalResult(employee,{metricKey:'applications'},period).goal,24);
assert.equal(ctx.communityCommandBonusGoalResult({communityName:'B'},{metricKey:'applications'},period).actual,null,'another community cannot reuse A actuals');
assert.equal(ctx.communityCommandBonusGoalResult(employee,{metricKey:'applications'},{start:'2026-08-02',end:'2026-08-31'}).actual,null,'partial periods do not borrow whole-month goals');
result=ctx.communityCommandBonusGoalResult(employee,{metricKey:'occupancy'},period);
assert.equal(result.goal,47.6);assert.equal(result.actual,45,'physical attainment uses occupied units');
result=ctx.communityCommandBonusGoalResult(employee,{metricKey:'leased_pct'},period);
assert.equal(result.goal,50);assert.equal(result.actual,50,'leased attainment uses leased units independently');
entry.metricProvenance.occupiedSnapshot.dataAsOf='2026-08-30';
assert.equal(ctx.communityCommandBonusGoalResult(employee,{metricKey:'occupancy'},period).actual,null,'physical month-end requires verified month-end actual');
assert.equal(ctx.communityCommandBonusGoalResult(employee,{metricKey:'leased_pct'},period).actual,50);
console.log('PASS isolated approved community/year/month goals, zero values, independent recommendations, approved columns/weekly lineage, and Bonus Engine period and physical/leased boundaries');

(async () => {
  const {reportHtml, reportGoalRows} = await import('../docs/portfolio-operations-dashboard/features/community-plan-report.mjs');
  const record = {report_id:'synthetic-report',plan_version:1,created_at:'2026-09-22T12:00:00Z',snapshot:{community:'A',period:'2026-08',sourceUpdatedAt:'2026-09-22',plan:{tasks:[]},approvedGoals:{...goal('A',7,2026,{applicationGoal:0,grossLeaseGoal:0,netLeaseGoal:0,requiredMoveIns:0,economicGoal:null,reason:'Review <adjustment>',weeklyGoals:[{week:1,startDay:1,applicationGoal:0,grossLeaseGoal:0,netLeaseGoal:0}]},3),approvedBy:'synthetic-user'},occupancy:{physicalPct:45,budgetPct:47.6,variance:-5}}};
  const before=JSON.stringify(record);
  const output=reportHtml(record),tables=reportGoalRows(record);
  assert(output.includes('Goal version 3'));assert(output.includes('Review &lt;adjustment&gt;'));
  assert(output.includes('<td>Applications</td><td>0</td>'));
  assert(output.includes('<td>Economic occupancy</td><td>Not set</td>'));
  assert(output.includes('<td>Physical occupancy</td><td>47.6%</td>'));
  assert(output.includes('<td>Leased occupancy</td><td>50%</td>'));
  assert.equal(tables.goals.find(row=>row.Metric==='Applications').Approved_goal,0);
  assert.equal(tables.goals.find(row=>row.Metric==='Economic occupancy').Approved_goal,null);
  assert.equal(tables.weekly[0].Applications,0);assert.equal(tables.weekly[0].Goal_version,3);
  assert.equal(tables.goals[0].Approved_by,'synthetic-user');assert.equal(tables.goals[0].Adjustment_reason,'Review <adjustment>');
  ctx.communityCommandState.approvedGoals.unshift(goal('A',7,2026,{applicationGoal:900},99));
  assert.equal(ctx.getCommunityCommandApprovedGoal('A',7,2026).applicationGoal,24,'workspace imports cannot overwrite canonical official goals');
  assert.equal(reportHtml(record),output,'report output uses its immutable approved snapshot, never current goals');
  assert.equal(JSON.stringify(record),before,'render and export do not mutate report snapshot');
  const legacy={...record,snapshot:{...record.snapshot,approvedGoals:undefined}};
  assert(reportHtml(legacy).includes('No approved goals were retained in this report snapshot.'));
  assert.deepEqual(reportGoalRows(legacy),{goals:[],weekly:[]});
  console.log('PASS exact approved snapshot parity in HTML/XLSX rows, goal/weekly lineage, zero vs missing, physical vs leased labels and immutable legacy reports');
})().catch(error=>{console.error(error);process.exitCode=1;});

const newer={revision:4,draft:{applicationGoal:44},approved:{applicationGoal:40},approvedHistory:[{version:3}],recommendationRevision:1,recommended:{applicationGoal:10}};
const lateRecommendation={revision:2,draft:null,approved:{applicationGoal:20},approvedHistory:[{version:2}],recommendationRevision:3,recommended:{applicationGoal:99}};
const merged=ctx.mergeCommunityCommandGoalScope(lateRecommendation,newer);
assert.equal(merged.draft.applicationGoal,44);assert.equal(merged.approved.applicationGoal,40);assert.equal(merged.recommended.applicationGoal,99);assert.equal(merged.revision,4);
