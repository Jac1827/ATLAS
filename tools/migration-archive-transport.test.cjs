const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../docs/portfolio-operations-dashboard/migration-archive.js');
const Zip=require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');
const binary=length=>{let state=123456789;return Uint8Array.from({length},()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state&255;});};
const clientFixture=()=>{const docs=new Map();let writes=0,reads=0;return {docs,get writes(){return writes;},get reads(){return reads;},client:{readDocument:async key=>{reads++;return docs.get(key);},saveDocument:async row=>{writes++;docs.set(row.documentKey,{payload:structuredClone(row.payload)});}}};};

test('large transport never joins base64 or reads the whole Blob and preserves old portable JSON and exact records',async()=>{
 const bundle={keys:{maintenance:'{"weeks":[{"zero":0,"missing":null}]}'},indexedDb:{communityData:{A:{zero:0,missing:null}}}};
 const bytes=binary(400000),records=[{key:'imports',value:{batches:[{id:'one',beforeSnapshot:{capturedAt:'original',zero:0,missing:null}}]}},{key:'original',value:{blob:new Blob([bytes]),date:new Date('2026-10-23T00:00:00Z')}}];
 const join=Array.prototype.join,text=Blob.prototype.text,stringify=JSON.stringify;let largestRead=0,packed,portable,published,hydrated,restored;
 try{
  Array.prototype.join=function(separator){if(separator===''&&this.length>1&&this.every(x=>typeof x==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(x))&&this.reduce((n,x)=>n+x.length,0)>65536)throw Error('Archive-sized base64 join forbidden');return join.call(this,separator);};
  Blob.prototype.text=function(){largestRead=Math.max(largestRead,this.size);assert(this.size<=262144,'Only bounded transport slices may become text');return text.call(this);};
  JSON.stringify=function(value,...args){if(value?.bundleType===api.TYPE&&(value.dataBlob||typeof value.data==='string'&&value.data.length>65536))throw Error('Whole transport stringify forbidden');return stringify.call(this,value,...args);};
  packed=await api.pack(bundle,records,Zip,{inlineLimit:0});assert(packed.dataBlob instanceof Blob);assert.equal(packed.data,undefined);assert(packed.dataBlob.size>262144);
  restored=await api.unpack(packed,Zip);assert.deepEqual(restored.bundle,bundle);assert.deepEqual(restored.records[0],records[0]);assert.deepEqual(new Uint8Array(await restored.records[1].value.blob.arrayBuffer()),bytes);
  assert.equal(restored.records[1].value.date.toISOString(),records[1].value.date.toISOString());
  const remote=clientFixture();published=await api.publish(packed,remote.client,65536);assert.equal(published.data,undefined);assert.equal(published.dataBlob,undefined);assert.equal(published.bytesData,undefined);assert(published.dataDocuments.length>4);
  const first=remote.writes;await api.publish(packed,remote.client,65536);assert.equal(remote.writes,first,'Immutable parts are reused after verified readback');
  hydrated=await api.hydrate(published,remote.client,{inlineLimit:0});assert(hydrated.dataBlob instanceof Blob);assert.equal(hydrated.data,undefined);
  assert.deepEqual((await api.unpack(hydrated,Zip)).records[0],records[0]);
  portable=await api.toJsonBlob({...hydrated,rollbackValidation:{passed:true},reconciliation:{zero:0,missing:null}});assert.equal(portable.type,'application/json');
 }finally{Array.prototype.join=join;Blob.prototype.text=text;JSON.stringify=stringify;}
 assert(largestRead>0&&largestRead<=262144);
 const legacy=JSON.parse(await portable.text());assert.equal(legacy.dataBlob,undefined);assert.equal(legacy.dataDocuments,undefined);assert.equal(legacy.data,await packed.dataBlob.text());assert.equal(legacy.sha256,packed.sha256);assert.equal(legacy.bytes,packed.bytes);assert.equal(legacy.recordCount,records.length);assert.deepEqual(legacy.reconciliation,{zero:0,missing:null});assert.deepEqual((await api.unpack(legacy,Zip)).bundle,bundle);
 const small=await api.pack({},[],Zip);assert.equal(typeof small.data,'string');assert.equal(small.dataBlob,undefined,'Small archives retain the existing inline API');
 const smallRemote=clientFixture(),smallManifest=await api.publish(small,smallRemote.client,128),smallHydrated=await api.hydrate(smallManifest,smallRemote.client);assert.equal(smallHydrated.data,small.data);assert.equal(smallHydrated.dataBlob,undefined);
});

test('default inline boundary uses a Blob before any engine-sized string is built',async()=>{
 const bytes=binary(12*1048576+1);class ByteOutputZip{file(){}async generateAsync(){return bytes;}}
 const join=Array.prototype.join;let encodedJoin=false;
 try{
  Array.prototype.join=function(separator){if(separator===''&&this.length>1&&typeof this[0]==='string'&&this[0].length===43688){encodedJoin=true;throw Error('Large encoding must not join');}return join.call(this,separator);};
  const archive=await api.pack({},[],ByteOutputZip);assert(archive.dataBlob instanceof Blob);assert.equal(archive.dataBlob.size,Math.ceil(bytes.length/3)*4);assert.equal(archive.bytes,bytes.length);assert.equal(encodedJoin,false);
 }finally{Array.prototype.join=join;}
});

test('invalid, truncated, ambiguous and corrupted Blob transports cannot verify or export',async()=>{
 const archive=await api.pack({zero:0},[],Zip,{inlineLimit:0}),data=await archive.dataBlob.text();
 const invalid=[{...archive,data},{...archive,dataBlob:{}},{...archive,dataBlob:new Blob([data.slice(4)])},{...archive,dataBlob:new Blob(['*'+data.slice(1)])},{...archive,encoding:'unknown'}];
 for(const value of invalid){await assert.rejects(api.openArchive(value,Zip),/transport|fingerprint|base64/);await assert.rejects(api.toJsonBlob(value),/transport|fingerprint|base64/);}
 await assert.rejects(api.openArchive({...archive,dataBlob:new Blob([(data[0]==='A'?'B':'A')+data.slice(1)])},Zip),/fingerprint/);
 await assert.rejects(api.openArchive({...archive,bytes:archive.bytes+1},Zip),/fingerprint|length/);
 await assert.rejects(api.publish({...archive,dataBlob:new Blob(['*'+data.slice(1)])},clientFixture().client,128),/base64/);
 await assert.rejects(api.publish(archive,clientFixture().client,127),/part size/);
 await assert.rejects(api.pack({},[],Zip,{inlineLimit:-1}),/inline archive limit/);
 const remote=clientFixture(),manifest=await api.publish(archive,remote.client,128);
 const ref=manifest.dataDocuments[0];remote.docs.get(ref.documentKey).payload.data='*'.repeat(ref.length);
 await assert.rejects(api.hydrate(manifest,remote.client,{inlineLimit:0}),/missing or changed/);
});

test('transport publication, decoding and download honor cancellation without a successful receipt',async()=>{
 const archive=await api.pack({},[{key:'source',value:{blob:new Blob([binary(3000)])}}],Zip,{inlineLimit:0}),controller=new AbortController();controller.abort();
 const remote=clientFixture();await assert.rejects(api.openArchive(archive,Zip,{signal:controller.signal}),/abort/i);await assert.rejects(api.toJsonBlob(archive,{signal:controller.signal}),/abort/i);await assert.rejects(api.publish(archive,remote.client,128,{signal:controller.signal}),/abort/i);assert.equal(remote.reads,0);assert.equal(remote.writes,0);
 let current=true;const interrupted={...remote.client,saveDocument:async row=>{await remote.client.saveDocument(row);current=false;}};
 await assert.rejects(api.publish(archive,interrupted,128,{isCurrent:()=>current}),/Workspace changed/);assert.equal(remote.writes,1);
 const manifest=await api.publish(archive,remote.client,128),reads=remote.reads;await assert.rejects(api.hydrate(manifest,remote.client,{inlineLimit:0,signal:controller.signal}),/abort/i);assert.equal(remote.reads,reads);
 assert.deepEqual((await api.unpack(await api.hydrate(manifest,remote.client,{inlineLimit:0}),Zip)).bundle,{});
});
