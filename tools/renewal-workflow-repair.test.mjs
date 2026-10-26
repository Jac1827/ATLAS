import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { reviewRenewalWorkflowRepair, applyReviewedRenewalWorkflowRepair } from '../docs/portfolio-operations-dashboard/features/renewal-workflow-repair.mjs';
const digest = async text => createHash('sha256').update(text).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

test('the external admin script resolves its reviewed repair module from its own feature directory', async () => {
  const admin = new URL('../docs/portfolio-operations-dashboard/features/admin-workspace.js', import.meta.url);
  const text = await readFile(admin, 'utf8');
  const reference = text.match(/import\(["']([^"']*renewal-workflow-repair\.mjs(?:\?[^"']*)?)["']\)/)?.[1];
  assert(reference, 'The review UI must load the governed repair module');
  const api = await import(new URL(reference, admin));
  assert.equal(typeof api.reviewRenewalWorkflowRepair, 'function');
  assert.equal(typeof api.applyReviewedRenewalWorkflowRepair, 'function');
});

function fixture() {
  const priorEvent = { at: '2026-09-19T12:00:00Z', label: 'Imported from Prior.xlsx' };
  const currentEvent = { at: '2026-10-26T16:00:00Z', label: 'Imported from Latest.xlsx' };
  const identity = { id: 'synthetic-agreement', propertyName: 'Example', periodKey: '2026-11', expirationDate: '2026-11-30', residentName: 'Synthetic Person', unit: '101' };
  const prior = { ...identity, status: 'NTV Received', notes: 'Prior source note', nextAction: 'Create move-out workflow', activity: [priorEvent] };
  const current = { ...identity, status: 'Signed - Awaiting Execution', notes: 'Latest source note', nextAction: 'Review renewal decision',
    sourceFileName: 'Latest.xlsx', sourceRenewalStatus: 'Signed', importedAt: '2026-10-26T16:00:00Z', suppressDuplicateAudit: true, activity: [currentEvent] };
  const record = row => ({ renewalDetailRowsByPeriod: { '2026-11': [clone(row)] }, renewalDetailRowsByMonth: Array.from({ length: 12 }, (_, i) => i === 10 ? [clone(row)] : []),
    monthlyHistoryByPeriod: { '2026-11': { renewalSigned: 1, renewalNTV: 0 } }, marketSurveyData: { retained: true }, generalManagerName: 'Retained contact' });
  const snapshot = { app: 'atlas-rise-ops-dashboard', snapshotType: 'atlas_central_migration_read_only_snapshot_v1', readOnly: true,
    generatedAt: '2026-10-26T15:49:55.632Z', indexedDb: { communityData: { Example: record(prior) } } };
  const communityData = { Example: record(current), Other: { unrelated: true } };
  const centralServicesRaw = JSON.stringify({ renewals: [clone(current), { id: 'unrelated', notes: 'Leave this alone' }], tasks: [{ id: 'task', status: 'Open' }], auditTrail: [{ id: 'existing-audit' }] });
  return { snapshot, communityData, centralServicesRaw, priorEvent, currentEvent, options: { communityData, centralServicesRaw, sourceHash: 'a'.repeat(64), digest } };
}

test('review and apply restore exact old import events in both stores and preserve latest source fields', async () => {
  const f = fixture(), before = JSON.stringify(f);
  const review = await reviewRenewalWorkflowRepair(f.snapshot, f.options);
  assert.equal(review.issues.length, 0);
  assert.equal(review.rows.length, 1);
  assert.equal(review.counts.historicalEvents, 1);
  assert.equal(review.scalarComparisons.length, 3);
  const result = applyReviewedRenewalWorkflowRepair(review, f.options);
  const row = result.communityData.Example.renewalDetailRowsByPeriod['2026-11'][0];
  assert.deepEqual(row.activity, [f.priorEvent, f.currentEvent]);
  assert.deepEqual(result.communityData.Example.renewalDetailRowsByMonth[10][0], row);
  const expected = clone(f.communityData);
  expected.Example.renewalDetailRowsByPeriod['2026-11'][0].activity.unshift(f.priorEvent);
  expected.Example.renewalDetailRowsByMonth[10][0].activity.unshift(f.priorEvent);
  assert.deepEqual(result.communityData, expected, 'No other community leaf changes');
  const expectedCentral = JSON.parse(f.centralServicesRaw); expectedCentral.renewals[0].activity.unshift(f.priorEvent);
  assert.deepEqual(JSON.parse(result.centralServicesRaw), expectedCentral, 'No other Central Services leaf changes');
  assert.equal(result.counts.scalarChanges, 0);
  assert.equal(JSON.stringify(f), before, 'Review and staging do not mutate their inputs');
});

test('both exact baselines fence subsequent edits, including unrelated changes', async () => {
  const f = fixture(), review = await reviewRenewalWorkflowRepair(f.snapshot, f.options);
  const newer = clone(f.communityData); newer.Other.unrelated = false;
  assert.throws(() => applyReviewedRenewalWorkflowRepair(review, { ...f.options, communityData: newer }), /Workspace data changed/);
  const cs = JSON.parse(f.centralServicesRaw); cs.tasks[0].status = 'New action';
  assert.throws(() => applyReviewedRenewalWorkflowRepair(review, { ...f.options, centralServicesRaw: JSON.stringify(cs) }), /Workspace data changed/);
  assert.throws(() => applyReviewedRenewalWorkflowRepair(review, { ...f.options, selectedKeys: ['unknown'] }), /Select the reviewed/);
});

test('missing or mismatched Central Services records hold the repair', async () => {
  for (const renewals of [[], [{ id: 'synthetic-agreement', propertyName: 'Other' }]]) {
    const f = fixture(); f.options.centralServicesRaw = JSON.stringify({ renewals });
    const review = await reviewRenewalWorkflowRepair(f.snapshot, f.options);
    assert.equal(review.issues.length, 1);
    assert.throws(() => applyReviewedRenewalWorkflowRepair(review, f.options), /Resolve the listed/);
  }
});

test('manual activity and conflicting event content are not silently treated as generic imports', async () => {
  for (const event of [{ at: '2026-09-20T12:00:00Z', label: 'Changed renewal decision' },
    { at: '2026-10-26T16:00:00Z', label: 'Imported from Latest.xlsx', changed: true }]) {
    const f = fixture(); f.snapshot.indexedDb.communityData.Example.renewalDetailRowsByPeriod['2026-11'][0].activity = [event];
    const review = await reviewRenewalWorkflowRepair(f.snapshot, f.options);
    assert.equal(review.issues.length, 1);
    assert.throws(() => applyReviewedRenewalWorkflowRepair(review, f.options), /Resolve the listed/);
  }
});

test('review plans cannot be changed by mutating displayed rows or the source snapshot afterward', async () => {
  const f = fixture(), review = await reviewRenewalWorkflowRepair(f.snapshot, f.options);
  review.rows[0].missingEvents = 999;
  f.snapshot.indexedDb.communityData.Example.renewalDetailRowsByPeriod['2026-11'][0].id = 'other';
  const result = applyReviewedRenewalWorkflowRepair(review, f.options);
  assert.equal(result.counts.historicalEvents, 1);
  review.source.sha256 = 'b'.repeat(64);
  assert.throws(() => applyReviewedRenewalWorkflowRepair(review, f.options), /Review the retained history again/);
});

test('an event already retained in Central Services is not duplicated', async () => {
  const f = fixture(), cs = JSON.parse(f.centralServicesRaw);
  cs.renewals[0].activity.unshift(f.priorEvent); f.options.centralServicesRaw = JSON.stringify(cs);
  const review = await reviewRenewalWorkflowRepair(f.snapshot, f.options);
  assert.equal(review.counts.centralHistoricalEvents, 0);
  const result = applyReviewedRenewalWorkflowRepair(review, f.options);
  assert.deepEqual(JSON.parse(result.centralServicesRaw), cs);
});
