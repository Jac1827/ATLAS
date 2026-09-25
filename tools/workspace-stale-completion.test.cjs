const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js', 'utf8');
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return {promise, resolve}; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function extract(start, end) {
  const first = core.indexOf(start), last = core.indexOf(end, first);
  assert(first >= 0 && last > first);
  return core.slice(first, last);
}
const historyCode = extract('async function dataImportHistoryOperation(', '\nlet dataImportHistoryBase =')
  .replace(/await import\("\.\/features\/import-history\.mjs(?:\?v=[^"]+)?"\)/, 'await historyModule()');
const startupCode = extract('async function initializeAtlasDashboard()', '\nwindow.addEventListener("atlas-central-auth-change"')
  .replace(/await import\("\.\/features\/workspace-bootstrap\.mjs(?:\?v=[^"]+)?"\)/, 'await bootstrapModule()');

function historyFixture() {
  const calls = [], ctx = {
    AbortController, DOMException,
    atlasWorkspaceAccess: {epoch: 1, controller: new AbortController()},
    ATLAS_STATE_DB_NAME: 'actor-a', ATLAS_STATE_STORE_NAME: 'records', DATA_IMPORT_2_STATE_KEY: 'imports',
    dataImport2State: {historyStorage: {view: 'current', revision: 1}}, dataImportHistoryRevision: 1,
    context: 'actor-a/scope-a', getAtlasRenderContextKey() { return ctx.context; },
    ensureAtlasCanonicalImportEvidence: async () => {},
    historyModule: async () => ({historyOperation: async request => { calls.push(request); return {ok: true}; }})
  };
  vm.createContext(ctx); vm.runInContext(historyCode, ctx);
  const switchActor = () => {
    ctx.atlasWorkspaceAccess.controller.abort();
    ctx.atlasWorkspaceAccess = {epoch: ctx.atlasWorkspaceAccess.epoch + 1, controller: new AbortController()};
    ctx.ATLAS_STATE_DB_NAME = 'actor-b'; ctx.context = 'actor-b/scope-b';
    ctx.dataImport2State = {historyStorage: {view: 'current', revision: 91}, owner: 'actor-b'};
    ctx.dataImportHistoryRevision = 91;
  };
  return {ctx, calls, switchActor};
}

function startupFixture(configured = true) {
  const held = deferred(); let importEntered = false;
  const ctx = {
    AbortController, DOMException,
    performance: {mark() {}, measure() {}, clearMeasures() {}},
    window: {ATLAS_CENTRAL: {refreshSession: async () => {}, getSession: () => ({user: {id: ctx.actor}}),
      fetchProfile: async () => ({user_id: ctx.actor}), getAccessContextKey: () => ctx.actor}},
    atlasWorkspaceAccess: {epoch: 0, controller: new AbortController(), source: null, hasData: false},
    ATLAS_STATE_DB_NAME: configured ? 'actor-a' : 'atlas_rise_state_v1', actor: 'actor-a',
    DEFAULT_CURRENT_MONTH: 8, savedData: {Example: {occupied: 0}},
    resetAtlasAuxiliaryContext() {},
    loadSideNavCollapsed: () => false, applySideNavState() {}, renderAtlasStartupLoadingState() {},
    applyAtlasAuthEntryFromLocation() {}, applyAtlasAuthRedirectEvent() {},
    getAtlasCentralStatus: () => ({configured}),
    measureAtlasStartupStage: async (_name, fn) => fn(),
    bootstrapModule: async () => ({accessNamespace: async () => 'actor-a'}),
    switchAtlasWorkspaceStorage: async () => true,
    atlasWorkspaceActorKey: () => ctx.actor,
    hydrateOpsGlobalStorage: async () => {}, hydrateDashboardPersistentState: async () => {},
    atlasStateGetValue: async key => key === 'atlas_workspace_source_v2'
      ? {identity: {version: 1, archiveHash: 'archive-a'}, verifiedAt: 'verified-a', dirty: false}
      : {historyStorage: {view: 'remote', archiveHash: 'archive-a'}},
    hydrateOpsGlobalData() { ctx.globalHydrations = (ctx.globalHydrations || 0) + 1; },
    hydrateDataImport2State: async () => { importEntered = true; return held.promise; },
    applyIncomingWorkspaceNavigation() { ctx.navigations = (ctx.navigations || 0) + 1; },
    runAtlasInitialRenderPassYielding: async current => { assert(current()); ctx.renders = (ctx.renders || 0) + 1; return true; },
    requestAnimationFrame() {}, recordAtlasAuthenticatedShellPaint() {}, finishAtlasStartupLoadingState() {}, renderTab() {}
  };
  vm.createContext(ctx); vm.runInContext(startupCode, ctx);
  return {ctx, held, entered: () => importEntered};
}

(async () => {
  // A pending lazy module must not bind an old request to a newly selected DB.
  {
    const {ctx, calls, switchActor} = historyFixture(), module = deferred();
    ctx.historyModule = () => module.promise;
    const pending = ctx.dataImportHistoryOperation('preferences', {value: {activeView: 'history'}});
    switchActor(); module.resolve({historyOperation: async request => {calls.push(request);}});
    await assert.rejects(pending, {name: 'AbortError'});
    assert.equal(calls.length, 0, 'No read/write dispatch against the new actor database');
    assert.equal(ctx.dataImportHistoryRevision, 91);
  }
  // A worker may finish after cancellation: its revision must not enter B state.
  {
    const {ctx, calls, switchActor} = historyFixture(), current = deferred();
    ctx.dataImport2State.historyStorage.view = 'remote';
    ctx.historyModule = async () => ({historyOperation: async request => {calls.push(request); return current.promise;}});
    const pending = ctx.dataImportHistoryOperation('page', {collection: 'batches'});
    await turn(); assert.equal(calls.length, 1); assert.equal(calls[0].operation, 'current');
    assert.equal(calls[0].dbName, 'actor-a');
    switchActor(); assert.equal(calls[0].signal.aborted, true);
    current.resolve({historyStorage: {view: 'current', revision: 2}});
    await assert.rejects(pending, {name: 'AbortError'});
    assert.equal(calls.length, 1, 'No page dispatch after stale current read');
    assert.equal(ctx.dataImportHistoryRevision, 91); assert.equal(ctx.dataImport2State.historyStorage.revision, 91);
  }
  // A→B→A is still stale even if the visible context/DB strings return to A.
  {
    const {ctx, calls} = historyFixture(), module = deferred();
    ctx.historyModule = () => module.promise;
    const pending = ctx.dataImportHistoryOperation('records', {keys: ['example']});
    ctx.atlasWorkspaceAccess.epoch += 2;
    module.resolve({historyOperation: async request => {calls.push(request);}});
    await assert.rejects(pending, {name: 'AbortError'}); assert.equal(calls.length, 0);
  }
  // Successful remote loads keep values, signals, destination and normal flow.
  {
    const {ctx, calls} = historyFixture(), external = new AbortController();
    ctx.dataImport2State.historyStorage.view = 'remote';
    ctx.historyModule = async () => ({historyOperation: async request => {
      calls.push(request);
      return request.operation === 'current' ? {historyStorage: {view: 'current', revision: 2}} : {rows: [{value: 0}, {value: null}]};
    }});
    const result = await ctx.dataImportHistoryOperation('page', {collection: 'batches', signal: external.signal});
    assert.deepEqual(result, {rows: [{value: 0}, {value: null}]});
    assert.equal(ctx.dataImportHistoryRevision, 2);
    assert.equal(calls.length, 2); assert(calls.every(call => call.dbName === 'actor-a' && !call.signal.aborted));
    external.abort(); assert(calls.every(call => !call.signal.aborted), 'External listeners removed after settlement');
    await assert.rejects(ctx.dataImportHistoryOperation('page', {signal: external.signal}), {name: 'AbortError'});
    assert.equal(calls.length, 2);
  }
  // Accepted writes settle in their original database; old UI receives no result.
  {
    const {ctx, calls, switchActor} = historyFixture(), commit = deferred();
    let settled = false;
    ctx.historyModule = async () => ({historyOperation: async request => {calls.push(request); await commit.promise; settled = true; return {revision: 2, verified: true};}});
    const pending = ctx.dataImportHistoryOperation('update', {set: {example: 0}});
    await turn(); switchActor(); assert.equal(settled, false);
    commit.resolve(); await assert.rejects(pending, {name: 'AbortError'});
    assert.equal(settled, true); assert.equal(calls[0].dbName, 'actor-a'); assert.equal(ctx.dataImportHistoryRevision, 91);
  }
  // hydrateDataImport2State intentionally returns false when canceled. A stale
  // startup must stop before restoring A's source receipt or hasData flag.
  {
    const {ctx, held, entered} = startupFixture(), pending = ctx.initializeAtlasDashboard();
    await turn(); assert(entered());
    ctx.actor = 'actor-b'; ctx.ATLAS_STATE_DB_NAME = 'actor-b';
    ctx.atlasWorkspaceAccess.controller.abort();
    ctx.atlasWorkspaceAccess = {epoch: 2, controller: new AbortController(), source: {archiveHash: 'archive-b'}, hasData: false};
    held.resolve(false); await pending;
    assert.equal(ctx.atlasWorkspaceAccess.source.archiveHash, 'archive-b');
    assert.equal(ctx.atlasWorkspaceAccess.hasData, false); assert.equal(ctx.renders, undefined); assert.equal(ctx.navigations, undefined);
  }
  // Also deny same-epoch backend/actor changes and the explicit offline path.
  for (const change of ['database', 'actor', 'offline-epoch']) {
    const {ctx, held, entered} = startupFixture(change !== 'offline-epoch'), pending = ctx.initializeAtlasDashboard();
    await turn(); assert(entered()); const hydrations = ctx.globalHydrations || 0;
    if (change === 'database') ctx.ATLAS_STATE_DB_NAME = 'actor-b';
    else if (change === 'actor') ctx.actor = 'actor-b';
    else ctx.atlasWorkspaceAccess.epoch += 1;
    ctx.atlasWorkspaceAccess.source = {archiveHash: 'new-source'}; held.resolve(false); await pending;
    assert.equal(ctx.atlasWorkspaceAccess.source.archiveHash, 'new-source'); assert.equal(ctx.atlasWorkspaceAccess.hasData, false);
    assert.equal(ctx.globalHydrations || 0, hydrations); assert.equal(ctx.renders, undefined);
  }
  {
    const {ctx, held} = startupFixture(), pending = ctx.initializeAtlasDashboard();
    await turn(); held.resolve(true); await pending;
    assert.equal(ctx.atlasWorkspaceAccess.source.archiveHash, 'archive-a');
    assert.equal(ctx.atlasWorkspaceAccess.hasData, true); assert.equal(ctx.renders, 1);
  }
  console.log('PASS stale completions: before-import binding, actor/access epoch and DB guards, worker revision isolation, cancellation, atomic write settlement, cached/offline startup and normal zero/null flow.');
})().catch(error => {console.error(error); process.exitCode = 1;});
