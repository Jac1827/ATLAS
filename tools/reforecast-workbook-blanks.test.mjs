import test from 'node:test';
import assert from 'node:assert/strict';
import {computeReforecast} from '../docs/portfolio-operations-dashboard/features/reforecast-engine.mjs';
import {verifyImportReadback,projectImportUpdatePayload} from '../docs/portfolio-operations-dashboard/features/reforecast-store.mjs';
import {explicitWorkbookBlankSource} from '../docs/portfolio-operations-dashboard/features/reforecast-workbook-source-policy.mjs';
const cid='10000000-0000-0000-0000-000000000001',uploadId='20000000-0000-0000-0000-000000000001',period='2026-09',owner='reviewer',stamp='2026-09-28T00:00:00Z';
function fixture(){
 const accounts=[['rent','income',900,false],['vacancy','contra_income',-50,false],['expense','expense',40,false],['depreciation','below_noi',10,true],['absent','expense',0,false]].map(([accountCode,nature,amount,nonCash])=>({accountCode,nature,amount,category:nature,placement:nature==='below_noi'?'below_noi':'above_noi',nonCash}));
 const policy={schemaVersion:1,mode:'workbook_exact',blankDisposition:'preserve_null',confirmed:true,reviewedBy:owner,reviewedAt:stamp,reason:'Use exact reviewed source; preserve blanks'};
 const mapping={version:'registry',confirmed:true,reviewedBy:owner,sourceScenario:'Plan',periods:[period],selectedLineIds:['Plan!C3','Plan!C4','Plan!C5','Plan!C6'],workbookSourcePolicy:policy};
 const cells=['rent','vacancy','expense','depreciation'].map((accountCode,i)=>({accountCode,period,amount:i===0?1000:i===1?0:null,uploadId,sourceLineId:`Plan!C${i+3}`,sourceHash:'hash',sourceAmount:i===0?1000:i===1?0:null,sourceScenario:'Plan',mappingVersion:'registry',sourceCoordinates:{sheet:'Plan',address:`C${i+3}`,row:i+3,column:3},disposition:i<2?'included':'workbook_blank',isBlank:i>=2,legitimateBlank:i>=2,source:{kind:'workbook_import',uploadId,auditId:'audit',sourceLineId:`Plan!C${i+3}`},reason:policy.reason,confirmed:true,ownerId:owner,reviewedAt:stamp,effectivePeriod:period,before:accounts[i].amount,after:i===0?1000:i===1?0:null}));
 const compact=cell=>Object.fromEntries(['accountCode','period','amount','uploadId','sourceLineId','disposition','isBlank','legitimateBlank'].map(key=>[key,cell[key]]));
 const input={communityId:cid,periods:[period],baseline:{versionId:'original',lines:accounts.map(row=>({accountCode:row.accountCode,period,amount:row.amount}))},actuals:{},registry:{version:'registry',nonCashClassificationVersion:1,accounts},scenario:{versionId:'draft',driverVersion:'drivers',uploadId,importMapping:mapping,drivers:[],overrides:cells.map(cell=>cell.isBlank?compact(cell):cell)},workbookBlankCells:cells.filter(cell=>cell.isBlank)};
 return {input,mapping,cells,compact};
}
test('explicit source blanks are distinct from formula/errors/unknown missing cells',()=>{
 const blank={amount:null,blank:true,formula:null,cellType:'z',cachedValue:null,sourceKind:'workbook_forecast'};
 assert.equal(explicitWorkbookBlankSource(blank),true);
 for(const patch of [{amount:0},{amount:undefined},{blank:false},{formula:'SUM(A1:A3)'},{cellType:'e'},{cachedValue:0},{sourceKind:'workbook_actual_evidence'}])assert.equal(explicitWorkbookBlankSource({...blank,...patch}),false);
});
test('blank forecast nulls never inherit nonzero comparisons; source absence blocks and known controls remain separate',()=>{
 const {input}=fixture(),before=JSON.stringify(input),result=computeReforecast(input);
 assert.equal(JSON.stringify(input),before);
 for(const code of ['expense','depreciation']){const row=result.lines.find(row=>row.accountCode===code);assert.equal(row.forecast,null);assert.equal(row.disposition,'workbook_blank');assert.equal(row.legitimateBlank,true);assert.equal(row.originalBudget,code==='expense'?40:10);assert.equal(row.selectedBaseline,row.originalBudget);}
 assert.equal(result.lines.find(row=>row.accountCode==='vacancy').forecast,0);
 assert.equal(result.lines.find(row=>row.accountCode==='absent').forecast,null);
 assert.equal(result.status,'action_required');assert.equal(result.workbookCoverage.sourceAbsentCellCount,1);
 assert.equal(result.workbookCoverage.workbookBlankCellCount,2);assert.equal(result.workbookCoverage.numericCellCount,2);
 assert.equal(result.totals.reforecast.noi,null);assert.equal(result.knownValueTotals.noi,1000);
 assert.equal(result.diagnostics.filter(row=>row.code==='missing_forecast'&&['expense','depreciation'].includes(row.accountCode)).length,0);
});
test('explicit source-verified scope exclusion is separate from blank and permits known-value totals',()=>{
 const {input,mapping}=fixture(),review={period,accountCode:'absent',confirmed:true,reviewedBy:owner,reviewedAt:stamp,reason:'Reviewed source has no row for this account'};
 mapping.workbookSourcePolicy.outsideForecastScope=[review];
 input.workbookOutsideScopeCells=[{...review,disposition:'outside_forecast_scope',sourceScopeExclusionConfirmed:true,source:{kind:'workbook_scope_exclusion',uploadId,auditId:'audit',sourceHash:'hash',review}}];
 const result=computeReforecast(input),row=result.lines.find(row=>row.accountCode==='absent');
 assert.equal(row.forecast,null);assert.equal(row.originalBudget,0);assert.equal(row.legitimateBlank,false);assert.equal(row.disposition,'outside_forecast_scope');
 assert.equal(result.status,'ready');assert.equal(result.workbookCoverage.complete,true);assert.equal(result.workbookCoverage.outsideForecastScopeCellCount,1);
 assert.equal(result.totals.reforecast.noi,1000);assert.equal(result.totals.reforecast.cashFlowBeforeNoncash,1000);assert.equal(result.totals.reforecast.nonCashDepreciationAmortization,0);
});
test('unknown noncash classification on a blank poisons the additive total instead of pretending zero',()=>{
 const {input}=fixture();delete input.registry.accounts.find(row=>row.accountCode==='depreciation').nonCash;
 const result=computeReforecast(input);assert.equal(result.knownValueTotals.nonCashDepreciationAmortization,null);assert.equal(result.knownValueTotals.cashFlowBeforeNoncash,null);
});
test('unverified blank reference fails closed; legacy no-policy calculation remains unchanged',()=>{
 const {input}=fixture();input.workbookBlankCells=[];
 const result=computeReforecast(input);assert.equal(result.workbookCoverage.workbookBlankCellCount,0);assert.equal(result.workbookCoverage.sourceAbsentCellCount,3);
 const legacy=structuredClone(input);delete legacy.scenario.importMapping;delete legacy.scenario.uploadId;legacy.scenario.overrides=[];
 const old=computeReforecast(legacy);assert.equal(old.workbookCoverage,undefined);assert.equal(old.lines.find(row=>row.accountCode==='expense').forecast,40);
 for(const value of [undefined,null,{}]){legacy.scenario.importMapping=value;assert.deepEqual(computeReforecast(legacy),old);}
});
test('receipt verification accepts only exact compact null references plus full immutable receipt evidence',()=>{
 const {input,mapping,cells}=fixture(),scenarioId='30000000-0000-0000-0000-000000000001',requestId='40000000-0000-0000-0000-000000000001';
 const options={communityId:cid,scenarioId,requestId,uploadId,mapping,expectedLines:cells},snapshot=computeReforecast(input);
 const result={head:{scenario_id:scenarioId,community_id:cid},revision:{revision_id:'revision',scenario_id:scenarioId,community_id:cid,payload:input.scenario},snapshot,receipt:{verified:true,request_id:requestId,upload_id:uploadId,mapping_version:mapping.version,revision_id:'revision',importedCells:cells}};
 assert.equal(verifyImportReadback(result,options),result);
 const tampered=structuredClone(result);tampered.revision.payload.overrides[2].amount=0;assert.throws(()=>verifyImportReadback(tampered,options),/differs/);
 const projected=projectImportUpdatePayload(input.scenario,{uploadId,mapping,expectedLines:cells});assert.deepEqual(projected.overrides,[]);assert.deepEqual(input.scenario.overrides.length,4);
});

test('reviewed edits and accepted drivers follow workbook values without altering source controls',()=>{
 const {input,cells}=fixture();input.scenario.governanceSchemaVersion=2;input.workbookImportedCells=structuredClone(cells);
 const manual=(code,value)=>({period,accountCode:code,amount:value,confirmed:true,reason:'Explicit reviewed forecast adjustment',ownerId:owner,effectivePeriod:period,reviewedAt:stamp,before:cells.find(c=>c.accountCode===code).amount,after:value});
 input.scenario.overrides=input.scenario.overrides.filter(c=>!['rent','expense'].includes(c.accountCode)).concat(manual('rent',1200),manual('expense',25));
 let result=computeReforecast(input);
 for(const [code,value,original]of [['rent',1200,1000],['expense',25,null]]){const row=result.lines.find(r=>r.accountCode===code);assert.equal(row.forecast,value);assert.equal(row.workbookSourceAmount,original);assert.equal(row.disposition,'reviewer_override');}
 assert.equal(result.workbookCoverage.reviewerEditedCellCount,2);assert.equal(result.workbookSourceTotals.noi,1000);assert.equal(result.knownValueTotals.noi,1175);
 input.scenario.overrides.find(c=>c.accountCode==='expense').confirmed=false;result=computeReforecast(input);assert.equal(result.status,'action_required');assert.ok(result.diagnostics.some(d=>d.code==='override_review_required'));
 const driven=fixture();driven.input.scenario.drivers=[{id:'rent-growth',type:'reviewed',accountCodes:['rent'],periods:[period],operation:'add',value:10,reason:'Accepted forecast driver'}];
 result=computeReforecast(driven.input);assert.equal(result.lines.find(r=>r.accountCode==='rent').forecast,1010);assert.equal(result.lines.find(r=>r.accountCode==='rent').workbookSourceAmount,1000);assert.equal(result.workbookSourceTotals.noi,1000);assert.equal(result.knownValueTotals.noi,1010);
 const absent=manual('rent',1200);absent.accountCode='absent';driven.input.scenario.overrides.push(absent);result=computeReforecast(driven.input);assert.equal(result.lines.find(r=>r.accountCode==='absent').forecast,null);assert.equal(result.status,'action_required');
});

test('new drafts inherit published blank and explicit outside-scope null evidence without original-value fallback',()=>{
 const {input}=fixture();delete input.scenario.importMapping;delete input.scenario.uploadId;input.scenario.overrides=[];
 for(const code of ['expense','absent']){const b=input.baseline.lines.find(r=>r.accountCode===code);b.amount=null;b.disposition=code==='expense'?'workbook_blank':'outside_forecast_scope';b.legitimateBlank=code==='expense';b.sourceScopeExclusionConfirmed=code==='absent';b.source={kind:'approved_reforecast',publicationId:'locked-publication'};}
 input.baseline.originalBudgetLines=fixture().input.baseline.lines;input.baseline.sourceType='approved_reforecast';
 const result=computeReforecast(input);assert.equal(result.lines.find(r=>r.accountCode==='expense').forecast,null);assert.equal(result.lines.find(r=>r.accountCode==='absent').forecast,null);assert.equal(result.lines.find(r=>r.accountCode==='expense').originalBudget,40);assert.equal(result.diagnostics.filter(d=>d.code==='missing_forecast').length,0);assert.equal(result.totals.reforecast.noi,850);
});

test('omitting source policy cannot turn workbook blanks and missing source into publishable baseline values',()=>{
 const {input,cells}=fixture();delete input.scenario.importMapping.workbookSourcePolicy;input.scenario.overrides=cells.filter(c=>c.amount!==null);input.workbookSourceCoverage={numericCells:cells.filter(c=>c.amount!==null),issues:[],exclusions:[]};
 let result=computeReforecast(input);assert.equal(result.status,'action_required');assert.deepEqual(result.diagnostics.filter(d=>d.code==='workbook_source_policy_required').map(d=>d.accountCode).sort(),['absent','depreciation','expense']);
 input.scenario.overrides=[];result=computeReforecast(input);assert.equal(result.diagnostics.filter(d=>d.code==='workbook_source_policy_required').length,5);
 input.registry.accounts=input.registry.accounts.filter(a=>['rent','vacancy'].includes(a.accountCode));input.baseline.lines=input.baseline.lines.filter(a=>['rent','vacancy'].includes(a.accountCode));input.scenario.overrides=cells.filter(c=>c.amount!==null);result=computeReforecast(input);assert.equal(result.status,'ready');
 input.workbookSourceCoverage.issues=[{code:'numeric_source_exclusion_review_required',severity:'error',sourceLineId:'Plan!C99'}];result=computeReforecast(input);assert.equal(result.status,'action_required');
});

test('reviewed retirement preserves destination zero while source-side numeric reviews remain required',()=>{
 const {input}=fixture();Object.assign(input.registry.accounts.find(a=>a.accountCode==='absent'),{retiredAfter:'2026-08',retirementReason:'Reviewed prospective retirement',successorDisposition:'no_successor'});
 let result=computeReforecast(input);assert.equal(result.lines.find(l=>l.accountCode==='absent').forecast,0);assert.equal(result.workbookCoverage.sourceAbsentCellCount,0);assert.equal(result.status,'ready');
 input.workbookSourceCoverage={numericCells:[],exclusions:[],issues:[{code:'numeric_source_exclusion_review_required',severity:'error',sourceLineId:'Plan!C99'}]};result=computeReforecast(input);assert.equal(result.status,'action_required');
 delete input.scenario.importMapping.workbookSourcePolicy;result=computeReforecast(input);assert.ok(!result.diagnostics.some(d=>d.code==='workbook_source_policy_required'&&d.accountCode==='absent'));
});
