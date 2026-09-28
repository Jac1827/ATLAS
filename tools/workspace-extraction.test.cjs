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
const replayRenderGuard='  if(window.AtlasReplayWriteFence)return `<div class="alert-amber" role="status">Source replay or checkpoint recovery is active. Background refresh and unrelated saves are paused. Wait for the replay result; if recovery is pending, reload before inspecting the retained source.</div>`;\n';
for(const [feature,spec] of Object.entries(manifest)){
 const source=fs.readFileSync(root+`features/${feature}-workspace.js`,'utf8');const context={window:{}};vm.runInNewContext(source,context);
 assert.equal(context.window[spec.ready],true);for(const [name,hash] of Object.entries(spec.functions)){
  assert.equal(typeof context[name],'function');assert(!new RegExp('^(?:async )?function '+name+'\\(','m').test(html),name+' stays outside the initial shell');
  if(!['renderDataImportHistoryView','renderDataImportArchiveView'].includes(name)){
   let renderer=extract(source,name);
   if(name==='renderDataImport2Tab'){
    assert(renderer.startsWith('function renderDataImport2Tab() {\n'+replayRenderGuard),'The reviewed replay guard precedes every import render mutation');
    assert.equal(renderer.split(replayRenderGuard).length,2,'Exactly one reviewed guard is allowed');
    renderer=renderer.replace(replayRenderGuard,'');
   }
   assert.equal(crypto.createHash('sha256').update(renderer).digest('hex'),hash,name+' retains its exact pre-extraction renderer after the reviewed replay guard');
  }
 }
}
for(const eager of ['xlsx.full.min.js','./central-services.js','./atlas_historical_restore_data.js'])assert(!new RegExp('<script[^>]+src=["\'][^"\']*'+eager.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(html),'No eager '+eager);
const context={Date,Number};vm.createContext(context);vm.runInContext(extract(html,'atlasExcel1900DateParts'),context);
for(const {value,expected} of require('./fixtures/excel-1900-date-parts.json').cases)assert.deepEqual(JSON.parse(JSON.stringify(context.atlasExcel1900DateParts(value))),expected,`Excel serial ${value}`);
for(const name of ['processApplicationResidentDataFiles','parseRonaldoDailyDlrWorkbook','handleRenewalWorkbook','parseDailyBoxScoreFile','handleMarketSurveyWorkbook','dataImportReadFileSample','dataImportPreviewRenewalWorkbook','dataImportReadStructuredRows','dataImportRouteApprovedFile','reprocessDataImportBoxScore','processRonaldoFloorPlanSnapshotRows','processRonaldoMonthlyReferenceFiles','handleAtlasAdvancedWorkbook'])assert.match(extract(html,name),/if \(typeof XLSX === "undefined"\) await window.AtlasFeatures.load\("xlsx"\)/,name+' awaits the parser on demand');
// Paged history must not present the compact bootstrap subset as complete or empty history.
const source=fs.readFileSync(root+'features/import-workspace.js','utf8');const h={window:{},dataImport2State:{historyStorage:{revision:3},batches:[{id:'compact-only'}]},dataImportHistoryPages:{},escapeHtml:v=>String(v).replaceAll('<','&lt;')};vm.createContext(h);vm.runInContext(source,h);
// A fenced render must leave import root identity and normalization untouched; normal rendering resumes after release.
const originalImport={activeView:'archive'},normalizedImport={activeView:'archive',normalized:true},renderCalls=[];
const renderContext={window:{AtlasReplayWriteFence:{}},dataImport2State:originalImport,csvError:'',csvLog:[],dataImportPreviewController:null,
 normalizeDataImport2State:value=>{assert.equal(value,originalImport);renderCalls.push('normalize');return normalizedImport;},
 dataImportBuildHealthModel:()=>{renderCalls.push('health');return {};},renderDataImportHero:()=>'<p>hero</p>',renderDataImportTabs:()=>'<p>tabs</p>',renderDataImport2View:()=>'<p>archive</p>'};
vm.createContext(renderContext);vm.runInContext(extract(source,'renderDataImport2Tab'),renderContext);
assert.match(renderContext.renderDataImport2Tab(),/role="status".*Source replay or checkpoint recovery is active/);
assert.equal(renderContext.dataImport2State,originalImport);assert.deepEqual(renderCalls,[],'No normalization or health work runs behind the replay fence');
renderContext.window.AtlasReplayWriteFence=null;
assert.match(renderContext.renderDataImport2Tab(),/data-import2-shell[\s\S]*<p>archive<\/p>/);
assert.equal(renderContext.dataImport2State,normalizedImport);assert.deepEqual(renderCalls,['normalize','health']);
assert.match(h.renderDataImportHistoryView(),/Load saved history/);assert.doesNotMatch(h.renderDataImportHistoryView(),/No import batches|compact-only/);
h.dataImportHistoryPages.batches={revision:3,offset:25,total:51,nextOffset:50,rows:[{id:'later-page'}],loading:false};let page=h.dataImportHistoryDisplay('batches');assert.equal(page.rows[0].id,'later-page');assert.match(page.controls,/26–26 of 51/);assert.match(page.controls,/loadDataImportHistoryPage\('batches',50\)/);assert.match(page.controls,/loadDataImportHistoryPage\('batches',0\)/);
h.dataImport2State.historyStorage.revision=4;assert.equal(h.dataImportHistoryDisplay('batches').rows.length,0,'stale revision hides row actions');
console.log('PASS exact lazy renderer extraction with the reviewed replay guard, fenced root preservation and normal render resumption, no eager optional scripts, explicit XLSX guards, SheetJS serial-date parity, honest paged history and stale revision protection.');
