-- Marketing Command Center shared ATLAS links
-- Applied to project dgkedyzdhneiypqeimhd on 2026-08-20.
-- The migration is additive and preserves existing Marketing row shapes while
-- allowing records to point at canonical ATLAS communities and people.

alter table public.properties
  add column if not exists community_id text,
  add column if not exists atlas_community_id uuid,
  add column if not exists canonical_name text,
  add column if not exists aliases text[] not null default '{}',
  add column if not exists owning_portfolio text,
  add column if not exists scope_selections jsonb not null default '[]'::jsonb,
  add column if not exists gm_employee_id uuid,
  add column if not exists regional_employee_id uuid,
  add column if not exists shared_sync_status text not null default 'pending',
  add column if not exists shared_sync_source text,
  add column if not exists shared_sync_updated_at timestamptz,
  add column if not exists shared_review_flags jsonb not null default '[]'::jsonb;

alter table public.team_members
  add column if not exists people_employee_id uuid,
  add column if not exists people_employee_number text,
  add column if not exists people_employee_name text,
  add column if not exists people_employee_status text,
  add column if not exists people_employee_community text,
  add column if not exists people_employee_role text,
  add column if not exists people_linked_at timestamptz,
  add column if not exists community_ids text[] not null default '{}',
  add column if not exists atlas_community_ids uuid[] not null default '{}';

alter table public.approvers
  add column if not exists people_employee_id uuid,
  add column if not exists people_employee_number text,
  add column if not exists people_linked_at timestamptz,
  add column if not exists community_ids text[] not null default '{}',
  add column if not exists atlas_community_ids uuid[] not null default '{}';

alter table public.tickets
  add column if not exists community_id text,
  add column if not exists atlas_community_id uuid,
  add column if not exists assigned_employee_id uuid,
  add column if not exists submitted_by_user_id uuid;

alter table public.documents
  add column if not exists community_id text,
  add column if not exists atlas_community_id uuid;

alter table public.satisfaction_ratings
  add column if not exists community_id text,
  add column if not exists atlas_community_id uuid;

alter table public.sla_rules
  add column if not exists community_ids text[] not null default '{}',
  add column if not exists atlas_community_ids uuid[] not null default '{}',
  add column if not exists portfolio_id text,
  add column if not exists shared_scope jsonb not null default '{}'::jsonb,
  add column if not exists shared_sync_updated_at timestamptz;

alter table public.approval_rules
  add column if not exists community_ids text[] not null default '{}',
  add column if not exists atlas_community_ids uuid[] not null default '{}',
  add column if not exists portfolio_id text,
  add column if not exists shared_scope jsonb not null default '{}'::jsonb,
  add column if not exists shared_sync_updated_at timestamptz;

alter table public.routing_rules
  add column if not exists community_ids text[] not null default '{}',
  add column if not exists atlas_community_ids uuid[] not null default '{}',
  add column if not exists portfolio_id text,
  add column if not exists shared_scope jsonb not null default '{}'::jsonb,
  add column if not exists shared_sync_updated_at timestamptz;

alter table public.skills
  add column if not exists community_ids text[] not null default '{}',
  add column if not exists atlas_community_ids uuid[] not null default '{}',
  add column if not exists shared_scope jsonb not null default '{}'::jsonb;

alter table public.bonus_settings
  add column if not exists community_ids text[] not null default '{}',
  add column if not exists atlas_community_ids uuid[] not null default '{}',
  add column if not exists portfolio_id text,
  add column if not exists shared_scope jsonb not null default '{}'::jsonb,
  add column if not exists shared_sync_updated_at timestamptz;

alter table public.mcc_users
  add column if not exists people_employee_id uuid,
  add column if not exists people_linked_at timestamptz;

create index if not exists properties_community_id_idx on public.properties (community_id);
create index if not exists properties_atlas_community_id_idx on public.properties (atlas_community_id);
create index if not exists properties_gm_employee_id_idx on public.properties (gm_employee_id);
create index if not exists properties_regional_employee_id_idx on public.properties (regional_employee_id);
create index if not exists team_members_people_employee_id_idx on public.team_members (people_employee_id);
create index if not exists approvers_people_employee_id_idx on public.approvers (people_employee_id);
create index if not exists tickets_community_id_idx on public.tickets (community_id);
create index if not exists tickets_atlas_community_id_idx on public.tickets (atlas_community_id);
