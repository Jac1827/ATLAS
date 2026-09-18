# Occupancy import integrity repair

Related issue: #7. Keep the issue open until authenticated source-to-screen acceptance passes.

## Problem and change

The current Box Score parser selects the occupied count separately from repeated percentage headers, but publication still accepts inconsistent counts after logging a warning. It can also infer a missing count from a rounded percentage, and same-file replay can bypass a newer source date.

This change retains independently located physical and leased percentages for reconciliation, prevents count/rate remapping, and requires whole counts and matching configured/source inventory before publishing occupancy. Occupied, leased, denominator, rates and dated physical history use the same publication decision. Missing counts are not reconstructed from rates. Valid zero counts remain valid. An undated same-file import may have its timestamp repaired; an older or undated replay cannot replace a newer dated value. Fractional or out-of-range stored counts cannot qualify as verified history.

Invalid source rows remain available in canonical source history and produce a high-severity occupancy publication exception. They do not replace the previously published occupancy. Other independently valid operational fields can continue importing. The repair does not automatically validate or replace previously corrupted records.

Inventory checks require source total to match configured inventory, positive rentable inventory no greater than total, and excluded plus rentable to equal total when exclusions are present. Occupied plus vacant must equal rentable when vacant is present. Reported rates must reconcile to counts within 0.15 percentage points to accommodate displayed rounding. An inventory change must be reviewed before its occupancy is published.

## Verification

Run `node tools/occupancy-publication-safety.test.cjs` for synthetic import-to-publication cases, typed mappings, stale replay, history eligibility and JSON readback. The Occupancy integrity workflow runs this and the existing occupancy, inventory-basis, historical-boundary, planning and replay suites on pull requests and main.

The optional private source verification uses the existing `source-reconciliation.test.cjs` with `ATLAS_XLSX` and `ATLAS_SOURCE_DIR`. Do not commit operational source files or source totals.

## Production acceptance still required

1. Export the exact approved import, fingerprint, original workbook, source locators, canonical community IDs, lineage and current destination records. A local workbook with the right report date is not sufficient proof of batch identity.
2. Record a reversible backup that includes community data, import architecture state, archive blobs and lineage. The existing migration snapshot excludes import architecture state and is insufficient by itself.
3. Compare a dry run with the newest source controlling each field and period. Investigate Preserve's original publication disposition separately. Do not replace newer values with an older report.
4. Obtain the owner's action-time confirmation immediately before production correction. Deploy the reviewed code, replay only verified approved sources, and check that repeated replay adds no duplicate records.
5. Read back the saved state through a fresh authenticated session. Reconcile Community Command, portfolio summed counts and rentable inventory, trends, DLR, recommendations, exports and historical boundaries. Validate the actual source date and inventory basis on every output.
6. Preserve correct current-period data. Historical January–August gaps need period-specific reports; do not fill them from a current snapshot. Unsupported projections must remain unavailable.

## Prevention

- Make the Occupancy integrity check required before merging changes to import or reporting logic.
- Retain source hash, sheet, row, column, community ID, effective date, field units and mapping version with each published metric.
- Separate source freshness from publication success in data health. An approved recent upload is not proof that its occupancy published or reconciled.
- Reconcile all required communities after every approved import and after reloading persisted data. Alert on discrepancies, omitted communities and denominator changes.
- Use explicit count and percent types in mapping approval. A learned rule must never override the dimensional checks.
- Add a reviewed replay preview with field-level before/after values, newer-source protection, durable backup and rollback identifiers.
- Verify which store controls production occupancy and require authenticated shared persistence with version checks. Legacy state or migration snapshots are not evidence of current shared publication.
