const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const moneyColumns = ['currentRent', 'originalTargetRent', 'originalTargetGrowthAmount', 'finalNegotiatedRent', 'finalExecutedRent', 'achievedGrowthAmount'];
const context = { propertyName: 'Synthetic Community', monthIdx: 0, year: 2027, fileName: 'Synthetic Source.xlsx', sourceSheetName: 'January', importId: 'synthetic' };

function harness() {
  const forbidden = () => { throw Error('Report serialization must not access storage, network or UI'); };
  const c = vm.createContext({ window: {}, console, fetch: forbidden, alert: forbidden,
    localStorage: { getItem: forbidden, setItem: forbidden, removeItem: forbidden } });
  const source = fs.readFileSync(path.join(__dirname, '../docs/portfolio-operations-dashboard/central-services.js'), 'utf8');
  const boundary = /\}\)\(\);\s*$/;
  assert(boundary.test(source));
  vm.runInContext(source.replace(boundary, 'window.testReport = { renewalReportCsv, renewalReportFlatRows, parseCsvRows, formatMoney }; })();'), c);
  return { ...c.window.testReport, preview: c.window.atlasCsPreviewRenewalSheetRows };
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function exported(api, rows) {
  const payload = freeze({ rows });
  const before = JSON.stringify(payload);
  const csv = api.renewalReportCsv(payload);
  assert.equal(JSON.stringify(payload), before, 'Export must preserve normalized records and provenance');
  const [headers, ...values] = api.parseCsvRows(csv);
  assert.deepEqual(Array.from(headers), Object.keys(api.renewalReportFlatRows(payload)[0]), 'CSV columns stay unchanged');
  return values.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

test('blank mapped money cells export blank across all six amount columns', () => {
  const api = harness();
  const rows = api.preview([
    ['Resident', 'Unit', 'Expiration Date', 'Current Rate', 'Offer 1', 'Offer 2', 'Offer 3', 'Final Negotiated Rent', 'Final Executed Rent'],
    ['Synthetic Blank', 'S-1', '2027-01-31', '', '', '', '', '', '']
  ], context);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currentRate, 0, 'Canonical unset sentinel is not rewritten');
  const [row] = exported(api, rows);
  for (const field of moneyColumns) assert.equal(row[field], '', field);
  assert.equal(row.sourceFile, context.fileName);
  assert.equal(row.sourceSheet, context.sourceSheetName);
});

test('unmapped money and a signed-offer label cannot become exported zero amounts', () => {
  const api = harness();
  for (const extra of [[], ['Signed Offer']]) {
    const rows = api.preview([
      ['Resident', 'Unit', 'Expiration Date', ...extra],
      ['Synthetic Missing', 'S-2', '2027-01-31', ...(extra.length ? ['Offer 2'] : [])]
    ], context);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].finalExecutedRent, 0);
    assert.equal(rows[0].leaseExecutedDate, '');
    const [row] = exported(api, rows);
    for (const field of moneyColumns) assert.equal(row[field], '', field);
  }
});

test('nonzero positive, negative and decimal amounts retain numeric CSV values', () => {
  const api = harness();
  for (const sign of [1, -1]) {
    const row = { propertyName: 'Synthetic Community', residentName: 'Synthetic Amounts', unit: 'S-3', monthIdx: 0, year: 2027,
      currentRate: sign * 1500.25, originalTargetRent: sign * 1600.75, originalTargetRentGrowthAmount: sign * 100.5,
      finalNegotiatedRent: sign * 1575.5, finalExecutedRent: sign * 1580.25, finalAchievedRentGrowthAmount: sign * 80.125,
      originalTargetRentGrowthPct: 0, finalAchievedRentGrowthPct: 0, targetGrowthRetainedPct: 0 };
    const [result] = exported(api, [row]);
    const expected = [1500.25, 1600.75, 100.5, 1575.5, 1580.25, 80.125];
    moneyColumns.forEach((field, index) => assert.equal(result[field], String(sign * expected[index]), field));
    for (const field of ['originalTargetGrowthPct', 'achievedGrowthPct', 'growthRetainedPct']) assert.equal(result[field], '0', 'Percentage policy is unchanged');
  }
});

test('normalized zero follows money UI policy while fallback amounts and CSV evidence survive', () => {
  const api = harness();
  const row = { propertyName: 'Synthetic, Community', residentName: 'Synthetic "Quoted"', unit: 'S-4', monthIdx: 0, year: 2027,
    currentRate: 0, currentRent: 1450.5, originalTargetRent: 0, recommendedOffer: 1520.25,
    originalTargetRentGrowthAmount: 0, finalNegotiatedRent: 0, finalExecutedRent: 0, finalAchievedRentGrowthAmount: -0,
    sourceFileName: 'Synthetic, "Source".xlsx', sourceSheetName: 'January, 2027', status: 'Not Started' };
  const [result] = exported(api, [row]);
  assert.equal(result.currentRent, '1450.5');
  assert.equal(result.originalTargetRent, '1520.25');
  for (const field of moneyColumns.slice(2)) assert.equal(result[field], api.formatMoney(0));
  assert.equal(result.property, row.propertyName);
  assert.equal(result.resident, row.residentName);
  assert.equal(result.sourceFile, row.sourceFileName);
  assert.equal(result.sourceSheet, row.sourceSheetName);
  assert.equal(result.status, 'Not Started');
});
