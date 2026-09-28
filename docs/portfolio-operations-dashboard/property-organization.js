/* Integration with the existing ATLAS roster, community store and authenticated API. */
(function(){
  'use strict';
  const P=window.AtlasPropertyIntelligence;
  const statuses=new Map(),cache=new Map(),pending=new Map(),settingsLoaded=new Set(),mutationVersions=new Map();
  let accessScope,accessEpoch=0;
  const scope=()=>JSON.stringify([window.ATLAS_CENTRAL?.getAccessContextKey?.()??window.ATLAS_CENTRAL?.getSession?.()?.user?.id,window.ATLAS_CENTRAL?.getStatus?.()?.signedIn,window.ATLAS_CENTRAL?.getConfig?.()?.accessApiBaseUrl]);
  const canonicalCommunityId=record=>[record?.atlasCommunityId,record?.sourceIds?.atlasCommunityId,record?.communityId].find(id=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(id||'')));
  function syncAccess(){const next=scope();if(next!==accessScope){accessScope=next;accessEpoch++;cache.clear();pending.clear();statuses.clear();settingsLoaded.clear();mutationVersions.clear();}return accessEpoch;}
  const mutationVersion=name=>mutationVersions.get(name)||0;
  const startMutation=name=>{const version=mutationVersion(name)+1;mutationVersions.set(name,version);return version;};
  function supersededResult(name){const current=cache.get(name);return current?._mutationVersion===mutationVersion(name)?{...current,_superseded:true}:{...current,error:'Website settings changed while history was loading. Retry website history.',stage:'configuration',offers:current?.offers||[],_superseded:true};}
  function accessChanged(){return Object.assign(new Error('Website access changed. Reload website history for the current login.'),{stage:'authorization',code:'access_changed'});}
  function checkAccess(epoch){if(syncAccess()!==epoch)throw accessChanged();}
  window.addEventListener?.('atlas-central-auth-change',syncAccess);
  function remember(name,data,communityId){
    const resolved=data.communityId||data.settings?.communityId;
    if(communityId&&resolved&&communityId!==resolved)throw Object.assign(new Error('Website community mapping failure. The response belongs to a different community.'),{stage:'community_mapping',code:'community_mismatch'});
    data.communityId=resolved||communityId||'';data._loadedAt=Date.now();data._mutationVersion=mutationVersion(name);cache.set(name,data);return data;
  }
  function recordFailure(name,e,communityId){
    const previous=cache.get(name),retain=!['authorization','community_mapping'].includes(e.stage)&&(!communityId||previous?.communityId===communityId);
    const data={...(retain?previous:{}),error:e.message,stage:e.stage,code:e.code,status:e.status,_loadedAt:Date.now(),_mutationVersion:mutationVersion(name)};
    data.offers ||= [];cache.set(name,data);return data;
  }
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const employeeId=e=>String(e.employeeId||e.id||'');
  const stableEmployeeId=e=>{
    if(e.employeeNumber)return getSharedEmployeeStableId(e);
    const id=String(e.peopleEmployeeId||e.id||'');
    return id?(id.startsWith('people:')?id:'people:'+id):String(e.employeeId||getSharedEmployeeStableId(e));
  };
  function roster(){
    if(atlasSharedData.lastPeopleSource==='atlas_central_people'){
      const employees=Object.values(atlasSharedData.employees||{}),assignments=atlasSharedData.assignments||[],today=new Date().toISOString().slice(0,10);
      if(assignments.length)return assignments.filter(a=>(!a.effectiveStart||a.effectiveStart<=today)&&(!a.effectiveEnd||a.effectiveEnd>=today)&&!/inactive|terminated|superseded/i.test(a.status||'')).map(a=>{
        const e=employees.find(e=>e.employeeId===a.employeeId)||{};
        return {...e,employeeId:stableEmployeeId(e),title:a.title||e.title,communityName:a.communityName};
      });
      return employees.map(e=>({...e,employeeId:stableEmployeeId(e)}));
    }
    const raw=loadPeoplePlatformStateForSharedData().employees;
    return raw.length?raw.map(e=>({...e,employeeId:stableEmployeeId(e),title:e.role||e.title,communityName:resolveSharedCommunityForEmployee(e).communityName,active:isSharedPeopleEmployeeActive(e)})):Object.values(atlasSharedData.employees||{}).map(e=>({...e,employeeId:stableEmployeeId(e)}));
  }
  window.atlasSynchronizeLinkedContacts=()=>{
    const employees=roster();let changed=false;
    for(const [name,record] of Object.entries(savedData))for(const prefix of ['generalManager','regionalManager']){
      const id=record[prefix+'EmployeeId'];if(!id)continue;
      const e=employees.find(e=>employeeId(e)===id);if(!e)continue;
      if(record[prefix+'Name']!==e.name||record[prefix+'Email']!==e.email){
        record[prefix+'Name']=e.name||'';record[prefix+'Email']=e.email||'';changed=true;
        if(name===getProp().name){if(prefix==='generalManager'){communityGeneralManagerName=e.name||'';communityGeneralManagerEmail=e.email||'';}else{communityRegionalManagerName=e.name||'';communityRegionalManagerEmail=e.email||'';}}
      }
    }
    if(changed){persistSaved();queueAtlasCentralDocumentPush('linked_roster_contacts');}
    return changed;
  };
  const area=()=>communityRegionalGrouping||communityMarket;
  const eligible=role=>[...new Map(P.eligible(roster(),role,area(),savedData).map(e=>[employeeId(e),e])).values()];
  window.atlasLinkedEmployeeIssues=()=>{
    const record=savedData[getProp().name]||{};
    return [['gm','generalManagerEmployeeId'],['regional','regionalManagerEmployeeId']].filter(([role,key])=>record[key]&&!eligible(role).some(e=>employeeId(e)===record[key])).map(([role])=>`${role==='gm'?'GM':'Regional'} assignment needs a replacement in the selected area.`);
  };
  window.atlasEmployeeSelect=role=>{
    const key=role==='gm'?'generalManagerEmployeeId':'regionalManagerEmployeeId',id=savedData[getProp().name]?.[key]||'',options=eligible(role);
    return `<select aria-label="${role==='gm'?'GM':'Regional Manager'} linked employee" onchange="atlasSelectEmployee('${role}',this.value)"><option value="">Select employee</option>${id&&!options.some(e=>employeeId(e)===id)?'<option selected value="'+esc(id)+'">Assignment needs review</option>':''}${options.map(e=>`<option value="${esc(employeeId(e))}" ${employeeId(e)===id?'selected':''}>${esc(e.name)}</option>`).join('')}</select>`;
  };
  window.atlasOrganizationWarnings=()=>{
    const record=savedData[getProp().name]||{};let messages=[];
    for(const [role,key] of [['gm','generalManagerEmployeeId'],['regional','regionalManagerEmployeeId']]){
      const id=record[key];if(id&&!eligible(role).some(e=>employeeId(e)===id))messages.push(`${role==='gm'?'GM':'Regional'} assignment is outside the selected role/area or inactive. Select a replacement.`);
      else if(!eligible(role).length)messages.push(`No eligible ${role==='gm'?'GM':'Regional'} employees are assigned to this area in People.`);
    }
    return messages.length?`<p class="ci-warning">${messages.map(esc).join('<br>')}</p>`:'';
  };
  window.atlasRefreshLinkedEmployees=()=>{
    const record=savedData[getProp().name]||{};
    for(const role of ['gm','regional']){
      const prefix=role==='gm'?'generalManager':'regionalManager',id=record[prefix+'EmployeeId'];
      if(!id)continue;const e=roster().find(e=>employeeId(e)===id);if(!e)continue;
      record[prefix+'Name']=e.name||'';record[prefix+'Email']=e.email||'';
      if(role==='gm'){communityGeneralManagerName=e.name||'';communityGeneralManagerEmail=e.email||'';}
      else{communityRegionalManagerName=e.name||'';communityRegionalManagerEmail=e.email||'';}
    }
  };
  window.atlasSelectEmployee=async(role,id)=>{
    const e=eligible(role).find(e=>employeeId(e)===id);if(id&&!e)return;
    const name=getProp().name,prefix=role==='gm'?'generalManager':'regionalManager';
    savedData[name] ||= getCurrentCommunityRecord();savedData[name][prefix+'EmployeeId']=id;
    if(role==='gm'){communityGeneralManagerName=e?.name||'';communityGeneralManagerEmail=e?.email||'';}
    else{communityRegionalManagerName=e?.name||'';communityRegionalManagerEmail=e?.email||'';}
    savedData[name]=getCurrentCommunityRecord();persistSaved();await atlasStateWritePromise;
    queueAtlasCentralDocumentPush('linked_employee_assignment');renderTab();
  };
  async function configureWebsiteSettings(name,record,epoch){
    checkAccess(epoch);
    const communityId=canonicalCommunityId(record)||cache.get(name)?.communityId,version=startMutation(name);
    let result;
    try{result=await window.ATLAS_CENTRAL.propertySpecials('configure',{communityName:name,communityId,communityWebsiteUrl:record.communityWebsiteUrl,floorPlanRatesPageUrl:record.floorPlanRatesPageUrl,websiteSettingsUpdatedAt:record.websiteSettingsUpdatedAt});}
    catch(e){checkAccess(epoch);if(mutationVersion(name)!==version)return supersededResult(name);throw e;}
    checkAccess(epoch);if(mutationVersion(name)!==version)return supersededResult(name);
    remember(name,result,communityId);settingsLoaded.add(name);statuses.set(name,'URL saved centrally. Daily check: 6 AM EST.');return result;
  }
  window.atlasWebsiteSaveStatus=()=>{syncAccess();const name=getProp().name;return `<span role="status">${esc(statuses.get(name)||'URLs save automatically. Website checks run at 6 AM EST.')}</span>${cache.get(name)?.error?' <button type="button" onclick="atlasRetryWebsiteSettings()">Retry website settings</button>':''}`;};
  window.atlasRetryWebsiteSettings=async()=>{
    const epoch=syncAccess(),name=getProp().name,record={...(savedData[name]||getCurrentCommunityRecord())};
    try{
      statuses.set(name,'Reconnecting saved website URLs…');renderTab();await atlasStateWritePromise;checkAccess(epoch);
      const stored=await atlasStateGetValue(ATLAS_STATE_COMMUNITY_KEY);checkAccess(epoch);
      const verified=(typeof stored==='string'?JSON.parse(stored):stored)?.[name];
      if(!verified||['communityWebsiteUrl','floorPlanRatesPageUrl','websiteSettingsUpdatedAt'].some(key=>(verified[key]||'')!==(record[key]||''))||canonicalCommunityId(verified)!==canonicalCommunityId(record))throw new Error('Saved website URLs changed or could not be verified. Reload Community Settings before retrying.');
      await configureWebsiteSettings(name,verified,epoch);
    }catch(e){if(syncAccess()!==epoch)return;statuses.set(name,'URL saved in community data; central website checks are not confirmed. '+e.message);recordFailure(name,e,canonicalCommunityId(record));settingsLoaded.add(name);}
    renderTab();
  };
  window.atlasLoadWebsiteSettings=()=>{
    const epoch=syncAccess();
    const name=getProp().name;if(settingsLoaded.has(name))return;settingsLoaded.add(name);
    const detail={name,record:savedData[name]||getCurrentCommunityRecord()};
    window.AtlasPropertyService.load(detail).then(data=>{
      if(syncAccess()!==epoch||data._superseded)return;
      if(data.error){statuses.set(name,data.error+' Saved community URLs remain available.');if(getProp().name===name)renderTab();return;}
      const settings=data.settings,record=savedData[name]||detail.record;
      // Recovery timestamps describe a repair, not a newer URL edit.
      const updatedAt=settings&&Object.hasOwn(settings,'sourceUpdatedAt')?settings.sourceUpdatedAt:settings?.updatedAt;
      if(settings&&((updatedAt&&String(updatedAt)>String(record.websiteSettingsUpdatedAt||''))||(!record.communityWebsiteUrl&&!record.floorPlanRatesPageUrl&&!record.websiteSettingsUpdatedAt))){
        record.communityWebsiteUrl=settings.communityWebsiteUrl??settings.website??'';record.floorPlanRatesPageUrl=settings.floorPlanRatesPageUrl??settings.floorplan??'';record.websiteSettingsUpdatedAt=updatedAt||'';
        savedData[name]=normalizeSavedCommunityRecord(name,record);persistSaved();
        if(getProp().name===name){communityWebsiteUrl=record.communityWebsiteUrl;floorPlanRatesPageUrl=record.floorPlanRatesPageUrl;renderTab();}
      }
    });
  };
  window.atlasSaveWebsiteField=async(field,value)=>{
    const epoch=syncAccess(),name=getProp().name,record=getCurrentCommunityRecord(),communityId=canonicalCommunityId(record)||cache.get(name)?.communityId;let saved=false;
    try{
      if(!['communityWebsiteUrl','floorPlanRatesPageUrl'].includes(field))throw new Error('Unknown website URL field.');
      const v=String(value||'').trim();let address='';
      if(v){const u=new URL(v);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Enter a complete public http:// or https:// address.');address=u.href;}
      record[field]=address;record.websiteSettingsUpdatedAt=new Date().toISOString();
      if(field==='communityWebsiteUrl')communityWebsiteUrl=address;else floorPlanRatesPageUrl=address;
      savedData[name]=normalizeSavedCommunityRecord(name,record);
      // Persist URL changes independently of unrelated shared-field validation failures.
      persistSaved();await atlasStateWritePromise;
      checkAccess(epoch);
      const stored=await atlasStateGetValue(ATLAS_STATE_COMMUNITY_KEY);
      checkAccess(epoch);
      const verify=typeof stored==='string'?JSON.parse(stored):stored;
      if(verify?.[name]?.[field]!==address)throw new Error('URL could not be verified in saved community data. Keep this tab open and retry.');
      saved=true;
      statuses.set(name,'URL saved. Connecting daily website checks…');queueAtlasCentralDocumentPush('community_website_url');renderTab();
      await configureWebsiteSettings(name,record,epoch);
    }catch(e){if(syncAccess()!==epoch)return;statuses.set(name,(saved?'URL saved in community data; central website checks are not confirmed. ':'')+e.message);if(saved){recordFailure(name,e,communityId);settingsLoaded.add(name);}}
    renderTab();
  };
  window.atlasCaptureBoxScore=(name,rows,sourceFile,dataThrough='')=>{
    const record=normalizeSavedCommunityRecord(name,savedData[name]),history=record.boxScoreHistory||[],at=new Date().toISOString();
    for(const row of rows){const range=row.period||{};if(!range.start||!range.end)continue;
      const snapshot={...range,section:row.section,values:row.values,leadSourceReconciliation:row.leadSourceReconciliation || null,leadSourceEvidence:row.leadComponents || [],leadSourceControls:row.leadControls || [],locators:row.locators,sourceFile,sourceSheet:row.sourceSheet,importedAt:at,dataThrough};
      const fingerprint=JSON.stringify([snapshot.section,snapshot.start,snapshot.end,snapshot.sourceFile,snapshot.values,dataThrough]);
      if(!history.some(s=>s.fingerprint===fingerprint))history.push({...snapshot,fingerprint});
    }
    record.boxScoreHistory=history;savedData[name]=record;
  };
  window.atlasCaptureBoxScoreFile=async (file,options={})=>{
    if(!options.floorPlansOnly) await refreshDataImportSharedLeadMappings();
    const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});let captured=0;
    for(const sheetName of workbook.SheetNames){
      const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false});
      if(!rows.some(r=>/box score/i.test(String(r[0]))))continue;
      const name=getAllCommunityNames().find(n=>P.norm(n)===P.norm(sheetName));
      if(!name||!atlasApplicationCommunityInScope(name)||(options.allowedNames&&!options.allowedNames.some(n=>P.norm(n)===P.norm(name))))continue;
      const sections=window.AtlasApplicationSources.boxScore(rows).map(r=>{const source={...r,sourceSheet:sheetName};if(!r.leadComponents?.length)return source;const mapped=dataImportMapSourceRow(source,{sourceSystem:'Entrata',reportType:'box_score',name:file.name}).mapped;const {__leadSourceMix,...values}=mapped;return {...source,values,leadSourceReconciliation:__leadSourceMix};});
      const floorPlans=window.AtlasBoxScoreFloorPlans?.parse(rows,file.name,sheetName)||[];
      if(!sections.length&&!floorPlans.length)continue;
      if(!options.floorPlansOnly)atlasCaptureBoxScore(name,sections,file.name);
      if(floorPlans.length)applyBoxScoreFloorPlanRows(name,floorPlans);
      captured++;
    }
    if(captured){persistSaved();await atlasStateWritePromise;loadPropertyData(getProp().name);queueAtlasCentralDocumentPush('box_score_activity');}
    return captured;
  };
  window.atlasPropertyMetrics=(detail,range)=>{
    let snapshots=[...(detail.record?.boxScoreHistory||[])];
    // Read successful existing canonical imports, including those predating this feature.
    for(const r of dataImport2State.canonicalRecords||[]){
      if(r.reportType!=='box_score'||P.norm(r.communityName)!==P.norm(detail.name)||r.deletedAt||r.status==='held'||r.downstreamEligible===false)continue;
      const period=r.sectionPeriod?.start?r.sectionPeriod:P.ranges(r.periodKey||range.start.slice(0,7));
      const section=r.section||r.sourceSheet||String(r.sourceRow||'');
      const version=r.fileHash||r.sourceVersion||r.dataAsOf||r.importedAt||'';
      if(snapshots.some(s=>(s.section||s.sourceSheet)===section&&s.sourceFile===r.sourceFile&&s.start===period.start&&s.end===period.end&&(s.fileHash||s.sourceVersion||s.dataThrough||s.importedAt||'')===version))continue;
      snapshots.push({...period,section,fileHash:r.fileHash,sourceVersion:version,values:r.values,sourceFile:r.sourceFile,sourceSheet:r.sourceSheet,importedAt:r.importedAt,dataThrough:r.dataAsOf});
    }
    return P.metrics(snapshots,range);
  };
  // Refresh a visible comparison after scheduled collections without requiring a reload.
  setInterval(()=>{if(!document.hidden&&typeof activeTab!=='undefined'&&activeTab===4)renderTab();},300000);
  window.AtlasPropertyService={
    get cache(){syncAccess();return cache;},
    async load(detail,force=false){
      const epoch=syncAccess(),communityId=canonicalCommunityId(detail.record),version=mutationVersion(detail.name);
      if(communityId&&cache.get(detail.name)?.communityId&&cache.get(detail.name).communityId!==communityId){cache.delete(detail.name);pending.delete(detail.name);}
      if(pending.has(detail.name))return pending.get(detail.name);
      if(!force&&cache.has(detail.name)&&Date.now()-(cache.get(detail.name)._loadedAt||0)<300000)return cache.get(detail.name);
      const savedSettings={communityWebsiteUrl:detail.record?.communityWebsiteUrl||'',floorPlanRatesPageUrl:detail.record?.floorPlanRatesPageUrl||'',websiteSettingsUpdatedAt:detail.record?.websiteSettingsUpdatedAt||''};
      const request={communityName:detail.name,communityId,...(Object.values(savedSettings).some(Boolean)?{savedSettings}:{})};
      const task=Promise.resolve().then(async()=>{try{
        checkAccess(epoch);
        // The server authorizes this community before reconciling its saved URLs.
        const data=await window.ATLAS_CENTRAL.propertySpecials('read',request);
        checkAccess(epoch);if(mutationVersion(detail.name)!==version)return supersededResult(detail.name);return remember(detail.name,data,communityId);
      }catch(e){if(syncAccess()!==epoch)return {error:accessChanged().message,stage:'authorization',offers:[]};if(mutationVersion(detail.name)!==version)return supersededResult(detail.name);return recordFailure(detail.name,e,communityId);}finally{if(pending.get(detail.name)===task)pending.delete(detail.name);}});
      pending.set(detail.name,task);return task;
    },
    async action(name,action,body={}){
      const epoch=syncAccess(),communityId=canonicalCommunityId(savedData[name])||cache.get(name)?.communityId,version=startMutation(name);
      try{const result=await window.ATLAS_CENTRAL.propertySpecials(action,{...body,communityName:name,communityId});checkAccess(epoch);if(mutationVersion(name)!==version)return supersededResult(name);return remember(name,result,communityId);}
      catch(e){if(syncAccess()===epoch){if(mutationVersion(name)!==version)return supersededResult(name);recordFailure(name,e,communityId);}throw e;}
    }
  };
})();
