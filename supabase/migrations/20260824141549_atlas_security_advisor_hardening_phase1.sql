create or replace function public.atlas_update_app_document(
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
security invoker
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

create or replace function public.atlas_end_live_session(p_session_id text)
returns boolean
language plpgsql
security invoker
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

revoke execute on function public.atlas_current_role() from authenticated;
revoke execute on function public.atlas_can_write(text[]) from authenticated;
revoke execute on function public.atlas_has_role(text[]) from authenticated;
revoke execute on function public.atlas_current_allowed_community_ids() from authenticated;
revoke execute on function public.atlas_can_access_community(uuid) from authenticated;

alter table if exists atlas.state_store enable row level security;
revoke all on table atlas.state_store from anon, authenticated;
drop policy if exists "atlas state_store deny client access" on atlas.state_store;
create policy "atlas state_store deny client access"
on atlas.state_store for all to authenticated
using (false)
with check (false);