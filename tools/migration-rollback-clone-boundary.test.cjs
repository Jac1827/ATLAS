const assert=require('node:assert/strict');
const {indexedDB,IDBObjectStore}=require('fake-indexeddb');globalThis.indexedDB=indexedDB;
const api=require('../docs/portfolio-operations-dashboard/migration-archive.js');
const Zip=require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');
(async()=>{
 const original={key:'atlas_data_import_2_state_v1',value:{batches:[{id:'preserved',beforeSnapshot:{text:'Ω🧭'.repeat(220000),zero:0,missing:null}}],sourceArchive:[{id:'original'}],date:new Date('2026-10-19T12:00:00Z'),blob:new Blob(['exact original workbook'],{type:'application/test'})}};
 const archive=await api.pack({zero:0},[original],Zip);
 const put=IDBObjectStore.prototype.put,get=IDBObjectStore.prototype.get;let writes=0,compressedWrites=0;
 IDBObjectStore.prototype.put=function(value,key){
   writes++;if(value instanceof Uint8Array){compressedWrites++;assert(value.length<=1114112,'Native byte write stays bounded');}
   else if(JSON.stringify(value).length>512*1024)throw new DOMException('Synthetic oversized native clone','DataCloneError');
   return put.call(this,value,key);
 };
 try{const proof=await api.verifyRestore(archive,Zip);assert(proof.passed);assert.equal(proof.recordsRestored,2);assert(compressedWrites>1);assert(writes>compressedWrites);}
 finally{IDBObjectStore.prototype.put=put;}
 assert.equal((await indexedDB.databases()).length,0,'Isolated native storage is removed after successful validation');
 const restored=await api.unpack(archive,Zip);assert.equal(restored.records[0].value.batches[0].beforeSnapshot.text,original.value.batches[0].beforeSnapshot.text);assert.equal(restored.records[0].value.batches[0].beforeSnapshot.missing,null);assert.equal(await restored.records[0].value.blob.text(),'exact original workbook');
 let corrupted=false;
 IDBObjectStore.prototype.get=function(key){const request=get.call(this,key);if(typeof key==='string'&&key.includes('.segment-'))request.addEventListener('success',()=>{if(!corrupted){request.result[0]^=255;corrupted=true;}});return request;};
 try{await assert.rejects(api.verifyRestore(archive,Zip),/fingerprint|readback|corrupt/);}finally{IDBObjectStore.prototype.get=get;}
 assert(corrupted);assert.equal((await indexedDB.databases()).length,0,'Corrupted native storage fails and is removed');
 console.log('PASS bounded rollback native writes, full logical history/Blob/Date/zero/null fidelity, corrupt native segment rejection and cleanup');
})().catch(error=>{console.error(error);process.exitCode=1;});
