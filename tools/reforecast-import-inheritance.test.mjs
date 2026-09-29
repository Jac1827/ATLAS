import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {reviewReforecastImportInheritance} from '../docs/portfolio-operations-dashboard/features/reforecast-import-inheritance.mjs';
import {evaluateReforecastImportReview,reforecastImportReconciliation,mergeReforecastImportIntoDraft} from '../docs/portfolio-operations-dashboard/features/reforecast-import-ui.mjs';
import {reviewPlanningInputs} from '../docs/portfolio-operations-dashboard/features/planning-governance.mjs';

const cid='10000000-0000-0000-0000-000000000001',period='2026-09',actor='00000000-0000-0000-0000-000000000001';
const row=(code,index,amount)=>({id:`Input!A${index}`,sheet:'Input',address:`A${index}`,accountCode:code,period,scenario:'Plan',amount,blank:amount===null,department:null,sourceKind:'workbook_forecast_evidence'});
const imported=[row('4000',1,123.25),row('4001',2,0)];
// Generic many-cell regression: no production amounts or GLs in the algorithm.
const missing=Array.from({length:20},(_,index)=>row(String(4100+index),index+3,null));
const evidence={source:{sha256:'a'.repeat(64)},parserVersion:'test',metadata:{entities:[]},issues:[],sheets:[],integrity:{fingerprint:'b'.repeat(64),inventory:{sheets:[]},findings:[]},lines:[...imported,...missing]};
const accounts=evidence.lines.map(line=>({accountCode:line.accountCode,name:line.accountCode,nature:'income',category:'Rent',placement:'above_noi',effectiveFrom:'2026-01'}));
accounts.push({accountCode:'4900',nature:'expense',category:'Other',placement:'above_noi'});
const source={registry:{version:'reviewed-registry',accounts},actuals:{cutoffPeriod:'2026-08'},baseline:{lines:[...imported.map(line=>({period,accountCode:line.accountCode,amount:900})),...missing.map((line,index)=>({period,accountCode:line.accountCode,amount:index<18?index+1:0})),{period,accountCode:'4900',amount:0}]}};
const assignment={communityId:cid,confirmed:true,explicit:true,actorId:actor,assignedAt:'2026-09-28T12:00:00Z',reason:'Review synthetic community',sourceEntities:[]};
const input={evidence,source,assignment,scenario:'Plan',currency:'USD',periods:[period],destination:'new',confirmed:true,reason:'Reviewed exact workbook scope',selectedLineIds:imported.map(line=>line.id),accountChoices:Object.fromEntries(imported.map(line=>[JSON.stringify([line.sheet,line.accountCode,line.department]),{accountCode:line.accountCode,signMultiplier:1}])),calendar:{basis:'calendar',startMonth:1,confirmed:true,periods:[period],scenario:'Plan',reviewedBy:actor,reviewedAt:assignment.assignedAt}};
input.inputReviews=reviewPlanningInputs(evidence,input.selectedLineIds,{reason:'Review numeric inputs',ownerId:actor});
const original=JSON.stringify({evidence,source}),result=evaluateReforecastImportReview(input,[cid]);
assert.equal(result.ready,false,'a new draft cannot pass with silently inherited source blanks');
assert.equal(result.inheritance.cells.length,21);
assert.equal(result.inheritance.nonzeroCount,18);
assert.equal(result.inheritance.cells.filter(cell=>cell.inheritedAmount===0).length,3,'blank to zero and absent GL to zero both block');
assert.equal(result.inheritance.totals.revenue,171);
assert.equal(result.inheritance.totals.noi,171);
assert.equal(result.mapping.accountMappings.length,2,'all-blank GL groups are checked even without selected numeric mappings');
assert.deepEqual(result.lines.map(line=>line.amount),[123.25,0],'valid numeric inputs and explicit zero remain exact');
assert.equal(result.issues.filter(issue=>issue.code==='source_blank_numeric_inheritance').length,20);
assert.equal(result.issues.filter(issue=>issue.code==='source_absent_numeric_inheritance').length,1);
const summary=reforecastImportReconciliation(evidence,result);
assert.equal(summary.rows.find(line=>line.sourceLineId===missing[18].id).inheritedAmount,0);
assert.equal(summary.rows.find(line=>line.canonicalGL==='4900').disposition,'source_absent_numeric_inheritance');
assert.throws(()=>mergeReforecastImportIntoDraft({overrides:[]},{...result,communityId:cid,upload:{upload_id:'20000000-0000-0000-0000-000000000001',community_id:cid}}),/Unreviewed/);
assert.equal(JSON.stringify({evidence,source}),original,'review never mutates workbook evidence or approved budget');

const mapped={...input,mapping:result.mapping,lines:result.lines};
const current=reviewReforecastImportInheritance({...mapped,destination:'current'});
assert.equal(current.cells.length,20,'existing partial-update scope does not invent an absent source row');
assert.equal(reviewReforecastImportInheritance({...mapped,purpose:'original_budget'}).cells.length,0,'original budget intake is separate');
assert.equal(reviewReforecastImportInheritance({...mapped,source:{...source,actuals:{cutoffPeriod:period}}}).cells.length,0,'closed actuals never enter the forecast inheritance review');
assert.equal(reviewReforecastImportInheritance({...mapped,source:{...source,lockedPeriods:[period]}}).cells.length,0,'locked inherited months remain immutable');
assert.equal(reviewReforecastImportInheritance({...mapped,source:{...source,actuals:{...source.actuals,notApplicablePeriods:[period]}}}).cells.length,0,'not-applicable months deliberately forecast null, never inherited baseline numbers');
assert.equal(reviewReforecastImportInheritance({...mapped,source:{...source,baseline:undefined}}).issues[0].code,'source_baseline_unavailable');
const numericOnly=evaluateReforecastImportReview({...input,evidence:{...evidence,lines:imported},source:{...source,baseline:undefined}},[cid]);
assert.equal(numericOnly.ready,false,'all-numeric workbook values do not prove the baseline has no absent GL rows');
assert(numericOnly.issues.some(issue=>issue.code==='source_baseline_unavailable'));
assert.equal(reviewReforecastImportInheritance({...mapped,lines:[...result.lines,...missing.map(line=>({period,accountCode:line.accountCode,amount:null}))]}).cells.length,21,'an unproven null override cannot bypass the guard');
const numericDestination=reviewReforecastImportInheritance({...mapped,lines:[...result.lines,...missing.map(line=>({period,accountCode:line.accountCode,amount:0}))],source:{...source,baseline:{lines:source.baseline.lines.filter(line=>line.accountCode!=='4900')}}});
assert.equal(numericDestination.cells.length,0,'an explicit numeric destination prevents baseline inheritance; null is never coerced to zero');
const remap={...mapped,accountChoices:{[JSON.stringify(['Input','4100',null])]:{accountCode:'4900'}},source:{...source,baseline:{lines:[{period,accountCode:'4900',amount:42}]}}};
assert.equal(reviewReforecastImportInheritance(remap).cells[0].sourceLineIds[0],missing[0].id,'blank-only explicitly remapped GL is reconciled to its target');
const impactAccounts=[['5000','income','above_noi',10],['5001','contra_income','above_noi',-3],['6000','expense','above_noi',4],['7000','income','below_noi',100],['7001','expense','below_noi',60],['7002','expense',null,700]];
const impactReview=reviewReforecastImportInheritance({...mapped,evidence:{lines:[]},lines:[],source:{...source,registry:{accounts:impactAccounts.map(([accountCode,nature,placement])=>({accountCode,nature,placement}))},baseline:{lines:impactAccounts.map(([accountCode,,,amount])=>({period,accountCode,amount}))}}});
assert.equal(impactReview.cells.length,6,'all unresolved inherited cells remain blockers regardless of statement placement');
assert.equal(impactReview.cells.find(cell=>cell.accountCode==='7000').placement,'below_noi');
assert.equal(impactReview.cells.find(cell=>cell.accountCode==='7002').placement,null,'unknown placement is not silently assumed above NOI');
assert.deepEqual(impactReview.totals,{revenue:7,opex:4,noi:3},'income and expenses below NOI never enter revenue, OpEx or NOI totals');
console.log('PASS import inheritance guard: 18 generic nonzero cells; blank vs zero; absent GL; all-blank and remapped groups; closed/locked exclusions; exact numeric/zero inputs; read-only reconciliation; new-draft merge blocked.');
console.log('PASS missing baseline readback with numeric-only source; not-applicable null-month exclusion; placement-aware above-NOI impact totals.');

// Optional private acceptance evidence: derive every source/target value from
// independently read workbook cells and snapshot lineage, never embed them in
// application code or commit the private workbook to a test fixture.
if(process.argv[2]){
 const root=path.resolve(process.argv[2]),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
 const bridge=read('source-to-publication-bridge.json'),records=read('selected-gl-month-records.json'),inherited=read('inherited-blank-dispositions.json');
 const publications=JSON.parse(fs.readFileSync(path.resolve(root,'../export-verification/publication.json'),'utf8'));
 const publication=publications.find(row=>row.publication_id===bridge.publicationId);
 assert(publication?.snapshot?.lines,'the exact audited publication supplies canonical nature and placement');
 const rawLines=records.map(record=>({id:record.sourceLineId,sheet:record.sheet,address:record.address,accountCode:record.sourceGL,department:record.department,period:record.period,amount:record.state==='numeric'?record.value:null,blank:record.state==='blank',scenario:'Plan',sourceKind:'workbook_forecast_evidence'}));
 const numeric=bridge.allSourceCells.map(cell=>({sourceLineId:cell.sourceCell,period:cell.period,accountCode:cell.sourceGL,amount:cell.sourceValue}));
 const classifications=new Map(publication.snapshot.lines.map(cell=>[cell.accountCode,{nature:cell.nature,placement:cell.placement}]));
 const registry={accounts:[...new Set([...rawLines.map(line=>line.accountCode),...inherited.map(line=>line.accountCode)])].map(accountCode=>({accountCode,...classifications.get(accountCode)}))};
 const baseline={lines:inherited.map(cell=>({period:cell.period,accountCode:cell.accountCode,amount:cell.selectedBaselineValue}))};
 const review=reviewReforecastImportInheritance({evidence:{source:{sha256:bridge.sourceHash},lines:rawLines},source:{registry,baseline,actuals:{cutoffPeriod:'2026-08'}},mapping:{sourceScenario:'Plan',periods:[...new Set(rawLines.map(line=>line.period))],accountMappings:[]},lines:numeric});
 assert.equal(numeric.length,455);assert.equal(review.nonzeroCount,18);
 assert.equal(review.cells.filter(cell=>cell.disposition==='source_blank_numeric_inheritance').length,629);
 assert.equal(review.cells.filter(cell=>cell.disposition==='source_absent_numeric_inheritance').length,84);
 assert.equal(review.cells.filter(cell=>cell.disposition==='source_blank_numeric_inheritance'&&cell.inheritedAmount===0).length,611);
 const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,`${actual} differs from ${expected}`);
 close(review.totals.revenue,43708);close(review.totals.opex,12283.33);close(review.totals.noi,31424.67);
 for(const month of bridge.monthlyBridge){const rows=review.cells.filter(cell=>cell.period===month.period&&cell.placement==='above_noi');close(rows.filter(cell=>['income','contra_income'].includes(cell.nature)).reduce((sum,cell)=>sum+cell.inheritedAmount,0),month.remainingRevenueDelta);close(rows.filter(cell=>cell.nature==='expense').reduce((sum,cell)=>sum+cell.inheritedAmount,0),month.remainingOpexDelta);}
 assert.equal(bridge.sourceCellComparison.matched,numeric.length);
 console.log(JSON.stringify({status:'PASS',sourceHash:bridge.sourceHash,publicationId:bridge.publicationId,exactNumericCells:numeric.length,blankInheritanceCount:629,blankToZeroCount:611,absentGLInheritanceCount:84,nonzeroCount:review.nonzeroCount,impact:review.totals,monthlySourceToPublicationBridge:'all four months reconciled'}));
}

const reviewedAbsent=evaluateReforecastImportReview({...input,evidence:{...evidence,lines:imported},source:{...source,baseline:{lines:source.baseline.lines.filter(row=>['4000','4001','4900'].includes(row.accountCode))}},preserveWorkbookBlanks:true,reviewedForecastBlanks:[{period,accountCode:'4900'}],reviewedForecastBlankReason:'Leave this account in the forecast for later planning'},[cid]);
assert.equal(reviewedAbsent.ready,true);assert.equal(reviewedAbsent.inheritance.cells.length,0);assert.equal(reviewedAbsent.inheritance.reviewedForecastBlanks.length,1);assert.equal(reviewedAbsent.inheritance.reviewedForecastBlanks[0].amount,null);assert.equal(reviewedAbsent.mapping.workbookSourcePolicy.outsideForecastScope.length,0);assert.equal(reviewedAbsent.mapping.workbookSourcePolicy.reviewedForecastBlanks[0].reviewedBy,actor);
const absInput={evidence:{...evidence,lines:imported},source:{...source,baseline:{lines:source.baseline.lines.filter(row=>['4000','4001','4900'].includes(row.accountCode))}},mapping:reviewedAbsent.mapping,lines:reviewedAbsent.lines};
assert.equal(reforecastImportReconciliation(absInput.evidence,reviewedAbsent).reviewedForecastBlankCount,1);
const policy=reviewedAbsent.mapping.workbookSourcePolicy,review=policy.reviewedForecastBlanks[0];
for(const change of [{reviewedForecastBlanks:[review,review]},{outsideForecastScope:[review]},{reviewedForecastBlanks:[{...review,reviewedBy:'other'}]},{reviewedForecastBlanks:[{...review,reason:''}]},{reviewedForecastBlanks:[{...review,reviewedAt:'invalid'}]},{reviewedForecastBlanks:[{...review,accountCode:'4000'}]},{reviewedForecastBlanks:[{...review,period:'2026-08'}]},{reviewedForecastBlanks:{period,accountCode:'4900'}}]){
 const bad=reviewReforecastImportInheritance({...absInput,mapping:{...reviewedAbsent.mapping,workbookSourcePolicy:{...policy,...change}}});assert(bad.issues.some(row=>row.code==='invalid_reviewed_forecast_blank'),JSON.stringify(change));assert.equal(bad.reviewedForecastBlanks.length,0);
}
for(const actualScope of [{actuals:{cutoffPeriod:period}},{lockedPeriods:[period]},{actuals:{notApplicablePeriods:[period]}}])assert(reviewReforecastImportInheritance({...absInput,source:{...absInput.source,...actualScope}}).issues.some(row=>row.code==='invalid_reviewed_forecast_blank'));
console.log('PASS intentional absent-account forecast review: null stays in scope, actual reviewer/reason, separate reconciliation, malformed/duplicate/conflicting/sourced/closed/locked decisions blocked.');
