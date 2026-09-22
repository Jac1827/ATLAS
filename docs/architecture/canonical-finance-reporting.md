# Canonical finance reporting repair — issue #9

An Admin close now commits its reporting projection in the same transaction. A replacement refreshes dependent fiscal YTD snapshots, preserves prior closes and reports, and carries the current close and approved original-budget version into every finance read. Upload and comparison review remain separate from close. The completed-month server check remains mandatory.

## Changes

- `centralization/canonical-finance-reporting.sql` adds immutable original-budget versions and the versioned metric registry, wraps the existing checked close, projects Community Command summaries and findings transactionally, and exposes the scoped `atlas_read_finance` adapter. Projection failure rolls back close. Replays deduplicate by the full evidence fingerprint. An earlier-month correction republishes later affected YTD envelopes.
- The former browser-driven summary publication endpoint can only replay canonical data. It cannot approve uploaded actuals or substitute browser amounts. Existing immutable publications remain available as history.
- Budget Builder provides a separate **Approve Shared Original Budget** review. Active Admin approval retains community, calendar year, fiscal year/start, scenario/version, effective date, source, reviewed metric/GL mappings, signed monthly amounts and approval actor/time. Approval works before any actuals close. Overlapping original-budget periods for the same community/year are rejected; drafts, revisions and reforecasts cannot silently replace the original.
- Community Command, Home/Financial Position, Community Plan reports and XLSX exports, investor exports, canonical Budget Builder actuals, and financial Bonus evidence use the shared adapter. Investor exports use it in both clean and previously saved browsers.
- Cash flow is exposed from the reconciled `Net Cash Flow` source control, including negative amounts and zero. New close records expose `netCashFlow`; historical close rows remain immutable and the adapter derives their value from retained source controls.
- The metric registry includes financial report fields and explicit unavailable definitions. Reviewed GL scopes supply detailed P&L, capital and debt-service metrics where those GLs exist in the closed source. A monthly income statement cannot supply a balance sheet, loan balance, valuation, commitments or investor-return assumptions; those remain unavailable until their appropriate source and approved definition exist. No GLs or financial values were invented.
- Bonus uses the requested whole calendar quarter and year, records approved target/close IDs and registry version, and withholds attainment if any required month/target is absent. Employee, plan, assignment and payment approval rules remain separate gates.
- Latest closed month and complete YTD are distinct. February–August with no January shows latest close August and incomplete YTD; source-statement cumulative figures do not repair missing closes. Reviewed fiscal calendars support cross-year periods. Partial calendar-year segments retain null outside their approved coverage; adjacent fiscal budgets may coexist without overlapping any month.

## Migration and rollout

This is a repository SQL deployment asset, following the existing `centralization/*.sql` convention; it is not a Supabase CLI migration-history file. Do not run it against production merely because a frontend preview exists.

1. In a staging database containing the existing central schema, apply the existing finance and Community Command migrations in their documented order, including `financial-close-source-lineage.sql`, `community-command-report-ytd.sql`, and `financial-admin-publication.sql`.
2. Apply `centralization/canonical-finance-reporting.sql` once. It runs in one transaction and backfills projections for existing close heads without changing approved amounts. It revokes private helper access, preserves scoped policies, and leaves only the checked public entry points callable.
3. Verify Admin, scoped reader, out-of-scope, inactive, module-lock and anonymous access. Existing Supabase advisories and deployment-specific schema settings still require review in that environment.
4. Deploy the matching frontend assets after database verification. The code fails unavailable if the new adapter is absent; it does not fall back to local budgets or legacy uploaded actuals.
5. An Admin reviews and approves the existing original budget once for each approved fiscal budget’s calendar-year segment, confirming its fiscal settings against Community Settings and its full metric GL scope. This is an explicit business approval, not an automatic migration of browser data. The stored budget source hash is identified as a hash of normalized approved rows, not a claimed original-file byte hash.
6. Close or replace only eligible completed-month packages. No separate reporting publication is required. Readback checks both the stored close and current publication receipt.
7. Perform Doro acceptance using the real approved budget and monthly packages in two independent authorized sessions. Compare source totals, detail, Community Command, Home, plans, investor exports and Bonus input evidence; test reload, replacement, original history, signed/zero/missing values and historical periods. September 2026 stays open until October 1 under the completed-month rule. Keep #9 open until this evidence is retained.

Future-effective original budgets are rejected until their effective date; this repair does not implement scheduled activation or a revised/reforecast approval workflow. The original baseline remains immutable. The fiscal settings in this approval are an Admin-reviewed snapshot; this repair does not silently change Community Settings. The GL drilldown retains exact immutable source references and monthly values; complete fiscal YTD totals are in the shared envelope, while per-GL YTD in that drilldown is explicitly unavailable.

Rollback should preserve immutable records. Disable financial approval/close actions and revert frontend assets if needed; do not drop the new tables or restore old values over approved history. Do not restore the old browser publication writer as a production workaround.

## Verification

- 70 of 73 repository test files passed locally. `budget-workbook-import.test.cjs` and `collections-import.test.cjs` require external workbook fixtures unavailable in this task. `source-reconciliation.test.cjs` also fails on unchanged main `cc4588e`; it is unrelated to the finance changes.
- PostgreSQL/PGlite acceptance covers atomic rollback on publication failure, close and budget replay, stale expected versions, replacement history, later YTD recalculation, missing cash control, signed/zero values, future-month refusal, future-effective budget refusal, cross-year fiscal coverage, immutable reports, and scoped independent users.
- Browser fixtures pass in two isolated storage contexts and after reload. Shared budget 120 and actual 100 remain identical, cash flow preserves -5 and budget zero, and export detail retains the close and budget references. These are synthetic values, not Doro production amounts.
- The real Budget Builder renders February–August coverage with January absent, August actual 100, September missing, and incomplete YTD. The separate approval screen retains explicit zero and verifies the shared approval receipt.
- Cache keys are regenerated from content. No production SQL, budget, close, mapping, configuration or report delivery was performed during implementation.
