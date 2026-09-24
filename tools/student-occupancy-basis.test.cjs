const {readDashboardSource}=require('./dashboard-source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const bridge = require('../docs/portfolio-operations-dashboard/application-source-bridge.js');

const html = readDashboardSource(`${__dirname}/../docs/portfolio-operations-dashboard/index.html`);
const context = { console, Date, Map, Set, window: {}, savedData: {} };
vm.createContext(context);
for (const match of html.matchAll(/^(?:async )?function [A-Za-z_$][\w$]*\([^\n]*\) \{[\s\S]*?^\}/gm)) {
  try { vm.runInContext(match[0], context); } catch {}
}

let configuredUnits = 0;
let month = {};
Object.assign(context, {
  normalizeSavedCommunityRecord: () => ({ communityPropertyType: 'Student Housing' }),
  getResolvedTotalUnitsForRecord: () => configuredUnits,
  dataImportNormalizeText: value => String(value ?? '').trim().toLowerCase(),
  dataImportNumericValue: value => value === null || value === undefined || value === '' ? null : Number(value),
  dataImportPercentValue: value => value === null || value === undefined || value === '' ? null : Number(value),
  dataImportShouldApplyCurrentMetric: () => true,
  dataImportUpsertFloorPlan: () => {},
  getWritableMonthlyPeriodEntries: () => ({ historyEntry: month, liveEntry: month }),
  dataImportApplyMetric: (_record, _plan, _result, _community, _period, target, value) => {
    if (value === null || value === undefined) return false;
    const fields = { occupied: 'occupiedSnapshot', leased: 'leasedSnapshot', move_ins: 'moveIns', move_outs: 'moveOuts' };
    if (fields[target]) month[fields[target]] = Number(value);
    return true;
  }
});

function apply(communityName, total, rentable, occupied, leased, available, propertyType = 'Student Housing') {
  configuredUnits = total;
  month = {};
  context.normalizeSavedCommunityRecord = () => ({ communityPropertyType: propertyType });
  const result = { issues: [], formulas: [], destinations: new Set() };
  context.dataImportApplyGroupedSnapshot({
    communityName,
    period: { monthIdx: 8, year: 2026, periodKey: '2026-09' },
    entries: [{ sourceRow: { sourceSheet: communityName }, row: {
      measurement_basis: 'units',
      total_units: total,
      rentable_units: rentable,
      occupied_units: occupied,
      source_leased_units: leased,
      excluded_units: total - rentable,
      available_units: available
    } }]
  }, { reportType: 'box_score', name: 'Entrata Box Score 2026-09-17.xlsx' }, result);
  return { month, result };
}

const communities = [
  ['Anthem House', 185, 185, 172, 174, 12, 'Multifamily'],
  ['Pilots Pointe at LSUS', 388, 384, 382, 384, 0, 'Student Housing'],
  ['Prosper On Fayette', 314, 314, 314, 314, 0, 'Student Housing'],
  ['RISE 34th', 369, 369, 342, 345, 24, 'Student Housing'],
  ['The Preserve at Tech', 588, 588, 547, 550, 40, 'Student Housing']
];

for (const [name, total, rentable, occupied, leased, available, propertyType] of communities) {
  const applied = apply(name, total, rentable, occupied, leased, available, propertyType);
  assert.equal(applied.month.occupiedSnapshot, occupied, `${name} occupied count publishes`);
  assert.equal(applied.month.leasedSnapshot, leased, `${name} leased count publishes`);
  assert.equal(applied.month.rentableUnits, rentable, `${name} denominator remains source rentable inventory`);
  assert.equal(applied.month.excludedUnits, total - rentable, `${name} exclusions are retained once`);
  assert.equal(applied.month.physicalOccupancyPct, occupied / rentable * 100, `${name} physical occupancy reconciles`);
  assert.equal(applied.month.exposureAdjustedOccupancyPct, (rentable - available) / rentable * 100, `${name} exposure excludes non-rentable units`);
  assert(!applied.result.issues.some(issue => issue.type === 'basis'), `${name} has no false student-basis rejection`);
}

const portfolio = communities.reduce((sum, [, total, rentable, occupied, leased, available]) => ({
  total: sum.total + total,
  rentable: sum.rentable + rentable,
  occupied: sum.occupied + occupied,
  leased: sum.leased + leased,
  available: sum.available + available
}), { total: 0, rentable: 0, occupied: 0, leased: 0, available: 0 });
assert.deepEqual(portfolio, { total: 1844, rentable: 1840, occupied: 1757, leased: 1767, available: 76 });
assert.equal(portfolio.occupied / portfolio.rentable * 100, 95.48913043478261, 'Portfolio physical occupancy uses rentable inventory');
assert.equal(portfolio.leased / portfolio.rentable * 100, 96.03260869565217, 'Portfolio leased occupancy uses rentable inventory');
assert.equal((portfolio.rentable - portfolio.available) / portfolio.rentable * 100, 1764 / 1840 * 100, 'Portfolio exposure excludes non-rentable units');

const rawAvailability = Array.from({ length: 11 }, () => []);
rawAvailability[5][0] = 'Availability (As of 09/17/2026)';
rawAvailability[7] = ['Unit Type', '', '', '', '', 'Units', 'Excluded', 'Rentable Units', 'Occupied', 'Vacant', 'Available', 'Occupied No Notice', 'Notice Rented', 'Notice Unrented', 'Vacant Rented', 'Vacant Unrented', 'Occupied'];
rawAvailability[10] = ['Total', '', '', '', '', 185, 0, 185, 172, 13, 12, 171, 0, 1, 2, 11, 0.9297297297];
const parsedAnthem = bridge.boxScore(rawAvailability)[0];
assert.equal(parsedAnthem.values.occupied_units, 172, 'Duplicate Occupied percentage header cannot replace occupied count');
assert.equal(parsedAnthem.locators.occupied_units.column, 9, 'Occupied count retains its source column');

const anthem = apply('Anthem House', 185, 185, 172, 174, 12, 'Multifamily');
assert.equal(anthem.month.physicalOccupancyPct, 172 / 185 * 100);

configuredUnits = 588;
month = { occupiedSnapshot: 77, leasedSnapshot: 80 };
context.normalizeSavedCommunityRecord = () => ({ communityPropertyType: 'Student Housing' });
const mismatchResult = { issues: [], formulas: [], destinations: new Set() };
context.dataImportApplyGroupedSnapshot({
  communityName: 'The Preserve at Tech',
  period: { monthIdx: 8, year: 2026, periodKey: '2026-09' },
  entries: [{ sourceRow: { sourceSheet: 'Wrong Community' }, row: { measurement_basis: 'units', total_units: 185, rentable_units: 185, occupied_units: 172, source_leased_units: 174 } }]
}, { reportType: 'box_score', name: 'Mismatched Box Score.xlsx' }, mismatchResult);
assert.equal(month.occupiedSnapshot, 77, 'Mismatched student inventory remains held');
assert(mismatchResult.issues.some(issue => issue.type === 'basis'), 'Mismatched student inventory raises a basis issue');

console.log('PASS September 17 occupancy reconciles for all five affected communities; mismatched student inventory remains held.');
