// Production intake UI + real SQL fixture. A failed audit must release Save
// before a separate staging-list request resolves; retries retain exact identity.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright'),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js'),cid='10000000-0000-0000-0000-000000000001',url='http://127.0.0.1:18779';
let output='',browser;const server=spawn(process.execPath,['tools/reforecast-harness-server.cjs'],{env:{...process.env,PORT:'18779'},stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error(output||'Fixture startup timed out')),20000);server.once('exit',code=>{clearTimeout(timeout);reject(Error('Fixture exited '+code+': '+output));});for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{output+=chunk;if(output.includes(url)){clearTimeout(timeout);resolve();}});});
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.locator('[data-community]').selectOption(cid);await page.waitForFunction(()=>!document.querySelector('[data-refresh]')?.disabled);
 await page.evaluate(()=>{
  const central=window.ATLAS_CENTRAL,rpc=central.rpc.bind(central);window.calls=[];window.progress=[];window.finalizeCount=0;window.stagingListCount=0;
  new MutationObserver(()=>{const value=document.querySelector('dialog.rfi [data-status]')?.textContent;if(value&&window.progress.at(-1)!==value)window.progress.push(value);}).observe(document.body,{childList:true,subtree:true,characterData:true});
  central.rpc=async(name,args,options)=>{
   window.calls.push({name,args,options:{timeoutMs:options?.timeoutMs,requestId:options?.requestId}});
   if(name==='atlas_read_workbook_audit_manifest'&&window.failManifestRead)throw new DOMException('Synthetic manifest timeout','TimeoutError');
   if(name==='atlas_list_workbook_staging'){window.stagingListCount++;return await new Promise(resolve=>{window.resolveStagingList=()=>resolve({uploads:[]});});}
   if(name==='atlas_finalize_workbook_audit_upload'){
    window.finalizeCount++;if(window.finalizeCount===1)throw new DOMException('Synthetic finalization timeout','TimeoutError');
    if(window.finalizeCount===2)await new Promise(resolve=>{window.releaseFinalize=resolve;});
   }
   return rpc(name,args,options);
  };
 });
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Scenario','Plan'],['GL','Account','Feb 2026','Mar 2026'],['5120','Rent',125,126],['6100','Payroll',0,42]]),'Plan');
 await page.locator('[data-file]').setInputFiles({name:'Recovery fixture.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}))});const modal=page.locator('dialog.rfi[open]');
 await modal.locator('[data-property]').selectOption(cid);await modal.locator('[data-assignment-reason]').fill('Reviewed recovery fixture community');await modal.locator('[data-confirm-property]').check();await modal.locator('[data-prior-version]').selectOption('none');await modal.locator('[data-save-evidence]').click();
 await page.waitForFunction(()=>window.stagingListCount===1&&document.querySelector('dialog.rfi [data-status]')?.textContent.includes('timeout'));
 assert.equal(await modal.locator('[data-save-evidence]').isEnabled(),true,'Save is available while the recovery-list promise is still pending');assert.equal(await page.evaluate(()=>window.calls.find(row=>row.name==='atlas_list_workbook_staging').options.timeoutMs),20000);
 const retained=await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('atlas-reforecast-recovery-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('recovery','readonly'),read=tx.objectStore('recovery').getAll();read.onsuccess=()=>resolve(read.result.filter(row=>row.actor===window.ATLAS_CENTRAL.getSession().user.id));tx.oncomplete=()=>db.close();};}));
 const review=retained.find(row=>row.kind==='import-review'),evidence=retained.find(row=>row.id===review.evidenceId);assert(review.fields.requestId);assert(evidence.evidence.source.originalFile.data.length>0);assert.equal(await page.evaluate(()=>window.finalizeCount),1,'Recovery listing never triggers another write');
 // Start an explicit retry before the older list completes. Its late response
 // cannot paint an outdated recovery panel over the newer transfer status.
 await modal.locator('[data-save-evidence]').click();await page.waitForFunction(()=>window.finalizeCount===2);assert.match(await modal.locator('[data-status]').innerText(),/Finalizing immutable evidence.*In progress/);await page.evaluate(()=>window.resolveStagingList());await page.waitForFunction(()=>!document.querySelector('dialog.rfi [data-transfer-recovery]')?.textContent);assert.equal(await modal.locator('[data-save-evidence]').isEnabled(),false);
 const requests=await page.evaluate(()=>window.calls);const finalizations=requests.filter(row=>row.name==='atlas_finalize_workbook_audit_upload');assert.equal(finalizations.length,2);assert.equal(finalizations[0].args.p_request_id,finalizations[1].args.p_request_id);assert.equal(finalizations[0].args.p_upload_id,finalizations[1].args.p_upload_id);assert.equal(requests.filter(row=>row.name==='atlas_begin_workbook_audit_upload').length,1,'Retry checks receipt and reuses the reserved upload');
 const firstFinalizeIndex=requests.findIndex(row=>row.name==='atlas_finalize_workbook_audit_upload');assert(!requests.slice(firstFinalizeIndex+1).some(row=>row.name==='atlas_put_workbook_audit_chunk'),'Acknowledged chunks are not written again');
 await page.evaluate(()=>window.releaseFinalize());await modal.locator('[data-scenario]').waitFor();const after=await page.evaluate(()=>({calls:window.calls,progress:window.progress}));
 for(const pattern of [/Checking saved evidence manifest/,/Reading back workbook evidence.*audit chunk 1 of/,/Reading back workbook evidence.*source chunk 1 of/,/Checking saved import receipt/,/Saving import details/,/Reading back import details.*import chunk 1 of/])assert(after.progress.some(text=>pattern.test(text)),'Missing visible transfer phase '+pattern);
 assert.equal(after.calls.find(row=>row.name==='atlas_read_reforecast_payload_receipt').args.p_request_id,review.fields.requestId,'Normalized envelope retains its original request through audit failure');
 assert.equal(await modal.locator('[data-transfer-recovery]').innerText(),'');
 // A list resolving after its dialog closes must not change the old status or
 // attach stale recovery controls to the surrounding workspace.
 await modal.locator('[data-close]').click();await page.evaluate(()=>{window.failManifestRead=true;});await page.locator('[data-file]').setInputFiles({name:'Recovery fixture.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}))});await modal.locator('[data-save-evidence]').click();await page.waitForFunction(()=>window.stagingListCount===2);assert.equal(await modal.locator('[data-save-evidence]').isEnabled(),true);const closedStatus=await modal.locator('[data-status]').innerText();await modal.evaluate(el=>{window.closedImportDialog=el;});await modal.locator('[data-close]').click();await page.evaluate(async()=>{window.resolveStagingList();await new Promise(resolve=>setTimeout(resolve,0));});assert.equal(await page.evaluate(()=>window.closedImportDialog.querySelector('[data-status]').textContent),closedStatus);assert.equal(await page.evaluate(()=>window.closedImportDialog.querySelector('[data-transfer-recovery]').textContent),'');assert.equal(await page.locator('dialog.rfi[open]').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS workbook timeout recovery: Save re-enabled before stalled staging-list resolves;20-second list deadline; exact request and workbook bytes retained; explicit receipt-first retry reuses upload/chunks; late list cannot alter newer transfer or closed dialog; manifest/audit/source/envelope progress visible.');
}finally{await browser?.close();server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
