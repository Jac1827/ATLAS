// Exercises actual repo UI modules with native Chromium controls and IndexedDB.
// CI uses generated large-shape data; DORO_FIXTURE optionally proves the same
// controls against retained source rows. This does not authorize financial values.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {currentReforecastParserVersion} from '../docs/portfolio-operations-dashboard/features/reforecast-parser-recovery.mjs';
function syntheticFixture(){
 const periods=['2026-09','2026-10','2026-11','2026-12'],actor='10000000-0000-0000-0000-000000000001',communityId='10000000-0000-0000-0000-000000000002';
 const accounts=Array.from({length:292},(_,i)=>({accountCode:String(1000+i),name:'Synthetic account '+i,category:'Operating expenses',nature:'expense',placement:'above_noi'}));
 const lines=Array.from({length:446},(_,i)=>periods.map((period,month)=>({id:'Input!'+String.fromCharCode(71+month)+(i+20),sheet:'Input',address:String.fromCharCode(71+month)+(i+20),row:i+20,column:7+month,accountCode:i<271?accounts[i].accountCode:'source-'+i,accountName:'Synthetic source '+i,department:'Department '+i%3,scenario:'Plan',period,amount:i%4===3?null:((i+1)*(month+1))%37,sourceKind:'workbook_forecast',rowDisposition:'business_line'}))).flat();
 const integrity={fingerprint:'a'.repeat(64),inventory:{sheets:[]},graph:{nodes:[],edges:[]},findings:[]};
 const evidence={parserVersion:currentReforecastParserVersion,source:{fileName:'Synthetic large mapping.xlsx',sha256:'b'.repeat(64)},lines,sheets:[],issues:[],metadata:{entities:['Synthetic community'],currencies:['USD']},integrity};
 const baseline={lines:accounts.flatMap((account,index)=>periods.map((period,month)=>({...account,period,amount:(index+1)*(month+1)})))};
 const assignment={communityId,actorId:actor,explicit:true,confirmed:true,reason:'Synthetic fixture assignment'};
 const accountMappings=lines.filter(line=>line.period===periods[0]&&accounts.some(account=>account.accountCode===line.accountCode)).map(line=>({...accounts.find(account=>account.accountCode===line.accountCode),sourceAccountCode:line.accountCode,sheet:line.sheet,department:line.department,signMultiplier:1,allowReversal:false}));
 return {evidence,registry:{version:'synthetic-reviewed-v1',accounts},baseline,mapping:{sourceScenario:'Plan',periods,accountMappings,propertyAssignment:assignment,currency:'USD',calendar:{basis:'calendar',startMonth:1,confirmed:true,periods,scenario:'Plan'},reason:'Synthetic reviewed source scope',reviewedBy:actor,selectedLineIds:lines.filter(line=>accountMappings.some(account=>account.sourceAccountCode===line.accountCode)).map(line=>line.id)},proposedScope:accounts.slice(271).flatMap(account=>periods.map(period=>({period,accountCode:account.accountCode})))};
}
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const root=path.resolve(import.meta.dirname,'..');
const fixturePath=process.env.DORO_FIXTURE;
const fixture=fixturePath?JSON.parse(await fs.readFile(fixturePath,'utf8')):syntheticFixture();
const {evidence,mapping,registry,baseline}=fixture;
const lines=evidence.lines.filter(row=>row.scenario===mapping.sourceScenario&&mapping.periods.includes(row.period));
const groups=[...new Map(lines.map(line=>[JSON.stringify([line.sheet,line.accountCode,line.department]),line])).entries()];
const accountChoices=Object.fromEntries(groups.map(([key,line])=>[key,mapping.accountMappings.find(m=>m.sourceAccountCode===line.accountCode&&(!m.sheet||m.sheet===line.sheet)&&(!Object.hasOwn(m,'department')||m.department===line.department))]).filter(([,choice])=>choice).map(([key,m])=>[key,{accountCode:m.accountCode,signMultiplier:String(m.signMultiplier),allowReversal:m.allowReversal}]));
const excludedLine=lines.find(line=>Number.isFinite(line.amount));
const data={evidence:{...evidence,sheets:[],issues:[],integrity:{...evidence.integrity,inventory:{sheets:[]},graph:{nodes:[],edges:[]},findings:[]},source:{...evidence.source,originalFile:undefined}},source:{registry,baseline,actuals:{cutoffPeriod:'2026-08'}},assignment:mapping.propertyAssignment,scenario:mapping.sourceScenario,periods:mapping.periods,currency:mapping.currency,calendar:mapping.calendar,reason:mapping.reason,accountChoices,actor:mapping.reviewedBy,selectedLineIds:mapping.selectedLineIds.filter(id=>id!==excludedLine.id),sourceRowExclusions:[{sourceLineId:excludedLine.id,confirmed:true,reason:'Isolated explicit source exclusion review'}],outsideForecastScope:fixture.proposedScope||[],preserveWorkbookBlanks:true};
const sourceHashes={};
let server,browser;
try{
 server=createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><button id="before">Before form</button><dialog open class="rfi"><p data-status></p><div data-body></div></dialog>');return;}
  const url=new URL(req.url,'http://local'),filename=path.resolve(root,'.'+url.pathname);if(!filename.startsWith(root+path.sep))throw Error('outside fixture');
  let text=await fs.readFile(filename,'utf8');if(/\/(workbook-audit-store|reforecast-import-ui|reforecast-ui|reforecast-session-scope)\.mjs$/.test(url.pathname))sourceHashes[path.basename(filename)]=createHash('sha256').update(text).digest('hex');if(url.pathname.endsWith('/reforecast-import-ui.mjs'))text+='\nexport {renderMapping,readReviewFields,prepareRecovery};\n';if(url.pathname.endsWith('/reforecast-ui.mjs'))text+='\nexport {resumeImportsDialog};\n';
  res.setHeader('content-type','text/javascript');res.end(text);
 }catch(error){res.writeHead(404);res.end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const renderMs=await page.evaluate(async data=>{
  window.ui=await import('/docs/portfolio-operations-dashboard/features/reforecast-import-ui.mjs');
  window.state={...data,selected:new Set(data.selectedLineIds),communities:[{community_id:data.assignment.communityId,display_name:'Fixture community'}],el:document.querySelector('dialog'),destination:'new',recordType:'reforecast',forecastName:'Isolated selector regression',confirmed:false};
  state.central={getSession:()=>({user:{id:state.actor},access_token:'synthetic-only',expires_at:Math.floor(Date.now()/1000)+3600})};state.scopedFingerprint=state.evidence.integrity.fingerprint;await ui.prepareRecovery(state);
  const start=performance.now();ui.renderMapping(state);return performance.now()-start;
 },data);
 const targets=page.locator('[data-target]');assert.equal(await targets.count(),groups.length);
 const optionCount=await page.locator('[data-target] option').count();assert(optionCount<=groups.length*2,`${optionCount} options should remain bounded by selected values, not the registry cross-product`);
 const first=targets.first();
 await first.evaluate(el=>{const before=document.createElement('button');before.id='keyboard-before-target';before.textContent='Before target';el.before(before);});
 await page.locator('#keyboard-before-target').focus();await page.keyboard.press('Tab');assert.equal(await first.evaluate(el=>el===document.activeElement),true,'Keyboard Tab reaches the native selector');assert.equal(await first.locator('option').count(),registry.accounts.length+1,'Keyboard focus expands every reviewed registry option');
 await first.selectOption(registry.accounts.at(-1).accountCode);await first.press('Tab');assert.equal(await first.inputValue(),registry.accounts.at(-1).accountCode);assert.equal(await first.locator('option').count(),2,'Leaving the native selector retains its chosen account without the full registry');
 const second=targets.nth(1);await second.click();assert.equal(await second.locator('option').count(),registry.accounts.length+1,'Pointer access expands every reviewed registry option');await second.selectOption(registry.accounts[0].accountCode);await page.locator('[data-forecast-name]').focus();assert.equal(await second.inputValue(),registry.accounts[0].accountCode);assert.equal(await second.locator('option').count(),2,'Pointer-opened native picker keeps the selected account');
 const saved=await page.evaluate(()=>{ui.readReviewFields(state);const before={choices:structuredClone(state.accountChoices),selected:[...state.selected],outside:structuredClone(state.outsideForecastScope),exclusions:structuredClone(state.sourceRowExclusions)};ui.renderMapping(state);ui.readReviewFields(state);return {before,after:{choices:state.accountChoices,selected:[...state.selected],outside:state.outsideForecastScope,exclusions:state.sourceRowExclusions}};});
 assert.equal(JSON.stringify(saved.after.choices),JSON.stringify(saved.before.choices),'Rerender preserves every target choice');assert.deepEqual(saved.after.selected,saved.before.selected);assert.equal(JSON.stringify(saved.after.exclusions),JSON.stringify(saved.before.exclusions),'Rerender preserves per-source exclusion controls');assert.deepEqual(saved.after.outside,saved.before.outside.filter(row=>![registry.accounts[0].accountCode,registry.accounts.at(-1).accountCode].includes(row.accountCode)),'Only scope exclusions that the new mapping now supplies leave the absent-account list');
 assert.equal(await targets.first().inputValue(),registry.accounts.at(-1).accountCode);assert.equal(await targets.nth(1).inputValue(),registry.accounts[0].accountCode);
 await targets.first().focus();await targets.first().selectOption('');await targets.first().press('Tab');assert.equal(await targets.first().inputValue(),'','Clearing the selection remains an explicit unmapped account');assert.equal(await targets.first().locator('option').count(),1);
 // Save native controls through the actual input/change recovery handlers, then
 // reload the browser document and recover through the actual IndexedDB module.
 await page.locator('[data-forecast-name]').fill('Recovered native mapping regression');
 await page.locator('[data-mapping-reason]').fill('Reviewed source scope and explicit blanks');
 const numericReview=page.locator('[data-exclusion-review]').first();
 await numericReview.evaluate(el=>el.closest('details').open=true);
 await page.locator('[data-exclusion-reason]').first().fill('Reviewed numeric source omission after edit');
 await numericReview.check();
 const recoveryBefore=await page.evaluate(async()=>{
  ui.readReviewFields(state);await state.recoveryPromise;
  const {readForecastRecovery}=await import('/docs/portfolio-operations-dashboard/features/reforecast-recovery.mjs');
  const saved=await readForecastRecovery(state.central,state.reviewId);
  const project=s=>({forecastName:s.forecastName,reason:s.reason,choices:s.accountChoices,selected:[...s.selected],preserveWorkbookBlanks:s.preserveWorkbookBlanks,outside:s.outsideForecastScope,exclusions:s.sourceRowExclusions});
  const expected=project(state),actual=project({...saved.fields,selected:saved.selected});
  return {expected,actual,reviewId:state.reviewId};
 });
 assert.deepEqual(recoveryBefore.actual,recoveryBefore.expected,'Actual field events persist the exact review, selections and scope');
 assert(recoveryBefore.expected.preserveWorkbookBlanks);
 assert(recoveryBefore.expected.outside.length>0,'Scope review fixture exercises retained outside-forecast fields');
 assert(recoveryBefore.expected.exclusions.some(row=>row.confirmed&&row.reason==='Reviewed numeric source omission after edit'));
 await page.reload();
 const recoveryAfter=await page.evaluate(async data=>{
  window.ui=await import('/docs/portfolio-operations-dashboard/features/reforecast-import-ui.mjs');
  window.state={...data,selected:new Set(data.selectedLineIds),communities:[{community_id:data.assignment.communityId,display_name:'Fixture community'}],el:document.querySelector('dialog'),destination:'new',recordType:'reforecast',forecastName:'Default new name',confirmed:false};
  state.central={getSession:()=>({user:{id:state.actor},access_token:'synthetic-only',expires_at:Math.floor(Date.now()/1000)+3600})};state.scopedFingerprint=state.evidence.integrity.fingerprint;
  await ui.prepareRecovery(state);ui.renderMapping(state);ui.readReviewFields(state);await state.recoveryPromise;
  return {reviewId:state.reviewId,forecastName:state.forecastName,reason:state.reason,choices:state.accountChoices,selected:[...state.selected],preserveWorkbookBlanks:state.preserveWorkbookBlanks,outside:state.outsideForecastScope,exclusions:state.sourceRowExclusions};
 },data);
 assert.equal(recoveryAfter.reviewId,recoveryBefore.reviewId);
 const {reviewId:_,...reopened}=recoveryAfter;assert.deepEqual(reopened,recoveryBefore.expected,'Reload recovers the same review through native IndexedDB');
 assert.equal(await page.locator('[data-forecast-name]').inputValue(),recoveryBefore.expected.forecastName);
 assert.equal(await targets.first().inputValue(),'');
 assert.equal(await targets.nth(1).inputValue(),registry.accounts[0].accountCode);
 assert(await page.locator('[data-target] option').count()<=groups.length*2);
 // Exercise the genuine chooser and resume loader without remote services or
 // writes. Hold the upload first, then one audit chunk, before a transport error.
 await page.evaluate(async()=>{
  document.querySelector('dialog').remove();
  const {workbookEvidenceHash}=await import('/docs/portfolio-operations-dashboard/features/workbook-integrity.mjs');
  const {resumeImportsDialog}=await import('/docs/portfolio-operations-dashboard/features/reforecast-ui.mjs');
  const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const SIZE=192*1024,audit={schemaVersion:'synthetic',inventory:{sheets:[]},text:'Retained evidence '.repeat(25000)};audit.fingerprint=workbookEvidenceHash(audit);
  const auditBytes=new TextEncoder().encode(JSON.stringify(audit)),sourceBytes=new Uint8Array([80,75,3,4]);
  const sourceHash=await hash(sourceBytes),manifest={schemaVersion:'atlas.workbook-audit-upload.v1',sourceHash,fingerprint:audit.fingerprint,chunkBytes:SIZE,audit:{byteLength:auditBytes.length,sha256:await hash(auditBytes),chunkCount:Math.ceil(auditBytes.length/SIZE)},source:{byteLength:sourceBytes.length,sha256:sourceHash,chunkCount:1}},manifestHash=workbookEvidenceHash(manifest);
  const uploadId='20000000-0000-0000-0000-000000000002',auditId='30000000-0000-0000-0000-000000000003',cid=state.assignment.communityId,actor=state.actor;
  const upload={upload_id:uploadId,community_id:cid,payload:{parserVersion:state.evidence.parserVersion,source:{sha256:sourceHash,fileName:'Synthetic.xlsx'},propertyAssignment:state.assignment,integrity:{auditId,manifestHash,sourceHash,fingerprint:audit.fingerprint}}};
  window.progressTest={rejectPending:[],readNames:[]};
  const central={getSession:()=>({user:{id:actor},access_token:'synthetic-only',expires_at:Math.floor(Date.now()/1000)+3600}),async fetchJson(url){
   if(url.includes('upload_id=eq.'))return new Promise(resolve=>progressTest.releaseUpload=()=>resolve([upload]));
   return [{upload_id:uploadId,community_id:cid,file_name:'Synthetic.xlsx',source_hash:sourceHash,created_at:'2026-09-28T00:00:00Z'}];
  },async rpc(name,args){
   progressTest.readNames.push(name);
   if(name==='atlas_read_workbook_audit_manifest')return {audit_id:auditId,source_hash:sourceHash,fingerprint:audit.fingerprint,manifest,manifest_hash:manifestHash};
   if(name!=='atlas_read_workbook_audit_chunk')throw Error('Unexpected request');
   if(args.p_index!==0)return new Promise((_,reject)=>progressTest.rejectPending.push(reject));
   const part=auditBytes.subarray(0,SIZE);let raw='';for(let start=0;start<part.length;start+=8192)raw+=String.fromCharCode(...part.subarray(start,start+8192));
   return {chunk_index:0,stream:'audit',data:btoa(raw),sha256:await hash(part)};
  }};
  await resumeImportsDialog({central,cid,actor,communities:state.communities});
 });
 const chooser=page.locator('dialog.rf-dialog'),status=chooser.locator('[data-status]');
 await chooser.locator('[data-saved-upload]').selectOption('20000000-0000-0000-0000-000000000002');await chooser.locator('[data-resume]').click();
 assert.match(await status.innerText(),/Reading and verifying the saved workbook evidence/,'Loading feedback is visible before the upload response or new mapping dialog');assert.equal(await page.locator('dialog.rfi').count(),0);
 await page.evaluate(()=>progressTest.releaseUpload());await page.waitForFunction(()=>document.querySelector('dialog.rf-dialog [data-status]')?.textContent.includes('1 of 3 parts'));
 assert.equal(await chooser.locator('[data-resume]').isDisabled(),true);assert.equal(await page.locator('dialog.rfi').count(),0,'Verified chunk progress is forwarded before mapping state is created');
 await page.evaluate(()=>progressTest.rejectPending.forEach(reject=>reject(Error('Synthetic transport stop'))));await page.waitForFunction(()=>!document.querySelector('dialog.rf-dialog [data-resume]').disabled);
 assert.match(await status.innerText(),/Synthetic transport stop/);assert.equal(await page.locator('dialog.rfi').count(),0);assert((await page.evaluate(()=>progressTest.readNames)).every(name=>name.startsWith('atlas_read_')));
 assert.deepEqual(errors,[]);
 const report={sourceGroups:groups.length,sourceRows:lines.length,registryAccounts:registry.accounts.length,initialOptions:optionCount,oldInitialOptionCount:groups.length*(registry.accounts.length+1),renderMs:Math.round(renderMs),keyboardFocusPassed:true,pointerFocusPassed:true,nativeSelectionValuePassed:true,rerenderPreserved:true,unmappedPlaceholderPassed:true,immediateChooserProgressPassed:true,chunkProgressBeforeStatePassed:true,failedReadRecoveryPassed:true,nativeIndexedDBReloadPassed:true};
 console.log(JSON.stringify({...report,sourceHashes,fixture:fixturePath?'provided workbook':'synthetic large mapping'}));
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
