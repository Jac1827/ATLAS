import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
import {mountBudgetReport,readBudgetSnapshot,budgetReportRows,budgetReportHtml,budgetReportCsv,budgetReportWorkbook,budgetReportPdf} from '../docs/portfolio-operations-dashboard/features/canonical-budget-report.mjs';
import {mountCloseReport,readCloseSnapshot,closeReportRows,closeReportHtml,closeReportCsv,closeReportWorkbook,closeReportPdf} from '../docs/portfolio-operations-dashboard/features/financial-close-report.mjs';
import {financeSnapshot,canonicalJson} from '../docs/portfolio-operations-dashboard/features/financial-snapshot.mjs';
import {mountComparison} from '../docs/portfolio-operations-dashboard/features/financial-comparison.mjs';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,decodePDFRawStream} from '../docs/portfolio-operations-dashboard/vendor/pdf-lib-1.17.1.mjs';
const require=createRequire(import.meta.url),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const cid='10000000-0000-0000-0000-000000000001',period='2028-04',budgetHash='b'.repeat(64),closeHash='c'.repeat(64),budgetId='original-2028';
const monthly=n=>Array.from({length:12},(_,m)=>m===3?n:null);
const budget={version_id:budgetId,community_id:cid,calendar_year:2028,status:'locked',content_hash:budgetHash,covered_months:[3],payload:{communityId:cid,year:2028,coverage:[3],sourceFile:'approved.xlsx',sourceHash:'a'.repeat(64),sourceSheet:'Budget',mappingVersion:'reviewed-1',currency:'USD',rows:[{glCode:'004110',name:'Rental income',monthly:monthly(0),sourceRow:8},{glCode:'004190',name:'Concessions',monthly:monthly(-25),sourceRow:9},{glCode:'006210',name:'Marketing',monthly:monthly(null),sourceRow:10},{glCode:'007110',name:'Budget only',monthly:monthly(40),sourceRow:11}]}};
const base={community_id:cid,period_key:period,publication_id:null,summary:{registryVersion:'atlas-finance-v1',communityId:cid,period,budgetVersion:budgetId,budgetContentHash:budgetHash,currency:'USD',revenue:{actual:null,budget:-25},coveragePolicy:{fullMonthAllowed:false,classification:'Pre-opening',reason:'This property has no full-month actuals before opening.'}}};
const close={version_id:'closed-1',community_id:cid,period_key:period,status:'closed',coverage:'full_month',content_hash:closeHash,source_hash:'d'.repeat(64),source_file:'actual.xlsx',row_count:4};
const details=[['004110','Rental income',0],['004190','Concessions',-30],['006210','Marketing',10],['008110','Actual only',2]].map(([gl_code,account_name,actual])=>({gl_code,account_name,actual,ytd_actual:null,version_id:close.version_id,community_id:cid,source_location:{sheet:'BCR',row:12}}));
const closed={...base,publication_id:'published-1',summary:{...base.summary,coveragePolicy:null,actualCloseVersion:close.version_id,actualContentHash:closeHash,close,revenue:{actual:-30,budget:-25}}};
const session=({record=base,versions=[budget],finance=()=>record,actor=()=> 'reader'}={})=>({getSession:()=>({user:{id:actor()}}),readCommunitiesForAccess:async()=>[{community_id:cid,display_name:'Fixture property'}],fetchJson:async path=>{
 if(path.startsWith('/rpc/'))return structuredClone([finance()]);
 if(path.startsWith('/atlas_approved_budget_versions?')){assert(path.includes(encodeURIComponent(budgetId)));return structuredClone(versions);}
 if(path.startsWith('/atlas_financial_close_versions?'))return structuredClone([close]);
 if(path.startsWith('/atlas_financial_close_rows?'))return structuredClone(details);
 if(path.startsWith('/atlas_community_aliases?'))return [];
 throw Error('Unexpected fixture request '+path);
}});
const first=await readBudgetSnapshot(session(),cid,period),second=await readBudgetSnapshot(session(),cid,period);assert.deepEqual(first,second);assert(Object.isFrozen(first.budget.rows[0]));assert.equal(first.financialSnapshot.fingerprint,financeSnapshot(base.summary,null).fingerprint);
const openMonth=await readBudgetSnapshot(session({record:{...base,summary:{...base.summary,coveragePolicy:{fullMonthAllowed:true,reason:'Earlier startup months are excluded.'}}}}),cid,period);assert.equal(openMonth.actualsReason,'No published full-month actuals are available for this period.','A policy about earlier months must not explain an open month that is allowed.');
const data=budgetReportRows(first);assert.deepEqual(data.map(r=>r.Original_budget),[0,-25,null,40]);assert(data.every(r=>r.Actual===null&&r.Actual_minus_budget===null&&r.Budget_version===budgetId&&r.Budget_content_hash===budgetHash));assert.equal(data[0].GL,'004110');assert(budgetReportHtml(first).includes(base.summary.coveragePolicy.reason));assert(budgetReportCsv(first).includes('"0","",""'));
const actual=await readCloseSnapshot(session({record:closed}),cid,period),combined=closeReportRows(actual);assert.equal(combined.length,5);const byGl=new Map(combined.map(r=>[r.GL,r]));assert.equal(byGl.get('004110').Actual_minus_budget,0);assert.equal(byGl.get('004190').Actual_minus_budget,-5);assert.equal(byGl.get('006210').Original_budget,null);assert.equal(byGl.get('006210').Actual_minus_budget,null);assert.equal(byGl.get('007110').Actual,null);assert.equal(byGl.get('008110').Original_budget,null);assert(combined.every(r=>r.Snapshot===financeSnapshot(closed.summary,closed.publication_id).fingerprint));assert(closeReportHtml(actual).includes('Approved original budget'));assert(closeReportCsv(actual).includes('"-30","","-25","-5"'));
async function evidence(bytes){const pdf=await PDFDocument.load(bytes),names=pdf.catalog.lookup(PDFName.of('Names'),PDFDict).lookup(PDFName.of('EmbeddedFiles'),PDFDict).lookup(PDFName.of('Names'),PDFArray),file=names.lookup(1,PDFDict),stream=file.lookup(PDFName.of('EF'),PDFDict).lookup(PDFName.of('F'),PDFRawStream);return {pdf,data:JSON.parse(new TextDecoder().decode(decodePDFRawStream(stream).decode()))};}
for(const [snapshot,rows,workbook,pdf,html,sheet] of [[first,data,budgetReportWorkbook,budgetReportPdf,budgetReportHtml,'Approved original budget'],[actual,combined,closeReportWorkbook,closeReportPdf,closeReportHtml,'Canonical actuals']]){
 const wb=workbook(snapshot,XLSX),reread=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});assert.deepEqual(XLSX.utils.sheet_to_json(reread.Sheets[sheet],{defval:null}),rows);
 const bytes=await pdf(snapshot),parsed=await evidence(bytes);assert.deepEqual(parsed.data.rows,JSON.parse(canonicalJson(rows)));assert.deepEqual(parsed.data.snapshot,snapshot.financialSnapshot);assert.equal(parsed.pdf.getSubject(),snapshot.financialSnapshot.fingerprint);assert(html(snapshot).includes(snapshot.financialSnapshot.fingerprint));
 if(process.env.ATLAS_OUTPUT_PROOF_DIR){await mkdir(process.env.ATLAS_OUTPUT_PROOF_DIR,{recursive:true});await writeFile(process.env.ATLAS_OUTPUT_PROOF_DIR+'/'+(sheet==='Canonical actuals'?'actual-budget':'approved-budget')+'.pdf',bytes);}
}
for(const change of [{community_id:'wrong'},{calendar_year:2029},{status:'working'},{version_id:'wrong'}])await assert.rejects(readBudgetSnapshot(session({versions:[{...budget,...change}]}),cid,period),/scope or status/);
for(const change of [{covered_months:[4]},{covered_months:[3,3]},{covered_months:null}])await assert.rejects(readBudgetSnapshot(session({versions:[{...budget,...change}]}),cid,period),/calendar month/);
await assert.rejects(readBudgetSnapshot(session({versions:[{...budget,content_hash:'a'.repeat(64)}]}),cid,period),/hash does not match/);
await assert.rejects(readBudgetSnapshot(session({versions:[budget,budget]}),cid,period),/scope or status/);
await assert.rejects(readBudgetSnapshot(session({versions:[{...budget,payload:{...budget.payload,year:2029}}]}),cid,period),/payload scope/);
await assert.rejects(readBudgetSnapshot(session({versions:[{...budget,payload:{...budget.payload,coverage:[4]}}]}),cid,period),/fiscal coverage/);
await assert.rejects(readBudgetSnapshot(session({versions:[{...budget,payload:{...budget.payload,rows:[...budget.payload.rows,budget.payload.rows[0]]}}]}),cid,period),/duplicate GL/);
await assert.rejects(readBudgetSnapshot(session({record:{...base,summary:{...base.summary,budgetContentHash:null}}}),cid,period),/hash is unavailable/);
await assert.rejects(readBudgetSnapshot(session({record:{...base,summary:{...base.summary,budgetVersion:null}}}),cid,period),/No canonical approved/);
let reads=0;await assert.rejects(readBudgetSnapshot(session({finance:()=>++reads===1?base:{...base,summary:{...base.summary,budgetContentHash:'e'.repeat(64)}}}),cid,period),/version changed/);
reads=0;await assert.rejects(readCloseSnapshot(session({finance:()=>++reads===1?closed:{...closed,summary:{...closed.summary,budgetVersion:'replaced'}}}),cid,period),/version changed/);
for(const [mount,record] of [[mountBudgetReport,base],[mountCloseReport,closed]]){
 const container={isConnected:true,innerHTML:'newer selected month'};let current=true;
 const delayed=session({record});const original=delayed.fetchJson;delayed.fetchJson=async path=>{const result=await original(path);if(path.startsWith('/atlas_approved_budget_versions?'))current=false;return result;};
 await mount(container,delayed,cid,period,{isCurrent:()=>current});assert.equal(container.innerHTML,'newer selected month','A late read may not replace a newer selection');
}
// Exercise the real entry point: excluded actuals must still expose an approved
// original budget, without reading a local model or source-statement comparison.
const status={textContent:''},result={isConnected:true,innerHTML:'',replaceChildren(){this.innerHTML='';},querySelectorAll:()=>[]},nodes={'[data-community]':{value:cid},'[data-period]':{value:period},'[data-load]':{},'[role=status]':status,'[data-comparison]':result},container={dataset:{},isConnected:true,innerHTML:'',querySelector:key=>nodes[key]};
globalThis.location={origin:'https://fixture.test',href:'https://fixture.test/report'};globalThis.window={parent:{location,atlasAccessDecision:()=>({ok:true}),ATLAS_CENTRAL:session()}};
await mountComparison(container,{communityName:'Fixture property',period,year:2028});assert(result.innerHTML.includes('Approved original budget'));assert(result.innerHTML.includes(base.summary.coveragePolicy.reason));assert(status.textContent.includes('Actuals remain unavailable'));
delete globalThis.window;delete globalThis.location;
console.log('PASS canonical approved-budget-only route including excluded actuals; exact immutable version/hash/calendar scope and duplicate guards; actual/budget GL union with zero/missing/negative variance; reload parity; identical screen/CSV/XLSX/PDF fingerprint and exact embedded rows.');
