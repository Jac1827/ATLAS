# Budget Builder v2 — 4 November 2026

The ATLAS Budget tab now opens **Budget Builder v2** (`portfolio-operations-dashboard/RISE-Budget-Builder-v2.html`). The classic builder is still available for month-end close, reforecast review, STR programmes, reports and exports: use **Close & reports** in the header. Deep links (`atlasView=…`) and approval-task navigation are forwarded to it automatically.

## What it does

| Area | Behavior |
|---|---|
| Asset classes | Conventional, townhome, student by bed, student by apartment, manufactured housing (per pad), military (expense-only; BAH by pay grade shown as a memo excluded from NOI). |
| Sources | Vena Budget Report or budget model "Import Sheet" (existing budget to work from), Entrata T12 (xlsx or the monthly financial package PDF), Box Score, Trending Occupancy, Conservice projections, contracts/proposals (PDF, DOCX). Read in the browser; only the budget is saved. |
| Three ways to start | **Existing budget** (Vena Budget Report or Import Sheet), **T12 & reports** (model suggestions), or **From scratch**: enter the community name (or add a community not yet in ATLAS), asset class, units, address, market rent and operating / lease-up status. ATLAS suggests staffing, a leasing schedule and every line on the RISE chart of accounts (per-unit planning assumptions adjusted by state and asset class; RISE portfolio medians replace them where at least three communities report). Each line shows how it was suggested, and drivers move them like an imported budget. |
| Linked drivers | Every GL is driven by the leasing schedule, payroll positions or an assumption: vacancy, fee income, turnover, utilities (Conservice rates × occupied/vacant units), leasing bonuses, payroll taxes and the management fee recalculate on every change. Contracts and fixed lines hold their amounts. Lines from an uploaded budget equal it exactly until a driver moves. |
| Short-term rental | An STR programme inside the budget (**Short-term rental** tab), built floor plan by floor plan: units converted, units already live, conversion month and ramp, take-back month, nightly rate or rate multiple, occupancy adjustment, stay length, cleaning fee and furnishing per plan. Programme drivers match the classic STR Builder (seasonality, channel mix and commissions, resort/parking/pet fees and which channels can collect them, discounts, refunds, card fees, lodging tax base, STR management fee, turn and per-unit costs, utility intensity, licence night caps); a saved STR programme workbook can be imported to start from its drivers. |
| STR in the property budget | STR units leave the long-term pool, so long-term occupancy, move-ins/outs, vacancy, resident fees and utilities scale to the remaining units; converted units' rent posts as contra income (5220); STR income, deductions, expenses and furnishing capital post to their GLs (editable). Shared GLs show "incl. STR". Three views reconcile exactly: property without STR + programme effect = property incl. STR, which is what is approved and published. The programme can also be shown on its own without posting. The investor package includes a programme table. |
| Learning model | Run-rates per occupied unit, move-in, move-out and salary dollar from the T12; seasonality from Trending Occupancy; loss to lease from the box score; utility rates from Conservice; portfolio medians per unit by category (aggregate-only, ≥3 communities); per-GL calibration from reviewers' final-vs-model decisions. Every suggestion appears beside the budget with **Use model**. |
| Checks | Lines over ±10% and $1,000 vs T12 without a note; positions in T12 but missing from the budget; water and sewer increases added together; large model differences; partial-period T12 uploads (annualized and flagged). |
| Notes | A regional note on every GL (site comments from the Vena file are imported) with an **Investor** checkbox that puts the note in the investor package. |
| Reforecast | Months covered by the uploaded T12 are closed and lock to actuals; remaining months re-project from drivers. |
| Approval | GM draft → Regional review → VP approval. VP approval renders the GL × month result as a workbook and runs the existing governed lifecycle (evidence, registry, import, submit, `vp_approve`), so Financial Position, Bonus, Community Command and exports read the same fingerprinted publication as before. |
| VP edits | The VP can edit a locked budget in place with a logged reason; it is flagged "Revised" and the investor package is blocked until the VP re-approves, which republishes it as a revised budget against the approved original. |
| Investor package | Cover page, summary, expense categories, assumptions and selected notes. Download as PDF, or email (VP) through `/api/atlas/budget-investor/email`; the Worker renders the PDF from the VP-locked summary and records the delivery. |

## RISE company budget

**RISE company budget** in the Budget Builder header (VP and the designated executive approver only) builds and tracks the RISE Residential, LLC budget.

| Area | Behavior |
|---|---|
| Sources | Entrata "Income Statement - Budget vs Actual" for RISE Residential, LLC (any months). The latest report gives each line's prior annual budget and year-to-date run rate; every report is also saved as that month's actuals and comments. |
| Fee income | One line per property (41xx). Linked lines follow the property's management fee (GL 6320) from its approved budget, else its latest Budget Builder draft (months outside the property's fiscal year use its average). Share %, monthly minimum, flat amounts, monthly schedules (lease-up fees, new projects) and start/end months for new and ending management. |
| Payroll | Positions roll up to 6100; taxes and benefits are a % of salaries; bonuses are a % of salaries paid in chosen months. |
| Other lines | Annual amount with growth, monthly schedule, % of salaries, or overhead allocation (88xx: a % of its section, posted as a credit). |
| Approval | VP draft → executive review → approved and locked. The approver is designated by email, must be a different person from whoever prepared or last revised the budget, and can return it with a reason. VP edits after approval need a reason and are re-approved. Reforecasts lock months that have actuals. |
| Monthly tracking | Upload the month's Budget vs Actual: month, year to date, annual budget and forecast (YTD actual + rest of year's budget) by GL against the approved ATLAS budget (or Entrata's budget for a year without one). Entrata comments are kept; lines over ±10% and $1,000 (month or YTD) need a comment before the month is marked reviewed. Lines where Entrata's budget differs from ATLAS are flagged. Download the month as a workbook. |

Migrations: `supabase/migrations/20261106130000_budget_builder_new_community.sql` (VP-only `atlas_budget_builder_create_community`) and `supabase/migrations/20261106120000_rise_company_budget.sql` (three tables, RLS limited to the VP and designated approvers, RPCs `atlas_company_budget_save`, `_transition`, `_month_save`, `_set_approver`, `_my_role`). Tests: `node tools/company-budget.test.mjs`, `node tools/company-budget-db.test.cjs`.

## Deployment

1. Apply `supabase/migrations/20261104200000_budget_builder_v2.sql` after the existing chain. It adds four tables (drafts, events, learning observations, investor deliveries), RLS read policies via `reforecast_access`, and the RPCs `atlas_budget_builder_save`, `atlas_budget_builder_transition`, `atlas_budget_learning_record`, `atlas_budget_benchmarks`, `atlas_claim_budget_investor_delivery` and the service-only `atlas_finish_budget_investor_delivery`. No existing table or function is changed.
2. Deploy the Worker (`src/worker.mjs` registers the investor email route; it uses the existing `EMAIL` binding and `ATLAS_DLR_FROM_EMAIL`).
3. Publish the site. `atlas-mounts.js` points the Budget tab at v2.

## Tests

- `node tools/budget-builder-v2.test.mjs` — importers, contract terms, drivers, payroll, reforecast actuals, military memo, learning, workbook rendering, investor PDF.
- `node tools/budget-builder-v2-str.test.mjs` — STR floor-plan engine, ramp and capital, property integration and the three views, publication rows, investor table, saved-programme import.
- `node tools/budget-builder-v2-db.test.cjs` — the real migration chain in PGlite: workflow and role gates, idempotent saves, governed initial-budget publication equal to the builder, VP edit (adding an STR programme) → revised-budget republish carrying the STR GLs exactly, investor delivery claims, learning, access control.

## Production acceptance still required

- Run the migration and Worker in a staging project; exercise GM, Regional and VP accounts on one real community.
- Confirm the VP publication appears in Financial Position, Bonus and Community Command.
- Send one investor package to an internal address before external recipients.
