import {workbookEvidenceHash} from './workbook-integrity.mjs?v=612a2cdba3c9dba2';

// Raw bytes are split before base64 encoding, so every request is bounded even
// when cell graphs or original OOXML parts contain multi-byte UTF-8 text.
export const WORKBOOK_AUDIT_CHUNK_BYTES=192*1024;
const one=value=>Array.isArray(value)?value[0]:value;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
// UUIDv8 derived from non-secret request identity survives reloads without
// storing financial payloads or relying on a browser-only retry map.
export function workbookAuditRequestId(actor,communityId,manifestHash){const hash=workbookEvidenceHash(['atlas.workbook-audit-request.v1',actor,communityId,manifestHash]);return hash.slice(0,8)+'-'+hash.slice(8,12)+'-8'+hash.slice(13,16)+'-'+((parseInt(hash[16],16)&3)|8).toString(16)+hash.slice(17,20)+'-'+hash.slice(20,32);}
const bytes=value=>value?.encoding==='base64'?Uint8Array.from(atob(value.data),char=>char.charCodeAt(0)):value instanceof ArrayBuffer?new Uint8Array(value):ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):null;
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');
const base64=value=>{let text='';for(let i=0;i<value.length;i+=24576)text+=String.fromCharCode(...value.subarray(i,i+24576));return btoa(text);};
const guard=(central,actor)=>{if(!actor||central.getSession?.()?.user?.id!==actor)throw Error('The signed-in account changed. Reopen the source before saving evidence.');};
export function compactWorkbookAudit(audit,record){return {schemaVersion:audit.schemaVersion,auditId:record.audit_id,sourceHash:record.source_hash,fingerprint:record.fingerprint,summary:audit.summary,rowCoverage:audit.rowCoverage,authorityScope:audit.authorityScope||null,previousFingerprint:audit.previousFingerprint||null,findings:audit.findings,safeToApprove:audit.safeToApprove,inventory:{retained:true,sheetCount:audit.inventory.sheets.length},...(record.manifest_hash?{manifestHash:record.manifest_hash}:{} )};}

export async function persistWorkbookAudit(central,audit,{communityId=null,sourceHash,requestId,sourceBytes,onDiagnostic}={}){
 if(audit?.auditId){await readWorkbookAudit(central,audit,{sourceHash});if(communityId)await central.rpc('atlas_bind_workbook_audit',{p_audit_id:audit.auditId,p_community_id:communityId});return audit;}
 const actor=central.getSession?.()?.user?.id;guard(central,actor);
 if(!audit?.fingerprint||!SHA.test(sourceHash||''))throw Error('Workbook source and audit hashes are required.');
 const original=bytes(sourceBytes);if(!original?.length)throw Error('Reopen the original workbook to retain its exact source bytes before saving evidence.');
 if(original.length>32*1024*1024||await sha(original)!==sourceHash)throw Error('Original workbook bytes do not match the source hash or exceed the 32 MB limit.');
 const auditBytes=new TextEncoder().encode(JSON.stringify(audit));
 if(auditBytes.length>128*1024*1024)throw Error('Workbook audit exceeds the 128 MB evidence limit.');
 const manifest={schemaVersion:'atlas.workbook-audit-upload.v1',sourceHash,fingerprint:audit.fingerprint,chunkBytes:WORKBOOK_AUDIT_CHUNK_BYTES,audit:{byteLength:auditBytes.length,sha256:await sha(auditBytes),chunkCount:Math.ceil(auditBytes.length/WORKBOOK_AUDIT_CHUNK_BYTES)},source:{byteLength:original.length,sha256:sourceHash,chunkCount:Math.ceil(original.length/WORKBOOK_AUDIT_CHUNK_BYTES)}};
 const manifestHash=workbookEvidenceHash(manifest);
 if(requestId&&!UUID.test(requestId))throw Error('Workbook request ID must be a UUID.');
 let id=requestId||workbookAuditRequestId(actor,communityId,manifestHash);const started=performance.now(),measurements=[];
 const call=async(name,args)=>{
  guard(central,actor);const start=performance.now();let details;
  try{
   const result=one(await central.rpc(name,args,{requestId:id,timeoutMs:45000,onTransport:value=>{details=value;}}));guard(central,actor);
   const diagnostic={requestId:id,operation:name,requestBytes:new TextEncoder().encode(JSON.stringify(args)).length,durationMs:Math.round(performance.now()-start),classification:'http_success',...details};measurements.push(diagnostic);try{onDiagnostic?.(diagnostic);}catch{}return result;
  }catch(error){
   const diagnostic={requestId:id,operation:name,requestBytes:new TextEncoder().encode(JSON.stringify(args)).length,durationMs:Math.round(performance.now()-start),classification:error?.name==='TimeoutError'?'timeout':error?.name==='AbortError'?'aborted':error?.status?'http_error':'transport_no_response',...(error?.transport||details||{})};measurements.push(diagnostic);try{onDiagnostic?.(diagnostic);}catch{}
   const failure=Error(`Workbook evidence save failed (${diagnostic.classification}; request ${id}). Your workbook is retained. Retry uses the same request ID.`);failure.diagnostics=diagnostic;failure.cause=error;throw failure;
  }
 };
 const readReceipt=()=>call('atlas_read_workbook_audit_upload_receipt',{p_community_id:communityId,p_request_id:id,p_manifest_hash:manifestHash});
 let upload;for(let attempts=0;attempts<16;attempts++){
  // A read is mandatory before another write after a refresh or uncertain
  // response. Immutable chunks already acknowledged by the server need not
  // cross the gateway again; their hashes are still checked below.
  upload=await readReceipt();
  if(!upload)upload=await call('atlas_begin_workbook_audit_upload',{p_community_id:communityId,p_request_id:id,p_manifest:manifest,p_manifest_hash:manifestHash});
  if(!upload?.canceled)break;
  if(!UUID.test(upload.retry_request_id||''))throw Error('Canceled workbook retry identity is unavailable.');id=upload.retry_request_id;
 }
 if(upload?.canceled||!UUID.test(upload?.upload_id||'')||upload.manifest_hash!==manifestHash)throw Error('Workbook upload manifest could not be verified.');
 const received=new Map();for(const part of upload.chunks||[]){
  const spec=manifest[part.stream],key=part.stream+':'+part.chunk_index;
  if(!spec||!Number.isInteger(part.chunk_index)||part.chunk_index<0||part.chunk_index>=spec.chunkCount||received.has(key)||!SHA.test(part.sha256||'')||part.byte_length!==Math.min(WORKBOOK_AUDIT_CHUNK_BYTES,spec.byteLength-part.chunk_index*WORKBOOK_AUDIT_CHUNK_BYTES))throw Error('Retained workbook chunk receipt is invalid.');
  received.set(key,part);
 }
 if(!upload.audit_id)for(const [stream,data]of [['audit',auditBytes],['source',original]])for(let offset=0,index=0;offset<data.length;offset+=WORKBOOK_AUDIT_CHUNK_BYTES,index++){
  const chunk=data.subarray(offset,offset+WORKBOOK_AUDIT_CHUNK_BYTES),hash=await sha(chunk),prior=received.get(stream+':'+index);
  if(prior){if(prior.sha256!==hash)throw Error('Retained workbook chunk differs from the selected original evidence.');continue;}
  await call('atlas_put_workbook_audit_chunk',{p_upload_id:upload.upload_id,p_stream:stream,p_index:index,p_chunk:base64(chunk),p_chunk_hash:hash});
 }
 let record=upload.receipt;
 if(!record)try{record=await call('atlas_finalize_workbook_audit_upload',{p_upload_id:upload.upload_id,p_request_id:id,p_manifest_hash:manifestHash});}
 catch(error){
  // Finalize may have committed after the response was lost. The same request
  // must be read before any retry; an unavailable read never permits a write.
  let retained;try{retained=await readReceipt();}catch(receiptError){error.receiptError=receiptError;throw error;}
  if(!retained?.audit_id||!retained.receipt)throw error;
  record=retained.receipt;
 }
 if(!record?.audit_id||record.source_hash!==sourceHash||record.fingerprint!==audit.fingerprint||record.manifest_hash!==manifestHash)throw Error('Workbook audit persistence could not be verified. Your edits are retained.');
 const ref=compactWorkbookAudit(audit,record);
 const retained=await readWorkbookAuditBytes(central,ref,{sourceHash});guard(central,actor);
 if(await sha(retained.auditBytes)!==manifest.audit.sha256||await sha(retained.sourceBytes)!==sourceHash)throw Error('Workbook exact readback failed.');
 // Transport observations belong to this attempt, not the immutable evidence.
 // Keep them directly readable for diagnostics, but exclude them from JSON,
 // object spread and structuredClone so re-saving the same audit has one hash.
 Object.defineProperty(ref,'transport',{value:{requestId:id,serializedAuditBytes:auditBytes.length,originalBytes:original.length,manifestHash,durationMs:Math.round(performance.now()-started),requests:measurements},enumerable:false});
 return ref;
}

export async function readWorkbookAuditBytes(central,reference,{sourceHash=reference?.sourceHash}={}){
 const actor=central.getSession?.()?.user?.id;guard(central,actor);
 if(!UUID.test(reference?.auditId||''))throw Error('A saved workbook audit is required.');
 const record=one(await central.rpc('atlas_read_workbook_audit_manifest',{p_audit_id:reference.auditId,p_manifest_hash:reference.manifestHash||null}));guard(central,actor);
 if(!record||record.audit_id!==reference.auditId||record.source_hash!==sourceHash||record.fingerprint!==reference.fingerprint||!record.manifest||record.manifest_hash!==workbookEvidenceHash(record.manifest)||(reference.manifestHash&&record.manifest_hash!==reference.manifestHash))throw Error('The saved workbook manifest does not match this source version.');
 const output={};
 for(const stream of ['audit','source']){
  const spec=record.manifest[stream],max=stream==='audit'?128*1024*1024:32*1024*1024;
  if(!Number.isInteger(spec?.byteLength)||spec.byteLength<1||spec.byteLength>max||record.manifest.chunkBytes!==WORKBOOK_AUDIT_CHUNK_BYTES||spec.chunkCount!==Math.ceil(spec.byteLength/WORKBOOK_AUDIT_CHUNK_BYTES))throw Error('Invalid saved workbook manifest bounds.');
  const data=new Uint8Array(spec.byteLength);let offset=0;
  for(let index=0;index<spec.chunkCount;index++){
   const chunk=one(await central.rpc('atlas_read_workbook_audit_chunk',{p_audit_id:reference.auditId,p_stream:stream,p_index:index,p_manifest_hash:reference.manifestHash||null}));guard(central,actor);
   const payload=bytes({encoding:'base64',data:chunk?.data||''});
   if(chunk?.chunk_index!==index||chunk?.stream!==stream||payload.length!==Math.min(WORKBOOK_AUDIT_CHUNK_BYTES,spec.byteLength-offset)||await sha(payload)!==chunk.sha256)throw Error('Workbook chunk readback is incomplete or changed.');
   data.set(payload,offset);offset+=payload.length;
  }
  if(offset!==spec.byteLength||await sha(data)!==spec.sha256)throw Error('Workbook exact byte readback hash mismatch.');output[stream+'Bytes']=data;
 }
 if(record.manifest.source.sha256!==sourceHash)throw Error('Workbook original source hash mismatch.');
 output.evidence=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(output.auditBytes));
 verifyEvidence(output.evidence,reference.fingerprint);return output;
}
function verifyEvidence(evidence,fingerprint){const copy=structuredClone(evidence);delete copy.fingerprint;if(evidence.fingerprint!==fingerprint||workbookEvidenceHash(copy)!==fingerprint)throw Error('Workbook audit content hash mismatch.');}
export async function readWorkbookAudit(central,reference,{sourceHash=reference?.sourceHash}={}){
 if(reference?.manifestHash)return (await readWorkbookAuditBytes(central,reference,{sourceHash})).evidence;
 // Historical references predate retained byte manifests and remain readable.
 const actor=central.getSession?.()?.user?.id;guard(central,actor);
 if(!UUID.test(reference?.auditId||''))throw Error('A saved workbook audit is required.');
 const rows=await central.fetchJson(`/atlas_workbook_audits?audit_id=eq.${encodeURIComponent(reference.auditId)}&select=audit_id,source_hash,fingerprint,evidence&limit=1`),record=rows?.[0];guard(central,actor);
 if(rows?.length!==1||record.audit_id!==reference.auditId||record.source_hash!==sourceHash||record.fingerprint!==reference.fingerprint)throw Error('The saved workbook audit does not match this source version.');
 verifyEvidence(record.evidence,record.fingerprint);return record.evidence;
}

// The intake envelope also contains cell/row inventories. Persist it through
// bounded requests and read back the committed envelope through bounded reads.
export async function persistReforecastPayload(central,{communityId,requestId,payload}){
 const actor=central.getSession?.()?.user?.id;guard(central,actor);await central.refreshSession?.();guard(central,actor);
 if(!UUID.test(requestId||''))throw Error('A stable request ID is required.');
 const data=new TextEncoder().encode(JSON.stringify(payload));
 if(data.length>32*1024*1024)throw Error('Reforecast source envelope exceeds the 32 MB limit.');
 const manifest={schemaVersion:'atlas.reforecast-payload.v1',chunkBytes:WORKBOOK_AUDIT_CHUNK_BYTES,byteLength:data.length,sha256:await sha(data),chunkCount:Math.ceil(data.length/WORKBOOK_AUDIT_CHUNK_BYTES)},manifestHash=workbookEvidenceHash(manifest);
 const call=async(name,args)=>{guard(central,actor);const options={requestId,timeoutMs:45000};const result=one(central.rpc?await central.rpc(name,args,options):await central.fetchJson('/rpc/'+name,{...options,method:'POST',body:JSON.stringify(args)}));guard(central,actor);return result;};
 const args={p_community_id:communityId,p_request_id:requestId,p_manifest:manifest,p_manifest_hash:manifestHash};
 let staged;for(let attempts=0;attempts<16;attempts++){
  staged=await call('atlas_stage_reforecast_payload',{...args,p_action:'begin'});if(!staged?.canceled)break;
  if(!UUID.test(staged.retry_request_id||''))throw Error('Canceled intake retry identity is unavailable.');requestId=staged.retry_request_id;args.p_request_id=requestId;
 }
 if(staged?.canceled)throw Error('Too many canceled retries; start a new intake request.');
 if(staged.manifest_hash!==manifestHash)throw Error('Reforecast source manifest mismatch.');
 if(!staged.upload_id)for(let offset=0,index=0;offset<data.length;offset+=WORKBOOK_AUDIT_CHUNK_BYTES,index++){
  const chunk=data.subarray(offset,offset+WORKBOOK_AUDIT_CHUNK_BYTES);
  await call('atlas_stage_reforecast_payload',{...args,p_manifest:null,p_action:'put',p_index:index,p_chunk:base64(chunk),p_chunk_hash:await sha(chunk)});
 }
 const saved=await call('atlas_stage_reforecast_payload',{...args,p_manifest:null,p_action:'finalize'});
 if(!UUID.test(saved.upload_id||'')||saved.manifest_hash!==manifestHash)throw Error('Reforecast source finalize could not be verified.');
 const retained=await call('atlas_read_reforecast_payload_chunk',{p_upload_id:saved.upload_id,p_index:null});
 if(retained.manifest_hash!==manifestHash||workbookEvidenceHash(retained.manifest)!==manifestHash||retained.record.upload_id!==saved.upload_id||retained.record.community_id!==communityId)throw Error('Reforecast source readback identity mismatch.');
 const readback=new Uint8Array(data.length);let offset=0;
 for(let index=0;index<manifest.chunkCount;index++){
  const record=await call('atlas_read_reforecast_payload_chunk',{p_upload_id:saved.upload_id,p_index:index}),chunk=bytes({encoding:'base64',data:record.data});
  if(record.chunk_index!==index||chunk.length!==Math.min(WORKBOOK_AUDIT_CHUNK_BYTES,data.length-offset)||await sha(chunk)!==record.sha256)throw Error('Reforecast source chunk readback mismatch.');
  readback.set(chunk,offset);offset+=chunk.length;
 }
 if(await sha(readback)!==manifest.sha256)throw Error('Reforecast source exact readback hash mismatch.');
 return {...retained.record,payload:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readback))};
}


export async function listPendingWorkbookUploads(central){
 const actor=central.getSession?.()?.user?.id;guard(central,actor);
 const rows=one(await central.rpc('atlas_list_workbook_staging',{}))?.uploads;guard(central,actor);
 if(!Array.isArray(rows)||rows.some(row=>!['audit','intake'].includes(row.kind)||!UUID.test(row.requestId||'')||!SHA.test(row.manifestHash||'')))throw Error('Unfinished save list could not be verified.');return rows;
}
export async function cancelWorkbookStaging(central,{kind,requestId,manifestHash}){
 const actor=central.getSession?.()?.user?.id;guard(central,actor);
 if(!['audit','intake'].includes(kind)||!UUID.test(requestId||'')||!SHA.test(manifestHash||''))throw Error('Select an unfinished save with its exact request and manifest.');
 const result=one(await central.rpc('atlas_cancel_workbook_staging',{p_kind:kind,p_request_id:requestId,p_manifest_hash:manifestHash},{requestId,timeoutMs:45000}));guard(central,actor);
 if(!result?.canceled||result.requestId!==requestId||result.kind!==kind||!UUID.test(result.retry_request_id||''))throw Error('Unfinished save cancellation could not be verified.');return result;
}
