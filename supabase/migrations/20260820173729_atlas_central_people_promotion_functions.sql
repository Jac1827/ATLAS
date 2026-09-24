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
