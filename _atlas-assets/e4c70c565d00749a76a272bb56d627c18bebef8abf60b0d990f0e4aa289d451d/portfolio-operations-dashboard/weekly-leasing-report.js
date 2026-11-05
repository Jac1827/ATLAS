/* Shared, read-only model for Weekly Leasing Report previews and exports. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtlasWeeklyLeasing = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const day = v => { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10); };
  const money = v => v == null ? 'Not available' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v);
  const fmt = v => v == null ? 'Not available' : String(v);
  function stage(record) {
    const value=String(record.applicationStatus || '').trim().toLowerCase();
    if (/^renewal/.test(value)) return 'Renewal';
    if (/cancel/.test(value)) return 'Cancelled';
    if (/denied|rejected/.test(value)) return 'Denied';
    if (/^lease.*approved/.test(value)) return 'Lease approved';
    if (/^lease.*completed|^lease.*signed/.test(value)) return 'Lease completed';
    if (/approved/.test(value)) return 'Application approved';
    if (/partial/.test(value)) return 'Partially completed';
    if (/completed/.test(value)) return 'Completed';
    if (/started|incomplete/.test(value)) return 'Started';
    return 'Other / not supplied';
  }
  function model({records = [], communities = [], metrics = [], offers = [], end, period, generatedAt = new Date().toISOString()}) {
    const through = day(end), startDate = new Date(through + 'T12:00:00Z');
    startDate.setUTCDate(startDate.getUTCDate()-6);
    const start = day(startDate), scope = new Set(communities);
    const selected = records.filter(r=>scope.has(r.property));
    const inWeek = v => {const d=day(v);return d && d>=start && d<=through;};
    const leadDate = r => r.newLeadCreatedOn;
    const completeDate = r => r.applicationCompleted;
    const state = r => String(r.applicationStatus || '').toLowerCase();
    const pending = r => ['Started','Partially completed'].includes(stage(r));
    const overdue = r => pending(r) && day(leadDate(r)) && day(r.sourceAsOf) && (new Date(day(r.sourceAsOf))-new Date(day(leadDate(r))))/86400000>=7;
    const summarize = set => ({assigned:set.length,partial:set.filter(r=>stage(r)==='Partially completed').length,completedStatus:set.filter(r=>stage(r)==='Completed').length,approved:set.filter(r=>stage(r)==='Application approved').length,leaseApproved:set.filter(r=>stage(r)==='Lease approved').length,started:set.filter(r=>stage(r)==='Started').length,leads:set.filter(r=>inWeek(leadDate(r))).length,completed:set.filter(r=>inWeek(completeDate(r))).length,pending:set.filter(pending).length,overdue:set.filter(overdue).length,records:set.length});
    const communityRows = communities.map(name=>({name,...summarize(selected.filter(r=>r.property===name)),cells:metrics.find(r=>r.community===name)?.cells || {}}));
    const agents = [...new Set(selected.map(r=>JSON.stringify([r.property,r.leasingAgent || 'Unassigned'])))].sort().map(key=>{
      const [community,name]=JSON.parse(key);const set=selected.filter(r=>r.property===community&&(r.leasingAgent||'Unassigned')===name);
      // Status is usable independently of event-date coverage. Never substitute lease start for signing.
      const approvalDates=set.filter(r=>day(r.applicationApproved));
      const signingDates=set.filter(r=>day(r.leaseSigned));
      return {community,name,...summarize(set),approvals:approvalDates.length?approvalDates.filter(r=>inWeek(r.applicationApproved)).length:null,leases:signingDates.length?signingDates.filter(r=>inWeek(r.leaseSigned)).length:null,
        applications:set.map(r=>({id:r.applicationId,status:r.applicationStatus || 'Not supplied',stage:stage(r),partial:day(r.partialApplication),completed:day(r.applicationCompleted),approved:day(r.applicationApproved),signed:day(r.leaseSigned),asOf:day(r.sourceAsOf)}))};
    });
    const asOf=[...new Set(selected.map(r=>day(r.sourceAsOf)).filter(Boolean))].sort();
    return {title:'Weekly Leasing Report',period,start,end:through,generatedAt,communityRows,agents,offers,totals:summarize(selected),asOf,
      undatedLeads:selected.filter(r=>!day(leadDate(r))).length,undatedCompleted:selected.filter(r=>/completed/.test(state(r))&&!day(completeDate(r))).length};
  }
  function rows(data) {
    const result=[];
    const push=(section,property,metric,value,note='')=>result.push({section,property,metric,value:fmt(value),note});
    for(const r of data.communityRows) {
      for(const [key,label] of [['leads','Weekly new leads in resident snapshot'],['completed','Weekly completed applications in resident snapshot'],['pending','Open / incomplete at source cutoff'],['overdue','Open 7+ days at source cutoff']])push('Community application performance',r.name,label,r.records?r[key]:null,`${data.start} through ${data.end}; filtered resident snapshot`);
      for(const [key,c] of Object.entries(r.cells))push('Month-to-date Box Score',r.name,c.label||key,c.value,c.source);
    }
    for(const r of data.agents)for(const [key,label] of [['leads','Weekly new leads'],['completed','Weekly completed applications'],['pending','Open / incomplete'],['overdue','Open 7+ days'],['assigned','Assigned source records'],['partial','Funnel: partially completed'],['completedStatus','Funnel: completed'],['approved','Funnel: application approved'],['leaseApproved','Funnel: lease approved'],['approvals','Dated approvals this week'],['leases','Weekly signed leases']])push('Leasing professional',r.community,`${r.name} · ${label}`,r[key],'Assigned professional; snapshot attribution, not employment status');
    for(const r of data.agents) for(const a of r.applications) push('Application Funnel',r.community,`${r.name} · Application ${a.id}`,a.status,`Partial: ${a.partial||'Not supplied'}; completed: ${a.completed||'Not supplied'}; approval: ${a.approved||'Not supplied'}; signed: ${a.signed||'Not supplied'}; source data through: ${a.asOf||'Not supplied'}`);
    for(const r of data.offers) {
      push('Documented concessions',r.name,'Reported offer',r.current.offer || 'Not recorded',r.current.source);
      push('Documented concessions',r.name,'MTD completed leases',r.current.leases,'Activity alongside offer; redemption and causal effectiveness unavailable');
      push('Documented concessions',r.name,'Asking rent',r.current.asking);
      push('Documented concessions',r.name,'Net effective rent',r.current.ner);
    }
    return result;
  }
  function document(data) {
    const table=(headers,rows,attention=false)=>`<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr style="${attention&&Number(row[4])>0?'background:#e8f3f8':''}">${row.map((c,i)=>`<td style="${attention&&Number(row[4])>0&&[0,4].includes(i)?'color:#b42318;font-weight:700':''}">${esc(fmt(c))}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">No source records available for this scope.</td></tr>`}</tbody></table>`;
    const metric=(r,key)=>r.cells[key]?.value ?? null;
    const funnel = r => `${r.started} started · ${r.partial} partially completed · ${r.completedStatus} completed · ${r.approved} application approved · ${r.leaseApproved} lease approved`;
    const professionals = agents => table(['Professional','Assigned records','Application Funnel · current status','Completed this week','Open 7+ days','Dated approvals this week','Dated lease signings this week'],agents.map(r=>[r.name,r.assigned,funnel(r),r.completed,r.overdue,r.approvals,r.leases]),true) + `<div class="individuals">${agents.map(r=>`<details class="person-details"><summary>${esc(r.name)} · application status and dates (${r.assigned})</summary>${table(['Application ID','Current status','Partially completed date','Completed date','Approval date','Lease signing date','Source data through'],r.applications.map(a=>[a.id,a.status,a.partial||'Not supplied',a.completed||'Not supplied',a.approved||'Not supplied',a.signed||'Not supplied',a.asOf||'Not supplied']))}</details>`).join('')}</div>`;
    const professionalSection = data.communityRows.length>2 ? `<div class="community-tiles">${data.communityRows.map(r=>`<details class="community-details"><summary><strong>${esc(r.name)}</strong><span>${r.records ? `${r.assigned} assigned source records · ${r.partial} partially completed · ${r.approved} application approved · ${r.leaseApproved} lease approved` : "No source records available"}</span><small>Open community to view leasing professionals</small></summary>${professionals(data.agents.filter(a=>a.community===r.name))}</details>`).join('')}</div>` : data.communityRows.map(r=>`<section><h3>${esc(r.name)}</h3>${professionals(data.agents.filter(a=>a.community===r.name))}</section>`).join('');

    return `<!doctype html><html><head><meta charset="utf-8"><title>Weekly Leasing Report</title><style>
    @page{size:landscape;margin:13mm}*{box-sizing:border-box}body{font:13px/1.45 Arial,sans-serif;color:#173b4b;background:#fff;margin:0;padding:30px}header{border-bottom:4px solid #247086;padding-bottom:18px}h1{font-size:30px;margin:4px 0}h2+p{break-after:avoid}h2{font-size:19px;margin:26px 0 7px;break-after:avoid}p{margin:7px 0;color:#516571}.eyebrow{font-size:11px;letter-spacing:2px;text-transform:uppercase}.cards{display:flex;gap:14px;margin:20px 0}.card{flex:1;padding:15px;background:#eef5f7;border-top:3px solid #247086}.card strong{display:block;font-size:26px}.note{padding:12px;background:#fff6e3;border-left:3px solid #c89836}table{border-collapse:collapse;width:100%;margin:10px 0 18px;font-size:11px;table-layout:fixed}th{background:#173b4b;color:white;text-align:left}td,th{padding:8px;border-bottom:1px solid #d9e3e7;overflow-wrap:anywhere;vertical-align:top}tr{break-inside:avoid}thead{display:table-header-group}footer{margin-top:24px;border-top:1px solid #c9d7dd;padding-top:10px;font-size:10px;color:#516571}@media print{body{padding:0}.cards,.note{break-inside:avoid}h2{break-after:avoid}th,.card,tr,td{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    .community-tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px}.community-details{border:1px solid #cbdde3;border-radius:10px;padding:14px;break-inside:avoid}.community-details[open]{grid-column:1/-1;break-inside:auto}summary{cursor:pointer}summary strong,summary span,summary small{display:block;margin:4px 0}.person-details{border-top:1px solid #d9e3e7;padding:9px 0}.person-details table{table-layout:auto}.individuals{margin:12px 0}.community-details summary{color:#173b4b}@media print{.individuals{display:none}.community-details summary small{display:none}.community-details[open]{break-inside:auto}}@media(max-width:700px){.community-tiles{grid-template-columns:1fr}}
    </style></head><body><header><div class="eyebrow">ATLAS · Leasing operations</div><h1>Weekly Leasing Report</h1><p>${esc(data.start)} – ${esc(data.end)} · ${data.communityRows.length} active communities · ${esc(data.period)} month-to-date context</p></header>
    <div class="cards">${[['Weekly new leads',data.totals.records?data.totals.leads:null],['Weekly applications completed',data.totals.records?data.totals.completed:null],['Open / incomplete at source date',data.totals.records?data.totals.pending:null],['Open 7+ days at source date',data.totals.records?data.totals.overdue:null]].map(([l,v])=>`<div class="card">${esc(l)}<strong>${esc(fmt(v))}</strong></div>`).join('')}</div>
    <p class="note">Weekly counts use dated events present in the filtered Resident Data snapshot; they are not a complete historical funnel. Current workload and assigned-professional status use the source report’s data-through date (${esc(data.asOf.join(', ')||'unavailable')}). Box Score totals below are separate month-to-date activity. ${data.undatedLeads} records lack lead dates; ${data.undatedCompleted} completed-status records lack completion dates and are excluded from weekly event counts.</p>
    <h2>Application performance by community</h2><p>Compare weekly processing with published month-to-date application outcomes. Missing source values remain “Not available.”</p>
    ${table(['Community','Weekly leads','Weekly completed','Open at source date','MTD applications','MTD approved','MTD denied','MTD cancelled','MTD leases'],data.communityRows.map(r=>[r.name,r.records?r.leads:null,r.records?r.completed:null,r.records?r.pending:null,metric(r,'applications'),metric(r,'approvals'),metric(r,'denied_applications'),metric(r,'cancelled_applications'),metric(r,'leases_completed')]))}
    <h2>Month-to-date lead sources</h2><p>Five contact-source buckets. Missing values remain unavailable; totals are never assigned to Other.</p>
    ${table(['Community','Walk In','Off Site Event','Phone Calls','Emails / Online','Text / Chat / Other'],data.communityRows.map(r=>[r.name,...['walk_in','off_site_event','phone_calls','emails_online','text_chat_other'].map(key=>metric(r,key))]))}
    <h2>Application Funnel · leasing professionals</h2><p>Current statuses come directly from the Resident Data application status column. Counts cover loaded records only: a filtered export can omit approved residents, so zero loaded approvals does not establish zero actual approvals. Application approved and Lease approved are shown separately. Weekly events count only explicit dates within ${esc(data.start)}–${esc(data.end)}; a known status with no event date is still shown in the funnel. “Dated lease signings” means actual signing dates, not lease start or move-in dates. Not available means that event-date field has no usable data for this professional.</p>
    <p>${data.communityRows.length>2?'Open a community tile, then a professional, to inspect assigned application IDs, statuses and dates. Portfolio printouts keep the community summaries compact; select one or two communities for expanded professional tables.':'Professional tables are expanded for this scope. Open a professional below the table for assigned application IDs, statuses and dates.'} These are source assignments, not a current employee roster. Renewal, cancelled, denied and other records remain visible in the individual details and assigned total; the five funnel stages shown are distinct current-status counts.</p>
    ${professionalSection}
    <h2>Concessions across communities</h2>
    ${table(['Community','Documented offer','Asking rent','Effective rent','MTD applications','MTD completed leases'],data.offers.map(r=>[r.name,r.current.offer||'Not recorded',money(r.current.asking),money(r.current.ner),r.current.applications,r.current.leases]))}
    <h2>Follow-up priorities</h2><p>${data.totals.overdue} incomplete records are 7+ days old at their source cutoff. Review those assignments and document the next contact. Confirm missing offer details and application lifecycle coverage before comparing conversion performance.</p>
    <footer>Generated ${esc(data.generatedAt)} · Active, authorized report scope only. Resident snapshot dates: ${esc(data.asOf.join(', ')||'unavailable')}. Published Box Score source references are retained in CSV / Excel exports. Generated time does not imply source freshness.</footer></body></html>`;
  }
  return {model,rows,document,stage};
});
