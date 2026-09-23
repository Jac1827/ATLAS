import {pdfItemsToText,parseComparisonLines,reconcileComparison,classifyStatement,finalizeFinancialPackageEvidence} from './financial-package.mjs?v=b43f129095c7fac2';
const abort=signal=>{if(signal?.aborted)throw new DOMException('Review canceled','AbortError');};
export async function readPackage(file,{signal,onProgress=()=>{}}={}) {
 if(!file||file.size>50*1024*1024)throw Error('Choose a financial package up to 50 MB. Larger packages need a statement-only copy.');
 abort(signal);const buffer=await file.arrayBuffer();abort(signal);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(v=>v.toString(16).padStart(2,'0')).join('');abort(signal);
 if(/\.xlsx$/i.test(file.name))return readWorkbook(buffer,file,hash,{signal,onProgress});
 if(!/\.pdf$/i.test(file.name))throw Error('Choose a PDF or XLSX financial statement.');
 const lib=await import('../vendor/pdfjs-5.6.205/pdf.min.mjs');abort(signal);
 lib.GlobalWorkerOptions.workerSrc=new URL('../vendor/pdfjs-5.6.205/pdf.worker.min.mjs',import.meta.url).href;
 const loading=lib.getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:true});
 const cancel=()=>{void loading.destroy();};signal?.addEventListener('abort',cancel,{once:true});
 const parts=[],classifications=[];let pdf;
 try {
  pdf=await loading.promise;
  for(let number=1;number<=Math.min(pdf.numPages,128);number++) {
   abort(signal);onProgress(`Classifying statement page ${number} of ${pdf.numPages}`);
   const page=await pdf.getPage(number);let text=pdfItemsToText((await page.getTextContent()).items);abort(signal);let method='native',confidence=null;
   if(text.trim().length<40 && !parts.some(part=>part.rows.length)){const {recognizePage}=await import('./financial-ocr.mjs?v=e434acd5170b2867');const ocr=await recognizePage(page,{signal,onProgress});text=ocr.text;confidence=ocr.confidence;method='ocr';abort(signal);}
   const type=classifyStatement(text);classifications.push({page:number,type,method,confidence,needsOcr:method==='ocr'});
   parts.push(parseComparisonLines(text,{page:number,method,confidence,sourceHash:hash}));
   page.cleanup();text='';
   // Supporting pages are inventoried and remain excluded from monthly posting authority.
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  const result=reconcileComparison(parts);
  if(classifications.some(p=>p.needsOcr&&p.type==='budget_comparison'))result.exceptions.push({code:'ocr_review_required',description:'OCR was used. Verify extracted numbers and source pages before closing.'});
  result.technicalReconciled=result.technicalReconciled&&!classifications.some(p=>p.needsOcr&&p.type==='budget_comparison');
  if(pdf.numPages>classifications.length)result.exceptions.push({code:'unexamined_source_pages',description:'The package exceeds 128 pages. Use an approved statement-only copy so all selected evidence can be inventoried.'});
  return finalizeFinancialPackageEvidence({...result,sourceFile:file.name,sourceHash:hash,sourceBytes:file.size,pageCount:pdf.numPages,classifications,unexaminedPages:pdf.numPages-classifications.length,scope:'BCR monthly actuals only; every inspected page inventoried. Supporting pages create no posting rows or closes.'});
 }finally{signal?.removeEventListener('abort',cancel);await loading.destroy();}
}
function readWorkbook(buffer,file,hash,{signal,onProgress}) {
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./financial-workbook-worker.mjs?v=5337e204154ace77',import.meta.url),{type:'module'});
  let settled=false;const timer=setTimeout(()=>finish(Error('Workbook processing exceeded 60 seconds. Retry with a statement-only workbook.')),60000);
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();signal?.removeEventListener('abort',cancel);error?reject(error):resolve(result);};
  const cancel=()=>finish(new DOMException('Review canceled','AbortError'));
  signal?.addEventListener('abort',cancel,{once:true});
  worker.onerror=e=>finish(Error(e.message||'Workbook parsing failed.'));
  worker.onmessage=({data})=>{if(data.progress)onProgress(data.progress);else finish(data.error?Error(data.error):null,data.result);};
  worker.postMessage({buffer,sourceHash:hash,sourceFile:file.name,sourceBytes:file.size},[buffer]);
 });
}
