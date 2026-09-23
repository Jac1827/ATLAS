import {parseComparisonSheet,reconcileComparison,finalizeFinancialPackageEvidence} from './financial-package.mjs?v=b43f129095c7fac2';
/* One normal-close candidate from the explicitly typed BCR column. Every other
   worksheet remains inventoried evidence; T12 is never a backfill instruction. */
export async function parseFinancialWorkbook(buffer,{XLSX,sourceHash,sourceFile='',sourceBytes=buffer.byteLength,onProgress=()=>{}}={}){
 if(!XLSX?.read||!XLSX.utils)throw Error('The workbook reader is unavailable.');
 const workbook=XLSX.read(buffer,{type:'array',cellFormula:true,cellNF:true,raw:true,sheetStubs:true}),parts=[],classifications=[];
 for(const name of workbook.SheetNames){
  onProgress(`Classifying and inventorying worksheet ${name}`);const sheet=workbook.Sheets[name],range=XLSX.utils.decode_range(sheet['!ref']||'A1');
  if(range.e.r>10000||range.e.c>500)throw Error('Worksheet '+name+' exceeds the 10,000-row / 501-column evidence limit. Use an approved statement-only copy.');
  const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null,range:{s:{r:0,c:0},e:range.e}}),part=parseComparisonSheet(matrix,name,{cells:sheet,sourceHash});parts.push(part);classifications.push({sheet:name,type:part.classification,inventoryRows:part.inventory.length,authoritativeForClose:part.classification==='budget_comparison'});
 }
 const result=reconcileComparison(parts);result.sourceHash=sourceHash;result.sourceFile=sourceFile;result.sourceBytes=sourceBytes;result.classifications=classifications;result.scope='One BCR monthly actual column; every workbook row inventoried. T12, budget, YTD, annual and other worksheets remain supporting evidence.';
 return finalizeFinancialPackageEvidence(result);
}
