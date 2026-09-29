const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/workspace-core.js', `file://${__filename}`), 'utf8');
const code = core.match(/^async function refreshAtlasCanonicalWorkspace\([^\n]*\) \{[\s\S]*?^\}/m)[0]
  .replace(/await import\("\.\/features\/workspace-bootstrap\.mjs(?:\?v=[^"]+)?"\)/, 'await bootstrapModule()');
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return {promise, resolve}; };
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture({sameSource = false, dirty = false} = {}) {
  const source = {documentKey:'synthetic-source',version:2,archiveHash:'new-hash'};
  const binding = {projectionVersion:2,scopeFingerprint:'synthetic-scope'};
  const projection = {contentHash:'new-content',communityData:{Example:{occupied:0,unknown:null}},opsGlobalData:{selectedMonth:8},importState:{batches:[{id:'new-batch'}],lineage:[{value:0},{value:null}]}};
  const previous = {identity:sameSource?source:{...source,version:1,archiveHash:'old-hash'},binding,contentHash:sameSource?'new-content':'old-content',dirty,verifiedAt:'before'};
  const records = new Map([['atlas_workspace_source_v2',{key:'atlas_workspace_source_v2',value:structuredClone(previous)}],['community',{key:'community',value:{Original:{occupied:9}}}]]);
  const stats = {modules:0,reads:0,transactions:0,puts:0,hydrations:0,history:0,topbar:0,aborts:0};
  const ctx = {
    AbortController, DOMException, Date, JSON,
    window:{ATLAS_CENTRAL:{},AtlasReplayGeneration:0},
    atlasWorkspaceAccess:{epoch:1,controller:new AbortController(),hasData:true,source:{archiveHash:'old-hash'},error:'previous'},
    actor:'actor-a', ATLAS_STATE_DB_NAME:'actor-a-scope', ATLAS_STATE_COMMUNITY_KEY:'community', OPS_GLOBAL_STORAGE_KEY:'ops',
    atlasCanonicalWorkspacePromise:null,atlasCanonicalWorkspaceContext:null,atlasCanonicalWorkspaceGeneration:0,
    savedData:{Original:{occupied:9}},opsGlobalStorageCache:{original:true},dataImport2State:{batches:[{id:'retained-batch'}]},
    atlasWorkspaceActorKey:()=>ctx.actor,
    bootstrapModule:async()=>{stats.modules++;return {stableJson:JSON.stringify,readWorkspace:async()=>{stats.reads++;await ctx.readHold;return {source,projection,binding};}};},
    atlasStateGetValue:async key=>structuredClone(records.get(key)?.value),
    withAtlasStateStore:async(_mode,callback)=>{
      stats.transactions++;
      const staged=[],requests=[];let aborted=false;
      const store={transaction:{abort(){aborted=true;stats.aborts++;}},get(key){const request={result:structuredClone(records.get(key))};requests.push(request);return request;},put(row){staged.push(structuredClone(row));}};
      callback(store);
      await ctx.beforeTransactionRead?.();
      for(const request of requests)request.onsuccess?.();
      if(aborted)throw new DOMException('Transaction aborted','AbortError');
      for(const row of staged){records.set(row.key,row);stats.puts++;}
    },
    normalizeSavedCommunityMap:value=>structuredClone(value),normalizeDataImport2State:value=>structuredClone(value),
    hydrateOpsGlobalData:()=>stats.hydrations++,rememberDataImportHistoryState:()=>stats.history++,syncAtlasTopbar:()=>stats.topbar++
  };
  vm.createContext(ctx);vm.runInContext(code,ctx);
  const replay = ({release = false} = {}) => {ctx.window.AtlasReplayGeneration++;ctx.window.AtlasReplayWriteFence={};if(release)delete ctx.window.AtlasReplayWriteFence;};
  return {ctx,records,stats,source,binding,projection,replay};
}

test('canonical refresh performs no request while replay or checkpoint recovery is active',async()=>{
  const {ctx,stats,replay}=fixture();replay();
  assert.equal(await ctx.refreshAtlasCanonicalWorkspace({force:true}),false);
  assert.equal(stats.modules,0);assert.equal(stats.reads,0);assert.equal(stats.transactions,0);
});

test('a pending module cannot start a canonical read after replay begins',async()=>{
  const {ctx,stats,replay}=fixture(),held=deferred(),original=ctx.bootstrapModule;
  ctx.bootstrapModule=()=>held.promise;
  const pending=ctx.refreshAtlasCanonicalWorkspace();replay({release:true});held.resolve(await original());
  assert.equal(await pending,false);assert.equal(stats.reads,0);assert.equal(stats.puts,0);
});

test('a canonical response started before replay cannot replace evidence during or after replay',async()=>{
  for(const release of [false,true]){
    const {ctx,records,stats,replay}=fixture(),held=deferred(),before=structuredClone([...records]);
    const saved=ctx.savedData,imports=ctx.dataImport2State;ctx.readHold=held.promise;
    const pending=ctx.refreshAtlasCanonicalWorkspace();await turn();assert.equal(stats.reads,1);
    replay({release});held.resolve();assert.equal(await pending,false);
    assert.deepEqual([...records],before);assert.equal(ctx.savedData,saved);assert.equal(ctx.dataImport2State,imports);
    assert.equal(stats.transactions,0);assert.equal(stats.hydrations,0);
  }
});

test('replay between the storage read and publication blocks both source replacement and cache verification writes',async()=>{
  for(const sameSource of [false,true]){
    const {ctx,records,stats,replay}=fixture({sameSource}),before=structuredClone([...records]),saved=ctx.savedData;
    ctx.beforeTransactionRead=()=>replay({release:true});
    assert.equal(await ctx.refreshAtlasCanonicalWorkspace(),false);
    assert.deepEqual([...records],before);assert.equal(ctx.savedData,saved);assert.equal(stats.puts,0);
    assert.equal(stats.aborts,sameSource?0:1);assert.equal(stats.topbar,0);
  }
});

test('after replay a fresh refresh does not reuse an outstanding stale refresh',async()=>{
  const {ctx,stats,replay,projection}=fixture(),held=deferred();ctx.readHold=held.promise;
  const stale=ctx.refreshAtlasCanonicalWorkspace();await turn();replay({release:true});ctx.readHold=null;
  const fresh=ctx.refreshAtlasCanonicalWorkspace();await turn();const freshReads=stats.reads;
  held.resolve();assert.equal(await fresh,true);assert.equal(freshReads,2);assert.equal(await stale,false);
  assert.deepEqual(ctx.savedData,projection.communityData);assert.equal(stats.puts,4);
});

test('normal changed-source refresh keeps exact projection, source binding, zero/null values and import history',async()=>{
  const {ctx,records,stats,source,binding,projection}=fixture();
  assert.equal(await ctx.refreshAtlasCanonicalWorkspace(),true);
  assert.deepEqual(ctx.savedData,projection.communityData);assert.deepEqual(ctx.dataImport2State,projection.importState);
  assert.deepEqual(records.get('atlas_workspace_source_v2').value.identity,source);
  assert.deepEqual(records.get('atlas_workspace_source_v2').value.binding,binding);
  assert.equal(records.get('atlas_workspace_source_v2').value.contentHash,projection.contentHash);
  assert.equal(stats.puts,4);assert.equal(stats.history,1);assert.equal(stats.hydrations,1);
});

test('normal equal-source refresh verifies the cache without replacing current records',async()=>{
  const {ctx,records,stats}=fixture({sameSource:true}),saved=ctx.savedData,imports=ctx.dataImport2State;
  assert.equal(await ctx.refreshAtlasCanonicalWorkspace(),false);
  assert.equal(ctx.savedData,saved);assert.equal(ctx.dataImport2State,imports);assert.equal(stats.puts,1);
  assert.notEqual(records.get('atlas_workspace_source_v2').value.verifiedAt,'before');assert.equal(stats.topbar,1);
});

test('dirty-source, actor, cancellation and storage-failure protections remain active',async()=>{
  const dirty=fixture({dirty:true});await assert.rejects(dirty.ctx.refreshAtlasCanonicalWorkspace(),/Save or reconcile/);assert.equal(dirty.stats.puts,0);
  for(const change of ['actor','database','epoch','abort']){
    const {ctx,stats}=fixture(),held=deferred();ctx.readHold=held.promise;
    const pending=ctx.refreshAtlasCanonicalWorkspace();await turn();
    if(change==='actor')ctx.actor='actor-b';else if(change==='database')ctx.ATLAS_STATE_DB_NAME='other-scope';else if(change==='epoch')ctx.atlasWorkspaceAccess.epoch++;else ctx.atlasWorkspaceAccess.controller.abort();
    held.resolve();assert.equal(await pending,false);assert.equal(stats.puts,0);
  }
  const failed=fixture();failed.ctx.withAtlasStateStore=async()=>{throw Error('Synthetic storage failure');};
  await assert.rejects(failed.ctx.refreshAtlasCanonicalWorkspace(),/Synthetic storage failure/);
});
