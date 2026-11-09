// Real Budget Builder UI, synthetic Central only: failed or overlapping saves cannot advance workflow.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url), {chromium} = require(process.env.ATLAS_PLAYWRIGHT || 'playwright');
const root = path.resolve('docs/portfolio-operations-dashboard');
const bootstrap = `
import {suggestStart} from '/features/budget-v2/scratch.mjs';
import {fiscalPeriods} from '/features/budget-v2/engine.mjs';
const cid='10000000-0000-4000-8000-000000000001', did='20000000-0000-4000-8000-000000000001';
window.calls=[]; window.failSave=true; window.deferSave=false;
window.fixture={draft_id:did, community_id:cid, fiscal_year:2027, plan_type:'budget', asset_class:'conventional', name:'Synthetic workflow budget', revision:3,status:new URLSearchParams(location.search).get('status') || 'gm_draft',payload:{documents:[],sources:[],model:suggestStart({name:'Synthetic property',units:100,assetClass:'conventional',marketRent:1500,fiscalYear:2027,periods:fiscalPeriods(2027),address:{state:'FL'},status:'operating'})}};
const testCase=new URLSearchParams(location.search).get('case');
if(testCase==='calibration') {
  fixture.payload.model.start='model'; fixture.payload.model.learned={'6537':{calibration:2,n:3}};
  fixture.payload.model.lines.find(line=>line.gl==='6537').t12={total:1200};
}
if(testCase==='missing') {
  fixture.plan_type='reforecast';
  Object.assign(fixture.payload.model,{closedMonths:0,actuals:{},actualEvidence:{periods:['2027-01','2027-02'],approvedComplete:false,completeSource:false,sourceGls:[]}});
}
window.ATLAS_CENTRAL={
 getSession:()=>({user:{id:'30000000-0000-4000-8000-000000000001'}}),
 getStoredProfile:()=>({role:'vp',display_name:'Synthetic VP'}),
 readCommunitiesForAccess:async()=>[{community_id:cid,display_name:'Synthetic property',units:100}],
 fetchJson:async(url,options)=>{
   const body=options?.body?JSON.parse(options.body):null; calls.push({url,body});
   if(url==='/rpc/atlas_budget_benchmarks') return {};
   if(url==='/rpc/atlas_company_budget_my_role') return null;
   if(url.startsWith('/atlas_budget_learning_observations?') && testCase==='calibration') return Array(3).fill({gl_code:'6537',value:400,basis:{model:100}});
   if(url==='/rpc/atlas_budget_builder_save') {
     if(window.deferSave) await new Promise(resolve=>window.releaseSave=resolve);
     if(window.failSave) throw Error('Synthetic save rejection: reload required');
     fixture={...fixture,revision:fixture.revision+1,payload:body.p_payload};return structuredClone(fixture);
   }
   if(url==='/rpc/atlas_budget_builder_transition') {fixture={...fixture,revision:fixture.revision+1,status:'regional_review'};return structuredClone(fixture);}
   if(url.startsWith('/rpc/atlas_budget_builder_')) throw Error('Unexpected publication call');
   if(url.startsWith('/atlas_budget_builder_drafts?')) return [structuredClone(fixture)];
   return [];
 }
};
await import('/features/budget-v2/ui.mjs');`;
const html = '<!doctype html><html><body><div id="bb-context"></div><div id="bb-status"></div><div id="bb-app"></div><script type="module">'+bootstrap+'</script></body></html>';
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}const filename=path.resolve(root,'.'+url.pathname);if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}res.setHeader('content-type',filename.endsWith('.css')?'text/css':'application/javascript');res.end(await fs.readFile(filename));}catch(error){res.writeHead(500).end(error.message);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true}),page=await browser.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
const base='http://127.0.0.1:'+server.address().port;
async function dirty(status){
 await page.goto(base+'?status='+status);await page.locator('[data-open]').click();
 await page.locator('[data-tab="drivers"]').click();
 await page.locator('[data-a="marketRent"]').fill('1650');await page.locator('[data-a="marketRent"]').press('Tab');
 await page.locator('[data-tab="summary"]').click();
}
try {
 for(const [status,action] of [['gm_draft','submit_to_regional'],['regional_review','regional_approve'],['vp_review','vp_approve']]){
   await dirty(status);await page.locator('[data-flow="'+action+'"]').click();
   await page.waitForFunction(()=>document.querySelector('#bb-status').textContent.includes('Synthetic save rejection'));
   const result=await page.evaluate(()=>({calls,revision:fixture.revision,status:fixture.status,text:document.querySelector('#bb-app').textContent}));
   assert.equal(result.calls.filter(x=>x.url==='/rpc/atlas_budget_builder_save').length,1);
   assert.equal(result.calls.filter(x=>x.url.startsWith('/rpc/') && /transition|publication/.test(x.url)).length,0,action+' must stop before transition/publication');
   assert.equal(result.revision,3);assert.equal(result.status,status);assert.match(result.text,/Unsaved changes/);
 }
 await dirty('gm_draft');await page.evaluate(()=>{window.failSave=false;window.deferSave=true;});
 await page.locator('[data-flow="submit_to_regional"]').click();
 await page.waitForFunction(()=>typeof releaseSave==='function');
 assert.equal(await page.locator('[data-flow="submit_to_regional"]').isDisabled(),true);
 await page.evaluate(()=>document.querySelector('[data-flow="submit_to_regional"]').dispatchEvent(new MouseEvent('click',{bubbles:true})));
 assert.equal(await page.evaluate(()=>calls.filter(x=>x.url.includes('transition')).length),0);
 await page.evaluate(()=>releaseSave());
 await page.waitForFunction(()=>fixture.status==='regional_review');
 const result=await page.evaluate(()=>calls.filter(x=>x.url==='/rpc/atlas_budget_builder_transition'));
 assert.equal(result.length,1);assert.equal(result[0].body.p_expected_revision,4,'transition consumes exactly the saved revision');
 // Opening a persisted model keeps its calibration, even when newer decisions exist.
 for(let reload=0;reload<2;reload++) {
   await page.goto(base+'?case=calibration');await page.locator('[data-open]').click();
   await page.locator('[data-tab="expenses"]').click();await page.locator('[data-act="expand"]').click();
   assert.equal(await page.locator('[data-ov="6537"]').inputValue(),'2472','saved 2x calibration stays fixed; new 4x decisions do not rewrite the displayed budget');
   assert.equal(await page.evaluate(()=>calls.filter(call=>call.url==='/rpc/atlas_budget_builder_save').length),0);
 }
 // Unavailable amounts stay visibly unavailable and cannot be unlocked by editing count.
 await page.goto(base+'?case=missing');await page.locator('[data-open]').click();
 await page.locator('[data-tab="expenses"]').click();await page.locator('[data-act="expand"]').click();
 assert.equal(await page.locator('[data-ov="6537"]').inputValue(),'');
 assert.equal(await page.locator('[data-ov="6537"]').getAttribute('placeholder'),'Unavailable');
 await page.locator('[data-gl-toggle="6537"]').click();
 assert.equal(await page.locator('[data-mon="6537:0"]').inputValue(),'');
 assert.equal(await page.locator('[data-mon="6537:0"]').isDisabled(),true);
 assert.notEqual(await page.locator('[data-mon="6537:2"]').inputValue(),'');
 await page.locator('[data-tab="leasing"]').click();
 assert.equal(await page.locator('[data-closed]').isDisabled(),true);
 await page.evaluate(()=>{const input=document.querySelector('[data-closed]');input.value='0';input.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.locator('[data-tab="summary"]').click();await page.locator('[data-flow="submit_to_regional"]').click();
 assert.match(await page.locator('#bb-status').textContent(),/Closed-month actuals are unavailable/);
 assert.equal(await page.evaluate(()=>calls.filter(call=>call.url.startsWith('/rpc/') && /transition|publication/.test(call.url)).length),0);
 await page.locator('[data-tab="investor"]').click();
 assert.equal(await page.locator('[data-act="pdf"]').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS property workflow: failed save blocks transitions; concurrent action blocked; saved revision and calibration stable; unavailable actual inputs remain blank and locked; missing evidence blocks approval and export.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
