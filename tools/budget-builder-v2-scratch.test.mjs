// Budget Builder v2: a property budget started from scratch. Synthetic inputs only.
import assert from 'node:assert/strict';
const F = '../docs/portfolio-operations-dashboard/features/budget-v2/';
const E = await import(F + 'engine.mjs'), SC = await import(F + 'scratch.mjs');
const periods = E.fiscalPeriods(2027, 1);
const base = {name: 'Test Commons', assetClass: 'conventional', units: 240, marketRent: 1500, address: {street: '1 Main St', city: 'Jacksonville', state: 'FL', zip: '32202'}, fiscalYear: 2027, periods, status: 'operating'};
const m = SC.suggestStart(base);
const r = E.calculate(m);
for (const l of m.lines) { const x = r.rows[l.gl]; if (x.type !== 'payroll') assert(Math.abs(x.annual - l.proposal.total) <= 1, `${l.gl} equals its suggestion at the start`); }
assert.equal(Math.round(r.rows['5120'].annual), 240 * 1500 * 12);
near(r.kpis.avgOccupancy, 0.95, 'occupancy target', 0.002);
assert(m.positions.some(p => p.gl === '6330' && p.count === 1) && m.positions.find(p => p.gl === '6335').count >= 1, 'suggested staffing');
assert.equal(m.sources.proposal.scratch, true); assert(m.lines.every(l => l.suggestion), 'every line explains its suggestion');
assert.deepEqual(m.property.address.state, 'FL');
// Drivers move the suggested lines like an imported budget.
const busy = E.calculate({...m, schedule: {...m.schedule, moveOuts: m.schedule.moveOuts.map(v => v * 2), moveIns: m.schedule.moveIns.map(v => v * 2)}});
assert(busy.rows['6581'].annual > r.rows['6581'].annual * 1.9, 'turn costs follow move-outs');
const higher = E.calculate({...m, assumptions: {...m.assumptions, marketRent: 1600}});
assert(higher.rows['5120'].annual > r.rows['5120'].annual && higher.rows['6320'].annual > r.rows['6320'].annual, 'rent drives GPR and the management fee');
// State and asset class change the suggestion.
const nj = SC.suggestStart({...base, address: {state: 'NJ'}});
assert(nj.lines.find(l => l.gl === '6710').proposal.total > m.lines.find(l => l.gl === '6710').proposal.total, 'property tax adjusts by state');
assert(nj.positions.find(p => p.gl === '6330').salary > m.positions.find(p => p.gl === '6330').salary, 'payroll adjusts by state');
const beds = E.calculate(SC.suggestStart({...base, assetClass: 'student_bed', units: 600, marketRent: 800, periods: E.fiscalPeriods(2027, 8)}));
assert(beds.totals.annual.opex / 600 < r.totals.annual.opex / 240, 'per-bed costs are lower than per-unit costs');
assert.equal(SC.suggestStart({...base, assetClass: 'manufactured'}).lines.some(l => l.gl === '6581' && l.proposal.total > m.lines.find(x => x.gl === '6581').proposal.total), false, 'pads carry little interior turn cost');
// Lease-up from zero.
const lu = SC.suggestStart({...base, status: 'leaseup', currentOccupied: 0, firstMoveInMonth: 2, absorption: 20});
assert.deepEqual(lu.schedule.moveIns.slice(0, 4), [0, 0, 20, 20]); assert.equal(lu.schedule.beginOccupied, 0);
assert(E.calculate(lu).kpis.avgOccupancy < 0.5);
// RISE portfolio medians replace the generic category amounts.
const bm = SC.suggestStart(base, {benchmarks: {'Contract Services': {median: 1000, n: 4}, Payroll: {median: 1, n: 4}}});
const contract = E.calculate(bm).sections['Contract Services'].annual;
assert(Math.abs(contract - 240 * 1000) < 2, 'contract services scaled to the portfolio median');
assert.equal(E.calculate(bm).rows['6330'].annual, r.rows['6330'].annual, 'payroll stays on positions');
assert.throws(() => SC.suggestStart({...base, units: 0}), /number of units/);
console.log('PASS Budget Builder v2 from scratch: suggested lines, staffing, leasing schedule, state and asset-class adjustments, lease-up and portfolio medians');
function near(a, b, msg, tol) { assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); }
// Military expense-only behavior must survive the actual publication boundary.
const military = SC.suggestStart({...base, assetClass: 'military'});
military.bah = [{grade:'E-5',homes:80,monthlyBah:1800}];
const militaryResult = E.calculate(military);
const incomeSections = ['Rental Income','Cost Of Leasing','Other Income'];
assert(!military.lines.some(line=>incomeSections.includes(line.section)), 'military scratch creates no income or contra-income lines');
assert(!military.lines.some(line=>line.gl==='6320'), 'military scratch does not infer a fee from excluded income');
assert.equal(militaryResult.totals.annual.income,0);
assert(militaryResult.memo.annual>0, 'BAH remains a memo');
const militaryRows=E.publicationRows(militaryResult,military.periods);
assert(militaryRows.length>0);
assert(!militaryRows.some(row=>Number(row.gl || row.accountCode || row.glCode)>=5000 && Number(row.gl || row.accountCode || row.glCode)<6000), 'canonical publication has no military revenue');
assert(militaryRows.some(row=>row.gl==='6330'||row.accountCode==='6330'||row.glCode==='6330'), 'military payroll still publishes');
console.log('PASS military scratch publication: expenses and payroll only, BAH memo retained.');
