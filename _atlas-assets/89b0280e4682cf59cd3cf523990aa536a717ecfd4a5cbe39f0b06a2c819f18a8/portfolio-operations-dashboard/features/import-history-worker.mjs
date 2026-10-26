import {executeHistory} from './import-history-store.mjs?v=e61d12d36e6cf36a';
self.onmessage=async({data})=>{
  try {
    const value=await executeHistory({...data,onArchiveProgress:detail=>self.postMessage({progress:true,detail})});
    const transfer=['exportPacked','recordExportPacked'].includes(data.operation)?value.files.map(file=>file.bytes.buffer):[];
    self.postMessage({ok:true,value},transfer);
  }
  catch(error){self.postMessage({ok:false,error:String(error?.message||error),code:error?.code||null});}
};
