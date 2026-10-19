import '../docs/portfolio-operations-dashboard/investor-packet-core.js';

const Packet = globalThis.AtlasInvestorPacket;
const TYPES = new Set(['rise_weekly_leasing', 'investor_community_packet']);
const DAY = 86400000;
const hash = value => /^[a-f0-9]{64}$/i.test(String(value || ''));
const number = Packet.number;
const date = value => {
  const text = String(value || '').slice(0, 10);
  const stamp = Date.parse(text + 'T12:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === text ? text : '';
};
const clone = value => JSON.parse(JSON.stringify(value || {}));
const lineageIds = {
  total_units: 'totalUnits', rentable_units: 'rentableUnits', occupied_units: 'occupiedSnapshot', source_leased_units: 'leasedSnapshot',
  physical_occupancy: 'physicalOccupancy', leased_occupancy: 'leasedOccupancy',
  new_leads: 'guestCards', guest_cards: 'guestCards', tours: 'tours', applications: 'applications',
  approvals: 'applicationsApproved', denied_applications: 'denied', cancelled_applications: 'cancelled',
  leases_completed: 'leasesSignedActual', leases_signed: 'leasesSignedActual', move_ins: 'moveIns', move_outs: 'moveOuts',
  renewals_signed: 'renewalSigned', renewal_expirations: 'renewalExpirations'
};
const weeklyIds = ['totalUnits', 'rentableUnits', 'occupiedSnapshot', 'physicalOccupancy', 'guestCards', 'tours', 'applications', 'leasesSignedActual', 'moveIns', 'moveOuts', 'renewalSigned'];
const requiredOperations = ['totalUnits', 'rentableUnits', 'occupiedSnapshot', 'guestCards', 'applications', 'leasesSignedActual'];
const metricLabel = id => id === 'rentableUnits' ? 'Rentable units or beds' : Packet.metrics.find(row => row.id === id)?.label || id;
const communityMatches = (row, name) => row?.communityName === name || row?.communities?.includes(name);

// This function has no IO. The caller must authorize the community and recheck
// the exact canonical parent receipt before delivery. Dates below are evidence
// cutoffs; a newly modified projection cannot make an old source current.
export function buildScheduledReport({ type, communityName, record = {}, period, localDate, source, maxSourceAgeDays = 7, packetSettings = {}, imports = {}, accountingEvidence = null } = {}) {
  const issues = [];
  const issue = message => { if (!issues.includes(message)) issues.push(message); };
  const today = date(localDate);
  if (!today) issue('A valid local delivery date is required.');
  const currentMonth = today.slice(0, 7);
  const selectedPeriod = period === 'current_month' ? currentMonth : period === 'previous_month' && today ? Packet.shift(currentMonth, -1) : period;
  if (!TYPES.has(type)) issue('This report type is available for manual preparation only.');
  if (!communityName || typeof communityName !== 'string') issue('One authorized community is required.');
  if (!Packet.periodValid(selectedPeriod) || (today && selectedPeriod > currentMonth)) issue('Select a current or completed reporting month.');
  if (['communityName', 'propertyName'].some(key => record[key] && record[key] !== communityName)) issue('The current record belongs to another community.');
  if (!source || source.documentKey !== 'atlas_dashboard_state_v1' || !Number.isSafeInteger(source.version) || source.version < 1 || !hash(source.archiveHash) || !Number.isFinite(Date.parse(source.effectiveAt))) issue('The current canonical workspace receipt is incomplete.');
  const ageLimit = Number(maxSourceAgeDays);
  if (!Number.isInteger(ageLimit) || ageLimit < 1 || ageLimit > 31) issue('Source age must be between 1 and 31 days.');
  const metadata = { type, communityName, period: selectedPeriod, localDate: today, source: source ? { documentKey: source.documentKey, version: source.version, archiveHash: source.archiveHash, effectiveAt: source.effectiveAt } : null, generatedFrom: 'current_canonical_projection', reviewed: false, maxSourceAgeDays: ageLimit };
  const title = type === 'rise_weekly_leasing' ? 'Weekly leasing report' : 'Investor community packet';
  const subject = `${communityName || 'Community'} · ${title} · ${selectedPeriod || 'Period unavailable'}`;
  if (issues.length) return { subject, html: '', text: '', readiness: { ready: false, issues }, metadata };

  const [year, month] = selectedPeriod.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10);
  const cutoff = today < monthEnd ? today : monthEnd;
  const freshDate = value => {
    const stamped = date(value);
    return stamped && stamped.slice(0, 7) === selectedPeriod && stamped <= cutoff && (Date.parse(cutoff) - Date.parse(stamped)) / DAY <= ageLimit ? stamped : '';
  };
  metadata.evidenceCutoff = cutoff;
  const evidence = new Map();
  const clean = clone(record);
  // These caches are browser adapters, not fresh source receipts.
  delete clean.investorFinancialByPeriod;
  delete clean.investorAutoByPeriod;
  delete clean.investorSegments;
  delete clean.investorConnections;
  clean.investorAutoByPeriod = {};
  const config = clone(packetSettings.config);
  const mappedIds = new Set([...Object.values(lineageIds), 'physicalOccupancy', 'leasedOccupancy', 'revenue', 'expenses', 'noi']);
  // Source-backed current values take priority over saved display mappings.
  for (const id of mappedIds) if (config.mappings?.[id]) delete config.mappings[id].actual;
  // Unapproved browser financial comparisons remain unavailable. Only the
  // explicit approved close below may supply current financial actuals.
  const financialGroups = new Set(['revenue', 'expenses', 'collections', 'capital', 'debt', 'returns']);
  for (const metric of Packet.metrics.filter(row => financialGroups.has(row.group))) {
    if (config.mappings) delete config.mappings[metric.id];
    for (const values of Object.values(clean.monthlyHistoryByPeriod || {})) delete values[metric.id];
  }
  const inventoryIds = ['totalUnits', 'occupiedSnapshot', 'leasedSnapshot', 'physicalOccupancy', 'leasedOccupancy'];
  for (const id of inventoryIds) for (const values of Object.values(clean.monthlyHistoryByPeriod || {})) delete values[id];
  const monthValues = clean.monthlyHistoryByPeriod?.[selectedPeriod];
  if (monthValues) for (const id of mappedIds) delete monthValues[id];
  delete clean.financialLedger;
  delete clean.financialBudgetLedger;
  const setValue = (id, value, citation, stamped, fileHash, definition = '') => {
    if (number(value) === null) return;
    clean.investorAutoByPeriod[selectedPeriod] ||= {};
    clean.investorAutoByPeriod[selectedPeriod][id] = { actual: { value: number(value), source: citation, status: 'available', definition, version: 'scheduled-current-evidence-v1' } };
    evidence.set(id, { dataAsOf: stamped, fileHash, source: citation });
  };
  const approvedSources = (imports.sourceArchive || []).filter(row => row.importStatus === 'Approved' && communityMatches(row, communityName) && hash(row.fileHash));
  const box = record.latestDlrSummary?.dailyBoxScore;
  const boxDate = freshDate(box?.reportDateIso);
  const boxReceipt = boxDate && approvedSources.find(row => row.reportType === 'box_score' && row.fileName === box?.sourceFileName && date(row.metadata?.dataAsOf || row.dataDateIso) === boxDate);
  // Current lineage is scoped and dated; a source receipt or current lineage
  // hash provides provenance even when the compact archive omits older files.
  const lines = (imports.lineage || []).filter(row => row.currentState === true && row.communityName === communityName && row.periodKey === selectedPeriod && lineageIds[row.atlasField] && hash(row.fileHash) && row.sourceFile && freshDate(row.dataAsOf));
  for (const id of new Set(lines.map(row => lineageIds[row.atlasField]))) {
    const matches = lines.filter(row => lineageIds[row.atlasField] === id);
    const signatures = new Set(matches.map(row => JSON.stringify([number(row.importedValue), row.fileHash, date(row.dataAsOf)])));
    if (signatures.size !== 1) { issue(`${metricLabel(id)} has conflicting current source evidence.`); continue; }
    const row = matches[0];
    setValue(id, row.importedValue, `${row.sourceFile} / ${row.originalField || row.atlasField} / as of ${date(row.dataAsOf)}`, date(row.dataAsOf), row.fileHash, row.reportType === 'renewal_tracker' && ['renewalSigned', 'renewalExpirations'].includes(id) ? 'Renewal expiration cohort for this reporting month; not signing-date activity.' : '');
  }
  if (boxReceipt) {
    for (const [id, key] of Object.entries({ totalUnits: 'totalUnits', rentableUnits: 'rentableUnits', occupiedSnapshot: 'occupiedUnits', availableUnits: 'availableUnits' })) {
      // When both authorities are present they must reconcile.
      const current = clean.investorAutoByPeriod[selectedPeriod]?.[id]?.actual?.value;
      if (current !== undefined && number(box[key]) !== null && current !== number(box[key])) issue(`${metricLabel(id)} does not reconcile to the current Box Score.`);
      else setValue(id, box[key], `${box.sourceFileName} / ${key} / as of ${boxDate}`, boxDate, boxReceipt.fileHash);
    }
  }
  // Remove the unverified fallback regardless of whether a valid receipt exists.
  if (clean.latestDlrSummary) delete clean.latestDlrSummary.dailyBoxScore;
  const freshBoxLineage = lines.some(row => row.reportType === 'box_score');
  if (!boxReceipt && !freshBoxLineage) issue('A fresh, approved Box Score is required for this reporting period.');
  const required = type === 'rise_weekly_leasing' ? requiredOperations : ['totalUnits', 'rentableUnits', 'occupiedSnapshot'];
  for (const id of required) if (!evidence.has(id)) issue(`${metricLabel(id)} is missing fresh source evidence.`);

  const value = id => clean.investorAutoByPeriod[selectedPeriod]?.[id]?.actual?.value ?? null;
  const denominator = value('rentableUnits');
  const occupancyEvidence = evidence.get('occupiedSnapshot'), denominatorEvidence = evidence.get('rentableUnits');
  const sameInventory = occupancyEvidence && denominatorEvidence && occupancyEvidence.fileHash === denominatorEvidence.fileHash && occupancyEvidence.dataAsOf === denominatorEvidence.dataAsOf;
  if (!sameInventory) issue('Occupied and rentable counts require one comparable source and cutoff.');
  const basisRows = [...(imports.lineage || []).filter(row => row.currentState === true && row.communityName === communityName && row.periodKey === selectedPeriod && row.atlasField === 'measurement_basis' && row.fileHash === occupancyEvidence?.fileHash && date(row.dataAsOf) === occupancyEvidence?.dataAsOf).map(row => row.importedValue),
    ...(imports.canonicalRecords || []).filter(row => row.communityName === communityName && row.periodKey === selectedPeriod && row.fileHash === occupancyEvidence?.fileHash && date(row.dataAsOf) === occupancyEvidence?.dataAsOf).map(row => row.values?.measurement_basis)];
  const bases = new Set(basisRows.filter(Boolean).map(value => String(value).toLowerCase()));
  if (bases.size !== 1 || !['units', 'beds'].includes([...bases][0])) issue('One verified unit or bed measurement basis is required.');
  metadata.measurementBasis = bases.size === 1 ? [...bases][0] : null;
  for (const [id, numerator] of [['physicalOccupancy', 'occupiedSnapshot'], ['leasedOccupancy', 'leasedSnapshot']]) {
    const n = value(numerator), cited = evidence.get(numerator), explicit = value(id);
    if (n !== null && denominator > 0 && cited?.fileHash === denominatorEvidence?.fileHash && cited?.dataAsOf === denominatorEvidence?.dataAsOf) {
      const computed = n / denominator * 100;
      if (explicit !== null && Math.abs(explicit - computed) > 0.11) issue(`${metricLabel(id)} does not reconcile to the rentable denominator.`);
      setValue(id, computed, `Calculated: ${cited.source}; ${denominatorEvidence.source}`, cited.dataAsOf, cited.fileHash, `${metricLabel(numerator)} divided by rentable units or beds × 100; exclusions applied once.`);
    } else {
      clean.investorAutoByPeriod[selectedPeriod] ||= {};
      // Explicit missing cells prevent the packet model's total-inventory fallback.
      clean.investorAutoByPeriod[selectedPeriod][id] = {actual:{value:null,source:'',status:'missing',reason:'Comparable source counts and rentable denominator are unavailable'}};
    }
  }

  if (type === 'investor_community_packet') {
    const accounting = accountingEvidence;
    const accountingDate = freshDate(accounting?.metadata?.dataAsOf || accounting?.dataDateIso);
    const approved = accounting && accounting.reportType === 'approved_accounting' && accounting.importStatus === 'Approved' && accounting.evidenceOrigin === 'central_close' && accounting.closeVersionId && accounting.accountingReopened !== true && communityMatches(accounting, communityName) && hash(accounting.fileHash) && accountingDate && accounting.fileName;
    if (!approved || !Array.isArray(accounting.monthlyLedger) || !accounting.monthlyLedger.length) issue('Approved accounting detail for the exact reporting month is required.');
    else {
      // The caller reads these detail rows from this approved close version;
      // unrelated browser financial totals and old saved packets are excluded.
      clean.financialLedger = { [selectedPeriod]: clone(accounting.monthlyLedger) };
      config.ledgerBasis = 'monthly';
      metadata.accounting = { closeVersionId: accounting.closeVersionId, sourceHash: accounting.fileHash, dataAsOf: accountingDate, fileName: accounting.fileName };
    }
  }
  const draft = clone(packetSettings.drafts?.[selectedPeriod]);
  const packet = Packet.build({ community: communityName, period: selectedPeriod, record: clean, config, draft, prior: null, now: new Date(today + 'T12:00:00Z') });
  // The shared manual packet model assumes total inventory in its generic
  // occupancy check; these scheduled rates were reconciled to rentable stock.
  packet.issues = packet.issues.filter(row => !(['physicalOccupancy', 'leasedOccupancy'].includes(row.metric) && row.issue.startsWith('Reported metric does not reconcile')));
  for (const row of packet.rows) {
    if (metadata.measurementBasis === 'beds' && row.id === 'occupiedSnapshot') row.label = 'Occupied beds';
    if (row.id === 'renewalSigned' && /expiration cohort/.test(row.cells.current.definition || '')) row.label = 'Signed renewals in expiration cohort';
  }
  const current = id => id === 'rentableUnits' ? denominator : packet.rows.find(row => row.id === id)?.cells.current.value ?? null;
  if (current('totalUnits') === null || current('totalUnits') <= 0) issue('Total units must be a verified positive denominator.');
  if (denominator === null || denominator <= 0 || denominator > current('totalUnits')) issue('Rentable units must be positive and reconcile to total inventory.');
  if (current('occupiedSnapshot') === null || current('occupiedSnapshot') < 0 || current('occupiedSnapshot') > denominator) issue('Occupied units must reconcile to rentable units.');
  if (value('leasedSnapshot') !== null && (value('leasedSnapshot') < current('occupiedSnapshot') || value('leasedSnapshot') > denominator)) issue('Source leased units must reconcile to occupied and rentable inventory.');
  for (const id of required) if (current(id) !== null && (current(id) < 0 || !Number.isInteger(current(id)))) issue(`${metricLabel(id)} must be a nonnegative whole count.`);
  if (type === 'investor_community_packet') for (const id of ['revenue', 'expenses', 'noi']) if (current(id) === null) issue(`${metricLabel(id)} is unavailable from the approved monthly accounting detail.`);
  metadata.operatingEvidence = Object.fromEntries(evidence);
  metadata.reportBasis = selectedPeriod === currentMonth ? 'month_to_date' : 'completed_month';
  metadata.optionalDataIssues = packet.issues;
  const label = selectedPeriod === currentMonth ? 'Month-to-date activity' : 'Completed-month activity';
  const provenance = `Prepared from current saved sources for ${selectedPeriod}; evidence cutoff ${cutoff}. Automatically generated; no saved review or approval is implied. Unavailable figures are shown as —.`;
  let html, text;
  if (type === 'rise_weekly_leasing') {
    const rows = weeklyIds.map(id => id === 'rentableUnits' ? {id, label:metricLabel(id), unit:'number', cells:{current:{value:denominator}}} : packet.rows.find(row => row.id === id)).filter(Boolean);
    if (metadata.measurementBasis === 'beds') for (const row of rows) if (row.id === 'occupiedSnapshot') row.label = 'Occupied beds';
    text = `${subject}\n${label}. Activity is not a seven-day total.\n${provenance}\n\n${rows.map(row => `${row.label}: ${Packet.format(row.cells.current.value, row.unit)}`).join('\n')}\n\nSources:\n${[...new Set([...evidence.values()].map(row => row.source))].join('\n')}`;
    html = `<!doctype html><html><head><meta charset="utf-8"><title>${Packet.esc(subject)}</title></head><body><h1>${Packet.esc(subject)}</h1><p>${label}. Activity is not a seven-day total.</p><p>${Packet.esc(provenance)}</p><table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>${rows.map(row => `<tr><td>${Packet.esc(row.label)}</td><td>${Packet.esc(Packet.format(row.cells.current.value, row.unit))}</td></tr>`).join('')}</tbody></table><h2>Sources</h2><ul>${[...new Set([...evidence.values()].map(row => row.source))].map(value => `<li>${Packet.esc(value)}</li>`).join('')}</ul></body></html>`;
  } else {
    html = Packet.html(packet, { appendix: true, editable: false }).replace('<body>', `<body><section><p>${Packet.esc(provenance)}</p><p>Accounting source: ${Packet.esc(metadata.accounting?.fileName || 'Unavailable')}.</p></section>`);
    text = `${subject}\n${provenance}\n\n${packet.rows.map(row => `${row.label}: ${Packet.format(row.cells.current.value, row.unit)}`).join('\n')}\n\nThe HTML report includes source references and unresolved data questions.`;
  }
  return { subject, html, text, readiness: { ready: issues.length === 0, issues }, metadata };
}
