# ATLAS architecture and scalability audit — 2026-09-21

Status: initial measured audit; implementation and production acceptance remain incomplete. Issue #12 stays open.

## Evidence and boundaries

Repository baseline: 632dc546691ef5799349a98121dd256fff814ff0. Existing partial repair: 47b23bd34ccd980c6ccfdb8d51e09240b6df9038, branch repair/issue-12-performance. This audit adds local API instrumentation but makes no production database, authorization, calculation, retention or infrastructure changes.

Live read-only catalog/statistics inspection used the ATLAS Supabase project, Postgres 17.6.1.127 in us-west-2. Retained metadata is in ATLAS-architecture-baseline.json. Query statistics reset at 2026-09-19 02:30:12 UTC. Counters are cumulative over that window, not per-user measurements or percentiles. Estimated tuple counts are not exact counts; several are clearly stale. Relation sizes include indexes and TOAST, not network transfer sizes.

The user confirmed that there is **no existing Power BI semantic model**. Power BI work is new development, not optimization of a deployed model.

Local browser evidence from the previous repair: signed-out warm startup had a 604 ms long task, including 405.9 ms staffing synchronization. Earlier intermediate build measured 663 ms and 453.8 ms respectively. These are single observations, not a controlled speedup claim. Authenticated production browser control timed out; production latency and memory acceptance remain pending.

## Findings and priorities

| Finding | Evidence/classification | Recommended action | Expected improvement | Risk |
|---|---|---|---|---|
| Browser startup performs expensive staffing normalization | Confirmed local 405.9 ms stage; 604 ms long task | Avoid repeated whole-community normalization; reconcile output, then defer work that is not necessary for the selected workspace | Recover some of the measured stage time; exact saving unmeasured | Medium: staffing/bonus semantics |
| Most application code remains inline | Confirmed ~3.37 MB repair HTML; baseline 3,387,363 bytes | Feature modules; defer XLSX and packet dependencies after helper audit | Smaller initial parse and transfer; quantify with cold traces | Medium: global dependencies |
| Application hydration accumulates every import page | Confirmed readApplicationImports loops through 100-row pages, select=* including JSON records | Separate summary/paged-detail APIs; preserve a deliberate full-history consumer where required | Bound browser memory and data transfer by page size | High: existing reports require complete scope |
| Large shared-document evidence dominates storage | Confirmed app documents 55,435,264 bytes; versions 55,377,920; audit 55,795,712 | Small dashboard snapshots; explicit evidence/history reads; immutable evidence references for future model | Bound dashboard payload independently of evidence history | High: archive/version/readback integrity |
| Imports still depend on the browser for approval processing | Confirmed approval loop in index.html; worker only previews | Durable server jobs, checkpoints, staged approval and transactional publication | User remains responsive; jobs survive leaving page | High: exactly-once effects and permissions |
| Frequent live presence work | ~2,419 calls, mean 18.55 ms, max 727.35 ms in initial snapshot | Measure event rate per session; preserve cadence; remove only duplicate calls | Lower request volume; do not infer outage from max | Low–medium |
| RLS advisor warnings | 8 auth init-plan warnings; 23 multiple-permissive-policy findings | Test equivalent policies under each role; optimize only measured expensive plans | Unknown until role-specific plans measured | High: authorization |
| No Power BI model exists | User-confirmed | New governed star model and tested incremental refresh | Avoid future repeated full-history extraction | Medium–high: model definitions/access |
| No generalized job/snapshot analytics layer found | Catalog and repo audit; specialized DLR/marketing/maintenance tables exist | Extend those semantics with governed metric versions and durable job state | Removes raw-history recomputation from live reads | High: business calculation reconciliation |

No percentage improvement is promised without identical-state before/after measurements.

## Current architecture inventory

**Frontend.** Vanilla browser JavaScript and inline HTML/CSS, with global state and feature scripts; no evidence of React/Vue or an application bundler. Existing partial repair dynamically loads maps, presentations and workbook worker/session code. PDF/PPTX/ZIP/Leaflet are lazy; XLSX and some packet code remain eager. Local storage/IndexedDB persist substantial state. Current startup still waits for scope hydration before initial rendering. Existing shared render scheduling does not establish coverage of every callback.

**Backend and integrations.** Cloudflare Worker in src/worker.mjs serves assets and APIs. Configuration includes three SQLite Durable Object bindings (sync state, eviction cases, property specials), weekday 15-minute scheduled report delivery, and email integration. Observability is configured at full head sampling in the repository; retention, actual log completeness and alert routing have not been verified. Supabase Auth/PostgREST/RPC handles Central data. Marketing uses a separate Supabase project; its live workload has not yet been audited. External Entrata/Egnyte runtime calls, rate limits and latency need separate traces.

**Database.** 41 public tables plus atlas.state_store observed, all with RLS enabled. RLS-enabled does not by itself prove correct authorization. Catalog contains employees/assignments, communities/aliases, budgets/actuals/contracts, marketing/maintenance metrics, inspection records/snapshots, bonus plans/runs/lines, shared documents/versions, application imports/versions, mapping queues/logs, delivery subscriptions/history and user access. No application views/materialized views were returned in public/atlas/atlas_private. Existing generalized daily/monthly metric snapshots were not found.

**Indexes.** Retained catalog records all public indexes. Already present: budget/actual community-period-account indexes; assignment employee-community-effective dates; document key and version indexes; unique community/content-hash application imports; notification recipient/time; DLR reporting/community indexes. Advisor reports 45 uncovered foreign keys and 30 unused indexes. These are candidates, not orders to add 45 indexes or remove 30. Short observation windows and small tables make blind changes inappropriate.

**Functions/triggers.** Function metadata retained for public/atlas_private. Authorization helpers are STABLE SECURITY DEFINER functions; existing publication and revision routines must remain authoritative. Document update validates authentication/admin permission and expected version, then stores the current payload, full version payload, and before/after audit payloads. This explains storage amplification, but it is required evidence, not disposable duplication. The visible information_schema trigger inventory included access-change notification; completeness is limited by catalog visibility. Function privilege/security review remains incomplete.

**Connections/capacity.** Database size 186,289,299 bytes (~177.66 MiB). Snapshot showed 13 client backends (12 idle, one active), plus background workers. max_connections=60; this is not a pool-utilization measurement. Management session statement_timeout=120000 ms and idle_in_transaction_session_timeout=0; application roles may override them. Advisor reports Auth fixed allocation of 10 connections. Supavisor mode/pool limits, CPU, storage-object bytes, time-series growth and peak concurrent utilization remain unverified. Current evidence does not justify a warehouse or read replica.

**Caching.** IndexedDB/local state and content-versioned feature files exist. Complete cache TTL/invalidation, permission-revocation behavior, document deduplication and immutable archive cache still require inventory. Do not cache session secrets or treat cached metrics as fresh.

**Imports.** Source archival, duplicate protection, approval mapping, publication/readback and occupancy replay exist. New preview worker bounds unrelated sheet samples and supports cancellation. A preview cancellation must remain distinct from cancellation of a durable accepted import. Main-thread fallback and renewal parsing remain open responsiveness work.

**Power BI.** No model/connection/refresh job exists per user. There is therefore no current Power BI refresh baseline, capacity measurement or model to restructure. Repo search found generator references but no PBIX/PBIP/TMDL/BIM model.

## Observed database workload

| Operation | Calls | Mean execution | Maximum | Interpretation |
|---|---:|---:|---:|---|
| Live presence upsert | 2,419 | 18.55 ms | 727.35 ms | Frequent application work |
| Application imports page | 320 | 101.15 ms | 759.59 ms | Full JSON record response; growth concern |
| Shared document key lookup | 2,084 | 11.45 ms | 576.60 ms | Indexed key access already present |
| Shared document update | 103 | 110.00 ms | 2,671.69 ms | Includes integrity/version/audit writes |
| Live session read | 2,416 | 3.01 ms | 343.39 ms | Generally small database component |
| Archive verification | 1 | 29,045.48 ms | 29,045.48 ms | Administrative MCP query, not ordinary navigation |

These values measure Postgres execution, not network transfer, JSON processing, browser rendering or end-to-end UX. PostgREST aggregate rows can represent one JSON response rather than records returned; do not label pg_stat_statements.rows as UI record count. Records scanned require representative query plans. No EXPLAIN ANALYZE writes were run.

Acceptable observed foundations: document reads already use a specific key/limit, application reads already use keyset pagination, notifications are limited to 100, revisions and duplicate keys exist, existing integrity tests cover publication and authorization. These remain foundations, not full acceptance.

## First three implementation contracts

### 1. Governed metric snapshots

Begin with physical/leased/trending occupancy for one community and period, using the existing Issue #7 formulas and denominator exclusions verbatim. Run a shadow calculation alongside current output; no dashboard switch until exact reconciliation.

Snapshot grain: community + metric + daily/monthly period + effective date + calculation version + source version + revision. Include numerator, denominator, value, source system/file references, quality, calculated timestamp, override and approval state. Missing values stay null; zero denominator does not become zero percent. Portfolio ratios aggregate valid numerators/denominators, not averages of percentages.

Use immutable revisions plus a transactionally updated last-verified pointer. A failure leaves that pointer intact and records stale status separately. Dependencies are a validated acyclic registry with scope transformations; Doro occupancy may invalidate Doro trend/goal/bonus and its reporting partition, never unrelated communities. Job uniqueness includes scope, metric, period, input fingerprint and calculation version. An outbox in the same publication transaction prevents lost invalidations. Recheck source version at commit to reject stale computation.

Extend coverage to all requested metrics only after approved formula/grain/source contracts exist. Existing DLR, marketing and maintenance snapshots require mapping, not silent replacement.

### 2. Durable asynchronous imports

Private immutable raw file → durable job receipt → background hash/validation → staging/record classification → mapping review → approved bounded upserts → scoped snapshot invalidations → cache invalidation/reporting partition notification → completion.

Durable acceptance must mean the file is securely stored and the job committed. A sub-two-second completion of arbitrary network uploads cannot be guaranteed: measure immediate UI acknowledgement separately from durable receipt, and define file/network classes.

Each job stores owner/community scope, source hash, parser/mapping versions, priority, stage, progress denominator, attempts, next attempt, lease expiry, checkpoint and error code. Use bounded worker concurrency per source/community and globally. Lease/fencing tokens prevent an expired worker from committing. Checkpoints and idempotency keys make retries safe. Retry only transient failures with backoff; permanent failures quarantine; exhausted jobs go to dead letter.

Classification preserves new/changed/unchanged/duplicate/deleted-at-source/superseded/rejected/ignored/awaiting-mapping. Never infer source deletion from a partial report. Raw source and mapping approvals remain immutable evidence.

Cancellation is cooperative at safe batch boundaries. It cannot interrupt a protected commit or erase already committed records. Reauthorize submission, approval, retry and cancel server-side. Protected jobs need elevated permission and explicit confirmation. Restart creates a linked attempt and does not duplicate operational effects. Preview workers may terminate on navigation; accepted server jobs continue.

### 3. First Power BI model

Dimensions: Date, Community, Region, Metric, Employee, Person (restricted), Unit, FloorPlan, LeadSource, Vendor, Account, BonusPlan. Scope personal/HR dimensions separately; a broad reporting credential must not make sensitive data visible to unauthorized report users.

Facts and grain:
- Occupancy/metric snapshots: one community/metric/effective date/period/verified revision.
- Application/leasing events: one stable source event.
- Renewal events: one lease renewal event; exposure snapshot separate by lease/effective date.
- Delinquency: one receivable/effective date.
- Financial actuals: one accounting line.
- Budget and approved goals: one community/account-or-metric/period/approved version.
- Work orders/inspections: one work order or inspection event, with status snapshots separate where needed.
- Vendor performance: one governed vendor/community/period/metric result.
- Bonus results: one employee/plan/performance-period/approved calculation line.

Default Import mode; dimensions filter facts in one direction. Explicit governed measures; technical keys hidden. RangeStart-inclusive/RangeEnd-exclusive filters must fold to database predicates and be verified in traces. Initial historical backfill is explicit and bounded; routine refresh covers open/recent partitions. Older corrections create an authorized targeted partition request; never silently rewrite closed periods. Refresh watermark advances only after successful partition publication. Final refresh horizons and report RLS need business approval.

Microsoft reference: https://learn.microsoft.com/en-us/power-bi/connect-data/incremental-refresh-configure

## Performance Control Center contract

Settings must lazy-load an admin-only view backed by a server-authorized, bounded telemetry API. Do not send privileged database credentials to the browser. Local development diagnostics are not a substitute for this control center.

Events need correlation ID, module/action, authorized community, start/duration, bounded volumes, outcome, retry and recommendation. Capture client/API/db/job layers separately. No raw query parameters, tokens, resident values or salary details in generic telemetry. Query identifiers map to restricted normalized templates.

Display p50/mean/p95 with sample window/count; page/API timings, query plans, queue age/size, retry/failure history, refresh status, cache outcomes, capacity and growth. Missing observations display “Not measured,” never zero or Healthy. Healthy/Watch/Critical apply only to available signals under documented budgets. Data freshness is a separate source/effective/calculated/refreshed timeline. No Power BI model currently means “Not configured.”

Cancel control uses eligible-job capabilities from the server, not merely hidden buttons. Never expose arbitrary database query cancellation.

## Rollout, approvals and rollback

1. Finish correlated traces for authenticated current/2x/5x/history fixtures; retain cold/warm and unavailable-source baselines. Complete query inventory and role-specific plans.
2. Build additive snapshot/job schema and workers locally with synthetic fixtures; shadow calculations must match existing results. Preserve existing readers/writers.
3. Prepare exact migration SQL, grant/RLS matrix, representative EXPLAIN plans, backfill bounds, failure recovery and rollback for review. **Production schema/data migration, new background publication, permission changes and consumer cutover require the user's requested approval before execution.**
4. Canary one authorized community/period. Compare row-level results, hashes, missing/zero, exclusions, period denominators, duplicate imports and independent-session persistence.
5. Switch readers with a reversible feature flag only after acceptance. Rollback restores old readers, stops new dispatch and drains/pauses eligible jobs. Do not drop new evidence or attempt destructive down-migrations after writes.
6. Add the new Power BI model and bounded initial backfill; verify report permissions, folding and partition refresh. Capacity changes wait for measured saturation.

Retention periods require owner/legal approval. No deletion or compaction of operational/audit/raw evidence is included in this audit.

## Acceptance and remaining evidence

Targets retained from user: pages <2 s; dashboards <3 s; searches <1 s; save/approve <1.5 s; reports <5 s; immediate upload acknowledgement <2 s with separately measured durable receipt; ordinary navigation no unexpected >200 ms main-thread tasks; normal idle memory <350 MB; repeated navigation/import cleanup without sustained growth.

Test current, 2x, 5x and long-history volumes across administrator/regional/community/central-services roles; negative HR/salary access; concurrent users/imports; failed sources/jobs; retries/cancel; all report/import types; Power BI refresh and scheduled delivery. Report state/file size, browser/version, network, cache condition, samples, p95, heap/process memory and render counts. Synthetic tests alone cannot close #12.

Previous integrity suite: repair 47/49 files passed; untouched base 41/43 with the same two fixture failures. Resolve those failures before a clean release claim. New Central API instrumentation tests verify privacy and preserve results/errors; asset and diagnostics tests pass. Fresh full fixture-enabled run after instrumentation: 48/50 test files passed, with the same two failures. No fresh authenticated production acceptance occurred in this audit.

Missing: production browser traces/GC memory; API transfer bytes and p95; per-role query plans; exact portfolio/record cardinalities; source system latency; storage/pool/CPU time series; queue/BI metrics (systems not built); complete policy/function/grant review; approved retention and future-history horizon.

Chrome DevTools MCP tools are unavailable. The web-perf skill explicitly says “If unavailable, STOP—the chrome-devtools MCP server isn't configured.” Its trace workflow was stopped; repository and live database audit continued. To enable that workflow, configure chrome-devtools MCP with command npx -y chrome-devtools-mcp@latest. This does not establish production acceptance.


Advisor references: [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [RLS init plans](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [permissive policies](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies), [production configuration](https://supabase.com/docs/guides/deployment/going-into-prod). Advisor findings require workload and permission validation before changes.
