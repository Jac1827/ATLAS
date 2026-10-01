# Atlas Centralized Platform Migration Plan

## Current Architecture Determination

Atlas is currently a browser-based static web application, not a secure centralized multi-user platform.

- `index.html` stores main operations data in browser `localStorage` and IndexedDB (`atlas_rise_state_v1`).
- People stores roster/performance data in browser `localStorage` under `rise_performance_platform_github_v1`.
- Maintenance stores data in browser `localStorage` under `rise_wmr_v1` and supports manual JSON file sharing.
- Budget Builder is a standalone browser tool.
- Marketing is partially centralized through Supabase tables, but still contains local/session login remnants and is not yet part of a shared Atlas data model.
- The current main dashboard cloud sync is a whole-browser-bundle sync. It is useful for transition but is not a normalized database, not role-secured per record, and can merge/overwrite fields.
- DLR report generation has browser-side mappings and manual Outlook/`mailto:` drafting. Before the September 1, 2026 automation guardrail work, it did not have persistent reviewed snapshots, server-side weekday scheduling, or provider-backed delivery history.

## Target Architecture

Atlas should become a hosted web application with:

- Hosted application delivery over HTTPS.
- Central Postgres/Supabase-compatible database.
- Authenticated users through the hosted identity provider.
- Role-based access control and row-level security.
- Canonical shared tables for employees, communities, assignments, budgets, actuals, contracts, marketing metrics, maintenance metrics, and bonus calculations.
- Realtime subscriptions for shared records that users are authorized to see.
- Append-only audit logs for every mutation.
- Immutable legacy snapshots before every migration.
- Persistent reviewed DLR snapshots, delivery subscriptions, and delivery history.
- Server-side weekday scheduled jobs for DLR sends.
- Transactional email delivery from the backend only.
- Backup, point-in-time recovery, and export procedures.

## Data Preservation Rules

1. No migration may delete, truncate, or overwrite source records.
2. Every source payload must be stored in `atlas_legacy_snapshots` before mapping.
3. Every mapped row must retain source module, source identifier, source hash, and migration run id.
4. Completed prior periods remain immutable unless an admin creates a correction run.
5. Uncertain matches go to `atlas_mapping_log` with `decision = 'manual_review'`.
6. Conflicting matches go to `atlas_mapping_log` with `decision = 'conflict'`.
7. JSON remains allowed only for migration input, export, backup, or disaster recovery.

## Reconciliation Gates

Each phase must record pre-counts, post-counts, pre-totals, post-totals, exceptions, and reviewer approval.

Required reconciliation categories:

- Community records by source and status.
- Employee records by status, employee number, email, and community assignment.
- Effective-dated assignment counts by community and role.
- Financial actual lines by community, period, and account.
- Budget lines by community, period, and account.
- Contract records by vendor, community, period, and amount.
- Marketing metric rows by community, period, metric key, source, and approval status.
- Maintenance metric rows by week ending, community, and metric key.
- Bonus role slots, eligible employees, source metrics, calculation runs, and payout totals.

## Phase 0: Safety Baseline

Status: started.

Actions:

- Create a read-only file snapshot of the current Atlas project.
- Create checksum manifest.
- Add in-app migration snapshot export for browser `localStorage`, IndexedDB, current shared assignment model, and reconciliation summary.
- Mark local JSON/browser transfer as legacy migration tooling, not collaboration infrastructure.

Rollback:

- Restore files from the read-only project snapshot.
- No data rollback required because this phase adds only code and documentation.

Validation:

- File count and checksums match the manifest.
- Snapshot export downloads without writing to central data.
- App startup has no browser errors.

## Phase 1: Central Schema And Auth

Status: foundation implemented, hosted environment setup required.

Actions:

- Apply `atlas-central-schema.sql` to the hosted database.
- Configure Auth, allowed email domains, MFA policy, and user roles.
- Enable row-level security on every shared table.
- Add service-role access only to backend migration jobs, never browser code.
- Create scheduled backups and document restore test.
- Use `atlas-central-config.example.js` as the browser-safe runtime config template.
- Confirm the public browser anon key can only perform operations allowed by RLS.

Rollback:

- Keep the schema in place but leave production app pointed at legacy read-only storage.
- Drop no tables until all migrated records are verified and approved.

Validation:

- Test login for each role.
- Test read/write deny cases.
- Confirm anonymous users cannot read or mutate data.
- Confirm audit rows are written for every write.

## Phase 2: Read-Only Legacy Import

Actions:

- Export migration snapshots from each current browser/source.
- Load snapshots into `atlas_legacy_snapshots`.
- Dry-run mappings into canonical tables.
- Write all decisions and exceptions to `atlas_mapping_log`.

Rollback:

- Mark migration run as `blocked` or `rolled_back`.
- Leave snapshots unchanged.
- Do not promote mapped rows.

Validation:

- Record counts match source snapshots.
- Financial totals and bonus payout totals match pre-migration snapshots.
- All conflicts are assigned for review.

## Phase 3: People And Assignments Cutover

Status: started.

Actions:

- Promote employees, roles, communities, and effective-dated assignments.
- People becomes the write owner for employee identity/status/title/assignment data.
- Bonus reads assignments from the central database.
- Legacy People local storage remains export-only.
- Use Central Platform Control to sign in, upload read-only snapshots, save the versioned Atlas app document, and block stale central writes.
- Keep central autosave disabled until counts, assignments, budgets, marketing records, maintenance records, and bonus calculations reconcile.

Rollback:

- Switch Bonus assignment reads back to the local shared assignment layer.
- Keep central rows soft-active but do not delete them.
- Pull operations download a local rollback snapshot before changing browser data.
- Mark the matching migration run `rolled_back` or `blocked`; do not delete the central document or legacy snapshots.

Validation:

- Employee count by status matches source.
- Current assignments by community/role match approved crosswalk.
- Past assignment rows remain effective-dated.
- Bonus eligible employee count matches pre-cutover snapshot.
- Central app-document writes are rejected when the caller's expected version is stale.
- Audit rows and document-version rows are created for every central document write.
- Anonymous browsers cannot read central documents, snapshots, or shared tables.

## Phase 4: Marketing Metrics To Bonus

Actions:

- Normalize approved Marketing metrics into `atlas_marketing_metrics`.
- Add approval workflow and source metric visibility.
- Bonus consumes only approved metric rows that match community, period, plan, and eligibility.

Rollback:

- Disable central marketing metric reads in Bonus and return to legacy metric fields.
- Preserve all central metrics and approval logs.

Validation:

- Approved metric counts by period match Marketing.
- Unapproved metrics never appear in payable Bonus calculations.
- Bonus payout totals reconcile before and after cutover.

## Phase 5: Finance, Budget, Maintenance, Contracts

Actions:

- Migrate budgets, actuals, contract records, and maintenance metrics to canonical tables.
- Replace Maintenance JSON collaboration with authenticated central writes.
- Preserve JSON export/import only as controlled backup and migration tooling.

Rollback:

- Set central module flag to read-only.
- Use legacy exports for user access while preserving central mapped rows.

Validation:

- Budget totals by account/period/community match source.
- Actual totals by account/period/community match source.
- Contract counts and amounts match source.
- Maintenance weekly metric totals match source.

## Phase 5A: DLR Automated Reporting

Status: foundation implemented, provider/domain setup required before production sends.

Actions:

- Apply the additive `atlas_dlr_snapshots`, `atlas_dlr_delivery_subscriptions`, and `atlas_dlr_delivery_history` schema.
- Deploy the Cloudflare Worker with the weekday cron trigger and `send_email` binding.
- Store the Supabase service-role key only in the Worker environment.
- Configure `ATLAS_DLR_FROM_EMAIL` and verify its domain with the transactional email provider before enabling fully automated sends.
- Keep the existing browser DLR parser and report builder as the reviewed report authoring surface.
- Publish reviewed DLR snapshots from the DLR workspace to the central backend before the schedule is allowed to send.
- Treat Outlook/`mailto:` drafts as manual convenience actions only; they do not update server delivery history.

Migration impact:

- No existing DLR mappings, monthly fields, floor-plan variance rows, renewal metrics, or traffic rollups are renamed.
- Reviewed report payloads are stored in the central database as immutable delivery inputs.
- Delivery settings move from browser-only state into `atlas_dlr_delivery_subscriptions` when a reviewed snapshot is published.
- Each scheduled run records a delivery outcome, including skipped, awaiting approval, missing provider, failed, or sent.

Rollback:

- Pause or remove the Worker cron trigger.
- Set affected subscriptions to `paused` or `disabled`.
- Keep published snapshots and delivery history for audit; do not delete them.
- Continue using manual DLR export or Outlook draft actions while central delivery is paused.

Validation:

- Publish a reviewed DLR snapshot and confirm the row appears in `atlas_dlr_snapshots`.
- Confirm a matching subscription appears in `atlas_dlr_delivery_subscriptions`.
- Run the server queue in a non-production sender/domain setup and confirm `provider_not_configured`, `awaiting_approval`, or `sent` is recorded truthfully.
- Confirm no browser local storage value or generated `mailto:` link is treated as the system of record.

## Phase 6: Hosted App Cutover

Actions:

- Host Atlas over HTTPS.
- Require login before loading shared data.
- Enforce permissions per module and community.
- Enable realtime subscriptions for authorized records.
- Disable browser/local JSON as primary collaboration.

Rollback:

- DNS/app routing can point users to the last validated static build in read-only mode.
- Central database remains source of truth; no migrated records are removed.

Validation:

- Multiple users can edit different authorized records concurrently.
- Conflict detection blocks stale writes.
- Audit trail shows actor, timestamp, before, after, source, and affected entity.
