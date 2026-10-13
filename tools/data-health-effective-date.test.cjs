const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js', 'utf8');
const now = Date.parse('2026-10-13T16:00:00Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
function fixture(archive, businessDays = false) {
  const c = vm.createContext({Date: FixedDate, Map, Set});
  for (const name of ['dataImportBusinessDaysBetween', 'dataImportArchiveFreshnessDate', 'dataImportAgeForArchive', 'dataImportNextDueLabel', 'dataImportBuildStatusDateLabel', 'dataImportBuildHealthModel']) {
    const match = source.match(new RegExp('^function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'));
    assert(match, name);
    vm.runInContext(match[0], c);
  }
  Object.assign(c, {
    dataImport2State: {exceptions: [], batches: []}, DATA_IMPORT_REPORT_ORDER: ['box_score'],
    dataImportGetHealthCommunityNames: () => ['Example'], dataImportGetMatrixCommunityNames: () => ['Example'],
    dataImportIsActiveReportingCommunity: () => true, dataImportGetReportDef: () => ({label: 'Box Score'}),
    dataImportEffectiveFreshness: () => ({days: 7, businessDays}), dataImportCommunitySupportsReport: () => true,
    dataImportGetRequirementOverride: () => null, dataImportLatestArchiveFor: () => archive,
    dataImportHasSavedFallbackData: () => true, dataImportNormalizeText: value => value,
    dataImportFormatDate: value => new Date(value).toISOString().slice(0, 10)
  });
  return c;
}

test('receipt-only, missing and invalid source dates never claim current data or a due date', () => {
  const cases = [
    {},
    {uploadedAt: new Date(now).toISOString()},
    {metadata: {dataAsOf: 'not-a-date'}, uploadedAt: new Date(now).toISOString()},
    {metadata: {dataAsOf: '2026-02-30', generatedAt: new Date(now).toISOString()}},
    ...['2026-02-30 00:00:00', '02/30/2026', '02-30-2026', ' 2026-02-30 '].map(dataAsOf => ({metadata: {dataAsOf}})),
    {metadata: {dataAsOf: ' ', generatedAt: new Date(now).toISOString()}},
    {dataDateIso: 'invalid', metadata: {generatedAt: new Date(now).toISOString()}}
  ];
  for (const businessDays of [false, true]) for (const data of cases) {
    const archive = {reportType: 'box_score', batchId: 'retained', ...data};
    const before = JSON.stringify(archive), c = fixture(archive, businessDays);
    assert.equal(c.dataImportArchiveFreshnessDate(archive), '');
    assert.equal(c.dataImportAgeForArchive(archive, {freshness: {businessDays}}), null);
    assert.equal(c.dataImportNextDueLabel(archive, 'box_score'), 'Not calculable');
    const health = c.dataImportBuildHealthModel(), cell = health.cells[0];
    assert.equal(cell.status, 'Saved');
    assert.equal(cell.statusDateLabel, 'Date unavailable');
    assert.equal(cell.ageLabel, 'Source date unverified');
    assert.equal(health.healthScore, 0);
    assert.equal(health.fullyCurrentCommunities, 0);
    assert.match(cell.recommendedAction, /Verify the source's effective date/);
    assert.equal(JSON.stringify(archive), before, 'Receipt and source metadata must remain unchanged');
  }
});

test('verified effective dates retain current/stale classification and outrank a recent receipt', () => {
  for (const businessDays of [false, true]) for (const [date, expected] of [['2026-10-13', 'Fresh'], ['2026-09-01', 'Stale']]) {
    const archive = {reportType: 'box_score', metadata: {dataAsOf: date}, uploadedAt: new Date(now).toISOString()};
    const c = fixture(archive, businessDays), health = c.dataImportBuildHealthModel();
    assert.equal(health.cells[0].status, expected);
    assert.equal(health.cells[0].statusDateLabel, 'Data ' + date);
    assert.equal(health.fullyCurrentCommunities, expected === 'Fresh' ? 1 : 0);
    assert.notEqual(c.dataImportNextDueLabel(archive, 'box_score'), 'Not calculable');
  }
  const c = fixture(null);
  assert.equal(c.dataImportArchiveFreshnessDate({dataDateIso: '2026-10-12'}), '2026-10-12');
  assert.equal(c.dataImportArchiveFreshnessDate({metadata: {generatedAt: '2026-10-12T10:00:00Z'}}), '2026-10-12T10:00:00Z');
  assert.equal(c.dataImportArchiveFreshnessDate({metadata: {dataAsOf: '2024-02-29'}}), '2024-02-29');
  assert.equal(c.dataImportArchiveFreshnessDate({metadata: {dataAsOf: '02/29/2024'}}), '02/29/2024');
  assert.equal(c.dataImportArchiveFreshnessDate({metadata: {dataAsOf: '2026-10-12 10:00:00'}}), '2026-10-12 10:00:00');
  assert.equal(c.dataImportArchiveFreshnessDate({reportType: 'renewal_tracker', periodSelection: {mode: 'multiple_months'}, dataDateIso: '2026-10-12', uploadedAt: '2026-10-13'}), '');
});
