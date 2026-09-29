import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {standardBudgetWorkbookBytes,standardBudgetPdfBytes} from '../docs/portfolio-operations-dashboard/features/standard-budget-render.mjs';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,decodePDFRawStream} from '../docs/portfolio-operations-dashboard/vendor/pdf-lib-1.17.1.mjs';
const require=createRequire(import.meta.url),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const periods=Array.from({length:12},(_,i)=>new Date(Date.UTC(2026,7+i,1)).toISOString().slice(0,7));
const values=[0,1234.56789,-55.123,4,5,6,7,8,9,10,11,12];
const model={schemaVersion:1,metadata:{community:'RISE Student Test',periodLabel:'FY2027 (Aug 2026 - Jul 2027)',budgetType:'Student',version:'v4',status:'Draft',generatedAt:'2026-09-29T16:00:00.000Z',generatedBy:'Budget Reviewer',portfolio:'Student portfolio',region:'Southeast',snapshotFingerprint:'retained-v4-hash'},periods,sections:[{id:'summary',title:'SUMMARY',rows:[{label:'Net rental income',accountCode:'004100',values,annual:values.reduce((a,b)=>a+b,0),format:'money',kind:'total',annualFormula:'sum'},{label:'Physical occupancy',values:Array(12).fill(.845),annual:.84721,format:'percent',kind:'atlas'},{label:'Unknown assumption',values:[null,...Array(11).fill(0)],annual:null,format:'number',kind:'assumption',note:'Unavailable is distinct from numeric zero.'},{label:'Management adjustment',values:Array(12).fill(3),annual:36,format:'money',kind:'override'}],notes:['Exact selected version.'],charts:[{id:'revenue',title:'Revenue by fiscal month',kind:'bar',format:'money',series:[{label:'Rental income',values}]}]},{id:'leasing',title:'LEASING SCHEDULE',rows:[{label:'Ending units',values:Array(12).fill(88),annual:88,annualFormula:'last',kind:'atlas',format:'number'}]}],validation:{status:'warnings',issues:[{code:'OVERRIDE',severity:'warning',accountCode:'004100',period:'2026-08',message:'Management adjustment retained.'}]}};
const before=structuredClone(model);
const zipRead=bytes=>{const zip=XLSX.CFB.read(bytes,{type:'buffer'});return {zip,read:p=>{const f=XLSX.CFB.find(zip,'Root Entry/'+p);return f?new TextDecoder().decode(f.content):null;}};};
for(const charts of [[],['revenue']]){
 const bytes=standardBudgetWorkbookBytes(model,XLSX,{charts}),book=XLSX.read(bytes,{type:'array',cellFormula:true,cellNF:true}),{zip,read}=zipRead(bytes);
 assert.deepEqual(book.SheetNames,['SUMMARY','LEASING SCHEDULE'],'Only applicable selected sections are rendered');
 const sheet=book.Sheets.SUMMARY;assert.equal(sheet.C7.v,'AUG 26');assert.equal(sheet.N7.v,'JUL 27');assert.equal(sheet.O7.v,'ANNUAL');
 assert.equal(sheet.B8.v,'004100');assert.equal(sheet.C8.v,0);assert.equal(sheet.D8.v,values[1]);assert.equal(sheet.O8.v,model.sections[0].rows[0].annual);assert.equal(sheet.O8.f,'SUM(C8:N8)');assert.equal(sheet.O9.v,.84721);assert(!sheet.O9.f,'Weighted annual rates must never be recomputed by export');assert.equal(sheet.C10.v,'Unavailable');assert.equal(sheet.D10.v,0);assert.equal(book.Sheets['LEASING SCHEDULE'].O8.f,'N8');
 assert(read('xl/worksheets/sheet1.xml').includes('topLeftCell="C8"'));assert(read('xl/worksheets/sheet1.xml').includes('orientation="landscape"'));assert(read('xl/worksheets/sheet1.xml').includes('Page &amp;P of &amp;N'));assert(read('xl/workbook.xml').includes('_xlnm.Print_Titles'));assert(read('xl/workbook.xml').includes('_xlnm.Print_Area'));
 for(const c of ['003146','559CB4','FCB53B','CCBF32'])assert(read('xl/styles.xml').includes(c));
 assert(read('xl/styles.xml').includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'));assert(read('xl/worksheets/sheet1.xml').includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'));assert(!sheet.E8.z.includes('[Red]'),'Negative amounts remain readable on navy total rows');
 assert(XLSX.CFB.find(zip,'Root Entry/xl/media/riseLogo.png'));assert.equal(Boolean(read('xl/charts/chart1.xml')),charts.length>0);assert.deepEqual(JSON.parse(read('xl/atlas-report.json')),model);
 if(charts.length){assert(read('xl/charts/chart1.xml').includes(String(values[1])));assert(read('xl/drawings/drawing1.xml').includes('rIdChart1'));assert(read('xl/drawings/_rels/drawing1.xml.rels').includes('../charts/chart1.xml'));}
 const pdfBytes=await standardBudgetPdfBytes(model,{charts}),pdf=await PDFDocument.load(pdfBytes);assert(pdf.getPageCount()>=3);assert.equal(pdf.getTitle(),'RISE Student Test FY2027 (Aug 2026 - Jul 2027) Budget');
 const names=pdf.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray);assert.equal(names.size(),2);const attachment=names.lookup(1,PDFDict).lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F'),PDFRawStream);assert.deepEqual(JSON.parse(new TextDecoder().decode(decodePDFRawStream(attachment).decode())),model,'PDF and Excel attach the exact same retained model');
}
assert.deepEqual(model,before,'Export cannot mutate the selected ATLAS version');
for(const n of [5,24]){
 const dynamic=structuredClone(model);dynamic.periods=Array.from({length:n},(_,i)=>new Date(Date.UTC(2026,7+i,1)).toISOString().slice(0,7));dynamic.sections=[{id:'summary',title:'SUMMARY',rows:[{label:'Revenue',values:Array(n).fill(123.45),annual:123.45*n,annualFormula:'sum',format:'money',kind:'total'}]}];
 const data=standardBudgetWorkbookBytes(dynamic,XLSX),book=XLSX.read(data,{type:'array',cellFormula:true}),end=XLSX.utils.encode_col(n+2);assert.equal(book.Sheets.SUMMARY[end+'7'].v,'COVERED TOTAL');assert.equal(book.Sheets.SUMMARY[end+'8'].v,123.45*n);assert.equal(book.Sheets.SUMMARY[end+'8'].f,'SUM(C8:'+XLSX.utils.encode_col(n+1)+'8)');
 const pdf=await PDFDocument.load(await standardBudgetPdfBytes(dynamic));assert(pdf.getPageCount()>=(n>12?3:2));
}
const wrong=structuredClone(model);wrong.sections[0].rows[0].annual+=1;assert.throws(()=>standardBudgetWorkbookBytes(wrong,XLSX),/does not reconcile/);
const missing=structuredClone(model);missing.sections[0].rows[0].values[0]=null;assert(!XLSX.read(standardBudgetWorkbookBytes(missing,XLSX),{type:'array'}).Sheets.SUMMARY.O8.f,'Missing months cannot silently become zero in an annual formula');
const bad=structuredClone(model);bad.sections[0].rows[0].values[0]=NaN;assert.throws(()=>standardBudgetWorkbookBytes(bad,XLSX),/finite/);
const badPeriod=structuredClone(model);badPeriod.periods[5]='2028-01';assert.throws(()=>standardBudgetWorkbookBytes(badPeriod,XLSX),/chronological/);
const later=structuredClone(model);later.metadata.version='v5';later.metadata.snapshotFingerprint='retained-v5-hash';assert.notDeepEqual(standardBudgetWorkbookBytes(later,XLSX),standardBudgetWorkbookBytes(model,XLSX),'Different versions produce distinct exports');
const lengthy=structuredClone(model);lengthy.sections[0].rows=Array.from({length:130},(_,i)=>({...model.sections[0].rows[0],label:'Extended detailed account '+i}));const longPdf=await PDFDocument.load(await standardBudgetPdfBytes(lengthy));assert(longPdf.getPageCount()>5,'Long schedules paginate instead of truncating detail');
const noted=structuredClone(model);noted.sections=[{...noted.sections[0],rows:Array.from({length:40},(_,i)=>({...model.sections[0].rows[0],label:'Long note account '+i,note:'Preserved workbook account category.'})),notes:Array(100).fill('Retained validation evidence for this supporting schedule.') }];
const notePdf=await PDFDocument.load(await standardBudgetPdfBytes(noted));let continuedTables=0;
for(const p of notePdf.getPages().slice(1)){
 const contents=p.node.lookup(PDFName.of('Contents')),streams=contents instanceof PDFArray?Array.from({length:contents.size()},(_,i)=>contents.lookup(i,PDFRawStream)):[contents];
 const text=streams.map(s=>new TextDecoder().decode(decodePDFRawStream(s).decode())).flatMap(s=>[...s.matchAll(/<([0-9a-f]+)>\s*Tj/gi)].map(m=>Buffer.from(m[1],'hex').toString('latin1'))).join('\n');
 assert(text.includes('SUMMARY'),'Continued notes retain their supporting schedule title');
 assert(!text.includes('Notes (continued)'),'A generic note page must not lose the schedule context');
 if(text.includes('Long note account')){assert(text.includes('ACCOUNT / METRIC')&&text.includes('Aug 26')&&text.includes('Jul 27'),'Every continued table page repeats identifiers and fiscal month headers');continuedTables++;}
}
assert(continuedTables>2,'The note regression exercises several table continuation pages');
console.log('PASS standard budget Excel/PDF exact snapshot parity, selected sections, fiscal order, precise formula caches, weighted rates, unavailable/zero, branding, chart toggle, override/assumption styles, long-schedule and note pagination, version identity and immutable inputs.');
