const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const extract=name=>core.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^\\}','m'))[0];
function fixture(){
 const c={console,setTimeout,Promise};vm.createContext(c);vm.runInContext(`
 let atlasDashboardInitializationComplete=true,atlasHomeRenderPreparation=null,context='actor-a|Home',activeTab=0,reads=0,renders=0,blocked=false,allowed=true;
 const atlasWorkspaceAccess={epoch:1,validated:true,hasData:true};
 const deferred=[];const window={AtlasReskin:{prepareInitialHome(options){reads++;return new Promise((resolve,reject)=>deferred.push({resolve,reject,options}));}}};
 const getAtlasRenderContextKey=()=>context,shouldRenderAtlasWelcomeDashboard=()=>activeTab===0;
 const shouldBlockAtlasSensitiveAccess=()=>blocked,atlasAccessDecision=()=>({ok:allowed}),getAtlasCentralStatus=()=>({configured:true});
 const escapeHtml=value=>String(value).replaceAll('<','&lt;');
 const panel={dataset:{},attributes:{},style:{},innerHTML:'previous private content',setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];}};
 const bodyClasses=new Set();const document={body:{classList:{contains:key=>bodyClasses.has(key),add:key=>bodyClasses.add(key),remove:key=>bodyClasses.delete(key)}},getElementById:key=>key==='tab-panel-0'?panel:null,querySelector:()=>null,querySelectorAll:()=>[panel]};const DEFAULT_CURRENT_MONTH=8,FULL_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep'];
 function renderTab(){renders++;delete panel.dataset.atlasHomePreparing;panel.removeAttribute('aria-busy');panel.innerHTML='Complete fresh Home';}
 `,c);vm.runInContext(extract('renderAtlasHomePreparationError')+'\n'+extract('prepareAtlasHomeRender'),c);return c;
}
(async()=>{
 let c=fixture(),run=code=>vm.runInContext(code,c);
 run('prepareAtlasHomeRender(panel);prepareAtlasHomeRender(panel)');
 assert.equal(run('reads'),1,'Unrelated rerenders reuse pending preparation in the same context');
 assert.equal(run('panel.dataset.atlasHomePreparing'),'1');assert.equal(run('panel.attributes["aria-busy"]'),'true');
 assert.match(run('panel.innerHTML'),/Loading/);assert.doesNotMatch(run('panel.innerHTML'),/private/);assert.equal(run('renders'),0,'Placeholder is not a completed Home render');
 await run('deferred[0].resolve(true);atlasHomeRenderPreparation.task');
 assert.equal(run('renders'),1);assert.equal(run('panel.dataset.atlasHomePreparing'),undefined);assert.equal(run('panel.attributes["aria-busy"]'),undefined);
 for(const mutation of ['context="actor-b|Home"','activeTab=8','atlasWorkspaceAccess.epoch++','atlasWorkspaceAccess.validated=false','atlasWorkspaceAccess.hasData=false','blocked=true','allowed=false']){
  c=fixture();run('prepareAtlasHomeRender(panel)');run(mutation);assert.equal(run('deferred[0].options.current()'),false,mutation);
  await run('deferred[0].resolve(true);atlasHomeRenderPreparation.task');assert.equal(run('renders'),0,'Stale work cannot paint: '+mutation);assert.equal(run('atlasHomeRenderPreparation'),null,'Cancelled pending slot is released');
 }
 c=fixture();run('prepareAtlasHomeRender(panel)');const old=run('atlasHomeRenderPreparation.task');
 run('context="actor-b|Home";prepareAtlasHomeRender(panel)');const newer=run('atlasHomeRenderPreparation.task');
 run('deferred[0].resolve(true)');await old;assert.equal(run('renders'),0);assert.equal(run('reads'),2);assert.ok(run('atlasHomeRenderPreparation'),'Old completion cannot clear the new task');
 run('deferred[1].resolve(true)');await newer;assert.equal(run('renders'),1);
 c=fixture();run('prepareAtlasHomeRender(panel)');const oldEpoch=run('atlasHomeRenderPreparation.task');run('atlasWorkspaceAccess.epoch++;prepareAtlasHomeRender(panel)');const newEpoch=run('atlasHomeRenderPreparation.task');assert.equal(run('reads'),2,'Same context with a new initialization epoch replaces invalid preparation');run('deferred[0].resolve(true)');await oldEpoch;assert.equal(run('renders'),0);assert.ok(run('atlasHomeRenderPreparation'));run('deferred[1].resolve(true)');await newEpoch;assert.equal(run('renders'),1);
 c=fixture();run('prepareAtlasHomeRender(panel)');await run('deferred[0].reject(new Error("Temporary read failure"));atlasHomeRenderPreparation.task');
 assert.equal(run('panel.attributes["aria-busy"]'),undefined);assert.equal(run('panel.dataset.atlasHomePreparing'),undefined);assert.equal(run('panel.dataset.atlasHomeError'),'1');assert.match(run('panel.innerHTML'),/Temporary read failure/);assert.match(run('panel.innerHTML'),/Retry/);assert.equal(run('renders'),0);
 run('prepareAtlasHomeRender(panel)');await run('deferred[1].resolve(true);atlasHomeRenderPreparation.task');assert.equal(run('renders'),1,'A failed preparation can be retried');assert.equal(run('panel.dataset.atlasHomeError'),undefined);
 c=fixture();run('let attempts=0;renderTab=()=>{renders++;if(++attempts===1)prepareAtlasHomeRender(panel);else{delete panel.dataset.atlasHomePreparing;panel.removeAttribute("aria-busy");panel.innerHTML="Complete fresh Home";}};prepareAtlasHomeRender(panel)');
 await run('deferred[0].resolve(false);atlasHomeRenderPreparation.task');assert.equal(run('reads'),2,'A source-change rejection requests preparation again');assert.equal(run('panel.dataset.atlasHomePreparing'),'1','Retry remains loading rather than publishing old rows');await run('deferred[1].resolve(true);atlasHomeRenderPreparation.task');assert.equal(run('panel.dataset.atlasHomePreparing'),undefined);
 c=fixture();run('prepareAtlasHomeRender(panel)');const priorVisit=run('atlasHomeRenderPreparation.task');run('activeTab=8;context="actor-a|Reports|nav1";activeTab=0;context="actor-a|Home|nav2";prepareAtlasHomeRender(panel)');const returningVisit=run('atlasHomeRenderPreparation.task');run('deferred[0].resolve(true)');await priorVisit;assert.equal(run('renders'),0,'Returning to Home does not revive the prior navigation');run('deferred[1].resolve(true)');await returningVisit;assert.equal(run('renders'),1);
 // Execute the real initial render orchestrator through both initial failure
 // locations, then execute the actual Retry handler from the error markup.
 for(const previouslyReady of [false,true]) for(const failAtFinalRender of [false,true]) {
  c=fixture();vm.runInContext(extract('renderAtlasStartupLoadingState')+'\n'+extract('finishAtlasStartupLoadingState')+'\n'+extract('runAtlasInitialRenderPassYielding'),c);
  run(`atlasDashboardInitializationComplete=${previouslyReady};let backgroundStarts=0,initializations=0,firstPaint=true;panel.dataset.atlasHomeError='1';
   const runAtlasStartupStep=(label,fn)=>fn(),syncSharedPeopleAssignments=()=>{},syncAllCommunityStaffingFromPeopleRoster=()=>{},loadPropertyData=()=>{},getProp=()=>({name:'Synthetic'}),renderPropGrid=()=>{};
   renderTab=()=>{renders++;if(firstPaint && ${failAtFinalRender}){firstPaint=false;prepareAtlasHomeRender(panel);}else{delete panel.dataset.atlasHomePreparing;delete panel.dataset.atlasHomeError;panel.removeAttribute('aria-busy');panel.innerHTML='Complete fresh Home';}};
   async function initializeAtlasDashboard(){initializations++;renderAtlasStartupLoadingState();const ready=await runAtlasInitialRenderPassYielding(()=>true);if(ready)backgroundStarts++;return ready;}
  `);
  const initial=run('initializeAtlasDashboard()');assert.equal(run('panel.dataset.atlasHomeError'),undefined,'Real startup clears the previous failure marker');assert.equal(run('document.body.classList.contains("atlas-is-initializing")'),true);
  const until=async expression=>{for(let i=0;i<100;i++){if(run(expression))return;await new Promise(resolve=>setTimeout(resolve,1));}throw Error('Pending startup did not reach '+expression);};
  await until('deferred.length===1');
  if(failAtFinalRender){run('deferred[0].resolve(true)');await until('deferred.length===2');run('deferred[1].reject(new Error("Initial preparation failed"))');}
  else run('deferred[0].reject(new Error("Initial preparation failed"))');
  assert.equal(await initial,false);assert.equal(run('atlasDashboardInitializationComplete'),previouslyReady,'Preserve shared auth-recovery readiness lifecycle');assert.equal(run('backgroundStarts'),0);assert.equal(run('document.body.classList.contains("atlas-is-initializing")'),true);
  const handler=run('panel.innerHTML').match(/onclick="([^"]+)"/)[1];assert.equal(handler,'initializeAtlasDashboard()');const retry=run(handler);
  await until(`deferred.length===${failAtFinalRender?3:2}`);run(`deferred[${failAtFinalRender?2:1}].resolve(true)`);
  assert.equal(await retry,true);assert.equal(run('initializations'),2);assert.equal(run('atlasDashboardInitializationComplete'),true);assert.equal(run('document.body.classList.contains("atlas-is-initializing")'),false);assert.equal(run('backgroundStarts'),1);assert.equal(run('panel.dataset.atlasHomeError'),undefined);
 }
 const runner=fs.readFileSync(__dirname+'/performance/workspace-replay-benchmark.mjs','utf8');
 assert.ok((runner.match(/dataset\.atlasHomePreparing!==\x271\x27/g)||[]).length>=2,'Both startup and navigation measurements exclude the Home loading marker');
 assert.match(runner,/!document.body.classList.contains\('atlas-is-initializing'\)/,'Measured startup readiness excludes the real loading state even during reinitialization');
 assert.ok((runner.match(/Home preparation failed;/g)||[]).length>=2,'Preparation errors fail both measurements instead of counting as usable');
 assert.match(extract('renderAtlasWelcomeDashboard'),/home\(\{preparedOnly:true\}\)/);
 assert.match(extract('renderTab'),/error\?\.code === "ATLAS_HOME_PREPARATION_REQUIRED"/);
 console.log('PASS Home navigation pending deduplication, truthful loading, final paint, actor/access/epoch/navigation cancellation, old completion isolation, failure cleanup and retry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
