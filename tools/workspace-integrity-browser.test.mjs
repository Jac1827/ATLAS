import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import {createRequire} from 'node:module';import {digest} from '../docs/portfolio-operations-dashboard/features/workspace-bootstrap.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const root=path.resolve('docs/portfolio-operations-dashboard'),body={format:1,rows:Array.from({length:12000},(_,i)=>({index:i,known:i%3===0?0:i,unknown:i%4===0?null:'synthetic',nested:{b:2,a:1}}))},expected=await digest(body);
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://local').pathname;if(pathname==='/harness.html'){res.setHeader('content-type','text/html');res.end('<title>Isolated workspace integrity</title>');return;}const file=path.resolve(root,'.'+pathname);res.setHeader('content-type','text/javascript');try{if(!file.startsWith(root+path.sep))throw Error('scope');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/harness.html`);
 const result=await page.evaluate(async body=>{
  const NativeWorker=Worker;let created=0,terminated=0;window.Worker=class extends NativeWorker{constructor(...args){super(...args);created++;}terminate(){terminated++;super.terminate();}};
  const {digestWorkspaceBody,readWorkspace,digest}=await import('./features/workspace-bootstrap.mjs');
  const before=JSON.stringify(body),contentHash=await digestWorkspaceBody(body);
  const controller=new AbortController();const pending=digestWorkspaceBody(body,{signal:controller.signal});controller.abort();let cancellation;try{await pending;}catch(error){cancellation=error.name;}
  const source={documentKey:'atlas_dashboard_state_v1',version:1,archiveHash:'a'.repeat(64),effectiveAt:'2026-09-24T12:00:00Z'},projectionBody={format:1,source,communityData:{Synthetic:{unknown:null,known:0}},opsGlobalData:{},importState:{}};
  const projection={...projectionBody,contentHash:await digest(projectionBody)},envelope={status:'available',source,projection,scopeFingerprint:'b'.repeat(64),projectionVersion:1,projectionContentHash:'c'.repeat(64),projectionHashFormat:'postgres-jsonb-sha256',fullProjection:true};
  const full=await readWorkspace({fetchJson:async()=>envelope});
  const filtered=await readWorkspace({fetchJson:async()=>({...envelope,fullProjection:false,projection:projectionBody})});
  let tamper;try{await readWorkspace({fetchJson:async()=>({...envelope,projection:{...projection,communityData:{Synthetic:{known:1}}}})});}catch(error){tamper=error.message;}
  window.Worker=NativeWorker;
  return {contentHash,unchanged:before===JSON.stringify(body),cancellation,created,terminated,full:full.projection,filtered:filtered.projection,expectedProjection:projection,tamper};
 },body);
 assert.equal(result.contentHash,expected);assert.equal(result.unchanged,true);assert.equal(result.cancellation,'AbortError');assert.equal(result.created,5);assert.equal(result.terminated,result.created,'Success, cancellation and tamper all terminate their owned worker');assert.deepEqual(result.full,result.expectedProjection);assert.deepEqual(result.filtered,result.expectedProjection);assert.match(result.tamper,/fingerprint mismatch/);
 console.log('PASS real workspace integrity worker canonical hash parity, null/zero/source binding, full/filtered validation, tamper rejection, unchanged inputs and success/abort/failure worker cleanup.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
