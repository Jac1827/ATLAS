# Budget Builder staged release — September 21, 2026

## Delivered scope

Seven workflow destinations replace the dense directory while retaining all 27 existing tools. Context, source freshness, local save and unverified shared publication remain distinct. Existing approved budget values and calculation paths are preserved.

Actuals & Close now opens a lazy financial-package review. Native PDF.js extraction reads statement pages and stops before GL transaction appendices; full source-file hashes cover all bytes. XLSX conversion runs in a disposable worker and converts only comparison worksheets. Blank/zero/parenthetical-negative values and page/cell lineage are preserved. Image-only pages use a separately loaded local OCR worker and remain flagged for human verification. OCR performance/accuracy acceptance remains pending.

The parser classifies Balance Sheet, Budget Comparison, Forecast, T12, Trial Balance, Cash Flow, GL Detail, invoice/supporting and unknown pages. Only posting GL rows from Budget Comparison become candidate actual rows; controls are retained separately. Income and NOI are recomputed from posting detail for month, YTD and annual-budget columns. These budget-reference columns **do not** create or replace an original approved Budget Builder scenario.

Shared intake uses `atlas_financial_package_reviews`, a community-scoped immutable review store. The authenticated RPC checks role, module locks, source alias, duplicate posting keys, bounded payloads and explicit missing values. It never grants close or publication authority to a client certificate. Saved review summaries are period-filtered and limited to 20; full certificates load on demand. Nine supplied PDF certificates were stored through the signed-in Admin browser and read back with matching source hashes. The Sereno XLSX is parity evidence, not a second actuals import. Source binary retention is not completed by certificate storage.

The existing financial publication RPC now permits only active Admin users. Its original fiscal/coverage validation remains behind a private function inaccessible to ordinary callers. Contract intake no longer invents missing GL 6520 or January/December effective dates. This correction does not complete governed Conservice contract approval.

## Reconciliation evidence

All ten supplied August 2026 packages pass extraction and posting-detail income/NOI arithmetic. Sereno PDF and XLSX match every posting GL across monthly actual/budget, YTD actual/budget and annual budget. Verified values:

| Metric | August actual | August budget |
|---|---:|---:|
| GPR (5120) | $637,731.00 | $630,471.85 |
| Total Income | $460,416.27 | $522,045.56 |
| NOI | $139,915.23 | $213,898.60 |

Sereno workbook references: GPR C11/D11; Total Income C54/D54; NOI C188/D188, worksheet `Budget Comparison Income stmt`. GPR is on PDF page 3; source references for other controls are retained in the private evidence. Income and NOI controls are compared to independently summed posting rows, not accepted solely from cached total cells.

Local Chrome 153 preview measurements: nine files approximately 0.7–1.4 seconds, St. Augustine approximately 4.6 seconds. Sereno parsed 17 statement/header pages of a 646-page package and excluded 629 transaction/supporting pages from ingestion. The local standalone Builder heap was about 16 MB after Sereno preview, but this is not authenticated whole-platform memory acceptance. Cancellation clears the preview and terminates workbook/PDF work. Sustained post-GC leak testing remains pending.

Automated validation: complete existing root suite plus parser and shared-review database tests (63 test files); separate ten-file private-fixture reconciliation runner; browser upload previews for all ten. RLS tests cover cross-community denial, module locks, anonymous denial, immutable rows, idempotent retry, unapproved alias rejection, zero/null preservation and prevention of client-side promotion. Publication tests cover non-Admin denial and inability to call the private implementation.

## Remaining acceptance work — release is not full completion

1. Durable source-file storage and hash readback; reviewed GL nature/hierarchy mappings; section/cash-flow and Trial Balance tie-out; percentage-variance policy at zero budget; approved fiscal-calendar validation. Current Ivy & Elm and Anthem House central classification conflicts with the approved owner classification. Do not resolve this by applying current inventory or an invented fiscal calendar to history.
2. Canonical financial versions and line storage, Admin close/reopen/replacement with immutable history, original-budget and reforecast isolation, source-file retention, reconciliation certificates and downstream acknowledgments. Review certificates are staging evidence, not the canonical closed ledger.
3. All-consumer read adapters and exact lineage through Budget Builder, Home, Community Command, Financial Review, Scout, Bonus and exports. Bonus must still receive closed, approved, plan/assignment/period-matched inputs and reject stale/reopened/unreconciled results. No payable Bonus result was created during this stage.
4. Full Conservice attestation, governed document storage, term-review queue, active/future pointer, immutable lifecycle history, alert scheduling and dynamic recipient routing. No direct Conservice integration is implied.
5. Two authorized users, independent-session readback, OCR accuracy, fiscal/cross-year close, source replacement, email/report parity, sustained memory and cold/warm production acceptance. Existing ambiguous report-delivery outcome must not be blindly retried.

All business decisions are approved in `financial-owner-decisions.md`. The list above is implementation/verification work, not a request to reapprove those decisions. Issues #9 and #12 remain open.

## Rollout and rollback

Deploy the reviewed UI/parser and additive review storage first. Review-only status is the rollout boundary; no package is automatically promoted to closed actuals. Apply the canonical close migration only after its reconciliation and permission tests pass, then activate one reviewed community/period before broad cutover.

Rollback application assets to prior main `c512a752ba7c5c7d90a5883fde0cb429d2c0fc81`. Retain the additive immutable review table and all recorded evidence; revoke review-save execution temporarily if needed. Do not drop records, restore over approved financial history or remove the Admin publication gate during a UI rollback. Prior closed/approved financial data was not modified by this release.

Security advisor review found no missing RLS on the new intake table. The scoped authenticated SECURITY DEFINER RPC is intentional and tested. Existing unrelated advisories include public execution of the access-change notification trigger function and disabled leaked-password protection; see the Supabase security advisor for separate remediation.
