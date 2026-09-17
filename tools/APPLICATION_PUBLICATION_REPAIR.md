# Scoped application publication repair

Status: deployed September 16, 2026. Both approved Resident Data sources published: 1,578 + 922 records in 21 community snapshots. Shared reads enabled. Independent authorized-user acceptance with Ashly remains pending.
Base: GitHub main `39ea007641ff0751b54f853cf12cece7fb3bf231`. Tracking: Jac1827/ATLAS#4.

## Implemented

An additive, community-scoped import store and immutable source snapshots, with server-owned community UUIDs. Publication resolves source property names only against existing exact central names or active aliases. Unknown or ambiguous names fail; aliases are never created. Client-supplied community identifiers and display names cannot redirect records. No dashboard-document policy is changed.

One accepted parsed workbook publishes atomically across its communities. Missing source-effective dates, unresolved rows, and duplicate community/application identities are rejected. Content hashes exclude upload timestamps and batch identifiers, so retries preserve the original import/version. A replay does not restore a deleted import. Different snapshots remain evidence: existing source-effective projection selects newer snapshots and excludes equally dated conflicts rather than silently overwriting them.

Existing active-profile and community authorization is required. Inactive communities require explicit assignment except for admins. Publication is limited to admin/centra with Data Import unlocked. Reads enforce Application Performance locks. Tables are read-only to browser roles; authorized private functions perform publication and compare-and-swap delete/restore operations. Version records retain authenticated actor, action, server time and reason.

The central client supports paginated authorized reads, publication, and revisions. The existing Resident Data importer publishes accepted uploads when `applicationPublication` is enabled. Shared hydration runs at startup, on session changes, on focus and every minute while visible. Shared data is removed on failed reads/sign-out, and responses from a prior user are ignored. The ordinary global settings save omits shared records, keeping the central store authoritative. Display and export continue using the existing projection. Shared tombstones can be restored from history after reload.

## Validation completed

- `node tools/application-publication-db.test.cjs` using pinned PGlite 0.3.14: actual PostgreSQL SQL execution with synthetic users/communities; idempotency, atomic mixed-scope denial, direct-write denial, anonymous/disabled denial, inactive assignment, forged identity replacement, module locks, stale revision conflicts, deletion replay, restore and audit history.
- `node tools/application-publication-client.test.cjs`: hydration, canonical UUID versus existing UI identifiers, version handling, deletion, session-race rejection, failed-read clearing and sign-out.
- Existing application propagation suite: source-effective precedence/conflicts, serialized reload, display/export parity, period/source distinctions and script syntax. Real source-workbook fixture checks were skipped; no approved fixture was designated for this request.
- Existing application access suite and investor source suite passed; all 25 investor packet checks passed.
- Proposed SQL compiled against live ATLAS in a transaction ending in ROLLBACK. A follow-up query confirmed the proposed table did not remain. This validates schema compatibility, not deployed RLS behavior or authenticated browser acceptance.

## Production evidence and remaining work

Authenticated Supabase and Egnyte reads work in this session. The live database has the shared property graph document but no dashboard document or scoped applicant table. The central DLR subscription table contains zero rows; its existing schema already has a timezone column. This does not establish browser-local schedules or whether any report is ready.

The ATLAS admin browser session was accessible. Inspection was interrupted when the Mac locked. Production schedule settings, Entrata import history, enabled cadence metadata, and the four lifecycle chains remain unverified. No schedules, mappings, source values, community statuses or workflow rules were changed.

Egnyte search located archived Resident Data workbooks under Nocatee, Viera and Glen Kernan Park offboarding folders. Availability does not establish an approved/current test source. Resident details are not included in this branch or report.

Before rollout:

1. Designate an approved workbook and verify its source-effective date, period, complete population, source fields and existing central aliases. Resolve mapping questions through the existing approval process; do not substitute upload time or invent aliases.
2. Apply `docs/portfolio-operations-dashboard/centralization/application-publication.sql` through the repository's SQL release process, run database advisors, and verify grants/policies under real sessions.
3. Enable `applicationPublication` in an isolated test configuration. The default is false. Do not enable whole-dashboard autosave/startup pull/realtime as a shortcut.
4. Demonstrate one accepted source in two authorized sessions, including reload, out-of-scope denial, concurrent duplicate imports, concurrent delete/restore conflicts, display/export values and audit versions. The local PostgreSQL tests do not simulate simultaneous independent database connections.
5. Validate in inactive Nocatee without changing community status, consistent with the existing application propagation review. Reconcile legacy browser-local imports explicitly before wider enablement. Local legacy rows remain preserved and are excluded from canonical detail projection when this feature is enabled.
6. Complete the separately required Box Score/period aggregate publication through the existing marketing-metric contract. This patch implements applicant-detail publication only; it does not claim that all operational metrics, exports or reports are centrally reconciled.
7. Unlock and verify production reporting Settings; obtain exact source dependencies, freshness tolerance, timezone, preflight lead and escalation window before correcting enabled schedules. Re-run the full source-to-report audit and classify zeros from evidence.

Production schema and client deployed; original approved imports (5) and (6) published through the authenticated live Source Archive. No outbound message or issue closure was performed. Earlier rollout notes above describe the pre-deployment investigation and remaining two-session acceptance requirements.
