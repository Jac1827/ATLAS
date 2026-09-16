/* Read-only concession intelligence: exact-period surveys + published Box Score lineage. */
(function () {
  'use strict';
  const state = { period:'', community:'all', market:'all', search:'', sort:'name' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const positive = value => number(value) > 0 ? number(value) : null;
  const fmt = (value, currency=false) => value == null ? '—' : new Intl.NumberFormat('en-US',currency?{style:'currency',currency:'USD',maximumFractionDigits:0}:{maximumFractionDigits:1}).format(value);
  const shift = (period, amount) => {const [y,m]=period.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+amount,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;};
  const label = period => new Date(`${period}-01T12:00:00Z`).toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});
  function snapshot(detail,period,metrics) {
    const current=detail.record?.marketSurveyData;
    const sourcePeriod=survey=>{const d=new Date(survey?.updatedOn || '');return Number.isNaN(d.getTime())?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;};
    const historical=detail.record?.marketSurveyHistory?.[period];
    const candidate=historical || (sourcePeriod(current)===period?current:null);
    const survey=candidate && (!sourcePeriod(candidate)||sourcePeriod(candidate)===period)?candidate:null;
    const subject=survey?.surveyComps?.find(c=>c.isSubject);
    // Recommendations and market-wide specials are not evidence of an executed subject offer.
    const offer=String(subject?.concessionDetails || survey?.subjectConcessionDetails || '').trim();
    const cells=metrics.find(row=>row.community===detail.name)?.cells || {};
    const value=key=>number(cells[key]?.value);
    const applications=value('applications'),leases=value('leases_completed');
    return {period,survey,offer,asking:positive(subject?.rent ?? survey?.subjectAskingRent),ner:positive(subject?.ner ?? survey?.subjectNetEffectiveRent),
      leads:value('new_leads'),tours:value('tours'),applications,approvals:value('approvals'),denials:value('denied_applications'),cancellations:value('cancelled_applications'),leases,
      ratio:applications>0&&leases!=null?leases/applications*100:null,cells,
      source:survey?`${survey.sourceFileName || 'Saved market survey'} · ${survey.updatedOn || period}`:'No survey saved for this month'};
  }
  function model(details,period,getMetrics) {
    const periods=Array.from({length:6},(_,i)=>shift(period,i-5));
    const metrics=new Map(periods.map(p=>[p,getMetrics(p)]));
    return details.map(detail=>{
      const history=periods.map(p=>snapshot(detail,p,metrics.get(p)));
      const current=history[5],previous=history[4];
      const meta=window.getCompCalculatorScopeMeta(detail,current.survey);
      return {name:detail.name,meta,current,previous,history,delta:current.leases!=null&&previous.leases!=null?current.leases-previous.leases:null};
    });
  }
  const sourceCell=(s,key)=>`<span title="${esc(s.cells[key]?.source || 'No unique published Box Score value')}">${fmt(s[{new_leads:'leads',tours:'tours',applications:'applications',approvals:'approvals',denied_applications:'denials',cancelled_applications:'cancellations',leases_completed:'leases'}[key]])}</span>`;
  function filtered(rows) {
    const q=state.search.toLowerCase().trim();
    return rows.filter(r=>(state.community==='all'||r.name===state.community)&&(state.market==='all'||r.meta.marketArea===state.market)&&(!q||[r.name,r.meta.marketArea,r.current.offer,...(r.current.survey?.surveyComps||[]).map(c=>`${c.name} ${c.concessionDetails||''}`)].join(' ').toLowerCase().includes(q)))
      .sort((a,b)=>state.sort==='gain'?(b.delta??-Infinity)-(a.delta??-Infinity)||a.name.localeCompare(b.name):a.name.localeCompare(b.name));
  }
  const select=(title,key,options)=>`<label>${title}<select onchange="atlasConcessionFilter('${key}',this.value)">${options.map(([value,text])=>`<option value="${esc(value)}" ${state[key]===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;
  function readout(row) {
    const c=row.current,p=row.previous;
    if(!c.offer)return 'Confirm the actual special in the subject survey before judging offer performance.';
    if(row.delta===null)return 'Publish this and the prior month’s Box Scores to compare leasing pace.';
    if(!p.offer)return 'Prior-month offer is missing. Leasing movement is visible; offer comparison is incomplete.';
    if(row.delta>0)return `${row.delta} more completed leases than last month. Review offer cost, inventory and lead mix before extending the special.`;
    if(row.delta<0)return `${Math.abs(row.delta)} fewer completed leases than last month. Review demand, approvals and pricing before increasing the concession.`;
    return 'Completed leases were unchanged. Compare effective rent and application outcomes before changing the special.';
  }
  function trend(row) {
    const max=Math.max(1,...row.history.map(s=>s.leases||0));
    return `<div class="ci-trend" aria-label="Six-month completed leases for ${esc(row.name)}">${row.history.map(s=>`<div title="${esc(label(s.period)+' · '+(s.offer||'Offer not recorded'))}"><strong>${fmt(s.leases)}</strong><div class="ci-bar-track">${s.leases==null?'<span class="ci-no-bar">No data</span>':`<i style="height:${Math.max(2,s.leases/max*88)}px"></i>`}</div><small>${esc(label(s.period))}</small></div>`).join('')}</div>`;
  }
  function table(headers,rows) {return `<div class="ci-table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;}
  function card(row) {
    const c=row.current,p=row.previous,comps=(c.survey?.surveyComps||[]).filter(x=>!x.isSubject);
    const offerChanged=c.offer&&p.offer&&c.offer!==p.offer;
    const metricRows=[['New leads','new_leads'],['Tours','tours'],['Applications','applications'],['Approved','approvals'],['Denied','denied_applications'],['Cancelled','cancelled_applications'],['Completed leases','leases_completed']].map(([name,key])=>`<tr><td>${name}</td><td>${sourceCell(p,key)}</td><td>${sourceCell(c,key)}</td></tr>`);
    const compRows=[{name:row.name,rent:c.asking,ner:c.ner,concessionDetails:c.offer,isSubject:true},...(c.survey?[{name:'Market average / summary',rent:c.survey.compAverageRent,ner:c.survey.compAverageNer,concessionDetails:c.survey.marketConcessions}]:[]),...comps].map(x=>`<tr class="${x.isSubject?'ci-subject':''}"><td><strong>${esc(x.name)}</strong>${x.isSubject?'<small>Your community</small>':''}</td><td>${esc(x.concessionDetails||'Not recorded')}</td><td>${fmt(positive(x.rent),true)}</td><td>${fmt(positive(x.ner),true)}</td></tr>`);
    const observed=row.history.filter(s=>s.offer&&s.leases!=null);
    const best=observed.length>=2?observed.filter(s=>s.leases===Math.max(...observed.map(x=>x.leases))):[];
    return `<article class="ci-card"><div class="ci-card-title"><div><span class="ci-eyebrow">${esc(row.meta.marketArea)}</span><h2>${esc(row.name)}</h2></div><span class="ci-chip ${row.delta>0?'ci-up':''}">${row.delta==null?'Comparison incomplete':`${row.delta>0?'+':''}${row.delta} leases vs prior month`}</span></div>
      <div class="ci-offer"><span class="ci-eyebrow">Subject offer · ${esc(label(c.period))}</span><h3>${esc(c.offer||'Actual special not recorded')}</h3><p>${offerChanged?'Offer changed since last month':c.offer&&p.offer?'Same reported offer as last month':'Prior offer comparison unavailable'} · Prior: ${esc(p.offer||'Not recorded')}</p></div>
      <div class="ci-two"><section><h3>Specials & competitive position</h3><p class="ci-caption">Survey asking and net effective rents; confirm matching lease terms and unit mix.</p>${table(['Property','Reported special','Asking rent','Effective rent'],compRows)}${!comps.length?'<p class="ci-caption">Individual competitor rows are not available for this month.</p>':''}<p class="ci-source">Survey: ${esc(c.source)}</p></section>
      <section><h3>Leasing alongside the offer</h3><p class="ci-caption">Published Box Score activity for each reporting month.</p>${table(['Activity',esc(label(p.period)),esc(label(c.period))],metricRows)}<p class="ci-caption">Lease / application activity ratio: ${p.ratio==null?'—':fmt(p.ratio)+'%'} → ${c.ratio==null?'—':fmt(c.ratio)+'%'}. Period counts, not a matched applicant conversion rate.</p></section></div>
      <div class="ci-two"><section><h3>Six-month leasing trend</h3>${trend(row)}<p class="ci-caption">${best.length?`Highest observed lease volume: ${best.map(s=>`${esc(label(s.period))} (${fmt(s.leases)}) · ${esc(s.offer)}`).join('; ')}. Partial months and seasonality can affect this comparison.`:'More months with recorded offers and leasing activity are needed to identify a highest-volume offer period.'}</p></section><section class="ci-action"><span class="ci-eyebrow">GM & regional review</span><h3>What to review next</h3><p>${esc(readout(row))}</p><p class="ci-caption">Offer exposure, redemption, campaign dates and concession cost per signed lease are not available in this comparison. Confirm those before attributing results to a special.</p></section></div>
      <details><summary>Monthly offer history & source detail</summary>${table(['Month','Subject special','Applications','Leases','Survey source'],row.history.slice().reverse().map(s=>`<tr><td>${esc(label(s.period))}</td><td>${esc(s.offer||'Not recorded')}</td><td>${sourceCell(s,'applications')}</td><td>${sourceCell(s,'leases_completed')}</td><td>${esc(s.source)}</td></tr>`))}<div class="ci-sources">${[p,c].map(s=>`<h4>${esc(label(s.period))} · Box Score sources</h4><ul>${Object.entries(s.cells).map(([key,cell])=>`<li>${esc(cell.label||key)}: ${esc(cell.source)}</li>`).join('')||'<li>No published source available.</li>'}</ul>`).join('')}</div></details></article>`;
  }
  function render() {
    const period=state.period || (window.getSelectedDashboardPeriodKey?.() || window.getApplicationResidentReportPeriodKey());
    const month=Number(period.slice(5))-1;
    const details=window.getWorkspaceScopedDetails(month).filter(d=>typeof window.isAtlasLeaseTrackingCommunity!=='function'||window.isAtlasLeaseTrackingCommunity(d.name,d.record));
    const all=model(details,period,p=>window.getAtlasApplicationPeriodMetrics(p,'all'));
    const rows=filtered(all),withOffer=rows.filter(r=>r.current.offer),comparable=rows.filter(r=>r.delta!=null),improved=comparable.filter(r=>r.delta>0);
    const markets=[...new Set(all.map(r=>r.meta.marketArea))].sort();
    return `<div class="ci-shell"><header class="ci-hero"><span class="ci-eyebrow">ATLAS · Marketing intelligence</span><h1>Concessions & competition</h1><p>See the special. Compare the market. Understand the leasing response.</p><div class="ci-hero-foot">A quick decision guide for general managers and regionals <span>${esc(label(period))}</span></div></header>
      <div class="ci-filters"><label>Reporting month<input type="month" value="${esc(period)}" onchange="atlasConcessionFilter('period',this.value)"></label>${select('Community','community',[['all','All in current scope'],...all.map(r=>[r.name,r.name])])}${select('Market','market',[['all','All markets'],...markets.map(m=>[m,m])])}<label>Find a comp or special<input type="search" placeholder="Property, free rent, gift card…" value="${esc(state.search)}" onchange="atlasConcessionFilter('search',this.value)"></label>${select('Order by','sort',[['name','Community name'],['gain','Lease change']])}<button class="btn btn-gray" onclick="atlasConcessionReset()">Reset</button></div>
      <div class="ci-kpis">${[['Communities in view',rows.length,'Within your current access and scope'],['Recorded subject offers',withOffer.length,'Exact-month survey evidence'],['Leasing increased',improved.length,`Of ${comparable.length} with both months available`],['Offer history available',rows.filter(r=>r.history.filter(s=>s.offer).length>=2).length,'At least two months with recorded specials']].map(([title,value,detail])=>`<div><span>${title}</span><strong>${value}</strong><small>${detail}</small></div>`).join('')}</div>
      <p class="ci-note">Compare results observed during each special. Timing, inventory, seasonality and lead mix also affect leasing. Missing data is shown as —; saved recommendations are not treated as active offers.</p>
      ${rows.map(card).join('')||'<div class="ci-card ci-empty">No communities match these filters. Try another community, market or search.</div>'}</div>`;
  }
  window.AtlasConcessionInsights={model,snapshot,shift,filtered,render};
  window.atlasConcessionFilter=(key,value)=>{if(!Object.hasOwn(state,key))return;if(key==='period'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))return;state[key]=value;window.renderTab();};
  window.atlasConcessionReset=()=>{Object.assign(state,{period:'',community:'all',market:'all',search:'',sort:'name'});window.renderTab();};
})();
