/* Budget Builder v2 — governed publication hand-off.
 *
 * ATLAS publishes budgets only through the governed lifecycle (immutable workbook
 * evidence → reviewed GL mapping → working scenario → submit → VP approval and
 * publication → consumer delivery receipts). The builder therefore never writes
 * financial values directly: on VP approval it renders its GL × month result as a
 * standard workbook and runs that exact lifecycle, so every existing consumer
 * (Financial Position, Bonus, Community Command, exports) reads the same
 * fingerprinted publication it reads today.
 *
 * All I/O is injected (`api`) so the identical sequence runs in the browser and in
 * the PGlite database test. */
import {publicationRows, INCOME_SECTIONS, BELOW_NOI_SECTIONS} from './engine.mjs?v=4b36c2fcc5efc21f';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const periodLabel = p => `${MON[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;

export function natureOf(section, gl) {
  if (BELOW_NOI_SECTIONS.includes(section)) return {nature: 'capital', placement: 'below_noi'};
  if (section === 'Cost Of Leasing' || String(gl) === '5125') return {nature: 'contra_income', placement: 'above_noi'};
  if (INCOME_SECTIONS.includes(section)) return {nature: 'income', placement: 'above_noi'};
  return {nature: 'expense', placement: 'above_noi'};
}

/* Array-of-arrays for the "Plan" sheet the governed intake reads. */
export function workbookMatrix(result, periods) {
  const rows = publicationRows(result).sort((a, b) => a.gl.localeCompare(b.gl));
  return [['Scenario', 'Plan', 'Currency', 'Local'], ['GL', 'Account', ...periods.map(periodLabel)], ...rows.map(r => [r.gl, r.name, ...r.monthly])];
}

export function workbookBytes(XLSX, result, periods) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(workbookMatrix(result, periods)), 'Plan');
  return new Uint8Array(XLSX.write(wb, {type: 'array', bookType: 'xlsx'}));
}

/* Registry accounts for every GL the builder will publish, merged into the current registry. */
export function mergeRegistry(current, result, effectiveFrom) {
  const accounts = [...(current?.accounts || [])];
  const have = new Set(accounts.filter(a => !a.retiredAfter).map(a => String(a.accountCode)));
  let added = 0;
  for (const r of Object.values(result.rows)) {
    const gl = String(r.line.gl);
    if (have.has(gl)) continue;
    accounts.push({accountCode: gl, category: r.line.section, ...natureOf(r.line.section, gl), effectiveFrom});
    have.add(gl); added++;
  }
  return {payload: {...(current || {}), accounts, driverMappings: current?.driverMappings || {}, reason: added ? `Budget Builder added ${added} GL account(s)` : current?.reason || 'Budget Builder accounts', effectiveDate: `${effectiveFrom}-01`}, added};
}

export function importMapping({evidence, registryVersionId, registryAccounts, communityId, actorId, periods, calendar, reviewedAt, dispositions, originalGls = null}) {
  const selected = evidence.lines.filter(l => l.amount !== null && periods.includes(l.period));
  const codes = new Set(selected.map(l => String(l.accountCode)));
  const mapping = {confirmed: true, version: registryVersionId, propertyAssignment: {communityId, confirmed: true, sourceEntities: [], actorId, reason: 'Budget Builder community'},
    sourceScenario: evidence.lines[0]?.scenario || 'Plan', currency: 'USD', periods, selectedLineIds: selected.map(l => l.id),
    accountMappings: registryAccounts.filter(a => codes.has(String(a.accountCode)) && !a.retiredAfter).map(a => ({...a, sourceAccountCode: a.accountCode, sheet: 'Plan', department: null, signMultiplier: 1, allowReversal: false})),
    reason: 'Budget Builder approved values', reviewedBy: actorId, reviewedAt,
    calendar: {...calendar, confirmed: true, periods, scenario: evidence.lines[0]?.scenario || 'Plan', reviewedBy: actorId, reviewedAt},
    inputReviews: selected.map(l => ({cellId: l.id, confirmed: true, ownerId: actorId, effectivePeriod: l.period, before: l.amount, after: l.amount, reason: 'Budget Builder approved value', reviewedAt, integrityFingerprint: evidence.integrity?.fingerprint})),
    integrityReviews: []};
  if (dispositions) Object.assign(mapping, dispositions(evidence, mapping));
  // A revision may carry GLs the approved original never had (an added GL or an STR
  // programme). Those are reviewed as prospective: no original-budget row.
  if (originalGls) mapping.accountMappings = mapping.accountMappings.map(a => (originalGls.has(String(a.accountCode)) ? a
    : {...a, baselineDisposition: {kind: 'no_original_budget_row', confirmed: true, reviewedBy: actorId, reviewedAt, reason: 'Added in Budget Builder after the original budget was approved'}}));
  mapping.currencyMapping = {sourceCurrency: 'Local', reportingCurrency: 'USD', method: 'identity', confirmed: true, reviewedBy: actorId, reviewedAt, reason: 'Budget Builder values are USD'};
  return mapping;
}

export function scenarioPayload({name, model, recordType, periods, calendar, registryVersionId, baselineVersionIds = [], actorId, reviewerId, draftId}) {
  const initial = recordType === 'initial_budget';
  return {name, model, scenarioPurpose: 'conventional', governanceSchemaVersion: 2, recordType, calendar: {...calendar, scenario: name}, periods,
    baselineType: initial ? 'initial_workbook' : 'original_budget', baselineVersionIds: initial ? [] : baselineVersionIds, baselinePublicationIds: [],
    registryVersionId, ownerId: actorId, reviewerId: reviewerId || actorId, drivers: [], overrides: [], reason: 'Budget Builder v2 approved budget', budgetBuilderDraftId: draftId};
}

/* Every request identity and the locked summary belong to a durable saved-draft
 * attempt. Reloads resume its immutable receipts; publication also locks the draft
 * in the same database transaction. */
export async function governedPublish({api, XLSX, parseWorkbook, dispositions, result, communityId, draftId, expectedRevision, summary, actorId, periods, calendar, name, model, baselineVersionIds = [], originalGls = null, onStep = () => {}}) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || !summary) throw Error('Save the budget and its investor summary before publishing.');
  const prepare = () => api.preparePublication({draftId, expectedRevision, summary});
  let progress = await prepare();
  const attempt = progress.attempt, scenarioId = attempt.scenario_id;
  if (attempt.draft_id !== draftId || attempt.community_id !== communityId || attempt.draft_revision !== expectedRevision) throw Error('The publication attempt does not match this saved budget.');
  const finish = state => {
    if (!state.publication?.publication_id || state.draft?.publication_id !== state.publication.publication_id || state.attempt.publication_id !== state.publication.publication_id) throw Error('The canonical publication and budget lock could not be verified. Reload this budget before continuing.');
    return {scenarioId, publication: state.publication, draft: state.draft, recordType: state.publication.snapshot?.identity?.recordType || (baselineVersionIds.length ? 'revised_budget' : 'initial_budget')};
  };
  if (progress.publication) return finish(progress);
  const reviewedAt = attempt.created_at;
  let rec = progress.submitted || progress.import;
  if (!rec) {
    let upload = progress.upload, evidence;
    if (upload) evidence = upload.payload;
    else {
      onStep('Rendering the approved GL × month workbook');
      const bytes = workbookBytes(XLSX, result, periods);
      const fileName = `Budget Builder ${name}.xlsx`.replace(/[^\w .-]/g, '');
      evidence = await parseWorkbook(bytes, {xlsx: XLSX, fileName});
      onStep('Retaining workbook evidence');
      const audit = await api.saveAudit({communityId, sourceHash: evidence.source.sha256, integrity: evidence.integrity, bytes, requestId: attempt.audit_request_id});
      const assignment = {communityId, confirmed: true, sourceEntities: [], actorId, reason: 'Budget Builder community', assignedAt: reviewedAt};
      upload = await api.saveUpload({communityId, requestId: attempt.upload_request_id, payload: api.uploadPayload({evidence, audit, bytes, assignment, actorId, at: reviewedAt})});
    }
    onStep('Confirming GL mapping');
    let registry = progress.registry;
    if (!registry) {
      const head = await api.readRegistry({communityId});
      const merged = mergeRegistry(head?.payload, result, periods[0]);
      registry = merged.added || !head ? await api.saveRegistry({communityId, expectedVersionId: head?.version_id || null, requestId: attempt.registry_request_id, payload: merged.payload}) : head;
    }
    const mapping = importMapping({evidence, registryVersionId: registry.version_id, registryAccounts: registry.payload.accounts, communityId, actorId, periods, calendar, reviewedAt, dispositions, originalGls: baselineVersionIds.length && originalGls ? new Set([...originalGls].map(String)) : null});
    const recordType = baselineVersionIds.length ? 'revised_budget' : 'initial_budget';
    const payload = {...scenarioPayload({name, model, recordType, periods, calendar: mapping.calendar, registryVersionId: registry.version_id, baselineVersionIds, actorId, draftId}), budgetBuilderAttemptId: attempt.attempt_id, budgetBuilderRevision: expectedRevision};
    const expectedLines = evidence.lines.filter(l => mapping.selectedLineIds.includes(l.id)).map(l => ({period: l.period, accountCode: String(l.accountCode), amount: l.amount, sourceLineId: l.id, sourceCoordinates: {sheet: l.sheet, address: l.address, row: l.row, column: l.column}}));
    onStep('Creating the governed budget scenario');
    rec = await api.createFromImport({communityId, scenarioId, expectedRevision: 0, requestId: attempt.import_request_id, uploadId: upload.upload_id, mapping, payload, expectedLines});
  }
  if (rec.snapshot?.completeness?.blockerCount) throw Object.assign(new Error('The governed scenario has unresolved blockers: ' + (rec.snapshot.diagnostics || []).filter(d => d.severity === 'error').map(d => d.message).join('; ')), {diagnostics: rec.snapshot.diagnostics});
  if (!progress.submitted) {
    onStep('Submitting for VP publication');
    rec = await api.saveScenario({communityId, scenarioId, expectedRevision: rec.head.revision, requestId: attempt.submit_request_id, action: 'submit', payload: rec.revision.payload});
  }
  onStep('VP approval, publication and budget lock');
  try {
    await api.saveScenario({communityId, scenarioId, expectedRevision: rec.head.revision, requestId: attempt.publish_request_id, action: 'vp_approve', payload: rec.revision.payload});
  } catch (error) {
    // A timeout is not evidence of rollback. Read the persisted association before
    // presenting a failure; never start another canonical publication to recover.
    progress = await prepare();
    if (progress.publication) return finish(progress);
    throw error;
  }
  return finish(await prepare());
}
