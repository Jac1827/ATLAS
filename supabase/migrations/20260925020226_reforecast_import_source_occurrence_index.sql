-- Count immutable source-line IDs once. The previous correlated guard expanded
-- the entire workbook for every selected cell (455 x 10,704 in the real intake).
-- Keep the exact missing/duplicate rejection, privileges, function settings,
-- transaction, validation, receipt and readback behavior unchanged.
begin;
do $migration$
declare definition text;before_guard text;after_guard text;
begin
 definition:=pg_get_functiondef('atlas_private.create_reforecast_from_import(uuid,uuid,integer,uuid,uuid,jsonb,jsonb)'::regprocedure);
 before_guard:=$before$if exists(select 1 from jsonb_array_elements_text(p_mapping->'selectedLineIds')id where (select count(*) from jsonb_array_elements(coalesce(u.payload->'lines','[]'))l where l->>'id'=id)<>1) then raise exception 'Each selected source cell must occur exactly once in the retained workbook';end if;$before$;
 after_guard:=$after$select coalesce(jsonb_object_agg(line_id,occurrences),'{}') into upload_line_counts
 from (select l->>'id' line_id,count(*) occurrences from jsonb_array_elements(coalesce(u.payload->'lines','[]'))l group by l->>'id') counted
 where line_id is not null;
 if exists(select 1 from jsonb_array_elements_text(p_mapping->'selectedLineIds')id where coalesce((upload_line_counts->>id)::bigint,0)<>1) then raise exception 'Each selected source cell must occur exactly once in the retained workbook';end if;$after$;
 if position('request_hash text;config jsonb;' in definition)=0 or position(before_guard in definition)=0 then raise exception 'Atomic source occurrence guard differs from expected definition; review before optimizing';end if;
 definition:=replace(definition,'request_hash text;config jsonb;','upload_line_counts jsonb;request_hash text;config jsonb;');
 definition:=replace(definition,before_guard,after_guard);
 execute definition;
end;$migration$;
commit;
