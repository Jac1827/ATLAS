const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const central = fs.readFileSync(path.join(root, 'docs/portfolio-operations-dashboard/central-services.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'docs/portfolio-operations-dashboard/workspace-core.js'), 'utf8');
const key = 'atlas_central_services_phase1_v2';
const functions = ['buildPeriodKey', 'getImportedRenewalPeriod', 'summarizeImportedRenewalDetailRows', 'groupImportedRenewalDetailRowsByPeriod', 'mergeImportedRenewalDetails', 'syncRenewalSheetRowsToCentralServices'];

function fixture({ cached = false } = {}) {
  const storage = new Map(), effects = [];
  const c = vm.createContext({ console, Date, Map, Set, window: {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    alert: message => { throw Error(message); }, fetch: () => { throw Error('Unexpected network'); },
    setTimeout: () => { throw Error('Unexpected scheduled communication'); },
    getAllCommunityNames: () => ['Example'], getSelectedDashboardMonthIndex: () => 9,
    normalizeSavedCommunityRecord: (_name, value) => value, isCommunityStatusActive: () => true,
    MONTHS: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  });
  vm.runInContext(central, c);
  for (const name of functions) {
    const source = [...core.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)].find(m => m[0].startsWith(`function ${name}(`));
    assert(source, name); vm.runInContext(source[0], c);
  }
  const raw = [['Resident', 'Unit', 'Expiration Date', 'Renewal Status', 'Notes', 'Current Rent'], ['Synthetic Agreement', '101', '2026-11-30', 'Signed', 'Latest source note', 1800]];
  const context = { propertyName: 'Example', monthIdx: 10, year: 2026, fileName: 'Latest.xlsx', importId: 'new-source' };
  const incoming = c.window.atlasCsPreviewRenewalSheetRows(raw, context)[0];
  const prior = { ...JSON.parse(JSON.stringify(incoming)), status: 'NTV Received', notes: 'Reviewed workflow note',
    nextAction: 'Review retained notice', currentRate: 1700, currentRent: 1700,
    sourceFileName: 'Prior.xlsx', importId: 'prior-source', importBatchId: 'prior-source',
    importedAt: '2026-09-19T12:00:00Z', activity: [
      { at: '2026-09-19T12:00:00Z', label: 'Imported from Prior.xlsx' },
      { at: '2026-09-20T12:00:00Z', label: 'Reviewed renewal decision', by: 'Synthetic reviewer' }
    ] };
  const record = { monthlyData: Array.from({ length: 12 }, () => ({})), monthlyHistoryByPeriod: {},
    renewalDetailRowsByPeriod: { '2026-11': [prior] }, renewalDetailRowsByMonth: Array.from({ length: 12 }, (_, i) => i === 10 ? [prior] : []) };
  c.savedData = { Example: record };
  const currentCs = cached ? { ...JSON.parse(JSON.stringify(prior)), notes: 'Newer Central Services review', nextAction: 'Central Services next step' } : null;
  storage.set(key, JSON.stringify({ ui: { propertyId: 'all', monthIdx: 9, year: 2026 }, renewals: currentCs ? [currentCs] : [] }));
  return { c, record, raw, context, prior, storage, effects };
}

test('actual loader and ingest retain future-period dashboard workflow when Central Services has only October', () => {
  const f = fixture();
  const result = f.c.syncRenewalSheetRowsToCentralServices(f.record, f.context, f.raw, {});
  const row = f.record.renewalDetailRowsByPeriod['2026-11'][0];
  const stored = JSON.parse(f.storage.get(key)).renewals.find(r => r.id === row.id);
  assert.equal(row.status, 'NTV Received');
  assert.equal(row.notes, f.prior.notes);
  assert.equal(row.nextAction, f.prior.nextAction);
  assert.deepEqual(JSON.parse(JSON.stringify(row.activity.slice(0, 2))), f.prior.activity);
  assert.equal(row.currentRate, 1800, 'Latest source values still apply');
  assert.equal(row.sourceFileName, 'Latest.xlsx');
  assert.equal(row.importId, 'new-source');
  assert.equal(row.leaseExecutedDate, '', 'No execution date is inferred');
  assert.equal(stored.notes, row.notes);
  assert.equal(stored.status, row.status);
  assert.equal(result.periodSummaries[0].summary.ntv, 1);
  assert.equal(JSON.parse(f.storage.get(key)).ui.monthIdx, 9, 'The fixture really selected October');
});

test('an existing Central Services workflow remains authoritative and retains both activity histories', () => {
  const f = fixture({ cached: true });
  f.c.syncRenewalSheetRowsToCentralServices(f.record, f.context, f.raw, {});
  const row = f.record.renewalDetailRowsByPeriod['2026-11'][0];
  assert.equal(row.notes, 'Newer Central Services review');
  assert.equal(row.nextAction, 'Central Services next step');
  assert.equal(row.activity.filter(e => e.label === 'Imported from Prior.xlsx').length, 1);
  assert.equal(row.activity.filter(e => e.label === 'Reviewed renewal decision').length, 1);
  assert.equal(row.sourceFileName, 'Latest.xlsx');
});

test('unrelated identities and cohorts cannot seed the incoming agreement', () => {
  const f = fixture();
  const forged = { ...f.prior, propertyName: 'Other' };
  const result = f.c.window.atlasCsIngestRenewalSheetRows(f.raw, { ...f.context, syncAtlasSummary: false },
    { render: false, setUi: false, existingRenewalRows: [forged] });
  assert.equal(result.renewalRows[0].notes, 'Latest source note');
  assert.equal(result.renewalRows[0].status, 'Signed - Awaiting Execution');
  assert.equal(JSON.parse(f.storage.get(key)).renewals.length, 1);
});

test('older dashboard events cannot displace newer Central Services events at the existing fifty-event limit', () => {
  const f = fixture({ cached: true });
  const state = JSON.parse(f.storage.get(key));
  const current = Array.from({ length: 50 }, (_, index) => ({ at: `2026-10-20T12:${String(index).padStart(2, '0')}:00Z`, label: `Reviewed current event ${index}` }));
  state.renewals[0].activity = current;
  f.storage.set(key, JSON.stringify(state));
  f.c.syncRenewalSheetRowsToCentralServices(f.record, f.context, f.raw, {});
  const activity = f.record.renewalDetailRowsByPeriod['2026-11'][0].activity;
  assert.equal(activity.length, 50);
  assert.deepEqual(JSON.parse(JSON.stringify(activity.slice(0, 49))), current.slice(1), 'Only the same oldest current event that a normal new import replaces may leave the capped list');
  assert.match(activity.at(-1).label, /^Imported from Latest\.xlsx/);
});

test('a pending repair prevents Central Services storage writes', () => {
  const f = fixture();
  const before = f.storage.get(key), dashboardBefore = JSON.stringify(f.record);
  f.c.alert = () => {};
  f.c.atlasRenewalRepairPending = () => true;
  assert.throws(() => f.c.syncRenewalSheetRowsToCentralServices(f.record, f.context, f.raw, {}), /repair must finish or recover/);
  assert.equal(f.storage.get(key), before);
  assert.equal(JSON.stringify(f.record), dashboardBefore, 'A deliberately blocked save cannot return uncommitted rows for dashboard application');
});
