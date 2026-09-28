import {executeHistory} from './import-history-store.mjs?v=1b4de46ef620566c';
self.onmessage=async({data})=>{
  try {self.postMessage({ok:true,value:await executeHistory(data)});}
  catch(error){self.postMessage({ok:false,error:String(error?.message||error),code:error?.code||null});}
};
