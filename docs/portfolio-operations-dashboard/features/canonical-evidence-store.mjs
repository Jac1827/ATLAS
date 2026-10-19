import {createJsonTokenSink} from './migration-token-stream.mjs';
import {historyNamespace,prepareStreamedInitialHistory} from './import-history-store.mjs?v=e310a5426db3487e';
import {stableJson} from './workspace-bootstrap.mjs?v=99b459d64e31f2cb';
import {Sha256,hashJson} from './bounded-json-integrity.mjs?v=a4ea8821996c3b57';

// An isolated staging namespace is invisible to normal history readers. Only a
// final native transaction activates the verified source, files, and history.
export async function initializeCanonicalArchive({archive,Zip,api,dbName,storeName,key,filePrefix,source,mode='canonical',signal,onProgress=()=>{},beforeCommit=async()=>{}}){
  const check=()=>{if(signal?.aborted)throw signal.reason||new DOMException('Archive initialization cancelled','AbortError');};
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbName);r.onupgradeneeded=()=>{r.transaction.abort();reject(Error('Canonical storage must already exist'));};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const prefix='__atlas_verified_archive_stage:'+crypto.randomUUID()+':',staged=[],destinations=new Set(),sinks=new Set(),fingerprints=new Map();
  const sourceKey='atlas_workspace_source_v2',receiptKey='atlas_import_archive_receipt_v2';
  const bindingIdentity=record=>{if(!record)return null;const {updatedAt,...envelope}=record;const {verifiedAt,...value}=envelope.value||{};return stableJson({...envelope,value});};
  const io=(mode,action)=>new Promise((resolve,reject)=>{const tx=db.transaction(storeName,mode);let request;try{request=action(tx.objectStore(storeName));}catch(error){tx.abort();reject(error);return;}tx.oncomplete=()=>resolve(request?.result);tx.onabort=tx.onerror=()=>reject(tx.error||request?.error||Error('Archive storage transaction failed'));});
  const fingerprint=async record=>{
    const blobs=[];
    const visit=async(value,path)=>{check();if(value instanceof Blob){const hash=new Sha256(),reader=value.stream().getReader();try{while(true){check();const next=await reader.read();if(next.done)break;hash.update(next.value);}}finally{reader.releaseLock();}blobs.push({path,type:value.type,size:value.size,sha256:hash.digestHex()});}else if(value instanceof Date)blobs.push({path,date:value.toISOString()});else if(value&&typeof value==='object')for(const [name,child]of Object.entries(value))await visit(child,path.concat(name));};
    await visit(record,[]);return hashJson({json:await hashJson(record),blobs});
  };
  const add=async record=>{check();if(!record?.key||destinations.has(record.key))throw Error('Duplicate retained archive record');destinations.add(record.key);const stageKey=prefix+staged.length;fingerprints.set(stageKey,await fingerprint(record));await io('readwrite',store=>store.add({key:stageKey,record}));staged.push(stageKey);};
  const newSink=()=>{const sink=createJsonTokenSink({signal});sinks.add(sink);return sink;};
  const finishSink=async sink=>{const result=await sink.finish();sinks.delete(sink);return result;};
  let original=null,history=null,historyMetadata=null,bundle=null,activated=false;
  const initialSnapshots=new Map();
  try{
    check();
    const expectedSource=await io('readonly',store=>store.get(sourceKey));
    if(stableJson(expectedSource?.value?.identity)!==stableJson(source))throw Error('The canonical source changed before archive initialization');
    if(!['canonical','local-restore','proof'].includes(mode)||mode!=='local-restore'&&archive.sha256!==source.archiveHash)throw Error('The requested archive does not match its verified source');
    if(await io('readonly',store=>store.getKey(key)))throw Error('This browser already has retained import history');
    const {zip,manifest}=await api.openArchive(archive,Zip);
    for(let recordIndex=0;recordIndex<manifest.entries.length;recordIndex++){
      check();const entry=manifest.entries[recordIndex];onProgress({phase:'verifying',completed:recordIndex,total:manifest.entries.length});
      if(entry.name==='bundle.json'){
        // The operational bundle is bounded by ordinary current dashboard data;
        // retained history is excluded from this envelope by the archive format.
        bundle=await api.readArchiveRecord(zip,entry);continue;
      }
      if(entry.layout===undefined){
        if(entry.bytes>1048576)throw Error('An oversized legacy archive record requires a streaming reader');
        const record=await api.readArchiveRecord(zip,entry);
        if(record?.key!==key){if(typeof record?.key!=='string'||!record.key.startsWith(filePrefix)&&!record.key.startsWith('occupancy_replay_backup:'))throw Error('Unexpected archive evidence record');await add(record);continue;}
      }
      let recordKey=null,valueSink=null,valueActive=false,valueEnded=false,snapshot=null,snapshotEnded=false;
      const capturedSnapshots=new Map();
      const isSnapshotPath=path=>path.length===4&&path[0]==='value'&&path[1]==='batches'&&path[3]==='beforeSnapshot';
      const reader=api.createSelectedTokenReader((path,type)=>{
        if(!path.length)return true;
        if(path[0]!=='value')return true;
        if(!recordKey)throw Error('Import source identity must precede its archived value');
        if(recordKey!==key&&!recordKey.startsWith(filePrefix)&&!recordKey.startsWith('occupancy_replay_backup:'))throw Error('Unexpected archive evidence record');
        if(path.length===1&&(recordKey===key||recordKey.startsWith('occupancy_replay_backup:'))){
          if(recordKey===key&&type!=='object')throw Error('Canonical import history must be an object');
          valueSink=newSink();valueActive=true;
          return recordKey===key;
        }
        if(recordKey===key&&isSnapshotPath(path)&&type==='object'){
          if(snapshot)throw Error('Nested top-level snapshot capture');
          snapshot={index:path[2],sink:newSink(),reader:api.createSelectedTokenReader(p=>!p.length||p.length===1&&p[0]==='capturedAt')};return false;
        }
        return true;
      },(path)=>{if(path.length===1&&path[0]==='value')valueEnded=true;if(isSnapshotPath(path))snapshotEnded=true;},(path,_type,value)=>{
        if(path.length===1&&path[0]==='key'){if(typeof value!=='string'||recordKey)throw Error('Invalid archive source identity');recordKey=value;}
        if(path.length===1&&path[0]==='value')valueEnded=true;
      });
      let verifiedSegments=0;
      await api.visitEntryTokenBatches(zip,entry,async tokens=>{
        check();
        for(const token of tokens){
          reader.accept(token);
          if(valueActive)valueSink.add(token);
          if(snapshot){snapshot.sink.add(token);snapshot.reader.accept(token);}
          if(snapshotEnded&&snapshot){
            const result=await finishSink(snapshot.sink),capturedAt=String(snapshot.reader.finish()?.capturedAt||'');
            const storageKey=historyNamespace(key)+'snapshot:'+result.sha256;
            if(!destinations.has(storageKey))await add({key:storageKey,value:result.blob,encoding:'gzip-json-v1',sha256:result.sha256,updatedAt:new Date().toISOString()});
            capturedSnapshots.set(snapshot.index,{capturedAt,storageKey,sha256:result.sha256});snapshot=null;snapshotEnded=false;
          }
          if(valueEnded&&valueActive){
            const result=await finishSink(valueSink);valueActive=false;valueEnded=false;
            original={...result,key:recordKey};
          }
        }
        if(valueActive)await valueSink.flush();if(snapshot)await snapshot.sink.flush();
        onProgress({phase:'retaining',completed:++verifiedSegments,total:entry.segments?.length||null});
      });
      const record=reader.finish();
      if(recordKey===key){
        if(history)throw Error('Archive contains duplicate canonical import evidence');
        history=record.value;const {value,...metadata}=record;historyMetadata=metadata;
        for(const [index,ref]of capturedSnapshots){const batch=history.batches?.[index];if(!batch?.id)throw Error('A retained snapshot has no batch identity');const fullRef={batchId:batch.id,...ref};batch.beforeSnapshotRef=fullRef;initialSnapshots.set(batch.id,fullRef);}
        if(!original||original.key!==key)throw Error('The original import history was not retained');
        await add({key:historyNamespace(key)+'legacy:'+original.sha256,value:original.blob,encoding:'gzip-json-v1',sha256:original.sha256,updatedAt:record.updatedAt||new Date().toISOString()});
      }else if(recordKey?.startsWith('occupancy_replay_backup:')){
        if(!original||original.key!==recordKey)throw Error('The retained backup was not verified');
        const {value,...metadata}=record;
        await add({...metadata,value:original.blob,encoding:'gzip-json-v1',sha256:original.sha256,archiveRecordMetadata:metadata});
      }else await add(record);
      original=null;
    }
    if(!history||!bundle?.indexedDb?.communityData||typeof bundle.indexedDb.communityData!=='object')throw Error('Archive is missing canonical history or its operational bundle');
    check();const prepared=await prepareStreamedInitialHistory(key,history,initialSnapshots);history=null;
    for(const record of prepared.records)if(!destinations.has(record.key))await add(record);
    prepared.records.length=0;
    await add({...historyMetadata,key,value:prepared.head,updatedAt:prepared.head.updatedAt});
    await add({key:receiptKey,value:{archiveHash:archive.sha256,version:source.version,parentDocument:source.documentKey,records:archive.recordCount,verifiedAt:new Date().toISOString()},updatedAt:prepared.head.updatedAt});
    if(mode==='local-restore')await add({...expectedSource,value:{...expectedSource.value,dirty:true,lastLocalRestoreHash:archive.sha256}});
    if(mode==='proof')await add({key:'__atlas_restore_bundle_proof',value:bundle});
    await beforeCommit();check();
    // Keep the exact verified native readback envelopes for activation. Blob
    // handles are immutable and cheap to retain; expanded snapshots never enter
    // this array. A later staging overwrite cannot substitute new source bytes.
    const verifiedRecords=[];
    for(const stageKey of staged){const captured=await io('readonly',store=>store.get(stageKey));check();if(captured?.key!==stageKey||!destinations.has(captured.record?.key)||await fingerprint(captured.record)!==fingerprints.get(stageKey))throw Error('A staged archive record fingerprint changed');verifiedRecords.push(captured.record);}
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,'readwrite'),store=tx.objectStore(storeName);let failure=null;
      const abort=error=>{failure=error;try{tx.abort();}catch{}};const cancelled=()=>abort(signal.reason||new DOMException('Archive initialization cancelled','AbortError'));
      signal?.addEventListener('abort',cancelled,{once:true});
      const sourceRead=store.get(sourceKey);sourceRead.onsuccess=()=>{
        if(bindingIdentity(sourceRead.result)!==bindingIdentity(expectedSource)){abort(Error('The canonical source changed during archive preparation'));return;}
        const scan=store.openKeyCursor();scan.onsuccess=()=>{
          const cursor=scan.result;
          if(cursor){const current=String(cursor.key);if(current===key||current===receiptKey||current.startsWith(filePrefix)||current.startsWith('occupancy_replay_backup:')){abort(Error('This browser has retained archive evidence. Reconcile before replacing it'));return;}cursor.continue();return;}
          try{check();for(const record of verifiedRecords){if(mode==='local-restore'&&record.key===sourceKey)store.put({...sourceRead.result,value:{...sourceRead.result.value,dirty:true,lastLocalRestoreHash:archive.sha256}});else store.add(record);}for(const stageKey of staged)store.delete(stageKey);}catch(error){abort(error);}
        };
      };
      tx.oncomplete=()=>{signal?.removeEventListener('abort',cancelled);resolve();};tx.onabort=tx.onerror=()=>{signal?.removeEventListener('abort',cancelled);reject(failure||tx.error||Error('Archive activation failed'));};
    });
    activated=true;onProgress({phase:'complete',completed:manifest.entries.length,total:manifest.entries.length});
    return {verified:true,records:archive.recordCount,revision:1,bundle};
  }finally{
    for(const sink of sinks)await sink.abort(Error('Archive capture stopped'));
    if(!activated&&staged.length)await io('readwrite',store=>{for(const stageKey of staged)store.delete(stageKey);});
    db.close();
  }
}
