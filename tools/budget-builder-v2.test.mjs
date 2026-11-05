// Budget Builder v2 unit tests: importers (Entrata, Vena, Conservice, contracts), engine
// drivers, learning, governed workbook rendering and the investor PDF. Synthetic data only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const F = '../docs/portfolio-operations-dashboard/features/budget-v2/';
const E = await import(F + 'engine.mjs'), I = await import(F + 'importers.mjs'), L = await import(F + 'learning.mjs'), H = await import(F + 'handoff.mjs'), P = await import(F + 'investor-package.mjs');
const XLSX = require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const PDFLib = require('pdf-lib');

// --- Entrata T12 (xlsx layout) ---
const t12 = I.parseT12Sheet([['11 - RISE - Trailing 12 Month - Income Statement'], ['Test Community'], ['Accrual Basis'], ['Account', 'Account Name', 'Jan 2026', 'Feb 2026', 'Total'], ['Income'], ['Rental Income'],
  ['5120', 'Gross Potential Rent (GPR)', 1000, 1000, 2000], ['Gross Rental Income', 2000], ['Cost Of Leasing'], ['5220', 'Rent Loss-Vacancy', -50, -40, -90], ['Debt Service'], ['6820', 'Interest Expense', 10, 10, 20]]);
assert(t12.ok); assert.deepEqual(t12.periods, ['2026-01', '2026-02']); assert.equal(t12.lines.find(l => l.gl === '5220').section, 'Cost Of Leasing');
assert.equal(t12.lines.find(l => l.gl === '6820').section, 'Non-Operating', 'debt service is excluded from operations');

// --- T12 from package PDF text ---
const months = ['Aug 2026', 'Jul 2026', 'Jun 2026', 'May 2026', 'Apr 2026', 'Mar 2026', 'Feb 2026', 'Jan 2026', 'Dec 2025', 'Nov 2025', 'Oct 2025', 'Sep 2025'];
const pdf = I.parseT12Text([`Account Account Name ${months.join(' ')} Total`, 'Unit Utilities', '6463 Water/Sewer Units ' + Array(12).fill('1,000.00').join(' ') + ' 12,000.00', '6942 Electric - Unit Reimbursement ' + Array(12).fill('(10.00)').join(' ') + ' (120.00)']);
assert.equal(pdf.periods[0], '2025-09'); assert.equal(pdf.lines[0].total, 12000); assert.equal(pdf.lines[1].total, -120); assert.equal(pdf.lines[0].section, 'Unit Utilities');

// --- Box score: totals align with the header, floor plans with detail columns ---
const box = I.parseBoxScore([['02 - RISE - Box Score'], ['Test Community'], ['11/01/2026 - 11/30/2026'], ['Availability (As of 11/04/2026)'],
  ['Unit Type', 'Avg. SQFT', 'Avg. Market Rent (Budgeted)', 'Avg. Scheduled Rent', 'Avg. Net Effective Rent', 'Units', 'Excluded', 'Rentable Units', 'Occupied', 'Vacant', 'Total Market Rent', 'Total Scheduled Rent'],
  ['A1', '', '', '', '', '', 0, 10, '', '', 15000, 14000], ['', 900, 1500, 1450, 1400, 10, 0, 10, 9, 1]]);
assert(box.ok); assert.equal(box.units, 10); assert.equal(box.occupied, 9); assert.equal(Math.round(box.lossToLeasePct * 100) / 100, 3.33);

// --- Trending occupancy ---
const tr = I.parseTrending([['RISE - Trending Occupancy'], ['Test'], [''], [''], ['Date Range', 'Beginning Occupancy', 'Move-ins', 'Move-outs', 'Ending Occupancy', '', 'Beginning Occupied Units', 'Ending Occupied Units', 'Unit Space Count'],
  ['01/01/2026 - 01/31/2026', '', 3, 1, '', '', 8, 10, 10], ['02/01/2026 - 02/28/2026', '', 0, 2, '', '', 10, 8, 10]]);
assert(tr.ok); assert.equal(tr.months[1].moveOuts, 2); assert.equal(tr.units, 10); assert.equal(tr.warnings.length, 0);

// --- Conservice ---
const cons = I.parseConservice([['Property Name', 'City', 'State', 'Utility Type', 'Assigned To', 'Utility Provider', 'Projected Annual (%)', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'],
  ['RISE Test', 'Jacksonville', 'FL', 'Sewer', 'H.S.', 'JEA', 0.1, ...Array(12).fill(0.1)], ['RISE Test', 'Jacksonville', 'FL', 'Natural Gas', '', 'Utility Bills Unavailable']]);
const rates = I.conserviceRates(cons, 'Test');
assert.equal(Math.round(rates.sewer.steady), 10); assert.equal(rates.gas, null, 'unavailable utilities are null, never zero');

// --- Vena Budget Report: GL rows, line items, comments ---
const blank = n => Array(n).fill('');
const row = (desc, months, total, comment) => [...blank(11), desc, ...blank(49), ...months, total, '', comment || ''];
const vena = I.parseVenaBudget([row('', [], ''), [...blank(8), 'Budget Report'], [...blank(8), '306 (RISE Test)', ...blank(52), 'FY2027'], blank(80),
  row('[*] 6545 (Elevator Maint Contract)', Array(12).fill(100), 1200), row('Quarterly Maintenance', Array(12).fill(80), 960, '3% inc'), row('Add Description', [], ''), row('Service Calls', Array(12).fill(20), 240)], {fiscalYear: 2027});
assert(vena.ok); assert.equal(vena.lines[0].total, 1200); assert.equal(vena.lines[0].items.length, 2); assert.equal(vena.lines[0].note, '3% inc');

// --- Contracts ---
const parking = I.extractContractTerms('PARKING MANAGEMENT AGREEMENT between RISE DORO, and Target Park (US) Inc. (hereinafter called “Tenant”). The term of this management agreement shall be for three ( 3 ) years beginning ________, 2026. The tenant shall pay the Landlord a monthly rent of sixty ( 6 0%) percent of the total monthly gross parking revenues. thirty (30) days prior written notice.');
assert.equal(parking.terms.gl.value, '5936'); assert.equal(parking.terms.revenueSharePct, 60); assert.equal(parking.terms.termMonths, 36); assert.equal(parking.terms.vendorText, 'Target Park (US) Inc.');
assert(parking.warnings.some(w => /blank date/.test(w)));
const land = I.extractContractTerms('Landscaping Services Proposal. Growing Season Visits Monthly Investment $504 Annual Investment $6,048. This Contract shall expire at the conclusion of the initial twelve (12)-month Term unless renewed by a written agreement.');
assert.equal(land.terms.gl.value, '6537'); assert.equal(land.terms.monthlyAmount, 504); assert.equal(land.terms.termMonths, 12); assert.equal(land.terms.autoRenew, false);

// --- Engine: proposal base reproduces the proposal; drivers move linked lines only ---
const periods = E.fiscalPeriods(2027, 1);
assert.deepEqual(E.fiscalPeriods(2027, 8).slice(0, 2), ['2026-08', '2026-09']);
const p = v => ({total: v * 12, monthly: Array(12).fill(v)});
const model = {property: {name: 'Test', units: 10, assetClass: 'conventional'}, periods, start: 'proposal', sources: {proposal: {}},
  lines: [{gl: '5120', name: 'GPR', section: 'Rental Income', proposal: p(10000), t12: {total: 118000}}, {gl: '5220', name: 'Vacancy', section: 'Cost Of Leasing', proposal: p(-500), t12: {total: -7000}},
    {gl: '5951', name: 'Application Fees', section: 'Other Income', proposal: p(50), t12: {total: 500}}, {gl: '6320', name: 'Management Fee', section: 'Management Fees', proposal: p(286.5), t12: {total: 3300}},
    {gl: '6581', name: 'Paint', section: 'Turnover Expense', proposal: p(100), t12: {total: 1000}}, {gl: '6537', name: 'Landscaping Contract', section: 'Contract Services', proposal: p(700), t12: {total: 8000}},
    {gl: '6330', name: 'General Manager', section: 'Payroll Office', proposal: p(5000), t12: {total: 58000}}, {gl: '6713', name: 'FICA', section: 'Payroll Related Expenses', proposal: p(382.5), t12: {total: 4400}},
    {gl: '5144', name: 'Lodging', section: 'Other Income', t12: {total: 900}}, {gl: '8000', name: 'Depreciation', section: E.sectionForGl('8000'), proposal: p(999)}],
  schedule: {beginOccupied: 9, moveIns: Array(12).fill(1), moveOuts: Array(12).fill(1)},
  assumptions: {marketRent: 1000, ltlPct: 0, concessionPct: 0, badDebtPct: 0, mgmtPct: 3, inflation: 3, electric: 0, water: 0, sewer: 0, reservePerUnit: 250},
  positions: [{gl: '6330', count: 1, salary: 60000}], basis: {occUM: 100, vacUM: 20, moveIns: 10, moveOuts: 10, salaries: 58000, rent: 983}};
model.base = E.freezeBase(model);
const r0 = E.calculate(model);
for (const gl of ['5120', '5220', '5951', '6320', '6581', '6537', '6330', '6713']) assert.equal(Math.round(r0.rows[gl].annual), Math.round(model.lines.find(l => l.gl === gl).proposal.total), gl + ' equals proposal at base');
assert.equal(r0.rows['5144'].annual, 0, 'a line absent from the proposal stays at zero (model shown separately)');
assert(r0.rows['5144'].modelAnnual > 0); assert.equal(r0.rows['8000'], undefined, 'non-operating lines are excluded');
const busier = E.calculate({...model, schedule: {...model.schedule, moveIns: Array(12).fill(2), moveOuts: Array(12).fill(2)}});
assert.equal(Math.round(busier.rows['5951'].annual), 1200, 'application fees double with move-ins');
assert.equal(Math.round(busier.rows['6581'].annual), 2400, 'turn paint doubles with move-outs');
assert.equal(busier.rows['6537'].annual, r0.rows['6537'].annual, 'contracts hold');
const lower = E.calculate({...model, schedule: {...model.schedule, moveOuts: Array(12).fill(2)}});
assert(lower.rows['5220'].annual < r0.rows['5220'].annual && lower.rows['6320'].annual < r0.rows['6320'].annual, 'vacancy grows and the management fee follows income');
const raise = E.calculate({...model, positions: [{gl: '6330', count: 1, salary: 60000, raisePct: 10, raiseMonth: 6}]});
assert.equal(Math.round(raise.rows['6330'].annual), 63000); assert(raise.rows['6713'].annual > r0.rows['6713'].annual, 'payroll taxes follow salaries');
const ov = E.calculate({...model, overrides: {'6537': 9500}});
assert.equal(Math.round(ov.rows['6537'].annual), 9500); assert(ov.rows['6537'].overridden);
const rf = E.calculate({...model, closedMonths: 2, actuals: {'6537': [1, 2, ...Array(10).fill(null)]}});
assert.deepEqual(rf.rows['6537'].monthly.slice(0, 3), [1, 2, 700]); assert.deepEqual(rf.rows['6537'].locked.slice(0, 3), [true, true, false]);
const mil = E.calculate({...model, property: {...model.property, assetClass: 'military'}, bah: [{grade: 'E-5', homes: 10, monthlyBah: 2000}]});
assert.equal(mil.totals.annual.income, 0, 'military income is excluded from NOI'); assert.equal(mil.memo.annual, Math.round(10 * 2000 * 12 * (r0.context.occUM / 120) * 100) / 100);
assert.deepEqual(E.noteFlags(ov, {}), ['6537']); assert.deepEqual(E.noteFlags(ov, {'6537': 'New contract'}), []);

// --- Learning ---
const season = L.seasonality(tr);
const sched = L.suggestSchedule({periods, beginOccupied: 8, units: 10, season, targetOccPct: 90});
assert.equal(sched.moveIns.length, 12);
let occ = 8; sched.moveIns.forEach((v, i) => { occ += v - sched.moveOuts[i]; }); assert.equal(occ, 9, 'schedule reaches the target');
assert.deepEqual(L.calibrate([{gl: '6537', model: 100, final: 110}, {gl: '6537', model: 100, final: 120}, {gl: '6537', model: 100, final: 115}]), {'6537': {calibration: 1.15, n: 3}});
const seeded = L.seedPositions([{gl: '6335', proposal: {total: 100000}}, {gl: '6332', t12: {total: 50000}}], {fromProposal: true});
assert.equal(seeded.find(x => x.gl === '6335').count, 2); assert.equal(seeded.find(x => x.gl === '6332').count, 0, 'no proposal amount means no seeded position');

// --- Governed workbook rendering ---
const m = H.workbookMatrix(r0, periods);
assert.deepEqual(m[0], ['Scenario', 'Plan', 'Currency', 'Local']); assert.equal(m[1][2], 'Jan 2027');
const rendered = XLSX.utils.sheet_to_json(XLSX.read(H.workbookBytes(XLSX, r0, periods), {type: 'array'}).Sheets.Plan, {header: 1});
assert.equal(rendered.find(x => x[0] === '6537')[2], 700);
assert.deepEqual(H.natureOf('Cost Of Leasing', '5220'), {nature: 'contra_income', placement: 'above_noi'}); assert.equal(H.natureOf('Capital Expenditures', '1533').placement, 'below_noi');
const merged = H.mergeRegistry({accounts: [{accountCode: '5120'}]}, r0, '2027-01');
assert.equal(merged.added, r0 && Object.keys(r0.rows).length - 1);

// --- Investor package ---
const summary = P.investorSummary({community: 'Test', units: 10, unitLabel: 'unit', fiscalYear: 2027, periodLabel: 'Jan 2027 – Dec 2027', assetClass: 'Conventional', result: r0, assumptions: ['Rent $1,000'], notes: [{gl: '6537', name: 'Landscaping', note: 'New vendor — 3% escalator'}], approvals: [{role: 'VP', at: '2027-01-01'}]});
assert.equal(summary.rows[2].name, 'Net operating income');
assert(P.investorHtml(summary).includes('New vendor — 3% escalator')); assert(!P.investorHtml({...summary, community: '<script>'}).includes('<script>'), 'HTML is escaped');
const bytes = await P.investorPdf(summary, {PDFLib});
assert(bytes.length > 2000 && String.fromCharCode(...bytes.slice(0, 4)) === '%PDF');
console.log('PASS Budget Builder v2 unit: importers, contract terms, proposal-linked drivers, payroll, reforecast actuals, military memo, learning, governed workbook and investor PDF');
