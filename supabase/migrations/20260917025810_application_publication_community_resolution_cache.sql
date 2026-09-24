create or replace function atlas_private.publish_applications(p_upload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; ids uuid[]; cid uuid; groups jsonb := '{}'; cleaned jsonb;
 meta jsonb; digest text; existing public.atlas_application_imports; result jsonb := '[]'; g record; community_name text;
 resolved_properties jsonb := '{}'; property_key text; resolved_property jsonb;
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
 for r in select value from jsonb_array_elements(p_upload->'records') loop
   if nullif(trim(r->>'applicationId'),'') is null or nullif(trim(r->>'propertySource'),'') is null
      or r->>'mappingStatus' is distinct from 'mapped' or coalesce((r->>'duplicateReview')::boolean,false) then
     raise exception 'Unresolved application record';
   end if;
   property_key := lower(trim(r->>'propertySource'));
   resolved_property := resolved_properties->property_key;
   if resolved_property is null then
   select array_agg(distinct c.community_id) into ids from public.atlas_communities c
   left join public.atlas_community_aliases a on a.community_id=c.community_id and a.active
   where c.deleted_at is null and (lower(trim(r->>'propertySource')) in (lower(c.display_name),lower(c.canonical_name))
     or lower(trim(r->>'propertySource'))=lower(a.alias));
   if coalesce(cardinality(ids),0)<>1 then raise exception 'Source community requires an approved unambiguous central mapping'; end if;
   cid:=ids[1];
   if not atlas_private.application_access(cid,true) then raise exception 'Community publication denied' using errcode='42501'; end if;
   -- Client display identifiers remain provenance only; canonical scope is server-owned.
   select display_name into community_name from public.atlas_communities where community_id=cid;
   resolved_property := jsonb_build_object('id',cid,'name',community_name);
   resolved_properties := jsonb_set(resolved_properties,array[property_key],resolved_property);
   else
     cid := (resolved_property->>'id')::uuid;
     community_name := resolved_property->>'name';
   end if;
   select coalesce(jsonb_object_agg(key,value),'{}') into cleaned from jsonb_each(r)
   where key=any(array['applicationId','propertySource','mappingStatus','sourceSheetName','sourceRowNumber',
     'reportPeriodKey','reportMonth','residentName','applicationStatus','leasingAgent','leadSource',
     'newLeadCreatedOn','applicationPartiallyCompletedOn','applicationCompletedOn','firstVisitTourDate',
     'occupantType','leaseId','leaseStatus','scheduledRent','buildingUnit','primaryPhone','additionalPhoneNumbers',
     'email','currentLeaseStart','currentLeaseEnd','moveInDate','sourceTimestamps','statusClassification','duplicateReview','notes']);
   cleaned := cleaned || jsonb_build_object('canonicalCommunityId',cid,'communityId',cid,
     'communityName',community_name,'atlasName',community_name,'reportPeriodKey',p_upload->>'reportPeriodKey');
   groups:=jsonb_set(groups,array[cid::text],coalesce(groups->cid::text,'[]') || jsonb_build_array(cleaned));
 end loop;
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

