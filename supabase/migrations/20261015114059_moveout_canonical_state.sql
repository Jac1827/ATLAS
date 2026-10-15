-- Additive, service-only canonical state. Worker resolves user/community scope first.
create table public.atlas_moveout_states (
 community_id uuid primary key references public.atlas_communities(community_id),
 version bigint not null check(version>0),
 payload jsonb not null check(octet_length(payload::text)<=8388608),
 updated_at timestamptz not null default now(), updated_by uuid not null
);
create table public.atlas_moveout_state_revisions (
 community_id uuid not null references public.atlas_communities(community_id),
 version bigint not null, request_id uuid not null unique, actor_id uuid not null,
 payload jsonb not null, created_at timestamptz not null default now(),
 primary key(community_id,version)
);
create table public.atlas_moveout_photos (
 community_id uuid not null references public.atlas_communities(community_id),
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 data_url text not null check(octet_length(data_url)<=14680064),
 created_by uuid not null, created_at timestamptz not null default now(),
 primary key(community_id,content_hash)
);
alter table public.atlas_moveout_states enable row level security;
alter table public.atlas_moveout_state_revisions enable row level security;
alter table public.atlas_moveout_photos enable row level security;
revoke all on public.atlas_moveout_states,public.atlas_moveout_state_revisions,public.atlas_moveout_photos from public,anon,authenticated;
grant select,insert,update on public.atlas_moveout_states to service_role;
grant select,insert on public.atlas_moveout_state_revisions,public.atlas_moveout_photos to service_role;
create function public.atlas_save_moveout_state(p_community_id uuid,p_expected_version bigint,p_request_id uuid,p_actor_id uuid,p_payload jsonb,p_photo_hashes text[])
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare current_version bigint; prior public.atlas_moveout_state_revisions; next_version bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('moveout:'||p_community_id::text,0));
 select * into prior from public.atlas_moveout_state_revisions where request_id=p_request_id;
 if found then
  if prior.community_id<>p_community_id or prior.actor_id<>p_actor_id or prior.payload<>p_payload then raise exception 'Request identity conflict'; end if;
  return jsonb_build_object('version',prior.version,'replayed',true);
 end if;
 select version into current_version from public.atlas_moveout_states where community_id=p_community_id;
 if coalesce(current_version,0)<>p_expected_version then raise exception 'Version conflict: another session saved this community. Local changes are retained for reconciliation.'; end if;
 if exists(select 1 from unnest(p_photo_hashes) h where not exists(select 1 from public.atlas_moveout_photos p where p.community_id=p_community_id and p.content_hash=h)) then raise exception 'Photo evidence has not been committed'; end if;
 if octet_length(p_payload::text)>8388608 then raise exception 'Case metadata exceeds 8 MiB'; end if;
 next_version:=coalesce(current_version,0)+1;
 insert into public.atlas_moveout_state_revisions(community_id,version,request_id,actor_id,payload) values(p_community_id,next_version,p_request_id,p_actor_id,p_payload);
 insert into public.atlas_moveout_states(community_id,version,payload,updated_by) values(p_community_id,next_version,p_payload,p_actor_id)
 on conflict(community_id) do update set version=excluded.version,payload=excluded.payload,updated_by=excluded.updated_by,updated_at=now();
 return jsonb_build_object('version',next_version,'replayed',false);
end $$;
revoke all on function public.atlas_save_moveout_state(uuid,bigint,uuid,uuid,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.atlas_save_moveout_state(uuid,bigint,uuid,uuid,jsonb,text[]) to service_role;
