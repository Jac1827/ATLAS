import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {reportLibraryFixture,ids} from './fixtures/reforecast-report-library-fixture.mjs';
import {computeReforecast,aggregateForecastLines} from '../docs/portfolio-operations-dashboard/features/reforecast-engine.mjs';
import {sumMoney} from '../docs/portfolio-operations-dashboard/features/decimal-money.mjs';
import {workbookReportEvidence,workbookCellFields,reportSnapshot,reportHtml,reportPdf,reportWorkbook,communityForecastReport,communityForecastWorkbook,communityForecastPdf,pairedForecastReports} from '../docs/portfolio-operations-dashboard/features/reforecast-report.mjs';
import {listReportVersions,readReportVersion,reportVersionPreview,reportVersionPreviewHtml,buildReportFiles} from '../docs/portfolio-operations-dashboard/features/reforecast-report-library.mjs';
import {resolveEffectiveBaseline,effectiveBaselineMetric} from '../docs/portfolio-operations-dashboard/features/reforecast-consumers.mjs';
import {verifyBudgetExportDelivery} from '../docs/portfolio-operations-dashboard/features/budget-export-delivery.mjs';
import {reconcilePublicationTotals,verifyOfficialExports} from './publication-export-acceptance.mjs';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,decodePDFRawStream} from '../docs/portfolio-operations-dashboard/vendor/pdf-lib-1.17.1.mjs';
const XLSX=createRequire(import.meta.url)('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
async function pdfEvidence(bytes){
 const pdf=await PDFDocument.load(bytes),stream=pdf.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray).lookup(1,PDFDict).lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F'),PDFRawStream);
 const data=JSON.parse(new TextDecoder().decode(decodePDFRawStream(stream).decode()));
 const text=pdf.getPages().flatMap(page=>{const contents=page.node.lookup(PDFName.of('Contents')),streams=contents instanceof PDFArray?Array.from({length:contents.size()},(_,i)=>contents.lookup(i,PDFRawStream)):[contents];return streams.flatMap(value=>[...new TextDecoder().decode(decodePDFRawStream(value).decode()).matchAll(/<([a-f0-9]+)>\s*Tj/gi)].map(match=>Buffer.from(match[1],'hex').toString('latin1')));}).join(' ');
 return {data,text};
}
const f=reportLibraryFixture(),snapshot=f.parent.snapshot,options={communityId:ids.community,communityName:'Synthetic Community'};
const metrics=revenue=>({revenue,expenses:0,noi:revenue});
for(const row of snapshot.lines){
 row.mappingValid=true;
 if(row.accountCode==='5120')Object.assign(row,{forecast:row.period==='2026-09'?100.125:0,disposition:'included',isBlank:false,legitimateBlank:false,workbookSourceAmount:row.period==='2026-09'?100.125:0,workbookSourceDisposition:'included'});
 else if(row.accountCode==='6100')Object.assign(row,{forecast:null,disposition:'workbook_blank',isBlank:true,legitimateBlank:true,workbookSourceAmount:null,workbookSourceDisposition:'workbook_blank'});
 else Object.assign(row,{forecast:null,disposition:'reviewed_forecast_blank',isBlank:true,legitimateBlank:true,reviewedForecastBlankConfirmed:true,sourceScopeExclusionConfirmed:false,workbookSourceAmount:null,workbookSourceDisposition:'source_absent',source:{kind:'reviewed_forecast_blank',workbookSourceAbsent:true,uploadId:'retained-upload',sourceHash:'c'.repeat(64),auditId:'retained-audit',mappingVersion:'reviewed-mapping',sourceScenario:'Plan',review:{period:row.period,accountCode:row.accountCode,confirmed:true,reviewedBy:ids.actor,reviewedAt:'2026-09-01T12:00:00Z',reason:'Keep this account in forecast scope and leave its amount blank until reviewed.'}}});
 if(row.accountCode==='5250')Object.assign(row,{selectedBaseline:20,closeVersionId:null,workbookSource:structuredClone(row.source)});
 if(row.accountCode==='6100'){row.source={kind:'upload',uploadId:'retained-upload',auditId:'retained-audit',sourceHash:'c'.repeat(64),sourceLineId:row.period+'-6100'};Object.assign(row,{closeVersionId:null,workbookSource:structuredClone(row.source)});}
}
snapshot.workbookCoverage={schemaVersion:1,numericCellCount:2,workbookBlankCellCount:2,reviewedForecastBlankCellCount:2,sourceAbsentCellCount:0,outsideForecastScopeCellCount:0,reviewerEditedCellCount:0,complete:true,totalsBasis:'known_forecast_values',monthly:snapshot.monthly.map((month,index)=>({period:month.period,numericCellCount:1,workbookBlankCellCount:1,reviewedForecastBlankCellCount:1,sourceAbsentCellCount:0,outsideForecastScopeCellCount:0,reviewerEditedCellCount:0,complete:true,knownValueTotals:metrics(index?0:100.13),workbookSourceTotals:metrics(index?0:100.13)}))};
snapshot.knownValueTotals=metrics(100.13);snapshot.workbookSourceTotals=metrics(100.13);
for(const month of snapshot.monthly){const value=month.period==='2026-09'?100.13:0;month.closed=false;month.reforecast={grossIncome:value,contraRevenue:0,expenses:0,capital:0,noi:value};month.actuals={grossIncome:null,contraRevenue:null,expenses:null,capital:null,noi:null};}
f.revisions[0].snapshot=structuredClone(snapshot);f.revisions[0].snapshot.fingerprint='saved-reviewed-blank';
const before=JSON.stringify({parent:f.parent,revision:f.revisions[0]}),evidence=workbookReportEvidence(snapshot),blank=snapshot.lines.find(row=>row.accountCode==='5250');
assert.equal(evidence.coverage[0].Reviewed_forecast_blank_cells,2);assert.equal(evidence.coverage[0].Workbook_blank_cells,2);assert.equal(evidence.coverage[0].Source_absent_cells,0);assert.equal(evidence.coverage[0].Outside_forecast_scope_cells,0);
assert.equal(workbookCellFields(snapshot,blank).Workbook_disposition,'Reviewed forecast blank (null)');assert.equal(workbookCellFields(snapshot,blank).Workbook_source_disposition,'source_absent');
assert.match(reportHtml(snapshot,null),/Reviewed forecast blanks/);assert.match(reportHtml(snapshot,null),/remain inside the forecast scope with null amounts/);
const analyst=reportWorkbook(snapshot,null,XLSX),analystPdf=await pdfEvidence(await reportPdf(snapshot,null));
assert.deepEqual(XLSX.utils.sheet_to_json(analyst.Sheets['Workbook coverage'],{defval:null}),evidence.coverage);assert.deepEqual(analystPdf.data.sections.find(row=>row.title==='Workbook source coverage').rows,evidence.coverage);assert(analystPdf.text.includes('Reviewed forecast blank (null)'));
assert.equal(reconcilePublicationTotals(f.parent).length,2,'The independent export check excludes approved null contributions without changing stored GL amounts');
for(const patch of [{reviewedForecastBlankConfirmed:false},{legitimateBlank:false},{isBlank:false},{sourceScopeExclusionConfirmed:true},{source:{...blank.source,workbookSourceAbsent:false}},{source:{...blank.source,review:{...blank.source.review,confirmed:false}}},{source:{...blank.source,uploadId:''}},{source:{...blank.source,review:{...blank.source.review,period:'2026-12'}}},{source:{...blank.source,review:{...blank.source.review,accountCode:'unreviewed'}}}]){
 const invalid=structuredClone(snapshot),line=invalid.lines.find(row=>row.accountCode==='5250');Object.assign(line,patch);
 assert.equal(workbookCellFields(invalid,line).Workbook_disposition,'Source disposition unavailable');
 assert.throws(()=>reconcilePublicationTotals({...f.parent,snapshot:invalid}),/complete GL detail/,'An unproven intentional blank must not disappear from reconciliation');
 assert.notEqual(reportSnapshot(invalid).fingerprint,reportSnapshot(snapshot).fingerprint);
}
const unresolved=structuredClone(snapshot);Object.assign(unresolved.lines.find(row=>row.accountCode==='5250'),{disposition:'source_absent',isBlank:false,legitimateBlank:false,reviewedForecastBlankConfirmed:false});unresolved.workbookCoverage.sourceAbsentCellCount=1;unresolved.workbookCoverage.complete=false;
assert.throws(()=>communityForecastReport({...f.parent,snapshot:unresolved}),/missing workbook source coverage/);
const entries=await listReportVersions(f.central,options);
for(const [kind,id]of [['approved_forecast',ids.publication],['saved_revision',ids.draftRevision]]){
 const entry=entries.find(row=>row.kind===kind&&(row.publicationId||row.revisionId)===id),selection=await readReportVersion(f.central,entry,options),model=reportVersionPreview(selection,options),html=reportVersionPreviewHtml(selection,options);
 const [excel]=await buildReportFiles(selection,{format:'xlsx',XLSX,...options}),[pdf]=await buildReportFiles(selection,{format:'pdf',...options}),book=XLSX.read(excel.data,{type:'array'}),document=await pdfEvidence(pdf.data),detail=XLSX.utils.sheet_to_json(book.Sheets['GL detail'],{defval:null}),field=kind==='saved_revision'?'Forecast':'Active_baseline';
 const retained=detail.find(row=>row.GL==='5250');assert.equal(retained[field],null);assert.equal(retained.Original_budget,-1);assert.equal(retained.Selected_baseline,20);assert.equal(retained.Workbook_source_amount,null);assert.equal(retained.Workbook_source_disposition,'source_absent');assert.equal(retained.Workbook_disposition,'Reviewed forecast blank (null)');assert.equal(detail.find(row=>row.GL==='5120'&&row.Period==='2026-10')[field],0);
 assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets['Workbook coverage'],{defval:null}),model.workbook.coverage);assert.deepEqual(document.data.sections.find(row=>row.title==='Workbook source coverage').rows,model.workbook.coverage);assert.deepEqual(document.data.snapshot,model.snapshot);assert(html.includes('Reviewed forecast blanks'));assert(document.text.includes('Reviewed forecast blank (null)'));assert(document.text.includes('100.125'));
 if(kind==='approved_forecast'){
  assert.equal((await verifyOfficialExports({publication:selection.publication,xlsxBytes:new Uint8Array(excel.data),pdfBytes:pdf.data,screenRows:model.rows,screenMonthly:model.monthly,options})).status,'matched');
  if(process.env.ATLAS_REPORT_VISUAL_DIR){fs.mkdirSync(process.env.ATLAS_REPORT_VISUAL_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.ATLAS_REPORT_VISUAL_DIR,'synthetic-reviewed-forecast-blanks.pdf'),pdf.data);fs.writeFileSync(path.join(process.env.ATLAS_REPORT_VISUAL_DIR,'synthetic-reviewed-forecast-blanks.xlsx'),new Uint8Array(excel.data));}
  const tampered=communityForecastWorkbook(selection.publication,XLSX,options),sheet=tampered.Sheets['Workbook coverage'],column=Object.entries(sheet).find(([address,cell])=>/^[A-Z]+1$/.test(address)&&cell.v==='Reviewed_forecast_blank_cells')[0].replace(/1$/,'');sheet[column+'2'].v=0;
  await assert.rejects(verifyBudgetExportDelivery(f.central,selection.publication,{format:'xlsx',bytes:XLSX.write(tampered,{type:'array',bookType:'xlsx'}),XLSX,reportOptions:options}),/Workbook coverage/);
 }
}
// Approved-baseline consumers retain the reviewed null as a distinct cell. A
// narrowed all-blank GL metric is unavailable, not a fabricated zero target.
const baseline={status:'available',communityId:ids.community,period:'2026-09',sourceType:'approved_reforecast',verified:true,approved:true,locked:true,versionId:ids.approvedRevision,publicationId:ids.publication,contentHash:f.parent.contentHash,lines:snapshot.lines.filter(row=>row.period==='2026-09').map(row=>({...row,amount:row.forecast}))};
const resolved=resolveEffectiveBaseline([baseline],{communityId:ids.community,period:'2026-09'});assert.equal(resolved.status,'available');assert.equal(resolved.lines.find(row=>row.accountCode==='5250').amount,null);assert.equal(effectiveBaselineMetric(resolved,'noi'),100.13);assert.equal(effectiveBaselineMetric(resolved,'noi',{accountCodes:['5250']}),null);
assert.equal(resolveEffectiveBaseline([{...baseline,sourceType:'original_budget'}],{communityId:ids.community,period:'2026-09'}).reason,'missing_baseline_amount');
const inherited=structuredClone(snapshot);delete inherited.workbookCoverage;delete inherited.knownValueTotals;delete inherited.workbookSourceTotals;
assert.equal(workbookReportEvidence(inherited),null);assert.match(reportHtml(inherited,null),/remain inside the forecast scope with null amounts/);assert(!reportWorkbook(inherited,null,XLSX).SheetNames.includes('Workbook coverage'));assert((await pdfEvidence(await reportPdf(inherited,null))).text.includes('Reviewed forecast blank (null)'));
// An STR overlay preserves the exact Conventional null and source evidence. A
// reviewed source contribution may add a number, including explicit source zero,
// only to the derived forecast. Unaffected workbook blanks stay null in both.
// Use the real calculator and canonical approved-publication wrapper: the
// parent's historical comparator remains 20, but its forecast null is the new
// selected baseline. Copying the parent report would conceal that distinction.
const parentLineage=period=>({period,sourceType:'approved_reforecast',publicationId:f.parent.publicationId,versionId:f.parent.revisionId,contentHash:f.parent.contentHash});
const approvedBlankLines=snapshot.lines.filter(row=>row.forecast===null);
const inheritedBlankInput={communityId:ids.community,periods:snapshot.identity.periods,
 baseline:{communityId:ids.community,sourceType:'approved_reforecast',versionId:f.parent.revisionId,versionIds:snapshot.identity.baselineVersionIds,periodVersions:snapshot.identity.periods.map(parentLineage),
  lines:approvedBlankLines.map(row=>({...structuredClone(row),amount:row.forecast,source:{...parentLineage(row.period),revisionId:f.parent.revisionId,priorSource:structuredClone(row.source)}})),
  originalBudgetLines:approvedBlankLines.map(row=>({period:row.period,accountCode:row.accountCode,amount:row.originalBudget}))},
 actuals:{cutoffPeriod:snapshot.identity.actualCutoff},registry:{version:ids.mapping,accounts:[{accountCode:'5250',name:'Retained concessions',category:'Revenue',nature:'contra_income',placement:'above_noi'},{accountCode:'6100',name:'Retained expense',category:'Expenses',nature:'expense',placement:'above_noi'}]},
 scenario:{versionId:ids.strRevision,driverVersion:'retained-str-drivers',baselineType:'approved_reforecast',baselinePublicationIds:[f.parent.publicationId],drivers:[],overrides:[]}};
const inheritedInputBefore=JSON.stringify(inheritedBlankInput),inheritedBlanks=computeReforecast(inheritedBlankInput);
assert.equal(inheritedBlanks.status,'ready',JSON.stringify(inheritedBlanks.diagnostics));
for(const row of inheritedBlanks.lines){const parent=approvedBlankLines.find(prior=>prior.period===row.period&&prior.accountCode===row.accountCode);assert.equal(row.forecast,null);assert.equal(row.selectedBaseline,null);assert.equal(row.originalBudget,parent.originalBudget);assert.deepEqual(row.baselineLineage,parentLineage(row.period));if(row.accountCode==='5250')assert.equal(parent.selectedBaseline,20);else{assert.equal(row.source.sourceType,'approved_reforecast');assert.deepEqual(row.source.priorSource,parent.source);}}
assert.equal(JSON.stringify(inheritedBlankInput),inheritedInputBefore,'Inheritance does not rewrite the original parent comparator or source');
const derived=structuredClone(f.parent);Object.assign(derived,{publicationId:ids.strPublication,revisionId:ids.strRevision,scenarioId:ids.strScenario,contentHash:'b'.repeat(64)});
derived.reportContentHash='f'.repeat(64);derived.snapshot.fingerprint=derived.reportContentHash;derived.snapshot.originalPublicationFingerprint=derived.contentHash;
derived.snapshot.identity.parentPublication={publicationId:f.parent.publicationId,revisionId:f.parent.revisionId,contentHash:f.parent.contentHash};
delete derived.snapshot.workbookCoverage;delete derived.snapshot.knownValueTotals;delete derived.snapshot.workbookSourceTotals;
derived.snapshot.savedStrProgramme={sourceReceiptId:'retained-str-source',sourceHash:'d'.repeat(64),contentHash:'e'.repeat(64),sourceFingerprint:'f'.repeat(64),cells:[]};
for(const row of derived.snapshot.lines){const inherited=inheritedBlanks.lines.find(line=>line.period===row.period&&line.accountCode===row.accountCode);Object.assign(row,{selectedBaseline:row.forecast,baselineLineage:parentLineage(row.period)});if(inherited)Object.assign(row,structuredClone(inherited));}
for(const row of derived.snapshot.lines.filter(row=>row.accountCode==='5250')){
 const amount=row.period==='2026-09'?7.25:0;
 derived.snapshot.savedStrProgramme.cells.push({period:row.period,accountCode:row.accountCode,sourceAmount:amount,application:'add',parentAmount:null,parentDisposition:'reviewed_forecast_blank',combinedForecast:amount});
 Object.assign(row,{forecast:amount,disposition:'reviewer_override',isBlank:false,legitimateBlank:false,reviewedForecastBlankConfirmed:false,source:{kind:'saved_str_monthly_programme',sourceReceiptId:'retained-str-source'}});
}
derived.snapshot.strBridge=derived.snapshot.lines.map(row=>{const prior=snapshot.lines.find(line=>line.accountCode===row.accountCode&&line.period===row.period);return {period:row.period,accountCode:row.accountCode,conventional:prior.forecast,strContribution:row.forecast===null?0:prior.forecast===null?row.forecast:row.forecast-prior.forecast,withStr:row.forecast,parentDisposition:prior.forecast===null?prior.disposition:'existing_parent_cell'};});
function refreshForecastTotals(value){
 for(const month of value.monthly)month.reforecast=aggregateForecastLines(value.lines.filter(row=>row.period===month.period),'forecast');
 const totals=Object.fromEntries(['grossIncome','contraRevenue','revenue','expenses','opex','belowNoi','capital','debt','noi','cashFlow'].map(key=>[key,sumMoney(value.monthly.map(month=>month.reforecast[key]))]));
 totals.margin=totals.revenue===0?null:totals.noi/totals.revenue;value.totals={...value.totals,reforecast:totals};
}
refreshForecastTotals(derived.snapshot);
assert.deepEqual(derived.snapshot.monthly.map(month=>[month.period,month.reforecast.grossIncome,month.reforecast.contraRevenue,month.reforecast.expenses,month.reforecast.noi]),[['2026-09',100.13,7.25,0,107.38],['2026-10',0,0,0,0]],'Staged source rounding and the genuine STR contribution must reach the derived monthly totals');
assert.equal(derived.snapshot.totals.reforecast.noi,107.38);assert.equal(snapshot.monthly[0].reforecast.noi,100.13,'The Conventional totals remain unchanged');
const pair=pairedForecastReports(f.parent,derived,options);assert.equal(pair.conventional.rows.find(row=>row.GL==='5250').Active_baseline,null);assert.equal(pair.withStr.rows.find(row=>row.GL==='5250').Active_baseline,7.25);assert.equal(pair.withStr.rows.find(row=>row.GL==='5250'&&row.Period==='2026-10').Active_baseline,0);assert.equal(pair.withStr.rows.find(row=>row.GL==='6100').Active_baseline,null);assert.equal(pair.withStr.bridge.find(row=>row.GL==='5250').Conventional,null);assert.equal(pair.withStr.bridge.find(row=>row.GL==='6100').STR_contribution,0);
assert.deepEqual(pair.withStr.monthly.map(row=>[row.Period,row.Income,row.Contra_income,row.Expenses,row.NOI]),[['2026-09',100.13,7.25,0,107.38],['2026-10',0,0,0,0]]);
const derivedXlsxBytes=new Uint8Array(XLSX.write(communityForecastWorkbook(derived,XLSX,pair.reportOptions),{type:'array',bookType:'xlsx'})),derivedPdfBytes=await communityForecastPdf(derived,pair.reportOptions);
const derivedParity=await verifyOfficialExports({publication:derived,xlsxBytes:derivedXlsxBytes,pdfBytes:derivedPdfBytes,screenRows:pair.withStr.rows,screenMonthly:pair.withStr.monthly,options:pair.reportOptions});
assert.equal(derivedParity.status,'matched');assert.equal(derivedParity.monthlyGLReconciliationComplete,true);assert.equal(derivedParity.screenMonthlyReadbackVerified,true);
const derivedPrinted=await pdfEvidence(derivedPdfBytes);assert(derivedPrinted.text.includes('107.38'),'The derived NOI is printed visibly in the actual PDF');assert(derivedPrinted.text.includes('7.25'),'The genuine STR contribution is printed visibly in the actual PDF');
const staleDerivedTotals=structuredClone(derived);staleDerivedTotals.snapshot.monthly[0].reforecast=structuredClone(snapshot.monthly[0].reforecast);assert.throws(()=>reconcilePublicationTotals(staleDerivedTotals),/differs from its complete GL detail/,'Copying parent totals after a real STR addition must fail independent reconciliation');
assert.equal(pair.conventional.rows.find(row=>row.GL==='5250').Selected_baseline,20);assert.equal(pair.withStr.rows.find(row=>row.GL==='5250').Selected_baseline,null);assert.equal(pair.withStr.rows.find(row=>row.GL==='5250').Prior_publication,f.parent.publicationId);
const sqlLineage=structuredClone(derived);for(const row of sqlLineage.snapshot.lines){delete row.baselineLineage.period;row.baselineLineage.revisionId=f.parent.revisionId;}assert.doesNotThrow(()=>pairedForecastReports(f.parent,sqlLineage,options),'The canonical SQL lineage may omit its redundant period');
const directSource=structuredClone(derived);for(const row of directSource.snapshot.lines.filter(row=>row.accountCode==='6100'))row.source=structuredClone(snapshot.lines.find(prior=>prior.period===row.period&&prior.accountCode===row.accountCode).source);assert.doesNotThrow(()=>pairedForecastReports(f.parent,directSource,options),'Exact retained source remains valid without a wrapper');
for(const mutate of [
 value=>value.snapshot.strBridge.find(row=>row.accountCode==='5250').conventional=0,
 value=>value.snapshot.strBridge.find(row=>row.accountCode==='5250').parentDisposition='existing_parent_cell',
 value=>value.snapshot.savedStrProgramme.cells.splice(0,1),
 value=>value.snapshot.savedStrProgramme.cells.push(structuredClone(value.snapshot.savedStrProgramme.cells[0])),
 value=>value.snapshot.savedStrProgramme.cells[0].sourceAmount=8,
 value=>value.snapshot.savedStrProgramme.cells[0].parentAmount=0,
 value=>value.snapshot.savedStrProgramme.cells[0].combinedForecast=8,
 value=>value.snapshot.savedStrProgramme.cells[1].sourceAmount=null,
 value=>value.snapshot.lines.find(row=>row.accountCode==='5250').workbookSourceDisposition='included',
 value=>value.snapshot.lines.find(row=>row.accountCode==='6100').forecast=0,
 value=>value.snapshot.lines.find(row=>row.accountCode==='6100').legitimateBlank=false,
 value=>value.snapshot.lines.find(row=>row.accountCode==='6100').source={kind:'invented'},
 value=>value.snapshot.lines.find(row=>row.accountCode==='6100').source.priorSource.sourceLineId='other-cell',
 value=>delete value.snapshot.lines.find(row=>row.accountCode==='6100').source.priorSource,
 value=>value.snapshot.lines.find(row=>row.accountCode==='6100').source.publicationId=ids.strPublication,
 value=>value.snapshot.lines.find(row=>row.accountCode==='6100').source.versionId=ids.strRevision,
 value=>value.snapshot.lines.find(row=>row.accountCode==='6100').source.contentHash='b'.repeat(64),
 value=>value.snapshot.lines.find(row=>row.accountCode==='6100').source.revisionId=ids.strRevision,
 value=>value.snapshot.lines.find(row=>row.accountCode==='6100').source.period='2026-12',
 value=>value.snapshot.lines.find(row=>row.accountCode==='5250').selectedBaseline=0,
 value=>value.snapshot.lines.find(row=>row.accountCode==='5250').selectedBaseline=20,
 value=>delete value.snapshot.lines.find(row=>row.accountCode==='5250').baselineLineage,
 value=>value.snapshot.lines.find(row=>row.accountCode==='5250').baselineLineage.sourceType='original_budget',
 value=>value.snapshot.lines.find(row=>row.accountCode==='5250').baselineLineage.publicationId=ids.strPublication,
 value=>value.snapshot.lines.find(row=>row.accountCode==='5250').baselineLineage.versionId=ids.strRevision,
 value=>value.snapshot.lines.find(row=>row.accountCode==='5250').baselineLineage.contentHash='b'.repeat(64),
 value=>value.snapshot.lines.find(row=>row.accountCode==='5250').baselineLineage.revisionId=ids.strRevision,
 value=>value.snapshot.lines.find(row=>row.accountCode==='5250').baselineLineage.period='2026-12'
]){const invalid=structuredClone(derived);mutate(invalid);assert.throws(()=>pairedForecastReports(f.parent,invalid,options));}
const noContribution=structuredClone(derived),nullLine=noContribution.snapshot.lines.find(row=>row.accountCode==='5250'&&row.period==='2026-09');Object.assign(nullLine,structuredClone(inheritedBlanks.lines.find(row=>row.period===nullLine.period&&row.accountCode===nullLine.accountCode)));const nullBridge=noContribution.snapshot.strBridge.find(row=>row.accountCode===nullLine.accountCode&&row.period===nullLine.period);Object.assign(nullBridge,{withStr:null,strContribution:0});noContribution.snapshot.savedStrProgramme.cells=noContribution.snapshot.savedStrProgramme.cells.filter(row=>row.period!==nullLine.period);refreshForecastTotals(noContribution.snapshot);const unchangedPair=pairedForecastReports(f.parent,noContribution,options);assert.equal(unchangedPair.withStr.rows.find(row=>row.GL==='5250').Active_baseline,null);assert.equal(unchangedPair.withStr.rows.find(row=>row.GL==='5250').Selected_baseline,null);assert.equal(unchangedPair.conventional.rows.find(row=>row.GL==='5250').Selected_baseline,20);assert.equal(unchangedPair.withStr.monthly[0].NOI,100.13);assert.equal(reconcilePublicationTotals(noContribution).length,2);
assert.equal(JSON.stringify({parent:f.parent,revision:f.revisions[0]}),before,'Reports and consumers preserve retained nulls, numeric zero, source absence, baselines and immutable history');
console.log('PASS reviewed in-scope forecast blanks: distinct source absence and null, complete coverage evidence, saved/approved screen/PDF/XLSX parity, exact known totals, strict reconciliation, tamper rejection, approved-baseline consumers, source-proven STR additions with unchanged Conventional nulls, and immutable history.');
