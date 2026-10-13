const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const XLSX = require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const P = require('../docs/portfolio-operations-dashboard/property-intelligence.js');
const core = fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js', 'utf8');
const parser = {matchPropertyName: name => name, XLSX};
vm.createContext(parser);
for (const name of ['normalizeWorkbookNumber', 'normalizeWorkbookPercent', 'normalizeMarketSurveyCancellationPercent', 'findWorksheetRow', 'extractMarketSurveyCompRows']) {
  const source = core.match(new RegExp('^function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'));
  assert(source, name);
  vm.runInContext(source[0], parser);
}
function render(comps) {
  const detail = {name:'Synthetic subject',record:{marketSurveyHistory:{'2026-09':{updatedOn:'2026-09-27',sourceFileName:'Synthetic fixture',surveyComps:comps}}}};
  const window = {
    AtlasPropertyIntelligence:P, AtlasPropertyService:{cache:new Map([[detail.name,{offers:[],observations:[]}]])},
    getCompCalculatorScopeMeta:()=>({marketArea:'Synthetic market'}), getSelectedDashboardPeriodKey:()=> '2026-09',
    getWorkspaceScopedDetails:()=>[detail], atlasPropertyMetrics:(d,r)=>P.metrics([],r)
  };
  vm.runInNewContext(fs.readFileSync('docs/portfolio-operations-dashboard/concession-insights.js','utf8'), {window,Intl,Date,Map,Set});
  return window.AtlasConcessionInsights.render();
}
// Use the real parser, then a serialized readback in a fresh renderer context.
// Numeric fractions and points need explicit units, independent of magnitude.
for (const [raw, unit, expected] of [
  [0.077,'fraction','7.7%'],[7.7,'percentage_points','7.7%'],
  [0.007,'fraction','0.7%'],[0.7,'percentage_points','0.7%'],
  [1,'fraction','100%'],[1,'percentage_points','1%'],
  ['7.7%','','7.7%'],['0.7%','','0.7%'],['1%','','1%'],
  [0,'','0%'],['0','','0%'],['','','—'],[null,'','—'],[undefined,'','—'],
  [0.7,'','—'],[7.7,'','—'],['0.7','','—'],
  ['ERROR:#REF!','fraction','—'],['#DIV/0!','percentage_points','—'],
  ['not a number','fraction','—'],[false,'fraction','—'],[Infinity,'fraction','—']
]) {
  const rows = [['Cancel % (Last 7 days)','',raw],['Cancel % (Last 30 days)','',raw]];
  const comps = parser.extractMarketSurveyCompRows(rows,['Metric','Synthetic subject','Synthetic competitor'],1,-1,{cancellationUnit:unit});
  const readback = JSON.parse(JSON.stringify(comps));
  assert(render(readback).includes(`<td>${expected} / ${expected}</td>`), `parser-to-renderer: ${String(raw)} expected ${expected}`);
  assert.deepEqual(readback, JSON.parse(JSON.stringify(comps)), 'render must not mutate canonical values');
}
// Canonical percentage points below one must never be reinterpreted as fractions.
assert(render([{name:'Synthetic competitor',cancelPctLast7:0.7,cancelPctLast30:0}]).includes('<td>0.7% / 0%</td>'));
console.log('PASS explicit cancellation units, percentage strings, canonical sub-1%, zero, missing/error and serialized renderer parity.');

// Keep actual raw cells, including errors hidden by sheet_to_json, and preserve
// precision beyond the displayed decimal places. The range begins away from A1.
const sheet = {
  C5:{t:'s',v:'Metric'}, D5:{t:'s',v:'Synthetic subject'}, E5:{t:'s',v:'Synthetic competitor'}, F5:{t:'s',v:'Comp average'},
  C6:{t:'s',v:'Cancel % (Last 7 days)'}, D6:{t:'n',v:0.077,z:'0.0%'}, E6:{t:'n',v:0.00666,z:'0.00%'},
  C7:{t:'s',v:'Cancel % (Last 30 days)'}, D7:{t:'s',v:'1%'}, E7:{t:'e',v:23},
  '!ref':'C5:F7'
};
const book = {SheetNames:['Market Survey'],Sheets:{'Market Survey':sheet}};
const buffer = XLSX.write(book,{type:'buffer',bookType:'xlsx'});
const readBook = XLSX.read(buffer,{type:'buffer',cellNF:true});
const readSheet = readBook.Sheets['Market Survey'];
const readRows = XLSX.utils.sheet_to_json(readSheet,{header:1,defval:'',raw:false});
const readComps = parser.extractMarketSurveyCompRows(readRows,readRows[0],1,-1,{sheet:readSheet,sheetName:'Market Survey'});
assert.equal(readComps[0].cancelPctLast7,7.7);
assert.equal(readComps[0].cancelPctLast30,1);
assert.equal(readComps[1].cancelPctLast7,0.666);
assert.equal(readComps[1].cancelPctLast30,null);
assert.equal(readComps[1].cancellationSource.cancelPctLast7.rawValue,0.00666);
assert.equal(readComps[1].cancellationSource.cancelPctLast7.numberFormat,'0.00%');
assert.equal(readComps[1].cancellationSource.cancelPctLast7.sourceCell,'E6');
assert.equal(readComps[1].cancellationSource.cancelPctLast7.sourceSheet,'Market Survey');
assert.equal(readComps[1].cancellationSource.cancelPctLast30.cellType,'e');
assert.equal(readComps[1].cancellationSource.cancelPctLast30.availabilityReason,'source_error');
for (const format of ['General','0.0','0.0"%"','0.0\\%','0.0_%','0.0*%','0.0;0.0%','[>=1]0.0%;0.0']) {
  const currentSheet={...readSheet,E6:{t:'n',v:0.7,z:format}};
  const currentRows=XLSX.utils.sheet_to_json(currentSheet,{header:1,defval:'',raw:false});
  const current=parser.extractMarketSurveyCompRows(currentRows,currentRows[0],1,-1,{sheet:currentSheet,sheetName:'Market Survey'})[1];
  assert.equal(current.cancelPctLast7,null,`No fractional conversion from literal/non-percent format ${format}`);
  assert.equal(current.cancellationSource.cancelPctLast7.availabilityReason,'source_unit_unverified');
}
const textNumberSheet={...readSheet,E6:{t:'s',v:'0.7',z:'0.0%'}};
const textNumberRows=XLSX.utils.sheet_to_json(textNumberSheet,{header:1,defval:'',raw:false});
assert.equal(parser.extractMarketSurveyCompRows(textNumberRows,textNumberRows[0],1,-1,{sheet:textNumberSheet})[1].cancelPctLast7,null,'Excel number format does not supply units to a text cell');
// Canonical normalization/readback must preserve both the value and raw evidence,
// and must never reinterpret old stored percentage points lacking that evidence.
Object.assign(parser,{window:{AtlasPropertyIntelligence:P},defaultMarketSurveyData:()=>({}),normalizeMarketSurveyFloorPlanRates:()=>[]});
vm.runInContext(core.match(/^function normalizeMarketSurveyData\([^\n]*\) \{[\s\S]*?^\}/m)[0],parser);
const normalized=parser.normalizeMarketSurveyData({surveyComps:JSON.parse(JSON.stringify(readComps))});
assert.equal(normalized.surveyComps[1].cancelPctLast7,0.666);
assert.deepEqual(JSON.parse(JSON.stringify(normalized.surveyComps[1].cancellationSource)),JSON.parse(JSON.stringify(readComps[1].cancellationSource)));
assert.equal(parser.normalizeMarketSurveyData({surveyComps:[{name:'Saved competitor',cancelPctLast7:0.7}]}).surveyComps[0].cancelPctLast7,0.7);
console.log('PASS XLSX number formats, raw precision, offset cell lineage, Excel errors, unverified units and canonical source readback.');

// Optional private evidence, kept outside the repository. The inspected workbook
// cell format explicitly declares a fractional percentage; never infer by size.
if (process.env.ATLAS_CANCELLATION_CELL_FIXTURE) {
  const sources = JSON.parse(fs.readFileSync(process.env.ATLAS_CANCELLATION_CELL_FIXTURE, 'utf8'));
  let checked = 0;
  for (const source of sources) for (const row of source.rows) for (const cell of row.cells) {
    assert.equal(cell.format, '0.0%');
    assert.equal(typeof cell.value, 'number');
    const rows = [['Cancel % (Last 7 days)', '', cell.value], ['Cancel % (Last 30 days)', '', cell.value]];
    const comps = parser.extractMarketSurveyCompRows(rows, ['Metric', 'Synthetic subject', 'Synthetic competitor'], 1, -1, {cancellationUnit:'fraction'});
    const expected = new Intl.NumberFormat('en-US', {maximumFractionDigits:1}).format(cell.value * 100) + '%';
    assert(render(JSON.parse(JSON.stringify(comps))).includes(`<td>${expected} / ${expected}</td>`), 'private source cell display parity');
    checked++;
  }
  console.log(`PASS ${checked} percent-formatted source cells across ${sources.length} archived workbooks (local parser/render only).`);
}

// Execute the real file reader and workbook adapter; stubs only isolate unrelated
// floor-plan/property publication. cellNF must survive this production entry point.
for (const name of ['getWorkbookSheetRows','findWorksheetCellMatch','extractMarketSurveyWorkbookData','handleMarketSurveyWorkbook']) {
  vm.runInContext(core.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm'))[0],parser);
}
let applied;
Object.assign(parser,{
  marketSurveyImportLog:[],guessCommunityNameFromMarketFileName:()=> 'Synthetic subject',
  formatWorkbookDateLabel:()=>'',normalizeCommunityLookupName:name=>String(name||'').toLowerCase(),
  extractMarketSurveyFloorPlanRates:()=>[],buildMarketSurveyCompSet:()=>'',buildMarketSurveyConcessionSummary:()=>'',
  applyMarketSurveyDataToProperty:(name,value)=>{applied=value;return {matchedName:name};}
});
(async()=>{
  await parser.handleMarketSurveyWorkbook({name:'Synthetic.xlsx',arrayBuffer:async()=>buffer},()=>true);
  assert.equal(applied.surveyComps[1].cancelPctLast7,0.666);
  assert.equal(applied.surveyComps[1].cancelPctLast30,null);
  assert.equal(applied.surveyComps[1].cancellationSource.cancelPctLast7.numberFormat,'0.00%');
  assert.equal(applied.sourceFileName,'Synthetic.xlsx');
  assert(parser.marketSurveyImportLog.some(message=>message.includes('1 spreadsheet errors')&&message.includes('remain unavailable')));
  console.log('PASS actual market-survey file reader → workbook adapter → publication payload preserves cancellation units and errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
