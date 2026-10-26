-- Retain STR planning programmes independently of browser storage and publication.
-- These records are editable planning revisions, never an approved financial baseline.
begin;
create table public.atlas_str_programme_revisions (
 revision_id uuid primary key default gen_random_uuid(),programme_id uuid not null,
 community_id uuid not null references public.atlas_communities(community_id),revision integer not null check(revision>0),
 previous_revision_id uuid references public.atlas_str_programme_revisions(revision_id),
 request_id uuid not null unique,request_hash text not null,content_hash text not null,
 payload jsonb not null,target_budget jsonb,status text not null default 'working_draft' check(status='working_draft'),
 actor_id uuid not null references auth.users(id),actor_role text not null,created_at timestamptz not null default now(),
 unique(programme_id,revision),unique(revision_id,community_id,programme_id)
);
create table public.atlas_str_programme_heads (
 programme_id uuid primary key,community_id uuid not null references public.atlas_communities(community_id),
 revision_id uuid not null,revision integer not null check(revision>0),status text not null default 'working_draft' check(status='working_draft'),
 foreign key(revision_id,community_id,programme_id) references public.atlas_str_programme_revisions(revision_id,community_id,programme_id)
);
create index atlas_str_programme_scope on public.atlas_str_programme_heads(community_id,programme_id);
create index atlas_str_programme_history on public.atlas_str_programme_revisions(community_id,programme_id,revision desc);
alter table public.atlas_str_programme_revisions enable row level security;
alter table public.atlas_str_programme_heads enable row level security;
revoke all on public.atlas_str_programme_revisions,public.atlas_str_programme_heads from public,anon,authenticated;
grant select on public.atlas_str_programme_revisions,public.atlas_str_programme_heads to authenticated;
create policy str_programme_read on public.atlas_str_programme_revisions for select to authenticated using(atlas_private.reforecast_access(community_id,'read'));
create policy str_programme_read on public.atlas_str_programme_heads for select to authenticated using(atlas_private.reforecast_access(community_id,'read'));
create trigger str_programme_history_immutable before update or delete on public.atlas_str_programme_revisions for each row execute function atlas_private.finance_immutable();

-- Missing amounts propagate to their financial category and dependent totals.
create function atlas_private.str_programme_metrics(rows jsonb) returns jsonb language sql immutable set search_path='' as $$
 with totals as (
 select case when count(*) filter(where r->>'nature' in ('income','contra_income') and jsonb_typeof(r->'amount')<>'number')>0 then null else round(coalesce(sum((r->>'amount')::numeric) filter(where r->>'nature' in ('income','contra_income')),0),2) end revenue,
 case when count(*) filter(where r->>'nature'='expense' and jsonb_typeof(r->'amount')<>'number')>0 then null else round(coalesce(sum((r->>'amount')::numeric) filter(where r->>'nature'='expense'),0),2) end expenses,
 case when count(*) filter(where r->>'nature'='capital' and jsonb_typeof(r->'amount')<>'number')>0 then null else round(coalesce(sum((r->>'amount')::numeric) filter(where r->>'nature'='capital'),0),2) end capital,
 case when count(*) filter(where r->>'nature'='debt' and jsonb_typeof(r->'amount')<>'number')>0 then null else round(coalesce(sum((r->>'amount')::numeric) filter(where r->>'nature'='debt'),0),2) end debt,
 case when count(*) filter(where r->>'nature'='below_noi' and jsonb_typeof(r->'amount')<>'number')>0 then null else round(coalesce(sum((r->>'amount')::numeric) filter(where r->>'nature'='below_noi'),0),2) end below_noi
 from jsonb_array_elements(rows) r)
 select jsonb_build_object('revenue',revenue,'expenses',expenses,'capital',capital,'debt',debt,'belowNoi',below_noi,'netOperatingIncome',revenue-expenses,'netCashFlow',revenue-expenses-capital-debt-below_noi) from totals;
$$;
create function atlas_private.validate_str_programme_metrics(actual jsonb,expected jsonb) returns void language plpgsql immutable set search_path='' as $$
declare key text;begin
 for key in select jsonb_object_keys(expected) loop
  if not coalesce(actual ? key,false) or jsonb_typeof(actual->key) is distinct from jsonb_typeof(expected->key)
   or jsonb_typeof(expected->key)='number' and abs((actual->>key)::numeric-(expected->>key)::numeric)>0.005 then
   raise exception 'STR report total % does not reconcile to retained monthly GL values',key;
  end if;
 end loop;
end;$$;
create function atlas_private.validate_str_programme_payload(p jsonb) returns void language plpgsql immutable set search_path='' as $$
declare line jsonb;row jsonb;y jsonb;amount jsonb;period text;n integer;month integer;selected jsonb;report jsonb:=p->'reportSnapshot';expected jsonb;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>10485760 or p->>'schemaVersion' is distinct from 'atlas.str-programme-draft.v1'
  or length(trim(coalesce(p->>'name','')))<1 or length(p->>'name')>200 or length(trim(coalesce(p->>'reason','')))<3
  or length(trim(coalesce(p->>'sourcePropertyId','')))=0 or length(trim(coalesce(p->>'sourceProgrammeId','')))=0
  or coalesce(jsonb_typeof(p->'config'),'missing') not in ('object','null') or jsonb_typeof(p->'property') is distinct from 'object'
  or jsonb_typeof(p->'programme') is distinct from 'object' or jsonb_typeof(p->'groups') is distinct from 'array'
  or jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_typeof(p->'years') is distinct from 'array'
  or jsonb_array_length(p->'years') not between 1 and 5 or jsonb_array_length(p->'lines')>500
  or p#>>'{property,id}' is distinct from p->>'sourcePropertyId' or p#>>'{programme,propertyId}' is distinct from p->>'sourcePropertyId'
  or p#>>'{programme,id}' is distinct from p->>'sourceProgrammeId'
  or jsonb_typeof(p->'config')='object' and (p#>>'{config,propertyId}' is distinct from p->>'sourcePropertyId' or p#>>'{config,programmeId}' is distinct from p->>'sourceProgrammeId') then raise exception 'Retain one explicitly assigned STR property, programme, configuration and selected years';end if;
 if exists(select 1 from jsonb_array_elements(p->'years') v where jsonb_typeof(v)<>'number' or v::text!~'^20[0-9]{2}$')
  or (select count(distinct v) from jsonb_array_elements(p->'years') v)<>jsonb_array_length(p->'years') then raise exception 'STR reporting years must be distinct supported years';end if;
 if p ? 'sourceContext' and (jsonb_typeof(p->'sourceContext')<>'object' or p#>>'{sourceContext,property,id}' is distinct from p->>'sourcePropertyId'
  or jsonb_typeof(p#>'{sourceContext,lines}') is distinct from 'array'
  or exists(select 1 from jsonb_array_elements(p#>'{sourceContext,lines}') l where l->>'propertyId' is distinct from p->>'sourcePropertyId')) then raise exception 'STR resume evidence must contain only its selected source property';end if;
 if exists(select 1 from jsonb_array_elements(p->'lines') l where l->>'propertyId' is distinct from p->>'sourcePropertyId' or l->>'strProgramId' is distinct from p->>'sourceProgrammeId') then raise exception 'STR retained lines must belong to the selected property and programme';end if;
 -- Incomplete legacy programmes can always be recovered as planning evidence.
 -- No calculated report or canonical financial application is fabricated.
 if report='null'::jsonb then
  if length(trim(coalesce(p->>'reportUnavailableReason','')))<3 then raise exception 'Record why the unfinished STR report is unavailable';end if;
  return;
 end if;
 if jsonb_typeof(report) is distinct from 'object' or report->>'schemaVersion' is distinct from 'atlas.str-programme-report.v1'
  or report->>'status' is distinct from 'Working Draft - Not Published' or report->'years' is distinct from p->'years'
  or jsonb_typeof(report->'rows') is distinct from 'array' or jsonb_typeof(report->'monthly') is distinct from 'array'
  or jsonb_typeof(report->'totals') is distinct from 'object'
  or jsonb_array_length(report->'rows')<>jsonb_array_length(p->'lines')*jsonb_array_length(p->'years')*12
  or jsonb_array_length(report->'monthly')<>jsonb_array_length(p->'years')*12 then raise exception 'Retain a complete unpublished STR report snapshot';end if;
 if (select count(distinct l->>'id') from jsonb_array_elements(p->'lines') l)<>jsonb_array_length(p->'lines') then raise exception 'STR source line identifiers must be unique';end if;
 for line in select value from jsonb_array_elements(p->'lines') loop
  if length(coalesce(line->>'id',''))=0 or length(coalesce(line->>'gl',''))=0 or line->>'propertyId' is distinct from p->>'sourcePropertyId'
   or line->>'strProgramId' is distinct from p->>'sourceProgrammeId' or not coalesce(line->>'nature'=any(array['income','contra_income','expense','capital','debt','below_noi']),false) then raise exception 'STR lines must retain their property, programme, account and financial nature';end if;
  for y in select value from jsonb_array_elements(p->'years') loop
   if jsonb_typeof(line->'yearData'->(y#>>'{}')) is distinct from 'array' or jsonb_array_length(line->'yearData'->(y#>>'{}'))<>12 then raise exception 'STR source line must retain all twelve monthly cells for each selected year';end if;
   for month in 1..12 loop
    amount:=line->'yearData'->(y#>>'{}')->(month-1);period:=(y#>>'{}')||'-'||lpad(month::text,2,'0');
    if jsonb_typeof(amount) not in ('number','null') then raise exception 'STR monthly values must be numeric or explicitly blank';end if;
    select count(*),jsonb_agg(v) into n,selected from jsonb_array_elements(report->'rows') v where v->>'sourceLineId'=line->>'id' and v->>'period'=period;
    row:=selected->0;
    if n<>1 or row->'amount' is distinct from amount or row->>'gl' is distinct from line->>'gl'
     or row->>'nature' is distinct from line->>'nature' or row->>'account' is distinct from line->>'name' or row->'year' is distinct from y then raise exception 'STR report GL/month differs from its retained source line';end if;
   end loop;
  end loop;
 end loop;
 for y in select value from jsonb_array_elements(p->'years') loop
  for month in 1..12 loop
   period:=(y#>>'{}')||'-'||lpad(month::text,2,'0');
   select count(*),jsonb_agg(v) into n,selected from jsonb_array_elements(report->'monthly') v where v->>'period'=period;
   if n<>1 then raise exception 'STR report monthly coverage must match its selected years';end if;
   select atlas_private.str_programme_metrics(coalesce(jsonb_agg(v),'[]')) into expected from jsonb_array_elements(report->'rows') v where v->>'period'=period;
   perform atlas_private.validate_str_programme_metrics(selected->0,expected);
  end loop;
 end loop;
 perform atlas_private.validate_str_programme_metrics(report->'totals',atlas_private.str_programme_metrics(report->'rows'));
end;$$;

create function atlas_private.str_programme_receipt(cid uuid,rid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.atlas_str_programme_revisions;h public.atlas_str_programme_heads;begin
 if not atlas_private.reforecast_access(cid,'read') then raise exception 'STR programme access denied';end if;
 select * into r from public.atlas_str_programme_revisions where community_id=cid and request_id=rid;
 if r.revision_id is null then return null;end if;
 if r.content_hash<>encode(sha256(convert_to(r.payload::text,'UTF8')),'hex') then raise exception 'STR programme snapshot integrity check failed';end if;
 select * into h from public.atlas_str_programme_heads where programme_id=r.programme_id;
 return jsonb_build_object('head',jsonb_build_object('programme_id',r.programme_id,'community_id',cid,'revision_id',r.revision_id,'revision',r.revision,'status',r.status),'revision',to_jsonb(r),'currentHead',to_jsonb(h),'verified',true);
end;$$;
create function atlas_private.save_str_programme(cid uuid,pid uuid,expected integer,rid uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.atlas_str_programme_heads;r public.atlas_str_programme_revisions;prior public.atlas_str_programme_revisions;hash text;actor_role text;
 target jsonb;budget public.atlas_reforecast_revisions;publication public.atlas_reforecast_publications;verified jsonb;
begin
 if not atlas_private.reforecast_access(cid,'edit') then raise exception 'STR programme editing access denied';end if;
 if pid is null or rid is null or expected is null or expected<0 then raise exception 'STR programme save requires stable identity and expected revision';end if;
 hash:=encode(sha256(convert_to(jsonb_build_object('communityId',cid,'programmeId',pid,'expectedRevision',expected,'payload',p)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('str-request:'||rid::text,0));
 select * into prior from public.atlas_str_programme_revisions where request_id=rid;
 if prior.revision_id is not null then
  if prior.community_id<>cid or prior.programme_id<>pid or prior.actor_id<>auth.uid() or prior.request_hash<>hash then raise exception 'STR save request ID reused for different content or actor';end if;
  return atlas_private.str_programme_receipt(cid,rid);
 end if;
 perform atlas_private.validate_str_programme_payload(p);
 perform pg_advisory_xact_lock(hashtextextended('str-programme:'||pid::text,0));
 select * into h from public.atlas_str_programme_heads where programme_id=pid for update;
 if h.programme_id is not null and h.community_id<>cid then raise exception 'STR programme belongs to another community';end if;
 if coalesce(h.revision,0)<>expected then raise exception 'STR programme changed in another session; reload before saving';end if;
 if p->'targetBudget' is not null and p->'targetBudget'<>'null'::jsonb then
  target:=p->'targetBudget';
  if jsonb_typeof(target)<>'object' or not coalesce(target->>'scenarioId'~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false) or not coalesce(target->>'revisionId'~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false) then raise exception 'Select an exact canonical target budget revision';end if;
  select * into budget from public.atlas_reforecast_revisions where revision_id=(target->>'revisionId')::uuid and scenario_id=(target->>'scenarioId')::uuid and community_id=cid;
  if budget.revision_id is null or budget.status='deleted' then raise exception 'Target budget does not belong to this community';end if;
  if nullif(target->>'publicationId','') is not null then
   select * into publication from public.atlas_reforecast_publications where publication_id=(target->>'publicationId')::uuid and revision_id=budget.revision_id and community_id=cid;
   if publication.publication_id is null then raise exception 'Target publication does not match the exact budget revision';end if;
   verified:=public.atlas_read_reforecast_publication(publication.publication_id);
   if (verified->>'verified')::boolean is distinct from true then raise exception 'Target publication readback failed';end if;
  elsif not exists(select 1 from public.atlas_reforecast_heads where scenario_id=budget.scenario_id and revision_id=budget.revision_id and community_id=cid) then raise exception 'Target budget changed; select its latest exact revision';end if;
  target:=jsonb_build_object('scenarioId',budget.scenario_id,'revisionId',budget.revision_id,'revision',budget.revision,'publicationId',publication.publication_id,'communityId',cid,'registryVersionId',budget.payload->'registryVersionId','snapshotFingerprint',encode(sha256(convert_to(budget.snapshot::text,'UTF8')),'hex'),'status',budget.status,'relationship','planning_reference_not_applied','verified',true);
 else target:=null;end if;
 select role into actor_role from public.atlas_user_profiles where user_id=auth.uid() and status='active';
 insert into public.atlas_str_programme_revisions(programme_id,community_id,revision,previous_revision_id,request_id,request_hash,content_hash,payload,target_budget,actor_id,actor_role)
 values(pid,cid,expected+1,h.revision_id,rid,hash,encode(sha256(convert_to(p::text,'UTF8')),'hex'),p,target,auth.uid(),actor_role) returning * into r;
 insert into public.atlas_str_programme_heads(programme_id,community_id,revision_id,revision) values(pid,cid,r.revision_id,r.revision)
 on conflict(programme_id) do update set revision_id=excluded.revision_id,revision=excluded.revision;
 return atlas_private.str_programme_receipt(cid,rid);
end;$$;

create function public.atlas_save_str_programme_draft(p_community_id uuid,p_programme_id uuid,p_expected_revision integer,p_request_id uuid,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select atlas_private.save_str_programme(p_community_id,p_programme_id,p_expected_revision,p_request_id,p_payload)$$;
create function public.atlas_read_str_programme_draft_receipt(p_community_id uuid,p_request_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select atlas_private.str_programme_receipt(p_community_id,p_request_id)$$;
create function public.atlas_read_str_programme_drafts(p_community_ids uuid[],p_programme_id uuid default null,p_revision_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(item order by changed desc),'[]') from (
 select jsonb_build_object('head',jsonb_build_object('programme_id',r.programme_id,'community_id',r.community_id,'revision_id',r.revision_id,'revision',r.revision,'status',r.status),'revision',to_jsonb(r),'currentHead',to_jsonb(h),'verified',r.content_hash=encode(sha256(convert_to(r.payload::text,'UTF8')),'hex')) item,r.created_at changed
 from public.atlas_str_programme_heads h join public.atlas_str_programme_revisions r on r.programme_id=h.programme_id and r.community_id=h.community_id and r.revision_id=coalesce(p_revision_id,h.revision_id)
 where h.community_id=any(p_community_ids) and (p_programme_id is null or h.programme_id=p_programme_id) order by r.created_at desc limit 100) scoped;
$$;
create function public.atlas_read_str_programme_history(p_programme_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r) order by revision desc),'[]') from public.atlas_str_programme_revisions r where programme_id=p_programme_id;
$$;
revoke all on function atlas_private.str_programme_metrics(jsonb),atlas_private.validate_str_programme_metrics(jsonb,jsonb),atlas_private.validate_str_programme_payload(jsonb),atlas_private.str_programme_receipt(uuid,uuid),atlas_private.save_str_programme(uuid,uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function atlas_private.str_programme_receipt(uuid,uuid),atlas_private.save_str_programme(uuid,uuid,integer,uuid,jsonb) to authenticated;
revoke all on function public.atlas_save_str_programme_draft(uuid,uuid,integer,uuid,jsonb),public.atlas_read_str_programme_draft_receipt(uuid,uuid),public.atlas_read_str_programme_drafts(uuid[],uuid,uuid),public.atlas_read_str_programme_history(uuid) from public,anon,authenticated;
grant execute on function public.atlas_save_str_programme_draft(uuid,uuid,integer,uuid,jsonb),public.atlas_read_str_programme_draft_receipt(uuid,uuid),public.atlas_read_str_programme_drafts(uuid[],uuid,uuid),public.atlas_read_str_programme_history(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
