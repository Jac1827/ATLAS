(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;root.AtlasPropertyIntelligence=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const norm=v=>String(v??'').toLowerCase().replace(/^rise\s+/,'').replace(/[^a-z0-9]/g,'');
  const num=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
  const iso=v=>{const m=String(v||'').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);return m?`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`:'';};
  function sectionDates(label){const dates=String(label).match(/\d{1,2}\/\d{1,2}\/\d{4}/g)||[];return /as of/i.test(label)?{asOf:iso(dates[0]),start:'',end:''}:{start:iso(dates[0]),end:iso(dates[1]),asOf:''};}
  function eligible(employees,role,area,records={}) {
    if(!area)return [];
    return employees.filter(e=>{
      const title=String(e.title||e.role||'').toLowerCase();
      const correct=role==='gm'?(/^(gm|general manager|community manager)$/.test(title)||(!title&&e.bonusRoleType==='gm')):/\bregional\b/.test(title);
      const r=records[e.communityName||e.community]||Object.entries(records).find(([n])=>norm(n)===norm(e.communityName||e.community))?.[1]||{};
      const areas=[e.region,e.market,e.regionalGrouping,r.communityRegionalGrouping,r.communityMarket,...(Array.isArray(e.regions)?e.regions:[])];
      return correct&&e.active!==false&&!e.archived&&!/inactive|terminated|archived/i.test(e.status||'')&&!e.terminationDate&&areas.some(a=>norm(a)===norm(area));
    }).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  }
  function ranges(period,start='',end='') {return start&&end?{start,end}:{start:period+'-01',end:new Date(Date.UTC(+period.slice(0,4),+period.slice(5),0)).toISOString().slice(0,10)};}
  const overlaps=(a,b)=>!!a.start&&!!a.end&&a.start<=b.end&&a.end>=b.start;
  function metrics(snapshots,range) {
    const fields=['new_leads','tours','applications','approvals','denied_applications','applications_completed_cancelled','applications_approved_cancelled','leases_cancelled','leases_completed'];
    const cells={};
    for(const field of fields){
      // Revisions replace the same section/range; overlapping cumulative reports are never added.
      const revisions=new Map();
      for(const s of snapshots){if(num(s.values?.[field])===null||!overlaps(s,range))continue;const key=[s.section,s.start,s.end].join('|');const old=revisions.get(key);if(!old||String(s.dataThrough||s.importedAt)>String(old.dataThrough||old.importedAt)||(s.dataThrough===old.dataThrough&&s.importedAt>old.importedAt))revisions.set(key,s);}
      const all=[...revisions.values()];
      const exact=all.filter(s=>s.start===range.start&&s.end===range.end).sort((a,b)=>String(b.importedAt).localeCompare(String(a.importedAt)))[0];
      let selected=exact?[exact]:all.filter(s=>s.start>=range.start&&s.end<=range.end).sort((a,b)=>a.start.localeCompare(b.start));
      const collides=selected.some((s,i)=>selected.slice(0,i).some(p=>overlaps(p,s)));
      if(collides)selected=[];
      const days=(a,b)=>(Date.parse(b)-Date.parse(a))/86400000+1;
      const complete=selected.length&&selected.reduce((n,s)=>n+days(s.start,s.end),0)===days(range.start,range.end);
      const current=selected.some(s=>s.end>String(s.dataThrough||s.importedAt||'').slice(0,10));
      cells[field]={value:complete?selected.reduce((n,s)=>n+num(s.values[field]),0):null,label:field,source:selected.map(s=>`${s.sourceFile} · ${s.sourceSheet} · ${s.start}–${s.end}`).join('; '),status:complete?(current?'In progress / data-through not confirmed':selected.some(s=>!s.dataThrough)?'Reported range; data-through unavailable':'Reported period'):(all.length?'Partial or overlapping source coverage':'Not available'),snapshots:complete?selected:all};
    }
    return cells;
  }
  function offerRange(o){return {start:o.start||o.observedStart||String(o.firstObservedAt||'').slice(0,10),end:[o.end,o.closedAt?String(o.closedAt).slice(0,10):''].filter(Boolean).sort()[0]||'9999-12-31'};}
  function offersInRange(offers,range){return (offers||[]).filter(o=>!o.deletedAt&&overlaps(offerRange(o),range));}
  function packageCoverage(offers,range){const active=offersInRange(offers,range);return {offers:active,complete:active.length>0&&active.every(o=>{const r=offerRange(o);return r.start<=range.start&&r.end>=range.end;}),label:active.length?'Activity during listed offers':'Website / manual offer history unavailable'};}
  function packageWindows(offers,range){
    if(range.end<range.start)return [];
    const after=d=>new Date(Date.parse(d)+86400000).toISOString().slice(0,10),before=d=>new Date(Date.parse(d)-86400000).toISOString().slice(0,10);
    const active=offersInRange(offers,range),points=new Set([range.start,after(range.end)]);
    for(const o of active){const r=offerRange(o);points.add(r.start<range.start?range.start:r.start);if(r.end<range.end)points.add(after(r.end));}
    const dates=[...points].sort();return dates.slice(0,-1).map((start,i)=>{const end=before(dates[i+1]);return {start,end,offers:offersInRange(active,{start,end})};});
  }
  function datedEvents(records,name,range){
    const map={new_leads:'newLeadCreatedOn',applications:'applicationCompleted',approvals:'applicationApproved',denied_applications:'applicationDenied',leases_completed:'leaseSigned'};
    const eligible=records.filter(r=>norm(r.property||r.atlasName)===norm(name)&&!r.duplicateReview),cells={};
    for(const [key,field] of Object.entries(map)){const available=eligible.some(r=>r[field]);const ids=new Set();for(const r of eligible){const date=String(r[field]||'').slice(0,10);if(r.applicationId&&date>=range.start&&date<=range.end)ids.add(r.applicationId);}cells[key]=available?ids.size:null;}
    return cells; // Observed dated records only; never substitutes for Box Score totals.
  }
  return {norm,num,iso,sectionDates,eligible,ranges,overlaps,metrics,offerRange,offersInRange,packageCoverage,packageWindows,datedEvents};
});
