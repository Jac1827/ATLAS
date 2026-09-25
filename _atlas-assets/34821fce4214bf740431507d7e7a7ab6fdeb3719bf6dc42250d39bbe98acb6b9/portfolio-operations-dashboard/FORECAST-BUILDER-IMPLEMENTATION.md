# Forecast Builder implementation and verification

The build extends the canonical `atlas_reforecast_*` revisions, publications, heads, original-budget versions, governed financial closes, utility vintages, and `atlas_contracts`. It adds immutable source review events, reopen events, report receipts, and contract change events. It does not create another community directory or an alternative forecast database. The Forecast Builder application and its four additive database migrations were released on September 24, 2026. The subsequent migration-history reconciliation preserves all 72 installed SQL bodies under their exact production versions.

## Authority

| Action | Canonical roles and scope |
| --- | --- |
| Create/edit/reconcile/submit forecast inputs | `admin`, `executive`, `regional`, `centra`, `community_manager`; canonical community scope and Budget tab/page locks apply |
| Approve and lock, publish, reopen, approve source/GL mappings | `admin` and `executive` only; `executive` is the VP authority mapping |
| Create canonical contract record | `admin`, `executive`, `regional`, `centra` in scope |
| Edit canonical contract record | Those roles or the stored record creator, still subject to community scope and Budget locks |
| Read public report and effective baseline | Existing authorized community/report scope |
| Read raw uploaded bytes or scenario input rosters | Forecast editor scope; ordinary report projections omit private identifiers and binaries |

Central Services is the authorization code `centra`. `central_services` is an existing bonus role type, not the account permission code. Titles are not used for authorization. Existing legacy Contract Manager permissions remain intact; the new workflow writes canonical contracts transactionally and detects contract content changes even when a legacy writer fails to increment the version.

## Lifecycle and lineage

- All workflow changes use scoped RPCs. A community transaction lock prevents concurrent creation of more than one editable scenario for the same normalized, exact month set. Expected revisions and request IDs reject stale saves and bind retries to the same change. Submitted changes require another working revision.
- `approve_lock` atomically appends approval/lock revisions, publishes the immutable snapshot, and updates eligible monthly active heads. An injected publication failure leaves the submitted draft and prior active heads intact. Approved and locked vintages are retained permanently.
- Baseline selection records original-budget versions and selected approved publication ancestry by month and GL. Original budget, selected baseline, active baseline, and governed actuals remain distinct. Closed/bonus-locked months retain exact inherited values and lineage, and their active pointers are not replaced. Reopen retains the prior vintage and locked-month pointers while retiring only the affected open-month coverage.
- `atlas_reforecast_effective_baseline` supplies verified monthly evidence. Source rejection, changed contract content, changed utility vintage/rates, reopened or excluded close evidence, missing coverage, and failed readback return unavailable. Missing amounts are not replaced with zero.
- Canonical finance reads retain the original comparator and attach the effective baseline. Fiscal YTD is composed from each month's effective baseline and becomes unavailable when any required monthly target is unavailable. Forecast variance is forecast minus selected baseline; actual variance is actual minus active baseline. Favorability is a separate result.
- Provider/contract bytes are hashed and retained in the existing upload ledger. Scoped editors can prepare draft mapping inputs, while publishing the shared GL registry and approving source mappings require Admin/executive authority. Editors can retain mapping proposals in immutable working revisions with base registry version, actor, time and audit history; an Admin explicitly activates a reviewed proposal with optimistic registry version checks. Source approvals are immutable reviewed mappings; statements must reconcile and match their assigned community, month and source hash. Public source receipts contain approved summaries, mapping version, review receipt, and hash, with `reviewState`, `readbackVerified`, and `periodBasis` for eligible statement history. Reservation/unit detail and source binaries are not included in ordinary reports.
- STR schedules recalculate roster availability, take-backs, occupied nights, rates and contributions independently in the database. Gross treatment posts potential income plus negative vacancy; net treatment posts net income once. Snapshot exports retain aggregate schedules rather than unit references. Utility drivers verify the active provider vintage, source cells, prior full governed close, registry relationship, reviewed rate, and calculated amount. Reviewed utility relationships are frozen in the source registry so gross utility expense, related recovery income, and the signed recovery gap remain reproducible.
- Contract files link to an existing canonical contract. Save RPCs preserve creator, version, exact null/zero values, actor and immutable before/after evidence. Unknown vendor/date/amount is not inferred; creating a record requires an explicit vendor.
- Unpaid, unlocked bonus runs receive a stale-baseline exception after publication/reopen and require recalculation. Paid or locked bonus periods/runs have database mutation guards and exact hash/line receipt verification. Their historical amounts remain unchanged. Portfolio captures with no run-level community resolve scope through exact employee assignments. Unpaid approved receipts compare each retained quarter baseline and actual-close version with current governed evidence, including source review invalidation; paid and locked receipts retain their original evidence. They also require the exact canonical incentive-plan UUID/version, effective dates, role, metric definitions, explicit eligibility rules, and active bonus-eligible employee assignment with matching version and dates. Local seeded plans, missing canonical proof, unsupported eligibility rules, or partial-period assignments without verified proration remain nonpayable. Client composition retains monthly baseline, assignment, plan and close lineage; it does not itself authorize payment.
- Report PDF/XLSX and portfolio HTML/PDF/XLSX use immutable, scoped report projections/receipts. Saved portfolio digests remain unchanged after later approvals or reopen events.

## Initial planning and missing sources

RISE Doro's existing drafted STR browser scenario can be copied explicitly into the governed workflow after choosing the canonical community, then reviewed through the setup questionnaire and source mappings. This copy is a planning input, not an approved budget, financial actual, or automatic historical recommendation. The deployment must verify that the existing scenario is available to the authorized user and that the required approved baseline exists. No permanent Doro name/ID conditionals are introduced.

Monthly actual recommendations use twelve explicit historical close/baseline envelopes separate from forecast lines, with unavailable months excluded. Provider rate recommendations require three comparable approved statements and normalize for roster and occupancy. Missing statement history, provider rate cells, or full governed actuals stay unavailable. The supplied Hello Landing document is reference evidence; it was not financially approved or published as a production source during implementation. The existing initial and updated FY2027 utility workbooks were inspected locally: the Doro electricity, gas, sewer and water rows explicitly state that utility bills are unavailable and their monthly cells are blank. No rates were inferred or published; the existing governed utility source ledger is reused.

## Additive migrations

The Forecast Builder release installed these migrations in order (filenames now match the production ledger):

1. `20260924165534_reforecast_builder_governance.sql` — roles, atomic lifecycle, effective baseline and fiscal YTD, locked inheritance, source review, STR validation, bonus stale markers and retained payout guards/receipts.
2. `20260924165542_reforecast_report_receipts.sql` — public publication projections and immutable portfolio digest receipts.
3. `20260924165545_forecast_contract_workflow.sql` — canonical contract creator, scoped transactional save/read, immutable contract events.
4. `20260924165549_reforecast_utility_drivers.sql` — independently verified utility forecast drivers and lineage.

These are additive to retained data, but the first migration changes the live RPC contract: the previous application sends separate approval and lock actions, previews closed-month actual substitution, and does not consume active forecast targets consistently. Apply the database and compatible application as a coordinated release; do not leave the previous UI active throughout preview testing. Installing the SQL itself performs no financial publication, recalculation, or balance rewrite.

Each has a matching centralization SQL source. The migration history was subsequently reconciled without replaying applied SQL. See [migration history](../../supabase/MIGRATION-HISTORY.md) and [shared Bonus workflow](BONUS-WORKFLOW.md) for the automatic deployment configuration and the follow-up workflow release.

## Validation

The following database suites passed against local PostgreSQL-compatible PGlite fixtures:

- Existing `reforecast-governance-db`, `reforecast-review-db`, and `planning-governance-db` regressions.
- `reforecast-builder-db`: role denials, community scope, exact editable period uniqueness, optimistic conflicts, request replay, atomic failure rollback, locked-month values, new vintages, source rejection, deterministic STR, fiscal YTD composition/unavailability, sunset metadata, and paid versus unpaid bonus handling.
- `reforecast-original-baseline-db`: original budget metric mappings without a forecast registry, exact monthly selection across nonoverlapping original-budget versions, fiscal YTD, missing amounts and real zeros.
- `reforecast-builder-upgrade-db`: existing original budget, full close, and legacy publication survive byte-for-byte; inherited locked detail remains exact; reopening February preserves January.
- `reforecast-builder-integration-db`: all four migrations installed together in clean and upgrade fixtures, approval, report/digest readback, canonical contract, same immutable evidence under Admin and Regional roles, and coverage invalidation.
- `reforecast-original-baseline-db`: canonical approved metric formulas without a forecast registry, exact monthly split-year budget versions, fiscal YTD, and unknown versus zero targets.
- `reforecast-bonus-current-db`: portfolio run assignment scope, publication/reopen stale markers, closed-period inheritance, unpaid close/source freshness, wrong/changed plan or metric rules, expired/inactive assignments, missing employee eligibility, and local-plan denial without rewriting locked results.
- `reforecast-bonus-receipts-db`: exact scoped hash/line receipts, retained period/date/run/line mutation guards, missing historical evidence, and Bonus-page denial.
- `forecast-contract-workflow-db`: scoped creator editing, Budget locks, unknown values/zero, expected version, idempotency, immutable events, and stale source detection after legacy direct edits.
- `reforecast-report-receipts-db` and `reforecast-utility-db`: scoped immutable/redacted output, source hashes, mixed monthly ancestry, unavailable/stale evidence, and utility recalculation.

Full application regression: **137 of 138 test files passed**, including all new unit/database/consumer suites and the ticker regression. The remaining `collections-import.test.cjs` requires a specific private workbook fixture; the available workbook does not match it. The identical assertion fails against unchanged `origin/main`, and the collections importer was not modified. The exact expected private fixture is unavailable.

The follow-up live-test preflight found and fixed two Bonus projection defects: an explicit approved zero override fell back to the earned amount, and already direction-adjusted expense attainment was inverted again by the payout curve. Invalid approved override amounts now block the proposal instead of silently substituting a payout. Financial attainment is scored once while preserving the canonical metric definition, raw-metric policies, and signed actual-minus-baseline variance. All ten focused Bonus/financial-consumer/asset checks passed after these corrections, including the new `bonus-financial-attainment` regression and expanded `bonus-prerequisites` checks. These local results are supplemented by the production transaction acceptance below; they do not authorize real payments.

All three focused Playwright suites passed:

- `reforecast-builder-browser`: full-month setup, real SQL-backed save/readback, independent editor sessions, STR take-back recalculation, mobile layout, failed-save recovery, stale-session rejection, Regional approval denial, atomic Admin approval, effective baseline, identical Admin/Regional report and Bonus target evidence after reload, community PDF/XLSX, saved CSV and portfolio HTML/PDF/XLSX downloads.
- `reforecast-provider-browser`: native extraction of the supplied private Hello Landing PDF, signed reconciliation, original hash and immutable source review/readback, independent role sessions, restricted-detail suppression, explicit RISE mapping, invalid/missing occupancy rejection, canonical contract source and separate user-rate override. The private PDF stays outside the repository.
- `reforecast-ui-browser`: recoverable grid edits, first-run setup without a registry, Regional mapping proposals shared through a saved working revision and explicitly activated by Admin, mapping form preservation/cancel, selected approved baseline retained after saving mappings, later governed-close accuracy without changing retained forecast/source bytes, honest unavailable accuracy on read failure, and PDF/XLSX/JSON export cancellation if the community changes during an asynchronous read.

Synthetic community and portfolio PDFs were rendered and visually checked; XLSX files were reopened and checked for matching amounts, formula-injection protection and privacy. Desktop and 390px mobile layouts were inspected. These browser sessions use separate identities against local SQL fixtures. Real multi-user browser signoff remains separate from the local browser tests and live database transaction acceptance described below.

## Read-only production preflight

Checked the verified ATLAS deployment on 2026-09-24 without mutation. The live database has the required source tables/columns, canonical functions, coverage helper, and planning trigger. No new-object or intermediate function-rename collisions or conflicting editable forecast period sets were present. The role constraint supports `executive` and `centra`. Production sources and legacy write permissions were inspected for compatibility; no private source content is included in this handoff.

The prior timestamp mismatch is resolved: all 72 installed migrations were recovered and compared with the production ledger, including exact SQL hashes. No history was deleted or marked applied artificially. The Supabase GitHub integration now uses repository root `.` and `main`, with automatic production deployment enabled and verified after saving. Automatic preview branching remains disabled because an empty environment still needs the documented legacy table prerequisite.

## Production verification and follow-up

Forecast Builder production release PR23 merged as `e310e50f2c4e44c631d018f562f4162ccbaa82f4`; GitHub Pages and Cloudflare deployments passed. All 20 inspected existing financial/history tables retained their counts and aggregate hashes, and all 13 checked runtime assets on both routes matched the release. A signed-in production browser verified Doro's approved baseline and the August governed close, then closed setup without saving a real forecast.

On September 24, the reviewed `tools/reforecast-approval-rollback.sql` passed against production. Actual authenticated database roles and distinct synthetic actors exercised Regional save/reconcile/submit, stale and unauthorized approval denials, an intentionally failing atomic publication, successful Admin approve/lock, effective baseline and immutable report/digest readback, report-only/out-of-scope access denials, and expected NOI of 900. A deliberate inner rollback removed every synthetic fixture before returning PASS; the outer transaction also rolled back. This verifies the live database workflow, not real Auth provisioning or independent human browser signoff. No real financial/source approval, employee eligibility change, or payment was performed.

The follow-up shared Bonus workflow provides explicit plan and eligibility setup, database-calculated quarterly results, independent approval, immutable locking, and external payroll confirmation. Existing local defaults cannot establish approved terms or eligibility. Before operational payouts, authorized staff must supply the actual plan, effective dates, employee eligibility, and complete governed financial sources. See [shared Bonus workflow](BONUS-WORKFLOW.md) for the supported scope and release checks.

Rollback preserves all original budgets, closes, publications, uploads, reviews, report receipts, contract events, and bonus evidence. Revert application assets through the established release workflow and temporarily disable incompatible forecast actions. Do not drop or rewrite the additive history. Older application assets that use separate approve/lock actions cannot finalize the new workflow; restore compatible assets or keep those actions unavailable until recovery. Baseline retirement/reopen, where needed, must use the governed authorized workflow rather than manual deletion.
