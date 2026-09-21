# Community Command enhancement: source and persistence review

Status: audit and calculation contract only. No live UI change, database migration, report delivery, or acceptance claim.

## Confirmed current architecture

- Community Command is an inline dashboard renderer. The dense portfolio roster is in `renderPortfolioScopedCommunityCommandTab`; keep that presentation.
- Current budget-unit planning uses `Math.ceil(rentableUnits * budgetPct / 100)`. The new contract retains that rounding rather than introducing a conflicting nearest-unit convention.
- Budget Builder selects a scenario with `type === 'approved' && locked` in its investor reporting adapter. The adapter's GPR selector is GL 5120 and its expense selector is account nature `expense`. These selectors do not provide governed mapping approval metadata.
- Budget Builder uses its own property IDs and names. No canonical `communityId` or `atlasCommunityId` reference was found in the inspected Builder application. Do not silently resolve that relationship by filename or fuzzy name matching.
- Existing financial publication preserves per-period rows and source history, but its contract does not require canonical community ID, approved scenario/version, GL mapping approval, publication approval, or coverage certification. It is insufficient by itself to publish a green/red financial status under the requested rules.
- Existing plans/tasks live in `communityCommandState` in shared settings. Task updates call `persistOpsGlobalData` and redraw the workspace. That does not establish independently conflict-safe, community-scoped, cross-session task persistence.
- Live catalog inspection found `atlas_budget_lines` with community_id, period_key, approval fields and version. It does not contain approved scenario/GL mapping/coverage metadata. No dedicated Community Command plan/task tables were found in the inspected public schema.

## Prepared implementation

`community-command-contract.js` is a pure, unloaded module. It calculates occupancy unit variance using the exact community/fiscal-year/period and historical denominator. It refuses missing, invalid, draft, mismatched or unreconciled inputs. Its financial contract requires approved locked scenario/version, approved scoped mapping, approved source publication, matching period basis, and every required GL/period value. Duplicate required lines are rejected. Expense favorable variance is budget minus actual. It returns sorted cause rows only from supplied verified GL codes. It performs no queries and is not a security boundary.

The task transition contract preserves completion versus verification, requires verification permission and evidence, checks expected version, appends a change event, and clears verification on reopening. Backend authorization and transactional enforcement remain to implement. Unit tests exercise these boundaries; they do not prove UI, RLS or persistence acceptance.

## Proposed canonical relationships

1. An approved identity mapping relates canonical Community_ID to Budget Builder property ID; retain approver, timestamp and revision. Ambiguous mappings stay unresolved.
2. A budget-version record identifies community, fiscal year, scenario ID/version, locked approval and source hash. Occupancy targets retain explicit period, denominator basis and target rounding.
3. An approved metric-to-GL mapping version lists required GPR/operating expense GL codes, sign convention and applicability dates. Do not classify unknown GLs as zero or infer mapping approval from account descriptions.
4. A financial publication identifies community, fiscal year, accounting basis/period, source version, approval and completeness. Enforce one current approved publication per scope; retain superseded revisions.
5. Materialize one Community Command summary per authorized community/period/scenario version after validated source changes. Bulk-read the selected period; never preload annual GL detail for every community.
6. Load GL causes on demand with the same community, period basis, scenario version and mapping version. The destination checks Budget Builder permission itself, orders unfavorable causes first, preserves URL scope and provides an explicit return path.

## Proposed persistence migration (not applied)

- `atlas_community_plans`: stable UUID, community FK, reporting period, stage, owners, version, audit actors/timestamps.
- `atlas_community_findings`: deterministic scoped source/metric/period/target identity, measured values, readiness/performance classification, provenance, source and target versions, status. Unique identity prevents regenerated duplicates.
- `atlas_community_plan_tasks`: stable UUID, plan/community FK, manual/recommended origin, lifecycle, title/description, owner/verifier, due date/priority, nullable typed baseline/target/current values, measurement unit, evidence and notes, version and timestamps.
- `atlas_community_task_events`: append-only edit/assignment/deadline/status history, actor, previous/new values and version.
- `atlas_community_task_findings` and `atlas_community_task_gl`: scoped relationship tables, preventing links across communities/periods.
- `atlas_community_plan_reports`: immutable report snapshot, exact period/source timestamps, tasks, executive note, audience, generated-by and content hash.
- `atlas_community_report_deliveries`: report ID, authorized recipient set, delivery request/idempotency key, attempts and provider status; no email sending from a browser-only save.

All exposed tables require RLS and explicit grants. Reuse canonical community access evaluation; separately enforce plan edit, task verify, finance detail and investor report permissions. Expected-version checks, event append and task update must commit atomically. A completed task cannot become verified merely through report generation. Recipients must be checked by a server-side delivery route. Do not reuse the whole-dashboard document as a shortcut around row-level scope.

Before execution, produce the concrete SQL migration and test admin/regional/community/central-services roles plus cross-community denial against a local database. Review the migration and rollback before production application. Existing plans should be copied losslessly with stable legacy IDs, reconciled and read back; do not delete the settings copy during initial rollout.

## UI and reporting implementation remaining

Add Units vs Budget, GPR and Expenses to the existing table. Keep Missing neutral and label readiness problems separately from unfavorable performance. Financial controls remain non-links without a verified destination. Add editable recommendation review and manual task form using the canonical contracts; use the existing compact plan layout. Reports must use one immutable generated snapshot for screen/PDF/XLSX/email, include both task origins, and omit resident/unit identifiers and excessive GL detail.

## Acceptance and rollout

The full requested roster, GL drill-down, plan editor, persisted tasks, history, report export/email and authorization matrix are not implemented yet. Do not publish a placeholder UI as a completed feature. Run source reconciliation, role-based and independent-session tests, report parity/delivery deduplication, and issue #12 browser performance checks before declaring completion. No operational record or production schema was changed by this audit.
