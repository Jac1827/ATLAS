create or replace function atlas_update_app_document(
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
security definer
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

create or replace function atlas_upload_legacy_snapshot(
  p_source_module text,
  p_source_key text,
  p_source_label text,
  p_source_version text,
  p_source_payload jsonb,
  p_metadata jsonb default '{}'
)
returns table(snapshot_id uuid, migration_run_id uuid, source_hash text, captured_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_migration_run_id uuid;
  v_snapshot_id uuid;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to upload Atlas migration snapshots.' using errcode = '28000';
  end if;

  v_role := atlas_current_role();
  if v_role not in ('admin','executive','regional','people','marketing','maintenance','finance','bonus') then
    raise exception 'Atlas snapshot upload denied for role %', v_role using errcode = '42501';
  end if;

  if coalesce(p_source_payload, '{}'::jsonb) = '{}'::jsonb then
    raise exception 'Snapshot payload is required.' using errcode = '22023';
  end if;

  v_hash := atlas_hash_payload(p_source_payload);

  insert into atlas_migration_runs(
    phase,
    source_module,
    status,
    dry_run,
    started_by,
    pre_counts,
    pre_totals,
    reconciliation_status,
    exception_count,
    notes
  )
  values (
    coalesce(nullif(p_metadata ->> 'phase', ''), 'legacy_snapshot'),
    coalesce(nullif(p_source_module, ''), 'atlas_browser'),
    'snapshot_captured',
    true,
    auth.uid(),
    coalesce(p_metadata -> 'pre_counts', '{}'::jsonb),
    coalesce(p_metadata -> 'pre_totals', '{}'::jsonb),
    'snapshot_only',
    coalesce(nullif(p_metadata ->> 'exception_count', '')::integer, 0),
    coalesce(p_metadata ->> 'notes', 'Read-only Atlas snapshot captured before central migration. No source rows were changed.')
  )
  returning atlas_migration_runs.migration_run_id into v_migration_run_id;

  insert into atlas_legacy_snapshots(
    migration_run_id,
    source_module,
    source_key,
    source_label,
    source_version,
    source_payload,
    source_hash,
    captured_by,
    read_only_locked
  )
  values (
    v_migration_run_id,
    coalesce(nullif(p_source_module, ''), 'atlas_browser'),
    coalesce(nullif(p_source_key, ''), 'atlas_central_migration_read_only_snapshot_v1'),
    p_source_label,
    p_source_version,
    p_source_payload,
    v_hash,
    auth.uid(),
    true
  )
  on conflict (source_module, source_key, source_hash) do update
    set captured_at = atlas_legacy_snapshots.captured_at
  returning atlas_legacy_snapshots.snapshot_id into v_snapshot_id;

  insert into atlas_audit_log(actor_user_id, action, entity_table, entity_id, source_module, before_payload, after_payload, metadata)
  values (
    auth.uid(),
    'snapshot_upload',
    'atlas_legacy_snapshots',
    v_snapshot_id::text,
    coalesce(nullif(p_source_module, ''), 'atlas_browser'),
    null,
    jsonb_build_object('source_hash', v_hash, 'read_only_locked', true),
    coalesce(p_metadata, '{}'::jsonb)
  );

  return query select v_snapshot_id, v_migration_run_id, v_hash, now();
end;
$$;
