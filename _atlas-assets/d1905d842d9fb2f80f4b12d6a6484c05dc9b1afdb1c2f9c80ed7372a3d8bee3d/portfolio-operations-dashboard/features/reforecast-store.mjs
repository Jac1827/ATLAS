/* Canonical reforecast transport: no browser-local financial fallback. */
import {persistReforecastPayload} from './workbook-audit-store.mjs?v=9e9116b68ad81b7a';
import {effectiveActiveSnapshot as projectActive} from './reforecast-active.mjs?v=03b191a6926d70ca';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const period=/^20\d{2}-(0[1-9]|1[0-2])$/;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const identity=central=>central.getSession?.()?.user?.id;
function scope(id){if(!uuid.test(id))throw Error('Explicitly select an authorized ATLAS community.');}
function request(id){if(!uuid.test(id))throw Error('A stable request ID is required to save safely.');}
function actorGuard(central,actor){if(central.getSession&&identity(central)!==actor)throw Error('The signed-in account changed. Reopen this workspace before continuing.');}
async function rpc(central,name,args){const actor=identity(central);await central.refreshSession?.();actorGuard(central,actor);const data=await central.fetchJson('/rpc/'+name,{method:'POST',body:JSON.stringify(args)});actorGuard(central,actor);return ['atlas_save_reforecast_upload','atlas_save_reforecast_registry','atlas_publish_reforecast','atlas_review_reforecast_source','atlas_save_forecast_contract'].includes(name)&&Array.isArray(data)?data[0]:data;}
async function exactRecord(central,table,column,saved){
 if(!saved||!uuid.test(saved[column]))throw Error('Save was not confirmed. Your working edits are retained.');
 const rows=await central.fetchJson(`/${table}?${column}=eq.${saved[column]}&select=*&limit=1`);
 const norm=r=>r&&Object.fromEntries(Object.entries(r).map(([k,v])=>[k,['created_at','published_at'].includes(k)&&v?new Date(v).toISOString():v]));
 if(!rows?.[0]||!equal(norm(rows[0]),norm(saved)))throw Error('The committed record could not be verified. Your edits are retained; retry the same save.');return rows[0];
}
export async function saveUpload(central,{communityId,requestId,payload}){
 scope(communityId);request(requestId);const actor=identity(central);
 const result=await persistReforecastPayload(central,{communityId,requestId,payload});actorGuard(central,actor);return result;
}
export async function saveRegistry(central,{communityId,expectedVersionId=null,requestId,payload}){
 scope(communityId);request(requestId);const actor=identity(central);
 const saved=await rpc(central,'atlas_save_reforecast_registry',{p_community_id:communityId,p_expected_version_id:expectedVersionId,p_request_id:requestId,p_payload:payload});
 const result=await exactRecord(central,'atlas_reforecast_registries','version_id',saved);actorGuard(central,actor);return result;
}
export async function readSourceBundle(central,{communityId,periods,baselineVersionIds=null,registryVersionId=null}){
 scope(communityId);if(!Array.isArray(periods)||!periods.length||periods.length>24||periods.some(p=>!period.test(p)))throw Error('Choose valid reporting months.');
 const result=await rpc(central,'atlas_read_reforecast_source',{p_community_id:communityId,p_periods:periods,p_baseline_version_ids:baselineVersionIds?.length?baselineVersionIds:null,p_registry_version_id:registryVersionId});
 if(result?.communityId!==communityId||!Array.isArray(result.periods)||result.periods.some(p=>!periods.includes(p)))throw Error('Reforecast source scope mismatch.');return result;
}
// Explicit baseline selection is resolved by the server against immutable vintages.
export async function readBuilderSource(central,{communityId,periods,baselineVersionIds=null,registryVersionId=null,baselineType='original_budget',baselinePublicationIds=null}){
 scope(communityId);if(!Array.isArray(periods)||!periods.length||periods.length>24||new Set(periods).size!==periods.length||periods.some(p=>!period.test(p)))throw Error('Choose distinct full calendar months.');
 if(!['original_budget','approved_reforecast'].includes(baselineType))throw Error('Select an approved baseline.');
 const actor=identity(central),result=await rpc(central,'atlas_read_reforecast_builder_source',{p_community_id:communityId,p_periods:periods,p_baseline_version_ids:baselineVersionIds?.length?baselineVersionIds:null,p_registry_version_id:registryVersionId,p_baseline_type:baselineType,p_baseline_publication_ids:baselinePublicationIds?.length?baselinePublicationIds:null});
 actorGuard(central,actor);if(result?.communityId!==communityId||!Array.isArray(result.periods)||!equal([...result.periods].sort(),[...periods].sort())||!result.baseline)throw Error('Forecast baseline readback did not match the selected community and months.');return result;
}
export async function readSources(central,{communityId}){
 scope(communityId);const actor=identity(central),rows=await rpc(central,'atlas_read_reforecast_sources',{p_community_id:communityId});actorGuard(central,actor);
 if(!Array.isArray(rows)||rows.some(row=>(row.communityId||row.community_id)!==communityId))throw Error('Forecast source receipt scope mismatch.');return rows;
}
export async function reopenScenario(central,{communityId,scenarioId,expectedRevision,requestId,reason}){
 scope(communityId);request(scenarioId);request(requestId);const actor=identity(central);
 const result=await rpc(central,'atlas_reopen_reforecast',{p_scenario_id:scenarioId,p_expected_revision:expectedRevision,p_request_id:requestId,p_reason:reason});
 await exactRecord(central,'atlas_reforecast_revisions','revision_id',result?.revision);actorGuard(central,actor);
 if(result.head?.community_id!==communityId)throw Error('Reopened revision community mismatch.');return result;
}
export async function readPublication(central,{publicationId,communityId}){
 scope(communityId);request(publicationId);const actor=identity(central),result=await rpc(central,'atlas_read_reforecast_publication',{p_publication_id:publicationId});actorGuard(central,actor);
 if(result?.communityId!==communityId||result.publicationId!==publicationId||result.verified!==true)throw Error('Immutable forecast report readback failed.');return result;
}
export async function readContracts(central,{communityId}){
 scope(communityId);const rows=await rpc(central,'atlas_read_forecast_contracts',{p_community_id:communityId});if(!Array.isArray(rows)||rows.some(row=>row.community_id!==communityId))throw Error('Contract readback community mismatch.');return rows;
}
export async function saveContract(central,{communityId,contractId,expectedVersion=0,requestId,payload}){
 scope(communityId);request(contractId);request(requestId);const actor=identity(central);let result=await rpc(central,'atlas_save_forecast_contract',{p_community_id:communityId,p_contract_id:contractId,p_expected_version:expectedVersion,p_request_id:requestId,p_payload:payload});if(Array.isArray(result))result=result[0];
 const rows=await readContracts(central,{communityId});actorGuard(central,actor);const saved=rows.find(row=>row.contract_id===contractId);if(!saved||!equal(saved,result))throw Error('Contract save could not be read back. Retain your edits and retry this request.');return saved;
}
export async function captureDigest(central,{communityIds,periods,requestId}){
 communityIds.forEach(scope);request(requestId);const actor=identity(central),result=await rpc(central,'atlas_capture_reforecast_digest',{p_community_ids:communityIds,p_periods:periods,p_request_id:requestId});actorGuard(central,actor);
 if(!result?.verified||!result.snapshotId||!result.contentHash||!Array.isArray(result.communities)||result.communities.some(row=>!communityIds.includes(row.communityId)))throw Error('Portfolio digest receipt verification failed.');
 const readback=await rpc(central,'atlas_read_reforecast_digest',{p_snapshot_id:result.snapshotId});actorGuard(central,actor);if(!equal(readback,result))throw Error('The saved portfolio digest could not be read back. Retry the same request.');return readback;
}
export async function reviewSource(central,{communityId,uploadId,requestId,review}){
 scope(communityId);request(uploadId);request(requestId);const actor=identity(central),saved=await rpc(central,'atlas_review_reforecast_source',{p_upload_id:uploadId,p_request_id:requestId,p_review:review});actorGuard(central,actor);
 const rows=await readSources(central,{communityId});actorGuard(central,actor);const receipt=rows.find(row=>(row.uploadId||row.upload_id)===uploadId);
 if(!receipt||receipt.reviewId!==saved?.review_id||receipt.reviewHash!==saved?.content_hash||receipt.review?.status!==review.status)throw Error('The source review was saved but its receipt is unavailable. Retry with the same request ID.');return {saved,receipt};
}
export async function saveScenario(central,{communityId,scenarioId,expectedRevision=0,requestId,action='save_draft',payload}){
 scope(communityId);request(requestId);if(!uuid.test(scenarioId))throw Error('Keep a stable scenario ID across saves and retries.');const actor=identity(central);
 const result=await rpc(central,'atlas_save_reforecast_scenario',{p_community_id:communityId,p_scenario_id:scenarioId,p_expected_revision:expectedRevision,p_request_id:requestId,p_action:action,p_payload:payload});
 await exactRecord(central,'atlas_reforecast_revisions','revision_id',result?.revision);actorGuard(central,actor);
 const heads=await central.fetchJson(`/atlas_reforecast_heads?scenario_id=eq.${scenarioId}&select=*&limit=1`);
 if(heads?.[0]?.revision_id!==result.revision.revision_id)throw Error('Your changes were saved but a newer revision already exists. Keep your edits and reload the current scenario.');
 actorGuard(central,actor);return result;
}
export async function approveAndLock(central,options){
 const overlay=options.payload?.scenarioPurpose==='str_overlay',priorActive=overlay?await readActive(central,{communityIds:[options.communityId],periods:options.payload.periods}):null;
 const result=await saveScenario(central,{...options,action:'approve_lock'}),saved=result.publication;
 if(!saved?.publication_id)throw Error('Approval was not verified. Keep this revision open and retry the same request.');
 await exactRecord(central,'atlas_reforecast_publications','publication_id',saved);
 const active=await readActive(central,{communityIds:[options.communityId],periods:saved.periods});
 if(overlay){
  const receipt=await readPublication(central,{communityId:options.communityId,publicationId:saved.publication_id});
  if(receipt.snapshot?.identity?.parentPublication?.publicationId!==options.payload.parentPublication?.publicationId||active.some(row=>row.publicationId===saved.publication_id)||!equal(active,priorActive))throw Error('STR approval readback did not preserve the Conventional active baseline.');
  return {...result,active,overlayPublication:receipt};
 }
 const publication=active.find(row=>row.publicationId===saved.publication_id);
 const inherited=new Set(result.source?.lockedPeriods||[]);
 if(saved.periods.some(p=>!inherited.has(p)&&(!publication||publication.verified!==true||!publication.activePeriods?.includes(p))))throw Error('Approval was saved but active baseline readback is unavailable. Retry this same request to verify it.');
 return {...result,active};
}
export async function readWorkspace(central,{communityIds}){
 communityIds.forEach(scope);const result=await rpc(central,'atlas_read_reforecast_workspace',{p_community_ids:communityIds});
 if(!Array.isArray(result)||result.some(r=>!communityIds.includes(r.head?.community_id)))throw Error('Invalid reforecast workspace readback.');return result;
}
export async function publishActive(central,{scenarioId,expectedRevision,requestId,reason}){
 request(scenarioId);request(requestId);const actor=identity(central);
 const saved=await rpc(central,'atlas_publish_reforecast',{p_scenario_id:scenarioId,p_expected_revision:expectedRevision,p_request_id:requestId,p_reason:reason});
 await exactRecord(central,'atlas_reforecast_publications','publication_id',saved);
 const active=await readActive(central,{communityIds:[saved.community_id],periods:saved.periods});
 const result=active.find(p=>p.publicationId===saved.publication_id);
 if(!result||saved.periods.some(p=>!result.activePeriods.includes(p)))throw Error('Publication was saved but active readback is not confirmed. The locked revision is retained for an Admin to retry.');
 actorGuard(central,actor);return result;
}
export async function readActive(central,{communityIds,periods=null}){
 communityIds.forEach(scope);const result=await rpc(central,'atlas_read_active_reforecast',{p_community_ids:communityIds,p_periods:periods});
 if(!Array.isArray(result)||result.some(r=>!communityIds.includes(r.communityId)))throw Error('Invalid active-reforecast readback.');
 if(result.some(r=>r.verified!==true||r.approved!==true||r.locked!==true||!r.contentHash||!r.publicationId||!r.revisionId||!Array.isArray(r.activePeriods)||!r.snapshot))throw Error('Active baseline unavailable: verified approval and lock readback are required.');return result;
}
// Retained publications are accuracy vintages, never evidence of an active head.
// Their snapshots and source bundles are exactly those frozen at publication.
export async function readPublicationHistory(central,{communityId}){
 scope(communityId);const actor=identity(central),rows=[],seen=new Set();
 await central.refreshSession?.();actorGuard(central,actor);
 for(let offset=0;;offset+=100){
  const page=await central.fetchJson(`/atlas_reforecast_publications?community_id=eq.${communityId}&select=publication_id,community_id,scenario_id,revision_id,version,periods,snapshot,source,reason,published_by,published_role,published_at&order=published_at.asc,publication_id.asc&limit=100&offset=${offset}`);actorGuard(central,actor);
  if(!Array.isArray(page)||page.some(r=>r.community_id!==communityId||!uuid.test(r.publication_id)||!Array.isArray(r.periods)||!r.snapshot||r.snapshot.identity?.communityId&&r.snapshot.identity.communityId!==communityId))throw Error('Publication history scope mismatch.');
  for(const row of page){
   if(seen.has(row.publication_id))throw Error('Publication history changed while reading. Refresh the report.');seen.add(row.publication_id);
   rows.push({publicationId:row.publication_id,communityId:row.community_id,scenarioId:row.scenario_id,revisionId:row.revision_id,version:row.version,periods:row.periods,activePeriods:[],publishedAt:row.published_at,publishedBy:row.published_by,publishedRole:row.published_role,reason:row.reason,snapshot:row.snapshot,source:row.source,isPublicationHistory:true});
  }
  if(page.length<100)return rows;
 }
}
export {projectActive as effectiveActiveSnapshot};
export async function readHistory(central,{scenarioId}){
 request(scenarioId);const rows=[];
 for(let offset=0;;offset+=100){const page=await central.fetchJson(`/atlas_reforecast_revisions?scenario_id=eq.${scenarioId}&select=*&order=revision.desc&limit=100&offset=${offset}`);if(!Array.isArray(page))throw Error('History is unavailable.');rows.push(...page);if(page.length<100)return rows;}
}
