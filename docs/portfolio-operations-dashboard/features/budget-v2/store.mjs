/* Budget Builder v2 — persistence through ATLAS Central (Supabase).
 * Drafts, workflow transitions, learning observations and investor deliveries use
 * the Budget Builder RPCs; financial publication reuses the governed reforecast store. */
import * as rf from '../reforecast-store.mjs?v=b59fd4df88ff8fe3';
import {persistWorkbookAudit} from '../workbook-audit-store.mjs?v=da818ddb04840b36';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuid = () => crypto.randomUUID();
const rpc = async (central, name, args) => { const data = await central.fetchJson('/rpc/' + name, {method: 'POST', body: JSON.stringify(args)}); return Array.isArray(data) ? data[0] : data; };
const actorOf = central => central.getSession?.()?.user?.id || null;

export function profile(central) {
  const p = central.getStoredProfile?.() || {};
  return {userId: actorOf(central), role: String(p.role || '').toLowerCase(), name: p.display_name || p.full_name || p.email || ''};
}

export async function communities(central) {
  const rows = await central.readCommunitiesForAccess();
  return (rows || []).filter(c => !c.deleted_at).map(c => ({id: c.community_id, name: c.display_name || c.canonical_name, units: c.units || null, market: c.market || ''})).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listDrafts(central, communityId) {
  if (!UUID.test(communityId)) throw Error('Choose a community.');
  return central.fetchJson(`/atlas_budget_builder_drafts?community_id=eq.${communityId}&status=neq.archived&select=draft_id,name,fiscal_year,plan_type,asset_class,status,revision,updated_at,revised_after_approval,publication_id&order=updated_at.desc&limit=50`);
}

export async function readDraft(central, draftId) {
  const rows = await central.fetchJson(`/atlas_budget_builder_drafts?draft_id=eq.${draftId}&select=*&limit=1`);
  if (!rows?.[0]) throw Error('Budget draft unavailable or access denied.');
  return rows[0];
}

export async function readEvents(central, draftId) {
  return central.fetchJson(`/atlas_budget_builder_events?draft_id=eq.${draftId}&select=action,actor_role,from_status,to_status,reason,detail,created_at,revision&order=created_at.desc&limit=200`);
}

/* Save with a stable request ID per change set so a dropped response can be retried safely. */
export async function saveDraft(central, {draftId, communityId, expectedRevision, requestId = uuid(), meta, payload, reason = null}) {
  return rpc(central, 'atlas_budget_builder_save', {p_draft_id: draftId, p_community_id: communityId, p_expected_revision: expectedRevision, p_request_id: requestId, p_meta: meta, p_payload: payload, p_reason: reason});
}

export async function transition(central, {draftId, expectedRevision, action, reason = null, detail = {}, requestId = uuid()}) {
  return rpc(central, 'atlas_budget_builder_transition', {p_draft_id: draftId, p_expected_revision: expectedRevision, p_request_id: requestId, p_action: action, p_reason: reason, p_detail: detail});
}

export async function recordObservations(central, communityId, rows) {
  if (!rows?.length) return 0;
  return rpc(central, 'atlas_budget_learning_record', {p_community_id: communityId, p_rows: rows.slice(0, 500)});
}

export async function benchmarks(central, assetClass = null) {
  return rpc(central, 'atlas_budget_benchmarks', {p_asset_class: assetClass});
}

export async function decisions(central, communityIds) {
  if (!communityIds?.length) return [];
  return central.fetchJson(`/atlas_budget_learning_observations?source_kind=eq.decision&community_id=in.(${communityIds.join(',')})&select=gl_code,value,basis&order=created_at.desc&limit=2000`);
}

/* Fiscal budgets can span two canonical calendar-year segments. Select only
 * versions covering the requested periods and require exactly one per period;
 * an unavailable read must never turn a revision into an initial budget. */
export async function approvedBaseline(central, communityId, periods) {
  if (!UUID.test(communityId) || !Array.isArray(periods) || !periods.length || periods.length > 24 || new Set(periods).size !== periods.length || periods.some(p => !/^20\d{2}-(0[1-9]|1[0-2])$/.test(p))) throw Error('Choose the saved budget community and fiscal periods.');
  const years = [...new Set(periods.map(p => Number(p.slice(0, 4))))].sort((a, b) => a - b);
  const rows = await central.fetchJson(`/atlas_approved_budget_versions?community_id=eq.${communityId}&calendar_year=in.(${years.join(',')})&status=eq.locked&select=version_id,community_id,calendar_year,status,covered_months,payload&limit=200`);
  if (!Array.isArray(rows) || rows.length >= 200 || rows.some(r => !UUID.test(r.version_id) || r.community_id !== communityId || r.status !== 'locked' || !years.includes(r.calendar_year) || !Array.isArray(r.covered_months) || r.covered_months.some(m => !Number.isInteger(m) || m < 0 || m > 11))) throw Error('Approved original budget coverage could not be verified.');
  const selected = new Map();
  for (const period of periods) {
    const matches = rows.filter(r => r.calendar_year === Number(period.slice(0, 4)) && r.covered_months.includes(Number(period.slice(5)) - 1));
    if (matches.length !== 1) throw Error(`Approved original budget coverage is ${matches.length ? 'ambiguous' : 'missing'} for ${period}. Review the approved baseline before publishing.`);
    selected.set(matches[0].version_id, matches[0]);
  }
  return [...selected.values()];
}

export async function sendInvestorPackage(central, {draftId, recipients, requestId = uuid()}) {
  const token = central.getSession?.()?.access_token;
  const base = central.getConfig?.()?.accessApiBaseUrl || location.origin;
  const res = await fetch(new URL('/api/atlas/budget-investor/email', base), {method: 'POST', headers: {'content-type': 'application/json', ...(token ? {authorization: 'Bearer ' + token} : {})}, body: JSON.stringify({draftId, recipients, requestId})});
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw Error(body.error || 'The investor package could not be sent.');
  return body;
}

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* I/O adapter for handoff.governedPublish, backed by the existing governed stores. */
export function governedApi(central) {
  return {
    base64,
    preparePublication: ({draftId, expectedRevision, summary}) => rpc(central, 'atlas_prepare_budget_builder_publication', {p_draft_id: draftId, p_expected_revision: expectedRevision, p_summary: summary}),
    saveAudit: async ({communityId, sourceHash, integrity, bytes, requestId}) => persistWorkbookAudit(central, integrity, {communityId, sourceHash, requestId, sourceBytes: bytes}),
    uploadPayload: ({evidence, audit, assignment, actorId, at}) => ({...evidence, integrity: audit, propertyAssignment: assignment,
      comparison: {priorUploadId: null, firstVersionConfirmed: true, confirmedBy: actorId, confirmedAt: at}}),
    saveUpload: ({communityId, requestId, payload}) => rf.saveUpload(central, {communityId, requestId, payload}),
    readRegistry: async ({communityId}) => {
      const heads = await central.fetchJson(`/atlas_reforecast_registry_heads?community_id=eq.${communityId}&select=version_id&limit=1`);
      if (!heads?.[0]) return null;
      const rows = await central.fetchJson(`/atlas_reforecast_registries?version_id=eq.${heads[0].version_id}&select=*&limit=1`);
      return rows?.[0] || null;
    },
    saveRegistry: ({communityId, expectedVersionId, requestId, payload}) => rf.saveRegistry(central, {communityId, expectedVersionId, requestId, payload}),
    createFromImport: options => rf.createFromImport(central, options),
    saveScenario: options => rf.saveScenario(central, options)
  };
}

/* A community not in ATLAS yet (VP only). */
export async function createCommunity(central, {name, units, propertyType, market, development = false}) {
  const id = await central.fetchJson('/rpc/atlas_budget_builder_create_community', {method: 'POST', body: JSON.stringify({p_name: name, p_units: units, p_property_type: propertyType, p_market: market, p_development: development})});
  const v = Array.isArray(id) ? id[0] : id;
  if (!UUID.test(String(v || ''))) throw Error('The community could not be created.');
  return String(v);
}
