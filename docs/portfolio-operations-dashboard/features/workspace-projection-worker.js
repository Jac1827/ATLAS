/* Decode the current workspace/provenance; complete history stays in its verified parent. */
importScripts('../vendor/jszip.min.js?v=acc7e41455a80765','../migration-archive.js?v=ae74ccbf0a527f62');
const IMPORT_KEY='atlas_data_import_2_state_v1';
const COLLECTIONS=new Set(['batches','sourceArchive','canonicalRecords','lineage','reconciliationLog','mappingAuditTrail','exceptions','leadSourceHistoricalRevisions','temporaryIgnoreHistory']);
const OMITTED_COLLECTIONS=new Set(['reconciliationLog','mappingAuditTrail','leadSourceHistoricalRevisions','temporaryIgnoreHistory']);
const BATCH_FIELDS=new Set(['id','createdAt','approvedAt','uploader','approver','status','summary','rollback','beforeSnapshotRef','archiveIds','files','routeMessages']);
const FILE_FIELDS=new Set(['fileName','reportType','reportTypeLabel']);
self.onmessage=async({data:{archive,source}})=>{
  try{
    if(archive?.bundleType!==AtlasMigrationArchive.TYPE||archive.sha256!==source?.archiveHash)throw Error('Central archive fingerprint mismatch.');
    const {projectCurrentHistory}=await import('./import-history-store.mjs?v=a5aa94c91809b279');
    let bundle=null,history=null,historyCounts=null;
    const recordKeys=new Map(),counts=new Map(),unidentifiedValues=new Set();
    await AtlasMigrationArchive.visitSelectedRecords(archive,JSZip,{
      select(name,path,type){
        if(!path.length)return true;
        if(type==='blob')return false;
        if(name==='bundle.json'){
          return path[0]==='indexedDb'&&(path.length===1||path[1]==='communityData')
            ||path[0]==='keys'&&(path.length===1||path[1]==='rise_ops_global_v1');
        }
        if(path[0]==='key')return true;
        if(path[0]!=='value')return false;
        // Native archive records are written key-first. Do not allocate an
        // unidentified historical backup if a reordered input differs.
        if(!recordKeys.has(name)){unidentifiedValues.add(name);return false;}
        if(recordKeys.get(name)!==IMPORT_KEY)return false;
        if(path.length===1)return true;
        const field=path[1];
        if(field==='pendingBatch'||field==='historyStorage'||OMITTED_COLLECTIONS.has(field))return false;
        if(field==='batches'){
          if(path.length===2)return true;
          if(path[2]>=25)return false;
          if(path.length===3)return true;
          if(!BATCH_FIELDS.has(path[3]))return false;
          if(path[3]==='files'&&path.length>=6)return FILE_FIELDS.has(path[5]);
          if(path[3]==='routeMessages'&&path.length>=5)return path[4]<2;
        }
        if(field==='exceptions'&&path.length>=3)return path[2]<25;
        return true;
      },
      onScalar(name,path,_type,value){if(name!=='bundle.json'&&path.length===1&&path[0]==='key')recordKeys.set(name,value);},
      onContainer(name,path,type,count){
        if(type==='array'&&path.length===2&&path[0]==='value'&&COLLECTIONS.has(path[1])){
          if(!counts.has(name))counts.set(name,{});counts.get(name)[path[1]]=count;
        }
      },
      onRecord(name,value){
        if(name==='bundle.json'){bundle=value;return;}
        if(value?.key!==IMPORT_KEY)return;
        if(unidentifiedValues.has(name))throw Error('Import source identity must precede its archived value.');
        if(history)throw Error('Archive contains duplicate canonical import evidence.');
        history=value.value;historyCounts=counts.get(name)||{};
      }
    });
    if(!bundle?.indexedDb?.communityData||!history)throw Error('Archive is missing the canonical workspace or import evidence.');
    const raw=bundle.keys?.rise_ops_global_v1,importState=projectCurrentHistory(history);
    // Pruned summary arrays retain the complete archive's counts. Their source
    // remains the immutable parent, never the reduced startup representation.
    importState.historyStorage={...importState.historyStorage,counts:historyCounts,view:'remote',archiveHash:source.archiveHash,parentDocument:source.documentKey,version:source.version};
    self.postMessage({ok:true,value:{format:1,source,communityData:bundle.indexedDb.communityData,opsGlobalData:typeof raw==='string'?JSON.parse(raw):raw||{},importState}});
  }catch(error){self.postMessage({ok:false,error:error.message});}
};
