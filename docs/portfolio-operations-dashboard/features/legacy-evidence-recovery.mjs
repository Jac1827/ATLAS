const stopped=()=>new DOMException('Your account or workspace changed. Preview the older local evidence again.','AbortError');
export function createLegacyEvidenceRecovery({central,getContext,onState=()=>{},workerFactory=()=>new Worker(new URL('./legacy-evidence-worker.js?v=6e3df0087b19bdd0',import.meta.url))}){
  let generation=0,active=null,preview=null,state={phase:'idle',message:'Preview and download older local import evidence without changing this workspace.'};
  const emit=next=>{state=Object.freeze(next);onState(state);};
  const identity=()=>{
    const session=central.getSession(),config=central.getConfig(),context=getContext();
    if(!context?.validated||!context.current||!session?.user?.id||!session.access_token||!Number.isFinite(Number(session.expires_at))||Number(session.expires_at)*1000<=Date.now())throw Error('A verified signed-in workspace is required.');
    return JSON.stringify({actor:session.user.id,backend:config.supabaseUrl,access:central.getAccessContextKey(),database:context.database,epoch:context.epoch});
  };
  const check=context=>{if(context.generation!==generation||context.controller.signal.aborted||identity()!==context.identity)throw stopped();};
  function cancel(message='Legacy evidence inspection stopped.'){
    generation++;active?.controller.abort(stopped());active=null;preview=null;emit({phase:'idle',message});
  }
  function accessChanged(){if(active||preview){try{check(active||preview.context);}catch{cancel('Your account or workspace changed. Preview the older local evidence again.');}}}
  async function freshAdmin(context){
    check(context);const profile=await central.fetchProfile({claim:false,signal:context.controller.signal});check(context);
    const session=central.getSession(),config=central.getConfig();
    if(profile?.user_id!==session?.user?.id||profile?.role!=='admin'||profile?.status!=='active'||(profile.account_status??'active')!=='active'||profile.access_backend!==config.supabaseUrl||!Number.isFinite(Date.parse(profile.access_verified_at))||!central.getAccessContextKey())throw Error('A currently verified active ATLAS administrator is required.');
  }
  function request(context,operation,expected){
    check(context);return new Promise((resolve,reject)=>{
      let worker,timer,settled=false;const signal=context.controller.signal;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);worker?.terminate();error?reject(error):resolve(value);};
      const abort=()=>finish(stopped());
      const wait=()=>{clearTimeout(timer);timer=setTimeout(()=>finish(Error('Legacy evidence inspection timed out. The older database was not changed.')),120000);};
      try{worker=workerFactory();signal.addEventListener('abort',abort,{once:true});wait();worker.onmessage=({data})=>{try{check(context);if(data.progress){wait();return;}finish(data.ok?null:Error(data.error),data.value);}catch(error){finish(error);}};worker.onerror=()=>finish(Error('Legacy evidence inspection failed. The older database was not changed.'));worker.postMessage({operation,expected});}catch(error){finish(error);}
    });
  }
  const start=()=>{active?.controller.abort();const context={generation:++generation,controller:new AbortController(),identity:identity()};active=context;return context;};
  const describe=summary=>summary.available?`${summary.batches} batches · ${summary.sources} source receipts · ${summary.sourceFiles} original files · ${summary.communityRecords} saved communities. Latest approval: ${summary.latestApprovedAt||'unavailable'}. No data was changed.`:summary.message;
  async function inspect(){
    if(active)return null;let context;
    try{preview=null;context=start();emit({phase:'checking',message:'Verifying administrator access and reading older local evidence…'});await freshAdmin(context);const summary=await request(context,'preview');await freshAdmin(context);check(context);active=null;preview=summary.available?{summary,context}:null;emit({phase:summary.available?'ready':'empty',message:describe(summary),summary});return summary;}
    catch(error){if(!context||context.generation===generation){active=null;preview=null;emit({phase:'error',message:error.message});}return null;}
  }
  async function exportCopy(){
    if(active||!preview)return null;const selected=preview;let context;
    try{check(selected.context);context=start();emit({phase:'exporting',message:'Preparing and verifying the complete original evidence download…',summary:selected.summary});await freshAdmin(context);const result=await request(context,'export',selected.summary);await freshAdmin(context);check(context);active=null;preview={summary:result.summary,context};emit({phase:'ready',message:describe(result.summary)+' Verified download: '+result.sha256.slice(0,12)+'.',summary:result.summary});return {...result,isCurrent:()=>{try{check(context);return true;}catch{return false;}}};}
    catch(error){if(!context||context.generation===generation){active=null;preview=null;emit({phase:'error',message:error.message});}return null;}
  }
  return {inspect,exportCopy,cancel,accessChanged,snapshot(){accessChanged();return state;}};
}
