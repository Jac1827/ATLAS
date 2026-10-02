const uuid = () => crypto.randomUUID();
const isId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
const nextVersion = (value, previous) => Number.isInteger(value) && value > (previous || 0);

// Each uncertain write retains its request ID until the server confirms it.
// Changing accounts invalidates both reads and writes before they can update the UI.
export function createBonusWorkflowClient(central, { requestId = uuid } = {}) {
  let generation = 0;
  let actor = central.getSession?.()?.user?.id || null;
  const requests = new Map();
  function session() {
    const current = central.getSession?.()?.user?.id || null;
    if (current !== actor) { actor = current; generation++; requests.clear(); }
    if (!current) throw new Error('Sign in to use shared Bonus approvals.');
    return { actor: current, generation };
  }
  async function rpc(name, payload) {
    const started = session();
    const result = await central.fetchJson('/rpc/' + name, { method: 'POST', body: JSON.stringify(payload) });
    session();
    if (actor !== started.actor || generation !== started.generation) throw new Error('Your account changed. Refresh the workspace before continuing.');
    return result;
  }
  async function write(name, payload, verify) {
    session();
    const key = JSON.stringify([actor, name, payload]);
    const id = requests.get(key) || requestId();
    requests.set(key, id);
    const result = await rpc(name, { ...payload, p_request_id: id });
    if (!verify(result)) throw new Error('The saved receipt could not be verified. Refresh shared records before continuing; retrying the same change keeps its original request.');
    requests.delete(key);
    return result;
  }
  return {
    read: communityIds => rpc('atlas_bonus_workspace', { p_community_ids: communityIds || null }),
    savePlan: (planId, expectedVersion, payload) => write('atlas_bonus_plan_save', { p_plan_id: planId || null, p_expected_version: expectedVersion ?? 0, p_payload: payload }, value => isId(value?.id) && nextVersion(value.version, expectedVersion)),
    saveEligibility: (employeeId, expectedVersion, payload) => write('atlas_bonus_eligibility_save', { p_employee_id: employeeId, p_expected_version: expectedVersion, p_payload: payload }, value => value?.employeeId === employeeId && nextVersion(value.employeeVersion, expectedVersion) && value.bonusEligible === payload.bonusEligible && (value.bonusEffectiveDate || null) === (payload.bonusEffectiveDate || null)),
    transition: (runId, action, expectedRevision, payload) => write('atlas_bonus_workflow', { p_run_id: runId || null, p_action: action, p_expected_revision: expectedRevision ?? 0, p_payload: payload }, value => isId(value?.runId) && (!runId || value.runId === runId) && nextVersion(value.revision, expectedRevision) && value.status === ({draft:'draft',recalculate:'draft',submit:'review',approve:'approved',lock:'locked',record_external_payment:'paid',void:'voided'})[action] && /^[0-9a-f]{64}$/i.test(value.calculationHash || '') && typeof value.totalPayout === 'number' && Number.isFinite(value.totalPayout)),
    clear() { generation++; requests.clear(); actor = central.getSession?.()?.user?.id || null; }
  };
}
