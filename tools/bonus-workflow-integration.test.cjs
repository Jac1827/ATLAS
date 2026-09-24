const {readDashboardSource}=require('./dashboard-source.cjs');
// Execute the real dashboard entry points with local DOM/module doubles only.
// The VM module flag lets us intercept lazy import without rewriting application code.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
if (!vm.SyntheticModule) {
  const result = require('node:child_process').spawnSync(process.execPath, ['--experimental-vm-modules', __filename], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const html = readDashboardSource(__dirname + '/../docs/portfolio-operations-dashboard/index.html') + '\n' + fs.readFileSync(__dirname + '/../docs/portfolio-operations-dashboard/features/bonus-workspace.js', 'utf8');
const fn = name => {
  const match = html.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^\\}', 'm'));
  assert(match, 'Dashboard function must exist: ' + name);
  return match[0];
};
const forbidden = name => () => { throw new Error('Unexpected legacy mutation or network operation: ' + name); };
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

(async () => {
  const alerts = [], navigation = [], frames = [];
  const legacy = {
    atlasBonusCan: () => false,
    atlasBonusState: forbidden('compensation state'), atlasBonusPersist: forbidden('audit persistence'),
    persistOpsGlobalData: forbidden('browser persistence'), renderTab: forbidden('legacy rerender'),
    buildAtlasCentralBonusCalculationPayload: forbidden('legacy calculation payload'),
    fetch: forbidden('network'), localStorage: { setItem: forbidden('local storage') },
    window: { ATLAS_CENTRAL: { recordBonusCalculation: forbidden('legacy RPC') } },
    atlasBonusOpenSharedWorkflow: () => navigation.push('shared'), setTab: tab => navigation.push(tab),
    requestAnimationFrame: callback => frames.push(callback), alert: message => alerts.push(message)
  };
  vm.createContext(legacy);
  const handlers = ['atlasBonusRunCalculations', 'atlasBonusSetRowStatus', 'atlasBonusApproveOverrides', 'atlasBonusRegionalApprove', 'atlasBonusFinalizePeriod', 'atlasBonusReopenPeriod'];
  vm.runInContext(handlers.concat('recordAtlasCentralBonusCalculation').map(fn).join('\n'), legacy);
  for (const name of handlers) {
    const before = navigation.length;
    await legacy[name]('forged-row', 'Paid', { status: 'approved', amount: 999999 });
    assert.equal(navigation.length, before + 1, name + ' must route to the shared permission-checked workflow');
    assert.equal(navigation.at(-1), 'shared');
  }
  await legacy.recordAtlasCentralBonusCalculation();
  assert.equal(navigation.at(-1), 9);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(navigation.at(-1), 'shared');
  assert(alerts.some(message => /cannot approve a shared payout/.test(message)));
  assert(alerts.some(message => /Locked and paid receipts.*(?:retain|cannot be reopened)/.test(message)));

  // Locally forged paid, lock, approval, and override values cannot create a payable row.
  const state = { approvalStatusByRowId: {}, periodLocks: {}, overrides: [], exceptionStatusById: {} };
  const period = { periodKey: '2026-Q1', start: '2026-01-01', end: '2026-03-31' };
  const employee = { employeeId: 'synthetic-employee', assignmentId: 'synthetic-assignment', communityName: 'Synthetic', bonusRole: 'Manager' };
  const rows = {
    atlasBonusState: () => state, simpleHash: () => 'synthetic', atlasBonusGetCommunityOperatingType: () => 'stabilized',
    atlasBonusResolvePlanForEmployee: () => ({ plan: { id: 'plan', metrics: [{ id: 'noi', name: 'NOI', inputType: 'automatic' }] } }),
    atlasBonusProration: () => ({ factor: 1, segments: [] }), communityCommandBonusGoalResult: () => null,
    atlasBonusFinancialEvidence: () => null, atlasBonusMetricActual: () => 100,
    atlasBonusMetricPotential: () => 100, atlasBonusCurvePayoutPct: () => ({ ratio: 100, payoutPct: 100 })
  };
  vm.createContext(rows);
  vm.runInContext(fn('atlasBonusRetainedRow') + '\n' + fn('atlasBonusBuildRow'), rows);
  for (const status of ['Regional Approved', 'HR Ready', 'Paid', 'Locked', 'Paid / Finalized']) {
    state.approvalStatusByRowId.bonus_synthetic = status;
    state.overrides = [{ employeeId: employee.employeeId, status: 'approved', adjustedAmount: 999999 }];
    const row = rows.atlasBonusBuildRow(employee, period);
    assert.equal(row.finalPayout, null, status + ' never supplies an approved payout');
    assert.equal(row.canonicalPayable, false);
    assert.notEqual(row.approvalStatus, 'Paid');
  }
  state.periodLocks[period.periodKey] = { status: 'Paid / Finalized' };
  assert.equal(rows.atlasBonusBuildRow(employee, period).approvalStatus, 'Retained Evidence Required');

  const mounts = [], imports = [], queued = [], clearEvents = [];
  let currentHost = null, importFailure = false, sections = [['calculations', 'Calculations']];
  const central = { getSession: () => ({ user: { id: 'synthetic-signed-in' } }) };
  const makeHost = () => ({ dataset: { workflowContext: ui.atlasBonusSharedWorkflowContext(period) }, isConnected: true, textContent: '', scrollIntoView: value => clearEvents.push(value) });
  const ui = {
    window: { ATLAS_CENTRAL: central }, document: { getElementById: id => id === 'atlas-bonus-shared-workflow' ? currentHost : null },
    requestAnimationFrame: callback => queued.push(callback), atlasBonusState: () => ({ activeSection: 'calculations' }),
    shouldBlockAtlasSensitiveAccess: () => false, atlasAccessDecision: () => ({ ok: true }), getAtlasAccessProfile: () => ({ role: 'admin' }),
    atlasBonusBuildCalculationRows: () => [], defaultBonusEngineState: () => ({ filters: {} }),
    atlasBonusSummary: () => ({ employeeCount: 0, criticalExceptions: 0, projected: 0 }), atlasBonusPeriodFromQuarter: () => period,
    atlasBonusVisibleSections: () => sections, atlasBonusCan: () => false, atlasBonusSectionVisible: () => false,
    atlasBonusRetainedRow: { cache: { clear: () => clearEvents.push('receipt') } },
    atlasBonusSectionCache: new Map([['old', 'stale']]), atlasBonusNavigationSnapshot: { stale: true },
    escapeHtml: String, atlasBonusCurrency: value => '$' + value, atlasBonusJsArg: JSON.stringify,
    renderBonusEngineFilters: () => '', renderBonusEngineSection: () => '', renderBonusCalculationRows: () => '<p>Planning rows</p>',
    fetch: forbidden('network')
  };
  const context = vm.createContext(ui);
  const script = new vm.Script(['atlasBonusOpenSharedWorkflow', 'atlasBonusSharedWorkflowContext', 'atlasBonusMountSharedWorkflow', 'renderBonusTab', 'renderBonusCalculationsSection'].map(fn).join('\n'), {
    importModuleDynamically: async specifier => {
      imports.push(specifier);
      assert.match(specifier, /^\.\/features\/bonus-workflow\.mjs(?:\?v=[a-f\d]+)?$/);
      if (importFailure) throw new Error('Synthetic module unavailable');
      const module = new vm.SyntheticModule(['mountBonusWorkflow'], function () {
        this.setExport('mountBonusWorkflow', async (host, options) => { mounts.push({ host, options }); });
      }, { context });
      await module.link(() => {}); await module.evaluate(); return module;
    }
  });
  script.runInContext(context);
  sections = [];
  assert.match(ui.renderBonusTab(), /does not have Bonus & Incentives access/);
  assert.equal(queued.length, 0, 'No accessible section means no shared mount');
  sections = [['calculations', 'Calculations']];
  const rendered = ui.renderBonusTab();
  assert.match(rendered, /id="atlas-bonus-shared-workflow"/);
  assert.equal(mounts.length, 0, 'Mount waits until returned markup can be installed');
  assert.equal(queued.length, 1);
  currentHost = makeHost(); queued.shift()(); await flush();
  assert.equal(mounts.length, 1); assert.equal(mounts[0].host, currentHost);
  assert.equal(mounts[0].options.central, central); assert.equal(mounts[0].options.periodKey, period.periodKey);
  assert.deepEqual(Object.keys(mounts[0].options).sort(), ['central', 'onChange', 'periodKey'], 'Local permissions or payout state cannot be injected into the shared workflow');
  ui.atlasBonusSectionCache.set('old', 'stale'); mounts[0].options.onChange();
  assert(clearEvents.includes('receipt')); assert.equal(ui.atlasBonusNavigationSnapshot, null); assert.equal(ui.atlasBonusSectionCache.size, 0);
  ui.atlasBonusMountSharedWorkflow(period); queued.shift()(); await flush();
  assert.equal(mounts.length, 1, 'Repeated scheduling cannot mount the same host twice');
  currentHost = null; ui.atlasBonusMountSharedWorkflow(period); queued.shift()(); await flush();
  assert.equal(imports.length, 1, 'Navigating away before the frame prevents import');
  ui.window.ATLAS_CENTRAL = null; ui.atlasBonusMountSharedWorkflow(period); assert.equal(queued.length, 0);
  ui.window.ATLAS_CENTRAL = central; currentHost = makeHost(); importFailure = true;
  ui.atlasBonusMountSharedWorkflow(period); queued.shift()(); await flush();
  assert.match(currentHost.textContent, /Shared Bonus workflow unavailable: Synthetic module unavailable/);
  assert.equal(currentHost.dataset.mounted, undefined, 'A failed import must not permanently mark the preserved host mounted');
  importFailure = false;
  ui.atlasBonusOpenSharedWorkflow(); queued.shift()(); await flush();
  assert.equal(mounts.length, 2, 'An accessible preserved host retries its import after a temporary failure');
  assert.equal(mounts[1].host, currentHost);
  const calculations = ui.renderBonusCalculationsSection([]);
  assert.match(calculations, /Create Shared Calculation/); assert.match(calculations, /Payroll Confirmations/);
  assert.doesNotMatch(calculations, /Period status:|Last calculation run:|Reopen Period|Paid \/ Finalized/);
  assert.match(calculations, /disabled/);
  console.log('PASS Bonus dashboard integration: legacy actions cannot mutate or approve local payouts; forged statuses remain nonpayable; lazy shared mount receives only authenticated client context, deduplicates, invalidates receipt views, and reports load failures.');
})().catch(error => { console.error(error); process.exitCode = 1; });
