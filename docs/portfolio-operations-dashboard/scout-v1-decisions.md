# Scout V1 Decisions

## Decision Summary

These decisions reflect the current product direction for Scout inside ATLAS.

## 1. Primary Audience

Scout's initial audience is:

- VP users
- Regional users

Implications:

- answers must support both executive summary and operational follow-up
- default responses should be concise, ranked, and action-oriented
- Scout should support both portfolio-level and community-level framing

## 2. Initial Scope

Requested scope:

- full ATLAS operations
- portfolio performance
- individual community leasing performance
- investment portfolio performance

Implementation note:

This is the intended long-term scope. For launch quality, Scout should still be rolled out in layers so trust is built before broader expansion.

Recommended rollout:

### Launch Slice

- portfolio performance
- community leasing performance
- investment portfolio performance where structured metrics already exist

### Later Expansion

- broader operations workflows
- staffing-specific diagnostics
- resident experience deep dives
- automation opportunity recommendations
- vendor performance workflows

Reason:

The business scope is full ATLAS operations, but Scout will be more credible if the first answers come from the most structured and trusted operating data.

## 3. Ranking Logic

Scout should rank "needs attention" using an Operational Priority Score (OPS).

OPS is a composite score that combines:

- revenue risk
- occupancy risk
- resident experience risk
- compliance exposure
- staffing strain
- asset trajectory

For portfolio and investment portfolio use, attention ranking should also consider:

- lease-up risk
- occupancy exposure
- delinquency
- staffing efficiency
- resident sentiment
- automation opportunities
- vendor performance
- NOI impact

## 4. Trusted Data Sources

Initial trusted data sources:

- Ronaldo Templates
- monthly uploads
- marketing survey from aptIQ
- renewal tracker
- manual inputs

Implication:

Scout needs a source hierarchy and freshness model. If these sources conflict, Scout should identify the conflict and avoid false certainty.

Initial source precedence:

1. Ronaldo Templates
2. monthly uploads
3. renewal tracker
4. marketing survey from aptIQ
5. manual inputs

## 5. Recommendation Boundary

Scout is allowed to:

- summarize
- suggest next checks
- recommend actions
- draft follow-up talking points

Scout is not yet approved to:

- execute workflows automatically
- send communications automatically
- change data without user review

## 6. Product Standard

Scout should feel like:

- an executive operating assistant for VPs
- a prioritization partner for Regionals
- a grounded interpreter of ATLAS data

Scout should not feel like:

- a generic chat widget
- a broad "AI advisor" with weak evidence
- a workflow engine before the decision layer is trusted

## Launch Recommendation

Even with a full-ATLAS end state, the best V1 is:

- audience: VP and Regional
- scope: portfolio, community leasing, and investment portfolio performance
- outputs:
  - executive summary
  - variance explanation
  - ranked attention list
  - next checks
  - recommended actions
  - follow-up talking points

This creates a strong first release while preserving the path to wider ATLAS coverage later.

## 7. Default Time Logic

If the user does not specify a timeframe, Scout should default to:

- current month

Implication:

Scout should answer from the current month first, then compare to the prior month or current target when the question requires comparison.

## 8. VP Framing Rule

For VP-facing responses, Scout should lead with:

- risk ranking

Implication:

The top of the answer should identify which communities, portfolio segments, or investment areas carry the highest current risk before moving into detailed explanation.
