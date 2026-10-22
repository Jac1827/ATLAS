const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../docs/portfolio-operations-dashboard/central-services.js'), 'utf8');
const now = '2026-10-22T16:00:00.000Z';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return Date.parse(now); }
}

// Run the complete production module. Only the host clock and inert page shell
// are supplied; parsing, lifecycle creation, normalization and rendering are real.
function harness() {
  const context = vm.createContext({
    console, Date: FixedDate, Map, Set,
    window: {},
    document: { getElementById: () => null },
    getAllCommunityNames: () => ['Synthetic Community']
  });
  const exports = [
    'defaultState', 'normalizeState', 'createMoveOutLifecycleRecord',
    'createMoveOutCaseFromRenewal', 'syncRenewalSummaryNtvIntake',
    'applyRenewalStatusChange', 'renderTaskTable', 'dashboardTaskRow',
    'renderManualMoveOutPanel', 'daysUntil'
  ];
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'window.testApi = {' + exports.join(',') + '}; })();'), context);
  const api = context.window.testApi;
  const state = api.defaultState();
  Object.assign(state.ui, { propertyId: 'Synthetic Community', monthIdx: 9, year: 2026 });
  return { api, state, window: context.window };
}
const plain = value => JSON.parse(JSON.stringify(value));
const incoming = extra => ({
  propertyName: 'Synthetic Community', residentName: 'Synthetic Resident', unit: 'SYN-101',
  source: 'renewal_tracker', sourceFileName: 'Synthetic renewal.xlsx', sourceSheetName: 'October 2026',
  importId: 'synthetic-import', periodKey: '2026-10', ...extra
});

test('a parsed NTV row without a source date keeps its case and task undated through reload', () => {
  const { api, state, window } = harness();
  const sheet = [
    ['Resident', 'Unit', 'Expiration Date', 'Renewal Status'],
    ['Synthetic Resident', 'SYN-101', '2026-10-31', 'NTV Received']
  ];
  const originalSheet = plain(sheet);
  const rows = window.atlasCsPreviewRenewalSheetRows(sheet, {
    propertyName: 'Synthetic Community', monthIdx: 9, year: 2026,
    importId: 'synthetic-import', fileName: 'Synthetic renewal.xlsx'
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ntvReceivedDate, '');
  const record = api.createMoveOutCaseFromRenewal(state, rows[0]);
  assert.equal(record.ntvReceivedDate, '');
  assert.equal(record.noticeDate, '');
  assert.equal(record.scheduledMoveOutDate, '');
  assert.equal(record.inspectionDate, '');
  assert.equal(record.workflowStatus, 'On Notice');
  assert.equal(record.inspectionStatus, 'Not Scheduled');
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].dueDate, '');
  assert.equal(state.tasks[0].priority, 'High');
  assert.equal(state.tasks[0].status, 'Open');
  assert.deepEqual(sheet, originalSheet, 'source rows are never repaired in place');

  const reloaded = api.normalizeState(plain(state));
  assert.equal(reloaded.moveOutCases[0].ntvReceivedDate, '');
  assert.equal(reloaded.moveOutCases[0].noticeDate, '');
  assert.equal(reloaded.tasks[0].dueDate, '');
  api.createMoveOutCaseFromRenewal(reloaded, rows[0]);
  assert.equal(reloaded.moveOutCases.length, 1, 'retry does not duplicate cases');
  assert.equal(reloaded.tasks.length, 1, 'retry does not duplicate tasks');
});

test('summary-only NTV intake cannot supply a fabricated date to the constructor', () => {
  const { api, state } = harness();
  const result = api.syncRenewalSummaryNtvIntake(state, 'Synthetic Community', 9, 2026, { ntv: 2 }, 'Synthetic summary');
  assert.equal(result.created, 2);
  assert.equal(state.moveOutCases.length, 2);
  assert.equal(state.tasks.length, 2);
  for (const record of state.moveOutCases) {
    assert.equal(record.source, 'renewal_summary_ntv_intake');
    assert.equal(record.summaryPlaceholder, true);
    assert.equal(record.ntvReceivedDate, '');
    assert.equal(record.noticeDate, '');
    assert.equal(record.workflowStatus, 'On Notice');
  }
  for (const task of state.tasks) {
    assert.equal(task.dueDate, '');
    assert.equal(task.priority, 'High');
    assert.equal(task.status, 'Open');
  }
  api.syncRenewalSummaryNtvIntake(state, 'Synthetic Community', 9, 2026, { ntv: 2 }, 'Synthetic summary');
  assert.equal(state.moveOutCases.length, 2);
  assert.equal(state.tasks.length, 2);
});

test('undated tasks render missing dates without overdue classification; dated tasks still become overdue', () => {
  const { api, state } = harness();
  api.createMoveOutLifecycleRecord(state, incoming());
  const undated = state.tasks[0];
  assert.equal(api.daysUntil(undated.dueDate), null);
  const html = api.renderTaskTable(state);
  assert.match(html, /Not dated/);
  assert.doesNotMatch(html, /Overdue/);
  const row = api.dashboardTaskRow(undated, {}, state);
  assert.equal(row.fields.Due, 'Missing scheduled move-out');
  assert.equal(row.fields.Status, 'Open');
  assert.equal(row.ageDays, 0);
  assert.equal(row.dueDate, '');

  api.createMoveOutLifecycleRecord(state, incoming({
    unit: 'SYN-102', residentName: 'Synthetic Dated', ntvReceivedDate: '2026-10-20'
  }));
  const dated = state.tasks[0];
  assert.equal(dated.dueDate, '2026-10-20');
  assert.equal(api.daysUntil(dated.dueDate), -2);
  assert.equal(api.dashboardTaskRow(dated, {}, state).fields.Status, 'Overdue');
  assert.match(api.renderTaskTable(state), /Overdue/);
  dated.status = 'Completed';
  assert.equal(api.dashboardTaskRow(dated, {}, state).fields.Status, 'Completed');
});

test('supplied dates retain precedence and scheduled inspection behavior without inventing notice dates', () => {
  const { api, state } = harness();
  const scheduled = api.createMoveOutLifecycleRecord(state, incoming({ scheduledMoveOutDate: '2026-10-23' }));
  assert.equal(scheduled.ntvReceivedDate, '');
  assert.equal(scheduled.noticeDate, '');
  assert.equal(scheduled.workflowStatus, 'Upcoming Move Out');
  assert.equal(scheduled.inspectionDate, '2026-10-26', 'existing next-business-day inspection rule is preserved');
  assert.equal(state.tasks[0].dueDate, '2026-10-23');
  const notice = api.createMoveOutLifecycleRecord(state, incoming({
    unit: 'SYN-102', noticeDate: '2026-10-13', scheduledMoveOutDate: '2026-10-30'
  }));
  assert.equal(notice.ntvReceivedDate, '2026-10-13');
  assert.equal(notice.noticeDate, '2026-10-13');
  assert.equal(state.tasks[0].dueDate, '2026-10-30', 'scheduled move-out remains ahead of notice date');
  const retained = api.normalizeState(plain(state));
  assert.equal(retained.moveOutCases[0].noticeDate, '2026-10-13', 'existing stored event dates are retained');
});

test('manual form default and explicit manual NTV action retain their existing date behavior', () => {
  const { api, state } = harness();
  assert.match(api.renderManualMoveOutPanel(state, []), /id="atlas-cs-manual-notice"[^>]*value="2026-10-22"/);
  const row = {
    id: 'manual-renewal', propertyName: 'Synthetic Community', residentName: 'Synthetic Manual',
    unit: 'SYN-201', expirationDate: '2026-10-31', periodKey: '2026-10', status: 'Not Started'
  };
  api.applyRenewalStatusChange(state, row, 'NTV Received');
  assert.equal(row.ntvReceivedDate, '2026-10-22');
  assert.equal(state.moveOutCases[0].ntvReceivedDate, '2026-10-22');
  assert.equal(state.tasks[0].dueDate, '2026-10-22');
  assert.equal(state.tasks[0].priority, 'High');
  assert.equal(state.moveOutCases[0].workflowStatus, 'On Notice');
});

