-- A working save and an approval publication share one receipt namespace.
-- Their per-table UNIQUE constraints alone allowed one request ID to describe
-- two unrelated operations and the receipt reader to combine their records.
begin;
-- A real unique constraint also protects callers using a fixed transaction
-- snapshot. Advisory locks followed by SELECT alone only suffice at READ
-- COMMITTED. Block inserts briefly while binding existing metadata and adding
-- both triggers, so no request can fall between the backfill and enforcement.
lock table public.atlas_reforecast_revisions,public.atlas_reforecast_publications in share row exclusive mode;
create table atlas_private.reforecast_write_requests(
 request_id uuid primary key,
 binding_kind text not null check(binding_kind in ('revision','publication','legacy_ambiguous')),
 revision_id uuid,
 publication_id uuid,
 recorded_at timestamptz not null default now(),
 check((binding_kind='revision' and revision_id is not null and publication_id is null)
 or (binding_kind='publication' and revision_id is null and publication_id is not null)
 or (binding_kind='legacy_ambiguous' and revision_id is not null and publication_id is not null))
);
alter table atlas_private.reforecast_write_requests enable row level security;
revoke all on atlas_private.reforecast_write_requests from public,anon,authenticated;
insert into atlas_private.reforecast_write_requests(request_id,binding_kind,revision_id,publication_id)
 select coalesce(r.request_id,p.request_id),case when r.revision_id is not null and p.publication_id is not null then 'legacy_ambiguous'
 when r.revision_id is not null then 'revision' else 'publication' end,r.revision_id,p.publication_id
 from public.atlas_reforecast_revisions r full join public.atlas_reforecast_publications p on p.request_id=r.request_id;
create trigger reforecast_write_request_immutable before update or delete on atlas_private.reforecast_write_requests
for each row execute function atlas_private.finance_immutable();
create function atlas_private.reforecast_request_identity_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='atlas_reforecast_revisions' then
  begin
   insert into atlas_private.reforecast_write_requests(request_id,binding_kind,revision_id) values(new.request_id,'revision',new.revision_id);
  exception when unique_violation then
   raise exception 'Reforecast request ID is already bound to a publication or saved revision; use a new request ID for a new write';
  end;
 elsif tg_table_name='atlas_reforecast_publications' then
  begin
   insert into atlas_private.reforecast_write_requests(request_id,binding_kind,publication_id) values(new.request_id,'publication',new.publication_id);
  exception when unique_violation then
   raise exception 'Reforecast request ID is already bound to a saved revision or publication; use a new request ID for a new write';
  end;
 else
  raise exception 'Unsupported reforecast request identity relation';
 end if;
 return new;
end;$$;
revoke all on function atlas_private.reforecast_request_identity_guard() from public,anon,authenticated;
create trigger aa_reforecast_request_identity before insert on public.atlas_reforecast_revisions
for each row execute function atlas_private.reforecast_request_identity_guard();
create trigger aa_reforecast_request_identity before insert on public.atlas_reforecast_publications
for each row execute function atlas_private.reforecast_request_identity_guard();

-- Keep historical receipts immutable. If an older deployment already allowed
-- a cross-table collision, fail closed rather than returning a mixed receipt.
do $migration$
declare definition text;anchor text;
begin
 definition:=pg_get_functiondef('atlas_private.read_reforecast_save_receipt(uuid,uuid)'::regprocedure);
 anchor:=$anchor$select * into pub from public.atlas_reforecast_publications where community_id=p_community_id and request_id=p_request_id;$anchor$;
 if position(anchor in definition)=0 then raise exception 'Save receipt definition changed; review request consistency before migration';end if;
 definition:=replace(definition,anchor,anchor||$guard$
 if r.revision_id is not null and pub.publication_id is not null
 and (r.revision_id is distinct from pub.revision_id or r.scenario_id is distinct from pub.scenario_id or r.community_id is distinct from pub.community_id) then
  raise exception 'Immutable save receipt request identity is ambiguous';
 end if;$guard$);
 execute definition;
end;$migration$;
commit;
