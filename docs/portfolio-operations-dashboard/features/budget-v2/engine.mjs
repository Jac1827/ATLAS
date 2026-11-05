/* Budget Builder v2 — calculation engine.
 * Pure, deterministic and browser/Node compatible. No network, no DOM.
 * Every amount is calculated per month (12 periods of the fiscal year) so the
 * governed hand-off can publish GL × month values exactly as computed here.
 *
 * Sign convention: income positive, contra-income (vacancy, concessions…) negative,
 * expenses positive. NOI = total income − operating expenses.
 */
import {strUnitsByMonth, strCalculate, strSectionFor, STR_INCOME_SECTION, STR_EXPENSE_SECTION} from './str.mjs?v=f3b38a6b870d777f';

export const ASSET_CLASSES = {
  conventional: {label: 'Conventional apartments', unitLabel: 'unit', model: 'conventional', incomeInNoi: true},
  townhome: {label: 'Townhomes', unitLabel: 'home', model: 'conventional', incomeInNoi: true},
  student_bed: {label: 'Student housing — by bed', unitLabel: 'bed', model: 'student', incomeInNoi: true, manualSeason: true},
  student_apt: {label: 'Student housing — by apartment', unitLabel: 'apartment', model: 'student', incomeInNoi: true, manualSeason: true},
  manufactured: {label: 'Manufactured housing', unitLabel: 'pad', model: 'conventional', incomeInNoi: true},
  military: {label: 'Military housing', unitLabel: 'home', model: 'owner_specific', incomeInNoi: false}
};

export const INCOME_SECTIONS = ['Rental Income', 'Cost Of Leasing', 'Other Income', STR_INCOME_SECTION];
export const OPEX_SECTIONS = ['Payroll Office', 'Payroll Maintenance', 'Payroll Related Expenses', 'General & Administrative', 'Professional Fees', 'Contract Services', 'Turnover Expense', 'Repairs & Maintenance', 'Marketing & Leasing', 'Common Area Utilities', 'Unit Utilities', 'Management Fees', 'Taxes & Insurance', STR_EXPENSE_SECTION];
export const BELOW_NOI_SECTIONS = ['Replacement Reserves', 'Capital Expenditures'];
export const ALL_SECTIONS = [...INCOME_SECTIONS, ...OPEX_SECTIONS, ...BELOW_NOI_SECTIONS];
export const SUMMARY_GROUPS = [
  ['Payroll', ['Payroll Office', 'Payroll Maintenance', 'Payroll Related Expenses']],
  ['General & Administrative', ['General & Administrative', 'Professional Fees']],
  ['Contract Services', ['Contract Services']],
  ['Turnover Expense', ['Turnover Expense']],
  ['Repairs & Maintenance', ['Repairs & Maintenance']],
  ['Marketing & Leasing', ['Marketing & Leasing']],
  ['Utilities', ['Common Area Utilities', 'Unit Utilities']],
  ['Management Fees', ['Management Fees']],
  ['Taxes & Insurance', ['Taxes & Insurance']],
  ['Short-term rental', [STR_EXPENSE_SECTION]]
];

/* Section from the RISE chart of accounts when an imported or new GL has no section. */
export const NON_OPERATING = 'Non-Operating';
export function sectionForGl(gl, name = '') {
  const n = Number(gl);
  const t = String(name).toLowerCase();
  if ((n >= 6800 && n < 7000 && n !== 6942 && n !== 6943) || n >= 8000) return NON_OPERATING;
  if (n >= 5100 && n < 5200) return n >= 5140 && n < 5200 ? 'Other Income' : 'Rental Income';
  if (n >= 5200 && n < 5300) return 'Cost Of Leasing';
  if (n >= 5300 && n < 6000) return 'Other Income';
  if ([6330, 6332, 6335, 6338, 6339, 6093, 6333].includes(n)) return 'Payroll Office';
  if (n >= 6510 && n <= 6514) return 'Payroll Maintenance';
  if (n === 6108 || (n >= 6711 && n <= 6730)) return 'Payroll Related Expenses';
  if (n === 6710 || (n >= 6717 && n <= 6721) || n === 6750) return 'Taxes & Insurance';
  if (n === 6320) return 'Management Fees';
  if (n >= 6340 && n < 6360) return 'Professional Fees';
  if (n >= 6450 && n <= 6452) return 'Common Area Utilities';
  if ((n >= 6460 && n <= 6464) || n === 6942 || n === 6943) return 'Unit Utilities';
  if (n >= 6580 && n <= 6595) return 'Turnover Expense';
  if (n >= 6200 && n < 6230 && n !== 6228) return 'Marketing & Leasing';
  if (n === 6261) return 'Marketing & Leasing';
  if (n >= 6100 && n < 6300) return 'General & Administrative';
  if (n === 6321) return 'General & Administrative';
  if (n === 6228 || n === 6465 || (n >= 6520 && n <= 6555) || n === 6576) return 'Contract Services';
  if (n >= 6280 && n < 6700) return 'Repairs & Maintenance';
  if (n === 1320 || n === 1324) return 'Replacement Reserves';
  if (n >= 1400 && n < 1700) return 'Capital Expenditures';
  if (/reserve/.test(t)) return 'Replacement Reserves';
  return 'General & Administrative';
}

/* Driver rules. Each line is linked to one driver; unknown GLs fall back by section.
 * kind values:
 *   gpr, ltl, vacancy, concessions, baddebt      rental mechanics
 *   rentScaled                                   fixed units × rent (model/employee units)
 *   occ, mi, mo, salaries, income                quantity drivers
 *   utilE, utilWS, vacE, occE, occWS             utility drivers (rate × quantity)
 *   tax, ins, reserve, payroll, fixed, capex     */
const BY_GL = {
  '5120': 'gpr', '5125': 'ltl', '5220': 'vacancy', '5250': 'concessions', '5255': 'baddebt',
  '5221': 'rentScaled', '5222': 'rentScaled', '5223': 'rentScaled', '5211': 'rentScaled',
  '5143': 'occ', '5145': 'occ', '5170': 'occ', '5175': 'occ', '5915': 'occ', '5916': 'occ', '5917': 'occ', '5919': 'occ',
  '5920': 'occ', '5921': 'occ', '5925': 'occ', '5923': 'occ', '5927': 'occ', '5924': 'occ', '5956': 'occ', '5960': 'occ',
  '5964': 'occ', '5953': 'occ', '6529': 'occ', '6240': 'occ', '6522': 'occ',
  '5951': 'mi', '5926': 'mi', '5952': 'mi', '5957': 'mi', '6339': 'mi', '6257': 'mi', '5258': 'mi', '6261': 'mi',
  '5950': 'mo', '5930': 'mo', '5932': 'mo', '5940': 'mo',
  '6320': 'income', '6450': 'utilE', '6451': 'utilWS', '6460': 'vacE', '6461': 'occE', '6942': 'occE', '6463': 'occWS', '6943': 'occWS',
  '6710': 'tax', '6720': 'ins', '1320': 'reserve'
};
const PAYROLL_GL = new Set(['6330', '6332', '6335', '6510', '6511', '6512', '6093', '6333']);
const BURDEN_GL = new Set(['6108', '6711', '6712', '6713', '6722', '6723', '6724', '6725', '6726', '6730']);
const CONTRACT_GL = new Set(['6228', '6465', '6520', '6522', '6525', '6527', '6528', '6532', '6537', '6540', '6544', '6545', '6546', '6551', '6576']);

export function driverKind(line) {
  const gl = String(line.gl);
  if (line.driver) return line.driver;
  if (BY_GL[gl]) return BY_GL[gl];
  if (PAYROLL_GL.has(gl)) return 'payroll';
  if (BURDEN_GL.has(gl)) return 'salaries';
  if (line.section === 'Turnover Expense') return 'mo';
  if (line.section === 'Capital Expenditures') return 'capex';
  return 'fixed';
}

export const DRIVER_LABELS = {
  gpr: 'Units × market rent', ltl: 'Loss to lease % × GPR', vacancy: 'Vacant unit-months × rent', concessions: 'Concessions % × GPR',
  baddebt: 'Bad debt % × GPR', rentScaled: 'Fixed units × rent', occ: 'Occupied unit-months', mi: 'Move-ins', mo: 'Move-outs (turns)',
  salaries: '% of salaries', income: 'Mgmt fee % × income', utilE: 'Electric rate', utilWS: 'Water/sewer rate', vacE: 'Vacant units × electric',
  occE: 'Occupied units × electric', occWS: 'Occupied units × W/S rate', tax: 'Assessment change', ins: 'Insurance renewal', reserve: 'Reserve $/unit',
  payroll: 'Payroll positions', fixed: 'Fixed', contract: 'Contract', capex: 'Project list', bah: 'BAH memo'
};

const sum = a => a.reduce((t, v) => t + (Number(v) || 0), 0);
const zeros = () => Array(12).fill(0);
export const num = x => { const n = typeof x === 'number' ? x : parseFloat(String(x ?? '').replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const round2 = n => Math.round(n * 100) / 100;

export function defaultAssumptions() {
  return {marketRent: 0, rentGrowth: 0, ltlPct: 0, concessionPct: 0, badDebtPct: 0, mgmtPct: 3, inflation: 3, taxChange: 0, insChange: 0,
    electric: 0, water: 0, sewer: 0, sewerShare: 55, reservePerUnit: 250, modelLtlPct: null, modelConcessionPct: null, modelBadDebtPct: null};
}

/* Monthly payroll cost of one position. raiseMonth is a fiscal-month index (0–11). */
export function positionMonthly(p) {
  const out = zeros();
  const count = num(p.count), salary = num(p.salary), raise = num(p.raisePct) / 100;
  const start = p.startMonth == null ? 0 : num(p.startMonth), end = p.endMonth == null ? 11 : num(p.endMonth);
  const raiseMonth = p.raiseMonth == null ? 12 : num(p.raiseMonth);
  for (let m = 0; m < 12; m++) if (m >= start && m <= end) out[m] = count * salary / 12 * (m >= raiseMonth ? 1 + raise : 1);
  return out;
}

/* Context: every quantity a driver can reference, per month. */
export function buildContext(model) {
  const a = {...defaultAssumptions(), ...(model.assumptions || {})};
  const units = num(model.property?.units);
  const rent = num(a.marketRent) * (1 + num(a.rentGrowth) / 100);
  const s = model.schedule || {};
  const mi = (s.moveIns || zeros()).map(num), mo = (s.moveOuts || zeros()).map(num);
  const occRaw = [];
  let o = num(s.beginOccupied);
  for (let m = 0; m < 12; m++) { o = Math.max(0, Math.min(units, o + mi[m] - mo[m])); occRaw.push(o); }
  // STR units leave the long-term pool: the schedule's occupancy rate applies to the
  // remaining long-term units, so occupied units, move-ins and move-outs scale down.
  const strUnits = Array.isArray(model.strUnitsFixed) ? model.strUnitsFixed.map(num) : strUnitsByMonth(model);
  const ltUnits = strUnits.map(n => Math.max(0, units - n));
  const share = ltUnits.map(n => (units ? n / units : 1));
  const occ = occRaw.map((v, m) => v * share[m]);
  const vac = occ.map((v, m) => Math.max(0, ltUnits[m] - v));
  const miLt = mi.map((v, m) => v * share[m]), moLt = mo.map((v, m) => v * share[m]);
  const salaries = zeros();
  for (const p of model.positions || []) positionMonthly(p).forEach((v, m) => { salaries[m] += v; });
  const sewerShare = num(a.sewerShare) / 100;
  const ws = num(a.sewer) * sewerShare + num(a.water) * (1 - sewerShare);
  return {units, rent, gprM: units * rent, occ, occRaw, vac, mi: miLt, mo: moLt, miRaw: mi, moRaw: mo, strUnits, ltUnits, salaries, a,
    E: num(a.electric), WS: ws, ltl: num(a.ltlPct), conc: num(a.concessionPct), bd: num(a.badDebtPct), mgmt: num(a.mgmtPct),
    infl: num(a.inflation), tax: num(a.taxChange), ins: num(a.insChange), reserve: num(a.reservePerUnit),
    occUM: sum(occRaw), occLtUM: sum(occ), vacUM: sum(vac), miTotal: sum(mi), moTotal: sum(mo), salTotal: sum(salaries)};
}

/* Quantity per month for linked scaling (proposal × qty/baseQty). */
function quantity(kind, c, m, income) {
  switch (kind) {
    case 'gpr': return c.gprM;
    case 'ltl': return c.gprM * c.ltl;
    case 'vacancy': return c.vac[m] * c.rent;
    case 'concessions': return c.gprM * c.conc;
    case 'baddebt': return c.gprM * c.bd;
    case 'rentScaled': return c.rent;
    case 'occ': return c.occ[m];
    case 'mi': return c.mi[m];
    case 'mo': return c.mo[m];
    case 'salaries': return c.salaries[m];
    case 'income': return (income?.[m] || 0) * c.mgmt;
    case 'utilE': return 1 + c.E / 100;
    case 'utilWS': return 1 + c.WS / 100;
    case 'vacE': return c.vac[m] * (1 + c.E / 100);
    case 'occE': return c.occ[m] * (1 + c.E / 100);
    case 'occWS': return c.occ[m] * (1 + c.WS / 100);
    case 'tax': return 1 + c.tax / 100;
    case 'ins': return 1 + c.ins / 100;
    default: return null;
  }
}

/* Model suggestion per month from learned run-rates (T12 basis), independent of the proposal. */
function modelMonthly(line, kind, c, basis, income, model) {
  const t12 = num(line.t12?.total);
  const g = 1 + c.infl / 100;
  const isIncome = INCOME_SECTIONS.includes(line.section);
  const rateOf = (total, q) => (q ? total / q : 0);
  const out = zeros();
  const learned = model.learned?.[line.gl];
  for (let m = 0; m < 12; m++) {
    let v;
    switch (kind) {
      case 'gpr': v = c.gprM; break;
      case 'ltl': v = -c.gprM * num(c.a.modelLtlPct ?? c.ltl) / 100; break;
      case 'vacancy': v = -c.vac[m] * c.rent; break;
      case 'concessions': v = -c.gprM * num(c.a.modelConcessionPct ?? c.conc) / 100; break;
      case 'baddebt': v = -c.gprM * num(c.a.modelBadDebtPct ?? c.bd) / 100; break;
      case 'rentScaled': v = basis.rent ? t12 / 12 * c.rent / basis.rent : t12 / 12; break;
      case 'occ': v = rateOf(t12, basis.occUM) * c.occ[m] * (isIncome ? 1 : g); break;
      case 'mi': v = rateOf(t12, basis.mi) * c.mi[m]; break;
      case 'mo': v = rateOf(t12, basis.mo) * c.mo[m] * (isIncome ? 1 : g); break;
      case 'salaries': v = rateOf(t12, basis.salaries) * c.salaries[m]; break;
      case 'income': v = (income?.[m] || 0) * (num(c.a.modelMgmtPct ?? c.mgmt)) / 100; break;
      case 'utilE': v = monthOf(line.t12, m) * (1 + c.E / 100); break;
      case 'utilWS': v = monthOf(line.t12, m) * (1 + c.WS / 100); break;
      case 'vacE': v = rateOf(t12, basis.vacUM) * c.vac[m] * (1 + c.E / 100); break;
      case 'occE': v = rateOf(t12, basis.occUM) * c.occ[m] * (1 + c.E / 100); break;
      case 'occWS': v = rateOf(t12, basis.occUM) * c.occ[m] * (1 + c.WS / 100); break;
      case 'tax': v = monthOf(line.t12, m) * 1.03; break;
      case 'ins': v = monthOf(line.t12, m) * 1.05; break;
      case 'reserve': v = c.reserve * c.units / 12; break;
      case 'payroll': v = sum((model.positions || []).filter(p => String(p.gl) === String(line.gl)).map(p => positionMonthly(p)[m])) || monthOf(line.t12, m) * g; break;
      case 'capex': v = null; break;
      default: v = monthOf(line.t12, m) * (isIncome ? 1 : g);
    }
    if (v !== null && learned?.calibration && Number.isFinite(learned.calibration)) v *= learned.calibration;
    out[m] = v;
  }
  return out.some(v => v === null) ? null : out;
}

function monthOf(t12, m) {
  if (!t12) return 0;
  if (Array.isArray(t12.monthly) && t12.monthly.length === 12) return num(t12.monthly[m]);
  return num(t12.total) / 12;
}

function shape(values, annual) {
  const total = sum(values || []);
  if (values && total) return values.map(v => annual * num(v) / total);
  return Array(12).fill(annual / 12);
}

/* Main calculation. */
export function calculate(model) {
  const c = buildContext(model);
  const base = model.base ? buildContext({...model, ...model.base, property: model.property, strUnitsFixed: model.base.strUnits || zeros()}) : c;
  const basis = {rent: num(model.basis?.rent), occUM: num(model.basis?.occUM), vacUM: num(model.basis?.vacUM), mi: num(model.basis?.moveIns), mo: num(model.basis?.moveOuts), salaries: num(model.basis?.salaries)};
  const asset = ASSET_CLASSES[model.property?.assetClass] || ASSET_CLASSES.conventional;
  const closed = Math.max(0, Math.min(12, num(model.closedMonths)));
  const start = model.start || 'proposal';
  const out = {};
  const lines = (model.lines || []).filter(l => !l.removed && l.section !== NON_OPERATING);

  const pass = (sections, income, baseIncome) => {
    for (const line of lines.filter(l => sections.includes(l.section))) {
      let kind = driverKind(line);
      if (asset.model === 'owner_specific' && kind === 'income') kind = 'fixed';
      const proposal = Array.isArray(line.proposal?.monthly) ? line.proposal.monthly.map(num) : (line.proposal?.total != null ? Array(12).fill(num(line.proposal.total) / 12) : null);
      const model12 = modelMonthly(line, kind, c, basis, income, model);
      const monthly = zeros();
      let type = ['fixed', 'capex'].includes(kind) ? (CONTRACT_GL.has(String(line.gl)) ? 'contract' : kind) : (kind === 'payroll' ? 'payroll' : 'linked');
      for (let m = 0; m < 12; m++) {
        let v;
        if (kind === 'payroll') v = sum((model.positions || []).filter(p => String(p.gl) === String(line.gl)).map(p => positionMonthly(p)[m]));
        else if (kind === 'reserve') v = c.reserve * c.units / 12;
        else if (!proposal) v = start === 'model' || !model.sources?.proposal ? (model12 ? model12[m] : 0) : 0;
        else if (start === 'model') v = model12 ? model12[m] : proposal[m];
        else if (type === 'linked') {
          const q = quantity(kind, c, m, income), bq = quantity(kind, base, m, baseIncome);
          v = proposal[m] && q !== null && bq ? proposal[m] * q / bq : proposal[m];
        } else v = proposal[m];
        monthly[m] = v;
      }
      const ov = model.overrides?.[line.gl];
      let overridden = false;
      if (ov != null && ov !== '') {
        overridden = true;
        if (Array.isArray(ov)) ov.forEach((v, m) => { if (v != null && v !== '') monthly[m] = num(v); });
        else { const shaped = shape(monthly.some(v => v) ? monthly : (proposal || model12), num(ov)); shaped.forEach((v, m) => { monthly[m] = v; }); }
      }
      const actual = model.actuals?.[line.gl];
      const locked = zeros().map((_, m) => m < closed);
      if (closed && actual) for (let m = 0; m < closed; m++) monthly[m] = num(actual[m]);
      out[line.gl] = {line, kind, type, monthly: monthly.map(round2), annual: round2(sum(monthly)), model: model12 ? model12.map(round2) : null,
        modelAnnual: model12 ? round2(sum(model12)) : null, proposalAnnual: proposal ? round2(sum(proposal)) : null, t12: num(line.t12?.total), overridden, locked};
    }
  };

  pass(INCOME_SECTIONS, null, null);
  const incomeM = zeros(), baseIncomeM = zeros();
  for (const r of Object.values(out)) r.monthly.forEach((v, m) => { incomeM[m] += v; });
  const str = model.str?.enabled ? strCalculate(model, c) : null;
  const postStr = str && model.str.postToProperty !== false;
  // The property management fee excludes STR income unless the agreement charges it.
  // Converted units' rent always leaves the fee base.
  if (postStr) for (let m = 0; m < 12; m++) {
    incomeM[m] += str.lines.conversionLoss[m];
    if (model.str.propertyMgmtFeeOnStr) incomeM[m] += str.monthly.revenue[m] + str.monthly.deductions[m];
  }
  if (model.base?.incomeMonthly) model.base.incomeMonthly.forEach((v, m) => { baseIncomeM[m] = num(v); });
  else lines.filter(l => INCOME_SECTIONS.includes(l.section)).forEach(l => (l.proposal?.monthly || []).forEach((v, m) => { baseIncomeM[m] += num(v); }));
  pass([...OPEX_SECTIONS, ...BELOW_NOI_SECTIONS], incomeM, baseIncomeM);
  if (lines.some(l => !ALL_SECTIONS.includes(l.section))) pass(lines.filter(l => !ALL_SECTIONS.includes(l.section)).map(l => l.section), incomeM, baseIncomeM);

  if (postStr) mergeStr(model, out, str, closed);
  const result = summarize(model, c, out, asset);
  if (str) {
    // The same budget without the programme: the difference is the programme's
    // full effect on the property, including long-term income it displaces.
    const without = model.str.postToProperty === false ? result : calculate({...model, str: {...model.str, enabled: false}});
    result.str = {...str, posted: postStr, without: without.totals.annual, withoutMonthly: without.monthly, withoutRows: Object.fromEntries(Object.entries(without.rows).map(([gl, r]) => [gl, r.monthly])),
      impact: impactOf(result, without)};
  }
  return result;
}

/* Add STR GL amounts to the property rows. Shared GLs keep their conventional part
 * separately (convMonthly) so overrides and views stay exact. */
function mergeStr(model, out, str, closed) {
  for (const g of str.glRows) {
    const actual = model.actuals?.[g.gl];
    let r = out[g.gl];
    if (!r) {
      const line = {gl: g.gl, name: g.name, section: strSectionFor(g.nature, g.gl, sectionForGl), str: true};
      r = out[g.gl] = {line, kind: 'str', type: 'str', monthly: zeros(), annual: 0, model: null, modelAnnual: null, proposalAnnual: null, t12: 0, overridden: false, locked: zeros().map((_, m) => m < closed)};
    }
    r.convMonthly = r.monthly.slice();
    r.strMonthly = g.monthly.map((v, m) => (m < closed && actual ? 0 : v));
    if (r.type === 'str' && closed && actual) for (let m = 0; m < closed; m++) r.convMonthly[m] = num(actual[m]);
    r.monthly = r.convMonthly.map((v, m) => round2(v + r.strMonthly[m]));
    r.annual = round2(sum(r.monthly));
    r.strAnnual = round2(sum(r.strMonthly));
    r.strKeys = g.keys;
  }
}

function impactOf(result, without) {
  const rows = {};
  const gls = new Set([...Object.keys(result.rows), ...Object.keys(without.rows)]);
  for (const gl of gls) {
    const a = result.rows[gl], b = without.rows[gl];
    const monthly = zeros().map((_, m) => round2((a?.monthly[m] || 0) - (b?.monthly[m] || 0)));
    if (monthly.some(v => Math.abs(v) >= 0.005)) rows[gl] = {gl, name: (a || b).line.name, section: (a || b).line.section, monthly, annual: round2(sum(monthly)), strDirect: a?.strAnnual || 0};
  }
  const t = k => round2(result.totals.annual[k] - without.totals.annual[k]);
  return {rows, totals: {income: t('income'), opex: t('opex'), noi: t('noi'), reserves: t('reserves'), capex: t('capex'), cashFlow: t('cashFlow')},
    monthly: {income: result.monthly.income.map((v, m) => round2(v - without.monthly.income[m])), opex: result.monthly.opex.map((v, m) => round2(v - without.monthly.opex[m])), noi: result.monthly.noi.map((v, m) => round2(v - without.monthly.noi[m]))}};
}

function summarize(model, c, rows, asset) {
  const units = c.units || 1;
  const bySection = {};
  for (const r of Object.values(rows)) {
    const s = bySection[r.line.section] ||= {section: r.line.section, monthly: zeros(), annual: 0, t12: 0, proposal: 0, model: 0, lines: []};
    r.monthly.forEach((v, m) => { s.monthly[m] += v; });
    s.annual += r.annual; s.t12 += r.t12; s.proposal += r.proposalAnnual || 0; s.model += r.modelAnnual ?? r.annual; s.lines.push(r);
  }
  const tot = (sections, k) => sections.reduce((t, s) => t + (bySection[s]?.[k] || 0), 0);
  const totM = sections => { const o = zeros(); sections.forEach(s => (bySection[s]?.monthly || []).forEach((v, m) => { o[m] += v; })); return o; };
  const keys = ['annual', 't12', 'proposal', 'model'];
  const T = {};
  for (const k of keys) {
    const inc = asset.incomeInNoi ? tot(INCOME_SECTIONS, k) : 0;
    const opex = tot(OPEX_SECTIONS, k);
    const reserves = tot(['Replacement Reserves'], k), capex = tot(['Capital Expenditures'], k);
    T[k] = {income: inc, opex, noi: inc - opex, reserves, capex, cashFlow: inc - opex - reserves - capex};
  }
  const incomeM = asset.incomeInNoi ? totM(INCOME_SECTIONS) : zeros();
  const opexM = totM(OPEX_SECTIONS);
  const groups = SUMMARY_GROUPS.map(([name, secs]) => ({name, final: tot(secs, 'annual'), t12: tot(secs, 't12'), proposal: tot(secs, 'proposal'), model: tot(secs, 'model'), perUnit: tot(secs, 'annual') / units})).filter(g => g.name !== 'Short-term rental' || g.final || g.t12 || g.proposal);
  const memo = asset.incomeInNoi ? null : {label: 'BAH memo (not collected; excluded from NOI)', annual: bahMemo(model, c)};
  return {context: c, rows, sections: bySection, totals: T, monthly: {income: incomeM, opex: opexM, noi: incomeM.map((v, m) => v - opexM[m])},
    groups, memo, kpis: {avgOccupancy: c.units ? c.occUM / 12 / c.units : 0, moveIns: c.miTotal, moveOuts: c.moTotal, turnover: c.units ? c.moTotal / c.units : 0,
      noiPerUnit: T.annual.noi / units, opexPerUnit: T.annual.opex / units, strUnitsAvg: sum(c.strUnits) / 12}};
}

/* Military: BAH that would be collected = Σ pay-grade homes × monthly BAH × occupancy share. */
export function bahMemo(model, c = buildContext(model)) {
  const grades = model.bah || [];
  const share = c.units ? c.occUM / (c.units * 12) : 0;
  return round2(grades.reduce((t, g) => t + num(g.homes) * num(g.monthlyBah) * 12 * share, 0));
}

/* Lines needing a written note: variance vs T12 above both $1,000 and 10%. */
export function noteFlags(result, notes = {}, {dollars = 1000, pct = 10} = {}) {
  return Object.values(result.rows).filter(r => {
    if (r.type === 'str') return false;
    const t12 = r.t12, d = r.annual - t12;
    const p = t12 ? Math.abs(d / t12) * 100 : (Math.abs(d) > 0 ? Infinity : 0);
    const note = notes[r.line.gl] ?? r.line.note;
    return Math.abs(d) > dollars && p > pct && !String(note || '').trim();
  }).map(r => r.line.gl);
}

/* Freeze the base context so proposal-linked lines equal the proposal until a driver moves. */
export function freezeBase(model) {
  const lines = model.lines || [];
  const incomeMonthly = zeros();
  lines.filter(l => INCOME_SECTIONS.includes(l.section)).forEach(l => (l.proposal?.monthly || []).forEach((v, m) => { incomeMonthly[m] += num(v); }));
  return {schedule: structuredClone(model.schedule || {}), assumptions: structuredClone(model.assumptions || {}), positions: structuredClone(model.positions || []), incomeMonthly, strUnits: strUnitsByMonth(model)};
}

/* GL × month rows for the governed workbook hand-off. Capex/reserves are included (below NOI). */
export function publicationRows(result) {
  return Object.values(result.rows).map(r => ({gl: String(r.line.gl), name: r.line.name, section: r.line.section, monthly: r.monthly.map(round2)}));
}

export function fiscalPeriods(year, startMonth = 1) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m0 = (startMonth - 1 + i) % 12, y = Number(year) - (startMonth > 1 ? 1 : 0) + Math.floor((startMonth - 1 + i) / 12);
    out.push(`${y}-${String(m0 + 1).padStart(2, '0')}`);
  }
  return out;
}

/* Student housing: distribute a season's move-ins/move-outs across manually set months. */
export function seasonSchedule({units, preleasePct = 95, turnMonth = 7, seasonStartMonth = 9, renewalPct = 40, summerOccPct = 30}) {
  const mi = zeros(), mo = zeros();
  const fall = Math.round(num(units) * num(preleasePct) / 100);
  const renewals = Math.round(fall * num(renewalPct) / 100);
  mo[(turnMonth + 11) % 12] = Math.max(0, fall - Math.round(num(units) * num(summerOccPct) / 100));
  mi[turnMonth] = fall - renewals;
  return {moveIns: mi, moveOuts: mo, seasonStartMonth, turnMonth};
}
