// Real Budget Builder UI, synthetic Central only: failed or overlapping saves cannot advance workflow.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url), {chromium} = require(process.env.ATLAS_PLAYWRIGHT || 'playwright');
const root = path.resolve('docs/portfolio-operations-dashboard');
const bootstrap = `
const cid='10000000-0000-4000-8000-000000000001', other='10000000-0000-4000-8000-000000000002';
window.calls=[];window.verified=false;window.month=10;
window.ATLAS_CENTRAL={
 getSession:()=>({user:{id:'30000000-0000-4000-8000-000000000001'}}),getStoredProfile:()=>({role:'vp'}),
 readCommunitiesForAccess:async()=>[{community_id:cid,display_name:'Synthetic One',units:100},{community_id:other,display_name:'Synthetic Two',units:100}],
 fetchJson:async(url,options)=>{
  const body=options?.body?JSON.parse(options.body):null;calls.push({url,body});
  if(url==='/rpc/atlas_read_budget_calendar')return {verified:window.verified,startMonth:window.month};
  if(url.startsWith('/atlas_communities?'))return [{version:7}];
  if(url==='/rpc/atlas_budget_builder_create_community') {window.verified=true;return other;}
  if(url==='/rpc/atlas_budget_benchmarks')return {};
  if(url==='/rpc/atlas_company_budget_my_role')return null;
  if(url==='/rpc/atlas_budget_builder_save')return {...body.p_metadata,draft_id:body.p_draft_id,community_id:body.p_community_id,payload:body.p_payload,revision:1,status:'gm_draft'};
  if(url==='/rpc/atlas_set_budget_fiscal_calendar') {window.verified=true;return {};}
  return [];
 }
};await import('/features/budget-v2/ui.mjs');`;
const html = '<!doctype html><html><body><div id="bb-context"></div><div id="bb-status"></div><div id="bb-app"></div><script type="module">'+bootstrap+'</script></body></html>';
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}const filename=path.resolve(root,'.'+url.pathname);if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}res.setHeader('content-type',filename.endsWith('.css')?'text/css':'application/javascript');res.end(await fs.readFile(filename));}catch(error){res.writeHead(500).end(error.message);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true}),page=await browser.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
const base='http://127.0.0.1:'+server.address().port;

async function start(){
 await page.locator('[data-startnew="scratch"]').click();await page.locator('[data-act="create"]').click();
 await page.locator('[data-scratch="units"]').fill('100');await page.locator('[data-scratch="units"]').press('Tab');
 await page.locator('[data-act="scratch"]').click();
 await page.locator('[data-act="confirmcal"]').waitFor();
}
try {
 await page.goto(base);await start();
 await page.locator('[data-cal="startMonth"]').selectOption('4');
 await page.locator('[data-ctx="community"]').selectOption('10000000-0000-4000-8000-000000000002');
 await page.locator('[data-act="create"]').click();assert.equal(await page.locator('[data-act="confirmcal"]').count(),0,'community switch clears the stale prompt');
 await page.locator('[data-act="scratch"]').click();await page.locator('[data-act="confirmcal"]').waitFor();
 assert.equal(await page.locator('[data-cal="startMonth"]').inputValue(),'1','new scope has no stale form value');
 await page.locator('[data-asset="student_bed"]').click();assert.equal(await page.locator('[data-act="confirmcal"]').count(),0,'asset switch clears the prompt');
 await page.locator('[data-act="scratch"]').click();await page.locator('[data-act="confirmcal"]').waitFor();
 assert.equal(await page.locator('[data-cal="startMonth"]').inputValue(),'8');
 await page.evaluate(()=>window.verified=true);await page.locator('[data-act="confirmcal"]').click();
 await page.waitForFunction(()=>document.querySelector('#bb-status').textContent.includes('already has a fiscal calendar'));
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.url==='/rpc/atlas_set_budget_fiscal_calendar').length),0,'concurrent confirmation preserves the now verified calendar');
 await page.goto(base);await start();await page.locator('[data-act="new"]').click();await page.locator('[data-act="create"]').click();
 assert.equal(await page.locator('[data-act="confirmcal"]').count(),0,'new draft clears the prompt');
 // A VP receives a ready calendar from atomic creation; an existing October calendar is never reconfirmed.
 await page.locator('[data-scratch="target"]').selectOption('new');await page.locator('[data-scratch="name"]').fill('Synthetic New');await page.locator('[data-scratch="name"]').press('Tab');
 await page.locator('[data-act="scratch"]').click();await page.waitForFunction(()=>calls.some(c=>c.url==='/rpc/atlas_budget_builder_save'));
 const calls=await page.evaluate(()=>window.calls);
 assert.equal(calls.filter(c=>c.url==='/rpc/atlas_budget_builder_create_community').length,1);
 assert.equal(calls.filter(c=>c.url==='/rpc/atlas_set_budget_fiscal_calendar').length,0);
 assert.equal(calls.find(c=>c.url==='/rpc/atlas_budget_builder_save').body.p_payload.model.periods[0],'2026-10','returned non-January calendar controls the budget');
 assert.deepEqual(errors,[]);console.log('PASS calendar prompt scope resets, concurrent calendar preservation, and VP scratch creation with existing fiscal calendar');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
