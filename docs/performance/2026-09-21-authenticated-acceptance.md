# Authenticated production acceptance — still failing

Chrome 153 on macOS, existing authorized admin session, September 21, 2026. Live main at `c512a752` includes fiscal YTD/report enhancements and the import health optimization. Pages, Worker and integrity workflows succeeded. Deployment is not acceptance.

## Measured bottleneck and isolated repair

The production import record contains 26 batch rollback snapshots, each retaining prior community/application state. A private heap snapshot attributed 443,383,048 bytes to strings. A lightweight production reload measured 5,892.4 ms to usable workspace, a 3,808 ms main-thread task and 639,700,514 bytes of observed heap.

The branch repair reads that canonical record in a short-lived worker, returning active data and batch summaries to the page. The original complete record remains unchanged on disk. A summary write restores each referenced backup from the stored record in the same read/write transaction. Missing, duplicate or changed backup references fail closed. Explicit rollback fetches one snapshot. Export/migration paths continue to read the complete canonical record. There is no destructive migration or deletion of backup evidence.

A temporary injection of these exact functions into the authorized page measured 4,790.1 ms to workspace and 130,195,215 bytes of observed heap, with 26 references and zero inline snapshots in active history. This is an experiment, not evidence that the deployed build passes. Reading the legacy full record still takes about 3.3 seconds in the worker, and its transient peak allocation is not yet bounded independently of record size.

Ten navigation loops (Home, Community Command, Reports, Data Import) completed. Median durations: 607.6, 66.2, 333.95, 116.0 ms respectively. Home fails the 500 ms target. Heap before/after was 94,427,240 / 118,095,679 bytes; intermediate samples fell repeatedly rather than growing monotonically. These samples alone are not forced-GC leak acceptance.

61 root test files passed. The isolated real-browser worker harness additionally verified active projection, exact backup readback, summary persistence, changed-evidence rejection and atomic transaction rollback. Initial HTML remains below the original 3,387,363-byte ceiling.

## Other acceptance evidence

- 131 downloaded real workbooks passed read-only worker previews. This does not assert operational publication acceptance for every report type.
- Remote multipart archive: 102 parts, 39,781,393 compressed bytes. No missing parts, invalid part hashes or invalid lengths; full reconstructed archive hash matches. Browser restore, committed readback and bounded peak memory remain pending.
- Fiscal YTD now carries exact cross-year months and per-GL source evidence, reconciled server-side. Report snapshots include prior-report comparison, reviewed causes/risks and expected resolution. Approved production financial publications are still absent, so production financial reconciliation is not claimed.
- One clearly labeled closed acceptance plan and immutable report were created through the authenticated application API, with no operational tasks or fabricated actuals. The authorized email test returned an uncertain outcome and remains blocked from automatic resend. Recipient mailbox search did not find the message at the time of testing.

## Release gate and rollback

Do not close #12. The new history-worker repair remains on the feature branch pending remaining acceptance. Warm startup, Home navigation and startup long tasks still exceed budgets. Cached-first authorization, complete feature separation, bounded multipart restore, independent authorized-session checks and email outcome verification are unfinished.

Rollback of the history-worker UI needs no database conversion: the complete existing record is preserved in its original format, and no reference-only record is written to canonical storage. Restore the prior application assets if needed; do not delete backups or immutable report history.
