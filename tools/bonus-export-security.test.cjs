const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/../docs/portfolio-operations-dashboard/index.html', 'utf8');
const fn = name => html.match(new RegExp('^function ' + name + '\\([^]*?^\\}', 'm'))[0];

(async () => {
  let downloaded;
  let workbook;
  let spreadsheetRows;
  const cells = { A1: { v: '=employee', t: 's', f: 'employee' }, A2: { v: 'value', t: 'n', f: 'oldFormula' }, B2: { v: -25.5, t: 'n' }, '!ref': 'A1:B2' };
  const context = {
    Blob,
    URL: { createObjectURL(blob) { downloaded = blob; return 'blob:export'; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) },
    atlasBonusPeriodFromQuarter: () => ({ periodKey: '2026-Q3' }),
    alert(message) { throw new Error(message); },
    window: { XLSX: { utils: {
      json_to_sheet(rows) { spreadsheetRows = rows; return cells; },
      book_new: () => ({}),
      book_append_sheet(book, sheet) { book.sheet = sheet; }
    }, writeFile(book) { workbook = book; } } }
  };
  vm.createContext(context);
  ['atlasBonusSafeSpreadsheetCell', 'atlasBonusDownloadCsv', 'atlasBonusExportReport', 'exportBonusPayoutCSV'].forEach(name => vm.runInContext(fn(name), context));
  const hostile = ['=1+1', '+SUM(1,2)', '-SUM(1,2)', '@SUM(1,2)', ' \t\r=HYPERLINK("https://example.invalid")', '\u0000\u007f@command', '\u0085=command'];
  hostile.forEach(value => assert.equal(context.atlasBonusSafeSpreadsheetCell(value), "'" + value));
  assert.equal(context.atlasBonusSafeSpreadsheetCell(-25.5), -25.5);
  assert.equal(context.atlasBonusSafeSpreadsheetCell(null), null);
  assert.equal(context.atlasBonusSafeSpreadsheetCell('Ordinary text'), 'Ordinary text');
  const rows = hostile.map(value => ({ '=header': value, 'Approved Payout': -25.5, 'Pending': null }));
  context.atlasBonusExportRows = () => rows;
  context.atlasBonusExportReport('hr_payroll', 'csv');
  const csv = await downloaded.text();
  assert(csv.startsWith('"\'=header","Approved Payout","Pending"'));
  hostile.forEach(value => assert(csv.includes('"\'' + value.replaceAll('"', '""') + '"')));
  assert(csv.includes(',"-25.5",""'));
  assert(!csv.includes('"\'-25.5"'));

  context.atlasBonusExportReport('hr_payroll', 'excel');
  assert.equal(spreadsheetRows[0]["'=header"], "'=1+1");
  assert.equal(spreadsheetRows[0]['Approved Payout'], -25.5);
  assert.equal(spreadsheetRows[0].Pending, null);
  assert.equal(workbook.sheet.A1.f, undefined);
  assert.equal(workbook.sheet.A2.f, undefined);
  assert.equal(workbook.sheet.A2.t, 's');
  assert.equal(workbook.sheet.B2.t, 'n');
  assert.equal(workbook.sheet.B2.v, -25.5);
  assert.equal(rows[0]['=header'], '=1+1', 'Export sanitation cannot mutate retained receipt data.');

  context.getBonusExportData = () => ({ currentMonth: 'January', leasingAgents: [{ name: '\t=employee', community: '+community', assignmentSource: '@source', monthly: [{ month: 'January', payout: -25.5 }], quarterly: [], currentMonthProjected: -10 }], roleEmployees: [{ name: '-employee', community: 'Community', quarter: 'Q1', role: 'Manager', quarterlyPayout: -3, assignmentSource: '=source' }] });
  context.exportBonusPayoutCSV();
  const legacyCsv = await downloaded.text();
  assert(legacyCsv.includes('"\'\t=employee"'));
  assert(legacyCsv.includes('"\'+community"'));
  assert(legacyCsv.includes('"\'@source"'));
  assert(legacyCsv.includes('"-25.5"'));
  assert(!legacyCsv.includes('"\'-25.5"'));
  assert(legacyCsv.includes('"\'-employee"'));
  console.log('PASS Bonus CSV/XLSX and legacy payout exports protect formula/control prefixes, preserve negative numeric payouts and pending values, and do not mutate saved evidence.');
})().catch(error => { console.error(error); process.exitCode = 1; });
