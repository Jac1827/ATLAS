begin;
-- Inspect a committed reservation without taking a write/advisory lock. Only
-- the current authorized uploader can resume its exact request and manifest.
create function atlas_private.read_reforecast_payload_receipt(p_community_id uuid,p_request_id uuid,p_manifest_hash text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u atlas_private.reforecast_payload_uploads;r public.atlas_reforecast_uploads;chunks jsonb;
begin
 if auth.uid() is null or not atlas_private.reforecast_access(p_community_id,'edit') then raise exception 'Authorized reforecast editor required';end if;
 if p_request_id is null or coalesce(p_manifest_hash,'')!~'^[a-f0-9]{64}$' then raise exception 'Exact reforecast request and manifest required';end if;
 select * into u from atlas_private.reforecast_payload_uploads where owner_id=auth.uid() and request_id=p_request_id;
 if not found then return null;end if;
 if u.community_id is distinct from p_community_id or u.manifest_hash is distinct from p_manifest_hash then raise exception 'Reforecast request manifest or scope mismatch';end if;
 if u.upload_id is not null then
  select * into r from public.atlas_reforecast_uploads where upload_id=u.upload_id;
  if r.upload_id is null or r.community_id is distinct from p_community_id then raise exception 'Finalized reforecast source receipt is unavailable';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('chunk_index',c.chunk_index,'sha256',c.sha256,'byte_length',octet_length(c.payload)) order by c.chunk_index),'[]'::jsonb) into chunks from atlas_private.reforecast_payload_chunks c where c.staging_id=u.staging_id;
 return jsonb_build_object('staging_id',u.staging_id,'upload_id',u.upload_id,'manifest_hash',u.manifest_hash,'canceled',u.canceled_at is not null,'retry_request_id',u.retry_request_id,'record',case when r.upload_id is null then null else to_jsonb(r)-'payload' end,'chunks',chunks);
end;$$;
create function public.atlas_read_reforecast_payload_receipt(p_community_id uuid,p_request_id uuid,p_manifest_hash text) returns jsonb language sql stable security invoker set search_path='' as $$select atlas_private.read_reforecast_payload_receipt(p_community_id,p_request_id,p_manifest_hash)$$;
revoke all on function atlas_private.read_reforecast_payload_receipt(uuid,uuid,text),public.atlas_read_reforecast_payload_receipt(uuid,uuid,text) from public,anon,authenticated;
grant execute on function atlas_private.read_reforecast_payload_receipt(uuid,uuid,text),public.atlas_read_reforecast_payload_receipt(uuid,uuid,text) to authenticated;
commit;
