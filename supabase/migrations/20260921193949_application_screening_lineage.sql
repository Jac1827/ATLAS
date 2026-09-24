begin;
-- Preserve source rows and import identities; canonical fields are derived evidence.
create or replace function atlas_private.application_timestamp(v text) returns timestamptz language plpgsql immutable set search_path='' as $$ begin return nullif(v,'')::timestamptz; exception when others then return null; end $$;
create or replace function atlas_private.canonical_application(r jsonb,meta jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare effective timestamptz; started timestamptz; completed timestamptz; signed timestamptz; approved timestamptz; denied timestamptz; cancelled timestamptz; decided timestamptz; status text; observed text; reason text; events integer;
begin
 effective:=atlas_private.application_timestamp(meta->>'sourceAsOf');
 started:=atlas_private.application_timestamp(coalesce(nullif(r#>>'{sourceTimestamps,applicationStartedOn}',''),nullif(r->>'applicationStartedOn',''),r->>'applicationStartedAt'));
 completed:=atlas_private.application_timestamp(coalesce(nullif(r#>>'{sourceTimestamps,applicationCompletedOn}',''),nullif(r->>'applicationCompletedOn',''),r->>'applicationCompletedAt'));
 approved:=atlas_private.application_timestamp(coalesce(nullif(r#>>'{sourceTimestamps,applicationApprovedOn}',''),r->>'applicationApprovedOn'));
 denied:=atlas_private.application_timestamp(coalesce(nullif(r#>>'{sourceTimestamps,applicationDeniedOn}',''),r->>'applicationDeniedOn'));
 cancelled:=atlas_private.application_timestamp(coalesce(nullif(r#>>'{sourceTimestamps,applicationCancelledOn}',''),nullif(r->>'applicationCancelledOn',''),nullif(r#>>'{sourceTimestamps,applicationCompletedCancelledOn}',''),nullif(r#>>'{sourceTimestamps,applicationApprovedCancelledOn}',''),nullif(r->>'applicationCompletedCancelledOn',''),r->>'applicationApprovedCancelledOn'));
 signed:=atlas_private.application_timestamp(coalesce(nullif(r#>>'{sourceTimestamps,leaseSignedOn}',''),nullif(r->>'leaseSignedOn',''),nullif(r#>>'{sourceTimestamps,leaseExecutedOn}',''),r->>'leaseExecutedOn'));
 if approved>effective or effective is null then approved:=null; end if;
 if denied>effective or effective is null then denied:=null; end if;
 if cancelled>effective or effective is null then cancelled:=null; end if;
 observed:=lower(trim(regexp_replace(coalesce(r->>'applicationStatus',''),'^Application:\s*','','i')));
 status:='unavailable'; reason:='non_application_status';
 if coalesce(r->>'applicationStatus','') ~* '^Application:' then
  reason:=null;
  if observed in ('approved','denied','cancelled','canceled','completed (cancelled)','approved (cancelled)') then
   status:=case when observed like '%cancel%' then 'cancelled' else observed end;
   decided:=case status when 'approved' then approved when 'denied' then denied when 'cancelled' then cancelled end;
  elsif greatest(approved,denied,cancelled) is not null then
   decided:=greatest(approved,denied,cancelled);
   events:=case when approved=decided then 1 else 0 end+case when denied=decided then 1 else 0 end+case when cancelled=decided then 1 else 0 end;
   if events>1 then reason:='conflicting_terminal_events'; decided:=null; else status:=case decided when approved then 'approved' when denied then 'denied' else 'cancelled' end; end if;
  elsif completed<=effective then status:='pending';
  elsif observed in ('started','partially completed','incomplete') then status:='incomplete';reason:='started_or_incomplete';
  else reason:='completion_or_effective_timestamp_missing';end if;
 end if;
 if nullif(r->>'applicationId','') is null or nullif(r->>'leaseId','') is null or nullif(r->>'communityId','') is null or signed>effective or effective is null then signed:=null;end if;
 return r||jsonb_build_object('applicationStartedAt',started,'applicationCompletedAt',completed,'decisionStatus',status,'decisionAt',decided,'sourceEffectiveAt',effective,'periodKey',meta->>'reportPeriodKey','exclusionReason',reason,'leaseSignedAt',signed,'leaseJoinVerified',signed is not null,'decisionEvidence',case when decided is not null then 'dated_event' when status in ('approved','denied','cancelled') then 'snapshot_status' when status='pending' then 'completed_without_terminal' else 'unavailable' end);
end $$;
revoke all on function atlas_private.application_timestamp(text),atlas_private.canonical_application(jsonb,jsonb) from public,anon;
grant execute on function atlas_private.application_timestamp(text),atlas_private.canonical_application(jsonb,jsonb) to authenticated;
create or replace function atlas_private.canonicalize_application_import() returns trigger language plpgsql set search_path='' as $$ begin
 select jsonb_agg(atlas_private.canonical_application(r,new.source_metadata)) into new.records from jsonb_array_elements(new.records) r;
 return new;
end $$;
create trigger application_canonical_lineage before insert or update of records on public.atlas_application_imports for each row execute function atlas_private.canonicalize_application_import();
update public.atlas_application_imports set records=records;
-- Archived source snapshots remain immutable evidence for every retained month.
create view public.atlas_application_monthly_lineage with(security_invoker=true) as
with snapshots as (
 select i.import_id,i.community_id,r,rank() over(partition by i.community_id,r->>'applicationId',r->>'periodKey' order by r->>'sourceEffectiveAt' desc) priority
 from public.atlas_application_imports i cross join lateral jsonb_array_elements(i.records) r where i.deleted_at is null
), unique_rows as (
 select community_id,r->>'applicationId' application_id,r->>'periodKey' period_key,min(r::text)::jsonb r
 from snapshots where priority=1 group by 1,2,3
 having count(distinct jsonb_build_array(r->>'decisionStatus',r->>'decisionAt',r->>'applicationStartedAt',r->>'applicationCompletedAt'))=1
), pairs as (
 select *,case when r->>'decisionStatus' in ('approved','denied','cancelled') and atlas_private.application_timestamp(r->>'decisionAt')>=atlas_private.application_timestamp(r->>'applicationStartedAt') then extract(epoch from(atlas_private.application_timestamp(r->>'decisionAt')-atlas_private.application_timestamp(r->>'applicationStartedAt')))/86400 end duration from unique_rows
)
select community_id,period_key,count(*) population,
 count(*) filter(where r->>'decisionStatus' in ('approved','denied','cancelled','pending')) eligible_count,
 count(*) filter(where r->>'decisionStatus'='approved') approved,
 count(*) filter(where r->>'decisionStatus'='denied') denied,
 count(*) filter(where r->>'decisionStatus'='cancelled') cancelled,
 count(*) filter(where r->>'decisionStatus'='pending') pending,
 count(*) filter(where r->>'decisionStatus'='incomplete') incomplete,
 count(*) filter(where r->>'decisionStatus'='unavailable') unavailable,
 count(duration) processing_eligible_count,
 count(*) filter(where r->>'decisionStatus' in ('approved','denied','cancelled') and duration is null) processing_excluded_count,
 avg(duration) average_days,percentile_cont(.5) within group(order by duration) median_days,
 percentile_cont(.75) within group(order by duration) p75_days,percentile_cont(.9) within group(order by duration) p90_days
from pairs group by community_id,period_key;
revoke all on public.atlas_application_monthly_lineage from public,anon;
grant select on public.atlas_application_monthly_lineage to authenticated;

create table public.atlas_screening_imports(
 import_id uuid primary key default gen_random_uuid(),community_id uuid not null references public.atlas_communities(community_id),
 content_hash text not null,records jsonb not null,source_metadata jsonb not null,
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 unique(community_id,content_hash));
alter table public.atlas_screening_imports enable row level security;
revoke all on public.atlas_screening_imports from public,anon,authenticated;
grant select on public.atlas_screening_imports to authenticated;
create policy screening_read on public.atlas_screening_imports for select to authenticated using(atlas_private.application_access(community_id,false));
create or replace function atlas_private.publish_screening(p_upload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; ids uuid[]; cid uuid; cname text; cleaned jsonb; digest text; item public.atlas_screening_imports; result jsonb:='[]'; v jsonb; n integer; k text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_upload->>'sourceVersion' is distinct from '2.0' or jsonb_typeof(p_upload->'records') is distinct from 'array' or jsonb_array_length(p_upload->'records') not between 1 and 1000 then raise exception 'Validated Screening Results Summary 2.0 records required';end if;
 for r in select value from jsonb_array_elements(p_upload->'records') order by value->>'propertySource' loop
  if r->>'sourceContract' is distinct from 'entrata-screening-summary-2.0' or atlas_private.application_timestamp(r->>'sourceEffectiveAt') is null or r->>'periodKey' !~ '^\d{4}-\d{2}$' or r#>>'{filters,Summarize By}' is distinct from 'Property' then raise exception 'Screening period, filters and source-effective time required';end if;
  select array_agg(distinct c.community_id) into ids from public.atlas_communities c left join public.atlas_community_aliases a on a.community_id=c.community_id and a.active where c.deleted_at is null and (lower(trim(r->>'propertySource')) in(lower(c.display_name),lower(c.canonical_name)) or lower(trim(r->>'propertySource'))=lower(a.alias));
  if coalesce(cardinality(ids),0)<>1 then raise exception 'Approved community mapping required';end if;cid:=ids[1];
  if not atlas_private.application_access(cid,true) then raise exception 'Community publication denied' using errcode='42501';end if;
  select display_name into cname from public.atlas_communities where community_id=cid;
  foreach k in array array['results','overrides','failReasons','conditionalReasons'] loop
   v:=r->k->'values';
   if v is not null and v<>'null'::jsonb then
    if jsonb_typeof(v)<>'object' or exists(select 1 from jsonb_each_text(v) e where e.value !~ '^\d+$') then raise exception 'Nonnegative integer aggregate counts required';end if;
   elsif r->k->>'availability' is distinct from 'empty' then raise exception 'Empty section must be explicit';end if;
  end loop;
  v:=r#>'{results,values}';if v<>'null'::jsonb then
   if not v ?& array['screened','inProgress','pass','conditional','fail'] or (v->>'screened')::int<>(v->>'inProgress')::int+(v->>'pass')::int+(v->>'conditional')::int+(v->>'fail')::int then raise exception 'Screening population does not reconcile';end if;
  end if;
  v:=r#>'{overrides,values}';if v<>'null'::jsonb then
   if not v ?& array['totalFailed','pending','denied','conditional','approved'] or (v->>'totalFailed')::int<>(v->>'pending')::int+(v->>'denied')::int+(v->>'conditional')::int+(v->>'approved')::int or (v->>'totalFailed')::int<>(r#>>'{results,values,fail}')::int then raise exception 'Override population does not reconcile';end if;
  end if;
  select jsonb_object_agg(key,value) into cleaned from jsonb_each(r) where key=any(array['propertySource','sourceSheetName','sourceVersion','sourceContract','sourceEffectiveAt','periodStart','periodEnd','periodKey','filters','results','failReasons','conditionalReasons','overrides']);
  cleaned:=cleaned||jsonb_build_object('communityId',cid,'community',cname);
  digest:=encode(sha256(convert_to(cleaned::text,'UTF8')),'hex');
  insert into public.atlas_screening_imports(community_id,content_hash,records,source_metadata,created_by) values(cid,digest,jsonb_build_array(cleaned),jsonb_build_object('fileName',p_upload->>'fileName','importIdentity',p_upload->>'importIdentity','sourceVersion','2.0'),auth.uid()) on conflict(community_id,content_hash) do nothing;
  select * into item from public.atlas_screening_imports where community_id=cid and content_hash=digest;
  result:=result||jsonb_build_array(to_jsonb(item));
 end loop;
 return jsonb_build_object('imports',result);
end $$;
revoke all on function atlas_private.publish_screening(jsonb) from public,anon;
grant execute on function atlas_private.publish_screening(jsonb) to authenticated;
create function public.atlas_publish_screening_import(p_upload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select atlas_private.publish_screening(p_upload); $$;
revoke all on function public.atlas_publish_screening_import(jsonb) from public,anon;
grant execute on function public.atlas_publish_screening_import(jsonb) to authenticated;
create or replace function atlas_private.publish_applications(p_upload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[]; cid uuid; groups jsonb := '{}'; cleaned jsonb;
 meta jsonb; digest text; existing public.atlas_application_imports; result jsonb := '[]'; g record; community_name text;
 resolved_properties jsonb := '{}'; property_key text;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_upload->>'validationStatus' is distinct from 'valid' or
    jsonb_typeof(p_upload->'records') is distinct from 'array' or
    coalesce(jsonb_array_length(p_upload->'records'),0)=0 or
    coalesce(jsonb_array_length(p_upload->'records'),0)>20000 or
    coalesce(p_upload->>'reportPeriodKey','') !~ '^\d{4}-(0[1-9]|1[0-2])$' or
    nullif(p_upload->>'sourceAsOf','') is null then
   raise exception 'Accepted records, reporting period and source-effective date are required';
 end if;
 perform (p_upload->>'sourceAsOf')::timestamptz;
 meta := jsonb_build_object('schemaVersion',2,'sourceType','application-resident-workbook','sourceReport','Application / Resident Data',
   'sourceFilters',coalesce(p_upload->'sourceFilters','{}'::jsonb),'sourceVersion',p_upload->>'sourceVersion','sourceAsOf',p_upload->>'sourceAsOf','reportPeriodKey',p_upload->>'reportPeriodKey');
 if exists(select 1 from jsonb_array_elements(p_upload->'records') r
   where nullif(trim(r->>'applicationId'),'') is null or nullif(trim(r->>'propertySource'),'') is null
      or r->>'mappingStatus' is distinct from 'mapped' or coalesce((r->>'duplicateReview')::boolean,false)) then
   raise exception 'Unresolved application record';
 end if;
 for property_key in select distinct lower(trim(value->>'propertySource')) from jsonb_array_elements(p_upload->'records') loop
   select array_agg(distinct c.community_id) into ids from public.atlas_communities c
   left join public.atlas_community_aliases a on a.community_id=c.community_id and a.active
   where c.deleted_at is null and (property_key in (lower(c.display_name),lower(c.canonical_name))
     or property_key=lower(a.alias));
   if coalesce(cardinality(ids),0)<>1 then raise exception 'Source community requires an approved unambiguous central mapping'; end if;
   cid:=ids[1];
   if not atlas_private.application_access(cid,true) then raise exception 'Community publication denied' using errcode='42501'; end if;
   select display_name into community_name from public.atlas_communities where community_id=cid;
   resolved_properties := jsonb_set(resolved_properties,array[property_key],jsonb_build_object('id',cid,'name',community_name));
 end loop;
 -- Aggregate once rather than copying the growing portfolio JSON for every row.
 select jsonb_object_agg(community_id,records) into groups from (
   select mapping->>'id' as community_id,
     jsonb_agg(sanitized.fields || jsonb_build_object('canonicalCommunityId',mapping->>'id','communityId',mapping->>'id',
       'communityName',mapping->>'name','atlasName',mapping->>'name','reportPeriodKey',p_upload->>'reportPeriodKey')) as records
   from jsonb_array_elements(p_upload->'records') as source(r)
   cross join lateral (select resolved_properties->lower(trim(r->>'propertySource')) as mapping) resolved
   cross join lateral (
     select coalesce(jsonb_object_agg(key,value),'{}') as fields from jsonb_each(r)
     where key=any(array['applicationId','propertySource','mappingStatus','sourceSheetName','sourceRowNumber',
       'sourceColumns','applicationStartedOn','applicationApprovedOn','applicationDeniedOn','applicationCancelledOn','applicationCompletedCancelledOn','applicationApprovedCancelledOn','leaseSignedOn','leaseExecutedOn','denialReason','cancellationReason','reportPeriodKey','reportMonth','residentName','applicationStatus','leasingAgent','leadSource',
       'newLeadCreatedOn','applicationPartiallyCompletedOn','applicationCompletedOn','firstVisitTourDate',
       'occupantType','leaseId','leaseStatus','scheduledRent','buildingUnit','primaryPhone','additionalPhoneNumbers',
       'email','currentLeaseStart','currentLeaseEnd','moveInDate','sourceTimestamps','statusClassification','duplicateReview','notes'])
   ) sanitized
   group by mapping->>'id'
 ) grouped;
 -- Stable order prevents deadlocks; transaction locks also serialize first insertion.
 for g in select key,value from jsonb_each(groups) order by key loop
   cid:=g.key::uuid;
   if exists(select 1 from jsonb_array_elements(g.value) x group by x->>'applicationId' having count(*)>1) then
     raise exception 'Duplicate community/application identity requires review';
   end if;
   select jsonb_agg(value order by value->>'applicationId') into cleaned from jsonb_array_elements(g.value);
   digest:=encode(sha256(convert_to((meta||jsonb_build_object('records',cleaned))::text,'UTF8')),'hex');
   perform pg_advisory_xact_lock(hashtextextended('atlas-applications:'||cid::text,0));
   select * into existing from public.atlas_application_imports where community_id=cid and content_hash=digest;
   if not found then
     insert into public.atlas_application_imports(community_id,content_hash,source_metadata,records,created_by,updated_by)
     values(cid,digest,meta||jsonb_build_object('fileName',p_upload->>'fileName'),cleaned,auth.uid(),auth.uid()) returning * into existing;
     insert into public.atlas_application_import_versions(import_id,version,community_id,action,actor_id)
     values(existing.import_id,1,cid,'publish',auth.uid());
   end if;
   -- Duplicate publication never restores a tombstone.
   result:=result||jsonb_build_array(to_jsonb(existing));
 end loop;
 return jsonb_build_object('imports',result);
end;
$$;
revoke all on function atlas_private.publish_applications(jsonb) from public,anon;
grant execute on function atlas_private.publish_applications(jsonb) to authenticated;
create or replace function public.atlas_publish_application_import(p_upload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select atlas_private.publish_applications(p_upload);
$$;
revoke all on function public.atlas_publish_application_import(jsonb) from public,anon;
grant execute on function public.atlas_publish_application_import(jsonb) to authenticated;


commit;
