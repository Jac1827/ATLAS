// Native Chromium storage; entirely synthetic data and loopback-only requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const assets=path.resolve(import.meta.dirname,'../docs/portfolio-operations-dashboard');
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/host.html'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Synthetic retained host</title><iframe id="builder"></iframe>');return;}
 const file=path.resolve(assets,'.'+url.pathname);if(!file.startsWith(assets+path.sep))throw Error('Bad path');
 res.setHeader('content-type',/\.html$/.test(file)?'text/html':/\.m?js$/.test(file)?'text/javascript':'application/octet-stream');
 res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;");
 res.end(await fs.readFile(file));
}catch(error){res.writeHead(404);res.end(error.message);}});
let browser,page,stage='start';const errors=[],remote=[];
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext();
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();remote.push(route.request().url());return route.abort();});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
 const ready=async target=>{await target.waitForFunction(()=>window.RBB?.engine?._reforecastBridge&&RBB.app.state&&RBB.persist.storageAvailable()&&!RBB.app._starting);};
 const readRecord=async(id,target=page)=>target.evaluate(async id=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(RBB.persist.DRAFT_DB_NAME,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const all=await new Promise((resolve,reject)=>{const tx=db.transaction('records'),r=tx.objectStore('records').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return all.find(r=>r.id===id)||null;
 },id);
 stage='real startup and old save points at full origin quota';
 await page.goto(origin+'/RISE-Budget-Builder.html#workspace');await ready(page);
 const baseline=await page.evaluate(async()=>{
  const R=RBB,A=R.app,P=R.persist,state=R.buildState();
  state.properties=[state.properties[0]];state.lines=state.lines.filter(r=>r.propertyId===state.properties[0].id).slice(0,2);
  state.activeProperty=state.properties[0].id;state.scenarios=state.scenarios.slice(0,1);state.activeScenario=state.scenarios[0].id;
  state.exactValues={missing:null,zero:0,negative:-123.45,flag:false,empty:'',unicode:'Budget 🏡 / \ud800'};
  A.state=state;A.strCfg={propertyId:state.activeProperty,programmeId:'quota-programme',zero:0,flag:false,empty:'',missing:null};
  A.cache=null;A.render();P.markDirty();P.autosave();clearTimeout(P._timer);
  const raw=localStorage.getItem(P.AUTOSAVE_KEY),parsed=JSON.parse(raw);delete parsed.browserDraftIdentity;delete parsed.browserDraftRevision;
  const legacy=JSON.stringify(parsed),index=[];
  for(let i=0;i<7;i++){const id='Slegacy-'+i;localStorage.setItem(P.slotKey(id),legacy);index.push({id,label:'Existing '+i,savedAt:parsed.savedAt,bytes:legacy.length,summary:parsed.summary});}
  localStorage.setItem(P.SLOT_INDEX_KEY,JSON.stringify(index));localStorage.setItem(P.UNDO_KEY,legacy);
  localStorage.setItem('unrelated-auth-sentinel','synthetic-not-a-token');
  // Fill the shared origin to its actual browser-enforced limit, including keys
  // that do not belong to Budget Builder. No quota mock is used here.
  let i=0;for(;;i++){try{localStorage.setItem('unrelated-fill-'+i,'x'.repeat(65536));}catch{break;}}
  let remainder='';for(let step=32768;step>=1;step=Math.floor(step/2)){try{localStorage.setItem('unrelated-remainder',remainder+'x'.repeat(step));remainder+='x'.repeat(step);}catch{}}
  let quota=false;try{localStorage.setItem('cannot-fit','x'.repeat(1024));}catch(e){quota=e.name==='QuotaExceededError';}
  const map=Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]));
  const db=await new Promise(resolve=>{const r=indexedDB.open('synthetic-other-workspace',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>resolve(r.result);});
  await new Promise(resolve=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').put({zero:0,missing:null,flag:false},'unrelated');tx.oncomplete=resolve;});db.close();
  window.beforeStorage=JSON.stringify(map);state.largeSource='s'.repeat(2158000);state.currentMarker='first-large';A.touch();clearTimeout(P._timer);
  return {quota,storageChars:JSON.stringify(map).length,legacySlots:P.index().length,exactValues:state.exactValues,ui:JSON.stringify(A.strCfg)};
 });
 assert.equal(baseline.quota,true);assert.equal(baseline.legacySlots,7);assert.ok(baseline.storageChars>5_000_000);
 stage='commit plus independent readback required before Saved';
 await page.evaluate(()=>{
  const original=crypto.subtle.digest.bind(crypto.subtle);let count=0;
  crypto.subtle.digest=async(...args)=>{if(++count===2)await new Promise(resolve=>{window.releaseReadback=resolve;});return original(...args);};
  window.restoreDigest=()=>{crypto.subtle.digest=original;};
  window.firstSave=RBB.persist.autosave();
 });
 await page.waitForFunction(()=>!!window.releaseReadback);
 assert.equal((await readRecord('autosave')).raw.includes('first-large'),true,'Write is committed while verification is held');
 assert.deepEqual(await page.evaluate(()=>({dirty:RBB.persist.dirty,label:document.querySelector('#savestat .l').textContent})),{dirty:true,label:'Saving…'});
 await page.evaluate(()=>{RBB.app.state.currentMarker='newer-edit';RBB.app.touch();clearTimeout(RBB.persist._timer);window.releaseReadback();});
 assert.equal(await page.evaluate(()=>window.firstSave),true);
 assert.equal(await page.evaluate(()=>RBB.persist.dirty),true,'An older acknowledgement does not clear a newer edit');
 await page.evaluate(()=>window.restoreDigest());
 assert.equal(await page.evaluate(()=>RBB.persist.autosave()),true);
 const retained=await readRecord('autosave'),retainedPayload=JSON.parse(retained.raw);
 assert.equal(retainedPayload.state.largeSource.length,2158000);assert.equal(retainedPayload.state.currentMarker,'newer-edit');
 assert.deepEqual(retainedPayload.state.exactValues,baseline.exactValues);
 assert.deepEqual(retainedPayload.ui.strCfg,JSON.parse(baseline.ui));
 assert.equal(await page.evaluate(()=>RBB.persist.dirty),false);
 assert.equal(await page.evaluate(()=>JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)])))===window.beforeStorage),true,'Every preexisting localStorage key and value is unchanged');
 stage='reload and named save prefer newest durable full state';
 await page.reload();await ready(page);
 assert.deepEqual(await page.evaluate(()=>({state:RBB.app.state,libraries:RBB.persist.serialize(RBB.app.state).libraries,ui:RBB.persist.serialize(RBB.app.state).ui})),{state:retainedPayload.state,libraries:retainedPayload.libraries,ui:retainedPayload.ui},'Every saved financial/source/library/UI value round-trips exactly');
 assert.equal(await page.evaluate(()=>RBB.app.state.currentMarker),'newer-edit');
 assert.equal(await page.evaluate(()=>RBB.app.state.largeSource.length),2158000);
 assert.equal(await page.evaluate(()=>RBB.persist.index().length),7);
 const slot=await page.evaluate(()=>RBB.persist.saveSlot('Quota-safe named checkpoint','Exact full state'));
 assert.equal(await page.evaluate(()=>RBB.persist.index().length),8);
 assert.equal(JSON.parse((await readRecord(slot.id)).raw).state.currentMarker,'newer-edit');
 await page.evaluate(()=>{RBB.app.state.currentMarker='different';RBB.app.touch();clearTimeout(RBB.persist._timer);});
 await page.evaluate(id=>RBB.persist.loadSlot(id),slot.id);
 assert.equal(await page.evaluate(()=>RBB.app.state.currentMarker),'newer-edit');
 await page.evaluate(()=>RBB.persist.autosave());
 await page.reload();await ready(page);
 assert.equal(await page.evaluate(()=>RBB.app.state.currentMarker),'newer-edit');
 assert.equal(await page.evaluate(()=>RBB.persist.index().length),8);
 stage='durable failure, readback failure and ordered retry stay unsaved';
 const failure=await page.evaluate(async()=>{
  const P=RBB.persist,A=RBB.app,original=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(names,mode,...rest){if(this.name===P.DRAFT_DB_NAME&&mode==='readwrite')throw new DOMException('Synthetic disk full','QuotaExceededError');return original.call(this,names,mode,...rest);};
  A.state.currentMarker='must-retry';A.touch();clearTimeout(P._timer);
  const result=await A.quickSave(),status={result,dirty:P.dirty,error:P.lastError,label:document.querySelector('#savestat .l').textContent,marker:A.state.currentMarker};
  IDBDatabase.prototype.transaction=original;return status;
 });
 assert.deepEqual(failure,{result:false,dirty:true,error:'write-failed',label:'Save failed',marker:'must-retry'});
 assert.equal(JSON.parse((await readRecord('autosave')).raw).state.currentMarker,'newer-edit');
 const readbackFailure=await page.evaluate(async()=>{
  const original=crypto.subtle.digest.bind(crypto.subtle);let count=0;
  crypto.subtle.digest=async(...args)=>++count===2?new Uint8Array(32).buffer:original(...args);
  const result=await RBB.persist.autosave();crypto.subtle.digest=original;
  return {result,dirty:RBB.persist.dirty,error:RBB.persist.lastError};
 });
 assert.deepEqual(readbackFailure,{result:false,dirty:true,error:'write-failed'});
 assert.equal(await page.evaluate(()=>RBB.persist.autosave()),true);
 await page.evaluate(async()=>{
  const A=RBB.app,P=RBB.persist;A.state.currentMarker='ordered-one';A.touch();clearTimeout(P._timer);const one=P.autosave();
  A.state.currentMarker='ordered-two';A.touch();clearTimeout(P._timer);const two=P.autosave();await Promise.all([one,two]);
 });
 assert.equal(JSON.parse((await readRecord('autosave')).raw).state.currentMarker,'ordered-two');
 stage='undo snapshots synchronously and survives reload';
 await page.evaluate(async()=>{
  const A=RBB.app,P=RBB.persist;A.state.currentMarker='exact-undo';P.snapshotUndo('synthetic change');
  A.state.currentMarker='changed-after-capture';A.touch();clearTimeout(P._timer);await P.autosave();
 });
 await page.reload();await ready(page);
 assert.equal(await page.evaluate(()=>RBB.persist.canUndo()),true);
 await page.evaluate(async()=>{RBB.persist.undo();clearTimeout(RBB.persist._timer);await RBB.persist.autosave();});
 assert.equal(await page.evaluate(()=>RBB.app.state.currentMarker),'exact-undo','Newest durable undo wins over old localStorage undo');
 assert.deepEqual(await page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('synthetic-other-workspace',1);r.onsuccess=()=>resolve(r.result);});
  const row=await new Promise(resolve=>{const r=db.transaction('data').objectStore('data').get('unrelated');r.onsuccess=()=>resolve(r.result);});db.close();return row;
 }),{zero:0,missing:null,flag:false});
 stage='invalid newer durable checkpoint never silently falls back to stale localStorage';
 const good=await readRecord('autosave');
 await page.evaluate(async row=>{
  row.raw=row.raw.replace('exact-undo','tampered!!');const db=await new Promise(resolve=>{const r=indexedDB.open(RBB.persist.DRAFT_DB_NAME,1);r.onsuccess=()=>resolve(r.result);});
  await new Promise(resolve=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(row);tx.oncomplete=resolve;});db.close();
 },good);
 await page.reload();await page.getByText('Your saved browser draft could not be verified.',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>!!RBB.app.state),false);
 await page.evaluate(async row=>{const db=await new Promise(resolve=>{const r=indexedDB.open('rise-budget-drafts-v1',1);r.onsuccess=()=>resolve(r.result);});await new Promise(resolve=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(row);tx.oncomplete=resolve;});db.close();},good);
 await page.getByRole('button',{name:'Retry saved draft check'}).click();await ready(page);
 assert.equal(await page.evaluate(()=>RBB.app.state.currentMarker),'exact-undo');
 stage='a valid checksum cannot disguise an unrestorable runtime payload';
 await page.evaluate(async row=>{
  const payload=JSON.parse(row.raw);delete payload.state.scenarios;row.raw=JSON.stringify(payload);
  row.sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.raw))),n=>n.toString(16).padStart(2,'0')).join('');
  const db=await new Promise(resolve=>{const r=indexedDB.open('rise-budget-drafts-v1',1);r.onsuccess=()=>resolve(r.result);});
  await new Promise(resolve=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(row);tx.oncomplete=resolve;});db.close();
 },good);
 await page.reload();await page.getByText('Your saved browser draft could not be verified.',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>!!RBB.app.state),false,'A default workbook is not silently opened after restore throws');
 assert.equal(await page.evaluate(()=>document.querySelectorAll('script[data-after-draft-boot][data-loaded]').length),0);
 await page.evaluate(async row=>{const db=await new Promise(resolve=>{const r=indexedDB.open('rise-budget-drafts-v1',1);r.onsuccess=()=>resolve(r.result);});await new Promise(resolve=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(row);tx.oncomplete=resolve;});db.close();},good);
 await page.getByRole('button',{name:'Retry saved draft check'}).click();await ready(page);
 const scripts=await page.evaluate(()=>document.querySelectorAll('script[data-after-draft-boot][data-loaded]').length);
 await page.evaluate(()=>Promise.all([RBB.app.start(),RBB.app.start()]));
 assert.equal(await page.evaluate(()=>document.querySelectorAll('script[src*="budget-mapped-import.js"]').length),2,'One inert declaration and exactly one real script');
 const deferredDeclarations=await page.evaluate(()=>Array.from(document.querySelectorAll('script[data-after-draft-boot]'),script=>script.getAttribute('src')));
 assert.equal(scripts,deferredDeclarations.length,'Every declared integration loads after verified recovery');
 for(const src of deferredDeclarations) assert.equal(await page.evaluate(src=>Array.from(document.querySelectorAll('script[src]')).filter(script=>script.getAttribute('src')===src&&!script.hasAttribute('data-after-draft-boot')).length,src),1,'Each deferred integration executes exactly once: '+src);
 stage='Applied banner requires real complete matching rows';
 const banners=await page.evaluate(()=>{
  const A=RBB.app,R=RBB,property=A.state.activeProperty;
  const programme=A.state.strPrograms.find(p=>p.propertyId===property);if(!programme)throw Error('Synthetic property needs a programme fixture');
  A.strCfg={...A.defaultStrCfg(A.prop()),propertyId:property,programmeId:programme.id};
  const render=()=>R.views.strbuild();programme.applied=false;programme.lineIds=[];const empty=render();
  programme.applied=true;programme.lineIds=['missing'];const missing=render();
  const line={...structuredClone(A.state.lines[0]),id:'banner-test-line',propertyId:property,strProgramId:programme.id,yearData:Object.fromEntries(R.YEARS.map(year=>[year,[0,null,...Array(10).fill(2)]]))};
  A.state.lines.push(line);programme.lineIds=[line.id];const complete=render();line.yearData[R.YEARS[0]].pop();const incomplete=render();
  return {empty:empty.includes('<b>Applied.</b>'),missing:missing.includes('<b>Applied.</b>'),complete:complete.includes('<b>Applied.</b>'),incomplete:incomplete.includes('<b>Applied.</b>')};
 });
 assert.deepEqual(banners,{empty:false,missing:false,complete:true,incomplete:false});
 stage='retained document.write iframe and hidden canonical reader startup';
 const host=await context.newPage();host.on('pageerror',e=>errors.push(e.message));await host.goto(origin+'/host.html');
 await host.evaluate(async()=>{const html=await(await fetch('/RISE-Budget-Builder.html')).text();const frame=document.getElementById('builder');frame.contentDocument.open();frame.contentDocument.write(html.replace('<head>','<head><base href="'+location.origin+'/">'));frame.contentDocument.close();});
 await ready(host.frames()[1]);
 assert.equal(await host.frames()[1].evaluate(()=>RBB.app.state.currentMarker),'exact-undo');await host.close();
 const reader=await context.newPage();reader.on('pageerror',e=>errors.push(e.message));await reader.goto(origin+'/RISE-Budget-Builder.html?investorReader=1');
 await reader.waitForFunction(()=>document.querySelectorAll('script[data-after-draft-boot][data-loaded]').length===6);
 assert.equal(await reader.evaluate(()=>RBB.app.state===null||RBB.app.state===undefined),true,'Investor reader does not restore browser working values');await reader.close();
 stage='account and workspace fences';
 const scoped=await browser.newContext();await scoped.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await scoped.addInitScript(()=>{window.fixtureActor='actor-a';window.fixtureBackend='https://synthetic.invalid';window.fixtureAccess='scope-a';window.ATLAS_CENTRAL={getSession:()=>({user:{id:window.fixtureActor},expires_at:Math.floor(Date.now()/1000)+3600}),getConfig:()=>({supabaseUrl:window.fixtureBackend}),getAccessContextKey:()=>window.fixtureAccess};});
 const actor=await scoped.newPage();actor.on('dialog',d=>d.accept());await actor.goto(origin+'/RISE-Budget-Builder.html#workspace');await ready(actor);
 const actorReceipt=await actor.evaluate(async()=>{
  RBB.app.state.actorMarker='belongs-to-a';RBB.app.touch();clearTimeout(RBB.persist._timer);await RBB.persist.saveSlot('Actor A','');
  window.dispatchEvent(new Event('atlas-central-auth-change'));const sameAccess=await RBB.persist.autosave();
  window.fixtureAccess='revoked';const revoked=await RBB.persist.autosave();window.fixtureAccess='scope-a';
  window.fixtureActor='actor-b';window.dispatchEvent(new Event('atlas-central-auth-change'));
  const rejected=await RBB.persist.autosave();window.fixtureActor='actor-a';window.fixtureBackend='https://other.invalid';const backendRejected=await RBB.persist.autosave();
  return {sameAccess,revoked,rejected,backendRejected,dirty:RBB.persist.dirty};
 });assert.deepEqual(actorReceipt,{sameAccess:true,revoked:false,rejected:false,backendRejected:false,dirty:true});
 await scoped.addInitScript(()=>{window.fixtureActor='actor-b';});
 const other=await scoped.newPage();await other.goto(origin+'/RISE-Budget-Builder.html#workspace');await ready(other);
 assert.equal(await other.evaluate(()=>RBB.app.state.actorMarker),undefined);assert.equal(await other.evaluate(()=>RBB.persist.index().length),0);
 await scoped.close();
 stage='unavailable or blocked recovery never silently starts an older draft';
 for(const mode of ['unavailable','blocked']){
  const unavailable=await browser.newContext();await unavailable.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await unavailable.addInitScript(mode=>{indexedDB.open=()=>{if(mode==='unavailable')throw new DOMException('Synthetic browser denial','SecurityError');const request={};setTimeout(()=>request.onblocked?.(),0);return request;};},mode);
  const blocked=await unavailable.newPage();await blocked.goto(origin+'/RISE-Budget-Builder.html#workspace');
  await blocked.getByText('Your saved browser draft could not be verified.',{exact:false}).waitFor();
  assert.equal(await blocked.evaluate(()=>!!RBB.app.state),false);
  assert.equal(await blocked.evaluate(()=>RBB.persist.lastError),'recovery-unavailable');await unavailable.close();
 }
 stage='missing storage helper cannot invoke the legacy boot';
 const missing=await browser.newContext();
 await missing.route('**/*',route=>new URL(route.request().url()).origin!==origin||new URL(route.request().url()).pathname==='/budget-draft-storage.js'?route.abort():route.continue());
 const missingPage=await missing.newPage();await missingPage.goto(origin+'/RISE-Budget-Builder.html#workspace');
 await missingPage.getByText('Verified browser draft storage did not load.',{exact:false}).waitFor();
 assert.equal(await missingPage.evaluate(()=>!!RBB.app.state),false);await missing.close();
 assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
 console.log('PASS real-origin quota: 2.158 MB full state; seven old slots untouched; committed+verified IDB fallback; newest reload; named slots; failure/retry/order; undo; corruption blocks stale fallback; no unrelated writes; truthful applied banner; document.write/CSP integration; canonical-only reader; actor/backend isolation.');
}catch(error){console.error('BUDGET_QUOTA_FAILURE',JSON.stringify({stage,error:error.stack,errors,remote}));throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
