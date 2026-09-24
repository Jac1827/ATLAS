// Generated fixture only. Never connects to Central or imports operational data.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.ATLAS_PLAYWRIGHT||'playwright');
const XLSX=require(process.env.ATLAS_XLSX||path.resolve('docs/portfolio-operations-dashboard/assets/xlsx.full.min.js'));
const root=process.cwd();
const sources=process.argv[2]?JSON.parse(await fs.readFile(process.argv[2],'utf8')):[{name:'candidate',root}];
const out=path.resolve(process.argv[3]||'output/issue12-workbook/results.json');
const book=XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Expense','Value'],...Array.from({length:50000},(_,i)=>['Expense '+i,i])]),'Unrelated');
const rows=Array.from({length:220},()=>['']);rows[0]=['Availability (As of 09/21/2026)'];rows[150]=['Lead Conversions'];rows[219]=['Applications',17];
XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Multi-section');
const fixture=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
const pinnedXlsx=await fs.readFile(path.join(root,'docs/portfolio-operations-dashboard/assets/xlsx.full.min.js'));
const result={kind:'generated-local-worker-benchmark',fixtureBytes:fixture.length,observations:[],limitations:['No authenticated state; does not replace production acceptance','CDN copy served with identical pinned bytes for historical replay; routing disables HTTP cache','Heap is main-page only; worker memory is excluded','CPU slowdown emulates the main target; hardware is desktop']};
let activeSource;
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>ATLAS generated workbook benchmark</title><p>Generated fixture only.</p>');return;}
    if(url.pathname==='/fixture.xlsx'){res.end(fixture);return;}
    const base=path.join(activeSource.root,'docs/portfolio-operations-dashboard');
    const target=path.resolve(base,'.'+decodeURIComponent(url.pathname));
    if(!target.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
    res.setHeader('content-type',/\.m?js$/.test(target)?'application/javascript':'application/octet-stream');
    res.setHeader('cache-control','public, max-age=3600');res.end(await fs.readFile(target));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
try {
 for(const source of sources)for(const mobile of [false,true]){
  activeSource={...source,root:path.resolve(source.root)};
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},deviceScaleFactor:mobile?3:1});
  // Historical worker imports this exact third-party copy. Keep all traffic local.
  await context.route('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',route=>route.fulfill({contentType:'application/javascript',body:pinnedXlsx}));
  const page=await context.newPage();const cdp=await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:mobile?4:1});
  await page.goto(base);
  const sample=await page.evaluate(async()=>{
    const {openWorkbook}=await import('/features/workbook-session.mjs');
    const file=new File([await (await fetch('/fixture.xlsx')).arrayBuffer()],'generated-workbook.xlsx');
    const tasks=[];const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(x=>({start:x.startTime,duration:x.duration}))));observer.observe({type:'longtask',buffered:false});
    const runs=[];
    for(let i=0;i<5;i++){
      const start=performance.now();const heapBefore=performance.memory?.usedJSHeapSize??null;
      const session=await openWorkbook(file);if(!session)throw Error('Worker unavailable');
      try{
        const unrelated=await session.sheet('Unrelated',false),sections=await session.sheet('Multi-section',false);
        if(unrelated.rows.length!==80||unrelated.rowCount!==50001||unrelated.candidate||sections.rows.length!==220||sections.rows[219][1]!=='17')throw Error('Preview or source-row parity failed');
        const previewMs=performance.now()-start;session.close();
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        runs.push({run:i+1,previewMs,heapBefore,heapAfterCleanup:performance.memory?.usedJSHeapSize??null});
      }finally{session.close();}
    }
    const abort=new AbortController(),session=await openWorkbook(file,abort.signal);
    const pending=session.sheet('Unrelated',false),cancelStart=performance.now();abort.abort();
    let cancelled=false;try{await pending;}catch(error){cancelled=error.name==='AbortError';}
    if(!cancelled)throw Error('In-flight cancellation failed');
    const cancelMs=performance.now()-cancelStart;session.close();
    await new Promise(r=>setTimeout(r,50));observer.disconnect();
    return{runs,cancelMs,longTasks:tasks,previewParity:true};
  });
  result.observations.push({build:source.name,device:mobile?'mobile-emulation':'desktop',...sample});
  await context.close();
 }
 await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(result,null,2));
 console.log(JSON.stringify({output:out,fixtureBytes:fixture.length,results:result.observations.map(x=>({build:x.build,device:x.device,previewMs:x.runs.map(r=>Math.round(r.previewMs)),cancelMs:x.cancelMs,longTasks:x.longTasks.length}))},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
