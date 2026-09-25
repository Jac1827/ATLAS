import {readDashboardSource} from './dashboard-source.cjs';
// Real dashboard render functions + real Bonus modules; all data is an in-memory fixture.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const root=path.resolve(import.meta.dirname,'..'),base='/docs/portfolio-operations-dashboard/';
const source=(await readDashboardSource(path.join(root,base,'index.html')))+'\n'+(await fs.readFile(path.join(root,base,'features/bonus-workspace.js'),'utf8'));
const fn=name=>{const match=source.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^\\}','m'));assert(match,name);return match[0];};
const scopeInitializer=source.match(/^let atlasSynchronousReadScope = null;$/m);
assert(scopeInitializer,'Real synchronous-read scope initializer');
const functions=scopeInitializer[0]+'\n'+['withAtlasSynchronousReadScope','atlasSynchronousReadValue','atlasWorkspaceFeature','renderTab','atlasBonusOpenSharedWorkflow','atlasBonusSharedWorkflowContext','atlasBonusPreservedSharedWorkflowHost','atlasBonusMountSharedWorkflow','renderBonusTab'].map(fn).join('\n');
const fixtureScript=`
const ATLAS_SELF_SERVICE_TAB_IDS=["14"];
let activeTab=9, MOUNT_TABS=[], atlasBonusNavigationSnapshot=null, atlasBonusSectionCache=new Map();
let atlasWorkspaceAccess={validated:true,hasData:true},atlasActiveFeatureRequest=null,atlasCanonicalImportEvidencePromise=null,atlasHomeRenderPreparation=null;
window.AtlasFeatures={ready:()=>true};
window.getAtlasCentralStatus=()=>({configured:true,signedIn:!!actor});window.getAtlasRenderContextKey=()=>JSON.stringify([actor,profile,quarter,activeTab,accessAllowed]);
let actor='10000000-0000-4000-8000-000000000001',quarter='2026-Q1',accessAllowed=true;
let profile={user_id:actor,role:'admin',status:'active',allowed_community_ids:['10000000-0000-4000-8000-000000000002'],bonus_permissions:[]};
const noop=()=>{};
for(const name of ['destroyAtlasPortfolioMap','renderPortfolioHomeTab','renderSetupTab','renderOverviewTab','renderTrafficTab','renderCompCalculatorTab','renderRenewalsTab','renderReputationTab','renderCSVTab','renderReportingTab','renderAtlasSettingsTab','queueAtlasCentralPeopleLoad','syncAtlasWorkspaceCardVisibility','applyDashboardBackdrop','syncAtlasTopbar','applyAtlasAccessControlsToNavigation','attachEventListeners','queueActiveTabPhotoAssetHydration','queueAtlasPortfolioMapHydration'])window[name]=noop;
window.shouldRenderAtlasWelcomeDashboard=()=>false;window.shouldBlockAtlasSensitiveAccess=()=>!actor;window.atlasAccessDecision=()=>({ok:accessAllowed,reason:'Synthetic denial'});window.renderAtlasAccessDeniedPanel=()=>'<p>Denied</p>';window.renderAtlasCentralLoginRequiredPanel=()=>'<p>Sign in</p>';window.isPortfolioWorkspaceSelected=()=>true;
window.getAtlasAccessProfile=()=>profile;window.atlasBonusPeriodFromQuarter=()=>({periodKey:quarter});window.atlasBonusState=()=>({activeSection:'calculations'});window.atlasBonusBuildCalculationRows=()=>[];window.defaultBonusEngineState=()=>({filters:{}});window.atlasBonusSummary=()=>({employeeCount:1,criticalExceptions:0,projected:0});window.atlasBonusVisibleSections=()=>[['calculations','Calculations']];window.atlasBonusCan=()=>false;window.atlasBonusSectionVisible=()=>false;window.atlasBonusCurrency=String;window.atlasBonusJsArg=JSON.stringify;window.renderBonusEngineFilters=()=>'';window.renderBonusEngineSection=()=>'';window.atlasBonusRetainedRow={cache:{clear:noop}};
window.escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
window.fixture={permissions:{editEligibility:true},plans:[],runs:[],communities:[{id:'10000000-0000-4000-8000-000000000002',name:'Synthetic'}],employees:[{employeeId:'10000000-0000-4000-8000-000000000003',assignmentId:'10000000-0000-4000-8000-000000000004',employeeVersion:1,communityId:'10000000-0000-4000-8000-000000000002',name:'Synthetic original employee',eligibilityEditable:true}]};
window.calls=[];window.reads=[];window.failWrite=true;
window.ATLAS_CENTRAL={getSession:()=>actor?{user:{id:actor}}:null,getConfig:()=>({supabaseUrl:'https://synthetic.invalid'}),fetchJson:async(url,options)=>{const body=JSON.parse(options.body);window.calls.push({url,body});if(url.endsWith('atlas_bonus_workspace')){const result=structuredClone(window.fixture);return new Promise(resolve=>window.reads.push(()=>resolve(result)));}if(window.failWrite){window.failWrite=false;throw Error('Synthetic uncertain save');}const employee=window.fixture.employees[0];Object.assign(employee,body.p_payload,{employeeVersion:body.p_expected_version+1});return{employeeId:employee.employeeId,employeeVersion:employee.employeeVersion,bonusEligible:employee.bonusEligible,bonusEffectiveDate:employee.bonusEffectiveDate};}};
${functions}
renderTab();window.ready=true;
`;
const server=http.createServer(async(req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;try{if(pathname===base+'index.html'){res.setHeader('content-type','text/html');res.end('<!doctype html><div id="tab-panel-0" class="tab-panel"></div><div id="tab-panel-9" class="tab-panel"></div><script>'+fixtureScript+'</script>');return;}if(!pathname.startsWith(base+'features/bonus-workflow')||!pathname.endsWith('.mjs')){res.writeHead(404);res.end();return;}res.setHeader('content-type','text/javascript');res.end(await fs.readFile(path.join(root,pathname)));}catch(error){res.writeHead(500);res.end(error.message);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true}),page=await browser.newPage(),errors=[],requests=[];
page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
const host=page.locator('#atlas-bonus-shared-workflow'),readCount=n=>page.waitForFunction(n=>window.reads.length===n,n);
const finishRead=()=>page.evaluate(()=>window.reads.shift()());
const ready=()=>page.waitForFunction(()=>document.getElementById('atlas-bonus-shared-workflow')?.getAttribute('aria-busy')==='false');
try{
 await page.goto(origin+base+'index.html');await readCount(1);await page.evaluate(()=>window.firstHost=document.getElementById('atlas-bonus-shared-workflow'));
 for(let i=0;i<5;i++)await page.evaluate(()=>{renderTab();return new Promise(requestAnimationFrame);});
 assert.equal(await page.evaluate(()=>firstHost===document.getElementById('atlas-bonus-shared-workflow')),true);
 assert.equal(await page.evaluate(()=>calls.filter(call=>call.url.endsWith('atlas_bonus_workspace')).length),1,'Unrelated dashboard renders must not restart a pending read');
 await finishRead();await ready();assert.match(await host.textContent(),/Record employee eligibility/);assert.equal(await host.getAttribute('aria-busy'),'false');
 await page.getByText('Plan and eligibility setup',{exact:true}).click();const form=host.locator('[data-form=eligibility]');
 await form.locator('[name=assignmentId]').selectOption('10000000-0000-4000-8000-000000000004');await form.locator('[name=bonusEligible]').selectOption('false');await form.locator('[name=bonusEffectiveDate]').fill('2026-09-24');await form.locator('[name=reason]').fill('Preserve this reviewed input');
 await form.locator('[name=reason]').evaluate(el=>el.setSelectionRange(3,7));await page.evaluate(()=>{renderTab();renderTab();});assert.equal(await form.locator('[name=reason]').inputValue(),'Preserve this reviewed input');assert.equal(await form.locator('[name=bonusEligible]').inputValue(),'false');assert.deepEqual(await form.locator('[name=reason]').evaluate(el=>({focused:document.activeElement===el,start:el.selectionStart,end:el.selectionEnd})),{focused:true,start:3,end:7});
 await form.locator('button').click();await ready();assert.match(await host.innerText(),/Synthetic uncertain save/);
 await page.evaluate(()=>renderTab());await form.locator('button').click();await readCount(1);
 const writes=await page.evaluate(()=>calls.filter(call=>call.url.endsWith('atlas_bonus_eligibility_save')));assert.equal(writes.length,2);assert.equal(writes[0].body.p_request_id,writes[1].body.p_request_id,'Host preservation must retain uncertain request identity');
 await page.evaluate(()=>renderTab());await finishRead();await ready();assert.equal(await form.locator('[name=reason]').inputValue(),'');
 // Same-actor access changes invalidate both the node and a pending old-scope response.
 await host.locator('[data-refresh]').click();await readCount(1);await page.evaluate(()=>{profile={...profile,bonus_permissions:['view_bonus_module']};fixture.employees[0].name='Synthetic newly scoped employee';renderTab();});await readCount(2);
 assert.equal(await page.evaluate(()=>firstHost.isConnected),false);assert.equal(await page.evaluate(()=>firstHost===document.getElementById('atlas-bonus-shared-workflow')),false);
 await finishRead();await page.evaluate(()=>new Promise(requestAnimationFrame));assert.match(await host.innerText(),/Loading shared Bonus approvals/);assert.doesNotMatch(await host.innerText(),/Synthetic original employee/);
 await finishRead();await ready();assert.match(await host.textContent(),/Synthetic newly scoped employee/);
 // Actor and quarter changes also get separate lifecycles and no old form values.
 for(const change of ['employee','actor','quarter']){
   await page.evaluate(change=>{window.priorHost=document.getElementById('atlas-bonus-shared-workflow');if(change==='employee')profile={...profile,employee_id:'10000000-0000-4000-8000-000000000008'};else if(change==='actor'){actor='10000000-0000-4000-8000-000000000009';profile={...profile,user_id:actor};}else quarter='2026-Q2';renderTab();},change);
   await readCount(1);assert.equal(await page.evaluate(()=>priorHost.isConnected),false);await finishRead();await ready();
 }
 // A permissions change while another tab is active must detach the hidden sensitive form.
 await page.evaluate(()=>{window.priorHost=document.getElementById('atlas-bonus-shared-workflow');activeTab=0;accessAllowed=false;renderTab();});assert.equal(await page.evaluate(()=>priorHost.isConnected),false);assert.equal(await host.count(),0);
 assert.deepEqual(errors,[]);assert(requests.every(url=>url.startsWith(origin)),'No external request is allowed');
 console.log('PASS real Bonus dashboard rerenders preserve one pending workspace read, the live host, form values and uncertain request IDs; actor/access/quarter changes discard old responses and forms; loading aria-busy clears.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
