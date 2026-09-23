/* Canonical reforecast transport: no browser-local financial fallback. */
import {effectiveActiveSnapshot as projectActive} from './reforecast-active.mjs?v=5663085258d69c22';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const period=/^20\d{2}-(0[1-9]|1[0-2])$/;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const identity=central=>central.getSession?.()?.user?.id;
function scope(id){if(!uuid.test(id))throw Error('Explicitly select an authorized ATLAS community.');}
function request(id){if(!uuid.test(id))throw Error('A stable request ID is required to save safely.');}
function actorGuard(central,actor){if(central.getSession&&identity(central)!==actor)throw Error('The signed-in account changed. Reopen this workspace before continuing.');}
async function rpc(central,name,args){const actor=identity(central);await central.refreshSession?.();const data=await central.fetchJson('/rpc/'+name,{method:'POST',body:JSON.stringify(args)});actorGuard(central,actor);return ['atlas_save_reforecast_upload','atlas_save_reforecast_registry','atlas_publish_reforecast'].includes(name)&&Array.isArray(data)?data[0]:data;}
async function exactRecord(central,table,column,saved){
 if(!saved||!uuid.test(saved[column]))throw Error('Save was not confirmed. Your working edits are retained.');
 const rows=await central.fetchJson(`/${table}?${column}=eq.${saved[column]}&select=*&limit=1`);
 const norm=r=>r&&Object.fromEntries(Object.entries(r).map(([k,v])=>[k,['created_at','published_at'].includes(k)&&v?new Date(v).toISOString():v]));
 if(!rows?.[0]||!equal(norm(rows[0]),norm(saved)))throw Error('The committed record could not be verified. Your edits are retained; retry the same save.');return rows[0];
}
export async function saveUpload(central,{communityId,requestId,payload}){
 scope(communityId);request(requestId);const actor=identity(central);
 const saved=await rpc(central,'atlas_save_reforecast_upload',{p_community_id:communityId,p_request_id:requestId,p_payload:payload});
 const result=await exactRecord(central,'atlas_reforecast_uploads','upload_id',saved);actorGuard(central,actor);return result;
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
export async function saveScenario(central,{communityId,scenarioId,expectedRevision=0,requestId,action='save_draft',payload}){
 scope(communityId);request(requestId);if(!uuid.test(scenarioId))throw Error('Keep a stable scenario ID across saves and retries.');const actor=identity(central);
 const result=await rpc(central,'atlas_save_reforecast_scenario',{p_community_id:communityId,p_scenario_id:scenarioId,p_expected_revision:expectedRevision,p_request_id:requestId,p_action:action,p_payload:payload});
 await exactRecord(central,'atlas_reforecast_revisions','revision_id',result?.revision);actorGuard(central,actor);
 const heads=await central.fetchJson(`/atlas_reforecast_heads?scenario_id=eq.${scenarioId}&select=*&limit=1`);
 if(heads?.[0]?.revision_id!==result.revision.revision_id)throw Error('Your changes were saved but a newer revision already exists. Keep your edits and reload the current scenario.');
 actorGuard(central,actor);return result;
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
 if(!Array.isArray(result)||result.some(r=>!communityIds.includes(r.communityId)))throw Error('Invalid active-reforecast readback.');return result;
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
