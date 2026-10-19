import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {initializeCanonicalArchive} from '../docs/portfolio-operations-dashboard/features/canonical-evidence-store.mjs';
const require=createRequire(import.meta.url),api=require('../docs/portfolio-operations-dashboard/migration-archive.js'),Zip=require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');require('fake-indexeddb/auto');
const source=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/workspace-core.js',import.meta.url),'utf8');
let script=source.slice(source.indexOf('async function applyDashboardStorageBundle('),source.indexOf('async function importDashboardStorageBundleFromClipboard()'));
script=script.replace(/await import\('\.\/features\/workspace-bootstrap\.mjs(?:\?v=[^']+)?'\)/g,'await Promise.resolve(bootstrapFixture)').replace(/await import\('\.\/features\/canonical-evidence\.mjs(?:\?v=[^']+)?'\)/g,'await Promise.resolve(canonicalFixture)');
async function fixture(){
 const dbName='restore-flow-'+crypto.randomUUID(),db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onupgradeneeded=()=>r.result.createObjectStore('state',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const io=(mode,action)=>new Promise((resolve,reject)=>{const tx=db.transaction('state',mode);let r;try{r=action(tx.objectStore('state'));}catch(error){tx.abort();reject(error);return;}tx.oncomplete=()=>resolve(r?.result);tx.onerror=tx.onabort=()=>reject(tx.error);});
 const identity={documentKey:'canonical',version:4,archiveHash:'current-canonical'},writes=[],protectedCalls=[];
 await io('readwrite',s=>{s.put({key:'atlas_workspace_source_v2',value:{identity,dirty:false}});s.put({key:'community_data',value:{Test:{occupied:2,protected:true}}});});
 const archive=await api.pack({keys:{example:'original setting'},indexedDb:{communityData:{Test:{occupied:3,restored:true}}}},[{key:'imports',value:{batches:[{id:'one',beforeSnapshot:{capturedAt:'now',zero:0}}],sourceArchive:[{id:'source'}]}},{key:'file:one',value:{blob:new Blob(['original bytes'])}}],Zip,{segmentBytes:512});
 const c={DOMException,structuredClone,Promise,window:{AtlasOccupancyReplay:{protectCommittedOccupancy:(incoming,current)=>{protectedCalls.push(true);return{Test:{...incoming.Test,occupied:current.Test.occupied}};}}},atlasWorkspaceAccess:{epoch:1,validated:true,controller:new AbortController()},ATLAS_STATE_DB_NAME:dbName,ATLAS_STATE_STORE_NAME:'state',DATA_IMPORT_2_STATE_KEY:'imports',DATA_IMPORT_FILE_ARCHIVE_PREFIX:'file:',getAtlasRenderContextKey:()=> 'same-authorized-scope',savedData:{Test:{occupied:1}},ATLAS_STATE_COMMUNITY_KEY:'community_data',ATLAS_STATE_WEEKLY_SNAPSHOT_KEY:'weekly',OPS_GLOBAL_STORAGE_KEY:'global',localStorage:{setItem:(...args)=>writes.push(args)},mergeDashboardCommunityDataMaps:(a,b)=>({...a,...b}),removeLegacyCommunityStorageKeys(){},removeLegacyDailyBackupStorageKeys(){},removeLegacyWeeklySnapshotStorageKey(){},markAtlasPersistenceError:error=>{throw error;},atlasStateGetValue:async key=>(await io('readonly',s=>s.get(key)))?.value,atlasStateSetValue:async(key,value)=>io('readwrite',s=>s.put({key,value})),withAtlasStateStore:io,atlasStateWritePromise:Promise.resolve(),bootstrapFixture:{stableJson:JSON.stringify},canonicalFixture:{initializeCanonicalEvidence:async request=>{request.assertCurrent();return initializeCanonicalArchive({...request.options,archive:request.archive,Zip,api,signal:request.signal,beforeCommit:request.beforeCommit,onProgress:request.onProgress});}}};
 vm.createContext(c);vm.runInContext(script,c);
 return{c,archive,io,writes,protectedCalls,identity,close:async()=>{db.close();await new Promise(resolve=>{const r=indexedDB.deleteDatabase(dbName);r.onsuccess=resolve;});}};
}
test('actual archive restore uses bounded typed initialization, retains bytes and applies occupancy protection',async()=>{
 const f=await fixture();try{assert(await f.c.applyDashboardStorageBundle(f.archive)>0);assert.deepEqual(f.writes,[['example','original setting']]);assert.equal(await(await f.io('readonly',s=>s.get('file:one'))).value.blob.text(),'original bytes');assert.equal((await f.io('readonly',s=>s.get('community_data'))).value.Test.occupied,2);assert(f.protectedCalls.length);assert.equal((await f.io('readonly',s=>s.get('atlas_workspace_source_v2'))).value.dirty,true);}finally{await f.close();}
});
test('conflicting original evidence is refused before any bundle setting or community write',async()=>{
 for(const conflict of ['imports','file:old']){const f=await fixture();try{await f.io('readwrite',s=>s.put({key:conflict,value:{original:'keep'}}));await assert.rejects(f.c.applyDashboardStorageBundle(f.archive),/retained.*evidence|retained import/);assert.equal(f.writes.length,0);assert.equal(f.protectedCalls.length,0);assert.deepEqual((await f.io('readonly',s=>s.get(conflict))).value,{original:'keep'});assert.equal((await f.io('readonly',s=>s.get('community_data'))).value.Test.occupied,2);}finally{await f.close();}}
});
