-- Monthly leasing goals have their own records; imports/settings cannot replace them.
begin;
create or replace function atlas_private.community_goal_access(cid uuid, writing boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
  select 1 from public.atlas_user_profiles p join public.atlas_communities c on c.community_id=cid
  where p.user_id=auth.uid() and p.status='active' and c.deleted_at is null
   and public.atlas_can_access_community(cid)
   and (c.status='active' or p.role in ('admin','executive') or cid=any(coalesce(p.allowed_community_ids,'{}')))
   and (case when writing then p.role in ('admin','executive')
     and not ('2'=any(coalesce(p.locked_tab_ids,'{}'))) and not ('portfolio_overview'=any(coalesce(p.locked_page_keys,'{}')))
    else atlas_private.command_access(cid) or
     (not ('9'=any(coalesce(p.locked_tab_ids,'{}'))) and not ('bonus'=any(coalesce(p.locked_page_keys,'{}')))) end)
 );
$$;
revoke all on function atlas_private.community_goal_access(uuid,boolean) from public,anon;
grant execute on function atlas_private.community_goal_access(uuid,boolean) to authenticated;

create table public.atlas_community_goal_records (
 record_id uuid primary key default gen_random_uuid(),
 community_id uuid not null references public.atlas_communities(community_id),
 period_key text not null check(period_key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 kind text not null check(kind in ('recommended','draft','approved')),
 revision integer not null check(revision>0),
 request_id uuid not null unique,
 request_fingerprint text not null,
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 reason text not null default '', effective_date date,
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(record_id,community_id,period_key)
);
create index community_goal_records_scope on public.atlas_community_goal_records(community_id,period_key,kind,revision desc);
create table public.atlas_community_goal_heads (
 community_id uuid not null references public.atlas_communities(community_id),
 period_key text not null check(period_key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 revision integer not null default 0 check(revision>=0),
 recommendation_revision integer not null default 0 check(recommendation_revision>=0),
 recommendation_id uuid, draft_id uuid, approved_id uuid,
 updated_at timestamptz not null default now(),
 primary key(community_id,period_key),
 foreign key(recommendation_id,community_id,period_key) references public.atlas_community_goal_records(record_id,community_id,period_key),
 foreign key(draft_id,community_id,period_key) references public.atlas_community_goal_records(record_id,community_id,period_key),
 foreign key(approved_id,community_id,period_key) references public.atlas_community_goal_records(record_id,community_id,period_key)
);
alter table public.atlas_community_goal_records enable row level security;
alter table public.atlas_community_goal_heads enable row level security;
create policy community_goal_records_read on public.atlas_community_goal_records for select to authenticated using(atlas_private.community_goal_access(community_id));
create policy community_goal_heads_read on public.atlas_community_goal_heads for select to authenticated using(atlas_private.community_goal_access(community_id));
revoke all on public.atlas_community_goal_records,public.atlas_community_goal_heads from public,anon,authenticated;
grant select on public.atlas_community_goal_records,public.atlas_community_goal_heads to authenticated;

create or replace function atlas_private.community_goal_immutable()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Goal history is immutable; save a new revision';end;$$;
revoke all on function atlas_private.community_goal_immutable() from public,anon,authenticated;
create trigger community_goal_immutable before update or delete on public.atlas_community_goal_records for each row execute function atlas_private.community_goal_immutable();

create or replace function public.atlas_save_community_goals(p_community_id uuid,p_period text,p_kind text,p_expected_revision integer,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare head public.atlas_community_goal_heads; rec public.atlas_community_goal_records; k text; n numeric; fingerprint text; revision_number integer;
 payload jsonb; effective date; stamp timestamptz:=now(); week jsonb; total numeric; week_ids integer[]:='{}';
begin
 if not atlas_private.community_goal_access(p_community_id,true) then raise exception 'Only an authorized Admin or executive can save community goals';end if;
 if p_period is null or p_period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_kind is null or p_kind not in ('recommended','draft','approved') or p_expected_revision is null or p_expected_revision<0 or p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>262144 then raise exception 'Invalid goal scope or payload';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_community_id,p_period,p_kind,p_payload)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('community-goals:'||p_community_id::text||p_period,0));
 select * into rec from public.atlas_community_goal_records where request_id=p_request_id;
 if rec.record_id is not null then
  if rec.actor_id<>auth.uid() or rec.request_fingerprint<>fingerprint then raise exception 'Save request was already used for different goal changes';end if;
  select * into head from public.atlas_community_goal_heads where community_id=p_community_id and period_key=p_period;
  return jsonb_build_object('head',to_jsonb(head),'record',to_jsonb(rec));
 end if;
 select * into head from public.atlas_community_goal_heads where community_id=p_community_id and period_key=p_period for update;
 if (case when p_kind='recommended' then coalesce(head.recommendation_revision,0) else coalesce(head.revision,0) end)<>p_expected_revision then raise exception 'Goals changed in another session. Your edits have been retained; reload the saved goals before retrying';end if;
 if p_kind<>'recommended' then
  if jsonb_typeof(p_payload->'reason') is distinct from 'string' or coalesce(btrim(p_payload->>'reason'),'')='' or length(p_payload->>'reason')>4000 or coalesce(p_payload->>'effectiveDate','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-[0-9]{2}$' then raise exception 'An adjustment reason and valid effective date are required';end if;
  effective:=(p_payload->>'effectiveDate')::date;
 end if;
 foreach k in array array['requiredMoveIns','applicationGoal','grossLeaseGoal','netLeaseGoal','occupancyGoal','leasedGoal','economicGoal','renewalGoal'] loop
  if not(p_payload ? k) or jsonb_typeof(p_payload->k) not in ('number','null') then raise exception 'Every goal field must contain a number or explicit null: %',k;end if;
  if jsonb_typeof(p_payload->k)='number' then
   n:=(p_payload->>k)::numeric;
   if n<0 or n>1000000 or (k in ('occupancyGoal','leasedGoal','economicGoal','renewalGoal') and n>100) or (k in ('requiredMoveIns','applicationGoal','grossLeaseGoal','netLeaseGoal') and trunc(n)<>n) then raise exception 'Invalid goal value for %',k;end if;
  elsif p_kind='approved' and k in ('requiredMoveIns','applicationGoal','grossLeaseGoal','netLeaseGoal') then raise exception 'Complete every production goal before approval';end if;
 end loop;
 if jsonb_typeof(coalesce(p_payload->'weeklyGoals','[]'))<>'array' or jsonb_array_length(coalesce(p_payload->'weeklyGoals','[]'))>5 then raise exception 'Invalid weekly goal breakdown';end if;
 if p_kind='approved' then
  if (p_payload->>'netLeaseGoal')::numeric>(p_payload->>'grossLeaseGoal')::numeric or (p_payload->>'grossLeaseGoal')::numeric>(p_payload->>'applicationGoal')::numeric then raise exception 'Applications must cover gross leases and gross leases must cover net leases';end if;
  if jsonb_array_length(coalesce(p_payload->'weeklyGoals','[]'))=0 then raise exception 'Approved goals require a weekly breakdown';end if;
  for week in select value from jsonb_array_elements(p_payload->'weeklyGoals') loop
   if jsonb_typeof(week)<>'object' or coalesce(week->>'week','') !~ '^[1-5]$' or (week->>'week')::integer=any(week_ids) or coalesce(week->>'startDay','') !~ '^([1-9]|[12][0-9]|3[01])$' or (week->>'startDay')::integer>extract(day from ((p_period||'-01')::date+interval '1 month - 1 day')) then raise exception 'Invalid or duplicate week';end if;
   week_ids:=array_append(week_ids,(week->>'week')::integer);
   foreach k in array array['applicationGoal','grossLeaseGoal','netLeaseGoal'] loop
    if jsonb_typeof(week->k) is distinct from 'number' then raise exception 'Each approved weekly goal must be a whole count';end if;
    n:=(week->>k)::numeric;if n<0 or trunc(n)<>n then raise exception 'Each approved weekly goal must be a whole count';end if;
   end loop;
  end loop;
  foreach k in array array['applicationGoal','grossLeaseGoal','netLeaseGoal'] loop
   select sum((value->>k)::numeric) into total from jsonb_array_elements(p_payload->'weeklyGoals');
   if total<>(p_payload->>k)::numeric then raise exception 'Weekly goals must total exactly to the monthly %',k;end if;
  end loop;
 end if;
 revision_number:=p_expected_revision+1;
 rec.record_id:=gen_random_uuid();
 payload:=p_payload||jsonb_build_object('id',rec.record_id,'communityId',p_community_id,'period',p_period,'monthIdx',right(p_period,2)::integer-1,'year',left(p_period,4)::integer,'status',case p_kind when 'approved' then 'Approved' when 'draft' then 'Draft' else 'Recommended' end,'version',revision_number,'effectiveDate',effective,'reason',case when p_kind='recommended' then '' else btrim(p_payload->>'reason') end,'revisedAt',stamp,'updatedBy',auth.uid(),'approvedAt',case when p_kind='approved' then stamp else null end,'approver',case when p_kind='approved' then auth.uid() else null end,'approvedBy',case when p_kind='approved' then auth.uid() else null end);
 insert into public.atlas_community_goal_records(record_id,community_id,period_key,kind,revision,request_id,request_fingerprint,payload,reason,effective_date,actor_id,created_at)
 values(rec.record_id,p_community_id,p_period,p_kind,revision_number,p_request_id,fingerprint,payload,coalesce(payload->>'reason',''),effective,auth.uid(),stamp) returning * into rec;
 insert into public.atlas_community_goal_heads(community_id,period_key) values(p_community_id,p_period) on conflict do nothing;
 update public.atlas_community_goal_heads set
  revision=case when p_kind='recommended' then revision else revision_number end,
  recommendation_revision=case when p_kind='recommended' then revision_number else recommendation_revision end,
  recommendation_id=case when p_kind='recommended' then rec.record_id else recommendation_id end,
  draft_id=case when p_kind='draft' then rec.record_id when p_kind='approved' then null else draft_id end,
  approved_id=case when p_kind='approved' then rec.record_id else approved_id end,
  updated_at=stamp where community_id=p_community_id and period_key=p_period returning * into head;
 return jsonb_build_object('head',to_jsonb(head),'record',to_jsonb(rec));
end;$$;
revoke all on function public.atlas_save_community_goals(uuid,text,text,integer,uuid,jsonb) from public,anon;
grant execute on function public.atlas_save_community_goals(uuid,text,text,integer,uuid,jsonb) to authenticated;

-- Reports read the same approved record as the interactive goals/Bonus consumers.
create or replace function atlas_private.community_goal_for_period(cid uuid,period text)
returns jsonb language sql stable set search_path='' as $$
 select payload from public.atlas_community_goal_records where community_id=cid and period_key=period and kind='approved'
  and effective_date<=greatest((period||'-01')::date,least((now() at time zone 'America/New_York')::date,((period||'-01')::date+interval '1 month - 1 day')::date))
 order by revision desc limit 1;
$$;
revoke all on function atlas_private.community_goal_for_period(uuid,text) from public,anon,authenticated;
create or replace function public.atlas_generate_community_plan_report(p_plan_id uuid,p_expected_version integer,p_note text default '',p_occupancy jsonb default null)
returns public.atlas_community_plan_reports language plpgsql security definer set search_path='' as $$
declare plan public.atlas_community_plans; result public.atlas_community_plan_reports; financial jsonb; occupancy jsonb; occupied numeric; rentable numeric; target numeric; prior public.atlas_community_plan_reports; previous jsonb; review jsonb; approved_goals jsonb;
begin
 select * into plan from public.atlas_community_plans where plan_id=p_plan_id for share;
 if plan.plan_id is null or not atlas_private.command_access(plan.community_id,'edit') then raise exception 'Plan report access denied';end if;
 if plan.version is distinct from p_expected_version then raise exception 'Plan changed in another session; reload before reporting';end if;
 review:=coalesce(plan.payload->'reportReview','{}');
 if length(coalesce(review->>'topCauses',''))>2000 or length(coalesce(review->>'materialRisks',''))>2000 or (coalesce(review->>'expectedResolutionDate','')<>'' and review->>'expectedResolutionDate' !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-[0-9]{2}$') then raise exception 'Invalid report review';end if;
 if p_note is null or length(p_note)>4000 then raise exception 'Invalid executive note';end if;
 select jsonb_build_object('publicationId',publication_id,'summary',summary-'close') into financial from public.atlas_read_finance(array[plan.community_id],array[plan.period_key]);
 if p_occupancy is not null and p_occupancy<>'null'::jsonb then
  if p_occupancy->>'communityId' is distinct from plan.community_id::text or p_occupancy->>'period' is distinct from plan.period_key or jsonb_typeof(p_occupancy->'occupiedUnits') is distinct from 'number' or jsonb_typeof(p_occupancy->'rentableUnits') is distinct from 'number' or coalesce(p_occupancy->>'source','')='' or coalesce(p_occupancy->>'sourceTimestamp','')='' or coalesce(p_occupancy->>'revisionKey','')='' then raise exception 'Verified period-specific occupancy source required';end if;
  occupied:=(p_occupancy->>'occupiedUnits')::numeric;rentable:=(p_occupancy->>'rentableUnits')::numeric;
  if rentable<=0 or occupied<0 or occupied>rentable or trunc(occupied)<>occupied or trunc(rentable)<>rentable then raise exception 'Invalid occupancy source counts';end if;
  target:=ceil((financial->'summary'->>'occupancyPct')::numeric*rentable/100);
  occupancy:=jsonb_build_object('occupiedUnits',occupied,'rentableUnits',rentable,'physicalPct',occupied/rentable*100,'budgetPct',financial->'summary'->'occupancyPct','budgetUnits',target,'variance',occupied-target,'source',p_occupancy->'source','sourceTimestamp',p_occupancy->'sourceTimestamp','revisionKey',p_occupancy->'revisionKey');
 end if;
 approved_goals:=atlas_private.community_goal_for_period(plan.community_id,plan.period_key);
 perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text||':report',0));
 select * into result from public.atlas_community_plan_reports where snapshot->>'reportSchemaVersion'='4' and plan_id=p_plan_id and plan_version=plan.version and executive_note=p_note and (snapshot->'financial') is not distinct from coalesce(financial,'null'::jsonb) and (snapshot->'occupancy') is not distinct from coalesce(occupancy,'null'::jsonb) and (snapshot->'approvedGoals') is not distinct from coalesce(approved_goals,'null'::jsonb) order by created_at limit 1;
 if result.report_id is not null then return result;end if;
 select * into prior from public.atlas_community_plan_reports where community_id=plan.community_id and snapshot->>'period'<=plan.period_key order by created_at desc,report_id desc limit 1;
 if prior.report_id is not null then previous:=jsonb_build_object('reportId',prior.report_id,'period',prior.snapshot->'period','generatedAt',prior.created_at,'financial',prior.snapshot->'financial','occupancy',prior.snapshot->'occupancy','tasks',(select coalesce(jsonb_agg(jsonb_build_object('id',t->'id','status',t->'status')),'[]') from jsonb_array_elements(prior.snapshot->'plan'->'tasks') t));end if;
 insert into public.atlas_community_plan_reports(plan_id,community_id,plan_version,executive_note,snapshot,created_by)
 values(plan.plan_id,plan.community_id,plan.version,p_note,jsonb_build_object('reportSchemaVersion',4,'approvedGoals',approved_goals,'previousReport',previous,'review',review,'plan',plan.payload,'period',plan.period_key,'sourceUpdatedAt',plan.updated_at,'community',(select display_name from public.atlas_communities where community_id=plan.community_id),'financial',financial,'occupancy',occupancy,'coverage',case when occupancy is null then 'Operational occupancy source is unavailable in this snapshot. ' else 'Occupancy uses the retained period-specific source revision. ' end||'Missing or incomplete financial coverage must be resolved in Budget Builder; underspend does not establish true savings.'),auth.uid()) returning * into result;
 return result;
end;$$;
revoke all on function public.atlas_generate_community_plan_report(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.atlas_generate_community_plan_report(uuid,integer,text,jsonb) to authenticated;

commit;
