const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('docs/portfolio-operations-dashboard/index.html', 'utf8');
const c = vm.createContext({ console });
for (const f of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(f[0], c);
Object.assign(c, {
  getAtlasDashboardWidgetDefinition: key => ({defaultMetric:key === 'portfolio_overview' ? 'Physical Occupancy' : 'Renewal Conversion'}),
});
// Synthetic units intentionally differ: a missing large property must not dilute a smaller plan.
const row = (units, occupied, target, extra = {}) => ({
  totalUnits: units, occupancyBaseUnits: units, occupied, leased: occupied,
  budgetOccPct: target, budgetOccUnits: target == null ? 0 : Math.ceil(units * target / 100),
  budgetLeasedUnits: 0, budgetOccAttainmentPct: 100, budgetOccOnTrack: true,
  occPct: occupied / units * 100, reportYear: 2026, currentMonth: 8,
  renewalsSigned: 18, renewalExpirations: 30, ...extra
});
const aggregate = rows => c.aggregateCommunitySummaries(rows);
const small = row(100, 80, 90), large = row(300, 240, null);
const partial = aggregate([small, large]);
assert.equal(partial.budgetOccPct, null);
assert.equal(partial.occGapPts, null);
assert.equal(partial.budgetOccUnits, null);
assert.equal(partial.occGapUnits, null);
assert.equal(partial.budgetAttainmentPct, null);
assert.equal(partial.budgetOccCoverage.coveredCommunities, 1);
assert.equal(partial.budgetOccCoverage.coveredUnits, 100);
assert.equal(partial.occupied, 320, 'actual scope must remain unchanged');
const full = aggregate([small, row(300, 240, 70)]);
assert.equal(full.budgetOccPct, 75);
assert.equal(full.occGapPts, 5);
assert.equal(aggregate([]).budgetOccPct, null);
for (const target of [null, undefined, '', NaN, 0]) {
  assert.equal(aggregate([row(100, 80, target)]).budgetOccPct, null, 'missing and legacy zero remain unavailable');
}
const zero = aggregate([row(100, 0, 0, {hasBudgetOcc:true})]);
assert.equal(zero.budgetOccPct, 0, 'explicitly available zero remains zero');
assert.equal(zero.occGapPts, 0);
assert.equal(zero.budgetAttainmentPct, null, 'zero target is not a division denominator');
assert.equal(aggregate([row(0, 0, 90)]).budgetOccPct, null);
assert.equal(aggregate([small, row(300, 240, 70, {currentMonth:7})]).budgetOccPct, null);
assert.equal(aggregate([small, row(300, 240, 70, {reportYear:2025})]).budgetOccPct, null);
const comparison = (widgetKey, metric, data=full) => c.atlasDashboardComparisonLine({widgetKey,metric,comparison:'Budget'},data,[]);
assert.match(comparison('portfolio_overview','Physical Occupancy'), /Budget 75.0%.*5.0%/);
assert.match(comparison('portfolio_overview','Physical Occupancy',partial), /unavailable.*1\/2/);
assert.match(comparison('portfolio_overview','Physical Occupancy',zero), /Budget 0.0%.*0.0%/);
// Poison values make accidental semantic dispatch detectable, without inventing target keys.
for (const [widget, metric] of [['renewals_retention','Renewal Conversion'],['renewals_retention','Retention %'],['traffic_funnel','Guest Cards'],['portfolio_overview','Revenue vs. Budget'],['portfolio_overview','Leased Occupancy']]) {
  const result=comparison(widget,metric,{...full,budgetOccPct:91,occGapPts:17});
  assert.match(result,/unavailable/);
  assert(!result.includes('91') && !result.includes('17'));
}
// Actual widget render, persisted JSON roundtrip, and shared report formatters.
let details=[small,large].map(summary=>({summary}));
c.buildAtlasDashboardScopedDetails=()=>details;
let snap=c.buildAtlasDashboardWidgetSnapshot({widgetKey:'renewals_retention',metric:'Renewal Conversion'});
assert.equal(snap.value,'60%');
assert.match(snap.detail,/unavailable/);
snap=c.buildAtlasDashboardWidgetSnapshot({widgetKey:'portfolio_overview',metric:'Budget Occupancy'});
assert.equal(snap.value,'—');
assert.match(snap.sub,/1\/2/);
details=JSON.parse(JSON.stringify(details));
snap=c.buildAtlasDashboardWidgetSnapshot({widgetKey:'portfolio_overview',metric:'Occupancy Variance'});
assert.equal(snap.value,'—');
assert.equal(c.formatPortfolioReportValue(partial.occGapPts,'pct'),'—');
assert.equal(c.formatSignedDisplay(partial.occGapPts,1,' pts'),'—');
assert.equal(c.formatPortfolioReportValue(zero.occGapPts,'pct'),'0.0%');
assert.equal(c.formatSignedDisplay(zero.occGapPts,1,' pts'),'+0.0 pts');
assert(!html.includes('report.aggregate.occGapPts ?? 0'), 'exports must not coerce unavailable comparison to zero');
console.log('PASS semantic comparison dispatch, weighted full coverage, mixed coverage/periods, empty scope, explicit zero, missing inventory, widget reload and report formatting');
