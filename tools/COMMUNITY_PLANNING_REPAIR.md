# Community Planning and Closed Financial Actuals

## Source Rules

- Economic occupancy uses approved closed full-month Net Rental Income, after concessions and leasing costs, divided by that package's GPR. Operational rental income, collections and delinquency are not substitutes.
- Closed actuals are recorded in Community Command with accounting month, source/page reference, approver, timestamp, reason and immutable revision history. Missing packages remain missing. Negative net rental income is retained.
- Entrata Trending Occupancy is parsed by monthly date range and occupied-unit/count fields. Missing cached Excel formulas are recomputed from those fields, not assumed zero. Multi-month summary rows are excluded.
- Past beginning/ending boundaries are actuals; current-month ending and future boundaries are forecasts. Availability dates in Box Score sections govern historical snapshots, not the file generation timestamp.
- Box Score boundary evidence takes precedence over a conflicting trend boundary. Source movement reconciliation warnings remain visible. Source data is not rewritten to force balance.
- Approved required move-ins can update the planning forecast. Lease-production goals are not silently converted into physical occupancy. Next-month forecast beginning follows the preceding forecast ending using the same denominator.

## Governance

- Goal drafts are separate from approved versions. Approval requires a reason, effective date, valid count/percentage ranges, available beginning occupancy and no blocking reconciliation/mapping issue.
- Weekly allocations must sum exactly to monthly goals. Approval records preserve the original recommendation and employee assignment snapshot.
- Bonus goal lookup uses effective approved versions, never drafts. Missing actuals/targets hold calculation. Multi-month rate incentives remain held until a denominator-weighted aggregation policy is approved; they are not averaged.
- Source workbooks and financial packages are private operational data and are not bundled into public deployment assets.

## Verification

Focused regression suites: community-governed-planning, trending-boundaries, canonical-report-data, occupancy-contract, source-reconciliation, reporting-repair and investor-packet-sources. The importer is also checked against supplied workbooks without committing their data.

Broader performance bundle splitting, full device/network profiling and quarterly incentive aggregation are not claimed by this release.
