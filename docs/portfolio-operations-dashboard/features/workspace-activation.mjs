import {ensureWorkspaceProjection} from './workspace-publication.mjs?v=19c656fa112d9b6a';
import {sourceIdentity,projectionKey,stableJson,verifyProjection} from './workspace-bootstrap.mjs?v=36662b19758a7fa9';

const PARENT='atlas_dashboard_state_v1';
const stopped=()=>new DOMException('Preparation stopped. Check the saved source again.','AbortError');
export function expectedWorkspaceSource({version,archiveHash}={}) {
  const text=String(version??'').trim(),hash=String(archiveHash??'').trim().toLowerCase();
  if(!/^[1-9][0-9]*$/.test(text)||!Number.isSafeInteger(Number(text))||!/^[a-f0-9]{64}$/.test(hash))throw Error('Enter the independently verified source version and 64-character fingerprint.');
  return Object.freeze({version:Number(text),archiveHash:hash});
}
const principal=central=>{
  const session=central.getSession(),config=central.getConfig();
  if(!session?.user?.id||!session.access_token||!Number.isFinite(Number(session.expires_at))||Number(session.expires_at)*1000<=Date.now())throw Error('Sign in to ATLAS, then check the saved source again.');
  return stableJson({actor:session.user.id,backend:config.supabaseUrl,api:config.apiBaseUrl||'',document:config.documentKey});
};
function requireParent(document,expected,source) {
  if(document?.document_key!==PARENT||document.module_key!=='dashboard'||document.deleted_at)throw Error('The saved workspace source is unavailable.');
  const current=sourceIdentity(document);
  if(current.version!==expected.version||current.archiveHash!==expected.archiveHash||!Number.isFinite(Date.parse(current.effectiveAt))||source&&stableJson(current)!==stableJson(source))throw Error('The saved source does not match the verified version and fingerprint. Verify the current source before continuing.');
  return current;
}

// The only write capability passed to the established materializer is its
// source-bound publisher. No archive save/restore or operational storage API.
export function createWorkspaceActivation(central,{onState=()=>{}}={}) {
  let generation=0,controller=null,verified=null,prepared=null,busy=false,activeContext=null;
  const emit=value=>onState(Object.freeze(value));
  function cancel(message='Preparation stopped. Check the saved source again.') {
    generation++;controller?.abort(stopped());controller=null;verified=null;prepared=null;busy=false;activeContext=null;
    emit({phase:'stopped',message});
  }
  function start() {
    controller?.abort(stopped());controller=new AbortController();busy=true;
    activeContext={generation:++generation,signal:controller.signal,principal:principal(central),access:null};return activeContext;
  }
  function check(context) {
    if(context.generation!==generation||context.signal.aborted||principal(central)!==context.principal||context.access!==null&&central.getAccessContextKey()!==context.access)throw stopped();
  }
  function accessChanged() {
    if(!activeContext)return;
    // Routine token refreshes and identical cross-tab profile reads preserve
    // the operation. Revocation, expiry, actor, backend or scope changes do not.
    try{check(activeContext);}catch{cancel('Your sign-in or access changed. Check the saved source again.');}
  }
  async function freshAdmin(context) {
    check(context);
    const profile=await central.fetchProfile({claim:false,signal:context.signal});check(context);
    const session=central.getSession(),config=central.getConfig();
    if(profile?.user_id!==session?.user?.id||profile?.role!=='admin'||profile?.status!=='active'||(profile?.account_status??'active')!=='active'||profile.access_backend!==config.supabaseUrl||!Number.isFinite(Date.parse(profile.access_verified_at)))throw Error('A current, active administrator account is required.');
    const access=central.getAccessContextKey();if(!access)throw Error('Administrator access could not be verified.');
    if(context.access!==null&&context.access!==access)throw stopped();
    context.access=access;return profile;
  }
  async function inspect(input) {
    if(busy)return null;
    let context;
    try {
      verified=null;prepared=null;const expected=expectedWorkspaceSource(input);context=start();
      emit({phase:'checking',message:'Checking your access and the saved source…'});
      await freshAdmin(context);
      const document=await central.readDocument(PARENT,{signal:context.signal});check(context);
      const source=requireParent(document,expected);
      verified={expected,source,principal:context.principal,access:context.access};busy=false;
      emit({phase:'ready',message:'The saved source matches. You can now prepare the verified workspace.',source});return source;
    } catch(error) {
      if(!context||context.generation===generation){busy=false;verified=null;emit({phase:'error',message:'The source is not ready for preparation.',detail:error.message});}
      return null;
    }
  }
  async function prepare() {
    if(busy||!verified)return null;
    const approved=verified;verified=null;let context;
    try {
      context=start();context.access=approved.access;
      if(context.principal!==approved.principal)throw stopped();check(context);
      emit({phase:'preparing',message:'Preparing and verifying the workspace. Keep this page open.',source:approved.source});
      await freshAdmin(context);
      const document=await central.readDocument(PARENT,{signal:context.signal});check(context);
      requireParent(document,approved.expected,approved.source);
      const allowedReads=new Set([PARENT,projectionKey(approved.source),...(document.payload.bundle.dataDocuments||[]).map(ref=>ref.documentKey)]);
      const guarded={
        async readDocument(key) {
          check(context);if(!allowedReads.has(key))throw Error('Unexpected source read.');
          const row=await central.readDocument(key,{signal:context.signal});check(context);
          if(key===PARENT)requireParent(row,approved.expected,approved.source);
          return row;
        },
        async rpc(name,args) {
          check(context);
          if(name!=='atlas_publish_workspace_projection'||stableJson(args?.p_projection?.source)!==stableJson(approved.source))throw Error('Unexpected workspace preparation request.');
          await freshAdmin(context);
          await guarded.readDocument(PARENT);check(context);
          const receipt=await central.rpc(name,args,{signal:context.signal,beforeWrite:()=>check(context)});check(context);
          return receipt;
        }
      };
      const receipt=await ensureWorkspaceProjection(guarded,{document,signal:context.signal});check(context);
      if(receipt.status!=='complete'||receipt.projectionVerified!==true)throw Error(receipt.message||'The prepared workspace could not be verified.');
      await freshAdmin(context);await guarded.readDocument(PARENT);check(context);busy=false;
      prepared={...approved,receipt};
      emit({phase:'complete',message:'The verified workspace is prepared. Its saved copy has been checked.',source:approved.source,receipt});return receipt;
    } catch(error) {
      if(!context||context.generation===generation){busy=false;emit({phase:'pending',message:'Preparation is pending. Check the saved source before trying again.',detail:error.message});}
      return null;
    }
  }
  async function verificationCopy() {
    if(busy||!prepared)return null;
    const completed=prepared;let context;
    try {
      context=start();context.access=completed.access;
      if(context.principal!==completed.principal)throw stopped();check(context);
      emit({phase:'exporting',message:'Checking the saved copy for download…',source:completed.source});
      await freshAdmin(context);
      const readParent=async()=>{const row=await central.readDocument(PARENT,{signal:context.signal});check(context);requireParent(row,completed.expected,completed.source);return row;};
      await readParent();
      const key=projectionKey(completed.source),row=await central.readDocument(key,{signal:context.signal});check(context);
      if(row?.document_key!==key||row.module_key!=='dashboard'||row.source_module!=='workspace_projection'||row.deleted_at||!Number.isSafeInteger(row.version)||row.version<1||row.payload?.contentHash!==completed.receipt.contentHash)throw Error('The saved verification copy changed. Check and prepare this source again.');
      const projection=await verifyProjection(row.payload,completed.source);check(context);
      await freshAdmin(context);const parent=await readParent();check(context);
      // This receipt describes only these completed source/access checks. It is
      // not a promise that the source remains current after the capture time.
      const capturedAt=new Date().toISOString(),{data:inlineBody,...archive}=parent.payload.bundle;
      const envelope={format:'atlas_workspace_verification_v1',capturedAt,source:completed.source,sourceCurrentAtCapture:true,projection,parent:{document_key:parent.document_key,module_key:parent.module_key,version:parent.version,updated_at:parent.updated_at,archive},verification:{projectionKey:key,projectionDocumentVersion:row.version,projectionContentHash:projection.contentHash,parentVersion:parent.version,archiveSha256:archive.sha256,activeAdminVerified:true,sourceIdentityMatches:true,archiveBodyIncluded:false}};
      busy=false;emit({phase:'complete',message:'The verification copy is ready. Its source was current when checked.',source:completed.source,receipt:completed.receipt});return envelope;
    } catch(error) {
      if(!context||context.generation===generation){busy=false;prepared=null;emit({phase:'pending',message:'The verification copy is unavailable. Check the saved source before trying again.',detail:error.message});}
      return null;
    }
  }
  return Object.freeze({inspect,prepare,cancel,accessChanged,verificationCopy});
}

export function mountWorkspaceActivation(root,central=window.ATLAS_CENTRAL) {
  const find=id=>root.querySelector('#'+id),form=find('activation-form'),version=find('activation-version'),hash=find('activation-hash'),inspect=find('activation-inspect'),prepare=find('activation-prepare'),download=find('activation-download'),cancel=find('activation-cancel');
  const params=new URLSearchParams(window.location.hash.slice(1));
  version.value=params.get('version')||'';hash.value=params.get('archiveHash')||'';
  if(!central){inspect.disabled=true;find('activation-status').textContent='ATLAS access could not load. Reload this page to try again.';return;}
  const activation=createWorkspaceActivation(central,{onState(state){
    const busy=state.phase==='checking'||state.phase==='preparing'||state.phase==='exporting';
    inspect.disabled=busy;prepare.disabled=state.phase!=='ready';download.disabled=state.phase!=='complete';cancel.disabled=!busy&&state.phase!=='ready';version.disabled=hash.disabled=busy;
    find('activation-status').textContent=state.message;find('activation-status').dataset.phase=state.phase;
    find('activation-source').hidden=!state.source;find('activation-source').textContent=state.source?`Saved version ${state.source.version} · ${state.source.effectiveAt}\nFingerprint: ${state.source.archiveHash}`:'';
    find('activation-details').hidden=!state.detail;find('activation-detail').textContent=state.detail||'';
  }});
  form.addEventListener('submit',event=>{event.preventDefault();void activation.inspect({version:version.value,archiveHash:hash.value});});
  prepare.addEventListener('click',()=>{void activation.prepare();});cancel.addEventListener('click',()=>activation.cancel());
  download.addEventListener('click',async()=>{
    const envelope=await activation.verificationCopy();if(!envelope)return;
    activation.accessChanged();if(download.disabled)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(envelope)],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download=`atlas_current_source_verification_v${envelope.source.version}_${envelope.capturedAt.replace(/[:.]/g,'-')}.json`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  for(const input of [version,hash])input.addEventListener('input',()=>activation.cancel('Source details changed. Check the saved source again.'));
  window.addEventListener('atlas-central-auth-change',()=>activation.accessChanged());
  window.addEventListener('pagehide',()=>activation.cancel(),{once:true});
  window.addEventListener('hashchange',()=>{activation.cancel('Source details changed. Check the saved source again.');const next=new URLSearchParams(window.location.hash.slice(1));version.value=next.get('version')||'';hash.value=next.get('archiveHash')||'';});
  return activation;
}
if(typeof document!=='undefined'){
  const root=document.getElementById('workspace-activation');if(root)mountWorkspaceActivation(root);
}
