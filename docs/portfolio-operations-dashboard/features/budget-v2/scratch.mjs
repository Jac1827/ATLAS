/* Budget Builder v2 — start a property budget from scratch.
 * From the community name, asset class, unit count, address and rent, suggest a full
 * starting budget: leasing schedule, staffing, and every line on the RISE chart of
 * accounts a property of that type normally carries. The suggestion becomes the
 * "starting point" the budget is linked to, so every driver then moves it exactly as
 * an imported budget would.
 *
 * Amounts are generic per-unit planning assumptions (Florida baseline, adjusted by
 * state), not RISE results. When portfolio benchmarks exist (medians across at least
 * three RISE communities) they replace the generic category totals.
 */
import {buildContext, freezeBase, sectionForGl, num, SUMMARY_GROUPS} from './engine.mjs?v=4b36c2fcc5efc21f';
import {seedPositions} from './learning.mjs?v=e541d61d5652b40b';

const zeros = () => Array(12).fill(0);
const sum = a => a.reduce((t, v) => t + (Number(v) || 0), 0);
const r2 = n => Math.round(n * 100) / 100;

/* Turnover by calendar month (conventional summer peak). */
const TURN_CURVE = [0.62, 0.6, 0.78, 0.95, 1.2, 1.42, 1.62, 1.6, 1.05, 0.78, 0.7, 0.68];

export const CLASS_PROFILE = {
  conventional: {scale: 1, occ: 95, turnover: 50, reimb: 45, pets: 0.3, interior: 1, payroll: 1, label: 'unit'},
  townhome: {scale: 1.1, occ: 95, turnover: 40, reimb: 45, pets: 0.4, interior: 1.15, payroll: 1, label: 'home'},
  student_bed: {scale: 0.5, occ: 97, turnover: 60, reimb: 0, pets: 0.05, interior: 0.45, payroll: 0.8, label: 'bed'},
  student_apt: {scale: 1.15, occ: 97, turnover: 60, reimb: 0, pets: 0.05, interior: 1.1, payroll: 1.1, label: 'apartment'},
  manufactured: {scale: 0.45, occ: 96, turnover: 12, reimb: 35, pets: 0.4, interior: 0.15, payroll: 0.6, label: 'pad'},
  military: {scale: 1, occ: 95, turnover: 45, reimb: 0, pets: 0.4, interior: 1.1, payroll: 1, label: 'home'}
};

/* State adjustments to payroll, property tax and insurance (Florida = 1). */
const STATE = {FL: [1, 1, 1], GA: [0.95, 0.9, 0.75], AL: [0.9, 0.6, 0.85], SC: [0.93, 0.85, 0.85], NC: [0.95, 0.85, 0.65], TN: [0.95, 0.8, 0.6], TX: [1, 1.6, 0.9], LA: [0.92, 0.7, 1.2],
  VA: [1.08, 0.95, 0.55], MD: [1.12, 1.15, 0.55], DC: [1.25, 1.1, 0.55], DE: [1.05, 0.7, 0.55], PA: [1.05, 1.2, 0.55], NJ: [1.18, 1.7, 0.6], NY: [1.25, 1.6, 0.65], OH: [0.92, 1, 0.5], KY: [0.9, 0.75, 0.55]};
export const stateFactors = st => { const f = STATE[String(st || '').toUpperCase()] || [1, 1, 1]; return {payroll: f[0], tax: f[1], ins: f[2], known: !!STATE[String(st || '').toUpperCase()]}; };

/* Per unit per year (or per occurrence where noted), conventional Florida baseline. */
const LINES = [
  // income: rate × quantity per month
  {gl: '5915', name: 'Water/Sewer Reimbursement', q: 'occ', rate: p => p.reimb},
  {gl: '5920', name: 'Late Charge', q: 'occ', rate: () => 6},
  {gl: '5951', name: 'Application Fees', q: 'mi', rate: () => 75},
  {gl: '5926', name: 'Administrative Fee', q: 'mi', rate: () => 150},
  {gl: '5964', name: 'Monthly Pet Rent', q: 'occ', rate: p => 25 * p.pets},
  {gl: '5950', name: 'Lease Termination', q: 'mo', rate: () => 60},
  // payroll-linked
  {gl: '6339', name: 'Leasing Bonuses', q: 'mi', rate: () => 75},
  {gl: '6713', name: 'Employer Portion of FICA', pctSalaries: 7.65},
  {gl: '6722', name: 'Workers Compensation', pctSalaries: 2.2},
  {gl: '6723', name: 'Health Insurance Expense', pctSalaries: 9},
  {gl: '6730', name: '401k Contributions Expense', pctSalaries: 1.5},
  {gl: '6108', name: 'Payroll Fees', pctSalaries: 0.6},
  // general & administrative (per unit per year)
  {gl: '6232', name: 'Office Expense', unit: 110},
  {gl: '6233', name: 'Dues & Subscriptions', unit: 20},
  {gl: '6237', name: 'Software', unit: 190},
  {gl: '6242', name: 'Telephone/Answering Service', unit: 55},
  {gl: '6235', name: 'Postage', unit: 12},
  {gl: '6241', name: 'License & Permits', unit: 12},
  {gl: '6245', name: 'Professional Development', unit: 25},
  {gl: '6240', name: 'Bank Charges', q: 'occ', rate: () => 1.5},
  {gl: '6257', name: 'Credit Reports', q: 'mi', rate: () => 20},
  {gl: '6238', name: 'Legal-Eviction', unit: 35},
  // professional
  {gl: '6340', name: 'Legal Fees', unit: 25},
  {gl: '6350', name: 'Audit Fees', unit: 20},
  // marketing
  {gl: '6212', name: 'Internet Advertising', unit: 170},
  {gl: '6224', name: 'Resident Events & Retention', unit: 45},
  // contract services
  {gl: '6537', name: 'Landscaping Contract', unit: 280, skip: c => c === 'student_bed'},
  {gl: '6522', name: 'Exterminating Contract', unit: 55},
  {gl: '6525', name: 'Garbage', unit: 170},
  {gl: '6520', name: 'Pool Contract', unit: 45, skip: c => c === 'military'},
  {gl: '6532', name: 'Fire and Safety Monitoring Contract', unit: 35},
  // turnover (per move-out)
  {gl: '6581', name: 'Interior Paint - Labor', q: 'mo', rate: p => 170 * p.interior},
  {gl: '6582', name: 'Interior Paint - Supplies', q: 'mo', rate: p => 55 * p.interior},
  {gl: '6583', name: 'Floor - Cleaning', q: 'mo', rate: p => 85 * p.interior},
  {gl: '6586', name: 'Turn Cleaning', q: 'mo', rate: p => 120 * p.interior},
  // repairs & maintenance
  {gl: '6557', name: 'Appliance Parts & Supplies', unit: 75, interior: true},
  {gl: '6558', name: 'Electrical Parts & Supplies', unit: 30, interior: true},
  {gl: '6559', name: 'Plumbing Parts & Supplies', unit: 65, interior: true},
  {gl: '6560', name: 'HVAC Parts & Supplies', unit: 85, interior: true},
  {gl: '6562', name: 'Exterior Building Repairs', unit: 40},
  {gl: '6570', name: 'Equipment and Tools', unit: 18},
  {gl: '6574', name: 'Light Bulbs', unit: 10},
  // utilities
  {gl: '6450', name: 'C/A Electricity', unit: 240},
  {gl: '6451', name: 'C/A Water/Sewer', unit: 90},
  {gl: '6460', name: 'Vacant Unit Electricity', q: 'vac', rate: () => 45},
  {gl: '6463', name: 'Water/Sewer Units', q: 'occ', rate: p => (p.reimb ? 48 : 40)},
  // taxes & insurance
  {gl: '6710', name: 'Real Estate Taxes', unit: 1650, tax: true},
  {gl: '6720', name: 'Property Insurance', unit: 700, ins: true}
];

/* Staffing suggestion by asset class and size. */
export function suggestStaff(assetClass, units, factor = 1) {
  const u = num(units), p = CLASS_PROFILE[assetClass] || CLASS_PROFILE.conventional, pay = s => Math.round(s * factor / 500) * 500;
  const student = assetClass.startsWith('student'), mh = assetClass === 'manufactured';
  const rows = [
    {gl: '6330', title: 'General Manager', count: 1, salary: pay(68000)},
    {gl: '6332', title: 'Assistant General Manager', count: u > (student ? 400 : 220) ? 1 : 0, salary: pay(50000)},
    {gl: '6335', title: student ? 'Leasing Professional' : 'Leasing Professional', count: mh ? (u > 250 ? 1 : 0) : Math.max(1, Math.round(u * p.payroll / (student ? 220 : 160))), salary: pay(40000)},
    {gl: '6511', title: 'Maintenance Supervisor', count: 1, salary: pay(60000)},
    {gl: '6510', title: 'Maintenance Technician', count: Math.max(mh ? 0 : 1, Math.round(u * p.payroll / 110) - 1), salary: pay(46000)},
    {gl: '6512', title: 'Porter / Housekeeping', count: u > 150 && !mh ? Math.max(1, Math.round(u / 250)) : 0, salary: pay(33000)}];
  return rows.map(r => ({id: `scratch-${r.gl}`, title: r.title, gl: r.gl, count: r.count, salary: r.salary, raisePct: 3, raiseMonth: null, confirmed: false}));
}

/**
 * input: {name, assetClass, units, address: {street, city, state, zip}, marketRent, fiscalYear,
 *   startMonth, periods, status: 'operating' | 'leaseup', firstMoveInMonth, absorption, currentOccupied}
 * benchmarks: {group: {median, n}} from atlas_budget_benchmarks (per unit per year), optional.
 */
export function suggestStart(input, {benchmarks = {}} = {}) {
  const assetClass = CLASS_PROFILE[input.assetClass] ? input.assetClass : 'conventional';
  const mixIn = assetClass === 'manufactured' && Array.isArray(input.rateMix) && sum(input.rateMix.map(r => num(r.units))) > 0 ? input.rateMix.map(r => ({key: r.key, label: r.label, units: Math.max(0, Math.round(num(r.units))), rent: num(r.rent)})) : null;
  const base = CLASS_PROFILE[assetClass];
  const units = mixIn ? sum(mixIn.map(r => r.units)) : Math.max(0, Math.round(num(input.units)));
  const rent = mixIn ? Math.round(sum(mixIn.map(r => r.units * r.rent)) / units * 100) / 100 : num(input.marketRent);
  // Park-owned rental homes carry interior upkeep and turn like a rental home; pad-only sites barely do.
  const homeShare = mixIn ? sum(mixIn.filter(r => r.key === 'home').map(r => r.units)) / units : 0;
  const p = mixIn ? {...base, interior: base.interior + (1.1 - base.interior) * homeShare, turnover: base.turnover + (35 - base.turnover) * homeShare} : base;
  if (!units) throw Error('Enter the number of ' + p.label + 's.');
  const f = stateFactors(input.address?.state);
  const periods = input.periods;
  const notes = [];
  // Leasing schedule.
  const target = Math.round(units * p.occ / 100);
  const schedule = {beginOccupied: target, moveIns: zeros(), moveOuts: zeros(), targetOccPct: p.occ};
  if (input.status === 'leaseup') {
    const first = Math.max(0, Math.min(11, Math.round(num(input.firstMoveInMonth)))), pace = Math.max(1, Math.round(num(input.absorption) || units / 10));
    schedule.beginOccupied = Math.max(0, Math.round(num(input.currentOccupied)));
    let occ = schedule.beginOccupied;
    for (let m = first; m < 12 && occ < target; m++) { const n = Math.min(pace, target - occ); schedule.moveIns[m] = n; occ += n; }
    schedule.source = `Lease-up from ${schedule.beginOccupied} occupied: about ${pace} move-ins a month to ${p.occ}%`;
    notes.push(`Lease-up: absorption of ${pace} ${p.label}s a month — set it from comparable properties on the Leasing tab.`);
  } else {
    if (input.currentOccupied !== undefined && input.currentOccupied !== '' && input.currentOccupied !== null) schedule.beginOccupied = Math.max(0, Math.min(units, Math.round(num(input.currentOccupied))));
    const annualTurns = target * p.turnover / 100;
    const curve = periods.map(per => TURN_CURVE[Number(per.slice(5)) - 1]), cw = sum(curve);
    let carry = 0;
    curve.forEach((w, m) => { const exact = annualTurns * w / cw + carry, n = Math.round(exact); carry = exact - n; schedule.moveOuts[m] = n; schedule.moveIns[m] = n; });
    // Close any gap to the target occupancy over the first quarter.
    let gap = target - schedule.beginOccupied;
    for (let m = 0; m < 3 && gap > 0; m++) { const n = Math.ceil(gap / (3 - m)); schedule.moveIns[m] += n; gap -= n; }
    schedule.source = `${p.turnover}% annual turnover with a summer peak; ${p.occ}% occupancy target`;
  }
  const model = {version: 1, property: {name: input.name, units, assetClass, address: input.address || {}}, rateMix: mixIn, fiscalYear: input.fiscalYear, startMonth: input.startMonth || 1, periods,
    start: 'proposal', schedule, lines: [], positions: suggestStaff(assetClass, units, f.payroll), basis: {}, overrides: {}, notes: {}, investorNotes: {}, closedMonths: 0, actuals: null, floorPlans: [],
    assumptions: {marketRent: rent, rentGrowth: 0, ltlPct: 1.5, concessionPct: input.status === 'leaseup' ? 4 : 1, badDebtPct: 0.75, mgmtPct: 3, inflation: 3, taxChange: 0, insChange: 0, electric: 0, water: 0, sewer: 0, sewerShare: 55, reservePerUnit: 250, modelLtlPct: null, modelConcessionPct: null, modelBadDebtPct: null},
    learned: {}, sources: {proposal: {scratch: true, entity: 'Suggested starting point'}, t12: null, box: null, trending: null, conservice: null}};
  const c = buildContext(model);
  const add = (gl, name, monthly, why) => model.lines.push({gl, name, section: sectionForGl(gl, name), proposal: {total: r2(sum(monthly)), monthly: monthly.map(r2)}, items: [], note: '', suggestion: why});
  // Rent lines.
  const gpr = c.gprM;
  if (assetClass !== 'military') {
  add('5120', 'Gross Potential Rent', zeros().map(() => gpr), mixIn ? mixIn.filter(r => r.units).map(r => `${r.units} ${r.label.toLowerCase()} × $${r.rent.toLocaleString()}`).join(' + ') + ' a month'
    : `${units} ${p.label}s × ${rent ? '$' + rent.toLocaleString() : 'market rent (enter it)'} a month`);
  add('5125', 'Gain/Loss to Lease', zeros().map(() => -gpr * 0.015), '1.5% of GPR');
  add('5220', 'Rent Loss-Vacancy', zeros().map((_, m) => -c.vac[m] * c.rent), 'Vacant unit-months × rent from the leasing schedule');
  add('5250', 'Concessions', zeros().map(() => -gpr * num(model.assumptions.concessionPct) / 100), `${model.assumptions.concessionPct}% of GPR`);
  add('5255', 'Bad Debt Expense', zeros().map(() => -gpr * 0.0075), '0.75% of GPR');
  }
  const qty = (q, m) => ({occ: c.occ[m], mi: c.mi[m], mo: c.mo[m], vac: c.vac[m]}[q]);
  const salaries = zeros(); model.positions.forEach(pos => { for (let m = 0; m < 12; m++) salaries[m] += pos.count * pos.salary / 12 * 1; });
  for (const L of LINES) {
    if (L.skip?.(assetClass)) continue;
    if (assetClass === 'military' && ['Rental Income', 'Cost Of Leasing', 'Other Income'].includes(sectionForGl(L.gl, L.name))) continue;
    let monthly, why;
    if (L.q) { const rate = L.rate(p); if (!rate) continue; monthly = zeros().map((_, m) => qty(L.q, m) * rate); why = `$${r2(rate)} per ${{occ: 'occupied ' + p.label + '-month', mi: 'move-in', mo: 'move-out', vac: 'vacant ' + p.label + '-month'}[L.q]}`; }
    else if (L.pctSalaries) { monthly = salaries.map(v => v * L.pctSalaries / 100); why = `${L.pctSalaries}% of salaries`; }
    else { const k = p.scale * (L.interior ? p.interior : 1) * (L.tax ? f.tax : L.ins ? f.ins : 1); monthly = zeros().map(() => units * L.unit * k / 12); why = `$${Math.round(L.unit * k)} per ${p.label} a year`; }
    add(L.gl, L.name, monthly, why);
  }
  // Payroll lines carry their position cost so the payroll tab and grid agree.
  for (const pos of model.positions) if (!model.lines.some(l => l.gl === pos.gl)) add(pos.gl, pos.title, zeros().map(() => pos.count * pos.salary / 12), 'Suggested staffing');
  // Management fee on total income, reserves per unit.
  const incomeM = zeros(); model.lines.filter(l => ['Rental Income', 'Cost Of Leasing', 'Other Income'].includes(l.section)).forEach(l => l.proposal.monthly.forEach((v, m) => { incomeM[m] += v; }));
  if (assetClass !== 'military') add('6320', 'Management Fees', incomeM.map(v => v * 0.03), '3% of total income');
  const reserve = Math.round(250 * p.scale / 25) * 25; model.assumptions.reservePerUnit = reserve;
  add('1320', 'Replacement Reserve Fund', zeros().map(() => units * reserve / 12), `$${reserve} per ${p.label} a year`);
  // Portfolio benchmarks replace generic category totals (payroll and fees stay driven).
  const used = [];
  for (const [group, secs] of SUMMARY_GROUPS) {
    const b = benchmarks?.[group];
    if (!b?.median || ['Payroll', 'Management Fees'].includes(group)) continue;
    const ls = model.lines.filter(l => secs.includes(l.section)), cur = sum(ls.map(l => l.proposal.total));
    if (!cur) continue;
    const k = b.median * units / cur;
    ls.forEach(l => { l.proposal.monthly = l.proposal.monthly.map(v => r2(v * k)); l.proposal.total = r2(sum(l.proposal.monthly)); l.suggestion += ` · scaled to the RISE median for ${group} ($${Math.round(b.median)}/${p.label}, ${b.n} communities)`; });
    used.push(group);
  }
  if (used.length) notes.push(`RISE portfolio medians applied to: ${used.join(', ')}.`);
  else notes.push('Category amounts are generic planning assumptions until at least three RISE communities report benchmarks.');
  if (!f.known && input.address?.state) notes.push(`No cost adjustment on file for ${input.address.state}; Florida assumptions are used.`);
  if (!rent && assetClass !== 'military') notes.push('Enter the average market rent on the Drivers tab — rent lines are zero until then.');
  if (assetClass === 'military') { model.bah = []; notes.push('Expense-only budget. Add BAH by pay grade as a memo; it is excluded from publication and NOI.'); }
  model.positions = model.positions.filter(pp => pp.count > 0).concat(seedPositions([], {}).filter(s => !model.positions.some(pp => pp.gl === s.gl)).map(s => ({...s, count: 0})));
  model.base = freezeBase(model);
  model.scratch = {inputs: input, notes, generatedAt: new Date().toISOString()};
  return model;
}
