import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {comparisonScope} from '../docs/portfolio-operations-dashboard/features/financial-comparison.mjs';
const base=new URL('../docs/portfolio-operations-dashboard/',import.meta.url);
const html=fs.readFileSync(new URL('RISE-Budget-Builder.html',base),'utf8');
const source=fs.readFileSync(new URL('budget-navigation.js',base),'utf8');
const actions=['exportPropertyCsv','exportOne','exportWorkbook','exportBudgetBook','previewBudgetBook','downloadActualsShell','exportFinancialReview','strExport','exportSegment','exportSegmentComparison','exportSegmentCsv','reportOpen','reportSave','reportOpenSegment','reportSaveSegment','reportOpenOne','reportSaveOne','reportOpenCustom','reportSaveCustom','printThisView','visualPrint'];
const guardedViews=['dashboard','actuals','financialreview','vsactual','exceptions','commentary','reports','exports','visuals'];
const trace={calculated:0,downloaded:[],routes:[],messages:[],mounts:[]},timers=[],elements=new Map();
let communityName='Community A',year=2026,scopeFailure=false;
const app={h:{esc:String},VIEWS:guardedViews.concat('monthly').map(id=>({id,label:id})),view:'dashboard',prop:()=>({id:'property',name:communityName}),year:()=>year,
 scenario:()=>({name:'Locked original',locked:true,status:'approved'}),c(){throw Error('A browser calculation must never run in an official view');},
 go(view){this.view=view;trace.routes.push(view);},toast(message){trace.messages.push(message);},
 download(...args){trace.downloaded.push(args);return 'downloaded';},
 doSaveFile(){this.download('UserBackup.json','{"source":"user"}','application/json');return true;},
 downloadTemplate(){if(scopeFailure)throw Error('Template failed');this.download('RISE_actuals_template.csv','GL,Month,Value');},
 convertDownload(){this.download('RISE_actuals.csv','5120,2026-01,0');},convertDownloadGlMap(){this.download('GL_map.csv','5120,Rent');},render(){},
 contractDownload(){return 'original-source-file';}};
const exporter={workbook(){trace.calculated++;},budgetBook(){trace.calculated++;},reports:{build(){trace.calculated++;},buildOne(){trace.calculated++;}}};
for(const name of actions){assert.match(html,new RegExp('A\\.'+name+'\\s*=\\s*function'),'The guard test targets a real UI handler: '+name);app[name]=()=>{trace.calculated++;throw Error('Retired financial export ran: '+name);};}
for(const name of ['reportHtml','reportCustomHtml','budgetBookHtml'])app[name]=()=>{trace.calculated++;return 'unverified local report';};
const R={app,exporter,persist:{},views:Object.fromEntries(guardedViews.map(id=>[id,()=>{throw Error('Local financial view ran: '+id);}]))};
R.views.monthly=()=>'<p>Editable working model</p>';
const context=vm.createContext({RBB:R,setTimeout:fn=>timers.push(fn),URL,location:{href:'https://atlas.test/RISE-Budget-Builder.html'},history:{replaceState(){}},sessionStorage:{setItem(){}},document:{addEventListener(){},getElementById:id=>elements.get(id)},__loadComparison:async()=>({mountComparison:async(el,scope)=>{trace.mounts.push(scope);el.textContent='Verified shared comparison';}})});
vm.runInContext(source.replace(/import\('\.\/features\/financial-comparison\.mjs\?v=[^']+'\)/,'__loadComparison()'),context);
for(const name of actions){assert.equal(app[name]('value','segment'),false);assert.equal(app.view,'reports');assert.match(trace.messages.at(-1),/Browser draft financial exports are disabled.*shared month/);}
assert.equal(trace.calculated,0);assert.deepEqual(trace.downloaded,[],'Blocked actions never create a local financial file');
for(const name of ['reportHtml','reportCustomHtml','budgetBookHtml'])assert.throws(()=>app[name](),/Browser draft financial exports are disabled/);
assert.throws(()=>exporter.workbook(),/disabled/);assert.throws(()=>exporter.budgetBook(),/disabled/);assert.throws(()=>exporter.reports.build(),/disabled/);assert.throws(()=>exporter.reports.buildOne(),/disabled/);
// Inline CSV buttons use the common downloader and cannot bypass named guards.
app.download('Scenario_Comparison.csv','Unverified browser outcomes');
app.download('Budget_Commentary.md','Unverified budget narrative');
app.download('Approved_budget.xlsx',new Uint8Array());
assert.equal(trace.downloaded.length,0);
assert.equal(app.doSaveFile(),true);app.downloadTemplate();app.convertDownload();app.convertDownloadGlMap();
assert.deepEqual(trace.downloaded.map(row=>row[0]),['UserBackup.json','RISE_actuals_template.csv','SOURCE_EVIDENCE_RISE_actuals.csv','SOURCE_EVIDENCE_GL_map.csv']);
assert.equal(app.contractDownload(),'original-source-file');
scopeFailure=true;assert.throws(()=>app.downloadTemplate(),/Template failed/);app.download('Leak.csv','Financial report');assert.equal(trace.downloaded.length,4,'An error cannot leave a template/evidence download allowance open');
for(const view of guardedViews){app.view=view;const rendered=R.views[view]();assert.match(rendered,/shared-financial-comparison/);assert.match(rendered,/snapshot fingerprint/);assert.match(rendered,/Reforecast reports/);assert.doesNotMatch(rendered,/No actuals loaded yet|Download the budget book|Legacy scenario comparison/);const top=app.renderTop();assert.match(top,/Shared financial records/);assert.doesNotMatch(top,/Effective gross income|Browser draft NOI|Publish to ATLAS/);const nav=app.renderNav();assert.match(nav,/Shared financial records/);assert.doesNotMatch(nav,/Locked original|Local editing lock|high-priority.*checks/);}
for(const view of ['reforecast','reforecastgap','reforecastapprovals']){app.view=view;assert.match(app.renderTop(),/Shared financial records/);assert.doesNotMatch(app.renderTop(),/Effective gross income|Locked original/);}
assert.equal(R.views.monthly(),'<p>Editable working model</p>');
const previousC=app.c;app.c=()=>({summary:{}});app.view='monthly';assert.match(app.renderNav(),/Browser draft.*Local editing lock/);app.c=previousC;
// A view captures its community/year before the async module resolves. New views
// invalidate old queued mounts so stale context cannot paint the current screen.
const element={isConnected:true,textContent:'',setAttribute(){}};elements.set('shared-financial-comparison',element);
R.views.reports();communityName='Community B';year=2027;R.views.financialreview();
for(const timer of timers.splice(0))await timer();
assert.equal(trace.mounts.length,1);assert.deepEqual(JSON.parse(JSON.stringify(trace.mounts[0])),{communityName:'Community B',year:2027});
const url='https://atlas.test/builder?comparisonCommunity=old-community&comparisonPeriod=2026-08';
const input={communityName:'Community B',communityId:'new-community',year:2027,url,now:new Date('2026-09-24T12:00:00Z')};
assert.deepEqual(comparisonScope(input),{communityId:'new-community',year:2027,period:'',defaultPeriod:'2027-01'});
assert.equal(comparisonScope({...input,communityId:undefined,communityName:'Unmapped explicit community'}).communityId,'','An unmapped selected property cannot show a prior property from URL state');
assert.equal(comparisonScope({...input,year:2026}).period,'2026-08','The selected reporting month may be retained within the same reporting year');
assert.equal(comparisonScope({...input,period:'2027-03'}).period,'2027-03');
assert.equal(comparisonScope({...input,communityName:undefined,communityId:undefined}).communityId,'old-community','An unscoped shared viewer may explicitly resume its URL selection');
console.log('PASS official overview/review/report routes, all legacy print/export guards, inline download bypass prevention, preserved backups/templates/source evidence, async stale-view rejection, and community/year scope isolation.');
