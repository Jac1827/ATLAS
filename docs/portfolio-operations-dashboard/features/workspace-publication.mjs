import {sourceIdentity,projectionKey,publishProjection} from './workspace-bootstrap.mjs?v=565a4933bd9ac913';

// Called only after an explicit parent archive publication or its exact retry.
// A failed second step must never masquerade as a failed parent write: the UI
// retains this receipt and retries the projection, not the financial archive.
export async function ensureWorkspaceProjection(central,{document,archive,signal}={}) {
  const source=sourceIdentity(document);
  const receipt={parentSaved:true,source,projectionKey:projectionKey(source)};
  try {
    const value=await publishProjection(central,document,{archive,signal});
    return {...receipt,status:'complete',projectionVerified:true,contentHash:value.contentHash};
  } catch(error) {
    return {...receipt,status:'archive_saved_projection_pending',projectionVerified:false,message:String(error?.message||'The startup projection could not be verified. Retry this saved source.')};
  }
}
