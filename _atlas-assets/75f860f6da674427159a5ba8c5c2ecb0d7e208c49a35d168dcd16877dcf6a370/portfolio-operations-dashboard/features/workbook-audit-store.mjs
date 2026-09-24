import {workbookEvidenceHash} from './workbook-integrity.mjs?v=c0a7997612845f22';
const requests=new Map(),one=value=>Array.isArray(value)?value[0]:value;
export function compactWorkbookAudit(audit,record){return {schemaVersion:audit.schemaVersion,auditId:record.audit_id,sourceHash:record.source_hash,fingerprint:record.fingerprint,summary:audit.summary,rowCoverage:audit.rowCoverage,authorityScope:audit.authorityScope||null,previousFingerprint:audit.previousFingerprint||null,findings:audit.findings,safeToApprove:audit.safeToApprove,inventory:{retained:true,sheetCount:audit.inventory.sheets.length}};}
export async function persistWorkbookAudit(central,audit,{communityId=null,sourceHash,requestId}={}){
 if(audit?.auditId){await readWorkbookAudit(central,audit,{sourceHash});if(communityId)await central.rpc('atlas_bind_workbook_audit',{p_audit_id:audit.auditId,p_community_id:communityId});return audit;}
 const actor=central.getSession?.()?.user?.id;if(!actor)throw Error('Sign in before saving workbook evidence.');
 if(!audit?.fingerprint||!/^([a-f0-9]{64})$/i.test(sourceHash||''))throw Error('Workbook source and audit hashes are required.');
 const key=[actor,communityId,sourceHash,audit.fingerprint].join('|');if(!requests.has(key))requests.set(key,requestId||crypto.randomUUID());
 const record=one(await central.rpc('atlas_save_workbook_audit',{p_community_id:communityId,p_source_hash:sourceHash,p_audit:audit,p_request_id:requests.get(key)}));
 if(central.getSession?.()?.user?.id!==actor||!record?.audit_id||record.source_hash!==sourceHash||record.fingerprint!==audit.fingerprint)throw Error('Workbook audit persistence could not be verified. Your edits are retained.');
 const ref=compactWorkbookAudit(audit,record);await readWorkbookAudit(central,ref,{sourceHash});return ref;
}
export async function readWorkbookAudit(central,reference,{sourceHash=reference?.sourceHash}={}){
 const actor=central.getSession?.()?.user?.id;if(!actor||!reference?.auditId)throw Error('A saved workbook audit and signed-in reader are required.');
 const rows=await central.fetchJson(`/atlas_workbook_audits?audit_id=eq.${encodeURIComponent(reference.auditId)}&select=audit_id,source_hash,fingerprint,evidence&limit=1`),record=rows?.[0];
 if(central.getSession?.()?.user?.id!==actor||rows?.length!==1||record.audit_id!==reference.auditId||record.source_hash!==sourceHash||record.fingerprint!==reference.fingerprint)throw Error('The saved workbook audit does not match this source version.');
 const copy=structuredClone(record.evidence);delete copy.fingerprint;
 if(workbookEvidenceHash(copy)!==record.fingerprint)throw Error('Workbook audit content hash mismatch.');return record.evidence;
}
