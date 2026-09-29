-- Extend saved-JSON approval to scoped v2 backups without changing the source
-- bytes, original row indices, financial values, receipt shape or permissions.
begin;
create function atlas_private.saved_str_identity_present(value jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(value)='string' and length(btrim(value#>>'{}',E' \t\n\r\f\v'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))>0,false)
$$;
revoke all on function atlas_private.saved_str_identity_present(jsonb) from public,anon,authenticated;
create function atlas_private.validate_saved_str_source_identity(document jsonb,property_id text,programme_id text)
returns void language plpgsql immutable set search_path='' as $$
declare state jsonb:=document->'state';programme jsonb;declared jsonb;selected_ids jsonb;
begin
 if jsonb_typeof(document) is distinct from 'object' or document->'formatVersion' is null
  or document->'formatVersion' not in ('1'::jsonb,'2'::jsonb) or jsonb_typeof(state) is distinct from 'object'
  or jsonb_typeof(state->'properties') is distinct from 'array' or jsonb_typeof(state->'strPrograms') is distinct from 'array'
  or jsonb_typeof(state->'lines') is distinct from 'array' then raise exception 'Supported numeric saved STR format 1 or 2 and retained collections required';end if;
 -- Validate the entire source inventory. A duplicate or dangling sibling cannot
 -- become authority merely because a different programme was selected in the UI.
 if exists(select 1 from jsonb_array_elements(state->'properties')v where jsonb_typeof(v) is distinct from 'object' or not atlas_private.saved_str_identity_present(v->'id'))
  or exists(select 1 from jsonb_array_elements(state->'strPrograms')v where jsonb_typeof(v) is distinct from 'object' or not atlas_private.saved_str_identity_present(v->'id') or not atlas_private.saved_str_identity_present(v->'propertyId'))
  or exists(select 1 from jsonb_array_elements(state->'lines')v where jsonb_typeof(v) is distinct from 'object') then raise exception 'Saved STR collections require identified properties, programmes and object rows';end if;
 if exists(select 1 from jsonb_array_elements(state->'properties')v group by v->>'id' having count(*)<>1)
  or exists(select 1 from jsonb_array_elements(state->'strPrograms')v group by v->>'id' having count(*)<>1)
  or exists(select 1 from jsonb_array_elements(state->'strPrograms')v where (select count(*) from jsonb_array_elements(state->'properties')p where p->>'id'=v->>'propertyId')<>1) then raise exception 'Saved STR properties and programmes require unique identities and exact property assignments';end if;
 if not atlas_private.saved_str_identity_present(to_jsonb(property_id)) or not atlas_private.saved_str_identity_present(to_jsonb(programme_id))
  or (select count(*) from jsonb_array_elements(state->'properties')v where v->>'id'=property_id)<>1 then raise exception 'Explicit exact saved STR property and programme selection required';end if;
 select v into programme from jsonb_array_elements(state->'strPrograms')v where v->>'id'=programme_id and v->>'propertyId'=property_id;
 if programme is null then raise exception 'Explicit exact saved STR property and programme selection required';end if;
 if programme ? 'config' and programme->'config'<>'null'::jsonb and jsonb_typeof(programme->'config') is distinct from 'object' then raise exception 'Saved STR programme configuration must be an object';end if;
 if programme#>'{config,propertyId}' is distinct from to_jsonb(property_id) or programme#>'{config,programmeId}' is distinct from to_jsonb(programme_id) then raise exception 'Saved group allocations must identify this exact property and programme';end if;
 select coalesce(jsonb_agg(v->'id'),'[]') into selected_ids from jsonb_array_elements(state->'lines')v where v->'propertyId'=to_jsonb(property_id) and v->'strProgramId'=to_jsonb(programme_id);
 if exists(select 1 from jsonb_array_elements(selected_ids)v where not atlas_private.saved_str_identity_present(v))
  or (select count(distinct v) from jsonb_array_elements(selected_ids)v)<>jsonb_array_length(selected_ids) then raise exception 'Saved STR selected line identities must be nonempty and unique';end if;
 -- V1 may omit its line list. V2 must declare exactly the selected tagged rows;
 -- source context, sibling programmes and proposed UI configuration add no rows.
 if document->'formatVersion'='2'::jsonb or programme ? 'lineIds' then
  declared:=programme->'lineIds';
  if jsonb_typeof(declared) is distinct from 'array' then raise exception 'Saved STR declared lineIds must match exactly the selected programme rows';end if;
  if jsonb_array_length(declared)<>jsonb_array_length(selected_ids)
   or exists(select 1 from jsonb_array_elements(declared)v where not atlas_private.saved_str_identity_present(v))
   or (select count(distinct v) from jsonb_array_elements(declared)v)<>jsonb_array_length(declared)
   or exists(select 1 from jsonb_array_elements(declared)v where not selected_ids @> jsonb_build_array(v)) then raise exception 'Saved STR declared lineIds must match exactly the selected programme rows';end if;
 end if;
end;$$;
revoke all on function atlas_private.validate_saved_str_source_identity(jsonb,text,text) from public,anon,authenticated;

-- Keep the deployed independently reconstructed source, optional supporting
-- schedules and fingerprint logic intact. Abort instead of overwriting drift.
do $upgrade$
declare definition text;row_anchor text:=$row$where v->>'propertyId'=property_id and v->>'strProgramId'=programme_id loop$row$;anchor text:=$anchor$ if document->>'formatVersion' is distinct from '1' or $anchor$;
begin
 select pg_get_functiondef('atlas_private.reforecast_saved_str_source(jsonb)'::regprocedure) into definition;
 if strpos(definition,anchor)=0 or strpos(definition,row_anchor)=0 or strpos(definition,'Saved STR original byte hash or size mismatch')=0
  or strpos(definition,'Saved STR evidence does not exactly reproduce the retained original JSON')=0
  or strpos(definition,$required$jsonb_build_object('supportingSchedules',programme->'supportingSchedules')$required$)=0
  or strpos(definition,'validate_saved_str_source_identity')>0 then raise exception 'Saved STR source authority changed; review the v2 upgrade before applying';end if;
 definition:=replace(definition,row_anchor,$row$where v->'propertyId'=to_jsonb(property_id) and v->'strProgramId'=to_jsonb(programme_id) loop$row$);
 execute replace(definition,anchor,$replacement$ perform atlas_private.validate_saved_str_source_identity(document,property_id,programme_id);
 if document->'formatVersion' not in ('1'::jsonb,'2'::jsonb) or $replacement$);
end;$upgrade$;
revoke all on function atlas_private.reforecast_saved_str_source(jsonb) from public,anon,authenticated;
commit;
