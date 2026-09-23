const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir=__dirname+'/../docs/portfolio-operations-dashboard/';
const context={console,Date,URL,URLSearchParams,TextEncoder,structuredClone,setTimeout:()=>0,clearTimeout:()=>{},location:{search:'',href:'http://localhost/'},document:{addEventListener(){},querySelectorAll(){return []},getElementById(){return null}},localStorage:{getItem(){return null}},addEventListener(){},navigator:{}};context.window=context;
vm.createContext(context);
const html=fs.readFileSync(dir+'RISE-Budget-Builder.html','utf8');
for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(m[1].trim()&&!m[1].includes('RBB.app.boot()'))vm.runInContext(m[1],context);}
vm.runInContext(fs.readFileSync(dir+'investor-budget-bridge.js','utf8'),context);
const R=context.RBB,state=R.buildState();const before=JSON.stringify(state);
const payload=R.persist.serialize(state,{});
assert.equal(JSON.stringify(state),before,'Bridge changes source state');
assert(!payload.investorPacketSourceError,payload.investorPacketSourceError);
payload.investorPacketSources=R.investorSources(state,payload.savedAt);
const properties=Object.keys(payload.investorPacketSources.properties);assert(properties.length>0);
const p=payload.investorPacketSources.properties[properties[0]].periods;
assert.equal(Object.keys(p).filter(k=>k.startsWith('2026-')).length,12);
assert.equal(p['2026-01'].revenue.actual,undefined,'Missing actuals must remain missing');
assert(Number.isFinite(p['2026-01'].revenue.budget));
assert.equal(p['2026-01'].noi.budget,p['2026-01'].revenue.budget-p['2026-01'].expenses.budget);
console.log('PASS actual Budget Builder engine: read-only bridge, twelve exact periods, budget reconciliation and missing actuals. Property:',properties[0]);
const property=state.properties[0],approved=state.scenarios.find(s=>s.type==='approved'&&s.locked);
const vr=R.variance.compute(state,R.engine.computeAll(state,approved.id,2026),property.id,2026);
const payroll=vr.rows.filter(r=>r.coaGroup==='PAYROLL & RELATED EXPENSES').reduce((sum,r)=>sum+r.budget[0],0);
assert.equal(p['2026-01'].payroll.budget,payroll,'Payroll must match exact COA group');
assert(p['2026-01'].payroll.sources.budget.includes('GL')||p['2026-01'].payroll.sources.budget.includes('6330'));
for(const row of vr.rows)R.actuals.set(state,property.id,row.gl,2026,Array.from(row.budget),'fixture actuals.xlsx');
R.actuals.setClosedThrough(state,property.id,2026,1,'fixture actuals.xlsx');
const sourceBefore=JSON.stringify(state),filled=R.investorSources(state,'2026-02-10T00:00:00Z').properties[property.name].periods;
assert.equal(JSON.stringify(state),sourceBefore,'Expanded bridge must not change inputs');
assert.equal(filled['2026-01'].payroll.actual,payroll);
assert.equal(filled['2026-02'].payroll?.actual,undefined,'Unclosed future actuals must remain missing');
assert.equal(filled['2026-01'].noi.actual,filled['2026-01'].revenue.actual-filled['2026-01'].expenses.actual);
assert(filled['2026-01'].financialDetail.length>0);
assert(filled['2026-01'].vacancyLoss.actual>=0,'Contra-income losses are displayed with positive loss sign');
console.log('PASS detailed COA categories, period-specific sources, closed actuals and calculation invariance.');
if(process.env.ATLAS_TEST_BUDGET_OUT){state.properties[0].name='SYNTHETIC TEST COMMUNITY';fs.writeFileSync(process.env.ATLAS_TEST_BUDGET_OUT,JSON.stringify(R.persist.serialize(state,{})));}

const localForecast=state.scenarios.find(s=>s.type==='reforecast');
if(localForecast){
 state.activeScenario=localForecast.id;
 const standalone=R.investorSources(state,'2026-02-10T00:00:00Z',{names:[property.name]}).properties[property.name].periods['2026-02'];
 assert.equal(standalone.noi.forecastBasis.kind,'legacy_full_year');assert.equal(standalone.noi.forecastBasis.year,2026);
 context.parent={ATLAS_CENTRAL:{}};
 const governed=R.investorSources(state,'2026-02-10T00:00:00Z',{names:[property.name]}).properties[property.name].periods['2026-02'];
 assert.equal(governed.noi.forecast,undefined,'A local reforecast cannot become a canonical investor forecast');
}
