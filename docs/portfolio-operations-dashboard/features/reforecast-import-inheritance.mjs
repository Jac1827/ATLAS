/* Import review only: missing source values cannot authorize inherited numbers.
 * This does not change baseline values, saved revisions, or server approval. */
const keyOf = (period, accountCode) => JSON.stringify([period, String(accountCode)]);
const groupKey = line => JSON.stringify([line.sheet, line.accountCode, line.department]);
const hasNumber = value => typeof value === 'number' && Number.isFinite(value);

export function reviewReforecastImportInheritance({evidence, source, mapping, lines = [], accountChoices = {}, destination = 'new', purpose}) {
 if (purpose === 'original_budget' || source?.intakePurpose === 'original_budget') return {issues: [], cells: [], totals: {revenue: 0, opex: 0, noi: 0}, nonzeroCount: 0};
 const periods = new Set(mapping?.periods || []), cutoff = source?.actuals?.cutoffPeriod;
 const eligible = period => periods.has(period) && (!cutoff || period > cutoff) && !(source?.lockedPeriods || []).includes(period) && !(source?.actuals?.notApplicablePeriods || []).includes(period);
 const incoming = new Set(lines.filter(line => hasNumber(line.amount)).map(line => keyOf(line.period, line.accountCode)));
 const scoped = (evidence?.lines || []).filter(line => line.scenario === mapping?.sourceScenario && eligible(line.period) && line.sourceKind !== 'workbook_actual_evidence');
 const registry = source?.registry?.accounts || [], mappedSources = new Map();
 for (const line of scoped) {
  const matches = (mapping?.accountMappings || []).filter(account => account.sourceAccountCode === line.accountCode && (!account.sheet || account.sheet === line.sheet) && (!Object.hasOwn(account, 'department') || account.department === line.department));
  // Blank-only groups have no selected numeric cells, but their explicit target
  // choice (or same-code candidate) must still be reconciled, never ignored.
  const chosen = accountChoices[groupKey(line)]?.accountCode;
  const candidate = registry.filter(account => account.accountCode === (chosen || line.accountCode));
  const target = matches.length === 1 ? matches[0] : matches.length === 0 && candidate.length === 1 ? candidate[0] : null;
  if (!target) continue;
  const key = keyOf(line.period, target.accountCode);
  if (!mappedSources.has(key)) mappedSources.set(key, []);
  mappedSources.get(key).push(line);
 }
 const issues = [], cells = [];
 if (!Array.isArray(source?.baseline?.lines)) {
  if (destination === 'new') issues.push({code: 'source_baseline_unavailable', severity: 'error', message: 'Reload the approved baseline before creating a workbook forecast. The complete GL/month scope, including accounts absent from the workbook, cannot be verified without baseline readback.'});
  else if ([...mappedSources.values()].some(rows => rows.some(row => !hasNumber(row.amount)))) issues.push({code: 'source_blank_baseline_unavailable', severity: 'error', message: 'Reload the approved baseline before reviewing missing workbook values. Their inherited GL/month amounts cannot be verified.'});
  return {issues, cells, totals: {revenue: 0, opex: 0, noi: 0}, nonzeroCount: 0};
 }
 for (const baseline of source.baseline.lines) {
  const accountCode = String(baseline.accountCode ?? baseline.glCode), key = keyOf(baseline.period, accountCode);
  if (!eligible(baseline.period) || incoming.has(key) || !hasNumber(baseline.amount)) continue;
  const rows = mappedSources.get(key) || [], unavailable = rows.filter(row => !hasNumber(row.amount));
  // A deliberately excluded numeric source is handled by its mapping decision;
  // it is not a source blank. Missing whole GL rows need their own decision.
  const absent = rows.length === 0;
  if (!unavailable.length && !(destination === 'new' && absent)) continue;
  const account = registry.find(item => item.accountCode === accountCode);
  const cell = {period: baseline.period, accountCode, baselineAmount: baseline.amount, inheritedAmount: baseline.amount, sourceLineIds: unavailable.map(row => row.id), sourceAmounts: unavailable.map(row => row.amount ?? null), disposition: absent ? 'source_absent_numeric_inheritance' : 'source_blank_numeric_inheritance', nature: account?.nature || baseline.nature || null, placement: account?.placement || baseline.placement || null, category: account?.category || baseline.category || null, baselineSource: baseline.source || null};
  cells.push(cell);
  issues.push({code: cell.disposition, severity: 'error', message: `${absent ? 'No workbook GL row supplies' : 'Blank / unavailable workbook values would inherit'} ${accountCode} / ${baseline.period}: approved baseline ${baseline.amount}. ${absent ? 'Review the complete source GL scope' : 'Resolve the missing source value'} before creating an exact workbook forecast. Blank, absent and zero are distinct; no inheritance policy has been approved.`, ...cell});
 }
 const totals = cells.reduce((sum, cell) => {
  if (cell.placement !== 'above_noi') return sum;
  if (['income', 'contra_income'].includes(cell.nature)) sum.revenue += cell.inheritedAmount;
  else if (cell.nature === 'expense') sum.opex += cell.inheritedAmount;
  return sum;
 }, {revenue: 0, opex: 0, noi: 0});
 totals.noi = totals.revenue - totals.opex;
 return {issues, cells, totals, nonzeroCount: cells.filter(cell => cell.inheritedAmount !== 0).length};
}
