// Projection boundary regression: real isolated PostgreSQL -> report consumers.
// Every financial record is synthetic; no production access or approval action.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import {reportLibraryFixture} from './fixtures/reforecast-report-library-fixture.mjs';
import {aggregateForecastLines} from '../docs/portfolio-operations-dashboard/features/reforecast-engine.mjs';
import {sumMoney} from '../docs/portfolio-operations-dashboard/features/decimal-money.mjs';
import {confirmedReviewedForecastBlank} from '../docs/portfolio-operations-dashboard/features/reforecast-workbook-source-policy.mjs';
import {pairedForecastReports,communityForecastReport,communityForecastWorkbook,communityForecastPdf} from '../docs/portfolio-operations-dashboard/features/reforecast-report.mjs';
import {reconcilePublicationTotals,verifyOfficialExports} from './publication-export-acceptance.mjs';
const XLSX=createRequire(import.meta.url)('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const sql=fs.readFileSync(new URL('../supabase/migrations/20260929153104_reviewed_blank_report_projection.sql',import.meta.url),'utf8');
const priorSql=fs.readFileSync(new URL('./fixtures/reforecast-report-projection-before-reviewed.sql',import.meta.url),'utf8');
function totals(snapshot){
 for(const month of snapshot.monthly){month.closed=false;month.reforecast=aggregateForecastLines(snapshot.lines.filter(row=>row.period===month.period),'forecast');month.actuals={grossIncome:null,contraRevenue:null,expenses:null,capital:null,noi:null};}
 const keys=['grossIncome','contraRevenue','revenue','expenses','opex','belowNoi','capital','debt','noi','cashFlow'];
 const forecast=Object.fromEntries(keys.map(key=>[key,sumMoney(snapshot.monthly.map(month=>month.reforecast[key]))]));forecast.margin=forecast.revenue===0?null:forecast.noi/forecast.revenue;snapshot.totals={reforecast:forecast};
}
function pairFixture(){
 const f=reportLibraryFixture(),parent=structuredClone(f.parent),child=structuredClone(f.str);
 for(const row of parent.snapshot.lines){
  row.mappingValid=true;
  if(row.accountCode==='5120'){const amount=row.period==='2026-09'?100.125:0;Object.assign(row,{forecast:amount,disposition:'included',isBlank:false,legitimateBlank:false,workbookSourceAmount:amount,workbookSourceDisposition:'included'});continue;}
  const reviewed=row.accountCode==='5250';
  const source=reviewed?{kind:'reviewed_forecast_blank',workbookSourceAbsent:true,uploadId:'synthetic-upload',auditId:'synthetic-audit',sourceHash:'c'.repeat(64),mappingVersion:'synthetic-mapping',sourceScenario:'Plan',review:{period:row.period,accountCode:row.accountCode,confirmed:true,reviewedBy:'synthetic-reviewer',reviewedAt:'2026-09-01T12:00:00Z',reason:'Keep absent source as an editable forecast blank'}}:{kind:'upload',uploadId:'synthetic-upload',auditId:'synthetic-audit',sourceLineId:row.period+'-6100'};
  Object.assign(row,{forecast:null,disposition:reviewed?'reviewed_forecast_blank':'workbook_blank',isBlank:true,legitimateBlank:true,closeVersionId:null,source,workbookSource:structuredClone(source),workbookSourceAmount:null,workbookSourceDisposition:reviewed?'source_absent':'workbook_blank'});
  if(reviewed)Object.assign(row,{selectedBaseline:20,reviewedForecastBlankConfirmed:true,sourceScopeExclusionConfirmed:false});
 }
 totals(parent.snapshot);
 const metrics=month=>({revenue:month.reforecast.revenue,expenses:month.reforecast.expenses,noi:month.reforecast.noi});
 const count={numericCellCount:1,workbookBlankCellCount:1,reviewedForecastBlankCellCount:1,sourceAbsentCellCount:0,outsideForecastScopeCellCount:0,reviewerEditedCellCount:0,complete:true};
 parent.snapshot.workbookCoverage={schemaVersion:1,...count,numericCellCount:2,workbookBlankCellCount:2,reviewedForecastBlankCellCount:2,totalsBasis:'known_forecast_values',monthly:parent.snapshot.monthly.map(month=>({period:month.period,...count,knownValueTotals:metrics(month),workbookSourceTotals:metrics(month)}))};
 parent.snapshot.knownValueTotals=metrics({reforecast:parent.snapshot.totals.reforecast});parent.snapshot.workbookSourceTotals=structuredClone(parent.snapshot.knownValueTotals);
 child.snapshot=structuredClone(parent.snapshot);delete child.snapshot.workbookCoverage;delete child.snapshot.knownValueTotals;delete child.snapshot.workbookSourceTotals;
 child.snapshot.identity.parentPublication={publicationId:parent.publicationId,revisionId:parent.revisionId,contentHash:parent.contentHash};
 child.snapshot.savedStrProgramme={sourceReceiptId:'synthetic-str-source',sourceHash:'d'.repeat(64),sourceFingerprint:'e'.repeat(64),contentHash:'f'.repeat(64),cells:[]};
 for(const row of child.snapshot.lines){
  const prior=parent.snapshot.lines.find(line=>line.period===row.period&&line.accountCode===row.accountCode);
  row.selectedBaseline=prior.forecast;row.baselineLineage={sourceType:'approved_reforecast',publicationId:parent.publicationId,versionId:parent.revisionId,revisionId:parent.revisionId,contentHash:parent.contentHash};
  if(row.accountCode==='6100')row.source={...row.baselineLineage,priorSource:structuredClone(prior.source)};
  if(row.accountCode!=='5250')continue;
  const amount=row.period==='2026-09'?7.25:0;
  child.snapshot.savedStrProgramme.cells.push({period:row.period,accountCode:row.accountCode,application:'add',parentAmount:null,parentDisposition:'reviewed_forecast_blank',sourceAmount:amount,combinedForecast:amount});
  Object.assign(row,{forecast:amount,disposition:'reviewer_override',isBlank:false,legitimateBlank:false,reviewedForecastBlankConfirmed:false,source:{kind:'saved_str_monthly_programme',sourceReceiptId:'synthetic-str-source'}});
 }
 child.snapshot.strBridge=child.snapshot.lines.map(row=>{const prior=parent.snapshot.lines.find(line=>line.period===row.period&&line.accountCode===row.accountCode);return {period:row.period,accountCode:row.accountCode,conventional:prior.forecast,strContribution:row.forecast===null?0:prior.forecast===null?row.forecast:row.forecast-prior.forecast,withStr:row.forecast,parentDisposition:prior.forecast===null?prior.disposition:'existing_parent_cell'};});
 totals(child.snapshot);
 for(const pub of [parent,child]){pub.snapshot.fingerprint=pub.contentHash;pub.snapshot.originalPublicationFingerprint=pub.contentHash;pub.reportContentHash=pub.contentHash;}
 return {parent,child};
}
const db=new PGlite();
try{
 await db.exec('create schema atlas_private;create role anon;create role authenticated;');await db.exec(priorSql);
 const project=async pub=>{const value=structuredClone(pub);value.snapshot=(await db.query('select atlas_private.reforecast_report_snapshot($1::jsonb) result',[pub.snapshot])).rows[0].result;value.reportContentHash=value.snapshot.fingerprint;return value;};
 const {parent,child}=pairFixture(),before=JSON.stringify({parent,child}),options={communityName:'Synthetic Community'};
 assert.doesNotThrow(()=>pairedForecastReports(parent,child,options));
 const brokenParent=await project(parent),brokenChild=await project(child);
 assert.equal(communityForecastReport(brokenParent,options).rows.find(row=>row.GL==='5250').Workbook_disposition,'Source disposition unavailable');
 assert.equal(Object.hasOwn(brokenChild.snapshot.savedStrProgramme,'cells'),false);
 assert.throws(()=>pairedForecastReports(brokenParent,brokenChild,options),/exact Conventional parent cell/);
 const legacy=reportLibraryFixture(),legacyWorkbook=structuredClone(parent);
 for(const row of legacyWorkbook.snapshot.lines.filter(row=>row.disposition==='reviewed_forecast_blank')){row.disposition='workbook_blank';delete row.reviewedForecastBlankConfirmed;delete row.sourceScopeExclusionConfirmed;row.source={kind:'upload',uploadId:'synthetic-legacy',sourceLineId:row.period+'-'+row.accountCode};row.workbookSource=structuredClone(row.source);row.workbookSourceDisposition='workbook_blank';}
 delete legacyWorkbook.snapshot.workbookCoverage.reviewedForecastBlankCellCount;for(const row of legacyWorkbook.snapshot.workbookCoverage.monthly)delete row.reviewedForecastBlankCellCount;
 legacy.str.snapshot.savedStrProgramme={sourceReceiptId:'old-source',cells:[{period:'2026-09',accountCode:'5120',parentDisposition:'existing_parent_cell',parentAmount:100,sourceAmount:10,combinedForecast:110,application:'add'}]};
 const historical=[legacy.parent,legacy.str,legacyWorkbook],old=await Promise.all(historical.map(project));
 const metadata=async()=>(await db.query("select proowner,prosecdef,provolatile,proconfig,proacl from pg_proc where oid='atlas_private.reforecast_report_snapshot(jsonb)'::regprocedure")).rows[0];
 const originalMetadata=await metadata();
 const priorDefinition=(await db.query("select pg_get_functiondef('atlas_private.reforecast_report_snapshot(jsonb)'::regprocedure) definition")).rows[0].definition;
 await db.exec(priorDefinition.replace('\nbegin','\nbegin\n -- intentional test drift'));
 await assert.rejects(()=>db.exec(sql),/Audited reviewed-blank report projection differs/);await db.exec('rollback');await db.exec(priorDefinition);
 await db.exec(sql);assert.deepEqual(await metadata(),originalMetadata,'Projection privileges and security metadata remain unchanged');
 for(let i=0;i<historical.length;i++)assert.deepEqual(await project(historical[i]),old[i],'Unrelated historical numeric/workbook-blank/saved-STR projections stay identical');
 const projectedParent=await project(parent),projectedChild=await project(child),pair=pairedForecastReports(projectedParent,projectedChild,options);
 assert.equal(confirmedReviewedForecastBlank(projectedParent.snapshot.lines.find(row=>row.accountCode==='5250')),true);
 assert.equal(pair.conventional.rows.find(row=>row.GL==='5250').Active_baseline,null);assert.equal(pair.conventional.rows.find(row=>row.GL==='5250').Workbook_disposition,'Reviewed forecast blank (null)');
 assert.equal(pair.withStr.rows.find(row=>row.GL==='5250'&&row.Period==='2026-10').Active_baseline,0);assert.equal(pair.withStr.monthly[0].NOI,107.38);assert.equal(pair.conventional.monthly[0].NOI,100.13);
 for(const [pub,report] of [[projectedParent,pair.conventional],[projectedChild,pair.withStr]]){
  assert.equal(reconcilePublicationTotals(pub).length,2);
  const xlsxBytes=new Uint8Array(XLSX.write(communityForecastWorkbook(pub,XLSX,pair.reportOptions),{type:'array',bookType:'xlsx'})),pdfBytes=await communityForecastPdf(pub,pair.reportOptions);
  assert.equal((await verifyOfficialExports({publication:pub,xlsxBytes,pdfBytes,screenRows:report.rows,screenMonthly:report.monthly,options:pair.reportOptions})).status,'matched');
 }
 const privateExtras=structuredClone(child);privateExtras.snapshot.savedStrProgramme.cells[0].reservationId='PRIVATE-CELL';privateExtras.snapshot.savedStrProgramme.originalFile='PRIVATE-FILE';
 const privateParent=structuredClone(parent);for(const row of privateParent.snapshot.lines.filter(row=>row.disposition==='reviewed_forecast_blank')){row.source.originalFile='PRIVATE-SOURCE';row.source.review.notes='PRIVATE-REVIEW';}
 assert.ok(!JSON.stringify(await project(privateExtras)).includes('PRIVATE-'));assert.ok(!JSON.stringify(await project(privateParent)).includes('PRIVATE-'));
 const blankLine=pub=>pub.snapshot.lines.find(row=>row.accountCode==='5250');
 for(const mutate of [pub=>delete blankLine(pub).source,pub=>blankLine(pub).source.review.accountCode='wrong',pub=>blankLine(pub).source.workbookSourceAbsent=false,pub=>blankLine(pub).reviewedForecastBlankConfirmed=false]){
  const invalid=structuredClone(parent);mutate(invalid);const projected=await project(invalid);assert.equal(confirmedReviewedForecastBlank(blankLine(projected)),false);assert.throws(()=>pairedForecastReports(projected,projectedChild,options));
 }
 const coordinates=structuredClone(parent);blankLine(coordinates).source.sourceLineId='Input!Z999';await assert.rejects(()=>project(coordinates),/contradictory workbook cell evidence/);
 for(const mutate of [pub=>delete pub.snapshot.savedStrProgramme.cells,pub=>pub.snapshot.savedStrProgramme.cells[0].sourceAmount=8,pub=>pub.snapshot.savedStrProgramme.cells[0].parentAmount=0,pub=>pub.snapshot.savedStrProgramme.cells[1].sourceAmount=null,pub=>pub.snapshot.savedStrProgramme.cells.push({...pub.snapshot.savedStrProgramme.cells[0],parentDisposition:'existing_parent_cell'})]){
  const invalid=structuredClone(child);mutate(invalid);const projected=await project(invalid);assert.throws(()=>pairedForecastReports(projectedParent,projected,options),/exact retained source cell/);
 }
 const workbookContribution=structuredClone(child),expense=workbookContribution.snapshot.lines.find(row=>row.accountCode==='6100'&&row.period==='2026-09');
 Object.assign(expense,{forecast:1.5,disposition:'reviewer_override',isBlank:false,legitimateBlank:false});
 Object.assign(workbookContribution.snapshot.strBridge.find(row=>row.accountCode===expense.accountCode&&row.period===expense.period),{withStr:1.5,strContribution:1.5});
 workbookContribution.snapshot.savedStrProgramme.cells.push({period:expense.period,accountCode:expense.accountCode,application:'add',parentAmount:null,parentDisposition:'workbook_blank',sourceAmount:1.5,combinedForecast:1.5});totals(workbookContribution.snapshot);
 assert.equal(pairedForecastReports(projectedParent,await project(workbookContribution),options).withStr.monthly[0].NOI,105.88);
 const unchanged=structuredClone(child);unchanged.snapshot.savedStrProgramme.cells=[];
 for(const row of unchanged.snapshot.lines.filter(row=>row.accountCode==='5250')){
  const prior=parent.snapshot.lines.find(line=>line.period===row.period&&line.accountCode===row.accountCode),lineage=row.baselineLineage;
  Object.assign(row,structuredClone(prior),{selectedBaseline:null,baselineLineage:lineage});
  Object.assign(unchanged.snapshot.strBridge.find(line=>line.period===row.period&&line.accountCode===row.accountCode),{withStr:null,strContribution:0});
 }
 totals(unchanged.snapshot);assert.equal(pairedForecastReports(projectedParent,await project(unchanged),options).withStr.monthly[0].NOI,100.13);
 const forgedInherited=structuredClone(unchanged);blankLine(forgedInherited).source.sourceHash='9'.repeat(64);
 const forgedProjected=await project(forgedInherited);assert.throws(()=>pairedForecastReports(projectedParent,forgedProjected,options),/retained Conventional blank source/);
 assert.equal(JSON.stringify({parent,child}),before,'Projection/export must not alter raw parent/child snapshots');
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'atlas_private.reforecast_report_snapshot(jsonb)','execute') allowed",[role])).rows[0].allowed,false);
 console.log('PASS SQL report projection -> Conventional/STR reports and PDF/XLSX parity; exact reviewed source/null/zero proofs; missing/forged/duplicate proof rejection; privacy allowlists; unchanged history/security; migration drift guard.');
}finally{await db.close();}
