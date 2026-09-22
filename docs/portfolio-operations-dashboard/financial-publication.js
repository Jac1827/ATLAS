/* Period-scoped browser import cache. Accounting close and budget approval remain server-controlled. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.AtlasFinancialPublication=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const number=v=>v==null||typeof v==='boolean'||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
  const clone=v=>JSON.parse(JSON.stringify(v));
  const period=p=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p));
  function rows(input,kind){
    if(!Array.isArray(input)||!input.length)throw new Error('Financial publication requires nonempty detail rows.');
    const seen=new Set();
    return input.map(r=>{
      const glCode=String(r.glCode??r.gl??'').trim();
      const monthly=kind==='actual'?'monthlyActual':'monthlyBudget';
      const amount=number(Object.hasOwn(r,monthly)?r[monthly]:r[kind]);
      if(!glCode||seen.has(glCode)||amount===null)throw new Error('Each financial period requires unique GL codes and explicit numeric '+kind+' amounts.');
      if(/^(?:grand\s+)?(?:sub)?total\b/i.test(String(r.lineItem??r.name??'')))throw new Error('Publish GL detail without subtotal rows.');
      seen.add(glCode);return {...r,glCode,[kind]:amount,basis:'monthly'};
    });
  }
  function apply(record,packet){
    if(Array.isArray(packet.rows)) {
      const kind=packet.kind||'actuals';
      if(!['actuals','budget'].includes(kind))throw new Error('Actual or budget classification is required.');
      const file=String(packet.source||'Financial import');
      packet={...packet,[kind==='budget'?'budgets':'actuals']:packet.rows,source:{id:file,file}};
    }
    if(!period(packet.period))throw new Error('A year and reporting month are required.');
    if(!packet.source?.id||!packet.source?.file)throw new Error('Financial source identity and file are required.');
    const mode=packet.mode||'replace';if(!['replace','merge'].includes(mode))throw new Error('Unknown publication mode.');
    const next=clone(record||{}),p=packet.period;
    next.financialPublications=next.financialPublications||{};
    for(const [input,kind,ledgerKey] of [['actuals','actual','financialLedger'],['budgets','budget','financialBudgetLedger']]){
      if(packet[input]===undefined)continue;
      const incoming=rows(packet[input],kind),ledger=next[ledgerKey]||{},previous=ledger[p]||[];
      const combined=mode==='merge'?[...new Map([...(previous.length?rows(previous,kind):[]),...incoming].map(r=>[r.glCode,r])).values()]:incoming;
      const sorted=combined.slice().sort((a,b)=>a.glCode.localeCompare(b.glCode));
      const fingerprint=JSON.stringify(sorted.map(r=>[r.glCode,r[kind],r.section||'',r.nature||'']));
      const key=p+':'+kind,prior=next.financialPublications[key];
      if(prior?.fingerprint===fingerprint)continue;
      const effective=String(packet.source.effectiveAt||''),oldEffective=String(prior?.effectiveAt||'');
      if(oldEffective&&(!effective||effective<oldEffective))throw new Error('A newer dated financial publication already controls '+p+'.');
      if(prior&&effective&&effective===oldEffective)throw new Error('Conflicting financial values share the same effective date for '+p+'.');
      const history=[...(prior?.history||[])];
      if(previous.length)history.push({rows:clone(previous),source:prior?{...prior,history:undefined}:null});
      const stamp={...packet.source,period:p,kind,mode,fingerprint,history,publishedAt:new Date().toISOString()};
      next[ledgerKey]={...ledger,[p]:sorted};next.financialPublications[key]=stamp;
      next[kind==='actual'?'financialUpdatedAt':'financialBudgetUpdatedAt']=stamp.publishedAt;
    }
    return next;
  }
  function resolve(store,identity){
    const id=String(identity.communityId||''),name=String(identity.communityName||'').trim().toLowerCase();
    const matches=Object.entries(store||{}).filter(([key,r])=>{
      const ids=[r.communityId,r.community_id,r.communitySharedSyncMeta?.communityId,r.sourceIds?.communityId].filter(Boolean).map(String);
      return id?ids.includes(id):[key,r.propertyName,...(r.aliases||[])].some(n=>String(n||'').trim().toLowerCase()===name);
    });
    if(matches.length!==1)throw new Error('Select one existing canonical ATLAS community before publishing financials.');
    return matches[0][0];
  }
  // Read/modify/write inside one transaction, preventing another tab's unrelated
  // community fields from being replaced by a stale whole-store snapshot.
  function transact(db,identity,packets){return new Promise((resolvePromise,reject)=>{
    const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');let result,error;
    tx.oncomplete=()=>resolvePromise(result);tx.onerror=tx.onabort=()=>reject(error||tx.error||new Error('Financial publication was not saved.'));
    const req=store.get('community_data');req.onsuccess=()=>{try{
      const map=req.result?.value||{},key=resolve(map,identity);let record=map[key];
      for(const packet of packets)record=apply(record,packet);
      store.put({key:'community_data',value:{...map,[key]:record},updatedAt:new Date().toISOString()});
      result={ok:true,published:false,scope:"browser_cache",communityName:key,record};
    }catch(e){error=e;tx.abort();}};
  });}
  async function publish(community,publication){
    // The parent owns the live canonical map and authorized central synchronization.
    if(typeof window!=='undefined'){
      for(const host of [window.parent,window.opener]){
        try{if(host&&host!==window&&host.location.origin===window.location.origin&&typeof host.atlasPublishFinancialRows==='function')return await host.atlasPublishFinancialRows(community,publication);}catch(error){if(error.name!=='SecurityError')throw error;}
      }
    }
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('atlas_rise_state_v1',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('records'))request.result.createObjectStore('records',{keyPath:'key'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction('records','readwrite'),store=tx.objectStore('records'),request=store.get('community_data');
      let error;
      request.onsuccess=()=>{try{
        const map=request.result?.value||{};
        if(!map[community])throw Error('Select an existing canonical ATLAS community before publishing financial data.');
        map[community]=apply(map[community],publication);
        store.put({key:'community_data',value:map,updatedAt:new Date().toISOString()});
      }catch(e){error=e;tx.abort();}};
      tx.oncomplete=()=>{try{localStorage.setItem('atlas_financial_publication',JSON.stringify({community,at:Date.now()}));}catch(_){}resolve({ok:true,published:false,scope:"browser_cache"});};
      tx.onerror=tx.onabort=()=>reject(error||tx.error||Error('Financial publication failed.'));
    });}finally{db.close();}
  }
  return {number,rows,apply,resolve,transact,publish};
});
