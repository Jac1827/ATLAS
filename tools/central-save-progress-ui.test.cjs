const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../docs/portfolio-operations-dashboard/workspace-core.js'),'utf8');
const section=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);};
const helpers=section('let atlasCentralSaveUiProgress = null;','async function saveAtlasCentralAppState(');
const save=section('async function saveAtlasCentralAppState(','\nasync function inspectAtlasOccupancyReadback')
  .replace(/const \{ensureWorkspaceProjection\} = await import\([^;]+;/,'const {ensureWorkspaceProjection}=projectionFixture;')
  .replace(/const cacheModule = await import\([^;]+;/,'const cacheModule={capturePublicationCache:async()=>null};');
const contexts=section('function captureAtlasAuxiliaryContext()','\nfunction resetAtlasAuxiliaryContext()')
  +section('function observeAtlasSaveContext()','\nasync function handleMarketSurveyWorkbook(');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const tick=()=>new Promise(setImmediate);
function fixture(){
  const nodes=new Map(),button={disabled:false,textContent:''},records=new Map();
  const calls={build:0,parts:0,parent:0,projection:0,renders:0,alerts:[],runtime:[]};
  const element=()=>({style:{},hidden:false,attributes:{},textContent:'',setAttribute(k,v){this.attributes[k]=v;}});
  nodes.set('atlas-topbar',{after:node=>nodes.set(node.id,node)});
  let parent={version:1,payload_hash:'old',payload:{bundle:{sha256:'old'}}};
  const c={console,Date,Promise,DOMException,AbortController,Number,String,
    actor:'A',access:'access-A',view:'settings-portfolio',signedIn:true,
    ATLAS_STATE_DB_NAME:'db-A',ATLAS_RENEWAL_REPAIR_KEY:'repair',
    ATLAS_STATE_COMMUNITY_KEY:'communities',OPS_GLOBAL_STORAGE_KEY:'ops',DATA_IMPORT_2_STATE_KEY:'imports',
    atlasWorkspaceAccess:{epoch:1,validated:true,controller:new AbortController()},
    atlasCentralRuntimeMeta:{lastDocumentVersion:1},atlasSaveContextSignature:'',atlasSaveContextRevision:0,
    portfolioMonthScopeByPeriod:{},getSelectedDashboardPeriodKey:()=> '2026-10',
    atlasWorkspaceActorKey:()=>c.actor,getAtlasRenderContextKey:()=>c.view,
    getAtlasCentralStatus:()=>({configured:true,signedIn:c.signedIn}),
    atlasRenewalRepairPending:()=>false,atlasRenewalRepairGeneration:()=>'',
    atlasCentralCanUseDatabase:()=>({ok:true}),atlasCentralAutosaveGateSatisfied:()=>true,
    getAtlasCentralDocumentKey:()=> 'dashboard',withAtlasStateStore:()=>{},
    atlasStateGetValue:async key=>records.get(key),atlasStateSetValue:async(key,value)=>records.set(key,value),
    setAtlasCentralRuntimeMessage:(message,error)=>calls.runtime.push({message,error}),
    alert:message=>calls.alerts.push(message),renderTab:()=>calls.renders++,
    document:{getElementById:id=>nodes.get(id),createElement:element,querySelectorAll:selector=>selector==='[data-atlas-central-save]'?[button]:[]},
    window:{},projectionFixture:{ensureWorkspaceProjection:async()=>{calls.projection++;await c.duringProjection?.();return{status:c.projectionPending?'archive_saved_projection_pending':'complete',message:'Synthetic pending'};}}
  };
  c.window.ATLAS_CENTRAL={getAccessContextKey:()=>c.access,computeSha256:async()=> 'new-hash',
    readDocument:async()=>{await c.beforeRead?.(calls.parent);return structuredClone(parent);},
    saveDocument:async input=>{calls.parent++;parent={version:2,payload_hash:'new-hash',payload:input.payload};await c.duringParent?.();return{version:2};}};
  c.window.AtlasMigrationArchive={publish:async(archive,client,size,options)=>{calls.parts++;c.partProgress=options.onProgress;await c.duringParts?.(options);return{...archive,dataDocuments:[]};}};
  c.buildAtlasCentralAppStatePayload=async options=>{calls.build++;c.buildProgress=options.onProgress;await options.onCaptured({});await c.duringBuild?.(options);return{bundle:{sha256:'new',bytes:3,data:'e30='},reconciliation:{},exceptions:[]};};
  vm.createContext(c);vm.runInContext(contexts+'\n'+helpers+'\n'+save,c);
  return{c,calls,button,nodes,records,status:()=>nodes.get('atlas-central-save-progress')};
}

test('manual Save shows immediate busy state and real phases without rerendering or a false early completion',async()=>{
  const f=fixture(),held=deferred();f.c.duringBuild=()=>held.promise;
  const result=f.c.saveAtlasCentralAppState();await tick();
  assert.equal(f.button.disabled,true);assert.match(f.button.textContent,/Saving/);
  assert.match(f.status().textContent,/Preparing saved data/);assert.equal(f.status().attributes['aria-busy'],'true');
  assert.equal(await f.c.saveAtlasCentralAppState(),false);assert.equal(f.calls.build,1);
  f.c.buildProgress({phase:'packing',completed:17,total:115});
  assert.match(f.status().textContent,/Building the archive.*17 of 115/);assert.equal(f.calls.renders,0);
  f.c.buildProgress({phase:'complete',completed:109,total:109});
  assert.match(f.status().textContent,/Retained evidence verified/);assert(!/Save complete/.test(f.status().textContent));
  f.c.buildProgress({phase:'verifying_bundle',completed:116,total:115});assert(!f.status().textContent.includes('116'));
  f.c.duringParts=async options=>{options.onProgress({phase:'publishing_parts',completed:3,total:20});assert.match(f.status().textContent,/Uploading.*3 of 20/);assert.equal(f.calls.renders,0);};
  f.c.duringParent=async()=>assert.match(f.status().textContent,/Saving the Central version/);
  f.c.beforeRead=async committed=>{if(committed)assert.match(f.status().textContent,/Checking the saved Central version/);};
  f.c.duringProjection=async()=>assert.match(f.status().textContent,/Verifying startup data/);
  held.resolve();assert.equal(await result,true);
  assert.match(f.status().textContent,/Central Save complete.*Version 2/);assert.equal(f.status().attributes['aria-busy'],'false');
  assert.equal(f.button.disabled,false);assert.equal(f.c.saveAtlasCentralAppState.inFlight,null);
  assert.equal(f.calls.parent,1);assert.equal(f.calls.projection,1);
});

test('same-account view cancellation is explicit, preserves strict write checks, and ignores late progress',async()=>{
  const f=fixture(),held=deferred();f.c.duringBuild=()=>held.promise;
  const result=f.c.saveAtlasCentralAppState();await tick();
  f.c.view='community-command-doro';held.resolve();assert.equal(await result,false);
  assert.match(f.status().textContent,/stopped because the view or workspace changed/);
  assert.match(f.status().textContent,/outcome was not verified/);assert(!/nothing.*saved|no.*saved/i.test(f.status().textContent));
  assert.equal(f.calls.parts,0);assert.equal(f.calls.parent,0);assert.equal(f.calls.renders,0);assert.equal(f.calls.runtime.length,0);
  const text=f.status().textContent;f.c.buildProgress({phase:'packing',completed:99,total:100});assert.equal(f.status().textContent,text);
  assert.equal(f.button.disabled,false);
});

test('navigation during archive or parent write never reports an unverified successful publication',async()=>{
  for(const stage of ['duringParts','duringParent']){
    const f=fixture();f.c[stage]=async()=>{f.c.view='different-view';};
    assert.equal(await f.c.saveAtlasCentralAppState(),false);
    assert.equal(f.calls.parent,stage==='duringParent'?1:0);assert.equal(f.calls.projection,0);
    assert.match(f.status().textContent,/outcome was not verified/);
    assert(!/complete|nothing.*saved|no.*saved/i.test(f.status().textContent));
  }
});

test('actor, access, database, sign-out and access-epoch changes hide the old progress and outcome',async()=>{
  for(const change of [c=>{c.actor='B';},c=>{c.access='access-B';},c=>{c.ATLAS_STATE_DB_NAME='db-B';},c=>{c.signedIn=false;c.atlasWorkspaceAccess.validated=false;},c=>{c.atlasWorkspaceAccess.epoch++;}]){
    const f=fixture(),held=deferred();f.c.duringBuild=()=>held.promise;
    const result=f.c.saveAtlasCentralAppState();await tick();change(f.c);f.c.view='new-access-context';
    f.c.refreshAtlasCentralSaveProgress();assert.equal(f.status().hidden,true);assert.equal(f.status().textContent,'');
    f.c.buildProgress({phase:'packing',completed:1,total:2});held.resolve();assert.equal(await result,false);
    assert.equal(f.status().textContent,'');assert.equal(f.calls.parent,0);assert.equal(f.calls.alerts.length,0);
  }
});

test('old observer completion cannot replace a newer operation and UI failures cannot fail Save',async()=>{
  const f=fixture(),old=f.c.beginAtlasCentralSaveProgress(),fresh=f.c.beginAtlasCentralSaveProgress();
  fresh({phase:'publishing_parts',completed:4,total:10});const text=f.status().textContent;
  old.finish('Old result');old({phase:'packing',completed:1,total:2});old.refresh();
  assert.equal(f.status().textContent,text);assert.equal(f.status().attributes['aria-busy'],'true');
  const broken=fixture();broken.c.document.getElementById=()=>{throw Error('Display unavailable');};
  assert.equal(await broken.c.saveAtlasCentralAppState(),true);assert.equal(broken.calls.parent,1);
});

test('observer identity failures are isolated and early Save initialization cannot leave a busy display',async()=>{
  for(const mode of ['capture','viewer']){
    const f=fixture();f.c.captureAtlasAuxiliaryContext=()=>{if(mode==='capture')throw Error('Display identity unavailable');return{current:()=>{throw Error('Display identity unavailable');}};};
    assert.equal(await f.c.saveAtlasCentralAppState(),true);assert.equal(f.calls.parent,1);assert.equal(f.c.saveAtlasCentralAppState.inFlight,null);
    assert.equal(f.status(),undefined);
  }
  const f=fixture();f.c.captureAtlasSaveContext=()=>{throw Error('Save context unavailable');};
  await assert.rejects(f.c.saveAtlasCentralAppState(),/Save context unavailable/);
  assert.equal(f.status(),undefined);assert.equal(f.c.saveAtlasCentralAppState.inFlight,null);assert.equal(f.calls.parent,0);
});

test('pending startup verification remains a saved-parent result and retry does not repack',async()=>{
  const f=fixture();f.c.projectionPending=true;
  assert.equal(await f.c.saveAtlasCentralAppState(),false);
  assert.match(f.status().textContent,/version 2 is saved.*startup projection is pending/);
  assert.equal(f.records.get('atlas_workspace_projection_pending_v1').version,2);
  f.c.projectionPending=false;assert.equal(await f.c.saveAtlasCentralAppState(),true);
  assert.equal(f.calls.build,1);assert.equal(f.calls.parts,1);assert.equal(f.calls.parent,1);assert.equal(f.calls.projection,2);
});

test('silent autosave preserves its existing nonintrusive behavior',async()=>{
  const f=fixture();assert.equal(await f.c.saveAtlasCentralAppState({silent:true}),true);
  assert.equal(f.status(),undefined);assert.equal(f.calls.alerts.length,0);assert.equal(f.c.buildProgress,undefined);assert.equal(f.c.partProgress,undefined);
});
