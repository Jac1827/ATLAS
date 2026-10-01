import {executeHistory} from './import-history-store.mjs?v=a5aa94c91809b279';
self.onmessage=async({data})=>{
  try {self.postMessage({ok:true,value:await executeHistory(data)});}
  catch(error){self.postMessage({ok:false,error:String(error?.message||error),code:error?.code||null});}
};
