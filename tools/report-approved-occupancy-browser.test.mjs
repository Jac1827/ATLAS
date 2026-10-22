// Real app, module graph and report export handlers over synthetic read-only evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {digest,verifyProjection,accessNamespace,projectionKey} from '../docs/portfolio-operations-dashboard/features/workspace-bootstrap.mjs';
import {projectCurrentHistory} from '../docs/portfolio-operations-dashboard/features/import-history-store.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const root=path.resolve('docs/portfolio-operations-dashboard');
const actor='11111111-1111-4111-8111-111111111111',community='22222222-2222-4222-8222-222222222222';
const roster=[{community_id:community,display_name:'Florence Villa',canonical_name:'Florence Villa',status:'active'},{community_id:'33333333-3333-4333-8333-333333333333',display_name:'Anthem House',canonical_name:'Anthem House',status:'active'}];
let profile={user_id:actor,email:'test@risere.com',display_name:'Synthetic admin',role:'admin',status:'active',allowed_community_ids:[],allowed_market_values:[],allowed_region_values:[],locked_tab_ids:[],locked_page_keys:[],community_access_records:roster};
const source={documentKey:'atlas_dashboard_state_v1',version:7,archiveHash:'a'.repeat(64),effectiveAt:'2026-09-24T12:00:00Z'};
const monthlyData=Array.from({length:12},(_,i)=>({month:i,occupiedSnapshot:90,snapshotVerified:true,leasedSnapshot:93,leasedSnapshotVerified:true,rentableUnits:100,moveIns:0,moveOuts:0,guestCards:0,budgetOcc:97,metricProvenance:{occupiedSnapshot:{revisionKey:"synthetic-source"}}}));
const history={batches:[],sourceArchive:[],canonicalRecords:[],lineage:[],reconciliationLog:[]};
const importState=projectCurrentHistory(history);importState.historyStorage={...importState.historyStorage,view:'remote',archiveHash:source.archiveHash,parentDocument:source.documentKey,version:source.version};
const body={format:1,source,communityData:{'Florence Villa':{propertyName:'Florence Villa',communityId:community,customUnits:100,communityStatus:'active',reportYear:2026,currentMonth:9,currentOccupied:90,currentLeased:93,monthlyData}},opsGlobalData:{portfolioMonthScopeByPeriod:{'2026-10':['Florence Villa']}},importState};
body.communityData['Anthem House']={...body.communityData['Florence Villa'],propertyName:'Anthem House',communityId:roster[1].community_id};
body.opsGlobalData.portfolioMonthScopeByPeriod['2026-10']=['Florence Villa','Anthem House'];
for(const record of Object.values(body.communityData))record.savedBudgetTargets=Array(12).fill(97);
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
 const errors=[],requests=[];
 const output=process.env.ATLAS_REPORT_QA_DIR||fs.mkdtempSync(path.join(tmpdir(),'atlas-approved-report-'));fs.mkdirSync(output,{recursive:true});
 let sourceUnavailable=false,profileUnavailable=false,profileGate=null,budgetRows=new Map();
 const routeSynthetic=async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===origin){requests.push(url.pathname);return route.continue();}
  if(url.pathname.startsWith('/rest/v1/')){
   requests.push(url.pathname);
   if(request.method()!=='GET'&&!/\/rpc\/(atlas_read_|atlas_get_|atlas_directory|atlas_bonus_workspace)/.test(url.pathname))return route.fulfill({status:403,json:{message:'Synthetic test blocks writes'}});
   let value=[];
   if(url.pathname.endsWith('/rpc/atlas_read_reputation_months'))value={records:[],editableCommunityIds:[]};
   if(url.pathname.endsWith('/atlas_approved_budget_versions'))value=budgetRows.get(url.searchParams.get('community_id')?.slice(3))||[];
   if(url.pathname.endsWith('/atlas_user_profiles')){if(profileGate)await profileGate.promise;if(profileUnavailable)return route.fulfill({status:503,json:{message:'Synthetic access read unavailable'}});value=[profile];}
   if(url.pathname.endsWith('/atlas_communities')){const cid=url.searchParams.get('community_id')?.slice(3);value=roster.filter(row=>!cid||row.community_id===cid).map(row=>({...row,units:100,version:1,updated_at:'2026-10-21T12:00:00Z',review_status:'clean',review_flags:[]}));}
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
   return route.fulfill({json:value,headers:{'access-control-allow-origin':'*'}});
  }
  return route.fulfill({body:'',status:200});
 };
 const initializeSession=({actor,profile,namespace})=>{
  const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-21T16:00:00Z']));}static now(){return new NativeDate('2026-10-21T16:00:00Z').getTime();}};
  localStorage.setItem('atlas_central_auth_session_v1',JSON.stringify({access_token:'synthetic-test-only',refresh_token:'synthetic-test-only',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:actor,email:profile.email}}));
  localStorage.setItem('atlas_central_profile_v1',JSON.stringify(profile));
  localStorage.setItem(namespace+':atlas_dashboard_preferences_v1',JSON.stringify({hasSeenWelcome:true}));
 };
 const session=async()=>{const context=await browser.newContext({acceptDownloads:true});await context.route('**/*',routeSynthetic);await context.addInitScript(initializeSession,{actor,profile,namespace});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.stack||e.message));return {context,page};};
 const {context,page}=await session();
 await page.goto(origin+'/index.html?atlasPerf=1');
 await page.waitForFunction(()=>atlasDashboardInitializationComplete&&atlasWorkspaceAccess.hasData,{},{timeout:15000}).catch(async error=>{console.log('DEBUG',await page.evaluate(()=>({state:typeof atlasWorkspaceAccess==='undefined'?null:atlasWorkspaceAccess,error:document.body.innerText.slice(-2000)})),errors);throw error;});

 const ready=target=>target.waitForFunction(()=>window.AtlasReports&&!prepareAtlasOccupancyBudgetView.pending&&!prepareAtlasReputationView.pending&&typeof buildMonthlyInvestorPresentationDocument==='function'&&document.getElementById('tab-panel-8')?.dataset.atlasReportsPreparing!=='1');
 const select=async(target,names=['Florence Villa'])=>{
  await target.evaluate(names=>{reportHubType='monthly_investor_deck';reportHubYear=2026;reportHubMonth=9;monthlyPresentationCommunities=names;portfolioReportSections={overview:true,traffic:false,renewals:false,reputation:false};persistOpsGlobalData();setTab(8);},names);
  await ready(target);
 };
 const capture=target=>target.evaluate(()=>{
  const report=buildMonthlyInvestorPresentationData('monthly_investor_deck',{silent:true});
  return {targets:report.details.map(d=>d.summary.budgetOccPct),versions:report.details.map(d=>d.summary.budgetOccEvidence?.versionId),aggregate:report.aggregate,html:buildMonthlyInvestorPresentationDocument(report),cards:buildMonthlyInvestorPresentationMetricCards({...report,previousAggregate:null}),brief:buildMonthlyInvestorPresentationBrief(report),recommendations:report.details.flatMap(d=>d.recommendations),source:JSON.stringify(savedData)};
 });
 const locked=pct=>({community_id:community,calendar_year:2026,status:'locked',version_id:'approved-fixture',content_hash:'approved-hash',covered_months:[0,9],payload:{occupancyPct:Array(12).fill(pct)}});
 await select(page);const original=await capture(page);
 assert.deepEqual(original.targets,[null]);assert.equal(original.aggregate.budgetOccPct,null);assert.equal(original.aggregate.occGapPts,null);
 assert.match(original.html,/Approved occupancy budget unavailable/);assert.match(original.cards[0].sub,/unavailable/);assert.match(original.brief,/Budget attainment: Unavailable/);
 assert(!original.recommendations.some(row=>row.title==='Occupancy is trailing budget'));
 const normalized=text=>text.replace(/\s+/g,' ');
 async function exported(target,label,expect){
  const before=await capture(target);
  const expectedNames=await target.evaluate(()=>buildMonthlyInvestorPresentationData().communityNames);
  const scopeCheck=text=>{for(const name of expectedNames)assert(text.includes(name),'export contains selected '+name);for(const item of roster)if(!expectedNames.includes(item.display_name))assert(!text.includes(item.display_name),'export excludes unselected '+item.display_name);};
  const download=target.waitForEvent('download');await target.evaluate(()=>downloadMonthlyInvestorPresentationBrief());const htmlFile=await download;const htmlPath=path.join(output,label+'.html');await htmlFile.saveAs(htmlPath);const html=fs.readFileSync(htmlPath,'utf8');expect(html);scopeCheck(html);
  const popup=target.waitForEvent('popup');await target.evaluate(()=>openMonthlyInvestorPresentation(false));const print=await popup;await print.waitForFunction(()=>document.querySelector('.deck-slide'));const printText=await print.locator('body').innerText();expect(printText);scopeCheck(printText);
  const slides=print.locator('.deck-slide');for(let i=0;i<await slides.count();i++){const slide=slides.nth(i),text=await slide.innerText();if(/Budget & Revenue Position|Occupancy vs\. Budget|Community Snapshot/i.test(text))await slide.screenshot({path:path.join(output,label+'-slide-'+(i+1)+'.png')});}
  await print.screenshot({path:path.join(output,label+'.png'),fullPage:false});const pdf=await print.pdf({path:path.join(output,label+'.pdf'),printBackground:true,preferCSSPageSize:true});assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  const pdfText=await target.evaluate(async bytes=>{const lib=await import('./vendor/pdfjs-5.6.205/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc='./vendor/pdfjs-5.6.205/pdf.worker.min.mjs';const doc=await lib.getDocument({data:new Uint8Array(bytes)}).promise,parts=[];for(let i=1;i<=doc.numPages;i++)parts.push((await (await doc.getPage(i)).getTextContent()).items.map(x=>x.str).join(' '));return parts.join(' ');},Array.from(pdf));expect(normalized(pdfText));scopeCheck(normalized(pdfText));await print.close();
  const pptDownload=target.waitForEvent('download');await target.evaluate(()=>exportMonthlyInvestorPresentationPptx());const pptFile=await pptDownload,pptPath=path.join(output,label+'.pptx');await pptFile.saveAs(pptPath);
  const runtime={setTimeout,clearTimeout,setImmediate,Uint8Array,ArrayBuffer,Buffer,TextEncoder,TextDecoder,atob,btoa,console};runtime.window=runtime;runInNewContext(fs.readFileSync(path.join(root,'vendor/pptxgen-4.0.1.js'),'utf8'),runtime);
  const zip=await runtime.JSZip.loadAsync(fs.readFileSync(pptPath)),slideNames=Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name));assert(slideNames.length>3);
  const text=(await Promise.all(slideNames.map(name=>zip.file(name).async('string')))).join(' ');expect(text);scopeCheck(text);
  assert.equal((await capture(target)).source,before.source,'exports never mutate source records');
 }
 const expectMissing=text=>{assert.match(text,/Approved occupancy budget unavailable/);assert.doesNotMatch(text,/Goal 97(?:\.0)?%|97\.0% budget line|0 of 0 communities are.*on track/);};
 await exported(page,'monthly-missing',expectMissing);
 await page.reload();await page.waitForFunction(()=>atlasDashboardInitializationComplete&&atlasWorkspaceAccess.hasData);await select(page);assert.deepEqual((await capture(page)).targets,[null]);
 const independent=await session(),second=independent.page;await second.goto(origin+'/index.html');await second.waitForFunction(()=>atlasDashboardInitializationComplete&&atlasWorkspaceAccess.hasData);await select(second);assert.deepEqual((await capture(second)).targets,[null]);await independent.context.close();
 for(const pct of [0,92]){
  budgetRows.set(community,[locked(pct)]);await page.evaluate(()=>window.dispatchEvent(new Event('atlas-finance-updated')));
  await page.waitForFunction(pct=>getRecordSavedBudgetOccPct(savedData['Florence Villa'],9,2026)===pct,pct);await ready(page);
  const state=await capture(page);assert.deepEqual(state.targets,[pct]);assert.deepEqual(state.versions,['approved-fixture']);assert.equal(state.aggregate.trackedBudgetOccCount,1);
  assert.equal(state.source,original.source,'approved target readback never replaces legacy saved curve');
  if(pct===0){assert.equal(state.aggregate.onTrackBudgetOccCount,1);assert.match(state.cards[0].sub,/1 of 1/);await exported(page,'monthly-approved-zero',text=>assert.match(text,/Goal 0\.0%/));}
  else {assert.match(state.html,/Goal 92\.0%/);assert(state.recommendations.some(row=>row.title==='Occupancy is trailing budget'),'approved target may produce a valid budget-shortfall recommendation');}
 }
 await select(page,['Florence Villa','Anthem House']);const partial=await capture(page);assert.deepEqual(partial.targets,[92,null]);assert.equal(partial.aggregate.budgetOccPct,null);assert.equal(partial.aggregate.occGapPts,null);assert.match(partial.cards[0].sub,/1\/2 communities covered/);
 await exported(page,'monthly-partial',text=>assert.match(text,/1\/2 communities covered/));
 // January has no prior aggregate: exercise the actual first-card missing state.
 budgetRows.clear();await page.evaluate(()=>{reportHubMonth=0;window.dispatchEvent(new Event('atlas-finance-updated'));});await ready(page);await page.waitForFunction(()=>getRecordSavedBudgetOccPct(savedData['Florence Villa'],0,2026)===null);const january=await capture(page);assert.match(january.cards[0].sub,/unavailable/);assert.doesNotMatch(january.html,/0\/0 communities on track/);
 // Real installed Community Command wrapper: history gets approved missing/zero,
 // while the retained source and historical actuals remain exactly as supplied.
 const history=await page.evaluate(async(__cid)=>{
  const {installCommunityGoalPlanning}=await import('./features/community-goal-planning.mjs');
  const central=ATLAS_CENTRAL,model={propName:'Florence Villa',year:2026,monthIdx:9,record:savedData['Florence Villa']},legacy=Array.from({length:12},(_,idx)=>({monthIdx:idx,budgetPct:97,occupancy:{endingActualPct:80},approved:{applicationGoal:0}})),before=JSON.stringify(legacy);
  const host={ATLAS_CENTRAL:central,atlasAccessDecision:()=>({ok:true}),getAtlasCommunityAccessRecord:()=>({atlasCommunityId:__cid}),buildCommunityCommandModel:()=>model,buildCommunityCommandLeasingPlanRows:()=>legacy,renderCommunityCommandLeasingPlan:()=>'',approveCommunityCommandMonthlyGoals:()=>{},getAtlasTodayISODate:()=> '2026-10-21',addEventListener:()=>{}};
  const api=installCommunityGoalPlanning({host,readSources:()=>({}),readBudgets:async()=>[{community_id:__cid,period_key:'2026-02',summary:{targetApprovalStatus:'approved',budgetVersion:'v0',budgetContentHash:'h0',occupancyPct:0}}],readPublications:async()=>[],readInventory:async()=>null});await api.hydrate(model);return {targets:host.buildCommunityCommandLeasingPlanRows(model).slice(0,2).map(row=>row.budgetPct),unchanged:JSON.stringify(legacy)===before};
 },community);
 assert.deepEqual(history,{targets:[null,0],unchanged:true});
 assert.deepEqual(errors,[]);console.log('PASS real app/module graph: missing/approved/zero/partial budgets, report cards/narratives/recommendations, reload/second session, immutable source, historical installer with isolated host, HTML/PDF/PPTX text and scope parity (screenshots captured, layout review separate). Synthetic artifacts: '+output);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
