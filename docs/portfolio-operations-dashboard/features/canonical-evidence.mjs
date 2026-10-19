// Only bounded archive parts cross the UI/worker boundary. Credentials stay in
// the authenticated central client and are never sent to or stored by workers.
export function initializeCanonicalEvidence({archive,options,readPart,beforeCommit,assertCurrent,signal,onProgress=()=>{},workerFactory=()=>new Worker(new URL('./canonical-evidence-worker.js',import.meta.url))}){
  assertCurrent();if(typeof Worker==='undefined'&&!workerFactory)throw Error('Background archive processing is unavailable');
  return new Promise((resolve,reject)=>{
    const worker=workerFactory();let settled=false,timer=null,cancelled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(value);};
    const deadline=()=>{clearTimeout(timer);timer=setTimeout(()=>{worker.postMessage({kind:'cancel'});finish(Error('Archive preparation stopped responding. Its activation could not be confirmed; reload before retrying.'));},120000);};
    const abort=()=>{cancelled=true;worker.postMessage({kind:'cancel'});deadline();};
    signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=()=>finish(Error('Background archive preparation failed. Reload before retrying.'));
    worker.onmessage=async({data})=>{
      if(settled)return;deadline();
      if(data.kind==='result'){
        if(cancelled){finish(signal?.reason||new DOMException('Workspace changed','AbortError'));return;}
        try{assertCurrent();finish(data.ok?null:Object.assign(Error(data.error),{name:data.name||'Error'}),data.value);}catch(error){finish(error);}return;
      }
      try{
        assertCurrent();if(cancelled||signal?.aborted)throw signal?.reason||new DOMException('Workspace changed','AbortError');
        if(data.kind==='progress'){onProgress(data.event);return;}
        if(data.kind==='part'){
          if(!Number.isInteger(data.index)||!archive.dataDocuments?.[data.index])throw Error('Invalid archive part request');
          const value=await readPart(archive.dataDocuments[data.index],signal);assertCurrent();
          if(!settled)worker.postMessage({kind:'response',id:data.id,value});
        }else if(data.kind==='commit'){
          await beforeCommit();assertCurrent();if(!settled)worker.postMessage({kind:'response',id:data.id,value:true});
        }
      }catch(error){cancelled=signal?.aborted||error?.name==='AbortError';if(!settled){if(cancelled)worker.postMessage({kind:'cancel'});else worker.postMessage({kind:'response',id:data.id,error:error.message});}}
    };
    deadline();
    if(signal?.aborted){finish(signal.reason||new DOMException('Workspace changed','AbortError'));return;}
    const transportArchive=typeof archive.data==='string'?{...archive,data:undefined,dataBlob:new Blob([archive.data],{type:'text/plain'})}:archive;
    worker.postMessage({kind:'initialize',archive:transportArchive,options});
  });
}
