import {hashJson} from './bounded-json-integrity.mjs?v=a4ea8821996c3b57';
export const LEGACY_DATABASE='atlas_rise_state_v1';
const STORE='records',IMPORT='atlas_data_import_2_state_v1',FILES='atlas_data_import_source_file:',HISTORY=IMPORT+':history:v2:';
const selected=key=>key===IMPORT||key==='community_data'||key.startsWith(FILES)||key.startsWith(HISTORY)||key.startsWith('occupancy_replay_backup:');
const stopped=()=>new DOMException('Legacy evidence inspection stopped.','AbortError');
const check=signal=>{if(signal?.aborted)throw signal.reason||stopped();};
async function openExisting(factory,signal){
  check(signal);if(typeof factory.databases!=='function')throw Error('This browser cannot safely discover existing legacy storage. Nothing was opened.');
  const known=await factory.databases();check(signal);if(!known.some(row=>row.name===LEGACY_DATABASE))return null;
  return new Promise((resolve,reject)=>{const r=factory.open(LEGACY_DATABASE);r.onupgradeneeded=()=>{r.transaction.abort();reject(Error('Legacy storage changed. No database was created.'));};r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;try{check(signal);if(!db.objectStoreNames.contains(STORE))throw Error('The existing legacy evidence layout is unavailable.');resolve(db);}catch(error){db.close();reject(error);}};});
}
async function read(db,key,signal){
  check(signal);return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(key);tx.oncomplete=()=>{try{check(signal);resolve(r.result??null);}catch(error){reject(error);}};tx.onerror=tx.onabort=()=>reject(tx.error||r.error);});
}
async function keys(db,signal){
  check(signal);return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).openKeyCursor(),out=[];r.onsuccess=()=>{const c=r.result;if(!c)return;if(typeof c.key==='string'&&selected(c.key))out.push(c.key);c.continue();};tx.oncomplete=()=>{try{check(signal);resolve(out);}catch(error){reject(error);}};tx.onerror=tx.onabort=()=>reject(tx.error||r.error);});
}
async function summary(db,signal){
  const inventory=await keys(db,signal),root=await read(db,IMPORT,signal),community=await read(db,'community_data',signal);
  if(!root?.value)throw Error('No complete import evidence was found in the older local database.');
  const value=root.value,split=value.__atlasImportHistory===2;
  if(!split&&value.historyStorage?.view)throw Error('The older database contains only a projected import view. It cannot establish complete source history.');
  const count=name=>split?Number(value.collections?.[name]?.length||0):Array.isArray(value[name])?value[name].length:0;
  const dates=split?[]:(value.batches||[]).flatMap(row=>[row.approvedAt,row.createdAt]).filter(date=>Number.isFinite(Date.parse(date))).sort((a,b)=>Date.parse(b)-Date.parse(a));
  const evidence={rootHash:await hashJson(root,{trustedData:true}),communityHash:await hashJson(community,{trustedData:true}),inventory};check(signal);
  return {available:true,database:LEGACY_DATABASE,batches:count('batches'),sources:count('sourceArchive'),canonicalRecords:count('canonicalRecords'),sourceFiles:inventory.filter(key=>key.startsWith(FILES)).length,records:inventory.length,communityRecords:community?.value&&typeof community.value==='object'?Object.keys(community.value).length:0,latestApprovedAt:dates[0]||null,storedAt:root.updatedAt||value.updatedAt||null,fingerprint:await hashJson(evidence)};
}
export async function inspectLegacyEvidence({factory=globalThis.indexedDB,signal}={}){
  const db=await openExisting(factory,signal);if(!db)return {available:false,database:LEGACY_DATABASE,message:'No older local ATLAS database exists in this browser.'};
  try{return await summary(db,signal);}finally{db.close();}
}
export async function exportLegacyEvidence({expected,factory=globalThis.indexedDB,archive,Zip,signal,onProgress=()=>{}}={}){
  if(!expected?.available||!/^[a-f0-9]{64}$/.test(expected.fingerprint||''))throw Error('Preview the older local evidence before exporting it.');
  const db=await openExisting(factory,signal);if(!db)throw Error('The older local evidence is no longer available.');
  try{
    const initial=await summary(db,signal);if(initial.fingerprint!==expected.fingerprint)throw Error('The older local evidence changed. Preview it again.');
    const inventory=await keys(db,signal),fingerprints=[];
    const packed=await archive.packRecords({format:'atlas_legacy_local_evidence_v1',readOnly:true,canonicalPublication:false,capturedAt:new Date().toISOString(),source:initial,recordKeys:inventory},{count:inventory.length,readRecord:()=>{throw Error('Expanded evidence must remain inside the export worker.');},readPackedRecord:async(index,name)=>{
      check(signal);const row=await read(db,inventory[index],signal);if(!row||row.key!==inventory[index])throw Error('A retained original record disappeared.');
      const packed=await archive.packRecord(name,row,{onProgress:()=>{check(signal);onProgress();}});fingerprints.push(packed.entry);onProgress();return packed;
    }},Zip);check(signal);
    // Re-read each original, including every binary source byte. Nothing is
    // copied into or deleted from the source database to take this snapshot.
    for(let index=0;index<inventory.length;index++){
      const row=await read(db,inventory[index],signal);if(!row)throw Error('An original changed during export.');
      const checked=await archive.packRecord('record-'+index+'.json',row,{onProgress:()=>{check(signal);onProgress();}});
      if(JSON.stringify(checked.entry)!==JSON.stringify(fingerprints[index]))throw Error('An original changed during export. Preview the evidence again.');onProgress();
    }
    const final=await summary(db,signal);if(final.fingerprint!==initial.fingerprint)throw Error('The older local inventory changed during export.');
    await archive.verifyBundle(packed,Zip);check(signal);
    return {summary:initial,sha256:packed.sha256,bytes:packed.bytes,blob:new Blob([JSON.stringify(packed)],{type:'application/json'})};
  }finally{db.close();}
}
