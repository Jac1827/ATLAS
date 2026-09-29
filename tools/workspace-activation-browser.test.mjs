import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright'),Archive=require('../docs/portfolio-operations-dashboard/migration-archive.js'),Zip=require('../docs/portfolio-operations-dashboard/vendor/jszip.min.js');
const archive=await Archive.pack({keys:{rise_ops_global_v1:'{}'},indexedDb:{communityData:{Example:{zero:0,missing:null}}}},[{key:'atlas_data_import_2_state_v1',value:{batches:[],lineage:[],canonicalRecords:[],sourceArchive:[]}}],Zip);
const root=path.resolve('docs/portfolio-operations-dashboard'),actor='00000000-0000-0000-0000-000000000001';
const parent={document_key:'atlas_dashboard_state_v1',module_key:'dashboard',version:2,updated_at:'2026-09-29T12:00:00Z',payload:{bundle:archive}};
let documents,role,mode,profileReads,writes,hold,requests=[];
function reset(){documents=new Map([[parent.document_key,structuredClone(parent)]]);role='admin';mode='normal';profileReads=0;writes=0;hold=null;}
reset();
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://local');requests.push({method:req.method,path:url.pathname});res.setHeader('content-type','application/json');
 if(url.pathname==='/rest/v1/atlas_user_profiles'){profileReads++;if(mode==='hold'&&profileReads===3)await new Promise(r=>hold=r);res.end(JSON.stringify([{user_id:actor,role,status:'active',account_status:'active'}]));return;}
 if(url.pathname==='/rest/v1/atlas_communities'){res.end('[]');return;}
 if(url.pathname==='/rest/v1/atlas_app_documents'){const key=url.searchParams.get('document_key')?.slice(3),row=documents.get(key);res.end(JSON.stringify(row?[row]:[]));return;}
 if(url.pathname==='/rest/v1/rpc/atlas_publish_workspace_projection'&&req.method==='POST'){
   let raw='';for await(const chunk of req)raw+=chunk;const {p_projection:projection}=JSON.parse(raw);writes++;
   const key=`atlas_workspace_projection_v1:${projection.source.archiveHash}:${projection.source.version}`;
   documents.set(key,{document_key:key,module_key:'dashboard',source_module:'workspace_projection',version:1,payload:projection});
   if(mode==='lost'){res.writeHead(503);res.end(JSON.stringify({message:'Synthetic response interruption'}));return;}
   if(mode==='tamper')projection.communityData.Example.zero=9;
   res.end(JSON.stringify({status:'published',version:1}));return;
 }
 if(req.method!=='GET'){res.writeHead(405);res.end('{}');return;}
 try{const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('content-type',/\.(js|mjs)$/.test(file)?'text/javascript':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext();await context.addInitScript(({origin,actor})=>{
   window.ATLAS_CENTRAL_CONFIG={supabaseUrl:origin,apiBaseUrl:'',accessApiBaseUrl:origin};
   localStorage.setItem('atlas_central_auth_session_v1',JSON.stringify({access_token:'synthetic-only',user:{id:actor},expires_at:Date.now()/1000+3600}));
   window.idbCalls=0;indexedDB.open=indexedDB.deleteDatabase=()=>{window.idbCalls++;throw Error('Operational IndexedDB is forbidden');};
 },{origin,actor});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 let scenario=0;const open=async(fragment=`version=2&archiveHash=${archive.sha256}`)=>{await page.goto(origin+'/workspace-activation.html?scenario='+(++scenario)+'#'+fragment);await page.waitForFunction(()=>typeof ATLAS_CENTRAL==='object');};
 const phase=expected=>page.waitForFunction(expected=>document.querySelector('#activation-status').dataset.phase===expected,expected);
 const inspect=async()=>{await page.getByRole('button',{name:'Check saved source'}).click();};
 const prepare=()=>page.getByRole('button',{name:'Prepare verified workspace'}).click();
 await open();assert.equal(profileReads,0);assert.equal(writes,0);assert(await page.getByRole('button',{name:'Prepare verified workspace'}).isDisabled());
 await inspect();await phase('ready');assert.equal(writes,0);assert.match(await page.locator('#activation-source').textContent(),/Saved version 2/);
 await prepare();await phase('complete');assert.equal(writes,1);assert.equal(profileReads,4);await inspect();await phase('ready');await prepare();await phase('complete');assert.equal(writes,1);
 reset();await open('version=1&archiveHash='+archive.sha256);await inspect();await phase('error');assert.equal(writes,0);assert(await page.getByRole('button',{name:'Prepare verified workspace'}).isDisabled());
 reset();role='viewer';await open();await inspect();await phase('error');assert.equal(writes,0,'Cached admin from prior run cannot replace fresh server authorization');
 reset();await open();await inspect();await phase('ready');documents.get(parent.document_key).version=3;await prepare();await phase('pending');assert.equal(writes,0);
 reset();await open();await inspect();await phase('ready');await page.locator('#activation-version').fill('3');await phase('stopped');assert(await page.getByRole('button',{name:'Prepare verified workspace'}).isDisabled());
 reset();await open();await inspect();await phase('ready');mode='hold';await prepare();while(!hold)await new Promise(r=>setTimeout(r,10));
 await page.evaluate(()=>{const session=JSON.parse(localStorage.getItem('atlas_central_auth_session_v1'));session.user.id='different-actor';localStorage.setItem('atlas_central_auth_session_v1',JSON.stringify(session));window.dispatchEvent(new CustomEvent('atlas-central-auth-change'));});await phase('stopped');hold();mode='normal';await page.waitForTimeout(50);assert.equal(writes,0);
 reset();await open();await inspect();await phase('ready');mode='hold';await prepare();while(!hold)await new Promise(r=>setTimeout(r,10));
 await page.evaluate(()=>{const session=JSON.parse(localStorage.getItem('atlas_central_auth_session_v1'));session.access_token='refreshed-synthetic-only';session.expires_at+=60;localStorage.setItem('atlas_central_auth_session_v1',JSON.stringify(session));window.dispatchEvent(new CustomEvent('atlas-central-auth-change',{detail:{reason:'session-storage'}}));const profile=JSON.parse(localStorage.getItem('atlas_central_profile_v1'));profile.access_verified_at=new Date().toISOString();localStorage.setItem('atlas_central_profile_v1',JSON.stringify(profile));window.dispatchEvent(new CustomEvent('atlas-central-auth-change',{detail:{reason:'profile-storage'}}));});assert.equal(await page.locator('#activation-status').getAttribute('data-phase'),'preparing');hold();mode='normal';await phase('complete');assert.equal(writes,1);
 reset();await open();await inspect();await phase('ready');mode='hold';await prepare();while(!hold)await new Promise(r=>setTimeout(r,10));await page.getByRole('button',{name:'Stop',exact:true}).click();await phase('stopped');hold();mode='normal';await page.waitForTimeout(50);assert.equal(writes,0);
 reset();await open();await inspect();await phase('ready');mode='lost';await prepare();await phase('pending');assert.equal(writes,1);mode='normal';await inspect();await phase('ready');await prepare();await phase('complete');assert.equal(writes,1,'Ambiguous outcome resolved by exact readback on explicit retry');
 reset();await open();await inspect();await phase('ready');mode='tamper';await prepare();await phase('pending');assert.equal(writes,1);assert.match(await page.locator('#activation-detail').textContent(),/fingerprint/);
 assert.equal(await page.evaluate(()=>idbCalls),0);assert.deepEqual(errors,[]);assert(!requests.some(r=>r.path.includes('workspace-core')));
 assert(requests.every(r=>r.method==='GET'||r.method==='POST'&&r.path==='/rest/v1/rpc/atlas_publish_workspace_projection'));
 const keys=await page.evaluate(()=>Object.keys(localStorage));assert(keys.every(key=>['atlas_central_auth_session_v1','atlas_central_profile_v1'].includes(key)));
 console.log('PASS standalone activation browser: actual central client/server access, explicit source check and prepare, worker/readback, no auto-write, stale/unauthorized denial, input/auth/user cancellation, ambiguous idempotent retry, tamper pending, no operational IndexedDB/core or other write.');
}finally{hold?.();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
