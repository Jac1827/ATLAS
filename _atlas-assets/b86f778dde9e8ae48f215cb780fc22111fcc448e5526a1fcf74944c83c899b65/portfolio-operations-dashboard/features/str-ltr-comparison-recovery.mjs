import {canonicalJson} from './financial-snapshot.mjs?v=848d058bdec07b4e';
const clone=structuredClone;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const editKey=record=>canonicalJson({name:record?.name,scenario:record?.scenario,inputs:record?.inputs});
const sameProperty=(record,property)=>record?.propertyId===property?.id||record?.inputs?.program?.selectedPropertyId===property?.id;
const download=(bytes,name)=>{const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

/** Recovery copies never replace a source programme or an existing comparison.
 * Restore verifies the latest pending edit, saves a new identity, then releases
 * only that exact recovery version after its replacement is read back. */
export function createComparisonRecovery({store,getProperty,getRecord,openRecord,flush,onError=()=>{},onMessage=()=>{}}){
 let sequence=0,busy=false,lastError='';
 function guardProperty(property){store.guard?.();if(getProperty()?.id!==property?.id)throw Error('The selected property changed. Reopen its comparison recovery.');}
 async function list(){const property=clone(getProperty());if(!property)return [];guardProperty(property);const rows=await store.listRecovery(property);guardProperty(property);return rows.filter(row=>sameProperty(row.record,property));}
 function backup(record=getRecord()){
  store.guard?.();const property=getProperty();if(!record||!sameProperty(record,property))throw Error('Open a comparison for the selected property before downloading its recovery copy.');
  return {name:'RISE_STR_LTR_'+String(record.name||'comparison').replace(/[^a-z0-9_-]+/gi,'_')+'_recovery.json',bytes:JSON.stringify({format:'atlas.str-ltr-comparison-recovery',version:1,exportedAt:new Date().toISOString(),authority:'browser_working_comparison',record:clone(record)},null,2)};
 }
 async function restore(id,recoveryVersion){
  if(busy)throw Error('A comparison recovery is already being saved.');busy=true;
  try{
   const property=clone(getProperty());guardProperty(property);
   let pending=(await list()).find(row=>row.record.id===id&&row.recoveryVersion===recoveryVersion);
   if(!pending)throw Error('This pending edit changed. Refresh recovery and select its newest retained copy.');
   const current=getRecord();
   // A stale tab often cannot update its old identity. If it is the same exact
   // edit, saving the new recovery identity preserves it without a conflict.
   if(current&&editKey(current)!==editKey(pending.record)){await flush?.();guardProperty(property);pending=(await list()).find(row=>row.record.id===id&&row.recoveryVersion===recoveryVersion);if(!pending)throw Error('The pending edit changed while the open comparison saved. Refresh recovery.');}
   const restored=await store.duplicate(pending.record,pending.record.name+' — recovered');guardProperty(property);
   await store.completeRecovery?.({id,recoveryVersion,replacement:restored});guardProperty(property);
   await openRecord(restored);onMessage('Recovered as a new comparison. Saved in this browser.');return restored;
  }finally{busy=false;}
 }
 async function mount(host,{saveState}={}){
  const token=++sequence,property=clone(getProperty());if(!host||!property)return;
  let section=host.querySelector?.('[data-comparison-recovery]');if(!section){section=document.createElement('section');section.className='cmp-panel';section.dataset.comparisonRecovery='true';(host.querySelector?.('.str-ltr')||host).appendChild(section);}
  const current=()=>token===sequence&&getProperty()?.id===property.id&&section.isConnected;
  const show=(rows,error)=>{
   if(!current())return;
   section.hidden=!rows.length&&!error&&saveState!=='failed';
   section.innerHTML='<h2>Comparison recovery</h2><p class="cmp-note">Pending edits are retained for this signed-in account and property. Recovery creates a new editable comparison.</p>'+(error?'<p class="cmp-alert" role="alert">'+esc(error)+'</p>':'')+(rows.length?'<div>'+rows.map((row,index)=>'<p><strong>'+esc(row.record.name)+'</strong> · '+esc(row.updatedAt)+' <button data-recover-comparison="'+index+'">Restore as new comparison</button> <button data-download-pending="'+index+'">Download pending edit</button></p>').join('')+'</div>':'<p>No pending comparison edits are stored for this property.</p>')+(getRecord()?'<button data-download-open-comparison>Download open comparison recovery</button> ':'')+'<button data-refresh-comparison-recovery>Refresh recovery</button>';
   const handle=action=>async event=>{event.currentTarget.disabled=true;try{guardProperty(property);await action();}catch(e){lastError=e.message;onError(e);if(current())show(rows,lastError);}};
   section.querySelectorAll('[data-recover-comparison]').forEach(button=>button.onclick=handle(async()=>{const row=rows[Number(button.dataset.recoverComparison)];await restore(row.record.id,row.recoveryVersion);lastError='';}));
   section.querySelectorAll('[data-download-pending]').forEach(button=>button.onclick=handle(async()=>{const selected=rows[Number(button.dataset.downloadPending)],fresh=(await list()).find(row=>row.record.id===selected.record.id&&row.recoveryVersion===selected.recoveryVersion);if(!fresh)throw Error('The pending edit changed. Refresh recovery before downloading.');const file=backup(fresh.record);download(file.bytes,file.name);button.disabled=false;}));
   const open=section.querySelector('[data-download-open-comparison]');if(open)open.onclick=handle(()=>{const file=backup();download(file.bytes,file.name);open.disabled=false;});
   section.querySelector('[data-refresh-comparison-recovery]').onclick=()=>mount(host,{saveState});
  };
  try{const rows=await list();lastError='';show(rows,'');}catch(error){lastError=error.message;show([],lastError);}
 }
 return {list,backup,restore,mount};
}
