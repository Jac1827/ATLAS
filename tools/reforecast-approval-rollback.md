# Forecast approval transaction acceptance

`reforecast-approval-rollback.sql` is a reviewable, single-call production-schema acceptance test. It has **not been executed against a hosted database** by its author. The paired `.test.cjs` runs that exact SQL locally with PGlite.

Run locally:

```sh
node tools/reforecast-approval-rollback.test.cjs
```

The test needs the existing finance/reforecast schemas, current seven Forecast Builder governance migrations, a privileged SQL session able to create synthetic setup records and `SET LOCAL ROLE`, and the ordinary `authenticated`/`anon` roles. Every workflow call itself runs as the actual `authenticated` role with a synthetic UUID JWT subject. No function, RLS policy, grant, or production trigger is disabled or replaced by the test SQL.

Synthetic setup creates four UUID-only Auth parent rows, profiles (Admin, Regional, report-only viewer, out-of-scope manager), two random communities and one original-budget fixture. The Auth rows have no email, password, identity, token or session; no Auth API is invoked. This is transaction-only FK setup, not supported persistent Auth provisioning. The baseline is inserted using all required production columns; its ordinary projection trigger stays enabled. Financial intake approval and real Auth login are outside this test's scope.

The tested lifecycle is Regional save/reconcile/ready/submit, rejection of stale saves and Regional approval, atomic Admin approve/lock/publication, immutable active/report/digest readback, scoped independent readers and RLS denials. Expected revenue is 1,150, expenses 250, NOI 900 and cash flow 880. A NULL publication request intentionally fails after internal approve/lock work; the test checks that the submitted head and revision count remain intact.

All data writes are inside a PL/pgSQL exception subtransaction ending in deliberate SQLSTATE `ZX001`. Catching that exception rolls every synthetic row back **before** returning the PASS result. The test then checks that Auth/community/budget/publication records are absent. The outer `BEGIN … ROLLBACK` is a second safeguard. Local regression also verifies that replacing the outer terminator with COMMIT still retains no synthetic data, and that an arithmetic assertion failure followed by rollback leaves no rows.

Read-only live catalog inspection found no non-internal triggers on `auth.users`, `atlas_user_profiles` or `atlas_communities`; the budget projection writes only its supplied community's command financial records. Reforecast publication can mark unpaid Bonus records stale, but only if their community/assignment matches the new random community, which no preexisting record can reference. No outbound HTTP, webhook, email, dblink, background query or notification functions were found in the inspected application schemas. Logical replication and database notifications do not publish uncommitted row changes. The SQL repeats fail-closed trigger and outbound-function checks before any write, so new trigger/function changes require review.

This test does not create source review identity-sequence rows, transactions with external services, Bonus payment records, or email requests. It neither reads nor mutates real property financial rows for fixture setup. Ordinary database diagnostic logs/query statistics may still record that a rolled-back test ran.

The local runner replays all 72 exact restored production migrations using `migrationHistoryFixture`. The managed Supabase Auth/roles/default grants/digest substrate is emulated locally, and the known legacy `atlas.state_store` table is explicitly bootstrapped from its inspected schema. No application RLS, permission helper or migration body is simplified. Before a hosted run, review the complete SQL and current trigger/function preflight; submit the **whole file once**, then retain only its PASS/error result. On error, ensure the SQL connection is rolled back before reuse. No hosted runner or credential loading is bundled here.
