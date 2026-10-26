export function createMetadataStorage({indexedDB,legacyStorage}) {
    let database;
    const open = () => database || (database = new Promise((resolve, reject) => {
      const request = indexedDB.open("atlas_moveout_sync_v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("metadata");
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = null; }; resolve(request.result); };
      request.onerror = () => { database = null; reject(request.error); };
    }));
    const transaction = async (mode, operation) => {
      const db = await open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("metadata", mode), request = operation(tx.objectStore("metadata"));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () => reject(tx.error || request.error || new Error("Shared recovery metadata could not save."));
      });
    };
    return {
      getItem: async key => {
        const value = await transaction("readonly", store => store.get(key));
        if (value !== undefined) return value;
        // Preserve any outbox saved by the first release; new writes use IndexedDB.
        try { return legacyStorage.getItem(key); } catch { return null; }
      },
      setItem: (key, value) => transaction("readwrite", store => store.put(value, key))
    };
  }

// The browser is a recovery cache; acknowledged community versions are canonical.
export const collections=['moveOutCases','inspections','morfRecords'];
const clone=v=>structuredClone(v);
export function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';return JSON.stringify(value);}
export function pick(state,name){return Object.fromEntries(collections.map(k=>[k,(state[k]||[]).filter(row=>row.propertyName===name).sort((a,b)=>a.id.localeCompare(b.id))]));}
export function replace(state,name,payload){for(const key of collections)state[key]=[...(state[key]||[]).filter(row=>row.propertyName!==name),...(payload[key]||[]).map(row=>({...row,propertyName:name}))];return state;}
export function createMoveOutStore({request,read,write,photo,storage,actor,onStatus=()=>{}}){
 let busy=null,stopped=false;const records=new Map(),statuses=new Map();const owner=actor();
 const current=()=>!stopped&&actor()===owner;
 const key=name=>'atlas_moveout_sync_v1:'+owner+':'+encodeURIComponent(name);
 function status(name,message){statuses.set(name,message);onStatus([...statuses].map(([n,s])=>n+': '+s).join(' · '));}
 async function retain(name,value){if(!current())throw Error('Signed-in user changed.');await storage.setItem(key(name),JSON.stringify(value));if(!current())throw Error('Signed-in user changed.');records.set(name,value);}
 async function record(name){
  if(!records.has(name)){
   const saved=await storage.getItem(key(name));let value;
   try{value=JSON.parse(saved||'null');}catch{throw Error('Saved synchronization metadata is unreadable; retain local recovery for review.');}
   records.set(name,value||{version:null,base:null,pending:null});
  }return records.get(name);
 }

 async function durable(value,name){
  if(Array.isArray(value))return Promise.all(value.map(v=>durable(v,name)));
  if(!value||typeof value!=='object')return value;
  const out={};for(const [k,v]of Object.entries(value))out[k]=await durable(v,name);
  for(const [inline,ref]of [['dataUrl','photoStorageKey'],['thumbnail','thumbnailStorageKey']]){
   const localKey=value[ref],data=value[inline];
   if(localKey&&!String(localKey).startsWith('central:')||typeof data==='string'&&data.startsWith('data:image/')){
    const original=localKey?await photo(localKey):data;
    if(!current())throw Error('Signed-in user changed.');
    const saved=await request({action:'photo-put',communityName:name,dataUrl:original});
    out[ref]=saved.key;delete out[inline];
   }
  }return out;
 }
 async function synchronize(names){
  if(busy)return busy;
  busy=(async()=>{for(const name of names){if(!current())break;try{
   status(name,'Checking shared case version');let r=await record(name),local=pick(read(),name);
   const remote=await request({action:'read',communityName:name});if(!current())break;
   if(r.version===null){
    if(remote.payload&&collections.some(k=>local[k].length)&&stable(local)!==stable(remote.payload))throw Error('Existing local and shared records differ. Export local recovery before reconciling; neither copy was replaced.');
    r={version:remote.version,base:remote.payload||Object.fromEntries(collections.map(k=>[k,[]])),pending:null};
    if(remote.payload&&!collections.some(k=>local[k].length)){
     // Never replace edits made while the initial request was in flight.
     if(stable(pick(read(),name))!==stable(local))throw Error('Local edits changed during loading. Retry synchronization.');
     write(replace(read(),name,remote.payload));local=pick(read(),name);
    }
    await retain(name,r);
   }
   if(r.pending){
    status(name,'Retrying retained save');const result=await request({...r.pending,action:'save',communityName:name});if(!current())break;
    r={version:result.version,base:r.pending.payload,pending:null};await retain(name,r);
   }
   local=pick(read(),name);
   // A new remote revision is applied only if local state still equals the acknowledged base.
   if(remote.version>r.version){
    if(stable(local)!==stable(r.base))throw Error('Version conflict. Local recovery is retained; review the other session before saving.');
    write(replace(read(),name,remote.payload));r={version:remote.version,base:remote.payload,pending:null};await retain(name,r);local=pick(read(),name);
   }
   if(stable(local)!==stable(r.base)){
    status(name,'Uploading originals and saving shared cases');const captured=clone(local),payload=await durable(local,name);if(!current())break;
    if(stable(payload)===stable(r.base)){
     if(stable(pick(read(),name))===stable(captured))write(replace(read(),name,payload));
     status(name,`Shared version ${r.version} verified`);continue;
    }
    const pending={expectedVersion:r.version,requestId:crypto.randomUUID(),payload};r={...r,pending};await retain(name,r);
    const result=await request({...pending,action:'save',communityName:name});if(!current())break;
    r={version:result.version,base:payload,pending:null};await retain(name,r);
    if(stable(pick(read(),name))===stable(captured))write(replace(read(),name,payload));
   }
   status(name,stable(pick(read(),name))===stable(r.base)?`Shared version ${r.version} verified`:'Local edits pending; synchronize again');
  }catch(error){status(name,'NOT SYNCHRONIZED — '+error.message);}}})().finally(()=>{busy=null;});return busy;
 }
 return {synchronize,stop(){stopped=true;},status:()=>[...statuses.values()].join(' · '),async flush(names){await synchronize(names);if(!current())throw Error('Signed-in user changed.');if((await Promise.all(names.map(async name=>{const r=await record(name);return r.pending||r.version===null||stable(pick(read(),name))!==stable(r.base);}))).some(Boolean))throw Error('Shared case save is not verified. Resolve synchronization before delivery.');}};
}
