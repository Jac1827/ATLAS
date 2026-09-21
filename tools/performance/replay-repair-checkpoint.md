# Occupancy replay and administration loading repair — 2026-09-21

This follow-up is a partial issue #12 repair, not full acceptance.

## Changes

Replay preview reads community and import records by their exact keys, then reads only each eligible approved source file by key. It no longer reads the full browser store or includes unrelated records/blobs in its download. The new `atlas_scoped_occupancy_repair_backup_v1` backup contains both complete records that apply can modify, plus source-file fingerprints. Immutable source files remain in storage. The in-transaction rollback record, source hashes, stale-state comparison, atomic transaction, and committed readback remain intact.

Preview cancellation aborts worksheet processing and discards pending previews after navigation, replacement preview, access loss or page exit. Cancellation never interrupts an atomic commit/readback. A second commit is rejected while one is active. Admin access is checked again before committing.

Supported browsers parse archived workbooks in the existing worker session, preserving source row offsets. The verified ArrayBuffer is transferred without rereading the source. Worker sessions close after each source and on failure/cancellation. The compatibility fallback remains main-thread parsing; this is still an acceptance limitation. Report-specific Box Score conversion still runs on the main thread, and file-plan detection and replay inspection remain separate passes.

Migration and replay administration scripts are now content-versioned feature loads instead of initial-shell scripts. Concurrent loads are deduplicated; feature-load timeout/error isolation remains. Replay load completion cannot open a preview after navigation supersedes it. Migration restore still loads the archive implementation before hydration, hash verification and readback.

## Evidence

52/52 local test files passed with retained fixtures. New tests cover exact-key reads, complete affected-record backups, atomic stale-state rejection, committed readback, permission loss and cancellation with no writes. Worker tests check nonzero worksheet offsets.

Chrome 153 local checks: zero migration/replay startup requests; two simultaneous migration loads produce one request. Transferred-buffer test passed with no duplicate source read, row offset 9 retained and canceled sheet request rejected. Five generated 4,822,131-byte workbook previews passed candidate, late-section, bounded unrelated-sheet and cancellation checks. These tests are synthetic and do not establish authenticated production performance or memory acceptance.

## Remaining gates

Authorized cached-first startup; further Data Import/report/XLSX extraction; renewal worker/fallback processing; complete migration compression/serialization memory bounds and immutable-part caching; full render/query/stale-work audit; authenticated cold/warm large-state navigation/import/restore and independent-session acceptance remain outstanding. Issue #12 must remain open.

Rollback: revert this follow-up commit to the prior live release ecb468a54bced39be1d00ae1a8fd67747c0d5dad. No operational data or production database schema was migrated by the code rollout.
