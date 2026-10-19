import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),cid='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;alter default privileges in schema public grant all on tables to service_role;create schema auth;create table auth.users(id uuid primary key);create table atlas_communities(community_id uuid primary key);insert into auth.users values('${actor}');insert into atlas_communities values('${cid}');`);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261019122721_report_delivery_automation.sql',import.meta.url),'utf8'));
assert.equal((await db.query('select count(*)::int n from atlas_report_subscriptions')).rows[0].n,0);
await db.exec('set role service_role');
const insert=async(type)=> (await db.query(`insert into atlas_report_subscriptions(community_id,community_name,report_type,created_by,updated_by) values($1,'Synthetic',$2,$3,$3) returning *`,[cid,type,actor])).rows[0];
const s=await insert('rise_weekly_leasing');assert.equal(s.mode,'manual');assert.deepEqual(s.recipient_config.employeeRecipientIds,[]);assert.equal(s.recipient_config.toInvestorContacts,false);
await insert('investor_community_packet');
await assert.rejects(()=>insert('rise_weekly_leasing'),/unique/);
await assert.rejects(()=>insert('unsupported'),/check constraint/);
const claim=()=>db.query(`insert into atlas_report_delivery_history(report_subscription_id,subscription_version,community_id,report_type,scheduled_date,reporting_period,status) values($1,1,$2,'rise_weekly_leasing','2026-10-19','2026-10','preparing')`,[s.report_subscription_id,cid]);
const claims=await Promise.allSettled([claim(),claim()]);assert.equal(claims.filter(r=>r.status==='fulfilled').length,1);assert.equal(claims.filter(r=>r.status==='rejected').length,1);
await db.query("update atlas_report_delivery_history set status='held'");
const reclaim=()=>db.query("update atlas_report_delivery_history set status='preparing' where report_subscription_id=$1 and status='held' returning report_delivery_id",[s.report_subscription_id]);
const reclaimed=await Promise.all([reclaim(),reclaim()]);assert.equal(reclaimed.reduce((n,r)=>n+r.rows.length,0),1,'only one concurrent retry can reclaim a held delivery');
for(const role of ['anon','authenticated']){
 await db.exec('reset role;set role '+role);
 for(const table of ['atlas_report_subscriptions','atlas_report_delivery_history'])await assert.rejects(()=>db.query('select * from '+table),/permission denied/);
 await assert.rejects(()=>insert('rise_weekly_leasing'),/permission denied/);
}
await db.exec('reset role');
for(const table of ['atlas_report_subscriptions','atlas_report_delivery_history'])assert.equal((await db.query("select has_table_privilege('service_role',$1,'DELETE') d",[table])).rows[0].d,false);
await db.close();console.log('PASS report schema manual/no-recipient defaults, separate types, unique delivery claims, RLS/direct access denial, no delete grants');
