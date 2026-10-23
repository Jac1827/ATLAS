// Exercise the actual People loader, settings write/readback, clean publication
// acknowledgement and fresh-page hydration against an IndexedDB-shaped fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js', 'utf8');
const extract = name => {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  const end = source.indexOf('\n}', start);
  assert(start >= 0 && end > start, `Missing actual function ${name}`);
  return source.slice(start, end + 2);
};
const OPS = 'ops', COMMUNITIES = 'communities', RECEIPT = 'atlas_workspace_source_v2', HISTORY = 'history';
const clone = value => structuredClone(value);
const centralRows = [{
  assignment_id: 'assignment-1', version: 3, effective_start: '2026-01-01', effective_end: null,
  title: 'Community Manager', employment_status: 'Active', primary_assignment: true,
  updated_at: '2026-10-20T12:00:00.000Z',
  atlas_employees: {employee_id: 'employee-1', full_name: 'Synthetic Person', status: 'Active', email: 'fixture@example.invalid'},
  atlas_communities: {community_id: 'community-1', display_name: 'Synthetic Community'},
  atlas_roles: {role_id: 'role-1', title: 'Community Manager', bonus_role_type: 'manager'}
}];

function fixture(seed) {
  const records = new Map(seed ? clone([...seed]) : [
    [COMMUNITIES, {key: COMMUNITIES, value: {'Synthetic Community': {occupied: 10}}, updatedAt: 'before'}],
    [HISTORY, {key: HISTORY, value: {revision: 7, retainedBeforeSnapshots: ['original evidence']}, updatedAt: 'before'}],
    [RECEIPT, {key: RECEIPT, value: {identity: {version: 4}, dirty: true}, updatedAt: 'before'}]
  ]);
  const state = {now: '2026-10-23T14:00:00.000Z', rows: clone(centralRows), queue: Promise.resolve(), puts: [], errors: []};
  const withStore = async (mode, action) => {
    const pending = [], writes = [];
    const store = {
      get(key) {
        const request = {};
        pending.push(() => {request.result = clone(records.get(key)); request.onsuccess?.();});
        return request;
      },
      put(record) {assert.equal(mode, 'readwrite'); writes.push(clone(record));}
    };
    const request = action(store);
    for (const run of pending) run();
    for (const record of writes) {records.set(record.key, record); state.puts.push(record.key);}
    return request?.result ?? null;
  };
  class Clock extends Date {
    constructor(...args) {super(...(args.length ? args : [state.now]));}
    static now() {return Date.parse(state.now);}
  }
  const context = {
    Date: Clock, Blob, Response, DecompressionStream, DOMException,
    ATLAS_STATE_COMMUNITY_KEY: COMMUNITIES, OPS_GLOBAL_STORAGE_KEY: OPS, ATLAS_STATE_DB_NAME: 'verified-workspace',
    withAtlasStateStore: withStore, openAtlasStateDb: async () => true,
    atlasWorkspaceAccess: {validated: true, epoch: 1, controller: new AbortController()},
    atlasCentralPeopleLoadPromise: null, opsGlobalStorageCache: null,
    atlasSharedData: {employees: {}, assignments: [], reportingAssignments: [], validationIssues: [], nested: {lastPeopleSyncAt: 'retained evidence'}},
    getAtlasRenderContextKey: () => 'settings:verified-workspace', activeTab: 13,
    getAtlasCentralStatus: () => ({configured: true, signedIn: true}),
    normalizeAtlasSharedData: clone, normalizeSharedEmployeeRecord: clone, normalizeSharedAssignmentRecord: clone,
    inferSharedBonusRoleType: () => 'manager', validateAtlasSharedData: () => [],
    syncAllCommunityStaffingFromPeopleRoster: () => {}, scheduleAtlasSharedRender: () => {},
    atlasScopedLocalKey: key => key, localStorage: {getItem: () => null, removeItem: () => {}},
    markAtlasPersistenceError: error => state.errors.push(error),
    alert: message => {throw new Error(message);}, serializeJacsTeamBonus: clone,
    queueAtlasStateWrite: task => (state.queue = state.queue.then(task)),
    applyOpsGlobalData: payload => {context.opsGlobalData = clone(payload); context.atlasSharedData = context.opsGlobalData.sharedData;},
    window: {ATLAS_CENTRAL: {
      getAccessContextKey: () => 'verified-access', getSession: () => ({user: {id: 'actor'}}),
      fetchJson: async () => clone(state.rows)
    }}
  };
  for (const name of [
    'atlasInvestorPacketState', 'bonusQuarter', 'bonusQuarterManualOverride', 'bonusCalcView', 'bonusEngineState',
    'jacsTeamBonus', 'regionalAssignments', 'salarySecurity', 'monthlyPresentationCommunities',
    'reportHubCommunityProgressCommunities', 'reportHubLvrCommunity', 'weeklyExecutiveEmail',
    'portfolioReportSections', 'portfolioReportFilters', 'portfolioReportMode', 'atlasWorkbookImportMode',
    'portfolioMonthScopeByPeriod', 'reportHubRecipientKeys', 'reportHubType', 'reportHubPerspective',
    'reportHubMonth', 'reportHubYear', 'reportRecommendationOverrides', 'communityCommandState', 'windowshadeState'
  ]) context[name] = {};
  context.applicationResidentDataState = {uploads: [], lastDeletedUpload: null};
  vm.createContext(context);
  vm.runInContext([
    'atlasOpsGlobalChangedOnlyPeopleSyncTime', 'atlasStateSetValue', 'atlasStateGetValue',
    'writeOpsGlobalStorage', 'hydrateOpsGlobalStorage', 'persistOpsGlobalSnapshot', 'persistOpsGlobalData',
    'loadAtlasCentralPeopleAssignments', 'queueAtlasCentralPeopleLoad'
  ].map(extract).join('\n'), context);
  return {records, state, context, withStore};
}

async function refreshSettings(f) {
  f.context.queueAtlasCentralPeopleLoad();
  assert(f.context.atlasCentralPeopleLoadPromise, 'Settings should start a due People refresh');
  await f.context.atlasCentralPeopleLoadPromise.task;
  await f.state.queue;
  assert.equal(f.state.errors.length, 0);
}

(async () => {
  const {capturePublicationCache, acknowledgePublicationCache} = await import('../docs/portfolio-operations-dashboard/features/workspace-publication-cache.mjs');
  const f = fixture();
  await refreshSettings(f);
  assert.equal(f.records.get(RECEIPT).value.dirty, true, 'First People data remains a publishable change');
  const historyBefore = clone(f.records.get(HISTORY));
  const publication = {version: 5, archiveHash: 'synthetic-retained-history-hash'};
  const captured = await capturePublicationCache(f.withStore, [COMMUNITIES, OPS, HISTORY, RECEIPT], () => true);
  assert(await acknowledgePublicationCache(f.withStore, captured, {
    source: publication, binding: {fullProjection: true, scopeFingerprint: 'scope'},
    projection: {contentHash: 'synthetic-projection-hash', importState: {batches: []}}
  }, publication, () => true, JSON.stringify));
  const cleanReceipt = clone(f.records.get(RECEIPT));
  const publishedOps = clone(f.records.get(OPS).value);
  const publishedRecords = new Map(clone([...f.records]));

  // Save completion renders Settings; the next due refresh changes only its clock.
  f.state.now = '2026-10-23T15:16:17.660Z';
  f.state.puts = [];
  await refreshSettings(f);
  assert.equal(f.records.get(OPS).value.sharedData.lastPeopleSyncAt, f.state.now, 'Freshness clock must still persist and pass exact readback');
  assert.deepEqual(f.state.puts, [OPS], 'Timestamp-only refresh must never rewrite the publication receipt');
  assert.deepEqual(f.records.get(RECEIPT), cleanReceipt);
  assert.deepEqual(f.records.get(HISTORY), historyBefore);
  const reloaded = fixture(f.records);
  await reloaded.context.hydrateOpsGlobalStorage();
  assert.equal(reloaded.context.opsGlobalStorageCache.sharedData.lastPeopleSyncAt, f.state.now);
  assert.equal((await reloaded.context.atlasStateGetValue(RECEIPT)).dirty, false, 'Fresh-page consumer stays clean');

  // A real new central roster value still dirties the exact same Settings path.
  f.state.now = '2026-10-23T15:18:17.660Z';
  f.state.rows[0].atlas_employees.full_name = 'Synthetic Updated Person';
  await refreshSettings(f);
  assert.equal(f.records.get(RECEIPT).value.dirty, true);
  assert.equal(f.records.get(OPS).value.sharedData.employees['employee-1'].name, 'Synthetic Updated Person');

  for (const [label, change] of [
    ['employee change', data => {data.sharedData.employees['employee-1'].email = 'new@example.invalid';}],
    ['assignment removal', data => {data.sharedData.assignments = [];}],
    ['assignment addition', data => {data.sharedData.assignments.push({assignmentId: 'new'});}],
    ['source version', data => {data.sharedData.assignments[0].version++;}],
    ['source timestamp', data => {data.sharedData.employees['employee-1'].sourceUpdatedAt = '2026-10-23T15:00:00Z';}],
    ['source identity', data => {data.sharedData.lastPeopleSource = 'another-source';}],
    ['nested same-name timestamp', data => {data.sharedData.nested.lastPeopleSyncAt = 'changed evidence';}],
    ['unrelated preference', data => {data.reportHubType = 'csuite';}],
    ['unrelated top-level timestamp', data => {data.lastPeopleSyncAt = 'another field';}],
    ['removed sharedData', data => {delete data.sharedData;}],
    ['invalid sharedData shape', data => {data.sharedData = [];}]
  ]) {
    const changed = fixture(publishedRecords), data = clone(publishedOps);
    data.sharedData.lastPeopleSyncAt = '2026-10-23T15:20:00Z';
    change(data);
    await changed.context.writeOpsGlobalStorage(data);
    assert.equal(changed.records.get(RECEIPT).value.dirty, true, label);
    assert.deepEqual(changed.records.get(OPS).value, data, `${label} persists exactly`);
  }

  const dirty = fixture(publishedRecords);
  dirty.records.get(RECEIPT).value.dirty = true;
  dirty.records.get(HISTORY).value.revision++;
  const unknownDirtyReceipt = clone(dirty.records.get(RECEIPT));
  const timestampOnly = clone(publishedOps);
  timestampOnly.sharedData.lastPeopleSyncAt = '2026-10-23T15:20:00Z';
  await dirty.context.writeOpsGlobalStorage(timestampOnly);
  assert.deepEqual(dirty.records.get(RECEIPT), unknownDirtyReceipt, 'Unknown or history-only pending work must never be cleared');

  for (const prior of [undefined, null, {}, {sharedData: null}, {sharedData: []}]) {
    const fresh = fixture(publishedRecords);
    if (prior === undefined) fresh.records.delete(OPS);
    else fresh.records.set(OPS, {key: OPS, value: prior});
    await fresh.context.writeOpsGlobalStorage({sharedData: {lastPeopleSyncAt: '2026-10-23T15:20:00Z'}});
    assert.equal(fresh.records.get(RECEIPT).value.dirty, true, 'A missing or differently shaped global record cannot be timestamp-only');
  }
  const community = fixture(publishedRecords);
  await community.context.atlasStateSetValue(COMMUNITIES, {'Synthetic Community': {occupied: 11}});
  assert.equal(community.records.get(RECEIPT).value.dirty, true, 'Community changes still dirty the workspace');
  const unchanged = fixture(publishedRecords);
  await unchanged.context.writeOpsGlobalStorage(publishedOps);
  assert.deepEqual(unchanged.state.puts, [], 'Identical settings retain the existing no-write behavior');
  const noReceipt = fixture(publishedRecords);
  noReceipt.records.delete(RECEIPT);
  await noReceipt.context.writeOpsGlobalStorage(timestampOnly);
  assert.equal(noReceipt.records.has(RECEIPT), false, 'Refresh cannot invent a publication receipt');
  console.log('PASS People sync publication status: clean acknowledgement → actual Settings refresh → exact persistence → reload stays clean; genuine People/global/community changes dirty, and unknown pending history remains protected.');
})().catch(error => {console.error(error); process.exitCode = 1;});
