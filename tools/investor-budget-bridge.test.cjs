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
const properties=Object.keys(payload.investorPacketSources.properties);assert(properties.length>0);
const p=payload.investorPacketSources.properties[properties[0]].periods;
assert.equal(Object.keys(p).length,12);
assert.equal(p['2026-01'].revenue.actual,null,'Missing actuals must remain missing');
assert(Number.isFinite(p['2026-01'].revenue.budget));
assert.equal(p['2026-01'].noi.budget,p['2026-01'].revenue.budget-p['2026-01'].expenses.budget);
console.log('PASS actual Budget Builder engine: read-only bridge, twelve exact periods, budget reconciliation and missing actuals. Property:',properties[0]);
