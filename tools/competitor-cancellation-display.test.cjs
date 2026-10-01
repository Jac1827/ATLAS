const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const P = require('../docs/portfolio-operations-dashboard/property-intelligence.js');
const core = fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js', 'utf8');
const parser = {matchPropertyName: name => name};
vm.createContext(parser);
for (const name of ['normalizeWorkbookNumber', 'normalizeWorkbookPercent', 'findWorksheetRow', 'extractMarketSurveyCompRows']) {
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
// These cases exercise the existing import contract, not approval of source units.
for (const [raw, expected] of [[0.077,'7.7%'],[7.7,'7.7%'],['7.7%','7.7%'],[0.007,'0.7%'],[0,'0%'],['0','0%'],['','—'],[null,'—'],[undefined,'—']]) {
  const rows = [['Cancel % (Last 7 days)','',raw],['Cancel % (Last 30 days)','',raw]];
  const comps = parser.extractMarketSurveyCompRows(rows,['Metric','Synthetic subject','Synthetic competitor'],1,-1);
  const readback = JSON.parse(JSON.stringify(comps));
  assert(render(readback).includes(`<td>${expected} / ${expected}</td>`), `parser-to-renderer: ${String(raw)} expected ${expected}`);
  assert.deepEqual(readback, JSON.parse(JSON.stringify(comps)), 'render must not mutate canonical values');
}
// Canonical percentage points below one must never be reinterpreted as fractions.
assert(render([{name:'Synthetic competitor',cancelPctLast7:0.7,cancelPctLast30:0}]).includes('<td>0.7% / 0%</td>'));
// Known unresolved import ambiguity, deliberately unchanged pending source contract:
console.log('PASS cancellation parser-to-renderer, serialized readback, canonical sub-1%, zero and missing; source-unit ambiguity remains pending.');

// Optional private evidence, kept outside the repository. The inspected workbook
// cell format explicitly declares a fractional percentage; never infer by size.
if (process.env.ATLAS_CANCELLATION_CELL_FIXTURE) {
  const sources = JSON.parse(fs.readFileSync(process.env.ATLAS_CANCELLATION_CELL_FIXTURE, 'utf8'));
  let checked = 0;
  for (const source of sources) for (const row of source.rows) for (const cell of row.cells) {
    assert.equal(cell.format, '0.0%');
    assert.equal(typeof cell.value, 'number');
    const rows = [['Cancel % (Last 7 days)', '', cell.value], ['Cancel % (Last 30 days)', '', cell.value]];
    const comps = parser.extractMarketSurveyCompRows(rows, ['Metric', 'Synthetic subject', 'Synthetic competitor'], 1, -1);
    const expected = new Intl.NumberFormat('en-US', {maximumFractionDigits:1}).format(cell.value * 100) + '%';
    assert(render(JSON.parse(JSON.stringify(comps))).includes(`<td>${expected} / ${expected}</td>`), 'private source cell display parity');
    checked++;
  }
  console.log(`PASS ${checked} percent-formatted source cells across ${sources.length} archived workbooks (local parser/render only).`);
}
