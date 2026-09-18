/* Read-only projection of the existing Resident Data store. No parallel persistence. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtlasApplicationSources = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const text = v => String(v ?? '').trim();
  const date = v => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : null; };
  const key = r => JSON.stringify([r.communityId || r.atlasName || r.propertySource, r.applicationId]);
  function project(uploads = [], scope = []) {
    const allowed = new Set(scope), byKey = new Map(), imports = [], issues = [];
    for (const upload of uploads) {
      if (!['valid', 'needs_review'].includes(upload.validationStatus)) continue;
      const visible = (upload.records || []).filter(r => r.mappingStatus === 'mapped' && allowed.has(r.atlasName || r.communityName));
      if (!visible.length) continue;
      imports.push({id:upload.batchId, fileName:upload.fileName, sourceAsOf:upload.sourceAsOf,
        uploadedAt:upload.uploadedAt, reportPeriodKey:upload.reportPeriodKey, recordCount:visible.length,
        validationStatus:upload.validationStatus});
      for (const r of visible) {
        if (!r.applicationId) continue;
        const record = {...r, property:r.atlasName || r.communityName, propertyRaw:r.propertySource,
          applicantName:r.residentName, phone:r.primaryPhone, unit:r.buildingUnit,
          newLeadCreatedOn:r.sourceTimestamps?.newLeadCreatedOn || r.newLeadCreatedOn,
          applicationCompleted:r.sourceTimestamps?.applicationCompletedOn || r.applicationCompletedOn, partialApplication:r.sourceTimestamps?.applicationPartiallyCompletedOn || r.applicationPartiallyCompletedOn,
          tourDate:r.firstVisitTourDate, sourceAsOf:upload.sourceAsOf, uploadId:upload.batchId,
          sourceFileName:r.sourceFileName || upload.fileName,
          // Move-in and lease dates in this filtered roster are not confirmation events.
          scheduledMoveIn:r.moveInDate, moveIn:'',
          applicationApproved:r.sourceTimestamps?.applicationApprovedOn || r.applicationApprovedOn || '',
          leaseSigned:r.sourceTimestamps?.leaseSignedOn || r.leaseSignedOn || '', lifecycleCoverage:'unavailable'};
        const sourceTime = date(upload.sourceAsOf);
        const fingerprint = JSON.stringify(Object.fromEntries(Object.entries(record).filter(([k]) => !['batchId','uploadId','sourceFileName','sourceSheetName','sourceRowNumber'].includes(k)).sort(([a],[b])=>a.localeCompare(b))));
        const id = key(r), previous = byKey.get(id);
        if (!previous || (sourceTime !== null && previous.time !== null && sourceTime > previous.time)) {
          byKey.set(id, {record, time:sourceTime, fingerprint, conflict:!!r.duplicateReview});
        } else if (sourceTime === previous.time && fingerprint !== previous.fingerprint || sourceTime === null || previous.time === null) {
          if (fingerprint !== previous.fingerprint) previous.conflict = true;
        }
      }
    }
    const records = [];
    for (const value of byKey.values()) {
      if (value.conflict) issues.push({type:'ambiguous_revision', community:value.record.property, applicationId:value.record.applicationId});
      else records.push(value.record);
    }
    imports.sort((a,b)=>(date(b.sourceAsOf)||0)-(date(a.sourceAsOf)||0));
    return {records, imports, dataQuality:{conflicts:issues, source:'applicationResidentData', publication:'Existing dashboard store; shared publication requires sync confirmation'}};
  }
  function filter(records, view = {}, now = new Date()) {
    const query = text(view.search).toLowerCase();
    return records.filter(r => {
      for (const [field, recordField] of [['community','property'],['agent','leasingAgent'],['status','applicationStatus']]) {
        if (view[field] && view[field] !== 'all' && r[recordField] !== view[field]) return false;
      }
      const stamp = date(r.applicationCreated || r.newLeadCreatedOn);
      if (view.date === 'week' && (stamp === null || stamp < now.getTime()-7*86400000 || stamp > now.getTime())) return false;
      if (view.date === 'mtd' && (stamp === null || new Date(stamp).getMonth() !== now.getMonth() || new Date(stamp).getFullYear() !== now.getFullYear() || stamp > now.getTime())) return false;
      return !query || [r.applicationId,r.applicantName,r.property,r.propertyRaw,r.leasingAgent,r.denialReason].some(v=>text(v).toLowerCase().includes(query));
    });
  }
  // Merge upload identities; an explicit later restore can supersede a deletion.
  const revision = u => Math.max(date(u.deletedAt)||0, date(u.restoredAt)||0, date(u.uploadedAt)||0);
  function merge(base = {}, incoming = {}) {
    const uploads = new Map();
    for (const u of [...(base.uploads || []), ...(incoming.uploads || [])]) {
      const old = uploads.get(u.batchId);
      if (!old || revision(u) > revision(old) || (revision(u) === revision(old) && u.deletedAt && !old.deletedAt)) uploads.set(u.batchId, u);
    }
    const audit = [...new Map([...(base.audit || []), ...(incoming.audit || [])].map(e=>[JSON.stringify(e),e])).values()];
    return {...base, ...incoming, uploads:[...uploads.values()].sort((a,b)=>(date(b.uploadedAt)||0)-(date(a.uploadedAt)||0)), audit};
  }
  function boxScoreDates(label) {
    const dates=(String(label).match(/\d{1,2}\/\d{1,2}\/\d{4}/g)||[]).map(s=>{const [m,d,y]=s.split('/');return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;});
    return /as of/i.test(label)?{asOf:dates[0]||'',start:'',end:''}:{start:dates[0]||'',end:dates[1]||'',asOf:''};
  }
  function boxScore(rows) {
    const output = [], norm = v => text(v).toLowerCase().replace(/\s+/g,' ');
    const anchors = /^(availability|property pulse|lead activity|lead conversions|make ready status)\b/i;
    for (let i=0;i<rows.length;i++) {
      const label = text(rows[i]?.[0]);
      if (!anchors.test(label) || /^make ready/i.test(label)) continue;
      let end=i+1;
      while (end<rows.length && !anchors.test(text(rows[end]?.[0]))) end++;
      const totalIndex=rows.findIndex((r,j)=>j>i && j<end && /^total:?$/i.test(text(r[0])));
      if (totalIndex<0) continue; // Filtered-empty is not zero.
      const section=label.toLowerCase(), headerIndex=rows.findIndex((r,j)=>j>i&&j<totalIndex&&/^unit type$/i.test(text(r[0])));
      if(headerIndex<0)continue;
      const headers=rows[headerIndex] || [], total=rows[totalIndex], values={}, locators={};
      const get=(field,label,group='',occurrence=0,percent=false)=>{
        let current='', index=-1, matched=0;
        for(let c=0;c<headers.length;c++){
          if(group && text(rows[headerIndex-1]?.[c]))current=norm(rows[headerIndex-1][c]);
          if(norm(headers[c])===label && (!group||current===group) && matched++===occurrence){index=c;break;}
        }
        const raw=total[index];
        if(index<0 || raw===null || raw===undefined || text(raw)==='' || /^#/.test(text(raw)))return;
        const value=Number(text(raw).replace(/[$,% ,]/g,''));
        if(!Number.isFinite(value))return;
        values[field]=percent ? `${text(raw).includes('%') || Math.abs(value)>1 ? value : value*100}%` : text(raw).includes('%') ? text(raw) : value;
        locators[field]={row:totalIndex+1,column:index+1,section:section,group,sourceHeader:headers[index]};
      };
      if(section.startsWith('availability')) {
        for(const [field,h] of Object.entries({total_units:'units',rentable_units:'rentable units',excluded_units:'excluded',occupied_units:'occupied',vacant_units:'vacant',available_units:'available',occupied_no_notice:'occupied no notice',notice_rented:'notice rented',notice_unrented:'notice unrented',vacant_rented:'vacant rented',vacant_unrented:'vacant unrented'}))get(field,h);
        const leasedHeader=headers.find(h=>/: leased units$/i.test(text(h)));
        if(leasedHeader)get('source_leased_units',norm(leasedHeader));
        // Entrata repeats Occupied: first is a count, second is a rate.
        // Retain both so publication can reconcile them independently.
        get('physical_occupancy','occupied','',1,true);
        get('leased_occupancy','leased','',0,true);
        if(locators.occupied_units)locators.occupied_units.group='count';
        for(const field of ['physical_occupancy','leased_occupancy'])if(locators[field])locators[field].group='percent';
        get('avg_market_rent_budgeted','avg. market rent (budgeted)');
        get('avg_scheduled_rent','avg. scheduled rent');
        get('avg_ner','avg. net effective rent');
        values.measurement_basis='units';
      } else if(section.startsWith('lead conversions')) {
        for(const [field,h] of Object.entries({applications:'completed',approvals:'approved',denied_applications:'denied',applications_partial:'partially completed',applications_completed_cancelled:'completed (cancelled)',applications_approved_cancelled:'approved (cancelled)'}))get(field,h,'application');
        get('cancelled_applications','cancelled','application');
        get('leases_completed','completed','lease');get('leases_approved','approved','lease');get('leases_cancelled','completed (cancelled)','lease');
      } else if(section.startsWith('lead activity')) {get('new_leads','new leads');get('tours','first visits/tours');
        for(const [field,h] of Object.entries({walk_in:'walk in',off_site_event:'off site event',phone_calls:'call',emails:'email',online:'online',chat:'chat',text:'text',other:'other'}))get(field,h);
      }
      else {get('move_ins','move-ins');get('move_outs','move-outs');get('renewal_leases_approved','renewal leases approved');}
      if(Object.keys(locators).length)output.push({values,sourceRow:totalIndex+1,canonicalSource:true,locators,section:label.replace(/\s*\(.*/, ""),period:typeof AtlasPropertyIntelligence!=="undefined"?AtlasPropertyIntelligence.sectionDates(label):boxScoreDates(label)});
      i=end-1;
    }
    return output;
  }
  return {project, filter, merge, boxScore};
});
