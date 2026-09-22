const {PGlite}=require(process.env.ATLAS_PGLITE || '@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path');
const A='10000000-0000-0000-0000-000000000001',B='10000000-0000-0000-0000-000000000002';
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema atlas_private;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,atlas_private to authenticated;grant execute on function auth.uid() to authenticated,anon;
 create table atlas_user_profiles(user_id uuid,role text,status text,allowed_community_ids uuid[],locked_tab_ids text[],locked_page_keys text[]);
 create table atlas_communities(community_id uuid primary key,display_name text,canonical_name text,status text,deleted_at timestamptz);
 create function atlas_can_access_community(id uuid) returns boolean language sql security definer set search_path=public as $$ select exists(select 1 from atlas_user_profiles where user_id=auth.uid() and status='active' and (role in ('admin','executive') or id=any(allowed_community_ids))) $$;
 insert into auth.users select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,4) n;
 insert into atlas_communities values ('${A}','Test A','test a','active',null),('${B}','Test B','test b','active',null);
 insert into atlas_user_profiles values ('00000000-0000-0000-0000-000000000001','admin','active','{}','{}','{}'),('00000000-0000-0000-0000-000000000002','executive','active','{}','{}','{}'),('00000000-0000-0000-0000-000000000003','community_manager','active','{${B}}','{}','{}'),('00000000-0000-0000-0000-000000000004','bonus','active','{${A}}','{2}','{portfolio_overview}');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../docs/portfolio-operations-dashboard/centralization/community-command.sql'),'utf8'));
 await db.exec(`create table atlas_command_financial_summaries(community_id uuid,period_key text,publication_id uuid,summary jsonb);
 create function public.atlas_read_finance(cids uuid[],periods text[]) returns table(publication_id uuid,summary jsonb) language sql as $$ select publication_id,summary from public.atlas_command_financial_summaries where community_id=any(cids) and period_key=any(periods) $$;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../docs/portfolio-operations-dashboard/centralization/community-goals.sql'),'utf8'));
 const signIn=async n=>db.exec(`reset role;set request.jwt.claim.sub='00000000-0000-0000-0000-${String(n).padStart(12,'0')}';set role authenticated;`);
 await signIn(1);return {db,A,B,signIn};
}
module.exports={fixture,A,B};
