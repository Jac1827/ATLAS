# RISE budget packages in ATLAS

Open **Budget Builder → Budget Export / Saved Versions**. The current saved revision is selected when available. Choose a different retained revision explicitly when reviewing history. Save working edits before exporting them.

Select **Export Preview — Standard RISE Budget**, then choose Excel, PDF, or Both. Detailed includes every relevant supporting section. Executive includes the summary, leasing, revenue, expenses, STR when present, and validation notes. Custom lets you select sections. Charts can be switched off or selected individually.

The monthly values in both formats come from the same immutable ATLAS version. Excel includes presentation formulas for totals with cached values, and native charts. Weighted annual occupancy, ADR, RevPAR and stay length remain the amounts calculated by ATLAS. Changing the downloaded workbook never updates a budget in ATLAS.

## Leasing and adjustments

Open **Leasing Schedule / Occupancy Drivers** in an editable draft. Review the monthly inventory, occupied units, move-ins, move-outs, rent and related assumptions. Link accounts to fixed, variable, occupancy-driven, unit-driven, revenue-driven or manual amounts as applicable. Review the calculation preview before saving.

A material manual adjustment shows **BUDGET DRIVER WARNING** with calculated and manual amounts, dollar/percentage differences and affected drivers. Return to the calculated amount, adjust the driver, or record an override reason. Other requires a written explanation. The authenticated user, time and supporting amounts are preserved with the revision.

Administrators can change community default, account and category tolerances in the export preview. Dollar and percentage thresholds support OR or AND. The server checks both the authorized setting change and financial results.

## STR programs

Create STR programs in **STR Builder**. Its Leasing / Occupancy Schedule drives units, available/rentable/booked nights, occupancy, ADR, stays, revenue and economics. Review channels, utilities and sensitivities there before saving a shared program version.

Use **Apply STR Program to Budget** from the saved program workflow. Select an existing draft, a new draft based on an authorized budget, or an active-budget revision when permitted. Review persistent GL mappings and the exact budget impact. Confirmation saves a shared budget revision with the source STR program and version retained. Reapplying a program replaces its prior contribution instead of adding it twice.

Applying to an active budget creates a reviewable revision and follows the existing publication/approval process. It does not silently replace the live operating baseline. Existing historical STR records remain readable; new manual STR programs are not created in Budget Builder.

## Fiscal calendars, validation and history

Each community has a verified fiscal start month. Administrators may select any month. Existing inferred calendars remain unchanged until explicitly reviewed. STR inherits the parent budget calendar. Exports preserve month/year labels, including fiscal years crossing calendar years. Partial saved forecasts use **Covered total** and do not invent missing months.

Draft packages retain unresolved validation findings. Final/approved packages require resolution of material findings or a server-authorized export exception. Validation notes identify retained overrides, missing assumptions, mapping issues and reconciliation differences.

Export history records the exact source version, user/time, budget status, sections, formats, validation and generated file hashes. Subsequent budget edits do not change a captured export.

## Implementation and test boundaries

The export presentation model consumes retained financial snapshots; it does not calculate a separate operating budget. JavaScript and PostgreSQL leasing calculations have parity tests. The server recalculates driver amounts, verifies overrides and authorizes export/STR actions. Immutable records and row-level security protect shared receipts.

Automated coverage includes conventional stabilized/lease-up, non-calendar student fiscal years, STR and mixed programs, revenue/expense conflicts, required overrides, charts on/off, version separation, exact Excel/PDF snapshot parity, source/mapping scope, concurrency and retries. Browser tests use disposable local databases. Production smoke exports use retained budgets without publishing financial changes.
