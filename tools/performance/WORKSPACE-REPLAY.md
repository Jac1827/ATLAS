# Isolated workspace replay

This harness compares frozen ATLAS builds using identical retained operating data. It is a local replay, **not authenticated production acceptance**. It does not contact a real backend. Synthetic credentials exist only in the test browser, REST/Auth reads use a local fixture server, REST/Auth mutations receive 403, and CSP blocks external connections. Unsupported non-REST external service calls receive an empty synthetic 200 response without a network request; their real service behavior and per-call timing are not reproduced. The runner records any unexpected external response as a failure.

Use Node with Playwright and Chromium installed, and Python 3 for the summary. If Playwright is supplied outside the project's dependencies, set `ATLAS_PLAYWRIGHT` to its module directory. Run from the repository root.

1. Make immutable copies of each build's `docs/portfolio-operations-dashboard` directory. Use the actual historical and baseline commits shown in the example. Copy the repaired assets only after versioning is complete; do not modify any copy during measurement.
2. Prepare a private, ignored fixture directory containing `bundle.json`, `history-record.json`, `startup-projection.json`, `parent.json`, and `projection-summary.json`. These are the independently verified archive, complete history record, and exact derived current projection artifacts. Do not commit private fixture contents. The harness does not retrieve them from production.
3. Copy `workspace-replay.example.json` into ignored output, replace its paths and repaired revision, and run:

```sh
node tools/performance/workspace-replay-benchmark.mjs output/replay-config.json
python3 tools/performance/workspace-replay-summary.py output/workspace-replay/results.json
```

Every asset and input is hashed in `manifest.json`. The results record browser and host versions, source identity, dimensions, CPU/network settings, all raw samples, REST/Auth request statuses/timing, render counts, blocked write paths, errors, post-GC heap/DOM measurements, and output hashes. `results.partial.json` is retained during the run. Summary files retain raw samples plus median and maximum; they do not infer percentiles from five samples.

The normal run takes five cold-asset and five warm-asset samples per build/device. IndexedDB contains identical authorized operating data before timing starts. Thus “cold” means disabled HTTP asset cache, not an empty new user's data cache. Warm uses actual Chromium HTTP caching, with cache-hit counts retained. Startup readiness includes initialization, usable authorized data, and two animation frames, followed by ten seconds of observation. The summary separately calculates blocking time during the first ten seconds of the navigation.

Each group measures the first Home, Reports, Import, Command, and Bonus loop, then ten further loops. Heap growth is measured after forced GC following the first complete feature-loading loop and after the repeated loops. The fixture compares exact monthly normalization, Home history, portfolio aggregates, export rows, and Community Progress data and rendered HTML. The historical 4263a58 build predates the AtlasReskin Home-history API; that optional probe is explicitly unavailable, and Home-history parity compares the baseline with the repaired build. Other diagnostic counters are retained whenever available. Unsupported optional probes do not suppress real parity errors. Completed timing loops are checkpointed before parity probes. It does not claim to exercise every report or the canonical Bonus backend: the Bonus read returns an empty synthetic workspace.

The slow-source variant uses cached assets, 150 ms latency, 200,000 bytes/second download, and 93,750 bytes/second upload. The unavailable-source variant returns 503 while preserving the already verified local cache and valid synthetic profile. Slow-source freshness can remain pending after the ten-second observation; cached usability and completed freshness are different outcomes.

Desktop is 1440×900 at DPR 1. Mobile is 390×844 at DPR 3 with touch and a fourfold CDP page CPU slowdown. CDP does not slow worker threads. Heap figures describe the page, not worker or browser processes. External fonts/maps are unavailable in every build, and historical external XLSX is replaced with the identical pinned local asset. These controlled conditions are not a device-lab or real-network substitute.

The September 2026 canonical fixture used for issue 12 has 28 retained community records and 13 retained batches. It is distinct from the original browser profile's 29-batch state. Never describe this comparison as parity with that profile.

Optional diagnostic flags (`startupProfile`, `profileNavigation`, `profileTab`, `debugCache`, `debugParity`) should remain disabled for acceptance timing. Debug outputs can contain private fixture values and must remain ignored. The normal output contains hashes and aggregate metrics, not source rows, credentials, or employee/unit identities.
