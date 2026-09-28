// The genuine retained operational HTML + genuine current Budget Builder. Only
// remote service responses and browser source data are synthetic. No credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {composeFinanceCompatSource,OPERATIONAL_RELEASE} from './compose-finance-compat-source.mjs';
import {patchOccupancyImportBoundary} from './occupancy-compat-boundary.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const repo=path.resolve(import.meta.dirname,'..'),tmp=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-finance-compat-'));
const cid='10000000-0000-0000-0000-000000000001',actor='00000000-0000-0000-0000-000000000001',second='00000000-0000-0000-0000-000000000002',scenario='20000000-0000-0000-0000-000000000001',revision='30000000-0000-0000-0000-000000000001';
const roster=[{community_id:cid,display_name:'RISE Doro',canonical_name:'Doro',status:'active',units:247,version:1,updated_at:'2026-09-28T00:00:00Z',review_status:'clean',review_flags:[]}],profile=id=>({user_id:id,email:'synthetic@invalid.example',display_name:'Synthetic authorized user',role:'executive',status:'active',account_status:'active',allowed_community_ids:[cid],allowed_market_values:[],allowed_region_values:[],locked_tab_ids:[],locked_page_keys:[],community_access_records:roster});
const monthlyData=Array.from({length:12},(_,month)=>({month,occupiedSnapshot:month===8?183:180,snapshotVerified:true,leasedSnapshot:185,leasedSnapshotVerified:true,rentableUnits:247,moveIns:5,moveOuts:2,guestCards:9}));
const retainedCommunity={propertyName:'RISE Doro',communityId:cid,customUnits:247,communityStatus:'active',reportYear:2026,currentMonth:8,currentOccupied:183,currentLeased:185,monthlyData};
const retainedHistory={batches:Array.from({length:32},(_,i)=>({id:'SYNTHETIC-IMPORT-'+i,status:'Approved',approvedAt:'2026-09-25T12:00:00Z',summary:{files:1,communities:1},files:[]})),sourceArchive:[],canonicalRecords:[],lineage:[],reconciliationLog:[],exceptions:[]};
const payload={communityId:cid,name:'Synthetic exact submitted review',recordType:'reforecast',ownerId:actor,reviewerId:actor,periods:['2026-09'],reason:'Synthetic approved review evidence',drivers:[],overrides:[],config:{communityId:cid,budgetYear:2026,forecastStartPeriod:'2026-09',forecastEndPeriod:'2026-09',fiscalStartMonth:1,baselineType:'original_budget'}};
retainedHistory.batches[0].beforeSnapshot={savedData:{'RISE Doro':retainedCommunity},marker:'retained historical evidence'};retainedHistory.sourceArchive=[{id:'retained-source',fileName:'synthetic.csv',batchId:'SYNTHETIC-IMPORT-0',fileHash:'b'.repeat(64),importStatus:'Approved'}];retainedHistory.lineage=[{id:'synthetic-lineage',batchId:'SYNTHETIC-IMPORT-0',communityName:'RISE Doro',periodKey:'2026-09',atlasField:'occupiedSnapshot',importedValue:183,currentState:true}];
// Aggregate-only source evidence is synthetic and remains part of the retained history.
for(const reportType of ['box_score','rent_roll'])retainedHistory.sourceArchive.push({reportType,fileHash:reportType+'-hash',batchId:'SYNTHETIC-IMPORT-31',importStatus:'Approved'});
const operationalSource=(reportType,section,values,occupancyEvidence)=>({communityName:'Doro',communityId:cid,reportType,section,sectionPeriod:{asOf:'2026-09-28'},periodKey:'2026-09',dataAsOf:'2026-09-28T13:00:00Z',fileHash:reportType+'-hash',sourceFile:'Synthetic '+reportType+'.xlsx',batchId:'SYNTHETIC-IMPORT-31',downstreamEligible:true,values,occupancyEvidence});
retainedHistory.canonicalRecords=[operationalSource('box_score','Availability',{measurement_basis:'units',total_units:247,rentable_units:247,occupied_units:78,source_leased_units:115,vacant_rented:37}),operationalSource('box_score','Lead Conversions',{applications:15,leases_completed:1}),operationalSource('rent_roll','Unit Details',{}, {schemaVersion:1,status:'valid',period:'2026-09',sourceFingerprint:'rent_roll-hash',pipeline:{status:'valid',signedVacantUnits:37,undatedUnits:34,complete:false,datedMoveIns:[{date:'2026-10-27',count:1},{date:'2026-12-01',count:2}]}})];
const source={communityId:cid,periods:['2026-09'],baseline:{versionId:'original',lines:[{period:'2026-09',accountCode:'5120',amount:1000}]},actuals:{lines:[],closeVersions:[]},registry:{version:'synthetic',accounts:[{accountCode:'5120',name:'Rent',nature:'income',category:'Rent',placement:'above_noi'}]}};
const {computeReforecast}=await import('../docs/portfolio-operations-dashboard/features/reforecast-engine.mjs');
const snapshot=computeReforecast({...source,scenario:{...payload,versionId:revision,driverVersion:revision}});
const entry={head:{scenario_id:scenario,community_id:cid,revision:1,revision_id:revision,status:'submitted'},revision:{revision_id:revision,scenario_id:scenario,community_id:cid,revision:1,status:'submitted',actor_id:actor,created_at:'2026-09-25T12:00:00Z',payload,source,snapshot},source,snapshot,originator:actor,history:[{version:1,action:'submit',actor,at:'2026-09-25T12:00:00Z'}],permissions:{canApprovePublication:true,canEdit:true,canReview:true}};
const strPayload={schemaVersion:'atlas.str-programme-draft.v1',name:'Synthetic retained STR programme',sourcePropertyId:'source-doro',sourceProgrammeId:'str-retained',config:null,property:{id:'source-doro',name:'RISE Doro',units:[]},groups:[],programme:{id:'str-retained',propertyId:'source-doro',name:'Synthetic retained STR programme',applied:false,lineIds:[]},lines:[],years:[2026],reportSnapshot:null,reportUnavailableReason:'Synthetic incomplete retained configuration',targetBudget:null,reason:'Synthetic retained draft'};
const strHead={programme_id:'40000000-0000-0000-0000-000000000001',community_id:cid,revision:1,revision_id:'50000000-0000-0000-0000-000000000001'};
const strRecord={verified:true,head:strHead,revision:{...strHead,payload:strPayload,actor_id:actor,created_at:'2026-09-25T12:00:00Z',content_hash:'a'.repeat(64)}};
let server,browser;
try{
 const old=path.join(tmp,'old'),out=path.join(tmp,'composed');await fs.mkdir(old);
 execFileSync('git',['archive','--format=tar','--output='+path.join(tmp,'old.tar'),'origin/atlas-asset-releases:_atlas-assets/'+OPERATIONAL_RELEASE],{cwd:repo});
 execFileSync('tar',['-xf',path.join(tmp,'old.tar'),'-C',old]);
 const receipt=await composeFinanceCompatSource({operationalSource:old,financeSource:path.join(repo,'docs'),out});
 assert.equal(receipt.changedOperationalFiles.length,14);assert.equal(await fs.readFile(path.join(out,'portfolio-operations-dashboard/index.html'),'utf8'),patchOccupancyImportBoundary(await fs.readFile(path.join(old,'portfolio-operations-dashboard/index.html'),'utf8'),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/workspace-core.js'),'utf8'),await fs.readFile(path.join(repo,'docs/portfolio-operations-dashboard/features/import-workspace.js'),'utf8')));
 await assert.rejects(composeFinanceCompatSource({operationalSource:old,financeSource:path.join(repo,'docs'),out}),/already exist/);
 const requests=[],writes=[],errors=[],unreviewedRpcs=[];
 const allowedRpcs=new Set(['atlas_read_reforecast_workspace','atlas_month_end_queue','atlas_read_budget_calendar','atlas_read_active_reforecast','atlas_read_reforecast_builder_source','atlas_read_reforecast_source','atlas_read_reforecast_sources','atlas_read_str_programme_drafts','atlas_read_str_programme_history','atlas_read_finance','atlas_read_dashboard_views','atlas_reforecast_effective_baseline','atlas_verify_budget_consumer','atlas_verify_finance_receipt','atlas_read_employee_notifications','atlas_read_people_directory','atlas_read_community_goals','atlas_read_shared_property_graph','atlas_upsert_live_session','atlas_end_live_session','atlas_save_dashboard_view']);
 server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local');if(url.pathname==='/blank'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Synthetic source setup</title>');return;}const file=path.resolve(out,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(out+path.sep))throw Error();res.setHeader('content-type',file.endsWith('.html')?'text/html':/\.(mjs|js)$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.ATLAS_BROWSER_CHANNEL?{channel:process.env.ATLAS_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin===origin){requests.push(url.pathname);return route.continue();}
  if(url.pathname.startsWith('/rest/v1/')){
   const name=url.pathname.split('/').at(-1),who=req.headers().authorization?.includes('synthetic-second')?second:actor,args=req.postDataJSON?.()||{};requests.push(name);
   if(req.method()!=='GET'&&!url.pathname.includes('/rpc/'))writes.push(name);
   if(url.pathname.includes('/rpc/')&&!allowedRpcs.has(name)){unreviewedRpcs.push(name);if(/atlas_(save|publish|update|upload|close|reopen|delete|approve)/.test(name))return route.fulfill({status:403,json:{message:'Source and financial mutations forbidden in compatibility acceptance'}});}
   let value=[];
   if(name==='atlas_read_finance')value=(args.p_periods||[]).map(period=>({community_id:cid,period_key:period,summary:{registryVersion:'atlas-finance-v1',communityId:cid,period,targetApprovalStatus:'approved',budgetVersion:'synthetic-approved-budget',budgetContentHash:'a'.repeat(64),occupancyPct:47.6}}));
   if(name==='atlas_user_profiles')value=url.searchParams.has('user_id')?[profile(who)]:[profile(actor),profile(second)];
   if(name==='atlas_communities')value=roster;
   if(name==='atlas_read_budget_calendar')value={verified:true,classification:'Multifamily',basis:'calendar',startMonth:1};
   if(name==='atlas_read_reforecast_workspace'){assert.deepEqual(args.p_community_ids,[cid]);value=who===actor?[entry]:[];}
   if(name==='atlas_read_reforecast_source'||name==='atlas_read_reforecast_builder_source')value=source;
   if(name==='atlas_read_str_programme_drafts'){assert.deepEqual(args.p_community_ids,[cid]);value=who===actor?[strRecord]:[];}
   if(name==='atlas_reforecast_heads')value=who===actor?[entry.head]:[];
   if(name==='atlas_reforecast_revisions')value=who===actor?[entry.revision]:[];
   if(name==='atlas_read_workspace_projection')throw Error('Compatibility startup must never request a replacement projection');
   return route.fulfill({json:value,headers:{'access-control-allow-origin':'*'}});
  }
  // Offline fixture: external fonts, analytics, map tiles and optional services.
  return route.fulfill({body:'',status:200});
 });
 await page.goto(origin+'/blank');await page.evaluate(async({actor,profile,community,history})=>{
  localStorage.setItem('atlas_central_auth_session_v1',JSON.stringify({access_token:'synthetic-primary',refresh_token:'synthetic-primary',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:actor,email:profile.email}}));localStorage.setItem('atlas_central_profile_v1',JSON.stringify(profile));
  localStorage.setItem('atlas_dashboard_preferences_v1',JSON.stringify({hasSeenWelcome:true}));
  await new Promise((resolve,reject)=>{const request=indexedDB.open('atlas_rise_state_v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('records',{keyPath:'key'});request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('records','readwrite'),store=tx.objectStore('records');for(const[key,value]of [['community_data',{'RISE Doro':community}],['atlas_data_import_2_state_v1',history],['rise_ops_global_v1',{portfolioMonthScopeByPeriod:{'2026-09':['RISE Doro']}}]])store.put({key,value,updatedAt:'2026-09-25T12:00:00Z'});store.put({key:'atlas_data_import_source_file:retained-source',fileName:'synthetic.csv',blob:new Blob(['community,occupied\nRISE Doro,183\n']),updatedAt:'2026-09-25T12:00:00Z'});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
 },{actor,profile:profile(actor),community:retainedCommunity,history:retainedHistory});
 await fs.mkdir(path.join(repo,'output/playwright/finance-compat'),{recursive:true});
 await page.goto(origin+'/portfolio-operations-dashboard/index.html');await page.waitForFunction(()=>typeof atlasDashboardInitializationComplete!=='undefined'&&atlasDashboardInitializationComplete&&typeof dataImport2State!=='undefined'&&dataImport2State.batches?.length===32).catch(async error=>{console.log('STARTUP',await page.evaluate(()=>({body:document.body.innerText.slice(-2000),complete:typeof atlasDashboardInitializationComplete==='undefined'?null:atlasDashboardInitializationComplete,batches:typeof dataImport2State==='undefined'?null:dataImport2State.batches?.length})),errors);throw error;});
 const operational=()=>page.evaluate(()=>({communityId:savedData['RISE Doro'].communityId,months:savedData['RISE Doro'].monthlyData,batches:dataImport2State.batches.map(row=>row.id),database:ATLAS_STATE_DB_NAME}));
 const evidence=()=>page.evaluate(async()=>{const names=['atlas_data_import_2_state_v1','atlas_data_import_source_file:retained-source'],rows=[];for(const name of names){const row=await withAtlasStateStore('readonly',store=>store.get(name));if(row?.blob)row.blob=await row.blob.text();rows.push(row);}return rows;});
 const sourceEvidence=await evidence();assert.equal(sourceEvidence[1].blob,'community,occupied\nRISE Doro,183\n');assert(sourceEvidence[0].value.batches[0].beforeSnapshot);
 const before=await operational();assert.equal(before.communityId,cid);assert.equal(before.database,'atlas_rise_state_v1');assert.equal(before.months[8].occupiedSnapshot,183);assert.equal(before.batches.length,32);
 await page.waitForFunction(()=>window.AtlasCommunityGoalPlanning);
 await page.evaluate(()=>{getAtlasTodayISODate=()=> '2026-09-28';queueWorkspaceNavigation('RISE Doro',2);});
 await page.locator('[data-occupancy-goal-planning]').waitFor().catch(async error=>{console.log('OCCUPANCY',await page.evaluate(()=>({body:document.body.innerText.slice(-3500),tab:activeTab,scope:workspaceScopeValue,model:buildCommunityCommandModel(getProp().name,getCurrentCommunityRecord()).goalPlanning})),errors);throw error;});
 await page.waitForFunction(()=>document.querySelector('[data-minimum-applications]')?.textContent==='45');
 assert.equal(await page.locator('[data-current-leased]').innerText(),'46.56%');assert.equal(await page.locator('[data-leased-target]').innerText(),'47.60%');assert.equal(await page.locator('[data-signed-lease-gap]').innerText(),'3');
 assert.match(await page.locator('[data-occupancy-goal-planning]').innerText(),/Signed units with unavailable timing: 34/);assert.match(await page.locator('[data-occupancy-goal-planning]').innerText(),/Physical move-ins required: Unavailable/);
 assert(requests.some(r=>r.endsWith('/finance/portfolio-operations-dashboard/features/community-goal-planning.mjs')),'Retained goal editor loads only the scoped current planning module');
 assert.deepEqual(await evidence(),sourceEvidence,'Advisory planning preserves complete original source evidence and history');
 await page.screenshot({path:path.join(repo,'output/playwright/finance-compat/occupancy-source-goals.png'),fullPage:true});
 await page.evaluate(()=>setTab(0));await page.locator('[data-budget-review]').waitFor();await page.locator('[data-budget-review]').click();
 const iframe=page.frameLocator('iframe[src*="finance/portfolio-operations-dashboard/RISE-Budget-Builder"]');await iframe.locator('#app').waitFor().catch(async error=>{console.log('BUDGET MOUNT',await page.locator('#tab-panel-12').innerHTML(),page.frames().map(row=>row.url()),errors,requests.filter(x=>x.includes('RISE-Budget')));throw error;});
 await iframe.locator('[data-edit="name"]').waitFor();assert.equal(await iframe.locator('[data-edit="name"]').inputValue(),payload.name,'Dashboard Review selects exact submitted record');
 const frame=page.frames().find(frame=>frame.url().includes('/finance/portfolio-operations-dashboard/RISE-Budget-Builder'));
 assert.equal(await frame.evaluate(()=>parent.ATLAS_CENTRAL===window.parent.ATLAS_CENTRAL&&parent.atlasAccessDecision(12).ok),true);
 const header=page.locator('.atlas-budget-workspace-actions');assert.equal(await header.getByRole('button',{name:'Approve Shared Original Budget',exact:true}).count(),0);assert.match(await page.locator('.atlas-budget-workspace-note').innerText(),/VP approval publishes.*Investor approval locks/);assert.doesNotMatch(await page.locator('.atlas-budget-workspace-note').innerText(),/Admin approval/);
 await header.getByRole('button',{name:'Ready for Review and Approval',exact:true}).click();await iframe.getByRole('heading',{name:'Ready for Review and Approval',exact:true}).waitFor();
 await frame.waitForFunction(()=>!document.querySelector('[data-refresh]')?.disabled);
 assert(requests.includes('atlas_month_end_queue'),'Approval view reads closed-package eligibility through retained Central transport');
 assert.doesNotMatch(await iframe.locator('body').innerText(),/Month-end approval eligibility could not be read|Month-end approval queue scope mismatch/,'A valid empty month-end queue remains usable on the actual retained operational host');
 assert.equal(await iframe.locator('[data-open="'+scenario+'"]').count(),1,'The submitted budget remains actionable with no eligible month-end packages');
 await header.getByRole('button',{name:'Working Drafts',exact:true}).click();await iframe.getByRole('heading',{name:'Working Drafts',exact:true}).waitFor();
 await header.getByRole('button',{name:'Saved STR programmes',exact:true}).click();await iframe.locator('[data-str-resume]').waitFor();assert.match(await iframe.locator('[data-str-list]').innerText(),/Synthetic retained STR programme/);await page.screenshot({path:path.join(repo,'output/playwright/finance-compat/saved-str-mixed-host.png'),fullPage:true});
 // A captured row must not cross an authenticated account change.
 await page.evaluate(({second,profile})=>{localStorage.setItem('atlas_central_auth_session_v1',JSON.stringify({access_token:'synthetic-second',refresh_token:'synthetic-second',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:second,email:profile.email}}));localStorage.setItem('atlas_central_profile_v1',JSON.stringify(profile));},{second,profile:profile(second)});
 await iframe.locator('[data-str-resume]').click();assert.match(await iframe.locator('[data-str-list-status]').innerText(),/account changed/);
 await frame.evaluate(()=>{parent.dispatchEvent(new Event('atlas-central-auth-change'));RBB.app.go('savedstr');});await iframe.locator('[data-str-list-status]').waitFor({state:'attached'});await iframe.locator('[data-str-resume]').waitFor({state:'detached'});
 assert.doesNotMatch(await iframe.locator('body').innerText(),/Synthetic retained STR programme/);assert.deepEqual(await operational(),before,'Finance navigation/account changes preserve operational data and import history');
 await page.reload();await page.waitForFunction(()=>typeof atlasDashboardInitializationComplete!=='undefined'&&atlasDashboardInitializationComplete&&dataImport2State.batches?.length===32);assert.deepEqual(await operational(),before,'Reload preserves exact operational evidence');
 assert.deepEqual(await evidence(),sourceEvidence,'Full retained history, rollback snapshots, lineage and original Blob survive finance navigation and reload');assert.deepEqual([...new Set(unreviewedRpcs)],[],'Every RPC must be a reviewed read/readback, presence or own-dashboard-layout operation');
 assert(!requests.some(value=>/workspace-bootstrap|workspace-projection|workspace-core/.test(value)));assert(!writes.some(value=>/atlas_app_documents|atlas_reforecast|str_programme/.test(value)),'Read-only UI acceptance does not publish or save financial/source values');
 // Optional legacy maps can report missing offline globals; finance must not.
 assert(!errors.some(value=>/reforecast|programme|RBB|Budget Builder|Unexpected token|SyntaxError/.test(value)),errors.join('\n'));
 await fs.mkdir(path.join(repo,'output/playwright/finance-compat'),{recursive:true});await page.screenshot({path:path.join(repo,'output/playwright/finance-compat/operational-preserved.png'),fullPage:true});
 console.log('PASS exact retained operational startup and32 imports; isolated current Budget Builder; canonical parent authorization; home exact-record Review; Working Drafts; Saved STR; account-change guard; reload unchanged; no projection/source publication.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(tmp,{recursive:true,force:true});}
