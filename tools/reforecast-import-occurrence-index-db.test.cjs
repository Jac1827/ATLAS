// Apply the bounded additive optimization to the complete atomic acceptance
// fixture; validate duplicate/missing retained IDs and preserved function settings.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const originalRead=fs.readFileSync,fixtures=require('./reforecast-fixture.cjs'),originalFixture=fixtures.fixture;
const indexMigration=originalRead.call(fs,path.join(__dirname,'../supabase/migrations/20260925020226_reforecast_import_source_occurrence_index.sql'),'utf8');
fs.readFileSync=function(file,...args){const value=originalRead.call(this,file,...args);return String(file).endsWith('/20260925012933_reforecast_atomic_create_from_import.sql')?value+"\nalter function atlas_private.create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb) set statement_timeout='45s';\n"+indexMigration:value;};
fixtures.fixture=async(...args)=>{const context=await originalFixture(...args),close=context.db.close.bind(context.db);context.db.close=async()=>{
 await context.db.exec('reset role');
 const definition=(await context.db.query("select pg_get_functiondef('atlas_private.create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb)'::regprocedure) definition,proconfig from pg_proc where oid='atlas_private.create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb)'::regprocedure")).rows[0];
 assert(definition.definition.includes('jsonb_object_agg(line_id,occurrences)'));assert(definition.proconfig.includes('statement_timeout=45s'),'Existing function settings must survive additive optimization');
 const revision=(await context.db.query("select payload from atlas_reforecast_revisions where payload->>'uploadId' is not null order by created_at desc limit 1")).rows[0].payload,source=(await context.db.query('select payload from atlas_reforecast_uploads where upload_id=$1',[revision.uploadId])).rows[0].payload;
 const target=revision.importMapping.selectedLineIds[0],periods=['2026-04'],mapping={...revision.importMapping,periods,calendar:{...revision.importMapping.calendar,periods}},payload={...revision,periods,calendar:{...revision.calendar,periods},overrides:[],importHistory:[]};
 for(const kind of ['missing','duplicate']){
  const altered=structuredClone(source);if(kind==='missing')altered.lines=altered.lines.filter(line=>line.id!==target);else altered.lines.push(structuredClone(altered.lines.find(line=>line.id===target)));
  const uploadId=randomUUID(),requestId=randomUUID(),scenarioId=randomUUID();await context.db.query("insert into atlas_reforecast_uploads(upload_id,community_id,request_id,source_hash,content_hash,payload,created_by,created_role) values($1,$2,$3,$4,'invalid-occurrence-test-only',$5,$6,'admin')",[uploadId,context.A,randomUUID(),source.source.sha256,altered,'00000000-0000-0000-0000-000000000001']);
  await context.signIn(1);await assert.rejects(()=>context.db.query('select public.atlas_create_reforecast_from_import($1,$2,0,$3,$4,$5,$6)',[context.A,scenarioId,requestId,uploadId,mapping,payload]),/Each selected source cell must occur exactly once/,kind);
  assert.equal((await context.db.query('select count(*)::int n from atlas_reforecast_import_receipts where request_id=$1',[requestId])).rows[0].n,0);assert.equal((await context.db.query('select count(*)::int n from atlas_reforecast_revisions where scenario_id=$1',[scenarioId])).rows[0].n,0);await context.db.exec('reset role');
 }
 console.log('PASS source ID occurrence index rejects duplicate and missing immutable IDs without revisions or receipts, and preserves function settings');await close();};return context;};
require(process.env.ATLAS_TEST_SOURCE_RELATIONSHIPS==='1'?'./reforecast-source-relationships-db.test.cjs':'./reforecast-atomic-import-db.test.cjs');
