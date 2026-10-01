import {executeHistory} from './import-history-store.mjs?v=4d1d50d553719464';
export async function historyOperation(request) {
  if(typeof Worker==='undefined') return executeHistory(request);
  let worker;
  try {worker=new Worker(new URL('./import-history-worker.mjs?v=91296a7b714726a2',import.meta.url),{type:'module'});}
  catch {return executeHistory(request);}
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error('Import history storage timed out. Retry before leaving this tab.')),120000);
    const finish=(error,value)=>{clearTimeout(timer);worker.terminate();error?reject(error):resolve(value);};
    worker.onmessage=({data})=>finish(data.ok?null:new Error(data.error),data.value);
    // Never retry an uncertain write: the transaction may already have committed.
    worker.onerror=()=>finish(new Error('Import history worker failed. Reload before retrying.'));
    try {worker.postMessage(request);}catch(error){finish(error);}
  });
}
