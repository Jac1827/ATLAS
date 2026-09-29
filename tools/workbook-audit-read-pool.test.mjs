import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const modulePath=process.env.AUDIT_MODULE||'../docs/portfolio-operations-dashboard/features/workbook-audit-store.mjs';
const {readWorkbookAuditBytes,WORKBOOK_AUDIT_CHUNK_BYTES:SIZE}=await import(modulePath);
const {workbookEvidenceHash}=await import('../docs/portfolio-operations-dashboard/features/workbook-integrity.mjs');
const sha=data=>createHash('sha256').update(data).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(audit,source){
 audit||={schemaVersion:'synthetic',inventory:{sheets:[]},text:'Retained café evidence\n'.repeat(90000)};
 if(!audit.fingerprint)audit.fingerprint=workbookEvidenceHash(audit);
 source||=Uint8Array.from({length:SIZE*5+17},(_,i)=>i%251);
 const auditBytes=new TextEncoder().encode(JSON.stringify(audit)),sourceBytes=new Uint8Array(source);
 const manifest={schemaVersion:'atlas.workbook-audit-upload.v1',sourceHash:sha(sourceBytes),fingerprint:audit.fingerprint,chunkBytes:SIZE,audit:{byteLength:auditBytes.length,sha256:sha(auditBytes),chunkCount:Math.ceil(auditBytes.length/SIZE)},source:{byteLength:sourceBytes.length,sha256:sha(sourceBytes),chunkCount:Math.ceil(sourceBytes.length/SIZE)}};
 const reference={auditId:'10000000-0000-0000-0000-000000000001',sourceHash:manifest.sourceHash,fingerprint:audit.fingerprint,manifestHash:workbookEvidenceHash(manifest)};
 const state={actor:'reviewer-a',active:0,maxActive:0,requests:[],completed:[],diagnostics:[],mutate:null,fail:null};
 const central={getSession:()=>({user:{id:state.actor}}),async rpc(name,args){
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
 return {audit,auditBytes,sourceBytes,manifest,reference,state,central,read:()=>readWorkbookAuditBytes(central,reference,{onDiagnostic:item=>state.diagnostics.push(item)})};
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
if(process.env.DORO_FIXTURE)test('actual Doro retained audit and source survive all 112 chunk readbacks',async()=>{
 const {evidence}=JSON.parse(fs.readFileSync(process.env.DORO_FIXTURE,'utf8'));
 const f=fixture(evidence.integrity,Buffer.from(evidence.source.originalFile.data,'base64')),result=await f.read();
 assert.equal(f.manifest.source.sha256,evidence.source.sha256);assert.deepEqual(result.auditBytes,f.auditBytes);assert.deepEqual(result.sourceBytes,f.sourceBytes);assert.equal(result.evidence.fingerprint,evidence.integrity.fingerprint);assert.equal(f.state.maxActive,4);
 console.log(JSON.stringify({actualAuditBytes:f.auditBytes.length,auditChunks:f.manifest.audit.chunkCount,sourceChunks:f.manifest.source.chunkCount,verifiedReadCount:f.state.requests.length,maxConcurrent:f.state.maxActive}));
});
