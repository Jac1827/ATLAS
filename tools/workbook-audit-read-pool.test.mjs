import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const modulePath=process.env.AUDIT_MODULE||'../docs/portfolio-operations-dashboard/features/workbook-audit-store.mjs';
const {readWorkbookAudit,readWorkbookAuditBytes,WORKBOOK_AUDIT_CHUNK_BYTES:SIZE}=await import(modulePath);
const {workbookEvidenceHash}=await import('../docs/portfolio-operations-dashboard/features/workbook-integrity.mjs');
const {captureReforecastSession}=await import('../docs/portfolio-operations-dashboard/features/reforecast-session-scope.mjs');
const {resumeReforecastImport}=await import('../docs/portfolio-operations-dashboard/features/reforecast-import-ui.mjs');
const {currentReforecastParserVersion}=await import('../docs/portfolio-operations-dashboard/features/reforecast-parser-recovery.mjs');
const sha=data=>createHash('sha256').update(data).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(audit,source){
 audit||={schemaVersion:'synthetic',inventory:{sheets:[]},text:'Retained café evidence\n'.repeat(90000)};
 if(!audit.fingerprint)audit.fingerprint=workbookEvidenceHash(audit);
 source||=Uint8Array.from({length:SIZE*5+17},(_,i)=>i%251);
 const auditBytes=new TextEncoder().encode(JSON.stringify(audit)),sourceBytes=new Uint8Array(source);
 const manifest={schemaVersion:'atlas.workbook-audit-upload.v1',sourceHash:sha(sourceBytes),fingerprint:audit.fingerprint,chunkBytes:SIZE,audit:{byteLength:auditBytes.length,sha256:sha(auditBytes),chunkCount:Math.ceil(auditBytes.length/SIZE)},source:{byteLength:sourceBytes.length,sha256:sha(sourceBytes),chunkCount:Math.ceil(sourceBytes.length/SIZE)}};
 const reference={auditId:'10000000-0000-0000-0000-000000000001',sourceHash:manifest.sourceHash,fingerprint:audit.fingerprint,manifestHash:workbookEvidenceHash(manifest)};
 const state={actor:'reviewer-a',access:'reviewer:doro',operations:[],active:0,maxActive:0,requests:[],completed:[],diagnostics:[],mutate:null,fail:null};
 const central={getSession:()=>({user:{id:state.actor},access_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600}),getAccessContextKey:()=>state.access,async rpc(name,args){
  state.operations.push(name);
  if(name==='atlas_read_workbook_audit_manifest')return {audit_id:reference.auditId,source_hash:reference.sourceHash,fingerprint:reference.fingerprint,manifest_hash:reference.manifestHash,manifest};
  assert.equal(name,'atlas_read_workbook_audit_chunk');assert.equal(args.p_manifest_hash,reference.manifestHash);
  const id=args.p_stream+':'+args.p_index;state.requests.push(id);state.active++;state.maxActive=Math.max(state.maxActive,state.active);
  try{
   await delay(state.fail?args.p_index===0?1:8:2+(3-args.p_index%4)*3);
   if(state.fail)await state.fail(args);
   const bytes=(args.p_stream==='audit'?auditBytes:sourceBytes).subarray(args.p_index*SIZE,(args.p_index+1)*SIZE);
   const value={stream:args.p_stream,chunk_index:args.p_index,data:Buffer.from(bytes).toString('base64'),sha256:sha(bytes)};
   state.completed.push(id);return state.mutate?state.mutate(value,args):value;
  }finally{state.active--;}
 }};
 return {audit,auditBytes,sourceBytes,manifest,reference,state,central,read:(options={})=>readWorkbookAuditBytes(central,reference,{onDiagnostic:item=>state.diagnostics.push(item),...options})};
}
test('bounded out-of-order reads preserve every audit/source byte and fingerprint',async()=>{
 const f=fixture(),result=await f.read();
 assert.equal(f.state.maxActive,4);assert.equal(f.state.active,0);
 assert.notDeepEqual(f.state.completed,f.state.requests,'Responses deliberately arrive out of order');
 assert.deepEqual(result.auditBytes,f.auditBytes);assert.deepEqual(result.sourceBytes,f.sourceBytes);assert.deepEqual(result.evidence,f.audit);
 assert.equal(new Set(f.state.requests).size,f.manifest.audit.chunkCount+f.manifest.source.chunkCount);
 assert.equal(f.state.diagnostics.filter(d=>d.operation==='atlas_read_workbook_audit_chunk'&&d.classification==='http_success').length,f.state.requests.length);
});
for(const kind of ['index','stream','length','hash'])test('corrupted '+kind+' rejects without partial evidence and drains active reads',async()=>{
 const f=fixture();f.state.mutate=(value,args)=>args.p_stream==='audit'&&args.p_index===0?{...value,...({index:{chunk_index:999},stream:{stream:'source'},length:{data:'AA=='},hash:{sha256:'0'.repeat(64)}}[kind])}:value;
 await assert.rejects(f.read(),/incomplete or changed/);assert.equal(f.state.active,0);assert(!f.state.requests.some(id=>id.startsWith('source:')));
});
test('transport failure stops scheduling and preserves the original error',async()=>{
 const f=fixture(),failure=new DOMException('Synthetic read timed out','TimeoutError');f.state.fail=args=>{if(args.p_index===0)throw failure;};
 await assert.rejects(f.read(),error=>error===failure);assert.equal(f.state.requests.length,4);assert.equal(f.state.active,0);
 assert(f.state.diagnostics.some(d=>d.classification==='timeout'));
});
test('actor change during the first pool denies all subsequent evidence',async()=>{
 const f=fixture();f.state.fail=args=>{if(args.p_index===0)f.state.actor='reviewer-b';};
 await assert.rejects(f.read(),/account changed/);assert.equal(f.state.requests.length,4);assert.equal(f.state.active,0);
});
test('manifest bounds and final content hash remain mandatory',async()=>{
 const f=fixture();f.manifest.audit.chunkCount++;f.reference.manifestHash=workbookEvidenceHash(f.manifest);
 await assert.rejects(f.read(),/manifest bounds/);assert.equal(f.state.requests.length,0);
 const g=fixture();g.manifest.audit.sha256='0'.repeat(64);g.reference.manifestHash=workbookEvidenceHash(g.manifest);
 await assert.rejects(g.read(),/exact byte readback hash mismatch/);assert.equal(g.state.active,0);
 const h=fixture();h.reference.fingerprint='0'.repeat(64);h.manifest.fingerprint=h.reference.fingerprint;h.reference.manifestHash=workbookEvidenceHash(h.manifest);
 await assert.rejects(h.read(),/audit content hash mismatch/);assert.equal(h.state.active,0);
});
// Use the real session scope to distinguish a stable actor from changed access
// and from a closed owning review. Only transport and digest timing are stubbed.
function operationScope(f){
 const host=new EventTarget();host.ATLAS_CENTRAL=f.central;
 const dialog=new EventTarget();dialog.open=true;dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new Event('close'));};dialog.remove=()=>{};
 const scope=captureReforecastSession(f.central,{hostWindow:host,disposeWhenIdle:true});scope.own(dialog);let firstFailure;
 const assertCurrent=()=>{try{scope.check();}catch(error){firstFailure||=error;throw error;}};
 return {assertCurrent,sessionScope:{...scope,check:assertCurrent},get failure(){return firstFailure;},invalidate:kind=>{if(kind==='close')dialog.close();else f.state.access='viewer:no-communities';},dispose:()=>scope.dispose()};
}
function assertStopped(f){assert.equal(f.state.actor,'reviewer-a');assert.equal(f.state.active,0,'Already-started reads drain before rejection');assert(f.state.maxActive<=4);assert(!f.state.requests.some(id=>id.startsWith('source:')),'No original source read begins after cancellation');}
for(const kind of ['close','access'])test(kind+' before dispatch prevents even the manifest request',async()=>{
 const f=fixture(),operation=operationScope(f);try{operation.invalidate(kind);await assert.rejects(f.read({assertCurrent:operation.assertCurrent}),error=>error===operation.failure);assert.equal(f.state.operations.length,0);}finally{operation.dispose();}
});
for(const kind of ['close','access'])test(kind+' during a pool drains at most four reads and preserves its first error',async()=>{
 const f=fixture(),operation=operationScope(f);try{
  f.state.fail=args=>{if(args.p_index===0)operation.invalidate(kind);};
  await assert.rejects(f.read({assertCurrent:operation.assertCurrent}),error=>error===operation.failure);
  assert.equal(f.state.requests.length,4);assertStopped(f);
 }finally{operation.dispose();}
});
for(const stage of ['chunk','audit'])for(const kind of ['close','access'])test(kind+' during '+stage+' digest prevents further claims or a source stream',async()=>{
 const f=fixture(),operation=operationScope(f),original=crypto.subtle.digest;let invalidated=false;
 try{
  crypto.subtle.digest=async function(algorithm,value){const result=await original.call(this,algorithm,value);if(!invalidated&&value.byteLength===(stage==='chunk'?SIZE:f.auditBytes.length)){invalidated=true;operation.invalidate(kind);}return result;};
  await assert.rejects(f.read({assertCurrent:operation.assertCurrent}),error=>error===operation.failure);assert(invalidated);
  assert.equal(f.state.requests.length,stage==='chunk'?4:f.manifest.audit.chunkCount);assertStopped(f);
 }finally{crypto.subtle.digest=original;operation.dispose();}
});
test('diagnostic exceptions remain observational while explicit checks control dispatch',async()=>{
 const f=fixture();let observations=0;
 const result=await f.read({onDiagnostic:()=>{observations++;throw Error('Observer unavailable');}});
 assert(observations>0);assert.deepEqual(result.sourceBytes,f.sourceBytes);
 const g=fixture(),operation=operationScope(g);try{
  await assert.rejects(g.read({assertCurrent:operation.assertCurrent,onDiagnostic:item=>{if(item.operation==='atlas_read_workbook_audit_chunk'&&item.classification==='pending')operation.invalidate('close');throw Error('Observer unavailable');}}),error=>error===operation.failure);
  assert.equal(g.state.requests.length,0,'A diagnostic-side event cannot slip a request past the explicit pre-dispatch check');assertStopped(g);
 }finally{operation.dispose();}
});
test('manifest wrapper forwards the explicit operation guard to every chunk',async()=>{
 const f=fixture(),operation=operationScope(f);try{f.state.fail=args=>{if(args.p_index===0)operation.invalidate('access');};await assert.rejects(readWorkbookAudit(f.central,f.reference,{assertCurrent:operation.assertCurrent}),error=>error===operation.failure);assert.equal(f.state.requests.length,4);assertStopped(f);}finally{operation.dispose();}
});
for(const parserVersion of [currentReforecastParserVersion,'older-parser'])test('resume loader forwards cancellation with '+parserVersion+' retained evidence',async()=>{
 const f=fixture(),operation=operationScope(f);try{
  f.state.fail=args=>{if(args.p_index===0)operation.invalidate('access');};
  const upload={upload_id:'20000000-0000-0000-0000-000000000002',payload:{parserVersion,source:{sha256:f.reference.sourceHash},integrity:f.reference,propertyAssignment:{communityId:'doro'}}};
  await assert.rejects(resumeReforecastImport({central:f.central,upload,sessionScope:operation.sessionScope}),error=>error===operation.failure);
  assert.equal(f.state.requests.length,4);assertStopped(f);
 }finally{operation.dispose();}
});
for(const stage of ['before','read','fingerprint'])test('legacy audit checks the operation '+stage+' and preserves the rejection',async()=>{
 const f=fixture(),operation=operationScope(f),reference={...f.reference},original=globalThis.structuredClone;delete reference.manifestHash;let reads=0;
 try{
  f.central.fetchJson=async()=>{reads++;await delay(1);if(stage==='read')operation.invalidate('access');return [{audit_id:reference.auditId,source_hash:reference.sourceHash,fingerprint:reference.fingerprint,evidence:f.audit}];};
  if(stage==='before')operation.invalidate('close');
  if(stage==='fingerprint')globalThis.structuredClone=value=>{const result=original(value);operation.invalidate('access');return result;};
  await assert.rejects(readWorkbookAudit(f.central,reference,{assertCurrent:operation.assertCurrent}),error=>error===operation.failure);
  assert.equal(reads,stage==='before'?0:1);assertStopped(f);
 }finally{globalThis.structuredClone=original;operation.dispose();}
});
test('chunked audit rejects invalidation while verifying the final evidence fingerprint',async()=>{
 const f=fixture(),operation=operationScope(f),original=globalThis.structuredClone;
 try{
  globalThis.structuredClone=value=>{const result=original(value);operation.invalidate('access');return result;};
  await assert.rejects(f.read({assertCurrent:operation.assertCurrent}),error=>error===operation.failure);
  assert.equal(f.state.active,0);assert.equal(f.state.requests.length,f.manifest.audit.chunkCount+f.manifest.source.chunkCount);
 }finally{globalThis.structuredClone=original;operation.dispose();}
});
if(process.env.DORO_FIXTURE)test('actual Doro retained audit and source survive all 112 chunk readbacks',async()=>{
 const {evidence}=JSON.parse(fs.readFileSync(process.env.DORO_FIXTURE,'utf8'));
 const f=fixture(evidence.integrity,Buffer.from(evidence.source.originalFile.data,'base64')),result=await f.read();
 assert.equal(f.manifest.source.sha256,evidence.source.sha256);assert.deepEqual(result.auditBytes,f.auditBytes);assert.deepEqual(result.sourceBytes,f.sourceBytes);assert.equal(result.evidence.fingerprint,evidence.integrity.fingerprint);assert.equal(f.state.maxActive,4);
 console.log(JSON.stringify({actualAuditBytes:f.auditBytes.length,auditChunks:f.manifest.audit.chunkCount,sourceChunks:f.manifest.source.chunkCount,verifiedReadCount:f.state.requests.length,maxConcurrent:f.state.maxActive}));
});
