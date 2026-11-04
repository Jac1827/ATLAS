/* Budget Builder v2 — investor package (cover page + summary + commentary).
 * Rendered from the VP-locked summary only. Works in the browser (vendor pdf-lib)
 * and in the Worker (npm pdf-lib); the caller passes the PDFLib namespace and logo. */

const NAVY = [1 / 255, 62 / 255, 81 / 255], LIGHT = [107 / 255, 162 / 255, 184 / 255], INK = [0.11, 0.17, 0.2], MUTED = [0.31, 0.38, 0.41], BAND = [0.89, 0.93, 0.95];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const money = n => { if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—'; const r = Math.round(Number(n)); const s = '$' + Math.abs(r).toLocaleString('en-US'); return r < 0 ? `(${s})` : s; };
export const change = (a, b) => (b ? `${a - b >= 0 ? '+' : ''}${(((a - b) / Math.abs(b)) * 100).toFixed(1)}%` : '—');

/* The locked summary saved with VP approval. */
export function investorSummary({community, units, unitLabel, fiscalYear, periodLabel, assetClass, result, assumptions, notes, approvals, address = '10161 Centurion Parkway, Suite 200, Jacksonville, FL'}) {
  const T = result.totals;
  const row = (name, k, cls = '') => ({name, t12: T.t12[k], final: T.annual[k], perUnit: units ? T.annual[k] / units : null, cls});
  return {schema: 'atlas.budget-investor-summary.v1', community, units, unitLabel, fiscalYear, periodLabel, assetClass, address,
    rows: [row('Total income', 'income'), row('Operating expenses', 'opex'), row('Net operating income', 'noi', 'sub'), row('Replacement reserves', 'reserves'), row('Capital expenditures', 'capex'), row('Cash flow after reserves & capex', 'cashFlow', 'tot')],
    groups: result.groups.map(g => ({name: g.name, t12: g.t12, final: g.final, perUnit: g.perUnit})),
    memo: result.memo, assumptions, notes, approvals, generatedAt: new Date().toISOString()};
}

export function investorHtml(s) {
  const rows = s.rows.map(r => `<tr style="${r.cls ? 'font-weight:700;background:#e3eef2' : ''}"><td style="padding:6px 10px">${esc(r.name)}</td><td style="padding:6px 10px;text-align:right">${money(r.t12)}</td><td style="padding:6px 10px;text-align:right">${money(r.final)}</td><td style="padding:6px 10px;text-align:right">${change(r.final, r.t12)}</td><td style="padding:6px 10px;text-align:right">${money(r.perUnit)}</td></tr>`).join('');
  const notes = (s.notes || []).map(n => `<li><b>${esc(n.gl)} ${esc(n.name)}</b> — ${esc(n.note)}</li>`).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1b2b33;max-width:720px">
<div style="border-bottom:4px solid #013e51;padding-bottom:10px"><div style="font-size:22px;font-weight:800;color:#013e51">${esc(s.community)}</div><div style="color:#6ba2b8;font-weight:700">FY${esc(s.fiscalYear)} Operating Budget · ${esc(s.periodLabel)}</div></div>
<p style="color:#4f6169">${esc(s.units)} ${esc(s.unitLabel)}s · Approved by RISE Residential (${(s.approvals || []).map(a => esc(a.role)).join(' → ')}). The full package is attached as a PDF.</p>
<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="background:#013e51;color:#fff"><th style="padding:6px 10px;text-align:left">Line</th><th style="padding:6px 10px;text-align:right">T12 actual</th><th style="padding:6px 10px;text-align:right">FY${esc(s.fiscalYear)} budget</th><th style="padding:6px 10px;text-align:right">Change</th><th style="padding:6px 10px;text-align:right">Per ${esc(s.unitLabel)}</th></tr></thead><tbody>${rows}</tbody></table>
${s.memo ? `<p style="color:#4f6169">${esc(s.memo.label)}: ${money(s.memo.annual)}</p>` : ''}
${notes ? `<h3 style="color:#013e51;font-size:15px">Regional commentary</h3><ul>${notes}</ul>` : ''}
<p style="color:#4f6169;font-size:12px">RISE Residential, LLC · ${esc(s.address)}</p></div>`;
}

function wrap(text, font, size, width) {
  const words = String(text ?? '').split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > width && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}
const ascii = s => String(s ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-').replace(/→/g, '>').replace(/[^\x20-\x7E]/g, '');

export async function investorPdf(s, {PDFLib, logoPng}) {
  const {PDFDocument, StandardFonts, rgb} = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`${s.community} FY${s.fiscalYear} Operating Budget`); doc.setAuthor('RISE Residential, LLC');
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const C = c => rgb(c[0], c[1], c[2]);
  const logo = logoPng ? await doc.embedPng(logoPng) : null;
  // Cover
  let page = doc.addPage([612, 792]);
  if (logo) { const w = 180, h = logo.height * w / logo.width; page.drawImage(logo, {x: 64, y: 650 - h, width: w, height: h}); }
  page.drawRectangle({x: 64, y: 536, width: 484, height: 6, color: C(NAVY)});
  page.drawText(ascii(s.community), {x: 64, y: 494, size: 28, font: bold, color: C(NAVY)});
  page.drawText(ascii(`FY${s.fiscalYear} Operating Budget - ${s.periodLabel}`), {x: 64, y: 467, size: 15, font: bold, color: C(LIGHT)});
  page.drawText(ascii(`${s.units} ${s.unitLabel}s - ${s.assetClass}`), {x: 64, y: 434, size: 11, font, color: C(MUTED)});
  page.drawText(ascii(`Prepared by RISE Residential, LLC - ${s.address}`), {x: 64, y: 418, size: 11, font, color: C(MUTED)});
  let y = 376;
  page.drawText('Approvals', {x: 64, y, size: 12, font: bold, color: C(NAVY)}); y -= 18;
  for (const a of s.approvals || []) { page.drawText(ascii(`${a.role}: ${a.name || 'Approved'} - ${a.at ? new Date(a.at).toLocaleDateString('en-US') : ''}`), {x: 64, y, size: 10.5, font, color: C(INK)}); y -= 15; }
  page.drawRectangle({x: 64, y: 72, width: 484, height: 2, color: C(LIGHT)});
  page.drawText(ascii(`Generated ${new Date(s.generatedAt).toLocaleDateString('en-US')}`), {x: 64, y: 56, size: 9, font, color: C(MUTED)});
  // Summary
  page = doc.addPage([612, 792]); y = 740;
  const header = t => { page.drawText(ascii(t), {x: 48, y, size: 14, font: bold, color: C(NAVY)}); y -= 22; };
  const newPageIfNeeded = need => { if (y - need < 60) { page = doc.addPage([612, 792]); y = 740; } };
  header('Budget summary');
  const cols = [48, 300, 390, 470, 548], heads = ['Line', 'T12 actual', 'Budget', 'Change', `Per ${s.unitLabel}`];
  page.drawRectangle({x: 44, y: y - 4, width: 520, height: 18, color: C(NAVY)});
  heads.forEach((h, i) => { const w = bold.widthOfTextAtSize(h, 9.5); page.drawText(h, {x: i ? cols[i] - w : cols[0], y, size: 9.5, font: bold, color: rgb(1, 1, 1)}); }); y -= 20;
  const line = (r, strong) => {
    if (strong) page.drawRectangle({x: 44, y: y - 4, width: 520, height: 16, color: C(BAND)});
    const f = strong ? bold : font, vals = [ascii(r.name), money(r.t12), money(r.final), change(r.final, r.t12), money(r.perUnit)];
    vals.forEach((v, i) => { const w = f.widthOfTextAtSize(ascii(v), 9.5); page.drawText(ascii(v), {x: i ? cols[i] - w : cols[0], y, size: 9.5, font: f, color: C(INK)}); }); y -= 17;
  };
  s.rows.forEach(r => line(r, !!r.cls)); y -= 10;
  header('Operating expenses by category');
  s.groups.forEach(g => line(g, false)); y -= 10;
  if (s.memo) { page.drawText(ascii(`${s.memo.label}: ${money(s.memo.annual)}`), {x: 48, y, size: 10, font, color: C(MUTED)}); y -= 20; }
  newPageIfNeeded(80); header('Key assumptions');
  for (const a of s.assumptions || []) for (const l of wrap(ascii(a), font, 10, 500)) { newPageIfNeeded(14); page.drawText(l, {x: 56, y, size: 10, font, color: C(INK)}); y -= 14; }
  y -= 8;
  if ((s.notes || []).length) {
    newPageIfNeeded(60); header('Regional commentary');
    for (const n of s.notes) {
      const head = ascii(`${n.gl} ${n.name}`), lines = wrap(ascii(n.note), font, 10, 490);
      newPageIfNeeded(lines.length * 14 + 20);
      page.drawText(head, {x: 56, y, size: 10, font: bold, color: C(NAVY)}); y -= 14;
      lines.forEach(l => { page.drawText(l, {x: 64, y, size: 10, font, color: C(INK)}); y -= 14; }); y -= 4;
    }
  }
  return doc.save();
}
