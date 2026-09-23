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
 const known=()=>A.VIEWS.filter(v=>v.id);
 const section=view=>groups.find(g=>g[2].includes(view))||groups[6];
 const label=id=>known().find(v=>v.id===id)?.label||id;
 const link=(id,text,current)=>'<a href="#'+esc(id)+'"'+(current?' aria-current="page" class="on"':'')+' onclick="RBB.app.go(\''+esc(id)+'\');return false;">'+esc(text)+'</a>';
 A.renderNav=function(){
  const group=section(A.view),sc=A.scenario(),vr=A.vr(),p=A.prop(),summary=A.c().summary;
  const secondary=known().filter(v=>section(v.id)===group);
  const canonical=R.closedFinancial?.caches.get(p.id+'|'+A.year());
  const closed=canonical ? (canonical.coverage.last ? 'Closed through '+R.MONTHS[canonical.coverage.last-1]+' · '+(canonical.coverage.completeYtd?'consecutive YTD':'incomplete YTD coverage; statement YTD reference') : canonical.status) : vr?.closedThrough ? R.MONTHS[vr.closedThrough-1]+' (local record; central close unverified)' : 'No closed actuals verified';
  const saved=R.persist.dirty?'Unsaved changes':R.persist.lastSavedAt?'Saved in this browser':'No browser save recorded';
  return '<div class="budget-workflow-nav"><div class="budget-nav-tools"><button class="btn sm" onclick="RBB.app.openCommandMenu()">Find a tool <kbd>Ctrl/⌘ K</kbd></button><button class="btn sm" onclick="RBB.app.continueWorkflow()">Continue where I left off</button></div>'+
   '<nav class="budget-primary" aria-label="Budget workflows">'+groups.map(g=>link(g[2][0],g[1],g===group)).join('')+'</nav>'+
   '<div class="budget-context" aria-label="Financial context"><strong>Budget scenario: '+esc(p.name)+'</strong><span>Calendar '+esc(A.year())+' · Fiscal start '+esc(p.fiscalYearBegins||'Not recorded')+'</span><span>'+esc(sc.name)+' · Version '+esc(sc.version||'not recorded')+' · '+esc(sc.status||'Draft')+(sc.locked?' · Locked':'')+' (local scenario)</span><span>Close coverage for '+esc(p.name)+': '+esc(closed)+'</span><span>'+esc(saved)+'</span><span>Selected shared actuals and their coverage are shown in the comparison below. Original budget unchanged</span></div>'+
   '<nav class="budget-secondary" aria-label="'+esc(group[1])+' tools">'+secondary.map(v=>link(v.id,v.label,A.view===v.id)).join('')+'</nav>'+
   '<div class="budget-breadcrumb" aria-label="Breadcrumb">Budget Builder / '+esc(group[1])+' / '+esc(label(A.view))+'<span>'+Number(summary?.high||0)+' high-priority budget checks</span></div></div>';
 };
 const go=A.go;
 let packageReview;
 A.openFinancialPackageReview=async function(scope){try{packageReview=await import('./features/financial-package-review.mjs?v=cb857aa20bcf6f46');await packageReview.openReview(scope);}catch(e){A.toast(e.message,'r');}};
 const actuals=R.views.actuals;
 function sharedActualsPanel(){
  setTimeout(async()=>{const el=document.getElementById('shared-financial-comparison');if(!el)return;try{const m=await import('./features/financial-comparison.mjs?v=5127bc4004d974a9');await m.mountComparison(el,{communityName:A.cp().property.name,year:A.year()});}catch(e){el.textContent=e.message;}},0);
  return '<div class="panel"><button class="btn pri" onclick="RBB.app.openFinancialPackageReview()">Upload or read saved financial review</button><p>Upload → classify → confirm → map → reconcile → save review → Admin close → canonical publication → verified readback</p></div><section class="panel" id="shared-financial-comparison"><p>Loading shared actuals…</p></section>';
 }
 R.views.actuals=function(){return sharedActualsPanel();};
 const convertRead=A.convertReadFile,convertPanel=R.views._convertPanel;
 A.inspectSupportingOnly=false;
 R.views._convertPanel=function(){return '<div class="panel"><h3>Monthly actuals intake</h3><p>BCR is authoritative. Each selected month receives a separate review and close; T12 cannot create closes.</p><button class="btn pri" onclick="RBB.app.openFinancialPackageReview()">Review a monthly BCR package</button><label><input type="checkbox" '+(A.inspectSupportingOnly?'checked':'')+' onchange="RBB.app.inspectSupportingOnly=this.checked"> Inspect supporting or operational sources only</label></div>'+convertPanel.apply(this,arguments);};
 A.convertReadFile=function(file){if(!A.inspectSupportingOnly&&/\.(xlsx|pdf)$/i.test(file.name))return A.openFinancialPackageReview({file});return convertRead.call(this,file);};
 A.convertValidate=function(){A.toast('This converter is supporting evidence only. Use Review a monthly BCR package to save a governed actuals review.','r');};
 const vsactual=R.views.vsactual;
 if(vsactual)R.views.vsactual=function(){return sharedActualsPanel()+'<details><summary>Legacy scenario comparison — separate browser data</summary>'+vsactual.apply(this,arguments)+'</details>';};
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
 if(typeof window!=='undefined'&&window.parent!==window&&new URLSearchParams(location.search).get('investorReader')!=='1')import('./features/financial-close.mjs?v=4ea0aa4203c6eab0').then(async m=>{
   const central=window.parent.ATLAS_CENTRAL;if(!central||!window.parent.atlasAccessDecision?.(12)?.ok)return;
   const [communities,aliases,matcher]=await Promise.all([central.readCommunitiesForAccess(),central.fetchJson('/atlas_community_aliases?active=eq.true&select=community_id,alias,active&limit=1000'),import('./features/financial-package.mjs?v=b43f129095c7fac2')]);
   const resolve=name=>matcher.resolveCommunity(name,communities,aliases).communityId;
   m.installBuilder(R,central,resolve);
   const utility=await import('./features/utility-forecast-ui.mjs');
   utility.installUtilityForecast(R,central,{communities,resolve,locationFor:name=>window.parent.atlasCommunityLocationRecord?.(name)||{}});A.render();
 }).catch(e=>A.toast(e.message,'r'));
 R.budgetNavigation={groups,section};
})(RBB);
