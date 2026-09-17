/* Canonical, period-scoped financial publication. No source values are invented. */
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
      result={ok:true,communityName:key,record};
    }catch(e){error=e;tx.abort();}};
  });}
  return {number,rows,apply,resolve,transact};
});
