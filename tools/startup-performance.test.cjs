const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const html = fs.readFileSync('docs/portfolio-operations-dashboard/index.html', 'utf8');
const jobs = [];
const ctx = vm.createContext({ console, performance, setTimeout: fn => { jobs.push(fn); return jobs.length; } });
for (const match of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(match[0], ctx);
let renders = 0;
let workspaceRenders = 0;
Object.assign(ctx, {
  atlasSharedRenderTimer: null, atlasSharedRenderNeedsWorkspace: false,
  atlasDashboardInitializationComplete: true,
  renderTab: () => renders++, runAtlasInitialRenderPass: () => workspaceRenders++,
  dataImportIsMetadataSheetName: name => name === 'Parameters'
});
ctx.scheduleAtlasSharedRender();
ctx.scheduleAtlasSharedRender(true);
ctx.scheduleAtlasSharedRender();
assert.equal(jobs.length, 1);
jobs.shift()();
assert.equal(workspaceRenders, 1);
assert.equal(renders, 0);
assert.equal(ctx.dataImportIsBoxScoreSheet([['Current Rent'], ['1000']], 'Rent Roll'), false);
assert.equal(ctx.dataImportIsBoxScoreSheet([['Availability (As of 09/18/2026)']], 'Anthem'), true);
assert.equal(ctx.dataImportIsBoxScoreSheet([['Lead Conversions']], 'Parameters'), false);
assert.equal(ctx.dataImportIsBoxScoreSheet(Array.from({ length: 10000 }, () => ['Expense', 100]), 'Budget'), false);

(async () => {
  const pending = [];
  const started = [];
  const read = name => () => new Promise(resolve => { started.push(name); pending.push(resolve); });
  let realtimeOptions;
  Object.assign(ctx, {
    DEFAULT_CURRENT_MONTH: 8, savedData: {},
    window: { ATLAS_CENTRAL: { refreshSession: async () => {} } },
    loadSideNavCollapsed: () => false,
    hydrateOpsGlobalStorage: async () => {}, hydrateDashboardPersistentState: async () => {},
    hydrateDataImport2State: read('import'),
    pullAtlasSharedPropertyGraphFromCentral: read('graph'),
    hydrateSharedPropertiesFromMarketingDatabase: read('marketing'),
    hydrateAtlasDashboardPreferencesFromCentral: read('preferences'),
    startAtlasSharedRealtime: options => { realtimeOptions = options; },
    isDashboardLoadedFromFileProtocol: () => true,
    markAtlasPersistenceError: error => { throw error; }
  });
  for (const name of ['applySideNavState', 'renderAtlasStartupLoadingState', 'applyAtlasAuthEntryFromLocation', 'applyAtlasAuthRedirectEvent', 'applyIncomingWorkspaceNavigation', 'hydrateOpsGlobalData', 'finishAtlasStartupLoadingState', 'startAtlasLivePresence', 'queuePersistedPhotoStorageCompaction']) ctx[name] = () => {};
  const initialization = ctx.initializeAtlasDashboard();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['import', 'graph', 'marketing', 'preferences']);
  assert.equal(workspaceRenders, 1, 'Workspace must wait for scope hydration');
  pending.forEach(resolve => resolve());
  await initialization;
  assert.equal(workspaceRenders, 2);
  assert.equal(realtimeOptions.initialRefresh, false);
  assert.equal(performance.getEntriesByName('atlas:time-to-workspace').length, 1);
  console.log('PASS concurrent startup, scope gate, render coalescing, parser candidate selection and timing marks');
})().catch(error => { console.error(error); process.exitCode = 1; });
