const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/portfolio-operations-dashboard/index.html', 'utf8');
const ctx = vm.createContext({ console, Date, MONTHS: Array(12).fill('Sep') });
for (const name of ['buildRecommendationsForRecord', 'getReportedOccupancyBaseUnits', 'getOccupancyBaseUnits', 'normalizeCorporateLeaseUnits']) {
  vm.runInContext(html.match(new RegExp('^function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'))[0], ctx);
}
Object.assign(ctx, {
  normalizeSavedCommunityRecord: (_, r) => r,
  getPropertyByName: () => ({}), getResolvedTotalUnitsForRecord: (_, r) => r.total,
  getCorporateLeaseUnitsForRecord: () => 0,
  computeScheduleFromContext: () => [],
  getApplicationDecisionMetrics: () => ({ applications: 0 }),
  getRenewalSummaryForMonth: () => ({}), getLeadSourceTotal: () => 0,
  buildFunnelConversionMetrics: () => ({}), getExplicitLeaseSignedCount: () => 0,
  getRecordComparableSnapshotUnits: r => r.monthlyData[8].occupiedSnapshot,
  getRecordSavedBudgetOccPct: () => 95,
  getImportReadinessStatus: () => ({})
});
const r = {total:222, currentMonth:8, currentOccupied:184, monthlyData:Array.from({length:12},()=>({}))};
r.monthlyData[8] = {sourceTotalUnits:222, rentableUnits:220, occupiedSnapshot:184, metricProvenance:{occupiedSnapshot:{revisionKey:'audited'}}};
let recs = ctx.buildRecommendationsForRecord('Citrus Ridge', r);
assert(recs.some(x => x.body.includes('83.6% occupied')), 'Recommendations must use 184/220, not 184/222');
assert(!recs.some(x => x.title === 'Health Status Pending'), 'Audited occupancy is reportable without legacy DLR readiness');
r.monthlyData[8].occupiedSnapshot = 0;
assert(ctx.buildRecommendationsForRecord('Citrus Ridge', r).some(x => x.body.includes('0.0% occupied')));
r.monthlyData[8].occupiedSnapshot = null;
assert(!ctx.buildRecommendationsForRecord('Citrus Ridge', r).some(x => x.title === 'Occupancy is trailing budget'), 'Missing must not become zero');
console.log('PASS recommendations use rentable inventory, recognize audited occupancy, preserve zero and missing');
