create or replace function atlas_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from atlas_user_profiles where user_id = auth.uid() and status = 'active'), 'anonymous');
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

create or replace function atlas_hash_payload(payload jsonb)
returns text
language sql
immutable
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
    from atlas_user_profiles
    where role = 'admin'
      and status = 'active'
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
