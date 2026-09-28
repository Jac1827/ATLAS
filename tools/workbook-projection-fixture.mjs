import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {persistWorkbookAudit,readWorkbookAuditBytes} from '../docs/portfolio-operations-dashboard/features/workbook-audit-store.mjs';
export async function installProjectionFixture(db){
 await db.exec('reset role');
 for(const name of ['20260924232845_bounded_workbook_audit_transport.sql','20260925011545_workbook_audit_validation_performance.sql','20260925032350_workbook_raw_json_canonical.sql','20260925033844_workbook_raw_evidence_projections.sql','20260925035358_workbook_typed_raw_validation.sql'])await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 // Exercise the same replay-safe activation that production deploys.
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260925065842_activate_workbook_raw_evidence_projection.sql',import.meta.url),'utf8'));
}
export function projectionCentral(db,actor='00000000-0000-0000-0000-000000000001'){
 return {isEnabled:()=>true,isAuthenticated:()=>true,getSession:()=>({user:{id:actor}}),rpc:async(name,args)=>{const values=Object.values(args);return (await db.query(`select public.${name}(${Object.keys(args).map((key,i)=>key+'=> $'+(i+1)).join(',')}) result`,values)).rows[0].result;}};
}
export async function saveProjectedAudit(db,communityId,evidence,sourceBytes){
 const central=projectionCentral(db),reference=await persistWorkbookAudit(central,evidence,{communityId,sourceHash:evidence.inventory.sourceHash,requestId:randomUUID(),sourceBytes});
 const verified=await readWorkbookAuditBytes(central,reference,{sourceHash:evidence.inventory.sourceHash});
 if(verified.evidence.fingerprint!==evidence.fingerprint)throw Error('Full browser raw evidence fingerprint mismatch');
 return {audit_id:reference.auditId,fingerprint:reference.fingerprint,source_hash:reference.sourceHash,manifest_hash:reference.manifestHash};
}
