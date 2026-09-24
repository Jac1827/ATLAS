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

alter table atlas_shared_sync_events enable row level security;
alter table atlas_mapping_review_queue enable row level security;

drop policy if exists "atlas shared owners insert communities" on atlas_communities;
create policy "atlas shared owners insert communities"
on atlas_communities for insert to authenticated
with check (atlas_has_role(array['admin','operations','marketing','people']));

drop policy if exists "atlas shared owners update communities" on atlas_communities;
create policy "atlas shared owners update communities"
on atlas_communities for update to authenticated
using (atlas_has_role(array['admin','operations','marketing','people']))
with check (atlas_has_role(array['admin','operations','marketing','people']));

drop policy if exists "atlas shared sync events scoped read" on atlas_shared_sync_events;
create policy "atlas shared sync events scoped read"
on atlas_shared_sync_events for select to authenticated
using (atlas_has_role(array['admin','executive','operations','marketing','people']));

drop policy if exists "atlas shared owners append sync events" on atlas_shared_sync_events;
create policy "atlas shared owners append sync events"
on atlas_shared_sync_events for insert to authenticated
with check (atlas_has_role(array['admin','operations','marketing','people']));

drop policy if exists "atlas mapping review scoped read" on atlas_mapping_review_queue;
create policy "atlas mapping review scoped read"
on atlas_mapping_review_queue for select to authenticated
using (atlas_has_role(array['admin','executive','operations','marketing','people']));

drop policy if exists "atlas shared owners manage mapping reviews" on atlas_mapping_review_queue;
create policy "atlas shared owners manage mapping reviews"
on atlas_mapping_review_queue for all to authenticated
using (atlas_has_role(array['admin','operations','marketing','people']))
with check (atlas_has_role(array['admin','operations','marketing','people']));

create index if not exists idx_atlas_communities_sync
on atlas_communities(last_sync_at, last_sync_source);

create index if not exists idx_atlas_communities_manager_emails
on atlas_communities(lower(general_manager_email), lower(regional_manager_email));

create index if not exists idx_atlas_shared_sync_events_entity
on atlas_shared_sync_events(entity_type, entity_id, created_at desc);

create index if not exists idx_atlas_mapping_review_queue_status
on atlas_mapping_review_queue(status, created_at desc);