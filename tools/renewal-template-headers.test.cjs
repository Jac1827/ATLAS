const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readDashboardSource } = require('./dashboard-source.cjs');
const XLSX = require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');

function harness() {
  const forbidden = () => { throw Error('Preview must not access storage, network or UI'); };
  const c = vm.createContext({ console, Date, Map, Set, XLSX, window: {}, fetch: forbidden,
    localStorage: { getItem: forbidden, setItem: forbidden }, alert: forbidden, prompt: forbidden,
    MONTHS: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] });
  const source = fs.readFileSync(path.join(__dirname, '../docs/portfolio-operations-dashboard/central-services.js'), 'utf8');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'window.testApi = { defaultState, normalizeState, createMoveOutCaseFromRenewal, getActualPossessionDate }; })();'), c);
  for (const match of readDashboardSource(path.join(__dirname, '../docs/portfolio-operations-dashboard/index.html')).matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(match[0], c);
  c.getAllCommunityNames = () => ['Synthetic Community'];
  return c;
}
const context = { propertyName: 'Synthetic Community', year: 2026, monthIdx: 9, fileName: 'Synthetic.xlsx', sourceSheetName: 'Calls', importId: 'synthetic' };
const callHeaders = ['#', '🏢 Bldg-Unit', '🙋 Resident', 'Unit Type', '📅 Lease End', '📞 Renewal Call Status'];
const templateHeaders = [' ', 'Unit', 'Unit\nType', 'Expiration\nDate', '90-Day\nNotice', '60-Day\nNotice', '30-Day\nNotice', 'Deposit\nHeld', 'Current\nRate', 'Recommended\nOffer', 'Investor Override\n% Increase', 'Investor Override\nOffer', 'Offer 1\nConservative', 'Offer 2\nBalanced', 'Offer 3\nAggressive', 'Signed\nOffer', 'Renewal\nSigned', 'Transfer', "NTV\nRcv'd"];
const agreement = (name, unit, date) => [name, unit, 'A1', date, '', '', '', 0, 1000, 1050, '', '', '', '', '', '', '', '', ''];
const plain = value => JSON.parse(JSON.stringify(value));

test('call-tracker headers retain July agreements, source decisions and missing dates', () => {
  const c = harness();
  const rows = [callHeaders,
    [1, 'SYN-101', 'Synthetic Renewed', 'A1', '2027-07-31', '✅ Renewed'],
    [2, 'SYN-102', 'Synthetic Declined', 'A1', '2027-07-31', '👋 Not Renewing'],
    [3, 'SYN-103', 'Synthetic Thinking', 'A1', '2027-07-31', '💬 Spoke - Thinking'],
    [4, 'SYN-104', 'Synthetic Followup', 'A1', '2027-07-31', '🔁 Follow-Up Needed']];
  const original = plain(rows);
  const parsed = c.window.atlasCsPreviewRenewalSheetRows(rows, context);
  assert.equal(parsed.length, 4);
  assert.deepEqual(Array.from(parsed, row => row.periodKey), Array(4).fill('2027-07'));
  assert.deepEqual(Array.from(parsed, row => row.status), ['Signed - Awaiting Execution', 'Declined / Non-Renewal', '💬 Spoke - Thinking', 'Follow-Up Required']);
  assert.deepEqual(Array.from(parsed, row => row.sourceRenewalStatus), rows.slice(1).map(row => row[5]));
  assert(parsed.every(row => row.sourceFileName === context.fileName && row.sourceSheetName === 'Calls'));
  for (const row of parsed) for (const field of ['ntvReceivedDate', 'scheduledMoveOutDate', 'renewalSignedDate', 'leaseExecutedDate', 'completionDate']) assert.equal(row[field], '', field + ' must remain missing');
  assert.equal(parsed[1].sourceRow, 3);
  assert.deepEqual(rows, original, 'Parsing does not repair or rewrite source cells');
});

test('declined call outcome uses existing undated intake without actual possession or execution', () => {
  const c = harness();
  const [row] = c.window.atlasCsPreviewRenewalSheetRows([callHeaders, [1, 'SYN-102', 'Synthetic Declined', 'A1', '2027-07-31', '👋 Not Renewing']], context);
  const api = c.window.testApi, state = api.defaultState();
  state.renewals = [row];
  const intake = api.createMoveOutCaseFromRenewal(state, row);
  assert(intake, 'Established declined handling creates review intake');
  for (const field of ['ntvReceivedDate', 'noticeDate', 'scheduledMoveOutDate', 'inspectionDate']) assert.equal(intake[field], '');
  assert.equal(api.getActualPossessionDate(intake), '');
  assert.equal(intake.workflowStatus, 'On Notice', 'Existing intake status is retained; no workflow definition is changed');
  assert.equal(intake.inspectionStatus, 'Not Scheduled');
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].dueDate, '');
  assert.equal(state.tasks[0].status, 'Open');
  api.createMoveOutCaseFromRenewal(state, row);
  assert.equal(state.moveOutCases.length, 1, 'Repeated source review cannot duplicate intake');
  assert.equal(state.tasks.length, 1);
  const restored = api.normalizeState(plain(state));
  assert.equal(restored.renewals[0].sourceRenewalStatus, '👋 Not Renewing');
  assert.equal(api.getActualPossessionDate(restored.moveOutCases[0]), '');
});

test('only the known management template recovers a blank first name heading', () => {
  const c = harness();
  const data = agreement('Synthetic Template', 'SYN-201', '2026-10-31');
  const rows = [['Synthetic Community - 2026 Renewals'], templateHeaders, data];
  const parsed = c.window.atlasCsPreviewRenewalSheetRows(rows, context);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].sourceRow, 3);
  assert.equal(parsed[0].residentName, 'Synthetic Template');
  assert.equal(parsed[0].depositHeld, 0, 'An explicit numeric zero remains zero');
  assert.equal(parsed[0].ntvReceivedDate, '');
  for (const changed of [
    [' ', 'Unit', 'Unit Type', 'Expiration Date'],
    templateHeaders.map((v, i) => i === 0 ? 'Unrecognized heading' : v),
    templateHeaders.map((v, i) => i === 8 ? 'Unrelated amount' : v),
    templateHeaders.map((v, i) => i === 18 ? 'Unrelated status' : v)
  ]) assert.equal(c.window.atlasCsPreviewRenewalSheetRows([changed, data], context).length, 0, 'Do not infer names for other layouts');
  for (const invalid of ['', 0, '0', '2027-02-29', '02/29/2027']) assert.equal(c.window.atlasCsPreviewRenewalSheetRows([templateHeaders, agreement('Synthetic Missing Date', 'SYN-202', invalid)], context).length, 0, 'Do not invent expiration dates');
  for (const valid of ['2028-02-29', '2/29/2028']) assert.equal(c.window.atlasCsPreviewRenewalSheetRows([templateHeaders, agreement('Synthetic Leap Date', 'SYN-203', valid)], context)[0].expirationDate, '2028-02-29');
});

test('serialized workbook preview and canonical reader agree, deduplicate and keep source periods', async () => {
  const c = harness(), workbook = XLSX.utils.book_new();
  const append = (name, rows) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  append('Oct 2026', [templateHeaders, agreement('Synthetic October', 'SYN-301', '2026-10-31')]);
  append('Jan 2027', [templateHeaders, agreement('Synthetic January', 'SYN-302', '2027-01-31')]);
  append('Feb 2027', [templateHeaders, agreement('Synthetic January', 'SYN-302', '2027-01-31')]);
  append('Calls', [callHeaders, [1, 'SYN-303', 'Synthetic Student', 'A1', '2027-07-31', '👋 Not Renewing']]);
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const file = { name: 'Synthetic Community.xlsx', arrayBuffer: async () => bytes };
  const plan = await c.dataImportPreviewRenewalWorkbook(file, { reportType: 'renewal_tracker', requestedCommunity: 'Synthetic Community', communities: ['Synthetic Community'], selectedCommunities: ['Synthetic Community'], issues: [], reportingYear: 2026, status: 'ready' });
  assert.equal(plan.rowCount, 3);
  assert.deepEqual(Array.from(plan.renewalPeriods), ['2026-10', '2027-01', '2027-07']);
  assert.equal(plan.status, 'review');
  assert.equal(plan.issues.length, 1, 'Copied February dates require review rather than a new February cohort');
  const canonical = await c.dataImportReadStructuredRows(file, plan);
  assert.equal(canonical.flatMap(sheet => sheet.rows).length, 4, 'Structured rows retain per-sheet provenance before agreement deduplication');
  assert(canonical.flatMap(sheet => sheet.rows).every(row => row.canonicalSource));
  const student = canonical.find(sheet => sheet.sheetName === 'Calls').rows[0];
  assert.equal(student.values.renewal_status, 'Declined / Non-Renewal');
  assert.equal(student.values.renewal_expiration, '2027-07-31');
  assert.equal(student.values.renewal_signed_date, '');
});
