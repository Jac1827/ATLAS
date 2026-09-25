# Application and screening lineage

Application snapshots and Box Score activity are different populations. Source Application Status is preserved verbatim; resident/lease status and renewal offers never become application decisions.

## Application evidence contract

- Canonical fields: applicationStartedAt, applicationCompletedAt, decisionStatus, decisionAt, sourceEffectiveAt, periodKey, Community_ID, source column/sheet/row and import identity.
- Eligible snapshot cohort: an explicit application terminal state, or a completed application with no terminal decision at its source-effective time. Approved + denied + cancelled + pending equals eligible. Started/incomplete and unavailable/other remain separate.
- Application-start and final-decision month cohorts require those explicit timestamps. An upload/report month is not an event month.
- Processing duration is application start to final decision, inclusive of zero-day intervals; negative, missing, future or invalid event pairs are excluded. No lead-created/completion fallback. Average, median, p75, p90, eligible counts and excluded counts are retained through archived imports and the monthly view/export.
- A lease conversion numerator requires the same community/application/lease identity and an actual signed/executed timestamp at or before source effectiveness. Lease start and scheduled move-in never substitute. Missing signed evidence remains unavailable. Observed conversion uses verified executed joins over the eligible approved cohort and reports source coverage.
- Box Score conversion is separately labeled period completed leases / approvals. It requires the same community, period, file hash, qualified Lead Conversions source contract and period-activity cohort. It is never joined to current resident snapshots.

## Screening contract

Screening Results Summary 2.0, summarized by Property, is parsed across all property sheets. Each record preserves report start/end, filters, version, effective time, file/import identity and section row locators. Explicit filtered-empty sheets remain empty, not zero. Screened = in-progress + pass + conditional + fail. Failed overrides reconcile pending + denied + conditional + approved to total failed. Fail reasons are multi-select event counts, separate from conditional reasons. Pass/Fail never map to application approved/denied, and aggregate rows never generate applicant records.

`atlas_screening_imports` is a dedicated aggregate destination. Publication resolves approved community aliases centrally, checks existing application-module and import permissions, and is idempotent by normalized source content. Competing versions remain archived; equal-time conflicts and incompatible filter populations are held. Client hydration discards stale user-session responses.

## Trace and validation

Resident workbook → exact header parser → approved community mapping → scoped publication RPC → canonical JSON fields in atlas_application_imports → archived monthly lineage view / shared JavaScript cohort model → Application Tracking / Application Performance → pending and incomplete workflow queues → reconciled workbook export.

Screening workbook → section parser → server-resolved Community_ID → atlas_screening_imports → independent screening aggregates → screening outcome and reason panels → Screening Summary / Screening Reasons export sheets.

Tests: application-lineage.test.cjs, application-lineage-db.test.cjs, screening-client.test.cjs, application-propagation.test.cjs, application-publication-client.test.cjs, application-access.test.cjs. The screening fixture uses anonymized community labels and contains no applicant data. Database tests use a real Postgres engine with synthetic authorized and restricted identities. Client tests cover reload, stale responses, month filtering and screen/export agreement.
