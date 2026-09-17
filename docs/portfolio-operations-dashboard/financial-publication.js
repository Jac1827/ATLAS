(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;root.AtlasFinancialPublication=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const number=value=>value===null||value===undefined||String(value).trim()===''||!Number.isFinite(Number(value))?null:Number(value);
  const rowKey=row=>JSON.stringify([row.glCode||row.gl||'',row.section||'',row.lineItem||row.name||'']);
  function apply(record,publication){
    const {period,rows,source='',kind='actuals',mode='replace'}=publication;
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('A valid financial reporting month is required.');
    if(!['actuals','budget'].includes(kind)||!Array.isArray(rows)||!rows.length)throw Error('Financial rows and their actual/budget classification are required.');
    const key=kind==='budget'?'financialBudgetLedger':'financialLedger';
    const previous=record[key]?.[period]||[];
    const byKey=new Map(mode==='merge'?previous.map(row=>[rowKey(row),row]):[]);
    for(const row of rows)byKey.set(rowKey(row),{...row,sourceFile:source,period});
    const next=[...byKey.values()];
    if(JSON.stringify(previous)===JSON.stringify(next))return record;
    const at=new Date().toISOString();
    return {...record,[key]:{...record[key],[period]:next},financialUpdatedAt:at,
      financialPublicationHistory:[...(record.financialPublicationHistory||[]),{period,kind,source,importedAt:at,previousRows:previous}].slice(-100)};
  }
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
      tx.oncomplete=()=>{try{localStorage.setItem('atlas_financial_publication',JSON.stringify({community,at:Date.now()}));}catch(_){}resolve({ok:true});};
      tx.onerror=tx.onabort=()=>reject(error||tx.error||Error('Financial publication failed.'));
    });}finally{db.close();}
  }
  return {number,apply,publish};
});
