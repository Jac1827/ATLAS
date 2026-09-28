// Immutable evidence is stored separately from the bounded views used by the UI.
export const HISTORY_FORMAT = 2;
export const HISTORY_PAGE_SIZE = 100;
const COLLECTIONS = ['batches','sourceArchive','canonicalRecords','lineage','reconciliationLog','mappingAuditTrail','exceptions','leadSourceHistoricalRevisions','temporaryIgnoreHistory'];
const PREFERENCES = new Set(['pendingBatch','activeView','selectedMappingIds','selectedMappingPreviewId','mappingReviewFilter','mappingSourceFilter','mappingReportFilter','mappingBatchFilter','mappingSearch','selectedIssueKey','activeQuestionReviewKey','activeQuestionId','selectedQuestionIds','expandedQuestionSampleIds','questionReviewFilter','activeCustomFieldContext','pendingIgnoreAllKey']);
const CURRENT_FIELDS = new Set(['occupied_units','total_units','rentable_units','excluded_units','measurement_basis','physical_occupancy','source_leased_units','leased_units','leased_occupancy','move_ins','move_outs','applications','approvals','denied_applications','cancelled_applications','renewal_expirations','renewals_signed','guest_cards','tours','leases_signed','new_leads','leases_completed']);
const clone = value => structuredClone(value);
const fail = (message, code = 'history_conflict') => Object.assign(new Error(message), {code});
const conflict = () => fail('Import history changed. Reload before saving.');
const check = signal => { if (signal?.aborted) throw signal.reason || new DOMException('Import history read cancelled','AbortError'); };
export const historyNamespace = key => `${key}:history:v2:`;
export const isSplitHistory = value => value?.__atlasImportHistory === HISTORY_FORMAT;
export async function historyHash(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value === undefined ? null : value,(_key,item)=>{if(typeof item==='function'||typeof item==='symbol')throw fail('Import evidence must contain serializable values.','history_integrity');return item;}));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}

// Compatibility for existing in-memory callers. Split records must use the transaction API.
export function projectHistory(state) {
  if (!state) return state;
  if (isSplitHistory(state)) throw fail('Split import history requires the history storage reader.','history_reader_required');
  return {...state,batches:(state.batches||[]).map(batch=>{
    if (!batch?.beforeSnapshot) return batch;
    const {beforeSnapshot,...summary}=batch;
    return {...summary,beforeSnapshotRef:{batchId:batch.id,capturedAt:String(beforeSnapshot.capturedAt||'')}};
  })};
}
export function resolveSnapshot(batch,stored) {
  if (isSplitHistory(stored)) throw fail('Split rollback evidence requires the history storage reader.','history_reader_required');
  const ref=batch?.beforeSnapshotRef;
  if (!ref) return batch?.beforeSnapshot;
  const matches=(stored?.batches||[]).filter(item=>item?.id===ref.batchId);
  const snapshot=matches.length===1 ? matches[0].beforeSnapshot : null;
  if (ref.batchId!==batch.id || !snapshot || String(snapshot.capturedAt||'')!==ref.capturedAt) throw fail('Import rollback evidence changed or is unavailable. Reload before saving.');
  return snapshot;
}
export function mergeHistory(incoming,stored) {
  if (isSplitHistory(stored) || incoming?.historyStorage?.view === 'current') throw fail('Complete import history is required before a legacy save.','history_reader_required');
  return {...incoming,batches:(incoming.batches||[]).map(batch=>{
    if (!batch?.beforeSnapshotRef) return batch;
    const beforeSnapshot=resolveSnapshot(batch,stored);
    const {beforeSnapshotRef,...summary}=batch;
    return {...summary,beforeSnapshot};
  })};
}

function open(dbName,storeName) {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(dbName,1);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(storeName))r.result.createObjectStore(storeName,{keyPath:'key'});};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
function readMany(db,storeName,keys,signal) {
  check(signal);
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,'readonly'),store=tx.objectStore(storeName),rows=new Map();
    const abort=()=>tx.abort(); signal?.addEventListener('abort',abort,{once:true});
    for(const key of keys){const req=store.get(key);req.onsuccess=()=>rows.set(key,req.result);}
    tx.oncomplete=()=>{signal?.removeEventListener('abort',abort);resolve(rows);};
    tx.onerror=tx.onabort=()=>{signal?.removeEventListener('abort',abort);reject(signal?.aborted?signal.reason||new DOMException('Cancelled','AbortError'):tx.error||fail('Import history read failed.'));};
  });
}
async function readOne(db,storeName,key,signal){return (await readMany(db,storeName,[key],signal)).get(key);}
async function readVerified(db,storeName,refs,signal){
  const result=[];
  // Bounded fetches also keep explicit full exports from issuing unbounded IDB requests.
  for(let offset=0;offset<refs.length;offset+=16){
    check(signal);const subset=refs.slice(offset,offset+16),rows=await readMany(db,storeName,subset.map(r=>r.key),signal);
    for(const ref of subset){const row=rows.get(ref.key);if(!row || row.sha256!==ref.hash || await historyHash(row.value)!==ref.hash)throw fail('Import evidence is missing or its fingerprint changed.','history_integrity');result.push(row.value);}
  }
  return result;
}
const meta = (head,view) => ({format:HISTORY_FORMAT,revision:head.revision,view,counts:Object.fromEntries(Object.entries(head.collections).map(([k,v])=>[k,v.length])),updatedAt:head.updatedAt});
async function fullState(db,storeName,head,signal){
  const [base]=await readVerified(db,storeName,[head.state],signal);
  const value={...base};
  for(const [name,collection]of Object.entries(head.collections)) value[name]=(await readVerified(db,storeName,collection.pages,signal)).flat();
  return value;
}
function summaryBatch(batch){
  return {id:batch.id,createdAt:batch.createdAt,approvedAt:batch.approvedAt,uploader:batch.uploader,approver:batch.approver,status:batch.status,summary:batch.summary,rollback:batch.rollback,beforeSnapshotRef:batch.beforeSnapshotRef,archiveIds:batch.archiveIds,
    files:(batch.files||[]).map(f=>({fileName:f.fileName,reportType:f.reportType,reportTypeLabel:f.reportTypeLabel})),routeMessages:(batch.routeMessages||[]).slice(0,2)};
}
function currentGroups(state){
  const groups=new Map(),sourceKeys=new Set();
  const group=(communityName,periodKey)=>{const k=JSON.stringify([communityName||'',periodKey||'']);if(!groups.has(k))groups.set(k,{communityName:communityName||'',period:periodKey||'',lineage:[],canonicalRecords:[]});return groups.get(k);};
  for(const row of state.lineage||[])if(row.currentState && CURRENT_FIELDS.has(row.atlasField)){
    group(row.communityName,row.periodKey).lineage.push(row);
    sourceKeys.add(JSON.stringify([row.communityName,row.periodKey,row.fileHash,row.dataAsOf]));
  }
  for(const row of state.canonicalRecords||[])if(row.reportType==='box_score' && sourceKeys.has(JSON.stringify([row.communityName,row.periodKey,row.fileHash,row.dataAsOf]))){
    const record=Object.fromEntries(['key','batchId','communityName','periodKey','reportType','fileHash','dataAsOf','generatedAt','importedAt','sourceFile','sourceSheet','sourceRow','section','sectionPeriod','mappingVersion'].filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
    const values=Object.fromEntries(Object.entries(row.values||{}).filter(([field])=>CURRENT_FIELDS.has(field)));
    group(row.communityName,row.periodKey).canonicalRecords.push({...record,values});
  }
  return [...groups.values()];
}
export function projectCurrentHistory(state,scope={}){
  if(!state)return null;
  if(isSplitHistory(state))throw fail('A complete source record is required for projection.');
  const names=Array.isArray(scope.communityNames)?new Set(scope.communityNames):null,periods=Array.isArray(scope.periods)?new Set(scope.periods):null;
  const groups=currentGroups(state).filter(g=>(!names||names.has(g.communityName))&&(!periods||periods.has(g.period)));
  const seen=new Set(),sources=[];
  for(const row of state.sourceArchive||[]){let add=false;for(const name of row.communities?.length?row.communities:['']){const k=JSON.stringify([name,row.reportType]);if((!names||names.has(name))&&!seen.has(k)){seen.add(k);add=true;}}if(add)sources.push(row);}
  const base=Object.fromEntries(Object.entries(state).filter(([name])=>!COLLECTIONS.includes(name)&&name!=='historyStorage'));
  return {...base,pendingBatch:null,batches:(state.batches||[]).slice(0,25).map(summaryBatch),sourceArchive:sources,exceptions:(state.exceptions||[]).slice(0,25),canonicalRecords:groups.flatMap(g=>g.canonicalRecords),lineage:groups.flatMap(g=>g.lineage),reconciliationLog:[],historyStorage:{format:HISTORY_FORMAT,view:'current',revision:null,counts:Object.fromEntries(COLLECTIONS.filter(k=>Array.isArray(state[k])).map(k=>[k,state[k].length]))}};
}
export function historyChanges(value,base={}){
  const result={preferences:{},set:{},upsert:{}};
  for(const [name,next]of Object.entries(value||{})){if(['historyStorage','updatedAt'].includes(name)||JSON.stringify(next)===JSON.stringify(base[name]))continue;
    if(PREFERENCES.has(name)){result.preferences[name]=next;continue;}
    if(!COLLECTIONS.includes(name)){result.set[name]=next;continue;}
    if(!Array.isArray(next))throw fail('Invalid history collection change.');
    const identity=row=>name==='canonicalRecords'?row.key:row.id,previous=new Map((base[name]||[]).map(row=>[identity(row),row]));
    const changed=next.filter(row=>JSON.stringify(row)!==JSON.stringify(previous.get(identity(row))));
    if(changed.length&&['canonicalRecords','lineage','reconciliationLog'].includes(name)&&value.historyStorage?.view!=='full')throw fail('Approve an import before changing complete source evidence.','history_full_required');
    if(changed.length)result.upsert[name]=changed.map(row=>{const before=previous.get(identity(row));return before?Object.fromEntries(Object.entries(row).filter(([k,v])=>k===(name==='canonicalRecords'?'key':'id')||JSON.stringify(v)!==JSON.stringify(before[k]))):row;});
  }
  return result;
}
const withoutMeta = value => {const {historyStorage,...rest}=value||{};return rest;};
async function prepare(key,value,prior,revision){
  const records=new Map(),prefix=historyNamespace(key),state={...withoutMeta(value)},oldBatches=new Map((prior?.batches||[]).map(b=>[b.id,b]));
  const add=async(kind,v)=>{const hash=await historyHash(v),storageKey=prefix+kind+':'+hash;records.set(storageKey,{key:storageKey,value:v,sha256:hash,updatedAt:new Date().toISOString()});return {key:storageKey,hash};};
  const unique=(rows,name)=>{const ids=new Set();for(const row of rows){if(!row?.id || ids.has(row.id))throw fail(`Import ${name} identity is missing or duplicated.`,'history_integrity');ids.add(row.id);}};
  unique(state.batches||[],'batch');unique(state.sourceArchive||[],'source');
  for(const collection of ['batches','sourceArchive']){
    const ids=new Set((state[collection]||[]).map(row=>row.id));
    if((prior?.[collection]||[]).some(row=>!ids.has(row.id)))throw fail('A history save cannot discard retained batches or source evidence.','history_integrity');
  }
  if(Array.isArray(state.batches))state.batches=await Promise.all(state.batches.map(async batch=>{
    const old=oldBatches.get(batch.id),oldRef=old?.beforeSnapshotRef;
    if(batch.beforeSnapshot){
      const ref=await add('snapshot',batch.beforeSnapshot),snapshotRef={batchId:batch.id,capturedAt:String(batch.beforeSnapshot.capturedAt||''),storageKey:ref.key,sha256:ref.hash};
      if(oldRef?.sha256 && JSON.stringify(oldRef)!==JSON.stringify(snapshotRef))throw fail('An immutable rollback snapshot cannot be replaced.','history_integrity');
      const {beforeSnapshot,beforeSnapshotRef,...rest}=batch;return {...rest,beforeSnapshotRef:snapshotRef};
    }
    if(batch.beforeSnapshotRef){
      if(!oldRef?.sha256 || JSON.stringify(batch.beforeSnapshotRef)!==JSON.stringify(oldRef))throw fail('Import rollback evidence changed or is unavailable. Reload before saving.','history_integrity');
    }else if(oldRef)throw fail('A history save cannot remove rollback evidence.','history_integrity');
    return batch;
  }));
  const collections={};
  for(const name of COLLECTIONS)if(Array.isArray(state[name])){
    const rows=state[name],pages=[];
    for(let offset=0;offset<rows.length;offset+=HISTORY_PAGE_SIZE)pages.push({...await add(name,rows.slice(offset,offset+HISTORY_PAGE_SIZE)),count:Math.min(HISTORY_PAGE_SIZE,rows.length-offset)});
    collections[name]={length:rows.length,pages};
  }
  const groups=[];
  for(const group of currentGroups(state))groups.push({...await add('current',group),communityName:group.communityName,period:group.period});
  const latestSources=[],seen=new Set();
  for(const source of state.sourceArchive||[]){
    let needed=false;for(const name of source.communities?.length?source.communities:['']){const k=JSON.stringify([name,source.reportType]);if(!seen.has(k)){seen.add(k);needed=true;}}
    if(needed)latestSources.push(source);
  }
  const currentSummary=await add('current-summary',{batches:(state.batches||[]).slice(0,25).map(summaryBatch),sourceArchive:latestSources,exceptions:(state.exceptions||[]).slice(0,25)});
  const base=Object.fromEntries(Object.entries(state).filter(([name])=>!COLLECTIONS.includes(name)));
  const head={__atlasImportHistory:HISTORY_FORMAT,revision,updatedAt:new Date().toISOString(),state:await add('state',base),collections,snapshotRefs:Object.fromEntries((state.batches||[]).filter(b=>b.beforeSnapshotRef).map(b=>[b.id,b.beforeSnapshotRef])),current:{groups,summary:currentSummary}};
  return {head,records:[...records.values()]};
}

// Compare protected records and the root in the same transaction as all evidence writes.
async function commit(db,storeName,key,expected,prepared,extras=[],original){
  const expectedRoot=JSON.stringify(expected?.value??null);
  if(extras.some(row=>typeof row.key!=='string'||row.key===key||(row.key.startsWith(historyNamespace(key))&&!(row.internalPreference&&row.key===historyNamespace(key)+'preferences'))))throw fail('Protected records cannot overwrite import evidence.');
  const keys=[key,...extras.map(row=>row.key)];
  if(new Set(keys).size!==keys.length)throw fail('Duplicate protected record key.');
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,'readwrite'),store=tx.objectStore(storeName);let failure=null;
    const abort=e=>{failure=e;try{tx.abort();}catch{}};
    const reads=keys.map(k=>store.get(k)),current=new Map();let remaining=reads.length;
    reads.forEach((read,index)=>{read.onsuccess=()=>{
      current.set(keys[index],read.result);
      if(--remaining)return;
      try{
        if(JSON.stringify(current.get(key)?.value??null)!==expectedRoot)throw conflict();
        for(const extra of extras)if(JSON.stringify(extra.record?(current.get(extra.key)??null):(current.get(extra.key)?.value??null))!==extra.expectedJson)throw conflict();
        if(original)store.put(original);
        if(expected?.value && isSplitHistory(expected.value))store.put({key:historyNamespace(key)+'revision:'+expected.value.revision,value:expected.value,updatedAt:expected.updatedAt});
        for(const record of prepared.records){const exists=store.getKey(record.key);exists.onsuccess=()=>{try{if(exists.result===undefined)store.add(record);}catch(e){abort(e);}};}
        for(const extra of extras)store.put(extra.record||{key:extra.key,value:extra.value,updatedAt:prepared.head.updatedAt});
        store.put({key,value:prepared.head,updatedAt:prepared.head.updatedAt});
      }catch(e){abort(e);}
    };});
    tx.oncomplete=()=>resolve(prepared.head);tx.onerror=tx.onabort=()=>reject(failure||tx.error||fail('Import history transaction failed.'));
  });
}
async function headFor(db,storeName,key,signal){
  const record=await readOne(db,storeName,key,signal);
  if(isSplitHistory(record?.value))return {record,head:record.value};
  if(['remote','current','page'].includes(record?.value?.historyStorage?.view))throw fail('Complete canonical import evidence has not been loaded.','history_full_required');
  const legacy=record?.value||{},prepared=await prepare(key,legacy,null,1);
  check(signal);
  const hash=await historyHash(legacy),original={key:historyNamespace(key)+'legacy:'+hash,value:legacy,sha256:hash,updatedAt:record?.updatedAt||new Date().toISOString()};
  await commit(db,storeName,key,record,prepared,[],original);
  return {record:{key,value:prepared.head,updatedAt:prepared.head.updatedAt},head:prepared.head};
}
async function preferences(db,storeName,key,signal){return (await readOne(db,storeName,historyNamespace(key)+'preferences',signal))?.value||{revision:0,values:{}};}
async function currentState(db,storeName,key,head,scope={},signal){
  const [base,summary]=await readVerified(db,storeName,[head.state,head.current.summary],signal);
  const names=Array.isArray(scope.communityNames)?new Set(scope.communityNames):null,periods=Array.isArray(scope.periods)?new Set(scope.periods):null;
  const refs=head.current.groups.filter(group=>(!names||names.has(group.communityName))&&(!periods||periods.has(group.period)));
  const groups=await readVerified(db,storeName,refs,signal),prefs=await preferences(db,storeName,key,signal);
  const sourceArchive=summary.sourceArchive.filter(source=>!names||(source.communities||[]).some(name=>names.has(name)));
  return {...base,pendingBatch:null,...summary,sourceArchive,canonicalRecords:groups.flatMap(g=>g.canonicalRecords),lineage:groups.flatMap(g=>g.lineage),reconciliationLog:[],...prefs.values,historyStorage:{...meta(head,'current'),preferencesRevision:prefs.revision}};
}
async function snapshotFor(db,storeName,head,batch,signal){
  const ref=batch?.beforeSnapshotRef;
  if(!ref?.sha256 || ref.batchId!==batch.id || JSON.stringify(head.snapshotRefs?.[batch.id])!==JSON.stringify(ref))throw fail('Rollback snapshot reference is invalid.','history_integrity');
  const [snapshot]=await readVerified(db,storeName,[{key:ref.storageKey,hash:ref.sha256}],signal);
  if(String(snapshot?.capturedAt||'')!==ref.capturedAt)throw fail('Rollback snapshot identity changed.','history_integrity');
  return snapshot;
}
async function protectedExtras(db,storeName,records,signal){
  const rows=await readMany(db,storeName,records.map(r=>r.key),signal),out=[];
  for(const row of records){const current=row.record?(rows.get(row.key)??null):(rows.get(row.key)?.value??null);if(row.record&&row.record.key!==row.key)throw fail('Protected record identity changed.');if(!row.expectedHash || await historyHash(current)!==row.expectedHash)throw conflict();out.push({...row,expectedJson:JSON.stringify(current)});}
  return out;
}
function expectedRevision(request,head){
  const revision=request.expectedRevision??request.value?.historyStorage?.revision;
  if(Number(revision)!==head.revision)throw conflict();
}
function assertFull(value){if(['current','remote','page'].includes(value?.historyStorage?.view))throw fail('Load complete import data before changing evidence.','history_full_required');}
function deltaState(prior,{set={},append={},upsert={}}){
  if(Object.keys(set).some(k=>COLLECTIONS.includes(k)||k==='historyStorage'))throw fail('Use explicit collection changes.');
  const next={...prior,...set};
  for(const [name,rows]of Object.entries(append)){if(!COLLECTIONS.includes(name)||!Array.isArray(rows))throw fail('Invalid history append.');next[name]=rows.concat(next[name]||[]);}
  for(const [name,rows]of Object.entries(upsert)){if(!COLLECTIONS.includes(name)||!Array.isArray(rows))throw fail('Invalid history update.');const id=row=>name==='canonicalRecords'?row.key:row.id,changes=new Map(rows.map(row=>[id(row),row]));if(changes.has(undefined)||changes.size!==rows.length)throw fail('History update requires unique identities.');next[name]=(next[name]||[]).map(row=>{const k=id(row);if(!changes.has(k))return row;const v=changes.get(k);changes.delete(k);return {...row,...v};}).concat([...changes.values()]);}
  return next;
}
export async function executeHistory(request) {
  const {operation,dbName,storeName,key,signal}=request;
  check(signal);const db=await open(dbName,storeName);
  try{
    if(operation==='records'){
      const records=await readMany(db,storeName,request.keys||[],signal);
      return {records:await Promise.all((request.keys||[]).map(async key=>{const value=request.raw?(records.get(key)??null):(records.get(key)?.value??null);return {key,value,hash:await historyHash(value)};}))};
    }
    // Compatibility: initial save is the only write that can omit its revision.
    const existing=await readOne(db,storeName,key,signal);
    // Preferences are independent of the canonical evidence. A remote startup
    // projection can use them without downloading or initializing that evidence.
    if(operation==='preferenceValues')return await preferences(db,storeName,key,signal);
    if(operation==='preferences'){
      const current=await preferences(db,storeName,key,signal),values=request.value||{};
      if(Object.keys(values).some(name=>!PREFERENCES.has(name)))throw fail('This operation accepts view preferences only.');
      if(request.expectedPreferencesRevision!==undefined&&request.expectedPreferencesRevision!==current.revision)throw conflict();
      const prefKey=historyNamespace(key)+'preferences',next={revision:current.revision+1,values:{...current.values,...values}};
      await new Promise((resolve,reject)=>{const tx=db.transaction(storeName,'readwrite'),store=tx.objectStore(storeName),read=store.get(prefKey);let error;read.onsuccess=()=>{if((read.result?.value?.revision||0)!==current.revision){error=conflict();tx.abort();}else store.put({key:prefKey,value:next,updatedAt:new Date().toISOString()});};tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(error||tx.error);});
      return {verified:true,revision:isSplitHistory(existing?.value)?existing.value.revision:null,preferencesRevision:next.revision};
    }
    if(operation==='save'&&!existing){assertFull(request.value);const prepared=await prepare(key,request.value,null,1);await commit(db,storeName,key,existing,prepared);return {revision:1,verified:true,historyStorage:meta(prepared.head,'full')};}
    const {record,head}=await headFor(db,storeName,key,signal);
    if(operation==='current')return await currentState(db,storeName,key,head,request.scope,signal);
    if(operation==='load'||operation==='export'){
      const value=await fullState(db,storeName,head,signal);
      if(operation==='export'){
        if(Array.isArray(value.batches))value.batches=await Promise.all(value.batches.map(async batch=>{if(!batch.beforeSnapshotRef)return batch;const {beforeSnapshotRef,...rest}=batch;return {...rest,beforeSnapshot:await snapshotFor(db,storeName,head,batch,signal)};}));return {...value,...(await preferences(db,storeName,key,signal)).values};
      }
      const prefs=await preferences(db,storeName,key,signal);
      return {...value,...prefs.values,historyStorage:{...meta(head,'full'),preferencesRevision:prefs.revision}};
    }
    if(operation==='page'){
      if(request.expectedRevision!==undefined)expectedRevision(request,head);
      const name=request.collection;if(!COLLECTIONS.includes(name))throw fail('Unknown history collection.');
      const collection=head.collections[name]||{length:0,pages:[]},offset=Math.max(0,Math.floor(Number(request.offset)||0)),limit=Math.max(1,Math.min(100,Math.floor(Number(request.limit)||25)));
      const first=Math.floor(offset/HISTORY_PAGE_SIZE),last=Math.ceil((offset+limit)/HISTORY_PAGE_SIZE),rows=(await readVerified(db,storeName,collection.pages.slice(first,last),signal)).flat().slice(offset-first*HISTORY_PAGE_SIZE,offset-first*HISTORY_PAGE_SIZE+limit);
      return {rows:name==='batches'&&request.detail!==true?rows.map(summaryBatch):rows,total:collection.length,offset,nextOffset:offset+rows.length<collection.length?offset+rows.length:null,revision:head.revision};
    }
    if(operation==='snapshot')return await snapshotFor(db,storeName,head,request.batch,signal);
    if(!['save','publish','update','rollback'].includes(operation))throw fail('Unknown import history operation.');
    expectedRevision(request,head);assertFull(request.value);
    const prior=await fullState(db,storeName,head,signal);let value=request.value,records=(request.records||[]).map(({internalPreference,...row})=>row);
    if(operation==='update')value=deltaState(prior,request);
    if(operation==='rollback'){
      const batch=prior.batches?.find(b=>b.id===request.batch?.id);
      if(!batch||batch.status==='Rolled Back'||JSON.stringify(batch.beforeSnapshotRef)!==JSON.stringify(request.batch?.beforeSnapshotRef))throw conflict();
      const snapshot=await snapshotFor(db,storeName,head,batch,signal);
      if(!snapshot?.savedData)throw fail('Complete rollback community evidence is unavailable.','history_integrity');
      const reason=String(request.reason||'').trim();if(!reason)throw fail('A rollback reason is required.');
      const rolledBackAt=new Date().toISOString();value={...prior,canonicalRecords:snapshot.canonicalRecords||[],lineage:snapshot.lineage||[],reconciliationLog:snapshot.reconciliationLog||[],batches:prior.batches.map(b=>b.id===batch.id?{...b,status:'Rolled Back',rollback:{rolledBackAt,rolledBackBy:String(request.actor||''),reason}}:b),sourceArchive:(prior.sourceArchive||[]).map(s=>s.batchId===batch.id?{...s,importStatus:'Rolled Back'}:s)};
      const communityKey=request.communityKey||'community_data',globalKey=request.globalKey||'rise_ops_global_v1';
      const captures=await readMany(db,storeName,[communityKey,globalKey],signal);
      records=[{key:communityKey,value:snapshot.savedData,expectedHash:request.communityHash},{key:globalKey,value:{...(captures.get(globalKey)?.value||{}),applicationResidentData:snapshot.applicationResidentData||{uploads:[]}},expectedHash:request.globalHash}];
    }
    if(!value||typeof value!=='object')throw fail('Complete import state is required.');
    if((operation==='publish'||operation==='save')&&Object.hasOwn(value,'pendingBatch')){
      const prefKey=historyNamespace(key)+'preferences',prefs=await preferences(db,storeName,key,signal),stored=(await readOne(db,storeName,prefKey,signal))?.value??null;
      records=[...records,{key:prefKey,value:{revision:prefs.revision+1,values:{...prefs.values,pendingBatch:value.pendingBatch}},expectedHash:await historyHash(stored),internalPreference:true}];
    }
    if(request.markDirty!==false){
      const sourceKey='atlas_workspace_source_v2',source=(await readOne(db,storeName,sourceKey,signal))?.value;
      if(source)records=[...records,{key:sourceKey,value:{...source,dirty:true},expectedHash:await historyHash(source)}];
    }
    const extras=await protectedExtras(db,storeName,records,signal),prepared=await prepare(key,value,prior,head.revision+1);
    check(signal);await commit(db,storeName,key,record,prepared,extras);
    try {
      return {verified:true,revision:prepared.head.revision,historyStorage:meta(prepared.head,'full'),state:await currentState(db,storeName,key,prepared.head,request.scope),records:await Promise.all(extras.map(async row=>({key:row.key,hash:await historyHash(row.record||row.value)})))};
    } catch {throw Object.assign(fail('Import history was saved but its readback could not be confirmed. Reload before making another change.','history_write_uncertain'),{uncertain:true});}
  }finally{db.close();}
}
