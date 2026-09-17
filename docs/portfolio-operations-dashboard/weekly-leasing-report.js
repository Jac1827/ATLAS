/* Shared, read-only model for Weekly Leasing Report previews and exports. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtlasWeeklyLeasing = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const day = v => { const d = new Date(v || ''); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0,10); };
  const fmt = v => v == null ? 'Not available' : String(v);
  function model({records = [], communities = [], metrics = [], offers = [], end, period, generatedAt = new Date().toISOString()}) {
    const through = day(end), startDate = new Date(through + 'T12:00:00Z');
    startDate.setUTCDate(startDate.getUTCDate()-6);
    const start = day(startDate), scope = new Set(communities);
    const selected = records.filter(r=>scope.has(r.property));
    const inWeek = v => {const d=day(v);return d && d>=start && d<=through;};
    const leadDate = r => r.newLeadCreatedOn;
    const completeDate = r => r.applicationCompleted;
    const state = r => String(r.applicationStatus || '').toLowerCase();
    const pending = r => /started|partial|pending|incomplete/.test(state(r)) && !/cancel|denied/.test(state(r)) && !completeDate(r);
    const overdue = r => pending(r) && day(leadDate(r)) && day(r.sourceAsOf) && (new Date(day(r.sourceAsOf))-new Date(day(leadDate(r))))/86400000>=7;
    const summarize = set => ({leads:set.filter(r=>inWeek(leadDate(r))).length,completed:set.filter(r=>inWeek(completeDate(r))).length,pending:set.filter(pending).length,overdue:set.filter(overdue).length,records:set.length});
    const communityRows = communities.map(name=>({name,...summarize(selected.filter(r=>r.property===name)),cells:metrics.find(r=>r.community===name)?.cells || {}}));
    const agents = [...new Set(selected.map(r=>JSON.stringify([r.property,r.leasingAgent || 'Unassigned'])))].sort().map(key=>{
      const [community,name]=JSON.parse(key);const set=selected.filter(r=>r.property===community&&(r.leasingAgent||'Unassigned')===name);
      const lifecycle = set.length>0&&set.every(r=>r.lifecycleCoverage==='complete');
      return {community,name,...summarize(set),approvals:lifecycle?set.filter(r=>inWeek(r.applicationApproved)).length:null,leases:lifecycle?set.filter(r=>inWeek(r.leaseSigned)).length:null};
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
    for(const r of data.agents)for(const [key,label] of [['leads','Weekly new leads'],['completed','Weekly completed applications'],['pending','Open / incomplete'],['overdue','Open 7+ days'],['approvals','Weekly approvals'],['leases','Weekly signed leases']])push('Leasing professional',r.community,`${r.name} · ${label}`,r[key],'Assigned professional; snapshot attribution, not employment status');
    for(const r of data.offers) {
      push('Documented concessions',r.name,'Reported offer',r.current.offer || 'Not recorded',r.current.source);
      push('Documented concessions',r.name,'MTD completed leases',r.current.leases,'Activity alongside offer; redemption and causal effectiveness unavailable');
      push('Documented concessions',r.name,'Asking rent',r.current.asking);
      push('Documented concessions',r.name,'Net effective rent',r.current.ner);
    }
    return result;
  }
  function document(data) {
    const table=(headers,rows)=>`<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${row.map(c=>`<td>${esc(fmt(c))}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">No source records available for this scope.</td></tr>`}</tbody></table>`;
    const metric=(r,key)=>r.cells[key]?.value ?? null;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Weekly Leasing Report</title><style>
    @page{size:landscape;margin:13mm}*{box-sizing:border-box}body{font:13px/1.45 Arial,sans-serif;color:#173b4b;background:#fff;margin:0;padding:30px}header{border-bottom:4px solid #247086;padding-bottom:18px}h1{font-size:30px;margin:4px 0}h2{font-size:19px;margin:26px 0 7px;break-after:avoid}p{margin:7px 0;color:#516571}.eyebrow{font-size:11px;letter-spacing:2px;text-transform:uppercase}.cards{display:flex;gap:14px;margin:20px 0}.card{flex:1;padding:15px;background:#eef5f7;border-top:3px solid #247086}.card strong{display:block;font-size:26px}.note{padding:12px;background:#fff6e3;border-left:3px solid #c89836}table{border-collapse:collapse;width:100%;margin:10px 0 18px;font-size:11px;table-layout:fixed}th{background:#173b4b;color:white;text-align:left}td,th{padding:8px;border-bottom:1px solid #d9e3e7;overflow-wrap:anywhere;vertical-align:top}tr{break-inside:avoid}thead{display:table-header-group}footer{margin-top:24px;border-top:1px solid #c9d7dd;padding-top:10px;font-size:10px;color:#516571}@media print{body{padding:0}.cards,.note{break-inside:avoid}h2{break-after:avoid}th,.card{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body><header><div class="eyebrow">ATLAS · Leasing operations</div><h1>Weekly Leasing Report</h1><p>${esc(data.start)} – ${esc(data.end)} · ${data.communityRows.length} active communities · ${esc(data.period)} month-to-date context</p></header>
    <div class="cards">${[['Weekly new leads',data.totals.records?data.totals.leads:null],['Weekly applications completed',data.totals.records?data.totals.completed:null],['Open / incomplete at cutoff',data.totals.records?data.totals.pending:null],['Open 7+ days at cutoff',data.totals.records?data.totals.overdue:null]].map(([l,v])=>`<div class="card">${esc(l)}<strong>${esc(fmt(v))}</strong></div>`).join('')}</div>
    <p class="note">Weekly counts use dated events present in the filtered Resident Data snapshot; they are not a complete historical funnel. Current workload and assigned-professional status are measured at the source cutoff (${esc(data.asOf.join(', ')||'unavailable')}). Box Score totals below are separate month-to-date activity. ${data.undatedLeads} records lack lead dates; ${data.undatedCompleted} completed-status records lack completion dates and are excluded from weekly event counts.</p>
    <h2>Application performance by community</h2><p>Compare weekly processing with published month-to-date application outcomes. Missing source values remain “Not available.”</p>
    ${table(['Community','Weekly leads','Weekly completed','Open at cutoff','MTD applications','MTD approved','MTD denied','MTD cancelled','MTD leases'],data.communityRows.map(r=>[r.name,r.records?r.leads:null,r.records?r.completed:null,r.records?r.pending:null,metric(r,'applications'),metric(r,'approvals'),metric(r,'denied_applications'),metric(r,'cancelled_applications'),metric(r,'leases_completed')]))}
    <h2>Leasing professional status and performance</h2><p>Assigned-professional workload; attribution may change when assignments change. Approval and lease results require a complete lifecycle feed. Employment status is outside this report’s source data.</p>
    ${table(['Community','Professional','Weekly leads','Weekly completed','Open / incomplete','Open 7+ days','Weekly approved','Weekly signed'],data.agents.map(r=>[r.community,r.name,r.leads,r.completed,r.pending,r.overdue,r.approvals,r.leases]))}
    <h2>Concessions across communities</h2><p>Documented subject-community offers and leasing activity for ${esc(data.period)}. Offer exposure, redemption and cost per signed lease are unavailable, so effectiveness cannot yet be ranked reliably. These are observed results alongside offers, not evidence that an offer caused a lease.</p>
    ${table(['Community','Documented offer','Asking rent','Effective rent','MTD applications','MTD completed leases','Source'],data.offers.map(r=>[r.name,r.current.offer||'Not recorded',r.current.asking,r.current.ner,r.current.applications,r.current.leases,r.current.source]))}
    <h2>Follow-up priorities</h2><p>${data.totals.overdue} incomplete records are 7+ days old at their source cutoff. Review those assignments and document the next contact. Confirm missing offer details and application lifecycle coverage before comparing conversion performance.</p>
    <footer>Generated ${esc(data.generatedAt)} · Active, authorized report scope only. Resident snapshot dates: ${esc(data.asOf.join(', ')||'unavailable')}. Published Box Score source references are retained in CSV / Excel exports. Generated time does not imply source freshness.</footer></body></html>`;
  }
  return {model,rows,document};
});
