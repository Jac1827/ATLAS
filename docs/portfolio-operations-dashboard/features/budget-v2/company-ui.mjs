/* RISE company budget — user interface inside Budget Builder v2.
 * The VP builds it, a designated executive approves and locks it, and each month's
 * Entrata Budget vs Actual is tracked with variance comments. */
import * as C from './company.mjs?v=b811f5c56820c220';
import * as CS from './company-store.mjs?v=8ca3f5f755ee2b7b';
import {positionMonthly} from './engine.mjs?v=d1645594fb2c6c47';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TABS = [['setup', 'Setup & sources'], ['fees', 'Fee income'], ['payroll', 'Payroll'], ['lines', 'Expenses & other income'], ['summary', 'Summary & approval'], ['tracking', 'Monthly tracking']];
const STATUS = {draft: ['Draft · VP', ''], executive_review: ['Executive review', 'warn'], approved_locked: ['Approved · Locked', 'lock'], archived: ['Archived', '']};
const num = x => { const n = typeof x === 'number' ? x : parseFloat(String(x ?? '').replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const has = x => x !== null && x !== undefined && x !== '';
const sum = a => a.reduce((t, v) => t + (Number(v) || 0), 0);
const pm = p => `${MON[num(p.slice(5)) - 1]} ${p.slice(2, 4)}`;

let H = null; // host: {central, $app, $ctx, status, esc, money, communities, back}
const cs = {active: false, role: null, list: [], budget: null, model: null, result: null, tab: 'setup', reports: [], months: [], approvedForYear: null,
  trackYear: new Date().getFullYear(), trackPeriod: null, busy: false, dirty: false, vpReason: '', vpEditing: false, events: [], open: {}, openGL: {}, approverEmail: '', feeNote: '', start: 'prior', inflation: 3, newYear: new Date().getFullYear() + 1, newPlan: 'budget'};

export async function role(central) { cs.role = await CS.myRole(central); return cs.role; }
export const isActive = () => cs.active;
export async function open(host) {
  H = host; cs.active = true;
  await loadList();
  render();
}
function close() { cs.active = false; cs.budget = null; cs.model = null; H.back(); }
const esc = v => H.esc(v), money = v => H.money(v);
const builder = () => cs.role === 'builder';
const approver = () => cs.role === 'approver';
const st = () => cs.budget?.status || 'draft';
const canEdit = () => !!cs.model && builder() && (st() === 'draft' || (st() === 'approved_locked' && cs.vpEditing));
const dis = () => (canEdit() ? '' : 'disabled');
const pctTxt = (a, b) => (b ? `${a - b >= 0 ? '+' : ''}${(((a - b) / Math.abs(b)) * 100).toFixed(1)}%` : '—');

async function loadList() { cs.list = await CS.list(H.central).catch(() => []); }
function recalc() { cs.result = cs.model ? C.calculateCompany(cs.model) : null; }
function mark() { cs.dirty = true; recalc(); render(); clearTimeout(mark.t); if (canEdit() && st() === 'draft') mark.t = setTimeout(() => save().catch(() => {}), 12000); }

async function openBudget(id) {
  cs.budget = await CS.read(H.central, id); cs.model = cs.budget.payload.model; cs.vpEditing = false; cs.dirty = false;
  cs.events = await CS.events(H.central, id);
  cs.trackYear = cs.budget.fiscal_year; cs.tab = 'summary';
  recalc();
  if (canEdit()) await refreshFees(false);
  render();
}
async function save({reason = null} = {}) {
  if (!cs.model || cs.busy) return;
  const locked = st() === 'approved_locked';
  if (locked && cs.vpReason.trim().length < 3) { H.status('Enter a reason for the VP edit before saving.', true); return; }
  cs.busy = true;
  try {
    cs.budget = await CS.save(H.central, {budgetId: cs.budget.budget_id, expectedRevision: cs.budget.revision, meta: {fiscalYear: cs.budget.fiscal_year, planType: cs.budget.plan_type, name: cs.budget.name},
      payload: {model: cs.model}, reason: locked ? cs.vpReason : reason});
    cs.dirty = false; H.status('Saved · revision ' + cs.budget.revision);
    cs.events = await CS.events(H.central, cs.budget.budget_id); await loadList();
  } catch (e) { H.status(e.message, true, 9000); } finally { cs.busy = false; render(); }
}
async function refreshFees(announce = true) {
  if (!cs.model) return;
  try {
    const sources = await CS.propertyFees(H.central, cs.model.fiscalYear);
    const changes = C.refreshFees(cs.model, sources);
    if (changes.length) { cs.feeNote = `${changes.length} fee line(s) updated from property budgets: ` + changes.map(c => `${c.name} ${money(c.before)} → ${money(c.after)}`).join('; '); mark(); }
    else if (announce) H.status('Linked fees already match the property budgets.');
  } catch (e) { if (announce) H.status(e.message, true); }
}

/* ---------------- sources ---------------- */
async function readReports(files) {
  for (const f of files) {
    try {
      const wb = window.XLSX.read(new Uint8Array(await f.arrayBuffer()), {type: 'array'});
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, defval: '', raw: true});
      if (!C.isBudgetVsActual(rows)) throw Error('Not an Entrata “Income Statement - Budget vs Actual” report.');
      const rep = C.parseBudgetVsActual(rows);
      if (!rep.ok) throw Error(rep.warnings.join(' ') || 'No accounts were found.');
      cs.reports = cs.reports.filter(r => r.period !== rep.period).concat({...rep, file: f.name});
    } catch (e) { H.status(`${f.name}: ${e.message}`, true, 9000); }
  }
}
/* Store each report as that month's actuals (comments kept) unless the month was already reviewed. */
async function saveReportMonths(reps) {
  const year = [...new Set(reps.map(r => Number(r.period.slice(0, 4))))];
  let saved = 0;
  for (const y of year) {
    const existing = await CS.months(H.central, y);
    for (const rep of reps.filter(r => Number(r.period.slice(0, 4)) === y)) {
      const cur = existing.find(m => m.period === rep.period);
      if (cur?.status === 'reviewed') continue;
      const payload = {...C.monthFromReport(rep), fiscalYear: y, comments: {...(cur?.payload?.comments || {}), ...C.monthFromReport(rep).comments}};
      await CS.saveMonth(H.central, {period: rep.period, expectedRevision: cur?.revision || 0, payload, source: {file: rep.file, entity: rep.entity, kind: 'entrata_budget_vs_actual'}});
      saved++;
    }
  }
  return saved;
}

async function build() {
  if (!cs.reports.length) { H.status('Upload at least one Budget vs Actual report.', true); return; }
  const model = C.buildCompanyModel({fiscalYear: cs.budget.fiscal_year, reports: cs.reports, start: cs.start, inflation: cs.inflation});
  if (cs.model) { model.notes = cs.model.notes || {}; }
  if (cs.budget.plan_type === 'reforecast') {
    const ms = await CS.months(H.central, cs.budget.fiscal_year);
    let closed = 0; while (closed < 12 && ms.some(m => m.period === model.periods[closed])) closed++;
    model.closedMonths = closed;
    model.actuals = {};
    for (const m of ms) { const i = model.periods.indexOf(m.period); if (i < 0) continue; for (const [gl, v] of Object.entries(m.payload.actuals || {})) (model.actuals[gl] ||= Array(12).fill(null))[i] = v; }
  }
  // Fee lines link to communities by name where one matches.
  for (const f of model.fees) { const cid = C.suggestCommunity(f, H.communities); if (cid) { f.communityId = cid; f.mode = 'linked'; } }
  cs.model = model; recalc();
  await refreshFees(false);
  try { const n = await saveReportMonths(cs.reports); if (n) H.status(`${n} month(s) of actuals saved for tracking.`); } catch (e) { H.status(e.message, true); }
  cs.tab = 'fees'; cs.dirty = true; render();
  await save({reason: 'Built from Entrata Budget vs Actual reports'});
}

/* ---------------- approval ---------------- */
function lockedSummary() {
  const r = cs.result;
  return {entity: cs.model.entity, fiscalYear: cs.model.fiscalYear, periods: cs.model.periods, totals: r.totals.annual, prior: r.totals.prior, groups: r.groups, monthly: r.monthly,
    budgetByGl: Object.fromEntries(Object.entries(r.rows).map(([gl, x]) => [gl, x.monthly])), lines: Object.values(r.rows).map(x => ({gl: x.line.gl, name: x.line.name, section: x.line.section})),
    fees: r.fees.map(f => ({gl: f.gl, name: f.name, mode: f.mode, source: f.source?.kind || null, annual: f.annual}))};
}
async function act(action) {
  if (cs.dirty) await save();
  let reason = null;
  if (action === 'return') { reason = prompt('Reason for returning the budget to the VP:') || ''; if (reason.trim().length < 3) return; }
  if (action === 'submit') {
    const flags = C.companyNoteFlags(cs.result, cs.model.notes);
    if (flags.length && !confirm(`${flags.length} line(s) change more than ±10% and $1,000 from the prior budget without a note. Submit anyway?`)) return;
  }
  if (action === 'approve' && !confirm(`Approve and lock ${cs.budget.name}? Monthly tracking will measure against it.`)) return;
  try {
    cs.budget = await CS.transition(H.central, {budgetId: cs.budget.budget_id, expectedRevision: cs.budget.revision, action, reason, detail: action === 'approve' ? {summary: lockedSummary()} : {}});
    cs.events = await CS.events(H.central, cs.budget.budget_id); cs.vpEditing = false; await loadList();
    H.status('Status: ' + STATUS[cs.budget.status][0]);
  } catch (e) { H.status(e.message, true, 9000); }
  render();
}

/* ---------------- tracking ---------------- */
async function loadTracking() {
  const y = cs.trackYear;
  cs.months = await CS.months(H.central, y);
  cs.approvedForYear = (await CS.approvedFor(H.central, y))[0] || null;
  const periods = C.fiscalPeriods(y);
  if (!cs.trackPeriod || !periods.includes(cs.trackPeriod)) cs.trackPeriod = cs.months.at(-1)?.period || periods[0];
}
function trackingBudget() {
  const periods = C.fiscalPeriods(cs.trackYear);
  if (cs.approvedForYear?.locked_summary?.budgetByGl) return {label: `Approved company budget: ${cs.approvedForYear.name}`, budget: cs.approvedForYear.locked_summary.budgetByGl, lines: cs.approvedForYear.locked_summary.lines || [], periods};
  if (cs.model && cs.model.fiscalYear === cs.trackYear) return {label: `Working budget (${STATUS[st()][0]}) — not yet approved`, budget: Object.fromEntries(Object.entries(cs.result.rows).map(([gl, r]) => [gl, r.monthly])), lines: cs.model.lines, periods};
  const ms = cs.months.map(m => m.payload);
  return {label: 'Entrata budget (no approved ATLAS company budget for this year)', budget: C.budgetFromReports(periods, ms), lines: [], periods, entrata: true};
}
async function saveMonth(action) {
  const m = cs.months.find(x => x.period === cs.trackPeriod);
  if (!m) return;
  try {
    const row = await CS.saveMonth(H.central, {period: m.period, expectedRevision: m.revision, action, payload: m.payload, reason: action === 'review' ? 'Month reviewed' : null});
    Object.assign(m, row); m.dirty = false; H.status(action === 'review' ? `${pm(m.period)} marked reviewed.` : 'Comments saved.');
  } catch (e) { H.status(e.message, true, 9000); }
  render();
}
function trackingWorkbook(t, label) {
  const X = window.XLSX, head = ['Account', 'Account Name', 'Section', 'Actual', 'Budget', '$ Variance', '% Variance', 'YTD Actual', 'YTD Budget', 'YTD $ Variance', 'YTD % Variance', 'Annual Budget', 'Forecast', 'Variance Comments'];
  const rows = t.rows.map(r => [r.gl, r.name, r.section, r.monthActual, r.monthBudget, r.monthVar, r.monthVarPct, r.ytdActual, r.ytdBudget, r.ytdVar, r.ytdVarPct, r.annualBudget, r.forecast, r.comment || '']);
  const tot = (n, o) => [null, n, null, o.monthActual, o.monthBudget, null, null, o.ytdActual, o.ytdBudget, null, null, o.annualBudget, o.forecast, ''];
  const aoa = [['RISE Residential, LLC — Budget vs Actual'], [pm(t.period) + ' · ' + label], [], head, ...rows, [], tot('Total income', t.totals.income), tot('Total expenses', t.totals.expenses), tot('Net operating income', t.totals.noi)];
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), 'Budget vs Actual');
  return X.write(wb, {type: 'array', bookType: 'xlsx'});
}

/* ---------------- rendering ---------------- */
export function render() {
  if (!cs.active) return;
  const s = cs.budget ? STATUS[st()] : null;
  H.$ctx.innerHTML = `<span class="pill">RISE company budget</span><label class="f" style="flex-direction:row;align-items:center;gap:8px">Budget<select class="sel" data-co-ctx="budget"><option value="">${cs.list.length ? 'Choose…' : 'No company budgets yet'}</option>${cs.list.map(b => `<option value="${b.budget_id}" ${cs.budget?.budget_id === b.budget_id ? 'selected' : ''}>${esc(b.name)} · ${STATUS[b.status]?.[0] || b.status}</option>`).join('')}</select></label>
  ${builder() ? '<button class="btn ghost" data-co-act="new">+ New</button>' : ''}<button class="btn ghost" data-co-act="trackonly">Monthly tracking</button><button class="btn ghost" data-co-act="back">Property budgets</button>${s ? `<span class="pill ${s[1]}">${s[0]}${cs.vpEditing ? ' · VP editing' : ''}</span>` : ''}`;
  if (cs.tab === 'tracking' && (!cs.budget || cs.trackOnly)) { H.$app.innerHTML = trackingTab(); return; }
  if (!cs.budget) { H.$app.innerHTML = startView(); return; }
  const banners = [st() === 'approved_locked' ? `<div class="banner lock">Approved and locked${cs.budget.approved_at ? ' ' + new Date(cs.budget.approved_at).toLocaleDateString() : ''}. ${cs.vpEditing ? 'VP edit mode is ON — save requires a reason; the executive re-approves the revision.' : ''}${cs.budget.revised_after_approval ? ' <b>Revised since approval — awaiting executive re-approval.</b>' : ''}</div>` : '',
    cs.model && cs.budget.plan_type === 'reforecast' ? `<div class="banner info">Reforecast: ${cs.model.closedMonths || 0} month(s) with actuals are locked; the rest re-project from drivers.</div>` : '',
    cs.dirty ? '<div class="banner info">Unsaved changes. <button class="btn tiny" data-co-act="save">Save now</button></div>' : ''].join('');
  H.$app.innerHTML = `${cs.result ? kpis() : ''}<nav class="tabs">${TABS.map(([k, l], i) => `<button class="tab ${cs.tab === k ? 'on' : ''}" data-co-tab="${k}"><span class="n">${i + 1}</span>${l}</button>`).join('')}</nav>${banners}${body()}`;
}
function body() {
  if (cs.tab === 'tracking') return trackingTab();
  if (cs.tab === 'setup' || !cs.model) return setupTab();
  return {fees: feesTab, payroll: payrollTab, lines: linesTab, summary: summaryTab}[cs.tab]();
}
function kpis() {
  const T = cs.result.totals;
  const k = (label, a, p, d = '') => `<div class="kpi"><div class="k">${label}</div><div class="v ${a < 0 ? 'neg' : ''}">${money(a)}</div><div class="d">${pctTxt(a, p)} vs prior budget ${money(p)}${d}</div></div>`;
  return `<div class="kpis">${k('Total income', T.annual.income, T.prior.income)}${k('Controllable expenses', T.annual.controllable, T.prior.controllable)}${k('Controllable cash flow', T.annual.controllableCashFlow, T.prior.controllableCashFlow)}${k('Net operating income', T.annual.noi, T.prior.noi)}
  <div class="kpi"><div class="k">Notes needed</div><div class="v">${C.companyNoteFlags(cs.result, cs.model.notes).length}</div><div class="d">±10% and $1,000 vs prior budget without a note</div></div></div>`;
}
function startView() {
  return `<div class="card"><p class="h2">RISE company budget</p><p class="muted">The management company's budget: fee income linked to each property's budget, corporate payroll and G&amp;A, overhead allocations, executive approval, and monthly tracking against Entrata's Budget vs Actual.</p>
  ${builder() ? `<div class="row" style="margin-top:12px"><label class="f">Fiscal year<input class="inp sm" data-co-new="newYear" value="${esc(cs.newYear)}"></label><label class="f">Plan<select class="sel" data-co-new="newPlan"><option value="budget" ${cs.newPlan === 'budget' ? 'selected' : ''}>Budget</option><option value="reforecast" ${cs.newPlan === 'reforecast' ? 'selected' : ''}>Reforecast</option></select></label><button class="btn" data-co-act="create" style="align-self:flex-end">Create</button></div>` : '<p class="muted">You approve company budgets the VP submits.</p>'}</div>
  ${cs.list.length ? `<div class="card"><p class="h2">Company budgets</p>${cs.list.map(b => `<div class="row" style="justify-content:space-between;border-bottom:1px solid #e6ecee;padding:8px 0"><div><b>${esc(b.name)}</b> <span class="muted">· FY${b.fiscal_year} · rev ${b.revision} · ${new Date(b.updated_at).toLocaleDateString()}</span></div><div class="row"><span class="pill ${STATUS[b.status]?.[1]}">${STATUS[b.status]?.[0]}</span><button class="btn ghost tiny" data-co-open="${b.budget_id}">Open</button></div></div>`).join('')}</div>` : ''}`;
}
function setupTab() {
  const reps = [...cs.reports].sort((a, b) => a.period.localeCompare(b.period));
  return `<div class="card"><p class="h2">Sources</p><p class="muted">Upload Entrata's “Income Statement - Budget vs Actual” for RISE Residential, LLC — one or more months of the prior year. The latest report supplies each line's prior annual budget and year-to-date run rate; every report is also saved as that month's actuals and comments for tracking.</p>
  <div class="drop" style="margin:12px 0"><label style="cursor:pointer"><b style="color:var(--navy)">Choose reports</b><input type="file" multiple accept=".xlsx,.xls" data-co-files hidden ${builder() ? '' : 'disabled'}></label></div>
  ${reps.length ? `<table><thead><tr><th>File</th><th>Month</th><th>Year to date</th><th class="r">Accounts</th><th class="r">Comments</th></tr></thead><tbody>${reps.map(r => `<tr><td>${esc(r.file)}</td><td>${pm(r.period)}</td><td>${r.ytdFrom ? pm(r.ytdFrom) + ' – ' + pm(r.ytdTo) : ''}</td><td class="r">${r.lines.length}</td><td class="r">${r.lines.filter(l => l.comment).length}</td></tr>`).join('')}</tbody></table>` : ''}
  <div class="row" style="margin-top:12px"><label class="f">Start each line from<select class="sel" data-co-opt="start"><option value="prior" ${cs.start === 'prior' ? 'selected' : ''}>Prior annual budget</option><option value="runrate" ${cs.start === 'runrate' ? 'selected' : ''}>Year-to-date run rate</option></select></label>
  <label class="f">Inflation on expenses (%)<input class="inp xs" data-co-opt="inflation" value="${esc(cs.inflation)}"></label>
  <button class="btn" data-co-act="build" ${reps.length && builder() ? '' : 'disabled'} style="align-self:flex-end">${cs.model ? 'Rebuild from reports' : 'Build company budget'}</button></div>
  ${cs.model ? '<p class="muted">Rebuilding replaces lines, fees and positions with what the reports say; notes are kept.</p>' : ''}</div>`;
}
function feesTab() {
  const r = cs.result, m = cs.model, opts = sel => `<option value="">Not linked</option>${H.communities.map(c => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  const mon = (i, k, v, blank) => `<select class="sel" data-co-fee="${i}" data-k="${k}" ${dis()}>${blank ? `<option value="">${blank}</option>` : ''}${m.periods.map((p, j) => `<option value="${j}" ${has(v) && num(v) === j ? 'selected' : ''}>${pm(p)}</option>`).join('')}</select>`;
  const prior = gl => num(m.lines.find(l => l.gl === gl)?.prior?.annual);
  return `<div class="card" style="padding:14px 18px"><div class="row" style="justify-content:space-between"><div><p class="h2">Management fee income</p><p class="muted" style="margin:0">Linked lines follow each property's budget (its management fee, GL 6320): the approved budget when there is one, otherwise the latest Budget Builder draft. Flat lines hold a monthly amount; schedules are typed by month (lease-up fees, new projects). Start and end months handle new and ending management.</p></div>
  <div class="row">${canEdit() ? '<button class="btn ghost" data-co-act="refresh">Refresh from property budgets</button><button class="btn ghost" data-co-act="addfee">+ Fee line</button>' : ''}</div></div>${cs.feeNote ? `<div class="banner info" style="margin-top:8px">${esc(cs.feeNote)}</div>` : ''}</div>
  <div class="scroll"><table><thead><tr><th>GL</th><th>Property</th><th>ATLAS community</th><th>Method</th><th class="r">Share %</th><th class="r">Minimum / mo</th><th class="r">Flat / mo</th><th>Starts</th><th>Ends</th><th>Source</th><th class="r">Prior budget</th><th class="r">Budget</th><th class="r">Change</th><th></th></tr></thead><tbody>
  ${r.fees.map((f, i) => `<tr><td class="gl">${esc(f.gl)}</td><td><input class="inp" style="min-width:190px" data-co-fee="${i}" data-k="name" value="${esc(f.name)}" ${dis()}></td><td><select class="sel" data-co-fee="${i}" data-k="communityId" ${dis()}>${opts(f.communityId)}</select></td>
  <td><select class="sel" data-co-fee="${i}" data-k="mode" ${dis()}>${[['linked', 'Linked to property budget'], ['flat', 'Flat monthly'], ['schedule', 'Monthly schedule']].map(([k, l]) => `<option value="${k}" ${f.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
  <td class="r"><input class="inp xs" data-co-fee="${i}" data-k="sharePct" value="${esc(f.sharePct ?? 100)}" ${dis()}></td><td class="r"><input class="inp num" data-co-fee="${i}" data-k="minMonthly" value="${has(f.minMonthly) ? esc(f.minMonthly) : ''}" ${dis()}></td>
  <td class="r"><input class="inp num" data-co-fee="${i}" data-k="flatMonthly" value="${esc(f.flatMonthly ?? '')}" ${dis()}></td><td>${mon(i, 'startMonth', f.startMonth)}</td><td>${mon(i, 'endMonth', f.endMonth, 'Full year')}</td>
  <td>${f.mode !== 'linked' ? '<span class="muted">—</span>' : f.source ? `<span class="chip ${f.source.kind === 'approved' ? 'ok' : 'warn'}">${f.source.kind === 'approved' ? 'Approved budget' : 'Draft ' + esc(String(f.source.status || '').replace('_', ' '))}</span>${f.source.estimatedMonths ? `<br><span class="muted">${f.source.estimatedMonths} mo. estimated</span>` : ''}` : '<span class="chip warn">No property budget yet — flat amount used</span>'}</td>
  <td class="r">${money(prior(f.gl))}</td><td class="r"><b>${money(f.annual)}</b></td><td class="r">${pctTxt(f.annual, prior(f.gl))}</td><td>${canEdit() ? `<button class="linkbtn" data-co-feemonths="${i}">Months</button> <button class="linkbtn" data-co-feedel="${i}">Remove</button>` : ''}</td></tr>
  ${cs.open['fee' + i] ? `<tr class="item"><td></td><td colspan="13"><div class="monthly">${m.periods.map((p, j) => `<label>${pm(p)}<input class="inp num" style="width:100%" data-co-feesched="${i}:${j}" value="${Math.round(f.mode === 'schedule' ? num(f.schedule?.[j]) : f.monthly[j])}" ${dis()}></label>`).join('')}</div><div class="muted">Typing a month switches this line to a monthly schedule.</div></td></tr>` : ''}`).join('')}
  <tr class="tot"><td></td><td colspan="9">Total management fee income</td><td class="r">${money(cs.result.sections[C.FEE_SECTION]?.prior || 0)}</td><td class="r">${money(cs.result.sections[C.FEE_SECTION]?.annual || 0)}</td><td class="r">${pctTxt(cs.result.sections[C.FEE_SECTION]?.annual || 0, cs.result.sections[C.FEE_SECTION]?.prior || 0)}</td><td></td></tr></tbody></table></div>`;
}
function payrollTab() {
  const m = cs.model, r = cs.result, sal = sum(r.salaries);
  const mon = (i, k, v, blank) => `<select class="sel" data-co-pos="${i}" data-k="${k}" ${dis()}><option value="">${blank}</option>${m.periods.map((p, j) => `<option value="${j}" ${has(v) && num(v) === j ? 'selected' : ''}>${pm(p)}</option>`).join('')}</select>`;
  const linked = m.lines.filter(l => ['pctSalaries', 'bonus'].includes(l.driver));
  return `<div class="card" style="padding:14px 18px"><div class="row" style="justify-content:space-between"><div><p class="h2">Corporate payroll</p><p class="muted" style="margin:0">Positions roll up to salaries (6100). Payroll taxes and benefits, and bonuses, are a share of salaries; the salary overhead allocation (8801) follows the Payroll Office total.</p></div>${canEdit() ? '<button class="btn ghost" data-co-act="addpos">+ Position</button>' : ''}</div></div>
  <div class="scroll"><table><thead><tr><th>Position</th><th>Department</th><th class="r">Headcount</th><th class="r">Annual salary</th><th class="r">Raise %</th><th>Raise month</th><th>Start</th><th>End</th><th class="r">Budget</th><th></th></tr></thead><tbody>
  ${m.positions.map((p, i) => `<tr><td><input class="inp" data-co-pos="${i}" data-k="title" value="${esc(p.title)}" ${dis()}></td><td><input class="inp sm" data-co-pos="${i}" data-k="department" value="${esc(p.department || '')}" ${dis()}></td>
  <td class="r"><input class="inp xs" data-co-pos="${i}" data-k="count" value="${esc(p.count)}" ${dis()}></td><td class="r"><input class="inp num" data-co-pos="${i}" data-k="salary" value="${esc(p.salary)}" ${dis()}></td><td class="r"><input class="inp xs" data-co-pos="${i}" data-k="raisePct" value="${esc(p.raisePct || 0)}" ${dis()}></td>
  <td>${mon(i, 'raiseMonth', p.raiseMonth, 'None')}</td><td>${mon(i, 'startMonth', p.startMonth, 'Full year')}</td><td>${mon(i, 'endMonth', p.endMonth, 'Full year')}</td><td class="r"><b>${money(sum(positionMonthly(p)))}</b></td>
  <td>${!p.confirmed ? `<span class="chip warn">Review</span>` : ''} ${canEdit() ? `<button class="linkbtn" data-co-posdel="${i}">Remove</button>` : ''}</td></tr>`).join('')}
  <tr class="sub"><td>Salaries (6100)</td><td></td><td class="r">${m.positions.reduce((t, p) => t + num(p.count), 0)}</td><td colspan="5"></td><td class="r">${money(sal)}</td><td>prior ${money(num(m.lines.find(l => l.gl === '6100')?.prior?.annual))}</td></tr></tbody></table></div>
  <div class="scroll"><table><thead><tr><th>GL</th><th>Account</th><th>Driver</th><th class="r">% of salaries</th><th>Paid in</th><th class="r">Prior budget</th><th class="r">Budget</th></tr></thead><tbody>
  ${linked.map(l => `<tr><td class="gl">${esc(l.gl)}</td><td>${esc(l.name)}</td><td>${C.DRIVERS[l.driver]}</td><td class="r"><input class="inp xs" data-co-line="${esc(l.gl)}" data-k="pct" value="${esc(l.pct)}" ${dis()}></td>
  <td>${l.driver === 'bonus' ? m.periods.map((p, j) => `<label style="font-size:11px;margin-right:4px"><input type="checkbox" data-co-bonusm="${esc(l.gl)}:${j}" ${(l.months || []).map(num).includes(j) ? 'checked' : ''} ${dis()}>${MON[num(p.slice(5)) - 1]}</label>`).join('') : 'Monthly'}</td>
  <td class="r">${money(num(l.prior?.annual))}</td><td class="r"><b>${money(cs.result.rows[l.gl]?.annual || 0)}</b></td></tr>`).join('')}</tbody></table></div>`;
}
function linesTab() {
  const r = cs.result, m = cs.model;
  const secs = [...C.ALL_SECTIONS.filter(x => x !== C.FEE_SECTION), ...Object.keys(r.sections).filter(x => !C.ALL_SECTIONS.includes(x))].filter(x => r.sections[x]);
  const drv = l => `<select class="sel" data-co-line="${esc(l.gl)}" data-k="driver" ${dis() || (['payroll', 'fee'].includes(l.driver) ? 'disabled' : '')}>${Object.entries(C.DRIVERS).filter(([k]) => !['payroll', 'fee'].includes(k) || k === l.driver).map(([k, v]) => `<option value="${k}" ${l.driver === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const param = l => l.driver === 'fixed' ? `<input class="inp num" data-co-line="${esc(l.gl)}" data-k="annual" value="${Math.round(num(l.annual))}" ${dis()} title="Annual amount"> + <input class="inp xs" data-co-line="${esc(l.gl)}" data-k="growthPct" value="${esc(l.growthPct || 0)}" ${dis()} title="Growth %">%`
    : ['pctSalaries', 'bonus', 'allocation'].includes(l.driver) ? `<input class="inp xs" data-co-line="${esc(l.gl)}" data-k="pct" value="${esc(l.pct)}" ${dis()}>%${l.driver === 'allocation' ? ` of ${esc(l.base || l.section)}` : ''}` : l.driver === 'schedule' ? 'By month' : '';
  const row = x => { const l = x.line, gl = l.gl, note = m.notes?.[gl] ?? '', open = cs.openGL[gl];
    const flag = Math.abs(x.annual - x.prior) > 1000 && (x.prior ? Math.abs((x.annual - x.prior) / x.prior) > 0.1 : x.annual !== 0) && !String(note).trim();
    return `<tr><td class="gl">${esc(gl)}</td><td><b>${esc(l.name)}</b><br><button class="linkbtn" data-co-gl="${esc(gl)}">${open ? 'Hide' : 'Months'}</button></td><td>${drv(l)}</td><td>${param(l)}</td>
    <td class="r">${money(x.prior)}</td><td class="r">${money(x.runRate)}</td><td class="r"><input class="inp num" data-co-ov="${esc(gl)}" value="${Math.round(x.annual)}" ${dis() || (['payroll', 'fee'].includes(x.driver) || x.locked.some(Boolean) ? 'disabled' : '')}>${x.overridden && canEdit() ? `<br><button class="linkbtn" data-co-reset="${esc(gl)}">Reset to driver</button>` : ''}</td>
    <td class="r">${pctTxt(x.annual, x.prior)}</td><td>${flag ? '<span class="chip warn">Note needed</span>' : ''}<input class="inp note" data-co-note="${esc(gl)}" value="${esc(note)}" placeholder="Note" ${dis()}></td></tr>
    ${open ? `<tr class="item"><td></td><td colspan="8"><div class="monthly">${m.periods.map((p, i) => `<label>${pm(p)}${x.locked[i] ? ' (actual)' : ''}<input class="inp num" style="width:100%" data-co-mon="${esc(gl)}:${i}" value="${Math.round(x.monthly[i])}" ${dis() || (['payroll', 'fee'].includes(x.driver) || x.locked[i] ? 'disabled' : '')}></label>`).join('')}</div></td></tr>` : ''}`; };
  return `<div class="card" style="padding:14px 18px"><div class="row" style="justify-content:space-between"><div><p class="h2">Expenses & other income</p><p class="muted" style="margin:0">Each line is an annual amount (with growth), a monthly schedule, a share of salaries, or an overhead allocation — a share of its section charged out to the properties (entered as a positive %; it posts as a credit).</p></div>${canEdit() ? '<button class="btn ghost" data-co-act="addgl">+ GL code</button>' : ''}</div></div>
  <div class="scroll"><table><thead><tr><th>GL</th><th>Account</th><th>Driver</th><th>Inputs</th><th class="r">Prior budget</th><th class="r">YTD run rate</th><th class="r">Budget</th><th class="r">vs prior</th><th style="min-width:220px">Note</th></tr></thead><tbody>
  ${secs.map(sec => { const S = r.sections[sec], open = cs.open[sec] !== false; return `<tr class="sec"><td colspan="9"><button data-co-sec="${esc(sec)}">${open ? '▾' : '▸'} ${esc(sec)} · ${S.lines.length}</button></td></tr>${open ? S.lines.sort((a, b) => a.line.gl.localeCompare(b.line.gl)).map(row).join('') : ''}<tr class="sub"><td></td><td>Total ${esc(sec)}</td><td colspan="2"></td><td class="r">${money(S.prior)}</td><td class="r">${money(S.runRate)}</td><td class="r">${money(S.annual)}</td><td class="r">${pctTxt(S.annual, S.prior)}</td><td></td></tr>`; }).join('')}</tbody></table></div>`;
}
function summaryTab() {
  const T = cs.result.totals, s = st();
  const steps = [['draft', 'VP draft', 'VP builds and submits'], ['executive_review', 'Executive review', 'Approver reviews'], ['approved_locked', 'Approved & locked', 'Tracking measures against it']];
  const idx = steps.findIndex(x => x[0] === s);
  const btn = (a, l, cls = 'btn') => `<button class="${cls}" data-co-flow="${a}" ${cs.busy ? 'disabled' : ''}>${l}</button>`;
  const actions = [];
  if (s === 'draft' && builder()) actions.push(btn('submit', 'Submit for executive approval'));
  if (s === 'executive_review' && approver()) actions.push(btn('approve', 'Approve & lock'), btn('return', 'Return to VP', 'btn warn'));
  if (s === 'approved_locked' && builder()) actions.push(`<button class="btn ghost" data-co-act="vpedit">${cs.vpEditing ? 'Stop VP edit' : 'VP edit (logged)'}</button>`);
  if (s === 'approved_locked' && approver() && cs.budget.revised_after_approval) actions.push(btn('approve', 'Approve revision'));
  const line = (name, k, cls = '') => `<tr class="${cls}"><td>${name}</td><td class="r">${money(T.prior[k])}</td><td class="r">${money(T.runRate[k])}</td><td class="r"><b>${money(T.annual[k])}</b></td><td class="r">${pctTxt(T.annual[k], T.prior[k])}</td></tr>`;
  return `<div class="card"><p class="h2">Approval</p><div class="step">${steps.map((x, i) => `<div class="st ${i < idx ? 'done' : i === idx ? 'cur' : ''}"><b>${x[1]}</b>${x[2]}</div>`).join('')}</div>
  <div class="row">${actions.join('')}${cs.vpEditing ? `<label class="f" style="flex:1 1 280px">Reason for VP edit (logged)<input class="inp" data-co-vpreason value="${esc(cs.vpReason)}"></label><button class="btn" data-co-act="save">Save VP edit</button>` : ''}</div>
  ${builder() ? `<div class="row" style="margin-top:12px"><label class="f" style="flex:1 1 280px">Executive approver (ATLAS account email)<input class="inp" data-co-approver value="${esc(cs.approverEmail)}" placeholder="name@risere.com"></label><button class="btn ghost" data-co-act="approver" style="align-self:flex-end">Designate approver</button></div><p class="muted">The approver must be someone other than you. They see only the company budget's review and tracking.</p>` : ''}
  <div style="margin-top:14px"><p class="h3">Activity</p>${cs.events.slice(0, 30).map(e => `<div class="log"><b>${esc(e.action.replaceAll('_', ' '))}</b> · ${esc(e.actor_role)} · ${new Date(e.created_at).toLocaleString()}${e.reason ? ' — ' + esc(e.reason) : ''}</div>`).join('') || '<p class="muted">No activity yet.</p>'}</div></div>
  <div class="scroll"><table><thead><tr><th>Summary</th><th class="r">Prior budget</th><th class="r">YTD run rate</th><th class="r">Budget</th><th class="r">vs prior</th></tr></thead><tbody>
  ${line('Total income', 'income', 'sub')}${cs.result.groups.map(g => `<tr><td>${esc(g.name)}</td><td class="r">${money(g.prior)}</td><td class="r"></td><td class="r">${money(g.final)}</td><td class="r">${pctTxt(g.final, g.prior)}</td></tr>`).join('')}
  ${line('Controllable expenses', 'controllable', 'sub')}${line('Controllable cash flow', 'controllableCashFlow', 'tot')}${line('Taxes & insurance', 'taxesInsurance')}${line('Net operating income', 'noi', 'tot')}</tbody></table></div>
  <div class="scroll"><table><thead><tr><th></th>${cs.model.periods.map(p => `<th class="r">${pm(p)}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>${[['Income', 'income'], ['Expenses', 'expenses'], ['NOI', 'noi']].map(([l, k]) => `<tr class="${k === 'noi' ? 'tot' : ''}"><td>${l}</td>${cs.result.monthly[k].map(v => `<td class="r">${money(v)}</td>`).join('')}<td class="r"><b>${money(sum(cs.result.monthly[k]))}</b></td></tr>`).join('')}</tbody></table></div>`;
}
function trackingTab() {
  if (!cs.trackLoaded) return '<div class="card">Loading monthly actuals…</div>';
  const periods = C.fiscalPeriods(cs.trackYear), tb = trackingBudget(), m = cs.months.find(x => x.period === cs.trackPeriod);
  const opts = periods.map(p => { const x = cs.months.find(y => y.period === p); return `<option value="${p}" ${p === cs.trackPeriod ? 'selected' : ''}>${pm(p)}${x ? (x.status === 'reviewed' ? ' ✓ reviewed' : ' · uploaded') : ''}</option>`; }).join('');
  const head = `<div class="card" style="padding:14px 18px"><div class="row" style="justify-content:space-between"><div><p class="h2">Monthly tracking — FY${cs.trackYear}</p><p class="muted" style="margin:0">Measured against: <b>${esc(tb.label)}</b>. Upload Entrata's Budget vs Actual each month; its comments are kept. Lines over ±10% and $1,000 (month or year to date) need a comment before the month is marked reviewed.</p></div>
  <div class="row"><label class="f">Year<input class="inp xs" data-co-trackyear value="${cs.trackYear}"></label><label class="f">Month<select class="sel" data-co-trackperiod>${opts}</select></label><label class="btn ghost" style="cursor:pointer;align-self:flex-end">Upload report<input type="file" accept=".xlsx,.xls" multiple data-co-trackfiles hidden ${builder() ? '' : 'disabled'}></label></div></div></div>`;
  if (!m) return head + `<div class="card"><p class="muted">No actuals for ${pm(cs.trackPeriod)} yet. Upload that month's Budget vs Actual report.</p></div>`;
  let t;
  try { t = C.trackCompany({periods, budget: tb.budget, lines: tb.lines, months: cs.months.map(x => x.payload), period: cs.trackPeriod, reportYtdBudget: !!tb.entrata}); } catch (e) { return head + `<div class="card">${esc(e.message)}</div>`; }
  cs.lastTracking = {t, label: tb.label};
  const v = (x, p) => `<span class="${x < 0 ? 'neg' : ''}">${money(x)}</span>${p === null || p === undefined ? '' : `<br><span class="muted">${(p * 100).toFixed(1)}%</span>`}`;
  const bySec = {}; t.rows.forEach(r => (bySec[r.section] ||= []).push(r));
  const secs = [...C.ALL_SECTIONS, ...Object.keys(bySec).filter(x => !C.ALL_SECTIONS.includes(x))].filter(x => bySec[x]);
  const tot = (l, o, cls) => `<tr class="${cls}"><td></td><td>${l}</td><td class="r">${money(o.monthActual)}</td><td class="r">${money(o.monthBudget)}</td><td></td><td class="r">${money(o.ytdActual)}</td><td class="r">${money(o.ytdBudget)}</td><td></td><td class="r">${money(o.annualBudget)}</td><td class="r">${money(o.forecast)}</td><td></td></tr>`;
  const ro = !builder() || m.status === 'reviewed' && !cs.reopen;
  return head + `<div class="kpis"><div class="kpi"><div class="k">NOI · ${pm(t.period)}</div><div class="v">${money(t.totals.noi.monthActual)}</div><div class="d">budget ${money(t.totals.noi.monthBudget)}</div></div>
  <div class="kpi"><div class="k">NOI · year to date</div><div class="v">${money(t.totals.noi.ytdActual)}</div><div class="d">budget ${money(t.totals.noi.ytdBudget)}</div></div>
  <div class="kpi"><div class="k">Full-year forecast</div><div class="v">${money(t.totals.noi.forecast)}</div><div class="d">YTD actual + remaining budget · budget ${money(t.totals.noi.annualBudget)}</div></div>
  <div class="kpi"><div class="k">Comments needed</div><div class="v">${t.needComments}</div><div class="d">${t.mismatches ? `${t.mismatches} line(s) where Entrata's budget differs from ATLAS` : 'Entrata budget matches'}</div></div></div>
  ${t.missingMonths.length ? `<div class="banner info">No report uploaded for ${t.missingMonths.map(pm).join(', ')}. ${t.ytdFromReport ? 'Year-to-date actuals come from this month’s report.' : 'Year to date counts those months as zero.'}</div>` : ''}
  <div class="row" style="margin:10px 0">${builder() ? `<button class="btn ghost" data-co-act="monthsave" ${m.dirty ? '' : 'disabled'}>Save comments</button><button class="btn" data-co-act="monthreview" ${t.needComments ? 'disabled title="Add the needed comments first"' : ''}>${m.status === 'reviewed' ? 'Reviewed ✓ — save again' : 'Mark month reviewed'}</button>` : ''}<button class="btn ghost" data-co-act="trackxlsx">Download month</button><span class="muted">${m.status === 'reviewed' ? `Reviewed ${new Date(m.reviewed_at).toLocaleDateString()}` : 'Not yet reviewed'} · ${esc(m.source?.file || '')}</span></div>
  <div class="scroll"><table><thead><tr><th>GL</th><th>Account</th><th class="r">Actual</th><th class="r">Budget</th><th class="r">Variance</th><th class="r">YTD actual</th><th class="r">YTD budget</th><th class="r">YTD variance</th><th class="r">Annual budget</th><th class="r">Forecast</th><th style="min-width:260px">Variance comment</th></tr></thead><tbody>
  ${secs.map(sec => `<tr class="sec"><td colspan="11">${esc(sec)}</td></tr>${bySec[sec].sort((a, b) => a.gl.localeCompare(b.gl)).map(r => `<tr><td class="gl">${esc(r.gl)}</td><td>${esc(r.name)}${r.entrataMismatch ? `<br><span class="chip warn" title="Entrata budget ${money(r.entrataBudget)}">Entrata budget ${money(r.entrataBudget)}</span>` : ''}</td>
  <td class="r">${money(r.monthActual)}</td><td class="r">${money(r.monthBudget)}</td><td class="r">${v(r.monthVar, r.monthVarPct)}</td><td class="r">${money(r.ytdActual)}</td><td class="r">${money(r.ytdBudget)}</td><td class="r">${v(r.ytdVar, r.ytdVarPct)}</td><td class="r">${money(r.annualBudget)}</td><td class="r">${money(r.forecast)}</td>
  <td>${r.needsComment ? '<span class="chip warn">Comment needed</span>' : ''}<textarea class="inp note" rows="2" style="width:100%" data-co-comment="${esc(r.gl)}" ${ro ? 'disabled' : ''}>${esc(r.comment)}</textarea></td></tr>`).join('')}`).join('')}
  ${tot('Total income', t.totals.income, 'sub')}${tot('Total expenses', t.totals.expenses, 'sub')}${tot('Net operating income', t.totals.noi, 'tot')}</tbody></table></div>`;
}

async function openTracking(year) {
  cs.tab = 'tracking'; cs.trackLoaded = false; if (year) cs.trackYear = Number(year); render();
  try { await loadTracking(); } catch (e) { H.status(e.message, true); }
  cs.trackLoaded = true; render();
}

/* ---------------- events ---------------- */
document.addEventListener('click', async e => {
  if (!cs.active) return;
  const t = e.target.closest('[data-co-act],[data-co-tab],[data-co-open],[data-co-flow],[data-co-sec],[data-co-gl],[data-co-reset],[data-co-feedel],[data-co-feemonths],[data-co-posdel]');
  if (!t) return;
  const d = t.dataset, m = cs.model;
  if (d.coTab) { if (d.coTab === 'tracking') { cs.trackOnly = false; await openTracking(cs.budget?.fiscal_year); } else { cs.tab = d.coTab; render(); } return; }
  if (d.coOpen) { cs.trackOnly = false; await openBudget(d.coOpen).catch(err => H.status(err.message, true)); return; }
  if (d.coFlow) { await act(d.coFlow); return; }
  if (d.coSec) { cs.open[d.coSec] = cs.open[d.coSec] === false; render(); return; }
  if (d.coGl) { cs.openGL[d.coGl] = !cs.openGL[d.coGl]; render(); return; }
  if (d.coReset) { delete m.overrides[d.coReset]; mark(); return; }
  if (d.coFeedel) { const f = m.fees[num(d.coFeedel)]; if (confirm(`Remove ${f.name}?`)) { m.fees.splice(num(d.coFeedel), 1); if (!m.fees.some(x => x.gl === f.gl)) m.lines = m.lines.filter(l => l.gl !== f.gl); mark(); } return; }
  if (d.coFeemonths) { cs.open['fee' + d.coFeemonths] = !cs.open['fee' + d.coFeemonths]; render(); return; }
  if (d.coPosdel) { m.positions.splice(num(d.coPosdel), 1); mark(); return; }
  switch (d.coAct) {
    case 'back': if (cs.dirty && !confirm('Leave with unsaved changes?')) return; cs.dirty = false; close(); break;
    case 'new': cs.budget = null; cs.model = null; cs.result = null; cs.tab = 'setup'; cs.trackOnly = false; render(); break;
    case 'trackonly': cs.trackOnly = true; await openTracking(cs.trackYear); break;
    case 'create': {
      const y = num(cs.newYear); if (y < 2000 || y > 2100) { H.status('Enter the fiscal year.', true); return; }
      cs.budget = {budget_id: CS.uuid(), revision: 0, status: 'draft', fiscal_year: y, plan_type: cs.newPlan, name: `RISE Residential FY${y} ${cs.newPlan === 'reforecast' ? 'Reforecast' : 'Budget'}`};
      cs.model = null; cs.result = null; cs.reports = []; cs.events = []; cs.tab = 'setup'; render(); break;
    }
    case 'build': t.disabled = true; try { await build(); } finally { render(); } break;
    case 'save': await save(); break;
    case 'refresh': await refreshFees(true); break;
    case 'vpedit': cs.vpEditing = !cs.vpEditing; render(); break;
    case 'addfee': {
      const gl = (prompt('Fee GL code (41xx):') || '').trim(); if (!/^\d{4}$/.test(gl)) return;
      const name = (prompt('Property name:') || '').trim(); if (!name) return;
      if (!m.lines.some(l => l.gl === gl)) m.lines.push({gl, name: 'Mgmt Fee - ' + name, section: C.FEE_SECTION, driver: 'fee', prior: {annual: 0}, note: ''});
      m.fees.push({gl, name, communityId: C.suggestCommunity({name}, H.communities), mode: 'flat', flatMonthly: 0, sharePct: 100, minMonthly: null, schedule: null, startMonth: 0, endMonth: null, source: null});
      if (m.fees.at(-1).communityId) { m.fees.at(-1).mode = 'linked'; await refreshFees(false); }
      mark(); break;
    }
    case 'addpos': m.positions.push({id: CS.uuid(), title: 'New position', department: '', gl: '6100', count: 1, salary: 0, raisePct: 0, raiseMonth: null, startMonth: null, endMonth: null, confirmed: true}); mark(); break;
    case 'addgl': {
      const gl = (prompt('GL code (4 digits):') || '').trim(); if (!/^\d{4}$/.test(gl) || m.lines.some(l => l.gl === gl)) return;
      const name = (prompt('Account name:') || '').trim(); if (!name) return;
      const section = prompt('Section (e.g. General & Administrative):', 'General & Administrative') || 'General & Administrative';
      m.lines.push({gl, name, section: C.normalizeCompanySection(section) || section, driver: 'fixed', annual: 0, growthPct: 0, prior: {annual: 0}, note: 'Added GL'}); mark(); break;
    }
    case 'approver': {
      const email = cs.approverEmail.trim(); if (!/^[^@\s]+@[^@\s]+$/.test(email)) { H.status('Enter the approver’s ATLAS email.', true); return; }
      try { await CS.setApprover(H.central, email, true); H.status(`${email} can now review and approve the company budget.`); } catch (err) { H.status(err.message, true, 9000); }
      break;
    }
    case 'monthsave': await saveMonth('save'); break;
    case 'monthreview': await saveMonth('review'); break;
    case 'trackxlsx': {
      if (!cs.lastTracking) return;
      const bytes = trackingWorkbook(cs.lastTracking.t, cs.lastTracking.label);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})); a.download = `RISE Residential ${cs.trackPeriod} Budget vs Actual.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      break;
    }
  }
});

document.addEventListener('change', async e => {
  if (!cs.active) return;
  const t = e.target, d = t.dataset, m = cs.model;
  if (d.coCtx === 'budget') { if (t.value) { cs.trackOnly = false; await openBudget(t.value).catch(err => H.status(err.message, true)); } return; }
  if (d.coNew) { cs[d.coNew] = t.value; return; }
  if (d.coOpt) { cs[d.coOpt] = d.coOpt === 'inflation' ? num(t.value) : t.value; return; }
  if (t.matches('[data-co-files]')) { await readReports([...t.files]); render(); return; }
  if (t.matches('[data-co-trackfiles]')) {
    cs.reports = []; await readReports([...t.files]);
    try { const n = await saveReportMonths(cs.reports); H.status(`${n} month(s) saved.`); if (cs.reports[0]) { cs.trackYear = Number(cs.reports.at(-1).period.slice(0, 4)); cs.trackPeriod = cs.reports.at(-1).period; } } catch (err) { H.status(err.message, true, 9000); }
    await openTracking(cs.trackYear); return;
  }
  if (t.matches('[data-co-trackyear]')) { await openTracking(num(t.value)); return; }
  if (t.matches('[data-co-trackperiod]')) { cs.trackPeriod = t.value; render(); return; }
  if (t.matches('[data-co-approver]')) { cs.approverEmail = t.value; return; }
  if (t.matches('[data-co-vpreason]')) { cs.vpReason = t.value; return; }
  if (d.coComment !== undefined) { const mo = cs.months.find(x => x.period === cs.trackPeriod); if (!mo) return; (mo.payload.comments ||= {})[d.coComment] = t.value.trim(); if (!t.value.trim()) delete mo.payload.comments[d.coComment]; mo.dirty = true; render(); return; }
  if (!m) return;
  if (d.coFee !== undefined && d.k) {
    const f = m.fees[num(d.coFee)], k = d.k;
    if (['name', 'mode', 'communityId'].includes(k)) f[k] = t.value || null; else f[k] = t.value === '' ? null : num(t.value);
    if (k === 'communityId' && f.communityId && f.mode !== 'schedule') f.mode = 'linked';
    if (k === 'mode' && f.mode === 'schedule' && !f.schedule) f.schedule = cs.result.fees[num(d.coFee)].monthly.slice();
    if ((k === 'communityId' || k === 'mode') && f.mode === 'linked') { await refreshFees(false); }
    mark(); return;
  }
  if (d.coFeesched) { const [i, j] = d.coFeesched.split(':').map(num), f = m.fees[i]; if (f.mode !== 'schedule') { f.schedule = cs.result.fees[i].monthly.slice(); f.mode = 'schedule'; } f.schedule[j] = num(t.value); mark(); return; }
  if (d.coPos !== undefined && d.k) { const p = m.positions[num(d.coPos)]; p[d.k] = ['title', 'department'].includes(d.k) ? t.value : (t.value === '' ? null : num(t.value)); p.confirmed = true; mark(); return; }
  if (d.coLine && d.k) {
    const l = m.lines.find(x => x.gl === d.coLine); if (!l) return;
    if (d.k === 'driver') {
      const cur = cs.result.rows[l.gl]; l.driver = t.value;
      if (t.value === 'fixed') { l.annual = Math.round(cur?.annual || 0); l.growthPct = 0; }
      if (t.value === 'schedule') l.monthly = (cur?.monthly || Array(12).fill(0)).slice();
      if (t.value === 'allocation') { l.base ||= l.section; l.pct ||= 0; }
      if (['pctSalaries', 'bonus'].includes(t.value)) { const s = sum(cs.result.salaries); l.pct = s ? Math.round((cur?.annual || 0) / s * 1e6) / 1e4 : 0; if (t.value === 'bonus') l.months ||= [11]; }
    } else l[d.k] = num(t.value);
    mark(); return;
  }
  if (d.coBonusm) { const [gl, j] = d.coBonusm.split(':'), l = m.lines.find(x => x.gl === gl), ms = new Set((l.months || []).map(num)); t.checked ? ms.add(num(j)) : ms.delete(num(j)); l.months = [...ms].sort((a, b) => a - b); mark(); return; }
  if (d.coOv) { m.overrides[d.coOv] = num(t.value); mark(); return; }
  if (d.coMon) { const [gl, i] = d.coMon.split(':'); const arr = Array.isArray(m.overrides[gl]) ? m.overrides[gl].slice() : cs.result.rows[gl].monthly.slice(); arr[num(i)] = num(t.value); m.overrides[gl] = arr; mark(); return; }
  if (d.coNote !== undefined) { m.notes ||= {}; m.notes[d.coNote] = t.value; cs.dirty = true; recalc(); render(); return; }
});
