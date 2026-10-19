const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../docs/portfolio-operations-dashboard/workspace-core.js'),'utf8');
const script=source.slice(source.indexOf('let atlasArchiveUiProgress = null;'),source.indexOf('\nfunction disableAtlasLegacySharedBundle()'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const bundle=()=>({sha256:'a'.repeat(64),recordCount:64});
const verified=()=>({passed:true,archiveSha256:bundle().sha256,recordsRestored:65});
function fixture(){
 const nodes=[{textContent:'',hidden:true,attributes:{},setAttribute(k,v){this.attributes[k]=v;}}],buttons=[{disabled:false}],stats={builds:0,verifications:0,downloads:0,renders:0,alerts:[]};
 const c={Date,Promise,DOMException,current:true,context:'same',atlasCentralRuntimeMeta:{rollbackTestedAt:'old-check'},JSZip:{},document:{querySelectorAll:selector=>selector==='[data-atlas-archive-progress]'?nodes:buttons},escapeHtml:value=>String(value).replace(/</g,'&lt;'),captureAtlasAuxiliaryContext:()=>({current:()=>c.current}),getAtlasRenderContextKey:()=>c.context,renderTab:()=>stats.renders++,setAtlasCentralRuntimeMessage:(message,error='')=>Object.assign(c.atlasCentralRuntimeMeta,{lastMessage:message,lastError:error}),alert:message=>stats.alerts.push(message),downloadAtlasJsonFile:()=>{stats.downloads++;if(c.downloadError)throw Error('download failed');}};
 c.window={AtlasFeatures:{load:async()=>{}},AtlasMigrationArchive:{verifyRestore:async(bundle,zip,options)=>{stats.verifications++;c.verifyOptions=options;return c.verify?c.verify(options):verified();}}};
 c.verifyAtlasTypedRollbackArchive=async(archive,options)=>c.window.AtlasMigrationArchive.verifyRestore(archive,{},options);
 c.buildAtlasCentralAppStatePayload=async options=>{stats.builds++;c.buildOptions=options;return c.build?c.build(options):{bundle:bundle(),reconciliation:{}};};
 vm.createContext(c);vm.runInContext(script,c);return{c,stats,nodes,buttons};
}
test('duplicate rollback clicks share one task, actual progress avoids rerenders and gate waits for verified download',async()=>{
 const f=fixture(),build=deferred(),verify=deferred();f.c.build=()=>build.promise;f.c.verify=()=>verify.promise;
 const a=f.c.testAtlasCentralRollbackSnapshot(),b=f.c.testAtlasCentralRollbackSnapshot();assert.equal(a,b);await tick();
 assert.equal(f.stats.builds,1);assert.equal(f.c.atlasCentralRuntimeMeta.rollbackTestedAt,'');assert.equal(f.buttons[0].disabled,true);
 const renders=f.stats.renders;f.c.buildOptions.onProgress({phase:'downloading',completed:2,total:614});
 assert.match(f.nodes[0].textContent,/2 of 614 completed/);assert.equal(f.stats.renders,renders);assert(!f.nodes[0].textContent.includes('%'));
 f.c.buildOptions.onProgress({phase:'retaining',completed:3});assert.match(f.nodes[0].textContent,/3 completed; total not yet known/);
 f.c.buildOptions.onProgress({phase:'downloading',completed:615,total:614});assert(!f.nodes[0].textContent.includes('615'));
 build.resolve({bundle:bundle(),reconciliation:{}});await tick();assert.equal(f.c.atlasCentralRuntimeMeta.rollbackTestedAt,'');assert.equal(f.stats.downloads,0);
 f.c.verifyOptions.onProgress({phase:'verifying',completed:64,total:65});assert.match(f.nodes[0].textContent,/64 of 65 completed/);
 verify.resolve(verified());assert.equal(await a,true);assert.equal(f.stats.downloads,1);assert(f.c.atlasCentralRuntimeMeta.rollbackTestedAt);assert.equal(f.buttons[0].disabled,false);assert.match(f.nodes[0].textContent,/Complete/);
});
test('failed or incomplete verification keeps gate closed and permits a new retry',async()=>{
 for(const mode of ['throw','incomplete','wrong-hash','partial-count','extra-count','download']){
  const f=fixture();if(mode==='throw')f.c.verify=()=>{throw Error('part damaged');};if(mode==='incomplete')f.c.verify=()=>({...verified(),passed:false});if(mode==='wrong-hash')f.c.verify=()=>({...verified(),archiveSha256:'b'.repeat(64)});if(mode==='partial-count')f.c.verify=()=>({...verified(),recordsRestored:64});if(mode==='extra-count')f.c.verify=()=>({...verified(),recordsRestored:66});if(mode==='download')f.c.downloadError=true;
  assert.equal(await f.c.testAtlasCentralRollbackSnapshot(),false);assert.equal(f.c.atlasCentralRuntimeMeta.rollbackTestedAt,'');assert.equal(f.buttons[0].disabled,false);assert.match(f.nodes[0].textContent,/stopped:/);assert.equal(f.stats.alerts.length,1);assert.equal(f.stats.downloads,mode==='download'?1:0);
  f.c.verify=null;f.c.downloadError=false;assert.equal(await f.c.testAtlasCentralRollbackSnapshot(),true);assert.equal(f.stats.builds,2);assert(f.c.atlasCentralRuntimeMeta.rollbackTestedAt);
 }
});
test('workspace change suppresses late progress, download, success stamp and new-context errors',async()=>{
 const f=fixture(),build=deferred();f.c.build=()=>build.promise;
 const task=f.c.testAtlasCentralRollbackSnapshot();await tick();const text=f.nodes[0].textContent;
 f.c.context='different';f.c.buildOptions.onProgress({phase:'downloading',completed:614,total:614});assert.equal(f.nodes[0].textContent,text);
 build.resolve({bundle:bundle(),reconciliation:{}});assert.equal(await task,false);assert.equal(f.stats.verifications,0);assert.equal(f.stats.downloads,0);assert.equal(f.c.atlasCentralRuntimeMeta.rollbackTestedAt,'');assert.equal(f.stats.alerts.length,0);
 assert.equal(f.c.testAtlasCentralRollbackSnapshot.inFlight,null);
});
test('independent hydration reports completion or error without satisfying rollback gate',()=>{
 const f=fixture();f.c.atlasCentralRuntimeMeta.rollbackTestedAt='';
 f.c.updateAtlasArchiveProgress({phase:'downloading',completed:1,total:614});assert.match(f.nodes[0].textContent,/Original import evidence: Downloading source parts/);
 f.c.updateAtlasArchiveProgress({phase:'complete',completed:614,total:614});assert.equal(f.nodes[0].attributes['aria-busy'],'false');assert.equal(f.c.atlasCentralRuntimeMeta.rollbackTestedAt,'');
 f.c.updateAtlasArchiveProgress({phase:'retaining',completed:1,total:63});f.c.updateAtlasArchiveProgress({phase:'failed',error:'storage full'});assert.match(f.nodes[0].textContent,/storage full/);assert.equal(f.nodes[0].attributes['aria-busy'],'false');assert.equal(f.c.atlasCentralRuntimeMeta.rollbackTestedAt,'');
});
test('source replay during restore prevents a stale success receipt',async()=>{
 const f=fixture(),verify=deferred();f.c.verify=()=>verify.promise;
 const task=f.c.testAtlasCentralRollbackSnapshot();await tick();assert.equal(f.stats.verifications,1);
 f.c.window.AtlasReplayGeneration=1;assert.equal(f.c.verifyOptions.isCurrent(),false);
 verify.resolve(verified());assert.equal(await task,false);
 assert.equal(f.stats.downloads,0);assert.equal(f.c.atlasCentralRuntimeMeta.rollbackTestedAt,'');
});
