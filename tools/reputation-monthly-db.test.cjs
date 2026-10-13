const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {migrationHistoryFixture}=require('./migration-history-fixture.cjs');
(async()=>{
 const {db,migrations}=await migrationHistoryFixture({includeLater:true});
 const ids={admin:'91000000-0000-4000-8000-000000000001',manager:'91000000-0000-4000-8000-000000000002',viewer:'91000000-0000-4000-8000-000000000003',other:'91000000-0000-4000-8000-000000000004',a:'92000000-0000-4000-8000-000000000001',b:'92000000-0000-4000-8000-000000000002'};
 try{
  for(const role of ['admin','manager','viewer','other']){
   await db.query('insert into auth.users(id) values($1)',[ids[role]]);
   await db.query(`insert into public.atlas_user_profiles(user_id,email,display_name,role,status,account_status,allowed_community_ids) values($1,$2,$3,$4,'active','active',$5)`,[ids[role],role+'@example.invalid','Synthetic '+role,['manager','other'].includes(role)?'community_manager':role,[role==='other'?ids.b:ids.a]]);
  }
  await db.query(`insert into public.atlas_communities(community_id,canonical_name,display_name,status) values($1,'Synthetic Reputation A','Synthetic A','active'),($2,'Synthetic Reputation B','Synthetic B','active')`,[ids.a,ids.b]);
  const actor=async id=>{await db.exec('reset role');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id||'']);await db.exec(id?'set role authenticated':'set role anon');};
  const save=async({cid=ids.a,period='2026-10',version=0,google=null,ora=null,request=randomUUID()}={})=>(await db.query('select public.atlas_save_reputation_month($1,$2,$3,$4,$5,$6) result',[cid,period,version,request,google,ora])).rows[0].result;
  const read=async(cids=[ids.a,ids.b],periods=['2026-09','2026-10','2027-10'])=>(await db.query('select public.atlas_read_reputation_months($1,$2) result',[cids,periods])).rows[0].result;
  await actor(ids.admin);assert.deepEqual((await read()).records,[],'No legacy backfill');
  const request=randomUUID(),first=await save({ora:0,google:0,request});
  assert.equal(first.version,1);assert.equal(first.ora_score,0);assert.equal(first.google_review_score,0);assert.equal(first.updated_by,ids.admin);
  assert.deepEqual(await save({ora:0,google:0,request}),first,'Lost-response retry retains exact immutable receipt');
  await assert.rejects(save({ora:1,request}),/already used/);
  await save({period:'2026-09',ora:80,google:4});await save({period:'2027-10',ora:90,google:5});await save({cid:ids.b,ora:20});
  await actor(ids.manager);let response=await read();assert.equal(response.records.length,3);assert.deepEqual(response.editableCommunityIds,[ids.a]);
  assert.deepEqual(response.records.find(row=>row.period_key==='2026-10'),first,'Second authorized session reads exact saved zero');
  await assert.rejects(save({version:0,ora:50}),/another session/);
  const second=await save({version:1,ora:null,google:0});assert.equal(second.ora_score,null);assert.equal(second.google_review_score,0);
  await assert.rejects(save({cid:ids.b}),/access denied/);
  await assert.rejects(save({version:2,google:6}),/Invalid/);await assert.rejects(save({version:2,ora:-1}),/Invalid/);await assert.rejects(save({period:'2026-13'}),/Invalid/);
  await assert.rejects(db.query('update public.atlas_reputation_monthly set ora_score=99'),/permission denied/);
  await actor(ids.viewer);response=await read();assert.equal(response.records.length,3);assert.deepEqual(response.editableCommunityIds,[]);await assert.rejects(save({version:2}),/access denied/);
  await actor(ids.other);assert.equal((await read()).records.length,1);await assert.rejects(save({version:2}),/access denied/);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from public.atlas_reputation_revisions')).rows[0].n,5);
  await assert.rejects(db.query("update public.atlas_reputation_revisions set record='{}'"),/immutable/);
  await db.query(`update public.atlas_user_profiles set locked_tab_ids='{6}' where user_id=$1`,[ids.manager]);await actor(ids.manager);await assert.rejects(save({version:2}),/access denied/);
  await db.exec('reset role');await db.query(`update public.atlas_user_profiles set account_status='password_reset_required' where user_id=$1`,[ids.admin]);await actor(ids.admin);assert.equal((await read()).records.length,0);await assert.rejects(save({ora:0,google:0,request}),/access denied/);
  await actor(null);await assert.rejects(read(),/permission denied/);await assert.rejects(save(),/permission denied/);
  console.log(`PASS monthly reputation on ${migrations.length} migrations: exact zero/null, two sessions, independent community/month/year, CAS conflict, idempotent receipt, immutable history, RLS, view-only and locked/revoked access, no backfill.`);
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
