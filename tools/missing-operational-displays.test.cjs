const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../docs/portfolio-operations-dashboard');
const source = fs.readFileSync(path.join(root, 'workspace-core.js'), 'utf8') + '\n'
  + fs.readFileSync(path.join(root, 'features/bonus-workspace.js'), 'utf8');
const fn = name => {
  const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^\\}', 'm'));
  assert(match, 'Missing function: ' + name);
  return match[0];
};
// Exercise the actual selectors and renderers against retained synthetic source
// counts. Missing inventory must not turn a legacy summary zero into a rate.
const snapshot = {innerHTML: ''};
const data = {name: 'Synthetic Community', total: 0, base: 0, occupied: 0, leased: 0};
const record = {reportYear: 2026, currentMonth: 9, monthlyData: Array.from({length: 12}, () => ({}))};
const c = vm.createContext({
  console, Date, Map, Set, window: {}, document: {getElementById: id => id === 'workspace-community-snapshot' ? snapshot : null},
  workspaceScopeValue: 'Synthetic Community', PORTFOLIO_SCOPE_VALUE: 'portfolio', PROPERTIES: [{name: data.name}], savedData: {},
  FULL_MONTHS: Array.from({length: 12}, (_, i) => 'Month ' + (i + 1)),
  getProp: () => ({name: data.name, units: data.total}), getPropertyByName: () => ({name: data.name, units: data.total}),
  getSelectedDashboardMonthIndex: () => 9, getCurrentCommunityRecord: () => record, isPortfolioWorkspaceSelected: () => false,
  getWorkspaceScopedAggregate: () => ({details: [], aggregate: {}}), renderApplicationTrackingSection: () => {},
  getTotalUnitsFor: () => data.total, getResolvedTotalUnitsForRecord: () => data.total, getCorporateLeaseUnitsForRecord: () => 0,
  getReportedOccupancyBaseUnits: () => data.base,
  getRecordComparableSnapshotUnits: (_record, _total, _month, key) => key === 'occupiedSnapshot' ? data.occupied : data.leased,
  getCommunitySummary: () => ({occupied: data.occupied, leased: data.leased, occupancyBaseUnits: data.base, occPct: data.base ? data.occupied / data.base * 100 : 0, leasedPct: data.base ? data.leased / data.base * 100 : 0}),
  getApplicationDecisionMetrics: () => ({applications: 0, approvals: 0, denials: 0, cancelled: 0, pendingDecision: 0}),
  matchPropertyName: name => name, normalizeSavedCommunityRecord: (_name, value) => value,
  getRecordMonthlyDataForYear: value => value.monthlyData, computeScheduleFromContext: () => [],
  getRenewalMonthEntryForRecord: () => ({}), getRenewalSummaryForMonth: () => ({expirations: 0}),
  getEffectiveMoveOutsForMonth: () => ({effective: 0}), getReportedTrend: () => ({units: null, pct: null, label: 'Missing'}),
  getCommunityCommandEconomicOccupancyData: () => ({closedPct: null, priorPct: null, sourceLabel: 'Missing', state: 'missing'}),
  getCommunityPerformancePlan: () => ({}), getCommunityCommandSourceLabel: () => 'Report source unavailable',
  getRecordSavedBudgetOccPct: () => 90, getExplicitLeaseSignedCount: () => 0, getLeadSourceTotal: () => 1,
  getCommunityCommandActivePlan: () => null, syncHeaderSubText: () => {}, escapeHtml: String,
  getCommunityCommandDashboardOverride: () => null, communityCommandCanOverrideDashboard: () => false,
  getCommunityCommandMetricSourceLabel: () => 'Report source unavailable', communityCommandEconomicOccupancyLabel: () => 'Missing',
  getApplicationApprovalCohortDisplay: () => ({subtext: 'Synthetic'}), getAtlasTodayISODate: () => '2026-10-19'
});
vm.runInContext(['communityCommandFormatNumber', 'communityCommandFormatPct', 'communityCommandMetricValue',
  'renderPropGrid', 'buildCommunityCommandModel', 'buildCommunityCommandAlerts', 'renderCommunityCommandKpi',
  'renderCommunityCommandHealthSnapshot', 'renderPortfolioScopedCommunityCommandTab'].map(fn).join('\n'), c);
const tile = (html, label) => html.slice(html.indexOf('>' + label + '<')).split('</button>')[0];
const sourceBefore = JSON.stringify(record);
let model = c.buildCommunityCommandModel(data.name, record);
assert.equal(model.physicalPct, null);
assert.equal(model.leasedPct, null);
assert.equal(model.occupied, 0, 'Presentation must retain the original count, not invent an observation');
c.renderPropGrid();
for (const label of ['Physical Occupancy', 'Leased Occupancy']) {
  assert.match(tile(snapshot.innerHTML, label), />Missing</);
  assert.match(tile(snapshot.innerHTML, label), /Verified inventory is required/);
  assert.doesNotMatch(tile(snapshot.innerHTML, label), /0\.0%/);
  assert.match(tile(c.renderCommunityCommandHealthSnapshot(model), label), />Missing</);
}
assert(!c.buildCommunityCommandAlerts(model).some(alert => /^occ_/.test(alert.id)), 'Missing occupancy must not trigger a zero-based budget comparison');
const missingModel = model;

Object.assign(data, {total: 100, base: 96, occupied: 0, leased: 24});
model = c.buildCommunityCommandModel(data.name, record);
assert.equal(model.physicalPct, 0, 'An actual zero with a positive source denominator remains zero');
assert.equal(model.leasedPct, 25, 'Use the existing rentable denominator, not configured total inventory');
c.renderPropGrid();
assert.match(tile(snapshot.innerHTML, 'Physical Occupancy'), /0\.0%/);
assert.match(tile(snapshot.innerHTML, 'Leased Occupancy'), /25\.0%/);
assert.match(tile(c.renderCommunityCommandHealthSnapshot(model), 'Physical Occupancy'), /0\.0%/);
assert(c.buildCommunityCommandAlerts(model).some(alert => alert.id === 'occ_budget_risk'), 'A real zero still participates in budget comparisons');

Object.assign(c, {
  communityCommandPortfolioRosterFilter: 'all', getWorkspaceScopedDetails: () => [{name: 'Missing', record}, {name: 'Actual zero', record}],
  isCommunityStatusActive: () => true, atlasDashboardUserCanSeeCommunityName: () => true,
  buildCommunityCommandPortfolioRosterItems: details => details.map((detail, index) => ({detail, model: index ? model : missingModel, suggestion: null, hasActivePlan: false})),
  renderCommunityCommandPlanSummaryStat: () => '', queueCommunityRosterFinancials: () => {},
  statBox: (label, value) => label + ':' + value, renderPortfolioScopePanel: (_title, _description, cards, body) => cards + body
});
const roster = c.renderPortfolioScopedCommunityCommandTab();
assert.match(roster, /Below Budget:1/);
assert.match(roster, /On Track:0/);
assert.match(roster, /data-physical-pct=""/);
assert.match(roster, /data-physical-pct="0"/);
assert.equal(JSON.stringify(record), sourceBefore, 'Rendering cannot rewrite source history');
console.log('PASS missing inventory remains missing in snapshot, Community Command and portfolio comparisons; legitimate zero and rentable denominators remain exact');

// Empty filters/rosters are not evidence of a zero-dollar payout. Preserve
// existing formulas for populated rows, including genuine approved zero.
let planningRows = [];
const b = vm.createContext({
  console, Map, escapeHtml: String, atlasBonusJsArg: JSON.stringify,
  atlasBonusExceptionGroups: () => [], atlasBonusBuildCalculationRows: () => planningRows,
  atlasBonusState: () => ({activeSection: 'overview'}), defaultBonusEngineState: () => ({filters: {}}),
  atlasBonusPeriodFromQuarter: () => ({periodKey: '2026-Q4', start: '2026-10-01', end: '2026-12-31'}),
  atlasBonusDateLabel: String, atlasBonusVisibleSections: () => [['overview', 'Overview']],
  atlasBonusSectionCache: new Map(), atlasBonusMountSharedWorkflow: () => {}, atlasBonusSharedWorkflowContext: () => 'synthetic',
  atlasBonusCan: () => false, atlasBonusSectionVisible: () => false,
  renderBonusEngineFilters: () => '', renderBonusEngineSection: () => '', renderBonusEngineBarChart: () => '',
  atlasBonusEmployeeRegionLabel: () => 'Synthetic'
});
vm.runInContext(['atlasBonusCurrency', 'atlasBonusSummary', 'renderBonusEngineKpi', 'renderBonusOverviewSection',
  'renderBonusForecastSection', 'renderBonusTab'].map(fn).join('\n'), b);
const empty = b.atlasBonusSummary([]);
for (const key of ['projected', 'final', 'approved', 'budget', 'variance']) assert.equal(empty[key], null, key);
assert.equal(empty.employeeCount, 0);
const emptyHero = b.renderBonusTab();
assert.match(emptyHero, /No employees in the current planning scope/);
assert.match(emptyHero, /Projected Pending/);
assert.doesNotMatch(emptyHero, /Projected \$0|0 critical exceptions/);
const emptyOverview = b.renderBonusOverviewSection([]), emptyForecast = b.renderBonusForecastSection([]);
assert.match(emptyOverview, /Projection and budget are required/);
assert.doesNotMatch(emptyOverview, /Projected under budget|Projected over budget|\$0|\$1/);
assert.doesNotMatch(emptyForecast, /\$0|\$1/, 'Remaining exposure must also remain pending');
planningRows = [{maximumPotential: 100, projectedPayout: 0, finalPayout: 0, canonicalPayable: true, approvalStatus: 'Paid', exceptions: []}];
const before = JSON.stringify(planningRows), zero = b.atlasBonusSummary(planningRows);
assert.equal(zero.projected, 0); assert.equal(zero.final, 0); assert.equal(zero.approved, 0);
assert.equal(zero.budget, 90); assert.equal(zero.variance, 90);
assert.match(b.renderBonusTab(), /Projected \$0/);
const pending = b.atlasBonusSummary([{...planningRows[0], projectedPayout: null, finalPayout: null, canonicalPayable: false}]);
assert.equal(pending.projected, null); assert.equal(pending.final, null); assert.equal(pending.variance, null);
const paid = b.atlasBonusSummary([{...planningRows[0], projectedPayout: 50, finalPayout: 50}]);
assert.equal(paid.projected, 50); assert.equal(paid.approved, 50); assert.equal(paid.budget, 90); assert.equal(paid.variance, 40);
assert.equal(JSON.stringify(planningRows), before, 'Summaries cannot alter compensation or approval records');
console.log('PASS empty bonus planning scopes remain pending through hero, overview and forecast; actual zero, pending prerequisites and populated formulas preserved');
