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
  window.__defaultFactoryCalls=0;window.__defaultWrites=[];window.__guardReturnedTrees=true;
  const factory=window.defaultSavedCommunityRecord;
  const readonly=value=>{
   if(!__guardReturnedTrees||!value||typeof value!=='object')return value;
   const children=new Map();
   return new Proxy(value,{
    get(target,key,receiver){const item=Reflect.get(target,key,receiver);if(!item||typeof item!=='object')return item;if(!children.has(key))children.set(key,readonly(item));return children.get(key);},
    set(){__defaultWrites.push('set');throw Error('Report mutated a cached default');},
    deleteProperty(){__defaultWrites.push('delete');throw Error('Report mutated a cached default');},
    defineProperty(){__defaultWrites.push('define');throw Error('Report mutated a cached default');}
   });
  };
  window.__guardedDefaultFactory=(...args)=>{__defaultFactoryCalls++;return readonly(factory(...args));};
  window.__leafOriginals={};window.__leafFresh={};window.__leafMemoFunctions={};for(const name of ['normalizePropertyTeamConfig','rebuildBonusRolesByQuarter']){const original=window[name];window.__leafFresh[name]=original;window.__leafOriginals[name]=(...args)=>readonly(original(...args));window[name]=__leafOriginals[name];}
  window.defaultSavedCommunityRecord=__guardedDefaultFactory;
  window.__freshDefaultFactory=factory;
 });
 await page.evaluate(()=>setTab(8));
 await page.waitForFunction(()=>!!window.AtlasReports&&!document.querySelector('#tab-panel-8').innerText.includes('Loading this workspace'));
 assert.doesNotMatch(await page.locator('#tab-panel-8').innerText(),/render issue|did not finish loading/);
 const checks=await page.evaluate(()=>{
  const NativeDate=Date,fixedNow=NativeDate.now();
  window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixedNow]));}static now(){return fixedNow;}};
  const plain=value=>JSON.stringify(value);
  const memoFactory=window.defaultSavedCommunityRecord;for(const name of Object.keys(__leafOriginals))__leafMemoFunctions[name]=window[name];
  const scenarios=[
   {year:2026,month:8,patch:{}},
   {year:2025,month:0,patch:{monthlyData:[null,{applications:0,tours:null}],monthlyHistoryByPeriod:{'2025-01':{applications:0,tours:null,occupiedSnapshot:0,leasedSnapshot:0},'2026-01':{applications:7,tours:9}},corporateLeaseUnits:12}},
   {year:2027,month:1,patch:{monthlyData:Array.from({length:12},()=>({applications:null,tours:0})),monthlyHistoryByPeriod:{'2025-01':{applications:0,tours:1}},bonusPayouts:null,seasonal:null}}
  ];
  const builders=[['community_progress',()=>buildCommunityProgressReportData({silent:true})],['market_comparison',()=>buildMarketComparisonReportData({silent:true})],['portfolio_performance_report',()=>buildPortfolioReportData()],['quarterly_bonus_roles',()=>getCommunityQuarterlyBonusRoles('Doro',savedData.Doro,'Q3')],['weekly',()=>buildWeeklyExecutiveReportData()],['rise_portfolio_leasing_weekly',()=>buildRisePortfolioLeasingWeeklyReportData({silent:true})]];
  const results=[];
  const initial=structuredClone(savedData.Doro);
  for(const scenario of scenarios){
   savedData.Doro={...structuredClone(initial),...scenario.patch};
   reportHubYear=scenario.year;reportHubMonth=scenario.month;reportHubCommunityProgressCommunities=['Doro'];
   for(const [type,build] of builders){
    reportHubType=type;
    const run=useMemo=>{
     window.defaultSavedCommunityRecord=useMemo?memoFactory:__guardedDefaultFactory;for(const name of Object.keys(__leafOriginals))window[name]=useMemo?__leafMemoFunctions[name]:__leafOriginals[name];
     __defaultFactoryCalls=0;const beforeSource=plain(savedData);const previous=AtlasReports.beginRender();
     try{const value=plain(build());if(beforeSource!==plain(savedData))throw Error('Report mutated its retained source input');return {value,calls:__defaultFactoryCalls};}
     finally{AtlasReports.endRender(previous);}
    };
    const before=run(false),after=run(true);
    const differences=[];const diff=(a,b,path='')=>{if(JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[key],b[key],path+'.'+key);}else differences.push({path,a,b});};if(before.value!==after.value)diff(JSON.parse(before.value),JSON.parse(after.value));results.push({type,year:scenario.year,equal:before.value===after.value,beforeCalls:before.calls,afterCalls:after.calls,differences});
   }
  }
  // Changing values/People/source/access between renders must not reuse a prior default tree.
  window.defaultSavedCommunityRecord=memoFactory;
  let previous=AtlasReports.beginRender();const first=defaultSavedCommunityRecord('Doro');AtlasReports.endRender(previous);
  atlasWorkspaceAccess.source={...atlasWorkspaceAccess.source,version:8};atlasSharedData={...atlasSharedData,employees:[{id:'synthetic-updated-employee'}]};
  previous=AtlasReports.beginRender();const second=defaultSavedCommunityRecord('Doro');AtlasReports.endRender(previous);
  const sourceFresh=first!==second;
  // Exact source identity is reusable only for the duration of one render.
  for(const name of Object.keys(__leafMemoFunctions))window[name]=__leafMemoFunctions[name];
  const teamInput=defaultPropertyTeamConfig(),bonusInput=JSON.parse(plain(__freshDefaultFactory('Doro').bonusRolesByQ));
  previous=AtlasReports.beginRender();
  const teamA=normalizePropertyTeamConfig(teamInput),teamAgain=normalizePropertyTeamConfig(teamInput),otherTeam=normalizePropertyTeamConfig({...teamInput});
  const quarterA=rebuildBonusRolesByQuarter(bonusInput,teamA),quarterAgain=rebuildBonusRolesByQuarter(bonusInput,teamA),otherQuarter=rebuildBonusRolesByQuarter(bonusInput,otherTeam);
  const exactTupleReuse=teamA===teamAgain&&quarterA===quarterAgain&&teamA!==otherTeam&&quarterA!==otherQuarter;
  AtlasReports.endRender(previous);
  const roleType=PROPERTY_TEAM_ROLE_ORDER[0];teamInput[roleType]+=1;bonusInput.Q1[0].metrics[0].target=0;
  previous=AtlasReports.beginRender();const nextTeam=normalizePropertyTeamConfig(teamInput),nextQuarter=rebuildBonusRolesByQuarter(bonusInput,nextTeam);AtlasReports.endRender(previous);
  const editedInputFresh=nextTeam!==teamA&&nextTeam[roleType]===teamInput[roleType]&&nextQuarter!==quarterA&&nextQuarter.Q1[0].metrics[0].target===0;
  __guardReturnedTrees=false;
  const outsideTeamA=normalizePropertyTeamConfig(teamInput),outsideTeamB=normalizePropertyTeamConfig(teamInput),outsideQuarterA=rebuildBonusRolesByQuarter(bonusInput,outsideTeamA),outsideQuarterB=rebuildBonusRolesByQuarter(bonusInput,outsideTeamA);
  outsideTeamA[roleType]=991;outsideQuarterA.Q1[0].metrics[0].target=991;
  const externalLeafFresh=outsideTeamB[roleType]!==991&&outsideQuarterB.Q1[0].metrics[0].target!==991;
  // Outside Reports, the public factory still returns independent mutable trees.
  window.defaultSavedCommunityRecord=__freshDefaultFactory;for(const name of Object.keys(__leafFresh))window[name]=__leafFresh[name];
  const outsideA=defaultSavedCommunityRecord('Doro'),outsideB=defaultSavedCommunityRecord('Doro');
  outsideA.seasonal[0]=991;outsideA.bonusRolesByQ.Q1[0].metrics[0].target=991;
  const externalFresh=outsideB.seasonal[0]!==991&&outsideB.bonusRolesByQ.Q1[0].metrics[0].target!==991;
  window.defaultSavedCommunityRecord=memoFactory;
  const wrappedA=defaultSavedCommunityRecord('Doro'),wrappedB=defaultSavedCommunityRecord('Doro');
  window.Date=NativeDate;
  return {results,sourceFresh,externalFresh,outsideWrappedFresh:wrappedA!==wrappedB,exactTupleReuse,editedInputFresh,externalLeafFresh,writes:__defaultWrites};
 });
 assert.equal(checks.results.length,18);
 for(const result of checks.results){assert(result.equal,JSON.stringify(result));assert(result.afterCalls<=result.beforeCalls,JSON.stringify(result));}
 assert(checks.results.some(result=>result.beforeCalls>result.afterCalls),'Actual report graph must eliminate repeated default construction');
 assert.deepEqual(checks.writes,[],'Actual report consumers never attempt nested default mutation');
 assert(checks.sourceFresh);assert(checks.externalFresh);assert(checks.outsideWrappedFresh);assert(checks.exactTupleReuse);assert(checks.editedInputFresh);assert(checks.externalLeafFresh);
 assert.deepEqual(errors,[]);
 console.log('PASS actual Reports default/staffing/quarter-template memo: 18 full report payload comparisons across six report types/current/prior/sparse years; mutation traps, source/People refresh, and independent external factory results.',JSON.stringify(checks.results.map(({type,year,beforeCalls,afterCalls})=>({type,year,beforeCalls,afterCalls}))));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
