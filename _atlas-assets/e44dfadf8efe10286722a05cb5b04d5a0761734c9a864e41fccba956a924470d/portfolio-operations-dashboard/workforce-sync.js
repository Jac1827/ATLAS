(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AtlasWorkforceSync=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 function create({readHeads,refresh,onStatus=()=>{}}){
  const versions=new Map();let running=null,epoch=0,actor=null;
  const state={status:'Pending Sync',lastAttempt:null,lastSuccess:null,error:null};
  const emit=()=>onStatus({...state});
  return {state,clear(){epoch++;actor=null;versions.clear();running=null;},async poll(user){
   if(!user)return;if(actor!==user){epoch++;versions.clear();running=null;actor=user;}
   if(running)return running;const token=epoch;
   running=(async()=>{state.lastAttempt=new Date().toISOString();try{
    const heads=await readHeads();if(token!==epoch)return;
    const changed=heads.filter(h=>!versions.has(h.employee_id)||Number(h.version)>versions.get(h.employee_id));
    const removed=[...versions.keys()].filter(id=>!heads.some(h=>h.employee_id===id));
    if(changed.length||removed.length){state.status='Pending Sync';emit();await refresh([...new Set([...changed.map(h=>h.employee_id),...removed])]);if(token!==epoch)return;}
    for(const h of changed)versions.set(h.employee_id,Number(h.version));for(const id of removed)versions.delete(id);
    state.status='Current';state.error=null;state.lastSuccess=new Date().toISOString();emit();
   }catch(e){if(token!==epoch)return;state.status='Pending Sync';state.error=e.message;emit();}
   finally{if(token===epoch)running=null;}})();return running;
  }};
 }
 return {create};
});
