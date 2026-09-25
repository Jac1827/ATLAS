(function(){
 'use strict';let modulePromise,cache,epoch=0;
 const load=()=>modulePromise ||= import('./features/reforecast-consumers.mjs?v=3e2dfc363e74a233');
 function clear(){epoch++;cache?.clear();document.querySelectorAll('[data-active-reforecast]').forEach(el=>el.remove());}
 const accessKey=()=>window.ATLAS_CENTRAL?.getAccessContextKey?.() ?? window.ATLAS_CENTRAL?.getSession?.()?.user?.id;
 let access=accessKey();
 window.addEventListener('atlas-central-auth-change',()=>{const next=accessKey();if(next!==access){access=next;clear();}});
 window.addEventListener('atlas-reforecast-updated',()=>{window.AtlasClosedFinancialCache?.clear();window.dispatchEvent(new Event('atlas-finance-updated'));window.renderTab?.();});
 window.addEventListener('atlas-finance-updated',clear);
 window.AtlasActiveReforecast={
  async read(communityId,period){const m=await load();cache ||= m.createActiveReforecastCache(window.ATLAS_CENTRAL);await cache.refresh([communityId],[period]);return m.activeBenchmark(cache.get(communityId,period),period);},
  async readMany(communityId,periods){const m=await load();cache ||= m.createActiveReforecastCache(window.ATLAS_CENTRAL);await cache.refresh([communityId],periods);return periods.map(period=>m.activeBenchmark(cache.get(communityId,period),period)).filter(Boolean);},
  async scout(communityId,period){const m=await load();cache ||= m.createActiveReforecastCache(window.ATLAS_CENTRAL);await cache.refresh([communityId],[period]);return m.scoutForecastEvidence(cache.get(communityId,period),period);},
  async mount(panel,{tab,communityName,communityId,period}={}){
   if(![2,8].includes(tab)||!communityName||!window.ATLAS_CENTRAL?.getSession()?.user||!window.atlasAccessDecision?.(tab)?.ok)return;
   const generation=epoch,el=document.createElement('section');el.dataset.activeReforecast='1';el.className='card mb4';el.style.cssText='padding:20px;overflow:auto';panel.append(el);
   try{const central=window.ATLAS_CENTRAL,m=await load();const [communities,aliases]=await Promise.all([central.readCommunitiesForAccess(),central.fetchJson('/atlas_community_aliases?active=eq.true&select=community_id,alias&limit=1000')]);const norm=v=>String(v||'').trim().toLowerCase(),ids=new Set(aliases.filter(a=>norm(a.alias)===norm(communityName)).map(a=>a.community_id));const matches=communities.filter(c=>c.community_id===communityId||norm(c.display_name)===norm(communityName)||norm(c.canonical_name)===norm(communityName)||ids.has(c.community_id));if(!el.isConnected||generation!==epoch)return;if(matches.length!==1){el.remove();return;}cache ||= m.createActiveReforecastCache(central);await m.mountActiveBenchmark(el,{central,communityId:matches[0].community_id,communityName,period,cache,openWorkspace:()=>{window.setTab?.(12);const frame=document.querySelector('iframe[src*="RISE-Budget-Builder"]');if(frame){const open=()=>frame.contentWindow.postMessage({type:'atlas-reforecast-navigate',view:'reforecastapprovals'},location.origin);frame.addEventListener('load',open,{once:true});open();}}});}catch(error){if(el.isConnected)el.textContent='Active reforecast unavailable: '+error.message;}
  }
 };
})();
