# Scout Data Contract

## Purpose

This document defines the structured ATLAS payload Scout should receive in version one. The goal is to make Scout grounded, predictable, and testable.

Scout should answer from structured data blocks, not from raw UI scraping alone.

## V1 Product Scope

Scout v1 is optimized for:

- VP users
- Regional users
- portfolio performance
- community leasing performance
- investment portfolio performance

Scout's supported outputs in v1:

- summary
- variance explanation
- ranked attention list
- suggested next checks
- recommended actions
- follow-up talking points

## Contract Principles

- every request must include scope and period
- every answer must be traceable to source data
- freshness and confidence must be explicit
- ranking should use defined business logic, not ad hoc model judgment

## Top-Level Request Shape

```json
{
  "role": "vp | regional",
  "question_type": "summary | variance | ranking | next_steps | data_trust | briefing",
  "user_prompt": "Why is Baymeadows behind budget?",
  "scope": {
    "level": "portfolio | region | community | investment_portfolio",
    "portfolio_id": "rise_main",
    "region_id": "north_florida",
    "community_id": "baymeadows"
  },
  "period": {
    "current_label": "April 2026",
    "current_start": "2026-04-01",
    "current_end": "2026-04-30",
    "comparison_label": "March 2026",
    "comparison_start": "2026-03-01",
    "comparison_end": "2026-03-31"
  },
  "freshness": {
    "generated_at": "2026-05-12T12:00:00Z",
    "latest_import_at": "2026-04-30T17:29:00Z",
    "stale": false,
    "stale_reason": null
  },
  "sources": [],
  "metrics": {},
  "ops": {},
  "confidence": {},
  "exceptions": []
}
```

## Required Request Fields

### Role

Allowed values:

- `vp`
- `regional`

This controls answer compression, framing, and emphasis.

### Question Type

Allowed values:

- `summary`
- `variance`
- `ranking`
- `next_steps`
- `data_trust`
- `briefing`

### Scope

Required fields depend on the scope level.

Examples:

- portfolio
- region
- community
- investment_portfolio

At minimum, Scout must know what object the answer is about.

### Period

Required:

- current period
- comparison period

Scout should not infer time periods loosely in v1.

## Source Metadata Block

Scout needs the source record for trust and caveat handling.

```json
{
  "sources": [
    {
      "name": "monthly_upload",
      "label": "April Monthly Upload",
      "source_type": "monthly_upload",
      "imported_at": "2026-04-30T17:29:00Z",
      "authoritative_for": ["occupancy", "leased", "move_ins", "move_outs"],
      "stale": false
    },
    {
      "name": "renewal_tracker",
      "label": "Renewal Tracker April",
      "source_type": "renewal_tracker",
      "imported_at": "2026-04-30T16:10:00Z",
      "authoritative_for": ["renewal_expirations", "renewal_signed", "renewal_ntv"],
      "stale": false
    }
  ]
}
```

## Metrics Block

### Community Or Portfolio Leasing Metrics

```json
{
  "metrics": {
    "leasing": {
      "occupancy_pct": 91.4,
      "occupancy_budget_pct": 94.0,
      "occupancy_prior_pct": 92.7,
      "leased_pct": 93.1,
      "leased_budget_pct": 94.8,
      "leased_prior_pct": 93.5,
      "occupied_units": 274,
      "leased_units": 279,
      "total_units": 300,
      "corporate_units": 0,
      "move_ins": 9,
      "move_outs": 14,
      "guest_cards": 52,
      "tours": 24,
      "applications": 16,
      "applications_approved": 11,
      "leases_signed": 8,
      "denied": 2,
      "cancelled": 1,
      "pending_decision": 2
    }
  }
}
```

### Renewal Metrics

```json
{
  "metrics": {
    "renewals": {
      "expirations": 18,
      "signed": 9,
      "ntv": 4,
      "transfers": 1,
      "undecided": 3,
      "early_termination": 1,
      "retention_rate": 50.0
    }
  }
}
```

### Financial / Investment Portfolio Metrics

```json
{
  "metrics": {
    "financial": {
      "noi_actual": 1240000,
      "noi_budget": 1315000,
      "noi_variance": -75000,
      "projected_noi": 1275000,
      "projected_gap": -40000,
      "revenue_actual": 2125000,
      "revenue_budget": 2190000,
      "expense_actual": 885000,
      "expense_budget": 875000,
      "delinquency_pct": 3.8,
      "bad_debt": 24000
    }
  }
}
```

### Resident Experience / Reputation Metrics

```json
{
  "metrics": {
    "resident_experience": {
      "sentiment_score": 72,
      "survey_response_rate": 18.5,
      "negative_trend_flag": false,
      "top_issue_tags": ["maintenance_timing", "communication"]
    }
  }
}
```

### Staffing / Operations Metrics

```json
{
  "metrics": {
    "operations": {
      "open_roles": 1,
      "staffing_efficiency_score": 68,
      "turns_per_100": 11.4,
      "open_work_orders_per_100": 7.2,
      "compliance_flag_count": 2,
      "vendor_performance_score": 61,
      "automation_opportunity_score": 74
    }
  }
}
```

## OPS Block

Scout should not calculate ranking from scratch inside the language layer if avoidable. ATLAS should prepare an `ops` block with normalized sub-scores and the final score.

```json
{
  "ops": {
    "operational_priority_score": 78,
    "band": "high",
    "drivers": [
      "occupancy_risk",
      "revenue_risk",
      "renewal_exposure"
    ],
    "subscores": {
      "revenue_risk": 82,
      "occupancy_risk": 88,
      "resident_experience_risk": 49,
      "compliance_exposure": 55,
      "staffing_strain": 41,
      "asset_trajectory": 73,
      "lease_up_risk": 64,
      "delinquency_risk": 58,
      "staffing_efficiency_risk": 39,
      "resident_sentiment_risk": 44,
      "automation_opportunity": 71,
      "vendor_performance_risk": 52,
      "noi_impact_risk": 77
    }
  }
}
```

## Confidence Block

Scout needs explicit confidence signals.

```json
{
  "confidence": {
    "overall": "high | medium | low",
    "occupancy_confidence": "high",
    "funnel_confidence": "high",
    "renewal_confidence": "medium",
    "financial_confidence": "medium",
    "reason": "Cancellation detail is incomplete in the current monthly upload."
  }
}
```

## Exceptions Block

Use this block to tell Scout what is missing or suspect.

```json
{
  "exceptions": [
    {
      "type": "missing_field",
      "field": "cancelled",
      "severity": "medium",
      "message": "Cancellation detail was incomplete in this import."
    },
    {
      "type": "stale_source",
      "field": "resident_experience",
      "severity": "low",
      "message": "aptIQ survey data is 21 days older than leasing data."
    }
  ]
}
```

## Minimum Contract By Question Type

### Summary

Required:

- role
- scope
- period
- leasing metrics
- budget comparisons
- freshness
- top exceptions

### Variance

Required:

- summary contract
- prior period comparison
- relevant financial or renewal block if applicable
- confidence block

### Ranking

Required:

- same-period metrics for all items in scope
- OPS for each item
- ranking rationale block

### Next Steps

Required:

- variance signals
- funnel block
- renewal exposure
- exceptions
- role

### Data Trust

Required:

- sources block
- freshness block
- exceptions block
- sync flags

### Briefing

Required:

- summary contract
- variance insights
- ranking insight if relevant
- role-specific framing

## Initial OPS Recommendation

For v1, OPS should be prepared outside the model and passed in.

Recommended first weighting model:

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

This is only a starting model. It should be tuned with operating feedback after review sessions.

## What Still Needs To Be Defined

Before implementation, ATLAS still needs:

- the exact formula for OPS sub-scores
- source precedence when trusted data conflicts
- timeframe default when the user omits dates
- thresholds for stale data
- role default answer length
- the canonical IDs for communities, portfolios, and regions

## Recommended Next Build Step

After this contract, the next step should be:

- define `scout-ops-scoring-spec.md`
- define example prompts and outputs by question type
- wire the contract to the ATLAS UI layer
