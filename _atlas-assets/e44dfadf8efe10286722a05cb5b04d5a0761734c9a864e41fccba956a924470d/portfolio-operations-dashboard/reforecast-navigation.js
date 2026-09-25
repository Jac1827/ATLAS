/* Lazy governed reforecast routes inside the existing Budget Builder shell. */
(function(R){
 'use strict';if(!R?.app)return;const A=R.app;
 const routes=[['reforecast','Working Drafts','workspace'],['reforecastapprovals','Ready for Review and Approval','approvals'],['reforecasthistory','Approved History','history'],['reforecaststatus','Status / Reconciliation','status'],['reforecastgap','Budget reports & print','gap']];
 for(const [id,label,mode] of routes){A.VIEWS.push({id,label});R.views[id]=()=>{setTimeout(async()=>{const el=document.getElementById('atlas-reforecast-workspace');if(!el)return;try{const m=await import('./features/reforecast-ui.mjs?v=018b2b0c44363ea5');if(el.isConnected)await m.mountReforecast(el,{R,mode});}catch(e){el.textContent='Reforecast workspace could not load: '+e.message;}},0);return '<div id="atlas-reforecast-workspace" role="region" aria-label="Governed reforecast"><p>Loading shared reforecast workspace…</p></div>';};}
 R.budgetNavigation?.groups.find(g=>g[0]==='forecast')?.[2].push('reforecast','reforecastapprovals','reforecasthistory','reforecaststatus');
 R.budgetNavigation?.groups.find(g=>g[0]==='reports')?.[2].push('reforecastgap');
 import('./features/reforecast-legacy-bridge.mjs?v=418229d306218ee6').then(m=>m.installLegacyReforecastBridge(R)).catch(e=>A.toast('Scenario calculator failed: '+e.message,'r'));
 import('./features/saved-str-programmes.mjs').then(m=>m.installSavedStrProgrammes(R)).catch(e=>A.toast('Saved STR programmes could not load: '+e.message,'r'));
 const clearScope=()=>{delete R.reforecastSources;delete R.reforecastPropertyAssignments;import('./features/reforecast-legacy-bridge.mjs?v=418229d306218ee6').then(m=>m.clearLegacyReforecastCache());import('./features/reforecast-ui.mjs?v=018b2b0c44363ea5').then(m=>m.clearReforecastSession());};
 window.parent.addEventListener('atlas-central-auth-change',clearScope);
 const originalPublish=A.publishToAtlas;
 A.publishToAtlas=function(){if(A.scenario().type!=='approved'){A.go('reforecast');A.toast('Submit a shared draft for VP review and publication.');return;}return originalPublish.apply(this,arguments);};
 window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent)return;if(e.data?.type==='atlas-reforecast-navigate'){A.go(e.data.view||'reforecast');if(e.data.scenarioId||e.data.reviewId)setTimeout(async()=>{try{const m=await import('./features/reforecast-ui.mjs?v=018b2b0c44363ea5'),container=document.getElementById('atlas-reforecast-workspace');if(!container)return;await m.mountReforecast(container,{R,mode:'approvals'});await m.openBudgetReview(e.data);}catch(error){A.toast(error.message,'r');}},0);}});
 document.addEventListener('atlas-create-reforecast',async event=>{try{const m=await import('./features/reforecast-ui.mjs?v=018b2b0c44363ea5');A.go('reforecast');const container=document.getElementById('atlas-reforecast-workspace');if(!container)throw Error('The Working Drafts view is unavailable.');await m.mountReforecast(container,{R,mode:'workspace'});await m.createRecommendedReforecast(event.detail);document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());A.go('reforecast');}catch(error){A.toast(error.message,'r');}});
 const route=location.hash.slice(1);if(routes.some(r=>r[0]===route))A.go(route);else if(A.state)A.render();
})(window.RBB);
