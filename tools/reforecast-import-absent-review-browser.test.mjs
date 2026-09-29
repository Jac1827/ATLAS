// Actual import controls, source authority and native recovery; no server writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {parseReforecastWorkbook} from '../docs/portfolio-operations-dashboard/features/reforecast-intake.mjs';
import {prepareScopedReforecastEvidence} from '../docs/portfolio-operations-dashboard/features/reforecast-authority.mjs';
import {reviewPlanningInputs} from '../docs/portfolio-operations-dashboard/features/planning-governance.mjs';
import {reforecastMappingFromReview,evaluateReforecastImportReview} from '../docs/portfolio-operations-dashboard/features/reforecast-import-ui.mjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright'),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const root=path.resolve(import.meta.dirname,'..'),cid='10000000-0000-0000-0000-000000000001',actor='20000000-0000-0000-0000-000000000001',periods=['2026-02','2026-03'];
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Scenario','Plan'],['GL','Account','Feb 2026','Mar 2026'],['5120','Rent',100,101],['6100','Payroll',0,null]]),'Plan');
const evidence=await parseReforecastWorkbook(XLSX.write(book,{type:'array',bookType:'xlsx'}),{xlsx:XLSX,fileName:'Absent scope fixture.xlsx',includeOriginalBytes:true});
const accounts=[{accountCode:'5120',name:'Rent',category:'Revenue',nature:'income',placement:'above_noi'},{accountCode:'6100',name:'Payroll',category:'Expenses',nature:'expense',placement:'above_noi'},{accountCode:'8100',name:'Absent source account',category:'Expenses',nature:'expense',placement:'above_noi'}];
const assignment={communityId:cid,actorId:actor,confirmed:true,explicit:true,assignedAt:new Date().toISOString(),reason:'Reviewed synthetic source community',sourceEntities:evidence.metadata.entities};
const data={evidence,source:{communityId:cid,sourceVersion:'a'.repeat(64),registry:{version:'reviewed-fixture',accounts},baseline:{lines:accounts.flatMap(account=>periods.map(period=>({period,accountCode:account.accountCode,amount:account.accountCode==='8100'?20:100})))},actuals:{cutoffPeriod:'2026-01'}},assignment,actor,scenario:'Plan',currency:'USD',periods,calendar:{basis:'calendar',startMonth:1,periods,scenario:'Plan',confirmed:true,reviewedBy:actor,reviewedAt:new Date().toISOString()},accountChoices:Object.fromEntries(evidence.lines.map(line=>[JSON.stringify([line.sheet,line.accountCode,line.department]),{accountCode:line.accountCode,signMultiplier:'1',allowReversal:false}])),selectedLineIds:evidence.lines.map(line=>line.id),reason:'Use exact source values and preserve blanks',confirmed:true,reviewerId:actor,preserveWorkbookBlanks:true,outsideForecastScope:periods.map(period=>({period,accountCode:'8100'})),reviewedForecastBlanks:[],reviewedForecastBlankReason:'Keep absent accounts editable and blank',sourceRowExclusions:[],integrityReviews:[],destination:'new',recordType:'reforecast',forecastName:'Isolated absent source review'};
const {mapping}=reforecastMappingFromReview(data),scoped=await prepareScopedReforecastEvidence(evidence,mapping,{xlsx:XLSX});
Object.assign(data,{evidence:scoped.evidence,scopeSelectionKey:scoped.selectionKey,scopedFingerprint:scoped.evidence.integrity.fingerprint,inputReviews:reviewPlanningInputs(scoped.evidence,data.selectedLineIds,{reason:'Reviewed all selected source inputs',ownerId:actor})});
const initial=evaluateReforecastImportReview(data,[cid]);assert.equal(initial.ready,true,JSON.stringify(initial.issues));
let server,browser;
try{
 server=createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><dialog open><p data-status></p><div data-body></div></dialog>');return;}
  const url=new URL(req.url,'http://fixture'),filename=path.resolve(root,'.'+url.pathname);if(!filename.startsWith(root+path.sep))throw Error('Outside fixture');
  let text=await fs.readFile(filename,'utf8');
  if(url.pathname.endsWith('/reforecast-import-ui.mjs')){if(process.env.ATLAS_IMPORT_UI_SOURCE)text=await fs.readFile(process.env.ATLAS_IMPORT_UI_SOURCE,'utf8');text+='\nexport {renderMapping,readReviewFields,previewReview,prepareRecovery};\n';}
  res.setHeader('content-type','text/javascript');res.end(text);
 }catch(error){res.writeHead(404);res.end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 await page.evaluate(async data=>{
  window.ui=await import('/docs/portfolio-operations-dashboard/features/reforecast-import-ui.mjs');window.fixture=data;
  window.state={...structuredClone(data),selected:new Set(data.selectedLineIds),communities:[{community_id:data.assignment.communityId,display_name:'Synthetic community'}],el:document.querySelector('dialog'),central:{getSession:()=>({user:{id:data.actor},access_token:'isolated-fixture',expires_at:Math.floor(Date.now()/1000)+3600}),fetchJson:()=>{throw Error('No financial RPC is permitted by this control regression');}}};
  await ui.prepareRecovery(state);ui.renderMapping(state);
 },data);
 const absent=()=>page.locator('summary').filter({hasText:'Accounts absent from this workbook'}),review=async()=>{await page.locator('[data-confirm-mapping]').check();await page.locator('[data-check]').click();return page.evaluate(()=>{const result=ui.previewReview(state);return {ready:result.ready,issues:result.issues,inheritance:result.inheritance,mapping:result.mapping,key:state.scopeSelectionKey,inputs:state.inputReviews};});};
 await absent().click();assert.equal(await page.locator('[data-outside-scope]:checked').count(),2);
 for(const item of await page.locator('[data-outside-scope]').all())await item.uncheck();
 assert.equal(await page.locator('[data-confirm-mapping]').isChecked(),false,'Changing absent decisions still requires mapping reconfirmation');
 assert.equal(await page.evaluate(()=>ui.previewReview(state).ready),false,'An unconfirmed mapping is never saveable');
 let result=await review();assert.equal(result.ready,true,JSON.stringify(result.issues));assert.equal(result.key,scoped.selectionKey,'Clearing only absent-source exclusions preserves the exact reviewed workbook authority');assert.deepEqual(result.inputs,data.inputReviews);
 assert.match(await page.locator('[data-review-status]').innerText(),/Ready to save a draft with unresolved source scope/);
 assert.match(await page.locator('[data-review-status]').innerText(),/2 absent source cells stay unresolved and blank.*Submission and publication remain blocked/);
 assert.deepEqual(result.mapping.workbookSourcePolicy.outsideForecastScope,[]);assert.deepEqual(result.mapping.workbookSourcePolicy.reviewedForecastBlanks,[]);
 assert.equal(result.inheritance.cells.length,2);assert(result.inheritance.cells.every(cell=>cell.pendingSourceReview&&cell.inheritedAmount===null&&cell.baselineAmount===20),'Pending source absence stays null with the original comparison; it is not a scope approval');
 // Individual and bulk changes between all three dispositions retain the same
 // workbook proof but never reuse the previous mapping confirmation.
 await page.locator('[data-reviewed-forecast-blank]').first().check();result=await review();assert.equal(result.ready,true,JSON.stringify(result.issues));assert.equal(result.inheritance.reviewedForecastBlanks.length,1);assert.equal(result.inheritance.cells.filter(cell=>cell.pendingSourceReview).length,1);assert.equal(result.key,scoped.selectionKey);
 await page.locator('[data-review-absent-blanks]').click();assert.equal(await page.locator('[data-confirm-mapping]').isChecked(),false);result=await review();assert.equal(result.ready,true,JSON.stringify(result.issues));assert.equal(result.inheritance.reviewedForecastBlanks.length,2);assert.equal(result.key,scoped.selectionKey);
 await absent().click();await page.locator('[data-exclude-absent]').click();assert.equal(await page.locator('[data-confirm-mapping]').isChecked(),false);result=await review();assert.equal(result.ready,true,JSON.stringify(result.issues));assert.equal(result.mapping.workbookSourcePolicy.outsideForecastScope.length,2);assert.equal(result.mapping.workbookSourcePolicy.reviewedForecastBlanks.length,0);assert.equal(result.key,scoped.selectionKey);
 // Genuine source-scope changes must still fail without a fresh authority review.
 await page.locator('summary').filter({hasText:'Choose source rows, including duplicates'}).click();await page.locator('[data-line-index]').first().uncheck();result=await review();assert.equal(result.ready,false);assert(result.issues.some(issue=>issue.code==='forecast_authority_scope_required'));
 await page.locator('[data-line-index]').first().check();result=await review();assert.equal(result.ready,true,JSON.stringify(result.issues));
 const mismatches=await page.evaluate(()=>{const before=structuredClone(state.evidence.source);state.evidence.source.sha256='f'.repeat(64);const result=ui.previewReview(state);state.evidence.source=before;return {ready:result.ready,issues:result.issues};});assert.equal(mismatches.ready,false);assert(mismatches.issues.some(issue=>issue.code==='forecast_authority_scope_required'));
 await page.locator('[data-preserve-blanks]').uncheck();result=await review();assert.equal(result.ready,false);assert.equal(result.key,null);assert(result.issues.some(issue=>issue.code==='forecast_authority_scope_required'));
 await page.evaluate(()=>state.recoveryPromise);assert.deepEqual(errors,[]);
 console.log('PASS absent-account review controls: pending-null draft remains saveable after reconfirmation; individual and bulk intentional-blank/exclusion decisions preserve exact source authority; changed source selection/hash/policy still block; comparisons, input reviews and no-server-write boundary retained.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
