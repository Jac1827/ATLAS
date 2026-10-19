import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {indexedDB,IDBObjectStore} from 'fake-indexeddb';
import {executeHistory,historyHash} from '../docs/portfolio-operations-dashboard/features/import-history-store.mjs';
import {createJsonTokenSink} from '../docs/portfolio-operations-dashboard/features/migration-token-stream.mjs';
const require=createRequire(import.meta.url),archive=require('../docs/portfolio-operations-dashboard/migration-archive.js'),Zip=require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');
globalThis.indexedDB=indexedDB;
const dbName='history-stream-export-'+crypto.randomUUID(),storeName='records',key='atlas_data_import_2_state_v1';
const run=(operation,extra={})=>executeHistory({operation,dbName,storeName,key,...extra});
const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onupgradeneeded=()=>r.result.createObjectStore(storeName,{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const io=(mode,fn)=>new Promise((resolve,reject)=>{const tx=db.transaction(storeName,mode),r=fn(tx.objectStore(storeName));tx.oncomplete=()=>resolve(r?.result);tx.onabort=tx.onerror=()=>reject(tx.error);});
const source={retained:{zero:0,missing:null},batches:Array.from({length:44},(_,i)=>({id:'batch-'+i,beforeSnapshot:{capturedAt:'snapshot-'+i,savedData:{A:{payload:'original source Ω. '.repeat(32000),amount:-1.005}},canonicalRecords:[{key:'prior-'+i,zero:0,missing:null}]}})),sourceArchive:Array.from({length:63},(_,i)=>({id:'source-'+i,fileHash:String(i).padStart(64,'0')})),canonicalRecords:[{key:'latest',zero:0,missing:null}],lineage:[],reconciliationLog:[],mappingAuditTrail:[],exceptions:[],leadSourceHistoricalRevisions:[],temporaryIgnoreHistory:[]};
const json=Response.prototype.json;let reads=0,largestRead=0;const get=IDBObjectStore.prototype.get;
try{
 await run('initialize',{value:source});
 Response.prototype.json=async()=>{throw Error('Expanded snapshot JSON decode forbidden during export');};
 IDBObjectStore.prototype.get=function(k){const r=get.call(this,k);r.addEventListener('success',()=>{reads++;if(r.result?.encoding==='gzip-json-v1')largestRead=Math.max(largestRead,r.result.value.size);});return r;};
 let packed=await run('exportPacked',{archiveName:'record-0.json',archiveRecord:{key,updatedAt:'original'}});
 Response.prototype.json=json;IDBObjectStore.prototype.get=get;
 const portable=await archive.packRecords({}, {count:1,readRecord:()=>{throw Error('expanded read');},readPackedRecord:()=>packed},Zip);
 const restored=await archive.unpack(portable,Zip);assert.deepEqual(restored.records[0],{key,updatedAt:'original',value:source});assert(reads>44);assert(largestRead<512*1024);
 // Encoded non-import replay backups export their original envelope, not the
 // private compression descriptor, and verify every logical byte on the way.
 const value={createdAt:'original',rows:Array(2000).fill({zero:0,missing:null,text:'retained source'.repeat(30)})};
 const sink=createJsonTokenSink();for(const token of archive.recordTokens(value)){sink.add(token);}await sink.flush();const encoded=await sink.finish();
 const stored={key:'occupancy_replay_backup:original',encoding:'gzip-json-v1',sha256:encoded.sha256,value:encoded.blob,archiveRecordMetadata:{key:'occupancy_replay_backup:original',updatedAt:'original',extra:'retained'}};
 Response.prototype.json=async()=>{throw Error('Expanded backup JSON decode forbidden during export');};
 packed=await run('recordExportPacked',{archiveName:'record-0.json',storedRecord:stored});Response.prototype.json=json;
 const generic=await archive.packRecords({}, {count:1,readRecord:()=>{throw Error('expanded backup read');},readPackedRecord:()=>packed},Zip);
 assert.deepEqual((await archive.unpack(generic,Zip)).records[0],{...stored.archiveRecordMetadata,value});
 await assert.rejects(run('recordExportPacked',{archiveName:'record-0.json',storedRecord:{...stored,sha256:'0'.repeat(64)}}),/fingerprint changed/);
 // Mutating the head while output is being packed cannot return an archive.
 let changed=false;await assert.rejects(run('exportPacked',{archiveName:'record-0.json',archiveRecord:{key},onArchiveProgress:()=>{if(changed)return;changed=true;const tx=db.transaction(storeName,'readwrite'),store=tx.objectStore(storeName),r=store.get(key);r.onsuccess=()=>store.put({...r.result,value:{...r.result.value,revision:r.result.value.revision+1}});}}),/changed/);
 console.log('PASS bounded44 snapshot export,63 receipts, encoded replay backup, original metadata/hash fidelity, no Response.json expansion, corrupt stored hash and concurrent revision rejection.');
}finally{Response.prototype.json=json;IDBObjectStore.prototype.get=get;db.close();indexedDB.deleteDatabase(dbName);}
