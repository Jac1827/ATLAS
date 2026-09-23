import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {computeReforecast,applyRecommendations,undoRecommendationAction} from '../docs/portfolio-operations-dashboard/features/reforecast-engine.mjs';
import {installLegacyReforecastBridge} from '../docs/portfolio-operations-dashboard/features/reforecast-legacy-bridge.mjs';
const periods=['2026-07','2026-08','2026-09'],accounts=[['5120','income','RENTAL INCOME'],['5220','contra_income','VACANCY'],['5250','contra_income','CONCESSIONS'],['6300','expense','PAYROLL'],['6400','expense','UTILITIES'],['6500','expense','GENERAL'],['6600','expense','INSURANCE'],['6700','expense','TAX'],['6800','expense','CONTRACTS'],['1500','capital','CAPITAL'],['8000','debt','DEBT']].map(([accountCode,nature,category])=>({accountCode,nature,category,placement:['capital','debt'].includes(nature)?'below_noi':'above_noi'}));
const values={'5120':10000,'5220':-1000,'5250':-500,'6300':1000,'6400':200,'6500':100,'6600':100,'6700':100,'6800':100,'1500':0,'8000':100};
const baseline={versionId:'budget-1',lines:periods.flatMap(period=>accounts.map(row=>({period,accountCode:row.accountCode,amount:values[row.accountCode]}))),leasing:periods.map(period=>({period,units:100,occupiedUnits:90,moveIns:10,moveOuts:2,marketRent:100}))};
const actuals={cutoffPeriod:'2026-07',closeVersions:[{period:'2026-07',versionId:'close-7'}],lines:baseline.lines.filter(row=>row.period==='2026-07').map(row=>({...row,amount:row.amount*1.1}))};
const input={communityId:'synthetic',periods,baseline,actuals,registry:{version:'mapping-1',accounts},scenario:{versionId:'scenario-1',driverVersion:'drivers-1',drivers:[]}};
const before=JSON.stringify(input),base=computeReforecast(input);
assert.equal(JSON.stringify(input),before);assert(Object.isFrozen(base.lines[0]));
assert.equal(base.status,'ready');assert.equal(base.monthly[1].actuals.revenue,null);assert.equal(base.monthly[0].reforecast.revenue,9350);
const cases=[['occupancy','occupancy_vacancy',.95,'5220',-500,'5120'],['concessions','percent_of_account',-.07,'5250',-700,'5120'],['inflation','percent_change',.06,'6500',106],['payroll','percent_change',.06,'6300',1060],['utilities','percent_change',.10,'6400',220],['insurance','percent_change',.2,'6600',120],['tax','percent_change',.08,'6700',108],['contracts','percent_change',.045,'6800',104.5],['capital','amount',0,'1500',0],['debt','add',20,'8000',120]];
for(const [type,operation,value,code,expected,baseAccountCode] of cases){
 const scenario={...input.scenario,versionId:type,driverVersion:type,drivers:[{id:type,type,operation,value,accountCodes:[code],periods:['2026-07','2026-09'],baseAccountCode}]};
 const result=computeReforecast({...input,scenario});
 assert.equal(result.lines.find(row=>row.period==='2026-09'&&row.accountCode===code).forecast,expected,type);
 for(const row of result.lines)if(row.period!=='2026-09'||row.accountCode!==code)assert.equal(row.forecast,base.lines.find(original=>original.period===row.period&&original.accountCode===row.accountCode).forecast,'unrelated account/period '+type);
 assert.notEqual(result.fingerprint,base.fingerprint);assert.equal(result.driverImpacts[0].skippedClosed.length,1);
}
let result=computeReforecast({...input,scenario:{...input.scenario,drivers:[{id:'unmapped',type:'unknown',operation:'percent_change',value:.1}]}});
assert.equal(result.status,'action_required');assert.equal(result.driverImpacts[0].status,'unavailable');
result=computeReforecast({...input,scenario:{...input.scenario,overrides:[{period:'2026-09',accountCode:'6300',amount:0,reason:'Explicit zero'},{period:'2026-07',accountCode:'6300',amount:99,reason:'Invalid historical override'}]}});
assert.equal(result.lines.find(row=>row.period==='2026-09'&&row.accountCode==='6300').forecast,0);assert.equal(result.lines.find(row=>row.period==='2026-07'&&row.accountCode==='6300').forecast,1100);
const missing=structuredClone(input);missing.baseline.lines.find(row=>row.period==='2026-09'&&row.accountCode==='6300').amount=null;
result=computeReforecast(missing);assert.equal(result.monthly[2].reforecast.opex,null);assert.equal(result.monthly[2].reforecast.noi,null);assert.equal(result.status,'action_required');
const controls=structuredClone(input);controls.actuals.lines=controls.actuals.lines.filter(row=>row.accountCode!=='1500');controls.actuals.monthly=[{period:'2026-07',closeVersionId:'close-7',source:'governed_close_controls',revenue:9350,opex:1870,noi:7480,margin:.8,cashFlow:7370}];
result=computeReforecast(controls);assert.equal(result.status,'ready');assert.equal(result.lines.find(row=>row.period==='2026-07'&&row.accountCode==='1500').actual,null);assert.equal(result.monthly[0].reforecast.noi,7480);assert(result.monthly[0].detailCoverage.includes('1500'));
const suggestion={id:'rec1',driver:{id:'rec-driver',type:'inflation',operation:'percent_change',value:.1,accountCodes:['6500'],periods:['2026-09']}};
const accepted=applyRecommendations(input.scenario,[suggestion],{ids:['rec1'],action:'accept',actor:'test',timestamp:'2026-09-23',versionId:'v2',driverVersion:'d2'});
assert.equal(input.scenario.drivers.length,0);assert.equal(accepted.drivers.length,1);assert.equal(computeReforecast({...input,scenario:accepted}).monthly[2].reforecast.opex,1610);
const undone=undoRecommendationAction(accepted,{actor:'test',timestamp:'2026-09-24',versionId:'v3',driverVersion:'d3'});assert.equal(undone.drivers.length,0);
// The shipped Doro source reproduces the defect before the bridge and must differentiate after it.
const html=fs.readFileSync('docs/portfolio-operations-dashboard/RISE-Budget-Builder.html','utf8');
const start=html.indexOf('var RBB ='),end=html.indexOf('})(RBB);',html.indexOf('R.buildState ='))+'})(RBB);'.length;
const context=vm.createContext({console,Date,Map,Set,window:{},setTimeout:()=>0});vm.runInContext(html.slice(start,end),context);
const R=context.RBB,state=R.buildState(),original=R.engine.computeProperty(state,'DORO','SC-APPROVED',2026),oldSlow=R.engine.computeProperty(state,'DORO','SC-SLOW',2026),oldFast=R.engine.computeProperty(state,'DORO','SC-FASTER',2026);
assert.equal(oldSlow.rollup.annual.noi,oldFast.rollup.annual.noi,'reproduce imported-line overlay bug');
const originalSerialized=JSON.stringify(state);installLegacyReforecastBridge(R);
const slow=R.engine.computeProperty(state,'DORO','SC-SLOW',2026),fast=R.engine.computeProperty(state,'DORO','SC-FASTER',2026),infl=R.engine.computeProperty(state,'DORO','SC-INFL',2026);
assert.equal(JSON.stringify(state),originalSerialized,'bridge never mutates approved workbook or local scenario');
assert.equal(R.engine.computeProperty(state,'DORO','SC-APPROVED',2026).rollup.annual.noi,original.rollup.annual.noi);
assert.notEqual(slow.rollup.annual.noi,fast.rollup.annual.noi);assert.notEqual(infl.rollup.annual.expense,original.rollup.annual.expense);
assert.equal(slow.rollup.annual.noi,slow.reforecastSnapshot.totals.reforecast.noi);
assert.notEqual(slow.reforecastSnapshot.fingerprint,fast.reforecastSnapshot.fingerprint);
console.log('PASS deterministic scenario fingerprints, one-driver account/period impact, immutable original/closed actuals, missing vs zero, canonical control/detail separation, acceptance/undo and real Doro overlay regression');

const rejected=applyRecommendations(input.scenario,[suggestion],{ids:['rec1'],action:'reject',actor:'test',timestamp:'2026-09-23',versionId:'v2',driverVersion:'d2'});assert.equal(rejected.suggestionDecisions[0].status,'rejected');assert.equal(rejected.drivers.length,0);const restored=undoRecommendationAction(rejected,{actor:'test',timestamp:'2026-09-24',versionId:'v3',driverVersion:'d3'});assert.deepEqual(restored.suggestionDecisions,[]);assert.equal(accepted.suggestionDecisions[0].status,'accepted');assert.deepEqual(undone.suggestionDecisions,[]);console.log('PASS explicit acceptance/rejection decision evidence and undo restore prior decisions as well as driver values');
