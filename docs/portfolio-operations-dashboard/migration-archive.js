/* Lossless transport for the migration bundle and its retained import evidence. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AtlasMigrationArchive=api;})(typeof window!=='undefined'?window:globalThis,function(){
  const TYPE='atlas_migration_archive_v1';
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  async function encode(v){
    if(v instanceof Blob){const bytes=new Uint8Array(await v.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return {__atlasMigrationBlob:true,type:v.type,base64:btoa(s)};}
    if(Array.isArray(v))return Promise.all(v.map(encode));
    if(v&&typeof v==='object'){const o={};for(const [k,x]of Object.entries(v))o[k]=await encode(x);return o;}return v;
  }
  function decode(v){
    if(v?.__atlasMigrationBlob===true){const s=atob(v.base64);return new Blob([Uint8Array.from(s,c=>c.charCodeAt(0))],{type:v.type});}
    if(Array.isArray(v))return v.map(decode);
    if(v&&typeof v==='object'){const o={};for(const[k,x]of Object.entries(v))o[k]=decode(x);return o;}return v;
  }
  async function pack(bundle,records,Zip){
    const zip=new Zip(),manifest={format:TYPE,entries:[]};
    const add=async(name,value)=>{const text=JSON.stringify(await encode(value));const bytes=new TextEncoder().encode(text);manifest.entries.push({name,sha256:await digest(bytes),bytes:bytes.length});zip.file(name,bytes);};
    await add('bundle.json',bundle);
    for(let i=0;i<records.length;i++)await add(`record-${i}.json`,records[i]);
    zip.file('manifest.json',JSON.stringify(manifest));
    const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}});
    let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return {bundleType:TYPE,encoding:'zip+base64',sha256:await digest(bytes),bytes:bytes.length,recordCount:records.length,data:btoa(s)};
  }
  async function unpack(archive,Zip){
    if(archive?.bundleType!==TYPE)return {bundle:archive,records:[]};
    const raw=atob(archive.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    if(bytes.length!==archive.bytes||await digest(bytes)!==archive.sha256)throw Error('Migration archive fingerprint mismatch');
    const zip=await Zip.loadAsync(bytes),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
    if(manifest.format!==TYPE||manifest.entries.length!==archive.recordCount+1)throw Error('Migration manifest is incomplete');
    const values=[];
    for(const entry of manifest.entries){const b=await zip.file(entry.name).async('uint8array');if(b.length!==entry.bytes||await digest(b)!==entry.sha256)throw Error('Migration record fingerprint mismatch');values.push(decode(JSON.parse(new TextDecoder().decode(b))));}
    return {bundle:values[0],records:values.slice(1),manifest};
  }
  async function verifyRestore(archive,Zip){
    const restored=await unpack(archive,Zip),name='atlas_migration_rollback_test_'+crypto.randomUUID();
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try {
      const values=[restored.bundle,...restored.records];
      await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),s=tx.objectStore('records');values.forEach((v,i)=>s.put(v,i));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
      for(let i=0;i<values.length;i++){
        const value=await new Promise((resolve,reject)=>{const r=db.transaction('records').objectStore('records').get(i);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        const bytes=new TextEncoder().encode(JSON.stringify(await encode(value)));
        if(await digest(bytes)!==restored.manifest.entries[i].sha256)throw Error('Rollback storage readback differs from its source');
      }
      return {passed:true,archiveSha256:archive.sha256,recordsRestored:values.length,testedAt:new Date().toISOString()};
    } finally {db.close();indexedDB.deleteDatabase(name);}
  }
  async function publish(archive,client,chunkSize=524288,{signal,isCurrent=()=>true}={}) {
    const check=()=>{if(signal?.aborted||!isCurrent())throw new DOMException('Workspace changed during archive publication','AbortError');};
    check();
    if(archive?.bundleType!==TYPE||!archive.data||archive.data.length<=chunkSize)return archive;
    const references=[];
    for(let offset=0;offset<archive.data.length;offset+=chunkSize){
      check();
      const data=archive.data.slice(offset,offset+chunkSize),sha256=await digest(new TextEncoder().encode(data));
      const documentKey='atlas_migration_part_v1:'+sha256;
      check();
      let existing=await client.readDocument(documentKey,{signal});
      check();
      if(!existing){
        await client.saveDocument({documentKey,moduleKey:'dashboard',payload:{documentType:'atlas_migration_part_v1',sha256,data},expectedVersion:null,sourceModule:'atlas_dashboard',sourceHash:sha256,metadata:{purpose:'Verified migration archive part'}});
        check();
        existing=await client.readDocument(documentKey,{signal});
        check();
      }
      if(existing?.payload?.data!==data||existing?.payload?.sha256!==sha256)throw Error('Central migration part readback mismatch');
      references.push({documentKey,sha256,length:data.length});
    }
    const {data,...manifest}=archive;
    return {...manifest,dataDocuments:references};
  }
  async function hydrate(archive,client,{concurrency=3,signal}={}){
    if(!archive?.dataDocuments)return archive;
    const refs=archive.dataDocuments,pieces=new Array(refs.length);
    const finish=globalThis.AtlasPerformance?.start('archive-part-hydration',{parts:refs.length,bytes:archive.bytes});
    let cursor=0,failure=null;
    const check=()=>{if(signal?.aborted)throw signal.reason||new DOMException('Archive hydration cancelled','AbortError');};
    const worker=async()=>{
      while(!failure&&cursor<refs.length){
        check();
        const index=cursor++,ref=refs[index];
        try {
          const row=await client.readDocument(ref.documentKey),data=row?.payload?.data;
          check();
          if(typeof data!=='string'||data.length!==ref.length||await digest(new TextEncoder().encode(data))!==ref.sha256)throw Error('Central migration part is missing or changed');
          pieces[index]=data;
        }catch(error){failure=error;throw error;}
      }
    };
    try {
      const count=Math.min(refs.length,Math.max(1,Math.min(4,Math.floor(Number(concurrency)||3))));
      const results=await Promise.allSettled(Array.from({length:count},worker));
      const rejected=results.find(result=>result.status==='rejected');
      if(rejected)throw rejected.reason;
      check();
      return {...archive,data:pieces.join('')};
    } finally {pieces.length=0;finish?.({failed:!!failure});}
  }
  return {TYPE,pack,unpack,verifyRestore,publish,hydrate};
});
