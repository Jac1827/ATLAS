// Synthetic browser/IndexedDB only. Every request stays on this local server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const root=path.resolve('docs/portfolio-operations-dashboard'),core=fs.readFileSync(path.join(root,'workspace-core.js'),'utf8');
const extract=name=>{const match=core.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`,'m'));assert(match,name);return match[0];};
const actualCode=['openAtlasStateDb','withAtlasStateStore','atlasStateGetValue','getAtlasRenderContextKey',
  'captureAtlasAuxiliaryContext','captureAtlasLocalPublicationStatus','refreshAtlasWorkspaceSourceStatus','dataImportHistoryOperation'].map(extract).join('\n');
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  if(pathname==='/'){res.setHeader('content-type','text/html');return res.end('<!doctype html><div id="atlas-workspace-source" role="status"></div>');}
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
let sequence=0;
const pages=[],errors=[];
async function fixture(){
  const page=await browser.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin);
  await page.evaluate(database=>{
    Object.assign(window,{ATLAS_STATE_DB_NAME:database,ATLAS_STATE_STORE_NAME:'records',DATA_IMPORT_2_STATE_KEY:'imports',atlasStateDbPromise:null,
      activeTab:7,workspaceScopeValue:'Example',atlasNavigationEpoch:0,savedData:{Example:{reportYear:2026}},actor:'actor-a',access:'access-a',
      dataImport2State:{historyStorage:{view:'full'}},observerReads:0,observerCompleted:0,workerCount:0});
    window.getProp=()=>({name:'Example'});window.getSelectedDashboardMonthIndex=()=>9;
    window.getAtlasCentralStatus=()=>({configured:true});window.atlasWorkspaceActorKey=()=>actor;
    window.ATLAS_CENTRAL={getAccessContextKey:()=>access,getConfig:()=>({supabaseUrl:'https://synthetic.invalid'}),
      getSession:()=>({user:{id:actor}}),getStoredProfile:()=>({status:'active',role:'admin'})};
    const identity={documentKey:'dashboard',version:7,archiveHash:'synthetic-v7',effectiveAt:'2026-10-26T19:35:45Z'};
    window.sourceIdentity=identity;
    window.atlasWorkspaceAccess={epoch:1,validated:true,controller:new AbortController(),error:'',
      source:{...identity,cached:false,verifiedAt:'2026-10-26T19:50:00Z',localChanges:false}};
    const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);workerCount++;}};
  },`synthetic-publication-status-${++sequence}`);
  await page.addScriptTag({content:actualCode});
  await page.evaluate(async()=>{
    window.historyApi=await import('/features/import-history.mjs');
    window.rawHistory=(operation,extra={})=>historyApi.historyOperation({operation,dbName:ATLAS_STATE_DB_NAME,storeName:'records',key:'imports',...extra});
    await withAtlasStateStore('readwrite',store=>{
      store.put({key:'imports',value:{batches:[],sourceArchive:[],canonicalRecords:[],lineage:[],reconciliationLog:[]}});
      store.put({key:'community_data',value:{Example:{occupied:0,unrelated:'retained'}}});
      store.put({key:'atlas_workspace_source_v2',value:{identity:sourceIdentity,dirty:false}});
    });
    await rawHistory('current');
    refreshAtlasWorkspaceSourceStatus();
    window.originalSource=structuredClone(atlasWorkspaceAccess.source);
    window.originalText=document.getElementById('atlas-workspace-source').textContent;
    const nativeGet=atlasStateGetValue;
    window.atlasStateGetValue=async key=>{observerReads++;if(window.observerGate)await observerGate;if(window.failObserverRead)throw Error('Synthetic readback failure');return nativeGet(key);};
    const nativeCapture=captureAtlasLocalPublicationStatus;
    window.captureAtlasLocalPublicationStatus=()=>{const observer=nativeCapture();return observer?async()=>{try{return await observer();}finally{observerCompleted++;}}:observer;};
    window.preparePublish=async()=>{
      const value=await rawHistory('load'),capture=await rawHistory('records',{keys:['community_data']});
      return {value:{...value,acceptedImport:'synthetic-approved'},expectedRevision:value.historyStorage.revision,
        records:[{key:'community_data',value:{Example:{occupied:42,unrelated:'retained'}},expectedHash:capture.records[0].hash}]};
    };
    window.inspect=async()=>({source:structuredClone(atlasWorkspaceAccess.source),text:document.getElementById('atlas-workspace-source').textContent,
      durable:(await rawHistory('records',{keys:['atlas_workspace_source_v2','community_data']})).records.map(r=>r.value),reads:observerReads,workers:workerCount});
    window.holdObserver=()=>{window.observerGate=new Promise(resolve=>{window.releaseObserver=resolve;});};
  });
  return page;
}
try{
  // The real worker commits and verifies its guarded publication. The banner
  // waits for the subsequent durable receipt read, and that observation writes nothing.
  {
    const page=await fixture();
    const result=await page.evaluate(async()=>{holdObserver();return dataImportHistoryOperation('publish',await preparePublish());});
    assert.equal(result.verified,true);
    const held=await page.evaluate(()=>inspect());assert.equal(held.durable[0].dirty,true);assert.equal(held.durable[1].Example.occupied,42);
    assert.equal(held.source.localChanges,false);assert.doesNotMatch(held.text,/pending publication/);assert.equal(held.reads,1);
    await page.evaluate(()=>releaseObserver());await page.waitForFunction(()=>atlasWorkspaceAccess.source.localChanges===true);
    const done=await page.evaluate(()=>inspect());assert.match(done.text,/version 7.*local changes pending publication/);
    assert.deepEqual({...done.source,localChanges:false},await page.evaluate(()=>originalSource));assert.deepEqual(done.durable,held.durable);
    assert(done.workers>=4,'The actual browser worker path was exercised');
  }
  // Stale history and community captures are rejected by real atomic storage.
  for(const stale of ['revision','community']){
    const page=await fixture();
    const result=await page.evaluate(async stale=>{const request=await preparePublish();if(stale==='revision')request.expectedRevision=0;else request.records[0].expectedHash='0'.repeat(64);try{await dataImportHistoryOperation('publish',request);return 'accepted';}catch(error){return error.message;}},stale);
    assert.match(result,/changed|Reload|conflict/i);
    const state=await page.evaluate(()=>inspect());assert.equal(state.durable[0].dirty,false);assert.equal(state.durable[1].Example.occupied,0);
    assert.equal(state.source.localChanges,false);assert.equal(state.reads,0);assert.doesNotMatch(state.text,/pending publication/);
  }
  // A supported clean replay and a view preference write do not announce business changes.
  for(const operation of ['clean-publish','preferences']){
    const page=await fixture();
    const result=await page.evaluate(async operation=>operation==='preferences'
      ?dataImportHistoryOperation('preferences',{value:{activeView:'history'}})
      :dataImportHistoryOperation('publish',{...await preparePublish(),markDirty:false}),operation);
    assert.equal(result.verified,true);const state=await page.evaluate(()=>inspect());
    assert.equal(state.durable[0].dirty,false);assert.equal(state.source.localChanges,false);assert.equal(state.reads,0);
  }
  // Durable acceptance in A remains durable, but a late read cannot paint a new
  // actor, access scope, navigation epoch, database or source version.
  for(const change of ['actor','access','navigation','database','source']){
    const page=await fixture();
    assert.equal(await page.evaluate(async()=>{holdObserver();return (await dataImportHistoryOperation('publish',await preparePublish())).verified;}),true);
    await page.evaluate(change=>{
      if(change==='actor')actor='actor-b';if(change==='access')access='access-b';if(change==='navigation')atlasNavigationEpoch++;
      if(change==='database')ATLAS_STATE_DB_NAME='synthetic-new-actor';if(change==='source')atlasWorkspaceAccess.source={...atlasWorkspaceAccess.source,version:8};
      releaseObserver();
    },change);
    await page.waitForFunction(()=>observerCompleted===1);
    const state=await page.evaluate(()=>({pending:atlasWorkspaceAccess.source.localChanges,text:document.getElementById('atlas-workspace-source').textContent}));
    assert.equal(state.pending,false,change);assert.doesNotMatch(state.text,/pending publication/,change);
  }
  // Readback observer failure must not turn a successful native commit into an error.
  {
    const page=await fixture();
    const result=await page.evaluate(async()=>{window.failObserverRead=true;return dataImportHistoryOperation('publish',await preparePublish());});
    assert.equal(result.verified,true);const state=await page.evaluate(()=>inspect());
    assert.equal(state.durable[0].dirty,true);assert.equal(state.durable[1].Example.occupied,42);assert.equal(state.source.localChanges,false);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS real browser publication status: verified native commit and durable readback, stale revision/community CAS, clean replay/preferences, actor/access/navigation/database/source fences and observational read failure.');
}finally{for(const page of pages)await page.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
