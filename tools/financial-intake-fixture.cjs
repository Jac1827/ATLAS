const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs');
async function fixture(){
 const db=new PGlite();const sql=name=>fs.readFileSync(__dirname+'/../docs/portfolio-operations-dashboard/centralization/'+name+'.sql','utf8');
 await db.exec(`create role service_role bypassrls;create role anon;create role authenticated;create schema auth;create schema atlas_private;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,atlas_private to authenticated;grant execute on function auth.uid() to authenticated;
 create table atlas_user_profiles(user_id uuid,role text,status text,locked_tab_ids text[],locked_page_keys text[],allowed_community_ids uuid[]);
 create table atlas_communities(community_id uuid primary key,display_name text,canonical_name text,status text,deleted_at timestamptz);
 create table atlas_community_aliases(community_id uuid,alias text,active boolean,source_module text);
 create function atlas_can_access_community(id uuid) returns boolean language sql security definer set search_path=public as $$ select exists(select 1 from atlas_user_profiles where user_id=auth.uid() and status='active' and (role='admin' or id=any(allowed_community_ids))) $$;
 insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
 insert into atlas_user_profiles values('00000000-0000-0000-0000-000000000001','admin','active','{}','{}','{}'),('00000000-0000-0000-0000-000000000002','regional','active','{}','{}','{10000000-0000-0000-0000-000000000001}'),('00000000-0000-0000-0000-000000000003','community_manager','active','{}','{}','{10000000-0000-0000-0000-000000000002}');
 insert into atlas_communities values('10000000-0000-0000-0000-000000000001','Doro','doro','active',null),('10000000-0000-0000-0000-000000000002','Other','other','active',null);`);
 for(const file of ['financial-package-review','financial-comparisons','financial-close','financial-close-cash-flow','financial-close-source-lineage','community-command','community-command-finance','community-command-delivery','community-command-plan-summary','community-command-report-ytd','financial-admin-publication','canonical-finance-reporting','canonical-finance-reporting-indexes','canonical-finance-budget-projection-performance'])await db.exec(sql(file));

 await db.exec(sql('financial-coverage-start'));
 await db.exec('alter table atlas_communities add column units integer;alter table atlas_communities add column updated_at timestamptz;');
 await db.exec(sql('reforecast-governance'));
 await db.exec(sql('financial-intake-governance'));
 const cid='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002';
 const signIn=async n=>db.exec(`reset role;set request.jwt.claim.sub='00000000-0000-0000-0000-${String(n).padStart(12,'0')}';set role authenticated;`);await signIn(1);
 return {db,cid,other,signIn};
}
module.exports={fixture};
