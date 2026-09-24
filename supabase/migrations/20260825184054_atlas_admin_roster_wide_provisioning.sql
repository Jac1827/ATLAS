alter table atlas_user_profiles
  add column if not exists account_status text not null default 'active'
    check (account_status in ('not_invited','invitation_sent','invitation_expired','activation_pending','active','password_reset_required','authentication_error'));

alter table atlas_user_access_invites
  add column if not exists access_status text not null default 'active'
    check (access_status in ('active','disabled')),
  add column if not exists account_status text not null default 'not_invited'
    check (account_status in ('not_invited','invitation_sent','invitation_expired','activation_pending','active','password_reset_required','authentication_error')),
  add column if not exists auth_user_id uuid references auth.users(id),
  add column if not exists invitation_sent_at timestamptz,
  add column if not exists invitation_expires_at timestamptz,
  add column if not exists invitation_accepted_at timestamptz,
  add column if not exists password_reset_sent_at timestamptz,
  add column if not exists last_invite_error text;

create index if not exists idx_atlas_user_access_invites_account_status
on atlas_user_access_invites(account_status);

create index if not exists idx_atlas_user_access_invites_auth_user_id
on atlas_user_access_invites(auth_user_id);

drop policy if exists "atlas profile self or admin read" on atlas_user_profiles;
create policy "atlas profile self or admin read"
on atlas_user_profiles for select to authenticated
using (user_id = auth.uid() or atlas_has_role(array['admin']));

drop policy if exists "atlas admin manages access invites" on atlas_user_access_invites;
create policy "atlas admin manages access invites"
on atlas_user_access_invites for all to authenticated
using (atlas_has_role(array['admin']))
with check (atlas_has_role(array['admin']));

update atlas_user_access_invites aui
set access_status = case when aui.status in ('suspended','disabled','revoked') then 'disabled' else 'active' end,
    auth_user_id = coalesce(aui.auth_user_id, aui.claimed_user_id, u.id),
    account_status = case
      when aui.status in ('suspended','disabled','revoked') then 'authentication_error'
      when u.id is null then coalesce(nullif(aui.account_status, ''), 'not_invited')
      when u.email_confirmed_at is not null then 'active'
      when aui.invitation_expires_at is not null and aui.invitation_expires_at < now() then 'invitation_expired'
      when aui.invitation_sent_at is not null then 'invitation_sent'
      else 'activation_pending'
    end,
    invitation_accepted_at = case
      when u.email_confirmed_at is not null then coalesce(aui.invitation_accepted_at, aui.claimed_at, u.email_confirmed_at)
      else aui.invitation_accepted_at
    end,
    claimed_user_id = case
      when u.email_confirmed_at is not null then coalesce(aui.claimed_user_id, u.id)
      else null
    end,
    claimed_at = case
      when u.email_confirmed_at is not null then coalesce(aui.claimed_at, u.email_confirmed_at)
      else null
    end
from auth.users u
where lower(u.email) = lower(aui.email);

update atlas_user_access_invites aui
set access_status = case when aui.status in ('suspended','disabled','revoked') then 'disabled' else 'active' end
where aui.auth_user_id is null;

update atlas_user_profiles aup
set account_status = case
  when u.email_confirmed_at is not null then 'active'
  else 'activation_pending'
end
from auth.users u
where u.id = aup.user_id;

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
    access_notes, account_status, last_access_reviewed_at
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
    'active',
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
        account_status = 'active',
        last_access_reviewed_at = now(),
        updated_at = now()
  returning * into v_profile;

  update atlas_user_access_invites aui
  set status = 'active',
      access_status = 'active',
      account_status = 'active',
      claimed_user_id = v_user_id,
      claimed_at = coalesce(aui.claimed_at, now()),
      invitation_accepted_at = coalesce(aui.invitation_accepted_at, now()),
      auth_user_id = coalesce(aui.auth_user_id, v_user_id),
      last_invite_error = null,
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
  v_email_confirmed_at timestamptz;
  v_invite_id uuid;
  v_access_status text;
  v_account_status text;
begin
  v_actor := auth.uid();
  if v_actor is null or not atlas_has_role(array['admin']) then
    raise exception 'Only an active Atlas Admin can manage user access.' using errcode = '42501';
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

  select u.id, u.email_confirmed_at
  into v_user_id, v_email_confirmed_at
  from auth.users u
  where lower(u.email) = v_email
  order by u.created_at desc
  limit 1;

  v_access_status := case
    when coalesce(p_status, 'pending') in ('suspended','disabled','revoked') then 'disabled'
    else 'active'
  end;

  v_account_status := case
    when coalesce(p_status, 'pending') in ('suspended','disabled','revoked') then 'authentication_error'
    when v_user_id is null then 'not_invited'
    when v_email_confirmed_at is not null then 'active'
    else 'activation_pending'
  end;

  insert into atlas_user_access_invites(
    email, employee_id, display_name, role, status, allowed_community_ids,
    allowed_market_values, allowed_region_values, locked_tab_ids, locked_page_keys,
    access_notes, access_status, account_status, created_by, updated_by,
    auth_user_id, claimed_user_id, claimed_at, invitation_accepted_at, last_invite_error
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
    v_access_status,
    v_account_status,
    v_actor,
    v_actor,
    v_user_id,
    case when v_user_id is not null and v_email_confirmed_at is not null then v_user_id else null end,
    case when v_user_id is not null and v_email_confirmed_at is not null then now() else null end,
    case when v_user_id is not null and v_email_confirmed_at is not null then now() else null end,
    null
  )
  on conflict on constraint atlas_user_access_invites_email_key do update
    set employee_id = excluded.employee_id,
        display_name = excluded.display_name,
        role = excluded.role,
        status = excluded.status,
        access_status = excluded.access_status,
        account_status = case
          when atlas_user_access_invites.account_status in ('invitation_sent','invitation_expired','password_reset_required','authentication_error')
            and excluded.account_status in ('not_invited','activation_pending')
            then atlas_user_access_invites.account_status
          else excluded.account_status
        end,
        allowed_community_ids = excluded.allowed_community_ids,
        allowed_market_values = excluded.allowed_market_values,
        allowed_region_values = excluded.allowed_region_values,
        locked_tab_ids = excluded.locked_tab_ids,
        locked_page_keys = excluded.locked_page_keys,
        access_notes = excluded.access_notes,
        updated_by = v_actor,
        auth_user_id = coalesce(excluded.auth_user_id, atlas_user_access_invites.auth_user_id),
        claimed_user_id = case
          when excluded.invitation_accepted_at is not null then coalesce(atlas_user_access_invites.claimed_user_id, excluded.claimed_user_id)
          when excluded.account_status <> 'active' and atlas_user_access_invites.invitation_accepted_at is null and atlas_user_access_invites.claimed_at is null then null
          else atlas_user_access_invites.claimed_user_id
        end,
        claimed_at = case
          when excluded.invitation_accepted_at is not null then coalesce(atlas_user_access_invites.claimed_at, excluded.claimed_at)
          else atlas_user_access_invites.claimed_at
        end,
        invitation_accepted_at = coalesce(atlas_user_access_invites.invitation_accepted_at, excluded.invitation_accepted_at),
        last_invite_error = null,
        updated_at = now()
  returning atlas_user_access_invites.invite_id into v_invite_id;

  if v_user_id is not null then
    insert into atlas_user_profiles(
      user_id, email, display_name, role, status, employee_id, allowed_community_ids,
      allowed_market_values, allowed_region_values, locked_tab_ids, locked_page_keys,
      access_notes, account_status, last_access_reviewed_at
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
      case when v_email_confirmed_at is not null then 'active' else 'activation_pending' end,
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
          account_status = excluded.account_status,
          last_access_reviewed_at = now(),
          updated_at = now();
  end if;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (v_actor, 'user_access_upserted', 'atlas_user_access_invites', v_email, 'user_access', null, jsonb_build_object('email', v_email, 'role', p_role, 'status', p_status), jsonb_build_object('profile_user_id', v_user_id, 'invite_id', v_invite_id));

  return query
  select v_email, v_user_id, v_invite_id, coalesce(p_status, 'pending'), p_role;
end;
$$;

create or replace function atlas_admin_user_provisioning_state(
  p_email text
)
returns table(
  email text,
  auth_user_id uuid,
  auth_email_confirmed_at timestamptz,
  auth_invited_at timestamptz,
  auth_confirmation_sent_at timestamptz,
  auth_recovery_sent_at timestamptz,
  auth_last_sign_in_at timestamptz,
  profile_user_id uuid,
  invite_id uuid,
  employee_id uuid,
  linked_employee_name text,
  role text,
  access_status text,
  account_status text,
  allowed_community_count integer,
  locked_tab_count integer,
  locked_tab_ids text[],
  invitation_sent_at timestamptz,
  invitation_expires_at timestamptz,
  invitation_accepted_at timestamptz,
  password_reset_sent_at timestamptz,
  last_invite_error text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_email text;
begin
  v_actor := auth.uid();
  if v_actor is null or not atlas_has_role(array['admin']) then
    raise exception 'Only an active Atlas Admin can review user provisioning.' using errcode = '42501';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email !~* '^[^@]+@(risere|riseresidential)[.]com$' then
    raise exception 'Enter a valid RISE company email address.' using errcode = '22023';
  end if;

  return query
  with auth_match as (
    select u.id, u.email, u.email_confirmed_at, u.invited_at, u.confirmation_sent_at, u.recovery_sent_at, u.last_sign_in_at
    from auth.users u
    where lower(u.email) = v_email
    order by u.created_at desc
    limit 1
  ),
  access_match as (
    select aui.*
    from atlas_user_access_invites aui
    where lower(aui.email) = v_email
    order by aui.updated_at desc
    limit 1
  ),
  profile_match as (
    select aup.*
    from atlas_user_profiles aup
    where lower(aup.email) = v_email
       or aup.user_id = (select am.id from auth_match am)
    order by aup.updated_at desc
    limit 1
  )
  select
    v_email,
    am.id,
    am.email_confirmed_at,
    am.invited_at,
    am.confirmation_sent_at,
    am.recovery_sent_at,
    am.last_sign_in_at,
    pm.user_id,
    ax.invite_id,
    coalesce(ax.employee_id, pm.employee_id),
    ae.full_name,
    coalesce(ax.role, pm.role),
    coalesce(ax.access_status, case when coalesce(ax.status, pm.status, 'active') in ('suspended','disabled','revoked') then 'disabled' else 'active' end),
    case
      when coalesce(ax.status, pm.status, 'active') in ('suspended','disabled','revoked') then 'authentication_error'
      when am.id is null then coalesce(ax.account_status, 'not_invited')
      when am.email_confirmed_at is not null then 'active'
      when ax.invitation_expires_at is not null and ax.invitation_expires_at < now() then 'invitation_expired'
      when ax.invitation_sent_at is not null then 'invitation_sent'
      else coalesce(ax.account_status, pm.account_status, 'activation_pending')
    end,
    coalesce(cardinality(ax.allowed_community_ids), cardinality(pm.allowed_community_ids), 0),
    coalesce(cardinality(ax.locked_tab_ids), cardinality(pm.locked_tab_ids), 0),
    coalesce(ax.locked_tab_ids, pm.locked_tab_ids, '{}'),
    ax.invitation_sent_at,
    ax.invitation_expires_at,
    ax.invitation_accepted_at,
    ax.password_reset_sent_at,
    ax.last_invite_error
  from (select 1) seed
  left join auth_match am on true
  left join access_match ax on true
  left join profile_match pm on true
  left join atlas_employees ae on ae.employee_id = coalesce(ax.employee_id, pm.employee_id);
end;
$$;

create or replace function atlas_admin_record_invitation_delivery(
  p_email text,
  p_auth_user_id uuid default null,
  p_account_status text default 'invitation_sent',
  p_invitation_sent_at timestamptz default now(),
  p_invitation_expires_at timestamptz default null,
  p_last_invite_error text default null
)
returns table(email text, auth_user_id uuid, access_status text, account_status text, invitation_sent_at timestamptz, invitation_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_email text;
  v_status text;
  v_auth_user_id uuid;
  v_invite atlas_user_access_invites%rowtype;
begin
  v_actor := auth.uid();
  if v_actor is null or not atlas_has_role(array['admin']) then
    raise exception 'Only an active Atlas Admin can record invitation delivery.' using errcode = '42501';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email !~* '^[^@]+@(risere|riseresidential)[.]com$' then
    raise exception 'Enter a valid RISE company email address.' using errcode = '22023';
  end if;

  v_status := coalesce(nullif(trim(p_account_status), ''), 'invitation_sent');
  if v_status not in ('not_invited','invitation_sent','invitation_expired','activation_pending','active','password_reset_required','authentication_error') then
    raise exception 'Invalid Atlas account status.' using errcode = '22023';
  end if;

  v_auth_user_id := p_auth_user_id;
  if v_auth_user_id is null then
    select u.id
    into v_auth_user_id
    from auth.users u
    where lower(u.email) = v_email
    order by u.created_at desc
    limit 1;
  end if;

  update atlas_user_access_invites aui
  set auth_user_id = coalesce(v_auth_user_id, aui.auth_user_id),
      claimed_user_id = case
        when v_status = 'active' then coalesce(aui.claimed_user_id, v_auth_user_id)
        when aui.invitation_accepted_at is null and aui.claimed_at is null then null
        else aui.claimed_user_id
      end,
      account_status = v_status,
      invitation_sent_at = case
        when v_status in ('invitation_sent','activation_pending') then coalesce(p_invitation_sent_at, now())
        else aui.invitation_sent_at
      end,
      invitation_expires_at = case
        when v_status in ('invitation_sent','activation_pending') then p_invitation_expires_at
        else aui.invitation_expires_at
      end,
      password_reset_sent_at = case
        when v_status = 'password_reset_required' then coalesce(p_invitation_sent_at, now())
        else aui.password_reset_sent_at
      end,
      last_invite_error = nullif(trim(coalesce(p_last_invite_error, '')), ''),
      updated_by = v_actor,
      updated_at = now()
  where lower(aui.email) = v_email
  returning * into v_invite;

  if v_invite.invite_id is null then
    raise exception 'No Atlas access record exists for this email. Save employee access before sending an invitation.' using errcode = '42501';
  end if;

  update atlas_user_profiles aup
  set account_status = case when v_status = 'password_reset_required' then aup.account_status else v_status end,
      updated_at = now()
  where lower(aup.email) = v_email
     or aup.user_id = v_auth_user_id;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (
    v_actor,
    'user_invitation_delivery_recorded',
    'atlas_user_access_invites',
    v_email,
    'user_access',
    null,
    to_jsonb(v_invite),
    jsonb_build_object('account_status', v_status, 'auth_user_id', v_auth_user_id)
  );

  return query
  select v_invite.email, coalesce(v_invite.auth_user_id, v_auth_user_id), v_invite.access_status, v_invite.account_status, v_invite.invitation_sent_at, v_invite.invitation_expires_at;
end;
$$;

revoke execute on function atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text) from public;
revoke execute on function atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text) from anon;
revoke execute on function atlas_admin_user_provisioning_state(text) from public;
revoke execute on function atlas_admin_user_provisioning_state(text) from anon;
revoke execute on function atlas_admin_record_invitation_delivery(text,uuid,text,timestamptz,timestamptz,text) from public;
revoke execute on function atlas_admin_record_invitation_delivery(text,uuid,text,timestamptz,timestamptz,text) from anon;

grant execute on function atlas_claim_invited_profile(text) to authenticated;
grant execute on function atlas_admin_upsert_user_access(text,text,text,text,uuid,uuid[],text[],text[],text[],text[],text) to authenticated;
grant execute on function atlas_admin_user_provisioning_state(text) to authenticated;
grant execute on function atlas_admin_record_invitation_delivery(text,uuid,text,timestamptz,timestamptz,text) to authenticated;