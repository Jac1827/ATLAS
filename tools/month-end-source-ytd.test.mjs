import assert from 'node:assert/strict';
import {monthEndReviewHtml} from '../docs/portfolio-operations-dashboard/features/month-end-governance.mjs';
const base={periods:['2026-01','2026-08'],period:'2026-08',calendar:{classification:'Multifamily'},blockers:[],rows:[{glCode:'6120',category:'Maintenance',actual:null,budget:100,percentageVariance:null}],expenseActual:2500,expenseBudget:7000};
const html=monthEndReviewHtml({...base,actualBasis:'accounting_source_fiscal_ytd',baselineCoverage:{complete:true,intentionalBlankCellCount:1}});
assert.match(html,/reconciled Accounting package’s fiscal YTD column/);assert.match(html,/Monthly close coverage is unchanged/);assert.match(html,/1 approved blank cells remain blank; they are not zeros/);assert.match(html,/Blank \/ unavailable/);assert(!html.includes('$0.00'));
assert(!monthEndReviewHtml(base).includes('data-baseline-blank-coverage'),'Legacy records do not invent blank coverage');
console.log('PASS Accounting source-YTD and approved blank baseline disclosure with unavailable per-GL actuals preserved.');
