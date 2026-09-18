/* Automatic, exact-community source adapters. No source records are changed. */
(function(root){
  'use strict';
  const P=root.AtlasInvestorPacket;
  const n=P.number,period=P.periodValid;
  const same=(r,name)=>r.communityName===name||r.atlasName===name||r.propertyName===name;
  const text=v=>String(v??'');
  const inMonth=(date,p)=>text(date).slice(0,7)===p;
  const source=(tab,path,file='')=>`ATLAS / ${tab} / ${path}${file?' / '+file:''}`;
  const aliases={physicalOccupancy:'physicalOccupancyPct',leasedOccupancy:'leasedOccupancyPct',forecastOccupancy:'trendingOccupancyForecast'};
  const lineageIds={occupied_units:'occupiedSnapshot',leased_units:'leasedSnapshot',new_leads:'guestCards',guest_cards:'guestCards',applications:'applications',approvals:'applicationsApproved',denied_applications:'denied',cancelled_applications:'cancelled',move_ins:'moveIns',move_outs:'moveOuts',renewals_signed:'renewalSigned',renewal_expirations:'renewalExpirations'};
  function connect({community,record={},imports={},central={},maintenance={},applications=[],budget=null,plans=[]}) {
    const out=JSON.parse(JSON.stringify(record));
    out.investorAutoByPeriod={};out.investorSourceNotes={};out.investorSegments={};out.investorSourceIssues=[];
    out.investorConnections=[];
    const put=(p,id,value,citation,definition,basis='actual')=>{
      if(!period(p)||n(value)===null)return;
      const item=((out.investorAutoByPeriod[p] ||= {})[id] ||= {});
      item[basis]={value:n(value),source:citation,definition:definition||P.metrics.find(m=>m.id===id)?.definition||id,status:'available',version:'atlas-auto-v2'};
    };
    const connected=(name,count,detail='')=>out.investorConnections.push({name,count,detail});
    if(budget?.periods){out.investorFinancialByPeriod=budget.periods;connected('Budget Builder',Object.keys(budget.periods).length,`${budget.name||community}; account detail, approved budget and saved forecast vintage`);out.investorSourceIssues.push(...(budget.issues||[]));}
    else connected('Budget Builder',0,'No exact-community saved or published budget found.');
    const history=out.monthlyHistoryByPeriod||{};
    for(const [p,m] of Object.entries(history)) {
      if(!period(p))continue;
      for(const [id,key] of Object.entries(aliases))if(Object.hasOwn(m,key))put(p,id,m[key],source('KPI / imported period snapshot',`monthlyHistoryByPeriod.${p}.${key}`));
      const closed=m.closedFinancialActuals;
      if(closed?.status==='closed'&&closed.period===p&&closed.coverage==='full_month'&&closed.source&&closed.approvedBy&&closed.approvedAt&&n(closed.netRentalIncome)!==null&&n(closed.grossPotentialRent)>0)
        put(p,'economicOccupancy',closed.netRentalIncome/closed.grossPotentialRent*100,source('Closed financial package',p,closed.source),'Closed Net Rental Income after concessions and leasing costs / GPR × 100.');
      // Verified import lineage supports actual zeros, unlike default empty fields.
      for(const l of (imports.lineage||[]).filter(l=>l.currentState&&l.communityName===community&&l.periodKey===p)){
        const id=lineageIds[l.atlasField];if(!id)continue;
        put(p,id,l.importedValue,source('Data Import / '+l.reportTypeLabel,`${p} / ${l.originalField||l.atlasField}`,l.sourceFile)+` / as of ${l.dataAsOf||p} / mapping ${l.mappingVersion||''}`);
      }
    }
    for(const [p,rows] of Object.entries(out.renewalDetailRowsByPeriod||{})){
      const stamp=out.importTracking?.renewals?.[p];if(!period(p)||!stamp?.sourceFileName||!Array.isArray(rows)||!rows.length)continue;
      const citation=source('Renewal Management',p,stamp.sourceFileName);
      const signed=rows.filter(r=>/signed|executed/i.test(r.status||'')||r.renewalSignedDate||r.leaseExecutedDate).length;
      put(p,'renewalExpirations',rows.length,citation,'Expiration cohort size from the imported renewal tracker.');
      put(p,'renewalSigned',signed,citation,'Signed/executed outcomes for this expiration cohort; not lease-signing-date activity.');
      put(p,'retention',signed/rows.length*100,citation,'Signed/executed renewals divided by the same expiration cohort × 100.');
    }
    connected('Renewal Management',Object.keys(out.renewalDetailRowsByPeriod||{}).filter(period).length,'Imported expiration cohorts; no default-zero assumption.');
    connected('KPI, traffic and leasing',Object.keys(history).filter(period).length,'Exact calendar-month snapshots; verified source zeros are retained.');
    // Use survey history, or a currently dated survey only for its own month.
    const surveys={...(out.marketSurveyHistory||{})};
    const current=out.marketSurveyData;const currentPeriod=text(current?.updatedOn||current?.uploadedAt).slice(0,7);
    if(period(currentPeriod)&&!surveys[currentPeriod]&&current?.sourceFileName)surveys[currentPeriod]=current;
    for(const [p,s] of Object.entries(surveys)){
      if(!period(p)||!s.sourceFileName)continue;
      for(const [id,k] of Object.entries({compRent:'compAverageRent',compEffectiveRent:'compAverageNer',marketRent:'subjectAskingRent'}))if(n(s[k])>0)put(p,id,s[k],source('Market Survey',`${p}.${k}`,s.sourceFileName));
      out.investorSegments[p] ||= [];
      for(const comp of s.surveyComps||[])if(!comp.isSubject)out.investorSegments[p].push({kind:'Comparable property',segment:comp.name,values:{askingRent:n(comp.rent)>0?n(comp.rent):null,effectiveRent:n(comp.ner)>0?n(comp.ner):null,leasedOccupancy:n(comp.leasedPct)>0?n(comp.leasedPct):null},source:source('Market Survey',p,s.sourceFileName)});
      if(s.compNarrative||s.pricingNotes)out.investorSourceNotes[p] ||= {drivers:[],actions:[]};
      if(s.compNarrative||s.pricingNotes)out.investorSourceNotes[p].drivers.push({id:'survey-note',metric:'marketRent',classification:'hypothesis',explanation:[s.compNarrative,s.pricingNotes].filter(Boolean).join(' '),evidence:source('Market Survey',p,s.sourceFileName),owner:record.regionalManagerName||'Marketing / Regional',action:s.recommendedApproach||'Review pricing against the comparable set.'});
    }
    connected('Market Survey / Comp Calculator',Object.keys(surveys).filter(period).length,'Dated source-backed history; leased occupancy is not relabeled as physical occupancy.');
    // Resident application exports are used as deduplicated cohorts; no personal data is exported.
    const applicationPeriods=[...new Set(applications.filter(r=>same(r,community)&&!r.duplicateReview).map(r=>r.reportPeriodKey).filter(period))];
    for(const p of applicationPeriods){
      const seen=new Set(),rows=applications.filter(r=>same(r,community)&&r.reportPeriodKey===p&&!r.duplicateReview&&r.applicationId).filter(r=>{if(seen.has(r.applicationId))return false;seen.add(r.applicationId);return true;});
      if(!rows.length)continue;
      const cite=source('Application Performance',p,[...new Set(rows.map(r=>r.sourceFileName).filter(Boolean))].join('; '));
      const started=rows.filter(r=>inMonth(r.applicationPartiallyCompletedOn,p)).length;
      if(rows.some(r=>r.applicationPartiallyCompletedOn))put(p,'applicationsStarted',started,cite,'Distinct application IDs with a partially completed application date in the selected month.');
      const channels=[...new Set(rows.map(r=>r.leadSource||'Unspecified'))];out.investorSegments[p] ||= [];
      for(const channel of channels){const cohort=rows.filter(r=>(r.leadSource||'Unspecified')===channel);const complete=cohort.filter(r=>inMonth(r.applicationCompletedOn,p)).length;const leased=cohort.filter(r=>['Lease: Completed','Lease: Approved'].includes(r.statusClassification?.status||r.applicationStatus||r.leaseStatus)).length;
        out.investorSegments[p].push({kind:'Application cohort by lead source',segment:channel,values:{applications:cohort.length,completedInMonth:complete,signedStatus:leased},source:cite+' / status as recorded in the export; not event-period net leases'});
      }
    }
    connected('Application Performance',applicationPeriods.length,'Exact reporting periods and distinct application IDs; source-channel cohorts only.');
    // Central Services is a resident-case register, not the full property cash ledger.
    const cases=(central.evictions||[]).filter(r=>r.propertyName===community&&period(r.periodKey)&&r.sourceFileName&&!r.deletedAt);
    for(const p of [...new Set(cases.map(r=>r.periodKey))]){
      const unique=new Map();cases.filter(r=>r.periodKey===p).forEach(r=>{const k=r.leaseId||r.residentId||r.id;if(k&&!unique.has(k))unique.set(k,r);});
      const rows=[...unique.values()],cite=source('Central Services / Collections',p,[...new Set(rows.map(r=>r.sourceFileName))].join('; '));
      // All balance-bearing rows must have explicit numeric data. Do not call subset payments a collection rate.
      if(rows.length&&rows.every(r=>n(r.delinquentBalance)!==null))put(p,'caseReceivables',rows.reduce((s,r)=>s+n(r.delinquentBalance),0),cite,'Outstanding balances in the imported Central Services resident-case register; reconcile coverage to the property receivables control account.');
      const filed=rows.filter(r=>inMonth(r.complaintFiledDate||r.fileDate,p));
      put(p,'evictionsFiled',filed.length,cite,'Distinct imported cases with an explicit complaint/file date in the reporting month.');
      out.investorSourceIssues.push(`${p}: Central Services is a case register. Billing, collections, aging and subsidy splits require property-wide source coverage; case payments are not substituted.`);
    }
    connected('Central Services',cases.length,'Aggregates only; resident names and contact information are excluded.');
    const db=maintenance.db||maintenance;
    for(const p of [...new Set(Object.keys(db.weeks||{}).map(k=>k.slice(0,7)).filter(period))]) {
      const dates=Object.keys(db.weeks).filter(d=>inMonth(d,p)&&((db.weeks[d].perfByProp||{})[community]||(db.weeks[d].manual||{})[community])).sort();
      if(!dates.length)continue;const day=dates.at(-1),week=db.weeks[day],perf=week.perfByProp?.[community],manual=week.manual?.[community]||{};
      const cite=source('Maintenance',`week ending ${day}`,perf?.src||(week.files||[]).map(f=>f.name||f.file).filter(Boolean).join('; '));
      put(p,'openWorkOrders',perf?.notc??manual.notComplete,cite,'Open/not-completed work orders at the latest dated weekly snapshot in the reporting month.');
      put(p,'unitsNotReady',manual.vacantNR,cite,'Vacant not-ready units at the latest dated weekly snapshot in the reporting month.');
      out.investorSourceIssues.push(`${p}: Maintenance uses the week ending ${day}; weekly completions are not presented as a complete calendar-month total.`);
    }
    connected('Maintenance',Object.keys(db.weeks||{}).length,'Exact property weekly snapshots with cutoff disclosure; no portfolio totals.');
    // Reuse period-scoped investor notes and community plans, preserving their source status.
    for(const p of new Set([...Object.keys(history),...Object.keys(out.investorAutoByPeriod)])){
      const notes=out.investorSourceNotes[p] ||= {drivers:[],actions:[]};
      const dlr=out.latestDlrSummary?.editableNotesByPeriod?.[p];
      if(dlr?.highlights)notes.performance=dlr.highlights;
      if(dlr?.wins)notes.management=dlr.wins;
      if(dlr)notes.noteSource=source('DLR owner notes',p,out.latestDlrSummary?.sourceFileName);
      for(const plan of plans.filter(r=>r.propName===community&&text(r.startedAt).slice(0,7)<=p&&(!r.closedAt||text(r.closedAt).slice(0,7)>=p))){
        for(const task of plan.tasks||[])notes.actions.push({id:'command-'+task.id,action:task.title,owner:task.assignedTo||plan.ownerName||'Owner unassigned',due:task.dueDate,status:task.status,evidence:source('Community Command',`plan ${plan.id} / task ${task.id}`)+' / current recorded status; historical status requires saved review'});
      }
    }
    return out;
  }
  function narrate(packet,record,userDraft={}){
    const d=JSON.parse(JSON.stringify(userDraft)),row=id=>packet.rows.find(r=>r.id===id),value=id=>row(id)?.cells.current.value;
    const deltaText=r=>r.mom===null?'':`; prior-month change ${P.format(r.mom,r.unit==='percent'?'number':r.unit)}${r.unit==='percent'?' percentage points':''}`;
    const cite=r=>'Metric source register: '+[r.id+'.current',r.mom===null?'':r.id+'.priorMonth',r.variance===null?'':r.id+'.budget'].filter(Boolean).join('; ');
    const auto=record.investorSourceNotes?.[packet.period]||{};
    d.drivers ||= [];d.actions ||= [];d.risks ||= [];
    for(const item of [...(auto.drivers||[]),...(record.investorFinancialByPeriod?.[packet.period]?.drivers||[])])if(!(d.suppressedSourceItems||[]).includes(item.id)&&!d.drivers.some(r=>r.id===item.id))d.drivers.push(item);
    for(const item of auto.actions||[])if(!(d.suppressedSourceItems||[]).includes(item.id)&&!d.actions.some(r=>r.id===item.id))d.actions.push(item);
    const main=['physicalOccupancy','revenue','expenses','noi'].map(row).filter(r=>r?.cells.current.value!==null&&r?.cells.current.value!==undefined);
    if(!d.performance){d.performance=auto.performance||main.map(r=>`${r.label}: ${P.format(r.cells.current.value,r.unit)}${deltaText(r)}.`).join(' ')||'No source-backed performance values are available for this community and month.';d.performanceSource=auto.performance?auto.noteSource:main.map(cite).join('; ');}
    const movements=packet.rows.filter(r=>r.material).sort((a,b)=>Math.abs(b.variance||b.mom)-Math.abs(a.variance||a.mom));
    for(const r of movements){
      const id='observed-'+r.id;
      if(!d.drivers.some(x=>x.metric===r.id)&&!(d.suppressedSourceItems||[]).includes(id))d.drivers.push({id,metric:r.id,classification:'observed',explanation:`${r.label}: ${P.format(r.cells.current.value,r.unit)}${deltaText(r)}${r.variance!==null?'; budget variance '+P.format(r.variance,r.unit==='percent'?'number':r.unit)+(r.unit==='percent'?' percentage points':''):''}. This is a measured movement; its operating cause is not yet confirmed.`,evidence:cite(r),owner:['revenue','expenses','capital','debt','returns','collections'].includes(r.group)?'Finance':record.generalManagerName||'Community management',action:'Recommended: reconcile the movement to documented operating events before final review.',question:'Which source-backed operating events explain this movement?'});
    }
    const riskMetrics=new Set(['noi','physicalOccupancy','revenue','expenses','delinquency']);
    for(const r of movements.filter(r=>riskMetrics.has(r.id))){
      const movement=r.variance??r.mom,id='metric-risk-'+r.id;
      const adverse=['expenses','delinquency'].includes(r.id)?movement>0:movement<0;
      if(adverse&&!d.risks.some(x=>x.id===id)&&!(d.suppressedSourceItems||[]).includes(id))d.risks.push({id,risk:`${r.label} ${r.variance!==null?'off budget':'deteriorated versus prior month'}`,impact:P.format(movement,r.unit==='percent'?'number':r.unit)+(r.unit==='percent'?' percentage points':''),mitigation:'Recommended: validate the driver and agree a corrective action; no management commitment inferred.',owner:['physicalOccupancy'].includes(r.id)?record.generalManagerName||'Community management':'Finance',status:'Review required',evidence:cite(r)});
    }
    const details=record.investorFinancialByPeriod?.[packet.period]?.financialDetail||[];
    const components=details.filter(r=>r.variance!==0).sort((a,b)=>Math.abs(b.variance)-Math.abs(a.variance)).slice(0,3);
    if(!d.driversSummary){d.driversSummary=components.length?'Largest account variances: '+components.map(r=>`${r.name} ${P.format(r.variance,'currency')} versus budget`).join('; ')+'. These account movements explain the arithmetic variance; operational causes require supporting evidence.':movements.slice(0,3).map(r=>`${r.label}${deltaText(r)}${r.variance!==null?`; budget variance ${P.format(r.variance,r.unit==='percent'?'number':r.unit)}${r.unit==='percent'?' percentage points':''}`:''}.`).join(' ')||'No supported material movement identified under the selected thresholds.';d.driversSummarySource=components.length?components.map(r=>r.source).join('; '):movements.slice(0,3).map(cite).join('; ');}
    if(!d.management){d.management=auto.management||d.actions.slice(0,3).map(a=>`${a.owner}: ${a.action}${a.due?' (due '+a.due+')':''}.`).join(' ')||'No period-scoped management action is recorded in the connected sources. Owner review is required.';d.managementSource=auto.management?auto.noteSource:d.actions.map(a=>a.evidence).filter(Boolean).join('; ');}
    const noi=row('noi');
    if(!d.investmentPlan){d.investmentPlan=noi?.variance!==null&&noi?.variance!==undefined?`NOI is ${P.format(Math.abs(noi.variance),'currency')} ${noi.variance>=0?'above':'below'} the monthly budget.${noi.cells.forecast.value!==null?' Full-year forecast NOI is '+P.format(noi.cells.forecast.value,'currency')+'.':''}${noi.cells.underwriting.value===null?' Underwriting and investor-return comparisons remain unavailable.':''}`:'Investment-plan status requires a comparable budget or underwriting source.';d.investmentPlanSource=noi?cite(noi)+(noi.cells.forecast.source?'; Metric source register: noi.forecast':''):'';}
    d.metricOwners={...(d.metricOwners||{})};
    for(const r of packet.rows)if(!d.metricOwners[r.id])d.metricOwners[r.id]=['revenue','expenses','capital','debt','returns','collections'].includes(r.group)?'Finance':record.generalManagerName||'Community management';
    return d;
  }
  const api={connect,narrate};root.AtlasInvestorSources=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
