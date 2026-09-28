// Exercise the actual navigation adapter with controlled asynchronous workspace
// initialization. No credentials, remote requests or financial writes are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const source=await fs.readFile(process.env.ATLAS_NAVIGATION_SOURCE||path.join(import.meta.dirname,'../docs/portfolio-operations-dashboard/reforecast-navigation.js'),'utf8');
const workspace=`let instance;
const render=s=>{if(!s.el.isConnected)return;s.el.innerHTML=s.mode==='workspace'&&s.record?'<input data-edit="name" value="'+s.record+'">':'<h2>'+s.mode+'</h2>';};
export async function mountReforecast(el,{mode}){const t=window.test;t.mounts++;t.active++;t.maxActive=Math.max(t.maxActive,t.active);const cold=!instance;if(t.holdMount){t.holdMount=false;await new Promise(resolve=>t.releaseMount=resolve);}if(cold)instance={};instance.el=el;instance.mode=mode;render(instance);t.active--;return instance;}
export async function openBudgetReview(detail){window.test.reviews.push(detail);instance.record=detail.scenarioId||detail.reviewId;instance.mode='workspace';render(instance);}
export async function createRecommendedReforecast(detail){window.test.creates.push(detail);if(window.test.holdCreate)await new Promise(resolve=>window.test.releaseCreate=resolve);instance.record='created';instance.mode='workspace';render(instance);}
export function clearReforecastSession(){instance=null;window.test.clears++;}`;
const html=`<!doctype html><div id="app"></div><script>
window.test={mounts:0,active:0,maxActive:0,reviews:[],creates:[],clears:0,holdMount:false,holdCreate:false};
window.actor='actor-a';window.profile={role:'executive',allowed_community_ids:['community-a']};
window.ATLAS_CENTRAL={getSession:()=>({user:{id:actor}}),getStoredProfile:()=>profile};
window.RBB={views:{dashboard:()=>'<h2>dashboard</h2>'},budgetNavigation:{groups:[['forecast','Forecast',[]],['reports','Reports',[]]]}};
RBB.app={VIEWS:[],state:{activeProperty:'property-a',budgetYear:2026},view:'dashboard',go(view){this.view=view;this.render();},setProperty(id){this.state.activeProperty=id;this.render();},setYear(year){this.state.budgetYear=year;this.render();},render(){document.getElementById('app').innerHTML=RBB.views[this.view]?.()||'';},toast(message){test.lastToast=message;},scenario:()=>({type:'draft'}),publishToAtlas(){}};
</script><script src="/reforecast-navigation.js"></script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');if(req.url==='/')res.end(html);else if(req.url.startsWith('/reforecast-navigation.js'))res.end(source);else if(req.url.startsWith('/features/reforecast-ui.mjs'))res.end(workspace);else if(req.url.startsWith('/features/reforecast-legacy-bridge.mjs'))res.end('export function installLegacyReforecastBridge(){};export function clearLegacyReforecastCache(){}');else if(req.url.startsWith('/features/saved-str-programmes.mjs'))res.end('export function installSavedStrProgrammes(){}');else{res.statusCode=404;res.end();}});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true});
 const cases=['cold_review','startup_rerender_during_mount','startup_rerender_after_review','newer_review','explicit_navigation','internal_workflow_navigation','property_change','year_change','property_change_after_review','year_change_after_review','account_change','profile_change','untrusted_origin','create_once','create_rerender','month_end_review'];
 for(const scenario of cases){
  const page=await browser.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/');
  const review=(id='scenario-a')=>page.evaluate(id=>window.postMessage({type:'atlas-reforecast-navigate',view:'reforecastapprovals',communityId:'community-a',scenarioId:id},location.origin),id);
  if(scenario==='untrusted_origin'){
   await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://untrusted.invalid',source:window,data:{type:'atlas-reforecast-navigate',view:'reforecastapprovals',scenarioId:'untrusted'}})));
   assert.equal(await page.locator('h2').innerText(),'dashboard');assert.equal(await page.evaluate(()=>test.mounts),0);
  }else if(scenario.startsWith('create')){
   await page.evaluate(hold=>{test.holdCreate=hold;document.dispatchEvent(new CustomEvent('atlas-create-reforecast',{detail:{communityId:'community-a',period:'2026-09'}}));},scenario==='create_rerender');
   if(scenario==='create_rerender'){await page.waitForFunction(()=>test.releaseCreate);await page.evaluate(()=>{RBB.app.render();test.releaseCreate();});}
   await page.locator('[data-edit="name"]').waitFor();assert.equal(await page.locator('[data-edit="name"]').inputValue(),'created');
   await page.evaluate(()=>RBB.app.render());await page.locator('[data-edit="name"]').waitFor();assert.equal(await page.evaluate(()=>test.creates.length),1);
  }else if(scenario==='month_end_review'){
   await page.evaluate(()=>window.postMessage({type:'atlas-reforecast-navigate',view:'reforecastapprovals',communityId:'community-a',reviewId:'close-a'},location.origin));await page.locator('[data-edit="name"]').waitFor();assert.equal(await page.locator('[data-edit="name"]').inputValue(),'close-a');assert.equal(await page.evaluate(()=>test.reviews[0].reviewId),'close-a');
   await page.evaluate(()=>RBB.app.render());await page.locator('h2').waitFor();assert.equal(await page.evaluate(()=>test.reviews.length),1,'Background render must not reopen a package dialog');
  }else{
   await page.evaluate(()=>test.holdMount=true);await review();await page.waitForFunction(()=>test.releaseMount);
   assert.equal(await page.evaluate(()=>test.mounts),1,'A cold route has exactly one initializing mount');
   if(scenario==='startup_rerender_during_mount')await page.evaluate(()=>RBB.app.render());
   if(scenario==='newer_review')await review('scenario-b');
   if(scenario==='explicit_navigation')await page.evaluate(()=>RBB.app.go('reforecasthistory'));
   if(scenario==='property_change')await page.evaluate(()=>RBB.app.setProperty('property-b'));
   if(scenario==='year_change')await page.evaluate(()=>RBB.app.setYear(2027));
   if(scenario==='account_change')await page.evaluate(()=>{actor='actor-b';window.dispatchEvent(new Event('atlas-central-auth-change'));});
   if(scenario==='profile_change')await page.evaluate(()=>profile={role:'executive',allowed_community_ids:[]});
   await page.evaluate(()=>test.releaseMount());
   if(['account_change','profile_change'].includes(scenario)){
    await page.waitForFunction(()=>test.active===0);assert.equal(await page.evaluate(()=>test.reviews.length),0,'A changed account/access scope cannot open the captured record');assert.equal(await page.locator('[data-edit="name"]').count(),0);
   }else if(['explicit_navigation','property_change','year_change'].includes(scenario)){
    await page.getByRole('heading',{name:scenario==='explicit_navigation'?'history':'approvals',exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.reviews.length),0);
   }else{
    await page.locator('[data-edit="name"]').waitFor();assert.equal(await page.locator('[data-edit="name"]').inputValue(),scenario==='newer_review'?'scenario-b':'scenario-a');assert.equal(await page.evaluate(()=>test.reviews.length),1);
    if(scenario==='startup_rerender_after_review'){await page.evaluate(()=>RBB.app.render());await page.locator('[data-edit="name"]').waitFor();assert.equal(await page.locator('[data-edit="name"]').inputValue(),'scenario-a');assert.equal(await page.evaluate(()=>test.reviews.length),1);}
    if(scenario==='internal_workflow_navigation'){await page.evaluate(()=>{const button=document.createElement('button');button.dataset.workspaceView='history';document.body.append(button);button.click();button.remove();RBB.app.render();});await page.getByRole('heading',{name:'approvals',exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.reviews.length),1,'An internal workflow selection cancels the captured exact-record intent');}
    if(scenario.endsWith('_change_after_review')){await page.evaluate(scenario=>scenario.startsWith('property')?RBB.app.setProperty('property-b'):RBB.app.setYear(2027),scenario);await page.getByRole('heading',{name:'approvals',exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.reviews.length),1,'Explicit property/year navigation must not reopen a completed review intent');}
   }
  }
  assert.equal(await page.evaluate(()=>test.maxActive),scenario==='untrusted_origin'?0:1,'Route mounts never initialize in parallel');assert.deepEqual(errors,[]);console.log('PASS',scenario);await page.close();
 }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
