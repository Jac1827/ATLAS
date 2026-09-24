import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const root=path.resolve('docs/portfolio-operations-dashboard');
const core=fs.readFileSync(path.join(root,'workspace-core.js'),'utf8');
const statusSource=core.match(/^function getAtlasCentralStatus\(\) \{[\s\S]*?^\}/m)[0];
for(const protocol of ['http:','https:','file:']){
  const c={window:{location:{protocol}}};vm.createContext(c);vm.runInContext(statusSource,c);
  assert.equal(c.getAtlasCentralStatus().clientUnavailable,protocol!=='file:');
  c.window.ATLAS_CENTRAL={getStatus:()=>({configured:false,mode:'legacy-migration'})};
  assert.equal(c.getAtlasCentralStatus().configured,false,'A loaded client can explicitly select offline migration mode');
}
const server=http.createServer((req,res)=>{
  if(req.url==='/fixture-blank'){res.setHeader('Content-Type','text/html');res.end('<html></html>');return;}
  try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',file.endsWith('.html')?'text/html':/\.(mjs|js)$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage(),errors=[],operational=[];let blockClient=true;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin){if(blockClient&&url.pathname.endsWith('/centralization/atlas-central-client.js'))return route.abort();return route.continue();}
    if(/\/(rest|auth)\/v1\/|\/api\//.test(url.pathname))operational.push(url.pathname);
    return route.fulfill({status:200,body:''});
  });
  await page.goto(origin+'/fixture-blank');
  const rawKeys=['rise_ops_dashboard_data_v1','rise_leasing_v5','rise_ops_global_v1','rise_performance_platform_github_v1','rise_ops_property_catalog_v1','atlas_shared_property_graph_v1','atlas_shared_manual_field_locks_v1','atlas_marketing_people_links_v1','rise_weekly_portfolio_snapshot_v1'];
  await page.evaluate(async keys=>{
    for(const key of keys)localStorage.setItem(key,JSON.stringify({private:'OTHER_ACTOR_PRIVATE_CACHE',employees:[{name:'OTHER_ACTOR_PRIVATE_EMPLOYEE'}]}));
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('atlas_rise_state_v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('records',{keyPath:'key'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put({key:'community_data',value:{OtherActor:{private:'OTHER_ACTOR_PRIVATE_CACHE'}}});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  },rawKeys);
  await page.addInitScript(keys=>{
    window.fixtureRawReads=[];window.fixtureDatabases=[];
    const read=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(keys.includes(key))window.fixtureRawReads.push(key);return read.call(this,key);};
    const open=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{window.fixtureDatabases.push(args[0]);return open(...args);};
  },rawKeys);
  await page.goto(origin+'/index.html');
  await page.waitForFunction(()=>typeof atlasDashboardInitializationComplete!=='undefined'&&atlasDashboardInitializationComplete);
  const blocked=await page.evaluate(()=>({status:getAtlasCentralStatus(),validated:atlasWorkspaceAccess.validated,hasData:atlasWorkspaceAccess.hasData,names:Object.keys(savedData),rawReads:fixtureRawReads,databases:fixtureDatabases}));
  assert.equal(blocked.status.clientUnavailable,true);assert.equal(blocked.validated,false);assert.equal(blocked.hasData,false);assert.deepEqual(blocked.names,[]);assert.deepEqual(blocked.rawReads,[]);assert(!blocked.databases.includes('atlas_rise_state_v1'));
  assert.match(await page.locator('#tab-panel-0').innerText(),/Workspace source unavailable/);
  for(const tab of [8,14]){await page.evaluate(tab=>setTab(tab),tab);assert.match(await page.locator(`#tab-panel-${tab}`).innerText(),/Workspace source unavailable/);}
  assert(!(await page.locator('body').innerText()).includes('OTHER_ACTOR_PRIVATE'));
  assert.deepEqual(operational,[],'A missing authorization client makes no operational API requests');
  assert.equal(await page.evaluate(()=>!!window.AtlasReports),false,'The report workspace does not mount');
  blockClient=false;
  await Promise.all([page.waitForNavigation(),page.locator('#tab-panel-14').getByRole('button',{name:'Retry',exact:true}).click()]);
  await page.waitForFunction(()=>typeof atlasDashboardInitializationComplete!=='undefined'&&atlasDashboardInitializationComplete&&!!window.ATLAS_CENTRAL);
  assert.equal(await page.evaluate(()=>getAtlasCentralStatus().configured),true);
  assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.validated),false,'Recovery proceeds to sign-in, not unbound cache adoption');
  assert.equal(await page.evaluate(()=>atlasWorkspaceAccess.hasData),false);
  assert.deepEqual(await page.evaluate(()=>fixtureRawReads),[]);
  assert.deepEqual(errors,[]);
  for(const key of rawKeys)assert((await page.evaluate(key=>localStorage.getItem(key),key)).includes('OTHER_ACTOR_PRIVATE_CACHE'));
  console.log('PASS hosted missing-client failure closes hydration/render/API paths, retains legacy bytes, and Retry recovers to normal sign-in; explicit offline mode remains available.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
