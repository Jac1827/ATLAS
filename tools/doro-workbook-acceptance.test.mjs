import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {inspectActualWorkbook,verifyMappedReadback} from './doro-workbook-acceptance.mjs';
import {verifyOfficialExports,reconcilePublicationTotals} from './publication-export-acceptance.mjs';
import {communityForecastReport,communityForecastWorkbook,communityForecastPdf} from '../docs/portfolio-operations-dashboard/features/reforecast-report.mjs';
const require=createRequire(import.meta.url),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const clone=structuredClone,periods=['2026-09','2026-10'],sourceHash='a'.repeat(64),source={sourceHash,cells:periods.flatMap((period,i)=>[{sourceLineId:'Input!'+['AW','AX'][i]+'48',sheet:'Input',cell:['AW','AX'][i]+'48',sourceGL:'5125',department:'Reviewed department',period,sourceSignedAmount:i?-2:0,blank:false},{sourceLineId:'Input!'+['AW','AX'][i]+'49',sheet:'Input',cell:['AW','AX'][i]+'49',sourceGL:'5126',department:'Reviewed department',period,sourceSignedAmount:null,blank:true}])};
const mapped=source.cells.filter(c=>!c.blank).map(c=>({sourceLineId:c.sourceLineId,sourceHash,mappingVersion:'reviewed-map',signMultiplier:1,amount:c.sourceSignedAmount,period:c.period,accountCode:c.sourceGL,department:c.department,sourceCoordinates:{sheet:c.sheet,address:c.cell}}));
const saved={fingerprint:'test-only',lines:mapped.map(c=>({period:c.period,accountCode:c.accountCode,forecast:c.amount}))};
assert.equal(verifyMappedReadback({reconciliation:source,mappedLines:mapped,snapshot:saved}).matchedZeros,1);
const shifted=clone(saved);shifted.lines[0].forecast=-2;shifted.lines[1].forecast=0;assert.throws(()=>verifyMappedReadback({reconciliation:source,mappedLines:mapped,snapshot:shifted}),/exact server readback/,'Offsetting month mistakes must fail although annual total matches');
const zeroBlank=clone(saved);zeroBlank.lines[0].forecast=null;assert.throws(()=>verifyMappedReadback({reconciliation:source,mappedLines:mapped,snapshot:zeroBlank}),/exact server readback/);
assert.throws(()=>verifyMappedReadback({reconciliation:source,mappedLines:[...mapped,mapped[0]],snapshot:saved}),/twice/);
assert.throws(()=>verifyMappedReadback({reconciliation:source,mappedLines:[{...mapped[0],sourceLineId:source.cells[1].sourceLineId}],snapshot:saved}),/numeric selected cell/);
for(const patch of [{sourceHash:'b'.repeat(64)},{period:'2026-12'},{amount:999},{department:'Other'},{sourceCoordinates:{sheet:'Input',address:'AW49'}}])assert.throws(()=>verifyMappedReadback({reconciliation:source,mappedLines:[{...mapped[0],...patch}],snapshot:saved}));

// In-memory regression fixture only. Nothing here is an official publication.
const lines=periods.flatMap((period,i)=>[{period,accountCode:'5120',nature:'income',placement:'above_noi',forecast:100+i,originalBudget:90,actual:null},{period,accountCode:'5125',nature:'contra_income',placement:'above_noi',forecast:i?-2:0,originalBudget:-1,actual:null},{period,accountCode:'6330',nature:'expense',placement:'above_noi',forecast:10,originalBudget:11,actual:null}]);
const snapshot={fingerprint:'synthetic-test-only',identity:{communityId:'test-community',periods,baselineVersionIds:['test-original'],mappingRegistryVersion:'reviewed-map'},lines,monthly:periods.map((period,i)=>({period,reforecast:{grossIncome:100+i,contraRevenue:i?-2:0,expenses:10,capital:0,noi:i?89:90},originalBudget:{grossIncome:90,contraRevenue:-1,expenses:11,capital:0,noi:78},actuals:{grossIncome:null,contraRevenue:null,expenses:null,capital:0,noi:null}}))};
const publication={communityId:'test-community',scenarioId:'test-scenario',revisionId:'test-revision',publicationId:'test-publication',contentHash:'test-hash',verified:true,approved:true,locked:true,periods,snapshot,source:{registry:{relationships:[]}}},options={communityName:'Synthetic acceptance fixture'};
const expected=communityForecastReport(publication,options),book=communityForecastWorkbook(publication,XLSX,options),xlsxBytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'}),pdfBytes=await communityForecastPdf(publication,options);
assert.equal((await verifyOfficialExports({publication,xlsxBytes,pdfBytes,screenRows:expected.rows,screenMonthly:expected.monthly,options})).status,'matched');
const wrongTotals=clone(publication);wrongTotals.snapshot.monthly[0].reforecast.noi+=1;assert.throws(()=>reconcilePublicationTotals(wrongTotals),/complete GL detail/);
const bad=clone(book),sheet=bad.Sheets['GL detail'],header=Object.entries(sheet).find(([address,cell])=>/^\w+1$/.test(address)&&cell.v==='Active_baseline')[0].replace('1','');sheet[header+'2'].v+=1;sheet[header+'3'].v-=1;
await assert.rejects(verifyOfficialExports({publication,xlsxBytes:XLSX.write(bad,{type:'buffer',bookType:'xlsx'}),pdfBytes,options}),/GL detail/);
await assert.rejects(verifyOfficialExports({publication:{...publication,locked:false},xlsxBytes,pdfBytes,options}),/approved and locked/);

if(process.env.ATLAS_DORO_WORKBOOK){
 const bytes=fs.readFileSync(process.env.ATLAS_DORO_WORKBOOK),actual=await inspectActualWorkbook(bytes,{fileName:path.basename(process.env.ATLAS_DORO_WORKBOOK),periods:['2026-09','2026-10','2026-11','2026-12']});
 assert(actual.receipt.sourceSelection.zeroCells>0&&actual.receipt.sourceSelection.blankCells>0);
 assert.equal(actual.receipt.integrity.scoped.blocking,0);assert.equal(actual.receipt.integrity.retainedInventoryIdentical,true);
 assert.equal(actual.receipt.sourceSelection.duplicateKeys.length,0);
 assert(actual.receipt.integrity.embeddedImages.some(row=>row.sheet==='Input'&&row.cell==='G29'&&row.kind==='verified_ooxml_local_image'&&row.scope==='supporting'));
 console.log('PASS supplied actual workbook complete retained inventory, scoped dependencies, G29 local-image relationship, distinct zero/blank source slots, and no duplicate source GL/month keys.');
}
console.log('PASS exact mapped cell readback with offsetting-error detection; all XLSX sheets reopened; PDF receipt/GL/monthly evidence parity; independent publication monthly-to-GL totals; locked publication guard. No production acceptance claimed.');
