import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {reportLibraryFixture,ids} from './fixtures/reforecast-report-library-fixture.mjs';
import {reportSnapshot,reportHtml,reportPdf,reportWorkbook,communityForecastWorkbook,workbookReportEvidence,workbookCellFields} from '../docs/portfolio-operations-dashboard/features/reforecast-report.mjs';
import {listReportVersions,readReportVersion,reportVersionPreview,reportVersionPreviewHtml,buildReportFiles} from '../docs/portfolio-operations-dashboard/features/reforecast-report-library.mjs';
import {verifyOfficialExports,reconcilePublicationTotals} from './publication-export-acceptance.mjs';
import {verifyBudgetExportDelivery} from '../docs/portfolio-operations-dashboard/features/budget-export-delivery.mjs';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,decodePDFRawStream} from '../docs/portfolio-operations-dashboard/vendor/pdf-lib-1.17.1.mjs';
const XLSX=createRequire(import.meta.url)('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
async function pdfEvidence(bytes){const pdf=await PDFDocument.load(bytes),stream=pdf.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray).lookup(1,PDFDict).lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F'),PDFRawStream);return JSON.parse(new TextDecoder().decode(decodePDFRawStream(stream).decode()));}
const f=reportLibraryFixture(),snapshot=f.parent.snapshot,priorPublication='70000000-0000-0000-0000-000000000001';
Object.assign(snapshot.identity,{baselineSourceType:'approved_reforecast',priorPublicationIds:[priorPublication]});
for(const row of snapshot.lines){
 row.baselineLineage={sourceType:'approved_reforecast',publicationId:priorPublication,versionId:'retained-parent-revision'};
 if(row.accountCode==='5120'){row.forecast=row.period==='2026-09'?100:0;continue;}
 Object.assign(row,{forecast:null,selectedBaseline:null,disposition:row.accountCode==='5250'?'workbook_blank':'outside_forecast_scope',isBlank:row.accountCode==='5250',legitimateBlank:row.accountCode==='5250',sourceScopeExclusionConfirmed:row.accountCode==='6100'});
}
for(const month of snapshot.monthly){const amount=month.period==='2026-09'?100:0;month.closed=false;month.reforecast={grossIncome:amount,contraRevenue:0,expenses:0,capital:0,noi:amount,cashFlowBeforeNoncash:amount,nonCashDepreciationAmortization:0,cashFlowAfterNoncash:amount};month.actuals={grossIncome:null,contraRevenue:null,expenses:null,capital:null,noi:null};}
f.revisions[0].snapshot=structuredClone(snapshot);f.revisions[0].snapshot.fingerprint='retained-inherited-draft';
const before=JSON.stringify({publication:f.parent,revision:f.revisions[0]}),options={communityId:ids.community,communityName:'Synthetic Community'};
assert.equal(workbookReportEvidence(snapshot),null,'Inherited cells do not fabricate a new workbook review or source totals');
assert.equal(snapshot.identity.workbookSourcePolicy,undefined);
const retained=reportSnapshot(snapshot),blank=retained.values.lines.find(row=>row.accountCode==='5250');assert.equal(blank.forecast,null);assert.equal(blank.disposition,'workbook_blank');assert.equal(blank.legitimateBlank,true);
const missingEvidence=structuredClone(snapshot);delete missingEvidence.lines.find(row=>row.accountCode==='5250').legitimateBlank;assert.notEqual(reportSnapshot(missingEvidence).fingerprint,retained.fingerprint,'Inherited disposition flags are part of output identity');assert.throws(()=>reconcilePublicationTotals({...f.parent,snapshot:missingEvidence}),/complete GL detail/);assert.equal(workbookCellFields(missingEvidence,missingEvidence.lines.find(row=>row.accountCode==='5250')).Workbook_disposition,'Source disposition unavailable');
assert.match(reportHtml(snapshot,null),/Retained workbook cell evidence/);assert.match(reportHtml(snapshot,null),/Verified workbook blank/);assert(!reportHtml(snapshot,null).includes('Workbook source coverage'));
const analystBook=reportWorkbook(snapshot,null,XLSX),analystPdf=await pdfEvidence(await reportPdf(snapshot,null));assert(!analystBook.SheetNames.includes('Workbook coverage'));assert(analystPdf.sections.find(section=>section.title==='GL detail').columns.some(column=>column[0]==='Workbook_disposition'));assert(analystPdf.rows.some(row=>/Verified workbook blank/.test(row.Workbook_disposition||'')));
const entries=await listReportVersions(f.central,options);
for(const [kind,id]of [['approved_forecast',ids.publication],['saved_revision',ids.draftRevision]]){
 const entry=entries.find(row=>row.kind===kind&&(row.publicationId||row.revisionId)===id),selection=await readReportVersion(f.central,entry,options),model=reportVersionPreview(selection,options),html=reportVersionPreviewHtml(selection,options);
 const [excel]=await buildReportFiles(selection,{format:'xlsx',XLSX,...options}),[pdf]=await buildReportFiles(selection,{format:'pdf',...options}),book=XLSX.read(excel.data,{type:'array'}),document=await pdfEvidence(pdf.data);
 assert.equal(model.workbook,undefined);for(const name of ['Workbook coverage','Known forecast values','Workbook source controls'])assert(!book.SheetNames.includes(name));assert(!document.sections.some(section=>section.title==='Workbook source coverage'));
 const detail=XLSX.utils.sheet_to_json(book.Sheets['GL detail'],{defval:null}),field=kind==='saved_revision'?'Forecast':'Active_baseline';
 for(const [code,label,original]of [['5250','Verified workbook blank (null)',-1],['6100','Reviewed outside forecast scope (null)',11]]){const row=detail.find(row=>row.GL===code);assert.equal(row[field],null);assert.equal(row.Original_budget,original);assert.equal(row.Selected_baseline,null);assert.equal(row.Workbook_disposition,label);assert.equal(row.Workbook_source_amount,null);assert.equal(row.Workbook_source_disposition,'Unavailable','Absent source-control fields are not reconstructed from the baseline');assert(html.includes(label));assert(document.rows.some(value=>value.GL===code&&value.Workbook_disposition===label));}
 assert.equal(detail.find(row=>row.GL==='5120'&&row.Period==='2026-10')[field],0);
 assert(document.sections.find(section=>['GL detail','GL value comparison'].includes(section.title)).columns.some(column=>column[0]==='Workbook_disposition'));
 assert.deepEqual(document.snapshot,model.snapshot);
 if(kind==='approved_forecast'){
  assert.equal((await verifyOfficialExports({publication:selection.publication,xlsxBytes:new Uint8Array(excel.data),pdfBytes:pdf.data,screenRows:model.rows,screenMonthly:model.monthly,options})).status,'matched');assert.equal(excel.delivery.delivery_status,'verified');assert.equal(pdf.delivery.delivery_status,'verified');assert.equal(detail.find(row=>row.GL==='5250').Prior_publication,priorPublication);
  const tampered=communityForecastWorkbook(selection.publication,XLSX,options),sheet=tampered.Sheets['GL detail'],column=Object.entries(sheet).find(([address,cell])=>/^[A-Z]+1$/.test(address)&&cell.v==='Workbook_disposition')[0].replace(/1$/,'');sheet[column+'3'].v='Workbook numeric value';
  await assert.rejects(verifyBudgetExportDelivery(f.central,selection.publication,{format:'xlsx',bytes:XLSX.write(tampered,{type:'array',bookType:'xlsx'}),XLSX,reportOptions:options}),/GL detail/);
 }
}
assert.equal(JSON.stringify({publication:f.parent,revision:f.revisions[0]}),before,'Inherited nulls, comparisons, source history and publication remain immutable');
console.log('PASS inherited verified null dispositions without a new workbook policy: saved/approved screen, PDF, XLSX, exact delivery, no invented coverage/source totals, original comparisons, unknown rejection and immutable prior evidence.');
