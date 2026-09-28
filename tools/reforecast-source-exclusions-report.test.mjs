import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {reportLibraryFixture,ids} from './fixtures/reforecast-report-library-fixture.mjs';
import {reportSnapshot,workbookReportEvidence,communityForecastWorkbook,reportWorkbook,reportHtml,reportPdf} from '../docs/portfolio-operations-dashboard/features/reforecast-report.mjs';
import {listReportVersions,readReportVersion,reportVersionPreview,reportVersionPreviewHtml,buildReportFiles} from '../docs/portfolio-operations-dashboard/features/reforecast-report-library.mjs';
import {verifyOfficialExports} from './publication-export-acceptance.mjs';
import {verifyBudgetExportDelivery} from '../docs/portfolio-operations-dashboard/features/budget-export-delivery.mjs';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,decodePDFRawStream} from '../docs/portfolio-operations-dashboard/vendor/pdf-lib-1.17.1.mjs';
const XLSX=createRequire(import.meta.url)('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
async function attachment(bytes){const pdf=await PDFDocument.load(bytes),stream=pdf.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray).lookup(1,PDFDict).lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F'),PDFRawStream);return JSON.parse(new TextDecoder().decode(decodePDFRawStream(stream).decode()));}
for(const withCoverage of [false,true]){
 const f=reportLibraryFixture(),snapshot=f.parent.snapshot,options={communityId:ids.community,communityName:'Synthetic Community'};
 snapshot.workbookSourceExclusions=[{sourceLineId:'Original!G999',period:'2026-09',sourceAmount:777.1234,sourceAccountCode:'5999',reason:'Explicitly excluded source-only comparison; no canonical classification approved',reviewedBy:ids.actor,reviewedAt:'2026-09-28T00:00:00Z',uploadId:'retained-upload',sourceHash:'c'.repeat(64),auditId:'retained-audit',sourceScenario:'Plan',privateExtra:'DO NOT EXPORT'}];
 if(withCoverage){snapshot.workbookCoverage={schemaVersion:1,numericCellCount:6,workbookBlankCellCount:0,sourceAbsentCellCount:0,outsideForecastScopeCellCount:0,reviewerEditedCellCount:0,complete:true,monthly:[]};snapshot.knownValueTotals={revenue:198,expenses:20,noi:178};snapshot.workbookSourceTotals={...snapshot.knownValueTotals};}
 f.revisions[0].snapshot=structuredClone(snapshot);f.revisions[0].snapshot.fingerprint='saved-exclusion-snapshot';
 const before=JSON.stringify({parent:f.parent,revision:f.revisions[0]}),evidence=workbookReportEvidence(snapshot),excluded=evidence.excludedSources[0];
 assert.equal(excluded.Source_cell,'Original!G999');assert.equal(excluded.Source_GL,'5999');assert.equal(excluded.Excluded_source_amount,777.1234);assert.equal(excluded.Reason,snapshot.workbookSourceExclusions[0].reason);assert(!Object.keys(excluded).some(key=>/canonical|category|nature|net|total/i.test(key)));assert(!JSON.stringify(evidence).includes('DO NOT EXPORT'));
 assert.equal(evidence.coverage.length,withCoverage?1:0);assert.equal(evidence.sourceValues.length,withCoverage?3:0);if(withCoverage){assert.equal(evidence.sourceValues.find(row=>row.Metric==='Revenue').Workbook_source_value,198);assert.match(evidence.sourceValues[0].Basis,/Included workbook source cells only/);}
 const changed=structuredClone(snapshot);changed.workbookSourceExclusions[0].reason='Altered review';assert.notEqual(reportSnapshot(changed).fingerprint,reportSnapshot(snapshot).fingerprint,'The exact exclusion evidence is bound to report identity');
 const analytic=reportWorkbook(snapshot,null,XLSX),analyticPdf=await attachment(await reportPdf(snapshot,null));assert.deepEqual(XLSX.utils.sheet_to_json(analytic.Sheets['Excluded source cells'],{defval:null}),evidence.excludedSources);assert.deepEqual(analyticPdf.sections.find(section=>section.title==='Excluded source cells').rows,evidence.excludedSources);assert(reportHtml(snapshot,null).includes('Original!G999'));assert(reportHtml(snapshot,null).includes('no inferred canonical GL'));
 const entries=await listReportVersions(f.central,options);
 for(const [kind,id]of [['approved_forecast',ids.publication],['saved_revision',ids.draftRevision]]){
  const entry=entries.find(row=>row.kind===kind&&(row.publicationId||row.revisionId)===id),selection=await readReportVersion(f.central,entry,options),model=reportVersionPreview(selection,options),html=reportVersionPreviewHtml(selection,options);
  const [excel]=await buildReportFiles(selection,{format:'xlsx',XLSX,...options}),[pdf]=await buildReportFiles(selection,{format:'pdf',...options}),book=XLSX.read(excel.data,{type:'array'}),document=await attachment(pdf.data);
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets['Excluded source cells'],{defval:null}),model.workbook.excludedSources);assert.deepEqual(document.sections.find(section=>section.title==='Excluded source cells').rows,model.workbook.excludedSources);assert.deepEqual(document.snapshot,model.snapshot);assert(html.includes('Original!G999'));assert(html.includes('777.1234'));assert(!JSON.stringify(model).includes('DO NOT EXPORT'));
  if(!withCoverage){assert(!book.SheetNames.includes('Workbook coverage'));assert(!book.SheetNames.includes('Known forecast values'));assert(!book.SheetNames.includes('Workbook source controls'));assert(!document.sections.some(section=>section.title==='Workbook source coverage'));}
  else assert.match(document.sections.find(section=>section.title==='Workbook source controls').note,/included workbook source cells only/);
  if(kind==='approved_forecast'){
   assert.equal((await verifyOfficialExports({publication:selection.publication,xlsxBytes:new Uint8Array(excel.data),pdfBytes:pdf.data,screenRows:model.rows,screenMonthly:model.monthly,options})).status,'matched');assert.equal(excel.delivery.delivery_status,'verified');
   const tampered=communityForecastWorkbook(selection.publication,XLSX,options),sheet=tampered.Sheets['Excluded source cells'];sheet.A2.v='2099-01';const beforeAcks=f.requests.filter(row=>row.url==='/rpc/atlas_verify_budget_consumer').length;
   await assert.rejects(verifyBudgetExportDelivery(f.central,selection.publication,{format:'xlsx',bytes:XLSX.write(tampered,{type:'array',bookType:'xlsx'}),XLSX,reportOptions:options}),/Excluded source cells/);assert.equal(f.requests.filter(row=>row.url==='/rpc/atlas_verify_budget_consumer').length,beforeAcks);
   await assert.rejects(verifyOfficialExports({publication:selection.publication,xlsxBytes:XLSX.write(tampered,{type:'buffer',bookType:'xlsx'}),pdfBytes:pdf.data,options}),/Excluded source cells/);
  }
 }
 assert.equal(JSON.stringify({parent:f.parent,revision:f.revisions[0]}),before);
}
console.log('PASS reviewed numeric source exclusions: exact source IDs/raw values/reasons/provenance across analyst/saved/approved screen/PDF/Excel, included-only source controls, independent disclosure without invented coverage, no inferred financial classification, immutable evidence, tamper rejection before delivery.');
