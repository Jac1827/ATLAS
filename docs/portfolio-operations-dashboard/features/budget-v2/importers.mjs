/* Budget Builder v2 — importers.
 * Each parser takes plain row arrays (SheetJS sheet_to_json {header:1}) or extracted text,
 * so they run identically in the browser, a worker and Node tests. They never guess
 * silently: every result carries `warnings` describing what could not be read. */
import {sectionForGl, num} from './engine.mjs?v=d1645594fb2c6c47';

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const isNum = v => typeof v === 'number' ? Number.isFinite(v) : /^\(?-?\$?[\d,]+(\.\d+)?\)?$/.test(clean(v));
const toNum = v => { if (typeof v === 'number') return v; const s = clean(v); const neg = /^\(.*\)$/.test(s) || s.startsWith('-'); const n = parseFloat(s.replace(/[()$,\-\s]/g, '')); return Number.isFinite(n) ? (neg ? -n : n) : 0; };
const MONTHS = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};

export function detectReport(sheetNames = [], firstRows = []) {
  const text = firstRows.slice(0, 40).map(r => (r || []).map(clean).join(' ')).join(' ').toLowerCase();
  if (/trailing 12 month/.test(text)) return 't12';
  if (/trending occupancy/.test(text)) return 'trending';
  if (/box score/.test(text)) return 'boxscore';
  if (/budget report/.test(text) && /fy20\d\d/.test(text)) return 'vena_budget';
  if (/utility type/.test(text) && /utility provider/.test(text)) return 'conservice';
  if (sheetNames.includes('Import Sheet')) return 'import_sheet';
  if (sheetNames.includes('Input') && /operating expenses/.test(text)) return 'vena_opex_form';
  if (sheetNames.includes('Rent Schedule')) return 'vena_revenue_form';
  return 'unknown';
}

/* Entrata "Trailing 12 Month - Income Statement" (xlsx export, one sheet per property). */
export function parseT12Sheet(rows) {
  const warnings = [];
  const head = rows.findIndex(r => clean(r?.[0]) === 'Account' && /account name/i.test(clean(r?.[1])));
  if (head < 0) return {ok: false, warnings: ['Header row "Account / Account Name" not found.']};
  const property = clean(rows.slice(0, head).map(r => r?.[0]).filter(Boolean)[1]);
  const hdr = rows[head].map(clean);
  const monthCols = [];
  hdr.forEach((h, i) => { const m = /^([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(h); if (m && MONTHS[m[1].toLowerCase()]) monthCols.push({i, period: `${m[2]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}`}); });
  const totalCol = hdr.findIndex(h => /^total$/i.test(h));
  if (!monthCols.length) warnings.push('No month columns found.');
  const lines = [];
  let section = '';
  for (const r of rows.slice(head + 1)) {
    const a = clean(r?.[0]), b = clean(r?.[1]);
    if (/^\d{4}$/.test(a) && b) {
      const byPeriod = Object.fromEntries(monthCols.map(c => [c.period, toNum(r[c.i])]));
      const total = totalCol >= 0 && isNum(r[totalCol]) ? toNum(r[totalCol]) : Object.values(byPeriod).reduce((t, v) => t + v, 0);
      lines.push({gl: a, name: b, section: a.startsWith('1') ? sectionForGl(a, b) : (normalizeSection(section) || sectionForGl(a, b)), byPeriod, total});
    } else if (a && !isNum(r?.[1]) && (normalizeSection(a) || !/^total|net |cash flow|controllable cash/i.test(a))) section = a;
  }
  const periods = monthCols.map(c => c.period).sort();
  return {ok: lines.length > 0, kind: 't12', property, periods, lines, warnings};
}

/* T12 from the monthly financial package PDF: one text line per GL with 12 months + total.
 * `textLines` are page text lines in reading order (see linesFromPdfItems). Months are
 * read from the header ("Aug 2026 Jul 2026 … Total"), newest first as Entrata prints them. */
export function parseT12Text(textLines) {
  const warnings = [];
  let periods = null, section = '';
  const lines = [];
  for (const raw of textLines) {
    const ln = clean(raw);
    const hdr = ln.match(/((?:[A-Z][a-z]{2} \d{4}\s+){12})Total$/);
    if (hdr && !periods) periods = hdr[1].trim().split(/\s+(?=[A-Z][a-z]{2} )/).map(s => { const [mn, y] = s.split(' '); return `${y}-${String(MONTHS[mn.toLowerCase()]).padStart(2, '0')}`; });
    const m = /^(\d{4})\s+(.+?)\s+((?:\(?-?[\d,]+\.\d\d\)?\s*){13})$/.exec(ln);
    if (m) {
      const nums = m[3].trim().split(/\s+/).map(toNum);
      const per = periods || [];
      const byPeriod = Object.fromEntries(per.map((p, i) => [p, nums[i]]));
      lines.push({gl: m[1], name: m[2], section: m[1].startsWith('1') ? sectionForGl(m[1], m[2]) : (normalizeSection(section) || sectionForGl(m[1], m[2])), byPeriod, total: nums[12]});
    } else if (ln && ln.length < 48 && !/\d\.\d\d/.test(ln) && !/^(Account|RISE|Property|Accrual|Page)/.test(ln)) section = ln;
  }
  if (!periods) warnings.push('Month header not found; months are unlabelled.');
  return {ok: lines.length > 0, kind: 't12', periods: (periods || []).slice().sort(), lines, warnings};
}

/* Group pdf.js text items into lines by baseline. */
export function linesFromPdfItems(items) {
  const rows = new Map();
  for (const it of items) { if (!it.str?.trim()) continue; const y = Math.round(it.transform[5]); const k = [...rows.keys()].find(k => Math.abs(k - y) <= 2) ?? y; (rows.get(k) || rows.set(k, []).get(k)).push(it); }
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, its]) => its.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' '));
}

const SECTION_ALIASES = {'debt service': 'Non-Operating', 'depreciation/amortization': 'Non-Operating', 'other expenses': 'Non-Operating', 'other finance related': 'Non-Operating', 'non operating expenses': 'Non-Operating','reserves - net cash flow': 'Replacement Reserves', 'capital expenditures - net cash flows': 'Capital Expenditures', 'common area utilities': 'Common Area Utilities', 'unit utilities': 'Unit Utilities'};
export function normalizeSection(s) {
  const t = clean(s); if (!t) return '';
  if (SECTION_ALIASES[t.toLowerCase()]) return SECTION_ALIASES[t.toLowerCase()];
  const known = ['Rental Income', 'Cost Of Leasing', 'Other Income', 'Payroll Office', 'Payroll Maintenance', 'Payroll Related Expenses', 'General & Administrative', 'Professional Fees', 'Contract Services', 'Turnover Expense', 'Repairs & Maintenance', 'Marketing & Leasing', 'Management Fees', 'Taxes & Insurance'];
  return known.find(k => k.toLowerCase() === t.toLowerCase()) || '';
}

/* Entrata Box Score: unit mix, occupancy, market vs scheduled rent. */
export function parseBoxScore(rows) {
  const head = rows.findIndex(r => clean(r?.[0]) === 'Unit Type' && /sqft/i.test(clean(r?.[1])));
  if (head < 0) return {ok: false, warnings: ['Availability table not found.']};
  const h = rows[head].map(clean);
  const col = name => h.findIndex(x => x.toLowerCase() === name.toLowerCase());
  // Floor-plan rows and the Total row are laid out differently in the Entrata export;
  // totals align with the visible header, floor plans with the "Total …" detail columns.
  const ci = {units: col('Units'), rentable: col('Rentable Units'), occ: col('Occupied'), market: h.findIndex(x => /^avg\. market rent/i.test(x)), sched: h.findIndex(x => /^avg\. scheduled rent/i.test(x)),
    totMarket: h.findIndex(x => /total market rent$/i.test(x)), totSched: h.findIndex(x => /total scheduled rent$/i.test(x))};
  const property = clean(rows[1]?.[0]);
  const asOf = clean(rows.slice(0, head + 1).flat().map(clean).find(t => /as of \d/i.test(t)) || '').replace(/^.*\((as of [^)]*)\).*$/i, '$1');
  const floorPlans = [];
  let total = null;
  for (const r of rows.slice(head + 1)) {
    const name = clean(r?.[0]);
    if (/^total/i.test(name) || (!name && isNum(r?.[ci.units]))) { total = r; break; }
    if (!name) break;
    const u = toNum(r[ci.rentable]);
    floorPlans.push({type: name, units: u, marketRent: u && ci.totMarket >= 0 ? toNum(r[ci.totMarket]) / u : null});
  }
  const units = total ? toNum(total[ci.units]) : floorPlans.reduce((t, f) => t + f.units, 0);
  const occupied = total ? toNum(total[ci.occ]) : 0;
  const marketRent = total ? toNum(total[ci.market]) : 0, scheduledRent = total ? toNum(total[ci.sched]) : 0;
  return {ok: units > 0, kind: 'boxscore', property, asOf, units, occupied, marketRent, scheduledRent,
    lossToLeasePct: marketRent ? Math.max(0, (1 - scheduledRent / marketRent) * 100) : 0, floorPlans, warnings: []};
}

/* Entrata Trending Occupancy: monthly move-ins / move-outs / occupied, history + scheduled. */
export function parseTrending(rows) {
  const head = rows.findIndex(r => clean(r?.[0]) === 'Date Range' && /move-ins/i.test((r || []).map(clean).join(' ')));
  if (head < 0) return {ok: false, warnings: ['Date Range header not found.']};
  const h = rows[head].map(clean);
  const ci = {mi: h.findIndex(x => /^move-ins$/i.test(x)), mo: h.findIndex(x => /^move-outs$/i.test(x)), begin: h.findIndex(x => /^beginning occupied units$/i.test(x)), end: h.findIndex(x => /^ending occupied units$/i.test(x)), units: h.findIndex(x => /unit space count/i.test(x))};
  if (Object.values(ci).some(i => i < 0)) return {ok: false, warnings: ['Expected Move-ins, Move-outs, Beginning/Ending Occupied Units and Unit Space Count columns.']};
  const months = [], warnings = [];
  let units = 0;
  for (const r of rows.slice(head + 1)) {
    const m = /^(\d{2})\/01\/(\d{4}) - (\d{2})\/\d{2}\/(\d{4})$/.exec(clean(r?.[0]));
    if (!m || m[2] !== m[4] || m[1] !== m[3]) continue;
    const row = {period: `${m[2]}-${m[1]}`, moveIns: toNum(r[ci.mi]), moveOuts: toNum(r[ci.mo]), beginOccupied: toNum(r[ci.begin]), endOccupied: toNum(r[ci.end])};
    units = Math.max(units, toNum(r[ci.units]));
    if (Math.abs(row.beginOccupied + row.moveIns - row.moveOuts - row.endOccupied) > 0.5) warnings.push(`${row.period}: begin + move-ins − move-outs ≠ end (transfers or skips).`);
    months.push(row);
  }
  return {ok: months.length > 0, kind: 'trending', property: clean(rows[1]?.[0]), units, months, warnings};
}

/* Conservice FY utility projection (property × utility × month % change). */
export function parseConservice(rows) {
  const head = rows.findIndex(r => (r || []).map(clean).includes('Property Name') && (r || []).map(clean).includes('Utility Type'));
  if (head < 0) return {ok: false, warnings: ['Property Name / Utility Type header not found.']};
  const h = rows[head].map(clean);
  const pi = h.indexOf('Property Name'), ui = h.indexOf('Utility Type'), vi = h.indexOf('Utility Provider'), ai = h.findIndex(x => /projected annual/i.test(x));
  const monthIdx = h.map((x, i) => (MONTHS[x.slice(0, 3).toLowerCase()] ? {i, month: MONTHS[x.slice(0, 3).toLowerCase()]} : null)).filter(Boolean);
  const out = {};
  for (const r of rows.slice(head + 1)) {
    const prop = clean(r?.[pi]), util = clean(r?.[ui]);
    if (!prop || !util) continue;
    const annual = isNum(r?.[ai]) ? toNum(r[ai]) * 100 : null;
    const monthly = Object.fromEntries(monthIdx.map(({i, month}) => [month, isNum(r?.[i]) ? toNum(r[i]) * 100 : null]));
    (out[prop.toLowerCase()] ||= {property: prop, city: clean(r?.[pi + 1]), state: clean(r?.[pi + 2]), utilities: {}}).utilities[util.toLowerCase()] = {provider: clean(r?.[vi]), annualPct: annual, monthlyPct: monthly, available: annual !== null};
  }
  return {ok: Object.keys(out).length > 0, kind: 'conservice', properties: out, warnings: []};
}

/* Electric / water / sewer % for one property from a Conservice parse (null when unavailable). */
export function conserviceRates(parsed, propertyName) {
  const key = Object.keys(parsed?.properties || {}).find(k => k.replace(/^rise\s+/, '') === String(propertyName).toLowerCase().replace(/^rise\s+/, ''));
  const p = key && parsed.properties[key];
  if (!p) return null;
  const pick = u => { const x = p.utilities[u]; if (!x?.available) return null; const vals = Object.values(x.monthlyPct).filter(v => v !== null); const tail = vals.slice(-9); return {annual: x.annualPct, steady: tail.length ? tail.reduce((t, v) => t + v, 0) / tail.length : x.annualPct, provider: x.provider}; };
  return {electric: pick('electricity'), water: pick('water'), sewer: pick('sewer'), gas: pick('natural gas'), city: p.city, state: p.state};
}

/* Vena "Budget Report" export: GL rows, monthly plan, line items and comments. */
export function parseVenaBudget(rows, {fiscalYear} = {}) {
  const warnings = [];
  const titleRow = rows.findIndex(r => (r || []).some(v => clean(v) === 'Budget Report'));
  if (titleRow < 0) return {ok: false, warnings: ['"Budget Report" title not found.']};
  const yearRow = rows[titleRow + 1] || [];
  const label = fiscalYear ? `FY${fiscalYear}` : yearRow.map(clean).find(v => /^FY\d{4}$/.test(v));
  const start = yearRow.findIndex(v => clean(v) === label);
  if (start < 0) return {ok: false, warnings: [`Plan year ${label || ''} not found.`]};
  const entity = clean(yearRow.find(v => /\(.*\)/.test(clean(v))));
  const monthCols = Array.from({length: 12}, (_, i) => start + i), totalCol = start + 12;
  const glRe = /^\[\*\]\s*(\d{4})\s*\((.*)\)\s*$/;
  const lines = new Map();
  let current = null;
  for (const r of rows.slice(titleRow + 3)) {
    if (!r) continue;
    const descIdx = r.findIndex(v => glRe.test(clean(v)));
    if (descIdx >= 0) {
      const m = glRe.exec(clean(r[descIdx]));
      current = lines.get(m[1]) || {gl: m[1], name: m[2], section: sectionForGl(m[1], m[2]), monthly: Array(12).fill(0), total: 0, items: [], comments: [], descCol: descIdx};
      const monthly = monthCols.map(i => (isNum(r[i]) ? toNum(r[i]) : 0));
      current.monthly = current.monthly.map((v, i) => v + monthly[i]);
      current.total += isNum(r[totalCol]) ? toNum(r[totalCol]) : monthly.reduce((t, v) => t + v, 0);
      const c = commentIn(r, totalCol); if (c) current.comments.push(c);
      lines.set(m[1], current);
      continue;
    }
    if (!current) continue;
    const desc = clean(r[current.descCol]);
    if (!desc || desc.startsWith('#') || desc.startsWith('DynR') || desc === 'Add Description' || /^\[\*\]/.test(desc)) continue;
    const amount = isNum(r[totalCol]) ? toNum(r[totalCol]) : monthCols.reduce((t, i) => t + (isNum(r[i]) ? toNum(r[i]) : 0), 0);
    const comment = commentIn(r, totalCol);
    if (!amount && !comment) continue;
    const prior = current.items.find(i => i.description === desc);
    if (prior) { prior.amount += amount; if (!prior.comment && comment) prior.comment = comment; } else current.items.push({description: desc, amount, comment});
    if (comment && !current.comments.includes(comment)) current.comments.push(comment);
  }
  const out = [...lines.values()].filter(l => l.total || l.items.length || l.comments.length).map(({descCol, ...l}) => ({...l, note: l.comments.join(' · ')}));
  if (!out.length) warnings.push('No GL rows with plan values found.');
  return {ok: out.length > 0, kind: 'vena_budget', entity, fiscalYear: label ? Number(label.slice(2)) : null, lines: out, warnings};
}
/* RISE budget model workbooks ("Import Sheet": BUDGET_ID | ACCT_NO | DEPT_ID | … | month columns). */
export function parseImportSheet(rows, {fiscalYear, names = {}} = {}) {
  const head = rows.findIndex(r => (r || []).map(clean).includes('ACCT_NO'));
  if (head < 0) return {ok: false, warnings: ['ACCT_NO header not found.']};
  const h = rows[head].map(clean), acct = h.indexOf('ACCT_NO');
  const cols = h.map((x, i) => { const m = /(?:month ended\s+)?([a-z]{3})[a-z]*\.?\s+(\d{4})$/i.exec(x); return m && MONTHS[m[1].toLowerCase()] ? {i, year: Number(m[2]), month: MONTHS[m[1].toLowerCase()]} : null; }).filter(Boolean);
  const year = fiscalYear || Math.min(...cols.map(c => c.year));
  const yc = cols.filter(c => c.year === Number(year)).sort((a, b) => a.month - b.month);
  if (yc.length !== 12) return {ok: false, warnings: [`Twelve monthly columns for ${year} not found (found ${yc.length}).`]};
  const lines = new Map();
  for (const r of rows.slice(head + 1)) {
    const gl = clean(r?.[acct]);
    if (!/^\d{4}$/.test(gl)) continue;
    const monthly = yc.map(c => toNum(r[c.i]));
    const prior = lines.get(gl);
    if (prior) prior.monthly = prior.monthly.map((v, i) => v + monthly[i]);
    else lines.set(gl, {gl, name: names[gl] || '', section: sectionForGl(gl, names[gl]), monthly, items: [], comments: [], note: ''});
  }
  const out = [...lines.values()].map(l => ({...l, total: l.monthly.reduce((t, v) => t + v, 0)})).filter(l => l.total);
  return {ok: out.length > 0, kind: 'import_sheet', fiscalYear: Number(year), lines: out, warnings: out.length ? [] : [`All ${year} values are zero — the workbook may not be filled in yet.`]};
}
function commentIn(r, totalCol) {
  for (let i = totalCol + 1; i <= totalCol + 4 && i < r.length; i++) { const v = r[i]; if (typeof v === 'string' && clean(v).length > 2 && !isNum(v)) return clean(v); }
  return '';
}

/* Contract / proposal text → structured terms and a GL suggestion. Every field reports
 * whether it was found; nothing is defaulted. Review is required before budget use. */
const GL_KEYWORDS = [[/landscap|grounds|mulch|turf|irrigation/i, '6537', 'Landscaping Contract'], [/elevator|vertical transportation/i, '6545', 'Elevator Maint Contract'],
  [/pest|exterminat/i, '6522', 'Exterminating Contract'], [/valet trash/i, '6529', 'Valet Trash Expense'], [/compactor|garbage|waste|bulk trash|recycl/i, '6525', 'Garbage'],
  [/pool/i, '6520', 'Pool Contract'], [/fire|sprinkler|alarm monitoring|life safety/i, '6532', 'Fire and Safety Monitoring Contract'],
  [/parking/i, '5936', 'Parking Fees'], [/internet|bulk wifi|broadband|cable/i, '6465', 'Internet Service'], [/access control|gate|door system/i, '6528', 'Access Systems-Software'],
  [/hvac/i, '6546', 'HVAC Contract'], [/plumb|lift station/i, '6544', 'Plumbing Contract']];
export function extractContractTerms(text, {fileName = ''} = {}) {
  // PDF text often splits digits inside parentheses ("( 6 0%)"); rejoin them before matching.
  const t = String(text).replace(/\s+/g, ' ').replace(/\(\s*([\d\s%.]+?)\s*\)/g, (m, g) => '(' + g.replace(/\s+/g, '') + ')');
  const found = {};
  const money = s => toNum(s.replace(/[^\d.,()-]/g, ''));
  const service = GL_KEYWORDS.find(([re]) => re.test(fileName + ' ' + t.slice(0, 4000)));
  found.gl = service ? {value: service[1], label: service[2], basis: 'keyword'} : null;
  const vendor = /and\s+(.{3,60}?)\s*\(hereinafter (?:called|referred to as)\s*[“"]?(?:Tenant|Contractor|Vendor|Provider)/i.exec(t) || /(?:between|by and between)\s+(.{3,80}?)\s*(?:\(|,)\s*(?:hereinafter|“|")?/i.exec(t) || /Prepared By:\s*(.{3,60}?)\s{1,}[A-Z]/.exec(t);
  found.vendorText = vendor ? clean(vendor[1]) : null;
  const term = /term of this [a-z ]*?(?:shall be|is) for\s+([a-z]+)\s*\((\d+)\)\s*(year|month)s?/i.exec(t) || /initial\s+(?:[a-z]+)\s*\((\d+)\)-?\s*(month|year)\s+term/i.exec(t);
  found.termMonths = term ? (term.length === 4 ? Number(term[2]) * (/year/i.test(term[3]) ? 12 : 1) : Number(term[1]) * (/year/i.test(term[2]) ? 12 : 1)) : null;
  const pct = /\((\d{1,3}(?:\.\d+)?)%\)\s*percent of the total monthly.{0,12}?gross/i.exec(t) || /(\d{1,3}(?:\.\d+)?)\s*%\s+of (?:the )?(?:total )?(?:monthly )?.{0,12}?gross/i.exec(t);
  found.revenueSharePct = pct ? Number(pct[1]) : null;
  const esc = /(\d(?:\.\d+)?)\s*%\s*(?:annual\s*)?(?:increase|escalat)/i.exec(t);
  found.escalatorPct = esc ? Number(esc[1]) : null;
  const monthly = /monthly (?:investment|fee|charge|rate|amount)[^$]{0,40}\$\s?([\d,]+(?:\.\d\d)?)/i.exec(t) || /\$\s?([\d,]+(?:\.\d\d)?)\s*(?:per month|\/mo(?:nth)?)/i.exec(t);
  found.monthlyAmount = monthly ? money(monthly[1]) : null;
  const notice = /(\d+|thirty|sixty|ninety)\s*\(?(\d+)?\)?\s*days[’']?\s*(?:prior )?written notice/i.exec(t);
  found.terminationNoticeDays = notice ? Number(notice[2] || ({thirty: 30, sixty: 60, ninety: 90}[notice[1].toLowerCase()] ?? notice[1])) : null;
  found.autoRenew = /automatically renew|auto-?renew/i.test(t) ? true : (/unless renewed by a written agreement/i.test(t) ? false : null);
  const blankDates = /_{4,}/.test(t);
  const warnings = [];
  if (!found.gl) warnings.push('Service / GL not recognized — choose the GL.');
  if (blankDates) warnings.push('Document contains blank date fields — confirm start and end dates.');
  if (found.monthlyAmount === null && found.revenueSharePct === null) warnings.push('No monthly amount or revenue share found.');
  return {kind: 'contract', fileName, terms: found, warnings, status: 'needs_review'};
}

/* Pull plain text from a .docx (JSZip instance supplied by the caller). */
export async function docxText(zip) {
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) return '';
  return xml.replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/* Map a fiscal year onto T12 basis: occupied/vacant unit-months, move-ins/outs inside the T12 window. */
export function t12Basis(t12, trending, units) {
  const set = new Set(t12?.periods || []);
  const ms = (trending?.months || []).filter(m => set.has(m.period));
  if (!ms.length) return null;
  const scale = 12 / ms.length;
  const occUM = ms.reduce((t, m) => t + m.endOccupied, 0) * scale;
  return {occUM, vacUM: Math.max(0, num(units) * 12 - occUM), moveIns: ms.reduce((t, m) => t + m.moveIns, 0) * scale, moveOuts: ms.reduce((t, m) => t + m.moveOuts, 0) * scale, months: ms.length};
}
