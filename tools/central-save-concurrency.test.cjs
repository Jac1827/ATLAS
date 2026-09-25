// Exercise real Central Save code with deliberately reordered asynchronous work.
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {readDashboardSource}=require('./dashboard-source.cjs');
const source=process.env.ATLAS_CENTRAL_SAVE_SOURCE?fs.readFileSync(process.env.ATLAS_CENTRAL_SAVE_SOURCE,'utf8'):readDashboardSource('docs/portfolio-operations-dashboard/index.html');
const start=source.indexOf('async function saveAtlasCentralAppState('),end=source.indexOf('\nasync function inspectAtlasOccupancyReadback',start);
assert(start>=0&&end>start);
const fn=source.slice(start,end).replace(/const \{ensureWorkspaceProjection\} = await import\("\.\/features\/workspace-publication\.mjs(?:\?v=[^"]+)?"\);/g,'const {ensureWorkspaceProjection} = projectionFixture;');
function fixture(){
 const calls={build:0,parts:0,parent:0},records=new Map(),messages=[];
 let parent={version:1,payload_hash:'old',payload:{bundle:{sha256:'old'}}};
 const c={console,Date,DOMException,ATLAS_STATE_DB_NAME:'db-A',actor:'A',contextEpoch:1,atlasWorkspaceActorKey:()=>c.actor,atlasWorkspaceAccess:{controller:new AbortController()},atlasCentralRuntimeMeta:{lastDocumentVersion:1},atlasCentralCanUseDatabase:()=>({ok:true}),atlasCentralAutosaveGateSatisfied:()=>true,getAtlasCentralDocumentKey:()=> 'atlas_dashboard_state_v1',atlasStateGetValue:async k=>records.get(k),atlasStateSetValue:async(k,v)=>records.set(k,v),captureAtlasSaveContext:()=>{const epoch=c.contextEpoch;return()=>epoch===c.contextEpoch;},buildAtlasCentralAppStatePayload:async()=>{calls.build++;await c.afterBuild?.();return {bundle:{sha256:'new',data:'inline'},reconciliation:{},exceptions:[]};},projectionFixture:{ensureWorkspaceProjection:async()=>({status:'complete'})},setAtlasCentralRuntimeMessage:(ok,error)=>messages.push({ok,error}),alert:()=>{},renderTab:()=>{},window:{}};
 c.window.AtlasMigrationArchive={publish:async a=>{calls.parts++;await c.afterParts?.();return a;}};
 c.window.ATLAS_CENTRAL={computeSha256:async()=> 'new-hash',readDocument:async()=>structuredClone(parent),saveDocument:async p=>{assert.equal(p.expectedVersion,parent.version,'A snapshot cannot adopt a newer version while preparing');calls.parent++;parent={version:parent.version+1,payload_hash:'new-hash',payload:p.payload};return structuredClone(parent);}};
 vm.createContext(c);vm.runInContext(fn,c);return{c,calls,messages,setParent:p=>parent=p};
}
(async()=>{
 const a=fixture();let release;const gate=new Promise(r=>release=r);a.c.afterBuild=()=>gate;
 const first=a.c.saveAtlasCentralAppState({silent:true}),second=a.c.saveAtlasCentralAppState({silent:true});
 await new Promise(setImmediate);assert.equal(a.calls.build,1,'Overlapping saves must not start another snapshot operation');release();assert.deepEqual(await Promise.all([first,second]),[true,false]);assert.equal(a.calls.parent,1);assert.equal(a.calls.parts,1);
 const b=fixture();b.c.afterBuild=()=>{b.c.atlasCentralRuntimeMeta.lastDocumentVersion=2;b.setParent({version:2,payload_hash:'other',payload:{bundle:{sha256:'other'}}});};
 assert.equal(await b.c.saveAtlasCentralAppState({silent:true}),false,'A late older snapshot must not overwrite a newly observed version');assert.equal(b.calls.parent,0);assert.match(b.messages.at(-1).error,/changed from version 1 to 2/);
 const d=fixture();d.c.afterBuild=()=>{d.c.contextEpoch++;};assert.equal(await d.c.saveAtlasCentralAppState({silent:true}),false);assert.equal(d.calls.parts,0);assert.equal(d.calls.parent,0);assert.equal(d.messages.length,0,'Obsolete completion cannot repaint a different workspace');
 const e=fixture();e.c.afterParts=()=>{e.c.contextEpoch++;};assert.equal(await e.c.saveAtlasCentralAppState({silent:true}),false);assert.equal(e.calls.parent,0);
 const queueStart=source.indexOf('function queueAtlasCentralDocumentPush('),queueEnd=source.indexOf('\nfunction getAtlasAccessStatusBadge',queueStart);
 assert(queueStart>=0&&queueEnd>queueStart);
 const q={suppressAtlasCentralAutosave:false,atlasCentralDocumentPushTimer:null,epoch:1,timers:new Map(),nextTimer:0,getAtlasCentralStatus:()=>({configured:true,signedIn:true,autosave:true}),captureAtlasSaveContext:()=>{const epoch=q.epoch;return()=>epoch===q.epoch;},setTimeout:fn=>{const id=++q.nextTimer;q.timers.set(id,fn);return id;},clearTimeout:id=>q.timers.delete(id),saveAtlasCentralAppState:()=>{q.writes++;},writes:0};
 vm.createContext(q);vm.runInContext(source.slice(queueStart,queueEnd),q);
 const fire=()=>{const next=[...q.timers][0];assert(next);q.timers.delete(next[0]);next[1]();};
 let finish;q.saveAtlasCentralAppState.inFlight=new Promise(r=>finish=r);q.queueAtlasCentralDocumentPush();fire();assert.equal(q.writes,0);q.saveAtlasCentralAppState.inFlight=null;finish(true);await new Promise(setImmediate);assert.equal(q.timers.size,1);fire();assert.equal(q.writes,1,'An edit during an ongoing save schedules one fresh save after success');
 q.saveAtlasCentralAppState.inFlight=Promise.resolve(false);q.queueAtlasCentralDocumentPush();fire();await new Promise(setImmediate);assert.equal(q.timers.size,0,'Failed or uncertain saves do not cause automatic write retries');
 q.saveAtlasCentralAppState.inFlight=null;q.queueAtlasCentralDocumentPush();q.epoch++;fire();assert.equal(q.writes,1,'Queued saves do not cross a changed workspace');
 console.log('PASS Central Save concurrency: one overlapping save, snapshot-bound revision, and invalidated-context completions cannot overwrite current state.');
})().catch(e=>{console.error(e);process.exitCode=1;});
