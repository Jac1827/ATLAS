const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir=__dirname+'/../docs/portfolio-operations-dashboard/';
const context={console,Date,URL,URLSearchParams,TextEncoder,structuredClone,setTimeout:()=>0,clearTimeout:()=>{},location:{search:'',href:'http://localhost/'},document:{addEventListener(){},querySelectorAll(){return []},getElementById(){return null}},localStorage:{getItem(){return null}},addEventListener(){},navigator:{}};context.window=context;context.parent=context;
vm.createContext(context);
const html=fs.readFileSync(dir+'RISE-Budget-Builder.html','utf8');
for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(m[1].trim()&&!m[1].includes('RBB.app.boot()'))vm.runInContext(m[1],context);}
vm.runInContext(fs.readFileSync(dir+'budget-mapped-import.js','utf8'),context);
vm.runInContext(fs.readFileSync(dir+'investor-budget-bridge.js','utf8'),context);

vm.runInContext(fs.readFileSync(dir+'budget-workbook-import.js','utf8'),context);
const R=context.RBB,M=R.importer,state=R.buildState();M.addCatalogProperties(state,['RISE 34th']);
const fixture=process.env.ATLAS_FISCAL_BUDGET_FIXTURE;
if(!fixture)throw new Error('Set ATLAS_FISCAL_BUDGET_FIXTURE to the RISE 34 FY 2025-2026 workbook');
const result=R.convert.convert(state,new Uint8Array(fs.readFileSync(fixture)),{fileName:'RISE 34 Budget 2025-2026 Final.xlsx',propertyMap:{'RISE 34':'atlas-RISE%2034th'}});
const glmap=M.validate('gl_map',M.parseCsv(R.convert.unknownCsv(result.unknown)),state);assert.equal(glmap.errors.length,0,JSON.stringify(glmap.errors));M.apply('gl_map',glmap,state);
const rows=M.parseCsv(result.built.csv);rows[0].push('effective_date');rows.slice(1).forEach(r=>r.push('2026-09-01'));
const beforeActuals=JSON.stringify(state.actuals);
const v=M.validate('approved_budget_periods',rows,state);v.fileName='RISE 34 Budget 2025-2026 Final.xlsx';v.sheetName=result.sheetName;v.sourceRows=result.sourceRows;assert.equal(v.errors.length,0,JSON.stringify(v.errors));
assert.equal(M.apply(v.type,v,state).applied,550);assert.equal(JSON.stringify(state.actuals),beforeActuals);
const report=R.investorSources(state).properties['RISE 34th'];
assert.equal(result.sheetName,'Monthly Budget Rpt');
assert.deepEqual(Array.from(result.built.years),[2025,2026]);assert.equal(result.reconciliation.clean,true);
const expected={'2025-08':163589.69067061902,'2025-09':234801.42790035956,'2025-10':233949.84629937098,'2025-11':229867.6447389974,'2025-12':245257.39058442006,'2026-01':234497.2078202534,'2026-02':221869.95570442002,'2026-03':235317.66119775336,'2026-04':236035.02536041202,'2026-05':233570.94245314138,'2026-06':240620.31565730803,'2026-07':209545.79691064137};
assert.deepEqual(Object.keys(report.periods).sort(),Object.keys(expected).sort());
for(const [period,noi] of Object.entries(expected)){assert(Math.abs(report.periods[period].noi.budget-noi)<0.05,period+' NOI must reconcile within line-level cent rounding');assert.match(report.periods[period].noi.sources.budget,/Monthly Budget Rpt/);}
assert.equal(report.periods['2026-09'],undefined);
assert.equal(state.approvedBudgetImports['atlas-RISE%2034th|2025'].rows.find(r=>r.gl==='5120').monthly[7],446628);
assert.deepEqual(Array.from(state.approvedBudgetImports['atlas-RISE%2034th|2025'].coverage),[7,8,9,10,11]);
assert.equal(M.apply(v.type,v,state).applied,0,'same version cannot overwrite');
const missing=rows.map(r=>r.slice());missing[1][missing[0].indexOf('aug')]='';assert(M.validate(v.type,missing,state).errors.length);
const invalid=rows.map(r=>r.slice());invalid[1][invalid[0].indexOf('effective_date')]='2026-02-30';assert(M.validate(v.type,invalid,state).errors.length);
const restored=JSON.parse(JSON.stringify(R.persist.serialize(state,{}))).state;
assert.equal(R.investorSources(restored).properties['RISE 34th'].periods['2025-08'].noi.budget,report.periods['2025-08'].noi.budget);
const code=fs.readFileSync(dir+'atlas-mounts.js','utf8');const publish=code.slice(code.indexOf('  function publishBudgetToAtlas('),code.indexOf('  function publishBudgetContractToAtlas('));
const pc={console,Date,savedData:{'RISE 34th':{}},matchPropertyName:n=>n==='RISE 34th'?n:null,persistSaved(){},syncSharedPropertyFromPortfolioRecord(){}};vm.createContext(pc);vm.runInContext(publish,pc);
for(const snapshot of Object.values(state.approvedBudgetImports)){
 const periods=Object.fromEntries(snapshot.coverage.map(m=>[snapshot.year+'-'+String(m+1).padStart(2,'0'),snapshot.rows.map(r=>({gl:r.gl,budget:r.monthly[m],nature:R.glIndex[r.gl].nature}))]));
 const packet={locked:true,property:{name:'RISE 34th'},year:snapshot.year,effectiveDate:snapshot.effectiveDate,coverage:snapshot.coverage,periodVersions:snapshot.periodVersions,scenario:{id:'approved',name:'Approved'},budgetByPeriod:periods,investorPacketSources:report};
 assert.equal(pc.publishBudgetToAtlas(packet).ok,true);
 assert.equal(pc.publishBudgetToAtlas(packet).ok,true,'retry is idempotent');
 const bad=structuredClone(packet);bad.budgetByPeriod[Object.keys(periods)[0]][0].budget++;assert.equal(pc.publishBudgetToAtlas(bad).ok,false);
}
assert.equal(Object.keys(pc.savedData['RISE 34th'].financialBudgetLedger).filter(k=>/^20\d{2}-\d{2}$/.test(k)).length,12);
console.log('PASS actual RISE 34 workbook: approved worksheet, fiscal periods, 12 monthly NOI ties, missing months, version precedence, saved reload and ATLAS publication');
// Month-only approvals preserve the precision supplied by the owner.
const monthlyState=R.buildState();M.addCatalogProperties(monthlyState,['RISE 34th']);
const monthRows=rows.map(r=>r.slice());monthRows.slice(1).forEach(r=>r[r.length-1]='2025-07');
let mv=M.validate('approved_budget_periods',monthRows,monthlyState);mv.fileName=v.fileName;mv.sheetName=v.sheetName;
assert.equal(mv.errors.length,0,JSON.stringify(mv.errors.slice(0,3)));assert.equal(M.apply(mv.type,mv,monthlyState).applied,550);
let current=monthlyState.currentApprovedBudgets['atlas-RISE%2034th'];
assert.equal(current.approval,'2025-07');assert.equal(current.approvalPrecision,'month');assert.equal(current.startPeriod,'2025-08');assert.equal(current.endPeriod,'2026-07');
assert.equal(current.status,'current');assert.equal(R.investorSources(monthlyState).properties['RISE 34th'].periods['2026-09'],undefined);
const nextRows=monthRows.map(r=>r.slice());nextRows.slice(1).forEach(r=>{r[2]=Number(r[2])+1;r[r.length-1]='2026-07';});
let nv=M.validate('approved_budget_periods',nextRows,monthlyState);nv.fileName='replacement.xlsx';nv.sheetName=v.sheetName;
assert.equal(nv.errors.length,0);assert.equal(M.apply(nv.type,nv,monthlyState).applied,550);
assert.equal(monthlyState.currentApprovedBudgets['atlas-RISE%2034th'].endPeriod,'2027-07');
assert.equal(monthlyState.approvedBudgetImports['atlas-RISE%2034th|2025'].effectiveDate,'2025-07');
console.log('PASS month-precision approval, retained current fiscal budget and replacement without rewriting historical periods');
