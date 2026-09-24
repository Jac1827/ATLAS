const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {migrationHistoryFixture}=require('./migration-history-fixture.cjs');
const root=path.join(__dirname,'..');
const migration='20260924172221_profile_access_hardening.sql';

async function run(){
 const {db}=await migrationHistoryFixture();
 try{
  const admin=randomUUID(),viewer=randomUUID(),pending=randomUUID(),uninvited=randomUUID();
  for(const [id,email,role] of [[admin,'synthetic-admin@risere.com','admin'],[viewer,'synthetic-viewer@risere.com','viewer']]){
   await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,email]);
   await db.query('insert into atlas_user_profiles(user_id,email,display_name,role) values($1,$2,$3,$4)',[id,email,'Synthetic profile',role]);
  }
  const signIn=async(id)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({sub:id})]);await db.exec('set role authenticated');};
  // Demonstrate the actual historic policy/grant problem against all 72 production migrations.
  await signIn(viewer);await db.query("update atlas_user_profiles set role='admin' where user_id=$1",[viewer]);
  assert.equal((await db.query('select role from atlas_user_profiles where user_id=$1',[viewer])).rows[0].role,'admin');
  await db.exec('reset role');await db.query("update atlas_user_profiles set role='viewer' where user_id=$1",[viewer]);
  const before=(await db.query('select jsonb_agg(to_jsonb(p) order by user_id) rows from atlas_user_profiles p')).rows[0].rows;
  const sql=fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8');
  assert.equal(sql,fs.readFileSync(path.join(root,'docs/portfolio-operations-dashboard/centralization/profile-access-hardening.sql'),'utf8'));
  await db.exec(sql);
  const after=(await db.query("select jsonb_agg(to_jsonb(p)-'bonus_permissions' order by user_id) rows from atlas_user_profiles p")).rows[0].rows;
  assert.deepEqual(after,before,'Migration must preserve existing profile access and values');
  await signIn(viewer);
  for(const [field,value] of [['role',"'admin'"],['status',"'active'"],['email',"'synthetic-admin@risere.com'"],['employee_id','null'],['allowed_community_ids',"'{}'"],['locked_tab_ids',"'{}'"],['bonus_permissions',"'{approve_bonuses}'"]]){
   await assert.rejects(()=>db.query(`update atlas_user_profiles set ${field}=${value} where user_id=$1`,[viewer]),/permission denied/);
  }
  for(const table of ['atlas_user_profiles','atlas_user_access_invites']){
   await assert.rejects(()=>db.exec(`delete from ${table}`),/permission denied/);
   await assert.rejects(()=>db.exec(`truncate ${table}`),/permission denied/);
  }
  await assert.rejects(()=>db.query("insert into atlas_user_profiles(user_id,email,display_name,role) values($1,'synthetic-new@risere.com','Synthetic','admin')",[pending]),/permission denied/);
  await assert.rejects(()=>db.exec("insert into atlas_user_access_invites(email,display_name,role) values('synthetic-new@risere.com','Synthetic','admin')"),/permission denied/);
  await db.query("update atlas_user_profiles set display_name='Synthetic self edit',profile_image_url='https://example.invalid/avatar',updated_at=now() where user_id=$1",[viewer]);
  assert.equal((await db.query("select * from atlas_update_current_profile('Synthetic RPC edit',null)")).rows[0].display_name,'Synthetic RPC edit');
  assert.equal((await db.query("update atlas_user_profiles set display_name='Denied other edit' where user_id=$1 returning user_id",[admin])).rows.length,0);
  await assert.rejects(()=>db.query("select * from atlas_admin_upsert_user_access('synthetic-viewer@risere.com','Synthetic','admin')"),/Only an active Atlas Admin/);
  await assert.rejects(()=>db.query("select * from atlas_claim_first_admin('Synthetic')"),/admin already exists/);
  await assert.rejects(()=>db.query("select * from atlas_private.atlas_admin_upsert_user_access_before_permissions('synthetic-viewer@risere.com','Synthetic','admin')"),/permission denied/);
  await signIn(admin);
  const save=async(email,permissions)=>db.query('select * from atlas_admin_upsert_user_access(p_email=>$1,p_display_name=>$2,p_role=>$3,p_status=>$4,p_bonus_permissions=>$5)',[email,'Synthetic authorized access','finance','active',permissions]);
  await save('synthetic-viewer@risere.com',['view_bonus_module']);
  assert.deepEqual((await db.query('select bonus_permissions from atlas_user_profiles where user_id=$1',[viewer])).rows[0].bonus_permissions,['view_bonus_module']);
  for(const permissions of [['unknown_permission'],['view_bonus_module','view_bonus_module'],[null]])await assert.rejects(()=>save('synthetic-viewer@risere.com',permissions),/unique supported/);
  await db.query("select * from atlas_admin_upsert_user_access('synthetic-viewer@risere.com','Synthetic legacy client','finance','active')");
  assert.deepEqual((await db.query('select bonus_permissions from atlas_user_profiles where user_id=$1',[viewer])).rows[0].bonus_permissions,['view_bonus_module'],'Legacy omitted permission argument preserves explicit restrictions');
  await save('synthetic-claim@risere.com',['view_bonus_module','run_calculations']);
  await db.exec('reset role');await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[pending,'synthetic-claim@risere.com']);
  await signIn(pending);await db.query("select * from atlas_claim_invited_profile('Synthetic claimant')");
  const claimed=(await db.query('select role,bonus_permissions from atlas_user_profiles where user_id=$1',[pending])).rows[0];
  assert.deepEqual(claimed,{role:'finance',bonus_permissions:['view_bonus_module','run_calculations']});
  await assert.rejects(()=>db.exec("update atlas_user_access_invites set bonus_permissions='{approve_bonuses}'"),/permission denied/);
  await db.exec('reset role');
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uninvited,'synthetic-uninvited@risere.com']);
  await signIn(uninvited);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:uninvited,email:'synthetic-claim@risere.com'})]);
  await assert.rejects(()=>db.query("select * from atlas_claim_invited_profile('Synthetic forged email')"),/No active Atlas access invite/);
  await db.exec('reset role;set role service_role');
  await db.query("update atlas_user_profiles set display_name='Synthetic server provisioning' where user_id=$1",[viewer]);
  await db.exec('reset role');
  const grants=(await db.query(`select
   has_column_privilege('authenticated','atlas_user_profiles','display_name','UPDATE') self_edit,
   has_column_privilege('authenticated','atlas_user_profiles','role','UPDATE') role_edit,
   has_table_privilege('authenticated','atlas_user_profiles','INSERT') profile_insert,
   has_table_privilege('authenticated','atlas_user_access_invites','UPDATE') invite_edit,
   has_function_privilege('anon','atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text,text[])','EXECUTE') anonymous_admin,
   (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='atlas_admin_upsert_user_access') overload_count`)).rows[0];
  assert.deepEqual(grants,{self_edit:true,role_edit:false,profile_insert:false,invite_edit:false,anonymous_admin:false,overload_count:1});
  await db.exec('set role anon');await assert.rejects(()=>db.query("select * from atlas_admin_upsert_user_access('synthetic-viewer@risere.com','Synthetic','admin')"),/permission denied/);
  console.log('PASS actual 72-migration self-escalation reproduction and fix, preserved profiles, limited self edits, denied INSERT/DELETE/TRUNCATE/invite bypasses, guarded Admin compatibility, permission validation and invited profile propagation');
 }finally{await db.close();}
}
run().catch(error=>{console.error(error.message,error.where||error.detail||'');process.exitCode=1;});
