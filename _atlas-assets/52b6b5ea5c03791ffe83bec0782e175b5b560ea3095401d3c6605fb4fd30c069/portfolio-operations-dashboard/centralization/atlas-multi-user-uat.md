# ATLAS Multi-User Live UAT Runbook

Date baseline: Monday, August 24, 2026

## Purpose

Use this runbook to validate that ATLAS can safely support multiple live users with:

- authenticated access
- live session visibility
- conflict-safe central saves and pulls
- canonical table promotion controls
- rollback protection before any browser state is replaced

This is not a generic smoke test. It is a live-use acceptance pass for the hosted central workflow.

## Current Blockers Before UAT

Resolve these first:

1. Deploy the latest local dashboard build.
   The public screenshot still shows old behavior:
   - `Open LSU - Evangeline` on a portfolio screen
   - `1458 occupied of 6027 total units`
   These indicate the live site is still behind the local fixes in [`/Users/jacheflin/Documents/Playground/docs/portfolio-operations-dashboard/index.html`](/Users/jacheflin/Documents/Playground/docs/portfolio-operations-dashboard/index.html).

2. Apply the central schema update that fixes live session ambiguity.
   The local schema file is modified in [`/Users/jacheflin/Documents/Playground/docs/portfolio-operations-dashboard/centralization/atlas-central-schema.sql`](/Users/jacheflin/Documents/Playground/docs/portfolio-operations-dashboard/centralization/atlas-central-schema.sql).
   Multi-user live presence is not trustworthy until that migration is applied.

3. Complete the central safety gate in the browser used for admin testing.
   The screenshot still shows:
   - Snapshot upload pending
   - Reconciliation review pending
   - Rollback tested 8/21/2026, 7:36:52 AM
   `Save Current State To Central` should not be used for shared testing until all three safety items are complete again on the active browser.

## Required Test Accounts

Prepare at least three approved users:

1. `admin`
   Full access. Owns setup, snapshot upload, reconciliation review, rollback testing, and canonical apply actions.

2. `regional` or `executive`
   Shared read access plus normal workflow access to verify non-admin live behavior.

3. `viewer` or limited-role user
   Confirms read-only and denied-write paths.

Use separate browsers or browser profiles. Do not use multiple tabs in one profile as a substitute for separate users.

## Test Environment Rules

1. Use the same deployed ATLAS URL for every tester.
2. Start with one clean admin browser and two clean non-admin browsers.
3. Clear stale local state only if you intentionally want a first-load test.
4. Keep the browser console open for every tester.
5. Record exact timestamps for any failed save, pull, or presence event.

## UAT Sequence

### Phase 1: Hosted Config And Auth

Admin browser:

1. Open Data Import > Central Platform Control.
2. Confirm `centralized` and `signed in`.
3. Click `Check Central`.
4. Confirm no auth or config errors appear.
5. If this is a fresh environment, use `Activate First Admin`.

Second-user browser:

1. Sign in with an approved non-admin account.
2. Confirm sign-in succeeds.
3. Confirm Central Platform Control is visible only as expected for that role.

Pass criteria:

- Approved users can sign in.
- Anonymous or signed-out browsers cannot read central data.
- No browser console errors during sign-in or connection verification.

### Phase 2: Safety Gate Completion

Admin browser:

1. Click `Upload Read-Only Snapshot`.
2. Review the returned snapshot hash and counts.
3. Click `Mark Reconciliation Reviewed`.
4. Click `Test Rollback Snapshot`.
5. Confirm a rollback JSON downloads successfully.
6. Confirm autosave can now be enabled.

Pass criteria:

- All three safety items show completed timestamps.
- No mapped rows are promoted by the snapshot upload itself.
- Rollback file is present and readable.

### Phase 3: Live Presence

All browsers:

1. Open different tabs or modules in each session.
2. Keep all sessions active for at least three minutes.
3. Verify the live-users header badge updates.
4. Verify user names, pages, and recency update without surfacing `Live users unavailable`.

Pass criteria:

- Each active user appears in live presence.
- No `session_id` ambiguity error appears.
- Presence clears after inactivity or sign-out.

### Phase 4: Read/Write Concurrency

Use two browsers with edit rights.

Scenario A: non-overlapping edits

1. User A changes a safe test field in one community.
2. Save locally, then save to central.
3. User B pulls central state.
4. Confirm User B receives the new value after pull/reload.

Scenario B: stale central version protection

1. User A and User B start from the same central version.
2. User A saves to central first.
3. Without pulling, User B attempts `Save Current State To Central`.
4. Confirm ATLAS blocks the save with a version-change warning.

Pass criteria:

- Non-overlapping changes round-trip cleanly.
- Stale writers are blocked instead of overwriting newer central state.
- Pull always downloads a rollback snapshot before replacing browser state.

### Phase 5: Role Boundaries

Viewer or limited-role browser:

1. Attempt to access shared data.
2. Attempt central save actions.
3. Attempt canonical apply actions such as `Apply People`.

Pass criteria:

- Reads and writes obey role expectations.
- Restricted users cannot perform admin-only promotions or central saves.
- Denied actions fail safely and clearly.

### Phase 6: Canonical Table Promotion

Admin browser only:

1. Run `Dry Run People`.
2. Review counts and output.
3. Run `Apply People`.
4. Refresh Central People.
5. Repeat for Marketing Metrics and MSOE/SOE.

Pass criteria:

- Dry runs complete without mutating data.
- Apply actions succeed only when signed in.
- Post-apply counts match reconciliation expectations.

### Phase 7: Recovery And Rollback

Admin browser:

1. Export a fresh snapshot JSON.
2. Pull central state.
3. Simulate a bad local outcome by restoring from the downloaded rollback JSON using browser migration tooling.
4. Confirm the browser can return to its pre-pull state.

Pass criteria:

- Rollback artifacts are usable.
- Recovery does not require manual database edits.
- No central rows are deleted during rollback validation.

## High-Priority Watch Items

Pay extra attention to these because they were previously observed defects:

- first-paint hydration flip on fresh loads
- live-users badge failure
- portfolio-scope stale community action button
- comparable-units versus total-units occupancy wording
- misleading healthy guidance for no-data communities

## Exit Criteria

ATLAS is ready for live multi-user use only when all of the following are true:

1. Latest local fixes are deployed.
2. Central schema migration is applied.
3. Safety gate is complete on the admin browser.
4. Live presence works with at least two signed-in users.
5. Stale central saves are blocked.
6. Pull-to-browser works with rollback protection.
7. Role restrictions behave correctly.
8. Canonical dry-run and apply flows complete without unexplained errors.

## Recommended Execution Order

1. Deploy latest ATLAS build.
2. Apply schema migration.
3. Re-run admin setup and safety gate.
4. Run two-user presence and save/pull tests.
5. Run role-boundary checks.
6. Run canonical table promotion dry runs.
7. Run rollback validation.
