import {executeHistory} from './import-history-store.mjs?v=4c23a92990579aaa';
self.onmessage=async({data})=>{
  try {
    const value=await executeHistory({...data,onArchiveProgress:()=>self.postMessage({progress:true})});
    const transfer=data.operation==='exportPacked'?value.files.map(file=>file.bytes.buffer):[];
    self.postMessage({ok:true,value},transfer);
  }
  catch(error){self.postMessage({ok:false,error:String(error?.message||error),code:error?.code||null});}
};
