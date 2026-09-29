// Isolated synthetic browser: establish the native IndexedDB ordering when
// replay begins after canonical puts are queued but before that transaction ends.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const core=fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/workspace-core.js',import.meta.url),'utf8');
const fn=name=>core.match(new RegExp('^async function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))[0];
const script=fn('refreshAtlasCanonicalWorkspace').replace(/await import\("\.\/features\/workspace-bootstrap\.mjs(?:\?v=[^"]+)?"\)/,'await Promise.resolve(window.fixtureModule)')+'\n'+fn('dataImportCreateReplayCheckpoint');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/functions.js'?'text/javascript':'text/html');res.end(req.url==='/functions.js'?script:'<!doctype html><script src="/functions.js"></script>');});
let browser;
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result=await page.evaluate(async()=>{
    const g=globalThis,events=[];
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('synthetic-refresh-replay',1);r.onupgradeneeded=()=>r.result.createObjectStore('state',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    let observing=false,checkpointPromise=null,checkpointError=null,hydrations=0,checkpointOpens=0;
    const io=(mode,action)=>new Promise((resolve,reject)=>{
      if(observing)events.push(mode==='readwrite'?'canonical-write-start':'replay-read-queued');
      const tx=db.transaction('state',mode);let request;
      try{request=action(tx.objectStore('state'));}catch(error){tx.abort();reject(error);return;}
      tx.oncomplete=()=>{if(observing)events.push(mode==='readwrite'?'canonical-write-complete':'replay-read-complete');resolve(request?.result);};
      tx.onerror=tx.onabort=()=>reject(tx.error||request?.error||Error('Synthetic transaction failed'));
    });
    const entry={id:'source',fileHash:'original-hash',importStatus:'Approved',reportType:'rent_roll',communities:['Example']};
    const source={documentKey:'synthetic-central',version:2,archiveHash:'new-hash'},binding={projectionVersion:2};
    const projection={contentHash:'new-content',communityData:{Example:{occupied:0,unknown:null}},opsGlobalData:{selectedMonth:8},importState:{batches:[{id:'new-batch'}]}};
    Object.assign(g,{
      ATLAS_CENTRAL:{getSession:()=>({user:{id:'synthetic-actor'}}),getAccessContextKey:()=> 'synthetic-scope'},
      atlasWorkspaceAccess:{epoch:1,controller:new AbortController(),hasData:true},atlasWorkspaceActorKey:()=> 'synthetic-actor',
      ATLAS_STATE_DB_NAME:db.name,ATLAS_STATE_COMMUNITY_KEY:'community',OPS_GLOBAL_STORAGE_KEY:'ops',DATA_IMPORT_2_STATE_KEY:'imports',DATA_IMPORT_FILE_ARCHIVE_PREFIX:'source:',
      atlasCanonicalWorkspacePromise:null,atlasCanonicalWorkspaceContext:null,atlasCanonicalWorkspaceGeneration:0,AtlasReplayGeneration:0,
      savedData:{Example:{occupied:9,unknown:null}},opsGlobalStorageCache:{},dataImport2State:{sourceArchive:[entry],batches:[]},atlasStateWritePromise:Promise.resolve(),
      fixtureModule:{stableJson:JSON.stringify,readWorkspace:async()=>({source,projection,binding})},
      withAtlasStateStore:io,atlasStateGetValue:async key=>(await io('readonly',store=>store.get(key)))?.value,
      normalizeSavedCommunityMap:value=>value,normalizeDataImport2State:value=>value,hydrateOpsGlobalData:()=>hydrations++,rememberDataImportHistoryState:()=>{},syncAtlasTopbar:()=>{},
      getAtlasRenderContextKey:()=> 'synthetic-context',dataImportCanManageArchitecture:()=>true,buildSerializedSavedDataPayload:()=>g.savedData
    });
    const saved=g.savedData,imports=g.dataImport2State;
    await io('readwrite',store=>{store.put({key:'community',value:saved,updatedAt:'before'});store.put({key:'imports',value:imports,updatedAt:'before'});store.put({key:'atlas_workspace_source_v2',value:{identity:{...source,version:1},binding,contentHash:'old-content',dirty:false},updatedAt:'before'});});
    const put=IDBObjectStore.prototype.put,open=indexedDB.open.bind(indexedDB);
    indexedDB.open=(name,...args)=>{if(name.startsWith('atlas_replay_checkpoint_'))checkpointOpens++;return open(name,...args);};
    IDBObjectStore.prototype.put=function(row,...args){
      const request=put.call(this,row,...args);
      if(row.key==='atlas_workspace_source_v2'&&row.value?.identity?.version===2){
        events.push('canonical-puts-queued');observing=true;
        checkpointPromise=g.dataImportCreateReplayCheckpoint(entry).catch(error=>{checkpointError=error.message;events.push('replay-rejected');});
      }
      return request;
    };
    const refreshed=await g.refreshAtlasCanonicalWorkspace();await checkpointPromise;
    const disk=(await io('readonly',store=>store.get('community'))).value;
    const result={refreshed,events,checkpointError,checkpointOpens,hydrations,sameLoadedRoots:g.savedData===saved&&g.dataImport2State===imports,loaded:g.savedData,disk,fenceReleased:!g.AtlasReplayWriteFence,generation:g.AtlasReplayGeneration};
    IDBObjectStore.prototype.put=put;indexedDB.open=open;db.close();return result;
  });
  assert.equal(result.refreshed,false);assert.equal(result.hydrations,0);assert.equal(result.sameLoadedRoots,true);
  assert.equal(result.checkpointOpens,0);assert.match(result.checkpointError,/loaded community data differs from local storage/);
  assert.deepEqual(result.loaded,{Example:{occupied:9,unknown:null}});assert.deepEqual(result.disk,{Example:{occupied:0,unknown:null}});
  assert.equal(result.fenceReleased,true);assert.equal(result.generation,1);
  assert(result.events.indexOf('replay-read-queued')<result.events.indexOf('canonical-write-complete'),JSON.stringify(result.events));
  assert(result.events.indexOf('canonical-write-complete')<result.events.indexOf('replay-read-complete'),JSON.stringify(result.events));
  console.log('PASS native IndexedDB late canonical commit: replay read waits, stale loaded source rejects before checkpoint creation, no replay publication or in-memory replacement. Reload is required.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
