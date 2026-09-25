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
export async function readForecastRecovery(central,id){return await access(central,'readonly',(store,actor)=>store.get(actor+':'+id))||null;}
export async function listForecastRecovery(central){const actor=scope(central),rows=await access(central,'readonly',store=>store.getAll());return rows.filter(row=>row.actor===actor&&!['workbook-evidence','import-complete'].includes(row.kind)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
export async function removeForecastRecovery(central,id){await access(central,'readwrite',(store,actor)=>store.delete(actor+':'+id));}
