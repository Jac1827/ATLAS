begin;

alter table public.atlas_user_profiles
  add column if not exists profile_image_url text;

alter table public.atlas_live_sessions
  add column if not exists profile_image_url text;

alter table public.atlas_user_profiles
  drop constraint if exists atlas_user_profiles_role_check;
alter table public.atlas_user_profiles
  add constraint atlas_user_profiles_role_check
  check (role = any (array['admin','centra','executive','regional','community_manager','people','marketing','maintenance','finance','bonus','viewer']));

alter table public.atlas_user_access_invites
  drop constraint if exists atlas_user_access_invites_role_check;
alter table public.atlas_user_access_invites
  add constraint atlas_user_access_invites_role_check
  check (role = any (array['admin','centra','executive','regional','community_manager','people','marketing','maintenance','finance','bonus','viewer']));

drop policy if exists "atlas users update own profile" on public.atlas_user_profiles;
create policy "atlas users update own profile"
on public.atlas_user_profiles for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.atlas_can_access_community(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    atlas_has_role(array['admin','centra','executive'])
    or (
      p_community_id is not null
      and p_community_id = any(atlas_current_allowed_community_ids())
    );
$$;

create or replace function public.atlas_update_current_profile(
  p_display_name text default null,
  p_profile_image_url text default null
)
returns table(user_id uuid, email text, display_name text, profile_image_url text, role text, status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid;
  v_profile public.atlas_user_profiles%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication is required before updating the Atlas profile.' using errcode = '28000';
  end if;

  update public.atlas_user_profiles
  set display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
      profile_image_url = nullif(trim(coalesce(p_profile_image_url, '')), ''),
      updated_at = now()
  where user_id = v_user_id
    and status = 'active'
  returning * into v_profile;

  if v_profile.user_id is null then
    raise exception 'An active Atlas user profile is required before updating profile settings.' using errcode = '42501';
  end if;

  insert into public.atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (
    v_user_id,
    'profile_updated',
    'atlas_user_profiles',
    v_profile.user_id::text,
    'user_profile',
    null,
    jsonb_build_object('display_name', v_profile.display_name, 'profile_image_url', v_profile.profile_image_url),
    jsonb_build_object('self_service', true)
  );

  return query
  select v_profile.user_id, v_profile.email, v_profile.display_name, v_profile.profile_image_url, v_profile.role, v_profile.status;
end;
$$;

revoke execute on function public.atlas_update_current_profile(text, text) from public;
revoke execute on function public.atlas_update_current_profile(text, text) from anon;
grant execute on function public.atlas_update_current_profile(text, text) to authenticated;

create or replace function public.atlas_admin_upsert_user_access(
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

  if p_role is null or p_role not in ('admin','centra','executive','regional','community_manager','people','marketing','maintenance','finance','bonus','viewer') then
    raise exception 'Invalid Atlas role.' using errcode = '22023';
  end if;

  if coalesce(p_status, 'pending') not in ('pending','active','suspended','disabled','revoked') then
    raise exception 'Invalid Atlas access status.' using errcode = '22023';
  end if;

  select u.id into v_user_id from auth.users u where lower(u.email) = v_email order by u.created_at desc limit 1;

  insert into public.atlas_user_access_invites(
    email, employee_id, display_name, role, status, allowed_community_ids,
    allowed_market_values, allowed_region_values, locked_tab_ids, locked_page_keys,
    access_notes, created_by, updated_by, claimed_user_id, claimed_at
  )
  values (
    v_email, p_employee_id, coalesce(nullif(trim(p_display_name), ''), v_email), p_role,
    coalesce(p_status, 'pending'), coalesce(p_allowed_community_ids, '{}'),
    coalesce(p_allowed_market_values, '{}'), coalesce(p_allowed_region_values, '{}'),
    coalesce(p_locked_tab_ids, '{}'), coalesce(p_locked_page_keys, '{}'), p_access_notes,
    v_actor, v_actor, v_user_id, case when v_user_id is null then null else now() end
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
  returning public.atlas_user_access_invites.invite_id into v_invite_id;

  if v_user_id is not null then
    insert into public.atlas_user_profiles(
      user_id, email, display_name, role, status, employee_id, allowed_community_ids,
      allowed_market_values, allowed_region_values, locked_tab_ids, locked_page_keys,
      access_notes, last_access_reviewed_at
    )
    values (
      v_user_id, v_email, coalesce(nullif(trim(p_display_name), ''), v_email), p_role,
      case when coalesce(p_status, 'pending') in ('suspended','disabled') then p_status when coalesce(p_status, 'pending') = 'revoked' then 'disabled' else 'active' end,
      p_employee_id, coalesce(p_allowed_community_ids, '{}'), coalesce(p_allowed_market_values, '{}'),
      coalesce(p_allowed_region_values, '{}'), coalesce(p_locked_tab_ids, '{}'), coalesce(p_locked_page_keys, '{}'),
      p_access_notes, now()
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

  insert into public.atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (v_actor, 'user_access_upserted', 'atlas_user_access_invites', v_email, 'user_access', null, jsonb_build_object('email', v_email, 'role', p_role, 'status', p_status), jsonb_build_object('profile_user_id', v_user_id, 'invite_id', v_invite_id));

  return query select v_email, v_user_id, v_invite_id, coalesce(p_status, 'pending'), p_role;
end;
$$;

create or replace function public.atlas_upsert_live_session(
  p_session_id text,
  p_current_tab text default null,
  p_current_page text default null,
  p_current_community_id uuid default null,
  p_current_community_name text default null,
  p_user_agent text default null
)
returns table(session_id text, user_id uuid, email text, display_name text, role text, current_page text, current_community_name text, last_seen_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile public.atlas_user_profiles%rowtype;
  v_session_id text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required for Atlas live presence.' using errcode = '28000';
  end if;

  select * into v_profile
  from public.atlas_user_profiles aup
  where aup.user_id = auth.uid()
    and aup.status = 'active';

  if v_profile.user_id is null then
    raise exception 'An active Atlas user profile is required for live presence.' using errcode = '42501';
  end if;

  v_session_id := nullif(trim(coalesce(p_session_id, '')), '');
  if v_session_id is null then
    v_session_id := auth.uid()::text;
  end if;

  insert into public.atlas_live_sessions(
    session_id, user_id, email, display_name, profile_image_url, role, current_tab, current_page,
    current_community_id, current_community_name, user_agent, signed_in_at, last_seen_at
  )
  values (
    v_session_id,
    v_profile.user_id,
    v_profile.email,
    v_profile.display_name,
    v_profile.profile_image_url,
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
        profile_image_url = excluded.profile_image_url,
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
  from public.atlas_live_sessions s
  where s.session_id = v_session_id;
end;
$$;

commit;