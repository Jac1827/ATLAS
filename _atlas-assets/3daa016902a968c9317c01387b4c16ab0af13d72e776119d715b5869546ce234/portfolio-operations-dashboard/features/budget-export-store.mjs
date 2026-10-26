import {financeAccessKey} from './canonical-finance.mjs?v=210b482c6f40c656';

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function id(value){if(!uuid.test(value||''))throw Error('Select an exact saved budget and keep a stable export request ID.');}
function guard(central,communityId){
 id(communityId);const actor=central?.getSession?.()?.user?.id,key=financeAccessKey(central);
 if(!uuid.test(actor||'')||central.isAuthenticated?.()===false||central.isEnabled?.()===false)throw Error('Sign in to export the selected budget.');
 return ()=>{if(central.getSession?.()?.user?.id!==actor||financeAccessKey(central)!==key||central.isAuthenticated?.()===false)throw Error('The signed-in account or financial access changed. Reopen Budget Export.');};
}
async function rpc(central,name,args,check){check();await central.refreshSession?.();check();const result=await central.fetchJson('/rpc/'+name,{method:'POST',body:JSON.stringify(args)});check();return result;}
function verify(receipt,options){
 if(receipt?.verified!==true||!uuid.test(receipt.exportId||'')||receipt.communityId!==options.communityId||!receipt.contentHash||!receipt.sourceFingerprint||!receipt.snapshot||!receipt.generatedAt||!uuid.test(receipt.generatedBy||''))throw Error('The immutable budget export receipt could not be verified.');
 for(const key of ['revisionId','publicationId','originalBudgetVersionId'])if(options[key]&&receipt[key]!==options[key])throw Error('The export receipt belongs to another selected budget version.');
 if(options.options&&!equal(receipt.options,options.options))throw Error('The retained export options differ from the reviewed selection.');
 return receipt;
}
export async function previewBudgetExport(central,{communityId,revisionId=null,publicationId=null,originalBudgetVersionId=null}){
 const check=guard(central,communityId);[revisionId,publicationId,originalBudgetVersionId].filter(Boolean).forEach(id);
 if(Boolean(originalBudgetVersionId)===Boolean(revisionId||publicationId))throw Error('Choose one exact saved budget version.');
 const selection=Object.fromEntries(Object.entries({revisionId,publicationId,originalBudgetVersionId}).filter(([,value])=>value));
 const result=await rpc(central,'atlas_preview_budget_export',{p_community_id:communityId,p_selection:selection},check);
 if(result?.verified!==true||result.communityId!==communityId||!result.snapshot||!result.config||!result.sourceFingerprint||!result.contentHash||Object.entries(selection).some(([key,value])=>result[key]!==value))throw Error('The budget preview does not match the selected immutable version.');
 return result;
}
export async function readBudgetExport(central,{communityId,exportId}){
 id(exportId);const check=guard(central,communityId),receipt=await rpc(central,'atlas_read_budget_export',{p_community_id:communityId,p_export_id:exportId},check);
 if(receipt?.exportId!==exportId)throw Error('The historical export identity changed.');return verify(receipt,{communityId});
}
export async function captureBudgetExport(central,options){
 const {communityId,revisionId=null,publicationId=null,originalBudgetVersionId=null,requestId,validation={},override=null}=options;
 id(requestId);[revisionId,publicationId,originalBudgetVersionId].filter(Boolean).forEach(id);
 if(Boolean(originalBudgetVersionId)===Boolean(revisionId||publicationId))throw Error('Choose one exact saved budget version.');
 const check=guard(central,communityId),selection=Object.fromEntries(Object.entries({revisionId,publicationId,originalBudgetVersionId}).filter(([,value])=>value));
 const args={p_community_id:communityId,p_selection:selection,p_request_id:requestId,p_options:options.options,p_validation:validation,p_override:override};
 // Retrying this same request is safe even after a lost response: the database
 // rejects a changed selection, actor or options for an existing request ID.
 const result=verify(await rpc(central,'atlas_capture_budget_export',args,check),options);
 const retained=await readBudgetExport(central,{communityId,exportId:result.exportId});check();
 if(!equal(result,retained))throw Error('The export was captured but exact readback is not confirmed. Retry the same export request.');return retained;
}
export async function completeBudgetExport(central,{communityId,exportId,requestId,files}){
 id(exportId);id(requestId);const check=guard(central,communityId);
 const result=await rpc(central,'atlas_complete_budget_export',{p_community_id:communityId,p_export_id:exportId,p_request_id:requestId,p_files:files},check);
 if(result?.verified!==true||result.communityId!==communityId||result.exportId!==exportId||!equal(result.files,files))throw Error('Generated file receipt could not be verified.');
 const rows=await central.fetchJson('/atlas_budget_export_files?community_id=eq.'+communityId+'&export_id=eq.'+exportId+'&select=*&limit=1');check();
 if(rows?.length!==1||rows[0].file_record_id!==result.fileRecordId||rows[0].request_id!==requestId||!equal(rows[0].files,files))throw Error('Generated file history is not yet confirmed. Keep this request and retry.');return result;
}
export async function readBudgetExportHistory(central,{communityId}){
 const check=guard(central,communityId),rows=[],seen=new Set();
 for(let offset=0;;offset+=100){const page=await central.fetchJson('/atlas_budget_exports?community_id=eq.'+communityId+'&select=export_id,community_id,revision_id,publication_id,original_budget_version_id,budget_version,budget_status,generated_at,generated_by,options,validation,content_hash,source_fingerprint&order=generated_at.desc,export_id.desc&limit=100&offset='+offset);check();
  if(!Array.isArray(page))throw Error('Budget export history is unavailable.');for(const row of page){if(row.community_id!==communityId||!uuid.test(row.export_id||'')||seen.has(row.export_id))throw Error('Budget export history scope changed.');seen.add(row.export_id);rows.push(row);}if(page.length<100)return rows;
 }
}
export async function readBudgetExportTolerances(central,{communityId}){
 const check=guard(central,communityId),result=await rpc(central,'atlas_read_budget_export_tolerances',{p_community_id:communityId},check);
 if(result?.communityId!==communityId||!Number.isInteger(result.version)||!result.rules)throw Error('Budget tolerance settings could not be verified.');return result;
}
export async function saveBudgetExportTolerances(central,{communityId,expectedVersion,requestId,rules,reason}){
 id(requestId);const check=guard(central,communityId),result=await rpc(central,'atlas_save_budget_export_tolerances',{p_community_id:communityId,p_expected_version:expectedVersion,p_request_id:requestId,p_rules:rules,p_reason:reason},check);
 if(result?.communityId!==communityId||result.version!==expectedVersion+1||!uuid.test(result.versionId||'')||!equal(result.rules,rules))throw Error('Budget tolerance save could not be verified.');
 const rows=await central.fetchJson('/atlas_budget_export_tolerances?community_id=eq.'+communityId+'&version_id=eq.'+result.versionId+'&select=*&limit=1');check();
 if(rows?.length!==1||rows[0].request_id!==requestId||!equal(rows[0].rules,rules))throw Error('Budget tolerance readback is unavailable. Retain and retry this request.');return result;
}
