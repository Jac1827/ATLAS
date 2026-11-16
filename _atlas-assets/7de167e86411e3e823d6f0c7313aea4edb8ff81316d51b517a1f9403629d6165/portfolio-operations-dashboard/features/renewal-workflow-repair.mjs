// A reviewed history repair never chooses a renewal status or rewrites a source.
const plans = new WeakMap();
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const events = row => Array.isArray(row?.activity) ? row.activity : [];
const eventKey = event => JSON.stringify([String(event?.at || '').trim(), String(event?.label || '').trim()]);
const identity = row => JSON.stringify(['id', 'propertyName', 'residentId', 'leaseId', 'residentName', 'unit', 'expirationDate', 'periodKey'].map(key => String(row?.[key] || '')));
const genericImport = event => object(event) && Number.isFinite(Date.parse(event.at)) && /^(Imported|Refreshed) from .+/.test(String(event.label || ''));

function collectRows(communityData) {
  if (!object(communityData)) throw new Error('The community snapshot is invalid.');
  const rows = new Map();
  for (const [community, record] of Object.entries(communityData)) {
    for (const [periodKey, values] of Object.entries(record?.renewalDetailRowsByPeriod || {})) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey) || !Array.isArray(values)) throw new Error('A renewal cohort is invalid.');
      for (const row of values) {
        if (!object(row) || !row.id) throw new Error('A renewal agreement has no identity.');
        const key = JSON.stringify([community, periodKey, row.id]);
        if (rows.has(key)) throw new Error('A renewal agreement appears twice in the same cohort.');
        rows.set(key, { community, periodKey, row });
      }
    }
  }
  if (rows.size > 25000) throw new Error('The renewal history exceeds this review limit.');
  return rows;
}

function unionPriorEvents(prior, current, sourceDate) {
  const present = new Map(events(current).map(event => [eventKey(event), event]));
  const additions = [];
  for (const event of events(prior)) {
    const key = eventKey(event), existing = present.get(key);
    if (existing) {
      if (!equal(existing, event)) throw new Error('An existing history event differs from the retained snapshot.');
      continue;
    }
    if (!genericImport(event)) throw new Error('Missing workflow activity requires a separate review.');
    if (Date.parse(event.at) > Date.parse(sourceDate) || JSON.stringify(event).length > 65536) throw new Error('The retained import event is invalid.');
    additions.push(clone(event)); present.set(key, event);
  }
  return { additions, activity: [...additions, ...clone(events(current))] };
}

function centralState(raw) {
  if (typeof raw !== 'string' || raw.length > 64 * 1024 * 1024) throw new Error('A current Central Services snapshot is required.');
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('The current Central Services snapshot is invalid.'); }
  if (!object(value) || !Array.isArray(value.renewals)) throw new Error('Current Central Services renewal records are unavailable.');
  const byId = new Map();
  for (let index = 0; index < value.renewals.length; index++) {
    const row = value.renewals[index];
    if (!row?.id || byId.has(row.id)) throw new Error('Central Services agreement identities require review.');
    byId.set(row.id, { row, index });
  }
  return { value, byId };
}

export async function reviewRenewalWorkflowRepair(snapshot, { communityData, centralServicesRaw, sourceHash, digest } = {}) {
  if (snapshot?.app !== 'atlas-rise-ops-dashboard' || snapshot?.snapshotType !== 'atlas_central_migration_read_only_snapshot_v1'
    || snapshot.readOnly !== true || !Number.isFinite(Date.parse(snapshot.generatedAt)) || !/^[a-f0-9]{64}$/.test(sourceHash || '')
    || typeof digest !== 'function') throw new Error('Choose the verified pre-import ATLAS snapshot.');
  const communityBaseline = JSON.stringify(communityData), centralServicesBaseline = centralServicesRaw;
  const current = collectRows(communityData), prior = collectRows(snapshot.indexedDb?.communityData), central = centralState(centralServicesRaw);
  const rows = [], issues = [], scalarComparisons = [], patches = new Map();
  for (const [key, before] of prior) {
    const found = current.get(key);
    if (!found) { issues.push({ community: before.community, periodKey: before.periodKey, id: before.row.id, reason: 'The prior agreement is missing from the current cohort.' }); continue; }
    if (identity(before.row) !== identity(found.row)) {
      issues.push({ community: before.community, periodKey: before.periodKey, id: before.row.id, reason: 'Agreement identity differs from the retained snapshot.' }); continue;
    }
    for (const field of ['notes', 'status', 'nextAction']) {
      if (before.row[field] && !equal(before.row[field], found.row[field])) scalarComparisons.push({ community: before.community, periodKey: before.periodKey, id: before.row.id, field, prior: before.row[field], current: found.row[field], action: 'Keep current value; history repair does not change this field.' });
    }
    try {
      const dashboard = unionPriorEvents(before.row, found.row, snapshot.generatedAt);
      const cs = central.byId.get(found.row.id);
      if (!cs || identity(cs.row) !== identity(found.row)) {
        if (!dashboard.additions.length) continue; // An unaffected cohort may not be loaded in Central Services.
        throw new Error('The current Central Services agreement must match before repairing its history.');
      }
      const csHistory = unionPriorEvents(before.row, cs.row, snapshot.generatedAt);
      if (!dashboard.additions.length && !csHistory.additions.length) continue;
      const row = { key, community: before.community, periodKey: before.periodKey, id: before.row.id,
        missingEvents: new Set([...dashboard.additions, ...csHistory.additions].map(eventKey)).size,
        dashboardMissingEvents: dashboard.additions.length, currentEventCount: events(found.row).length, proposedEventCount: dashboard.activity.length,
        centralMissingEvents: csHistory.additions.length, defaultSelected: true };
      rows.push(row); patches.set(key, { community: before.community, periodKey: before.periodKey, id: before.row.id,
        activity: dashboard.activity, dashboardHasChanges: dashboard.additions.length > 0,
        centralActivity: csHistory.activity, centralIndex: cs.index });
    } catch (error) { issues.push({ community: before.community, periodKey: before.periodKey, id: before.row.id, reason: error.message }); }
  }
  const review = {
    source: { generatedAt: snapshot.generatedAt, sha256: sourceHash, contentHash: await digest(JSON.stringify(snapshot)) },
    communityBaseline, centralServicesBaseline, rows, issues, scalarComparisons,
    counts: { agreements: rows.length, communities: new Set(rows.map(row => row.community)).size,
      historicalEvents: rows.reduce((sum, row) => sum + row.missingEvents, 0), centralHistoricalEvents: rows.reduce((sum, row) => sum + row.centralMissingEvents, 0),
      dashboardHistoricalEvents: rows.reduce((sum, row) => sum + row.dashboardMissingEvents, 0),
      scalarComparisons: scalarComparisons.length, scalarChanges: 0, issues: issues.length }
  };
  plans.set(review, { communityBaseline, centralServicesBaseline, patches, source: clone(review.source), issues: clone(issues), rows: clone(rows) });
  return review;
}

export function applyReviewedRenewalWorkflowRepair(review, { communityData, centralServicesRaw, selectedKeys } = {}) {
  const plan = plans.get(review);
  if (!plan || !equal(review.source, plan.source)) throw new Error('Review the retained history again.');
  if (JSON.stringify(communityData) !== plan.communityBaseline || centralServicesRaw !== plan.centralServicesBaseline) throw new Error('Workspace data changed. Reload and review the retained history again.');
  if (plan.issues.length) throw new Error('Resolve the listed agreement history issues before applying a repair.');
  const selected = selectedKeys === undefined ? plan.rows.map(row => row.key) : selectedKeys;
  if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length || selected.some(key => !plan.patches.has(key))) throw new Error('Select the reviewed agreement histories to restore.');
  const nextCommunityData = clone(communityData), nextCentral = centralState(centralServicesRaw).value;
  let mirrors = 0;
  for (const key of selected) {
    const patch = plan.patches.get(key), record = nextCommunityData[patch.community];
    const row = record.renewalDetailRowsByPeriod[patch.periodKey].find(value => value.id === patch.id);
    if (patch.dashboardHasChanges) {
      row.activity = clone(patch.activity);
      // Mirror only this exact identity and cohort; never replace another year.
      for (const values of Array.isArray(record.renewalDetailRowsByMonth) ? record.renewalDetailRowsByMonth : []) {
        for (const mirror of Array.isArray(values) ? values : []) {
          if (identity(mirror) === identity(row)) { mirror.activity = clone(patch.activity); mirrors++; }
        }
      }
    }
    nextCentral.renewals[patch.centralIndex].activity = clone(patch.centralActivity);
  }
  const chosen = plan.rows.filter(row => selected.includes(row.key));
  return { communityData: nextCommunityData, centralServicesRaw: JSON.stringify(nextCentral),
    counts: { agreements: selected.length, historicalEvents: chosen.reduce((sum, row) => sum + row.missingEvents, 0),
      dashboardHistoricalEvents: chosen.reduce((sum, row) => sum + row.dashboardMissingEvents, 0),
      centralHistoricalEvents: chosen.reduce((sum, row) => sum + row.centralMissingEvents, 0), mirrors, scalarChanges: 0 } };
}
