const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {indexedDB,IDBObjectStore}=require('fake-indexeddb');globalThis.indexedDB=indexedDB;
const api=require('../docs/portfolio-operations-dashboard/migration-archive.js'),Zip=require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function guardedApi(){const source=fs.readFileSync(require.resolve('../docs/portfolio-operations-dashboard/migration-archive.js'),'utf8').replace('function tokenReader(){','function tokenReader(){throw Error("Expanded logical record is forbidden in rollback verification");');const box={module:{exports:{}},crypto:globalThis.crypto,indexedDB,Blob,Uint8Array,TextEncoder,TextDecoder,btoa,atob,DOMException,ReadableStream,CompressionStream,DecompressionStream};vm.runInNewContext(source,box);return box.module.exports;}
const emptyTemps=async()=>assert.equal((await indexedDB.databases()).filter(x=>x.name.startsWith('atlas_migration_rollback_test_')).length,0);
test('44 rollback snapshots and63 original files restore exact verified members without materializing any segmented value',async()=>{
 const canonical=Array.from({length:70},(_,i)=>({id:'fact-'+i,original:'Retained source evidence Ω. '.repeat(20),zero:0,missing:null,amount:-1.005}));
 const batches=Array.from({length:44},(_,i)=>({id:'batch-'+i,beforeSnapshot:{capturedAt:'2026-10-'+String(i%19+1).padStart(2,'0'),canonicalRecords:canonical,lineage:[{id:'lineage-'+i,currentState:false}],prior:{nested:{zero:0,missing:null}}}}));
 const originals=Array.from({length:63},(_,i)=>new Uint8Array(Array.from({length:1500+i},(_,j)=>(i+j)%256)));
 const records=[{key:'atlas_data_import_2_state_v1',value:{batches,sourceArchive:originals.map((x,i)=>({id:'original-'+i,fileHash:sha(x)})),canonicalRecords:canonical,lineage:[]}},...originals.map((x,i)=>({key:'source-'+i,value:{blob:new Blob([x]),when:new Date('2026-10-19T00:00:00Z')}}))];
 const archive=await api.pack({retained:'exact'},records,Zip,{segmentBytes:4096});
 const restored=await api.unpack(archive,Zip);assert.deepEqual(restored.records[0],records[0]);
 for(let i=0;i<63;i++)assert.equal(sha(Buffer.from(await restored.records[i+1].value.blob.arrayBuffer())),sha(originals[i]));
 const progress=[],put=IDBObjectStore.prototype.put;let writes=0;
 IDBObjectStore.prototype.put=function(value,key){if(value instanceof Uint8Array){assert(value.length<=4096+65536);writes++;}else if(value?.value?.batches)throw Error('Expanded history cloned into rollback DB');return put.call(this,value,key);};
 try{const proof=await guardedApi().verifyRestore(archive,Zip,{onProgress:x=>progress.push(x)});assert(proof.passed);assert.equal(proof.recordsRestored,65);}finally{IDBObjectStore.prototype.put=put;}
 assert(writes>44);assert.equal(progress.at(-1).completed,progress.at(-1).total);await emptyTemps();
 // Publishing the same byte stream as614 parts models production hydration.
 const docs=new Map(),refs=[];for(let i=0;i<614;i++){const data=archive.data.slice(Math.floor(archive.data.length*i/614),Math.floor(archive.data.length*(i+1)/614)),hash=sha(Buffer.from(data)),documentKey='atlas_migration_part_v1:'+hash;docs.set(documentKey,{payload:{data,sha256:hash}});refs.push({documentKey,length:data.length,sha256:hash});}
 const {data,...head}=archive;const published={...head,dataDocuments:refs};let reads=0;
 const hydrated=await api.hydrate(published,{readDocument:async key=>{reads++;return docs.get(key);}});assert.equal(reads,614);assert.equal(hydrated.sha256,archive.sha256);assert.equal(hydrated.data,archive.data);
});
test('native member corruption and workspace cancellation fail without a successful gate and clean temp storage',async()=>{
 const archive=await api.pack({},[{key:'history',value:{history:Array(100).fill('immutable'.repeat(200))}}],Zip,{segmentBytes:4096}),get=IDBObjectStore.prototype.get;
 try{IDBObjectStore.prototype.get=function(key){const r=get.call(this,key);if(typeof key==='string'&&key.includes('.segment-'))r.addEventListener('success',()=>{r.result[0]^=1;});return r;};await assert.rejects(guardedApi().verifyRestore(archive,Zip),/fingerprint mismatch/);}finally{IDBObjectStore.prototype.get=get;}
 await emptyTemps();let current=true;
 await assert.rejects(guardedApi().verifyRestore(archive,Zip,{isCurrent:()=>current,onProgress:x=>{if(x.completed>2)current=false;}}),/Workspace changed/);await emptyTemps();
 assert((await guardedApi().verifyRestore(archive,Zip)).passed,'Retry succeeds after cancelled isolated restore');await emptyTemps();
});
test('token batch packing retains exact scalar, date, binary and nested order with bounded asynchronous work',async()=>{
 const value={zero:0,missing:null,negative:-1.005,text:'Ω🧭'.repeat(1000),when:new Date('2026-10-19T00:00:00Z'),blob:new Blob([new Uint8Array([0,255,11])]),history:[{beforeSnapshot:{capturedAt:'source',empty:''}}]};
 async function* batches(){let batch=[];for(const token of api.recordTokens(value,512)){batch.push(token);if(batch.length===20){yield batch;batch=[];}}if(batch.length)yield batch;}
 const packed=await api.packTokenRecord('record-0.json',batches(),{segmentBytes:512});
 const archive=await api.packRecords({}, {count:1,readRecord:()=>{throw Error('Expanded source read forbidden');},readPackedRecord:()=>packed},Zip,{segmentBytes:512});
 const restored=await api.unpack(archive,Zip);assert.equal(restored.records[0].text,value.text);assert.equal(restored.records[0].when.toISOString(),value.when.toISOString());assert.deepEqual(Buffer.from(await restored.records[0].blob.arrayBuffer()),Buffer.from(await value.blob.arrayBuffer()));assert.deepEqual(restored.records[0].history,value.history);assert.equal(restored.records[0].missing,null);assert.equal(restored.records[0].zero,0);
 async function* bad(){yield [['object'],['end'],['value',0]];}await assert.rejects(api.packTokenRecord('record-0.json',bad()),/Multiple migration record roots/);
});

test('bounded compression reuses its input bytes without making native Blob copies',async()=>{
 const source=fs.readFileSync(require.resolve('../docs/portfolio-operations-dashboard/migration-archive.js'),'utf8');
 class NoSegmentBlob{constructor(){throw Error('A compression segment must not be copied into a Blob');}}
 const sandbox={module:{exports:{}},crypto:globalThis.crypto,indexedDB,Blob:NoSegmentBlob,Uint8Array,TextEncoder,TextDecoder,btoa,atob,DOMException,ReadableStream,CompressionStream,DecompressionStream};
 vm.runInNewContext(source,sandbox);const direct=sandbox.module.exports;
 const value={key:'history',value:{zero:0,missing:null,text:'retained source Ω '.repeat(2000)}};
 const archive=await direct.pack({},[value],Zip,{segmentBytes:4096}),decoded=await direct.unpack(archive,Zip);
 assert.deepEqual(JSON.parse(JSON.stringify(decoded.records[0])),value);
 const manifest=decoded.manifest,zip=await Zip.loadAsync(Buffer.from(archive.data,'base64'));
 for(const entry of manifest.entries.filter(x=>x.layout))for(const part of entry.segments){
  const stored=await zip.file(part.name).async('uint8array');
  assert.equal(stored.length,part.storedBytes);assert.equal(sha(stored),part.storedSha256);
  const raw=require('node:zlib').inflateSync(stored);
  assert.equal(raw.length,part.bytes);assert.equal(sha(raw),part.sha256);
  const prior=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  assert.deepEqual(stored,prior,'Input reuse preserves the previous deflate bytes and fingerprints');
 }
});
