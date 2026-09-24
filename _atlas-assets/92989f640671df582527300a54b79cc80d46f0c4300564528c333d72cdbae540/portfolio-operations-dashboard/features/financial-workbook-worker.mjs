import {parseFinancialWorkbook} from './financial-workbook-parser.mjs?v=af4617b79129bd97';
self.onmessage=async({data})=>{
 try{
  // This version-pinned reader is loaded only for an explicitly chosen workbook.
  const XLSX=await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  const result=await parseFinancialWorkbook(data.buffer,{XLSX,sourceHash:data.sourceHash,sourceFile:data.sourceFile,sourceBytes:data.sourceBytes,onProgress:progress=>self.postMessage({progress})});
  data.buffer=null;self.postMessage({result});
 }catch(error){self.postMessage({error:error.message});}
};
