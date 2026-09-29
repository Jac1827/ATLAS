/* Canonical application evidence. Snapshot states are not period activity events. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AtlasApplicationLineage=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const text=v=>String(v??'').trim();
const stamp=v=>{if(v===null||v===undefined||v==='')return null;const n=Date.parse(v);return Number.isFinite(n)?new Date(n).toISOString():null;};
const month=v=>stamp(v)?.slice(0,7)||null;
const terminal=new Set(['approved','denied','cancelled']);
function canonical(r={},source={}){
 const ts=r.sourceTimestamps||{},get=(...keys)=>{for(const k of keys){const v=stamp(ts[k]||r[k]);if(v)return v;}return null;};
 const sourceEffectiveAt=stamp(source.sourceEffectiveAt||source.sourceAsOf||r.sourceEffectiveAt||r.sourceAsOf);
 const raw=text(r.applicationStatus),qualified=/^application:\s*/i.test(raw),status=raw.replace(/^application:\s*/i,'').toLowerCase();
 const fromApplication=qualified||r.sourceColumns?.applicationStatus==='Application Status'&&!/^(lease|renewal offer|resident):/i.test(raw);
 const applicationStartedAt=get('applicationStartedAt','applicationStartedOn','applicationCreated');
 const applicationCompletedAt=get('applicationCompletedAt','applicationCompletedOn','applicationCompleted');
 const events=[['approved',get('applicationApprovedOn','applicationApproved')],['denied',get('applicationDeniedOn','applicationDenied')],['cancelled',get('applicationCancelledOn','applicationCancelled','applicationCompletedCancelledOn','applicationApprovedCancelledOn')]].filter(([,t])=>t&&sourceEffectiveAt&&t<=sourceEffectiveAt).sort((a,b)=>b[1].localeCompare(a[1]));
 const observed=fromApplication?(/cancelled|canceled/.test(status)?'cancelled':status==='approved'?'approved':status==='denied'?'denied':null):null;
 let decisionStatus='unavailable',decisionAt=null,exclusionReason='non_application_status';
 if(fromApplication){
  const tied=events.length>1&&events[0][1]===events[1][1]&&events[0][0]!==events[1][0];
  if(tied&&!observed){exclusionReason='conflicting_terminal_events';}
  else if(observed){decisionStatus=observed;decisionAt=events.find(e=>e[0]===observed)?.[1]||null;exclusionReason=null;}
  else if(events.length){[decisionStatus,decisionAt]=events[0];exclusionReason=null;}
  else if(applicationCompletedAt&&sourceEffectiveAt&&applicationCompletedAt<=sourceEffectiveAt){decisionStatus='pending';exclusionReason=null;}
  else {decisionStatus=/^(started|partially completed|incomplete)$/.test(status)?'incomplete':'unavailable';exclusionReason=decisionStatus==='incomplete'?'started_or_incomplete':'completion_or_effective_timestamp_missing';}
 }
 const signed=get('leaseSignedAt','leaseSignedOn','leaseSigned','leaseExecutedOn');
 // A same-row application ID + lease ID + executed timestamp is the verified join.
 const leaseJoinVerified=!!(r.applicationId&&r.leaseId&&(r.canonicalCommunityId||r.communityId)&&signed&&sourceEffectiveAt&&signed<=sourceEffectiveAt);
 return {...r,applicationStartedAt,applicationCompletedAt,decisionStatus,decisionAt,sourceEffectiveAt,periodKey:source.periodKey||source.reportPeriodKey||r.periodKey||r.reportPeriodKey||month(sourceEffectiveAt),exclusionReason,decisionEvidence:decisionAt?'dated_event':terminal.has(decisionStatus)?'snapshot_status':decisionStatus==='pending'?'completed_without_terminal':'unavailable',leaseSignedAt:leaseJoinVerified?signed:null,leaseJoinVerified};
}
function duration(r){if(!terminal.has(r.decisionStatus)||!r.decisionAt||!r.applicationStartedAt)return null;const d=(Date.parse(r.decisionAt)-Date.parse(r.applicationStartedAt))/86400000;return Number.isFinite(d)&&d>=0?d:null;}
function summarize(input=[]){const rows=input.map(r=>canonical(r)),counts={approved:0,denied:0,cancelled:0,pending:0,incomplete:0,unavailable:0},excluded={};for(const r of rows){counts[r.decisionStatus]++;if(r.exclusionReason)excluded[r.exclusionReason]=(excluded[r.exclusionReason]||0)+1;}
 const eligible=counts.approved+counts.denied+counts.cancelled+counts.pending,final=rows.filter(r=>terminal.has(r.decisionStatus)),values=final.map(duration).filter(v=>v!==null).sort((a,b)=>a-b),quantile=p=>{if(!values.length)return null;const i=(values.length-1)*p,l=Math.floor(i);return values[l]+(values[Math.ceil(i)]-values[l])*(i-l);};
 const joined=rows.filter(r=>r.decisionStatus==='approved'&&r.leaseJoinVerified&&(!r.decisionAt||r.leaseSignedAt>=r.decisionAt));
 return {population:rows.length,eligible,...counts,excluded,processing:{eligible:values.length,excluded:final.length-values.length,excludedRecords:rows.length-values.length,missingStart:final.filter(r=>!r.applicationStartedAt).length,missingDecision:final.filter(r=>!r.decisionAt).length,negativeIntervals:final.filter(r=>r.applicationStartedAt&&r.decisionAt&&r.decisionAt<r.applicationStartedAt).length,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,median:quantile(.5),p75:quantile(.75),p90:quantile(.9)},conversion:{joined:joined.length,approved:counts.approved,rate:counts.approved&&joined.length?joined.length/counts.approved:null,coverage:joined.length? 'Observed executed-lease joins / eligible approvals; missing signed timestamps excluded':'executed-lease join unavailable'}};
}
function cohort(rows,{basis='snapshot',periodKey}={}){return rows.map(r=>canonical(r)).filter(r=>basis==='snapshot'?(!periodKey||r.periodKey===periodKey):basis==='started'?month(r.applicationStartedAt)===periodKey:basis==='decision'?terminal.has(r.decisionStatus)&&month(r.decisionAt)===periodKey:false);}
function monthly(history=[],basis="snapshot"){const groups=new Map();for(let r of history.map(r=>canonical(r))){if(basis!=="snapshot"){const periodKey=month(basis==="started"?r.applicationStartedAt:r.decisionAt);if(!periodKey)continue;r={...r,periodKey};}const key=JSON.stringify([r.property||r.atlasName,r.periodKey]);if(!groups.has(key))groups.set(key,new Map());const bucket=groups.get(key),old=bucket.get(r.applicationId);if(!old||r.sourceEffectiveAt>old.sourceEffectiveAt)bucket.set(r.applicationId,r);else if(r.sourceEffectiveAt===old.sourceEffectiveAt&&JSON.stringify([r.decisionStatus,r.decisionAt,r.applicationStartedAt])!==JSON.stringify([old.decisionStatus,old.decisionAt,old.applicationStartedAt]))bucket.set(r.applicationId,{...old,applicationStatus:'',decisionStatus:'unavailable',sourceTimestamps:{},applicationStartedAt:null,decisionAt:null});}
 return [...groups].map(([k,v])=>{const [community,periodKey]=JSON.parse(k),s=summarize([...v.values()]);return {community,periodKey,basis,...s};}).sort((a,b)=>a.periodKey.localeCompare(b.periodKey)||a.community.localeCompare(b.community));}
function inventory(history=[]){const result=new Map();for(const r of history){for(const column of ['applicationStatus','leaseStatus']){const key=JSON.stringify([r.property||r.atlasName,r.periodKey||r.reportPeriodKey,r.sourceEffectiveAt||r.sourceAsOf,r.sourceFileName,r.sourceColumns?.[column]||({applicationStatus:'Application Status',leaseStatus:'Lease Status'})[column],r[column]||'(blank)']);result.set(key,(result.get(key)||0)+1);}}return [...result].map(([k,count])=>{const [community,periodKey,sourceEffectiveAt,file,column,value]=JSON.parse(k);return {community,periodKey,sourceEffectiveAt,file,column,value,count};});}
function periodConversion(row){const a=row.cells?.approvals,l=row.cells?.leases_completed;const keys=['importIdentity','sourceContract','cohortKey','periodKey','community'];const comparable=a?.value!=null&&l?.value!=null&&a.value>0&&keys.every(k=>a[k]&&a[k]===l[k]);return {community:row.community,periodKey:row.periodKey,approvals:a?.value??null,signed:l?.value??null,rate:comparable?l.value/a.value:null,label:'Box Score period lease completions / approvals',reason:comparable?'Same source contract and period activity cohort; not applicant conversion':'Matching source contract, import and cohort required'};}
return {canonical,duration,summarize,cohort,monthly,inventory,periodConversion,stamp};
});
