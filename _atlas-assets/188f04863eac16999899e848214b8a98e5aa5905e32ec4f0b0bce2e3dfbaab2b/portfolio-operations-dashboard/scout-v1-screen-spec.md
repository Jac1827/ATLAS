# Scout V1 Screen Specification

## Purpose

This document defines the first production screen for Scout inside ATLAS.

The goal of v1 is to make Scout feel like an intelligence layer, not a chat add-on. Users should understand current portfolio risk, what changed, and where to focus before they type a question.

## V1 Audience

- VP
- Regional

## V1 Scope

- portfolio performance
- individual community leasing performance
- investment portfolio performance where structured metrics already exist

## V1 Product Promise

When a user opens Scout, they should be able to answer these questions within seconds:

- where is the biggest risk right now
- what changed this month
- which communities need attention
- what should I review next
- what can I trust versus what needs validation

## Screen Layout

Recommended desktop layout:

- top summary band
- left intelligence column
- right explanation column
- bottom input composer

Recommended mobile layout:

- top summary band
- stacked intelligence cards
- narrative response card
- action cards
- input composer pinned near bottom

## Section 1: Top Summary Band

### Purpose

- establish context immediately
- communicate current risk state
- make freshness and trust visible

### Contents

- current scope label
- current time period
- latest refresh timestamp
- overall risk band
- top headline
- role badge

### Example Fields

- `Scope: Portfolio`
- `Period: April 2026`
- `Last refresh: April 30, 2026 at 5:29 PM`
- `Risk level: High`
- `Role view: VP`
- `Headline: Two communities account for most near-term leasing and NOI pressure.`

### Behavior

- headline should change based on role
- VP headline should lead with risk ranking
- Regional headline should lead with priority communities and operating focus
- if freshness is stale, show a visible warning state

## Section 2: Ranked Risk Panel

### Purpose

- give the user the portfolio priority order immediately

### Placement

- top of left column

### Module Title

- `Highest Priority Risks`

### Fields Per Row

- rank number
- community or portfolio segment
- OPS score
- risk band
- one-line reason
- trend direction

### Example Row

- `#1 Baymeadows`
- `OPS: 84`
- `Band: High`
- `Reason: Occupancy below target with weak near-term conversion recovery`
- `Trend: worsening`

### Behavior

- clicking a row should retarget the explanation column to that community
- hover or tap should reveal the top OPS drivers
- if ranking is based on partial data, show a confidence chip

## Section 3: What Changed Panel

### Purpose

- summarize the most important period-over-period changes

### Placement

- below ranked risks

### Module Title

- `What Changed`

### Contents

- three to five high-signal changes
- each line should contain metric, direction, scope, and relevance

### Example Items

- `Baymeadows occupancy fell 1.3 points month over month.`
- `GKP conversion weakened despite stronger tour volume.`
- `Portfolio delinquency improved slightly, but NOI pressure remains concentrated in two assets.`

### Behavior

- each item should be clickable and open the relevant explanation state

## Section 4: Watch Items Panel

### Purpose

- show issues that may not yet be top-ranked but still need attention

### Placement

- below What Changed

### Module Title

- `Watch Items`

### Contents

- stale data warnings
- source conflicts
- leading indicators deteriorating
- missing renewal or survey inputs

### Example Items

- `aptIQ survey data is older than April leasing data for three communities.`
- `Manual occupancy target differs from Ronaldo Template for Citrus Ridge.`
- `Renewal cancellation detail is incomplete in the latest import.`

## Section 5: Opportunity Panel

### Purpose

- balance the experience so Scout is not only negative

### Placement

- below Watch Items

### Module Title

- `Opportunities`

### Contents

- quick wins
- upside signals
- automation candidates
- outperforming assets worth benchmarking

### Example Items

- `Sereno is outperforming peers on conversion and may be a benchmark candidate for GKP.`
- `Two communities show strong traffic but slow application follow-up, making them automation candidates.`

## Section 6: Explanation Column

### Purpose

- give Scout's structured answer for the current selected scope

### Default Title

- `Scout Briefing`

### Default Structure

1. `What changed`
2. `What is driving it`
3. `Where to focus next`
4. `Suggested actions`
5. `Talking points`
6. `What I can't confirm`

### Behavior

- this panel should update when the user:
  - clicks a ranked risk
  - clicks a change item
  - submits a question
  - changes role or scope

### Tone Rule

- narrative should be concise, operational, and grounded
- no chat bubbles as the primary visual pattern
- use structured cards or stacked briefing sections instead

## Section 7: Suggested Actions Panel

### Purpose

- convert analysis into next moves

### Placement

- inside or directly below the explanation column

### Module Title

- `Suggested Actions`

### Item Structure

- action title
- why it matters
- linked metric or issue
- target audience

### Example Items

- `Review pending approvals at Baymeadows`
- `Confirm move-out exposure against current tour pace`
- `Benchmark GKP pricing and follow-up pace against Sereno`

## Section 8: Talking Points Panel

### Purpose

- support real operating meetings

### Module Title

- `Follow-Up Talking Points`

### Contents

- three to five bullets tailored to VP or Regional mode

### VP Example

- `Baymeadows and GKP are driving the highest current leasing risk.`
- `The portfolio issue is concentrated, not broad-based.`
- `The main near-term question is whether approved applications can close the current occupancy gap fast enough.`

### Regional Example

- `Review pending applications first, then compare move-out exposure against the next two weeks of tours.`
- `Ask whether the team is seeing a pricing issue, a follow-up issue, or an approval-speed issue.`

## Section 9: Trust And Confidence Panel

### Purpose

- preserve trust by showing data quality limits clearly

### Module Title

- `Confidence And Caveats`

### Contents

- overall confidence
- stale input warnings
- source conflicts
- missing field warnings
- sync concerns

### Example

- `Confidence: Medium`
- `Reason: cancellation detail is incomplete in the latest monthly upload`

## Section 10: Input Composer

### Purpose

- allow direct exploration without making chat the hero

### Placeholder

- `Ask Scout about risk, variance, priorities, or next steps`

### Starter Prompts

- `What changed this month?`
- `Which communities need attention first?`
- `Why is Baymeadows behind budget?`
- `Summarize this for a VP`
- `What should I verify before tomorrow's review?`

### Behavior

- submission should preserve the intelligence context already on screen
- the answer should appear in the explanation column, not as a detached message thread

## Primary Screen States

### State 1: Default Portfolio View

- scope = portfolio
- role = VP or Regional
- ranked risks visible
- change summary visible
- watch items visible
- explanation column shows portfolio briefing

### State 2: Community Drill-In

- triggered by clicking a ranked risk or change item
- explanation column retargets to community
- suggested actions become community-specific
- talking points shift to that asset

### State 3: Explicit User Question

- explanation column updates to answer the asked question
- surrounding risk context remains visible

### State 4: Low Confidence

- stale or conflicting inputs
- confidence panel becomes visually prominent
- recommendation language becomes more cautious

## Visual Hierarchy

Order of importance:

1. risk headline
2. ranked risks
3. selected briefing
4. suggested actions
5. trust warnings
6. question input

## Design Rules

- no oversized chat bubbles
- no decorative AI mascots in the core briefing area
- use compact cards with strong hierarchy
- highlight only the most important risks
- make scope and time unmistakable
- use caution colors sparingly

## V1 Must-Have Interactions

- switch role between VP and Regional
- switch scope between portfolio and community
- click ranked risk to drill in
- click changed item to drill in
- submit question to Scout
- expand confidence details

## V1 Success Criteria

V1 is working if a user can:

- identify the top portfolio risks in under 10 seconds
- understand why a community is ranked highly
- see the next checks and suggested actions
- trust what Scout can and cannot confirm

## Next Build Companion

After this spec, the next artifacts should be:

- sample VP dashboard state
- sample Regional dashboard state
- Scout V1 wireframe or mock layout
