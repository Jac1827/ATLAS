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
  const ctx = {
    Promise, Error, DOMException, Date, Set, context: 'community-a', ATLAS_STATE_DB_NAME: 'db-a', atlasWorkspaceAccess: { epoch: 1 },
    getAtlasRenderContextKey: () => ctx.context, escapeHtml: s => String(s).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    marketSurveyImportLog: [], marketSurveyImportOperation: null, marketSurveyImportSourceLabel: '', renders: 0, grids: 0,
    renderTab() { ctx.renders++; }, renderPropGrid() { ctx.grids++; },
    handleMarketSurveyWorkbook: async () => 'A', handleMarketSurveyPdf: async () => 'A',
  };
  vm.createContext(ctx);
  for (const name of ['awaitAtlasPersistenceResults', 'captureAtlasMarketSurveyContext', 'updateMarketSurveyImportInputs', 'processMarketSurveyFiles']) vm.runInContext(extract(name), ctx);
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
  assert.equal(ctx.saveCommunityData(), undefined); ctx.atlasWorkspaceAccess.epoch++;
  local.fail('aborted'); global.succeed(); await flush(); assert.equal(ctx.alerts.length, 0);
});
test('silent save has no success popup but still reports a failure', async () => {
  const ok = saveContext({ ok: true }, { ok: true });
  assert.equal(ok.saveCommunityData(true), undefined); await flush(); assert.equal(ok.alerts.length, 0);
  const failed = saveContext({ ok: false, message: 'storage full' }, { ok: true });
  assert.equal(failed.saveCommunityData(true), undefined); await flush(); assert.match(failed.alerts[0], /storage full/);
});
test('real queued save abort before the task body cannot be reported as completed', async () => {
  const ctx = context();
  Object.assign(ctx, {
    atlasStateWritePromise: Promise.resolve(), atlasPersistenceMeta: {}, dashboardSharedSyncMeta: {},
    buildSerializedSavedDataPayload: () => ({}), atlasStateSetValue: async () => assert.fail('wrong workspace must not write'),
    removeLegacyCommunityStorageKeys() {}, persistDashboardSharedSyncMeta() {}, clearAtlasPersistenceError() {},
    persistAtlasPersistenceMeta() {}, markAtlasPersistenceError() {},
  });
  vm.runInContext(extract('queueAtlasStateWrite') + '\n' + extract('persistSaved'), ctx);
  const result = ctx.persistSaved(); ctx.ATLAS_STATE_DB_NAME = 'db-b';
  await assert.rejects(ctx.awaitAtlasPersistenceResults([{ result, label: 'Community data' }]), /did not complete/);
  assert.equal(result.pending, true);
});

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
  await Promise.resolve(); ctx.context = 'other-community'; write.succeed();
  assert.equal(await upload, false); assert.equal(ctx.renders, 0); assert.equal(ctx.marketSurveyImportSourceLabel, '');
  const parsing = context(); parsing.handleMarketSurveyWorkbook = async () => { parsing.atlasWorkspaceAccess.epoch++; return 'A'; };
  parsing.persistSaved = () => assert.fail('stale parser must not persist');
  assert.equal(await parsing.processMarketSurveyFiles([{ name: 'survey.xlsx' }]), false);
});
function bindInput(ctx, upload = ctx.processMarketSurveyFiles) {
  const input = { dataset: {}, disabled: false, value: 'selected', files: [{ name: 'survey.xlsx' }], addEventListener(type, callback) { this.change = callback; } };
  ctx.document = { querySelectorAll: () => [input] }; ctx.processMarketSurveyFiles = upload;
  const start = source.indexOf('  document.querySelectorAll("#market-survey-input")');
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
  const upload = input.change({ target: input }); ctx.ATLAS_STATE_DB_NAME = 'db-b';
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
    syncCommunityFloorPlanRentMetrics() {}, getSelectedDashboardPeriodKey: () => '2026-09',
    normalizeMarketSurveyHistory: data => ({ ...(data || {}) }), normalizeImportTracking: data => ({ ...(data || {}) }),
    parses: 0, XLSX: { read(buffer) { ctx.parses++; return buffer; } },
    extractMarketSurveyWorkbookData: () => ({ communityName: 'A', compAverageRent: 1500 }),
    parseAptiqMarketSurveyPdfText() { ctx.parses++; return { communityName: 'A', compAverageRent: 1500 }; },
    persistSaved: () => ({ ok: true, pending: false }),
  });
  for (const name of ['captureAtlasMarketSurveyContext', 'applyMarketSurveyDataToProperty', 'handleMarketSurveyWorkbook', 'handleMarketSurveyPdf']) vm.runInContext(extract(name), ctx);
  return ctx;
}
for (const format of ['xlsx', 'pdf']) {
  test(`real ${format} parser cannot mutate another actor or scope after awaiting the file`, async () => {
    const ctx = realHandlerContext(), read = deferred();
    ctx.extractPdfTextFromFile = () => read.result.completion;
    const upload = ctx.processMarketSurveyFiles([{ name: `survey.${format}`, arrayBuffer: () => read.result.completion }]);
    ctx.context = 'new-actor+month'; ctx.atlasWorkspaceAccess.epoch++;
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
test('real workbook library load cannot resume after a workspace switch', async () => {
  const ctx = realHandlerContext(), library = deferred(); delete ctx.XLSX;
  ctx.window = { AtlasFeatures: { load: () => library.result.completion } };
  const upload = ctx.handleMarketSurveyWorkbook({ name: 'survey.xlsx', arrayBuffer: () => assert.fail('stale library must not read the file') });
  ctx.ATLAS_STATE_DB_NAME = 'db-b'; library.succeed();
  assert.equal(await upload, null); assert.equal(ctx.marketSurveyImportLog.length, 0);
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
  ctx.context = 'new-scope'; ctx.atlasWorkspaceAccess.epoch++;
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
