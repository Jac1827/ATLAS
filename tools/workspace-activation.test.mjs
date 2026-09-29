import assert from 'node:assert/strict';
import {createWorkspaceActivation,expectedWorkspaceSource} from '../docs/portfolio-operations-dashboard/features/workspace-activation.mjs';
import {projectionKey} from '../docs/portfolio-operations-dashboard/features/workspace-bootstrap.mjs';

const hash='a'.repeat(64),expected={version:2,archiveHash:hash};
const parent={document_key:'atlas_dashboard_state_v1',module_key:'dashboard',version:2,updated_at:'2026-09-29T12:00:00Z',payload:{bundle:{bundleType:'atlas_migration_archive_v1',sha256:hash,bytes:3,recordCount:1,data:'eHl6'}}};
let beforeBuild=null;
globalThis.window={AtlasFeatures:{load:async()=>{}},AtlasMigrationArchive:{hydrate:async archive=>archive}};
globalThis.Worker=class {
  postMessage({source}){queueMicrotask(async()=>{await beforeBuild?.();if(!this.closed)this.onmessage({data:{ok:true,value:{format:1,source,communityData:{Example:{zero:0,absent:null}},opsGlobalData:{},importState:{}}}});});}
  terminate(){this.closed=true;}
};
function fixture(){
  const state={actor:'admin',role:'admin',status:'active',account:'active',backend:'https://synthetic.invalid',scope:'initial',expires_at:Date.now()/1000+3600,profileReads:0,writes:[],states:[],documents:new Map([[parent.document_key,structuredClone(parent)]]),beforeProfile:null,beforeRpc:null,afterRpc:null};
  const client={getSession:()=>({user:{id:state.actor},access_token:'synthetic',expires_at:state.expires_at}),getConfig:()=>({supabaseUrl:state.backend,documentKey:parent.document_key}),getAccessContextKey:()=>JSON.stringify([state.actor,state.role,state.status,state.account,state.backend,state.scope]),
    async fetchProfile(options){assert.equal(options.claim,false);assert(options.signal);state.profileReads++;await state.beforeProfile?.();return {user_id:state.actor,role:state.role,status:state.status,account_status:state.account,access_backend:state.backend,access_verified_at:new Date().toISOString()};},
    async readDocument(key,options){assert(options.signal);if(options.signal.aborted)throw options.signal.reason;return structuredClone(state.documents.get(key)||null);},
    async rpc(name,args,options){await state.beforeRpc?.();options.beforeWrite();assert.equal(name,'atlas_publish_workspace_projection');assert(options.signal);if(options.signal.aborted)throw options.signal.reason;state.writes.push(name);const payload=args.p_projection;state.documents.set(projectionKey(payload.source),{module_key:'dashboard',source_module:'workspace_projection',payload:structuredClone(payload)});await state.afterRpc?.();return {status:'published'};}
  };
  const activation=createWorkspaceActivation(client,{onState:value=>state.states.push(value)});return {state,client,activation};
}
for(const version of ['',0,-1,'2.1','Infinity','9007199254740992'])assert.throws(()=>expectedWorkspaceSource({version,archiveHash:hash}));
assert.throws(()=>expectedWorkspaceSource({version:2,archiveHash:'bad'}));assert.deepEqual(expectedWorkspaceSource({version:'2',archiveHash:'A'.repeat(64)}),expected);
const good=fixture();assert.equal(good.state.profileReads,0);assert.equal(await good.activation.prepare(),null);
assert.deepEqual(await good.activation.inspect(expected),{documentKey:parent.document_key,...expected,effectiveAt:parent.updated_at});assert.equal(good.state.writes.length,0);
assert.equal((await good.activation.prepare()).status,'complete');assert.equal(good.state.profileReads,4);assert.equal(good.state.writes.length,1);
assert.equal(good.state.documents.get(projectionKey({...expected,documentKey:parent.document_key})).payload.communityData.Example.zero,0);
await good.activation.inspect(expected);assert.equal((await good.activation.prepare()).status,'complete');assert.equal(good.state.writes.length,1,'Explicit existing-source retry reads without another publication');
for(const denied of [{role:'executive'},{status:'disabled'},{account:'disabled'}]){const f=fixture();Object.assign(f.state,denied);assert.equal(await f.activation.inspect(expected),null);assert.equal(await f.activation.prepare(),null);assert.equal(f.state.writes.length,0);}
const stale=fixture();assert.equal(await stale.activation.inspect({...expected,version:1}),null);assert.equal(stale.state.writes.length,0);
for(const change of [f=>f.state.documents.get(parent.document_key).version++,f=>f.state.actor='another',f=>f.state.scope='changed',f=>f.state.backend='https://changed.invalid',f=>f.state.expires_at=1]){const f=fixture();await f.activation.inspect(expected);change(f);assert.equal(await f.activation.prepare(),null);assert.equal(f.state.writes.length,0);}
const revoked=fixture();await revoked.activation.inspect(expected);revoked.state.beforeProfile=()=>{revoked.state.role='viewer';};assert.equal(await revoked.activation.prepare(),null);assert.equal(revoked.state.writes.length,0);
const switched=fixture();await switched.activation.inspect(expected);switched.state.beforeRpc=()=>{switched.state.actor='new-actor';};assert.equal(await switched.activation.prepare(),null);assert.equal(switched.state.writes.length,0,'beforeWrite fences actor changes inside transport refresh');
const interrupted=fixture();await interrupted.activation.inspect(expected);beforeBuild=()=>interrupted.activation.cancel();assert.equal(await interrupted.activation.prepare(),null);beforeBuild=null;assert.equal(interrupted.state.writes.length,0);assert.equal(interrupted.state.states.at(-1).phase,'stopped');
const refreshed=fixture();await refreshed.activation.inspect(expected);beforeBuild=()=>{refreshed.state.expires_at+=100;refreshed.activation.accessChanged();};assert.equal((await refreshed.activation.prepare()).status,'complete');beforeBuild=null;assert.equal(refreshed.state.writes.length,1,'Same actor/access refresh does not cancel preparation');
const accessEvent=fixture();await accessEvent.activation.inspect(expected);beforeBuild=()=>{accessEvent.state.scope='revoked';accessEvent.activation.accessChanged();};assert.equal(await accessEvent.activation.prepare(),null);beforeBuild=null;assert.equal(accessEvent.state.writes.length,0);assert.equal(accessEvent.state.states.at(-1).phase,'stopped');
const changedDuringBuild=fixture();await changedDuringBuild.activation.inspect(expected);beforeBuild=()=>changedDuringBuild.state.documents.get(parent.document_key).updated_at='2026-09-29T13:00:00Z';assert.equal(await changedDuringBuild.activation.prepare(),null);beforeBuild=null;assert.equal(changedDuringBuild.state.writes.length,0);
const uncertain=fixture();await uncertain.activation.inspect(expected);uncertain.state.afterRpc=()=>{throw Error('Response interrupted');};assert.equal(await uncertain.activation.prepare(),null);assert.equal(uncertain.state.states.at(-1).phase,'pending');assert.equal(uncertain.state.writes.length,1);uncertain.state.afterRpc=null;await uncertain.activation.inspect(expected);assert.equal((await uncertain.activation.prepare()).status,'complete');assert.equal(uncertain.state.writes.length,1);
const after=fixture();await after.activation.inspect(expected);after.state.afterRpc=()=>{after.state.documents.get(parent.document_key).version++;};assert.equal(await after.activation.prepare(),null);assert.equal(after.state.states.at(-1).phase,'pending');
console.log('PASS standalone activation: explicit verified source, fresh admin access, claim=false, exact parent, actor/backend/scope/expiry fences, pre-write and worker cancellation, pending receipt, source changes and idempotent readback.');
