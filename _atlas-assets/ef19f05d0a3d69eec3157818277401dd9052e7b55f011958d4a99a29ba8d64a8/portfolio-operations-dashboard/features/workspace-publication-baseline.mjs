import {accessNamespace,readWorkspace,sourceIdentity,stableJson} from './workspace-bootstrap.mjs?v=99b459d64e31f2cb';

// Scoped startup already captures a verified central ancestor. Reuse that
// ancestor only when the current authenticated read proves its exact identity;
// observing a newer version must never authorize replacing it with local data.
export async function capturePublicationBaseline(central,{documentKey,dbName,readSource,current,signal}) {
  const check=()=>{if(signal?.aborted||!current())throw new DOMException('Workspace changed','AbortError');};
  const retainedIdentity=value=>({identity:value?.identity,binding:value?.binding,contentHash:value?.contentHash});
  check();
  const profile=await central.fetchProfile({claim:false,signal});check();
  if(await accessNamespace(central,profile)!==dbName)throw new Error('The authenticated workspace scope changed. Reload before publishing.');
  check();
  const stored=await readSource();check();
  if(!stored?.identity||stored.identity.documentKey!==documentKey||!stored.binding?.fullProjection)throw new Error('This browser has no complete verified central ancestor. Reconcile its retained evidence before publishing.');
  const baseline=stableJson(retainedIdentity(stored));
  const workspace=await readWorkspace(central,{signal});check();
  if(!workspace.binding.fullProjection||stableJson(retainedIdentity({identity:workspace.source,binding:workspace.binding,contentHash:workspace.projection.contentHash}))!==baseline)throw new Error('The central source or access scope changed. Reconcile local changes before publishing.');
  return {
    version:workspace.source.version,
    async assertRemote(document){
      check();
      if(stableJson(sourceIdentity(document))!==stableJson(workspace.source))throw new Error('The central source changed while preparing this snapshot. Reconcile before publishing.');
      if(stableJson(retainedIdentity(await readSource()))!==baseline)throw new Error('The local central ancestor changed while preparing this snapshot. Reload before publishing.');
      check();
    }
  };
}
