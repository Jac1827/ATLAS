// Fiscal import and closed-month evidence regressions. Synthetic source reports only.
import assert from 'node:assert/strict';
import * as I from '../docs/portfolio-operations-dashboard/features/budget-v2/importers.mjs';
import * as E from '../docs/portfolio-operations-dashboard/features/budget-v2/engine.mjs';
import * as L from '../docs/portfolio-operations-dashboard/features/budget-v2/learning.mjs';
import * as H from '../docs/portfolio-operations-dashboard/features/budget-v2/handoff.mjs';
import * as S from '../docs/portfolio-operations-dashboard/features/budget-v2/str.mjs';

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = p => `${monthNames[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;
const proposal = amount => ({monthly: Array(12).fill(amount), total: amount * 12});
const periods = E.fiscalPeriods(2027, 8);

// FY names are ending years; mixed calendar columns must match exact periods in order.
const calendar = [...E.fiscalPeriods(2026), ...E.fiscalPeriods(2027)];
const importRows = [['BUDGET_ID', 'ACCT_NO', ...calendar.map(p => `Month Ended ${label(p)}`)],
  ['Plan', '6537', ...calendar.map((_, i) => i + 1)]];
const fiscal = I.parseImportSheet(importRows, {fiscalYear: 2027, startMonth: 8});
assert(fiscal.ok);
assert.deepEqual(fiscal.periods, periods);
assert.deepEqual(fiscal.lines[0].monthly, Array.from({length: 12}, (_, i) => i + 8));
assert.equal(fiscal.lines[0].total, 162);
const january = I.parseImportSheet(importRows, {fiscalYear: 2027});
assert(january.ok);
assert.deepEqual(january.lines[0].monthly, Array.from({length: 12}, (_, i) => i + 13));
assert.equal(I.parseImportSheet([importRows[0].slice(0, 20), importRows[1].slice(0, 20)], {fiscalYear: 2027, startMonth: 8}).ok, false, 'missing July cannot silently truncate FY');
assert.equal(I.parseImportSheet([[...importRows[0], 'Aug 2026'], [...importRows[1], 100]], {fiscalYear: 2027, startMonth: 8}).ok, false, 'ambiguous fiscal month must be reviewed');
assert.equal(I.parseImportSheet(importRows, {fiscalYear: 2027, startMonth: 13}).ok, false);

// A complete T12 ends in the second fiscal month, leaving ten proposal months open.
const sourcePeriods = E.fiscalPeriods(2026, 10);
const sheet = [['Trailing 12 Month - Income Statement'], ['Test Community'],
  ['Account', 'Account Name', ...sourcePeriods.map(label), 'Total'],
  ['5120', 'Gross Potential Rent', ...Array(12).fill(100), 1200],
  ['6522', 'Pest Control', ...Array(12).fill(0), 0]];
const t12 = I.parseT12Sheet(sheet);
assert(I.canApproveT12Completeness(t12));
const model = {property: {name: 'Test', units: 10, assetClass: 'conventional'}, periods, start: 'proposal', sources: {proposal: {}},
  lines: [{gl: '5120', name: 'Gross Potential Rent', section: 'Rental Income', proposal: proposal(100)},
    {gl: '6522', name: 'Pest Control', section: 'Contract Services', proposal: proposal(10)},
    {gl: '6537', name: 'Landscaping', section: 'Contract Services', proposal: proposal(75)}],
  assumptions: {marketRent: 10}, schedule: {beginOccupied: 10}, positions: []};
model.base = E.freezeBase(model);
const reviewed = {...model, ...I.buildClosedActuals({lines: model.lines, periods, t12, approvedComplete: true})};
assert.equal(reviewed.closedMonths, 2);
assert.deepEqual(reviewed.actuals['6537'], [0, 0, ...Array(10).fill(null)]);
assert.equal(reviewed.actualEvidence.approvedComplete, true);
const result = E.calculate(reviewed);
assert.deepEqual(result.rows['6537'].monthly, [0, 0, ...Array(10).fill(75)], 'reviewed absent GL closes at zero without changing open proposal logic');
assert.deepEqual(result.rows['6522'].monthly.slice(0, 2), [0, 0], 'explicit source zero remains zero');
assert.equal(result.unavailableActuals.length, 0);
assert.equal(H.workbookMatrix(result, periods).find(row => row[0] === '6537')[2], 0);
assert.deepEqual(E.calculate(JSON.parse(JSON.stringify(reviewed))).rows['6537'].monthly, result.rows['6537'].monthly, 'reviewed evidence survives save/reload');

const unreviewed = {...model, ...I.buildClosedActuals({lines: model.lines, periods, t12})};
const missing = E.calculate({...unreviewed, overrides: {'6537': 99999}});
assert.deepEqual(missing.rows['6537'].monthly.slice(0, 2), [null, null], 'missing evidence cannot retain proposal or override');
assert.equal(missing.rows['6537'].annual, null);
assert.equal(missing.sections['Contract Services'].monthly[0], null);
assert.equal(missing.totals.annual.opex, null);
assert.equal(missing.totals.annual.noi, null);
assert.equal(missing.monthly.noi[0], null);
assert.equal(missing.kpis.noiPerUnit, null);
assert.equal(missing.groups.find(g => g.name === 'Contract Services').perUnit, null);
assert.deepEqual(missing.unavailableActuals, [{gl: '6537', period: '2026-08'}, {gl: '6537', period: '2026-09'}]);
assert(L.modelChecks(unreviewed, missing).some(check => check.gl === '6537' && check.severity === 'error'));
assert.throws(() => H.workbookMatrix(missing, periods), /actual evidence is unavailable/);
assert.equal(E.calculate({...model, closedMonths: 1, actuals: {}}).rows['6537'].monthly[0], null, 'legacy sparse actual arrays fail closed');
const reopened = E.calculate({...unreviewed, closedMonths: 0});
assert.deepEqual(reopened.rows['6537'].monthly.slice(0, 2), [null, null], 'lowering closed count cannot reopen imported source months');
assert.deepEqual(reopened.rows['6537'].locked.slice(0, 3), [true, true, false]);
assert.throws(() => E.publicationRows(reopened), /actual evidence is unavailable/);
assert.equal(E.effectiveClosedMonths({...unreviewed, actualEvidence: undefined, sources: {t12: {periods: t12.periods}}, closedMonths: 0}), 2, 'legacy imports also keep their source-backed closure');

// A present blank cell cannot be converted to zero even when completeness is requested.
const blankSheet = structuredClone(sheet);
blankSheet[4][12] = '';
const blankReport = I.parseT12Sheet(blankSheet);
assert.equal(blankReport.lines.find(l => l.gl === '6522').byPeriod['2026-08'], null);
assert(!I.canApproveT12Completeness(blankReport));
const blankEvidence = I.buildClosedActuals({lines: model.lines, periods, t12: blankReport, approvedComplete: true});
assert.equal(blankEvidence.actuals['6522'][0], null);
assert.equal(blankEvidence.actuals['6522'][1], 0);
assert.equal(blankEvidence.actuals['6537'][0], null);
assert.equal(blankEvidence.actualEvidence.approvedComplete, false);
const learnedModel = L.buildModel({property: model.property, fiscalYear: 2027, startMonth: 8, periods, t12: blankReport});
assert(learnedModel.lines.some(line => line.gl === '6522'), 'zero-total rows containing unavailable evidence cannot disappear');
const partialReport = {...t12, periods: t12.periods.slice(-2)};
assert.equal(I.buildClosedActuals({lines: model.lines, periods, t12: partialReport, approvedComplete: true}).actuals['6537'][0], null, 'partial reports do not prove omitted-GL zero');
const laterOnlyReport = {...t12, periods: ['2026-09']};
const gapEvidence = I.buildClosedActuals({lines: model.lines, periods, t12: laterOnlyReport, approvedComplete: true});
assert.equal(gapEvidence.closedMonths, 2, 'a later reported actual closes preceding fiscal periods too');
assert.deepEqual(gapEvidence.actuals['5120'].slice(0, 3), [null, 100, null], 'an unreported earlier month stays unavailable even if a stale byPeriod cell exists');
assert(gapEvidence.actualEvidence.unavailable.some(item => item.gl === '5120' && item.period === '2026-08' && item.reason === 'missing_period'));
const gapResult = E.calculate({...model, ...gapEvidence, closedMonths: 0});
assert.deepEqual(gapResult.rows['5120'].monthly.slice(0, 3), [null, 100, 100], 'latest source closure cannot silently retain the earlier proposal');
assert.deepEqual(gapResult.rows['5120'].locked.slice(0, 3), [true, true, false]);
assert.equal(gapResult.totals.annual.income, null);
assert.throws(() => E.publicationRows(gapResult), /actual evidence is unavailable/);
assert.equal(E.calculate({...model, ...gapEvidence, actuals: {...gapEvidence.actuals, '5120': [0, 100, ...Array(10).fill(null)]}}).rows['5120'].monthly[0], null, 'a saved zero without its declared source period cannot restore evidence');
const shiftedSourcePeriods = E.fiscalPeriods(2027, 9);
const shiftedReport = I.parseT12Sheet([['Trailing 12 Month - Income Statement'], ['Test'], ['Account', 'Account Name', ...shiftedSourcePeriods.map(label), 'Total'], ['5120', 'Rent', ...Array(12).fill(100), 1200]]);
assert(I.canApproveT12Completeness(shiftedReport));
const shiftedEvidence = I.buildClosedActuals({lines: model.lines, periods, t12: shiftedReport, approvedComplete: true});
assert.equal(shiftedEvidence.actualEvidence.approvedComplete, true);
assert.equal(shiftedEvidence.closedMonths, 12);
assert.deepEqual(shiftedEvidence.actuals['6537'].slice(0, 2), [null, 0], 'reviewed no-activity zero applies only to periods actually present in the complete source');
const duplicateReport = {...t12, lines: [...t12.lines, t12.lines[0]]};
assert.equal(I.buildClosedActuals({lines: model.lines, periods, t12: duplicateReport, approvedComplete: true}).actuals['5120'][0], null, 'duplicate GL actuals are ambiguous');

// STR accounts created after source import use reviewed completeness for omitted GLs,
// and never post projected STR dollars into already closed months.
const str = {...S.newStrProgram(), floorPlans: [{...S.newFloorPlan({type: 'A1', units: 10, marketRent: 10}), strUnits: 1, openingUnits: 1}]};
const strReviewed = E.calculate({...reviewed, str});
assert.equal(strReviewed.rows['5144'].monthly[0], 0);
assert.equal(strReviewed.rows['5144'].strMonthly[0], 0);
assert.equal(strReviewed.unavailableActuals.length, 0);
const strMissing = E.calculate({...unreviewed, str});
assert.equal(strMissing.rows['5144'].monthly[0], null);
assert.equal(strMissing.rows['5144'].strMonthly[0], 0);
assert.equal(strMissing.str.impact.totals.noi, null);
assert.throws(() => E.publicationRows(strMissing), /actual evidence is unavailable/);

console.log('PASS Budget Builder evidence: configured fiscal periods, reviewed no-activity zeros, missing actual preservation, STR closure and publication guard');
