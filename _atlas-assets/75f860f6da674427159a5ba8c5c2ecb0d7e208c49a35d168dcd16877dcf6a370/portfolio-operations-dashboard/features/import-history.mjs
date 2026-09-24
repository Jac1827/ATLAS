import {executeHistory} from './import-history-store.mjs?v=1b4de46ef620566c';
const READS=new Set(['load','current','page','snapshot','records','export','preferenceValues']);
export async function historyOperation(request) {
  const {signal,...payload}=request;
  if(signal?.aborted)throw signal.reason||new DOMException('Import history read cancelled','AbortError');
  if(typeof Worker==='undefined')return executeHistory(request);
  let worker;
  try {worker=new Worker(new URL('./import-history-worker.mjs?v=cc60d969bd5c4820',import.meta.url),{type:'module'});}
  catch {return executeHistory(request);}
  return new Promise((resolve,reject)=>{
    let settled=false;
    const read=READS.has(request.operation);
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(value);};
    const abort=()=>finish(signal.reason||new DOMException('Import history read cancelled','AbortError'));
    const timer=setTimeout(()=>finish(Object.assign(new Error(read?'Import history storage timed out. Retry loading.':'Import history save could not be confirmed. Reload before making another change.'),{code:read?'history_read_timeout':'history_write_uncertain',uncertain:!read})),120000);
    worker.onmessage=({data})=>finish(data.ok?null:Object.assign(new Error(data.error),{code:data.code}),data.value);
    // Accepted writes must settle. Cancelling a view never cancels or retries its pending commit.
    worker.onerror=()=>finish(Object.assign(new Error(read?'Import history worker failed. Reload before retrying.':'Import history save could not be confirmed. Reload before making another change.'),{code:read?'history_read_failed':'history_write_uncertain',uncertain:!read}));
    if(read)signal?.addEventListener('abort',abort,{once:true});
    try {worker.postMessage(payload);}catch(error){finish(error);}
  });
}
