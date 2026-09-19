/* Scoped, immutable occupancy revisions. Original imports remain audit evidence. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtlasOccupancyReplay = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const VERSION = 'occupancy-replay-v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const fields = ['total_units','excluded_units','rentable_units','occupied_units','source_leased_units','physical_occupancy','leased_occupancy'];
  const legacyFields = [...fields,'leased_units'];
  const keyOf = o => [VERSION,o.communityId,o.periodKey,o.sectionDate,o.fileHash].join('::');
  function validate(o) {
    if (!o.communityId || !o.communityName || !/^[a-f0-9]{64}$/.test(o.fileHash || '') ||
        !/^\d{4}-\d{2}$/.test(o.periodKey || '') || !/^\d{4}-\d{2}-\d{2}$/.test(o.sectionDate || '') ||
        o.sectionDate.slice(0,7) !== o.periodKey || !Number.isFinite(Date.parse(o.generatedAt)) ||
        !o.archiveId || !o.batchId || !o.sourceSheet || !Number.isInteger(o.sourceRow)) throw Error('Incomplete occupancy source identity');
    const v=o.values;
    for (const f of fields.slice(0,5)) if (!Number.isInteger(v?.[f]) || v[f]<0) throw Error(`${o.communityName}: ${f} must be an integer count`);
    if (v.rentable_units<=0 || v.total_units!==v.rentable_units+v.excluded_units || v.occupied_units>v.rentable_units || v.source_leased_units>v.rentable_units) throw Error(`${o.communityName}: inventory does not reconcile`);
    for (const [f,count] of [['physical_occupancy','occupied_units'],['leased_occupancy','source_leased_units']]) {
      if (!Number.isFinite(v[f]) || Math.abs(v[f]-100*v[count]/v.rentable_units)>0.011) throw Error(`${o.communityName}: ${f} does not reconcile`);
    }
    for (const f of fields) if (!o.locators?.[f]) throw Error(`${o.communityName}: missing ${f} source locator`);
    for (const f of fields.slice(0,5)) if(o.locators[f].group==='percent' || /%/.test(o.locators[f].sourceHeader||'')) throw Error('Percentage locator cannot populate a count');
    return o;
  }
  function prepare({communityData,importState,observations,periodKey,now}) {
    if (!Number.isFinite(Date.parse(now))) throw Error('Revision timestamp required');
    if (importState.closedPeriods?.includes(periodKey)) throw Error('Closed period cannot be replayed');
    const data=clone(communityData), state=clone(importState), changes=[], grouped=new Map();
    state.canonicalRecords ||= []; state.lineage ||= []; state.reconciliationLog ||= [];
    for (const o of observations) {
      validate(o);
      if (o.periodKey!==periodKey) throw Error('Replay cannot cross reporting periods');
      if (data[o.communityName]?.communityId!==o.communityId) throw Error('Canonical community mismatch');
      const archive=state.sourceArchive.find(a=>a.id===o.archiveId && a.fileHash===o.fileHash && a.batchId===o.batchId && a.importStatus==='Approved' && a.reportType==='box_score');
      if (!archive) throw Error('Source is not an approved archived Box Score');
      const key=keyOf(o), prior=state.canonicalRecords.find(r=>r.key===key);
      if (prior && JSON.stringify(prior.values)!==JSON.stringify(o.values)) throw Error('Conflicting same-source revision');
      if (!prior) {
        const supersedes=[];
        for (const r of state.canonicalRecords) {
          if(r.fileHash!==o.fileHash || r.communityName!==o.communityName || r.periodKey!==periodKey) continue;
          const found=legacyFields.filter(f=>Object.hasOwn(r.values||{},f));
          if (!found.length) continue;
          r.fieldSupersession={...r.fieldSupersession};
          for(const f of found) r.fieldSupersession[f]={revisionKey:key,supersededAt:now};
          supersedes.push({key:r.key,fields:found});
        }
        state.canonicalRecords.push({key,reportType:'box_score',reportTypeLabel:'Box Score',communityName:o.communityName,communityId:o.communityId,periodKey,
          values:clone(o.values),fieldMetadata:Object.fromEntries(fields.map(f=>[f,{type:f.endsWith('occupancy')?'number':'integer',unit:f.endsWith('occupancy')?'percent':'units'}])),
          section:'availability',sectionPeriod:{asOf:o.sectionDate},sourceSheet:o.sourceSheet,sourceRow:o.sourceRow,sourceLocators:clone(o.locators),
          sourceSystem:'Entrata',sourceFile:o.sourceFile,fileHash:o.fileHash,batchId:o.batchId,archiveId:o.archiveId,
          dataAsOf:o.dataAsOf,generatedAt:o.generatedAt,importedAt:now,mappingVersion:VERSION,supersedes,downstreamEligible:true});
        for(const f of fields) state.lineage.unshift({id:`${key}::${f}`,key,communityName:o.communityName,communityId:o.communityId,periodKey,
          reportType:'box_score',reportTypeLabel:'Box Score',sourceRank:100,sourceSystem:'Entrata',sourceFile:o.sourceFile,fileHash:o.fileHash,
          sourceSheet:o.sourceSheet,sourceRow:o.sourceRow,originalField:clone(o.locators[f]),atlasField:f,importedValue:o.values[f],
          batchId:o.batchId,mappingVersion:VERSION,dataAsOf:o.dataAsOf,generatedAt:o.generatedAt,importedAt:now,currentState:false});
      }
      if (!grouped.has(o.communityName)) grouped.set(o.communityName,[]);
      if (grouped.get(o.communityName).some(x=>keyOf(x)===key)) continue;
      grouped.get(o.communityName).push(o);
    }
    for(const [name,list] of grouped) {
      list.sort((a,b)=>a.sectionDate.localeCompare(b.sectionDate)||Date.parse(a.generatedAt)-Date.parse(b.generatedAt));
      for(let i=1;i<list.length;i++) if(list[i].sectionDate===list[i-1].sectionDate && list[i].generatedAt===list[i-1].generatedAt && JSON.stringify(list[i].values)!==JSON.stringify(list[i-1].values)) throw Error('Conflicting observations at the same effective time');
      const record=data[name], latest=list.at(-1), monthIdx=Number(periodKey.slice(5))-1;
      record.monthlyHistoryByPeriod ||= {};
      record.monthlyHistoryByPeriod[periodKey] ||= {};
      const months=[record.monthlyHistoryByPeriod[periodKey]];
      if (periodKey.slice(0,4)===now.slice(0,4)) {
        if(!Array.isArray(record.monthlyData)||!record.monthlyData[monthIdx]) throw Error('Current period storage missing');
        months.push(record.monthlyData[monthIdx]);
      }
      const before=clone(months.at(-1));
      const provenance=o=>({community:name,communityId:o.communityId,period:periodKey,source:o.fileHash,sourceSystem:'Entrata',sourceFile:o.sourceFile,
        sourceSheet:o.sourceSheet,sourceRow:o.sourceRow,dataAsOf:o.sectionDate,generatedAt:o.generatedAt,importedAt:now,batchId:o.batchId,
        archiveId:o.archiveId,revisionKey:keyOf(o),sourceRank:100,field:'occupied_units',transformation:'Occupied count / rentable units; exclusions applied once'});
      for(const month of months) {
        month.physicalSnapshotHistory ||= {};
        for(const o of list) {
          const v=o.values, prior=month.physicalSnapshotHistory[o.sectionDate], p=prior?.metricProvenance?.occupiedSnapshot;
          if(p?.revisionKey===keyOf(o)) continue;
          if(p?.generatedAt && Date.parse(p.generatedAt)>Date.parse(o.generatedAt)) continue;
          const next={occupiedSnapshot:v.occupied_units,leasedSnapshot:v.source_leased_units,rentableUnits:v.rentable_units,sourceTotalUnits:v.total_units,excludedUnits:v.excluded_units,
            physicalOccupancyPct:100*v.occupied_units/v.rentable_units,leasedOccupancyPct:100*v.source_leased_units/v.rentable_units,metricProvenance:{occupiedSnapshot:provenance(o)}};
          if(prior) {month.occupancySnapshotRevisions ||= [];month.occupancySnapshotRevisions.push({date:o.sectionDate,replacedAt:now,revisionKey:keyOf(o),before:clone(prior)});}
          month.physicalSnapshotHistory[o.sectionDate]=next;
        }
        const p=month.metricProvenance?.occupiedSnapshot;
        const controlling=(state.lineage||[]).filter(l=>l.currentState&&l.communityName===name&&l.periodKey===periodKey&&['occupied_units','leased_units'].includes(l.atlasField));
        if((p?.dataAsOf && p.dataAsOf.slice(0,10)>latest.sectionDate) || controlling.some(l=>String(l.dataAsOf||'').slice(0,10)>latest.sectionDate)) throw Error(`${name}: newer controlling observation must be included before replay`);
        const v=latest.values, updates={occupiedSnapshot:v.occupied_units,leasedSnapshot:v.source_leased_units,rentableUnits:v.rentable_units,excludedUnits:v.excluded_units,
          sourceTotalUnits:v.total_units,sourceLeasedUnits:v.source_leased_units,physicalOccupancyPct:100*v.occupied_units/v.rentable_units,leasedOccupancyPct:100*v.source_leased_units/v.rentable_units};
        const changed=Object.entries(updates).some(([f,x])=>month[f]!==x);
        if(changed) {
          month.occupancyPublicationRevisions ||= [];
          month.occupancyPublicationRevisions.push({replacedAt:now,revisionKey:keyOf(latest),before:Object.fromEntries(Object.keys(updates).map(f=>[f,month[f]??null])),priorProvenance:clone(month.metricProvenance||{})});
          Object.assign(month,updates);
          month.metricProvenance={...month.metricProvenance};
          const sourceFields={occupiedSnapshot:'occupied_units',leasedSnapshot:'source_leased_units',rentableUnits:'rentable_units',excludedUnits:'excluded_units',sourceTotalUnits:'total_units',sourceLeasedUnits:'source_leased_units',physicalOccupancyPct:'physical_occupancy',leasedOccupancyPct:'leased_occupancy'};
          for(const f of Object.keys(updates)) month.metricProvenance[f]={...provenance(latest),destinationField:f,field:sourceFields[f]};
        }
      }
      const after=months.at(-1);
      if (periodKey.slice(0,4)===now.slice(0,4) && record.currentMonth===monthIdx) {
        record.currentOccupied=after.occupiedSnapshot;
        record.currentLeased=after.leasedSnapshot;
      }
      if (JSON.stringify(before)!==JSON.stringify(after)) changes.push({communityName:name,communityId:latest.communityId,sourceFile:latest.sourceFile,sourceDate:latest.sectionDate,
        before:{occupied:before.occupiedSnapshot??null,leased:before.leasedSnapshot??null,rentable:before.rentableUnits??null},
        after:{occupied:after.occupiedSnapshot,leased:after.leasedSnapshot,rentable:after.rentableUnits,physicalPercent:after.physicalOccupancyPct}});
      for(const f of ['occupied_units','leased_units']) {
        const id=`${keyOf(latest)}::current::${f}`;
        if(state.lineage.some(l=>l.id===id&&l.currentState)) continue;
        for(const l of state.lineage) if(l.currentState&&l.communityName===name&&l.periodKey===periodKey&&l.atlasField===f) l.currentState=false;
        state.lineage.unshift({id,key:keyOf(latest),communityName:name,communityId:latest.communityId,periodKey,atlasField:f,
          importedValue:f==='occupied_units'?latest.values.occupied_units:latest.values.source_leased_units,
          fileHash:latest.fileHash,sourceFile:latest.sourceFile,sourceSystem:'Entrata',reportType:'box_score',reportTypeLabel:'Box Score',sourceRank:100,
          dataAsOf:latest.dataAsOf,generatedAt:latest.generatedAt,batchId:latest.batchId,mappingVersion:VERSION,importedAt:now,currentState:true});
      }
    }
    const observationKeys=[...new Set(observations.map(keyOf))].sort();
    const replayId=VERSION+'::'+observationKeys.join('|');
    for (const archive of state.sourceArchive) {
      const keys=observationKeys.filter(key=>key.endsWith('::'+archive.fileHash));
      if (!keys.length) continue;
      archive.occupancyRevisions ||= [];
      if (!archive.occupancyRevisions.some(r=>r.id===replayId)) archive.occupancyRevisions.push({id:replayId,createdAt:now,scope:'occupancy_only',periodKey,observationKeys:keys});
    }
    if(!state.reconciliationLog.some(l=>l.id===replayId)) state.reconciliationLog.unshift({id:replayId,reportType:'box_score',scope:'occupancy_only',periodKey,createdAt:now,observationKeys,
      formula:'Typed Availability counts and effective-dated inventory supersede occupancy fields only. Newer approved source observations control current publication.',changes});
    const changed=JSON.stringify(data)!==JSON.stringify(communityData)||JSON.stringify(state)!==JSON.stringify(importState);
    return {communityData:data,importState:state,changes,changed,observationKeys};
  }
  return {VERSION,fields,validate,prepare};
});
