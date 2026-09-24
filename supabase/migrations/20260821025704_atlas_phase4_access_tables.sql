alter table atlas_user_profiles
  add column if not exists employee_id uuid references atlas_employees(employee_id),
  add column if not exists allowed_market_values text[] not null default '{}',
  add column if not exists allowed_region_values text[] not null default '{}',
  add column if not exists locked_tab_ids text[] not null default '{}',
  add column if not exists locked_page_keys text[] not null default '{}',
  add column if not exists access_notes text,
  add column if not exists last_access_reviewed_at timestamptz;

create index if not exists idx_atlas_user_profiles_employee_id on atlas_user_profiles(employee_id);

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

create index if not exists idx_atlas_user_access_invites_email on atlas_user_access_invites(lower(email));

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

create index if not exists idx_atlas_live_sessions_seen on atlas_live_sessions(last_seen_at desc);

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
create policy "atlas users manage own live session"
on atlas_live_sessions for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update, delete on atlas_user_access_invites to authenticated;
grant select, insert, update, delete on atlas_live_sessions to authenticated;