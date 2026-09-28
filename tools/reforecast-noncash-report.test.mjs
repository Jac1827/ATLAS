import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {reportLibraryFixture,ids} from './fixtures/reforecast-report-library-fixture.mjs';
import {listReportVersions,readReportVersion,buildReportFiles,reportVersionPreview,reportVersionPreviewHtml} from '../docs/portfolio-operations-dashboard/features/reforecast-report-library.mjs';
import {communityForecastReport,cashFlowComparisonRows,reportHtml,reportPdf,reportWorkbook,analyticalExportRows,contributionRows} from '../docs/portfolio-operations-dashboard/features/reforecast-report.mjs';
import {activeReforecastRows,activeReforecastReport} from '../docs/portfolio-operations-dashboard/features/community-plan-report.mjs';
import {NONCASH_METRICS,forecastDisplayMetrics,reviewNoncashClassification} from '../docs/portfolio-operations-dashboard/features/reforecast-noncash.mjs';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,decodePDFRawStream} from '../docs/portfolio-operations-dashboard/vendor/pdf-lib-1.17.1.mjs';
const XLSX=createRequire(import.meta.url)('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
async function evidence(bytes){const pdf=await PDFDocument.load(bytes),stream=pdf.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray).lookup(1,PDFDict).lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F'),PDFRawStream),data=JSON.parse(new TextDecoder().decode(decodePDFRawStream(stream).decode()));const text=pdf.getPages().flatMap(page=>{const c=page.node.lookup(PDFName.of('Contents')),streams=c instanceof PDFArray?Array.from({length:c.size()},(_,i)=>c.lookup(i,PDFRawStream)):[c];return streams.flatMap(s=>[...new TextDecoder().decode(decodePDFRawStream(s).decode()).matchAll(/<([a-f0-9]+)>\s*Tj/gi)].map(m=>Buffer.from(m[1],'hex').toString('latin1')));}).join(' ');return {data,text};}
const old=reportLibraryFixture(),legacy=JSON.stringify(old.parent),oldModel=communityForecastReport(old.parent);
assert(!Object.hasOwn(oldModel.monthly[0],'Cash_flow_before_noncash'));
assert.deepEqual(forecastDisplayMetrics(old.parent.snapshot),['revenue','expenses','noi','margin','cashFlow']);
assert.deepEqual(cashFlowComparisonRows(old.parent.snapshot,old.parent.source),[]);
assert(!reportHtml(old.parent.snapshot,old.parent.source).includes('Cash flow and noncash charges'));
assert(!(await evidence(await reportPdf(old.parent.snapshot,old.parent.source))).text.includes('noncash'));
assert.equal(JSON.stringify(old.parent),legacy,'Historical source is not reclassified by any report');
const registry={accounts:[{accountCode:'OWNER-A',nature:'below_noi',placement:'below_noi',nonCash:true},{accountCode:'OWNER-B',nature:'expense',placement:'above_noi'}]},originalRegistry=JSON.stringify(registry),reviewed=reviewNoncashClassification(registry);
assert.equal(reviewed.nonCashClassificationVersion,1);assert.deepEqual(reviewed.accounts.map(row=>row.nonCash),[true,false]);assert.equal(JSON.stringify(registry),originalRegistry);
assert.throws(()=>reviewNoncashClassification({accounts:[{accountCode:'ANY-GL',nature:'expense',placement:'above_noi',nonCash:true}]}),/below-NOI/);
const f=reportLibraryFixture();
function newSnapshot(snapshot){
 snapshot.identity.nonCashPresentation={schemaVersion:1,classificationVersion:1,cashFlowBasis:'after_noncash_depreciation_amortization'};
 for(const line of snapshot.lines){line.nonCash=false;line.nonCashClassificationVersion=1;}
 for(const [index,month]of snapshot.monthly.entries()){
  const charge=index?0:18.25,before=index?0:70;
  Object.assign(month.reforecast,{cashFlow:before-charge,cashFlowBeforeNoncash:before,nonCashDepreciationAmortization:charge,cashFlowAfterNoncash:before-charge});
  // No approved historical classification exists for the old comparator.
  Object.assign(month.originalBudget,{cashFlow:50,cashFlowBeforeNoncash:null,nonCashDepreciationAmortization:null,cashFlowAfterNoncash:50});
  Object.assign(month.actuals,{cashFlow:null,cashFlowBeforeNoncash:null,nonCashDepreciationAmortization:null,cashFlowAfterNoncash:null});
  snapshot.lines.push({period:month.period,accountCode:'OWNER-NONCASH',accountName:'Owner-reviewed amortization',nature:'below_noi',placement:'below_noi',nonCash:true,nonCashClassificationVersion:1,originalBudget:15,selectedBaseline:15,forecast:charge,actual:null});
 }
}
newSnapshot(f.parent.snapshot);newSnapshot(f.revisions[0].snapshot);
const before=JSON.stringify({publication:f.parent,revision:f.revisions[0]}),entries=await listReportVersions(f.central,{communityId:ids.community}),output=[];
for(const kind of ['approved_forecast','saved_revision']){
 const entry=entries.find(row=>row.kind===kind&&(kind==='approved_forecast'?row.publicationId===ids.publication:row.revisionId===ids.draftRevision)),selection=await readReportVersion(f.central,entry,{communityId:ids.community}),model=reportVersionPreview(selection,{communityName:'Synthetic noncash review'}),html=reportVersionPreviewHtml(selection,{communityName:'Synthetic noncash review'});
 const xlsx=(await buildReportFiles(selection,{format:'xlsx',XLSX,communityName:'Synthetic noncash review'}))[0],pdf=(await buildReportFiles(selection,{format:'pdf',communityName:'Synthetic noncash review'}))[0],book=XLSX.read(xlsx.data,{type:'array'}),rows=XLSX.utils.sheet_to_json(book.Sheets['Monthly summary'],{defval:null}),doc=await evidence(pdf.data),section=doc.data.sections.find(s=>s.title==='Cash flow and noncash charges');
 assert(section,'Visible PDF includes a dedicated noncash section');
 for(const {column,label}of NONCASH_METRICS){assert(html.includes(label),label+' appears on screen');assert(doc.text.includes(label),label+' appears in printed PDF');for(const row of model.monthly){assert.equal(rows.find(r=>r.Period===row.Period)[column],row[column]);assert.equal(section.rows.find(r=>r.Period===row.Period)[column],row[column]);assert(html.includes('data-column="'+column+'" data-raw-value="'+JSON.stringify(row[column])+'"'));}}
 assert.equal(rows[0].Cash_flow_before_noncash,70);assert.equal(rows[0].Noncash_depreciation_amortization,18.25);assert.equal(rows[0].Cash_flow_after_noncash,51.75);assert.equal(rows[1].Noncash_depreciation_amortization,0);
 assert.deepEqual(doc.data.snapshot,model.snapshot,'PDF retains the exact screen report model');
 if(kind==='approved_forecast'){assert.equal(xlsx.delivery.delivery_status,'verified');assert.equal(pdf.delivery.delivery_status,'verified');}
 output.push({...pdf,name:kind+'-noncash.pdf'},{...xlsx,name:kind+'-noncash.xlsx'});
}
assert(reportHtml(f.parent.snapshot,f.parent.source,{metric:'cashFlow'}).includes('Trend: Cash flow after noncash charges.'),'Classified after-noncash cash-flow meaning is explicit in analysis');
const analysis=cashFlowComparisonRows(f.parent.snapshot,f.parent.source);assert.equal(analysis.find(row=>row.Basis==='Original budget').Cash_flow_before_noncash,null);assert.equal(analysis.find(row=>row.Basis==='Original budget').Cash_flow_after_noncash,50);assert(analysis.filter(row=>row.Basis==='Governed actuals').every(row=>row.Cash_flow_after_noncash===null));
assert.deepEqual(analyticalExportRows(f.parent.snapshot,f.parent.source).cash_flow.map(({Period,Basis,Cash_flow_before_noncash,Noncash_depreciation_amortization,Cash_flow_after_noncash})=>({Period,Basis,Cash_flow_before_noncash,Noncash_depreciation_amortization,Cash_flow_after_noncash})),analysis);
const wb=reportWorkbook(f.parent.snapshot,f.parent.source,XLSX),analysisPDF=await evidence(await reportPdf(f.parent.snapshot,f.parent.source));assert.deepEqual(XLSX.utils.sheet_to_json(wb.Sheets['Cash flow and noncash'],{defval:null}),analysis);assert.deepEqual(analysisPDF.data.sections[0].rows,analysis);
const contributions=contributionRows(f.parent.snapshot,f.parent.source,{metric:'cashFlowBeforeNoncash'});assert.equal(contributions.find(row=>row.accountCode==='OWNER-NONCASH').budgetToForecastContribution,0);
const mixed=structuredClone(f.parent.snapshot),mixedLine=mixed.lines.find(row=>row.period==='2026-10'&&row.accountCode==='OWNER-NONCASH');mixedLine.nonCash=null;mixedLine.nonCashClassificationVersion=null;
assert.equal(contributionRows(mixed,f.parent.source,{metric:'cashFlowBeforeNoncash',grain:'year'}).find(row=>row.accountCode==='OWNER-NONCASH').budgetToForecastContribution,null,'Annual contributions cannot infer unknown inherited classification from another month');
const performance={report_id:'synthetic-performance-report',snapshot:{community:'Synthetic',period:'2026-09',activeReforecast:f.parent}};
const performanceRows=activeReforecastRows(performance),performanceHtml=activeReforecastReport(performance);for(const {metric,label}of NONCASH_METRICS){assert.equal(performanceRows.find(row=>row.Metric===metric).Active_reforecast,f.parent.snapshot.monthly[0].reforecast[metric]);assert(performanceHtml.includes(label));}
assert.equal(JSON.stringify({publication:f.parent,revision:f.revisions[0]}),before,'No report or export changes retained history');
if(process.env.ATLAS_NONCASH_QA_OUTPUT){await mkdir(process.env.ATLAS_NONCASH_QA_OUTPUT,{recursive:true});for(const file of output)await writeFile(process.env.ATLAS_NONCASH_QA_OUTPUT+'/'+file.name,file.data instanceof ArrayBuffer?new Uint8Array(file.data):file.data);}
console.log('PASS noncash screen/PDF/Excel exact snapshot parity, approved and draft readback, zero/missing retained, legacy unchanged, generic reviewed classification and additive analysis.');
