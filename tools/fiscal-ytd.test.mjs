import assert from 'node:assert/strict';
import {fiscalPeriods,fiscalLine} from '../docs/portfolio-operations-dashboard/features/fiscal-ytd.mjs';
const p=fiscalPeriods(2026,2,'Jul');assert.equal(p.length,9);assert.equal(p[0].period,'2025-07');assert.equal(p.at(-1).period,'2026-03');
assert.equal(fiscalPeriods(2026,6,'Jul').length,1);assert.equal(fiscalPeriods(2026,5,'Jul').length,12);assert.equal(fiscalPeriods(2026,0,'Jan').length,1);
assert.throws(()=>fiscalPeriods(2026,0,'Unknown'));
const state={approvedBudgetImports:{},periods:{}};
for(const y of [2025,2026]){state.approvedBudgetImports['A|'+y]={sourceFile:`${y}.xlsx`,effectiveDate:`${y}-01-01`,rows:[{gl:'5120',monthly:Array(12).fill(100)}]};state.periods['A|'+y]={source:'actuals.xlsx',loadedAt:'2026-04-01',closedThrough:y===2025?12:3};}
const actual=()=>Array(12).fill(90);
let result=fiscalLine(state,'A','5120',p,actual);assert.equal(result.ytdActual,810);assert.equal(result.ytdBudget,900);
result=fiscalLine(state,'A','5120',p,()=>Array(12).fill(0));assert.equal(result.ytdActual,0);
state.periods['A|2025'].closedThrough=11;result=fiscalLine(state,'A','5120',p,actual);assert.equal(result.ytdActual,null);assert.equal(result.ytdBudget,900);
state.approvedBudgetImports['A|2025'].rows.push({gl:'5120',monthly:Array(12).fill(100)});assert.equal(fiscalLine(state,'A','5120',p,actual).ytdBudget,null);
delete state.approvedBudgetImports['A|2025'];assert.equal(fiscalLine(state,'A','5120',p,actual).ytdBudget,null);
assert.equal(fiscalLine(state,'B','5120',p,actual).ytdActual,null);
console.log('PASS cross-year fiscal boundaries, full coverage, explicit zero, duplicate/missing source and property scope');
