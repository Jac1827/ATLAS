/* Lazy governed reforecast routes inside the existing Budget Builder shell. */
(function(R){
 'use strict';if(!R?.app)return;const A=R.app;
 const routes=[['reforecast','Working Reforecast','workspace'],['reforecastapprovals','Approval Center','approvals'],['reforecastgap','Budget reports & print','gap']];
 for(const [id,label,mode] of routes){A.VIEWS.push({id,label});R.views[id]=()=>{setTimeout(async()=>{const el=document.getElementById('atlas-reforecast-workspace');if(!el)return;try{const m=await import('./features/reforecast-ui.mjs?v=13a4e76896572e66');if(el.isConnected)await m.mountReforecast(el,{R,mode});}catch(e){el.textContent='Reforecast workspace could not load: '+e.message;}},0);return '<div id="atlas-reforecast-workspace" role="region" aria-label="Governed reforecast"><p>Loading shared reforecast workspace…</p></div>';};}
 R.budgetNavigation?.groups.find(g=>g[0]==='forecast')?.[2].push('reforecast','reforecastapprovals');
 R.budgetNavigation?.groups.find(g=>g[0]==='reports')?.[2].push('reforecastgap');
 import('./features/reforecast-legacy-bridge.mjs?v=c8f47fac67515849').then(m=>m.installLegacyReforecastBridge(R)).catch(e=>A.toast('Scenario calculator failed: '+e.message,'r'));
 const clearScope=()=>{delete R.reforecastSources;delete R.reforecastPropertyAssignments;import('./features/reforecast-legacy-bridge.mjs?v=c8f47fac67515849').then(m=>m.clearLegacyReforecastCache());import('./features/reforecast-ui.mjs?v=13a4e76896572e66').then(m=>m.clearReforecastSession());};
 window.parent.addEventListener('atlas-central-auth-change',clearScope);
 const originalPublish=A.publishToAtlas;
 A.publishToAtlas=function(){if(A.scenario().type!=='approved'){A.go('reforecast');A.toast('Select the shared locked reforecast and designate it Active after review.');return;}return originalPublish.apply(this,arguments);};
 window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent)return;if(e.data?.type==='atlas-reforecast-navigate')A.go(e.data.view||'reforecast');});
 const route=location.hash.slice(1);if(routes.some(r=>r[0]===route))A.go(route);else if(A.state)A.render();
})(window.RBB);
