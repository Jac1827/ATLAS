# ATLAS DevTools repair checkpoint — 2026-09-21

Issue #12 remains open. This checkpoint fixes measured staffing work and test-fixture problems; it does not complete the broader platform migration or authenticated production acceptance.

Chrome DevTools MCP 1.9.0 is installed and registered in Codex. Its official CLI is running in an isolated Chrome profile with usage statistics and CrUX URL reporting disabled. Browser tools in the current task were used through that CLI; newly registered MCP tools may require a client reload to appear in the app. No existing user Chrome profile was reused.

## Changes

- Skip turnover community resolution for rows with no eligible turnover event.
- Compute each community staffing model once per synchronization pass.
- Rebuild complete community records, profiles and bonus roles only when staffing fields change. Existing publication, persistence and integrity paths remain.
- Add a regression test for 1,000 active assignments, alias mapping, duplicate turnover evidence, community scoping and reporting year.
- Add a reproducible real-browser before/after benchmark that restores synthetic in-memory state and refuses authenticated or roster-populated test profiles.
- Correct fixture test setup without changing production calculations: use the real percent parser, provide the fixture's configured 320-unit inventory, distinguish missing cancellation totals from an explicitly supplied zero, and use the September 17 Baymeadows fixture for its dated expected values.

## Browser measurements

Local isolated HeadlessChrome/153.0.0.0 on macOS; no CPU or network throttling. Six samples per scenario, alternating original/repaired order, full JSON output parity checked. Baseline functions come from commit d06d902. These tests exercise real application functions using synthetic data; they are not authenticated portfolio acceptance.

| Synthetic state | Scenario | Original median | Repaired median |
|---|---|---:|---:|
| 28 communities, 150 employees | Changed staffing | 54.35 ms | 9.60 ms |
| 28 communities, 150 employees | Unchanged staffing | 52.10 ms | 7.45 ms |
| 28 communities, 150 employees | Termination history | 52.95 ms | 13.80 ms |
| 28 communities, 750 employees | Changed staffing | 255.40 ms | 14.90 ms |
| 28 communities, 750 employees | Unchanged staffing | 255.05 ms | 12.60 ms |
| 28 communities, 750 employees | Termination history | 255.15 ms | 19.70 ms |

The larger test is five times the employee fixture size, not a five-times-complete-portfolio test.

Signed-out reload traces: initial LCP 405 ms, final idle LCP 438 ms, CLS 0.01 in both. An intermediate trace during concurrent test activity had LCP 973 ms and is retained separately. No overall page-load speedup is claimed from these traces. Empty signed-out state does not exercise the previously reported authenticated large-state failure.

Ten generated workbook previews (two sets of five) passed candidate-sheet, bounded unrelated-sheet, late-section and cancellation checks. The fixture is 4,822,131 bytes.

Renderer heap snapshot node self sizes:
- Before previews: 7,584,439 bytes
- After five: 8,006,462 bytes
- After ten: 8,041,326 bytes

No generated “Expense N” row strings were retained in these renderer snapshots. This is evidence of bounded cleanup in the local harness, not proof of total browser/worker/process memory, authenticated navigation memory, or a portfolio-wide absence of leaks.

## Validation

51/51 test files passed with retained workbook fixtures, including existing publication/database, RLS, occupancy, archive and report tests. New startup/staffing tests pass. No production calculation was changed to satisfy a test.

Fixture selection:
- ATLAS_BOX_FIXTURE: 02 - RISE - Box Score (8).xlsx (Sereno fixture)
- ATLAS_PROPERTY_INTELLIGENCE_BOX_FIXTURE: 02 - RISE - Box Score (10).xlsx (Baymeadows fixture)
- ATLAS_RESIDENT_FIXTURE: RISE - Resident Data (5).xlsx
- Other budget, delinquency and worker parity fixtures remain as documented in the existing local environment.

The former Baymeadows test failure used the September 16 workbook's 50 leads/9 applications against September 17 expectations of 51/10. The retained expected values are unchanged; a separate fixture environment variable prevents the two report tests from sharing the wrong dated workbook.

## Reproduce staffing comparison

With a signed-out, empty local dashboard already open in Chrome DevTools CLI:

```
python3 tools/performance/compare-staffing.py --devtools /path/to/chrome-devtools.js --node /path/to/node --page PAGE_ID --employees 750 --output comparison.json
```

This tool reads original functions from Git, compares complete output and restores the prior in-memory references in finally. It neither authenticates nor persists synthetic data.

## Remaining work

The snapshot/dependency registry, durable server import jobs, first Power BI semantic model, administrative Performance Control Center, comprehensive module extraction, safe cached-first startup, query redesign and full-scale acceptance are still unfinished. The audit/design document describes those contracts; they have not been deployed or represented as implemented here.

Production schema, operational data and authorization were not changed. No merge to main or production rollout occurred. Authenticated cold/warm small/large-state navigation, import/restore, role-specific access, independent-session persistence, total-memory tests and real-world capacity acceptance remain required before issue closure.


## Follow-up: eliminate full-record normalization for unchanged staffing

The staffing comparison now normalizes only the three staffing fields. It does not normalize community history, renewals, reports, profiles or bonus calculations when staffing is unchanged. Full normalization and the original rebuild path remain for changed records. Development-only diagnostics count inspected/changed communities, narrow/full normalizations, narrow serializations, persistence calls scheduled, render requests and longest community subtask. These are boundary counters, not claims about completed asynchronous storage writes or deep-clone allocations. IndexedDB completion durations remain in the separate storage diagnostics.

A new Chrome comparison at 28 communities / 750 synthetic employees retained full output parity: changed staffing median 258.65 ms → 16.10 ms; unchanged 262.10 ms → 10.55 ms; termination history 260.25 ms → 20.25 ms. All 51 test files passed again. The raw results are retained as ATLAS-staffing-narrow-comparison-750.json.

The original 604 ms task / 406 ms staffing segment has not yet been remeasured with identical authenticated state. No authenticated performance acceptance is inferred from this synthetic comparison. Cached-first rendering and deferred reconciliation remain pending; the access-profile and hydration mutation boundaries must be resolved first.
