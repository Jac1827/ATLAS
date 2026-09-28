// Synthetic evidence follows the printed statement structure, never production values.
import assert from 'node:assert/strict';
import test from 'node:test';
import {parseComparisonLines,reconcileComparison,evaluateFinancialPackageSafety} from '../docs/portfolio-operations-dashboard/features/financial-package.mjs';

const hash='a'.repeat(64);
const money=value=>value<0?'('+(-value).toFixed(2)+')':value.toFixed(2);
const line=(label,value)=>label+'  '+[money(value),money(value),'0.00','0.00%',money(value*2),money(value*2),'0.00','0.00%',money(value*12)].join('  ');
const header=(page,{property='Synthetic Commons',period='Jun 2028',ytd='Jan 2028 - Jun 2028'}={})=>[
 'RISE - Budget Comparison - Income Statement',...(page===1?[property,period,'Accrual Basis']:[]),
 'Property: '+property,period+'  YTD ( '+ytd+' )',
 'Account  Account Name  Actual  Budget  $ Variance  % Variance  Actual  Budget  $ Variance  % Variance  Annual Budget'
];
const footer=page=>'Income Statement - Budget vs Actual 3.5 generated 07/12/2028 01:15 PM MDT and data as of 07/12/2028 01:15 PM MDT  Page '+page+' of 3';
function source(){return [
 [...header(1),'Income','Rental Income',line('5120 Gross Potential Rent (GPR)',1000),line('5125 Gain/Loss to Lease',-100),'Cost Of Leasing',line('5220 Rent Loss-Vacancy',-200),line('Total Cost Of Leasing',-200),line('Net Rental Income',700),'Other Income',line('5910 Service Income',20),line('Total Other Income',20),line('Total Income',720),'Controllable Expenses','Payroll Office',line('6330 General Manager',40),footer(1)].join('\n'),
 [...header(2),line('6335 Leasing Salaries',10),line('Total Payroll Office',50),'Payroll Maintenance',line('6510 Maintenance Salaries',20),line('Total Payroll Maintenance',20),'Payroll Related Expenses',line('6108 Payroll Fees',5),line('Total Payroll Related Expenses',5),line('Total Payroll',75),'Contract Services',line('6520 Pool Contract',10),line('6522 Exterminating Contract',-2),line('Contract Services',8),'Common Area Utilities',line('6450 C/A Electricity',3),footer(2)].join('\n'),
 [...header(3),line('6451 C/A Water & Sewer',2),line('Total Common Area Utilities',5),'Unit Utilities',line('6460 Electricity Vacant Units',4),line('Total Unit Utilities',4),line('Total Utilities',9),line('Total Controllable Expenses',92),line('Controllable Cash Flow',628),'Taxes & Insurance',line('6710 Property Taxes',6),line('Total Taxes & Insurance',6),line('Net Operating Income',622),'Other Finance Related',line('6888 Ground Rent',7),line('Total Other Finance Related',7),line('Total Non-Controllable Expenses',7),line('Cash Flow Before Debt Service',615),'Debt Service',line('6820 Interest Expense',30),line('Total Debt Service',30),line('Cash Flow After Debt Service',585),'Extraordinary Expense',line('7200 Extraordinary Expense',2),line('Total Extraordinary Expense',2),line('Cash Flow Before Deprec/Amort',583),'Depreciation/Amortization',line('8000 Depreciation - FF&E',40),line('Total Depreciation/Amortization',40),'Other Expenses',line('8515 Other Professional Fees',3),line('Total Other Expenses',3),line('Cash Flow After Deprec/Amort and Other Exp.',540),'Reserves - Net Cash Flow',line('1320 Replacement Reserve Fund',4),line('Reserves - Net Cash Flow',4),'Capital Expenditures - Net Cash Flows',line('1511 Equipment',8),line('Capital Expenditures - Net Cash Flows',8),line('Net Cash Flow',528),footer(3)].join('\n')
];}
const parts=(pages=source())=>pages.map((text,i)=>parseComparisonLines(text,{page:i+3,method:'native',sourceHash:hash}));
const certificate=(pages=source())=>reconcileComparison(parts(pages));
const expectBlocked=c=>assert.equal(c.technicalReconciled,false,JSON.stringify(c.exceptions));

test('PDF rollups retain cross-page leaves, bounded composites, signed credits and every cash-flow stage',()=>{
 const pages=source(),c=certificate(pages);assert.equal(c.technicalReconciled,true,JSON.stringify(c.exceptions));assert.equal(c.safeToImport,false,'arithmetic success never confirms accounting close or property approval');
 assert.equal(c.intakeEvidence.rowInventory.length,pages.flatMap(p=>p.split('\n')).filter(Boolean).length);
 assert.equal(c.intakeEvidence.inventoryCounts.unresolved,0);
 for(const [label,value]of [['Total Payroll Office',50],['Total Payroll',75],['Contract Services',8],['Total Common Area Utilities',5],['Total Utilities',9],['Total Controllable Expenses',92],['Controllable Cash Flow',628],['Net Operating Income',622],['Total Non-Controllable Expenses',7],['Cash Flow Before Debt Service',615],['Cash Flow After Debt Service',585],['Cash Flow Before Deprec/Amort',583],['Cash Flow After Deprec/Amort and Other Exp.',540],['Reserves - Net Cash Flow',4],['Capital Expenditures - Net Cash Flows',8],['Net Cash Flow',528]]){
  for(const [field,multiplier]of [['actual',1],['budget',1],['ytdActual',2],['ytdBudget',2],['annualBudget',12]]){const check=c.checks.find(r=>r.label===label&&r.field===field);assert.ok(check,label+' '+field+' retained');assert.equal(check.calculated,value*multiplier,label+' '+field);assert.equal(check.passed,true,label+' '+field);assert.equal(check.tolerance,0.01);}
 }
 const net=c.intakeEvidence.hierarchy.find(r=>r.label==='Net Cash Flow');assert.equal(Object.keys(net.factors).length,new Set(net.childRowIds).size);assert.ok(Object.values(net.factors).every(f=>f===1||f===-1));
 for(const gl of ['8000','8515','1320','1511'])assert.equal(net.factors[c.rows.find(r=>r.glCode===gl).source.rowId],-1,'cash flow subtracts printed expense/capital '+gl);
 assert.equal(c.rows.find(r=>r.glCode==='6522').values.actual,-2,'expense credit remains signed');
});

test('unknown numeric rows and missing actuals remain inventoried and blocking',()=>{
 for(const label of ['Unmapped Payment','Total Unheaded Group']){const p=source();p[1]=p[1].replace('Common Area Utilities',line(label,99)+'\nCommon Area Utilities');const c=certificate(p);expectBlocked(c);assert.ok(c.intakeEvidence.rowInventory.some(r=>r.normalizedLabel===label),'nonblank source retained');}
 const p=source();p[1]=p[1].replace(line('6520 Pool Contract',10),'6520 Pool Contract  —  10.00  0.00  0.00%  20.00  20.00  0.00  0.00%  120.00');const c=certificate(p);expectBlocked(c);assert.equal(c.rows.find(r=>r.glCode==='6520').values.actual,null,'missing actual never becomes zero');
});

test('one-cent tolerance is unchanged and mismatching printed totals cannot select different signs',()=>{
 const p=source();p[1]=p[1].replace(line('Contract Services',8),line('Contract Services',8.02));expectBlocked(certificate(p));
 const signs=source();signs[1]=signs[1].replace(line('Contract Services',8),line('Contract Services',12));expectBlocked(certificate(signs));
 const c=certificate();const changed=structuredClone(c);changed.rows.find(r=>r.glCode==='6522').values.actual=2;assert.equal(evaluateFinancialPackageSafety(changed).technicalReconciled,false,'stale positive evidence cannot hide changed credit');
});

test('property, period and YTD mismatches cannot stitch separate reports into one hierarchy',()=>{
 for(const [before,after]of [['Synthetic Commons','Different Community'],['Jun 2028','Jul 2028'],['Jan 2028 - Jun 2028','Aug 2027 - Jun 2028']]){const p=source();p[1]=p[1].replaceAll(before,after);expectBlocked(certificate(p));}
 const duplicate=source();duplicate[1]=duplicate[1].replace(line('6335 Leasing Salaries',10),line('6330 General Manager',10));const c=certificate(duplicate);expectBlocked(c);assert.ok(c.exceptions.some(e=>e.code==='duplicate_gl'));
});

test('missing source pages, inventory row loss and source-value tampering do not pass reconciliation',()=>{
 const omitted=source();omitted.splice(1,1);expectBlocked(certificate(omitted));
 const lost=parts();lost[1].rows.splice(lost[1].rows.findIndex(r=>r.glCode==='6522'),1);expectBlocked(reconcileComparison(lost));
 const changed=parts();changed[1].rows.find(r=>r.glCode==='6522').values.actual=-1;const c=reconcileComparison(changed);expectBlocked(c);assert.ok(c.exceptions.some(e=>e.code==='source_value_changed'));
});

test('pagination rejects reordering, duplicates and missing footers even when financial rows are unchanged',()=>{
 for(const change of [p=>[p[0],p[2],p[1]],p=>[p[0],p[1],p[1],p[2]],p=>[p[0],p[1].replace(footer(2),''),p[2]],p=>[p[0],p[1].replace('Page 2 of 3','Page 2 of 4'),p[2]]]){
  const c=certificate(change(source()));expectBlocked(c);assert.ok(c.exceptions.some(e=>e.code==='incomplete_statement_pages'),'printed page sequence independently checked');
 }
});

test('a bare repeated numeric label is never promoted without its exact source heading',()=>{
 const p=source();p[1]=p[1].replace('\nContract Services\n','\nDifferent Section\n');const c=certificate(p);expectBlocked(c);assert.equal(c.intakeEvidence.rowInventory.find(r=>r.normalizedLabel==='Contract Services').disposition,'unresolved');
});

test('legitimate all-blank PDF GL lines remain missing and do not block or become section boundaries',()=>{
 for(const blank of ['6462 Gas','6462 Gas  —  —  —  —  —  —  —  —  —']){
  const p=source();p[2]=p[2].replace('Unit Utilities',''+blank+'\nUnit Utilities');const c=certificate(p),row=c.intakeEvidence.rowInventory.find(r=>r.glCode==='6462');assert.ok(row);assert.equal(row.actual.value,null);assert.equal(row.disposition,'supporting');assert.equal(row.sectionBoundary,false);assert.equal(c.rows.some(r=>r.glCode==='6462'),false);assert.equal(c.technicalReconciled,true,JSON.stringify(c.exceptions));
 }
});

test('unsupported integer or nonstandard precision financial tokens cannot masquerade as blank rows or headings',()=>{
 for(const raw of ['Unknown amount  123','6462 Gas  123','Unknown Amount  123  123  0  0%  246  246  0  0%  1476','6462 Gas  123  123  0  0%  246  246  0  0%  1476','6462 Gas  1.2','Unknown amount  1.234']){
  const p=source();p[2]=p[2].replace('Unit Utilities',raw+'\nUnit Utilities');const c=certificate(p);expectBlocked(c);const row=c.intakeEvidence.rowInventory.find(r=>r.rawText===raw);assert.ok(row,'raw nonblank evidence retained');assert.equal(row.disposition,'unresolved');assert.equal(row.actual.value,null,'unsupported number never guessed or converted to zero');
 }
});

test('parent totals cannot omit an uncovered zero-valued posting between their child sections',()=>{
 const p=source();p[1]=p[1].replace('Payroll Related Expenses',line('6999 Unclassified Expense',0)+'\nPayroll Related Expenses');const c=certificate(p);expectBlocked(c);assert.ok(c.rows.some(r=>r.glCode==='6999'&&r.values.actual===0),'explicit zero leaf retained');assert.ok(c.exceptions.some(e=>e.code==='unresolved_rollup'&&e.description.startsWith('Total Payroll:')),'complete child coverage is checked independently of amount');
});
