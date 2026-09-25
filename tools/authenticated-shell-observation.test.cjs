const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const fn=core.match(/^function recordAtlasAuthenticatedShellPaint\([^]*?^\}/m)[0];
function fixture(){
 const frames=[],marks=new Map(),measures=[];
 const c={epoch:1,actor:'a',access:'scope-a',ATLAS_STATE_DB_NAME:'db-a',loading:false,status:{configured:true,signedIn:true},style:{pointerEvents:'auto',visibility:'visible',display:'flex'},visible:true,time:10,atlasWorkspaceAccess:{epoch:1,validated:true,hasData:true,controller:{signal:{aborted:false}}}};
 c.window={ATLAS_CENTRAL:{getAccessContextKey:()=>c.access}};c.atlasWorkspaceActorKey=()=>c.actor;c.getAtlasCentralStatus=()=>c.status;
 c.document={body:{classList:{contains:()=>c.loading}},getElementById:()=>({getClientRects:()=>c.visible?[{}]:[]})};c.getComputedStyle=()=>c.style;
 c.requestAnimationFrame=fn=>frames.push(fn);c.performance={mark:name=>marks.set(name,c.time),clearMarks:name=>marks.delete(name),clearMeasures:()=>measures.length=0,measure:(name,{start,end})=>measures.push({name,start,duration:marks.get(end)-start})};
 vm.createContext(c);vm.runInContext(fn,c);return {c,frames,measures,step(){c.time+=16;frames.shift()?.();}};
}
let f=fixture();f.c.recordAtlasAuthenticatedShellPaint(1);assert.equal(f.measures.length,0);f.step();assert.equal(f.measures.length,0,'First frame cannot claim an already-painted shell');f.step();assert.deepEqual(f.measures,[{name:'atlas:time-to-authenticated-shell',start:0,duration:42}]);
for(const mutate of [c=>c.loading=true,c=>c.atlasWorkspaceAccess.validated=false,c=>c.atlasWorkspaceAccess.hasData=false,c=>c.status.signedIn=false,c=>c.status.configured=false,c=>c.status.clientUnavailable=true,c=>c.actor='b',c=>c.access='scope-b',c=>c.ATLAS_STATE_DB_NAME='db-b',c=>c.atlasWorkspaceAccess.epoch++,c=>c.atlasWorkspaceAccess.controller.signal.aborted=true,c=>c.style.pointerEvents='none',c=>c.visible=false]){
 f=fixture();f.c.recordAtlasAuthenticatedShellPaint(1);f.step();mutate(f.c);f.step();assert.equal(f.measures.length,0,'Stale, disabled or unauthenticated shell is never measured');
}
f=fixture();f.c.loading=true;f.c.recordAtlasAuthenticatedShellPaint(1);assert.equal(f.frames.length,0,'The startup loading card does not schedule a usable-shell mark');
assert.doesNotMatch(core,/performance\.mark\("atlas:shell:ready"\)/,'Misleading pre-authorization mark is removed');
assert.match(core,/performance\.mark\("atlas:startup-placeholder"\)/);
assert.match(core,/if\(!await runAtlasInitialRenderPassYielding[^]*?recordAtlasAuthenticatedShellPaint\(epoch\)/);
console.log('PASS real interactive shell observed after two frames, navigation-based timing, login/loading exclusion and epoch/actor/access/database/visibility cancellation.');
