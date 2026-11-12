import {parseComparisonSheet,reconcileComparison,finalizeFinancialPackageEvidence} from './financial-package.mjs?v=9e34c3c633e9477e';
import {auditWorkbook} from './workbook-integrity.mjs?v=612a2cdba3c9dba2';
/* One normal-close candidate from the explicitly typed BCR column. Every other
   worksheet remains inventoried evidence; T12 is never a backfill instruction. */
export async function parseFinancialWorkbook(buffer,{XLSX,sourceHash,sourceFile='',sourceBytes=buffer.byteLength,onProgress=()=>{},previousEvidence}={}){
 if(!XLSX?.read||!XLSX.utils)throw Error('The workbook reader is unavailable.');
 const workbook=XLSX.read(buffer,{type:'array',cellFormula:true,cellNF:true,cellStyles:true,raw:true,sheetStubs:true,bookFiles:true}),parts=[],classifications=[];
 for(const name of workbook.SheetNames){
  onProgress(`Classifying and inventorying worksheet ${name}`);const sheet=workbook.Sheets[name],range=XLSX.utils.decode_range(sheet['!ref']||'A1');
  if(range.e.r>10000||range.e.c>500)throw Error('Worksheet '+name+' exceeds the 10,000-row / 501-column evidence limit. Use an approved statement-only copy.');
  const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null,range:{s:{r:0,c:0},e:range.e}}),part=parseComparisonSheet(matrix,name,{cells:sheet,sourceHash});parts.push(part);classifications.push({sheet:name,type:part.classification,inventoryRows:part.inventory.length,authoritativeForClose:part.classification==='budget_comparison'});
 }
 const result=reconcileComparison(parts);result.sourceHash=sourceHash;result.sourceFile=sourceFile;result.sourceBytes=sourceBytes;result.classifications=classifications;result.scope='One BCR monthly actual column; every workbook row inventoried. Fiscal YTD Actual cells are audited for fiscal review only; T12, budget, annual and other worksheets remain supporting evidence.';
 onProgress('Auditing workbook metadata and formula dependencies…');
 result.intakeEvidence.governanceRequired=true;
 const authoritativeCells=new Set(result.rows.map(row=>row.source.sheet+'!'+row.source.cells.actual));
 // Fiscal review consumes the separately identified cumulative Actual column.
 // Its dependency proof adds no monthly actuals or additional close periods.
 for(const row of result.rows)if(row.columnMapping?.ytdActual?.type==='ytd_actual'&&row.values.ytdActual!==null)authoritativeCells.add(row.source.sheet+'!'+row.source.cells.ytdActual);
 for(const row of result.rows)for(const column of ['A','B']){const address=column+row.source.row,cell=workbook.Sheets[row.source.sheet]?.[address];if(cell&&(cell.f||cell.v!==undefined&&cell.v!==null&&cell.v!==''))authoritativeCells.add(row.source.sheet+'!'+address);}
 for(const selected of result.intakeEvidence.selectedActualColumns||[])for(const address of Object.keys(workbook.Sheets[selected.sheet]||{})){const match=/^[A-Z]+([1-9]\d*)$/.exec(address);const cell=workbook.Sheets[selected.sheet][address];if(match&&Number(match[1])<=selected.headerRow&&cell&&(cell.f||cell.t==='e'||cell.v!==undefined&&cell.v!==null&&cell.v!==''))authoritativeCells.add(selected.sheet+'!'+address);}
 result.intakeEvidence.workbookAudit=auditWorkbook(workbook,{sourceHash,previousEvidence,authoritativeCells:[...authoritativeCells],rowDispositions:Object.fromEntries(result.intakeEvidence.rowInventory.map(row=>[row.id,{disposition:row.disposition,reason:row.reason}])),requireRowDispositions:true});
 return finalizeFinancialPackageEvidence(result);
}
