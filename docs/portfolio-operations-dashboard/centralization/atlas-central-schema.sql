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

alter table atlas_communities add column if not exists regional_grouping text;
alter table atlas_communities add column if not exists property_type text;
alter table atlas_communities add column if not exists general_manager_employee_id uuid;
alter table atlas_communities add column if not exists general_manager_name text;
alter table atlas_communities add column if not exists general_manager_email text;
alter table atlas_communities add column if not exists regional_manager_employee_id uuid;
alter table atlas_communities add column if not exists regional_manager_name text;
alter table atlas_communities add column if not exists regional_manager_email text;
alter table atlas_communities add column if not exists scope_selections jsonb not null default '[]';
alter table atlas_communities add column if not exists last_sync_source text;
alter table atlas_communities add column if not exists last_sync_at timestamptz;
alter table atlas_communities add column if not exists review_status text not null default 'clean' check (review_status in ('clean','review_required','blocked'));
alter table atlas_communities add column if not exists review_flags jsonb not null default '[]';

create table if not exists atlas_shared_sync_events (
  sync_event_id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  source_module text not null,
  source_record_id text,
  conflict_resolution text not null default 'most_recent_valid_update',
  field_changes jsonb not null default '{}',
  review_flags jsonb not null default '[]',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists atlas_mapping_review_queue (
  review_id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  proposed_source text not null,
  proposed_identifier text,
  proposed_payload jsonb not null default '{}',
  reason text not null,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
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
  exceptions jsonb not null default '[]',
  deleted_at timestamptz
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
  line_payload jsonb not null default '{}',
  deleted_at timestamptz
);

create or replace function atlas_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select aup.role from atlas_user_profiles aup where aup.user_id = auth.uid() and aup.status = 'active'), 'anonymous');
$$;

create or replace function atlas_can_write(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select atlas_current_role() = any(required_roles);
$$;

create or replace function atlas_has_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select atlas_current_role() = any(required_roles);
$$;

create or replace function atlas_current_allowed_community_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select allowed_community_ids
    from atlas_user_profiles aup
    where aup.user_id = auth.uid()
      and aup.status = 'active'
  ), '{}'::uuid[]);
$$;

create or replace function atlas_can_access_community(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    atlas_has_role(array['admin','executive'])
    or (
      p_community_id is not null
      and p_community_id = any(atlas_current_allowed_community_ids())
    );
$$;

create or replace function atlas_hash_payload(payload jsonb)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(coalesce(payload::text, ''), 'sha256'), 'hex');
$$;

create or replace function atlas_claim_first_admin(
  p_display_name text default null
)
returns table(user_id uuid, email text, display_name text, role text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_email text;
  v_display_name text;
  v_profile atlas_user_profiles%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication is required before claiming the first Atlas admin.' using errcode = '28000';
  end if;

  if exists (
    select 1
    from atlas_user_profiles aup
    where aup.role = 'admin'
      and aup.status = 'active'
  ) then
    raise exception 'An active Atlas admin already exists.' using errcode = '42501';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', (select u.email from auth.users u where u.id = v_user_id)));
  if nullif(v_email, '') is null then
    raise exception 'The authenticated user does not have an email address.' using errcode = '22023';
  end if;

  if v_email !~* '^[^@]+@riseresidential[.]com$' then
    raise exception 'Only a riseresidential.com account can claim the first Atlas admin.' using errcode = '42501';
  end if;

  v_display_name := nullif(trim(coalesce(p_display_name, split_part(v_email, '@', 1))), '');

  insert into atlas_user_profiles(user_id, email, display_name, role, status)
  values (v_user_id, v_email, coalesce(v_display_name, v_email), 'admin', 'active')
  on conflict (user_id) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        role = 'admin',
        status = 'active',
        updated_at = now()
  returning * into v_profile;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (
    v_user_id,
    'first_admin_claimed',
    'atlas_user_profiles',
    v_profile.user_id::text,
    'central_platform_setup',
    null,
    to_jsonb(v_profile),
    jsonb_build_object('guardrail', 'only_when_no_active_admin_exists')
  );

  return query
  select v_profile.user_id, v_profile.email, v_profile.display_name, v_profile.role, v_profile.status;
end;
$$;

create or replace function atlas_update_app_document(
  p_document_key text,
  p_module_key text,
  p_payload jsonb,
  p_expected_version integer default null,
  p_source_module text default 'atlas',
  p_source_hash text default null,
  p_metadata jsonb default '{}'
)
returns table (
  document_id uuid,
  document_key text,
  module_key text,
  version integer,
  payload_hash text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc atlas_app_documents%rowtype;
  v_before jsonb;
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to update Atlas central data.';
  end if;

  if not atlas_can_write(array['admin']) then
    raise exception 'Only Atlas admins may update the migration-wide app document.';
  end if;

  if nullif(trim(p_document_key), '') is null then
    raise exception 'Document key is required.';
  end if;

  if p_payload is null then
    raise exception 'Payload is required.';
  end if;

  v_hash := coalesce(nullif(trim(p_source_hash), ''), atlas_hash_payload(p_payload));

  select *
  into v_doc
  from atlas_app_documents d
  where d.document_key = trim(p_document_key)
    and d.deleted_at is null
  for update;

  if not found then
    if p_expected_version is not null then
      raise exception 'Atlas central document conflict: document does not exist but caller expected version %.', p_expected_version;
    end if;

    insert into atlas_app_documents (
      document_key,
      module_key,
      payload,
      payload_hash,
      version,
      source_module,
      source_hash,
      created_by,
      updated_by
    )
    values (
      trim(p_document_key),
      trim(coalesce(nullif(p_module_key, ''), 'dashboard')),
      p_payload,
      v_hash,
      1,
      trim(coalesce(nullif(p_source_module, ''), 'atlas')),
      v_hash,
      auth.uid(),
      auth.uid()
    )
    returning * into v_doc;

    v_before := null;
  else
    if p_expected_version is null or v_doc.version <> p_expected_version then
      raise exception 'Atlas central document conflict: expected version %, found version %.', coalesce(p_expected_version, -1), v_doc.version;
    end if;

    v_before := v_doc.payload;

    update atlas_app_documents d
    set payload = p_payload,
        payload_hash = v_hash,
        version = d.version + 1,
        source_module = trim(coalesce(nullif(p_source_module, ''), 'atlas')),
        source_hash = v_hash,
        updated_by = auth.uid(),
        updated_at = now()
    where d.document_id = v_doc.document_id
    returning * into v_doc;
  end if;

  insert into atlas_app_document_versions (
    document_id,
    document_key,
    module_key,
    version,
    payload,
    payload_hash,
    source_module,
    source_hash,
    saved_by,
    metadata
  )
  values (
    v_doc.document_id,
    v_doc.document_key,
    v_doc.module_key,
    v_doc.version,
    v_doc.payload,
    v_doc.payload_hash,
    v_doc.source_module,
    v_doc.source_hash,
    auth.uid(),
    coalesce(p_metadata, '{}')
  );

  insert into atlas_audit_log (
    actor_user_id,
    action,
    entity_table,
    entity_id,
    source_module,
    before_payload,
    after_payload,
    metadata
  )
  values (
    auth.uid(),
    case when v_before is null then 'insert' else 'update' end,
    'atlas_app_documents',
    v_doc.document_id::text,
    v_doc.source_module,
    v_before,
    v_doc.payload,
    jsonb_build_object(
      'document_key', v_doc.document_key,
      'module_key', v_doc.module_key,
      'version', v_doc.version,
      'source_hash', v_doc.source_hash
    ) || coalesce(p_metadata, '{}')
  );

  return query
  select
    v_doc.document_id,
    v_doc.document_key,
    v_doc.module_key,
    v_doc.version,
    v_doc.payload_hash,
    v_doc.updated_at;
end;
$$;

create or replace function atlas_upload_legacy_snapshot(
  p_source_module text,
  p_source_key text,
  p_source_label text,
  p_source_version text,
  p_source_payload jsonb,
  p_metadata jsonb default '{}'
)
returns table(snapshot_id uuid, migration_run_id uuid, source_hash text, captured_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_migration_run_id uuid;
  v_snapshot_id uuid;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to upload Atlas migration snapshots.' using errcode = '28000';
  end if;

  v_role := atlas_current_role();
  if v_role not in ('admin','executive','regional','people','marketing','maintenance','finance','bonus') then
    raise exception 'Atlas snapshot upload denied for role %', v_role using errcode = '42501';
  end if;

  if coalesce(p_source_payload, '{}'::jsonb) = '{}'::jsonb then
    raise exception 'Snapshot payload is required.' using errcode = '22023';
  end if;

  v_hash := atlas_hash_payload(p_source_payload);

  insert into atlas_migration_runs(
    phase,
    source_module,
    status,
    dry_run,
    started_by,
    pre_counts,
    pre_totals,
    reconciliation_status,
    exception_count,
    notes
  )
  values (
    coalesce(nullif(p_metadata ->> 'phase', ''), 'legacy_snapshot'),
    coalesce(nullif(p_source_module, ''), 'atlas_browser'),
    'snapshot_captured',
    true,
    auth.uid(),
    coalesce(p_metadata -> 'pre_counts', '{}'::jsonb),
    coalesce(p_metadata -> 'pre_totals', '{}'::jsonb),
    'snapshot_only',
    coalesce((p_metadata ->> 'exception_count')::integer, 0),
    coalesce(p_metadata ->> 'notes', 'Read-only Atlas snapshot captured before central migration. No source rows were changed.')
  )
  returning atlas_migration_runs.migration_run_id into v_migration_run_id;

  insert into atlas_legacy_snapshots(
    migration_run_id,
    source_module,
    source_key,
    source_label,
    source_version,
    source_payload,
    source_hash,
    captured_by,
    read_only_locked
  )
  values (
    v_migration_run_id,
    coalesce(nullif(p_source_module, ''), 'atlas_browser'),
    coalesce(nullif(p_source_key, ''), 'atlas_central_migration_read_only_snapshot_v1'),
    p_source_label,
    p_source_version,
    p_source_payload,
    v_hash,
    auth.uid(),
    true
  )
  on conflict (source_module, source_key, source_hash) do update
    set captured_at = atlas_legacy_snapshots.captured_at
  returning atlas_legacy_snapshots.snapshot_id into v_snapshot_id;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (
    auth.uid(),
    'snapshot_upload',
    'atlas_legacy_snapshots',
    v_snapshot_id::text,
    coalesce(nullif(p_source_module, ''), 'atlas_browser'),
    null,
    jsonb_build_object('source_hash', v_hash, 'read_only_locked', true),
    coalesce(p_metadata, '{}'::jsonb)
  );

  return query select v_snapshot_id, v_migration_run_id, v_hash, now();
end;
$$;

create or replace function atlas_lookup_or_create_community(
  p_name text,
  p_source_module text default 'atlas',
  p_create_missing boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_canonical text;
  v_community_id uuid;
begin
  v_name := nullif(trim(p_name), '');
  if v_name is null then
    return null;
  end if;

  select ca.community_id
  into v_community_id
  from atlas_community_aliases ca
  where ca.active is true
    and lower(ca.alias) = lower(v_name)
  limit 1;

  if v_community_id is not null then
    return v_community_id;
  end if;

  if not p_create_missing then
    return null;
  end if;

  v_canonical := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '_', 'g'));
  v_canonical := trim(both '_' from v_canonical);
  if v_canonical = '' then
    return null;
  end if;

  insert into atlas_communities(canonical_name, display_name, source_module, source_identifier, source_hash)
  values (v_canonical, v_name, coalesce(nullif(p_source_module, ''), 'atlas'), v_name, atlas_hash_payload(jsonb_build_object('community', v_name)))
  on conflict (canonical_name) do update
    set display_name = excluded.display_name,
        updated_at = now()
  returning community_id into v_community_id;

  insert into atlas_community_aliases(community_id, alias, source_module)
  values (v_community_id, v_name, coalesce(nullif(p_source_module, ''), 'atlas'))
  on conflict do nothing;

  return v_community_id;
end;
$$;

create or replace function atlas_upsert_people_directory(
  p_payload jsonb,
  p_migration_run_id uuid default null,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_result jsonb := jsonb_build_object('employees', 0, 'communities', 0, 'roles', 0, 'assignments', 0, 'exceptions', 0, 'dryRun', p_dry_run);
  v_employee jsonb;
  v_assignment jsonb;
  v_employee_id uuid;
  v_community_id uuid;
  v_role_id uuid;
  v_source_identifier text;
  v_full_name text;
  v_employee_number text;
  v_email text;
  v_status text;
  v_title text;
  v_role_code text;
  v_community_name text;
  v_effective_start date;
  v_effective_end date;
  v_source_hash text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to promote People data.' using errcode = '28000';
  end if;

  v_role := atlas_current_role();
  if v_role not in ('admin','executive','regional','people') then
    raise exception 'Atlas People promotion denied for role %', v_role using errcode = '42501';
  end if;

  if jsonb_typeof(p_payload -> 'employees') <> 'array' then
    raise exception 'People payload must contain an employees array.' using errcode = '22023';
  end if;

  for v_employee in select * from jsonb_array_elements(p_payload -> 'employees') loop
    v_source_identifier := nullif(trim(coalesce(v_employee ->> 'peopleEmployeeId', v_employee ->> 'employeeId', v_employee ->> 'id', v_employee ->> 'employeeNumber', v_employee ->> 'email')), '');
    v_full_name := nullif(trim(coalesce(v_employee ->> 'name', v_employee ->> 'fullName', v_employee ->> 'full_name')), '');
    v_employee_number := nullif(trim(coalesce(v_employee ->> 'employeeNumber', v_employee ->> 'employee_number')), '');
    v_email := nullif(lower(trim(coalesce(v_employee ->> 'email', v_employee ->> 'emailAddress'))), '');
    v_status := lower(coalesce(nullif(trim(coalesce(v_employee ->> 'status', v_employee ->> 'employmentStatus')), ''), 'active'));
    v_title := nullif(trim(coalesce(v_employee ->> 'title', v_employee ->> 'role', v_employee ->> 'position')), '');
    v_community_name := nullif(trim(coalesce(v_employee ->> 'communityName', v_employee ->> 'community', v_employee ->> 'property', v_employee ->> 'propertyName')), '');
    v_effective_start := coalesce(nullif(v_employee ->> 'effectiveStart', '')::date, nullif(v_employee ->> 'effectiveDate', '')::date, date_trunc('month', now())::date);
    v_effective_end := nullif(v_employee ->> 'effectiveEnd', '')::date;
    v_source_hash := atlas_hash_payload(v_employee);

    if v_source_identifier is null or v_full_name is null then
      insert into atlas_mapping_log(migration_run_id, source_module, source_entity, source_identifier, source_name, decision, reason, source_payload)
      values (p_migration_run_id, 'people', 'employee', coalesce(v_source_identifier, 'missing'), v_full_name, 'manual_review', 'Missing employee identifier or name', v_employee);
      v_result := jsonb_set(v_result, '{exceptions}', to_jsonb((v_result ->> 'exceptions')::integer + 1));
      continue;
    end if;

    if p_dry_run then
      v_result := jsonb_set(v_result, '{employees}', to_jsonb((v_result ->> 'employees')::integer + 1));
      if v_community_name is not null then v_result := jsonb_set(v_result, '{communities}', to_jsonb((v_result ->> 'communities')::integer + 1)); end if;
      if v_title is not null then v_result := jsonb_set(v_result, '{roles}', to_jsonb((v_result ->> 'roles')::integer + 1)); end if;
      v_result := jsonb_set(v_result, '{assignments}', to_jsonb((v_result ->> 'assignments')::integer + 1));
      continue;
    end if;

    v_community_id := atlas_lookup_or_create_community(v_community_name, 'people');

    if v_title is not null then
      v_role_code := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '_', 'g'));
      v_role_code := trim(both '_' from v_role_code);
      insert into atlas_roles(role_code, title, bonus_role_type, source_module)
      values (
        v_role_code,
        v_title,
        case
          when lower(v_title) like '%assistant manager%' or lower(v_title) = 'am' then 'am'
          when lower(v_title) like '%leasing manager%' or lower(v_title) = 'lm' then 'lm'
          when lower(v_title) like '%leasing professional%' or lower(v_title) like '%leasing consultant%' or lower(v_title) = 'lp' then 'lp'
          when lower(v_title) like '%service manager%' or lower(v_title) like '%maintenance supervisor%' or lower(v_title) = 'ms' then 'ms'
          when lower(v_title) like '%maintenance tech%' or lower(v_title) like '%service technician%' or lower(v_title) = 'mt' then 'mt'
          when lower(v_title) like '%general manager%' or lower(v_title) like '%community manager%' or lower(v_title) like '%property manager%' or lower(v_title) = 'gm' then 'gm'
          else null
        end,
        'people'
      )
      on conflict (role_code) do update
        set title = excluded.title,
            bonus_role_type = coalesce(excluded.bonus_role_type, atlas_roles.bonus_role_type),
            active = true
      returning role_id into v_role_id;
    end if;

    if v_employee_number is not null then
      insert into atlas_employees(employee_number, email, full_name, status, status_type, source_module, source_identifier, source_hash)
      values (v_employee_number, v_email, v_full_name, v_status, v_status, 'people', v_source_identifier, v_source_hash)
      on conflict (employee_number) do update
        set email = coalesce(excluded.email, atlas_employees.email),
            full_name = excluded.full_name,
            status = excluded.status,
            status_type = excluded.status_type,
            source_hash = excluded.source_hash,
            version = atlas_employees.version + 1,
            updated_at = now()
      returning employee_id into v_employee_id;
    elsif v_email is not null then
      insert into atlas_employees(employee_number, email, full_name, status, status_type, source_module, source_identifier, source_hash)
      values (v_employee_number, v_email, v_full_name, v_status, v_status, 'people', v_source_identifier, v_source_hash)
      on conflict (email) do update
        set employee_number = coalesce(excluded.employee_number, atlas_employees.employee_number),
            full_name = excluded.full_name,
            status = excluded.status,
            status_type = excluded.status_type,
            source_hash = excluded.source_hash,
            version = atlas_employees.version + 1,
            updated_at = now()
      returning employee_id into v_employee_id;
    else
      insert into atlas_employees(employee_number, email, full_name, status, status_type, source_module, source_identifier, source_hash)
      values (v_employee_number, v_email, v_full_name, v_status, v_status, 'people', v_source_identifier, v_source_hash)
      returning employee_id into v_employee_id;
    end if;

    update atlas_employee_assignments
    set effective_end = (v_effective_start - interval '1 day')::date,
        updated_at = now(),
        version = version + 1
    where employee_id = v_employee_id
      and primary_assignment is true
      and deleted_at is null
      and effective_end is null
      and effective_start < v_effective_start
      and (
        coalesce(community_id::text, '') <> coalesce(v_community_id::text, '') or
        coalesce(role_id::text, '') <> coalesce(v_role_id::text, '') or
        coalesce(title, '') <> coalesce(v_title, '') or
        coalesce(employment_status, '') <> coalesce(v_status, '')
      );

    insert into atlas_employee_assignments(employee_id, community_id, role_id, title, employment_status, primary_assignment, effective_start, effective_end, source_module, source_identifier, source_hash)
    select v_employee_id, v_community_id, v_role_id, coalesce(v_title, 'Unassigned'), v_status, true, v_effective_start, v_effective_end, 'people', v_source_identifier, v_source_hash
    where not exists (
      select 1
      from atlas_employee_assignments a
      where a.employee_id = v_employee_id
        and coalesce(a.community_id::text, '') = coalesce(v_community_id::text, '')
        and coalesce(a.role_id::text, '') = coalesce(v_role_id::text, '')
        and a.effective_start = v_effective_start
        and a.deleted_at is null
    );

    if jsonb_typeof(v_employee -> 'assignments') = 'array' then
      for v_assignment in select * from jsonb_array_elements(v_employee -> 'assignments') loop
        insert into atlas_mapping_log(migration_run_id, source_module, source_entity, source_identifier, source_name, target_table, target_id, confidence, decision, reason, source_payload, mapped_payload)
        values (p_migration_run_id, 'people', 'assignment_source_history', coalesce(v_assignment ->> 'assignmentId', v_source_identifier), v_full_name, 'atlas_employee_assignments', v_employee_id, 100, 'mapped', 'Source assignment history retained in mapping log payload', v_assignment, jsonb_build_object('employee_id', v_employee_id));
      end loop;
    end if;

    insert into atlas_mapping_log(migration_run_id, source_module, source_entity, source_identifier, source_name, target_table, target_id, confidence, decision, reason, source_payload, mapped_payload)
    values (p_migration_run_id, 'people', 'employee', v_source_identifier, v_full_name, 'atlas_employees', v_employee_id, 100, 'mapped', 'Mapped by People stable identifier, employee number, or email', v_employee, jsonb_build_object('employee_id', v_employee_id, 'community_id', v_community_id, 'role_id', v_role_id, 'effective_start', v_effective_start));

    v_result := jsonb_set(v_result, '{employees}', to_jsonb((v_result ->> 'employees')::integer + 1));
    if v_community_id is not null then v_result := jsonb_set(v_result, '{communities}', to_jsonb((v_result ->> 'communities')::integer + 1)); end if;
    if v_role_id is not null then v_result := jsonb_set(v_result, '{roles}', to_jsonb((v_result ->> 'roles')::integer + 1)); end if;
    v_result := jsonb_set(v_result, '{assignments}', to_jsonb((v_result ->> 'assignments')::integer + 1));
  end loop;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (auth.uid(), case when p_dry_run then 'people_promotion_dry_run' else 'people_promotion_apply' end, 'atlas_employees', coalesce(p_migration_run_id::text, 'direct'), 'people', null, p_payload, v_result);

  return v_result;
end;
$$;

create or replace function atlas_upsert_marketing_metrics(
  p_metrics jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_metric jsonb;
  v_community_id uuid;
  v_result jsonb := jsonb_build_object('metrics', 0, 'exceptions', 0, 'dryRun', p_dry_run);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to promote Marketing metrics.' using errcode = '28000';
  end if;

  v_role := atlas_current_role();
  if v_role not in ('admin','executive','regional','marketing') then
    raise exception 'Atlas Marketing metric promotion denied for role %', v_role using errcode = '42501';
  end if;

  if jsonb_typeof(p_metrics) <> 'array' then
    raise exception 'Marketing metrics payload must be an array.' using errcode = '22023';
  end if;

  for v_metric in select * from jsonb_array_elements(p_metrics) loop
    v_community_id := atlas_lookup_or_create_community(coalesce(v_metric ->> 'communityName', v_metric ->> 'propertyName'), 'marketing', false);
    if v_community_id is null or nullif(v_metric ->> 'sourceIdentifier', '') is null or nullif(v_metric ->> 'metricKey', '') is null or nullif(v_metric ->> 'periodKey', '') is null then
      insert into atlas_mapping_log(source_module, source_entity, source_identifier, source_name, decision, reason, source_payload)
      values ('marketing', 'marketing_metric', coalesce(v_metric ->> 'sourceIdentifier', 'missing'), coalesce(v_metric ->> 'communityName', v_metric ->> 'propertyName'), 'manual_review', 'Missing community, source identifier, metric key, or period key', v_metric);
      v_result := jsonb_set(v_result, '{exceptions}', to_jsonb((v_result ->> 'exceptions')::integer + 1));
      continue;
    end if;

    if not p_dry_run then
      insert into atlas_marketing_metrics(community_id, period_key, metric_key, metric_value, grain, approved, approved_by, approved_at, source_module, source_table, source_identifier, source_hash)
      values (
        v_community_id,
        v_metric ->> 'periodKey',
        v_metric ->> 'metricKey',
        coalesce(nullif(v_metric ->> 'metricValue', '')::numeric, 0),
        coalesce(nullif(v_metric ->> 'grain', ''), 'month'),
        coalesce((v_metric ->> 'approved')::boolean, false),
        case when coalesce((v_metric ->> 'approved')::boolean, false) then auth.uid() else null end,
        case when coalesce((v_metric ->> 'approved')::boolean, false) then now() else null end,
        'marketing',
        v_metric ->> 'sourceTable',
        v_metric ->> 'sourceIdentifier',
        atlas_hash_payload(v_metric)
      )
      on conflict (community_id, period_key, metric_key, grain, source_identifier) do update
        set metric_value = excluded.metric_value,
            approved = excluded.approved,
            approved_by = excluded.approved_by,
            approved_at = excluded.approved_at,
            source_hash = excluded.source_hash,
            version = atlas_marketing_metrics.version + 1,
            updated_at = now();
    end if;

    v_result := jsonb_set(v_result, '{metrics}', to_jsonb((v_result ->> 'metrics')::integer + 1));
  end loop;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (auth.uid(), case when p_dry_run then 'marketing_metrics_dry_run' else 'marketing_metrics_apply' end, 'atlas_marketing_metrics', 'batch', 'marketing', null, p_metrics, v_result);

  return v_result;
end;
$$;

create or replace function atlas_upsert_maintenance_inspections(
  p_records jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_record jsonb;
  v_community_id uuid;
  v_sync_run_id uuid;
  v_inspection_id uuid;
  v_result jsonb := jsonb_build_object('inspections', 0, 'exceptions', 0, 'dryRun', p_dry_run);
  v_type text;
  v_source_key text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to promote Maintenance inspections.' using errcode = '28000';
  end if;

  v_role := atlas_current_role();
  if v_role not in ('admin','executive','regional','maintenance') then
    raise exception 'Atlas Maintenance inspection promotion denied for role %', v_role using errcode = '42501';
  end if;

  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'Maintenance inspection payload must be an array.' using errcode = '22023';
  end if;

  if not p_dry_run then
    insert into atlas_moonrise_sync_runs(source_method, status, started_by, completed_at, reporting_periods, notes)
    values ('secure_export', 'synced', auth.uid(), now(), '{}', 'Atlas controlled Moonrise MSOE/SOE import.')
    returning moonrise_sync_run_id into v_sync_run_id;
  end if;

  for v_record in select * from jsonb_array_elements(p_records) loop
    v_type := upper(coalesce(v_record ->> 'inspectionType', v_record ->> 'inspection_type', ''));
    v_source_key := nullif(coalesce(v_record ->> 'sourceKey', v_record ->> 'source_key', v_record ->> 'sourceRecordId'), '');
    v_community_id := atlas_lookup_or_create_community(coalesce(v_record ->> 'property', v_record ->> 'communityName', v_record ->> 'sourcePropertyName'), 'maintenance', false);

    if v_community_id is null or v_source_key is null or v_type not in ('MSOE','SOE') or nullif(v_record ->> 'reportingMonth', '') is null then
      insert into atlas_mapping_log(source_module, source_entity, source_identifier, source_name, decision, reason, source_payload)
      values ('maintenance', 'moonrise_inspection', coalesce(v_source_key, 'missing'), coalesce(v_record ->> 'property', v_record ->> 'sourcePropertyName'), 'manual_review', 'Missing matched community, source key, inspection type, or reporting month', v_record);
      v_result := jsonb_set(v_result, '{exceptions}', to_jsonb((v_result ->> 'exceptions')::integer + 1));
      continue;
    end if;

    if not p_dry_run then
      insert into atlas_maintenance_inspections(
        moonrise_sync_run_id,
        community_id,
        source_system,
        source_record_id,
        source_key,
        source_property_name,
        source_property_identifier,
        inspection_type,
        inspection_date,
        reporting_month,
        status,
        findings,
        due_date,
        approval_status,
        signoff_status,
        approved_for_reporting,
        completion_pct,
        created_count,
        approved_count,
        under_review_count,
        in_progress_count,
        not_started_count,
        past_due_count,
        source_payload,
        source_hash
      )
      values (
        v_sync_run_id,
        v_community_id,
        'moonrise',
        v_record ->> 'sourceRecordId',
        v_source_key,
        v_record ->> 'sourcePropertyName',
        v_record ->> 'sourcePropertyId',
        v_type,
        nullif(v_record ->> 'inspectionDate', '')::date,
        nullif(v_record ->> 'reportingMonth', '')::date,
        v_record ->> 'status',
        v_record ->> 'findings',
        nullif(v_record ->> 'dueDate', '')::date,
        v_record ->> 'approvalStatus',
        v_record ->> 'signOffStatus',
        coalesce((v_record ->> 'approvedForReporting')::boolean, false),
        nullif(v_record ->> 'completionPct', '')::numeric,
        nullif(v_record ->> 'createdCount', '')::integer,
        nullif(v_record ->> 'approvedCount', '')::integer,
        nullif(v_record ->> 'reviewCount', '')::integer,
        nullif(v_record ->> 'progressCount', '')::integer,
        nullif(v_record ->> 'notStartedCount', '')::integer,
        nullif(v_record ->> 'pastDueCount', '')::integer,
        v_record,
        atlas_hash_payload(v_record)
      )
      on conflict (source_system, source_key) do update
        set community_id = excluded.community_id,
            source_record_id = excluded.source_record_id,
            source_property_name = excluded.source_property_name,
            source_property_identifier = excluded.source_property_identifier,
            inspection_type = excluded.inspection_type,
            inspection_date = excluded.inspection_date,
            reporting_month = excluded.reporting_month,
            status = excluded.status,
            findings = excluded.findings,
            due_date = excluded.due_date,
            approval_status = excluded.approval_status,
            signoff_status = excluded.signoff_status,
            approved_for_reporting = excluded.approved_for_reporting,
            completion_pct = excluded.completion_pct,
            created_count = excluded.created_count,
            approved_count = excluded.approved_count,
            under_review_count = excluded.under_review_count,
            in_progress_count = excluded.in_progress_count,
            not_started_count = excluded.not_started_count,
            past_due_count = excluded.past_due_count,
            source_payload = excluded.source_payload,
            source_hash = excluded.source_hash,
            last_synced_at = now(),
            version = atlas_maintenance_inspections.version + 1
      returning maintenance_inspection_id into v_inspection_id;

      if jsonb_array_length(coalesce(v_record -> 'exceptions', '[]'::jsonb)) > 0 then
        insert into atlas_maintenance_inspection_exceptions(moonrise_sync_run_id, maintenance_inspection_id, exception_code, exception_message, source_payload)
        select v_sync_run_id, v_inspection_id, coalesce(e ->> 'code', 'review'), coalesce(e ->> 'message', 'Moonrise record requires review.'), e
        from jsonb_array_elements(v_record -> 'exceptions') e;
      end if;
    end if;

    v_result := jsonb_set(v_result, '{inspections}', to_jsonb((v_result ->> 'inspections')::integer + 1));
  end loop;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (auth.uid(), case when p_dry_run then 'maintenance_inspections_dry_run' else 'maintenance_inspections_apply' end, 'atlas_maintenance_inspections', coalesce(v_sync_run_id::text, 'dry_run'), 'maintenance', null, p_records, v_result);

  return v_result;
end;
$$;

create or replace function atlas_record_bonus_calculation(
  p_period_key text,
  p_year integer,
  p_quarter text,
  p_start_date date,
  p_end_date date,
  p_payload jsonb,
  p_status text default 'draft'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_period_id uuid;
  v_run_id uuid;
  v_line jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to record Bonus calculations.' using errcode = '28000';
  end if;

  v_role := atlas_current_role();
  if v_role not in ('admin','executive','regional','bonus','finance') then
    raise exception 'Atlas Bonus calculation write denied for role %', v_role using errcode = '42501';
  end if;

  insert into atlas_bonus_periods(period_key, year, quarter, start_date, end_date, status)
  values (p_period_key, p_year, p_quarter, p_start_date, p_end_date, 'open')
  on conflict (period_key) do update
    set year = excluded.year,
        quarter = excluded.quarter,
        start_date = excluded.start_date,
        end_date = excluded.end_date
  returning bonus_period_id into v_period_id;

  insert into atlas_bonus_calculation_runs(bonus_period_id, status, calculation_hash, source_snapshot_id, calculated_by, total_payout, inputs, exceptions)
  values (
    v_period_id,
    coalesce(nullif(p_status, ''), 'draft'),
    atlas_hash_payload(p_payload),
    nullif(p_payload ->> 'sourceSnapshotId', '')::uuid,
    auth.uid(),
    coalesce(nullif(p_payload ->> 'totalPayout', '')::numeric, 0),
    p_payload,
    coalesce(p_payload -> 'exceptions', '[]'::jsonb)
  )
  returning bonus_calculation_run_id into v_run_id;

  if jsonb_typeof(p_payload -> 'lines') = 'array' then
    for v_line in select * from jsonb_array_elements(p_payload -> 'lines') loop
      insert into atlas_bonus_calculation_lines(bonus_calculation_run_id, employee_id, assignment_id, incentive_plan_id, metric_key, metric_source_table, metric_source_id, payout_amount, line_payload)
      values (
        v_run_id,
        nullif(v_line ->> 'employee_id', '')::uuid,
        nullif(v_line ->> 'assignment_id', '')::uuid,
        nullif(v_line ->> 'incentive_plan_id', '')::uuid,
        v_line ->> 'metric_key',
        v_line ->> 'metric_source_table',
        nullif(v_line ->> 'metric_source_id', '')::uuid,
        coalesce(nullif(v_line ->> 'payout_amount', '')::numeric, 0),
        v_line
      );
    end loop;
  end if;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (auth.uid(), 'bonus_calculation_recorded', 'atlas_bonus_calculation_runs', v_run_id::text, 'bonus', null, p_payload, jsonb_build_object('period_key', p_period_key));

  return v_run_id;
end;
$$;

alter table atlas_user_profiles enable row level security;
alter table atlas_audit_log enable row level security;
alter table atlas_app_documents enable row level security;
alter table atlas_app_document_versions enable row level security;
alter table atlas_edit_locks enable row level security;
alter table atlas_migration_runs enable row level security;
alter table atlas_legacy_snapshots enable row level security;
alter table atlas_mapping_log enable row level security;
alter table atlas_communities enable row level security;
alter table atlas_community_aliases enable row level security;
alter table atlas_roles enable row level security;
alter table atlas_employees enable row level security;
alter table atlas_employee_assignments enable row level security;
alter table atlas_budget_lines enable row level security;
alter table atlas_actual_lines enable row level security;
alter table atlas_contracts enable row level security;
alter table atlas_marketing_metrics enable row level security;
alter table atlas_maintenance_metrics enable row level security;
alter table atlas_moonrise_sync_runs enable row level security;
alter table atlas_maintenance_inspections enable row level security;
alter table atlas_maintenance_inspection_exceptions enable row level security;
alter table atlas_maintenance_inspection_snapshots enable row level security;
alter table atlas_bonus_periods enable row level security;
alter table atlas_incentive_plans enable row level security;
alter table atlas_bonus_calculation_runs enable row level security;
alter table atlas_bonus_calculation_lines enable row level security;
alter table atlas_shared_sync_events enable row level security;
alter table atlas_mapping_review_queue enable row level security;

create policy "atlas profile self or admin read"
on atlas_user_profiles for select to authenticated
using (user_id = auth.uid() or atlas_has_role(array['admin']));

create policy "atlas admin manages profiles"
on atlas_user_profiles for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

create policy "atlas users append own audit"
on atlas_audit_log for insert to authenticated
with check (actor_user_id = auth.uid() or actor_user_id is null);

create policy "atlas audit admin executive read"
on atlas_audit_log for select to authenticated
using (atlas_has_role(array['admin','executive']));

create policy "atlas app documents admin executive read"
on atlas_app_documents for select to authenticated
using (deleted_at is null and atlas_has_role(array['admin','executive']));

create policy "atlas admin manages app documents"
on atlas_app_documents for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

create policy "atlas app document versions admin executive read"
on atlas_app_document_versions for select to authenticated
using (atlas_has_role(array['admin','executive']));

create policy "atlas admin manages app document versions"
on atlas_app_document_versions for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

create policy "atlas active users read active edit locks"
on atlas_edit_locks for select to authenticated
using (released_at is null and atlas_current_role() <> 'anonymous');

create policy "atlas users manage own edit locks"
on atlas_edit_locks for all to authenticated
using (lock_owner = auth.uid() or atlas_has_role(array['admin']))
with check (lock_owner = auth.uid() or atlas_has_role(array['admin']));

create policy "atlas communities scoped read"
on atlas_communities for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','people'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas community aliases scoped read"
on atlas_community_aliases for select to authenticated
using (
  active is true
  and exists (
    select 1 from atlas_communities c
    where c.community_id = atlas_community_aliases.community_id
      and c.deleted_at is null
      and (atlas_has_role(array['admin','executive','people']) or atlas_can_access_community(c.community_id))
  )
);

create policy "atlas roles active user read"
on atlas_roles for select to authenticated
using (active is true and atlas_current_role() <> 'anonymous');

create policy "atlas employees scoped read"
on atlas_employees for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','people'])
    or exists (
      select 1
      from atlas_employee_assignments a
      where a.employee_id = atlas_employees.employee_id
        and a.deleted_at is null
        and atlas_can_access_community(a.community_id)
    )
  )
);

create policy "atlas shared owners insert communities"
on atlas_communities for insert to authenticated
with check (atlas_has_role(array['admin','operations','marketing','people']));

create policy "atlas shared owners update communities"
on atlas_communities for update to authenticated
using (atlas_has_role(array['admin','operations','marketing','people']))
with check (atlas_has_role(array['admin','operations','marketing','people']));

create policy "atlas shared sync events scoped read"
on atlas_shared_sync_events for select to authenticated
using (atlas_has_role(array['admin','executive','operations','marketing','people']));

create policy "atlas shared owners append sync events"
on atlas_shared_sync_events for insert to authenticated
with check (atlas_has_role(array['admin','operations','marketing','people']));

create policy "atlas mapping review scoped read"
on atlas_mapping_review_queue for select to authenticated
using (atlas_has_role(array['admin','executive','operations','marketing','people']));

create policy "atlas shared owners insert mapping reviews"
on atlas_mapping_review_queue for insert to authenticated
with check (atlas_has_role(array['admin','operations','marketing','people']));

create policy "atlas shared owners update mapping reviews"
on atlas_mapping_review_queue for update to authenticated
using (atlas_has_role(array['admin','operations','marketing','people']))
with check (atlas_has_role(array['admin','operations','marketing','people']));

create policy "atlas assignments scoped read"
on atlas_employee_assignments for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','people'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas people owners write employees"
on atlas_employees for all to authenticated
using (atlas_has_role(array['admin','people']))
with check (atlas_has_role(array['admin','people']));

create policy "atlas people owners write assignments"
on atlas_employee_assignments for all to authenticated
using (atlas_has_role(array['admin','people']))
with check (atlas_has_role(array['admin','people']));

create policy "atlas budgets scoped read"
on atlas_budget_lines for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','finance'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas finance writes budgets"
on atlas_budget_lines for all to authenticated
using (atlas_has_role(array['admin','finance']) and atlas_can_access_community(community_id))
with check (atlas_has_role(array['admin','finance']) and atlas_can_access_community(community_id));

create policy "atlas actuals scoped read"
on atlas_actual_lines for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','finance'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas finance writes actuals"
on atlas_actual_lines for all to authenticated
using (atlas_has_role(array['admin','finance']) and atlas_can_access_community(community_id))
with check (atlas_has_role(array['admin','finance']) and atlas_can_access_community(community_id));

create policy "atlas contracts scoped read"
on atlas_contracts for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','finance','maintenance'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas finance maintenance write contracts"
on atlas_contracts for all to authenticated
using (atlas_has_role(array['admin','finance','maintenance']) and atlas_can_access_community(community_id))
with check (atlas_has_role(array['admin','finance','maintenance']) and atlas_can_access_community(community_id));

create policy "atlas approved marketing metrics scoped read"
on atlas_marketing_metrics for select to authenticated
using (
  deleted_at is null
  and approved is true
  and (
    atlas_has_role(array['admin','executive'])
    or (atlas_has_role(array['marketing','bonus','regional','community_manager']) and atlas_can_access_community(community_id))
  )
);

create policy "atlas marketing writes metrics"
on atlas_marketing_metrics for all to authenticated
using (atlas_has_role(array['admin','marketing']) and atlas_can_access_community(community_id))
with check (atlas_has_role(array['admin','marketing']) and atlas_can_access_community(community_id));

create policy "atlas maintenance metrics scoped read"
on atlas_maintenance_metrics for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive'])
    or (atlas_has_role(array['maintenance','regional','community_manager']) and atlas_can_access_community(community_id))
  )
);

create policy "atlas maintenance writes metrics"
on atlas_maintenance_metrics for all to authenticated
using (atlas_has_role(array['admin','maintenance']) and atlas_can_access_community(community_id))
with check (atlas_has_role(array['admin','maintenance']) and atlas_can_access_community(community_id));

create policy "atlas moonrise sync admin maintenance read"
on atlas_moonrise_sync_runs for select to authenticated
using (atlas_has_role(array['admin','executive','maintenance']));

create policy "atlas maintenance writes moonrise sync runs"
on atlas_moonrise_sync_runs for all to authenticated
using (atlas_has_role(array['admin','maintenance']))
with check (atlas_has_role(array['admin','maintenance']));

create policy "atlas maintenance inspections scoped read"
on atlas_maintenance_inspections for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive'])
    or (atlas_has_role(array['maintenance','regional','community_manager','viewer']) and atlas_can_access_community(community_id))
  )
);

create policy "atlas maintenance writes inspections"
on atlas_maintenance_inspections for all to authenticated
using (atlas_has_role(array['admin','maintenance']) and atlas_can_access_community(community_id))
with check (atlas_has_role(array['admin','maintenance']) and atlas_can_access_community(community_id));

create policy "atlas maintenance inspection exceptions scoped read"
on atlas_maintenance_inspection_exceptions for select to authenticated
using (
  atlas_has_role(array['admin','executive'])
  or exists (
    select 1 from atlas_maintenance_inspections i
    where i.maintenance_inspection_id = atlas_maintenance_inspection_exceptions.maintenance_inspection_id
      and i.deleted_at is null
      and atlas_can_access_community(i.community_id)
  )
);

create policy "atlas maintenance writes inspection exceptions"
on atlas_maintenance_inspection_exceptions for all to authenticated
using (atlas_has_role(array['admin','maintenance']))
with check (atlas_has_role(array['admin','maintenance']));

create policy "atlas maintenance inspection snapshots read"
on atlas_maintenance_inspection_snapshots for select to authenticated
using (read_only_locked is true and atlas_has_role(array['admin','executive','maintenance']));

create policy "atlas maintenance writes inspection snapshots"
on atlas_maintenance_inspection_snapshots for all to authenticated
using (atlas_has_role(array['admin','maintenance']))
with check (atlas_has_role(array['admin','maintenance']));

create policy "atlas bonus periods role read"
on atlas_bonus_periods for select to authenticated
using (atlas_has_role(array['admin','executive','regional','community_manager','bonus','finance']));

create policy "atlas bonus writes periods"
on atlas_bonus_periods for all to authenticated
using (atlas_has_role(array['admin','bonus']))
with check (atlas_has_role(array['admin','bonus']));

create policy "atlas incentive plans role read"
on atlas_incentive_plans for select to authenticated
using (deleted_at is null and atlas_has_role(array['admin','executive','regional','community_manager','bonus','finance']));

create policy "atlas bonus writes incentive plans"
on atlas_incentive_plans for all to authenticated
using (atlas_has_role(array['admin','bonus']))
with check (atlas_has_role(array['admin','bonus']));

create policy "atlas bonus runs scoped read"
on atlas_bonus_calculation_runs for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','bonus','finance'])
    or atlas_can_access_community(community_id)
  )
);

create policy "atlas bonus writes runs"
on atlas_bonus_calculation_runs for all to authenticated
using (atlas_has_role(array['admin','bonus','finance']))
with check (atlas_has_role(array['admin','bonus','finance']));

create policy "atlas bonus lines scoped read"
on atlas_bonus_calculation_lines for select to authenticated
using (
  deleted_at is null
  and (
    atlas_has_role(array['admin','executive','bonus','finance'])
    or exists (
      select 1 from atlas_bonus_calculation_runs r
      where r.bonus_calculation_run_id = atlas_bonus_calculation_lines.bonus_calculation_run_id
        and r.deleted_at is null
        and atlas_can_access_community(r.community_id)
    )
    or exists (
      select 1 from atlas_employee_assignments a
      where a.assignment_id = atlas_bonus_calculation_lines.assignment_id
        and a.deleted_at is null
        and atlas_can_access_community(a.community_id)
    )
  )
);

create policy "atlas bonus writes lines"
on atlas_bonus_calculation_lines for all to authenticated
using (atlas_has_role(array['admin','bonus','finance']))
with check (atlas_has_role(array['admin','bonus','finance']));

create policy "atlas migration runs admin executive read"
on atlas_migration_runs for select to authenticated
using (atlas_has_role(array['admin','executive']));

create policy "atlas admin manages migration runs"
on atlas_migration_runs for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

create policy "atlas snapshots admin executive read"
on atlas_legacy_snapshots for select to authenticated
using (atlas_has_role(array['admin','executive']));

create policy "atlas admin manages immutable legacy snapshots"
on atlas_legacy_snapshots for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

create policy "atlas mapping logs admin executive read"
on atlas_mapping_log for select to authenticated
using (atlas_has_role(array['admin','executive']));

create policy "atlas admin manages mapping logs"
on atlas_mapping_log for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

create unique index if not exists idx_atlas_community_aliases_source_alias
on atlas_community_aliases(source_module, lower(alias));

create index if not exists idx_atlas_app_documents_key
on atlas_app_documents(document_key, deleted_at);

create index if not exists idx_atlas_app_document_versions_key
on atlas_app_document_versions(document_key, version desc);

create index if not exists idx_atlas_employee_assignments_effective
on atlas_employee_assignments(employee_id, community_id, effective_start, effective_end);

create index if not exists idx_atlas_marketing_metrics_period
on atlas_marketing_metrics(community_id, period_key, metric_key, approved);

create index if not exists idx_atlas_budget_lines_period
on atlas_budget_lines(community_id, period_key, account_code);

create index if not exists idx_atlas_actual_lines_period
on atlas_actual_lines(community_id, period_key, account_code);

create index if not exists idx_atlas_mapping_log_source
on atlas_mapping_log(source_module, source_entity, source_identifier);

create index if not exists idx_atlas_communities_sync
on atlas_communities(last_sync_at, last_sync_source);

create index if not exists idx_atlas_communities_manager_emails
on atlas_communities(lower(general_manager_email), lower(regional_manager_email));

create index if not exists idx_atlas_shared_sync_events_entity
on atlas_shared_sync_events(entity_type, entity_id, created_at desc);

create index if not exists idx_atlas_mapping_review_queue_status
on atlas_mapping_review_queue(status, created_at desc);

revoke execute on function atlas_current_role() from public;
revoke execute on function atlas_current_role() from anon;
revoke execute on function atlas_can_write(text[]) from public;
revoke execute on function atlas_can_write(text[]) from anon;
revoke execute on function atlas_has_role(text[]) from public;
revoke execute on function atlas_has_role(text[]) from anon;
revoke execute on function atlas_current_allowed_community_ids() from public;
revoke execute on function atlas_current_allowed_community_ids() from anon;
revoke execute on function atlas_can_access_community(uuid) from public;
revoke execute on function atlas_can_access_community(uuid) from anon;
revoke execute on function atlas_hash_payload(jsonb) from public;
revoke execute on function atlas_hash_payload(jsonb) from anon;
revoke execute on function atlas_claim_first_admin(text) from public;
revoke execute on function atlas_claim_first_admin(text) from anon;
revoke execute on function atlas_update_app_document(text, text, jsonb, integer, text, text, jsonb) from public;
revoke execute on function atlas_update_app_document(text, text, jsonb, integer, text, text, jsonb) from anon;
revoke execute on function atlas_upload_legacy_snapshot(text, text, text, text, jsonb, jsonb) from public;
revoke execute on function atlas_upload_legacy_snapshot(text, text, text, text, jsonb, jsonb) from anon;
revoke execute on function atlas_lookup_or_create_community(text, text, boolean) from public;
revoke execute on function atlas_lookup_or_create_community(text, text, boolean) from anon;
revoke execute on function atlas_upsert_people_directory(jsonb, uuid, boolean) from public;
revoke execute on function atlas_upsert_people_directory(jsonb, uuid, boolean) from anon;
revoke execute on function atlas_upsert_marketing_metrics(jsonb, boolean) from public;
revoke execute on function atlas_upsert_marketing_metrics(jsonb, boolean) from anon;
revoke execute on function atlas_upsert_maintenance_inspections(jsonb, boolean) from public;
revoke execute on function atlas_upsert_maintenance_inspections(jsonb, boolean) from anon;
revoke execute on function atlas_record_bonus_calculation(text, integer, text, date, date, jsonb, text) from public;
revoke execute on function atlas_record_bonus_calculation(text, integer, text, date, date, jsonb, text) from anon;

grant execute on function atlas_current_role() to authenticated;
grant execute on function atlas_can_write(text[]) to authenticated;
grant execute on function atlas_has_role(text[]) to authenticated;
grant execute on function atlas_current_allowed_community_ids() to authenticated;
grant execute on function atlas_can_access_community(uuid) to authenticated;
grant execute on function atlas_claim_first_admin(text) to authenticated;

-- Phase 4: live access controls, pending employee access, and presence.
-- Browser users can never hold a service-role key, so employee access records
-- are staged as invites/profiles here while password creation stays in
-- Supabase Auth's normal signup/reset flow.

alter table atlas_user_profiles
  add column if not exists employee_id uuid references atlas_employees(employee_id),
  add column if not exists allowed_market_values text[] not null default '{}',
  add column if not exists allowed_region_values text[] not null default '{}',
  add column if not exists locked_tab_ids text[] not null default '{}',
  add column if not exists locked_page_keys text[] not null default '{}',
  add column if not exists access_notes text,
  add column if not exists last_access_reviewed_at timestamptz;

create index if not exists idx_atlas_user_profiles_employee_id
on atlas_user_profiles(employee_id);

create table if not exists atlas_user_access_invites (
  invite_id uuid primary key default gen_random_uuid(),
  email text not null unique,
  employee_id uuid references atlas_employees(employee_id),
  display_name text not null,
  role text not null check (role in ('admin','executive','regional','community_manager','people','marketing','maintenance','finance','bonus','viewer')),
  status text not null default 'pending' check (status in ('pending','active','suspended','disabled','revoked')),
  allowed_community_ids uuid[] not null default '{}',
  allowed_market_values text[] not null default '{}',
  allowed_region_values text[] not null default '{}',
  locked_tab_ids text[] not null default '{}',
  locked_page_keys text[] not null default '{}',
  access_notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  claimed_user_id uuid references auth.users(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_atlas_user_access_invites_email
on atlas_user_access_invites(lower(email));

create table if not exists atlas_live_sessions (
  session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null,
  current_tab text,
  current_page text,
  current_community_id uuid,
  current_community_name text,
  user_agent text,
  signed_in_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_atlas_live_sessions_seen
on atlas_live_sessions(last_seen_at desc);

create index if not exists idx_atlas_live_sessions_user_id
on atlas_live_sessions(user_id);

alter table atlas_user_access_invites enable row level security;
alter table atlas_live_sessions enable row level security;

drop policy if exists "atlas admin manages access invites" on atlas_user_access_invites;
create policy "atlas admin manages access invites"
on atlas_user_access_invites for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

drop policy if exists "atlas active users read live sessions" on atlas_live_sessions;
create policy "atlas active users read live sessions"
on atlas_live_sessions for select to authenticated
using (atlas_current_role() <> 'anonymous');

drop policy if exists "atlas users manage own live session" on atlas_live_sessions;
drop policy if exists "atlas users insert own live session" on atlas_live_sessions;
create policy "atlas users insert own live session"
on atlas_live_sessions for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "atlas users update own live session" on atlas_live_sessions;
create policy "atlas users update own live session"
on atlas_live_sessions for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "atlas users delete own live session" on atlas_live_sessions;
create policy "atlas users delete own live session"
on atlas_live_sessions for delete to authenticated
using (user_id = auth.uid());

create or replace function atlas_claim_first_admin(
  p_display_name text default null
)
returns table(user_id uuid, email text, display_name text, role text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_email text;
  v_display_name text;
  v_profile atlas_user_profiles%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication is required before claiming the first Atlas admin.' using errcode = '28000';
  end if;

  if exists (
    select 1
    from atlas_user_profiles aup
    where aup.role = 'admin'
      and aup.status = 'active'
  ) then
    raise exception 'An active Atlas admin already exists.' using errcode = '42501';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', (select u.email from auth.users u where u.id = v_user_id)));
  if nullif(v_email, '') is null then
    raise exception 'The authenticated user does not have an email address.' using errcode = '22023';
  end if;

  if v_email !~* '^[^@]+@(risere|riseresidential)[.]com$' then
    raise exception 'Only a RISE company email can claim the first Atlas admin.' using errcode = '42501';
  end if;

  v_display_name := nullif(trim(coalesce(p_display_name, split_part(v_email, '@', 1))), '');

  insert into atlas_user_profiles(user_id, email, display_name, role, status)
  values (v_user_id, v_email, coalesce(v_display_name, v_email), 'admin', 'active')
  on conflict (user_id) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        role = 'admin',
        status = 'active',
        updated_at = now()
  returning * into v_profile;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (
    v_user_id,
    'first_admin_claimed',
    'atlas_user_profiles',
    v_profile.user_id::text,
    'central_platform_setup',
    null,
    to_jsonb(v_profile),
    jsonb_build_object('guardrail', 'only_when_no_active_admin_exists')
  );

  return query
  select v_profile.user_id, v_profile.email, v_profile.display_name, v_profile.role, v_profile.status;
end;
$$;

create or replace function atlas_claim_invited_profile(
  p_display_name text default null
)
returns table(user_id uuid, email text, display_name text, role text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_email text;
  v_invite atlas_user_access_invites%rowtype;
  v_profile atlas_user_profiles%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication is required before claiming Atlas access.' using errcode = '28000';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', (select u.email from auth.users u where u.id = v_user_id)));
  if nullif(v_email, '') is null then
    raise exception 'The authenticated user does not have an email address.' using errcode = '22023';
  end if;

  select *
  into v_invite
  from atlas_user_access_invites aui
  where lower(aui.email) = v_email
    and aui.status in ('pending','active')
  order by aui.updated_at desc
  limit 1;

  if v_invite.invite_id is null then
    raise exception 'No active Atlas access invite was found for this email.' using errcode = '42501';
  end if;

  insert into atlas_user_profiles(
    user_id, email, display_name, role, status, employee_id, allowed_community_ids,
    allowed_market_values, allowed_region_values, locked_tab_ids, locked_page_keys,
    access_notes, last_access_reviewed_at
  )
  values (
    v_user_id,
    v_email,
    coalesce(nullif(trim(p_display_name), ''), v_invite.display_name, v_email),
    v_invite.role,
    'active',
    v_invite.employee_id,
    v_invite.allowed_community_ids,
    v_invite.allowed_market_values,
    v_invite.allowed_region_values,
    v_invite.locked_tab_ids,
    v_invite.locked_page_keys,
    v_invite.access_notes,
    now()
  )
  on conflict (user_id) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        role = excluded.role,
        status = excluded.status,
        employee_id = excluded.employee_id,
        allowed_community_ids = excluded.allowed_community_ids,
        allowed_market_values = excluded.allowed_market_values,
        allowed_region_values = excluded.allowed_region_values,
        locked_tab_ids = excluded.locked_tab_ids,
        locked_page_keys = excluded.locked_page_keys,
        access_notes = excluded.access_notes,
        last_access_reviewed_at = now(),
        updated_at = now()
  returning * into v_profile;

  update atlas_user_access_invites aui
  set status = 'active',
      claimed_user_id = v_user_id,
      claimed_at = coalesce(aui.claimed_at, now()),
      updated_at = now()
  where aui.invite_id = v_invite.invite_id;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (v_user_id, 'access_invite_claimed', 'atlas_user_profiles', v_profile.user_id::text, 'user_access', to_jsonb(v_invite), to_jsonb(v_profile), jsonb_build_object('invite_id', v_invite.invite_id));

  return query
  select v_profile.user_id, v_profile.email, v_profile.display_name, v_profile.role, v_profile.status;
end;
$$;

create or replace function atlas_admin_upsert_user_access(
  p_email text,
  p_display_name text,
  p_role text,
  p_status text default 'pending',
  p_employee_id uuid default null,
  p_allowed_community_ids uuid[] default '{}',
  p_allowed_market_values text[] default '{}',
  p_allowed_region_values text[] default '{}',
  p_locked_tab_ids text[] default '{}',
  p_locked_page_keys text[] default '{}',
  p_access_notes text default null
)
returns table(email text, profile_user_id uuid, invite_id uuid, status text, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_email text;
  v_user_id uuid;
  v_invite_id uuid;
begin
  v_actor := auth.uid();
  if v_actor is null or not atlas_has_role(array['admin']) then
    raise exception 'Only an active Atlas admin can manage user access.' using errcode = '42501';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email !~* '^[^@]+@(risere|riseresidential)[.]com$' then
    raise exception 'Enter a valid RISE company email address.' using errcode = '22023';
  end if;

  if p_role is null or p_role not in ('admin','executive','regional','community_manager','people','marketing','maintenance','finance','bonus','viewer') then
    raise exception 'Invalid Atlas role.' using errcode = '22023';
  end if;

  if coalesce(p_status, 'pending') not in ('pending','active','suspended','disabled','revoked') then
    raise exception 'Invalid Atlas access status.' using errcode = '22023';
  end if;

  select u.id
  into v_user_id
  from auth.users u
  where lower(u.email) = v_email
  order by u.created_at desc
  limit 1;

  insert into atlas_user_access_invites(
    email, employee_id, display_name, role, status, allowed_community_ids,
    allowed_market_values, allowed_region_values, locked_tab_ids, locked_page_keys,
    access_notes, created_by, updated_by, claimed_user_id, claimed_at
  )
  values (
    v_email,
    p_employee_id,
    coalesce(nullif(trim(p_display_name), ''), v_email),
    p_role,
    coalesce(p_status, 'pending'),
    coalesce(p_allowed_community_ids, '{}'),
    coalesce(p_allowed_market_values, '{}'),
    coalesce(p_allowed_region_values, '{}'),
    coalesce(p_locked_tab_ids, '{}'),
    coalesce(p_locked_page_keys, '{}'),
    p_access_notes,
    v_actor,
    v_actor,
    v_user_id,
    case when v_user_id is null then null else now() end
  )
  on conflict (email) do update
    set employee_id = excluded.employee_id,
        display_name = excluded.display_name,
        role = excluded.role,
        status = excluded.status,
        allowed_community_ids = excluded.allowed_community_ids,
        allowed_market_values = excluded.allowed_market_values,
        allowed_region_values = excluded.allowed_region_values,
        locked_tab_ids = excluded.locked_tab_ids,
        locked_page_keys = excluded.locked_page_keys,
        access_notes = excluded.access_notes,
        updated_by = v_actor,
        claimed_user_id = coalesce(excluded.claimed_user_id, atlas_user_access_invites.claimed_user_id),
        claimed_at = coalesce(atlas_user_access_invites.claimed_at, excluded.claimed_at),
        updated_at = now()
  returning atlas_user_access_invites.invite_id into v_invite_id;

  if v_user_id is not null then
    insert into atlas_user_profiles(
      user_id, email, display_name, role, status, employee_id, allowed_community_ids,
      allowed_market_values, allowed_region_values, locked_tab_ids, locked_page_keys,
      access_notes, last_access_reviewed_at
    )
    values (
      v_user_id,
      v_email,
      coalesce(nullif(trim(p_display_name), ''), v_email),
      p_role,
      case
        when coalesce(p_status, 'pending') in ('suspended','disabled') then p_status
        when coalesce(p_status, 'pending') = 'revoked' then 'disabled'
        else 'active'
      end,
      p_employee_id,
      coalesce(p_allowed_community_ids, '{}'),
      coalesce(p_allowed_market_values, '{}'),
      coalesce(p_allowed_region_values, '{}'),
      coalesce(p_locked_tab_ids, '{}'),
      coalesce(p_locked_page_keys, '{}'),
      p_access_notes,
      now()
    )
    on conflict (user_id) do update
      set email = excluded.email,
          display_name = excluded.display_name,
          role = excluded.role,
          status = excluded.status,
          employee_id = excluded.employee_id,
          allowed_community_ids = excluded.allowed_community_ids,
          allowed_market_values = excluded.allowed_market_values,
          allowed_region_values = excluded.allowed_region_values,
          locked_tab_ids = excluded.locked_tab_ids,
          locked_page_keys = excluded.locked_page_keys,
          access_notes = excluded.access_notes,
          last_access_reviewed_at = now(),
          updated_at = now();
  end if;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (v_actor, 'user_access_upserted', 'atlas_user_access_invites', v_email, 'user_access', null, jsonb_build_object('email', v_email, 'role', p_role, 'status', p_status), jsonb_build_object('profile_user_id', v_user_id, 'invite_id', v_invite_id));

  return query
  select v_email, v_user_id, v_invite_id, coalesce(p_status, 'pending'), p_role;
end;
$$;

create or replace function atlas_upsert_live_session(
  p_session_id text,
  p_current_tab text default null,
  p_current_page text default null,
  p_current_community_id uuid default null,
  p_current_community_name text default null,
  p_user_agent text default null
)
returns table(session_id text, user_id uuid, email text, display_name text, role text, current_page text, current_community_name text, last_seen_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile atlas_user_profiles%rowtype;
  v_session_id text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required for Atlas live presence.' using errcode = '28000';
  end if;

  select *
  into v_profile
  from atlas_user_profiles aup
  where aup.user_id = auth.uid()
    and aup.status = 'active';

  if v_profile.user_id is null then
    raise exception 'An active Atlas user profile is required for live presence.' using errcode = '42501';
  end if;

  v_session_id := nullif(trim(coalesce(p_session_id, '')), '');
  if v_session_id is null then
    v_session_id := auth.uid()::text;
  end if;

  insert into atlas_live_sessions(
    session_id, user_id, email, display_name, role, current_tab, current_page,
    current_community_id, current_community_name, user_agent, signed_in_at, last_seen_at
  )
  values (
    v_session_id,
    v_profile.user_id,
    v_profile.email,
    v_profile.display_name,
    v_profile.role,
    p_current_tab,
    p_current_page,
    p_current_community_id,
    p_current_community_name,
    left(coalesce(p_user_agent, ''), 500),
    now(),
    now()
  )
  on conflict on constraint atlas_live_sessions_pkey do update
    set email = excluded.email,
        display_name = excluded.display_name,
        role = excluded.role,
        current_tab = excluded.current_tab,
        current_page = excluded.current_page,
        current_community_id = excluded.current_community_id,
        current_community_name = excluded.current_community_name,
        user_agent = excluded.user_agent,
        last_seen_at = now()
  where atlas_live_sessions.user_id = auth.uid();

  return query
  select s.session_id, s.user_id, s.email, s.display_name, s.role, s.current_page, s.current_community_name, s.last_seen_at
  from atlas_live_sessions s
  where s.session_id = v_session_id;
end;
$$;

create or replace function atlas_end_live_session(p_session_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  delete from atlas_live_sessions als
  where als.session_id = p_session_id
    and als.user_id = auth.uid();
  return true;
end;
$$;

revoke execute on function atlas_claim_invited_profile(text) from public;
revoke execute on function atlas_claim_invited_profile(text) from anon;
revoke execute on function atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text) from public;
revoke execute on function atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text) from anon;
revoke execute on function atlas_upsert_live_session(text,text,text,uuid,text,text) from public;
revoke execute on function atlas_upsert_live_session(text,text,text,uuid,text,text) from anon;
revoke execute on function atlas_end_live_session(text) from public;
revoke execute on function atlas_end_live_session(text) from anon;

grant select, insert, update, delete on atlas_user_access_invites to authenticated;
grant select, insert, update, delete on atlas_live_sessions to authenticated;
grant execute on function atlas_claim_invited_profile(text) to authenticated;
grant execute on function atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text) to authenticated;
grant execute on function atlas_upsert_live_session(text,text,text,uuid,text,text) to authenticated;
grant execute on function atlas_end_live_session(text) to authenticated;
grant execute on function atlas_update_app_document(text, text, jsonb, integer, text, text, jsonb) to authenticated;
grant execute on function atlas_upload_legacy_snapshot(text, text, text, text, jsonb, jsonb) to authenticated;
grant execute on function atlas_upsert_people_directory(jsonb, uuid, boolean) to authenticated;
grant execute on function atlas_upsert_marketing_metrics(jsonb, boolean) to authenticated;
grant execute on function atlas_upsert_maintenance_inspections(jsonb, boolean) to authenticated;
grant execute on function atlas_record_bonus_calculation(text, integer, text, date, date, jsonb, text) to authenticated;
