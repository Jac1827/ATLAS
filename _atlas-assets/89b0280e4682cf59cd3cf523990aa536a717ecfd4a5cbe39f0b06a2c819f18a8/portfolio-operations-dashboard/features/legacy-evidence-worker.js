// The worker reads only the fixed legacy database. It never opens live scoped storage.
importScripts('../vendor/jszip.min.js?v=acc7e41455a80765','../migration-archive.js?v=ab39d3a4205b4424');
self.onmessage=async({data})=>{
  try{
    const store=await import('./legacy-evidence-store.mjs?v=1f61a04b91f92357');
    const value=data.operation==='preview'?await store.inspectLegacyEvidence():data.operation==='export'?await store.exportLegacyEvidence({expected:data.expected,archive:AtlasMigrationArchive,Zip:JSZip,onProgress:()=>self.postMessage({progress:true})}):null;
    if(!value)throw Error('Unknown legacy evidence operation.');self.postMessage({ok:true,value});
  }catch(error){self.postMessage({ok:false,error:String(error?.message||error)});}
};
