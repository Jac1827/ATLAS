const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const dir=__dirname+'/../docs/portfolio-operations-dashboard/';
const context={console,Date,URL,URLSearchParams,TextEncoder,structuredClone,setTimeout:()=>0,clearTimeout:()=>{},location:{search:'',href:'http://localhost/'},document:{addEventListener(){},querySelectorAll(){return []},getElementById(){return null}},localStorage:{getItem(){return null}},addEventListener(){},navigator:{}};context.window=context;context.parent=context;
vm.createContext(context);
const html=fs.readFileSync(dir+'RISE-Budget-Builder.html','utf8');
for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(m[1].trim()&&!m[1].includes('RBB.app.boot()'))vm.runInContext(m[1],context);}
vm.runInContext(fs.readFileSync(dir+'budget-mapped-import.js','utf8'),context);
vm.runInContext(fs.readFileSync(dir+'investor-budget-bridge.js','utf8'),context);

vm.runInContext(fs.readFileSync(dir+'budget-workbook-import.js','utf8'),context);
const R=context.RBB,M=R.importer,state=R.buildState();M.addCatalogProperties(state,['RISE Doro']);
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const headers=['Account','Account Name',...months.map(m=>m+' YR 1'),'Total',...months.map(m=>m+' YR 2'),'Total'];
const values=['5120','Gross Potential Rent',...months.map((_,i)=>i===0?0:i*10),660,...months.map((_,i)=>i===0?-2:i*20),1318];
const rows=[['RISE Doro'],[],['Monthly Budget Detail'],['FY 2026-2027'],[],[],headers,values];
const parse=data=>{R.xlsx.read=()=>({kind:'xlsx',sheets:[{name:'Monthly Budget Rpt',rows:data},{name:'Import Sheet',rows:[['January 2022'],['5120',999999]]}]});return R.convert.convert(state,new Uint8Array(),{fileName:'approved-two-year.xlsx'});};
let result=parse(rows);
assert.equal(result.ok,true);assert.equal(result.built.accountRows,2);assert.equal(result.sheets[0].months,24);
assert.deepEqual(Array.from(result.built.years),[2026,2027]);assert.equal(result.built.rows[0].months[0],0);assert.equal(result.built.rows[1].months[0],-2);
assert.equal(result.sourceRows['5120'][0],8);assert.equal(result.built.rows[1].months[11],220);
const validate=result=>{const csv=M.parseCsv(result.built.csv);csv[0].push('effective_date');csv.slice(1).forEach(r=>r.push('2026-01-01'));return M.validate('approved_budget_periods',csv,state);};
assert.equal(validate(result).errors.length,0);
let broken=structuredClone(rows);broken[7][2]=null;result=parse(broken);assert.equal(result.ok,false,'an entirely missing source month cannot be silently dropped');
broken.push(['5125','Gain loss',...months.map(()=>0),0,...months.map(()=>0),0]);result=parse(broken);assert.equal(result.ok,true);assert(validate(result).errors.some(e=>/missing amount/.test(e.message)),'a blank account within a covered month cannot become zero');
broken=structuredClone(rows);broken[6][3]='Jan YR 1';assert.equal(parse(broken).ok,false,'duplicate month rejected');
broken=structuredClone(rows);broken[6][3]='Feb';assert.equal(parse(broken).ok,false,'mixed year labels rejected');
broken=structuredClone(rows);broken[3][0]='FY 2026-2028';assert.equal(parse(broken).ok,false,'nonconsecutive year blocks rejected');
// The original twelve-month August-to-July layout remains supported.
const fiscal=[['RISE Doro'],[],[],['FY 2025-2026'],[],[],['Account','Account Name',...months.slice(7),...months.slice(0,7)],['5120','Gross Potential Rent',...months.map(()=>10)]];
result=parse(fiscal);assert.equal(result.ok,true);assert.equal(result.built.months.length,12);assert.deepEqual(Array.from(result.built.years),[2025,2026]);
console.log('PASS two-year budget headers, exact years, zero and signed values, missing source rejection, historical-sheet exclusion and fiscal-layout compatibility');
