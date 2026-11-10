/* Fiscal budget workbook intake. Keep calendar periods, budget basis and provenance explicit. */
(function(){
'use strict';
const R=window.RBB,A=R.app,M=R.importer,C=R.convert;
const months='jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validApproval=value=>{const month=/^20\d{2}-(0[1-9]|1[0-2])$/.test(value||'');const full=month?value+'-01':value;return /^20\d{2}-\d{2}-\d{2}$/.test(full||'')&&Number.isFinite(Date.parse(full+'T00:00:00Z'))&&new Date(full+'T00:00:00Z').toISOString().slice(0,10)===full&&full<=new Date().toISOString().slice(0,10);};
const notNewer=(old,next)=>!!old&&((old.length===7||next.length===7)?old.slice(0,7)>=next.slice(0,7):old>=next);
const approved=t=>t==='approved_budget'||t==='approved_budget_periods';
const convert=C.convert;
C.convert=function(state,bytes,opts={}){
 let read;try{read=R.xlsx.read(bytes);}catch(e){return {ok:false,why:e.message};}const sheet=read.sheets.find(s=>/^Monthly Budget Rpt$/i.test(s.name.trim()));
 if(!sheet || (opts.sheetName&&opts.sheetName!==sheet.name))return convert(state,bytes,opts);
 const rows=sheet.rows.map(r=>r.slice()),title=rows.slice(0,6).flat().map(C.text).join(' '),fy=title.match(/FY\s*(20\d{2})\s*[-–]\s*(20\d{2})/i);
 const labelledHeader=rows.findIndex(r=>r.filter(v=>/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+YR\s+[12]$/i.test(C.text(v))).length===24);
 const header=labelledHeader>=0?labelledHeader:rows.findIndex(r=>r.filter(v=>months.includes(C.text(v).toLowerCase().slice(0,3))&&/^[A-Za-z]{3}\s*$/.test(C.text(v))).length===12);
 if(!fy||header<0)return {ok:false,why:'Monthly Budget Rpt needs an explicit fiscal-year title and twelve fiscal months or two complete YR 1 / YR 2 blocks. No historical worksheet was substituted.'};
 const cols=[];let year=Number(fy[1]),prev=-1;
 if(labelledHeader>=0){
  rows[header].forEach((value,index)=>{const m=C.text(value).match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+YR\s+([12])$/i);if(m)cols.push({index,month:months.indexOf(m[1].toLowerCase()),year:Number(fy[Number(m[2])])});});
  if(Number(fy[2])!==Number(fy[1])+1||cols.some((c,i)=>c.month!==i%12||c.year!==Number(fy[i<12?1:2])))return {ok:false,why:'YR 1 and YR 2 must each contain January through December in the two consecutive title years.'};
 }else{
  rows[header].forEach((value,index)=>{const month=months.indexOf(C.text(value).toLowerCase().trim());if(month<0)return;if(prev>=0&&month<prev)year++;cols.push({index,month,year});prev=month;});
  if(cols.length!==12||year!==Number(fy[2])||new Set(cols.map(x=>x.year+'-'+x.month)).size!==12)return {ok:false,why:'The fiscal-year title and month headers do not reconcile. Review the period mapping.'};
 }
 rows[header][0]='Account';rows[header][1]='Account Name';
 cols.forEach(c=>rows[header][c.index]=R.MONTHS[c.month]+' '+c.year);
 const parsed=C.parseSheet(rows,{defaultProperty:C.text(rows[0]?.[0])});
 if(!parsed.ok)return parsed;
 if(cols.some(c=>!parsed.accounts.some(a=>Number.isFinite(a.values[c.year+'-'+c.month]))))return {ok:false,why:'A labelled budget month has no numeric account amounts. Missing source months cannot be dropped or filled with zero.'};
 parsed.layout='fiscalBudget';parsed.meta={label:'Approved fiscal budget — Monthly Budget Rpt',about:'Explicit monthly budget amounts mapped to their calendar year. Historical actuals and comparison tabs are excluded.'};
 const built=C.build(state,parsed,{...opts,keepZeroRows:true,preservePrecision:true,source:(opts.fileName||'Workbook')+' / '+sheet.name});
 const result={ok:true,kind:read.kind,sheetName:sheet.name,sheets:read.sheets.map(s=>({name:s.name,ok:s.name===sheet.name,accounts:s.name===sheet.name?parsed.accounts.length:0,months:s.name===sheet.name?cols.length:0,why:s.name===sheet.name?'':'Supporting or historical worksheet; excluded from approved budget.'})),layout:parsed.layout,meta:parsed.meta,parsed,built,plan:C.propertyPlan(state,parsed,opts.propertyMap),unknown:C.unknownAccounts(parsed),reconciliation:C.reconcile(parsed),excluded:{subtotals:parsed.subtotals.length,budgetColumns:[],ytdColumns:[]},warnings:[],fileName:opts.fileName,importBasis:'approved_budget_periods'};
 // Preserve actual source row coordinates; do not cite the converted CSV row as an Excel row.
 result.sourceRows={};parsed.accounts.forEach(a=>{(result.sourceRows[a.gl] ||= []).push(a.rowIndex+1);});
 return result;
};
M.SCHEMAS.approved_budget_periods={label:'Approved-budget source — staged fiscal periods',required:['property','gl','year','effective_date'],monthly:true,optional:['gl_name','annual'],note:'Stage evidence for mapped months. Accepted imports require separate central Admin approval before they become the original budget.'};
const validate=M.validate;
M.validate=function(type,rows,state){
 if(type!=='approved_budget_periods')return validate(type,rows,state);
 const baseRows=rows.map(r=>r.slice());baseRows[0]=baseRows[0].map(h=>h==='effective_date'?'budget_approval':h);
 const v=validate('prior_budget',baseRows,state);v.accepted.forEach(r=>{r.effective_date=r.budget_approval;delete r.budget_approval;});v.type=type;v.schemaLabel=M.SCHEMAS[type].label;
 const fail=message=>v.errors.push({rule:'approved_periods',message});const groups={};
 for(const r of v.accepted){const key=M.resolveProperty(r.property,state)+'|'+r.year;(groups[key] ||= []).push(r);}
 for(const group of Object.values(groups)){
  const dates=new Set(group.map(r=>r.effective_date));const date=group[0].effective_date;
  if(dates.size!==1||!validApproval(date))fail('Enter one valid, non-future budget approval date or month for each community/year.');
  const coverage=months.map((m,i)=>group.some(r=>r[m]!==''&&r[m]!=null)?i:null).filter(i=>i!==null);
  if(!coverage.length)fail('No mapped monthly amounts.');
  const seen=new Set();for(const r of group){if(seen.has(r.gl))fail('Duplicate GL '+r.gl);seen.add(r.gl);if(coverage.some(i=>r[months[i]]===''||r[months[i]]==null||!Number.isFinite(r.__monthly[i])))fail('GL '+r.gl+' has a missing amount within the mapped period. Confirm an explicit zero or amount in the source.');r.__coverage=coverage;}
 }
 if(v.warnings.some(w=>w.rule==='annual_tie'))fail('Annual totals must reconcile.');v.status=v.errors.length?'rejected':'accepted';return v;
};
const apply=M.apply;
M.apply=function(type,v,state){
 if(type!=='approved_budget_periods')return apply(type,v,state);
 if(v.errors.length||!v.accepted.length||v.applyResult)return {applied:0,notes:['No budget applied. Resolve validation errors.']};
 state.approvedBudgetImports ||= {};state.budgetImportHistory ||= [];
 const groups={};v.accepted.forEach(r=>{const key=M.resolveProperty(r.property,state)+'|'+r.year;(groups[key] ||= []).push(r);});
 // All communities/years are checked before anything is changed.
 for(const [key,rows] of Object.entries(groups)){
  const old=state.approvedBudgetImports[key];if(!old)continue;
  if(rows[0].__coverage.some(i=>notNewer(old.periodVersions?.[i]||(!old.coverage||old.coverage.includes(i)?old.effectiveDate:null),rows[0].effective_date)))return {applied:0,notes:['An overlapping month already has this version date or a newer budget. Review the version date before replacing amounts.']};
 }
 const references={};state.currentApprovedBudgets ||= {};
 for(const rows of Object.values(groups)){const r=rows[0],id=M.resolveProperty(r.property,state);const ref=references[id] ||= {sourceFile:v.fileName,sourceSheet:v.sheetName||'Mapped CSV',approval:r.effective_date,approvalPrecision:r.effective_date.length===7?'month':'day',periods:[],status:'staged',retention:'Browser staging only; central approval and receipt required'};ref.periods.push(...r.__coverage.map(i=>r.year+'-'+String(i+1).padStart(2,'0')));}
 for(const [id,ref] of Object.entries(references)){ref.periods.sort();ref.startPeriod=ref.periods[0];ref.endPeriod=ref.periods[ref.periods.length-1];const old=state.currentApprovedBudgets[id];if(!old||ref.endPeriod>old.endPeriod||(ref.endPeriod===old.endPeriod&&!notNewer(old.approval,ref.approval)))state.currentApprovedBudgets[id]=ref;}
 let applied=0;const notes=[];
 for(const [key,rows] of Object.entries(groups)){
  const [propertyId,year]=key.split('|'),old=state.approvedBudgetImports[key],covered=rows[0].__coverage,effectiveDate=rows[0].effective_date;
  const incoming=rows.map(r=>({gl:r.gl,name:r.gl_name||R.glIndex[r.gl].name,monthly:r.__monthly.slice(),sourceRow:v.sourceRows?.[r.gl]||r.__row}));
  const snapshot={propertyId,year:Number(year),effectiveDate,approvalPrecision:effectiveDate.length===7?'month':'day',approvedBudgetReference:references[propertyId],sourceFile:v.fileName,sourceSheet:v.sheetName||'Mapped CSV',sourceHash:v.sourceHash||null,sourceHashKind:v.sourceHashKind||null,stage:'staged',importedAt:new Date().toISOString(),coverage:[...new Set([...(old?.coverage|| (old?months.map((_,i)=>i):[])),...covered])].sort((a,b)=>a-b),periodVersions:{...(old?.periodVersions||{})},periodSources:{...(old?.periodSources||{})},rows:[]};
  if(old)months.forEach((m,i)=>{if(!old.coverage||old.coverage.includes(i)){snapshot.periodVersions[i] ||= old.effectiveDate;snapshot.periodSources[i] ||= old.sourceFile+' / '+old.sourceSheet;}});
  covered.forEach(i=>{snapshot.periodVersions[i]=effectiveDate;snapshot.periodSources[i]=v.fileName+' / '+snapshot.sourceSheet;});
  const gls=new Set([...(old?.rows||[]).map(r=>r.gl),...incoming.map(r=>r.gl)]);
  for(const gl of gls){const r=incoming.find(r=>r.gl===gl),prior=old?.rows.find(r=>r.gl===gl);snapshot.rows.push({...prior,...r,gl,monthly:months.map((_,i)=>covered.includes(i)?(r?.monthly[i]??null):(prior?.monthly[i]??null))});}
  state.budgetImportHistory.push({...snapshot,rows:incoming,coverage:covered,type});state.approvedBudgetImports[key]=snapshot;applied+=incoming.length;
  notes.push(`${state.properties.find(p=>p.id===propertyId)?.name||propertyId}: ${covered.map(i=>year+'-'+String(i+1).padStart(2,'0')).join(', ')} staged as budget evidence; central Admin approval required.`);
 }
 return {applied,notes};
};
const panel=R.views._convertPanel;
R.views._convertPanel=function(){let html=panel();if(A.conv.result?.importBasis==='approved_budget_periods')html=html.replace(/Month-end actuals/g,'Mapped monthly budget').replace(/Months of actuals/gi,'Months of budget');if(!A.conv.result?.built?.accountRows)return html;const basis=A.conv.importType||A.conv.result.importBasis||'actuals';
 const controls='<div class="panel" style="width:100%"><h3>Import destination</h3><div class="pad"><label>Apply these amounts as <select onchange="RBB.app.convertPurpose(this.value)">'+[['actuals','Historical actuals'],['prior_budget','Prior budget reference'],['approved_budget_periods','Approved budget for mapped months']].map(([v,l])=>'<option value="'+v+'"'+(basis===v?' selected':'')+'>'+l+'</option>').join('')+'</select></label>'+(approved(basis)?'<label style="margin-left:16px">Budget version / approval date <input type="'+(A.conv.approvalPrecision==='month'?'month':'date')+'" value="'+esc(A.conv.effectiveDate||'')+'" onchange="RBB.app.conv.effectiveDate=this.value"></label><label style="margin-left:16px">Approval precision <select onchange="RBB.app.conv.approvalPrecision=this.value;RBB.app.conv.effectiveDate=\'\';RBB.app.render()"><option value="day"'+(A.conv.approvalPrecision!=='month'?' selected':'')+'>Exact date</option><option value="month"'+(A.conv.approvalPrecision==='month'?' selected':'')+'>Month only</option></select></label><p>This saves browser staging only. Import-log acceptance does not approve or publish a budget. An Admin must separately review the canonical community, complete fiscal coverage, effective date and account mappings. The workbook’s headers determine the reporting periods. Central approval will require the original .xlsx again for complete workbook and cell review; browser-normalized rows cannot approve a budget.</p>':'')+'</div></div>';
 return html.replace('<button class="btn pri" onclick="RBB.app.convertValidate()">',controls+'<button class="btn pri" onclick="RBB.app.convertValidate()">');};
A.convertPurpose=function(value){A.conv.importType=value;A.lastImport=null;A.render();};
const readFile=A.convertReadFile;A.convertReadFile=function(file){A.conv.importType='';A.conv.effectiveDate='';A.mappedWorkbook=null;A.lastImport=null;return readFile(file);};
A.convertValidate=function(){const st=A.conv;if(!st.result)return;const type=st.importType||st.result.importBasis||'actuals',rows=M.parseCsv(st.result.built.csv);
 if(approved(type)){rows[0].push('effective_date');rows.slice(1).forEach(row=>row.push(st.effectiveDate||''));}
 const v=M.validate(type,rows,A.state);if(Object.keys(st.result.built.unmapped||{}).length)v.errors.push({rule:'property',message:'Map every source community before applying this workbook.'});if(st.result.reconciliation&&!st.result.reconciliation.clean)v.errors.push({rule:'reconciliation',message:'Resolve workbook reconciliation differences before applying.'});if(v.errors.length)v.status='rejected';v.fileName=st.fileName||'Converted workbook';v.sheetName=st.result.sheetName;v.sourceRows=st.result.sourceRows;v.sourceHash=st.sourceHash||st.result.sourceHash||null;v.sourceHashKind=st.sourceHashKind||st.result.sourceHashKind||(v.sourceHash?'workbook_bytes':null);v.convertedFrom=st.result.meta?.label;
 A.mappedWorkbook=null;A.lastImport=v;A.view='imports';A.render();setTimeout(()=>document.getElementById('budget-validation-result')?.scrollIntoView({behavior:'smooth',block:'start'}),0);
 A.toast(v.errors.length?'Validation found '+v.errors.length+' errors. Review the result.':'Validated. Review the mapped periods and select Apply this import to the budget.',v.errors.length?'r':'');};
const result=R.views._importResult;
R.views._importResult=function(v){return '<div id="budget-validation-result">'+result(v)+(v.applyResult?'<div class="note">'+v.applyResult.notes.map(esc).join('<br>')+'</div>':'')+'</div>';};
const applyUI=A.applyImport;
A.applyImport=function(){const v=A.lastImport;if(!v||v.applyResult||v.errors.length)return;applyUI();if(!approved(v.type)||!v.applyResult?.applied)return;
 const first=v.accepted[0];A.state.activeProperty=M.resolveProperty(first.property,A.state);A.state.budgetYear=Number(first.year);const scenario=A.state.scenarios.find(s=>s.type==='approved'&&s.locked);if(scenario)A.state.activeScenario=scenario.id;
 v.accepted.forEach(r=>{if(!R.YEARS.includes(Number(r.year)))R.YEARS.push(Number(r.year));});R.YEARS.sort();A.invalidate();A.render();R.persist.autosave();};
A.publishToAtlas=function(){return A.publishMappedBudgets();};
const restore=R.persist.apply;R.persist.apply=function(payload){Object.values(payload.state?.approvedBudgetImports||{}).forEach(s=>{if(!R.YEARS.includes(s.year))R.YEARS.push(s.year);});R.YEARS.sort();return restore(payload);};
const render=A.render;A.render=function(){render();const s=A.state.approvedBudgetImports?.[A.state.activeProperty+'|'+A.year()];if(!s)return;const main=document.querySelector('.main');if(!main)return;const box=document.createElement('div');box.className='note';const current=A.state.currentApprovedBudgets?.[A.state.activeProperty];box.textContent=(s.canonicalVersionId?'Central budget receipt: '+s.canonicalVersionId+' · '+(s.canonicalContentHash||'')+'. ':'Staged budget evidence — accepted import is not central approval. ')+(current?'Source coverage '+current.startPeriod+' through '+current.endPeriod+' · Source approval date '+current.approval+' ('+current.approvalPrecision+' precision). ':'')+(s.sourceFile||'')+' · '+s.year+' · Covered months: '+(s.coverage||months.map((_,i)=>i)).map(i=>R.MONTHS[i]).join(', ')+'. Uncovered amounts remain unavailable. '+(s.syncStatus||'Review staged budgets for central approval.');main.prepend(box);
 // Explicitly display missing fiscal periods in monthly tables, not calculated zero placeholders.
 if(s.coverage&&s.coverage.length<12)main.querySelectorAll('table').forEach(table=>{
  const header=table.querySelector('tr');if(!header)return;const cells=Array.from(header.children);
  const indexes=months.map(m=>cells.findIndex(c=>c.textContent.trim().toLowerCase()===m));if(indexes.some(i=>i<0))return;
  Array.from(table.querySelectorAll('tr')).slice(1).forEach(row=>months.forEach((m,i)=>{if(!s.coverage.includes(i)&&row.children.length===cells.length){const cell=row.children[indexes[i]];cell.textContent='—';cell.title='No approved budget imported for this period';}}));
 });};
})();
