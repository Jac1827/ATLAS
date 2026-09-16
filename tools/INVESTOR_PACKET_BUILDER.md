# Investor Community Packet

Open **Reports → Report Type → Investor Community Packet**. Select a community and reporting month. The builder stores commentary, source mappings, materiality settings and reviewed versions separately from operating source records.

## Packet structure

A twelve-section investor core answers performance, drivers, management actions and investment-plan progress. It includes occupancy, funnel, revenue, expenses/NOI, collections, maintenance, capital, debt/liquidity, returns, market/outlook and risks/actions. Student, senior, military and lease-up measures are optional. Appendices retain all comparisons, sources, review questions and prior-review changes. Long commentary can add printed pages; the PowerPoint keeps twelve core slides and continues supporting detail in its appendix.

## Data and definitions

- Operations use exact `monthlyHistoryByPeriod[YYYY-MM]` values. No current-month array is substituted for missing history.
- Dated DLR inventory is usable only in its matching reporting month, with the source filename and as-of date cited.
- The builder reads the current saved Budget Builder model automatically in an isolated calculation frame. It does not boot the editing workspace or write budget inputs. Existing explicit ATLAS community identity links are reused; fuzzy or substring matching is not used. Approved publications also carry a source snapshot for the linked community. The source name remains in citations.
- The Budget Builder bridge uses the approved scenario for detailed revenue/expense categories, capital budgets and verified closed actuals across saved years. Account-specific source citations and variance notes are included. Active reforecast values are attached only to their saved reporting vintage. Non-calendar fiscal years require explicit mappings. Missing account actuals stay unavailable rather than becoming zeros.
- Financial ledgers require confirmation of monthly basis, numeric detail rows and unique GL codes. No YTD amount is silently interpreted as monthly.
- Advanced source mappings can point to existing ATLAS fields with period/year tokens and include a definition, citation, version and multiplier. Percent rates are stored on a 0–100 scale.
- Missing values remain unavailable. Stored default zeros require verification. YTD flow values require all months; rates, balances and per-unit measures require explicit YTD mappings. A zero budget has no percentage variance.
- Forecast revisions compare only forecasts for the same year. Asking, signed and effective rents remain separate measures. Operational and subsidy receivables remain separate.

## Review and exports

The four leadership answers are drafted from supported figures, account variances, existing DLR owner notes and Community Command actions. Review or edit them as needed; user edits take precedence. Metric movements are drafted as observations; adverse material movements become review-required risk entries with recommended mitigation. Source notes remain hypotheses until evidence confirms a cause. No recommendation is presented as a completed management action. Imported commentary can be edited or suppressed without modifying its original source. Record any remaining accountable owners, actions and due dates. Confirmed explanations without evidence are presented as hypotheses. Material changes without evidence, owners and actions are flagged. Save a reviewed version to establish the next month's comparison and carry forward commitments.

Exports: editable native PowerPoint tables/chart/text; editable HTML narrative document; comparison XLSX with variance formulas, audit, sources and owner questions; print/PDF. Citations are in document source registers, workbook Sources and PowerPoint speaker notes. Source-channel application cohorts and market comparisons are included in a separate Source segments workbook tab and export appendices. Full comparisons are in the appendices. Raw resident records are not included.

## Existing email cadence

Select a saved reviewed version, then publish the selection through the existing signed-in DLR workflow. This adds a dated HTML investor packet attachment to that community's existing DLR delivery. It does not create recipients, modify cadence settings, send immediately, or auto-approve a newly generated month. The attachment remains the selected reviewed version until replaced or removed and republished. Publication requires the existing central reporting connection and permissions. The server validates exact community, reviewed status, period, metric schema and payload bounds.

## Validation

Run `node tools/investor-packet.test.cjs` and `node tools/investor-budget-bridge.test.cjs`. The latter executes ATLAS's actual Budget Builder calculation engine. Export checks use synthetic data only. PowerPoint package and geometry checks and rendered-slide review are required after layout changes. XLSX checks verify comparison formulas and all five tabs. Also run `node tools/investor-packet-sources.test.cjs` and `node tools/investor-packet-ui.test.cjs` for automatic connection scope, data preservation and editable generated commentary. No live investor report or email was produced during implementation.

## Automatic connections and coverage

The connection panel shows available source families and current-period metric coverage. Sources include exact-period KPI/import lineage (including verified zeros), imported renewal cohorts, dated Market Survey history, deduplicated Application Performance records, Central Services case aggregates, property-specific Maintenance weekly snapshots, and Community Command actions. Refreshing or exporting rereads the saved budget; budget autosaves also trigger a refresh. Source overrides are an advanced option, not a prerequisite.

Weekly maintenance completions are not silently summed into a calendar-month total. Resident-case balances are labeled partial scope rather than substituted for total property receivables. Application-source cohorts use recorded statuses rather than inventing event-date conversion rates. Personal resident information is excluded. Loan terms, investor cash flows, underwriting and other metrics without a supported source still require source data; the builder does not manufacture a complete-looking packet.
