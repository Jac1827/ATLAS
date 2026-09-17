/* Integration with the existing ATLAS roster, community store and authenticated API. */
(function(){
  'use strict';
  const P=window.AtlasPropertyIntelligence;
  const statuses=new Map(),cache=new Map(),pending=new Map();
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
  window.atlasWebsiteSaveStatus=()=>`<span role="status">${esc(statuses.get(getProp().name)||'URLs save automatically. Website checks run at 6 AM EST.')}</span>`;
  const settingsLoaded=new Set();
  window.atlasLoadWebsiteSettings=()=>{
    const name=getProp().name;if(settingsLoaded.has(name))return;settingsLoaded.add(name);
    const detail={name,record:savedData[name]||getCurrentCommunityRecord()};
    window.AtlasPropertyService.load(detail).then(data=>{
      const settings=data.settings,record=savedData[name]||detail.record;
      if(settings&&String(settings.updatedAt)>String(record.websiteSettingsUpdatedAt||'')){
        record.communityWebsiteUrl=settings.website||'';record.floorPlanRatesPageUrl=settings.floorplan||'';record.websiteSettingsUpdatedAt=settings.updatedAt;
        savedData[name]=normalizeSavedCommunityRecord(name,record);persistSaved();
        if(getProp().name===name){communityWebsiteUrl=record.communityWebsiteUrl;floorPlanRatesPageUrl=record.floorPlanRatesPageUrl;renderTab();}
      }
    });
  };
  window.atlasSaveWebsiteField=async(field,value)=>{
    const name=getProp().name,record=getCurrentCommunityRecord();
    try{
      const v=String(value||'').trim();let address='';
      if(v){const u=new URL(v);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Enter a complete public http:// or https:// address.');address=u.href;}
      record[field]=address;record.websiteSettingsUpdatedAt=new Date().toISOString();
      if(field==='communityWebsiteUrl')communityWebsiteUrl=address;else floorPlanRatesPageUrl=address;
      savedData[name]=normalizeSavedCommunityRecord(name,record);
      // Persist URL changes independently of unrelated shared-field validation failures.
      persistSaved();await atlasStateWritePromise;
      const stored=await atlasStateGetValue(ATLAS_STATE_COMMUNITY_KEY);
      const verify=typeof stored==='string'?JSON.parse(stored):stored;
      if(verify?.[name]?.[field]!==address)throw new Error('URL could not be verified in saved community data. Keep this tab open and retry.');
      statuses.set(name,'URL saved. Connecting daily website checks…');queueAtlasCentralDocumentPush('community_website_url');renderTab();
      const result=await window.ATLAS_CENTRAL.propertySpecials('configure',{communityName:name,communityId:record.communityId,website:record.communityWebsiteUrl,floorplan:record.floorPlanRatesPageUrl});
      result._loadedAt=Date.now();cache.set(name,result);statuses.set(name,'URL saved centrally. Daily check: 6 AM EST.');
    }catch(e){statuses.set(name,e.message);}
    renderTab();
  };
  window.atlasCaptureBoxScore=(name,rows,sourceFile,dataThrough='')=>{
    const record=normalizeSavedCommunityRecord(name,savedData[name]),history=record.boxScoreHistory||[],at=new Date().toISOString();
    for(const row of rows){const range=row.period||{};if(!range.start||!range.end)continue;
      const snapshot={...range,section:row.section,values:row.values,locators:row.locators,sourceFile,sourceSheet:row.sourceSheet,importedAt:at,dataThrough};
      const fingerprint=JSON.stringify([snapshot.section,snapshot.start,snapshot.end,snapshot.sourceFile,snapshot.values,dataThrough]);
      if(!history.some(s=>s.fingerprint===fingerprint))history.push({...snapshot,fingerprint});
    }
    record.boxScoreHistory=history;savedData[name]=record;
  };
  window.atlasCaptureBoxScoreFile=async (file,options={})=>{
    const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});let captured=0;
    for(const sheetName of workbook.SheetNames){
      const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:'',raw:false});
      if(!rows.some(r=>/box score/i.test(String(r[0]))))continue;
      const name=getAllCommunityNames().find(n=>P.norm(n)===P.norm(sheetName));
      if(!name||!atlasApplicationCommunityInScope(name)||(options.allowedNames&&!options.allowedNames.some(n=>P.norm(n)===P.norm(name))))continue;
      const sections=window.AtlasApplicationSources.boxScore(rows).map(r=>({...r,sourceSheet:sheetName}));
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
    cache,
    async load(detail,force=false){
      if(pending.has(detail.name))return pending.get(detail.name);
      if(!force&&cache.has(detail.name)&&Date.now()-(cache.get(detail.name)._loadedAt||0)<300000)return cache.get(detail.name);
      const task=(async()=>{try{
        let data=await window.ATLAS_CENTRAL.propertySpecials('read',{communityName:detail.name,communityId:detail.record.communityId});
        // Enrol already-saved website addresses once; central URLs win thereafter.
        if(!data.settings&&(detail.record.communityWebsiteUrl||detail.record.floorPlanRatesPageUrl))data=await window.ATLAS_CENTRAL.propertySpecials('configure',{communityName:detail.name,website:detail.record.communityWebsiteUrl,floorplan:detail.record.floorPlanRatesPageUrl});
        data._loadedAt=Date.now();cache.set(detail.name,data);return data;
      }catch(e){const data={error:e.message,offers:[]};data._loadedAt=Date.now();cache.set(detail.name,data);return data;}finally{pending.delete(detail.name);}})();
      pending.set(detail.name,task);return task;
    },
    async action(name,action,body={}){const result=await window.ATLAS_CENTRAL.propertySpecials(action,{communityName:name,...body});result._loadedAt=Date.now();cache.set(name,result);return result;}
  };
})();
