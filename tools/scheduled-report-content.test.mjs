import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduledReport } from '../src/scheduled-report-content.mjs';

const digest = 'a'.repeat(64);
const receipt = { documentKey: 'atlas_dashboard_state_v1', version: 7, archiveHash: digest, effectiveAt: '2026-10-19T10:00:00Z' };
function fixture(overrides = {}) {
  const communityName = 'RISE Example';
  const fields = { total_units: 100, rentable_units: 100, occupied_units: 85, guest_cards: 0, applications: 0, leases_completed: 0 };
  return { type: 'rise_weekly_leasing', communityName, period: 'current_month', localDate: '2026-10-19', source: receipt,
    record: { monthlyHistoryByPeriod: { '2026-10': { totalUnits: 100, occupiedSnapshot: 85, guestCards: 99, applications: 99, leasesSignedActual: 99 } } },
    imports: { canonicalRecords: [{communityName,periodKey:'2026-10',fileHash:digest,dataAsOf:'2026-10-18',values:{measurement_basis:'units'}}], lineage: Object.entries(fields).map(([atlasField, importedValue]) => ({ currentState: true, communityName, periodKey: '2026-10', atlasField, importedValue, fileHash: digest, sourceFile: 'Box Score.xlsx', dataAsOf: '2026-10-18', reportType: 'box_score' })) },
    ...overrides };
}
const build = overrides => buildScheduledReport(fixture(overrides));

test('fresh exact-community lineage preserves observed zeros and clearly labels weekly delivery of MTD activity', () => {
  const result = build();
  assert.equal(result.readiness.ready, true, result.readiness.issues.join('; '));
  assert.match(result.text, /Leads: 0/);
  assert.match(result.text, /Applications completed: 0/);
  assert.match(result.text, /not a seven-day total/);
  assert.match(result.text, /Physical occupancy: 85%/);
  assert.equal(result.metadata.reviewed, false);
  assert.equal(result.metadata.period, '2026-10');
});

test('monthly placeholders and derived browser cache cannot supply required operating evidence', () => {
  const input = fixture();
  input.imports.lineage = input.imports.lineage.filter(row => row.atlasField !== 'applications');
  input.record.investorAutoByPeriod = { '2026-10': { applications: { actual: { value: 12, source: 'old cache' } } } };
  const result = buildScheduledReport(input);
  assert.equal(result.readiness.ready, false);
  assert.match(result.readiness.issues.join(' '), /Applications completed.*missing fresh/);
  assert.match(result.text, /Applications completed: —/);
});

test('fresh projection publication never makes stale or undated evidence fresh', () => {
  for (const badDate of ['2026-10-01', '', '2026-10-20', '2026-09-30']) {
    const input = fixture();
    input.imports.lineage.forEach(row => row.dataAsOf = badDate);
    const result = buildScheduledReport(input);
    assert.equal(result.readiness.ready, false);
    assert.match(result.readiness.issues.join(' '), /fresh/);
  }
});

test('cross-community, noncurrent, unhashable and conflicting lineage are held', () => {
  for (const change of [{ communityName: 'Other' }, { currentState: false }, { fileHash: '' }]) {
    const input = fixture(); Object.assign(input.imports.lineage[0], change);
    assert.equal(buildScheduledReport(input).readiness.ready, false);
  }
  const input = fixture();
  input.imports.lineage.push({ ...input.imports.lineage[0], importedValue: 101 });
  assert.match(buildScheduledReport(input).readiness.issues.join(' '), /conflicting/);
});

test('invalid denominator, impossible occupancy and negative count prevent delivery', () => {
  for (const [field, value] of [['total_units', 0], ['occupied_units', 101], ['applications', -1]]) {
    const input = fixture(); input.imports.lineage.find(row => row.atlasField === field).importedValue = value;
    assert.equal(buildScheduledReport(input).readiness.ready, false);
  }
});

test('receipt, scope, unsupported type, malformed date and future periods fail closed', () => {
  for (const overrides of [{ source: { ...receipt, archiveHash: '' } }, { source: { ...receipt, version: 0 } }, { record: { propertyName: 'Other' } }, { type: 'monthly_investor_deck' }, { type: 'investor_marketing_report' }, { localDate: '2026-99-99' }, { period: '2026-11' }, { maxSourceAgeDays: 32 }]) {
    const result = build(overrides);
    assert.equal(result.readiness.ready, false);
    assert.equal(result.html, '');
  }
});

function investorFixture() {
  const input = fixture({ type: 'investor_community_packet', period: 'previous_month' });
  input.imports.lineage.forEach(row => { row.periodKey = '2026-09'; row.dataAsOf = '2026-09-30'; });
  input.imports.canonicalRecords.forEach(row => { row.periodKey = '2026-09'; row.dataAsOf = '2026-09-30'; });
  input.accountingEvidence = { reportType: 'approved_accounting', importStatus: 'Approved', evidenceOrigin: 'central_close', closeVersionId: 'approved-close-id', communityName: input.communityName, fileHash: digest, fileName: 'September financials.xlsx', dataDateIso: '2026-09-30', accountingReopened: false, monthlyLedger: [{ glCode: '4000', description: 'Rent', section: 'Operating Income', monthlyActual: 10000 }, { glCode: '6000', description: 'Payroll', section: 'Operating Expenses', monthlyActual: 4000 }] };
  input.packetSettings = { config: { mappings: { revenue: { actual: { path: 'monthlyHistoryByPeriod.{period}.unapproved' }, budget: { path: 'monthlyHistoryByPeriod.{period}.unapproved' } } } }, drafts: { '2026-08': { performance: 'OLD PRIOR NARRATIVE' }, '2026-09': { performance: 'CURRENT MONTH NARRATIVE', performanceSource: 'September management note' } }, reviews: { '2026-09': { reviewedAt: '2026-10-01', draft: { performance: 'SAVED PACKET NARRATIVE' } } } };
  input.record.monthlyHistoryByPeriod['2026-09'] = { unapproved: 999999, revenue: 888888 };
  input.record.investorFinancialByPeriod = { '2026-09': { source: 'OLD CACHE', revenue: { actual: 999999 } } };
  return input;
}

test('previous-month investor packet uses exact approved close and period draft, never prior review or cached totals', () => {
  const input = investorFixture(), before = JSON.stringify(input);
  const result = buildScheduledReport(input);
  assert.equal(result.readiness.ready, true, result.readiness.issues.join('; '));
  assert.equal(result.metadata.period, '2026-09');
  assert.equal(result.metadata.evidenceCutoff, '2026-09-30');
  assert.match(result.text, /Operating revenue: \$10,000/);
  assert.match(result.text, /NOI: \$6,000/);
  assert.match(result.html, /CURRENT MONTH NARRATIVE/);
  assert.doesNotMatch(result.html, /OLD PRIOR NARRATIVE|SAVED PACKET NARRATIVE|999,999|888,888|OLD CACHE/);
  assert.equal(JSON.stringify(input), before, 'builder is read-only');
});

test('investor accounting must be approved, exact period and community, complete, and currently locked', () => {
  for (const change of [{ accountingReopened: true }, { importStatus: 'Needs Review' }, { dataDateIso: '2026-08-31' }, { communityName: 'Other' }, { monthlyLedger: [] }, { fileHash: '' }, { evidenceOrigin: 'browser' }]) {
    const input = investorFixture(); Object.assign(input.accountingEvidence, change);
    const result = buildScheduledReport(input);
    assert.equal(result.readiness.ready, false);
    assert.match(result.readiness.issues.join(' '), /Approved accounting detail/);
  }
});

test('approved zero income is preserved and an incomplete GL denominator is not silently filled', () => {
  const input = investorFixture();
  input.accountingEvidence.monthlyLedger[0].monthlyActual = 0;
  const result = buildScheduledReport(input);
  assert.equal(result.readiness.ready, true);
  assert.match(result.text, /Operating revenue: \$0/);
  assert.match(result.text, /NOI margin: —/);
  input.accountingEvidence.monthlyLedger.push({ ...input.accountingEvidence.monthlyLedger[0] });
  assert.equal(buildScheduledReport(input).readiness.ready, false);
});

test('fresh approved box inventory can support zero occupancy but unrelated source receipts cannot', () => {
  const input = fixture();
  input.imports.lineage = input.imports.lineage.filter(row => !['total_units', 'rentable_units', 'occupied_units'].includes(row.atlasField));
  input.record.latestDlrSummary = { dailyBoxScore: { totalUnits: 100, rentableUnits: 100, occupiedUnits: 0, reportDateIso: '2026-10-18', sourceFileName: 'Box Score.xlsx' } };
  input.imports.sourceArchive = [{ reportType: 'box_score', importStatus: 'Approved', communities: [input.communityName], fileHash: digest, fileName: 'Box Score.xlsx', dataDateIso: '2026-10-18' }];
  const result = buildScheduledReport(input);
  assert.equal(result.readiness.ready, true);
  assert.match(result.text, /Physical occupancy: 0%/);
  input.imports.sourceArchive[0].communities = ['Other'];
  assert.equal(buildScheduledReport(input).readiness.ready, false);
});


test('rentable denominator excludes corporate inventory and completed leases are not confused with signed aliases', () => {
  const input = fixture();
  input.imports.lineage.find(row => row.atlasField === 'rentable_units').importedValue = 90;
  input.imports.lineage.find(row => row.atlasField === 'occupied_units').importedValue = 45;
  const template = input.imports.lineage[0];
  input.imports.lineage.push({...template, atlasField:'physical_occupancy', importedValue:50}, {...template,atlasField:'source_leased_units',importedValue:54}, {...template,atlasField:'leased_units',importedValue:80});
  const result = buildScheduledReport(input);
  assert.equal(result.readiness.ready,true,result.readiness.issues.join('; '));
  assert.match(result.text,/Physical occupancy: 50%/);
  assert.match(result.text,/Total units or beds: 100/);
  assert.match(result.text,/Rentable units or beds: 90/);
  assert.equal(result.metadata.operatingEvidence.leasedSnapshot.source.includes('source_leased_units'),true);
  assert.equal(result.metadata.optionalDataIssues.some(row=>row.metric==='physicalOccupancy'&&row.issue.startsWith('Reported metric')),false);
  input.imports.lineage.find(row=>row.atlasField==='physical_occupancy').importedValue=45;
  assert.equal(buildScheduledReport(input).readiness.ready,false);
});

test('missing rentable denominator or mixed unit and bed basis holds rather than falling back to total stock', () => {
  const input = fixture();
  input.imports.lineage=input.imports.lineage.filter(row=>row.atlasField!=='rentable_units');
  let result=buildScheduledReport(input);
  assert.equal(result.readiness.ready,false);
  assert.match(result.text,/Physical occupancy: —/);
  const mixed=fixture();
  mixed.imports.canonicalRecords.push({...mixed.imports.canonicalRecords[0],values:{measurement_basis:'beds'}});
  assert.equal(buildScheduledReport(mixed).readiness.ready,false);
  mixed.imports.canonicalRecords.shift();
  result=buildScheduledReport(mixed);
  assert.equal(result.readiness.ready,true);
  assert.match(result.text,/Occupied beds: 85/);
});


test('renewal cohorts retain their expiration basis rather than claiming signing-date activity', () => {
  const input=fixture();
  input.imports.lineage.push({...input.imports.lineage[0],atlasField:'renewals_signed',importedValue:7,reportType:'renewal_tracker'});
  const result=buildScheduledReport(input);
  assert.equal(result.readiness.ready,true);
  assert.match(result.text,/Signed renewals in expiration cohort: 7/);
});
