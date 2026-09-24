const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const flush = () => new Promise(resolve => setImmediate(resolve));
const { readDashboardSource } = require('./dashboard-source.cjs');
const source = readDashboardSource(__dirname + '/../docs/portfolio-operations-dashboard/index.html');
const extract = name => source.match(new RegExp('^(?:async )?function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'))[0];
function deferred() {
  let resolve, reject;
  const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
  const result = { ok: true, pending: true, completion, message: '' };
  return { result, succeed() { result.pending = false; resolve(); }, fail(message) { result.ok = false; result.pending = false; result.message = message; resolve(); }, reject };
}
function context() {
  const listeners = new Map();
  const ctx = {
    Promise, Error, DOMException, Date, Set, ATLAS_STATE_DB_NAME: 'db-a', ATLAS_STATE_COMMUNITY_KEY: 'community_data',
    atlasSaveAuthRevision: 0, atlasNavigationEpoch: 0, activeTab: 4, workspaceScopeValue: 'A',
    actor: 'actor-a', signedIn: true, accessAllowed: true, sensitiveBlocked: false, period: '2026-09',
    config: { supabaseUrl: 'https://source-a.example', documentKey: 'workspace-a' },
    profile: { user_id: 'actor-a', status: 'active', account_status: 'active', role: 'admin', allowed_community_ids: ['A'] },
    portfolioMonthScopeByPeriod: {},
    getAtlasCentralStatus: () => ({ configured: true, signedIn: ctx.signedIn }),
    getAtlasAccessProfile: () => ctx.profile, getAtlasCentralConfig: () => ctx.config,
    shouldBlockAtlasSensitiveAccess: () => ctx.sensitiveBlocked,
    atlasAccessDecision: () => ({ ok: ctx.accessAllowed }),
    atlasProfileCommunityRestrictionValues: profile => ({ allowedLocationGroups: profile.allowed_location_groups || [] }),
    getProp: () => ({ name: 'A' }), getSelectedDashboardPeriodKey: () => ctx.period,
    escapeHtml: s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    marketSurveyImportLog: [], marketSurveyImportOperation: null, marketSurveyImportSourceLabel: '', renders: 0, grids: 0,
    renderTab() { ctx.renders++; }, renderPropGrid() { ctx.grids++; },
    handleMarketSurveyWorkbook: async () => 'A', handleMarketSurveyPdf: async () => 'A',
  };
  ctx.window = {
    ATLAS_CENTRAL: { getSession: () => ctx.actor ? { user: { id: ctx.actor } } : null },
    addEventListener: (event, listener) => listeners.set(event, listener),
  };
  ctx.authChanged = () => listeners.get('atlas-central-auth-change')();
  vm.createContext(ctx);
  for (const name of ['awaitAtlasPersistenceResults', 'assertAtlasSaveContext', 'invalidateAtlasSaveContext', 'getAtlasSaveContextKey', 'observeAtlasSaveContext', 'captureAtlasSaveContext', 'updateMarketSurveyImportInputs', 'processMarketSurveyFiles']) vm.runInContext(extract(name), ctx);
  vm.runInContext(source.match(/^window\.addEventListener\("atlas-central-auth-change", invalidateAtlasSaveContext\);$/m)[0], ctx);
  return ctx;
}
function saveContext(community, global) {
  const ctx = context();
  Object.assign(ctx, {
    activeTab: 0, currentMonth: 8, monthlyData: [], savedBudgetTargets: [], savedData: {}, workspaceScopeValue: 'A', alerts: [],
    PORTFOLIO_SCOPE_LABEL: 'Portfolio', suppressDashboardSharedSyncPush: false, bonusCalcView: '',
    isCommunitySettingsAdmin: () => true, isPortfolioWorkspaceSelected: () => false, getProp: () => ({ name: 'A' }),
    matchPropertyName: name => name, atlasLinkedEmployeeIssues: () => [], atlasRefreshLinkedEmployees() {},
    validateCurrentSharedCommunityFields: () => ({ ok: true }), carryForwardMonthlyData() {}, storeCurrentMonthSnapshots() {},
    currentOccupied: 5, currentLeased: 6, getBudgetOccPctForMonth: () => 95, getCurrentCommunityRecord: () => ({}),
    syncSharedPropertyFromPortfolioRecord() {}, persistOpsPropertyCatalog() {}, queueDailyBackupSnapshotWrite() {},
    persistSaved: () => community, persistOpsGlobalData: () => global, atlasCentralLegacyBundleDisabled: () => true,
    queueDashboardSharedSyncPush() {}, queueAtlasCentralDocumentPush() {}, alert: message => ctx.alerts.push(message),
  });
  vm.runInContext(extract('saveCommunityData'), ctx);
  return ctx;
}

test('community save waits for BOTH durable writes before success', async () => {
  const local = deferred(), global = deferred(), ctx = saveContext(local.result, global.result);
  assert.equal(ctx.saveCommunityData(), undefined);
  global.succeed(); await Promise.resolve(); await Promise.resolve();
  assert.equal(ctx.alerts.length, 0);
  local.succeed(); await flush();
  assert.equal(ctx.alerts.length, 1); assert.match(ctx.alerts[0], /Saved data for A/);
});
for (const destination of ['community', 'settings']) {
  test(`${destination} async failure cannot display save success`, async () => {
    const local = deferred(), global = deferred(), ctx = saveContext(local.result, global.result);
    assert.equal(ctx.saveCommunityData(), undefined);
    (destination === 'community' ? local : global).fail('disk full');
    (destination === 'community' ? global : local).succeed();
    await flush(); assert.equal(ctx.alerts.length, 1); assert.match(ctx.alerts[0], /disk full/);
    assert(!ctx.alerts.some(text => text.includes('✅')));
  });
}
test('rejected completion and immediate failure are acknowledged after both settle', async () => {
  const local = deferred(), global = deferred(), ctx = saveContext(local.result, global.result);
  assert.equal(ctx.saveCommunityData(), undefined); local.reject(new Error('transaction aborted'));
  await Promise.resolve(); await Promise.resolve(); assert.equal(ctx.alerts.length, 0);
  global.succeed(); await flush(); assert.match(ctx.alerts[0], /transaction aborted/);
  const immediate = saveContext({ ok: false, message: 'read only' }, { ok: true, pending: false });
  assert.equal(immediate.saveCommunityData(), undefined); await flush(); assert.match(immediate.alerts[0], /read only/);
});
test('a stale save completion cannot notify a new workspace', async () => {
  const local = deferred(), global = deferred(), ctx = saveContext(local.result, global.result);
  assert.equal(ctx.saveCommunityData(), undefined); ctx.authChanged();
  local.fail('aborted'); global.succeed(); await flush(); assert.equal(ctx.alerts.length, 0);
});
test('silent save has no success popup but still reports a failure', async () => {
  const ok = saveContext({ ok: true }, { ok: true });
  assert.equal(ok.saveCommunityData(true), undefined); await flush(); assert.equal(ok.alerts.length, 0);
  const failed = saveContext({ ok: false, message: 'storage full' }, { ok: true });
  assert.equal(failed.saveCommunityData(true), undefined); await flush(); assert.match(failed.alerts[0], /storage full/);
});
for (const destination of ['community', 'settings']) {
  test(`real queued ${destination} save checks its optional context before the task writes`, async () => {
    const ctx = context();
    Object.assign(ctx, {
      atlasStateWritePromise: Promise.resolve(), atlasPersistenceMeta: {}, dashboardSharedSyncMeta: {},
      buildSerializedSavedDataPayload: () => ({}), atlasStateSetValue: async () => assert.fail('stale context must not write'),
      writeOpsGlobalStorage: async () => assert.fail('stale context must not write settings'),
      removeLegacyCommunityStorageKeys() {}, persistDashboardSharedSyncMeta() {}, clearAtlasPersistenceError() {},
      persistAtlasPersistenceMeta() {}, markAtlasPersistenceError() {}, alert: () => assert.fail('stale settings must not alert'),
    });
    for (const name of ['queueAtlasStateWrite', 'persistSaved', 'persistOpsGlobalSnapshot']) vm.runInContext(extract(name), ctx);
    const isCurrent = ctx.captureAtlasSaveContext();
    const result = destination === 'community' ? ctx.persistSaved(isCurrent) : ctx.persistOpsGlobalSnapshot({}, isCurrent);
    ctx.actor = 'actor-b';
    await assert.rejects(ctx.awaitAtlasPersistenceResults([{ result, label: destination }]), /Workspace changed/);
    assert.equal(result.ok, false); assert.equal(result.pending, false);
  });
}

test('market upload publishes a success label only after persistence completes', async () => {
  const ctx = context(), write = deferred(); ctx.persistSaved = () => write.result;
  const upload = ctx.processMarketSurveyFiles([{ name: 'survey.xlsx' }]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(ctx.marketSurveyImportSourceLabel, ''); assert.equal(ctx.grids, 0);
  write.succeed(); assert.equal(await upload, true);
  assert.equal(ctx.marketSurveyImportSourceLabel, 'A market survey updated'); assert.equal(ctx.grids, 1);
});
for (const failure of ['rejected', 'async-result', 'immediate']) {
  test(`market upload ${failure} failure never advertises saved data`, async () => {
    const ctx = context(), write = deferred();
    ctx.persistSaved = () => failure === 'immediate' ? { ok: false, message: 'read only' } : write.result;
    ctx.marketSurveyImportSourceLabel = 'previous success';
    const upload = ctx.processMarketSurveyFiles([{ name: 'survey.pdf' }]);
    await Promise.resolve();
    if (failure === 'rejected') write.reject(new Error('quota <full>'));
    if (failure === 'async-result') write.fail('quota <full>');
    assert.equal(await upload, false); assert.equal(ctx.marketSurveyImportSourceLabel, ''); assert.equal(ctx.grids, 0);
    assert.equal(ctx.marketSurveyImportLog.length, 1); if (failure !== 'immediate') { assert(ctx.marketSurveyImportLog[0].includes('<full>')); assert(ctx.escapeHtml(ctx.marketSurveyImportLog[0]).includes('&lt;full&gt;')); }
  });
}
test('market completion and parsing cannot persist or render into a changed context', async () => {
  const ctx = context(), write = deferred(); ctx.persistSaved = () => write.result;
  const upload = ctx.processMarketSurveyFiles([{ name: 'survey.xlsx' }]);
  await Promise.resolve(); ctx.workspaceScopeValue = 'other-community'; write.succeed();
  assert.equal(await upload, false); assert.equal(ctx.renders, 0); assert.equal(ctx.marketSurveyImportSourceLabel, '');
  const parsing = context(); parsing.handleMarketSurveyWorkbook = async () => { parsing.authChanged(); return 'A'; };
  parsing.persistSaved = () => assert.fail('stale parser must not persist');
  assert.equal(await parsing.processMarketSurveyFiles([{ name: 'survey.xlsx' }]), false);
});
function bindInput(ctx, upload = ctx.processMarketSurveyFiles) {
  const input = { dataset: {}, disabled: false, value: 'selected', files: [{ name: 'survey.xlsx' }], addEventListener(type, callback) { this.change = callback; } };
  ctx.document = { querySelectorAll: () => [input] }; ctx.processMarketSurveyFiles = upload;
  const start = source.indexOf('  document.querySelectorAll("#market-survey-input").forEach(marketSurveyInput => {');
  const end = source.indexOf('  document.querySelectorAll("#dlr-box-score-input', start);
  vm.runInContext(source.slice(start, end), ctx);
  return input;
}
test('upload input blocks duplicate starts, catches rejection, and releases control', async () => {
  const ctx = context(), work = deferred(); let calls = 0;
  const input = bindInput(ctx, () => { calls++; return work.result.completion; });
  const upload = input.change({ target: input }); assert.equal(input.disabled, true);
  await input.change({ target: input }); assert.equal(calls, 1);
  work.reject(new Error('invalid <file>')); await upload;
  assert.equal(input.disabled, false); assert.equal(input.value, '');
  assert.match(ctx.marketSurveyImportLog[0], /invalid <file>/); assert.match(ctx.escapeHtml(ctx.marketSurveyImportLog[0]), /invalid &lt;file&gt;/); assert.equal(ctx.renders, 1);
});
test('old upload rejection releases old input without overwriting the new context', async () => {
  const ctx = context(), work = deferred(); const input = bindInput(ctx, () => work.result.completion);
  const upload = input.change({ target: input }); ctx.config.supabaseUrl = 'https://source-b.example';
  work.reject(new Error('old failure')); await upload;
  assert.equal(input.disabled, false); assert.equal(ctx.renders, 0); assert.equal(ctx.marketSurveyImportLog.length, 0);
});
function realHandlerContext() {
  const ctx = context();
  Object.assign(ctx, {
    savedData: { A: { currentMonth: 8, marketSurveyData: { compAverageRent: 1000 } } },
    matchPropertyName: name => name, getAllCommunityNames: () => ['A'], getProp: () => ({ name: 'A' }),
    getCurrentCommunityRecord: () => ctx.savedData.A, normalizeSavedCommunityRecord: (_name, record) => ({ ...record }),
    normalizeMarketSurveyData: data => ({ ...(data || {}) }), seedAptiqFloorPlanRatesFromCommunity: () => [],
    syncCommunityFloorPlanRentMetrics() {}, getSelectedDashboardPeriodKey: () => ctx.period,
    normalizeMarketSurveyHistory: data => ({ ...(data || {}) }), normalizeImportTracking: data => ({ ...(data || {}) }),
    parses: 0, XLSX: { read(buffer) { ctx.parses++; return buffer; } },
    extractMarketSurveyWorkbookData: () => ({ communityName: 'A', compAverageRent: 1500 }),
    parseAptiqMarketSurveyPdfText() { ctx.parses++; return { communityName: 'A', compAverageRent: 1500 }; },
    persistSaved: () => ({ ok: true, pending: false }),
  });
  for (const name of ['captureAtlasSaveContext', 'applyMarketSurveyDataToProperty', 'handleMarketSurveyWorkbook', 'handleMarketSurveyPdf']) vm.runInContext(extract(name), ctx);
  return ctx;
}
for (const format of ['xlsx', 'pdf']) {
  test(`real ${format} parser cannot mutate another actor or scope after awaiting the file`, async () => {
    const ctx = realHandlerContext(), read = deferred();
    ctx.extractPdfTextFromFile = () => read.result.completion;
    const upload = ctx.processMarketSurveyFiles([{ name: `survey.${format}`, arrayBuffer: () => read.result.completion }]);
    ctx.actor = 'actor-b'; ctx.period = '2026-10'; ctx.authChanged();
    ctx.savedData = { A: { currentMonth: 9, marketSurveyData: { compAverageRent: 2200 } } };
    read.succeed(); assert.equal(await upload, false);
    assert.equal(ctx.parses, 0); assert.equal(ctx.savedData.A.marketSurveyData.compAverageRent, 2200);
    assert.equal(ctx.marketSurveyImportLog.length, 0); assert.equal(ctx.grids, 0);
  });
  test(`real ${format} handler retains valid same-context apply and save`, async () => {
    const ctx = realHandlerContext(); ctx.extractPdfTextFromFile = async () => 'survey';
    assert.equal(await ctx.processMarketSurveyFiles([{ name: `survey.${format}`, arrayBuffer: async () => new ArrayBuffer(0) }]), true);
    assert.equal(ctx.savedData.A.marketSurveyData.compAverageRent, 1500);
    assert.equal(ctx.marketSurveyImportSourceLabel, 'A market survey updated');
  });
}
test('stable workbook handler preserves the existing unavailable-library behavior', async () => {
  const ctx = realHandlerContext(); delete ctx.XLSX;
  const result = await ctx.handleMarketSurveyWorkbook({ name: 'survey.xlsx', arrayBuffer: () => assert.fail('missing parser must not read the file') });
  assert.equal(result, null); assert.match(ctx.marketSurveyImportLog[0], /XLSX library did not load/);
});

test('both market log renderers escape stored error text exactly once', () => {
  const renderers = source.match(/marketSurveyImportLog\.map\(\(line, idx\) =>[^\n]+/g);
  assert.equal(renderers.length, 2);
  for (const renderer of renderers) assert.match(renderer, /\$\{escapeHtml\(line\)\}/);
});
test('a remounted upload input remains disabled until the active import completes', async () => {
  const ctx = realHandlerContext(), read = deferred(); let reads = 0;
  ctx.extractPdfTextFromFile = () => { reads++; return read.result.completion; };
  const first = bindInput(ctx); first.files = [{ name: 'survey.pdf' }];
  const upload = first.change({ target: first });
  const replacement = bindInput(ctx); replacement.files = [{ name: 'second.pdf' }];
  assert.equal(replacement.disabled, true);
  await replacement.change({ target: replacement });
  assert.equal(await ctx.processMarketSurveyFiles(replacement.files), false);
  assert.equal(reads, 1, 'DOM remount and direct invocation cannot start overlapping imports');
  read.succeed(); await upload;
  assert.equal(replacement.disabled, false); assert.equal(ctx.marketSurveyImportOperation, null);
  assert.equal(ctx.marketSurveyImportSourceLabel, 'A market survey updated');
});
test('an old import finally cannot release a new scope operation or overwrite its log', async () => {
  const ctx = realHandlerContext(), oldRead = deferred(), newRead = deferred(); let reads = 0;
  ctx.extractPdfTextFromFile = () => (++reads === 1 ? oldRead : newRead).result.completion;
  const old = ctx.processMarketSurveyFiles([{ name: 'old.pdf' }]);
  ctx.workspaceScopeValue = 'new-scope'; ctx.authChanged();
  const newer = ctx.processMarketSurveyFiles([{ name: 'new.pdf' }]);
  const operation = ctx.marketSurveyImportOperation;
  const currentInput = bindInput(ctx); assert.equal(currentInput.disabled, true);
  oldRead.succeed(); assert.equal(await old, false);
  assert.equal(ctx.marketSurveyImportOperation, operation); assert.equal(currentInput.disabled, true);
  assert.equal(ctx.marketSurveyImportLog.length, 0);
  newRead.succeed(); assert.equal(await newer, true);
  assert.equal(ctx.marketSurveyImportOperation, null); assert.equal(currentInput.disabled, false);
  assert.match(ctx.marketSurveyImportLog[0], /new\.pdf/); assert(!ctx.marketSurveyImportLog[0].includes('old.pdf'));
});

for (const [name, change] of [
  ['actor', ctx => { ctx.actor = 'actor-b'; }],
  ['sign-out', ctx => { ctx.signedIn = false; ctx.actor = ''; }],
  ['profile status', ctx => { ctx.profile.status = 'inactive'; }],
  ['role', ctx => { ctx.profile.role = 'viewer'; }],
  ['assigned communities', ctx => { ctx.profile.allowed_community_ids.push('B'); }],
  ['page lock', ctx => { ctx.profile.locked_page_keys = ['market']; }],
  ['effective access denial', ctx => { ctx.accessAllowed = false; }],
  ['sensitive access block', ctx => { ctx.sensitiveBlocked = true; }],
  ['community scope', ctx => { ctx.workspaceScopeValue = 'B'; }],
  ['selected month', ctx => { ctx.period = '2026-10'; }],
  ['portfolio month scope', ctx => { ctx.portfolioMonthScopeByPeriod[ctx.period] = ['B']; }],
  ['navigation away and back', ctx => { ctx.atlasNavigationEpoch += 2; }],
  ['source service', ctx => { ctx.config.supabaseUrl = 'https://source-b.example'; }],
  ['document key', ctx => { ctx.config.documentKey = 'workspace-b'; }],
  ['sign-out and re-sign-in event', ctx => { ctx.signedIn = false; ctx.authChanged(); ctx.signedIn = true; ctx.authChanged(); }],
]) {
  test(`stable context rejects ${name} change before real PDF apply or log`, async () => {
    const ctx = realHandlerContext(), read = deferred(); ctx.extractPdfTextFromFile = () => read.result.completion;
    const upload = ctx.processMarketSurveyFiles([{ name: 'survey.pdf' }]);
    change(ctx); read.succeed();
    assert.equal(await upload, false); assert.equal(ctx.parses, 0);
    assert.equal(ctx.savedData.A.marketSurveyData.compAverageRent, 1000);
    assert.equal(ctx.marketSurveyImportLog.length, 0); assert.equal(ctx.grids, 0);
  });
}

test('stable context blocks an initially denied or signed-out operation without changing its existing UI state', async () => {
  for (const denied of ['access', 'session']) {
    const ctx = realHandlerContext(); ctx.marketSurveyImportLog = ['prior message'];
    if (denied === 'access') ctx.accessAllowed = false; else ctx.signedIn = false;
    assert.equal(await ctx.processMarketSurveyFiles([{ name: 'survey.pdf' }]), false);
    assert.equal(ctx.marketSurveyImportLog[0], 'prior message'); assert.equal(ctx.marketSurveyImportOperation, null);
    assert.equal(ctx.parses, 0);
  }
});

test('optional queued context predicates preserve unrelated callers and valid same-context writes', async () => {
  const ctx = context(); let communityWrites = 0, settingsWrites = 0;
  Object.assign(ctx, {
    atlasStateWritePromise: Promise.resolve(), atlasPersistenceMeta: {}, dashboardSharedSyncMeta: {},
    buildSerializedSavedDataPayload: () => ({}), atlasStateSetValue: async () => { communityWrites++; },
    writeOpsGlobalStorage: async () => { settingsWrites++; }, removeLegacyCommunityStorageKeys() {},
    persistDashboardSharedSyncMeta() {}, clearAtlasPersistenceError() {}, persistAtlasPersistenceMeta() {}, markAtlasPersistenceError() {}, alert() {},
  });
  for (const name of ['queueAtlasStateWrite', 'persistSaved', 'persistOpsGlobalSnapshot']) vm.runInContext(extract(name), ctx);
  for (const isCurrent of [undefined, ctx.captureAtlasSaveContext()]) {
    await ctx.awaitAtlasPersistenceResults([{ result: ctx.persistSaved(isCurrent), label: 'community' }, { result: ctx.persistOpsGlobalSnapshot({}, isCurrent), label: 'settings' }]);
  }
  assert.equal(communityWrites, 2); assert.equal(settingsWrites, 2);
});

function storageContext({ delayedOpen = false, occupancy = false, delayedRead = false } = {}) {
  const ctx = context();
  const open = deferred();
  Object.assign(ctx, {
    ATLAS_STATE_STORE_NAME: 'state', OPS_GLOBAL_STORAGE_KEY: 'settings',
    transactions: 0, puts: [], aborted: 0, removed: [], metadata: [],
    atlasStateWritePromise: Promise.resolve(), atlasPersistenceMeta: { source: 'new-context' },
    localStorage: { removeItem: key => ctx.removed.push(key) },
    clearAtlasPersistenceError: () => ctx.metadata.push('clear'),
    persistAtlasPersistenceMeta: () => ctx.metadata.push('persist'),
    markAtlasPersistenceError: () => ctx.metadata.push('error'),
  });
  const records = new Map();
  const db = { transaction() {
    ctx.transactions++;
    const tx = {
      aborted: false,
      abort() { this.aborted = true; ctx.aborted++; queueMicrotask(() => this.onabort?.()); },
      objectStore() { return {
        get(key) {
          const request = { result: records.get(key) };
          const finish = () => {
            request.onsuccess?.();
            queueMicrotask(() => { if (!tx.aborted) tx.oncomplete?.(); });
          };
          if (delayedRead) ctx.finishRead = finish; else setImmediate(finish);
          return request;
        },
        put(record) {
          ctx.puts.push(record); records.set(record.key, record);
          queueMicrotask(() => { if (!tx.aborted) tx.oncomplete?.(); });
          return { result: record.key };
        },
      }; },
    };
    return tx;
  } };
  ctx.openAtlasStateDb = () => delayedOpen ? open.result.completion.then(() => db) : Promise.resolve(db);
  ctx.finishOpen = () => open.succeed();
  if (occupancy) ctx.window.AtlasOccupancyReplay = { protectCommittedOccupancy: (value, prior) => ({ ...value, protected: true }) };
  for (const name of ['withAtlasStateStore', 'atlasStateGetValue', 'atlasStateSetValue', 'writeOpsGlobalStorage', 'queueAtlasStateWrite']) vm.runInContext(extract(name), ctx);
  return ctx;
}
for (const destination of ['community', 'settings']) {
  test(`real ${destination} write checks context after a delayed database open`, async () => {
    const ctx = storageContext({ delayedOpen: true });
    const isCurrent = ctx.captureAtlasSaveContext();
    const result = destination === 'community'
      ? ctx.atlasStateSetValue(ctx.ATLAS_STATE_COMMUNITY_KEY, { saved: true }, isCurrent)
      : ctx.writeOpsGlobalStorage({ saved: true }, isCurrent);
    ctx.authChanged(); ctx.finishOpen();
    await assert.rejects(result, { name: 'AbortError' });
    assert.equal(ctx.transactions, 0); assert.equal(ctx.puts.length, 0); assert.equal(ctx.removed.length, 0);
  });
}
test('real community occupancy read aborts before put after context changes', async () => {
  const ctx = storageContext({ occupancy: true, delayedRead: true });
  const result = ctx.atlasStateSetValue(ctx.ATLAS_STATE_COMMUNITY_KEY, { saved: true }, ctx.captureAtlasSaveContext());
  await flush(); ctx.period = '2026-10'; ctx.finishRead();
  await assert.rejects(result, /aborted/);
  assert.equal(ctx.puts.length, 0); assert.equal(ctx.aborted, 1);
});
test('real settings verification cannot clean legacy storage after context changes', async () => {
  const ctx = storageContext({ delayedRead: true });
  const result = ctx.writeOpsGlobalStorage({ saved: true }, ctx.captureAtlasSaveContext());
  await flush(); assert.equal(ctx.puts.length, 1);
  ctx.actor = 'actor-b'; ctx.finishRead();
  await assert.rejects(result, { name: 'AbortError' }); assert.equal(ctx.removed.length, 0);
});
test('real storage preserves valid guarded and default write/readback/occupancy behavior', async () => {
  for (const occupancy of [false, true]) {
    const ctx = storageContext({ occupancy });
    for (const isCurrent of [undefined, ctx.captureAtlasSaveContext()]) {
      await ctx.atlasStateSetValue(ctx.ATLAS_STATE_COMMUNITY_KEY, { saved: true }, isCurrent);
      await ctx.writeOpsGlobalStorage({ setting: true }, isCurrent);
    }
    assert.equal(ctx.puts.length, 4); assert.equal(ctx.removed.length, 2); assert.equal(ctx.aborted, 0);
    assert.equal(Boolean(ctx.puts[0].value.protected), occupancy);
  }
});
for (const outcome of ['success', 'failure']) {
  test(`real queue cannot update new-context metadata after late ${outcome}`, async () => {
    const ctx = storageContext(), pending = deferred();
    const result = ctx.queueAtlasStateWrite(() => pending.result.completion, 'old-save', ctx.captureAtlasSaveContext());
    await flush(); ctx.authChanged();
    if (outcome === 'failure') pending.reject(new Error('disk full')); else pending.succeed();
    await result;
    assert.equal(ctx.metadata.length, 0); assert.equal(ctx.atlasPersistenceMeta.source, 'new-context');
    // Default callers retain the old metadata behavior.
    await ctx.queueAtlasStateWrite(() => outcome === 'failure' ? Promise.reject(new Error('disk full')) : Promise.resolve(), 'default-save');
    assert.deepEqual(ctx.metadata, outcome === 'failure' ? ['error'] : ['clear', 'persist']);
  });
}
test('classic guard asset loads before main state without eager access and retains its lexical bindings', () => {
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../docs/portfolio-operations-dashboard/index.html'), 'utf8');
  const guard = fs.readFileSync(path.join(__dirname, '../docs/portfolio-operations-dashboard/market-save-guards.js'), 'utf8');
  const tag = html.match(/<script src="\.\/market-save-guards\.js\?v=[a-f0-9]{16}"><\/script>/)[0];
  assert(html.indexOf(tag) < html.indexOf('let atlasSaveAuthRevision = 0;'));
  assert(!guard.includes('addEventListener'));
  const events = [];
  const ctx = vm.createContext({ window: { addEventListener: (name, handler) => events.push({ name, handler }) }, DOMException });
  vm.runInContext(guard, ctx);
  vm.runInContext('let atlasSaveAuthRevision = 0;\n' + source.match(/^window\.addEventListener\("atlas-central-auth-change", invalidateAtlasSaveContext\);$/m)[0], ctx);
  assert.equal(events[0].name, 'atlas-central-auth-change');
  events[0].handler(); assert.equal(vm.runInContext('atlasSaveAuthRevision', ctx), 1);
  assert.throws(() => ctx.assertAtlasSaveContext(() => false), { name: 'AbortError' });
});

function installRealScopeNavigation(ctx) {
  Object.assign(ctx, {
    PROPERTIES: [{ name: 'A' }, { name: 'B' }], selectedPropIdx: 0, PORTFOLIO_SCOPE_VALUE: 'portfolio',
    OPS_WORKSPACE_CONTEXT_KEY: 'workspace', localStorage: { setItem() {} },
    currentMonth: 8, currentOccupied: 5, currentLeased: 6, importMonthOverride: 8, bonusQuarterManualOverride: true,
    getProp: () => ctx.PROPERTIES[ctx.selectedPropIdx],
    getSelectedDashboardPeriodKey: () => `2026-${String(ctx.currentMonth + 1).padStart(2, '0')}`,
    matchPropertyName: name => ['A', 'B'].includes(name) ? name : null,
    normalizeCommunityLookupName: name => String(name).toLowerCase(),
    loadPropertyData() {}, buildOperationsWorkspaceContext: () => ({ community: ctx.workspaceScopeValue, month: ctx.currentMonth }),
    storeCurrentMonthSnapshots() {}, restoreCurrentMonthSnapshots() {}, syncMonthlyTemplateImportTarget() {}, syncHeaderSubText() {},
  });
  for (const name of ['persistOperationsWorkspaceContext', 'selectProp', 'onWorkspaceCommunitySelect', 'openCommunityWorkspace', 'setPortfolioMonthScopeForPeriod']) vm.runInContext(extract(name), ctx);
  const input = { dataset: { field: 'currentMonth' }, value: '8', addEventListener(_event, fn) { this.change = fn; } };
  ctx.document = { querySelectorAll: selector => selector === '[data-field]' ? [input] : [] };
  const start = source.indexOf('  document.querySelectorAll("[data-field]")');
  const end = source.indexOf('  // File import (CSV or PDF)', start);
  vm.runInContext(source.slice(start, end), ctx);
  ctx.changeMonth = value => { input.value = String(value); input.change(); };
}
for (const [name, navigate] of [
  ['community selector', ctx => { ctx.onWorkspaceCommunitySelect('B'); ctx.onWorkspaceCommunitySelect('A'); }],
  ['portfolio selector', ctx => { ctx.onWorkspaceCommunitySelect('portfolio'); ctx.onWorkspaceCommunitySelect('A'); }],
  ['community workspace', ctx => { ctx.openCommunityWorkspace('B'); ctx.openCommunityWorkspace('A'); }],
  ['month input', ctx => { ctx.changeMonth(9); ctx.changeMonth(8); }],
  ['portfolio month scope', ctx => { ctx.setPortfolioMonthScopeForPeriod('2026-09', ['B']); ctx.setPortfolioMonthScopeForPeriod('2026-09', []); }],
]) {
  test(`actual ${name} A-B-A transitions invalidate pending real PDF parse without intermediate predicate reads`, async () => {
    const ctx = realHandlerContext(), read = deferred(); installRealScopeNavigation(ctx);
    ctx.extractPdfTextFromFile = () => read.result.completion;
    const before = ctx.getAtlasSaveContextKey();
    const upload = ctx.processMarketSurveyFiles([{ name: 'survey.pdf' }]);
    navigate(ctx);
    assert.equal(ctx.getAtlasSaveContextKey(), before, 'Visible context returns to exactly A');
    const grids = ctx.grids, renders = ctx.renders; read.succeed();
    assert.equal(await upload, false); assert.equal(ctx.parses, 0);
    assert.equal(ctx.savedData.A.marketSurveyData.compAverageRent, 1000);
    assert.equal(ctx.marketSurveyImportLog.length, 0); assert.equal(ctx.grids, grids); assert.equal(ctx.renders, renders);
  });
}
test('unchanged workspace persistence and unrelated period updates keep a valid pending save current', async () => {
  const ctx = realHandlerContext(), read = deferred(); installRealScopeNavigation(ctx);
  ctx.extractPdfTextFromFile = () => read.result.completion;
  const upload = ctx.processMarketSurveyFiles([{ name: 'survey.pdf' }]);
  ctx.persistOperationsWorkspaceContext(); ctx.persistOperationsWorkspaceContext();
  ctx.setPortfolioMonthScopeForPeriod('2026-08', ['B']);
  ctx.setPortfolioMonthScopeForPeriod('2026-09', []);
  read.succeed(); assert.equal(await upload, true); assert.equal(ctx.parses, 1);
  assert.equal(ctx.savedData.A.marketSurveyData.compAverageRent, 1500);
});
function installRealSettingsSave(ctx, write) {
  Object.assign(ctx, {
    applicationResidentDataState: { uploads: [] }, atlasStateWritePromise: Promise.resolve(), atlasPersistenceMeta: {},
    serializeJacsTeamBonus: data => data,
    applyOpsGlobalData: data => { ctx.opsGlobalData = data; },
    writeOpsGlobalStorage: () => write,
    clearAtlasPersistenceError() {}, persistAtlasPersistenceMeta() {}, markAtlasPersistenceError() {},
  });
  for (const name of ['atlasInvestorPacketState','bonusQuarter','bonusQuarterManualOverride','bonusEngineState','jacsTeamBonus','regionalAssignments','salarySecurity','monthlyPresentationCommunities','reportHubCommunityProgressCommunities','reportHubLvrCommunity','weeklyExecutiveEmail','portfolioReportSections','portfolioReportFilters','portfolioReportMode','atlasWorkbookImportMode','reportHubType','reportHubPerspective','reportHubMonth','reportHubYear','reportRecommendationOverrides','communityCommandState','windowshadeState','atlasSharedData']) ctx[name] = {};
  for (const name of ['queueAtlasStateWrite', 'persistOpsGlobalSnapshot', 'persistOpsGlobalData']) vm.runInContext(extract(name), ctx);
}
for (const silent of [false, true]) {
  test(`aggregate community save reports one delayed settings failure using real settings helpers and queue (silent=${silent})`, async () => {
    const community = deferred(), settings = deferred(), ctx = saveContext(community.result, null);
    installRealSettingsSave(ctx, settings.result.completion);
    ctx.saveCommunityData(silent); await flush();
    settings.reject(new Error('settings disk full')); await flush();
    assert.equal(ctx.alerts.length, 0, 'The nested settings helper waits for aggregate reporting');
    community.fail('community disk full'); await flush();
    assert.equal(ctx.alerts.length, 1); assert.match(ctx.alerts[0], /settings disk full/); assert.match(ctx.alerts[0], /community disk full/);
  });
}
test('standalone settings save retains its default single failure alert', async () => {
  const settings = deferred(), ctx = saveContext({ ok: true }, null); installRealSettingsSave(ctx, settings.result.completion);
  const result = ctx.persistOpsGlobalData(); await flush(); settings.reject(new Error('settings disk full')); await result.completion;
  assert.equal(ctx.alerts.length, 1); assert.match(ctx.alerts[0], /ATLAS settings could not be saved.*settings disk full/);
  assert.equal(result.ok, false); assert.equal(result.pending, false);
});
