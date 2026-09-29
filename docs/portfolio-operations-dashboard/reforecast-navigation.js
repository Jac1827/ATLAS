/* Lazy governed reforecast routes inside the existing Budget Builder shell. */
(function(R){
 'use strict';if(!R?.app)return;const A=R.app;
 const routes=[['reforecast','Working Drafts','workspace'],['reforecastapprovals','Ready for Review and Approval','approvals'],['reforecasthistory','Approved History','history'],['reforecaststatus','Status / Reconciliation','status'],['reforecastgap','Budget reports & print','gap']];
 let navigation=0,renderGeneration=0,intent=null,mountQueue=Promise.resolve();
 const scope=()=>{const central=window.parent.ATLAS_CENTRAL,session=central?.getSession?.(),expiresAt=Number(session?.expires_at);return {central,actor:session?.user?.id,access:typeof central?.getAccessContextKey==='function'?central.getAccessContextKey():JSON.stringify(central?.getStoredProfile?.()),config:JSON.stringify(central?.getConfig?.()),signedIn:Boolean(session?.access_token&&session?.user?.id&&Number.isFinite(expiresAt)&&expiresAt>Math.floor(Date.now()/1000)),property:A.state?.activeProperty,year:A.state?.budgetYear};};
 const sameAccess=(current,captured)=>current.central===captured.central&&current.actor===captured.actor&&current.access===captured.access&&current.config===captured.config&&current.signedIn===captured.signedIn;
 const sameScope=captured=>{const current=scope();return sameAccess(current,captured)&&current.property===captured.property&&current.year===captured.year;};
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
     const m=await import('./features/reforecast-ui.mjs?v=d2817b8df49341d1');if(!current())return;
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
 R.reforecastNavigationReady=Promise.all([
  import('./features/reforecast-legacy-bridge.mjs?v=21a1917190ae8f6e').then(m=>m.installLegacyReforecastBridge(R)),
  import('./features/saved-str-programmes.mjs?v=1398dc7ae7973234').then(m=>m.installSavedStrProgrammes(R))
 ]);
 // The startup coordinator awaits this promise; attach a handler immediately
 // so a failed async install stays a visible boot failure without a lost route.
 R.reforecastNavigationReady.catch(()=>{});
 const clearScope=()=>{navigation++;renderGeneration++;intent=null;delete R.reforecastSources;delete R.reforecastPropertyAssignments;const el=document.getElementById('atlas-reforecast-workspace');if(el){const replacement=el.cloneNode(false);replacement.textContent='The signed-in workspace changed. Reopen the intended financial view.';el.replaceWith(replacement);}import('./features/reforecast-legacy-bridge.mjs?v=21a1917190ae8f6e').then(m=>m.clearLegacyReforecastCache());mountQueue=mountQueue.catch(()=>{}).then(async()=>{const m=await import('./features/reforecast-ui.mjs?v=d2817b8df49341d1');m.clearReforecastSession();});};
 // Token rotation and unchanged profile broadcasts retain the active draft.
 // Expiry is checked separately: an actor/access key can outlive its session.
 let accessScope=scope();
 window.parent.addEventListener('atlas-central-auth-change',()=>{const current=scope(),unchanged=current.signedIn&&sameAccess(current,accessScope);accessScope=current;if(!unchanged)clearScope();});
 const originalPublish=A.publishToAtlas;
 A.publishToAtlas=function(){if(A.scenario().type!=='approved'){A.go('reforecast');A.toast('Submit a shared draft for VP review and publication.');return;}return originalPublish.apply(this,arguments);};
 window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent)return;if(e.data?.type==='atlas-reforecast-navigate')navigate(e.data.view||'reforecast',e.data.scenarioId||e.data.reviewId?{kind:'review',detail:e.data}:null);});
 // Workflow buttons change the governed view directly rather than calling A.go.
 document.addEventListener('click',event=>{if(event.target.closest?.('[data-workspace-view]')){navigation++;intent=null;}},true);
 document.addEventListener('atlas-create-reforecast',event=>navigate('reforecast',{kind:'create',detail:event.detail}));
 const route=location.hash.slice(1);if(routes.some(r=>r[0]===route))A.go(route);else if(A.state)A.render();
})(window.RBB);
