import assert from 'node:assert/strict';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {createRequire} from 'node:module';
import {inspectLegacyEvidence,exportLegacyEvidence,LEGACY_DATABASE} from '../docs/portfolio-operations-dashboard/features/legacy-evidence-store.mjs';
import {createLegacyEvidenceRecovery} from '../docs/portfolio-operations-dashboard/features/legacy-evidence-recovery.mjs';
const require=createRequire(import.meta.url),archive=require('../docs/portfolio-operations-dashboard/migration-archive.js'),Zip=require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');
const factory=new IDBFactory(),open=()=>new Promise((resolve,reject)=>{const r=factory.open(LEGACY_DATABASE,1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const empty=await inspectLegacyEvidence({factory});assert.equal(empty.available,false);assert.deepEqual(await factory.databases(),[],'Missing legacy storage must never be created');
await assert.rejects(inspectLegacyEvidence({factory:{open(){throw Error('Must not open');}}}),/safely discover/);
const db=await open(),io=(mode,fn)=>new Promise((resolve,reject)=>{const tx=db.transaction('records',mode),r=fn(tx.objectStore('records'));tx.oncomplete=()=>resolve(r?.result);tx.onabort=tx.onerror=()=>reject(tx.error);});
const root={key:'atlas_data_import_2_state_v1',value:{batches:[{id:'batch49',approvedAt:'2026-10-12T10:00:00Z',beforeSnapshot:{capturedAt:'before',savedData:{A:{zero:0,missing:null,large:'x'.repeat(600*1024)}}}}],sourceArchive:Array.from({length:81},(_,i)=>({id:'s'+i})),canonicalRecords:[{key:'fact',value:0}]},updatedAt:'2026-10-12T10:00:00Z'};
const records=[root,{key:'atlas_data_import_source_file:original',value:{blob:new Blob(['original binary bytes']),fileName:'survey.xlsx'}},{key:'community_data',value:{A:{occupied:0,missing:null}}},{key:'occupancy_replay_backup:prior',value:{preserve:true}},{key:'atlas_auth_tokens',value:{token:'do-not-export'}},{key:'unrelated',value:'preserve'}];
await io('readwrite',store=>{for(const row of records)store.put(row);});
const writes=['add','put','delete','clear'],originals=Object.fromEntries(writes.map(name=>[name,IDBObjectStore.prototype[name]]));
try{
 for(const name of writes)IDBObjectStore.prototype[name]=function(){throw Error('A read-only recovery attempted a write: '+name);};
 const preview=await inspectLegacyEvidence({factory});assert.equal(preview.sources,81);assert.equal(preview.batches,1);assert.equal(preview.sourceFiles,1);assert.equal(preview.records,4);assert.equal(preview.latestApprovedAt,'2026-10-12T10:00:00Z');
 assert(!JSON.stringify(preview).includes('savedData'));
 const exported=await exportLegacyEvidence({factory,expected:preview,archive,Zip});assert(exported.blob instanceof Blob);
 const payload=JSON.parse(await exported.blob.text()),restored=await archive.unpack(payload,Zip);assert.equal(payload.sha256,exported.sha256);assert.equal(restored.bundle.readOnly,true);assert.equal(restored.bundle.canonicalPublication,false);
 assert.deepEqual(restored.records.map(row=>row.key),[root.key,'atlas_data_import_source_file:original','community_data','occupancy_replay_backup:prior']);assert.deepEqual(restored.records[0],root);assert.equal(await restored.records[1].value.blob.text(),'original binary bytes');assert.deepEqual(await io('readonly',store=>store.getAll()),records.toSorted((a,b)=>a.key.localeCompare(b.key)));
 assert(!JSON.stringify(restored).includes('do-not-export'));
 await assert.rejects(exportLegacyEvidence({factory,expected:{...preview,fingerprint:'a'.repeat(64)},archive,Zip}),/changed/);
 const controller=new AbortController();controller.abort();await assert.rejects(inspectLegacyEvidence({factory,signal:controller.signal}),{name:'AbortError'});
}finally{for(const name of writes)IDBObjectStore.prototype[name]=originals[name];}
const preview=await inspectLegacyEvidence({factory});let changed=false;
const racing={...archive,packRecord:async(name,row,options)=>{const result=await archive.packRecord(name,row,options);if(!changed&&row.key==='atlas_data_import_source_file:original'){changed=true;await io('readwrite',store=>store.put({...row,value:{...row.value,blob:new Blob(['changed original'])}}));}return result;}};
await assert.rejects(exportLegacyEvidence({factory,expected:preview,archive:racing,Zip}),/original changed/);assert(changed);db.close();

function fixture(){
 const state={actor:'admin-one',role:'admin',access:'scope-one',epoch:1,validated:true,expires:Date.now()/1000+3600,messages:[],states:[],profiles:0,terminated:0};
 const central={getSession:()=>({user:{id:state.actor},access_token:'private-token',expires_at:state.expires}),getConfig:()=>({supabaseUrl:'https://backend.invalid'}),getAccessContextKey:()=>state.access,fetchProfile:async options=>{assert.equal(options.claim,false);state.profiles++;state.beforeProfile?.();return {user_id:state.actor,role:state.role,status:'active',account_status:'active',access_backend:'https://backend.invalid',access_verified_at:new Date().toISOString()};}};
 const workerFactory=()=>({terminate(){state.terminated++;},postMessage(message){state.messages.push(message);queueMicrotask(()=>{state.beforeResult?.();const summary={available:true,fingerprint:'a'.repeat(64),batches:49,sources:81,sourceFiles:81,communityRecords:14};this.onmessage({data:{ok:true,value:message.operation==='preview'?summary:{summary,sha256:'b'.repeat(64),blob:new Blob(['archive'])}}});});}});
 const recovery=createLegacyEvidenceRecovery({central,getContext:()=>({validated:state.validated,current:true,database:'scoped',epoch:state.epoch}),workerFactory,onState:value=>state.states.push(value)});return {state,recovery};
}
const good=fixture();assert.equal((await good.recovery.inspect()).sources,81);const result=await good.recovery.exportCopy();assert(result.isCurrent());assert.equal(good.state.profiles,4);assert.equal(good.state.messages.length,2);assert(!JSON.stringify(good.state.messages).includes('private-token'));good.state.epoch++;assert.equal(result.isCurrent(),false);good.recovery.snapshot();assert.equal(good.recovery.snapshot().phase,'idle');
for(const change of [state=>state.role='viewer',state=>state.validated=false,state=>state.expires=1]){const f=fixture();change(f.state);assert.equal(await f.recovery.inspect(),null);assert.equal(f.state.messages.length,0);}
for(const field of ['actor','access','epoch']){const f=fixture();f.state.beforeResult=()=>{f.state[field]='changed';};assert.equal(await f.recovery.inspect(),null);assert.notEqual(f.recovery.snapshot().phase,'ready');assert.equal(f.state.terminated,1);}
const revoked=fixture();revoked.state.beforeProfile=()=>{if(revoked.state.profiles===2)revoked.state.role='viewer';};assert.equal(await revoked.recovery.inspect(),null);assert.equal(revoked.recovery.snapshot().phase,'error');
const canceled=fixture();canceled.state.beforeResult=()=>canceled.recovery.cancel();assert.equal(await canceled.recovery.inspect(),null);assert.equal(canceled.recovery.snapshot().phase,'idle');
console.log('PASS authenticated read-only legacy recovery: no creation/writes, original history/snapshots/source blobs/community data preserved, secrets excluded, exact archive verification, changed source denied, active admin and actor/scope/epoch/expiry/cancellation guards.');
