const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),L=require('../docs/portfolio-operations-dashboard/application-lineage.js'),S=require('../docs/portfolio-operations-dashboard/screening-summary.js');
const parsed=S.parse(JSON.parse(fs.readFileSync(__dirname+'/fixtures/screening-summary-september-2026.json')));
let user='one',resolve,rows=[{import_id:'test',records:parsed.records}],events={};
const w={AtlasApplicationLineage:L,AtlasScreeningSummary:S,ATLAS_CENTRAL:{getSession:()=>user?{user:{id:user}}:null,readScreeningImports:async()=>rows},getAtlasApplicationScopeCommunityNames:()=>parsed.records.map(r=>r.propertySource),getApplicationResidentReportPeriodKey:()=> '2026-09',getAtlasApplicationIntelligenceData:()=>({records:[],history:[]}),renderTab(){},addEventListener:(n,f)=>events[n]=f};
const ctx={window:w,Date,Map,Set,console};vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/application-performance-ui.js','utf8'),ctx);
(async()=>{
await w.atlasRefreshScreening();events.load();await w.atlasRefreshScreening();const screen=w.getAtlasApplicationLineageReport().screening;assert.equal(screen.counts.screened,88);assert.equal(screen.overrides.pending,4);
const exp=w.getAtlasApplicationLineageExport();assert.equal(exp['Screening Summary'].reduce((n,r)=>n+(r.screened||0),0),88);assert.equal(exp['Screening Reasons'].filter(r=>r.reasonType==='failReasons').reduce((n,r)=>n+r.events,0),14);
assert(w.renderApplicationPerformanceTab().includes('14 multi-select reason events across 11 failed screenings'));
w.atlasApplicationCommandFilter('period','2026-08');assert.equal(w.getAtlasApplicationLineageReport().screening.counts,null);w.atlasApplicationCommandFilter('period','2026-09');
w.ATLAS_CENTRAL.readScreeningImports=()=>new Promise(r=>resolve=r);const pending=w.atlasRefreshScreening();user=null;await w.atlasRefreshScreening();resolve(rows);await pending;assert.equal(w.getAtlasApplicationLineageReport().screenRows.length,0,'Stale signed-in response cannot restore screening evidence');
user='two';w.ATLAS_CENTRAL.readScreeningImports=async()=>JSON.parse(JSON.stringify(rows));await w.atlasRefreshScreening();assert.equal(w.getAtlasApplicationLineageReport().screening.counts.screened,88,'Second authorized session rehydrates the same counts');
console.log('PASS screening client reload, historical month isolation, source-to-screen/export reconciliation, session race and second-session hydration.');
})().catch(e=>{console.error(e);process.exitCode=1});
