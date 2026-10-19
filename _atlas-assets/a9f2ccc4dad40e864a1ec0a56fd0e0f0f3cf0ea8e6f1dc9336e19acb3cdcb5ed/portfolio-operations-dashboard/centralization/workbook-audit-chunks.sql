-- Bounded transport for exact audit JSON and original OOXML bytes. Private
-- chunks are immutable and survive finalize so both streams can be verified.
create table atlas_private.workbook_audit_uploads (
 upload_id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),request_id uuid not null,
 community_id uuid references public.atlas_communities(community_id),manifest jsonb not null,manifest_hash text not null check(manifest_hash~'^[a-f0-9]{64}$'),
 audit_id uuid references public.atlas_workbook_audits(audit_id),created_at timestamptz not null default now(),finalized_at timestamptz,canceled_at timestamptz,canceled_by uuid references auth.users(id),retry_request_id uuid,
 unique(owner_id,request_id),check((audit_id is null)=(finalized_at is null))
);
create table atlas_private.workbook_audit_chunks (
 upload_id uuid not null references atlas_private.workbook_audit_uploads(upload_id),stream text not null check(stream in ('audit','source')),
 chunk_index integer not null check(chunk_index>=0),payload bytea not null check(octet_length(payload) between 1 and 196608),sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 primary key(upload_id,stream,chunk_index)
);
alter table atlas_private.workbook_audit_uploads enable row level security;
alter table atlas_private.workbook_audit_chunks enable row level security;
revoke all on atlas_private.workbook_audit_uploads,atlas_private.workbook_audit_chunks from public,anon,authenticated;
create trigger workbook_audit_chunk_immutable before update or delete on atlas_private.workbook_audit_chunks for each row execute function atlas_private.finance_immutable();
create function atlas_private.workbook_upload_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.audit_id is not null or old.canceled_at is not null or (to_jsonb(old)-'audit_id'-'finalized_at'-'canceled_at'-'canceled_by'-'retry_request_id') is distinct from (to_jsonb(new)-'audit_id'-'finalized_at'-'canceled_at'-'canceled_by'-'retry_request_id') or not ((new.audit_id is not null and new.canceled_at is null and new.canceled_by is null and new.retry_request_id is null) or (new.audit_id is null and new.finalized_at is null and new.canceled_at is not null and coalesce(new.canceled_by=auth.uid(),false) and new.retry_request_id is not null)) then raise exception 'Workbook upload manifest and finalized history are immutable';end if;
 return new;
end;$$;
create trigger workbook_audit_upload_immutable before update or delete on atlas_private.workbook_audit_uploads for each row execute function atlas_private.workbook_upload_immutable();

create function atlas_private.begin_workbook_audit_upload(p_community_id uuid,p_request_id uuid,p_manifest jsonb,p_manifest_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u atlas_private.workbook_audit_uploads;s text;spec jsonb;n bigint;
begin
 if auth.uid() is null or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role in ('admin','executive','regional','finance','community_manager')) then raise exception 'Authorized workbook uploader required';end if;
 if p_community_id is not null and not (atlas_private.command_access(p_community_id) or atlas_private.reforecast_access(p_community_id,'edit')) then raise exception 'Workbook community is outside authorized scope';end if;
 if p_request_id is null or octet_length(p_manifest::text)>8192 or p_manifest->>'schemaVersion' is distinct from 'atlas.workbook-audit-upload.v1' or p_manifest->>'chunkBytes' is distinct from '196608' or coalesce(p_manifest->>'fingerprint','')!~'^[a-f0-9]{64}$' or coalesce(p_manifest->>'sourceHash','')!~'^[a-f0-9]{64}$' or p_manifest_hash is distinct from encode(sha256(convert_to(atlas_private.workbook_canonical_json(p_manifest),'UTF8')),'hex') then raise exception 'Valid bounded workbook manifest and hash required';end if;
 foreach s in array array['audit','source'] loop
  spec:=p_manifest->s;
  if coalesce(spec->>'byteLength','')!~'^[1-9][0-9]{0,8}$' or coalesce(spec->>'chunkCount','')!~'^[1-9][0-9]{0,3}$' or coalesce(spec->>'sha256','')!~'^[a-f0-9]{64}$' then raise exception 'Invalid workbook stream manifest';end if;
  n:=(spec->>'byteLength')::bigint;
  if n>(case when s='audit' then 134217728 else 33554432 end) or (spec->>'chunkCount')::integer<>(n+196607)/196608 then raise exception 'Workbook stream exceeds allowed bounds';end if;
 end loop;
 if p_manifest->'source'->>'sha256' is distinct from p_manifest->>'sourceHash' then raise exception 'Original source hash mismatch';end if;
 -- The request key serializes overlapping retries before checking or inserting.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into u from atlas_private.workbook_audit_uploads where owner_id=auth.uid() and request_id=p_request_id;
 if found and (u.manifest_hash<>p_manifest_hash or u.manifest<>p_manifest or u.community_id is distinct from p_community_id) then raise exception 'Workbook request ID reused with different evidence or scope';end if;
 if u.canceled_at is not null then return jsonb_build_object('canceled',true,'retry_request_id',u.retry_request_id,'manifest_hash',u.manifest_hash);end if;
 if u.upload_id is null then
  perform atlas_private.check_workbook_staging_capacity((p_manifest->'audit'->>'byteLength')::bigint+(p_manifest->'source'->>'byteLength')::bigint);
  insert into atlas_private.workbook_audit_uploads(owner_id,request_id,community_id,manifest,manifest_hash) values(auth.uid(),p_request_id,p_community_id,p_manifest,p_manifest_hash) returning * into u;
 end if;
 return jsonb_build_object('upload_id',u.upload_id,'audit_id',u.audit_id,'manifest_hash',u.manifest_hash);
end;$$;

create function atlas_private.put_workbook_audit_chunk(p_upload_id uuid,p_stream text,p_index integer,p_chunk text,p_chunk_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u atlas_private.workbook_audit_uploads;data bytea;c atlas_private.workbook_audit_chunks;spec jsonb;expected integer;
begin
 select * into u from atlas_private.workbook_audit_uploads where upload_id=p_upload_id for update;
 if auth.uid() is null or u.owner_id is distinct from auth.uid() or not atlas_private.workbook_upload_authorized(u.community_id) then raise exception 'Workbook upload is outside authorized scope';end if;
 if u.canceled_at is not null then raise exception 'Canceled workbook upload cannot change';end if;
 if u.audit_id is not null then perform atlas_private.authorize_workbook_audit_read(u.audit_id);end if;
 if p_stream is null or p_stream not in ('audit','source') or p_index is null or p_index<0 or p_chunk is null or octet_length(p_chunk)>262144 then raise exception 'Bounded workbook chunk required';end if;
 spec:=u.manifest->p_stream;
 if p_index>=(spec->>'chunkCount')::integer then raise exception 'Workbook chunk index is outside manifest';end if;
 data:=decode(p_chunk,'base64');expected:=least(196608,(spec->>'byteLength')::integer-p_index*196608);
 if octet_length(data)<>expected or p_chunk_hash is distinct from encode(sha256(data),'hex') then raise exception 'Workbook chunk length or hash mismatch';end if;
 select * into c from atlas_private.workbook_audit_chunks where upload_id=p_upload_id and stream=p_stream and chunk_index=p_index;
 if found then
  if c.sha256<>p_chunk_hash or c.payload<>data then raise exception 'Immutable workbook chunk already has different content';end if;
 elsif u.audit_id is not null then raise exception 'Finalized workbook upload cannot change';
 else insert into atlas_private.workbook_audit_chunks(upload_id,stream,chunk_index,payload,sha256) values(p_upload_id,p_stream,p_index,data,p_chunk_hash);
 end if;
 return jsonb_build_object('upload_id',p_upload_id,'stream',p_stream,'chunk_index',p_index,'sha256',p_chunk_hash,'byte_length',octet_length(data));
end;$$;

create function atlas_private.finalize_workbook_audit_upload(p_upload_id uuid,p_request_id uuid,p_manifest_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u atlas_private.workbook_audit_uploads;data bytea;audit jsonb;result jsonb;s text;spec jsonb;n integer;
begin
 select * into u from atlas_private.workbook_audit_uploads where upload_id=p_upload_id for update;
 if auth.uid() is null or u.owner_id is distinct from auth.uid() or not atlas_private.workbook_upload_authorized(u.community_id) or u.request_id is distinct from p_request_id or u.manifest_hash is distinct from p_manifest_hash then raise exception 'Workbook upload request, manifest or authorization mismatch';end if;
 if u.canceled_at is not null then raise exception 'Canceled workbook upload cannot finalize';end if;
 if u.audit_id is not null then
  perform atlas_private.authorize_workbook_audit_read(u.audit_id);
  select jsonb_build_object('audit_id',a.audit_id,'source_hash',a.source_hash,'fingerprint',a.fingerprint,'manifest_hash',u.manifest_hash) into result from public.atlas_workbook_audits a where a.audit_id=u.audit_id;
  return result;
 end if;
 foreach s in array array['audit','source'] loop
  spec:=u.manifest->s;
  select count(*),string_agg(payload,''::bytea order by chunk_index) into n,data from atlas_private.workbook_audit_chunks where upload_id=p_upload_id and stream=s;
  if n<>(spec->>'chunkCount')::integer or octet_length(data) is distinct from (spec->>'byteLength')::integer or encode(sha256(data),'hex') is distinct from spec->>'sha256' then raise exception 'Workbook stream is incomplete or failed exact hash verification';end if;
  if s='audit' then audit:=convert_from(data,'UTF8')::jsonb;end if;
 end loop;
 if audit->>'fingerprint' is distinct from u.manifest->>'fingerprint' or audit->'inventory'->>'sourceHash' is distinct from u.manifest->>'sourceHash' then raise exception 'Workbook audit differs from manifest';end if;
 -- Validation, evidence insert, community binding and finalize share one
 -- transaction. Any failure rolls all of these back; chunks can be retried.
 result:=public.atlas_save_workbook_audit(u.community_id,u.manifest->>'sourceHash',audit,u.request_id);
 update atlas_private.workbook_audit_uploads set audit_id=(result->>'audit_id')::uuid,finalized_at=now() where upload_id=u.upload_id;
 return result||jsonb_build_object('manifest_hash',u.manifest_hash);
end;$$;

create function atlas_private.authorize_workbook_audit_read(p_audit_id uuid) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not atlas_private.workbook_audit_read_authorized(p_audit_id) then raise exception 'Workbook evidence is outside authorized scope';end if;
end;$$;
create function atlas_private.read_workbook_audit_manifest(p_audit_id uuid,p_manifest_hash text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform atlas_private.authorize_workbook_audit_read(p_audit_id);
 select jsonb_build_object('audit_id',a.audit_id,'source_hash',a.source_hash,'fingerprint',a.fingerprint,'manifest_hash',u.manifest_hash,'manifest',u.manifest) into result from public.atlas_workbook_audits a join atlas_private.workbook_audit_uploads u on u.audit_id=a.audit_id where a.audit_id=p_audit_id and (p_manifest_hash is null or u.manifest_hash=p_manifest_hash) order by u.finalized_at,u.upload_id limit 1;
 return result;
end;$$;
create function atlas_private.read_workbook_audit_chunk(p_audit_id uuid,p_stream text,p_index integer,p_manifest_hash text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;id uuid;
begin
 perform atlas_private.authorize_workbook_audit_read(p_audit_id);
 select upload_id into id from atlas_private.workbook_audit_uploads where audit_id=p_audit_id and (p_manifest_hash is null or manifest_hash=p_manifest_hash) order by finalized_at,upload_id limit 1;
 select jsonb_build_object('stream',c.stream,'chunk_index',c.chunk_index,'sha256',c.sha256,'data',replace(encode(c.payload,'base64'),E'\n','')) into result from atlas_private.workbook_audit_chunks c where c.upload_id=id and c.stream=p_stream and c.chunk_index=p_index;
 if result is null then raise exception 'Saved workbook chunk unavailable';end if;return result;
end;$$;

-- Public RPCs are invokers; privileged code is private, checks auth.uid(), uses
-- an empty search_path and exposes no direct table mutation permissions.
create function public.atlas_begin_workbook_audit_upload(p_community_id uuid,p_request_id uuid,p_manifest jsonb,p_manifest_hash text) returns jsonb language sql security invoker set search_path='' as $$ select atlas_private.begin_workbook_audit_upload(p_community_id,p_request_id,p_manifest,p_manifest_hash) $$;
create function public.atlas_put_workbook_audit_chunk(p_upload_id uuid,p_stream text,p_index integer,p_chunk text,p_chunk_hash text) returns jsonb language sql security invoker set search_path='' as $$ select atlas_private.put_workbook_audit_chunk(p_upload_id,p_stream,p_index,p_chunk,p_chunk_hash) $$;
create function public.atlas_finalize_workbook_audit_upload(p_upload_id uuid,p_request_id uuid,p_manifest_hash text) returns jsonb language sql security invoker set search_path='' as $$ select atlas_private.finalize_workbook_audit_upload(p_upload_id,p_request_id,p_manifest_hash) $$;
create function public.atlas_read_workbook_audit_manifest(p_audit_id uuid,p_manifest_hash text default null) returns jsonb language sql security invoker set search_path='' as $$ select atlas_private.read_workbook_audit_manifest(p_audit_id,p_manifest_hash) $$;
create function public.atlas_read_workbook_audit_chunk(p_audit_id uuid,p_stream text,p_index integer,p_manifest_hash text default null) returns jsonb language sql security invoker set search_path='' as $$ select atlas_private.read_workbook_audit_chunk(p_audit_id,p_stream,p_index,p_manifest_hash) $$;
revoke all on function atlas_private.workbook_upload_immutable(),atlas_private.authorize_workbook_audit_read(uuid),atlas_private.begin_workbook_audit_upload(uuid,uuid,jsonb,text),atlas_private.put_workbook_audit_chunk(uuid,text,integer,text,text),atlas_private.finalize_workbook_audit_upload(uuid,uuid,text),atlas_private.read_workbook_audit_manifest(uuid,text),atlas_private.read_workbook_audit_chunk(uuid,text,integer,text),public.atlas_begin_workbook_audit_upload(uuid,uuid,jsonb,text),public.atlas_put_workbook_audit_chunk(uuid,text,integer,text,text),public.atlas_finalize_workbook_audit_upload(uuid,uuid,text),public.atlas_read_workbook_audit_manifest(uuid,text),public.atlas_read_workbook_audit_chunk(uuid,text,integer,text) from public,anon,authenticated;
grant usage on schema atlas_private to authenticated;
grant execute on function atlas_private.begin_workbook_audit_upload(uuid,uuid,jsonb,text),atlas_private.put_workbook_audit_chunk(uuid,text,integer,text,text),atlas_private.finalize_workbook_audit_upload(uuid,uuid,text),atlas_private.read_workbook_audit_manifest(uuid,text),atlas_private.read_workbook_audit_chunk(uuid,text,integer,text),public.atlas_begin_workbook_audit_upload(uuid,uuid,jsonb,text),public.atlas_put_workbook_audit_chunk(uuid,text,integer,text,text),public.atlas_finalize_workbook_audit_upload(uuid,uuid,text),public.atlas_read_workbook_audit_manifest(uuid,text),public.atlas_read_workbook_audit_chunk(uuid,text,integer,text) to authenticated;

-- The reforecast envelope repeats cell/line/schedule evidence outside the audit
-- graph. Chunk it as well so the next save cannot reintroduce the same defect.
create table atlas_private.reforecast_payload_uploads (
 staging_id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),community_id uuid not null references public.atlas_communities(community_id),request_id uuid not null,
 manifest jsonb not null,manifest_hash text not null,upload_id uuid references public.atlas_reforecast_uploads(upload_id),created_at timestamptz not null default now(),canceled_at timestamptz,canceled_by uuid references auth.users(id),retry_request_id uuid,unique(owner_id,request_id)
);
create table atlas_private.reforecast_payload_chunks (
 staging_id uuid not null references atlas_private.reforecast_payload_uploads(staging_id),chunk_index integer not null check(chunk_index>=0),payload bytea not null check(octet_length(payload) between 1 and 196608),sha256 text not null,
 primary key(staging_id,chunk_index)
);
alter table atlas_private.reforecast_payload_uploads enable row level security;
alter table atlas_private.reforecast_payload_chunks enable row level security;
revoke all on atlas_private.reforecast_payload_uploads,atlas_private.reforecast_payload_chunks from public,anon,authenticated;
create trigger reforecast_payload_chunk_immutable before update or delete on atlas_private.reforecast_payload_chunks for each row execute function atlas_private.finance_immutable();
create function atlas_private.reforecast_payload_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.upload_id is not null or old.canceled_at is not null or (to_jsonb(old)-'upload_id'-'canceled_at'-'canceled_by'-'retry_request_id') is distinct from (to_jsonb(new)-'upload_id'-'canceled_at'-'canceled_by'-'retry_request_id') or not ((new.upload_id is not null and new.canceled_at is null and new.canceled_by is null and new.retry_request_id is null) or (new.upload_id is null and new.canceled_at is not null and coalesce(new.canceled_by=auth.uid(),false) and new.retry_request_id is not null)) then raise exception 'Reforecast payload manifest and finalized history are immutable';end if;return new;
end;$$;
create trigger reforecast_payload_immutable before update or delete on atlas_private.reforecast_payload_uploads for each row execute function atlas_private.reforecast_payload_immutable();

create function atlas_private.stage_reforecast_payload(p_community_id uuid,p_request_id uuid,p_action text,p_manifest jsonb,p_manifest_hash text,p_index integer,p_chunk text,p_chunk_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u atlas_private.reforecast_payload_uploads;c atlas_private.reforecast_payload_chunks;data bytea;payload jsonb;n integer;r public.atlas_reforecast_uploads;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(p_community_id,'edit') then raise exception 'Authorized reforecast editor required';end if;
 if p_request_id is null or p_action is null or p_action not in ('begin','put','finalize') then raise exception 'Valid reforecast payload action and request ID required';end if;
 perform pg_advisory_xact_lock(hashtextextended('reforecast-payload:'||auth.uid()::text||p_request_id::text,0));
 select * into u from atlas_private.reforecast_payload_uploads where owner_id=auth.uid() and request_id=p_request_id for update;
 if u.staging_id is not null and (u.community_id<>p_community_id or u.manifest_hash is distinct from p_manifest_hash) then raise exception 'Reforecast request ID reused with different payload or scope';end if;
 if u.canceled_at is not null then
  if p_action='begin' then return jsonb_build_object('canceled',true,'retry_request_id',u.retry_request_id,'manifest_hash',u.manifest_hash);else raise exception 'Canceled reforecast payload cannot change';end if;
 end if;
 if p_action='begin' then
  if octet_length(p_manifest::text)>8192 or p_manifest->>'schemaVersion' is distinct from 'atlas.reforecast-payload.v1' or p_manifest->>'chunkBytes' is distinct from '196608' or coalesce(p_manifest->>'byteLength','')!~'^[1-9][0-9]{0,7}$' or coalesce(p_manifest->>'chunkCount','')!~'^[1-9][0-9]{0,2}$' or coalesce(p_manifest->>'sha256','')!~'^[a-f0-9]{64}$' or p_manifest_hash is distinct from encode(sha256(convert_to(atlas_private.workbook_canonical_json(p_manifest),'UTF8')),'hex') then raise exception 'Valid reforecast payload manifest required';end if;
  n:=(p_manifest->>'byteLength')::integer;
  if n>33554432 or (p_manifest->>'chunkCount')::integer<>(n+196607)/196608 then raise exception 'Reforecast payload exceeds 32 MB bounds';end if;
  if u.staging_id is null then perform atlas_private.check_workbook_staging_capacity(n);insert into atlas_private.reforecast_payload_uploads(owner_id,community_id,request_id,manifest,manifest_hash) values(auth.uid(),p_community_id,p_request_id,p_manifest,p_manifest_hash) returning * into u;
  elsif u.manifest<>p_manifest then raise exception 'Reforecast payload manifest mismatch';end if;
 elsif u.staging_id is null then raise exception 'Begin the reforecast payload first';
 elsif p_action='put' then
  if p_index is null or p_index<0 or p_index>=(u.manifest->>'chunkCount')::integer or p_chunk is null or octet_length(p_chunk)>262144 then raise exception 'Bounded reforecast payload chunk required';end if;
  data:=decode(p_chunk,'base64');
  if octet_length(data)<>least(196608,(u.manifest->>'byteLength')::integer-p_index*196608) or p_chunk_hash is distinct from encode(sha256(data),'hex') then raise exception 'Reforecast payload chunk hash or length mismatch';end if;
  select * into c from atlas_private.reforecast_payload_chunks where staging_id=u.staging_id and chunk_index=p_index;
  if found then if c.sha256<>p_chunk_hash or c.payload<>data then raise exception 'Immutable reforecast payload chunk changed';end if;
  elsif u.upload_id is not null then raise exception 'Finalized reforecast payload cannot change';
  else insert into atlas_private.reforecast_payload_chunks values(u.staging_id,p_index,data,p_chunk_hash);end if;
 elsif p_action='finalize' and u.upload_id is null then
  select count(*),string_agg(pc.payload,''::bytea order by pc.chunk_index) into n,data from atlas_private.reforecast_payload_chunks pc where pc.staging_id=u.staging_id;
  if n<>(u.manifest->>'chunkCount')::integer or octet_length(data) is distinct from (u.manifest->>'byteLength')::integer or encode(sha256(data),'hex') is distinct from u.manifest->>'sha256' then raise exception 'Reforecast payload is incomplete or its hash changed';end if;
  payload:=convert_from(data,'UTF8')::jsonb;
  -- Typed provider/contract receipts retain original bytes but have no workbook graph.
  -- A supplied audit or any workbook-import field still requires audit resolution;
  -- labeling workbook evidence as a provider receipt cannot bypass that check.
  if payload ? 'integrity'
   or coalesce(payload->>'sourceType','') not in ('hello_landing','rise_str','monthly_property_statement','contract')
   or payload ?| array['schemaVersion','parserVersion','sourceHash','sheets','lines','schedules','drivers','reconciliation','planningCells','mapping','actualsAuthority'] then
   perform atlas_private.resolve_workbook_audit(payload->'integrity',payload->'source'->>'sha256');
  end if;
  r:=public.atlas_save_reforecast_upload(p_community_id,p_request_id,payload);
  if r.payload is distinct from payload then raise exception 'Saved reforecast payload readback mismatch';end if;
  update atlas_private.reforecast_payload_uploads set upload_id=r.upload_id where staging_id=u.staging_id;u.upload_id:=r.upload_id;
 end if;
 if u.upload_id is not null then select * into r from public.atlas_reforecast_uploads where upload_id=u.upload_id;end if;
 return jsonb_build_object('staging_id',u.staging_id,'upload_id',u.upload_id,'manifest_hash',u.manifest_hash,'record',case when r.upload_id is null then null else to_jsonb(r)-'payload' end);
end;$$;
create function atlas_private.read_reforecast_payload_chunk(p_upload_id uuid,p_index integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.atlas_reforecast_uploads;u atlas_private.reforecast_payload_uploads;result jsonb;
begin
 select * into r from public.atlas_reforecast_uploads where upload_id=p_upload_id;
 if auth.uid() is null or r.upload_id is null or not atlas_private.reforecast_access(r.community_id,'read') then raise exception 'Reforecast payload is outside authorized scope';end if;
 select * into u from atlas_private.reforecast_payload_uploads where upload_id=r.upload_id order by created_at,staging_id limit 1;
 if p_index is null then return jsonb_build_object('manifest',u.manifest,'manifest_hash',u.manifest_hash,'record',to_jsonb(r)-'payload');end if;
 select jsonb_build_object('chunk_index',c.chunk_index,'sha256',c.sha256,'data',replace(encode(c.payload,'base64'),E'\n','')) into result from atlas_private.reforecast_payload_chunks c where c.staging_id=u.staging_id and c.chunk_index=p_index;
 if result is null then raise exception 'Saved reforecast payload chunk unavailable';end if;return result;
end;$$;
create function public.atlas_stage_reforecast_payload(p_community_id uuid,p_request_id uuid,p_action text,p_manifest jsonb,p_manifest_hash text,p_index integer default null,p_chunk text default null,p_chunk_hash text default null) returns jsonb language sql security invoker set search_path='' as $$ select atlas_private.stage_reforecast_payload(p_community_id,p_request_id,p_action,p_manifest,p_manifest_hash,p_index,p_chunk,p_chunk_hash) $$;
create function public.atlas_read_reforecast_payload_chunk(p_upload_id uuid,p_index integer default null) returns jsonb language sql security invoker set search_path='' as $$ select atlas_private.read_reforecast_payload_chunk(p_upload_id,p_index) $$;
revoke all on function atlas_private.reforecast_payload_immutable(),atlas_private.stage_reforecast_payload(uuid,uuid,text,jsonb,text,integer,text,text),atlas_private.read_reforecast_payload_chunk(uuid,integer),public.atlas_stage_reforecast_payload(uuid,uuid,text,jsonb,text,integer,text,text),public.atlas_read_reforecast_payload_chunk(uuid,integer) from public,anon,authenticated;
grant execute on function atlas_private.stage_reforecast_payload(uuid,uuid,text,jsonb,text,integer,text,text),atlas_private.read_reforecast_payload_chunk(uuid,integer),public.atlas_stage_reforecast_payload(uuid,uuid,text,jsonb,text,integer,text,text),public.atlas_read_reforecast_payload_chunk(uuid,integer) to authenticated;


-- Authorization is checked afresh on every chunk, finalization retry and read.
-- Original ownership does not bypass a disabled profile or revoked community.
create function atlas_private.workbook_upload_authorized(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role in ('admin','executive','regional','finance','community_manager')) and (cid is null or atlas_private.command_access(cid) or atlas_private.reforecast_access(cid,'edit'));
$$;
create function atlas_private.workbook_audit_read_authorized(id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active') and exists(
  select 1 from public.atlas_workbook_audits a where a.audit_id=id and (
   exists(select 1 from public.atlas_workbook_audit_scopes s where s.audit_id=a.audit_id and (atlas_private.command_access(s.community_id) or atlas_private.reforecast_access(s.community_id,'read')))
   or (a.owner_id=auth.uid() and not exists(select 1 from public.atlas_workbook_audit_scopes s where s.audit_id=a.audit_id))
  )
 );
$$;
drop policy audit_evidence_read on public.atlas_workbook_audits;
create policy audit_evidence_read on public.atlas_workbook_audits for select to authenticated using(atlas_private.workbook_audit_read_authorized(audit_id));

-- Reserve declared stream sizes under one owner lock across both protocols.
-- Four unfinished saves and 256 MiB total prevent unbounded staging. A retry
-- of an existing request uses its existing reservation; finalize releases it.
create function atlas_private.check_workbook_staging_capacity(p_new_bytes bigint) returns void language plpgsql security definer set search_path='' as $$
declare active_count bigint;reserved_bytes bigint;
begin
 if auth.uid() is null or p_new_bytes is null or p_new_bytes<1 then raise exception 'Authorized staging reservation required';end if;
 perform pg_advisory_xact_lock(hashtextextended('workbook-staging-owner:'||auth.uid()::text,0));
 select count(*),coalesce(sum(bytes),0) into active_count,reserved_bytes from (
  select (manifest->'audit'->>'byteLength')::bigint+(manifest->'source'->>'byteLength')::bigint as bytes from atlas_private.workbook_audit_uploads where owner_id=auth.uid() and audit_id is null and canceled_at is null
  union all select (manifest->>'byteLength')::bigint from atlas_private.reforecast_payload_uploads where owner_id=auth.uid() and upload_id is null and canceled_at is null
 ) reservations;
 if active_count>=4 or reserved_bytes+p_new_bytes>268435456 then raise exception 'Workbook staging quota exceeded: retry or complete an existing save (four unfinished saves and 256 MiB maximum)';end if;
end;$$;
revoke all on function atlas_private.workbook_upload_authorized(uuid),atlas_private.workbook_audit_read_authorized(uuid),atlas_private.check_workbook_staging_capacity(bigint) from public,anon,authenticated;
grant execute on function atlas_private.workbook_audit_read_authorized(uuid) to authenticated;


-- Explicit cancellation preserves the manifest/request tombstone and only
-- removes temporary chunks. Finalized audit/import rows are never affected.
create function atlas_private.workbook_staging_chunk_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' and auth.uid() is not null then
  if tg_table_name='workbook_audit_chunks' then if exists(select 1 from atlas_private.workbook_audit_uploads u where u.upload_id=old.upload_id and u.owner_id=auth.uid() and u.audit_id is null and u.canceled_at is not null and atlas_private.workbook_upload_authorized(u.community_id)) then return old;end if;end if;
  if tg_table_name='reforecast_payload_chunks' then if exists(select 1 from atlas_private.reforecast_payload_uploads u where u.staging_id=old.staging_id and u.owner_id=auth.uid() and u.upload_id is null and u.canceled_at is not null and atlas_private.reforecast_access(u.community_id,'edit')) then return old;end if;end if;
 end if;raise exception 'Workbook chunks are immutable unless explicitly canceling an unfinished save';
end;$$;
drop trigger workbook_audit_chunk_immutable on atlas_private.workbook_audit_chunks;
create trigger workbook_audit_chunk_immutable before update or delete on atlas_private.workbook_audit_chunks for each row execute function atlas_private.workbook_staging_chunk_immutable();
drop trigger reforecast_payload_chunk_immutable on atlas_private.reforecast_payload_chunks;
create trigger reforecast_payload_chunk_immutable before update or delete on atlas_private.reforecast_payload_chunks for each row execute function atlas_private.workbook_staging_chunk_immutable();

create function atlas_private.list_workbook_staging() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('uploads',coalesce(jsonb_agg(item order by item->>'created_at'),'[]'::jsonb)) from (
  select jsonb_build_object('kind','audit','requestId',request_id,'manifestHash',manifest_hash,'community_id',community_id,'created_at',created_at,'declaredBytes',(manifest->'audit'->>'byteLength')::bigint+(manifest->'source'->>'byteLength')::bigint) item from atlas_private.workbook_audit_uploads where owner_id=auth.uid() and audit_id is null and canceled_at is null and atlas_private.workbook_upload_authorized(community_id)
  union all
  select jsonb_build_object('kind','intake','requestId',request_id,'manifestHash',manifest_hash,'community_id',community_id,'created_at',created_at,'declaredBytes',(manifest->>'byteLength')::bigint) from atlas_private.reforecast_payload_uploads where owner_id=auth.uid() and upload_id is null and canceled_at is null and atlas_private.reforecast_access(community_id,'edit')
 ) pending;
$$;
create function atlas_private.cancel_workbook_staging(p_kind text,p_request_id uuid,p_manifest_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a atlas_private.workbook_audit_uploads;r atlas_private.reforecast_payload_uploads;retry uuid;
begin
 if auth.uid() is null or p_kind is null or p_kind not in ('audit','intake') then raise exception 'Authorized unfinished save cancellation required';end if;
 -- Same lock ordering as begin prevents cancellation/reservation deadlocks.
 if p_kind='audit' then perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 else perform pg_advisory_xact_lock(hashtextextended('reforecast-payload:'||auth.uid()::text||p_request_id::text,0));end if;
 perform pg_advisory_xact_lock(hashtextextended('workbook-staging-owner:'||auth.uid()::text,0));
 if p_kind='audit' then
  select * into a from atlas_private.workbook_audit_uploads where owner_id=auth.uid() and request_id=p_request_id for update;
  if a.upload_id is null or a.manifest_hash is distinct from p_manifest_hash or not atlas_private.workbook_upload_authorized(a.community_id) then raise exception 'Unfinished save is outside authorized scope or its manifest changed';end if;
  if a.audit_id is not null then raise exception 'Finalized workbook evidence cannot be canceled';end if;
  if a.canceled_at is null then
   retry:=gen_random_uuid();update atlas_private.workbook_audit_uploads set canceled_at=now(),canceled_by=auth.uid(),retry_request_id=retry where upload_id=a.upload_id;
   delete from atlas_private.workbook_audit_chunks where upload_id=a.upload_id;
  else retry:=a.retry_request_id;end if;
 else
  select * into r from atlas_private.reforecast_payload_uploads where owner_id=auth.uid() and request_id=p_request_id for update;
  if r.staging_id is null or r.manifest_hash is distinct from p_manifest_hash or not atlas_private.reforecast_access(r.community_id,'edit') then raise exception 'Unfinished save is outside authorized scope or its manifest changed';end if;
  if r.upload_id is not null then raise exception 'Finalized reforecast import cannot be canceled';end if;
  if r.canceled_at is null then
   retry:=gen_random_uuid();update atlas_private.reforecast_payload_uploads set canceled_at=now(),canceled_by=auth.uid(),retry_request_id=retry where staging_id=r.staging_id;
   delete from atlas_private.reforecast_payload_chunks where staging_id=r.staging_id;
  else retry:=r.retry_request_id;end if;
 end if;
 return jsonb_build_object('kind',p_kind,'requestId',p_request_id,'canceled',true,'retry_request_id',retry);
end;$$;
create function public.atlas_list_workbook_staging() returns jsonb language sql security invoker set search_path='' as $$ select atlas_private.list_workbook_staging() $$;
create function public.atlas_cancel_workbook_staging(p_kind text,p_request_id uuid,p_manifest_hash text) returns jsonb language sql security invoker set search_path='' as $$ select atlas_private.cancel_workbook_staging(p_kind,p_request_id,p_manifest_hash) $$;
revoke all on function atlas_private.workbook_staging_chunk_immutable(),atlas_private.list_workbook_staging(),atlas_private.cancel_workbook_staging(text,uuid,text),public.atlas_list_workbook_staging(),public.atlas_cancel_workbook_staging(text,uuid,text) from public,anon,authenticated;
grant execute on function atlas_private.list_workbook_staging(),atlas_private.cancel_workbook_staging(text,uuid,text),public.atlas_list_workbook_staging(),public.atlas_cancel_workbook_staging(text,uuid,text) to authenticated;
