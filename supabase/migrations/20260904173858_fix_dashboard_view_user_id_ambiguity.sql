create or replace function public.atlas_save_dashboard_view(
  p_view_key text,
  p_view_name text,
  p_is_default boolean default false,
  p_role_template_key text default null,
  p_layout jsonb default '{}',
  p_widgets jsonb default '[]',
  p_source text default 'atlas_dashboard_builder'
)
returns table (
  dashboard_view_id uuid,
  user_id uuid,
  view_key text,
  view_name text,
  is_default boolean,
  role_template_key text,
  layout jsonb,
  widgets jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_view public.atlas_user_dashboard_views%rowtype;
  v_key text := nullif(trim(coalesce(p_view_key, '')), '');
  v_name text := nullif(trim(coalesce(p_view_name, '')), '');
begin
  if v_user_id is null then
    raise exception 'Authentication is required to save dashboard views.' using errcode = '28000';
  end if;

  if v_key is null then
    raise exception 'Dashboard view key is required.' using errcode = '22023';
  end if;

  if v_name is null then
    raise exception 'Dashboard view name is required.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_layout, '{}'::jsonb)) <> 'object' then
    raise exception 'Dashboard layout must be a JSON object.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_widgets, '[]'::jsonb)) <> 'array' then
    raise exception 'Dashboard widgets must be a JSON array.' using errcode = '22023';
  end if;

  if coalesce(p_is_default, false) then
    update public.atlas_user_dashboard_views as v
    set is_default = false,
        updated_at = now()
    where v.user_id = v_user_id
      and v.deleted_at is null;
  end if;

  insert into public.atlas_user_dashboard_views (
    user_id,
    view_key,
    view_name,
    is_default,
    role_template_key,
    layout,
    widgets,
    source_module,
    updated_at,
    deleted_at
  )
  values (
    v_user_id,
    v_key,
    v_name,
    coalesce(p_is_default, false),
    nullif(trim(coalesce(p_role_template_key, '')), ''),
    coalesce(p_layout, '{}'::jsonb),
    coalesce(p_widgets, '[]'::jsonb),
    coalesce(nullif(trim(p_source), ''), 'atlas_dashboard_builder'),
    now(),
    null
  )
  on conflict (user_id, view_key) do update
    set view_name = excluded.view_name,
        is_default = excluded.is_default,
        role_template_key = excluded.role_template_key,
        layout = excluded.layout,
        widgets = excluded.widgets,
        source_module = excluded.source_module,
        updated_at = now(),
        deleted_at = null
  returning * into v_view;

  if not exists (
    select 1
    from public.atlas_user_dashboard_views as v
    where v.user_id = v_user_id
      and v.deleted_at is null
      and v.is_default is true
  ) then
    update public.atlas_user_dashboard_views as v
    set is_default = true,
        updated_at = now()
    where v.dashboard_view_id = v_view.dashboard_view_id
    returning * into v_view;
  end if;

  insert into public.atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (
    v_user_id,
    'dashboard_view_saved',
    'atlas_user_dashboard_views',
    v_view.dashboard_view_id::text,
    coalesce(nullif(trim(p_source), ''), 'atlas_dashboard_builder'),
    null,
    to_jsonb(v_view),
    jsonb_build_object('view_key', v_view.view_key, 'is_default', v_view.is_default)
  );

  return query
  select
    v_view.dashboard_view_id,
    v_view.user_id,
    v_view.view_key,
    v_view.view_name,
    v_view.is_default,
    v_view.role_template_key,
    v_view.layout,
    v_view.widgets,
    v_view.created_at,
    v_view.updated_at,
    v_view.deleted_at;
end;
$$;

create or replace function public.atlas_delete_dashboard_view(
  p_view_key text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_key text := nullif(trim(coalesce(p_view_key, '')), '');
  v_deleted public.atlas_user_dashboard_views%rowtype;
  v_default_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to delete dashboard views.' using errcode = '28000';
  end if;

  if v_key is null then
    raise exception 'Dashboard view key is required.' using errcode = '22023';
  end if;

  update public.atlas_user_dashboard_views as v
  set deleted_at = now(),
      is_default = false,
      updated_at = now()
  where v.user_id = v_user_id
    and v.view_key = v_key
    and v.deleted_at is null
  returning * into v_deleted;

  if not found then
    return false;
  end if;

  select count(*)
  into v_default_count
  from public.atlas_user_dashboard_views as v
  where v.user_id = v_user_id
    and v.deleted_at is null
    and v.is_default is true;

  if v_default_count = 0 then
    update public.atlas_user_dashboard_views as v
    set is_default = true,
        updated_at = now()
    where v.dashboard_view_id = (
      select candidate.dashboard_view_id
      from public.atlas_user_dashboard_views as candidate
      where candidate.user_id = v_user_id
        and candidate.deleted_at is null
      order by candidate.updated_at desc
      limit 1
    );
  end if;

  insert into public.atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (
    v_user_id,
    'dashboard_view_deleted',
    'atlas_user_dashboard_views',
    v_deleted.dashboard_view_id::text,
    'atlas_dashboard_builder',
    to_jsonb(v_deleted),
    null,
    jsonb_build_object('view_key', v_deleted.view_key)
  );

  return true;
end;
$$;