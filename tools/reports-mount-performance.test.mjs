import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.ATLAS_PLAYWRIGHT || 'playwright');
const root=new URL('../docs/portfolio-operations-dashboard/',import.meta.url);
const reports=fs.readFileSync(new URL('features/reports-workspace.js',root),'utf8');
const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/reports-template-hashes.json',import.meta.url),'utf8'));
function extract(source,name){const start=source.indexOf('function '+name+'(');assert(start>=0,name);for(const close of source.slice(start).matchAll(/^\}/gm)){const text=source.slice(start,start+close.index+1);try{new vm.Script(text);return text;}catch{}}throw Error(name);}
for(const [name,hash] of Object.entries(baseline))assert.equal(crypto.createHash('sha256').update(extract(reports,name)).digest('hex'),hash,`${name}: extraction preserves the complete prior document template`);
new vm.Script(reports);
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 await page.route('**/*',route=>route.abort());
 await page.setContent('<main id="reports"></main><section class="tab-panel" id="mount"></section>');
 await page.evaluate(()=>{
  window.profile={user_id:'synthetic-actor',role:'admin',status:'active',allowed_community_ids:['synthetic-community']};
  window.ATLAS_CENTRAL={getSession:()=>({user:{id:profile.user_id}}),getConfig:()=>({supabaseUrl:'https://synthetic.invalid'})};
  window.getAtlasAccessProfile=()=>profile;window.getAtlasRenderContextKey=()=>JSON.stringify([profile,workspaceScopeValue,currentMonth]);
  Object.assign(window,{reportHubType:'financial_review',reportHubPerspective:'csuite',reportHubAction:'preview',reportHubRecipientKeys:[],reportHubCommunityProgressCommunities:[],reportHubLvrCommunity:'',portfolioReportFilters:{investorGroups:[],investorCommunities:[]},portfolioReportSections:{overview:true},workspaceScopeValue:'portfolio',currentMonth:8,savedData:{a:{}},MONTHS:['Jan'],FULL_MONTHS:['January'],RISE_WEEKLY_LEASING_REPORT_TYPE:'weekly',RISE_WEEKLY_LEASING_REPORT_TITLE:'Weekly'});
  window.syntheticSharedGraph=null;Object.defineProperty(window,'localStorage',{value:{getItem:()=>syntheticSharedGraph}});
  window.atlasWorkspaceAccess={source:{version:1},binding:{scope:'synthetic'}};
  Object.assign(window,{PROPERTIES:[{name:'Synthetic'}],dataImport2State:{canonicalRecords:[],lineage:[],mappingRules:[]},atlasCommunityGoalStore:{actor:'synthetic-actor',scopes:new Map()},photoAssetUrlCache:new Map(),portfolioMonthScopeByPeriod:{},communityProgressViewMode:'dashboard',bonusQuarter:'Q3',regionalAssignments:{},jacsTeamBonus:[],communityCommandState:{},atlasSharedData:{}});
  window.getAtlasTodayISODate=()=> '2026-09-24';window.getCommunityScopeMode=()=> 'active';window.previewBuilds=0;
  window.renderCommunityProgressReportingWorkspace=()=>{previewBuilds++;return '<p>Preview '+previewBuilds+'</p>';};
  window.detailCalls=[];window.investorCalls=0;window.normalizationCalls=0;
  window.normalizeSavedCommunityRecord=(name,record)=>{normalizationCalls++;return {name,...record};};
  window.goalReads=0;window.getCommunityCommandApprovedGoal=(name,month,year)=>{goalReads++;return {name,month,year,actor:profile.user_id,scope:[...profile.allowed_community_ids],value:window.syntheticGoalValue??null};};
  window.buildPortfolioDetailsForMonth=(month,records,year)=>{detailCalls.push([month,records,year]);return [{name:'Synthetic',record:{},summary:{amount:null,zero:0,source:'retained-source'}}];};
  window.ensureValidReportHubAction=()=>{};window.normalizeReportHubType=x=>x;window.getReportHubMonthIndex=()=>8;window.getReportHubYear=()=>new Date().getFullYear();
  window.ensureReportHubRecipientSelection=()=>{AtlasReports.details(8,savedData,getReportHubYear());return [];};
  window.getReportHubActionOptions=()=>[{value:'preview',label:'Preview'}];window.getWorkspaceScopeDisplayName=()=> 'Synthetic scope';window.isPortfolioWorkspaceSelected=()=>true;
  window.escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.getDashboardMonthLabel=()=> 'September';window.getSelectedPortfolioReportSections=()=>['overview'];window.getScopedPortfolioReportDetails=x=>x;
  window.getInvestorReportFilterOptions=()=>{investorCalls++;return ['Synthetic investor'];};window.getEditableReportRecommendation=()=> 'Reviewed source';window.getReportHubTypeLabel=()=> 'Financial Review';
  window.getPortfolioReportSectionLabel=x=>x;
  window.getProp=()=>({name:'Synthetic'});window.getCurrentCommunityRecord=()=>({reportYear:2026});window.getSelectedDashboardMonthIndex=()=>currentMonth;window.atlasAccessDecision=()=>({ok:true});
 });
 await page.addScriptTag({content:extract(fs.readFileSync(new URL('workspace-core.js',root),'utf8'),'atlasExactPresentationInputString')});
 await page.addScriptTag({content:reports});
 const presentationCache=await page.evaluate(()=>{
  const outputs=[];const build=()=>{outputs.push(renderCommunityProgressReportingWorkspace());return previewBuilds;};
  const counts=[build(),build()];savedData.a.amount=0;counts.push(build());savedData.a.amount=null;counts.push(build());
  dataImport2State.mappingRules.push({target:'applications'});counts.push(build());dataImport2State.canonicalRecords.push({value:7});counts.push(build());
  atlasCommunityGoalStore.scopes.set('goal',{version:2,value:0});counts.push(build());photoAssetUrlCache.set('photo','blob:synthetic');counts.push(build());
  profile={...profile,role:'regional'};counts.push(build());currentMonth=9;counts.push(build());
  savedData.a.optional=undefined;counts.push(build());delete savedData.a.optional;counts.push(build());
  dispatchEvent(new Event('atlas-application-hydrated'));counts.push(build());counts.push(build());
  atlasWorkspaceAccess.source.version=2;counts.push(build());profile={...profile,user_id:'next-actor'};dispatchEvent(new Event('atlas-central-auth-change'));counts.push(build());dispatchEvent(new Event('atlas-central-auth-change'));counts.push(build());syntheticSharedGraph='changed-shared-graph';counts.push(build());
  currentMonth=8;return {counts,same:outputs[0]===outputs[1],missingDistinct:atlasExactReportInputString({v:undefined})!==atlasExactReportInputString({}),nullDistinct:atlasExactReportInputString({v:NaN})!==atlasExactReportInputString({v:null}),signedZeroDistinct:atlasExactReportInputString({v:-0})!==atlasExactReportInputString({v:0})};
 });
 assert.deepEqual(presentationCache,{counts:[1,1,2,3,3,4,5,6,7,8,9,10,11,11,12,13,13,14],same:true,missingDistinct:true,nullDistinct:true,signedZeroDistinct:true},'preview reuse ignores future mapping configuration but invalidates exact published source/goal/photo/role/period changes and preserves unknown semantics');
 const render=await page.evaluate(()=>{const html=renderReportingTab();return {html,calls:detailCalls.length,investors:investorCalls};});
 assert.equal(render.calls,1,'one portfolio detail calculation for both recipient scope and report controls');assert.equal(render.investors,0,'hidden scope controls do not build investor choices');assert.match(render.html,/Budget vs Actual Financial Review/);
 const communityControls=await page.evaluate(()=>{
  const previous=ensureReportHubRecipientSelection;ensureReportHubRecipientSelection=()=>[];
  getReportableCommunityNames=()=>['Synthetic'];getCommunityProgressReportCommunityNames=()=>['Synthetic'];getCommunityProgressReportScopeLabel=()=> 'Synthetic';
  const before=detailCalls.length;reportHubType='community_progress';const html=renderReportingTab();reportHubType='financial_review';ensureReportHubRecipientSelection=previous;
  return {additionalDetails:detailCalls.length-before,picker:html.includes('toggleCommunityProgressReportCommunity')};
 });
 assert.deepEqual(communityControls,{additionalDetails:0,picker:true},'Community Progress keeps its exact community picker without constructing unused portfolio details for hidden controls');
 await page.evaluate(()=>{const outer=AtlasReports.beginRender();AtlasReports.details(8,savedData,2026);AtlasReports.details(8,savedData,2026);AtlasReports.details(8,savedData,2025);AtlasReports.details(8,{},2026);AtlasReports.endRender(outer);});
 assert.equal(await page.evaluate(()=>detailCalls.length),4,'explicit year and record-map identity remain distinct');
 const memo=await page.evaluate(()=>{
  const original={amount:null,zero:0};let prior=AtlasReports.beginRender();
  const a=normalizeSavedCommunityRecord('Synthetic',original),b=normalizeSavedCommunityRecord('Synthetic',original);
  normalizeSavedCommunityRecord('Other',original);normalizeSavedCommunityRecord('Synthetic',{...original});
  const firstCalls=normalizationCalls;AtlasReports.endRender(prior);
  original.zero=7;profile={...profile,allowed_community_ids:['next-scope']};
  prior=AtlasReports.beginRender();const next=normalizeSavedCommunityRecord('Synthetic',original),access=getAtlasAccessProfile();AtlasReports.endRender(prior);
  normalizeSavedCommunityRecord('Synthetic',original);normalizeSavedCommunityRecord('Synthetic',original);
  return {same:a===b,firstCalls,total:normalizationCalls,unknown:a.amount,zero:a.zero,next:next.zero,scope:access.allowed_community_ids};
 });
 assert.deepEqual(memo,{same:true,firstCalls:3,total:6,unknown:null,zero:0,next:7,scope:['next-scope']},'memoization lasts only one synchronous render and keys full argument identity');
 const goalMemo=await page.evaluate(()=>{
  let previous=AtlasReports.beginRender();const a=getCommunityCommandApprovedGoal('Synthetic',8,2026),b=getCommunityCommandApprovedGoal('Synthetic',8,2026);
  getCommunityCommandApprovedGoal('Synthetic',9,2026);getCommunityCommandApprovedGoal('Other',8,2026);getCommunityCommandApprovedGoal('Synthetic',8,2025);AtlasReports.endRender(previous);
  const reads=goalReads;profile={...profile,user_id:'other-actor',allowed_community_ids:['other-community']};syntheticGoalValue=0;
  previous=AtlasReports.beginRender();const next=getCommunityCommandApprovedGoal('Synthetic',8,2026);AtlasReports.endRender(previous);
  return {same:a===b,reads,total:goalReads,unknown:a.value,next:next.value,actor:next.actor,scope:next.scope};
 });
 assert.deepEqual(goalMemo,{same:true,reads:4,total:5,unknown:null,next:0,actor:'other-actor',scope:['other-community']},'approved-goal reads reuse only the exact community/month/year within one synchronous render; next access context and explicit zero are fresh');
 await page.evaluate(()=>{const p=document.querySelector('#reports');const html=renderReportHubPreviewFrame('Synthetic','Scope','<input id="draft" value="original"><p>Missing —; explicit 0; source retained</p>');AtlasReports.renderInto(p,html);window.previewHtml=html;});
 const unchanged=await page.evaluate(()=>{const p=document.querySelector('#reports'),observer=new MutationObserver(()=>{});observer.observe(p,{childList:true,subtree:true});AtlasReports.renderInto(p,previewHtml);const changes=observer.takeRecords().length;observer.disconnect();return changes;});
 assert.equal(unchanged,0,'identical fully recomputed markup does not replace unchanged DOM');
 const frame=page.frameLocator('#reports iframe');await frame.locator('#draft').fill('entered draft');
 await page.evaluate(()=>{window.originalFrame=document.querySelector('#reports iframe');AtlasReports.renderInto(document.querySelector('#reports'),'<div>Changed recipient controls</div>'+previewHtml);});
 assert.equal(await page.evaluate(()=>originalFrame===document.querySelector('#reports iframe')),true);assert.equal(await frame.locator('#draft').inputValue(),'entered draft','unchanged preview remains connected with original browsing context');
 await page.evaluate(()=>{profile={...profile,allowed_community_ids:['other']};AtlasReports.renderInto(document.querySelector('#reports'),previewHtml);});
 assert.equal(await page.evaluate(()=>originalFrame===document.querySelector('#reports iframe')),false,'scope changes replace the preview');
 await page.evaluate(()=>{window.originalFrame=document.querySelector('#reports iframe');dispatchEvent(new Event('atlas-finance-updated'));AtlasReports.renderInto(document.querySelector('#reports'),previewHtml);});
 assert.equal(await page.evaluate(()=>originalFrame===document.querySelector('#reports iframe')),false,'source-version event invalidates matching markup');
 await page.addScriptTag({path:new URL('atlas-mounts.js',root).pathname});
 await page.evaluate(()=>{const p=document.querySelector('#mount');const f=document.createElement('iframe');f.srcdoc='<p>Synthetic embedded workspace</p>';f.dataset.atlasMountContext=AtlasMounts.contextKey(10);p.append(f);window.testFrame=f;});
 await page.waitForFunction(()=>testFrame.contentDocument?.body?.textContent.includes('Synthetic'));
 await page.evaluate(()=>handleAtlasMountLoad(testFrame,'maintenance'));
 assert.equal(await page.evaluate(()=>Boolean(testFrame.__atlasSyncTimer)),true);
 await page.evaluate(()=>document.querySelector('#mount').style.display='none');
 await page.waitForFunction(()=>testFrame.__atlasSyncTimer===null);
 await page.evaluate(()=>document.querySelector('#mount').style.display='');
 await page.waitForFunction(()=>Boolean(testFrame.__atlasSyncTimer));
 await page.evaluate(()=>testFrame.remove());await page.waitForFunction(()=>testFrame.__atlasSyncTimer===null);
 await page.evaluate(()=>{document.querySelector('#mount').append(testFrame);testFrame.dataset.atlasMountContext=AtlasMounts.contextKey(10);handleAtlasMountLoad(testFrame,'maintenance');currentMonth=9;AtlasMounts.reconcile();});
 assert.equal(await page.evaluate(()=>testFrame.isConnected),false,'period change invalidates the embedded workspace');assert.equal(await page.evaluate(()=>testFrame.__atlasSyncTimer),null);
 // Repeated creation and disposal must not retain each embedded document or its timers.
 await page.evaluate(()=>{delete window.testFrame;delete window.originalFrame;});
 const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');
 const beforeMemory=await cdp.send('Memory.getDOMCounters');
 await page.evaluate(async()=>{
  for(let i=0;i<30;i++){
   const frame=document.createElement('iframe');frame.srcdoc='<p>Synthetic repeated mount</p>';frame.dataset.atlasMountContext=AtlasMounts.contextKey(10);
   const loaded=new Promise(resolve=>frame.onload=resolve);document.querySelector('#mount').append(frame);await loaded;
   handleAtlasMountLoad(frame,'maintenance');AtlasMounts.dispose(frame);frame.remove();
   if(frame.__atlasSyncTimer!==null)throw Error('Disposed embedded workspace retained a polling timer');
  }
  AtlasMounts.reconcile();
 });
 await cdp.send('HeapProfiler.collectGarbage');const afterMemory=await cdp.send('Memory.getDOMCounters');
 assert(afterMemory.documents<=beforeMemory.documents+2,'Repeated mounts release detached browsing documents');
 assert(afterMemory.nodes<=beforeMemory.nodes+25,'Repeated mounts release detached DOM trees');
 assert(afterMemory.jsEventListeners<=beforeMemory.jsEventListeners+3,'Repeated mounts do not accumulate event listeners');
 console.log('Mount DOM retention after 30 cycles:',JSON.stringify({before:beforeMemory,after:afterMemory}));
 console.log('PASS Reports template parity, one per-render portfolio pass, lazy hidden controls, real iframe browsing-context retention, actor/scope/source invalidation, mount hide/resume/dispose/period cleanup.');
}finally{await browser.close();}
