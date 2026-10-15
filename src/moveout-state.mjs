// Community scope is resolved by the existing authenticated Worker boundary.
const roles = new Set(['admin','centra','executive','regional','community_manager']);
export const collections = ['moveOutCases','inspections','morfRecords'];
const fail = (message,status=400) => Object.assign(new Error(message),{status});
export async function readBoundedJson(request, limit=16*1024*1024) {
  const reader=request.body?.getReader(); if(!reader)throw fail('Request body required.');
  const chunks=[]; let size=0;
  try { for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw fail('Save exceeds the request limit; local evidence is retained.',413);}chunks.push(value);} }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw fail('Invalid JSON.');}
}
export async function photoHash(data) {
  if(typeof data!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(data)||data.length>14*1024*1024)throw fail('Use a PNG, JPEG or WebP original smaller than 10 MiB.',413);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function validateState(payload,community) {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw fail('A community case state is required.');
  const names=new Set([community.display_name,community.canonical_name,community.source_identifier,community.requestedName].filter(Boolean));
  for(const key of collections){
    if(!Array.isArray(payload[key])||payload[key].length>10000)throw fail('Invalid case collection.');
    const ids=new Set();for(const row of payload[key]){
      if(!row||typeof row.id!=='string'||!row.id||row.id.length>200||ids.has(row.id)||!names.has(row.propertyName))throw fail('Every record must have a unique ID and belong to the authorized community.',403);
      ids.add(row.id);
    }
  }
  if(Object.keys(payload).some(key=>!collections.includes(key)))throw fail('Unsupported case collection.');
  const refs=new Set();
  function walk(value){if(!value||typeof value!=='object')return;for(const [key,v]of Object.entries(value)){
    if((key==='dataUrl'||key==='thumbnail')&&typeof v==='string'&&v.startsWith('data:'))throw fail('Upload photo evidence before saving its reference.');
    if(['photoStorageKey','thumbnailStorageKey'].includes(key)&&v){const m=String(v).match(/^central:([0-9a-f-]{36}):([0-9a-f]{64})$/);if(!m||m[1]!==community.community_id)throw fail('Photo reference belongs to another community or is not durable.',403);refs.add(m[2]);}else walk(v);
  }}walk(payload);return [...refs];
}
export async function handleMoveOutState(request,env,api) {
  const reply=(data,status=200)=>api.apiResponse(data,{status});
  try {
    if(request.method!=='POST')throw fail('Use POST.',405);
    const access=await api.requireAtlasAccessUser(request,env,roles),body=await readBoundedJson(request);
    const community=await api.community(access,body),cid=community.community_id;
    const db=(route,options={})=>api.supabaseRequest(access.config,route,{service:true,...options});
    if(body.action==='read'){
      const rows=await db(`/rest/v1/atlas_moveout_states?community_id=eq.${cid}&select=version,payload,updated_at`);
      return reply({ok:true,communityId:cid,...(rows?.[0]||{version:0,payload:null})});
    }
    if(body.action==='photo-put'){
      const hash=await photoHash(body.dataUrl);
      await db('/rest/v1/atlas_moveout_photos?on_conflict=community_id,content_hash',{method:'POST',prefer:'resolution=ignore-duplicates',body:{community_id:cid,content_hash:hash,data_url:body.dataUrl,created_by:access.user.id}});
      return reply({ok:true,key:`central:${cid}:${hash}`});
    }
    if(body.action==='photo-get'){
      if(!/^[a-f0-9]{64}$/.test(body.hash||''))throw fail('Invalid photo reference.');
      const rows=await db(`/rest/v1/atlas_moveout_photos?community_id=eq.${cid}&content_hash=eq.${body.hash}&select=data_url&limit=1`);
      if(!rows?.[0])throw fail('Original photo not found.',404);return reply({ok:true,dataUrl:rows[0].data_url});
    }
    if(body.action==='save'){
      if(!Number.isInteger(body.expectedVersion)||body.expectedVersion<0||!/^[-a-f0-9]{36}$/.test(body.requestId||''))throw fail('Version and request identity are required.');
      const refs=validateState(body.payload,community);
      const result=await db('/rest/v1/rpc/atlas_save_moveout_state',{method:'POST',body:{p_community_id:cid,p_expected_version:body.expectedVersion,p_request_id:body.requestId,p_actor_id:access.user.id,p_payload:body.payload,p_photo_hashes:refs}});
      return reply({ok:true,communityId:cid,...result});
    }
    throw fail('Unknown case action.');
  } catch(error){const conflict=/version conflict|request identity conflict/i.test(error.message);return reply({ok:false,error:error.message},conflict?409:error.status||500);}
}
