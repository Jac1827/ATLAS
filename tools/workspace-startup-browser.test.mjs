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
const roster=[{community_id:community,display_name:'Doro',canonical_name:'Doro',status:'active'}];
let profile={user_id:actor,email:'test@risere.com',display_name:'Synthetic admin',role:'admin',status:'active',allowed_community_ids:[],allowed_market_values:[],allowed_region_values:[],locked_tab_ids:[],locked_page_keys:[],community_access_records:roster};
const source={documentKey:'atlas_dashboard_state_v1',version:7,archiveHash:'a'.repeat(64),effectiveAt:'2026-09-24T12:00:00Z'};
const monthlyData=Array.from({length:12},(_,i)=>({month:i,occupiedSnapshot:0,snapshotVerified:true,leasedSnapshot:0,leasedSnapshotVerified:true,rentableUnits:247,moveIns:0,moveOuts:0,guestCards:0}));
const history={batches:[],sourceArchive:[],canonicalRecords:[],lineage:[],reconciliationLog:[]};
const importState=projectCurrentHistory(history);importState.historyStorage={...importState.historyStorage,view:'remote',archiveHash:source.archiveHash,parentDocument:source.documentKey,version:source.version};
const body={format:1,source,communityData:{Doro:{propertyName:'Doro',communityId:community,customUnits:247,communityStatus:'active',reportYear:2026,currentMonth:8,currentOccupied:0,currentLeased:0,monthlyData}},opsGlobalData:{portfolioMonthScopeByPeriod:{'2026-09':['Doro']}},importState};
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
 profileGate={};profileGate.promise=new Promise(resolve=>profileGate.resolve=resolve);
 await page.goto(origin+'/index.html?atlasPerf=1');
 await page.waitForFunction(()=>performance.getEntriesByName('atlas:startup-placeholder').length>0);
 assert.equal(await page.evaluate(()=>performance.getEntriesByName('atlas:time-to-authenticated-shell').length),0,'A loading shell before current authorization is not interactive');
 profileGate.resolve();profileGate=null;
 await page.waitForFunction(()=>atlasDashboardInitializationComplete&&atlasWorkspaceAccess.hasData,{},{timeout:15000}).catch(async error=>{console.log('DEBUG',await page.evaluate(()=>({state:typeof atlasWorkspaceAccess==='undefined'?null:atlasWorkspaceAccess,error:document.body.innerText.slice(-2000)})),errors);throw error;});
 await page.waitForFunction(()=>performance.getEntriesByName('atlas:time-to-authenticated-shell').length===1);
 const shell=await page.evaluate(()=>({ms:performance.getEntriesByName('atlas:time-to-authenticated-shell').at(-1).duration,readyAt:performance.getEntriesByName('atlas:workspace:ready').at(-1)?.startTime,loading:document.body.classList.contains('atlas-is-initializing'),navigationEnabled:getComputedStyle(document.getElementById('tabs')).pointerEvents!=='none',validated:atlasWorkspaceAccess.validated}));
 assert(shell.ms>=shell.readyAt&&shell.ms>0,'Real shell paint follows the completed workspace, not its loading placeholder');
 assert.deepEqual({loading:shell.loading,navigationEnabled:shell.navigationEnabled,validated:shell.validated},{loading:false,navigationEnabled:true,validated:true});
 const cold=await page.evaluate(()=>({ready:performance.getEntriesByName('atlas:time-to-workspace').at(-1)?.duration,names:Object.keys(savedData),source:atlasWorkspaceAccess.source,history:dataImport2State.historyStorage}));
 assert.deepEqual(cold.names,['Doro'],'canonical community membership does not union bundled seeds');assert.equal(cold.source.version,7);assert.equal(cold.history.view,'remote');
 assert(!requests.some(x=>/reports-workspace|import-workspace|bonus-workspace|admin-workspace|xlsx.full|central-services\.js|historical_restore/.test(x)),'inactive feature modules stay unloaded');
 assert(cold.ready<3000,`synthetic cold workspace budget: ${cold.ready}ms`);
 await page.reload();await page.waitForFunction(()=>atlasDashboardInitializationComplete&&atlasWorkspaceAccess.hasData);
 const warm=await page.evaluate(()=>performance.getEntriesByName('atlas:time-to-workspace').at(-1)?.duration);
 assert(warm<1000,`synthetic warm workspace budget: ${warm}ms`);
 await page.evaluate(()=>setTab(8));await page.waitForFunction(()=>!!window.AtlasReports&&document.querySelector('#tab-panel-8').innerText.length>150).catch(async error=>{console.log('NAV DEBUG',await page.evaluate(()=>({html:document.querySelector('#tab-panel-8').innerText,feature:!!window.AtlasReports,ready:atlasWorkspaceAccess.hasData})),errors);throw error;});
 assert(requests.some(x=>x.includes('reports-workspace')));
 assert.match(await page.locator('#tab-panel-8').innerText(),/Reporting Hub/);
 assert.doesNotMatch(await page.locator('#tab-panel-8').innerText(),/render issue|did not finish loading/);
 const navigation=[];
 for(const [tab,feature,label] of [[7,'importWorkspace',/ATLAS Data Health/],[9,'bonusWorkspace',/Bonus/],[14,'adminWorkspace',/ATLAS Settings/],[15,'centralServices',/Central Services/]]){
  const before=await page.evaluate(()=>window.AtlasPerformance.report().counters.render||0);
  await page.evaluate(tab=>setTab(tab),tab);
  await page.waitForFunction(({tab,feature})=>window.AtlasFeatures.ready(feature)&&!atlasWorkspaceFeature(tab)&&!document.querySelector('#tab-panel-'+tab).innerText.includes('Loading this workspace'),{tab,feature});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const text=await page.locator('#tab-panel-'+tab).innerText();assert.match(text,label);assert.doesNotMatch(text,/render issue|did not finish loading/);
  navigation.push({tab,feature,renders:await page.evaluate(()=>window.AtlasPerformance.report().counters.render||0)-before});
 }
 assert(!requests.some(x=>/xlsx.full|historical_restore/.test(x)),'Workspace navigation does not import workbook parsers or historical seeds');

 // An obsolete storage switch must stop while the prior workspace's queued writes drain.
 const switched=await page.evaluate(async()=>{
  const name=ATLAS_STATE_DB_NAME,previousWrites=atlasStateWritePromise;await previousWrites;
  let release,current=true;atlasStateWritePromise=new Promise(resolve=>release=resolve);
  const pending=switchAtlasWorkspaceStorage('synthetic-obsolete-namespace',()=>current);current=false;release();
  const result=await pending;atlasStateWritePromise=previousWrites;
  return {result,unchanged:ATLAS_STATE_DB_NAME===name};
 });
 assert.deepEqual(switched,{result:false,unchanged:true},'A superseded initializer cannot switch or validate another actor database');
 // The real startup functions receive deliberately out-of-order synthetic central reads.
 const packets=[];
 for(const version of [8,9,10]){
  const identity={...source,version,archiveHash:String(version%10).repeat(64)};
  const value={...structuredClone(body),source:identity};value.communityData.Doro.currentOccupied=version;value.importState.historyStorage={...value.importState.historyStorage,archiveHash:identity.archiveHash,version};
  packets.push({identity,document:{document_key:identity.documentKey,version,updated_at:identity.effectiveAt,payload:{bundle:{bundleType:'atlas_migration_archive_v1',sha256:identity.archiveHash}}},key:projectionKey(identity),projection:{...value,contentHash:await digest(value)}});
 }
 await page.waitForFunction(()=>!atlasCanonicalWorkspacePromise);
 await page.evaluate(async()=>{await atlasStateWritePromise;const source=await atlasStateGetValue('atlas_workspace_source_v2');if(source?.dirty)await withAtlasStateStore('readwrite',store=>store.put({key:'atlas_workspace_source_v2',value:{...source,dirty:false}}));});
 await page.evaluate(packets=>{
  window.__sourceReads={original:ATLAS_CENTRAL.fetchJson,packets,version:8,hold:new Set([8]),pending:new Map()};
  ATLAS_CENTRAL.fetchJson=async function(key,options){
   const test=window.__sourceReads;
   if(key==='/rpc/atlas_read_workspace_projection'){
    const selected=test.packets.find(item=>item.identity.version===test.version);
    if(test.hold.has(selected.identity.version))await new Promise(resolve=>test.pending.set(selected.identity.version,resolve));
    return {status:'available',source:selected.identity,projection:structuredClone(selected.projection),scopeFingerprint:'c'.repeat(64),projectionVersion:1,projectionContentHash:'e'.repeat(64),projectionHashFormat:'postgres-jsonb-sha256',fullProjection:true};
   }
   return test.original.call(this,key,options);
  };
  window.__olderRefresh=refreshAtlasCanonicalWorkspace({force:true}).catch(error=>({error:error.message}));
 },packets);
 await page.waitForFunction(()=>__sourceReads.pending.has(8));
 await page.evaluate(async()=>{__sourceReads.version=9;await refreshAtlasCanonicalWorkspace({force:true});});
 assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.source.version),9);
 await page.evaluate(async()=>{__sourceReads.pending.get(8)();await __olderRefresh;});
 assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.source.version),9,'A late older source cannot replace a newer completed refresh');
 // An edit committed while the projection is pending must win over its earlier clean snapshot.
 await page.evaluate(()=>{__sourceReads.version=10;__sourceReads.hold.add(10);window.__editedRefresh=refreshAtlasCanonicalWorkspace({force:true}).catch(error=>({error:error.message}));});
 await page.waitForFunction(()=>__sourceReads.pending.has(10));
 await page.evaluate(async()=>{savedData.Doro.issue12SyntheticDraft='Unsaved synthetic actor A edit';await atlasStateSetValue(ATLAS_STATE_COMMUNITY_KEY,savedData);});
 await page.evaluate(async()=>{__sourceReads.pending.get(10)();await __editedRefresh;});
 assert.equal(await page.evaluate(()=>savedData.Doro.issue12SyntheticDraft),'Unsaved synthetic actor A edit','Newly saved local changes survive a pending source refresh');
 assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.source.version),9);
 await page.evaluate(()=>{ATLAS_CENTRAL.fetchJson=__sourceReads.original;delete window.__sourceReads;});
 const before=await page.evaluate(()=>JSON.stringify(savedData.Doro.monthlyData));
 await page.evaluate(()=>setTab(0));sourceUnavailable=true;await page.evaluate(()=>refreshAtlasCanonicalWorkspace({force:true}).catch(()=>null));
 assert.equal(await page.evaluate(()=>JSON.stringify(savedData.Doro.monthlyData)),before,'unavailable source cannot mutate operational values');
 // A different actor must pass a new profile barrier and use a separate local database.
 sourceUnavailable=true;
 const actorB='33333333-3333-4333-8333-333333333333';
 const databaseA=await page.evaluate(()=>{dataImportHistoryPages.batches={...dataImportHistoryPages.batches,rows:[{id:'synthetic-private-actor-A-batch'}],revision:1,total:1};return ATLAS_STATE_DB_NAME;});
 profile={...profile,user_id:actorB,email:'second@risere.com',display_name:'Synthetic second admin'};
 profileGate={};profileGate.promise=new Promise(resolve=>profileGate.resolve=resolve);
 await page.evaluate(actorB=>{localStorage.setItem('atlas_central_auth_session_v1',JSON.stringify({access_token:'synthetic-second-only',refresh_token:'synthetic-second-only',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:actorB,email:'second@risere.com'}}));dispatchEvent(new Event('atlas-central-auth-change'));},actorB);
 await page.waitForFunction(()=>!atlasWorkspaceAccess.validated);
 assert.doesNotMatch(await page.locator('body').innerText(),/Unsaved synthetic actor A edit/);
 assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.hasData),false,'New actor cannot view old cached financial workspace before authorization');
 profileGate.resolve();profileGate=null;
 await page.waitForFunction(()=>atlasWorkspaceAccess.validated&&!atlasWorkspaceAccess.hasData&&!!atlasWorkspaceAccess.error);
 await page.evaluate(()=>setTab(14));
 await page.waitForFunction(()=>document.querySelector('#tab-panel-14').innerText.includes('ATLAS Settings'));
 assert.doesNotMatch(await page.locator('#tab-panel-14').innerText(),/Workspace source unavailable|Opening your workspace/,'Freshly verified account Settings remains available when its new actor database has no source');
 assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.hasData),false,'Opening Settings does not mark missing source data as available');
 await page.evaluate(()=>setTab(0));
 assert.match(await page.locator('#tab-panel-0').innerText(),/Workspace source unavailable/,'Settings exception cannot open operational pages without source data');
 sourceUnavailable=false;await page.evaluate(()=>initializeAtlasDashboard());
 await page.waitForFunction(()=>atlasWorkspaceAccess.validated&&atlasWorkspaceAccess.hasData&&atlasDashboardInitializationComplete&&!atlasAccessVerificationPromise);
 assert.notEqual(await page.evaluate(()=>ATLAS_STATE_DB_NAME),databaseA);
 assert.deepEqual(await page.evaluate(()=>dataImportHistoryPages.batches.rows),[],'Second actor cannot inherit a cached page with a coincident revision');
 assert.equal(await page.evaluate(()=>savedData.Doro.issue12SyntheticDraft),undefined,'Second actor never receives first actor local draft');
 assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.source.version),7);
 // Token refresh preserves the workspace; a same-actor scope edit from another tab conceals it immediately.
 const sameActorEpoch=await page.evaluate(()=>atlasWorkspaceAccess.epoch);
 const profileReads=requests.filter(x=>x.endsWith('/atlas_user_profiles')).length;
 await page.evaluate(()=>{const session=JSON.parse(localStorage.getItem('atlas_central_auth_session_v1'));session.access_token='synthetic-token-rotation';localStorage.setItem('atlas_central_auth_session_v1',JSON.stringify(session));dispatchEvent(new StorageEvent('storage',{key:'atlas_central_auth_session_v1'}));});
 assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.epoch),sameActorEpoch);
 assert.equal(requests.filter(x=>x.endsWith('/atlas_user_profiles')).length,profileReads);
 profile={...profile,locked_tab_ids:[8]};profileGate={};profileGate.promise=new Promise(resolve=>profileGate.resolve=resolve);
 await page.evaluate(()=>{performance.clearMeasures('atlas:time-to-authenticated-shell');recordAtlasAuthenticatedShellPaint(atlasWorkspaceAccess.epoch);const next={...JSON.parse(localStorage.getItem('atlas_central_profile_v1')),locked_tab_ids:[8]};localStorage.setItem('atlas_central_profile_v1',JSON.stringify(next));dispatchEvent(new StorageEvent('storage',{key:'atlas_central_profile_v1'}));});
 assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.validated),false,'Same-actor cross-tab scope changes conceal cached panels before the server read');
 assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.hasData),false);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await page.evaluate(()=>performance.getEntriesByName('atlas:time-to-authenticated-shell').length),0,'A queued paint cannot declare the shell usable after access invalidation');
 profileGate.resolve();profileGate=null;await page.waitForFunction(()=>atlasWorkspaceAccess.validated&&atlasWorkspaceAccess.hasData&&atlasDashboardInitializationComplete&&!atlasAccessVerificationPromise);
 assert.equal(await page.evaluate(()=>atlasAccessDecision(8).ok),false,'New page lock is server-verified before rendering');
 // A failed current access read hides data, even when that actor has a valid cache.
 profileUnavailable=true;await page.evaluate(()=>verifyAtlasWorkspaceAccess());
 assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.validated),false);
 assert.match(await page.locator('#tab-panel-0').innerText(),/Workspace source unavailable/);
 await page.evaluate(()=>setTab(14));
 assert.match(await page.locator('#tab-panel-14').innerText(),/Workspace source unavailable/,'Settings exception requires a current successful access check');
 await page.evaluate(()=>setTab(0));
 profileUnavailable=false;await page.evaluate(()=>dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>atlasWorkspaceAccess.validated&&atlasWorkspaceAccess.hasData&&atlasDashboardInitializationComplete&&!atlasAccessVerificationPromise);
 profile={...profile,status:'active',account_status:'reset_required'};await page.evaluate(()=>verifyAtlasWorkspaceAccess());
 assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.validated),false,'An active access row does not bypass account recovery lifecycle');
 assert.equal(await page.evaluate(()=>ATLAS_CENTRAL.getStoredProfile().account_status),'reset_required');
 profile={...profile,account_status:null};await page.evaluate(()=>dispatchEvent(new Event('focus')));await page.waitForFunction(()=>atlasWorkspaceAccess.validated&&atlasWorkspaceAccess.hasData&&atlasDashboardInitializationComplete&&!atlasAccessVerificationPromise);
 profile={...profile,status:'disabled'};await page.evaluate(()=>verifyAtlasWorkspaceAccess());
 assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.validated),false);assert.equal(await page.locator('#tab-panel-0').getByText('Workspace source unavailable').count(),1);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,syntheticOnly:true,cold:cold.ready,warm,navigation,requests:requests.length,checks:'cache scope, canonical source membership, hash tamper, no eager feature code, source failure, verified Settings without source, unverified Settings denial, access loss, Reports/Import/Bonus/Admin/Central Services navigation'}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
