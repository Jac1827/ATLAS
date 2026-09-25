/* Workflow navigation for the existing Budget Builder. No financial state is copied. */
(function(R){
 'use strict';
 const A=R.app,esc=A.h.esc;
 const groups=[
  ['overview','Overview',['dashboard']],
  ['budget','Budget Plan',['workspace','newbudget','monthly','gl','issues','occupancy','drivers','strbuild','programmes','segments','compare']],
  ['actuals','Actuals & Close',['actuals','financialreview','vsactual','exceptions','commentary']],
  ['forecast','Forecast',['scenarios','assumptions','recs']],
  ['contracts','Contracts',['contracts','utilities']],
  ['reports','Reports',['reports','visuals','exports']],
  ['setup','Setup & Imports',['imports','saveload']]
 ];
 const sharedViews=new Set(['dashboard','actuals','financialreview','vsactual','exceptions','commentary','reports','visuals','exports','reforecast','reforecastapprovals','reforecastgap']);
 const renderBrowserTop=A.renderTop;
 A.renderTop=function(){
  if(!sharedViews.has(A.view))return renderBrowserTop?renderBrowserTop.call(this).replace('Effective gross income','Browser draft income').replace('<span class="k">NOI</span>','<span class="k">Browser draft NOI</span>').replace('<label>Scenario</label>','<label>Browser draft scenario</label>'):'';
  const year=A.year(),properties=A.state?.properties||[];
  return '<div class="brandbox"><img class="logo" src="assets/rise-logomark-white.png" alt="RISE"><div class="t">Budget Builder<small>Shared financial records</small></div></div>'+
   '<div class="picker"><label>Workspace property</label><select onchange="RBB.app.setProperty(this.value)">'+properties.map(p=>'<option value="'+esc(p.id)+'"'+(p.id===A.state.activeProperty?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></div>'+
   '<div class="picker"><label>Reporting year</label><div class="yearsel">'+(R.YEARS||[year]).map(y=>'<button class="'+(y===year?'on':'')+'" onclick="RBB.app.setYear('+Number(y)+')">'+esc(y)+'</button>').join('')+'</div></div><div class="grow"></div>'+
   '<span>Selected shared records and publication status are shown below.</span><button class="btn ghost sm" onclick="RBB.app.go(\'workspace\')">Edit browser working model</button><button class="btn ghost sm" onclick="RBB.app.go(\'reports\')">Published reports</button>';
 };
 const known=()=>A.VIEWS.filter(v=>v.id);
 const section=view=>groups.find(g=>g[2].includes(view))||groups[6];
 const label=id=>known().find(v=>v.id===id)?.label||id;
 const link=(id,text,current)=>'<a href="#'+esc(id)+'"'+(current?' aria-current="page" class="on"':'')+' onclick="RBB.app.go(\''+esc(id)+'\');return false;">'+esc(text)+'</a>';
 A.renderNav=function(){
  const group=section(A.view),shared=sharedViews.has(A.view),p=A.prop();
  const sc=shared?null:A.scenario(),summary=shared?null:A.c().summary;
  const secondary=known().filter(v=>section(v.id)===group);
  const saved=R.persist.dirty?'Unsaved changes':R.persist.lastSavedAt?'Saved in this browser':'No browser save recorded';
  return '<div class="budget-workflow-nav"><div class="budget-nav-tools"><button class="btn sm" onclick="RBB.app.openCommandMenu()">Find a tool <kbd>Ctrl/⌘ K</kbd></button><button class="btn sm" onclick="RBB.app.continueWorkflow()">Continue where I left off</button></div>'+
   '<nav class="budget-primary" aria-label="Budget workflows">'+groups.map(g=>link(g[2][0],g[1],g===group)).join('')+'</nav>'+
   '<div class="budget-context" aria-label="Financial context"><strong>'+esc(shared?'Shared financial records: '+p.name:'Browser working model: '+p.name)+'</strong><span>Reporting year '+esc(A.year())+'</span>'+
   (shared?'<span>Select the community and month below. Publication status, source versions and the snapshot fingerprint identify the official record.</span>':'<span>'+esc(sc.name)+' · Browser draft'+(sc.locked?' · Local editing lock':'')+'</span><span>This working model is not an approved shared financial version.</span><span>'+esc(saved)+'</span>')+'</div>'+
   '<nav class="budget-secondary" aria-label="'+esc(group[1])+' tools">'+secondary.map(v=>link(v.id,v.label,A.view===v.id)).join('')+'</nav>'+
   '<div class="budget-breadcrumb" aria-label="Breadcrumb">Budget Builder / '+esc(group[1])+' / '+esc(label(A.view))+(shared?'':'<span>'+Number(summary?.high||0)+' high-priority browser draft checks</span>')+'</div></div>';
 };
 const go=A.go;
 let packageReview;
 A.openFinancialPackageReview=async function(scope){try{packageReview=await import('./features/financial-package-review.mjs?v=0b57821a626c8993');await packageReview.openReview(scope);}catch(e){A.toast(e.message,'r');}};
 let sharedViewSequence=0;
 function sharedActualsPanel(title='Actuals & Close'){
  const sequence=++sharedViewSequence,communityName=A.prop?.()?.name||A.cp?.()?.property?.name,year=A.year?.();
  setTimeout(async()=>{const el=document.getElementById('shared-financial-comparison');if(!el||sequence!==sharedViewSequence)return;try{const m=await import('./features/financial-comparison.mjs?v=3ae7f2cacb020f89');if(!el.isConnected||sequence!==sharedViewSequence)return;await m.mountComparison(el,{communityName,year});}catch(e){if(el.isConnected&&sequence===sharedViewSequence){el.setAttribute('role','alert');el.textContent='Shared financial records could not load: '+e.message;}}},0);
  return '<div class="panel"><h2>'+esc(title)+'</h2><p>Published monthly actuals and their approved original-budget comparison are read from shared financial versions. Screen, PDF, CSV and Excel cite the same retained snapshot fingerprint. Missing or open months are identified below.</p>'+
   '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri" onclick="RBB.app.openFinancialPackageReview()">Upload or read saved financial review</button><button class="btn sec" onclick="RBB.app.go(\'reforecastgap\')">Reforecast reports</button><button class="btn sec" onclick="RBB.app.go(\'reforecast\')">Working reforecasts</button><button class="btn sec" onclick="RBB.app.go(\'reforecastapprovals\')">Approval Center</button></div>'+
   '<p>Reforecast reports identify each saved version as a draft, locked version, or published active benchmark. Select a published active version for official forecast reporting.</p><p>Upload → classify → confirm → map → reconcile → save review → Admin close → canonical publication → verified readback</p></div><section class="panel" id="shared-financial-comparison"><p>Loading shared financial records…</p></section>';
 }
 const sharedTitles={dashboard:'Financial overview',actuals:'Actuals & Close',financialreview:'Financial review',vsactual:'Budget vs actual',exceptions:'Financial exceptions and missing coverage',commentary:'Financial source notes',reports:'Published financial reports',exports:'Published financial exports',visuals:'Published financial analysis'};
 for(const [view,title] of Object.entries(sharedTitles))R.views[view]=()=>sharedActualsPanel(title);

 // Retired browser reports cannot become official outputs through old buttons,
 // direct links, or an inline CSV action on a working-model screen.
 const exportMessage='Browser draft financial exports are disabled. Choose a shared month below for published actuals and approved-budget PDF, CSV or Excel, or open Reforecast reports for a saved version and its publication status.';
 const redirectExport=function(){A.go('reports');A.toast(exportMessage,'r');return false;};
 for(const name of ['exportOne','exportWorkbook','exportBudgetBook','previewBudgetBook','exportPropertyCsv','exportFinancialReview','exportSegment','exportSegmentComparison','exportCurrentCsv','exportSegmentCsv','strExport','downloadActualsShell','reportOpen','reportSave','reportOpenSegment','reportSaveSegment','reportOpenOne','reportSaveOne','reportOpenCustom','reportSaveCustom','printThisView','visualPrint'])if(typeof A[name]==='function')A[name]=redirectExport;
 const refuseReport=()=>{throw Error(exportMessage);};
 for(const name of ['reportHtml','reportCustomHtml','budgetBookHtml'])if(typeof A[name]==='function')A[name]=refuseReport;
 for(const name of ['workbook','budgetBook'])if(typeof R.exporter?.[name]==='function')R.exporter[name]=refuseReport;
 for(const name of ['build','buildOne'])if(typeof R.exporter?.reports?.[name]==='function')R.exporter.reports[name]=refuseReport;
 const browserDownload=A.download;let downloadPurpose=null;
 if(typeof browserDownload==='function'){
  A.download=function(name,content,mime){
   if(!downloadPurpose)return redirectExport();
   return browserDownload.call(this,downloadPurpose==='source_evidence'?'SOURCE_EVIDENCE_'+name:name,content,mime);
  };
  // These synchronous handlers export user save files, empty input templates,
  // or source evidence. They never export a calculated financial report.
  for(const [name,purpose] of [['doSaveFile','backup'],['downloadTemplate','template'],['convertDownload','source_evidence'],['convertDownloadGlMap','source_evidence']]){
   const original=A[name];if(typeof original!=='function')continue;
   A[name]=function(){const previous=downloadPurpose;downloadPurpose=purpose;try{return original.apply(this,arguments);}finally{downloadPurpose=previous;}};
  }
 }
 const convertRead=A.convertReadFile,convertPanel=R.views._convertPanel;
 A.inspectSupportingOnly=false;
 R.views._convertPanel=function(){return '<div class="panel"><h3>Monthly actuals intake</h3><p>BCR is authoritative. Each selected month receives a separate review and close; T12 cannot create closes.</p><button class="btn pri" onclick="RBB.app.openFinancialPackageReview()">Review a monthly BCR package</button><label><input type="checkbox" '+(A.inspectSupportingOnly?'checked':'')+' onchange="RBB.app.inspectSupportingOnly=this.checked"> Inspect supporting or operational sources only</label></div>'+convertPanel.apply(this,arguments);};
 A.convertReadFile=function(file){if(!A.inspectSupportingOnly&&/\.(xlsx|pdf)$/i.test(file.name))return A.openFinancialPackageReview({file});return convertRead.call(this,file);};
 A.convertValidate=function(){A.toast('This converter is supporting evidence only. Use Review a monthly BCR package to save a governed actuals review.','r');};
 A.go=function(view,opts){
  if(!R.views[view])return;
  if(view!==A.view)packageReview?.dispose();
  if(view!==A.view)try{sessionStorage.setItem('atlas-budget-previous-view',A.view);}catch{}
  const result=go.call(A,view,opts);
  const url=new URL(location.href);url.hash=view;history.replaceState(null,'',url);
  return result;
 };
 A.continueWorkflow=function(){let view;try{view=sessionStorage.getItem('atlas-budget-previous-view');}catch{}if(view&&R.views[view])A.go(view);else A.toast('Choose a workflow to begin. Your financial values are unchanged.');};
 A.openCommandMenu=function(){
  document.getElementById('budget-command-menu')?.remove();
  const dialog=document.createElement('dialog');dialog.id='budget-command-menu';dialog.setAttribute('aria-label','Find a Budget Builder tool');
  dialog.innerHTML='<form method="dialog"><button class="btn sm" aria-label="Close tool search">Close</button></form><label>Find a tool<input type="search" placeholder="Try GL, contracts, actuals…" autofocus></label><div data-results></div>';
  const results=dialog.querySelector('[data-results]'),input=dialog.querySelector('input');
  function render(){const q=input.value.trim().toLowerCase();results.replaceChildren();const views=known().filter(v=>(v.label+' '+section(v.id)[1]).toLowerCase().includes(q));for(const v of views){const button=document.createElement('button');button.className='budget-command-result';button.textContent=section(v.id)[1]+' / '+v.label;button.onclick=()=>{dialog.close();A.go(v.id);};results.append(button);}if(!views.length)results.textContent='No matching tool.';}
  input.oninput=render;input.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();results.querySelector('button')?.focus();}if(e.key==='Enter'){e.preventDefault();results.querySelector('button')?.click();}};
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);render();dialog.showModal();input.focus();
 };
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();A.openCommandMenu();}});
 if(typeof window!=='undefined'&&window.parent!==window&&new URLSearchParams(location.search).get('investorReader')!=='1')import('./features/financial-close.mjs?v=823a6aa513af4eb1').then(async m=>{
   const central=window.parent.ATLAS_CENTRAL;if(!central||!window.parent.atlasAccessDecision?.(12)?.ok)return;
   const [communities,aliases,matcher]=await Promise.all([central.readCommunitiesForAccess(),central.fetchJson('/atlas_community_aliases?active=eq.true&select=community_id,alias,active&limit=1000'),import('./features/financial-package.mjs?v=a378a0cb25083758')]);
   const resolve=name=>matcher.resolveCommunity(name,communities,aliases).communityId;
   m.installBuilder(R,central,resolve);
   const utility=await import('./features/utility-forecast-ui.mjs');
   utility.installUtilityForecast(R,central,{communities,resolve,locationFor:name=>window.parent.atlasCommunityLocationRecord?.(name)||{}});A.render();
 }).catch(e=>A.toast(e.message,'r'));
 R.budgetNavigation={groups,section};
})(RBB);
