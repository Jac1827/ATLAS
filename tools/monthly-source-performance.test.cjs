const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {readDashboardSource} = require('./dashboard-source.cjs');
const source = readDashboardSource(__dirname + '/../docs/portfolio-operations-dashboard/index.html');
const context = {Date, Number, Array};
vm.createContext(context);
for (const name of ['defaultMonthly', 'normalizeBudgetOccupancyPct', 'deriveSavedBudgetTargetsFromMonthlyData', 'repairMonthlyBudgetTargets', 'buildPeriodKey', 'normalizeMonthlyHistoryByPeriod', 'normalizeCommunityMonthlySources', 'getRecordHistoryEntry', 'getRecordMonthEntryForPeriod', 'getRecordMonthlyDataForYear']) {
  const match = source.match(new RegExp('^function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'));
  assert(match, name); vm.runInContext(match[0], context);
}
const plain = value => JSON.parse(JSON.stringify(value));
const currentYear = new Date().getFullYear();
context.normalizeSavedCommunityRecord = () => { throw new Error('Monthly reads must not normalize staffing, bonus or contract fields'); };
const rows = context.defaultMonthly();
rows[0] = {applications: 0, tours: null, budgetOcc: 0, source: 'live', metricProvenance: {applications: {fileHash: 'synthetic-live'}}};
rows[1] = {applications: 7, budgetOcc: 99.95};
const record = {monthlyData: rows, savedBudgetTargets: [91, 87], monthlyHistoryByPeriod: {
  [`${currentYear}-01`]: {applications: null, tours: 0, source: 'current-history'},
  [`${currentYear - 1}-01`]: {applications: 0, budgetOcc: 93, source: 'prior-history'},
  [`${currentYear}-13`]: {applications: 900}, bad: {applications: 800}
}};
const before = JSON.stringify(record);
let selected = context.getRecordMonthlyDataForYear(record, currentYear);
assert.equal(selected.length, 12);
assert.equal(selected[0].applications, null, 'current year history retains explicit unknown');
assert.equal(selected[0].tours, 0, 'current year history retains explicit zero');
assert.equal(selected[0].source, 'current-history');
assert.equal(selected[0].metricProvenance, undefined, 'history entry retains the existing whole-entry selection semantics');
assert.equal(selected[0].budgetOcc, 0, 'history default budget value retains precedence during year selection');
assert.equal(selected[1].budgetOcc, 100, 'budget normalization retains existing rounding');
selected = context.getRecordMonthlyDataForYear(record, currentYear - 1);
assert.equal(selected[0].applications, 0);
assert.equal(selected[0].budgetOcc, 93);
assert.equal(selected[0].source, 'prior-history');
assert.equal(selected[1].applications, 7, 'legacy missing-history fallback is preserved exactly');
assert.equal(JSON.stringify(record), before, 'read-only normalization never mutates its source');
selected[1].applications = 999;
assert.equal(context.getRecordMonthlyDataForYear(record, currentYear - 1)[1].applications, 7, 'separate reads do not share mutable monthly entries');
for (const input of [null, undefined, {}, {monthlyData: []}, {monthlyData: [null]}, {monthlyHistoryByPeriod: null}, {savedBudgetTargets: [0, null, -1, '95.24']}]) {
  const result = context.getRecordMonthlyDataForYear(input, currentYear);
  assert.equal(result.length, 12); assert.equal(result[0].applications, 0);
}
// Allocating defaults once per pass avoids 12 complete arrays per monthly read.
let allocations = 0; const originalDefaults = context.defaultMonthly;
context.defaultMonthly = () => { allocations += 1; return originalDefaults(); };
context.getRecordMonthlyDataForYear(record, currentYear);
assert(allocations <= 4, `Monthly read allocated ${allocations} full default arrays`);
assert.match(source, /monthlyData: monthlySources\.monthlyData/);
assert.match(source, /monthlyHistoryByPeriod: monthlySources\.monthlyHistoryByPeriod/);
assert.match(source, /savedBudgetTargets: monthlySources\.savedBudgetTargets/);
console.log('PASS monthly-only normalization, exact history precedence, null/zero/source preservation, independent results and bounded default allocations.');
