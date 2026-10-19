import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initializeCanonicalArchive} from '../docs/portfolio-operations-dashboard/features/canonical-evidence-store.mjs';
import {executeHistory,historyHash,iterateStoredHistoryTokens} from '../docs/portfolio-operations-dashboard/features/import-history-store.mjs';
import {createJsonTokenSink,tokensFromJsonBlob} from '../docs/portfolio-operations-dashboard/features/migration-token-stream.mjs';
const require=createRequire(import.meta.url),api=require('../docs/portfolio-operations-dashboard/migration-archive.js'),Zip=require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');
require('fake-indexeddb/auto');
const key='imports',filePrefix='file:';
async function fixture(){
 const dbName='streaming-'+crypto.randomUUID(),db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onupgradeneeded=()=>r.result.createObjectStore('state',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const io=(mode,action)=>new Promise((resolve,reject)=>{const tx=db.transaction('state',mode);let r;try{r=action(tx.objectStore('state'));}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(r?.result);tx.onabort=tx.onerror=()=>reject(tx.error);});
 const source={documentKey:'source',version:4,archiveHash:'placeholder'};
 const leaf={zero:0,missing:null,unicode:'Ω😀\ud800',text:'Retained evidence. '.repeat(100)};
 const value={pendingBatch:null,batches:Array.from({length:44},(_,i)=>({id:'b'+i,createdAt:'2026-10-01',beforeSnapshot:{capturedAt:'2026-10-01T00:00:00Z',batchIndex:i,prior:Array(70).fill(leaf)}})),sourceArchive:Array.from({length:63},(_,i)=>({id:'s'+i,reportType:'test'})),canonicalRecords:[{key:'one',values:{zero:0,missing:null}}],lineage:[]};
 const records=[{key,value,updatedAt:'2026-10-02'},...Array.from({length:63},(_,i)=>({key:filePrefix+i,value:{blob:new Blob(['source '+i])}})),{key:'occupancy_replay_backup:kept',value:{saved:0,missing:null,prior:Array(700).fill(leaf)}}];
 const archive=await api.pack({indexedDb:{communityData:{Community:{zero:0,missing:null}}}},records,Zip,{segmentBytes:65536});source.archiveHash=archive.sha256;
 await io('readwrite',s=>s.put({key:'atlas_workspace_source_v2',value:{identity:source}}));
 return {dbName,db,io,source,value,archive,records,args:{archive,Zip,api,dbName,storeName:'state',key,filePrefix,source},close:async()=>{db.close();await new Promise(r=>{const q=indexedDB.deleteDatabase(dbName);q.onsuccess=r;});}};
}
test('streamed canonical initializer preserves44 snapshots63 sources and binary files without full root decoding',async()=>{
 const f=await fixture();try{
  const read=api.readArchiveRecord,tracked={...api,readArchiveRecord:async(zip,entry)=>{assert(!['record-0.json','record-64.json'].includes(entry.name),'Never decode the large history or retained backup');return read(zip,entry);}};
  const result=await initializeCanonicalArchive({...f.args,api:tracked});assert(result.verified);
  const request={dbName:f.dbName,storeName:'state',key};
  const state=await executeHistory({...request,operation:'load'});assert.equal(state.batches.length,44);assert.equal(state.sourceArchive.length,63);assert.equal(state.batches[0].beforeSnapshot,undefined);
  for(let i=0;i<44;i++){const snap=await executeHistory({...request,operation:'snapshot',batch:state.batches[i]});assert.deepEqual(snap,f.value.batches[i].beforeSnapshot);}
  const legacy=await executeHistory({...request,operation:'legacy',hash:await historyHash(f.value)});assert.deepEqual(legacy,f.value);
  for(let i=0;i<63;i++){const stored=await f.io('readonly',s=>s.get('file:'+i));assert.equal(await stored.value.blob.text(),'source '+i);}
  const backup=await f.io('readonly',s=>s.get('occupancy_replay_backup:kept'));assert.equal(backup.encoding,'gzip-json-v1');
  const sink=createJsonTokenSink();for await(const batch of iterateStoredHistoryTokens(backup)){for(const token of batch)sink.add(token);await sink.flush();}const decoded=await sink.finish();assert.deepEqual(await new Response(decoded.blob.stream().pipeThrough(new DecompressionStream('gzip'))).json(),f.records.at(-1).value);
  assert(!(await f.io('readonly',s=>s.getAllKeys())).some(k=>String(k).startsWith('__atlas_verified_archive_stage:')));
 }finally{await f.close();}
});
test('late source change, cancellation and prior evidence leave originals untouched and no activated receipt',async()=>{
 for(const mode of ['source','abort','prior']){const f=await fixture(),controller=new AbortController();try{
  await assert.rejects(initializeCanonicalArchive({...f.args,signal:controller.signal,beforeCommit:async()=>{
   if(mode==='abort')controller.abort();else if(mode==='source')await f.io('readwrite',s=>s.put({key:'atlas_workspace_source_v2',value:{identity:{...f.source,version:5}}}));else await f.io('readwrite',s=>s.put({key:'file:0',value:{local:'preserve'}}));
  }}),/changed|abort|cancel|retained/i);
  assert.equal(await f.io('readonly',s=>s.get(key)),undefined);assert.equal(await f.io('readonly',s=>s.get('atlas_import_archive_receipt_v2')),undefined);
  assert(!(await f.io('readonly',s=>s.getAllKeys())).some(k=>String(k).startsWith('__atlas_verified_archive_stage:')));
  if(mode==='prior')assert.deepEqual((await f.io('readonly',s=>s.get('file:0'))).value,{local:'preserve'});
 }finally{await f.close();}}
});
test('incremental JSON tokens preserve surrogate boundaries, zero and null and reject malformed tails',async()=>{
 const value={text:'x'.repeat(65530)+'😀\ud800',zero:0,missing:null,array:[[],{},false]};
 const sink=createJsonTokenSink();for await(const batch of tokensFromJsonBlob(new Blob([JSON.stringify(value)]))){for(const token of batch)sink.add(token);await sink.flush();}const result=await sink.finish();assert.equal(result.sha256,await historyHash(value));
 for(const text of ['{"a":1,}','[0,]','{"x":"unterminated','{"x":tru}','[NaN]']){await assert.rejects(async()=>{for await(const batch of tokensFromJsonBlob(new Blob([text])))void batch;},/JSON|retained/);}
});

test('changed staged Blob or history metadata is rejected before any receipt is activated',async()=>{
 for(const target of ['file:1',key]){const f=await fixture();try{
  await assert.rejects(initializeCanonicalArchive({...f.args,beforeCommit:async()=>{
   const row=(await f.io('readonly',s=>s.getAll())).find(r=>r.record?.key===target);
   if(target===key)row.record.value.revision=99;else row.record.value.blob=new Blob(['changed bytes']);
   await f.io('readwrite',s=>s.put(row));
  }}),/fingerprint changed/);
  assert.equal(await f.io('readonly',s=>s.get(key)),undefined);assert.equal(await f.io('readonly',s=>s.get('atlas_import_archive_receipt_v2')),undefined);
 }finally{await f.close();}}
});

test('local rollback restore keeps current binding, marks local edits and refuses existing evidence',async()=>{
 const f=await fixture();try{
  const expected={...f.source,archiveHash:'prior-canonical-hash'};
  await f.io('readwrite',s=>s.put({key:'atlas_workspace_source_v2',value:{identity:expected,verifiedAt:'before',dirty:false}}));
  const restored=await initializeCanonicalArchive({...f.args,source:expected,mode:'local-restore',beforeCommit:async()=>{
   await f.io('readwrite',s=>s.put({key:'atlas_workspace_source_v2',value:{identity:expected,verifiedAt:'fresh observation',dirty:false},updatedAt:'fresh observation'}));
  }});
  assert(restored.verified);assert.deepEqual(restored.bundle.indexedDb.communityData,{Community:{zero:0,missing:null}});
  const binding=(await f.io('readonly',s=>s.get('atlas_workspace_source_v2'))).value;assert.deepEqual(binding.identity,expected);assert.equal(binding.dirty,true);
  assert.equal((await f.io('readonly',s=>s.get('atlas_import_archive_receipt_v2'))).value.archiveHash,f.archive.sha256);
  await assert.rejects(initializeCanonicalArchive({...f.args,source:expected,mode:'local-restore'}),/already has retained/);
 }finally{await f.close();}
});

test('nonportable split or projected histories and typed snapshot coercions fail before activation',async()=>{
 for(const invalid of [{__atlasImportHistory:2,batches:[],sourceArchive:[]},...['current','remote','page','full'].map(view=>({batches:[],sourceArchive:[],historyStorage:{view}})),{batches:[{id:'date',beforeSnapshot:{capturedAt:'2026-01-01',typed:new Date('2026-01-01')}}],sourceArchive:[]}]){
  const f=await fixture();try{
   const archive=await api.pack({indexedDb:{communityData:{}}},[{key,value:invalid}],Zip,{segmentBytes:512});const source={...f.source,archiveHash:archive.sha256};
   await f.io('readwrite',s=>s.put({key:'atlas_workspace_source_v2',value:{identity:source}}));
   await assert.rejects(initializeCanonicalArchive({...f.args,archive,source}),/portable|complete|Typed dates/);
   assert.equal(await f.io('readonly',s=>s.get(key)),undefined);assert.equal(await f.io('readonly',s=>s.get('atlas_import_archive_receipt_v2')),undefined);
  }finally{await f.close();}
 }
});

test('typed rollback proof restores and reads back the operational bundle as well as every retained source',async()=>{
 const f=await fixture();try{await initializeCanonicalArchive({...f.args,mode:'proof'});const bundle=(await f.io('readonly',s=>s.get('__atlas_restore_bundle_proof'))).value;assert.deepEqual(bundle.indexedDb.communityData,{Community:{zero:0,missing:null}});assert.equal((await f.io('readonly',s=>s.get('atlas_import_archive_receipt_v2'))).value.records,65);}finally{await f.close();}
});

test('malformed final member is refused even after every transport fingerprint is recomputed',async()=>{
 const f=await fixture();try{
  const digest=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const zip=await Zip.loadAsync(f.archive.data,{base64:true}),manifest=JSON.parse(await zip.file('manifest.json').async('string')),entry=manifest.entries.at(-1),part=entry.segments.at(-1);
  const stored=await zip.file(part.name).async('uint8array'),plain=await new Response(new Blob([stored]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer(),tokens=JSON.parse(new TextDecoder().decode(plain));
  tokens.push(['value',0]); // A second root is invalid regardless of correct hashes.
  const bytes=new TextEncoder().encode(JSON.stringify(tokens)),compressed=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  entry.bytes+=bytes.length-part.bytes;Object.assign(part,{bytes:bytes.length,sha256:await digest(bytes),storedBytes:compressed.length,storedSha256:await digest(compressed)});
  entry.sha256=await digest(new TextEncoder().encode(JSON.stringify({layout:entry.layout,name:entry.name,segmentBytes:entry.segmentBytes,segments:entry.segments})));
  zip.file(part.name,compressed,{compression:'STORE'});zip.file('manifest.json',JSON.stringify(manifest));
  const packed=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}),archive={...f.archive,bytes:packed.length,sha256:await digest(packed),data:Buffer.from(packed).toString('base64')},source={...f.source,archiveHash:await digest(packed)};
  await f.io('readwrite',s=>s.put({key:'atlas_workspace_source_v2',value:{identity:source}}));
  await assert.rejects(initializeCanonicalArchive({...f.args,archive,source}),/Multiple migration record roots/);
  assert.deepEqual(await f.io('readonly',s=>s.getAllKeys()),['atlas_workspace_source_v2']);
 }finally{await f.close();}
});
