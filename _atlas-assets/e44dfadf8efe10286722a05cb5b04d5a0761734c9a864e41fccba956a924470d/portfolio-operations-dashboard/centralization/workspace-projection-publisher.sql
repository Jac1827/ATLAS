-- The REST-addressed function carries the timeout so PostgREST hoists it before
-- the main query. General document/role deadlines and RLS are unchanged.
create function public.atlas_publish_workspace_projection(p_projection jsonb)
returns jsonb
language plpgsql volatile security invoker
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  actor public.atlas_user_profiles;
  parent public.atlas_app_documents;
  retained public.atlas_app_documents;
  source jsonb;
  source_time timestamptz;
  target_key text;
  receipt jsonb;
begin
  if auth.uid() is null then
    raise exception 'Workspace projection publication requires an active admin.' using errcode='42501';
  end if;
  -- Hold the authorization row while publishing; a concurrent access change
  -- cannot make a waiting request publish under a stale profile.
  select * into actor from public.atlas_user_profiles p
    where p.user_id=auth.uid() for share;
  if actor.user_id is null or actor.role is distinct from 'admin'
    or actor.status is distinct from 'active'
    or coalesce(actor.account_status,'active')<>'active' then
    raise exception 'Workspace projection publication requires an active admin.' using errcode='42501';
  end if;

  -- Use serialized UTF-8 bytes, not pg_column_size of a compressed TOAST value.
  if p_projection is null or jsonb_typeof(p_projection) is distinct from 'object'
    or octet_length(convert_to(p_projection::text,'UTF8'))>16777216 then
    raise exception 'Workspace projection must be an object no larger than 16 MiB.' using errcode='22023';
  end if;
  source:=p_projection->'source';
  if p_projection->'format' is distinct from '1'::jsonb
    or p_projection-array['format','source','communityData','opsGlobalData','importState','contentHash']<>'{}'::jsonb
    or jsonb_typeof(source) is distinct from 'object'
    or source-array['documentKey','version','archiveHash','effectiveAt']<>'{}'::jsonb
    or source->>'documentKey' is distinct from 'atlas_dashboard_state_v1'
    or jsonb_typeof(source->'version') is distinct from 'number'
    or jsonb_typeof(source->'archiveHash') is distinct from 'string'
    or coalesce(source->>'archiveHash','') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(source->'effectiveAt') is distinct from 'string'
    or coalesce(source->>'effectiveAt','')=''
    or jsonb_typeof(p_projection->'contentHash') is distinct from 'string'
    or coalesce(p_projection->>'contentHash','') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_projection->'communityData') is distinct from 'object'
    or jsonb_typeof(p_projection->'opsGlobalData') is distinct from 'object'
    or jsonb_typeof(p_projection->'importState') is distinct from 'object'
    or exists(select 1 from jsonb_each(p_projection->'communityData') v where jsonb_typeof(v.value)<>'object') then
    raise exception 'Workspace projection format, source, hash, or object shape is invalid.' using errcode='22023';
  end if;
  begin
    source_time:=(source->>'effectiveAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Workspace projection source timestamp is invalid.' using errcode='22023';
  end;

  -- Serializes publication for this parent and prevents its source/version from
  -- changing between validation and the atomic document/version/audit insert.
  select * into parent from public.atlas_app_documents d
    where d.document_key='atlas_dashboard_state_v1' for update;
  if parent.document_id is null or parent.deleted_at is not null
    or parent.module_key is distinct from 'dashboard'
    or parent.payload#>>'{bundle,bundleType}' is distinct from 'atlas_migration_archive_v1'
    or coalesce(parent.payload#>>'{bundle,sha256}','') !~ '^[a-f0-9]{64}$'
    or source->'version' is distinct from to_jsonb(parent.version)
    or source->>'archiveHash' is distinct from parent.payload#>>'{bundle,sha256}'
    or source_time is distinct from parent.updated_at then
    raise exception 'Workspace projection source conflict: the current parent does not match.' using errcode='40001';
  end if;
  target_key:='atlas_workspace_projection_v1:'||(source->>'archiveHash')||':'||parent.version::text;
  select * into retained from public.atlas_app_documents d where d.document_key=target_key for update;
  if retained.document_id is not null then
    if retained.deleted_at is not null or retained.module_key is distinct from 'dashboard'
      or retained.source_module is distinct from 'workspace_projection'
      or retained.payload is distinct from p_projection then
      raise exception 'Workspace projection conflict: this source already has a different retained document.' using errcode='40001';
    end if;
    return jsonb_build_object('status','existing','document_id',retained.document_id,
      'document_key',retained.document_key,'module_key',retained.module_key,
      'version',retained.version,'payload_hash',retained.payload_hash,
      'updated_at',retained.updated_at,'source_module',retained.source_module);
  end if;

  -- contentHash is the verified materializer's browser-canonical digest. Keep
  -- that format intact; the existing writer separately computes its ordinary
  -- PostgreSQL JSONB receipt hash. No caller hash overrides the server receipt.
  select to_jsonb(saved) into receipt from public.atlas_update_app_document(
    target_key,'dashboard',p_projection,null,'workspace_projection',null,
    jsonb_build_object('purpose','Derived workspace read model','source',source)) saved;
  return receipt||jsonb_build_object('status','published','source_module','workspace_projection');
end;
$$;
revoke all on function public.atlas_publish_workspace_projection(jsonb) from public,anon;
grant execute on function public.atlas_publish_workspace_projection(jsonb) to authenticated;
comment on function public.atlas_publish_workspace_projection(jsonb) is
  'Active-admin, source-bound insert-only projection materializer. Dedicated REST deadline; existing document, version, audit and RLS policies preserved.';
notify pgrst, 'reload schema';
