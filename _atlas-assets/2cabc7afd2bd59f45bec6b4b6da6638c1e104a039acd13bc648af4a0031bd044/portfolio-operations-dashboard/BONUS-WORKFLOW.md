# Shared Bonus approval and payroll confirmation

The Bonus tab contains a shared workspace for canonical plan setup, explicit employee eligibility, quarterly calculation, review, approval, locking and external payroll confirmation. Browser-only plan drafts, overrides and period flags cannot approve or pay a shared result.

## Workflow

1. An authorized plan administrator saves the actual plan terms: role, communities, effective dates, fixed quarterly target, cap, financial metrics, weights and threshold curves. A People-authorized user explicitly confirms employee eligibility and its effective date. Nothing is seeded or inferred from job title.
2. A calculator selects the canonical assignment, saved plan and calendar quarter. The database recomputes every amount using all three governed monthly closes and verified effective baselines. Missing evidence, undefined zero-baseline attainment, overlapping assignments and incomplete eligibility prevent a payable result.
3. Submit the saved calculation for review. A different authorized reviewer approves it. A person linked to the beneficiary cannot approve, lock or record payment for their own Bonus. Changed source evidence requires recalculation and another review.
4. An authorized finalizer locks the approved result. The amount, plan, employee/assignment versions, monthly sources and review events remain retained. Locked or paid results cannot be reopened through this release.
5. After payroll has independently processed the payment, an authorized finalizer records its external reference, paid date and exact locked amount. This records evidence; ATLAS does not send money or submit payroll. Duplicate references and duplicate active employee-quarter calculations are rejected.

Each write requires a reason, expected revision and request identifier. Uncertain retries reuse the same request identifier, and failed or missing readback cannot be displayed as success. Current role, Bonus permissions, page restrictions and community scope govern both actions and reads. Request replay rechecks access. Original source history is preserved.

## Formula and supported plans

For each metric, sum the quarter's actual and effective-baseline values. Signed variance is actual minus baseline. Attainment is `100 + direction × variance / abs(baseline) × 100`, where expenses use direction −1 and revenue, NOI and cash flow use +1. Divide attainment by the plan goal and multiply by 100 to select the highest satisfied threshold. Metric payout is the quarterly target multiplied by its weight and threshold payout percentage, rounded to cents. Sum the metrics and apply the explicit maximum payout.

This release supports fixed-target, financial weighted scorecards with full-quarter eligibility. Salary-based plans, per-unit payouts, manual/discretionary overrides, partial-quarter proration and post-payment adjustments require a separately reviewed implementation. The UI exposes these limitations and leaves unsupported results unavailable. Source setup and real plan approval remain business decisions.

## Database release

- `20260924171402_bonus_workflow_completion.sql`: additive plan/eligibility setup, independently calculated results, workflow events, retained receipts and external payment confirmations; closes legacy caller-supplied payout/status and raw Bonus table access paths.
- `20260924172221_profile_access_hardening.sql`: prevents users from changing their own role, scope or access controls; preserves display-name/profile-image edits and administrator access management. Adds validated Bonus permissions with existing role defaults for empty permission lists.

The 72 historical migrations are pinned without alteration. The GitHub integration deploys new migrations from `main` with working directory `.`. Run the migration-history gate before merge. Historical SQL must never be rewritten or marked applied to bypass a failure. Automatic preview branching stays disabled pending the documented clean-environment prerequisite.

## Verification

The client, UI, legacy-handler integration, full-history database replay, profile security, calculation/workflow and rollback acceptance suites cover authorized paths and rejection cases. The browser UI suite uses synthetic responses and does not contact production. The database acceptance SQL in `tools/bonus-workflow-rollback.sql` uses real authenticated roles and synthetic quarter sources, then deliberately rolls back all fixtures before returning its result; the outer transaction also rolls back. Review and run the complete file in one call only after both migrations are installed.

Production release evidence records deployed commit, migration hashes, live acceptance result, signed-in read-only UI verification, and existing data preservation separately. No successful test authorizes real financial approvals or payments. Recovery must preserve audit records, locked calculations and external receipts; use a reviewed forward fix and compatible application assets.
