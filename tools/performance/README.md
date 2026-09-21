# Issue 12: local performance investigation (not accepted for production)

Base: `632dc546691ef5799349a98121dd256fff814ff0`.

Issue #12 must stay open. This is a partial repair and a local test environment. It does not complete the nine-phase request and must not be deployed as an accepted performance repair.

## Run locally

From the repository root, run `python3 -m http.server 8766 --bind 127.0.0.1`.

- Dashboard: `http://127.0.0.1:8766/docs/portfolio-operations-dashboard/?atlasPerf=1`
- Generated workbook tests: `http://127.0.0.1:8766/tools/performance/workbook-harness.html`

The dashboard retains its real authorization gates. Do not copy production credentials, bypass login, or import operational state to manufacture authenticated test results. The workbook harness generates its own fixtures and has no Central connection or persistence path.

The development performance report appears only on loopback hosts with `atlasPerf=1`. Open the disclosure after startup and refresh it after a tested action. It retains at most 600 scalar events, with cumulative counters; it does not retain application payloads, workbook values, document keys or identities. Browser heap figures do not measure total tab/worker/process memory. Unavailable metrics are absent, not zero. Warm-reload measurements do not establish cold-cache acceptance.

Run tests with Node 22+ and the repository dependencies installed. `workbook-performance.test.cjs` additionally needs `xlsx@0.18.5` or an `ATLAS_XLSX` path to that version. Optional real-workbook parity uses `ATLAS_BOX_SCORE_FIXTURE`. Existing fixture test environment variables remain unchanged.

After changing a versioned asset, run `python3 tools/performance/version-assets.py`. The content-key test verifies references. The HTML ceiling is the supplied 3,387,363-byte baseline, a temporary no-growth check; it is **not** an approved initial-bundle budget.

## Implemented boundaries

- Opt-in startup-stage, individual startup-step, render, navigation, IndexedDB call, application hydration, workbook, memory and long-task diagnostics. Paint events preserve their actual start time.
- Lazy PDF, PPTX, JSZip and Leaflet libraries with shared in-flight loading, a 20-second timeout, retry after failure and feature-local errors. PPTX uses the exact 4.0.1 bytes fetched from the previous unversioned URL; no library upgrade was performed.
- Map and presentation-slide builders moved into dynamically imported modules. Workbook inspection uses a dynamically imported worker session. Compatibility entrypoints remain.
- Worker workbook parsing, stored-cell candidate inspection, 80-row unrelated-sheet previews, complete candidate sheets, per-sheet progress, transferred input buffers, cancellation, worker termination and file-handle cleanup.
- Non-worker fallback retains the existing parser and yields between sheets. **A single large fallback parse can still block; chunked parsing is not complete.** Renewal-specific preview still performs its existing additional main-thread parse.
- Map cleanup before DOM replacement, stale map mount checks, coalesced map scheduling and PDF-document disposal.
- Presence refresh removed from generic renders; explicit navigation and the existing presence timer retain it.
- One normalized shared-roster snapshot within each synchronous staffing pass, discarded at its end.
- Archive reads run with bounded concurrency (default 3, maximum 4), preserve part order, verify every part hash/length, settle in-flight reads on failure and release the parts array. Existing publish/readback, archive fingerprint and restore validation protections remain.

## Observations, 2026-09-21

Production Chrome: a separate tab reached the authenticated workspace. Timing inspection timed out while obtaining the frame tree (3 seconds); a subsequent Data Import action timed out before focus emulation completed (10 seconds). These are browser-control failures, not measured application navigation durations. They cannot distinguish application work from automation contention. No valid production heap/trace capture was obtained.

Local Chromium reported Chrome 152.0.0.0 on macOS. Signed-out warm reload showed one initial tab render and a long task of 663 ms in an intermediate instrumented build; staffing synchronization accounted for 453.8 ms. After per-pass roster reuse, a subsequent warm observation measured 405.9 ms for that step and a 604 ms long task. These individual observations still fail the provisional 200 ms main-thread target; they are not a statistically controlled comparison against the original head. The signed-out local route retained locked sensitive tabs.

The generated browser fixture was 4,822,131 bytes: an unrelated sheet with 50,001 rows including the header, plus a 220-row multi-section candidate with a late section. Five worker sessions passed, including all-section retention, bounded unrelated preview, pre-start cancellation and in-flight cancellation. Observed durations were 260.3, 270.8, 268.7, 266.1 and 318.6 ms, each including a 100 ms cleanup observation delay. Page heap moved from 82,519,979 to 82,672,830 bytes. No forced GC or worker/process memory measurement occurred; **memory acceptance remains untested**.

With original workbook fixtures enabled: 47/49 test files passed in the repair tree. The untouched base passed 41/43; the same two fixture-enabled assertions failed in both trees (`application-propagation.test.cjs:52` and `property-intelligence.test.cjs:30`). Do not suppress these failures or call the integrity suite fully green. Budget-workbook, collections, source-reconciliation, archive, restore/readback, occupancy, authorization and publication/database tests passed. Six new test files passed. The worker parity test also matched original conversion output on a retained real Box Score workbook.

## Remaining work and closure gates

| Request area | Remaining work |
| --- | --- |
| Baseline/telemetry | Authenticated cold/warm small/typical/largest states, slow network, unavailable source, query/row/byte telemetry, archive decompression and process memory; controlled before/after traces |
| Monolith | Most inline code remains; Data Import UI, reporting, migration/replay administration and financial feature extraction are unfinished |
| Dependencies | XLSX and packet scripts still load with the shell; audit synchronous date/helper consumers before deferring XLSX |
| Cached first render | Existing authorization/scope hydration gate remains; design and validate safe cached rendering before changing it |
| Render scheduling | Shared scheduler remains; complete all-callback audit, scoped updates, stale-request protection and navigation/community/month render-budget tests |
| Import | Move remaining report-specific work off the main thread, implement a bounded fallback, test renewal and large real workbooks in the full authenticated import UI |
| Archives | Complete manifest-only startup audit, verified immutable-part caching, decompression telemetry, explicit restore/multipart memory acceptance |
| Storage/queries | Complete query inventory and key/range review; remove whole-state comparisons and duplicate reads only with integrity verification |
| Memory | Full lifecycle review, real total-memory/GC traces and repeated full UI navigation/import testing |
| Rollout | Resolve fixture failures; obtain independent authorized-session verification; pass all required tests before normal deployment and authenticated remeasurement |

No production deployment or issue closure is authorized by these local results alone.
