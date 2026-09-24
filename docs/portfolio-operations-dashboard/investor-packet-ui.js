/* ATLAS Reporting Hub integration. Commentary and mappings are separate from operational data. */
var atlasInvestorPacketState = { selectedCommunity:'', communities:{} };
(function () {
  'use strict';
  const P=globalThis.AtlasInvestorPacket;
  const e=P.esc;
  function names() { return typeof getCommunityNamesByStatusScope==='function'?getCommunityNamesByStatusScope({}):Object.keys(savedData||{}); }
  function selected() { const available=names(); const wanted=atlasInvestorPacketState.selectedCommunity; return available.includes(wanted)?wanted:''; }
  function period() { return buildPeriodKey(getReportHubMonthIndex(),getReportHubYear()); }
  function scope() { const name=selected(); return atlasInvestorPacketState.communities[name]||{}; }
  function draft() { return scope().drafts?.[period()]||{}; }
  let budgetCache=null,budgetReader=null,budgetStatus='Not yet checked',budgetPending=null,budgetResolve=null,budgetTimer=null,budgetRequestScope='';
  function stored(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(error){return null;}}
  function budgetReadRequest(){const name=selected(),explicit=scope().config?.budgetCommunityName;const map=typeof APPLICATION_RESIDENT_DATA_PROPERTY_MAP==='undefined'?{}:APPLICATION_RESIDENT_DATA_PROPERTY_MAP;return {type:'atlas-investor-read-budget',year:getReportHubYear(),period:period(),names:explicit?[explicit]:[name,...Object.keys(map).filter(k=>map[k]?.atlasName===name)]};}
  function refreshSources(){
    if(typeof document==='undefined'||!selected())return;
    const requestScope=selected()+'|'+period()+'|'+(scope().config?.budgetCommunityName||'');
    if(budgetPending)return requestScope===budgetRequestScope?budgetPending:budgetPending.then(()=>refreshSources());
    budgetRequestScope=requestScope;
    budgetPending=new Promise(resolve=>{budgetResolve=resolve;});
    budgetTimer=setTimeout(()=>{budgetCache=null;budgetStatus='Financial sources did not respond; refresh to reconnect the current approved sources.';budgetResolve?.();budgetPending=null;budgetResolve=null;},15000);
    budgetStatus='Reading saved Budget Builder';
    if(!budgetReader){
      budgetReader=document.createElement('iframe');budgetReader.hidden=true;budgetReader.title='Read-only budget reporting source';
      budgetReader.src='./RISE-Budget-Builder.html?investorReader=1';
      budgetReader.onload=()=>budgetReader.contentWindow.postMessage(budgetReadRequest(),location.origin);
      document.body.appendChild(budgetReader);
    }else budgetReader.contentWindow.postMessage(budgetReadRequest(),location.origin);
    return budgetPending;
  }
  if(typeof window.addEventListener==='function'){
    window.addEventListener('message',event=>{
      if(!budgetReader||event.source!==budgetReader.contentWindow||event.origin!==location.origin||event.data?.type!=='atlas-investor-budget-sources')return;
      clearTimeout(budgetTimer);budgetResolve?.();budgetPending=null;budgetResolve=null;
      budgetCache=event.data.sources||null;budgetStatus=event.data.error?'Budget source unavailable: '+event.data.error:Object.keys(budgetCache?.properties||{}).length?'Financial sources connected':'No matching approved budget or closed financial source available';
      if(typeof reportHubType!=='undefined'&&reportHubType==='investor_community_packet')renderTab();
    });
    window.addEventListener('storage',event=>{if(event.key==='rise.budget.autosave'&&budgetReader)refreshSources();});
  }
  function budgetProperty(name,rec){
    const pool=budgetCache?.properties||(window.ATLAS_CENTRAL?{}:stored('rise.budget.autosave')?.investorPacketSources?.properties)||{};
    const explicit=atlasInvestorPacketState.communities?.[name]?.config?.budgetCommunityName;
    if(explicit)return pool[explicit]||null;
    if(pool[name])return pool[name];
    // ATLAS's existing explicit identity map, never substring or fuzzy community matching.
    const map=typeof APPLICATION_RESIDENT_DATA_PROPERTY_MAP!=='undefined'?APPLICATION_RESIDENT_DATA_PROPERTY_MAP:{};
    const matches=Object.entries(pool).filter(([sourceName])=>map[sourceName]?.atlasName===name);
    if(matches.length===1)return matches[0][1];
    return window.ATLAS_CENTRAL?null:rec.financialBudgetLedger?.investorPacketSources||null;
  }
  function record(name=selected()) {
    const raw=typeof getProp==='function'&&getProp()?.name===name&&typeof getCurrentCommunityRecord==='function'?getCurrentCommunityRecord():savedData?.[name]||{};
    const applications=typeof applicationResidentDataState==='undefined'?[]:(applicationResidentDataState.uploads||[]).filter(u=>!u.deletedAt&&u.validationStatus==='valid').sort((a,b)=>String(b.uploadedAt).localeCompare(String(a.uploadedAt))).flatMap(u=>u.records||[]);
    return globalThis.AtlasInvestorSources.connect({community:name,record:raw,budget:budgetProperty(name,raw),
      imports:typeof dataImport2State==='undefined'?{}:dataImport2State,central:stored('atlas_central_services_phase1_v2')||{},
      maintenance:stored('rise_wmr_v1')||{},applications,plans:typeof communityCommandState==='undefined'?[]:communityCommandState.performancePlans||[]});
  }
  function save(mutator) {
    const name=selected(); if(!name) return alert('Select a community first.');
    const community=atlasInvestorPacketState.communities[name] ||= {drafts:{},config:{},reviews:{}};
    community.drafts ||= {}; community.config ||= {}; community.reviews ||= {};
    community.drafts[period()] ||= {drivers:[],actions:[],risks:[]};
    mutator(community,community.drafts[period()]);
    // Changing commentary or mappings invalidates the current saved approval. Archived evidence remains available.
    community.drafts[period()].updatedAt=new Date().toISOString();
    const result=persistOpsGlobalData();
    if(result?.ok===false) alert('Could not save report settings. '+(result.message||''));
    renderTab();
  }
  function build() {
    if(!selected())return null;
    const rec=record(),args={community:selected(),period:period(),record:rec,config:scope().config||{},draft:draft(),prior:scope().reviews?.[P.shift(period(),-1)]||null};
    const first=P.build(args);args.draft=globalThis.AtlasInvestorSources.narrate(first,rec,args.draft);
    return P.build(args);
  }
  function input(label,key,value,type='text') { return `<label>${e(label)}<input type="${type}" value="${e(value||'')}" onchange="AtlasPacketUI.field('${key}',this.value)"></label>`; }
  function narrative(label,key,d) { return `<label>${e(label)}<textarea rows="3" maxlength="1800" onchange="AtlasPacketUI.field('${key}',this.value)">${e(d[key]||'')}</textarea></label>${input('Supporting source note / workbook tab / link',key+'Source',d[key+'Source'])}`; }
  function arrayEditor(kind,items,fields) {
    return `${items.map((item,i)=>`<fieldset><legend>${e(kind)} ${i+1}</legend><div class="ip-fields">${fields.map(([key,label])=>`<label>${e(label)}${key==='classification'?`<select onchange="AtlasPacketUI.row('${kind}',${i},'${key}',this.value)"><option value="observed" ${item[key]==='observed'?'selected':''}>Observed movement</option><option value="hypothesis" ${!['confirmed','observed'].includes(item[key])?'selected':''}>Hypothesis to investigate</option><option value="confirmed" ${item[key]==='confirmed'?'selected':''}>Confirmed by evidence</option></select>`:key==='metric'?`<select onchange="AtlasPacketUI.row('${kind}',${i},'${key}',this.value)"><option value="">Select metric</option>${P.metrics.map(m=>`<option value="${m.id}" ${item[key]===m.id?'selected':''}>${e(m.label)}</option>`).join('')}</select>`:`<input value="${e(item[key]||'')}" maxlength="1200" onchange="AtlasPacketUI.row('${kind}',${i},'${key}',this.value)">`}</label>`).join('')}</div><button class="btn btn-gray btn-sm" onclick="AtlasPacketUI.remove('${kind}',${i})">Remove</button></fieldset>`).join('')}<button class="btn btn-gray btn-sm" onclick="AtlasPacketUI.add('${kind}')">Add ${kind==='drivers'?'driver':kind==='risks'?'risk':kind==='projects'?'project':'action'}</button>`;
  }
  function sourcePaths(rec,prefix='',depth=0,out=[]) {
    if(depth>7||out.length>1800) return out;
    for(const [key,value] of Object.entries(rec||{})) {
      if(['investorEmailContacts','photoBank','communityTeamProfiles'].includes(key)) continue;
      const path=prefix?prefix+'.'+key:key;
      if(value&&typeof value==='object') sourcePaths(value,path,depth+1,out);
      else if(P.number(value)!==null&&/\d{4}-\d{2}/.test(path)) out.push(path.replace(/\d{4}-\d{2}/g,'{period}'));
    } return [...new Set(out)];
  }
  function render() {
    if(!budgetReader&&typeof document!=='undefined')setTimeout(refreshSources,0);
    const community=selected(), config=scope().config||{},packet=build(),d=packet?.draft||draft();
    const review=scope().reviews?.[period()];
    const status=review&&review.draft?.updatedAt===draft().updatedAt?'Saved review available':'Draft';
    let budgetNames=[];try{budgetNames=(stored('rise.budget.autosave')?.state?.properties||[]).map(p=>p.name);if(!budgetNames.length)budgetNames=Object.keys(budgetCache?.properties||{});}catch(error){}
    const metricSelect=P.metrics.map(m=>`<option value="${m.id}">${e(m.groupTitle+' / '+m.label)}</option>`).join('');
    return `<div class="card ip-builder"><div class="ip-heading"><div><h2>Investor Community Packet</h2><p>Performance. Drivers. Management action. Investment plan.</p></div><span>Investor facing · ${e(status)}</span></div>
      <div class="ip-fields"><label>Community<select onchange="AtlasPacketUI.select(this.value)"><option value="">Select a community</option>${names().map(n=>`<option ${n===community?'selected':''}>${e(n)}</option>`).join('')}</select></label><label>Reporting month<input type="month" value="${period()}" onchange="AtlasPacketUI.period(this.value)"></label></div>
      <p>Common core: 12 sections. Full comparisons, metric definitions, source references and review questions appear in appendices. Missing values remain blank; saved default zeros require verification.</p>
      ${!community?'<p>Select a community to configure, preview or export its packet.</p></div>':`
      <details open><summary>Automatic data connections</summary><p>${e(budgetStatus)}. Figures and draft summaries refresh from saved ATLAS sources. Your edits take precedence.</p><button class="btn btn-gray btn-sm" onclick="AtlasPacketUI.refresh()">Refresh connected data</button><p>${packet.rows.filter(r=>r.cells.current.value!==null).length} of ${packet.rows.length} current-period metrics available. Missing source data stays flagged, not estimated.</p><ul>${(packet.connections||[]).map(c=>`<li><b>${e(c.name)}</b>: ${c.count?'Connected':'No matching data'} · ${e(c.detail)}</li>`).join('')}</ul></details>
      <div class="ip-actions"><button class="btn btn-blue" onclick="AtlasPacketUI.export('pptx')">Export editable PowerPoint</button><button class="btn btn-gray" onclick="AtlasPacketUI.export('html')">Export editable document</button><button class="btn btn-gray" onclick="AtlasPacketUI.export('xlsx')">Export comparison workbook</button><button class="btn btn-gray" onclick="AtlasPacketUI.export('print')">Print / PDF</button><button class="btn btn-gray" onclick="AtlasPacketUI.review()">Save reviewed version</button></div>
      <details open><summary>Leadership narrative</summary><div class="ip-fields">${narrative('How is the property performing?','performance',d)}${narrative('Why is it performing that way?','driversSummary',d)}${narrative('What is management doing?','management',d)}${narrative('Is the investment on plan?','investmentPlan',d)}</div></details>
      <details><summary>Housing measures and materiality</summary><div class="ip-actions">${['student','senior','military','leaseup'].map(x=>`<label><input type="checkbox" ${(config.housingTypes||[]).includes(x)?'checked':''} onchange="AtlasPacketUI.housing('${x}',this.checked)"> ${e(x==='leaseup'?'Lease-up':x)}</label>`).join('')}</div><p>Conventional measures are included in the common core. Enable senior care metrics only where applicable.</p><div class="ip-fields">${[['materialityDollars','Dollar movement',5000],['materialityPoints','Percentage-point movement',2],['materialityCount','Unit / count movement',5]].map(([k,l,v])=>`<label>${l}<input type="number" min="0" value="${config[k]??v}" onchange="AtlasPacketUI.config('${k}',Number(this.value))"></label>`).join('')}</div></details>
      <details><summary>Drivers, evidence and root-cause questions</summary><p>Separate observed changes from explanations. Confirmed drivers need source evidence. Use segment, cohort, channel, geography or product cuts only when relevant and supported.</p>${arrayEditor('drivers',d.drivers||[],[['metric','Metric'],['classification','Evidence status'],['explanation','Explanation'],['segment','Segment / cohort / channel / geography'],['evidence','Source link / tab / note'],['owner','Accountable owner'],['action','Recommended action'],['due','Due date'],['question','Open question']])}</details>
      <details><summary>Risks, decisions, commitments and milestones</summary>${arrayEditor('risks',d.risks||[],[['risk','Risk'],['impact','Financial impact / source'],['mitigation','Mitigation'],['owner','Owner'],['due','Due date'],['status','Status'],['decision','Ownership decision required'],['evidence','Source']])}${arrayEditor('actions',d.actions||[],[['action','Action / milestone'],['owner','Owner'],['due','Due date'],['status','Status'],['evidence','Source / completion evidence']])}<button class="btn btn-gray btn-sm" onclick="AtlasPacketUI.carry()">Carry forward prior-month commitments</button><label>Project, debt and market notes<textarea rows="5" onchange="AtlasPacketUI.field('context',this.value)">${e(d.context||'')}</textarea></label><p>Include project scope, approved / committed / spent / forecast budget, original and forecast completion, achieved premium, ROI and payback; debt type, maturity, cap expiry, extensions, covenant thresholds; down-unit reasons and material market changes. Cite each source.</p></details>
      <details><summary>Budget Builder source community</summary><p>Use an exact, saved Budget Builder community. Existing ATLAS community identity links are applied automatically. Use this override only if a source has no established link. The source name remains visible in every citation.</p><label>Budget Builder community<select onchange="AtlasPacketUI.config('budgetCommunityName',this.value)"><option value="">Exact name match: ${e(community)}</option>${budgetNames.map(n=>`<option value="${e(n)}" ${config.budgetCommunityName===n?'selected':''}>${e(n)}</option>`).join('')}</select></label><p>Budget autosaves refresh the connection automatically. You can also use Refresh connected data.</p></details>
      <details><summary>Capital project register and debt terms</summary>${arrayEditor('projects',d.projects||[],[['project','Project / renovation'],['scope','Scope'],['progress','Planned / underway / completed'],['budget','Approved / committed / spent / forecast; source'],['schedule','Original / forecast completion'],['returns','Achieved premium / ROI / payback / yield on cost'],['risk','Delay / procurement / decision'],['owner','Owner'],['evidence','Source link / tab']])}${narrative('Debt type, maturity, cap expiration, extension requirements and covenant definitions / thresholds','debtTerms',d)}</details>
      <details><summary>Advanced metric definitions and source overrides</summary><label>Financial ledger basis<select onchange="AtlasPacketUI.config('ledgerBasis',this.value)"><option value="unconfirmed">Confirm ledger basis</option><option value="monthly" ${config.ledgerBasis==='monthly'?'selected':''}>Monthly actuals and budgets; positive operating income / expenses</option><option value="ytd" ${config.ledgerBasis==='ytd'?'selected':''}>YTD / mixed; use explicit mappings</option></select></label><p>Choose an existing period-specific ATLAS value. Mappings are reusable across months and do not edit source data. Saved Budget Builder values and other ATLAS tabs connect automatically. These advanced overrides are only needed when a source uses a different definition. Community identity must match the selected community. Percentages use 0–100; use a multiplier of 100 for decimal rates. Forecast mappings must refer to a full-year forecast for that reporting vintage.</p><div class="ip-fields"><label>Metric<select id="ip-map-metric" onchange="AtlasPacketUI.loadMapping()">${metricSelect}</select></label><label>Comparison<select id="ip-map-basis" onchange="AtlasPacketUI.loadMapping()">${['actual','budget','underwriting','forecast','ytdActual','ytdBudget'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>ATLAS field path<input id="ip-map-path" list="ip-paths" placeholder="monthlyHistoryByPeriod.{period}.field"><datalist id="ip-paths">${sourcePaths(record()).map(p=>`<option value="${e(p)}">`).join('')}</datalist></label><label>Multiplier<input id="ip-map-scale" type="number" value="1" step="any"></label><label>Definition and period / denominator<input id="ip-map-definition"></label><label>Source workbook tab / dashboard / note<input id="ip-map-citation"></label><label>Definition version<input id="ip-map-version" value="1"></label></div><button class="btn btn-gray" onclick="AtlasPacketUI.mapping()">Save source mapping</button><button class="btn btn-gray" onclick="AtlasPacketUI.zero()">Verify selected metric’s zero for this month</button><p>YTD flows require every month. Rates, balances and per-unit measures require their own YTD mapping. Ratios with zero denominators are unavailable.</p></details>
      <details><summary>Existing automated email cadence</summary><p>Attach this month’s saved, reviewed investor packet to this community’s existing DLR cadence. This uses the existing recipients, approval settings and send schedule. Connecting does not send an email now. The attachment is a dated, fixed reviewed version; revise and reconnect it when needed.</p><p>${scope().cadencePeriod?'Selected packet month: '+e(scope().cadencePeriod):'No investor packet selected for cadence.'}</p><button class="btn btn-gray" onclick="AtlasPacketUI.cadence(true)">Select reviewed packet for cadence</button><button class="btn btn-gray" onclick="AtlasPacketUI.cadence(false)">Remove packet from cadence selection</button><button class="btn btn-gray" onclick="AtlasPacketUI.publish()">Publish selection to existing cadence</button><p>Publication uses ATLAS’s existing signed-in DLR snapshot workflow. No schedule or recipients are changed here.</p></details>
      <details><summary>Data-quality checks and prior-review audit (${packet.issues.length} open)</summary><p>${packet.prior?'Comparing saved review '+e(packet.prior.period):'No prior-month review saved yet.'}</p><ul>${packet.issues.slice().sort((a,b)=>a.owner.localeCompare(b.owner)).map(x=>`<li><b>${e(x.owner)}</b> · ${e(x.metric)}: ${e(x.issue)}</li>`).join('')}</ul><h3>New material changes</h3>${packet.rows.filter(r=>r.material||r.definitionChanged||r.sourceChanged||r.forecastChange).map(r=>`<p>${e(r.label)} · MoM ${e(P.format(r.mom,r.unit))} · forecast revision ${e(P.format(r.forecastChange,r.unit))}${r.definitionChanged?' · definition changed':''}${r.sourceChanged?' · source changed':''}</p>`).join('')||'<p>No supported material changes identified under the selected thresholds.</p>'}</details>
      <h3>Investor packet preview</h3><iframe title="Investor packet preview" sandbox="allow-same-origin" srcdoc="${e(P.html(packet,{appendix:false}))}" style="width:100%;height:900px;border:1px solid #cedce4;background:white"></iframe></div>`}`;
  }
  function download(blob,name) { const a=document.createElement('a'); const url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  async function pptx(packet,returnBytes=false) {
    await window.AtlasFeatures?.load("pptx");
    await window.AtlasFeatures?.load("zip");
    if(typeof pptxgen==='undefined') throw new Error('PowerPoint export library did not load. Reload ATLAS and try again.');
    const deck=new pptxgen();deck.layout='LAYOUT_WIDE';deck.author='RISE';deck.subject='Investor community reporting';deck.title=`${packet.community} | ${packet.period}`;deck.company='RISE';deck.lang='en-US';
    deck.defineSlideMaster({title:'ATLAS_INVESTOR',objects:[],background:{color:'FFFFFF'}});
    const add=(title,rows,body='')=>{
      const slide=deck.addSlide('ATLAS_INVESTOR');slide.background={color:'FFFFFF'};
      slide.addText('ATLAS  |  RISE',{x:.45,y:.25,w:3,h:.25,fontSize:11,bold:true,color:'166276'});
      slide.addText(`${packet.community} · ${packet.period}${packet.partial?' · MTD / open':''}`,{x:5,y:.25,w:7.8,h:.25,fontSize:10,align:'right',color:'537383'});
      slide.addText(title,{x:.45,y:.75,w:12.3,h:.55,fontSize:25,bold:true,color:'123E52',breakLine:false});
      if(rows.length) slide.addTable([['Metric','Current','Budget','Δ / pp','Prior month'],...rows.map(r=>[r.label,P.format(r.cells.current.value,r.unit),P.format(r.cells.budget.value,r.unit),P.format(r.variance,r.unit==='percent'?'number':r.unit),P.format(r.cells.priorMonth.value,r.unit)])],{x:.45,y:1.5,w:12.3,h:3.6,colW:[4.3,2,2,2,2],fontSize:13,border:{type:'solid',pt:.4,color:'DFE7EB'},color:'123044',fill:'FFFFFF',margin:5,rowH:.35,autoPage:false,bold:false});
      if(body) slide.addText(body.slice(0,680),{x:.45,y:rows.length?5.3:1.5,w:12.3,h:rows.length?1.05:4.8,fontSize:rows.length?12:17,color:'234454',breakLine:false});
      slide.addText('Investor review · Sources and complete comparisons in appendix · — unavailable',{x:.45,y:7.1,w:12.3,h:.2,fontSize:8,color:'617B89'});
      slide.addNotes(rows.map(r=>`${r.label}: ${Object.entries(r.cells).map(([k,c])=>`${k}: ${c.source||c.reason}`).join('\n')}`).join('\n\n'));
      return slide;
    };
    const narrativeAppendix=[];
    for(const page of P.pages(packet)) {
      const text=P.notes(packet,page.kind).replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
      if(page.kind==='executive') {
        const slide=add(page.title,[]);
        for(let side=0;side<2;side++) slide.addTable([['Metric','Current','Budget','Prior mo.'],...page.rows.slice(side*9,side*9+9).map(r=>[r.label,P.format(r.cells.current.value,r.unit),P.format(r.cells.budget.value,r.unit),P.format(r.cells.priorMonth.value,r.unit)])],{x:.45+side*6.25,y:1.45,w:6.05,colW:[2.75,1.1,1.1,1.1],fontSize:10,margin:3,rowH:.34,border:{pt:.3,color:'DFE7EB'},autoPage:false});
        slide.addText(['performance','driversSummary','management','investmentPlan'].map((k,i)=>['Performance: ','Drivers: ','Management: ','Plan: '][i]+(packet.draft[k]||'Owner input required').slice(0,100)).join(' · '),{x:.45,y:6.05,w:12.3,h:.75,fontSize:10,color:'234454',valign:'top'});
        slide.addNotes(text+'\n'+page.rows.map(r=>r.label+': '+Object.entries(r.cells).map(([k,c])=>k+': '+(c.source||c.reason)).join('\n')).join('\n'));
      } else add(page.title,page.rows.slice(0,8),text);
      // Full prose is preserved in editable appendix slides; core summaries never replace owner evidence.
      if(text.length>680 || page.kind==='executive') {
        const words=text.split(/\s+/); let chunk='';
        for(const word of words){if((chunk+' '+word).length>650){narrativeAppendix.push([page.title,chunk]);chunk='';}chunk+=(chunk?' ':'')+word;}
        if(chunk)narrativeAppendix.push([page.title,chunk]);
      }
    }
    for(const [title,body] of narrativeAppendix)add('Appendix · '+title,[],body);
    // Complete comparisons remain editable native tables and are not silently omitted from the core pages.
    for(let i=0;i<packet.rows.length;i+=9) {
      const rs=packet.rows.slice(i,i+9);const s=add('Appendix · Full comparisons',[]);
      s.addTable([['Metric','Current','Budget','Δ %','Prior mo.','Prior yr.','UW','YTD act.','YTD bud.',P.forecastLabel(rs)],...rs.map(r=>[r.label,P.format(r.cells.current.value,r.unit),P.format(r.cells.budget.value,r.unit),P.format(r.variancePct,'percent'),P.format(r.cells.priorMonth.value,r.unit),P.format(r.cells.priorYear.value,r.unit),P.format(r.cells.underwriting.value,r.unit),P.format(r.cells.ytdActual.value,r.unit),P.format(r.cells.ytdBudget.value,r.unit),P.format(r.cells.forecast.value,r.unit)+(P.forecastLabel(rs)==='Forecast (basis shown)'&&r.cells.forecast.value!==null?' · '+(r.cells.forecast.forecastBasis?.kind==='monthly_active_reforecast'?'Month':r.cells.forecast.forecastBasis?.kind==='legacy_full_year'?'FY':'Unconfirmed'):'')])],{x:.45,y:1.55,w:12.3,fontSize:10,colW:[2.5,...Array(9).fill(1.08)],margin:4,border:{pt:.4,color:'DFE7EB'},autoPage:false});
      s.addNotes(rs.map(r=>`${r.label}: ${r.definition}\n${Object.entries(r.cells).map(([k,c])=>`${k}: ${c.source||c.reason}`).join('\n')}`).join('\n\n'));
    }
    const financial=packet.rows.filter(r=>['revenue','expenses','noi'].includes(r.id)&&r.cells.current.value!==null&&r.cells.budget.value!==null);
    if(financial.length) { const s=add('Financial performance against budget',[]);s.addChart(deck.ChartType.bar,[{name:'Actual',labels:financial.map(r=>r.label),values:financial.map(r=>r.cells.current.value)},{name:'Budget',labels:financial.map(r=>r.label),values:financial.map(r=>r.cells.budget.value)}],{x:.65,y:1.6,w:12,h:4.8,catAxisLabelFontSize:13,valAxisLabelFontSize:11,chartColors:['166276','9BB5C5'],showLegend:true,showValue:true});s.addNotes(financial.map(r=>r.cells.current.source+' / '+r.cells.budget.source).join('\n')); }
    const appendText=(title,lines)=>{
      let chunk='';
      for(const word of lines.join('\n\n').split(/(\s+)/)){if((chunk+word).length>650&&chunk){add(title,[],chunk);chunk='';}chunk+=word;}
      if(chunk.trim())add(title,[],chunk);
    };
    appendText('Appendix · Owner review questions',packet.issues.slice().sort((a,b)=>a.owner.localeCompare(b.owner)).map(x=>`${x.owner} · ${x.metric}: ${x.issue}`));
    appendText('Appendix · Changes since prior review',[
      `Prior saved review: ${packet.prior?.period||'Unavailable'}. Definition changes require Finance review before comparison.`,
      ...packet.rows.filter(r=>r.material||r.definitionChanged||r.sourceChanged||r.forecastChange).map(r=>`${r.label}: month change ${P.format(r.mom,r.unit)}; forecast revision ${P.format(r.forecastChange,r.unit)}. ${r.definitionChanged?'Definition changed. ':''}${r.sourceChanged?'Source changed. ':''}See this metric’s source register in slide notes.`),
      ...['new','continuing','resolved'].flatMap(k=>(packet.audit?.[k]||[]).map(x=>`${k}: ${x.owner} · ${x.metric}: ${x.issue}`)),
      ...(packet.prior?.actions||[]).map(a=>`${a.owner} · Prior commitment: ${a.action}. Prior: ${a.status}. Current: ${(packet.draft.actions||[]).find(b=>b.id===a.id)?.status||'Owner update required'}. Source: ${a.evidence||'Required'}`),
      ...(packet.prior?.risks||[]).map(a=>`${a.owner} · Prior risk: ${a.risk}. Prior: ${a.status}. Current: ${(packet.draft.risks||[]).find(b=>b.id===a.id)?.status||'Owner update required'}. Source: ${a.evidence||'Required'}`)
    ]);
    appendText('Appendix · Connected source segments',(packet.segments||[]).map(x=>`${x.kind}: ${x.segment}. ${Object.entries(x.values).filter(([,v])=>v!==null).map(([k,v])=>k+': '+v).join('; ')}. Source: ${x.source}`));
    appendText('Appendix · Pack review summary',[
      'Leadership review: executive dashboard, management actions, investment outlook and ownership decisions. Owner explanations and sources must support the narrative before distribution.',
      `Unsupported or missing inputs: ${packet.issues.length}. See owner review questions; no missing figures have been invented.`,
      'Open assumptions: financial basis, metric definitions, period cutoffs, forecast vintage, underwriting comparison and return calculations require source confirmation where unavailable.',
      packet.draft.context||'Additional project, covenant and market context needs owner input.'
    ]);
    if(typeof JSZip==='undefined') throw new Error('PowerPoint packaging library did not load. Reload ATLAS and try again.');
    const zip=await JSZip.loadAsync(await deck.write({outputType:'arraybuffer'}));
    // PptxGenJS 4 emits content-type entries for unused slide masters. Remove only
    // missing master entries; all real slides, notes, charts and editable tables stay intact.
    const types=await zip.file('[Content_Types].xml').async('string');
    zip.file('[Content_Types].xml',types.replace(/<Override\b[^>]*PartName="(\/ppt\/slideMasters\/[^"]+)"[^>]*\/>/g,(entry,name)=>zip.file(name.slice(1))?entry:''));
    const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
    if(returnBytes)return bytes;
    download(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}),`ATLAS_Investor_${packet.community.replace(/[^a-z0-9]/gi,'_')}_${packet.period}.pptx`);
  }
  async function exportPacket(kind) {
    try { await refreshSources(); const packet=build();if(!packet)return;
      const filename=`ATLAS_Investor_${packet.community.replace(/[^a-z0-9]/gi,'_')}_${packet.period}`;
      if(kind==='pptx') return await pptx(packet);
      if(kind==='html') return download(new Blob([P.html(packet,{editable:true})],{type:'text/html'}),filename+'.html');
      if(kind==='print') return printReportHtmlInHiddenFrame(P.html(packet),{title:'Investor packet'});
      if(kind==='xlsx') {
        const exportContext=window.getAtlasRenderContextKey?.();
        if(typeof XLSX==='undefined') await window.AtlasFeatures.load('xlsx');
        if(exportContext!==window.getAtlasRenderContextKey?.()) throw new Error('The selected workspace changed. Open the export again.');
        const wb=XLSX.utils.book_new();const head=['Metric','Current','Budget','Variance','Variance %','Prior month','Prior year','Underwriting','YTD actual','YTD budget',P.forecastLabel(packet.rows),'Forecast basis'];
        const rows=packet.rows.map(r=>[r.label,r.cells.current.value,r.cells.budget.value,r.variance,r.variancePct===null?null:r.variancePct/100,r.cells.priorMonth.value,r.cells.priorYear.value,r.cells.underwriting.value,r.cells.ytdActual.value,r.cells.ytdBudget.value,r.cells.forecast.value,P.forecastBasisLabel(r.cells.forecast)]);
        const ws=XLSX.utils.aoa_to_sheet([head,...rows]);ws['!cols']=[{wch:36},...Array(10).fill({wch:18}),{wch:48}];
        packet.rows.forEach((r,i)=>{const row=i+2;for(let c=1;c<=10;c++){const cell=ws[XLSX.utils.encode_cell({r:i+1,c})];if(cell)cell.z=c===4?'0.0%':r.unit==='currency'?'"$"#,##0':r.unit==='percent'?(c===3?'0.0" pp"':'0.0"%"'):r.unit==='multiple'?'0.00"x"':'#,##0.0';}if(r.cells.current.value!==null&&r.cells.budget.value!==null){ws['D'+row].f=`B${row}-C${row}`;if(r.cells.budget.value!==0)ws['E'+row].f=`D${row}/ABS(C${row})`;}});
        XLSX.utils.book_append_sheet(wb,ws,'Investor comparisons');
        const deltas=XLSX.utils.aoa_to_sheet([['Metric','MoM delta','YoY delta','Underwriting variance','YTD variance','Forecast revision'],...packet.rows.map(r=>[r.label,r.mom,r.yoy,r.underwritingVariance,r.ytdVariance,r.forecastChange])]);
        deltas['!cols']=[{wch:36},...Array(5).fill({wch:20})];XLSX.utils.book_append_sheet(wb,deltas,'Variance audit');
        const sources=packet.rows.flatMap(r=>Object.entries(r.cells).map(([basis,c])=>[r.label,basis,c.value,c.source||c.reason,r.definition]));
        const sourceSheet=XLSX.utils.aoa_to_sheet([['Metric','Basis','Value','Source / missing input','Definition'],...sources]);sourceSheet['!cols']=[{wch:32},{wch:16},{wch:20},{wch:100},{wch:70}];XLSX.utils.book_append_sheet(wb,sourceSheet,'Sources');
        XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Owner','Metric','Review question'],...packet.issues.map(x=>[x.owner,x.metric,x.issue])]),'Owner review');
        XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Source type','Segment','Measure','Value','Source'],...(packet.segments||[]).flatMap(x=>Object.entries(x.values).map(([k,v])=>[x.kind,x.segment,k,v,x.source]))]),'Source segments');
        XLSX.writeFile(wb,filename+'.xlsx');
      }
    }catch(error){alert('Investor export failed: '+error.message);}
  }
  window.AtlasPacketUI={render,build,refresh(){refreshSources();renderTab();},buildPowerPoint:packet=>pptx(packet,true),export:exportPacket,
    select(name){if(names().includes(name)||name===''){atlasInvestorPacketState.selectedCommunity=name;persistOpsGlobalData();refreshSources();renderTab();}},
    period(value){if(!P.periodValid(value))return;reportHubYear=Number(value.slice(0,4));reportHubMonth=Number(value.slice(5))-1;persistOpsGlobalData();renderTab();},
    field(key,value){save((c,d)=>{d[key]=value;});},config(key,value){save(c=>{c.config[key]=value;});if(key==='budgetCommunityName')refreshSources();},
    housing(type,yes){save(c=>{c.config.housingTypes=[...new Set([...(c.config.housingTypes||[]).filter(x=>x!==type),...(yes?[type]:[])])];});},
    add(kind){save((c,d)=>{(d[kind] ||= []).push({id:crypto.randomUUID(),classification:'hypothesis',status:'Open'});});},
    row(kind,i,key,value){const item=build()?.draft?.[kind]?.[i];if(!item)return;save((c,d)=>{d[kind] ||= [];const at=d[kind].findIndex(x=>x.id===item.id);const edited={...item,[key]:value};if(at<0)d[kind].push(edited);else d[kind][at]=edited;});},remove(kind,i){const item=build()?.draft?.[kind]?.[i];if(!item)return;save((c,d)=>{d[kind]=(d[kind]||[]).filter(x=>x.id!==item.id);d.suppressedSourceItems=[...new Set([...(d.suppressedSourceItems||[]),item.id])];});},
    carry(){save((c,d)=>{const old=c.reviews[P.shift(period(),-1)];for(const kind of ['actions','risks']){d[kind] ||= [];for(const item of old?.draft?.[kind]||[])if(!d[kind].some(x=>x.id===item.id)&&!/^complete(d)?$|^resolved$/i.test(item.status||''))d[kind].push({...item});}});},
    loadMapping(){const id=document.getElementById('ip-map-metric').value,basis=document.getElementById('ip-map-basis').value,m=scope().config?.mappings?.[id]?.[basis]||{};for(const k of ['path','scale','definition','citation','version'])document.getElementById('ip-map-'+k).value=m[k]??(['scale','version'].includes(k)?1:'');},
    mapping(){const id=document.getElementById('ip-map-metric').value,basis=document.getElementById('ip-map-basis').value;const m=Object.fromEntries(['path','scale','definition','citation','version'].map(k=>[k,document.getElementById('ip-map-'+k).value.trim()]));if(!m.path.includes('{period}')&&!m.path.includes('{year}'))return alert('Choose a period-specific source path using {period} or {year}.');if(!m.definition||!m.citation)return alert('Add the metric definition and source citation.');if(P.number(m.scale)===null)return alert('Enter a numeric multiplier.');save(c=>{c.config.mappings ||= {};c.config.mappings[id] ||= {};c.config.mappings[id][basis]=m;});},
    zero(){const id=document.getElementById('ip-map-metric').value,basis=document.getElementById('ip-map-basis').value;if(!confirm('Confirm you have checked the source and this stored zero is an actual reported result, not an empty/default field.'))return;save(c=>{c.config.verifiedZeros ||= {};c.config.verifiedZeros[period()]=[...new Set([...(c.config.verifiedZeros[period()]||[]),`${id}:${basis}`])];});},
    async review(){await refreshSources();const packet=build();if(!packet)return;if(!packet.rows.some(r=>r.cells.current.value!==null))return alert('No source-backed metrics are available. Map and review the ATLAS sources first.');if(!confirm(`Save this investor review with ${packet.issues.length} unresolved items disclosed in its appendix?`))return;const c=atlasInvestorPacketState.communities[selected()] ||= {drafts:{},config:{},reviews:{}};c.reviews ||= {};c.reviews[period()]={...packet,reviewedAt:new Date().toISOString()};persistOpsGlobalData();renderTab();},
    cadence(enable){const c=atlasInvestorPacketState.communities[selected()];if(enable&&!c?.reviews?.[period()])return alert('Save a reviewed version before selecting it for cadence.');if(!c)return;c.cadencePeriod=enable?period():'';persistOpsGlobalData();renderTab();},
    async publish(){const c=scope();if(c.cadencePeriod&&!c.reviews?.[c.cadencePeriod])return alert('Reviewed packet missing.');await publishDlrSnapshotToCentral({communityName:selected(),monthIdx:getReportHubMonthIndex(),year:getReportHubYear()});},
    deliveryPacket(community){const c=atlasInvestorPacketState.communities?.[community];return c?.cadencePeriod?c.reviews?.[c.cadencePeriod]||null:null;}
  };
})();
