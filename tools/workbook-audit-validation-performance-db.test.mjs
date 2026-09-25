import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {inspectActualWorkbook} from './doro-workbook-acceptance.mjs';
import {parseReforecastWorkbook} from '../docs/portfolio-operations-dashboard/features/reforecast-intake.mjs';
import {workbookEvidenceHash} from '../docs/portfolio-operations-dashboard/features/workbook-integrity.mjs';
const require=createRequire(import.meta.url),XLSX=require('../docs/portfolio-operations-dashboard/assets/xlsx.full.min.js'),{fixture}=require('./financial-intake-fixture.cjs');
const {db,cid,other,signIn}=await fixture(),hash=bytes=>createHash('sha256').update(bytes).digest('hex'),migration=name=>fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'),timings=[];
const call=async(name,args)=>{const t=performance.now(),result=(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;timings.push({operation:name,ms:Math.round(performance.now()-t)});if(!name.includes('put_workbook'))console.log(JSON.stringify(timings.at(-1)));return result;};
const status=(requestId,manifestHash,communityId=cid)=>call('atlas_read_workbook_audit_upload_receipt',[communityId,requestId,manifestHash]);
try{
 await db.exec('reset role');
 const original=migration('20260924121641_planning_cell_workbook_integrity_governance.sql');
 for(const name of ['20260924121641_planning_cell_workbook_integrity_governance.sql','20260924121647_immutable_workbook_audits_and_monthly_governance.sql','20260924232845_bounded_workbook_audit_transport.sql'])await db.exec(migration(name));
 const old=original.match(/create or replace function atlas_private.workbook_canonical_json\([\s\S]*?\$\$;/)[0].replaceAll('workbook_canonical_json','workbook_canonical_json_previous');await db.exec(old);
 await db.exec(migration('20260925005521_workbook_audit_validation_performance.sql'));
 const examples=[null,true,false,0,-0,1.2,-100.001,1e-8,'  =SUM(A1)\n"quoted"\\escape 日本 é 😀',[],{},[1,null,[true,0]],{'z':1,'a':{'zero':0,'blank':null,'spaced':'a, b: c'},'short':[]},...Array.from({length:50},(_,i)=>({b:[i,-i,0,null,'x'.repeat(i)],a:{last:i/100,empty:{},values:[{},[],false]}}))];
 for(const value of examples){const r=(await db.query('select atlas_private.workbook_canonical_json($1::jsonb) current,atlas_private.workbook_canonical_json_previous($1::jsonb) previous',[JSON.stringify(value)])).rows[0];assert.equal(r.current,r.previous);}
 const serializedValueSql="select encode(sha256(convert_to(atlas_private.workbook_canonical_json($1::jsonb-'fingerprint'),'UTF8')),'hex') fingerprint";
 let bytes,result;
 if(process.env.ATLAS_DORO_WORKBOOK){bytes=fs.readFileSync(process.env.ATLAS_DORO_WORKBOOK);result=await inspectActualWorkbook(bytes,{fileName:'private-source.xlsx',periods:['2026-09','2026-10','2026-11','2026-12']});}
 else {const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['GL','Account','Sep 2026','Oct 2026'],['5120','Rent',0,123],['6330','Expense',10,-1]]);sheet.D2={t:'n',v:123,f:'C2+123'};XLSX.utils.book_append_sheet(book,sheet,'Input');bytes=XLSX.write(book,{bookType:'xlsx',type:'buffer'});const evidence=await parseReforecastWorkbook(bytes,{xlsx:XLSX,fileName:'fixture.xlsx'});result={evidence,audit:evidence.integrity};}
 const audit=result.evidence.integrity,sourceHash=hash(bytes),auditBytes=Buffer.from(JSON.stringify(audit)),chunkBytes=196608,manifest={schemaVersion:'atlas.workbook-audit-upload.v1',sourceHash,fingerprint:audit.fingerprint,chunkBytes,audit:{byteLength:auditBytes.length,sha256:hash(auditBytes),chunkCount:Math.ceil(auditBytes.length/chunkBytes)},source:{byteLength:bytes.length,sha256:sourceHash,chunkCount:Math.ceil(bytes.length/chunkBytes)}},manifestHash=workbookEvidenceHash(manifest),requestId=randomUUID();
 const start=performance.now();assert.equal((await db.query(serializedValueSql,[audit])).rows[0].fingerprint,audit.fingerprint);timings.push({operation:'optimized_complete_fingerprint',ms:Math.round(performance.now()-start)});
 if(process.env.ATLAS_COMPARE_PREVIOUS){const t=performance.now();assert.equal((await db.query(serializedValueSql.replace('workbook_canonical_json','workbook_canonical_json_previous'),[audit])).rows[0].fingerprint,audit.fingerprint);timings.push({operation:'previous_complete_fingerprint',ms:Math.round(performance.now()-t)});}
 const tampered=structuredClone(audit);tampered.inventory.sheets[0].cells[0].value='changed';assert((await db.query('select atlas_private.workbook_integrity_issues($1) issues',[tampered])).rows[0].issues.some(row=>row.code==='workbook_fingerprint_mismatch'));
 const dependencyBook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(dependencyBook,{'!ref':'A1:B1',A1:{t:'n',v:2},B1:{t:'n',v:3,f:'A1+1'}},'Inputs');
 const dependencyAudit=(await parseReforecastWorkbook(XLSX.write(dependencyBook,{bookType:'xlsx',type:'buffer'}),{fileName:'dependency-fixture.xlsx',xlsx:XLSX})).integrity;
 const omitted=structuredClone(dependencyAudit);omitted.graph.edges=[];delete omitted.fingerprint;omitted.fingerprint=workbookEvidenceHash(omitted);
 assert((await db.query('select atlas_private.workbook_integrity_issues($1) issues',[omitted])).rows[0].issues.some(row=>row.code==='workbook_dependency_omitted'),'A recomputed client fingerprint never substitutes for independent raw-formula dependency validation');
 await signIn(1);
 await assert.rejects(db.query('select atlas_private.workbook_integrity_issues_verified($1,$2)',[audit,audit.fingerprint]),/permission denied/,'Clients may not supply their own verified hash');
 assert.equal(await status(requestId,manifestHash),null);
 const pending=await call('atlas_begin_workbook_audit_upload',[cid,requestId,manifest,manifestHash]);
 assert.deepEqual((await status(requestId,manifestHash)).chunks,[]);
 await assert.rejects(status(requestId,'b'.repeat(64)),/manifest or scope mismatch/);
 await assert.rejects(status(requestId,manifestHash,other),/manifest or scope mismatch/);
 for(const [stream,data] of [['audit',auditBytes],['source',bytes]])for(let offset=0,index=0;offset<data.length;offset+=chunkBytes,index++){const chunk=data.subarray(offset,offset+chunkBytes);await call('atlas_put_workbook_audit_chunk',[pending.upload_id,stream,index,chunk.toString('base64'),hash(chunk)]);}
 const ready=await status(requestId,manifestHash);assert.equal(ready.chunks.length,manifest.audit.chunkCount+manifest.source.chunkCount);assert.equal(ready.audit_id,null);assert(ready.chunks.every(row=>Object.keys(row).sort().join(',')==='byte_length,chunk_index,sha256,stream'));
 await signIn(2);assert.equal(await status(requestId,manifestHash),null,'Another authorized actor may not inspect the uploader staging request');await signIn(3);await assert.rejects(status(requestId,manifestHash),/Authorized workbook uploader and community/);await signIn(1);
 const finalized=await call('atlas_finalize_workbook_audit_upload',[pending.upload_id,requestId,manifestHash]),readback=await status(requestId,manifestHash);assert.deepEqual(readback.receipt,Object.fromEntries(['audit_id','source_hash','fingerprint','manifest_hash'].map(key=>[key,finalized[key]])));assert.equal(readback.audit_id,finalized.audit_id);
 assert.equal((await call('atlas_finalize_workbook_audit_upload',[pending.upload_id,requestId,manifestHash])).audit_id,finalized.audit_id);
 const persisted=(await db.query('select evidence,server_validation from atlas_workbook_audits where audit_id=$1',[finalized.audit_id])).rows[0];assert.equal(workbookEvidenceHash(persisted.evidence),workbookEvidenceHash(JSON.parse(JSON.stringify(audit))),'Entire persisted unscoped audit must match the transmitted JSON without producing a raw-source diagnostic diff');
 assert.equal(persisted.server_validation.length,audit.findings.filter(f=>f.severity==='blocking').length);
 if(process.env.ATLAS_DORO_WORKBOOK){const scopedSaved=await call('atlas_save_workbook_audit',[cid,sourceHash,result.audit,randomUUID()]);const retained=(await db.query('select evidence,server_validation from atlas_workbook_audits where audit_id=$1',[scopedSaved.audit_id])).rows[0];assert.equal(workbookEvidenceHash(retained.evidence),workbookEvidenceHash(JSON.parse(JSON.stringify(result.audit))),'Entire scoped audit must match the transmitted JSON');assert.deepEqual(retained.server_validation,[]);}
 const cancelId=randomUUID(),cancel=await call('atlas_begin_workbook_audit_upload',[cid,cancelId,manifest,manifestHash]);await call('atlas_cancel_workbook_staging',['audit',cancelId,manifestHash]);const canceled=await status(cancelId,manifestHash);assert.equal(canceled.upload_id,cancel.upload_id);assert.equal(canceled.canceled,true);assert(canceled.retry_request_id);assert.equal(canceled.receipt,null);
 await db.exec('reset role');await db.exec("update atlas_user_profiles set status='inactive' where user_id='00000000-0000-0000-0000-000000000001'");await signIn(1);await assert.rejects(status(requestId,manifestHash),/Authorized workbook uploader and community/);
 await db.exec('reset role;set role anon');await assert.rejects(status(requestId,manifestHash),/permission denied/);
 const proof={scope:process.env.ATLAS_DORO_WORKBOOK?'Actual supplied Doro workbook in isolated PostgreSQL runtime; no production acceptance claimed':'Synthetic local PostgreSQL regression',sourceHash,auditFingerprint:audit.fingerprint,auditBytes:auditBytes.length,originalBytes:bytes.length,canonicalParityCases:examples.length,completeSourceAndAuditRetained:true,privateHashHelperDenied:true,zeroIssuesForScopedActual:!!process.env.ATLAS_DORO_WORKBOOK,receiptReadsAreOwnerAndScopeBound:true,completedReceiptReadback:true,canceledReceiptRetained:true,unauthorizedDenied:true,timings:timings.filter(row=>!row.operation.includes('put_workbook'))};
 if(process.env.ATLAS_AUDIT_PERFORMANCE_PROOF)fs.writeFileSync(process.env.ATLAS_AUDIT_PERFORMANCE_PROOF,JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify(proof));
}finally{await db.close();}
