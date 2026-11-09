/* Budget Builder v2 — short-term rental (STR) programme.
 * Pure and deterministic. Calculates an STR programme floor plan by floor plan,
 * month by month over the budget's fiscal periods, using the same driver logic as
 * the classic STR Builder (channel mix, collectable ancillary fees, lodging tax
 * base, per-stay / per-night / per-unit costs, furnishing at conversion).
 *
 * Integration with the property budget (engine.calculate):
 *  - STR units leave the long-term pool, so long-term occupancy, move-ins and
 *    move-outs scale to the remaining units (fees, utilities and turnover follow).
 *  - Converted units' long-term rent is posted as contra income (conversion GL).
 *  - STR income, deductions, expenses and furnishing capital post to their GLs.
 * Percentages are fractions (0.13 = 13%). No property data lives in this file.
 */

const zeros = () => Array(12).fill(0);
const sum = a => a.reduce((t, v) => t + (Number(v) || 0), 0);
const num = x => { const n = typeof x === 'number' ? x : parseFloat(String(x ?? '').replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const has = x => x !== null && x !== undefined && x !== '';
const r2 = n => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const STR_INCOME_SECTION = 'Short-Term Rental Income';
export const STR_EXPENSE_SECTION = 'Short-Term Rental Expenses';

/* Seasonality by calendar month (Jan…Dec). */
export const STR_CURVES = {
  flat: {label: 'Flat / even', v: Array(12).fill(1)},
  str_jax: {label: 'Leisure / event (North Florida)', v: [0.86, 0.94, 1.14, 1.12, 1.04, 0.96, 0.94, 0.90, 0.94, 1.06, 1.02, 1.08]},
  str_coastal: {label: 'Coastal / resort season', v: [0.72, 0.78, 0.98, 1.12, 1.24, 1.34, 1.42, 1.38, 1.06, 0.86, 0.74, 0.76]},
  str_corporate: {label: 'Corporate / extended stay', v: [0.98, 1.02, 1.06, 1.06, 1.04, 1.00, 0.92, 0.94, 1.02, 1.04, 0.98, 0.94]}
};
const normCurve = v => { const a = sum(v) / 12 || 1; return v.map(x => num(x) / a); };

export const STR_DEFAULTS = {
  adr: 185, occupancy: 0.68, alos: 3.4, blockedPct: 0.06, permitNights: 365,
  discountPct: 0.035, refundPct: 0.011, ccFeePct: 0.029, lodgingTax: 0.13, mgmtFeePct: 0.18,
  cleanCostPerStay: 115, cleanFeePerStay: 130, linenPerTurn: 20, suppliesPerOccNight: 3.9, rmPerOccNight: 3.1,
  ffeReservePerUnit: 145, damageReservePct: 0.01, furnishCapexPerUnit: 11500, listingSetupPerUnit: 650,
  resortFeePerNight: 18, parkingFeePerNight: 22, parkingTakePct: 0.55, petFeePerStay: 95, petTakePct: 0.18,
  internetPerUnitMo: 65, cablePerUnitMo: 45, insurancePerUnitMo: 42, licencePerUnitYr: 275, monitoringPerUnitMo: 18,
  guestSvcPerStay: 22, guestSvcPerUnitMo: 35, promoPct: 0.01, softwareMinMo: 150, softwarePerUnitMo: 12,
  utilElecIntensity: 1.35, utilElecStandby: 0.45, utilWaterIntensity: 1.55, utilWaterStandby: 0.06,
  ltElectricPerOccUnitMo: null, ltWaterPerOccUnitMo: null,
  ltParkingPerOccUnitMo: 0, ltInternetPerOccUnitMo: 0, ltUtilReimbPerOccUnitMo: 0, ltOtherPerOccUnitMo: 0
};

/* Market presets (generic comps carried over from the classic STR Builder). */
export const STR_PRESETS = [
  {id: 'urban', name: 'Urban / mixed leisure and corporate', curve: 'str_jax', values: {adr: 185, occupancy: 0.68, alos: 3.4, blockedPct: 0.06, mgmtFeePct: 0.18, cleanCostPerStay: 115, cleanFeePerStay: 130, linenPerTurn: 20, suppliesPerOccNight: 3.9, rmPerOccNight: 3.1, ffeReservePerUnit: 145, damageReservePct: 0.01, furnishCapexPerUnit: 11500, listingSetupPerUnit: 650, resortFeePerNight: 18, parkingFeePerNight: 22, parkingTakePct: 0.55, petFeePerStay: 95, petTakePct: 0.18, internetPerUnitMo: 65, cablePerUnitMo: 45, insurancePerUnitMo: 42, licencePerUnitYr: 275, monitoringPerUnitMo: 18, guestSvcPerStay: 22, guestSvcPerUnitMo: 35, promoPct: 0.01, utilElecIntensity: 1.35, utilElecStandby: 0.45, utilWaterIntensity: 1.55, utilWaterStandby: 0.06}},
  {id: 'corporate', name: 'Corporate / extended stay', curve: 'str_corporate', values: {adr: 158, occupancy: 0.78, alos: 12, blockedPct: 0.04, mgmtFeePct: 0.15, cleanCostPerStay: 135, cleanFeePerStay: 150, linenPerTurn: 28, suppliesPerOccNight: 2.4, rmPerOccNight: 2.1, ffeReservePerUnit: 120, damageReservePct: 0.006, furnishCapexPerUnit: 12500, listingSetupPerUnit: 550, resortFeePerNight: 0, parkingFeePerNight: 18, parkingTakePct: 0.85, petFeePerStay: 150, petTakePct: 0.1, internetPerUnitMo: 75, cablePerUnitMo: 35, insurancePerUnitMo: 34, licencePerUnitYr: 275, monitoringPerUnitMo: 12, guestSvcPerStay: 35, guestSvcPerUnitMo: 25, promoPct: 0.004, utilElecIntensity: 1.2, utilElecStandby: 0.35, utilWaterIntensity: 1.3, utilWaterStandby: 0.05}},
  {id: 'leisure_peak', name: 'Leisure / event-driven', curve: 'str_coastal', values: {adr: 245, occupancy: 0.62, alos: 2.4, blockedPct: 0.08, mgmtFeePct: 0.2, cleanCostPerStay: 145, cleanFeePerStay: 175, linenPerTurn: 24, suppliesPerOccNight: 5.2, rmPerOccNight: 4.4, ffeReservePerUnit: 185, damageReservePct: 0.016, furnishCapexPerUnit: 14000, listingSetupPerUnit: 850, resortFeePerNight: 32, parkingFeePerNight: 30, parkingTakePct: 0.9, petFeePerStay: 110, petTakePct: 0.24, internetPerUnitMo: 65, cablePerUnitMo: 55, insurancePerUnitMo: 58, licencePerUnitYr: 400, monitoringPerUnitMo: 26, guestSvcPerStay: 18, guestSvcPerUnitMo: 45, promoPct: 0.016, utilElecIntensity: 1.5, utilElecStandby: 0.5, utilWaterIntensity: 1.75, utilWaterStandby: 0.08}},
  {id: 'conservative', name: 'Conservative underwriting', curve: 'str_jax', values: {adr: 160, occupancy: 0.58, alos: 3, blockedPct: 0.09, mgmtFeePct: 0.2, cleanCostPerStay: 130, cleanFeePerStay: 120, linenPerTurn: 24, suppliesPerOccNight: 4.6, rmPerOccNight: 4.2, ffeReservePerUnit: 175, damageReservePct: 0.018, furnishCapexPerUnit: 13500, listingSetupPerUnit: 750, resortFeePerNight: 10, parkingFeePerNight: 18, parkingTakePct: 0.35, petFeePerStay: 75, petTakePct: 0.12, internetPerUnitMo: 75, cablePerUnitMo: 55, insurancePerUnitMo: 60, licencePerUnitYr: 450, monitoringPerUnitMo: 24, guestSvcPerStay: 30, guestSvcPerUnitMo: 50, promoPct: 0.02, utilElecIntensity: 1.6, utilElecStandby: 0.55, utilWaterIntensity: 1.85, utilWaterStandby: 0.1}}
];

export const DEFAULT_CHANNELS = [
  {channel: 'Airbnb', share: 0.45, feePct: 0.155, direct: false},
  {channel: 'Vrbo', share: 0.25, feePct: 0.08, direct: false},
  {channel: 'Booking.com', share: 0.1, feePct: 0.15, direct: false},
  {channel: 'Direct / corporate', share: 0.2, feePct: 0, direct: true}
];
/* Airbnb does not support a separate mandatory resort fee; other channels do. */
export const channelAllowsMandatoryFee = c => (c.ancillaryOk !== undefined ? !!c.ancillaryOk : !/airbnb/i.test(String(c.channel || '')));

/* GL posting map. nature: income | contra_income | expense | capital. */
export const STR_GL = {
  gross: {gl: '5144', name: 'STR gross rental revenue', nature: 'income'},
  cleanFee: {gl: '5932', name: 'STR cleaning fee income', nature: 'income'},
  resortFee: {gl: '5935', name: 'STR resort fee income', nature: 'income'},
  parkingFee: {gl: '5936', name: 'STR parking fee income', nature: 'income'},
  petFee: {gl: '5939', name: 'STR pet fee income', nature: 'income'},
  conversionLoss: {gl: '5220', name: 'Rent loss — units converted to STR', nature: 'contra_income'},
  deductions: {gl: '5250', name: 'STR discounts and refunds', nature: 'contra_income'},
  platformFees: {gl: '6840', name: 'STR channel / platform fees', nature: 'expense'},
  lodgingTax: {gl: '6830', name: 'STR lodging tax', nature: 'expense'},
  mgmtFee: {gl: '6321', name: 'STR management fee', nature: 'expense'},
  ccFees: {gl: '6240', name: 'STR credit card fees', nature: 'expense'},
  cleaning: {gl: '6228', name: 'STR cleaning', nature: 'expense'},
  linen: {gl: '6587', name: 'STR linen', nature: 'expense'},
  supplies: {gl: '6515', name: 'STR guest supplies', nature: 'expense'},
  rm: {gl: '6556', name: 'STR repairs & maintenance', nature: 'expense'},
  guestSvc: {gl: '6331', name: 'STR guest services', nature: 'expense'},
  electric: {gl: '6461', name: 'STR electricity', nature: 'expense'},
  water: {gl: '6463', name: 'STR water & sewer', nature: 'expense'},
  internet: {gl: '6465', name: 'STR internet & cable', nature: 'expense'},
  insurance: {gl: '6800', name: 'STR insurance', nature: 'expense'},
  licences: {gl: '6241', name: 'STR licences & permits', nature: 'expense'},
  monitoring: {gl: '6530', name: 'STR noise / occupancy monitoring', nature: 'expense'},
  software: {gl: '6237', name: 'STR software', nature: 'expense'},
  ffe: {gl: '6850', name: 'STR FF&E reserve', nature: 'expense'},
  damage: {gl: '6286', name: 'STR damage reserve', nature: 'expense'},
  promo: {gl: '6212', name: 'STR promotion', nature: 'expense'},
  listingSetup: {gl: '6205', name: 'STR listing setup', nature: 'expense'},
  furnish: {gl: '1504', name: 'STR furnishing (capital)', nature: 'capital'}
};
export const STR_LINE_ORDER = Object.keys(STR_GL);
export const STR_REVENUE_KEYS = ['gross', 'cleanFee', 'resortFee', 'parkingFee', 'petFee'];
export const STR_EXPENSE_KEYS = ['platformFees', 'lodgingTax', 'mgmtFee', 'ccFees', 'cleaning', 'linen', 'supplies', 'rm', 'guestSvc', 'electric', 'water', 'internet', 'insurance', 'licences', 'monitoring', 'software', 'ffe', 'damage', 'promo', 'listingSetup'];

/* Driver catalogue for the UI. kind: money | pct | num. */
export const STR_FIELDS = [
  ['Demand', [['adr', 'Base nightly rate (ADR)', 'money'], ['occupancy', 'Base occupancy', 'pct'], ['alos', 'Average length of stay (nights)', 'num'], ['blockedPct', 'Blocked nights (owner / maintenance)', 'pct'], ['permitNights', 'Permitted nights per unit per year', 'num']]],
  ['Guest fees', [['cleanFeePerStay', 'Cleaning fee charged per stay', 'money'], ['resortFeePerNight', 'Resort fee per night', 'money'], ['parkingFeePerNight', 'Parking fee per night', 'money'], ['parkingTakePct', 'Parking take-up', 'pct'], ['petFeePerStay', 'Pet fee per stay', 'money'], ['petTakePct', 'Pet take-up', 'pct']]],
  ['Deductions & fees', [['discountPct', 'Discounts (% of gross)', 'pct'], ['refundPct', 'Refunds (% of gross)', 'pct'], ['ccFeePct', 'Card fees on direct bookings', 'pct'], ['lodgingTax', 'Lodging tax rate', 'pct'], ['mgmtFeePct', 'STR management fee (% of net room revenue)', 'pct'], ['promoPct', 'Promotion (% of gross)', 'pct'], ['damageReservePct', 'Damage reserve (% of gross)', 'pct']]],
  ['Turn & stay costs', [['cleanCostPerStay', 'Cleaning cost per stay', 'money'], ['linenPerTurn', 'Linen per turn', 'money'], ['suppliesPerOccNight', 'Supplies per occupied night', 'money'], ['rmPerOccNight', 'R&M per occupied night', 'money'], ['guestSvcPerStay', 'Guest services per stay', 'money']]],
  ['Per unit', [['internetPerUnitMo', 'Internet / unit / month', 'money'], ['cablePerUnitMo', 'Cable / unit / month', 'money'], ['insurancePerUnitMo', 'Insurance / unit / month', 'money'], ['monitoringPerUnitMo', 'Monitoring / unit / month', 'money'], ['guestSvcPerUnitMo', 'Guest services / unit / month', 'money'], ['licencePerUnitYr', 'Licence / unit / year', 'money'], ['ffeReservePerUnit', 'FF&E reserve / unit / month', 'money'], ['softwarePerUnitMo', 'Software / unit / month', 'money'], ['softwareMinMo', 'Software minimum / month', 'money']]],
  ['Conversion', [['furnishCapexPerUnit', 'Furnishing capital per unit', 'money'], ['listingSetupPerUnit', 'Listing setup per unit', 'money']]],
  ['Utilities', [['ltElectricPerOccUnitMo', 'Electric — long-term $/occupied unit/month', 'money'], ['utilElecIntensity', 'Electric intensity (× long-term, occupied night)', 'num'], ['utilElecStandby', 'Electric standby (× long-term, vacant night)', 'num'], ['ltWaterPerOccUnitMo', 'Water/sewer — long-term $/occupied unit/month', 'money'], ['utilWaterIntensity', 'Water intensity (× long-term)', 'num'], ['utilWaterStandby', 'Water standby (× long-term)', 'num']]],
  ['Long-term income displaced (per occupied unit / month)', [['ltParkingPerOccUnitMo', 'Parking / garage', 'money'], ['ltInternetPerOccUnitMo', 'Internet resale', 'money'], ['ltUtilReimbPerOccUnitMo', 'Utility reimbursement / RUBS', 'money'], ['ltOtherPerOccUnitMo', 'Other resident fees', 'money']]]
];

export function daysInPeriod(period) {
  const [y, m] = String(period).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/* A new programme. Floor plans come from the box score when the model has them. */
export function newStrProgram(model = {}) {
  return {enabled: true, name: 'STR programme', postToProperty: true, propertyMgmtFeeOnStr: false, ancillaryOnSite: false, resortFeeBasis: 'night',
    curve: 'str_jax', drivers: {}, channelMix: structuredClone(DEFAULT_CHANNELS), adrMonthly: null, occMonthly: null, blockedMonthly: null, gl: {},
    floorPlans: (model.floorPlans || []).map((fp, i) => newFloorPlan(fp, i))};
}
export function newFloorPlan(fp = {}, i = 0) {
  return {id: fp.id || `fp${i + 1}`, type: fp.type || `Plan ${i + 1}`, units: num(fp.units), marketRent: has(fp.marketRent) ? num(fp.marketRent) : null,
    strUnits: 0, openingUnits: 0, startMonth: 0, rampMonths: 1, endMonth: null, adrFactor: null, adr: null, occAdjPts: 0, alos: null, cleanFeePerStay: null, cleanCostPerStay: null, furnishCapexPerUnit: null, adrMonthly: null, occMonthly: null};
}
export function applyPreset(program, id) {
  const p = STR_PRESETS.find(x => x.id === id);
  if (!p) return program;
  program.drivers = {...program.drivers, ...p.values};
  program.curve = p.curve; program.preset = id;
  return program;
}

const glFor = (program, key) => ({...STR_GL[key], ...(program.gl?.[key] ? {gl: String(program.gl[key])} : {})});
const active = model => !!model?.str?.enabled;

/* STR units on line per fiscal month for one floor plan. */
export function floorPlanUnits(fp) {
  const target = Math.max(0, num(fp.strUnits)), open = Math.min(target, Math.max(0, num(fp.openingUnits)));
  const start = clamp(Math.round(num(fp.startMonth)), 0, 11), ramp = Math.max(1, Math.round(num(fp.rampMonths) || 1));
  const end = has(fp.endMonth) ? clamp(Math.round(num(fp.endMonth)), 0, 11) : 11;
  return zeros().map((_, m) => {
    if (m > end) return 0;
    if (m < start) return open;
    return open + Math.round((target - open) * Math.min(1, (m - start + 1) / ramp));
  });
}
/* Units removed from the long-term pool per month (zero when not posted to the property). */
export function strUnitsByMonth(model) {
  if (!active(model) || model.str.postToProperty === false) return zeros();
  const out = zeros();
  for (const fp of model.str.floorPlans || []) floorPlanUnits(fp).forEach((v, m) => { out[m] += v; });
  return out;
}

/* Long-term utility cost per occupied unit-month, learned from the T12 when not set. */
function learnedUtility(model, gl) {
  const line = (model.lines || []).find(l => String(l.gl) === gl);
  const occUM = num(model.basis?.occUM);
  return line && occUM ? num(line.t12?.total) / occUM : 0;
}

/**
 * Calculate the programme. ctx is the property context from engine.buildContext
 * (rent, rentGrowth-adjusted, long-term occupancy share) — optional for standalone use.
 */
export function strCalculate(model, ctx = null) {
  const program = model.str || {};
  const periods = model.periods?.length === 12 ? model.periods : null;
  const days = periods ? periods.map(daysInPeriod) : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const calMonth = m => (periods ? Number(periods[m].slice(5)) - 1 : m);
  const D = {...STR_DEFAULTS, ...(program.drivers || {})};
  const A = k => (has(D[k]) ? num(D[k]) : num(STR_DEFAULTS[k]));
  const curve = normCurve(Array.isArray(program.customCurve) && program.customCurve.length === 12 ? program.customCurve : (STR_CURVES[program.curve] || STR_CURVES.flat).v);
  const seas = zeros().map((_, m) => curve[calMonth(m)]);
  const adrM = zeros().map((_, m) => (has(program.adrMonthly?.[m]) ? num(program.adrMonthly[m]) : A('adr') * seas[m]));
  const occM = zeros().map((_, m) => (has(program.occMonthly?.[m]) ? num(program.occMonthly[m]) : clamp(A('occupancy') * Math.pow(seas[m], 0.45), 0.1, 0.97)));
  const blkM = zeros().map((_, m) => clamp(has(program.blockedMonthly?.[m]) ? num(program.blockedMonthly[m]) : A('blockedPct'), 0, 0.9));

  // Channel economics.
  const mix = (program.channelMix?.length ? program.channelMix : DEFAULT_CHANNELS).map(c => ({...c, share: num(c.share), feePct: num(c.feePct)}));
  let wFee = 0, directShare = 0, ancShare = 0, ancFeeW = 0;
  for (const c of mix) { wFee += c.share * c.feePct; if (c.direct) directShare += c.share; if (channelAllowsMandatoryFee(c)) { ancShare += c.share; ancFeeW += c.share * c.feePct; } }
  const ancFeePct = ancShare > 1e-4 ? ancFeeW / ancShare : 0;
  const mixTotal = sum(mix.map(c => c.share));

  // Long-term context for displacement.
  const units = num(ctx?.units ?? model.property?.units);
  const growth = 1 + num(model.assumptions?.rentGrowth) / 100;
  const avgRent = num(ctx?.rent) || num(model.assumptions?.marketRent) * growth;
  const ltOcc = ctx?.occRaw && units ? ctx.occRaw.map(v => v / units) : Array(12).fill(0.95);
  const ltElec = has(D.ltElectricPerOccUnitMo) ? num(D.ltElectricPerOccUnitMo) : learnedUtility(model, glFor(program, 'electric').gl);
  const ltWater = has(D.ltWaterPerOccUnitMo) ? num(D.ltWaterPerOccUnitMo) : learnedUtility(model, glFor(program, 'water').gl);
  const ltAnc = A('ltParkingPerOccUnitMo') + A('ltInternetPerOccUnitMo') + A('ltUtilReimbPerOccUnitMo') + A('ltOtherPerOccUnitMo');

  const plans = (program.floorPlans || []).map(fp => {
    const n = floorPlanUnits(fp);
    const L = Object.fromEntries(STR_LINE_ORDER.map(k => [k, zeros()]));
    const q = {units: n, available: zeros(), blocked: zeros(), rentable: zeros(), booked: zeros(), stays: zeros(), adr: zeros(), occ: zeros(), displacedLt: zeros(), noi: zeros()};
    const rent = has(fp.marketRent) && num(fp.marketRent) ? num(fp.marketRent) * growth : avgRent;
    const factor = has(fp.adr) && num(fp.adr) ? num(fp.adr) / (A('adr') || 1) : has(fp.adrFactor) ? num(fp.adrFactor) : 1;
    const alos = has(fp.alos) && num(fp.alos) > 0 ? num(fp.alos) : A('alos');
    const cleanFee = has(fp.cleanFeePerStay) ? num(fp.cleanFeePerStay) : A('cleanFeePerStay');
    const cleanCost = has(fp.cleanCostPerStay) ? num(fp.cleanCostPerStay) : A('cleanCostPerStay');
    const furnishPer = has(fp.furnishCapexPerUnit) ? num(fp.furnishCapexPerUnit) : A('furnishCapexPerUnit');
    for (let m = 0; m < 12; m++) {
      q.available[m] = n[m] * days[m];
      q.blocked[m] = q.available[m] * blkM[m];
      q.rentable[m] = q.available[m] - q.blocked[m];
      q.adr[m] = has(fp.adrMonthly?.[m]) ? num(fp.adrMonthly[m]) : adrM[m] * factor;
      q.occ[m] = clamp(has(fp.occMonthly?.[m]) ? num(fp.occMonthly[m]) : occM[m] + num(fp.occAdjPts) / 100, 0, 0.99);
    }
    // Licence night cap: permitted nights × unit-years.
    const permit = A('permitNights'), cap = permit * sum(n) / 12, rentable = sum(q.rentable);
    if (permit < 365 && cap > 0 && rentable > cap) { const k = cap / rentable; q.rentable = q.rentable.map(v => v * k); q.capped = true; }
    let prev = num(fp.openingUnits) > 0 ? Math.min(num(fp.openingUnits), num(fp.strUnits)) : 0;
    for (let m = 0; m < 12; m++) {
      const booked = q.rentable[m] * q.occ[m], stays = alos > 0 ? booked / alos : 0, gross = booked * q.adr[m];
      q.booked[m] = booked; q.stays[m] = stays;
      L.gross[m] = gross;
      L.cleanFee[m] = stays * cleanFee;
      L.resortFee[m] = (program.resortFeeBasis === 'stay' ? stays : booked) * A('resortFeePerNight') * ancShare;
      L.parkingFee[m] = booked * A('parkingFeePerNight') * A('parkingTakePct');
      L.petFee[m] = stays * A('petFeePerStay') * A('petTakePct');
      const anc = L.resortFee[m] + L.parkingFee[m] + L.petFee[m];
      const roomFees = gross * wFee;
      const onSite = !!program.ancillaryOnSite;
      L.platformFees[m] = roomFees + L.cleanFee[m] * wFee + (onSite ? 0 : L.resortFee[m] * ancFeePct + (L.parkingFee[m] + L.petFee[m]) * wFee);
      const discounts = gross * A('discountPct'), refunds = gross * A('refundPct');
      L.deductions[m] = -(discounts + refunds);
      L.ccFees[m] = (gross + L.cleanFee[m] + anc) * directShare * A('ccFeePct');
      L.lodgingTax[m] = (gross - discounts - refunds + L.cleanFee[m] + anc) * A('lodgingTax');
      L.mgmtFee[m] = (gross - roomFees - discounts - refunds) * A('mgmtFeePct');
      L.cleaning[m] = stays * cleanCost;
      L.linen[m] = stays * A('linenPerTurn');
      L.supplies[m] = booked * A('suppliesPerOccNight');
      L.rm[m] = booked * A('rmPerOccNight');
      L.damage[m] = gross * A('damageReservePct');
      L.promo[m] = gross * A('promoPct');
      L.guestSvc[m] = stays * A('guestSvcPerStay') + n[m] * A('guestSvcPerUnitMo');
      L.ffe[m] = n[m] * A('ffeReservePerUnit');
      L.internet[m] = n[m] * (A('internetPerUnitMo') + A('cablePerUnitMo'));
      L.insurance[m] = n[m] * A('insurancePerUnitMo');
      L.monitoring[m] = n[m] * A('monitoringPerUnitMo');
      L.licences[m] = n[m] * A('licencePerUnitYr') / 12;
      const occFrac = q.available[m] ? booked / q.available[m] : 0;
      L.electric[m] = n[m] * ltElec * (occFrac * A('utilElecIntensity') + (1 - occFrac) * A('utilElecStandby'));
      L.water[m] = n[m] * ltWater * (occFrac * A('utilWaterIntensity') + (1 - occFrac) * A('utilWaterStandby'));
      const added = Math.max(0, n[m] - prev); prev = n[m];
      L.furnish[m] = added * furnishPer;
      L.listingSetup[m] = added * A('listingSetupPerUnit');
      L.conversionLoss[m] = -n[m] * rent;
      q.displacedLt[m] = n[m] * ltOcc[m] * (rent + ltAnc);
    }
    const revenue = zeros().map((_, m) => sum(STR_REVENUE_KEYS.map(k => L[k][m])));
    const expense = zeros().map((_, m) => sum(STR_EXPENSE_KEYS.map(k => L[k][m])));
    q.noi = revenue.map((v, m) => v + L.deductions[m] - expense[m]);
    const booked = sum(q.booked), avail = sum(q.available);
    return {id: fp.id, type: fp.type, totalUnits: num(fp.units), strUnits: num(fp.strUnits), rent, alos, lines: L, q, revenue, expense,
      annual: {avgUnits: sum(n) / 12, available: avail, booked, stays: sum(q.stays), gross: sum(L.gross), revenue: sum(revenue), deductions: sum(L.deductions), expense: sum(expense),
        noi: sum(q.noi), capital: sum(L.furnish), conversionLoss: sum(L.conversionLoss), displacedLt: sum(q.displacedLt),
        adr: booked ? sum(L.gross) / booked : 0, occ: sum(q.rentable) ? booked / sum(q.rentable) : 0, revpar: avail ? sum(L.gross) / avail : 0}};
  });

  // Programme totals by line; software is priced on the programme, not per plan.
  const lines = Object.fromEntries(STR_LINE_ORDER.map(k => [k, zeros()]));
  const unitsM = zeros();
  for (const p of plans) { STR_LINE_ORDER.forEach(k => p.lines[k].forEach((v, m) => { lines[k][m] += v; })); p.q.units.forEach((v, m) => { unitsM[m] += v; }); }
  lines.software = unitsM.map(n => (n ? Math.max(A('softwareMinMo'), n * A('softwarePerUnitMo')) : 0));
  const revenue = zeros().map((_, m) => sum(STR_REVENUE_KEYS.map(k => lines[k][m])));
  const expense = zeros().map((_, m) => sum(STR_EXPENSE_KEYS.map(k => lines[k][m])));
  const noi = revenue.map((v, m) => v + lines.deductions[m] - expense[m]);
  const displaced = zeros(); plans.forEach(p => p.q.displacedLt.forEach((v, m) => { displaced[m] += v; }));

  // GL rows (several keys may share a GL).
  const byGl = {};
  for (const k of STR_LINE_ORDER) {
    const g = glFor(program, k);
    const row = byGl[g.gl] ||= {gl: g.gl, name: g.name, nature: g.nature, keys: [], monthly: zeros()};
    row.keys.push(k); lines[k].forEach((v, m) => { row.monthly[m] += v; });
  }
  const glRows = Object.values(byGl).map(r => ({...r, monthly: r.monthly.map(r2), annual: r2(sum(r.monthly))}));

  const booked = sum(plans.map(p => p.annual.booked)), avail = sum(plans.map(p => p.annual.available)), gross = sum(lines.gross);
  const checks = [];
  if (Math.abs(mixTotal - 1) > 0.005) checks.push({severity: 'warn', message: `Channel shares add to ${(mixTotal * 100).toFixed(1)}%, not 100%.`});
  for (const p of plans) if (p.strUnits > p.totalUnits && p.totalUnits) checks.push({severity: 'warn', message: `${p.type}: ${p.strUnits} STR units exceeds the ${p.totalUnits} units in the plan.`});
  for (const p of plans) if (p.q.capped) checks.push({severity: 'info', message: `${p.type}: rentable nights capped by the ${A('permitNights')}-night licence limit.`});
  if (A('cleanFeePerStay') > 0 && A('cleanCostPerStay') > 0 && A('cleanFeePerStay') < A('cleanCostPerStay') * 0.7) checks.push({severity: 'warn', message: 'The guest cleaning fee recovers less than 70% of the cleaning cost per stay.'});
  if (!ltElec && sum(unitsM)) checks.push({severity: 'info', message: 'No long-term electric cost per occupied unit (T12 6461) — STR electricity is zero until it is set.'});

  return {plans, lines: Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v.map(r2)])), glRows, unitsM,
    monthly: {revenue: revenue.map(r2), deductions: lines.deductions.map(r2), expense: expense.map(r2), noi: noi.map(r2), capital: lines.furnish.map(r2), conversionLoss: lines.conversionLoss.map(r2), displaced: displaced.map(r2)},
    annual: {avgUnits: sum(unitsM) / 12, peakUnits: Math.max(0, ...unitsM), booked, stays: sum(plans.map(p => p.annual.stays)), available: avail, gross, revenue: sum(revenue), deductions: sum(lines.deductions),
      expense: sum(expense), noi: sum(noi), capital: sum(lines.furnish), conversionLoss: sum(lines.conversionLoss), displaced: sum(displaced), uplift: sum(noi) - sum(displaced),
      adr: booked ? gross / booked : 0, occ: avail ? booked / sum(plans.map(p => sum(p.q.rentable))) : 0, revpar: avail ? gross / avail : 0},
    channel: {weightedFeePct: wFee, directShare, ancillaryShare: ancShare, ancillaryFeePct: ancFeePct, mixTotal},
    rates: {adr: adrM, occ: occM, blocked: blkM, ltElectric: ltElec, ltWater}, checks};
}

/* Floor-plan rate suggestion: nightly rate scales with the square root of the
 * plan's long-term rent relative to the average (larger plans earn more per night,
 * but less than proportionally). */
export function suggestAdrFactor(fp, avgRent) {
  const r = num(fp.marketRent), a = num(avgRent);
  return r && a ? Math.round(Math.sqrt(r / a) * 100) / 100 : 1;
}

/* Section of an STR GL in the property budget when the property has no line for it. */
export function strSectionFor(nature, gl, sectionForGl) {
  if (nature === 'capital') return sectionForGl(gl);
  if (nature === 'contra_income') return sectionForGl(gl) === 'Cost Of Leasing' ? 'Cost Of Leasing' : STR_INCOME_SECTION;
  return nature === 'income' ? STR_INCOME_SECTION : STR_EXPENSE_SECTION;
}

/* Saved STR programme workbook (classic STR Builder export): read its applied drivers. */
export function isStrProgrammeWorkbook(sheetNames) {
  return sheetNames.includes('Applied assumptions') && (sheetNames.includes('Monthly STR') || sheetNames.includes('STR GL detail'));
}
export function parseStrProgrammeWorkbook(rows, {periods} = {}) {
  const warnings = [], values = {};
  for (const r of rows.slice(1)) {
    const k = String(r[0] ?? '').trim(); if (!k) continue;
    let v = r[1];
    if (typeof v === 'string' && /^[[{]/.test(v.trim())) { try { v = JSON.parse(v); } catch { warnings.push(`Could not read ${k}.`); continue; } }
    values[k] = v;
  }
  const drivers = {};
  for (const k of Object.keys(STR_DEFAULTS)) if (has(values[k]) && typeof values[k] !== 'object') drivers[k] = num(values[k]);
  const util = values.utilities || {};
  const byPeriod = obj => (periods && obj && typeof obj === 'object' ? periods.map(p => { const a = obj[p.slice(0, 4)]; const v = Array.isArray(a) ? a[Number(p.slice(5)) - 1] : null; return has(v) ? num(v) : null; }) : null);
  const clean = a => (a && a.some(v => v !== null) ? a : null);
  const adrMonthly = values.adrMode === 'monthly' ? clean(byPeriod(values.adrMonthly)) : null;
  const occMonthly = values.occMode === 'monthly' ? clean(byPeriod(values.occMonthly)) : null;
  const blockedMonthly = values.blockedMode === 'monthly' ? clean(byPeriod(values.blockedMonthly)) : null;
  if (values.adrMode === 'monthly' && !adrMonthly) warnings.push('Monthly ADR has no values for this fiscal year; the base ADR and seasonality apply.');
  if (values.occMode === 'monthly' && !occMonthly) warnings.push('Monthly occupancy has no values for this fiscal year; the base occupancy and seasonality apply.');
  if (util.electric?.perOccUsage) warnings.push('Electric usage per occupied unit was priced from provider tariffs in the classic builder; enter the long-term electric cost per occupied unit here.');
  const channelMix = Array.isArray(values.channelMix) ? values.channelMix.map(c => ({channel: String(c.channel || ''), share: num(c.share), feePct: num(c.feePct), direct: !!c.direct, ...(c.ancillaryOk !== undefined ? {ancillaryOk: !!c.ancillaryOk} : {})})) : null;
  return {ok: Object.keys(drivers).length > 0, kind: 'str_programme', name: values.name ? String(values.name) : null, drivers, channelMix, curve: STR_CURVES[values.curve] ? values.curve : null,
    adrMonthly, occMonthly, blockedMonthly, resortFeeBasis: values.resortFeeBasis === 'stay' ? 'stay' : null, ancillaryOnSite: values.ancillaryOnSite === true, preset: values.presetApplied || null, warnings};
}
export function applyProgrammeImport(program, parsed) {
  Object.assign(program.drivers, parsed.drivers);
  if (parsed.channelMix?.length) program.channelMix = parsed.channelMix;
  if (parsed.curve) program.curve = parsed.curve;
  for (const k of ['adrMonthly', 'occMonthly', 'blockedMonthly']) if (parsed[k]) program[k] = parsed[k];
  if (parsed.resortFeeBasis) program.resortFeeBasis = parsed.resortFeeBasis;
  program.ancillaryOnSite = parsed.ancillaryOnSite;
  if (parsed.name) program.name = parsed.name;
  program.importedFrom = parsed.preset ? `Saved programme (${parsed.preset})` : 'Saved programme';
  return program;
}
