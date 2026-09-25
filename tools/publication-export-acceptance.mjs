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
// Independent decimal oracle: PostgreSQL numeric rounds half away from zero.
const strictSum=values=>{if(values.some(value=>typeof value!=='number'||!Number.isFinite(value)))return null;const parts=values.map(value=>{const [coefficient,exponent='0']=String(value).split('e'),[whole,fraction='']=coefficient.split('.');return {units:BigInt(whole+fraction),scale:fraction.length-Number(exponent)};}),scale=Math.max(2,...parts.map(part=>part.scale)),units=parts.reduce((sum,part)=>sum+part.units*10n**BigInt(scale-part.scale),0n),divisor=10n**BigInt(scale-2),absolute=units<0n?-units:units,cents=absolute/divisor+(absolute%divisor*2n>=divisor?1n:0n);return Number(units<0n?-cents:cents)/100;};
const subtract=(a,b)=>a===null||b===null?null:strictSum([a,-b]);

export function reconcilePublicationTotals(publication){
 const snapshot=publication.snapshot,periods=publication.periods||snapshot.identity.periods,seen=new Set(),result=[];
 for(const line of snapshot.lines){const key=JSON.stringify([line.period,line.accountCode]);assert(!seen.has(key),'Publication has duplicate GL/month values');seen.add(key);}
 for(const period of periods){const lines=snapshot.lines.filter(row=>row.period===period),monthly=snapshot.monthly.filter(row=>row.period===period);assert.equal(monthly.length,1,'One monthly receipt is required per period');const month=monthly[0],basisChecks=[];
  for(const [basis,field] of [['reforecast','forecast'],['originalBudget','originalBudget'],['actuals','actual']]){
   const selected=lines.filter(row=>!(field==='originalBudget'&&row[field]===null&&row.baselineDisposition?.kind==='no_original_budget_row')),part=predicate=>strictSum(selected.filter(predicate).map(row=>row[field]??null)),nature=row=>row.nature||row.identifier;
   const invalid=!selected.length||selected.some(row=>row.mappingValid===false),income=part(row=>nature(row)==='income'&&row.placement==='above_noi'),contra=part(row=>nature(row)==='contra_income'&&row.placement==='above_noi'),expense=part(row=>nature(row)==='expense'&&row.placement==='above_noi'),capital=part(row=>nature(row)==='capital'),debt=part(row=>nature(row)==='debt'),belowNoi=strictSum(selected.filter(row=>row.placement==='below_noi'&&!['capital','debt'].includes(nature(row))).map(row=>row[field]===null||row[field]===undefined?null:row[field]*(['income','contra_income'].includes(nature(row))?-1:1))),revenue=strictSum([income,contra]),noi=subtract(revenue,expense);
   const expected={grossIncome:income,contraRevenue:contra,expenses:expense,capital,noi,revenue,opex:expense,belowNoi,debt,cashFlow:subtract(subtract(subtract(noi,belowNoi),debt),capital),margin:noi!==null&&revenue!==null&&revenue!==0?noi/revenue:null},unavailable=(basis==='actuals'&&month.closed===false)||(basis!=='originalBudget'&&month.applicable===false),controlled=month.closed===true&&month.controlSource==='governed_close_controls'&&(basis==='actuals'||basis==='reforecast'&&!lines.every(row=>row.immutable===true));
   if(controlled){assert(month.closeVersionId&&snapshot.identity.actualCloseVersions?.some(row=>row.period===period&&row.versionId===month.closeVersionId),'Governed control totals need the retained exact close version');basisChecks.push({basis,mode:'governed_close_controls',closeVersionId:month.closeVersionId,independentGLReconciliation:false});continue;}
   let metrics=0;for(const [metric,value] of Object.entries(expected)){if(!['grossIncome','contraRevenue','expenses','capital','noi'].includes(metric)&&!Object.hasOwn(month[basis]||{},metric))continue;const actual=month[basis]?.[metric]??null,wanted=invalid||unavailable?null:value;if(metric==='margin'&&actual!==null&&wanted!==null)assert(Math.abs(actual-wanted)<1e-12,`${period} ${basis} margin differs from its complete GL detail`);else assert.equal(actual,wanted,`${period} ${basis} ${metric} differs from its complete GL detail`);metrics++;}
   basisChecks.push({basis,mode:unavailable?'unavailable_period':'complete_gl_detail',metrics,independentGLReconciliation:true});
  }
  result.push({period,glCells:lines.length,forecastSignedTotal:strictSum(lines.map(row=>row.forecast??null)),basisChecks});
 }
 for(const [basis,totals] of Object.entries(snapshot.totals||{})){
  if(!['originalBudget','reforecast','actuals','actualsThroughCutoff'].includes(basis))continue;
  const field=basis==='actualsThroughCutoff'?'actuals':basis,months=snapshot.monthly.filter(row=>periods.includes(row.period)&&(basis==='originalBudget'||row.applicable!==false)&&(basis!=='actualsThroughCutoff'||row.closed)),unavailable=(basis==='actuals'&&months.some(row=>!row.closed))||!months.length;
  for(const [metric,actual] of Object.entries(totals)){const numerator=strictSum(months.map(row=>row[field]?.noi??null)),denominator=strictSum(months.map(row=>row[field]?.revenue??null)),expected=unavailable?null:metric==='margin'?numerator!==null&&denominator!==null&&denominator!==0?numerator/denominator:null:strictSum(months.map(row=>row[field]?.[metric]??null));if(metric==='margin'&&actual!==null&&expected!==null)assert(Math.abs(actual-expected)<1e-12,`${basis} total margin differs from its monthly values`);else assert.equal(actual,expected,`${basis} total ${metric} differs from its monthly values`);}
 }
 return result;
}

export async function verifyOfficialExports({publication,xlsxBytes,pdfBytes,screenRows,screenMonthly,options={}}){
 const report=communityForecastReport(publication,options),monthlyChecks=reconcilePublicationTotals(publication);
 assert(xlsxBytes?.length>4&&xlsxBytes[0]===0x50&&xlsxBytes[1]===0x4b,'Official Excel must be a real XLSX ZIP');
 const book=XLSX.read(xlsxBytes,{type:'array',cellFormula:true});
 const sheetMap={'Monthly summary':'monthly','GL detail':'rows','STR contribution bridge':'bridge','STR schedule':'schedules','Saved STR reconciliation':'sourceReconciliation','Utility recovery':'utilities','Drivers':'drivers','Overrides':'overrides','Baseline by month':'baselines','Risks':'risks','Source appendix':'appendix'};
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
 assert.deepEqual(attached.rows,clean([...report.rows,...report.monthly,...report.schedules,...report.sourceReconciliation,...report.utilities,...report.drivers,...report.overrides,...report.baselines,...report.risks,...report.bridge,...report.appendix]),'PDF detail does not match publication');
 if(screenRows!==undefined)assert.deepEqual(screenRows,report.rows,'Screen GL cells differ from publication');
 if(screenMonthly!==undefined)assert.deepEqual(screenMonthly,report.monthly,'Screen monthly values differ from publication');
 return {status:'matched',publicationId:publication.publicationId,publicationHash:publication.contentHash,reportFingerprint:report.snapshot.fingerprint,xlsxHash:hash(xlsxBytes),pdfHash:hash(pdfBytes),monthlyChecks,monthlyGLReconciliationComplete:monthlyChecks.every(month=>month.basisChecks.every(check=>check.independentGLReconciliation)),glCells:report.rows.length,xlsxSheets:Object.keys(sheetMap).length,pdfPages:pdf.getPageCount(),screenGLReadbackVerified:screenRows!==undefined,screenMonthlyReadbackVerified:screenMonthly!==undefined,pdfVisualReview:'required_separately'};
}
