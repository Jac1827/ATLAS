const clone=structuredClone,canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function strRegistryExtensionIssues(parent,registry,mappings){
 const issues=[],add=message=>issues.push({code:'saved_str_registry_extension',severity:'blocking',message});
 if(!parent?.version||!registry?.version||!Array.isArray(parent.accounts)||!Array.isArray(registry.accounts)){add('Read both immutable parent and STR registry versions.');return issues;}
 const inherited=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['version','contentHash','accounts','reason','effectiveDate','strExtensionParent'].includes(key)));if(!equal(inherited(parent),inherited(registry)))add('An STR extension must preserve all inherited registry semantics, including utility relationships.');
 if(!equal(parent.relationships||[],registry.relationships||[]))add('An STR registry extension must retain every inherited utility relationship unchanged.');
 if(!equal(parent.driverMappings||{},registry.driverMappings||{}))add('An STR registry extension must retain every parent driver mapping unchanged.');
 const byCode=new Map();for(const account of registry.accounts){if(byCode.has(account.accountCode))add('Every extended canonical GL must occur once.');byCode.set(account.accountCode,account);}
 for(const account of parent.accounts)if(!equal(account,byCode.get(account.accountCode)))add('An STR registry extension cannot alter or remove parent GL '+account.accountCode+'.');
 const parentCodes=new Set(parent.accounts.map(row=>row.accountCode)),added=registry.accounts.filter(row=>!parentCodes.has(row.accountCode));
 if(parent.version===registry.version&&added.length)add('Added STR accounts require a new immutable registry version.');
 if(mappings)for(const account of added)if(!mappings.some(row=>row.accountCode===account.accountCode&&row.confirmed===true&&row.parentDisposition==='no_parent_publication_row'))add('New canonical GL '+account.accountCode+' requires an explicit saved-source mapping and absent-parent review.');
 return issues;
}
export function prepareStrRegistryExtension(parent,rows,{reason,effectiveDate,actor,source,parentPublicationId}={}){
 if(!parent?.version||String(reason||'').trim().length<3||!actor||!/^20\d{2}-\d{2}-\d{2}$/.test(effectiveDate||''))throw Error('Read the immutable parent registry and record this extension’s reviewer, reason and effective date.');
 if(!Array.isArray(rows)||!rows.length)throw Error('Add at least one explicitly reviewed new canonical account.');
 const codes=new Set(parent.accounts.map(row=>row.accountCode)),accounts=clone(parent.accounts);
 for(const row of rows){
  if(!row.confirmed||!row.accountCode?.trim()||codes.has(row.accountCode)||!row.name?.trim()||!row.category?.trim()||!['income','contra_income','expense','capital','debt','below_noi'].includes(row.nature)||!['above_noi','below_noi'].includes(row.placement)||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(row.effectiveFrom||'')||String(row.reason||'').trim().length<3)throw Error('Each prospective account requires a unique canonical GL, reviewed name, category, nature, placement, month, source relationship and reason.');
  if(['capital','debt','below_noi'].includes(row.nature)&&row.placement!=='below_noi')throw Error('Capital, debt and below-NOI accounts remain below the line.');
  const evidence=source.lineEvidence.find(item=>item.line.id===row.sourceLineId);if(!evidence)throw Error('Bind each new account to one retained saved programme source line.');
  codes.add(row.accountCode);accounts.push({accountCode:row.accountCode,name:row.name,category:row.category,nature:row.nature,identifier:['debt','below_noi'].includes(row.nature)?'expense':row.nature,placement:row.placement,effectiveFrom:row.effectiveFrom,sourceEvidence:{sourceHash:source.sourceHash,sourceLineId:row.sourceLineId,sourceGL:evidence.line.gl,sourceName:evidence.line.name||'',sourcePath:'/state/lines/'+evidence.sourceLineIndex,reviewedBy:actor,reason:row.reason.trim()}});
 }
 const {version,contentHash,...payload}=clone(parent);return {...payload,accounts,driverMappings:clone(parent.driverMappings||{}),reason:reason.trim(),effectiveDate,strExtensionParent:{publicationId:parentPublicationId,registryVersion:version,sourceHash:source.sourceHash,programmeId:source.programmeId}};
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actorOf=central=>central.getSession?.()?.user?.id;
function checkActor(central,actor){if(!actor||actorOf(central)!==actor)throw Error('The signed-in account changed. Reopen STR registry review.');}
async function call(central,name,args){const actor=actorOf(central);checkActor(central,actor);await central.refreshSession?.();checkActor(central,actor);const value=await central.fetchJson('/rpc/'+name,{method:'POST',body:JSON.stringify(args)});checkActor(central,actor);return Array.isArray(value)?value[0]:value;}
export async function readStrMappingContext(central,{communityId,parentPublicationId}){if(!UUID.test(communityId)||!UUID.test(parentPublicationId))throw Error('Choose the exact authorized Conventional publication.');const result=await call(central,'atlas_read_reforecast_str_mapping_context',{p_community_id:communityId,p_parent_publication_id:parentPublicationId});if(!result?.parentRegistry?.version||!Array.isArray(result.workbookAccountEvidence))throw Error('Read the exact Conventional registry and retained source account labels before mapping STR.');return result;}
export async function saveStrRegistryExtension(central,request){
 const actor=actorOf(central),{communityId,parentPublicationId,requestId,payload}=request;checkActor(central,actor);if(![communityId,parentPublicationId,requestId,request.expectedVersionId].every(value=>UUID.test(value)))throw Error('Retain exact community, parent, registry revision and request identities before saving.');
 const read=async()=>{const rows=await central.fetchJson(`/atlas_reforecast_registries?request_id=eq.${requestId}&community_id=eq.${communityId}&select=*&limit=1`);checkActor(central,actor);if(!Array.isArray(rows)||rows.length>1)throw Error('The STR registry receipt is unavailable.');if(!rows.length)return null;const row=rows[0];if(!UUID.test(row.version_id)||row.previous_version_id!==payload.strExtensionParent?.registryVersion||row.community_id!==communityId||row.request_id!==requestId||row.created_by!==actor||!equal(row.payload,payload)||payload.strExtensionParent?.publicationId!==parentPublicationId)throw Error('The STR registry receipt differs from its exact retained parent and reviewed accounts.');return row;};
 const prior=await read();if(prior)return prior;let saved;
 try{saved=await call(central,'atlas_save_reforecast_str_registry_extension',{p_community_id:communityId,p_parent_publication_id:parentPublicationId,p_expected_version_id:request.expectedVersionId,p_request_id:requestId,p_payload:payload});}catch(error){let receipt;try{receipt=await read();}catch{throw Error('The STR registry response is uncertain and its receipt is unavailable. Keep this exact retained request before another write.');}if(receipt)return receipt;throw error;}
 const receipt=await read();if(!receipt||!equal(receipt,saved))throw Error('Exact STR registry readback is not verified. Check the retained request receipt.');return receipt;
}
