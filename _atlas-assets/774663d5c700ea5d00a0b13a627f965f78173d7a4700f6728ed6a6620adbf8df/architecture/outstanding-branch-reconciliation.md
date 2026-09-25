# Outstanding branch reconciliation — September 22, 2026 UTC

The occupancy/financial contract branch (PR #11, through b436c58) is reconciled with the deployed canonical-finance repair rather than applied over it unchanged.

- Stabilization now requires a reconciled inventory observation and complete, source-dated absorption history, including explicit zero-activity months. Qualified Availability and Property Pulse sections join by community, period, source hash and source date. Unverified history produces no stabilization date. The newer dated opening/closing occupancy and governed forecast model remains in place.
- Occupancy import precedence checks the numerator and inventory denominator together. Existing configured inventory, student basis, percent/count checks and closed-period protections remain in place.
- Local financial imports validate explicit monthly amounts, unique GLs, exact periods and community identity. Browser cache persistence reports its actual completion or failure, and is explicitly not canonical accounting close or central budget approval. Economic occupancy and reporting continue using the canonical closed-package adapter and immutable approved budgets.
- Community values and import lineage commit in one local transaction. This path retains offloaded rollback evidence and committed-occupancy protection; rejected writes do not fall through to separate partial saves. Missing, signed and zero amounts remain distinct.
- Asset versions and deployment checks include the reconciled changes. No additional database migration or production financial-data change is required for this reconciliation.

## Other branches

- `feature/community-command-budget-plans` / 55c43b7: rollback-memory implementation is already present. The complete index patch reverses cleanly against main, and the store implementation matches byte-for-byte. Preserve the current implementation and its later changes.
- `fix/scoped-application-publication` / f84cc67: patch-equivalent change is already in main (`git cherry` marks it applied); subsequent scoped publication and hydration repairs remain authoritative.
- `redesign-v2-merge-1` / f6e5bcc: removes four embedded application source URLs. Superseded by current working application mounts and governed Budget Builder navigation. Reapplying would remove supported application entry points.
- `codex/fix-budget-dashboard-parser` / ca3888d: isolated editor swap-file commit, not deployable source. No shared merge base; do not publish editor recovery data.
- `backup-before-sync` / 8d9cb29, 775d5b6, 65ffa71, cbefd08: old financial import/history/period UI and broad workspace backup. Current Financial Accountability, exact-period imports, retained source history and canonical close/budget workflows supersede these implementations. The backup includes vendored files, OS metadata and unrelated artifacts; it is retained as historical backup, not a production feature branch.
- Remaining remote branch tips are ancestors of main. Historical branches are retained; this reconciliation does not delete them.

## Verification

The broad local run passed 73 of 77 files initially. Its governance formatting assertion and stale application-scope test fixture were repaired and passed individually, yielding 75 passing files. The two remaining tests require external RISE 34 budget and delinquency workbook fixtures unavailable to this run; no passing claim is made for them. Updated canonical reporting, occupancy history/import, browser financial transaction, rollback retention/protection, source reconciliation, navigation governance and content-version checks pass. Database finance acceptance passed in the broad run.

The authenticated Doro preview retains August NOI variance and marks stabilization unverified where source history is incomplete. No source upload, occupancy replay, replacement close, budget reapproval, or bonus payment was fabricated for this release. The broader production acceptance limitations in the canonical finance record still apply.
