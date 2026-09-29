/* Import review only: missing source values cannot authorize inherited numbers.
 * This does not change baseline values, saved revisions, or server approval. */
import {retainedWorkbookBlank,explicitWorkbookBlankSource,reviewedWorkbookSourcePolicy} from './reforecast-workbook-source-policy.mjs?v=be424108c7ddcacc';
const keyOf = (period, accountCode) => JSON.stringify([period, String(accountCode)]);
const groupKey = line => JSON.stringify([line.sheet, line.accountCode, line.department]);
const hasNumber = value => typeof value === 'number' && Number.isFinite(value);

export function reviewReforecastImportInheritance({evidence, source, mapping, lines = [], accountChoices = {}, destination = 'new', purpose, discoverSourceScope = false}) {
 if (purpose === 'original_budget' || source?.intakePurpose === 'original_budget') return {issues: [], cells: [], totals: {revenue: 0, opex: 0, noi: 0}, nonzeroCount: 0};
 const periods = new Set(mapping?.periods || []), cutoff = source?.actuals?.cutoffPeriod;
 const eligible = period => periods.has(period) && (!cutoff || period > cutoff) && !(source?.lockedPeriods || []).includes(period) && !(source?.actuals?.notApplicablePeriods || []).includes(period);
 const reviewedBlank = line => {
  if(!retainedWorkbookBlank(line,mapping)||line.sourceHash!==evidence?.source?.sha256)return false;
  const matches=(evidence?.lines||[]).filter(row=>row.id===line.sourceLineId);
  if(matches.length!==1||!explicitWorkbookBlankSource(matches[0]))return false;
  const sourceCell=matches[0],coordinate=line.sourceCoordinates;
  if(sourceCell.period!==line.period||sourceCell.scenario!==mapping.sourceScenario||sourceCell.sheet!==coordinate.sheet||sourceCell.address!==coordinate.address||sourceCell.row!==coordinate.row||sourceCell.column!==coordinate.column)return false;
  const targets=(mapping.accountMappings||[]).filter(account=>account.sourceAccountCode===sourceCell.accountCode&&(!account.sheet||account.sheet===sourceCell.sheet)&&(!Object.hasOwn(account,'department')||account.department===sourceCell.department));
  return targets.length===1&&targets[0].accountCode===line.accountCode;
 };
 const incoming = new Set(lines.filter(line => hasNumber(line.amount)||reviewedBlank(line)).map(line => keyOf(line.period, line.accountCode)));
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
 const issues = [], cells = [], scopeExclusions = [];
 if (!Array.isArray(source?.baseline?.lines)) {
  if (destination === 'new'||reviewedWorkbookSourcePolicy(mapping)) issues.push({code: 'source_baseline_unavailable', severity: 'error', message: 'Reload the approved baseline before creating a workbook forecast. The complete GL/month scope, including accounts absent from the workbook, cannot be verified without baseline readback.'});
  else if ([...mappedSources.values()].some(rows => rows.some(row => !hasNumber(row.amount)))) issues.push({code: 'source_blank_baseline_unavailable', severity: 'error', message: 'Reload the approved baseline before reviewing missing workbook values. Their inherited GL/month amounts cannot be verified.'});
  return {issues, cells, totals: {revenue: 0, opex: 0, noi: 0}, nonzeroCount: 0};
 }
 for (const baseline of source.baseline.lines) {
  const accountCode = String(baseline.accountCode ?? baseline.glCode), key = keyOf(baseline.period, accountCode);
  if (!eligible(baseline.period) || incoming.has(key) || (!hasNumber(baseline.amount)&&!reviewedWorkbookSourcePolicy(mapping)&&!discoverSourceScope)) continue;
  const rows = mappedSources.get(key) || [], unavailable = rows.filter(row => !hasNumber(row.amount));
  // A deliberately excluded numeric source is handled by its mapping decision;
  // it is not a source blank. Missing whole GL rows need their own decision.
  const absent = rows.length === 0;
  if (!unavailable.length && !((destination === 'new'||reviewedWorkbookSourcePolicy(mapping)) && absent)) continue;
  const exclusions=(mapping?.workbookSourcePolicy?.outsideForecastScope||[]).filter(row=>row.period===baseline.period&&row.accountCode===accountCode);
  if(absent&&reviewedWorkbookSourcePolicy(mapping)&&exclusions.length===1&&exclusions[0].confirmed===true&&exclusions[0].reviewedBy===mapping.reviewedBy&&exclusions[0].reviewedAt&&String(exclusions[0].reason||'').trim().length>=3){scopeExclusions.push({period:baseline.period,accountCode,baselineAmount:baseline.amount,disposition:'outside_forecast_scope'});continue;}
  const account = registry.find(item => item.accountCode === accountCode);
  // Exact-workbook drafts already calculate absent accounts as unresolved nulls.
  // They can be resumed without inventing a scope decision; the server blocks
  // submission and publication until those cells have a reviewed disposition.
  const pendingSourceReview = absent && reviewedWorkbookSourcePolicy(mapping) && exclusions.length === 0;
  const cell = {period: baseline.period, accountCode, baselineAmount: baseline.amount, inheritedAmount: pendingSourceReview ? null : baseline.amount, pendingSourceReview, sourceLineIds: unavailable.map(row => row.id), sourceAmounts: unavailable.map(row => row.amount ?? null), disposition: absent ? 'source_absent_numeric_inheritance' : 'source_blank_numeric_inheritance', nature: account?.nature || baseline.nature || null, placement: account?.placement || baseline.placement || null, category: account?.category || baseline.category || null, baselineSource: baseline.source || null};
  cells.push(cell);
  issues.push({code: cell.disposition, severity: pendingSourceReview ? 'warning' : 'error', message: pendingSourceReview ? `No workbook GL row supplies ${accountCode} / ${baseline.period}. The draft will retain an unresolved blank and the approved baseline as comparison evidence. Review its value or scope before submission or publication.` : `${absent ? 'No workbook GL row supplies' : 'Blank / unavailable workbook values would inherit'} ${accountCode} / ${baseline.period}: approved baseline ${hasNumber(baseline.amount)?baseline.amount:'blank / unavailable'}. ${absent ? 'Review the complete source GL scope' : 'Resolve the missing source value'} before creating an exact workbook forecast. Blank, absent and zero are distinct; no inheritance policy has been approved.`, ...cell});
 }
 const totals = cells.reduce((sum, cell) => {
  if (cell.placement !== 'above_noi'||!hasNumber(cell.inheritedAmount)) return sum;
  if (['income', 'contra_income'].includes(cell.nature)) sum.revenue += cell.inheritedAmount;
  else if (cell.nature === 'expense') sum.opex += cell.inheritedAmount;
  return sum;
 }, {revenue: 0, opex: 0, noi: 0});
 totals.noi = totals.revenue - totals.opex;
 return {issues, cells, scopeExclusions, totals, nonzeroCount: cells.filter(cell => hasNumber(cell.inheritedAmount)&&cell.inheritedAmount !== 0).length};
}
