import {executeHistory} from './import-history-store.mjs?v=e61d12d36e6cf36a';
const READS=new Set(['legacy','load','current','page','snapshot','records','export','exportPacked','recordExportPacked','preferenceValues']);
export async function historyOperation(request) {
  const {signal,onProgress,onArchiveProgress,...payload}=request;
  const progress=event=>{if(signal?.aborted)return;const value={...event,phase:event?.phase||'packing'};onProgress?.(value);onArchiveProgress?.(value);};
  const local=()=>executeHistory({...request,onArchiveProgress:progress});
  if(signal?.aborted)throw signal.reason||new DOMException('Import history read cancelled','AbortError');
  if(typeof Worker==='undefined')return local();
  let worker;
  try {worker=new Worker(new URL('./import-history-worker.mjs?v=86e8d7f4dcae41b9',import.meta.url),{type:'module'});}
  catch {return local();}
  return new Promise((resolve,reject)=>{
    let settled=false;
    const read=READS.has(request.operation);
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(value);};
    const abort=()=>finish(signal.reason||new DOMException('Import history read cancelled','AbortError'));
    const timeout=()=>finish(Object.assign(new Error(read?'Import history storage timed out. Retry loading.':'Import history save could not be confirmed. Reload before making another change.'),{code:read?'history_read_timeout':'history_write_uncertain',uncertain:!read}));
    let timer=setTimeout(timeout,120000);
    worker.onmessage=({data})=>{
      if(settled)return;
      if(['exportPacked','recordExportPacked'].includes(request.operation)&&data.progress===true){clearTimeout(timer);timer=setTimeout(timeout,120000);progress(data.detail);return;}
      finish(data.ok?null:Object.assign(new Error(data.error),{code:data.code}),data.value);
    };
    // Accepted writes must settle. Cancelling a view never cancels or retries its pending commit.
    worker.onerror=()=>finish(Object.assign(new Error(read?'Import history worker failed. Reload before retrying.':'Import history save could not be confirmed. Reload before making another change.'),{code:read?'history_read_failed':'history_write_uncertain',uncertain:!read}));
    if(read)signal?.addEventListener('abort',abort,{once:true});
    try {worker.postMessage(payload);}catch(error){
      // A synchronous clone failure means the worker never accepted the job.
      // Large retained archives can exceed Chrome's transfer memory even when
      // the existing bounded storage implementation can process them in place.
      if(error?.name==='DataCloneError'&&/out of memory/i.test(error.message||'')){
        settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();
        local().then(resolve,reject);
      }else finish(error);
    }
  });
}
