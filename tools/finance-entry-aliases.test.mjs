// Real packaged entry navigation on Worker-root and GitHub Pages project paths.
// The local bare repository also verifies source preservation and old releases.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {buildSite} from './build-atlas-site.mjs';
import {verifyRelease} from './package-atlas-assets.mjs';
import {FINANCE_HTML_ENTRIES,stageFinanceEntryAliases} from './finance-entry-aliases.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-finance-entry-'));
const repo=path.join(temp,'repo'),remote=path.join(temp,'retention.git');
const git=(args,cwd=repo)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
let server,browser;
try {
  await fs.mkdir(repo);git(['init']);git(['init','--bare',remote]);git(['remote','add','origin',remote]);
  const docs=path.join(repo,'docs');
  for(const relative of FINANCE_HTML_ENTRIES){
    await fs.mkdir(path.dirname(path.join(docs,relative)),{recursive:true});
    await fs.writeFile(path.join(docs,relative),'<!doctype html><html><head><title>Current entry</title></head><body><p id="ready">'+relative+'</p></body></html>\n');
  }
  await fs.writeFile(path.join(docs,'entry-asset.js'),'window.currentEntryAsset=true;\n');
  const original=await Promise.all(FINANCE_HTML_ENTRIES.map(relative=>fs.readFile(path.join(docs,relative),'utf8')));
  // Compatibility and rollback callers do not opt in: preserve their input hash.
  const prior=await buildSite({repo,bootstrap:true,mode:'publish'});
  assert.equal(prior.financeEntryAliases,undefined);
  let manifest=JSON.parse(await fs.readFile(prior.manifestPath,'utf8'));
  assert(!manifest.sourceFiles.some(row=>row.path.startsWith('finance/')));
  const priorRoot=path.join(prior.out,'_atlas-assets',prior.releaseId);
  const priorManifest=await fs.readFile(path.join(priorRoot,'.atlas-release.json'),'utf8');
  const published=git(['ls-remote','--heads','origin','refs/heads/atlas-asset-releases']);
  const result=await buildSite({repo,mode:'preview',preserveFinanceEntryAliases:true});
  assert.equal(git(['ls-remote','--heads','origin','refs/heads/atlas-asset-releases']),published,'Preview aliases cannot publish retention');
  assert.equal(await fs.readFile(path.join(result.out,'_atlas-assets',prior.releaseId,'.atlas-release.json'),'utf8'),priorManifest);
  await verifyRelease(path.join(result.out,'_atlas-assets',prior.releaseId),prior.releaseId);
  await verifyRelease(path.join(result.out,'_atlas-assets',result.releaseId),result.releaseId);
  manifest=JSON.parse(await fs.readFile(result.manifestPath,'utf8'));
  assert.equal(result.financeEntryAliases.aliases.length,FINANCE_HTML_ENTRIES.length);
  assert.equal(manifest.sourceFiles.filter(row=>row.path.startsWith('finance/')).length,FINANCE_HTML_ENTRIES.length,'Only entry HTML is duplicated, no asset tree');
  assert(manifest.sourceFiles.filter(row=>row.path.startsWith('finance/')).every(row=>row.path.endsWith('.html')));
  assert.equal(await fs.access(path.join(docs,'finance')).then(()=>true,()=>false),false,'Current docs stays finance-free');
  assert.deepEqual(await Promise.all(FINANCE_HTML_ENTRIES.map(relative=>fs.readFile(path.join(docs,relative),'utf8'))),original);
  assert.equal((await buildSite({repo,mode:'preview',preserveFinanceEntryAliases:true})).releaseId,result.releaseId,'Staging and packaging are deterministic');
  const packaged=await fs.readFile(path.join(result.out,'finance/portfolio-operations-dashboard/RISE-Budget-Builder.html'),'utf8');
  assert(packaged.includes('<base data-atlas-asset-release="'+result.releaseId+'"'),'Browser checks must include the real packager base');
  server=http.createServer(async(req,res)=>{
    try{
      let pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
      if(pathname.startsWith('/ATLAS/'))pathname=pathname.slice('/ATLAS'.length);
      if(pathname.endsWith('/'))pathname+='index.html';
      const file=path.resolve(result.out,'.'+pathname);
      if(!file.startsWith(result.out+path.sep))throw Error('Outside fixture');
      const bytes=await fs.readFile(file);
      res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html':'text/javascript'});res.end(bytes);
    }catch{res.writeHead(404);res.end('Missing');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});
  for(const prefix of ['', '/ATLAS']){
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const cases=[
      ['portfolio-operations-dashboard/RISE-Budget-Builder.html','?atlasEmbedded=1&atlasView=reforecast&name=A%26B#reforecast'],
      ['portfolio-operations-dashboard/RISE-Budget-Builder.html','?investorReader=1#reforecastapprovals'],
      ['portfolio-operations-dashboard/financial-accountability.html','?community=example#reports'],
      ['portfolio-operations-dashboard/index.html','?atlasView=reports#investor'],
      ['portfolio-operations-dashboard/auth/callback/index.html','?code=synthetic-only#access_token=synthetic-only'],
      ['index.html','?preserve=1#home'],
    ];
    for(const [relative,suffix] of cases){
      await page.goto(origin+prefix+'/finance/'+relative+suffix);
      await page.waitForURL(origin+prefix+'/'+relative+suffix);
      assert.equal(await page.locator('#ready').textContent(),relative);
    }
    // Directory entry redirects preserve the project prefix too.
    await page.goto(origin+prefix+'/finance/portfolio-operations-dashboard/?atlasView=reports#report');
    await page.waitForURL(origin+prefix+'/portfolio-operations-dashboard/index.html?atlasView=reports#report');
    // Direct immutable alias access stays frozen; do not redirect it to current.
    const relative='portfolio-operations-dashboard/RISE-Budget-Builder.html';
    await page.goto(origin+prefix+'/_atlas-assets/'+result.releaseId+'/finance/'+relative+'?investorReader=1#reforecast');
    await page.waitForURL(origin+prefix+'/_atlas-assets/'+result.releaseId+'/'+relative+'?investorReader=1#reforecast');
    assert.deepEqual(errors,[]);await page.close();
    const fallback=await browser.newPage({javaScriptEnabled:false});
    await fallback.goto(origin+prefix+'/finance/'+relative);
    await fallback.locator('#atlas-current-entry').click();
    assert.equal(await fallback.locator('#ready').textContent(),relative,'Manual fallback resolves through the packaged base to an existing frozen page');
    await fallback.close();
  }
  const missing=path.join(temp,'missing');await fs.mkdir(missing);
  await assert.rejects(stageFinanceEntryAliases({source:missing,out:path.join(temp,'bad-stage')}),/destination is missing/);
  await assert.rejects(stageFinanceEntryAliases({source:docs,out:path.join(docs,'nested')}),/separate from the source/);
  await fs.mkdir(path.join(docs,'finance'));await fs.writeFile(path.join(docs,'finance','index.html'),'Existing composition');
  await assert.rejects(stageFinanceEntryAliases({source:docs,out:path.join(temp,'composed-stage')}),/uncomposed current source/);
  console.log('PASS current-only finance HTML aliases: real packaged redirects on both hosts, query/hash/investor/auth preservation, immutable routes, manual fallback, exact original source and retained releases, deterministic hash and composition rejection');
}finally{
  await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());
  await fs.rm(temp,{recursive:true,force:true});
}
