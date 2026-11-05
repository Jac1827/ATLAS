// Budget Builder v2 STR programme tests: floor-plan engine, conversion ramp and capital,
// integration with the property budget (included / without / programme views) and the
// saved-programme workbook import. Synthetic data only.
import assert from 'node:assert/strict';
const F = '../docs/portfolio-operations-dashboard/features/budget-v2/';
const P = await import(F + 'investor-package.mjs');
const {createRequire} = await import('node:module');
const PDFLib = createRequire(import.meta.url)('pdf-lib');
const E = await import(F + 'engine.mjs'), S = await import(F + 'str.mjs'), H = await import(F + 'handoff.mjs'), L = await import(F + 'learning.mjs');
const near = (a, b, msg, tol = 0.02) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const periods = E.fiscalPeriods(2027, 1);

// --- Floor-plan engine, hand-checked for January (31 nights) ---
const drivers = {adr: 100, occupancy: 0.5, alos: 2, blockedPct: 0, permitNights: 365, discountPct: 0.02, refundPct: 0.01, ccFeePct: 0.03, lodgingTax: 0.1, mgmtFeePct: 0.1,
  cleanCostPerStay: 50, cleanFeePerStay: 60, linenPerTurn: 10, suppliesPerOccNight: 2, rmPerOccNight: 1, ffeReservePerUnit: 20, damageReservePct: 0.01, furnishCapexPerUnit: 1000,
  listingSetupPerUnit: 10, resortFeePerNight: 10, parkingFeePerNight: 5, parkingTakePct: 0.5, petFeePerStay: 20, petTakePct: 0.1, internetPerUnitMo: 30, cablePerUnitMo: 0,
  insurancePerUnitMo: 5, licencePerUnitYr: 120, monitoringPerUnitMo: 0, guestSvcPerStay: 0, guestSvcPerUnitMo: 0, promoPct: 0, softwareMinMo: 0, softwarePerUnitMo: 1,
  ltElectricPerOccUnitMo: 40, utilElecIntensity: 1.5, utilElecStandby: 0.5, ltWaterPerOccUnitMo: 0};
const prog = {...S.newStrProgram(), curve: 'flat', drivers, channelMix: [{channel: 'Airbnb', share: 0.5, feePct: 0.1}, {channel: 'Direct', share: 0.5, feePct: 0, direct: true}],
  floorPlans: [{...S.newFloorPlan({type: 'A1', units: 6, marketRent: 1000}), strUnits: 2, openingUnits: 2}]};
const solo = S.strCalculate({str: prog, periods, property: {units: 10}, assumptions: {marketRent: 1000}});
const L0 = k => solo.lines[k][0];
const booked = 2 * 31 * 0.5, stays = booked / 2, gross = booked * 100;
near(L0('gross'), gross, 'gross = units × nights × occupancy × ADR');
near(L0('cleanFee'), stays * 60, 'cleaning fee per stay');
near(L0('resortFee'), booked * 10 * 0.5, 'resort fee only on channels allowing it (not Airbnb)');
near(L0('parkingFee'), booked * 5 * 0.5, 'parking × take-up');
near(L0('petFee'), stays * 20 * 0.1, 'pet × take-up');
const anc = booked * 10 * 0.5 + booked * 2.5 + stays * 2;
near(L0('platformFees'), gross * 0.05 + stays * 60 * 0.05 + booked * 5 * 0 + (booked * 2.5 + stays * 2) * 0.05, 'commission: room, cleaning, optional add-ons; resort fee on its channels only');
near(L0('deductions'), -gross * 0.03, 'discounts and refunds are contra income');
near(L0('ccFees'), (gross + stays * 60 + anc) * 0.5 * 0.03, 'card fees on direct share');
near(L0('lodgingTax'), (gross * 0.97 + stays * 60 + anc) * 0.1, 'lodging tax base');
near(L0('mgmtFee'), (gross - gross * 0.05 - gross * 0.03) * 0.1, 'management fee on net room revenue');
near(L0('electric'), 2 * 40 * (0.5 * 1.5 + 0.5 * 0.5), 'electric: occupied intensity + vacant standby');
near(L0('licences'), 20, 'licence per unit-year');
near(L0('software'), 2, 'software per unit');
assert.equal(L0('furnish'), 0, 'opening units are already furnished');
near(L0('conversionLoss'), -2000, 'converted units give up their long-term rent');
const sumRev = S.STR_REVENUE_KEYS.reduce((t, k) => t + L0(k), 0), sumExp = S.STR_EXPENSE_KEYS.reduce((t, k) => t + L0(k), 0);
near(solo.monthly.noi[0], sumRev + L0('deductions') - sumExp, 'programme NOI');
near(solo.plans[0].annual.noi - 24, solo.annual.noi, 'programme NOI = plan NOI less programme-level software');

// --- Conversion ramp and furnishing capital ---
const ramp = S.floorPlanUnits({strUnits: 6, openingUnits: 0, startMonth: 3, rampMonths: 3});
assert.deepEqual(ramp, [0, 0, 0, 2, 4, 6, 6, 6, 6, 6, 6, 6]);
assert.deepEqual(S.floorPlanUnits({strUnits: 4, openingUnits: 4, startMonth: 0, endMonth: 8}), [4, 4, 4, 4, 4, 4, 4, 4, 4, 0, 0, 0], 'take-back after the end month');
const rampRun = S.strCalculate({str: {...prog, floorPlans: [{...prog.floorPlans[0], strUnits: 6, openingUnits: 0, startMonth: 3, rampMonths: 3}]}, periods, property: {units: 10}, assumptions: {marketRent: 1000}});
assert.deepEqual(rampRun.lines.furnish.slice(2, 7), [0, 2000, 2000, 2000, 0], 'capital only for units added that month');
assert.equal(rampRun.glRows.find(g => g.gl === '1504').nature, 'capital');
// Floor-plan rates
assert.equal(S.suggestAdrFactor({marketRent: 1440}, 1000), 1.2);
const plans2 = S.strCalculate({str: {...prog, floorPlans: [{...prog.floorPlans[0], id: 'a'}, {...prog.floorPlans[0], id: 'b', type: 'B2', adr: 150, occAdjPts: 10}]}, periods, property: {units: 10}, assumptions: {marketRent: 1000}});
near(plans2.plans[1].q.adr[0], 150, 'plan ADR'); near(plans2.plans[1].q.occ[0], 0.6, 'plan occupancy adjustment');
assert.equal(plans2.plans.length, 2); near(plans2.annual.gross, plans2.plans[0].annual.gross + plans2.plans[1].annual.gross, 'programme = sum of floor plans');
// Checks
const bad = S.strCalculate({str: {...prog, channelMix: [{channel: 'Airbnb', share: 0.6, feePct: 0.1}], floorPlans: [{...prog.floorPlans[0], strUnits: 9}]}, periods, property: {units: 10}, assumptions: {}});
assert(bad.checks.some(c => /add to 60/.test(c.message)) && bad.checks.some(c => /exceeds/.test(c.message)));

// --- Integration with the property budget ---
const p = v => ({total: v * 12, monthly: Array(12).fill(v)});
const model = {property: {name: 'Test', units: 10, assetClass: 'conventional'}, periods, start: 'proposal', sources: {proposal: {}},
  lines: [{gl: '5120', name: 'GPR', section: 'Rental Income', proposal: p(10000)}, {gl: '5220', name: 'Vacancy', section: 'Cost Of Leasing', proposal: p(-500)},
    {gl: '5951', name: 'Application Fees', section: 'Other Income', proposal: p(50)}, {gl: '5143', name: 'Internet resale', section: 'Other Income', proposal: p(450)},
    {gl: '6320', name: 'Management Fee', section: 'Management Fees', proposal: p(300)}, {gl: '6537', name: 'Landscaping', section: 'Contract Services', proposal: p(700)},
    {gl: '6461', name: 'Electric - units', section: 'Unit Utilities', proposal: p(360), t12: {total: 4320}}],
  schedule: {beginOccupied: 9, moveIns: Array(12).fill(1), moveOuts: Array(12).fill(1)},
  assumptions: {marketRent: 1000, mgmtPct: 3, inflation: 3, reservePerUnit: 0}, positions: [], basis: {occUM: 108, vacUM: 12, moveIns: 12, moveOuts: 12, salaries: 0, rent: 1000}};
model.base = E.freezeBase(model);
const base = E.calculate(model);
assert.deepEqual(model.base.strUnits, Array(12).fill(0));
assert.equal(base.str, undefined, 'no programme, no STR block');
const withStr = {...model, str: {...prog, floorPlans: [{...prog.floorPlans[0], strUnits: 2, openingUnits: 2}]}};
const inc = E.calculate(withStr);
assert.deepEqual(inc.context.strUnits, Array(12).fill(2)); assert.deepEqual(inc.context.ltUnits, Array(12).fill(8));
near(inc.context.occ[0], 9 * 0.8, 'long-term occupancy applies to the remaining units');
near(inc.rows['5951'].annual, 600 * 0.8, 'move-in fees scale with the long-term pool');
near(inc.rows['5143'].annual, 5400 * 0.8, 'resident fee income per occupied unit is displaced');
near(inc.rows['5120'].annual, 120000, 'GPR keeps every unit; converted units leave through contra income');
near(inc.rows['5220'].strAnnual, -24000, 'conversion loss posts to the conversion GL');
near(inc.rows['5220'].convMonthly[0], -500 * (10 - 9 * 0.8 - 2) / 1, 'long-term vacancy on the remaining units', 0.05);
assert.equal(inc.rows['6840'].line.section, S.STR_EXPENSE_SECTION); assert.equal(inc.rows['5144'].line.section, S.STR_INCOME_SECTION);
assert.deepEqual(H.natureOf(S.STR_INCOME_SECTION, '5144'), {nature: 'income', placement: 'above_noi'});
assert.equal(H.natureOf(S.STR_EXPENSE_SECTION, '6840').placement, 'above_noi');
assert.equal(inc.rows['1504'].line.section, 'Capital Expenditures');
near(inc.rows['6461'].strAnnual, inc.str.annual && S.strCalculate(withStr, inc.context).lines.electric.reduce((a, b) => a + b, 0), 'STR electricity adds to the shared GL');
// Views reconcile exactly: property without the programme + programme effect = property including it.
near(inc.str.without.noi + inc.str.impact.totals.noi, inc.totals.annual.noi, 'views reconcile', 0.05);
for (const [gl, r] of Object.entries(inc.str.impact.rows)) near((inc.str.withoutRows[gl] || Array(12).fill(0)).reduce((a, b) => a + b, 0) + r.annual, inc.rows[gl]?.annual || 0, 'GL ' + gl + ' reconciles', 0.05);
near(inc.str.without.noi, base.totals.annual.noi, 'without-programme view equals the budget before the programme');
assert(inc.groups.some(g => g.name === 'Short-term rental' && g.final > 0), 'summary group');
// Property management fee: STR revenue excluded by default, conversion loss always leaves the base.
const feeOn = E.calculate({...withStr, str: {...withStr.str, propertyMgmtFeeOnStr: true}});
assert(feeOn.rows['6320'].annual > inc.rows['6320'].annual && inc.rows['6320'].annual < base.rows['6320'].annual);
// Not posted: programme shown on its own; property untouched.
const memoOnly = E.calculate({...withStr, str: {...withStr.str, postToProperty: false}});
near(memoOnly.totals.annual.noi, base.totals.annual.noi, 'unposted programme leaves the property as is');
assert.equal(memoOnly.rows['6840'], undefined); assert(memoOnly.str.annual.noi > 0 && memoOnly.str.posted === false);
// Overrides on a shared GL apply to the conventional part.
const ovr = E.calculate({...withStr, overrides: {'6461': 1200}});
near(ovr.rows['6461'].convMonthly.reduce((a, b) => a + b, 0), 1200, 'override is the conventional part'); near(ovr.rows['6461'].annual, 1200 + inc.rows['6461'].strAnnual, 'STR still adds');
// Reforecast: closed months with actuals take the actual, without adding STR on top.
const rf = E.calculate({...withStr, closedMonths: 2, actuals: {'6840': [11, 12, ...Array(10).fill(null)], '5220': [-3000, -3000, ...Array(10).fill(null)]}});
assert.deepEqual(rf.rows['6840'].monthly.slice(0, 2), [11, 12]); assert.deepEqual(rf.rows['5220'].monthly.slice(0, 2), [-3000, -3000]);
assert(rf.rows['6840'].monthly[2] > 12);
// Publication includes the programme.
const pub = E.publicationRows(inc);
assert(pub.some(r => r.gl === '6840') && pub.some(r => r.gl === '5144' && r.monthly[0] > 0));
assert(H.workbookMatrix(inc, periods).some(r => r[0] === '6840'));
// Adding STR after import moves proposal-linked lines; the frozen base keeps zero STR units.
assert(inc.rows['5951'].annual < base.rows['5951'].annual);
// Checks surface in the model checks.
assert(L.modelChecks(withStr, E.calculate({...withStr, str: {...withStr.str, channelMix: [{channel: 'X', share: 0.5, feePct: 0}]}})).some(c => /STR programme/.test(c.message)));

// --- Investor package carries the programme ---
const inv = P.investorSummary({community: 'Test', units: 10, unitLabel: 'unit', fiscalYear: 2027, periodLabel: 'Jan 2027 – Dec 2027', assetClass: 'Conventional', result: inc, assumptions: [], notes: [], approvals: []});
assert.equal(inv.str.rows.at(-1).final, inv.rows[2].final, 'investor STR table ends at the property NOI');
assert(P.investorHtml(inv).includes('Short-term rental programme'));
assert((await P.investorPdf(inv, {PDFLib})).length > 2000);
assert.equal(P.investorSummary({community: 'T', units: 10, unitLabel: 'unit', fiscalYear: 2027, periodLabel: '', assetClass: '', result: base, assumptions: [], notes: [], approvals: []}).str, null);
assert(!base.groups.some(g => g.name === 'Short-term rental'), 'no empty STR group without a programme');

// --- Saved programme workbook import ---
const rows = [['name', 'value', 'source'], ['name', 'Test programme'], ['adr', 210], ['alos', 2.5], ['lodgingTax', 0.12], ['adrMode', 'monthly'],
  ['adrMonthly', JSON.stringify({2027: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]})], ['occMode', 'curve'], ['curve', 'str_coastal'],
  ['channelMix', JSON.stringify([{channel: 'Airbnb', share: 1, feePct: 0.15, direct: false}])], ['utilities', JSON.stringify({electric: {perOccUsage: 500}})]];
assert(S.isStrProgrammeWorkbook(['RISE Report', 'Monthly STR', 'Applied assumptions']));
const parsed = S.parseStrProgrammeWorkbook(rows, {periods: E.fiscalPeriods(2027, 7)});
assert(parsed.ok); assert.equal(parsed.drivers.adr, 210); assert.equal(parsed.curve, 'str_coastal'); assert.equal(parsed.occMonthly, null);
assert.deepEqual(parsed.adrMonthly.slice(0, 2), [null, null], 'months outside the saved year are left to the base rate');
assert.equal(parsed.adrMonthly[6], 1, 'fiscal month 7 is calendar January 2027');
const imported = S.applyProgrammeImport(S.newStrProgram(), parsed);
assert.equal(imported.name, 'Test programme'); assert.equal(imported.channelMix[0].feePct, 0.15);
console.log('PASS Budget Builder v2 STR: floor-plan engine, ramp and capital, property integration and views, publication, saved-programme import');
