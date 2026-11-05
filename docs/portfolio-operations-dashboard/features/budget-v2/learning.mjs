/* Budget Builder v2 — learning model.
 * Learns from uploaded evidence (T12s, box scores, trending occupancy, Conservice,
 * prior budgets, contracts) and from reviewer decisions. Everything it suggests
 * carries its source and a confidence, and is only a suggestion until a person accepts it. */
import {sectionForGl, freezeBase, num, ASSET_CLASSES, SUMMARY_GROUPS, INCOME_SECTIONS} from './engine.mjs?v=d1645594fb2c6c47';
import {t12Basis, conserviceRates} from './importers.mjs?v=1e9da8467ffd2fe2';

const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* Share of the year's move-ins / move-outs by calendar month (1–12), from Trending Occupancy history. */
export function seasonality(trending) {
  const hist = (trending?.months || []).filter(m => m.moveIns || m.moveOuts);
  const mi = Array(12).fill(0), mo = Array(12).fill(0);
  for (const m of hist) { const k = Number(m.period.slice(5)) - 1; mi[k] += m.moveIns; mo[k] += m.moveOuts; }
  const ti = mi.reduce((t, v) => t + v, 0), to = mo.reduce((t, v) => t + v, 0);
  return {moveIns: mi.map(v => (ti ? v / ti : 1 / 12)), moveOuts: mo.map(v => (to ? v / to : 1 / 12)), months: hist.length,
    annualMoveIns: hist.length ? ti * 12 / hist.length : 0, annualMoveOuts: hist.length ? to * 12 / hist.length : 0};
}

/* Suggested leasing schedule for a fiscal year: move-outs follow learned seasonality and
 * turnover; move-ins are solved month by month to reach the target occupancy. */
export function suggestSchedule({periods, beginOccupied, units, season, targetOccPct = 95, annualMoveOuts}) {
  const moveOuts = periods.map(p => Math.round(season.moveOuts[Number(p.slice(5)) - 1] * (annualMoveOuts ?? season.annualMoveOuts)));
  const target = Math.round(num(units) * num(targetOccPct) / 100);
  const moveIns = [];
  let occ = num(beginOccupied);
  periods.forEach((p, i) => {
    const left = periods.length - i;
    const gap = target - occ;
    const mi = Math.max(0, moveOuts[i] + Math.sign(gap) * Math.ceil(Math.abs(gap) / left));
    moveIns.push(mi);
    occ = Math.min(num(units), occ + mi - moveOuts[i]);
  });
  return {moveIns, moveOuts, targetOccPct, source: `Trending Occupancy seasonality (${season.months} months) solved to ${targetOccPct}% occupancy`};
}

/* Default positions inferred from payroll GLs (headcount must be confirmed by the user). */
export function seedPositions(lines, {fromProposal = false} = {}) {
  const titles = {'6330': 'General Manager', '6332': 'Assistant General Manager', '6335': 'Leasing Professional', '6511': 'Maintenance Supervisor', '6510': 'Maintenance Technician', '6512': 'Porter / Housekeeping'};
  return Object.entries(titles).map(([gl, title]) => {
    const l = lines.find(x => String(x.gl) === gl);
    const amount = num(fromProposal ? l?.proposal?.total : (l?.proposal?.total ?? l?.t12?.total));
    const count = ['6335', '6510'].includes(gl) && amount > 70000 ? 2 : (amount ? 1 : 0);
    return {id: `seed-${gl}`, title, gl, count, salary: count ? Math.round(amount / count) : 0, raisePct: 0, raiseMonth: null, confirmed: false};
  });
}

/* Build an editable model from whatever sources are available for one property. */
export function buildModel({property, fiscalYear, startMonth = 1, periods, proposal, t12, box, trending, conservice, chart = {}, start}) {
  const units = num(property.units || box?.units || trending?.units);
  const map = new Map();
  const add = (gl, patch) => { const k = String(gl); map.set(k, {...(map.get(k) || {gl: k, name: '', section: sectionForGl(k), note: '', items: []}), ...patch}); };
  // A T12 export covering fewer than 12 months is annualized (and flagged) so run-rates stay comparable.
  const t12Months = (t12?.periods || []).length, annualize = t12Months > 0 && t12Months < 12 ? 12 / t12Months : 1;
  for (const l of t12?.lines || []) {
    const per = t12.periods || [];
    add(l.gl, {name: l.name, section: l.section, t12: {total: l.total * annualize, monthly: annualize === 1 ? monthlyByCalendar(l.byPeriod, per, periods) : null, months: t12Months}});
  }
  for (const l of proposal?.lines || []) add(l.gl, {name: map.get(String(l.gl))?.name || l.name || chart[l.gl] || '', section: map.get(String(l.gl))?.section || l.section, proposal: {total: l.total, monthly: l.monthly}, items: l.items || [], note: l.note || ''});
  const lines = [...map.values()].filter(l => l.section !== 'Non-Operating' && (num(l.t12?.total) || num(l.proposal?.total) || l.items?.length));
  const season = trending ? seasonality(trending) : null;
  const begin = beginOccupiedFor(trending, box, periods);
  const tb = trending && t12 ? t12Basis(t12, trending, units) : null;
  const basis = tb ? {...tb, rent: (num(lines.find(l => l.gl === '5120')?.t12?.total) / (units * 12)) || null} : null;
  if (basis) basis.salaries = lines.filter(l => ['6330', '6332', '6335', '6510', '6511', '6512'].includes(l.gl)).reduce((t, l) => t + num(l.t12?.total), 0);
  const rates = conservice ? conserviceRates(conservice, property.name) : null;
  const gpr = num(lines.find(l => l.gl === '5120')?.proposal?.total);
  const pct = gl => { const v = num(lines.find(l => l.gl === gl)?.proposal?.total); return gpr ? Math.abs(v) / gpr * 100 : 0; };
  const t12gpr = num(lines.find(l => l.gl === '5120')?.t12?.total);
  const t12pct = gl => { const v = num(lines.find(l => l.gl === gl)?.t12?.total); return t12gpr ? Math.abs(v) / t12gpr * 100 : null; };
  const income = lines.filter(l => INCOME_SECTIONS.includes(l.section)).reduce((t, l) => t + num(l.proposal?.total ?? 0), 0);
  const mgmt = income ? num(lines.find(l => l.gl === '6320')?.proposal?.total) / income * 100 : 3;
  const assumptions = {
    marketRent: gpr ? gpr / (units * 12) : num(box?.marketRent), rentGrowth: 0,
    ltlPct: gpr ? pct('5125') : num(box?.lossToLeasePct), concessionPct: gpr ? pct('5250') : num(t12pct('5250')), badDebtPct: gpr ? pct('5255') : num(t12pct('5255')),
    mgmtPct: Math.round(mgmt * 100) / 100, inflation: 3, taxChange: 0, insChange: 0,
    electric: rates?.electric?.steady ?? 0, water: rates?.water?.steady ?? 0, sewer: rates?.sewer?.steady ?? 0, sewerShare: 55,
    reservePerUnit: units ? Math.round(num(lines.find(l => l.gl === '1320')?.proposal?.total) / units * 100) / 100 || 250 : 250,
    modelLtlPct: box ? box.lossToLeasePct : null, modelConcessionPct: t12pct('5250'), modelBadDebtPct: t12pct('5255'), modelMgmtPct: null
  };
  const schedule = season ? {beginOccupied: begin, ...suggestSchedule({periods, beginOccupied: begin, units, season, targetOccPct: 95})} : {beginOccupied: begin, moveIns: Array(12).fill(0), moveOuts: Array(12).fill(0)};
  const model = {version: 1, property: {...property, units}, fiscalYear, startMonth, periods, start: start || (proposal ? 'proposal' : 'model'), lines, schedule, assumptions,
    positions: seedPositions(lines, {fromProposal: !!proposal}), basis, overrides: {}, notes: {}, investorNotes: {}, closedMonths: 0, actuals: null,
    floorPlans: (box?.floorPlans || []).map(f => ({type: f.type, units: f.units, marketRent: f.marketRent})),
    sources: {proposal: proposal ? {entity: proposal.entity, lines: proposal.lines.length} : null, t12: t12 ? {periods: t12.periods, annualizedFromMonths: annualize === 1 ? null : t12Months} : null, box: box ? {asOf: box.asOf} : null,
      trending: trending ? {months: trending.months.length} : null, conservice: rates}, learned: {}};
  model.base = freezeBase(model);
  return model;
}

function monthlyByCalendar(byPeriod, t12Periods, periods) {
  if (!byPeriod || t12Periods.length !== 12) return null;
  return periods.map(p => num(byPeriod[t12Periods.find(x => x.slice(5) === p.slice(5))]));
}

function beginOccupiedFor(trending, box, periods) {
  if (!periods?.length) return num(box?.occupied);
  const first = periods[0];
  const m = trending?.months?.find(x => x.period === first);
  if (m) return m.beginOccupied;
  return num(box?.occupied);
}

/* Portfolio benchmarks: median cost per unit by summary group across communities. */
export function portfolioBenchmarks(observations) {
  const byGroup = {};
  for (const o of observations || []) if (o.metric === 'per_unit' && o.basis?.group) (byGroup[o.basis.group] ||= []).push(num(o.value));
  return Object.fromEntries(SUMMARY_GROUPS.map(([g]) => [g, byGroup[g]?.length ? {median: median(byGroup[g]), n: byGroup[g].length} : null]));
}

/* Observations to store after an import or approval (feeds portfolio benchmarks). */
export function observationsFromResult(result, {communityId, sourceKind, periodFrom, periodTo, assetClass}) {
  const units = result.context.units || 1;
  return result.groups.map(g => ({community_id: communityId, source_kind: sourceKind, gl_code: null, metric: 'per_unit', value: Math.round(g.final / units * 100) / 100,
    basis: {group: g.name, assetClass, units}, period_from: periodFrom, period_to: periodTo}));
}

/* Reviewer decisions → per-GL calibration of the model (median final ÷ model across ≥3 decisions). */
export function calibrate(decisions) {
  const by = {};
  for (const d of decisions || []) if (num(d.model) && Number.isFinite(num(d.final))) (by[d.gl] ||= []).push(num(d.final) / num(d.model));
  return Object.fromEntries(Object.entries(by).filter(([, v]) => v.length >= 3).map(([gl, v]) => [gl, {calibration: median(v), n: v.length}]));
}

/* Model checks shown to reviewers. Each has an id, the GL, a message and a severity. */
export function modelChecks(model, result) {
  const out = [];
  const a = model.assumptions || {};
  const ws = model.lines.find(l => l.gl === '6463');
  if (ws && /17\.1%|\+ ?4\.5%|sewer \+ /i.test((ws.note || '') + JSON.stringify(ws.items || [])) && num(a.water) && num(a.sewer))
    out.push({id: 'ws-sum', gl: '6463', severity: 'warn', message: `Water and sewer increases appear added together. Applied to their share of the bill they blend to about ${(num(a.sewer) * num(a.sewerShare) / 100 + num(a.water) * (1 - num(a.sewerShare) / 100)).toFixed(1)}%.`});
  const info = [];
  for (const r of Object.values(result.rows)) {
    const t12 = r.t12, f = r.annual - (r.strAnnual || 0);
    if (['6330', '6332', '6335', '6510', '6511', '6512'].includes(String(r.line.gl)) && t12 > 20000 && f === 0)
      out.push({id: 'pos-' + r.line.gl, gl: r.line.gl, severity: 'warn', message: `${r.line.name}: T12 ${Math.round(t12).toLocaleString()} but no budget — confirm the position is eliminated.`});
    if (r.modelAnnual !== null && Math.abs(f - r.modelAnnual) > Math.max(5000, Math.abs(r.modelAnnual) * 0.15) && Math.abs(f - t12) > 5000)
      info.push({size: Math.abs(f - r.modelAnnual), id: 'model-' + r.line.gl, gl: r.line.gl, severity: 'info', message: `${r.line.name}: budget differs from the model by ${Math.round(Math.abs(f - r.modelAnnual)).toLocaleString()} and from T12 by ${Math.round(Math.abs(f - t12)).toLocaleString()}.`});
  }
  if (model.sources?.t12?.annualizedFromMonths) out.unshift({id: 't12-partial', gl: null, severity: 'warn', message: `The T12 upload covers ${model.sources.t12.annualizedFromMonths} month(s); T12 amounts are annualized. Upload a full 12-month T12 for accurate run-rates.`});
  for (const c of result.str?.checks || []) out.push({id: 'str-' + out.length, gl: null, severity: c.severity, message: 'STR programme: ' + c.message});
  return out.concat(info.sort((a, b) => b.size - a.size).slice(0, 12).map(({size, ...x}) => x));
}

export function unitLabel(model) { return ASSET_CLASSES[model.property?.assetClass]?.unitLabel || 'unit'; }
