// Executes the exact reviewed rollback SQL locally only. No network/database connection parameters.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
(async()=>{
 const {migrationHistoryFixture}=require('./migration-history-fixture.cjs'),{db,migrations}=await migrationHistoryFixture();assert.equal(migrations.length,72);
 const sql=fs.readFileSync(path.join(__dirname,'reforecast-approval-rollback.sql'),'utf8');assert(sql.trimEnd().endsWith('rollback;'));assert(!/\bcommit\b/i.test(sql));
 const before=(await db.query('select count(*)::int n from public.atlas_communities')).rows[0].n;
 const result=await db.exec(sql),proof=result.flatMap(r=>r.rows||[]).find(row=>row.acceptance_result)?.acceptance_result;
 assert.equal(proof?.status,'PASS');assert.equal(proof.allSyntheticRowsRolledBack,true);assert.equal((await db.query('select count(*)::int n from public.atlas_communities')).rows[0].n,before);assert.equal((await db.query('select count(*)::int n from public.atlas_reforecast_publications')).rows[0].n,0);
 // Even an accidentally replaced outer terminator cannot commit seeded rows: inner rollback already removed them.
 const committedTail=await db.exec(sql.replace(/rollback;\s*$/, 'commit;'));assert.equal(committedTail.flatMap(r=>r.rows||[]).find(row=>row.acceptance_result)?.acceptance_result.allSyntheticRowsRolledBack,true);assert.equal((await db.query('select count(*)::int n from public.atlas_communities')).rows[0].n,before);
 // A failed assertion aborts the transaction; cleanup never relies on success output.
 await assert.rejects(()=>db.exec(sql.replace("::numeric<>900 then raise exception 'Synthetic NOI", "::numeric<>901 then raise exception 'Synthetic NOI")),/Synthetic NOI arithmetic mismatch/);await db.exec('rollback');assert.equal((await db.query('select count(*)::int n from public.atlas_communities')).rows[0].n,before);assert.equal((await db.query('select count(*)::int n from public.atlas_reforecast_revisions')).rows[0].n,0);
 console.log('PASS exact rollback SQL: Regional save/review, stale-write denial, atomic failed publication, Admin approval/idempotency, active baseline/report/digest, scoped Regional/report-only/outside/anonymous permissions, immutable direct-write denial, and zero retained synthetic rows.');await db.close();
})().catch(error=>{console.error(error.message,error.where||'',error.stack);process.exitCode=1;});
