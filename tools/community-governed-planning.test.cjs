const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/portfolio-operations-dashboard/index.html', 'utf8');
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
// Exercise the actual draft/approval handlers and normalization, not just rendering.
const form = { 'cc-goal-requiredMoveIns': '10', 'cc-goal-applicationGoal': '20', 'cc-goal-grossLeaseGoal': '10', 'cc-goal-netLeaseGoal': '8', 'cc-goal-occupancyGoal': '90', 'cc-goal-leasedGoal': '', 'cc-goal-economicGoal': '', 'cc-goal-renewalGoal': '', 'cc-goal-reason': 'Approved staffing adjustment', 'cc-goal-effective': '2026-09-18' };
let allowed = true;
const alerts = [];
Object.assign(ctx, {
  document: { getElementById: id => ({ value: form[id] ?? '', checked: false }) },
  alert: message => alerts.push(message),
  communityCommandState: ctx.defaultCommunityCommandState(),
  communityCommandCanApproveGoals: () => allowed,
  communityCommandUserLabel: () => 'Test Approver',
  getProp: () => ({ name: 'Doro' }), getCurrentCommunityRecord: () => ({}),
  matchPropertyName: name => name,
  buildCommunityCommandModel: () => model,
  buildCommunityCommandLeasingPlanRows: () => Array.from({ length: 12 }, (_, monthIdx) => ({ monthIdx, occupancy: { beginningUnits: 100, warnings: [], inputs: {}, lineage: { source: 'verified' } } })),
  communityCommandPersist: () => {},
  atlasBonusPeopleEmployees: () => [],
  dataImport2State: { exceptions: [] }
});
const editor = { propName: 'Doro', monthIdx: 8, year: 2026, recommended: { applicationGoal: 18, grossLeaseGoal: 9, netLeaseGoal: 7 } };
ctx.communityCommandGoalEditor = editor;
ctx.saveCommunityCommandGoalEditor(false);
assert.equal(ctx.communityCommandState.approvedGoals.length, 0);
assert.equal(ctx.communityCommandState.goalDrafts[0].status, 'Draft');
ctx.communityCommandGoalEditor = editor;
ctx.saveCommunityCommandGoalEditor(true);
assert.equal(ctx.communityCommandState.approvedGoals.length, 1);
assert.equal(ctx.communityCommandState.goalDrafts.length, 0);
assert.equal(ctx.communityCommandState.approvedGoals[0].weeklyGoals.reduce((sum, week) => sum + week.applicationGoal, 0), 20);
assert.equal(ctx.communityCommandState.approvedGoals[0].recommended.applicationGoal, 18);
form['cc-goal-applicationGoal'] = '22';
ctx.communityCommandGoalEditor = editor;
ctx.saveCommunityCommandGoalEditor(true);
assert.equal(ctx.communityCommandState.approvedGoals.length, 2, 'Approved history is never replaced');
assert.equal(ctx.communityCommandState.approvedGoals[0].version, 2);
assert.equal(ctx.communityCommandState.approvedGoals[1].applicationGoal, 20);
allowed = false;
ctx.communityCommandGoalEditor = editor;
ctx.saveCommunityCommandGoalEditor(true);
assert.equal(ctx.communityCommandState.approvedGoals.length, 2);
assert.equal(alerts.length, 0);
allowed = true;
form['cc-goal-applicationGoal'] = '';
ctx.saveCommunityCommandGoalEditor(true);
assert.equal(ctx.communityCommandState.approvedGoals.length, 2, 'Missing goals cannot be approved as zero');
assert.equal(alerts.length, 1);
console.log('PASS real draft save, authorized approval, exact weekly sums, immutable recommendations, revisions and missing-goal guard');
