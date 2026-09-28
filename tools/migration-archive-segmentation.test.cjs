const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const api=require('../docs/portfolio-operations-dashboard/migration-archive.js'),Zip=require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');
const {indexedDB}=require('fake-indexeddb');globalThis.indexedDB=indexedDB;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const unpackZip=archive=>Zip.loadAsync(Buffer.from(archive.data,'base64'));
async function rebuild(zip,archive){const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}});return{...archive,data:Buffer.from(bytes).toString('base64'),bytes:bytes.length,sha256:hash(bytes)};}
function fixture(){
 const canonical=Array.from({length:95},(_,i)=>({key:'source-'+i,periodKey:'2026-09',sourceRow:i+1,values:{zero:0,missing:null,amount:-1.005,text:'Ω🧭\ud800\n'.repeat(24)},originalValues:{retained:true}}));
 const record={key:'atlas_data_import_2_state_v1',value:{canonicalRecords:canonical,lineage:[{id:'historic',currentState:false}],batches:Array.from({length:4},(_,i)=>({id:'original-'+i,beforeSnapshot:{capturedAt:'2026-09-20T00:00:00Z',canonicalRecords:canonical.slice(0,80-i)}})),sourceArchive:[{id:'one',fileHash:'exact-source'}],reconciliationLog:[{before:0,after:null,reason:'retained'}]}};
 return {bundle:{keys:{original:'retained'},indexedDb:{communityData:{Example:{monthlyData:[{zero:0,missing:null}],notes:'x'.repeat(800)}}}},records:[record,{key:'source-blob',value:{fileName:'source.xlsx',blob:new Blob([Uint8Array.from({length:2500},(_,i)=>i%256)],{type:'application/vnd.test'}),savedAt:new Date('2026-09-28T15:01:02.003Z')}},{key:'sparse',value:Array(45)}]};
}
test('small v1 members retain exact JSON bytes and old readers remain compatible',async()=>{
 const bundle={keys:{text:'source'},indexedDb:{zero:0,missing:null}},records=[{key:'record',value:[0,null,'Ω']}];
 const packed=await api.pack(bundle,records,Zip),zip=await unpackZip(packed),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
 assert.equal(manifest.entries[0].layout,undefined);assert.equal(await zip.file('bundle.json').async('string'),JSON.stringify(bundle));assert.equal(await zip.file('record-0.json').async('string'),JSON.stringify(records[0]));
 assert.equal(manifest.entries[1].sha256,hash(Buffer.from(JSON.stringify(records[0]))));
 const oldSource=execFileSync('git',['show','f7201fe:docs/portfolio-operations-dashboard/migration-archive.js'],{encoding:'utf8'}),sandbox={module:{exports:{}},crypto:globalThis.crypto,Blob,Uint8Array,TextEncoder,TextDecoder,btoa,atob,DOMException};vm.runInNewContext(oldSource,sandbox);
 assert.deepEqual(JSON.parse(JSON.stringify(await sandbox.module.exports.unpack(packed,Zip))),{bundle,records,manifest});
 const newRecord=await api.pack(bundle,[{key:'large',value:Array(60).fill('retained data'.repeat(80))}],Zip,{segmentBytes:512});
 await assert.rejects(()=>sandbox.module.exports.unpack(newRecord,Zip),/async|null/,'Old readers must fail before treating descriptors as source data');
});
test('segmented pack/unpack/IDB verification never serializes or parses a whole oversized record',async()=>{
 const source=fixture(),stringify=JSON.stringify,parse=JSON.parse;let largestParsedSegment=0;
 JSON.stringify=function(value,...args){if(value&&typeof value==='object'&&(value.key==='atlas_data_import_2_state_v1'||Object.hasOwn(value,'canonicalRecords')||Object.hasOwn(value,'beforeSnapshot')))throw Error('Whole financial/history record serialization attempted');return stringify.call(this,value,...args);};
 JSON.parse=function(text,...args){if(text.startsWith('[[')){assert(Buffer.byteLength(text)<=512,'Only bounded token segments may be parsed');largestParsedSegment=Math.max(largestParsedSegment,Buffer.byteLength(text));}return parse.call(this,text,...args);};
 let packed,restored,proof;
 try{packed=await api.pack(source.bundle,source.records,Zip,{segmentBytes:512});restored=await api.unpack(packed,Zip);proof=await api.verifyRestore(packed,Zip);}finally{JSON.stringify=stringify;JSON.parse=parse;}
 assert.deepEqual(restored.bundle,source.bundle);assert.deepEqual(restored.records[0],source.records[0]);assert.deepEqual(restored.records[2].value,Array(45).fill(null),'Legacy JSON sparse-array semantics remain null');
 assert(restored.records[1].value.savedAt instanceof Date);assert.equal(restored.records[1].value.savedAt.toISOString(),source.records[1].value.savedAt.toISOString());
 assert.equal(restored.records[1].value.blob.type,source.records[1].value.blob.type);assert.deepEqual(Buffer.from(await restored.records[1].value.blob.arrayBuffer()),Buffer.from(await source.records[1].value.blob.arrayBuffer()));
 assert(proof.passed);assert.equal(proof.recordsRestored,source.records.length+1);assert(largestParsedSegment<=512&&largestParsedSegment>400);
 const zip=await unpackZip(packed);for(const entry of restored.manifest.entries.filter(e=>e.layout)){assert.equal(zip.file(entry.name),null);assert(entry.segments.length>1);assert(entry.segments.every(s=>s.bytes<=512));}
});
test('missing, corrupt, reordered, duplicate and unsupported segmented evidence fails closed',async()=>{
 const {bundle,records}=fixture(),packed=await api.pack(bundle,records,Zip,{segmentBytes:512});
 for(const corruption of ['missing','bytes','order','duplicate','layout','logicalDescriptor','count','logicalOrder']){
  const zip=await unpackZip(packed),manifest=JSON.parse(await zip.file('manifest.json').async('string')),entry=manifest.entries.find(e=>e.layout),segment=entry.segments[0];
  if(corruption==='missing')zip.remove(segment.name);
  if(corruption==='bytes')zip.file(segment.name,'[["value",0]]');
  if(corruption==='order')entry.segments.reverse();
  if(corruption==='duplicate')manifest.entries.push(manifest.entries[0]);
  if(corruption==='layout')entry.layout='unreviewed-layout';
  if(corruption==='logicalDescriptor')zip.file(entry.name,JSON.stringify({segments:entry.segments}));
  if(corruption==='count')entry.bytes++;
  if(corruption==='logicalOrder')manifest.entries.reverse();
  zip.file('manifest.json',JSON.stringify(manifest));
  const changed=await rebuild(zip,packed);await assert.rejects(()=>api.unpack(changed,Zip),/Migration|migration|Unsupported/,corruption);
 }
});
test('segmented archives retain immutable chunk transfer, exact readback and actor cancellation',async()=>{
 const {bundle,records}=fixture(),archive=await api.pack(bundle,records,Zip,{segmentBytes:512}),docs=new Map();let writes=0,current=true;
 const client={readDocument:async key=>docs.get(key),saveDocument:async o=>{assert.equal(o.expectedVersion,null);assert(o.documentKey.endsWith(hash(Buffer.from(o.payload.data))));docs.set(o.documentKey,{payload:structuredClone(o.payload)});writes++;}};
 const published=await api.publish(archive,client,2048,{isCurrent:()=>current});const first=writes;await api.publish(archive,client,2048,{isCurrent:()=>current});assert.equal(writes,first);
 const restored=await api.unpack(await api.hydrate(published,client),Zip);assert.deepEqual(restored.records[0],records[0]);
 const cancelled={readDocument:client.readDocument,saveDocument:async o=>{await client.saveDocument(o);current=false;}};docs.clear();current=true;await assert.rejects(()=>api.publish(archive,cancelled,2048,{isCurrent:()=>current}),/Workspace changed/);assert.equal(docs.size,1,'Actor change stops subsequent source part writes');
});

test('segmented object keys and unsupported cycles preserve data or fail before creating an archive',async()=>{
 const value=JSON.parse('{"__proto__":{"retained":true},"constructor":"source data","ordered":[0,null,-1.005]}');
 const archive=await api.pack({},[{key:'special',value}],Zip,{segmentBytes:512}),restored=await api.unpack(archive,Zip);
 assert.deepEqual(restored.records[0].value,value);assert.equal(Object.getPrototypeOf(restored.records[0].value),Object.prototype);assert.equal({}.retained,undefined);
 const cycle={};cycle.self=cycle;await assert.rejects(()=>api.pack({},[{key:'cyclic',value:cycle}],Zip,{segmentBytes:512}),/Cyclic/);
 await assert.rejects(()=>api.pack({},[{value:1n}],Zip,{segmentBytes:512}),/BigInt/);
});

test('repeated history retains compressed segments in JSZip, not a second full serialized history',async()=>{
 const limit=65536,leaf='Immutable historical source evidence Ω 0 null -1.005. '.repeat(180);
 const rows=Array.from({length:40},(_,i)=>({sourceRow:i+1,original:leaf,zero:0,missing:null}));
 const history={key:'atlas_data_import_2_state_v1',value:{batches:Array.from({length:48},(_,i)=>({id:'batch-'+i,beforeSnapshot:{canonicalRecords:rows}}))}};
 let retainedBytes=0,largestRetained=0,segments=0;
 function TrackedZip(){const zip=new Zip(),file=zip.file;zip.file=function(name,value,options){if(name.includes('.segment-')&&value!==undefined){assert.equal(options?.compression,'STORE');assert(value instanceof Uint8Array);assert.notEqual(value[0],91,'Raw token arrays must not be retained');retainedBytes+=value.length;largestRetained=Math.max(largestRetained,value.length);segments++;}return file.apply(this,arguments);};return zip;}
 const archive=await api.pack({},[history],TrackedZip,{segmentBytes:limit}),zip=await unpackZip(archive),manifest=JSON.parse(await zip.file('manifest.json').async('string')),entry=manifest.entries[1];
 assert(entry.bytes>18000000,'Meaningful repeated-history serialized volume');assert(segments>250);assert(largestRetained<=limit+65536);assert(retainedBytes<entry.bytes/20,'Only compressed bounded segments may accumulate in the archive');
 assert.equal(retainedBytes,entry.segments.reduce((sum,p)=>sum+p.storedBytes,0));assert(entry.segments.every(p=>p.encoding==='deflate'&&p.bytes<=limit));
 const restored=await api.unpack(archive,Zip);assert.equal(restored.records[0].value.batches.length,48);assert.equal(restored.records[0].value.batches[47].beforeSnapshot.canonicalRecords[39].original,leaf);
 assert.equal(restored.records[0].value.batches[0].beforeSnapshot.canonicalRecords[0].zero,0);assert.equal(restored.records[0].value.batches[0].beforeSnapshot.canonicalRecords[0].missing,null);
 assert((await api.verifyRestore(archive,Zip)).passed);
 console.log(JSON.stringify({repeatedHistoryProof:{uncompressedTokenBytes:entry.bytes,retainedCompressedSegmentBytes:retainedBytes,largestRetainedSegment:largestRetained,segments,archiveBytes:archive.bytes}}));
});

test('declared segment byte limits stop bounded decompression even when an altered manifest rehashes correctly',async()=>{
 const {bundle,records}=fixture(),packed=await api.pack(bundle,records,Zip,{segmentBytes:512}),zip=await unpackZip(packed),manifest=JSON.parse(await zip.file('manifest.json').async('string')),entry=manifest.entries.find(e=>e.layout),part=entry.segments[0];
 const tooLarge=Buffer.from('[["text","'+'x'.repeat(65536)+'"]]'),stored=new Uint8Array(await new Response(new Blob([tooLarge]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
 part.storedBytes=stored.length;part.storedSha256=hash(stored);part.sha256=hash(tooLarge);zip.file(part.name,stored,{compression:'STORE'});
 entry.sha256=hash(Buffer.from(JSON.stringify({layout:entry.layout,name:entry.name,segmentBytes:entry.segmentBytes,segments:entry.segments})));zip.file('manifest.json',JSON.stringify(manifest));
 const changed=await rebuild(zip,packed);await assert.rejects(()=>api.unpack(changed,Zip),/exceeds its verified byte limit/);
});

// These raw segment fingerprints were recorded from the reviewed asynchronous
// traversal. Compression metadata is excluded because native codecs can vary.
test('synchronous token traversal preserves every ordered token byte without per-value promises',async()=>{
 const value={key:'exact-token-order',value:{string:'Ω🧭\ud800\n'.repeat(99),empty:'',zero:0,negative:-1.005,missing:null,notFinite:Infinity,when:new Date('2026-09-28T15:01:02.003Z'),blob:new Blob([Uint8Array.from({length:777},(_,i)=>i%256)],{type:'application/vnd.test'}),array:[undefined,,null,false],history:Array.from({length:13},(_,i)=>({id:i,beforeSnapshot:{rows:[{amount:0,absent:null,text:'before'}]}})),own:JSON.parse('{"__proto__":{"retained":true},"constructor":"original"}')}};
 const expected=[{limit:512,bytes:10087,segments:21,sha:'31efc7c343801ac57f782587f67cd666d28148b5fed0ad3a1b54842f4da8fea9'},{limit:4096,bytes:9812,segments:3,sha:'6e1fbd284bc11bab0c3eeaed928927eda01462b3a80e6e2f95208d43f7c72649'},{limit:1048576,bytes:9798,segments:1,sha:'5187b8e89df6db6e7e12cf7e788c1e3051b0f90c448d2b566c0c21d2f6a7fc2a'}];
 for(const proof of expected){const archive=await api.pack({},[value],Zip,{segmentBytes:proof.limit}),zip=await unpackZip(archive),manifest=JSON.parse(await zip.file('manifest.json').async('string')),entry=manifest.entries[1],raw=entry.segments.map(p=>({name:p.name,bytes:p.bytes,sha256:p.sha256}));assert.equal(entry.bytes,proof.bytes);assert.equal(raw.length,proof.segments);assert.equal(hash(Buffer.from(JSON.stringify(raw))),proof.sha);}
 let promises=0;const hook=require('node:async_hooks').createHook({init(_id,type){if(type==='PROMISE')promises++;}});hook.enable();
 try{await api.pack({},[{when:new Date('2026-09-28T00:00:00Z'),history:Array.from({length:10000},(_,i)=>i)}],Zip);}finally{hook.disable();}
 assert(promises<5000,'Primitive traversal must not allocate promises per value; observed '+promises);
});
