import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
const source=fs.readFileSync('docs/portfolio-operations-dashboard/features/moveout-state-store.mjs');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/store.mjs'?'text/javascript':'text/html');res.end(req.url==='/store.mjs'?source:'<!doctype html><title>Shared recovery quota regression</title>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 const before=await page.evaluate(async()=>{
  const {createMetadataStorage}=await import('/store.mjs');
  localStorage.setItem('filler','x'.repeat(5*1024*1024-1000));
  for(let i=0;i<100;i++){try{localStorage.setItem('fill'+i,'x'.repeat(100));}catch{break;}}
  let rejected=false;try{localStorage.setItem('outbox','x'.repeat(4000));}catch{rejected=true;}
  const storage=createMetadataStorage({indexedDB,legacyStorage:localStorage});
  const value=JSON.stringify({version:4,pending:{requestId:'fixed-retry-identity',payload:'x'.repeat(4000)}});
  await storage.setItem('outbox',value);return {rejected,value:await storage.getItem('outbox')};
 });
 assert.equal(before.rejected,true);await page.reload();const after=await page.evaluate(async()=>{const {createMetadataStorage}=await import('/store.mjs');return await createMetadataStorage({indexedDB,legacyStorage:localStorage}).getItem('outbox');});
 assert.equal(after,before.value);assert.equal(JSON.parse(after).pending.requestId,'fixed-retry-identity');
 console.log('PASS full localStorage does not block durable shared outbox; IndexedDB retry identity survives browser reload');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
