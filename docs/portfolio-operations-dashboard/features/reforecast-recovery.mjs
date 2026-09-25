import {verifyImportReadback} from './reforecast-store.mjs?v=a31fb99b0826a753';
// Recovery copies are never calculation authority. Shared server receipts decide
// whether a write committed; browser records retain the exact request for retry.
const DB='atlas-reforecast-recovery-v1',STORE='recovery';
const identity=central=>central.getSession?.()?.user?.id;
function scope(central){const actor=identity(central);if(!actor)throw Error('Sign in before retaining forecast recovery.');return actor;}
async function access(central,mode,operation){
 const actor=scope(central);
 if(!globalThis.indexedDB)throw Error('Browser recovery storage is unavailable. Enable browser storage before importing.');
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
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
