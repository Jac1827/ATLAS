const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),http=require('node:http');
const source=fs.readFileSync('docs/portfolio-operations-dashboard/centralization/atlas-central-client.js','utf8');
const code=source.slice(source.indexOf('  async function request(url,'),source.indexOf('  async function fetchJson('));
(async()=>{
 const server=http.createServer((req,res)=>{
  if(req.url==='/slow')return;
  if(req.url==='/slow-body'){res.setHeader('sb-request-id','9cdbd5a5-92c3-4c40-95bc-b21fbd0335ad');res.writeHead(200);res.flushHeaders();res.write('{');return;}
  res.setHeader('sb-request-id','9cdbd5a5-92c3-4c40-95bc-b21fbd0335ad');
  res.setHeader('cf-ray','untrusted private data');
  res.statusCode=req.url==='/failure'?503:200;
  res.end(req.url==='/invalid'?'not JSON':JSON.stringify({ok:true}));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const context={fetch,performance,TextEncoder,AbortController,DOMException,window:{setTimeout,clearTimeout},isAuthRequest:()=>false,getConfig:()=>({supabaseUrl:origin}),getSignedInUser:()=>({id:'actor'}),baseHeaders:()=>({'Content-Type':'application/json'}),getRetryAfterSeconds:()=>0,errorFromPayload:(_p,f)=>f,createCentralError:(m,d)=>Object.assign(Error(m),d)};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function parseJsonResponse('),source.indexOf('  function errorFromPayload('))+code,context);
 const events=[],requestId='ef0ca5f2-e776-437e-b768-668292c7589f',options={method:'POST',body:JSON.stringify({private:'do not log',token:'secret',value:'é'}),requestId,onTransport:d=>events.push(d)};
 assert.equal((await context.request(origin+'/ok',options)).ok,true);
 assert.equal(events[0].requestBytes,Buffer.byteLength(options.body));assert.equal(events[0].classification,'http_success');assert.equal(events[0].requestId,requestId);assert.equal(events[0].gateway.supabaseRequestId,'9cdbd5a5-92c3-4c40-95bc-b21fbd0335ad');assert.equal(events[0].gateway.cloudflareRay,null);assert(events[0].durationMs>=0);assert(!JSON.stringify(events).includes('secret'));assert(!JSON.stringify(events).includes('do not log'));
 await assert.rejects(()=>context.request(origin+'/failure',options),e=>e.status===503&&e.transport.classification==='http_error');
 await assert.rejects(()=>context.request(origin+'/invalid',options),e=>e.transport.classification==='response_read_error');
 await assert.rejects(()=>context.request(origin+'/slow',{...options,timeoutMs:1000}),e=>e.transport.classification==='timeout');
 await assert.rejects(()=>context.request(origin+'/slow-body',{...options,timeoutMs:1000}),e=>e.transport.classification==='timeout'&&e.transport.status===200&&e.transport.gateway.supabaseRequestId==='9cdbd5a5-92c3-4c40-95bc-b21fbd0335ad');
 await context.request(origin+'/ok',{...options,requestId:'private\nheader'});assert.equal(events.at(-1).requestId,null);
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 await assert.rejects(()=>context.request(origin+'/ok',options),e=>e.transport.classification==='transport_no_response'&&e.transport.status===0);
 console.log('PASS real HTTP transport diagnostics: UTF-8 bytes, durations, UUID and gateway sanitization, HTTP/parse/network/timeout distinctions, no payload or credential logging');
})().catch(error=>{console.error(error);process.exitCode=1;});
