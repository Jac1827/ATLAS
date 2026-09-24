const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function block(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
const people=block('async function loadAtlasCentralPeopleAssignments(', '\nfunction atlasCentralMonthDate(');
const financial=block('if (typeof BroadcastChannel !== "undefined") {\n  const financialPublicationChannel', '\nfunction buildDailyBackupDateKey(');
const daily=block('async function hydrateDailyBackupState()', '\nasync function writeDailyBackupSnapshot(');
const weekly=block('async function hydrateWeeklySnapshotState()', '\nasync function hydrateDashboardPersistentState(');
const pull=block('async function pullAtlasCentralAppState(', '\nasync function uploadAtlasCentralMigrationSnapshot(')
  .replace(/await import\("\.\/features\/workspace-bootstrap\.mjs(?:\?v=[^"]+)?"\)/g,'await workspaceModule()');
const fileImport=block('async function importDashboardStorageBundleFromFile(', '\nasync function applyDashboardStorageBundle(');
const clipboardImport=block('async function importDashboardStorageBundleFromClipboard(', '\nfunction getWeeklySnapshotPayload(');
const restore=block('async function applyDashboardStorageBundle(', '\nasync function importDashboardStorageBundleFromClipboard(')
  .replace(/await import\("\.\/features\/workspace-bootstrap\.mjs(?:\?v=[^"]+)?"\)/g,'await workspaceModule()')
  .replace(/await import\('\.\/features\/import-history\.mjs(?:\?v=[^']+)?'\)/g,'await historyModule()');
const writeGlobal=block('async function writeOpsGlobalStorage(', '\nasync function hydrateOpsGlobalStorage(');
function fixture(code){
  const c={AbortController,DOMException,Date,JSON,structuredClone,context:'actor/scope-a',ATLAS_STATE_DB_NAME:'scope-a',ATLAS_STATE_STORE_NAME:'records',
    atlasWorkspaceAccess:{epoch:1,validated:true,controller:new AbortController()},getAtlasRenderContextKey:()=>c.context,
    getAtlasCentralStatus:()=>({configured:true,signedIn:true}),window:{},savedData:{Example:{value:'new'}},
    ATLAS_STATE_COMMUNITY_KEY:'communities',OPS_GLOBAL_STORAGE_KEY:'global',DATA_IMPORT_2_STATE_KEY:'imports',DATA_IMPORT_FILE_ARCHIVE_PREFIX:'file:',
    ATLAS_STATE_WEEKLY_SNAPSHOT_KEY:'weekly',ATLAS_STATE_DAILY_BACKUP_INDEX_KEY:'daily-index',ATLAS_STATE_DAILY_BACKUP_PREFIX:'daily:',
    DASHBOARD_DAILY_BACKUP_RETENTION:30,atlasStateWritePromise:Promise.resolve(),opsGlobalStorageCache:{owner:'new'},weeklySnapshotCache:{owner:'new'},dailyBackupIndexCache:['new'],
    markAtlasPersistenceError(){c.errors=(c.errors||0)+1;},renderTab(){c.renders=(c.renders||0)+1;},alert(){c.alerts=(c.alerts||0)+1;},
    removeLegacyCommunityStorageKeys(){},removeLegacyDailyBackupStorageKeys(){},removeLegacyWeeklySnapshotStorageKey(){},
    loadDailyBackupIndex:()=>c.dailyBackupIndexCache,mergeDashboardCommunityDataMaps:(_old,next)=>next,
    getProp:()=>({name:'Example'}),atlasCentralRuntimeMeta:{},closeModal(){},setAtlasCentralRuntimeMessage(){c.messages=(c.messages||0)+1;}
  };
  c.window.location={reload(){c.reloads=(c.reloads||0)+1;}};
  c.changeScope=()=>{c.context='actor/scope-b';c.ATLAS_STATE_DB_NAME='scope-b';c.atlasWorkspaceAccess.controller.abort();c.atlasWorkspaceAccess={epoch:c.atlasWorkspaceAccess.epoch+1,validated:true,controller:new AbortController()};};
  vm.createContext(c);vm.runInContext(code,c);return c;
}
function peopleFixture(){
  const c=fixture(people);c.atlasCentralPeopleLoadPromise=null;c.activeTab=9;
  c.atlasSharedData={employees:{retained:{name:'retained'}},assignments:[]};
  c.calls=[];c.writes=[];c.staffing=[];
  c.window.ATLAS_CENTRAL={getSession:()=>({user:{id:'same-actor'}}),getAccessContextKey:()=>c.context,fetchJson:(url,options)=>{const held=deferred();c.calls.push({url,options,...held});return held.promise;}};
  c.normalizeAtlasSharedData=data=>structuredClone(data);c.normalizeSharedEmployeeRecord=data=>data;c.normalizeSharedAssignmentRecord=data=>data;
  c.inferSharedBonusRoleType=()=>'';c.validateAtlasSharedData=()=>[];c.persistOpsGlobalData=()=>c.writes.push(structuredClone(c.atlasSharedData));
  c.syncAllCommunityStaffingFromPeopleRoster=options=>c.staffing.push(options.persist);c.scheduleAtlasSharedRender=()=>{c.scheduled=(c.scheduled||0)+1;};
  c.refreshAtlasPeopleAccessPanel=()=>{};return c;
}
const row=label=>({assignment_id:label,version:1,atlas_employees:{employee_id:label,full_name:label,status:'Active',bonus_eligible:false},atlas_communities:{community_id:label,display_name:label},atlas_roles:{title:'General Manager'}});

(async()=>{
  // Same actor, changed access: old rows cannot replace the new scoped roster.
  {
    const c=peopleFixture(),old=c.loadAtlasCentralPeopleAssignments();await turn();
    const oldSignal=c.calls[0].options.signal;c.changeScope();c.atlasSharedData={employees:{newScope:{name:'new-scope'}},assignments:[]};
    const current=c.loadAtlasCentralPeopleAssignments();await turn();assert.equal(c.calls.length,2,'New scope does not coalesce with old request');
    const pending=c.atlasCentralPeopleLoadPromise;c.calls[0].resolve([row('old-scope')]);assert.equal(await old,null);
    assert.equal(oldSignal.aborted,true);assert.equal(c.atlasCentralPeopleLoadPromise,pending,'Old finally cannot clear new pending request');
    assert.equal(c.writes.length,0);assert(c.atlasSharedData.employees.newScope);
    c.calls[1].resolve([row('new-scope')]);const result=await current;
    assert.equal(result.employees,1);assert.equal(c.writes.length,1);assert(c.atlasSharedData.employees['new-scope']);assert(!c.atlasSharedData.employees['old-scope']);
  }
  // Exact access context is required even without an epoch notification.
  {
    const c=peopleFixture(),pending=c.loadAtlasCentralPeopleAssignments();await turn();c.context='same-actor/restricted';
    c.calls[0].resolve([row('old-scope')]);assert.equal(await pending,null);assert.equal(c.writes.length,0);
  }
  // Normal duplicate reads coalesce, preserve explicit false, and keep staffing behavior.
  {
    const c=peopleFixture(),a=c.loadAtlasCentralPeopleAssignments(),b=c.loadAtlasCentralPeopleAssignments();await turn();assert.equal(c.calls.length,1);
    c.calls[0].resolve([row('valid')]);assert.equal((await a).assignments,1);assert.equal((await b).assignments,1);
    assert.equal(c.writes.length,1);assert.equal(c.atlasSharedData.employees.valid.bonusEligible,false);assert.deepEqual(c.staffing,[false]);
  }
  // A queued callback may settle after access changed, independently of the read guard.
  {
    const c=peopleFixture(),held=deferred();c.loadAtlasCentralPeopleAssignments=()=>held.promise;c.queueAtlasCentralPeopleLoad({force:true});c.changeScope();held.resolve({employees:1});await turn();
    assert.equal(c.staffing.length,0);assert.equal(c.writes.length,0);assert.equal(c.scheduled,undefined);
  }
  // Financial BroadcastChannel read is bound to both its scope and database.
  {
    let channel;const c=fixture('');c.BroadcastChannel=class{constructor(){channel=this;}};vm.runInContext(financial,c);
    const held=deferred();c.atlasStateGetValue=()=>held.promise;const pending=channel.onmessage({data:{communityName:'Example'}});
    c.changeScope();c.savedData={Example:{financialLedger:'new-scope'}};held.resolve({Example:{financialLedger:'old-scope'}});await pending;
    assert.equal(c.savedData.Example.financialLedger,'new-scope');assert.equal(c.renders,undefined);
    c.atlasStateGetValue=async()=>({Example:{financialLedger:0}});await channel.onmessage({data:{communityName:'Example'}});
    assert.equal(c.savedData.Example.financialLedger,0);assert.equal(c.renders,1);
  }
  // Even legacy-only backup hydrators cannot place an old result in new caches.
  for(const [code,name,value,key]of [[daily,'hydrateDailyBackupState',['old'],'dailyBackupIndexCache'],[weekly,'hydrateWeeklySnapshotState',{owner:'old'},'weeklySnapshotCache']]){
    const c=fixture(code),held=deferred(),before=c[key];c.atlasStateGetValue=()=>held.promise;
    const pending=c[name]();c.changeScope();held.resolve(value);await pending;assert.equal(c[key],before);
  }
  // An explicit pull/file selection belongs to its initiating actor and scope.
  {
    const c=fixture(pull),held=deferred();c.window.ATLAS_CENTRAL={readDocument:()=>held.promise};c.atlasCentralCanUseDatabase=()=>({ok:true});c.getAtlasCentralDocumentKey=()=> 'canonical';
    c.applyDashboardStorageBundle=async()=>{c.applied=true;};
    const pending=c.pullAtlasCentralAppState({silent:true});c.changeScope();held.resolve({payload:{bundle:{}},version:1});assert.equal(await pending,false);
    assert.equal(c.applied,undefined);assert.equal(c.reloads,undefined);assert.equal(c.messages,undefined);
  }
  {
    const c=fixture(fileImport),held=deferred();c.applyDashboardStorageBundle=async()=>{c.applied=true;};
    const pending=c.importDashboardStorageBundleFromFile({text:()=>held.promise});c.changeScope();held.resolve('{"keys":{}}');await pending;
    assert.equal(c.applied,undefined);assert.equal(c.reloads,undefined);
  }
  // Clipboard permission/read delays cannot redirect an old restore to a new actor.
  for(const empty of [false,true]){
    const c=fixture(clipboardImport),held=deferred();c.navigator={clipboard:{readText:()=>held.promise}};
    c.window.prompt=()=>{c.prompted=true;return '{"keys":{"example":0}}';};c.applyDashboardStorageBundle=async()=>{c.applied=true;};
    const pending=c.importDashboardStorageBundleFromClipboard();c.changeScope();held.resolve(empty?'':'{"keys":{"example":0}}');await pending;
    assert.equal(c.applied,undefined);assert.equal(c.prompted,undefined);assert.equal(c.reloads,undefined);assert.equal(c.alerts,undefined);
  }
  // A committed clipboard restore may finish, but cannot reload the new workspace.
  {
    const c=fixture(clipboardImport),held=deferred();c.navigator={clipboard:{readText:async()=>'{"keys":{"example":0}}'}};
    c.applyDashboardStorageBundle=()=>held.promise;const pending=c.importDashboardStorageBundleFromClipboard();await turn();c.changeScope();held.resolve(1);await pending;
    assert.equal(c.reloads,undefined);assert.equal(c.alerts,undefined);
  }
  // Normal clipboard flow still preserves exact zero and completes once.
  {
    const c=fixture(clipboardImport);c.navigator={clipboard:{readText:async()=>'{"keys":{"example":0}}'}};
    c.applyDashboardStorageBundle=async payload=>{assert.equal(payload.keys.example,0);return 1;};await c.importDashboardStorageBundleFromClipboard();
    assert.equal(c.reloads,1);assert.equal(c.alerts,1);
  }
  // A restore waiting for older writes cannot begin a global write in B's DB.
  {
    const c=fixture(restore),held=deferred();c.atlasStateWritePromise=held.promise;c.writeOpsGlobalStorage=async()=>{c.written=true;};
    const pending=c.applyDashboardStorageBundle({keys:{global:'{"value":0}'}});c.changeScope();held.resolve();await assert.rejects(pending,{name:'AbortError'});
    assert.equal(c.written,undefined);assert.equal(c.opsGlobalStorageCache.owner,'new');
  }
  // An accepted write settles; no following cache/backup write is allowed after loss.
  {
    const c=fixture(restore),held=deferred(),writes=[];c.atlasStateSetValue=async(key,value)=>{writes.push({key,value,database:c.ATLAS_STATE_DB_NAME});await held.promise;};
    const pending=c.applyDashboardStorageBundle({indexedDb:{weeklySnapshot:{value:0},dailyBackups:{today:{value:1}},dailyBackupIndex:['today']}});
    await turn();c.changeScope();held.resolve();await assert.rejects(pending,{name:'AbortError'});
    assert.equal(writes.length,1);assert.equal(writes[0].database,'scope-a');assert.equal(c.weeklySnapshotCache.owner,'new');assert.deepEqual(c.dailyBackupIndexCache,['new']);
  }
  // writeOpsGlobalStorage honors the restore guard before readback/legacy cleanup.
  {
    const c=fixture(writeGlobal),held=deferred();c.openAtlasStateDb=async()=>({});c.atlasStateSetValue=()=>held.promise;c.atlasStateGetValue=async()=>{c.readback=true;return {};};
    c.localStorage={removeItem(){c.cleaned=true;}};c.atlasScopedLocalKey=x=>x;
    const original=c.context,checkCurrent=()=>{if(c.context!==original)throw new DOMException('Changed','AbortError');};
    const pending=c.writeOpsGlobalStorage({value:0},{checkCurrent});await turn();c.changeScope();held.resolve();await assert.rejects(pending,{name:'AbortError'});
    assert.equal(c.readback,undefined);assert.equal(c.cleaned,undefined);
  }
  console.log('PASS loader scope: same-actor People access change/coalescing/queue, financial broadcasts, backup caches, pull/file/clipboard restore entry, queued/accepted restore writes and guarded readback.');
})().catch(error=>{console.error(error);process.exitCode=1;});
