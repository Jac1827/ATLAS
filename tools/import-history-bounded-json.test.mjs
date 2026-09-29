import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {indexedDB,IDBObjectStore} from 'fake-indexeddb';
import {executeHistory,historyHash,historyNamespace} from '../docs/portfolio-operations-dashboard/features/import-history-store.mjs';
globalThis.indexedDB=indexedDB;
const dbName='history-json-bounds-'+crypto.randomUUID(),storeName='records',key='imports';
const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onupgradeneeded=()=>r.result.createObjectStore(storeName,{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const io=(mode,fn)=>new Promise((resolve,reject)=>{const tx=db.transaction(storeName,mode),r=fn(tx.objectStore(storeName));tx.oncomplete=()=>resolve(r?.result);tx.onabort=tx.onerror=()=>reject(tx.error);});
const run=(operation,extra={})=>executeHistory({operation,dbName,storeName,key,...extra});
const source={batches:Array.from({length:4},(_,i)=>({id:'batch-'+i,status:'Approved',beforeSnapshot:{capturedAt:'synthetic-'+i,savedData:{A:{zero:0,unknown:null,notes:'x'.repeat(512*1024)}}}})),sourceArchive:[{id:'source',reportType:'box_score',communities:['A']}],canonicalRecords:[],lineage:[],reconciliationLog:[]};
const originalJson=JSON.stringify,expectedHash=createHash('sha256').update(originalJson(source)).digest('hex');
const originalGet=IDBObjectStore.prototype.get,originalDigest=crypto.subtle.digest;let rootComparisons=0;
try{
  await io('readwrite',store=>store.put({key,value:source,updatedAt:'before'}));
  JSON.stringify=function(value,...args){if(value&&typeof value==='object'&&(Array.isArray(value.batches)&&value.batches.some(batch=>batch.beforeSnapshot)||value.savedData?.A?.notes?.length>65536))throw Error('Oversized evidence object serialization is forbidden by this regression');return originalJson.call(this,value,...args);};
  IDBObjectStore.prototype.get=function(name){if(name===key&&this.transaction.mode==='readwrite')rootComparisons++;return originalGet.call(this,name);};
  assert.equal(await historyHash(source),expectedHash,'The existing SHA-256(JSON.stringify) fingerprint is unchanged');
  const current=await run('current');assert.equal(current.historyStorage.counts.batches,4);assert.equal(rootComparisons,1);
  const retained=(await io('readonly',store=>store.get(historyNamespace(key)+'legacy:'+expectedHash))).value;
  assert.deepEqual(retained,source,'The complete original source remains retained under its existing fingerprint');
  const full=await run('load');assert.equal(full.batches.length,4);assert(full.batches.every(batch=>batch.beforeSnapshotRef?.sha256));
  // A protected record may change after its fingerprint is accepted but before
  // publication. The synchronous comparison inside the transaction must catch it.
  const protectedKey='protected',prior={amount:0,missing:null},newer={amount:null,missing:null};
  await io('readwrite',store=>store.put({key:protectedKey,value:prior}));
  const captured=(await run('records',{keys:[protectedKey]})).records[0];
  let changed=false;
  crypto.subtle.digest=async function(algorithm,bytes){
    const text=new TextDecoder().decode(bytes);
    if(!changed&&text==='{"amount":0,"missing":null}'){
      changed=true;await io('readwrite',store=>store.put({key:protectedKey,value:newer}));
    }
    return originalDigest.call(this,algorithm,bytes);
  };
  await assert.rejects(run('publish',{value:full,expectedRevision:1,records:[{key:protectedKey,value:{amount:7},expectedHash:captured.hash}]}),/changed/);
  assert.equal(changed,true);assert.deepEqual((await io('readonly',store=>store.get(protectedKey))).value,newer);
  assert.equal((await io('readonly',store=>store.get(key))).value.revision,1);
  await assert.rejects(historyHash({unsupported:()=>{}}),error=>error.code==='history_integrity');
  await assert.rejects(historyHash({unsupported:Symbol('unsupported')}),error=>error.code==='history_integrity');
  console.log('PASS bounded history integration: unchanged legacy fingerprint, no oversized-object stringify, exact retained original/snapshot refs, synchronous protected-record null/zero conflict, unsupported values fail closed.');
}finally{JSON.stringify=originalJson;IDBObjectStore.prototype.get=originalGet;crypto.subtle.digest=originalDigest;db.close();indexedDB.deleteDatabase(dbName);}
