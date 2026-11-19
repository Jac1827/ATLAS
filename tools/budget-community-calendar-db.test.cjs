// Synthetic database acceptance of the production creation RPC.
const assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema atlas_private;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table atlas_user_profiles(user_id uuid,role text,status text);
 create function atlas_private.is_budget_vp(uid uuid) returns boolean language sql as $$select exists(select 1 from public.atlas_user_profiles where user_id=uid and role='vp' and status='active')$$;
 create function atlas_private.reforecast_access(cid uuid,action text) returns boolean language sql as $$select exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role in ('vp','admin'))$$;
 create function atlas_hash_payload(value jsonb) returns text language sql as $$select md5(value::text)$$;
 create table atlas_communities(community_id uuid primary key default gen_random_uuid(),canonical_name text unique,display_name text,source_module text,source_identifier text,source_hash text,units integer,property_type text,market text,status text,deleted_at timestamptz,budget_calendar jsonb);
 create table atlas_community_aliases(community_id uuid references atlas_communities,alias text,source_module text,active boolean default true);
 create table atlas_budget_calendar_events(community_id uuid references atlas_communities,before_settings jsonb,after_settings jsonb,actor_id uuid,action text,reason text);
 insert into atlas_user_profiles values('00000000-0000-0000-0000-000000000001','vp','active'),('00000000-0000-0000-0000-000000000002','admin','active'),('00000000-0000-0000-0000-000000000003','gm','active');
 grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261119140308_budget_builder_atomic_calendar_creation.sql','utf8'));
 const login=async n=>db.exec(`reset role;set request.jwt.claim.sub='00000000-0000-0000-0000-${String(n).padStart(12,'0')}';set role authenticated`);
 const create=async(name,type='Conventional apartments')=>(await db.query('select public.atlas_budget_builder_create_community($1,100,$2,$3,false) id',[name,type,'Synthetic, FL'])).rows[0].id;
 await login(3);await assert.rejects(()=>create('Denied'),/Only the VP/);
 await login(1);const id=await create('Synthetic New','Student housing — by bed');
 await db.exec('reset role');let row=(await db.query('select * from atlas_communities where community_id=$1',[id])).rows[0];
 assert.equal(row.budget_calendar.startMonth,8);assert.equal(row.budget_calendar.verified,true);assert.equal(row.units,100);
 await db.query("update atlas_communities set budget_calendar=jsonb_set(budget_calendar,'{startMonth}','10') where community_id=$1",[id]);
 await db.query("insert into atlas_community_aliases values($1,'Existing Alias','fixture',true)",[id]);
 const before=(await db.query('select to_jsonb(c) data from atlas_communities c where community_id=$1',[id])).rows[0].data;
 for(const user of [1,2]){await login(user);assert.equal(await create('Existing Alias'),id);assert.equal(await create('Synthetic New'),id);}
 await db.exec('reset role');assert.deepEqual((await db.query('select to_jsonb(c) data from atlas_communities c where community_id=$1',[id])).rows[0].data,before,'aliases and canonical matches preserve every existing field');
 assert.equal((await db.query('select count(*)::int n from atlas_budget_calendar_events')).rows[0].n,1);
 await login(1);const retry=await Promise.all([create('Retry Property'),create('Retry Property')]);assert.equal(retry[0],retry[1]);
 await assert.rejects(()=>create('Unknown Class','Unrecognized'),/supported asset class/);
 await db.exec(`reset role;create function fail_calendar() returns trigger language plpgsql as $$begin raise exception 'Synthetic calendar audit failure';end;$$;create trigger fail_calendar before insert on atlas_budget_calendar_events for each row execute function fail_calendar();`);
 await login(1);await assert.rejects(()=>create('Rollback Property'),/Synthetic calendar audit failure/);
 await db.exec('reset role');assert.equal((await db.query("select count(*)::int n from atlas_communities where display_name='Rollback Property'")).rows[0].n,0,'calendar audit failure rolls back community and alias');
 assert.equal((await db.query("select count(*)::int n from atlas_community_aliases where alias='Rollback Property'")).rows[0].n,0);
 await db.close();console.log('PASS atomic VP/admin creation, role denial, alias and non-January preservation, retries, and rollback');
})().catch(e=>{console.error(e);process.exitCode=1});
