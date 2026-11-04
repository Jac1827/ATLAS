# Budget Builder v2 — 4 November 2026

The ATLAS Budget tab now opens **Budget Builder v2** (`portfolio-operations-dashboard/RISE-Budget-Builder-v2.html`). The classic builder is still available for month-end close, reforecast review, STR programmes, reports and exports: use **Close & reports** in the header. Deep links (`atlasView=…`) and approval-task navigation are forwarded to it automatically.

## What it does

| Area | Behavior |
|---|---|
| Asset classes | Conventional, townhome, student by bed, student by apartment, manufactured housing (per pad), military (expense-only; BAH by pay grade shown as a memo excluded from NOI). |
| Sources | Vena Budget Report or budget model "Import Sheet" (existing budget to work from), Entrata T12 (xlsx or the monthly financial package PDF), Box Score, Trending Occupancy, Conservice projections, contracts/proposals (PDF, DOCX). Read in the browser; only the budget is saved. |
| Linked drivers | Every GL is driven by the leasing schedule, payroll positions or an assumption: vacancy, fee income, turnover, utilities (Conservice rates × occupied/vacant units), leasing bonuses, payroll taxes and the management fee recalculate on every change. Contracts and fixed lines hold their amounts. Lines from an uploaded budget equal it exactly until a driver moves. |
| Learning model | Run-rates per occupied unit, move-in, move-out and salary dollar from the T12; seasonality from Trending Occupancy; loss to lease from the box score; utility rates from Conservice; portfolio medians per unit by category (aggregate-only, ≥3 communities); per-GL calibration from reviewers' final-vs-model decisions. Every suggestion appears beside the budget with **Use model**. |
| Checks | Lines over ±10% and $1,000 vs T12 without a note; positions in T12 but missing from the budget; water and sewer increases added together; large model differences; partial-period T12 uploads (annualized and flagged). |
| Notes | A regional note on every GL (site comments from the Vena file are imported) with an **Investor** checkbox that puts the note in the investor package. |
| Reforecast | Months covered by the uploaded T12 are closed and lock to actuals; remaining months re-project from drivers. |
| Approval | GM draft → Regional review → VP approval. VP approval renders the GL × month result as a workbook and runs the existing governed lifecycle (evidence, registry, import, submit, `vp_approve`), so Financial Position, Bonus, Community Command and exports read the same fingerprinted publication as before. |
| VP edits | The VP can edit a locked budget in place with a logged reason; it is flagged "Revised" and the investor package is blocked until the VP re-approves, which republishes it as a revised budget against the approved original. |
| Investor package | Cover page, summary, expense categories, assumptions and selected notes. Download as PDF, or email (VP) through `/api/atlas/budget-investor/email`; the Worker renders the PDF from the VP-locked summary and records the delivery. |

## Deployment

1. Apply `supabase/migrations/20261104200000_budget_builder_v2.sql` after the existing chain. It adds four tables (drafts, events, learning observations, investor deliveries), RLS read policies via `reforecast_access`, and the RPCs `atlas_budget_builder_save`, `atlas_budget_builder_transition`, `atlas_budget_learning_record`, `atlas_budget_benchmarks`, `atlas_claim_budget_investor_delivery` and the service-only `atlas_finish_budget_investor_delivery`. No existing table or function is changed.
2. Deploy the Worker (`src/worker.mjs` registers the investor email route; it uses the existing `EMAIL` binding and `ATLAS_DLR_FROM_EMAIL`).
3. Publish the site. `atlas-mounts.js` points the Budget tab at v2.

## Tests

- `node tools/budget-builder-v2.test.mjs` — importers, contract terms, drivers, payroll, reforecast actuals, military memo, learning, workbook rendering, investor PDF.
- `node tools/budget-builder-v2-db.test.cjs` — the real migration chain in PGlite: workflow and role gates, idempotent saves, governed initial-budget publication equal to the builder, VP edit → revised-budget republish, investor delivery claims, learning, access control.

## Production acceptance still required

- Run the migration and Worker in a staging project; exercise GM, Regional and VP accounts on one real community.
- Confirm the VP publication appears in Financial Position, Bonus and Community Command.
- Send one investor package to an internal address before external recipients.
