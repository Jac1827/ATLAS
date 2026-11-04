/* Budget Builder v2 — user interface. Mounted in the ATLAS Budget tab (iframe). */
import * as E from './engine.mjs';
import * as I from './importers.mjs';
import * as Lr from './learning.mjs';
import * as H from './handoff.mjs';
import * as S from './store.mjs';
import {investorSummary, investorHtml, investorPdf, money as moneyFmt} from './investor-package.mjs';
import {parseReforecastWorkbook} from '../reforecast-intake.mjs';
import {planningMappingDispositions} from '../planning-governance.mjs';

const $app = document.getElementById('bb-app'), $ctx = document.getElementById('bb-context'), $status = document.getElementById('bb-status');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TABS = [['setup', 'Setup'], ['leasing', 'Leasing schedule'], ['income', 'Income'], ['expenses', 'Expenses'], ['payroll', 'Payroll'], ['drivers', 'Drivers & documents'], ['summary', 'Summary & approval'], ['investor', 'Investor package']];
const STATUS = {gm_draft: ['Draft · GM', ''], regional_review: ['In review · Regional', 'warn'], vp_review: ['Awaiting VP', 'warn'], approved_locked: ['Approved · Locked', 'lock'], sent_to_investors: ['Sent to investors', 'lock'], archived: ['Archived', '']};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = n => moneyFmt(n);
const pct = (a, b) => (b ? `${a - b >= 0 ? '+' : ''}${(((a - b) / Math.abs(b)) * 100).toFixed(1)}%` : '—');
const num = E.num;

const s = {central: null, me: null, communities: [], cid: '', drafts: [], draft: null, model: null, result: null, tab: 'setup', open: {}, openGL: {}, sources: [], documents: [], dirty: false,
  benchmarks: {}, decisions: [], events: [], checks: [], vpReason: '', busy: false, recipients: '', newDraft: {year: new Date().getFullYear() + 1, planType: 'budget', assetClass: 'conventional'}};

function status(msg, err = false, ms = 4000) {
  $status.hidden = !msg; $status.textContent = msg || ''; $status.className = 'status' + (err ? ' err' : '');
  clearTimeout(status.t); if (msg && ms) status.t = setTimeout(() => { $status.hidden = true; }, ms);
}
const roleOf = () => s.me?.role || '';
const isVp = () => ['executive', 'vp', 'vice_president'].includes(roleOf());
const isRegional = () => isVp() || ['regional', 'admin'].includes(roleOf());
const draftStatus = () => s.draft?.status || 'gm_draft';
function canEdit() {
  const st = draftStatus();
  if (!s.model) return false;
  if (st === 'gm_draft') return true;
  if (st === 'regional_review') return isRegional();
  if (st === 'vp_review') return isVp();
  if (st === 'approved_locked' || st === 'sent_to_investors') return isVp() && s.vpEditing;
  return false;
}
const dis = () => (canEdit() ? '' : 'disabled');

function recalc() {
  if (!s.model) { s.result = null; return; }
  s.result = E.calculate(s.model);
  s.checks = Lr.modelChecks(s.model, s.result);
}
function mark() { s.dirty = true; recalc(); render(); scheduleSave(); }

/* ---------------- boot ---------------- */
/* Month-end close, reforecast review, STR and report tools remain in the classic
 * Budget Builder; requests for those views are forwarded there unchanged. */
const classicUrl = (search = location.search) => new URL('../../RISE-Budget-Builder.html' + search, import.meta.url).href;
async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('atlasView') || params.get('investorReader') === '1') { location.replace(classicUrl()); return; }
  s.central = window.parent?.ATLAS_CENTRAL || window.ATLAS_CENTRAL;
  if (!s.central?.getSession?.()?.user) { $app.innerHTML = '<div class="card"><p class="h2">Sign in to ATLAS</p><p class="muted">Budget Builder uses your ATLAS account and community access.</p></div>'; return; }
  s.me = S.profile(s.central);
  try { s.communities = await S.communities(s.central); } catch (e) { $app.innerHTML = `<div class="card">Communities unavailable: ${esc(e.message)}</div>`; return; }
  s.cid = s.communities[0]?.id || '';
  try { s.benchmarks = await S.benchmarks(s.central) || {}; } catch { s.benchmarks = {}; }
  try { const d = await S.decisions(s.central, s.communities.map(c => c.id)); s.decisions = (d || []).map(r => ({gl: r.gl_code, model: r.basis?.model, final: r.value})); } catch { s.decisions = []; }
  await loadDrafts();
  render();
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || e.data?.type !== 'atlas-reforecast-navigate') return;
    if (s.dirty && !confirm('Leave Budget Builder with unsaved changes?')) return;
    s.dirty = false; location.replace(classicUrl('?atlasView=' + encodeURIComponent(e.data.view || 'reforecastapprovals')));
  });
}

async function loadDrafts() {
  s.drafts = s.cid ? await S.listDrafts(s.central, s.cid).catch(() => []) : [];
}

async function openDraft(id) {
  const row = await S.readDraft(s.central, id);
  s.draft = row; s.model = row.payload.model; s.documents = row.payload.documents || []; s.sourcesSummary = row.payload.sources || [];
  s.vpEditing = false; s.dirty = false; s.tab = s.model ? 'summary' : 'setup';
  if (s.model) s.model.learned = Lr.calibrate(s.decisions);
  s.events = await S.readEvents(s.central, id).catch(() => []);
  recalc(); render();
}

function newDraft() {
  const c = s.communities.find(x => x.id === s.cid);
  s.draft = {draft_id: S.uuid(), revision: 0, status: 'gm_draft', community_id: s.cid, fiscal_year: num(s.newDraft.year), plan_type: s.newDraft.planType, asset_class: s.newDraft.assetClass, name: `${c?.name || 'Community'} FY${s.newDraft.year} ${s.newDraft.planType === 'reforecast' ? 'Reforecast' : 'Budget'}`};
  s.model = null; s.result = null; s.sources = []; s.documents = []; s.events = []; s.tab = 'setup'; s.dirty = false; render();
}

/* ---------------- saving ---------------- */
let saveTimer;
function scheduleSave() { clearTimeout(saveTimer); if (canEdit() && !['approved_locked', 'sent_to_investors'].includes(draftStatus())) saveTimer = setTimeout(() => save().catch(() => {}), 12000); }
async function save({reason = null} = {}) {
  if (!s.model || !s.draft || s.busy) return;
  const locked = ['approved_locked', 'sent_to_investors'].includes(draftStatus());
  if (locked && (s.vpReason || '').trim().length < 3) { status('Enter a reason for the VP edit before saving.', true); return; }
  s.busy = true;
  try {
    const row = await S.saveDraft(s.central, {draftId: s.draft.draft_id, communityId: s.draft.community_id, expectedRevision: s.draft.revision,
      meta: {fiscalYear: s.draft.fiscal_year, planType: s.draft.plan_type, assetClass: s.model.property.assetClass, name: s.draft.name},
      payload: {model: s.model, documents: s.documents, sources: s.sourcesSummary || []}, reason: locked ? s.vpReason : reason});
    s.draft = row; s.dirty = false; status('Saved · revision ' + row.revision);
    s.events = await S.readEvents(s.central, row.draft_id).catch(() => s.events);
    await loadDrafts();
  } catch (e) { status(e.message, true, 8000); } finally { s.busy = false; render(); }
}

/* ---------------- imports ---------------- */
function sheetFor(wb, communityName) {
  const norm = t => String(t).toLowerCase().replace(/^rise\s+/, '').replace(/[^a-z0-9]/g, '');
  const target = norm(communityName);
  return wb.SheetNames.find(n => norm(n) === target) || wb.SheetNames.find(n => norm(n).includes(target) || target.includes(norm(n))) || wb.SheetNames.find(n => !/parameter/i.test(n)) || wb.SheetNames[0];
}
async function readFile(file) {
  const c = s.communities.find(x => x.id === s.draft.community_id);
  const buf = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
    const wb = window.XLSX.read(buf, {type: 'array', cellDates: false});
    const first = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, defval: '', raw: true});
    const kind = I.detectReport(wb.SheetNames, first);
    const sheet = ['t12', 'boxscore', 'trending'].includes(kind) ? sheetFor(wb, c?.name || '') : (kind === 'conservice' ? 'Report' : kind === 'import_sheet' ? 'Import Sheet' : wb.SheetNames[0]);
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sheet] || wb.Sheets[wb.SheetNames[0]], {header: 1, defval: '', raw: true});
    const parsed = kind === 't12' ? I.parseT12Sheet(rows) : kind === 'boxscore' ? I.parseBoxScore(rows) : kind === 'trending' ? I.parseTrending(rows) : kind === 'conservice' ? I.parseConservice(rows)
      : kind === 'vena_budget' ? I.parseVenaBudget(rows, {fiscalYear: s.draft.fiscal_year}) : kind === 'import_sheet' ? I.parseImportSheet(rows, {fiscalYear: s.draft.fiscal_year}) : {ok: false, warnings: ['This workbook type is not recognized yet.']};
    return {file: file.name, kind: parsed.kind || kind, sheet, parsed};
  }
  if (name.endsWith('.pdf')) {
    const lib = await import('../../vendor/pdfjs-5.6.205/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs-5.6.205/pdf.worker.min.mjs', import.meta.url).href;
    const doc = await lib.getDocument({data: buf}).promise;
    const lines = [];
    let t12Pages = 0;
    for (let p = 1; p <= Math.min(doc.numPages, 60); p++) {
      const page = await doc.getPage(p), tc = await page.getTextContent(), ls = I.linesFromPdfItems(tc.items);
      if (ls.some(l => /Trailing 12 Month/i.test(l))) t12Pages = 5;
      if (t12Pages > 0) { lines.push(...ls); t12Pages--; } else if (p <= 8 && !lines.length) lines.push(...ls);
    }
    const t12 = I.parseT12Text(lines);
    if (t12.ok && t12.lines.length > 20) return {file: file.name, kind: 't12', parsed: t12};
    return {file: file.name, kind: 'contract', parsed: I.extractContractTerms(lines.join('\n'), {fileName: file.name})};
  }
  if (name.endsWith('.docx')) {
    const zip = await window.JSZip.loadAsync(buf);
    return {file: file.name, kind: 'contract', parsed: I.extractContractTerms(await I.docxText(zip), {fileName: file.name})};
  }
  return {file: file.name, kind: 'unknown', parsed: {ok: false, warnings: ['Use .xlsx, .pdf or .docx files.']}};
}
async function onFiles(files) {
  for (const f of files) {
    status('Reading ' + f.name + '…', false, 0);
    try {
      const r = await readFile(f);
      if (r.kind === 'contract') s.documents.push({id: S.uuid(), file: r.file, ...r.parsed, applied: false});
      else s.sources = s.sources.filter(x => x.kind !== r.kind).concat(r);
    } catch (e) { s.sources.push({file: f.name, kind: 'error', parsed: {ok: false, warnings: [e.message]}}); }
  }
  status('Files read. Review what was found, then build the budget.');
  if (s.model) s.dirty = true;
  render();
}
async function buildFromSources() {
  const pick = k => s.sources.find(x => x.kind === k && x.parsed.ok)?.parsed;
  const c = s.communities.find(x => x.id === s.draft.community_id);
  let startMonth = 1;
  try { const cal = await s.central.fetchJson('/rpc/atlas_read_budget_calendar', {method: 'POST', body: JSON.stringify({p_community_id: s.draft.community_id})}); startMonth = num(cal?.startMonth) || 1; } catch {}
  if (s.draft.asset_class.startsWith('student')) startMonth = startMonth === 1 ? 8 : startMonth;
  const periods = E.fiscalPeriods(s.draft.fiscal_year, startMonth);
  const proposal = pick('vena_budget') || pick('import_sheet');
  const box = pick('boxscore');
  const model = Lr.buildModel({property: {name: c?.name || '', units: c?.units || box?.units, assetClass: s.draft.asset_class}, fiscalYear: s.draft.fiscal_year, startMonth, periods,
    proposal, t12: pick('t12'), box, trending: pick('trending'), conservice: pick('conservice'), start: s.startChoice});
  if (!model.property.units) { status('Unit count unknown — upload a box score or set units in Community Settings.', true, 8000); return; }
  model.learned = Lr.calibrate(s.decisions);
  if (s.draft.plan_type === 'reforecast' && pick('t12')) {
    // Months already in the T12 are closed: they lock to actuals; the rest re-project.
    const t12 = pick('t12'), have = new Set(t12.periods);
    let closed = 0; while (closed < 12 && have.has(periods[closed])) closed++;
    model.closedMonths = closed;
    model.actuals = Object.fromEntries(t12.lines.map(l => [l.gl, periods.map(p => (p in (l.byPeriod || {}) ? l.byPeriod[p] : null))]));
  }
  s.model = model;
  s.sourcesSummary = s.sources.map(x => ({file: x.file, kind: x.kind, sheet: x.sheet || null, ok: !!x.parsed.ok, warnings: x.parsed.warnings || []}));
  recalc();
  // Learning: record per-unit T12 observations for portfolio benchmarks.
  const t12 = pick('t12');
  if (t12 && model.basis) {
    const rows = s.result.groups.map(g => ({source_kind: 't12', metric: 'per_unit', value: Math.round(g.t12 / model.property.units * 100) / 100, basis: {group: g.name, assetClass: model.property.assetClass, units: model.property.units}, period_from: t12.periods[0], period_to: t12.periods.at(-1)}));
    S.recordObservations(s.central, s.draft.community_id, rows).catch(() => {});
  }
  s.tab = 'leasing'; s.dirty = true; render();
  await save({reason: 'Built from uploaded sources'});
}

/* ---------------- workflow ---------------- */
function approvals() {
  const map = {submit_to_regional: 'GM', regional_approve: 'Regional Manager', vp_approve: 'VP'};
  return [...s.events].reverse().filter(e => map[e.action]).map(e => ({role: map[e.action], name: '', at: e.created_at}));
}
function summaryForInvestors() {
  const c = s.communities.find(x => x.id === s.draft.community_id);
  const m = s.model, r = s.result, p = m.periods;
  const notes = Object.values(r.rows).filter(x => m.investorNotes?.[x.line.gl]).map(x => ({gl: x.line.gl, name: x.line.name, note: (m.notes?.[x.line.gl] ?? x.line.note) || ''})).filter(n => n.note);
  const a = m.assumptions;
  const assumptions = [
    `Average market rent ${money(r.context.rent)} (${num(a.rentGrowth) >= 0 ? '+' : ''}${num(a.rentGrowth)}% growth); average occupancy ${(r.kpis.avgOccupancy * 100).toFixed(1)}%.`,
    `${r.kpis.moveIns} move-ins and ${r.kpis.moveOuts} move-outs; concessions ${num(a.concessionPct).toFixed(2)}% and loss to lease ${num(a.ltlPct).toFixed(2)}% of GPR.`,
    `Utilities: electric +${num(a.electric).toFixed(1)}%, water +${num(a.water).toFixed(1)}%, sewer +${num(a.sewer).toFixed(1)}% (blended water/sewer +${r.context.WS.toFixed(1)}%).`,
    `Management fee ${num(a.mgmtPct).toFixed(2)}% of total income; replacement reserves ${money(a.reservePerUnit)} per ${Lr.unitLabel(m)}.`];
  return investorSummary({community: c?.name || m.property.name, units: m.property.units, unitLabel: Lr.unitLabel(m), fiscalYear: s.draft.fiscal_year,
    periodLabel: `${MON[num(p[0].slice(5)) - 1]} ${p[0].slice(0, 4)} – ${MON[num(p[11].slice(5)) - 1]} ${p[11].slice(0, 4)}`, assetClass: E.ASSET_CLASSES[m.property.assetClass]?.label, result: r, assumptions, notes,
    approvals: [...approvals(), {role: 'VP', name: s.me?.name || '', at: new Date().toISOString()}].filter((x, i, arr) => arr.findIndex(y => y.role === x.role) === i)});
}
async function act(action, {reason = null} = {}) {
  if (s.dirty) await save();
  try {
    if (['regional_return', 'vp_return'].includes(action) && (!reason || reason.trim().length < 3)) { reason = prompt('Reason for returning this budget:') || ''; if (reason.trim().length < 3) return; }
    if (action === 'submit_to_regional') {
      const flags = E.noteFlags(s.result, s.model.notes);
      if (flags.length && !confirm(`${flags.length} line(s) vary more than ±10% and $1,000 from T12 without a note. Submit anyway?`)) return;
      const dec = Object.values(s.result.rows).filter(r => r.modelAnnual).map(r => ({source_kind: 'decision', gl_code: r.line.gl, metric: 'final_vs_model', value: Math.round(r.annual * 100) / 100, basis: {model: r.modelAnnual}}));
      S.recordObservations(s.central, s.draft.community_id, dec).catch(() => {});
    }
    if (action === 'vp_approve') return vpApprove();
    s.draft = await S.transition(s.central, {draftId: s.draft.draft_id, expectedRevision: s.draft.revision, action, reason});
    s.events = await S.readEvents(s.central, s.draft.draft_id).catch(() => s.events);
    status('Status: ' + STATUS[s.draft.status][0]); await loadDrafts(); render();
  } catch (e) { status(e.message, true, 9000); }
}
async function vpApprove() {
  const flags = E.noteFlags(s.result, s.model.notes);
  if (!confirm(`Approve and lock ${s.draft.name}? This publishes the budget to ATLAS (Financial Position, Bonus, Community Command and exports).${flags.length ? `\n\n${flags.length} line(s) still have no variance note.` : ''}`)) return;
  s.busy = true; render();
  try {
    const baseline = s.draft.publication_id ? (await S.approvedBaseline(s.central, s.draft.community_id, Number(s.model.periods[0].slice(0, 4)))).map(r => r.version_id) : [];
    const published = await H.governedPublish({api: S.governedApi(s.central), XLSX: window.XLSX, parseWorkbook: parseReforecastWorkbook, dispositions: planningMappingDispositions, uuid: S.uuid,
      result: s.result, communityId: s.draft.community_id, draftId: s.draft.draft_id, actorId: s.me.userId, periods: s.model.periods,
      calendar: {basis: s.model.startMonth === 1 ? 'calendar' : 'fiscal', startMonth: s.model.startMonth}, name: s.draft.name + (baseline.length ? ' (VP revision)' : ''),
      model: E.ASSET_CLASSES[s.model.property.assetClass]?.model || 'conventional', baselineVersionIds: baseline, onStep: m => status(m + '…', false, 0)});
    s.draft = await S.transition(s.central, {draftId: s.draft.draft_id, expectedRevision: s.draft.revision, action: 'vp_approve', detail: {publicationId: published.publication.publication_id, scenarioId: published.scenarioId, summary: summaryForInvestors()}});
    const obs = Lr.observationsFromResult(s.result, {communityId: s.draft.community_id, sourceKind: 'approved_budget', periodFrom: s.model.periods[0], periodTo: s.model.periods[11], assetClass: s.model.property.assetClass});
    S.recordObservations(s.central, s.draft.community_id, obs.map(({community_id, ...o}) => o)).catch(() => {});
    s.vpEditing = false; s.vpReason = '';
    s.events = await S.readEvents(s.central, s.draft.draft_id).catch(() => s.events);
    window.parent?.postMessage?.({type: 'atlas-finance-updated'}, location.origin);
    status('Approved, locked and published to ATLAS.', false, 6000);
  } catch (e) { status(e.message, true, 12000); } finally { s.busy = false; await loadDrafts(); render(); }
}
async function downloadPdf(summary) {
  const PDFLib = await import('../../vendor/pdf-lib-1.17.1.mjs?v=72c052d97b4d5d9f');
  const logo = new Uint8Array(await (await fetch(new URL('../../rise_logo.png', import.meta.url))).arrayBuffer());
  const bytes = await investorPdf(summary, {PDFLib, logoPng: logo});
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'})); a.download = `${summary.community} FY${summary.fiscalYear} Budget.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------------- rendering ---------------- */
function render() {
  renderContext();
  if (!s.draft) { $app.innerHTML = renderStart(); return; }
  const st = draftStatus();
  const kp = s.result ? kpis() : '';
  const banners = [
    ['approved_locked', 'sent_to_investors'].includes(st) ? `<div class="banner lock">Approved and locked by the VP${s.draft.publication_id ? ' and published to ATLAS' : ''}. ${s.vpEditing ? 'VP edit mode is ON — save requires a reason; re-approve to republish.' : ''}${s.draft.revised_after_approval ? ' <b>Revised since approval — re-approve to publish the revision.</b>' : ''}</div>` : '',
    s.draft.plan_type === 'reforecast' && s.model ? `<div class="banner info">Reforecast: ${s.model.closedMonths || 0} closed month(s) lock to actuals; the remaining months re-project from current drivers.</div>` : '',
    s.dirty ? '<div class="banner info noprint">Unsaved changes. <button class="btn tiny" data-act="save">Save now</button></div>' : ''].join('');
  $app.innerHTML = `${kp}<nav class="tabs" aria-label="Budget sections">${TABS.map(([k, l], i) => `<button class="tab ${s.tab === k ? 'on' : ''}" data-tab="${k}"><span class="n">${i + 1}</span>${l}</button>`).join('')}</nav>${banners}${body()}`;
}
function renderContext() {
  const opts = s.communities.map(c => `<option value="${c.id}" ${c.id === s.cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const drafts = s.drafts.map(d => `<option value="${d.draft_id}" ${s.draft?.draft_id === d.draft_id ? 'selected' : ''}>${esc(d.name)} · ${STATUS[d.status]?.[0] || d.status}</option>`).join('');
  const st = s.draft ? STATUS[draftStatus()] : null;
  $ctx.innerHTML = `<label class="f" style="flex-direction:row;align-items:center;gap:8px">Community<select class="sel" data-ctx="community">${opts}</select></label>
  <label class="f" style="flex-direction:row;align-items:center;gap:8px">Budget<select class="sel" data-ctx="draft"><option value="">${s.drafts.length ? 'Choose…' : 'No budgets yet'}</option>${drafts}</select></label>
  <button class="btn ghost" data-act="new">+ New</button><a class="btn ghost" href="${classicUrl('?atlasView=actuals')}" title="Actuals & close, reforecasts, STR, reports and exports">Close & reports</a>${st ? `<span class="pill ${st[1]}">${st[0]}${s.vpEditing ? ' · VP editing' : ''}</span>` : ''}`;
}
function renderStart() {
  return `<div class="card"><p class="h2">Start a budget or reforecast</p><p class="muted">Choose the year, plan type and asset class, then upload the sources the model should learn from.</p>
  <div class="row" style="margin-top:12px"><label class="f">Fiscal year<input class="inp sm" data-new="year" value="${esc(s.newDraft.year)}"></label>
  <label class="f">Plan<select class="sel" data-new="planType"><option value="budget" ${s.newDraft.planType === 'budget' ? 'selected' : ''}>Budget</option><option value="reforecast" ${s.newDraft.planType === 'reforecast' ? 'selected' : ''}>Reforecast</option></select></label>
  <label class="f">Asset class<select class="sel" data-new="assetClass">${Object.entries(E.ASSET_CLASSES).map(([k, v]) => `<option value="${k}" ${s.newDraft.assetClass === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
  <button class="btn" data-act="create" style="align-self:flex-end">Create</button></div></div>
  ${s.drafts.length ? `<div class="card"><p class="h2">Budgets for this community</p>${s.drafts.map(d => `<div class="row" style="justify-content:space-between;border-bottom:1px solid #e6ecee;padding:8px 0"><div><b>${esc(d.name)}</b> <span class="muted">· FY${d.fiscal_year} · rev ${d.revision} · ${new Date(d.updated_at).toLocaleDateString()}</span></div><div class="row"><span class="pill ${STATUS[d.status]?.[1]}">${STATUS[d.status]?.[0]}</span><button class="btn ghost tiny" data-open="${d.draft_id}">Open</button></div></div>`).join('')}</div>` : ''}`;
}
function kpis() {
  const T = s.result.totals, K = s.result.kpis, u = s.model.property.units, ul = Lr.unitLabel(s.model);
  const flags = E.noteFlags(s.result, s.model.notes).length;
  const memo = s.result.memo ? `<div class="kpi"><div class="k">BAH memo</div><div class="v">${money(s.result.memo.annual)}</div><div class="d">Not collected · excluded from NOI</div></div>` : '';
  return `<div class="kpis">
  <div class="kpi"><div class="k">Total income</div><div class="v">${money(T.annual.income)}</div><div class="d">${pct(T.annual.income, T.t12.income)} vs T12${T.proposal.income ? ' · proposal ' + money(T.proposal.income) : ''}</div></div>
  <div class="kpi"><div class="k">Operating expenses</div><div class="v">${money(T.annual.opex)}</div><div class="d">${pct(T.annual.opex, T.t12.opex)} vs T12 · model ${money(T.model.opex)}</div></div>
  <div class="kpi"><div class="k">NOI</div><div class="v">${money(T.annual.noi)}</div><div class="d">${pct(T.annual.noi, T.t12.noi)} vs T12</div></div>
  <div class="kpi"><div class="k">NOI / ${ul}</div><div class="v">${money(T.annual.noi / u)}</div><div class="d">OpEx ${money(T.annual.opex / u)} / ${ul}</div></div>
  <div class="kpi"><div class="k">Avg occupancy</div><div class="v">${(K.avgOccupancy * 100).toFixed(1)}%</div><div class="d">${K.moveIns} move-ins · ${K.moveOuts} move-outs</div></div>
  <div class="kpi"><div class="k">Notes needed</div><div class="v">${flags}</div><div class="d">Over ±10% and $1,000 vs T12 without a note</div></div>${memo}</div>`;
}
function body() {
  if (s.tab === 'setup' || !s.model) return setupTab();
  return {leasing: leasingTab, income: () => gridTab('income'), expenses: () => gridTab('expenses'), payroll: payrollTab, drivers: driversTab, summary: summaryTab, investor: investorTab}[s.tab]();
}

function setupTab() {
  const ac = s.model?.property.assetClass || s.draft.asset_class;
  const srcRows = (s.sources.length ? s.sources.map(x => ({file: x.file, kind: x.kind, sheet: x.sheet, ok: x.parsed.ok, warnings: x.parsed.warnings || []})) : (s.sourcesSummary || []));
  const label = {t12: 'T12 income statement', boxscore: 'Box score', trending: 'Trending occupancy', conservice: 'Conservice utility projection', vena_budget: 'Existing budget (Vena)', import_sheet: 'Existing budget (Import Sheet)', error: 'Could not read', unknown: 'Not recognized'};
  return `<div class="card"><p class="h2">1 · Asset class</p><div class="grid" style="margin-top:10px">${Object.entries(E.ASSET_CLASSES).map(([k, v]) => `<button class="choice ${ac === k ? 'on' : ''}" data-asset="${k}" ${dis() && s.model ? 'disabled' : ''}><b>${v.label}</b><span>Per ${v.unitLabel}${v.incomeInNoi ? '' : ' · expense-only, BAH memo'}${v.manualSeason ? ' · leasing season set manually' : ''}</span></button>`).join('')}</div>
  ${ac === 'military' ? bahEditor() : ''}</div>
  <div class="card"><p class="h2">2 · Sources</p><p class="muted">Upload any of: an existing budget (Vena Budget Report or a budget model with an Import Sheet), T12 (Entrata xlsx or the monthly financial package PDF), box score, trending occupancy, Conservice projection, and vendor contracts (PDF or Word).</p>
  <div class="drop" style="margin:12px 0"><label style="cursor:pointer"><b style="color:var(--navy)">Choose files</b><input type="file" multiple accept=".xlsx,.xls,.pdf,.docx" data-files hidden></label><div class="muted">Files are read in your browser. Only the budget values you approve are saved.</div></div>
  ${srcRows.length ? `<div class="scroll"><table><thead><tr><th>File</th><th>Read as</th><th>Sheet</th><th>Status</th></tr></thead><tbody>${srcRows.map(x => `<tr><td>${esc(x.file)}</td><td>${label[x.kind] || esc(x.kind)}</td><td>${esc(x.sheet || '')}</td><td>${x.ok ? '<span class="chip ok">Read</span>' : '<span class="chip warn">Check</span>'} <span class="muted">${esc((x.warnings || []).slice(0, 2).join(' '))}</span></td></tr>`).join('')}</tbody></table></div>` : ''}
  ${s.documents.length ? `<p class="muted" style="margin-top:8px">${s.documents.length} contract/proposal document(s) read — review them under Drivers & documents.</p>` : ''}
  <div class="row" style="margin-top:12px"><label class="f">Start from<select class="sel" data-startchoice><option value="">Existing budget if uploaded, otherwise the model</option><option value="model" ${s.startChoice === 'model' ? 'selected' : ''}>Model suggestions (T12 + drivers)</option></select></label>
  <button class="btn" data-act="build" ${s.sources.some(x => x.parsed.ok) ? '' : 'disabled'} style="align-self:flex-end">${s.model ? 'Rebuild from sources' : 'Build budget'}</button></div>
  ${s.model ? '<p class="muted">Rebuilding replaces lines, schedule and drivers with what the sources say; notes and documents are kept.</p>' : ''}</div>`;
}
function bahEditor() {
  const rows = s.model?.bah || [];
  return `<div class="banner info" style="margin-top:12px">Military housing is expense-only. Enter homes by pay grade and the BAH rate to show the income that would be collected as a memo (excluded from NOI).</div>
  ${s.model ? `<table><thead><tr><th>Pay grade</th><th class="r">Homes</th><th class="r">Monthly BAH</th><th></th></tr></thead><tbody>${rows.map((g, i) => `<tr><td><input class="inp sm" data-bah="${i}" data-k="grade" value="${esc(g.grade)}" ${dis()}></td><td class="r"><input class="inp num" data-bah="${i}" data-k="homes" value="${esc(g.homes)}" ${dis()}></td><td class="r"><input class="inp num" data-bah="${i}" data-k="monthlyBah" value="${esc(g.monthlyBah)}" ${dis()}></td><td><button class="linkbtn" data-bahdel="${i}" ${dis()}>Remove</button></td></tr>`).join('')}</tbody></table><button class="btn ghost tiny" data-act="bahadd" ${dis()}>+ Pay grade</button>` : ''}`;
}

function leasingTab() {
  const m = s.model, c = s.result.context, units = c.units, closed = num(m.closedMonths);
  let occ = num(m.schedule.beginOccupied);
  const goal = Math.round(units * num(m.schedule.targetOccPct || 95) / 100);
  const rows = m.periods.map((p, i) => { const b = occ; occ = c.occ[i]; return {p, i, b, e: occ, pc: occ / units * 100, hit: occ >= goal}; });
  const student = m.property.assetClass.startsWith('student');
  return `<div class="card"><div class="row" style="justify-content:space-between"><div><p class="h2">Leasing schedule</p><p class="muted" style="margin:0">Begins at <input class="inp xs" data-sched="begin" value="${num(m.schedule.beginOccupied)}" ${dis()}> occupied of ${units} ${Lr.unitLabel(m)}s. Changes re-run vacancy loss, fee income, turnover, utilities, leasing bonuses and the management fee.</p></div>
  <div class="row"><button class="btn ghost" data-act="learned" ${dis()}>Use learned seasonality</button><label class="f" style="flex-direction:row;align-items:center;gap:6px">Target <input class="inp xs" data-target value="${num(m.schedule.targetOccPct || 95)}" ${dis()}>%</label>
  ${s.draft.plan_type === 'reforecast' ? `<label class="f" style="flex-direction:row;align-items:center;gap:6px">Closed months <input class="inp xs" data-closed value="${closed}" ${dis()}></label>` : ''}</div></div>
  ${student ? `<div class="row" style="margin-top:12px"><span class="muted">Student leasing season (set manually):</span><label class="f">Season opens<select class="sel" data-season="seasonStartMonth" ${dis()}>${MON.map((x, i) => `<option value="${i}" ${num(m.season?.seasonStartMonth ?? 9) === i ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
  <label class="f">Turn / move-in month<select class="sel" data-season="turnMonth" ${dis()}>${MON.map((x, i) => `<option value="${i}" ${num(m.season?.turnMonth ?? 7) === i ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
  <label class="f">Pre-lease %<input class="inp xs" data-season="preleasePct" value="${num(m.season?.preleasePct ?? 95)}" ${dis()}></label><label class="f">Renewal %<input class="inp xs" data-season="renewalPct" value="${num(m.season?.renewalPct ?? 40)}" ${dis()}></label>
  <label class="f">Summer occupancy %<input class="inp xs" data-season="summerOccPct" value="${num(m.season?.summerOccPct ?? 30)}" ${dis()}></label><button class="btn ghost" data-act="season" ${dis()} style="align-self:flex-end">Apply season</button></div>` : ''}
  <div style="margin-top:16px"><div class="bars" role="img" aria-label="Month-end occupancy">${rows.map(r => `<div class="bar"><div class="t">${r.pc.toFixed(1)}%</div><div class="b ${r.hit ? 'hi' : ''}" style="height:${Math.max(6, Math.round((r.pc - 80) / 20 * 120))}px"></div></div>`).join('')}</div>
  <div class="barl">${rows.map(r => `<span>${MON[num(r.p.slice(5)) - 1]}</span>`).join('')}</div></div></div>
  <div class="scroll"><table><thead><tr><th>Month</th><th class="r">Begin</th><th class="r">Move-ins</th><th class="r">Move-outs</th><th class="r">End</th><th class="r">Occupancy</th><th>Status</th></tr></thead><tbody>
  ${rows.map(r => { const ro = !canEdit() || r.i < closed; return `<tr><td><b>${MON[num(r.p.slice(5)) - 1]} ${r.p.slice(0, 4)}</b></td><td class="r">${r.b}</td>
  <td class="r"><button class="btn ghost tiny" data-step="mi:${r.i}:-1" ${ro ? 'disabled' : ''} aria-label="Fewer move-ins">−</button> <input class="inp xs" data-mm="mi:${r.i}" value="${m.schedule.moveIns[r.i]}" ${ro ? 'disabled' : ''}> <button class="btn ghost tiny" data-step="mi:${r.i}:1" ${ro ? 'disabled' : ''} aria-label="More move-ins">+</button></td>
  <td class="r"><button class="btn ghost tiny" data-step="mo:${r.i}:-1" ${ro ? 'disabled' : ''} aria-label="Fewer move-outs">−</button> <input class="inp xs" data-mm="mo:${r.i}" value="${m.schedule.moveOuts[r.i]}" ${ro ? 'disabled' : ''}> <button class="btn ghost tiny" data-step="mo:${r.i}:1" ${ro ? 'disabled' : ''} aria-label="More move-outs">+</button></td>
  <td class="r">${r.e}</td><td class="r"><b>${r.pc.toFixed(1)}%</b></td><td>${r.i < closed ? '<span class="chip fix">Actual (closed)</span>' : r.hit ? '<span class="chip ok">At target</span>' : '<span class="chip warn">Below target</span>'}</td></tr>`; }).join('')}
  <tr class="tot"><td>Total</td><td></td><td class="r">${c.miTotal}</td><td class="r">${c.moTotal}</td><td class="r">${c.occ[11]}</td><td class="r">${(s.result.kpis.avgOccupancy * 100).toFixed(1)}% avg</td><td>Turnover ${(s.result.kpis.turnover * 100).toFixed(0)}%</td></tr></tbody></table></div>
  ${m.schedule.source ? `<p class="muted">${esc(m.schedule.source)}</p>` : ''}`;
}

function gridTab(which) {
  const inc = which === 'income';
  const secs = inc ? E.INCOME_SECTIONS : [...E.OPEX_SECTIONS, ...E.BELOW_NOI_SECTIONS];
  const extra = Object.keys(s.result.sections).filter(k => !E.ALL_SECTIONS.includes(k));
  const all = [...secs, ...(inc ? [] : extra)].filter(k => s.result.sections[k]);
  const m = s.model;
  const T = s.result.totals;
  const tk = inc ? 'income' : 'opex';
  const lineRow = r => {
    const gl = r.line.gl, note = m.notes?.[gl] ?? r.line.note ?? '', open = s.openGL[gl];
    const v = r.t12 ? (r.annual - r.t12) / Math.abs(r.t12) * 100 : null;
    const flag = Math.abs(r.annual - r.t12) > 1000 && (v === null ? r.annual !== 0 : Math.abs(v) > 10) && !String(note).trim();
    const md = r.modelAnnual !== null && Math.abs(r.modelAnnual - r.annual) > 1000 && Math.abs(r.modelAnnual - r.annual) / Math.max(1, Math.abs(r.annual)) > 0.1;
    const drv = r.type === 'linked' ? `Linked · ${E.DRIVER_LABELS[r.kind]}` : r.type === 'payroll' ? 'Payroll positions' : r.type === 'contract' ? 'Contract' : r.kind === 'capex' ? 'Project list' : 'Fixed';
    const anyLocked = r.locked.some(Boolean);
    return `<tr><td class="gl">${esc(gl)}</td><td><b>${esc(r.line.name)}</b><br><button class="linkbtn" data-gl-toggle="${esc(gl)}">${open ? 'Hide' : 'Months'}${r.line.items?.length ? ` · ${r.line.items.length} line item${r.line.items.length > 1 ? 's' : ''}` : ''}</button></td>
    <td class="r">${money(r.t12)}</td><td class="r">${r.proposalAnnual === null ? '—' : money(r.proposalAnnual)}</td>
    <td class="r"><span class="${md ? 'neg' : ''}">${r.modelAnnual === null ? '—' : money(r.modelAnnual)}</span>${md && canEdit() && r.type !== 'payroll' ? `<br><button class="linkbtn" data-usemodel="${esc(gl)}">Use model</button>` : ''}</td>
    <td class="r"><input class="inp num" aria-label="Budget ${esc(gl)}" data-ov="${esc(gl)}" value="${Math.round(r.annual)}" ${dis() || (r.type === 'payroll' || anyLocked ? 'disabled' : '')}>${r.overridden && canEdit() ? `<br><button class="linkbtn" data-reset="${esc(gl)}">Reset to driver</button>` : ''}</td>
    <td class="r">${v === null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'}</td>
    <td><span class="chip ${r.type === 'linked' ? 'link' : 'fix'}">${esc(drv)}</span>${flag ? '<span class="chip warn">Note needed</span>' : ''}</td>
    <td><input class="inp note" aria-label="Note ${esc(gl)}" data-note="${esc(gl)}" value="${esc(note)}" placeholder="Note for reviewers / investors" ${s.draft && canEdit() ? '' : 'disabled'}></td>
    <td style="text-align:center"><input type="checkbox" class="chk" aria-label="Show note to investors ${esc(gl)}" data-inv="${esc(gl)}" ${m.investorNotes?.[gl] ? 'checked' : ''} ${canEdit() ? '' : 'disabled'}></td></tr>
    ${open ? `<tr class="item"><td></td><td colspan="8"><div class="monthly">${m.periods.map((p, i) => `<label>${MON[num(p.slice(5)) - 1]} ${p.slice(2, 4)}${r.locked[i] ? ' (actual)' : ''}<input class="inp num" style="width:100%" data-mon="${esc(gl)}:${i}" value="${Math.round(r.monthly[i])}" ${dis() || (r.type === 'payroll' || r.locked[i] ? 'disabled' : '')}></label>`).join('')}</div>
    ${r.model ? `<div class="muted">Model by month: ${r.model.map(x => money(x)).join(' · ')}</div>` : ''}
    ${(r.line.items || []).map(it => `<div class="muted">↳ ${esc(it.description)} — ${money(it.amount)}${it.comment ? ' · ' + esc(it.comment) : ''}</div>`).join('')}</td></tr>` : ''}`;
  };
  return `<div class="card" style="padding:14px 18px"><div class="row" style="justify-content:space-between"><div><p class="h2">${inc ? 'Income' : 'Expenses, reserves & capital'}</p>
  <p class="muted" style="margin:0"><b>Linked</b> lines move with the leasing schedule and drivers; <b>Fixed</b> and contract lines hold their amounts. “Model suggests” is learned from T12, the box score, Conservice and past decisions.</p></div>
  <div class="row"><button class="btn ghost" data-act="expand">Expand all</button><button class="btn ghost" data-act="collapse">Collapse all</button>${canEdit() ? '<button class="btn ghost" data-act="addgl">+ Add GL code</button>' : ''}</div></div>
  ${!inc && s.model.property.assetClass === 'military' ? '' : ''}${inc && s.result.memo ? `<div class="banner info" style="margin:10px 0 0">Military: income lines are a memo and excluded from NOI. BAH memo ${money(s.result.memo.annual)}.</div>` : ''}</div>
  <div class="scroll"><table><thead><tr><th>GL</th><th>Account</th><th class="r">T12 actual</th><th class="r">Proposal</th><th class="r">Model suggests</th><th class="r">Budget</th><th class="r">vs T12</th><th>Driver</th><th style="min-width:240px">Regional notes</th><th>Investor</th></tr></thead><tbody>
  ${all.map(sec => { const S_ = s.result.sections[sec], open = s.open[sec] !== false; return `<tr class="sec"><td colspan="10"><button data-sec="${esc(sec)}" aria-expanded="${open}">${open ? '▾' : '▸'} ${esc(sec)} · ${S_.lines.length} accounts${E.BELOW_NOI_SECTIONS.includes(sec) ? ' · below NOI' : ''}</button></td></tr>
  ${open ? S_.lines.sort((a, b) => String(a.line.gl).localeCompare(String(b.line.gl))).map(lineRow).join('') : ''}
  <tr class="sub"><td></td><td>Total ${esc(sec)}</td><td class="r">${money(S_.t12)}</td><td class="r">${money(S_.proposal)}</td><td class="r">${money(S_.model)}</td><td class="r">${money(S_.annual)}</td><td class="r">${pct(S_.annual, S_.t12)}</td><td colspan="3">${money(S_.annual / s.model.property.units)} / ${Lr.unitLabel(s.model)}</td></tr>`; }).join('')}
  <tr class="tot"><td></td><td>${inc ? 'Total income' : 'Total operating expenses'}</td><td class="r">${money(T.t12[tk])}</td><td class="r">${money(T.proposal[tk])}</td><td class="r">${money(T.model[tk])}</td><td class="r">${money(T.annual[tk])}</td><td class="r">${pct(T.annual[tk], T.t12[tk])}</td><td colspan="3"></td></tr></tbody></table></div>`;
}

function payrollTab() {
  const m = s.model, c = s.result.context;
  const bonus = ['6338', '6339'].reduce((t, g) => t + (s.result.rows[g]?.annual || 0), 0);
  const burden = Object.values(s.result.rows).filter(r => r.kind === 'salaries').reduce((t, r) => t + r.annual, 0);
  return `<div class="card"><div class="row" style="justify-content:space-between"><div><p class="h2">Payroll by position</p><p class="muted" style="margin:0">Positions roll up to payroll GLs. Taxes and benefits follow salaries; leasing bonuses follow move-ins.</p></div>${canEdit() ? '<button class="btn ghost" data-act="addpos">+ Add position</button>' : ''}</div></div>
  <div class="scroll"><table><thead><tr><th>Position</th><th>GL</th><th class="r">Headcount</th><th class="r">Annual salary</th><th class="r">Raise %</th><th>Raise month</th><th>Start</th><th>End</th><th class="r">Budget</th><th class="r">T12 (GL)</th><th></th></tr></thead><tbody>
  ${m.positions.map((p, i) => { const t12 = m.lines.find(l => String(l.gl) === String(p.gl))?.t12?.total; const cost = E.positionMonthly(p).reduce((a, b) => a + b, 0);
  const mon = (k, d) => `<select class="sel" data-pos="${i}" data-k="${k}" ${dis()}><option value="">${d}</option>${m.periods.map((x, j) => `<option value="${j}" ${p[k] !== null && p[k] !== undefined && p[k] !== '' && num(p[k]) === j ? 'selected' : ''}>${MON[num(x.slice(5)) - 1]}</option>`).join('')}</select>`;
  return `<tr><td><input class="inp" data-pos="${i}" data-k="title" value="${esc(p.title)}" ${dis()}></td><td><select class="sel" data-pos="${i}" data-k="gl" ${dis()}>${['6330', '6332', '6335', '6510', '6511', '6512'].map(g => `<option ${String(p.gl) === g ? 'selected' : ''}>${g}</option>`).join('')}</select></td>
  <td class="r"><input class="inp xs" data-pos="${i}" data-k="count" value="${esc(p.count)}" ${dis()}></td><td class="r"><input class="inp num" data-pos="${i}" data-k="salary" value="${esc(p.salary)}" ${dis()}></td><td class="r"><input class="inp xs" data-pos="${i}" data-k="raisePct" value="${esc(p.raisePct || 0)}" ${dis()}></td>
  <td>${mon('raiseMonth', 'None')}</td><td>${mon('startMonth', 'Full year')}</td><td>${mon('endMonth', 'Full year')}</td><td class="r"><b>${money(cost)}</b></td><td class="r">${money(t12)}</td>
  <td>${!p.confirmed ? `<button class="linkbtn" data-posok="${i}" ${dis()}>Confirm</button>` : '<span class="chip ok">Confirmed</span>'} ${canEdit() ? `<button class="linkbtn" data-posdel="${i}">Remove</button>` : ''}</td></tr>`; }).join('')}
  <tr class="sub"><td>Salaries</td><td></td><td class="r">${m.positions.reduce((t, p) => t + num(p.count), 0)}</td><td colspan="5"></td><td class="r">${money(c.salTotal)}</td><td class="r">${money(m.basis?.salaries)}</td><td></td></tr>
  <tr><td>Bonuses (6338/6339)</td><td colspan="7" class="muted">Leasing bonuses scale with move-ins</td><td class="r">${money(bonus)}</td><td></td><td></td></tr>
  <tr><td>Payroll taxes & benefits</td><td colspan="7" class="muted">${c.salTotal ? (burden / c.salTotal * 100).toFixed(1) : '0'}% of salaries</td><td class="r">${money(burden)}</td><td></td><td></td></tr>
  <tr class="tot"><td>Total payroll</td><td colspan="7"></td><td class="r">${money(c.salTotal + bonus + burden)}</td><td></td><td></td></tr></tbody></table></div>`;
}

function driversTab() {
  const a = s.model.assumptions, src = s.model.sources || {}, cr = src.conservice;
  const f = (k, label, hint) => `<label class="f">${label}<input class="inp num" data-a="${k}" value="${a[k] === null || a[k] === undefined ? '' : Math.round(num(a[k]) * 100) / 100}" ${dis()}><small>${hint || ''}</small></label>`;
  const bm = s.benchmarks || {};
  return `<div class="cols"><div class="card"><p class="h2">Revenue drivers</p><div class="grid" style="margin-top:10px">
  ${f('marketRent', 'Avg market rent ($)', src.box ? 'Box score ' + esc(src.box.asOf || '') : '')}${f('rentGrowth', 'Rent growth (%)', '')}
  ${f('ltlPct', 'Loss to lease (% GPR)', a.modelLtlPct !== null ? `Model: ${num(a.modelLtlPct).toFixed(2)}% (box score scheduled vs market)` : '')}${f('concessionPct', 'Concessions (% GPR)', a.modelConcessionPct !== null ? `T12: ${num(a.modelConcessionPct).toFixed(2)}%` : '')}
  ${f('badDebtPct', 'Bad debt (% GPR)', a.modelBadDebtPct !== null ? `T12: ${num(a.modelBadDebtPct).toFixed(2)}%` : '')}${f('mgmtPct', 'Management fee (% income)', 'Per management agreement')}</div></div>
  <div class="card"><p class="h2">Expense & utility drivers</p><div class="grid" style="margin-top:10px">
  ${f('inflation', 'General inflation (%)', 'Model column; fixed contracts hold')}${f('taxChange', 'Property tax change (%)', 'Change vs. starting budget')}${f('insChange', 'Insurance change (%)', 'Change vs. starting budget')}
  ${f('electric', 'Electric rate change (%)', cr?.electric ? `Conservice: ${num(cr.electric.steady).toFixed(1)}% · ${esc(cr.electric.provider)}` : 'No Conservice data')}
  ${f('water', 'Water rate change (%)', cr?.water ? `Conservice: ${num(cr.water.steady).toFixed(1)}%` : '')}${f('sewer', 'Sewer rate change (%)', cr?.sewer ? `Conservice: ${num(cr.sewer.steady).toFixed(1)}%` : '')}
  ${f('sewerShare', 'Sewer share of W/S bill (%)', `Blended W/S: ${s.result.context.WS.toFixed(1)}%`)}${f('reservePerUnit', 'Reserve ($/' + Lr.unitLabel(s.model) + '/yr)', '')}</div></div></div>
  ${s.checks.length ? `<div class="card"><p class="h2">Model checks</p>${s.checks.slice(0, 25).map(c => `<div class="log"><span class="chip ${c.severity === 'warn' ? 'warn' : 'model'}">${c.severity === 'warn' ? 'Check' : 'Info'}</span> ${esc(c.message)}</div>`).join('')}</div>` : ''}
  <div class="card"><p class="h2">Portfolio benchmarks</p><p class="muted">Median cost per ${Lr.unitLabel(s.model)} from approved budgets and T12s across RISE (shown when at least three communities report).</p>
  <div class="scroll"><table><thead><tr><th>Category</th><th class="r">This budget / ${Lr.unitLabel(s.model)}</th><th class="r">Portfolio median</th><th class="r">Communities</th></tr></thead><tbody>${s.result.groups.map(g => `<tr><td>${esc(g.name)}</td><td class="r">${money(g.perUnit)}</td><td class="r">${bm[g.name] ? money(bm[g.name].median) : '—'}</td><td class="r">${bm[g.name]?.n || ''}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="card"><p class="h2">Documents</p><p class="muted">Contracts and proposals are read for vendor, term, amount, escalator, notice and renewal. Nothing changes the budget until you apply it.</p>
  <div class="drop" style="margin:10px 0"><label style="cursor:pointer"><b style="color:var(--navy)">Add contracts or proposals</b><input type="file" multiple accept=".pdf,.docx" data-files hidden></label></div>
  ${s.documents.map((d, i) => { const t = d.terms || {}; return `<div style="border-bottom:1px solid #e6ecee;padding:10px 0"><div class="row" style="justify-content:space-between"><b>${esc(d.file)}</b><span class="chip ${d.applied ? 'ok' : 'warn'}">${d.applied ? 'Applied' : 'Needs review'}</span></div>
  <div class="muted">${[t.vendorText && 'Party: ' + esc(t.vendorText), t.termMonths && `Term: ${t.termMonths} months`, t.monthlyAmount !== null && t.monthlyAmount !== undefined && `Monthly: ${money(t.monthlyAmount)}`, t.revenueSharePct !== null && t.revenueSharePct !== undefined && `Revenue share: ${t.revenueSharePct}%`, t.escalatorPct && `Escalator: ${t.escalatorPct}%`, t.terminationNoticeDays && `Notice: ${t.terminationNoticeDays} days`, t.autoRenew === true ? 'Auto-renews' : t.autoRenew === false ? 'Renews only in writing' : ''].filter(Boolean).join(' · ') || 'No terms recognized'}</div>
  ${(d.warnings || []).map(w => `<div class="muted">⚠ ${esc(w)}</div>`).join('')}
  <div class="row" style="margin-top:6px"><label class="f" style="flex-direction:row;align-items:center;gap:6px">GL<input class="inp sm" data-docgl="${i}" value="${esc(d.gl || t.gl?.value || '')}" ${dis()}></label>
  <label class="f" style="flex-direction:row;align-items:center;gap:6px">Monthly $<input class="inp num" data-docamt="${i}" value="${esc(d.amount ?? t.monthlyAmount ?? '')}" ${dis()}></label>
  <button class="btn ghost tiny" data-docapply="${i}" ${dis()}>Apply to budget</button><button class="linkbtn" data-docdel="${i}" ${dis()}>Remove</button></div></div>`; }).join('') || '<p class="muted">No documents yet.</p>'}</div>`;
}

function summaryTab() {
  const st = draftStatus(), T = s.result.totals, u = s.model.property.units;
  const steps = [['gm_draft', 'GM draft', 'Site GM builds and submits'], ['regional_review', 'Regional review', 'RM reviews notes and variances'], ['vp_review', 'VP approval', 'VP approves, locks and publishes'], ['approved_locked', 'Approved & locked', 'ATLAS reports and Bonus read it'], ['sent_to_investors', 'Sent to investors', 'Investor package emailed']];
  const idx = steps.findIndex(x => x[0] === st);
  const btn = (a, label, cls = 'btn') => `<button class="${cls}" data-flow="${a}" ${s.busy ? 'disabled' : ''}>${label}</button>`;
  const actions = [];
  if (st === 'gm_draft') actions.push(btn('submit_to_regional', 'Submit to Regional'));
  if (st === 'regional_review' && isRegional()) actions.push(btn('regional_approve', 'Approve & send to VP'), btn('regional_return', 'Return to GM', 'btn warn'));
  if (st === 'vp_review' && isVp()) actions.push(btn('vp_approve', 'Approve, lock & publish'), btn('vp_return', 'Return to Regional', 'btn warn'));
  if (['approved_locked', 'sent_to_investors'].includes(st) && isVp()) actions.push(`<button class="btn ghost" data-act="vpedit">${s.vpEditing ? 'Stop VP edit' : 'VP edit (logged)'}</button>`, s.draft.revised_after_approval ? btn('vp_approve', 'Re-approve & publish revision') : '', `<button class="btn ghost" data-tab="investor">Investor package</button>`);
  const group = (name, k, cls = '', bm = null) => `<tr class="${cls}"><td>${name}</td><td class="r">${money(k.t12)}</td><td class="r">${money(k.proposal)}</td><td class="r">${money(k.model)}</td><td class="r"><b>${money(k.final)}</b></td><td class="r">${pct(k.final, k.t12)}</td><td class="r">${money(k.final / u)}</td><td class="r">${bm ? money(bm.median) : ''}</td></tr>`;
  const t = key => ({t12: T.t12[key], proposal: T.proposal[key], model: T.model[key], final: T.annual[key]});
  return `<div class="card"><p class="h2">Approval</p><div class="step">${steps.map((x, i) => `<div class="st ${i < idx ? 'done' : i === idx ? 'cur' : ''}"><b>${x[1]}</b>${x[2]}</div>`).join('')}</div>
  <div class="row">${actions.join('')}${s.vpEditing ? `<label class="f" style="flex:1 1 280px">Reason for VP edit (logged)<input class="inp" data-vpreason value="${esc(s.vpReason)}" placeholder="e.g., Insurance renewal quote received"></label><button class="btn" data-act="save">Save VP edit</button>` : ''}</div>
  <div style="margin-top:14px"><p class="h3">Activity</p>${s.events.slice(0, 30).map(e => `<div class="log"><b>${esc(e.action.replaceAll('_', ' '))}</b> · ${esc(e.actor_role)} · ${new Date(e.created_at).toLocaleString()}${e.reason ? ' — ' + esc(e.reason) : ''}</div>`).join('') || '<p class="muted">No activity yet.</p>'}</div></div>
  <div class="scroll"><table><thead><tr><th>Summary</th><th class="r">T12 actual</th><th class="r">Proposal</th><th class="r">Model</th><th class="r">Budget</th><th class="r">vs T12</th><th class="r">Per ${Lr.unitLabel(s.model)}</th><th class="r">Portfolio median</th></tr></thead><tbody>
  ${group('Total income', t('income'), 'sub')}${s.result.groups.map(g => group(g.name, g, '', s.benchmarks?.[g.name])).join('')}${group('Operating expenses', t('opex'), 'sub')}${group('Net operating income', t('noi'), 'tot')}${group('Replacement reserves', t('reserves'))}${group('Capital expenditures', t('capex'))}${group('Cash flow after reserves & capex', t('cashFlow'), 'tot')}</tbody></table></div>`;
}

function investorTab() {
  const locked = ['approved_locked', 'sent_to_investors'].includes(draftStatus()) && s.draft.locked_summary && !s.draft.revised_after_approval;
  const summary = locked ? s.draft.locked_summary : summaryForInvestors();
  return `<div class="row noprint" style="justify-content:space-between;margin-bottom:14px"><p class="muted" style="margin:0">${locked ? 'Locked package from the VP-approved budget.' : 'Preview — the package can be sent after GM → Regional → VP approval locks the budget.'} Tick “Investor” next to a line’s note to include it.</p>
  <div class="row"><button class="btn ghost" data-act="pdf">Download PDF</button>${locked && isVp() ? `<input class="inp" style="min-width:280px" data-recipients placeholder="investor@example.com, partner@example.com" value="${esc(s.recipients)}"><button class="btn" data-act="email" ${s.busy ? 'disabled' : ''}>${draftStatus() === 'sent_to_investors' ? 'Send again' : 'Email to investors'}</button>` : ''}</div></div>
  <div class="cover"><img src="./rise_logo.png" alt="RISE — A Real Estate Company" style="height:56px;width:auto"><div style="height:6px;background:var(--navy);margin:24px 0 18px"></div>${investorHtml(summary)}</div>`;
}

/* ---------------- events ---------------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-tab],[data-act],[data-open],[data-asset],[data-sec],[data-gl-toggle],[data-usemodel],[data-reset],[data-step],[data-flow],[data-posdel],[data-posok],[data-docapply],[data-docdel],[data-bahdel]');
  if (!t) return;
  const d = t.dataset;
  if (d.tab) { s.tab = d.tab; render(); return; }
  if (d.open) { await openDraft(d.open).catch(err => status(err.message, true)); return; }
  if (d.asset && s.draft) { s.draft.asset_class = d.asset; if (s.model) { s.model.property.assetClass = d.asset; if (d.asset === 'military') s.model.bah ||= []; mark(); } else render(); return; }
  if (d.sec) { s.open[d.sec] = s.open[d.sec] === false; render(); return; }
  if (d.glToggle) { s.openGL[d.glToggle] = !s.openGL[d.glToggle]; render(); return; }
  if (d.usemodel) { const r = s.result.rows[d.usemodel]; s.model.overrides[d.usemodel] = r.model.slice(); mark(); return; }
  if (d.reset) { delete s.model.overrides[d.reset]; mark(); return; }
  if (d.step) { const [k, i, by] = d.step.split(':'); const arr = k === 'mi' ? s.model.schedule.moveIns : s.model.schedule.moveOuts; arr[i] = Math.max(0, num(arr[i]) + num(by)); mark(); return; }
  if (d.flow) { await act(d.flow); return; }
  if (d.posdel) { s.model.positions.splice(num(d.posdel), 1); mark(); return; }
  if (d.posok) { s.model.positions[num(d.posok)].confirmed = true; mark(); return; }
  if (d.bahdel) { s.model.bah.splice(num(d.bahdel), 1); mark(); return; }
  if (d.docdel) { s.documents.splice(num(d.docdel), 1); s.dirty = true; render(); return; }
  if (d.docapply) {
    const doc = s.documents[num(d.docapply)], gl = String(doc.gl || doc.terms?.gl?.value || ''), amt = num(doc.amount ?? doc.terms?.monthlyAmount);
    if (!/^\d{4}$/.test(gl) || !amt) { status('Enter the GL and the monthly amount to apply.', true); return; }
    if (!confirm(`Set ${gl} to ${money(amt)} per month (${money(amt * 12)} for the year) from ${doc.file}?`)) return;
    if (!s.model.lines.some(l => String(l.gl) === gl)) s.model.lines.push({gl, name: doc.terms?.gl?.label || 'Contract', section: E.sectionForGl(gl), items: [], note: ''});
    s.model.overrides[gl] = Array(12).fill(amt); s.model.notes[gl] = `${s.model.notes[gl] ? s.model.notes[gl] + ' · ' : ''}Per ${doc.file}`; doc.applied = true; mark(); return;
  }
  switch (d.act) {
    case 'new': s.draft = null; s.model = null; render(); break;
    case 'create': newDraft(); break;
    case 'save': await save(); break;
    case 'build': await buildFromSources(); break;
    case 'expand': Object.keys(s.result.sections).forEach(k => { s.open[k] = true; }); render(); break;
    case 'collapse': Object.keys(s.result.sections).forEach(k => { s.open[k] = false; }); render(); break;
    case 'addgl': {
      const gl = (prompt('GL code (4 digits):') || '').trim(); if (!/^\d{4}$/.test(gl)) return;
      if (s.model.lines.some(l => String(l.gl) === gl)) { status(gl + ' is already in this budget.', true); return; }
      const name = (prompt('Account name:') || '').trim(); if (!name) return;
      s.model.lines.push({gl, name, section: E.sectionForGl(gl, name), items: [], note: 'Added GL — Accounting confirms new codes when the budget is published'}); s.model.overrides[gl] = 0; mark(); break;
    }
    case 'addpos': s.model.positions.push({id: S.uuid(), title: 'New position', gl: '6335', count: 1, salary: 0, raisePct: 0, raiseMonth: null, confirmed: false}); mark(); break;
    case 'bahadd': (s.model.bah ||= []).push({grade: 'E-5', homes: 0, monthlyBah: 0}); mark(); break;
    case 'learned': {
      const m = s.model; const trending = s.sources.find(x => x.kind === 'trending')?.parsed;
      if (!trending) { status('Upload Trending Occupancy on the Setup tab to use learned seasonality.', true); return; }
      Object.assign(m.schedule, Lr.suggestSchedule({periods: m.periods, beginOccupied: m.schedule.beginOccupied, units: m.property.units, season: Lr.seasonality(trending), targetOccPct: num(m.schedule.targetOccPct || 95)})); mark(); break;
    }
    case 'season': {
      const m = s.model, ss = m.season || {}; const sched = E.seasonSchedule({units: m.property.units, ...ss});
      const shift = mo => m.periods.map(p => mo[num(p.slice(5)) - 1]);
      m.schedule.moveIns = shift(sched.moveIns); m.schedule.moveOuts = shift(sched.moveOuts); mark(); break;
    }
    case 'vpedit': s.vpEditing = !s.vpEditing; render(); break;
    case 'pdf': {
      const locked = ['approved_locked', 'sent_to_investors'].includes(draftStatus()) && s.draft.locked_summary && !s.draft.revised_after_approval;
      await downloadPdf(locked ? s.draft.locked_summary : summaryForInvestors()).catch(err => status(err.message, true)); break;
    }
    case 'email': {
      const list = s.recipients.split(/[,;\s]+/).filter(Boolean);
      if (!list.length) { status('Enter at least one recipient.', true); return; }
      if (!confirm(`Email the investor package to ${list.join(', ')}?`)) return;
      s.busy = true; render();
      try { await S.sendInvestorPackage(s.central, {draftId: s.draft.draft_id, recipients: list}); status('Investor package sent.'); s.draft = await S.readDraft(s.central, s.draft.draft_id); s.events = await S.readEvents(s.central, s.draft.draft_id); }
      catch (err) { status(err.message, true, 10000); } finally { s.busy = false; render(); }
      break;
    }
  }
});

document.addEventListener('change', async e => {
  const t = e.target, d = t.dataset;
  if (d.ctx === 'community') { s.cid = t.value; s.draft = null; s.model = null; await loadDrafts(); render(); return; }
  if (d.ctx === 'draft') { if (t.value) await openDraft(t.value).catch(err => status(err.message, true)); return; }
  if (d.new) { s.newDraft[d.new] = t.value; return; }
  if (t.matches('[data-files]')) { await onFiles([...t.files]); return; }
  if (t.matches('[data-startchoice]')) { s.startChoice = t.value || undefined; return; }
  if (t.matches('[data-recipients]')) { s.recipients = t.value; return; }
  if (t.matches('[data-vpreason]')) { s.vpReason = t.value; return; }
  if (!s.model) return;
  const m = s.model;
  if (d.a) { m.assumptions[d.a] = num(t.value); mark(); return; }
  if (d.ov) { m.overrides[d.ov] = num(t.value); mark(); return; }
  if (d.mon) { const [gl, i] = d.mon.split(':'); const r = s.result.rows[gl]; const arr = Array.isArray(m.overrides[gl]) ? m.overrides[gl].slice() : r.monthly.slice(); arr[num(i)] = num(t.value); m.overrides[gl] = arr; mark(); return; }
  if (d.note !== undefined && d.note !== '') { m.notes[d.note] = t.value; s.dirty = true; recalc(); render(); scheduleSave(); return; }
  if (d.inv) { m.investorNotes ||= {}; m.investorNotes[d.inv] = t.checked; s.dirty = true; scheduleSave(); return; }
  if (d.mm) { const [k, i] = d.mm.split(':'); (k === 'mi' ? m.schedule.moveIns : m.schedule.moveOuts)[num(i)] = Math.max(0, num(t.value)); mark(); return; }
  if (d.sched === 'begin') { m.schedule.beginOccupied = num(t.value); mark(); return; }
  if (t.matches('[data-target]')) { m.schedule.targetOccPct = num(t.value); mark(); return; }
  if (t.matches('[data-closed]')) { m.closedMonths = Math.max(0, Math.min(12, num(t.value))); mark(); return; }
  if (d.season) { m.season ||= {}; m.season[d.season] = num(t.value); s.dirty = true; return; }
  if (d.pos !== undefined && d.k) { const p = m.positions[num(d.pos)]; p[d.k] = ['title', 'gl'].includes(d.k) ? t.value : (t.value === '' ? null : num(t.value)); p.confirmed = true; mark(); return; }
  if (d.bah !== undefined && d.k) { m.bah[num(d.bah)][d.k] = d.k === 'grade' ? t.value : num(t.value); mark(); return; }
  if (d.docgl !== undefined) { s.documents[num(d.docgl)].gl = t.value.trim(); s.dirty = true; return; }
  if (d.docamt !== undefined) { s.documents[num(d.docamt)].amount = num(t.value); s.dirty = true; return; }
});
window.addEventListener('beforeunload', e => { if (s.dirty) { e.preventDefault(); e.returnValue = ''; } });

boot().catch(e => { $app.innerHTML = `<div class="card">Budget Builder could not start: ${esc(e.message)}</div>`; });
