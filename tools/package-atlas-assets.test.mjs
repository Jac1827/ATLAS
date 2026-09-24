import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createRequire} from 'node:module';
import {packageAssets, verifyRelease} from './package-atlas-assets.mjs';
import {loadWorker} from './load-worker-for-node-test.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-assets-'));
const source=path.join(tmp,'source'), out=path.join(tmp,'out'), retained=path.join(tmp,'retained');
const write=async(relative,text)=>{const target=path.join(source,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,text);};
let browser,server;
try {
  await write('index.html','<!doctype html><head><meta http-equiv="refresh" content="0;url=app/"></head><body>Continue</body>');
  await write('app/index.html',`<!doctype html><html><head><link rel="stylesheet" href="./css/style.css?v=mutable"></head><body><div id="sample">Asset fixture</div><iframe src="./nested/frame.html?mode=test#section"></iframe><script src="./classic.js"></script><script type="module">import {value} from './module.mjs?v=mutable'; window.eager=value; window.lazy=()=>import('./lazy.mjs?v=mutable'); window.workerValue=new Promise(resolve=>{const worker=new Worker('./worker.js?v=mutable');worker.onmessage=event=>{resolve(event.data);worker.terminate();};});</script></body></html>`);
  await write('app/classic.js',`window.classic=true; window.lateClassic=()=>new Promise(resolve=>{const s=document.createElement('script');s.src='./late.js?v=mutable';s.onload=()=>resolve(window.late);document.head.append(s);});`);
  await write('app/module.mjs',`export {value} from './dependency.mjs'; export const worker=new URL('./worker.js',import.meta.url);`);
  await write('app/dependency.mjs',`export const value='first';`);
  await write('app/lazy.mjs',`import {value} from './dependency.mjs'; export {value};`);
  await write('app/late.js',`window.late='first';`);
  await write('app/worker.js',`postMessage('worker-first');`);
  await write('app/nested/frame.html',`<!doctype html><html><head><link rel="stylesheet" href="../css/style.css"></head><body id="section"><a href="#section">Section</a><script type="module">import {value} from '../module.mjs'; window.frameValue=value; window.frameWorker=new Promise(resolve=>{const worker=new Worker(new URL('../module-worker.mjs',import.meta.url),{type:'module'});worker.onmessage=e=>{resolve(e.data);worker.terminate();};});</script></body></html>`);
  await write('app/module-worker.mjs',`import {value} from './dependency.mjs';postMessage('module-'+value);`);
  await write('app/css/style.css',`@import './nested.css'; #sample {background-image:url('../image.svg?v=mutable#shape');}`);
  await write('app/css/nested.css',`#sample {color:rgb(1,2,3)}`);
  await write('app/image.svg','<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect id="shape" width="1" height="1"/></svg>');
  await assert.rejects(packageAssets({source,out}),/retained releases are required/);
  const first=await packageAssets({source,out,allowEmptyRetained:true});
  assert.equal((await fs.readFile(path.join(out,'index.html'),'utf8')),await fs.readFile(path.join(source,'index.html'),'utf8'),'root redirect stays canonical');
  assert.match(await fs.readFile(path.join(out,'app/index.html'),'utf8'),new RegExp(`<base data-atlas-asset-release="${first.releaseId}"`));
  assert.equal(await fs.readFile(path.join(out,`_atlas-assets/${first.releaseId}/app/index.html`),'utf8'),await fs.readFile(path.join(source,'app/index.html'),'utf8'),'retained HTML bytes exact');
  assert.equal((await packageAssets({source,out})).releaseId,first.releaseId,'deterministic build');
  await fs.cp(path.join(out,'_atlas-assets'),path.join(retained,'_atlas-assets'),{recursive:true});
  const requests=[];
  server=http.createServer(async(req,res)=>{
    try {
      let pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
      requests.push(pathname);
      if(pathname.startsWith('/ATLAS/')) pathname=pathname.slice('/ATLAS'.length);
      if(pathname.endsWith('/')) pathname+='index.html';
      const file=path.join(out,pathname);
      if(!file.startsWith(out+path.sep)) throw Error('outside');
      const type=({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream';
      res.writeHead(200,{'content-type':type});res.end(await fs.readFile(file));
    }catch{res.writeHead(404);res.end('Missing');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});
  for(const prefix of ['', '/ATLAS']) {
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+prefix+'/app/index.html?state=kept#shell');
    await page.waitForFunction(()=>window.eager==='first'&&window.classic);
    assert.equal(await page.evaluate(()=>window.workerValue),'worker-first');
    const frame=page.frames().find(frame=>frame!==page.mainFrame());
    await frame.waitForFunction(()=>window.frameValue==='first');
    assert.equal(await frame.evaluate(()=>window.frameWorker),'module-first');
    assert(frame.url().includes(`/_atlas-assets/${first.releaseId}/app/nested/frame.html?mode=test#section`));
    assert.equal(await page.locator('#sample').evaluate(el=>getComputedStyle(el).color),'rgb(1, 2, 3)');
    await page.waitForFunction(()=>performance.getEntriesByType('resource').some(e=>e.name.includes('image.svg')));
    assert.equal(new URL(page.url()).pathname,prefix+'/app/index.html','canonical address is stable');
    // Publish a changed tree while this document remains open. Its not-yet-loaded
    // features must still use the prior dependency and classic script bytes.
    await write('app/dependency.mjs',`export const value='second';`);
    await write('app/late.js',`window.late='second';`);
    const second=await packageAssets({source,out,retained});
    assert.notEqual(second.releaseId,first.releaseId);
    assert.equal(second.releaseCount,2);
    assert.equal(await page.evaluate(async()=> (await window.lazy()).value),'first');
    assert.equal(await page.evaluate(()=>window.lateClassic()),'first');
    assert.deepEqual(errors,[]);
    await page.close();
    await write('app/dependency.mjs',`export const value='first';`);
    await write('app/late.js',`window.late='first';`);
    await packageAssets({source,out,retained});
  }
  assert(requests.some(url=>url.includes(`/_atlas-assets/${first.releaseId}/app/css/nested.css`)));
  assert(requests.some(url=>url.includes(`/_atlas-assets/${first.releaseId}/app/image.svg`)));
  const before=await fs.readFile(path.join(out,'atlas-asset-manifest.json'),'utf8');
  await assert.rejects(packageAssets({source,out,maxFiles:1}),/safety limit/);
  assert.equal(await fs.readFile(path.join(out,'atlas-asset-manifest.json'),'utf8'),before,'failed build preserves prior site');
  await fs.writeFile(path.join(retained,`_atlas-assets/${first.releaseId}/app/late.js`),'changed');
  await assert.rejects(packageAssets({source,out,retained}),/content hash mismatch/);
  await assert.rejects(verifyRelease(path.join(out,`_atlas-assets/${first.releaseId}`),'not-a-hash'),/Invalid retained/);
  await assert.rejects(packageAssets({source,out:path.join(source,'bad'),allowEmptyRetained:true}),/separate trees/);
  await fs.symlink(path.join(source,'app/module.mjs'),path.join(source,'escape.js'));
  await assert.rejects(packageAssets({source,out}),/symlink/);
  await fs.unlink(path.join(source,'escape.js'));
  await write('app/base.html','<head><base href="/unreviewed/"></head>');
  await assert.rejects(packageAssets({source,out}),/Existing HTML base/);
  assert.equal(await fs.readFile(path.join(out,'atlas-asset-manifest.json'),'utf8'),before,'validation failure preserves prior site');

  const worker=await loadWorker();
  const env={ASSETS:{fetch:async request=>new Response(new URL(request.url).pathname,{status:new URL(request.url).pathname.includes('missing')?404:200})}};
  for(const route of [`/_atlas-assets/${first.releaseId}/app/module.mjs`,`/docs/_atlas-assets/${first.releaseId}/app/module.mjs`]) {
    const result=await worker.fetch(new Request('https://example.test'+route),env,{});
    assert.equal(result.headers.get('cache-control'),'public, max-age=31536000, immutable');
  }
  for(const route of ['/app/index.html','/app/module.mjs?v='+first.releaseId,'/_atlas-assets/not-a-hash/app/module.mjs']) {
    const result=await worker.fetch(new Request('https://example.test'+route),env,{});
    assert.equal(result.headers.get('cache-control'),'public, max-age=0, must-revalidate');
  }
  assert.equal((await worker.fetch(new Request(`https://example.test/_atlas-assets/${first.releaseId}/missing.js`),env,{})).headers.get('cache-control'),'no-store');
  assert.equal((await worker.fetch(new Request('https://example.test/api/build-info'),env,{})).headers.get('cache-control'),'no-store','API caching unchanged');
  console.log('PASS deterministic retained asset packaging; browser CSS/import/worker/iframe/Pages-prefix/old-document behavior; tamper and path guards; static-only immutable cache');
} finally {
  await browser?.close();
  await new Promise(resolve=>server?server.close(resolve):resolve());
  await fs.rm(tmp,{recursive:true,force:true});
}
