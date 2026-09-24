const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function section(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
const code=[
  section(core,'function captureAtlasAuxiliaryContext()', 'const ATLAS_ACCESS_TABS ='),
  section(core,'async function loadAtlasEmployeeNotifications(', 'async function updateAtlasEmployeeNotification('),
  section(core,'async function refreshAtlasLivePresence(', 'function startAtlasLivePresence('),
  section(core,'async function refreshAtlasSharedRealtime(', 'function startAtlasSharedRealtime('),
  section(core,'function queueAtlasAccessAdminLoad(', 'function getAtlasAccessCheckedValues('),
  section(core,'async function hydrateSharedPropertiesFromMarketingDatabase(', 'async function fetchMarketingTeamMembersForBonus(')
].join('\n');
function fixture(){
 const calls=[],timers=new Map();let nextTimer=1;
 const ctx={AbortController,Date,JSON,Set,Promise,console,
  atlasWorkspaceAccess:{epoch:1,validated:true,controller:new AbortController()},ATLAS_STATE_DB_NAME:'scope-a',actor:'same-user',access:'scope-a',configured:true,
  atlasWorkspaceActorKey:()=>ctx.actor,getAtlasCentralStatus:()=>({configured:ctx.configured,signedIn:true}),
  getAtlasAccessProfile:()=>({role:'admin',community_access_records:[{community_id:'allowed-id',display_name:'Allowed Community',canonical_name:'allowed community'}]}),
  atlasProfileCanManageSettings:profile=>profile.role==='admin',atlasDashboardUserCanSeeCommunityName:name=>name.toLowerCase()==='allowed community',
  atlasAccessAdminState:{},atlasEmployeeNotificationState:{},atlasLivePresenceState:{},atlasSharedRealtimeState:{},
  atlasAccessFormDraft:null,defaultAtlasAccessFormDraft:()=>({email:""}),atlasEmployeeAccessHistory:[],atlasLivePresenceRefreshPromise:null,
  atlasEmployeeNotificationTimer:null,atlasLivePresenceTimer:null,atlasSharedRealtimeTimer:null,atlasAccessPanelRefreshTimer:null,
  setInterval:fn=>{const id=nextTimer++;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id),
  renderAtlasEmployeeNotificationTicker:()=>calls.push('notification-render'),renderAtlasLiveUsersTicker:()=>calls.push('presence-render'),
  renderTab:()=>calls.push('render'),refreshAtlasPeopleAccessPanel:()=>calls.push('admin-render'),setAtlasCentralRuntimeMessage:()=>calls.push('message'),alert:()=>calls.push('alert'),
  document:{querySelector:()=>null,getElementById:()=>null},activeTab:0,
  atlasEmployeeNoticeIsActive:()=>true,getAtlasAccessTab:()=>({id:'0',label:'Home'}),getAtlasSharedPropertyByName:()=>null,getProp:()=>({name:'Allowed Community'}),
  getAtlasLiveSessionId:()=> 'test-session',isPortfolioWorkspaceSelected:()=>false,PORTFOLIO_SCOPE_LABEL:'Portfolio',
  pullAtlasSharedPropertyGraphFromCentral:async()=>({changed:false}),scheduleAtlasSharedRender:()=>calls.push('shared-render'),
  atlasNormalizeSharedText:value=>String(value||'').trim().toLowerCase(),atlasSharedNow:()=> '2026-09-24T00:00:00Z',
  readAtlasSharedPropertyGraph:()=>({}),atlasUpsertSharedProperty:(_graph,row)=>{calls.push(['property',row.name]);return {changed:true,record:{}};},
  writeAtlasSharedPropertyGraph:()=>calls.push('graph-write'),persistOpsPropertyCatalog:()=>calls.push('catalog-write'),applySharedPropertyGraphToPortfolio:()=>calls.push('portfolio-write'),markAtlasPersistenceError:()=>calls.push('error'),
  fetchMarketingMccTable:async()=>[],
  window:{ATLAS_CENTRAL:{getAccessContextKey:()=>ctx.access},AtlasReskin:{refreshTicker:async()=>{}}}
 };
 for(const name of ['readUserProfiles','readAccessInvites','readCommunitiesForAccess','readEmployeesForAccess','readEmployeeNotifications','readLiveSessions'])ctx.window.ATLAS_CENTRAL[name]=async options=>{calls.push([name,options]);return [{source:ctx.access}];};
 ctx.window.ATLAS_CENTRAL.upsertLiveSession=async()=>calls.push('presence-write');
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const change=()=>{ctx.atlasWorkspaceAccess.controller.abort();ctx.atlasWorkspaceAccess={epoch:ctx.atlasWorkspaceAccess.epoch+1,validated:true,controller:new AbortController()};ctx.access='scope-b';ctx.ATLAS_STATE_DB_NAME='scope-b';ctx.resetAtlasAuxiliaryContext();};
 return {ctx,calls,timers,change};
}
(async()=>{
 // A same-user restriction change replaces caches and rejects late administrator rows.
 {
  const {ctx,change,calls}=fixture(),held=deferred();
  ctx.window.ATLAS_CENTRAL.readUserProfiles=async()=>held.promise;
  const old=ctx.loadAtlasAccessAdminData();await turn();change();
  ctx.window.ATLAS_CENTRAL.readUserProfiles=async()=>[{source:'scope-b'}];
  await ctx.loadAtlasAccessAdminData();const newer=ctx.atlasAccessAdminState;
  held.resolve([{source:'scope-a'}]);await old;
  assert.equal(ctx.atlasAccessAdminState,newer);assert.equal(newer.profiles[0].source,'scope-b');assert.equal(newer.loaded,true);
  assert(calls.filter(row=>Array.isArray(row)&&row[0]==='readAccessInvites').every(row=>row[1].signal));
 }
 // Notifications cannot reappear or install an old-account timer after cancellation.
 {
  const {ctx,change,timers}=fixture(),held=deferred();ctx.window.ATLAS_CENTRAL.readEmployeeNotifications=async()=>held.promise;
  const old=ctx.loadAtlasEmployeeNotifications();await turn();change();held.resolve([{title:'old'}]);await old;
  assert.equal(ctx.atlasEmployeeNotificationState.notices.length,0);assert.equal(timers.size,0);
  ctx.window.ATLAS_CENTRAL.readEmployeeNotifications=async()=>[{title:'new'}];await ctx.loadAtlasEmployeeNotifications();
  assert.equal(ctx.atlasEmployeeNotificationState.notices[0].title,'new');assert.equal(timers.size,1);
 }
 // An accepted presence write settles, but cannot start a read under the next scope.
 {
  const {ctx,change,calls}=fixture(),held=deferred();ctx.window.ATLAS_CENTRAL.upsertLiveSession=async()=>held.promise;
  const old=ctx.refreshAtlasLivePresence();await turn();change();held.resolve();await old;
  assert(!calls.some(row=>Array.isArray(row)&&row[0]==='readLiveSessions'));assert.equal(ctx.atlasLivePresenceState.users.length,0);
 }
 // Marketing reads are constrained by verified directory relationships and discard unrelated rows.
 {
  const {ctx,calls}=fixture();let query,signal;
  ctx.fetchMarketingMccTable=async(_table,q,options)=>{query=decodeURIComponent(q);signal=options.signal;return [{name:'Unrelated',community_id:'denied-id'},{name:'Allowed Community'},{name:'Renamed',community_id:'allowed-id'},{name:'Allowed Community',atlas_community_id:'denied-id',community_id:'allowed-id'},{name:'Allowed Community',atlas_community_id:'denied-id'}];};
  const result=await ctx.hydrateSharedPropertiesFromMarketingDatabase({central:false});
  assert.equal(result.properties,2);assert(query.includes('or=(atlas_community_id.in.'));assert(query.includes('Allowed Community'));assert.equal(signal,ctx.atlasWorkspaceAccess.controller.signal);
  assert.deepEqual(calls.filter(row=>Array.isArray(row)&&row[0]==='property').map(row=>row[1]),['Allowed Community','Renamed']);
 }
 {
  const {ctx,calls,change}=fixture(),held=deferred();ctx.fetchMarketingMccTable=async()=>held.promise;
  const old=ctx.hydrateSharedPropertiesFromMarketingDatabase({central:false});await turn();change();held.resolve([{name:'Allowed Community'}]);await old;
  assert(!calls.includes('graph-write'));assert(!calls.includes('catalog-write'));
 }
 // A same-string A→B→A is stale by epoch; unverified hosted reads never start.
 {
  const {ctx,calls}=fixture(),captured=ctx.captureAtlasAuxiliaryContext();ctx.atlasWorkspaceAccess.epoch+=2;assert.equal(captured.current(),false);
  ctx.atlasWorkspaceAccess.validated=false;
  await ctx.loadAtlasAccessAdminData();await ctx.loadAtlasEmployeeNotifications();await ctx.hydrateSharedPropertiesFromMarketingDatabase();
  assert(!calls.some(row=>Array.isArray(row)));
 }
 // Public client methods forward abort signals through both current and fallback field projections.
 {
  const client=fs.readFileSync('docs/portfolio-operations-dashboard/centralization/atlas-central-client.js','utf8'),requests=[],signal=new AbortController().signal;
  const ctx={Date,Math,Number,String,Array,encodeURIComponent,refreshSession:async()=>{},fetchJson:async(path,options)=>{requests.push({path,options});return [];}};
  vm.createContext(ctx);
  for(const [name,next]of [['readLiveSessions','upsertLiveSession'],['readAccessInvites','readUserProfiles'],['readUserProfiles','readCommunitiesForAccess'],['readCommunitiesForAccess','readEmployeesForAccess'],['readEmployeesForAccess','readEmployeeNotifications'],['readEmployeeNotifications','updateEmployeeNotification']]){
   vm.runInContext(section(client,`  async function ${name}(`,`  async function ${next}(`),ctx);await ctx[name]({signal});
  }
  assert.equal(requests.length,6);assert(requests.every(row=>row.options.signal===signal));
 }
 assert(core.includes('resetAtlasAuxiliaryContext();\n  const epoch = ++atlasWorkspaceAccess.epoch;'));
 console.log('PASS auxiliary scope: same-actor access changes, late reads, cache clearing, cancellation, scoped Marketing relationships and unchanged accepted-write settlement.');
})().catch(error=>{console.error(error);process.exitCode=1;});
