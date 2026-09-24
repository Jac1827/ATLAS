// A short-lived worker owns only one integrity calculation; no storage or network writes.
self.onmessage=async({data})=>{
  try {
    const {digest}=await import('./workspace-canonical.mjs?v=dbb5eb39e5af90c5');
    self.postMessage({ok:true,contentHash:await digest(data)});
  } catch(error) { self.postMessage({ok:false,error:String(error?.message||error)}); }
};
