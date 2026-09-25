# Governed Budget Builder rollout — 25 September 2026

This change adds Working Drafts, Ready for Review and Approval, Approved History, and a separate Status/Reconciliation view. Upload and submission do not publish financial values. An Executive is the VP approval authority, as explicitly confirmed by the owner on 25 September 2026. Admin alone is not financial publication authority.

## Financial lifecycle

Imported workbook evidence remains immutable while derived draft values are editable. Multiple drafts may coexist for a community and fiscal year. Autosave uses the existing durable request/recovery mechanism and server revision checks. A submitted revision is immutable; withdrawal, rejection and reopening create new revisions. Delete is a confirmed, audited tombstone.

VP approval publishes the exact approved financial snapshot and moves the workflow to Pending Investor Approval. The newest VP publication is the effective baseline even if the prior version was Investor Approved. A later edit never mutates the live snapshot. A non-Admin/non-VP edit of a pending version returns it to review. Investor approval requires the entered approval date and records the actor, role, time and final version. Later changes require reopening with a reason.

Initial budgets without an existing original budget use an explicit initial-workbook source. VP publication creates the canonical original-budget records from reviewed derived amounts, with immutable workbook evidence retained separately. Direct legacy original-budget approval is disabled to prevent bypassing the new lifecycle.

Canonical readers identify publication, revision and content fingerprint. The delivery ledger records canonical baseline/report verification immediately and client consumer acknowledgements when dashboard, finance, recommendations and export consumers actually read or generate that version. Unobserved consumers stay pending. Retry does not fabricate a successful downstream read.

## Identity, calendar and recovered source

Community Settings control the calendar: Multifamily is January–December; Student Housing is August–July, including school-year and summer-turn metadata. The new calendar migration records the owner's supplied Doro/Preserve classifications against existing canonical communities; it never creates a replacement community or financial amounts. Ruston is an approved alias for The Preserve at Tech. Ambiguous names, conflicting approved mappings and unknown calendars require explicit resolution.

Read-only production inspection found one retained Doro workbook upload with no linked forecast head or import receipt. Its local original file has the same SHA-256 as the retained source. The new Working Drafts list includes these source-backed, unlinked uploads and offers Resume. It does not manufacture a previously approved forecast or silently approve its mappings. The source is `Conventional only_ Doro Reforecast 09.2026.xlsx`; “Conventional” does not determine community type or calendar. Parsing recovered six sheets and 48 retained integrity findings. Those findings and source mappings require review when resuming the real workbook.

## Month-end controls

An upload is not an Accounting close. The reviewer must record verified Accounting close and source-generation times before the reconciled package can appear as eligible for review. The server compares normalized expense actuals with the latest VP baseline over the verified fiscal YTD, preserving missing/blank values. Source-statement budget and forecast columns remain comparison evidence.

The implemented thresholds distinguish a concern from an approval blocker:

- Budgeted expense concern: unfavorable YTD variance greater than $500 **or** greater than 5%.
- Required written explanation: unfavorable YTD variance greater than $500 **and** greater than 5%.
- For budgeted expenses, exactly $500 or exactly 5% does not satisfy the corresponding strict test.
- Zero/blank budget with expense: Unbudgeted Expense; percentage unavailable; concern at $500 or more, including exactly $500. It is not blocked solely because a percentage is unavailable.
- Payroll, taxes and insurance: visible system verification note, no user explanation required.
- Property recommendation: total YTD expense overrun strictly greater than 35%; advisory.

The owner explicitly confirmed all three threshold rules: budgeted concerns use OR, blocking explanations require BOTH thresholds to be exceeded, and unbudgeted concerns include exactly $500. No threshold question remains open. The owner also confirmed that an unbudgeted expense concern remains visible regardless of savings elsewhere in its mapped category. No category offset or reclassification exception clears it by default. Reclassification review remains advisory; no financial-policy question remains open.

Corrected packages preserve prior closes and publish through the existing governed close mechanism. Reopening creates an audited period event and displays the required warning; the previous approved close remains live until reconciliation, approval and republication complete.

## Contracts and reports

Recommendations preserve source, calculation, proposed value, final value and decision history. Active complete contract months use approved terms and dates. Partial months require an explicit proration decision. Post-contract estimates require a property/location-specific inflation assumption with source, owner and effective date and are labelled Out of Contract - Estimated. Conflicting approved contract sources require an authorized controlling-source decision; stale canonical contract evidence is rejected.

The existing approved report design and saved-report library were reused from repository history (including `44dc73f` and subsequent immutable-report repairs). The RISE logo and established colors are embedded locally. Screen, PDF attachment and Excel financial tables use the same immutable report snapshot. Investor status/date, source lineage, cutoff, assumptions and contract coverage accompany the financial detail. Generated exports are read back before their delivery receipt is marked verified.

## Deployment sequence

For an existing live database, apply the four versioned migrations in this order after the repository's existing migrations:

1. `20260925162055_governed_community_budget_calendar.sql`
2. `20260925161938_governed_month_end_operational_review.sql`
3. `20260925162050_budget_governed_draft_investor_lifecycle.sql`
4. `20260925174317_shared_str_programme_draft_versions.sql`

Calendar-first deployment installs the verified-settings helper before new publication and operational-review functions can be called. It depends only on existing community, alias, authorization and immutability objects. Record all four original versions in migration history; do not mark an unapplied version complete. For a fresh database that is not yet serving clients, the chronological migration order remains supported. The combined PGlite test loads the complete intervening workbook/reforecast migration chain and verifies both sequences, direct-calculator compatibility, and saved-STR wrapper preservation.

Before the lifecycle migration, run the read-only query in `tools/budget-migration-preflight.sql`; every row must return `ready = true`. The preflight resolves the actual core calculator behind the existing saved-STR wrapper. The migration verifies the wrapper forwarding call, preserves its source-receipt/precision behavior, and requires every core function-rewrite anchor; it aborts its transaction if an installed prerequisite differs. Missing early authority and late report-evidence anchors are tested, including rollback of authorization changes and preservation of prior history. Review the differing definition before retrying; do not weaken the guards or silently mark the migration applied.

Compare immutable financial counts/fingerprints before and after installation, verify calendar/alias identity, RLS and function grants, then deploy the versioned client. Older open clients cannot supply the new month-end evidence; legacy direct original-budget approval and non-VP publication fail closed. Ask users to reload for the new states and controls. Do not re-enable legacy approval paths. The lifecycle centralization mirror is documentation/install parity, not an additional migration to apply.

Do not roll back by deleting audit/publication/history rows. If the client must be rolled back, retain the new database guards: legacy direct approval is intentionally denied. Review compatibility before reopening legacy approval paths.

## Production acceptance still required

- Confirm the migration result against the existing community IDs, Ruston alias and verified financial classification without creating duplicate communities.
- Resume the real Doro retained source, review its mappings/findings, save and reload in two authorized accounts.
- Exercise the actual August Doro and Preserve packages, including their different section layouts and YTD cycles, with verified Accounting timestamps. Synthetic tests do not replace these package checks.
- Confirm Executive scope, reviewer permissions, real fiscal YTD close coverage, canonical GL/category signs, active contract versions and property inflation sources.
- Resolve any conflicting approved mapping or dataset through an explicit authorized decision; the confirmed category policy must keep unbudgeted concerns visible despite category savings.
- Verify publication and corrected actual-close identities through every production consumer and both exports, including pending/failure retry visibility.

Record deployment and production validation evidence separately; synthetic checks do not replace live acceptance. Live database/network advisor validation requires a running Supabase environment; local SQL tests cover authorization, RLS and anonymous denial but do not replace post-deployment advisors.

## Saved STR programmes and recovery

Budget Plan → STR Builder now has **Save programme**, **Saved STR programmes**, **Print saved report**, and an explicit **Recalculate drivers as new revision** action. The Saved STR programmes list is also available directly under Budget Plan. Save records the canonical community, exact programme configuration, original grouped allocations, retained GL/month values, source context and an immutable draft report. It requires no existing approved budget and never publishes a baseline. Existing programmes with incomplete configuration remain saveable; their reports identify unavailable source coverage instead of inventing driver values.

The user’s retained browser source contains three distinct programmes. Recovery keeps all three identities. The applied programme’s 31 stored lines are preserved exactly; the current driver preview’s different line count is not substituted. Opening or saving a retained programme does not recalculate it. Driver edits are saved as proposed assumptions alongside the applied source assumptions; screen, printable view, PDF and Excel disclose when those edits have not recalculated the retained values. Recalculation is an explicit new revision. Apply waits for verified persistence, checks the exact source budget and editing context, and applies only that saved snapshot to an editable browser working budget. It does not approve or publish a shared budget.

To recover after a browser refresh where local storage is unavailable:

1. Open Budget Plan → Saved STR programmes → **Recover saved STR file**.
2. Select the preserved `.riseb.json` file and the exact programme. The selector shows every retained programme, property and line count.
3. Choose **Save selected programme to shared drafts**, confirm its canonical community, name and mapping reason, then save. Repeat for other programmes that should be shared. Recovery does not replace unrelated browser programmes or drafts.
4. Use **View / print** for the exact saved monthly report. **Print saved report** opens a dedicated printable view; **Download PDF**, **Download Excel**, and **Download source backup** are separate actions. **Version history** prints or downloads an earlier saved revision. A source backup remains available for incomplete programmes.
5. **Resume** edits the selected saved version. Subsequent changes create new shared revisions and autosave. A second authorized session reads the same saved versions. **Recover exact save** resolves a lost response from its persisted request receipt without creating a duplicate programme.

Budget links distinguish a server-verified shared planning reference from a browser working budget. Opening a browser target verifies its saved programme lines, scenario and year; a changed local budget is not silently presented as the saved target. Linking an existing shared budget does not apply or approve financial values. Unresolved source/mapping differences still require the governed Budget Builder review.

Validation includes real SQL/browser save and readback, source retention without recalculation, exact printable/PDF/Excel/source exports, another authorized session and reload, existing local data isolation, account and scenario change guards, partial-source preservation, durable lost-response recovery, and separate applied/proposed assumption evidence. An isolated private-source test round-tripped all three original programmes, including the 31-line programme, without production financial changes. The private source file and screenshots are excluded from the repository.
