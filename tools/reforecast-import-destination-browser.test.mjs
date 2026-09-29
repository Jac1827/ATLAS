// Local-only destination regression: real dialogs, request construction, receipt
// transport, and IndexedDB. Workbook persistence and server responses are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {currentReforecastParserVersion} from '../docs/portfolio-operations-dashboard/features/reforecast-parser-recovery.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright'),root=path.resolve(import.meta.dirname,'..');
const actor='10000000-0000-0000-0000-000000000001',cid='10000000-0000-0000-0000-000000000002',draftA='10000000-0000-0000-0000-000000000003',draftB='10000000-0000-0000-0000-000000000004',uploadId='10000000-0000-0000-0000-000000000005',periods=['2026-09'];
const data={actor,cid,draftA,draftB,uploadId,periods,parserVersion:currentReforecastParserVersion};
let server,browser;
try{
 server=createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><dialog open class="rfi"><p data-status></p><div data-body></div></dialog>');return;}
  const url=new URL(req.url,'http://local'),filename=path.resolve(root,'.'+url.pathname);if(!filename.startsWith(root+path.sep))throw Error('Outside fixture');let text=await fs.readFile(filename,'utf8');
  if(url.pathname.endsWith('/reforecast-import-ui.mjs')){
   // The test begins with a reviewed, retained source. Only the separate upload
   // boundary is stubbed; finish's destination callback and recovery run unchanged.
   const boundary='if(result.ready)await saveScopedEvidence(state);';assert.equal(text.split(boundary).length,2);text=text.replace(boundary,'if(result.ready)await globalThis.fixtureSaveScopedEvidence(state);');
   text+='\nexport {renderMapping,readReviewFields,prepareRecovery,finish};';
  }
  if(url.pathname.endsWith('/reforecast-ui.mjs'))text+='\nexport {applyWorkbookImport};';
  res.setHeader('content-type','text/javascript');res.end(text);
 }catch(error){res.writeHead(404);res.end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const setup=async()=>page.evaluate(async data=>{
  const {actor,cid,draftA,draftB,uploadId,periods,parserVersion}=data;
  window.ui=await import('/docs/portfolio-operations-dashboard/features/reforecast-import-ui.mjs');window.forecastUi=await import('/docs/portfolio-operations-dashboard/features/reforecast-ui.mjs');window.recovery=await import('/docs/portfolio-operations-dashboard/features/reforecast-recovery.mjs');
  window.calls=[];window.receiptUnavailable=false;window.retentionChecks=[];window.sourceSaves=0;window.fixtureSaveScopedEvidence=async()=>{sourceSaves++;};
  const source={communityId:cid,periods,sourceVersion:'c'.repeat(64),registry:{version:'synthetic-registry',accounts:[{accountCode:'4000',nature:'income',placement:'above_noi'}]},baseline:{sourceType:'original_budget',versionIds:[],lines:[{period:periods[0],accountCode:'4000',amount:100}]},actuals:{cutoffPeriod:'2026-08'}};
  const entry=(scenarioId,name)=>({head:{community_id:cid,scenario_id:scenarioId,revision:3,status:'working_draft'},revision:{payload:{name,periods,baselineType:'original_budget',calendar:{basis:'calendar',startMonth:1,confirmed:true},drivers:[],overrides:[],history:[]}},source});
  window.entries=[entry(draftA,'Earlier draft'),entry(draftB,'Chosen working draft')];
  window.central={getSession:()=>({user:{id:actor},access_token:'synthetic-only',expires_at:Math.floor(Date.now()/1000)+3600}),getStoredProfile:()=>({role:'admin'}),async fetchJson(url,options){
   const body=options?.body?JSON.parse(options.body):null;calls.push({url,body});
   if(url==='/rpc/atlas_read_reforecast_workspace')return structuredClone(entries);
   if(url.startsWith('/atlas_reforecast_publications?'))return [];
   if(['/rpc/atlas_read_reforecast_source','/rpc/atlas_read_reforecast_builder_source'].includes(url))return structuredClone(source);
   if(url==='/rpc/atlas_read_reforecast_import_receipt'){if(receiptUnavailable)throw Error('Synthetic receipt unavailable');return null;}
   if(url==='/rpc/atlas_create_reforecast_from_import'){
    const review=await recovery.readForecastRecovery(central,state.reviewId),pending=await recovery.readForecastRecovery(central,'import-write:'+state.reviewId);
    retentionChecks.push({destination:review.fields.destination,currentDraft:review.fields.currentDraft,reviewVersion:review.reviewVersion,requestReviewVersion:pending.reviewVersion});
    throw Error('Synthetic atomic save failed');
   }
   throw Error('Unexpected synthetic transport: '+url);
  }};
  window.workspace={central,actor,cid,entries,record:entries[0],edit:structuredClone(entries[0].revision.payload),source,scenarioId:draftA,epoch:0,viewEpoch:0,dirty:false,container:{isConnected:false}};
  const evidence={parserVersion,source:{fileName:'Synthetic destination.xlsx',sha256:'b'.repeat(64)},metadata:{entities:[],currencies:['USD']},lines:[{id:'Input!A1',sheet:'Input',address:'A1',row:1,column:1,accountCode:'4000',amount:100,period:periods[0],scenario:'Plan',sourceKind:'workbook_forecast_evidence'}],sheets:[],issues:[],integrity:{fingerprint:'a'.repeat(64),inventory:{sheets:[]},graph:{nodes:[],edges:[]},findings:[]}};
  window.state={central,actor,assignment:{communityId:cid,actorId:actor,explicit:true,confirmed:true,reason:'Synthetic assignment'},evidence,source,periods,scenario:'Plan',currency:'USD',reason:'Original reviewed reason',confirmed:true,calendar:{basis:'calendar',startMonth:1,confirmed:true},accountChoices:{'["Input","4000",null]':{accountCode:'4000',signMultiplier:'1'}},preserveWorkbookBlanks:true,outsideForecastScope:[],reviewedForecastBlanks:[],reviewedForecastBlankReason:'',communities:[{community_id:cid,display_name:'Synthetic'}],selected:new Set(['Input!A1']),upload:{upload_id:uploadId},el:document.querySelector('dialog'),destination:'new',currentDraft:{scenarioId:draftA,name:'Earlier draft'},forecastName:'Forecast import',scopedFingerprint:evidence.integrity.fingerprint,onSaved:result=>forecastUi.applyWorkbookImport(workspace,result)};
  await ui.prepareRecovery(state);ui.renderMapping(state);
  // Destination behavior starts after successful mapping validation, which has
  // separate tests. Use the actual finish callback with one reviewed source cell.
  state.el.querySelector('[data-apply]').onclick=async()=>{try{ui.readReviewFields(state);await ui.finish(state,{ready:true,issues:[],mapping:{version:'synthetic-registry',confirmed:true,reason:state.reason,periods,calendar:state.calendar,selectedLineIds:['Input!A1']},lines:[{period:periods[0],accountCode:'4000',sourceLineId:'Input!A1',amount:100}]});}catch(error){state.el.querySelector('[data-status]').textContent=error.message;}};
 },data);
 const save=page.locator('[data-apply]'),destination=page.locator('[data-destination]'),status=page.locator('.rfi [data-status]');
 const written=()=>page.evaluate(()=>calls.filter(row=>row.url==='/rpc/atlas_create_reforecast_from_import').map(row=>row.body));
 const awaitFailure=async count=>{await page.waitForFunction(count=>calls.filter(row=>row.url==='/rpc/atlas_create_reforecast_from_import').length===count&&!state.busy,count);assert.match(await status.innerText(),/Synthetic atomic save failed.*No committed receipt was found/);};
 await setup();await save.click();await page.locator('[data-existing-draft]').selectOption(draftB);await page.locator('[data-import-update]').click();await awaitFailure(1);
 assert.equal(await destination.inputValue(),'current');assert.match(await destination.locator('option:checked').innerText(),/Chosen working draft/);
 const first=(await written())[0];assert.equal(first.p_scenario_id,draftB);assert.equal(first.p_expected_revision,3);
 const retained=await page.evaluate(()=>retentionChecks[0]);assert.equal(retained.destination,'current');assert.deepEqual(retained.currentDraft,{scenarioId:draftB,name:'Chosen working draft'});assert.equal(retained.reviewVersion,retained.requestReviewVersion,'Modal selection must reach durable review recovery before the atomic request');
 await page.locator('[data-mapping-reason]').fill('Corrected concise reason');await save.click();await awaitFailure(2);assert.equal(await page.locator('[data-existing-draft]').count(),0,'Pending request skips a second modal');
 const second=(await written())[1];assert.equal(second.p_scenario_id,draftB);assert.equal(second.p_expected_revision,3);assert.notEqual(second.p_request_id,first.p_request_id);assert.equal(second.p_mapping.reason,'Corrected concise reason');assert.equal(await destination.inputValue(),'current');
 await save.click();await awaitFailure(3);assert.deepEqual((await written())[2],second,'Unchanged retry keeps exact request ID and body');
 // Actual IndexedDB survives navigation. The recovered destination remains B
 // even though the separately open workspace initially points to A.
 await page.reload();await setup();assert.equal(await destination.inputValue(),'current');assert.match(await destination.locator('option:checked').innerText(),/Chosen working draft/);
 await page.locator('[data-mapping-reason]').fill('Another explicit corrected reason');await save.click();await page.waitForFunction(()=>!state.busy);assert.match(await status.innerText(),/Open the working draft selected/);assert.equal((await written()).length,0);assert.equal(await page.evaluate(()=>calls.filter(row=>row.url==='/rpc/atlas_read_reforecast_builder_source').length),0,'Wrong open draft blocks before source read or write');
 await page.evaluate(()=>{workspace.record=entries[1];workspace.scenarioId=entries[1].head.scenario_id;workspace.edit=structuredClone(entries[1].revision.payload);});await save.click();await awaitFailure(1);assert.equal((await written())[0].p_scenario_id,draftB);
 // A later explicit choice of New must win, while still checking the old receipt.
 await destination.selectOption('new');await save.click();await awaitFailure(2);const fresh=(await written())[1];assert.equal(fresh.p_expected_revision,0);assert.notEqual(fresh.p_scenario_id,draftB);assert.notEqual(fresh.p_scenario_id,draftA);assert.equal(await destination.inputValue(),'new');
 // Receipt read failure cannot authorize corrected intent or replace its request.
 const pendingBefore=await page.evaluate(()=>recovery.readForecastRecovery(central,'import-write:'+state.reviewId));await page.evaluate(()=>receiptUnavailable=true);await page.locator('[data-mapping-reason]').fill('Review awaiting receipt');await save.click();await page.waitForFunction(()=>!state.busy);assert.match(await status.innerText(),/Synthetic receipt unavailable/);assert.equal((await written()).length,2);assert.deepEqual(await page.evaluate(()=>recovery.readForecastRecovery(central,'import-write:'+state.reviewId)),pendingBefore);
 // Cancellation must leave the destination unchanged and cannot create a request.
 await page.evaluate(async()=>{receiptUnavailable=false;await recovery.removeForecastRecovery(central,'import-write:'+state.reviewId);});await save.click();await page.locator('[data-import-cancel]').click();await page.waitForFunction(()=>!state.busy);assert.match(await status.innerText(),/Import cancelled/);assert.equal(await destination.inputValue(),'new');assert.equal((await written()).length,2);assert.equal(await page.evaluate(()=>recovery.readForecastRecovery(central,'import-write:'+state.reviewId)),null);
 // A failed recovery transaction after the modal choice blocks the financial
 // request, using real IndexedDB with one deliberately failed write transaction.
 await save.click();await page.locator('[data-existing-draft]').selectOption(draftB);await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite'){IDBDatabase.prototype.transaction=original;throw Error('Synthetic recovery storage failure');}return original.apply(this,args);};});await page.locator('[data-import-update]').click();await page.waitForFunction(()=>!state.busy);assert.match(await status.innerText(),/Synthetic recovery storage failure/);assert.equal((await written()).length,2);assert.equal(await page.evaluate(()=>recovery.readForecastRecovery(central,'import-write:'+state.reviewId)),null);
 await save.click();assert.equal(await page.locator('[data-existing-draft]').inputValue(),draftB,'A retry before request creation preselects the retained target rather than the first draft');await page.locator('[data-import-cancel]').click();await page.waitForFunction(()=>!state.busy);
 // With no eligible working drafts, the automatically offered New destination
 // is reflected in both the visible control and recovery before request creation.
 await page.evaluate(()=>entries=[]);await save.click();await awaitFailure(3);assert.equal(await destination.inputValue(),'new');const noMatch=await page.evaluate(()=>retentionChecks.at(-1));assert.equal(noMatch.destination,'new');assert.equal(noMatch.reviewVersion,noMatch.requestReviewVersion);assert.equal((await written())[2].p_expected_revision,0);
 assert.deepEqual(errors,[]);
 console.log('PASS import destination browser workflow: modal Update persists chosen target before write, failed save/review correction remains Current, new intent gets new UUID, unchanged retry preserves body, IndexedDB reopen retains target, mismatched open draft blocks, explicit New wins, unknown receipt/storage failure/cancel prevent writes, and no-match New is retained.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
