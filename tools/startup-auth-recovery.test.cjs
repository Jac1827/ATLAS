// Exact startup and auth-change code with synthetic session/storage boundaries.
// No network, credentials, source data, or database writes are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const core = fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js', 'utf8');
const stageMeasure = core.match(/^async function measureAtlasStartupStage\([^]*?^\}/m)[0];
const initializer = core.match(/^async function initializeAtlasDashboard\([^]*?^\}/m)[0]
  .replace(/await import\("\.\/features\/workspace-bootstrap\.mjs(?:\?v=[^"]+)?"\)/g, 'workspaceBootstrap');
const listenerStart = core.indexOf('window.addEventListener("atlas-central-auth-change", () => {', core.indexOf('async function initializeAtlasDashboard('));
const listener = core.slice(listenerStart, core.indexOf('\n});', listenerStart) + 4);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

function fixture(initialActor = null, initialAccess = 'approved') {
  let authChanged;
  const c = {
    AbortController, DOMException, Date, JSON, Promise, Map, Set,
    actor: initialActor, access: initialAccess, loading: false, renders: [], profileReads: [], storageSwitches: [], canonicalReads: [], frames: [],
    atlasDashboardInitializationComplete: false,
    atlasWorkspaceAccess: {epoch: 0, validated: false, hasData: false, error: '', controller: null},
    ATLAS_STATE_DB_NAME: 'unverified', DEFAULT_CURRENT_MONTH: 10, savedData: {},
    atlasFinanceRequestController: null, atlasFinanceScopeQueue: new Set(),
    atlasCommunityPlanModule: null, atlasCommunityFinanceModule: null, prepareAtlasReputationView: {pending: null},
    performance,
    clearAtlasAuthenticatedShellObservation() {}, resetAtlasAuxiliaryContext() {}, loadSideNavCollapsed() { return false; }, applySideNavState() {},
    renderAtlasStartupLoadingState() { c.loading = true; },
    finishAtlasStartupLoadingState() { c.loading = false; c.atlasDashboardInitializationComplete = true; },
    applyAtlasAuthEntryFromLocation() {}, applyAtlasAuthRedirectEvent() {},
    getAtlasCentralStatus: () => ({configured: true, signedIn: !!c.actor}),
    atlasWorkspaceActorKey: () => JSON.stringify(c.actor),
    clearAtlasSharedApplications() { c.sharedCleared = (c.sharedCleared || 0) + 1; },
    document: {querySelectorAll: () => [{dataset: {}, replaceChildren() { c.panelsCleared = (c.panelsCleared || 0) + 1; }}]},
    window: {addEventListener(type, callback) { if (type === 'atlas-central-auth-change') authChanged = callback; }},
    renderTab() { c.renders.push({actor: c.actor, validated: c.atlasWorkspaceAccess.validated, hasData: c.atlasWorkspaceAccess.hasData, error: c.atlasWorkspaceAccess.error}); },
    workspaceBootstrap: {accessNamespace: async (_central, profile) => 'db:' + profile.actor + ':' + profile.access},
    switchAtlasWorkspaceStorage: async (namespace, current) => { if (!current()) return false; c.ATLAS_STATE_DB_NAME = namespace; c.storageSwitches.push(namespace); return true; },
    hydrateOpsGlobalStorage: async () => {}, hydrateDashboardPersistentState: async () => {}, atlasStateGetValue: async () => null,
    refreshAtlasCanonicalWorkspace: async () => { c.canonicalReads.push(c.ATLAS_STATE_DB_NAME); c.atlasWorkspaceAccess.hasData = true; return true; },
    applyIncomingWorkspaceNavigation() {}, recordAtlasAuthenticatedShellPaint() {},
    runAtlasInitialRenderPassYielding: async current => { if (!current()) return false; c.finishAtlasStartupLoadingState(); c.renderTab(); return true; },
    requestAnimationFrame: callback => c.frames.push(callback)
  };
  c.window.ATLAS_CENTRAL = {
    getSession: () => c.actor ? {user: {id: c.actor}} : null,
    getAccessContextKey: () => c.actor ? JSON.stringify([c.actor, c.access]) : null,
    refreshSession: async () => c.window.ATLAS_CENTRAL.getSession(),
    fetchProfile: async () => { const profile = {actor: c.actor, access: c.access}; c.profileReads.push(profile); return profile; }
  };
  c.atlasLastWorkspaceActor = c.atlasWorkspaceActorKey();
  c.atlasLastWorkspaceAccess = c.window.ATLAS_CENTRAL.getAccessContextKey();
  c.changeAccess = (actor, access = c.access) => { c.actor = actor; c.access = access; authChanged(); };
  vm.createContext(c);
  vm.runInContext(stageMeasure + '\n' + initializer + '\n' + listener, c);
  return c;
}

(async () => {
  const empty = fixture();
  await empty.initializeAtlasDashboard();
  assert.equal(empty.loading, false);
  assert.equal(empty.atlasDashboardInitializationComplete, true);
  assert.deepEqual(empty.renders, [{actor: null, validated: false, hasData: false, error: ''}]);
  assert.equal(empty.profileReads.length, 0);
  assert.equal(empty.storageSwitches.length, 0);

  const invalid = fixture('actor-a');
  invalid.window.ATLAS_CENTRAL.refreshSession = async () => {
    if (invalid.actor) {
      invalid.changeAccess(null);
      throw Object.assign(new Error('Synthetic refresh token invalid'), {invalidRefreshToken: true});
    }
    return null;
  };
  await invalid.initializeAtlasDashboard(); await settle();
  assert.equal(invalid.loading, false, 'Initial token invalidation reaches signed-out UI instead of leaving a blank loading screen');
  assert.equal(invalid.atlasDashboardInitializationComplete, true);
  assert.equal(invalid.sharedCleared, 1, 'Access loss still clears shared records');
  assert.equal(invalid.panelsCleared, 1, 'Access loss still conceals the prior panel');
  assert.deepEqual(invalid.renders, [{actor: null, validated: false, hasData: false, error: ''}]);
  assert.equal(invalid.profileReads.length, 0);
  assert.equal(invalid.storageSwitches.length, 0);

  const normal = fixture('actor-a');
  await normal.initializeAtlasDashboard();
  assert.equal(normal.loading, false);
  assert.equal(normal.atlasWorkspaceAccess.validated, true);
  assert.deepEqual(normal.storageSwitches, ['db:actor-a:approved']);
  assert.equal(normal.renders.length, 1);
  const sameEpoch = normal.atlasWorkspaceAccess.epoch;
  normal.changeAccess('actor-a'); await settle();
  assert.equal(normal.atlasWorkspaceAccess.epoch, sameEpoch, 'Same actor/access token rotation does not restart the workspace');
  assert.equal(normal.profileReads.length, 1);

  const refreshed = fixture('actor-a', 'expired-profile');
  refreshed.window.ATLAS_CENTRAL.refreshSession = async () => {
    if (refreshed.access === 'expired-profile') refreshed.changeAccess('actor-a', 'approved');
    return refreshed.window.ATLAS_CENTRAL.getSession();
  };
  await refreshed.initializeAtlasDashboard(); await settle();
  assert.equal(refreshed.loading, false);
  assert.equal(refreshed.atlasWorkspaceAccess.validated, true);
  assert.equal(refreshed.profileReads.length, 1, 'Superseded session refresh cannot enter authorization for the newer initializer');
  assert.deepEqual(refreshed.storageSwitches, ['db:actor-a:approved']);
  assert.equal(refreshed.renders.length, 1);

  const competing = fixture('actor-a');
  const older = deferred(), newer = deferred();
  competing.window.ATLAS_CENTRAL.fetchProfile = async () => {
    const profile = {actor: competing.actor, access: competing.access};
    competing.profileReads.push(profile);
    await (profile.actor === 'actor-a' ? older.promise : newer.promise);
    return profile;
  };
  const oldStartup = competing.initializeAtlasDashboard(); await settle();
  const oldSignal = competing.atlasWorkspaceAccess.controller.signal;
  competing.changeAccess('actor-b', 'restricted'); await settle();
  assert.equal(oldSignal.aborted, true);
  assert.equal(competing.atlasWorkspaceAccess.validated, false);
  assert.equal(competing.panelsCleared, 1);
  older.resolve(); await oldStartup;
  assert.equal(competing.storageSwitches.length, 0, 'Late old authorization cannot select a database or reveal records');
  assert.equal(competing.loading, true, 'Obsolete startup cannot finish the newer pending authorization');
  newer.resolve(); await settle();
  assert.equal(competing.loading, false);
  assert.deepEqual(competing.storageSwitches, ['db:actor-b:restricted']);
  assert.deepEqual(competing.canonicalReads, ['db:actor-b:restricted']);
  assert.equal(competing.renders.length, 1);
  assert.equal(competing.renders[0].actor, 'actor-b');
  assert.equal(competing.atlasWorkspaceAccess.error, '', 'Overlapping stage measurements cannot fail the current authorization');
  assert.equal(performance.getEntriesByName('atlas:authorization').length, 1, 'Stage measurements remain bounded');

  const transient = fixture('actor-a');
  transient.window.ATLAS_CENTRAL.refreshSession = async () => { throw Object.assign(new Error('Synthetic sign-in service unavailable'), {authTransient: true}); };
  await transient.initializeAtlasDashboard();
  assert.equal(transient.loading, false, 'A transient failure terminates startup in its existing unavailable state');
  assert.equal(transient.actor, 'actor-a', 'Transient failures do not destroy the session');
  assert.equal(transient.atlasWorkspaceAccess.validated, false);
  assert.equal(transient.storageSwitches.length, 0);
  assert.match(transient.renders[0].error, /sign-in service unavailable/);
  console.log('PASS initial invalid-session recovery, empty-session login, authorized startup, same-scope rotation, refreshed access, competing epochs and fail-closed transient failure; synthetic only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
