import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),cid='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',rid='33333333-3333-4333-8333-333333333333';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;alter default privileges in schema public grant all on tables to service_role;create table atlas_communities(community_id uuid primary key);insert into atlas_communities values('${cid}');`);
await db.exec(fs.readFileSync('supabase/migrations/20261015114059_moveout_canonical_state.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261015115054_moveout_immutable_permissions.sql','utf8'));
for(const table of ['atlas_moveout_state_revisions','atlas_moveout_photos']){const r=(await db.query("select has_table_privilege('service_role',$1,'UPDATE') u,has_table_privilege('service_role',$1,'DELETE') d",[table])).rows[0];assert.equal(r.u,false);assert.equal(r.d,false);}
const payload={moveOutCases:[{id:'case',propertyName:'Test',leaseStart:''}],inspections:[],morfRecords:[]};
const call=async(version,id=rid,p=payload,hashes=[]) => (await db.query('select atlas_save_moveout_state($1,$2,$3,$4,$5,$6) result',[cid,version,id,actor,p,hashes])).rows[0].result;
await db.exec('set role service_role');assert.equal((await call(0)).version,1);assert.equal((await call(0)).replayed,true);
await assert.rejects(()=>call(0,'44444444-4444-4444-8444-444444444444'),/Version conflict/);
await assert.rejects(()=>call(1,rid,{...payload,inspections:[{id:'changed'}]}),/identity conflict/);
await assert.rejects(()=>call(1,'44444444-4444-4444-8444-444444444444',payload,['a'.repeat(64)]),/Photo evidence/);
assert.equal((await db.query('select count(*)::int n from atlas_moveout_state_revisions')).rows[0].n,1);
await db.exec('reset role;set role authenticated');for(const table of ['atlas_moveout_states','atlas_moveout_state_revisions','atlas_moveout_photos'])await assert.rejects(()=>db.query('select * from '+table),/permission denied/);await assert.rejects(()=>call(1),/permission denied/);
await db.close();console.log('PASS canonical state CAS, replay, immutable history, photo prerequisite, direct authenticated denial');
