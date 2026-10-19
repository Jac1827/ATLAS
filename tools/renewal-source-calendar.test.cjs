const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { readDashboardSource } = require('./dashboard-source.cjs');
const XLSX = require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const c = vm.createContext({ console, Date, Map, Set, window: {}, XLSX, MONTHS: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] });
const central = fs.readFileSync('docs/portfolio-operations-dashboard/central-services.js', 'utf8');
vm.runInContext(central.replace(/\}\)\(\);\s*$/, 'window.testParseRenewalFile = parseRenewalFile; })();'), c);
for (const f of readDashboardSource('docs/portfolio-operations-dashboard/index.html').matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) vm.runInContext(f[0], c);
const headers = ['Resident','Unit','Expiration Date','Renewal Status','Renewal Signed Date'];
const agreement = ['Synthetic Future','101','2027-01-01','Signed & Executed','2026-10-15'];
const annual = [headers, agreement, ['Synthetic Leap','102','2028-02-29','Undecided','']];
assert.equal(c.renewalWorkbookSheetYear('Jan 27', 2026), 2027);
assert.equal(c.renewalWorkbookSheetYear('Sept 26', 2025), 2026);
assert.equal(c.renewalWorkbookSheetYear('February 2028', 2026), 2028);
assert.equal(c.renewalWorkbookSheetYear('Annual agreements', 2026), 2026);
assert.equal(c.dataImportRowPeriod({}, {sourceSheet:'Jan 27'}, {reportType:'renewal_tracker',reportingYear:2026}).periodKey, '2027-01');
const priorTZ = process.env.TZ;
for (const timezone of ['America/New_York', 'America/Los_Angeles', 'UTC', 'Pacific/Auckland']) {
  process.env.TZ = timezone;
  const parsed = c.window.atlasCsPreviewRenewalSheetRows(annual, { propertyName: 'Example', year: 2026, monthIdx: 9 });
  for (const row of parsed) {
    const expected = row.expirationDate.slice(0, 7);
    assert.equal(c.dataImportRowPeriod({ renewal_expiration: row.expirationDate }, { sourceSheet: 'October 2026' }, { reportType: 'renewal_tracker', reportingYear: 2026 }).periodKey, expected, `${timezone}: canonical and resident expiration months agree`);
  }
  assert.equal(c.dataImportRowPeriod({ renewal_expiration: '2027-02-29' }, { sourceSheet: 'February 2027' }, { reportType: 'renewal_tracker', reportingYear: 2027 }).periodKey, '', 'Invalid calendar dates remain held');
}
if (priorTZ === undefined) delete process.env.TZ; else process.env.TZ = priorTZ;
const workbook = XLSX.utils.book_new();
const append = (name, rows) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
append('SETUP', [['Property Name', 'Example'], ['Month/Year', 'October 2026']]);
append('example', [['Other - 2026 Renewals'], headers, ['Synthetic Example', '999', '2026-05-01', 'Undecided', '']]);
append('TEMPLATE Jan 2027', [headers, ['Synthetic Template', '998', '2027-01-01', 'Undecided', '']]);
append('Jan 27', [headers, agreement]);
append('Feb 2027', [headers, agreement]); // copied tab: dates, not its label, govern the cohort
append('Annual agreements', [headers, annual[2]]);
const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
const file = { name: 'Example.xlsx', arrayBuffer: async () => bytes };
const untouchedDoro = { propertyName: 'Doro', renewalDetailRowsByPeriod: {}, monthlyHistoryByPeriod: {} };
const record = { monthlyData: Array.from({ length: 12 }, () => ({ occupiedSnapshot: 123 })), monthlyHistoryByPeriod: {}, renewalDetailRowsByPeriod: { '2029-03': [{ id: 'retained', expirationDate: '2029-03-31', status: 'Not Started' }] } };
Object.assign(c, {
  getAllCommunityNames: () => ['Example', 'Other', 'Doro'],
  getPropertyRecordForApply: name => name === 'Example' ? record : untouchedDoro,
  getProp: () => ({ name: 'Other' }), savedData: { Doro: untouchedDoro }, renewalImportLog: [], dataImport2State: { closedPeriods: [] },
  getRecordMonthEntryForPeriod: (r, m, y) => r.monthlyHistoryByPeriod[`${y}-${String(m + 1).padStart(2, '0')}`] ||= {},
  normalizeSavedCommunityRecord: (_, r) => r, setRecordPeriodImportStamp: () => {}
});
c.window.atlasCsIngestRenewalSheetRows = (rows, context) => ({ renewalRows: c.window.atlasCsPreviewRenewalSheetRows(rows, context), importId: context.importId, ntvCount: 0 });
(async () => {
  assert.equal(c.getRenewalWorkbookIdentity(workbook, file.name).communityName, 'Example', 'A populated example cannot conflict with the operational property');
  const plan = await c.dataImportPreviewRenewalWorkbook(file, { communities: ['Example'], selectedCommunities: ['Example'], issues: [], reportingYear: 2026, status: 'ready' });
  assert.equal(plan.rowCount, 2, 'Example and template records are excluded and copied agreements count once');
  assert.deepEqual(Array.from(plan.renewalPeriods), ['2027-01', '2028-02']);
  assert.equal(plan.status, 'review');
  assert(plan.issues.some(issue => issue.title === 'Renewal dates differ from the month tab' && issue.detail.includes('Feb 2027') && issue.detail.includes('2027-01')));
  const canonical = await c.dataImportReadStructuredRows(file, { reportType: 'renewal_tracker', communities: ['Example'], reportingYear: 2026 });
  assert.deepEqual(Array.from(canonical, sheet => sheet.sheetName), ['Jan 27', 'Feb 2027', 'Annual agreements']);
  assert.equal(plan.issues.length, 1, 'A two-digit source year must not produce a false sheet-date conflict');
  const standalone = await c.window.testParseRenewalFile(file, { propertyName: 'Example', monthIdx: 9, year: 2026 }, []);
  assert.equal(standalone.length, 3, 'The Central Services upload also excludes populated reference sheets');
  // Generate a wholly synthetic serialized XLSX with a red source fill. The
  // basic XLSX writer omits custom fills, so add that fill to its ZIP styles.
  const highlighted = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(highlighted, XLSX.utils.aoa_to_sheet([headers, ['Synthetic Highlight', '103', '2027-01-01', '', '']]), 'Jan 2027');
  const zip = XLSX.CFB.read(XLSX.write(highlighted, {type:'buffer',bookType:'xlsx'}), {type:'buffer'});
  const styles = Buffer.from(XLSX.CFB.find(zip, '/xl/styles.xml').content).toString('utf8').replace('<patternFill patternType="none"/>', '<patternFill patternType="solid"><fgColor rgb="FFFF0000"/><bgColor indexed="64"/></patternFill>');
  XLSX.CFB.utils.cfb_add(zip, '/xl/styles.xml', Buffer.from(styles));
  const styledBytes = XLSX.CFB.write(zip, {type:'buffer',fileType:'zip'});
  const styledCanonical = await c.dataImportReadStructuredRows({name:'Highlighted.xlsx',arrayBuffer:async()=>styledBytes}, {reportType:'renewal_tracker',communities:['Example'],reportingYear:2027});
  assert.equal(styledCanonical[0].rows[0].values.renewal_status, 'NTV Received', 'Serialized source highlights agree with renewal preview in the canonical import');
  await c.handleRenewalWorkbook(file, { communityName: 'Example', reportingYear: 2026 });
  await c.handleRenewalWorkbook(file, { communityName: 'Example', reportingYear: 2026 });
  assert.equal(record.renewalDetailRowsByPeriod['2027-01'].length, 1, 'Copied month tabs and repeated uploads do not duplicate agreements');
  assert.equal(record.monthlyHistoryByPeriod['2027-01'].renewalSigned, 1);
  assert.equal(record.monthlyHistoryByPeriod['2028-02'].renewalUndecided, 1);
  assert.equal(record.renewalDetailRowsByPeriod['2029-03'].length, 1, 'Omitted future periods remain intact');
  assert(!record.renewalDetailRowsByPeriod['2027-02'], 'A copied tab does not invent February expiration dates');
  assert(!record.renewalDetailRowsByPeriod['2026-05'], 'Reference examples never publish a cohort');
  assert(record.monthlyData.every(month => month.occupiedSnapshot === 123), 'Occupancy is unchanged');
  assert.deepEqual(untouchedDoro, { propertyName: 'Doro', renewalDetailRowsByPeriod: {}, monthlyHistoryByPeriod: {} }, 'Doro remains excluded from the three-property import');
  console.log('PASS renewal calendar months across time zones, reference-tab exclusion, source/tab conflicts, future-year replay and omitted-month preservation');
})().catch(error => { console.error(error); process.exitCode = 1; });
