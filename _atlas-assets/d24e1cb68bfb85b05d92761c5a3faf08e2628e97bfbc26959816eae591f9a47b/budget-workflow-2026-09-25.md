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
- Required written explanation: unfavorable YTD variance greater than $500 **and** greater than 5%, preserving the original specification pending clarification of the later wording.
- Exactly $500 or exactly 5% does not satisfy the corresponding strict test.
- Zero/blank budget with expense: Unbudgeted Expense; percentage unavailable; concern above $500. It is not blocked solely because a percentage is unavailable.
- Payroll, taxes and insurance: visible system verification note, no user explanation required.
- Property recommendation: total YTD expense overrun strictly greater than 35%; advisory.

The owner's clarification uses both “$500 or more” and “over $500.” A follow-up asks whether exactly $500 should flag an unbudgeted expense and whether “or” changes blocking explanations or only concern flags. Until answered, the strict boundary above is explicit. No unapproved category offset/reclassification formula is invented. The evidence records category policy as not configured; operational confirmation is required before asserting complete category-policy acceptance.

Corrected packages preserve prior closes and publish through the existing governed close mechanism. Reopening creates an audited period event and displays the required warning; the previous approved close remains live until reconciliation, approval and republication complete.

## Contracts and reports

Recommendations preserve source, calculation, proposed value, final value and decision history. Active complete contract months use approved terms and dates. Partial months require an explicit proration decision. Post-contract estimates require a property/location-specific inflation assumption with source, owner and effective date and are labelled Out of Contract - Estimated. Conflicting approved contract sources require an authorized controlling-source decision; stale canonical contract evidence is rejected.

The existing approved report design and saved-report library were reused from repository history (including `44dc73f` and subsequent immutable-report repairs). The RISE logo and established colors are embedded locally. Screen, PDF attachment and Excel financial tables use the same immutable report snapshot. Investor status/date, source lineage, cutoff, assumptions and contract coverage accompany the financial detail. Generated exports are read back before their delivery receipt is marked verified.

## Deployment sequence

Apply all three versioned migrations in order, after the repository's existing migrations:

1. `20260925161938_governed_month_end_operational_review.sql`
2. `20260925162050_budget_governed_draft_investor_lifecycle.sql`
3. `20260925162055_governed_community_budget_calendar.sql`

The first two define functions that call the calendar helper at runtime; all three must be installed before enabling the new client. Deploy the versioned client only after the migration set succeeds. The combined PGlite fixture exercises this timestamp order. The lifecycle centralization mirror is documentation/install parity, not an additional migration to apply.

Do not roll back by deleting audit/publication/history rows. If the client must be rolled back, retain the new database guards: legacy direct approval is intentionally denied. Review compatibility before reopening legacy approval paths.

## Production acceptance still required

- Confirm the migration result against the existing community IDs, Ruston alias and verified financial classification without creating duplicate communities.
- Resume the real Doro retained source, review its mappings/findings, save and reload in two authorized accounts.
- Exercise the actual August Doro and Preserve packages, including their different section layouts and YTD cycles, with verified Accounting timestamps. Synthetic tests do not replace these package checks.
- Confirm Executive scope, reviewer permissions, real fiscal YTD close coverage, canonical GL/category signs, active contract versions and property inflation sources.
- Resolve the threshold/category-policy clarification and any conflicting approved mapping or dataset through an explicit owner decision.
- Verify publication and corrected actual-close identities through every production consumer and both exports, including pending/failure retry visibility.

No production migration or application deployment was performed during implementation. Live database/network advisor validation requires a running Supabase environment; local SQL tests cover authorization, RLS and anonymous denial but do not replace post-deployment advisors.
