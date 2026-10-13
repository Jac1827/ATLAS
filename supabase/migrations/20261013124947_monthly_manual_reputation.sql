-- Manual monthly reputation is independent of imported workspace snapshots.
-- Legacy undated ratings are intentionally not backfilled into any month.
begin;
create function atlas_private.reputation_access(cid uuid, writing boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
  select 1 from public.atlas_user_profiles p join public.atlas_communities c on c.community_id=cid
  where p.user_id=auth.uid() and p.status='active' and coalesce(p.account_status,'active')='active'
   and c.deleted_at is null and public.atlas_can_access_community(cid)
   and (c.status='active' or p.role in ('admin','executive') or cid=any(coalesce(p.allowed_community_ids,'{}')))
   and case when writing then atlas_private.workspace_tab_allowed(to_jsonb(p),6)
    else exists(select 1 from unnest(array[0,2,6,8,9]) tab where atlas_private.workspace_tab_allowed(to_jsonb(p),tab)) end
 );
$$;
revoke all on function atlas_private.reputation_access(uuid,boolean) from public,anon;
grant execute on function atlas_private.reputation_access(uuid,boolean) to authenticated;

create table public.atlas_reputation_monthly (
 community_id uuid not null references public.atlas_communities(community_id),
 period_key text not null check(period_key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 google_review_score numeric check(google_review_score between 0 and 5),
 ora_score numeric check(ora_score between 0 and 100),
 input_method text generated always as ('manual'::text) stored,
 google_availability text generated always as (case when google_review_score is null then 'unavailable' else 'available' end) stored,
 ora_availability text generated always as (case when ora_score is null then 'unavailable' else 'available' end) stored,
 version integer not null check(version>0),
 entered_by uuid not null references auth.users(id), entered_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 primary key(community_id,period_key)
);
create table public.atlas_reputation_revisions (
 request_id uuid primary key, request_hash text not null,
 community_id uuid not null references public.atlas_communities(community_id), period_key text not null,
 version integer not null, actor_id uuid not null references auth.users(id),
 previous_record jsonb, record jsonb not null, created_at timestamptz not null default now(),
 unique(community_id,period_key,version)
);
alter table public.atlas_reputation_monthly enable row level security;
alter table public.atlas_reputation_revisions enable row level security;
revoke all on public.atlas_reputation_monthly,public.atlas_reputation_revisions from public,anon,authenticated;
grant select on public.atlas_reputation_monthly,public.atlas_reputation_revisions to authenticated;
create policy reputation_monthly_read on public.atlas_reputation_monthly for select to authenticated using(atlas_private.reputation_access(community_id));
create policy reputation_revisions_read on public.atlas_reputation_revisions for select to authenticated using(atlas_private.reputation_access(community_id));
create function atlas_private.reputation_history_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Reputation history is immutable; save a new monthly revision';end;$$;
revoke all on function atlas_private.reputation_history_immutable() from public,anon,authenticated;
create trigger reputation_history_immutable before update or delete on public.atlas_reputation_revisions for each row execute function atlas_private.reputation_history_immutable();

create function atlas_private.save_reputation_month(p_community_id uuid,p_period text,p_expected_version integer,p_request_id uuid,p_google_review_score numeric,p_ora_score numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.atlas_reputation_monthly; result public.atlas_reputation_monthly; receipt public.atlas_reputation_revisions; request_hash text;
begin
 -- A role/community revocation is checked even when replaying an old receipt.
 if not atlas_private.reputation_access(p_community_id,true) then raise exception 'Monthly reputation edit access denied' using errcode='42501';end if;
 if p_period is null or p_period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_expected_version is null or p_expected_version<0 or p_request_id is null
  or (p_google_review_score is not null and not (p_google_review_score between 0 and 5))
  or (p_ora_score is not null and not (p_ora_score between 0 and 100)) then raise exception 'Invalid monthly reputation score or period' using errcode='22023';end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_community_id,p_period,p_expected_version,p_google_review_score,p_ora_score)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('monthly-reputation:'||p_community_id::text||p_period,0));
 select * into receipt from public.atlas_reputation_revisions r where r.request_id=p_request_id;
 if receipt.request_id is not null then
  if receipt.actor_id<>auth.uid() or receipt.request_hash<>request_hash then raise exception 'Reputation request was already used for different changes' using errcode='22023';end if;
  return receipt.record;
 end if;
 select * into previous from public.atlas_reputation_monthly where community_id=p_community_id and period_key=p_period for update;
 if coalesce(previous.version,0)<>p_expected_version then raise exception 'Reputation changed in another session. Reload the saved month before retrying.' using errcode='40001';end if;
 insert into public.atlas_reputation_monthly(community_id,period_key,google_review_score,ora_score,version,entered_by,updated_by)
 values(p_community_id,p_period,p_google_review_score,p_ora_score,p_expected_version+1,auth.uid(),auth.uid())
 on conflict(community_id,period_key) do update set google_review_score=excluded.google_review_score,ora_score=excluded.ora_score,
  version=excluded.version,updated_by=auth.uid(),updated_at=clock_timestamp() returning * into result;
 insert into public.atlas_reputation_revisions(request_id,request_hash,community_id,period_key,version,actor_id,previous_record,record)
 values(p_request_id,request_hash,p_community_id,p_period,result.version,auth.uid(),case when previous.version is null then null else to_jsonb(previous) end,to_jsonb(result));
 return to_jsonb(result);
end;$$;
revoke all on function atlas_private.save_reputation_month(uuid,text,integer,uuid,numeric,numeric) from public,anon;
grant execute on function atlas_private.save_reputation_month(uuid,text,integer,uuid,numeric,numeric) to authenticated;
create function public.atlas_save_reputation_month(p_community_id uuid,p_period text,p_expected_version integer,p_request_id uuid,p_google_review_score numeric,p_ora_score numeric)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select atlas_private.save_reputation_month(p_community_id,p_period,p_expected_version,p_request_id,p_google_review_score,p_ora_score);
$$;
revoke all on function public.atlas_save_reputation_month(uuid,text,integer,uuid,numeric,numeric) from public,anon;
grant execute on function public.atlas_save_reputation_month(uuid,text,integer,uuid,numeric,numeric) to authenticated;

create function public.atlas_read_reputation_months(p_community_ids uuid[],p_periods text[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if coalesce(cardinality(p_community_ids),0)>100 or coalesce(cardinality(p_periods),0)>60 or exists(select 1 from unnest(p_periods) p where p is null or p !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$') then raise exception 'Invalid reputation read scope';end if;
 return jsonb_build_object('records',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.atlas_reputation_monthly r where r.community_id=any(p_community_ids) and r.period_key=any(p_periods)),
  'editableCommunityIds',(select coalesce(jsonb_agg(cid),'[]') from (select distinct cid from unnest(p_community_ids) cid where atlas_private.reputation_access(cid,true)) s));
end;$$;
revoke all on function public.atlas_read_reputation_months(uuid[],text[]) from public,anon;
grant execute on function public.atlas_read_reputation_months(uuid[],text[]) to authenticated;
comment on table public.atlas_reputation_monthly is 'Authorized manual scores by exact community and month. NULL is unavailable; zero is measured. No legacy backfill or import writes.';
notify pgrst, 'reload schema';
commit;
