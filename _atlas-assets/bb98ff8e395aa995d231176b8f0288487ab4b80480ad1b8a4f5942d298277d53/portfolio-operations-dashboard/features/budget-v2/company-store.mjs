/* RISE company budget — persistence through ATLAS Central (Supabase RPCs). */
import {calculate} from './engine.mjs?v=0d68529412480755';

export const uuid = () => crypto.randomUUID();
const rpc = async (central, name, args) => { const d = await central.fetchJson('/rpc/' + name, {method: 'POST', body: JSON.stringify(args)}); return Array.isArray(d) ? d[0] : d; };

export async function myRole(central) {
  try { const r = await central.fetchJson('/rpc/atlas_company_budget_my_role', {method: 'POST', body: '{}'}); return typeof r === 'string' ? r : (Array.isArray(r) ? r[0] : r) || null; } catch { return null; }
}
export const list = central => central.fetchJson('/atlas_company_budgets?select=budget_id,fiscal_year,plan_type,name,status,revision,updated_at,revised_after_approval,approved_at,approved_by&status=neq.archived&order=fiscal_year.desc,updated_at.desc&limit=50');
export async function read(central, id) {
  const rows = await central.fetchJson(`/atlas_company_budgets?budget_id=eq.${id}&select=*&limit=1`);
  if (!rows?.[0]) throw Error('Company budget unavailable or access denied.');
  return rows[0];
}
export const approvedFor = async (central, year) => (await central.fetchJson(`/atlas_company_budgets?fiscal_year=eq.${Number(year)}&status=eq.approved_locked&select=budget_id,name,plan_type,locked_summary,approved_at&order=approved_at.desc&limit=5`).catch(() => [])) || [];
export const events = (central, id) => central.fetchJson(`/atlas_company_budget_events?budget_id=eq.${id}&select=action,actor_role,from_status,to_status,reason,created_at,revision&order=created_at.desc&limit=200`).catch(() => []);
export const save = (central, {budgetId, expectedRevision, meta, payload, reason = null, requestId = uuid()}) =>
  rpc(central, 'atlas_company_budget_save', {p_budget_id: budgetId, p_expected_revision: expectedRevision, p_request_id: requestId, p_meta: meta, p_payload: payload, p_reason: reason});
export const transition = (central, {budgetId, expectedRevision, action, reason = null, detail = {}, requestId = uuid()}) =>
  rpc(central, 'atlas_company_budget_transition', {p_budget_id: budgetId, p_expected_revision: expectedRevision, p_request_id: requestId, p_action: action, p_reason: reason, p_detail: detail});
export const months = (central, year) => central.fetchJson(`/atlas_company_budget_months?fiscal_year=eq.${Number(year)}&select=*&order=period.asc`).catch(() => []);
export const saveMonth = (central, {period, expectedRevision, action = 'save', payload, source = {}, reason = null, requestId = uuid()}) =>
  rpc(central, 'atlas_company_budget_month_save', {p_period: period, p_expected_revision: expectedRevision, p_request_id: requestId, p_action: action, p_payload: payload, p_source: source, p_reason: reason});
export const setApprover = (central, email, enabled = true) => rpc(central, 'atlas_company_budget_set_approver', {p_email: email, p_enabled: enabled});

/* Each property's management fee (GL 6320) by month: the approved budget where it
 * exists, otherwise the latest Budget Builder draft (calculated). Property fiscal
 * years may start mid-year, so values are keyed by period. */
export async function propertyFees(central, year) {
  const out = {};
  const add = (cid, kind, ref, periods, monthly, status = null) => {
    const o = out[cid] ||= {kind, ref, status, byPeriod: {}};
    periods.forEach((p, i) => { if (!(p in o.byPeriod) && monthly[i] !== null && monthly[i] !== undefined && String(monthly[i]).trim() !== '' && Number.isFinite(Number(monthly[i]))) o.byPeriod[p] = Number(monthly[i]); });
  };
  for (const y of [Number(year), Number(year) + 1]) {
    const approved = await central.fetchJson(`/atlas_approved_budget_versions?calendar_year=eq.${y}&select=community_id,version_id,payload`).catch(() => []);
    for (const v of approved || []) {
      const row = (v.payload?.rows || []).find(r => String(r.glCode) === '6320');
      if (row?.monthly?.length === 12) add(v.community_id, 'approved', v.version_id, Array.from({length: 12}, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`), row.monthly);
    }
  }
  const drafts = await central.fetchJson(`/atlas_budget_builder_drafts?fiscal_year=in.(${Number(year)},${Number(year) + 1})&status=neq.archived&plan_type=eq.budget&select=draft_id,community_id,status,payload,updated_at&order=updated_at.desc`).catch(() => []);
  for (const d of drafts || []) {
    const m = d.payload?.model;
    if (!m?.periods || out[d.community_id]?.kind === 'approved') continue;
    try { const r = calculate(m).rows['6320']; if (r) add(d.community_id, out[d.community_id]?.kind || 'draft', out[d.community_id]?.ref || d.draft_id, m.periods, r.monthly, d.status); } catch { /* unreadable draft skipped */ }
  }
  return out;
}
