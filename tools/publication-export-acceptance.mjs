/* Read-only comparison of actual downloaded reports with an authenticated,
 * immutable publication receipt. The caller owns authentication and capture. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {communityForecastReport,safeSpreadsheetCell} from '../docs/portfolio-operations-dashboard/features/reforecast-report.mjs';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,decodePDFRawStream} from '../docs/portfolio-operations-dashboard/vendor/pdf-lib-1.17.1.mjs';
const require=createRequire(import.meta.url),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const clean=value=>JSON.parse(JSON.stringify(value));
const strictSum=values=>values.some(value=>!Number.isFinite(value))?null:Math.round((values.reduce((sum,value)=>sum+value,0)+Number.EPSILON)*100)/100;
const subtract=(a,b)=>a===null||b===null?null:Math.round((a-b+Number.EPSILON)*100)/100;

export function reconcilePublicationTotals(publication){
 const snapshot=publication.snapshot,periods=publication.periods||snapshot.identity.periods,seen=new Set(),result=[];
 for(const line of snapshot.lines){const key=JSON.stringify([line.period,line.accountCode]);assert(!seen.has(key),'Publication has duplicate GL/month values');seen.add(key);}
 for(const period of periods){const lines=snapshot.lines.filter(row=>row.period===period),monthly=snapshot.monthly.filter(row=>row.period===period);assert.equal(monthly.length,1,'One monthly receipt is required per period');
  for(const [basis,field] of [['reforecast','forecast'],['originalBudget','originalBudget'],['actuals','actual']]){
   const part=predicate=>strictSum(lines.filter(predicate).filter(row=>!(field==='originalBudget'&&row[field]===null&&row.baselineDisposition?.kind==='no_original_budget_row')).map(row=>row[field]??null));
   const invalid=lines.some(row=>row.mappingValid===false),nature=row=>row.nature||row.identifier;
   const income=part(row=>nature(row)==='income'&&row.placement==='above_noi'),contra=part(row=>nature(row)==='contra_income'&&row.placement==='above_noi'),expense=part(row=>nature(row)==='expense'&&row.placement==='above_noi'),capital=part(row=>nature(row)==='capital'),noi=subtract(strictSum([income,contra]),expense);
   for(const [metric,value] of Object.entries({grossIncome:income,contraRevenue:contra,expenses:expense,capital,noi})){assert.equal(monthly[0][basis]?.[metric]??null,invalid?null:value,`${period} ${basis} ${metric} differs from its complete GL detail`);}
  }
  result.push({period,glCells:lines.length,forecastSignedTotal:strictSum(lines.map(row=>row.forecast??null))});
 }
 return result;
}

export async function verifyOfficialExports({publication,xlsxBytes,pdfBytes,screenRows,screenMonthly,options={}}){
 const report=communityForecastReport(publication,options),monthlyChecks=reconcilePublicationTotals(publication);
 assert(xlsxBytes?.length>4&&xlsxBytes[0]===0x50&&xlsxBytes[1]===0x4b,'Official Excel must be a real XLSX ZIP');
 const book=XLSX.read(xlsxBytes,{type:'array',cellFormula:true});
 const sheetMap={'Monthly summary':'monthly','GL detail':'rows','STR contribution bridge':'bridge','STR schedule':'schedules','Utility recovery':'utilities','Drivers':'drivers','Overrides':'overrides','Baseline by month':'baselines','Risks':'risks','Source appendix':'appendix'};
 assert.deepEqual(book.SheetNames,Object.keys(sheetMap),'Official workbook must retain every report section');
 for(const [sheet,property] of Object.entries(sheetMap)){
  const expected=report[property].map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[safeSpreadsheetCell(key),safeSpreadsheetCell(value)])));
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets[sheet],{defval:null}),expected,`${sheet} does not exactly match the immutable publication`);
  assert(!Object.entries(book.Sheets[sheet]).some(([key,value])=>!key.startsWith('!')&&value.f),'Official workbook may not inject formulas');
 }
 assert.equal(new TextDecoder().decode(pdfBytes.slice(0,5)),'%PDF-','Official PDF must be a real PDF');
 const pdf=await PDFDocument.load(pdfBytes),names=pdf.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray);
 assert.equal(names.size(),2,'Exactly one immutable financial evidence attachment is required');
 const stream=names.lookup(1,PDFDict).lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F'),PDFRawStream),attached=JSON.parse(new TextDecoder().decode(decodePDFRawStream(stream).decode()));
 assert.deepEqual(attached.snapshot,clean(report.snapshot),'PDF receipt does not match publication snapshot');
 assert.deepEqual(attached.rows,clean([...report.rows,...report.monthly,...report.schedules,...report.utilities,...report.drivers,...report.overrides,...report.baselines,...report.risks,...report.bridge,...report.appendix]),'PDF detail does not match publication');
 if(screenRows!==undefined)assert.deepEqual(screenRows,report.rows,'Screen GL cells differ from publication');
 if(screenMonthly!==undefined)assert.deepEqual(screenMonthly,report.monthly,'Screen monthly values differ from publication');
 return {status:'matched',publicationId:publication.publicationId,publicationHash:publication.contentHash,reportFingerprint:report.snapshot.fingerprint,xlsxHash:hash(xlsxBytes),pdfHash:hash(pdfBytes),monthlyChecks,glCells:report.rows.length,xlsxSheets:Object.keys(sheetMap).length,pdfPages:pdf.getPageCount(),screenGLReadbackVerified:screenRows!==undefined,screenMonthlyReadbackVerified:screenMonthly!==undefined,pdfVisualReview:'required_separately'};
}
