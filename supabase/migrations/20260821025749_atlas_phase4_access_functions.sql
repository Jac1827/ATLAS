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
    select 1 from atlas_user_profiles where role = 'admin' and status = 'active'
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
  values (v_user_id, 'first_admin_claimed', 'atlas_user_profiles', v_profile.user_id::text, 'central_platform_setup', null, to_jsonb(v_profile), jsonb_build_object('guardrail', 'only_when_no_active_admin_exists'));

  return query select v_profile.user_id, v_profile.email, v_profile.display_name, v_profile.role, v_profile.status;
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

  select * into v_invite
  from atlas_user_access_invites
  where lower(email) = v_email and status in ('pending','active')
  order by updated_at desc
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
    v_user_id, v_email, coalesce(nullif(trim(p_display_name), ''), v_invite.display_name, v_email),
    v_invite.role, 'active', v_invite.employee_id, v_invite.allowed_community_ids,
    v_invite.allowed_market_values, v_invite.allowed_region_values, v_invite.locked_tab_ids,
    v_invite.locked_page_keys, v_invite.access_notes, now()
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

  update atlas_user_access_invites
  set status = 'active', claimed_user_id = v_user_id, claimed_at = coalesce(claimed_at, now()), updated_at = now()
  where invite_id = v_invite.invite_id;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (v_user_id, 'access_invite_claimed', 'atlas_user_profiles', v_profile.user_id::text, 'user_access', to_jsonb(v_invite), to_jsonb(v_profile), jsonb_build_object('invite_id', v_invite.invite_id));

  return query select v_profile.user_id, v_profile.email, v_profile.display_name, v_profile.role, v_profile.status;
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

  select id into v_user_id from auth.users where lower(email) = v_email order by created_at desc limit 1;

  insert into atlas_user_access_invites(
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
  returning atlas_user_access_invites.invite_id into v_invite_id;

  if v_user_id is not null then
    insert into atlas_user_profiles(
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

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (v_actor, 'user_access_upserted', 'atlas_user_access_invites', v_email, 'user_access', null, jsonb_build_object('email', v_email, 'role', p_role, 'status', p_status), jsonb_build_object('profile_user_id', v_user_id, 'invite_id', v_invite_id));

  return query select v_email, v_user_id, v_invite_id, coalesce(p_status, 'pending'), p_role;
end;
$$;

revoke execute on function atlas_claim_invited_profile(text) from public;
revoke execute on function atlas_claim_invited_profile(text) from anon;
revoke execute on function atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text) from public;
revoke execute on function atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text) from anon;

grant execute on function atlas_claim_invited_profile(text) to authenticated;
grant execute on function atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text) to authenticated;