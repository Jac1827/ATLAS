// Delayed transport intentionally ignores abort: the consumer must still reject stale results.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const editorSource=fs.readFileSync('docs/portfolio-operations-dashboard/community-goal-editor.js','utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>Promise.resolve();
const scope=(revision,value=0)=>({communityId:'community-a',period:'2026-09',revision,recommendationRevision:revision,
  approved:{version:revision,applicationGoal:value,economicGoal:null},approvedHistory:[{version:revision,applicationGoal:value}],draft:null,recommended:{applicationGoal:11}});
const requests=[],saves=[];let actor='actor-a',access='scope-a',backend='https://a.invalid',renders=0;
const api={readGoals:(_central,options)=>{const d=deferred();requests.push({...d,signal:options.signal});return d.promise;},
 saveGoals:(_central,options)=>{const d=deferred();saves.push({...d,options});return d.promise;}};
const ctx=vm.createContext({console,Date,Map,Set,Promise,AbortController,DOMException,crypto:require('node:crypto').webcrypto,
 window:{ATLAS_CENTRAL:{getSession:()=>({user:{id:actor}}),getAccessContextKey:()=>access,getConfig:()=>({supabaseUrl:backend})},dispatchEvent:()=>{}},
 getAtlasCentralStatus:()=>({configured:true,signedIn:true}),ATLAS_STATE_DB_NAME:'db-a',atlasWorkspaceAccess:{validated:true,epoch:1,controller:new AbortController()},
 communityCommandGoalEditor:null,getAtlasCommunityAccessRecord:()=>({atlasCommunityId:'community-a'}),buildPeriodKey:()=> '2026-09',
 scheduleAtlasSharedRender:()=>renders++,renderTab:()=>renders++,renderPropGrid:()=>renders++,
 getProp:()=>({name:'Synthetic'}),getCurrentCommunityRecord:()=>({}),communityCommandCanApproveGoals:()=>true,
 updateCommunityCommandGoalEditor:()=>{},buildCommunityCommandModel:()=>({}),
 buildCommunityCommandLeasingPlanRows:()=>Array.from({length:12},()=>({occupancy:{lineage:{},inputs:{},warnings:[],beginningUnits:1}})),
 dataImport2State:{exceptions:[]},atlasBonusSectionCache:new Map(),atlasBonusNavigationSnapshot:null,
 CustomEvent:class {constructor(type){this.type=type;}}
});
for(const name of ['atlasCommunityGoalStore','communityCommandGoalBuffers','communityCommandGoalNotices']){
 const declaration=source.match(new RegExp('^const '+name+' = .+;$','m'))[0];vm.runInContext(declaration,ctx);
 vm.runInContext(`globalThis.${name}=${name}`,ctx);
}
for(const name of ['communityCommandGoalScope','communityCommandSharedGoalScope','captureCommunityCommandGoalContext','syncCommunityCommandGoalContext','mergeCommunityCommandGoalScope','hydrateCommunityCommandGoals']){
 vm.runInContext(source.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))[0],ctx);
}
for(const name of ['communityCommandGoalWeeks','communityCommandWeeklyAllocation','saveCommunityCommandGoalEditor']){
 vm.runInContext(editorSource.match(new RegExp('^(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))[0],ctx);
}
ctx.atlasCommunityGoalStore.module=api;
function transition(nextAccess=access,nextActor=actor,nextDB=ctx.ATLAS_STATE_DB_NAME){
 ctx.atlasWorkspaceAccess.controller.abort();ctx.atlasWorkspaceAccess.controller=new AbortController();
 ctx.atlasWorkspaceAccess.epoch++;access=nextAccess;actor=nextActor;ctx.ATLAS_STATE_DB_NAME=nextDB;
}
function editor(){return {key:'community-a|2026-09',communityId:'community-a',period:'2026-09',propName:'Synthetic',monthIdx:8,year:2026,revision:0,reason:'Explicit adjustment',effectiveDate:'2026-09-01',recommended:{},values:{requiredMoveIns:0,applicationGoal:0,grossLeaseGoal:0,netLeaseGoal:0,occupancyGoal:0,leasedGoal:null,economicGoal:null,renewalGoal:null}};}
(async()=>{
 // Initial verified read, de-duplication, exact zero/null and scope narrowing before hydration.
 const p=ctx.hydrateCommunityCommandGoals({force:true}),duplicate=ctx.hydrateCommunityCommandGoals({force:true});await tick();
 assert.equal(requests.length,1);requests[0].resolve([scope(1)]);await Promise.all([p,duplicate]);
 assert.equal(ctx.communityCommandSharedGoalScope('Synthetic',8,2026).approved.applicationGoal,0);
 assert.equal(ctx.communityCommandSharedGoalScope('Synthetic',8,2026).approved.economicGoal,null);
 ctx.communityCommandGoalBuffers.set('old',{});ctx.communityCommandGoalNotices.set('old','notice');ctx.communityCommandGoalEditor=editor();
 transition('scope-narrow');
 assert.equal(ctx.communityCommandSharedGoalScope('Synthetic',8,2026),undefined,'same actor restriction cannot display cached scope');
 assert.equal(ctx.communityCommandGoalBuffers.size,0);assert.equal(ctx.communityCommandGoalNotices.size,0);assert.equal(ctx.communityCommandGoalEditor,null);

 // A→B→A does not make an old response current; its finally cannot clear the newer read.
 const old=ctx.hydrateCommunityCommandGoals({force:true});await tick();const oldRequest=requests.at(-1);
 transition('scope-b','actor-b');ctx.syncCommunityCommandGoalContext();transition('scope-narrow','actor-a');
 const fresh=ctx.hydrateCommunityCommandGoals({force:true});await tick();const freshRequest=requests.at(-1),freshLoading=ctx.atlasCommunityGoalStore.loading;
 assert(oldRequest.signal.aborted);oldRequest.resolve([scope(99,99)]);await old;
 assert.equal(ctx.atlasCommunityGoalStore.scopes.size,0);assert.equal(ctx.atlasCommunityGoalStore.loading,freshLoading);
 freshRequest.resolve([scope(2)]);await fresh;assert.equal(ctx.atlasCommunityGoalStore.scopes.get('community-a|2026-09').revision,2);

 // A stale failure cannot replace a new context's status or finish its pending request.
 const failed=ctx.hydrateCommunityCommandGoals({force:true});await tick();const failedRequest=requests.at(-1);
 transition(access,actor,'db-new');const next=ctx.hydrateCommunityCommandGoals({force:true});await tick();const nextRequest=requests.at(-1);
 failedRequest.reject(Error('old scope error'));await failed;assert.equal(ctx.atlasCommunityGoalStore.error,'');assert(ctx.atlasCommunityGoalStore.loading);
 nextRequest.resolve([scope(3)]);await next;

 // A refresh begun before a successful local save cannot roll back either revision family.
 const racing=ctx.hydrateCommunityCommandGoals({force:true});await tick();
 const saved={...scope(5),recommendationRevision:7,recommended:{applicationGoal:17}};
 ctx.atlasCommunityGoalStore.scopes.set('community-a|2026-09',saved);
 const inserted={...scope(1),communityId:'community-new'};ctx.atlasCommunityGoalStore.scopes.set('community-new|2026-09',inserted);
 requests.at(-1).resolve([{...scope(4,4),recommendationRevision:6}]);await racing;
 const merged=ctx.atlasCommunityGoalStore.scopes.get('community-a|2026-09');assert.equal(merged.revision,5);assert.equal(merged.recommendationRevision,7);assert.equal(merged.approved.applicationGoal,0);assert.equal(merged.recommended.applicationGoal,17);
 assert.equal(ctx.atlasCommunityGoalStore.scopes.get('community-new|2026-09'),inserted);

 // Same-actor access change while saving: no stale cache, notices, buffer or UI mutation.
 const oldEditor=editor();ctx.communityCommandGoalEditor=oldEditor;ctx.communityCommandGoalBuffers.set(oldEditor.key,oldEditor);
 const save=ctx.saveCommunityCommandGoalEditor(false);assert.equal(saves.length,1);assert.equal(saves[0].options.signal,ctx.atlasWorkspaceAccess.controller.signal);
 transition('scope-restricted');ctx.syncCommunityCommandGoalContext();const newerEditor=editor();newerEditor.saving=true;ctx.communityCommandGoalEditor=newerEditor;ctx.communityCommandGoalBuffers.set(newerEditor.key,newerEditor);
 const paints=renders;saves[0].resolve({...scope(100),savedRecord:{applicationGoal:999}});await save;
 assert.equal(ctx.atlasCommunityGoalStore.scopes.size,0);assert.equal(ctx.communityCommandGoalNotices.size,0);assert.equal(ctx.communityCommandGoalBuffers.get(newerEditor.key),newerEditor);assert.equal(newerEditor.saving,true);assert.equal(renders,paints);

 // Backend changes with otherwise equal actor/scope also invalidate cached content.
 ctx.atlasCommunityGoalStore.scopes.set('community-a|2026-09',scope(1));backend='https://b.invalid';
 assert.equal(ctx.communityCommandSharedGoalScope('Synthetic',8,2026),undefined);

 // Adapter cancellation is enforced even when the transport resolves after abort.
 const {readGoals,saveGoals}=await import('../docs/portfolio-operations-dashboard/features/community-goals.mjs');
 const cancel=new AbortController(),page=deferred();let calls=0;
 const read=readGoals({fetchJson:async(_path,options)=>{calls++;assert.equal(options.signal,cancel.signal);return page.promise;}},{signal:cancel.signal});
 cancel.abort();page.resolve(Array(500).fill({}));await assert.rejects(read,{name:'AbortError'});assert.equal(calls,1,'no extra page or record read after cancellation');
 const saveCancel=new AbortController(),commit=deferred();let reads=0;
 const moduleSave=saveGoals({rpc:async(_name,_args,options)=>{assert.equal(options.signal,saveCancel.signal);return commit.promise;},fetchJson:async()=>{reads++;return [];}},
  {communityId:'10000000-0000-0000-0000-000000000001',period:'2026-09',kind:'draft',expectedRevision:0,requestId:'20000000-0000-0000-0000-000000000001',payload:{},signal:saveCancel.signal});
 saveCancel.abort();commit.resolve({});await assert.rejects(moduleSave,{name:'AbortError'});assert.equal(reads,0,'an ambiguously committed save never reads using a changed session');
 console.log('PASS community goals exact access/DB/epoch scope, synchronous cache denial, A-B-A late success/failure, save guard, revision merge, and adapter cancellation');
})().catch(error=>{console.error(error);process.exitCode=1;});
