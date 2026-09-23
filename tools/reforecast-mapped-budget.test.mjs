import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {installLegacyReforecastBridge,legacyScenarioDraftInput,bridgeLegacyScenario} from '../docs/portfolio-operations-dashboard/features/reforecast-legacy-bridge.mjs';
const dir='docs/portfolio-operations-dashboard/';
const context={console,Date,URL,URLSearchParams,TextEncoder,structuredClone,setTimeout:()=>0,clearTimeout(){},location:{search:'',href:'http://localhost/',origin:'http://localhost'},document:{addEventListener(){},querySelectorAll(){return[];},getElementById(){return null;}},localStorage:{getItem(){return null;}},addEventListener(){},navigator:{}};context.window=context;context.parent=context;
vm.createContext(context);
for(const match of fs.readFileSync(dir+'RISE-Budget-Builder.html','utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim()&&!match[1].includes('RBB.app.boot()'))vm.runInContext(match[1],context);
const R=context.RBB,state=R.buildState(),pid='DORO',year=2026,approved=state.scenarios.find(row=>row.type==='approved'&&row.locked),original=R.engine.computeProperty(state,pid,approved.id,year);
// The actual mapped-import adapter reshapes approved workbook rows into manual /
// fixed engine lines, unlike the bundled seed's method:'imported' representation.
vm.runInContext(fs.readFileSync(dir+'budget-mapped-import.js','utf8'),context);
const aggregate=new Map();for(const result of Object.values(original.results)){const code=String(result.line.gl),row=aggregate.get(code)||{property:pid,gl:code,gl_name:R.gl(code).name,year:String(year),effective_date:'2026-01-01',__monthly:Array(12).fill(0),__row:aggregate.size+2};result.monthly.forEach((value,m)=>row.__monthly[m]+=Math.round(value*1.17*100)/100);aggregate.set(code,row);}
const applied=R.importer.apply('approved_budget',{accepted:[...aggregate.values()],errors:[],fileName:'Doro approved 2026.xlsx',sheetName:'Budget',headerRow:1},state);assert.equal(applied.applied,aggregate.size);
const mapped=R.engine.computeProperty(state,pid,approved.id,year);assert(Object.values(mapped.results).every(r=>r.line.method==='manual'&&r.line.behavior==='fixed'&&r.line.importedMonthly.length===12));assert.notEqual(mapped.rollup.annual.noi,original.rollup.annual.noi);
const sourceBefore=JSON.stringify(state);installLegacyReforecastBridge(R);
const slower=R.engine.computeProperty(state,pid,'SC-SLOW',year),faster=R.engine.computeProperty(state,pid,'SC-FASTER',year),inflation=R.engine.computeProperty(state,pid,'SC-INFL',year),aggressive=R.engine.computeProperty(state,pid,'SC-REFORECAST',year);
assert.equal(JSON.stringify(state),sourceBefore,'Scenario calculations never rewrite workbook or approved budget');assert.equal(R.engine.computeProperty(state,pid,approved.id,year).rollup.annual.noi,mapped.rollup.annual.noi);
assert.notEqual(slower.rollup.annual.noi,faster.rollup.annual.noi,'Mapped 2026 approved baseline must respond to occupancy scenarios');assert.notEqual(inflation.rollup.annual.expense,mapped.rollup.annual.expense,'Mapped fixed OPEX must respond to reviewed inflation classifications');
const impacts=inflation.reforecastSnapshot.driverImpacts;for(const name of ['payroll_increase','utility_rate_increase','inflation_general','contract_escalation','insurance_increase','re_tax_increase']){const impact=impacts.find(row=>row.type===name);assert(impact,name+' driver exists');assert(impact.changed.length>0,name+' mapped accounts change');}
const drivers=legacyScenarioDraftInput({R,state,propertyId:pid,year,scenario:inflation.scenario,baselineCalc:mapped,scenarioCalc:inflation}).scenario.drivers;
const targets=key=>drivers.find(row=>row.type===key)?.accountCodes||[];assert(targets('contract_escalation').every(code=>R.gl(code).group==='CONTRACT SERVICES'));for(const special of ['payroll_increase','utility_rate_increase','contract_escalation','insurance_increase','re_tax_increase'])assert(targets('inflation_general').every(code=>!targets(special).includes(code)),'General inflation must not double-apply '+special);
for(const calc of [slower,faster,inflation,aggressive]){assert.equal(calc.rollup.annual.noi,calc.reforecastSnapshot.totals.reforecast.noi);assert.deepEqual(Array.from(calc.rollup.noi),calc.reforecastSnapshot.monthly.map(month=>month.reforecast.noi));}
const all=R.engine.computeAll(state,'SC-INFL',year);assert.equal(all.byProperty[pid].rollup.annual.noi,inflation.rollup.annual.noi);
const options={R,state,propertyId:pid,year,scenario:inflation.scenario,baselineCalc:mapped,scenarioCalc:inflation};
const canonical=legacyScenarioDraftInput(options),firstSources={...canonical,sourceVersion:'source-1'};
const cached=bridgeLegacyScenario({...options,sources:firstSources});
const nextVersion=bridgeLegacyScenario({...options,sources:{...firstSources,sourceVersion:'source-2'}});assert.notEqual(nextVersion,cached,'Canonical source version changes invalidate the cached snapshot');
const revisedLeasing=structuredClone(canonical.baseline);revisedLeasing.leasing[0].units+=1;
const inventoryChanged=bridgeLegacyScenario({...options,sources:{...firstSources,baseline:revisedLeasing}});assert.equal(inventoryChanged.leasing[0].units,cached.leasing[0].units+1,'Updated unit inventory cannot reuse cached leasing under an unchanged budget version');
console.log('PASS actual mapped-workbook import adapter regression: manual fixed approved rows retain imported GL evidence, distinct occupancy / OPEX / inflation scenarios, exact contract and specialist mappings, no double inflation, immutable baseline and consistent snapshot rollups.');
