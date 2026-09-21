// Private fixtures remain outside the repository. Required acceptance runner, not a CI skip/pass.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {pdfItemsToText,parseComparisonLines,parseComparisonSheet,reconcileComparison} from '../docs/portfolio-operations-dashboard/features/financial-package.mjs';
const [directory,output]=process.argv.slice(2);
if(!directory||!output||!process.env.ATLAS_PDFJS||!process.env.ATLAS_XLSX)throw Error('Usage: ATLAS_PDFJS=<node-compatible pdf.mjs> ATLAS_XLSX=<xlsx module> node tools/financial-package-fixtures.mjs <private fixture directory> <evidence.json>');
const {getDocument}=await import(pathToFileURL(process.env.ATLAS_PDFJS)),xls=await import(pathToFileURL(process.env.ATLAS_XLSX)),XLSX=xls.default||xls;
const results=[];
for(const name of fs.readdirSync(directory).filter(n=>/^2026\.08 .*\.(pdf|xlsx)$/i.test(n))){
 const bytes=fs.readFileSync(path.join(directory,name)),parts=[],classifications=[],start=performance.now();let pages=null;
 if(name.endsWith('.pdf')){
  const pdf=await getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true}).promise;pages=pdf.numPages;
  try{for(let i=1;i<=Math.min(pdf.numPages,64);i++){
   const page=await pdf.getPage(i),p=parseComparisonLines(pdfItemsToText((await page.getTextContent()).items),{page:i,method:'native'});page.cleanup();parts.push(p);classifications.push({page:i,type:p.classification});if(p.classification==='gl_detail'&&parts.some(p=>p.rows.length))break;
  }}finally{await pdf.destroy();}
 }else{
  const book=XLSX.read(bytes,{type:'buffer',raw:true,cellFormula:true});for(const name of book.SheetNames){const sheet=book.Sheets[name];const p=parseComparisonSheet(XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null}),name);parts.push(p);classifications.push({sheet:name,type:p.classification});}
 }
 const r=reconcileComparison(parts);assert(r.technicalReconciled,name+' does not reconcile: '+JSON.stringify(r.exceptions));
 results.push({file:name,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,pages,durationMs:performance.now()-start,classifications,...r});
}
assert.equal(results.length,10,'All ten owner-provided fixtures must be tested');
const workbook=results.find(r=>r.file.endsWith('.xlsx')),sereno=results.find(r=>/Rise Sereno.*pdf$/i.test(r.file));
for(const r of [workbook,sereno]){
 const gpr=r.rows.find(r=>r.glCode==='5120');assert.equal(gpr.values.actual,637731);assert.equal(gpr.values.budget,630471.85);
 for(const [label,a,b] of [['Total Income',460416.27,522045.56],['Net Operating Income',139915.23,213898.60]]){assert.equal(r.checks.find(c=>c.label===label&&c.field==='actual').calculated,a);assert.equal(r.checks.find(c=>c.label===label&&c.field==='budget').calculated,b);}
}
const signature=r=>r.rows.filter(r=>r.kind==='posting').map(r=>[r.glCode,...['actual','budget','ytdActual','ytdBudget','annualBudget'].map(k=>Math.round(r.values[k]*100))]);
assert.deepEqual(signature(workbook),signature(sereno),'PDF and XLSX must represent one actuals set');
fs.writeFileSync(output,JSON.stringify({testedAt:new Date().toISOString(),status:'Extraction and arithmetic only — not closed or published',results},null,2));
console.log('PASS all 10 packages; Sereno PDF/XLSX posting-level parity and six approved expected values');
