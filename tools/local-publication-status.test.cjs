const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js', 'utf8');
const extract = name => {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  const end = source.indexOf('\n}', start);
  assert(start >= 0 && end > start, name);
  return source.slice(start, end + 2);
};
const clone = value => structuredClone(value);
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; };
const RECEIPT = 'atlas_workspace_source_v2';

function fixture() {
  const identity = {documentKey:'dashboard', version:7, archiveHash:'retained-v7', effectiveAt:'2026-10-26T19:35:45Z'};
  const sourceStatus = {...identity, verifiedAt:'2026-10-26T19:50:00Z', cached:false, localChanges:false};
  const records = new Map([
    [RECEIPT, {key:RECEIPT, value:{identity, dirty:false}}],
    ['communities', {key:'communities', value:{Example:{renewalDetailRowsByPeriod:{'2027-01':[{id:'agreement', notes:'original'}]}}}}],
    ['ops', {key:'ops', value:{sharedData:{employees:{one:{name:'Synthetic'}},lastPeopleSyncAt:'before'}}}]
  ]);
  const state = {reads:0, puts:[], errors:[], textUpdates:0};
  let text = 'Central workspace · version 7';
  const node = {get textContent(){return text;},set textContent(value){state.textUpdates++;if(state.failDom)throw Error('DOM unavailable');text=value;}};
  const c = {
    console, Date, Blob, Response, DecompressionStream, DOMException, AbortController,
    ATLAS_STATE_COMMUNITY_KEY:'communities', OPS_GLOBAL_STORAGE_KEY:'ops', ATLAS_RENEWAL_REPAIR_KEY:'repair',
    ATLAS_STATE_DB_NAME:'db-a', ATLAS_STATE_STORE_NAME:'records', DATA_IMPORT_2_STATE_KEY:'imports',
    actor:'actor-a', access:'access-a', context:'notes-a',
    atlasWorkspaceAccess:{epoch:1, validated:true, hasData:true, source:clone(sourceStatus), controller:new AbortController(), error:''},
    atlasWorkspaceActorKey:()=>c.actor, getAtlasRenderContextKey:()=>c.context,
    getAtlasCentralStatus:()=>({configured:true}), atlasRenewalRepairPending:()=>false, atlasRenewalRepairGeneration:()=>0,
    document:{getElementById:id=>id==='atlas-workspace-source'?node:null},
    window:{ATLAS_CENTRAL:{getAccessContextKey:()=>c.access}},
    atlasStateWritePromise:Promise.resolve(), atlasPersistenceMeta:{}, dashboardSharedSyncMeta:{},
    savedData:clone(records.get('communities').value),
    buildSerializedSavedDataPayload:()=>clone(c.savedData), removeLegacyCommunityStorageKeys(){},
    clearAtlasPersistenceError(){}, persistAtlasPersistenceMeta(){}, persistDashboardSharedSyncMeta(){},
    markAtlasPersistenceError:error=>state.errors.push(error),
    dataImport2State:{historyStorage:{view:'full'}}, dataImportHistoryRevision:1,
    historyModule:async()=>({historyOperation:async()=>({verified:true})}),
    withAtlasStateStore:async(mode, action)=>{
      if(mode==='readonly') {
        state.reads++;
        if(state.failRead)throw Error('Read unavailable');
        if(state.beforeRead)await state.beforeRead();
      }
      const pending=[],writes=[];let aborted=false;
      const store={transaction:{abort(){aborted=true;}},get(key){const r={};pending.push(()=>{r.result=clone(records.get(key));r.onsuccess?.();});return r;},put(row){assert.equal(mode,'readwrite');writes.push(clone(row));}};
      const request=action(store);
      for(const next of pending)next();
      if(aborted)throw Error('Aborted transaction');
      if(mode==='readwrite'&&state.failCommit)throw Error('Commit failed');
      for(const row of writes){records.set(row.key,row);state.puts.push(row.key);}
      if(mode==='readwrite')await state.afterCommit?.();
      return request?.result??null;
    }
  };
  vm.createContext(c);
  const names=['captureAtlasAuxiliaryContext','captureAtlasLocalPublicationStatus','refreshAtlasWorkspaceSourceStatus',
    'atlasOpsGlobalChangedOnlyPeopleSyncTime','atlasStateSetValue','atlasStateGetValue','queueAtlasStateWrite','persistSaved'];
  vm.runInContext(names.map(extract).join('\n'),c);
  vm.runInContext(extract('dataImportHistoryOperation').replace(/await import\("\.\/features\/import-history\.mjs(?:\?v=[^"]+)?"\)/,'await historyModule()'),c);
  return {c,state,records,node,sourceStatus};
}

test('a completed Notes community save updates only its existing publication status',async()=>{
  const f=fixture(),{c,records,state,node}=f;
  c.savedData.Example.renewalDetailRowsByPeriod['2027-01'][0].notes='reviewed note';
  const saved=c.persistSaved();await saved.completion;await turn();
  assert.equal(saved.ok,true);
  assert.equal(records.get('communities').value.Example.renewalDetailRowsByPeriod['2027-01'][0].notes,'reviewed note');
  assert.equal(records.get(RECEIPT).value.dirty,true);
  assert.equal(c.atlasWorkspaceAccess.source.localChanges,true);
  assert.match(node.textContent,/version 7.*local changes pending publication/);
  assert.deepEqual({...c.atlasWorkspaceAccess.source,localChanges:false},f.sourceStatus);
  assert.equal(c.context,'notes-a');assert.equal(c.atlasWorkspaceAccess.epoch,1);
  assert.equal(state.textUpdates,1);
  assert.deepEqual(state.puts,['communities',RECEIPT]);
});

test('no-op, People observation clock and rejected guarded writes never mark clean status pending',async()=>{
  for(const kind of ['no-op','clock','rejected']){
    const {c,records,state,node}=fixture();
    if(kind==='no-op')await c.atlasStateSetValue('communities',clone(records.get('communities').value));
    if(kind==='clock')await c.atlasStateSetValue('ops',{sharedData:{employees:{one:{name:'Synthetic'}},lastPeopleSyncAt:'later'}});
    if(kind==='rejected')assert.equal(await c.atlasStateSetValue('communities',{changed:true},{acceptCurrent:()=>false}),false);
    await turn();assert.equal(records.get(RECEIPT).value.dirty,false,kind);assert.equal(c.atlasWorkspaceAccess.source.localChanges,false,kind);
    assert.equal(state.reads,0,kind);assert.equal(state.textUpdates,0,kind);assert.doesNotMatch(node.textContent,/pending/);
  }
});

test('transaction failure never updates the in-memory status or durable receipt',async()=>{
  const {c,state,records}=fixture();state.failCommit=true;
  await assert.rejects(c.atlasStateSetValue('communities',{changed:true}),/Commit failed/);
  await turn();assert.equal(records.get(RECEIPT).value.dirty,false);assert.equal(c.atlasWorkspaceAccess.source.localChanges,false);assert.equal(state.reads,0);assert.equal(state.textUpdates,0);
});

test('late observation is fenced to actor, access, epoch, database, render context and exact source',async()=>{
  const changes=[c=>c.actor='other',c=>c.access='other',c=>c.atlasWorkspaceAccess.epoch++,c=>c.ATLAS_STATE_DB_NAME='db-b',c=>c.context='other',c=>c.atlasWorkspaceAccess.controller.abort(),c=>c.atlasWorkspaceAccess.validated=false,c=>c.atlasWorkspaceAccess.source={...c.atlasWorkspaceAccess.source,version:8}];
  for(const change of changes){
    const {c,state,records}=fixture(),held=deferred();state.beforeRead=()=>held.promise;
    await c.atlasStateSetValue('communities',{changed:true});assert.equal(records.get(RECEIPT).value.dirty,true);change(c);held.resolve();await turn();
    assert.equal(c.atlasWorkspaceAccess.source.localChanges,false);assert.equal(state.textUpdates,0);
  }
});

test('receipt readback must still be dirty and bound to the captured source',async()=>{
  for(const change of [r=>r.dirty=false,r=>r.identity.version=8]){
    const {c,state,records}=fixture();state.beforeRead=()=>change(records.get(RECEIPT).value);
    await c.atlasStateSetValue('communities',{changed:true});await turn();assert.equal(c.atlasWorkspaceAccess.source.localChanges,false);assert.equal(state.textUpdates,0);
  }
});

test('observation initialization, readback or DOM errors cannot fail a committed save',async()=>{
  for(const kind of ['capture','read','dom']){
    const {c,state,records}=fixture();
    if(kind==='capture')c.captureAtlasAuxiliaryContext=()=>{throw Error('No observer context');};
    if(kind==='read')state.failRead=true;if(kind==='dom')state.failDom=true;
    assert.equal(await c.atlasStateSetValue('communities',{changed:true}),true);await turn();assert.equal(records.get(RECEIPT).value.dirty,true);assert.equal(state.errors.length,0);
  }
});

test('native import status observes verified relevant commits only',async()=>{
  for(const kind of ['publish','save','update','rollback','records','preferences','unverified','clean-replay','failure']){
    const {c,state,records}=fixture();
    c.historyModule=async()=>({historyOperation:async()=>{if(kind==='failure')throw Error('Stale guarded import');records.get(RECEIPT).value.dirty=true;return {verified:kind!=='unverified'};}});
    if(kind==='failure')await assert.rejects(c.dataImportHistoryOperation('publish'),/Stale guarded import/);
    else await c.dataImportHistoryOperation(['unverified','clean-replay'].includes(kind)?'publish':kind,kind==='clean-replay'?{markDirty:false}:{});
    await turn();const expected=['publish','save','update','rollback'].includes(kind);
    assert.equal(c.atlasWorkspaceAccess.source.localChanges,expected,kind);assert.equal(state.textUpdates,expected?1:0,kind);
  }
});

test('a superseded native import result cannot update another workspace status',async()=>{
  const {c,state,records}=fixture(),held=deferred();c.historyModule=async()=>({historyOperation:async()=>{await held.promise;records.get(RECEIPT).value.dirty=true;return {verified:true};}});
  const pending=c.dataImportHistoryOperation('publish');await turn();c.ATLAS_STATE_DB_NAME='other';held.resolve();
  await assert.rejects(pending,{name:'AbortError'});await turn();assert.equal(c.atlasWorkspaceAccess.source.localChanges,false);assert.equal(state.textUpdates,0);
});
