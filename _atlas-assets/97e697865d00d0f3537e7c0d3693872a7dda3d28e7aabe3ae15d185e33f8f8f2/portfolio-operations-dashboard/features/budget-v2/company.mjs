/* RISE company budget (RISE Residential, LLC — the management company).
 * Pure and deterministic: report import, budget calculation and monthly tracking.
 *
 * Income is management fees by property (41xx), linked to each property's own
 * budget (its management fee, GL 6320), plus other income. Expenses are corporate
 * payroll by position, payroll burden as a share of salaries, bonuses, G&A and
 * overhead allocations (88xx, a share of their section charged out to properties).
 * Sign convention: income positive, expenses positive, allocations negative.
 * No company data lives in this file.
 */
import {positionMonthly, num} from './engine.mjs?v=4b36c2fcc5efc21f';

const zeros = () => Array(12).fill(0);
// Missing evidence stays unknown. Explicit numeric zero is a known amount.
export const amount = value => {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value).trim().replace(/[$,%\s]/g, '');
  if (!text) return null;
  if (/^\(.*\)$/.test(text)) text = '-' + text.slice(1, -1);
  const n = Number(text); return Number.isFinite(n) ? n : null;
};
export const sumAmounts = a => { const values = Array.from(a, amount); return values.some(v => v === null) ? null : values.reduce((t, v) => t + v, 0); };
const sum = sumAmounts;
const r2 = n => amount(n) === null ? null : Math.round(n * 100) / 100;
const add = (a, b) => sum([a, b]);
const subtract = (a, b) => amount(a) === null || amount(b) === null ? null : a - b;
const multiply = (a, b) => amount(a) === null || amount(b) === null ? null : a * b;
const pct4 = (a, b) => amount(a) === null || amount(b) === null ? null : (b ? Math.round(a / b * 1e6) / 1e4 : a === 0 ? 0 : null);
const has = x => x !== null && x !== undefined && x !== '';
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const MONTHS = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
const periodOf = s => { const m = /([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(clean(s)); return m && MONTHS[m[1].toLowerCase()] ? `${m[2]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}` : null; };

export const COMPANY_ENTITY = 'RISE Residential, LLC';
export const FEE_SECTION = 'Management Fee Income';
export const INCOME_SECTIONS = [FEE_SECTION, 'Cost Of Leasing', 'Other Income'];
export const CONTROLLABLE_SECTIONS = ['Payroll Office', 'Payroll Related Expenses', 'General & Administrative', 'Professional Fees', 'Contract Services', 'Repairs & Maintenance', 'Marketing & Leasing', 'Common Area Utilities'];
export const NONCONTROLLABLE_SECTIONS = ['Taxes & Insurance'];
export const EXPENSE_SECTIONS = [...CONTROLLABLE_SECTIONS, ...NONCONTROLLABLE_SECTIONS];
export const ALL_SECTIONS = [...INCOME_SECTIONS, ...EXPENSE_SECTIONS];
export const SUMMARY_GROUPS = [['Payroll', ['Payroll Office', 'Payroll Related Expenses']], ['General & Administrative', ['General & Administrative']], ['Professional Fees', ['Professional Fees']],
  ['Contract Services', ['Contract Services']], ['Repairs & Maintenance', ['Repairs & Maintenance']], ['Marketing', ['Marketing & Leasing']], ['Utilities', ['Common Area Utilities']], ['Taxes & Insurance', ['Taxes & Insurance']]];
const SECTION_ALIASES = {'management fee income': FEE_SECTION, 'other income': 'Other Income', 'cost of leasing': 'Cost Of Leasing', 'payroll office': 'Payroll Office', 'payroll related expenses': 'Payroll Related Expenses',
  'general & administrative': 'General & Administrative', 'professional fees': 'Professional Fees', 'contract services': 'Contract Services', 'repairs & maintenance': 'Repairs & Maintenance',
  'marketing & leasing': 'Marketing & Leasing', 'common area utilities': 'Common Area Utilities', 'taxes & insurance': 'Taxes & Insurance'};
export const normalizeCompanySection = s => SECTION_ALIASES[clean(s).toLowerCase()] || null;
export const isIncomeSection = s => INCOME_SECTIONS.includes(s);
export const isAllocationGl = gl => /^88\d\d$/.test(String(gl));

export const DRIVERS = {fee: 'Property management fee', payroll: 'Payroll positions', pctSalaries: '% of salaries', bonus: 'Bonus % of salaries', allocation: 'Overhead allocation % of section', fixed: 'Annual amount', schedule: 'Monthly schedule'};
const BURDEN_GL = new Set(['6105', '6108', '6110', '6711', '6712', '6713', '6722', '6723', '6724', '6725', '6726', '6730']);

/* ---------------- Entrata "Income Statement - Budget vs Actual" ---------------- */
export function isBudgetVsActual(rows) {
  return rows.slice(0, 3).some(r => /income statement\s*-\s*budget vs actual/i.test(clean(r?.[0])));
}
export function parseBudgetVsActual(rows) {
  const warnings = [];
  const head = rows.findIndex(r => clean(r?.[0]) === 'Account' && /account name/i.test(clean(r?.[1])));
  if (head < 0) return {ok: false, kind: 'budget_vs_actual', warnings: ['Header row "Account / Account Name" not found.']};
  const hdr = rows[head].map(clean), top = rows[head - 1] || [];
  const actualCols = hdr.map((h, i) => (h === 'Actual' ? i : -1)).filter(i => i >= 0), budgetCols = hdr.map((h, i) => (h === 'Budget' ? i : -1)).filter(i => i >= 0);
  const annualCol = hdr.findIndex(h => /^annual budget$/i.test(h)), commentCol = hdr.findIndex(h => /variance (comment|explanation)|comment/i.test(h));
  const entity = clean(rows.slice(0, head).map(r => r?.[0]).filter(Boolean)[1]) || null;
  const period = periodOf(top[actualCols[0]]) || rows.slice(0, head).map(r => periodOf(r?.[0])).find(Boolean) || null;
  const ytd = /YTD\s*\(\s*([A-Za-z]{3}\s+\d{4})\s*-\s*([A-Za-z]{3}\s+\d{4})\s*\)/i.exec(clean(top[actualCols[1]] ?? top.join(' ')));
  if (!period) warnings.push('The report month was not found.');
  if (actualCols.length < 2 || budgetCols.length < 2) warnings.push('Month and year-to-date Actual/Budget columns were not both found.');
  const n = amount;
  const lines = [];
  let section = '';
  for (const r of rows.slice(head + 1)) {
    const a = clean(r?.[0]), b = clean(r?.[1]);
    if (/^\d{4}$/.test(a) && b) {
      lines.push({gl: a, name: b, section: normalizeCompanySection(section) || section || 'General & Administrative',
        actual: n(r[actualCols[0]]), budget: n(r[budgetCols[0]]), ytdActual: n(r[actualCols[1]]), ytdBudget: n(r[budgetCols[1]]), annualBudget: annualCol >= 0 ? n(r[annualCol]) : null,
        comment: commentCol >= 0 && clean(r[commentCol]) ? clean(r[commentCol]) : null});
    } else if (a && !b && r.slice(2).every(v => !has(v))) section = a;
  }
  const unknown = [...new Set(lines.filter(l => !ALL_SECTIONS.includes(l.section)).map(l => l.section))];
  if (unknown.length) warnings.push(`Sections not in the company layout: ${unknown.join(', ')}.`);
  const ytdFrom = ytd ? periodOf(ytd[1]) : null, ytdTo = ytd ? periodOf(ytd[2]) : period;
  const monthsYtd = ytdFrom && ytdTo ? (Number(ytdTo.slice(0, 4)) - Number(ytdFrom.slice(0, 4))) * 12 + Number(ytdTo.slice(5)) - Number(ytdFrom.slice(5)) + 1 : null;
  return {ok: lines.length > 0 && !!period, kind: 'budget_vs_actual', entity, period, ytdFrom, ytdTo, monthsYtd, lines, warnings};
}

/* ---------------- Building a company budget from evidence ---------------- */
export function fiscalPeriods(year, startMonth = 1) {
  return Array.from({length: 12}, (_, i) => { const m0 = (startMonth - 1 + i) % 12, y = Number(year) - (startMonth > 1 ? 1 : 0) + Math.floor((startMonth - 1 + i) / 12); return `${y}-${String(m0 + 1).padStart(2, '0')}`; });
}
const feeName = name => clean(String(name).replace(/^mgmt\.?\s*fee\s*-\s*/i, ''));

/**
 * reports: Budget vs Actual reports (any months of the prior year; the latest is used
 * for the annual budget and year-to-date run rate). start: 'prior' | 'runrate'.
 */
export function buildCompanyModel({fiscalYear, startMonth = 1, reports = [], start = 'prior', inflation = 3}) {
  const periods = fiscalPeriods(fiscalYear, startMonth);
  const ok = reports.filter(r => r?.ok).sort((a, b) => String(a.period).localeCompare(String(b.period)));
  const latest = ok.at(-1);
  const byGl = new Map();
  for (const rep of ok) for (const l of rep.lines) {
    const e = byGl.get(l.gl) || {gl: l.gl, name: l.name, section: l.section, monthBudget: {}, monthActual: {}};
    e.name = l.name; e.section = l.section; e.monthBudget[rep.period] = l.budget; e.monthActual[rep.period] = l.actual;
    if (rep === latest) Object.assign(e, {annualBudget: l.annualBudget, ytdActual: l.ytdActual, ytdBudget: l.ytdBudget});
    byGl.set(l.gl, e);
  }
  const months = latest?.monthsYtd || 0;
  const runRate = e => (months ? multiply(amount(e.ytdActual), 12 / months) : null);
  const priorAnnual = e => amount(e.annualBudget);
  const basisAnnual = e => (start === 'runrate' && months ? runRate(e) : priorAnnual(e));
  const all = [...byGl.values()].filter(e => latest ? latest.lines.some(l => l.gl === e.gl) : true);
  const salaryBase = sum(all.filter(e => e.gl === '6100').map(basisAnnual));
  const lines = [], fees = [], positions = [];
  for (const e of all) {
    const line = {gl: e.gl, name: e.name, section: e.section, prior: {annual: priorAnnual(e), ytdActual: amount(e.ytdActual), ytdBudget: amount(e.ytdBudget), months, runRate: r2(runRate(e)), monthBudget: e.monthBudget}, note: ''};
    const annual = basisAnnual(e);
    if (e.section === FEE_SECTION) {
      line.driver = 'fee';
      fees.push({gl: e.gl, name: feeName(e.name), communityId: null, mode: 'flat', flatMonthly: r2(multiply(annual, 1 / 12)), sharePct: 100, minMonthly: null, schedule: null, startMonth: 0, endMonth: null, source: null});
    } else if (e.gl === '6100') {
      line.driver = 'payroll';
      if (annual !== 0) positions.push({id: `p${positions.length + 1}`, title: 'Corporate salaries (from prior budget — split into positions)', department: '', gl: '6100', count: 1, salary: r2(annual), raisePct: 0, raiseMonth: null, startMonth: null, endMonth: null, confirmed: false});
    } else if (e.gl === '6099') {
      Object.assign(line, {driver: 'bonus', pct: pct4(annual, salaryBase), months: [2, 5, 8, 11]});
    } else if (BURDEN_GL.has(e.gl)) {
      Object.assign(line, {driver: 'pctSalaries', pct: pct4(annual, salaryBase)});
    } else if (isAllocationGl(e.gl)) {
      const base = sum(all.filter(x => x.section === e.section && !isAllocationGl(x.gl)).map(basisAnnual));
      Object.assign(line, {driver: 'allocation', base: e.section, pct: pct4(multiply(annual, -1), base)});
    } else {
      Object.assign(line, {driver: 'fixed', annual: r2(annual), growthPct: isIncomeSection(e.section) ? 0 : num(inflation), shape: shapeOf(e, periods, ok)});
    }
    lines.push(line);
  }
  return {version: 1, kind: 'company', entity: latest?.entity || COMPANY_ENTITY, fiscalYear: Number(fiscalYear), startMonth, periods, start,
    lines, fees, positions, overrides: {}, notes: {}, closedMonths: 0, actuals: null,
    sources: ok.map(r => ({kind: r.kind, period: r.period, lines: r.lines.length})), assumptions: {inflation: num(inflation)}};
}
/* Monthly shape from the prior year's monthly budget where every month is known; otherwise even. */
function shapeOf(e, periods, reports) {
  const vals = periods.map(p => { const prior = `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`; return e.monthBudget[prior]; });
  if (reports.length < 12 || vals.some(v => !has(v)) || !sum(vals)) return null;
  return vals.map(v => r2(v / sum(vals) * 12 * 1000) / 1000);
}

/* ---------------- Calculation ---------------- */
export function feeMonthly(fee, m) {
  const start = has(fee.startMonth) ? num(fee.startMonth) : 0, end = has(fee.endMonth) ? num(fee.endMonth) : 11;
  if (m < start || m > end) return 0;
  if (fee.mode === 'schedule') return amount(fee.schedule?.[m]);
  if (fee.mode === 'linked' && fee.source?.monthly?.length === 12) {
    const value = multiply(amount(fee.source.monthly[m]), num(fee.sharePct ?? 100) / 100);
    return value === null ? null : Math.max(value, has(fee.minMonthly) ? num(fee.minMonthly) : -Infinity);
  }
  return amount(fee.flatMonthly);
}

export function calculateCompany(model) {
  const lines = (model.lines || []).filter(l => !l.removed);
  const rows = {};
  const positionAmounts = p => amount(p.salary) === null ? Array(12).fill(null) : positionMonthly(p);
  const salaries = zeros();
  for (const p of model.positions || []) if (String(p.gl || '6100') === '6100') positionAmounts(p).forEach((v, m) => { salaries[m] = add(salaries[m], v); });
  const salTotal = sum(salaries);
  const put = (line, monthly, extra = {}) => {
    const ov = model.overrides?.[line.gl];
    let overridden = false;
    if (has(ov)) {
      overridden = true;
      if (Array.isArray(ov)) ov.forEach((v, m) => { if (has(v)) monthly[m] = num(v); });
      else { const t = sum(monthly), a = amount(ov); monthly = t ? monthly.map(v => v * a / t) : Array(12).fill(multiply(a, 1 / 12)); }
    }
    const closed = Math.max(0, Math.min(12, num(model.closedMonths))), actual = model.actuals?.[line.gl];
    const locked = zeros().map((_, m) => m < closed);
    if (closed) for (let m = 0; m < closed; m++) monthly[m] = amount(actual?.[m]);
    rows[line.gl] = {line, driver: line.driver, monthly: monthly.map(r2), annual: r2(sum(monthly)), prior: amount(line.prior?.annual), runRate: amount(line.prior?.runRate), overridden, locked, ...extra};
  };
  const pending = [];
  for (const line of lines) {
    const d = line.driver || 'fixed';
    if (d === 'allocation') { pending.push(line); continue; }
    let monthly = zeros(), extra = {};
    if (d === 'fee') {
      const fs = (model.fees || []).filter(f => String(f.gl) === String(line.gl));
      monthly = zeros().map((_, m) => sum(fs.map(f => feeMonthly(f, m))));
      extra = {fees: fs};
    } else if (d === 'payroll') {
      (model.positions || []).filter(p => String(p.gl || '6100') === String(line.gl)).forEach(p => positionAmounts(p).forEach((v, m) => { monthly[m] = add(monthly[m], v); }));
    } else if (d === 'pctSalaries') monthly = salaries.map(v => multiply(v, multiply(amount(line.pct), 1 / 100)));
    else if (d === 'bonus') { const ms = (line.months?.length ? line.months : [11]).map(num); monthly = zeros().map((_, m) => (ms.includes(m) ? multiply(salTotal, multiply(amount(line.pct), 1 / 100 / ms.length)) : 0)); }
    else if (d === 'schedule') monthly = zeros().map((_, m) => amount(line.monthly?.[m]));
    else { const a = multiply(amount(line.annual), 1 + num(line.growthPct) / 100), sh = line.shape?.length === 12 ? line.shape.map(num) : Array(12).fill(1), t = sum(sh) || 12; monthly = sh.map(v => multiply(a, v / t)); }
    put(line, monthly, extra);
  }
  for (const line of pending) {
    const base = zeros();
    Object.values(rows).filter(r => r.line.section === (line.base || line.section) && !isAllocationGl(r.line.gl)).forEach(r => r.monthly.forEach((v, m) => { base[m] = add(base[m], v); }));
    put(line, base.map(v => multiply(v, multiply(amount(line.pct), -1 / 100))), {baseAnnual: r2(sum(base))});
  }
  return summarizeCompany(model, rows, salaries);
}

function summarizeCompany(model, rows, salaries) {
  const sections = {};
  for (const r of Object.values(rows)) {
    const s = sections[r.line.section] ||= {section: r.line.section, monthly: zeros(), annual: 0, prior: 0, runRate: 0, lines: []};
    r.monthly.forEach((v, m) => { s.monthly[m] = add(s.monthly[m], v); }); s.annual = add(s.annual, r.annual); s.prior = add(s.prior, r.prior); s.runRate = add(s.runRate, r.runRate); s.lines.push(r);
  }
  const tot = (secs, k) => sum(secs.map(x => sections[x] ? sections[x][k] : 0));
  const totM = secs => { const o = zeros(); secs.forEach(x => (sections[x]?.monthly || []).forEach((v, m) => { o[m] = add(o[m], v); })); return o.map(r2); };
  const other = Object.keys(sections).filter(x => !ALL_SECTIONS.includes(x));
  const k = key => { const income = tot(INCOME_SECTIONS, key), controllable = tot([...CONTROLLABLE_SECTIONS, ...other], key), taxes = tot(NONCONTROLLABLE_SECTIONS, key);
    return {income: r2(income), controllable: r2(controllable), controllableCashFlow: r2(subtract(income, controllable)), taxesInsurance: r2(taxes), expenses: r2(add(controllable, taxes)), noi: r2(subtract(subtract(income, controllable), taxes))}; };
  const incomeM = totM(INCOME_SECTIONS), expM = totM([...EXPENSE_SECTIONS, ...other]);
  return {rows, sections, salaries: salaries.map(r2), totals: {annual: k('annual'), prior: k('prior'), runRate: k('runRate')},
    monthly: {income: incomeM, expenses: expM, noi: incomeM.map((v, m) => r2(subtract(v, expM[m])))},
    groups: SUMMARY_GROUPS.map(([name, secs]) => ({name, final: r2(tot(secs, 'annual')), prior: r2(tot(secs, 'prior'))})),
    fees: (model.fees || []).map(f => ({...f, monthly: zeros().map((_, m) => r2(feeMonthly(f, m))), annual: r2(sum(zeros().map((_, m) => feeMonthly(f, m))))}))};
}

/* Lines needing a note: annual budget vs prior budget beyond both thresholds. */
export function companyNoteFlags(result, notes = {}, {dollars = 1000, pct = 10} = {}) {
  return Object.values(result.rows).filter(r => { if (r.annual === null || r.prior === null) return false; const d = r.annual - r.prior, p = r.prior ? Math.abs(d / r.prior) * 100 : (d ? Infinity : 0); return Math.abs(d) > dollars && p > pct && !clean(notes[r.line.gl] ?? r.line.note); }).map(r => r.line.gl);
}

/* Refresh linked fees from property budgets ({communityId: {kind, ref, byPeriod}}).
 * Months the property budget does not cover use the average of the months it does. */
export function refreshFees(model, sources) {
  const changes = [];
  for (const f of model.fees || []) {
    if (f.mode !== 'linked' || !f.communityId) continue;
    const src = sources[f.communityId];
    if (!src) continue;
    const vals = model.periods.map(p => (amount(src.byPeriod[p]))), have = vals.filter(v => v !== null);
    if (!have.length) continue;
    const avg = sum(have) / have.length, monthly = vals.map(v => r2(v === null ? avg : v));
    const before = r2(sum(zeros().map((_, m) => feeMonthly(f, m))));
    const next = {kind: src.kind, ref: src.ref || null, status: src.status || null, monthly, estimatedMonths: vals.filter(v => v === null).length};
    if (JSON.stringify({...f.source, fetchedAt: undefined}) === JSON.stringify({...next, fetchedAt: undefined})) continue;
    f.source = {...next, fetchedAt: new Date().toISOString()};
    changes.push({gl: f.gl, name: f.name, before, after: r2(sum(zeros().map((_, m) => feeMonthly(f, m)))), kind: src.kind});
  }
  return changes;
}
/* Suggest the community for a fee line by name. */
export function suggestCommunity(fee, communities) {
  const norm = s => String(s).toLowerCase().replace(/\brise\b|\(.*?\)|[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const name = norm(fee.name);
  if (!name) return null;
  const hit = communities.find(c => norm(c.name) === name) || communities.find(c => { const n = norm(c.name); return n && (n.includes(name) || name.includes(n)); });
  return hit?.id || null;
}

/* ---------------- Monthly tracking ---------------- */
/**
 * budget: {gl: monthly[12]} from the approved company budget (or the working budget).
 * months: [{period, actuals: {gl: n}, entrataBudget: {gl: n}, comments: {gl: text}, names: {gl}, sections: {gl}}].
 */
export function trackCompany({periods, budget, lines = [], months = [], period, dollars = 1000, pct = 10, reportYtdBudget = false}) {
  const idx = periods.indexOf(period);
  if (idx < 0) throw Error('Choose a month in this fiscal year.');
  const byPeriod = Object.fromEntries(months.map(m => [m.period, m]));
  const info = Object.fromEntries(lines.filter(l => !l.removed).map(l => [String(l.gl), l]));
  for (const m of months) for (const gl of Object.keys({...m.actuals, ...m.entrataBudget, ...m.ytdActual, ...m.ytdBudget, ...m.annualBudget})) info[gl] ||= {gl, name: m.names?.[gl] || gl, section: m.sections?.[gl] || 'General & Administrative'};
  for (const gl of Object.keys(budget)) info[gl] ||= {gl, name: gl, section: 'General & Administrative'};
  const cur = byPeriod[period] || {};
  // A report subtotal can fill missing monthly evidence only for this entire YTD interval.
  const fullYtd = cur.ytdFrom === periods[0] && cur.ytdTo === period && Number(cur.monthsYtd) === idx + 1;
  const rows = Object.values(info).map(l => {
    const gl = String(l.gl), b = Array.from({length: 12}, (_, i) => amount(budget[gl]?.[i])), income = isIncomeSection(l.section);
    const actuals = periods.slice(0, idx + 1).map(p => amount(byPeriod[p]?.actuals?.[gl]));
    const missingActualPeriods = periods.slice(0, idx + 1).filter((_, i) => actuals[i] === null);
    const monthActual = actuals[idx], monthBudget = reportYtdBudget ? amount(cur.entrataBudget?.[gl]) : b[idx];
    const reportedActual = fullYtd ? amount(cur.ytdActual?.[gl]) : null;
    const ytdFromReport = missingActualPeriods.length > 0 && reportedActual !== null;
    const ytdActual = ytdFromReport ? reportedActual : sum(actuals);
    const reportedBudget = fullYtd ? amount(cur.ytdBudget?.[gl]) : null;
    const ytdBudget = reportYtdBudget ? (reportedBudget !== null ? reportedBudget : sum(periods.slice(0, idx + 1).map(p => amount(byPeriod[p]?.entrataBudget?.[gl])))) : sum(b.slice(0, idx + 1));
    const annualBudget = sum(b);
    const remaining = reportYtdBudget && reportedBudget !== null ? subtract(annualBudget, reportedBudget) : sum(b.slice(idx + 1));
    const forecast = add(ytdActual, remaining);
    const fav = (a, bud) => income ? subtract(a, bud) : subtract(bud, a);
    const v = fav(monthActual, monthBudget), vy = fav(ytdActual, ytdBudget);
    const over = (d, base) => d !== null && base !== null && Math.abs(d) > dollars && (base ? Math.abs(d / base) * 100 > pct : Math.abs(d) > 0);
    const comment = clean(cur.comments?.[gl]), entrata = amount(cur.entrataBudget?.[gl]);
    return {gl, name: l.name, section: l.section, income, monthActual: r2(monthActual), monthBudget: r2(monthBudget), monthVar: r2(v), monthVarPct: v !== null && monthBudget ? v / Math.abs(monthBudget) : null,
      ytdActual: r2(ytdActual), ytdBudget: r2(ytdBudget), ytdVar: r2(vy), ytdVarPct: vy !== null && ytdBudget ? vy / Math.abs(ytdBudget) : null, annualBudget: r2(annualBudget), forecast: r2(forecast), forecastVar: r2(fav(forecast, annualBudget)),
      missingActualPeriods, ytdFromReport, missingReviewEvidence: [monthActual, monthBudget, ytdActual, ytdBudget].some(v => v === null), missingEvidence: [monthActual, monthBudget, ytdActual, ytdBudget, annualBudget, forecast].some(v => v === null),
      comment, needsComment: (over(v, monthBudget) || over(vy, ytdBudget)) && !comment, entrataBudget: r2(entrata),
      entrataMismatch: entrata !== null && monthBudget !== null && Math.abs(entrata - monthBudget) > 1};
  });
  const T = sel => { const a = rows.filter(sel); const s = k => r2(sum(a.map(r => r[k]))); return {monthActual: s('monthActual'), monthBudget: s('monthBudget'), ytdActual: s('ytdActual'), ytdBudget: s('ytdBudget'), annualBudget: s('annualBudget'), forecast: s('forecast')}; };
  const inc = T(r => r.income), exp = T(r => !r.income);
  const noi = Object.fromEntries(Object.keys(inc).map(k => [k, r2(subtract(inc[k], exp[k]))]));
  const missing = periods.slice(0, idx + 1).filter(p => !byPeriod[p]);
  return {period, index: idx, rows, totals: {income: inc, expenses: exp, noi}, missingMonths: missing, ytdFromReport: rows.some(r => r.ytdFromReport),
    missingEvidence: rows.filter(r => r.missingEvidence).length, missingReviewEvidence: rows.filter(r => r.missingReviewEvidence).length, needComments: rows.filter(r => r.needsComment).length, mismatches: rows.filter(r => r.entrataMismatch).length};
}

/* Budget by month from Entrata reports, for a year with no ATLAS company budget:
 * months with a report use that month's budget; the rest of the annual budget is spread evenly. */
export function budgetFromReports(periods, months) {
  const latest = [...months].sort((a, b) => a.period.localeCompare(b.period)).at(-1);
  const out = {};
  const gls = new Set(months.flatMap(m => Object.keys(m.entrataBudget || {})));
  for (const gl of gls) {
    const known = periods.map(p => { const m = months.find(x => x.period === p); return m && has(m.entrataBudget?.[gl]) ? num(m.entrataBudget[gl]) : null; });
    const annual = amount(latest?.annualBudget?.[gl]);
    const rest = known.filter(v => v === null).length, left = subtract(annual, sum(known.filter(has)));
    out[gl] = known.map(v => r2(v === null ? (rest ? multiply(left, 1 / rest) : null) : v));
  }
  return out;
}

/* A month record from a parsed Budget vs Actual report. */
export function monthFromReport(rep) {
  const o = {period: rep.period, ytdFrom: rep.ytdFrom ?? null, ytdTo: rep.ytdTo ?? null, monthsYtd: rep.monthsYtd ?? null, actuals: {}, entrataBudget: {}, annualBudget: {}, ytdActual: {}, ytdBudget: {}, comments: {}, names: {}, sections: {}};
  for (const l of rep.lines) { o.actuals[l.gl] = r2(l.actual); o.ytdActual[l.gl] = r2(l.ytdActual); o.ytdBudget[l.gl] = r2(l.ytdBudget); o.entrataBudget[l.gl] = r2(l.budget); if (has(l.annualBudget)) o.annualBudget[l.gl] = r2(l.annualBudget); if (l.comment) o.comments[l.gl] = l.comment; o.names[l.gl] = l.name; o.sections[l.gl] = l.section; }
  return o;
}

/* Persist exactly what the executive sees; nulls remain unknown after JSON reload. */
export function companyLockedSummary(model, result = calculateCompany(model)) {
  return {entity: model.entity, fiscalYear: model.fiscalYear, periods: model.periods, totals: result.totals.annual, prior: result.totals.prior, groups: result.groups, monthly: result.monthly,
    budgetByGl: Object.fromEntries(Object.entries(result.rows).map(([gl, x]) => [gl, x.monthly])),
    lines: Object.values(result.rows).map(x => ({gl: x.line.gl, name: x.line.name, section: x.line.section})),
    fees: result.fees.map(f => ({gl: f.gl, name: f.name, mode: f.mode, source: f.source?.kind || null, annual: f.annual}))};
}
