const email = value => String(value || '').trim().toLowerCase();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const active = value => /active/i.test(String(value || '')) && !/inactive|terminated|archived/i.test(String(value || ''));
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
const internal = value => /@(risere|riseresidential)\.com$/.test(value);
const list = value => (Array.isArray(value) ? value : String(value || '').split(/[;,\n]/)).map(item => email(item?.email || item)).filter(validEmail);

// Recipients are resolved at delivery, never from the old snapshot's email.
// The supplied query is the existing server-only service client. No roster or
// portfolio data is exposed to the browser through this function.
export async function resolveCurrentDlrRecipients(subscription, query, today = new Date().toISOString().slice(0, 10)) {
  const id = subscription.community_id, config = subscription.recipient_config || {};
  if (!uuid(id)) throw Error('Current-contact delivery requires a recognized community. Publish its server snapshot again.');
  const communities = await query(`/rest/v1/atlas_communities?community_id=eq.${id}&deleted_at=is.null&select=community_id,display_name,canonical_name&limit=2`);
  const community = communities?.[0];
  if (communities?.length !== 1 || ![community.display_name, community.canonical_name].includes(subscription.community_name)) throw Error('The scheduled community identity changed. Review its recipient settings.');
  const recipients = [];
  const selected = new Set((config.employeeRecipientIds || []).filter(uuid));
  const roles = new Set(config.roleRecipients || []);
  if (selected.size || roles.size) {
    const rows = await query(`/rest/v1/atlas_employee_assignments?community_id=eq.${id}&deleted_at=is.null&effective_start=lte.${today}&or=(effective_end.is.null,effective_end.gte.${today})&select=employee_id,community_id,employment_status,effective_start,effective_end,atlas_employees(employee_id,email,full_name,status,deleted_at),atlas_roles(bonus_role_type,role_code)&limit=1000`);
    if (rows?.length >= 1000) throw Error('The current roster exceeds the verified recipient lookup limit.');
    for (const row of rows || []) {
      const person = row.atlas_employees, role = row.atlas_roles || {};
      const roleMatch = (roles.has('general_manager') && role.bonus_role_type === 'gm') || (roles.has('regional_manager') && (role.bonus_role_type === 'regional' || /^(regional_manager|rm)$/i.test(role.role_code || '')));
      if (row.community_id !== id || !person || person.employee_id !== row.employee_id || person.deleted_at || !active(person.status) || !active(row.employment_status)) continue;
      if (!row.effective_start || row.effective_start > today || (row.effective_end && row.effective_end < today)) continue;
      const address = email(person.email);
      if ((selected.has(person.employee_id) || roleMatch) && validEmail(address) && internal(address)) recipients.push(address);
    }
  }
  if (config.toInvestorContacts) {
    // Read only the current parent's small receipt, then its exact projection.
    // Never fall back to stale contacts if canonical publication is incomplete.
    const parentPath = '/rest/v1/atlas_app_documents?document_key=eq.atlas_dashboard_state_v1&module_key=eq.dashboard&deleted_at=is.null&select=document_key,version,updated_at,archiveHash:payload->bundle->>sha256&limit=1';
    const parent = (await query(parentPath))?.[0];
    if (!parent || !/^[a-f0-9]{64}$/.test(parent.archiveHash || '')) throw Error('Current saved investor contacts are unavailable.');
    const key = `atlas_workspace_projection_v1:${parent.archiveHash}:${parent.version}`;
    const projection = (await query(`/rest/v1/atlas_app_documents?document_key=eq.${encodeURIComponent(key)}&module_key=eq.dashboard&source_module=eq.workspace_projection&deleted_at=is.null&select=source:payload->source,communityData:payload->communityData&limit=1`))?.[0];
    const source = projection?.source;
    if (!source || source.documentKey !== parent.document_key || source.version !== parent.version || source.archiveHash !== parent.archiveHash || Date.parse(source.effectiveAt) !== Date.parse(parent.updated_at)) throw Error('Current saved investor contacts do not match the published workspace.');
    const matches = Object.entries(projection.communityData || {}).filter(([name, record]) => {
      if (!record || typeof record !== 'object') return false;
      const ids = [record.atlasCommunityId, record.sourceIds?.atlasCommunityId, uuid(record.communityId) ? record.communityId : ''].filter(Boolean);
      return ids.length ? ids.every(value => value === id) : [community.display_name, community.canonical_name].includes(name);
    });
    if (matches.length !== 1) throw Error('Current investor contacts do not have one exact community match.');
    recipients.push(...list(matches[0][1].investorEmailContacts || []));
    const latest = (await query(parentPath))?.[0];
    if (JSON.stringify(latest) !== JSON.stringify(parent)) throw Error('Saved contacts changed while preparing delivery. Retry with the current workspace.');
  }
  const to = [...new Set(recipients)], seen = new Set(to);
  const dedupe = values => list(values).filter(value => { if (seen.has(value)) return false; seen.add(value); return true; });
  return { to, cc: dedupe(config.cc), bcc: dedupe(config.bcc) };
}
