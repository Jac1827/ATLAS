import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseReforecastWorkbook} from '../docs/portfolio-operations-dashboard/features/reforecast-intake.mjs';
import {persistWorkbookAudit,readWorkbookAuditBytes,readWorkbookAudit,listPendingWorkbookUploads,cancelWorkbookStaging,WORKBOOK_AUDIT_CHUNK_BYTES} from '../docs/portfolio-operations-dashboard/features/workbook-audit-store.mjs';
import {saveUpload} from '../docs/portfolio-operations-dashboard/features/reforecast-store.mjs';
import {workbookEvidenceHash} from '../docs/portfolio-operations-dashboard/features/workbook-integrity.mjs';
const require=createRequire(import.meta.url),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js'),{fixture}=require('./financial-intake-fixture.cjs');
const {db,cid,signIn}=await fixture();let actor=1;
const sha=value=>createHash('sha256').update(value).digest('hex');
const calls=[];
const call=async(name,args)=>{calls.push({name,action:args.p_action,index:args.p_index,bytes:Buffer.byteLength(JSON.stringify(args))});return (await db.query(`select public.${name}(${Object.keys(args).map((key,i)=>`${key} => $${i+1}`).join(',')}) as result`,Object.values(args))).rows[0].result;};
const central={getSession:()=>({user:{id:'00000000-0000-0000-0000-'+String(actor).padStart(12,'0')}}),rpc:call};
const login=async n=>{actor=n;await signIn(n);};
try {
 await db.exec('reset role');for(const name of ['20260924121641_planning_cell_workbook_integrity_governance.sql','20260924121647_immutable_workbook_audits_and_monthly_governance.sql'])await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/centralization/workbook-audit-chunks.sql',import.meta.url),'utf8'));
 for(const name of ['20260925011545_workbook_audit_validation_performance.sql','20260925012234_reforecast_payload_receipt_recovery.sql'])await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));await login(1);
 let sourceBytes;
 if(process.env.ATLAS_REAL_DORO_SOURCE)sourceBytes=fs.readFileSync(process.env.ATLAS_REAL_DORO_SOURCE);
 else {const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Doro'],['GL','Account','Sep 2026','Oct 2026','Nov 2026','Dec 2026'],['5144','Hello Landing',1,2,3,4],...Array.from({length:12},(_,i)=>[String(5145+i),'Unicode retained é € 日本 '.repeat(1000),0,0,0,0])]),'Input');sourceBytes=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});}
 sourceBytes=Buffer.from(sourceBytes);
 const evidence=await parseReforecastWorkbook(sourceBytes,{xlsx:XLSX,fileName:process.env.ATLAS_REAL_DORO_SOURCE?path.basename(process.env.ATLAS_REAL_DORO_SOURCE):'private-fixture.xlsx'}),audit=evidence.integrity,sourceHash=sha(sourceBytes),requestId=randomUUID();
 const reference=await persistWorkbookAudit(central,audit,{sourceBytes,sourceHash,requestId,communityId:cid});
 const auditBytes=Buffer.from(JSON.stringify(audit));assert.equal(reference.transport.serializedAuditBytes,auditBytes.length);assert(calls.every(c=>c.bytes<WORKBOOK_AUDIT_CHUNK_BYTES*4/3+1024));
 const payload={...evidence,source:{...evidence.source,originalFile:{encoding:'base64',data:sourceBytes.toString('base64')}},integrity:reference,propertyAssignment:{communityId:cid,confirmed:true,explicit:true,actorId:central.getSession().user.id,assignedAt:'2026-09-24T23:00:00Z',reason:'Isolated bounded transport acceptance',sourceEntities:[]}};
 const uploadRequest=randomUUID(),saved=await saveUpload(central,{communityId:cid,requestId:uploadRequest,payload});
 assert.deepEqual(saved.payload,JSON.parse(JSON.stringify(payload)));assert.equal((await saveUpload(central,{communityId:cid,requestId:uploadRequest,payload})).upload_id,saved.upload_id);
 // Provider receipts deliberately have no workbook graph or audit, including XLSX
 // statements. Verify the unchanged authoritative save accepts each receipt first.
 const pdfBytes=Buffer.from('%PDF-1.7\nIsolated provider source byte-retention fixture\n%%EOF');
 const providerPayload=(sourceType,bytes=pdfBytes)=>({sourceType,source:{fileName:bytes===pdfBytes?'provider.pdf':'provider.xlsx',sha256:sha(bytes),originalFile:{encoding:'base64',data:bytes.toString('base64')}},propertyAssignment:{communityId:cid,confirmed:true},summary:{periods:['2026-08']},...(sourceType==='contract'?{contract:{vendor:'Fixture vendor',monthlyAmount:null}}:{statement:{provider:sourceType,period:'2026-08',status:'needs_review'}})});
 for(const provider of [...['hello_landing','rise_str','monthly_property_statement','contract'].map(type=>providerPayload(type)),providerPayload('hello_landing',sourceBytes)]){
  const receiptRequest=randomUUID(),legacy=(await db.query('select to_jsonb(public.atlas_save_reforecast_upload($1,$2,$3)) as result',[cid,receiptRequest,provider])).rows[0].result;
  const receipt=await saveUpload(central,{communityId:cid,requestId:receiptRequest,payload:provider});
  assert.equal(receipt.upload_id,legacy.upload_id);assert.deepEqual(receipt.payload,provider);
  assert.equal((await saveUpload(central,{communityId:cid,requestId:receiptRequest,payload:provider})).upload_id,receipt.upload_id);
 }
 // Failed finalization stays atomic and cancellable. Neither a provider label nor
 // transport finalization bypasses source hash, assignment or audit validation.
 const rejectPayload=async(candidate,pattern)=>{
  const rejectedId=randomUUID(),before=(await db.query('select count(*)::int n from atlas_reforecast_uploads')).rows[0].n;
  await assert.rejects(()=>saveUpload(central,{communityId:cid,requestId:rejectedId,payload:candidate}),pattern);
  assert.equal((await db.query('select count(*)::int n from atlas_reforecast_uploads')).rows[0].n,before);
  const staging=(await listPendingWorkbookUploads(central)).find(row=>row.requestId===rejectedId);assert(staging);
  await cancelWorkbookStaging(central,{kind:'intake',requestId:rejectedId,manifestHash:staging.manifestHash});
 };
 const missingAudit=structuredClone(payload);delete missingAudit.integrity;
 await rejectPayload(missingAudit,/Workbook audit source hash mismatch/);
 await rejectPayload({...missingAudit,sourceType:'hello_landing'},/Workbook audit source hash mismatch/);
 await rejectPayload({...payload,integrity:{}},/Workbook audit source hash mismatch/);
 await rejectPayload({...payload,integrity:{...reference,fingerprint:'f'.repeat(64)}},/Workbook audit source, fingerprint or authorization mismatch/);
 await rejectPayload({...providerPayload('hello_landing'),integrity:{}},/Workbook audit source hash mismatch/);
 await rejectPayload(providerPayload('unknown_source'),/Workbook audit source hash mismatch/);
 const wrongBytes=providerPayload('hello_landing');wrongBytes.source.sha256='f'.repeat(64);
 await rejectPayload(wrongBytes,/Workbook source hash does not match retained bytes/);
 const missingBytes=providerPayload('contract');delete missingBytes.source.originalFile;
 await rejectPayload(missingBytes,/Immutable workbook bytes, file name and SHA-256 are required/);
 const unconfirmed=providerPayload('rise_str');unconfirmed.propertyAssignment.confirmed=false;
 await rejectPayload(unconfirmed,/Select and explicitly confirm an authorized community/);
 const wrongCommunity=providerPayload('monthly_property_statement');wrongCommunity.propertyAssignment.communityId='10000000-0000-0000-0000-000000000002';
 await rejectPayload(wrongCommunity,/Select and explicitly confirm an authorized community/);
 assert.equal(fs.readFileSync(new URL('../docs/portfolio-operations-dashboard/centralization/workbook-audit-chunks.sql',import.meta.url),'utf8'),fs.readFileSync(new URL('../supabase/migrations/20260924232845_bounded_workbook_audit_transport.sql',import.meta.url),'utf8'));
 const readback=await readWorkbookAuditBytes(central,reference);assert.deepEqual(Buffer.from(readback.auditBytes),auditBytes);assert.deepEqual(Buffer.from(readback.sourceBytes),sourceBytes);assert.deepEqual(readback.evidence,JSON.parse(auditBytes));assert.deepEqual(await readWorkbookAudit(central,reference),JSON.parse(auditBytes));
 const retry=await persistWorkbookAudit(central,audit,{sourceBytes,sourceHash,requestId,communityId:cid});assert.equal(retry.auditId,reference.auditId);
 assert(!retry.transport.requests.some(row=>row.operation==='atlas_finalize_workbook_audit_upload'||row.operation==='atlas_put_workbook_audit_chunk'),'Completed receipt recovery performs no repeat write');
 const lostFinalizeId=randomUUID(),lostFinalize={...central,rpc:async(name,args)=>{const result=await call(name,args);if(name==='atlas_finalize_workbook_audit_upload')throw TypeError('Injected lost finalization response');return result;}};
 const recoveredFinalize=await persistWorkbookAudit(lostFinalize,audit,{sourceBytes,sourceHash,requestId:lostFinalizeId,communityId:cid});assert.equal(recoveredFinalize.auditId,reference.auditId,'Uncertain finalization reads its committed receipt without a duplicate write');
 // Repeat the actual import sequence: audit save/readback on every attempt, then
 // envelope save under the same request ID. Attempt telemetry must not change it.
 assert(reference.transport.requests.length>retry.transport.requests.length);
 assert.equal(JSON.stringify(retry),JSON.stringify(reference));
 assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(reference)),'transport'),false);
 assert.equal(Object.hasOwn({...reference},'transport'),false);
 assert.equal(Object.hasOwn(structuredClone(reference),'transport'),false);
 for(const lostResponse of ['begin','finalize']){
  const intakeRequest=randomUUID(),interruptedIntake={...central,rpc:async(name,args)=>{
   const result=await call(name,args);
   if(name==='atlas_stage_reforecast_payload'&&args.p_action===lostResponse)throw Error('Injected lost '+lostResponse+' response');
   return result;
  }};
  if(lostResponse==='begin')await assert.rejects(()=>saveUpload(interruptedIntake,{communityId:cid,requestId:intakeRequest,payload}),/Injected lost begin response/);
  else assert.equal((await saveUpload(interruptedIntake,{communityId:cid,requestId:intakeRequest,payload})).request_id,intakeRequest,'Lost finalize response recovers from a read-only receipt');
  assert.equal((await db.query('select count(*)::int n from atlas_reforecast_uploads where request_id=$1',[intakeRequest])).rows[0].n,lostResponse==='finalize'?1:0);
  const refreshedReference=await persistWorkbookAudit(central,audit,{sourceBytes,sourceHash,requestId,communityId:cid});
  assert(refreshedReference.transport.requests.length>0);assert.equal(JSON.stringify(refreshedReference),JSON.stringify(reference));
  const beforeRetry=calls.length,resumedIntake=await saveUpload(central,{communityId:cid,requestId:intakeRequest,payload:{...payload,integrity:refreshedReference}});
  assert.equal(calls[beforeRetry].name,'atlas_read_reforecast_payload_receipt');
  if(lostResponse==='finalize')assert(!calls.slice(beforeRetry).some(row=>row.name==='atlas_stage_reforecast_payload'),'Completed envelope retry performs no repeat write');
  assert.deepEqual(resumedIntake.payload,JSON.parse(JSON.stringify(payload)));
  assert.equal((await db.query('select count(*)::int n from atlas_reforecast_uploads where request_id=$1',[intakeRequest])).rows[0].n,1);
 }

 // Inject a connection failure after durable begin, then import a fresh module
 // instance as a page reload. The derived UUID resumes the same reservation.
 let interruptedId;const interrupted={...central,rpc:async(name,args)=>{if(name==='atlas_put_workbook_audit_chunk')throw TypeError('Injected transport interruption');return call(name,args);}};
 await assert.rejects(()=>persistWorkbookAudit(interrupted,audit,{sourceBytes,sourceHash,communityId:cid}),error=>{interruptedId=error.diagnostics?.requestId;return error.diagnostics?.classification==='transport_no_response';});
 const fresh=await import('../docs/portfolio-operations-dashboard/features/workbook-audit-store.mjs?reload='+randomUUID());
 const resumed=await fresh.persistWorkbookAudit(central,audit,{sourceBytes,sourceHash,communityId:cid});assert.equal(resumed.transport.requestId,interruptedId);assert.equal(resumed.auditId,reference.auditId);

 // A committed first chunk survives a lost response and is not uploaded again.
 const partialRequest=randomUUID(),partial={...central,rpc:async(name,args)=>{const result=await call(name,args);if(name==='atlas_stage_reforecast_payload'&&args.p_action==='put'&&args.p_index===0)throw Error('Lost first chunk response');return result;}};
 await assert.rejects(()=>saveUpload(partial,{communityId:cid,requestId:partialRequest,payload}),/Lost first chunk response/);
 const beforeCorruptRetry=calls.length,corruptReceipt={...central,rpc:async(name,args)=>{const result=await call(name,args);if(name==='atlas_read_reforecast_payload_receipt')result.chunks[0].sha256='f'.repeat(64);return result;}};
 await assert.rejects(()=>saveUpload(corruptReceipt,{communityId:cid,requestId:partialRequest,payload}),/Retained reforecast source chunk differs/);
 assert(!calls.slice(beforeCorruptRetry).some(row=>row.name==='atlas_stage_reforecast_payload'),'Changed retained chunk fails before any write');
 const beforePartialRetry=calls.length;
 const partialSaved=await saveUpload(central,{communityId:cid,requestId:partialRequest,payload});
 assert.equal(partialSaved.request_id,partialRequest);
 assert.equal(calls[beforePartialRetry].name,'atlas_read_reforecast_payload_receipt');
 assert(!calls.slice(beforePartialRetry).some(row=>row.name==='atlas_stage_reforecast_payload'&&(row.action==='begin'||row.action==='put'&&row.index===0)),'Receipt recovery skips the retained reservation and first chunk');
 const sourceManifest=(await call('atlas_read_reforecast_payload_chunk',{p_upload_id:partialSaved.upload_id,p_index:null})).manifest_hash;
 const sourceReceiptArgs={p_community_id:cid,p_request_id:partialRequest,p_manifest_hash:sourceManifest};
 assert.equal((await call('atlas_read_reforecast_payload_receipt',sourceReceiptArgs)).upload_id,partialSaved.upload_id);
 await assert.rejects(()=>call('atlas_read_reforecast_payload_receipt',{...sourceReceiptArgs,p_manifest_hash:'f'.repeat(64)}),/manifest or scope mismatch/);
 await login(2);assert.equal(await call('atlas_read_reforecast_payload_receipt',sourceReceiptArgs),null,'Another authorized actor cannot read uploader staging');
 await login(3);await assert.rejects(()=>call('atlas_read_reforecast_payload_receipt',sourceReceiptArgs),/Authorized reforecast editor/);await login(1);
 
 await login(2);assert.deepEqual(await readWorkbookAudit(central,reference),JSON.parse(auditBytes));assert.deepEqual(Buffer.from((await readWorkbookAuditBytes(central,reference)).sourceBytes),sourceBytes);
 await login(3);await assert.rejects(()=>readWorkbookAuditBytes(central,reference),/outside authorized scope/);await assert.rejects(()=>db.query('select * from atlas_private.workbook_audit_chunks'),/permission denied/);
 await login(1);const manifest=(await call('atlas_read_workbook_audit_manifest',{p_audit_id:reference.auditId})).manifest;
 const beginArgs={p_community_id:cid,p_request_id:requestId,p_manifest:manifest,p_manifest_hash:workbookEvidenceHash(manifest)};
 await assert.rejects(()=>call('atlas_begin_workbook_audit_upload',{...beginArgs,p_community_id:null}),/reused with different evidence or scope/);
 const altered=structuredClone(manifest);altered.fingerprint='f'.repeat(64);await assert.rejects(()=>call('atlas_begin_workbook_audit_upload',{...beginArgs,p_manifest:altered,p_manifest_hash:workbookEvidenceHash(altered)}),/reused with different evidence or scope/);
 const pendingId=randomUUID(),pending=await call('atlas_begin_workbook_audit_upload',{...beginArgs,p_request_id:pendingId});
 await assert.rejects(()=>call('atlas_finalize_workbook_audit_upload',{p_upload_id:pending.upload_id,p_request_id:pendingId,p_manifest_hash:workbookEvidenceHash(manifest)}),/incomplete/);
 const chunk=auditBytes.subarray(0,WORKBOOK_AUDIT_CHUNK_BYTES),chunkArgs={p_upload_id:pending.upload_id,p_stream:'audit',p_index:0,p_chunk:chunk.toString('base64'),p_chunk_hash:sha(chunk)};
 await call('atlas_put_workbook_audit_chunk',chunkArgs);await call('atlas_put_workbook_audit_chunk',chunkArgs);
 await assert.rejects(()=>call('atlas_put_workbook_audit_chunk',{...chunkArgs,p_chunk_hash:'f'.repeat(64)}),/hash mismatch/);
 const corrupt=Buffer.from(chunk);corrupt[0]^=1;await assert.rejects(()=>call('atlas_put_workbook_audit_chunk',{...chunkArgs,p_chunk:corrupt.toString('base64'),p_chunk_hash:sha(corrupt)}),/different content/);
 const finalized=await call('atlas_begin_workbook_audit_upload',beginArgs);
 for(const revoke of ["status='inactive'","status='active',role='community_manager',allowed_community_ids='{10000000-0000-0000-0000-000000000002}'"]){
  await db.exec("reset role;update atlas_user_profiles set "+revoke+" where user_id='00000000-0000-0000-0000-000000000001'");await login(1);
  await assert.rejects(()=>call('atlas_put_workbook_audit_chunk',chunkArgs),/outside authorized scope/);
  await assert.rejects(()=>call('atlas_finalize_workbook_audit_upload',{p_upload_id:finalized.upload_id,p_request_id:requestId,p_manifest_hash:reference.manifestHash}),/authorization mismatch/);
  await assert.rejects(()=>readWorkbookAuditBytes(central,reference),/outside authorized scope/);
  assert.equal((await db.query('select audit_id from atlas_workbook_audits where audit_id=$1',[reference.auditId])).rows.length,0);
 }
 await db.exec("reset role;update atlas_user_profiles set status='active',role='admin',allowed_community_ids='{}' where user_id='00000000-0000-0000-0000-000000000001'");await login(1);
 for(let i=0;i<3;i++)await call('atlas_begin_workbook_audit_upload',{...beginArgs,p_request_id:randomUUID()});
 await assert.rejects(()=>call('atlas_begin_workbook_audit_upload',{...beginArgs,p_request_id:randomUUID()}),/staging quota exceeded/);
 assert.equal((await call('atlas_begin_workbook_audit_upload',{...beginArgs,p_request_id:pendingId})).upload_id,pending.upload_id);
 await login(2);const large=structuredClone(manifest);large.audit.byteLength=134217728;large.audit.chunkCount=Math.ceil(large.audit.byteLength/WORKBOOK_AUDIT_CHUNK_BYTES);large.source.byteLength=33554432;large.source.chunkCount=Math.ceil(large.source.byteLength/WORKBOOK_AUDIT_CHUNK_BYTES);
 const reservation={...beginArgs,p_request_id:randomUUID(),p_manifest:large,p_manifest_hash:workbookEvidenceHash(large)};await call('atlas_begin_workbook_audit_upload',reservation);
 await assert.rejects(()=>call('atlas_begin_workbook_audit_upload',{...reservation,p_request_id:randomUUID()}),/staging quota exceeded/);await login(1);
 const pendingList=await listPendingWorkbookUploads(central);assert.equal(pendingList.length,4);assert(pendingList.every(row=>row.kind==='audit'));assert(!JSON.stringify(pendingList).includes('payload'));
 await assert.rejects(()=>cancelWorkbookStaging(central,{kind:'audit',requestId,manifestHash:reference.manifestHash}),/Finalized workbook evidence/);
 const intakeManifest=await call('atlas_read_reforecast_payload_chunk',{p_upload_id:saved.upload_id,p_index:null});
 await assert.rejects(()=>cancelWorkbookStaging(central,{kind:'intake',requestId:uploadRequest,manifestHash:intakeManifest.manifest_hash}),/Finalized reforecast import/);
 const canceled=await cancelWorkbookStaging(central,{kind:'audit',requestId:pendingId,manifestHash:reference.manifestHash});assert.equal((await cancelWorkbookStaging(central,{kind:'audit',requestId:pendingId,manifestHash:reference.manifestHash})).retry_request_id,canceled.retry_request_id);
 assert.equal((await listPendingWorkbookUploads(central)).length,3);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from atlas_private.workbook_audit_chunks where upload_id=$1',[pending.upload_id])).rows[0].n,0);assert.equal((await db.query('select manifest_hash from atlas_private.workbook_audit_uploads where upload_id=$1',[pending.upload_id])).rows[0].manifest_hash,reference.manifestHash);await login(1);
 const resumedCanceled=await persistWorkbookAudit(central,audit,{sourceBytes,sourceHash,communityId:cid,requestId:pendingId});assert.equal(resumedCanceled.auditId,reference.auditId);assert.equal(resumedCanceled.transport.requestId,canceled.retry_request_id);
 const intakeBytes=Buffer.from(JSON.stringify(payload)),intakeSpec={schemaVersion:'atlas.reforecast-payload.v1',chunkBytes:WORKBOOK_AUDIT_CHUNK_BYTES,byteLength:intakeBytes.length,sha256:sha(intakeBytes),chunkCount:Math.ceil(intakeBytes.length/WORKBOOK_AUDIT_CHUNK_BYTES)},intakePendingId=randomUUID(),intakeArgs={p_community_id:cid,p_request_id:intakePendingId,p_manifest:intakeSpec,p_manifest_hash:workbookEvidenceHash(intakeSpec)};
 const intakeStage=await call('atlas_stage_reforecast_payload',{...intakeArgs,p_action:'begin'}),part=intakeBytes.subarray(0,WORKBOOK_AUDIT_CHUNK_BYTES);await call('atlas_stage_reforecast_payload',{...intakeArgs,p_manifest:null,p_action:'put',p_index:0,p_chunk:part.toString('base64'),p_chunk_hash:sha(part)});
 await cancelWorkbookStaging(central,{kind:'intake',requestId:intakePendingId,manifestHash:intakeArgs.p_manifest_hash});await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from atlas_private.reforecast_payload_chunks where staging_id=$1',[intakeStage.staging_id])).rows[0].n,0);await login(1);
 assert.equal((await saveUpload(central,{communityId:cid,requestId:intakePendingId,payload})).payload.source.sha256,sourceHash);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from atlas_workbook_audits')).rows[0].n,1);assert.equal((await db.query('select audit_id from atlas_private.workbook_audit_uploads where upload_id=$1',[pending.upload_id])).rows[0].audit_id,null);
 await assert.rejects(()=>db.query('update atlas_private.workbook_audit_chunks set payload=$1 where upload_id=$2',[new Uint8Array([1]),finalized.upload_id]),/immutable/);
 await assert.rejects(()=>db.query('update atlas_private.workbook_audit_uploads set manifest=$1 where upload_id=$2',[{},pending.upload_id]),/immutable/);
 const proof={scope:process.env.ATLAS_AUDIT_PROOF_SCOPE||(process.env.ATLAS_REAL_DORO_SOURCE?'Supplied Doro review report (not the original Vena source) in isolated PGlite; no production mutation':'Synthetic supplemental regression'),sourceHash,fingerprint:audit.fingerprint,manifestHash:reference.manifestHash,serializedAuditBytes:auditBytes.length,originalBytes:sourceBytes.length,maximumRequestBytes:Math.max(...calls.map(c=>c.bytes)),rpcCount:calls.length,elapsedMs:reference.transport.durationMs,inventory:audit.summary,exactAuditAndSourceReadback:true,boundedIntakeEnvelopeSaveAndReadback:true,providerPdfAndXlsxReceiptsRetainLegacyValidation:true,workbookAuditCannotBeBypassedByProviderLabel:true,duplicateRequestIsIdempotent:true,repeatedAuditIntakeRetriesRecoverLostBeginAndFinalizeResponses:true,transientDiagnosticsExcludedFromImmutableEvidence:true,authorizedSessionsMatch:true,unauthorizedSessionRejected:true,incompleteFinalizeAtomic:true,changedChunkRejected:true,immutable:true,freshRoleAndCommunityRevocationEnforced:true,stagingCountAndByteQuotasEnforced:true,reloadResumesSameInterruptedRequest:true,cancelPendingReleasesQuotaAndRetainsTombstone:true,finalizedCancellationRejected:true,canceledRequestsHaveDurableRetryIdentity:true};
 if(process.env.ATLAS_AUDIT_PROOF_PATH)fs.writeFileSync(process.env.ATLAS_AUDIT_PROOF_PATH,JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof,null,2));
}catch(error){console.error(error.message,error.where||'',error.position||'',error.internalPosition||'',error.internalQuery||'',error.stack);process.exitCode=1;}finally{await db.close();}
