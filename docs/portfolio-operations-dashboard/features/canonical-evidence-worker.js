importScripts('../vendor/jszip.min.js?v=acc7e41455a80765','../migration-archive.js?v=feebb32ebbdf48d8');
const pending=new Map();let sequence=0,controller=null;
const ask=(kind,payload={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});self.postMessage({kind,id,...payload});});
self.onmessage=async({data})=>{
  if(data.kind==='response'){const job=pending.get(data.id);if(job){pending.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data.value);}return;}
  if(data.kind==='cancel'){controller?.abort(new DOMException('Workspace changed','AbortError'));for(const job of pending.values())job.reject(controller.signal.reason);pending.clear();return;}
  if(data.kind!=='initialize'||controller)return;
  controller=new AbortController();const signal=controller.signal;
  const check=()=>{if(signal.aborted)throw signal.reason;};
  const progress=event=>self.postMessage({kind:'progress',event});
  let proofDatabase=null;
  try{
    const {initializeCanonicalArchive}=await import('./canonical-evidence-store.mjs');
    const {Sha256}=await import('./bounded-json-integrity.mjs?v=a4ea8821996c3b57');
    const source=data.options.source,archive=data.archive;
    if(data.options.mode!=='local-restore'&&archive.sha256!==source.archiveHash)throw Error('Canonical archive source fingerprint changed');
    if(data.options.mode==='proof'){
      const name='atlas_typed_restore_proof_'+crypto.randomUUID();data.options.dbName=name;
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore(data.options.storeName,{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      proofDatabase=name;
      try{await new Promise((resolve,reject)=>{const tx=db.transaction(data.options.storeName,'readwrite');tx.objectStore(data.options.storeName).add({key:'atlas_workspace_source_v2',value:{identity:source}});tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});}finally{db.close();}
    }
    let bytesData;
    if(archive.dataDocuments){
      const refs=archive.dataDocuments,parts=new Array(refs.length);let cursor=0,completed=0;
      const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
      await Promise.all(Array.from({length:Math.min(3,refs.length)},async()=>{
        while(cursor<refs.length){check();const index=cursor++,ref=refs[index];if(index<refs.length-1&&ref.length%4!==0)throw Error('Archive part boundaries are not valid base64 blocks');const text=await ask('part',{index});check();
          if(typeof text!=='string'||text.length!==ref.length||await digest(new TextEncoder().encode(text))!==ref.sha256)throw Error('Central archive part is missing or changed');
          const raw=atob(text),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);parts[index]=new Blob([bytes]);progress({phase:'downloading',completed:++completed,total:refs.length});
        }
      }));
      // Blob parts do not require a second full base64 string or expanded graph.
      let blob=new Blob(parts);parts.length=0;
      const hash=new Sha256(),reader=blob.stream().getReader();try{while(true){check();const next=await reader.read();if(next.done)break;hash.update(next.value);}}finally{reader.releaseLock();}
      if(blob.size!==archive.bytes||hash.digestHex()!==archive.sha256)throw Error('Canonical archive fingerprint mismatch');
      bytesData=new Uint8Array(await blob.arrayBuffer());blob=null;
    }else if(archive.dataBlob instanceof Blob){
      const reader=archive.dataBlob.stream().pipeThrough(new TextDecoderStream()).getReader(),parts=[];let carry='';
      try{while(true){check();const next=await reader.read();if(next.done)break;const text=carry+next.value,end=text.length-text.length%4;carry=text.slice(end);const raw=atob(text.slice(0,end)),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);parts.push(new Blob([bytes]));progress({phase:'preparing'});}}finally{reader.releaseLock();}
      if(carry)throw Error('Incomplete archive base64 data');
      archive.dataBlob=null;let blob=new Blob(parts);parts.length=0;bytesData=new Uint8Array(await blob.arrayBuffer());blob=null;
    }else{
      const raw=atob(archive.data);bytesData=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytesData[i]=raw.charCodeAt(i);
    }
    check();
    const result=await initializeCanonicalArchive({...data.options,archive:{...archive,data:undefined,bytesData},Zip:JSZip,api:AtlasMigrationArchive,signal,onProgress:progress,beforeCommit:async()=>{check();await ask('commit');check();}});
    if(proofDatabase){await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(proofDatabase);r.onsuccess=resolve;r.onerror=()=>reject(r.error);});proofDatabase=null;}
    self.postMessage({kind:'result',ok:true,value:{verified:result.verified,records:result.records,revision:result.revision,...(data.options.includeBundle?{bundle:result.bundle}:{}),...(data.options.mode==='proof'?{passed:true,archiveSha256:archive.sha256,recordsRestored:archive.recordCount+1,testedAt:new Date().toISOString()}: {})}});
  }catch(error){
    if(proofDatabase)await new Promise(resolve=>{const r=indexedDB.deleteDatabase(proofDatabase);r.onsuccess=r.onerror=resolve;});
    self.postMessage({kind:'result',ok:false,error:error?.message||String(error),name:error?.name});
  }
};
