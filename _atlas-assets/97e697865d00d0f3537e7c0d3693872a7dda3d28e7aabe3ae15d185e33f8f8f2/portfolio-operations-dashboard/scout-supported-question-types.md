# Scout Supported Question Types

## Purpose

This document defines the first supported question types for Scout inside ATLAS. The goal is to start with questions that are high-value, grounded in current ATLAS data, and realistic to answer well before expanding into broader conversational behavior.

Scout should begin with a narrow, trusted set of question types. The first version should optimize for:

- high operator value
- strong data grounding
- low hallucination risk
- clear recommended actions

## How To Begin

Start with question types that ATLAS can already support from structured data. Do not begin with open-ended "ask me anything" behavior.

The first release should answer:

1. what changed
2. why this community is ahead or behind
3. which communities need attention
4. what to focus on next
5. what data is missing, stale, or inconsistent
6. summarize this community or portfolio for a specific role

This gives Scout a focused operating job before expanding into deeper diagnostics or workflow automation.

## Phase 1 Supported Question Types

### 1. Performance Summary

Questions Scout should support:

- "What changed this month?"
- "Summarize this community."
- "Summarize the portfolio."
- "Give me the April update for Baymeadows."

What Scout should return:

- current-state summary
- major movement versus prior period
- major movement versus target or budget
- top one to three drivers
- next focus areas

Required data:

- scope: portfolio, region, or community
- selected period
- comparison period
- occupancy
- leased percentage
- move-ins
- move-outs
- tours
- applications
- approvals
- leases signed
- renewal metrics if relevant
- budget targets
- data freshness

### 2. Variance Explanation

Questions Scout should support:

- "Why is Baymeadows behind budget?"
- "Why is Citrus Ridge ahead of target?"
- "Why did occupancy fall this month?"
- "Why is NOI off plan?"

What Scout should return:

- the specific variance
- the most likely drivers visible in ATLAS
- whether the variance is operational, leasing, financial, or mixed
- what to check next
- what cannot be confirmed from current data

Required data:

- actual versus budget
- actual versus prior period
- occupancy base logic
- leasing funnel metrics
- renewal metrics
- delinquency or financial data when relevant
- source import timestamps
- exception flags or missing fields

### 3. Prioritization And Ranking

Questions Scout should support:

- "Which communities need the most attention this week?"
- "What are the top three risks in the portfolio?"
- "Where should my Regional focus first?"
- "Rank the communities by operational risk."

What Scout should return:

- ranked list
- the reason each item is on the list
- the specific metric or condition driving the ranking
- what action to take first

Required data:

- all communities in scope
- current actuals
- target or budget
- trend direction
- leasing funnel health
- renewal risk
- delinquency or NOI risk if included
- business rules for ranking

Important note:

Ranking requires explicit scoring rules. Scout should not improvise ranking logic. ATLAS needs a defined rule set for how to weight occupancy gaps, leasing weakness, renewal exposure, and financial pressure.

### 4. Recommended Next Actions

Questions Scout should support:

- "What should I focus on next?"
- "What should the site team do this week?"
- "What should the Regional review tomorrow?"
- "What actions would help close this occupancy gap?"

What Scout should return:

- a short action list
- the reason each action matters
- which metric or risk each action is tied to
- any blockers or missing confirmations

Required data:

- current pipeline
- pending applications
- scheduled tours if available
- renewal expirations and signed renewals
- move-out exposure
- staffing or task data if available
- user role

Important note:

Scout's recommendations should be tethered to visible ATLAS conditions. If ATLAS does not contain staffing, pricing, or lead-quality data, Scout should not pretend to diagnose those as confirmed causes.

### 5. Data Trust And Quality Checks

Questions Scout should support:

- "What in this data should I be careful with?"
- "Is anything missing from this import?"
- "What can't we confirm from the current data?"
- "Does this dashboard look stale or out of sync?"

What Scout should return:

- missing fields
- stale imports
- source/dashboard mismatches
- low-confidence conclusions
- recommended validation steps

Required data:

- import timestamps
- source file labels
- sync status
- null or incomplete field checks
- exception logs
- known source/dashboard drift flags

### 6. Role-Based Briefing

Questions Scout should support:

- "Summarize this for a VP."
- "Summarize this for a Regional."
- "Summarize this for the site team."
- "Give me the analyst version."

What Scout should return:

- same facts
- different framing depending on role
- same honesty standard
- same recommended next actions adapted for the audience

Required data:

- user role
- scope
- selected time period
- supporting metrics
- confidence or caveat metadata

## Phase 2 Question Types

These are strong next candidates after Phase 1 is stable.

### Trend Analysis

- "What trend has changed over the last three months?"
- "Is this getting better or worse?"
- "What changed since last review?"

### Comparative Analysis

- "How does Baymeadows compare to Sereno?"
- "Which communities are outperforming peers?"
- "Compare Region A to Region B."

### Root-Cause Narrowing

- "Is this mainly a move-out problem or a conversion problem?"
- "Is the issue renewals, traffic, or approvals?"

### Meeting Prep

- "Prep me for my Baymeadows call."
- "What should I ask this team tomorrow?"

### Narrative Export

- "Turn this into a board summary."
- "Write a Regional recap."
- "Draft talking points for the VP review."

## Phase 3 Question Types

These should wait until Scout is trusted and the data layer is richer.

- workflow execution
- proactive alerts
- cross-report investigation
- multi-step scenario analysis
- recommendation memory across sessions

Examples:

- "Create a follow-up plan for Baymeadows."
- "Watch these five communities and alert me when they slip."
- "Prepare next week's portfolio risk review."

## Response Rules By Question Type

### Summary Questions

Scout should emphasize:

- what changed
- current status
- key drivers
- next focus

### Variance Questions

Scout should emphasize:

- actual versus target
- the likely drivers visible in ATLAS
- confidence level
- what to verify next

### Ranking Questions

Scout should emphasize:

- the ranking logic
- why each item is ranked there
- which items require immediate attention

### Action Questions

Scout should emphasize:

- concrete next moves
- linkage to ATLAS metrics
- time horizon
- blockers

### Data Trust Questions

Scout should emphasize:

- what is missing
- what may be stale
- what is confirmed
- what should be validated manually

## Information Needed From The User

To finalize Scout's supported question set, the most important decisions needed are:

### 1. Initial Audience Priority

Who is Scout for first?

Choose the primary launch audience:

- VP / executive
- Regional leaders
- on-site teams
- analysts

Why this matters:

The first audience determines the tone, answer length, and highest-value question types.

### 2. Initial Scope Priority

What should Scout cover first?

Pick one starting scope:

- portfolio only
- portfolio plus community
- leasing only
- leasing plus financial
- full ATLAS operations

Why this matters:

A narrower first scope will make Scout more accurate and easier to trust.

### 3. Ranking Logic

How should Scout decide which communities "need attention"?

We need your operating logic for weighting items like:

- occupancy gap
- leased gap
- move-out exposure
- conversion weakness
- renewal risk
- delinquency
- NOI variance

Why this matters:

Without defined business weighting, Scout can summarize risk but should not claim a ranked priority list.

### 4. Data Trust Sources

Which ATLAS data sources should count as authoritative in version one?

Examples:

- monthly upload
- trending occupancy
- box score
- renewal tracker
- financial accountability inputs

Why this matters:

Scout needs a source-of-truth hierarchy when data conflicts.

### 5. Timeframe Defaults

How should Scout answer by default when the user does not specify a period?

Examples:

- current month
- latest import
- trailing 30 days
- month over month

Why this matters:

A lot of assistant confusion comes from unclear time scope.

### 6. Recommendation Boundaries

How far should Scout go with recommendations?

Possible boundaries:

- summarize only
- summarize plus suggest next checks
- recommend next actions
- recommend actions and draft follow-up talking points

Why this matters:

This controls how "operator-like" Scout is allowed to be in version one.

## Minimum Answers Needed From The User

If we want to move fast, the minimum decisions needed from you are:

1. who Scout serves first
2. what ATLAS area Scout covers first
3. how you want risk ranking to work
4. which data sources are most trusted
5. how far Scout is allowed to go in recommendations

## Recommended Starting Point

Recommended v1 launch:

- audience: Regional leaders
- scope: portfolio plus community leasing performance
- question types:
  - performance summary
  - variance explanation
  - prioritization and ranking
  - recommended next actions
  - data trust checks
- recommendation boundary: recommend next actions, but not automate tasks yet

Why this is the best start:

- high operator value
- strong fit with current ATLAS data
- avoids overreaching into unsupported areas
- gives Scout a clear operating identity

## Next Artifact To Build

After this document, the next step should be:

`scout-data-contract.md`

That file should define the exact ATLAS payload Scout receives for each supported question type, including:

- scope
- dates
- metric blocks
- freshness metadata
- role
- confidence flags
- source labels
