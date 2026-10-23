// Synthetic browser-only transport proof. No live workspace, credentials or remote writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {composeFinanceCompatSource,OPERATIONAL_RELEASE} from './compose-finance-compat-source.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const repo=path.resolve(import.meta.dirname,'..'),tmp=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-blob-browser-'));
const requests=[],external=[],errors=[];let server,browser;
const guard=`const originalBlobText=Blob.prototype.text;Blob.prototype.text=function(){if(this.size>262144)throw Error('Whole archive text allocation');return originalBlobText.call(this);};`;
try{
 const old=path.join(tmp,'old'),retained=path.join(tmp,'retained');await fs.mkdir(old);
 execFileSync('git',['archive','--format=tar','--output='+path.join(tmp,'old.tar'),'origin/atlas-asset-releases:_atlas-assets/'+OPERATIONAL_RELEASE],{cwd:repo});execFileSync('tar',['-xf',path.join(tmp,'old.tar'),'-C',old]);
 const composition=await composeFinanceCompatSource({operationalSource:old,financeSource:path.join(repo,'docs'),out:retained});
 assert.equal(composition.archiveFile.boundaryCount,3);
 const current=path.join(repo,'docs/portfolio-operations-dashboard'),roots={current,retained:path.join(retained,'portfolio-operations-dashboard')};
 server=createServer(async(req,res)=>{try{
  requests.push({method:req.method,path:req.url});if(req.method!=='GET')throw Error('No HTTP writes allowed');
  const url=new URL(req.url,'http://local');
  if(url.pathname==='/harness.html'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Synthetic archive Blob proof</title>');return;}
  if(url.pathname==='/current/features/guard-canonical-worker.js'){res.setHeader('content-type','text/javascript');res.end(guard+`importScripts('/current/features/canonical-evidence-worker.js');`);return;}
  const [,surface,...rest]=url.pathname.split('/'),base=roots[surface];if(!base)throw Error('Unknown test surface');
  const file=path.resolve(base,...rest);if(!file.startsWith(base+path.sep))throw Error('Outside test tree');
  res.setHeader('content-type',/\.(mjs|js)$/.test(file)?'text/javascript':'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.ATLAS_BROWSER_CHANNEL?{channel:process.env.ATLAS_BROWSER_CHANNEL}:{})});
 for(const surface of ['current','retained']){
  const page=await browser.newPage({acceptDownloads:true});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin)return route.continue();external.push(u.origin);return route.abort();});
  await page.goto(origin+'/harness.html');await page.addScriptTag({content:guard});
  await page.addScriptTag({url:`/${surface}/vendor/jszip.min.js`});await page.addScriptTag({url:`/${surface}/migration-archive.js`});
  const source=await fs.readFile(path.join(roots[surface],surface==='current'?'workspace-core.js':'index.html'),'utf8');
  const helper=source.match(/^function downloadAtlasJsonFile\([^\n]*\) \{[\s\S]*?^\}/m)?.[0];assert(helper);await page.addScriptTag({content:helper});
  const download=page.waitForEvent('download');
  const proof=await page.evaluate(async surface=>{
   const api=AtlasMigrationArchive,{readPortableBundleFile}=await import('/'+surface+'/features/portable-bundle-file.mjs');
   const check=(yes,message)=>{if(!yes)throw Error(message);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
   const bytes=new Uint8Array(384*1024);for(let i=0;i<bytes.length;i+=65536)crypto.getRandomValues(bytes.subarray(i,i+65536));
   const leaf={zero:0,missing:null,signed:-1.005,text:'Ω😀\ud800 preserved\n'.repeat(48)};
   const history={pendingBatch:null,batches:Array.from({length:34},(_,i)=>({id:'batch-'+i,status:'Approved',approvedAt:'2026-10-22T12:00:00Z',beforeSnapshot:{capturedAt:'2026-10-21',index:i,prior:Array(20).fill(leaf)},files:[{fileName:'synthetic.xlsx',reportType:'box_score'}]})),sourceArchive:[{id:'original',fileHash:'source-hash',importStatus:'Approved',reportType:'box_score'}],canonicalRecords:[{key:'zero',communityName:'Example',periodKey:'2026-10',fileHash:'source-hash',reportType:'box_score',values:{occupied_units:0,total_units:10,missing:null}}],lineage:[],reconciliationLog:[leaf],exceptions:[]};
   const bundle={keys:{rise_ops_global_v1:JSON.stringify({selectedPeriod:'2026-10',zero:0,missing:null})},indexedDb:{communityData:{Example:{currentMonth:9,zero:0,missing:null,monthlyData:[leaf]}},dailyBackups:{retained:{zero:0,missing:null}}}};
   const records=[{key:'atlas_data_import_2_state_v1',value:history},{key:'atlas_data_import_source_file:original',blob:new Blob([bytes],{type:'application/x-synthetic'})},{key:'occupancy_replay_backup:retained',value:{prior:Array(30).fill(leaf)}}];
   const sourceDatabase='blob-source-'+crypto.randomUUID(),db=await new Promise((resolve,reject)=>{const r=indexedDB.open(sourceDatabase,1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const read=()=>new Promise((resolve,reject)=>{const r=db.transaction('records').objectStore('records').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');for(const record of records)tx.objectStore('records').put(record);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});
   localStorage.setItem('synthetic-auth-sentinel','unchanged');
   const archive=await api.pack(bundle,await read(),JSZip,{segmentBytes:4096,inlineLimit:0});
   check(archive.dataBlob instanceof Blob&&typeof archive.data!=='string','Large path must use Blob transport');check(archive.dataBlob.size>262144,'Fixture must exceed guarded whole-text size');
   const validation=await api.verifyRestore(archive,JSZip);
   const portable=await api.toJsonBlob({...archive,rollbackValidation:validation,reconciliation:{synthetic:true}});
   let downloaded;const create=URL.createObjectURL;URL.createObjectURL=function(value){downloaded=value;return create.call(this,value);};
   try{downloadAtlasJsonFile(portable,'synthetic-'+surface+'-rollback.json');}finally{URL.createObjectURL=create;}
   check(downloaded===portable,'Actual download helper must preserve the JSON Blob');
   const parsed=await readPortableBundleFile(new File([downloaded],'synthetic-rollback.json',{type:'application/json'}),{api});
   check(parsed.dataBlob instanceof Blob&&!Object.hasOwn(parsed,'data'),'File parser must retain bounded Blob data');
   check(parsed.sha256===archive.sha256&&parsed.bytes===archive.bytes,'ZIP identity must survive file download/read');
   check(parsed.rollbackValidation.passed&&parsed.reconciliation.synthetic,'Rollback envelope metadata must survive');
   const restored=await api.unpack(parsed,JSZip),historyRecord=restored.records.find(r=>r.key==='atlas_data_import_2_state_v1'),binary=restored.records.find(r=>r.key==='atlas_data_import_source_file:original').blob;
   check(same(restored.bundle,bundle)&&same(historyRecord.value,history),'All retained history and operational values must roundtrip');
   check(same(Array.from(new Uint8Array(await binary.arrayBuffer())),Array.from(bytes)),'Original source binary must roundtrip');
   const small=await api.pack({zero:0,missing:null},[],JSZip,{inlineLimit:0}),wire=JSON.parse(await(await api.toJsonBlob(small)).text());
   check(typeof wire.data==='string'&&!Object.hasOwn(wire,'dataBlob'),'Downloaded schema must remain legacy JSON data field');
   check((await api.unpack(wire,JSZip)).bundle.zero===0,'Legacy archive input remains readable');
   const identity={documentKey:'atlas_dashboard_state_v1',version:4,archiveHash:archive.sha256,effectiveAt:'2026-10-22T12:00:00Z'};
   let workerCommits=0;
   const {initializeCanonicalEvidence}=await import('/current/features/canonical-evidence.mjs');
   const typed=await initializeCanonicalEvidence({archive:parsed,options:{mode:'proof',storeName:'records',key:'atlas_data_import_2_state_v1',filePrefix:'atlas_data_import_source_file:',source:identity,includeBundle:true},assertCurrent(){},beforeCommit:async()=>workerCommits++,readPart:async()=>{throw Error('No central read permitted');},workerFactory:()=>new Worker('/current/features/guard-canonical-worker.js')});
   check(typed.passed&&typed.recordsRestored===records.length+1&&same(typed.bundle,bundle),'Actual canonical worker must restore typed retained evidence');
   const projection=await new Promise((resolve,reject)=>{const worker=new Worker('/current/features/workspace-projection-worker.js');worker.onmessage=({data})=>{worker.terminate();data.ok?resolve(data.value):reject(Error(data.error));};worker.onerror=e=>{worker.terminate();reject(Error(e.message));};worker.postMessage({archive:parsed,source:identity});});
   check(same(projection.communityData,bundle.indexedDb.communityData)&&projection.importState.historyStorage.counts.batches===34,'Actual projection must preserve source metrics and full history counts');
   const damaged={...parsed,sha256:'f'.repeat(64)};let refused=false;
   try{await initializeCanonicalEvidence({archive:damaged,options:{mode:'proof',storeName:'records',key:'atlas_data_import_2_state_v1',filePrefix:'atlas_data_import_source_file:',source:{...identity,archiveHash:damaged.sha256}},assertCurrent(){},beforeCommit:async()=>{throw Error('Corruption reached commit');},readPart:async()=>{throw Error('No central read permitted');},workerFactory:()=>new Worker('/current/features/guard-canonical-worker.js')});}catch(error){refused=/fingerprint/.test(error.message);}
   check(refused,'Changed archive fingerprint must fail before commit');
   let malformed=false;try{await readPortableBundleFile(new Blob(['{"bundleType":"atlas_migration_archive_v1","data":"unterminated']),{api});}catch{malformed=true;}check(malformed,'Truncated portable JSON must fail');
   const final=await read();check(same(final[0],records[0])&&same(final[2],records[2]),'Source native records must remain unchanged');check(same(Array.from(new Uint8Array(await final[1].blob.arrayBuffer())),Array.from(bytes)),'Source native Blob must remain unchanged');
   check(localStorage.getItem('synthetic-auth-sentinel')==='unchanged'&&localStorage.length===1,'No auth or local setting side effects');
   const temporary=(await indexedDB.databases()).filter(row=>/^(atlas_typed_restore_proof_|atlas_restore_test_)/.test(row.name));check(!temporary.length,'Proof databases must be cleaned');
   db.close();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(sourceDatabase);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
   return {surface,bytes:archive.bytes,base64Bytes:archive.dataBlob.size,records:restored.records.length,batches:historyRecord.value.batches.length,workerCommits,workerProof:typed.passed,projectionBatches:projection.importState.historyStorage.counts.batches,corruptionRefused:refused,malformedRefused:malformed};
  },surface);
  const completed=await download;assert.equal(await completed.failure(),null);assert.equal(proof.workerCommits,1);assert.equal(proof.records,3);assert.equal(proof.batches,34);assert(proof.workerProof&&proof.corruptionRefused&&proof.malformedRefused);console.log('PASS',JSON.stringify(proof));await page.close();
 }
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert(requests.every(r=>r.method==='GET'));
 console.log('PASS current and composed retained Blob export/download/import, legacy wire format, actual canonical/projection workers, bounded whole-text guard, complete history, corruption refusal and no remote/auth writes.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(tmp,{recursive:true,force:true});}
