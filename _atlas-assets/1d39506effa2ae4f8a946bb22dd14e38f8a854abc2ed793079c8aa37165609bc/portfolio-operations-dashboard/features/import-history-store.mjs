// Rollback evidence stays in the canonical record. Only the active view crosses to the UI.
export function projectHistory(state) {
  if (!state) return state;
  return {...state,batches:(state.batches||[]).map(batch=>{
    if (!batch?.beforeSnapshot) return batch;
    const {beforeSnapshot,...summary}=batch;
    return {...summary,beforeSnapshotRef:{batchId:batch.id,capturedAt:String(beforeSnapshot.capturedAt||'')}};
  })};
}
export function resolveSnapshot(batch,stored) {
  const ref=batch?.beforeSnapshotRef;
  if (!ref) return batch?.beforeSnapshot;
  const matches=(stored?.batches||[]).filter(item=>item?.id===ref.batchId);
  const snapshot=matches.length===1 ? matches[0].beforeSnapshot : null;
  if (ref.batchId!==batch.id || !snapshot || String(snapshot.capturedAt||'')!==ref.capturedAt) {
    throw new Error('Import rollback evidence changed or is unavailable. Reload before saving.');
  }
  return snapshot;
}
export function mergeHistory(incoming,stored) {
  return {...incoming,batches:(incoming.batches||[]).map(batch=>{
    if (!batch?.beforeSnapshotRef) return batch;
    const beforeSnapshot=resolveSnapshot(batch,stored);
    const {beforeSnapshotRef,...summary}=batch;
    return {...summary,beforeSnapshot};
  })};
}
export async function executeHistory({operation,dbName,storeName,key,value,batch}) {
  const db=await new Promise((resolve,reject)=>{
    const r=indexedDB.open(dbName,1);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(storeName))r.result.createObjectStore(storeName,{keyPath:'key'});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,operation==='save'?'readwrite':'readonly'),store=tx.objectStore(storeName);
      let result,error;
      const read=store.get(key);
      read.onsuccess=()=>{
        try {
          const stored=read.result?.value;
          if(operation==='load') result=projectHistory(stored);
          else if(operation==='snapshot') result=resolveSnapshot(batch,stored);
          else if(operation==='save') store.put({key,value:mergeHistory(value,stored),updatedAt:new Date().toISOString()});
          else throw new Error('Unknown import history operation');
        } catch(e){error=e;tx.abort();}
      };
      tx.oncomplete=()=>resolve(result);
      tx.onabort=tx.onerror=()=>reject(error||tx.error||read.error||new Error('Import history transaction failed'));
    });
  } finally {db.close();}
}
