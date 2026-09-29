import assert from 'node:assert/strict';
import {indexedDB,IDBObjectStore} from 'fake-indexeddb';
import {executeHistory,historyHash,historyNamespace} from '../docs/portfolio-operations-dashboard/features/import-history-store.mjs';
globalThis.indexedDB=indexedDB;
const dbName='history-memory-'+crypto.randomUUID(),storeName='records',key='imports';
const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(dbName,1);request.onupgradeneeded=()=>request.result.createObjectStore(storeName,{keyPath:'key'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const io=(mode,fn)=>new Promise((resolve,reject)=>{const tx=db.transaction(storeName,mode),request=fn(tx.objectStore(storeName));tx.oncomplete=()=>resolve(request?.result);tx.onabort=tx.onerror=()=>reject(tx.error);});
const run=(operation,extra={})=>executeHistory({dbName,storeName,key,operation,...extra});
const source={unknown:{zero:0,nullable:null},batches:Array.from({length:8},(_,i)=>({id:'batch-'+i,status:'Approved',beforeSnapshot:{capturedAt:'snapshot-'+i,savedData:{A:{occupied:i,payload:'x'.repeat(256*1024)}},lineage:[{id:'prior-'+i,importedValue:0}]}})),sourceArchive:[{id:'source-0',communities:['A'],reportType:'box_score'}],canonicalRecords:[],lineage:[],reconciliationLog:[]};
const oldGet=IDBObjectStore.prototype.get,oldDigest=crypto.subtle.digest;
let rootReads=0,rootComparisons=0,activeSnapshotBytes=0,peakSnapshotBytes=0,largestSnapshotBytes=0,beforeSnapshotHash=null;
IDBObjectStore.prototype.get=function(value){if(value===key){if(this.transaction.mode==='readonly')rootReads++;else rootComparisons++;}return oldGet.call(this,value);};
crypto.subtle.digest=async function(algorithm,bytes){
 const prefix=new TextDecoder().decode(new Uint8Array(bytes.buffer,bytes.byteOffset,Math.min(bytes.byteLength,100)));
 const snapshot=prefix.startsWith('{"capturedAt":"snapshot-');
 if(snapshot){activeSnapshotBytes+=bytes.byteLength;peakSnapshotBytes=Math.max(peakSnapshotBytes,activeSnapshotBytes);largestSnapshotBytes=Math.max(largestSnapshotBytes,bytes.byteLength);}
 try{
  if(snapshot){const hook=beforeSnapshotHash;beforeSnapshotHash=null;await hook?.();await new Promise(resolve=>setTimeout(resolve,5));}
  return await oldDigest.call(this,algorithm,bytes);
 }finally{if(snapshot)activeSnapshotBytes-=bytes.byteLength;}
};
try{
 const originalHash=await historyHash(source);
 await io('readwrite',store=>store.put({key,value:source,updatedAt:'legacy-source'}));rootReads=rootComparisons=0;
 const current=await run('current');
 assert.equal(rootReads,1,'The legacy root is cloned once before migration, avoiding a second complete copy');
 assert.equal(rootComparisons,1,'The exact root is still reread inside the atomic commit');
 assert(peakSnapshotBytes<=largestSnapshotBytes,'Snapshot digest buffers must stay bounded to one complete snapshot');
 assert.equal(current.historyStorage.counts.batches,8);
 const original=await io('readonly',store=>store.get(historyNamespace(key)+'legacy:'+originalHash));assert.deepEqual(original.value,source,'The original complete legacy evidence remains retained');
 const batches=await run('page',{collection:'batches',limit:100});
 for(let i=0;i<source.batches.length;i++)assert.deepEqual(await run('snapshot',{batch:batches.rows[i]}),source.batches[i].beforeSnapshot,'Every rollback snapshot retains its complete payload');
 assert.deepEqual((await run('export')).batches,source.batches,'Portable export retains every full snapshot and its original order');
 // Moving expensive preparation outside the commit must not allow a concurrent
 // writer to be overwritten by the source that was read at operation start.
 await io('readwrite',store=>store.clear());
 await io('readwrite',store=>store.put({key,value:source,updatedAt:'before-race'}));
 const newer={...source,unknown:{...source.unknown,newer:'preserve-this-write'}};
 beforeSnapshotHash=()=>io('readwrite',store=>store.put({key,value:newer,updatedAt:'during-preparation'}));
 await assert.rejects(run('current'),/changed/);
 assert.deepEqual((await io('readonly',store=>store.get(key))).value,newer);
 assert.deepEqual(await io('readonly',store=>store.getAllKeys()),[key],'Conflict commits no partial legacy, snapshot, or head records');
 // An observed missing root is different from an omitted read result. Initial
 // empty history still uses the same guarded initialization path without reread.
 await io('readwrite',store=>store.clear());rootReads=rootComparisons=0;
 const empty=await run('current');assert.equal(empty.historyStorage.revision,1);assert.equal(rootReads,1);assert.equal(rootComparisons,1);
 console.log('PASS bounded import-history migration: one initial root clone, sequential snapshot buffers, complete retained legacy/snapshots/export, exact atomic race rejection, and missing-root initialization.');
}finally{IDBObjectStore.prototype.get=oldGet;crypto.subtle.digest=oldDigest;db.close();indexedDB.deleteDatabase(dbName);}
