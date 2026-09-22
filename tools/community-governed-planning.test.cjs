const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/portfolio-operations-dashboard/index.html', 'utf8') + '\n' + fs.readFileSync('docs/portfolio-operations-dashboard/community-goal-editor.js', 'utf8');
const ctx = vm.createContext({ console, Date, Map, Set });
for (const match of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(match[0], ctx);
Object.assign(ctx, {
  getAtlasTodayISODate: () => '2026-09-18',
  getReportedOccupancyBaseUnits: entry => entry?.rentableUnits ?? 247,
  getCommunityCommandDashboardOverride: () => null,
  getCommunityCommandApprovedGoal: (_, month) => month >= 8 ? { netLeaseGoal: 5, grossLeaseGoal: 8 } : null
});
const provenance = (date, field = 'occupied_units') => ({ community: 'Doro', period: date.slice(0, 7), source: 'entrata-approved', dataAsOf: date, field });
const snapshot = (date, units) => ({ rentableUnits: 247, occupiedSnapshot: units, metricProvenance: { occupiedSnapshot: provenance(date) } });
const model = { propName: 'Doro', year: 2026, monthIdx: 8, totalUnits: 247, corporateUnits: 0, record: { monthlyHistoryByPeriod: {} }, monthlyData: Array.from({ length: 12 }, () => ({})) };
model.monthlyData[8] = snapshot('2026-09-17', 78);
let periods = ctx.communityCommandOccupancyPeriods(model);
assert.equal(periods[8].beginningUnits, null, 'Current snapshot cannot become beginning');
assert.equal(periods[8].endingForecastPct, null);
assert.equal(model.monthlyData[8].occupiedSnapshot, 78, 'Current source value remains intact');
assert.equal((78 / 247 * 100).toFixed(1), '31.6');
model.monthlyData[7] = snapshot('2026-08-31', 100);
model.monthlyData[8].forecastMoveIns = 10;
model.monthlyData[8].forecastMoveOuts = 4;
model.monthlyData[9].forecastMoveIns = 8;
model.monthlyData[9].forecastMoveOuts = 3;
periods = ctx.communityCommandOccupancyPeriods(model);
assert.equal(periods[8].beginningUnits, 100);
assert.equal(periods[8].endingForecastUnits, 106);
assert.equal(periods[9].beginningUnits, 106);
assert.equal(periods[9].endingForecastUnits, 111);
model.monthlyData[8].forecastMoveIns = 11;
assert.equal(ctx.communityCommandOccupancyPeriods(model)[9].beginningUnits, 107);
model.monthlyData[9].rentableUnits = 248;
assert.equal(ctx.communityCommandOccupancyPeriods(model)[9].beginningUnits, null);
model.record.monthlyHistoryByPeriod['2025-12'] = snapshot('2025-12-31', 90);
assert.equal(ctx.communityCommandOccupancyPeriods(model)[0].beginningUnits, 90);
model.record.monthlyHistoryByPeriod['2025-12'].metricProvenance.occupiedSnapshot.dataAsOf = '2025-12-20';
assert.equal(ctx.communityCommandOccupancyPeriods(model)[0].beginningUnits, null);
assert.equal(ctx.communityCommandBoundarySnapshot(snapshot('2026-09-01', 300), '2026-09-01', 247, 'Doro'), null);
assert.equal(ctx.communityCommandBoundarySnapshot(snapshot('2026-09-01', 78), '2026-09-01', 247, 'Other'), null);
assert.equal(ctx.communityCommandFormatPct(null), 'Missing');
for (let total = 0; total <= 31; total++) {
  const weekly = ctx.communityCommandWeeklyAllocation(total, 5);
  assert.equal(weekly.reduce((sum, value) => sum + value, 0), total);
  assert(Math.max(...weekly) - Math.min(...weekly) <= 1);
}
assert.equal(ctx.communityCommandWeeklyAllocation(null, 3).length, 0);
const financial = { 8: { closedFinancialActuals: {netRentalIncome: 100, grossPotentialRent: 200, period: '2026-09', coverage: 'full_month', status:'closed', source:'closed package page 3', approvedBy:'Reviewer', approvedAt:'2026-10-05'} } };
ctx.getRecordMonthlyDataForYear = () => financial;
ctx.window={AtlasClosedFinancialCache:{get:()=>{const x=financial[8].closedFinancialActuals;return x?{metrics:x,period_key:x.period,status:x.status,coverage:x.coverage,source_file:x.source,approved_by:x.approvedBy,approved_at:x.approvedAt}:null;}}};
assert.equal(ctx.getCommunityCommandEconomicOccupancyData({}, 8, 2026).mtdPct, 50);
financial[8].closedFinancialActuals.coverage = 'mtd';
assert.equal(ctx.getCommunityCommandEconomicOccupancyData({}, 8, 2026).mtdPct, null);
financial[8] = { unpaidRent: 100 };
assert.equal(ctx.getCommunityCommandEconomicOccupancyData({}, 8, 2026).mtdPct, null);
console.log('PASS historical date/community/denominator checks, January boundary, forecast roll-forward, missing values, weekly totals, financial coverage');
// Exercise the actual asynchronous handlers at the canonical persistence boundary.
(async () => {
  const fields = ["requiredMoveIns","applicationGoal","grossLeaseGoal","netLeaseGoal","occupancyGoal","leasedGoal","economicGoal","renewalGoal"];
  const form = { 'cc-goal-requiredMoveIns':'10','cc-goal-applicationGoal':'20','cc-goal-grossLeaseGoal':'10','cc-goal-netLeaseGoal':'8','cc-goal-occupancyGoal':'90','cc-goal-leasedGoal':'','cc-goal-economicGoal':'','cc-goal-renewalGoal':'','cc-goal-reason':'Approved staffing adjustment','cc-goal-effective':'2026-09-18' };
  let allowed=true,version=0,saved=null,releaseSave=null,failSave=false;
  const writes=[];
  const module={saveGoals:async(central,args)=>{
    writes.push(args);
    if(failSave)throw Error('Synthetic persistence failed');
    if(releaseSave===null)await new Promise(resolve=>{releaseSave=resolve;});
    const record={...args.payload,status:args.kind==='approved'?'Approved':'Draft',id:'goal-'+(version+1),version:++version,revisedAt:'2026-09-22T12:00:00Z',approvedAt:args.kind==='approved'?'2026-09-22T12:00:00Z':'',approver:args.kind==='approved'?'Synthetic approver':''};
    saved={revision:version,draft:args.kind==='draft'?record:null,approved:args.kind==='approved'?record:saved?.approved??null,savedRecord:record};
    return saved;
  }};
  Object.assign(ctx, {
    COMMUNITY_GOAL_FIELDS:fields,
    crypto:require('node:crypto').webcrypto,
    CustomEvent:class {constructor(type,init){this.type=type;this.detail=init?.detail;}},
    document:{getElementById:id=>Object.hasOwn(form,id)?{value:form[id]}:null},
    window:{ATLAS_CENTRAL:{},dispatchEvent:()=>{}},
    communityCommandState:ctx.defaultCommunityCommandState(),
    communityCommandCanApproveGoals:()=>allowed,
    communityCommandGoalBuffers:new Map(),communityCommandGoalNotices:new Map(),
    atlasCommunityGoalStore:{actor:'synthetic',scopes:new Map(),module},
    atlasBonusNavigationSnapshot:null,atlasBonusSectionCache:new Map(),
    getProp:()=>({name:'Doro'}),getCurrentCommunityRecord:()=>({}),
    matchPropertyName:name=>name,
    buildCommunityCommandModel:()=>model,
    buildCommunityCommandLeasingPlanRows:()=>Array.from({length:12},(_,monthIdx)=>({monthIdx,occupancy:{beginningUnits:100,warnings:[],inputs:{},lineage:{source:'verified'}}})),
    renderTab:()=>{},renderPropGrid:()=>{},
    dataImport2State:{exceptions:[]}
  });
  const editor={propName:'Doro',communityId:'synthetic-community',monthIdx:8,year:2026,period:'2026-09',key:'synthetic-community|2026-09',revision:0,values:{},recommended:{applicationGoal:18,grossLeaseGoal:9,netLeaseGoal:7},reason:'',effectiveDate:'2026-09-18'};
  ctx.communityCommandGoalEditor=editor;
  const pending=ctx.saveCommunityCommandGoalEditor(false);
  assert.equal(editor.saving,true);
  assert(!editor.message?.includes('Draft saved'),'success waits for committed persistence/readback');
  assert.equal(ctx.atlasCommunityGoalStore.scopes.size,0);
  releaseSave();await pending;
  assert.equal(writes[0].kind,'draft');assert.equal(editor.values.applicationGoal,20);
  assert.equal(editor.values.status,'Draft');assert(editor.message.startsWith('Draft saved'));
  assert.equal(ctx.communityCommandState.goalDrafts.length,0,'canonical saves never mutate browser workspace goal records');
  await ctx.saveCommunityCommandGoalEditor(true);
  assert.equal(writes[1].kind,'approved');assert.equal(writes[1].expectedRevision,1);
  const approval=ctx.atlasCommunityGoalStore.scopes.get(editor.key).approved;
  assert.equal(approval.applicationGoal,20);assert.equal(approval.weeklyGoals.reduce((sum,w)=>sum+w.applicationGoal,0),20);
  assert.equal(approval.recommended.applicationGoal,18);assert.equal(approval.reason,'Approved staffing adjustment');
  assert.equal(approval.effectiveDate,'2026-09-18');assert.equal(approval.approver,'Synthetic approver');
  assert(editor.message.startsWith('Goals approved'));
  form['cc-goal-applicationGoal']='22';failSave=true;
  await ctx.saveCommunityCommandGoalEditor(false);
  assert(editor.error.includes('Synthetic persistence failed'));assert.equal(editor.message,'');
  assert.equal(editor.values.applicationGoal,22,'failed save retains edited values');
  assert.equal(ctx.atlasCommunityGoalStore.scopes.get(editor.key).approved.applicationGoal,20,'failure cannot change official goal');
  assert.equal(ctx.communityCommandGoalBuffers.get(editor.key),editor);
  const beforeDenied=writes.length;allowed=false;
  await ctx.saveCommunityCommandGoalEditor(true);assert.equal(writes.length,beforeDenied);
  allowed=true;failSave=false;form['cc-goal-applicationGoal']='';
  await ctx.saveCommunityCommandGoalEditor(true);
  assert.equal(writes.length,beforeDenied,'missing production goal cannot be approved as zero');
  assert(editor.error.includes('Complete every production goal'));
  for(const field of ['requiredMoveIns','applicationGoal','grossLeaseGoal','netLeaseGoal'])form['cc-goal-'+field]='0';
  await ctx.saveCommunityCommandGoalEditor(true);
  assert.equal(ctx.atlasCommunityGoalStore.scopes.get(editor.key).approved.applicationGoal,0,'intentional zero persists');
  assert.equal(ctx.atlasCommunityGoalStore.scopes.get(editor.key).approved.weeklyGoals.reduce((sum,w)=>sum+w.applicationGoal,0),0);
  console.log('PASS awaited canonical draft/approval, success after readback, no browser workspace mutation, approval metadata, exact weekly sums, failure retention, authorization/missing guards and intentional zero');
})().catch(error=>{console.error(error);process.exitCode=1;});
