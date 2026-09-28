// Synthetic source only. Exercise the unchanged retained lazy loader against
// the composed archive transport, without auth, cloud writes or startup changes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {composeFinanceCompatSource,OPERATIONAL_RELEASE} from './compose-finance-compat-source.mjs';
import {packageAssets} from './package-atlas-assets.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const repo=path.resolve(import.meta.dirname,'..'),tmp=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-archive-retained-'));
let server,browser;const requests=[],errors=[];
try{
 const old=path.join(tmp,'old'),out=path.join(tmp,'composed'),site=path.join(tmp,'site');await fs.mkdir(old);
 execFileSync('git',['archive','--format=tar','--output='+path.join(tmp,'old.tar'),'origin/atlas-asset-releases:_atlas-assets/'+OPERATIONAL_RELEASE],{cwd:repo});execFileSync('tar',['-xf',path.join(tmp,'old.tar'),'-C',old]);
 const receipt=await composeFinanceCompatSource({operationalSource:old,financeSource:path.join(repo,'docs'),out});
 assert.equal(receipt.changedOperationalFiles.length,19);assert.equal(receipt.unchangedOperationalFileCount,236);
 const loader='portfolio-operations-dashboard/performance/feature-loader.js',archive='portfolio-operations-dashboard/migration-archive.js';
 assert.deepEqual(await fs.readFile(path.join(out,loader)),await fs.readFile(path.join(old,loader)),'Actual old lazy loader is byte-identical');
 assert.deepEqual(await fs.readFile(path.join(out,archive)),await fs.readFile(path.join(repo,'docs',archive)),'Only the reviewed archive implementation is activated');
 const packed=await packageAssets({source:out,out:site,allowEmptyRetained:true});
 server=createServer(async(req,res)=>{try{
  requests.push({method:req.method,path:req.url});if(req.method!=='GET')throw Error('No writes allowed in archive browser proof');
  const url=new URL(req.url,'http://local');if(url.pathname==='/archive-harness.html'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Retained archive test</title><script src="/_atlas-assets/'+packed.releaseId+'/'+loader+'"></script>');return;}
  const file=path.resolve(site,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(site+path.sep))throw Error('Outside test site');res.setHeader('content-type',/\.(js|mjs)$/.test(file)?'text/javascript':'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.ATLAS_BROWSER_CHANNEL?{channel:process.env.ATLAS_BROWSER_CHANNEL}:{})});const page=await browser.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await page.goto(origin+'/archive-harness.html');assert.equal(await page.evaluate(()=>typeof window.AtlasMigrationArchive),'undefined','Archive stays lazy and cannot run during loader startup');
 const result=await page.evaluate(async()=>{
  localStorage.setItem('synthetic-history-marker','unchanged');
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('atlas_rise_state_v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('state',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const canonical=Array.from({length:240},(_,i)=>({key:'synthetic-'+i,communityId:'scoped-community',period:'2026-09',sourceRow:i+1,zero:0,missing:null,amount:-1.005,sourceText:'Ω🧭\ud800\n'.repeat(24)}));
  const history={canonicalRecords:canonical,batches:Array.from({length:32},(_,i)=>({id:'original-'+i,status:'Approved',beforeSnapshot:{canonicalRecords:canonical.slice(i,i+20),sourceFile:'original.xlsx',capturedAt:'2026-09-28T00:00:00Z'}})),lineage:[{id:'retained',currentState:false,zero:0,missing:null}],sourceArchive:[{id:'source',hash:'exact-original'}],reconciliationLog:[{before:0,after:null,reason:'preserved'}]};
  const records=[{key:'atlas_data_import_2_state_v1',value:history},{key:'atlas_data_import_source_file:source',blob:new Blob([Uint8Array.from({length:2500},(_,i)=>i%256)],{type:'application/vnd.synthetic-source'})}];
  await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');for(const row of records)tx.objectStore('state').put(row);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  const read=()=>new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const source=await read(),textBefore=JSON.stringify(source[0]),blobBefore=Array.from(new Uint8Array(await source[1].blob.arrayBuffer()));
  await Promise.all([AtlasFeatures.load('zip'),AtlasFeatures.load('migrationArchive'),AtlasFeatures.load('migrationArchive')]);
  const bundle={keys:{approved:'retained'},indexedDb:{communityData:{Example:{month:8,zero:0,missing:null,signed:-1.005}}}};
  const stringify=JSON.stringify,parse=JSON.parse;let archive,restored,proof,largestTokenSegment=0;
  JSON.stringify=function(value,...args){if(value&&typeof value==='object'&&(value.key==='atlas_data_import_2_state_v1'||Object.hasOwn(value,'canonicalRecords')||Object.hasOwn(value,'beforeSnapshot')))throw Error('Whole source/history JSON allocation');return stringify.call(this,value,...args);};
  JSON.parse=function(text,...args){if(text.startsWith('[[')){const size=new TextEncoder().encode(text).length;if(size>4096)throw Error('Unbounded token parse');largestTokenSegment=Math.max(size,largestTokenSegment);}return parse.call(this,text,...args);};
  try{archive=await AtlasMigrationArchive.pack(bundle,source,JSZip,{segmentBytes:4096});restored=await AtlasMigrationArchive.unpack(archive,JSZip);proof=await AtlasMigrationArchive.verifyRestore(archive,JSZip);}finally{JSON.stringify=stringify;JSON.parse=parse;}
  if(JSON.stringify(restored.records[0])!==textBefore)throw Error('Retained history differs after archive roundtrip');
  if(JSON.stringify(Array.from(new Uint8Array(await restored.records[1].blob.arrayBuffer())))!==JSON.stringify(blobBefore)||restored.records[1].blob.type!==source[1].blob.type)throw Error('Original Blob bytes/type differ');
  if(JSON.stringify(restored.bundle)!==JSON.stringify(bundle))throw Error('Bundle missing/zero/source values changed');
  const after=await read();if(JSON.stringify(after[0])!==textBefore||JSON.stringify(Array.from(new Uint8Array(await after[1].blob.arrayBuffer())))!==JSON.stringify(blobBefore))throw Error('Original IndexedDB changed');
  if(localStorage.getItem('synthetic-history-marker')!=='unchanged')throw Error('Original storage changed');
  let tamperBlocked=false;try{await AtlasMigrationArchive.verifyRestore({...archive,bytes:archive.bytes+1},JSZip);}catch(error){tamperBlocked=/fingerprint/.test(error.message);}if(!tamperBlocked)throw Error('Tampered evidence accepted');
  const small=await AtlasMigrationArchive.pack({keys:{zero:0,missing:null}},[],JSZip),smallResult=await AtlasMigrationArchive.unpack(small,JSZip);if(smallResult.manifest.entries.some(e=>e.layout!==undefined))throw Error('Small archive changed legacy layout');
  const tempNames=(await indexedDB.databases()).map(x=>x.name).filter(x=>x?.startsWith('atlas_migration_rollback_test_'));db.close();
  return {proof,recordCount:restored.records.length,batches:restored.records[0].value.batches.length,canonicalRecords:restored.records[0].value.canonicalRecords.length,segments:restored.manifest.entries.reduce((n,e)=>n+(e.segments?.length||0),0),largestTokenSegment,tamperBlocked,temporaryRestoreDatabasesRemaining:tempNames,archiveSha256:archive.sha256};
 });
 assert.equal(result.proof.passed,true);assert.equal(result.proof.recordsRestored,3);assert.equal(result.batches,32);assert.equal(result.canonicalRecords,240);assert(result.segments>1);assert(result.largestTokenSegment<=4096);assert.equal(result.tamperBlocked,true);
 // IndexedDB delete is asynchronous; wait for only the throwaway restore DBs.
 await page.waitForFunction(async()=>!(await indexedDB.databases()).some(x=>x.name?.startsWith('atlas_migration_rollback_test_')));
 const loaded=requests.filter(x=>new URL(x.path,origin).pathname.endsWith('/migration-archive.js'));
 assert.equal(loaded.length,1,'Concurrent lazy loads share the exact archive implementation');assert(loaded[0].path.startsWith('/_atlas-assets/'+packed.releaseId+'/'),'Old query token is scoped by the new immutable release');
 assert.equal(requests.filter(x=>x.method!=='GET'||/\/rpc\/|atlas_app_documents|workspace-projection/.test(x.path)).length,0,'No central access, projection or cloud publication');assert.deepEqual(errors,[]);
 console.log('PASS retained lazy loader: exact new archive bytes in immutable release, bounded oversized history/Blob roundtrip,32batches,zero/null/signed values, temporary IDB restore and tamper rejection; original storage and auth untouched.');
}finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(tmp,{recursive:true,force:true});}
