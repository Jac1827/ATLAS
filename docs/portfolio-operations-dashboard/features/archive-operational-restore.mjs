import {hashJson} from './bounded-json-integrity.mjs?v=a4ea8821996c3b57';
export const restoreJournalKey='atlas_archive_restore_commit_v1';
export function committedRestoreError(error){return Object.assign(new Error(`The archive data was restored, but browser settings are still pending. Retry this same archive to finish safely. ${error?.message||error||''}`),{code:'archive_restore_settings_pending',committed:true,cause:error});}
export async function prepareOperationalRestore({bundle,keys,readRecord,readLocal,mergeCommunity,protectOccupancy,retention,assertCurrent}){
  assertCurrent();const indexed=bundle?.indexedDb||{},settings=[],records=[],values={},captured=new Map();
  const capture=async key=>{if(!captured.has(key)){captured.set(key,(await readRecord(key))||null);assertCurrent();}return captured.get(key);};
  const put=async(key,value)=>{const prior=await capture(key);records.push({record:{key,value,updatedAt:new Date().toISOString()},expectedHash:await hashJson(prior,{trustedData:true})});assertCurrent();values[key]=value;};
  for(const [key,raw]of Object.entries(bundle?.keys||{})){
    if(key===keys.global)await put(key,typeof raw==='string'?JSON.parse(raw):raw);
    else settings.push({key,before:readLocal(key),value:typeof raw==='string'?raw:JSON.stringify(raw)});
  }
  const priorCommunity=await capture(keys.community);
  let community=mergeCommunity(priorCommunity?.value||{},indexed.communityData);
  if(protectOccupancy)community=protectOccupancy(community,priorCommunity?.value);
  await put(keys.community,community);
  if(indexed.weeklySnapshot&&typeof indexed.weeklySnapshot==='object')await put(keys.weekly,indexed.weeklySnapshot);
  const backups=indexed.dailyBackups&&typeof indexed.dailyBackups==='object'?indexed.dailyBackups:{};
  const dates=[...new Set([...(Array.isArray(indexed.dailyBackupIndex)?indexed.dailyBackupIndex:[]),...Object.keys(backups)])].filter(date=>Boolean(backups[date]));
  if(dates.some(date=>!/^\d{4}-\d{2}-\d{2}$/.test(date)))throw Error('Archive contains an invalid daily backup date');
  if(dates.length){const old=await capture(keys.backupIndex);await put(keys.backupIndex,[...new Set([...(Array.isArray(old?.value)?old.value:[]),...dates])].sort().reverse().slice(0,retention));for(const date of dates)await put(keys.backupPrefix+date,backups[date]);}
  const journalExpectedHash=await hashJson(await capture(restoreJournalKey),{trustedData:true});assertCurrent();
  return {records,settings,journalExpectedHash,values,sourceDirty:JSON.stringify(community)!==JSON.stringify(indexed.communityData)};
}
// All authoritative IndexedDB records have already committed together. This
// journal makes the separate legacy preference mirror resumable after a crash.
export async function finishOperationalRestore({journal,readJournal,writeJournal,storage,assertCurrent}){
  const applied=[];let finalizing=false;
  try{
    assertCurrent();const current=await readJournal();assertCurrent();
    if(!current||current.restoreId!==journal.restoreId||current.archiveHash!==journal.archiveHash)throw Error('The restore completion receipt changed');
    if(current.state==='complete')return current;
    for(const setting of current.settings||[]){assertCurrent();const existing=storage.getItem(setting.key);if(existing===setting.value)continue;if(existing!==setting.before)throw Error(`A browser setting changed during restore: ${setting.key}`);storage.setItem(setting.key,setting.value);applied.push(setting);if(storage.getItem(setting.key)!==setting.value)throw Error('A browser setting could not be verified');}
    assertCurrent();const completed={...current,state:'complete',completedAt:new Date().toISOString()};finalizing=true;await writeJournal(current,completed);return completed;
  }catch(error){
    if(finalizing&&!error?.commitRejected)throw committedRestoreError(error);
    let compensation=null;
    for(const setting of applied.reverse())try{if(storage.getItem(setting.key)===setting.value){if(setting.before===null)storage.removeItem(setting.key);else storage.setItem(setting.key,setting.before);}}catch(failure){compensation=failure;}
    throw committedRestoreError(compensation?new Error(`${error.message}; browser settings recovery is pending: ${compensation.message}`):error);
  }
}
export async function readRestoredOperationalValues({journal,readRecord,assertCurrent}){
  const values={};
  for(const [key,expected]of Object.entries(journal.operationalHashes||{})){assertCurrent();const row=await readRecord(key);assertCurrent();if(await hashJson(row??null,{trustedData:true})!==expected)throw Error('Restored operational data differs from its committed receipt');values[key]=row.value;}
  return values;
}
