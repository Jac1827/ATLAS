# Scout OPS Scoring Spec

## Purpose

This document defines the first scoring direction for Scout's Operational Priority Score (OPS). OPS is the ranking layer Scout should use to decide what "needs attention" and then explain that ranking in plain English.

Scout should not invent ranking logic at runtime. ATLAS should prepare OPS inputs and the final score, and Scout should interpret them.

## Version 1 Scoring Direction

Scout should weight revenue, occupancy, and NOI most heavily.

### V1 OPS Weights

- revenue risk: 24%
- occupancy risk: 24%
- NOI impact risk: 18%
- delinquency risk: 10%
- asset trajectory: 7%
- lease-up risk: 5%
- staffing efficiency risk: 3%
- automation opportunity: 2%
- vendor performance risk: 2%
- resident sentiment risk: 2%
- resident experience risk: 1%
- compliance exposure: 1%
- staffing strain: 1%

## Ranking Intent

This weighting model means Scout should prioritize:

1. revenue pressure
2. occupancy exposure
3. NOI impact
4. meaningful collection or delinquency stress
5. directional decline in the asset

This also means Scout should not over-rank communities simply because they have soft resident experience, compliance, or staffing indicators unless those issues are also affecting core performance risk.

## Score Interpretation Bands

Recommended initial bands:

- 85 to 100: critical
- 70 to 84: high
- 50 to 69: elevated
- 30 to 49: moderate
- 0 to 29: stable

These bands should drive how Scout describes urgency.

### Example language

- critical: "This is one of the highest-priority risks in the portfolio right now."
- high: "This needs near-term attention."
- elevated: "This is not the top issue, but it is material and should be monitored closely."
- moderate: "This is worth watching, but it is not a lead concern today."
- stable: "This area does not appear to be a current priority based on the available ATLAS data."

## Source Precedence

When trusted sources conflict, ATLAS should prefer:

1. Ronaldo Templates
2. monthly uploads
3. renewal tracker
4. marketing survey from aptIQ
5. manual inputs

Scout should surface the conflict when a lower-priority source disagrees materially with a higher-priority source.

Example:

"Ronaldo Template data and manual input do not match for this community's current occupancy target. I prioritized the Ronaldo Template value and treated the manual figure as secondary."

## Default Time Rule

If the user does not provide a period, Scout should default to:

- current month

When useful, Scout should compare:

- current month versus prior month
- current month versus current budget or target

## VP Framing Rule

For VP-facing responses, Scout should lead with:

- risk ranking first

Recommended answer order:

1. risk ranking
2. why the risk is elevated
3. expected business impact
4. next checks
5. suggested actions

## Regional Framing Rule

For Regional-facing responses, Scout should lead with:

1. which communities need attention first
2. what operational issue is driving the ranking
3. what to review next with the team
4. suggested talking points

## Scoring Notes

### Revenue Risk

Should reflect:

- revenue variance to target
- revenue trend deterioration
- rent or collections pressure where structured data exists

### Occupancy Risk

Should reflect:

- occupancy gap to budget
- occupancy trend deterioration
- upcoming move-out exposure not offset by current recovery pace

### NOI Impact Risk

Should reflect:

- NOI variance
- projected NOI gap
- expense overrun pressure where available

### Delinquency Risk

Should reflect:

- delinquency percentage
- bad debt trend
- portfolio exposure to uncollected revenue

### Asset Trajectory

Should reflect:

- whether the asset is improving or worsening over recent periods
- whether current leading indicators support recovery

### Lease-Up Risk

Should reflect:

- lease-up pace relative to target
- whether funnel activity is enough to close the gap

## What Still Needs Definition

Before engineering implementation, we still need:

- exact sub-score formulas
- normalization rules for each metric
- materiality thresholds for "conflict"
- missing-data penalties
- whether manual inputs can ever override Ronaldo Templates by explicit admin action

## Recommended Next Step

Next, define examples of:

- one community OPS payload
- one portfolio OPS payload
- one VP answer
- one Regional answer

That will let us test whether the scoring logic produces the kind of prioritization you actually want.
