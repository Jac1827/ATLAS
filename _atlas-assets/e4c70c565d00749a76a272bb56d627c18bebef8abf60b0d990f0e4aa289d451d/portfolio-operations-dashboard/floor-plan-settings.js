/* Approved floor plans are the maintained reporting records; imported plans need review. */
(function(){
  const F=window.AtlasBoxScoreFloorPlans;
  window.isCommunitySettingsAdmin=()=>{
    const profile=getAtlasAccessProfile(),status=getAtlasCentralStatus();
    return status.signedIn===true&&String(profile?.status||'').toLowerCase()==='active'&&String(profile?.role||'').toLowerCase()==='admin';
  };
  window.syncApprovedBoxScoreFloorPlanRates=record=>{
    const approved=F.approvedRates(record.communityFloorPlans).filter(p=>p.boxScoreManaged);
    const names=new Set(approved.map(p=>F.norm(p.name)));
    const old=record.marketSurveyData||{};
    const retained=(old.floorPlanRates||[]).filter(r=>r.sourceSheet!=='Box Score report'&&!names.has(F.norm(r.name)));
    record.marketSurveyData=normalizeMarketSurveyData({...old,floorPlanRates:[...retained,...approved]});
  };
  window.applyBoxScoreFloorPlanRows=(name,rows)=>{
    const record=normalizeSavedCommunityRecord(name,savedData[name]);
    const before=JSON.stringify(record.communityFloorPlans);
    const mapped=rows.map(r=>({...r,name:resolveRonaldoFloorPlanName(name,r.sourcePlanCode,r)}));
    record.communityFloorPlans=F.merge(normalizeCommunityFloorPlans(record.communityFloorPlans),mapped,makeFloorPlanId);
    if(JSON.stringify(record.communityFloorPlans)===before)return;
    syncApprovedBoxScoreFloorPlanRates(record);
    const date=rows.map(r=>r.sourceAsOf).filter(Boolean).sort().at(-1);
    // Preserve historical report periods rather than applying an old file to the selected month.
    const metrics=getCommunityFloorPlanRentMetrics(record,record.marketSurveyData);
    if(date){
      const period=getWritableMonthlyPeriodEntries(record,Number(date.slice(5,7))-1,Number(date.slice(0,4)));
      for(const m of [period?.historyEntry,period?.liveEntry].filter(Boolean)){
        if(metrics.marketRent>0)m.marketRent=metrics.marketRent;
        if(metrics.budgetRent>0)m.proformaRent=metrics.budgetRent;
      }
    }
    savedData[name]=normalizeSavedCommunityRecord(name,record);
  };
  const sectionKey=section=>'atlas-floor-plan-section:'+getProp().name+':'+section;
  window.atlasFloorPlanSectionOpen=section=>{try{return sessionStorage.getItem(sectionKey(section))!=='closed';}catch{return true;}};
  window.atlasSetFloorPlanSectionOpen=(section,open)=>{try{sessionStorage.setItem(sectionKey(section),open?'open':'closed');}catch{}};
  window.atlasUnapproveFloorPlan=id=>{
    if(!isCommunitySettingsAdmin())return;
    const name=getProp().name,record=getCurrentCommunityRecord();
    record.communityFloorPlans=record.communityFloorPlans.map(p=>p.id===id?{...p,approvalStatus:'needs_review',approvedForReporting:false,approvedAt:'',approvedBy:''}:p);
    syncApprovedBoxScoreFloorPlanRates(record);syncCommunityFloorPlanRentMetrics(record,record.currentMonth);persistPortfolioSetupCommunityRecord(name,record);
  };
  window.renderApprovedFloorPlanRates=record=>{
    const rows=F.approvedRates(record.communityFloorPlans),esc=escapeHtml;
    const n=(v,currency=false)=>v==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:2,...(currency?{style:'currency',currency:'USD'}:{})}).format(v);
    return `<details id="approved-floor-plan-marketed-rates" ${atlasFloorPlanSectionOpen('approved')?'open':''} ontoggle="atlasSetFloorPlanSectionOpen('approved',this.open)" style="margin-top:14px;padding:14px;border:1px solid var(--border);border-radius:12px"><summary style="cursor:pointer;font-weight:700">Floor Plan Marketed Rates · ${rows.length} approved</summary><p style="font-size:0.75rem;color:var(--muted)">These approved selections feed reporting. Box Score imports update their rent, square footage, units and leased percentage automatically. New plans stay in Budget Setup until approved.</p><div style="overflow:auto"><table style="width:100%;min-width:900px;text-align:left;font-size:0.76rem"><thead><tr>${['Floor plan / source code','Sqft','Units','Budgeted rent','Marketed rent','Leased','Market rate source','As of',''].map(h=>`<th style="padding:8px">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(p=>`<tr>${[`${esc(p.name)}<small style="display:block;color:var(--muted)">${esc(p.sourcePlanCode||'')}</small>`,n(p.sqft),n(p.units),n(p.budgetRent,true),n(p.marketRent,true),p.leasedPct==null?'—':n(p.leasedPct)+'%',`${esc(p.sourceSheet||'Manual setup')}<small style="display:block;color:var(--muted)">${esc(p.sourceFileName||'')}</small>`,esc(p.sourceAsOf||'—'),`<button class="btn btn-gray btn-sm" onclick="atlasUnapproveFloorPlan(${esc(JSON.stringify(p.id))})">Return to review</button>`].map(v=>`<td style="padding:10px 8px;border-top:1px solid var(--border)">${v}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="9" style="padding:14px">No approved floor plans. Review and approve selections in Floor Plan Budget Setup.</td></tr>'}</tbody></table></div></details>`;
  };
})();
