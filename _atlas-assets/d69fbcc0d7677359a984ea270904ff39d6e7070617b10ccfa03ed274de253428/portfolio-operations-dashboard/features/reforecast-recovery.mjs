import {verifyImportReadback} from './reforecast-store.mjs?v=b59fd4df88ff8fe3';
// Recovery copies are never calculation authority. Shared server receipts decide
// whether a write committed; browser records retain the exact request for retry.
const DB='atlas-reforecast-recovery-v1',STORE='recovery';
const identity=central=>central.getSession?.()?.user?.id;
function scope(central){const actor=identity(central);if(!actor)throw Error('Sign in before retaining forecast recovery.');return actor;}
async function access(central,mode,operation,{existingOnly=false}={}){
 const actor=scope(central);
 if(!globalThis.indexedDB)throw Error('Browser recovery storage is unavailable. Enable browser storage before importing.');
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(existingOnly)r.transaction.abort();else r.result.createObjectStore(STORE,{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{return await new Promise((resolve,reject)=>{if(identity(central)!==actor){reject(Error('Your signed-in account changed.'));return;}const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);let value;const req=operation(store,actor);if(req)req.onsuccess=()=>{value=req.result;};tx.oncomplete=()=>identity(central)===actor?resolve(value):reject(Error('Your signed-in account changed.'));tx.onerror=tx.onabort=()=>reject(tx.error||Error('Forecast recovery could not be retained.'));});}
 finally{db.close();}
}
export async function saveForecastRecovery(central,id,value){
 if(!id||!value?.kind)throw Error('A recovery identity and kind are required.');
 await access(central,'readwrite',(store,actor)=>store.put({...structuredClone(value),key:actor+':'+id,id,actor,updatedAt:new Date().toISOString()}));
 return id;
}
export async function saveForecastRecoveryEntries(central,entries){
 if(!Array.isArray(entries)||!entries.length||entries.some(row=>!row.id||!row.value?.kind||row.ifAbsent&&row.value.kind!=='workbook-evidence')||new Set(entries.map(row=>row.id)).size!==entries.length)throw Error('Distinct recovery identities and kinds are required.');
 // Immutable workbook evidence is only cloned by IndexedDB if its shared copy
 // is missing; editing a field must not rewrite the complete workbook each time.
 const retained=entries.map(row=>row.ifAbsent?{...row}:structuredClone(row)),updatedAt=new Date().toISOString();
 await access(central,'readwrite',(store,actor)=>{for(const {id,value,ifAbsent} of retained){const put=()=>store.put({...value,key:actor+':'+id,id,actor,updatedAt});if(ifAbsent){const read=store.get(actor+':'+id);read.onsuccess=()=>{if(!read.result)put();};}else put();}});
}
export async function readForecastRecovery(central,id){return await access(central,'readonly',(store,actor)=>store.get(actor+':'+id))||null;}
export async function listForecastRecovery(central){const actor=scope(central),rows=await access(central,'readonly',store=>store.getAll());return rows.filter(row=>row.actor===actor&&row.kind!=='workbook-evidence').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
export async function removeForecastRecovery(central,id){await access(central,'readwrite',(store,actor)=>store.delete(actor+':'+id));}

// This is a local diagnostic copy, never a receipt, import, or calculation input.
// Compare the dialog's complete records with one coherent read-only snapshot.
export async function readForecastDraftBackup(central,{selected,linkedEdit=null,guard}){
 if(typeof guard!=='function')throw Error('Reopen recovery before downloading a save backup.');
 guard();const actor=scope(central),request=selected?.kind==='draft-write'?selected.request:null;
 const communityId=request?.communityId||selected?.communityId,scenarioId=request?.scenarioId||selected?.scenarioId;
 if(!['draft-write','draft-edit'].includes(selected?.kind)||!communityId||!scenarioId||selected.kind==='draft-write'&&(!request?.payload||!request.requestId)||selected.kind==='draft-edit'&&!selected.payload||selected.communityId&&selected.communityId!==communityId)throw Error('This recovery does not identify an exact working draft.');
 const expected=[selected];
 if(selected.kind==='draft-write'&&selected.editId){
  if(linkedEdit?.id!==selected.editId||linkedEdit.kind!=='draft-edit'||linkedEdit.communityId!==communityId||linkedEdit.scenarioId!==scenarioId)throw Error('The linked working edit is missing or changed. Reopen recovery.');
  expected.push(linkedEdit);
 }else if(linkedEdit)throw Error('The linked working edit does not belong to this save.');
 const exactJson=value=>{const seen=new Set(),inspect=item=>{
  if(item===undefined||['function','symbol','bigint'].includes(typeof item)||typeof item==='number'&&!Number.isFinite(item)||item&&typeof item==='object'&&!Array.isArray(item)&&Object.getPrototypeOf(item)!==Object.prototype)throw Error('This recovery contains a value that cannot be preserved in a JSON backup.');
  if(!item||typeof item!=='object'||seen.has(item))return;seen.add(item);
  if(Array.isArray(item)&&Object.keys(item).some((key,index)=>key!==String(index))||Array.isArray(item)&&Object.keys(item).length!==item.length)throw Error('This recovery contains a value that cannot be preserved in a JSON backup.');
  for(const [key,child]of Object.entries(item)){if(/^(accesstoken|refreshtoken|authorization|apikey|servicerolekey|password|cookie)$/i.test(key.replace(/[_-]/g,'')))throw Error('This recovery contains authentication fields and cannot be downloaded.');inspect(child);}
 };inspect(value);return JSON.stringify(value);};
 const snapshots=expected.map(row=>{if(row.actor!==actor||!row.id||row.key!==actor+':'+row.id)throw Error('This recovery belongs to another signed-in account.');return exactJson(row);});
 const records=[];await access(central,'readonly',(store,currentActor)=>{
  for(const [index,row]of expected.entries()){const read=store.get(currentActor+':'+row.id);read.onsuccess=()=>{records[index]=read.result;};}
 },{existingOnly:true});guard();
 if(scope(central)!==actor||expected.some((_row,index)=>!records[index]||exactJson(records[index])!==snapshots[index]))throw Error('The retained save or linked edit changed. Reopen recovery before downloading.');
 return {format:'atlas.reforecast-draft-recovery-backup',formatVersion:1,exportedAt:new Date().toISOString(),authority:'browser_recovery_only',actorId:actor,communityId,scenarioId,requestId:request?.requestId||null,expectedRevision:request?.expectedRevision??selected.expectedRevision??null,editVersion:selected.editVersion||null,linkedEdit:linkedEdit?{id:linkedEdit.id,editVersion:linkedEdit.editVersion||null,requestEditVersion:selected.editVersion||null,changedSinceRequest:Boolean(selected.editVersion&&linkedEdit.editVersion&&selected.editVersion!==linkedEdit.editVersion)}:null,records};
}

// Delete an import's linked recovery records in one transaction, only after its
// exact committed cells have been verified. Another review of the same file can
// still own the shared workbook bytes; actor namespaces never share ownership.
export async function completeForecastImportRecovery(central,{recoveryId,result}){
 if(!recoveryId)throw Error('Keep the import recovery identity until exact readback is verified.');
 await access(central,'readwrite',(store,actor)=>{
  const scan=store.getAll();scan.onsuccess=()=>{
   try{
    if(identity(central)!==actor)throw Error('The signed-in account changed.');
    const rows=scan.result.filter(row=>row.actor===actor),pending=rows.find(row=>row.id===recoveryId);
    if(!pending)return;
    if(!['import-write','import-complete'].includes(pending.kind)||!pending.request)throw Error('A retained import request is required before releasing its recovery copy.');
    verifyImportReadback(result,pending.request);
    const review=rows.find(row=>row.id===pending.reviewId&&row.kind==='import-review'),byId=new Map(rows.map(row=>[row.id,row]));
    // Legacy records cannot prove whether this review is the saved snapshot or
    // newer edits. Keep receipt-only ownership so it cannot become a fresh write.
    if(review&&(!pending.reviewVersion||!review.reviewVersion)){
     store.put({...pending,kind:'import-complete',reviewOwnership:'unproven',verifiedRevisionId:result.revision.revision_id,updatedAt:new Date().toISOString()});return;
    }
    const evidenceId=row=>{
     if(row.evidenceId)return row.evidenceId;
     if(row.reviewId&&byId.get(row.reviewId)?.evidenceId)return byId.get(row.reviewId).evidenceId;
     const hashes=[...new Set((row.request?.expectedLines||[]).map(line=>line.sourceHash).filter(Boolean))];
     return hashes.length===1&&row.request?.parserVersion?'workbook:'+hashes[0]+':'+row.request.parserVersion:null;
    };
    const remove=new Set([pending.id]);
    if(review&&pending.reviewVersion&&review.reviewVersion===pending.reviewVersion&&!rows.some(row=>row.id!==pending.id&&row.reviewId===review.id))remove.add(review.id);
    const evidenceIds=new Set([evidenceId(pending),review?.evidenceId].filter(Boolean)),remaining=rows.filter(row=>!remove.has(row.id)),sourceHashes=[...new Set((pending.request.expectedLines||[]).map(line=>line.sourceHash).filter(Boolean))],sourceHash=result.receipt.sourceHash||(sourceHashes.length===1?sourceHashes[0]:null);
    for(const id of evidenceIds){const evidence=byId.get(id);if(sourceHash&&evidence?.kind==='workbook-evidence'&&evidence.evidence?.source?.sha256===sourceHash&&!remaining.some(row=>row.id!==id&&evidenceId(row)===id))remove.add(id);}
    for(const id of remove)store.delete(actor+':'+id);
   }catch{store.transaction.abort();}
  };
 });
}

const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
// Original-budget intake only stages a review. Its local copy can be released
// after the locked version and central verification receipt agree exactly.
export async function completeOriginalBudgetRecovery(central,{recovery,payload,result}){
 const actor=scope(central),budget=result?.budget,receipt=result?.receipt;
 if(!recovery?.reviewId||!recovery.reviewVersion||!recovery.evidenceId||recovery.communityId!==payload?.communityId||recovery.uploadId!==payload.governance?.uploadId||recovery.sourceHash!==payload.sourceHash||recovery.mappingVersion!==payload.governance?.mapping?.version||
  result?.status!=='readback_verified'||budget?.status!=='locked'||budget.community_id!==payload.communityId||budget.calendar_year!==payload.year||budget.version_id!==result.versionId||budget.content_hash!==result.contentHash||canonical(budget.payload)!==canonical(payload)||
  receipt?.status!=='readback_verified'||receipt.version_id!==budget.version_id||receipt.content_hash!==budget.content_hash||receipt.source_hash!==payload.sourceHash||receipt.mapping_version!==payload.mappingVersion||receipt.actor_id!==actor||!receipt.receipt_id||!receipt.created_at)throw Error('Keep the original-budget recovery copy until its exact locked source and verification receipt agree.');
 await access(central,'readwrite',(store,currentActor)=>{
  const scan=store.getAll();scan.onsuccess=()=>{
   try{
    if(identity(central)!==actor||currentActor!==actor)throw Error('The signed-in account changed.');
    const rows=scan.result.filter(row=>row.actor===actor),review=rows.find(row=>row.id===recovery.reviewId);
    if(!review)return;
    if(review.kind!=='import-review'||review.purpose!=='original_budget'||review.communityId!==recovery.communityId||review.uploadId!==recovery.uploadId||review.evidenceId!==recovery.evidenceId)throw Error('Original-budget recovery identity changed.');
    if(review.reviewVersion!==recovery.reviewVersion||rows.some(row=>row.reviewId===review.id))return;
    store.delete(actor+':'+review.id);
    const evidence=rows.find(row=>row.id===recovery.evidenceId),byId=new Map(rows.map(row=>[row.id,row]));
    if(evidence?.kind==='workbook-evidence'&&evidence.evidence?.source?.sha256===payload.sourceHash&&!rows.some(row=>row.id!==review.id&&row.id!==evidence.id&&(row.evidenceId===evidence.id||row.reviewId&&byId.get(row.reviewId)?.evidenceId===evidence.id)))store.delete(actor+':'+evidence.id);
   }catch{store.transaction.abort();}
  };
 });
}

// Each submitted request owns a separate outbox slot. Acquiring a scenario's
// slot atomically prevents another tab from replacing an uncertain request.
export async function retainForecastDraftWrite(central,{request,editId,editVersion,replaceAbsentRequestId}){
 let id='draft-write:'+request.requestId,failure;
 try{await access(central,'readwrite',(store,actor)=>{const scan=store.getAll();scan.onsuccess=()=>{try{
  const pending=scan.result.filter(row=>row.actor===actor&&row.kind==='draft-write'&&row.request?.communityId===request.communityId&&row.request?.scenarioId===request.scenarioId);
  const previous=editId&&pending.find(row=>row.request.requestId===replaceAbsentRequestId&&row.editId===editId);
  if(pending.some(row=>row.request.requestId!==request.requestId&&row!==previous))throw Error('Another save for this forecast is awaiting readback. Recover and verify that retained request before saving again.');
  if(pending.some(row=>row!==previous&&canonical(row.request)!==canonical(request)))throw Error('The retained save request changed. Recover its exact receipt before continuing.');
  const existing=pending.find(row=>row!==previous);if(existing){id=existing.id;return;}
  if(previous)store.delete(actor+':'+previous.id);
  store.put({key:actor+':'+id,id,actor,kind:'draft-write',communityId:request.communityId,name:request.payload.name,request:structuredClone(request),editId,editVersion,updatedAt:new Date().toISOString()});
 }catch(error){failure=error;store.transaction.abort();}};});}catch(error){throw failure||error;}
 return id;
}
export async function completeForecastDraftRecovery(central,{recoveryId,result}){
 let failure;
 try{await access(central,'readwrite',(store,actor)=>{const scan=store.getAll();scan.onsuccess=()=>{try{
  const rows=scan.result.filter(row=>row.actor===actor),pending=rows.find(row=>row.id===recoveryId);if(!pending)return;
  const request=pending.request,revision=result?.revision,publication=result?.publication;
  if(pending.kind!=='draft-write'||!request||result?.head?.community_id!==request.communityId||result.head.scenario_id!==request.scenarioId||revision?.community_id!==request.communityId||revision.scenario_id!==request.scenarioId||!revision.revision_id||!(revision.request_id===request.requestId||['approve_lock','vp_approve'].includes(request.action)&&publication?.request_id===request.requestId))throw Error('Keep the pending save until its exact request and revision are verified.');
  store.delete(actor+':'+pending.id);
  const edit=rows.find(row=>row.id===pending.editId);
  if(edit?.kind==='draft-edit'&&pending.editVersion&&edit.editVersion===pending.editVersion&&edit.scenarioId===request.scenarioId&&edit.communityId===request.communityId)store.delete(actor+':'+edit.id);
 }catch(error){failure=error;store.transaction.abort();}};});}catch(error){throw failure||error;}
}
