const assert=require('node:assert/strict');
const fs=require('node:fs');
const {migrationHistoryFixture}=require('./migration-history-fixture.cjs');
const migration='supabase/migrations/20260924220418_workspace_projection_publisher.sql';
const canonical='docs/portfolio-operations-dashboard/centralization/workspace-projection-publisher.sql';
(async()=>{
 assert.equal(fs.readFileSync(migration,'utf8'),fs.readFileSync(canonical,'utf8'));
 const {db,migrations}=await migrationHistoryFixture({includeLater:true});
 try{
  const ids={admin:'83000000-0000-4000-8000-000000000001',executive:'83000000-0000-4000-8000-000000000002',viewer:'83000000-0000-4000-8000-000000000003',disabled:'83000000-0000-4000-8000-000000000004',reset:'83000000-0000-4000-8000-000000000005'};
  for(const [name,id]of Object.entries(ids)){
   await db.query('insert into auth.users(id) values($1)',[id]);
   await db.query(`insert into public.atlas_user_profiles(user_id,email,display_name,role,status,account_status) values($1,$2,$3,$4,$5,$6)`,[id,`${name}@example.invalid`,`Synthetic ${name}`,['disabled','reset'].includes(name)?'admin':name,name==='disabled'?'disabled':'active',name==='reset'?'password_reset_required':'active']);
  }
  const {digest}=await import('../docs/portfolio-operations-dashboard/features/workspace-canonical.mjs');
  const source={documentKey:'atlas_dashboard_state_v1',version:1,archiveHash:'b'.repeat(64),effectiveAt:'2026-09-24T22:00:00.000Z'};
  const body={format:1,source,communityData:{Synthetic:{monthlyData:[{occupiedSnapshot:0,marketRent:null,netRent:-1.25}],sourceVersion:'synthetic-v1'}},opsGlobalData:{portfolioMonthScopeByPeriod:{'2026-09':['Synthetic']}},importState:{lineage:[{importedValue:0,value:null,sectionPeriod:{start:'2026-09-01',end:'2026-09-30'}}],canonicalRecords:[]}};
  const projection={...body,contentHash:await digest(body)};
  const key=`atlas_workspace_projection_v1:${source.archiveHash}:1`;
  const parentPayload={bundle:{bundleType:'atlas_migration_archive_v1',sha256:source.archiveHash,parts:[]}};
  const actor=async id=>{await db.exec('reset role');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id||'']);await db.exec(id==='anonymous'?'set role anon':'set role authenticated');};
  const publish=async (value=projection)=>(await db.query('select public.atlas_publish_workspace_projection($1::jsonb) value',[JSON.stringify(value)])).rows[0].value;
  const asOwner=async fn=>{await db.exec('reset role');return fn();};
  const counts=async()=>asOwner(async()=> (await db.query(`select (select count(*)::int from public.atlas_app_documents where source_module='workspace_projection') documents,(select count(*)::int from public.atlas_app_document_versions where source_module='workspace_projection') versions,(select count(*)::int from public.atlas_audit_log where source_module='workspace_projection') audits`)).rows[0]);
  const empty={documents:0,versions:0,audits:0};
  for(const name of ['anonymous',null,'viewer','executive','disabled','reset']){
   await actor(name==='anonymous'?'anonymous':ids[name]||null);
   await assert.rejects(publish(),/permission denied|active admin/);
  }
  assert.deepEqual(await counts(),empty);
  await actor(ids.admin);await assert.rejects(publish(),/source conflict/,'missing parent must fail');
  await asOwner(()=>db.query(`insert into public.atlas_app_documents(document_key,module_key,payload,payload_hash,source_module,created_by,updated_by,updated_at) values($1,'dashboard',$2,public.atlas_hash_payload($2::jsonb),'fixture',$3,$3,$4)`,[source.documentKey,JSON.stringify(parentPayload),ids.admin,source.effectiveAt]));
  await actor(ids.admin);
  for(const value of [null,[],{...projection,format:2},{...projection,communityData:[]},{...projection,communityData:{Synthetic:null}},{...projection,opsGlobalData:null},{...projection,importState:[]},{...projection,contentHash:'invalid'},{...projection,extra:'unbound'},{...projection,source:{...source,documentKey:'another_document'}},{...projection,source:{...source,effectiveAt:'not-a-time'}},{...projection,source:{...source,version:'1'}}])await assert.rejects(publish(value),/object|format|timestamp/);
  for(const value of [{...projection,source:{...source,version:2}},{...projection,source:{...source,archiveHash:'c'.repeat(64)}},{...projection,source:{...source,effectiveAt:'2026-09-24T22:00:01Z'}}])await assert.rejects(publish(value),/source conflict/);
  // Small character count still exceeds the UTF-8 bound; compressed/TOAST size must not evade it.
  await assert.rejects(publish({...projection,opsGlobalData:{padding:'€'.repeat(5592406)}}),/16 MiB/);
  assert.deepEqual(await counts(),empty);
  await actor(ids.admin);
  const first=await publish();assert.equal(first.status,'published');assert.equal(first.version,1);assert.equal(first.document_key,key);assert.equal(first.source_module,'workspace_projection');
  const stored=(await db.query(`select payload,payload_hash,source_hash,public.atlas_hash_payload(payload) actual_hash from public.atlas_app_documents where document_id=$1`,[first.document_id])).rows[0];
  assert.deepEqual(stored.payload,projection);assert.equal(first.payload_hash,stored.actual_hash);assert.equal(stored.source_hash,stored.actual_hash);
  const version=(await db.query(`select payload,metadata,saved_by from public.atlas_app_document_versions where document_id=$1`,[first.document_id])).rows[0];
  const audit=(await db.query(`select action,before_payload,after_payload,actor_user_id from public.atlas_audit_log where entity_id=$1`,[first.document_id])).rows[0];
  assert.deepEqual(version.payload,projection);assert.deepEqual(version.metadata.source,source);assert.equal(version.saved_by,ids.admin);
  assert.equal(audit.action,'insert');assert.equal(audit.before_payload,null);assert.deepEqual(audit.after_payload,projection);assert.equal(audit.actor_user_id,ids.admin);
  const replay=await publish();assert.deepEqual({...replay,status:'published'},first);assert.deepEqual(await counts(),{documents:1,versions:1,audits:1});
  await actor(ids.admin);
  await assert.rejects(publish({...projection,opsGlobalData:{different:0}}),/different retained document/);
  for(const [column,value]of [['module_key','bonus'],['source_module','another_source'],['deleted_at','2026-09-24T22:01:00Z']]){
   await asOwner(()=>db.query(`update public.atlas_app_documents set ${column}=$1 where document_key=$2`,[value,key]));await actor(ids.admin);await assert.rejects(publish(),/different retained document/);
   await asOwner(()=>db.query(`update public.atlas_app_documents set ${column}=$1 where document_key=$2`,[column==='module_key'?'dashboard':column==='source_module'?'workspace_projection':null,key]));
  }
  await asOwner(()=>db.query(`update public.atlas_app_documents set version=2 where document_key=$1`,[source.documentKey]));await actor(ids.admin);await assert.rejects(publish(),/source conflict/,'an existing matching projection cannot replay against a changed parent');
  // Exercise the real writer with a representative 7 MB synthetic projection.
  const largeBody={...body,source:{...source,version:2,effectiveAt:'2026-09-24T22:00:00+00:00'},opsGlobalData:{padding:'x'.repeat(7000000),zero:0,unknown:null}};
  const large={...largeBody,contentHash:await digest(largeBody)};
  const largeReceipt=await publish(large);assert.equal(largeReceipt.status,'published');
  const largeRows=await db.query(`select d.payload=$2::jsonb exact_current,v.payload=$2::jsonb exact_version,a.after_payload=$2::jsonb exact_audit from public.atlas_app_documents d join public.atlas_app_document_versions v using(document_id) join public.atlas_audit_log a on a.entity_id=d.document_id::text where d.document_id=$1`,[largeReceipt.document_id,JSON.stringify(large)]);
  assert.deepEqual(largeRows.rows,[{exact_current:true,exact_version:true,exact_audit:true}]);
  assert.deepEqual(await counts(),{documents:2,versions:2,audits:2});
  // If the final audit write fails, neither the current row nor version may survive.
  await db.exec(`update public.atlas_app_documents set version=3 where document_key='atlas_dashboard_state_v1';create function public.fixture_reject_projection_audit() returns trigger language plpgsql as $$begin if new.source_module='workspace_projection' then raise exception 'Synthetic audit failure';end if;return new;end;$$;create trigger fixture_reject_projection_audit before insert on public.atlas_audit_log for each row execute function public.fixture_reject_projection_audit();`);
  await actor(ids.admin);await assert.rejects(publish({...projection,source:{...source,version:3}}),/Synthetic audit failure/);assert.deepEqual(await counts(),{documents:2,versions:2,audits:2});
  const parent=(await db.query(`select version,payload,updated_at from public.atlas_app_documents where document_key=$1`,[source.documentKey])).rows[0];assert.equal(parent.version,3);assert.deepEqual(parent.payload,parentPayload);assert.equal(new Date(parent.updated_at).toISOString(),source.effectiveAt);
  const config=(await db.query(`select prosecdef,provolatile,proconfig,has_function_privilege('anon',oid,'execute') anon_execute,has_function_privilege('authenticated',oid,'execute') authenticated_execute from pg_proc where oid='public.atlas_publish_workspace_projection(jsonb)'::regprocedure`)).rows[0];
  assert.equal(config.prosecdef,false);assert.equal(config.provolatile,'v');assert(config.proconfig.includes('search_path=""'));assert(config.proconfig.includes('statement_timeout=30s'));assert.equal(config.anon_execute,false);assert.equal(config.authenticated_execute,true);
  const general=(await db.query(`select proconfig from pg_proc where oid='public.atlas_update_app_document(text,text,jsonb,integer,text,text,jsonb)'::regprocedure`)).rows[0];assert(!general.proconfig.some(value=>value.startsWith('statement_timeout=')));
  console.log(`PASS workspace publisher on ${migrations.length} migrations: active admin/RLS, malformed/oversized/stale source rejection, exact insert-only replay, server hash, 7 MB null/zero payload across current/version/audit, atomic failure rollback; outer30s metadata verified (HTTP hoisting still needs live acceptance).`);
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
