import {executeHistory} from './import-history-store.mjs?v=a6b66788f0869de9';
self.onmessage=async({data})=>{
  try {self.postMessage({ok:true,value:await executeHistory(data)});}
  catch(error){self.postMessage({ok:false,error:String(error?.message||error),code:error?.code||null});}
};
