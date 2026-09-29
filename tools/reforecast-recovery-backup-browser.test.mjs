// Synthetic browser records only. Exercises the real dialog, native IndexedDB,
// read-only backup capture and download; no financial service is contacted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright'),root=path.resolve(import.meta.dirname,'..');
let server,browser;
try{
 server=createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><textarea data-original-editor>Unsaved original editor remains open</textarea>');return;}
  const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep))throw Error('Outside fixture');let text=await fs.readFile(file,'utf8');if(file.endsWith('/reforecast-ui.mjs'))text+='\nexport {recoveryDialog};';res.setHeader('content-type','text/javascript');res.end(text);
 }catch(error){res.writeHead(404);res.end(error.message);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});const context=await browser.newContext({acceptDownloads:true}),url='http://127.0.0.1:'+server.address().port;
 const setup=async page=>{await page.goto(url);await page.evaluate(async()=>{
  window.actor='10000000-0000-0000-0000-000000000001';window.cid='10000000-0000-0000-0000-000000000002';window.scenario='10000000-0000-0000-0000-000000000003';window.role='admin';window.allowed=true;window.financialCalls=0;window.accessReads=0;window.gate=null;
  window.central={getSession:()=>({user:{id:actor},access_token:'SESSION_SECRET_NEVER_EXPORT',refresh_token:'REFRESH_SECRET_NEVER_EXPORT',expires_at:Math.floor(Date.now()/1000)+3600}),getStoredProfile:()=>({user_id:actor,role,status:'active',allowed_community_ids:[cid]}),async readCommunitiesForAccess(){accessReads++;if(gate)await gate;return allowed?[{community_id:cid}]:[];},fetchJson(){financialCalls++;throw Error('No financial transport allowed');}};
  window.recovery=await import('/docs/portfolio-operations-dashboard/features/reforecast-recovery.mjs');window.ui=await import('/docs/portfolio-operations-dashboard/features/reforecast-ui.mjs');
  window.s={central,actor,cid,scenarioId:'separate-open-editor',epoch:1,viewEpoch:1,draftEditVersion:'open-v1',dirty:true,communities:[{community_id:cid}]};
  window.openBackup=()=>ui.recoveryDialog(s);window.inventory=()=>recovery.listForecastRecovery(central);
 });};
 const origin=await context.newPage();await setup(origin);await origin.evaluate(async()=>{
  const payload={name:'Retained draft',overrides:[{period:'2026-09',accountCode:'6000',amount:null},{period:'2026-09',accountCode:'5120',amount:0},{period:'2026-09',accountCode:'5100',amount:-17.125}],reason:'Exact retained reason '.repeat(110000),history:[{action:'review',before:null,after:0}]};
  await recovery.saveForecastRecovery(central,'edit-linked',{kind:'draft-edit',communityId:cid,scenarioId:scenario,expectedRevision:11,editVersion:'edit-newer',name:'Linked newer edit',payload:{...payload,name:'Newer retained edit'},pendingCells:{'2026-09|6000':''},cellReason:'Preserve unfinished blank'});
  await recovery.saveForecastRecovery(central,'draft-write:request-one',{kind:'draft-write',communityId:cid,name:'Pending exact save',editId:'edit-linked',editVersion:'edit-old',request:{communityId:cid,scenarioId:scenario,requestId:'request-one',expectedRevision:11,action:'save_draft',payload}});
  await recovery.saveForecastRecovery(central,'standalone-edit',{kind:'draft-edit',communityId:cid,scenarioId:scenario,expectedRevision:11,editVersion:'standalone-v1',name:'Standalone edit',payload:{name:'Standalone',overrides:[{amount:23}]}});
  await recovery.saveForecastRecovery(central,'other-kind',{kind:'import-review',communityId:cid,name:'Import has no save export'});
  const own=actor;actor='other-actor';await recovery.saveForecastRecovery(central,'other-actor-edit',{kind:'draft-edit',communityId:cid,scenarioId:scenario,name:'Private other actor',payload:{secret:'other actor'}});actor=own;
 });
 const before=await origin.evaluate(()=>inventory()),page=await context.newPage();await setup(page);const downloads=[];page.on('download',download=>downloads.push(download));
 const status=()=>page.locator('dialog [data-status]');const row=name=>page.locator('dialog p').filter({hasText:name});
 const open=async()=>{await page.evaluate(async()=>{document.querySelector('dialog')?.close();await openBackup();});};
 const readDownload=async click=>{const awaited=page.waitForEvent('download');await click();const d=await awaited;return JSON.parse(await fs.readFile(await d.path(),'utf8'));};
 // 1. A second tab exports the pending request and latest linked edit, including
 // payload above 2 MiB, while the original editor and both records stay intact.
 await open();assert.equal(await page.locator('[data-save-backup]').count(),2);assert.match(await row('Pending exact save').innerText(),/newer retained working edits separately/);
 const backup=await readDownload(()=>row('Pending exact save').locator('[data-save-backup]').click());assert.equal(backup.formatVersion,1);assert.equal(backup.authority,'browser_recovery_only');assert.equal(backup.expectedRevision,11);assert.equal(backup.requestId,'request-one');assert.equal(backup.linkedEdit.changedSinceRequest,true);assert.equal(backup.linkedEdit.editVersion,'edit-newer');assert.deepEqual(backup.records,[before.find(r=>r.id==='draft-write:request-one'),before.find(r=>r.id==='edit-linked')]);assert(JSON.stringify(backup).length>2097152);assert.doesNotMatch(JSON.stringify(backup),/SESSION_SECRET|REFRESH_SECRET|other actor/);assert.deepEqual(await origin.evaluate(()=>inventory()),before);assert.equal(await origin.locator('[data-original-editor]').inputValue(),'Unsaved original editor remains open');
 const standalone=await readDownload(()=>row('Standalone edit').locator('[data-save-backup]').click());assert.equal(standalone.requestId,null);assert.equal(standalone.linkedEdit,null);assert.deepEqual(standalone.records,[before.find(r=>r.id==='standalone-edit')]);assert.equal(await page.evaluate(()=>financialCalls),0);
 console.log('PASS exact second-tab backup: oversized pending request + newer linked edit and standalone edit retained; null/zero/signed values, actor privacy and original editor unchanged; no financial RPC.');
 // 2. Stale or incomplete dialog snapshots fail closed. The exporter never
 // substitutes newly changed data, strips secrets or releases recovery rows.
 for(const kind of ['selected','linked','missing','secret']){
  await page.evaluate(async rows=>{for(const r of rows)await recovery.saveForecastRecovery(central,r.id,r);},before);await open();
  if(kind==='secret'){await page.evaluate(async()=>{const r=await recovery.readForecastRecovery(central,'standalone-edit');r.payload.access_token='DO_NOT_EXPORT';await recovery.saveForecastRecovery(central,r.id,r);});await open();}
  else await page.evaluate(async kind=>{const id=kind==='selected'?'draft-write:request-one':'edit-linked';if(kind==='missing')await recovery.removeForecastRecovery(central,id);else{const r=await recovery.readForecastRecovery(central,id);r.name+=' changed';await recovery.saveForecastRecovery(central,id,r);}},kind);
  const stable=await page.evaluate(()=>inventory()),count=downloads.length;await row(kind==='secret'?'Standalone edit':'Pending exact save').locator('[data-save-backup]').click();await page.waitForFunction(()=>/changed|authentication fields/.test(document.querySelector('dialog [data-status]').textContent));assert.equal(downloads.length,count);assert.deepEqual(await page.evaluate(()=>inventory()),stable);assert.equal(await page.evaluate(()=>financialCalls),0);
 }
 console.log('PASS changed/missing selected or linked recovery and authentication-field rejection; no export or recovery mutation.');
 // 3. Authorization/selection/dialog changes during the fresh access read
 // cancel the download, including a revoked community under the same actor.
 for(const change of ['actor','access','selection','dialog','revoked']){
  await setup(page);await page.evaluate(async rows=>{for(const r of rows)await recovery.saveForecastRecovery(central,r.id,r);},before);await open();const count=downloads.length;
  await page.evaluate(()=>{gate=new Promise(resolve=>window.releaseAccess=resolve);});await row('Pending exact save').locator('[data-save-backup]').click();await page.waitForFunction(()=>accessReads===1);
  await page.evaluate(change=>{if(change==='actor')actor='different-actor';if(change==='access')role='viewer';if(change==='selection')s.scenarioId='different-selection';if(change==='dialog')document.querySelector('dialog').close();if(change==='revoked')allowed=false;releaseAccess();},change);
  if(change!=='dialog')await page.waitForFunction(()=>document.querySelector('dialog [data-status]')?.textContent);else await page.waitForFunction(()=>!document.querySelector('dialog'));
  assert.equal(downloads.length,count);assert.equal(await page.evaluate(()=>financialCalls),0);
 }
 assert.equal(await origin.locator('[data-original-editor]').inputValue(),'Unsaved original editor remains open');await context.close();
 console.log('PASS actor/access/selection/dialog freshness and current community authorization; pending request never resent and original editor remains open.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
