import {parseComparisonSheet,reconcileComparison,classifyStatement} from './financial-package.mjs?v=49ea086d6d07f300';
self.onmessage=async({data})=>{
 try{
  // Version-pinned and loaded only after the user selects an XLSX package.
  const XLSX=await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  const workbook=XLSX.read(data.buffer,{type:'array',cellFormula:true,raw:true});data.buffer=null;
  const parts=[],classifications=[];
  for(const name of workbook.SheetNames){
   self.postMessage({progress:`Classifying worksheet ${name}`});
   const sheet=workbook.Sheets[name],range=XLSX.utils.decode_range(sheet['!ref']||'A1');
   const metadata=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null,range:{s:{r:0,c:0},e:{r:Math.min(8,range.e.r),c:Math.min(10,range.e.c)}}});
   const type=classifyStatement(metadata.flat().join('\n')+'\n'+name);classifications.push({sheet:name,type});
   if(type==='budget_comparison'){
    if(range.e.r>10000)throw Error('Comparison exceeds the 10,000-row review limit.');
    const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null,range:{s:{r:0,c:0},e:{r:range.e.r,c:10}}});
    parts.push(parseComparisonSheet(matrix,name));
   }
   delete workbook.Sheets[name];
  }
  self.postMessage({result:{...reconcileComparison(parts),classifications}});
 }catch(e){self.postMessage({error:e.message});}
};
