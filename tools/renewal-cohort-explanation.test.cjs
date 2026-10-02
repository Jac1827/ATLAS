const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readDashboardSource} = require('./dashboard-source.cjs');
const source = readDashboardSource(__dirname + '/../docs/portfolio-operations-dashboard/index.html');
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const c = vm.createContext({console, Date, MONTHS, FULL_MONTHS: MONTHS, window: {}});
for (const match of source.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(match[0], c);
const months = Array.from({length: 12}, () => ({}));
months[0] = {renewalExpirations: 10, renewalSigned: 6};
months[1] = {renewalExpirations: 0, renewalSigned: 3};
months[2] = {renewalSigned: 2};
months[3] = {renewalExpirations: 10, renewalSigned: 0};
months[4] = {renewalExpirations: 20, renewalSigned: 10};
months[5] = {renewalExpirations: 100, renewalSigned: 90};
const before = JSON.stringify(months);
const q = c.getQuarterlyRenewalTotals(months, 4);
assert.equal(q.Q1.averageClosedRetentionRate, 60);
assert.equal(q.Q1.eligibleSigned, 6, 'Subtitle counts exclude signed renewals without an eligible denominator');
assert.equal(q.Q1.eligibleExpirations, 10);
assert.deepEqual(Array.from(q.Q1.eligibleMonthIndexes), [0]);
assert.equal(q.Q1.zeroExpirationMonthCount, 1);
assert.equal(q.Q1.missingExpirationMonthCount, 1);
assert.equal(q.Q2.eligibleSigned, 10);
assert.equal(q.Q2.eligibleExpirations, 30);
assert.equal(q.Q2.closedMonthCount, 2, 'A measured zero signed count is eligible');
assert.equal(q.Q2.futureMonthCount, 1);
assert.equal(q.Q2.averageClosedRetentionRate, (10 / 30) * 100, 'Preserve existing weighted retention policy');
assert.equal(q.Q1.signed, 11, 'Keep all-quarter inputs for existing consumers');
assert.equal(q.Q2.signed, 100);
assert.equal(q.Q3.closedMonthCount, 0);
assert.equal(q.Q3.averageClosedRetentionRate, 0, 'Do not change the existing Bonus numeric contract');
assert.equal(JSON.stringify(months), before, 'Read-only calculation preserves historical inputs');

const record = {reportYear: new Date().getFullYear(), monthlyData: months};
Object.assign(c, {
  currentMonth: 4, renewalImportLog: [], renewalImportSourceLabel: '',
  isPortfolioWorkspaceSelected: () => false,
  getCurrentCommunityRecord: () => record,
  getRenewalMonthEntryForRecord: (r, idx) => r.monthlyData[idx],
  computeSchedule: () => [],
  monthInpField: () => '',
  statBox: (title, value, subtitle) => `${title}: ${value} | ${subtitle}\n`,
  renderFutureWindowshadedTableRows: rows => rows.join(''),
  renderWindowshadeCard: ({bodyHtml}) => bodyHtml
});
let rendered = c.renderRenewalsTab();
assert.match(rendered, /Q1 Avg Renewal %: 60\.0% \| 1 closed month · 6 signed of 10 expirations/);
assert.doesNotMatch(rendered, /11 signed of 10 expirations/);
assert.match(rendered, /1 month with zero expirations excluded/);
assert.match(rendered, /1 month with missing expirations excluded/);
assert.match(rendered, /Q2 Avg Renewal %: 33\.3% \| 2 closed months · 10 signed of 30 expirations/);
assert.match(rendered, /1 future month excluded/);
assert.match(rendered, /Q3 Avg Renewal %: — \| No closed-month retention yet/);
// Reload the saved record, including blanks and explicit zeros, without changing eligibility.
record.monthlyData = JSON.parse(before);
assert.equal(c.renderRenewalsTab(), rendered);
months[0].renewalSigned = 0;
record.monthlyData = months;
assert.match(c.renderRenewalsTab(), /Q1 Avg Renewal %: 0\.0% \| 1 closed month · 0 signed of 10 expirations/);
for (const value of [null, undefined, '', ' ']) {
  months[2].renewalExpirations = value;
  assert.equal(c.getQuarterlyRenewalTotals(months, 4).Q1.missingExpirationMonthCount, 1);
}
console.log('PASS renewal cohort counts, exclusion coverage, missing versus zero, future months, weighted policy, rendered cards, and reload parity');
