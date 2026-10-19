import assert from 'node:assert/strict';
import {capturePublicationBaseline} from '../docs/portfolio-operations-dashboard/features/workspace-publication-baseline.mjs';
import {accessNamespace,digest} from '../docs/portfolio-operations-dashboard/features/workspace-bootstrap.mjs';

async function fixture(){
  const source={documentKey:'atlas_dashboard_state_v1',version:4,archiveHash:'a'.repeat(64),effectiveAt:'2026-10-02T17:04:48Z'};
  const body={format:1,source,communityData:{Test:{zero:0}},opsGlobalData:{},importState:{}};
  const contentHash=await digest(body),binding={scopeFingerprint:'b'.repeat(64),projectionVersion:2,projectionContentHash:'c'.repeat(64),projectionHashFormat:'postgres-jsonb-sha256',fullProjection:true};
  const profile={user_id:'actor',role:'admin',status:'active',account_status:'active',access_backend:'https://example.invalid',access_verified_at:'2026-10-19T15:00:00Z'};
  const f={allowed:true,profile,response:{status:'available',source,projection:{...body,contentHash},...binding},stored:{identity:source,binding,contentHash,dirty:true,verifiedAt:'2026-10-19T15:00:00Z'},remote:{document_key:source.documentKey,version:4,updated_at:source.effectiveAt,payload:{bundle:{bundleType:'atlas_migration_archive_v1',sha256:source.archiveHash}}}};
  const central={getSession:()=>({user:{id:'actor'}}),getConfig:()=>({supabaseUrl:'https://example.invalid'}),fetchProfile:async()=>{await f.afterProfile?.();return f.profile;},fetchJson:async()=>{await f.afterRead?.();return structuredClone(f.response);}};
  f.options={documentKey:source.documentKey,dbName:await accessNamespace(central,profile),readSource:async()=>structuredClone(f.stored),current:()=>f.allowed};
  f.capture=()=>capturePublicationBaseline(central,f.options);
  return f;
}

const valid=await fixture(),before=JSON.stringify(valid.stored),baseline=await valid.capture();
assert.equal(baseline.version,4);await baseline.assertRemote(valid.remote);
assert.equal(JSON.stringify(valid.stored),before,'Capturing an ancestor must not change dirty state, source data or safety gates');
valid.stored.verifiedAt='later';await baseline.assertRemote(valid.remote);
valid.stored.dirty=false;await baseline.assertRemote(valid.remote);
await assert.rejects(baseline.assertRemote({...valid.remote,version:5}),/central source changed/);
await assert.rejects(baseline.assertRemote({...valid.remote,updated_at:'2026-10-03T00:00:00Z'}),/central source changed/);
valid.stored.identity={...valid.stored.identity,version:5};await assert.rejects(baseline.assertRemote(valid.remote),/local central ancestor changed/);

for(const change of [f=>{f.stored=null;},f=>{f.stored.binding.fullProjection=false;},f=>{f.stored.identity.version=3;},f=>{f.stored.binding.scopeFingerprint='d'.repeat(64);},f=>{f.stored.contentHash='e'.repeat(64);},f=>{f.response.fullProjection=false;},f=>{f.profile.role='regional';},f=>{f.profile.status='inactive';},f=>{f.profile.user_id='other';}]){
  const f=await fixture();change(f);await assert.rejects(f.capture());
}
const stale=await fixture();stale.afterRead=()=>{stale.allowed=false;};await assert.rejects(stale.capture(),{name:'AbortError'});
const staleCommit=await fixture(),captured=await staleCommit.capture();staleCommit.allowed=false;await assert.rejects(captured.assertRemote(staleCommit.remote),{name:'AbortError'});
console.log('PASS verified startup ancestor: exact source, complete scope, current actor, no invented baseline, no mutation, source/access races fail closed');
