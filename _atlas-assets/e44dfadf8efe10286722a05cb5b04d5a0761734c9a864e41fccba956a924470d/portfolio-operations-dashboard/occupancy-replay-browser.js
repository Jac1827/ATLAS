/* Admin-only adapter for archived occupancy preview, backup and atomic revision. */
(function() {
  let pending=null, previewController=null, applying=false;
  const readRecord=key=>withAtlasStateStore('readonly',store=>store.get(key));
  const context=()=>typeof getAtlasRenderContextKey==='function'?getAtlasRenderContextKey():'';
  const history=async(operation,extra={})=>{const dbName=ATLAS_STATE_DB_NAME;const {historyOperation}=await import('./features/import-history.mjs?v=a589f3709b941d92');return historyOperation({operation,dbName,storeName:ATLAS_STATE_STORE_NAME,key:DATA_IMPORT_2_STATE_KEY,...extra});};
  const withoutHistoryMeta=value=>{const {historyStorage,...rest}=value;return rest;};
  const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
  const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
  async function readImport(signal){const row=await readRecord(DATA_IMPORT_2_STATE_KEY);if(row?.value?.__atlasImportHistory!==2)return row;return {...row,value:await history('load',{signal}),split:true};}
  function cancel() {
    if(applying)return false; // An atomic commit/readback is never canceled by navigation.
    previewController?.abort(); previewController=null; pending=null;
    return true;
  }
  const clone=x=>JSON.parse(JSON.stringify(x));
  const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  const download=(name,value,serialized)=>{const a=document.createElement('a');const url=URL.createObjectURL(new Blob([serialized===undefined?JSON.stringify(value):serialized],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
  async function encode(value) {
    if(value instanceof Blob) {const bytes=new Uint8Array(await value.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return {__atlasBlob:true,type:value.type,size:value.size,sha256:await hash(bytes),base64:btoa(text)};}
    if(Array.isArray(value)) return Promise.all(value.map(encode));
    if(value&&typeof value==='object'){const out={};for(const [k,v] of Object.entries(value))out[k]=await encode(v);return out;}return value;
  }
  async function preview(archiveId) {
    if(!dataImportCanManageArchitecture()||dataImportApprovalInProgress)throw Error('An admin session with no import in progress is required');
    if(applying)throw Error('An occupancy commit is already in progress');
    cancel();
    const controller=new AbortController(),scope=context(); previewController=controller;
    let workbookSession=null;
    const finish=window.AtlasPerformance?.start("occupancy-preview");
    window.AtlasPerformance?.memory("before-occupancy-preview");
    const check=()=>{controller.signal.throwIfAborted();if(scope!==context())throw Error('Workspace changed during occupancy preview');if(!dataImportCanManageArchitecture())throw Error('Admin access changed during occupancy preview');};
    try {
    await atlasStateWritePromise; check();
    if(typeof ensureAtlasCanonicalImportEvidence==='function')await ensureAtlasCanonicalImportEvidence();
    check();
    const [imported,communities]=await Promise.all([readImport(controller.signal),readRecord(ATLAS_STATE_COMMUNITY_KEY)]);
    check();
    if(!imported?.value||!communities?.value)throw Error('Complete committed import and community storage is required');
    const state=imported.value, target=state.sourceArchive.find(a=>a.id===archiveId&&a.importStatus==='Approved'&&a.reportType==='box_score');
    if(!target)throw Error('Approved Box Score archive not found');
    const candidates=state.sourceArchive.filter(a=>a.reportType==='box_score'&&a.importStatus==='Approved'&&a.metadata?.generatedAt&&Date.parse(a.metadata.generatedAt)>=Date.parse(target.metadata?.generatedAt));
    if(!candidates.some(a=>a.id===target.id))throw Error('Target generation timestamp is missing');
    const observations=[],sourceFiles=[];
    const lookups={aliases:dataImportBuildAliasLookup(),internalIds:dataImportBuildInternalCommunityLookup()};
    let periodKey='';
    candidates.sort((a,b)=>a.id===target.id?-1:b.id===target.id?1:Date.parse(a.metadata.generatedAt)-Date.parse(b.metadata.generatedAt));
    for(const a of candidates) {
      check();
      const stored=(await readRecord(DATA_IMPORT_FILE_ARCHIVE_PREFIX+a.id))?.value;
      check();
      if(!stored?.blob)throw Error(`Archived source bytes missing: ${a.fileName}`);
      const bytes=await stored.blob.arrayBuffer();
      if(await hash(bytes)!==a.fileHash)throw Error(`Archived fingerprint mismatch: ${a.fileName}`);
      const file=new File([stored.blob],stored.fileName,{type:stored.type});
      const plan=await dataImportBuildFilePlan(file,{forceReportType:'box_score',signal:controller.signal});
      if(plan.fileHash!==a.fileHash||!plan.metadata?.generatedAt)throw Error('Source identity could not be re-established');
      if(typeof Worker!=='undefined') {
        const module=await import('./features/workbook-session.mjs?v=d48120a0384d9026');
        check(); workbookSession=await module.openWorkbook(file,controller.signal,bytes);
      }
      check();
      const wb=workbookSession?null:XLSX.read(bytes,{type:'array',cellDates:true,cellStyles:true});
      let included=0;
      for(const name of (workbookSession?.sheetNames||wb.SheetNames)) {
        check();
        const inspected=workbookSession?await workbookSession.sheet(name,false):null;
        check();
        if(inspected&&!inspected.candidate)continue;
        const ws=wb?.Sheets[name];
        const rows=window.AtlasApplicationSources.boxScore(inspected?inspected.rows:XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''})).filter(r=>r.section==='Availability');
        if(rows.length>1)throw Error(`Ambiguous Availability sections: ${name}`);
        for(const r of rows) {
          const date=r.period?.asOf;
          if(!date)throw Error('Availability effective date is missing');
          if(a.id===target.id&&!periodKey)periodKey=date.slice(0,7);
          if(date.slice(0,7)!==periodKey)continue;
          const communityName=dataImportResolveRowCommunity(r.values,{...r,sourceSheet:name},plan,lookups);
          if(!communityName||!communities.value[communityName]?.communityId)throw Error(`Unresolved canonical community: ${name}`);
          if(!dataImportIsActiveReportingCommunity(communityName)||!dataImportCommunitySupportsReport(communityName,'box_score'))throw Error(`Community outside authorized reporting scope: ${communityName}`);
          const values=Object.fromEntries(window.AtlasOccupancyReplay.fields.map(f=>[f,f.endsWith('occupancy')?dataImportPercentValue(r.values[f]):r.values[f]]));
          const offset=inspected?inspected.rangeStartRow:XLSX.utils.decode_range(ws['!ref']).s.r;
          const locators=Object.fromEntries(Object.entries(r.locators).map(([f,v])=>[f,{...v,row:v.row+offset}]));
          observations.push({communityName,communityId:communities.value[communityName].communityId,periodKey,sectionDate:date,
            generatedAt:plan.metadata.generatedAt,dataAsOf:plan.metadata.dataAsOf||plan.metadata.generatedAt,archiveId:a.id,batchId:a.batchId,
            fileHash:a.fileHash,sourceFile:a.fileName,sourceSheet:name,sourceRow:r.sourceRow+offset,values,locators});
          included++;
        }
      }
      workbookSession?.close(); workbookSession=null;
      await new Promise(resolve=>setTimeout(resolve,0)); check();
      if(included)sourceFiles.push({archiveId:a.id,fileName:a.fileName,fileHash:a.fileHash,generatedAt:plan.metadata.generatedAt,communities:included});
    }
    if(!observations.some(o=>o.archiveId===target.id))throw Error('No target occupancy observations found');
    const now=new Date().toISOString();
    const result=window.AtlasOccupancyReplay.prepare({communityData:communities.value,importState:state,observations,periodKey,now});
    check();
    // Only these two records can change in apply(). Archived files remain immutable.
    const completeImport=imported.split?{key:imported.key,value:await history('export',{signal:controller.signal}),updatedAt:imported.updatedAt}:imported;
    const backup={schema:'atlas_scoped_occupancy_repair_backup_v1',scope:'occupancy_replay_transaction',capturedAt:now,sourceFiles,records:await encode([completeImport,communities])};
    const backupText=JSON.stringify(backup),backupHash=await hash(new TextEncoder().encode(backupText));
    check();
    download('atlas-occupancy-replay-backup.json',null,backupText);
    window.AtlasPerformance?.record('occupancy-backup',0,{rows:2,bytes:new Blob([backupText]).size});
    const summary={scope:'occupancy_only',periodKey,backupSha256:backupHash,sourceFiles,changes:result.changes,changed:result.changed,observationCount:observations.length,
      note:'Includes source-dated history. The newest verified approved Box Score controls current occupancy. Earlier periods and non-occupancy fields are retained.'};
    pending={imported,communities,result,summary,now,scope};
    download('atlas-occupancy-replay-preview.json',summary);
    return summary;
    } finally {workbookSession?.close();if(previewController===controller)previewController=null;finish?.({failed:controller.signal.aborted});window.AtlasPerformance?.memory("after-occupancy-preview-cleanup");}
  }
  async function apply() {
    if(!pending||!dataImportCanManageArchitecture()||dataImportApprovalInProgress)throw Error('Create an authorized occupancy preview first');
    if(applying)throw Error('An occupancy commit is already in progress');
    const p=pending; applying=true;
    try {
    await atlasStateWritePromise;
    if(p.scope!==context())throw Error('Workspace changed after preview; rebuild the preview before applying');
    if(!dataImportCanManageArchitecture())throw Error('Admin access changed before occupancy commit');
    if(!p.result.changed){pending=null;return {changed:false,message:'Already reconciled; no additional facts created'};}
    let splitReceipt=null;
    if(p.imported.split){
      const stamp=new Date().toISOString(),backupKey='occupancy_replay_backup:'+stamp;
      splitReceipt=await history('publish',{value:p.result.importState,expectedRevision:p.imported.value.historyStorage.revision,records:[
        {key:ATLAS_STATE_COMMUNITY_KEY,value:p.result.communityData,expectedHash:await hash(new TextEncoder().encode(JSON.stringify(p.communities.value)))},
        {key:backupKey,value:{backupSha256:p.summary.backupSha256,communityRecord:p.communities,importHistoryRevision:p.imported.value.historyStorage.revision,preview:p.summary},expectedHash:await hash(new TextEncoder().encode('null'))}
      ]});
    }else{
    const db=await openAtlasStateDb();if(!db)throw Error('Storage unavailable');
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(ATLAS_STATE_STORE_NAME,'readwrite'),store=tx.objectStore(ATLAS_STATE_STORE_NAME);
      let reads=0,currentImport,currentCommunity,reason;
      const stop=message=>{reason=Error(message);tx.abort();};
      const check=()=>{
        if(++reads!==2)return;
        if(JSON.stringify(currentImport?.value)!==JSON.stringify(p.imported.value)||JSON.stringify(currentCommunity?.value)!==JSON.stringify(p.communities.value))return stop('Stored data changed after preview; rebuild the preview before applying');
        const stamp=new Date().toISOString();
        store.put({key:'occupancy_replay_backup:'+stamp,value:{backupSha256:p.summary.backupSha256,communityRecord:currentCommunity,importRecord:currentImport,preview:p.summary},updatedAt:stamp});
        store.put({key:ATLAS_STATE_COMMUNITY_KEY,value:p.result.communityData,updatedAt:stamp});
        store.put({key:DATA_IMPORT_2_STATE_KEY,value:p.result.importState,updatedAt:stamp});
      };
      const a=store.get(DATA_IMPORT_2_STATE_KEY),b=store.get(ATLAS_STATE_COMMUNITY_KEY);
      a.onsuccess=()=>{currentImport=a.result;check();};b.onsuccess=()=>{currentCommunity=b.result;check();};
      tx.oncomplete=resolve;tx.onabort=()=>reject(reason||tx.error||Error('Occupancy transaction aborted'));tx.onerror=()=>reject(tx.error||Error('Occupancy transaction failed'));
    });
    }
    if(p.scope!==context()){pending=null;throw Error('The original workspace was saved. Reload its history to verify the receipt.');}
    savedData=clone(p.result.communityData);dataImport2State=splitReceipt?.state||clone(p.result.importState);
    if(typeof rememberDataImportHistoryState==='function')rememberDataImportHistoryState();
    pending=null;
    loadPropertyData(getProp().name);renderPropGrid();renderTab();
    const [communityReadback,importReadback]=await Promise.all([readRecord(ATLAS_STATE_COMMUNITY_KEY),readImport()]);
    const report={appliedAt:new Date().toISOString(),preview:p.summary,
      communityReadbackMatches:same(communityReadback?.value,p.result.communityData),
      importReadbackMatches:same(importReadback?.value?withoutHistoryMeta(importReadback.value):null,withoutHistoryMeta(p.result.importState))};
    download('atlas-occupancy-replay-result.json',report);
    if(!report.communityReadbackMatches||!report.importReadbackMatches)throw Error('Post-commit readback differs; preserve the backup and investigate concurrent writers');
    return report;
    } finally {applying=false;}
  }
  window.AtlasOccupancyReplayBrowser={preview,apply,cancel};
  window.addEventListener("pagehide",cancel);
  window.addEventListener("atlas-central-auth-change",cancel);
  window.previewAtlasOccupancyReplay=async archiveId=>{try{const p=await preview(archiveId);alert(`Occupancy preview exported: ${p.changes.length} communities; ${p.observationCount} source observations. Backup of both affected storage records exported. Review the preview before applying.`);}catch(e){if(e.name==='AbortError')return;alert(`Occupancy preview stopped: ${e.message}`);}};
  window.applyAtlasOccupancyReplay=async()=>{try{if(!pending)throw Error('Create and review an occupancy preview first');if(!confirm('Apply the reviewed occupancy-only revision? Newer approved Box Score observations remain controlling.'))return;const r=await apply();alert(r.changed===false?r.message:'Occupancy revision committed and verified in browser storage. Shared-session and report acceptance still required.');}catch(e){alert(`Occupancy revision stopped: ${e.message}`);}};
})();
