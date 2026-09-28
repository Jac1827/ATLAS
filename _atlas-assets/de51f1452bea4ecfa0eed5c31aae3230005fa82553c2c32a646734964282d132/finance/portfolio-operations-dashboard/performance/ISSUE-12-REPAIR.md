# Issue 12 performance repair — release evidence

Status: production acceptance is pending. GitHub issue #12 must remain open. Deployment success is not performance acceptance.

## Reproducible controls

The signed-in production baseline was captured before implementation on `3d80173de32f227410663662a523932c50ecaa2b`, which had superseded the request's `850295533548d7adb2371d69cd0f30a95ef6753d`. Historical control: `4263a58cca7319d8d69563bc9e91e7bf6e64a3a5`. The baseline initial HTML was 3,384,230 bytes. The candidate separates its roughly 14 KB document, core JavaScript/CSS and lazy workspace modules. This reduces initial HTML parsing and enables immutable asset caching; it does not imply that all cold-start JavaScript bytes disappeared.

Two real signed-in profiles had different retained state. The original browser had 29 import batches and 14 active communities. The independently signed-in tracing profile had no local history and legacy seeded data. The canonical central archive is version 1, effective `2026-09-19T02:36:25.886387+00:00`, SHA-256 `44fff7341af4fe69f97dffe49736f7d6b81c1c465a59ac1477cdc745443d261f`: 13 batches, 21 sources and 28 community records. None of these volumes may be silently substituted for another. Existing browser storage and central source records are retained. No local operational state is automatically published to reconcile this difference.

### Signed-in baseline observations

These are single observations, not five-run statistical results. A loading card's early paint was not treated as a usable workspace.

| Tracing profile | Desktop | Mobile emulation |
| --- | ---: | ---: |
| Cold usable workspace | 32,644 ms | 55,578 ms |
| Warm usable workspace | 46,160 ms | 84,221 ms |
| First Reports navigation | 1,518 ms | 4,925 ms |
| Longest navigation task | 1,552 ms | 4,965 ms |

Desktop: 1440×900, DPR1, unthrottled CPU. Mobile: 390×844, DPR3, 4× CPU slowdown. Network was not artificially throttled for these rows. The original browser's different local state showed 1,229 ms import hydration, six startup Home renders and a 5,810 ms Bonus long task; it is a separate baseline. Complete request/stage/heap records are retained privately under ignored `output/issue12-baseline/` and do not contain credentials or response bodies. The 1.8 ms session probe had a valid token and was not a forced network refresh. An actual refresh-token request was subsequently observed at `2026-09-24T21:23:51.019Z`, taking 7,068.6 ms during the service incident; that is a separate observation, not an uncontended baseline. Trace-file export was unavailable; browser measures and sanitized request records were retained.

## Acceptance budgets

| Metric | Desktop | Mobile emulation |
| --- | ---: | ---: |
| Warm authenticated shell | 300 ms | 600 ms |
| Warm usable workspace | 1,000 ms | 2,000 ms |
| Cold HTTP-cache usable workspace | 3,000 ms | 5,000 ms |
| First lazy navigation | 500 ms | 1,000 ms |
| Repeated navigation | 200 ms | 400 ms |
| Longest main-thread task | 100 ms | 200 ms |
| Startup blocking time, first 10 seconds | 300 ms | 600 ms |
| Steady / peak main-thread heap | 150 / 250 MiB | 150 / 250 MiB |
| Heap growth after 10 equivalent navigation loops | 10 MiB | 10 MiB |
| 4,822,131-byte workbook preview | 1,000 ms | 2,000 ms |
| Workbook cancellation cleanup | 200 ms | 400 ms |

Use five cold/five warm starts and ten navigation loops with identical authorized scope, reporting period, archive/publication references and volume. Record all samples, median and maximum; tiny samples are not reliable percentiles. Also cover slow network, unavailable source, small/large histories, token refresh, actor/scope/access loss, cancellation and two independently authenticated sessions. Read-only local replay of historical builds is labeled replay, not live acceptance. Preserve report/export values, version references, source lineage and zero/null distinctions.

## Controlled three-build comparison

The final identical-data replay is completing against historical `4263a58`, baseline `3d80173` and the tested candidate. Controls use five cold/five true HTTP-warm loads on each device, followed by first navigation and ten repeated loops, slow-source and unavailable-source variants. Cold samples have zero CDP cache hits; warm samples show real asset reuse. The same authorized operating data is preseeded, so cold describes HTTP asset cache, not an empty new user's local database. Final candidate measurements will be appended before acceptance. See [reproduction instructions](../../../tools/performance/WORKSPACE-REPLAY.md).

Operating-data, portfolio-aggregate and export-row probes match between the controls. Community Progress changed before this repair: 72 differing paths reflect reconciled stabilization (41), guest-card trends (8), lead-source/traffic availability and totals (12), and derived alerts/lists (11). No move-in target values differ for this fixture. [Anonymous field differences](evidence/issue-12/historical-report-differences.json) retain paths/types without community names or private values. The candidate must match the current baseline's report values and markup exactly; the historical report is not falsely labeled identical. The historical build also lacks the later Home-history diagnostic API, so that optional probe compares baseline and candidate only.

## Changes and safeguards

- `workspace-core.js`, `atlas-core.css`, `features/*-workspace.js`, `performance/feature-loader.js`: external core and lazy Reports, Data Import, Bonus and administration; spreadsheet/PDF/presentation/map/forecast dependencies load through their feature boundary. Stable mounts are retained only for matching actor, authorization, community, period and module context.
- `features/workspace-bootstrap.mjs`, `workspace-projection-worker.js`, `workspace-integrity-worker.js`, `workspace-canonical.mjs`, `workspace-publication.mjs`: source-bound derived read model, freshly verified access namespace, visible effective/verification timestamps, cached first usable render, independent optional reads after paint, stale-response guards and honest projection-only publication retries. Large projection integrity checks run in an abortable worker. Missing scoped data never falls back to an unfiltered archive; a missing central client in a hosted deployment also fails closed.
- `features/import-history*.mjs`, `occupancy-replay-browser.js`: immutable split evidence, lightweight current views, paged history, hash-verified snapshot references, atomic revision checks and cancellation. Explicit archive/export/rollback actions retain full evidence.
- `features/canonical-finance.mjs`, `financial-close.mjs`, finance migration: request only the selected authorized communities/periods and reuse per-request finance context. Publication reads remain fresh; no source formula or financial actual is changed. Existing measured indexes remain unchanged.
- `centralization/atlas-central-client.js`: bounded/cancellable reads, actor/access guards and concurrent independent access reads. Rendering no longer publishes property graph or workspace changes. Same-actor token rotation does not clear valid caches; actual access changes do. People, goals, notifications, presence, administrator views, financial broadcasts and restore entry points reject old completions after an actor, access, backend, database or session-epoch change. Accepted atomic writes settle in their original context. Marketing metadata reads use verified community relationships and cannot use a matching name to override a conflicting canonical ID.
- `tools/package-atlas-assets.mjs`, `build-atlas-site.mjs`, Worker and deployment workflow: content-addressed complete asset trees, verified append-only retention branch and one artifact for both hosts. Old open pages retain exact dependency URLs. Capacity overflow fails without pruning.

The scoped reader mirrors existing role, community and module authorization. Raw archive RLS is unchanged. Operational data is filtered by field for limited modules; separate-API modules get identity only; self-service Settings can open after access verification when operational data is unavailable.

## Integrity and query evidence

All 102 immutable archive part hashes, the 39,781,393-byte ZIP hash and all 28 member hashes were verified. An isolated local worker restored all 27 retained records, migrated the 399 MB uncompressed archive, exported every collection, reimported into a second isolated database and restored all 13 before-snapshots exactly. Source bytes and snapshot hashes remained unchanged. Migration took 3.55 seconds; compact history was 395,111 bytes; main-page observed heap peak was 1.55 MB (worker memory excluded). Cancellation completed in 11.7 ms without changing the revision. These are local integrity/scaling checks, not production startup claims.

See [finance query plans and parity](FINANCE-REQUEST-PERFORMANCE.md), [scoped reader authorization](SCOPED-WORKSPACE-PROJECTION.md), and [asset retention/rollback design](IMMUTABLE-ASSET-PACKAGING.md). No index or database resource setting was changed based on speculation.

## Production service incident during verification

The 21:00–21:13 UTC diagnostic window on September 24 showed 19 PostgREST PGRST003 internal connection-pool acquisition timeouts. Successful profile/community/document reads averaged approximately 40–50 seconds, with some requests timing out around 126 seconds. Auth health remained responsive. A database snapshot showed no blocked sessions or deadlocks and connections below the configured maximum. Dashboard swap and memory pressure support a contributing resource-pressure hypothesis; they do not establish a precise CPU/root-cause claim. A controlled project-service restart was initiated after publication verification was blocked. No plan, permission or data reset was performed. A small REST read recovered to 0.35 seconds. Metadata readback then confirmed that the uncertain derived write was absent. One guarded retry also timed out, and a second metadata read confirmed absence. The exact 6,999,497-byte projection saves through the same function on the full local schema in 362 ms with current, immutable version and audit rows retained. The live function has no user triggers and uses the existing unique-key index; that write evidence alone does not justify changing its query strategy or indexes. Supabase shows Micro as a free upgrade from Nano at the same $0.01344/hour; the requested compute choice is still pending.

After database deployment, metadata reads recovered to 110.5 ms on average (15 observations, maximum 180 ms), and no blocked or idle-in-transaction sessions remained in the later snapshot. One guarded materialization attempt at 21:55:48 UTC still failed in 10.587 seconds; readback again confirmed no derived document and an unchanged parent. The database cancellation occurred inside the immutable-version insert, after reaching the existing authenticated role's eight-second statement deadline. This is distinct from the earlier pool-acquisition incident. The cutoff covers cumulative work in the transaction, so it does not prove that the insert alone consumed eight seconds or establish whether CPU, compression or I/O caused the overrun. No index, global deadline, or resource setting was changed on that evidence.

A narrowly scoped, administrator-only publisher was subsequently deployed in PR #31. It retains the existing audited writer, locks and validates the exact source parent, permits only the fixed derived key, and gives this transaction an outer 30-second deadline. General authenticated requests remain at eight seconds. A single HTTP attempt started at `22:13:36.896Z` and failed after 59,243 ms; the database logged cancellation at `22:14:27.161Z` during the serialized size check, before the parent lock or any write. HTTP elapsed time does not reveal the effective database deadline or divide queueing, body parsing, execution and response transport. Unrelated reads and finance calls were also slow in the same window. Readback at `22:16:44.314Z` confirmed zero derived current/version/audit records and an unchanged source parent. Further identical retries are withheld pending a meaningful change in service conditions. No compute change has been applied.

## Generated workbook comparison

The same 4,822,131-byte generated workbook was checked five times per build/device. The worker preview preserves 50,001 unrelated source rows while transferring an 80-row sample, and retains all 220 rows of the multi-section report, including its late section. Candidate desktop previews took 143–170 ms; mobile-emulation observations took 245–315 ms. In-flight cancellation completed within 0.1 ms in the candidate, and no main-page long tasks were observed. Both control builds passed identical value checks. These local worker measurements do not include authenticated import publication, production network latency, or worker heap. The historical CDN parser was served with byte-identical pinned content; request routing disabled HTTP cache, and CPU emulation applied to the main target. Reproduce with `tools/performance/workbook-browser-benchmark.mjs`; raw observations remain under ignored `output/issue12-workbook/`.

## Release and rollback gates

The final strict local suite passed all 191 discovered tests in one run, with zero failures, zero skips and an unchanged input fingerprint: `a0355e15b7d88269a166bc9ad4b67b2440e36d5f307f64072d73bc511d78a93e`. This includes the final same-actor scope-change, late-completion and restore guards. Both supplied private budget/delinquency fixtures were exercised. An optional private utility-workbook branch remains unverified when its separate fixture directory is absent. The deployment workflow reruns the complete discovered suite; CI explicitly reports private-fixture skips rather than silently treating them as passes. [Sanitized test results](evidence/issue-12/full-suite.json) contain no private fixture paths or payloads. The recorded Git head is the precommit base; the fingerprint identifies the tested candidate working tree. Published evidence is excluded from the executable-input fingerprint to avoid self-reference. Detailed logs remain private under ignored `output/issue12-repaired/full-suite-5/`.

Authenticated production acceptance, two independent live report/export comparisons, and final before/after production timings remain release requirements. Publish final run results and deployment IDs with issue #12; keep it open until those requirements pass.

Database preparation was merged in [PR #30](https://github.com/Jac1827/ATLAS/pull/30), merge `0c1ac0e584419e721d8ec70f899436738a3d1585`, after all five applicable checks passed. The configured integration automatically applied `20260924203341_finance_request_context.sql` and `20260924205459_scoped_workspace_projection.sql`. Thirteen affected function bodies match the reviewed SQL. Private helper grants remain closed, public readers remain authenticated-only, and the anonymous production RPC probe is denied.

[PR #31](https://github.com/Jac1827/ATLAS/pull/31), merge `9ef02ff08e3c424be52d6bc3d05f90559dbbad37`, automatically deployed `20260924220418_workspace_projection_publisher.sql`. Production history now contains all 77 migrations; the publisher body, invoker security, execution grants and local settings match the reviewed migration. Main's five applicable checks passed; the branch-preview job was correctly skipped. No manual migration raced the integration. See [publisher transaction guarantees](WORKSPACE-PROJECTION-PUBLISHER.md).

The source document remains version 1 with its original hash. Both hosts still serve the prior 3,384,230-byte interface, SHA-256 `c1fde41a7d1cdcdddd71a6e21aff1d8d7ca47b06d7b9bea06a98891ff918525a`. Native Cloudflare Git Builds was disconnected and GitHub Pages was switched to the existing Actions deployment path so the forthcoming packaged release has one publisher. Neither change activated the candidate. Materialize and verify the matching source projection before activating the client; migration or hosting success does not establish performance acceptance.

At `2026-09-24T22:24:35Z`, the Worker was 100% version `dd5ebd5d-24f5-443c-96a1-87c81353ff8d`, deployment `62c33985-66e1-4600-ba1d-e9f7c08a1a69`, from [PR #31's production job](https://github.com/Jac1827/ATLAS/actions/runs/36065959088/job/107855653315). Pages still served [PR #30's deployment](https://github.com/Jac1827/ATLAS/actions/runs/36064320062/job/107850450250); PR #31 did not redeploy Pages after the source-mode switch. Exact HTML equality confirms that the two public interfaces remain aligned despite those different backend-only release heads. The candidate's production publisher is serialized across all branches, including manually dispatched production runs.

Published evidence: [signed-in baseline](evidence/issue-12/signed-in-baseline.json), [generated workbook comparison](evidence/issue-12/workbook-comparison.json), [database and hosting release](evidence/issue-12/backend-release.json), [affected files](evidence/issue-12/affected-files.json), and [full test results](evidence/issue-12/full-suite.json). Baseline request paths omit query values; response bodies, headers, credentials and private source files are excluded. Overlapping startup/navigation observation windows must not be summed.

Exact code rollback reference: `3d80173de32f227410663662a523932c50ecaa2b`. Repackage that source while retaining every tree on `atlas-asset-releases`; do not deploy an empty retention directory. `centralization/finance-request-context.rollback.sql` contains the prior finance reader definitions for a reviewed forward rollback migration. Preserve all archives, derived documents, audit rows and version history. Keep new scoped endpoints available for already-open repaired pages unless a separate security incident requires revocation. A rollback must not modify operational source records.
