-- Atlas centralized platform schema
-- Target runtime: Postgres/Supabase-compatible hosted database with Auth, RLS,
-- realtime replication, object storage, scheduled backups, and PITR.
--
-- Migration principle:
--   1. Never delete legacy source rows.
--   2. Store every source payload before mapping.
--   3. Map into canonical tables with original identifiers retained.
--   4. Use soft deletes and effective dates instead of destructive updates.
--   5. Reconcile counts/totals before promoting a migration phase.

create extension if not exists pgcrypto;

create table if not exists atlas_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  role text not null check (role in ('admin','executive','regional','community_manager','people','marketing','maintenance','finance','bonus','viewer')),
  status text not null default 'active' check (status in ('active','suspended','disabled')),
  allowed_community_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists atlas_audit_log (
  audit_id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_table text not null,
  entity_id text not null,
  source_module text,
  before_payload jsonb,
  after_payload jsonb,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists atlas_app_documents (
  document_id uuid primary key default gen_random_uuid(),
  document_key text not null unique,
  module_key text not null,
  payload jsonb not null default '{}',
  payload_hash text not null,
  version integer not null default 1,
  source_module text not null default 'atlas',
  source_hash text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (version > 0)
);

create table if not exists atlas_app_document_versions (
  document_version_id uuid primary key default gen_random_uuid(),
  document_id uuid not null references atlas_app_documents(document_id),
  document_key text not null,
  module_key text not null,
  version integer not null,
  payload jsonb not null,
  payload_hash text not null,
  source_module text not null default 'atlas',
  source_hash text,
  saved_by uuid references auth.users(id),
  saved_at timestamptz not null default now(),
  metadata jsonb not null default '{}',
  unique (document_id, version)
);

create table if not exists atlas_edit_locks (
  edit_lock_id uuid primary key default gen_random_uuid(),
  entity_table text not null,
  entity_id text not null,
  lock_owner uuid not null references auth.users(id),
  lock_reason text,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  released_at timestamptz,
  metadata jsonb not null default '{}',
  check (expires_at > locked_at)
);

create unique index if not exists idx_atlas_edit_locks_active
on atlas_edit_locks(entity_table, entity_id)
where released_at is null;

create table if not exists atlas_migration_runs (
  migration_run_id uuid primary key default gen_random_uuid(),
  phase text not null,
  source_module text not null,
  status text not null default 'draft' check (status in ('draft','snapshot_captured','dry_run','ready_for_review','approved','applied','rolled_back','blocked')),
  dry_run boolean not null default true,
  started_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  approved_at timestamptz,
  applied_at timestamptz,
  rollback_tested_at timestamptz,
  pre_counts jsonb not null default '{}',
  post_counts jsonb not null default '{}',
  pre_totals jsonb not null default '{}',
  post_totals jsonb not null default '{}',
  reconciliation_status text not null default 'not_started',
  exception_count integer not null default 0,
  notes text
);

create table if not exists atlas_legacy_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  migration_run_id uuid references atlas_migration_runs(migration_run_id),
  source_module text not null,
  source_key text not null,
  source_label text,
  source_version text,
  source_payload jsonb not null,
  source_hash text not null,
  captured_by uuid references auth.users(id),
  captured_at timestamptz not null default now(),
  read_only_locked boolean not null default true,
  unique (source_module, source_key, source_hash)
);

create table if not exists atlas_mapping_log (
  mapping_id uuid primary key default gen_random_uuid(),
  migration_run_id uuid references atlas_migration_runs(migration_run_id),
  source_module text not null,
  source_entity text not null,
  source_identifier text not null,
  source_name text,
  target_table text,
  target_id uuid,
  confidence numeric(5,2) not null default 0,
  decision text not null check (decision in ('mapped','not_mapped','manual_review','conflict','duplicate','skipped')),
  reason text,
  source_payload jsonb not null default '{}',
  mapped_payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists atlas_communities (
  community_id uuid primary key default gen_random_uuid(),
  legacy_codes text[] not null default '{}',
  canonical_name text not null unique,
  display_name text not null,
  status text not null default 'active' check (status in ('active','inactive','sold','development')),
  units integer,
  market text,
  owner_entity text,
  source_module text not null default 'atlas',
  source_identifier text,
  source_hash text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists atlas_community_aliases (
  alias_id uuid primary key default gen_random_uuid(),
  community_id uuid not null references atlas_communities(community_id),
  alias text not null,
  source_module text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists atlas_roles (
  role_id uuid primary key default gen_random_uuid(),
  role_code text not null unique,
  title text not null,
  bonus_role_type text check (bonus_role_type in ('gm','am','lm','lp','ms','mt')),
  source_module text not null default 'atlas',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists atlas_employees (
  employee_id uuid primary key default gen_random_uuid(),
  employee_number text,
  email text,
  full_name text not null,
  status text not null,
  status_type text,
  source_module text not null default 'people',
  source_identifier text,
  source_hash text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (employee_number),
  unique (email)
);

create table if not exists atlas_employee_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references atlas_employees(employee_id),
  community_id uuid references atlas_communities(community_id),
  role_id uuid references atlas_roles(role_id),
  title text not null,
  employment_status text not null,
  primary_assignment boolean not null default true,
  effective_start date not null,
  effective_end date,
  source_module text not null default 'people',
  source_identifier text,
  source_hash text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (effective_end is null or effective_end >= effective_start)
);

create table if not exists atlas_budget_lines (
  budget_line_id uuid primary key default gen_random_uuid(),
  community_id uuid not null references atlas_communities(community_id),
  period_key text not null,
  account_code text,
  account_name text,
  amount numeric(14,2) not null default 0,
  approved boolean not null default false,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  source_module text not null default 'budget',
  source_identifier text,
  source_hash text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists atlas_actual_lines (
  actual_line_id uuid primary key default gen_random_uuid(),
  community_id uuid not null references atlas_communities(community_id),
  period_key text not null,
  account_code text,
  account_name text,
  amount numeric(14,2) not null default 0,
  source_module text not null default 'finance',
  source_identifier text,
  source_hash text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists atlas_contracts (
  contract_id uuid primary key default gen_random_uuid(),
  community_id uuid references atlas_communities(community_id),
  vendor_name text not null,
  contract_type text,
  period_key text,
  start_date date,
  end_date date,
  amount numeric(14,2),
  status text not null default 'active',
  source_module text not null,
  source_identifier text,
  source_hash text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists atlas_marketing_metrics (
  marketing_metric_id uuid primary key default gen_random_uuid(),
  community_id uuid not null references atlas_communities(community_id),
  period_key text not null,
  metric_key text not null,
  metric_value numeric(14,4) not null,
  grain text not null check (grain in ('day','week','month','quarter','campaign','source')),
  approved boolean not null default false,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  source_module text not null default 'marketing',
  source_table text,
  source_identifier text,
  source_hash text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (community_id, period_key, metric_key, grain, source_identifier)
);

create table if not exists atlas_maintenance_metrics (
  maintenance_metric_id uuid primary key default gen_random_uuid(),
  community_id uuid not null references atlas_communities(community_id),
  week_ending date not null,
  metric_key text not null,
  metric_value numeric(14,4) not null,
  source_module text not null default 'maintenance',
  source_identifier text,
  source_hash text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (community_id, week_ending, metric_key, source_identifier)
);

create table if not exists atlas_moonrise_sync_runs (
  moonrise_sync_run_id uuid primary key default gen_random_uuid(),
  source_method text not null check (source_method in ('api','secure_export','database_replica')),
  status text not null default 'draft' check (status in ('draft','running','review_required','synced','blocked','rolled_back')),
  started_by uuid references auth.users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  reporting_periods text[] not null default '{}',
  pre_counts jsonb not null default '{}',
  post_counts jsonb not null default '{}',
  reconciliation jsonb not null default '{}',
  exception_count integer not null default 0,
  rollback_payload jsonb not null default '{}',
  notes text
);

create table if not exists atlas_maintenance_inspections (
  maintenance_inspection_id uuid primary key default gen_random_uuid(),
  moonrise_sync_run_id uuid references atlas_moonrise_sync_runs(moonrise_sync_run_id),
  community_id uuid references atlas_communities(community_id),
  source_system text not null default 'moonrise',
  source_record_id text,
  source_key text not null,
  source_property_name text,
  source_property_identifier text,
  inspection_type text not null check (inspection_type in ('MSOE','SOE')),
  inspection_date date,
  reporting_month date not null,
  status text,
  findings text,
  due_date date,
  approval_status text,
  signoff_status text,
  approved_for_reporting boolean not null default false,
  completion_pct numeric(8,4),
  created_count integer,
  approved_count integer,
  under_review_count integer,
  in_progress_count integer,
  not_started_count integer,
  past_due_count integer,
  source_payload jsonb not null default '{}',
  source_hash text not null,
  first_imported_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz,
  unique (source_system, source_key)
);

create table if not exists atlas_maintenance_inspection_exceptions (
  inspection_exception_id uuid primary key default gen_random_uuid(),
  moonrise_sync_run_id uuid references atlas_moonrise_sync_runs(moonrise_sync_run_id),
  maintenance_inspection_id uuid references atlas_maintenance_inspections(maintenance_inspection_id),
  severity text not null default 'review' check (severity in ('info','review','blocker')),
  exception_code text not null,
  exception_message text not null,
  source_payload jsonb not null default '{}',
  resolution_status text not null default 'open' check (resolution_status in ('open','resolved','accepted')),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists atlas_maintenance_inspection_snapshots (
  inspection_snapshot_id uuid primary key default gen_random_uuid(),
  reporting_month date not null,
  source_system text not null default 'moonrise',
  snapshot_hash text not null,
  snapshot_payload jsonb not null,
  record_count integer not null default 0,
  msoe_count integer not null default 0,
  soe_count integer not null default 0,
  exception_count integer not null default 0,
  captured_by uuid references auth.users(id),
  captured_at timestamptz not null default now(),
  read_only_locked boolean not null default true,
  unique (reporting_month, source_system, snapshot_hash)
);

create table if not exists atlas_bonus_periods (
  bonus_period_id uuid primary key default gen_random_uuid(),
  period_key text not null unique,
  year integer not null,
  quarter text not null check (quarter in ('Q1','Q2','Q3','Q4')),
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','locked','approved','paid','archived')),
  locked_at timestamptz,
  locked_by uuid references auth.users(id),
  check (end_date >= start_date)
);

create table if not exists atlas_incentive_plans (
  incentive_plan_id uuid primary key default gen_random_uuid(),
  role_id uuid references atlas_roles(role_id),
  plan_name text not null,
  effective_start date not null,
  effective_end date,
  eligibility_rules jsonb not null default '{}',
  metric_rules jsonb not null default '[]',
  source_module text not null default 'bonus',
  source_identifier text,
  source_hash text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (effective_end is null or effective_end >= effective_start)
);

create table if not exists atlas_bonus_calculation_runs (
  bonus_calculation_run_id uuid primary key default gen_random_uuid(),
  bonus_period_id uuid not null references atlas_bonus_periods(bonus_period_id),
  community_id uuid references atlas_communities(community_id),
  status text not null default 'draft' check (status in ('draft','review','approved','locked','voided')),
  calculation_hash text not null,
  source_snapshot_id uuid references atlas_legacy_snapshots(snapshot_id),
  calculated_by uuid references auth.users(id),
  calculated_at timestamptz not null default now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  total_payout numeric(14,2) not null default 0,
  inputs jsonb not null default '{}',
  exceptions jsonb not null default '[]'
);

create table if not exists atlas_bonus_calculation_lines (
  bonus_line_id uuid primary key default gen_random_uuid(),
  bonus_calculation_run_id uuid not null references atlas_bonus_calculation_runs(bonus_calculation_run_id),
  employee_id uuid references atlas_employees(employee_id),
  assignment_id uuid references atlas_employee_assignments(assignment_id),
  incentive_plan_id uuid references atlas_incentive_plans(incentive_plan_id),
  metric_key text,
  metric_source_table text,
  metric_source_id uuid,
  payout_amount numeric(14,2) not null default 0,
  line_payload jsonb not null default '{}'
);
