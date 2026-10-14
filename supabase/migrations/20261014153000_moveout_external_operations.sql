-- Service-only receipts. No resident content or provider credentials are exposed via the public Data API.
create table if not exists public.atlas_moveout_external_operations (
 request_id uuid primary key,
 community_id uuid not null references public.atlas_communities(community_id),
 case_id text not null,
 entity_id text not null,
 kind text not null check(kind in ('email','calendar')),
 actor_id uuid not null,
 payload_hash text not null,
 request_payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','accepted','synchronized','cancelled','failed','unknown')),
 result jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.atlas_moveout_external_operations enable row level security;
revoke all on public.atlas_moveout_external_operations from public, anon, authenticated;
grant select,insert,update on public.atlas_moveout_external_operations to service_role;
create index if not exists atlas_moveout_external_entity_idx on public.atlas_moveout_external_operations(community_id,case_id,kind,entity_id,created_at desc);
create or replace function public.atlas_claim_moveout_external_operation(p_request_id uuid,p_community_id uuid,p_case_id text,p_entity_id text,p_kind text,p_actor_id uuid,p_payload_hash text,p_request_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare prior public.atlas_moveout_external_operations;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_community_id::text||':'||p_case_id||':'||p_kind||':'||p_entity_id,0));
 select * into prior from public.atlas_moveout_external_operations where request_id=p_request_id;
 if found then
  if prior.community_id<>p_community_id or prior.case_id<>p_case_id or prior.kind<>p_kind or prior.payload_hash<>p_payload_hash then raise exception 'Request identity conflicts with retained operation'; end if;
  return jsonb_build_object('claimed',false,'operation',to_jsonb(prior));
 end if;
 if exists(select 1 from public.atlas_moveout_external_operations where community_id=p_community_id and case_id=p_case_id and kind=p_kind and entity_id=p_entity_id and status in ('pending','unknown')) then
  raise exception 'An earlier operation is pending or uncertain. Verify it before retrying.';
 end if;
 insert into public.atlas_moveout_external_operations(request_id,community_id,case_id,entity_id,kind,actor_id,payload_hash,request_payload)
 values(p_request_id,p_community_id,p_case_id,p_entity_id,p_kind,p_actor_id,p_payload_hash,p_request_payload);
 return jsonb_build_object('claimed',true);
end $$;
revoke all on function public.atlas_claim_moveout_external_operation(uuid,uuid,text,text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.atlas_claim_moveout_external_operation(uuid,uuid,text,text,text,uuid,text,jsonb) to service_role;

create table if not exists public.atlas_moveout_document_templates (
 kind text not null check(kind in ('mog','ntv','possession')),
 version integer not null check(version>0),
 template jsonb not null,
 updated_by uuid not null,
 created_at timestamptz not null default now(),
 primary key(kind,version)
);
alter table public.atlas_moveout_document_templates enable row level security;
revoke all on public.atlas_moveout_document_templates from public,anon,authenticated;
grant select,insert on public.atlas_moveout_document_templates to service_role;
