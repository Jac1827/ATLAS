# Investor Community Packet

Open **Reports → Report Type → Investor Community Packet**. Select a community and reporting month. The builder stores commentary, source mappings, materiality settings and reviewed versions separately from operating source records.

## Packet structure

A twelve-section investor core answers performance, drivers, management actions and investment-plan progress. It includes occupancy, funnel, revenue, expenses/NOI, collections, maintenance, capital, debt/liquidity, returns, market/outlook and risks/actions. Student, senior, military and lease-up measures are optional. Appendices retain all comparisons, sources, review questions and prior-review changes. Long commentary can add printed pages; the PowerPoint keeps twelve core slides and continues supporting detail in its appendix.

## Data and definitions

- Operations use exact `monthlyHistoryByPeriod[YYYY-MM]` values. No current-month array is substituted for missing history.
- Dated DLR inventory is usable only in its matching reporting month, with the source filename and as-of date cited.
- Save Budget Builder to produce a read-only financial source snapshot. Exact community names match automatically; differing display names require an explicit link in the builder. The source name remains in citations.
- The Budget Builder bridge uses the approved scenario for budget and verified closed actuals. It publishes active reforecast values only for the saved current reporting vintage. Non-calendar fiscal years require explicit mappings.
- Financial ledgers require confirmation of monthly basis, numeric detail rows and unique GL codes. No YTD amount is silently interpreted as monthly.
- Advanced source mappings can point to existing ATLAS fields with period/year tokens and include a definition, citation, version and multiplier. Percent rates are stored on a 0–100 scale.
- Missing values remain unavailable. Stored default zeros require verification. YTD flow values require all months; rates, balances and per-unit measures require explicit YTD mappings. A zero budget has no percentage variance.
- Forecast revisions compare only forecasts for the same year. Asking, signed and effective rents remain separate measures. Operational and subsidy receivables remain separate.

## Review and exports

Record the four leadership answers, metric drivers, evidence, accountable owners, actions and due dates. Confirmed explanations without evidence are presented as hypotheses. Material changes without evidence, owners and actions are flagged. Save a reviewed version to establish the next month's comparison and carry forward commitments.

Exports: editable native PowerPoint tables/chart/text; editable HTML narrative document; comparison XLSX with variance formulas, audit, sources and owner questions; print/PDF. Citations are in document source registers, workbook Sources and PowerPoint speaker notes. Full comparisons are in the appendices. Raw resident records are not included.

## Existing email cadence

Select a saved reviewed version, then publish the selection through the existing signed-in DLR workflow. This adds a dated HTML investor packet attachment to that community's existing DLR delivery. It does not create recipients, modify cadence settings, send immediately, or auto-approve a newly generated month. The attachment remains the selected reviewed version until replaced or removed and republished. Publication requires the existing central reporting connection and permissions. The server validates exact community, reviewed status, period, metric schema and payload bounds.

## Validation

Run `node tools/investor-packet.test.cjs` and `node tools/investor-budget-bridge.test.cjs`. The latter executes ATLAS's actual Budget Builder calculation engine. Export checks use synthetic data only. PowerPoint package and geometry checks and rendered-slide review are required after layout changes. XLSX checks verify comparison formulas and all four tabs. No live investor report or email was produced during implementation.
