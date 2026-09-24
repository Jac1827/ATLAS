const assert = require('node:assert/strict');
const {migrationHistoryFixture} = require('./migration-history-fixture.cjs');

(async () => {
  // Keep the unmanaged legacy prerequisite visible; a green compatibility run must not imply a bare reset is ready.
  await assert.rejects(() => migrationHistoryFixture({legacyBootstrap: false}), error =>
    error.code === '3F000' && error.migrationFile === '20260824141549_atlas_security_advisor_hardening_phase1.sql');
  const {db, migrations} = await migrationHistoryFixture();
  try {
    const result = (await db.query(`select
      to_regprocedure('public.atlas_reforecast_effective_baseline(uuid[],text[])') is not null as effective_baseline,
      to_regprocedure('public.atlas_read_bonus_receipts(text)') is not null as bonus_receipts,
      (select relrowsecurity from pg_class where oid='atlas.state_store'::regclass) as legacy_rls,
      not has_table_privilege('authenticated','atlas.state_store','SELECT') as legacy_client_denied,
      not has_table_privilege('authenticated','atlas_reforecast_source_reviews','INSERT') as direct_source_write_denied,
      not has_function_privilege('anon','public.atlas_save_forecast_contract(uuid,uuid,integer,uuid,jsonb)','EXECUTE') as anonymous_contract_denied,
      (select count(*) from auth.users) as auth_rows,
      (select count(*) from atlas_communities) as communities,
      (select count(*) from atlas_approved_budget_versions) as budgets,
      (select count(*) from atlas_bonus_calculation_runs) as bonus_runs`)).rows[0];
    for (const key of ['effective_baseline','bonus_receipts','legacy_rls','legacy_client_denied','direct_source_write_denied','anonymous_contract_denied']) assert.equal(result[key], true, key);
    for (const key of ['auth_rows','communities','budgets','bonus_runs']) assert.equal(Number(result[key]), 0, 'Replay must not seed live identity or financial data: ' + key);
    console.log(`PASS ${migrations.length} exact historical migrations with documented managed-platform emulation and empty legacy-state bootstrap; bare replay failure remains explicit.`);
  } finally { await db.close(); }
})().catch(error => { console.error(error.migrationFile || '', error.message); process.exitCode = 1; });
