// Reuse the full import/edit/approve acceptance fixture, then exercise request
// identity across its separate immutable revision and publication tables.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const fixtures=require('./reforecast-fixture.cjs'),originalFixture=fixtures.fixture;
const fix=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260925071533_reforecast_request_identity_consistency.sql'),'utf8');
fixtures.fixture=async(...args)=>{const context=await originalFixture(...args),close=context.db.close.bind(context.db);context.db.close=async()=>{try{
 const {db,A,signIn}=context;await signIn(1);
 const call=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 const publication=(await db.query('select * from atlas_reforecast_publications order by published_at desc limit 1')).rows[0];
 const published=(await db.query('select payload from atlas_reforecast_revisions where revision_id=$1',[publication.revision_id])).rows[0].payload;
 const payload=structuredClone(published),scenario=randomUUID();
 // Seed the exact historical collision before installing the repair. The new
 // ledger records both immutable row IDs as blocked metadata without choosing
 // one as authoritative or modifying either original row.
 const legacyRequest=randomUUID(),columns='community_id,scenario_id,revision_id,version,request_id,request_hash,periods,snapshot,source,reason,published_by,published_role';
 await db.exec('reset role');
 await db.query(`insert into atlas_reforecast_publications(${columns}) select community_id,scenario_id,(select revision_id from atlas_reforecast_revisions where scenario_id=$3 and action='submit'),version+100,$1,request_hash,periods,snapshot,source,reason,published_by,published_role from atlas_reforecast_publications where publication_id=$2`,[legacyRequest,publication.publication_id,publication.scenario_id]);
 await signIn(1);const legacyScenario=randomUUID();let legacy=await call('atlas_save_reforecast_scenario',[A,legacyScenario,0,legacyRequest,'save_draft',payload]);for(const action of ['reconcile','ready','submit','approve_lock'])legacy=await call('atlas_save_reforecast_scenario',[A,legacyScenario,legacy.head.revision,randomUUID(),action,legacy.revision.payload]);
 await db.exec('reset role');
 const hashes=()=>db.query("select (select md5(jsonb_agg(to_jsonb(r) order by revision_id)::text) from atlas_reforecast_revisions r) revisions,(select md5(jsonb_agg(to_jsonb(p) order by publication_id)::text) from atlas_reforecast_publications p) publications");
 const catalog=()=>db.query("select p.proacl,p.proconfig,p.prosecdef,p.proowner from pg_proc p where p.oid='atlas_private.read_reforecast_save_receipt(uuid,uuid)'::regprocedure");
 const beforeRepair=(await hashes()).rows[0],beforeCatalog=(await catalog()).rows[0];await db.exec(fix);assert.deepEqual((await hashes()).rows[0],beforeRepair,'Backfill never rewrites immutable history');assert.deepEqual((await catalog()).rows[0],beforeCatalog,'Receipt reader retains owner, security mode, ACL and configuration');
 assert.equal((await db.query('select binding_kind from atlas_private.reforecast_write_requests where request_id=$1',[legacyRequest])).rows[0].binding_kind,'legacy_ambiguous');
 await assert.rejects(()=>db.exec("update atlas_private.reforecast_write_requests set binding_kind='revision'"),/immutable/);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_table_privilege($1,'atlas_private.reforecast_write_requests','SELECT,INSERT,UPDATE,DELETE') allowed",[role])).rows[0].allowed,false);
 await signIn(1);await assert.rejects(()=>call('atlas_read_reforecast_save_receipt',[A,legacyRequest]),/receipt request identity is ambiguous/);

 await assert.rejects(()=>call('atlas_save_reforecast_scenario',[A,scenario,0,publication.request_id,'save_draft',payload]),/request ID is already bound to a publication/);
 assert.equal((await db.query('select count(*)::int n from atlas_reforecast_revisions where scenario_id=$1',[scenario])).rows[0].n,0,'A reused approval request cannot create a draft');
 assert.equal((await call('atlas_read_reforecast_save_receipt',[A,publication.request_id])).revision.revision_id,publication.revision_id,'Prior approval receipt remains exact');
 const saveRequest=randomUUID();let working=await call('atlas_save_reforecast_scenario',[A,scenario,0,saveRequest,'save_draft',payload]);
 const firstRevision=working.revision.revision_id;
 assert.equal((await call('atlas_save_reforecast_scenario',[A,scenario,0,saveRequest,'save_draft',payload])).revision.revision_id,firstRevision,'Exact draft retry remains idempotent');
 await assert.rejects(()=>call('atlas_save_reforecast_scenario',[A,scenario,0,randomUUID(),'save_draft',payload]),/changed in another session/);
 await assert.rejects(()=>call('atlas_save_reforecast_scenario',[A,scenario,0,saveRequest,'save_draft',{...payload,name:'Changed retry'}]),/request ID reused/);
 for(const action of ['reconcile','ready','submit'])working=await call('atlas_save_reforecast_scenario',[A,scenario,working.head.revision,randomUUID(),action,working.revision.payload]);
 const before=(await db.query('select count(*)::int n from atlas_reforecast_revisions where scenario_id=$1',[scenario])).rows[0].n;
 await assert.rejects(()=>call('atlas_save_reforecast_scenario',[A,scenario,working.head.revision,saveRequest,'approve_lock',working.revision.payload]),/request ID is already bound to a saved revision/);
 assert.equal((await db.query('select count(*)::int n from atlas_reforecast_revisions where scenario_id=$1',[scenario])).rows[0].n,before,'Approval collision rolls back both internally created revisions');
 assert.equal((await db.query('select status from atlas_reforecast_heads where scenario_id=$1',[scenario])).rows[0].status,'submitted');
 const oldReceipt=await call('atlas_read_reforecast_save_receipt',[A,saveRequest]);assert.equal(oldReceipt.revision.revision_id,firstRevision);assert.equal(oldReceipt.publication,undefined);assert.equal(oldReceipt.currentHead.status,'submitted');
 const approvalRequest=randomUUID(),approvalArgs=[A,scenario,working.head.revision,approvalRequest,'approve_lock',working.revision.payload];
 const approved=await call('atlas_save_reforecast_scenario',approvalArgs);assert.equal((await call('atlas_save_reforecast_scenario',approvalArgs)).publication.publication_id,approved.publication.publication_id,'Exact approval retry remains idempotent');
 await assert.rejects(()=>call('atlas_create_reforecast_from_import',[A,randomUUID(),0,approvalRequest,payload.uploadId,payload.importMapping,payload]),/request ID is already bound to a publication/);
 assert.equal(await call('atlas_read_reforecast_import_receipt',[A,approvalRequest]),null,'Failed import request leaves no import receipt');
 await db.exec('reset role');assert.equal((await db.query("select count(*)::int n from atlas_private.reforecast_write_requests w where (w.revision_id is not null and not exists(select 1 from atlas_reforecast_revisions r where r.revision_id=w.revision_id)) or (w.publication_id is not null and not exists(select 1 from atlas_reforecast_publications p where p.publication_id=w.publication_id))")).rows[0].n,0,'Failed transactions leave no orphan request bindings');for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'atlas_private.reforecast_request_identity_guard()','EXECUTE') allowed",[role])).rows[0].allowed,false);
 console.log('PASS shared revision/publication request identity: both collision directions denied atomically, exact save/approve retries retained, stale and changed retries denied, import collision leaves no receipt, ambiguous historical receipt fails closed');
 }finally{await close();}};return context;};
require('./reforecast-atomic-import-db.test.cjs');
