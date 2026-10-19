import assert from 'node:assert/strict';
import {indexedDB,IDBObjectStore} from 'fake-indexeddb';
import {executeHistory,historyHash,historyNamespace} from '../docs/portfolio-operations-dashboard/features/import-history-store.mjs';
globalThis.indexedDB=indexedDB;
const dbName='history-clone-'+crypto.randomUUID(),storeName='records',key='imports';
const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onupgradeneeded=()=>r.result.createObjectStore(storeName,{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const io=(mode,fn)=>new Promise((resolve,reject)=>{const tx=db.transaction(storeName,mode),r=fn(tx.objectStore(storeName));tx.oncomplete=()=>resolve(r?.result);tx.onabort=tx.onerror=()=>reject(tx.error);});
const run=(operation,extra={})=>executeHistory({operation,dbName,storeName,key,...extra});
const source={unknown:{zero:0,nullable:null},batches:Array.from({length:3},(_,i)=>({id:'batch-'+i,status:'Approved',beforeSnapshot:{capturedAt:'snapshot-'+i,savedData:{A:{occupied:i,payload:'x'.repeat(600*1024)}},lineage:[{id:'prior-'+i,importedValue:0}]}})),sourceArchive:[{id:'source-0',communities:['A'],reportType:'box_score'}],canonicalRecords:[],lineage:[],reconciliationLog:[]};
const hash=await historyHash(source),oldPut=IDBObjectStore.prototype.put,oldAdd=IDBObjectStore.prototype.add,oldBlob=Response.prototype.blob;
let prevented=0,compressed=0,hook=null;
function guarded(method){return function(row,...args){if(row.encoding==='gzip-json-v1'){assert(row.value instanceof Blob);compressed++;}else if(JSON.stringify(row).length>512*1024){prevented++;throw new DOMException('Data cannot be cloned, out of memory.','DataCloneError');}return method.call(this,row,...args);};}
try{
 // Existing local legacy data may be readable even when writing another clone
 // fails. Migrate without either a whole backup put or a whole snapshot add.
 await io('readwrite',store=>store.put({key,value:source,updatedAt:'legacy'}));
 IDBObjectStore.prototype.put=guarded(oldPut);IDBObjectStore.prototype.add=guarded(oldAdd);
 await run('current');assert.equal(prevented,0);assert(compressed>=4);
 assert.deepEqual(await run('legacy',{hash}),source);
 assert.deepEqual((await run('export')).batches,source.batches);
 const full=await run('load');for(const [i,batch]of full.batches.entries())assert.deepEqual(await run('snapshot',{batch}),source.batches[i].beforeSnapshot);
 const legacyKey=historyNamespace(key)+'legacy:'+hash,legacy=await io('readonly',store=>store.get(legacyKey));
 await io('readwrite',store=>store.put({...legacy,value:new Blob(['corrupt'])}));
 await assert.rejects(run('legacy',{hash}),/decoded/);
 await io('readwrite',store=>store.clear());
 // Remote archive installation uses the same split path and commits source
 // files and receipt with the root, while refusing to replace any existing root.
 const binding={identity:{version:4},dirty:true},receipt={archiveHash:'archive',version:4};
 await io('readwrite',store=>store.put({key:'binding',value:binding}));
 const captures=(await run('records',{keys:['binding','receipt','file'],raw:true})).records;
 const records=[{key:'binding',record:captures[0].value,expectedHash:captures[0].hash},{key:'receipt',value:receipt,expectedHash:captures[1].hash},{key:'file',record:{key:'file',value:{blob:new Blob(['original bytes'])}},expectedHash:captures[2].hash}];
 await run('initialize',{value:source,records});assert.equal(prevented,0);
 assert.deepEqual(await run('legacy',{hash}),source);assert.deepEqual((await run('export')).batches,source.batches);
 assert.deepEqual((await io('readonly',store=>store.get('binding'))).value,binding,'Unpublished local work marker is preserved');
 assert.equal(await (await io('readonly',store=>store.get('file'))).value.blob.text(),'original bytes');
 await assert.rejects(run('initialize',{value:{...source,unknown:{replace:true}},records}),/changed/);
 assert.deepEqual(await run('legacy',{hash}),source);
 // A source revision changing while compression runs aborts the complete copy.
 await io('readwrite',store=>store.clear());await io('readwrite',store=>store.put({key:'binding',value:binding}));
 const newer={identity:{version:5},dirty:true};
 Response.prototype.blob=async function(...args){const task=hook;hook=null;await task?.();return oldBlob.apply(this,args);};
 hook=()=>io('readwrite',store=>store.put({key:'binding',value:newer}));
 await assert.rejects(run('initialize',{value:source,records}),/changed/);
 assert.deepEqual(await io('readonly',store=>store.getAllKeys()),['binding']);
 assert.deepEqual((await io('readonly',store=>store.get('binding'))).value,newer);
 console.log('PASS bounded IDB clone writes: large legacy and rollback evidence, exact exports, corrupted blob rejection, atomic archive installation, preserved dirty marker/original files, root and source races rejected.');
}finally{IDBObjectStore.prototype.put=oldPut;IDBObjectStore.prototype.add=oldAdd;Response.prototype.blob=oldBlob;db.close();indexedDB.deleteDatabase(dbName);}
