# Annual utility forecast planning

Annual forecasts, tariffs, property utility actuals and approved budgets are separate records. Uploading or activating a forecast never creates an accounting close or writes an approved budget.

## Storage and access

Apply `centralization/utility-forecasts.sql`, `utility-forecast-validation.sql`, and `utility-forecast-rollback.sql` in order after the canonical finance migrations. Forecast vintages contain fiscal periods, completion dates, uploader, source name/hash and reconciliation counts. Original workbook bytes and detailed validation evidence are retained in an Admin-only table. Community-scoped rows retain worksheet, source row, analyst, provider, original monthly evidence, eligible percentages and availability status. Immutable activation events identify the preceding active vintage and use an optimistic expected-version check. Older versions require an explicit reviewed rollback. Authorized readers see only community rows within their access scope; shared header metadata contains no other community's financial changes.

Bill-level actuals retain billing period, utility/provider, usage and unit, estimated flag, cost components, meters, occupied units and source evidence. Cost never establishes confirmed usage. Duplicate source/community/period/provider imports are rejected. Draft scenario revisions retain location, original location, actor, time, reason, crosswalk, manual forecasts, selected proxy, normalization assumptions and source references. Writes cannot update or delete prior records through the client.

## Import and mapping

The XLSX reader and CSV reader detect property/utility headers and fiscal metadata. August–July is mapped to explicit calendar months, including negative percentages and verified zeros. Annual averages are independently calculated with source-precision tolerance capped at 0.05 percentage points. Missing and ineligible values remain null. A missing canonical community is an exclusion with a visible warning, never an inferred match. Cancelled and currently inactive communities are excluded from planning and peer matching.

Matching prefers canonical community/utility, then an explicitly configured provider territory, ZIP/provider, and city/state/provider. Ambiguous provider matches require selection. A different-provider peer requires explicit approval. The source workbooks contain no ZIP or provider-territory catalog; those methods remain unavailable without that evidence. No city-only provider assignment occurs. Manual forecasts are labeled and sourced.

The configurable crosswalk starts with 6450, 6451, 6452, 6460, 6461, 6463 and 6464. Water/sewer combinations require historical cost allocation and its source. Cable, internet and chilled-water accounts are excluded. Multiple budget lines for one GL require allocation before automatic application.

## Calculation and screen

Recommendations prefer sourced projected usage and an effective tariff, with fixed/demand charges outside the forecast factor. The fallback uses canonical prior-year same-month GL cost. Occupancy, units, seasonal/operational changes and fixed charges require reviewed assumptions. Monthly percentages never compound from the preceding month. Missing source periods or allocations produce unavailable recommendations.

Utility Providers includes rate and forecast uploads, fiscal/vintage selection, activation/rollback review, utility/provider filters, location and provider controls, forecast trends, canonical cost history, bill-level actual history, per-occupied-unit costs, year-over-year changes and forecast variance. Recommendations have a source/formula preview and GL drilldown. Applying recommendations writes only the selected unlocked scenario's utility overrides and retained evidence. Existing Admin publication remains the publication boundary.

## Reporting repairs

Canonical close rows are projected into a temporary read-only report state so accounts absent from a browser ledger are included. Report preparation freezes a versioned snapshot. Missing amounts propagate through financial-review rows, aggregates and trends. A report with incomplete YTD explicitly uses its latest closed month where applicable. Other Income uses all line items, including explicit zeros, with signed currency labels and the same table values. CSV source columns retain close versions, hashes, locations and budget version. HTML/PDF printing uses the same report renderer.

## Verification and rollback

Run `node tools/utility-forecast.test.mjs`, `node tools/utility-forecast-db.test.cjs`, `node tools/utility-report-lineage.test.cjs` and the canonical finance tests. Set `UTILITY_FIXTURE_DIR` to a private directory containing extracted `initial.json` and `updated.json` to run source-workbook regressions. Private workbooks are not committed. UI upload acceptance must additionally exercise the bundled XLSX reader and authenticated RPCs.

To roll back a forecast, choose the retained vintage, select **Rollback to selected prior vintage**, review and confirm a reason. This appends an event and preserves every source record. To roll back the frontend, revert the repair commit and deploy the revert through the existing production workflow. Keep the additive tables and migration history; do not drop them or delete source evidence. Approved budgets and closed actuals require no restoration because this feature does not alter them. No production budget or close replacement is created solely for acceptance testing.
