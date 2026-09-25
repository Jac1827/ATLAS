# Finance request performance

This change targets the finance bottleneck measured on production commit `3d80173de32f227410663662a523932c50ecaa2b`. The measurements below are the **before** baseline. Candidate production latency and authenticated multi-session acceptance remain pending; local correctness results do not establish production performance.

## Measured baseline and plan

Each diagnostic used the verified signed-in administrator's existing access scope, an explicit read-only transaction, the authenticated database role, a 20-second statement timeout and a 2-second lock timeout. No identity, credentials or financial values were included in the saved plan artifacts. These were individual observations on a shared database, not statistical latency distributions.

| Read | Database result |
| --- | --- |
| One community/month with stored finance | 309.272 ms |
| Authorized portfolio and all 12 calendar months | Canceled at the 20-second statement limit |
| Effective-baseline resolver for that portfolio/year | 3,094.077 ms |
| Authorized stored-summary lookup and serialization | 40.641 ms |

The plain finance plan exposes a `Function Scan` because the RPC uses PL/pgSQL. The timed-out call's stack reached the recursive fiscal-YTD branch in `atlas_private.reforecast_finance_summary`. The stored-summary lookup used the existing `command_financial_summary_period` index. No missing index was established, and this change adds none.

Representative plan shape, with inputs supplied by the authorized session:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT count(*), sum(octet_length(r.summary::text))
FROM public.atlas_read_finance($1::uuid[], $2::text[]) r;
```

Successful sample plans reported zero shared disk-read and temporary-read blocks. This does not establish that other workloads have no I/O cost. The portfolio/year input was derived from the deployed client source; it was not represented as a captured browser payload. Full private diagnostic artifacts remain in ignored `output/issue12-baseline/`.


A separate local PGlite/WASM plan used the complete restored schema and its existing budget-projection trigger to generate 336 synthetic summaries (28 communities × 12 months). With the same rows and authenticated synthetic role, the old portfolio/year reader took 13,182 ms and the candidate took 7,814 ms. The one-community/month observations were 68.9 ms and 77.6 ms respectively. These single local observations do not predict production latency: the portfolio request remains expensive, and selecting only the current UI scope is essential. The sanitized plan and parameter-only query template are saved under ignored `output/issue12-release-review/finance-local-plans.json` and `.md`; no production source values are included.

## Change and invariants

Migration `20260924203341_finance_request_context.sql` and `centralization/finance-request-context.sql` have identical bodies. They materialize the existing authorized stored summary rows once, resolve only the community/month pairs needed for those summaries and fiscal YTD, and compute metric targets once per community/month/original-budget-version within the request. Resolver calls remain within the existing 24-month limit. All database readers remain `STABLE`, so each request uses one database statement snapshot.

The effective-baseline resolver is unchanged. Its exact publication, budget, close and source references; content hashes; unavailable states; and source lines remain authoritative. The two-argument finance-summary helper used by Bonus is preserved. No financial facts, immutable publications, original budgets, approvals or payout records are changed. No persisted cache, new table or index is introduced. New private helpers are denied to PUBLIC, anonymous and authenticated API callers; the existing public read boundary and access checks remain in place.

`readFinance` stays fresh by default. Presentation callers may request simultaneous-read coalescing with `readMode:'presentation'`. Its key includes actor, backend, profile role/status/scope, community and period selection, comparison basis and an optional evidence revision. Each consumer receives independent data and cancellation; the last departing consumer aborts the fetch. Completed canonical reads are not cached. Changed access or explicit invalidation rejects late responses.

The display cache adds:

```js
await cache.refreshScope({
  communityIds, periods,
  communities: knownAuthorizedRoster,
  signal,
  force: false,
  versionKey: knownEvidenceRevision
});
```

Existing `get`, `envelope`, `summary`, `bonus` and `clear` methods remain. `refresh(year, force)` remains for compatibility; startup and selected reports should use explicit scopes. Successful display results retain the existing 60-second refresh interval; failures remove affected evidence and use a five-second retry cooldown, with `force` bypassing it. Forced refresh cancels older presentation reads. Late responses cannot overwrite a newer selection or forced read. Cached display evidence does not authorize payment: the server's canonical approval/locking/payment checks still validate current evidence independently.

## Local validation

The pre-change baseline ran all 137 unique CI Node commands successfully at the exact original commit. The candidate tests compare both complete parsed JSON and PostgreSQL's exact serialized JSON text before and after replacing the reader. They cover original budgets without a registry, split-year budgets, cross-calendar fiscal YTD, missing/zero/negative values, unsupported mappings, duplicate and reordered inputs, mixed original/forecast months, stale and reopened forecasts, version/source ancestry, scoped roles, disabled/anonymous access, and the Bonus helper signature.

In the instrumented synthetic parity workload, full metric aggregations fell from **6,606 to 63**, and resolved baseline-month invocations from **259 to 63**, with identical complete outputs. These are work counts, not claimed production speedups. The instrumentation exists only in the local test fixture.

Focused checks:

```sh
node tools/finance-request-context-db.test.cjs
node tools/finance-scoped-reads.test.mjs
node tools/canonical-finance.test.mjs
node tools/financial-close.test.mjs
node tools/canonical-finance-db.test.cjs
node tools/reforecast-original-baseline-db.test.cjs
node tools/reforecast-builder-db.test.cjs
node tools/bonus-workflow-db.test.cjs
node tools/bonus-workflow-boundaries.test.cjs
node tools/bonus-workflow-rollback.test.cjs
node tools/migration-history.test.mjs
node tools/migration-history-replay.test.cjs
```

The original finance validation replayed all 76 migrations then present, including the separate scoped startup reader. The later publisher and scoped-reader tests replay all 77 migrations after PR #31. The production-schema Bonus acceptance test passes with this reader, including server calculation, independent approval, retained history and external payment recording; its synthetic rows are rolled back. No production financial workflow was executed for this change.

## Deployment, comparison and rollback

The configured integration automatically applied this additive migration with PR #30, before activating the matching application changes. Live function bodies and grants match the reviewed SQL. The client release and controlled authenticated performance acceptance remain pending; degraded service observations are not comparable performance samples. Retest the same bounded scopes and inspect complete response/version parity. A before/after response-hash comparison is valid only when its source-lineage hash also matches; changed source heads require re-establishing the comparison. The read-only parity template in the ignored baseline artifacts emits only result counts and hashes.

`centralization/finance-request-context.rollback.sql` retains the previous reader and summary function bodies as a **forward rollback template**. If needed, create a new migration containing that template and deploy the prior application revision. The template restores function definitions and grants without deleting the new private helpers or modifying financial data/history. Do not edit an already-applied migration or remove immutable records to roll back this performance change.
