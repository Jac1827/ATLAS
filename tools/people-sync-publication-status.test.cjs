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

function fixture(seed, {actualNormalization = false} = {}) {
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
    saveAtlasCentralAppState: function () {},
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
  if (actualNormalization) {
    Object.assign(context, {
      ATLAS_SHARED_DATA_SCHEMA_VERSION: 1, SHARED_BONUS_ROLE_LABELS: {manager: 'Community Manager'},
      BONUS_QUARTERS: ['Q1', 'Q2', 'Q3', 'Q4'], currentMonth: 9, DEFAULT_CURRENT_MONTH: 9,
      getAtlasTodayISODate: () => '2026-10-23', getBonusQuarterForMonth: () => 'Q4',
      clampNumber: (value, min, max) => Math.min(max, Math.max(min, value)),
      defaultPortfolioReportFilters: () => ({}), syncMonthlyTemplateImportTarget: () => {}
    });
    for (const name of ['normalizeBonusEngineState', 'normalizeJacsTeamBonus', 'normalizeRegionalAssignments',
      'normalizeSalarySecurity', 'normalizeMonthlyPresentationCommunities', 'normalizeCommunityProgressReportCommunities',
      'normalizeWeeklyExecutiveEmailSettings', 'normalizePortfolioReportSections', 'normalizePortfolioMonthScopeByPeriod',
      'normalizeReportHubType', 'normalizeReportHubPerspective', 'normalizeReportRecommendationOverrides',
      'normalizeApplicationResidentDataState', 'normalizeCommunityCommandState', 'normalizeWindowshadeState']) context[name] = value => value || {};
  }
  vm.createContext(context);
  vm.runInContext([
    'atlasOpsGlobalChangedOnlyPeopleSyncTime', 'atlasStateSetValue', 'atlasStateGetValue',
    'writeOpsGlobalStorage', 'hydrateOpsGlobalStorage', 'persistOpsGlobalSnapshot', 'persistOpsGlobalData',
    'loadAtlasCentralPeopleAssignments', 'queueAtlasCentralPeopleLoad'
  ].map(extract).join('\n'), context);
  if (actualNormalization) vm.runInContext(['simpleHash', 'normalizeSharedDate', 'inferSharedBonusRoleType',
    'defaultAtlasSharedData', 'normalizeAtlasBonusBoolean', 'normalizeSharedEmployeeRecord', 'normalizeSharedAssignmentRecord',
    'normalizeAtlasSharedData', 'makeSharedAssignmentId', 'normalizeOpsGlobalData', 'applyOpsGlobalData'].map(extract).join('\n'), context);
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
  const normalized = fixture(undefined, {actualNormalization: true});
  normalized.state.rows.push({
    ...clone(centralRows[0]), assignment_id: 'reporting-assignment', title: 'Regional Manager',
    atlas_employees: {employee_id: 'regional-1', full_name: 'Synthetic Regional', status: 'Active', email: 'regional@example.invalid'},
    atlas_roles: {role_id: 'reporting-role', title: 'Regional Manager', bonus_role_type: null}
  });
  await refreshSettings(normalized);
  assert.equal(normalized.records.get(OPS).value.sharedData.assignments.length, 1);
  assert.equal(normalized.records.get(OPS).value.sharedData.reportingAssignments.length, 1, 'Actual normalization retains reporting roles outside bonus assignments');

  // A fetch already underway before Save can finish after its exact raw capture.
  // Exercise the real completion/write/readback path against the strict real ack.
  for (const scenario of ['clock only', 'missing prior clock', 'actual People change', 'actual global change', 'reporting clock only', 'reporting role change']) {
    const actualNormalization = scenario.startsWith('reporting');
    const saving = fixture(actualNormalization ? normalized.records : publishedRecords, {actualNormalization});
    if (actualNormalization) saving.state.rows = clone(normalized.state.rows);
    if (scenario === 'missing prior clock') delete saving.records.get(OPS).value.sharedData.lastPeopleSyncAt;
    saving.context.applyOpsGlobalData(clone(saving.records.get(OPS).value));
    saving.records.get(RECEIPT).value.dirty = true;
    saving.state.now = '2026-10-23T15:10:00.000Z';
    let finishFetch;
    saving.context.window.ATLAS_CENTRAL.fetchJson = () => new Promise(resolve => {finishFetch = resolve;});
    const refresh = saving.context.loadAtlasCentralPeopleAssignments({silent: true});
    assert.equal(typeof finishFetch, 'function', 'People request starts before Save');
    const heldSave = new Promise(() => {});
    saving.context.saveAtlasCentralAppState.inFlight = heldSave;
    const saveCapture = await capturePublicationCache(saving.withStore, [COMMUNITIES, OPS, HISTORY, RECEIPT], () => true);
    const rawOpsAtCapture = clone(saving.records.get(OPS));
    const rawReceiptAtCapture = clone(saving.records.get(RECEIPT));
    if (scenario === 'actual People change') saving.state.rows[0].atlas_employees.full_name = 'Changed During Save';
    if (scenario === 'actual global change') saving.context.reportHubType = 'changed-during-save';
    if (scenario === 'reporting role change') saving.state.rows[1].title = saving.state.rows[1].atlas_roles.title = 'Regional Director';
    finishFetch(clone(saving.state.rows));
    await refresh;
    await saving.state.queue;
    assert.equal(saving.state.errors.length, 0, `${scenario}: exact write/readback succeeds`);
    assert.equal(saving.context.saveAtlasCentralAppState.inFlight, heldSave, 'Refresh never replaces or clears the active save');
    const onlyClock = ['clock only', 'missing prior clock', 'reporting clock only'].includes(scenario);
    if (onlyClock) {
      assert.deepEqual(saving.records.get(OPS), rawOpsAtCapture, `${scenario}: full raw OPS record, including updatedAt, stays exact`);
      assert.deepEqual(saving.records.get(RECEIPT), rawReceiptAtCapture, 'Refresh never clears pre-save pending work');
      assert.deepEqual(saving.state.puts, [], 'Clock-only completion performs no storage writes during Save');
      saving.context.queueAtlasCentralPeopleLoad();
      assert.equal(saving.context.atlasCentralPeopleLoadPromise, null, 'Automatic refresh waits until Save ends');
      // Explicit refresh remains usable, including repeated refreshes in one Save.
      saving.context.window.ATLAS_CENTRAL.fetchJson = async () => clone(saving.state.rows);
      saving.context.queueAtlasCentralPeopleLoad({force: true});
      assert(saving.context.atlasCentralPeopleLoadPromise, 'Forced refresh remains available during Save');
      await saving.context.atlasCentralPeopleLoadPromise.task;
      await saving.state.queue;
      assert.deepEqual(saving.records.get(OPS), rawOpsAtCapture);
    } else {
      assert.notDeepEqual(saving.records.get(OPS), rawOpsAtCapture, `${scenario}: genuine changes still persist`);
      assert.equal(saving.records.get(RECEIPT).value.dirty, true);
      if (scenario === 'actual People change') assert.equal(saving.records.get(OPS).value.sharedData.employees['employee-1'].name, 'Changed During Save');
      else if (scenario === 'reporting role change') assert.equal(saving.records.get(OPS).value.sharedData.reportingAssignments[0].title, 'Regional Director');
      else assert.equal(saving.records.get(OPS).value.reportHubType, 'changed-during-save');
    }
    const acknowledged = await acknowledgePublicationCache(saving.withStore, saveCapture, {
      source: publication, binding: {fullProjection: true, scopeFingerprint: 'scope'},
      projection: {contentHash: 'synthetic-projection-hash', importState: {batches: []}}
    }, publication, () => true, JSON.stringify);
    assert.equal(acknowledged, onlyClock, `${scenario}: only an exact capture is acknowledged`);
    assert.equal(saving.records.get(RECEIPT).value.dirty, !onlyClock);
    saving.context.saveAtlasCentralAppState.inFlight = null;
    if (onlyClock) {
      await refreshSettings(saving);
      assert.equal(saving.records.get(OPS).value.sharedData.lastPeopleSyncAt, saving.state.now, 'Observation clock resumes after Save');
      assert.equal(saving.records.get(RECEIPT).value.dirty, false);
    }
  }

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
  console.log('PASS People sync publication status: pre-save People requests preserve exact capture during Save; real People/global changes refuse stale acknowledgement; clean Settings refresh and reload stay clean, with unknown pending history protected.');
})().catch(error => {console.error(error); process.exitCode = 1;});
