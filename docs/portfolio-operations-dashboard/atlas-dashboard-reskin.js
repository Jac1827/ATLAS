/* Presentation adapter for the approved ATLAS dashboard prototype. */
window.AtlasReskin = (() => {
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmtNum = n => Number(n).toLocaleString("en-US");
const esc = v => escapeHtml(String(v ?? ""));
function lineChart({ series, labels, height=150, yMin, yMax, unit="%", showAxis=true }) {
  const W = 600, H = height, P = { t:12, r:14, b: showAxis?20:6, l: showAxis?34:6 };
  const pts = series[0].data;
  const all = series.flatMap(s => s.data).filter(v => v !== null);
  const lo = yMin !== undefined ? yMin : Math.floor(Math.min(...all) - 3);
  const hi = yMax !== undefined ? yMax : Math.ceil(Math.max(...all) + 3);
  const X = i => P.l + (i / (Math.max(1, pts.length - 1))) * (W - P.l - P.r);
  const Y = v => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);

  const ticks = [lo, Math.round((lo+hi)/2), hi];
  let g = ticks.map(t => `<line class="grid-line" x1="${P.l}" y1="${Y(t).toFixed(1)}" x2="${W-P.r}" y2="${Y(t).toFixed(1)}"/>`
    + (showAxis ? `<text class="axis-text" x="${P.l-7}" y="${(Y(t)+3.5).toFixed(1)}" text-anchor="end">${t}${unit}</text>` : "")).join("");

  let body = "";
  series.forEach(s => {
    const d = s.data.map((v,i) => v===null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean);
    if (s.dashed) {
      body += `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="5 4" opacity=".85" points="${d.join(" ")}"/>`;
    } else {
      // area wash at ~10% — never a saturated block
      const first = s.data.findIndex(v=>v!==null);
      const lastI = s.data.length - 1 - [...s.data].reverse().findIndex(v=>v!==null);
      body += `<polygon fill="${s.color}" opacity=".10" points="${X(first).toFixed(1)},${(H-P.b).toFixed(1)} ${d.join(" ")} ${X(lastI).toFixed(1)},${(H-P.b).toFixed(1)}"/>`;
      body += `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${d.join(" ")}"/>`;
      // end marker: ≥8px with a 2px surface ring
      const li = lastI;
      body += `<circle cx="${X(li).toFixed(1)}" cy="${Y(s.data[li]).toFixed(1)}" r="4.5" fill="${s.color}" stroke="${css('--surface-1')}" stroke-width="2"/>`;
    }
  });

  // x labels — every other month to avoid collision
  let xl = showAxis ? labels.map((l,i) => i%2===0
    ? `<text class="axis-text" x="${X(i).toFixed(1)}" y="${H-4}" text-anchor="middle">${l}</text>` : "").join("") : "";

  // invisible hit columns for the crosshair
  let hits = pts.map((_,i) => `<rect x="${(X(i)-((W-P.l-P.r)/(Math.max(1,pts.length-1)))/2).toFixed(1)}" y="${P.t}" width="${((W-P.l-P.r)/(Math.max(1,pts.length-1))).toFixed(1)}" height="${H-P.t-P.b}" fill="transparent" data-i="${i}" class="hit"/>`).join("");

  return { svg:`<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
      ${g}<g id="cross"></g>${body}${xl}${hits}</svg>`, X, Y, W, H, P };
}

/* --- sparkline: single series, no legend (title names it) ---------------- */
function sparkline(raw, color, h=40){
  // trim trailing nulls — a sparkline should fill its box, not leave dead air
  // where future months have no data yet
  const data = raw.slice(0, raw.length - [...raw].reverse().findIndex(v=>v!==null));
  const W=220, H=h, vals=data.filter(v=>v!==null);
  const lo=Math.min(...vals), hi=Math.max(...vals);
  const X=i=>(i/(Math.max(1,data.length-1)))*W, Y=v=>H-4-((v-lo)/((hi-lo)||1))*(H-10);
  const d=data.map((v,i)=>v===null?null:`${X(i).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean);
  const li=data.length-1-[...data].reverse().findIndex(v=>v!==null);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <polygon fill="${color}" opacity=".10" points="0,${H} ${d.join(" ")} ${X(li).toFixed(1)},${H}"/>
    <polyline fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${d.join(" ")}"/>
    <circle cx="${X(li).toFixed(1)}" cy="${Y(data[li]).toFixed(1)}" r="4" fill="${color}" stroke="${css('--surface-1')}" stroke-width="2"/>
  </svg>`;
}

/* --- funnel: ORDERED categories → sequential ramp, one hue -------------- */
function funnel(stages){
  const max = Math.max(1, stages[0].value);
  return `<div style="display:grid;gap:6px;margin-top:10px">` + stages.map((s,i) => {
    const pct = (s.value/max)*100;
    const conv = i===0 ? null : Math.round((s.value/Math.max(1,stages[i-1].value))*100);
    return `<div class="fstage" data-stage="${s.stage}" data-val="${s.value}" data-conv="${conv??''}">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:11.5px;margin-bottom:3px">
        <span style="color:var(--text-secondary)">${s.stage}</span>
        <span style="color:var(--text-primary);font-weight:600;font-variant-numeric:tabular-nums">${fmtNum(s.value)}${conv!==null?` <span style="color:var(--text-muted);font-weight:400">· ${conv}%</span>`:""}</span>
      </div>
      <div style="height:14px;background:var(--color-neutral-800);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--seq-${5-i});border-radius:0 4px 4px 0"></div>
      </div>
    </div>`;
  }).join("") + `</div>`;
}

/* --- horizontal bars: ONE color for one series, value at the tip -------- */
function bars(rows, color, unit="%"){
  const max = Math.max(1,...rows.map(r=>r.v));
  return `<div style="display:grid;gap:7px;margin-top:10px">` + rows.map(r => `
    <div style="display:grid;grid-template-columns:104px 1fr auto;gap:10px;align-items:center" title="${r.name}: ${r.v}${unit}">
      <span style="font-size:11.5px;color:var(--text-secondary);overflow-wrap:anywhere">${r.name}</span>
      <div style="height:9px;background:var(--color-neutral-800);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${(r.v/max)*100}%;background:${color};border-radius:0 4px 4px 0"></div>
      </div>
      <span style="font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--text-primary);min-width:42px;text-align:right">${r.v}${unit}</span>
    </div>`).join("") + `</div>`;
}

/* --- diverging variance: warm ↔ cool, NEUTRAL gray midpoint ------------- */
function variance(rows){
  const max = Math.max(1,...rows.map(r=>Math.abs(r.v)));
  return `<div style="display:grid;gap:6px;margin-top:10px">` + rows.map(r => {
    const pct = (Math.abs(r.v)/max)*46;
    const neg = r.v < 0;
    return `<div style="display:grid;grid-template-columns:108px 1fr 52px;gap:10px;align-items:center">
      <span style="font-size:11.5px;color:var(--text-secondary);overflow-wrap:anywhere">${r.name}</span>
      <div style="position:relative;height:11px">
        <div style="position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--div-mid)"></div>
        <div style="position:absolute;top:0;height:11px;border-radius:${neg?'4px 0 0 4px':'0 4px 4px 0'};
          background:${neg?'var(--div-neg)':'var(--div-pos)'};
          ${neg?`right:50%;width:${pct}%`:`left:50%;width:${pct}%`}"></div>
      </div>
      <span style="font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right;color:var(--text-primary)">${r.v>0?'+':''}${r.v}</span>
    </div>`;
  }).join("") + `</div>`;
}

function tableView(caption, head, rows){
  return `<details class="tableview"><summary><i class="ph ph-caret-right"></i>${caption}</summary>
    <table><thead><tr>${head.map(h=>`<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;
}

const color = key => `var(--series-${({traffic_funnel:2,move_in_risk:2,renewals_retention:3,reputation_pulse:3,vendor_scorecard:3,projected_bonus:4,central_services_command_center:5,maintenance_exceptions:6})[key] || 1})`;
const arg = v => atlasDashboardJsArg(v);
const round = v => Number.isFinite(Number(v)) ? Math.round(Number(v)*10)/10 : null;
const safeTable = (head, rows) => tableView('View data table', head.map(esc), rows.map(row=>row.map(v=>esc(v ?? '—'))));
const chartTypes = new Set(['portfolio_overview','traffic_funnel','renewals_retention','reputation_pulse']);
function metricValue(instance, summary) {
  return round(atlasDashboardMetricChartValues(instance, {scopedDetails:[{summary}]})[0]);
}
let historyCache = [], historyCacheAccess = "";
let preparedHistoryRows = null, requirePreparedHistory = false;
function historyAccessKey() {
  return window.ATLAS_CENTRAL?.getAccessContextKey?.() || JSON.stringify([
    window.ATLAS_CENTRAL?.getConfig?.(), window.ATLAS_CENTRAL?.getSession?.()?.user?.id,
    typeof getAtlasAccessProfile === "function" ? getAtlasAccessProfile() : null]);
}
function historyInputs(snapshot, start, end) {
  if (typeof atlasExactPresentationInputString !== "function" || typeof atlasCommunityGoalStore === "undefined") return null;
  try {
    const access = historyAccessKey();
    if (access !== historyCacheAccess) { historyCache = []; historyCacheAccess = access; }
    const control={version:"home-history-v1",access,start,end,
      today:getAtlasTodayISODate(),properties:PROPERTIES,currentProperty:getProp().name,
      goals:[...atlasCommunityGoalStore.scopes],goalActor:atlasCommunityGoalStore.actor,
      command:communityCommandState,quarter:bonusQuarter,
      graph:localStorage.getItem("atlas_shared_property_graph_v1"),
      source:typeof atlasWorkspaceAccess==="undefined" ? null : [atlasWorkspaceAccess.source,atlasWorkspaceAccess.binding]};
    const records=(snapshot.scopedDetails||[]).map(detail=>[detail.name,detail.record]);
    // This identity memo exists only during one synchronous Home render. Every
    // later render still compares the exact serialized record and control inputs.
    const controls=atlasExactPresentationInputString(control),memo=atlasHomeRenderDetails?.get("history-inputs")||[];
    const retained=memo.find(entry=>entry.controls===controls && entry.records.length===records.length && entry.records.every((row,index)=>row[0]===records[index][0] && row[1]===records[index][1]));
    if(retained)return retained.key;
    const key=atlasExactPresentationInputString({...control,records});
    if(atlasHomeRenderDetails){memo.push({controls,records,key});atlasHomeRenderDetails.set("history-inputs",memo);}
    return key;
  } catch { return null; }
}

function historyMonthDetail(detail, month, detailsCache) {
  const cacheKey=`reskin:${detail.name}:${detail.record.reportYear}:${month}`;
  if(detailsCache?.has(cacheKey))return detailsCache.get(cacheKey);
  const build=()=>buildCommunityDetailForMonth(detail.name,detail.record,month,detail.record.reportYear,{includeRecommendations:false});
  const value=typeof withAtlasSynchronousReadScope==='function' ? withAtlasSynchronousReadScope(build) : build();
  detailsCache?.set(cacheKey,value);return value;
}
function historyMonthRow(sourceDetails, monthly, month, detailsCache) {
  const details=sourceDetails.filter(detail=>dashboardMonthlyEntryHasData(monthly.get(detail)[month])).map(detail=>historyMonthDetail(detail,month,detailsCache)).filter(Boolean);
  return {label:MONTHS[month],available:details.length>0,summary:aggregateCommunitySummaries(details.map(detail=>detail.summary))};
}

function retainHistoryRows(key, rows) {
  // Bound both scope count and retained key size; large inputs recompute safely.
  if(key !== null && key.length<=4*1024*1024) {
    historyCache.push({key,rows});
    while(historyCache.length>3 || historyCache.reduce((bytes,entry)=>bytes+entry.key.length,0)>4*1024*1024)historyCache.shift();
  }
}
function history(instance, snapshot) {
  const end=getSelectedDashboardMonthIndex(), start=Math.max(0,end-8), key=historyInputs(snapshot,start,end);
  let rows=key === null ? null : preparedHistoryRows?.get(key) || historyCache.find(entry=>entry.key===key)?.rows;
  if (!rows && requirePreparedHistory && key !== null) {
    throw Object.assign(new Error("Dashboard history needs preparation"),{code:"ATLAS_HOME_PREPARATION_REQUIRED"});
  }
  if (!rows) {
    const sourceDetails=snapshot.scopedDetails||[];
    const monthly=new Map(sourceDetails.map(detail=>[detail,getRecordMonthlyDataForYear(detail.record,detail.record.reportYear)]));
    rows=[];
    for(let month=start;month<=end;month++)rows.push(historyMonthRow(sourceDetails,monthly,month,atlasHomeRenderDetails));
    retainHistoryRows(key,rows);
    window.AtlasPerformance?.record?.("home-history-cache-miss");
  } else window.AtlasPerformance?.record?.("home-history-cache-hit");
  return {
    data: rows.map(row=>row.available ? metricValue(instance,row.summary) : null),
    budget: rows.map(row=>row.available && row.summary.budgetOccCoverage?.complete ? round(row.summary.budgetOccPct) : null),
    labels: rows.map(row=>row.label)
  };
}
async function prepareInitialHome({current=()=>true,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))}={}) {
  const readSnapshot=instance=>{
    const previous=atlasHomeRenderDetails;atlasHomeRenderDetails=new Map();
    try{const read=()=>({scopedDetails:buildAtlasDashboardScopedDetails(instance,{includeSummary:false})});return typeof withAtlasSynchronousReadScope==='function' ? withAtlasSynchronousReadScope(read) : read();}finally{atlasHomeRenderDetails=previous;}
  };
  const overview={widgetKey:'portfolio_overview',metric:'Physical Occupancy',scope:{type:'all_properties'}};
  const widgets=getAtlasDashboardViewWidgets(getAtlasActiveDashboardView()).filter(instance=>{
    const metric=instance.metric||getAtlasDashboardWidgetDefinition(instance.widgetKey)?.defaultMetric||'',viz=instance.visualization||'KPI Card';
    return chartTypes.has(instance.widgetKey) && instance.widgetKey!=='reputation_pulse' && !/Variance/.test(metric)
      && !/Ranking|Comparison|Exception/.test(viz)
      && (!['traffic_funnel','renewals_retention'].includes(instance.widgetKey)||/Trend/.test(viz));
  });
  const scopes=new Set(), prepared=new Map();
  for(const instance of [overview,...widgets]) {
    const scopeKey=atlasExactPresentationInputString(typeof normalizeAtlasDashboardScopeConfig==='function' ? normalizeAtlasDashboardScopeConfig(instance.scope) : instance.scope||{});
    if(scopes.has(scopeKey))continue;scopes.add(scopeKey);
    await yieldTask();if(!current())return false;
    const end=getSelectedDashboardMonthIndex(),start=Math.max(0,end-8),snapshot=readSnapshot(instance),key=historyInputs(snapshot,start,end);
    if(key===null)continue;
    const retained=historyCache.find(entry=>entry.key===key);
    if(retained){prepared.set(key,retained.rows);continue;}
    // Detached records keep each month on one exact input snapshot across yields.
    const sourceDetails=structuredClone(snapshot.scopedDetails||[]),detailsCache=new Map();
    const monthly=new Map(sourceDetails.map(detail=>[detail,getRecordMonthlyDataForYear(detail.record,detail.record.reportYear)])),rows=[];
    for(let month=start;month<=end;month++) {
      await yieldTask();if(!current())return false;
      const eligible=sourceDetails.filter(detail=>dashboardMonthlyEntryHasData(monthly.get(detail)[month])),details=[];
      for(let index=0;index<eligible.length;index++) {
        if(index>0 && index%3===0){await yieldTask();if(!current())return false;}
        const detail=historyMonthDetail(eligible[index],month,detailsCache);if(detail)details.push(detail);
      }
      rows.push({label:MONTHS[month],available:details.length>0,summary:aggregateCommunitySummaries(details.map(detail=>detail.summary))});
    }
    await yieldTask();if(!current())return false;
    // A later edit or source completion invalidates all prepared rows before publication.
    const fresh=readSnapshot(instance);
    if(!current() || historyInputs(fresh,start,end)!==key)return false;
    retainHistoryRows(key,rows);
    prepared.set(key,rows);
    window.AtlasPerformance?.record?.("home-history-prepared");
  }
  if(!current())return false;
  // One-use rows prevent a dashboard with several different widget scopes from
  // evicting its own preparation. Every read still compares the exact input key.
  preparedHistoryRows=prepared;
  return true;
}

window.addEventListener?.("atlas-central-auth-change",()=>{
  const next=historyAccessKey();if(next!==historyCacheAccess){historyCache=[];preparedHistoryRows=null;historyCacheAccess=next;}
});

function visual(instance,snapshot,definition={}) {
  // The reskin has no legacy collapse control: always render chart content.
  // Persisted collapsed flags must not strand saved widgets in summary-only mode.
  if(!chartTypes.has(instance.widgetKey)) return '';
  if(instance.widgetKey==='reputation_pulse' && instance.metric==='Review Volume') return '<p class="card-sub">Review count source required.</p>';
  const metric=instance.metric||definition.defaultMetric, viz=instance.visualization||'KPI Card';
  const details=snapshot.scopedDetails||[], summary=aggregateCommunitySummaries(details.map(d=>d.summary));
  const unit=/Occupancy|Conversion|Retention|->/.test(metric)?'%':'';
  const rows=details.slice(0,10).map(d=>({name:esc(d.name),v:metricValue({...instance,metric},d.summary)}));
  if(!details.length) return '<p class="card-sub">No data in this scope yet.</p>';
  // Reputation is a current snapshot, not a monthly series. Never repeat the
  // current score across past months or turn a missing score into a zero trend.
  if(instance.widgetKey==='reputation_pulse') {
    const available=rows.filter(r=>r.v>0);
    return (available.length?bars(available,color(instance.widgetKey),''):'<p class="card-sub">No reputation scores loaded.</p>')+safeTable(['Community',metric],details.slice(0,10).map((d,i)=>[d.name,rows[i].v>0?rows[i].v:'—']));
  }
  if(/Variance/.test(metric)) {
    const signed=details.map(d=>({name:esc(d.name),rawName:d.name,v:round(metric==='Occupancy Variance'? d.summary.occPct-d.summary.budgetOccPct : d.summary.currentNer-d.summary.proformaNer)}));
    return variance(signed)+safeTable(['Community',metric],signed.map(r=>[r.rawName,r.v]));
  }
  if(/Ranking|Comparison|Exception/.test(viz)) return bars(rows,color(instance.widgetKey),unit)+safeTable(['Community',metric],details.slice(0,10).map((d,i)=>[d.name,rows[i].v]));
  if(instance.widgetKey==='traffic_funnel' && !/Trend/.test(viz)) {
    const stages=[['Guest cards','guestCards'],['Tours','tours'],['Applications','applications'],['Approvals','applicationsApproved'],['Move-ins','moveIns']].map(([stage,key])=>({stage,value:Number(summary[key])||0}));
    return funnel(stages)+safeTable(['Stage','Count'],stages.map(s=>[s.stage,s.value]));
  }
  if(instance.widgetKey==='renewals_retention' && !/Trend/.test(viz)) {
    const value=summary.renewalExpirations>0?round(summary.renewalRetentionRate):null;
    const severity=value===null?'var(--text-muted)':value>=70?'var(--status-good)':value>=50?'var(--status-warn)':'var(--status-serious)';
    return `<div class="meter" style="background:color-mix(in srgb,${severity} 15%,var(--color-surface))"><span style="width:${Math.max(0,Math.min(100,value||0))}%;background:${severity}"></span></div><div class="meter-row"><span>Renewal conversion</span><span>${value===null?'No expirations loaded':value+'%'}</span></div>`+safeTable(['Signed','Expirations','Conversion'],[[summary.renewalsSigned,summary.renewalExpirations,value===null?'—':value+'%']]);
  }
  const h=history({...instance,metric},snapshot);
  if(!h.data.some(v=>v!==null)) return '<p class="card-sub">No monthly history available.</p>'+safeTable(['Community',metric],details.slice(0,10).map((d,i)=>[d.name,rows[i].v]));
  const series=[{name:metric,color:color(instance.widgetKey),data:h.data}];
  if(instance.widgetKey==='portfolio_overview' && metric==='Physical Occupancy') series.push({name:'Budget',color:color('projected_bonus'),data:h.budget,dashed:true});
  const chart=lineChart({series,labels:h.labels,unit,height:160});
  const payload=esc(JSON.stringify({series,labels:h.labels,unit}));
  return `<div class="chart-wrap" data-atlas-line="${payload}">${chart.svg}</div>`+(series.length>1?`<div class="legend">${series.map(s=>`<span class="legend-item"><span class="legend-key ${s.dashed?'is-dashed':''}" style="--key:${s.color};background:${s.dashed?'none':s.color}"></span>${esc(s.name)}</span>`).join('')}</div>`:'')+safeTable(['Month',...series.map(s=>s.name)],h.labels.map((m,i)=>[m,...series.map(s=>s.data[i]===null?'—':s.data[i]+unit)]));
}
function width(instance) { return instance.size==='compact'?4:instance.size==='expanded'?8:6; }
function card(instance,editing=false) {
  const definition=getAtlasDashboardWidgetDefinition(instance.widgetKey)||{};
  const snapshot=instance.widgetKey==='projected_bonus'?null:buildAtlasDashboardWidgetSnapshot(instance), id=arg(instance.instanceId);
  // Preserve the personal payout privacy controls and existing incentive drill-down.
  const personal=instance.widgetKey==='projected_bonus' ? renderAtlasPersonalBonusLandingWidget({extraClass:'atlas-reskin-personal-bonus'}) : '';
  const tools=editing?`<span class="grip" aria-hidden="true"><i class="ph ph-dots-six"></i></span><div class="slot-tools">
    <button class="itool" title="Move earlier" onclick="atlasDashboardMoveWidget(${id},-1)"><i class="ph ph-arrow-left"></i></button><button class="itool" title="Move later" onclick="atlasDashboardMoveWidget(${id},1)"><i class="ph ph-arrow-right"></i></button>
    <button class="itool" title="Narrower" onclick="AtlasReskin.resize(${id},-1)"><i class="ph ph-arrows-in-horizontal"></i></button><button class="itool" title="Wider" onclick="AtlasReskin.resize(${id},1)"><i class="ph ph-arrows-out-horizontal"></i></button><button class="itool" title="Configure" onclick="atlasDashboardEditWidget(${id})"><i class="ph ph-sliders-horizontal"></i></button><button class="itool danger" title="Remove" onclick="atlasDashboardRemoveWidget(${id})"><i class="ph ph-trash"></i></button></div>`:'';
  return `<article class="slot w-${width(instance)}" ${editing?`draggable="true" ondragstart="atlasDashboardDragStart(event,${id})" ondragover="atlasDashboardDragOver(event)" ondrop="atlasDashboardDrop(event,${id})"`:''}>${tools}<div class="card">
    ${personal||`<div class="card-top"><div><div class="card-kicker"><span class="swatch" style="background:${color(instance.widgetKey)}"></span>${esc(definition.category)}</div><h3 class="card-title">${esc(definition.label)}</h3></div></div><div class="card-value">${esc(snapshot.value)}</div><div class="card-sub">${esc(instance.metric||definition.defaultMetric)} · ${esc(atlasDashboardScopeLabel(instance))}</div><div class="card-sub">${esc(snapshot.sub)}</div>${visual(instance,snapshot,definition)}<button class="card-foot" onclick="atlasOpenDashboardWidget(${id})">Open ${esc(definition.label)} <i class="ph ph-arrow-right"></i></button>`}
    ${editing && atlasDashboardBuilderState.editingInstanceId===instance.instanceId?renderAtlasDashboardWidgetConfigPanel(instance):''}
    ${editing && atlasDashboardWidgetHasUnsavedChanges(instance.instanceId)?'<span class="atlas-dashboard-status-pill">Unsaved changes</span>':''}
  </div></article>`;
}
function home({preparedOnly=false}={}) {
  const previous=requirePreparedHistory;requirePreparedHistory=preparedOnly;
  try {
  const view=getAtlasActiveDashboardView(),widgets=getAtlasDashboardViewWidgets(view), status=getAtlasCentralStatus();
  const overview={widgetKey:'portfolio_overview',metric:'Physical Occupancy',scope:{type:'all_properties'}};
  const snap=buildAtlasDashboardWidgetSnapshot(overview),h=history(overview,snap);
  const name=atlasUserDisplayName(getAtlasAccessProfile()||{email:status.userEmail});
  const latest=getAtlasDashboardLatestDataUploadAt();
  return `<div class="atlas-reskin atlas-home-dashboard"><section class="hero"><div class="hero-row"><div><div class="hero-kicker">My Dashboard · ${esc(MONTHS[getSelectedDashboardMonthIndex()])}</div><h1>Welcome, ${esc(name)}.</h1><p class="hero-sub">Your portfolio at a glance. ${esc(snap.sub)}</p><div class="hero-meta"><button class="hero-pill" id="atlas-dashboard-weather" onclick="refreshAtlasDashboardWeather({force:true})">${renderAtlasDashboardWeatherPillContents()}</button><span class="hero-pill">Last upload · ${latest?esc(formatSavedTimestampLabel(new Date(latest).toISOString())):'Not recorded'}</span><span class="hero-pill">${snap.scopedDetails.length} ${snap.scopedDetails.length===1?'community':'communities'} in scope</span></div></div><div class="hero-actions"><button class="btn btn-primary" onclick="openAtlasDashboardWalkthrough()"><i class="ph ph-sliders-horizontal"></i> Build My Dashboard</button><button class="btn" onclick="setTab(2)">Full Portfolio</button></div></div><div class="hero-figure"><div><div class="hero-num-label">Physical Occupancy</div><div class="hero-num">${esc(snap.value)}</div></div><div class="hero-spark">${h.data.filter(v=>v!==null).length>1?sparkline(h.data,'#9FCBE2',54):'<p class="hero-num-sub">Monthly trend appears as history is added.</p>'}<p class="hero-num-sub">${esc(h.labels[0])}–${esc(h.labels.at(-1))} · Monthly occupancy</p></div></div></section><div class="grid-head"><div><h2>${esc(view.viewName)}</h2><p>${widgets.length} widgets · Your saved dashboard</p></div><button class="btn btn-gray" onclick="setTab(14)"><i class="ph ph-gear-six"></i> Customize</button></div><div class="wgrid">${widgets.map(w=>card(w)).join('')||'<p class="empty w-12">Add widgets in Build My Dashboard to get started.</p>'}</div></div>`;
  } finally { requirePreparedHistory=previous;preparedHistoryRows=null; }
}
function library() {
  const state=atlasDashboardBuilderState,category=state.category||'All',search=atlasNormalizeSharedText(state.search),active=new Set(getAtlasDashboardViewWidgets().map(w=>w.widgetKey));
  const widgets=ATLAS_CUSTOM_DASHBOARD_WIDGETS.filter(w=>(category==='All'||w.category===category)&&(!search||atlasNormalizeSharedText(`${w.label} ${w.category} ${w.metrics.join(' ')}`).includes(search)));
  return `<aside class="panel"><div class="panel-head"><h3>Widget library</h3><p>Add a lens on your portfolio.</p></div><div class="panel-body"><div class="search-wrap"><i class="ph ph-magnifying-glass"></i><input id="atlas-reskin-search" class="search" aria-label="Search widgets" value="${esc(state.search)}" placeholder="Search widgets…" oninput="AtlasReskin.search(this)"></div><div class="cat-row">${ATLAS_DASHBOARD_LIBRARY_CATEGORIES.map(c=>`<button class="cat ${category===c?'active':''}" aria-pressed="${category===c}" onclick="atlasDashboardSetLibraryCategory(${arg(c)})">${esc(c)}</button>`).join('')}</div>${widgets.map(w=>{const available=atlasDashboardWidgetIsAvailable(w);return `<button class="lib-item ${active.has(w.key)?'is-on':''}" onclick="atlasDashboardAddWidget(${arg(w.key)})" ${available?'':'disabled'}><span class="lib-dot" style="background:${color(w.key)}"></span><span><span class="lib-name">${esc(w.label)} ${available?'':`<span class="lib-tag phase2">Phase ${w.phase}</span>`}</span><span class="lib-desc">${esc(w.description)}</span></span><span class="lib-add"><i class="ph ph-${active.has(w.key)?'check':'plus'}"></i></span></button>`}).join('')||'<p class="empty">No widgets match.</p>'}</div></aside>`;
}
function builder() {
  const view=getAtlasActiveDashboardView(),widgets=getAtlasDashboardViewWidgets(view),dirty=Object.keys(atlasDashboardBuilderState.dirtyWidgetIds||{}).length>0;
  return `<section class="atlas-reskin atlas-dashboard-builder"><div class="grid-head"><div><h2>Build My Dashboard</h2><p>Arrange your view. Choose the metrics that matter to you.</p></div><button class="btn btn-gray" onclick="setTab(0)">Back to My Dashboard</button></div><div class="builder-bar"><label>Current View <select aria-label="Current View" onchange="atlasDashboardSelectView(this.value)">${getAtlasDashboardSavedViews().map(v=>`<option value="${esc(v.viewKey)}" ${v.viewKey===view.viewKey?'selected':''}>${esc(v.viewName)}</option>`).join('')}</select></label><span class="atlas-dashboard-status-pill" role="status">${atlasDashboardBuilderState.savingCentral?'Saving…':dirty?'Unsaved changes':'All changes saved'}</span><button class="btn btn-gray" onclick="atlasDashboardRestoreDefaultLayout()">Restore default</button><button class="btn btn-blue" onclick="AtlasReskin.publish(this)">Publish view</button></div><div class="builder-split"><div class="canvas"><div class="wgrid">${widgets.map(w=>card(w,true)).join('')||'<p class="empty w-12">Choose a widget from the library to begin.</p>'}</div></div>${library()}</div><details class="tableview"><summary>View preferences</summary>${renderAtlasDashboardViewControls()}<div class="atlas-dashboard-toolbar"><button class="btn btn-gray" onclick="atlasDashboardSaveAsNewView()">Save as new view</button><button class="btn btn-gray" onclick="atlasDashboardRenameCurrentView()">Rename view</button><button class="btn btn-gray" onclick="atlasOpenCentralServicesDashboardPreferences()">Central Services preferences</button><label>Appearance <select aria-label="Appearance" onchange="AtlasReskin.theme(this.value)"><option value="auto">System</option><option value="light" ${document.documentElement.dataset.theme==='light'?'selected':''}>Light</option><option value="dark" ${document.documentElement.dataset.theme==='dark'?'selected':''}>Dark</option></select></label></div></details></section>`;
}
async function publish(button) {
  button.disabled=true;
  persistAtlasDashboardPreferences({pushCentral:false,source:'publish_dashboard_view'});
  const status=getAtlasCentralStatus();
  if(status.configured&&status.signedIn) {
    if(!await saveAtlasDashboardPreferencesToCentral({silent:true,source:'publish_dashboard_view'})) {button.disabled=false;alert('View saved locally. Central sync failed: '+atlasDashboardPreferences.centralLastError);return;}
  }
  atlasDashboardBuilderState.dirtyWidgetIds={};
  setTab(0);
}
function resize(id,delta) {
  const w=getAtlasDashboardViewWidgets().find(w=>w.instanceId===id),sizes=['compact','standard','expanded'];
  if(w) atlasDashboardSetWidgetSize(id,sizes[Math.max(0,Math.min(2,sizes.indexOf(w.size)+delta))]);
}
function search(input) { const position=input.selectionStart;atlasDashboardSetLibrarySearch(input.value);const next=document.getElementById('atlas-reskin-search');next?.focus();next?.setSelectionRange(position,position); }
function theme(value) { if(value==='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=value;try{localStorage.setItem('atlas-dashboard-theme',value);}catch{} }
let announcements=[],news=[],tickerPromise=null,paused=false,editing=null,returnFocus=null,authGeneration=0;
const ago = value => { const ms=Date.now()-(typeof value==='number'?value:Date.parse(value));if(!Number.isFinite(ms))return '';const m=Math.max(0,Math.floor(ms/60000));return m<1?'just now':m<60?`${m}m ago`:m<1440?`${Math.floor(m/60)}h ago`:`${Math.floor(m/1440)}d ago`; };
const canPost = () => {const s=getAtlasCentralStatus();return s.signedIn&&['admin','centra','executive','regional','finance'].includes(s.role);};
const canEdit = a => {const s=getAtlasCentralStatus();return s.signedIn&&(s.role==='admin'||String(a.postedByEmail).toLowerCase()===String(s.userEmail||'').toLowerCase());};
const active = a => !a.retractedAt&&a.active!==false&&(!a.expiresAt||Date.parse(a.expiresAt)>Date.now());
const ends = a => a.expiresAt?`ends in ${Math.max(1,Math.ceil((Date.parse(a.expiresAt)-Date.now())/86400000))}d`:'until retracted';
function tickerItem(lane,text,extra={}) {
  const icons={announce:'megaphone-simple',activity:'activity',news:'newspaper'},tags={announce:'Announcement',activity:'Activity',news:'News'};
  const body=`<i class="ph ph-${icons[lane]}" aria-hidden="true"></i><span class="t-tag">${tags[lane]}</span><span>${esc(text)}</span>${extra.when?`<span class="t-when">${esc(extra.when)}</span>`:''}`;
  if(lane==='announce')return `<button class="ticker-item lane-announce" onclick="AtlasReskin.openSheet(${arg(extra.id)})">${body}</button>`;
  if(lane==='news'&&/^https?:\/\//i.test(extra.link||''))return `<a class="ticker-item lane-news" href="${esc(extra.link)}" target="_blank" rel="noopener noreferrer">${body}</a>`;
  return `<span class="ticker-item lane-${lane}">${body}</span>`;
}
function renderTicker() {
  const host=document.getElementById('atlas-ticker-track');if(!host)return;
  document.getElementById('atlas-ticker-compose').hidden=!canPost();
  const signedIn=getAtlasCentralStatus().signedIn;
  const graph=signedIn?readAtlasSharedPropertyGraph():{auditTrail:[],properties:{}};
  const authorized=new Set(signedIn?getAtlasDashboardAuthorizedCommunityOptions().map(p=>p.name):[]);
  const activity=(graph.auditTrail||[]).filter(a=>Date.parse(a.createdAt)>=Date.now()-86400000).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).filter(a=>authorized.has(graph.properties?.[a.entityId]?.displayName||a.communityName||a.entityId)).slice(0,12);
  const lanes=[signedIn?announcements.filter(active).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).map(a=>tickerItem('announce',`${a.text}${a.editedAt?' · edited':''}`,{id:a.id,when:ago(a.createdAt)})):[],activity.map(a=>tickerItem('activity',`${graph.properties?.[a.entityId]?.displayName||a.communityName||a.entityId} — ${Object.keys(a.fields||{}).join(', ')||a.action||'Record'} updated by ${a.userName||a.updatedBy||a.source||'ATLAS'}`,{when:ago(a.createdAt)})),news.filter(n=>Date.parse(n.publishedAt)>=Date.now()-72*3600000).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,6).map(n=>tickerItem('news',n.title,{link:n.link,when:n.source}))];
  const items=[];while(lanes.some(l=>l.length)){for(const i of [0,1,1,2])if(lanes[i].length)items.push(lanes[i].shift());}
  const html=items.join('')||'<span class="ticker-item">No recent updates. New announcements and headlines will appear here.</span>';
  // A duplicate is visual only: no duplicate keyboard stops or screen-reader content.
  if(host.dataset.content!==html){host.innerHTML=`<div class="ticker-copy">${html}</div><div class="ticker-copy" aria-hidden="true" inert>${html}</div>`;host.dataset.content=html;}
  host.classList.toggle('is-paused',paused||!items.length);
}
async function refreshTicker() {
  if(tickerPromise)return tickerPromise;
  const generation=authGeneration;
  tickerPromise=(async()=>{
    const api=window.ATLAS_CENTRAL;if(!api)return;
    const signedIn=getAtlasCentralStatus().signedIn;
    const results=await Promise.allSettled([api.news(),signedIn?api.announcements('list'):Promise.resolve({items:[]})]);
    if(generation!==authGeneration)return;
    if(results[0].status==='fulfilled')news=results[0].value.items||[];
    if(results[1].status==='fulfilled')announcements=results[1].value.items||[];
    else announcements=[];
    renderTicker();
  })().catch(()=>{}).finally(()=>{tickerPromise=null;});
  return tickerPromise;
}
function pause(button) {paused=!paused;document.getElementById('atlas-ticker-track').classList.toggle('is-paused',paused);button.setAttribute('aria-pressed',String(paused));button.setAttribute('aria-label',paused?'Resume updates':'Pause updates');button.innerHTML=`<i class="ph ph-${paused?'play':'pause'}"></i>`;}
function presence() {
  const host=document.getElementById('atlas-live-users');if(!host)return;
  const status=getAtlasCentralStatus();
  host.className='presence';host.tabIndex=0;
  if(!status.signedIn||atlasLivePresenceState.error){host.innerHTML=`<span class="presence-count">${status.signedIn?'Live presence unavailable':'Sign in for live presence'}</span>`;return;}
  const users=uniqueAtlasLiveUsers(atlasLivePresenceState.users||[]),email=String(status.userEmail||'').toLowerCase();
  const me=users.find(u=>String(u.email||u.user_email||'').toLowerCase()===email),others=users.filter(u=>u!==me);
  const avatar=(u,first=false)=>`<span class="avatar ${u===me?'me':''}" title="${esc(atlasUserDisplayName(u))}">${/^https?:\/\//i.test(u.avatarUrl||'')?`<img src="${esc(u.avatarUrl)}" alt="">`:esc(atlasUserInitials(u))}${first?'<span class="live"></span>':''}</span>`;
  host.innerHTML=`<span class="avatars">${others.slice(0,3).map((u,i)=>avatar(u,i===0)).join('')}${others.length>3?`<span class="avatar more">+${others.length-3}</span>`:''}${me?avatar(me,others.length===0):''}</span><span class="presence-count"><b>${users.length}</b> teammates in ATLAS</span><span class="presence-pop">${users.map(u=>`<span class="presence-row">${avatar(u)}<span><span class="presence-name">${esc(atlasUserDisplayName(u))}${u===me?' (you)':''}</span><span class="presence-where">${esc(u.current_page||'ATLAS')}</span></span><span class="presence-when">${ago(u.last_seen_at)}</span></span>`).join('')||'<span class="presence-row">Waiting for active sessions.</span>'}</span>`;
  host.removeAttribute('title');
}
function openSheet(id=null) {
  editing=id?announcements.find(a=>a.id===id):null;
  if(id&&!editing)return;if(!editing&&!canPost())return;
  returnFocus=document.activeElement;
  const editable=editing?canEdit(editing):canPost(),a=editing||{};
  const durations=[[24,'24 hours'],[72,'3 days'],[168,'1 week'],[336,'2 weeks'],[0,'Until retracted']];
  const scopes=Array.from(new Set(['All communities',...getAtlasDashboardAuthorizedCommunityOptions().map(p=>p.name),...(a.scope?[a.scope]:[])]));
  const form=document.getElementById('atlas-announcement-form');
  form.innerHTML=`<div class="sheet-head"><h3 id="atlas-sheet-title">${editing?'Edit announcement':'New announcement'}</h3><p>${editing?`${esc(a.postedBy)} · ${ago(a.createdAt)} · ${ends(a)}${a.editedAt?' · Edited':''}`:'Share an update with your teammates.'}</p></div><div class="sheet-body"><label>Announcement <textarea name="text" maxlength="280" rows="4" required ${editable?'':'readonly'}>${esc(a.text||'')}</textarea></label><label>Scope <select name="scope" ${editable?'':'disabled'}>${scopes.map(s=>`<option ${s===(a.scope||'All communities')?'selected':''}>${esc(s)}</option>`).join('')}</select></label><label>Runs for <select name="duration" ${editable?'':'disabled'}>${editing?`<option value="keep" selected>Keep current (${ends(a)})</option>`:''}${durations.map(([v,label])=>`<option value="${v}" ${!editing&&v===72?'selected':''}>${label}</option>`).join('')}</select></label><p id="atlas-sheet-error" role="alert"></p></div><div class="sheet-foot">${editing&&editable?'<button class="btn btn-gray retract" type="button" onclick="AtlasReskin.saveAnnouncement(true)">Retract</button>':''}<button class="btn btn-gray" type="button" onclick="AtlasReskin.closeSheet()">${editable?'Cancel':'Close'}</button>${editable?`<button class="btn btn-blue" type="submit">${editing?'Save':'Post announcement'}</button>`:''}</div>`;
  const dialog=document.getElementById('atlas-announcement-dialog');dialog.setAttribute('aria-labelledby','atlas-sheet-title');dialog.showModal();
}
function closeSheet() {document.getElementById('atlas-announcement-dialog').close();returnFocus?.focus();}
async function saveAnnouncement(retract=false) {
  const form=document.getElementById('atlas-announcement-form');
  if(editing?!canEdit(editing):!canPost())return;
  const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  const body=editing?{id:editing.id}:{};
  if(!retract){body.text=form.elements.text.value;body.scope=form.elements.scope.value;if(form.elements.duration.value!=='keep')body.durationHours=Number(form.elements.duration.value);}
  try { await window.ATLAS_CENTRAL.announcements(retract?'retract':editing?'edit':'post',body);if(tickerPromise)await tickerPromise;await refreshTicker();closeSheet(); }
  catch(error){document.getElementById('atlas-sheet-error').textContent=error.message;buttons.forEach(b=>b.disabled=false);}
}
function showTip(html,x,y){const tip=document.getElementById('tip');tip.innerHTML=html;tip.style.left=Math.max(130,Math.min(innerWidth-130,x))+'px';tip.style.top=Math.max(110,y)+'px';tip.classList.add('show');}
function hideTip(){document.getElementById('tip')?.classList.remove('show');}
function init() {
  try{theme(localStorage.getItem('atlas-dashboard-theme')||'auto');}catch{}
  document.addEventListener('pointerover',event=>{
    const hit=event.target.closest?.('[data-atlas-line] .hit');if(!hit)return;
    const wrap=hit.closest('[data-atlas-line]'),cfg=JSON.parse(wrap.dataset.atlasLine),i=Number(hit.dataset.i),svg=hit.closest('svg');
    const rect=hit.getBoundingClientRect();
    const x=Number(hit.getAttribute('x'))+Number(hit.getAttribute('width'))/2;
    svg.querySelector('#cross').innerHTML=`<line x1="${x}" x2="${x}" y1="12" y2="140" stroke="var(--text-muted)" opacity=".45"/>`;
    showTip(`<b>${esc(cfg.labels[i])}</b>${cfg.series.map(s=>`<div class="tip-row"><span class="tip-key" style="background:${s.color}"></span>${esc(s.name)}<span class="tip-val">${s.data[i]===null?'—':esc(s.data[i]+cfg.unit)}</span></div>`).join('')}`,rect.left+rect.width/2,rect.top);
  });
  document.addEventListener('pointerout',event=>{if(event.target.closest?.('[data-atlas-line]')){hideTip();event.target.closest('[data-atlas-line]').querySelector('#cross').innerHTML='';}});
  document.addEventListener('scroll',hideTip,true);
  window.addEventListener('atlas-central-auth-change',()=>{authGeneration++;announcements=[];renderTicker();closeSheet();void refreshTicker();});
  document.getElementById('atlas-announcement-dialog').addEventListener('close',()=>returnFocus?.focus());
  void refreshTicker();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
return {prepareInitialHome,home,card,visual,builder,library,resize,search,publish,theme,presence,refreshTicker,renderTicker,pause,openSheet,closeSheet,saveAnnouncement,history};
})();
