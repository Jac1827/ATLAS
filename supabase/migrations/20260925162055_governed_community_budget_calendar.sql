-- Settings-based fiscal identity. No financial amounts or communities are created.
begin;
alter table public.atlas_communities add column if not exists budget_calendar jsonb;
create table public.atlas_budget_calendar_events(
 event_id uuid primary key default gen_random_uuid(), community_id uuid not null references public.atlas_communities,
 before_settings jsonb, after_settings jsonb not null, actor_id uuid references auth.users,
 action text not null, reason text not null, created_at timestamptz not null default now());
alter table public.atlas_budget_calendar_events enable row level security;
revoke all on public.atlas_budget_calendar_events from public,anon,authenticated;
grant select on public.atlas_budget_calendar_events to authenticated;
create policy budget_calendar_history_read on public.atlas_budget_calendar_events for select to authenticated using(atlas_private.reforecast_access(community_id));
create trigger budget_calendar_history_immutable before update or delete on public.atlas_budget_calendar_events for each row execute function atlas_private.finance_immutable();
create or replace function atlas_private.budget_calendar(cid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb;s jsonb;kind text;start_month integer;candidates text[];
begin
 select to_jsonb(x) into c from public.atlas_communities x where community_id=cid and deleted_at is null;
 s:=c->'budget_calendar';
 if s->>'verified'='true' and coalesce(s->>'source','')<>'' then kind:=s->>'classification';
 else
 if c->>'review_status'='review_required' and coalesce((c->'review_flags')::text,'') ~* 'market|property_type|classification|financial' then return jsonb_build_object('verified',false,'reason','Verify inferred financial classification in Community Settings.');end if;
 select array_agg(distinct x) into candidates from unnest(array[c->>'market',c->>'property_type']) x where x in ('Multifamily','Student Housing');
 if cardinality(candidates)=1 then kind:=candidates[1];end if;
 end if;
 start_month:=case kind when 'Multifamily' then 1 when 'Student Housing' then 8 end;
 if start_month is null or s->>'verified'='true' and (s->>'startMonth')::integer is distinct from start_month then return jsonb_build_object('verified',false,'reason','Verify the financial classification in Community Settings.');end if;
 return jsonb_build_object('verified',true,'classification',kind,'startMonth',start_month,'basis',case start_month when 1 then 'calendar' else 'fiscal' end,'settingsVersion',coalesce(s->'version',c->'version'),'source',coalesce(s->>'source','Community Settings'),'summerTurnMonths',case start_month when 8 then '[6,7,8]'::jsonb else '[]'::jsonb end);
end;$$;
revoke all on function atlas_private.budget_calendar(uuid) from public,anon,authenticated;
create function public.atlas_read_budget_calendar(p_community_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not atlas_private.reforecast_access(p_community_id) then raise exception 'Community access denied';end if;
 return atlas_private.budget_calendar(p_community_id);
end;$$;
create function public.atlas_set_budget_calendar(p_community_id uuid,p_expected_version integer,p_classification text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.atlas_communities;s jsonb;
begin
 if not atlas_private.reforecast_access(p_community_id) or not exists(select 1 from public.atlas_user_profiles where user_id=auth.uid() and status='active' and role='admin') then raise exception 'Community Settings administrator required';end if;
 if p_classification not in ('Multifamily','Student Housing') or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Explicit classification and verification reason required';end if;
 select * into c from public.atlas_communities where community_id=p_community_id for update;
 if c.version is distinct from p_expected_version then raise exception 'Community Settings changed; reload before saving';end if;
 s:=jsonb_build_object('classification',p_classification,'startMonth',case p_classification when 'Student Housing' then 8 else 1 end,'verified',true,'source','Community Settings review','ownerId',auth.uid(),'effectiveDate',current_date,'version',coalesce((c.budget_calendar->>'version')::integer,0)+1,'reason',p_reason);
 update public.atlas_communities set budget_calendar=s,version=version+1,updated_at=now() where community_id=p_community_id;
 insert into public.atlas_budget_calendar_events(community_id,before_settings,after_settings,actor_id,action,reason) values(p_community_id,c.budget_calendar,s,auth.uid(),'verified',p_reason);
 return atlas_private.budget_calendar(p_community_id);
end;$$;
revoke all on function public.atlas_read_budget_calendar(uuid),public.atlas_set_budget_calendar(uuid,integer,text,text) from public,anon;
grant execute on function public.atlas_read_budget_calendar(uuid),public.atlas_set_budget_calendar(uuid,integer,text,text) to authenticated;
-- The named classifications below are explicit owner instructions in the Sep 25
-- acceptance specification, not filename heuristics or numerical budget seeds.
-- Resolve existing canonical identity/approved alias. Ambiguity aborts migration.
do $$
declare spec record;ids uuid[];cid uuid;prior jsonb;settings jsonb;
begin
 for spec in select * from (values('RISE Doro','Multifamily'),('The Preserve at Tech','Student Housing')) x(name,classification) loop
 select array_agg(distinct c.community_id) into ids from public.atlas_communities c left join public.atlas_community_aliases a on a.community_id=c.community_id and a.active where c.deleted_at is null and (lower(c.display_name)=lower(spec.name) or lower(c.canonical_name)=lower(spec.name) or lower(a.alias)=lower(spec.name));
 if cardinality(ids)>1 then raise exception 'Ambiguous canonical community for approved calendar: %',spec.name;end if;
 if cardinality(ids)=1 then
 cid:=ids[1];select budget_calendar into prior from public.atlas_communities where community_id=cid;
 if prior->>'verified'='true' and prior->>'classification'<>spec.classification then raise exception 'Existing verified calendar conflicts with owner specification for %',spec.name;end if;
 settings:=jsonb_build_object('classification',spec.classification,'startMonth',case spec.classification when 'Student Housing' then 8 else 1 end,'verified',true,'source','Owner approved Budget Builder specification 2026-09-25','effectiveDate','2026-09-25','version',coalesce((prior->>'version')::integer,0)+1);
 update public.atlas_communities set budget_calendar=settings,version=version+1,updated_at=now() where community_id=cid;
 insert into public.atlas_budget_calendar_events(community_id,before_settings,after_settings,action,reason) values(cid,prior,settings,'owner_specification','Explicit community financial classification supplied in owner acceptance specification; historical financial snapshots unchanged');
 if spec.name='The Preserve at Tech' then
 if exists(select 1 from public.atlas_community_aliases where lower(alias)='ruston' and active and community_id<>cid) then raise exception 'Ruston alias conflicts with canonical Preserve identity';end if;
 if not exists(select 1 from public.atlas_community_aliases where lower(alias)='ruston' and active and community_id=cid) then insert into public.atlas_community_aliases(community_id,alias,source_module,active) values(cid,'Ruston','owner_approved_budget_governance',true);end if;
 end if;
 end if;
 end loop;
end;$$;
commit;
