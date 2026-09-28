import {executeHistory} from './import-history-store.mjs?v=4d1d50d553719464';
self.onmessage=async({data})=>{
  try {self.postMessage({ok:true,value:await executeHistory(data)});}
  catch(error){self.postMessage({ok:false,error:String(error?.message||error)});}
};
