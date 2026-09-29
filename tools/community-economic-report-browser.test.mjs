// Real Community Plan report handlers over immutable, synthetic server responses.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,extname} from 'node:path';
import {createRequire} from 'node:module';
import {reportHtml,closedEconomicOccupancyRows} from '../docs/portfolio-operations-dashboard/features/community-plan-report.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright'),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js');
const root=resolve('.'),folder=await mkdtemp(join(tmpdir(),'atlas-economic-report-'));
const records=[75,0,-12.5].map((closedPct,i)=>({report_id:`60000000-0000-0000-0000-00000000000${i+1}`,plan_id:`40000000-0000-0000-0000-00000000000${i+1}`,community_id:`20000000-0000-0000-0000-00000000000${i+1}`,plan_version:1,created_at:'2026-09-28T18:00:00Z',executive_note:'Governed report',snapshot:{reportSchemaVersion:6,community:['Example Harbor','Arbitrary Meadow','Unrelated Ridge'][i],period:'2026-09',sourceUpdatedAt:'2026-09-28T17:00:00Z',plan:{tasks:[],stage:'Active'},closedEconomicOccupancy:{selectedPeriod:'2026-09',currentPeriod:'2026-09',displayedClosePeriod:'2026-08',state:'open_month_latest_close',closedPct,closeVersionId:'close-version-'+(i+1),source:'accounting-close-'+(i+1)+'.xlsx',sourceHash:'hash-'+i,approvedBy:'Accounting reviewer',approvedAt:'2026-09-03T12:00:00Z',netRentalIncome:closedPct*10,grossPotentialRent:1000}}}));
const html=`<!doctype html><html><head><meta charset="utf-8"><title>Governed report export test</title><script src="/docs/portfolio-operations-dashboard/assets/xlsx.full.min.js"></script></head><body>${records.map((r,i)=>`<button data-open="${i}">${r.snapshot.community}</button>`).join('')}<script type="module">
import {open} from '/docs/portfolio-operations-dashboard/features/community-plan.mjs';
const records=${JSON.stringify(records)};window.calls=[];
for(const button of document.querySelectorAll('[data-open]'))button.onclick=()=>{const record=records[Number(button.dataset.open)];open({communityId:record.community_id,name:record.snapshot.community,period:record.snapshot.period,canEdit:true,central:{getSession:()=>({user:{id:'authorized-session'}}),fetchJson:async(url)=>url.startsWith('/atlas_community_plans?')?[{plan_id:record.plan_id,version:1,payload:record.snapshot.plan}]:[],rpc:async(name,args)=>{window.calls.push({name,args});if(name!=='atlas_generate_community_plan_report')throw Error('Unexpected mutation');return structuredClone(record);}}});};window.ready=true;
</script></body></html>`;
const server=http.createServer(async(request,response)=>{try{const url=new URL(request.url,'http://local');if(url.pathname==='/'){response.writeHead(200,{'content-type':'text/html'});response.end(html);return;}const file=resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+'/'))throw Error('Invalid fixture path');response.writeHead(200,{'content-type':['.mjs','.js'].includes(extname(file))?'text/javascript':'application/octet-stream'});response.end(await readFile(file));}catch{response.writeHead(404);response.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[];
 await context.addInitScript(()=>{window.print=()=>{window.parent.__printDocument=document.documentElement.outerHTML;};});
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept('Governed report'));
 const open=async(page,index)=>{await page.goto(origin);await page.waitForFunction(()=>window.ready);await page.locator(`[data-open="${index}"]`).click();await page.locator('[data-report]').click();await page.locator('[data-preview]').waitFor();};
 const download=async(selector)=>{const pending=page.waitForEvent('download');await page.locator(selector).click();const file=await pending,path=join(folder,file.suggestedFilename());await file.saveAs(path);return readFile(path);};
 for(const [index,record]of records.entries()){
  await open(page,index);const expected=reportHtml(record),screen=await page.locator('[data-preview]').innerText();assert(screen.includes(record.snapshot.closedEconomicOccupancy.closedPct.toFixed(1)+'%'));assert(screen.includes('Closed month: 2026-08'));assert(screen.includes('Selected period: 2026-09'));
  const exportedHtml=(await download('[data-html]')).toString();assert(exportedHtml.includes(expected),'HTML download retains same report snapshot');
  const book=XLSX.read(await download('[data-xlsx]'),{type:'buffer'});assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets['Closed economic occupancy'],{defval:null}),closedEconomicOccupancyRows(record),'real XLSX handler retains exact percentage, period, source and version');
  await page.locator('[data-print]').click();await page.waitForFunction(()=>typeof window.__printDocument==='string');const printHtml=await page.evaluate(()=>window.__printDocument);assert(printHtml.includes(expected),'print/PDF handler retains the same report HTML');
  const pdfPage=await context.newPage();await pdfPage.goto(origin);await pdfPage.setContent(printHtml);const bytes=await pdfPage.pdf({format:'A4'});assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  const text=await pdfPage.evaluate(async bytes=>{const lib=await import('/docs/portfolio-operations-dashboard/vendor/pdfjs-5.6.205/pdf.min.mjs');lib.GlobalWorkerOptions.workerSrc='/docs/portfolio-operations-dashboard/vendor/pdfjs-5.6.205/pdf.worker.min.mjs';const doc=await lib.getDocument({data:new Uint8Array(bytes)}).promise,out=[];for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i);out.push((await page.getTextContent()).items.map(item=>item.str).join(' '));}return out.join(' ');},Array.from(bytes));
  for(const value of [record.snapshot.closedEconomicOccupancy.closedPct.toFixed(1)+'%','Closed month: 2026-08','Selected period: 2026-09',record.snapshot.closedEconomicOccupancy.closeVersionId,record.snapshot.closedEconomicOccupancy.source])assert(text.includes(value),'actual PDF retains '+value);
  await pdfPage.close();
  const second=await context.newPage();second.on('dialog',dialog=>dialog.accept('Governed report'));await open(second,index);assert.equal(await second.locator('[data-preview]').innerText(),screen,'second authorized session produces identical retained report');await second.close();
  await open(page,index);assert.equal(await page.locator('[data-preview]').innerText(),screen,'reload uses the same immutable close');
  const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,1);assert.equal(calls[0].name,'atlas_generate_community_plan_report');assert.equal(calls[0].args.p_occupancy,null,'closed finance is never stamped by client request');
 }
 assert.deepEqual(errors,[]);console.log('PASS real Community Plan screen, HTML, print/PDF text and XLSX download parity for three unrelated communities with positive, zero and negative closed NRI; identical reload and second-session snapshots');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(folder,{recursive:true,force:true});}
