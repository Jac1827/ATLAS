const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {migrationHistoryFixture}=require('./migration-history-fixture.cjs');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../docs/portfolio-operations-dashboard/centralization/bonus-workflow.sql'),'utf8');
 assert.equal(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260924171402_bonus_workflow_completion.sql'),'utf8'),source,'Migration must mirror reviewed canonical source');
 const {db,migrations}=await migrationHistoryFixture({includeLater:true});
 try{
  const sql=fs.readFileSync(path.join(__dirname,'bonus-workflow-rollback.sql'),'utf8');
  const results=await db.exec(sql);const proof=results.flatMap(r=>r.rows||[]).find(r=>r.bonus_acceptance_result)?.bonus_acceptance_result;
  assert.equal(proof?.status,'PASS');assert.equal(proof?.serverQuarterlyPayout,1000);assert.equal(proof?.allSyntheticRowsRolledBack,true);
  const counts=(await db.query(`select (select count(*)::int from auth.users) actors,(select count(*)::int from atlas_communities) communities,(select count(*)::int from atlas_employees) employees,(select count(*)::int from atlas_incentive_plans) plans,(select count(*)::int from atlas_bonus_calculation_runs) runs,(select count(*)::int from atlas_private.bonus_external_payments) payments`)).rows[0];
  assert.deepEqual(counts,{actors:0,communities:0,employees:0,plans:0,runs:0,payments:0});
  console.log(`PASS Bonus production-schema double rollback after ${migrations.length} exact migrations: real role/claims, canonical quarterly sources, approval/payment tracking, no persisted synthetic data`);
 }finally{await db.close();}
})().catch(e=>{console.error(e.migrationFile||'',e.message,e.where||'');process.exitCode=1});
