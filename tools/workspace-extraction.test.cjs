const {readDashboardSource}=require('./dashboard-source.cjs');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=__dirname+'/../docs/portfolio-operations-dashboard/';const html=readDashboardSource(root+'index.html');
function extract(source,name){const m=new RegExp('^(?:async )?function '+name+'\\(','m').exec(source);assert(m,name);const ends=[source.indexOf('\n',m.index),...[...source.slice(m.index).matchAll(/^\}/gm)].map(x=>m.index+x.index+1)];for(const end of ends){const text=source.slice(m.index,end);try{new vm.Script(text);return text;}catch{}}throw Error(name);}
const shell=fs.readFileSync(root+'index.html','utf8');
assert(Buffer.byteLength(shell)<32768,'The initial HTML remains a small document shell');
assert.match(shell,/<script defer src="\.\/workspace-core\.js(?:\?[^"]*)?"><\/script>/);
assert.match(shell,/<link rel="stylesheet" href="\.\/atlas-core\.css(?:\?[^"]*)?"/);
new vm.Script(fs.readFileSync(root+'workspace-core.js','utf8'));
const manifest=require('./fixtures/workspace-renderer-hashes.json');
for(const [feature,spec] of Object.entries(manifest)){
 const source=fs.readFileSync(root+`features/${feature}-workspace.js`,'utf8');const context={window:{}};vm.runInNewContext(source,context);
 assert.equal(context.window[spec.ready],true);for(const [name,hash] of Object.entries(spec.functions)){
  assert.equal(typeof context[name],'function');assert(!new RegExp('^(?:async )?function '+name+'\\(','m').test(html),name+' stays outside the initial shell');
  if(!['renderDataImportHistoryView','renderDataImportArchiveView'].includes(name))assert.equal(crypto.createHash('sha256').update(extract(source,name)).digest('hex'),hash,name+' retains its exact pre-extraction renderer');
 }
}
for(const eager of ['xlsx.full.min.js','./central-services.js','./atlas_historical_restore_data.js'])assert(!new RegExp('<script[^>]+src=["\'][^"\']*'+eager.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(html),'No eager '+eager);
const context={Date,Number};vm.createContext(context);vm.runInContext(extract(html,'atlasExcel1900DateParts'),context);
for(const {value,expected} of require('./fixtures/excel-1900-date-parts.json').cases)assert.deepEqual(JSON.parse(JSON.stringify(context.atlasExcel1900DateParts(value))),expected,`Excel serial ${value}`);
for(const name of ['processApplicationResidentDataFiles','parseRonaldoDailyDlrWorkbook','handleRenewalWorkbook','parseDailyBoxScoreFile','handleMarketSurveyWorkbook','dataImportReadFileSample','dataImportPreviewRenewalWorkbook','dataImportReadStructuredRows','dataImportRouteApprovedFile','reprocessDataImportBoxScore','processRonaldoFloorPlanSnapshotRows','processRonaldoMonthlyReferenceFiles','handleAtlasAdvancedWorkbook'])assert.match(extract(html,name),/if \(typeof XLSX === "undefined"\) await window.AtlasFeatures.load\("xlsx"\)/,name+' awaits the parser on demand');
// Paged history must not present the compact bootstrap subset as complete or empty history.
const source=fs.readFileSync(root+'features/import-workspace.js','utf8');const h={window:{},dataImport2State:{historyStorage:{revision:3},batches:[{id:'compact-only'}]},dataImportHistoryPages:{},escapeHtml:v=>String(v).replaceAll('<','&lt;')};vm.createContext(h);vm.runInContext(source,h);
assert.match(h.renderDataImportHistoryView(),/Load saved history/);assert.doesNotMatch(h.renderDataImportHistoryView(),/No import batches|compact-only/);
h.dataImportHistoryPages.batches={revision:3,offset:25,total:51,nextOffset:50,rows:[{id:'later-page'}],loading:false};let page=h.dataImportHistoryDisplay('batches');assert.equal(page.rows[0].id,'later-page');assert.match(page.controls,/26–26 of 51/);assert.match(page.controls,/loadDataImportHistoryPage\('batches',50\)/);assert.match(page.controls,/loadDataImportHistoryPage\('batches',0\)/);
h.dataImport2State.historyStorage.revision=4;assert.equal(h.dataImportHistoryDisplay('batches').rows.length,0,'stale revision hides row actions');
console.log('PASS exact lazy renderer extraction, no eager optional scripts, explicit XLSX guards, SheetJS serial-date parity, honest paged history and stale revision protection.');
