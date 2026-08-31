# ATLAS Mobile Inspection, MORF, Chargeback, and Vendor Quality Architecture

## Purpose

This design extends the existing ATLAS Central Services workspace into a shared operational system:

Inspection -> Photos / Condition Documentation -> Chargeback Catalog -> Move-Out Processing -> MORF -> Statement of Deposit Accounting -> Accounting Handoff -> Resident Dispute Management -> Vendor Assignment -> Vendor Quality / Performance -> Reporting.

The implementation must not duplicate resident, property, employee, vendor, community, unit, or work-order sources when ATLAS already has those records.

## Existing Components To Reuse

- ATLAS Community Setup: property name, address, market, state inference, unit count, floor-plan context, active/inactive status, regional grouping.
- People roster and shared assignment graph: inspectors, reviewers, Central Services processors, regional managers, administrators, Legal/Compliance, maintenance employees.
- Central Services renewal import: resident-level renewal rows, NTV detection, move-out case creation, task creation, import history.
- Central Services move-out workspace: MOG status, inspection scheduling, accounting contacts, workflow history.
- Existing audit/history pattern: append-only local audit events today, central `atlas_audit_log` after hosted cutover.
- Maintenance/Moonrise imports: existing MSOE/SOE visibility and reporting context without replacing Moonrise.

## Existing Tables To Reuse

- `atlas_communities`
- `atlas_employees`
- `atlas_roles`
- Existing employee/community assignment tables
- `atlas_contracts` as an initial vendor-name source
- `atlas_maintenance_inspections`
- `atlas_audit_log`
- `atlas_app_documents`
- `atlas_app_document_versions`
- `atlas_mapping_log`
- `atlas_legacy_snapshots`

## New Tables Required

- Inspection: `atlas_inspection_templates`, `atlas_inspections`, `atlas_inspection_sections`, `atlas_inspection_findings`, `atlas_inspection_photos`, `atlas_photo_annotations`, `atlas_inspection_signatures`, `atlas_inspection_sync_events`.
- Chargebacks: `atlas_chargeback_catalog`, `atlas_chargeback_property_overrides`, `atlas_chargeback_market_multipliers`, `atlas_chargeback_useful_life_policies`, `atlas_resident_responsibility_reviews`, `atlas_morf_charges`.
- MORF and deposit accounting: `atlas_move_out_morfs`, `atlas_morf_ledger_lines`, `atlas_deposit_accounting_statements`, `atlas_statement_versions`, `atlas_statement_delivery_events`, `atlas_accounting_packet_attachments`.
- Compliance and disputes: `atlas_state_deposit_accounting_rules`, `atlas_accounting_routing_rules`, `atlas_resident_disputes`, `atlas_dispute_events`, `atlas_record_locks`.
- Vendor quality: `atlas_vendors`, `atlas_vendor_skills`, `atlas_vendor_property_preferences`, `atlas_vendor_assignments`, `atlas_vendor_score_events`, `atlas_vendor_infractions`, `atlas_vendor_feedback`.

## New Relationships Required

- Community -> Building -> Floor -> Unit -> Resident -> Lease -> Move-Out -> Inspection -> Findings.
- Finding -> Resident Responsibility Review -> Charge Recommendation -> MORF Charge -> Statement Line.
- Move-Out -> MORF -> Statement Version -> Accounting Packet -> Delivery Tracking -> Dispute.
- Finding -> Corrective Action -> Work Task -> In-house Employee or Vendor Assignment.
- Vendor -> Skills -> Assignments -> Work Orders -> Quality / Callback / Infraction / Resident Feedback score history.

## Proposed Inspection Object Model

An inspection should store template, property, location, building/floor/unit/common-area fields, inspector, resident-present state, rooms, findings, notes, photos, annotations, signatures, AI suggestions, inspector decisions, sync status, review status, related move-out ID, and audit history.

The model separates:

- Inspection finding: objective condition and evidence.
- Resident-responsibility determination: reviewed human decision that a finding may be resident-responsible.
- Financial charge: Central Services-reviewed amount inside MORF/deposit accounting.

## Proposed MORF Object Model

A MORF should store resident/lease references, community/unit, move-in/move-out/possession dates, primary and secondary forwarding addresses, MOG source/method/uploads/extracted fields, internal SLA due date, state legal deadline, assigned processor, approved inspection charges, deposits, credits, final rent, utilities, recurring charges, final calculation, packet selections, statement versions, delivery tracking, accounting handoff, dispute state, lock state, and audit history.

## Proposed Chargeback Catalog Model

Chargeback catalog records should store chargeback ID, category, item, description, portfolio standard cost, market ZIP multiplier, property override, labor component, material component, useful life, depreciation method, charge type, effective date, active flag, last updated, and updated by.

Pricing hierarchy:

Portfolio Standard Rate -> Market ZIP Code Multiplier -> Property Override.

Property overrides must not overwrite the portfolio master rate.

## Proposed Vendor Performance Model

Vendor records should store name, Entrata vendor code, active status, properties served, markets served, ZIP/service area, skills/trades, preferred property/vendor status, compliance status, insurance expiration, contact info, pricing agreements, work-order history, average response/completion time, open/completed work orders, warranty callbacks, repeat repairs, infractions, resident complaints, resident satisfaction, quality score, cost score, reliability score, compliance score, overall score, and score explanation.

Preferred status should be earned through configurable thresholds, with Admin override available and audited.

## Proposed State-Compliance Model

State compliance rules should store state, approved statutory wording, deposit-accounting deadline, calculation method, business/calendar-day rules, mailing rules, electronic delivery rules, certified-mail requirement, forwarding-address rules, documentation requirements, statute/reference, effective date, last reviewed date, reviewer, version, and active flag.

ATLAS must not invent statutory language or use one nationwide deposit-accounting deadline.

## Proposed Dispute And Version-Control Model

A dispute should link to the MORF, statement version, inspection, charge history, photos, approvals, correspondence, and delivery events. Each revision stores original amount, adjustment, reason, user, date, and date the resident was resent the statement. The final approved statement becomes Final Version - Locked.

Locked records require Admin/Legal reopening with reason and audit history.

## Offline Synchronization Architecture

Mobile inspections should store draft and submitted records locally with photos, notes, conditions, charges, signatures, corrective actions, vendor recommendations, and location information. Sync statuses are Saved Offline, Waiting to Sync, Syncing, Successfully Synced, and Sync Error - Action Required.

Deduplication should use a stable device inspection ID plus source inspection ID, record version, and updated timestamp. Server writes should be idempotent and append audit records instead of overwriting evidence.

## Entrata Integration Points

- Renewal export and future API source for resident, lease, unit, NTV, and move-out dates.
- Ledger future API source for deposit held, rent owed, utilities, pest control, internet, valet trash, Resident Shield, insurance, fees, credits, payments, and balances.
- Vendor codes and vendor status for normalized vendor profiles.
- Accounting handoff and statement delivery evidence as a future integration target.

Manual entry must remain available until each API feed is validated.

## Future Mobile API Requirements

- Template and library download.
- Property/building/floor/unit/common-area lookup.
- Inspection create/save/submit.
- Finding create/update.
- Photo upload with original/annotated versions.
- Signature capture.
- Offline sync queue and conflict resolution.
- MORF handoff and charge review.
- Corrective action and vendor/in-house assignment.
- AI suggestion ingestion with required human decision.

## Security And Privacy Considerations

- Photos, signatures, resident contact data, forwarding addresses, charge amounts, statements, and disputes are sensitive resident records.
- Role-based access should separate Site Team, Central Services, Regional, Admin/VP, Legal/Compliance, Maintenance, Vendor, and Accounting permissions.
- Resident-attended inspection copies must suppress predetermined, estimated, recommended, or standard dollar amounts.
- AI suggestions must never create financial charges without human review.
- Records affecting resident financial obligations require append-only audit history.
- Offline storage should be encrypted where supported and clear sync/error states should be visible to the user.

## Migration Risks

- Duplicate residents, units, vendors, or employees if source identifiers are not mapped first.
- Browser/local storage is not appropriate for large photo evidence long term.
- Offline sync can duplicate inspections without idempotent keys.
- Legal deadline/wording misconfiguration could create compliance risk.
- Whole-document browser sync can overwrite record-level changes until central tables are implemented.
- Property state inference from address needs validation before legal deadline automation.

## Recommended Phased Implementation

1. Phase 1 - Core Inspection: universal templates, room structures, photos, signatures, RISE reports, mobile-responsive workflow.
2. Phase 2 - Chargebacks: catalog, ZIP multipliers, property overrides, depreciation, photo requirements, audit trail.
3. Phase 3 - Move-Out / MORF: possession trigger, MORF queue, inspection charges, MOG integration, accounting handoff.
4. Phase 4 - Deposit Accounting: state configurations, resident statements, legal deadlines, certified mail, versions, locks.
5. Phase 5 - Vendors: skills, preferred status, recommendations, workload, quality scoring.
6. Phase 6 - AI Inspection: visual condition suggestions with human confirmation.
7. Phase 7 - Native Mobile: offline-first mobile app using the same records and APIs.
