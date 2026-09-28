begin;
-- Keep large immutable JSON documents out of value-specific query-plan copies.
-- The private helper loads only the exact fields its validator consumes. It
-- retains all source lines (including non-selected rows used by coverage checks).
create function atlas_private.validate_reforecast_uploaded_relationships(community_key text,upload_key text,mapping jsonb)
returns void language plpgsql stable set search_path='' set plan_cache_mode='force_generic_plan' as $$
declare upload jsonb;audit jsonb;
begin
 select (select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) from jsonb_each(u.payload)e where e.key in ('parserVersion','lines','metadata','integrity','source')) into upload
 from public.atlas_reforecast_uploads u where u.upload_id::text=upload_key and u.community_id::text=community_key;
 if upload is null then return;end if;
 audit:=atlas_private.resolve_workbook_audit(upload->'integrity',upload->'source'->>'sha256');
 perform atlas_private.validate_reforecast_source_relationships(upload,audit,mapping);
end;$$;
revoke all on function atlas_private.validate_reforecast_uploaded_relationships(text,text,jsonb) from public,anon,authenticated;
do $migration$
declare d text;a text;b text;
begin
 -- Pin every reader whose evidence representation changes, so a later reader
 -- cannot silently start consuming an omitted field or an unselected lookup.
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='atlas_private.reforecast_import_issues_before_source_relationships(jsonb,jsonb)'::regprocedure) is distinct from '7e1794b464391519d79d6cd555a728c21a0e4b7617a3a6e543d248a746c69e00' then raise exception 'Audited import evidence reader differs; review selected lookup before memory optimization';end if;
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='atlas_private.reforecast_planning_issues(jsonb,jsonb)'::regprocedure) is distinct from '81564f5ac1b946ac23492371b39c46bc057960624767111bf7a2738b4b0ccc99' then raise exception 'Audited planning evidence reader differs; review selected lookup before memory optimization';end if;
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='atlas_private.validate_reforecast_source_relationships(jsonb,jsonb,jsonb)'::regprocedure) is distinct from '923ad204e52a188787e4aee84b7b55208a39494d2e9521ce325b70e11754e1b6' then raise exception 'Audited source relationship reader differs; review projection fields before memory optimization';end if;
 d:=pg_get_functiondef('atlas_private.reforecast_import_issues_before_close_scope(jsonb,jsonb)'::regprocedure);
 a:=$before$select payload into upload from public.atlas_reforecast_uploads where upload_id::text=config->>'uploadId' and community_id::text=source->>'communityId';
 if upload is null then return result;end if;
 audit:=atlas_private.resolve_workbook_audit(upload->'integrity',upload->'source'->>'sha256');
 perform atlas_private.validate_reforecast_source_relationships(upload,audit,config->'importMapping');return result;$before$;
 b:=$after$perform atlas_private.validate_reforecast_uploaded_relationships(source->>'communityId',config->>'uploadId',config->'importMapping');return result;$after$;
 if position(a in d)=0 then raise exception 'Source relationship caller differs; review before memory optimization';end if;
 execute replace(d,a,b);
 d:=pg_get_functiondef('atlas_private.reforecast_import_issues_before_source_relationships(jsonb,jsonb)'::regprocedure);
 a:=$before$select coalesce(jsonb_object_agg(l->>'id',l),'{}') into upload_lines from jsonb_array_elements(coalesce(upload->'lines','[]'))l;$before$;
 b:=$after$select coalesce(jsonb_object_agg(l->>'id',l),'{}') into upload_lines from jsonb_array_elements(coalesce(upload->'lines','[]'))l where l->>'id' is null or coalesce(mapping->'selectedLineIds','[]') ? (l->>'id');$after$;
 if position(a in d)=0 then raise exception 'Import line lookup differs; review before memory optimization';end if;
 execute replace(d,a,b);
 d:=pg_get_functiondef('atlas_private.reforecast_planning_issues(jsonb,jsonb)'::regprocedure);
 a:=$before$select coalesce(jsonb_object_agg(v->>'id',v),'{}') into upload_lines from jsonb_array_elements(coalesce(upload->'lines','[]'))v;$before$;
 b:=$after$select coalesce(jsonb_object_agg(v->>'id',v),'{}') into upload_lines from jsonb_array_elements(coalesce(upload->'lines','[]'))v where v->>'id' is null or coalesce(mapping->'selectedLineIds','[]') ? (v->>'id');$after$;
 if position(a in d)=0 then raise exception 'Planning line lookup differs; review before memory optimization';end if;
 execute replace(d,a,b);
 d:=pg_get_functiondef('atlas_private.validate_reforecast_source_relationships(jsonb,jsonb,jsonb)'::regprocedure);
 a:=$before$coalesce(jsonb_object_agg(jsonb_build_array(s->>'name',c->>'row',c->>'column')::text,c),'{}') into cells,by_position$before$;
 b:=$after$coalesce(jsonb_object_agg(jsonb_build_array(s->>'name',c->>'row',c->>'column')::text,jsonb_build_object('value',c->'value')),'{}') into cells,by_position$after$;
 if position(a in d)=0 then raise exception 'Audited label lookup differs; review before memory optimization';end if;
 execute replace(d,a,b);
end;$migration$;
commit;
