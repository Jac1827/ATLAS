# Independent signed-in session acceptance

This is a **recipe, not a recorded production pass**. It tests the deployed read paths and download equivalence. It does not approve an import, change a financial period, authorize a bonus, or record a payment.

## Preserve the user's workspace

- Session A: open a **new ATLAS tab** in the original signed-in browser profile. Do not navigate, reload, close, run code in, or change the user's existing Budget Builder tab.
- Session B: use the already signed-in tracing profile's separate dashboard page. Separate tabs in one profile do not satisfy independent-session acceptance.
- Use the same deployed origin/release in both sessions. Retain the public deployment asset/readback receipt separately. Do not copy cookies, tokens, local storage, IndexedDB, or a browser profile between sessions.
- Capture the workspace source banner before changing report selections. If either browser already reports unpublished local changes, an unavailable source, or a reconciliation conflict, record that condition and stop short of claiming canonical-source parity. Do not clear/reset local state to make the check pass.
- Use only normal read/navigation/download actions. Reports preferences can persist locally; they do not publish server data. Do not click Save Data, apply/approve/import, restore, rollback, email, or payment actions.

## Select an identical view through the UI

1. Wait for the workspace's source banner to show a verified central source. Record its version, source-effective date, and any refresh/local-change warning. A cached label alone does not establish failure; its source still must be verified and match the expected archive.
2. Open **Reports**. Choose **Weekly Leasing Report** under **Report Type**. This route uses the same read model for the iframe preview, HTML report, CSV, and Excel export.
3. Explicitly set the same **Report Period** month/year in both sessions. Select the same single authorized property under **Property / Portfolio Scope**. Turn off unrelated active property and distribution-group chips. Also choose the same top-level community/workspace scope. Check the preview's heading/scope count; an empty source or no matching community is not a pass.
4. Explicitly set the same **Week ending** date within that month. Do not rely on today's default. Use the period/community selected for the release acceptance; do not invent a different source period to obtain matching output.
5. Click **Refresh Data** in both Weekly Leasing previews, then wait for the report and source banner to settle. This performs reads only. Do not repeatedly refresh during measurement.
6. On each page run the function in `two-session-report-probe.js` via the browser's authorized **read-only DOM evaluation** facility. Pass the function as an async callback, or evaluate `(<function text>)()`. It reads only rendered DOM and returns hashes, counts, source identifiers, and readiness flags. It does not read app globals or sign-in storage. Do not log or return the full `data-report-preview-context` attribute; that attribute also contains access-profile details.
7. Save just the returned JSON as `session-a/probe.json` and `session-b/probe.json` in a private ignored output directory. A `not_ready` result is an explicit incomplete check. Fix the visible selection/loading condition and capture again; never fabricate a receipt.

The probe compares the exact archive document key/version/SHA/effective time already associated with the rendered Reports panel, and checks that the visible source banner agrees. It intentionally does **not** compare actor IDs or authorization fingerprints. Current runtime does not expose its stored projection binding in DOM, so `projectionBinding` may be null. Keep the independently verified projection publication/readback receipt with this acceptance; do not read auth/storage to fill that field.

## Download the same report through normal buttons

In each session, without changing the scope or period:

1. Click **Download HTML** in the Weekly Leasing preview. Expected name: `weekly_leasing_report_YYYY-MM.html`.
2. Set **Action → Export CSV**, then click **Weekly Leasing Report · Export CSV** under **Run Selected Action**. Expected name: `weekly_leasing_report_YYYY-MM.csv`.
3. Set **Action → Export Excel**, then click **Weekly Leasing Report · Export Excel**. Expected name: `weekly_leasing_report_YYYY-MM.xls`.
4. Move each download into its respective private session directory without opening it in Excel. The current Excel export is an HTML table in an `.xls` wrapper. The comparison tool parses it as text and never executes formulas or scripts. It deliberately rejects binary XLS/XLSX input instead of pretending to compare it.
5. Capture the DOM probe again. The report/selection/source hashes should match the first capture in that session. The Action menu is deliberately excluded from the selection digest. If data changes between captures, repeat both sessions once from the same stable source; retain and report the drift if it persists.

HTML is the report artifact for this check. PDF printer timestamps, layout, fonts, and pagination are not compared. If printed PDF is required, separately inspect the same selected report; do not label HTML parity as a PDF verification.

## Offline semantic comparison

From the repository root, supplying real **local paths** and the already verified current parent archive identity:

```sh
python3 tools/performance/compare-report-exports.py \
  --probe-a /private/output/session-a/probe.json \
  --probe-b /private/output/session-b/probe.json \
  --html-a /private/output/session-a/weekly_leasing_report_YYYY-MM.html \
  --html-b /private/output/session-b/weekly_leasing_report_YYYY-MM.html \
  --csv-a /private/output/session-a/weekly_leasing_report_YYYY-MM.csv \
  --csv-b /private/output/session-b/weekly_leasing_report_YYYY-MM.csv \
  --excel-a /private/output/session-a/weekly_leasing_report_YYYY-MM.xls \
  --excel-b /private/output/session-b/weekly_leasing_report_YYYY-MM.xls \
  --archive-hash EXPECTED_64_HEX_PARENT_ARCHIVE_SHA \
  --version EXPECTED_PARENT_VERSION \
  > /private/output/two-session-report-result.json
```

Use restrictive permissions for the private output directory and retain the original downloads. The tool outputs only hashes, dimensions and match flags, never resident/professional names, IDs, source rows, financial values, file paths, or credentials. It performs no network requests or writes to ATLAS. An exit status of 0 means the paired observed content matches; 1 means mismatched content or local-change review is required; 2 means the input contract was not met.

Compared evidence:

- Exact expected parent archive identity, report period/week, selection hash, runtime script identities, rendered cards/tables/text/source notes.
- Complete downloaded HTML body text and ordered table cells, including closed application details.
- Ordered CSV and Excel rows across sessions **and CSV-to-Excel equality within each session**.
- Downloaded HTML text/tables against the displayed DOM hashes within each session.
- Zeros, negative strings, empty cells, unavailable labels, embedded commas/quotes, all source dates and references remain distinct. No numeric coercion, row sorting, whole-column exclusion, or missing-to-zero substitution occurs.
- Only the exact ISO **Generated** timestamp at the beginning of the report footer is replaced for comparison. Source-through dates and revision references are retained. HTML entities and displayed whitespace are normalized.

A pre-existing local-change warning prevents a clean canonical-source claim even if hashes match. Report selections themselves can mark local preferences dirty; preserve the before-selection evidence and distinguish that known action from unexplained operational differences. A matching pair proves consistency for the captured read/export view, not correctness of every formula or any production write workflow.

Small credential-free tool validation (no browser):

```sh
python3 tools/performance/compare-report-exports.py --self-test
node --check tools/performance/two-session-report-probe.js
```

Implementation references: `workspace-core.js` functions `renderRisePortfolioLeasingWeeklyWorkspace`, `exportRisePortfolioLeasingWeeklyCSV`, `exportRisePortfolioLeasingWeeklyExcel`, `downloadRisePortfolioLeasingWeeklyHtml`; `weekly-leasing-report.js` shared model/rows/document; `features/reports-workspace.js` rendered preview context.
