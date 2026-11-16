/* Budget Builder v2 — Short-term rental tab. Rendering and events only; the
 * programme is calculated by str.mjs inside engine.calculate. */
import * as S from './str.mjs?v=f3b38a6b870d777f';

const has = x => x !== null && x !== undefined && x !== '';
const pct1 = v => `${(v * 100).toFixed(1)}%`;

export const VIEWS = [['property', 'Property incl. STR'], ['without', 'Property without STR'], ['programme', 'STR programme']];

/* ctx: {s, dis, canEdit, mark, money, esc, MON, num, status} */
export function strTab(ctx) {
  const {s, esc, money, dis} = ctx, m = s.model, P = m.str;
  if (!P) return `<div class="card"><p class="h2">Short-term rental programme</p>
  <p class="muted">Model furnished short-term rentals floor plan by floor plan. The programme posts into this property's budget — STR income, guest fees, channel fees, lodging tax, turn costs, utilities and furnishing capital — and the converted units leave the long-term leasing pool, so vacancy, resident fees, turnover and utilities follow. You can view the property with and without the programme, or the programme on its own.</p>
  <div class="row" style="margin-top:10px">${ctx.canEdit() ? '<button class="btn" data-act="strenable">Add an STR programme</button>' : ''}
  <label class="btn ghost" style="cursor:pointer">Start from a saved STR programme workbook<input type="file" accept=".xlsx" data-strfile hidden ${dis()}></label></div></div>`;
  const r = s.result, X = r.str, view = s.strView || 'property';
  if (!X) return '<div class="card">The programme is switched off. <button class="btn tiny" data-strtoggle>Switch on</button></div>';
  return [header(ctx, P, X), views(ctx, X, view), floorPlans(ctx, P, X), rates(ctx, P, X), channels(ctx, P, X), drivers(ctx, P, X), programmeStatement(ctx, X), glMap(ctx, P, X), effectByGl(ctx, X)].join('');
}

function header({s, esc, money, dis, canEdit}, P, X) {
  const A = X.annual, chk = (k, label, title = '') => `<label class="f" style="flex-direction:row;align-items:center;gap:6px" title="${esc(title)}"><input type="checkbox" class="chk" data-strchk="${k}" ${P[k] ? 'checked' : ''} ${dis()}>${label}</label>`;
  return `<div class="card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><p class="h2">Short-term rental programme</p>
  <p class="muted" style="margin:0">${P.importedFrom ? esc(P.importedFrom) + ' · ' : ''}${X.posted ? 'Included in the property budget and its publication.' : '<b>Not posted</b> — shown on its own; the property budget is unchanged.'}</p></div>
  <div class="row"><button class="btn ghost" data-act="strxlsx">Download STR workbook</button>
  <label class="btn ghost" style="cursor:pointer">Import saved programme<input type="file" accept=".xlsx" data-strfile hidden ${dis()}></label>${canEdit() ? '<button class="linkbtn" data-act="strremove">Remove programme</button>' : ''}</div></div>
  <div class="row" style="margin-top:10px"><label class="f">Programme name<input class="inp" data-strf="name" value="${esc(P.name)}" ${dis()}></label>
  <label class="f">Market preset<select class="sel" data-strpreset ${dis()}><option value="">Choose to apply…</option>${S.STR_PRESETS.map(p => `<option value="${p.id}" ${P.preset === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
  <label class="f">Seasonality<select class="sel" data-strf="curve" ${dis()}>${Object.entries(S.STR_CURVES).map(([k, c]) => `<option value="${k}" ${P.curve === k ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
  <label class="f">Resort fee charged<select class="sel" data-strf="resortFeeBasis" ${dis()}><option value="night" ${P.resortFeeBasis !== 'stay' ? 'selected' : ''}>Per night</option><option value="stay" ${P.resortFeeBasis === 'stay' ? 'selected' : ''}>Per stay</option></select></label></div>
  <div class="row" style="margin-top:8px">${chk('postToProperty', 'Include in the property budget', 'Post STR GLs and remove converted units from the long-term pool')}${chk('propertyMgmtFeeOnStr', 'Property management fee applies to STR income')}${chk('ancillaryOnSite', 'Add-on fees collected on site (not commissioned)')}</div>
  <div class="kpis" style="margin-top:12px">
  <div class="kpi"><div class="k">STR units</div><div class="v">${A.avgUnits.toFixed(1)}</div><div class="d">average · peak ${A.peakUnits}</div></div>
  <div class="kpi"><div class="k">ADR · occupancy</div><div class="v">${money(A.adr)}</div><div class="d">${pct1(A.occ)} of rentable nights · RevPAR ${money(A.revpar)}</div></div>
  <div class="kpi"><div class="k">STR revenue</div><div class="v">${money(A.revenue)}</div><div class="d">${Math.round(A.booked).toLocaleString()} nights · ${Math.round(A.stays).toLocaleString()} stays</div></div>
  <div class="kpi"><div class="k">STR operating NOI</div><div class="v">${money(A.noi)}</div><div class="d">after deductions and STR expenses</div></div>
  <div class="kpi"><div class="k">Uplift vs long-term</div><div class="v ${A.uplift < 0 ? 'neg' : ''}">${money(A.uplift)}</div><div class="d">long-term income given up ${money(A.displaced)}</div></div>
  <div class="kpi"><div class="k">Furnishing capital</div><div class="v">${money(A.capital)}</div><div class="d">below NOI, at conversion</div></div></div>
  ${X.checks.length ? X.checks.map(c => `<div class="log"><span class="chip ${c.severity === 'warn' ? 'warn' : 'model'}">${c.severity === 'warn' ? 'Check' : 'Info'}</span> ${esc(c.message)}</div>`).join('') : ''}</div>`;
}

function views({money}, X, view) {
  const W = X.without, I = X.impact.totals, T = {income: W.income + I.income, opex: W.opex + I.opex, noi: W.noi + I.noi, reserves: W.reserves + I.reserves, capex: W.capex + I.capex, cashFlow: W.cashFlow + I.cashFlow};
  const rows = [['Total income', 'income'], ['Operating expenses', 'opex'], ['Net operating income', 'noi'], ['Replacement reserves', 'reserves'], ['Capital expenditures', 'capex'], ['Cash flow after reserves & capex', 'cashFlow']];
  const col = k => view === k ? 'style="box-shadow:inset 3px 0 0 #6ba2b8,inset -3px 0 0 #6ba2b8"' : '';
  return `<div class="card" style="padding:14px 18px"><div class="row" style="justify-content:space-between"><p class="h2" style="margin:0">Views</p>
  <div class="row">${VIEWS.map(([k, l]) => `<button class="btn ${view === k ? '' : 'ghost'} tiny" data-strview="${k}">${l}</button>`).join('')}</div></div>
  <p class="muted" style="margin:6px 0 0">The property budget without the programme, plus the programme's full effect (STR operations, converted units' rent and the long-term income they displace), equals the property budget including STR — the version that is approved and published.</p>
  <div class="scroll"><table><thead><tr><th></th><th class="r" ${col('without')}>Property without STR</th><th class="r" ${col('programme')}>STR programme effect</th><th class="r" ${col('property')}>Property incl. STR</th></tr></thead><tbody>
  ${rows.map(([l, k]) => `<tr class="${['noi', 'cashFlow'].includes(k) ? 'tot' : ''}"><td>${l}</td><td class="r" ${col('without')}>${money(W[k])}</td><td class="r" ${col('programme')}>${money(I[k])}</td><td class="r" ${col('property')}><b>${money(T[k])}</b></td></tr>`).join('')}</tbody></table></div></div>`;
}

function floorPlans({s, esc, money, dis, MON, num}, P, X) {
  const pm = s.model.periods.map(p => MON[num(p.slice(5)) - 1] + ' ' + p.slice(2, 4));
  const sel = (i, k, v, blank) => `<select class="sel" data-strfp="${i}" data-k="${k}" ${dis()}>${blank ? `<option value="">${blank}</option>` : ''}${pm.map((x, j) => `<option value="${j}" ${has(v) && num(v) === j ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
  const inp = (i, k, v, cls = 'xs', ph = '') => `<input class="inp ${cls}" data-strfp="${i}" data-k="${k}" value="${has(v) ? esc(v) : ''}" placeholder="${esc(ph)}" ${dis()}>`;
  const base = num(P.drivers.adr ?? S.STR_DEFAULTS.adr);
  return `<div class="card" style="padding:14px 18px"><div class="row" style="justify-content:space-between"><div><p class="h2">Floor plans</p><p class="muted" style="margin:0">Units converted per floor plan, when they go live and how fast. Blank rate fields use the programme rate; the long-term rent is what each converted unit gives up.</p></div>
  <div class="row">${dis() ? '' : '<button class="btn ghost" data-act="strsuggest">Suggest rates by floor plan</button><button class="btn ghost" data-act="strfpadd">+ Floor plan</button>'}</div></div></div>
  <div class="scroll"><table><thead><tr><th>Floor plan</th><th class="r">Units</th><th class="r">LT rent</th><th class="r">STR units</th><th class="r">Live at start</th><th>Converts from</th><th class="r">Ramp (mo)</th><th>Ends</th><th class="r">ADR</th><th class="r">× rate</th><th class="r">Occ ± pts</th><th class="r">Stay</th><th class="r">Clean fee</th><th class="r">Furnish / unit</th><th class="r">ADR · occ</th><th class="r">Revenue</th><th class="r">STR NOI</th><th class="r">LT income given up</th><th></th></tr></thead><tbody>
  ${P.floorPlans.map((fp, i) => { const R = X.plans[i]?.annual || {}; return `<tr><td>${inp(i, 'type', fp.type, 'sm')}</td><td class="r">${inp(i, 'units', fp.units)}</td><td class="r">${inp(i, 'marketRent', fp.marketRent, 'num')}</td>
  <td class="r">${inp(i, 'strUnits', fp.strUnits)}</td><td class="r">${inp(i, 'openingUnits', fp.openingUnits)}</td><td>${sel(i, 'startMonth', fp.startMonth)}</td><td class="r">${inp(i, 'rampMonths', fp.rampMonths)}</td><td>${sel(i, 'endMonth', fp.endMonth, 'Full year')}</td>
  <td class="r">${inp(i, 'adr', fp.adr, 'num', money(base * (has(fp.adrFactor) ? num(fp.adrFactor) : 1)))}</td><td class="r">${inp(i, 'adrFactor', fp.adrFactor, 'xs', '1.00')}</td><td class="r">${inp(i, 'occAdjPts', fp.occAdjPts)}</td><td class="r">${inp(i, 'alos', fp.alos, 'xs', String(P.drivers.alos ?? S.STR_DEFAULTS.alos))}</td>
  <td class="r">${inp(i, 'cleanFeePerStay', fp.cleanFeePerStay, 'xs', String(P.drivers.cleanFeePerStay ?? S.STR_DEFAULTS.cleanFeePerStay))}</td><td class="r">${inp(i, 'furnishCapexPerUnit', fp.furnishCapexPerUnit, 'num', String(P.drivers.furnishCapexPerUnit ?? S.STR_DEFAULTS.furnishCapexPerUnit))}</td>
  <td class="r">${money(R.adr || 0)} · ${pct1(R.occ || 0)}</td><td class="r">${money(R.revenue || 0)}</td><td class="r"><b>${money(R.noi || 0)}</b></td><td class="r">${money(R.displacedLt || 0)}</td><td>${dis() ? '' : `<button class="linkbtn" data-strfpdel="${i}">Remove</button>`}</td></tr>`; }).join('') || '<tr><td colspan="19" class="muted">No floor plans yet. Add them, or upload a box score on Setup and rebuild.</td></tr>'}
  <tr class="tot"><td>Programme</td><td class="r">${P.floorPlans.reduce((t, f) => t + num(f.units), 0)}</td><td></td><td class="r">${P.floorPlans.reduce((t, f) => t + num(f.strUnits), 0)}</td><td colspan="10"></td><td class="r">${money(X.annual.adr)} · ${pct1(X.annual.occ)}</td><td class="r">${money(X.annual.revenue)}</td><td class="r">${money(X.annual.noi)}</td><td class="r">${money(X.annual.displaced)}</td><td></td></tr></tbody></table></div>`;
}

function rates({s, esc, money, dis, MON, num}, P, X) {
  const row = (k, label, vals, fmt, saved) => `<tr><td>${label}${saved ? ' <span class="chip fix">Set by month</span>' : ''}</td>${vals.map((v, i) => `<td class="r"><input class="inp num" style="width:72px" data-strmon="${k}:${i}" value="${fmt(v)}" ${dis()}></td>`).join('')}<td>${saved && !dis() ? `<button class="linkbtn" data-strreset="${k}">Use seasonality</button>` : ''}</td></tr>`;
  return `<div class="card" style="padding:14px 18px"><p class="h2">Programme rates by month</p><p class="muted" style="margin:0">From the base rate and the seasonality curve unless set by month. Floor plans apply their own rate multiple and occupancy adjustment.</p></div>
  <div class="scroll"><table><thead><tr><th></th>${s.model.periods.map(p => `<th class="r">${MON[num(p.slice(5)) - 1]} ${p.slice(2, 4)}</th>`).join('')}<th></th></tr></thead><tbody>
  ${row('adr', 'ADR', X.rates.adr, v => Math.round(v * 100) / 100, !!P.adrMonthly)}${row('occ', 'Occupancy %', X.rates.occ, v => Math.round(v * 1000) / 10, !!P.occMonthly)}${row('blocked', 'Blocked %', X.rates.blocked, v => Math.round(v * 1000) / 10, !!P.blockedMonthly)}
  <tr class="sub"><td>STR units</td>${X.unitsM.map(v => `<td class="r">${v}</td>`).join('')}<td></td></tr></tbody></table></div>`;
}

function channels({esc, dis, num}, P, X) {
  const C = X.channel;
  return `<div class="card" style="padding:14px 18px"><div class="row" style="justify-content:space-between"><div><p class="h2">Booking channels</p><p class="muted" style="margin:0">Weighted commission ${pct1(C.weightedFeePct)} · direct ${pct1(C.directShare)} · mandatory add-on fees collectable on ${pct1(C.ancillaryShare)} of bookings (Airbnb does not allow a separate resort fee).</p></div>${dis() ? '' : '<button class="btn ghost" data-act="strchadd">+ Channel</button>'}</div>
  <table style="margin-top:8px"><thead><tr><th>Channel</th><th class="r">Share %</th><th class="r">Commission %</th><th>Direct</th><th>Allows resort fee</th><th></th></tr></thead><tbody>
  ${P.channelMix.map((c, i) => `<tr><td><input class="inp sm" data-strch="${i}" data-k="channel" value="${esc(c.channel)}" ${dis()}></td><td class="r"><input class="inp xs" data-strch="${i}" data-k="share" value="${Math.round(num(c.share) * 1000) / 10}" ${dis()}></td>
  <td class="r"><input class="inp xs" data-strch="${i}" data-k="feePct" value="${Math.round(num(c.feePct) * 1000) / 10}" ${dis()}></td><td><input type="checkbox" class="chk" data-strch="${i}" data-k="direct" ${c.direct ? 'checked' : ''} ${dis()}></td>
  <td><input type="checkbox" class="chk" data-strch="${i}" data-k="ancillaryOk" ${S.channelAllowsMandatoryFee(c) ? 'checked' : ''} ${dis()}></td><td>${dis() ? '' : `<button class="linkbtn" data-strchdel="${i}">Remove</button>`}</td></tr>`).join('')}
  <tr class="sub"><td>Total</td><td class="r ${Math.abs(C.mixTotal - 1) > 0.005 ? 'neg' : ''}">${(C.mixTotal * 100).toFixed(1)}%</td><td colspan="4"></td></tr></tbody></table></div>`;
}

function drivers({esc, dis, num, money}, P, X) {
  const D = {...S.STR_DEFAULTS, ...P.drivers};
  const learned = {ltElectricPerOccUnitMo: X.rates.ltElectric, ltWaterPerOccUnitMo: X.rates.ltWater};
  const f = ([k, label, kind]) => { const v = D[k], shown = !has(v) ? '' : kind === 'pct' ? Math.round(num(v) * 10000) / 100 : Math.round(num(v) * 100) / 100;
    return `<label class="f">${esc(label)}${kind === 'pct' ? ' (%)' : ''}<input class="inp num" data-strd="${k}" data-kind="${kind}" value="${shown}" placeholder="${k in learned ? 'T12: ' + money(learned[k]) : ''}" ${dis()}></label>`; };
  return `<div class="card"><p class="h2">Programme drivers</p><p class="muted">Every line is driven by nights, stays, units or revenue. Percentages are entered as percents.</p>
  ${S.STR_FIELDS.map(([group, fields]) => `<p class="h3" style="margin-top:12px">${esc(group)}</p><div class="grid">${fields.map(f).join('')}</div>`).join('')}</div>`;
}

const LINE_LABEL = {gross: 'Gross room revenue', cleanFee: 'Cleaning fees charged', resortFee: 'Resort fees', parkingFee: 'Parking fees', petFee: 'Pet fees', deductions: 'Discounts & refunds',
  platformFees: 'Channel commissions', lodgingTax: 'Lodging tax', mgmtFee: 'STR management fee', ccFees: 'Card fees', cleaning: 'Cleaning', linen: 'Linen', supplies: 'Guest supplies', rm: 'Repairs & maintenance',
  guestSvc: 'Guest services', electric: 'Electricity', water: 'Water & sewer', internet: 'Internet & cable', insurance: 'Insurance', licences: 'Licences & permits', monitoring: 'Monitoring', software: 'Software',
  ffe: 'FF&E reserve', damage: 'Damage reserve', promo: 'Promotion', listingSetup: 'Listing setup', furnish: 'Furnishing (capital)', conversionLoss: 'Long-term rent on converted units'};
export const lineLabel = k => LINE_LABEL[k] || k;

function programmeStatement({s, money, MON, num}, X) {
  const Lx = X.lines, tot = a => a.reduce((t, v) => t + v, 0);
  const line = (label, a, cls = '') => `<tr class="${cls}"><td>${label}</td>${a.map(v => `<td class="r">${money(v)}</td>`).join('')}<td class="r"><b>${money(tot(a))}</b></td></tr>`;
  const sumKeys = keys => Array(12).fill(0).map((_, m) => keys.reduce((t, k) => t + Lx[k][m], 0));
  return `<div class="card" style="padding:14px 18px"><p class="h2">STR programme statement</p><p class="muted" style="margin:0">Operating results of the programme by month, then the long-term income the converted units give up.</p></div>
  <div class="scroll"><table><thead><tr><th>Line</th>${s.model.periods.map(p => `<th class="r">${MON[num(p.slice(5)) - 1]} ${p.slice(2, 4)}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
  <tr class="sec"><td colspan="14">Revenue</td></tr>${S.STR_REVENUE_KEYS.map(k => line(lineLabel(k), Lx[k])).join('')}${line(lineLabel('deductions'), Lx.deductions)}${line('Net STR revenue', X.monthly.revenue.map((v, m) => v + X.monthly.deductions[m]), 'sub')}
  <tr class="sec"><td colspan="14">Expenses</td></tr>${S.STR_EXPENSE_KEYS.filter(k => tot(Lx[k])).map(k => line(lineLabel(k), Lx[k])).join('')}${line('STR operating expenses', X.monthly.expense, 'sub')}
  ${line('STR operating NOI', X.monthly.noi, 'tot')}${line(lineLabel('furnish'), Lx.furnish)}
  <tr class="sec"><td colspan="14">Long-term comparison</td></tr>${line('Long-term income the units would have earned', X.monthly.displaced)}${line('Uplift vs long-term', X.monthly.noi.map((v, m) => v - X.monthly.displaced[m]), 'tot')}</tbody></table></div>`;
}

function glMap({esc, dis, money}, P, X) {
  return `<details class="card"><summary class="h2" style="cursor:pointer">GL posting</summary><p class="muted">Where each STR line posts in the property budget. Shared GLs add to the property's existing line.</p>
  <div class="scroll"><table><thead><tr><th>STR line</th><th>GL</th><th>Account</th><th class="r">Annual</th></tr></thead><tbody>
  ${S.STR_LINE_ORDER.map(k => { const g = {...S.STR_GL[k], ...(P.gl?.[k] ? {gl: P.gl[k]} : {})}; const a = X.lines[k].reduce((t, v) => t + v, 0);
    return `<tr><td>${esc(lineLabel(k))}</td><td><input class="inp xs" data-strgl="${k}" value="${esc(g.gl)}" ${dis()}></td><td>${esc(g.name)}</td><td class="r">${money(a)}</td></tr>`; }).join('')}</tbody></table></div></details>`;
}

function effectByGl({money, esc}, X) {
  const rows = Object.values(X.impact.rows).sort((a, b) => a.gl.localeCompare(b.gl));
  return `<details class="card"><summary class="h2" style="cursor:pointer">Effect on the property by GL (${rows.length})</summary>
  <div class="scroll"><table><thead><tr><th>GL</th><th>Account</th><th>Section</th><th class="r">Without STR</th><th class="r">STR effect</th><th class="r">Incl. STR</th></tr></thead><tbody>
  ${rows.map(r => { const w = (X.withoutRows[r.gl] || []).reduce((t, v) => t + v, 0); return `<tr><td class="gl">${esc(r.gl)}</td><td>${esc(r.name)}</td><td class="muted">${esc(r.section)}</td><td class="r">${money(w)}</td><td class="r">${money(r.annual)}</td><td class="r"><b>${money(w + r.annual)}</b></td></tr>`; }).join('')}</tbody></table></div></details>`;
}

/* Investor package line. */
export function investorLine(r, money) {
  const X = r.str; if (!X) return null;
  return `Short-term rental programme: ${X.annual.avgUnits.toFixed(1)} units on average (peak ${X.annual.peakUnits}), ADR ${money(X.annual.adr)}, ${(X.annual.occ * 100).toFixed(1)}% occupancy; STR operating NOI ${money(X.annual.noi)}${X.posted ? `; net effect on property NOI ${money(X.impact.totals.noi)}` : ' (shown separately; not in this budget)'}.`;
}

/* Workbook for the programme on its own. */
export function strWorkbook(XLSX, model, result, {MON, num}) {
  const X = result.str, P = model.str, wb = XLSX.utils.book_new(), per = model.periods;
  const head = ['Line', ...per, 'Total'], row = (label, a) => [label, ...a.map(v => Math.round(v * 100) / 100), Math.round(a.reduce((t, v) => t + v, 0) * 100) / 100];
  const plans = [['Floor plan', 'Units', 'LT rent', 'STR units', 'Average STR units', 'Booked nights', 'Stays', 'ADR', 'Occupancy', 'RevPAR', 'STR revenue', 'Deductions', 'STR expenses', 'STR operating NOI', 'Furnishing', 'LT income given up', 'Uplift'],
    ...X.plans.map(p => [p.type, p.totalUnits, Math.round(p.rent * 100) / 100, p.strUnits, p.annual.avgUnits, Math.round(p.annual.booked), Math.round(p.annual.stays), p.annual.adr, p.annual.occ, p.annual.revpar, p.annual.revenue, p.annual.deductions, p.annual.expense, p.annual.noi, p.annual.capital, p.annual.displacedLt, p.annual.noi - p.annual.displacedLt].map(v => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)))];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plans), 'Floor plans');
  const st = [head, ...S.STR_REVENUE_KEYS.map(k => row(lineLabel(k), X.lines[k])), row(lineLabel('deductions'), X.lines.deductions), ...S.STR_EXPENSE_KEYS.map(k => row(lineLabel(k), X.lines[k])),
    row('STR operating NOI', X.monthly.noi), row(lineLabel('furnish'), X.lines.furnish), row('Long-term income given up', X.monthly.displaced), row('STR units', X.unitsM)];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(st), 'Monthly STR');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['GL', 'Account', 'Nature', ...per, 'Total'], ...X.glRows.map(g => [g.gl, g.name, g.nature, ...g.monthly, g.annual])]), 'STR GL detail');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['GL', 'Account', 'Section', 'Without STR', 'STR effect', 'Incl. STR'], ...Object.values(X.impact.rows).map(r => { const w = (X.withoutRows[r.gl] || []).reduce((t, v) => t + v, 0); return [r.gl, r.name, r.section, Math.round(w * 100) / 100, r.annual, Math.round((w + r.annual) * 100) / 100]; })]), 'Property effect');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Driver', 'Value'], ...Object.entries({...S.STR_DEFAULTS, ...P.drivers}).map(([k, v]) => [k, v]), ['curve', P.curve], ['channelMix', JSON.stringify(P.channelMix)]]), 'Drivers');
  return XLSX.write(wb, {type: 'array', bookType: 'xlsx'});
}

function enableProgram({s}) {
  const m = s.model;
  m.str = S.newStrProgram(m);
  const box = s.sources?.find(x => x.kind === 'boxscore' && x.parsed.ok)?.parsed;
  if (!m.str.floorPlans.length && box?.floorPlans?.length) m.str.floorPlans = box.floorPlans.map((f, i) => S.newFloorPlan(f, i));
  if (!m.str.floorPlans.length) m.str.floorPlans = [S.newFloorPlan({type: 'All units', units: m.property.units, marketRent: s.result?.context.rent || null})];
}

/* Events. Return true when handled. */
export function strClick(t, ctx) {
  const {s, mark, status, num} = ctx, d = t.dataset, m = s.model;
  if (d.strview) { s.strView = d.strview; ctx.render(); return true; }
  if (d.strfpdel !== undefined) { m.str.floorPlans.splice(num(d.strfpdel), 1); mark(); return true; }
  if (d.strchdel !== undefined) { m.str.channelMix.splice(num(d.strchdel), 1); mark(); return true; }
  if (d.strreset) { m.str[{adr: 'adrMonthly', occ: 'occMonthly', blocked: 'blockedMonthly'}[d.strreset]] = null; mark(); return true; }
  if (d.strtoggle !== undefined) { m.str.enabled = true; mark(); return true; }
  switch (d.act) {
    case 'strenable': enableProgram(ctx); mark(); return true;
    case 'strremove': if (confirm('Remove the STR programme from this budget?')) { delete m.str; mark(); } return true;
    case 'strfpadd': m.str.floorPlans.push(S.newFloorPlan({}, m.str.floorPlans.length)); mark(); return true;
    case 'strchadd': m.str.channelMix.push({channel: 'New channel', share: 0, feePct: 0, direct: false}); mark(); return true;
    case 'strsuggest': {
      const avg = s.result.context.rent; m.str.floorPlans.forEach(fp => { if (!has(fp.adr)) fp.adrFactor = S.suggestAdrFactor(fp, avg); });
      status('Rate multiples set from each floor plan’s rent relative to the average.'); mark(); return true;
    }
    case 'strxlsx': {
      const bytes = strWorkbook(window.XLSX, m, s.result, ctx);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      a.download = `${s.draft.name} — ${m.str.name}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); return true;
    }
  }
  return false;
}

export async function strChange(t, ctx) {
  const {s, mark, num, status} = ctx, d = t.dataset, m = s.model;
  if (t.matches('[data-strfile]')) {
    const f = t.files?.[0]; if (!f) return true;
    try {
      const wb = window.XLSX.read(new Uint8Array(await f.arrayBuffer()), {type: 'array'});
      if (!S.isStrProgrammeWorkbook(wb.SheetNames)) throw Error('This is not a saved STR programme workbook (it needs an “Applied assumptions” sheet).');
      const parsed = S.parseStrProgrammeWorkbook(window.XLSX.utils.sheet_to_json(wb.Sheets['Applied assumptions'], {header: 1, defval: '', raw: true}), {periods: m.periods});
      if (!parsed.ok) throw Error('No drivers were found in the workbook.');
      if (!m.str) enableProgram(ctx);
      S.applyProgrammeImport(m.str, parsed);
      status(`Imported ${Object.keys(parsed.drivers).length} drivers from ${f.name}. Set the floor plans and units to convert.${parsed.warnings.length ? ' ' + parsed.warnings.join(' ') : ''}`, false, 12000);
      mark();
    } catch (e) { status(e.message, true, 9000); }
    return true;
  }
  if (!m?.str) return false;
  const P = m.str;
  if (d.strf) { P[d.strf] = t.value; mark(); return true; }
  if (d.strchk) { P[d.strchk] = t.checked; mark(); return true; }
  if (t.matches('[data-strpreset]')) { if (t.value && confirm('Apply this preset to the programme drivers? Floor-plan settings stay.')) { S.applyPreset(P, t.value); mark(); } return true; }
  if (d.strd) { P.drivers[d.strd] = t.value === '' ? null : d.kind === 'pct' ? num(t.value) / 100 : num(t.value); mark(); return true; }
  if (d.strgl) { P.gl ||= {}; const v = t.value.trim(); if (v && !/^\d{4}$/.test(v)) { status('GL codes are four digits.', true); return true; } if (v) P.gl[d.strgl] = v; else delete P.gl[d.strgl]; mark(); return true; }
  if (d.strfp !== undefined && d.k) {
    const fp = P.floorPlans[num(d.strfp)], text = ['type'].includes(d.k);
    fp[d.k] = text ? t.value : t.value === '' ? null : num(t.value);
    if (d.k === 'adr' && has(fp.adr)) fp.adrFactor = null;
    mark(); return true;
  }
  if (d.strch !== undefined && d.k) {
    const c = P.channelMix[num(d.strch)];
    if (d.k === 'channel') c.channel = t.value; else if (d.k === 'direct' || d.k === 'ancillaryOk') c[d.k] = t.checked; else c[d.k] = num(t.value) / 100;
    mark(); return true;
  }
  if (d.strmon) {
    const [k, i] = d.strmon.split(':'), key = {adr: 'adrMonthly', occ: 'occMonthly', blocked: 'blockedMonthly'}[k];
    const cur = s.result.str.rates[k].slice();
    const arr = P[key] ? P[key].slice() : cur.map(v => Math.round(v * 10000) / 10000);
    arr[num(i)] = k === 'adr' ? num(t.value) : num(t.value) / 100;
    P[key] = arr; mark(); return true;
  }
  return false;
}
