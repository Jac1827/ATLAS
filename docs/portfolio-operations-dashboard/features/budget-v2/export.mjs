/* Budget Builder v2 — Excel and PDF export of any budget, draft or approved.
 * A neutral report (title, status, summary, GL × month sections, extra tables) is
 * built from a property or company budget, then written as a workbook (SheetJS) or
 * a landscape PDF (pdf-lib). Drafts are marked as drafts on every sheet and page. */
import * as E from './engine.mjs?v=48f7adf2d87d56a9';
import * as C from './company.mjs?v=ef63c2f8dd60b1d0';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sum = a => a.some(v => v == null || !Number.isFinite(Number(v))) ? null : a.reduce((t, v) => t + Number(v), 0);
const sub = (a, b) => a == null || b == null ? null : a - b;
const perUnit = (value, units) => value == null || !units ? null : value / units;
const r2 = n => n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 100) / 100;
const zeros = () => Array(12).fill(0);
const label = p => `${MON[Number(p.slice(5)) - 1]} ${p.slice(2, 4)}`;
const DRAFT_TEXT = 'DRAFT — not approved. Figures may change.';

function sectionsOf(rows, order, noteOf) {
  const by = {};
  for (const r of Object.values(rows)) (by[r.line.section] ||= []).push(r);
  const names = [...order.filter(s => by[s]), ...Object.keys(by).filter(s => !order.includes(s))];
  return names.map(name => {
    const lines = by[name].sort((a, b) => String(a.line.gl).localeCompare(String(b.line.gl))).map(r => ({gl: String(r.line.gl), name: r.line.name, monthly: r.monthly.map(r2), total: r2(r.annual), compare: r.t12 ?? r.prior ?? null, note: noteOf(r) || ''}));
    const monthly = zeros(); lines.forEach(l => l.monthly.forEach((v, m) => { monthly[m] = sum([monthly[m], v]); }));
    return {name, lines, monthly: monthly.map(r2), total: r2(sum(monthly))};
  });
}
const totalRow = (label, monthly, cls = 'tot', annual = sum(monthly)) => ({label, monthly: monthly.map(r2), total: r2(annual), cls});

/* Property budget → report. */
export function propertyReport({model, result, draft, statusLabel, community}) {
  const T = result.totals.annual, units = Number(model.property.units) || 0, ul = E.ASSET_CLASSES[model.property.assetClass]?.unitLabel || 'unit';
  const isDraft = !['approved_locked', 'sent_to_investors'].includes(draft?.status) || !!draft?.revised_after_approval;
  const sections = sectionsOf(result.rows, [...E.INCOME_SECTIONS, ...E.OPEX_SECTIONS, ...E.BELOW_NOI_SECTIONS], r => model.notes?.[r.line.gl] ?? r.line.note);
  const inc = sections.filter(s => E.INCOME_SECTIONS.includes(s.name)), opx = sections.filter(s => !E.INCOME_SECTIONS.includes(s.name) && !E.BELOW_NOI_SECTIONS.includes(s.name)), below = sections.filter(s => E.BELOW_NOI_SECTIONS.includes(s.name));
  const add = list => { const o = zeros(); list.forEach(s => s.monthly.forEach((v, m) => { o[m] = sum([o[m], v]); })); return o; };
  const incM = result.monthly.income, opxM = result.monthly.opex, belowM = add(below), noiM = result.monthly.noi;
  const K = result.kpis || {};
  return {kind: 'property', title: draft?.name || `${community || model.property.name} FY${model.fiscalYear} Budget`, entity: community || model.property.name,
    subtitle: `${E.ASSET_CLASSES[model.property.assetClass]?.label || ''} · ${units} ${ul}s · ${label(model.periods[0])} – ${label(model.periods[11])}${draft?.plan_type === 'reforecast' ? ' · Reforecast' : ''}`,
    status: statusLabel || (isDraft ? 'Draft' : 'Approved'), isDraft, periods: model.periods, compareLabel: model.sources?.t12 ? 'T12 actual' : null,
    summary: [['Total income', T.income], ['Operating expenses', T.opex], ['Net operating income', T.noi], [`NOI per ${ul}`, perUnit(T.noi, units)], ['Replacement reserves', T.reserves], ['Capital expenditures', T.capex], ['Cash flow after reserves & capex', T.cashFlow],
      ...(result.memo ? [[result.memo.label, result.memo.annual]] : [])],
    kpis: [['Average occupancy', K.avgOccupancy != null ? `${(K.avgOccupancy * 100).toFixed(1)}%` : ''], ['Move-ins / move-outs', `${K.moveIns ?? ''} / ${K.moveOuts ?? ''}`], ['Market rent', model.assumptions?.marketRent ? `$${Math.round(model.assumptions.marketRent).toLocaleString()}` : '']],
    groups: result.groups.map(g => [g.name, g.final, perUnit(g.final, units)]),
    blocks: [{title: 'Income', sections: inc, total: totalRow('Total income', incM, 'sub', T.income)}, {title: 'Operating expenses', sections: opx, total: totalRow('Total operating expenses', opxM, 'sub', T.opex)},
      {title: null, sections: [], total: totalRow('Net operating income', noiM, 'tot', T.noi)}, {title: 'Below NOI', sections: below, total: totalRow('Cash flow after reserves & capex', noiM.map((v, m) => sub(v, belowM[m])), 'tot', T.cashFlow)}],
    extra: propertyExtras(model, result)};
}
function propertyExtras(model, result) {
  const out = [];
  const c = result.context, per = model.periods;
  if (c?.occRaw) out.push({name: 'Leasing schedule', head: ['Month', 'Move-ins', 'Move-outs', 'Occupied (end)', 'Occupancy'], rows: per.map((p, i) => [label(p), model.schedule.moveIns[i], model.schedule.moveOuts[i], Math.round(c.occRaw[i] * 10) / 10, c.units ? `${(c.occRaw[i] / c.units * 100).toFixed(1)}%` : ''])});
  if (model.positions?.length) out.push({name: 'Payroll positions', head: ['Position', 'GL', 'Headcount', 'Annual salary', 'Raise %', 'Budget'], rows: model.positions.filter(p => Number(p.count)).map(p => [p.title, p.gl, Number(p.count), Number(p.salary), Number(p.raisePct || 0), r2(sum(E.positionMonthly(p)))])});
  const a = model.assumptions || {};
  if (c?.mix) out.push({name: 'Rate mix', head: ['Type', 'Sites', 'Monthly rent', 'GPR / year'], rows: c.mix.map(r => [r.label, r.units, r2(r.rent), r2(r.gprM * 12)]).concat([['Total', sum(c.mix.map(r => r.units)), r2(c.rent), r2(c.gprM * 12)]])});
  out.push({name: 'Assumptions', head: ['Driver', 'Value'], rows: [['Market rent ($/mo)', a.marketRent], ['Rent growth %', a.rentGrowth], ['Loss to lease % GPR', a.ltlPct], ['Concessions % GPR', a.concessionPct], ['Bad debt % GPR', a.badDebtPct], ['Management fee % income', a.mgmtPct], ['Inflation %', a.inflation],
    ['Electric rate change %', a.electric], ['Water rate change %', a.water], ['Sewer rate change %', a.sewer], ['Reserves $/unit/yr', a.reservePerUnit]].filter(r => r[1] !== undefined && r[1] !== null)});
  if (result.str) {
    const X = result.str;
    out.push({name: 'STR programme', head: ['Floor plan', 'STR units', 'ADR', 'Occupancy', 'Revenue', 'STR operating NOI', 'Long-term income given up'], rows: X.plans.map(p => [p.type, p.strUnits, r2(p.annual.adr), `${(p.annual.occ * 100).toFixed(1)}%`, r2(p.annual.revenue), r2(p.annual.noi), r2(p.annual.displacedLt)])
      .concat([['Programme', '', r2(X.annual.adr), `${(X.annual.occ * 100).toFixed(1)}%`, r2(X.annual.revenue), r2(X.annual.noi), r2(X.annual.displaced)], ['Effect on property NOI', '', '', '', '', r2(X.impact.totals.noi), '']])});
  }
  return out;
}

/* Company budget → report. */
export function companyReport({model, result, budget, statusLabel}) {
  const T = result.totals.annual, P = result.totals.prior;
  const isDraft = budget?.status !== 'approved_locked' || !!budget?.revised_after_approval;
  const sections = sectionsOf(result.rows, C.ALL_SECTIONS, r => model.notes?.[r.line.gl] ?? r.line.note);
  const inc = sections.filter(s => C.INCOME_SECTIONS.includes(s.name)), ctl = sections.filter(s => !C.INCOME_SECTIONS.includes(s.name) && !C.NONCONTROLLABLE_SECTIONS.includes(s.name)), non = sections.filter(s => C.NONCONTROLLABLE_SECTIONS.includes(s.name));
  const add = list => { const o = zeros(); list.forEach(s => s.monthly.forEach((v, m) => { o[m] = sum([o[m], v]); })); return o; };
  const incM = add(inc), ctlM = add(ctl), nonM = add(non), ccf = incM.map((v, m) => sub(v, ctlM[m]));
  return {kind: 'company', title: budget?.name || `${model.entity} FY${model.fiscalYear} Budget`, entity: model.entity, subtitle: `${model.entity} · ${label(model.periods[0])} – ${label(model.periods[11])}${budget?.plan_type === 'reforecast' ? ' · Reforecast' : ''}`,
    status: statusLabel || (isDraft ? 'Draft' : 'Approved'), isDraft, periods: model.periods, compareLabel: 'Prior budget',
    summary: [['Total income', T.income, P.income], ['Controllable expenses', T.controllable, P.controllable], ['Controllable cash flow', T.controllableCashFlow, P.controllableCashFlow], ['Taxes & insurance', T.taxesInsurance, P.taxesInsurance], ['Net operating income', T.noi, P.noi]],
    kpis: [], groups: result.groups.map(g => [g.name, g.final, g.prior]),
    blocks: [{title: 'Income', sections: inc, total: totalRow('Total income', incM, 'sub', T.income)}, {title: 'Controllable expenses', sections: ctl, total: totalRow('Total controllable expenses', ctlM, 'sub')},
      {title: null, sections: [], total: totalRow('Controllable cash flow', ccf)}, {title: 'Non-controllable', sections: non, total: totalRow('Net operating income', ccf.map((v, m) => sub(v, nonM[m])))}],
    extra: [{name: 'Fee income', head: ['GL', 'Property', 'Method', 'Source', 'Annual'], rows: result.fees.map(f => [f.gl, f.name, f.mode, f.mode === 'linked' ? (f.source?.kind || 'not available') : '', f.annual])},
      {name: 'Payroll positions', head: ['Position', 'Department', 'Headcount', 'Annual salary', 'Raise %', 'Budget'], rows: (model.positions || []).filter(p => Number(p.count)).map(p => [p.title, p.department || '', Number(p.count), Number(p.salary), Number(p.raisePct || 0), r2(sum(E.positionMonthly(p)))])}]};
}

/* ---------------- Excel ---------------- */
export function reportWorkbook(rep, XLSX, {generatedAt = new Date()} = {}) {
  const wb = XLSX.utils.book_new(), money = '#,##0;(#,##0);-';
  const banner = [[rep.title], [rep.subtitle], [`Status: ${rep.status}${rep.isDraft ? ' — ' + DRAFT_TEXT : ''}`], [`Generated ${generatedAt.toLocaleString('en-US')}`], []];
  const fmt = (ws, fromRow, cols) => { const ref = XLSX.utils.decode_range(ws['!ref']); for (let R = fromRow; R <= ref.e.r; R++) for (const Cc of cols) { const a = XLSX.utils.encode_cell({r: R, c: Cc}); if (ws[a]?.t === 'n') ws[a].z = money; } };
  // Summary
  const sumHead = rep.kind === 'company' ? ['', 'Budget', 'Prior budget'] : ['', 'Budget'];
  const sumAoa = [...banner, sumHead, ...rep.summary.map(r => r.slice(0, sumHead.length)), [], ...(rep.kpis.length ? [['Key figures'], ...rep.kpis, []] : []),
    ['Category', 'Budget', rep.kind === 'company' ? 'Prior budget' : 'Per unit'], ...rep.groups];
  const s1 = XLSX.utils.aoa_to_sheet(sumAoa); s1['!cols'] = [{wch: 38}, {wch: 16}, {wch: 16}]; fmt(s1, banner.length, [1, 2]);
  XLSX.utils.book_append_sheet(wb, s1, 'Summary');
  // GL × month
  const head = ['GL', 'Account', ...rep.periods.map(label), 'Total', ...(rep.compareLabel ? [rep.compareLabel] : []), 'Note'];
  const aoa = [...banner, head];
  for (const b of rep.blocks) {
    if (b.title) aoa.push([b.title.toUpperCase()]);
    for (const s of b.sections) {
      aoa.push(['', s.name]);
      for (const l of s.lines) aoa.push([l.gl, l.name, ...l.monthly, l.total, ...(rep.compareLabel ? [l.compare ?? ''] : []), l.note]);
      aoa.push(['', 'Total ' + s.name, ...s.monthly, s.total]);
    }
    aoa.push(['', b.total.label, ...b.total.monthly, b.total.total]); aoa.push([]);
  }
  const s2 = XLSX.utils.aoa_to_sheet(aoa);
  s2['!cols'] = [{wch: 7}, {wch: 36}, ...rep.periods.map(() => ({wch: 11})), {wch: 13}, ...(rep.compareLabel ? [{wch: 13}] : []), {wch: 50}];
  fmt(s2, banner.length + 1, Array.from({length: 13 + (rep.compareLabel ? 1 : 0)}, (_, i) => i + 2));
  XLSX.utils.book_append_sheet(wb, s2, 'Budget by month');
  for (const x of rep.extra) {
    if (!x.rows.length) continue;
    const ws = XLSX.utils.aoa_to_sheet([...banner, x.head, ...x.rows]);
    ws['!cols'] = x.head.map((h, i) => ({wch: i === 0 ? 30 : 16}));
    fmt(ws, banner.length + 1, x.head.map((_, i) => i).slice(1));
    XLSX.utils.book_append_sheet(wb, ws, x.name.slice(0, 31));
  }
  return XLSX.write(wb, {type: 'array', bookType: 'xlsx'});
}

/* ---------------- PDF ---------------- */
const ascii = s => String(s ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-').replace(/→/g, '>').replace(/[^\x20-\x7E]/g, '');
const fmtMoney = n => { if (n == null || !Number.isFinite(Number(n))) return 'Unavailable'; const v = Math.round(Number(n) || 0); if (!v) return '-'; const s = Math.abs(v).toLocaleString('en-US'); return v < 0 ? `(${s})` : s; };
const fmtDollar = n => { if (n == null || !Number.isFinite(Number(n))) return 'Unavailable'; const v = Math.round(Number(n) || 0); const s = '$' + Math.abs(v).toLocaleString('en-US'); return v < 0 ? `(${s})` : s; };

export async function reportPdf(rep, {PDFLib, logoPng = null, generatedAt = new Date()}) {
  const {PDFDocument, StandardFonts, rgb} = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(ascii(rep.title)); doc.setAuthor('RISE Residential, LLC');
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = logoPng ? await doc.embedPng(logoPng).catch(() => null) : null;
  const NAVY = rgb(1 / 255, 62 / 255, 81 / 255), LIGHT = rgb(107 / 255, 162 / 255, 184 / 255), INK = rgb(0.11, 0.17, 0.2), MUTED = rgb(0.38, 0.45, 0.48), BAND = rgb(0.9, 0.94, 0.95), WARN = rgb(0.69, 0.33, 0.04), WARNBG = rgb(1, 0.95, 0.88);
  const W = 792, Hh = 612, M = 28;
  const pages = [];
  let page, y;
  const right = (t, x, yy, f = font, size = 7, color = INK) => page.drawText(ascii(t), {x: x - f.widthOfTextAtSize(ascii(t), size), y: yy, size, font: f, color});
  const left = (t, x, yy, f = font, size = 7, color = INK, max = 0) => { let s = ascii(t); if (max) while (s.length > 1 && f.widthOfTextAtSize(s, size) > max) s = s.slice(0, -2) + '.'; page.drawText(s, {x, y: yy, size, font: f, color}); };
  const newPage = heading => {
    page = doc.addPage([W, Hh]); pages.push(page); y = Hh - M;
    if (logo) { const w = 56, h = logo.height * w / logo.width; page.drawImage(logo, {x: M, y: y - h + 4, width: w, height: h}); }
    left(rep.title, M + (logo ? 66 : 0), y - 6, bold, 12, NAVY); left(rep.subtitle, M + (logo ? 66 : 0), y - 19, font, 8, MUTED);
    right(rep.status, W - M, y - 6, bold, 9, rep.isDraft ? WARN : NAVY);
    y -= 30; page.drawRectangle({x: M, y, width: W - 2 * M, height: 2, color: NAVY}); y -= 6;
    if (rep.isDraft) { page.drawRectangle({x: M, y: y - 14, width: W - 2 * M, height: 14, color: WARNBG}); left(DRAFT_TEXT, M + 6, y - 10, bold, 8, WARN); y -= 20; }
    if (heading) { left(heading, M, y - 10, bold, 10, NAVY); y -= 28; }
  };
  // Page 1: summary
  newPage('Summary');
  let gy = y;
  const cols1 = rep.kind === 'company' ? ['Budget', 'Prior budget'] : ['Budget'];
  page.drawRectangle({x: M, y: y - 4, width: 360, height: 14, color: NAVY});
  left('', M + 4, y, bold, 8, rgb(1, 1, 1)); cols1.forEach((c, i) => right(c, M + 250 + i * 100, y, bold, 8, rgb(1, 1, 1))); y -= 16;
  for (const r of rep.summary) { const strong = /net operating|cash flow/i.test(r[0]); if (strong) page.drawRectangle({x: M, y: y - 4, width: 360, height: 13, color: BAND}); left(r[0], M + 4, y, strong ? bold : font, 8.5); cols1.forEach((_, i) => right(fmtDollar(r[i + 1]), M + 250 + i * 100, y, strong ? bold : font, 8.5)); y -= 14; }
  if (rep.kpis.length) { y -= 6; for (const [k, v] of rep.kpis) { left(k, M + 4, y, font, 8.5, MUTED); right(v, M + 250, y, font, 8.5); y -= 13; } }
  const gx = 430;
  page.drawRectangle({x: gx, y: gy - 4, width: W - M - gx, height: 14, color: NAVY});
  left('Expense category', gx + 4, gy, bold, 8, rgb(1, 1, 1)); right('Budget', gx + 230, gy, bold, 8, rgb(1, 1, 1)); right(rep.kind === 'company' ? 'Prior budget' : 'Per unit', W - M - 4, gy, bold, 8, rgb(1, 1, 1)); gy -= 16;
  for (const g of rep.groups) { left(g[0], gx + 4, gy, font, 8.5); right(fmtDollar(g[1]), gx + 230, gy, font, 8.5); right(fmtDollar(g[2]), W - M - 4, gy, font, 8.5); gy -= 13; }
  // GL × month pages
  const hasCmp = !!rep.compareLabel;
  const xs = {gl: M, name: M + 30, m0: M + 190, mw: 39.5}, totalX = xs.m0 + 12 * xs.mw + 44, cmpX = totalX + 46;
  const head = () => { page.drawRectangle({x: M, y: y - 4, width: W - 2 * M, height: 13, color: NAVY}); const wht = rgb(1, 1, 1); left('GL', xs.gl + 2, y, bold, 7, wht); left('Account', xs.name, y, bold, 7, wht); rep.periods.forEach((p, i) => right(label(p), xs.m0 + (i + 1) * xs.mw, y, bold, 7, wht)); right('Total', totalX, y, bold, 7, wht); if (hasCmp) right(rep.compareLabel, cmpX, y, bold, 6.5, wht); y -= 14; };
  const need = n => { if (y - n < M + 18) { newPage('Budget by month (continued)'); head(); } };
  newPage('Budget by month'); head();
  const line = (gl, name, monthly, total, cmp, style) => {
    need(11);
    const f = style ? bold : font;
    if (style === 'sub') page.drawRectangle({x: M, y: y - 3, width: W - 2 * M, height: 11, color: BAND});
    if (style === 'tot') page.drawRectangle({x: M, y: y - 3, width: W - 2 * M, height: 11, color: rgb(0.83, 0.9, 0.93)});
    left(gl, xs.gl + 2, y, f, 6.5); left(name, xs.name, y, f, 6.5, INK, 155);
    monthly.forEach((v, i) => right(fmtMoney(v), xs.m0 + (i + 1) * xs.mw, y, f, 6.5)); right(fmtMoney(total), totalX, y, bold, 6.5);
    if (hasCmp && cmp !== null && cmp !== undefined && cmp !== '') right(fmtMoney(cmp), cmpX, y, f, 6.5, MUTED);
    y -= 10.5;
  };
  for (const b of rep.blocks) {
    if (b.title) { need(26); y -= 3; left(b.title.toUpperCase(), M, y, bold, 7.5, NAVY); y -= 11; }
    for (const s of b.sections) {
      need(24); left(s.name, xs.name, y, bold, 7, LIGHT); y -= 10;
      for (const l of s.lines) line(l.gl, l.name, l.monthly, l.total, l.compare, null);
      line('', 'Total ' + s.name, s.monthly, s.total, null, 'sub');
    }
    line('', b.total.label, b.total.monthly, b.total.total, null, b.total.cls); y -= 4;
  }
  // Notes
  const notes = rep.blocks.flatMap(b => b.sections.flatMap(s => s.lines.filter(l => String(l.note).trim()).map(l => l)));
  if (notes.length) {
    newPage('Line notes');
    for (const n of notes) {
      const words = ascii(n.note).split(/\s+/), lines = []; let cur = '';
      for (const w of words) { const t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, 8) > W - 2 * M - 210 && cur) { lines.push(cur); cur = w; } else cur = t; }
      if (cur) lines.push(cur);
      if (y - lines.length * 11 < M + 18) newPage('Line notes (continued)');
      left(n.gl, M, y, bold, 8, NAVY); left(n.name, M + 34, y, bold, 8, INK, 165);
      lines.forEach(l => { left(l, M + 210, y, font, 8); y -= 11; }); y -= 4;
    }
  }
  // Footer on every page
  pages.forEach((p, i) => { page = p; left(`${rep.isDraft ? 'DRAFT - ' : ''}Generated ${generatedAt.toLocaleString('en-US')} - RISE Residential, LLC`, M, 14, font, 7, MUTED); right(`Page ${i + 1} of ${pages.length}`, W - M, 14, font, 7, MUTED); });
  return doc.save();
}

/* Browser download helper. */
export function download(bytes, fileName, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], {type}));
  a.download = fileName.replace(/[\\/:*?"<>|]+/g, '-');
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
