const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('docs/portfolio-operations-dashboard/workspace-core.js','utf8');
const reports=fs.readFileSync('docs/portfolio-operations-dashboard/features/reports-workspace.js','utf8');
const extract=(source,name)=>source.match(new RegExp('^function '+name+'\\([^]*?^\\}','m'))[0];
function fixture({timeStep=0}={}){
 let clock=0;
 const yields=[],calls=[],panel={dataset:{},innerHTML:'',setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}};
 const c={console,DOMException,Map,Symbol,Date,Promise,setTimeout,performance:{now:()=>clock+=timeStep},activeTab:8,reportHubType:'community_progress',ATLAS_STATE_DB_NAME:'db-a',atlasWorkspaceAccess:{epoch:1,validated:true,hasData:true},source:{value:0,nullable:null},actor:'a',access:'all',navigation:1,period:'2026-09',selection:['One','Two'],calls,panel,window:null};c.window=c;
 Object.assign(c,{getAtlasCentralStatus:()=>({configured:true,clientUnavailable:c.clientUnavailable}),shouldBlockAtlasSensitiveAccess:()=>Boolean(c.blocked),atlasAccessDecision:()=>({ok:!c.denied}),COMMUNITY_PROGRESS_TREND_DETAIL_OPTIONS:Object.freeze({includeRecommendations:false}),buildCommunityDetailForMonth:()=>({summary:{}}),getAtlasRenderContextKey:()=>[c.actor,c.access,c.navigation,c.activeTab].join('|'),getCommunityProgressReportCommunityNames:()=>c.selection.slice(),getReportHubMonthIndex:()=>Number(c.period.slice(5))-1,getReportHubYear:()=>Number(c.period.slice(0,4)),getPersistedCommunityRecordForScope:name=>({name,value:c.source.value,nullable:c.source.nullable}),buildCommunityProgressSingleReportData:({communityName,record})=>{calls.push(['child',communityName,record.value]);if(c.fail==='child')throw Error('synthetic');return {name:communityName,value:record.value,nullable:record.nullable};},assembleCommunityProgressReportData:children=>{calls.push(['aggregate']);if(c.fail==='aggregate')throw Error('synthetic');return {children};},renderCommunityProgressWorkspaceFromReport:report=>{calls.push(['html']);if(c.fail==='html')throw Error('synthetic');return JSON.stringify(report);},renderCommunityProgressReportingWorkspace:()=>{calls.push(['public']);return 'synchronous-public';}});
 vm.createContext(c);
 vm.runInContext(extract(core,'withAtlasSynchronousReadScope')+'\n'+extract(core,'atlasSynchronousReadValue')+'\nlet atlasSynchronousReadScope=null;',c);
 vm.runInContext(reports.slice(0,reports.indexOf('function atlasReportPortfolioDetails')),c);
 c.atlasReportPreviewContext=()=>[c.actor,c.access,c.period,c.selection.join(',')].join('|');
 c.atlasCommunityProgressPreviewInputs=()=>{calls.push(['key']);return JSON.stringify([c.actor,c.access,c.period,c.selection,c.source]);};
 c.atlasReportYieldTask=()=>{assert.equal(vm.runInContext('atlasReportRenderContext',c),null,'Reports memo must end before yield');assert.equal(vm.runInContext('atlasSynchronousReadScope',c),null,'Access memo must end before yield');return new Promise(resolve=>yields.push(resolve));};
 c.atlasCommitPreparedReport=(request,html)=>{panel.innerHTML=html;c.atlasClearReportBusy(request);delete panel.dataset.atlasReportsError;};
 c.renderTab=()=>{
  c.atlasCancelStaleReportPreparation();
  if(c.activeTab!==8)return;
  try {const html=c.withAtlasSynchronousReadScope(()=>{const previous=vm.runInContext('atlasReportRenderContext',c);vm.runInContext('atlasReportRenderContext=new Map();atlasReportVisibleRender=true',c);try{return c.renderCommunityProgressReportingWorkspace();}finally{c.previous=previous;vm.runInContext('atlasReportRenderContext=previous;atlasReportVisibleRender=false',c);}});panel.innerHTML=html;const request=vm.runInContext('atlasReportPreparation',c);if(request&&html.includes(request.placeholder)){request.shellHtml=html;c.atlasPrepareVisibleReport(panel,{request});}else{delete panel.dataset.atlasReportsPreparing;delete panel.dataset.atlasReportsError;}}
  catch(error){if(error.code!=='ATLAS_REPORT_PREPARATION_REQUIRED')throw error;c.atlasPrepareVisibleReport(panel,error);}
 };
 async function step(){assert(yields.length,'Expected a real task boundary');yields.shift()();for(let i=0;i<8;i++)await Promise.resolve();}
 async function drain(){for(let i=0;i<30&&yields.length;i++)await step();assert(!yields.length);}
 return {c,panel,calls,yields,step,drain,state:()=>vm.runInContext('atlasReportPreparation',c),preview:()=>vm.runInContext('atlasCommunityProgressPreview',c)};
}
(async()=>{
 {
  const f=fixture();assert.equal(f.c.renderCommunityProgressReportingWorkspace(),'synchronous-public');assert.equal(f.yields.length,0,'Public calls stay synchronous');
  // Discard the synthetic public cache, then exercise the actual staged controller.
  vm.runInContext('atlasCommunityProgressPreview=null',f.c);f.c.renderTab();assert.equal(f.panel.dataset.atlasReportsPreparing,'1');assert.equal(f.state().children.length,2);assert(!f.preview());
  const request=f.state();f.c.renderTab();assert.equal(f.state(),request);assert.equal(f.calls.filter(x=>x[0]==='child').length,2,'Pending renders do not duplicate children');
  await f.drain();assert.equal(f.panel.innerHTML,JSON.stringify({children:[{name:'One',value:0,nullable:null},{name:'Two',value:0,nullable:null}]}));assert(!f.panel.dataset.atlasReportsPreparing);assert.equal(f.state(),null);
 }
 for(const change of [f=>f.c.source.value=9,f=>f.c.source.nullable=0]){
  const f=fixture();f.c.renderTab();change(f);await f.step();assert(!f.preview(),'Changed in-place input cannot publish');await f.drain();assert(f.preview());const result=JSON.parse(f.panel.innerHTML);assert(result.children.every(x=>x.value===f.c.source.value&&x.nullable===f.c.source.nullable));
 }
 {
  const f=fixture();f.c.renderTab();f.c.source.value=9;await f.step();f.c.source.value=0;await f.drain();assert(JSON.parse(f.panel.innerHTML).children.every(x=>x.value===0),'A→B→A discards the mixed request');assert.equal(f.calls.filter(x=>x[0]==='aggregate').length,1,'B never reaches aggregate');
 }
 {
  const f=fixture({timeStep:25});f.c.selection=Array.from({length:8},(_,i)=>'Community '+i);f.c.renderTab();
  assert.equal(f.state().index,1,'Initial synchronous work is bounded');await f.step();
  assert(f.state().index>1&&f.state().index<8,'Exercise an actual intermediate child batch');
  f.c.source.value=17;await f.drain();
  assert.equal(JSON.parse(f.panel.innerHTML).children.length,8);
  assert(JSON.parse(f.panel.innerHTML).children.every(row=>row.value===17),'No early child survives an in-place change between child batches');
 }
 for(const mutate of [c=>c.actor='b',c=>c.access='restricted',c=>c.period='2025-01',c=>c.selection=['Two'],c=>c.ATLAS_STATE_DB_NAME='db-b',c=>c.atlasWorkspaceAccess.epoch++,c=>c.activeTab=2,c=>c.atlasWorkspaceAccess.validated=false,c=>c.atlasWorkspaceAccess.hasData=false,c=>c.clientUnavailable=true,c=>c.denied=true,c=>c.blocked=true]){
  const f=fixture();f.c.renderTab();mutate(f.c);await f.drain();assert(!f.preview(),'A stale context never publishes');assert.equal(f.calls.filter(x=>x[0]==='aggregate').length,0);
 }
 {
  const f=fixture();f.c.renderTab();const old=f.state();f.c.navigation++;f.c.renderTab();const next=f.state();assert.notEqual(old,next);await f.step();assert.equal(f.state(),next,'Old finally cannot clear the replacement');await f.drain();assert(f.preview());
 }
 for(const phase of ['child','aggregate','html']){
  const f=fixture();f.c.fail=phase;f.c.renderTab();for(let i=0;i<8;i++)await Promise.resolve();await f.drain();assert.equal(f.panel.dataset.atlasReportsError,'1');assert(!f.panel.dataset.atlasReportsPreparing);assert(!f.preview());f.c.fail=null;f.c.renderTab();await f.drain();assert(f.preview(),'Retry recovers from '+phase);assert(!f.panel.dataset.atlasReportsError);
 }
 const runner=fs.readFileSync('tools/performance/workspace-replay-benchmark.mjs','utf8');
 const predicate=runner.match(/page\.waitForFunction\((tab=>\{const panel=document\.getElementById\('tab-panel-'\+tab\);[^]*?\}),tab,\{timeout:30000\}\)/)[1];
 let textReads=0;const p={dataset:{atlasReportsPreparing:'1'},get innerText(){textReads++;return this.text||'Preparing your current report…';}},r={activeTab:8,document:{getElementById:()=>p}};vm.createContext(r);const ready=vm.runInContext('('+predicate+')',r);assert.equal(ready(8),false,'Busy Reports cannot count as usable');assert.equal(textReads,0,'Readiness must not force layout while work is pending');p.dataset={atlasReportsError:'1'};assert.throws(()=>ready(8),/Reports preparation failed/);p.dataset={};p.text='Exact finished report';assert.equal(ready(8),true);
 console.log('PASS staged Reports: original public path, exact/null/zero output, each-chunk in-place and ABA checks, actor/access/period/DB/navigation rejection, dedup, old-finally isolation, failure/retry and truthful benchmark readiness.');
})().catch(error=>{console.error(error);process.exitCode=1;});
