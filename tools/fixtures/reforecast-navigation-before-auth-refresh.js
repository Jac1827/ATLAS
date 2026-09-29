/* Lazy governed reforecast routes inside the existing Budget Builder shell. */
(function(R){
 'use strict';if(!R?.app)return;const A=R.app;
 const routes=[['reforecast','Working Drafts','workspace'],['reforecastapprovals','Ready for Review and Approval','approvals'],['reforecasthistory','Approved History','history'],['reforecaststatus','Status / Reconciliation','status'],['reforecastgap','Budget reports & print','gap']];
 let navigation=0,renderGeneration=0,intent=null,mountQueue=Promise.resolve();
 const scope=()=>{const central=window.parent.ATLAS_CENTRAL;return {central,actor:central?.getSession?.()?.user?.id,access:central?.getAccessContextKey?.()??JSON.stringify(central?.getStoredProfile?.()),property:A.state?.activeProperty,year:A.state?.budgetYear};};
 const sameScope=captured=>{const current=scope();return current.central===captured.central&&current.actor===captured.actor&&current.access===captured.access&&current.property===captured.property&&current.year===captured.year;};
 const go=A.go;
 const navigate=(view,nextIntent=null)=>{navigation++;intent=nextIntent?{...nextIntent,scope:scope(),completed:false}:null;return go.call(A,view);};
 A.go=function(view,opts){navigation++;intent=null;return go.call(A,view,opts);};
 for(const name of ['setProperty','setYear']){const change=A[name];if(typeof change==='function')A[name]=function(){navigation++;intent=null;return change.apply(this,arguments);};}
 for(const [id,label,mode] of routes){A.VIEWS.push({id,label});R.views[id]=()=>{
  if(intent&&!sameScope(intent.scope)){navigation++;intent=null;}
  const generation=++renderGeneration,token=navigation,request=intent,captured=scope();
  setTimeout(()=>{
   const el=document.getElementById('atlas-reforecast-workspace');
   const current=()=>el?.isConnected&&el===document.getElementById('atlas-reforecast-workspace')&&generation===renderGeneration&&token===navigation&&A.view===id&&sameScope(captured);
   // A route owns its mount and any exact-record action. A late startup render
   // joins this sequence instead of creating another cold workspace instance.
   mountQueue=mountQueue.catch(()=>{}).then(async()=>{
    if(!current())return;
    try{
     const m=await import('./features/reforecast-ui.mjs?v=2e3599f1c4aa1fdf');if(!current())return;
     const selected=request===intent&&request?.completed&&(request.kind==='create'||request.detail.scenarioId);
     await m.mountReforecast(el,{R,mode:selected?'workspace':mode});if(!current())return;
     if(request&&request===intent&&!request.completed&&sameScope(request.scope)){
      if(request.kind==='review')await m.openBudgetReview(request.detail);
      else {await m.createRecommendedReforecast(request.detail);if(current())document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());}
      request.completed=true;
     }
    }catch(error){if(current()){el.textContent='Reforecast workspace could not load: '+error.message;A.toast(error.message,'r');}}
   });
  },0);
  return '<div id="atlas-reforecast-workspace" role="region" aria-label="Governed reforecast"><p>Loading shared reforecast workspace…</p></div>';
 };}
 R.budgetNavigation?.groups.find(g=>g[0]==='forecast')?.[2].push('reforecast','reforecastapprovals','reforecasthistory','reforecaststatus');
 R.budgetNavigation?.groups.find(g=>g[0]==='reports')?.[2].push('reforecastgap');
 import('./features/reforecast-legacy-bridge.mjs?v=f5597e7b01496e6d').then(m=>m.installLegacyReforecastBridge(R)).catch(e=>A.toast('Scenario calculator failed: '+e.message,'r'));
 import('./features/saved-str-programmes.mjs').then(m=>m.installSavedStrProgrammes(R)).catch(e=>A.toast('Saved STR programmes could not load: '+e.message,'r'));
 const clearScope=()=>{navigation++;renderGeneration++;intent=null;delete R.reforecastSources;delete R.reforecastPropertyAssignments;const el=document.getElementById('atlas-reforecast-workspace');if(el){const replacement=el.cloneNode(false);replacement.textContent='The signed-in workspace changed. Reopen the intended financial view.';el.replaceWith(replacement);}import('./features/reforecast-legacy-bridge.mjs?v=f5597e7b01496e6d').then(m=>m.clearLegacyReforecastCache());mountQueue=mountQueue.catch(()=>{}).then(async()=>{const m=await import('./features/reforecast-ui.mjs?v=2e3599f1c4aa1fdf');m.clearReforecastSession();});};
 window.parent.addEventListener('atlas-central-auth-change',clearScope);
 const originalPublish=A.publishToAtlas;
 A.publishToAtlas=function(){if(A.scenario().type!=='approved'){A.go('reforecast');A.toast('Submit a shared draft for VP review and publication.');return;}return originalPublish.apply(this,arguments);};
 window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent)return;if(e.data?.type==='atlas-reforecast-navigate')navigate(e.data.view||'reforecast',e.data.scenarioId||e.data.reviewId?{kind:'review',detail:e.data}:null);});
 // Workflow buttons change the governed view directly rather than calling A.go.
 document.addEventListener('click',event=>{if(event.target.closest?.('[data-workspace-view]')){navigation++;intent=null;}},true);
 document.addEventListener('atlas-create-reforecast',event=>navigate('reforecast',{kind:'create',detail:event.detail}));
 const route=location.hash.slice(1);if(routes.some(r=>r[0]===route))A.go(route);else if(A.state)A.render();
})(window.RBB);
