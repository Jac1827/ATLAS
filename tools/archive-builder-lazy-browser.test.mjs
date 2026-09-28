// Small isolated native-IDB proof. Synthetic records only; no live app or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {patchArchiveBuilderBoundary} from './archive-builder-compat.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const root=path.resolve(import.meta.dirname,'..'),base=path.join(root,'docs/portfolio-operations-dashboard'),core=await fs.readFile(path.join(base,'workspace-core.js'),'utf8');
const old=execFileSync('git',['show','origin/atlas-asset-releases:_atlas-assets/774663d5c700ea5d00a0b13a627f965f78173d7a4700f6728ed6a6620adbf8df/portfolio-operations-dashboard/index.html'],{cwd:root,encoding:'utf8',maxBuffer:32*1024**2}),retained=patchArchiveBuilderBoundary(old,core);
const helper=source=>source.match(/^async function packAtlasCentralRetainedRecords\([^\n]*\) \{[\s\S]*?^\}/m)[0];
const server=createServer(async(req,res)=>{try{res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':'text/html');if(req.url==='/zip.js')res.end(await fs.readFile(path.join(base,'vendor/jszip.min.js')));else if(req.url==='/archive.js')res.end(await fs.readFile(path.join(base,'migration-archive.js')));else if(req.url==='/current.js'||req.url==='/retained.js')res.end(helper(req.url==='/current.js'?core:retained));else res.end('<!doctype html><script src="/zip.js"></script><script src="/archive.js"></script>');}catch(error){res.statusCode=500;res.end(error.message);}});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});
 for(const surface of ['current','retained'])for(const mode of ['queued','quota','cleanup','actor']){
  const page=await browser.newPage();await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());await page.goto('http://127.0.0.1:'+server.address().port);await page.addScriptTag({url:'/'+surface+'.js'});
  const proof=await page.evaluate(async mode=>{
   const prefix='__atlas_archive_capture_v1:',db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lazy-synthetic-'+crypto.randomUUID(),1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const io=(mode,action)=>new Promise((resolve,reject)=>{const tx=db.transaction('records',mode);let request;try{request=action(tx.objectStore('records'));}catch(error){tx.abort();reject(error);return;}tx.oncomplete=()=>resolve(request?.result);tx.onerror=tx.onabort=()=>reject(tx.error||request?.error||Error('native transaction failed'));});
   const rows=[{key:'imports',value:{batches:[{id:'original',beforeSnapshot:{capturedAt:'retained',zero:0,missing:null}}]}},{key:'source:a',blob:new Blob([new Uint8Array([0,255,4])],{type:'application/x-source'})},{key:'occupancy_replay_backup:old',value:{retained:true}}],orphan={key:prefix+'prior:0',format:'atlas_archive_capture_v1',captureId:'prior',record:{preserved:true}};
   await io('readwrite',store=>{for(const row of [...rows,orphan])store.put(row);});
   let actor='original';Object.assign(globalThis,{DATA_IMPORT_2_STATE_KEY:'imports',DATA_IMPORT_FILE_ARCHIVE_PREFIX:'source:',ATLAS_STATE_DB_NAME:db.name,ATLAS_STATE_STORE_NAME:'records',dataImport2State:{batches:[{id:'original'}]},withAtlasStateStore:io,ATLAS_CENTRAL:{getSession:()=>({user:{id:actor}}),getAccessContextKey:()=>actor,getStoredProfile:()=>({role:'Admin'})}});
   const api=AtlasMigrationArchive,originalAdd=IDBObjectStore.prototype.add,originalDelete=IDBObjectStore.prototype.delete;let count=0,queued,error=null,restored=null,temporaryKeysDuringPack=[];
   IDBObjectStore.prototype.add=function(value){if(value?.format==='atlas_archive_capture_v1'){count++;if(mode==='quota'&&count===2)throw new DOMException('Synthetic quota error','QuotaExceededError');if(mode==='queued'&&!queued)queued=io('readwrite',store=>{store.put({key:'imports',value:{batches:[{id:'newer'}]}});store.put({key:'source:a',blob:new Blob(['newer'])});});}return originalAdd.apply(this,arguments);};
   if(mode==='cleanup')IDBObjectStore.prototype.delete=function(key){if(String(key).startsWith(prefix))throw Error('Synthetic cleanup failure');return originalDelete.apply(this,arguments);};
   globalThis.AtlasMigrationArchive={...api,packRecords:async(...args)=>{if(queued)await queued;temporaryKeysDuringPack=(await io('readonly',store=>store.getAllKeys())).filter(key=>String(key).startsWith(prefix)&&key!==orphan.key);if(mode==='actor')actor='changed';return api.packRecords(...args);}};
   try{restored=await api.unpack(await packAtlasCentralRetainedRecords({original:true}),JSZip);}catch(e){error=e.message;}finally{IDBObjectStore.prototype.add=originalAdd;IDBObjectStore.prototype.delete=originalDelete;}
   const final=await io('readonly',store=>store.getAll()),originalRow=final.find(row=>row.key==='imports');const result={error,tempCount:final.filter(row=>row.key.startsWith(prefix)&&row.key!==orphan.key).length,orphanPreserved:JSON.stringify(final.find(row=>row.key===orphan.key))===JSON.stringify(orphan),sourceBatch:originalRow.value.batches[0].id,capturedCount:temporaryKeysDuringPack.length,records:restored?.records.length??null,restoredBatch:restored?.records.find(row=>row.key==='imports')?.value.batches[0].id??null,restoredBlob:restored?[...new Uint8Array(await restored.records.find(row=>row.key==='source:a').blob.arrayBuffer())]:null,missing:restored?.records.find(row=>row.key==='imports')?.value.batches[0].beforeSnapshot.missing,zero:restored?.records.find(row=>row.key==='imports')?.value.batches[0].beforeSnapshot.zero};
   db.close();await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(db.name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);});return result;
  },mode);
  assert(proof.orphanPreserved);if(mode==='queued'){assert.equal(proof.error,null);assert.equal(proof.sourceBatch,'newer');assert.equal(proof.restoredBatch,'original');assert.equal(proof.records,3);assert.deepEqual(proof.restoredBlob,[0,255,4]);assert.equal(proof.missing,null);assert.equal(proof.zero,0);assert.equal(proof.capturedCount,3);}else{assert(proof.error);assert.equal(proof.sourceBatch,'original');assert.equal(proof.records,null);if(mode==='cleanup')assert.match(proof.error,/cleanup failed; no archive is complete/);if(mode==='actor')assert.match(proof.error,/account, storage or source replay changed/);}
  assert.equal(proof.tempCount,mode==='cleanup'?3:0);console.log('PASS',surface,mode);await page.close();
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
