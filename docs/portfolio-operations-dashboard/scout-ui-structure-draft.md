# Scout UI Structure Draft

## Goal

Translate the Scout product vision into a practical interface structure for ATLAS.

Scout should feel like an intelligence command layer, not a chat widget with a textbox at the bottom.

## Primary Layout

Recommended layout:

- top summary band
- left intelligence column
- right conversation / explanation column
- persistent action rail

## Section 1: Top Summary Band

Purpose:

- establish scope immediately
- show current risk state
- make freshness visible

Contents:

- current scope: portfolio, region, or community
- current period
- latest data refresh time
- overall risk band
- top one-line takeaway

Example:

- `Portfolio | April 2026`
- `Last updated: April 30, 2026 at 5:29 PM`
- `Risk level: High`
- `Top takeaway: Baymeadows and GKP are driving the largest current operating risk.`

## Section 2: Intelligence Column

Purpose:

- show proactive insight before the user asks anything

Recommended modules:

### Ranked Risks

- ordered list of the highest OPS items
- one-line reason for each

### What Changed

- three to five concise changes since prior period

### Watch Items

- leading indicators moving in the wrong direction
- stale or suspect data
- missing source inputs

### Opportunities

- assets with upside
- quick wins
- automation candidates

## Section 3: Explanation Column

Purpose:

- hold Scout's narrative response
- allow follow-up conversation

Default structure:

- summary card
- drivers card
- next checks card
- suggested actions card
- talking points card
- caveats / confidence card

This should map directly to Scout's default voice:

- here's what changed
- here's what is driving it
- here's where to focus next
- here's what I can't confirm from the current data

## Section 4: Action Rail

Purpose:

- connect intelligence to action

Examples:

- review this community
- compare to peers
- prepare VP summary
- prepare Regional talking points
- open source details
- create follow-up plan

Later versions:

- create task
- notify Regional
- open benchmark set
- approve automation

## Input Design

The input box should still exist, but it should not be the hero.

Recommended placeholder:

- `Ask Scout about risk, variance, priorities, or next steps`

Recommended starter prompts:

- `What changed this month?`
- `Which communities need attention?`
- `Why is Baymeadows behind budget?`
- `Summarize this for a VP`
- `What should I verify before tomorrow's review?`

## Behavioral Rules For The UI

### Before User Input

Scout should already show:

- top risks
- key changes
- current priorities
- data trust alerts

### After User Input

Scout should:

- preserve the ranked context
- answer in structured sections
- keep actions adjacent to the answer

### On Low Confidence

Scout should visibly label:

- low confidence
- stale inputs
- source conflict
- missing data

## Design Tone

Visual tone should be:

- crisp
- restrained
- premium
- analytical
- warm enough to feel guided, not cold

Avoid:

- cluttered enterprise tables as the first impression
- oversized decorative AI branding
- too many status colors competing at once
- generic chatbot bubbles as the primary experience

## V1 Interface Recommendation

For v1, build these blocks first:

1. summary band
2. ranked risks
3. Scout narrative response card
4. suggested next checks
5. suggested actions
6. follow-up talking points
7. question input

This gives Scout a visible operating identity on day one.

## V2 Interface Recommendation

Add:

- watchlists
- benchmark panel
- trend movement indicators
- exception feed
- role-specific briefing presets

## V3 Interface Recommendation

Add:

- automation queue
- approval prompts
- task routing
- notification controls
- execution history

## Strategic UI Principle

The most important rule:

Scout should make ATLAS feel like it is already thinking before the user types.
