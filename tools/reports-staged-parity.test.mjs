import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {digest,verifyProjection,accessNamespace,projectionKey} from '../docs/portfolio-operations-dashboard/features/workspace-bootstrap.mjs';
import {projectCurrentHistory} from '../docs/portfolio-operations-dashboard/features/import-history-store.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const root=path.resolve('docs/portfolio-operations-dashboard');
const actor='11111111-1111-4111-8111-111111111111',community='22222222-2222-4222-8222-222222222222';
const roster=[{community_id:community,display_name:'Doro',canonical_name:'Doro',status:'active'},{community_id:'33333333-3333-4333-8333-333333333333',display_name:'Anthem House',canonical_name:'Anthem House',status:'active'}];
let profile={user_id:actor,email:'test@risere.com',display_name:'Synthetic admin',role:'admin',status:'active',allowed_community_ids:[],allowed_market_values:[],allowed_region_values:[],locked_tab_ids:[],locked_page_keys:[],community_access_records:roster};
const source={documentKey:'atlas_dashboard_state_v1',version:7,archiveHash:'a'.repeat(64),effectiveAt:'2026-09-24T12:00:00Z'};
const monthlyData=Array.from({length:12},(_,i)=>({month:i,occupiedSnapshot:0,snapshotVerified:true,leasedSnapshot:0,leasedSnapshotVerified:true,rentableUnits:247,moveIns:0,moveOuts:0,guestCards:0}));
const history={batches:[],sourceArchive:[],canonicalRecords:[],lineage:[],reconciliationLog:[]};
const importState=projectCurrentHistory(history);importState.historyStorage={...importState.historyStorage,view:'remote',archiveHash:source.archiveHash,parentDocument:source.documentKey,version:source.version};
const body={format:1,source,communityData:{Doro:{propertyName:'Doro',communityId:community,customUnits:247,communityStatus:'active',reportYear:2026,currentMonth:8,currentOccupied:0,currentLeased:0,monthlyData}},opsGlobalData:{portfolioMonthScopeByPeriod:{'2026-09':['Doro']}},importState};
body.communityData['Anthem House']={...body.communityData.Doro,propertyName:'Anthem House',communityId:roster[1].community_id};
body.opsGlobalData.portfolioMonthScopeByPeriod['2026-09']=['Doro','Anthem House'];
const projection={...body,contentHash:await digest(body)};
await verifyProjection(projection,source);
await assert.rejects(verifyProjection({...projection,communityData:{}},source),/fingerprint/);
await assert.rejects(verifyProjection(projection,{...source,version:8}),/current central/);
const namespaceProfile={...profile,access_backend:'https://rmyhmvjcswfwaracgriy.supabase.co',access_verified_at:new Date().toISOString()};
const client={getSession:()=>({user:{id:actor}}),getConfig:()=>({supabaseUrl:namespaceProfile.access_backend})};
const namespace=await accessNamespace(client,namespaceProfile);
assert.notEqual(namespace,await accessNamespace(client,{...namespaceProfile,allowed_community_ids:[community]}));
const server=http.createServer((req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':/\.(mjs|js)$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.stack||e.message));
 let sourceUnavailable=false,profileUnavailable=false,profileGate=null;
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===origin){requests.push(url.pathname);return route.continue();}
  if(url.pathname.startsWith('/rest/v1/')){
   requests.push(url.pathname);
   if(request.method()!=='GET'&&!/\/rpc\/(atlas_read_|atlas_get_|atlas_directory|atlas_bonus_workspace)/.test(url.pathname))return route.fulfill({status:403,json:{message:'Synthetic test blocks writes'}});
   let value=[];
   if(url.pathname.endsWith('/atlas_user_profiles')){if(profileGate)await profileGate.promise;if(profileUnavailable)return route.fulfill({status:503,json:{message:'Synthetic access read unavailable'}});value=[profile];}
   if(url.pathname.endsWith('/atlas_communities'))value=roster;
   if(url.pathname.endsWith('/rpc/atlas_read_workspace_projection')){
    if(sourceUnavailable)return route.abort();
    value={status:'available',source,projection,scopeFingerprint:(profile.user_id===actor?'c':'d').repeat(64),projectionVersion:1,projectionContentHash:'e'.repeat(64),projectionHashFormat:'postgres-jsonb-sha256',fullProjection:true};
   }
   if(url.pathname.endsWith('/atlas_app_documents')){
    if(sourceUnavailable)return route.abort();
    const key=url.searchParams.get('document_key')?.slice(3);
    if(key===source.documentKey)value=[{document_key:key,version:source.version,updated_at:source.effectiveAt,payload:{bundle:{bundleType:'atlas_migration_archive_v1',sha256:source.archiveHash}}}];
    if(key===projectionKey(source))value=[{document_key:key,payload:projection}];
   }
   if(url.pathname.endsWith('/atlas_user_dashboard_views'))await new Promise(r=>setTimeout(r,1500));
   return route.fulfill({json:value,headers:{'access-control-allow-origin':'*'}});
  }
  return route.fulfill({body:'',status:200});
 });
 await page.addInitScript(({actor,profile,namespace})=>{
  localStorage.setItem('atlas_central_auth_session_v1',JSON.stringify({access_token:'synthetic-test-only',refresh_token:'synthetic-test-only',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:actor,email:profile.email}}));
  localStorage.setItem('atlas_central_profile_v1',JSON.stringify(profile));
  localStorage.setItem(namespace+':atlas_dashboard_preferences_v1',JSON.stringify({hasSeenWelcome:true}));
 },{actor,profile,namespace});
 await page.goto(origin+'/index.html?atlasPerf=1');
 await page.waitForFunction(()=>atlasDashboardInitializationComplete&&atlasWorkspaceAccess.hasData,{},{timeout:15000}).catch(async error=>{console.log('DEBUG',await page.evaluate(()=>({state:typeof atlasWorkspaceAccess==='undefined'?null:atlasWorkspaceAccess,error:document.body.innerText.slice(-2000)})),errors);throw error;});


 await page.evaluate(()=>{
  const NativeDate=Date,fixedNow=NativeDate.now();
  window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixedNow]));}static now(){return fixedNow;}};
 });
 await page.evaluate(()=>setTab(8));
 const ready=()=>page.waitForFunction(()=>{const panel=document.getElementById('tab-panel-8');if(panel?.dataset.atlasReportsError==='1')throw Error('Preparation failed');return window.AtlasReports&&panel&&panel.dataset.atlasReportsPreparing!=='1'&&!panel.innerText.includes('Loading this workspace');});
 await ready();
 let count=0;
 for(const year of [2025,2026,2027])for(const selection of [[],['Doro'],['Doro','Anthem House']]){
  const expected=await page.evaluate(({year,selection})=>{
   for(const name of ['Doro','Anthem House'])savedData[name]={...savedData[name],monthlyData:Array.from({length:12},()=>({applications:null,tours:0,occupiedSnapshot:0,leasedSnapshot:0})),monthlyHistoryByPeriod:{'2025-01':{applications:0,tours:null,occupiedSnapshot:0},'2026-01':{applications:7,tours:9}},corporateLeaseUnits:12};
   reportHubType='community_progress';reportHubYear=year;reportHubMonth=0;reportHubCommunityProgressCommunities=selection;communityProgressViewMode='preview';
   atlasCommunityProgressPreview=null;
   const before=JSON.stringify(savedData),report=buildCommunityProgressReportData({silent:true}),html=renderCommunityProgressWorkspaceFromReport(report);
   window.__stagedExpectedPayload=JSON.stringify(report);window.__stagedExpectedSource=before;
   renderTab();window.__retainedReportControl=document.querySelector('#tab-panel-8 select');return {html};
  },{year,selection});
  await ready();
  const actual=await page.evaluate(()=>({html:atlasCommunityProgressPreview?.html,sourceUnchanged:JSON.stringify(savedData)===__stagedExpectedSource,exportUnchanged:JSON.stringify(buildCommunityProgressReportData({silent:true}))===__stagedExpectedPayload,headerRetained:__retainedReportControl?.isConnected,domMatches:(()=>{const template=document.createElement('template');template.innerHTML=atlasCommunityProgressPreview?.html||'';return document.querySelector('#reporting-community-progress-workspace')?.outerHTML===template.content.firstElementChild?.outerHTML;})(),busy:document.getElementById('tab-panel-8').dataset.atlasReportsPreparing}));
  assert.equal(actual.html,expected.html,'Complete preview HTML parity year='+year+' count='+selection.length);assert(actual.sourceUnchanged);assert(actual.exportUnchanged,'Synchronous export builder unchanged');assert(!actual.busy);assert(actual.headerRetained,'Prepared mount preserves connected report controls');assert(actual.domMatches,'Actually mounted preview matches original full markup');count++;
 }
 // Pause an actual yielded report, mutate the same source object, and prove that
 // only a newly built report is allowed to reach the real Reports DOM/cache.
 await page.evaluate(()=>{
  window.__realReportYield=atlasReportYieldTask;window.__pendingReportYields=[];
  atlasReportYieldTask=()=>new Promise(resolve=>__pendingReportYields.push(resolve));
  reportHubYear=2026;reportHubCommunityProgressCommunities=['Doro','Anthem House'];atlasCommunityProgressPreview=null;renderTab();
  savedData.Doro.monthlyHistoryByPeriod['2026-01'].applications=0;
 });
 assert.equal(await page.getAttribute('#tab-panel-8','aria-busy'),'true');
 for(let i=0;i<15;i++){
  const pending=await page.evaluate(()=>{const resolve=__pendingReportYields.shift();if(resolve)resolve();return Boolean(resolve);});
  await page.evaluate(()=>Promise.resolve());
  if(!pending)break;
 }
 await ready();
 const race=await page.evaluate(()=>{atlasReportYieldTask=__realReportYield;return {html:atlasCommunityProgressPreview?.html,expected:renderCommunityProgressWorkspaceFromReport(buildCommunityProgressReportData({silent:true})),writes:__pendingReportYields.length};});
 assert.equal(race.html,race.expected);assert.equal(race.writes,0);
 // Existing complete srcdocs must remain connected and must not reload when a
 // changed exact input produces the same reviewed output.
 await page.locator('.progress-community-frame iframe').last().scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>[...document.querySelectorAll('.progress-community-frame iframe')].every(frame=>frame.contentDocument?.URL==='about:srcdoc'&&frame.contentDocument.body?.innerText.length>50));
 await page.evaluate(()=>{
  window.__sameFrame=document.querySelector('.progress-community-frame iframe');window.__sameFrameLoads=0;
  __sameFrame.addEventListener('load',()=>__sameFrameLoads++);window.__samePreviewHtml=atlasCommunityProgressPreview.html;
  window.__sameHeader=document.querySelector('#tab-panel-8 select');
  window.__realReportYield=atlasReportYieldTask;window.__pendingReportYields=[];
  atlasReportYieldTask=()=>new Promise(resolve=>__pendingReportYields.push(resolve));
  savedData.Doro.__reportTestMetadata=1;renderTab();
 });
 assert.deepEqual(await page.evaluate(()=>({connected:__sameFrame.isConnected,hidden:__sameFrame.closest('#reporting-inline-preview')?.hidden,inert:__sameFrame.closest('#reporting-inline-preview')?.inert,header:__sameHeader.isConnected,busy:document.getElementById('tab-panel-8').dataset.atlasReportsPreparing})),{connected:true,hidden:true,inert:true,header:true,busy:'1'});
 const resume=async(wait=true)=>{for(let i=0;i<20;i++){const pending=await page.evaluate(()=>{const resolve=__pendingReportYields.shift();if(resolve)resolve();return Boolean(resolve);});await page.evaluate(()=>Promise.resolve());if(!pending)break;}if(wait)await ready();};
 await resume();
 assert.deepEqual(await page.evaluate(()=>({same:document.querySelector('.progress-community-frame iframe')===__sameFrame,loads:__sameFrameLoads,html:atlasCommunityProgressPreview.html===__samePreviewHtml,hidden:__sameFrame.closest('#reporting-inline-preview')?.hidden,inert:__sameFrame.closest('#reporting-inline-preview')?.inert})),{same:true,loads:0,html:true,hidden:false,inert:false});
 await page.evaluate(()=>{savedData.Doro.monthlyHistoryByPeriod['2026-01'].applications=23;renderTab();});
 await resume();
 assert.deepEqual(await page.evaluate(()=>({same:document.querySelector('.progress-community-frame iframe')===__sameFrame,oldConnected:__sameFrame.isConnected,changed:atlasCommunityProgressPreview.html!==__samePreviewHtml})),{same:false,oldConnected:false,changed:true});
 // A failed final builder discards hidden private content and retry starts fresh.
 await page.evaluate(()=>{window.__realReportHtml=renderCommunityProgressWorkspaceFromReport;renderCommunityProgressWorkspaceFromReport=()=>{throw Error('synthetic retained-preview failure');};savedData.Doro.__reportTestMetadata=3;renderTab();});
 await resume(false);
 assert.deepEqual(await page.evaluate(()=>({error:document.getElementById('tab-panel-8').dataset.atlasReportsError,frames:document.querySelectorAll('.progress-community-frame iframe').length})),{error:'1',frames:0});
 await page.evaluate(()=>{renderCommunityProgressWorkspaceFromReport=__realReportHtml;renderTab();});await resume();
 // A→B→A cannot reveal a retained preview after the intermediate context fails.
 await page.evaluate(()=>{window.__realReportContext=getAtlasRenderContextKey;window.__contextSuffix='A';getAtlasRenderContextKey=()=>__realReportContext()+'|'+__contextSuffix;savedData.Doro.__reportTestMetadata=4;renderTab();__contextSuffix='B';});
 await resume(false);
 await page.evaluate(()=>{__contextSuffix='A';});
 assert.equal(await page.evaluate(()=>document.querySelectorAll('.progress-community-frame iframe').length),0);
 await page.evaluate(()=>{getAtlasRenderContextKey=__realReportContext;renderTab();});await resume();
 // Access loss clears retained private DOM; old completion cannot reveal it.
 await page.evaluate(()=>{window.__revokedFrame=document.querySelector('.progress-community-frame iframe');savedData.Doro.__reportTestMetadata=5;renderTab();atlasWorkspaceAccess.epoch++;AtlasReports.cancelStale();});
 assert.equal(await page.evaluate(()=>__revokedFrame.isConnected),false);
 await page.evaluate(()=>{while(__pendingReportYields.length)__pendingReportYields.shift()();atlasReportYieldTask=__realReportYield;});
 await page.evaluate(()=>Promise.resolve());
 assert.equal(await page.evaluate(()=>document.querySelectorAll('.progress-community-frame iframe').length),0);
 assert.deepEqual(errors,[]);
 console.log('PASS actual-page staged Reports: '+count+' exact full HTML/source/export comparisons, single/multiple/empty scopes, prior/current/future sparse months, null/zero/corporate units, in-place changes while yielded, connected iframe identity/load preservation, changed-output replacement, failure/retry, access loss and A→B→A retention discard.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
