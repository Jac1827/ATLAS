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
 function retain(name,value){if(!current())throw Error('Signed-in user changed.');storage.setItem(key(name),JSON.stringify(value));records.set(name,value);}
 function record(name){if(!records.has(name)){let value;try{value=JSON.parse(storage.getItem(key(name))||'null');}catch{}records.set(name,value||{version:null,base:null,pending:null});}return records.get(name);}
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
   status(name,'Checking shared case version');let r=record(name),local=pick(read(),name);
   const remote=await request({action:'read',communityName:name});if(!current())break;
   if(r.version===null){
    if(remote.payload&&collections.some(k=>local[k].length)&&stable(local)!==stable(remote.payload))throw Error('Existing local and shared records differ. Export local recovery before reconciling; neither copy was replaced.');
    r={version:remote.version,base:remote.payload||Object.fromEntries(collections.map(k=>[k,[]])),pending:null};retain(name,r);
    if(remote.payload&&!collections.some(k=>local[k].length)){
     // Never replace edits made while the initial request was in flight.
     if(stable(pick(read(),name))!==stable(local))throw Error('Local edits changed during loading. Retry synchronization.');
     write(replace(read(),name,remote.payload));local=pick(read(),name);
    }
   }
   if(r.pending){
    status(name,'Retrying retained save');const result=await request({...r.pending,action:'save',communityName:name});if(!current())break;
    r={version:result.version,base:r.pending.payload,pending:null};retain(name,r);
   }
   local=pick(read(),name);
   // A new remote revision is applied only if local state still equals the acknowledged base.
   if(remote.version>r.version){
    if(stable(local)!==stable(r.base))throw Error('Version conflict. Local recovery is retained; review the other session before saving.');
    write(replace(read(),name,remote.payload));r={version:remote.version,base:remote.payload,pending:null};retain(name,r);local=pick(read(),name);
   }
   if(stable(local)!==stable(r.base)){
    status(name,'Uploading originals and saving shared cases');const captured=clone(local),payload=await durable(local,name);if(!current())break;
    if(stable(payload)===stable(r.base)){
     if(stable(pick(read(),name))===stable(captured))write(replace(read(),name,payload));
     status(name,`Shared version ${r.version} verified`);continue;
    }
    const pending={expectedVersion:r.version,requestId:crypto.randomUUID(),payload};r={...r,pending};retain(name,r);
    const result=await request({...pending,action:'save',communityName:name});if(!current())break;
    r={version:result.version,base:payload,pending:null};retain(name,r);
    if(stable(pick(read(),name))===stable(captured))write(replace(read(),name,payload));
   }
   status(name,stable(pick(read(),name))===stable(r.base)?`Shared version ${r.version} verified`:'Local edits pending; synchronize again');
  }catch(error){status(name,'NOT SYNCHRONIZED — '+error.message);}}})().finally(()=>{busy=null;});return busy;
 }
 return {synchronize,stop(){stopped=true;},status:()=>[...statuses.values()].join(' · '),async flush(names){await synchronize(names);if(names.some(name=>{const r=record(name);return r.pending||r.version===null||stable(pick(read(),name))!==stable(r.base);}))throw Error('Shared case save is not verified. Resolve synchronization before delivery.');}};
}
