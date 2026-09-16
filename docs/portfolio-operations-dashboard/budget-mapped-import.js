/* Mapped workbook intake and versioned, exact-community/year approved baselines. */
(function () {
  'use strict';
  const R=window.RBB, M=R.importer, A=R.app, months='jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  M.SCHEMAS.approved_budget={label:'Approved budget — complete annual baseline',required:['property','gl','year','effective_date'],monthly:true,optional:['gl_name','annual'],note:'Complete approved calendar-year GL budget, signed amounts (income positive, losses negative). Explicit zeros required. Newer effective dates replace the entire community/year baseline; older versions remain in history. Fiscal-year workbooks require calendar-period mapping first.'};
  M.addCatalogProperties=function(state,names){
    for(const name of names){
      if(typeof name!=='string'||!name.trim())continue;
      const canonical=name.trim(), norm=s=>s.replace(/^RISE\s+/i,'').toLowerCase();
      if(state.properties.some(p=>norm(p.name)===norm(canonical)))continue;
      state.properties.push({id:'atlas-'+encodeURIComponent(canonical),code:canonical,name:canonical,entity:canonical,market:'',zip:'',units:[],totalUnits:0,occupancy:{},occupancyByYear:{},economicOccupancy:{},str:{enabled:false},recovery:{},fiscalYearBegins:'Jan',notes:'ATLAS community. Operating assumptions must be supplied separately.',source:'ATLAS community catalog',budgetImportOnly:true});
    }
  };
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.origin!==window.location.origin||event.data?.type!=='atlas-budget-catalog')return;
    M.addCatalogProperties(A.state,event.data.names||[]);A.invalidate();A.render();
  });
  if(window.parent!==window)window.parent.postMessage({type:'atlas-budget-catalog-request'},window.location.origin);
  const validate=M.validate;
  M.validate=function(type,rows,state){
    const v=validate(type,rows,state);
    if(type!=='approved_budget')return v;
    const fail=message=>v.errors.push({rule:'approved_baseline',message});
    const seen=new Set(), dates={};
    for(const r of v.accepted){
      const pid=M.resolveProperty(r.property,state),key=pid+'|'+r.year,gl=key+'|'+r.gl;
      if(!/^\d{4}$/.test(r.year))fail('An explicit calendar year is required.');
      const date=M.parseDate(r.effective_date);
      if(!date||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail('A valid effective_date is required.');
      if(dates[key]&&dates[key]!==date)fail('Use one effective date per community/year.');
      dates[key]=date;
      if(seen.has(gl))fail('Duplicate GL '+gl+'. Consolidate to one row per account.');seen.add(gl);
      if(r.__monthly.some(n=>!Number.isFinite(n)))fail('Monthly amounts must be finite numbers.');
      if(date&&date>new Date().toISOString().slice(0,10))fail('Effective date cannot be in the future.');
      if(months.some(m=>r[m]===''||r[m]===undefined))fail('All twelve months need an amount, including explicit zeros.');
      const prop=state.properties.find(p=>p.id===pid);
      if(prop?.fiscalYearBegins&&prop.fiscalYearBegins!=='Jan')fail('Fiscal-year property requires explicit calendar-period mapping before publication.');
    }
    if(v.warnings.some(w=>w.rule==='annual_tie'))fail('Annual totals must reconcile before publication.');
    v.status=v.errors.length?'rejected':'accepted';return v;
  };
  M.mappedSheets=function(read,type){
    return read.sheets.map(sheet=>{
      const header=sheet.rows.findIndex(row=>M.SCHEMAS[type].required.every(c=>row.map(M.norm).includes(c)));
      return {name:sheet.name,header,rows:header<0?sheet.rows:sheet.rows.slice(header)};
    });
  };
  A.selectMappedSheet=function(index){
    const intake=A.mappedWorkbook,sheet=intake.sheets[Number(index)];if(!sheet)return;
    const v=M.validate(intake.type,sheet.rows,A.state);
    v.fileName=intake.name;v.sheetName=sheet.name;v.headerRow=sheet.header+1;
    A.lastImport=v;A.view='imports';A.render();
  };
  A.handleFile=function(input,type){
    const file=input.files?.[0];if(!file)return;
    const reader=new FileReader();
    reader.onerror=()=>A.toast('Unable to read the selected file.','r');
    reader.onload=()=>{
      try{
        const sheets=M.mappedSheets(R.xlsx.read(new Uint8Array(reader.result)),type);
        if(!sheets.length)throw Error('No readable worksheets.');
        A.mappedWorkbook={name:file.name,type,sheets};
        A.selectMappedSheet(Math.max(0,sheets.findIndex(s=>s.header>=0)));
      }catch(e){A.lastImport=null;A.mappedWorkbook=null;A.render();A.toast(esc(e.message),'r');}
    };reader.readAsArrayBuffer(file);
  };
  const result=R.views._importResult;
  R.views._importResult=function(v){
    const intake=A.mappedWorkbook;
    let html=intake?'<div class="panel"><div class="pad"><label>Workbook worksheet <select onchange="RBB.app.selectMappedSheet(this.value)">'+intake.sheets.map((s,i)=>'<option value="'+i+'"'+(s.name===v.sheetName?' selected':'')+'>'+esc(s.name)+'</option>').join('')+'</select></label><p>Source: '+esc(v.fileName)+' / '+esc(v.sheetName)+' / header row '+v.headerRow+'. Only this worksheet is applied. Columns must match the mapped template; amounts use saved Excel formula results.</p></div></div>':'';
    if(v.type==='approved_budget')html+='<div class="note">Applying confirms this is the complete approved annual budget for the listed community and year. Its effective date controls precedence. A partial schedule must remain a draft.</div>';
    return html+result(v);
  };
  const apply=M.apply;
  M.apply=function(type,v,state){
    if(type!=='approved_budget'&&type!=='prior_budget')return apply(type,v,state);
    if(v.errors.length||!v.accepted.length||v.applyResult)return {applied:0,notes:['No budget applied. Resolve validation errors first.']};
    const groups={};
    v.accepted.forEach(r=>{const key=M.resolveProperty(r.property,state)+'|'+Number(r.year);(groups[key] ||= []).push(r);});
    state.budgetImportHistory ||= [];state.approvedBudgetImports ||= {};state.priorBudgetImports ||= {};
    let applied=0;const notes=[];
    for(const [key,rows] of Object.entries(groups)){
      const [propertyId,year]=key.split('|'),effectiveDate=M.parseDate(rows[0].effective_date)||null;
      const snapshot={propertyId,year:Number(year),effectiveDate,sourceFile:v.fileName,sourceSheet:v.sheetName||'CSV',importedAt:new Date().toISOString(),rows:rows.map(r=>({gl:r.gl,name:r.gl_name||R.glIndex[r.gl].name,monthly:r.__monthly.slice(),sourceRow:r.__row+(v.headerRow||1)-1}))};
      const old=state.approvedBudgetImports[key];
      state.budgetImportHistory.push({...snapshot,type});
      if(type==='prior_budget'){state.priorBudgetImports[key]=snapshot;notes.push(key+': prior budget retained separately from actuals.');continue;}
      if(old&&old.effectiveDate>=effectiveDate){notes.push(key+': same-date or older version retained in history; current baseline unchanged.');continue;}
      state.approvedBudgetImports[key]=snapshot;applied+=rows.length;
      notes.push(key+': approved baseline applied ('+effectiveDate+').');
    }
    return {applied,notes};
  };
  // Engine consumers use the same complete snapshot without mutating draft lines or actuals.
  const compute=R.engine.computeProperty;
  R.engine.computeProperty=function(state,pid,sid,year){
    year=year||state.budgetYear||R.BUDGET_YEAR;
    const scenario=R.engine.getScenario(state,sid),snapshot=state.approvedBudgetImports?.[pid+'|'+year];
    if(!snapshot||scenario.type!=='approved'||!scenario.locked)return compute(state,pid,sid,year);
    const copy={...state,lines:state.lines.filter(l=>l.propertyId!==pid)};
    snapshot.rows.forEach((r,i)=>{const account=R.glIndex[r.gl];copy.lines.push({id:'approved-import-'+pid+'-'+year+'-'+i,propertyId:pid,gl:r.gl,name:r.name,section:account.group,coaGroup:account.group,nature:account.nature,unitCategory:'property',method:'manual',behavior:'fixed',driver:{},overrides:{},manualMonthly:r.monthly.slice(),importedMonthly:r.monthly.slice(),yearData:{},sourceFile:snapshot.sourceFile,sourceSheet:snapshot.sourceSheet,sourceDetail:'row '+r.sourceRow,status:'approved'});});
    return compute(copy,pid,sid,year);
  };
  A.publishMappedBudgets=function(){
    if(window.parent===window){A.toast('Saved in Budget Builder. Open inside ATLAS to synchronize.');return;}
    const pending=Object.values(A.state.approvedBudgetImports||{}).filter(s=>!s.publishedAt);
    for(const s of pending){
      const property=A.state.properties.find(p=>p.id===s.propertyId),budgetByPeriod={};
      months.forEach((m,i)=>{if(s.coverage&&!s.coverage.includes(i))return;budgetByPeriod[s.year+'-'+String(i+1).padStart(2,'0')]=s.rows.map(r=>({gl:r.gl,glCode:r.gl,name:r.name,section:R.glIndex[r.gl].group,nature:R.glIndex[r.gl].nature,budget:r.monthly[i],annualBudget:r.monthly.reduce((a,b)=>a+b,0),source:(s.periodSources?.[i]||s.sourceFile+' / '+s.sourceSheet)+' / GL '+r.gl+' / row '+r.sourceRow}));});
      window.parent.postMessage({type:'atlas-budget-publish',requestId:s.propertyId+'|'+s.year+'|'+s.importedAt,payload:{locked:true,property,year:s.year,effectiveDate:s.effectiveDate,approvedBudgetReference:s.approvedBudgetReference,coverage:s.coverage,periodVersions:s.periodVersions,sourceFile:s.sourceFile,scenario:{id:'import-'+s.effectiveDate,name:'Approved budget '+s.effectiveDate,status:'approved'},budgetByPeriod,investorPacketSources:R.investorSources?.(A.state,undefined,{names:[property.name]}).properties[property.name]}},window.location.origin);
    }
  };
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.origin!==window.location.origin||event.data?.type!=='atlas-budget-publish-result'||!event.data.requestId)return;
    for(const s of Object.values(A.state.approvedBudgetImports||{})){if(event.data.requestId!==s.propertyId+'|'+s.year+'|'+s.importedAt)continue;s.syncStatus=event.data.result.message;if(event.data.result.ok)s.publishedAt=new Date().toISOString();A.invalidate();A.render();R.persist.autosave();}
  });
  const applyUI=A.applyImport;
  A.applyImport=function(){const v=A.lastImport;if(v?.applyResult)return;applyUI();if(v?.type==='approved_budget'&&v.applyResult?.applied)A.publishMappedBudgets();};
  const view=R.views.imports;
  if(view)R.views.imports=function(){return view()+'<div class="panel"><div class="pad"><button class="btn sec" onclick="RBB.app.publishMappedBudgets()">Sync approved imported budgets to ATLAS</button><p>Retries approved budgets saved here. ATLAS rejects older or conflicting same-date versions.</p></div></div>';};
})();
