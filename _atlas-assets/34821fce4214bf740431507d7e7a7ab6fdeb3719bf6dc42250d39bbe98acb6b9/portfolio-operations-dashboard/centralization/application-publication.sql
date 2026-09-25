-- Scoped Resident Data publication. Apply before deploying the client integration.
-- Does not enable or grant access to the whole-dashboard document.
begin;
create schema if not exists atlas_private;
revoke all on schema atlas_private from public;
grant usage on schema atlas_private to authenticated;

create or replace function atlas_private.application_access(p_id uuid, p_write boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists (
   select 1 from public.atlas_user_profiles p join public.atlas_communities c on c.community_id=p_id
   where p.user_id=auth.uid() and p.status='active' and c.deleted_at is null
     and (p.role='admin' or (public.atlas_can_access_community(c.community_id)
       and (c.status='active' or c.community_id=any(p.allowed_community_ids))))
     and (not p_write or p.role in ('admin','centra'))
     and (not p_write or (not ('7'=any(coalesce(p.locked_tab_ids,'{}')))
       and not ('data_import'=any(coalesce(p.locked_page_keys,'{}')))))
     and (p_write or (not ('16'=any(coalesce(p.locked_tab_ids,'{}')))
       and not ('application_performance'=any(coalesce(p.locked_page_keys,'{}')))))
 );
$$;
revoke all on function atlas_private.application_access(uuid,boolean) from public,anon;
grant execute on function atlas_private.application_access(uuid,boolean) to authenticated;

create table public.atlas_application_imports (
 import_id uuid primary key default gen_random_uuid(),
 community_id uuid not null references public.atlas_communities(community_id),
 content_hash text not null,
 source_metadata jsonb not null,
 records jsonb not null check(jsonb_typeof(records)='array' and jsonb_array_length(records)>0),
 version integer not null default 1 check(version>0),
 deleted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),
 updated_by uuid not null references auth.users(id),
 unique(community_id,content_hash)
);
create table public.atlas_application_import_versions (
 import_id uuid not null references public.atlas_application_imports(import_id),
 version integer not null,
 community_id uuid not null references public.atlas_communities(community_id),
 action text not null check(action in ('publish','delete','restore')),
 actor_id uuid not null references auth.users(id),
 occurred_at timestamptz not null default now(),
 reason text not null default '',
 primary key(import_id,version)
);
create index on public.atlas_application_import_versions(community_id);
alter table public.atlas_application_imports enable row level security;
alter table public.atlas_application_import_versions enable row level security;
revoke all on public.atlas_application_imports,public.atlas_application_import_versions from public,anon,authenticated;
grant select on public.atlas_application_imports,public.atlas_application_import_versions to authenticated;
create policy application_import_read on public.atlas_application_imports for select to authenticated
 using (atlas_private.application_access(community_id,false));
create policy application_version_read on public.atlas_application_import_versions for select to authenticated
 using (atlas_private.application_access(community_id,false));

-- Input is a parsed, accepted workbook. Every source property must resolve by exact
-- directory name or existing active alias. No fuzzy mapping or alias mutation.
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
 meta := jsonb_build_object('schemaVersion',1,'sourceType','application-resident-workbook','sourceReport','Application / Resident Data',
   'sourceAsOf',p_upload->>'sourceAsOf','reportPeriodKey',p_upload->>'reportPeriodKey');
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
       'reportPeriodKey','reportMonth','residentName','applicationStatus','leasingAgent','leadSource',
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

create or replace function atlas_private.revise_application(p_id uuid,p_expected_version integer,p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.atlas_application_imports;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into item from public.atlas_application_imports where import_id=p_id for update;
 if not found or not atlas_private.application_access(item.community_id,true) then
   raise exception 'Community revision denied' using errcode='42501';
 end if;
 if p_expected_version is null or item.version<>p_expected_version then
   raise exception 'Import changed in another session; reload before retrying' using errcode='40001';
 end if;
 if p_action not in ('delete','restore') or p_action is null or nullif(trim(p_reason),'') is null then raise exception 'Explicit action and reason required'; end if;
 if (p_action='delete' and item.deleted_at is not null) or (p_action='restore' and item.deleted_at is null) then return to_jsonb(item); end if;
 update public.atlas_application_imports set version=version+1,deleted_at=case when p_action='delete' then now() else null end,
 updated_at=now(),updated_by=auth.uid() where import_id=p_id returning * into item;
 insert into public.atlas_application_import_versions(import_id,version,community_id,action,actor_id,reason)
 values(item.import_id,item.version,item.community_id,p_action,auth.uid(),p_reason);
 return to_jsonb(item);
end;
$$;
revoke all on function atlas_private.revise_application(uuid,integer,text,text) from public,anon;
grant execute on function atlas_private.revise_application(uuid,integer,text,text) to authenticated;
create or replace function public.atlas_revise_application_import(p_id uuid,p_expected_version integer,p_action text,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
 select atlas_private.revise_application(p_id,p_expected_version,p_action,p_reason);
$$;
revoke all on function public.atlas_revise_application_import(uuid,integer,text,text) from public,anon;
grant execute on function public.atlas_revise_application_import(uuid,integer,text,text) to authenticated;
commit;
