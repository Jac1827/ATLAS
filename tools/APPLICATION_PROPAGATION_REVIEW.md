# ATLAS Application Performance repair — implementation review

16 September 2026. **Local implementation; not deployed. The end-to-end shared-publication repair is incomplete.**

Repository: `Jac1827/ATLAS`. Review branch: `fix/application-propagation`, based on `e9a144a`. The original checkout and production configuration were not changed. The attached patch contains code and regression tests; supplied workbooks remain unchanged and are not included in the patch.

## What changed

- Application Performance reads the existing main Resident Data store through a read-only projection. Its dedicated import action delegates to the established multi-sheet importer, instead of creating another independent dataset.
- Box Score uses section/group-qualified totals. Application Completed is distinct from Lease Completed. Detail snapshots no longer overwrite completed-application period totals.
- Imported Box Score activity has an independent reporting-month selector and source references. Applicant details retain their separate snapshot/date filters.
- Community-scoped application identities, source-effective precedence and conflict exclusions replace upload-order selection in the Application Performance projection. Empty community scope returns no records. Unknown effective times cannot silently replace conflicting known snapshots.
- Source timestamps are retained. Filesystem modification and upload time no longer substitute for Resident Data effective time.
- Snapshot counts are labeled as snapshots. Missing signed-lease, actual-move-in and final-decision evidence is not converted into lifecycle conversion rates. Scheduled move-in does not establish possession.
- Display and spreadsheet export use the same filtered detail rows and period-total source references.
- Existing dashboard bundle merging now unions Resident Data upload identities and preserves deletion/explicit restore revisions. This is not a substitute for a server-side atomic concurrency protocol.
- Physical, source-leased and exposure-adjusted occupancy remain separate. Notice exposure is not subtracted twice. Unit-based occupancy does not publish as student bed occupancy. Derived occupancy fields respect existing source precedence.
- Approved ignore/qualified mapping decisions remain honored. A mapping against an ambiguous repeated header is held for qualified review.

## Evidence and limits

| Check | Result | Limit |
|---|---|---|
| Supplied Resident Data workbook through the existing parser | 1,578 records parsed across property tabs | Read-only local fixture test |
| Sereno Box Score / Lead Conversions / Application | 7 completed; 5 approved | Source-period totals, not a conversion cohort |
| Sereno Box Score / Lead Activity | 76 new leads; 26 first tours | Same supplied source fixture |
| Sereno Box Score / Availability | 258 occupied; 265 source leased; 241 exposure adjusted; 79 available | Separate counts and denominators retained |
| Duplicate, backfill and conflicting snapshots | Passed | Local application projection |
| Empty scope, prior-year MTD exclusion, student basis hold | Passed | Does not prove backend authorization |
| Mapping ignore and repeated-header ambiguity | Passed | Qualified source references checked |
| Actual history normalizer | Retains added source metrics | Not a migration of existing historical data |
| Serialized reload and delete/restore merge | Passed | Simulated storage; not two signed-in users |
| Actual UI renderer and XLSX export | Same filtered detail rows; unavailable lifecycle evidence | Isolated synthetic UI, no production writes |
| Local browser visual check | Rendered without clipping in inspected view | Not a full production-page acceptance test |
| Investor packet, source bridge, Budget Builder, packet UI regressions | All four suites passed, including 25 core packet checks | Existing feature regression checks, not a new report generation |

Run `tools/application-propagation.test.cjs` with the `ATLAS_XLSX`, `ATLAS_RESIDENT_FIXTURE` and `ATLAS_BOX_FIXTURE` environment variables pointing to the local spreadsheet library and supplied workbooks. Without fixture variables, real-file checks are skipped. Tests use extracted application functions and controlled boundaries; they do not imply a full browser upload/publish pass.

## Shared-publication findings

Read-only inspection of the configured Supabase project and live ATLAS settings found:

1. Central autosave, startup pull and realtime were disabled. Snapshot, reconciliation and rollback checks were pending. These checks were not bypassed or marked complete.
2. `atlas_app_documents` contains `atlas_shared_property_graph_v1`; the configured dashboard key `atlas_dashboard_state_v1` is absent. A property-directory document is not evidence that operational dashboard imports have been published.
3. `atlas_app_documents` permits admin management and admin/executive reads. It does not grant Ashly Kellow's `centra` role access to the dashboard document.
4. An isolated transaction-local authorization-helper evaluation for Ashly returned `nocatee_scope_allowed = true` and `dashboard_document_read_role = false`. This is a policy diagnostic, **not** an authenticated browser read test.
5. Ashly's profile has active status but `account_status = activation_pending`; her authentication record has a confirmed email and previous sign-in. The profile label is inconsistent, not proof that login is blocked. An authenticated second browser session was not available for acceptance testing.
6. Central Nocatee, Viera and Glen Kernan Park are inactive; the inspected browser's community status display differs. No community was reactivated or silently reconciled.
7. The existing central tables include marketing metrics and read-only legacy snapshots, but no applicant-level operational table. A legacy snapshot upload alone is not publication. Broadening the whole-dashboard document policy would expose unrelated contents and is not this repair.

**Required next implementation:** finish a community-scoped shared-publication contract through the existing central client, with server-authorized records, source/version metadata, atomic duplicate/conflict handling, and hydration into the existing Resident Data consumer. Preserve the broader dashboard migration checks. Aggregate metrics should use the existing marketing-metric publication path after verifying its approval, grain and source contract; applicant identities need a scoped detail schema. Neither change is included in this patch. No schema migration or central data write was made.

Do not deploy this local increment as an end-to-end fix. A first accepted shared import must still be demonstrated in two authorized sessions, with reloads, scope denial, duplicate import and competing updates. No operational source workbooks were uploaded into the live site during this work.

## Destination register

Status refers to this increment, not all ATLAS functionality.

| Destination | Actual binding / dependency | Filters and time basis | Status |
|---|---|---|---|
| Data Import → Application / Resident Data | `processApplicationResidentDataFiles`, `applicationResidentDataState`, `rise_ops_global_v1` | Approved aliases; selected report month/year; report effective time | Locally verified parser and normalization |
| Application Performance applicant view | `getAtlasCanonicalApplicationData` → `AtlasApplicationSources.project` | Workspace scope, active communities, source-effective latest snapshot; UI filters | Locally verified; shared read blocked |
| Application Performance Box Score panel | `getAtlasApplicationPeriodMetrics` → `dataImport2State.lineage` | Unique current accepted Box Score field, exact community and year-month | Locally verified; central publication not implemented |
| Application Performance Excel export | `atlasApplicationExport` | Same detail filters and selected aggregate period | Locally verified |
| Community Overview / Leasing Performance | `dataImportApplyGroupedSnapshot` → monthly record/history | Source precedence, exact year-month; units versus beds | Source-to-record tests passed; full page integration pending |
| Dashboard sync | `mergeDashboardStorageBundles` → central document client | Existing migration gate and expected-version protocol | Local upload union tested; central dashboard document absent |
| Central authorized reads | `atlas_app_documents` policies; `atlas_can_access_community` | Authenticated role and community scope | Verified mismatch for Ashly; no policy changes |
| Central Services renewals / move-outs | `central-services.js`, `importRenewalRowsToCentralServices`, `confirmPossessionForCase` | Lease episode and staff-confirmation evidence needed | Inspected; not changed in this increment |
| Turn / inspection deadlines | Existing calendar helpers and possession confirmation | Community timezone, approved calendar, separate anchors | Requirements confirmed; server-confirmed implementation pending |
| Collections / eviction | Central Services case workflow | Full account identity, past-due evidence and authorized staff confirmations | Not implemented in this increment |
| Maintenance | Parent/detail source distinctions in supplied catalog | Unit basis; parent work-order identity | Catalogued; propagation not implemented in this increment |
| Financial / Budget Builder / investor packet | Existing actual/budget bridge and packet source adapter | Exact community, accrual basis and reporting period | Existing regression suites passed; no new financial import propagation claim |

## Confirmed workflow decisions

- Test only an inactive senior community: Nocatee, GKP/Glen Kernan Park or Viera. Nocatee is the intended shared test target and must remain inactive.
- Second authorized test account: Ashly Kellow. No role expansion, password reset or activation message was performed.
- A sent renewal offer opens the renewal case even earlier than 90 days before lease expiration.
- Holidays: use a current RISE-approved calendar from Egnyte when available; otherwise federal holidays. Searches located older holiday policies but no verified current RISE calendar.
- Deadline cutoff: **11:59 p.m. in the community's local timezone**.
- Turn day 1 is the first business day strictly after the local staff-confirmation date; day 5 is the ready target. Later make-ready creation must not restart it.
- Inspection is due on business day 2 after actual possession return. Late confirmation does not move that deadline.
- Keep actual possession date, authenticated server confirmation time, timezone, calendar version and rule version separate. Calendar changes/corrections need an audit trail; no silent reset.

Federal fallback reference: [OPM federal holiday schedule](https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/). This documents the calendar source; no holiday/deadline code was deployed in this increment.

## Open items by owner

**ATLAS implementation:** scoped backend publication and hydration; atomic server-side concurrency; applicant-store migration/reconciliation; actual two-session testing; remaining lifecycle, maintenance and accrual-financial propagation; current versus historical load guards; full source-to-export acceptance. Local legacy application-intelligence storage remains preserved but is not automatically reconciled into the canonical store.

**ATLAS access administrator / Ashly:** reconcile the inconsistent activation-pending profile label and provide a signed-in second test session. No password should be sent in this conversation. Resolve browser-versus-central community status differences before production migration.

**Central Services leadership:** confirm remaining assignment, reminders, holds, reopening, execution/closure and communication rules using the attached specification. Early-offer behavior, calendar fallback and cutoff are resolved.

**Property/accounting/source owners:** resolve denominator conflicts such as Baymeadows, provide complete event/AR/lease coverage and approve undefined financial/leasing definitions. The supplied filtered applicant roster cannot establish full lifecycle conversion or processing outcomes.

The accompanying source catalog, mapping findings, source export requirements, developer specification, acceptance checklist and code-location findings were copied from the prior source-inspection task unchanged. They remain supporting evidence; this review describes what was actually implemented and tested now.
