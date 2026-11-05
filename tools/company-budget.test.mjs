// RISE company budget: Entrata Budget vs Actual import, budget drivers (linked fees,
// payroll, burden, bonuses, overhead allocations), and monthly tracking. Synthetic data only.
import assert from 'node:assert/strict';
const C = await import('../docs/portfolio-operations-dashboard/features/budget-v2/company.mjs');
const near = (a, b, msg, tol = 0.05) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// --- Report import (layout of Entrata "Income Statement - Budget vs Actual") ---
const bva = (month, rows, label = 'Variance Comments') => [['Income Statement - Budget vs Actual'], ['Test Management Co'], [month], ['Accrual Basis'],
  [null, null, month, null, null, null, `YTD ( Jan 2026 - ${month} )`], ['Account', 'Account Name', 'Actual', 'Budget', '$ Variance', '% Variance', 'Actual', 'Budget', '$ Variance', '% Variance', 'Annual Budget', label],
  ['Income'], ['Rental Income'], ['Management Fee Income'], ...rows.filter(r => r[0].startsWith('41')), [null, 'Management Fee Income', 1, 1],
  ['Other Income'], ...rows.filter(r => r[0].startsWith('40')), [null, 'Total Other Income', 1],
  ['Controllable Expenses'], ['Payroll Office'], ...rows.filter(r => ['6099', '6100', '8801'].includes(r[0])), [null, 'Total Payroll Office', 1],
  ['Payroll Related Expenses'], ...rows.filter(r => r[0] === '6713'),
  ['General & Administrative'], ...rows.filter(r => ['6237', '8803'].includes(r[0])), [null, 'Total General & Administrative', 1],
  ['Taxes & Insurance'], ...rows.filter(r => r[0] === '6718'), [null, 'Net Operating Income', 1]];
// [gl, name, actual, budget, $v, %v, ytdA, ytdB, $v, %v, annual, comment]
const row = (gl, name, a, b, ya, yb, annual, comment = null) => [gl, name, a, b, null, null, ya, yb, null, null, annual, comment];
const augRows = [row('4120', 'Mgmt Fee - Alpha', 10000, 10000, 80000, 80000, 120000), row('4121', 'Mgmt Fee - Beta Hall (UKT)', 5000, 5000, 40000, 40000, 60000, 'Management ended July'),
  row('4007', 'Other Income', 0, 0, 0, 0, 12000), row('6099', 'Bonuses', 0, 0, 30000, 30000, 40000), row('6100', 'Salaries/Wages', 20000, 20000, 160000, 160000, 240000),
  row('8801', 'OH Allocation Salaries & Wages', -7000, -7000, -56000, -56000, -84000), row('6713', 'Employer Portion of FICA', 1500, 1530, 12000, 12240, 18360),
  row('6237', 'Software', 4000, 2000, 18000, 16000, 24000, 'Annual invoice'), row('8803', 'OH Allocation G&A', -200, -200, -1600, -1600, -2400), row('6718', 'General Liability Insurance', 500, 500, 4000, 4000, 6000)];
const aug = C.parseBudgetVsActual(bva('Aug 2026', augRows));
assert(C.isBudgetVsActual(bva('Aug 2026', augRows)));
assert(aug.ok); assert.equal(aug.period, '2026-08'); assert.equal(aug.ytdFrom, '2026-01'); assert.equal(aug.monthsYtd, 8); assert.equal(aug.lines.length, 10); assert.deepEqual(aug.warnings, []);
const l = gl => aug.lines.find(x => x.gl === gl);
assert.equal(l('4120').section, C.FEE_SECTION); assert.equal(l('4007').section, 'Other Income'); assert.equal(l('8801').section, 'Payroll Office'); assert.equal(l('6713').section, 'Payroll Related Expenses');
assert.equal(l('6237').comment, 'Annual invoice'); assert.equal(l('6237').ytdActual, 18000); assert.equal(l('6237').annualBudget, 24000);
const sep = C.parseBudgetVsActual(bva('Sep 2026', augRows.map(r => r[0] === '6237' ? row('6237', 'Software', 1000, 2000, 19000, 18000, 24000) : r), 'Variance Explanation'));
assert.equal(sep.period, '2026-09'); assert.equal(sep.monthsYtd, 9);

// --- Building next year's budget from the reports ---
const model = C.buildCompanyModel({fiscalYear: 2027, reports: [aug, sep], start: 'prior', inflation: 0});
const d = gl => model.lines.find(x => x.gl === gl);
assert.equal(d('4120').driver, 'fee'); assert.equal(model.fees.length, 2); assert.equal(model.fees[1].name, 'Beta Hall (UKT)'); assert.equal(model.fees[0].flatMonthly, 10000);
assert.equal(d('6100').driver, 'payroll'); assert.equal(model.positions[0].salary, 240000);
assert.equal(d('6099').driver, 'bonus'); near(d('6099').pct, 16.6667, 'bonus % of salaries', 0.001);
assert.equal(d('6713').driver, 'pctSalaries'); near(d('6713').pct, 7.65, 'FICA % of salaries');
assert.equal(d('8801').driver, 'allocation'); near(d('8801').pct, 84000 / 280000 * 100, 'salary allocation share of Payroll Office', 0.001);
assert.equal(d('6237').driver, 'fixed'); assert.equal(d('6237').annual, 24000);
const r = C.calculateCompany(model);
for (const gl of ['4120', '4121', '4007', '6099', '6100', '8801', '6713', '6237', '8803', '6718']) near(r.rows[gl].annual, r.rows[gl].prior, gl + ' starts at the prior budget', 0.5);
near(r.totals.annual.noi, r.totals.prior.noi, 'NOI starts at the prior budget', 2);
assert.equal(r.totals.annual.taxesInsurance, 6000);
near(r.totals.annual.controllableCashFlow, r.totals.annual.income - r.totals.annual.controllable, 'controllable cash flow');
// Run-rate start and inflation
const rr = C.calculateCompany(C.buildCompanyModel({fiscalYear: 2027, reports: [sep], start: 'runrate', inflation: 3}));
near(rr.rows['6237'].annual, 19000 / 9 * 12 * 1.03, 'run rate × inflation', 0.5);

// --- Drivers move linked lines ---
const raise = structuredClone(model); raise.positions[0].salary = 300000;
const r2 = C.calculateCompany(raise);
near(r2.rows['6713'].annual, 300000 * 0.0765, 'FICA follows salaries', 1); near(r2.rows['6099'].annual, 50000, 'bonuses follow salaries', 1);
near(r2.rows['8801'].annual, -(300000 + 50000) * 0.3, 'salary allocation follows Payroll Office', 1);
d('6099').months = [2, 5, 8, 11];
assert.deepEqual(C.calculateCompany(model).rows['6099'].monthly.map(v => v > 0), [false, false, true, false, false, true, false, false, true, false, false, true], 'quarterly bonuses');

// --- Fees linked to property budgets ---
const f = model.fees[0];
Object.assign(f, {communityId: 'c1', mode: 'linked', minMonthly: 9000});
const byPeriod = Object.fromEntries(model.periods.slice(0, 7).map((p, i) => [p, 8000 + i * 1000]));  // a property fiscal year ending in July
const changes = C.refreshFees(model, {c1: {kind: 'draft', ref: 'd1', status: 'gm_draft', byPeriod}});
assert.equal(changes.length, 1); assert.equal(f.source.estimatedMonths, 5, 'months the property budget does not cover are estimated');
const fees = C.calculateCompany(model).fees[0];
assert.equal(fees.monthly[0], 9000, 'minimum fee applies'); assert.equal(fees.monthly[6], 14000); assert.equal(fees.monthly[11], 11000, 'estimated from the average of covered months');
assert.equal(C.refreshFees(model, {c1: {kind: 'draft', ref: 'd1', status: 'gm_draft', byPeriod}}).length, 0, 'no change, no update');
model.fees[1].endMonth = 5;
assert.equal(C.calculateCompany(model).fees[1].monthly[6], 0, 'management ends');
assert.equal(C.suggestCommunity({name: 'Beta Hall (UKT)'}, [{id: 'x', name: 'RISE Beta Hall'}, {id: 'y', name: 'Gamma'}]), 'x');

// --- Overrides, reforecast actuals, note flags ---
const ov = C.calculateCompany({...model, overrides: {'6237': 30000}});
assert.equal(ov.rows['6237'].annual, 30000); assert(C.companyNoteFlags(ov, {}).includes('6237')); assert(!C.companyNoteFlags(ov, {'6237': 'New platform'}).includes('6237'));
const rf = C.calculateCompany({...model, closedMonths: 2, actuals: {'6237': [100, 200]}});
assert.deepEqual(rf.rows['6237'].monthly.slice(0, 3), [100, 200, 2000]);

// --- Monthly tracking ---
const periods = C.fiscalPeriods(2026);
const months = [aug, sep].map(C.monthFromReport);
const entrata = C.budgetFromReports(periods, months);
assert.equal(entrata['6237'][7], 2000); near(entrata['6237'].reduce((a, b) => a + b, 0), 24000, 'Entrata annual budget kept');
const t = C.trackCompany({periods, budget: entrata, months, period: '2026-09'});
const s = t.rows.find(x => x.gl === '6237');
assert.equal(s.monthActual, 1000); assert.equal(s.monthVar, 1000, 'expense under budget is favourable');
assert.deepEqual(t.missingMonths.slice(0, 2), ['2026-01', '2026-02']); assert(t.ytdFromReport); assert.equal(s.ytdActual, 19000, 'year to date from the report when earlier months were not uploaded');
const atlas = {...entrata, '6237': entrata['6237'].map(v => v + 500)};
const t2 = C.trackCompany({periods, budget: atlas, months, period: '2026-08'});
assert.equal(t2.rows.find(x => x.gl === '6237').entrataMismatch, true, 'Entrata budget differs from ATLAS budget');
assert.equal(t2.rows.find(x => x.gl === '6237').comment, 'Annual invoice', 'imported comment kept');
const big = C.trackCompany({periods, budget: atlas, months: [{...months[1], comments: {}}], period: '2026-09'});
assert(big.needComments > 0, 'variances over threshold need a comment');
const fc = C.trackCompany({periods, budget: entrata, months, period: '2026-09'}).rows.find(x => x.gl === '6237');
near(fc.forecast, fc.ytdActual + entrata['6237'].slice(9).reduce((a, b) => a + b, 0), 'forecast = YTD actual + remaining budget');
console.log('PASS RISE company budget: Budget vs Actual import, drivers, linked fees, allocations, reforecast and monthly tracking');
