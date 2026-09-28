import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {installLegacyReforecastBridge,legacyScenarioDraftInput} from '../docs/portfolio-operations-dashboard/features/reforecast-legacy-bridge.mjs';
import {reforecastDraftFromLegacy} from '../docs/portfolio-operations-dashboard/features/reforecast-ui.mjs';

const dir='docs/portfolio-operations-dashboard/';
const context={console,Date,URL,URLSearchParams,TextEncoder,structuredClone,setTimeout:()=>0,clearTimeout(){},location:{search:'',href:'http://localhost/',origin:'http://localhost'},document:{addEventListener(){},querySelectorAll(){return[];},getElementById(){return null;}},localStorage:{getItem(){return null;}},addEventListener(){},navigator:{}};
context.window=context;context.parent=context;vm.createContext(context);
for(const match of fs.readFileSync(dir+'RISE-Budget-Builder.html','utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim()&&!match[1].includes('RBB.app.boot()'))vm.runInContext(match[1],context);
const R=context.RBB,state=R.buildState();
vm.runInContext(fs.readFileSync(dir+'budget-mapped-import.js','utf8'),context);

// Retained workbook rows deliberately have IDs unlike the editable Doro rows,
// and different amounts, as they do when shared approved records are loaded.
const approved=R.engine.computeProperty(state,'DORO','SC-APPROVED',2026),groups=new Map();
for(const result of Object.values(approved.results)){
 const code=String(result.line.gl),row=groups.get(code)||{property:'DORO',gl:code,gl_name:result.line.name,year:'2026',effective_date:'2026-01-01',__monthly:Array(12).fill(0),__row:groups.size+2};
 result.monthly.forEach((value,m)=>row.__monthly[m]+=Math.round(value*1.17*100)/100);groups.set(code,row);
}
assert.equal(R.importer.apply('approved_budget',{accepted:[...groups.values()],errors:[],fileName:'Retained approved budget.xlsx',sheetName:'Budget'},state).applied,groups.size);
installLegacyReforecastBridge(R);
Object.assign(R.app,{state,render(){},toast(){}});state.activeScenario='SC-WORK';
const calc=(sid='SC-WORK',year=2026)=>R.engine.computeProperty(state,'DORO',sid,year);
const before=calc(),baselineBefore=JSON.stringify(calc('SC-APPROVED').results),sourceBefore=JSON.stringify(state.lines),retainedBefore=JSON.stringify(state.approvedBudgetImports);
assert.equal(before.results['DORO-L001'].monthly[0],groups.get('5120').__monthly[0]);
R.app.setOverride('DORO-L001',0,'499999.25');
R.app.setOverride('DORO-L001',1,'0');
R.app.setOverride('DORO-L001',2,'-123.45');
const edited=calc();
assert.deepEqual(Array.from(edited.results['DORO-L001'].monthly.slice(0,3)),[499999.25,0,-123.45],'Saved draft cells survive the scenario bridge');
assert.equal(edited.results['DORO-L001'].monthly[3],before.results['DORO-L001'].monthly[3],'Unedited months keep the approved baseline');
assert.equal(JSON.stringify(state.lines),sourceBefore,'Working grid edits never rewrite original workbook lines');
assert.equal(JSON.stringify(state.approvedBudgetImports),retainedBefore,'Working grid edits never rewrite the retained approved workbook');
assert.equal(JSON.stringify(calc('SC-APPROVED').results),baselineBefore,'Approved scenario calculations remain unchanged');
assert.equal(calc('SC-WORK',2027).results['DORO-L001'].monthly[0],state.lines[0].yearData[2027][0],'Month edits are isolated to the selected year');
assert.equal(calc('SC-REFORECAST').results['DORO-L001'].monthly[0],before.results['DORO-L001'].monthly[0],'Other drafts do not inherit these edits');

// Driver calculations and cached snapshots cannot replace an explicitly typed
// value, including a value equal to the approved baseline or an explicit zero.
state.scenarios.find(row=>row.id==='SC-WORK').assumptionOverrides.rent_growth=0.5;
R.app.setOverride('DORO-L001',0,String(before.results['DORO-L001'].monthly[0]));
const withDriver=calc();
assert.equal(withDriver.results['DORO-L001'].monthly[0],before.results['DORO-L001'].monthly[0]);
assert.equal(withDriver.results['DORO-L001'].monthly[1],0);
assert.notEqual(withDriver.results['DORO-L001'].monthly[3],before.results['DORO-L001'].monthly[3],'Assumption driver still affects unedited months');
const input=legacyScenarioDraftInput({R,state,propertyId:'DORO',year:2026,scenario:withDriver.scenario,baselineCalc:calc('SC-APPROVED'),scenarioCalc:withDriver});
assert.equal(input.scenario.overrides.find(row=>row.period==='2026-02'&&row.accountCode==='5120').amount,0);
const restored=JSON.parse(R.persist.toJson(state));R.app.state=restored.state;
const reread=R.engine.computeProperty(restored.state,'DORO','SC-WORK',2026);
assert.equal(reread.results['DORO-L001'].monthly[0],withDriver.results['DORO-L001'].monthly[0]);
assert.equal(reread.results['DORO-L001'].monthly[1],0);
assert.equal(reread.results['DORO-L001'].monthly[2],-123.45);

// A visit to the shared reforecast workspace may populate these read-only
// sources. The working budget must remain editable for January too, while a
// reforecast continues to use the protected closed January actuals.
R.app.state=state;
const sources={communityId:'DORO',sourceVersion:'shared-january-close',baseline:input.baseline,registry:input.registry,
 actuals:{cutoffPeriod:'2026-01',closeVersions:[{period:'2026-01',versionId:'jan-closed'}],lines:input.baseline.lines.filter(row=>row.period==='2026-01').map(row=>({...row,amount:row.amount*0.9}))}};
const sharedBefore=JSON.stringify(sources);R.reforecastSources={'DORO|2026':sources};
R.app.setOverride('DORO-L001',0,'333333.33');
const withSharedSources=calc();
assert.equal(withSharedSources.results['DORO-L001'].monthly[0],333333.33,'A browser working budget can edit a month with closed actuals');
assert.equal(withSharedSources.reforecastSnapshot.monthly[0].reforecast.noi,withSharedSources.rollup.noi[0],'Working budget snapshot and displayed totals stay aligned');
const reforecast=state.scenarios.find(row=>row.id==='SC-REFORECAST');
reforecast.lineOverrides['DORO-L001']={monthlyOverridesByYear:{2026:{0:111111}}};
const closedForecast=calc('SC-REFORECAST');
assert.equal(closedForecast.results['DORO-L001'].monthly[0],sources.actuals.lines.find(row=>row.accountCode==='5120').amount,'Reforecast scenarios retain the closed actuals');
assert(closedForecast.reforecastSnapshot.diagnostics.some(row=>row.code==='protected_override'),'Reforecast manual overrides still respect closed-period guards');
assert.equal(JSON.stringify(sources),sharedBefore,'Shared actuals, baseline and registry remain unchanged');
assert.equal(JSON.stringify(calc('SC-APPROVED').results),baselineBefore);
// The existing explicit copy into the governed workspace keeps edited open
// amounts and their review evidence; closed actuals are never overwritten.
const workingInput=legacyScenarioDraftInput({R,state,propertyId:'DORO',year:2026,scenario:withSharedSources.scenario,baselineCalc:calc('SC-APPROVED'),scenarioCalc:withSharedSources,sources});
const copied=reforecastDraftFromLegacy({input:workingInput,scenario:withSharedSources.scenario,source:{...sources,periods:workingInput.periods},actor:'synthetic-user',propertyId:'DORO',reason:'Reviewed browser draft amounts',timestamp:'2026-09-28T12:00:00Z'});
assert.equal(copied.overrides.find(row=>row.period==='2026-02'&&row.accountCode==='5120').amount,0);
assert.equal(copied.overrides.find(row=>row.period==='2026-03'&&row.accountCode==='5120').amount,-123.45);
assert(copied.overrides.every(row=>row.confirmed&&row.source.kind==='explicit_browser_scenario_copy'));
assert(!copied.overrides.some(row=>row.period==='2026-01'),'Governed copy continues to protect closed actuals');
assert.equal(JSON.stringify(sources),sharedBefore);
console.log('PASS browser working-draft bridge: approved workbook IDs, exact monthly values, zero/negative amounts, driver precedence, scenario/year isolation, saved-state round trip, closed-month working edits and unchanged approved budgets / actuals protections');
